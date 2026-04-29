import { afterEach, describe, expect, it, vi } from "vitest";
import type { Draw } from "@/lib/types";

const envMocks = vi.hoisted(() => ({
  getCronSyncSecret: vi.fn(),
}));

const serviceMocks = vi.hoisted(() => ({
  syncMissingDrawsFromCaixa: vi.fn(),
}));

vi.mock("@/lib/server/env", () => envMocks);
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

function syncResult(overrides: Record<string, unknown> = {}) {
  const draws = [draw(2), draw(1)];

  return {
    draws,
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
    batchSize: 25,
    stopReason: "batch_completed",
    ...overrides,
  };
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("lottery sync cron route", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("requires the cron secret to be configured", async () => {
    envMocks.getCronSyncSecret.mockReturnValueOnce(undefined);
    const route = await import("@/app/api/lotteries/[lottery]/sync/route");

    const response = await route.GET(new Request("http://localhost/api/lotteries/MegaSena/sync"), {
      params: Promise.resolve({ lottery: "MegaSena" }),
    });

    expect(response.status).toBe(503);
    expect(serviceMocks.syncMissingDrawsFromCaixa).not.toHaveBeenCalled();
  });

  it("rejects requests with an invalid secret", async () => {
    envMocks.getCronSyncSecret.mockReturnValueOnce("secret-value");
    const route = await import("@/app/api/lotteries/[lottery]/sync/route");

    const response = await route.GET(
      new Request("http://localhost/api/lotteries/MegaSena/sync", {
        headers: { authorization: "Bearer wrong" },
      }),
      {
        params: Promise.resolve({ lottery: "MegaSena" }),
      },
    );

    expect(response.status).toBe(401);
    expect(serviceMocks.syncMissingDrawsFromCaixa).not.toHaveBeenCalled();
  });

  it("syncs a lottery using Authorization bearer and default batch size", async () => {
    envMocks.getCronSyncSecret.mockReturnValueOnce("secret-value");
    serviceMocks.syncMissingDrawsFromCaixa.mockResolvedValueOnce(syncResult());
    const route = await import("@/app/api/lotteries/[lottery]/sync/route");

    const response = await route.GET(
      new Request("http://localhost/api/lotteries/MegaSena/sync", {
        headers: { authorization: "Bearer secret-value" },
      }),
      {
        params: Promise.resolve({ lottery: "MegaSena" }),
      },
    );
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(serviceMocks.syncMissingDrawsFromCaixa).toHaveBeenCalledWith("MegaSena", { batchSize: 25 });
    expect(payload.lottery).toBe("MegaSena");
    expect(payload.source).toBe("cron");
    expect(payload.nextUrl).toBe("/api/lotteries/MegaSena/sync?batchSize=25&startAt=3");
  });

  it("accepts custom batch size and start draw", async () => {
    envMocks.getCronSyncSecret.mockReturnValueOnce("secret-value");
    serviceMocks.syncMissingDrawsFromCaixa.mockResolvedValueOnce(syncResult({ hasMore: false, nextDrawNumber: null }));
    const route = await import("@/app/api/lotteries/[lottery]/sync/route");

    const response = await route.GET(
      new Request("http://localhost/api/lotteries/MegaSena/sync?batchSize=10&startAt=50", {
        headers: { "x-sync-cron-secret": "secret-value" },
      }),
      {
        params: Promise.resolve({ lottery: "MegaSena" }),
      },
    );
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(serviceMocks.syncMissingDrawsFromCaixa).toHaveBeenCalledWith("MegaSena", { batchSize: 10, startAt: 50 });
    expect(payload.nextUrl).toBeNull();
  });

  it("supports token query fallback without echoing it in nextUrl", async () => {
    envMocks.getCronSyncSecret.mockReturnValueOnce("secret-value");
    serviceMocks.syncMissingDrawsFromCaixa.mockResolvedValueOnce(syncResult());
    const route = await import("@/app/api/lotteries/[lottery]/sync/route");

    const response = await route.GET(new Request("http://localhost/api/lotteries/MegaSena/sync?token=secret-value&batchSize=5"), {
      params: Promise.resolve({ lottery: "MegaSena" }),
    });
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(payload.nextUrl).toBe("/api/lotteries/MegaSena/sync?batchSize=5&startAt=3");
  });

  it("rejects invalid batch or start values", async () => {
    envMocks.getCronSyncSecret.mockReturnValue("secret-value");
    const route = await import("@/app/api/lotteries/[lottery]/sync/route");

    const invalidBatch = await route.GET(
      new Request("http://localhost/api/lotteries/MegaSena/sync?batchSize=99", {
        headers: { authorization: "Bearer secret-value" },
      }),
      {
        params: Promise.resolve({ lottery: "MegaSena" }),
      },
    );
    const invalidStart = await route.GET(
      new Request("http://localhost/api/lotteries/MegaSena/sync?startAt=abc", {
        headers: { authorization: "Bearer secret-value" },
      }),
      {
        params: Promise.resolve({ lottery: "MegaSena" }),
      },
    );

    expect(invalidBatch.status).toBe(400);
    expect(invalidStart.status).toBe(400);
    expect(serviceMocks.syncMissingDrawsFromCaixa).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown lotteries", async () => {
    const route = await import("@/app/api/lotteries/[lottery]/sync/route");

    const response = await route.GET(new Request("http://localhost/api/lotteries/Unknown/sync"), {
      params: Promise.resolve({ lottery: "Unknown" }),
    });

    expect(response.status).toBe(404);
    expect(serviceMocks.syncMissingDrawsFromCaixa).not.toHaveBeenCalled();
  });
});
