import { createHmac, timingSafeEqual } from "node:crypto";
import { getRequestCookieValue } from "@/lib/server/accessCookie";
import { getAccessCookieSecret } from "@/lib/server/env";
import { getSaoPauloDateString } from "@/lib/server/licensing";

export const FREE_CHAT_DAILY_LIMIT = 3;
export const PREMIUM_CHAT_DAILY_LIMIT = 100;

export const FREE_CHAT_QUOTA_COOKIE_NAME = "lg_chat_quota";

const FREE_CHAT_QUOTA_COOKIE_MAX_AGE_SECONDS = 2 * 24 * 60 * 60;

type FreeChatQuota = {
  count: number;
  date: string;
};

function computeSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function readFreeChatQuota(request: Request, now: Date = new Date()): FreeChatQuota {
  const today = getSaoPauloDateString(now);
  const fallback: FreeChatQuota = { count: 0, date: today };
  const secret = getAccessCookieSecret();
  const value = getRequestCookieValue(request, FREE_CHAT_QUOTA_COOKIE_NAME);

  if (!secret || !value) {
    return fallback;
  }

  const separatorIndex = value.lastIndexOf(".");

  if (separatorIndex <= 0) {
    return fallback;
  }

  const encodedPayload = value.slice(0, separatorIndex);
  const signature = value.slice(separatorIndex + 1);
  const expected = computeSignature(encodedPayload, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return fallback;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return fallback;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fallback;
  }

  const record = parsed as Record<string, unknown>;

  if (record.date !== today || typeof record.count !== "number" || !Number.isSafeInteger(record.count) || record.count < 0) {
    return fallback;
  }

  return { count: record.count, date: today };
}

export function buildFreeChatQuotaSetCookieHeader(
  quota: FreeChatQuota,
  options: { secure?: boolean } = {},
): string | null {
  const secret = getAccessCookieSecret();

  if (!secret) {
    return null;
  }

  const encodedPayload = Buffer.from(JSON.stringify(quota), "utf8").toString("base64url");
  const value = `${encodedPayload}.${computeSignature(encodedPayload, secret)}`;
  const secure = options.secure ?? process.env.NODE_ENV === "production";
  const attributes = [
    `${FREE_CHAT_QUOTA_COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${FREE_CHAT_QUOTA_COOKIE_MAX_AGE_SECONDS}`,
  ];

  if (secure) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}
