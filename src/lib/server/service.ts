import { getLottery } from "@/data/lotteries";
import { CaixaApiError, fetchDrawFromCaixa } from "@/lib/server/caixa";
import {
  getDraw,
  getLatestDraw,
  getNextMissingDrawNumber,
  listDraws,
  saveDraw,
  type StoredDraw,
} from "@/lib/server/repository";
import { getSafeErrorDetails } from "@/lib/server/security";

const SERVICE_LOG_PREFIX = "[app-loto-next][service]";

function logService(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.info(SERVICE_LOG_PREFIX, message, details);
    return;
  }

  console.info(SERVICE_LOG_PREFIX, message);
}

function warnService(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.warn(SERVICE_LOG_PREFIX, message, details);
    return;
  }

  console.warn(SERVICE_LOG_PREFIX, message);
}

function errorService(message: string, error: unknown, details?: Record<string, unknown>): void {
  console.error(SERVICE_LOG_PREFIX, message, {
    ...details,
    error: getSafeErrorDetails(error, { includeStack: process.env.NODE_ENV !== "production" }),
  });
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

export type CollectResult = {
  draws: StoredDraw[];
  hasMore: boolean;
  nextDrawNumber: number | null;
};

export type CaixaSyncStopReason =
  | "already_running"
  | "batch_completed"
  | "not_found_limit"
  | "api_returned_previous_draw"
  | "api_returned_different_draw"
  | "unknown_lottery"
  | "error";

export type CaixaSyncResult = {
  draws: StoredDraw[];
  savedDraws: StoredDraw[];
  attemptedDrawNumbers: number[];
  skippedDrawNumbers: number[];
  currentDrawNumber: number | null;
  nextDrawNumber: number | null;
  hasMore: boolean;
  totalStoredDraws: number;
  newestDrawNumber: number | null;
  oldestDrawNumber: number | null;
  consecutiveMisses: number;
  batchSize: number;
  stopReason: CaixaSyncStopReason;
  error?: string;
};

const DEFAULT_CAIXA_SYNC_BATCH_SIZE = 5;
const MAX_CAIXA_SYNC_BATCH_SIZE = 25;
const MAX_CONSECUTIVE_NOT_FOUND = 3;

const activeCaixaSyncs = new Set<string>();

function normalizeBatchSize(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_CAIXA_SYNC_BATCH_SIZE;
  }

  return Math.min(MAX_CAIXA_SYNC_BATCH_SIZE, Math.max(1, Math.floor(value ?? DEFAULT_CAIXA_SYNC_BATCH_SIZE)));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erro desconhecido ao consultar a Caixa.";
}

function isFutureDrawApiError(error: unknown): error is CaixaApiError {
  return error instanceof CaixaApiError && typeof error.status === "number" && error.status >= 500;
}

async function isLikelyFutureDraw(lotterySlug: string, drawNumber: number): Promise<boolean> {
  const latestDraw = await getLatestDraw(lotterySlug);
  return Boolean(latestDraw && drawNumber > latestDraw.drawNumber);
}

export async function getStoredDraw(lotterySlug: string, drawNumber: number): Promise<StoredDraw | null> {
  const startedAt = Date.now();
  logService("getStoredDraw:start", { lotterySlug, drawNumber });

  const lottery = getLottery(lotterySlug);

  if (!lottery) {
    warnService("getStoredDraw:unknown-lottery", { lotterySlug, drawNumber, elapsedMs: elapsedMs(startedAt) });
    return null;
  }

  const draw = await getDraw(lottery.slug, drawNumber);
  logService("getStoredDraw:done", {
    lottery: lottery.slug,
    drawNumber,
    found: Boolean(draw),
    elapsedMs: elapsedMs(startedAt),
  });

  return draw;
}

