import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseBrowserSubscription,
  parseRealtimeMicrobatch,
  REALTIME_CONTRACT_LIMITS,
} from "../worker/realtime-contract.ts";
import { handleRealtimeRoute, notifyRealtimeWatchlistSymbols, realtimeCapability, realtimeViewerCapabilityForPrincipal } from "../worker/realtime-routing.ts";
import { prepareRequestPrincipal } from "../worker/request-principal.ts";
import { SqliteD1 } from "./helpers/sqlite-d1.mjs";
import { resolveRealtimeState, taiwanRealtimeMarketPhase } from "../worker/realtime-state.ts";
import { isRealtimeSequenceReplay, realtimeLoadSheddingForUsage } from "../worker/realtime-hub.ts";

function snapshot(overrides = {}) {
  return {
    canonicalSymbol: "2330.TW",
    exchange: "TWSE",
    sessionDate: "2026-07-31",
    sourceTime: "2026-07-31T10:00:00.000+08:00",
    receivedTime: "2026-07-31T10:00:00.100+08:00",
    open: 100,
    high: 103,
    low: 99,
    close: 102,
    averagePrice: 101,
    tickVolume: 2,
    totalVolume: 20,
    simtrade: false,
    sequence: 10,
    connectionId: "connection-a",
    provider: "shioaji",
    continuity: "complete",
    reasonCode: "none",
    ...overrides,
  };
}

function batch(overrides = {}) {
  return JSON.stringify({
    type: "market-batch-v1",
    connectionId: "connection-a",
    sequence: 8,
    sentAt: "2026-07-31T02:00:00.200Z",
    updates: [snapshot()],
    ...overrides,
  });
}

