import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDraw } from "@/test/fixtures/builders";

type Repository = typeof import("@/lib/server/repository");

describe("lottery repository with PostgreSQL", () => {
  let pool: Pool | undefined;
  let repository: Repository;

  beforeEach(async () => {
    vi.resetModules();
    repository = await import("@/lib/server/repository");
    const database = await import("@/lib/server/db");
    pool = database.getDatabasePool();
  });

  afterEach(async () => {
    await pool?.end();
  });

  it("migrates a legacy Dupla Sena draw and sanitizes its raw payload", async () => {
    await pool!.query("DROP TABLE IF EXISTS draw_numbers, draws, lotteries CASCADE");
    await pool!.query(`
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

      INSERT INTO draws (
        lottery_slug,
        draw_number,
        draw_date,
        numbers,
        previous_draw_number,
        next_draw_number,
        raw_payload
      )
      VALUES (
        'DuplaSena',
        10,
        '10/01/2026',
        ARRAY['01','02','03','04','05','06','11','12','13','14','15','16'],
        9,
        11,
        '{"source":"luckygames.tips","sourceUrl":"https://example.test","textLines":["raw"],"numero":10}'
      );
    `);

    await repository.ensureSchema();

    const stored = await repository.getDraw("DuplaSena", 10);
    const legacyColumn = await pool!.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'draws' AND column_name = 'numbers'
      ) AS exists
    `);

    expect(legacyColumn.rows[0]?.exists).toBe(false);
    expect(stored?.numberGroups).toEqual([
      ["01", "02", "03", "04", "05", "06"],
      ["11", "12", "13", "14", "15", "16"],
    ]);
    expect(stored?.raw).toEqual({ numero: 10 });
  });

  it("saves and updates a draw while preserving creation and sanitizing PostgreSQL text", async () => {
    const first = await repository.saveDraw(
      buildDraw({
        drawNumber: 20,
        date: "20/01/2026\u0000",
        numbers: ["01", "02", "03", "04", "05", "06\u0000"],
        numberGroups: undefined,
        raw: {
          numero: 20,
          sourceUrl: "https://example.test",
          textLines: ["unsafe\u0000line"],
          nested: { value: "safe\u0000value" },
        } as never,
      }),
    );

    const updated = await repository.saveDraw(
      buildDraw({
        drawNumber: 20,
        date: "21/01/2026",
        numbers: ["07", "08", "09", "10", "11", "12"],
        numberGroups: undefined,
        raw: { numero: 20 },
      }),
    );

    expect(updated.createdAt).toEqual(first.createdAt);
    expect(updated.date).toBe("21/01/2026");
    expect(updated.numbers).toEqual(["07", "08", "09", "10", "11", "12"]);

    const persisted = await repository.getDraw("MegaSena", 20);
    expect(persisted?.raw).toEqual({ numero: 20 });

    const sanitizedFirstWrite = first.raw as unknown as Record<string, unknown>;
    expect(first.date).toBe("20/01/2026");
    expect(first.numbers.at(-1)).toBe("06");
    expect(sanitizedFirstWrite).toEqual({ numero: 20, nested: { value: "safevalue" } });
  });

  it("preserves drawn rows, represents gaps, and returns draws in descending order", async () => {
    await repository.saveDraws([buildDraw({ drawNumber: 1 }), buildDraw({ drawNumber: 3 })]);

    expect(await repository.getNextMissingDrawNumber("MegaSena")).toBe(2);
    expect(await repository.getNextStoredDrawNumber("MegaSena", 1)).toBe(3);

    await repository.saveAbsentDraw("MegaSena", 2, { confirmedByDrawNumber: 3, note: "gap\u0000" });
    await repository.saveAbsentDraw("MegaSena", 3, { shouldNotReplace: true });

    expect(await repository.getNextMissingDrawNumber("MegaSena")).toBe(4);
    expect((await repository.listDraws("MegaSena")).map((draw) => draw.drawNumber)).toEqual([3, 1]);
    expect(await repository.getLatestDraw("MegaSena")).toMatchObject({ drawNumber: 3, status: "drawn" });
    expect(await repository.getDraw("MegaSena", 2)).toBeNull();

    const rows = await pool!.query<{ draw_number: number; raw_payload: unknown; status: string }>(`
      SELECT draw_number, raw_payload, status
      FROM draws
      WHERE lottery_slug = 'MegaSena'
      ORDER BY draw_number
    `);
    expect(rows.rows).toEqual([
      expect.objectContaining({ draw_number: 1, status: "drawn" }),
      { draw_number: 2, raw_payload: { absent: true, reason: "missing_at_source", confirmedByDrawNumber: 3, note: "gap" }, status: "absent" },
      expect.objectContaining({ draw_number: 3, status: "drawn" }),
    ]);
  });

  it("rolls back a single draw when persisting its numbers fails", async () => {
    await repository.ensureSchema();
    await pool!.query(`
      CREATE FUNCTION reject_test_number() RETURNS trigger AS $$
      BEGIN
        IF NEW.number_value = 'FAIL' THEN
          RAISE EXCEPTION 'rejected test number';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER reject_test_number_trigger
      BEFORE INSERT ON draw_numbers
      FOR EACH ROW EXECUTE FUNCTION reject_test_number();
    `);

    try {
      await expect(
        repository.saveDraw(
          buildDraw({ drawNumber: 50, numbers: ["01", "02", "03", "04", "05", "FAIL"], numberGroups: undefined }),
        ),
      ).rejects.toThrow("rejected test number");

      const persisted = await pool!.query("SELECT 1 FROM draws WHERE lottery_slug = 'MegaSena' AND draw_number = 50");
      expect(persisted.rowCount).toBe(0);
    } finally {
      await pool!.query("DROP TRIGGER IF EXISTS reject_test_number_trigger ON draw_numbers");
      await pool!.query("DROP FUNCTION IF EXISTS reject_test_number()");
    }
  });

  it("rolls back the entire batch when a later draw fails", async () => {
    await expect(
      repository.saveDraws([
        buildDraw({ drawNumber: 70 }),
        buildDraw({ lottery: "UnknownLottery", drawNumber: 71 }),
      ]),
    ).rejects.toThrow();

    const persisted = await pool!.query("SELECT 1 FROM draws WHERE lottery_slug = 'MegaSena' AND draw_number = 70");
    expect(persisted.rowCount).toBe(0);
  });
});
