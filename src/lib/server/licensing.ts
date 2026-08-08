import { createHash, randomBytes } from "node:crypto";
import { verifyAccessCookie } from "@/lib/server/accessCookie";
import { getDatabasePool } from "@/lib/server/db";
import { getAccessCookieSecret } from "@/lib/server/env";
import { getSafeErrorDetails } from "@/lib/server/security";

const LICENSING_LOG_PREFIX = "[app-loto-next][licensing]";

export type LicensePlan = "lifetime" | "pass30";
export type LicenseStatus = "active" | "pending" | "revoked";
export type AccessTokenPurpose = "activation" | "login";

export type License = {
  createdAt: Date;
  email: string;
  expiresAt: Date | null;
  id: number;
  plan: LicensePlan;
  status: LicenseStatus;
  updatedAt: Date;
};

export type Entitlement =
  | { licensed: false }
  | {
      licensed: true;
      email: string;
      expiresAt: Date | null;
      licenseId: number;
      plan: LicensePlan;
    };

const ACTIVATION_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;
const LOGIN_TOKEN_TTL_MS = 30 * 60 * 1000;
const ENTITLEMENT_CACHE_TTL_MS = 5 * 60 * 1000;
export const PASS30_DURATION_DAYS = 30;

type LicenseRow = {
  id: string | number;
  email: string;
  plan: LicensePlan;
  status: LicenseStatus;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const entitlementCache = new Map<number, { license: License | null; cachedAt: number }>();

let licensingSchemaReadyPromise: Promise<void> | null = null;

function logLicensing(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.info(LICENSING_LOG_PREFIX, message, details);
    return;
  }

  console.info(LICENSING_LOG_PREFIX, message);
}

function warnLicensing(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.warn(LICENSING_LOG_PREFIX, message, details);
    return;
  }

  console.warn(LICENSING_LOG_PREFIX, message);
}

