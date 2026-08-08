import { beforeEach, describe, expect, it, vi } from "vitest";

const billingMocks = vi.hoisted(() => ({
  createCheckoutPreference: vi.fn(),
  parsePassPlan: vi.fn((value: unknown) => (value === "pass30" || value === "lifetime" ? value : null)),
}));

const licensingMocks = vi.hoisted(() => ({
  upsertPendingLicense: vi.fn(),
}));

const { MercadoPagoRequestError } = vi.hoisted(() => {
  class MercadoPagoRequestError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = "MercadoPagoRequestError";
      this.status = status;
    }
  }

  return { MercadoPagoRequestError };
});

vi.mock("@/lib/server/billing", () => ({
  MercadoPagoRequestError,
  createCheckoutPreference: billingMocks.createCheckoutPreference,
  parsePassPlan: billingMocks.parsePassPlan,
}));

vi.mock("@/lib/server/licensing", () => licensingMocks);

import { POST } from "@/app/api/billing/checkout/route";
import { resetSecurityRateLimitsForTests } from "@/lib/server/security";

function checkoutRequest(body: unknown, ip = "203.0.113.1"): Request {
  return new Request("https://luckygames.tips/api/billing/checkout", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-real-ip": ip },
    method: "POST",
  });
}

describe("POST /api/billing/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSecurityRateLimitsForTests();
    licensingMocks.upsertPendingLicense.mockResolvedValue({ id: 42, email: "buyer@example.com", plan: "pass30" });
    billingMocks.createCheckoutPreference.mockResolvedValue({ initPoint: "https://mp/init", preferenceId: "pref" });
  });

  it("creates a pending license and returns the checkout init point", async () => {
    const response = await POST(checkoutRequest({ email: " Buyer@Example.com ", plan: "pass30" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ initPoint: "https://mp/init" });
    expect(licensingMocks.upsertPendingLicense).toHaveBeenCalledWith("buyer@example.com", "pass30");
    expect(billingMocks.createCheckoutPreference).toHaveBeenCalledWith({
      email: "buyer@example.com",
      licenseId: 42,
      plan: "pass30",
    });
  });

  it("rejects invalid e-mails, plans and non-json bodies", async () => {
    const badEmail = await POST(checkoutRequest({ email: "not-an-email", plan: "pass30" }));
    expect(badEmail.status).toBe(400);

    const badPlan = await POST(checkoutRequest({ email: "buyer@example.com", plan: "gold" }));
    expect(badPlan.status).toBe(400);

    const badBody = await POST(
      new Request("https://luckygames.tips/api/billing/checkout", {
        body: "x",
        headers: { "content-type": "text/plain" },
        method: "POST",
      }),
    );
    expect(badBody.status).toBe(415);
    expect(licensingMocks.upsertPendingLicense).not.toHaveBeenCalled();
  });

  it("maps configuration and provider failures to 503 and 502", async () => {
    billingMocks.createCheckoutPreference.mockRejectedValueOnce(new MercadoPagoRequestError("off", 503));
    const unavailable = await POST(checkoutRequest({ email: "buyer@example.com", plan: "pass30" }));
    expect(unavailable.status).toBe(503);

    billingMocks.createCheckoutPreference.mockRejectedValueOnce(new MercadoPagoRequestError("bad", 400));
    const failed = await POST(checkoutRequest({ email: "buyer@example.com", plan: "pass30" }));
    expect(failed.status).toBe(502);

    licensingMocks.upsertPendingLicense.mockRejectedValueOnce(new Error("db down"));
    const dbDown = await POST(checkoutRequest({ email: "buyer@example.com", plan: "pass30" }));
    expect(dbDown.status).toBe(502);
  });

  it("applies the mutation rate limit per client IP", async () => {
    for (let index = 0; index < 30; index += 1) {
      const response = await POST(checkoutRequest({ email: "buyer@example.com", plan: "pass30" }, "203.0.113.9"));
      expect(response.status).toBe(200);
    }

    const limited = await POST(checkoutRequest({ email: "buyer@example.com", plan: "pass30" }, "203.0.113.9"));
    expect(limited.status).toBe(429);
  });
});
