import type { Candle } from "./indicators";

export const CANDLE_HISTORY_WARMUP_ROWS = 120;
export const CANDLE_HISTORY_MAX_DISPLAY_ROWS = 1600;
export const CANDLE_HISTORY_WRITE_BATCH = 80;
export const CANDLE_HISTORY_DIAGNOSTIC_DATE_LIMIT = 32;
export const PERSISTENT_CANDLE_INTERVALS = new Set(["1d", "1wk", "1mo"]);

export type HistoryCandle = Candle & {
  sourceUpdatedAt?: string;
  source?: string;
};

export type CandleHistoryIdentity = {
  provider: string;
  symbol: string;
  interval: string;
};

export type CandleHistoryCacheState = "hit" | "miss" | "backfilled" | "refreshed" | "stale" | "disabled" | "write_failed";
export type CandleHistoryContinuityStatus = "complete" | "partial" | "unknown";

export type CandleHistoryContinuityMetadata = {
  status: CandleHistoryContinuityStatus;
  checkedFrom: string | null;
  checkedThrough: string | null;
  checkedAt: string | null;
  verifiedThrough: string | null;
  missingSessionCount: number;
  missingSessionDates: string[];
  excludedSessionDates: string[];
  reasonCode: string | null;
};

export type CandleHistoryCacheMetadata = {
  store: "d1" | "worker-memory";
  state: CandleHistoryCacheState;
  source: string;
  historyStore: "candle_history" | "worker-memory";
  persistent: boolean;
  rows: number;
  tailRefresh?: "success" | "failed" | "not_needed";
  fullWindowComplete?: boolean;
  continuity?: CandleHistoryContinuityMetadata;
  reason?: "d1_unavailable" | "provider_unavailable" | "cache_invalidation_failed";
};

export type AcquiredCandleHistory = {
  rows: HistoryCandle[];
  provider: string;
  freshness: "fresh" | "stale";
  cache: CandleHistoryCacheMetadata;
};

type CandleHistoryRow = {
  provider: string;
  symbol: string;
  interval: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quote_time: number | null;
  source: string;
  source_updated_at: string | null;
  market_session: string | null;
  source_time_zone: string | null;
  fetched_at: string;
};

type CandleHistoryStateRow = {
  full_window_complete?: number | null;
  coverage_start?: number | null;
  coverage_end?: number | null;
  available_rows?: number | null;
  last_full_fetch_at?: string | null;
  last_tail_fetch_at?: string | null;
  continuity_status?: string | null;
  continuity_from?: string | null;
  continuity_through?: string | null;
  continuity_checked_at?: string | null;
  missing_session_count?: number | null;
  missing_session_dates_json?: string | null;
  excluded_session_dates_json?: string | null;
  continuity_reason_code?: string | null;
};

export type CandleHistoryState = {
  fullWindowComplete: boolean;
  coverageStart: number | null;
  coverageEnd: number | null;
  availableRows: number;
  lastFullFetchAt: string | null;
  lastTailFetchAt: string | null;
  continuity: CandleHistoryContinuityMetadata;
};

type MemoryHistoryEntry = {
  rows: HistoryCandle[];
  provider: string;
  fetchedAt: number;
  continuity?: CandleHistoryContinuityMetadata;
};

type InflightHistoryEntry<T> = {
  requiredRows: number;
  promise: Promise<T>;
};

const memoryHistory = new Map<string, MemoryHistoryEntry>();
const historyInflight = new Map<string, InflightHistoryEntry<AcquiredCandleHistory>>();
const CANDLE_HISTORY_MEMORY_CONTRACT_VERSION = "daily-continuity-v2";

