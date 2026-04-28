#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { config } = require("dotenv");
const { Pool } = require("pg");

config({ path: path.resolve(__dirname, "../.env") });
config({ path: path.resolve(__dirname, "../.env.local"), override: true });

const host = process.env.POSTGRES_HOST;
const user = process.env.POSTGRES_USER;
const password = process.env.POSTGRES_PASSWORD;
const database = process.env.POSTGRES_DATABASE || process.env.POSTGRES_USER;
const port = Number.parseInt(process.env.POSTGRES_PORT || "5432", 10);
const ssl = ["1", "true", "yes", "on"].includes(String(process.env.POSTGRES_SSL || "").toLowerCase())
  ? { rejectUnauthorized: false }
  : undefined;

if (!host || !user || !password || !database) {
  console.error("Missing PostgreSQL configuration. Check POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DATABASE.");
  process.exit(1);
}

const schema = fs.readFileSync(path.resolve(__dirname, "../database/schema.sql"), "utf8");
const pool = new Pool({ host, user, password, database, port, ssl });

pool
  .query(schema)
  .then(() => {
    console.log("Database schema is ready.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
