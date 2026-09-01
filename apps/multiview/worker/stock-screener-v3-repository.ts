import {
  technicalEvidenceHash, validateScreenerV3Metadata,
  type ScreenerInputV3, type ScreenerV3Metadata,
} from "../../../src/lib/stock-screener-technical-patterns.ts";
import { readScreenerSnapshot, type ScreenerDatabase } from "./stock-screener-repository.ts";

export async function readScreenerV3Snapshot(db: ScreenerDatabase, id?: string) {
  const snapshot = await readScreenerSnapshot(db, id, 3);
  if (!snapshot) return null;
  const metadata = snapshot.metadata as unknown as ScreenerV3Metadata;
  const inputs = snapshot.inputs as unknown as ScreenerInputV3[];
  if (!validateScreenerV3Metadata(metadata) || inputs.length !== metadata.total
    || inputs.some((row) => !row.technical || !/^[a-f0-9]{64}$/.test(row.technical.evidenceHash))) throw new Error("invalid_v3_snapshot");
  return { ...snapshot, metadata, inputs };
}

export async function publishScreenerV3Snapshot(
  db: ScreenerDatabase, metadata: ScreenerV3Metadata, inputs: ScreenerInputV3[], now = new Date(),
) {
  if (!validateScreenerV3Metadata(metadata) || metadata.total !== inputs.length || !inputs.length || inputs.length > 10000
    || metadata.progress.remaining !== 0 || metadata.progress.failed !== 0 || metadata.progress.overdue !== 0) throw new Error("invalid_v3_snapshot");
  for (const row of inputs) {
    if (!row.technical) throw new Error("invalid_v3_snapshot");
    const { evidenceHash, ...evidence } = row.technical;
    if (await technicalEvidenceHash(evidence) !== evidenceHash) throw new Error("invalid_evidence_hash");
  }
  const previous = await readScreenerV3Snapshot(db);
  if (previous) {
    if (previous.metadata.technicalAnchors.through > metadata.technicalAnchors.through) throw new Error("snapshot_regression");
    if (previous.metadata.technicalAnchors.through === metadata.technicalAnchors.through) {
      const before = new Map(previous.inputs.map((row) => [row.symbol, row.technical]));
      for (const row of inputs) {
        const prior = before.get(row.symbol);
        if (!prior) continue;
        for (const key of ["rawBottom", "rawTop", "chanBottom", "chanTop", "lowerBullish", "upperBearish"] as const) {
          if (prior[key].verdict !== "unknown" && row.technical[key].verdict === "unknown") throw new Error("snapshot_sparse_regression");
        }
      }
    }
  }
  const id = crypto.randomUUID();
  const createdAt = new Date(Math.max(now.getTime(), previous ? Date.parse(previous.createdAt) + 1 : 0)).toISOString();
  await db.prepare("INSERT INTO screener_snapshots(id,created_at,status,metadata,schema_version) VALUES(?,?,'staging',?,3)")
    .bind(id, createdAt, JSON.stringify(metadata)).run();
  try {
    for (let offset = 0; offset < inputs.length; offset += 50) {
      await db.batch(inputs.slice(offset, offset + 50).map((input) => db.prepare(
        "INSERT INTO screener_snapshot_rows(snapshot_id,symbol,payload) VALUES(?,?,?)",
      ).bind(id, input.symbol, JSON.stringify(input))));
    }
    await db.batch([
      db.prepare("UPDATE screener_snapshots SET status='published' WHERE id=? AND schema_version=3 AND (SELECT COUNT(*) FROM screener_snapshot_rows WHERE snapshot_id=?)=? AND COALESCE((SELECT id FROM screener_snapshots WHERE status='published' AND schema_version=3 ORDER BY created_at DESC,id DESC LIMIT 1),'')=?")
        .bind(id, id, inputs.length, previous?.id ?? ""),
      db.prepare("DELETE FROM screener_snapshots WHERE status='published' AND schema_version=3 AND id NOT IN (SELECT id FROM screener_snapshots WHERE status='published' AND schema_version=3 ORDER BY created_at DESC,id DESC LIMIT 2)"),
    ]);
    const row = await db.prepare("SELECT status FROM screener_snapshots WHERE id=?").bind(id).first<{ status: string }>();
    if (row?.status !== "published") throw new Error("snapshot_publication_conflict");
  } catch (error) {
    await db.prepare("DELETE FROM screener_snapshots WHERE id=? AND status='staging'").bind(id).run();
    throw error;
  }
  return id;
}
