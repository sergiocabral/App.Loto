import {
  fetchPayment,
  getPassPlans,
  isPaymentAmountValid,
  parsePassPlan,
  verifyWebhookSignature,
  type MercadoPagoPayment,
} from "@/lib/server/billing";
import {
  applyApprovedPayment,
  applyRevokedPayment,
  issueAccessToken,
  type LicensePlan,
} from "@/lib/server/licensing";
import { sendAccessLinkEmail } from "@/lib/server/mailer";
import { getSafeErrorDetails, parseEmail, parsePositiveInteger } from "@/lib/server/security";

export const dynamic = "force-dynamic";

const WEBHOOK_LOG_PREFIX = "[app-loto-next][billing-webhook]";

const REVOKED_STATUSES = new Set(["cancelled", "charged_back", "refunded"]);

function textResponse(body: string, status = 200): Response {
  return new Response(`${body}\n`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
    status,
  });
}

function logWebhook(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.info(WEBHOOK_LOG_PREFIX, message, details);
    return;
  }

  console.info(WEBHOOK_LOG_PREFIX, message);
}

function resolvePlan(payment: MercadoPagoPayment): LicensePlan | null {
  if (payment.metadataPlan) {
    return payment.metadataPlan;
  }

  if (payment.transactionAmount === null) {
    return null;
  }

  const plans = getPassPlans();

  if (payment.transactionAmount >= plans.lifetime.priceBRL - 0.01) {
    return "lifetime";
  }

  if (payment.transactionAmount >= plans.pass30.priceBRL - 0.01) {
    return "pass30";
  }

  return null;
}

async function readWebhookPayload(request: Request): Promise<{ dataId: string | null; type: string | null }> {
  const url = new URL(request.url);
  let body: Record<string, unknown> = {};

  try {
    const text = await request.text();
    if (text.trim()) {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    }
  } catch {
    body = {};
  }

  const bodyData = body.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : {};
  const dataId =
    (typeof bodyData.id === "string" || typeof bodyData.id === "number" ? String(bodyData.id) : null) ??
    url.searchParams.get("data.id") ??
    url.searchParams.get("id");
  const type =
    (typeof body.type === "string" ? body.type : null) ??
    url.searchParams.get("type") ??
    url.searchParams.get("topic");

  return { dataId, type };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const queryDataId = url.searchParams.get("data.id") ?? url.searchParams.get("id");
  const payload = await readWebhookPayload(request);
  const dataId = payload.dataId ?? queryDataId;

  const signatureValid = verifyWebhookSignature({
    dataId: queryDataId ?? dataId,
    requestId: request.headers.get("x-request-id"),
    signatureHeader: request.headers.get("x-signature"),
  });

  if (!signatureValid) {
    logWebhook("webhook:invalid-signature", { hasSignature: Boolean(request.headers.get("x-signature")) });
    return textResponse("ERROR invalid signature", 401);
  }

  if (payload.type !== "payment") {
    logWebhook("webhook:ignored-type", { type: payload.type });
    return textResponse("OK ignored");
  }

  if (!dataId) {
    logWebhook("webhook:missing-payment-id");
    return textResponse("OK ignored");
  }

  try {
    const payment = await fetchPayment(dataId);

    if (payment.status === "approved") {
      const plan = resolvePlan(payment);

      if (!plan) {
        logWebhook("webhook:unresolved-plan", { paymentId: payment.id });
        return textResponse("OK unresolved plan");
      }

      if (!isPaymentAmountValid(payment, plan)) {
        logWebhook("webhook:amount-mismatch", {
          paymentId: payment.id,
          plan,
          transactionAmount: payment.transactionAmount,
        });
        return textResponse("OK amount mismatch");
      }

      const licenseId = payment.externalReference ? parsePositiveInteger(payment.externalReference) : null;
      const email = payment.payerEmail ? parseEmail(payment.payerEmail) : null;
      const result = await applyApprovedPayment({
        amount: payment.transactionAmount,
        email,
        licenseId,
        paymentId: payment.id,
        plan,
        rawPayload: { status: payment.status },
      });

      if (result.applied && result.license) {
        try {
          const token = await issueAccessToken(result.license.id, "activation");
          const sent = await sendAccessLinkEmail({
            kind: "activation",
            plan: result.license.plan,
            to: result.license.email,
            token,
          });

          if (!sent) {
            console.error(WEBHOOK_LOG_PREFIX, "webhook:activation-email-failed", {
              licenseId: result.license.id,
            });
          }
        } catch (error) {
          console.error(WEBHOOK_LOG_PREFIX, "webhook:activation-email-error", {
            error: getSafeErrorDetails(error),
            licenseId: result.license.id,
          });
        }
      }

      logWebhook("webhook:approved-processed", {
        applied: result.applied,
        elapsedMs: Date.now() - startedAt,
        paymentId: payment.id,
      });
      return textResponse("OK");
    }

    if (REVOKED_STATUSES.has(payment.status)) {
      const revoked = await applyRevokedPayment({
        paymentId: payment.id,
        rawPayload: { status: payment.status },
        status: payment.status,
      });
      logWebhook("webhook:revoked-processed", {
        elapsedMs: Date.now() - startedAt,
        paymentId: payment.id,
        revokedLicenseId: revoked.revokedLicenseId,
        status: payment.status,
      });
      return textResponse("OK");
    }

    logWebhook("webhook:ignored-status", { paymentId: payment.id, status: payment.status });
    return textResponse("OK ignored status");
  } catch (error) {
    console.error(WEBHOOK_LOG_PREFIX, "webhook:error", {
      elapsedMs: Date.now() - startedAt,
      error: getSafeErrorDetails(error),
      paymentId: dataId,
    });
    return textResponse("ERROR processing failed", 500);
  }
}