async function builtWorker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("realtime-watchlist-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

test("一秒微批次只接受 allowlist 欄位、合法商品與新鮮 timestamp", () => {
  const now = Date.parse("2026-07-31T02:00:00.300Z");
  const parsed = parseRealtimeMicrobatch(batch(), now);
  assert.equal(parsed.updates[0].canonicalSymbol, "2330.TW");
  assert.equal(parsed.updates[0].provider, "shioaji");
  assert.equal(REALTIME_CONTRACT_LIMITS.maxBatchUpdates, 32);

  assert.throws(
    () => parseRealtimeMicrobatch(batch({ sentAt: "2026-07-31T01:59:00Z" }), now),
    /realtime_payload_invalid/,
  );
  assert.throws(
    () => parseRealtimeMicrobatch(batch({ updates: [snapshot({ canonicalSymbol: "AAPL" })] }), now),
    /realtime_payload_invalid/,
  );
  assert.throws(
    () => parseRealtimeMicrobatch(batch({ updates: [snapshot(), snapshot()] }), now),
    /realtime_payload_duplicate_symbol/,
  );
  assert.throws(
    () => parseRealtimeMicrobatch(batch({ account: "must-not-cross-trust-boundary" }), now),
    /realtime_payload_invalid/,
  );
  assert.throws(
    () => parseRealtimeMicrobatch(batch({ updates: [snapshot({ bid: 101 })] }), now),
    /realtime_payload_invalid/,
  );
});

test("session Kbars bootstrap 維持 64 KiB／128 點上限與累計量", () => {
  const now = Date.parse("2026-07-31T02:00:00.300Z");
  const point = {
    canonicalSymbol: "2330.TW", exchange: "TWSE", sessionDate: "2026-07-31",
    sourceTime: "2026-07-31T09:00:00+08:00", receivedTime: "2026-07-31T10:00:00+08:00",
    open: 100, high: 102, low: 99, close: 101, averagePrice: 101,
    volume: 10, totalVolume: 10, sequence: 1, connectionId: "connection-a",
    provider: "shioaji", continuity: "complete", reasonCode: "none",
  };
  const parsed = parseRealtimeMicrobatch(JSON.stringify({ type: "session-bootstrap-v1", connectionId: "connection-a", sequence: 1, sentAt: "2026-07-31T02:00:00.200Z", points: [point] }), now);
  assert.equal(parsed.type, "session-bootstrap-v1");
  assert.equal(parsed.points[0].totalVolume, 10);
  assert.throws(() => parseRealtimeMicrobatch(JSON.stringify({ type: "session-bootstrap-v1", connectionId: "connection-a", sequence: 1, sentAt: "2026-07-31T02:00:00.200Z", points: Array(129).fill(point) }), now), /realtime_payload_invalid/);
});

test("瀏覽器訂閱去重且一頁最多八個 canonical symbols", () => {
  assert.deepEqual(
    parseBrowserSubscription(JSON.stringify({ type: "subscribe", symbols: ["2330.tw", "2330.TW", "8069.TWO"] })),
    { type: "subscribe", symbols: ["2330.TW", "8069.TWO"] },
  );
  assert.throws(
    () => parseBrowserSubscription(JSON.stringify({ type: "subscribe", symbols: Array.from({ length: 9 }, (_, index) => `${1000 + index}.TW`) })),
    /realtime_subscription_invalid/,
  );
  assert.throws(
    () => parseBrowserSubscription(JSON.stringify({ type: "subscribe", symbols: ["2330.TW"], token: "not-allowed" })),
    /realtime_subscription_invalid/,
  );
});

test("realtime 狀態依來源時間原子轉為 live、degraded、fallback 與 closing", () => {
  assert.equal(resolveRealtimeState({ enabled: true, gatewayConnected: true, sourceAgeMs: 1000, marketPhase: "open", fallbackAvailable: true }), "live");
  assert.equal(resolveRealtimeState({ enabled: true, gatewayConnected: true, sourceAgeMs: 6000, marketPhase: "open", fallbackAvailable: true }), "degraded");
  assert.equal(resolveRealtimeState({ enabled: true, gatewayConnected: true, sourceAgeMs: 16000, marketPhase: "open", fallbackAvailable: true }), "fallback");
  assert.equal(resolveRealtimeState({ enabled: true, gatewayConnected: false, sourceAgeMs: null, marketPhase: "closing", fallbackAvailable: true }), "closing");
  assert.equal(taiwanRealtimeMarketPhase(new Date("2026-07-31T02:00:00Z")), "open");
  assert.equal(taiwanRealtimeMarketPhase(new Date("2026-07-31T05:40:00Z")), "closing");
  assert.equal(taiwanRealtimeMarketPhase(new Date("2026-07-31T07:00:00Z")), "closed");
});

test("Cloudflare capability 預設 false，Sites 即使誤給 binding 仍固定停用", () => {
  const namespace = { getByName() { throw new Error("must_not_read_binding"); } };
  assert.equal(realtimeCapability({ DEPLOYMENT_TARGET: "cloudflare", SHIOAJI_REALTIME_ENABLED: "false", REALTIME_HUB: namespace }), false);
  assert.equal(realtimeCapability({ DEPLOYMENT_TARGET: "cloudflare", SHIOAJI_REALTIME_ENABLED: "true", REALTIME_HUB: namespace }), false);
  const cloudflare = { DEPLOYMENT_TARGET: "cloudflare", SHIOAJI_REALTIME_ENABLED: "true", SHIOAJI_INGEST_SECRET: "fixture-ingest-machine-value", REALTIME_HUB: namespace };
  assert.equal(realtimeCapability(cloudflare), true);
  assert.equal(realtimeViewerCapabilityForPrincipal(cloudflare, { kind: "user", deploymentTarget: "cloudflare", userId: "fixture-owner", accessUserId: "owner-1", accessRole: "owner" }), true);
  assert.equal(realtimeViewerCapabilityForPrincipal(cloudflare, { kind: "user", deploymentTarget: "cloudflare", userId: "fixture-member", accessUserId: "member-1", accessRole: "member" }), false);
  assert.equal(realtimeCapability({ DEPLOYMENT_TARGET: "codex-sites", SHIOAJI_REALTIME_ENABLED: "true", REALTIME_HUB: namespace }), false);
  assert.equal(realtimeCapability({ DEPLOYMENT_TARGET: "local", SHIOAJI_REALTIME_ENABLED: "true", REALTIME_LOCAL_TEST: "true", REALTIME_HUB: namespace }), true);
});

test("replay 與每日 realtime quota 依序 fail closed", () => {
  assert.equal(isRealtimeSequenceReplay(8, 8), true);
  assert.equal(isRealtimeSequenceReplay(8, 9), false);
  assert.equal(realtimeLoadSheddingForUsage(17_999), "none");
  assert.equal(realtimeLoadSheddingForUsage(18_000), "visible-only");
  assert.equal(realtimeLoadSheddingForUsage(19_000), "no-new-subscriptions");
  assert.equal(realtimeLoadSheddingForUsage(20_000), "ingest-paused");
});

test("ingest handshake 驗證獨立 secret、timestamp 與 connection ID 並只轉送安全 header", async () => {
  const forwarded = [];
  const env = {
    DEPLOYMENT_TARGET: "cloudflare",
    SHIOAJI_REALTIME_ENABLED: "true",
    SHIOAJI_INGEST_SECRET: "fixture-ingest-machine-value",
    REALTIME_HUB: { getByName() { return { async fetch(request) { forwarded.push(request); return new Response(null, { status: 204 }); } }; } },
  };
  const now = Date.now();
  const request = new Request("https://example.test/api/realtime/ingest", {
    headers: {
      upgrade: "websocket",
      "x-realtime-ingest-secret": "fixture-ingest-machine-value",
      "x-realtime-timestamp": String(now),
      "x-realtime-connection-id": "connection-a",
    },
  });
  const accepted = await handleRealtimeRoute(request, env);
  assert.equal(accepted.status, 204);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].headers.get("x-realtime-role"), "ingest");
  assert.equal(forwarded[0].headers.get("x-realtime-ingest-secret"), null);

  const rejected = await handleRealtimeRoute(new Request(request, { headers: { ...Object.fromEntries(request.headers), "x-realtime-ingest-secret": "wrong" } }), env);
  assert.equal(rejected.status, 403);

  const rotated = await handleRealtimeRoute(new Request(request, { headers: { ...Object.fromEntries(request.headers), "x-realtime-ingest-secret": "fixture-next-machine-value" } }), {
    ...env,
    SHIOAJI_INGEST_SECRET_NEXT: "fixture-next-machine-value",
  });
  assert.equal(rotated.status, 204);
});

