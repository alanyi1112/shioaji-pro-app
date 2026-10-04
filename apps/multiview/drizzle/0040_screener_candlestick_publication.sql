-- v9 為獨立能力；保留所有既有 head、profile、成功與失敗收據。
CREATE TABLE screener_candlestick_publications (
  id text PRIMARY KEY NOT NULL,
  publication_key text NOT NULL,
  status text NOT NULL CHECK(status IN ('staging','published','failed')),
  metadata text NOT NULL,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX screener_candlestick_key_idx ON screener_candlestick_publications(publication_key,status);
--> statement-breakpoint
CREATE TABLE screener_candlestick_rows (
  snapshot_id text NOT NULL REFERENCES screener_candlestick_publications(id),
  symbol text NOT NULL,
  payload text NOT NULL,
  PRIMARY KEY(snapshot_id,symbol)
);
--> statement-breakpoint
CREATE TABLE screener_candlestick_head (
  name text PRIMARY KEY NOT NULL CHECK(name='v9'),
  snapshot_id text NOT NULL REFERENCES screener_candlestick_publications(id),
  updated_at text NOT NULL
);
--> statement-breakpoint
CREATE TABLE screener_candlestick_receipts (
  id text PRIMARY KEY NOT NULL,
  run_id text NOT NULL,
  status text NOT NULL,
  payload text NOT NULL,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE TABLE screener_candlestick_state (
  name text PRIMARY KEY NOT NULL CHECK(name='v9'),
  payload text NOT NULL,
  updated_at text NOT NULL
);
