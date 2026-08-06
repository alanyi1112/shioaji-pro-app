import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/static/live-batch-coordinator.js", import.meta.url), "utf8");

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    dispatch(name) {
      for (const listener of listeners.get(name) || []) listener();
    },
  };
}

function createHarness() {
  const timers = new Map();
  const requests = [];
  const pendingResponses = [];
  const windowTarget = createEventTarget();
  const documentTarget = createEventTarget();
  let nextTimerId = 1;
  let hidden = false;
  let online = true;
  const sandbox = {
    globalThis: undefined,
    fetch() {},
    setTimeout() {},
    clearTimeout() {},
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  const coordinator = sandbox.QuoteChartLiveBatch.createLiveBatchCoordinator({
    fetchImpl(url, options) {
      requests.push({ url, body: JSON.parse(options.body) });
      return new Promise((resolve) => pendingResponses.push(resolve));
    },
    setTimeoutImpl(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeoutImpl(id) {
      timers.delete(id);
    },
    windowTarget,
    documentTarget,
    isHidden: () => hidden,
    isOnline: () => online,
  });

  return {
    coordinator,
    documentTarget,
    requests,
    timers,
    windowTarget,
    setHidden(value) { hidden = value; },
    setOnline(value) { online = value; },
    runNextTimer(expectedDelay) {
      const [id, timer] = [...timers.entries()].sort((a, b) => a[0] - b[0])[0] || [];
      assert.ok(timer, "預期有排定中的 batch timer");
      assert.equal(timer.delay, expectedDelay);
      timers.delete(id);
      timer.callback();
    },
    resolveNext(items) {
      const resolve = pendingResponses.shift();
      assert.ok(resolve, "預期有等待中的 batch response");
      resolve({
        ok: true,
        async json() { return { ok: true, items }; },
      });
    },
  };
}

async function flushAsyncRun() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("新 subscription 於 in-flight 後立即補跑，恢復事件取代低頻 timer，取消後不再請求", async () => {
  const harness = createHarness();
  const payloads = [];
  const stopA = harness.coordinator.subscribe("panel-0", { symbol: "2330.TW", interval: "1d" }, (item) => payloads.push(item.id));
  harness.runNextTimer(0);
  assert.deepEqual(harness.requests[0].body.requests.map((item) => item.id), ["panel-0"]);

  const stopB = harness.coordinator.subscribe("panel-1", { symbol: "2317.TW", interval: "1d" }, (item) => payloads.push(item.id));
  assert.equal(harness.timers.size, 0);
  harness.resolveNext([
    { id: "panel-0", ok: true, payload: { quote: { marketSession: "open" } } },
  ]);
  await flushAsyncRun();
  harness.runNextTimer(0);
  assert.deepEqual(harness.requests[1].body.requests.map((item) => item.id), ["panel-0", "panel-1"]);

  harness.resolveNext([
    { id: "panel-0", ok: true, payload: { quote: { marketSession: "open" } } },
    { id: "panel-1", ok: true, payload: { quote: { marketSession: "open" } } },
  ]);
  await flushAsyncRun();
  assert.deepEqual(payloads, ["panel-0", "panel-0", "panel-1"]);
  assert.equal([...harness.timers.values()][0]?.delay, 30000);

  harness.documentTarget.dispatch("visibilitychange");
  assert.equal(harness.timers.size, 1);
  harness.runNextTimer(0);
  stopB();
  harness.resolveNext([
    { id: "panel-0", ok: true, payload: { quote: { marketSession: "open" } } },
    { id: "panel-1", ok: true, payload: { quote: { marketSession: "open" } } },
  ]);
  await flushAsyncRun();
  assert.equal(payloads.at(-1), "panel-0");

  harness.windowTarget.dispatch("online");
  harness.runNextTimer(0);
  assert.deepEqual(harness.requests.at(-1).body.requests.map((item) => item.id), ["panel-0"]);
  harness.resolveNext([
    { id: "panel-0", ok: true, payload: { quote: { marketSession: "open" } } },
  ]);
  await flushAsyncRun();
  stopA();
  assert.equal(harness.timers.size, 0);
});

test("相同 panel ID 在 in-flight 期間被替換時不接收舊 response", async () => {
  const harness = createHarness();
  const oldPayloads = [];
  const newPayloads = [];
  const stopOld = harness.coordinator.subscribe("panel-0", { symbol: "2330.TW", interval: "1d" }, (item) => oldPayloads.push(item.payload.symbol));
  harness.runNextTimer(0);
  assert.equal(harness.requests[0].body.requests[0].symbol, "2330.TW");

  stopOld();
  const stopNew = harness.coordinator.subscribe("panel-0", { symbol: "2317.TW", interval: "1d" }, (item) => newPayloads.push(item.payload.symbol));
  harness.resolveNext([
    { id: "panel-0", ok: true, payload: { symbol: "2330.TW", quote: { marketSession: "open" } } },
  ]);
  await flushAsyncRun();
  assert.deepEqual(oldPayloads, []);
  assert.deepEqual(newPayloads, []);

  harness.runNextTimer(0);
  assert.equal(harness.requests[1].body.requests[0].symbol, "2317.TW");
  harness.resolveNext([
    { id: "panel-0", ok: true, payload: { symbol: "2317.TW", quote: { marketSession: "open" } } },
  ]);
  await flushAsyncRun();
  assert.deepEqual(newPayloads, ["2317.TW"]);
  stopNew();
});

test("hidden 或 offline 時不送出 request，保留一分鐘 bounded retry", () => {
  const hiddenHarness = createHarness();
  hiddenHarness.setHidden(true);
  const stopHidden = hiddenHarness.coordinator.subscribe("panel-0", { symbol: "2330.TW", interval: "1d" }, () => {});
  hiddenHarness.runNextTimer(0);
  assert.equal(hiddenHarness.requests.length, 0);
  assert.equal([...hiddenHarness.timers.values()][0]?.delay, 60000);
  stopHidden();

  const offlineHarness = createHarness();
  offlineHarness.setOnline(false);
  const stopOffline = offlineHarness.coordinator.subscribe("panel-0", { symbol: "2330.TW", interval: "1d" }, () => {});
  offlineHarness.runNextTimer(0);
  assert.equal(offlineHarness.requests.length, 0);
  assert.equal([...offlineHarness.timers.values()][0]?.delay, 60000);
  stopOffline();
});
