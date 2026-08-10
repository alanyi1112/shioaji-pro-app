import assert from "node:assert/strict";
import test from "node:test";
import fixture from "../../../fixtures/traditional-pivot-selected-next-period-v1.json" with { type: "json" };
import supportResistanceFixture from "../../../fixtures/support-resistance-formulas-v1.json" with { type: "json" };
import {
  buildTraditionalPivotIndicator,
  computeCdp,
  computeSupportResistanceFormulaLevels,
  computeThreeLevelPrice,
  computeTraditionalPivot,
  normalizePivotMode,
  pivotReferenceInterval,
} from "../worker/pivot-points.ts";

const unix = (iso) => Math.floor(Date.parse(iso) / 1000);

function candle(iso, { open = 100, high = 110, low = 90, close = 105, volume = 1000 } = {}) {
  return { time: unix(iso), open, high, low, close, volume };
}

test("通過共用版本化 selected-next-period-v1 公式 fixture", () => {
  assert.equal(fixture.contractVersion, "selected-next-period-v1");
  fixture.formulaCases.forEach((testCase) => {
    assert.deepEqual(computeTraditionalPivot(testCase.input), testCase.expected, testCase.name);
  });
});

test("MultiView 三關價與 CDP 通過主交易畫面共用版本化 fixture", () => {
  assert.equal(supportResistanceFixture.formulaVersions.threeLevelPrice, "three-level-price-tw-v1");
  assert.equal(supportResistanceFixture.formulaVersions.cdp, "cdp-wilder-tw-v1");
  supportResistanceFixture.cases.forEach((testCase) => {
    if (testCase.invalid) {
      assert.equal(computeThreeLevelPrice(testCase.input), null, testCase.name);
      assert.equal(computeCdp(testCase.input), null, testCase.name);
      assert.equal(computeSupportResistanceFormulaLevels(testCase.input), null, testCase.name);
      return;
    }
    assert.deepEqual(computeThreeLevelPrice(testCase.input), testCase.threeLevelPrice, testCase.name);
    assert.deepEqual(computeCdp(testCase.input), testCase.cdp, testCase.name);
    assert.deepEqual(computeSupportResistanceFormulaLevels(testCase.input), {
      pivotPoint: testCase.pivotPoint,
      threeLevelPrice: testCase.threeLevelPrice,
      cdp: testCase.cdp,
    }, testCase.name);
  });
});

test("共用 fixture 涵蓋 completed provisional applies-to 七線與 target mapping", () => {
  const rows = fixture.projectionRows.map((row) => ({
    ...row,
    time: unix(row.time),
  }));
  const result = buildTraditionalPivotIndicator(
    rows,
    rows,
    "1d",
    fixture.timeZone,
    { provisionalReferencePeriodKey: fixture.provisionalReferencePeriodKey },
  );
  assert.deepEqual(result.targets.map((target) => target.referencePeriodKey), [
    "2026-07-02",
    "2026-07-06",
    "2026-07-08",
  ]);
  assert.deepEqual(result.projections.map((projection) => ({
    referencePeriodKey: projection.referencePeriodKey,
    referenceStatus: projection.referenceStatus,
    applicablePeriodKey: projection.applicablePeriodKey,
    appliesTo: projection.appliesTo,
    levels: [projection.p, projection.r1, projection.r2, projection.r3, projection.s1, projection.s2, projection.s3],
  })), [
    { referencePeriodKey: "2026-07-02", referenceStatus: "completed", applicablePeriodKey: "2026-07-06", appliesTo: "next-trading-day", levels: [100, 110, 120, 130, 90, 80, 70] },
    { referencePeriodKey: "2026-07-06", referenceStatus: "completed", applicablePeriodKey: "2026-07-08", appliesTo: "next-trading-day", levels: [116.666667, 133.333333, 146.666667, 163.333333, 103.333333, 86.666667, 73.333333] },
    { referencePeriodKey: "2026-07-08", referenceStatus: "provisional", applicablePeriodKey: undefined, appliesTo: "next-trading-day", levels: [136.666667, 153.333333, 166.666667, 183.333333, 123.333333, 106.666667, 93.333333] },
  ]);
  assert.deepEqual(result.projections[0].formulaLevels.threeLevelPrice, { up: 117.64, mid: 100, down: 82.36 });
  assert.deepEqual(result.projections[0].formulaLevels.cdp, { ah: 120, nh: 110, cdp: 100, nl: 90, al: 80 });
});

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
  assert.equal(computeTraditionalPivot({ high: 110, low: 90, close: 120 }), null);
});

test("Pivot mode 與圖表週期映射只接受已確認契約", () => {
  assert.equal(normalizePivotMode("traditional"), "traditional");
  assert.equal(normalizePivotMode(" Traditional "), "traditional");
  assert.equal(normalizePivotMode("fibonacci"), null);
  assert.equal(normalizePivotMode(undefined), null);
  for (const interval of ["1m", "5m", "15m", "1h", "1d", "1wk", "1mo"]) {
    assert.equal(pivotReferenceInterval(interval), interval);
  }
  assert.equal(pivotReferenceInterval("3m"), null);
  assert.equal(pivotReferenceInterval("30m"), null);
  assert.equal(pivotReferenceInterval("4h"), null);
  assert.equal(pivotReferenceInterval("2h"), null);
});

test("日內 Pivot 依來源週期每根 K 棒 OHLC 建立可留置投影", () => {
  const intraday = [
    candle("2026-07-06T01:01:00Z", { high: 110, low: 90, close: 100 }),
    candle("2026-07-06T01:06:00Z", { high: 130, low: 100, close: 120 }),
    candle("2026-07-06T01:11:00Z", { high: 150, low: 120, close: 140 }),
  ];
  const result = buildTraditionalPivotIndicator(intraday, intraday, "5m", "Asia/Taipei");

  assert.equal(result.type, "traditional");
  assert.equal(result.contractVersion, "selected-next-period-v1");
  assert.equal(result.referenceInterval, "5m");
  assert.equal(result.status, "available");
  assert.deepEqual(result.targets.map((target) => target.referencePeriodKey), intraday.map((row) => String(row.time)));
  assert.deepEqual(result.projections.map((projection) => projection.referencePeriodKey), intraday.map((row) => String(row.time)));
  assert.equal(result.projections[0].p, 100);
  assert.equal(result.projections[1].r1, 133.333333);
  assert.equal(result.projections[0].appliesTo, "next-source-candle");
});

test("日線每根參考 K 以自身 OHLC 產生下一交易日投影", () => {
  const rows = [
    candle("2026-07-02T05:30:00Z", { high: 110, low: 90, close: 100 }),
    candle("2026-07-06T05:30:00Z", { high: 130, low: 100, close: 120 }),
    candle("2026-07-08T05:30:00Z", { high: 150, low: 120, close: 140 }),
  ];
  const result = buildTraditionalPivotIndicator(rows, rows, "1d", "Asia/Taipei");
  assert.deepEqual(result.projections.map((projection) => projection.p), [100, 116.666667, 136.666667]);
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
    [100, 123.333333, 143.333333],
  );
  const monthProjection = buildTraditionalPivotIndicator(monthly, monthly, "1mo", "Asia/Taipei");
  assert.deepEqual(monthProjection.projections.map((point) => point.p), [105, 130, 153.333333]);
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
