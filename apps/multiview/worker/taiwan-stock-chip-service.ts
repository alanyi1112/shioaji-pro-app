import {
  aggregateDistribution,
  createFinMindAdapter,
  datasetEligibility as buildDatasetEligibility,
  mergeChipRows,
  mergeChipDailyRow,
  normalizeForeignHoldingRows,
  normalizeInstitutionalRows,
  normalizeMarginShortRows,
  normalizeSecuritiesLendingRows,
  normalizeTpexForeignHoldingLatest,
  normalizeTpexInstitutionalLatest,
  normalizeTpexMarginLatest,
  normalizeTwseInstitutionalLatest,
  normalizeTwseMarginReport,
  parseTdccSnapshot,
  type ChipDailyRow,
  type ChipDataset,
  type ChipReasonCode,
  type DistributionRow,
  type DistributionLevel,
  type InstitutionalFlow,
  type ForeignHolding,
  type MarginShort,
  type SecuritiesLending,
} from "./taiwan-stock-chip.ts";
import { readTdccContinuousSymbolStatus } from "./tdcc-continuous-backfill.ts";
import { readTdccWorkflowDispatch } from "./tdcc-workflow-dispatch.ts";
import { WATCHLIST_CHIP_PREWARM_CONTRACT, watchlistChipWarmWindow } from "./watchlist-chip-prewarming.ts";
import { calculateEstimatedMarginMetrics, ESTIMATED_MARGIN_FORMULA_VERSION } from "./estimated-margin-metrics.ts";
import { runD1Batch } from "./d1-batch.ts";

type ChipEnv = { DB?: D1Database; FINMIND_API_TOKEN?: string; GITHUB_WORKFLOW_DISPATCH_TOKEN?: string };
export type TaiwanChipEligibility = { eligible: boolean; symbol: string; exchange: "TWSE" | "TPEx" | ""; quoteType?: string; eligibleSymbols: ReadonlySet<string> };
type Availability = { status: "available" | "partial" | "unavailable"; reason: ChipReasonCode; rowCount: number };
type ChipDailyDbRow = {
  symbol: unknown;
  session_date: unknown;
  institutional_flow_json?: unknown;
  foreign_holding_json?: unknown;
  margin_short_json?: unknown;
  securities_lending_json?: unknown;
  provenance_json?: unknown;
};
type DistributionDbRow = {
  symbol: unknown;
  data_date: unknown;
  levels_json?: unknown;
  adjustment_json?: unknown;
  total_json?: unknown;
  source_fetched_at?: unknown;
};
type ChipFetchStateRow = {
  status?: string | null;
  coverage_start?: string | null;
  coverage_end?: string | null;
  source_date?: string | null;
  last_success_at?: string | null;
  last_attempt_at?: string | null;
  retry_after?: string | null;
  reason_code?: ChipReasonCode | null;
};
type CandleCloseDbRow = { time?: number | null; close?: number | null };

const dailyDatasets = ["institutional-flow", "foreign-holding", "margin-short", "securities-lending"] as const;
const allDatasets = [...dailyDatasets, "shareholder-distribution"] as const;
const TDCC_MARKET_STATE_SYMBOL = "__MARKET__:tdcc-1-5-v3";
const singleFlights = new Map<string, Promise<unknown>>();

const datasetNames: Record<(typeof allDatasets)[number], string> = {
  "institutional-flow": "三大法人買賣超",
  "foreign-holding": "外資及陸資持股",
  "margin-short": "融資融券",
  "securities-lending": "借券成交",
  "shareholder-distribution": "股權分散",
};

function datasetName(dataset: string) {
  return datasetNames[dataset as keyof typeof datasetNames] || "籌碼資料";
}

function retryTimeLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

function incompleteDailyWarning(dataset: string, actualEnd: string, requestedEnd: string) {
  if (dataset === "foreign-holding") {
    return `外資及陸資持股（外資及陸資持有股數，以及占已發行股數比例）：最新資料為 ${actualEnd}，尚未更新至 ${requestedEnd}；來源通常於交易日晚間 21:00 更新，來源更新後網站會在背景更新或再次開啟圖表時自動補入（實際時間以來源發布為準）`;
  }
  if (dataset === "securities-lending") {
    return `借券成交（當日投資人實際借入證券的成交股數，不等於借券賣出或放空）：最近有成交的日期為 ${actualEnd}；若當日有成交，來源通常於交易日 15:00 更新，若無成交可能不會新增一筆 0，網站仍會在背景更新或再次開啟圖表時重新檢查（實際時間以來源發布為準）`;
  }
  return `${datasetName(dataset)}：最新資料為 ${actualEnd}，尚未更新至 ${requestedEnd}；網站會在背景更新或再次開啟圖表時重新檢查（實際時間以來源發布為準）`;
}

export async function prewarmTaiwanStockChipSymbol(input: {
  env: ChipEnv;
  eligibility: TaiwanChipEligibility;
  datasets?: string[];
  now?: Date | string;
  fetchImpl?: typeof fetch;
}) {
  if (!input.eligibility.eligible) return { symbol: input.eligibility.symbol, eligible: false, warmedDatasets: [], status: "not_eligible" };
  const window = watchlistChipWarmWindow(input.now);
  const datasets = [...new Set((input.datasets || [...WATCHLIST_CHIP_PREWARM_CONTRACT.datasets]).filter((dataset) => WATCHLIST_CHIP_PREWARM_CONTRACT.datasets.includes(dataset as typeof WATCHLIST_CHIP_PREWARM_CONTRACT.datasets[number])))];
  if (!datasets.length) return { symbol: input.eligibility.symbol, eligible: true, warmedDatasets: [], status: "not_requested" };
  const url = new URL("https://internal/api/taiwan-stock-chip");
  url.searchParams.set("symbol", input.eligibility.symbol);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("start", window.start);
  url.searchParams.set("end", window.end);
  url.searchParams.set("datasets", datasets.join(","));
  const result = await taiwanStockChipPayload({ url, env: input.env, eligibility: input.eligibility, fetchImpl: input.fetchImpl, now: input.now });
  const availability = result.body?.availability || {};
  return {
    symbol: input.eligibility.symbol,
    eligible: true,
    warmedDatasets: datasets,
    status: result.status === 200 ? "completed" : "failed",
    availability: Object.fromEntries(datasets.map((dataset) => [dataset, availability[dataset]?.reason || "provider_unavailable"])),
  };
}

