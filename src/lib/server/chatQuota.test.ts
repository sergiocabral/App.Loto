import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildFreeChatQuotaSetCookieHeader,
  FREE_CHAT_QUOTA_COOKIE_NAME,
  readFreeChatQuota,
} from "@/lib/server/chatQuota";
import { getSaoPauloDateString } from "@/lib/server/licensing";

const SECRET = "chat-quota-secret-with-32-chars!!!!!";

function requestWithCookie(header: string | null): Request {
  return new Request("https://example.com/api/chat", {
    headers: header ? { cookie: header } : {},
  });
}

function extractCookieValue(setCookieHeader: string): string {
  return setCookieHeader.split(";")[0].split("=").slice(1).join("=");
}

describe("free chat quota cookie", () => {
  beforeEach(() => {
    process.env.ACCESS_COOKIE_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.ACCESS_COOKIE_SECRET;
  });

  it("round-trips today's quota through the signed cookie", () => {
    const today = getSaoPauloDateString();
    const header = buildFreeChatQuotaSetCookieHeader({ count: 2, date: today }, { secure: false });

    expect(header).toContain(`${FREE_CHAT_QUOTA_COOKIE_NAME}=`);
    expect(header).toContain("HttpOnly");
    expect(header).not.toContain("Secure");

    const quota = readFreeChatQuota(requestWithCookie(`${FREE_CHAT_QUOTA_COOKIE_NAME}=${extractCookieValue(header!)}`));
    expect(quota).toEqual({ count: 2, date: today });
  });

  it("resets when the cookie is missing, tampered or from another day", () => {
    const today = getSaoPauloDateString();

    expect(readFreeChatQuota(requestWithCookie(null))).toEqual({ count: 0, date: today });
    expect(readFreeChatQuota(requestWithCookie(`${FREE_CHAT_QUOTA_COOKIE_NAME}=garbage`))).toEqual({
      count: 0,
      date: today,
    });

    const header = buildFreeChatQuotaSetCookieHeader({ count: 3, date: today }, { secure: false });
    const value = extractCookieValue(header!);
    const [payload, signature] = value.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ count: 0, date: today }), "utf8").toString("base64url");
    expect(
      readFreeChatQuota(requestWithCookie(`${FREE_CHAT_QUOTA_COOKIE_NAME}=${tamperedPayload}.${signature}`)),
    ).toEqual({ count: 0, date: today });
    expect(payload).not.toBe(tamperedPayload);

    const oldHeader = buildFreeChatQuotaSetCookieHeader({ count: 3, date: "2020-01-01" }, { secure: false });
    expect(
      readFreeChatQuota(requestWithCookie(`${FREE_CHAT_QUOTA_COOKIE_NAME}=${extractCookieValue(oldHeader!)}`)),
    ).toEqual({ count: 0, date: today });
  });

  it("degrades safely when the secret is not configured", () => {
    delete process.env.ACCESS_COOKIE_SECRET;
    const today = getSaoPauloDateString();

    expect(buildFreeChatQuotaSetCookieHeader({ count: 1, date: today })).toBeNull();
    expect(readFreeChatQuota(requestWithCookie(`${FREE_CHAT_QUOTA_COOKIE_NAME}=any.value`))).toEqual({
      count: 0,
      date: today,
    });
  });
});
