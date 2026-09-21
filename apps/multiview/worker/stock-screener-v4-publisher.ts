import { DEFAULT_CRITERIA, hasAlignedSessionEvidence, screenStocks } from "../../../src/lib/stock-screener-domain.ts";
import { technicalEvidenceHash, type ScreenerInputV3 } from "../../../src/lib/stock-screener-technical-patterns.ts";
import {
  SCREENER_V4_FORMULA_VERSION, SCREENER_V4_OHLCV_WINDOW, buildTechnicalSnapshotEvidenceV4,
  type ScreenerInputV4, type ScreenerV4Counts, type ScreenerV4Metadata,
} from "../../../src/lib/stock-screener-v4.ts";
import { SCREENER_OHLCV_V4_MAPPING_VERSION, type CanonicalOhlcv } from "../../../src/lib/stock-screener-ohlcv.ts";
import { planOhlcvV4Bootstrap } from "../../../scripts/stock-screener-ohlcv-bootstrap.mjs";
import { type ScreenerDatabase } from "./stock-screener-repository.ts";
import { readScreenerV3Snapshot } from "./stock-screener-v3-repository.ts";
import { publishScreenerV4Snapshot, readScreenerV4Snapshot } from "./stock-screener-v4-repository.ts";

type OhlcvRow = { symbol: string; data_date: string; market: "TWSE" | "TPEx"; open: string; high: string;
  low: string; close: string; volume_shares: string };

async function readOhlcvWindow(db: ScreenerDatabase, first: string, last: string) {
  const rows: OhlcvRow[] = [];
  for (let offset = 0; ; offset += 5000) {
    const page = (await db.prepare("SELECT symbol,data_date,market,open,high,low,close,volume_shares FROM screener_daily_ohlcv WHERE data_date>=? AND data_date<=? AND validation='canonical-complete-v2' AND volume_unit='shares' AND volume_mapping_version=? ORDER BY symbol,data_date LIMIT ? OFFSET ?")
      .bind(first, last, SCREENER_OHLCV_V4_MAPPING_VERSION, 5000, offset).all<OhlcvRow>()).results ?? [];
    rows.push(...page);
    if (page.length < 5000) break;
  }
  return rows;
}

const parseReceipts = (rows: { status: string; checkpoint: string }[]) => rows.flatMap((row) => {
  try { return [{ ...JSON.parse(row.checkpoint), status: row.status }]; } catch { return []; }
});
const targetKey = (market: string, date: string) => `ohlcv-v4|${market}|${date}`;

