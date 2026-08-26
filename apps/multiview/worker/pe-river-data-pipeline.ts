import {
  canonicalPeRiverSymbol,
  normalizeOfficialDate,
  peRiverEligibility,
  type PeRiverExchange,
  type PeRiverValuationRow,
} from "./taiwan-stock-pe-river.ts";

export const FINMIND_DATA_URL = "https://api.finmindtrade.com/api/v4/data";
export const TWSE_PE_DAILY_URL = "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d";
export const TPEX_PE_DAILY_URL = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis";
export const TPEX_CLOSE_DAILY_URL = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes";
export const PE_RIVER_OGDL_URL = "https://data.gov.tw/license";
export const FINMIND_SAFE_HOURLY_BUDGET = 240;
export const PE_RIVER_MAX_HISTORY_TARGETS = 8;
export const PE_RIVER_PROVISIONAL_MAX_SESSIONS = 3;
export const PE_RIVER_PROVISIONAL_MAX_RANGE_DAYS = 14;
export const PE_RIVER_PROVISIONAL_NOT_BEFORE_HOUR = 18;
export const PE_RIVER_PROVISIONAL_NOT_BEFORE_MINUTE = 30;

type UnknownRecord = Record<string, unknown>;
type FetchLike = typeof fetch;

export type PeRiverAttemptDiagnostic = {
  peRowCount: number;
  closeRowCount: number;
  peSourceDates: string[];
  closeSourceDates: string[];
  missingFields: string[];
};

function providerAttemptError(reasonCode: "official_not_published" | "schema_mismatch", diagnostic: PeRiverAttemptDiagnostic) {
  const error = new Error(reasonCode) as Error & { diagnostic?: PeRiverAttemptDiagnostic };
  error.diagnostic = diagnostic;
  return error;
}

export function peRiverProviderAttemptDiagnostic(value: unknown): PeRiverAttemptDiagnostic | null {
  if (!value || typeof value !== "object") return null;
  const diagnostic = (value as { diagnostic?: unknown }).diagnostic;
  if (!diagnostic || typeof diagnostic !== "object") return null;
  const candidate = diagnostic as Partial<PeRiverAttemptDiagnostic>;
  return {
    peRowCount: Number(candidate.peRowCount || 0),
    closeRowCount: Number(candidate.closeRowCount || 0),
    peSourceDates: Array.isArray(candidate.peSourceDates) ? candidate.peSourceDates.map(String).slice(0, 3) : [],
    closeSourceDates: Array.isArray(candidate.closeSourceDates) ? candidate.closeSourceDates.map(String).slice(0, 3) : [],
    missingFields: Array.isArray(candidate.missingFields) ? candidate.missingFields.map(String).slice(0, 8) : [],
  };
}

const positive = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || ["-", "--", "N/A", "NaN"].includes(text)) return null;
  const parsed = Number(text.replaceAll(",", "").replaceAll("%", ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const absoluteDifference = (left: number, right: number) => Number(Math.abs(left - right).toFixed(8));

const safeDate = (value: unknown) => {
  const normalized = normalizeOfficialDate(value);
  return normalized && /^20\d{2}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
};

function taipeiClock(now: Date) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, hour: Number(values.hour), minute: Number(values.minute) };
}

export function provisionalPeRiverDateRange(officialSourceDate: string, now = new Date()) {
  const official = safeDate(officialSourceDate);
  const clock = taipeiClock(now);
  if (!official || official >= clock.date) return { status: "not_needed" as const, startDate: null, endDate: clock.date };
  const elapsedDays = Math.round((Date.parse(`${clock.date}T00:00:00Z`) - Date.parse(`${official}T00:00:00Z`)) / 86400000);
  if (elapsedDays >= PE_RIVER_PROVISIONAL_MAX_RANGE_DAYS) return { status: "provisional_capped" as const, startDate: null, endDate: clock.date };
  return { status: "ready" as const, startDate: official, endDate: clock.date };
}

