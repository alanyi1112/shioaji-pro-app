import {
  parseBrowserSubscription,
  parseRealtimeMicrobatch,
  type RealtimeMarketSnapshot,
  type RealtimeSessionBootstrapPoint,
} from "./realtime-contract.ts";
import { resolveRealtimeState, safeSourceAge, taiwanRealtimeMarketPhase } from "./realtime-state.ts";

declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

type SqlCursor = { toArray<T = Record<string, unknown>>(): T[] };
type SqlStorage = { exec(query: string, ...bindings: unknown[]): SqlCursor };
type DurableStorage = { sql: SqlStorage };
type DurableState = {
  storage: DurableStorage;
  acceptWebSocket(socket: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
};
type SocketAttachment = { role: "ingest" | "browser"; connectionId?: string; symbols?: string[] };

const MAX_SESSION_BATCHES = 18_000;
const SOFT_DAILY_MESSAGES = 18_000;
const STOP_NEW_SUBSCRIPTIONS_DAILY_MESSAGES = 19_000;
const HARD_DAILY_MESSAGES = 20_000;
const CANONICAL_SYMBOL = /^\d{4,6}[A-Z]?\.(?:TW|TWO)$/;
const DEMAND_SCOPE_ID = /^[a-f0-9]{64}$/;

export function realtimeLoadSheddingForUsage(usage: number) {
  if (usage >= HARD_DAILY_MESSAGES) return "ingest-paused";
  if (usage >= STOP_NEW_SUBSCRIPTIONS_DAILY_MESSAGES) return "no-new-subscriptions";
  if (usage >= SOFT_DAILY_MESSAGES) return "visible-only";
  return "none";
}

export function isRealtimeSequenceReplay(previousSequence: number | null | undefined, nextSequence: number) {
  return Number.isFinite(Number(previousSequence)) && Number(previousSequence) >= nextSequence;
}

function response101(socket: WebSocket) {
  return new Response(null, { status: 101, webSocket: socket } as ResponseInit & { webSocket: WebSocket });
}

function attachment(socket: WebSocket): SocketAttachment {
  const value = (socket as WebSocket & { deserializeAttachment(): unknown }).deserializeAttachment();
  return value && typeof value === "object" ? value as SocketAttachment : { role: "browser", symbols: [] };
}

function saveAttachment(socket: WebSocket, value: SocketAttachment) {
  (socket as WebSocket & { serializeAttachment(value: unknown): void }).serializeAttachment(value);
}

function safeSend(socket: WebSocket, payload: unknown) {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // A later close event removes the socket; never expose transport details.
  }
}

export class RealtimeMarketHub {
  private readonly state: DurableState;
  private readonly sql: SqlStorage;
  private latest = new Map<string, RealtimeMarketSnapshot>();
  private dropped = 0;
  private replayed = 0;
  private gatewayConnected = false;

