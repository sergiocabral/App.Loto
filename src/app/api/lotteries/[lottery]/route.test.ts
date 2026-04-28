import { afterEach, describe, expect, it, vi } from "vitest";
import type { Draw } from "@/lib/types";

const serviceMocks = vi.hoisted(() => ({
  collectMissingDraws: vi.fn(),
  fetchAndStoreDrawFromCaixa: vi.fn(),
  getStoredDraw: vi.fn(),
  loadLotteryHistory: vi.fn(),
  syncMissingDrawsFromCaixa: vi.fn(),
}));

vi.mock("@/lib/server/service", () => serviceMocks);

function draw(drawNumber: number, overrides: Partial<Draw> = {}): Draw {
  return {
    lottery: "MegaSena",
    drawNumber,
    date: "01/01/2026",
    numbers: ["01", "02", "03", "04", "05", "06"],
    numberGroups: [["01", "02", "03", "04", "05", "06"]],
    previousDrawNumber: drawNumber - 1 || null,
    nextDrawNumber: drawNumber + 1,
    raw: {},
    ...overrides,
  };
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("lottery route handlers", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns 404 for unknown lotteries on GET and POST", async () => {
    const route = await import("@/app/api/lotteries/[lottery]/route");

    const getResponse = await route.GET(new Request("http://localhost/api/lotteries/Unknown"), {
      params: Promise.resolve({ lottery: "Unknown" }),
    });
    const postResponse = await route.POST(new Request("http://localhost/api/lotteries/Unknown", { method: "POST" }), {
      params: Promise.resolve({ lottery: "Unknown" }),
    });

    expect(getResponse.status).toBe(404);
    expect(await readJson(getResponse)).toEqual({ error: "Unknown lottery" });
    expect(postResponse.status).toBe(404);
    expect(await readJson(postResponse)).toEqual({ error: "Unknown lottery" });
  });

  it("reads a specific draw from the database and returns JSON", async () => {
    serviceMocks.getStoredDraw.mockResolvedValueOnce(draw(3000));
    const route = await import("@/app/api/lotteries/[lottery]/route");

    const response = await route.GET(new Request("http://localhost/api/lotteries/MegaSena?draw=3000"), {
      params: Promise.resolve({ lottery: "MegaSena" }),
    });
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(serviceMocks.getStoredDraw).toHaveBeenCalledWith("MegaSena", 3000);
    expect(payload.lottery).toBe("MegaSena");
    expect(payload.draw).toMatchObject({ drawNumber: 3000 });
    expect(payload.text).toContain("03000 | 01/01/2026");
  });

  it("returns legacy text for specific draw from the database", async () => {
    serviceMocks.getStoredDraw.mockResolvedValueOnce(draw(3000));
    const route = await import("@/app/api/lotteries/[lottery]/route");

    const response = await route.GET(new Request("http://localhost/api/lotteries/MegaSena?format=legacy&draw=3000"), {
      params: Promise.resolve({ lottery: "MegaSena" }),
    });

    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("03000 | 01/01/2026 | 01 02 03 04 05 06\n--------------------------------------\n");
  });

  it("returns empty text for missing specific draw in legacy format", async () => {
    serviceMocks.getStoredDraw.mockResolvedValueOnce(null);
    const route = await import("@/app/api/lotteries/[lottery]/route");

    const response = await route.GET(new Request("http://localhost/api/lotteries/MegaSena?format=legacy&draw=999999"), {
      params: Promise.resolve({ lottery: "MegaSena" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("");
  });

  it("rejects invalid GET draw values", async () => {
    const route = await import("@/app/api/lotteries/[lottery]/route");

    const response = await route.GET(new Request("http://localhost/api/lotteries/MegaSena?draw=0"), {
      params: Promise.resolve({ lottery: "MegaSena" }),
    });

    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: "Draw number must be a positive integer" });
  });

  it("strictly rejects non-integer GET draw values", async () => {
    const route = await import("@/app/api/lotteries/[lottery]/route");

    const response = await route.GET(new Request("http://localhost/api/lotteries/MegaSena?draw=123abc"), {
      params: Promise.resolve({ lottery: "MegaSena" }),
    });

    expect(response.status).toBe(400);
    expect(serviceMocks.getStoredDraw).not.toHaveBeenCalled();
  });

  it("returns history JSON and uses collectMissingDraws by default", async () => {
    const history = [draw(2), draw(1)];
    serviceMocks.collectMissingDraws.mockResolvedValueOnce({ draws: history, hasMore: false, nextDrawNumber: 3 });
    const route = await import("@/app/api/lotteries/[lottery]/route");

    const response = await route.GET(new Request("http://localhost/api/lotteries/MegaSena"), {
      params: Promise.resolve({ lottery: "MegaSena" }),
    });
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(serviceMocks.collectMissingDraws).toHaveBeenCalledWith("MegaSena");
    expect(serviceMocks.loadLotteryHistory).not.toHaveBeenCalled();
    expect(payload.draws).toHaveLength(2);
    expect(payload.text).toContain("00002 | 01/01/2026");
  });

  it("can skip collection and load history only", async () => {
    serviceMocks.loadLotteryHistory.mockResolvedValueOnce([draw(1)]);
    const route = await import("@/app/api/lotteries/[lottery]/route");

    const response = await route.GET(new Request("http://localhost/api/lotteries/MegaSena?collect=false"), {
      params: Promise.resolve({ lottery: "MegaSena" }),
    });
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(serviceMocks.collectMissingDraws).not.toHaveBeenCalled();
    expect(serviceMocks.loadLotteryHistory).toHaveBeenCalledWith("MegaSena");
    expect(payload.collection).toBeNull();
  });

  it("returns legacy text for history", async () => {
    serviceMocks.collectMissingDraws.mockResolvedValueOnce({ draws: [draw(2), draw(1)], hasMore: false, nextDrawNumber: 3 });
    const route = await import("@/app/api/lotteries/[lottery]/route");

    const response = await route.GET(new Request("http://localhost/api/lotteries/MegaSena?format=legacy"), {
      params: Promise.resolve({ lottery: "MegaSena" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toContain("00002 | 01/01/2026");
  });

  it("runs sync-caixa POST and returns synchronized draws", async () => {
    const history = [draw(2), draw(1)];
    serviceMocks.syncMissingDrawsFromCaixa.mockResolvedValueOnce({
      draws: history,
      savedDraws: [draw(2)],
      attemptedDrawNumbers: [2],
      skippedDrawNumbers: [],
      currentDrawNumber: 2,
      nextDrawNumber: 3,
      hasMore: true,
      totalStoredDraws: 2,
      newestDrawNumber: 2,
      oldestDrawNumber: 1,
      consecutiveMisses: 0,
      batchSize: 1,
      stopReason: "batch_completed",
    });
    const route = await import("@/app/api/lotteries/[lottery]/route");

    const response = await route.POST(
      new Request("http://localhost/api/lotteries/MegaSena", {
        body: JSON.stringify({ action: "sync-caixa", batchSize: "1", startAt: "2" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ lottery: "MegaSena" }) },
    );
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(serviceMocks.syncMissingDrawsFromCaixa).toHaveBeenCalledWith("MegaSena", { batchSize: 1, startAt: 2 });
    expect(payload.sync).toMatchObject({ currentDrawNumber: 2, stopReason: "batch_completed" });
    expect(payload.draws).toHaveLength(2);
  });

  it("falls back to fetch-draw action and validates draw number", async () => {
    const route = await import("@/app/api/lotteries/[lottery]/route");

    const invalidResponse = await route.POST(
      new Request("http://localhost/api/lotteries/MegaSena", {
        body: JSON.stringify({ action: "fetch-draw", drawNumber: 0 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ lottery: "MegaSena" }) },
    );

    expect(invalidResponse.status).toBe(400);
    expect(await readJson(invalidResponse)).toEqual({ error: "Draw number must be a positive integer" });

    serviceMocks.fetchAndStoreDrawFromCaixa.mockResolvedValueOnce(draw(5));
    const response = await route.POST(
      new Request("http://localhost/api/lotteries/MegaSena", {
        body: JSON.stringify({ action: "fetch-draw", drawNumber: "5" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ lottery: "MegaSena" }) },
    );
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(serviceMocks.fetchAndStoreDrawFromCaixa).toHaveBeenCalledWith("MegaSena", 5);
    expect(payload.draw).toMatchObject({ drawNumber: 5 });
  });

  it("rejects invalid sync body values before calling the service", async () => {
    const route = await import("@/app/api/lotteries/[lottery]/route");

    const response = await route.POST(
      new Request("http://localhost/api/lotteries/MegaSena", {
        body: JSON.stringify({ action: "sync-caixa", batchSize: "abc", startAt: "nope" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ lottery: "MegaSena" }) },
    );

    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: "Batch size must be a positive integer up to 25" });
    expect(serviceMocks.syncMissingDrawsFromCaixa).not.toHaveBeenCalled();
  });

  it("keeps sync-caixa public while protecting explicit fetch-draw when a token is configured", async () => {
    vi.stubEnv("LUCKYGAMES_ADMIN_TOKEN", "secret-token");
    serviceMocks.syncMissingDrawsFromCaixa.mockResolvedValueOnce({
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
      batchSize: 1,
      stopReason: "not_found_limit",
    });
    const route = await import("@/app/api/lotteries/[lottery]/route");

    const publicSync = await route.POST(
      new Request("http://localhost/api/lotteries/MegaSena", {
        body: JSON.stringify({ action: "sync-caixa", batchSize: 1 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ lottery: "MegaSena" }) },
    );

    expect(publicSync.status).toBe(200);
    expect(serviceMocks.syncMissingDrawsFromCaixa).toHaveBeenCalledWith("MegaSena", { batchSize: 1 });

    const unauthorizedFetch = await route.POST(
      new Request("http://localhost/api/lotteries/MegaSena", {
        body: JSON.stringify({ action: "fetch-draw", drawNumber: 5 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ lottery: "MegaSena" }) },
    );

    expect(unauthorizedFetch.status).toBe(401);
    expect(serviceMocks.fetchAndStoreDrawFromCaixa).not.toHaveBeenCalled();

    serviceMocks.fetchAndStoreDrawFromCaixa.mockResolvedValueOnce(draw(5));
    const authorizedFetch = await route.POST(
      new Request("http://localhost/api/lotteries/MegaSena", {
        body: JSON.stringify({ action: "fetch-draw", drawNumber: 5 }),
        headers: {
          authorization: "Bearer secret-token",
          "content-type": "application/json",
        },
        method: "POST",
      }),
      { params: Promise.resolve({ lottery: "MegaSena" }) },
    );

    expect(authorizedFetch.status).toBe(200);
    expect(serviceMocks.fetchAndStoreDrawFromCaixa).toHaveBeenCalledWith("MegaSena", 5);
  });

  it("rejects mutation requests with unsupported content-type or large body", async () => {
    const route = await import("@/app/api/lotteries/[lottery]/route");

    const unsupportedContentType = await route.POST(
      new Request("http://localhost/api/lotteries/MegaSena", {
        body: JSON.stringify({ action: "sync-caixa" }),
        headers: { "content-type": "text/plain" },
        method: "POST",
      }),
      { params: Promise.resolve({ lottery: "MegaSena" }) },
    );

    expect(unsupportedContentType.status).toBe(415);

    const largeBody = await route.POST(
      new Request("http://localhost/api/lotteries/MegaSena", {
        body: JSON.stringify({ action: "sync-caixa", filler: "x".repeat(5000) }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ lottery: "MegaSena" }) },
    );

    expect(largeBody.status).toBe(413);
    expect(serviceMocks.syncMissingDrawsFromCaixa).not.toHaveBeenCalled();
  });

  it("rate limits repeated mutation requests by IP and lottery", async () => {
    serviceMocks.syncMissingDrawsFromCaixa.mockResolvedValue({
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
      batchSize: 1,
      stopReason: "not_found_limit",
    });
    const route = await import("@/app/api/lotteries/[lottery]/route");

    let lastResponse: Response | null = null;

    for (let index = 0; index < 31; index += 1) {
      lastResponse = await route.POST(
        new Request("http://localhost/api/lotteries/MegaSena", {
          body: JSON.stringify({ action: "sync-caixa", batchSize: 1 }),
          headers: {
            "content-type": "application/json",
            "x-real-ip": "203.0.113.10",
          },
          method: "POST",
        }),
        { params: Promise.resolve({ lottery: "MegaSena" }) },
      );
    }

    expect(lastResponse?.status).toBe(429);
  });

  it("uses empty body when POST JSON is invalid", async () => {
    const route = await import("@/app/api/lotteries/[lottery]/route");

    const response = await route.POST(
      new Request("http://localhost/api/lotteries/MegaSena", {
        body: "not-json",
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ lottery: "MegaSena" }) },
    );

    expect(response.status).toBe(400);
  });
});