function mapLicenseRow(row: LicenseRow): License {
  return {
    createdAt: row.created_at,
    email: row.email,
    expiresAt: row.expires_at,
    id: Number(row.id),
    plan: row.plan,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

export async function ensureLicensingSchema(): Promise<void> {
  licensingSchemaReadyPromise ??= ensureLicensingSchemaInternal().catch((error) => {
    licensingSchemaReadyPromise = null;
    throw error;
  });

  return licensingSchemaReadyPromise;
}

async function ensureLicensingSchemaInternal(): Promise<void> {
  const pool = getDatabasePool();
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    await client.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
      plan TEXT NOT NULL CHECK (plan IN ('pass30', 'lifetime')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

    await client.query(`
    CREATE INDEX IF NOT EXISTS licenses_status_idx
      ON licenses (status, expires_at);
  `);

    await client.query(`
    CREATE TABLE IF NOT EXISTS access_tokens (
      token_hash TEXT PRIMARY KEY,
      license_id BIGINT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL DEFAULT 'login' CHECK (purpose IN ('activation', 'login')),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

    await client.query(`
    CREATE INDEX IF NOT EXISTS access_tokens_license_idx
      ON access_tokens (license_id, created_at DESC);
  `);

    await client.query(`
    CREATE TABLE IF NOT EXISTS payment_events (
      payment_id TEXT PRIMARY KEY,
      license_id BIGINT REFERENCES licenses(id) ON DELETE SET NULL,
      plan TEXT NOT NULL,
      status TEXT NOT NULL,
      amount NUMERIC(10,2),
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

    await client.query(`
    CREATE TABLE IF NOT EXISTS chat_usage (
      license_id BIGINT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
      usage_date DATE NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (license_id, usage_date)
    );
  `);

    await client.query("COMMIT");
    logLicensing("ensureLicensingSchema:done");
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        warnLicensing("ensureLicensingSchema:rollback-failed", {
          error: getSafeErrorDetails(rollbackError),
        });
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

export async function upsertPendingLicense(email: string, plan: LicensePlan): Promise<License> {
  await ensureLicensingSchema();
  const pool = getDatabasePool();
  const result = await pool.query<LicenseRow>(
    `
    INSERT INTO licenses (email, plan)
    VALUES ($1, $2)
    ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
    RETURNING *;
  `,
    [email, plan],
  );

  return mapLicenseRow(result.rows[0]);
}

type ApprovedPaymentInput = {
  amount: number | null;
  email: string | null;
  licenseId: number | null;
  paymentId: string;
  plan: LicensePlan;
  rawPayload: Record<string, unknown>;
};

type ApprovedPaymentResult = {
  applied: boolean;
  license: License | null;
};

export async function applyApprovedPayment(input: ApprovedPaymentInput): Promise<ApprovedPaymentResult> {
  await ensureLicensingSchema();
  const pool = getDatabasePool();
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const eventResult = await client.query(
      `
      INSERT INTO payment_events (payment_id, plan, status, amount, raw_payload)
      VALUES ($1, $2, 'approved', $3, $4::jsonb)
      ON CONFLICT (payment_id) DO NOTHING
      RETURNING payment_id;
    `,
      [input.paymentId, input.plan, input.amount, JSON.stringify(input.rawPayload)],
    );

    if (!eventResult.rowCount) {
      await client.query("COMMIT");
      logLicensing("applyApprovedPayment:already-processed", { paymentId: input.paymentId });
      return { applied: false, license: null };
    }

    let licenseRow: LicenseRow | undefined;

    if (input.licenseId) {
      const activation = await client.query<LicenseRow>(
        `
        UPDATE licenses
        SET
          status = 'active',
          plan = CASE WHEN licenses.plan = 'lifetime' OR $2 = 'lifetime' THEN 'lifetime' ELSE 'pass30' END,
          expires_at = CASE
            WHEN licenses.plan = 'lifetime' OR $2 = 'lifetime' THEN NULL
            ELSE GREATEST(NOW(), COALESCE(licenses.expires_at, NOW())) + make_interval(days => $3)
          END,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *;
      `,
        [input.licenseId, input.plan, PASS30_DURATION_DAYS],
      );
      licenseRow = activation.rows[0];
    }

    if (!licenseRow && input.email) {
      const fallback = await client.query<LicenseRow>(
        `
        INSERT INTO licenses (email, plan, status, expires_at)
        VALUES (
          $1,
          $2,
          'active',
          CASE WHEN $2 = 'lifetime' THEN NULL ELSE NOW() + make_interval(days => $3) END
        )
        ON CONFLICT (email) DO UPDATE SET
          status = 'active',
          plan = CASE WHEN licenses.plan = 'lifetime' OR EXCLUDED.plan = 'lifetime' THEN 'lifetime' ELSE 'pass30' END,
          expires_at = CASE
            WHEN licenses.plan = 'lifetime' OR EXCLUDED.plan = 'lifetime' THEN NULL
            ELSE GREATEST(NOW(), COALESCE(licenses.expires_at, NOW())) + make_interval(days => $3)
          END,
          updated_at = NOW()
        RETURNING *;
      `,
        [input.email, input.plan, PASS30_DURATION_DAYS],
      );
      licenseRow = fallback.rows[0];
    }

    if (!licenseRow) {
      await client.query("ROLLBACK");
      warnLicensing("applyApprovedPayment:license-not-found", {
        licenseId: input.licenseId,
        paymentId: input.paymentId,
      });
      return { applied: false, license: null };
    }

    await client.query(
      `
      UPDATE payment_events
      SET license_id = $2, processed_at = NOW()
      WHERE payment_id = $1;
    `,
      [input.paymentId, Number(licenseRow.id)],
    );

    await client.query("COMMIT");
    const license = mapLicenseRow(licenseRow);
    entitlementCache.delete(license.id);
    logLicensing("applyApprovedPayment:applied", {
      licenseId: license.id,
      paymentId: input.paymentId,
      plan: license.plan,
    });
    return { applied: true, license };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        warnLicensing("applyApprovedPayment:rollback-failed", {
          error: getSafeErrorDetails(rollbackError),
        });
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

type RevokedPaymentInput = {
  paymentId: string;
  rawPayload: Record<string, unknown>;
  status: string;
};

export async function applyRevokedPayment(input: RevokedPaymentInput): Promise<{ revokedLicenseId: number | null }> {
  await ensureLicensingSchema();
  const pool = getDatabasePool();
  const eventResult = await pool.query<{ license_id: string | number | null }>(
    `
    UPDATE payment_events
    SET status = $2, raw_payload = $3::jsonb, processed_at = NOW()
    WHERE payment_id = $1
    RETURNING license_id;
  `,
    [input.paymentId, input.status, JSON.stringify(input.rawPayload)],
  );

  const licenseId = eventResult.rows[0]?.license_id;

  if (!licenseId) {
    logLicensing("applyRevokedPayment:no-license", { paymentId: input.paymentId, status: input.status });
    return { revokedLicenseId: null };
  }

  await pool.query(
    `
    UPDATE licenses
    SET status = 'revoked', updated_at = NOW()
    WHERE id = $1;
  `,
    [Number(licenseId)],
  );

  entitlementCache.delete(Number(licenseId));
  logLicensing("applyRevokedPayment:revoked", { licenseId: Number(licenseId), paymentId: input.paymentId });
  return { revokedLicenseId: Number(licenseId) };
}

export async function issueAccessToken(licenseId: number, purpose: AccessTokenPurpose): Promise<string> {
  await ensureLicensingSchema();
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const ttlMs = purpose === "activation" ? ACTIVATION_TOKEN_TTL_MS : LOGIN_TOKEN_TTL_MS;
  const pool = getDatabasePool();

  await pool.query(
    `
    INSERT INTO access_tokens (token_hash, license_id, purpose, expires_at)
    VALUES ($1, $2, $3, NOW() + make_interval(secs => $4));
  `,
    [tokenHash, licenseId, purpose, ttlMs / 1000],
  );

  return rawToken;
}

export async function consumeAccessToken(rawToken: string): Promise<License | null> {
  await ensureLicensingSchema();
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const pool = getDatabasePool();
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const tokenResult = await client.query<{ license_id: string | number }>(
      `
      SELECT license_id
      FROM access_tokens
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > NOW()
      FOR UPDATE;
    `,
      [tokenHash],
    );

    if (!tokenResult.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query(
      `
      UPDATE access_tokens
      SET used_at = NOW()
      WHERE token_hash = $1;
    `,
      [tokenHash],
    );

    const licenseResult = await client.query<LicenseRow>(
      `
      SELECT *
      FROM licenses
      WHERE id = $1;
    `,
      [Number(tokenResult.rows[0].license_id)],
    );

    await client.query("COMMIT");
    return licenseResult.rows[0] ? mapLicenseRow(licenseResult.rows[0]) : null;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        warnLicensing("consumeAccessToken:rollback-failed", {
          error: getSafeErrorDetails(rollbackError),
        });
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

export async function getLicenseById(licenseId: number): Promise<License | null> {
  await ensureLicensingSchema();
  const pool = getDatabasePool();
  const result = await pool.query<LicenseRow>("SELECT * FROM licenses WHERE id = $1;", [licenseId]);
  return result.rows[0] ? mapLicenseRow(result.rows[0]) : null;
}

export async function getActiveLicenseByEmail(email: string): Promise<License | null> {
  await ensureLicensingSchema();
  const pool = getDatabasePool();
  const result = await pool.query<LicenseRow>(
    `
    SELECT *
    FROM licenses
    WHERE email = $1
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > NOW());
  `,
    [email],
  );

  return result.rows[0] ? mapLicenseRow(result.rows[0]) : null;
}

export function isLicenseUsable(license: License | null): license is License {
  if (!license || license.status !== "active") {
    return false;
  }

  return license.expiresAt === null || license.expiresAt.getTime() > Date.now();
}

type ChatUsageResult = {
  allowed: boolean;
  count: number;
};

export async function incrementChatUsage(licenseId: number, usageDate: string, limit: number): Promise<ChatUsageResult> {
  await ensureLicensingSchema();
  const pool = getDatabasePool();
  const result = await pool.query<{ message_count: number }>(
    `
    INSERT INTO chat_usage (license_id, usage_date, message_count)
    VALUES ($1, $2, 1)
    ON CONFLICT (license_id, usage_date) DO UPDATE
      SET message_count = chat_usage.message_count + 1, updated_at = NOW()
      WHERE chat_usage.message_count < $3
    RETURNING message_count;
  `,
    [licenseId, usageDate, limit],
  );

  if (!result.rowCount) {
    return { allowed: false, count: limit };
  }

  return { allowed: true, count: result.rows[0].message_count };
}

export async function getChatUsage(licenseId: number, usageDate: string): Promise<number> {
  await ensureLicensingSchema();
  const pool = getDatabasePool();
  const result = await pool.query<{ message_count: number }>(
    `
    SELECT message_count
    FROM chat_usage
    WHERE license_id = $1 AND usage_date = $2;
  `,
    [licenseId, usageDate],
  );

  return result.rows[0]?.message_count ?? 0;
}

const SAO_PAULO_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
  year: "numeric",
});

export function getSaoPauloDateString(date: Date = new Date()): string {
  return SAO_PAULO_DATE_FORMATTER.format(date);
}

export async function getEntitlementFromCookieValue(cookieValue: string | undefined | null): Promise<Entitlement> {
  const secret = getAccessCookieSecret();

  if (!secret || !cookieValue) {
    return { licensed: false };
  }

  const payload = verifyAccessCookie(cookieValue, secret);

  if (!payload) {
    return { licensed: false };
  }

  const cached = entitlementCache.get(payload.lid);
  let license: License | null;

  if (cached && Date.now() - cached.cachedAt < ENTITLEMENT_CACHE_TTL_MS) {
    license = cached.license;
  } else {
    try {
      license = await getLicenseById(payload.lid);
    } catch (error) {
      warnLicensing("getEntitlement:lookup-failed", { error: getSafeErrorDetails(error) });
      return { licensed: false };
    }

    entitlementCache.set(payload.lid, { license, cachedAt: Date.now() });
  }

  if (!isLicenseUsable(license)) {
    return { licensed: false };
  }

  return {
    licensed: true,
    email: license.email,
    expiresAt: license.expiresAt,
    licenseId: license.id,
    plan: license.plan,
  };
}

export function resetLicensingStateForTests(): void {
  entitlementCache.clear();
  licensingSchemaReadyPromise = null;
}
