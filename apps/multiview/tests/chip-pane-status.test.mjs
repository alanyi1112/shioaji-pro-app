import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/static/chip-panes.js", import.meta.url), "utf8");
const window = {
  QuoteChartInteractions: {
    chartInteractionOptions() {
      return {
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      };
    },
  },
};
let fetchImpl = async () => Response.json({ rows: [], distributionRows: [], availability: {} });
const localStorageData = new Map();
const localStorage = {
  getItem(key) { return localStorageData.get(key) ?? null; },
  setItem(key, value) { localStorageData.set(key, String(value)); },
  removeItem(key) { localStorageData.delete(key); },
};
vm.runInNewContext(source, {
  window,
  structuredClone,
  URLSearchParams,
  Intl,
  DOMException,
  Map,
  Set,
  Date,
  AbortController,
  setTimeout,
  clearTimeout,
  localStorage,
  fetch: (...args) => fetchImpl(...args),
});
const {
  CHIP_PANE_REGISTRY,
  availabilityLabel,
  requestData,
  cacheMetrics,
  __test: {
    backfillCoverageState,
    backfillMenuState,
    chipPayloadMaterialSignature,
    chipReadoutContentSignature,
    chipRequestKey,
    candleTimeByDate,
    createChipRenderGate,
    dailyDetailModel,
    dateForChartTime,
    detailItemsForPane,
    holderDetailModel,
    seriesColorForReadout,
    shouldShowWarningNotice,
    shortMarginRatioPercent,
    shortMarginRatioRows,
    shouldContinueBackfillPolling,
    warningNoticeSignature,
    shouldPreserveChipPayloadForEmptyContext,
    shouldReuseChipPayload,
    chipCacheEntryState,
    chipCacheFreshnessMs,
    datasetQualitySummary,
    extractDatasetSlice,
    reconcileChipPayload,
    modeBSelectionDatasets,
    migrateModeBSelectedPaneIds,
    paneChartInteractionOptions,
    resetChipRequestCacheForTest,
  },
} = window.QuoteChartChipPanes;

test("Yahoo 與 Shioaji 日 K 都以台北交易日對齊 TDCC", () => {
  const yahooTime = 1787792400; // 2026-08-27 09:00 Asia/Taipei
  const shioajiTime = 1787760000; // 2026-08-27 00:00 Asia/Taipei，UTC 仍為前一天
  assert.equal(dateForChartTime(yahooTime), "2026-08-27");
  assert.equal(dateForChartTime(shioajiTime), "2026-08-27");
  assert.equal(dateForChartTime({ year: 2026, month: 8, day: 27 }), "2026-08-27");
  assert.equal(candleTimeByDate([{ time: shioajiTime }]).get("2026-08-27"), shioajiTime);
  const common = { symbol: "2330.TW", interval: "1d", datasets: ["shareholder-distribution"] };
  assert.equal(
    chipRequestKey({ ...common, candles: [{ time: yahooTime }] }),
    chipRequestKey({ ...common, candles: [{ time: shioajiTime }] }),
    "同一台北交易日不得因 provider timestamp 不同而分裂 request identity",
  );
});

test("持股 pane 停用價格軸拖曳但保留時間軸手勢", () => {
  const bigHolder = CHIP_PANE_REGISTRY.find((item) => item.id === "big-holder");
  const retailHolder = CHIP_PANE_REGISTRY.find((item) => item.id === "retail-holder");
  const institutional = CHIP_PANE_REGISTRY.find((item) => item.id === "institutional-total-flow");
  for (const definition of [bigHolder, retailHolder]) {
    const options = normalized(paneChartInteractionOptions(definition, "B"));
    assert.deepEqual(options.handleScale.axisPressedMouseMove, { time: true, price: false });
    assert.equal(options.handleScale.mouseWheel, true);
    assert.equal(options.handleScroll.pressedMouseMove, true);
  }
  assert.equal(paneChartInteractionOptions(institutional, "B").handleScale.axisPressedMouseMove, true);
});

function normalized(value) {
  return JSON.parse(JSON.stringify(value));
}

function provenance(dataset, sourceDate, provider = "finmind") {
  return { dataset, sourceDate, provider, frequency: dataset === "shareholder-distribution" ? "weekly" : "daily" };
}

