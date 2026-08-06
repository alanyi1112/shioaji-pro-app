const MAX_BATCH_BYTES = 64 * 1024;
const MAX_BATCH_UPDATES = 32;
const MAX_BOOTSTRAP_POINTS = 128;
const MAX_BROWSER_SYMBOLS = 8;
const CONNECTION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SYMBOL = /^\d{4,6}[A-Z]?\.(?:TW|TWO)$/;
const BATCH_FIELDS = new Set(["type", "connectionId", "sequence", "sentAt", "updates"]);
const SNAPSHOT_FIELDS = new Set([
  "canonicalSymbol", "exchange", "sessionDate", "sourceTime", "receivedTime",
  "open", "high", "low", "close", "averagePrice", "tickVolume", "totalVolume",
  "simtrade", "sequence", "connectionId", "provider", "continuity", "reasonCode",
]);
const SUBSCRIPTION_FIELDS = new Set(["type", "symbols"]);
const BOOTSTRAP_FIELDS = new Set(["type", "connectionId", "sequence", "sentAt", "points"]);
const BOOTSTRAP_POINT_FIELDS = new Set([
  "canonicalSymbol", "exchange", "sessionDate", "sourceTime", "receivedTime",
  "open", "high", "low", "close", "averagePrice", "volume", "totalVolume", "sequence",
  "connectionId", "provider", "continuity", "reasonCode",
]);

export type RealtimeProvider = "shioaji";
export type RealtimeContinuity = "complete" | "partial";

export type RealtimeMarketSnapshot = {
  canonicalSymbol: string;
  exchange: "TWSE" | "TPEx";
  sessionDate: string;
  sourceTime: string;
  receivedTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  averagePrice: number;
  tickVolume: number;
  totalVolume: number;
  simtrade: boolean;
  sequence: number;
  connectionId: string;
  provider: RealtimeProvider;
  continuity: RealtimeContinuity;
  reasonCode: string;
};

export type RealtimeMicrobatch = {
  type: "market-batch-v1";
  connectionId: string;
  sequence: number;
  sentAt: string;
  updates: RealtimeMarketSnapshot[];
};

export type RealtimeSessionBootstrapPoint = Omit<RealtimeMarketSnapshot, "tickVolume" | "totalVolume" | "simtrade"> & {
  volume: number;
  totalVolume: number;
};

export type RealtimeSessionBootstrap = {
  type: "session-bootstrap-v1";
  connectionId: string;
  sequence: number;
  sentAt: string;
  points: RealtimeSessionBootstrapPoint[];
};

export type BrowserSubscription = {
  type: "subscribe";
  symbols: string[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown, minimum = 0) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum;
}

function integer(value: unknown, minimum = 0) {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}

function isoTime(value: unknown) {
  return typeof value === "string"
    && value.length <= 40
    && Number.isFinite(Date.parse(value));
}

