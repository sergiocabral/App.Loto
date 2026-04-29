import { NextResponse } from "next/server";
import { getLottery } from "@/data/lotteries";
import {
  collectMissingDraws,
  getStoredDraw,
  loadLotteryHistory,
  syncMissingDrawsFromCaixa,
} from "@/lib/server/service";
import { checkMutationRateLimit, getSafeErrorDetails, parsePositiveInteger, readJsonObjectBody } from "@/lib/server/security";
import { renderDrawText, renderHistoryText } from "@/lib/render";
import type { Draw } from "@/lib/types";

export const dynamic = "force-dynamic";

const API_LOG_PREFIX = "[app-loto-next][api]";

function logApi(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.info(API_LOG_PREFIX, message, details);
    return;
  }

  console.info(API_LOG_PREFIX, message);
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

type PublicDraw = Omit<Draw, "raw">;

function toPublicDraw(draw: Draw): PublicDraw {
  return {
    lottery: draw.lottery,
    drawNumber: draw.drawNumber,
    date: draw.date,
    numbers: draw.numbers,
    numberGroups: draw.numberGroups,
    previousDrawNumber: draw.previousDrawNumber,
    nextDrawNumber: draw.nextDrawNumber,
  };
}

function toPublicDraws(draws: Draw[]): PublicDraw[] {
  return draws.map(toPublicDraw);
}

function logApiError(message: string, error: unknown, details?: Record<string, unknown>): void {
  console.error(API_LOG_PREFIX, message, {
    ...details,
    error: getSafeErrorDetails(error),
  });
}

function databaseErrorResponse() {
  return NextResponse.json({ error: "Não foi possível acessar os dados agora." }, { status: 500 });
}

