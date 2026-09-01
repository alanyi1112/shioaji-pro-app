import { screenStocks, DEFAULT_CRITERIA, validatePair, type ScreenerAnchors, type ScreenerInput } from "../../../src/lib/stock-screener-domain.ts";

export interface ScreenerSnapshotMetadata {
  version: 1 | 2;
  schemaVersion?: 2;
  formulaVersion?: "after-market-v2";
  anchors: ScreenerAnchors;
  universeRevision: string;
  total: number;
  /** Updater derives this from the official expected publication calendar, not request time. */
  validThrough: string;
  sourceReview: "verified";
  periodEvidence?: { fetchedAt: string; sourceHashes: string[] };
  expectedSessionDate?: string;
  expectedWeekDate?: string;
  turnoverCoverage?: { valid: number; missing: number };
  holderHistoryCoverage?: { requiredPeriods: string[]; complete: number; pending: number };
  background?: { target: number; processed: number; remaining: number; failed: number; overdue: number; cursor?: string | null; dates?: string[]; universeRevision?: string };
}
type SnapshotRecord = { id: string; created_at: string; metadata: string };

/** Minimal D1-compatible contract, also exercised by the isolated SQLite adapter. */
export interface ScreenerStatement {
  bind(...values: (string | number | null)[]): ScreenerStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
}
export interface ScreenerDatabase {
  prepare(sql: string): ScreenerStatement;
  batch(statements: ScreenerStatement[]): Promise<unknown[]>;
}

export async function readScreenerSnapshot(db: ScreenerDatabase, id?: string) {
  // Metadata and rows are read in one SQLite snapshot even during retention pruning.
  const sql = "SELECT s.id, s.created_at, s.metadata, r.payload FROM screener_snapshots s JOIN screener_snapshot_rows r ON r.snapshot_id = s.id WHERE s.status = 'published' AND s.id = ";
  const query = id ? db.prepare(`${sql}? ORDER BY r.symbol`).bind(id)
    : db.prepare(`${sql}(SELECT id FROM screener_snapshots WHERE status = 'published' ORDER BY created_at DESC, id DESC LIMIT 1) ORDER BY r.symbol`);
  const result = await query.all<SnapshotRecord & { payload: string }>();
  const record = result.results?.[0];
  if (!record) return null;
  const metadata = JSON.parse(record.metadata) as ScreenerSnapshotMetadata;
  const inputs = (result.results ?? []).map((row) => JSON.parse(row.payload) as ScreenerInput);
  if (inputs.length !== metadata.total) throw new Error("snapshot_incomplete");
  return { id: record.id, createdAt: record.created_at, metadata, inputs };
}

/** Internal updater only. No HTTP query may call this method. Staging rows are invisible. */
export async function publishScreenerSnapshot(db: ScreenerDatabase, metadata: ScreenerSnapshotMetadata, inputs: ScreenerInput[], now = new Date()) {
  if (metadata.version !== 2 || metadata.schemaVersion !== 2 || metadata.formulaVersion !== "after-market-v2"
    || metadata.sourceReview !== "verified" || !metadata.universeRevision
    || metadata.total !== inputs.length || !inputs.length || inputs.length > 10000
    || !Number.isFinite(Date.parse(metadata.validThrough))) throw new Error("invalid_snapshot");
  for (const pair of [metadata.anchors.daily, metadata.anchors.weekly]) if (pair && !validatePair(pair)) throw new Error("invalid_snapshot_dates");
  if (!Array.isArray(metadata.anchors.weeklyPeriods) || metadata.anchors.weeklyPeriods.length === 1 || metadata.anchors.weeklyPeriods.length > 6
    || metadata.anchors.weeklyPeriods.some((date, index, all) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || index > 0 && date <= all[index - 1]!)) throw new Error("invalid_snapshot_dates");
  const nextCoverage = screenStocks(inputs, metadata.anchors, DEFAULT_CRITERIA);
  const previous = await readScreenerSnapshot(db);
  if (previous) {
    for (const key of ["daily", "weekly"] as const) {
      const oldPair = previous.metadata.anchors[key], newPair = metadata.anchors[key];
      if (oldPair && (!newPair || newPair.current < oldPair.current)) throw new Error("snapshot_regression");
    }
    const oldCoverage = screenStocks(previous.inputs, previous.metadata.anchors, DEFAULT_CRITERIA);
    const previousRows = new Map(oldCoverage.rows.map((row) => [row.symbol, row]));
    // New listings may be unknown. Existing validated stocks must never be lost
    // merely because another stock improved and the global percentage stayed flat.
    for (const row of nextCoverage.rows) {
      const before = previousRows.get(row.symbol);
      for (const key of ["volume", "holder"] as const) {
        const family = key === "volume" ? "daily" : "weekly";
        // Same-period revisions cannot erase verified coverage. A genuinely new,
        // whole-source-verified period may contain a suspended/new stock with no
        // comparison; preserve the old immutable snapshot, but expose new unknowns.
        const samePeriod = JSON.stringify(previous.metadata.anchors[family]) === JSON.stringify(metadata.anchors[family]);
        if (samePeriod && before?.[key]?.verdict !== undefined && before[key]?.verdict !== "unknown" && row[key]?.verdict === "unknown") throw new Error("snapshot_sparse_regression");
      }
    }
  }
  const id = crypto.randomUUID();
  const createdAt = new Date(Math.max(now.getTime(), previous ? Date.parse(previous.createdAt) + 1 : 0)).toISOString();
  await db.prepare("INSERT INTO screener_snapshots (id, created_at, status, metadata, schema_version) VALUES (?, ?, 'staging', ?, 2)")
    .bind(id, createdAt, JSON.stringify(metadata)).run();
  try {
    for (let offset = 0; offset < inputs.length; offset += 50) {
      await db.batch(inputs.slice(offset, offset + 50).map((input) => db.prepare("INSERT INTO screener_snapshot_rows (snapshot_id, symbol, payload) VALUES (?, ?, ?)").bind(id, input.symbol, JSON.stringify(input))));
    }
    // One transaction: no reader can see a half-published snapshot or half-pruned version.
    await db.batch([
      db.prepare("UPDATE screener_snapshots SET status = 'published' WHERE id = ? AND (SELECT COUNT(*) FROM screener_snapshot_rows WHERE snapshot_id = ?) = ? AND COALESCE((SELECT id FROM screener_snapshots WHERE status = 'published' ORDER BY created_at DESC, id DESC LIMIT 1), '') = ?").bind(id, id, inputs.length, previous?.id ?? ""),
      db.prepare("DELETE FROM screener_snapshots WHERE status = 'published' AND id NOT IN (SELECT id FROM screener_snapshots WHERE status = 'published' ORDER BY created_at DESC, id DESC LIMIT 2)"),
    ]);
    const published = await db.prepare("SELECT status FROM screener_snapshots WHERE id = ?").bind(id).first<{ status: string }>();
    if (published?.status !== "published") throw new Error("snapshot_publication_conflict");
  } catch (error) {
    await db.prepare("DELETE FROM screener_snapshots WHERE id = ? AND status = 'staging'").bind(id).run();
    throw error;
  }
  return id;
}
