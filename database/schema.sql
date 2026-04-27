CREATE TABLE IF NOT EXISTS lotteries (
  slug TEXT PRIMARY KEY,
  api_slug TEXT NOT NULL UNIQUE,
  count_numbers INTEGER NOT NULL,
  numbers_per_draw INTEGER NOT NULL,
  groups INTEGER[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS draws (
  lottery_slug TEXT NOT NULL REFERENCES lotteries(slug) ON DELETE CASCADE,
  draw_number INTEGER NOT NULL,
  draw_date TEXT,
  previous_draw_number INTEGER,
  next_draw_number INTEGER,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lottery_slug, draw_number)
);

CREATE TABLE IF NOT EXISTS draw_numbers (
  lottery_slug TEXT NOT NULL,
  draw_number INTEGER NOT NULL,
  group_index INTEGER NOT NULL DEFAULT 1,
  number_order INTEGER NOT NULL,
  number_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lottery_slug, draw_number, group_index, number_order),
  FOREIGN KEY (lottery_slug, draw_number) REFERENCES draws(lottery_slug, draw_number) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS draws_lottery_number_desc_idx
  ON draws (lottery_slug, draw_number DESC);

CREATE INDEX IF NOT EXISTS draw_numbers_draw_idx
  ON draw_numbers (lottery_slug, draw_number, group_index, number_order);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'draws'
      AND column_name = 'numbers'
  ) THEN
    ALTER TABLE draws ALTER COLUMN numbers DROP NOT NULL;
    ALTER TABLE draws ALTER COLUMN numbers SET DEFAULT '{}'::TEXT[];

    EXECUTE $migration$
      INSERT INTO draw_numbers (lottery_slug, draw_number, group_index, number_order, number_value, updated_at)
      SELECT
        d.lottery_slug,
        d.draw_number,
        CASE WHEN d.lottery_slug = 'DuplaSena' AND item.ordinality > 6 THEN 2 ELSE 1 END AS group_index,
        CASE WHEN d.lottery_slug = 'DuplaSena' AND item.ordinality > 6 THEN item.ordinality - 6 ELSE item.ordinality END AS number_order,
        item.number_value,
        NOW()
      FROM draws d
      CROSS JOIN LATERAL unnest(d.numbers) WITH ORDINALITY AS item(number_value, ordinality)
      WHERE d.numbers IS NOT NULL
      ON CONFLICT (lottery_slug, draw_number, group_index, number_order) DO UPDATE SET
        number_value = EXCLUDED.number_value,
        updated_at = NOW();
    $migration$;
  END IF;
END $$;

UPDATE draws
SET raw_payload = raw_payload - 'textLines' - 'sourceUrl'
WHERE raw_payload ? 'textLines'
   OR raw_payload ? 'sourceUrl';

UPDATE draws
SET raw_payload = raw_payload - 'source'
WHERE raw_payload->>'source' = 'luckygames.tips';
