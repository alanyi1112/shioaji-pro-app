CREATE TABLE IF NOT EXISTS screener_chip_canonical_rows (
  receipt_id TEXT NOT NULL REFERENCES screener_chip_receipts(id),
  symbol TEXT NOT NULL,
  session_date TEXT NOT NULL,
  dataset TEXT NOT NULL CHECK(dataset IN ('institutional-flow','margin-short')),
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  source_observed_at TEXT NOT NULL,
  PRIMARY KEY(receipt_id,symbol,dataset,source_observed_at)
);
CREATE INDEX IF NOT EXISTS screener_chip_canonical_symbol_date ON screener_chip_canonical_rows(symbol,session_date,dataset);
