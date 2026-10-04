import { technicalEvidenceHash } from "../../../src/lib/stock-screener-technical-patterns.ts";
import {
  SCREENER_V7_FORMULA_VERSION, type ScreenerInputV7,
} from "../../../src/lib/stock-screener-v7.ts";
import { SCREENER_OHLCV_V4_MAPPING_VERSION } from "../../../src/lib/stock-screener-ohlcv.ts";
import { readScreenerSnapshot, type ScreenerDatabase } from "./stock-screener-repository.ts";
import { SCREENER_V6_RESOURCE_LIMITS, type ScreenerV6Metadata } from "./stock-screener-v6-repository.ts";

export const SCREENER_V7_RESOURCE_LIMITS = { ...SCREENER_V6_RESOURCE_LIMITS } as const;

export interface ScreenerV7Metadata extends Omit<ScreenerV6Metadata,
  "version" | "schemaVersion" | "formulaVersion" | "sourceMappingVersion" | "baseSnapshotId" | "receiptsHash"> {
  version: 7;
  schemaVersion: 7;
  formulaVersion: typeof SCREENER_V7_FORMULA_VERSION;
  sourceMappingVersion: typeof SCREENER_OHLCV_V4_MAPPING_VERSION;
  baseSnapshotId: string;
  receiptsHash: string;
  technicalCoverage: Record<"TWSE" | "TPEx", {
    target: number; covered: number; complete130: number; indicatorReady: number;
    indicatorWarmupUnknown: number; continuityUnknown: number;
  }>;
}

const iso = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
export function validateScreenerV7Metadata(value: ScreenerV7Metadata) {
  return value?.version === 7 && value.schemaVersion === 7 && value.formulaVersion === SCREENER_V7_FORMULA_VERSION
    && value.sourceMappingVersion === SCREENER_OHLCV_V4_MAPPING_VERSION && /^[\w-]{36}$/.test(value.baseSnapshotId)
    && !!value.universeRevision && iso(value.effectiveSessionDate) && value.expectedSessionDate === value.effectiveSessionDate
    && value.dailyThrough === value.effectiveSessionDate && /^[a-f0-9]{64}$/.test(value.receiptsHash)
    && Number.isInteger(value.total) && value.total > 0 && Number.isFinite(Date.parse(value.validThrough))
    && Array.isArray(value.technicalAnchors?.sessions) && value.technicalAnchors.sessions.length === 130
    && value.technicalAnchors.through === value.effectiveSessionDate
    && (["TWSE", "TPEx"] as const).every((market) => {
      const row = value.technicalCoverage?.[market];
      return row && Number.isInteger(row.target) && row.target >= 0 && row.covered === row.target
        && row.complete130 >= 0 && row.complete130 <= row.covered
        && row.indicatorReady + row.indicatorWarmupUnknown + row.continuityUnknown === row.covered;
    });
}

export async function readScreenerV7Snapshot(db: ScreenerDatabase, id?: string) {
  const snapshot = await readScreenerSnapshot(db, id, 7);
  if (!snapshot) return null;
  const metadata = snapshot.metadata as unknown as ScreenerV7Metadata;
  const inputs = snapshot.inputs as unknown as ScreenerInputV7[];
  if (!validateScreenerV7Metadata(metadata) || inputs.length !== metadata.total
    || inputs.some((row) => row.technicalV7.formulaVersion !== SCREENER_V7_FORMULA_VERSION
      || row.technicalV7.sourceMappingVersion !== SCREENER_OHLCV_V4_MAPPING_VERSION
      || row.technicalV7.through !== metadata.effectiveSessionDate
      || !/^[a-f0-9]{64}$/.test(row.technicalV7.evidenceHash))) throw new Error("invalid_v7_snapshot");
  return { ...snapshot, metadata, inputs };
}

