import { DEFAULT_CRITERIA, screenStocks } from "../../../src/lib/stock-screener-domain.ts";
import {
  evaluateBollReversal, evaluateChanFractal, evaluateRawFractal,
  SCREENER_V3_FORMULA_VERSION, technicalEvidenceHash,
  type CanonicalOhlc, type ScreenerInputV3, type ScreenerV3Counts, type ScreenerV3Metadata,
  type TechnicalSnapshotEvidence,
} from "../../../src/lib/stock-screener-technical-patterns.ts";
import { planOhlcvBootstrap } from "../../../scripts/stock-screener-ohlcv-bootstrap.mjs";
import { readScreenerSnapshot, type ScreenerDatabase } from "./stock-screener-repository.ts";
import { publishScreenerV3Snapshot, readScreenerV3Snapshot } from "./stock-screener-v3-repository.ts";

type OhlcvRow = { symbol: string; data_date: string; market: "TWSE" | "TPEx"; open: string; high: string; low: string; close: string };

export async function buildTechnicalSnapshotEvidence(
  bars: readonly CanonicalOhlc[], sessions: readonly string[],
): Promise<TechnicalSnapshotEvidence> {
  const evidence = {
    rawBottom: evaluateRawFractal(bars, sessions, "bottom"),
    rawTop: evaluateRawFractal(bars, sessions, "top"),
    chanBottom: evaluateChanFractal(bars, sessions, "bottom"),
    chanTop: evaluateChanFractal(bars, sessions, "top"),
    lowerBullish: evaluateBollReversal(bars, sessions, "lower-bullish"),
    upperBearish: evaluateBollReversal(bars, sessions, "upper-bearish"),
  };
  return { ...evidence, evidenceHash: await technicalEvidenceHash(evidence) };
}

async function readOhlcvWindow(db: ScreenerDatabase, first: string, last: string) {
  const rows: OhlcvRow[] = [];
  for (let offset = 0; ; offset += 5000) {
    const page = (await db.prepare("SELECT symbol,data_date,market,open,high,low,close FROM screener_daily_ohlcv WHERE data_date>=? AND data_date<=? AND validation='canonical-complete-v1' ORDER BY symbol,data_date LIMIT ? OFFSET ?")
      .bind(first, last, 5000, offset).all<OhlcvRow>()).results ?? [];
    rows.push(...page);
    if (page.length < 5000) break;
  }
  return rows;
}

const parseReceipts = (rows: { status: string; checkpoint: string }[]) => rows.map((row) => {
  const receipt = JSON.parse(row.checkpoint);
  return { ...receipt, status: row.status };
});

export async function publishPreparedScreenerV3(db: ScreenerDatabase, now = new Date()) {
  const base = await readScreenerSnapshot(db, undefined, 2);
  if (!base || base.metadata.version !== 2 || base.metadata.schemaVersion !== 2) return { state: "pending", reason: "v2_snapshot_pending" } as const;
  const progressRow = await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE id='screener-ohlcv-progress'").first<{ status: string; checkpoint: string }>();
  if (!progressRow) return { state: "pending", reason: "ohlcv_bootstrap_pending" } as const;
  const checkpoint = JSON.parse(progressRow.checkpoint);
  const sessions = checkpoint.sessions as string[];
  if (progressRow.status !== "complete" || checkpoint.version !== 3 || checkpoint.remaining !== 0
    || checkpoint.failed !== 0 || checkpoint.overdue !== 0 || !Array.isArray(sessions) || sessions.length !== 60
    || checkpoint.universeRevision !== base.metadata.universeRevision) return { state: "pending", reason: "ohlcv_bootstrap_pending", progress: checkpoint } as const;
  const receiptRows = (await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE scope='screener-ohlcv-period'").all<{ status: string; checkpoint: string }>()).results ?? [];
  const receipts = parseReceipts(receiptRows);
  const receiptPlan = planOhlcvBootstrap(base.inputs, sessions, receipts);
  if (receiptPlan.remaining !== 0 || receiptPlan.failed !== 0 || receiptPlan.processed !== receiptPlan.target) throw new Error("incomplete_ohlcv_receipts");
  const receiptsHash = await technicalEvidenceHash(receipts.filter((receipt) => sessions.includes(receipt.sessionDate))
    .sort((a, b) => `${a.market}|${a.sessionDate}`.localeCompare(`${b.market}|${b.sessionDate}`)));
  const previous = await readScreenerV3Snapshot(db);
  if (previous?.metadata.baseSnapshotId === base.id && previous.metadata.receiptsHash === receiptsHash) return { state: "unchanged", snapshotId: previous.id } as const;

  const rawRows = await readOhlcvWindow(db, sessions[0]!, sessions.at(-1)!);
  const allowedSymbols = new Set(base.inputs.map((row) => row.symbol));
  const bySymbol = new Map<string, CanonicalOhlc[]>();
  for (const row of rawRows) {
    if (!allowedSymbols.has(row.symbol) || !sessions.includes(row.data_date)) continue;
    const values = bySymbol.get(row.symbol) ?? [];
    values.push({ sessionDate: row.data_date, open: row.open, high: row.high, low: row.low, close: row.close });
    bySymbol.set(row.symbol, values);
  }
  const inputs: ScreenerInputV3[] = [];
  for (const input of base.inputs) {
    const eligibleSessions = sessions.filter((date) => !input.listingDate || date >= input.listingDate);
    const bars = (bySymbol.get(input.symbol) ?? []).filter((bar) => eligibleSessions.includes(bar.sessionDate));
    inputs.push({ ...input, technical: await buildTechnicalSnapshotEvidence(bars, eligibleSessions) });
  }
  if (inputs.length !== base.metadata.total) throw new Error("snapshot_incomplete");
  const baseCoverage = screenStocks(base.inputs, base.metadata.anchors, DEFAULT_CRITERIA);
  const fractalMissing = inputs.filter((row) => [row.technical.rawBottom, row.technical.rawTop, row.technical.chanBottom, row.technical.chanTop].every((value) => value.verdict === "unknown")).length;
  const bollMissing = inputs.filter((row) => [row.technical.lowerBullish, row.technical.upperBearish].every((value) => value.verdict === "unknown")).length;
  const unknown = inputs.filter((row) => [row.technical.rawBottom, row.technical.rawTop, row.technical.chanBottom, row.technical.chanTop,
    row.technical.lowerBullish, row.technical.upperBearish].some((value) => value.verdict === "unknown")).length;
  const counts: ScreenerV3Counts = { total: inputs.length, evaluated: inputs.length - unknown, matched: 0,
    notMatched: inputs.length - unknown, unknown, missingByCondition: {
      ...baseCoverage.counts.missingByCondition, fractal: fractalMissing, "boll-reversal": bollMissing,
    } };
  const progress = { version: 3 as const, target: checkpoint.target, processed: checkpoint.processed,
    remaining: checkpoint.remaining, failed: checkpoint.failed, overdue: checkpoint.overdue,
    cursor: checkpoint.cursor ?? null, markets: checkpoint.markets };
  const metadata: ScreenerV3Metadata = { version: 3, schemaVersion: 3, formulaVersion: SCREENER_V3_FORMULA_VERSION,
    anchors: base.metadata.anchors, technicalAnchors: { sessions, through: sessions.at(-1)! },
    baseSnapshotId: base.id, receiptsHash, universeRevision: base.metadata.universeRevision,
    total: inputs.length, validThrough: base.metadata.validThrough, sourceReview: "verified", progress, counts };
  const snapshotId = await publishScreenerV3Snapshot(db, metadata, inputs, now);
  return { state: "published", snapshotId, metadata } as const;
}
