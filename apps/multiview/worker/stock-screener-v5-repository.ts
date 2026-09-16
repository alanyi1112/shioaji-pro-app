import { technicalEvidenceHash } from "../../../src/lib/stock-screener-technical-patterns.ts";
import {
  SCREENER_CHIP_MAPPING_VERSION, SCREENER_V5_FORMULA_VERSION,
  type ScreenerInputV5,
} from "../../../src/lib/stock-screener-v5.ts";
import { readScreenerSnapshot, type ScreenerDatabase } from "./stock-screener-repository.ts";

export const SCREENER_V5_RESOURCE_LIMITS = {
  maxUniverseRows: 2_500,
  maxSerializedRowBytes: 65_536,
  maxSerializedSnapshotBytes: 160 * 1024 * 1024,
  retainedSnapshots: 2,
  maxQueryRows: 100,
} as const;

export interface ScreenerV5Metadata {
  version: 5; schemaVersion: 5; formulaVersion: typeof SCREENER_V5_FORMULA_VERSION;
  sourceMappingVersion: typeof SCREENER_CHIP_MAPPING_VERSION; baseSnapshotId: string; universeRevision: string;
  effectiveSessionDate: string; expectedSessionDate: string; dailyThrough: string; weeklyThrough: string | null;
  dailySessions: string[]; tdccPeriods: string[]; receiptsHash: string; total: number; validThrough: string;
  anchors: ScreenerInputV5 extends never ? never : { daily: { previous: string; current: string } | null;
    weekly: { previous: string; current: string } | null; weeklyPeriods?: string[] };
  technicalAnchors: { sessions: string[]; through: string };
  coverage: { daily: Record<"TWSE" | "TPEx", { target: number; institutional: number; margin: number }>;
    tdcc: { target: number; covered: number }; issuedShares: { target: number; valid: number; missing: number } };
}

const iso = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
export function validateScreenerV5Metadata(value: ScreenerV5Metadata) {
  return value?.version === 5 && value.schemaVersion === 5 && value.formulaVersion === SCREENER_V5_FORMULA_VERSION
    && value.sourceMappingVersion === SCREENER_CHIP_MAPPING_VERSION && /^[\w-]{36}$/.test(value.baseSnapshotId)
    && !!value.universeRevision && iso(value.effectiveSessionDate) && value.expectedSessionDate === value.effectiveSessionDate
    && value.dailyThrough === value.effectiveSessionDate && /^[a-f0-9]{64}$/.test(value.receiptsHash)
    && Number.isInteger(value.total) && value.total > 0 && Number.isFinite(Date.parse(value.validThrough))
    && Array.isArray(value.dailySessions) && value.dailySessions.length >= 21
    && value.dailySessions.at(-1) === value.dailyThrough && Array.isArray(value.technicalAnchors?.sessions)
    && value.technicalAnchors.sessions.length === 130 && value.technicalAnchors.through === value.effectiveSessionDate
    && Array.isArray(value.tdccPeriods) && value.tdccPeriods.length >= 4
    && (value.weeklyThrough === null || value.weeklyThrough === value.tdccPeriods.at(-1))
    && value.coverage?.issuedShares.target === value.total && value.coverage.tdcc.target === value.total;
}

export async function readScreenerV5Snapshot(db: ScreenerDatabase, id?: string) {
  const snapshot = await readScreenerSnapshot(db, id, 5);
  if (!snapshot) return null;
  const metadata = snapshot.metadata as unknown as ScreenerV5Metadata;
  const inputs = snapshot.inputs as unknown as ScreenerInputV5[];
  if (!validateScreenerV5Metadata(metadata) || inputs.length !== metadata.total
    || inputs.some((row) => row.chipV5.mappingVersion !== SCREENER_CHIP_MAPPING_VERSION
      || !/^[a-f0-9]{64}$/.test(row.chipV5.evidenceHash))) throw new Error("invalid_v5_snapshot");
  return { ...snapshot, metadata, inputs };
}