function distributionRow(dataDate, seed = 1) {
  const level = (value) => ({ level: value, range: String(value), holders: seed + value, shares: (seed + value) * 1000, ratioPercent: 0.5 });
  const levels = [...Array(15)].map((_, index) => level(index + 1));
  const holders = levels.reduce((sum, item) => sum + item.holders, 0);
  const shares = levels.reduce((sum, item) => sum + item.shares, 0);
  const ratioPercent = levels.reduce((sum, item) => sum + item.ratioPercent, 0);
  return {
    symbol: "2330.TW",
    dataDate,
    levels,
    adjustment: { level: 16, range: "調整", holders: 0, shares: 0, ratioPercent: 0 },
    total: { level: 17, range: "合計", holders, shares, ratioPercent },
    provenance: provenance("shareholder-distribution", dataDate, "tdcc"),
  };
}

function completeDailyRow(sessionDate, seed = 1) {
  return {
    symbol: "2330.TW",
    sessionDate,
    institutionalFlow: { institutionalTotalNetShares: seed * 1000 },
    foreignHolding: { heldShares: seed * 10_000, heldRatioPercent: seed },
    marginShort: { marginTodayBalanceLots: seed * 100, shortTodayBalanceLots: seed },
    securitiesLending: { transactionShares: seed * 1000 },
    provenance: Object.fromEntries([
      "institutional-flow", "foreign-holding", "margin-short", "securities-lending",
    ].map((dataset) => [dataset, provenance(dataset, sessionDate)])),
  };
}

function completePayload({ symbol = "2330.TW", interval = "1d", rows = [], distributionRows = [], availability = {}, coverage = [], warnings = [], sources } = {}) {
  return {
    symbol,
    interval,
    rows,
    distributionRows,
    availability,
    coverage,
    sources: sources || [
      { dataset: "institutional-flow", providers: ["finmind"], frequency: "daily" },
      { dataset: "foreign-holding", providers: ["finmind"], frequency: "daily" },
      { dataset: "margin-short", providers: ["finmind"], frequency: "daily" },
      { dataset: "securities-lending", providers: ["finmind"], frequency: "daily" },
      { dataset: "shareholder-distribution", providers: ["tdcc"], frequency: "weekly" },
    ],
    warnings,
  };
}

test("籌碼 request identity 正規化商品、日期範圍與 dataset 順序", () => {
  const input = {
    symbol: "2330.tw",
    interval: "1d",
    candles: [{ time: "2026-07-02" }, { time: "2026-07-09" }],
  };
  assert.equal(
    chipRequestKey({ ...input, datasets: ["shareholder-distribution", "margin-short", "shareholder-distribution"] }),
    "2330.TW|1d|2026-07-02|2026-07-09|margin-short,shareholder-distribution",
  );
});

test("mode B selection migration 與 dataset 合併不逐 pane 重複", () => {
  const migrated = migrateModeBSelectedPaneIds({
    defaultsVersion: 0,
    modeBSelectedPaneIds: ["margin", "short", "big-holder", "retail-holder"],
  });
  assert.equal(migrated.includes("estimated-margin-maintenance"), true);
  assert.deepEqual(
    [...modeBSelectionDatasets({
      defaultsVersion: 0,
      modeBSelectedPaneIds: ["margin", "short", "big-holder", "retail-holder"],
      modeBGroupOrder: ["margin-financing", "shareholders"],
    })].sort(),
    ["margin-short", "shareholder-distribution"],
  );
});

test("背景預載、in-flight join 與前景 cache 使用共用同一 request", async () => {
  resetChipRequestCacheForTest();
  let fetchCalls = 0;
  let release;
  fetchImpl = async () => {
    fetchCalls += 1;
    return new Promise((resolve) => { release = () => resolve(Response.json(completePayload({ rows: [completeDailyRow("2026-08-25")] }))); });
  };
  const input = {
    symbol: "2330.TW",
    interval: "1d",
    datasets: ["margin-short", "shareholder-distribution"],
    candles: [{ time: "2026-08-01" }, { time: "2026-08-25" }],
  };
  const first = requestData({ ...input, prefetch: true });
  const joined = requestData({ ...input, prefetch: true });
  await Promise.resolve();
  assert.equal(fetchCalls, 1);
  release();
  await Promise.all([first, joined]);
  const foreground = await requestData(input);
  assert.equal(foreground.rows.length, 1);
  assert.equal(fetchCalls, 1);
  const metrics = cacheMetrics();
  assert.equal(metrics.requested, 1);
  assert.equal(metrics.inFlightJoin, 1);
  assert.equal(metrics.cacheHit, 1);
  assert.equal(metrics.usedAfterNavigation, 1);
});

