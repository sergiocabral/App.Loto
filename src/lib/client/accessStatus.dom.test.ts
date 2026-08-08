import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ACCESS_STATUS, fetchAccessStatus, formatPriceBRL } from "@/lib/client/accessStatus";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("access status client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes a licensed status payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          chat: { limit: 100, used: 4 },
          expiresAt: "2026-09-07T12:00:00.000Z",
          licensed: true,
          plan: "pass30",
          plans: { lifetime: { priceBRL: 60 }, pass30: { priceBRL: 12 } },
        }),
      ),
    );

    await expect(fetchAccessStatus()).resolves.toEqual({
      chat: { limit: 100, used: 4 },
      expiresAt: "2026-09-07T12:00:00.000Z",
      licensed: true,
      plan: "pass30",
      plans: { lifetime: { priceBRL: 60 }, pass30: { priceBRL: 12 } },
    });
  });

  it("falls back to the anonymous default on failures and malformed payloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(fetchAccessStatus()).resolves.toEqual(DEFAULT_ACCESS_STATUS);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 500 })));
    await expect(fetchAccessStatus()).resolves.toEqual(DEFAULT_ACCESS_STATUS);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ licensed: "yes", plans: null, chat: null })));
    await expect(fetchAccessStatus()).resolves.toEqual({
      chat: { limit: 3, used: 0 },
      expiresAt: null,
      licensed: false,
      plans: DEFAULT_ACCESS_STATUS.plans,
    });
  });

  it("formats prices in BRL", () => {
    expect(formatPriceBRL(10).replace(/ /g, " ")).toBe("R$ 10,00");
    expect(formatPriceBRL(59.9).replace(/ /g, " ")).toBe("R$ 59,90");
  });
});
