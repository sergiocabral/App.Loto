import { getLottery, LOTTERIES } from "@/data/lotteries";
import type { Draw } from "@/lib/types";
import { getDatabasePool } from "@/lib/server/db";
import { getSafeErrorDetails } from "@/lib/server/security";

const REPOSITORY_LOG_PREFIX = "[app-loto-next][repository]";

type QueryResult<T> = {
  rows: T[];
  rowCount: number | null;
};

type Queryable = {
  query<T extends object = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
};

type NumberItem = {
  groupIndex: number;
  order: number;
  value: string;
};

type DrawRow = {
  lottery_slug: string;
  draw_number: number;
  draw_date: string | null;
  previous_draw_number: number | null;
  next_draw_number: number | null;
  raw_payload: unknown;
  created_at: Date;
  updated_at: Date;
  number_items: unknown;
};

function logRepository(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.info(REPOSITORY_LOG_PREFIX, message, details);
    return;
  }

  console.info(REPOSITORY_LOG_PREFIX, message);
}

function warnRepository(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.warn(REPOSITORY_LOG_PREFIX, message, details);
    return;
  }

  console.warn(REPOSITORY_LOG_PREFIX, message);
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

export type StoredDraw = Draw & {
  createdAt: Date;
  updatedAt: Date;
};

function normalizeNumberItems(value: unknown): NumberItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): NumberItem | null => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const groupIndex = Number(record.groupIndex ?? record.group_index);
      const order = Number(record.order ?? record.number_order);
      const rawValue = record.value ?? record.number_value;
      const numberValue = typeof rawValue === "string" ? rawValue : String(rawValue ?? "");

      if (!Number.isInteger(groupIndex) || groupIndex < 1 || !Number.isInteger(order) || order < 1 || !numberValue) {
        return null;
      }

      return {
        groupIndex,
        order,
        value: sanitizePostgresText(numberValue),
      };
    })
    .filter((item): item is NumberItem => Boolean(item))
    .sort((a, b) => a.groupIndex - b.groupIndex || a.order - b.order);
}

function splitNumbersByDefinition(lotterySlug: string, numbers: string[]): string[][] {
  const lottery = getLottery(lotterySlug);

  if (!lottery?.groups?.length) {
    return numbers.length ? [numbers] : [];
  }

  let offset = 0;
  return lottery.groups
    .map((size) => {
      const group = numbers.slice(offset, offset + size);
      offset += size;
      return group;
    })
    .filter((group) => group.length > 0);
}

function getNumberGroupsFromItems(lotterySlug: string, numberItems: unknown): string[][] {
  const items = normalizeNumberItems(numberItems);

  if (!items.length) {
    return [];
  }

  const grouped = new Map<number, NumberItem[]>();

  for (const item of items) {
    grouped.set(item.groupIndex, [...(grouped.get(item.groupIndex) ?? []), item]);
  }

  const groups = Array.from(grouped.entries())
    .sort(([left], [right]) => left - right)
    .map(([, groupItems]) => groupItems.sort((a, b) => a.order - b.order).map((item) => item.value));

  return groups.length ? groups : splitNumbersByDefinition(lotterySlug, items.map((item) => item.value));
}

function getNumberGroupsForDraw(draw: Draw): string[][] {
  if (draw.numberGroups?.length) {
    return draw.numberGroups
      .map((group) => group.map(sanitizePostgresText).filter(Boolean))
      .filter((group) => group.length > 0);
  }

  return splitNumbersByDefinition(draw.lottery, draw.numbers.map(sanitizePostgresText).filter(Boolean));
}

function buildNumberItems(draw: Draw): NumberItem[] {
  return getNumberGroupsForDraw(draw).flatMap((group, groupIndex) =>
    group.map((value, numberIndex) => ({
      groupIndex: groupIndex + 1,
      order: numberIndex + 1,
      value,
    })),
  );
}