function fetchWithTimeout(fetchImpl: typeof fetch, input: RequestInfo | URL, init: RequestInit = {}) {
  const timeout = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(12000) : undefined;
  return fetchImpl(input, { ...init, signal: init.signal || timeout });
}

function singleFlight<T>(key: string, work: () => Promise<T>) {
  const existing = singleFlights.get(key);
  if (existing) return existing as Promise<T>;
  const current = work().finally(() => singleFlights.delete(key));
  singleFlights.set(key, current);
  return current;
}

const safeJson = <T>(value: unknown, fallback: T): T => {
  try { return typeof value === "string" ? JSON.parse(value) as T : fallback; }
  catch { return fallback; }
};

function dbRowToDaily(row: ChipDailyDbRow): ChipDailyRow {
  const institutionalFlow = safeJson<Partial<InstitutionalFlow> | null>(row.institutional_flow_json, null);
  const marginShort = safeJson<Partial<MarginShort> | null>(row.margin_short_json, null);
  return {
    symbol: String(row.symbol),
    sessionDate: String(row.session_date),
    institutionalFlow: institutionalFlow ? {
      foreignBuyShares: null,
      foreignSellShares: null,
      foreignNetShares: null,
      investmentTrustBuyShares: null,
      investmentTrustSellShares: null,
      investmentTrustNetShares: null,
      dealerSelfNetShares: null,
      dealerHedgingNetShares: null,
      dealerTotalNetShares: null,
      institutionalTotalNetShares: null,
      sourceTotalNetShares: null,
      sourceTotalVerified: null,
      ...institutionalFlow,
    } : null,
    foreignHolding: safeJson<ForeignHolding | null>(row.foreign_holding_json, null),
    marginShort: marginShort ? {
      marginBuyLots: null,
      marginSellLots: null,
      marginCashRepaymentLots: null,
      marginYesterdayBalanceLots: null,
      marginTodayBalanceLots: null,
      marginBalanceChangeLots: null,
      marginLimitLots: null,
      marginUtilizationPercent: null,
      shortBuyLots: null,
      shortSellLots: null,
      shortCashRepaymentLots: null,
      shortYesterdayBalanceLots: null,
      shortTodayBalanceLots: null,
      shortBalanceChangeLots: null,
      shortLimitLots: null,
      shortUtilizationPercent: null,
      offsetLots: null,
      ...marginShort,
    } : null,
    securitiesLending: safeJson<SecuritiesLending | null>(row.securities_lending_json, null),
    provenance: safeJson(row.provenance_json, {}),
  };
}

function dbRowToDistribution(row: DistributionDbRow): DistributionRow {
  const sourceFetchedAt = String(row.source_fetched_at || "");
  const dataDate = String(row.data_date);
  return {
    symbol: String(row.symbol), dataDate,
    levels: safeJson<DistributionLevel[]>(row.levels_json, []), adjustment: safeJson<DistributionLevel>(row.adjustment_json, {} as DistributionLevel), total: safeJson<DistributionLevel>(row.total_json, {} as DistributionLevel),
    provenance: { provider: "tdcc", dataset: "shareholder-distribution", frequency: "weekly", sourceDate: dataDate, fetchedAt: sourceFetchedAt },
  } as DistributionRow;
}

async function readDaily(db: D1Database | undefined, symbol: string, start: string, end: string) {
  if (!db) return [];
  const result = await db.prepare("SELECT * FROM taiwan_stock_chip_daily WHERE symbol = ? AND session_date >= ? AND session_date <= ? ORDER BY session_date").bind(symbol, start, end).all<ChipDailyDbRow>();
  return result.results.map(dbRowToDaily);
}

async function readDailyCloses(db: D1Database | undefined, symbol: string, start: string, end: string) {
  if (!db) return new Map<string, number>();
  const from = Math.floor(Date.parse(`${start}T00:00:00.000Z`) / 1000) - 86400;
  const to = Math.floor(Date.parse(`${end}T00:00:00.000Z`) / 1000) + 2 * 86400;
  const result = await db.prepare("SELECT time,close FROM candle_history WHERE provider = 'yfinance' AND symbol = ? AND interval = '1d' AND time >= ? AND time <= ? ORDER BY time").bind(symbol, from, to).all<CandleCloseDbRow>();
  const closes = new Map<string, number>();
  for (const row of result.results) {
    const time = Number(row.time);
    const close = Number(row.close);
    if (!Number.isFinite(time) || !Number.isFinite(close) || close <= 0) continue;
    closes.set(new Date(time * 1000).toISOString().slice(0, 10), close);
  }
  return closes;
}

function safeAggregate(row: DistributionRow, kind: Parameters<typeof aggregateDistribution>[1]) {
  try { return aggregateDistribution(row, kind); }
  catch { return null; }
}

