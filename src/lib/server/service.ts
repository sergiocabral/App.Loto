import { getLottery } from "@/data/lotteries";
import { fetchDrawFromCaixa } from "@/lib/server/caixa";
import {
  getDraw,
  getNextDrawNumberFromStorage,
  listDraws,
  saveDraw,
  type StoredDraw,
} from "@/lib/server/repository";

export type CollectResult = {
  draws: StoredDraw[];
  hasMore: boolean;
  nextDrawNumber: number;
};

export async function getOrFetchDraw(lotterySlug: string, drawNumber: number): Promise<StoredDraw | null> {
  const lottery = getLottery(lotterySlug);

  if (!lottery) {
    return null;
  }

  const cached = await getDraw(lottery.slug, drawNumber);

  if (cached) {
    return cached;
  }

  const fetched = await fetchDrawFromCaixa(lottery.slug, drawNumber);

  if (!fetched) {
    return null;
  }

  return saveDraw(fetched);
}

export async function collectMissingDraws(lotterySlug: string, batchSize = 10): Promise<CollectResult> {
  const lottery = getLottery(lotterySlug);

  if (!lottery) {
    return {
      draws: [],
      hasMore: false,
      nextDrawNumber: 1,
    };
  }

  let nextDrawNumber = await getNextDrawNumberFromStorage(lottery.slug);
  const draws: StoredDraw[] = [];

  for (let remaining = batchSize; remaining > 0; remaining -= 1) {
    const fetched = await fetchDrawFromCaixa(lottery.slug, nextDrawNumber);

    if (!fetched) {
      return {
        draws,
        hasMore: false,
        nextDrawNumber,
      };
    }

    const stored = await saveDraw(fetched);
    draws.push(stored);
    nextDrawNumber = fetched.nextDrawNumber && fetched.nextDrawNumber !== fetched.drawNumber
      ? fetched.nextDrawNumber
      : fetched.drawNumber + 1;
  }

  return {
    draws,
    hasMore: true,
    nextDrawNumber,
  };
}

export async function loadLotteryHistory(lotterySlug: string): Promise<StoredDraw[]> {
  const lottery = getLottery(lotterySlug);

  if (!lottery) {
    return [];
  }

  return listDraws(lottery.slug);
}