function toStoredDraw(row: DrawRow): StoredDraw {
  const numberGroups = getNumberGroupsFromItems(row.lottery_slug, row.number_items);
  const numbers = numberGroups.flat();

  return {
    lottery: row.lottery_slug,
    drawNumber: row.draw_number,
    date: row.draw_date ?? "",
    numbers,
    numberGroups,
    previousDrawNumber: row.previous_draw_number,
    nextDrawNumber: row.next_draw_number,
    raw: row.raw_payload as Draw["raw"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

let schemaReadyPromise: Promise<void> | null = null;

export async function ensureSchema(): Promise<void> {
  schemaReadyPromise ??= ensureSchemaInternal().catch((error) => {
    schemaReadyPromise = null;
    throw error;
  });

  return schemaReadyPromise;
}

async function ensureSchemaInternal(): Promise<void> {
  const startedAt = Date.now();
  logRepository("ensureSchema:start", { lotteries: LOTTERIES.length });
  const pool = getDatabasePool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lotteries (
      slug TEXT PRIMARY KEY,
      api_slug TEXT NOT NULL UNIQUE,
      count_numbers INTEGER NOT NULL,
      numbers_per_draw INTEGER NOT NULL,
      groups INTEGER[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS draws (
      lottery_slug TEXT NOT NULL REFERENCES lotteries(slug) ON DELETE CASCADE,
      draw_number INTEGER NOT NULL,
      draw_date TEXT,
      previous_draw_number INTEGER,
      next_draw_number INTEGER,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (lottery_slug, draw_number)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS draw_numbers (
      lottery_slug TEXT NOT NULL,
      draw_number INTEGER NOT NULL,
      group_index INTEGER NOT NULL DEFAULT 1,
      number_order INTEGER NOT NULL,
      number_value TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (lottery_slug, draw_number, group_index, number_order),
      FOREIGN KEY (lottery_slug, draw_number) REFERENCES draws(lottery_slug, draw_number) ON DELETE CASCADE
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS draws_lottery_number_desc_idx
      ON draws (lottery_slug, draw_number DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS draw_numbers_draw_idx
      ON draw_numbers (lottery_slug, draw_number, group_index, number_order);
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'draws'
          AND column_name = 'numbers'
      ) THEN
        ALTER TABLE draws ALTER COLUMN numbers DROP NOT NULL;
        ALTER TABLE draws ALTER COLUMN numbers SET DEFAULT '{}'::TEXT[];

        EXECUTE $migration$
          INSERT INTO draw_numbers (lottery_slug, draw_number, group_index, number_order, number_value, updated_at)
          SELECT
            d.lottery_slug,
            d.draw_number,
            CASE WHEN d.lottery_slug = 'DuplaSena' AND item.ordinality > 6 THEN 2 ELSE 1 END AS group_index,
            CASE WHEN d.lottery_slug = 'DuplaSena' AND item.ordinality > 6 THEN item.ordinality - 6 ELSE item.ordinality END AS number_order,
            item.number_value,
            NOW()
          FROM draws d
          CROSS JOIN LATERAL unnest(d.numbers) WITH ORDINALITY AS item(number_value, ordinality)
          WHERE d.numbers IS NOT NULL
          ON CONFLICT (lottery_slug, draw_number, group_index, number_order) DO UPDATE SET
            number_value = EXCLUDED.number_value,
            updated_at = NOW();
        $migration$;

        ALTER TABLE draws DROP COLUMN numbers;
      END IF;
    END $$;
  `);

  await pool.query(`
    UPDATE draws
    SET raw_payload = raw_payload - 'textLines' - 'sourceUrl'
    WHERE raw_payload ? 'textLines'
       OR raw_payload ? 'sourceUrl';
  `);

  await pool.query(`
    UPDATE draws
    SET raw_payload = raw_payload - 'source'
    WHERE raw_payload->>'source' = 'luckygames.tips';
  `);

  for (const lottery of LOTTERIES) {
    await pool.query(
      `
        INSERT INTO lotteries (slug, api_slug, count_numbers, numbers_per_draw, groups, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (slug) DO UPDATE SET
          api_slug = EXCLUDED.api_slug,
          count_numbers = EXCLUDED.count_numbers,
          numbers_per_draw = EXCLUDED.numbers_per_draw,
          groups = EXCLUDED.groups,
          updated_at = NOW();
      `,
      [lottery.slug, lottery.apiSlug, lottery.countNumbers, lottery.numbersPerDraw, lottery.groups ?? []],
    );
  }

  logRepository("ensureSchema:done", { lotteries: LOTTERIES.length, elapsedMs: elapsedMs(startedAt) });
}

const SAVE_DRAW_SQL = `
  INSERT INTO draws (
    lottery_slug,
    draw_number,
    draw_date,
    previous_draw_number,
    next_draw_number,
    raw_payload,
    updated_at
  )
  VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
  ON CONFLICT (lottery_slug, draw_number) DO UPDATE SET
    draw_date = EXCLUDED.draw_date,
    previous_draw_number = EXCLUDED.previous_draw_number,
    next_draw_number = EXCLUDED.next_draw_number,
    raw_payload = EXCLUDED.raw_payload,
    updated_at = NOW()
  RETURNING
    lottery_slug,
    draw_number,
    draw_date,
    previous_draw_number,
    next_draw_number,
    raw_payload,
    created_at,
    updated_at,
    '[]'::jsonb AS number_items;
`;

const DRAW_SELECT_SQL = `
  SELECT
    d.lottery_slug,
    d.draw_number,
    d.draw_date,
    d.previous_draw_number,
    d.next_draw_number,
    d.raw_payload,
    d.created_at,
    d.updated_at,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'groupIndex', dn.group_index,
          'order', dn.number_order,
          'value', dn.number_value
        )
        ORDER BY dn.group_index, dn.number_order
      ) FILTER (WHERE dn.number_value IS NOT NULL),
      '[]'::jsonb
    ) AS number_items
  FROM draws d
  LEFT JOIN draw_numbers dn
    ON dn.lottery_slug = d.lottery_slug
   AND dn.draw_number = d.draw_number
`;

const DRAW_GROUP_BY_SQL = `
  GROUP BY
    d.lottery_slug,
    d.draw_number,
    d.draw_date,
    d.previous_draw_number,
    d.next_draw_number,
    d.raw_payload,
    d.created_at,
    d.updated_at
`;

const POSTGRES_UNSUPPORTED_CHARACTER_PATTERN = /\u0000/g;

function sanitizePostgresText(value: string): string {
  return value.replace(POSTGRES_UNSUPPORTED_CHARACTER_PATTERN, "");
}

function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizePostgresText(value);
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeJsonValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [sanitizePostgresText(key), sanitizeJsonValue(item)]),
    );
  }

  return value;
}

function sanitizeRawPayload(value: unknown): unknown {
  const sanitized = sanitizeJsonValue(value);

  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return sanitized ?? {};
  }

  const payload = { ...(sanitized as Record<string, unknown>) };
  delete payload.source;
  delete payload.sourceUrl;
  delete payload.textLines;

  return payload;
}

function getDrawParams(draw: Draw): unknown[] {
  return [
    sanitizePostgresText(draw.lottery),
    draw.drawNumber,
    sanitizePostgresText(draw.date),
    draw.previousDrawNumber,
    draw.nextDrawNumber,
    JSON.stringify(sanitizeRawPayload(draw.raw)),
  ];
}

async function replaceDrawNumbers(client: Queryable, draw: Draw): Promise<NumberItem[]> {
  const lottery = sanitizePostgresText(draw.lottery);
  const items = buildNumberItems(draw);

  await client.query(
    `
      DELETE FROM draw_numbers
      WHERE lottery_slug = $1 AND draw_number = $2;
    `,
    [lottery, draw.drawNumber],
  );

  if (!items.length) {
    return [];
  }

  const params: unknown[] = [];
  const values = items.map((item, index) => {
    const offset = index * 5;
    params.push(lottery, draw.drawNumber, item.groupIndex, item.order, sanitizePostgresText(item.value));
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, NOW())`;
  });

  await client.query(
    `
      INSERT INTO draw_numbers (
        lottery_slug,
        draw_number,
        group_index,
        number_order,
        number_value,
        updated_at
      )
      VALUES ${values.join(", ")}
      ON CONFLICT (lottery_slug, draw_number, group_index, number_order) DO UPDATE SET
        number_value = EXCLUDED.number_value,
        updated_at = NOW();
    `,
    params,
  );

  return items;
}

async function saveDrawWithClient(client: Queryable, draw: Draw): Promise<StoredDraw> {
  const result = await client.query<DrawRow>(SAVE_DRAW_SQL, getDrawParams(draw));
  const numberItems = await replaceDrawNumbers(client, draw);
  const row = result.rows[0];

  if (!row) {
    throw new Error(`Draw upsert did not return a row for ${draw.lottery} #${draw.drawNumber}`);
  }

  return toStoredDraw({
    ...row,
    number_items: numberItems.map((item) => ({
      groupIndex: item.groupIndex,
      order: item.order,
      value: item.value,
    })),
  });
}

export async function saveDraw(draw: Draw): Promise<StoredDraw> {
  const startedAt = Date.now();
  logRepository("saveDraw:start", { lottery: draw.lottery, drawNumber: draw.drawNumber });
  await ensureSchema();

  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const storedDraw = await saveDrawWithClient(client, draw);
    await client.query("COMMIT");

    logRepository("saveDraw:done", {
      lottery: draw.lottery,
      drawNumber: draw.drawNumber,
      elapsedMs: elapsedMs(startedAt),
    });

    return storedDraw;
  } catch (error) {
    await client.query("ROLLBACK");
    warnRepository("saveDraw:rollback", {
      lottery: draw.lottery,
      drawNumber: draw.drawNumber,
      elapsedMs: elapsedMs(startedAt),
      error: getSafeErrorDetails(error),
    });
    throw error;
  } finally {
    client.release();
  }
}

export async function saveDraws(draws: Draw[]): Promise<StoredDraw[]> {
  const startedAt = Date.now();

  if (!draws.length) {
    logRepository("saveDraws:empty", { elapsedMs: elapsedMs(startedAt) });
    return [];
  }

  const lottery = draws[0]?.lottery ?? null;
  const highestDrawNumber = Math.max(...draws.map((draw) => draw.drawNumber));
  const lowestDrawNumber = Math.min(...draws.map((draw) => draw.drawNumber));
  logRepository("saveDraws:start", {
    lottery,
    total: draws.length,
    highestDrawNumber,
    lowestDrawNumber,
  });

  await ensureSchema();

  const pool = getDatabasePool();
  const client = await pool.connect();
  const storedDraws: StoredDraw[] = [];
  const progressInterval = Math.max(100, Math.floor(draws.length / 10));

  try {
    await client.query("BEGIN");
    logRepository("saveDraws:transaction-begin", { lottery, total: draws.length });

    for (const [index, draw] of draws.entries()) {
      storedDraws.push(await saveDrawWithClient(client, draw));

      const savedCount = index + 1;
      if (savedCount === 1 || savedCount === draws.length || savedCount % progressInterval === 0) {
        logRepository("saveDraws:progress", {
          lottery,
          saved: savedCount,
          total: draws.length,
          currentDrawNumber: draw.drawNumber,
          elapsedMs: elapsedMs(startedAt),
        });
      }
    }

    await client.query("COMMIT");
    logRepository("saveDraws:transaction-commit", {
      lottery,
      saved: storedDraws.length,
      elapsedMs: elapsedMs(startedAt),
    });
    return storedDraws;
  } catch (error) {
    await client.query("ROLLBACK");
    warnRepository("saveDraws:transaction-rollback", {
      lottery,
      savedBeforeError: storedDraws.length,
      elapsedMs: elapsedMs(startedAt),
      error: getSafeErrorDetails(error),
    });
    throw error;
  } finally {
    client.release();
    logRepository("saveDraws:client-released", { lottery, elapsedMs: elapsedMs(startedAt) });
  }
}

export async function getDraw(lottery: string, drawNumber: number): Promise<StoredDraw | null> {
  const startedAt = Date.now();
  logRepository("getDraw:start", { lottery, drawNumber });
  await ensureSchema();

  const pool = getDatabasePool();
  const result = await pool.query<DrawRow>(
    `
      ${DRAW_SELECT_SQL}
      WHERE d.lottery_slug = $1 AND d.draw_number = $2
      ${DRAW_GROUP_BY_SQL}
      LIMIT 1;
    `,
    [lottery, drawNumber],
  );

  logRepository("getDraw:done", {
    lottery,
    drawNumber,
    found: Boolean(result.rowCount),
    rowCount: result.rowCount,
    elapsedMs: elapsedMs(startedAt),
  });

  return result.rowCount && result.rows[0] ? toStoredDraw(result.rows[0]) : null;
}

export async function getLatestDraw(lottery: string): Promise<StoredDraw | null> {
  const startedAt = Date.now();
  logRepository("getLatestDraw:start", { lottery });
  await ensureSchema();

  const pool = getDatabasePool();
  const result = await pool.query<DrawRow>(
    `
      ${DRAW_SELECT_SQL}
      WHERE d.lottery_slug = $1
      ${DRAW_GROUP_BY_SQL}
      ORDER BY d.draw_number DESC
      LIMIT 1;
    `,
    [lottery],
  );

  logRepository("getLatestDraw:done", {
    lottery,
    found: Boolean(result.rowCount),
    drawNumber: result.rows[0]?.draw_number ?? null,
    elapsedMs: elapsedMs(startedAt),
  });

  return result.rowCount && result.rows[0] ? toStoredDraw(result.rows[0]) : null;
}

export async function listDraws(lottery: string): Promise<StoredDraw[]> {
  const startedAt = Date.now();
  logRepository("listDraws:start", { lottery });
  await ensureSchema();

  const pool = getDatabasePool();
  const result = await pool.query<DrawRow>(
    `
      ${DRAW_SELECT_SQL}
      WHERE d.lottery_slug = $1
      ${DRAW_GROUP_BY_SQL}
      ORDER BY d.draw_number DESC;
    `,
    [lottery],
  );

  logRepository("listDraws:done", {
    lottery,
    rows: result.rowCount,
    newestDrawNumber: result.rows[0]?.draw_number ?? null,
    oldestDrawNumber: result.rows.at(-1)?.draw_number ?? null,
    elapsedMs: elapsedMs(startedAt),
  });

  return result.rows.map(toStoredDraw);
}

export async function getNextMissingDrawNumber(lottery: string, startAt = 1): Promise<number> {
  const startedAt = Date.now();
  const normalizedStartAt = Math.max(1, Math.floor(startAt));
  logRepository("getNextMissingDrawNumber:start", { lottery, startAt: normalizedStartAt });
  await ensureSchema();

  const pool = getDatabasePool();
  const result = await pool.query<{ next_draw_number: number }>(
    `
      WITH bounds AS (
        SELECT GREATEST($2::INTEGER, COALESCE(MAX(draw_number) + 1, $2::INTEGER)) AS upper_bound
        FROM draws
        WHERE lottery_slug = $1
      )
      SELECT candidate AS next_draw_number
      FROM bounds
      CROSS JOIN LATERAL generate_series($2::INTEGER, bounds.upper_bound) AS candidate
      LEFT JOIN draws d
        ON d.lottery_slug = $1
       AND d.draw_number = candidate
      WHERE d.draw_number IS NULL
      ORDER BY candidate
      LIMIT 1;
    `,
    [lottery, normalizedStartAt],
  );

  const nextDrawNumber = Number(result.rows[0]?.next_draw_number ?? normalizedStartAt);
  logRepository("getNextMissingDrawNumber:done", {
    lottery,
    startAt: normalizedStartAt,
    nextDrawNumber,
    elapsedMs: elapsedMs(startedAt),
  });

  return nextDrawNumber;
}

export async function getNextDrawNumberFromStorage(lottery: string): Promise<number> {
  const startedAt = Date.now();
  logRepository("getNextDrawNumberFromStorage:start", { lottery });
  const latest = await getLatestDraw(lottery);
  const nextDrawNumber = latest ? latest.drawNumber + 1 : 1;
  logRepository("getNextDrawNumberFromStorage:done", { lottery, nextDrawNumber, elapsedMs: elapsedMs(startedAt) });
  return nextDrawNumber;
}
