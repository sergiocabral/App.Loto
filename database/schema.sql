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
  numbers TEXT[] NOT NULL,
  previous_draw_number INTEGER,
  next_draw_number INTEGER,
  raw_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lottery_slug, draw_number)
);

CREATE INDEX IF NOT EXISTS draws_lottery_number_desc_idx
  ON draws (lottery_slug, draw_number DESC);
