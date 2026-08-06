import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const appSource = await readFile(new URL("../public/static/app.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../public/static/index.html", import.meta.url), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `找不到 ${name}`);
  const bodyStart = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`無法解析 ${name}`);
}

const sandbox = {};
vm.runInNewContext(`${extractFunction(appSource, "createLifecycleRegistry")}; this.createLifecycleRegistry = createLifecycleRegistry;`, sandbox);

function createScheduler() {
  let nextId = 1;
  const frames = new Map();
  const timers = new Map();
  const cancelledFrames = [];
  const clearedTimers = [];
  return {
    requestFrame(callback) {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      cancelledFrames.push(id);
      frames.delete(id);
    },
    setTimer(callback) {
      const id = nextId++;
      timers.set(id, callback);
      return id;
    },
    clearTimer(id) {
      clearedTimers.push(id);
      timers.delete(id);
    },
    runFrame(id) {
      const callback = frames.get(id);
      frames.delete(id);
      callback?.();
    },
    runTimer(id) {
      const callback = timers.get(id);
      timers.delete(id);
      callback?.();
    },
    cancelledFrames,
    clearedTimers,
  };
}

test("舊 render generation 的 frame 與 timer 不會執行", () => {
  const scheduler = createScheduler();
  let currentGeneration = 1;
  const lifecycle = sandbox.createLifecycleRegistry({
    isCurrent: () => currentGeneration === 1,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
  });
  let calls = 0;
  const frame = lifecycle.requestFrame(() => { calls += 1; });
  const timer = lifecycle.setTimer(() => { calls += 1; }, 1);

  currentGeneration = 2;
  scheduler.runFrame(frame);
  scheduler.runTimer(timer);

  assert.equal(calls, 0);
  assert.equal(lifecycle.isActive(), false);
});

test("dispose 取消排程、反向執行 cleanup 且可重複呼叫", () => {
  const scheduler = createScheduler();
  const lifecycle = sandbox.createLifecycleRegistry({
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
  });
  const order = [];
  const frame = lifecycle.requestFrame(() => order.push("frame"));
  const timer = lifecycle.setTimer(() => order.push("timer"), 1);
  lifecycle.addCleanup(() => order.push("first"));
  lifecycle.addCleanup(() => order.push("second"));

  assert.equal(lifecycle.dispose(), true);
  assert.equal(lifecycle.dispose(), false);
  scheduler.runFrame(frame);
  scheduler.runTimer(timer);

  assert.deepEqual(order, ["second", "first"]);
  assert.deepEqual(scheduler.cancelledFrames, [frame]);
  assert.deepEqual(scheduler.clearedTimers, [timer]);
  assert.equal(lifecycle.isActive(), false);
});

test("快速重建採 latest-wins，只有最後 generation 可完成工作", () => {
  const scheduler = createScheduler();
  let currentGeneration = 1;
  const calls = [];
  const first = sandbox.createLifecycleRegistry({
    isCurrent: () => currentGeneration === 1,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
  });
  const firstFrame = first.requestFrame(() => calls.push("first"));

  currentGeneration = 2;
  first.dispose();
  const second = sandbox.createLifecycleRegistry({
    isCurrent: () => currentGeneration === 2,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
  });
  const secondFrame = second.requestFrame(() => calls.push("second"));
  scheduler.runFrame(firstFrame);
  scheduler.runFrame(secondFrame);

  assert.deepEqual(calls, ["second"]);
});

