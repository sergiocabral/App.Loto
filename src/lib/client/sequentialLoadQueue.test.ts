import { describe, expect, it, vi } from "vitest";
import { createSequentialLoadQueue } from "./sequentialLoadQueue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("sequential load queue", () => {
  it("runs queued loads sequentially", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const loader = vi.fn((key: string) => (key === "MegaSena" ? first.promise : second.promise));
    const queue = createSequentialLoadQueue(loader);

    const firstResult = queue.load("MegaSena");
    const secondResult = queue.load("Quina");
    await flushMicrotasks();

    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith("MegaSena");

    first.resolve("mega-loaded");
    await flushMicrotasks();

    expect(await firstResult).toBe("mega-loaded");
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader).toHaveBeenLastCalledWith("Quina");

    second.resolve("quina-loaded");
    await expect(secondResult).resolves.toBe("quina-loaded");
  });

  it("moves a waiting priority load to the front without interrupting the current load", async () => {
    const active = deferred<string>();
    const lotofacil = deferred<string>();
    const quina = deferred<string>();
    const loader = vi.fn((key: string) => {
      if (key === "MegaSena") {
        return active.promise;
      }

      return key === "LotoFacil" ? lotofacil.promise : quina.promise;
    });
    const queue = createSequentialLoadQueue(loader);

    const activeResult = queue.load("MegaSena");
    const waitingResult = queue.load("LotoFacil");
    const priorityResult = queue.load("Quina", { priority: true });
    await flushMicrotasks();

    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith("MegaSena");

    active.resolve("mega-loaded");
    await flushMicrotasks();

    expect(await activeResult).toBe("mega-loaded");
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader).toHaveBeenLastCalledWith("Quina");

    quina.resolve("quina-loaded");
    await flushMicrotasks();

    expect(await priorityResult).toBe("quina-loaded");
    expect(loader).toHaveBeenCalledTimes(3);
    expect(loader).toHaveBeenLastCalledWith("LotoFacil");

    lotofacil.resolve("lotofacil-loaded");
    await expect(waitingResult).resolves.toBe("lotofacil-loaded");
  });

  it("reuses the same promise for duplicate queued keys", async () => {
    const active = deferred<string>();
    const queued = deferred<string>();
    const loader = vi.fn((key: string) => (key === "MegaSena" ? active.promise : queued.promise));
    const queue = createSequentialLoadQueue(loader);

    const activeResult = queue.load("MegaSena");
    const firstQueuedResult = queue.load("Quina");
    const duplicateQueuedResult = queue.load("Quina", { priority: true });
    await flushMicrotasks();

    expect(firstQueuedResult).toBe(duplicateQueuedResult);
    expect(loader).toHaveBeenCalledTimes(1);

    active.resolve("mega-loaded");
    await flushMicrotasks();

    expect(await activeResult).toBe("mega-loaded");
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader).toHaveBeenLastCalledWith("Quina");

    queued.resolve("quina-loaded");
    await expect(firstQueuedResult).resolves.toBe("quina-loaded");
  });
});
