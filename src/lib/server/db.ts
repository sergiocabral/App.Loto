import path from "node:path";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { config } from "dotenv";
import { Pool, type PoolConfig } from "pg";

config({ path: path.resolve(process.cwd(), ".env") });
config({ path: path.resolve(process.cwd(), ".env.local"), override: true });

let pool: Pool | null = null;

type PostgresConfig = PoolConfig & {
  connectionString?: string;
  maxUses?: number;
};

function boolFromEnv(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").toLowerCase());
}

function getEnvValue(name: string): string | undefined {
  const processValue = process.env[name];

  if (processValue) {
    return processValue;
  }

  try {
    const cloudflareValue = (getCloudflareContext().env as Record<string, unknown>)[name];
    return typeof cloudflareValue === "string" ? cloudflareValue : undefined;
  } catch {
    return undefined;
  }
}

function isCloudflareRuntime(): boolean {
  return getEnvValue("NEXT_RUNTIME_PROVIDER") === "cloudflare" || getEnvValue("CF_WORKER_NAME") !== undefined;
}

function getPostgresConfig(): PostgresConfig {
  const hyperdriveConnectionString = getEnvValue("HYPERDRIVE_CONNECTION_STRING");
  const host = getEnvValue("POSTGRES_HOST");
  const user = getEnvValue("POSTGRES_USER");
  const password = getEnvValue("POSTGRES_PASSWORD");
  const database = getEnvValue("POSTGRES_DATABASE") ?? user;
  const port = Number.parseInt(getEnvValue("POSTGRES_PORT") ?? "5432", 10);
  const useSsl = boolFromEnv(getEnvValue("POSTGRES_SSL"));
  const allowInsecureSsl = boolFromEnv(getEnvValue("POSTGRES_SSL_ALLOW_INSECURE"));

  if (useSsl && allowInsecureSsl && process.env.NODE_ENV === "production") {
    throw new Error("POSTGRES_SSL_ALLOW_INSECURE cannot be enabled in production.");
  }

  const ssl = useSsl ? { rejectUnauthorized: !allowInsecureSsl } : undefined;
  const baseConfig = {
    ssl,
    max: Number.parseInt(getEnvValue("POSTGRES_POOL_MAX") ?? (isCloudflareRuntime() ? "1" : "10"), 10),
    maxUses: Number.parseInt(getEnvValue("POSTGRES_POOL_MAX_USES") ?? (isCloudflareRuntime() ? "1" : "0"), 10) || undefined,
    connectionTimeoutMillis: Number.parseInt(getEnvValue("POSTGRES_CONNECTION_TIMEOUT_MS") ?? "5000", 10),
    idleTimeoutMillis: Number.parseInt(getEnvValue("POSTGRES_IDLE_TIMEOUT_MS") ?? "30000", 10),
    query_timeout: Number.parseInt(getEnvValue("POSTGRES_QUERY_TIMEOUT_MS") ?? "30000", 10),
    statement_timeout: Number.parseInt(getEnvValue("POSTGRES_STATEMENT_TIMEOUT_MS") ?? "30000", 10),
  } satisfies PostgresConfig;

  if (hyperdriveConnectionString) {
    return {
      ...baseConfig,
      connectionString: hyperdriveConnectionString,
    };
  }

  if (!host || !user || !password || !database) {
    throw new Error("Missing PostgreSQL configuration. Check POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DATABASE.");
  }

  return {
    ...baseConfig,
    host,
    user,
    password,
    database,
    port,
  };
}

export function getDatabasePool(): Pool {
  if (pool) {
    return pool;
  }

  pool = new Pool(getPostgresConfig());

  return pool;
}
