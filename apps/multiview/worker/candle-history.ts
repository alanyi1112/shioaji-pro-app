import type { Candle } from "./indicators";

export const CANDLE_HISTORY_WARMUP_ROWS = 120;
export const CANDLE_HISTORY_MAX_DISPLAY_ROWS = 1600;
export const CANDLE_HISTORY_WRITE_BATCH = 80;
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

export type CandleHistoryCacheMetadata = {
  store: "d1" | "worker-memory";
  state: CandleHistoryCacheState;
  source: string;
  historyStore: "candle_history" | "worker-memory";
  persistent: boolean;
  rows: number;
  tailRefresh?: "success" | "failed" | "not_needed";
  fullWindowComplete?: boolean;
  reason?: "d1_unavailable" | "provider_unavailable";
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
};

type CandleHistoryState = {
  fullWindowComplete: boolean;
  coverageStart: number | null;
  coverageEnd: number | null;
  availableRows: number;
  lastFullFetchAt: string | null;
  lastTailFetchAt: string | null;
};

type MemoryHistoryEntry = {
  rows: HistoryCandle[];
  provider: string;
  fetchedAt: number;
};

type InflightHistoryEntry<T> = {
  requiredRows: number;
  promise: Promise<T>;
};

const memoryHistory = new Map<string, MemoryHistoryEntry>();
const historyInflight = new Map<string, InflightHistoryEntry<AcquiredCandleHistory>>();

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

