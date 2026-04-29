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

async function readText(response: Response) {
  return response.text();
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
    const body = await readText(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(serviceMocks.syncMissingDrawsFromCaixa).toHaveBeenCalledWith("MegaSena", { batchSize: 25 });
    expect(body).toContain("OK lottery=MegaSena");
    expect(body).toContain("attempted=1");
    expect(body).toContain("saved=1");
    expect(body).toContain("skipped=0");
    expect(body).toContain("batchSize=25");
    expect(body).toContain("hasMore=true");
    expect(body).toContain("nextStartAt=3");
    expect(body).toContain("stopReason=batch_completed");
    expect(body).not.toContain("numbers");
    expect(body).not.toContain("raw");
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
    const body = await readText(response);

    expect(response.status).toBe(200);
    expect(serviceMocks.syncMissingDrawsFromCaixa).toHaveBeenCalledWith("MegaSena", { batchSize: 10, startAt: 50 });
    expect(body).toContain("OK lottery=MegaSena");
    expect(body).toContain("batchSize=10");
    expect(body).toContain("hasMore=false");
    expect(body).toContain("nextStartAt=none");
  });

  it("supports token query fallback without echoing it in nextUrl", async () => {
    envMocks.getCronSyncSecret.mockReturnValueOnce("secret-value");
    serviceMocks.syncMissingDrawsFromCaixa.mockResolvedValueOnce(syncResult());
    const route = await import("@/app/api/lotteries/[lottery]/sync/route");

    const response = await route.GET(new Request("http://localhost/api/lotteries/MegaSena/sync?token=secret-value&batchSize=5"), {
      params: Promise.resolve({ lottery: "MegaSena" }),
    });
    const body = await readText(response);

    expect(response.status).toBe(200);
    expect(body).toContain("OK lottery=MegaSena");
    expect(body).toContain("batchSize=5");
    expect(body).toContain("nextStartAt=3");
    expect(body).not.toContain("secret-value");
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