export async function publishScreenerV5Snapshot(db: ScreenerDatabase, metadata: ScreenerV5Metadata,
  inputs: ScreenerInputV5[], now = new Date()) {
  if (!validateScreenerV5Metadata(metadata) || inputs.length !== metadata.total
    || inputs.length > SCREENER_V5_RESOURCE_LIMITS.maxUniverseRows) throw new Error("invalid_v5_snapshot");
  const payloads: string[] = [];
  const encoder = new TextEncoder();
  let payloadBytes = 0;
  for (const row of inputs) {
    const { evidenceHash, ...evidence } = row.chipV5;
    if (await technicalEvidenceHash(evidence) !== evidenceHash) throw new Error("invalid_evidence_hash");
    const payload = JSON.stringify(row), bytes = encoder.encode(payload).byteLength;
    if (bytes > SCREENER_V5_RESOURCE_LIMITS.maxSerializedRowBytes) throw new Error("v5_resource_limit_exceeded");
    payloadBytes += bytes;
    if (payloadBytes > SCREENER_V5_RESOURCE_LIMITS.maxSerializedSnapshotBytes) throw new Error("v5_resource_limit_exceeded");
    payloads.push(payload);
  }
  const previous = await readScreenerV5Snapshot(db);
  const previousDate = previous?.metadata.effectiveSessionDate;
  if (previousDate && previousDate > metadata.effectiveSessionDate) throw new Error("snapshot_regression");
  const id = crypto.randomUUID();
  const createdAt = new Date(Math.max(now.getTime(), previous ? Date.parse(previous.createdAt) + 1 : 0)).toISOString();
  await db.prepare("INSERT INTO screener_snapshots(id,created_at,status,metadata,schema_version) VALUES(?,?,'staging',?,5)")
    .bind(id, createdAt, JSON.stringify(metadata)).run();
  try {
    for (let offset = 0; offset < inputs.length; offset += 50) await db.batch(inputs.slice(offset, offset + 50).map((input, index) =>
      db.prepare("INSERT INTO screener_snapshot_rows(snapshot_id,symbol,payload) VALUES(?,?,?)")
        .bind(id, input.symbol, payloads[offset + index]!)));
    await db.batch([
      db.prepare(`UPDATE screener_snapshots SET status='published' WHERE id=? AND schema_version=5
        AND (SELECT COUNT(*) FROM screener_snapshot_rows WHERE snapshot_id=?)=?
        AND COALESCE((SELECT id FROM screener_snapshots WHERE status='published' AND schema_version=5 ORDER BY created_at DESC,id DESC LIMIT 1),'')=?`)
        .bind(id, id, inputs.length, previous?.id ?? ""),
      db.prepare(`INSERT INTO screener_chip_publication_head(name,snapshot_id,effective_session_date,universe_revision,daily_through,weekly_through,receipts_hash,status,updated_at)
        SELECT 'v5',?,?,?,?,?,?,'published',? WHERE EXISTS
          (SELECT 1 FROM screener_snapshots WHERE id=? AND schema_version=5 AND status='published')
        ON CONFLICT(name) DO UPDATE SET snapshot_id=excluded.snapshot_id,
        effective_session_date=excluded.effective_session_date,universe_revision=excluded.universe_revision,daily_through=excluded.daily_through,
        weekly_through=excluded.weekly_through,receipts_hash=excluded.receipts_hash,status=excluded.status,updated_at=excluded.updated_at`)
        .bind(id, metadata.effectiveSessionDate, metadata.universeRevision, metadata.dailyThrough, metadata.weeklyThrough,
          metadata.receiptsHash, createdAt, id),
      db.prepare(`DELETE FROM screener_snapshots WHERE status='published' AND schema_version=5 AND id NOT IN
        (SELECT id FROM screener_snapshots WHERE status='published' AND schema_version=5 ORDER BY created_at DESC,id DESC LIMIT ${SCREENER_V5_RESOURCE_LIMITS.retainedSnapshots})`),
    ]);
    const published = await db.prepare("SELECT status FROM screener_snapshots WHERE id=?").bind(id).first<{ status: string }>();
    const head = await db.prepare("SELECT snapshot_id FROM screener_chip_publication_head WHERE name='v5'")
      .first<{ snapshot_id: string }>();
    if (published?.status !== "published" || head?.snapshot_id !== id) throw new Error("snapshot_publication_conflict");
    return id;
  } catch (error) {
    await db.prepare("DELETE FROM screener_snapshots WHERE id=? AND status='staging'").bind(id).run();
    throw error;
  }
}
