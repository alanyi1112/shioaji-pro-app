async function ensureColumns(db: D1Database, table: string, definitions: Array<[string, string]>) {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const existing = new Set(info.results.map((column) => column.name));
  for (const [name, definition] of definitions) {
    if (!existing.has(name)) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
  }
}

export async function ensurePeRiverPipelineColumns(db: D1Database) {
  await ensureColumns(db, "taiwan_stock_pe_control", [
    ["latest_twse_attempt_at", "TEXT"],
    ["latest_twse_attempt_status", "TEXT"],
    ["latest_twse_attempt_reason_code", "TEXT"],
    ["latest_twse_attempt_detail_json", "TEXT"],
    ["latest_tpex_attempt_at", "TEXT"],
    ["latest_tpex_attempt_status", "TEXT"],
    ["latest_tpex_attempt_reason_code", "TEXT"],
    ["latest_tpex_attempt_detail_json", "TEXT"],
  ]);
  await ensureColumns(db, "taiwan_stock_pe_valuation_daily", [
    ["provider", "TEXT NOT NULL DEFAULT 'official'"],
    ["original_source", "TEXT NOT NULL DEFAULT 'unknown'"],
    ["validation_status", "TEXT NOT NULL DEFAULT 'official_verified'"],
    ["official_overlap_date", "TEXT"],
    ["provisional_created_at", "TEXT"],
  ]);
  await ensureColumns(db, "taiwan_stock_pe_fetch_state", [
    ["latest_source_date", "TEXT"],
    ["verified_end", "TEXT"],
    ["display_end", "TEXT"],
    ["official_source_date", "TEXT"],
    ["provisional_dates_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["provisional_status", "TEXT"],
    ["provisional_quarantined", "INTEGER NOT NULL DEFAULT 0"],
    ["mismatch_date", "TEXT"],
    ["mismatch_pe_difference", "REAL"],
    ["mismatch_close_difference", "REAL"],
    ["provider_verified_at", "TEXT"],
    ["lane", "TEXT NOT NULL DEFAULT 'history'"],
  ]);
  await ensureColumns(db, "taiwan_stock_pe_backfill_job", [
    ["lane", "TEXT NOT NULL DEFAULT 'history'"],
    ["latest_source_date", "TEXT"],
    ["provider_verified_at", "TEXT"],
  ]);
  await ensureColumns(db, "taiwan_stock_pe_backfill_month", [
    ["dataset_status_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["ingest_cursor", "INTEGER NOT NULL DEFAULT 0"],
  ]);
}