export function buildProvisionalPeRiverCandidates(input: {
  historyRows: PeRiverValuationRow[];
  officialSourceDate: string;
  now?: Date;
  enabled?: boolean;
  quarantined?: boolean;
}) {
  if (!input.enabled) return { status: "disabled" as const, rows: [], capped: false };
  if (input.quarantined) return { status: "source_mismatch" as const, rows: [], capped: false };
  const officialSourceDate = safeDate(input.officialSourceDate);
  if (!officialSourceDate) return { status: "official_not_published" as const, rows: [], capped: false };
  const clock = taipeiClock(input.now || new Date());
  const currentSessionComplete = clock.hour > PE_RIVER_PROVISIONAL_NOT_BEFORE_HOUR
    || (clock.hour === PE_RIVER_PROVISIONAL_NOT_BEFORE_HOUR && clock.minute >= PE_RIVER_PROVISIONAL_NOT_BEFORE_MINUTE);
  const candidates = input.historyRows
    .filter((row) => row.provider === "finmind" || row.source === "finmind")
    .filter((row) => row.sessionDate > officialSourceDate && row.sessionDate <= clock.date)
    .filter((row) => row.sessionDate < clock.date || currentSessionComplete)
    .filter((row) => Number.isFinite(row.officialPeRatio) && row.officialPeRatio > 0 && Number.isFinite(row.officialClose) && row.officialClose > 0)
    .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
  const unique = [...new Map(candidates.map((row) => [row.sessionDate, row])).values()];
  const capped = unique.length > PE_RIVER_PROVISIONAL_MAX_SESSIONS;
  const rows = unique.slice(0, PE_RIVER_PROVISIONAL_MAX_SESSIONS).map((row) => ({
    ...row,
    referenceEps: row.officialClose / row.officialPeRatio,
    validationStatus: "finmind_provisional_latest" as const,
    officialOverlapDate: null,
  }));
  return { status: rows.length ? (capped ? "provisional_capped" as const : "pending" as const) : "official_not_published" as const, rows, capped };
}

export function reconcileProvisionalPeRiverRow(provisional: PeRiverValuationRow, official?: PeRiverValuationRow | null) {
  if (provisional.validationStatus !== "finmind_provisional_latest" || !official || provisional.exchange !== official.exchange || provisional.symbol !== official.symbol || provisional.sessionDate !== official.sessionDate) {
    return { status: "official_not_published" as const, peDifference: null, closeDifference: null };
  }
  const peDifference = absoluteDifference(provisional.officialPeRatio, official.officialPeRatio);
  const closeDifference = absoluteDifference(provisional.officialClose, official.officialClose);
  return peDifference <= 0.01 && closeDifference <= 0.01
    ? { status: "official_verified" as const, peDifference, closeDifference }
    : { status: "source_mismatch" as const, peDifference, closeDifference };
}

async function boundedJson(response: Response, maxBytes: number) {
  if (!response.ok) {
    if ([402, 429].includes(response.status)) throw new Error("rate_limit_waiting");
    if (response.status >= 500) throw new Error("provider_unavailable");
    throw new Error("invalid_response");
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new Error("payload_too_large");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxBytes) throw new Error("payload_too_large");
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("schema_mismatch"); }
}

function finMindRows(payload: unknown, dataset: "TaiwanStockPER" | "TaiwanStockPrice", stockCode: string) {
  if (!payload || typeof payload !== "object") throw new Error("schema_mismatch");
  const body = payload as UnknownRecord;
  if (Number(body.status) !== 200 || !Array.isArray(body.data) || body.data.length > 5000) throw new Error("schema_mismatch");
  return body.data.map((value) => {
    if (!value || typeof value !== "object") throw new Error("schema_mismatch");
    const row = value as UnknownRecord;
    const sessionDate = safeDate(row.date);
    if (String(row.stock_id || "") !== stockCode || !sessionDate) throw new Error("schema_mismatch");
    const metric = dataset === "TaiwanStockPER" ? positive(row.PER) : positive(row.close);
    return { sessionDate, metric };
  });
}