export function decorateDistributionRows(rows: DistributionRow[]) {
  let previousTotalHolders: number | null = null;
  let previousLargeHolders: number | null = null;
  let previousRetailHolders: number | null = null;
  let previousLarge400Holders: number | null = null;
  return [...rows].sort((left, right) => left.dataDate.localeCompare(right.dataDate)).map((row) => {
    const largeHolder = safeAggregate(row, "large-holder-tier");
    const retailHolder = safeAggregate(row, "retail-holder-tiers");
    const largeHolder400 = safeAggregate(row, "large-holder-400");
    const totalHolders = Number.isFinite(Number(row.total?.holders)) ? Number(row.total.holders) : null;
    const holderMetrics = {
      totalHolders,
      totalHoldersChange: totalHolders === null || previousTotalHolders === null ? null : totalHolders - previousTotalHolders,
      previousDataDate: null as string | null,
      largeHolder: largeHolder ? {
        ...largeHolder,
        holdersChange: previousLargeHolders === null ? null : largeHolder.holders - previousLargeHolders,
      } : null,
      retailHolder: retailHolder ? {
        ...retailHolder,
        holdersChange: previousRetailHolders === null ? null : retailHolder.holders - previousRetailHolders,
      } : null,
      largeHolder400: largeHolder400 ? {
        ...largeHolder400,
        holdersChange: previousLarge400Holders === null ? null : largeHolder400.holders - previousLarge400Holders,
      } : null,
    };
    const previous = rows.filter((candidate) => candidate.dataDate < row.dataDate).sort((a, b) => b.dataDate.localeCompare(a.dataDate))[0];
    holderMetrics.previousDataDate = previous?.dataDate || null;
    if (totalHolders !== null) previousTotalHolders = totalHolders;
    if (largeHolder) previousLargeHolders = largeHolder.holders;
    if (retailHolder) previousRetailHolders = retailHolder.holders;
    if (largeHolder400) previousLarge400Holders = largeHolder400.holders;
    return { ...row, largeHolder, retailHolder, largeHolder400, holderMetrics };
  });
}

function decorateEstimatedMarginRows(rows: ChipDailyRow[], closes: Map<string, number>) {
  const metrics = calculateEstimatedMarginMetrics(rows.flatMap((row) => row.marginShort ? [{
    sessionDate: row.sessionDate,
    close: closes.get(row.sessionDate) ?? null,
    marginBuyLots: row.marginShort.marginBuyLots,
    marginSellLots: row.marginShort.marginSellLots,
    marginCashRepaymentLots: row.marginShort.marginCashRepaymentLots,
    marginYesterdayBalanceLots: row.marginShort.marginYesterdayBalanceLots,
    marginTodayBalanceLots: row.marginShort.marginTodayBalanceLots,
    marginBalanceChangeLots: row.marginShort.marginBalanceChangeLots,
  }] : []));
  const byDate = new Map(metrics.map((item) => [item.sessionDate, item]));
  return rows.map((row) => {
    const metric = byDate.get(row.sessionDate);
    if (!row.marginShort || !metric) return row;
    return {
      ...row,
      marginShort: {
        ...row.marginShort,
        estimatedCostPrice: metric.estimatedCostPrice,
        estimatedMaintenancePercent: metric.estimatedMaintenancePercent,
        marginLoanRatioPercent: metric.marginLoanRatioPercent,
        marginLoanRatioSource: metric.marginLoanRatioSource,
        marginLoanRatioSourceDate: metric.marginLoanRatioSourceDate,
        estimatedMarginSeeded: metric.seeded,
        estimatedMarginReseeded: metric.reseeded,
        estimatedMarginStatus: metric.status,
        estimatedMarginReasonCode: metric.reasonCode,
        estimatedMaintenanceReasonCode: metric.maintenanceReasonCode,
        estimatedMarginFormulaVersion: metric.formulaVersion,
        estimatedMarginClose: metric.close,
      },
    };
  });
}

async function readDistribution(db: D1Database | undefined, symbol: string, start: string, end: string) {
  if (!db) return [];
  const result = await db.prepare("SELECT * FROM taiwan_stock_shareholder_distribution WHERE symbol = ? AND data_date >= ? AND data_date <= ? ORDER BY data_date").bind(symbol, start, end).all<DistributionDbRow>();
  return result.results.map(dbRowToDistribution);
}

function completeness(row: ChipDailyRow) {
  return Object.fromEntries(Object.keys(row.provenance).map((dataset) => [dataset, true]));
}

function canonicalJson(value: unknown): string {
  const canonicalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonicalize);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, canonicalize(nested)]));
  };
  return JSON.stringify(canonicalize(value));
}

function materialProvenance(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const material = { ...value as Record<string, unknown> };
  delete material.fetchedAt;
  return material;
}

function materialDatasetChanged(beforeData: unknown, nextData: unknown, beforeProvenance: unknown, nextProvenance: unknown) {
  return canonicalJson(beforeData) !== canonicalJson(nextData)
    || canonicalJson(materialProvenance(beforeProvenance)) !== canonicalJson(materialProvenance(nextProvenance));
}

export function changedChipDailyPatch(existing: ChipDailyRow | undefined, incoming: ChipDailyRow): ChipDailyRow | null {
  if (!existing) return incoming;
  const merged = mergeChipDailyRow(existing, incoming);
  const institutionalFlow = merged.institutionalFlow === incoming.institutionalFlow
    && incoming.institutionalFlow
    && materialDatasetChanged(existing.institutionalFlow, incoming.institutionalFlow, existing.provenance["institutional-flow"], incoming.provenance["institutional-flow"])
    ? incoming.institutionalFlow : null;
  const foreignHolding = merged.foreignHolding === incoming.foreignHolding
    && incoming.foreignHolding
    && materialDatasetChanged(existing.foreignHolding, incoming.foreignHolding, existing.provenance["foreign-holding"], incoming.provenance["foreign-holding"])
    ? incoming.foreignHolding : null;
  const marginShort = merged.marginShort === incoming.marginShort
    && incoming.marginShort
    && materialDatasetChanged(existing.marginShort, incoming.marginShort, existing.provenance["margin-short"], incoming.provenance["margin-short"])
    ? incoming.marginShort : null;
  const securitiesLending = merged.securitiesLending === incoming.securitiesLending
    && incoming.securitiesLending
    && materialDatasetChanged(existing.securitiesLending, incoming.securitiesLending, existing.provenance["securities-lending"], incoming.provenance["securities-lending"])
    ? incoming.securitiesLending : null;
  const provenance = {
    ...(institutionalFlow && incoming.provenance["institutional-flow"] ? { "institutional-flow": incoming.provenance["institutional-flow"] } : {}),
    ...(foreignHolding && incoming.provenance["foreign-holding"] ? { "foreign-holding": incoming.provenance["foreign-holding"] } : {}),
    ...(marginShort && incoming.provenance["margin-short"] ? { "margin-short": incoming.provenance["margin-short"] } : {}),
    ...(securitiesLending && incoming.provenance["securities-lending"] ? { "securities-lending": incoming.provenance["securities-lending"] } : {}),
  };
  if (!Object.keys(provenance).length) return null;
  return { ...incoming, institutionalFlow, foreignHolding, marginShort, securitiesLending, provenance };
}

