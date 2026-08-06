import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/static/realtime-coordinator.js", import.meta.url), "utf8");

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    },
    dispatch(name, event = {}) {
      for (const callback of listeners.get(name) || []) callback(event);
    },
  };
}

function harness() {
  const sockets = [];
  const timers = new Map();
  const windowTarget = eventTarget();
  const documentTarget = eventTarget();
  let timerId = 0;
  let hidden = false;
  let online = true;
  let clock = Date.parse("2026-07-31T02:00:01Z");
  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      this.target = eventTarget();
      sockets.push(this);
    }
    addEventListener(...args) { this.target.addEventListener(...args); }
    send(value) { this.sent.push(JSON.parse(value)); }
    open() { this.readyState = 1; this.target.dispatch("open"); }
    message(payload) { this.target.dispatch("message", { data: JSON.stringify(payload) }); }
    close() { this.readyState = 3; }
    remoteClose() { this.readyState = 3; this.target.dispatch("close"); }
  }
  const sandbox = { globalThis: undefined };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  const coordinator = sandbox.QuoteChartRealtime.createRealtimeCoordinator({
    WebSocketImpl: FakeSocket,
    setTimeoutImpl(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeoutImpl(id) { timers.delete(id); },
    windowTarget,
    documentTarget,
    isHidden: () => hidden,
    isOnline: () => online,
    now: () => clock,
    location: { protocol: "https:", host: "example.test" },
  });
  return {
    coordinator, sockets, timers, windowTarget, documentTarget,
    setHidden(value) { hidden = value; },
    setOnline(value) { online = value; },
    setClock(value) { clock = Date.parse(value); },
    runTimer(delay) {
      const [id, timer] = [...timers].find(([, item]) => item.delay === delay) || [];
      assert.ok(timer, `找不到 ${delay}ms timer`);
      timers.delete(id);
      timer.callback();
    },
  };
}