function validSessionDate(value: unknown): value is string {
  const text = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`));
}

function boundedSessionDates(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.filter(validSessionDate))].sort().slice(0, CANDLE_HISTORY_DIAGNOSTIC_DATE_LIMIT);
}

function parseSessionDatesJson(value: unknown) {
  if (typeof value !== "string") return { dates: [] as string[], valid: value == null };
  try {
    const parsed = JSON.parse(value);
    return { dates: boundedSessionDates(parsed), valid: Array.isArray(parsed) };
  } catch {
    return { dates: [] as string[], valid: false };
  }
}

function normalizeContinuityMetadata(value?: Partial<CandleHistoryContinuityMetadata> | null): CandleHistoryContinuityMetadata {
  const status = ["complete", "partial", "unknown"].includes(String(value?.status))
    ? value!.status as CandleHistoryContinuityStatus
    : "unknown";
  const checkedFrom = validSessionDate(value?.checkedFrom) ? value!.checkedFrom! : null;
  const checkedThrough = validSessionDate(value?.checkedThrough) ? value!.checkedThrough! : null;
  const missingSessionDates = boundedSessionDates(value?.missingSessionDates);
  const excludedSessionDates = boundedSessionDates(value?.excludedSessionDates);
  const missingSessionCount = Math.max(missingSessionDates.length, Math.max(0, Math.floor(Number(value?.missingSessionCount) || 0)));
  return {
    status,
    checkedFrom,
    checkedThrough,
    checkedAt: value?.checkedAt && Number.isFinite(Date.parse(value.checkedAt)) ? value.checkedAt : null,
    verifiedThrough: status === "complete" && checkedThrough ? checkedThrough : validSessionDate(value?.verifiedThrough) ? value!.verifiedThrough! : null,
    missingSessionCount,
    missingSessionDates,
    excludedSessionDates,
    reasonCode: value?.reasonCode ? String(value.reasonCode).slice(0, 80) : null,
  };
}

function continuityMetadataChanged(
  current: CandleHistoryContinuityMetadata,
  previous?: CandleHistoryContinuityMetadata | null,
) {
  return JSON.stringify(current) !== JSON.stringify(normalizeContinuityMetadata(previous));
}

function normalizedProvider(provider: string) {
  return provider === "yahoo-chart" ? "yfinance" : String(provider || "").trim().toLowerCase();
}

export function candleHistoryIdentity(provider: string, symbol: string, interval: string): CandleHistoryIdentity {
  return {
    provider: normalizedProvider(provider),
    symbol: String(symbol || "").trim().toUpperCase(),
    interval: String(interval || "").trim(),
  };
}

export function candleHistoryKey(provider: string, symbol: string, interval: string) {
  const identity = candleHistoryIdentity(provider, symbol, interval);
  return `${identity.provider}|${identity.symbol}|${identity.interval}`;
}

export function shouldPersistCandleHistory(provider: string, interval: string) {
  return normalizedProvider(provider).startsWith("yfinance") && PERSISTENT_CANDLE_INTERVALS.has(interval);
}

export function candleHistoryTtlSeconds(interval: string) {
  return {
    "1m": 30,
    "3m": 30,
    "5m": 30,
    "15m": 120,
    "30m": 120,
    "1h": 300,
    "4h": 300,
    "1d": 900,
    "1wk": 3600,
    "1mo": 21600,
  }[interval] ?? 300;
}

export function requestedDisplayRows(displayCount: number) {
  return Math.max(1, Math.min(Number.isFinite(displayCount) ? Math.floor(displayCount) : 160, CANDLE_HISTORY_MAX_DISPLAY_ROWS));
}

export function requiredCandleHistoryRows(symbol: string, interval: string, displayCount: number) {
  const taiwanDailyBuffer = interval === "1d" && /\.(TW|TWO)$/i.test(symbol) ? 5 : 0;
  return requestedDisplayRows(displayCount) + CANDLE_HISTORY_WARMUP_ROWS + taiwanDailyBuffer;
}

export function isStructurallyValidCandle(
  row: Partial<HistoryCandle> | null | undefined,
): row is HistoryCandle {
  if (!row) return false;
  const values = [row.time, row.open, row.high, row.low, row.close, row.volume];
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) return false;
  if (row.time! <= 0 || row.volume! < 0) return false;
  if ([row.open, row.high, row.low, row.close].every((value) => value === 0)) return false;
  const scale = Math.max(1, Math.abs(row.open!), Math.abs(row.high!), Math.abs(row.low!), Math.abs(row.close!));
  // Yahoo 的外匯日線偶爾會有極小的 OHLC rounding 差異；容許 0.1%，
  // 但仍拒絕像 0050／0056 開高低為 0、收盤價有效的巨大異常棒。
  const epsilon = scale * 0.001;
  return row.high! + epsilon >= Math.max(row.open!, row.close!)
    && row.low! - epsilon <= Math.min(row.open!, row.close!)
    && row.high! + epsilon >= row.low!;
}

function normalizeHistoryCandle(row: HistoryCandle): HistoryCandle | null {
  if (!isStructurallyValidCandle(row)) return null;
  const normalized: HistoryCandle = {
    time: row.time,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
  };
  if (Number.isFinite(Number(row.quoteTime))) normalized.quoteTime = Number(row.quoteTime);
  if (row.marketSession) normalized.marketSession = String(row.marketSession);
  if (row.sourceTimeZone) normalized.sourceTimeZone = String(row.sourceTimeZone);
  if (row.sourceUpdatedAt) normalized.sourceUpdatedAt = String(row.sourceUpdatedAt);
  if (row.source) normalized.source = String(row.source);
  return normalized;
}

export function mergeCandleHistory(existing: HistoryCandle[] = [], incoming: HistoryCandle[] = []) {
  const byTime = new Map<number, HistoryCandle>();
  const sourceRank = (row: HistoryCandle | undefined) => {
    const source = String(row?.source || "").toLowerCase();
    if (/^(?:twse|tpex)-official$/.test(source)) return 2;
    if (source === "twse-mis") return 1;
    return 0;
  };
  for (const row of [...existing, ...incoming]) {
    const normalized = normalizeHistoryCandle(row);
    if (normalized) {
      const current = byTime.get(normalized.time);
      if (!current || sourceRank(normalized) >= sourceRank(current)) byTime.set(normalized.time, normalized);
    }
  }
  return [...byTime.values()].sort((left, right) => left.time - right.time);
}

function candleHistoryRowMatches(left: HistoryCandle, right: HistoryCandle) {
  return left.time === right.time
    && left.open === right.open
    && left.high === right.high
    && left.low === right.low
    && left.close === right.close
    && left.volume === right.volume
    && (left.quoteTime ?? null) === (right.quoteTime ?? null)
    && (left.marketSession ?? null) === (right.marketSession ?? null)
    && (left.sourceTimeZone ?? null) === (right.sourceTimeZone ?? null)
    && (left.sourceUpdatedAt ?? null) === (right.sourceUpdatedAt ?? null);
}

export function changedCandleHistoryTail(existing: HistoryCandle[] = [], incoming: HistoryCandle[] = []) {
  const normalizedExisting = mergeCandleHistory([], existing);
  const normalizedIncoming = mergeCandleHistory([], incoming);
  if (!normalizedIncoming.length) return [];
  const existingByTime = new Map(normalizedExisting.map((row) => [row.time, row]));
  const changed = normalizedIncoming.filter((row) => {
    const current = existingByTime.get(row.time);
    return !current || !candleHistoryRowMatches(current, row);
  });
  const newest = normalizedIncoming.at(-1)!;
  if (!changed.some((row) => row.time === newest.time)) changed.push(newest);
  return changed.sort((left, right) => left.time - right.time);
}

function rowToCandle(row: CandleHistoryRow): HistoryCandle | null {
  return normalizeHistoryCandle({
    time: Number(row.time),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
    ...(row.quote_time == null ? {} : { quoteTime: Number(row.quote_time) }),
    ...(row.market_session ? { marketSession: row.market_session } : {}),
    ...(row.source_time_zone ? { sourceTimeZone: row.source_time_zone } : {}),
    ...(row.source_updated_at ? { sourceUpdatedAt: row.source_updated_at } : {}),
    ...(row.source ? { source: row.source } : {}),
  });
}

export async function readCandleHistory(db: D1Database | undefined, identity: CandleHistoryIdentity, limit: number) {
  if (!db) return { ok: false as const, rows: [] as HistoryCandle[], fetchedAt: 0, reason: "d1_unavailable" as const };
  try {
    const result = await db.prepare(`SELECT provider,symbol,interval,time,open,high,low,close,volume,quote_time,source,source_updated_at,market_session,source_time_zone,fetched_at
      FROM candle_history WHERE provider=? AND symbol=? AND interval=? ORDER BY time DESC LIMIT ?`)
      .bind(identity.provider, identity.symbol, identity.interval, Math.max(1, limit)).all<CandleHistoryRow>();
    const rows = result.results.map(rowToCandle).filter((row): row is HistoryCandle => Boolean(row)).reverse();
    const fetchedAt = result.results.reduce((latest, row) => Math.max(latest, Date.parse(row.fetched_at || "") / 1000 || 0), 0);
    return { ok: true as const, rows, fetchedAt };
  } catch {
    return { ok: false as const, rows: [] as HistoryCandle[], fetchedAt: 0, reason: "d1_unavailable" as const };
  }
}

function candleHistoryStateFromRow(row: CandleHistoryStateRow): CandleHistoryState {
  const missing = parseSessionDatesJson(row.missing_session_dates_json);
  const excluded = parseSessionDatesJson(row.excluded_session_dates_json);
  const parsedStatus = ["complete", "partial", "unknown"].includes(String(row.continuity_status))
    ? row.continuity_status as CandleHistoryContinuityStatus
    : "unknown";
  const continuity = normalizeContinuityMetadata({
    status: missing.valid && excluded.valid ? parsedStatus : "unknown",
    checkedFrom: row.continuity_from,
    checkedThrough: row.continuity_through,
    checkedAt: row.continuity_checked_at,
    missingSessionCount: Number(row.missing_session_count || 0),
    missingSessionDates: missing.dates,
    excludedSessionDates: excluded.dates,
    reasonCode: missing.valid && excluded.valid ? row.continuity_reason_code : "invalid_state_json",
  });
  return {
    fullWindowComplete: Number(row.full_window_complete || 0) === 1 && continuity.status === "complete",
    coverageStart: row.coverage_start == null ? null : Number(row.coverage_start),
    coverageEnd: row.coverage_end == null ? null : Number(row.coverage_end),
    availableRows: Number(row.available_rows || 0),
    lastFullFetchAt: row.last_full_fetch_at || null,
    lastTailFetchAt: row.last_tail_fetch_at || null,
    continuity,
  };
}

export async function readCandleHistoryState(db: D1Database | undefined, identity: CandleHistoryIdentity): Promise<CandleHistoryState | null> {
  if (!db) return null;
  try {
    const row = await db.prepare(`SELECT full_window_complete,coverage_start,coverage_end,available_rows,last_full_fetch_at,last_tail_fetch_at,
      continuity_status,continuity_from,continuity_through,continuity_checked_at,missing_session_count,missing_session_dates_json,excluded_session_dates_json,continuity_reason_code
      FROM candle_history_state WHERE provider=? AND symbol=? AND interval=?`)
      .bind(identity.provider, identity.symbol, identity.interval).first<CandleHistoryStateRow>();
    if (!row) return null;
    return candleHistoryStateFromRow(row);
  } catch {
    try {
      const legacy = await db.prepare(`SELECT full_window_complete,coverage_start,coverage_end,available_rows,last_full_fetch_at,last_tail_fetch_at
        FROM candle_history_state WHERE provider=? AND symbol=? AND interval=?`)
        .bind(identity.provider, identity.symbol, identity.interval).first<CandleHistoryStateRow>();
      if (!legacy) return null;
      return candleHistoryStateFromRow({ ...legacy, full_window_complete: 0, continuity_status: "unknown", continuity_reason_code: "continuity_not_migrated" });
    } catch {
      return null;
    }
  }
}

async function saveCandleHistoryState(
  db: D1Database | undefined,
  identity: CandleHistoryIdentity,
  rows: HistoryCandle[],
  mode: "full" | "tail" | "audit",
  previous: CandleHistoryState | null,
  now: Date,
  continuity?: CandleHistoryContinuityMetadata,
) {
  if (!db) return false;
  const normalized = mergeCandleHistory([], rows);
  const nowText = now.toISOString();
  const normalizedContinuity = normalizeContinuityMetadata(continuity);
  const isTaiwanDaily = identity.interval === "1d" && /\.(TW|TWO)$/i.test(identity.symbol);
  const fullWindowComplete = isTaiwanDaily
    ? normalizedContinuity.status === "complete"
    : mode === "full" || Boolean(previous?.fullWindowComplete);
  try {
    await db.prepare(`INSERT INTO candle_history_state
      (provider,symbol,interval,full_window_complete,coverage_start,coverage_end,available_rows,status,reason_code,last_full_fetch_at,last_tail_fetch_at,
       continuity_status,continuity_from,continuity_through,continuity_checked_at,missing_session_count,missing_session_dates_json,excluded_session_dates_json,continuity_reason_code,retry_after)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)
      ON CONFLICT(provider,symbol,interval) DO UPDATE SET
        full_window_complete=excluded.full_window_complete,
        coverage_start=CASE WHEN candle_history_state.coverage_start IS NULL OR excluded.coverage_start<candle_history_state.coverage_start THEN excluded.coverage_start ELSE candle_history_state.coverage_start END,
        coverage_end=CASE WHEN candle_history_state.coverage_end IS NULL OR excluded.coverage_end>candle_history_state.coverage_end THEN excluded.coverage_end ELSE candle_history_state.coverage_end END,
        available_rows=MAX(candle_history_state.available_rows,excluded.available_rows),status=excluded.status,reason_code=excluded.reason_code,
        last_full_fetch_at=COALESCE(excluded.last_full_fetch_at,candle_history_state.last_full_fetch_at),
        last_tail_fetch_at=COALESCE(excluded.last_tail_fetch_at,candle_history_state.last_tail_fetch_at),
        continuity_status=excluded.continuity_status,continuity_from=excluded.continuity_from,continuity_through=excluded.continuity_through,
        continuity_checked_at=excluded.continuity_checked_at,missing_session_count=excluded.missing_session_count,
        missing_session_dates_json=excluded.missing_session_dates_json,excluded_session_dates_json=excluded.excluded_session_dates_json,
        continuity_reason_code=excluded.continuity_reason_code,retry_after=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(
        identity.provider, identity.symbol, identity.interval,
        fullWindowComplete ? 1 : 0,
        normalized[0]?.time ?? null, normalized.at(-1)?.time ?? null, normalized.length,
        normalizedContinuity.status === "complete" || !isTaiwanDaily ? "complete" : normalizedContinuity.status,
        normalizedContinuity.reasonCode || (normalizedContinuity.status === "complete" || !isTaiwanDaily ? "ok" : "continuity_unverified"),
        mode === "full" ? nowText : null, mode === "tail" ? nowText : null,
        isTaiwanDaily ? normalizedContinuity.status : "complete",
        isTaiwanDaily ? normalizedContinuity.checkedFrom : null,
        isTaiwanDaily ? normalizedContinuity.checkedThrough : null,
        isTaiwanDaily ? normalizedContinuity.checkedAt : nowText,
        isTaiwanDaily ? normalizedContinuity.missingSessionCount : 0,
        JSON.stringify(isTaiwanDaily ? normalizedContinuity.missingSessionDates : []),
        JSON.stringify(isTaiwanDaily ? normalizedContinuity.excludedSessionDates : []),
        isTaiwanDaily ? normalizedContinuity.reasonCode : null,
      ).run();
    return true;
  } catch {
    return false;
  }
}

