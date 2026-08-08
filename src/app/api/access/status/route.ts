import { ACCESS_COOKIE_NAME, getRequestCookieValue } from "@/lib/server/accessCookie";
import { getPassPlans } from "@/lib/server/billing";
import { FREE_CHAT_DAILY_LIMIT, PREMIUM_CHAT_DAILY_LIMIT, readFreeChatQuota } from "@/lib/server/chatQuota";
import {
  getChatUsage,
  getEntitlementFromCookieValue,
  getSaoPauloDateString,
} from "@/lib/server/licensing";
import { getSafeErrorDetails } from "@/lib/server/security";

export const dynamic = "force-dynamic";

const ACCESS_LOG_PREFIX = "[app-loto-next][access]";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
    status,
  });
}

function buildPublicPlans() {
  const plans = getPassPlans();

  return {
    lifetime: { priceBRL: plans.lifetime.priceBRL },
    pass30: { priceBRL: plans.pass30.priceBRL },
  };
}

export async function GET(request: Request) {
  try {
    const cookieValue = getRequestCookieValue(request, ACCESS_COOKIE_NAME);
    const entitlement = await getEntitlementFromCookieValue(cookieValue);

    if (!entitlement.licensed) {
      const freeQuota = readFreeChatQuota(request);
      return jsonResponse({
        chat: { limit: FREE_CHAT_DAILY_LIMIT, used: freeQuota.count },
        licensed: false,
        plans: buildPublicPlans(),
      });
    }

    let chatUsed = 0;

    try {
      chatUsed = await getChatUsage(entitlement.licenseId, getSaoPauloDateString());
    } catch (error) {
      console.warn(ACCESS_LOG_PREFIX, "status:chat-usage-failed", { error: getSafeErrorDetails(error) });
    }

    return jsonResponse({
      chat: { limit: PREMIUM_CHAT_DAILY_LIMIT, used: chatUsed },
      expiresAt: entitlement.expiresAt ? entitlement.expiresAt.toISOString() : null,
      licensed: true,
      plan: entitlement.plan,
      plans: buildPublicPlans(),
    });
  } catch (error) {
    console.error(ACCESS_LOG_PREFIX, "status:error", { error: getSafeErrorDetails(error) });
    return jsonResponse({
      chat: { limit: FREE_CHAT_DAILY_LIMIT, used: 0 },
      licensed: false,
      plans: buildPublicPlans(),
    });
  }
}
