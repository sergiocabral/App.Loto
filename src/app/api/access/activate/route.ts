import { buildAccessSetCookieHeader, signAccessCookie } from "@/lib/server/accessCookie";
import { getAccessCookieSecret } from "@/lib/server/env";
import { consumeAccessToken, isLicenseUsable } from "@/lib/server/licensing";
import { getSafeErrorDetails } from "@/lib/server/security";
import { getOfficialSiteUrl } from "@/lib/siteUrl";

export const dynamic = "force-dynamic";

const ACCESS_LOG_PREFIX = "[app-loto-next][access]";

const ACCESS_COOKIE_FALLBACK_TTL_SECONDS = 400 * 24 * 60 * 60;

function redirectResponse(request: Request, result: "ativado" | "invalido", setCookie?: string): Response {
  const requestUrl = new URL(request.url);
  const isLocal = requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1";
  const baseUrl = isLocal ? `${requestUrl.protocol}//${requestUrl.host}/` : getOfficialSiteUrl();
  const target = new URL(`/?acesso=${result}`, baseUrl);
  const headers = new Headers({
    "Cache-Control": "no-store",
    Location: target.toString(),
  });

  if (setCookie) {
    headers.append("Set-Cookie", setCookie);
  }

  return new Response(null, { headers, status: 303 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim();
  const secret = getAccessCookieSecret();

  if (!token || !secret) {
    console.warn(ACCESS_LOG_PREFIX, "activate:missing-token-or-secret", {
      hasSecret: Boolean(secret),
      hasToken: Boolean(token),
    });
    return redirectResponse(request, "invalido");
  }

  try {
    const license = await consumeAccessToken(token);

    if (!isLicenseUsable(license)) {
      console.info(ACCESS_LOG_PREFIX, "activate:invalid-token-or-license");
      return redirectResponse(request, "invalido");
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const expSeconds = license.expiresAt
      ? Math.floor(license.expiresAt.getTime() / 1000)
      : nowSeconds + ACCESS_COOKIE_FALLBACK_TTL_SECONDS;
    const cookieValue = signAccessCookie(
      {
        email: license.email,
        exp: expSeconds,
        iat: nowSeconds,
        lid: license.id,
        plan: license.plan,
        v: 1,
      },
      secret,
    );
    const maxAgeSeconds = Math.max(expSeconds - nowSeconds, 0);
    const isLocalRequest = url.hostname === "localhost" || url.hostname === "127.0.0.1";

    console.info(ACCESS_LOG_PREFIX, "activate:success", { licenseId: license.id, plan: license.plan });
    return redirectResponse(
      request,
      "ativado",
      buildAccessSetCookieHeader(cookieValue, { maxAgeSeconds, secure: !isLocalRequest }),
    );
  } catch (error) {
    console.error(ACCESS_LOG_PREFIX, "activate:error", { error: getSafeErrorDetails(error) });
    return redirectResponse(request, "invalido");
  }
}