export async function upsertCandleHistory(
  db: D1Database | undefined,
  identity: CandleHistoryIdentity,
  rows: HistoryCandle[],
  source: string,
  now = new Date(),
) {
  if (!db || !shouldPersistCandleHistory(identity.provider, identity.interval)) {
    return { ok: false as const, rows: 0, reason: "d1_unavailable" as const };
  }
  const normalizedRows = mergeCandleHistory([], rows);
  const fetchedAt = now.toISOString();
  try {
    for (let index = 0; index < normalizedRows.length; index += CANDLE_HISTORY_WRITE_BATCH) {
      const statements = normalizedRows.slice(index, index + CANDLE_HISTORY_WRITE_BATCH).map((row) => db.prepare(`INSERT INTO candle_history
        (provider,symbol,interval,time,open,high,low,close,volume,quote_time,source,source_updated_at,market_session,source_time_zone,fetched_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(provider,symbol,interval,time) DO UPDATE SET open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume,quote_time=excluded.quote_time,source=excluded.source,source_updated_at=excluded.source_updated_at,market_session=excluded.market_session,source_time_zone=excluded.source_time_zone,fetched_at=excluded.fetched_at,updated_at=CURRENT_TIMESTAMP`)
        .bind(identity.provider, identity.symbol, identity.interval, row.time, row.open, row.high, row.low, row.close, row.volume, row.quoteTime ?? null, row.source || source, row.sourceUpdatedAt ?? null, row.marketSession ?? null, row.sourceTimeZone ?? null, fetchedAt));
      await db.batch(statements);
    }
    return { ok: true as const, rows: normalizedRows.length };
  } catch {
    return { ok: false as const, rows: 0, reason: "d1_unavailable" as const };
  }
}