test("新增台股商品經 Durable Object internal control 立即排入 gateway demand", async () => {
  const forwarded = [];
  const env = {
    DEPLOYMENT_TARGET: "local", SHIOAJI_REALTIME_ENABLED: "true", REALTIME_LOCAL_TEST: "true",
    REALTIME_HUB: { getByName() { return { async fetch(request) { forwarded.push(request); const body = await request.clone().json(); return Response.json({ ok: true, status: "queued", acceptedSymbolCount: body.symbols.length }); } }; } },
  };
  const request = new Request("http://127.0.0.1/api/instruments", { headers: { "oai-authenticated-user-email": "fixture-owner@example.test" } });
  await prepareRequestPrincipal(request, env);
  const result = await notifyRealtimeWatchlistSymbols(request, env, ["8069.two", "AAPL"]);
  assert.deepEqual(result, { status: "queued", acceptedSymbolCount: 1 });
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].headers.get("x-realtime-role"), "internal");
  const payload = await forwarded[0].json();
  assert.deepEqual(payload.symbols, ["8069.TWO"]);
  assert.match(payload.scopeId, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(payload), /fixture-owner/);

  const cleared = await notifyRealtimeWatchlistSymbols(request, env, []);
  assert.deepEqual(cleared, { status: "queued", acceptedSymbolCount: 0 });
  assert.deepEqual((await forwarded[1].json()).symbols, []);
  assert.deepEqual(await notifyRealtimeWatchlistSymbols(request, { ...env, SHIOAJI_REALTIME_ENABLED: "false" }, ["8069.TWO"]), { status: "disabled", acceptedSymbolCount: 0 });
});