export function joinFinMindPeHistory(input: {
  symbol: string;
  pePayload: unknown;
  pricePayload: unknown;
  fetchedAt?: string;
}): PeRiverValuationRow[] {
  const canonical = canonicalPeRiverSymbol(input.symbol);
  if (!canonical) throw new Error("not_eligible");
  const peRows = finMindRows(input.pePayload, "TaiwanStockPER", canonical.stockCode);
  const priceRows = finMindRows(input.pricePayload, "TaiwanStockPrice", canonical.stockCode);
  const pe = new Map(peRows.map((row) => [row.sessionDate, row.metric]));
  const close = new Map(priceRows.map((row) => [row.sessionDate, row.metric]));
  const fetchedAt = input.fetchedAt || new Date().toISOString();
  return [...new Set([...pe.keys(), ...close.keys()])].sort().flatMap((sessionDate) => {
    const officialPeRatio = pe.get(sessionDate);
    const officialClose = close.get(sessionDate);
    if (!officialPeRatio || !officialClose) return [];
    return [{
      exchange: canonical.exchange,
      symbol: canonical.symbol,
      sessionDate,
      officialClose,
      officialPeRatio,
      referenceEps: officialClose / officialPeRatio,
      fiscalYear: null,
      fiscalQuarter: null,
      source: "finmind",
      provider: "finmind",
      originalSource: canonical.exchange === "TWSE" ? "臺灣證券交易所" : "證券櫃檯買賣中心",
      validationStatus: "finmind_pending_verification",
      officialOverlapDate: null,
      sourceDate: sessionDate,
      fetchedAt,
    }];
  });
}

export async function fetchFinMindPeHistory(input: {
  symbol: string;
  startDate: string;
  endDate: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}) {
  const canonical = canonicalPeRiverSymbol(input.symbol);
  if (!canonical || !/^20\d{2}-\d{2}-\d{2}$/.test(input.startDate) || !/^20\d{2}-\d{2}-\d{2}$/.test(input.endDate) || input.startDate > input.endDate) throw new Error("invalid_payload");
  const fetchImpl = input.fetchImpl || fetch;
  const request = async (dataset: "TaiwanStockPER" | "TaiwanStockPrice") => {
    const url = new URL(FINMIND_DATA_URL);
    url.searchParams.set("dataset", dataset);
    url.searchParams.set("data_id", canonical.stockCode);
    url.searchParams.set("start_date", input.startDate);
    url.searchParams.set("end_date", input.endDate);
    const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(Math.min(30000, Math.max(1000, input.timeoutMs || 20000))) });
    return boundedJson(response, 4_000_000);
  };
  const [pePayload, pricePayload] = await Promise.all([request("TaiwanStockPER"), request("TaiwanStockPrice")]);
  return { rows: joinFinMindPeHistory({ symbol: canonical.symbol, pePayload, pricePayload }), requestsUsed: 2 };
}

function officialRowBase(exchange: PeRiverExchange, stockCode: string, sessionDate: string, close: number, pe: number, fiscal: unknown): PeRiverValuationRow {
  const fiscalText = String(fiscal || "").trim();
  const fiscalMatch = fiscalText.match(/(\d{4})\D*[Q季]?([1-4])/i);
  return {
    exchange,
    symbol: `${stockCode}.${exchange === "TWSE" ? "TW" : "TWO"}`,
    sessionDate,
    officialClose: close,
    officialPeRatio: pe,
    referenceEps: close / pe,
    fiscalYear: fiscalMatch?.[1] || null,
    fiscalQuarter: fiscalMatch?.[2] || null,
    source: exchange === "TWSE" ? "twse" : "tpex",
    provider: exchange === "TWSE" ? "twse" : "tpex",
    originalSource: exchange === "TWSE" ? "臺灣證券交易所" : "證券櫃檯買賣中心",
    validationStatus: "official_verified",
    officialOverlapDate: sessionDate,
    sourceDate: sessionDate,
    fetchedAt: new Date().toISOString(),
  };
}

export type OfficialPeGap = { exchange: PeRiverExchange; symbol: string; sessionDate: string; officialClose: number; source: "twse" | "tpex"; reasonCode: "official_gap" };

function officialGapBase(exchange: PeRiverExchange, stockCode: string, sessionDate: string, close: number): OfficialPeGap {
  return { exchange, symbol: `${stockCode}.${exchange === "TWSE" ? "TW" : "TWO"}`, sessionDate, officialClose: close, source: exchange === "TWSE" ? "twse" : "tpex", reasonCode: "official_gap" };
}

export function parseTwseDailySnapshotBundle(payload: unknown) {
  if (!Array.isArray(payload) || payload.length < 1 || payload.length > 5000) throw new Error("schema_mismatch");
  const rows: PeRiverValuationRow[] = [];
  const gaps: OfficialPeGap[] = [];
  for (const value of payload) {
    if (!value || typeof value !== "object") continue;
    const row = value as UnknownRecord;
    const code = String(row.Code || "").trim();
    const date = safeDate(row.Date);
    const close = positive(row.ClosePrice);
    if (!/^[0-9A-Z]{4,8}$/.test(code) || !date || !close) continue;
    const pe = positive(row.PEratio);
    if (pe) rows.push(officialRowBase("TWSE", code, date, close, pe, row.FiscalYearQuarter));
    else gaps.push(officialGapBase("TWSE", code, date, close));
  }
  return { rows, gaps };
}