function memoryEntry(key: string) {
  const entry = memoryHistory.get(key);
  return entry ? { ...entry, rows: mergeCandleHistory([], entry.rows) } : undefined;
}

function writeMemoryEntry(key: string, rows: HistoryCandle[], provider: string, fetchedAt: number, continuity?: CandleHistoryContinuityMetadata) {
  memoryHistory.set(key, { rows: mergeCandleHistory([], rows), provider, fetchedAt, ...(continuity ? { continuity: normalizeContinuityMetadata(continuity) } : {}) });
}

export function clearCandleHistoryRuntimeState() {
  memoryHistory.clear();
  historyInflight.clear();
}

export async function withCandleHistorySingleFlight<T>(
  inflight: Map<string, InflightHistoryEntry<T>>,
  key: string,
  requiredRows: number,
  task: (maximumRequiredRows: () => number) => Promise<T>,
) {
  const existing = inflight.get(key);
  if (existing) {
    existing.requiredRows = Math.max(existing.requiredRows, requiredRows);
    return existing.promise;
  }
  const entry: InflightHistoryEntry<T> = { requiredRows, promise: Promise.resolve(null as T) };
  entry.promise = Promise.resolve()
    .then(() => task(() => entry.requiredRows))
    .finally(() => { if (inflight.get(key) === entry) inflight.delete(key); });
  inflight.set(key, entry);
  return entry.promise;
}

