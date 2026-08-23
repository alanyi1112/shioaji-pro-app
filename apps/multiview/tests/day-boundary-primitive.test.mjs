import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/static/day-boundary-primitive.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../public/static/app.js", import.meta.url), "utf8");
const indexHtml = await readFile(new URL("../public/static/index.html", import.meta.url), "utf8");
const fixture = JSON.parse(await readFile(new URL("../../../test-fixtures/chart-day-volume-parity.json", import.meta.url), "utf8"));
const sandbox = { globalThis: undefined, Intl, Date, Set, Map, Object };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox);
const api = sandbox.QuoteChartDayBoundaries;

function time(datetime) {
  return Date.parse(`${datetime}+08:00`) / 1000;
}

function fakeChart(coordinates = new Map()) {
  return {
    timeScale() {
      return { timeToCoordinate: (value) => coordinates.get(value) ?? null };
    },
  };
}

function fakeSeries(chart, updates) {
  const attached = new Set();
  return {
    attached,
    attachPrimitive(primitive) {
      attached.add(primitive);
      primitive.attached({ chart, series: this, requestUpdate: () => updates.push("update") });
    },
    detachPrimitive(primitive) {
      attached.delete(primitive);
      primitive.detached();
    },
  };
}

function drawPrimitive(primitive, { horizontalPixelRatio = 2, height = 100 } = {}) {
  const calls = [];
  const context = {
    fillStyle: "",
    save() {},
    restore() {},
    fillRect(...args) { calls.push({ args, color: this.fillStyle }); },
  };
  primitive.paneViews()[0].renderer().draw({
    useBitmapCoordinateSpace(callback) {
      callback({ context, horizontalPixelRatio, bitmapSize: { width: 400, height } });
    },
  });
  return calls;
}

test("共享 fixture 只在支援的分鐘 K 台北換日時建立 boundary", () => {
  const candles = fixture.dayBoundary.candles.map((row) => ({ ...row, time: time(row.datetime) }));
  for (const interval of fixture.dayBoundary.supportedIntervals) {
    const boundaries = api.selectDayBoundaries(candles, interval);
    assert.deepEqual(Array.from(boundaries, (boundary) => [
      candles.findIndex((row) => row.time === boundary.previousTime),
      candles.findIndex((row) => row.time === boundary.nextTime),
    ]), fixture.dayBoundary.expectedBoundaryPairs);
  }
  assert.equal(api.selectDayBoundaries(candles, "60m").length, 1);
  for (const interval of fixture.dayBoundary.excludedIntervals) {
    assert.equal(api.selectDayBoundaries(candles, interval).length, 0);
  }
});

test("同日缺口不畫線，日期判斷固定使用 Asia/Taipei", () => {
  const sameTaipeiDate = [
    { time: Date.parse("2026-08-20T00:30:00+08:00") / 1000 },
    { time: Date.parse("2026-08-20T13:29:00+08:00") / 1000 },
  ];
  assert.equal(api.selectDayBoundaries(sameTaipeiDate, "1m").length, 0);
  assert.equal(api.sessionDateForTime(sameTaipeiDate[0].time), "2026-08-20");
});

test("5.0.9 series primitive 以亮黃色在中點畫 1.2 CSS px HiDPI 全高線", () => {
  const previousTime = 100;
  const nextTime = 200;
  const updates = [];
  const chart = fakeChart(new Map([[previousTime, 20], [nextTime, 30]]));
  const series = fakeSeries(chart, updates);
  const primitive = new api.DayBoundaryPrimitive();
  series.attachPrimitive(primitive);
  primitive.setData([{ previousTime, nextTime }]);
  assert.equal(updates.length, 1);
  assert.equal(primitive.paneViews()[0].zOrder(), "bottom");
  assert.equal(api.WIDTH_CSS_PX, 1.2);
  assert.deepEqual(drawPrimitive(primitive), [{ args: [48.8, 0, 2.4, 100], color: "#facc15" }]);
  assert.deepEqual(drawPrimitive(primitive, { horizontalPixelRatio: 1 }), [{ args: [24.4, 0, 1.2, 100], color: "#facc15" }]);
  assert.equal("hitTest" in primitive, false);
});

test("manager 對主圖與技術副圖只 attach 一次，更新、移除與 destroy 都 detach", () => {
  const updates = [];
  const chart = fakeChart(new Map([[100, 20], [200, 30]]));
  const main = fakeSeries(chart, updates);
  const technical = fakeSeries(chart, updates);
  const manager = new api.DayBoundarySeriesManager();
  const boundaries = [{ previousTime: 100, nextTime: 200 }];

  manager.reconcile([main, technical], boundaries);
  manager.reconcile([technical, main], boundaries);
  assert.equal(manager.size, 2);
  assert.equal(main.attached.size, 1);
  assert.equal(technical.attached.size, 1);
  assert.equal(updates.length, 4);

  manager.reconcile([main], boundaries);
  assert.equal(manager.size, 1);
  assert.equal(technical.attached.size, 0);
  manager.update(boundaries, "#fde047");
  assert.equal(updates.length, 6);
  manager.destroy();
  assert.equal(manager.size, 0);
  assert.equal(main.attached.size, 0);
});

test("production HTML 先載入 primitive，panel lifecycle 接到 payload、Tick、reconcile 與 destroy", () => {
  const primitiveScript = indexHtml.indexOf("/static/day-boundary-primitive.js");
  const appScript = indexHtml.indexOf("/static/app.js");
  assert.ok(primitiveScript >= 0 && primitiveScript < appScript);
  assert.match(appSource, /new window\.QuoteChartDayBoundaries\.DayBoundarySeriesManager\(\)/);
  assert.match(appSource, /applyPayloadStep\("day-boundaries", \(\) => refreshDayBoundaries\(candles\)\)/);
  assert.match(appSource, /refreshDayBoundaries\(result\.candles\)/);
  assert.match(appSource, /refreshDayBoundaries\(candles\)/);
  assert.match(appSource, /dayBoundaryManager\?\.destroy\?\.\(\)/);
});
