import { Pool, type PoolConfig } from "pg";
import { getCloudflareEnv, getServerEnvValue } from "@/lib/server/env";

let pool: Pool | null = null;

type HyperdriveBinding = {
  connectionString?: string;
};

type PostgresConfig = PoolConfig & {
  connectionString?: string;
  maxUses?: number;
};

function boolFromEnv(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").toLowerCase());
}

function integerFromEnv(
  name: string,
  defaultValue: string,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number {
  const rawValue = (getServerEnvValue(name) ?? defaultValue).trim();

  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }

  return value;
}

function getHyperdriveConnectionString(): string | undefined {
  const explicitConnectionString = getServerEnvValue("HYPERDRIVE_CONNECTION_STRING")?.trim();

  if (explicitConnectionString) {
    return explicitConnectionString;
  }

  const binding = getCloudflareEnv()?.HYPERDRIVE as HyperdriveBinding | undefined;
  return typeof binding?.connectionString === "string" ? binding.connectionString : undefined;
}

function isCloudflareRuntime(): boolean {
  return getServerEnvValue("NEXT_RUNTIME_PROVIDER") === "cloudflare" || getServerEnvValue("CF_WORKER_NAME") !== undefined;
}

function getPostgresConfig(): PostgresConfig {
  const hyperdriveConnectionString = getHyperdriveConnectionString();
  const host = getServerEnvValue("POSTGRES_HOST");
  const user = getServerEnvValue("POSTGRES_USER");
  const password = getServerEnvValue("POSTGRES_PASSWORD");
  const database = getServerEnvValue("POSTGRES_DATABASE") ?? user;
  const useSsl = boolFromEnv(getServerEnvValue("POSTGRES_SSL"));
  const allowInsecureSsl = boolFromEnv(getServerEnvValue("POSTGRES_SSL_ALLOW_INSECURE"));

  if (useSsl && allowInsecureSsl && process.env.NODE_ENV === "production") {
    throw new Error("POSTGRES_SSL_ALLOW_INSECURE cannot be enabled in production.");
  }

  const ssl = useSsl ? { rejectUnauthorized: !allowInsecureSsl } : undefined;
  const baseConfig = {
    ssl,
    max: integerFromEnv("POSTGRES_POOL_MAX", isCloudflareRuntime() ? "1" : "10", { min: 1 }),
    maxUses:
      integerFromEnv("POSTGRES_POOL_MAX_USES", isCloudflareRuntime() ? "1" : "0", { min: 0 }) || undefined,
    connectionTimeoutMillis: integerFromEnv("POSTGRES_CONNECTION_TIMEOUT_MS", "5000", { min: 0 }),
    idleTimeoutMillis: integerFromEnv("POSTGRES_IDLE_TIMEOUT_MS", "30000", { min: 0 }),
    query_timeout: integerFromEnv("POSTGRES_QUERY_TIMEOUT_MS", "30000", { min: 0 }),
    statement_timeout: integerFromEnv("POSTGRES_STATEMENT_TIMEOUT_MS", "30000", { min: 0 }),
  } satisfies PostgresConfig;

  if (hyperdriveConnectionString) {
    return {
      ...baseConfig,
      connectionString: hyperdriveConnectionString,
    };
  }

  const missingFields = Object.entries({
    POSTGRES_HOST: host,
    POSTGRES_USER: user,
    POSTGRES_PASSWORD: password,
    POSTGRES_DATABASE: database,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missingFields.length > 0) {
    throw new Error(
      `Missing PostgreSQL configuration: ${missingFields.join(", ")}. Check POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DATABASE.`,
    );
  }

  return {
    ...baseConfig,
    host,
    user,
    password,
    database,
    port: integerFromEnv("POSTGRES_PORT", "5432", { min: 1, max: 65_535 }),
  };
}

export function getDatabasePool(): Pool {
  if (pool) {
    return pool;
  }

  pool = new Pool(getPostgresConfig());

  return pool;
}