function normalizeHistoryCandle(row: HistoryCandle): HistoryCandle | null {
  const values = [row.time, row.open, row.high, row.low, row.close, row.volume];
  if (values.some((value) => !Number.isFinite(Number(value)))) return null;
  const normalized: HistoryCandle = {
    time: Number(row.time),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
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

async function readCandleHistoryState(db: D1Database | undefined, identity: CandleHistoryIdentity): Promise<CandleHistoryState | null> {
  if (!db) return null;
  try {
    const row = await db.prepare(`SELECT full_window_complete,coverage_start,coverage_end,available_rows,last_full_fetch_at,last_tail_fetch_at
      FROM candle_history_state WHERE provider=? AND symbol=? AND interval=?`)
      .bind(identity.provider, identity.symbol, identity.interval).first<CandleHistoryStateRow>();
    if (!row) return null;
    return {
      fullWindowComplete: Number(row.full_window_complete || 0) === 1,
      coverageStart: row.coverage_start == null ? null : Number(row.coverage_start),
      coverageEnd: row.coverage_end == null ? null : Number(row.coverage_end),
      availableRows: Number(row.available_rows || 0),
      lastFullFetchAt: row.last_full_fetch_at || null,
      lastTailFetchAt: row.last_tail_fetch_at || null,
    };
  } catch {
    return null;
  }
}

async function saveCandleHistoryState(
  db: D1Database | undefined,
  identity: CandleHistoryIdentity,
  rows: HistoryCandle[],
  mode: "full" | "tail",
  previous: CandleHistoryState | null,
  now: Date,
) {
  if (!db) return false;
  const normalized = mergeCandleHistory([], rows);
  const nowText = now.toISOString();
  try {
    await db.prepare(`INSERT INTO candle_history_state
      (provider,symbol,interval,full_window_complete,coverage_start,coverage_end,available_rows,status,reason_code,last_full_fetch_at,last_tail_fetch_at,retry_after)
      VALUES (?,?,?,?,?,?,?,'complete','ok',?,?,NULL)
      ON CONFLICT(provider,symbol,interval) DO UPDATE SET
        full_window_complete=MAX(candle_history_state.full_window_complete,excluded.full_window_complete),
        coverage_start=CASE WHEN candle_history_state.coverage_start IS NULL OR excluded.coverage_start<candle_history_state.coverage_start THEN excluded.coverage_start ELSE candle_history_state.coverage_start END,
        coverage_end=CASE WHEN candle_history_state.coverage_end IS NULL OR excluded.coverage_end>candle_history_state.coverage_end THEN excluded.coverage_end ELSE candle_history_state.coverage_end END,
        available_rows=MAX(candle_history_state.available_rows,excluded.available_rows),status='complete',reason_code='ok',
        last_full_fetch_at=COALESCE(excluded.last_full_fetch_at,candle_history_state.last_full_fetch_at),
        last_tail_fetch_at=COALESCE(excluded.last_tail_fetch_at,candle_history_state.last_tail_fetch_at),retry_after=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(
        identity.provider, identity.symbol, identity.interval,
        mode === "full" || previous?.fullWindowComplete ? 1 : 0,
        normalized[0]?.time ?? null, normalized.at(-1)?.time ?? null, normalized.length,
        mode === "full" ? nowText : null, mode === "tail" ? nowText : null,
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

function writeMemoryEntry(key: string, rows: HistoryCandle[], provider: string, fetchedAt: number) {
  memoryHistory.set(key, { rows: mergeCandleHistory([], rows), provider, fetchedAt });
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
};

export type CandleHistoryFetchResult = {
  rows: HistoryCandle[];
  source: string;
};

export async function acquireCandleHistory(options: {
  db?: D1Database;
  provider: string;
  symbol: string;
  interval: string;
  displayCount: number;
  fetcher: (request: CandleHistoryFetchRequest) => Promise<CandleHistoryFetchResult>;
  coverageComplete?: (rows: HistoryCandle[]) => boolean;
  now?: Date;
}): Promise<AcquiredCandleHistory> {
  const identity = candleHistoryIdentity(options.provider, options.symbol, options.interval);
  const key = candleHistoryKey(identity.provider, identity.symbol, identity.interval);
  const requestedRows = requiredCandleHistoryRows(identity.symbol, identity.interval, options.displayCount);
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const ttl = candleHistoryTtlSeconds(identity.interval);
  const persistent = shouldPersistCandleHistory(identity.provider, identity.interval) && Boolean(options.db);
  const currentMemory = memoryEntry(key);
  if (currentMemory && currentMemory.rows.length >= requestedRows && nowSeconds - currentMemory.fetchedAt <= ttl) {
    return {
      rows: currentMemory.rows,
      provider: currentMemory.provider,
      freshness: "fresh",
      cache: { store: "worker-memory", state: "hit", source: currentMemory.provider, historyStore: "worker-memory", persistent, rows: currentMemory.rows.length, tailRefresh: "not_needed" },
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
    const enoughHistory = existingRows.length >= requiredRows || Boolean(historyState?.fullWindowComplete);
    const stableCoverageComplete = Boolean(historyState?.fullWindowComplete && options.coverageComplete?.(existingRows));
    if (enoughHistory && (nowSeconds - existingFetchedAt <= ttl || stableCoverageComplete)) {
      writeMemoryEntry(key, existingRows, identity.provider, existingFetchedAt);
      return {
        rows: existingRows,
        provider: identity.provider,
        freshness: "fresh",
        cache: { store: persisted.ok ? "d1" : "worker-memory", state: "hit", source: identity.provider, historyStore: persisted.ok ? "candle_history" : "worker-memory", persistent, rows: existingRows.length, tailRefresh: "not_needed", fullWindowComplete: Boolean(historyState?.fullWindowComplete) },
      };
    }

    const mode = enoughHistory ? "tail" : "full";
    try {
      const fetched = await options.fetcher({ mode, requiredRows });
      const merged = mergeCandleHistory(existingRows, fetched.rows);
      if (!merged.length) throw new Error("provider_unavailable");
      let state: CandleHistoryCacheState = existingRows.length ? (mode === "tail" ? "refreshed" : "backfilled") : "backfilled";
      let reason: CandleHistoryCacheMetadata["reason"];
      if (persistent) {
        const writeRows = changedCandleHistoryTail(existingRows, fetched.rows);
        const write = await upsertCandleHistory(options.db, identity, writeRows, fetched.source, options.now ?? new Date());
        if (!write.ok) { state = "write_failed"; reason = "d1_unavailable"; }
        else await saveCandleHistoryState(options.db, identity, merged, mode, historyState, options.now ?? new Date());
      }
      writeMemoryEntry(key, merged, fetched.source, nowSeconds);
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
          fullWindowComplete: mode === "full" || Boolean(historyState?.fullWindowComplete),
          ...(reason ? { reason } : {}),
        },
      };
    } catch {
      if (!existingRows.length) throw new Error("provider_unavailable");
      writeMemoryEntry(key, existingRows, identity.provider, existingFetchedAt || nowSeconds - ttl - 1);
      return {
        rows: existingRows,
        provider: identity.provider,
        freshness: "stale",
        cache: { store: persisted.ok ? "d1" : "worker-memory", state: "stale", source: identity.provider, historyStore: persisted.ok ? "candle_history" : "worker-memory", persistent, rows: existingRows.length, tailRefresh: "failed", reason: "provider_unavailable" },
      };
    }
  });
}
