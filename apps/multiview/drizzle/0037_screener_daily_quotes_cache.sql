-- 備援獨立日期批次，不更動官方失敗、daily rows 或 publication head。
CREATE TABLE screener_daily_quotes_cache (
  cache_key text PRIMARY KEY NOT NULL,
  session_date text NOT NULL,
  review_hash text NOT NULL,
  status text NOT NULL CHECK(status IN ('pending','complete','invalid')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0 AND attempts<=18),
  lease_owner text,
  lease_until text,
  next_attempt_at text,
  reason text,
  response_text text,
  payload_hash text,
  fetched_at text,
  updated_at text NOT NULL
);
--> statement-breakpoint
CREATE TABLE screener_daily_quotes_receipts (
  id text PRIMARY KEY NOT NULL,
  cache_key text NOT NULL,
  status text NOT NULL,
  payload text NOT NULL,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX screener_daily_quotes_receipts_cache_idx ON screener_daily_quotes_receipts(cache_key,created_at);