async function upsertDaily(db: D1Database | undefined, exchange: string, rows: ChipDailyRow[]) {
  if (!db || !rows.length) return { attempted: rows.length, written: 0, unchanged: rows.length };
  const existing = new Map((await readDaily(db, rows[0].symbol, rows.map((row) => row.sessionDate).sort()[0], rows.map((row) => row.sessionDate).sort().at(-1)!)).map((row) => [row.sessionDate, row]));
  const acceptedRows = rows.map((row) => changedChipDailyPatch(existing.get(row.sessionDate), row)).filter((row): row is ChipDailyRow => Boolean(row));
  const statements = acceptedRows.map((row) => db.prepare(`INSERT INTO taiwan_stock_chip_daily (symbol,session_date,exchange,institutional_flow_json,foreign_holding_json,margin_short_json,securities_lending_json,provenance_json,completeness_json) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(symbol,session_date) DO UPDATE SET exchange=excluded.exchange,institutional_flow_json=COALESCE(excluded.institutional_flow_json,taiwan_stock_chip_daily.institutional_flow_json),foreign_holding_json=COALESCE(excluded.foreign_holding_json,taiwan_stock_chip_daily.foreign_holding_json),margin_short_json=COALESCE(excluded.margin_short_json,taiwan_stock_chip_daily.margin_short_json),securities_lending_json=COALESCE(excluded.securities_lending_json,taiwan_stock_chip_daily.securities_lending_json),provenance_json=json_patch(taiwan_stock_chip_daily.provenance_json,excluded.provenance_json),completeness_json=json_patch(taiwan_stock_chip_daily.completeness_json,excluded.completeness_json),updated_at=CURRENT_TIMESTAMP`).bind(
    row.symbol, row.sessionDate, exchange,
    row.institutionalFlow ? JSON.stringify(row.institutionalFlow) : null,
    row.foreignHolding ? JSON.stringify(row.foreignHolding) : null,
    row.marginShort ? JSON.stringify(row.marginShort) : null,
    row.securitiesLending ? JSON.stringify(row.securitiesLending) : null,
    JSON.stringify(row.provenance), JSON.stringify(completeness(row)),
  ));
  await runD1Batch(db, statements);
  return { attempted: rows.length, written: acceptedRows.length, unchanged: rows.length - acceptedRows.length };
}

async function upsertDistribution(db: D1Database | undefined, rows: DistributionRow[]) {
  if (!db || !rows.length) return;
  const statements = rows.map((row) => db.prepare(`INSERT INTO taiwan_stock_shareholder_distribution (symbol,data_date,levels_json,adjustment_json,total_json,provider,frequency,source_fetched_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(symbol,data_date) DO UPDATE SET levels_json=excluded.levels_json,adjustment_json=excluded.adjustment_json,total_json=excluded.total_json,provider=excluded.provider,frequency=excluded.frequency,source_fetched_at=excluded.source_fetched_at,updated_at=CURRENT_TIMESTAMP WHERE taiwan_stock_shareholder_distribution.levels_json IS NOT excluded.levels_json OR taiwan_stock_shareholder_distribution.adjustment_json IS NOT excluded.adjustment_json OR taiwan_stock_shareholder_distribution.total_json IS NOT excluded.total_json OR taiwan_stock_shareholder_distribution.provider IS NOT excluded.provider OR taiwan_stock_shareholder_distribution.frequency IS NOT excluded.frequency`).bind(
    row.symbol, row.dataDate, JSON.stringify(row.levels), JSON.stringify(row.adjustment), JSON.stringify(row.total), row.provenance.provider, row.provenance.frequency, row.provenance.fetchedAt,
  ));
  await runD1Batch(db, statements);
}

async function persistTdccDistributionRows(env: ChipEnv, rows: DistributionRow[]) {
  if (!env.DB) throw new Error("d1_unavailable");
  if (!rows.length) throw new Error("invalid_response");
  await upsertDistribution(env.DB, rows);
  const dates = [...new Set(rows.map((row) => row.dataDate))].sort();
  await saveState(env.DB, {
    symbol: TDCC_MARKET_STATE_SYMBOL,
    dataset: "shareholder-distribution",
    start: dates[0],
    end: dates.at(-1)!,
    sourceDate: dates.at(-1)!,
    reason: "available",
    success: true,
  });
  return { rows: rows.length, symbols: new Set(rows.map((row) => row.symbol)).size, dataDates: dates };
}

export async function ingestTdccDistributionSnapshot(input: {
  env: ChipEnv;
  payload: unknown;
  eligibleSymbols: ReadonlySet<string>;
  fetchedAt?: string;
}) {
  const rows = parseTdccSnapshot(input.payload, input.eligibleSymbols, input.fetchedAt);
  return persistTdccDistributionRows(input.env, rows);
}

async function fetchState(db: D1Database | undefined, symbol: string, dataset: ChipDataset) {
  if (!db) return null;
  return db.prepare("SELECT * FROM taiwan_stock_chip_fetch_state WHERE symbol = ? AND dataset = ?").bind(symbol, dataset).first<ChipFetchStateRow>();
}

