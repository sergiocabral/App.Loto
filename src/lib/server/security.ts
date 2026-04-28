import { timingSafeEqual } from "node:crypto";

export const MAX_DRAW_NUMBER = 1_000_000;
export const MAX_POST_BODY_BYTES = 4_096;

const RATE_LIMIT_WINDOW_MS = 60_000;
const MUTATION_RATE_LIMIT = 30;

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

type SecurityCheck =
  | { ok: true }
  | {
      ok: false;
      status: number;
      error: string;
    };

type JsonBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | {
      ok: false;
      status: number;
      error: string;
    };

function boolFromEnv(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").toLowerCase());
}

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return forwardedFor || realIp || "unknown";
}

function safeTokenEquals(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorization.split(/\s+/, 2);

  if (scheme?.toLowerCase() === "bearer" && token) {
    return token;
  }

  return request.headers.get("x-luckygames-admin-token");
}

export function parsePositiveInteger(value: unknown, maximum = MAX_DRAW_NUMBER): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 1 && value <= maximum ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
}

export async function readJsonObjectBody(request: Request): Promise<JsonBodyResult> {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().includes("application/json")) {
    return { ok: false, status: 415, error: "Content-Type must be application/json" };
  }

  const contentLength = request.headers.get("content-length");
  const parsedContentLength = contentLength ? Number.parseInt(contentLength, 10) : null;

  if (parsedContentLength && parsedContentLength > MAX_POST_BODY_BYTES) {
    return { ok: false, status: 413, error: "Request body is too large" };
  }

  const text = await request.text();

  if (text.length > MAX_POST_BODY_BYTES) {
    return { ok: false, status: 413, error: "Request body is too large" };
  }

  if (!text.trim()) {
    return { ok: true, body: {} };
  }

  try {
    const parsed = JSON.parse(text) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, status: 400, error: "JSON body must be an object" };
    }

    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON body" };
  }
}

export function authorizeMutationRequest(request: Request): SecurityCheck {
  const configuredToken = process.env.LUCKYGAMES_ADMIN_TOKEN?.trim();

  if (!configuredToken) {
    if (process.env.NODE_ENV !== "production" || boolFromEnv(process.env.LUCKYGAMES_ALLOW_UNPROTECTED_WRITES)) {
      return { ok: true };
    }

    return { ok: false, status: 503, error: "Admin token is not configured" };
  }

  const receivedToken = readBearerToken(request);

  if (!receivedToken || !safeTokenEquals(receivedToken, configuredToken)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}

export function checkMutationRateLimit(request: Request, scope: string): SecurityCheck {
  const now = Date.now();
  const key = `${getClientIp(request)}:${scope}`;
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true };
  }

  bucket.count += 1;

  if (bucket.count > MUTATION_RATE_LIMIT) {
    return { ok: false, status: 429, error: "Too many mutation requests" };
  }

  return { ok: true };
}

export function resetSecurityRateLimitsForTests(): void {
  rateLimitBuckets.clear();
}
