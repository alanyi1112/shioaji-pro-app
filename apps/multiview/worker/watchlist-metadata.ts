export const WATCHLIST_RECOMMENDER_MAX_LENGTH = 80;

type ColumnInfo = { name?: string | null };

export function taipeiCalendarDate(now: Date | string | number = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid_date");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function normalizeRecommender(value: unknown) {
  const text = String(value ?? "").trim().replace(/[ \t]+/g, " ");
  if (text.length > WATCHLIST_RECOMMENDER_MAX_LENGTH) throw new Error("recommender_too_long");
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new Error("recommender_control_character");
  return text;
}

export function newWatchlistItemId() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function ensureWatchlistMetadataColumns(db: D1Database) {
  const result = await db.prepare("PRAGMA table_info(user_instruments)").all<ColumnInfo>();
  const columns = new Set(result.results.map((row) => String(row.name || "")));
  const additions = [
    ["item_id", "ALTER TABLE user_instruments ADD COLUMN item_id TEXT"],
    ["added_at", "ALTER TABLE user_instruments ADD COLUMN added_at TEXT"],
    ["date_status", "ALTER TABLE user_instruments ADD COLUMN date_status TEXT NOT NULL DEFAULT 'legacy_unknown'"],
    ["date_source", "ALTER TABLE user_instruments ADD COLUMN date_source TEXT"],
    ["recommender", "ALTER TABLE user_instruments ADD COLUMN recommender TEXT NOT NULL DEFAULT ''"],
  ] as const;
  for (const [name, sql] of additions) {
    if (!columns.has(name)) await db.prepare(sql).run();
  }
  await db.prepare("UPDATE user_instruments SET item_id = lower(hex(randomblob(16))) WHERE item_id IS NULL OR item_id = ''").run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS user_instruments_user_item_idx ON user_instruments (user_id, item_id)").run();
}
