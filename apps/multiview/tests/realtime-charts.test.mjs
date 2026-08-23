import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/static/realtime-charts.js", import.meta.url), "utf8");
const fixture = JSON.parse(await readFile(new URL("../../../test-fixtures/chart-day-volume-parity.json", import.meta.url), "utf8"));
const sandbox = { globalThis: undefined, Intl, Date, Set, Map };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox);
const api = sandbox.QuoteChartRealtimeCharts;

const candle = (date, values = {}) => ({ time: Date.parse(`${date}T00:00:00+08:00`) / 1000, open: 10, high: 12, low: 9, close: 11, volume: 100, ...values });
const snapshot = (values = {}) => ({
  canonicalSymbol: "2330.TW", sessionDate: "2026-07-31", sourceTime: "2026-07-31T10:00:01+08:00", receivedTime: "2026-07-31T10:00:01.1+08:00",
  securityType: "STK",
  open: 20, high: 23, low: 19, close: 22, averagePrice: 21, tickVolume: 2, totalVolume: 50, sequence: 2,
  provider: "shioaji", continuity: "complete",
  ...values,
});

test("本機 capability 開啟分鐘 K，遠端仍只保留日／週／月", () => {
  const base = ["1m", "5m", "15m", "1h", "1d", "1wk", "1mo"];
  assert.deepEqual(Array.from(api.availableIntervals(base, "2330.TW", true)), base);
  assert.deepEqual(Array.from(api.availableIntervals(base, "2330.TW", false)), ["1d", "1wk", "1mo"]);
});

test("舊週月設定維持原值，只有分時與非法 interval 遷移為 1d", () => {
  for (const legacy of ["intraday", "3m", "60m", ""]) {
    assert.equal(api.normalizeLocalInterval(legacy), "1d");
  }
  for (const interval of ["1m", "5m", "15m", "1h", "1d", "1wk", "1mo"]) {
    assert.equal(api.normalizeLocalInterval(interval), interval);
  }
});

test("1 分 canonical 依台北交易日聚合 5／15／60 分且不補造缺口", () => {
  const point = (iso, values = {}) => ({
    time: Date.parse(iso) / 1000, sourceTime: Date.parse(iso),
    open: 100, high: 102, low: 99, close: 101, volume: 5, continuity: "complete", ...values,
  });
  const rows = [
    point("2026-08-07T09:00:00+08:00"),
    point("2026-08-07T09:01:00+08:00", { open: 101, high: 104, low: 100, close: 103, volume: 7 }),
    point("2026-08-07T09:07:00+08:00", { open: 103, high: 105, low: 102, close: 104, volume: 3 }),
    point("2026-08-10T09:00:00+08:00", { open: 110, high: 111, low: 109, close: 110, volume: 9 }),
  ];
  const five = api.aggregateMinuteCandles(rows, "5m");
  assert.equal(five.length, 3);
  assert.deepEqual({ open: five[0].open, high: five[0].high, low: five[0].low, close: five[0].close, volume: five[0].volume }, { open: 100, high: 104, low: 99, close: 103, volume: 12 });
  assert.equal(five[1].continuity, "partial");
  assert.equal(five[2].time, rows[3].time);
  assert.equal(api.aggregateMinuteCandles(rows, "1h").length, 2);
  assert.equal(api.aggregateMinuteCandles(rows, "1wk").length, 0);
});

test("Shioaji 1 分 Kbars 依台北日期聚合完整日 K，volume 維持 common_lot identity", () => {
  const rows = fixture.shioajiDailyAggregation.candles.map((row) => ({
    ...row,
    time: Date.parse(`${row.datetime}+08:00`) / 1000,
    sourceTime: Date.parse(`${row.datetime}+08:00`),
    continuity: "complete",
  }));
  const daily = api.aggregateDailyCandles(rows);
  assert.deepEqual(Array.from(daily, (row) => ({
    date: row.sessionDate, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume,
  })), fixture.shioajiDailyAggregation.expectedDaily);
  assert.ok(daily.every((row) => row.provider === "shioaji-kbars"));
});

