-- 新能力獨立資料，不能改寫舊 OHLCV／volume mapping。未安裝到正式本機資料庫。
CREATE TABLE screener_bollinger_batches (
  target_key text PRIMARY KEY NOT NULL,
  market text NOT NULL CHECK(market IN ('TWSE','TPEx')),
  session_date text NOT NULL,
  status text NOT NULL CHECK(status IN ('pending','running','complete','invalid','exhausted')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0 AND attempts<=18),
  next_attempt_at text,
  reason text,
  report text,
  updated_at text NOT NULL
);
--> statement-breakpoint
CREATE TABLE screener_bollinger_receipts (
  id text PRIMARY KEY NOT NULL,
  target_key text,
  run_id text NOT NULL,
  status text NOT NULL,
  payload text NOT NULL,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX screener_bollinger_receipts_target_idx ON screener_bollinger_receipts(target_key,created_at);
--> statement-breakpoint
CREATE TABLE screener_bollinger_daily (
  universe_revision text NOT NULL,
  symbol text NOT NULL,
  session_date text NOT NULL,
  market text NOT NULL CHECK(market IN ('TWSE','TPEx')),
  readiness text NOT NULL,
  payload text NOT NULL,
  PRIMARY KEY(universe_revision,session_date,symbol)
);
--> statement-breakpoint
CREATE INDEX screener_bollinger_daily_market_idx ON screener_bollinger_daily(universe_revision,market,session_date);
