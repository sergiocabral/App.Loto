import { NextResponse } from "next/server";
import { getLottery } from "@/data/lotteries";
import { collectMissingDraws, getOrFetchDraw, loadLotteryHistory } from "@/lib/server/service";
import { renderDrawText, renderHistoryText } from "@/lib/render";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ lottery: string }> }) {
  const { lottery: lotteryParam } = await params;
  const lottery = getLottery(lotteryParam);

  if (!lottery) {
    return NextResponse.json({ error: "Unknown lottery" }, { status: 404 });
  }

  const url = new URL(request.url);
  const drawNumberParam = url.searchParams.get("draw");

  if (drawNumberParam) {
    const drawNumber = Number.parseInt(drawNumberParam, 10);

    if (!Number.isFinite(drawNumber) || drawNumber < 1) {
      return NextResponse.json({ error: "Draw number must be positive" }, { status: 400 });
    }

    const draw = await getOrFetchDraw(lottery.slug, drawNumber);

    return NextResponse.json({
      lottery: lottery.slug,
      draw,
      text: draw ? renderDrawText(draw, false) : "",
    });
  }

  const shouldCollect = url.searchParams.get("collect") !== "false";
  const collection = shouldCollect ? await collectMissingDraws(lottery.slug, 10) : null;
  const history = await loadLotteryHistory(lottery.slug);

  return NextResponse.json({
    lottery: lottery.slug,
    collection,
    draws: history,
    text: renderHistoryText(history),
  });
}
