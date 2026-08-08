import { getActiveLicenseByEmail, issueAccessToken } from "@/lib/server/licensing";
import { sendAccessLinkEmail } from "@/lib/server/mailer";
import {
  checkScopedRateLimit,
  getClientIp,
  getSafeErrorDetails,
  parseEmail,
  readJsonObjectBody,
} from "@/lib/server/security";

export const dynamic = "force-dynamic";

const ACCESS_LOG_PREFIX = "[app-loto-next][access]";

const IP_RATE_LIMIT = 10;
const EMAIL_RATE_LIMIT = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const GENERIC_RESPONSE = {
  message: "Se este e-mail tiver um passe ativo, enviaremos um link de acesso em instantes.",
  ok: true,
};

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
  const ipCheck = checkScopedRateLimit(getClientIp(request), "access-link-ip", IP_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);

  if (!ipCheck.ok) {
    return jsonResponse({ error: "Muitas solicitações. Tente novamente mais tarde." }, 429);
  }

  const bodyResult = await readJsonObjectBody(request);

  if (!bodyResult.ok) {
    return jsonResponse({ error: bodyResult.error }, bodyResult.status);
  }

  const email = parseEmail(bodyResult.body.email);

  if (!email) {
    return jsonResponse({ error: "Informe um e-mail válido." }, 400);
  }

  const emailCheck = checkScopedRateLimit(email, "access-link-email", EMAIL_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);

  if (!emailCheck.ok) {
    // Resposta genérica: rate limit por e-mail não deve revelar existência de licença.
    return jsonResponse(GENERIC_RESPONSE);
  }

  try {
    const license = await getActiveLicenseByEmail(email);

    if (license) {
      const token = await issueAccessToken(license.id, "login");
      const sent = await sendAccessLinkEmail({
        kind: "login",
        plan: license.plan,
        to: license.email,
        token,
      });

      console.info(ACCESS_LOG_PREFIX, "request-link:processed", { licenseId: license.id, sent });
    } else {
      console.info(ACCESS_LOG_PREFIX, "request-link:no-active-license");
    }
  } catch (error) {
    console.error(ACCESS_LOG_PREFIX, "request-link:error", { error: getSafeErrorDetails(error) });
  }

  return jsonResponse(GENERIC_RESPONSE);
}
