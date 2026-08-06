import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTraditionalPivotIndicator,
  computeTraditionalPivot,
  normalizePivotMode,
  pivotReferenceInterval,
} from "../worker/pivot-points.ts";

const unix = (iso) => Math.floor(Date.parse(iso) / 1000);

function candle(iso, { open = 100, high = 110, low = 90, close = 105, volume = 1000 } = {}) {
  return { time: unix(iso), open, high, low, close, volume };
}

test("Traditional Pivot Point 精確計算七個水準", () => {
  assert.deepEqual(computeTraditionalPivot({ high: 110, low: 90, close: 100 }), {
    p: 100,
    r1: 110,
    r2: 120,
    r3: 130,
    s1: 90,
    s2: 80,
    s3: 70,
  });
  assert.deepEqual(computeTraditionalPivot({ high: 0, low: 0, close: 0 }), {
    p: 0,
    r1: 0,
    r2: 0,
    r3: 0,
    s1: 0,
    s2: 0,
    s3: 0,
  });
});

test("Traditional Pivot Point 拒絕缺值、非有限數值與 high 小於 low", () => {
  assert.equal(computeTraditionalPivot({ high: 110, low: 90 }), null);
  assert.equal(computeTraditionalPivot({ high: Number.NaN, low: 90, close: 100 }), null);
  assert.equal(computeTraditionalPivot({ high: 110, low: Number.POSITIVE_INFINITY, close: 100 }), null);
  assert.equal(computeTraditionalPivot({ high: 80, low: 90, close: 85 }), null);
});

test("Pivot mode 與圖表週期映射只接受已確認契約", () => {
  assert.equal(normalizePivotMode("traditional"), "traditional");
  assert.equal(normalizePivotMode(" Traditional "), "traditional");
  assert.equal(normalizePivotMode("fibonacci"), null);
  assert.equal(normalizePivotMode(undefined), null);
  for (const interval of ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"]) {
    assert.equal(pivotReferenceInterval(interval), "1d");
  }
  assert.equal(pivotReferenceInterval("1wk"), "1wk");
  assert.equal(pivotReferenceInterval("1mo"), "1mo");
  assert.equal(pivotReferenceInterval("2h"), null);
});

test("日內 Pivot 依市場時區對應同一交易日的 daily-based OHLC", () => {
  const daily = [
    candle("2026-07-02T05:30:00Z", { high: 110, low: 90, close: 100 }),
    candle("2026-07-06T05:30:00Z", { high: 130, low: 100, close: 120 }),
    candle("2026-07-08T05:30:00Z", { high: 150, low: 120, close: 140 }),
  ];
  const intraday = [
    candle("2026-07-06T01:01:00Z"),
    candle("2026-07-06T03:01:00Z"),
    candle("2026-07-08T01:01:00Z"),
  ];
  const result = buildTraditionalPivotIndicator(intraday, daily, "1m", "Asia/Taipei");

  assert.equal(result.type, "traditional");
  assert.equal(result.contractVersion, "selected-next-period-v1");
  assert.equal(result.referenceInterval, "1d");
  assert.equal(result.status, "available");
  assert.deepEqual(result.targets.map((target) => target.referencePeriodKey), ["2026-07-06", "2026-07-06", "2026-07-08"]);
  assert.deepEqual(result.projections.map((projection) => projection.referencePeriodKey), ["2026-07-06", "2026-07-08"]);
  assert.ok(Math.abs(result.projections[0].p - 350 / 3) < 1e-12);
  assert.ok(Math.abs(result.projections[0].r1 - 400 / 3) < 1e-12);
  assert.equal(result.projections[0].appliesTo, "next-trading-day");
});