export function parseTwseDailySnapshot(payload: unknown) {
  return parseTwseDailySnapshotBundle(payload).rows;
}

export function parseTpexDailySnapshotBundle(pePayload: unknown, closePayload: unknown) {
  if (!Array.isArray(pePayload) || !Array.isArray(closePayload) || pePayload.length > 5000 || closePayload.length > 15000) throw new Error("schema_mismatch");
  const peDates = new Set<string>();
  const closeDates = new Set<string>();
  let validPeShapes = 0;
  let validCloseShapes = 0;
  for (const value of pePayload) {
    if (!value || typeof value !== "object") continue;
    const row = value as UnknownRecord;
    const code = String(row.SecuritiesCompanyCode || row.Code || "").trim();
    const date = safeDate(row.Date);
    if (code && date && (Object.hasOwn(row, "PriceEarningRatio") || Object.hasOwn(row, "PEratio"))) {
      validPeShapes += 1;
      peDates.add(date);
    }
  }
  for (const value of closePayload) {
    if (!value || typeof value !== "object") continue;
    const row = value as UnknownRecord;
    const code = String(row.SecuritiesCompanyCode || row.Code || "").trim();
    const date = safeDate(row.Date);
    if (code && date && (Object.hasOwn(row, "Close") || Object.hasOwn(row, "ClosePrice"))) {
      validCloseShapes += 1;
      closeDates.add(date);
    }
  }
  const diagnostic: PeRiverAttemptDiagnostic = {
    peRowCount: pePayload.length,
    closeRowCount: closePayload.length,
    peSourceDates: [...peDates].sort().slice(-3),
    closeSourceDates: [...closeDates].sort().slice(-3),
    missingFields: [
      ...(pePayload.length && !validPeShapes ? ["pe:SecuritiesCompanyCode|Code,Date,PriceEarningRatio|PEratio"] : []),
      ...(closePayload.length && !validCloseShapes ? ["close:SecuritiesCompanyCode|Code,Date,Close|ClosePrice"] : []),
    ],
  };
  if ((pePayload.length && !validPeShapes) || (closePayload.length && !validCloseShapes)) throw providerAttemptError("schema_mismatch", diagnostic);
  const commonDates = new Set([...peDates].filter((date) => closeDates.has(date)));
  if (!commonDates.size) return { rows: [] as PeRiverValuationRow[], gaps: [] as OfficialPeGap[], status: "official_not_published" as const, diagnostic };
  const closes = new Map<string, { date: string; close: number }>();
  for (const value of closePayload) {
    if (!value || typeof value !== "object") continue;
    const row = value as UnknownRecord;
    const code = String(row.SecuritiesCompanyCode || row.Code || "").trim();
    const date = safeDate(row.Date);
    const close = positive(row.Close ?? row.ClosePrice);
    if (code && date && close) closes.set(`${code}:${date}`, { date, close });
  }
  const rows: PeRiverValuationRow[] = [];
  const gaps: OfficialPeGap[] = [];
  for (const value of pePayload) {
    if (!value || typeof value !== "object") continue;
    const row = value as UnknownRecord;
    const code = String(row.SecuritiesCompanyCode || row.Code || "").trim();
    const date = safeDate(row.Date);
    const close = date ? closes.get(`${code}:${date}`)?.close : null;
    if (!/^[0-9A-Z]{4,8}$/.test(code) || !date || !close) continue;
    const pe = positive(row.PriceEarningRatio ?? row.PEratio);
    if (pe) rows.push(officialRowBase("TPEx", code, date, close, pe, row.FiscalYearQuarter));
    else gaps.push(officialGapBase("TPEx", code, date, close));
  }
  if (!rows.length && !gaps.length) throw providerAttemptError("schema_mismatch", diagnostic);
  return { rows, gaps, status: "available" as const, diagnostic };
}

export function parseTpexDailySnapshot(pePayload: unknown, closePayload: unknown) {
  return parseTpexDailySnapshotBundle(pePayload, closePayload).rows;
}

