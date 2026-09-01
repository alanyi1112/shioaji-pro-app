/** Only the trusted local updater supplies verified official periods. GET never calls this. */
import { isIsoDate, selectPeriodPair, type HolderPoint, type ScreenerInput, type UniverseStock, type VolumePoint } from "../../../src/lib/stock-screener-domain.ts";
import { publishScreenerSnapshot, readScreenerSnapshot, type ScreenerDatabase } from "./stock-screener-repository.ts";

export interface ScreenerPeriods {
  version: 1;
  sessions: string[];
  weeks: string[];
  through: string;
  validThrough: string;
  fetchedAt: string;
  sourceHashes: string[];
}
export async function publishCollectedScreener(db: ScreenerDatabase, periods: ScreenerPeriods, now = new Date()) {
  if (periods.version !== 1 || !isIsoDate(periods.through) || !periods.sourceHashes.length
    || periods.sourceHashes.some(hash => !/^[a-f0-9]{64}$/.test(hash))
    || !Number.isFinite(Date.parse(periods.fetchedAt)) || Date.parse(periods.fetchedAt) > now.getTime()
    || now.getTime() - Date.parse(periods.fetchedAt) > 12 * 3600000
    || Date.parse(periods.validThrough) <= now.getTime()) throw new Error("invalid_period_evidence");
  const catalogRun = await db.prepare("SELECT checkpoint FROM screener_runs WHERE id IN ('screener-daily','screener-weekly') AND status='collected' ORDER BY updated_at DESC LIMIT 1").first<{ checkpoint: string }>();
  if (!catalogRun) return { state: "pending", reason: "catalog_pending" };
  const receipt = JSON.parse(catalogRun.checkpoint).receipts?.catalog;
  if (!receipt?.complete || receipt.offset !== receipt.total) return { state: "pending", reason: "catalog_pending" };
  const catalogs = (await db.prepare("SELECT payload FROM screener_universe WHERE revision=? ORDER BY symbol").bind(receipt.hash).all<{ payload: string }>()).results ?? [];
  if (catalogs.length !== receipt.total || !catalogs.length) throw new Error("catalog_incomplete");
  const stocks = catalogs.map(row => {
    const entry = JSON.parse(row.payload) as { stock: UniverseStock; review: string; sourceDate: string };
    if (entry.review !== "verified" || entry.stock.classificationVersion !== "official-issuer-common-stock-FL033103-1131231-v1"
      || !isIsoDate(entry.sourceDate) || entry.sourceDate > periods.through
      || Date.parse(periods.through) - Date.parse(entry.sourceDate) > 3 * 86400000) throw new Error("catalog_review_pending");
    return entry.stock;
  });
  // Whole-source completion receipts, not individual rows, authorize a period.
  const publications = (await db.prepare("SELECT checkpoint FROM screener_runs WHERE scope='screener-source-period' AND status='collected'").all<{ checkpoint: string }>()).results ?? [];
  const published: Record<string, string[]> = { TWSE: [], TPEx: [], TDCC: [] };
  for (const row of publications) {
    const item = JSON.parse(row.checkpoint);
    if (item.complete && published[item.source] && isIsoDate(item.date)) published[item.source].push(item.date);
  }
  const anchors = {
    daily: selectPeriodPair(periods.sessions, [published.TWSE, published.TPEx], periods.through),
    weekly: selectPeriodPair(periods.weeks, [published.TDCC], periods.through),
    weeklyPeriods: periods.weeks.filter(date => date <= periods.through).slice(-6),
  };
  if (!anchors.daily && !anchors.weekly) return { state: "pending", reason: "period_pending" };
  const volumes = new Map<string, VolumePoint>(), holders = new Map<string, HolderPoint>();
  if (anchors.daily) for (const row of (await db.prepare("SELECT symbol,payload FROM screener_daily_volume WHERE data_date IN (?,?)").bind(anchors.daily.current, anchors.daily.previous).all<{ symbol: string; payload: string }>()).results ?? []) {
    const point = JSON.parse(row.payload) as VolumePoint; volumes.set(`${row.symbol}|${point.date}`, point);
  }
  if (anchors.weeklyPeriods.length) {
    const placeholders = anchors.weeklyPeriods.map(() => "?").join(",");
    for (const row of (await db.prepare(`SELECT symbol,payload FROM screener_tdcc_weekly WHERE data_date IN (${placeholders}) AND validation='full-17'`).bind(...anchors.weeklyPeriods).all<{ symbol: string; payload: string }>()).results ?? []) {
      const point = JSON.parse(row.payload) as HolderPoint; holders.set(`${row.symbol}|${point.date}`, point);
    }
  }
  const inputs: ScreenerInput[] = stocks.map(stock => ({ ...stock,
    currentVolume: volumes.get(`${stock.symbol}|${anchors.daily?.current}`) ?? null,
    previousVolume: volumes.get(`${stock.symbol}|${anchors.daily?.previous}`) ?? null,
    currentHolder: holders.get(`${stock.symbol}|${anchors.weekly?.current}`) ?? null,
    previousHolder: holders.get(`${stock.symbol}|${anchors.weekly?.previous}`) ?? null,
    holderSeries: anchors.weeklyPeriods.map(date => holders.get(`${stock.symbol}|${date}`)).filter((point): point is HolderPoint => point !== undefined),
  }));
  const previous = await readScreenerSnapshot(db);
  if (previous) for (const market of ["TWSE", "TPEx"] as const) {
    const before = previous.inputs.filter(stock => stock.market === market).length;
    if (stocks.filter(stock => stock.market === market).length < before * 0.95) throw new Error("invalid_universe_coverage");
  }
  if (previous && JSON.stringify(previous.inputs) === JSON.stringify(inputs)
    && previous.metadata.validThrough === periods.validThrough) return { state: "unchanged", snapshotId: previous.id };
  const turnoverValid = inputs.filter(input => input.currentVolume?.turnoverNtd != null).length;
  const historyComplete = anchors.weeklyPeriods.length === 6
    ? inputs.filter(input => input.holderSeries?.length === anchors.weeklyPeriods.length).length : 0;
  const historyOutcomes = (await db.prepare("SELECT checkpoint,status FROM screener_runs WHERE scope='screener-tdcc-bootstrap'").all<{checkpoint:string;status:string}>()).results ?? [];
  const outcomes = historyOutcomes.flatMap(row=>{try { const item=JSON.parse(row.checkpoint); return anchors.weeklyPeriods.includes(item.date)?[item]:[]; } catch { return []; }});
  const eligibleTargets = anchors.weeklyPeriods.flatMap(date=>stocks.filter(stock=>!stock.listingDate || stock.listingDate<=date).map(stock=>`${date}|${stock.symbol}`));
  const knownKeys = new Set([...holders].map(([key])=>{ const [symbol,date]=key.split("|"); return `${date}|${symbol}`; }));
  const checkedKeys = new Set(outcomes.map(item=>`${item.date}|${item.symbol}`));
  const processed = eligibleTargets.filter(key=>knownKeys.has(key)||checkedKeys.has(key)).length;
  const failed = outcomes.filter(item=>item.reason && !["none","official_no_data"].includes(item.reason)).length;
  const progressRow = await db.prepare("SELECT checkpoint FROM screener_runs WHERE id='screener-history-progress'").first<{checkpoint:string}>();
  let progress: {target:number;processed:number;remaining:number;failed:number;overdue:number;cursor?:string|null;dates?:string[];universeRevision?:string} | null = null;
  try { const parsed=JSON.parse(progressRow?.checkpoint ?? "null"); if (parsed?.version===2 && parsed.universeRevision===receipt.hash) progress=parsed; } catch { /* Recompute below. */ }
  const snapshotId = await publishScreenerSnapshot(db, { version: 2, schemaVersion: 2, formulaVersion: "after-market-v2", anchors, total: inputs.length,
    sourceReview: "verified", universeRevision: receipt.hash, validThrough: periods.validThrough,
    periodEvidence: { fetchedAt: periods.fetchedAt, sourceHashes: periods.sourceHashes },
    expectedSessionDate: periods.sessions.filter(date => date <= periods.through).at(-1),
    expectedWeekDate: periods.weeks.filter(date => date <= periods.through).at(-1),
    turnoverCoverage: { valid: turnoverValid, missing: inputs.length - turnoverValid },
    holderHistoryCoverage: { requiredPeriods: anchors.weeklyPeriods, complete: historyComplete, pending: inputs.length - historyComplete },
    background: progress ?? { target: eligibleTargets.length, processed, remaining: eligibleTargets.length - processed, failed, overdue: 0 } }, inputs, now);
  return { state: "published", snapshotId, total: inputs.length, anchors };
}