export async function publishScreenerV7Snapshot(db: ScreenerDatabase, metadata: ScreenerV7Metadata,
  inputs: ScreenerInputV7[], now = new Date()) {
  if (!validateScreenerV7Metadata(metadata) || inputs.length !== metadata.total
    || inputs.length > SCREENER_V7_RESOURCE_LIMITS.maxUniverseRows) throw new Error("invalid_v7_snapshot");
  const payloads: string[] = [];
  const encoder = new TextEncoder();
  let totalBytes = 0;
  for (const row of inputs) {
    const { evidenceHash, ...evidence } = row.technicalV7;
    if (await technicalEvidenceHash(evidence) !== evidenceHash) throw new Error("invalid_evidence_hash");
    const payload = JSON.stringify(row), bytes = encoder.encode(payload).byteLength;
    if (bytes > SCREENER_V7_RESOURCE_LIMITS.maxSerializedRowBytes) throw new Error("v7_resource_limit_exceeded");
    totalBytes += bytes;
    if (totalBytes > SCREENER_V7_RESOURCE_LIMITS.maxSerializedSnapshotBytes) throw new Error("v7_resource_limit_exceeded");
    payloads.push(payload);
  }
  const previous = await readScreenerV7Snapshot(db);
  if (previous && previous.metadata.effectiveSessionDate > metadata.effectiveSessionDate) throw new Error("snapshot_regression");
  const id = crypto.randomUUID();
  const createdAt = new Date(Math.max(now.getTime(), previous ? Date.parse(previous.createdAt) + 1 : 0)).toISOString();
  await db.prepare("INSERT INTO screener_snapshots(id,created_at,status,metadata,schema_version) VALUES(?,?,'staging',?,7)")
    .bind(id, createdAt, JSON.stringify(metadata)).run();
  try {
    for (let offset = 0; offset < inputs.length; offset += 50) await db.batch(inputs.slice(offset, offset + 50).map((input, index) =>
      db.prepare("INSERT INTO screener_snapshot_rows(snapshot_id,symbol,payload) VALUES(?,?,?)")
        .bind(id, input.symbol, payloads[offset + index]!)));
    await db.batch([
      db.prepare(`UPDATE screener_snapshots SET status='published' WHERE id=? AND schema_version=7
        AND (SELECT COUNT(*) FROM screener_snapshot_rows WHERE snapshot_id=?)=?
        AND COALESCE((SELECT id FROM screener_snapshots WHERE status='published' AND schema_version=7 ORDER BY created_at DESC,id DESC LIMIT 1),'')=?`)
        .bind(id, id, inputs.length, previous?.id ?? ""),
      db.prepare(`INSERT INTO screener_chip_publication_head(name,snapshot_id,effective_session_date,universe_revision,daily_through,weekly_through,receipts_hash,status,updated_at)
        SELECT 'v7',?,?,?,?,?,?,'published',? WHERE EXISTS
          (SELECT 1 FROM screener_snapshots WHERE id=? AND schema_version=7 AND status='published')
        ON CONFLICT(name) DO UPDATE SET snapshot_id=excluded.snapshot_id,effective_session_date=excluded.effective_session_date,
        universe_revision=excluded.universe_revision,daily_through=excluded.daily_through,weekly_through=excluded.weekly_through,
        receipts_hash=excluded.receipts_hash,status=excluded.status,updated_at=excluded.updated_at`)
        .bind(id, metadata.effectiveSessionDate, metadata.universeRevision, metadata.dailyThrough, metadata.weeklyThrough,
          metadata.receiptsHash, createdAt, id),
      db.prepare(`DELETE FROM screener_snapshots WHERE status='published' AND schema_version=7 AND id NOT IN
        (SELECT id FROM screener_snapshots WHERE status='published' AND schema_version=7 ORDER BY created_at DESC,id DESC LIMIT ${SCREENER_V7_RESOURCE_LIMITS.retainedSnapshots})`),
    ]);
    const published = await db.prepare("SELECT status FROM screener_snapshots WHERE id=?").bind(id).first<{ status: string }>();
    const head = await db.prepare("SELECT snapshot_id FROM screener_chip_publication_head WHERE name='v7'").first<{ snapshot_id: string }>();
    if (published?.status !== "published" || head?.snapshot_id !== id) throw new Error("snapshot_publication_conflict");
    return id;
  } catch (error) {
    await db.prepare("DELETE FROM screener_snapshots WHERE id=? AND status='staging'").bind(id).run();
    throw error;
  }
}
