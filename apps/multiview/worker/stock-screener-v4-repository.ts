import {
  SCREENER_V4_OHLCV_WINDOW, validateScreenerV4Metadata,
  type ScreenerInputV4, type ScreenerV4Metadata,
} from "../../../src/lib/stock-screener-v4.ts";
import { technicalEvidenceHash } from "../../../src/lib/stock-screener-technical-patterns.ts";
import { hasAlignedSessionEvidence } from "../../../src/lib/stock-screener-domain.ts";
import { readScreenerSnapshot, type ScreenerDatabase } from "./stock-screener-repository.ts";

export async function readScreenerV4Snapshot(db: ScreenerDatabase, id?: string) {
  const snapshot = await readScreenerSnapshot(db, id, 4);
  if (!snapshot) return null;
  const metadata = snapshot.metadata as unknown as ScreenerV4Metadata;
  const inputs = snapshot.inputs as unknown as ScreenerInputV4[];
  if (!validateScreenerV4Metadata(metadata) || inputs.length !== metadata.total
    || inputs.some((row) => !row.technicalV4 || !/^[a-f0-9]{64}$/.test(row.technicalV4.evidenceHash))) {
    throw new Error("invalid_v4_snapshot");
  }
  return { ...snapshot, metadata, inputs };
}

export async function publishScreenerV4Snapshot(
  db: ScreenerDatabase, metadata: ScreenerV4Metadata, inputs: ScreenerInputV4[], now = new Date(),
) {
  if (!validateScreenerV4Metadata(metadata) || metadata.technicalAnchors.sessions.length !== SCREENER_V4_OHLCV_WINDOW
    || metadata.total !== inputs.length || !inputs.length || inputs.length > 10000
    || metadata.progress.remaining !== 0 || metadata.progress.failed !== 0 || metadata.progress.overdue !== 0) {
    throw new Error("invalid_v4_snapshot");
  }
  if (!hasAlignedSessionEvidence({ expectedSessionDate: metadata.expectedSessionDate,
    daily: metadata.anchors.daily, technicalThrough: metadata.technicalAnchors.through,
    effectiveSessionDate: metadata.effectiveSessionDate })) throw new Error("mixed_session_dates");
  for (const row of inputs) {
    const technical = row.technicalV4;
    if (!technical) throw new Error("invalid_v4_snapshot");
    const { evidenceHash, ...evidence } = technical;
    if (await technicalEvidenceHash(evidence) !== evidenceHash) throw new Error("invalid_evidence_hash");
  }
  const previous = await readScreenerV4Snapshot(db);
  if (previous) {
    if (previous.metadata.technicalAnchors.through > metadata.technicalAnchors.through) throw new Error("snapshot_regression");
    if (previous.metadata.technicalAnchors.through === metadata.technicalAnchors.through) {
      const before = new Map(previous.inputs.map((row) => [row.symbol, row.technicalV4]));
      for (const row of inputs) {
        const prior = before.get(row.symbol);
        if (!prior) continue;
        if (prior.ma.verdict !== "unknown" && row.technicalV4.ma.verdict === "unknown") throw new Error("snapshot_sparse_regression");
        for (const source of Object.keys(prior.divergence)) {
          for (const key of ["bullish", "bearish", "bullishZeroReset", "bearishZeroReset"] as const) {
            if (prior.divergence[source]?.[key].verdict !== "unknown"
              && row.technicalV4.divergence[source]?.[key].verdict === "unknown") throw new Error("snapshot_sparse_regression");
          }
        }
      }
    }
  }
  const id = crypto.randomUUID();
  const createdAt = new Date(Math.max(now.getTime(), previous ? Date.parse(previous.createdAt) + 1 : 0)).toISOString();
  await db.prepare("INSERT INTO screener_snapshots(id,created_at,status,metadata,schema_version) VALUES(?,?,'staging',?,4)")
    .bind(id, createdAt, JSON.stringify(metadata)).run();
  try {
    for (let offset = 0; offset < inputs.length; offset += 50) {
      await db.batch(inputs.slice(offset, offset + 50).map((input) => db.prepare(
        "INSERT INTO screener_snapshot_rows(snapshot_id,symbol,payload) VALUES(?,?,?)",
      ).bind(id, input.symbol, JSON.stringify(input))));
    }
    await db.batch([
      db.prepare("UPDATE screener_snapshots SET status='published' WHERE id=? AND schema_version=4 AND (SELECT COUNT(*) FROM screener_snapshot_rows WHERE snapshot_id=?)=? AND COALESCE((SELECT id FROM screener_snapshots WHERE status='published' AND schema_version=4 ORDER BY created_at DESC,id DESC LIMIT 1),'')=?")
        .bind(id, id, inputs.length, previous?.id ?? ""),
      db.prepare("DELETE FROM screener_snapshots WHERE status='published' AND schema_version=4 AND id NOT IN (SELECT id FROM screener_snapshots WHERE status='published' AND schema_version=4 ORDER BY created_at DESC,id DESC LIMIT 2)"),
    ]);
    const row = await db.prepare("SELECT status FROM screener_snapshots WHERE id=?").bind(id).first<{ status: string }>();
    if (row?.status !== "published") throw new Error("snapshot_publication_conflict");
  } catch (error) {
    await db.prepare("DELETE FROM screener_snapshots WHERE id=? AND status='staging'").bind(id).run();
    throw error;
  }
  return id;
}
