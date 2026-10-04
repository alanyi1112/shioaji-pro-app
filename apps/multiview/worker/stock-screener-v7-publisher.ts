import { technicalEvidenceHash } from "../../../src/lib/stock-screener-technical-patterns.ts";
import {
  SCREENER_V7_FORMULA_VERSION, buildTechnicalSnapshotEvidenceV7, type ScreenerInputV7,
} from "../../../src/lib/stock-screener-v7.ts";
import { SCREENER_OHLCV_V4_MAPPING_VERSION, type CanonicalOhlcv } from "../../../src/lib/stock-screener-ohlcv.ts";
import type { ScreenerDatabase } from "./stock-screener-repository.ts";
import { readScreenerV6Snapshot } from "./stock-screener-v6-repository.ts";
import { publishScreenerV7Snapshot, readScreenerV7Snapshot, type ScreenerV7Metadata } from "./stock-screener-v7-repository.ts";

type OhlcvRow = { symbol: string; data_date: string; market: "TWSE" | "TPEx"; open: string; high: string;
  low: string; close: string; volume_shares: string };

async function paged<T>(db: ScreenerDatabase, sql: string, bindings: Array<string | number>) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 5000) {
    const page = (await db.prepare(`${sql} LIMIT 5000 OFFSET ?`).bind(...bindings, offset).all<T>()).results ?? [];
    rows.push(...page);
    if (page.length < 5000) return rows;
  }
}

export async function publishPreparedScreenerV7(db: ScreenerDatabase, now = new Date()) {
  const base = await readScreenerV6Snapshot(db);
  if (!base) return { state: "pending", reason: "v6_snapshot_pending" } as const;
  const sessions = base.metadata.technicalAnchors.sessions;
  const effective = base.metadata.effectiveSessionDate;
  if (sessions.length !== 130 || sessions.at(-1) !== effective || base.metadata.dailyThrough !== effective) {
    return { state: "pending", reason: "mixed_session_dates" } as const;
  }
  const progressRow = await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE id='screener-ohlcv-v4-progress'")
    .first<{ status: string; checkpoint: string }>();
  const progress = progressRow ? JSON.parse(progressRow.checkpoint) : null;
  if (progressRow?.status !== "complete" || progress?.version !== 4 || progress?.remaining !== 0
    || progress?.failed !== 0 || progress?.overdue !== 0 || progress?.through !== effective
    || progress?.universeRevision !== base.metadata.universeRevision) {
    return { state: "pending", reason: "ohlcv_v4_bootstrap_pending", progress } as const;
  }
  const rawRows = await paged<OhlcvRow>(db, `SELECT symbol,data_date,market,open,high,low,close,volume_shares
    FROM screener_daily_ohlcv WHERE data_date>=? AND data_date<=? AND validation='canonical-complete-v2'
      AND volume_unit='shares' AND volume_mapping_version=? ORDER BY symbol,data_date`,
  [sessions[0]!, effective, SCREENER_OHLCV_V4_MAPPING_VERSION]);
  const bySymbol = new Map<string, OhlcvRow[]>();
  for (const row of rawRows) { const values = bySymbol.get(row.symbol) ?? []; values.push(row); bySymbol.set(row.symbol, values); }
  const inputs: ScreenerInputV7[] = [];
  const coverage: ScreenerV7Metadata["technicalCoverage"] = {
    TWSE: { target: 0, covered: 0, complete130: 0, indicatorReady: 0, indicatorWarmupUnknown: 0, continuityUnknown: 0 },
    TPEx: { target: 0, covered: 0, complete130: 0, indicatorReady: 0, indicatorWarmupUnknown: 0, continuityUnknown: 0 },
  };
  for (const input of base.inputs) {
    const marketCoverage = coverage[input.market]; marketCoverage.target++;
    const eligible = sessions.filter((date) => !input.listingDate || date >= input.listingDate);
    const raw = (bySymbol.get(input.symbol) ?? []).filter((row) => eligible.includes(row.data_date));
    const bars: CanonicalOhlcv[] = raw.map((row) => ({ sessionDate: row.data_date, open: row.open, high: row.high,
      low: row.low, close: row.close, volumeShares: row.volume_shares }));
    marketCoverage.covered++;
    if (bars.length === 130) marketCoverage.complete130++;
    const technicalV7 = await buildTechnicalSnapshotEvidenceV7(bars, eligible, technicalEvidenceHash);
    if (technicalV7.readinessReason === "non_adjacent_sessions") marketCoverage.continuityUnknown++;
    else if (bars.length >= 35) marketCoverage.indicatorReady++;
    else marketCoverage.indicatorWarmupUnknown++;
    inputs.push({ ...input, technicalV7 });
  }
  if (inputs.length !== base.metadata.total || (["TWSE", "TPEx"] as const).some((market) => coverage[market].covered !== coverage[market].target)) {
    return { state: "pending", reason: "universe_coverage_pending", coverage } as const;
  }
  const receiptsHash = await technicalEvidenceHash({ formulaVersion: SCREENER_V7_FORMULA_VERSION,
    sourceMappingVersion: SCREENER_OHLCV_V4_MAPPING_VERSION, baseSnapshotId: base.id,
    effectiveSessionDate: effective, universeRevision: base.metadata.universeRevision, coverage,
    evidenceHashes: inputs.map((row) => [row.symbol, row.technicalV7.evidenceHash]) });
  const previous = await readScreenerV7Snapshot(db);
  if (previous?.metadata.baseSnapshotId === base.id && previous.metadata.receiptsHash === receiptsHash) {
    return { state: "unchanged", snapshotId: previous.id, metadata: previous.metadata } as const;
  }
  const metadata: ScreenerV7Metadata = { ...base.metadata, version: 7, schemaVersion: 7,
    formulaVersion: SCREENER_V7_FORMULA_VERSION, sourceMappingVersion: SCREENER_OHLCV_V4_MAPPING_VERSION,
    baseSnapshotId: base.id, receiptsHash, technicalCoverage: coverage };
  const snapshotId = await publishScreenerV7Snapshot(db, metadata, inputs, now);
  return { state: "published", snapshotId, metadata } as const;
}