async function handleGet(request: Request, lotteryParam: string, startedAt: number) {
  const lottery = getLottery(lotteryParam);
  const url = new URL(request.url);

  logApi("GET:start", {
    lotteryParam,
    pathname: url.pathname,
    hasDraw: url.searchParams.has("draw"),
    format: url.searchParams.get("format") ?? null,
  });

  if (!lottery) {
    logApi("GET:unknown-lottery", { lotteryParam, elapsedMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: "Unknown lottery" }, { status: 404 });
  }

  const wantsLegacyFormat = url.searchParams.get("format") === "legacy";
  const drawNumberParam = url.searchParams.get("draw");

  if (url.searchParams.has("draw")) {
    const drawNumber = parsePositiveInteger(drawNumberParam ?? "");

    if (!drawNumber) {
      logApi("GET:invalid-draw", { lottery: lottery.slug, elapsedMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: "Draw number must be a positive integer" }, { status: 400 });
    }

    logApi("GET:draw-lookup-database-only", { lottery: lottery.slug, drawNumber });
    const draw = await getStoredDraw(lottery.slug, drawNumber);

    logApi("GET:draw-lookup-done", {
      lottery: lottery.slug,
      drawNumber,
      found: Boolean(draw),
      elapsedMs: elapsedMs(startedAt),
    });

    if (wantsLegacyFormat) {
      return new Response(draw ? renderDrawText(draw, false) : "", {
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    return NextResponse.json({
      lottery: lottery.slug,
      draw: draw ? toPublicDraw(draw) : null,
      text: draw ? renderDrawText(draw, false) : "",
    });
  }

  const shouldCollect = url.searchParams.get("collect") === "true";
  logApi("GET:history-database-only", { lottery: lottery.slug, shouldCollect });
  const collection = shouldCollect ? await collectMissingDraws(lottery.slug) : null;
  const history = collection?.draws ?? (await loadLotteryHistory(lottery.slug));
  const publicHistory = toPublicDraws(history);
  const publicCollection = collection
    ? {
        draws: toPublicDraws(collection.draws),
        hasMore: collection.hasMore,
        nextDrawNumber: collection.nextDrawNumber,
      }
    : null;

  logApi("GET:history-done", {
    lottery: lottery.slug,
    shouldCollect,
    collectionDraws: collection?.draws.length ?? null,
    historyDraws: history.length,
    elapsedMs: elapsedMs(startedAt),
  });

  if (wantsLegacyFormat) {
    return new Response(renderHistoryText(history), {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  return NextResponse.json({
    lottery: lottery.slug,
    collection: publicCollection,
    draws: publicHistory,
    text: renderHistoryText(history),
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ lottery: string }> }) {
  const startedAt = Date.now();
  const { lottery: lotteryParam } = await params;

  try {
    return await handleGet(request, lotteryParam, startedAt);
  } catch (error) {
    logApiError("GET:error", error, { lotteryParam, elapsedMs: elapsedMs(startedAt) });
    return databaseErrorResponse();
  }
}

async function handlePost(request: Request, lotteryParam: string, startedAt: number) {
  const lottery = getLottery(lotteryParam);

  logApi("POST:start", { lotteryParam });

  if (!lottery) {
    logApi("POST:unknown-lottery", { lotteryParam, elapsedMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: "Unknown lottery" }, { status: 404 });
  }

  const rateLimit = checkMutationRateLimit(request, lottery.slug);

  if (!rateLimit.ok) {
    logApi("POST:rate-limited", { lottery: lottery.slug, status: rateLimit.status, elapsedMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: rateLimit.error }, { status: rateLimit.status });
  }

  const bodyResult = await readJsonObjectBody(request);

  if (!bodyResult.ok) {
    logApi("POST:invalid-body", { lottery: lottery.slug, status: bodyResult.status, elapsedMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: bodyResult.error }, { status: bodyResult.status });
  }

  const bodyRecord = bodyResult.body;
  const action = typeof bodyRecord.action === "string" ? bodyRecord.action : "sync-caixa";

  if (action !== "sync-caixa") {
    logApi("POST:unknown-action", { lottery: lottery.slug, action, elapsedMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const batchSize = bodyRecord.batchSize === undefined ? undefined : parsePositiveInteger(bodyRecord.batchSize, 25);
  const startAt = bodyRecord.startAt === undefined || bodyRecord.startAt === null ? undefined : parsePositiveInteger(bodyRecord.startAt);

  if (bodyRecord.batchSize !== undefined && !batchSize) {
    logApi("POST:invalid-batch-size", { lottery: lottery.slug, elapsedMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: "Batch size must be a positive integer up to 25" }, { status: 400 });
  }

  if (bodyRecord.startAt !== undefined && bodyRecord.startAt !== null && !startAt) {
    logApi("POST:invalid-start-at", { lottery: lottery.slug, elapsedMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: "Start draw must be a positive integer" }, { status: 400 });
  }

  const syncOptions: { batchSize?: number; startAt?: number } = {};

  if (typeof batchSize === "number") {
    syncOptions.batchSize = batchSize;
  }

  if (typeof startAt === "number") {
    syncOptions.startAt = startAt;
  }

  logApi("POST:sync-caixa", { lottery: lottery.slug, batchSize, startAt });
  const sync = await syncMissingDrawsFromCaixa(lottery.slug, syncOptions);

  logApi("POST:sync-caixa-done", {
    lottery: lottery.slug,
    savedDraws: sync.savedDraws.length,
    attemptedDrawNumbers: sync.attemptedDrawNumbers,
    nextDrawNumber: sync.nextDrawNumber,
    hasMore: sync.hasMore,
    stopReason: sync.stopReason,
    elapsedMs: elapsedMs(startedAt),
  });

  const publicSync = {
    ...sync,
    draws: toPublicDraws(sync.draws),
    savedDraws: toPublicDraws(sync.savedDraws),
  };

  return NextResponse.json({
    lottery: lottery.slug,
    sync: publicSync,
    draws: publicSync.draws,
    text: renderHistoryText(sync.draws),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ lottery: string }> }) {
  const startedAt = Date.now();
  const { lottery: lotteryParam } = await params;

  try {
    return await handlePost(request, lotteryParam, startedAt);
  } catch (error) {
    logApiError("POST:error", error, { lotteryParam, elapsedMs: elapsedMs(startedAt) });
    return databaseErrorResponse();
  }
}