test("日 K accumulator 由 Kbars total seed，同 session 只收前進 delta，新 session 以整日 Snapshot 原子 bootstrap", () => {
  const points = [
    { time: Date.parse("2026-08-21T09:00:00+08:00") / 1000, sourceTime: Date.parse("2026-08-21T09:00:59+08:00"), open: 100, high: 101, low: 99, close: 100, volume: 40, continuity: "complete" },
    { time: Date.parse("2026-08-21T09:01:00+08:00") / 1000, sourceTime: Date.parse("2026-08-21T09:01:59+08:00"), open: 100, high: 102, low: 100, close: 101, volume: 60, continuity: "complete" },
  ];
  const accumulator = api.createDailyKlineAccumulator({ identity: "2330.TW|1d|7" });
  accumulator.bootstrap(points);
  assert.equal(accumulator.append(snapshot({ sessionDate: "2026-08-21", sourceTime: "2026-08-21T09:02:01+08:00", sequence: 11, totalVolume: 103, open: 100, high: 103, low: 99, close: 102 })), true);
  assert.equal(accumulator.snapshot().candles.at(-1).volume, 103);
  assert.equal(accumulator.append(snapshot({ sessionDate: "2026-08-21", sourceTime: "2026-08-21T09:02:01+08:00", sequence: 11, totalVolume: 103 })), false);
  assert.equal(accumulator.append(snapshot({ sessionDate: "2026-08-21", sourceTime: "2026-08-21T09:03:01+08:00", sequence: 12, totalVolume: 102 })), false);
  assert.equal(accumulator.append(snapshot({ sessionDate: "2026-08-20", sourceTime: "2026-08-20T13:29:00+08:00", sequence: 99, totalVolume: 999 })), false);
  assert.equal(accumulator.append(snapshot({ sessionDate: "2026-08-24", sourceTime: "2026-08-24T09:00:01+08:00", sequence: 1, totalVolume: 1 })), true);
  assert.equal(accumulator.snapshot().candles.at(-1).volume, 1);
  assert.equal(accumulator.append(snapshot({ sessionDate: "2026-08-21", sourceTime: "2026-08-21T13:29:00+08:00", sequence: 99, totalVolume: 999 })), false);
});

test("分鐘 accumulator 先排隊 Tick，bootstrap 後拒絕倒序重送並避免重複量", () => {
  const accumulator = api.createMinuteKlineAccumulator({ interval: "5m" });
  const firstTick = snapshot({ sourceTime: "2026-07-31T09:01:30+08:00", sequence: 3, close: 102, totalVolume: 15, tickVolume: 3 });
  assert.equal(accumulator.append(firstTick), true);
  accumulator.bootstrap([
    { time: Date.parse("2026-07-31T09:00:00+08:00") / 1000, sourceTime: Date.parse("2026-07-31T09:00:59+08:00"), open: 100, high: 101, low: 99, close: 101, volume: 12, totalVolume: 12, continuity: "complete" },
  ]);
  assert.equal(accumulator.append(firstTick), false);
  assert.equal(accumulator.append(snapshot({ sessionDate: "2026-07-30", sourceTime: "2026-07-30T13:30:00+08:00", sequence: 99, close: 99, totalVolume: 999 })), false);
  assert.equal(accumulator.append(snapshot({ sourceTime: "2026-07-31T09:01:40+08:00", sequence: 4, close: 99, totalVolume: -1 })), false);
  assert.equal(accumulator.append(snapshot({ sourceTime: "2026-07-31T09:02:01+08:00", sequence: 4, close: 99, totalVolume: 20, tickVolume: 5 })), true);
  const model = accumulator.snapshot();
  assert.equal(model.oneMinute.length, 3);
  assert.deepEqual({ open: model.candles[0].open, high: model.candles[0].high, low: model.candles[0].low, close: model.candles[0].close, volume: model.candles[0].volume }, { open: 100, high: 102, low: 99, close: 99, volume: 20 });
  assert.equal(Object.isFrozen(model.candles), true);
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