  constructor(state: DurableState) {
    this.state = state;
    this.sql = state.storage.sql;
    state.blockConcurrencyWhile(async () => {
      this.sql.exec("CREATE TABLE IF NOT EXISTS realtime_latest (symbol TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS realtime_session_batch_v2 (connection_id TEXT NOT NULL, sequence INTEGER NOT NULL, source_time INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(connection_id, sequence))");
      this.sql.exec("CREATE TABLE IF NOT EXISTS realtime_connection (connection_id TEXT PRIMARY KEY, last_sequence INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS realtime_usage (day TEXT PRIMARY KEY, message_count INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS realtime_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS realtime_session_minute (symbol TEXT NOT NULL, session_date TEXT NOT NULL, minute_time INTEGER NOT NULL, source_time INTEGER NOT NULL, close REAL NOT NULL, average_price REAL NOT NULL, volume INTEGER NOT NULL, total_volume INTEGER NOT NULL, continuity TEXT NOT NULL, PRIMARY KEY(symbol,session_date,minute_time))");
      this.sql.exec("CREATE INDEX IF NOT EXISTS realtime_session_minute_lookup ON realtime_session_minute(symbol,session_date,minute_time)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS realtime_watchlist_demand (scope_id TEXT NOT NULL, symbol TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(scope_id,symbol))");
      this.sql.exec("CREATE INDEX IF NOT EXISTS realtime_watchlist_demand_updated ON realtime_watchlist_demand(updated_at)");
      this.sql.exec("DROP TABLE IF EXISTS realtime_demand");
      const rows = this.sql.exec("SELECT symbol, payload FROM realtime_latest").toArray<{ symbol: string; payload: string }>();
      for (const row of rows) {
        try {
          this.latest.set(row.symbol, JSON.parse(row.payload) as RealtimeMarketSnapshot);
        } catch {
          this.dropped += 1;
        }
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/_health")) return Response.json(this.health());
    if (url.pathname.endsWith("/_watchlist") && request.method === "POST" && request.headers.get("x-realtime-role") === "internal") {
      let body: unknown;
      try { body = await request.json(); } catch { body = null; }
      const record = body && typeof body === "object" ? body as { scopeId?: unknown; symbols?: unknown } : {};
      const scopeId = typeof record.scopeId === "string" ? record.scopeId : "";
      const raw = Array.isArray(record.symbols)
        ? record.symbols
        : [];
      const symbols = [...new Set(raw.map((item) => String(item).trim().toUpperCase()))].filter((item) => CANONICAL_SYMBOL.test(item)).slice(0, 32);
      if (!DEMAND_SCOPE_ID.test(scopeId)) return Response.json({ ok: false, reasonCode: "realtime_control_invalid" }, { status: 400 });
      this.sql.exec("DELETE FROM realtime_watchlist_demand WHERE scope_id=?", scopeId);
      const updatedAt = Date.now();
      for (const symbol of symbols) this.sql.exec("INSERT INTO realtime_watchlist_demand(scope_id,symbol,updated_at) VALUES(?,?,?)", scopeId, symbol, updatedAt);
      this.sendGatewayDemand();
      // A connected uplink only proves that demand was dispatched.  The gateway
      // owns the authoritative started/already-subscribed/capacity result.
      return Response.json({ ok: true, status: "queued", acceptedSymbolCount: symbols.length });
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return Response.json({ ok: false, reasonCode: "websocket_upgrade_required" }, { status: 426 });
    }
    const role = request.headers.get("x-realtime-role");
    if (role !== "ingest" && role !== "browser") {
      return Response.json({ ok: false, reasonCode: "realtime_role_invalid" }, { status: 403 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const connectionId = request.headers.get("x-realtime-connection-id") || undefined;
    if (role === "ingest" && !connectionId) {
      return Response.json({ ok: false, reasonCode: "realtime_connection_invalid" }, { status: 400 });
    }
    if (role === "ingest") {
      for (const existing of this.state.getWebSockets("ingest")) {
        const existingState = attachment(existing);
        if (existingState.connectionId !== connectionId) {
          try { existing.close(1012, "gateway_replaced"); } catch { /* already closing */ }
        }
      }
      this.sql.exec(
        "INSERT INTO realtime_meta(key,value,updated_at) VALUES('active_ingest_connection',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        connectionId,
        Date.now(),
      );
    }
    const socketState: SocketAttachment = role === "ingest"
      ? { role, connectionId }
      : { role, symbols: [] };
    saveAttachment(server, socketState);
    this.state.acceptWebSocket(server, [role]);
    if (role === "ingest") this.gatewayConnected = true;
    safeSend(server, { type: "ready", role, maxSymbols: 8 });
    if (role === "ingest") this.sendGatewayDemand();
    return response101(client);
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") {
      this.dropped += 1;
      safeSend(socket, { type: "error", reasonCode: "realtime_payload_invalid" });
      return;
    }
    const socketState = attachment(socket);
    if (socketState.role === "ingest") this.acceptIngest(socket, socketState, message);
    else this.acceptBrowser(socket, socketState, message);
  }

  webSocketClose(socket: WebSocket, code: number, reason: string, wasClean: boolean) {
    void code;
    void reason;
    void wasClean;
    if (attachment(socket).role === "browser") this.sendGatewayDemand(socket);
    this.gatewayConnected = this.state.getWebSockets("ingest").length > 0;
  }

  webSocketError(socket: WebSocket) {
    this.dropped += 1;
    if (attachment(socket).role === "browser") this.sendGatewayDemand(socket);
    this.gatewayConnected = this.state.getWebSockets("ingest").length > 0;
  }

  private acceptIngest(socket: WebSocket, socketState: SocketAttachment, message: string) {
    let batch;
    try {
      batch = parseRealtimeMicrobatch(message);
    } catch (error) {
      this.dropped += 1;
      safeSend(socket, { type: "error", reasonCode: error instanceof Error ? error.message : "realtime_payload_invalid" });
      return;
    }
    if (batch.connectionId !== socketState.connectionId) {
      this.dropped += 1;
      safeSend(socket, { type: "error", reasonCode: "realtime_connection_mismatch" });
      return;
    }
    const activeConnection = this.sql.exec(
      "SELECT value FROM realtime_meta WHERE key = 'active_ingest_connection' LIMIT 1",
    ).toArray<{ value: string }>().at(0)?.value;
    if (activeConnection !== batch.connectionId) {
      this.replayed += 1;
      safeSend(socket, { type: "ack", accepted: false, reasonCode: "realtime_connection_retired" });
      return;
    }
    const previous = this.sql.exec(
      "SELECT last_sequence FROM realtime_connection WHERE connection_id = ? LIMIT 1",
      batch.connectionId,
    ).toArray<{ last_sequence: number }>().at(0);
    if (isRealtimeSequenceReplay(previous?.last_sequence, batch.sequence)) {
      this.replayed += 1;
      safeSend(socket, { type: "ack", accepted: false, reasonCode: "realtime_replay" });
      return;
    }
    const usage = this.incrementUsage();
    if (usage > HARD_DAILY_MESSAGES) {
      this.dropped += 1;
      safeSend(socket, { type: "ack", accepted: false, reasonCode: "realtime_quota_hard_limit" });
      return;
    }
    const loadShedding = this.loadSheddingForUsage(usage);
    const visible = this.visibleSymbols();
    if (batch.type === "session-bootstrap-v1") {
      if (loadShedding !== "none") {
        this.dropped += 1;
        safeSend(socket, { type: "ack", accepted: false, reasonCode: "realtime_backfill_paused", loadShedding });
        return;
      }
      const now = Date.now();
      this.sql.exec(
        "INSERT INTO realtime_connection(connection_id,last_sequence,updated_at) VALUES(?,?,?) ON CONFLICT(connection_id) DO UPDATE SET last_sequence=excluded.last_sequence,updated_at=excluded.updated_at",
        batch.connectionId, batch.sequence, now,
      );
      for (const point of batch.points) this.storeSessionPoint(point, point.volume, point.totalVolume);
      safeSend(socket, { type: "ack", accepted: true, sequence: batch.sequence, acceptedPointCount: batch.points.length, loadShedding });
      return;
    }
    const acceptedUpdates = loadShedding === "none"
      ? batch.updates
      : batch.updates.filter((update) => visible.has(update.canonicalSymbol));
    const now = Date.now();
    this.sql.exec(
      "INSERT INTO realtime_connection(connection_id,last_sequence,updated_at) VALUES(?,?,?) ON CONFLICT(connection_id) DO UPDATE SET last_sequence=excluded.last_sequence,updated_at=excluded.updated_at",
      batch.connectionId,
      batch.sequence,
      now,
    );
    for (const update of acceptedUpdates) {
      this.latest.set(update.canonicalSymbol, update);
      this.sql.exec(
        "INSERT INTO realtime_latest(symbol,payload,updated_at) VALUES(?,?,?) ON CONFLICT(symbol) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
        update.canonicalSymbol,
        JSON.stringify(update),
        now,
      );
      this.storeSessionPoint(update, update.tickVolume, update.totalVolume);
    }
    this.sql.exec(
      "INSERT OR REPLACE INTO realtime_session_batch_v2(connection_id,sequence,source_time,payload) VALUES(?,?,?,?)",
      batch.connectionId,
      batch.sequence,
      Date.parse(batch.sentAt),
      JSON.stringify({ ...batch, updates: acceptedUpdates }),
    );
    if (batch.sequence % 60 === 0) {
      this.sql.exec("DELETE FROM realtime_session_batch_v2 WHERE rowid NOT IN (SELECT rowid FROM realtime_session_batch_v2 ORDER BY source_time DESC, rowid DESC LIMIT ?)", MAX_SESSION_BATCHES);
    }
    this.broadcast(acceptedUpdates);
    safeSend(socket, {
      type: "ack",
      accepted: true,
      sequence: batch.sequence,
      acceptedUpdateCount: acceptedUpdates.length,
      loadShedding,
    });
  }

  private acceptBrowser(socket: WebSocket, socketState: SocketAttachment, message: string) {
    let subscription;
    try {
      subscription = parseBrowserSubscription(message);
    } catch (error) {
      this.dropped += 1;
      safeSend(socket, { type: "error", reasonCode: error instanceof Error ? error.message : "realtime_subscription_invalid" });
      return;
    }
    const currentSymbols = new Set(socketState.symbols || []);
    const addsSymbols = subscription.symbols.some((symbol) => !currentSymbols.has(symbol));
    if (this.currentUsage() >= STOP_NEW_SUBSCRIPTIONS_DAILY_MESSAGES && addsSymbols) {
      this.dropped += 1;
      safeSend(socket, { type: "error", reasonCode: "realtime_new_subscriptions_paused" });
      return;
    }
    socketState.symbols = subscription.symbols;
    saveAttachment(socket, socketState);
    this.sendGatewayDemand();
    const updates = subscription.symbols.flatMap((symbol) => {
      const value = this.latest.get(symbol);
      return value ? [value] : [];
    });
    safeSend(socket, { type: "snapshot", updates, session: this.sessionForSymbols(subscription.symbols), state: this.health().gatewayState });
  }

  private broadcast(updates: RealtimeMarketSnapshot[]) {
    for (const socket of this.state.getWebSockets("browser")) {
      const symbols = new Set(attachment(socket).symbols || []);
      const selected = updates.filter((update) => symbols.has(update.canonicalSymbol));
      if (selected.length) safeSend(socket, { type: "market-batch-v1", updates: selected });
    }
  }

  private incrementUsage() {
    const day = new Date().toISOString().slice(0, 10);
    this.sql.exec("INSERT INTO realtime_usage(day,message_count,updated_at) VALUES(?,1,?) ON CONFLICT(day) DO UPDATE SET message_count=message_count+1,updated_at=excluded.updated_at", day, Date.now());
    const row = this.sql.exec("SELECT message_count FROM realtime_usage WHERE day = ?", day).toArray<{ message_count: number }>().at(0);
    return Number(row?.message_count || 0);
  }

  private currentUsage() {
    const day = new Date().toISOString().slice(0, 10);
    const row = this.sql.exec("SELECT message_count FROM realtime_usage WHERE day = ?", day).toArray<{ message_count: number }>().at(0);
    return Number(row?.message_count || 0);
  }

  private loadSheddingForUsage(usage: number) {
    return realtimeLoadSheddingForUsage(usage);
  }

  private visibleSymbols(excludedSocket?: WebSocket) {
    const visible = new Set<string>();
    for (const socket of this.state.getWebSockets("browser")) {
      if (socket === excludedSocket) continue;
      for (const symbol of attachment(socket).symbols || []) visible.add(symbol);
    }
    return visible;
  }

  private sendGatewayDemand(excludedSocket?: WebSocket) {
    const symbols = new Set(this.visibleSymbols(excludedSocket));
    for (const row of this.sql.exec("SELECT symbol FROM realtime_watchlist_demand GROUP BY symbol ORDER BY MAX(updated_at) DESC, symbol LIMIT 32").toArray<{ symbol: string }>()) symbols.add(row.symbol);
    const payload = { type: "subscription-demand-v1", symbols: [...symbols].slice(0, 32) };
    for (const socket of this.state.getWebSockets("ingest")) safeSend(socket, payload);
  }

  private storeSessionPoint(update: RealtimeMarketSnapshot | RealtimeSessionBootstrapPoint, volume: number, totalVolume: number) {
    const sourceTime = Date.parse(update.sourceTime);
    const minuteTime = Math.floor(sourceTime / 60_000) * 60;
    this.sql.exec(
      `INSERT INTO realtime_session_minute(symbol,session_date,minute_time,source_time,close,average_price,volume,total_volume,continuity)
       VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(symbol,session_date,minute_time) DO UPDATE SET
         source_time=MAX(source_time,excluded.source_time),
         close=CASE WHEN excluded.source_time >= source_time THEN excluded.close ELSE close END,
         average_price=CASE WHEN excluded.source_time >= source_time THEN excluded.average_price ELSE average_price END,
         volume=volume+excluded.volume,
         total_volume=MAX(total_volume,excluded.total_volume),
         continuity=CASE WHEN continuity='partial' OR excluded.continuity='partial' THEN 'partial' ELSE 'complete' END`,
      update.canonicalSymbol, update.sessionDate, minuteTime, sourceTime, update.close, update.averagePrice,
      Math.max(0, Math.floor(volume)), Math.max(0, Math.floor(totalVolume)), update.continuity,
    );
    if (update.sequence % 60 === 0) {
      this.sql.exec("DELETE FROM realtime_session_minute WHERE session_date < ?", update.sessionDate);
    }
  }

  private sessionForSymbols(symbols: string[]) {
    const result: Record<string, unknown[]> = {};
    for (const symbol of symbols) {
      const sessionDate = this.latest.get(symbol)?.sessionDate;
      if (!sessionDate) {
        result[symbol] = [];
        continue;
      }
      result[symbol] = this.sql.exec(
        `SELECT minute_time AS time,source_time AS sourceTime,close,average_price AS averagePrice,
                volume,total_volume AS totalVolume,continuity
         FROM realtime_session_minute WHERE symbol=? AND session_date=? ORDER BY minute_time LIMIT 300`,
        symbol, sessionDate,
      ).toArray();
    }
    return result;
  }

  private health() {
    const latestSourceTime = [...this.latest.values()].reduce<string | null>(
      (value, item) => !value || item.sourceTime > value ? item.sourceTime : value,
      null,
    );
    const sourceAgeMs = safeSourceAge(latestSourceTime);
    return {
      realtimeEnabled: true,
      gatewayState: resolveRealtimeState({
        enabled: true,
        gatewayConnected: this.gatewayConnected || this.state.getWebSockets("ingest").length > 0,
        sourceAgeMs,
        marketPhase: taiwanRealtimeMarketPhase(),
        fallbackAvailable: false,
      }),
      sourceAgeMs,
      subscriptionCount: this.state.getWebSockets("browser").reduce(
        (count, socket) => count + (attachment(socket).symbols?.length || 0),
        0,
      ),
      dropCount: this.dropped,
      replayCount: this.replayed,
      quota: {
        dailyMessageCount: this.currentUsage(),
        softDailyMessages: SOFT_DAILY_MESSAGES,
        stopNewSubscriptionsDailyMessages: STOP_NEW_SUBSCRIPTIONS_DAILY_MESSAGES,
        hardDailyMessages: HARD_DAILY_MESSAGES,
        loadShedding: this.loadSheddingForUsage(this.currentUsage()),
      },
      persistence: { durableObjectSqlite: true, d1TickWrites: 0 },
    };
  }
}
