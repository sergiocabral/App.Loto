import { afterEach, describe, expect, it, vi } from "vitest";
import type { Draw } from "@/lib/types";

const repositoryMocks = vi.hoisted(() => ({
  getDraw: vi.fn(),
  getLatestDraw: vi.fn(),
  getNextMissingDrawNumber: vi.fn(),
  listDraws: vi.fn(),
  saveDraw: vi.fn(),
}));

const caixaMocks = vi.hoisted(() => ({
  fetchDrawFromCaixa: vi.fn(),
}));

vi.mock("@/lib/server/repository", () => repositoryMocks);
vi.mock("@/lib/server/caixa", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@/lib/server/caixa");
  return {
    CaixaApiError: actual.CaixaApiError,
    fetchDrawFromCaixa: caixaMocks.fetchDrawFromCaixa,
  };
});

function draw(drawNumber: number, overrides: Partial<Draw> = {}) {
  return {
    lottery: "MegaSena",
    drawNumber,
    date: "01/01/2026",
    numbers: ["01", "02", "03", "04", "05", "06"],
    numberGroups: [["01", "02", "03", "04", "05", "06"]],
    previousDrawNumber: drawNumber - 1 || null,
    nextDrawNumber: drawNumber + 1,
    raw: {},
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("lottery service", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("gets stored draws only for known lotteries", async () => {
    repositoryMocks.getDraw.mockResolvedValueOnce(draw(1));

    const { getStoredDraw } = await import("@/lib/server/service");

    await expect(getStoredDraw("MegaSena", 1)).resolves.toMatchObject({ drawNumber: 1 });
    expect(repositoryMocks.getDraw).toHaveBeenCalledWith("MegaSena", 1);

    await expect(getStoredDraw("Unknown", 1)).resolves.toBeNull();
  });

  it("syncs a sequential batch and uses sequential next draw over API hints", async () => {
    const fetchedOne = draw(1, { nextDrawNumber: 50 });
    const fetchedTwo = draw(2, { nextDrawNumber: 3 });
    repositoryMocks.getNextMissingDrawNumber.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    caixaMocks.fetchDrawFromCaixa.mockResolvedValueOnce(fetchedOne).mockResolvedValueOnce(fetchedTwo);
    repositoryMocks.saveDraw.mockImplementation(async (value) => draw(value.drawNumber, value));
    repositoryMocks.listDraws.mockResolvedValue([draw(2), draw(1)]);

    const { syncMissingDrawsFromCaixa } = await import("@/lib/server/service");
    const result = await syncMissingDrawsFromCaixa("MegaSena", { batchSize: 2, startAt: 1 });

    expect(result.stopReason).toBe("batch_completed");
    expect(result.hasMore).toBe(true);
    expect(result.savedDraws.map((item) => item.drawNumber)).toEqual([1, 2]);
    expect(result.attemptedDrawNumbers).toEqual([1, 2]);
    expect(repositoryMocks.getNextMissingDrawNumber).toHaveBeenNthCalledWith(2, "MegaSena", 2);
  });

  it("prevents concurrent Caixa syncs for the same lottery", async () => {
    repositoryMocks.getNextMissingDrawNumber.mockResolvedValueOnce(1).mockResolvedValueOnce(null);
    caixaMocks.fetchDrawFromCaixa.mockResolvedValueOnce(draw(1));
    repositoryMocks.saveDraw.mockImplementation(async (value) => draw(value.drawNumber, value));
    repositoryMocks.listDraws.mockResolvedValue([draw(1)]);

    const { syncMissingDrawsFromCaixa } = await import("@/lib/server/service");
    const resultPromise = syncMissingDrawsFromCaixa("MegaSena", { batchSize: 1, startAt: 1 });
    const concurrentResult = await syncMissingDrawsFromCaixa("MegaSena", { batchSize: 1, startAt: 1 });
    const result = await resultPromise;

    expect(result.stopReason).toBe("batch_completed");
    expect(concurrentResult.stopReason).toBe("already_running");
    expect(caixaMocks.fetchDrawFromCaixa).toHaveBeenCalledTimes(1);
  });

  it("stops sync after consecutive not-found responses", async () => {
    repositoryMocks.getNextMissingDrawNumber.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    caixaMocks.fetchDrawFromCaixa.mockResolvedValue(null);
    repositoryMocks.listDraws.mockResolvedValue([]);

    const { syncMissingDrawsFromCaixa } = await import("@/lib/server/service");
    const result = await syncMissingDrawsFromCaixa("MegaSena", { batchSize: 10, startAt: 1 });

    expect(result.stopReason).toBe("not_found_limit");
    expect(result.hasMore).toBe(false);
    expect(result.consecutiveMisses).toBe(3);
    expect(result.skippedDrawNumbers).toEqual([1, 2, 3]);
    expect(repositoryMocks.saveDraw).not.toHaveBeenCalled();
  });

  it("treats future 500 responses as probable end when current draw is greater than latest stored", async () => {
    repositoryMocks.getNextMissingDrawNumber.mockResolvedValueOnce(3001);
    repositoryMocks.getLatestDraw.mockResolvedValueOnce(draw(3000));
    repositoryMocks.listDraws.mockResolvedValue([draw(3000), draw(2999)]);

    const { CaixaApiError } = await import("@/lib/server/caixa");
    caixaMocks.fetchDrawFromCaixa.mockRejectedValueOnce(new CaixaApiError("Caixa API returned HTTP 500", 500));

    const { syncMissingDrawsFromCaixa } = await import("@/lib/server/service");
    const result = await syncMissingDrawsFromCaixa("MegaSena", { batchSize: 1, startAt: 3001 });

    expect(result.stopReason).toBe("not_found_limit");
    expect(result.error).toBeUndefined();
    expect(result.skippedDrawNumbers).toEqual([3001]);
    expect(result.nextDrawNumber).toBeNull();
  });

  it("keeps real API errors visible when they are not future draw responses", async () => {
    repositoryMocks.getNextMissingDrawNumber.mockResolvedValueOnce(5);
    repositoryMocks.getLatestDraw.mockResolvedValueOnce(draw(10));
    repositoryMocks.listDraws.mockResolvedValue([draw(10)]);

    const { CaixaApiError } = await import("@/lib/server/caixa");
    caixaMocks.fetchDrawFromCaixa.mockRejectedValueOnce(new CaixaApiError("Caixa API returned HTTP 500", 500));

    const { syncMissingDrawsFromCaixa } = await import("@/lib/server/service");
    const result = await syncMissingDrawsFromCaixa("MegaSena", { batchSize: 1, startAt: 5 });

    expect(result.stopReason).toBe("error");
    expect(result.error).toBe("Caixa API returned HTTP 500");
    expect(result.nextDrawNumber).toBe(5);
  });

  it("stops when Caixa returns a previous or different draw", async () => {
    repositoryMocks.getNextMissingDrawNumber.mockResolvedValueOnce(10);
    caixaMocks.fetchDrawFromCaixa.mockResolvedValueOnce(draw(9));
    repositoryMocks.listDraws.mockResolvedValue([draw(9)]);

    const { syncMissingDrawsFromCaixa } = await import("@/lib/server/service");
    const previousResult = await syncMissingDrawsFromCaixa("MegaSena", { batchSize: 1, startAt: 10 });

    expect(previousResult.stopReason).toBe("api_returned_previous_draw");

    vi.clearAllMocks();
    repositoryMocks.getNextMissingDrawNumber.mockResolvedValueOnce(10);
    caixaMocks.fetchDrawFromCaixa.mockResolvedValueOnce(draw(11));
    repositoryMocks.listDraws.mockResolvedValue([draw(9)]);

    const differentResult = await syncMissingDrawsFromCaixa("MegaSena", { batchSize: 1, startAt: 10 });

    expect(differentResult.stopReason).toBe("api_returned_different_draw");
    expect(differentResult.skippedDrawNumbers).toEqual([10]);
  });

  it("normalizes batch size and handles unknown lotteries", async () => {
    const { syncMissingDrawsFromCaixa } = await import("@/lib/server/service");

    await expect(syncMissingDrawsFromCaixa("Unknown", { batchSize: 200 })).resolves.toMatchObject({
      batchSize: 25,
      stopReason: "unknown_lottery",
      hasMore: false,
      draws: [],
    });
  });

  it("clamps fractional and oversized sync batch sizes", async () => {
    repositoryMocks.getNextMissingDrawNumber.mockResolvedValueOnce(1);
    caixaMocks.fetchDrawFromCaixa.mockResolvedValueOnce(null);
    repositoryMocks.listDraws.mockResolvedValue([]);

    const { syncMissingDrawsFromCaixa } = await import("@/lib/server/service");
    const result = await syncMissingDrawsFromCaixa("MegaSena", { batchSize: 99.9, startAt: -20 });

    expect(result.batchSize).toBe(25);
    expect(repositoryMocks.getNextMissingDrawNumber).toHaveBeenCalledWith("MegaSena", 1);
  });

  it("loads and collects history from the database only", async () => {
    repositoryMocks.listDraws.mockResolvedValue([draw(2), draw(1)]);

    const { collectMissingDraws, loadLotteryHistory } = await import("@/lib/server/service");

    await expect(loadLotteryHistory("MegaSena")).resolves.toHaveLength(2);
    await expect(collectMissingDraws("MegaSena")).resolves.toMatchObject({ hasMore: false, nextDrawNumber: 3 });
    expect(repositoryMocks.listDraws).toHaveBeenCalledWith("MegaSena");
    expect(caixaMocks.fetchDrawFromCaixa).not.toHaveBeenCalled();
  });
});