test("完成 cache 首繪後 HTTP 200 空 TDCC 回應仍保留最後有效大戶散戶資料", async () => {
  resetChipRequestCacheForTest();
  const input = {
    symbol: "2330.TW",
    interval: "1d",
    datasets: ["shareholder-distribution"],
    candles: [{ time: "2026-08-01" }, { time: "2026-08-25" }],
  };
  fetchImpl = async () => Response.json(completePayload({
    distributionRows: [distributionRow("2026-08-21")],
    availability: { "shareholder-distribution": { status: "available", reason: "available", rowCount: 1 } },
    coverage: [{ dataset: "shareholder-distribution", start: "2026-08-21", end: "2026-08-21", savedWeeks: 1 }],
  }));
  const first = await requestData(input);
  assert.equal(first.distributionRows.length, 1);

  fetchImpl = async () => Response.json(completePayload({
    availability: { "shareholder-distribution": { status: "unavailable", reason: "not_published", rowCount: 0 } },
    coverage: [{ dataset: "shareholder-distribution", start: null, end: null, savedWeeks: 0 }],
  }));
  const retained = await requestData({ ...input, forceRefresh: true });
  assert.deepEqual(retained.distributionRows.map((row) => row.dataDate), ["2026-08-21"]);
  assert.equal(retained.availability["shareholder-distribution"].reason, "retained_stale");
  assert.equal(retained.availability["shareholder-distribution"].sourceReason, "not_published");
  assert.deepEqual(retained.retainedDatasets.map((item) => item.dataset), ["shareholder-distribution"]);
  assert.match(retained.warnings.at(-1), /保留最後已驗證資料/);

  const cached = await requestData(input);
  assert.deepEqual(cached.distributionRows.map((row) => row.dataDate), ["2026-08-21"]);
  assert.equal(cacheMetrics().retainedDatasets, 1);
});