type OfficialSnapshotBundle = { rows: PeRiverValuationRow[]; gaps: OfficialPeGap[]; status?: "available" | "official_not_published"; diagnostic?: PeRiverAttemptDiagnostic };
const officialCache = new Map<PeRiverExchange, { expiresAt: number; bundle: OfficialSnapshotBundle; promise?: Promise<OfficialSnapshotBundle> }>();

export function resetPeRiverDataCachesForTest() {
  officialCache.clear();
}

export async function fetchOfficialPeDailySnapshotBundle(exchange: PeRiverExchange, fetchImpl: FetchLike = fetch) {
  const cached = officialCache.get(exchange);
  if (cached && cached.expiresAt > Date.now() && cached.bundle.rows.length + cached.bundle.gaps.length) return cached.bundle;
  if (cached?.promise) return cached.promise;
  const promise = (async () => {
    const get = async (url: string, maxBytes: number) => boundedJson(await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "MultiChartOnCodexSite/1.0 (+official-open-data)" }, signal: AbortSignal.timeout(20000) }), maxBytes);
    const bundle = exchange === "TWSE"
      ? parseTwseDailySnapshotBundle(await get(TWSE_PE_DAILY_URL, 3_000_000))
      : parseTpexDailySnapshotBundle(await get(TPEX_PE_DAILY_URL, 3_000_000), await get(TPEX_CLOSE_DAILY_URL, 8_000_000));
    if (!bundle.rows.length && !bundle.gaps.length) {
      const diagnostic = bundle.diagnostic || { peRowCount: 0, closeRowCount: 0, peSourceDates: [], closeSourceDates: [], missingFields: [] };
      throw providerAttemptError(bundle.status === "official_not_published" ? "official_not_published" : "schema_mismatch", diagnostic);
    }
    officialCache.set(exchange, { bundle, expiresAt: Date.now() + 120000 });
    return bundle;
  })();
  officialCache.set(exchange, { bundle: cached?.bundle || { rows: [], gaps: [] }, expiresAt: cached?.expiresAt || 0, promise });
  try { return await promise; }
  finally {
    const settled = officialCache.get(exchange);
    if (settled?.promise) officialCache.set(exchange, { bundle: settled.bundle, expiresAt: settled.expiresAt });
  }
}

export async function fetchOfficialPeDailySnapshot(exchange: PeRiverExchange, fetchImpl: FetchLike = fetch) {
  return (await fetchOfficialPeDailySnapshotBundle(exchange, fetchImpl)).rows;
}

export function verifyProviderOverlap(historyRows: PeRiverValuationRow[], officialRows: PeRiverValuationRow[]) {
  const official = new Map(officialRows.map((row) => [`${row.symbol}:${row.sessionDate}`, row]));
  const candidates = historyRows.filter((row) => official.has(`${row.symbol}:${row.sessionDate}`)).sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
  const history = candidates[0];
  if (!history) {
    const historyEnd = historyRows.at(-1)?.sessionDate || null;
    const officialEnd = officialRows.at(-1)?.sessionDate || null;
    return { status: "official_not_published" as const, overlapDate: null, historyEnd, officialEnd };
  }
  const matched = official.get(`${history.symbol}:${history.sessionDate}`)!;
  const peDifference = absoluteDifference(history.officialPeRatio, matched.officialPeRatio);
  const closeDifference = absoluteDifference(history.officialClose, matched.officialClose);
  return peDifference <= 0.01 && closeDifference <= 0.01
    ? { status: "finmind_overlap_verified" as const, overlapDate: history.sessionDate, peDifference, closeDifference }
    : { status: "source_mismatch" as const, overlapDate: history.sessionDate, peDifference, closeDifference };
}

const trust = (row: PeRiverValuationRow) => ({ official_gap: 5, official_verified: 4, finmind_overlap_verified: 3, finmind_provisional_latest: 2, finmind_pending_verification: 1 }[row.validationStatus] || 0);

export function mergePreferredPeRows(existing: PeRiverValuationRow[], incoming: PeRiverValuationRow[]) {
  const merged = new Map(existing.map((row) => [`${row.exchange}:${row.symbol}:${row.sessionDate}`, row]));
  for (const row of incoming) {
    const key = `${row.exchange}:${row.symbol}:${row.sessionDate}`;
    const current = merged.get(key);
    if (!current || trust(row) > trust(current) || (trust(row) === trust(current) && row.fetchedAt > current.fetchedAt)) merged.set(key, row);
  }
  return [...merged.values()].sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
}

