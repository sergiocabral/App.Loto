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

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return forwardedFor || realIp || "unknown";
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