test("五類 dataset 逐片合併、同日修正、日期裁切與 identity 隔離", () => {
  resetChipRequestCacheForTest();
  const datasets = ["institutional-flow", "foreign-holding", "margin-short", "securities-lending", "shareholder-distribution"];
  const availability = Object.fromEntries(datasets.map((dataset) => [dataset, { status: "available", reason: "available", rowCount: 2 }]));
  const coverage = datasets.map((dataset) => ({ dataset, start: "2026-08-20", end: "2026-08-21", ...(dataset === "shareholder-distribution" ? { savedWeeks: 2 } : {}) }));
  const initial = reconcileChipPayload({
    payload: completePayload({
      rows: [completeDailyRow("2026-08-20", 1), completeDailyRow("2026-08-21", 2)],
      distributionRows: [distributionRow("2026-08-20", 1), distributionRow("2026-08-21", 2)],
      availability,
      coverage,
    }),
    symbol: "2330.TW", interval: "1d", datasets, range: { start: "2026-08-20", end: "2026-08-21" }, nowMs: 1000,
  });
  assert.equal(initial.retainedDatasets.length, 0);

  const corrected = completeDailyRow("2026-08-21", 2);
  corrected.marginShort.marginTodayBalanceLots = 999;
  const newInstitutional = completeDailyRow("2026-08-22", 3);
  const mixed = completePayload({
    rows: [
      {
        symbol: "2330.TW", sessionDate: corrected.sessionDate,
        marginShort: corrected.marginShort,
        provenance: { "margin-short": corrected.provenance["margin-short"] },
      },
      {
        symbol: "2330.TW", sessionDate: newInstitutional.sessionDate,
        institutionalFlow: newInstitutional.institutionalFlow,
        provenance: { "institutional-flow": newInstitutional.provenance["institutional-flow"] },
      },
    ],
    availability: {
      "institutional-flow": { status: "available", reason: "available", rowCount: 1 },
      "foreign-holding": { status: "unavailable", reason: "not_published", rowCount: 0 },
      "margin-short": { status: "available", reason: "available", rowCount: 1 },
      "securities-lending": { status: "unavailable", reason: "provider_unavailable", rowCount: 0 },
      "shareholder-distribution": { status: "unavailable", reason: "history_not_archived", rowCount: 0 },
    },
    coverage: datasets.map((dataset) => ({ dataset, start: dataset === "institutional-flow" ? "2026-08-22" : null, end: dataset === "institutional-flow" ? "2026-08-22" : null })),
  });
  const result = reconcileChipPayload({
    payload: mixed, symbol: "2330.TW", interval: "1d", datasets, range: { start: "2026-08-21", end: "2026-08-22" }, nowMs: 2000,
  });
  assert.deepEqual(normalized(result.rows.map((row) => row.sessionDate)), ["2026-08-21", "2026-08-22"]);
  assert.equal(result.rows.find((row) => row.sessionDate === "2026-08-21").marginShort.marginTodayBalanceLots, 999);
  assert.equal(result.rows.find((row) => row.sessionDate === "2026-08-22").institutionalFlow.institutionalTotalNetShares, 3000);
  assert.equal(result.rows.find((row) => row.sessionDate === "2026-08-21").foreignHolding.heldRatioPercent, 2);
  assert.deepEqual(normalized(result.distributionRows.map((row) => row.dataDate)), ["2026-08-21"]);
  assert.deepEqual(normalized(result.retainedDatasets.map((item) => item.dataset).sort()), ["foreign-holding", "institutional-flow", "securities-lending", "shareholder-distribution"]);
  for (const definition of CHIP_PANE_REGISTRY) {
    for (const dataset of definition.datasets || [definition.dataset]) {
      const slice = extractDatasetSlice(result, dataset, { start: "2026-08-21", end: "2026-08-22" });
      assert.equal(datasetQualitySummary(slice).drawable, true, `${definition.id} 的 ${dataset} 不得被混合弱回應清空`);
    }
  }

  const marginSlice = extractDatasetSlice(result, "margin-short", { start: "2026-08-21", end: "2026-08-22" });
  assert.deepEqual(normalized(datasetQualitySummary(marginSlice).dates), ["2026-08-21"]);

  const otherSymbol = reconcileChipPayload({
    payload: completePayload({ symbol: "2317.TW", availability: { "shareholder-distribution": { status: "unavailable", reason: "not_published", rowCount: 0 } } }),
    symbol: "2317.TW", interval: "1d", datasets: ["shareholder-distribution"], range: { start: "2026-08-20", end: "2026-08-22" }, nowMs: 3000,
  });
  assert.equal(otherSymbol.distributionRows.length, 0);
  assert.equal(otherSymbol.retainedDatasets.length, 0);
  const otherInterval = reconcileChipPayload({
    payload: completePayload({ interval: "1wk", availability: { "shareholder-distribution": { status: "unavailable", reason: "unsupported_interval", rowCount: 0 } } }),
    symbol: "2330.TW", interval: "1wk", datasets: ["shareholder-distribution"], range: { start: "2026-08-20", end: "2026-08-22" }, nowMs: 4000,
  });
  assert.equal(otherInterval.distributionRows.length, 0);
  assert.equal(otherInterval.retainedDatasets.length, 0);
});

test("payload、日資料與 TDCC identity 不一致時拒絕且不污染 verified slice", () => {
  resetChipRequestCacheForTest();
  const input = {
    symbol: "2330.TW", interval: "1d", datasets: ["margin-short"],
    range: { start: "2026-08-21", end: "2026-08-21" }, nowMs: 1000,
  };
  assert.throws(() => reconcileChipPayload({
    ...input,
    payload: completePayload({ symbol: "2317.TW", rows: [{ ...completeDailyRow("2026-08-21"), symbol: "2317.TW" }] }),
  }), /identity 不一致/);
  assert.throws(() => reconcileChipPayload({
    ...input,
    payload: completePayload({ rows: [{ ...completeDailyRow("2026-08-21"), symbol: "2317.TW" }] }),
  }), /identity 不一致/);
  assert.throws(() => reconcileChipPayload({
    ...input,
    datasets: ["shareholder-distribution"],
    payload: completePayload({ distributionRows: [{ ...distributionRow("2026-08-21"), symbol: "2317.TW" }] }),
  }), /identity 不一致/);
  const clean = reconcileChipPayload({
    ...input,
    payload: completePayload({ availability: { "margin-short": { status: "unavailable", reason: "not_published", rowCount: 0 } } }),
    nowMs: 2000,
  });
  assert.equal(clean.rows.length, 0);
  assert.equal(clean.retainedDatasets.length, 0);
});

