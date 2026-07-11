#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { config } = require("dotenv");
const { Pool } = require("pg");

const fileEnvironment = {};
config({ path: path.resolve(__dirname, "../.env"), processEnv: fileEnvironment, quiet: true });
config({
  path: path.resolve(__dirname, "../.env.local"),
  override: true,
  processEnv: fileEnvironment,
  quiet: true,
});
const runtimeEnvironment = { ...fileEnvironment, ...process.env };

function isEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function getMigrationConfig(environment = runtimeEnvironment) {
  const host = environment.POSTGRES_HOST;
  const user = environment.POSTGRES_USER;
  const password = environment.POSTGRES_PASSWORD;
  const database = environment.POSTGRES_DATABASE || user;
  const rawPort = String(environment.POSTGRES_PORT || "5432");
  const port = Number(rawPort);
  const allowInsecureSsl = isEnabled(environment.POSTGRES_SSL_ALLOW_INSECURE);

  if (environment.NODE_ENV === "production" && allowInsecureSsl) {
    throw new Error("POSTGRES_SSL_ALLOW_INSECURE cannot be enabled in production.");
  }

  if (!host || !user || !password || !database) {
    throw new Error("Missing PostgreSQL configuration. Check POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DATABASE.");
  }

  if (!/^\d+$/.test(rawPort) || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("POSTGRES_PORT must be an integer between 1 and 65535.");
  }

  return {
    database,
    host,
    password,
    port,
    ssl: isEnabled(environment.POSTGRES_SSL) ? { rejectUnauthorized: !allowInsecureSsl } : undefined,
    user,
  };
}

async function migrate({ environment = runtimeEnvironment, readFile = fs.readFileSync, createPool = (options) => new Pool(options), logger = console } = {}) {
  const config = getMigrationConfig(environment);
  const schema = readFile(path.resolve(__dirname, "../database/schema.sql"), "utf8");
  const pool = createPool(config);
  let client;
  let transactionStarted = false;

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(schema);
    await client.query("COMMIT");
    transactionStarted = false;
    logger.log("Database schema is ready.");
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Database migration and rollback both failed.");
      }
    }

    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { getMigrationConfig, isEnabled, migrate };
