import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/static/chart-payload.js", import.meta.url), "utf8");
const turnoverSource = await readFile(new URL("../public/static/kbar-turnover.js", import.meta.url), "utf8");
const sandbox = { globalThis: undefined, JSON, Number };
sandbox.globalThis = sandbox;
vm.runInNewContext(turnoverSource, sandbox);
vm.runInNewContext(source, sandbox);
const api = sandbox.QuoteChartPayload;

test("payload prepare 只保留可繪製 K 線且不以零值取代無效價格", () => {
  const prepared = api.preparePayload({
    candles: [
      { time: 1, open: "10", high: 12, low: 9, close: 11, volume: 100 },
      { time: 2, open: null, high: 13, low: 10, close: 12, volume: 200 },
      { time: null, open: 11, high: 13, low: 10, close: 12, volume: 200 },
    ],
    indicators: {},
  });
  assert.equal(prepared.candles.length, 1);
  assert.deepEqual(
    { open: prepared.candles[0].open, high: prepared.candles[0].high, low: prepared.candles[0].low, close: prepared.candles[0].close },
    { open: 10, high: 12, low: 9, close: 11 },
  );
});

test("line 與 histogram 的 null、undefined、NaN、Infinity 不進入圖表", () => {
  const prepared = api.preparePayload({
    candles: [
      { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { time: 2, open: 11, high: 13, low: 10, close: 12, volume: 120 },
    ],
    indicators: {
      moving_average: { ma5: [{ time: 1, value: null }, { time: 2, value: 12.5 }] },
      macd: { histogram: [{ time: 1, value: Number.NaN }, { time: 2, value: -1, color: "#16a34a" }] },
      atr: [{ time: 1, value: Number.POSITIVE_INFINITY }, { time: 2, value: "0.63" }],
    },
  });
  assert.deepEqual(Array.from(prepared.indicators.moving_average.ma5, (row) => row.value), [12.5]);
  assert.deepEqual(Array.from(prepared.indicators.macd.histogram, (row) => row.value), [-1]);
  assert.equal(prepared.indicators.macd.histogram[0].color, "#16a34a");
  assert.deepEqual(Array.from(prepared.indicators.atr, (row) => row.value), [0.63]);
});

test("whitespace series 保留有效時間但不捏造數值", () => {
  const result = api.normalizeValueSeries([
    { time: 1, value: null },
    { time: 2, value: 8 },
    { time: null, value: 9 },
  ], { preserveWhitespace: true });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [{ time: 1 }, { time: 2, value: 8 }]);
});

test("完全沒有可繪製 K 線時拒絕 payload", () => {
  assert.throws(
    () => api.preparePayload({ candles: [{ time: 1, open: null, high: 2, low: 1, close: 1 }], indicators: {} }),
    (error) => error.code === "invalid-chart-payload",
  );
});

test("render signature 忽略非視覺快取 metadata，但會辨識行情變化", () => {
  const base = api.preparePayload({
    candles: [{ time: 1, open: 10, high: 12, low: 9, close: 11, volume: 100 }],
    indicators: { volume: [{ time: 1, value: 100 }] },
    quote: { close: 11 },
    dataWindow: { cache: { fetchedAt: "first" } },
  });
  const metadataOnly = { ...base, dataWindow: { cache: { fetchedAt: "second" } } };
  const changed = { ...base, quote: { close: 12 } };
  const turnoverChanged = {
    ...base,
    candles: base.candles.map((candle) => ({
      ...candle,
      turnoverTwd: 10_000,
      turnoverSchemaRevision: "multiview-kbar-turnover/1",
    })),
  };
  assert.equal(api.renderSignature(base), api.renderSignature(metadataOnly));
  assert.notEqual(api.renderSignature(base), api.renderSignature(changed));
  assert.notEqual(api.renderSignature(base), api.renderSignature(turnoverChanged));
});

test("指標 series 只保留 canonical candle time domain", () => {
  const prepared = api.preparePayload({
    candles: [
      { time: 2, open: 10, high: 12, low: 9, close: 11 },
      { time: 3, open: 11, high: 13, low: 10, close: 12 },
    ],
    indicators: {
      kd: {
        k: [{ time: 1, value: 20 }, { time: 2, value: 30 }, { time: 3, value: 40 }, { time: 4, value: 50 }],
        d: [{ time: 2, value: null }, { time: 3, value: 35 }],
      },
      macd: {
        histogram: [{ time: 1, value: -1, color: "green" }, { time: 2, value: 1, color: "red" }],
      },
    },
  });
  assert.deepEqual(Array.from(prepared.indicators.kd.k, (row) => row.time), [2, 3]);
  assert.deepEqual(Array.from(prepared.indicators.kd.d, (row) => row.time), [3]);
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.indicators.macd.histogram)), [{ time: 2, value: 1, color: "red" }]);
});

test("screen X 只在扣除價格軸後的 plot 內轉成圖表座標", () => {
  assert.equal(api.plotCoordinateForScreenX(125, 100, 500, 72), 25);
  assert.equal(api.plotCoordinateForScreenX(528, 100, 500, 72), 428);
  assert.equal(api.plotCoordinateForScreenX(99, 100, 500, 72), undefined);
  assert.equal(api.plotCoordinateForScreenX(529, 100, 500, 72), undefined);
});

test("chart payload保留current-schema成交值，無來源為null，拒絕舊schema與偽造值", () => {
  const prepared = api.preparePayload({
    candles: [
      { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 100, turnoverTwd: 1_000_000, turnoverSchemaRevision: "multiview-kbar-turnover/1" },
      { time: 2, open: 11, high: 13, low: 10, close: 12, volume: 120 },
    ],
    indicators: {},
  });
  assert.deepEqual(Array.from(prepared.candles, (row) => row.turnoverTwd), [1_000_000, null]);
  assert.equal(prepared.turnoverSchemaRevision, "multiview-kbar-turnover/1");
  assert.throws(() => api.preparePayload({ candles: [{ time: 1, open: 10, high: 12, low: 9, close: 11, turnoverTwd: 1, turnoverSchemaRevision: "multiview-kbar-turnover/0" }] }), (error) => error.code === "invalid-turnover-schema");
  assert.throws(() => api.preparePayload({ candles: [{ time: 1, open: 10, high: 12, low: 9, close: 11, turnoverTwd: "1e3", turnoverSchemaRevision: "multiview-kbar-turnover/1" }] }), (error) => error.code === "invalid-turnover-value");
});
