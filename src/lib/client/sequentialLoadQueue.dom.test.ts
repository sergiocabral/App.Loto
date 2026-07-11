import { describe, expect, it, vi } from "vitest";
import { createSequentialLoadQueue } from "@/lib/client/sequentialLoadQueue";

function deferred<T>() {
  let reject!: (error: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

describe("createSequentialLoadQueue", () => {
  it("executa uma carga por vez e antecipa itens prioritários", async () => {
    const loads = new Map<string, ReturnType<typeof deferred<string>>>();
    const loader = vi.fn((key: string) => {
      const load = deferred<string>();
      loads.set(key, load);
      return load.promise;
    });
    const queue = createSequentialLoadQueue(loader);

    const first = queue.load("primeiro");
    const second = queue.load("segundo");
    const priority = queue.load("prioridade", { priority: true });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenLastCalledWith("primeiro");

    loads.get("primeiro")?.resolve("primeiro concluído");
    await expect(first).resolves.toBe("primeiro concluído");
    await vi.waitFor(() => expect(loader).toHaveBeenLastCalledWith("prioridade"));

    loads.get("prioridade")?.resolve("prioridade concluída");
    await expect(priority).resolves.toBe("prioridade concluída");
    await vi.waitFor(() => expect(loader).toHaveBeenLastCalledWith("segundo"));

    loads.get("segundo")?.resolve("segundo concluído");
    await expect(second).resolves.toBe("segundo concluído");
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it("deduplica a carga pendente e a remove após falha", async () => {
    const firstLoad = deferred<string>();
    const secondLoad = deferred<string>();
    const loader = vi.fn().mockReturnValueOnce(firstLoad.promise).mockReturnValueOnce(secondLoad.promise);
    const queue = createSequentialLoadQueue(loader);

    const pending = queue.load("MegaSena");
    expect(queue.load("MegaSena", { priority: true })).toBe(pending);
    expect(loader).toHaveBeenCalledTimes(1);

    const rejection = expect(pending).rejects.toThrow("indisponível");
    firstLoad.reject(new Error("indisponível"));
    await rejection;

    const retry = queue.load("MegaSena");
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    secondLoad.resolve("recuperado");
    await expect(retry).resolves.toBe("recuperado");
  });
});
