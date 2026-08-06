import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/static/chip-panes.js", import.meta.url), "utf8");
const window = { QuoteChartInteractions: {} };
vm.runInNewContext(source, { window, structuredClone, URLSearchParams, Intl, DOMException, Map, Set });
const {
  availabilityLabel,
  __test: {
    backfillCoverageState,
    backfillMenuState,
    dailyDetailModel,
    detailItemsForPane,
    holderDetailModel,
    seriesColorForReadout,
    shouldShowWarningNotice,
    shortMarginRatioPercent,
    shortMarginRatioRows,
    shouldContinueBackfillPolling,
    warningNoticeSignature,
  },
} = window.QuoteChartChipPanes;

function normalized(value) {
  return JSON.parse(JSON.stringify(value));
}

test("提示關閉只套用相同商品週期與內容 signature", () => {
  const first = warningNoticeSignature({ symbol: "00919.tw", interval: "1d" }, "外資持股等待更新");
  assert.equal(first, "00919.TW|1d|外資持股等待更新");
  assert.equal(shouldShowWarningNotice(first, ""), true);
  assert.equal(shouldShowWarningNotice(first, first), false);
  assert.equal(shouldShowWarningNotice(warningNoticeSignature({ symbol: "00878.TW", interval: "1d" }, "外資持股等待更新"), first), true);
  assert.equal(shouldShowWarningNotice(warningNoticeSignature({ symbol: "00919.TW", interval: "1d" }, "借券最近無成交"), first), true);
  assert.equal(shouldShowWarningNotice("", first), false);
});

test("券資比只接受同日合法融資融券餘額並保留合法零", () => {
  assert.equal(shortMarginRatioPercent({ shortTodayBalanceLots: 250, marginTodayBalanceLots: 10_000 }), 2.5);
  assert.equal(shortMarginRatioPercent({ shortTodayBalanceLots: 0, marginTodayBalanceLots: 10_000 }), 0);
  assert.ok(Math.abs(shortMarginRatioPercent({ shortTodayBalanceLots: 1, marginTodayBalanceLots: 3 }) - (100 / 3)) < 1e-12);
  for (const marginShort of [
    { shortTodayBalanceLots: 250, marginTodayBalanceLots: 0 },
    { shortTodayBalanceLots: null, marginTodayBalanceLots: 10_000 },
    { shortTodayBalanceLots: 250, marginTodayBalanceLots: null },
    { shortTodayBalanceLots: -1, marginTodayBalanceLots: 10_000 },
    { shortTodayBalanceLots: 250, marginTodayBalanceLots: -1 },
    { shortTodayBalanceLots: Number.POSITIVE_INFINITY, marginTodayBalanceLots: 10_000 },
    { shortTodayBalanceLots: 250, marginTodayBalanceLots: Number.NaN },
  ]) assert.equal(shortMarginRatioPercent(marginShort), null);
});

test("券資比日變化跨過缺值但只比較前一筆合法比值", () => {
  const rows = JSON.parse(JSON.stringify(shortMarginRatioRows([
    { sessionDate: "2026-07-14", marginShort: { shortTodayBalanceLots: 250, marginTodayBalanceLots: 10_000 } },
    { sessionDate: "2026-07-15", marginShort: { shortTodayBalanceLots: 300, marginTodayBalanceLots: 0 } },
    { sessionDate: "2026-07-16", marginShort: { shortTodayBalanceLots: 280, marginTodayBalanceLots: 10_000 } },
    { sessionDate: "2026-07-17", marginShort: { shortTodayBalanceLots: 0, marginTodayBalanceLots: 10_000 } },
  ])));
  assert.deepEqual(rows.map(({ sessionDate, ratio, change }) => ({
    sessionDate,
    ratio: ratio === null ? null : Number(ratio.toFixed(12)),
    change: change === null ? null : Number(change.toFixed(12)),
  })), [
    { sessionDate: "2026-07-14", ratio: 2.5, change: null },
    { sessionDate: "2026-07-15", ratio: null, change: null },
    { sessionDate: "2026-07-16", ratio: 2.8, change: 0.3 },
    { sessionDate: "2026-07-17", ratio: 0, change: -2.8 },
  ]);
});

