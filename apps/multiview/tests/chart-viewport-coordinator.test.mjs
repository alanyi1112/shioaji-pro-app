import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/static/chart-interactions.js", import.meta.url), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));

function loadInteractions() {
  let now = 1000;
  let nextFrame = 1;
  const frames = new Map();
  const window = {
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, { window });
  return {
    interactions: window.QuoteChartInteractions,
    now: () => now,
    advance(ms) { now += ms; },
    flush() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(now));
    },
  };
}

function eventTarget(ownerWindow) {
  const listeners = new Map();
  return {
    ownerDocument: ownerWindow ? { defaultView: ownerWindow } : undefined,
    addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    dispatch(name, event = {}) { for (const listener of listeners.get(name) || []) listener(event); },
    listenerCount(name) { return listeners.get(name)?.size || 0; },
  };
}

test("程式性 range callback 不會污染最後接受範圍並排程回復", () => {
  const runtime = loadInteractions();
  const restored = [];
  const coordinator = runtime.interactions.createViewportCoordinator({
    generation: 7,
    isCurrent: (generation) => generation === 7,
    now: runtime.now,
    requestFrame: (callback) => runtime.interactions ? (runtime.flushFrame = callback, 1) : 0,
    cancelFrame() {},
    onRestore: (range) => restored.push(range),
  });
  coordinator.commit({ from: 0, to: 161 });
  assert.equal(coordinator.acceptCallback("technical", { from: 158, to: 319 }), false);
  runtime.flushFrame();
  assert.deepEqual(plain(restored), [{ from: 0, to: 161 }]);
  assert.deepEqual(plain(coordinator.acceptedRange()), { from: 0, to: 161 });
  assert.equal(coordinator.report().rejectedCallbackCount, 1);
});

test("source-scoped pointer 與 wheel 手勢可提交範圍且逾時後失效", () => {
  const runtime = loadInteractions();
  const coordinator = runtime.interactions.createViewportCoordinator({ generation: 1, now: runtime.now, wheelIntentMs: 200 });
  coordinator.commit({ from: 0, to: 161 });
  coordinator.beginGesture("technical", "pointer");
  assert.equal(coordinator.acceptCallback("technical", { from: 20, to: 80 }), true);
  assert.equal(coordinator.acceptCallback("chip:margin", { from: 30, to: 90 }), false);
  coordinator.endGesture("technical", "pointer");
  coordinator.beginGesture("chip:margin", "wheel");
  assert.equal(coordinator.acceptCallback("chip:margin", { from: 25, to: 70 }), true);
  runtime.advance(201);
  assert.equal(coordinator.acceptCallback("chip:margin", { from: 40, to: 100 }), false);
  assert.deepEqual(plain(coordinator.acceptedRange()), { from: 25, to: 70 });
  assert.equal(coordinator.hasUserInteracted(), true);
});

test("programmatic mutation 期間即使 source 有手勢也不接受 callback", () => {
  const runtime = loadInteractions();
  const coordinator = runtime.interactions.createViewportCoordinator({ generation: 1, now: runtime.now });
  coordinator.commit({ from: 0, to: 161 });
  coordinator.beginGesture("main", "pointer");
  coordinator.runProgrammatic(() => {
    assert.equal(coordinator.acceptCallback("main", { from: -383, to: 161 }), false);
  });
  assert.deepEqual(plain(coordinator.acceptedRange()), { from: 0, to: 161 });
});

test("舊 generation 不接受手勢、callback 或 repair", () => {
  const runtime = loadInteractions();
  let currentGeneration = 3;
  const coordinator = runtime.interactions.createViewportCoordinator({
    generation: 2,
    isCurrent: (generation) => generation === currentGeneration,
    now: runtime.now,
  });
  assert.equal(coordinator.commit({ from: 0, to: 161 }), false);
  assert.equal(coordinator.beginGesture("main", "pointer"), false);
  assert.equal(coordinator.acceptCallback("main", { from: 20, to: 40 }), false);
  assert.equal(coordinator.recordRepair({ from: 0, to: 161 }), false);
  currentGeneration = 2;
  assert.equal(coordinator.commit({ from: 0, to: 161 }), true);
});

test("初始 invariant 會拒絕貼左、貼右與過大空白，但允許使用者局部範圍", () => {
  const runtime = loadInteractions();
  const measure = runtime.interactions.measureInitialViewportInvariant;
  assert.equal(measure({ range: { from: 0, to: 161 }, candleCount: 160, firstCoordinate: 4, latestCoordinate: 1852, plotWidth: 1952, rightGapPass: true }).pass, true);
  const left = measure({ range: { from: 158, to: 319 }, candleCount: 160, firstCoordinate: -1830, latestCoordinate: 16, plotWidth: 1952, rightGapPass: false });
  assert.equal(left.pass, false);
  assert.match(left.errors.join(" "), /coverage|right blank|latest candle|right gap/);
  const oversized = measure({ range: { from: -383, to: 161 }, candleCount: 160, firstCoordinate: 1370, latestCoordinate: 1900, plotWidth: 1952, rightGapPass: true });
  assert.equal(oversized.pass, false);
  assert.match(oversized.errors.join(" "), /left blank/);
  assert.equal(measure({ range: { from: 80, to: 120 }, candleCount: 160, firstCoordinate: -100, latestCoordinate: 2500, plotWidth: 1952, rightGapPass: false, userInteracted: true }).pass, true);
});

test("多層副圖一般 wheel 不授權 viewport，修飾鍵 wheel 與 pointer lifecycle 才授權", () => {
  const runtime = loadInteractions();
  const ownerWindow = eventTarget();
  const surface = eventTarget(ownerWindow);
  const events = [];
  const cleanup = runtime.interactions.bindViewportIntent(surface, {
    source: "chip:margin",
    getMode: () => "multi",
    onStart: (event) => events.push(`start:${event.kind}`),
    onEnd: (event) => events.push(`end:${event.kind}`),
  });
  surface.dispatch("wheel", { altKey: false, ctrlKey: false, metaKey: false });
  assert.deepEqual(events, []);
  surface.dispatch("wheel", { altKey: true, ctrlKey: false, metaKey: false });
  surface.dispatch("pointerdown", { button: 0, pointerId: 9 });
  ownerWindow.dispatch("pointerup", { pointerId: 9 });
  assert.deepEqual(events, ["start:wheel", "start:pointer", "end:pointer"]);
  cleanup();
  assert.equal(surface.listenerCount("wheel"), 0);
  assert.equal(ownerWindow.listenerCount("pointerup"), 0);
});
