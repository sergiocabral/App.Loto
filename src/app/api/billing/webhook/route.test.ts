import { beforeEach, describe, expect, it, vi } from "vitest";

const billingMocks = vi.hoisted(() => ({
  fetchPayment: vi.fn(),
  getPassPlans: vi.fn(() => ({
    lifetime: { days: null, plan: "lifetime", priceBRL: 50, title: "Vitalício" },
    pass30: { days: 30, plan: "pass30", priceBRL: 10, title: "30 dias" },
  })),
  isPaymentAmountValid: vi.fn(() => true),
  parsePassPlan: vi.fn((value: unknown) => (value === "pass30" || value === "lifetime" ? value : null)),
  verifyWebhookSignature: vi.fn(() => true),
}));

const licensingMocks = vi.hoisted(() => ({
  applyApprovedPayment: vi.fn(),
  applyRevokedPayment: vi.fn(),
  issueAccessToken: vi.fn(),
}));

const mailerMocks = vi.hoisted(() => ({
  sendAccessLinkEmail: vi.fn(),
}));

vi.mock("@/lib/server/billing", () => billingMocks);
vi.mock("@/lib/server/licensing", () => licensingMocks);
vi.mock("@/lib/server/mailer", () => mailerMocks);

import { POST } from "@/app/api/billing/webhook/route";

function webhookRequest(options: {
  body?: unknown;
  dataIdInQuery?: string;
  signature?: string;
} = {}): Request {
  const url = new URL("https://luckygames.tips/api/billing/webhook");

  if (options.dataIdInQuery) {
    url.searchParams.set("data.id", options.dataIdInQuery);
  }

  return new Request(url, {
    body: JSON.stringify(options.body ?? { type: "payment", data: { id: "pay-1" } }),
    headers: {
      "content-type": "application/json",
      "x-request-id": "req-1",
      "x-signature": options.signature ?? "ts=123,v1=abc",
    },
    method: "POST",
  });
}

const APPROVED_PAYMENT = {
  externalReference: "42",
  id: "pay-1",
  metadataPlan: "pass30",
  payerEmail: "buyer@example.com",
  status: "approved",
  transactionAmount: 10,
};

describe("POST /api/billing/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    billingMocks.verifyWebhookSignature.mockReturnValue(true);
    billingMocks.isPaymentAmountValid.mockReturnValue(true);
    billingMocks.fetchPayment.mockResolvedValue(APPROVED_PAYMENT);
    licensingMocks.applyApprovedPayment.mockResolvedValue({
      applied: true,
      license: { email: "buyer@example.com", id: 42, plan: "pass30", status: "active" },
    });
    licensingMocks.applyRevokedPayment.mockResolvedValue({ revokedLicenseId: 42 });
    licensingMocks.issueAccessToken.mockResolvedValue("raw-token");
    mailerMocks.sendAccessLinkEmail.mockResolvedValue(true);
  });

  it("rejects invalid signatures with 401", async () => {
    billingMocks.verifyWebhookSignature.mockReturnValue(false);

    const response = await POST(webhookRequest());

    expect(response.status).toBe(401);
    expect(billingMocks.fetchPayment).not.toHaveBeenCalled();
  });

  it("activates the license and sends the activation e-mail on approved payments", async () => {
    const response = await POST(webhookRequest({ dataIdInQuery: "pay-1" }));

    expect(response.status).toBe(200);
    expect(billingMocks.fetchPayment).toHaveBeenCalledWith("pay-1");
    expect(licensingMocks.applyApprovedPayment).toHaveBeenCalledWith({
      amount: 10,
      email: "buyer@example.com",
      licenseId: 42,
      paymentId: "pay-1",
      plan: "pass30",
      rawPayload: { status: "approved" },
    });
    expect(licensingMocks.issueAccessToken).toHaveBeenCalledWith(42, "activation");
    expect(mailerMocks.sendAccessLinkEmail).toHaveBeenCalledWith({
      kind: "activation",
      plan: "pass30",
      to: "buyer@example.com",
      token: "raw-token",
    });
  });

  it("stays 200 when the payment was already processed or the e-mail fails", async () => {
    licensingMocks.applyApprovedPayment.mockResolvedValueOnce({ applied: false, license: null });
    const replay = await POST(webhookRequest());
    expect(replay.status).toBe(200);
    expect(licensingMocks.issueAccessToken).not.toHaveBeenCalled();

    mailerMocks.sendAccessLinkEmail.mockResolvedValueOnce(false);
    const emailFailed = await POST(webhookRequest());
    expect(emailFailed.status).toBe(200);

    mailerMocks.sendAccessLinkEmail.mockRejectedValueOnce(new Error("smtp down"));
    const emailThrew = await POST(webhookRequest());
    expect(emailThrew.status).toBe(200);
  });

  it("ignores non-payment topics, missing ids, unknown statuses and bad amounts", async () => {
    const otherTopic = await POST(webhookRequest({ body: { type: "test", data: { id: "x" } } }));
    expect(otherTopic.status).toBe(200);
    expect(billingMocks.fetchPayment).not.toHaveBeenCalled();

    const missingId = await POST(webhookRequest({ body: { type: "payment" } }));
    expect(missingId.status).toBe(200);

    billingMocks.fetchPayment.mockResolvedValueOnce({ ...APPROVED_PAYMENT, status: "pending" });
    const pending = await POST(webhookRequest());
    expect(pending.status).toBe(200);
    expect(licensingMocks.applyApprovedPayment).not.toHaveBeenCalled();

    billingMocks.isPaymentAmountValid.mockReturnValueOnce(false);
    const badAmount = await POST(webhookRequest());
    expect(badAmount.status).toBe(200);
    expect(licensingMocks.applyApprovedPayment).not.toHaveBeenCalled();
  });

  it("acknowledges non-payment topics with 200 even when the signature is invalid", async () => {
    billingMocks.verifyWebhookSignature.mockReturnValue(false);

    const response = await POST(webhookRequest({ body: { type: "merchant_order", data: { id: "mo-1" } } }));

    expect(response.status).toBe(200);
    expect(billingMocks.verifyWebhookSignature).not.toHaveBeenCalled();
    expect(billingMocks.fetchPayment).not.toHaveBeenCalled();
  });

  it("infers the plan from the amount when metadata is missing", async () => {
    billingMocks.fetchPayment.mockResolvedValueOnce({
      ...APPROVED_PAYMENT,
      metadataPlan: null,
      transactionAmount: 50,
    });

    await POST(webhookRequest());

    expect(licensingMocks.applyApprovedPayment).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "lifetime" }),
    );

    billingMocks.fetchPayment.mockResolvedValueOnce({
      ...APPROVED_PAYMENT,
      metadataPlan: null,
      transactionAmount: 3,
    });
    await POST(webhookRequest());
    expect(licensingMocks.applyApprovedPayment).toHaveBeenCalledTimes(1);
  });

  it("revokes licenses on refunds and returns 500 on processing errors", async () => {
    billingMocks.fetchPayment.mockResolvedValueOnce({ ...APPROVED_PAYMENT, status: "refunded" });
    const refunded = await POST(webhookRequest());
    expect(refunded.status).toBe(200);
    expect(licensingMocks.applyRevokedPayment).toHaveBeenCalledWith({
      paymentId: "pay-1",
      rawPayload: { status: "refunded" },
      status: "refunded",
    });

    billingMocks.fetchPayment.mockRejectedValueOnce(new Error("mp down"));
    const failed = await POST(webhookRequest());
    expect(failed.status).toBe(500);
  });
});
