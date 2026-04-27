import { NextResponse } from "next/server";
import { getLottery } from "@/data/lotteries";
import {
  collectMissingDraws,
  fetchAndStoreDrawFromCaixa,
  getStoredDraw,
  loadLotteryHistory,
  syncMissingDrawsFromCaixa,
} from "@/lib/server/service";
import { renderDrawText, renderHistoryText } from "@/lib/render";

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

export async function GET(request: Request, { params }: { params: Promise<{ lottery: string }> }) {
  const startedAt = Date.now();
  const { lottery: lotteryParam } = await params;
  const lottery = getLottery(lotteryParam);
  const url = new URL(request.url);

  logApi("GET:start", {
    lotteryParam,
    pathname: url.pathname,
    search: url.search,
  });

  if (!lottery) {
    logApi("GET:unknown-lottery", { lotteryParam, elapsedMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: "Unknown lottery" }, { status: 404 });
  }

  const wantsLegacyFormat = url.searchParams.get("format") === "legacy";
  const drawNumberParam = url.searchParams.get("draw");

  if (drawNumberParam) {
    const drawNumber = Number.parseInt(drawNumberParam, 10);

    if (!Number.isFinite(drawNumber) || drawNumber < 1) {
      logApi("GET:invalid-draw", { lottery: lottery.slug, drawNumberParam, elapsedMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: "Draw number must be positive" }, { status: 400 });
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
      draw,
      text: draw ? renderDrawText(draw, false) : "",
    });
  }

  const shouldCollect = url.searchParams.get("collect") !== "false";
  logApi("GET:history-database-only", { lottery: lottery.slug, shouldCollect });
  const collection = shouldCollect ? await collectMissingDraws(lottery.slug) : null;
  const history = collection?.draws ?? (await loadLotteryHistory(lottery.slug));

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
    collection,
    draws: history,
    text: renderHistoryText(history),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ lottery: string }> }) {
  const startedAt = Date.now();
  const { lottery: lotteryParam } = await params;
  const lottery = getLottery(lotteryParam);

  logApi("POST:start", { lotteryParam });

  if (!lottery) {
    logApi("POST:unknown-lottery", { lotteryParam, elapsedMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: "Unknown lottery" }, { status: 404 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const bodyRecord = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const action = typeof bodyRecord.action === "string" ? bodyRecord.action : "fetch-draw";

  if (action === "sync-caixa") {
    const batchSize = Number.parseInt(String(bodyRecord.batchSize ?? "5"), 10);
    const startAtValue = bodyRecord.startAt;
    const startAt = startAtValue === undefined || startAtValue === null ? undefined : Number.parseInt(String(startAtValue), 10);

    logApi("POST:sync-caixa", { lottery: lottery.slug, batchSize, startAt });
    const sync = await syncMissingDrawsFromCaixa(lottery.slug, {
      batchSize: Number.isFinite(batchSize) ? batchSize : undefined,
      startAt: Number.isFinite(startAt) ? startAt : undefined,
    });

    logApi("POST:sync-caixa-done", {
      lottery: lottery.slug,
      savedDraws: sync.savedDraws.length,
      attemptedDrawNumbers: sync.attemptedDrawNumbers,
      nextDrawNumber: sync.nextDrawNumber,
      hasMore: sync.hasMore,
      stopReason: sync.stopReason,
      elapsedMs: elapsedMs(startedAt),
    });

    return NextResponse.json({
      lottery: lottery.slug,
      sync,
      draws: sync.draws,
      text: renderHistoryText(sync.draws),
    });
  }

  const drawNumber = Number.parseInt(String(bodyRecord.drawNumber ?? ""), 10);

  if (!Number.isFinite(drawNumber) || drawNumber < 1) {
    logApi("POST:invalid-draw", { lottery: lottery.slug, body, elapsedMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: "Draw number must be positive" }, { status: 400 });
  }

  logApi("POST:fetch-caixa-explicit", { lottery: lottery.slug, drawNumber });
  const draw = await fetchAndStoreDrawFromCaixa(lottery.slug, drawNumber);

  logApi("POST:fetch-caixa-explicit-done", {
    lottery: lottery.slug,
    drawNumber,
    found: Boolean(draw),
    elapsedMs: elapsedMs(startedAt),
  });

  return NextResponse.json({
    lottery: lottery.slug,
    draw,
    text: draw ? renderDrawText(draw, false) : "",
  });
}
