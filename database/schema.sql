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
  status TEXT NOT NULL DEFAULT 'drawn' CHECK (status IN ('drawn', 'absent')),
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

ALTER TABLE draws
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'drawn';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'draws_status_check'
      AND conrelid = 'draws'::regclass
  ) THEN
    ALTER TABLE draws
      ADD CONSTRAINT draws_status_check CHECK (status IN ('drawn', 'absent'));
  END IF;
END $$;

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

    ALTER TABLE draws DROP COLUMN numbers;
  END IF;
END $$;

UPDATE draws
SET raw_payload = raw_payload - 'textLines' - 'sourceUrl'
WHERE raw_payload ? 'textLines'
   OR raw_payload ? 'sourceUrl';

UPDATE draws
SET raw_payload = raw_payload - 'source'
WHERE raw_payload->>'source' = 'luckygames.tips';

CREATE TABLE IF NOT EXISTS licenses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  plan TEXT NOT NULL CHECK (plan IN ('pass30', 'lifetime')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS licenses_status_idx
  ON licenses (status, expires_at);

CREATE TABLE IF NOT EXISTS access_tokens (
  token_hash TEXT PRIMARY KEY,
  license_id BIGINT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT 'login' CHECK (purpose IN ('activation', 'login')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS access_tokens_license_idx
  ON access_tokens (license_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_events (
  payment_id TEXT PRIMARY KEY,
  license_id BIGINT REFERENCES licenses(id) ON DELETE SET NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  amount NUMERIC(10,2),
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_usage (
  license_id BIGINT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (license_id, usage_date)
);
