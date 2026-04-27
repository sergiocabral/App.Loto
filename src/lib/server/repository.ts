import { LOTTERIES } from "@/data/lotteries";
import type { Draw } from "@/lib/types";
import { getDatabasePool } from "@/lib/server/db";

export type StoredDraw = Draw & {
  createdAt: Date;
  updatedAt: Date;
};

function toStoredDraw(row: {
  lottery_slug: string;
  draw_number: number;
  draw_date: string | null;
  numbers: string[];
  previous_draw_number: number | null;
  next_draw_number: number | null;
  raw_payload: unknown;
  created_at: Date;
  updated_at: Date;
}): StoredDraw {
  return {
    lottery: row.lottery_slug,
    drawNumber: row.draw_number,
    date: row.draw_date ?? "",
    numbers: row.numbers,
    previousDrawNumber: row.previous_draw_number,
    nextDrawNumber: row.next_draw_number,
    raw: row.raw_payload as Draw["raw"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ensureSchema(): Promise<void> {
  const pool = getDatabasePool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lotteries (
      slug TEXT PRIMARY KEY,
      api_slug TEXT NOT NULL UNIQUE,
      count_numbers INTEGER NOT NULL,
      numbers_per_draw INTEGER NOT NULL,
      groups INTEGER[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS draws (
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
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS draws_lottery_number_desc_idx
      ON draws (lottery_slug, draw_number DESC);
  `);

  for (const lottery of LOTTERIES) {
    await pool.query(
      `
        INSERT INTO lotteries (slug, api_slug, count_numbers, numbers_per_draw, groups, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (slug) DO UPDATE SET
          api_slug = EXCLUDED.api_slug,
          count_numbers = EXCLUDED.count_numbers,
          numbers_per_draw = EXCLUDED.numbers_per_draw,
          groups = EXCLUDED.groups,
          updated_at = NOW();
      `,
      [lottery.slug, lottery.apiSlug, lottery.countNumbers, lottery.numbersPerDraw, lottery.groups ?? []],
    );
  }
}

export async function saveDraw(draw: Draw): Promise<StoredDraw> {
  await ensureSchema();

  const pool = getDatabasePool();
  const result = await pool.query(
    `
      INSERT INTO draws (
        lottery_slug,
        draw_number,
        draw_date,
        numbers,
        previous_draw_number,
        next_draw_number,
        raw_payload,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
      ON CONFLICT (lottery_slug, draw_number) DO UPDATE SET
        draw_date = EXCLUDED.draw_date,
        numbers = EXCLUDED.numbers,
        previous_draw_number = EXCLUDED.previous_draw_number,
        next_draw_number = EXCLUDED.next_draw_number,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = NOW()
      RETURNING *;
    `,
    [
      draw.lottery,
      draw.drawNumber,
      draw.date,
      draw.numbers,
      draw.previousDrawNumber,
      draw.nextDrawNumber,
      JSON.stringify(draw.raw),
    ],
  );

  return toStoredDraw(result.rows[0]);
}

export async function getDraw(lottery: string, drawNumber: number): Promise<StoredDraw | null> {
  await ensureSchema();

  const pool = getDatabasePool();
  const result = await pool.query(
    `
      SELECT *
      FROM draws
      WHERE lottery_slug = $1 AND draw_number = $2
      LIMIT 1;
    `,
    [lottery, drawNumber],
  );

  return result.rowCount ? toStoredDraw(result.rows[0]) : null;
}

export async function getLatestDraw(lottery: string): Promise<StoredDraw | null> {
  await ensureSchema();

  const pool = getDatabasePool();
  const result = await pool.query(
    `
      SELECT *
      FROM draws
      WHERE lottery_slug = $1
      ORDER BY draw_number DESC
      LIMIT 1;
    `,
    [lottery],
  );

  return result.rowCount ? toStoredDraw(result.rows[0]) : null;
}

export async function listDraws(lottery: string): Promise<StoredDraw[]> {
  await ensureSchema();

  const pool = getDatabasePool();
  const result = await pool.query(
    `
      SELECT *
      FROM draws
      WHERE lottery_slug = $1
      ORDER BY draw_number DESC;
    `,
    [lottery],
  );

  return result.rows.map(toStoredDraw);
}

export async function getNextDrawNumberFromStorage(lottery: string): Promise<number> {
  const latest = await getLatestDraw(lottery);
  return latest ? latest.drawNumber + 1 : 1;
}
