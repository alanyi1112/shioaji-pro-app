import { runD1Batch } from "./d1-batch.ts";

export const PE_RIVER_PERCENTILES = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95] as const;
export const PE_RIVER_MINIMUM_SAMPLES = 252;
export const PE_RIVER_LOOKBACK_YEARS = 5;

export type PeRiverExchange = "TWSE" | "TPEx";
export type PeRiverReasonCode =
  | "available"
  | "partial_data"
  | "insufficient_history"
  | "not_eligible"
  | "unsupported_interval"
  | "history_source_unverified"
  | "running"
  | "retry_waiting"
  | "blocked"
  | "schema_mismatch"
  | "source_mismatch"
  | "official_not_published"
  | "official_gap"
  | "provisional_capped"
  | "rate_limit_waiting"
  | "provider_unavailable"
  | "license_review_required"
  | "invalid_payload";

export type PeRiverValuationRow = {
  exchange: PeRiverExchange;
  symbol: string;
  sessionDate: string;
  officialClose: number;
  officialPeRatio: number;
  referenceEps: number;
  fiscalYear: string | null;
  fiscalQuarter: string | null;
  source: "twse" | "tpex" | "finmind";
  provider?: "twse" | "tpex" | "finmind" | "official";
  originalSource?: string;
  validationStatus?: "official_verified" | "official_gap" | "finmind_overlap_verified" | "finmind_provisional_latest" | "finmind_pending_verification" | "source_mismatch";
  officialOverlapDate?: string | null;
  provisionalCreatedAt?: string | null;
  sourceDate: string;
  fetchedAt: string;
};

type UnknownRecord = Record<string, unknown>;
type OfficialTable = { fields?: unknown; data?: unknown };

const finitePositive = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || ["-", "--", "N/A", "NaN"].includes(text)) return null;
  const number = Number(text.replaceAll(",", "").replaceAll("%", ""));
  return Number.isFinite(number) && number > 0 ? number : null;
};

export function canonicalPeRiverSymbol(value: unknown): { symbol: string; exchange: PeRiverExchange; stockCode: string } | null {
  const symbol = String(value ?? "").trim().toUpperCase();
  const match = symbol.match(/^([0-9A-Z]{4,8})\.(TW|TWO)$/);
  if (!match) return null;
  return { symbol, stockCode: match[1], exchange: match[2] === "TW" ? "TWSE" : "TPEx" };
}

export function peRiverEligibility(input: { symbol: unknown; interval?: unknown; quoteType?: unknown; groupName?: unknown; market?: unknown }) {
  const canonical = canonicalPeRiverSymbol(input.symbol);
  if (!canonical) return { supported: false, reason: "not_eligible" as const, canonical: null };
  if (String(input.interval || "1d") !== "1d") return { supported: false, reason: "unsupported_interval" as const, canonical };
  const metadata = `${String(input.quoteType || "")} ${String(input.groupName || "")} ${String(input.market || "")}`.toLowerCase();
  const excluded = /(etf|etn|exchange traded|指數|指標|存託|tdr|特別股|preferred|受益|權證|warrant|債券|bond|基金|fund)/.test(metadata)
    || /^(00\d{2,4}|01\d{2,4})\.(TW|TWO)$/.test(canonical.symbol);
  if (excluded) return { supported: false, reason: "not_eligible" as const, canonical };
  return { supported: true, reason: "supported" as const, canonical };
}