export async function syncMissingDrawsFromCaixa(
  lotterySlug: string,
  options: { batchSize?: number; startAt?: number } = {},
): Promise<CaixaSyncResult> {
  const startedAt = Date.now();
  const batchSize = normalizeBatchSize(options.batchSize);
  logService("syncMissingDrawsFromCaixa:start", { lotterySlug, batchSize, startAt: options.startAt ?? 1 });

  const lottery = getLottery(lotterySlug);

  if (!lottery) {
    warnService("syncMissingDrawsFromCaixa:unknown-lottery", { lotterySlug, elapsedMs: elapsedMs(startedAt) });

    return {
      draws: [],
      savedDraws: [],
      attemptedDrawNumbers: [],
      skippedDrawNumbers: [],
      currentDrawNumber: null,
      nextDrawNumber: null,
      hasMore: false,
      totalStoredDraws: 0,
      newestDrawNumber: null,
      oldestDrawNumber: null,
      consecutiveMisses: 0,
      batchSize,
      stopReason: "unknown_lottery",
      error: `Unknown lottery: ${lotterySlug}`,
    };
  }

  const savedDraws: StoredDraw[] = [];
  const attemptedDrawNumbers: number[] = [];
  const skippedDrawNumbers: number[] = [];
  const lockKey = lottery.slug;

  if (activeCaixaSyncs.has(lockKey)) {
    const draws = await listDraws(lottery.slug);

    warnService("syncMissingDrawsFromCaixa:already-running", {
      lottery: lottery.slug,
      totalStoredDraws: draws.length,
      elapsedMs: elapsedMs(startedAt),
    });

    return {
      draws,
      savedDraws,
      attemptedDrawNumbers,
      skippedDrawNumbers,
      currentDrawNumber: null,
      nextDrawNumber: null,
      hasMore: true,
      totalStoredDraws: draws.length,
      newestDrawNumber: draws[0]?.drawNumber ?? null,
      oldestDrawNumber: draws.at(-1)?.drawNumber ?? null,
      consecutiveMisses: 0,
      batchSize,
      stopReason: "already_running",
      error: "A synchronization is already running for this lottery.",
    };
  }

  activeCaixaSyncs.add(lockKey);

  try {
    return await runCaixaSync(lottery.slug, batchSize, options.startAt, startedAt, savedDraws, attemptedDrawNumbers, skippedDrawNumbers);
  } finally {
    activeCaixaSyncs.delete(lockKey);
  }
}

async function runCaixaSync(
  lotterySlug: string,
  batchSize: number,
  requestedStartAt: number | undefined,
  startedAt: number,
  savedDraws: StoredDraw[],
  attemptedDrawNumbers: number[],
  skippedDrawNumbers: number[],
): Promise<CaixaSyncResult> {
  const startAt = Math.max(1, Math.floor(requestedStartAt ?? 1));
  let currentDrawNumber: number | null = null;
  let nextDrawNumber: number | null = await getNextMissingDrawNumber(lotterySlug, startAt);
  let consecutiveMisses = 0;
  let stopReason: CaixaSyncStopReason = "batch_completed";
  let errorMessage: string | undefined;

  for (let index = 0; index < batchSize && nextDrawNumber; index += 1) {
    currentDrawNumber = nextDrawNumber;
    attemptedDrawNumbers.push(currentDrawNumber);

    logService("syncMissingDrawsFromCaixa:attempt", {
      lottery: lotterySlug,
      currentDrawNumber,
      batchIndex: index + 1,
      batchSize,
    });

    try {
      const fetchedDraw = await fetchDrawFromCaixa(lotterySlug, currentDrawNumber);

      if (!fetchedDraw) {
        consecutiveMisses += 1;
        skippedDrawNumbers.push(currentDrawNumber);
        warnService("syncMissingDrawsFromCaixa:not-found", {
          lottery: lotterySlug,
          currentDrawNumber,
          consecutiveMisses,
          maxConsecutiveMisses: MAX_CONSECUTIVE_NOT_FOUND,
        });

        if (consecutiveMisses >= MAX_CONSECUTIVE_NOT_FOUND) {
          stopReason = "not_found_limit";
          nextDrawNumber = null;
          break;
        }

        nextDrawNumber = await getNextMissingDrawNumber(lotterySlug, currentDrawNumber + 1);
        continue;
      }

      if (fetchedDraw.drawNumber < currentDrawNumber) {
        stopReason = "api_returned_previous_draw";
        nextDrawNumber = null;
        logService("syncMissingDrawsFromCaixa:reached-api-end", {
          lottery: lotterySlug,
          requestedDrawNumber: currentDrawNumber,
          responseDrawNumber: fetchedDraw.drawNumber,
          newestKnownDraw: fetchedDraw.drawNumber,
        });
        break;
      }

      if (fetchedDraw.drawNumber !== currentDrawNumber) {
        stopReason = "api_returned_different_draw";
        nextDrawNumber = null;
        skippedDrawNumbers.push(currentDrawNumber);
        warnService("syncMissingDrawsFromCaixa:different-draw", {
          lottery: lotterySlug,
          requestedDrawNumber: currentDrawNumber,
          responseDrawNumber: fetchedDraw.drawNumber,
        });
        break;
      }

      const storedDraw = await saveDraw(fetchedDraw);
      savedDraws.push(storedDraw);
      consecutiveMisses = 0;

      const apiNextDrawNumber = fetchedDraw.nextDrawNumber ?? null;
      const sequentialNextDrawNumber = currentDrawNumber + 1;
      const nextSearchStart = apiNextDrawNumber === sequentialNextDrawNumber ? apiNextDrawNumber : sequentialNextDrawNumber;

      if (apiNextDrawNumber && apiNextDrawNumber !== sequentialNextDrawNumber) {
        logService("syncMissingDrawsFromCaixa:api-next-ignored", {
          lottery: lotterySlug,
          currentDrawNumber,
          apiNextDrawNumber,
          sequentialNextDrawNumber,
        });
      }

      nextDrawNumber = await getNextMissingDrawNumber(lotterySlug, nextSearchStart);

      logService("syncMissingDrawsFromCaixa:saved", {
        lottery: lotterySlug,
        drawNumber: storedDraw.drawNumber,
        savedInBatch: savedDraws.length,
        apiNextDrawNumber,
        nextSearchStart,
        nextMissingDrawNumber: nextDrawNumber,
        elapsedMs: elapsedMs(startedAt),
      });
    } catch (error) {
      if (isFutureDrawApiError(error) && (await isLikelyFutureDraw(lotterySlug, currentDrawNumber))) {
        consecutiveMisses = MAX_CONSECUTIVE_NOT_FOUND;
        skippedDrawNumbers.push(currentDrawNumber);
        stopReason = "not_found_limit";
        nextDrawNumber = null;
        warnService("syncMissingDrawsFromCaixa:future-draw-unavailable", {
          lottery: lotterySlug,
          currentDrawNumber,
          status: error.status,
          savedInBatch: savedDraws.length,
          elapsedMs: elapsedMs(startedAt),
        });
        break;
      }

      stopReason = "error";
      errorMessage = getErrorMessage(error);
      nextDrawNumber = currentDrawNumber;
      errorService("syncMissingDrawsFromCaixa:error", error, {
        lottery: lotterySlug,
        currentDrawNumber,
        savedInBatch: savedDraws.length,
        elapsedMs: elapsedMs(startedAt),
      });
      break;
    }
  }

  const draws = await listDraws(lotterySlug);
  const hasMore = stopReason === "batch_completed" && attemptedDrawNumbers.length === batchSize && Boolean(nextDrawNumber);

  logService("syncMissingDrawsFromCaixa:done", {
    lottery: lotterySlug,
    savedInBatch: savedDraws.length,
    attemptedInBatch: attemptedDrawNumbers.length,
    skippedInBatch: skippedDrawNumbers.length,
    currentDrawNumber,
    nextDrawNumber,
    hasMore,
    stopReason,
    totalStoredDraws: draws.length,
    newestDrawNumber: draws[0]?.drawNumber ?? null,
    oldestDrawNumber: draws.at(-1)?.drawNumber ?? null,
    elapsedMs: elapsedMs(startedAt),
  });

  return {
    draws,
    savedDraws,
    attemptedDrawNumbers,
    skippedDrawNumbers,
    currentDrawNumber,
    nextDrawNumber,
    hasMore,
    totalStoredDraws: draws.length,
    newestDrawNumber: draws[0]?.drawNumber ?? null,
    oldestDrawNumber: draws.at(-1)?.drawNumber ?? null,
    consecutiveMisses,
    batchSize,
    stopReason,
    ...(errorMessage ? { error: errorMessage } : {}),
  };
}

