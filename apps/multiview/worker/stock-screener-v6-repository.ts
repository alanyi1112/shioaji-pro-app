import { technicalEvidenceHash } from "../../../src/lib/stock-screener-technical-patterns.ts";
import {
  SCREENER_INSTITUTIONAL_MAPPING_VERSION, SCREENER_V6_FORMULA_VERSION,
  type ScreenerInputV6,
} from "../../../src/lib/stock-screener-v6.ts";
import { readScreenerSnapshot, type ScreenerDatabase } from "./stock-screener-repository.ts";
import { SCREENER_V5_RESOURCE_LIMITS, type ScreenerV5Metadata } from "./stock-screener-v5-repository.ts";

export const SCREENER_V6_RESOURCE_LIMITS = { ...SCREENER_V5_RESOURCE_LIMITS } as const;

export interface ScreenerV6Metadata extends Omit<ScreenerV5Metadata,
  "version" | "schemaVersion" | "formulaVersion" | "sourceMappingVersion" | "baseSnapshotId" | "receiptsHash"> {
  version: 6;
  schemaVersion: 6;
  formulaVersion: typeof SCREENER_V6_FORMULA_VERSION;
  sourceMappingVersion: typeof SCREENER_INSTITUTIONAL_MAPPING_VERSION;
  baseSnapshotId: string;
  receiptsHash: string;
  institutionalCoverage: Record<"TWSE" | "TPEx", {
    targetDates: number; verifiedDates: number; targetRows: number; verifiedRows: number;
    missingRows: number; invalidRows: number; lastVerifiedSourceDate: string | null;
  }>;
}

const iso = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
export function validateScreenerV6Metadata(value: ScreenerV6Metadata) {
  return value?.version === 6 && value.schemaVersion === 6 && value.formulaVersion === SCREENER_V6_FORMULA_VERSION
    && value.sourceMappingVersion === SCREENER_INSTITUTIONAL_MAPPING_VERSION && /^[\w-]{36}$/.test(value.baseSnapshotId)
    && !!value.universeRevision && iso(value.effectiveSessionDate) && value.expectedSessionDate === value.effectiveSessionDate
    && value.dailyThrough === value.effectiveSessionDate && /^[a-f0-9]{64}$/.test(value.receiptsHash)
    && Number.isInteger(value.total) && value.total > 0 && Number.isFinite(Date.parse(value.validThrough))
    && Array.isArray(value.dailySessions) && value.dailySessions.length >= 21 && value.dailySessions.at(-1) === value.dailyThrough
    && (["TWSE", "TPEx"] as const).every((market) => value.institutionalCoverage?.[market]?.verifiedDates
      === value.institutionalCoverage?.[market]?.targetDates);
}

export async function readScreenerV6Snapshot(db: ScreenerDatabase, id?: string) {
  const snapshot = await readScreenerSnapshot(db, id, 6);
  if (!snapshot) return null;
  const metadata = snapshot.metadata as unknown as ScreenerV6Metadata;
  const inputs = snapshot.inputs as unknown as ScreenerInputV6[];
  if (!validateScreenerV6Metadata(metadata) || inputs.length !== metadata.total
    || inputs.some((row) => row.institutionalV6.mappingVersion !== SCREENER_INSTITUTIONAL_MAPPING_VERSION
      || !/^[a-f0-9]{64}$/.test(row.institutionalV6.evidenceHash))) throw new Error("invalid_v6_snapshot");
  return { ...snapshot, metadata, inputs };
}

