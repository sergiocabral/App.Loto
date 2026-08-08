import { createHmac, timingSafeEqual } from "node:crypto";

export const ACCESS_COOKIE_NAME = "lg_access";

const ACCESS_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export type AccessCookiePayload = {
  email: string;
  exp: number;
  iat: number;
  lid: number;
  plan: "lifetime" | "pass30";
  v: 1;
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function computeSignature(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function signAccessCookie(payload: AccessCookiePayload, secret: string): string {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${computeSignature(encodedPayload, secret)}`;
}

export function verifyAccessCookie(value: string | undefined | null, secret: string): AccessCookiePayload | null {
  if (!value) {
    return null;
  }

  const separatorIndex = value.lastIndexOf(".");

  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return null;
  }

  const encodedPayload = value.slice(0, separatorIndex);
  const signature = value.slice(separatorIndex + 1);
  const expectedSignature = computeSignature(encodedPayload, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  const decodedPayload = base64UrlDecode(encodedPayload);

  if (!decodedPayload) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(decodedPayload);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const payload = parsed as Record<string, unknown>;

  if (
    payload.v !== 1 ||
    typeof payload.lid !== "number" ||
    !Number.isSafeInteger(payload.lid) ||
    payload.lid < 1 ||
    typeof payload.email !== "string" ||
    (payload.plan !== "pass30" && payload.plan !== "lifetime") ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }

  if (payload.exp * 1000 <= Date.now()) {
    return null;
  }

  return {
    email: payload.email,
    exp: payload.exp,
    iat: payload.iat,
    lid: payload.lid,
    plan: payload.plan,
    v: 1,
  };
}

export function getRequestCookieValue(request: Request, cookieName: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex < 0) {
      continue;
    }

    const name = part.slice(0, separatorIndex).trim();

    if (name === cookieName) {
      return part.slice(separatorIndex + 1).trim();
    }
  }

  return undefined;
}

type SetCookieOptions = {
  maxAgeSeconds?: number;
  secure?: boolean;
};

export function buildAccessSetCookieHeader(value: string, options: SetCookieOptions = {}): string {
  const maxAge = options.maxAgeSeconds ?? ACCESS_COOKIE_MAX_AGE_SECONDS;
  const secure = options.secure ?? process.env.NODE_ENV === "production";
  const attributes = [
    `${ACCESS_COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];

  if (secure) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function buildAccessClearCookieHeader(options: SetCookieOptions = {}): string {
  return buildAccessSetCookieHeader("", { ...options, maxAgeSeconds: 0 });
}
