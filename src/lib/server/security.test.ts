import { describe, expect, it } from "vitest";

function requestWithHeaders(headers: HeadersInit = {}) {
  return new Request("http://localhost/api/lotteries/MegaSena", { headers });
}

describe("server security helpers", () => {
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
});