test("readout 名稱沿用右鍵線圖項目的唯一色票", () => {
  const margin = { id: "margin", kind: "margin" };
  const short = { id: "short", kind: "short" };
  assert.equal(seriesColorForReadout(margin, "balance"), "#f472b6");
  assert.equal(seriesColorForReadout(margin, "change"), "#e879f9");
  assert.equal(seriesColorForReadout(margin, "buy"), "#f87171");
  assert.equal(seriesColorForReadout(margin, "sell"), "#4ade80");
  assert.equal(seriesColorForReadout(margin, "repayment"), "#f59e0b");
  assert.equal(seriesColorForReadout(margin, "utilization"), "#38bdf8");
  assert.equal(seriesColorForReadout(short, "balance"), "#a78bfa");
  assert.equal(seriesColorForReadout(short, "unknown"), "");
  assert.equal(seriesColorForReadout({ id: "short-margin-ratio" }, "ratio"), "#facc15");
  assert.equal(seriesColorForReadout({ id: "short-margin-ratio" }, "change"), "#e879f9");
});

test("十二個籌碼 pane 都有 canonical 詳細資料 metadata 且既有 series 色票一致", () => {
  const paneIds = [
    "foreign-flow-holding", "investment-trust-flow", "dealer-flow", "institutional-total-flow",
    "margin", "short", "securities-lending", "short-margin-ratio", "estimated-margin-maintenance",
    "big-holder", "retail-holder", "tdcc-holder-count",
  ];
  for (const paneId of paneIds) {
    const items = normalized(detailItemsForPane(paneId));
    assert.ok(items.length > 0, `${paneId} 必須有詳細資料項目`);
    assert.equal(new Set(items.map((item) => item.id)).size, items.length);
    assert.ok(items.every((item) => item.label && /^#[0-9a-f]{6}$/i.test(item.color)));
  }
  for (const paneId of ["foreign-flow-holding", "investment-trust-flow", "margin", "short", "short-margin-ratio"]) {
    for (const item of detailItemsForPane(paneId)) {
      if (["offset", "shortBalance", "marginBalance"].includes(item.id)) continue;
      assert.equal(seriesColorForReadout({ id: paneId }, item.id), item.color);
    }
  }
});

test("日籌碼詳細資料依前一有效交易日、指向交易日、變化排列並套用台股紅漲綠跌", () => {
  const model = normalized(dailyDetailModel(
    { id: "margin" },
    [
      { sessionDate: "2026-07-16", marginShort: { marginTodayBalanceLots: 100, marginBuyLots: 30 } },
      { sessionDate: "2026-07-18", marginShort: { marginTodayBalanceLots: 90, marginBuyLots: 50 } },
    ],
    "2026-07-18",
  ));
  assert.equal(model.previousDate, "2026-07-16");
  assert.equal(model.currentDate, "2026-07-18");
  const balance = model.rows.find((row) => row.id === "balance");
  const buy = model.rows.find((row) => row.id === "buy");
  assert.deepEqual(balance, {
    id: "balance", label: "餘額", color: "#f472b6",
    previous: "100 張", current: "90 張", change: "-10 張", direction: "negative",
  });
  assert.deepEqual(buy, {
    id: "buy", label: "買進", color: "#f87171",
    previous: "30 張", current: "50 張", change: "+20 張", direction: "positive",
  });
});

test("TDCC 詳細資料使用指向日以前的實際發布快照且前期欄位在當期之前", () => {
  const snapshots = [
    {
      row: { dataDate: "2026-07-10", provenance: { provider: "tdcc" } },
      aggregate: { ratioPercent: 42, lots: 1000, holders: 20, description: "400 張以上" },
    },
    {
      row: { dataDate: "2026-07-17", provenance: { provider: "tdcc" } },
      aggregate: { ratioPercent: 44.5, lots: 950, holders: 22, description: "400 張以上" },
    },
  ];
  const model = normalized(holderDetailModel({ id: "big-holder" }, snapshots, "2026-07-18"));
  assert.equal(model.previousDate, "2026-07-10");
  assert.equal(model.currentDate, "2026-07-17");
  assert.deepEqual(model.rows[0], {
    id: "ratio", label: "持股比例", color: "#38bdf8",
    previous: "42.00%", current: "44.50%", change: "+2.50%", direction: "positive",
  });
  assert.deepEqual(model.rows[1], {
    id: "lots", label: "持股張數", color: "#facc15",
    previous: "1,000 張", current: "950 張", change: "-50 張", direction: "negative",
  });
  assert.deepEqual(model.metadata.slice(1, 3), [["前一期發布日", "2026-07-10"], ["當期發布日", "2026-07-17"]]);
});

test("詳細資料首筆、缺值與持平不補零，非發布交易日也只採用已發布 TDCC 快照", () => {
  const first = normalized(dailyDetailModel(
    { id: "margin" },
    [{ sessionDate: "2026-07-18", marginShort: { marginTodayBalanceLots: 0 } }],
    "2026-07-18",
  ));
  assert.equal(first.rows[0].previous, "無資料");
  assert.equal(first.rows[0].current, "0 張");
  assert.equal(first.rows[0].change, "無資料");
  assert.equal(first.rows[0].direction, "missing");

  const flat = normalized(dailyDetailModel(
    { id: "margin" },
    [
      { sessionDate: "2026-07-17", marginShort: { marginTodayBalanceLots: 5 } },
      { sessionDate: "2026-07-18", marginShort: { marginTodayBalanceLots: 5 } },
    ],
    "2026-07-18",
  ));
  assert.equal(flat.rows[0].change, "+0 張");
  assert.equal(flat.rows[0].direction, "flat");

  const holder = normalized(holderDetailModel(
    { id: "retail-holder" },
    [
      { row: { dataDate: "2026-07-10" }, aggregate: { ratioPercent: 10, lots: null, holders: 2 } },
      { row: { dataDate: "2026-07-24" }, aggregate: { ratioPercent: 11, lots: 3, holders: 4 } },
    ],
    "2026-07-18",
  ));
  assert.equal(holder.currentDate, "2026-07-10");
  assert.equal(holder.previousDate, "");
  assert.equal(holder.rows.find((row) => row.id === "lots").current, "無資料");
});

test("普通股與 ETF 的 queued、running、completed、partial、blocked 狀態逐 symbol 顯示", () => {
  const available = { status: "available", reason: "available", rowCount: 12 };
  assert.equal(availabilityLabel(available, { supported: true }, { status: "queued" }), "等待背景回補");
  assert.equal(availabilityLabel(available, { supported: true }, { status: "running", completedWeeks: 3, expectedWeeks: 12 }), "背景歷史回補中（3/12 週）");
  assert.equal(availabilityLabel(available, { supported: true }, { status: "partial" }), "回補未完成（0/51 週）");
  assert.equal(availabilityLabel(available, { supported: true }, { status: "blocked" }), "來源阻擋");
  assert.equal(availabilityLabel(available, { supported: true }, { status: "completed", expectedWeeks: 12, completedWeeks: 12 }), "");
  assert.equal(availabilityLabel(available, { supported: true }, { status: "completed", expectedWeeks: 51, completedWeeks: 51 }), "歷史已更新");
  assert.notEqual(
    availabilityLabel(available, { supported: true }, { status: "blocked" }),
    availabilityLabel(available, { supported: true }, { status: "running", completedWeeks: 3, expectedWeeks: 12 }),
  );
  assert.equal(availabilityLabel(available, { supported: true }, { status: "queued" }, { status: "started" }), "立即回補啟動中");
  assert.equal(availabilityLabel(available, { supported: true }, { status: "queued" }, { status: "unavailable" }), "已排入背景回補（非立即）");
});

test("scheduler stale 與可及性不只靠顏色，holder 缺值仍有文字", () => {
  assert.equal(availabilityLabel({ status: "partial", reason: "stale_cache", rowCount: 1 }, { supported: true }, null), "資料可能過期");
  assert.equal(availabilityLabel({ status: "partial", reason: "history_not_archived", rowCount: 1 }, { supported: true }, null), "目前僅 1 期／尚無前週比較");
  assert.match(source, /aria-live/);
  assert.match(source, /aria-label/);
  assert.match(source, /definition\.label/);
  assert.match(source, /當日無資料/);
});

test("右鍵回補只在缺資料時出現，並依排隊、阻擋與 retry 狀態限制重試", () => {
  const normalized = (value) => JSON.parse(JSON.stringify(value));
  const daily = { id: "institutional-total-flow", dataset: "institutional-flow", kind: "flow" };
  assert.deepEqual(
    normalized(backfillMenuState(daily, { datasetEligibility: { "institutional-flow": { supported: true } }, availability: { "institutional-flow": { status: "partial", reason: "partial_data" } } })),
    { visible: true, disabled: false, label: "立即回補缺少資料", datasets: ["institutional-flow"] },
  );
  assert.equal(backfillMenuState(daily, { availability: { "institutional-flow": { status: "available", reason: "available" } } }).visible, false);
  assert.deepEqual(
    normalized(backfillMenuState(daily, { availability: { "institutional-flow": { status: "unavailable", reason: "rate_limited" } } })),
    { visible: true, disabled: true, label: "來源等待重試，請稍後再試", datasets: ["institutional-flow"] },
  );

  const holder = { id: "big-holder", dataset: "shareholder-distribution", kind: "holder" };
  assert.equal(backfillMenuState(holder, { availability: { "shareholder-distribution": { reason: "history_not_archived" } }, backfill: { status: "completed", expectedWeeks: 1, completedWeeks: 1, missingDates: [] } }).disabled, false);
  assert.deepEqual(
    normalized(backfillMenuState(holder, { availability: { "shareholder-distribution": { status: "available" } }, backfill: { status: "completed", expectedWeeks: 2, completedWeeks: 2, missingDates: [] } })),
    { visible: true, disabled: false, label: "立即回補歷史資料", datasets: ["shareholder-distribution"] },
  );
  assert.deepEqual(
    normalized(backfillMenuState(holder, { backfill: { status: "queued" } })),
    { visible: true, disabled: true, label: "等待背景回補", datasets: ["shareholder-distribution"] },
  );
  assert.equal(backfillMenuState(holder, { backfill: { status: "queued" }, dispatch: { status: "started" } }).label, "TDCC 立即回補啟動中");
  assert.deepEqual(
    normalized(backfillMenuState(holder, { backfill: { status: "queued" }, dispatch: { status: "unavailable" } })),
    { visible: true, disabled: false, label: "立即回補歷史資料", datasets: ["shareholder-distribution"] },
  );
  assert.equal(backfillMenuState(holder, { backfill: { status: "queued" }, dispatch: { status: "failed" } }).disabled, false);
  assert.equal(backfillMenuState(holder, { backfill: { status: "blocked" } }).label, "來源阻擋，暫不可回補");
  assert.equal(backfillMenuState(holder, { backfill: { status: "completed", expectedWeeks: 51, completedWeeks: 51, missingDates: [] } }).visible, false);
});

test("立即回補輪詢以個別 symbol coverage 判定進度與停止條件", () => {
  const state = backfillCoverageState({
    distributionRows: [{ dataDate: "2026-07-10" }, { dataDate: "2026-07-17" }],
    coverage: [{ dataset: "shareholder-distribution", savedWeeks: 2, expectedWeeks: 51, missingWeeks: 49 }],
    backfill: { status: "running", completedWeeks: 2, expectedWeeks: 51, missingDates: Array(49).fill("2026-01-01") },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(state)), { status: "running", savedWeeks: 2, completedWeeks: 2, expectedWeeks: 51, missingWeeks: 49 });
  assert.equal(shouldContinueBackfillPolling(state), true);
  assert.equal(shouldContinueBackfillPolling({ status: "completed", savedWeeks: 51, completedWeeks: 51, expectedWeeks: 51, missingWeeks: 0 }), false);
  assert.equal(shouldContinueBackfillPolling({ status: "blocked", savedWeeks: 2, completedWeeks: 2, expectedWeeks: 51, missingWeeks: 49 }), false);
});
