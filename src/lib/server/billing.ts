import { createHmac, timingSafeEqual } from "node:crypto";
import { getMercadoPagoConfig, getPassPricing } from "@/lib/server/env";
import type { LicensePlan } from "@/lib/server/licensing";
import { getOfficialSiteUrl } from "@/lib/siteUrl";

const BILLING_LOG_PREFIX = "[app-loto-next][billing]";

const WEBHOOK_TS_TOLERANCE_SECONDS = 5 * 60;

export type PassPlanDefinition = {
  days: number | null;
  plan: LicensePlan;
  priceBRL: number;
  title: string;
};

export function getPassPlans(): Record<LicensePlan, PassPlanDefinition> {
  const pricing = getPassPricing();

  return {
    lifetime: {
      days: null,
      plan: "lifetime",
      priceBRL: pricing.lifetimePriceBRL,
      title: "Luckygames — Passe vitalício",
    },
    pass30: {
      days: 30,
      plan: "pass30",
      priceBRL: pricing.pass30PriceBRL,
      title: "Luckygames — Passe de 30 dias",
    },
  };
}

export function parsePassPlan(value: unknown): LicensePlan | null {
  return value === "pass30" || value === "lifetime" ? value : null;
}

export class MercadoPagoRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MercadoPagoRequestError";
    this.status = status;
  }
}

type MercadoPagoApiOptions = {
  fetchImpl?: typeof fetch;
};

async function mercadoPagoRequest<T>(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  options: MercadoPagoApiOptions = {},
): Promise<T> {
  const config = getMercadoPagoConfig();

  if (!config) {
    throw new MercadoPagoRequestError("Mercado Pago não está configurado.", 503);
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${config.apiBaseUrl}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    method,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    console.error(BILLING_LOG_PREFIX, "mercado-pago-request-failed", {
      path,
      status: response.status,
      // O corpo descreve o erro da NOSSA requisição; fica só no log do servidor.
      body: errorBody.slice(0, 500),
    });
    throw new MercadoPagoRequestError("O Mercado Pago não conseguiu processar a solicitação.", response.status);
  }

  return (await response.json()) as T;
}

type CreateCheckoutInput = {
  email: string;
  licenseId: number;
  plan: LicensePlan;
};

export async function createCheckoutPreference(
  input: CreateCheckoutInput,
  options: MercadoPagoApiOptions = {},
): Promise<{ initPoint: string; preferenceId: string }> {
  const planDefinition = getPassPlans()[input.plan];
  const siteUrl = getOfficialSiteUrl();
  const body = {
    back_urls: {
      failure: new URL("/?compra=falha", siteUrl).toString(),
      pending: new URL("/?compra=pendente", siteUrl).toString(),
      success: new URL("/?compra=sucesso", siteUrl).toString(),
    },
    auto_return: "approved",
    external_reference: String(input.licenseId),
    items: [
      {
        id: input.plan,
        currency_id: "BRL",
        quantity: 1,
        title: planDefinition.title,
        unit_price: planDefinition.priceBRL,
      },
    ],
    metadata: { plan: input.plan },
    notification_url: new URL("/api/billing/webhook", siteUrl).toString(),
    payer: { email: input.email },
  };

  const response = await mercadoPagoRequest<{ id: string; init_point?: string }>(
    "POST",
    "/checkout/preferences",
    body,
    options,
  );

  if (!response.init_point) {
    throw new MercadoPagoRequestError("O Mercado Pago não retornou a página de pagamento.", 502);
  }

  return { initPoint: response.init_point, preferenceId: String(response.id) };
}

export type MercadoPagoPayment = {
  externalReference: string | null;
  id: string;
  metadataPlan: LicensePlan | null;
  payerEmail: string | null;
  status: string;
  transactionAmount: number | null;
};

export async function fetchPayment(paymentId: string, options: MercadoPagoApiOptions = {}): Promise<MercadoPagoPayment> {
  const response = await mercadoPagoRequest<{
    external_reference?: string;
    id: number | string;
    metadata?: { plan?: string };
    payer?: { email?: string };
    status?: string;
    transaction_amount?: number;
  }>("GET", `/v1/payments/${encodeURIComponent(paymentId)}`, undefined, options);

  return {
    externalReference:
      typeof response.external_reference === "string" && response.external_reference.length > 0
        ? response.external_reference
        : null,
    id: String(response.id),
    metadataPlan: parsePassPlan(response.metadata?.plan),
    payerEmail: typeof response.payer?.email === "string" ? response.payer.email : null,
    status: response.status ?? "",
    transactionAmount: typeof response.transaction_amount === "number" ? response.transaction_amount : null,
  };
}

export function isPaymentAmountValid(payment: MercadoPagoPayment, plan: LicensePlan): boolean {
  const expected = getPassPlans()[plan].priceBRL;
  return payment.transactionAmount !== null && payment.transactionAmount >= expected - 0.01;
}

function parseSignatureHeader(header: string): { ts?: string; v1?: string } {
  const result: { ts?: string; v1?: string } = {};

  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2).map((piece) => piece?.trim());

    if (key === "ts" && value) {
      result.ts = value;
    }

    if (key === "v1" && value) {
      result.v1 = value;
    }
  }

  return result;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}

export function computeWebhookManifestHmac(input: {
  dataId?: string;
  requestId?: string;
  secret: string;
  ts: string;
}): string {
  const parts: string[] = [];

  if (input.dataId) {
    parts.push(`id:${input.dataId}`);
  }

  if (input.requestId) {
    parts.push(`request-id:${input.requestId}`);
  }

  parts.push(`ts:${input.ts}`);
  return createHmac("sha256", input.secret).update(`${parts.join(";")};`).digest("hex");
}

type VerifyWebhookInput = {
  dataId: string | null;
  requestId: string | null;
  signatureHeader: string | null;
  now?: () => number;
};

export function verifyWebhookSignature(input: VerifyWebhookInput): boolean {
  const config = getMercadoPagoConfig();

  if (!config?.webhookSecret || !input.signatureHeader) {
    return false;
  }

  const { ts, v1 } = parseSignatureHeader(input.signatureHeader);

  if (!ts || !v1 || !/^\d+$/.test(ts)) {
    return false;
  }

  const computed = computeWebhookManifestHmac({
    dataId: input.dataId ?? undefined,
    requestId: input.requestId ?? undefined,
    secret: config.webhookSecret,
    ts,
  });

  if (!constantTimeEquals(computed, v1)) {
    return false;
  }

  const nowMs = (input.now ?? Date.now)();
  const driftSeconds = Math.abs(nowMs - Number(ts) * 1000) / 1000;
  return driftSeconds <= WEBHOOK_TS_TOLERANCE_SECONDS;
}
