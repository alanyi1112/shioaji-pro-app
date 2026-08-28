import { computeIndicators, type Candle, type IndicatorParameters } from "./indicators";
import { inferTaiwanMarketPhase, inferUnitedStatesMarketPhase, type MarketPhase } from "./market-phase";
import { isStructurallyValidCandle, type CandleHistoryCacheMetadata, type HistoryCandle } from "./candle-history";
import { buildTraditionalPivotIndicator, pivotReferenceInterval, referencePeriodKey, type PivotMode } from "./pivot-points";
import { isTaiwanRegularStockSymbol, normalizeTaiwanStockCandleRows } from "./taiwan-stock-volume";

const INTERVAL_SECONDS: Record<string, number> = { "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400, "1wk": 604800, "1mo": 2592000 };
const YAHOO_RANGE: Record<string, string> = { "1m": "1d", "3m": "5d", "5m": "5d", "15m": "5d", "30m": "1mo", "1h": "3mo", "4h": "1y", "1d": "2y", "1wk": "10y", "1mo": "25y" };
const YAHOO_TAIL_RANGE: Record<string, string> = { "1d": "5d", "1wk": "3mo", "1mo": "1y" };

type YahooQuote = {
  open?: unknown[];
  high?: unknown[];
  low?: unknown[];
  close?: unknown[];
  volume?: unknown[];
};

type YahooChartResult = {
  timestamp?: number[];
  indicators?: { quote?: YahooQuote[] };
  meta?: { regularMarketTime?: unknown; marketState?: unknown; exchangeTimezoneName?: unknown };
};

type YahooChartPayload = { chart?: { result?: YahooChartResult[] } };
type HyperliquidCandlePayload = { t?: unknown; T?: unknown; o?: unknown; h?: unknown; l?: unknown; c?: unknown; v?: unknown };

function sessionDateInTimeZone(time: number, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(time * 1000)).reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return new Date(time * 1000).toISOString().slice(0, 10);
  }
}

export function sampleCandles(symbol: string, interval: string, count = 280): Candle[] {
  const seconds = INTERVAL_SECONDS[interval] ?? 60;
  const now = Math.floor(Date.now() / 1000);
  let previous = symbol === "SAMPLE" ? 100 : 1000;
  return Array.from({ length: count }, (_, index) => {
    const close = (symbol === "SAMPLE" ? 100 : 1000) + index * 0.12 + Math.sin(index / 6) * 3 + Math.cos(index / 13) * 2;
    const candle = { time: now - (count - index) * seconds, open: Number(previous.toFixed(4)), high: Number((Math.max(previous, close) + 0.8 + index % 3 * 0.15).toFixed(4)), low: Number((Math.min(previous, close) - 0.8 - index % 2 * 0.1).toFixed(4)), close: Number(close.toFixed(4)), volume: 1200 + index % 24 * 75 };
    previous = close;
    return candle;
  });
}

function aggregateFourHours(rows: HistoryCandle[]) {
  const buckets = new Map<number, HistoryCandle[]>();
  for (const row of rows) {
    const key = Math.floor(row.time / 14400) * 14400;
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }
  return [...buckets.entries()].map(([time, items]) => {
    const latest = items[items.length - 1];
    return {
      time,
      open: items[0].open,
      high: Math.max(...items.map((item) => item.high)),
      low: Math.min(...items.map((item) => item.low)),
      close: latest.close,
      volume: items.reduce((sum, item) => sum + item.volume, 0),
      ...(latest.quoteTime == null ? {} : { quoteTime: latest.quoteTime }),
      ...(latest.sourceUpdatedAt ? { sourceUpdatedAt: latest.sourceUpdatedAt } : {}),
      ...(latest.marketSession ? { marketSession: latest.marketSession } : {}),
      ...(latest.sourceTimeZone ? { sourceTimeZone: latest.sourceTimeZone } : {}),
    };
  });
}

export function aggregateWeeklyCandles(rows: HistoryCandle[], timeZone = "UTC") {
  const buckets = new Map<string, HistoryCandle[]>();
  for (const row of rows) {
    const sessionDate = sessionDateInTimeZone(row.time, timeZone);
    const weekStart = new Date(`${sessionDate}T00:00:00Z`);
    weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
    const key = weekStart.toISOString().slice(0, 10);
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }
  return [...buckets.values()].map((items) => {
    const latest = items[items.length - 1];
    return {
      time: items[0].time,
      open: items[0].open,
      high: Math.max(...items.map((item) => item.high)),
      low: Math.min(...items.map((item) => item.low)),
      close: latest.close,
      volume: items.reduce((sum, item) => sum + item.volume, 0),
      ...(latest.quoteTime == null ? {} : { quoteTime: latest.quoteTime }),
      ...(latest.sourceUpdatedAt ? { sourceUpdatedAt: latest.sourceUpdatedAt } : {}),
      ...(latest.marketSession ? { marketSession: latest.marketSession } : {}),
      ...(latest.sourceTimeZone ? { sourceTimeZone: latest.sourceTimeZone } : {}),
    };
  });
}

