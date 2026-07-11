import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { getMigrationConfig, migrate } = require("../../scripts/migrate.cjs") as {
  getMigrationConfig(environment: Record<string, string | undefined>): Record<string, unknown>;
  migrate(options: Record<string, unknown>): Promise<void>;
};
const { resolvePort, run } = require("../../scripts/run-next.cjs") as {
  resolvePort(value?: string): string;
  run(options: Record<string, unknown>): void;
};

describe("runtime scripts", () => {
  it("validates ports and preserves an explicit Next port argument", () => {
    expect(resolvePort(undefined)).toBe("4000");
    expect(() => resolvePort("0")).toThrow("PORT must be an integer");
    expect(() => resolvePort("abc")).toThrow("PORT must be an integer");

    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const child = { once: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      handlers[event] = callback;
      return child;
    }) };
    const spawnChild = vi.fn(() => child);

    run({ args: ["dev", "--port=3001"], environment: { PORT: "4100" }, spawnChild });

    const spawnedArgs = (spawnChild.mock.calls as unknown as Array<[string, string[]]>)[0]?.[1];

    expect(spawnedArgs).toEqual(expect.arrayContaining(["dev", "--port=3001"]));
    expect(spawnedArgs).not.toContain("4100");
  });

  it("forwards a child termination signal to the parent boundary", () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const child = { once: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      handlers[event] = callback;
      return child;
    }) };
    const killProcess = vi.fn();

    run({ args: ["start"], killProcess, parentPid: 42, spawnChild: vi.fn(() => child) });
    handlers.exit?.(null, "SIGTERM");

    expect(killProcess).toHaveBeenCalledWith(42, "SIGTERM");
  });

  it("rejects unsafe migration configuration before creating a database pool", () => {
    expect(() =>
      getMigrationConfig({
        NODE_ENV: "production",
        POSTGRES_HOST: "db.example",
        POSTGRES_PASSWORD: "secret",
        POSTGRES_SSL_ALLOW_INSECURE: "YES",
        POSTGRES_USER: "app",
      }),
    ).toThrow("POSTGRES_SSL_ALLOW_INSECURE cannot be enabled in production.");
    expect(() => getMigrationConfig({ POSTGRES_HOST: "db.example", POSTGRES_PASSWORD: "secret", POSTGRES_USER: "app", POSTGRES_PORT: "99999" })).toThrow(
      "POSTGRES_PORT must be an integer",
    );
  });

  it("always closes the migration pool after a schema failure", async () => {
    const end = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn();
    const query = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("schema failed"))
      .mockResolvedValueOnce(undefined);
    const createPool = vi.fn(() => ({ connect: vi.fn().mockResolvedValue({ query, release }), end }));

    await expect(
      migrate({
        createPool,
        environment: { POSTGRES_HOST: "db.example", POSTGRES_PASSWORD: "secret", POSTGRES_USER: "app" },
        readFile: vi.fn(() => "select 1"),
      }),
    ).rejects.toThrow("schema failed");

    expect(end).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "select 1", "ROLLBACK"]);
  });

  it("closes the migration pool when acquiring a client fails", async () => {
    const end = vi.fn().mockResolvedValue(undefined);
    const createPool = vi.fn(() => ({
      connect: vi.fn().mockRejectedValue(new Error("connection failed")),
      end,
    }));

    await expect(
      migrate({
        createPool,
        environment: { POSTGRES_HOST: "db.example", POSTGRES_PASSWORD: "secret", POSTGRES_USER: "app" },
        readFile: vi.fn(() => "select 1"),
      }),
    ).rejects.toThrow("connection failed");

    expect(end).toHaveBeenCalledOnce();
  });
});
