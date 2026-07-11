import { execFile as execFileCallback } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { Client } from "pg";
import { beforeEach, describe, expect, inject, it } from "vitest";

const execFile = promisify(execFileCallback);
const require = createRequire(import.meta.url);
const { migrate } = require("../../scripts/migrate.cjs") as {
  migrate(options: { environment: Record<string, string>; logger?: Pick<Console, "log"> }): Promise<void>;
};

function getEnvironment(connectionString: string): Record<string, string> & { NODE_ENV: string } {
  const url = new URL(connectionString);
  return {
    NEXT_RUNTIME_PROVIDER: "cloudflare",
    NODE_ENV: "test",
    POSTGRES_DATABASE: url.pathname.slice(1),
    POSTGRES_HOST: url.hostname,
    POSTGRES_PASSWORD: decodeURIComponent(url.password),
    POSTGRES_PORT: url.port,
    POSTGRES_SSL: "false",
    POSTGRES_USER: decodeURIComponent(url.username),
  };
}

async function withClient<T>(connectionString: string, action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

describe("database migration with PostgreSQL", () => {
  const postgresUrl = inject("postgresUrl");
  const environment = getEnvironment(postgresUrl);

  beforeEach(async () => {
    await withClient(postgresUrl, (client) => client.query("DROP TABLE IF EXISTS draw_numbers, draws, lotteries CASCADE"));
  });

  it("applies a clean schema twice through the CLI", async () => {
    const runMigration = () =>
      execFile(process.execPath, ["scripts/migrate.cjs"], {
        cwd: process.cwd(),
        env: environment,
      });

    await runMigration();
    await runMigration();

    const result = await withClient(postgresUrl, (client) =>
      client.query<{ legacy_column: boolean; tables: number }>(`
        SELECT
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'draws' AND column_name = 'numbers'
          ) AS legacy_column,
          (
            SELECT COUNT(*)::INTEGER FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name IN ('lotteries', 'draws', 'draw_numbers')
          ) AS tables
      `),
    );

    expect(result.rows[0]).toEqual({ legacy_column: false, tables: 3 });
  });

  it("migrates legacy number arrays idempotently", async () => {
    await withClient(postgresUrl, (client) =>
      client.query(`
        CREATE TABLE lotteries (
          slug TEXT PRIMARY KEY,
          api_slug TEXT NOT NULL UNIQUE,
          count_numbers INTEGER NOT NULL,
          numbers_per_draw INTEGER NOT NULL,
          groups INTEGER[] NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE draws (
          lottery_slug TEXT NOT NULL REFERENCES lotteries(slug) ON DELETE CASCADE,
          draw_number INTEGER NOT NULL,
          draw_date TEXT,
          numbers TEXT[] NOT NULL,
          previous_draw_number INTEGER,
          next_draw_number INTEGER,
          raw_payload JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (lottery_slug, draw_number)
        );
        INSERT INTO lotteries (slug, api_slug, count_numbers, numbers_per_draw, groups)
        VALUES ('DuplaSena', 'duplasena', 50, 12, ARRAY[6, 6]);
        INSERT INTO draws (lottery_slug, draw_number, draw_date, numbers, raw_payload)
        VALUES (
          'DuplaSena', 8, '08/01/2026',
          ARRAY['01','02','03','04','05','06','11','12','13','14','15','16'],
          '{"source":"luckygames.tips","sourceUrl":"https://example.test","textLines":["raw"],"numero":8}'
        );
      `),
    );

    await migrate({ environment, logger: { log: () => undefined } });
    await migrate({ environment, logger: { log: () => undefined } });

    const migrated = await withClient(postgresUrl, (client) =>
      client.query<{ group_index: number; number_values: string[]; raw_payload: unknown }>(`
        SELECT
          dn.group_index,
          array_agg(dn.number_value ORDER BY dn.number_order) AS number_values,
          d.raw_payload
        FROM draws d
        JOIN draw_numbers dn USING (lottery_slug, draw_number)
        WHERE d.lottery_slug = 'DuplaSena' AND d.draw_number = 8
        GROUP BY dn.group_index, d.raw_payload
        ORDER BY dn.group_index
      `),
    );

    expect(migrated.rows).toEqual([
      { group_index: 1, number_values: ["01", "02", "03", "04", "05", "06"], raw_payload: { numero: 8 } },
      { group_index: 2, number_values: ["11", "12", "13", "14", "15", "16"], raw_payload: { numero: 8 } },
    ]);
  });

  it("rolls back every schema change when a legacy migration fails", async () => {
    await withClient(postgresUrl, (client) =>
      client.query(`
        CREATE TABLE lotteries (
          slug TEXT PRIMARY KEY,
          api_slug TEXT NOT NULL UNIQUE,
          count_numbers INTEGER NOT NULL,
          numbers_per_draw INTEGER NOT NULL,
          groups INTEGER[] NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE draws (
          lottery_slug TEXT NOT NULL REFERENCES lotteries(slug),
          draw_number INTEGER NOT NULL,
          numbers TEXT[] NOT NULL,
          PRIMARY KEY (lottery_slug, draw_number)
        );
      `),
    );

    await expect(migrate({ environment, logger: { log: () => undefined } })).rejects.toThrow("raw_payload");

    const state = await withClient(postgresUrl, (client) =>
      client.query<{ draw_numbers_exists: boolean; numbers_exists: boolean; status_exists: boolean }>(`
        SELECT
          to_regclass('public.draw_numbers') IS NOT NULL AS draw_numbers_exists,
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'draws' AND column_name = 'numbers'
          ) AS numbers_exists,
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'draws' AND column_name = 'status'
          ) AS status_exists
      `),
    );

    expect(state.rows[0]).toEqual({ draw_numbers_exists: false, numbers_exists: true, status_exists: false });

    await withClient(postgresUrl, (client) => client.query("DROP TABLE draws, lotteries CASCADE"));
    await migrate({ environment, logger: { log: () => undefined } });
  });
});