function hourWindow(now: Date) {
  const value = new Date(now);
  value.setUTCMinutes(0, 0, 0);
  return value.toISOString();
}

export async function reserveFinMindBudget(db: D1Database, requested: number, now = new Date(), limit = FINMIND_SAFE_HOURLY_BUDGET) {
  if (!Number.isInteger(requested) || requested < 1 || requested > 16) throw new Error("invalid_payload");
  const windowStart = hourWindow(now);
  await db.prepare(`INSERT INTO taiwan_stock_pe_control (control_key,budget_window_start,budget_used,budget_limit) VALUES ('global',?,0,?) ON CONFLICT(control_key) DO NOTHING`).bind(windowStart, limit).run();
  await db.prepare(`UPDATE taiwan_stock_pe_control SET budget_window_start=?,budget_used=0,budget_limit=?,updated_at=CURRENT_TIMESTAMP WHERE control_key='global' AND (budget_window_start IS NULL OR budget_window_start<>?)`).bind(windowStart, limit, windowStart).run();
  const result = await db.prepare(`UPDATE taiwan_stock_pe_control SET budget_used=budget_used+?,updated_at=CURRENT_TIMESTAMP WHERE control_key='global' AND budget_window_start=? AND budget_used+?<=budget_limit`).bind(requested, windowStart, requested).run();
  const row = await db.prepare(`SELECT budget_window_start,budget_used,budget_limit FROM taiwan_stock_pe_control WHERE control_key='global'`).first<{ budget_window_start: string; budget_used: number; budget_limit: number }>();
  const reserved = Number(result.meta?.changes || 0) > 0;
  return { reserved, used: Number(row?.budget_used || 0), limit: Number(row?.budget_limit || limit), windowStart, windowEnd: new Date(new Date(windowStart).getTime() + 3600000).toISOString(), reasonCode: reserved ? null : "rate_limit_waiting" };
}

export async function releaseFinMindBudget(db: D1Database, released: number, windowStart: string) {
  if (!Number.isInteger(released) || released < 1 || released > 16) throw new Error("invalid_payload");
  await db.prepare(`UPDATE taiwan_stock_pe_control SET budget_used=MAX(0,budget_used-?),updated_at=CURRENT_TIMESTAMP WHERE control_key='global' AND budget_window_start=?`).bind(released, windowStart).run();
}

export async function discoverPeRiverTargets(db: D1Database) {
  type TargetRow = { symbol: string; quote_type?: string | null; group_name?: string | null; market?: string | null };
  let results: TargetRow[] = [];
  try {
    const queried = await db.prepare(`SELECT DISTINCT ui.symbol,ic.quote_type,ic.group_name,ic.market FROM user_instruments ui LEFT JOIN instrument_catalog ic ON ic.symbol=ui.symbol AND ic.active=1 WHERE ui.enabled=1 UNION SELECT fs.symbol,ic.quote_type,ic.group_name,ic.market FROM taiwan_stock_pe_fetch_state fs LEFT JOIN instrument_catalog ic ON ic.symbol=fs.symbol AND ic.active=1`).all<TargetRow>();
    results = queried.results;
  } catch {
    const queried = await db.prepare(`SELECT symbol,NULL AS quote_type,NULL AS group_name,NULL AS market FROM taiwan_stock_pe_fetch_state`).all<TargetRow>();
    results = queried.results;
  }
  const bySymbol = new Map<string, { symbol: string; exchange: PeRiverExchange; stockCode: string }>();
  for (const row of results) {
    const eligibility = peRiverEligibility({ symbol: row.symbol, interval: "1d", quoteType: row.quote_type, groupName: row.group_name, market: row.market });
    if (eligibility.supported && eligibility.canonical) bySymbol.set(eligibility.canonical.symbol, eligibility.canonical);
  }
  return [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function latestFirstPlan(targets: Array<{ symbol: string; exchange: PeRiverExchange }>, history: Array<{ symbol: string; retryAfter?: string | null }>, now = new Date()) {
  const latest = targets.map((target) => ({ ...target, lane: "latest" as const }));
  const eligibleHistory = history.filter((target) => !target.retryAfter || target.retryAfter <= now.toISOString()).slice(0, PE_RIVER_MAX_HISTORY_TARGETS).map((target) => ({ ...target, lane: "history" as const }));
  return { latest, history: eligibleHistory, order: ["latest", "history"] as const };
}