test("個人清單刪除會送出 owner 完整需求快照並以空集合釋放", async (t) => {
  const service = await builtWorker();
  const db = new SqliteD1();
  t.after(() => db.close());
  const forwarded = [];
  const stockSetup = await readFile(new URL("../public/data/stock_setup.md", import.meta.url), "utf8");
  const env = {
    DB: db,
    DEPLOYMENT_TARGET: "local",
    SHIOAJI_REALTIME_ENABLED: "true",
    REALTIME_LOCAL_TEST: "true",
    ASSETS: { fetch: async () => new Response(stockSetup, { headers: { "content-type": "text/markdown" } }) },
    REALTIME_HUB: { getByName() { return { async fetch(request) {
      const body = await request.clone().json();
      forwarded.push(body);
      return Response.json({ ok: true, status: "queued", acceptedSymbolCount: body.symbols.length });
    } }; } },
  };
  const execution = { waitUntil() {}, passThroughOnException() {} };
  const invoke = async (path, init = {}) => {
    const request = new Request(`http://127.0.0.1${path}`, {
      ...init,
      headers: { "content-type": "application/json", "oai-authenticated-user-email": "fixture-owner@example.test", ...(init?.headers || {}) },
    });
    return service.fetch(request, env, execution);
  };

  assert.equal((await invoke("/api/instruments")).status, 200);
  db.database.prepare(`INSERT INTO user_instruments
    (user_id,item_id,symbol,name,provider,tab_id,tab_label,group_name,market,enabled)
    VALUES (?,?,?,?,?,?,?,?,?,1)`).run("fixture-owner@example.test", "one", "8069.TWO", "fixture-one", "yfinance", "", "台股", "fixture", "台灣股市");
  db.database.prepare(`INSERT INTO user_instruments
    (user_id,item_id,symbol,name,provider,tab_id,tab_label,group_name,market,enabled)
    VALUES (?,?,?,?,?,?,?,?,?,1)`).run("fixture-owner@example.test", "two", "2330.TW", "fixture-two", "yfinance", "", "台股", "fixture", "台灣股市");

  const deleted = await invoke("/api/instruments/8069.TWO", { method: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.deepEqual(forwarded.at(-1).symbols, ["2330.TW"]);
  const scopeId = forwarded.at(-1).scopeId;

  const cleared = await invoke("/api/instruments/2330.TW", { method: "DELETE" });
  assert.equal(cleared.status, 200);
  assert.deepEqual(forwarded.at(-1).symbols, []);
  assert.equal(forwarded.at(-1).scopeId, scopeId);
});

test("localhost simulation 可測完整 WebSocket 路徑但非 localhost 必須拒絕", async () => {
  const forwarded = [];
  const env = {
    DEPLOYMENT_TARGET: "local", SHIOAJI_REALTIME_ENABLED: "true", REALTIME_LOCAL_TEST: "true",
    REALTIME_HUB: { getByName() { return { async fetch(request) { forwarded.push(request); return new Response(null, { status: 204 }); } }; } },
  };
  const local = new Request(`http://127.0.0.1/api/realtime/ingest?simulation=true&timestamp=${Date.now()}&connectionId=local-simulation`, { headers: {
    upgrade: "websocket",
  } });
  assert.equal((await handleRealtimeRoute(local, env)).status, 204);
  const nonLocal = new Request("https://example.test/api/realtime/ingest", { headers: local.headers });
  assert.equal((await handleRealtimeRoute(nonLocal, env)).status, 403);
  assert.equal(forwarded[0].headers.get("x-realtime-local-simulation"), null);
});

test("Durable Object 使用 SQLite migration、hibernation attachment 且無 D1 Tick write", async () => {
  const [hubSource, appSource, configSource, viteSource] = await Promise.all([
    readFile(new URL("../worker/realtime-hub.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/app.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/cloudflare-config.mjs", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
  ]);
  assert.match(configSource, /new_sqlite_classes: \["RealtimeMarketHub"\]/);
  assert.match(configSource, /SHIOAJI_REALTIME_ENABLED: "false"/);
  assert.match(hubSource, /state\.acceptWebSocket\(server, \[role\]\)/);
  assert.match(hubSource, /serializeAttachment/);
  assert.match(hubSource, /realtime_session_batch_v2/);
  assert.match(hubSource, /realtime_new_subscriptions_paused/);
  assert.match(hubSource, /visibleSymbols\(\)/);
  assert.match(hubSource, /realtime_connection_retired/);
  assert.match(hubSource, /realtime_watchlist_demand/);
  assert.match(hubSource, /DELETE FROM realtime_watchlist_demand WHERE scope_id=\?/);
  assert.match(hubSource, /webSocketClose[\s\S]*sendGatewayDemand\(socket\)/);
  assert.match(appSource, /scheduleWatchlistChipPrewarm[\s\S]*syncRealtimeWatchlist\(request, env, uid\)/);
  assert.match(appSource, /realtime:\$\{realtimeViewerEnabled \? "owner" : "off"\}/);
  assert.match(hubSource, /d1TickWrites: 0/);
  assert.match(viteSource, /ENABLE_REALTIME_LOCAL_TEST/);
  assert.doesNotMatch(viteSource, /SHIOAJI_INGEST_SECRET/);
});
