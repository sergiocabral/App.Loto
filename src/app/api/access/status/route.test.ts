import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const licensingMocks = vi.hoisted(() => ({
  getChatUsage: vi.fn(),
  getEntitlementFromCookieValue: vi.fn(),
  getSaoPauloDateString: vi.fn(() => "2026-08-08"),
}));

vi.mock("@/lib/server/licensing", () => licensingMocks);

import { GET } from "@/app/api/access/status/route";
import { buildFreeChatQuotaSetCookieHeader } from "@/lib/server/chatQuota";

const SECRET = "status-route-secret-with-32-chars!!!";

function statusRequest(cookieHeader?: string): Request {
  return new Request("https://luckygames.tips/api/access/status", {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    method: "GET",
  });
}

describe("GET /api/access/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ACCESS_COOKIE_SECRET = SECRET;
    licensingMocks.getEntitlementFromCookieValue.mockResolvedValue({ licensed: false });
    licensingMocks.getChatUsage.mockResolvedValue(12);
    licensingMocks.getSaoPauloDateString.mockReturnValue("2026-08-08");
  });

  afterEach(() => {
    delete process.env.ACCESS_COOKIE_SECRET;
  });

  it("reports the anonymous state with the free chat quota", async () => {
    const response = await GET(statusRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      chat: { limit: 3, used: 0 },
      licensed: false,
      plans: { lifetime: { priceBRL: 50 }, pass30: { priceBRL: 10 } },
    });
  });

  it("includes the free quota already spent from the signed cookie", async () => {
    const header = buildFreeChatQuotaSetCookieHeader(
      { count: 2, date: (await import("@/lib/server/licensing")).getSaoPauloDateString() },
      { secure: false },
    );
    const cookieValue = header!.split(";")[0];

    const response = await GET(statusRequest(cookieValue));

    await expect(response.json()).resolves.toEqual({
      chat: { limit: 3, used: 2 },
      licensed: false,
      plans: { lifetime: { priceBRL: 50 }, pass30: { priceBRL: 10 } },
    });
  });

  it("reports plan, expiry and premium chat usage for licensed users", async () => {
    const expiresAt = new Date("2026-09-07T12:00:00Z");
    licensingMocks.getEntitlementFromCookieValue.mockResolvedValue({
      email: "user@example.com",
      expiresAt,
      licensed: true,
      licenseId: 7,
      plan: "pass30",
    });

    const response = await GET(statusRequest("lg_access=any"));

    await expect(response.json()).resolves.toEqual({
      chat: { limit: 100, used: 12 },
      expiresAt: expiresAt.toISOString(),
      licensed: true,
      plan: "pass30",
      plans: { lifetime: { priceBRL: 50 }, pass30: { priceBRL: 10 } },
    });
    expect(licensingMocks.getChatUsage).toHaveBeenCalledWith(7, "2026-08-08");
  });

  it("handles lifetime plans and chat usage lookup failures", async () => {
    licensingMocks.getEntitlementFromCookieValue.mockResolvedValue({
      email: "vip@example.com",
      expiresAt: null,
      licensed: true,
      licenseId: 9,
      plan: "lifetime",
    });
    licensingMocks.getChatUsage.mockRejectedValueOnce(new Error("db down"));

    const response = await GET(statusRequest("lg_access=any"));

    await expect(response.json()).resolves.toEqual({
      chat: { limit: 100, used: 0 },
      expiresAt: null,
      licensed: true,
      plan: "lifetime",
      plans: { lifetime: { priceBRL: 50 }, pass30: { priceBRL: 10 } },
    });
  });

  it("fails closed to the anonymous state on unexpected errors", async () => {
    licensingMocks.getEntitlementFromCookieValue.mockRejectedValueOnce(new Error("boom"));

    const response = await GET(statusRequest("lg_access=any"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      chat: { limit: 3, used: 0 },
      licensed: false,
      plans: { lifetime: { priceBRL: 50 }, pass30: { priceBRL: 10 } },
    });
  });
});
