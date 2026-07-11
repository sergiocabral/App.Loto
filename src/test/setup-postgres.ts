import { afterAll, afterEach, inject } from "vitest";
import { Client } from "pg";

const postgresUrl = inject("postgresUrl");
const managedEnvironmentNames = [
  "NEXT_RUNTIME_PROVIDER",
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DATABASE",
  "POSTGRES_SSL",
] as const;
const originalEnvironment = new Map(managedEnvironmentNames.map((name) => [name, process.env[name]]));

function applyPostgresEnvironment(connectionString: string) {
  const url = new URL(connectionString);

  // Prevent src/lib/server/env.ts from loading a developer's .env files.
  process.env.NEXT_RUNTIME_PROVIDER = "cloudflare";
  process.env.POSTGRES_HOST = url.hostname;
  process.env.POSTGRES_PORT = url.port;
  process.env.POSTGRES_USER = decodeURIComponent(url.username);
  process.env.POSTGRES_PASSWORD = decodeURIComponent(url.password);
  process.env.POSTGRES_DATABASE = url.pathname.slice(1);
  process.env.POSTGRES_SSL = "false";
}

async function resetDatabase() {
  const client = new Client({ connectionString: postgresUrl });

  await client.connect();
  try {
    await client.query("TRUNCATE draw_numbers, draws, lotteries RESTART IDENTITY CASCADE");
  } finally {
    await client.end();
  }
}

applyPostgresEnvironment(postgresUrl);

afterEach(async () => {
  await resetDatabase();
});

afterAll(() => {
  for (const [name, value] of originalEnvironment) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});
