import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signAccessCookie } from "@/lib/server/accessCookie";

type Licensing = typeof import("@/lib/server/licensing");

const COOKIE_SECRET = "postgres-test-secret-with-32-chars!!";

describe("licensing repository with PostgreSQL", () => {
  let pool: Pool | undefined;
  let licensing: Licensing;

  beforeEach(async () => {
    vi.resetModules();
    process.env.ACCESS_COOKIE_SECRET = COOKIE_SECRET;
    licensing = await import("@/lib/server/licensing");
    const database = await import("@/lib/server/db");
    pool = database.getDatabasePool();
    await pool.query("DROP TABLE IF EXISTS chat_usage, payment_events, access_tokens, licenses CASCADE");
  });

  afterEach(async () => {
    delete process.env.ACCESS_COOKIE_SECRET;
    await pool?.end();
  });

  it("creates pending licenses idempotently by e-mail", async () => {
    const first = await licensing.upsertPendingLicense("user@example.com", "pass30");
    const second = await licensing.upsertPendingLicense("user@example.com", "lifetime");

    expect(first.status).toBe("pending");
    expect(second.id).toBe(first.id);
    expect(second.plan).toBe("pass30");
  });

  it("activates a pass30 license, extends it on repurchase and ignores replayed payments", async () => {
    const pending = await licensing.upsertPendingLicense("buyer@example.com", "pass30");

    const firstPayment = await licensing.applyApprovedPayment({
      amount: 10,
      email: "buyer@example.com",
      licenseId: pending.id,
      paymentId: "pay-1",
      plan: "pass30",
      rawPayload: { id: "pay-1" },
    });

    expect(firstPayment.applied).toBe(true);
    expect(firstPayment.license?.status).toBe("active");
    const firstExpiry = firstPayment.license?.expiresAt;
    expect(firstExpiry).toBeInstanceOf(Date);

    const replay = await licensing.applyApprovedPayment({
      amount: 10,
      email: "buyer@example.com",
      licenseId: pending.id,
      paymentId: "pay-1",
      plan: "pass30",
      rawPayload: { id: "pay-1" },
    });

    expect(replay.applied).toBe(false);

    const repurchase = await licensing.applyApprovedPayment({
      amount: 10,
      email: "buyer@example.com",
      licenseId: pending.id,
      paymentId: "pay-2",
      plan: "pass30",
      rawPayload: { id: "pay-2" },
    });

    expect(repurchase.applied).toBe(true);
    const extendedExpiry = repurchase.license?.expiresAt;
    expect(extendedExpiry!.getTime() - firstExpiry!.getTime()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
  });

  it("upgrades to lifetime, never downgrades and falls back to e-mail when license id is missing", async () => {
    const upgraded = await licensing.applyApprovedPayment({
      amount: 50,
      email: "vip@example.com",
      licenseId: null,
      paymentId: "pay-lifetime",
      plan: "lifetime",
      rawPayload: {},
    });

    expect(upgraded.applied).toBe(true);
    expect(upgraded.license?.plan).toBe("lifetime");
    expect(upgraded.license?.expiresAt).toBeNull();

    const laterPass = await licensing.applyApprovedPayment({
      amount: 10,
      email: "vip@example.com",
      licenseId: upgraded.license!.id,
      paymentId: "pay-pass-later",
      plan: "pass30",
      rawPayload: {},
    });

    expect(laterPass.license?.plan).toBe("lifetime");
    expect(laterPass.license?.expiresAt).toBeNull();
  });

  it("returns applied=false when neither license id nor e-mail resolve a license", async () => {
    const result = await licensing.applyApprovedPayment({
      amount: 10,
      email: null,
      licenseId: 999_999,
      paymentId: "pay-orphan",
      plan: "pass30",
      rawPayload: {},
    });

    expect(result).toEqual({ applied: false, license: null });
    const events = await pool!.query("SELECT COUNT(*)::int AS total FROM payment_events");
    expect(events.rows[0].total).toBe(0);
  });

  it("revokes licenses from refund events and ignores unknown payments", async () => {
    const pending = await licensing.upsertPendingLicense("refund@example.com", "pass30");
    await licensing.applyApprovedPayment({
      amount: 10,
      email: "refund@example.com",
      licenseId: pending.id,
      paymentId: "pay-refund",
      plan: "pass30",
      rawPayload: {},
    });

    const unknown = await licensing.applyRevokedPayment({
      paymentId: "pay-unknown",
      rawPayload: {},
      status: "refunded",
    });
    expect(unknown.revokedLicenseId).toBeNull();

    const revoked = await licensing.applyRevokedPayment({
      paymentId: "pay-refund",
      rawPayload: { status: "refunded" },
      status: "refunded",
    });
    expect(revoked.revokedLicenseId).toBe(pending.id);

    const license = await licensing.getLicenseById(pending.id);
    expect(license?.status).toBe("revoked");
    expect(await licensing.getActiveLicenseByEmail("refund@example.com")).toBeNull();
  });

  it("issues and consumes single-use access tokens", async () => {
    const pending = await licensing.upsertPendingLicense("token@example.com", "pass30");
    await licensing.applyApprovedPayment({
      amount: 10,
      email: "token@example.com",
      licenseId: pending.id,
      paymentId: "pay-token",
      plan: "pass30",
      rawPayload: {},
    });

    const token = await licensing.issueAccessToken(pending.id, "activation");
    expect(token.length).toBeGreaterThan(30);

    const consumed = await licensing.consumeAccessToken(token);
    expect(consumed?.id).toBe(pending.id);
    expect(consumed?.status).toBe("active");

    expect(await licensing.consumeAccessToken(token)).toBeNull();
    expect(await licensing.consumeAccessToken("invalid-token")).toBeNull();

    const rawExpired = await licensing.issueAccessToken(pending.id, "login");
    await pool!.query("UPDATE access_tokens SET expires_at = NOW() - interval '1 minute' WHERE used_at IS NULL");
    expect(await licensing.consumeAccessToken(rawExpired)).toBeNull();
  });

  it("enforces the daily chat usage ceiling atomically", async () => {
    const pending = await licensing.upsertPendingLicense("chat@example.com", "pass30");
    await licensing.applyApprovedPayment({
      amount: 10,
      email: "chat@example.com",
      licenseId: pending.id,
      paymentId: "pay-chat",
      plan: "pass30",
      rawPayload: {},
    });

    const today = licensing.getSaoPauloDateString();

    expect(await licensing.getChatUsage(pending.id, today)).toBe(0);
    expect(await licensing.incrementChatUsage(pending.id, today, 3)).toEqual({ allowed: true, count: 1 });
    expect(await licensing.incrementChatUsage(pending.id, today, 3)).toEqual({ allowed: true, count: 2 });
    expect(await licensing.incrementChatUsage(pending.id, today, 3)).toEqual({ allowed: true, count: 3 });
    expect(await licensing.incrementChatUsage(pending.id, today, 3)).toEqual({ allowed: false, count: 3 });
    expect(await licensing.getChatUsage(pending.id, today)).toBe(3);
  });

  it("resolves entitlements from signed cookies with database revalidation", async () => {
    const pending = await licensing.upsertPendingLicense("cookie@example.com", "pass30");
    const activated = await licensing.applyApprovedPayment({
      amount: 10,
      email: "cookie@example.com",
      licenseId: pending.id,
      paymentId: "pay-cookie",
      plan: "pass30",
      rawPayload: {},
    });

    const nowSeconds = Math.floor(Date.now() / 1000);
    const cookie = signAccessCookie(
      {
        email: "cookie@example.com",
        exp: nowSeconds + 3_600,
        iat: nowSeconds,
        lid: pending.id,
        plan: "pass30",
        v: 1,
      },
      COOKIE_SECRET,
    );

    const entitlement = await licensing.getEntitlementFromCookieValue(cookie);
    expect(entitlement).toMatchObject({
      licensed: true,
      email: "cookie@example.com",
      licenseId: pending.id,
      plan: "pass30",
    });
    expect(activated.license?.expiresAt).toBeInstanceOf(Date);

    expect(await licensing.getEntitlementFromCookieValue(undefined)).toEqual({ licensed: false });
    expect(await licensing.getEntitlementFromCookieValue("garbage.value")).toEqual({ licensed: false });

    const unknownLicenseCookie = signAccessCookie(
      {
        email: "cookie@example.com",
        exp: nowSeconds + 3_600,
        iat: nowSeconds,
        lid: 999_999,
        plan: "pass30",
        v: 1,
      },
      COOKIE_SECRET,
    );
    expect(await licensing.getEntitlementFromCookieValue(unknownLicenseCookie)).toEqual({ licensed: false });

    await licensing.applyRevokedPayment({ paymentId: "pay-cookie", rawPayload: {}, status: "charged_back" });
    expect(await licensing.getEntitlementFromCookieValue(cookie)).toEqual({ licensed: false });

    licensing.resetLicensingStateForTests();
    expect(await licensing.getEntitlementFromCookieValue(cookie)).toEqual({ licensed: false });
  });
});
