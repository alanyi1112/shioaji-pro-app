import assert from "node:assert/strict";
import test from "node:test";
import {
  computeIndicators,
  indicatorParameterSignature,
  indicatorParametersFromSearchParams,
  normalizeIndicatorParameters,
} from "../worker/indicators.ts";

test("成交量 MA5／MA10／MA20 使用相同 candle time、保留零值並在期數不足時為 null", () => {
  const volumes = [1, 2, 0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const rows = volumes.map((volume, index) => ({
    time: 1000 + index * 60,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
    volume,
  }));
  const indicators = computeIndicators(rows);
  assert.deepEqual(indicators.volume_moving_average.ma5.slice(0, 4).map((point) => point.value), [null, null, null, null]);
  assert.equal(indicators.volume_moving_average.ma5[4].value, 2.4);
  assert.equal(indicators.volume_moving_average.ma5[9].value, 8);
  assert.deepEqual(indicators.volume_moving_average.ma10.slice(0, 9).map((point) => point.value), Array(9).fill(null));
  assert.equal(indicators.volume_moving_average.ma10[9].value, 5.2);
  assert.deepEqual(indicators.volume_moving_average.ma10.map((point) => point.time), rows.map((row) => row.time));
  assert.deepEqual(indicators.volume_moving_average.ma20.slice(0, 19).map((point) => point.value), Array(19).fill(null));
  assert.equal(indicators.volume_moving_average.ma20[19].value, 10.35);
  assert.deepEqual(indicators.volume_moving_average.ma20.map((point) => point.time), rows.map((row) => row.time));
  assert.equal(indicators.moving_average.ma5[4].value, 102.5);
});

test("參考 RSI5／10 使用 Wilder 暖機與遞迴平均，平盤為 50", () => {
  const closes = [10, 11, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17, 16, 18];
  const rows = closes.map((close, index) => ({
    time: 1000 + index * 60,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100 + index,
  }));
  const indicators = computeIndicators(rows);
  assert.deepEqual(indicators.rsi.short.slice(0, 5).map((item) => item.value), Array(5).fill(null));
  assert.equal(indicators.rsi.short[5].value, 66.666667);
  assert.equal(indicators.rsi.short.at(-1).value, 72.184073);
  assert.deepEqual(indicators.rsi.long.slice(0, 10).map((item) => item.value), Array(10).fill(null));
  assert.equal(indicators.rsi.long[10].value, 71.428571);
  assert.equal(indicators.rsi.long.at(-1).value, 70.532894);

  const flat = computeIndicators(Array.from({ length: 12 }, (_, index) => ({
    time: 2000 + index * 60,
    open: 20,
    high: 20,
    low: 20,
    close: 20,
    volume: 1,
  })));
  assert.equal(flat.rsi.short[5].value, 50);
  assert.equal(flat.rsi.long[10].value, 50);
});

test("參考 KD 9／3／3 以 50 初始化並使用兩段遞迴平滑", () => {
  const closes = [10, 11, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17, 16, 18];
  const rows = closes.map((close, index) => ({
    time: 1000 + index * 60,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100 + index,
  }));
  const indicators = computeIndicators(rows);
  assert.deepEqual(indicators.kd.k.slice(0, 8).map((item) => item.value), Array(8).fill(null));
  assert.deepEqual(indicators.kd.d.slice(0, 8).map((item) => item.value), Array(8).fill(null));
  assert.equal(indicators.kd.k[8].value, 61.904762);
  assert.equal(indicators.kd.d[8].value, 53.968254);
  assert.equal(indicators.kd.k.at(-1).value, 78.202365);
  assert.equal(indicators.kd.d.at(-1).value, 73.076839);
});

test("技術指標參數只接受有界整數並產生穩定簽章", () => {
  const custom = indicatorParametersFromSearchParams(new URLSearchParams({
    rsi_short: "6",
    rsi_long: "12",
    kd_period: "14",
    kd_rsv_weight: "4",
    kd_k_weight: "5",
    macd_fast: "8",
    macd_slow: "21",
    macd_signal: "5",
    atr_period: "20",
  }));
  assert.deepEqual(custom, {
    rsi: { shortPeriod: 6, longPeriod: 12 },
    kd: { period: 14, rsvWeight: 4, kWeight: 5 },
    macd: { fastPeriod: 8, slowPeriod: 21, signalPeriod: 5 },
    atr: { period: 20 },
  });
  assert.equal(indicatorParameterSignature(custom), "r6.12-k14.4.5-m8.21.5-a20");
  assert.deepEqual(normalizeIndicatorParameters({
    rsi: { shortPeriod: 20, longPeriod: 10 },
    kd: { period: 1, rsvWeight: 30, kWeight: 2 },
    macd: { fastPeriod: 30, slowPeriod: 10, signalPeriod: 7 },
    atr: { period: 101 },
  }), {
    rsi: { shortPeriod: 5, longPeriod: 10 },
    kd: { period: 9, rsvWeight: 3, kWeight: 2 },
    macd: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    atr: { period: 14 },
  });
});