function localHarness({ simulation = true } = {}) {
  const sources = [];
  const requests = [];
  const timers = new Map();
  const windowTarget = eventTarget();
  const documentTarget = eventTarget();
  documentTarget.hidden = false;
  let timerId = 0;
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.target = eventTarget();
      sources.push(this);
    }
    addEventListener(...args) { this.target.addEventListener(...args); }
    open() { this.onopen?.(); }
    emit(name, payload) { this.target.dispatch(name, { data: JSON.stringify(payload) }); }
    close() { this.closed = true; }
  }
  async function fetchImpl(input, init = {}) {
    const url = new URL(String(input), "http://127.0.0.1:5174");
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ path: url.pathname, search: url.search, method: init.method || "GET", body });
    if (url.pathname.endsWith("/api/v1/info")) return Response.json({ simulation });
    if (url.pathname.includes("/api/v1/data/contracts/")) return Response.json({ code: "2330", security_type: "STK", exchange: "TSE" });
    if (url.pathname.endsWith("/api/v1/stream/subscribe") || url.pathname.endsWith("/api/v1/stream/unsubscribe")) return Response.json({ ok: true });
    if (url.pathname.endsWith("/api/v1/data/snapshots")) return Response.json([{ datetime: "2026-08-06 09:01:00", open: 100, high: 102, low: 99, close: 101, average_price: 100.5, volume: 3, total_volume: 12 }]);
    if (url.pathname.endsWith("/api/v1/data/kbars")) return Response.json({
      datetime: ["2026-08-06 09:00:00", "2026-08-06 09:01:00"],
      Open: [100, 101], High: [102, 103], Low: [99, 100], Close: [101, 102], Volume: [5, 7], Amount: [505, 714],
    });
    throw new Error(`unexpected ${url.pathname}`);
  }
  const sandbox = { globalThis: undefined, Intl, Date, Map, Set, Symbol, URL, Response };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  const coordinator = sandbox.QuoteChartRealtime.createLocalShioajiCoordinator({
    fetchImpl,
    EventSourceImpl: FakeEventSource,
    windowTarget,
    documentTarget,
    setTimeoutImpl(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeoutImpl(id) { timers.delete(id); },
    setIntervalImpl() { return 1; },
    clearIntervalImpl() {},
  });
  return {
    coordinator, sources, requests,
    runTimer(delay) {
      const [id, timer] = [...timers].find(([, item]) => item.delay === delay) || [];
      assert.ok(timer, `找不到 ${delay}ms timer`);
      timers.delete(id);
      timer.callback();
    },
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

const update = (symbol = "2330.TW", sequence = 1) => ({ canonicalSymbol: symbol, sourceTime: "2026-07-31T02:00:00Z", sequence, close: 100 });

test("多 panel 共用一條 WebSocket 並送出去重後的可見商品", () => {
  const h = harness();
  const received = [];
  const stopA = h.coordinator.subscribe("panel-0", { symbol: "2330.TW" }, (item) => received.push(item));
  const stopB = h.coordinator.subscribe("panel-1", { symbol: "2317.TW" }, (item) => received.push(item));
  assert.equal(h.sockets.length, 1);
  h.sockets[0].open();
  assert.deepEqual(h.sockets[0].sent.at(-1).symbols, ["2330.TW", "2317.TW"]);
  h.sockets[0].message({ type: "market-batch-v1", updates: [update()] });
  assert.equal(received.length, 1);
  stopB();
  assert.deepEqual(h.sockets[0].sent.at(-1).symbols, ["2330.TW"]);
  stopA();
  assert.equal(h.coordinator.connectionCount(), 0);
});

test("初次 snapshot 先交付 session buffer 再接 latest", () => {
  const h = harness();
  const events = [];
  h.coordinator.subscribe("panel-0", { symbol: "2330.TW" }, () => events.push("latest"), () => {}, () => events.push("session"));
  h.sockets[0].open();
  h.sockets[0].message({ type: "snapshot", session: { "2330.TW": [{ time: 1 }] }, updates: [update()] });
  assert.deepEqual(events, ["session", "latest"]);
});

test("倒序／重送不覆蓋 latest，背景關線且回前景重新取得 snapshot", () => {
  const h = harness();
  const received = [];
  h.coordinator.subscribe("panel-0", { symbol: "2330.TW" }, (item) => received.push(item.sequence));
  h.sockets[0].open();
  h.sockets[0].message({ type: "snapshot", updates: [update("2330.TW", 2)] });
  h.sockets[0].message({ type: "market-batch-v1", updates: [update("2330.TW", 1)] });
  assert.deepEqual(received, [2]);
  h.setHidden(true);
  h.documentTarget.dispatch("visibilitychange");
  assert.equal(h.coordinator.connectionCount(), 0);
  h.setHidden(false);
  h.documentTarget.dispatch("visibilitychange");
  assert.equal(h.sockets.length, 2);
});

test("來源超過五秒顯示 degraded，超過十五秒原子切換 fallback", () => {
  const h = harness();
  const states = [];
  h.coordinator.subscribe("panel-0", { symbol: "2330.TW" }, () => {}, (value) => states.push(value.state));
  h.sockets[0].open();
  h.sockets[0].message({ type: "snapshot", updates: [update()] });
  h.setClock("2026-07-31T02:00:06Z");
  h.runTimer(1000);
  assert.equal(states.at(-1), "degraded");
  h.setClock("2026-07-31T02:00:16Z");
  h.runTimer(1000);
  assert.equal(states.at(-1), "fallback");
});

test("一頁第九個不同商品 fail closed", () => {
  const h = harness();
  for (let index = 0; index < 8; index += 1) h.coordinator.subscribe(`p${index}`, { symbol: `${2300 + index}.TW` }, () => {});
  assert.throws(() => h.coordinator.subscribe("p8", { symbol: "2400.TW" }, () => {}), /realtime_subscription_capacity/);
});

test("本機 coordinator 共用一條 SSE，先送 Snapshot 再交付當日 Kbars", async () => {
  const h = localHarness();
  const snapshots = [];
  const sessions = [];
  h.coordinator.subscribe("panel-0", { symbol: "2330.TW" }, (item) => snapshots.push(item), () => {}, (items) => sessions.push(items));
  await settle();
  assert.equal(h.sources.length, 1);
  h.sources[0].open();
  await settle();
  assert.equal(h.coordinator.connectionCount(), 1);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].canonicalSymbol, "2330.TW");
  assert.equal(sessions.length, 1);
  assert.deepEqual(Array.from(sessions[0], (item) => item.totalVolume), [5, 12]);
  assert.deepEqual(h.requests.filter((item) => item.method === "POST").map((item) => item.path), [
    "/local-shioaji/api/v1/stream/subscribe",
    "/local-shioaji/api/v1/data/snapshots",
    "/local-shioaji/api/v1/data/kbars",
  ]);
});

test("本機 coordinator 相同商品採 ref-count，最後面板離開後才 unsubscribe", async () => {
  const h = localHarness();
  const stopA = h.coordinator.subscribe("panel-a", { symbol: "2330.TW" }, () => {});
  const stopB = h.coordinator.subscribe("panel-b", { symbol: "2330.TW" }, () => {});
  await settle();
  h.sources[0].open();
  await settle();
  stopA();
  assert.equal(h.requests.some((item) => item.path.endsWith("/unsubscribe")), false);
  stopB();
  await settle();
  assert.equal(h.requests.filter((item) => item.path.endsWith("/unsubscribe")).length, 1);
});

test("本機 coordinator 在非 simulation 模式不建立 SSE 並顯示備援", async () => {
  const h = localHarness({ simulation: false });
  const states = [];
  h.coordinator.subscribe("panel-0", { symbol: "2330.TW" }, () => {}, (value) => states.push(value));
  await settle();
  assert.equal(h.sources.length, 0);
  assert.equal(h.requests.some((item) => item.path.endsWith("/contracts/2330")), false);
  assert.equal(states.at(-1)?.state, "fallback");
  assert.equal(states.at(-1)?.reasonCode, "simulation_required");
});
