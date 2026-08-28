type ColumnInfo = { name?: string | null };

const CONTINUITY_COLUMNS = [
  ["continuity_status", "TEXT NOT NULL DEFAULT 'unknown'"],
  ["continuity_from", "TEXT"],
  ["continuity_through", "TEXT"],
  ["continuity_checked_at", "TEXT"],
  ["missing_session_count", "INTEGER NOT NULL DEFAULT 0"],
  ["missing_session_dates_json", "TEXT NOT NULL DEFAULT '[]'"],
  ["excluded_session_dates_json", "TEXT NOT NULL DEFAULT '[]'"],
  ["continuity_reason_code", "TEXT"],
] as const;

export async function ensureCandleContinuityColumns(db: D1Database) {
  const result = await db.prepare("PRAGMA table_info(candle_history_state)").all<ColumnInfo>();
  const existing = new Set((result.results || []).map((row) => String(row.name || "")));
  let upgraded = false;
  for (const [name, definition] of CONTINUITY_COLUMNS) {
    if (existing.has(name)) continue;
    await db.prepare(`ALTER TABLE candle_history_state ADD COLUMN ${name} ${definition}`).run();
    upgraded = true;
  }
  if (upgraded) {
    await db.prepare(`UPDATE candle_history_state SET
      full_window_complete=0,
      continuity_status='unknown',
      continuity_from=NULL,
      continuity_through=NULL,
      continuity_checked_at=NULL,
      missing_session_count=0,
      missing_session_dates_json='[]',
      excluded_session_dates_json='[]',
      continuity_reason_code='continuity_unverified'`).run();
  }
  return { upgraded, columns: CONTINUITY_COLUMNS.map(([name]) => name) };
}
