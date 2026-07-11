import { describe, expect, it, vi } from "vitest";
import type { TestProject } from "vitest/node";
import { createPostgresSetup } from "./postgres.global-setup";

describe("postgres global setup", () => {
  it("stops the container when schema initialization fails", async () => {
    const schemaError = new Error("schema inválido");
    const stop = vi.fn().mockResolvedValue(undefined);
    const project = { provide: vi.fn() } as unknown as TestProject;

    const error = await createPostgresSetup(project, {
      applySchema: vi.fn().mockRejectedValue(schemaError),
      startContainer: vi.fn().mockResolvedValue({
        getConnectionUri: () => "postgres://postgres:postgres@localhost:5432/postgres",
        stop,
      }),
    }).catch((reason: unknown) => reason);

    expect(stop).toHaveBeenCalledOnce();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { cause: unknown }).message).toContain("inicializado com o schema");
    expect((error as Error & { cause: unknown }).cause).toBe(schemaError);
  });
});