export async function publishScreenerV6Snapshot(db: ScreenerDatabase, metadata: ScreenerV6Metadata,
  inputs: ScreenerInputV6[], now = new Date()) {
  if (!validateScreenerV6Metadata(metadata) || inputs.length !== metadata.total
    || inputs.length > SCREENER_V6_RESOURCE_LIMITS.maxUniverseRows) throw new Error("invalid_v6_snapshot");
  const payloads: string[] = [];
  const encoder = new TextEncoder();
  let totalBytes = 0;
  for (const row of inputs) {
    const { evidenceHash, ...evidence } = row.institutionalV6;
    if (await technicalEvidenceHash(evidence) !== evidenceHash) throw new Error("invalid_evidence_hash");
    const payload = JSON.stringify(row), bytes = encoder.encode(payload).byteLength;
    if (bytes > SCREENER_V6_RESOURCE_LIMITS.maxSerializedRowBytes) throw new Error("v6_resource_limit_exceeded");
    totalBytes += bytes;
    if (totalBytes > SCREENER_V6_RESOURCE_LIMITS.maxSerializedSnapshotBytes) throw new Error("v6_resource_limit_exceeded");
    payloads.push(payload);
  }
  const previous = await readScreenerV6Snapshot(db);
  if (previous && previous.metadata.effectiveSessionDate > metadata.effectiveSessionDate) throw new Error("snapshot_regression");
  const id = crypto.randomUUID();
  const createdAt = new Date(Math.max(now.getTime(), previous ? Date.parse(previous.createdAt) + 1 : 0)).toISOString();
  await db.prepare("INSERT INTO screener_snapshots(id,created_at,status,metadata,schema_version) VALUES(?,?,'staging',?,6)")
    .bind(id, createdAt, JSON.stringify(metadata)).run();
  try {
    for (let offset = 0; offset < inputs.length; offset += 50) await db.batch(inputs.slice(offset, offset + 50).map((input, index) =>
      db.prepare("INSERT INTO screener_snapshot_rows(snapshot_id,symbol,payload) VALUES(?,?,?)")
        .bind(id, input.symbol, payloads[offset + index]!)));
    await db.batch([
      db.prepare(`UPDATE screener_snapshots SET status='published' WHERE id=? AND schema_version=6
        AND (SELECT COUNT(*) FROM screener_snapshot_rows WHERE snapshot_id=?)=?
        AND COALESCE((SELECT id FROM screener_snapshots WHERE status='published' AND schema_version=6 ORDER BY created_at DESC,id DESC LIMIT 1),'')=?`)
        .bind(id, id, inputs.length, previous?.id ?? ""),
      db.prepare(`INSERT INTO screener_chip_publication_head(name,snapshot_id,effective_session_date,universe_revision,daily_through,weekly_through,receipts_hash,status,updated_at)
        SELECT 'v6',?,?,?,?,?,?,'published',? WHERE EXISTS
          (SELECT 1 FROM screener_snapshots WHERE id=? AND schema_version=6 AND status='published')
        ON CONFLICT(name) DO UPDATE SET snapshot_id=excluded.snapshot_id,effective_session_date=excluded.effective_session_date,
        universe_revision=excluded.universe_revision,daily_through=excluded.daily_through,weekly_through=excluded.weekly_through,
        receipts_hash=excluded.receipts_hash,status=excluded.status,updated_at=excluded.updated_at`)
        .bind(id, metadata.effectiveSessionDate, metadata.universeRevision, metadata.dailyThrough, metadata.weeklyThrough,
          metadata.receiptsHash, createdAt, id),
      db.prepare(`DELETE FROM screener_snapshots WHERE status='published' AND schema_version=6 AND id NOT IN
        (SELECT id FROM screener_snapshots WHERE status='published' AND schema_version=6 ORDER BY created_at DESC,id DESC LIMIT ${SCREENER_V6_RESOURCE_LIMITS.retainedSnapshots})`),
    ]);
    const published = await db.prepare("SELECT status FROM screener_snapshots WHERE id=?").bind(id).first<{ status: string }>();
    const head = await db.prepare("SELECT snapshot_id FROM screener_chip_publication_head WHERE name='v6'").first<{ snapshot_id: string }>();
    if (published?.status !== "published" || head?.snapshot_id !== id) throw new Error("snapshot_publication_conflict");
    return id;
  } catch (error) {
    await db.prepare("DELETE FROM screener_snapshots WHERE id=? AND status='staging'").bind(id).run();
    throw error;
  }
}
