import { createCheckoutPreference, MercadoPagoRequestError, parsePassPlan } from "@/lib/server/billing";
import { upsertPendingLicense } from "@/lib/server/licensing";
import {
  checkMutationRateLimit,
  getSafeErrorDetails,
  parseEmail,
  readJsonObjectBody,
} from "@/lib/server/security";

export const dynamic = "force-dynamic";

const CHECKOUT_LOG_PREFIX = "[app-loto-next][billing]";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
    status,
  });
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  const rateLimit = checkMutationRateLimit(request, "billing-checkout");

  if (!rateLimit.ok) {
    return jsonResponse({ error: rateLimit.error }, rateLimit.status);
  }

  const bodyResult = await readJsonObjectBody(request);

  if (!bodyResult.ok) {
    return jsonResponse({ error: bodyResult.error }, bodyResult.status);
  }

  const email = parseEmail(bodyResult.body.email);
  const plan = parsePassPlan(bodyResult.body.plan);

  if (!email || !plan) {
    return jsonResponse({ error: "Informe um e-mail válido e um plano suportado." }, 400);
  }

  try {
    const license = await upsertPendingLicense(email, plan);
    const checkout = await createCheckoutPreference({ email, licenseId: license.id, plan });

    console.info(CHECKOUT_LOG_PREFIX, "checkout:created", {
      elapsedMs: Date.now() - startedAt,
      licenseId: license.id,
      plan,
    });

    return jsonResponse({ initPoint: checkout.initPoint });
  } catch (error) {
    if (error instanceof MercadoPagoRequestError && error.status === 503) {
      console.warn(CHECKOUT_LOG_PREFIX, "checkout:not-configured");
      return jsonResponse({ error: "Pagamentos indisponíveis no momento." }, 503);
    }

    console.error(CHECKOUT_LOG_PREFIX, "checkout:error", {
      elapsedMs: Date.now() - startedAt,
      error: getSafeErrorDetails(error),
    });
    return jsonResponse({ error: "Não foi possível iniciar o pagamento agora." }, 502);
  }
}