export async function collectMissingDraws(lotterySlug: string): Promise<CollectResult> {
  const startedAt = Date.now();
  logService("collectMissingDraws:start-database-only", { lotterySlug });

  const lottery = getLottery(lotterySlug);

  if (!lottery) {
    warnService("collectMissingDraws:unknown-lottery", { lotterySlug, elapsedMs: elapsedMs(startedAt) });

    return {
      draws: [],
      hasMore: false,
      nextDrawNumber: null,
    };
  }

  const draws = await listDraws(lottery.slug);
  const nextDrawNumber = draws[0]?.drawNumber ? draws[0].drawNumber + 1 : null;

  logService("collectMissingDraws:done-database-only", {
    lottery: lottery.slug,
    storedDraws: draws.length,
    newestDrawNumber: draws[0]?.drawNumber ?? null,
    nextDrawNumber,
    hasMore: false,
    elapsedMs: elapsedMs(startedAt),
  });

  return {
    draws,
    hasMore: false,
    nextDrawNumber,
  };
}

export async function loadLotteryHistory(lotterySlug: string): Promise<StoredDraw[]> {
  const startedAt = Date.now();
  logService("loadLotteryHistory:start-database-only", { lotterySlug });

  const lottery = getLottery(lotterySlug);

  if (!lottery) {
    warnService("loadLotteryHistory:unknown-lottery", { lotterySlug, elapsedMs: elapsedMs(startedAt) });
    return [];
  }

  const history = await listDraws(lottery.slug);
  logService("loadLotteryHistory:done-database-only", {
    lottery: lottery.slug,
    storedDraws: history.length,
    newestDrawNumber: history[0]?.drawNumber ?? null,
    elapsedMs: elapsedMs(startedAt),
  });

  return history;
}
