export const MAX_DRAW_NUMBER = 1_000_000;
export const MAX_POST_BODY_BYTES = 4_096;

const RATE_LIMIT_WINDOW_MS = 60_000;
const MUTATION_RATE_LIMIT = 30;
const MAX_LOG_ARRAY_ITEMS = 10;
const MAX_LOG_OBJECT_KEYS = 20;
const MAX_LOG_DEPTH = 3;
const SENSITIVE_KEY_PATTERN = /(authorization|api[_-]?key|connection[_\s-]?string|passwd|password|pwd|secret|token)/i;

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
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return cloudflareIp || realIp || forwardedFor || "unknown";
}

function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(bearer\s+)(sk-[A-Za-z0-9_-]{12,}|[A-Za-z0-9._~+/=-]{20,})/gi, "$1[redacted]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-[redacted]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)([^@\s]+)(@)/gi, "$1[redacted]$3")
    .replace(/((?:api[_-]?key|connection[_\s-]?string|passwd|password|pwd|secret|token)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]");
}

function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_LOG_DEPTH) {
      return "[array]";
    }

    return value.slice(0, MAX_LOG_ARRAY_ITEMS).map((item) => sanitizeLogValue(item, depth + 1));
  }

  if (value && typeof value === "object") {
    if (depth >= MAX_LOG_DEPTH) {
      return "[object]";
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_LOG_OBJECT_KEYS)
        .map(([key, item]) => [key, SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeLogValue(item, depth + 1)]),
    );
  }

  return value;
}

export function getSafeErrorDetails(error: unknown, options: { includeStack?: boolean } = {}): unknown {
  if (error instanceof Error) {
    return {
      message: redactSensitiveText(error.message),
      name: redactSensitiveText(error.name),
      ...(options.includeStack && error.stack ? { stack: redactSensitiveText(error.stack) } : {}),
    };
  }

  return sanitizeLogValue(error);
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

export async function readJsonObjectBody(request: Request, maxBodyBytes = MAX_POST_BODY_BYTES): Promise<JsonBodyResult> {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().includes("application/json")) {
    return { ok: false, status: 415, error: "Content-Type must be application/json" };
  }

  const contentLength = request.headers.get("content-length");
  const parsedContentLength = contentLength ? Number.parseInt(contentLength, 10) : null;

  if (parsedContentLength && parsedContentLength > maxBodyBytes) {
    return { ok: false, status: 413, error: "Request body is too large" };
  }

  const text = await request.text();

  if (getUtf8ByteLength(text) > maxBodyBytes) {
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