export async function publishPreparedScreenerV4(db: ScreenerDatabase, now = new Date()) {
  const base = await readScreenerV3Snapshot(db);
  if (!base) return { state: "pending", reason: "v3_snapshot_pending" } as const;
  const progressRow = await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE id='screener-ohlcv-v4-progress'")
    .first<{ status: string; checkpoint: string }>();
  if (!progressRow) return { state: "pending", reason: "ohlcv_v4_bootstrap_pending" } as const;
  const checkpoint = JSON.parse(progressRow.checkpoint);
  const sessions = checkpoint.sessions as string[];
  if (progressRow.status !== "complete" || checkpoint.version !== 4 || checkpoint.dataCapability !== "ohlcv-v4"
    || checkpoint.remaining !== 0 || checkpoint.failed !== 0 || checkpoint.overdue !== 0
    || !Array.isArray(sessions) || sessions.length !== SCREENER_V4_OHLCV_WINDOW
    || checkpoint.universeRevision !== base.metadata.universeRevision) {
    return { state: "pending", reason: "ohlcv_v4_bootstrap_pending", progress: checkpoint } as const;
  }
  const effectiveSessionDate = base.metadata.effectiveSessionDate ?? base.metadata.anchors.daily?.current ?? null;
  if (!effectiveSessionDate || !hasAlignedSessionEvidence({ expectedSessionDate: base.metadata.expectedSessionDate,
    daily: base.metadata.anchors.daily, technicalThrough: sessions.at(-1), effectiveSessionDate })) {
    return { state: "pending", reason: "mixed_session_dates", progress: checkpoint } as const;
  }
  const receiptRows = (await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE scope='screener-ohlcv-v4-period'")
    .all<{ status: string; checkpoint: string }>()).results ?? [];
  const receipts = parseReceipts(receiptRows);
  const rawRows = await readOhlcvWindow(db, sessions[0]!, sessions.at(-1)!);
  const coverage = new Map<string, Set<string>>();
  const addCoverage = (key: string, symbol: string) => { const set = coverage.get(key) ?? new Set<string>(); set.add(symbol); coverage.set(key, set); };
  for (const row of rawRows) addCoverage(targetKey(row.market, row.data_date), row.symbol);
  for (const receipt of receipts) for (const symbol of [...(receipt.invalidSymbols ?? []), ...(receipt.missingSymbols ?? [])]) {
    addCoverage(targetKey(receipt.market, receipt.sessionDate), symbol);
  }
  const plan = planOhlcvV4Bootstrap(base.inputs, sessions, receipts, coverage);
  if (plan.remaining !== 0 || plan.failed !== 0 || plan.processed !== plan.target) {
    return { state: "pending", reason: "universe_coverage_pending", progress: checkpoint } as const;
  }
  const relevantReceipts = receipts.filter((receipt) => receipt.dataCapability === "ohlcv-v4" && sessions.includes(receipt.sessionDate))
    .sort((a, b) => `${a.market}|${a.sessionDate}`.localeCompare(`${b.market}|${b.sessionDate}`));
  const receiptsHash = await technicalEvidenceHash({ readerVersion: "session-aligned-v2", receipts: relevantReceipts });
  const previous = await readScreenerV4Snapshot(db);
  if (previous?.metadata.baseSnapshotId === base.id && previous.metadata.receiptsHash === receiptsHash) {
    return { state: "unchanged", snapshotId: previous.id } as const;
  }

  const bySymbol = new Map<string, CanonicalOhlcv[]>();
  const allowed = new Set(base.inputs.map((row) => row.symbol));
  for (const row of rawRows) {
    if (!allowed.has(row.symbol)) continue;
    const values = bySymbol.get(row.symbol) ?? [];
    values.push({ sessionDate: row.data_date, open: row.open, high: row.high, low: row.low,
      close: row.close, volumeShares: row.volume_shares });
    bySymbol.set(row.symbol, values);
  }
  const inputs: ScreenerInputV4[] = [];
  for (const input of base.inputs as ScreenerInputV3[]) {
    const eligibleSessions = sessions.filter((date) => !input.listingDate || date >= input.listingDate);
    const bars = (bySymbol.get(input.symbol) ?? []).filter((bar) => eligibleSessions.includes(bar.sessionDate));
    inputs.push({ ...input, technicalV4: await buildTechnicalSnapshotEvidenceV4(bars, eligibleSessions) });
  }
  if (inputs.length !== base.metadata.total) throw new Error("snapshot_incomplete");
  const legacy = screenStocks(base.inputs, base.metadata.anchors, DEFAULT_CRITERIA);
  const maMissing = inputs.filter((row) => row.technicalV4.ma.verdict === "unknown").length;
  const divergenceMissing = inputs.filter((row) => Object.values(row.technicalV4.divergence)
    .every((matrix) => matrix.bullish.verdict === "unknown" && matrix.bearish.verdict === "unknown")).length;
  const unknown = inputs.filter((row) => row.technicalV4.ma.verdict === "unknown"
    || Object.values(row.technicalV4.divergence).some((matrix) => matrix.bullish.verdict === "unknown" || matrix.bearish.verdict === "unknown")).length;
  const counts: ScreenerV4Counts = { total: inputs.length, evaluated: inputs.length - unknown, matched: 0,
    notMatched: inputs.length - unknown, unknown, missingByCondition: {
      ...legacy.counts.missingByCondition,
      fractal: base.metadata.counts.missingByCondition.fractal,
      "boll-reversal": base.metadata.counts.missingByCondition["boll-reversal"],
      ma: maMissing, divergence: divergenceMissing,
    } };
  const progress = { version: 4 as const, target: checkpoint.target, processed: checkpoint.processed,
    remaining: checkpoint.remaining, failed: checkpoint.failed, overdue: checkpoint.overdue,
    cursor: checkpoint.cursor ?? null, markets: checkpoint.markets };
  const metadata: ScreenerV4Metadata = { version: 4, schemaVersion: 4, sessionAlignmentVersion: "official-sessions-v1",
    formulaVersion: SCREENER_V4_FORMULA_VERSION, sourceMappingVersion: SCREENER_OHLCV_V4_MAPPING_VERSION,
    anchors: base.metadata.anchors, technicalAnchors: { sessions, through: sessions.at(-1)! },
    baseSnapshotId: base.id, receiptsHash, universeRevision: base.metadata.universeRevision,
    total: inputs.length, validThrough: base.metadata.validThrough, sourceReview: "verified", progress, counts,
    expectedSessionDate: effectiveSessionDate, effectiveSessionDate };
  const latestBase = await readScreenerV3Snapshot(db);
  const latestProgress = await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE id='screener-ohlcv-v4-progress'")
    .first<{ status: string; checkpoint: string }>();
  const latestCheckpoint = latestProgress ? JSON.parse(latestProgress.checkpoint) : null;
  if (latestBase?.id !== base.id || latestProgress?.status !== "complete" || latestCheckpoint?.through !== effectiveSessionDate
    || latestCheckpoint?.universeRevision !== base.metadata.universeRevision) {
    return { state: "pending", reason: "mixed_session_dates" } as const;
  }
  const snapshotId = await publishScreenerV4Snapshot(db, metadata, inputs, now);
  return { state: "published", snapshotId, metadata } as const;
}
