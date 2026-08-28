import type { CandleHistoryContinuityMetadata, HistoryCandle } from "./candle-history";

export const TAIWAN_CONTINUITY_MAX_MONTHS_PER_REQUEST = 6;
export const TAIWAN_CONTINUITY_MAX_DIAGNOSTIC_DATES = 32;
export const TAIWAN_OFFICIAL_FETCH_TIMEOUT_MS = 8000;
const OFFICIAL_SUCCESS_TTL_SECONDS = 6 * 60 * 60;
const OFFICIAL_PENDING_TTL_SECONDS = 5 * 60;
const OFFICIAL_FAILURE_TTL_SECONDS = 60;

type OfficialMonthStatus = "available" | "not_published" | "unavailable" | "invalid_payload";
export type TaiwanOfficialMonthResult = {
  symbol: string;
  month: string;
  status: OfficialMonthStatus;
  rows: HistoryCandle[];
  sessionDates: string[];
  provider: "twse" | "tpex";
  checkedAt: string;
  reasonCode: string | null;
};

export type TaiwanContinuityAudit = CandleHistoryContinuityMetadata & {
  repairRows: HistoryCandle[];
  candidateMonths: string[];
  officialRequests: number;
};

type FetchOfficialMonthOptions = {
  db?: D1Database;
  fetchImpl?: typeof fetch;
  now?: Date;
  requestBudget?: {
    remaining: number;
    used: number;
  };
};

const officialMonthMemory = new Map<string, { expiresAt: number; value: TaiwanOfficialMonthResult }>();
const officialMonthInflight = new Map<string, Promise<TaiwanOfficialMonthResult>>();

function officialMonthKey(symbol: string, month: string) {
  return `official-candle-month-v1|${symbol.trim().toUpperCase()}|${month}`;
}

