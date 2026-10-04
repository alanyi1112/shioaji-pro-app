-- Additive 備援來源帳本；不修改舊批次、價量列或 publication head。
CREATE TABLE screener_source_universes (
  universe_revision text PRIMARY KEY NOT NULL,
  universe_hash text NOT NULL,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE TABLE screener_source_reviews (
  id text PRIMARY KEY NOT NULL,
  provider text NOT NULL CHECK(provider IN ('official-twse','official-tpex','shioaji-daily-quotes')),
  evidence_hash text NOT NULL,
  status text NOT NULL CHECK(status IN ('verified','pending','invalid')),
  payload text NOT NULL,
  created_at text NOT NULL,
  UNIQUE(provider,evidence_hash)
);
--> statement-breakpoint
CREATE TABLE screener_source_selections (
  selection_key text PRIMARY KEY NOT NULL,
  manifest_hash text NOT NULL UNIQUE,
  universe_revision text NOT NULL,
  market text NOT NULL CHECK(market IN ('TWSE','TPEx')),
  session_date text NOT NULL,
  status text NOT NULL CHECK(status IN ('staging','complete')),
  manifest text NOT NULL,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE TABLE screener_source_selected_rows (
  selection_key text NOT NULL REFERENCES screener_source_selections(selection_key),
  symbol text NOT NULL,
  payload text NOT NULL,
  PRIMARY KEY(selection_key,symbol)
);
--> statement-breakpoint
CREATE TABLE screener_source_comparisons (
  id text PRIMARY KEY NOT NULL,
  selection_key text NOT NULL REFERENCES screener_source_selections(selection_key),
  status text NOT NULL CHECK(status IN ('matched','conflict')),
  payload text NOT NULL,
  created_at text NOT NULL
);
