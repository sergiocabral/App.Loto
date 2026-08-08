import { afterEach, describe, expect, it, vi } from "vitest";
import { computeWebhookManifestHmac } from "@/lib/server/billing";

const originalEnvironment = { ...process.env };

function setMercadoPagoEnvironment(): void {
  process.env.MP_ACCESS_TOKEN = "TEST-token";
  process.env.MP_WEBHOOK_SECRET = "webhook-secret";
  process.env.MP_API_BASE_URL = "https://mp.example.test";
  process.env.OFFICIAL_DOMAIN_NAME = "luckygames.tips";
  process.env.PASS_PRICE_30D_BRL = "10";
  process.env.PASS_PRICE_LIFETIME_BRL = "50";
}

async function loadBilling() {
  vi.resetModules();
  return import("@/lib/server/billing");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("mercado pago billing client", () => {
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnvironment)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnvironment);
    vi.restoreAllMocks();
  });

  it("exposes plans priced from the environment", async () => {
    setMercadoPagoEnvironment();
    process.env.PASS_PRICE_30D_BRL = "12.5";
    const { getPassPlans, parsePassPlan } = await loadBilling();

    const plans = getPassPlans();
    expect(plans.pass30).toMatchObject({ days: 30, plan: "pass30", priceBRL: 12.5 });
    expect(plans.lifetime).toMatchObject({ days: null, plan: "lifetime", priceBRL: 50 });

    expect(parsePassPlan("pass30")).toBe("pass30");
    expect(parsePassPlan("lifetime")).toBe("lifetime");
    expect(parsePassPlan("gold")).toBeNull();
    expect(parsePassPlan(undefined)).toBeNull();
  });

  it("creates a checkout preference with plan, urls and external reference", async () => {
    setMercadoPagoEnvironment();
    const { createCheckoutPreference } = await loadBilling();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "pref-1", init_point: "https://mp/init" }));

    const result = await createCheckoutPreference(
      { email: "buyer@example.com", licenseId: 42, plan: "pass30" },
      { fetchImpl },
    );

    expect(result).toEqual({ initPoint: "https://mp/init", preferenceId: "pref-1" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://mp.example.test/checkout/preferences",
      expect.objectContaining({ method: "POST" }),
    );

    const request = fetchImpl.mock.calls[0][1];
    expect(request.headers.Authorization).toBe("Bearer TEST-token");
    const body = JSON.parse(request.body);
    expect(body.external_reference).toBe("42");
    expect(body.metadata).toEqual({ plan: "pass30" });
    expect(body.payer).toEqual({ email: "buyer@example.com" });
    expect(body.items[0]).toMatchObject({ currency_id: "BRL", quantity: 1, unit_price: 10 });
    expect(body.notification_url).toBe("https://luckygames.tips/api/billing/webhook");
    expect(body.back_urls.success).toBe("https://luckygames.tips/?compra=sucesso");
    expect(body.auto_return).toBe("approved");
  });

  it("raises typed errors for missing config, api failures and missing init point", async () => {
    const withoutConfig = await loadBilling();
    delete process.env.MP_ACCESS_TOKEN;

    await expect(
      withoutConfig.createCheckoutPreference({ email: "a@b.co", licenseId: 1, plan: "pass30" }),
    ).rejects.toMatchObject({ name: "MercadoPagoRequestError", status: 503 });

    setMercadoPagoEnvironment();
    const { createCheckoutPreference } = await loadBilling();

    const failing = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));
    await expect(
      createCheckoutPreference({ email: "a@b.co", licenseId: 1, plan: "pass30" }, { fetchImpl: failing }),
    ).rejects.toMatchObject({ name: "MercadoPagoRequestError", status: 400 });

    const noInitPoint = vi.fn().mockResolvedValue(jsonResponse({ id: "pref-2" }));
    await expect(
      createCheckoutPreference({ email: "a@b.co", licenseId: 1, plan: "pass30" }, { fetchImpl: noInitPoint }),
    ).rejects.toMatchObject({ name: "MercadoPagoRequestError", status: 502 });
  });

  it("fetches payments and normalizes their fields", async () => {
    setMercadoPagoEnvironment();
    const { fetchPayment, isPaymentAmountValid } = await loadBilling();
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        external_reference: "42",
        id: 123456,
        metadata: { plan: "pass30" },
        payer: { email: "buyer@example.com" },
        status: "approved",
        transaction_amount: 10,
      }),
    );

    const payment = await fetchPayment("123456", { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://mp.example.test/v1/payments/123456",
      expect.objectContaining({ method: "GET" }),
    );
    expect(payment).toEqual({
      externalReference: "42",
      id: "123456",
      metadataPlan: "pass30",
      payerEmail: "buyer@example.com",
      status: "approved",
      transactionAmount: 10,
    });
    expect(isPaymentAmountValid(payment, "pass30")).toBe(true);
    expect(isPaymentAmountValid(payment, "lifetime")).toBe(false);
    expect(isPaymentAmountValid({ ...payment, transactionAmount: null }, "pass30")).toBe(false);

    const sparse = vi.fn().mockResolvedValue(jsonResponse({ id: "789" }));
    expect(await fetchPayment("789", { fetchImpl: sparse })).toEqual({
      externalReference: null,
      id: "789",
      metadataPlan: null,
      payerEmail: null,
      status: "",
      transactionAmount: null,
    });
  });

  it("verifies webhook signatures with manifest hmac and timestamp tolerance", async () => {
    setMercadoPagoEnvironment();
    const { verifyWebhookSignature } = await loadBilling();
    const nowMs = 1_754_600_000_000;
    const ts = String(Math.floor(nowMs / 1000));
    const v1 = computeWebhookManifestHmac({
      dataId: "123456",
      requestId: "req-1",
      secret: "webhook-secret",
      ts,
    });

    const valid = verifyWebhookSignature({
      dataId: "123456",
      now: () => nowMs,
      requestId: "req-1",
      signatureHeader: `ts=${ts},v1=${v1}`,
    });
    expect(valid).toBe(true);

    expect(
      verifyWebhookSignature({
        dataId: "123456",
        now: () => nowMs,
        requestId: "req-1",
        signatureHeader: `ts=${ts},v1=${"0".repeat(v1.length)}`,
      }),
    ).toBe(false);

    expect(
      verifyWebhookSignature({
        dataId: "999999",
        now: () => nowMs,
        requestId: "req-1",
        signatureHeader: `ts=${ts},v1=${v1}`,
      }),
    ).toBe(false);

    expect(
      verifyWebhookSignature({
        dataId: "123456",
        now: () => nowMs + 6 * 60 * 1000,
        requestId: "req-1",
        signatureHeader: `ts=${ts},v1=${v1}`,
      }),
    ).toBe(false);

    expect(
      verifyWebhookSignature({ dataId: "123456", requestId: "req-1", signatureHeader: null }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({ dataId: "123456", requestId: "req-1", signatureHeader: "ts=abc,v1=zz" }),
    ).toBe(false);

    delete process.env.MP_WEBHOOK_SECRET;
    expect(
      verifyWebhookSignature({
        dataId: "123456",
        now: () => nowMs,
        requestId: "req-1",
        signatureHeader: `ts=${ts},v1=${v1}`,
      }),
    ).toBe(false);
  });

  it("accepts manifests without data id or request id", async () => {
    setMercadoPagoEnvironment();
    const { verifyWebhookSignature } = await loadBilling();
    const nowMs = 1_754_600_000_000;
    const ts = String(Math.floor(nowMs / 1000));
    const v1 = computeWebhookManifestHmac({ secret: "webhook-secret", ts });

    expect(
      verifyWebhookSignature({ dataId: null, now: () => nowMs, requestId: null, signatureHeader: `ts=${ts},v1=${v1}` }),
    ).toBe(true);
  });
});