export function aggregateMonthlyCandles(rows: HistoryCandle[], timeZone = "UTC") {
  const buckets = new Map<string, HistoryCandle[]>();
  for (const row of rows) {
    const key = sessionDateInTimeZone(row.time, timeZone).slice(0, 7);
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }
  return [...buckets.values()].map((items) => {
    const latest = items[items.length - 1];
    return {
      time: items[0].time,
      open: items[0].open,
      high: Math.max(...items.map((item) => item.high)),
      low: Math.min(...items.map((item) => item.low)),
      close: latest.close,
      volume: items.reduce((sum, item) => sum + item.volume, 0),
      ...(latest.quoteTime == null ? {} : { quoteTime: latest.quoteTime }),
      ...(latest.sourceUpdatedAt ? { sourceUpdatedAt: latest.sourceUpdatedAt } : {}),
      ...(latest.marketSession ? { marketSession: latest.marketSession } : {}),
      ...(latest.sourceTimeZone ? { sourceTimeZone: latest.sourceTimeZone } : {}),
    };
  });
}

async function yahooCandles(symbol: string, interval: string, mode: "full" | "tail" = "full", startTime?: number): Promise<HistoryCandle[]> {
  const yahooInterval = interval === "4h" ? "1h" : ["1wk", "1mo"].includes(interval) ? "1d" : interval;
  const range = mode === "tail" ? (YAHOO_TAIL_RANGE[interval] ?? YAHOO_RANGE[interval] ?? "3mo") : (YAHOO_RANGE[interval] ?? "3mo");
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("interval", yahooInterval);
  if (mode === "full" && Number.isFinite(startTime) && Number(startTime) > 0) {
    url.searchParams.set("period1", String(Math.floor(Number(startTime))));
    url.searchParams.set("period2", String(Math.floor(Date.now() / 1000) + 86400));
  } else {
    url.searchParams.set("range", range);
  }
  url.searchParams.set("includePrePost", "true");
  url.searchParams.set("events", "div,splits");
  const response = await fetch(url.toString(), { headers: { "user-agent": "Mozilla/5.0 CodexSites MultiChart" } });
  if (!response.ok) throw new Error("市場資料暫時不可用。");
  const payload = await response.json() as YahooChartPayload;
  const result = payload?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps: number[] = result?.timestamp ?? [];
  if (!quote || !timestamps.length) throw new Error("市場資料暫時沒有回傳 K 線。");
  let rows = timestamps.flatMap((time, index) => {
    const values = [quote.open?.[index], quote.high?.[index], quote.low?.[index], quote.close?.[index]];
    if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) return [];
    const candidate = { time, open: values[0], high: values[1], low: values[2], close: values[3], volume: Number(quote.volume?.[index] ?? 0) } as HistoryCandle;
    return isStructurallyValidCandle(candidate) ? [candidate] : [];
  });
  if (interval === "4h") rows = aggregateFourHours(rows);
  if (interval === "1wk") rows = aggregateWeeklyCandles(rows, String(result?.meta?.exchangeTimezoneName || "UTC"));
  if (interval === "1mo") rows = aggregateMonthlyCandles(rows, String(result?.meta?.exchangeTimezoneName || "UTC"));
  if (rows.length) {
    const regularMarketTime = Number(result?.meta?.regularMarketTime);
    if (Number.isFinite(regularMarketTime)) {
      rows[rows.length - 1].quoteTime = regularMarketTime;
      rows[rows.length - 1].sourceUpdatedAt = new Date(regularMarketTime * 1000).toISOString();
    }
    rows[rows.length - 1].marketSession = String(result?.meta?.marketState ?? "unknown").toLowerCase();
    rows[rows.length - 1].sourceTimeZone = String(result?.meta?.exchangeTimezoneName || "") || undefined;
  }
  return rows;
}

async function hyperliquidCandles(symbol: string, interval: string): Promise<Candle[]> {
  const endTime = Date.now();
  const startTime = endTime - (INTERVAL_SECONDS[interval] ?? 60) * 320 * 1000;
  const response = await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "candleSnapshot", req: { coin: symbol, interval, startTime, endTime } }) });
  if (!response.ok) throw new Error("Hyperliquid 資料暫時不可用。");
  const payload = await response.json() as HyperliquidCandlePayload[];
  return payload.map((row) => ({ time: Math.floor(Number(row.t) / 1000), open: Number(row.o), high: Number(row.h), low: Number(row.l), close: Number(row.c), volume: Number(row.v ?? 0), quoteTime: Math.floor(Number(row.T ?? row.t) / 1000), marketSession: "open" }));
}