export function normalizeOfficialDate(value: unknown): string | null {
  const text = String(value ?? "").trim().replaceAll(".", "/").replaceAll("-", "/");
  const compact = text.replaceAll("/", "");
  if (/^\d{7}$/.test(compact)) {
    const year = Number(compact.slice(0, 3)) + 1911;
    return `${year}-${compact.slice(3, 5)}-${compact.slice(5, 7)}`;
  }
  if (/^\d{8}$/.test(compact)) return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const match = text.match(/^(\d{2,4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  const rawYear = Number(match[1]);
  const year = rawYear < 1911 ? rawYear + 1911 : rawYear;
  const date = `${year}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? date : null;
}

function tablesFromPayload(payload: unknown): OfficialTable[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as UnknownRecord;
  return [record, ...(Array.isArray(record.tables) ? record.tables : [])].filter((table): table is OfficialTable => Boolean(table && typeof table === "object"));
}

function rowsByFields(payload: unknown, requiredField: string) {
  for (const table of tablesFromPayload(payload)) {
    const fields = Array.isArray(table.fields) ? table.fields.map((value) => String(value).trim()) : [];
    const data = Array.isArray(table.data) ? table.data : [];
    if (!fields.includes(requiredField) || !data.length) continue;
    return data.flatMap((values) => {
      if (!Array.isArray(values) || values.length !== fields.length) return [];
      return [Object.fromEntries(fields.map((field, index) => [field, values[index]])) as UnknownRecord];
    });
  }
  return [];
}

function fiscalParts(value: unknown) {
  const text = String(value ?? "").trim();
  const match = text.match(/(\d{2,4})\s*[年/\-]?\s*[第]?\s*([1-4])\s*[季Q]?/i);
  if (!match) return { fiscalYear: text || null, fiscalQuarter: null };
  const rawYear = Number(match[1]);
  return { fiscalYear: String(rawYear < 1911 ? rawYear + 1911 : rawYear), fiscalQuarter: match[2] };
}

export type OfficialPeRecord = { exchange: PeRiverExchange; stockCode: string; sessionDate: string; officialPeRatio: number | null; fiscalYear: string | null; fiscalQuarter: string | null; source: "twse" | "tpex" };
export type OfficialCloseRecord = { exchange: PeRiverExchange; stockCode: string; sessionDate: string; officialClose: number | null; source: "twse" | "tpex" };

export function parseTwseHistoricalPe(payload: unknown, symbol: string): OfficialPeRecord[] {
  const canonical = canonicalPeRiverSymbol(symbol);
  if (!canonical || canonical.exchange !== "TWSE") return [];
  return rowsByFields(payload, "本益比").flatMap((row) => {
    const sessionDate = normalizeOfficialDate(row["日期"]);
    if (!sessionDate) return [];
    const fiscal = fiscalParts(row["財報年/季"] ?? row["財報年／季"]);
    return [{ exchange: "TWSE", stockCode: canonical.stockCode, sessionDate, officialPeRatio: finitePositive(row["本益比"]), ...fiscal, source: "twse" as const }];
  });
}

export function parseTwseHistoricalClose(payload: unknown, symbol: string): OfficialCloseRecord[] {
  const canonical = canonicalPeRiverSymbol(symbol);
  if (!canonical || canonical.exchange !== "TWSE") return [];
  return rowsByFields(payload, "收盤價").flatMap((row) => {
    const sessionDate = normalizeOfficialDate(row["日期"]);
    return sessionDate ? [{ exchange: "TWSE", stockCode: canonical.stockCode, sessionDate, officialClose: finitePositive(row["收盤價"]), source: "twse" as const }] : [];
  });
}

export function parseTpexHistoricalPe(payload: unknown, symbol: string): OfficialPeRecord[] {
  const canonical = canonicalPeRiverSymbol(symbol);
  if (!canonical || canonical.exchange !== "TPEx") return [];
  return rowsByFields(payload, "本益比").flatMap((row) => {
    const sessionDate = normalizeOfficialDate(row["日期"]);
    if (!sessionDate) return [];
    const fiscal = fiscalParts(row["財報年/季"] ?? row["財報年／季"]);
    return [{ exchange: "TPEx", stockCode: canonical.stockCode, sessionDate, officialPeRatio: finitePositive(row["本益比"]), ...fiscal, source: "tpex" as const }];
  });
}

export function parseTpexHistoricalClose(payload: unknown, symbol: string): OfficialCloseRecord[] {
  const canonical = canonicalPeRiverSymbol(symbol);
  if (!canonical || canonical.exchange !== "TPEx") return [];
  return rowsByFields(payload, "收盤").flatMap((row) => {
    const sessionDate = normalizeOfficialDate(row["日期"] ?? row["資料日期"]);
    const stockCode = String(row["代號"] ?? row["證券代號"] ?? canonical.stockCode).trim();
    return sessionDate && stockCode === canonical.stockCode
      ? [{ exchange: "TPEx", stockCode, sessionDate, officialClose: finitePositive(row["收盤"]), source: "tpex" as const }]
      : [];
  });
}

export function pairOfficialValuationRows(input: { symbol: string; peRows: OfficialPeRecord[]; closeRows: OfficialCloseRecord[]; fetchedAt?: string }): PeRiverValuationRow[] {
  const canonical = canonicalPeRiverSymbol(input.symbol);
  if (!canonical) return [];
  const closes = new Map(input.closeRows.filter((row) => row.exchange === canonical.exchange && row.stockCode === canonical.stockCode).map((row) => [row.sessionDate, row]));
  const fetchedAt = input.fetchedAt || new Date().toISOString();
  return input.peRows.flatMap((pe) => {
    const close = closes.get(pe.sessionDate);
    if (pe.exchange !== canonical.exchange || pe.stockCode !== canonical.stockCode || !close || pe.officialPeRatio === null || close.officialClose === null) return [];
    const referenceEps = close.officialClose / pe.officialPeRatio;
    if (!Number.isFinite(referenceEps) || referenceEps <= 0) return [];
    return [{ exchange: canonical.exchange, symbol: canonical.symbol, sessionDate: pe.sessionDate, officialClose: close.officialClose, officialPeRatio: pe.officialPeRatio, referenceEps, fiscalYear: pe.fiscalYear, fiscalQuarter: pe.fiscalQuarter, source: pe.source, sourceDate: pe.sessionDate, fetchedAt }];
  }).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
}

export function interpolatedPercentile(values: number[], percentile: number): number | null {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length || percentile < 0 || percentile > 1) return null;
  const rank = (sorted.length - 1) * percentile;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

function fiveYearsBefore(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCFullYear(parsed.getUTCFullYear() - PE_RIVER_LOOKBACK_YEARS);
  return parsed.toISOString().slice(0, 10);
}

export function buildPeRiver(rows: PeRiverValuationRow[]) {
  const verified = rows.filter((row) => row.officialPeRatio > 0 && row.referenceEps > 0 && ["official_verified", "finmind_overlap_verified"].includes(String(row.validationStatus || "official_verified"))).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
  const verifiedEnd = verified.at(-1)?.sessionDate ?? null;
  const windowStart = verifiedEnd ? fiveYearsBefore(verifiedEnd) : null;
  const sample = windowStart ? verified.filter((row) => row.sessionDate >= windowStart) : [];
  const multipliers = Object.fromEntries(PE_RIVER_PERCENTILES.map((percentile) => [`p${Math.round(percentile * 100)}`, interpolatedPercentile(sample.map((row) => row.officialPeRatio), percentile)]));
  const enough = sample.length >= PE_RIVER_MINIMUM_SAMPLES;
  const provisional = verifiedEnd ? rows.filter((row) => row.validationStatus === "finmind_provisional_latest" && row.sessionDate > verifiedEnd && row.officialPeRatio > 0 && row.referenceEps > 0).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate)).slice(0, 3) : [];
  const displayRows = enough ? [...sample, ...provisional] : [];
  const points = displayRows.map((row) => ({
    sessionDate: row.sessionDate,
    officialClose: row.officialClose,
    officialPeRatio: row.officialPeRatio,
    referenceEps: row.referenceEps,
    fiscalYear: row.fiscalYear,
    fiscalQuarter: row.fiscalQuarter,
    source: row.source,
    provider: row.provider || row.source,
    originalSource: row.originalSource || (row.exchange === "TWSE" ? "臺灣證券交易所" : "證券櫃檯買賣中心"),
    validationStatus: row.validationStatus || "official_verified",
    officialOverlapDate: row.officialOverlapDate || null,
    provisionalCreatedAt: row.provisionalCreatedAt || null,
    sourceDate: row.sourceDate,
    prices: Object.fromEntries(Object.entries(multipliers).map(([key, value]) => [key, row.referenceEps * Number(value)])),
  }));
  const displayEnd = provisional.at(-1)?.sessionDate || verifiedEnd;
  return {
    status: enough ? "available" as const : "insufficient_history" as const,
    coverage: { start: sample[0]?.sessionDate ?? null, end: verifiedEnd, actualStart: verified[0]?.sessionDate ?? null, actualEnd: verifiedEnd, verifiedEnd, displayEnd, provisionalDates: provisional.map((row) => row.sessionDate), validSamples: sample.length, lookbackYears: PE_RIVER_LOOKBACK_YEARS, minimumSamples: PE_RIVER_MINIMUM_SAMPLES },
    multipliers: enough ? multipliers : null,
    points,
    provisional: { status: provisional.length ? "pending" as const : "none" as const, dates: provisional.map((row) => row.sessionDate), provider: provisional.length ? "finmind" as const : null, verifiedEnd, displayEnd },
  };
}

type CatalogMetadata = { quote_type?: string | null; group_name?: string | null; market?: string | null };
type ValuationDbRow = { exchange: string; symbol: string; session_date: string; official_close: number; official_pe_ratio: number; reference_eps: number; fiscal_year?: string | null; fiscal_quarter?: string | null; source: string; provider?: string | null; original_source?: string | null; validation_status?: string | null; official_overlap_date?: string | null; provisional_created_at?: string | null; source_date: string; fetched_at: string };

function dbRow(row: ValuationDbRow): PeRiverValuationRow {
  const source = row.source as "twse" | "tpex" | "finmind";
  return { exchange: row.exchange as PeRiverExchange, symbol: row.symbol, sessionDate: row.session_date, officialClose: Number(row.official_close), officialPeRatio: Number(row.official_pe_ratio), referenceEps: Number(row.reference_eps), fiscalYear: row.fiscal_year || null, fiscalQuarter: row.fiscal_quarter || null, source, provider: (row.provider || source) as PeRiverValuationRow["provider"], originalSource: row.original_source || (row.exchange === "TWSE" ? "臺灣證券交易所" : "證券櫃檯買賣中心"), validationStatus: (row.validation_status || (source === "finmind" ? "finmind_pending_verification" : "official_verified")) as PeRiverValuationRow["validationStatus"], officialOverlapDate: row.official_overlap_date || null, provisionalCreatedAt: row.provisional_created_at || null, sourceDate: row.source_date, fetchedAt: row.fetched_at };
}

export async function readPeRiverRows(db: D1Database, symbol: string) {
  const result = await db.prepare("SELECT * FROM taiwan_stock_pe_valuation_daily WHERE symbol = ? ORDER BY session_date").bind(symbol).all<ValuationDbRow>();
  return result.results.map(dbRow);
}

export function peRiverUpsertStatement(db: D1Database, row: PeRiverValuationRow) {
  const provider = row.provider || row.source;
  const originalSource = row.originalSource || (row.exchange === "TWSE" ? "臺灣證券交易所" : "證券櫃檯買賣中心");
  const validationStatus = row.validationStatus || (row.source === "finmind" ? "finmind_pending_verification" : "official_verified");
  return db.prepare(`INSERT INTO taiwan_stock_pe_valuation_daily (exchange,symbol,session_date,official_close,official_pe_ratio,reference_eps,fiscal_year,fiscal_quarter,source,provider,original_source,validation_status,official_overlap_date,provisional_created_at,source_date,fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(exchange,symbol,session_date) DO UPDATE SET official_close=excluded.official_close,official_pe_ratio=excluded.official_pe_ratio,reference_eps=excluded.reference_eps,fiscal_year=COALESCE(excluded.fiscal_year,taiwan_stock_pe_valuation_daily.fiscal_year),fiscal_quarter=COALESCE(excluded.fiscal_quarter,taiwan_stock_pe_valuation_daily.fiscal_quarter),source=excluded.source,provider=excluded.provider,original_source=excluded.original_source,validation_status=excluded.validation_status,official_overlap_date=excluded.official_overlap_date,provisional_created_at=excluded.provisional_created_at,source_date=excluded.source_date,fetched_at=excluded.fetched_at,updated_at=CURRENT_TIMESTAMP WHERE (CASE excluded.validation_status WHEN 'official_gap' THEN 5 WHEN 'official_verified' THEN 4 WHEN 'finmind_overlap_verified' THEN 3 WHEN 'finmind_provisional_latest' THEN 2 WHEN 'finmind_pending_verification' THEN 1 ELSE 0 END) >= (CASE taiwan_stock_pe_valuation_daily.validation_status WHEN 'official_gap' THEN 5 WHEN 'official_verified' THEN 4 WHEN 'finmind_overlap_verified' THEN 3 WHEN 'finmind_provisional_latest' THEN 2 WHEN 'finmind_pending_verification' THEN 1 ELSE 0 END)`).bind(row.exchange, row.symbol, row.sessionDate, row.officialClose, row.officialPeRatio, row.referenceEps, row.fiscalYear, row.fiscalQuarter, row.source, provider, originalSource, validationStatus, row.officialOverlapDate || null, row.provisionalCreatedAt || null, row.sourceDate, row.fetchedAt);
}

export async function upsertPeRiverRows(db: D1Database, rows: PeRiverValuationRow[]) {
  const statements = rows.map((row) => peRiverUpsertStatement(db, row));
  await runD1Batch(db, statements);
}

export function peRiverCoverageState(rows: PeRiverValuationRow[]) {
  const verified = rows.filter((row) => ["official_verified", "finmind_overlap_verified"].includes(String(row.validationStatus || "official_verified")) && row.officialPeRatio > 0 && row.referenceEps > 0).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
  const provisional = rows.filter((row) => row.validationStatus === "finmind_provisional_latest" && row.officialPeRatio > 0 && row.referenceEps > 0).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate)).slice(0, 3);
  const verifiedEnd = verified.at(-1)?.sessionDate || null;
  const visibleProvisional = verifiedEnd ? provisional.filter((row) => row.sessionDate > verifiedEnd) : [];
  return {
    verified,
    provisional: visibleProvisional,
    coverageStart: verified[0]?.sessionDate || null,
    verifiedEnd,
    displayEnd: visibleProvisional.at(-1)?.sessionDate || verifiedEnd,
    validSamples: verified.length,
  };
}

export async function ingestProvisionalPeRiverRows(input: { db: D1Database; symbol: string; rows: PeRiverValuationRow[]; officialSourceDate: string; status: "pending" | "provisional_capped"; now?: Date }) {
  const canonical = canonicalPeRiverSymbol(input.symbol);
  if (!canonical || !normalizeOfficialDate(input.officialSourceDate) || !Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 3) throw new Error("invalid_payload");
  const nowText = (input.now || new Date()).toISOString();
  const state = await input.db.prepare(`SELECT provisional_quarantined FROM taiwan_stock_pe_fetch_state WHERE exchange=? AND symbol=?`).bind(canonical.exchange, canonical.symbol).first<{ provisional_quarantined?: number | null }>();
  if (state?.provisional_quarantined) throw new Error("source_mismatch");
  const existing = await readPeRiverRows(input.db, canonical.symbol);
  const existingByDate = new Map(existing.map((row) => [row.sessionDate, row]));
  const accepted = input.rows.filter((row) => row.exchange === canonical.exchange && row.symbol === canonical.symbol && row.validationStatus === "finmind_provisional_latest" && row.sessionDate > input.officialSourceDate && row.provider === "finmind" && row.officialPeRatio > 0 && row.officialClose > 0 && !["official_verified", "official_gap"].includes(String(existingByDate.get(row.sessionDate)?.validationStatus || ""))).map((row) => ({ ...row, provisionalCreatedAt: row.provisionalCreatedAt || nowText }));
  if (!accepted.length) return { accepted: 0, ...peRiverCoverageState(existing), provisionalStatus: null };
  const acceptedDates = new Set(accepted.map((row) => row.sessionDate));
  const combined = [...existing.filter((row) => !acceptedDates.has(row.sessionDate)), ...accepted].sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
  const coverage = peRiverCoverageState(combined);
  const fetchStatus = coverage.validSamples >= PE_RIVER_MINIMUM_SAMPLES ? "available" : "partial";
  const statements = [
    ...accepted.map((row) => peRiverUpsertStatement(input.db, row)),
    input.db.prepare(`INSERT INTO taiwan_stock_pe_fetch_state (exchange,symbol,coverage_start,coverage_end,source_date,verified_end,display_end,official_source_date,provisional_dates_json,provisional_status,lane,status,reason_code,last_success_at,last_attempt_at) VALUES (?,?,?,?,?,?,?,?,?,?, 'latest',?,?,?,?) ON CONFLICT(exchange,symbol) DO UPDATE SET coverage_start=excluded.coverage_start,coverage_end=excluded.coverage_end,source_date=excluded.source_date,verified_end=excluded.verified_end,display_end=excluded.display_end,official_source_date=excluded.official_source_date,provisional_dates_json=excluded.provisional_dates_json,provisional_status=excluded.provisional_status,lane='latest',status=excluded.status,reason_code=excluded.reason_code,last_success_at=excluded.last_success_at,last_attempt_at=excluded.last_attempt_at,updated_at=CURRENT_TIMESTAMP`).bind(canonical.exchange, canonical.symbol, coverage.coverageStart, coverage.verifiedEnd, coverage.verifiedEnd, coverage.verifiedEnd, coverage.displayEnd, input.officialSourceDate, JSON.stringify(coverage.provisional.map((row) => row.sessionDate)), input.status, fetchStatus, input.status === "provisional_capped" ? "provisional_capped" : "official_not_published", nowText, nowText),
  ];
  await input.db.batch(statements);
  return { accepted: accepted.length, ...coverage, provisionalStatus: input.status };
}

async function catalogMetadata(db: D1Database, symbol: string): Promise<CatalogMetadata> {
  return await db.prepare("SELECT quote_type, group_name, market FROM instrument_catalog WHERE symbol = ? AND active = 1 LIMIT 1").bind(symbol).first<CatalogMetadata>() || {};
}

function monthSequence(start: string, end: string) {
  const months: string[] = [];
  const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  const final = end.slice(0, 7);
  while (cursor.toISOString().slice(0, 7) <= final) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

export async function missingPeRiverMonths(db: D1Database, symbol: string, targetStart: string, targetEnd: string) {
  const expected = monthSequence(targetStart, targetEnd);
  const result = await db.prepare("SELECT target_month FROM taiwan_stock_pe_backfill_month WHERE symbol = ? AND target_month >= ? AND target_month <= ? AND status = 'complete'").bind(symbol, targetStart.slice(0, 7), targetEnd.slice(0, 7)).all<{ target_month: string }>();
  const complete = new Set(result.results.map((row) => row.target_month));
  return expected.filter((month) => !complete.has(month));
}

export function safePeRiverBackfillError(value: unknown): PeRiverReasonCode {
  const text = String(value instanceof Error ? value.message : value || "invalid_payload");
  if (/402|429|rate.?limit/i.test(text)) return "rate_limit_waiting";
  if (/official_not_published/i.test(text)) return "official_not_published";
  if (/source_mismatch/i.test(text)) return "source_mismatch";
  if (/5\d\d|timeout|network|fetch|provider_unavailable/i.test(text)) return "provider_unavailable";
  if (/schema/i.test(text)) return "schema_mismatch";
  if (/history_source_unverified/i.test(text)) return "history_source_unverified";
  return "invalid_payload";
}

export function peRiverRetryAfter(attempt: number, now = new Date()) {
  const minutes = Math.min(24 * 60, Math.max(1, 2 ** Math.max(0, attempt - 1)) * 5);
  return new Date(now.getTime() + minutes * 60000).toISOString();
}

export async function queuePeRiverBackfill(db: D1Database, input: { symbol: string; targetStart: string; targetEnd: string }) {
  const canonical = canonicalPeRiverSymbol(input.symbol);
  if (!canonical) throw new Error("invalid_payload");
  const missing = await missingPeRiverMonths(db, canonical.symbol, input.targetStart, input.targetEnd);
  const jobId = `pe-river:${canonical.symbol}`;
  const desiredStatus = missing.length ? "queued" : "complete";
  const desiredReason = missing.length ? "running" : "available";
  await db.prepare(`INSERT INTO taiwan_stock_pe_backfill_job (job_id,exchange,symbol,target_start,target_end,status,reason_code,total_months,completed_months) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(exchange,symbol) DO UPDATE SET target_start=excluded.target_start,target_end=excluded.target_end,status=CASE WHEN taiwan_stock_pe_backfill_job.status='running' THEN 'running' ELSE excluded.status END,reason_code=CASE WHEN taiwan_stock_pe_backfill_job.status='running' THEN taiwan_stock_pe_backfill_job.reason_code ELSE excluded.reason_code END,total_months=excluded.total_months,completed_months=CASE WHEN excluded.status='complete' THEN excluded.total_months ELSE taiwan_stock_pe_backfill_job.completed_months END,updated_at=CURRENT_TIMESTAMP`).bind(jobId, canonical.exchange, canonical.symbol, input.targetStart, input.targetEnd, desiredStatus, desiredReason, monthSequence(input.targetStart, input.targetEnd).length, missing.length ? 0 : monthSequence(input.targetStart, input.targetEnd).length).run();
  const statements = missing.map((month) => db.prepare(`INSERT INTO taiwan_stock_pe_backfill_month (job_id,exchange,symbol,target_month,status) VALUES (?,?,?,?,'queued') ON CONFLICT(exchange,symbol,target_month) DO UPDATE SET job_id=excluded.job_id,status=CASE WHEN taiwan_stock_pe_backfill_month.status='complete' THEN 'complete' ELSE 'queued' END,error_code=NULL,retry_after=NULL,updated_at=CURRENT_TIMESTAMP`).bind(jobId, canonical.exchange, canonical.symbol, month));
  await runD1Batch(db, statements);
  return { jobId, missingMonths: missing };
}

export async function claimPeRiverBackfillMonths(db: D1Database, input: { owner: string; limit?: number; leaseSeconds?: number; now?: Date }) {
  const now = input.now || new Date();
  const nowText = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + Math.max(60, input.leaseSeconds || 300) * 1000).toISOString();
  const limit = Math.max(1, Math.min(4, input.limit || 1));
  const candidates = await db.prepare(`SELECT exchange,symbol,target_month,attempts FROM taiwan_stock_pe_backfill_month WHERE status IN ('queued','retry_waiting') AND (retry_after IS NULL OR retry_after <= ?) AND (lease_expires_at IS NULL OR lease_expires_at <= ?) ORDER BY target_month LIMIT ?`).bind(nowText, nowText, limit).all<{ exchange: string; symbol: string; target_month: string; attempts: number }>();
  const claimed = [];
  for (const row of candidates.results) {
    const result = await db.prepare(`UPDATE taiwan_stock_pe_backfill_month SET status='running',attempts=attempts+1,lease_owner=?,lease_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE exchange=? AND symbol=? AND target_month=? AND status IN ('queued','retry_waiting') AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`).bind(input.owner, leaseExpiresAt, row.exchange, row.symbol, row.target_month, nowText).run();
    if (Number(result.meta?.changes || 0) > 0) claimed.push({ exchange: row.exchange as PeRiverExchange, symbol: row.symbol, targetMonth: row.target_month, attempts: Number(row.attempts || 0) + 1, leaseOwner: input.owner, leaseExpiresAt });
  }
  return claimed;
}

export async function failPeRiverBackfillMonth(db: D1Database, input: { exchange: PeRiverExchange; symbol: string; targetMonth: string; owner: string; error: unknown; attempt: number; now?: Date }) {
  const reasonCode = safePeRiverBackfillError(input.error);
  const retryable = ["retry_waiting", "rate_limit_waiting", "provider_unavailable", "official_not_published"].includes(reasonCode) && input.attempt < 5;
  const retryAfter = retryable ? peRiverRetryAfter(input.attempt, input.now) : null;
  await db.prepare(`UPDATE taiwan_stock_pe_backfill_month SET status=?,error_code=?,retry_after=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE exchange=? AND symbol=? AND target_month=? AND lease_owner=?`).bind(retryable ? "retry_waiting" : "blocked", reasonCode, retryAfter, input.exchange, input.symbol, input.targetMonth, input.owner).run();
  return { status: retryable ? "retry_waiting" as const : "blocked" as const, reasonCode, retryAfter };
}

export async function peRiverHealth(db?: D1Database) {
  if (!db) return { configured: false, target: 0, ready: 0, pending: 0, blocked: 0, retryWaiting: 0, latestCoverageEnd: null, latestDisplayEnd: null, provisionalPending: 0, provisionalCapped: 0, provisionalMismatch: 0 };
  const counts = await db.prepare(`SELECT COUNT(*) AS target, SUM(CASE WHEN status='available' THEN 1 ELSE 0 END) AS ready, SUM(CASE WHEN status IN ('queued','running','partial') THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END) AS blocked, SUM(CASE WHEN status='retry_waiting' THEN 1 ELSE 0 END) AS retry_waiting FROM taiwan_stock_pe_fetch_state`).first<Record<string, number | null>>();
  const latest = await db.prepare(`SELECT MAX(verified_end) AS verified_end,MAX(display_end) AS display_end,SUM(CASE WHEN provisional_status='pending' THEN 1 ELSE 0 END) AS provisional_pending,SUM(CASE WHEN provisional_status='provisional_capped' THEN 1 ELSE 0 END) AS provisional_capped,SUM(CASE WHEN provisional_quarantined=1 THEN 1 ELSE 0 END) AS provisional_mismatch FROM taiwan_stock_pe_fetch_state`).first<{ verified_end?: string | null; display_end?: string | null; provisional_pending?: number | null; provisional_capped?: number | null; provisional_mismatch?: number | null }>();
  return { configured: true, target: Number(counts?.target || 0), ready: Number(counts?.ready || 0), pending: Number(counts?.pending || 0), blocked: Number(counts?.blocked || 0), retryWaiting: Number(counts?.retry_waiting || 0), latestCoverageEnd: latest?.verified_end || null, latestDisplayEnd: latest?.display_end || null, provisionalPending: Number(latest?.provisional_pending || 0), provisionalCapped: Number(latest?.provisional_capped || 0), provisionalMismatch: Number(latest?.provisional_mismatch || 0) };
}

export async function buildPeRiverResponse(input: { db?: D1Database; symbol: string; interval?: string }) {
  const canonical = canonicalPeRiverSymbol(input.symbol);
  if (!canonical) return { symbol: String(input.symbol || "").toUpperCase(), interval: input.interval || "1d", eligibility: { supported: false, reason: "not_eligible" }, status: "not_eligible", coverage: null, multipliers: null, points: [], sources: [], warnings: ["此商品不適用本益比河流圖。"], backfill: { status: "not_applicable", reasonCode: "not_eligible" } };
  const metadata = input.db ? await catalogMetadata(input.db, canonical.symbol) : {};
  const eligibility = peRiverEligibility({ symbol: canonical.symbol, interval: input.interval || "1d", ...metadata });
  if (!eligibility.supported) return { symbol: canonical.symbol, interval: input.interval || "1d", eligibility, status: eligibility.reason, coverage: null, multipliers: null, points: [], sources: [], warnings: [eligibility.reason === "unsupported_interval" ? "本益比河流圖僅支援日 K。" : "此商品不是支援的台灣普通股。"], backfill: { status: "not_applicable", reasonCode: eligibility.reason } };
  if (!input.db) return { symbol: canonical.symbol, interval: "1d", eligibility, status: "blocked", coverage: null, multipliers: null, points: [], sources: [], warnings: ["估值資料庫尚未啟用。"], backfill: { status: "blocked", reasonCode: "blocked" } };
  const rows = await readPeRiverRows(input.db, canonical.symbol);
  const river = buildPeRiver(rows);
  const now = new Date();
  const targetEnd = now.toISOString().slice(0, 10);
  now.setUTCFullYear(now.getUTCFullYear() - PE_RIVER_LOOKBACK_YEARS);
  const targetStart = now.toISOString().slice(0, 10);
  const queued = river.status === "available" ? null : await queuePeRiverBackfill(input.db, { symbol: canonical.symbol, targetStart, targetEnd });
  const jobRow = await input.db.prepare(`SELECT status,reason_code,lane,retry_after,completed_months,total_months,lease_expires_at FROM taiwan_stock_pe_backfill_job WHERE exchange=? AND symbol=?`).bind(canonical.exchange, canonical.symbol).first<{ status: string; reason_code: string; lane?: string | null; retry_after?: string | null; completed_months?: number | null; total_months?: number | null; lease_expires_at?: string | null }>();
  const stateRow = await input.db.prepare(`SELECT official_source_date,provisional_status,provisional_quarantined,mismatch_date,mismatch_pe_difference,mismatch_close_difference FROM taiwan_stock_pe_fetch_state WHERE exchange=? AND symbol=?`).bind(canonical.exchange, canonical.symbol).first<{ official_source_date?: string | null; provisional_status?: string | null; provisional_quarantined?: number | null; mismatch_date?: string | null; mismatch_pe_difference?: number | null; mismatch_close_difference?: number | null }>();
  const status = river.status === "available" ? "available" : String(jobRow?.status || "queued");
  const reasonCode = river.status === "available" ? "available" : String(jobRow?.reason_code || "running");
  await input.db.prepare(`INSERT INTO taiwan_stock_pe_fetch_state (exchange,symbol,requested_start,requested_end,coverage_start,coverage_end,source_date,latest_source_date,verified_end,display_end,provisional_dates_json,lane,status,reason_code,last_success_at,last_attempt_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='available' THEN CURRENT_TIMESTAMP ELSE NULL END,CURRENT_TIMESTAMP) ON CONFLICT(exchange,symbol) DO UPDATE SET requested_start=excluded.requested_start,requested_end=excluded.requested_end,coverage_start=excluded.coverage_start,coverage_end=excluded.coverage_end,source_date=excluded.source_date,latest_source_date=COALESCE(excluded.latest_source_date,taiwan_stock_pe_fetch_state.latest_source_date),verified_end=excluded.verified_end,display_end=excluded.display_end,provisional_dates_json=excluded.provisional_dates_json,lane=excluded.lane,status=excluded.status,reason_code=CASE WHEN taiwan_stock_pe_fetch_state.provisional_quarantined=1 THEN 'source_mismatch' ELSE excluded.reason_code END,last_success_at=COALESCE(excluded.last_success_at,taiwan_stock_pe_fetch_state.last_success_at),last_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`).bind(canonical.exchange, canonical.symbol, targetStart, targetEnd, river.coverage.actualStart, river.coverage.actualEnd, river.coverage.actualEnd, river.coverage.actualEnd, river.coverage.verifiedEnd, river.coverage.displayEnd, JSON.stringify(river.coverage.provisionalDates), river.status === "available" ? "latest" : "history", river.status === "available" ? "available" : status, reasonCode, river.status === "available" ? "available" : status).run();
  const originalProvider = canonical.exchange === "TWSE" ? "臺灣證券交易所" : "證券櫃檯買賣中心";
  return {
    symbol: canonical.symbol,
    interval: "1d",
    eligibility,
    ...river,
    provisional: {
      ...river.provisional,
      status: stateRow?.provisional_quarantined ? "source_mismatch" : (stateRow?.provisional_status || river.provisional.status),
      officialSourceDate: stateRow?.official_source_date || river.coverage.verifiedEnd,
      quarantined: Boolean(stateRow?.provisional_quarantined),
      mismatchDate: stateRow?.mismatch_date || null,
    },
    sources: [
      { role: "original-provider", provider: canonical.exchange === "TWSE" ? "twse" : "tpex", dataset: "official-daily-pe-and-close", attribution: originalProvider, sourceDate: river.coverage.end, license: { name: "政府資料開放授權條款－第1版", url: "https://data.gov.tw/license" } },
      { role: "historical-intermediary", provider: "finmind", dataset: "TaiwanStockPER + TaiwanStockPrice", attribution: "歷史資料介接：FinMind", sourceDate: river.coverage.end, access: "private-custom-noncommercial" },
    ],
    warnings: [
      "河流帶代表個股自身五年歷史本益比分布，不是合理價或投資建議。",
      ...(rows.some((row) => !row.fiscalYear || !row.fiscalQuarter) ? ["部分歷史資料未提供財報年／季。"] : []),
      ...(river.coverage.provisionalDates.length ? [`FinMind 暫代，等待交易所確認；最後官方驗證日期 ${stateRow?.official_source_date || river.coverage.verifiedEnd || "--"}。`] : []),
      ...(stateRow?.provisional_quarantined ? ["FinMind 與交易所來源核對不一致，已停用此商品後續暫代資料。"] : []),
      ...(river.status === "available" ? [] : ["已排入免費資料背景回補；K 線可繼續使用。"]),
    ],
    backfill: river.status === "available" ? { status: "complete", reasonCode: "available", lane: "latest", nextRetry: null } : { jobId: queued?.jobId, status, reasonCode, lane: jobRow?.lane || "history", completedMonths: Number(jobRow?.completed_months || 0), totalMonths: Number(jobRow?.total_months || 0), nextRetry: jobRow?.retry_after || null, leaseExpiresAt: jobRow?.lease_expires_at || null },
  };
}

export async function ingestNormalizedPeRiverMonth(input: { db: D1Database; symbol: string; month: string; rows: unknown; fetchedAt?: string }) {
  const canonical = canonicalPeRiverSymbol(input.symbol);
  if (!canonical || !/^\d{4}-\d{2}$/.test(input.month) || !Array.isArray(input.rows) || input.rows.length > 31) throw new Error("invalid_payload");
  const seen = new Set<string>();
  const fetchedAt = input.fetchedAt || new Date().toISOString();
  const normalized = input.rows.map((value) => {
    if (!value || typeof value !== "object") throw new Error("invalid_payload");
    const row = value as UnknownRecord;
    const sessionDate = normalizeOfficialDate(row.sessionDate);
    const officialClose = finitePositive(row.officialClose);
    const officialPeRatio = finitePositive(row.officialPeRatio);
    if (!sessionDate || !sessionDate.startsWith(input.month) || !officialClose || !officialPeRatio || seen.has(sessionDate)) throw new Error("invalid_payload");
    seen.add(sessionDate);
    const referenceEps = officialClose / officialPeRatio;
    const requestedSource = String(row.source || row.provider || "").toLowerCase();
    const source = requestedSource === "finmind" ? "finmind" as const : canonical.exchange === "TWSE" ? "twse" as const : "tpex" as const;
    const validationStatus = String(row.validationStatus || (source === "finmind" ? "finmind_pending_verification" : "official_verified"));
    if (!["official_verified", "finmind_overlap_verified", "finmind_provisional_latest", "finmind_pending_verification"].includes(validationStatus)) throw new Error("invalid_payload");
    if (validationStatus === "finmind_provisional_latest" && source !== "finmind") throw new Error("invalid_payload");
    return { exchange: canonical.exchange, symbol: canonical.symbol, sessionDate, officialClose, officialPeRatio, referenceEps, fiscalYear: String(row.fiscalYear || "") || null, fiscalQuarter: /^[1-4]$/.test(String(row.fiscalQuarter || "")) ? String(row.fiscalQuarter) : null, source, provider: source, originalSource: canonical.exchange === "TWSE" ? "臺灣證券交易所" : "證券櫃檯買賣中心", validationStatus: validationStatus as PeRiverValuationRow["validationStatus"], officialOverlapDate: normalizeOfficialDate(row.officialOverlapDate) || null, provisionalCreatedAt: validationStatus === "finmind_provisional_latest" ? fetchedAt : null, sourceDate: normalizeOfficialDate(row.sourceDate) || sessionDate, fetchedAt };
  });
  let promoted = 0;
  for (const officialRow of normalized.filter((row) => row.validationStatus === "official_verified")) {
    const overlap = await input.db.prepare(`SELECT official_close,official_pe_ratio FROM taiwan_stock_pe_valuation_daily WHERE exchange=? AND symbol=? AND session_date=? AND provider='finmind' AND validation_status='finmind_pending_verification'`).bind(officialRow.exchange, officialRow.symbol, officialRow.sessionDate).first<{ official_close: number; official_pe_ratio: number }>();
    if (!overlap || Math.abs(Number(overlap.official_close) - officialRow.officialClose) > 0.01 || Math.abs(Number(overlap.official_pe_ratio) - officialRow.officialPeRatio) > 0.01) continue;
    const updated = await input.db.prepare(`UPDATE taiwan_stock_pe_valuation_daily SET validation_status='finmind_overlap_verified',official_overlap_date=?,updated_at=CURRENT_TIMESTAMP WHERE exchange=? AND symbol=? AND provider='finmind' AND validation_status='finmind_pending_verification'`).bind(officialRow.sessionDate, officialRow.exchange, officialRow.symbol).run();
    promoted += Number(updated.meta?.changes || 0);
  }
  await upsertPeRiverRows(input.db, normalized);
  const saved = await readPeRiverRows(input.db, canonical.symbol);
  const savedCoverage = peRiverCoverageState(saved);
  const verified = savedCoverage.verified;
  const provisional = savedCoverage.provisional;
  const officialLatest = normalized.filter((row) => row.validationStatus === "official_verified").at(-1)?.sessionDate || null;
  const coverageStart = savedCoverage.coverageStart;
  const coverageEnd = savedCoverage.verifiedEnd;
  const displayEnd = savedCoverage.displayEnd;
  const fetchStatus = verified.length >= PE_RIVER_MINIMUM_SAMPLES ? "available" : "partial";
  await input.db.prepare(`INSERT INTO taiwan_stock_pe_fetch_state (exchange,symbol,coverage_start,coverage_end,source_date,latest_source_date,provider_verified_at,lane,status,reason_code,last_success_at,last_attempt_at) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(exchange,symbol) DO UPDATE SET coverage_start=excluded.coverage_start,coverage_end=excluded.coverage_end,source_date=excluded.source_date,latest_source_date=COALESCE(excluded.latest_source_date,taiwan_stock_pe_fetch_state.latest_source_date),provider_verified_at=COALESCE(excluded.provider_verified_at,taiwan_stock_pe_fetch_state.provider_verified_at),lane=excluded.lane,status=excluded.status,reason_code=excluded.reason_code,last_success_at=CURRENT_TIMESTAMP,last_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`).bind(canonical.exchange, canonical.symbol, coverageStart, coverageEnd, coverageEnd, officialLatest, promoted > 0 || normalized.some((row) => row.validationStatus === "finmind_overlap_verified") ? fetchedAt : null, officialLatest ? "latest" : "history", fetchStatus, officialLatest ? "available" : normalized.some((row) => row.validationStatus === "finmind_overlap_verified") ? "finmind_overlap_verified" : "historical_seed").run();
  await input.db.prepare(`UPDATE taiwan_stock_pe_fetch_state SET verified_end=?,display_end=?,official_source_date=COALESCE(?,official_source_date),provisional_dates_json=?,provisional_status=?,updated_at=CURRENT_TIMESTAMP WHERE exchange=? AND symbol=?`).bind(coverageEnd, displayEnd, officialLatest, JSON.stringify(provisional.map((row) => row.sessionDate)), provisional.length ? "pending" : null, canonical.exchange, canonical.symbol).run();
  const jobId = `pe-river:${canonical.symbol}`;
  const checkpoint = JSON.stringify({
    PER: { status: "complete", rowCount: normalized.length, cursor: normalized.length, completedAt: fetchedAt },
    price: { status: "complete", rowCount: normalized.length, cursor: normalized.length, completedAt: fetchedAt },
    normalized: { status: "complete", rowCount: normalized.length, cursor: normalized.length, completedAt: fetchedAt },
  });
  await input.db.prepare(`INSERT INTO taiwan_stock_pe_backfill_month (job_id,exchange,symbol,target_month,status,row_count,dataset_status_json,ingest_cursor,completed_at) VALUES (?,?,?,?,'complete',?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(exchange,symbol,target_month) DO UPDATE SET status='complete',row_count=excluded.row_count,dataset_status_json=excluded.dataset_status_json,ingest_cursor=excluded.ingest_cursor,error_code=NULL,retry_after=NULL,lease_owner=NULL,lease_expires_at=NULL,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`).bind(jobId, canonical.exchange, canonical.symbol, input.month, normalized.length, checkpoint, normalized.length).run();
  return { accepted: normalized.length, promoted, coverageStart: normalized[0]?.sessionDate || null, coverageEnd: normalized.at(-1)?.sessionDate || null };
}