test("panel teardown 先失效 generation、解除 chart subscriptions，再移除實例", () => {
  assert.match(appSource, /panelRenderGeneration:\s*0/);
  assert.match(appSource, /const renderGeneration = state\.panelRenderGeneration \+ 1;[\s\S]*state\.panelRenderGeneration = renderGeneration;[\s\S]*const previousPanels = state\.panels;[\s\S]*state\.panels = \[\];[\s\S]*previousPanels\.forEach\(\(panel\) => panel\.destroy\(\)\)/);
  assert.match(appSource, /createPanel\(index, renderGeneration\)/);
  assert.match(appSource, /destroy\(\) \{\s*if \(destroyed\) return;\s*destroyed = true;\s*realtimeIndicatorScheduler\.cancel\(\);\s*panelLifecycle\.dispose\(\)/);
  assert.match(appSource, /chart = undefined;\s*indicatorChart = undefined;[\s\S]*unsubscribeCrosshairMove[\s\S]*unsubscribeVisibleLogicalRangeChange[\s\S]*indicatorChartToRemove\?\.remove[\s\S]*chartToRemove\?\.remove/);
});

test("ATR price scale 只在 ATR series 建立後設定", () => {
  const start = appSource.indexOf("function renderIndicatorChart");
  const end = appSource.indexOf("function renderVolumeProfile", start);
  const source = appSource.slice(start, end);
  const seriesIndex = source.indexOf('upsertIndicatorLine("atr"');
  const scaleIndex = source.indexOf("indicatorChart.priceScale(ATR_PRICE_SCALE_ID).applyOptions");
  assert.ok(seriesIndex >= 0);
  assert.ok(scaleIndex > seriesIndex);
});

test("即時技術指標刷新會重用既有主副圖 series", () => {
  assert.match(appSource, /if \(movingAverageSeries\.length !== values\.length\)[\s\S]*values\.forEach\(\(data, index\) => movingAverageSeries\[index\]\.setData/);
  assert.match(appSource, /if \(bollingerSeries\.length !== values\.length\)[\s\S]*values\.forEach\(\(data, index\) => bollingerSeries\[index\]\.setData/);
  assert.match(appSource, /function upsertIndicatorLine[\s\S]*indicatorSeriesByKey\.get\(key\)[\s\S]*series\.setData\(compactSeries\(data\)\)/);
  assert.match(appSource, /selectionSignature !== indicatorSelectionSignature[\s\S]*indicatorSeries = removeIndicatorSeries/);
});

test("payload 正規化模組在 app 之前載入", () => {
  const payloadIndex = htmlSource.indexOf("/static/chart-payload.js");
  const appIndex = htmlSource.indexOf("/static/app.js");
  assert.ok(payloadIndex >= 0);
  assert.ok(appIndex > payloadIndex);
});

test("快取後前景更新先完成圖表套用再提交 cache", () => {
  const loadSource = extractFunction(appSource, "load");
  const applyIndex = loadSource.indexOf("applyPayload(preparedPayload, { prepared: true })");
  const cacheIndex = loadSource.indexOf("writePanelPayloadCache(symbol, interval, preparedPayload, pivotMode)");
  assert.ok(applyIndex >= 0);
  assert.ok(cacheIndex > applyIndex);
  assert.match(loadSource, /nextRenderSignature !== lastPayloadRenderSignature/);
  assert.match(loadSource, /圖表更新失敗，已保留原有資料/);
});

test("初次 refit 使用 logical range，不對暫時空白的技術副圖呼叫 time range", () => {
  const source = extractFunction(appSource, "refitTimeScalesToCandles");
  assert.match(source, /visibleLogicalRangeForCandles\(candles, RIGHT_OFFSET_BARS\)/);
  assert.match(source, /indicatorChart\.timeScale\(\)\.setVisibleLogicalRange\(logicalRange\)/);
  assert.match(source, /chipPaneManager\?\.syncRange\?\.\(logicalRange\)/);
  assert.doesNotMatch(source, /indicatorChart\.timeScale\(\)\.setVisibleRange\(range\)/);
});

test("apply 失敗會還原 last payload 並記錄安全階段代碼", () => {
  const source = extractFunction(appSource, "applyPayload");
  assert.match(source, /const previousPayload = lastPayload/);
  assert.match(source, /catch \(error\) \{\s*lastPayload = previousPayload;\s*throw error;/);
  assert.match(appSource, /status\.dataset\.chartApplyStage = String\(error\?\.chartApplyStage \|\| ""\)/);
});