function dateKey(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function hasOnlyFields(value: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseSnapshot(value: unknown, connectionId: string): RealtimeMarketSnapshot | null {
  const item = record(value);
  if (!item || !hasOnlyFields(item, SNAPSHOT_FIELDS) || !SYMBOL.test(String(item.canonicalSymbol || ""))) return null;
  if (item.connectionId !== connectionId || !CONNECTION_ID.test(connectionId)) return null;
  if (item.exchange !== "TWSE" && item.exchange !== "TPEx") return null;
  if (!dateKey(item.sessionDate) || !isoTime(item.sourceTime) || !isoTime(item.receivedTime)) return null;
  const prices = [item.open, item.high, item.low, item.close, item.averagePrice];
  if (!prices.every((price) => finite(price, Number.MIN_VALUE))) return null;
  const [open, high, low, close, averagePrice] = prices as number[];
  if (high < low || open < low || open > high || close < low || close > high || averagePrice < low || averagePrice > high) return null;
  if (!integer(item.tickVolume) || !integer(item.totalVolume) || Number(item.tickVolume) > Number(item.totalVolume)) return null;
  if (!integer(item.sequence, 1) || typeof item.simtrade !== "boolean") return null;
  if (item.provider !== "shioaji") return null;
  if (item.continuity !== "complete" && item.continuity !== "partial") return null;
  if (typeof item.reasonCode !== "string" || item.reasonCode.length > 64 || !/^[a-z0-9_-]+$/.test(item.reasonCode)) return null;
  return {
    canonicalSymbol: String(item.canonicalSymbol),
    exchange: item.exchange,
    sessionDate: String(item.sessionDate),
    sourceTime: String(item.sourceTime),
    receivedTime: String(item.receivedTime),
    open, high, low, close, averagePrice,
    tickVolume: Number(item.tickVolume),
    totalVolume: Number(item.totalVolume),
    simtrade: item.simtrade,
    sequence: Number(item.sequence),
    connectionId,
    provider: "shioaji",
    continuity: item.continuity,
    reasonCode: item.reasonCode,
  };
}

function parseBootstrapPoint(value: unknown, connectionId: string): RealtimeSessionBootstrapPoint | null {
  const item = record(value);
  if (!item || !hasOnlyFields(item, BOOTSTRAP_POINT_FIELDS) || !SYMBOL.test(String(item.canonicalSymbol || ""))) return null;
  if (item.connectionId !== connectionId || !CONNECTION_ID.test(connectionId)) return null;
  if (item.exchange !== "TWSE" && item.exchange !== "TPEx") return null;
  if (!dateKey(item.sessionDate) || !isoTime(item.sourceTime) || !isoTime(item.receivedTime)) return null;
  const prices = [item.open, item.high, item.low, item.close, item.averagePrice];
  if (!prices.every((price) => finite(price, Number.MIN_VALUE))) return null;
  const [open, high, low, close, averagePrice] = prices as number[];
  if (high < low || open < low || open > high || close < low || close > high || averagePrice < low || averagePrice > high) return null;
  if (!integer(item.volume) || !integer(item.totalVolume) || !integer(item.sequence, 1)) return null;
  if (item.provider !== "shioaji") return null;
  if (item.continuity !== "complete" && item.continuity !== "partial") return null;
  if (typeof item.reasonCode !== "string" || item.reasonCode.length > 64 || !/^[a-z0-9_-]+$/.test(item.reasonCode)) return null;
  return {
    canonicalSymbol: String(item.canonicalSymbol), exchange: item.exchange,
    sessionDate: String(item.sessionDate), sourceTime: String(item.sourceTime), receivedTime: String(item.receivedTime),
    open, high, low, close, averagePrice, volume: Number(item.volume), totalVolume: Number(item.totalVolume), sequence: Number(item.sequence),
    connectionId, provider: "shioaji", continuity: item.continuity, reasonCode: item.reasonCode,
  };
}

export function parseRealtimeMicrobatch(message: unknown, now = Date.now()): RealtimeMicrobatch | RealtimeSessionBootstrap {
  if (typeof message !== "string" || new TextEncoder().encode(message).byteLength > MAX_BATCH_BYTES) {
    throw new Error("realtime_payload_too_large");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(message);
  } catch {
    throw new Error("realtime_payload_invalid");
  }
  const batch = record(payload);
  const connectionId = String(batch?.connectionId || "");
  if (
    batch
    && batch.type === "session-bootstrap-v1"
    && hasOnlyFields(batch, BOOTSTRAP_FIELDS)
    && CONNECTION_ID.test(connectionId)
    && integer(batch.sequence, 1)
    && isoTime(batch.sentAt)
    && Math.abs(now - Date.parse(String(batch.sentAt))) <= 30_000
    && Array.isArray(batch.points)
    && batch.points.length > 0
    && batch.points.length <= MAX_BOOTSTRAP_POINTS
  ) {
    const points = batch.points.map((item) => parseBootstrapPoint(item, connectionId));
    if (points.some((item) => item === null)) throw new Error("realtime_payload_invalid");
    return { type: "session-bootstrap-v1", connectionId, sequence: Number(batch.sequence), sentAt: String(batch.sentAt), points: points as RealtimeSessionBootstrapPoint[] };
  }
  if (
    !batch
    || !hasOnlyFields(batch, BATCH_FIELDS)
    || batch.type !== "market-batch-v1"
    || !CONNECTION_ID.test(connectionId)
    || !integer(batch.sequence, 1)
    || !isoTime(batch.sentAt)
    || Math.abs(now - Date.parse(String(batch.sentAt))) > 30_000
    || !Array.isArray(batch.updates)
    || batch.updates.length > MAX_BATCH_UPDATES
  ) {
    throw new Error("realtime_payload_invalid");
  }
  const updates = batch.updates.map((item) => parseSnapshot(item, connectionId));
  if (updates.some((item) => item === null)) throw new Error("realtime_payload_invalid");
  const symbols = new Set(updates.map((item) => item!.canonicalSymbol));
  if (symbols.size !== updates.length) throw new Error("realtime_payload_duplicate_symbol");
  return {
    type: "market-batch-v1",
    connectionId,
    sequence: Number(batch.sequence),
    sentAt: String(batch.sentAt),
    updates: updates as RealtimeMarketSnapshot[],
  };
}

export function parseBrowserSubscription(message: unknown): BrowserSubscription {
  if (typeof message !== "string" || new TextEncoder().encode(message).byteLength > 2048) {
    throw new Error("realtime_subscription_invalid");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(message);
  } catch {
    throw new Error("realtime_subscription_invalid");
  }
  const input = record(payload);
  if (!input || !hasOnlyFields(input, SUBSCRIPTION_FIELDS) || input.type !== "subscribe" || !Array.isArray(input.symbols)) {
    throw new Error("realtime_subscription_invalid");
  }
  const symbols = [...new Set(input.symbols.map((symbol) => String(symbol).trim().toUpperCase()))];
  if (symbols.length > MAX_BROWSER_SYMBOLS || symbols.some((symbol) => !SYMBOL.test(symbol))) {
    throw new Error("realtime_subscription_invalid");
  }
  return { type: "subscribe", symbols };
}

export const REALTIME_CONTRACT_LIMITS = {
  maxBatchBytes: MAX_BATCH_BYTES,
  maxBatchUpdates: MAX_BATCH_UPDATES,
  maxBootstrapPoints: MAX_BOOTSTRAP_POINTS,
  maxBrowserSymbols: MAX_BROWSER_SYMBOLS,
} as const;
