import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_COOKIE_NAME,
  buildAccessClearCookieHeader,
  buildAccessSetCookieHeader,
  getRequestCookieValue,
  signAccessCookie,
  verifyAccessCookie,
  type AccessCookiePayload,
} from "@/lib/server/accessCookie";

const SECRET = "test-secret-with-at-least-32-characters!";

function buildPayload(overrides: Partial<AccessCookiePayload> = {}): AccessCookiePayload {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    email: "user@example.com",
    exp: nowSeconds + 3_600,
    iat: nowSeconds,
    lid: 7,
    plan: "pass30",
    v: 1,
    ...overrides,
  };
}

describe("access cookie helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("signs and verifies a round-trip payload", () => {
    const payload = buildPayload();
    const cookie = signAccessCookie(payload, SECRET);

    expect(verifyAccessCookie(cookie, SECRET)).toEqual(payload);
  });

  it("rejects tampered payloads and signatures", () => {
    const cookie = signAccessCookie(buildPayload(), SECRET);
    const [encodedPayload, signature] = cookie.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...buildPayload(), lid: 999 }),
      "utf8",
    ).toString("base64url");

    expect(verifyAccessCookie(`${tamperedPayload}.${signature}`, SECRET)).toBeNull();
    expect(verifyAccessCookie(`${encodedPayload}.AAAA${signature.slice(4)}`, SECRET)).toBeNull();
    expect(verifyAccessCookie(cookie, "another-secret-with-32-characters!!!")).toBeNull();
  });

  it("rejects malformed values, wrong shapes and expired payloads", () => {
    expect(verifyAccessCookie(undefined, SECRET)).toBeNull();
    expect(verifyAccessCookie(null, SECRET)).toBeNull();
    expect(verifyAccessCookie("", SECRET)).toBeNull();
    expect(verifyAccessCookie("no-separator", SECRET)).toBeNull();
    expect(verifyAccessCookie(".only-signature", SECRET)).toBeNull();
    expect(verifyAccessCookie("payload.", SECRET)).toBeNull();

    const notJson = Buffer.from("not json", "utf8").toString("base64url");
    expect(
      verifyAccessCookie(`${notJson}.${signAccessCookie(buildPayload(), SECRET).split(".")[1]}`, SECRET),
    ).toBeNull();

    const invalidShapes: Array<Partial<AccessCookiePayload> & Record<string, unknown>> = [
      { v: 2 },
      { lid: 0 },
      { lid: 1.5 },
      { email: 42 },
      { plan: "gold" },
      { iat: "now" },
      { exp: "later" },
    ];

    for (const overrides of invalidShapes) {
      const cookie = signAccessCookie({ ...buildPayload(), ...overrides } as AccessCookiePayload, SECRET);
      expect(verifyAccessCookie(cookie, SECRET)).toBeNull();
    }

    const expired = signAccessCookie(buildPayload({ exp: Math.floor(Date.now() / 1000) - 1 }), SECRET);
    expect(verifyAccessCookie(expired, SECRET)).toBeNull();
  });

  it("reads the cookie value from a request header", () => {
    const cookie = signAccessCookie(buildPayload(), SECRET);
    const request = new Request("https://example.com", {
      headers: { cookie: `other=1; ${ACCESS_COOKIE_NAME}=${cookie}; last=2` },
    });

    expect(getRequestCookieValue(request, ACCESS_COOKIE_NAME)).toBe(cookie);
    expect(getRequestCookieValue(request, "missing")).toBeUndefined();
    expect(getRequestCookieValue(new Request("https://example.com"), ACCESS_COOKIE_NAME)).toBeUndefined();
    expect(
      getRequestCookieValue(new Request("https://example.com", { headers: { cookie: "malformed" } }), ACCESS_COOKIE_NAME),
    ).toBeUndefined();
  });

  it("builds set-cookie and clear-cookie headers", () => {
    const header = buildAccessSetCookieHeader("value123", { secure: true });

    expect(header).toContain(`${ACCESS_COOKIE_NAME}=value123`);
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Max-Age=34560000");
    expect(header).toContain("Secure");

    const insecure = buildAccessSetCookieHeader("value123", { secure: false });
    expect(insecure).not.toContain("Secure");

    const clear = buildAccessClearCookieHeader({ secure: false });
    expect(clear).toContain(`${ACCESS_COOKIE_NAME}=;`);
    expect(clear).toContain("Max-Age=0");
  });
});