test("同日稀疏候選保留完整資料，完整合法修正仍可更新", () => {
  resetChipRequestCacheForTest();
  const input = {
    symbol: "2330.TW", interval: "1d", datasets: ["margin-short"],
    range: { start: "2026-08-21", end: "2026-08-21" },
  };
  const original = completeDailyRow("2026-08-21", 1);
  original.marginShort = { marginTodayBalanceLots: 100, shortTodayBalanceLots: 50, marginUtilizationPercent: 20 };
  reconcileChipPayload({
    ...input,
    payload: completePayload({ rows: [original], availability: { "margin-short": { status: "available", reason: "available", rowCount: 1 } } }),
    nowMs: 1000,
  });
  const sparse = completeDailyRow("2026-08-21", 2);
  sparse.marginShort = { marginTodayBalanceLots: 999 };
  const retained = reconcileChipPayload({
    ...input,
    payload: completePayload({ rows: [sparse], availability: { "margin-short": { status: "available", reason: "available", rowCount: 1 } } }),
    nowMs: 2000,
  });
  assert.deepEqual(normalized(retained.rows[0].marginShort), normalized(original.marginShort));
  assert.deepEqual(normalized(retained.retainedDatasets.map((item) => item.dataset)), ["margin-short"]);

  const correction = structuredClone(original);
  correction.marginShort.marginTodayBalanceLots = 101;
  const corrected = reconcileChipPayload({
    ...input,
    payload: completePayload({ rows: [correction], availability: { "margin-short": { status: "available", reason: "available", rowCount: 1 } } }),
    nowMs: 3000,
  });
  assert.equal(corrected.rows[0].marginShort.marginTodayBalanceLots, 101);
  assert.equal(corrected.retainedDatasets.length, 0);
});

test("TDCC 部分級距視為 invalid response 且不得覆寫完整切片", () => {
  resetChipRequestCacheForTest();
  const input = {
    symbol: "2330.TW", interval: "1d", datasets: ["shareholder-distribution"],
    range: { start: "2026-08-21", end: "2026-08-21" },
  };
  const original = distributionRow("2026-08-21");
  reconcileChipPayload({
    ...input,
    payload: completePayload({ distributionRows: [original], availability: { "shareholder-distribution": { status: "available", reason: "available", rowCount: 1 } } }),
    nowMs: 1000,
  });
  const incomplete = { ...structuredClone(original), levels: original.levels.filter((item) => [1, 2, 3, 15].includes(item.level)) };
  const retained = reconcileChipPayload({
    ...input,
    payload: completePayload({ distributionRows: [incomplete], availability: { "shareholder-distribution": { status: "available", reason: "available", rowCount: 1 } } }),
    nowMs: 2000,
  });
  assert.equal(retained.distributionRows[0].levels.length, 15);
  assert.equal(retained.availability["shareholder-distribution"].sourceReason, "invalid_response");
  assert.deepEqual(normalized(retained.retainedDatasets.map((item) => item.dataset)), ["shareholder-distribution"]);
});

test("目前 range 的 rows、coverage 與來源 metadata 保持一致", () => {
  resetChipRequestCacheForTest();
  const wideRows = [completeDailyRow("2026-08-20", 1), completeDailyRow("2026-08-21", 2)];
  wideRows.forEach((row) => { row.provenance["margin-short"].provider = "twse"; });
  reconcileChipPayload({
    payload: completePayload({
      rows: wideRows,
      availability: { "margin-short": { status: "available", reason: "available", rowCount: 2 } },
      coverage: [{ dataset: "margin-short", start: "2026-08-20", end: "2026-08-21" }],
      sources: [{ dataset: "margin-short", providers: ["twse"], frequency: "daily" }],
    }),
    symbol: "2330.TW", interval: "1d", datasets: ["margin-short"],
    range: { start: "2026-08-20", end: "2026-08-21" }, nowMs: 1000,
  });
  const narrow = reconcileChipPayload({
    payload: completePayload({
      rows: [],
      availability: { "margin-short": { status: "unavailable", reason: "provider_unavailable", rowCount: 0 } },
      coverage: [{ dataset: "margin-short", start: null, end: null }],
      sources: [{ dataset: "margin-short", providers: ["finmind"], frequency: "daily" }],
    }),
    symbol: "2330.TW", interval: "1d", datasets: ["margin-short"],
    range: { start: "2026-08-21", end: "2026-08-21" }, nowMs: 2000,
  });
  assert.deepEqual(normalized(narrow.rows.map((row) => row.sessionDate)), ["2026-08-21"]);
  assert.deepEqual(normalized(narrow.coverage[0]), {
    dataset: "margin-short", start: "2026-08-21", end: "2026-08-21",
    requestedStart: "2026-08-21", requestedEnd: "2026-08-21", retained: true,
  });
  assert.deepEqual(normalized(narrow.sources[0].providers), ["twse"]);
  assert.equal(narrow.rows[0].provenance["margin-short"].provider, "twse");
});