function validSessionDate(value: unknown): value is string {
  const text = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`));
}

function officialNumber(value: unknown, allowZero = false) {
  const text = String(value ?? "").replaceAll(",", "").trim();
  if (!text || /^(?:-+|N\/?A|NULL)$/i.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && (allowZero ? parsed >= 0 : parsed > 0) ? parsed : null;
}

export function normalizeTaiwanOfficialDate(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 7) return `${Number(digits.slice(0, 3)) + 1911}-${digits.slice(3, 5)}-${digits.slice(5, 7)}`;
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return null;
}

export function taiwanSessionDate(row: HistoryCandle | undefined) {
  if (!row) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: row.sourceTimeZone || "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(row.time * 1000));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const value = `${values.year}-${values.month}-${values.day}`;
    return validSessionDate(value) ? value : null;
  } catch {
    return null;
  }
}

function officialCandleTime(sessionDate: string, time: string) {
  const parsed = Date.parse(`${sessionDate}T${time}+08:00`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function normalizedOfficialCandle(
  sessionDate: string,
  values: { open: unknown; high: unknown; low: unknown; close: unknown; volume: unknown },
  provider: "twse" | "tpex",
  checkedAt: string,
  volumeMultiplier: number,
): HistoryCandle | null {
  const open = officialNumber(values.open);
  const high = officialNumber(values.high);
  const low = officialNumber(values.low);
  const close = officialNumber(values.close);
  const volume = officialNumber(values.volume, true);
  const time = officialCandleTime(sessionDate, "09:00:00");
  const quoteTime = officialCandleTime(sessionDate, "13:30:00");
  if ([open, high, low, close, volume, time, quoteTime].some((value) => value == null)) return null;
  if (high! < Math.max(open!, close!) || low! > Math.min(open!, close!)) return null;
  return {
    time: time!,
    open: open!,
    high: high!,
    low: low!,
    close: close!,
    volume: volume! * volumeMultiplier,
    quoteTime: quoteTime!,
    source: `${provider}-official`,
    sourceUpdatedAt: checkedAt,
    marketSession: "closed",
    sourceTimeZone: "Asia/Taipei",
  };
}

function fieldRows(payload: unknown) {
  if (!payload || typeof payload !== "object") return [] as Array<{ fields: string[]; data: unknown[][] }>;
  const record = payload as Record<string, unknown>;
  const tables = [record, ...(Array.isArray(record.tables) ? record.tables : [])];
  return tables.flatMap((table) => {
    if (!table || typeof table !== "object") return [];
    const source = table as Record<string, unknown>;
    const fields = Array.isArray(source.fields) ? source.fields.map((field) => String(field).replaceAll(" ", "").trim()) : [];
    const data = Array.isArray(source.data) ? source.data.filter(Array.isArray) as unknown[][] : [];
    return fields.length && data.length ? [{ fields, data }] : [];
  });
}

export function parseTwseOfficialMonth(payload: unknown, symbol: string, checkedAt = new Date().toISOString()): HistoryCandle[] {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!/^\d{4,8}\.TW$/.test(normalizedSymbol)) return [];
  const rows = fieldRows(payload).find((table) => ["日期", "成交股數", "開盤價", "最高價", "最低價", "收盤價"].every((field) => table.fields.includes(field)));
  if (!rows) return [];
  return rows.data.flatMap((values) => {
    const record = Object.fromEntries(rows.fields.map((field, index) => [field, values[index]]));
    const sessionDate = normalizeTaiwanOfficialDate(record["日期"]);
    if (!sessionDate) return [];
    const candle = normalizedOfficialCandle(sessionDate, {
      open: record["開盤價"], high: record["最高價"], low: record["最低價"], close: record["收盤價"], volume: record["成交股數"],
    }, "twse", checkedAt, 1);
    return candle ? [candle] : [];
  });
}

export function parseTpexOfficialMonth(payload: unknown, symbol: string, checkedAt = new Date().toISOString()): HistoryCandle[] {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!/^\d{4,8}\.TWO$/.test(normalizedSymbol)) return [];
  const rows = fieldRows(payload).find((table) => ["日期", "成交張數", "開盤", "最高", "最低", "收盤"].every((field) => table.fields.includes(field)));
  if (!rows) return [];
  return rows.data.flatMap((values) => {
    const record = Object.fromEntries(rows.fields.map((field, index) => [field, values[index]]));
    const sessionDate = normalizeTaiwanOfficialDate(record["日期"]);
    if (!sessionDate) return [];
    const candle = normalizedOfficialCandle(sessionDate, {
      open: record["開盤"], high: record["最高"], low: record["最低"], close: record["收盤"], volume: record["成交張數"],
    }, "tpex", checkedAt, 1000);
    return candle ? [candle] : [];
  });
}

function officialMonthUrl(symbol: string, month: string) {
  const code = symbol.split(".")[0];
  const compact = `${month.replace("-", "")}01`;
  if (symbol.endsWith(".TW")) return `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${compact}&stockNo=${encodeURIComponent(code)}&response=json`;
  return `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${encodeURIComponent(code)}&date=${month.replace("-", "/")}/01&id=&response=json`;
}

function safeOfficialResult(value: unknown): TaiwanOfficialMonthResult | null {
  if (!value || typeof value !== "object") return null;
  const result = value as TaiwanOfficialMonthResult;
  if (!/^\d{4,8}\.(?:TW|TWO)$/.test(String(result.symbol)) || !/^\d{4}-\d{2}$/.test(String(result.month))) return null;
  if (!["available", "not_published", "unavailable", "invalid_payload"].includes(String(result.status))) return null;
  return {
    ...result,
    rows: Array.isArray(result.rows) ? result.rows : [],
    sessionDates: Array.isArray(result.sessionDates) ? result.sessionDates.filter(validSessionDate).slice(0, 31) : [],
    reasonCode: result.reasonCode ? String(result.reasonCode).slice(0, 80) : null,
  };
}

async function fetchJsonWithTimeout(fetchImpl: typeof fetch, url: string) {
  let lastReason = "provider_unavailable";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TAIWAN_OFFICIAL_FETCH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 CodexSites MultiChart" }, signal: controller.signal });
      if (!response.ok) {
        lastReason = response.status === 429 ? "rate_limited" : response.status >= 500 ? "provider_unavailable" : "invalid_response";
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) continue;
        return { payload: null, reasonCode: lastReason };
      }
      return { payload: await response.json(), reasonCode: null };
    } catch (error) {
      lastReason = error instanceof DOMException && error.name === "AbortError" ? "timeout" : "provider_unavailable";
      if (attempt === 0) continue;
    } finally {
      clearTimeout(timeout);
    }
  }
  return { payload: null, reasonCode: lastReason };
}

export async function fetchTaiwanOfficialMonth(symbol: string, month: string, options: FetchOfficialMonthOptions = {}): Promise<TaiwanOfficialMonthResult> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const provider = normalizedSymbol.endsWith(".TWO") ? "tpex" as const : "twse" as const;
  const now = options.now ?? new Date();
  const epoch = Math.floor(now.getTime() / 1000);
  const key = officialMonthKey(normalizedSymbol, month);
  const memory = officialMonthMemory.get(key);
  if (memory && memory.expiresAt > epoch) return memory.value;
  const existing = officialMonthInflight.get(key);
  if (existing) return existing;
  const promise = (async () => {
    if (options.db) {
      try {
        const cached = await options.db.prepare("SELECT payload FROM candle_cache WHERE cache_key=? AND expires_at>?").bind(key, epoch).first<{ payload?: string }>();
        const parsed = cached?.payload ? safeOfficialResult(JSON.parse(cached.payload)) : null;
        if (parsed) {
          officialMonthMemory.set(key, { expiresAt: epoch + 60, value: parsed });
          return parsed;
        }
      } catch {
        // D1 cache is optional; continue with the official source.
      }
    }
    if (options.requestBudget && options.requestBudget.remaining <= 0) {
      return {
        symbol: normalizedSymbol,
        month,
        status: "unavailable",
        rows: [],
        sessionDates: [],
        provider,
        checkedAt: now.toISOString(),
        reasonCode: "audit_request_budget",
      };
    }
    if (options.requestBudget) {
      options.requestBudget.remaining -= 1;
      options.requestBudget.used += 1;
    }
    const checkedAt = now.toISOString();
    const fetched = await fetchJsonWithTimeout(options.fetchImpl ?? fetch, officialMonthUrl(normalizedSymbol, month));
    let value: TaiwanOfficialMonthResult;
    if (fetched.reasonCode) {
      value = { symbol: normalizedSymbol, month, status: "unavailable", rows: [], sessionDates: [], provider, checkedAt, reasonCode: fetched.reasonCode };
    } else {
      const payload = fetched.payload as Record<string, unknown> | null;
      const stat = String(payload?.stat || "").toLowerCase();
      const rows = provider === "twse" ? parseTwseOfficialMonth(payload, normalizedSymbol, checkedAt) : parseTpexOfficialMonth(payload, normalizedSymbol, checkedAt);
      const targetMonth = String(payload?.date || "").replace(/\D/g, "").slice(0, 6);
      const expectedMonth = month.replace("-", "");
      const notPublished = ["查無資料", "很抱歉，沒有符合條件的資料!"].some((message) => JSON.stringify(payload || {}).includes(message));
      value = rows.length && targetMonth === expectedMonth
        ? { symbol: normalizedSymbol, month, status: "available", rows, sessionDates: rows.map(taiwanSessionDate).filter(validSessionDate), provider, checkedAt, reasonCode: null }
        : notPublished || ["ok", ""].includes(stat) && targetMonth === expectedMonth
          ? { symbol: normalizedSymbol, month, status: "not_published", rows: [], sessionDates: [], provider, checkedAt, reasonCode: "official_no_rows" }
          : { symbol: normalizedSymbol, month, status: "invalid_payload", rows: [], sessionDates: [], provider, checkedAt, reasonCode: "invalid_response" };
    }
    if (value.reasonCode === "audit_request_budget") return value;
    const ttl = value.status === "available" ? OFFICIAL_SUCCESS_TTL_SECONDS : value.status === "not_published" ? OFFICIAL_PENDING_TTL_SECONDS : OFFICIAL_FAILURE_TTL_SECONDS;
    officialMonthMemory.set(key, { expiresAt: epoch + ttl, value });
    if (options.db) {
      try {
        await options.db.prepare(`INSERT INTO candle_cache (cache_key,payload,expires_at) VALUES (?,?,?)
          ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at,updated_at=CURRENT_TIMESTAMP`)
          .bind(key, JSON.stringify(value), epoch + ttl).run();
      } catch {
        // Official response remains usable even when the shared cache write fails.
      }
    }
    return value;
  })().finally(() => { officialMonthInflight.delete(key); });
  officialMonthInflight.set(key, promise);
  return promise;
}

function weekdayDates(from: string, through: string) {
  const result: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = Date.parse(`${through}T00:00:00Z`);
  while (cursor.getTime() <= end) {
    if (![0, 6].includes(cursor.getUTCDay())) result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function boundedDates(values: string[]) {
  return [...new Set(values.filter(validSessionDate))].sort().slice(0, TAIWAN_CONTINUITY_MAX_DIAGNOSTIC_DATES);
}

export async function auditTaiwanDailyContinuity(input: {
  db?: D1Database;
  symbol: string;
  rows: HistoryCandle[];
  requiredRows: number;
  expectedThrough: string | null;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<TaiwanContinuityAudit> {
  const now = input.now ?? new Date();
  const normalizedRows = [...input.rows].sort((left, right) => left.time - right.time);
  const scopedRows = normalizedRows.slice(-Math.max(1, input.requiredRows));
  const checkedFrom = taiwanSessionDate(scopedRows[0]);
  const actualThrough = taiwanSessionDate(scopedRows.at(-1));
  const checkedThrough = input.expectedThrough || actualThrough;
  const base = { checkedFrom, checkedThrough, checkedAt: now.toISOString(), verifiedThrough: null, missingSessionCount: 0, missingSessionDates: [], excludedSessionDates: [], reasonCode: null };
  if (!/\.TW(?:O)?$/i.test(input.symbol) || !checkedFrom || !checkedThrough || checkedThrough < checkedFrom) {
    return { ...base, status: "unknown", reasonCode: "invalid_scope", repairRows: [], candidateMonths: [], officialRequests: 0 };
  }
  const existingDates = new Set(scopedRows.map(taiwanSessionDate).filter(validSessionDate));
  const candidateDates = weekdayDates(checkedFrom, checkedThrough).filter((date) => !existingDates.has(date));
  if (!candidateDates.length) {
    return { ...base, status: "complete", verifiedThrough: checkedThrough, repairRows: [], candidateMonths: [], officialRequests: 0 };
  }
  const allMonths = [...new Set(candidateDates.map((date) => date.slice(0, 7)))].sort();
  const requestBudget = { remaining: TAIWAN_CONTINUITY_MAX_MONTHS_PER_REQUEST, used: 0 };
  const official: TaiwanOfficialMonthResult[] = [];
  for (const month of allMonths) {
    const result = await fetchTaiwanOfficialMonth(input.symbol, month, {
      db: input.db,
      fetchImpl: input.fetchImpl,
      now,
      requestBudget,
    });
    official.push(result);
    if (result.reasonCode === "audit_request_budget") break;
  }
  const candidateMonths = official.map((result) => result.month);
  const officialRowsByDate = new Map<string, HistoryCandle>();
  const successfulMonths = new Set<string>();
  let failureReason: string | null = candidateMonths.length < allMonths.length ? "audit_request_budget" : null;
  for (const result of official) {
    if (result.status === "available") successfulMonths.add(result.month);
    else failureReason ||= result.status === "not_published" ? "reference_not_published" : result.reasonCode || "provider_unavailable";
    for (const row of result.rows) {
      const sessionDate = taiwanSessionDate(row);
      if (sessionDate) officialRowsByDate.set(sessionDate, row);
    }
  }
  const missingDates: string[] = [];
  const excludedDates: string[] = [];
  const repairRows: HistoryCandle[] = [];
  for (const date of candidateDates) {
    if (!candidateMonths.includes(date.slice(0, 7)) || !successfulMonths.has(date.slice(0, 7))) continue;
    const officialRow = officialRowsByDate.get(date);
    if (officialRow) {
      missingDates.push(date);
      repairRows.push(officialRow);
    } else {
      excludedDates.push(date);
    }
  }
  const status = missingDates.length ? "partial" as const : failureReason ? "unknown" as const : "complete" as const;
  return {
    ...base,
    status,
    verifiedThrough: status === "complete" ? checkedThrough : null,
    missingSessionCount: missingDates.length,
    missingSessionDates: boundedDates(missingDates),
    excludedSessionDates: boundedDates(excludedDates),
    reasonCode: missingDates.length ? "missing_traded_session" : failureReason,
    repairRows,
    candidateMonths,
    officialRequests: requestBudget.used,
  };
}

export function clearTaiwanDailyContinuityRuntimeState() {
  officialMonthMemory.clear();
  officialMonthInflight.clear();
}
