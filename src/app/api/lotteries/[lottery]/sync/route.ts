import { getLottery } from "@/data/lotteries";
import { getCronSyncSecret } from "@/lib/server/env";
import { syncMissingDrawsFromCaixa } from "@/lib/server/service";
import { getSafeErrorDetails, parsePositiveInteger } from "@/lib/server/security";

export const dynamic = "force-dynamic";

const CRON_SYNC_LOG_PREFIX = "[app-loto-next][cron-sync]";
const DEFAULT_CRON_SYNC_BATCH_SIZE = 25;
const MAX_CRON_SYNC_BATCH_SIZE = 25;

type CronSyncResult = Awaited<ReturnType<typeof syncMissingDrawsFromCaixa>>;

function textResponse(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "text/plain; charset=utf-8");

  return new Response(`${body.trim()}\n`, {
    ...init,
    headers,
  });
}

function logCronSync(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.info(CRON_SYNC_LOG_PREFIX, message, details);
    return;
  }

  console.info(CRON_SYNC_LOG_PREFIX, message);
}

function logCronSyncError(message: string, error: unknown, details?: Record<string, unknown>): void {
  console.error(CRON_SYNC_LOG_PREFIX, message, {
    ...details,
    error: getSafeErrorDetails(error),
  });
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

type CronAccessResult =
  | { ok: true; authMethod: "authorization" | "header" | "query" }
  | { ok: false; status: 401 | 503; error: string };

function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")?.trim();

  if (!header) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

function checkCronAccess(request: Request, url: URL): CronAccessResult {
  const expectedSecret = getCronSyncSecret();

  if (!expectedSecret) {
    return {
      ok: false,
      status: 503,
      error: "Sync cron secret is not configured",
    };
  }

  const bearerToken = readBearerToken(request);
  const headerToken = request.headers.get("x-sync-cron-secret")?.trim() || null;
  const queryToken = url.searchParams.get("token")?.trim() || null;

  if (bearerToken === expectedSecret) {
    return { ok: true, authMethod: "authorization" };
  }

  if (headerToken === expectedSecret) {
    return { ok: true, authMethod: "header" };
  }

  if (queryToken === expectedSecret) {
    return { ok: true, authMethod: "query" };
  }

  return {
    ok: false,
    status: 401,
    error: "Unauthorized sync request",
  };
}

function parseSyncOptions(url: URL): { ok: true; batchSize: number; startAt?: number } | { ok: false; error: string } {
  const batchSizeParam = url.searchParams.get("batchSize");
  const startAtParam = url.searchParams.get("startAt");
  const batchSize = batchSizeParam ? parsePositiveInteger(batchSizeParam, MAX_CRON_SYNC_BATCH_SIZE) : DEFAULT_CRON_SYNC_BATCH_SIZE;

  if (!batchSize) {
    return { ok: false, error: "Batch size must be a positive integer up to 25" };
  }

  if (startAtParam !== null) {
    const startAt = parsePositiveInteger(startAtParam);

    if (!startAt) {
      return { ok: false, error: "Start draw must be a positive integer" };
    }

    return { ok: true, batchSize, startAt };
  }

  return { ok: true, batchSize };
}

function buildSyncSummaryText(lotterySlug: string, sync: CronSyncResult, batchSize: number, elapsed: number): string {
  const nextStartAt = sync.hasMore && sync.nextDrawNumber ? String(sync.nextDrawNumber) : "none";

  return [
    "OK",
    `lottery=${lotterySlug}`,
    `attempted=${sync.attemptedDrawNumbers.length}`,
    `saved=${sync.savedDraws.length}`,
    `skipped=${sync.skippedDrawNumbers.length}`,
    `batchSize=${batchSize}`,
    `hasMore=${sync.hasMore ? "true" : "false"}`,
    `nextStartAt=${nextStartAt}`,
    `stopReason=${sync.stopReason}`,
    `elapsedMs=${elapsed}`,
  ].join(" ");
}

export async function GET(request: Request, { params }: { params: Promise<{ lottery: string }> }) {
  const startedAt = Date.now();
  const { lottery: lotteryParam } = await params;
  const url = new URL(request.url);
  const lottery = getLottery(lotteryParam);

  logCronSync("GET:start", {
    lotteryParam,
    pathname: url.pathname,
    hasBatchSize: url.searchParams.has("batchSize"),
    hasStartAt: url.searchParams.has("startAt"),
    hasQueryToken: url.searchParams.has("token"),
  });

  if (!lottery) {
    logCronSync("GET:unknown-lottery", { lotteryParam, elapsedMs: elapsedMs(startedAt) });
    return textResponse("ERROR Unknown lottery", { status: 404 });
  }

  const access = checkCronAccess(request, url);

  if (!access.ok) {
    logCronSync("GET:unauthorized", { lottery: lottery.slug, status: access.status, elapsedMs: elapsedMs(startedAt) });
    return textResponse(`ERROR ${access.error}`, { status: access.status });
  }

  const syncOptions = parseSyncOptions(url);

  if (!syncOptions.ok) {
    logCronSync("GET:invalid-options", { lottery: lottery.slug, elapsedMs: elapsedMs(startedAt) });
    return textResponse(`ERROR ${syncOptions.error}`, { status: 400 });
  }

  try {
    logCronSync("GET:sync-caixa", {
      lottery: lottery.slug,
      authMethod: access.authMethod,
      batchSize: syncOptions.batchSize,
      startAt: syncOptions.startAt ?? null,
    });

    const sync = await syncMissingDrawsFromCaixa(lottery.slug, {
      batchSize: syncOptions.batchSize,
      ...(typeof syncOptions.startAt === "number" ? { startAt: syncOptions.startAt } : {}),
    });
    const elapsed = elapsedMs(startedAt);

    logCronSync("GET:sync-caixa-done", {
      lottery: lottery.slug,
      savedDraws: sync.savedDraws.length,
      attemptedDrawNumbers: sync.attemptedDrawNumbers,
      nextDrawNumber: sync.nextDrawNumber,
      hasMore: sync.hasMore,
      stopReason: sync.stopReason,
      elapsedMs: elapsed,
    });

    return textResponse(buildSyncSummaryText(lottery.slug, sync, syncOptions.batchSize, elapsed));
  } catch (error) {
    logCronSyncError("GET:error", error, { lottery: lottery.slug, elapsedMs: elapsedMs(startedAt) });
    return textResponse("ERROR Não foi possível sincronizar os dados agora.", { status: 500 });
  }
}
