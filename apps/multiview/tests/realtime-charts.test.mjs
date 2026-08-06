import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/static/realtime-charts.js", import.meta.url), "utf8");
const sandbox = { globalThis: undefined, Intl, Date, Set, Map };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox);
const api = sandbox.QuoteChartRealtimeCharts;

const candle = (date, values = {}) => ({ time: Date.parse(`${date}T00:00:00+08:00`) / 1000, open: 10, high: 12, low: 9, close: 11, volume: 100, ...values });
const snapshot = (values = {}) => ({
  canonicalSymbol: "2330.TW", sessionDate: "2026-07-31", sourceTime: "2026-07-31T10:00:01+08:00", receivedTime: "2026-07-31T10:00:01.1+08:00",
  open: 20, high: 23, low: 19, close: 22, averagePrice: 21, tickVolume: 2, totalVolume: 50, sequence: 2,
  provider: "shioaji", continuity: "complete",
  ...values,
});

test("所有商品與 capability 都只保留日／週／月 K", () => {
  const base = ["1m", "1d", "1wk", "1mo"];
  assert.deepEqual(Array.from(api.availableIntervals(base, "2330.TW", true)), ["1d", "1wk", "1mo"]);
  assert.deepEqual(Array.from(api.availableIntervals(base, "2330.TW", false)), ["1d", "1wk", "1mo"]);
  assert.deepEqual(Array.from(api.availableIntervals(base, "AAPL", true)), ["1d", "1wk", "1mo"]);
});

test("日 K 原子取代 Yahoo 同日 provisional，不重複成交量", () => {
  const result = api.mergeRealtimeOverlay({ history: [candle("2026-07-30"), candle("2026-07-31", { volume: 999 })], interval: "1d", snapshot: snapshot() });
  assert.equal(result.candles.length, 2);
  assert.deepEqual({ open: result.candle.open, high: result.candle.high, low: result.candle.low, close: result.candle.close, volume: result.candle.volume }, { open: 20, high: 23, low: 19, close: 22, volume: 50 });
  assert.equal(result.candle.realtime.provisional, true);
});

test("週／月只聚合今日以前 canonical daily base 再加 Shioaji 今日量", () => {
  const daily = [
    candle("2026-07-27", { open: 15, high: 18, low: 14, close: 17, volume: 100 }),
    candle("2026-07-30", { open: 17, high: 21, low: 16, close: 20, volume: 120 }),
    candle("2026-07-31", { open: 99, high: 99, low: 1, close: 99, volume: 999 }),
  ];
  const weekly = api.mergeRealtimeOverlay({ history: [candle("2026-07-27", { volume: 1219 })], dailyHistory: daily, interval: "1wk", snapshot: snapshot() });
  assert.deepEqual({ open: weekly.candle.open, high: weekly.candle.high, low: weekly.candle.low, close: weekly.candle.close, volume: weekly.candle.volume }, { open: 15, high: 23, low: 14, close: 22, volume: 270 });
  const monthly = api.mergeRealtimeOverlay({ history: [candle("2026-07-01", { volume: 1219 })], dailyHistory: daily, interval: "1mo", snapshot: snapshot() });
  assert.equal(monthly.candle.volume, 270);
});

test("fallback／closed 不套 realtime overlay，保留完整 Yahoo snapshot", () => {
  const history = [candle("2026-07-31", { close: 19, volume: 999 })];
  for (const state of ["fallback", "closed"]) {
    const result = api.mergeRealtimeOverlay({ history, interval: "1d", snapshot: snapshot(), state });
    assert.equal(result.applied, false);
    assert.equal(result.candles[0].close, 19);
    assert.equal(result.candles[0].volume, 999);
  }
});

test("收盤 overlay 只在同交易日 canonical 官方核對完成後交接", () => {
  assert.equal(api.canonicalHandoffReady({ quote: { sessionDate: "2026-07-31", verification: { status: "verified" } } }, snapshot()), true);
  assert.equal(api.canonicalHandoffReady({ quote: { sessionDate: "2026-07-31", verification: { status: "pending" } } }, snapshot()), false);
  assert.equal(api.canonicalHandoffReady({ realtimeCanonicalHandoff: { sessionDate: "2026-07-31", verificationStatus: "verified" } }, snapshot()), true);
  assert.equal(api.canonicalHandoffReady({ realtimeCanonicalHandoff: { sessionDate: "2026-07-30", verificationStatus: "verified" } }, snapshot()), false);
});

test("分時逐筆依序更新價格均價並以一分鐘 bucket 計算 volume delta", () => {
  const trend = api.createIntradayAccumulator({ previousClose: 19 });
  assert.equal(trend.append(snapshot({ sourceTime: "2026-07-31T09:00:01+08:00", sequence: 1, close: 20, totalVolume: 10, tickVolume: 2 })), true);
  assert.equal(trend.append(snapshot({ sourceTime: "2026-07-31T09:00:30+08:00", sequence: 2, close: 21, totalVolume: 13, tickVolume: 3 })), true);
  assert.equal(trend.append(snapshot({ sourceTime: "2026-07-31T09:00:30+08:00", sequence: 2, close: 99, totalVolume: 99 })), false);
  assert.equal(trend.append(snapshot({ sourceTime: "2026-07-31T09:01:01+08:00", sequence: 3, close: 20.5, totalVolume: 18, tickVolume: 5 })), true);
  const result = trend.snapshot();
  assert.deepEqual(Array.from(result.prices, (row) => row.value), [20, 21, 20.5]);
  assert.deepEqual(Array.from(result.volumes, (row) => row.value), [5, 5]);
  assert.equal(result.summary.previousClose, 19);
  assert.equal(result.summary.totalVolume, 18);
});

test("分時跨日清除前日資料，舊 session 不可倒退", () => {
  const trend = api.createIntradayAccumulator();
  trend.append(snapshot({ sessionDate: "2026-07-31", sourceTime: "2026-07-31T13:29:00+08:00" }));
  trend.append(snapshot({ sessionDate: "2026-08-03", sourceTime: "2026-08-03T09:00:00+08:00", sequence: 1 }));
  assert.equal(trend.append(snapshot({ sessionDate: "2026-07-31", sourceTime: "2026-07-31T13:30:00+08:00", sequence: 9 })), false);
  assert.equal(trend.snapshot().prices.length, 1);
});

test("分時先載入 minute session 再接 Tick，不重複累加回補成交量", () => {
  const trend = api.createIntradayAccumulator({ previousClose: 19 });
  trend.loadMinuteSession([
    { time: 100, sourceTime: Date.parse("2026-07-31T09:00:59+08:00"), close: 20, averagePrice: 20, volume: 10, totalVolume: 10, continuity: "complete" },
    { time: 160, sourceTime: Date.parse("2026-07-31T09:01:59+08:00"), close: 21, averagePrice: 20.5, volume: 10, totalVolume: 20, continuity: "complete" },
  ], { sessionDate: "2026-07-31", open: 20, high: 21, low: 20 });
  trend.append(snapshot({ sourceTime: "2026-07-31T09:02:01+08:00", sequence: 3, close: 22, totalVolume: 25, tickVolume: 5 }));
  const model = trend.snapshot();
  assert.deepEqual(Array.from(model.volumes, (row) => row.value), [10, 10, 5]);
  assert.equal(model.summary.totalVolume, 25);
});