test("日線每根參考 K 以自身 OHLC 產生下一交易日投影", () => {
  const rows = [
    candle("2026-07-02T05:30:00Z", { high: 110, low: 90, close: 100 }),
    candle("2026-07-06T05:30:00Z", { high: 130, low: 100, close: 120 }),
    candle("2026-07-08T05:30:00Z", { high: 150, low: 120, close: 140 }),
  ];
  const result = buildTraditionalPivotIndicator(rows, rows, "1d", "Asia/Taipei");
  assert.deepEqual(result.projections.map((projection) => projection.p), [100, 350 / 3, 410 / 3]);
  assert.deepEqual(result.projections.map((projection) => projection.applicablePeriodKey), ["2026-07-06", "2026-07-08", undefined]);
});

test("週線與月線以自身 OHLC 投影下一同類交易期且不製造未知日期", () => {
  const weekly = [
    candle("2026-06-26T05:30:00Z", { high: 110, low: 90, close: 100 }),
    candle("2026-07-10T05:30:00Z", { high: 140, low: 100, close: 130 }),
    candle("2026-07-17T05:30:00Z", { high: 160, low: 120, close: 150 }),
  ];
  const monthly = [
    candle("2026-01-30T05:30:00Z", { high: 120, low: 90, close: 105 }),
    candle("2026-03-31T05:30:00Z", { high: 150, low: 100, close: 140 }),
    candle("2026-04-30T05:30:00Z", { high: 170, low: 130, close: 160 }),
  ];

  assert.deepEqual(
    buildTraditionalPivotIndicator(weekly, weekly, "1wk", "Asia/Taipei").projections.map((point) => point.p),
    [100, 370 / 3, 430 / 3],
  );
  const monthProjection = buildTraditionalPivotIndicator(monthly, monthly, "1mo", "Asia/Taipei");
  assert.deepEqual(monthProjection.projections.map((point) => point.p), [105, 130, 460 / 3]);
  assert.equal(monthProjection.projections.at(-1).appliesTo, "next-trading-month");
  assert.equal("applicablePeriodKey" in monthProjection.projections.at(-1), false);
});

test("非法參考期 OHLC 不產生投影且不沿用其他期間", () => {
  const rows = [
    candle("2026-07-01T05:30:00Z", { high: 110, low: 90, close: 100 }),
    candle("2026-07-02T05:30:00Z", { high: 80, low: 90, close: 85 }),
    candle("2026-07-03T05:30:00Z", { high: 130, low: 100, close: 120 }),
  ];
  const result = buildTraditionalPivotIndicator(rows, rows, "1d", "Asia/Taipei");
  assert.deepEqual(result.projections.map((point) => point.referencePeriodKey), ["2026-07-01", "2026-07-03"]);
});

test("display window 與歷史 prepend 保留 target time 到 reference key 的穩定映射", () => {
  const rows = [
    candle("2026-07-01T05:30:00Z", { high: 110, low: 90, close: 100 }),
    candle("2026-07-02T05:30:00Z", { high: 130, low: 100, close: 120 }),
    candle("2026-07-03T05:30:00Z", { high: 150, low: 120, close: 140 }),
  ];
  const displayRows = rows.slice(1);
  const pivot = buildTraditionalPivotIndicator(displayRows, rows, "1d", "Asia/Taipei");
  assert.deepEqual(pivot.targets.map((point) => point.time), displayRows.map((row) => row.time));
  assert.deepEqual(pivot.projections.map((point) => point.referencePeriodKey), ["2026-07-02", "2026-07-03"]);
});

test("最新未完成參考期明確標示 provisional，歷史期維持 completed", () => {
  const rows = [
    candle("2026-07-27T05:30:00Z", { high: 110, low: 90, close: 100 }),
    candle("2026-07-28T05:30:00Z", { high: 130, low: 100, close: 120 }),
  ];
  const result = buildTraditionalPivotIndicator(rows, rows, "1d", "Asia/Taipei", {
    provisionalReferencePeriodKey: "2026-07-28",
  });
  assert.deepEqual(result.projections.map((point) => point.referenceStatus), ["completed", "provisional"]);
});
