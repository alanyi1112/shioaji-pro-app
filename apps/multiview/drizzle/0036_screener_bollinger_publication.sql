-- v8 發布隔離於舊 snapshots，避免舊讀取器／清理器誤讀新版底稿。
CREATE TABLE screener_bollinger_profiles (
  revision integer PRIMARY KEY NOT NULL CHECK(revision>0),
  payload text NOT NULL,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE TABLE screener_bollinger_publications (
  id text PRIMARY KEY NOT NULL,
  publication_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK(status IN ('staging','published','failed')),
  metadata text NOT NULL,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE TABLE screener_bollinger_rows (
  snapshot_id text NOT NULL REFERENCES screener_bollinger_publications(id),
  symbol text NOT NULL,
  payload text NOT NULL,
  PRIMARY KEY(snapshot_id,symbol)
);
--> statement-breakpoint
CREATE TABLE screener_bollinger_head (
  name text PRIMARY KEY NOT NULL CHECK(name='v8'),
  snapshot_id text NOT NULL REFERENCES screener_bollinger_publications(id),
  updated_at text NOT NULL
);
--> statement-breakpoint
CREATE TABLE screener_bollinger_state (
  name text PRIMARY KEY NOT NULL CHECK(name='v8'),
  payload text NOT NULL,
  updated_at text NOT NULL
);