async function saveState(db: D1Database | undefined, input: { symbol: string; dataset: ChipDataset; start: string | null; end: string | null; sourceDate?: string | null; reason: ChipReasonCode; success: boolean; retryAfter?: string | null }) {
  if (!db) return;
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO taiwan_stock_chip_fetch_state (symbol,dataset,coverage_start,coverage_end,source_date,status,reason_code,last_success_at,last_attempt_at,retry_after) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(symbol,dataset) DO UPDATE SET coverage_start=CASE WHEN excluded.status='available' THEN CASE WHEN taiwan_stock_chip_fetch_state.coverage_start IS NULL OR excluded.coverage_start < taiwan_stock_chip_fetch_state.coverage_start THEN excluded.coverage_start ELSE taiwan_stock_chip_fetch_state.coverage_start END ELSE taiwan_stock_chip_fetch_state.coverage_start END,coverage_end=CASE WHEN excluded.status='available' THEN CASE WHEN excluded.source_date IS NOT NULL AND taiwan_stock_chip_fetch_state.coverage_end > excluded.source_date THEN excluded.coverage_end WHEN taiwan_stock_chip_fetch_state.coverage_end IS NULL OR excluded.coverage_end > taiwan_stock_chip_fetch_state.coverage_end THEN excluded.coverage_end ELSE taiwan_stock_chip_fetch_state.coverage_end END ELSE taiwan_stock_chip_fetch_state.coverage_end END,source_date=COALESCE(excluded.source_date,taiwan_stock_chip_fetch_state.source_date),status=excluded.status,reason_code=excluded.reason_code,last_success_at=COALESCE(excluded.last_success_at,taiwan_stock_chip_fetch_state.last_success_at),last_attempt_at=excluded.last_attempt_at,retry_after=excluded.retry_after,updated_at=CURRENT_TIMESTAMP`).bind(
    input.symbol, input.dataset, input.start, input.end, input.sourceDate || null, input.success ? "available" : "unavailable", input.reason, input.success ? now : null, now, input.retryAfter || null,
  ).run();
}

export function stateCovers(state: ChipFetchStateRow | null | undefined, start: string, end: string, dataset: ChipDataset, now = Date.now()) {
  if (!state || state.status !== "available" || !state.coverage_start || !state.coverage_end) return false;
  if (dataset !== "shareholder-distribution") {
    if (state.coverage_start > start || !state.source_date) return false;
    const fullyCovered = state.coverage_end >= end && state.source_date >= end;
    const retryAfter = Date.parse(String(state.retry_after || ""));
    const sourcePending = state.reason_code === "partial_data" && state.coverage_end >= start && state.source_date < end && Number.isFinite(retryAfter) && retryAfter > now;
    if (!fullyCovered && !sourcePending) return false;
    if (sourcePending) return true;
  }
  const last = Date.parse(String(state.last_success_at || ""));
  const maxAge = dataset === "shareholder-distribution" ? 8 * 86400000 : (end < new Date().toISOString().slice(0, 10) ? 30 * 86400000 : 6 * 3600000);
  return Number.isFinite(last) && now - last < maxAge;
}

function adapterFor(dataset: typeof dailyDatasets[number], env: ChipEnv, fetchImpl: typeof fetch) {
  const common = { token: env.FINMIND_API_TOKEN, fetchImpl };
  if (dataset === "institutional-flow") return createFinMindAdapter({ ...common, dataset, finMindDataset: "TaiwanStockInstitutionalInvestorsBuySell", normalize: normalizeInstitutionalRows });
  if (dataset === "foreign-holding") return createFinMindAdapter({ ...common, dataset, finMindDataset: "TaiwanStockShareholding", normalize: normalizeForeignHoldingRows });
  if (dataset === "margin-short") return createFinMindAdapter({ ...common, dataset, finMindDataset: "TaiwanStockMarginPurchaseShortSale", normalize: normalizeMarginShortRows });
  return createFinMindAdapter({ ...common, dataset, finMindDataset: "TaiwanStockSecuritiesLending", normalize: normalizeSecuritiesLendingRows });
}

function reasonFrom(error: unknown): ChipReasonCode {
  const reason = error instanceof Error ? error.message : "provider_unavailable";
  return reason === "rate_limited" || reason === "invalid_response" ? reason : "provider_unavailable";
}

async function fetchOfficialLatest(dataset: typeof dailyDatasets[number], eligibility: TaiwanChipEligibility, end: string, fetchImpl: typeof fetch) {
  if (dataset === "securities-lending") return [];
  const requestJson = async (url: string) => {
    const response = await fetchWithTimeout(fetchImpl, url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("provider_unavailable");
    return response.json();
  };
  const requestArray = async (url: string) => {
    const payload = await requestJson(url);
    if (!Array.isArray(payload)) throw new Error("invalid_response");
    return payload;
  };
  if (eligibility.exchange === "TPEx") {
    if (dataset === "institutional-flow") return normalizeTpexInstitutionalLatest(await requestArray("https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading"), eligibility.symbol);
    if (dataset === "foreign-holding") return normalizeTpexForeignHoldingLatest(await requestArray("https://www.tpex.org.tw/openapi/v1/tpex_3insti_qfii"), eligibility.symbol);
    if (dataset === "margin-short") return normalizeTpexMarginLatest(await requestArray("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance"), eligibility.symbol);
  }
  if (eligibility.exchange === "TWSE" && dataset === "institutional-flow") return normalizeTwseInstitutionalLatest(await requestJson(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${end.replaceAll("-", "")}&selectType=ALL&response=json`), eligibility.symbol);
  if (eligibility.exchange === "TWSE" && dataset === "margin-short") {
    return normalizeTwseMarginReport(await requestJson(`https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${end.replaceAll("-", "")}&selectType=ALL&response=json`), eligibility.symbol);
  }
  return [];
}

function requestedDatasets(url: URL) {
  const requested = (url.searchParams.get("datasets") || allDatasets.join(",")).split(",").map((item) => item.trim()).filter(Boolean);
  return [...new Set(requested)].filter((item): item is ChipDataset => allDatasets.includes(item as ChipDataset));
}