test("verified slice store 採 TTL 與 LRU 上限且 metrics 不揭露商品清單", () => {
  resetChipRequestCacheForTest();
  const payloadForSymbol = (symbol) => completePayload({
    symbol,
    rows: [{ ...completeDailyRow("2026-08-21"), symbol }],
    availability: { "margin-short": { status: "available", reason: "available", rowCount: 1 } },
  });
  reconcileChipPayload({
    payload: payloadForSymbol("0001.TW"), symbol: "0001.TW", interval: "1d", datasets: ["margin-short"],
    range: { start: "2026-08-21", end: "2026-08-21" }, nowMs: 1,
  });
  reconcileChipPayload({
    payload: payloadForSymbol("0002.TW"), symbol: "0002.TW", interval: "1d", datasets: ["margin-short"],
    range: { start: "2026-08-21", end: "2026-08-21" }, nowMs: 8 * 24 * 60 * 60 * 1000,
  });
  assert.equal(cacheMetrics().verifiedEntries, 1, "超過 TTL 的 verified slice 必須清除");

  resetChipRequestCacheForTest();
  for (let index = 0; index < 321; index += 1) {
    const symbol = `${String(index).padStart(4, "0")}.TW`;
    reconcileChipPayload({
      payload: payloadForSymbol(symbol), symbol, interval: "1d", datasets: ["margin-short"],
      range: { start: "2026-08-21", end: "2026-08-21" }, nowMs: 1000 + index,
    });
  }
  const metrics = cacheMetrics();
  assert.equal(metrics.verifiedEntries, 320);
  assert.equal(metrics.verifiedEvicted, 1);
  assert.equal(Object.values(metrics).some((value) => Array.isArray(value)), false);
});

test("逾時、取消與手動 cache invalidation 後 queue 釋放且 verified slice 仍可保護畫面", async () => {
  resetChipRequestCacheForTest();
  const input = {
    symbol: "2330.TW", interval: "1d", datasets: ["margin-short"],
    candles: [{ time: "2026-08-20" }, { time: "2026-08-21" }],
  };
  fetchImpl = async () => new Promise(() => {});
  await assert.rejects(requestData({ ...input, timeoutMs: 5 }), /預載逾時/);
  assert.equal(cacheMetrics().inFlightRequests, 0);

  let release;
  fetchImpl = async () => new Promise((resolve) => {
    release = () => resolve(Response.json(completePayload({
      rows: [completeDailyRow("2026-08-21")],
      availability: { "margin-short": { status: "available", reason: "available", rowCount: 1 } },
    })));
  });
  const abortController = new AbortController();
  const cancelled = requestData({ ...input, signal: abortController.signal });
  await Promise.resolve();
  abortController.abort();
  await assert.rejects(cancelled, (error) => error?.name === "AbortError");
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cacheMetrics().inFlightRequests, 0);

  window.QuoteChartChipPanes.__test.invalidateChipRequestCache("2330.TW");
  fetchImpl = async () => Response.json(completePayload({
    availability: { "margin-short": { status: "unavailable", reason: "not_published", rowCount: 0 } },
  }));
  const retained = await requestData({ ...input, forceRefresh: true });
  assert.equal(retained.rows[0].marginShort.marginTodayBalanceLots, 100);
  assert.equal(retained.availability["margin-short"].reason, "retained_stale");
});

test("日籌碼與 TDCC cache 使用不同 freshness 並可判定 stale", () => {
  const dailyFreshness = chipCacheFreshnessMs(["margin-short"]);
  const tdccFreshness = chipCacheFreshnessMs(["shareholder-distribution"]);
  assert.ok(tdccFreshness > dailyFreshness);
  assert.equal(chipCacheEntryState({ cachedAt: 1000, datasets: ["margin-short"] }, ["margin-short"], 1000 + dailyFreshness - 1).stale, false);
  assert.equal(chipCacheEntryState({ cachedAt: 1000, datasets: ["margin-short"] }, ["margin-short"], 1000 + dailyFreshness).stale, true);
  assert.equal(chipCacheEntryState({ cachedAt: 1000, datasets: ["shareholder-distribution"] }, ["shareholder-distribution"], 1000 + dailyFreshness).stale, false);
});

