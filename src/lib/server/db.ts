import path from "node:path";
import { config } from "dotenv";
import { Pool } from "pg";

config({ path: path.resolve(process.cwd(), "../.env") });
config({ path: path.resolve(process.cwd(), ".env.local"), override: true });

let pool: Pool | null = null;

function boolFromEnv(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").toLowerCase());
}

export function getDatabasePool(): Pool {
  if (pool) {
    return pool;
  }

  const host = process.env.POSTGRES_HOST;
  const user = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD;
  const database = process.env.POSTGRES_DATABASE ?? process.env.POSTGRES_USER;
  const port = Number.parseInt(process.env.POSTGRES_PORT ?? "5432", 10);
  const useSsl = boolFromEnv(process.env.POSTGRES_SSL);
  const allowInsecureSsl = boolFromEnv(process.env.POSTGRES_SSL_ALLOW_INSECURE);

  if (useSsl && allowInsecureSsl && process.env.NODE_ENV === "production") {
    throw new Error("POSTGRES_SSL_ALLOW_INSECURE cannot be enabled in production.");
  }

  const ssl = useSsl ? { rejectUnauthorized: !allowInsecureSsl } : undefined;

  if (!host || !user || !password || !database) {
    throw new Error("Missing PostgreSQL configuration. Check POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DATABASE.");
  }

  pool = new Pool({
    host,
    user,
    password,
    database,
    port,
    ssl,
    max: 10,
    connectionTimeoutMillis: Number.parseInt(process.env.POSTGRES_CONNECTION_TIMEOUT_MS ?? "5000", 10),
    idleTimeoutMillis: Number.parseInt(process.env.POSTGRES_IDLE_TIMEOUT_MS ?? "30000", 10),
    query_timeout: Number.parseInt(process.env.POSTGRES_QUERY_TIMEOUT_MS ?? "30000", 10),
    statement_timeout: Number.parseInt(process.env.POSTGRES_STATEMENT_TIMEOUT_MS ?? "30000", 10),
  });

  return pool;
}