export type CandleHistoryFetchRequest = {
  mode: "full" | "tail";
  requiredRows: number;
  startTime?: number;
};

export type CandleHistoryFetchResult = {
  rows: HistoryCandle[];
  source: string;
};

export type CandleHistoryContinuityAuditResult = CandleHistoryContinuityMetadata & {
  repairRows?: HistoryCandle[];
};

export async function acquireCandleHistory(options: {
  db?: D1Database;
  provider: string;
  symbol: string;
  interval: string;
  displayCount: number;
  fetcher: (request: CandleHistoryFetchRequest) => Promise<CandleHistoryFetchResult>;
  coverageComplete?: (rows: HistoryCandle[]) => boolean;
  continuityAudit?: (rows: HistoryCandle[], requiredRows: number) => Promise<CandleHistoryContinuityAuditResult>;
  invalidatePayloadCache?: () => Promise<boolean>;
  now?: Date;
}): Promise<AcquiredCandleHistory> {
  const identity = candleHistoryIdentity(options.provider, options.symbol, options.interval);
  const key = `${CANDLE_HISTORY_MEMORY_CONTRACT_VERSION}|${candleHistoryKey(identity.provider, identity.symbol, identity.interval)}`;
  const requestedRows = requiredCandleHistoryRows(identity.symbol, identity.interval, options.displayCount);
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const ttl = candleHistoryTtlSeconds(identity.interval);
  const persistent = shouldPersistCandleHistory(identity.provider, identity.interval) && Boolean(options.db);
  const currentMemory = memoryEntry(key);
  if (currentMemory && currentMemory.rows.length >= requestedRows && nowSeconds - currentMemory.fetchedAt <= ttl
    && (!options.continuityAudit || currentMemory.continuity?.status === "complete")) {
    return {
      rows: currentMemory.rows,
      provider: currentMemory.provider,
      freshness: "fresh",
      cache: { store: "worker-memory", state: "hit", source: currentMemory.provider, historyStore: "worker-memory", persistent, rows: currentMemory.rows.length, tailRefresh: "not_needed", ...(currentMemory.continuity ? { continuity: currentMemory.continuity, fullWindowComplete: currentMemory.continuity.status === "complete" } : {}) },
    };
  }

  return withCandleHistorySingleFlight(historyInflight, key, requestedRows, async (maximumRequiredRows) => {
    await Promise.resolve();
    const requiredRows = maximumRequiredRows();
    const latestMemory = memoryEntry(key);
    const [persisted, historyState] = persistent
      ? await Promise.all([readCandleHistory(options.db, identity, requiredRows), readCandleHistoryState(options.db, identity)])
      : [{ ok: false as const, rows: [] as HistoryCandle[], fetchedAt: 0, reason: "d1_unavailable" as const }, null] as const;
    const existingRows = mergeCandleHistory(persisted.rows, latestMemory?.rows ?? []);
    const existingFetchedAt = Math.max(persisted.fetchedAt, latestMemory?.fetchedAt ?? 0);
    const continuityAudit = options.continuityAudit
      ? await options.continuityAudit(existingRows, requiredRows)
      : historyState?.continuity;
    const continuity = continuityAudit ? normalizeContinuityMetadata(continuityAudit) : undefined;
    const continuityComplete = !options.continuityAudit || continuity?.status === "complete";
    const enoughHistory = (existingRows.length >= requiredRows || Boolean(historyState?.fullWindowComplete)) && continuityComplete;
    const stableCoverageComplete = Boolean(enoughHistory && options.coverageComplete?.(existingRows));
    if (enoughHistory && (nowSeconds - existingFetchedAt <= ttl || stableCoverageComplete)) {
      if (persistent && continuity && continuityMetadataChanged(continuity, historyState?.continuity)) {
        await saveCandleHistoryState(options.db, identity, existingRows, "audit", historyState, options.now ?? new Date(), continuity);
      }
      writeMemoryEntry(key, existingRows, identity.provider, existingFetchedAt, continuity);
      return {
        rows: existingRows,
        provider: identity.provider,
        freshness: "fresh",
        cache: { store: persisted.ok ? "d1" : "worker-memory", state: "hit", source: identity.provider, historyStore: persisted.ok ? "candle_history" : "worker-memory", persistent, rows: existingRows.length, tailRefresh: "not_needed", fullWindowComplete: continuityComplete && Boolean(historyState?.fullWindowComplete || continuity?.status === "complete"), ...(continuity ? { continuity } : {}) },
      };
    }

    const mode = enoughHistory ? "tail" : "full";
    try {
      const earliestMissing = continuity?.missingSessionDates?.[0];
      const startTime = earliestMissing ? Math.floor(Date.parse(`${earliestMissing}T00:00:00Z`) / 1000) - 7 * 86400 : undefined;
      const fetched = await options.fetcher({ mode, requiredRows, ...(startTime ? { startTime } : {}) });
      let merged = mergeCandleHistory(existingRows, fetched.rows);
      if (!merged.length) throw new Error("provider_unavailable");
      let finalAudit = options.continuityAudit ? await options.continuityAudit(merged, requiredRows) : continuity;
      const officialRepairRows = finalAudit?.repairRows ?? [];
      if (officialRepairRows.length) {
        merged = mergeCandleHistory(merged, officialRepairRows);
        finalAudit = options.continuityAudit ? await options.continuityAudit(merged, requiredRows) : finalAudit;
      }
      const finalContinuity = finalAudit ? normalizeContinuityMetadata(finalAudit) : undefined;
      let state: CandleHistoryCacheState = existingRows.length ? (mode === "tail" ? "refreshed" : "backfilled") : "backfilled";
      let reason: CandleHistoryCacheMetadata["reason"];
      if (persistent) {
        const writeRows = changedCandleHistoryTail(existingRows, [...fetched.rows, ...officialRepairRows]);
        const write = await upsertCandleHistory(options.db, identity, writeRows, fetched.source, options.now ?? new Date());
        if (!write.ok) { state = "write_failed"; reason = "d1_unavailable"; }
        else {
          await saveCandleHistoryState(options.db, identity, merged, mode, historyState, options.now ?? new Date(), finalContinuity);
          if (writeRows.length && options.invalidatePayloadCache && !(await options.invalidatePayloadCache())) {
            state = "write_failed";
            reason = "cache_invalidation_failed";
          }
        }
      }
      writeMemoryEntry(key, merged, fetched.source, nowSeconds, finalContinuity);
      return {
        rows: merged,
        provider: fetched.source,
        freshness: "fresh",
        cache: {
          store: persistent ? "d1" : "worker-memory",
          state,
          source: fetched.source,
          historyStore: persistent ? "candle_history" : "worker-memory",
          persistent,
          rows: merged.length,
          tailRefresh: mode === "tail" ? "success" : "not_needed",
          fullWindowComplete: options.continuityAudit ? finalContinuity?.status === "complete" : mode === "full" || Boolean(historyState?.fullWindowComplete),
          ...(finalContinuity ? { continuity: normalizeContinuityMetadata(finalContinuity) } : {}),
          ...(reason ? { reason } : {}),
        },
      };
    } catch {
      if (!existingRows.length) throw new Error("provider_unavailable");
      writeMemoryEntry(key, existingRows, identity.provider, existingFetchedAt || nowSeconds - ttl - 1, continuity);
      return {
        rows: existingRows,
        provider: identity.provider,
        freshness: "stale",
        cache: { store: persisted.ok ? "d1" : "worker-memory", state: "stale", source: identity.provider, historyStore: persisted.ok ? "candle_history" : "worker-memory", persistent, rows: existingRows.length, tailRefresh: "failed", reason: "provider_unavailable", ...(continuity ? { continuity: normalizeContinuityMetadata(continuity), fullWindowComplete: continuity.status === "complete" } : {}) },
      };
    }
  });
}