export function providerForCandleSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  if (normalized === "SAMPLE") return "sample";
  if (["BTC", "ETH", "SOL"].includes(normalized)) return "hyperliquid";
  return "yfinance";
}

export async function fetchCandles(symbol: string, interval: string, options: { mode?: "full" | "tail"; startTime?: number } = {}): Promise<{ rows: HistoryCandle[]; provider: string }> {
  const normalized = symbol.trim().toUpperCase();
  if (normalized === "SAMPLE") return { rows: sampleCandles(normalized, interval), provider: "sample" };
  if (["BTC", "ETH", "SOL"].includes(normalized)) {
    try { return { rows: await hyperliquidCandles(normalized, interval), provider: "hyperliquid" }; }
    catch { return { rows: sampleCandles(normalized, interval), provider: "sample" }; }
  }
  return { rows: await yahooCandles(normalized, interval, options.mode, options.startTime), provider: "yahoo-chart" };
}

export async function candlePayload(symbol: string, interval: string, displayCount = 160) {
  const { rows, provider } = await fetchCandles(symbol, interval);
  return candlePayloadFromRows(symbol, interval, rows, provider, displayCount);
}

export function candlePayloadFromRows(
  symbol: string,
  interval: string,
  rows: HistoryCandle[],
  provider: string,
  displayCount = 160,
  cache?: CandleHistoryCacheMetadata,
  freshness: "fresh" | "stale" = "fresh",
  now = new Date(),
  indicatorParameters?: IndicatorParameters,
  pivotMode: PivotMode | null = null,
  pivotReferenceRows: Candle[] = [],
) {
  const taiwanStockVolume = isTaiwanRegularStockSymbol(symbol)
    ? normalizeTaiwanStockCandleRows(rows, provider)
    : undefined;
  rows = taiwanStockVolume?.rows ?? rows;
  const rawLatest = rows[rows.length - 1];
  const ignoredSessionDates: string[] = [];
  const invalidCandleSessionDates: string[] = [];
  const isTaiwanDaily = interval === "1d" && /\.(TW|TWO)$/.test(symbol.toUpperCase());
  const normalizedRows = rows.reduce<HistoryCandle[]>((accepted, row) => {
    if (!isStructurallyValidCandle(row)) {
      if (Number.isFinite(row?.time) && row.time > 0) {
        invalidCandleSessionDates.push(sessionDateInTimeZone(row.time, isTaiwanDaily ? "Asia/Taipei" : "UTC"));
      }
      return accepted;
    }
    if (!isTaiwanDaily) {
      accepted.push(row);
      return accepted;
    }
    const previous = accepted[accepted.length - 1];
    const isPlaceholder = Boolean(previous)
      && row.volume === 0
      && row.open === row.close
      && row.high === row.close
      && row.low === row.close
      && row.close === previous.close;
    if (isPlaceholder) {
      ignoredSessionDates.push(new Date(row.time * 1000).toISOString().slice(0, 10));
      return accepted;
    }
    accepted.push(row);
    return accepted;
  }, []);
  const sourceTimeZone = rawLatest?.sourceTimeZone || (isTaiwanDaily ? "Asia/Taipei" : "UTC");
  const requested = Math.max(1, Math.min(displayCount, 1600));
  const displayRows = normalizedRows.slice(-requested);
  const latest = displayRows[displayRows.length - 1];
  const quoteTime = Number.isFinite(Number(rawLatest?.quoteTime)) ? Number(rawLatest?.quoteTime) : null;
  const sourceProvider = provider === "yahoo-chart" || provider.startsWith("yfinance-") ? "yfinance" : provider;
  const marketSession = rawLatest?.marketSession ?? "unknown";
  const sessionDate = latest?.time ? sessionDateInTimeZone(latest.time, sourceTimeZone) : null;
  const isUnitedStatesDaily = interval === "1d" && sourceTimeZone === "America/New_York";
  const marketPhase: MarketPhase = isTaiwanDaily
    ? inferTaiwanMarketPhase({
      marketState: marketSession,
      sessionDate,
      sourceQuoteTime: quoteTime,
      sourceTimeZone,
      hasValidCandle: Boolean(latest),
      now,
    })
    : isUnitedStatesDaily
      ? inferUnitedStatesMarketPhase({
        marketState: marketSession,
        sessionDate,
        sourceQuoteTime: quoteTime,
        sourceTimeZone,
        hasValidCandle: Boolean(latest),
        now,
      })
      : ["open", "regular", "trading"].includes(String(marketSession).toLowerCase()) ? "open"
        : ["closed", "close", "post", "postpost", "afterhours", "after-hours"].includes(String(marketSession).toLowerCase()) ? "closed"
          : "unknown";
  const quoteKind = interval === "1d" && ["closing", "closed"].includes(marketPhase) ? "session-close" : "intraday";
  const fullIndicators: ReturnType<typeof computeIndicators> & {
    pivot_points?: ReturnType<typeof buildTraditionalPivotIndicator>;
  } = computeIndicators(normalizedRows, indicatorParameters);
  if (pivotMode === "traditional") {
    const referenceInterval = pivotReferenceInterval(interval) ?? "1d";
    const latestReference = pivotReferenceRows[pivotReferenceRows.length - 1];
    const latestReferenceKey = latestReference
      ? referencePeriodKey(latestReference.time, referenceInterval, sourceTimeZone)
      : undefined;
    const currentReferenceKey = referencePeriodKey(Math.floor(now.getTime() / 1000), referenceInterval, sourceTimeZone);
    const provisionalReferencePeriodKey = ["1m", "5m", "15m", "1h"].includes(referenceInterval)
      ? latestReferenceKey
      : latestReferenceKey === currentReferenceKey
        && (referenceInterval === "1d" ? !["closing", "closed"].includes(marketPhase) : true)
        ? latestReferenceKey
        : undefined;
    fullIndicators.pivot_points = buildTraditionalPivotIndicator(
      displayRows,
      pivotReferenceRows,
      interval,
      sourceTimeZone,
      { provisionalReferencePeriodKey },
    );
  }
  const displayTimes = new Set(displayRows.map((row) => row.time));
  const clip = <T>(value: T): T => Array.isArray(value)
    ? (value.every((item) => item && typeof item === "object" && "time" in item) ? value.filter((item) => displayTimes.has(Number(item.time))) : value) as T
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clip(item)])) as T : value;
  const indicators = clip(fullIndicators);
  const displayProfile = computeIndicators(displayRows, indicatorParameters);
  indicators.volume_profile = displayProfile.volume_profile;
  indicators.poc = displayProfile.poc;
  indicators.vah = displayProfile.vah;
  indicators.val = displayProfile.val;
  const dataQuality = {
    ignoredSessionDates,
    ...(cache?.continuity ? {
      continuity: cache.continuity,
      missingSessionDates: cache.continuity.missingSessionDates,
      excludedSessionDates: cache.continuity.excludedSessionDates,
    } : {}),
    ...(invalidCandleSessionDates.length ? { invalidCandleSessionDates } : {}),
    ...(invalidCandleSessionDates.length && ignoredSessionDates.length
      ? { reason: "invalid_ohlc_and_zero_volume_flat_carry_forward" }
      : invalidCandleSessionDates.length
        ? { reason: "invalid_ohlc" }
        : ignoredSessionDates.length
          ? { reason: "zero_volume_flat_carry_forward" }
          : {}),
    ...(symbol.trim().toUpperCase() === "^SOX"
      && normalizedRows.length > 0
      && normalizedRows.every((row) => Number(row.volume) === 0)
      ? {
        volumeAvailability: {
          status: "unavailable",
          reason: "source_not_provided",
          message: "此指數來源未提供成交量",
        },
      }
      : {}),
  };
  const volumeAvailability = dataQuality.volumeAvailability;
  return {
    symbol, interval, candles: displayRows, quoteTime,
    ...(taiwanStockVolume ? { volumeContract: taiwanStockVolume.contract } : {}),
    quote: {
      kind: quoteKind,
      sessionDate,
      sourceProvider,
      sourceQuoteTime: quoteTime,
      sourceTimeZone,
      marketSession,
      marketPhase,
      freshness,
      verification: { status: "unverified", provider: null, reason: interval === "1d" ? "provider_not_configured" : "unsupported_interval" },
      ...(volumeAvailability ? { volumeAvailability } : {}),
      dataQuality,
    },
    dataQuality,
    marketSession, indicators,
    dataWindow: { rawCandles: normalizedRows.length, displayCandles: displayRows.length, requestedDisplayCandles: requested, hasMoreBefore: normalizedRows.length > displayRows.length, warmupCandles: 120, availableWarmupCandles: Math.max(0, normalizedRows.length - displayRows.length), insufficientWarmup: normalizedRows.length - displayRows.length < 120, warmupStatus: normalizedRows.length - displayRows.length < 120 ? "insufficient" : "sufficient", displayFrom: displayRows[0]?.time ?? null, displayTo: latest?.time ?? null, sourceFingerprint: taiwanStockVolume?.contract.sourceFingerprint ?? provider, ...(cache?.continuity ? { continuity: cache.continuity } : {}), cache: cache ?? { store: "worker-memory", state: "miss", source: provider, historyStore: "worker-memory", persistent: false, rows: normalizedRows.length } },
  };
}