function validDateRange(start: string, end: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return false;
  const from = new Date(`${start}T00:00:00Z`); const to = new Date(`${end}T00:00:00Z`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return false;
  let businessDays = 0;
  for (let time = from.getTime(); time <= to.getTime(); time += 86400000) { const day = new Date(time).getUTCDay(); if (day !== 0 && day !== 6) businessDays += 1; if (businessDays > 2600) return false; }
  return true;
}

export function sanitizeChipDailyRows(rows: ChipDailyRow[], requestedEnd: string) {
  const visible = (row: ChipDailyRow, dataset: ChipDataset) => {
    const provenance = row.provenance[dataset as keyof typeof row.provenance];
    if (row.sessionDate > requestedEnd || !provenance || provenance.sourceDate !== row.sessionDate) return false;
    return !(dataset === "margin-short" && provenance.provider === "twse" && provenance.sourceDateVerified !== true);
  };
  return rows.map((row) => {
    const provenance = Object.fromEntries(Object.entries(row.provenance).filter(([dataset]) => visible(row, dataset as ChipDataset)));
    return {
      ...row,
      institutionalFlow: visible(row, "institutional-flow") ? row.institutionalFlow : null,
      foreignHolding: visible(row, "foreign-holding") ? row.foreignHolding : null,
      marginShort: visible(row, "margin-short") ? row.marginShort : null,
      securitiesLending: visible(row, "securities-lending") ? row.securitiesLending : null,
      provenance,
    };
  }).filter((row) => row.institutionalFlow || row.foreignHolding || row.marginShort || row.securitiesLending || Object.keys(row.provenance).length);
}

export async function taiwanStockChipPayload(input: { url: URL; env: ChipEnv; eligibility: TaiwanChipEligibility; fetchImpl?: typeof fetch; now?: Date | string }) {
  const { url, env, eligibility } = input;
  const symbol = eligibility.symbol;
  const interval = url.searchParams.get("interval") || "1d";
  const requestedEnd = url.searchParams.get("end") || new Date().toISOString().slice(0, 10);
  const start = url.searchParams.get("start") || new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const datasets = requestedDatasets(url);
  const end = requestedEnd;
  const datasetEligibility = buildDatasetEligibility({ eligible: eligibility.eligible, exchange: eligibility.exchange, interval });
  const [backfill, dispatch] = await Promise.all([
    readTdccContinuousSymbolStatus(env.DB, symbol),
    eligibility.eligible ? readTdccWorkflowDispatch(env.DB, symbol) : Promise.resolve(null),
  ]);
  if (!datasets.length) return { status: 400, body: { error: "沒有有效的 datasets。" } };
  if (!validDateRange(start, requestedEnd)) return { status: 400, body: { error: "日期格式、順序或範圍不正確；最多 2,600 個交易日。" } };
  if (interval !== "1d") return { status: 200, body: { symbol, exchange: eligibility.exchange, interval, eligible: eligibility.eligible, datasetEligibility, availability: Object.fromEntries(datasets.map((dataset) => [dataset, { status: "unavailable", reason: "unsupported_interval", rowCount: 0 }])), rows: [], distributionRows: [], coverage: [], sources: [], cache: { mode: "not_requested" }, warnings: ["籌碼副圖目前只支援日 K。"] } };
  if (!eligibility.eligible) return { status: 200, body: { symbol, exchange: eligibility.exchange, interval, eligible: false, datasetEligibility, availability: Object.fromEntries(datasets.map((dataset) => [dataset, { status: "unavailable", reason: "not_eligible", rowCount: 0 }])), rows: [], distributionRows: [], coverage: [], sources: [], cache: { mode: "not_requested" }, warnings: ["此商品不是支援的台股普通股或 ETF。"] } };

  const fetchImpl = input.fetchImpl || fetch;
  const availability: Partial<Record<ChipDataset, Availability>> = {};
  const warnings: string[] = [];
  const states = await Promise.all(datasets.map((dataset) => fetchState(env.DB, dataset === "shareholder-distribution" ? TDCC_MARKET_STATE_SYMBOL : symbol, dataset)));
  const cachedDailyBefore = sanitizeChipDailyRows(await readDaily(env.DB, symbol, start, end), end);
  let distribution = await readDistribution(env.DB, symbol, start, end);
  const freshDailySets: ChipDailyRow[][] = [];
  let fetchedAny = false;

  await Promise.all(datasets.map(async (dataset, index) => {
    const datasetEnd = end;
    const stateSymbol = dataset === "shareholder-distribution" ? TDCC_MARKET_STATE_SYMBOL : symbol;
    const cachedStateCovers = stateCovers(states[index], start, datasetEnd, dataset);
    const distributionOutsideRequestedRange = dataset === "shareholder-distribution" && states[index]?.source_date && (states[index].source_date < start || states[index].source_date > datasetEnd);
    const cachedDatasetDates = dataset === "shareholder-distribution" ? distribution.map((row) => row.dataDate) : cachedDailyBefore.filter((row) => Boolean(row.provenance[dataset as keyof typeof row.provenance])).map((row) => row.sessionDate);
    const sourcePending = dataset !== "shareholder-distribution" && states[index]?.reason_code === "partial_data" && states[index]?.source_date && states[index]!.source_date! < datasetEnd;
    const cachedDatasetCovers = dataset === "shareholder-distribution"
      ? distribution.length > 0 || Boolean(distributionOutsideRequestedRange)
      : Boolean(sourcePending || (cachedDatasetDates.at(-1) && cachedDatasetDates.at(-1)! >= datasetEnd));
    if (cachedStateCovers && cachedDatasetCovers) {
      const count = cachedDatasetDates.length;
      availability[dataset] = dataset === "shareholder-distribution"
        ? { status: count > 1 ? "available" : count ? "partial" : "unavailable", reason: count > 1 ? "available" : "history_not_archived", rowCount: count }
        : sourcePending
          ? { status: count ? "partial" : "unavailable", reason: "partial_data", rowCount: count }
          : { status: count ? "available" : "unavailable", reason: count ? "available" : "not_published", rowCount: count };
      if (sourcePending) warnings.push(incompleteDailyWarning(dataset, states[index]!.source_date!, datasetEnd));
      return;
    }
    const retryAfter = Date.parse(String(states[index]?.retry_after || ""));
    if (Number.isFinite(retryAfter) && retryAfter > Date.now()) {
      const count = dataset === "shareholder-distribution" ? distribution.length : cachedDailyBefore.filter((row) => Boolean(row.provenance[dataset as keyof typeof row.provenance])).length;
      availability[dataset] = { status: count ? "partial" : "unavailable", reason: count ? "stale_cache" : (states[index]?.reason_code || "provider_unavailable"), rowCount: count };
      warnings.push(`${datasetName(dataset)}：資料來源暫停重試，預計 ${retryTimeLabel(retryAfter)} 後再檢查`);
      return;
    }
    try {
      if (dataset === "shareholder-distribution") {
        const snapshot = await singleFlight("tdcc:market-snapshot", async () => {
          const response = await fetchWithTimeout(fetchImpl, "https://openapi.tdcc.com.tw/v1/opendata/1-5", { headers: { accept: "application/json" } });
          if (response.status === 429) throw new Error("rate_limited");
          if (!response.ok) throw new Error("provider_unavailable");
          return parseTdccSnapshot(await response.json(), eligibility.eligibleSymbols);
        });
        if (env.DB && snapshot.length) await persistTdccDistributionRows(env, snapshot);
        distribution = snapshot.filter((row) => row.symbol === symbol && row.dataDate >= start && row.dataDate <= datasetEnd);
        availability[dataset] = {
          status: distribution.length > 1 ? "available" : distribution.length ? "partial" : "unavailable",
          reason: distribution.length > 1 ? "available" : "history_not_archived",
          rowCount: distribution.length,
        };
        if (distribution.length < 2) warnings.push(backfill.status === "queued"
          ? "股權分散：等待背景回補"
          : backfill.status === "running"
            ? `股權分散：背景回補中（${backfill.completedWeeks}/${backfill.expectedWeeks} 週）`
            : backfill.status === "blocked"
              ? "股權分散：資料來源目前受阻，暫時無法繼續回補"
              : "股權分散：目前僅有一期集保週資料，尚無前週比較");
      } else {
        const primaryRows = await singleFlight(`${symbol}|${dataset}|${start}|${datasetEnd}`, () => adapterFor(dataset, env, fetchImpl).fetch({ symbol, start, end: datasetEnd }));
        const primaryEnd = primaryRows.at(-1)?.sessionDate || null;
        let officialRows: ChipDailyRow[] = [];
        if (primaryEnd && primaryEnd < datasetEnd) {
          try {
            officialRows = await fetchOfficialLatest(dataset, eligibility, datasetEnd, fetchImpl);
          } catch {
            // 官方補尾失敗不應丟棄主要來源已驗證日期的歷史 rows。
          }
        }
        const rows = sanitizeChipDailyRows(mergeChipRows(primaryRows, officialRows), datasetEnd);
        if (rows.length) {
          const actualStart = rows[0].sessionDate;
          const actualEnd = rows.at(-1)!.sessionDate;
          const complete = actualEnd >= datasetEnd;
          const reason = complete ? "available" : "partial_data";
          const retryAfter = complete ? null : new Date(Date.now() + 30 * 60000).toISOString();
          freshDailySets.push(rows);
          await upsertDaily(env.DB, eligibility.exchange, rows);
          await saveState(env.DB, { symbol: stateSymbol, dataset, start: actualStart, end: actualEnd, sourceDate: actualEnd, reason, success: true, retryAfter });
          availability[dataset] = { status: complete ? "available" : "partial", reason, rowCount: rows.length };
          if (officialRows.length) warnings.push(`${datasetName(dataset)}：主要歷史來源尚未更新，已改用官方最新資料`);
          else if (!complete) warnings.push(incompleteDailyWarning(dataset, actualEnd, datasetEnd));
        } else {
          const officialRows = sanitizeChipDailyRows(await fetchOfficialLatest(dataset, eligibility, datasetEnd, fetchImpl), datasetEnd);
          if (officialRows.length) {
            const actualEnd = officialRows.at(-1)!.sessionDate;
            const complete = actualEnd >= datasetEnd;
            const reason = complete ? "available" : "partial_data";
            freshDailySets.push(officialRows);
            await upsertDaily(env.DB, eligibility.exchange, officialRows);
            await saveState(env.DB, { symbol: stateSymbol, dataset, start: officialRows[0].sessionDate, end: actualEnd, sourceDate: actualEnd, reason, success: true, retryAfter: complete ? null : new Date(Date.now() + 30 * 60000).toISOString() });
            availability[dataset] = { status: complete ? "available" : "partial", reason, rowCount: officialRows.length };
            warnings.push(`${datasetName(dataset)}：主要歷史來源沒有目標範圍紀錄，已改用官方最新資料`);
            fetchedAny = true;
            return;
          }
          const retryAfter = new Date(Date.now() + 6 * 3600000).toISOString();
          await saveState(env.DB, { symbol: stateSymbol, dataset, start: null, end: null, reason: "not_published", success: false, retryAfter });
          availability[dataset] = { status: "unavailable", reason: "not_published", rowCount: 0 };
        }
      }
      fetchedAny = true;
    } catch (error) {
      if (dataset !== "shareholder-distribution") {
        try {
          const officialRows = sanitizeChipDailyRows(await fetchOfficialLatest(dataset, eligibility, datasetEnd, fetchImpl), datasetEnd);
          if (officialRows.length) {
            const actualEnd = officialRows.at(-1)!.sessionDate;
            const complete = actualEnd >= datasetEnd;
            const reason = complete ? "available" : "partial_data";
            freshDailySets.push(officialRows);
            await upsertDaily(env.DB, eligibility.exchange, officialRows);
            await saveState(env.DB, { symbol: stateSymbol, dataset, start: officialRows[0].sessionDate, end: actualEnd, sourceDate: actualEnd, reason, success: true, retryAfter: complete ? null : new Date(Date.now() + 30 * 60000).toISOString() });
            availability[dataset] = { status: complete ? "available" : "partial", reason, rowCount: officialRows.length };
            warnings.push(`${datasetName(dataset)}：主要歷史來源暫時不可用，已改用官方最新資料`);
            fetchedAny = true;
            return;
          }
        } catch {}
      }
      const reason = reasonFrom(error);
      const retryAfter = new Date(Date.now() + (reason === "rate_limited" ? 15 : 5) * 60000).toISOString();
      await saveState(env.DB, { symbol: stateSymbol, dataset, start: null, end: null, reason, success: false, retryAfter });
      const count = dataset === "shareholder-distribution" ? distribution.length : cachedDailyBefore.filter((row) => Boolean(row.provenance[dataset as keyof typeof row.provenance])).length;
      availability[dataset] = { status: count ? "partial" : "unavailable", reason: count ? "stale_cache" : reason, rowCount: count };
      warnings.push(`${datasetName(dataset)}：${count ? "目前顯示最近一次成功取得的資料" : "資料來源暫時無法使用"}`);
    }
  }));

  const rows = sanitizeChipDailyRows(await readDaily(env.DB, symbol, start, end), end);
  const directRows = env.DB ? rows : sanitizeChipDailyRows(mergeChipRows(...freshDailySets), end);
  if (!env.DB && !directRows.length && datasets.some((dataset) => dailyDatasets.includes(dataset as typeof dailyDatasets[number]))) warnings.push("網站資料庫未啟用，無法保存籌碼資料快取。");
  if (env.DB) distribution = await readDistribution(env.DB, symbol, start, end);
  const distributionRows = decorateDistributionRows(distribution);
  const resultRows = decorateEstimatedMarginRows(env.DB ? rows : directRows, await readDailyCloses(env.DB, symbol, start, end));
  for (const row of resultRows) {
    const value = row.marginShort;
    if (!value) continue;
    const checks = [
      ["融資", value.marginTodayBalanceLots, value.marginLimitLots, value.marginUtilizationPercent],
      ["融券", value.shortTodayBalanceLots, value.shortLimitLots, value.shortUtilizationPercent],
    ] as const;
    for (const [label, balance, limit, published] of checks) {
      if (![balance, limit, published].every((item) => typeof item === "number" && Number.isFinite(item)) || (limit as number) <= 0) continue;
      const calculated = (balance as number) / (limit as number) * 100;
      if (Math.abs(calculated - (published as number)) > 0.05) warnings.push(`融資融券：${label}使用率與餘額／限額交叉驗證不一致`);
    }
  }
  const coverage = datasets.map((dataset) => {
    const dates = dataset === "shareholder-distribution"
      ? distributionRows.map((row) => row.dataDate)
      : resultRows.filter((row) => Boolean(row.provenance[dataset as keyof typeof row.provenance])).map((row) => row.sessionDate);
    return {
      dataset,
      start: dates[0] || null,
      end: dates.at(-1) || null,
      requestedStart: start,
      requestedEnd,
      frequency: dataset === "shareholder-distribution" ? "weekly" : "daily",
      status: availability[dataset]?.reason || "provider_unavailable",
      ...(dataset === "shareholder-distribution" ? {
        frequencyLabel: "週資料／當週最後營業日",
        savedWeeks: Math.max(backfill.completedWeeks || 0, new Set(dates).size),
        expectedWeeks: backfill.expectedWeeks,
        backfillStatus: backfill.status,
        ...(env.DB ? {
          missingWeeks: backfill.missingDates?.length || 0,
          missingDates: backfill.missingDates || [],
          latestSnapshotDate: backfill.latestSnapshotDate || null,
          checkpoint: backfill.checkpoint || null,
          lastErrorCode: backfill.lastErrorCode || null,
        } : {}),
        lastSuccessAt: backfill.lastSuccessAt || null,
      } : {}),
    };
  });
  const sources = datasets.map((dataset) => {
    const providers = dataset === "shareholder-distribution"
      ? ["tdcc"]
      : [...new Set(resultRows.map((row) => row.provenance[dataset as keyof typeof row.provenance]?.provider).filter(Boolean))];
    return { dataset, providers: providers.length ? providers : ["finmind"], frequency: dataset === "shareholder-distribution" ? "weekly" : "daily" };
  });
  const availabilityValues = Object.values(availability);
  if (availabilityValues.some((item) => item?.status === "available") && availabilityValues.some((item) => item?.status !== "available")) warnings.push("部分資料：上列資料尚未齊全或當日沒有新增紀錄，其他籌碼資料仍正常顯示；網站會在背景更新或再次開啟圖表時重新檢查");
  return {
    status: 200,
    body: {
      symbol,
      exchange: eligibility.exchange,
      interval,
      eligible: true,
      datasetEligibility,
      availability,
      rows: resultRows,
      distributionRows,
      coverage,
      sources,
      backfill,
      dispatch,
      cache: { mode: fetchedAny ? "d1_refreshed" : "d1_hit", d1: Boolean(env.DB), schemaVersion: "taiwan-chip-v4", formulaVersion: ESTIMATED_MARGIN_FORMULA_VERSION },
      warnings: [...new Set(warnings)],
    },
  };
}

export async function handleTaiwanStockChipRequest(request: Request, env: ChipEnv, eligibility: TaiwanChipEligibility) {
  const result = await taiwanStockChipPayload({ url: new URL(request.url), env, eligibility });
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