test("SWR foreground 只在沒有最後 payload 時才以空資料清除 pane", () => {
  assert.match(source, /const cached = force \? null : readCachedChipRequest/);
  assert.match(source, /options\.onPayloadRendered\?\.\(\{ symbol: context\.symbol, source: "cache", stale: cached\.stale \}\)/);
  assert.match(source, /if \(payload === undefined\) \{[\s\S]*rows: \[\], distributionRows: \[\]/);
});

test("同 context 空 candles 與相同 request identity 保留既有籌碼 payload", () => {
  const payload = { distributionRows: [{ dataDate: "2026-07-09" }] };
  assert.equal(shouldPreserveChipPayloadForEmptyContext({ identityChanged: false, sourceChanged: false, candles: [] }), true);
  assert.equal(shouldPreserveChipPayloadForEmptyContext({ identityChanged: true, sourceChanged: false, candles: [] }), true);
  assert.equal(shouldPreserveChipPayloadForEmptyContext({ identityChanged: false, sourceChanged: true, candles: [] }), false);
  assert.equal(shouldReuseChipPayload({ payload, payloadRequestKey: "same", requestKey: "same" }), true);
  assert.equal(shouldReuseChipPayload({ force: true, payload, payloadRequestKey: "same", requestKey: "same" }), false);
  assert.equal(shouldReuseChipPayload({ payload, payloadRequestKey: "old", requestKey: "new" }), false);
  assert.equal(shouldReuseChipPayload({ payload: undefined, payloadRequestKey: "same", requestKey: "same" }), false);
});

test("籌碼 material signature 與 per-pane gate 忽略 refresh metadata 且只提交成功 render", () => {
  const first = {
    symbol: "2330.TW",
    rows: [{ sessionDate: "2026-08-21", marginShort: { marginTodayBalanceLots: 10 }, provenance: { fetchedAt: "first" } }],
    availability: { "margin-short": { status: "available", rowCount: 1 } },
    coverage: [{ dataset: "margin-short", start: "2026-08-21", end: "2026-08-21", requestedStart: "2026-01-01", requestedEnd: "2026-08-21" }],
    cache: { mode: "d1_hit" },
  };
  const metadataOnly = structuredClone(first);
  metadataOnly.rows[0].provenance.fetchedAt = "second";
  metadataOnly.coverage[0].requestedStart = "2025-01-01";
  metadataOnly.cache.mode = "d1_refreshed";
  assert.equal(chipPayloadMaterialSignature(first), chipPayloadMaterialSignature(metadataOnly));

  const changed = structuredClone(metadataOnly);
  changed.rows[0].marginShort.marginTodayBalanceLots = 11;
  assert.notEqual(chipPayloadMaterialSignature(first), chipPayloadMaterialSignature(changed));

  const gate = createChipRenderGate();
  const firstSignature = `${chipPayloadMaterialSignature(first)}|balance`;
  const changedSignature = `${chipPayloadMaterialSignature(changed)}|balance`;
  assert.equal(gate.shouldRender(firstSignature), true);
  gate.commit(firstSignature);
  assert.equal(gate.shouldRender(firstSignature), false);
  assert.equal(gate.shouldRender(changedSignature), true);
  assert.equal(gate.shouldRender(changedSignature), true, "未 commit 的失敗 render 必須仍可安全重試");
  gate.commit(changedSignature);
  assert.equal(gate.shouldRender(changedSignature), false);
  gate.reset();
  assert.equal(gate.shouldRender(changedSignature), true);
});

test("籌碼 crosshair readout signature 只在可見內容改變時更新 DOM", () => {
  const first = {
    date: "2026-08-24",
    segments: [{ label: "大戶", value: "67.5%", direction: "positive", showArrow: true }],
    missing: false,
  };
  assert.equal(chipReadoutContentSignature(first), chipReadoutContentSignature(structuredClone(first)));
  const changed = structuredClone(first);
  changed.segments[0].value = "67.6%";
  assert.notEqual(chipReadoutContentSignature(first), chipReadoutContentSignature(changed));
  assert.equal(chipReadoutContentSignature(null), "");
});

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
