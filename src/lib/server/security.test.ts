import { afterEach, describe, expect, it, vi } from "vitest";

function requestWithHeaders(headers: HeadersInit = {}) {
  return new Request("http://localhost/api/lotteries/MegaSena", { headers });
}

describe("server security helpers", () => {
  afterEach(async () => {
    vi.useRealTimers();
    const { resetSecurityRateLimitsForTests } = await import("@/lib/server/security");
    resetSecurityRateLimitsForTests();
  });

  it("parses only strict positive safe integers within the configured maximum", async () => {
    const { parsePositiveInteger } = await import("@/lib/server/security");

    expect(parsePositiveInteger("123")).toBe(123);
    expect(parsePositiveInteger(123)).toBe(123);
    expect(parsePositiveInteger("00123")).toBe(123);
    expect(parsePositiveInteger("123abc")).toBeNull();
    expect(parsePositiveInteger("1.5")).toBeNull();
    expect(parsePositiveInteger(1.5)).toBeNull();
    expect(parsePositiveInteger("0")).toBeNull();
    expect(parsePositiveInteger("1000001")).toBeNull();
    expect(parsePositiveInteger("26", 25)).toBeNull();
    expect(parsePositiveInteger(null)).toBeNull();
    expect(parsePositiveInteger(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
  });

  it("redacts credentials from text and nested log details", async () => {
    const { getSafeErrorDetails, redactSensitiveText } = await import("@/lib/server/security");
    const secretText =
      "Authorization: Bearer secret-token-with-more-than-20-chars password=hunter2 " +
      "postgres://app:database-password@example.test/db sk-abcdefghijklmnop";

    expect(redactSensitiveText(secretText)).toBe(
      "Authorization: Bearer [redacted] password=[redacted] " +
        "postgres://app:[redacted]@example.test/db sk-[redacted]",
    );

    const nested = getSafeErrorDetails({
      apiKey: "secret-key",
      list: ["token=very-secret", 2, null, true, { password: "hidden", safe: "value" }],
      nested: { one: { two: { three: { four: "hidden" } } } },
      other: undefined,
    });

    expect(nested).toEqual({
      apiKey: "[redacted]",
      list: ["token=[redacted]", 2, null, true, { password: "[redacted]", safe: "value" }],
      nested: { one: { two: "[object]" } },
      other: undefined,
    });

    const error = new Error("token=plain-secret");
    error.name = "password=hunter2";
    expect(getSafeErrorDetails(error, { includeStack: true })).toMatchObject({
      message: "token=[redacted]",
      name: "password=[redacted]",
      stack: expect.not.stringContaining("plain-secret"),
    });
  });

  it("reads JSON object bodies and rejects invalid payloads", async () => {
    const { readJsonObjectBody } = await import("@/lib/server/security");

    await expect(
      readJsonObjectBody(
        new Request("http://localhost/api", {
          body: JSON.stringify({ action: "sync-caixa" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      ),
    ).resolves.toEqual({ ok: true, body: { action: "sync-caixa" } });

    await expect(
      readJsonObjectBody(
        new Request("http://localhost/api", {
          body: "",
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      ),
    ).resolves.toEqual({ ok: true, body: {} });

    await expect(
      readJsonObjectBody(
        new Request("http://localhost/api", {
          body: "[]",
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      ),
    ).resolves.toMatchObject({ ok: false, status: 400 });

    await expect(
      readJsonObjectBody(
        new Request("http://localhost/api", {
          body: JSON.stringify({ filler: "x".repeat(5000) }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      ),
    ).resolves.toMatchObject({ ok: false, status: 413 });

    await expect(
      readJsonObjectBody(
        new Request("http://localhost/api", {
          body: "{}",
          method: "POST",
        }),
      ),
    ).resolves.toEqual({ ok: false, status: 415, error: "Content-Type must be application/json" });

    await expect(
      readJsonObjectBody(
        new Request("http://localhost/api", {
          body: "{}",
          headers: { "content-length": "999", "content-type": "application/json" },
          method: "POST",
        }),
        10,
      ),
    ).resolves.toEqual({ ok: false, status: 413, error: "Request body is too large" });

    await expect(
      readJsonObjectBody(
        new Request("http://localhost/api", {
          body: "not-json",
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      ),
    ).resolves.toEqual({ ok: false, status: 400, error: "Invalid JSON body" });
  });

  it("rate limits mutation requests by client IP and scope", async () => {
    const { checkMutationRateLimit, resetSecurityRateLimitsForTests } = await import("@/lib/server/security");
    resetSecurityRateLimitsForTests();

    let result = checkMutationRateLimit(requestWithHeaders({ "x-real-ip": "203.0.113.30" }), "MegaSena");

    for (let index = 1; index < 30; index += 1) {
      result = checkMutationRateLimit(requestWithHeaders({ "x-real-ip": "203.0.113.30" }), "MegaSena");
      expect(result).toEqual({ ok: true });
    }

    expect(result).toEqual({ ok: true });
    expect(checkMutationRateLimit(requestWithHeaders({ "x-real-ip": "203.0.113.30" }), "MegaSena")).toEqual({
      ok: false,
      status: 429,
      error: "Too many mutation requests",
    });
    expect(checkMutationRateLimit(requestWithHeaders({ "x-real-ip": "203.0.113.30" }), "Quina")).toEqual({ ok: true });
  });

  it("uses the documented client IP precedence and resets expired buckets", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { checkMutationRateLimit } = await import("@/lib/server/security");
    const headers = {
      "cf-connecting-ip": "198.51.100.1",
      "x-forwarded-for": "198.51.100.3, 198.51.100.4",
      "x-real-ip": "198.51.100.2",
    };

    expect(checkMutationRateLimit(requestWithHeaders(headers), "sync")).toEqual({ ok: true });
    expect(checkMutationRateLimit(requestWithHeaders({ "cf-connecting-ip": "198.51.100.1" }), "sync")).toEqual({ ok: true });
    expect(checkMutationRateLimit(requestWithHeaders({ "x-forwarded-for": "198.51.100.3" }), "sync")).toEqual({ ok: true });
    expect(checkMutationRateLimit(requestWithHeaders(), "sync")).toEqual({ ok: true });

    vi.advanceTimersByTime(60_000);
    expect(checkMutationRateLimit(requestWithHeaders(headers), "sync")).toEqual({ ok: true });
  });

  it("applies scoped rate limits per identifier, scope, limit and window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { checkScopedRateLimit, resetSecurityRateLimitsForTests } = await import("@/lib/server/security");
    resetSecurityRateLimitsForTests();

    expect(checkScopedRateLimit("user@example.com", "request-link", 2, 3_600_000)).toEqual({ ok: true });
    expect(checkScopedRateLimit("user@example.com", "request-link", 2, 3_600_000)).toEqual({ ok: true });
    expect(checkScopedRateLimit("user@example.com", "request-link", 2, 3_600_000)).toEqual({
      ok: false,
      status: 429,
      error: "Too many requests",
    });
    expect(checkScopedRateLimit("other@example.com", "request-link", 2, 3_600_000)).toEqual({ ok: true });
    expect(checkScopedRateLimit("user@example.com", "other-scope", 2, 3_600_000)).toEqual({ ok: true });

    vi.advanceTimersByTime(3_600_000);
    expect(checkScopedRateLimit("user@example.com", "request-link", 2, 3_600_000)).toEqual({ ok: true });
  });

  it("exposes the client IP resolution used by rate limiting", async () => {
    const { getClientIp } = await import("@/lib/server/security");

    expect(getClientIp(requestWithHeaders({ "cf-connecting-ip": "198.51.100.1", "x-real-ip": "198.51.100.2" }))).toBe(
      "198.51.100.1",
    );
    expect(getClientIp(requestWithHeaders({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(getClientIp(requestWithHeaders({ "x-forwarded-for": "198.51.100.3, 198.51.100.4" }))).toBe("198.51.100.3");
    expect(getClientIp(requestWithHeaders())).toBe("unknown");
  });

  it("normalizes and validates e-mail addresses", async () => {
    const { parseEmail } = await import("@/lib/server/security");

    expect(parseEmail("  User@Example.COM ")).toBe("user@example.com");
    expect(parseEmail("user+tag@sub.example.co")).toBe("user+tag@sub.example.co");
    expect(parseEmail("")).toBeNull();
    expect(parseEmail("   ")).toBeNull();
    expect(parseEmail("no-at-sign.example.com")).toBeNull();
    expect(parseEmail("user@")).toBeNull();
    expect(parseEmail("user@-bad.com")).toBeNull();
    expect(parseEmail("user@domain")).toBeNull();
    expect(parseEmail(`${"a".repeat(250)}@example.com`)).toBeNull();
    expect(parseEmail(123)).toBeNull();
    expect(parseEmail(null)).toBeNull();
  });
});
