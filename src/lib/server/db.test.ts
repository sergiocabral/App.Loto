import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  cloudflareEnv: null as Record<string, unknown> | null,
  environment: new Map<string, string>(),
  poolConfigs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/server/env", () => ({
  getCloudflareEnv: () => databaseMocks.cloudflareEnv,
  getServerEnvValue: (name: string) => databaseMocks.environment.get(name),
}));

vi.mock("pg", () => ({
  Pool: function Pool(config: Record<string, unknown>) {
    databaseMocks.poolConfigs.push(config);
  },
}));

async function createPool(environment: Record<string, string> = {}) {
  for (const [name, value] of Object.entries(environment)) {
    databaseMocks.environment.set(name, value);
  }

  const { getDatabasePool } = await import("@/lib/server/db");
  return getDatabasePool();
}

describe("PostgreSQL server configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    databaseMocks.cloudflareEnv = null;
    databaseMocks.environment.clear();
    databaseMocks.poolConfigs.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates one direct pool with safe local defaults", async () => {
    const pool = await createPool({
      POSTGRES_DATABASE: "lottery",
      POSTGRES_HOST: "127.0.0.1",
      POSTGRES_PASSWORD: "secret",
      POSTGRES_USER: "app",
    });
    const samePool = (await import("@/lib/server/db")).getDatabasePool();

    expect(samePool).toBe(pool);
    expect(databaseMocks.poolConfigs).toEqual([
      {
        connectionTimeoutMillis: 5000,
        database: "lottery",
        host: "127.0.0.1",
        idleTimeoutMillis: 30000,
        max: 10,
        maxUses: undefined,
        password: "secret",
        port: 5432,
        query_timeout: 30000,
        ssl: undefined,
        statement_timeout: 30000,
        user: "app",
      },
    ]);
  });

  it("uses Hyperdrive without requiring direct connection fields", async () => {
    await createPool({
      HYPERDRIVE_CONNECTION_STRING: "  postgres://hyperdrive.test/database  ",
      NEXT_RUNTIME_PROVIDER: "cloudflare",
    });

    expect(databaseMocks.poolConfigs[0]).toMatchObject({
      connectionString: "postgres://hyperdrive.test/database",
      max: 1,
      maxUses: 1,
    });
    expect(databaseMocks.poolConfigs[0]).not.toHaveProperty("host");
  });

  it("uses a Hyperdrive binding and applies explicit pool and strict SSL settings", async () => {
    databaseMocks.cloudflareEnv = { HYPERDRIVE: { connectionString: "postgres://binding.test/database" } };

    await createPool({
      POSTGRES_CONNECTION_TIMEOUT_MS: "1000",
      POSTGRES_IDLE_TIMEOUT_MS: "2000",
      POSTGRES_POOL_MAX: "3",
      POSTGRES_POOL_MAX_USES: "40",
      POSTGRES_QUERY_TIMEOUT_MS: "3000",
      POSTGRES_SSL: "yes",
      POSTGRES_STATEMENT_TIMEOUT_MS: "4000",
    });

    expect(databaseMocks.poolConfigs[0]).toMatchObject({
      connectionString: "postgres://binding.test/database",
      connectionTimeoutMillis: 1000,
      idleTimeoutMillis: 2000,
      max: 3,
      maxUses: 40,
      query_timeout: 3000,
      ssl: { rejectUnauthorized: true },
      statement_timeout: 4000,
    });
  });

  it("rejects missing or malformed direct configuration before creating a pool", async () => {
    await expect(createPool({ POSTGRES_HOST: "127.0.0.1", POSTGRES_USER: "app" })).rejects.toThrow(
      "Missing PostgreSQL configuration: POSTGRES_PASSWORD",
    );
    expect(databaseMocks.poolConfigs).toHaveLength(0);

    vi.resetModules();
    databaseMocks.environment.set("POSTGRES_PASSWORD", "secret");
    databaseMocks.environment.set("POSTGRES_PORT", "5432invalid");
    const invalidDatabase = await import("@/lib/server/db");
    expect(() => invalidDatabase.getDatabasePool()).toThrow("POSTGRES_PORT must be an integer");
    expect(databaseMocks.poolConfigs).toHaveLength(0);
  });

  it("rejects insecure SSL in production for every accepted boolean spelling", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(
      createPool({
        HYPERDRIVE_CONNECTION_STRING: "postgres://hyperdrive.test/database",
        POSTGRES_SSL: "on",
        POSTGRES_SSL_ALLOW_INSECURE: "1",
      }),
    ).rejects.toThrow("POSTGRES_SSL_ALLOW_INSECURE cannot be enabled in production");
    expect(databaseMocks.poolConfigs).toHaveLength(0);
  });
});
