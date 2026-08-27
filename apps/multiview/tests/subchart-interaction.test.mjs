import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [indexHtml, appSource, chipSource, styles] = await Promise.all([
  readFile(new URL("../public/static/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/static/app.js", import.meta.url), "utf8"),
  readFile(new URL("../public/static/chip-panes.js", import.meta.url), "utf8"),
  readFile(new URL("../public/static/styles.css", import.meta.url), "utf8"),
]);

const window = { QuoteChartInteractions: {} };
vm.runInNewContext(chipSource, { window, structuredClone, URLSearchParams, Intl, DOMException, Map, Set });
const {
  CHIP_PANE_GROUPS,
  __test: {
    groupForPane,
    groupSelectionState,
    chipReadoutLayoutSignature,
    movePaneInOrder,
    normalizeChipPaneMode,
    normalizeGroupOrder,
    normalizePaneOrder,
    paneDragScrollVelocity,
    paneIdsForGroupOrder,
    readoutEnvelopeCandidates,
    readoutSegmentText,
    toggleGroupSelection,
    warningColorForText,
    warningMessages,
  },
} = window.QuoteChartChipPanes;

test("籌碼讀值包絡會保留不同資料結構並合併各欄最長內容", () => {
  const completeShort = {
    date: "2026-08-01",
    segments: [
      { label: "餘額", value: "12 張", seriesId: "balance" },
      { label: "變化", value: "+1 張", direction: "positive", showArrow: true, seriesId: "change" },
    ],
  };
  const completeLong = {
    date: "2026-08-04",
    segments: [
      { label: "餘額", value: "9,999,999 張", seriesId: "balance" },
      { label: "變化", value: "首筆／無前日比較", direction: "flat", seriesId: "change" },
    ],
  };
  const missing = { date: "2026-08-03", segments: [{ label: "", value: "當日無資料", tone: "missing" }] };
  const candidates = readoutEnvelopeCandidates([completeShort, completeLong, missing]);

  assert.equal(candidates.length, 2);
  assert.equal(candidates.find((item) => item.segments.length === 2).segments[0].value, "9,999,999 張");
  assert.equal(candidates.find((item) => item.segments.length === 2).segments[1].value, "首筆／無前日比較");
  assert.equal(readoutSegmentText(completeShort.segments[1]), "變化 +1 張 ↑");
});

test("籌碼讀值版面簽章正規化 series 並辨識合法版面變更", () => {
  const baseline = chipReadoutLayoutSignature({
    mode: "B",
    width: 320,
    fontFamily: "sans-serif",
    fontSize: "9px",
    lineHeight: "10.8px",
    zoom: 2,
    selectedSeries: ["change", "ratio"],
    dataState: "complete|missing",
    threshold: "15",
  });
  assert.equal(baseline, chipReadoutLayoutSignature({
    mode: "B",
    width: 320.1,
    fontFamily: "sans-serif",
    fontSize: "9px",
    lineHeight: "10.8px",
    zoom: 2,
    selectedSeries: ["ratio", "change"],
    dataState: "complete|missing",
    threshold: "15",
  }));
  assert.notEqual(baseline, chipReadoutLayoutSignature({
    mode: "B",
    width: 280,
    fontFamily: "sans-serif",
    fontSize: "9px",
    lineHeight: "10.8px",
    zoom: 2,
    selectedSeries: ["ratio", "change"],
    dataState: "complete|missing",
    threshold: "15",
  }));
});

function sourceFunction(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `找不到 ${name} source`);
  return source.slice(start, end);
}

function createMenu({ top = 100, bottom = 132, left = 100, right = 138, scrollHeight = 240, offsetWidth = 260 } = {}) {
  const listeners = new Map();
  const classes = new Set();
  const styleValues = new Map();
  let summaryRect = { top, bottom, left, right };
  const summary = { getBoundingClientRect: () => ({ ...summaryRect }) };
  const options = {
    scrollHeight,
    offsetWidth,
    style: {
      setProperty(name, value) { styleValues.set(name, value); },
      removeProperty(name) { styleValues.delete(name); },
      getPropertyValue(name) { return styleValues.get(name) || ""; },
    },
  };
  return {
    open: false,
    classList: {
      remove(name) { classes.delete(name); },
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); },
    },
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
    contains(target) { return target === this || target?.menu === this; },
    querySelector(selector) {
      if (selector === "summary") return summary;
      if (selector === ".indicator-options") return options;
      return null;
    },
    setSummaryRect(next) { summaryRect = { ...summaryRect, ...next }; },
    menuMaxHeight() { return options.style.getPropertyValue("--indicator-menu-max-height"); },
    toggle() { listeners.get("toggle")?.(); },
    listenerCount() { return listeners.size; },
  };
}

function createFakeWindow() {
  const listeners = new Map();
  return {
    innerHeight: 800,
    innerWidth: 1280,
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    dispatch(name) { for (const listener of listeners.get(name) || []) listener({ target: this }); },
    listenerCount(name) { return listeners.get(name)?.size || 0; },
  };
}

test("主圖與副圖選單具備可清理的外部左鍵收合控制器", () => {
  assert.match(appSource, /const cleanupIndicatorMenus = wireIndicatorMenus\(indicatorMenus\)/);
  assert.match(appSource, /document\.addEventListener\("pointerdown", handleDocumentPointerDown, true\)/);
  assert.match(appSource, /event\.button !== 0|event\.button === 0/);
  assert.match(appSource, /if \(menu\.contains\(event\.target\)\) return/);
  assert.match(appSource, /cleanupIndicatorMenus\(\)/);
});

test("crosshair 讀值熱路徑只更新內容，不量測或協調版面", () => {
  const inlineBlock = sourceFunction(chipSource, "renderInlineReadout", "readoutModelsForReservation");
  const managerHotPath = chipSource.slice(
    chipSource.indexOf("      showReadouts(time)"),
    chipSource.indexOf("      measureCoordinates(time)"),
  );
  for (const forbidden of [
    "getBoundingClientRect",
    "scrollHeight",
    "offsetHeight",
    "scheduleReadoutReservation",
    "scheduleChipReadoutCohorts",
    ".resize(",
  ]) {
    assert.doesNotMatch(inlineBlock, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(managerHotPath, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(chipSource, /className = "chip-pane-inline-readout chip-pane-readout-measurer"/);
  assert.match(chipSource, /readoutMeasurer\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(chipSource, /readoutMeasurer\.setAttribute\("data-export-exclude", "true"\)/);
  assert.match(chipSource, /function scheduleChipReadoutCohorts\(\)/);
  assert.match(inlineBlock, /if \(signature === inlineReadoutSignature\) return false/);
  assert.match(chipSource, /ordered\.slice\(0, index \+ 1\)\.join\(","\)/);
  assert.match(styles, /\.chip-pane-inline-readout\s*\{[^}]*min-block-size: var\(--chip-readout-reserved-height, 0px\);/s);
  assert.match(styles, /\.chip-pane-readout-measurer\s*\{[^}]*visibility: hidden;[^}]*pointer-events: none;/s);
  assert.match(appSource, /chipReadoutGeometry\(\)/);
});

test("游標熱路徑以 chart callback 與 animation frame latest-wins，pointer move 不重建 overlays", () => {
  const attachBlock = sourceFunction(appSource, "attachOverlayRerenderHooks", "detachOverlayRerenderHooks");
  const pointerBlock = sourceFunction(appSource, "handleSurfacePointerMove", "handleSurfacePointerLeave");
  const syncBlock = sourceFunction(appSource, "syncCrosshairForTime", "renderSyncedCrosshair");
  const renderBlock = sourceFunction(appSource, "renderSyncedCrosshair", "clearSyncedCrosshair");
  const annotationBlock = sourceFunction(appSource, "scheduleAnnotationStateRender", "renderMainOverlays");
  assert.match(appSource, /chart\.subscribeCrosshairMove\(handleCrosshairMove\)/);
  assert.match(appSource, /indicatorChart\.subscribeCrosshairMove\(handleIndicatorCrosshairMove\)/);
  assert.match(attachBlock, /\["wheel", "pointerup", "pointerleave", "dblclick"\]/);
  assert.doesNotMatch(attachBlock, /\["wheel", "pointermove"/);
  assert.doesNotMatch(pointerBlock, /syncCrosshairForTime|sharedCandleTimeForScreenX/);
  assert.doesNotMatch(appSource, /handleIndicatorSurfacePointerMove/);
  assert.match(syncBlock, /if \(!crosshairRenderFrame && commitKey === lastCrosshairCommitKey\) return/);
  assert.match(syncBlock, /crosshairPayloadRevision/);
  assert.doesNotMatch(syncBlock, /lastPayloadRenderSignature/);
  assert.match(syncBlock, /panelLifecycle\.requestFrame/);
  assert.match(renderBlock, /if \(commitKey === lastCrosshairCommitKey\) return/);
  assert.match(renderBlock, /lastCrosshairCommitKey = commitKey/);
  assert.match(annotationBlock, /pendingAnnotationState = annotationState/);
  assert.match(annotationBlock, /if \(!isPanelActive\(\) \|\| annotationRenderFrame\) return/);
  assert.match(annotationBlock, /panelLifecycle\.requestFrame/);
});

test("即時日 K 新增日期會同步技術、分日線與籌碼時間錨點且不重新抓籌碼資料", () => {
  const realtimeBlock = appSource.slice(
    appSource.indexOf("  function applyRealtimeSnapshot(snapshot) {"),
    appSource.indexOf("\n  function previousCloseForSession"),
  );
  assert.match(realtimeBlock, /const previousVisibleTimeRange = chart\.timeScale\(\)\.getVisibleRange\?\.\(\)/);
  assert.match(realtimeBlock, /candleSeries\.update\(candle\);\s*updateIndicatorTimeAnchor\(candle\);\s*refreshDayBoundaries\(result\.candles\);\s*chipPaneManager\?\.updateCandles\?\.\(result\.candles\);/s);
  assert.match(realtimeBlock, /setSynchronizedVisibleTimeRange\(\{[\s\S]*?from: previousVisibleTimeRange\.from,[\s\S]*?to: wasLatestVisible \? candle\.time : previousVisibleTimeRange\.to/);
  assert.doesNotMatch(realtimeBlock, /chipPaneManager\?\.setContext/);
  const updateCandlesBlock = chipSource.slice(
    chipSource.indexOf("      updateCandles(candles) {"),
    chipSource.indexOf("\n      setMode(nextMode)"),
  );
  assert.match(updateCandlesBlock, /controller\.setCandles\(nextCandles\)[\s\S]*if \(previousRange\.start === nextRange\.start && previousRange\.end === nextRange\.end\) return/);
  assert.doesNotMatch(updateCandlesBlock, /\bload\(\)|sharedChipRequest|fetch\(/);
});

test("大戶散戶縱軸與同日新價位都會維持 autoscale", () => {
  const paneOptionsBlock = chipSource.slice(
    chipSource.indexOf("  function paneChartInteractionOptions("),
    chipSource.indexOf("\n  function chartOptions", chipSource.indexOf("  function paneChartInteractionOptions(")),
  );
  assert.match(paneOptionsBlock, /isHolderDefinition\(definition\)/);
  assert.match(paneOptionsBlock, /axisPressedMouseMove:\s*\{[\s\S]*time:[\s\S]*price: false/);

  const controllerSetCandlesStart = chipSource.indexOf("      setCandles(candles) {");
  const controllerSetCandlesBlock = chipSource.slice(
    controllerSetCandlesStart,
    chipSource.indexOf("\n      isMounted()", controllerSetCandlesStart),
  );
  assert.match(controllerSetCandlesBlock, /lastCandles = nextCandles;\s*stabilizeHolderPriceScales\(\);\s*if \(previousRange\.start === nextRange\.start && previousRange\.end === nextRange\.end\) return/);

  const stabilizeBlock = chipSource.slice(
    chipSource.indexOf("    function stabilizeHolderPriceScales()"),
    chipSource.indexOf("\n    function mountChart()", chipSource.indexOf("    function stabilizeHolderPriceScales()")),
  );
  assert.match(stabilizeBlock, /priceScale\(scaleId\)\.applyOptions\(\{ autoScale: true \}\)/);
  assert.match(chipSource, /if \(detailsPinnedDate && !holderDetails\.hidden\) renderDetailTable\(detailsPinnedDate\);\s*stabilizeHolderPriceScales\(\);/);
});

test("已快取擴充歷史時前景更新沿用相同 K 棒數避免時間軸基準漂移", () => {
  const loadBlock = appSource.slice(
    appSource.indexOf("  async function load(options = {}) {"),
    appSource.indexOf("\n  async function refreshPivotPointSelection"),
  );
  assert.match(loadBlock, /const cachedDisplayCount = Math\.min\(MAX_HISTORY_DISPLAY_CANDLES, Number\(cachedPayload\?\.candles\?\.length\) \|\| 0\)/);
  assert.match(loadBlock, /cachedDisplayCount > HISTORY_LOAD_BATCH_BARS[\s\S]*?display_count=/);
});

test("批次 K 線更新同步技術與籌碼時間錨點", () => {
  const liveBlock = appSource.slice(
    appSource.indexOf("  function applyLiveEvent(event) {"),
    appSource.indexOf("\n  function realtimeEligible"),
  );
  assert.match(liveBlock, /chipPaneManager\?\.updateCandles\?\.\(lastPayload\?\.candles \|\| \[\]\)/);
  assert.match(liveBlock, /setSynchronizedVisibleTimeRange\(liveVisibleTimeRange\)/);
  assert.match(liveBlock, /scheduleRenderedAxisSafeWidthSync\(\)/);
  assert.doesNotMatch(liveBlock, /syncIndicatorVisibleRangeToMain\(\)/);
});

test("版面穩定階段以 canonical logical range 重設所有 pane", () => {
  assert.match(appSource, /syncRenderedAxisSafeWidth\(\);\s*normalizePaneCoordinateAlignment\(\);/s);
  const normalizeBlock = appSource.slice(
    appSource.indexOf("  function normalizePaneCoordinateAlignment("),
    appSource.indexOf("\n  function visibleRangeForCandles"),
  );
  assert.match(normalizeBlock, /indicatorChart\.timeScale\(\)\.setVisibleLogicalRange\(mainRange\)/);
  assert.match(normalizeBlock, /chipPaneManager\?\.syncRange\?\.\(mainRange\)/);
  assert.doesNotMatch(normalizeBlock, /logicalShift|alignCoordinates/);
});

test("籌碼時間範圍同步隔離空圖例外並退回邏輯範圍", () => {
  const syncBlock = chipSource.slice(
    chipSource.indexOf("      syncTimeRange(range) {"),
    chipSource.indexOf("\n      alignCoordinate(time", chipSource.indexOf("      syncTimeRange(range) {")),
  );
  assert.match(syncBlock, /try\s*\{\s*chart\.timeScale\(\)\.setVisibleRange\(range\)/s);
  assert.match(syncBlock, /const logicalRange = options\.getMainRange\?\.\(\)/);
  assert.match(syncBlock, /setVisibleLogicalRange\(logicalRange\)/);
});

test("呈現模式偏好安全遷移且新值優先於舊 A／B", () => {
  const storage = (entries = {}) => {
    const values = new Map(Object.entries(entries));
    return {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, value); },
      value(key) { return values.get(key); },
    };
  };
  const sandbox = {
    CHART_PRESENTATION_MODE_KEY: "quoteChart.chartPresentationMode.v1",
    COMPACT_SUBCHART_MODE_KEY: "compactSubchartMode",
    CHART_PRESENTATION_MODES: { main: "main", single: "single", multi: "multi" },
  };
  const preferenceSource = sourceFunction(appSource, "normalizeChartPresentationMode", "isTaiwanStockSymbol");
  vm.runInNewContext(`${preferenceSource}; this.readChartPresentationMode = readChartPresentationMode; this.writeChartPresentationMode = writeChartPresentationMode;`, sandbox);

  assert.equal(sandbox.readChartPresentationMode(storage()), "single");
  assert.equal(sandbox.readChartPresentationMode(storage({ compactSubchartMode: "A" })), "single");
  assert.equal(sandbox.readChartPresentationMode(storage({ compactSubchartMode: "B" })), "multi");
  assert.equal(sandbox.readChartPresentationMode(storage({ compactSubchartMode: "damaged" })), "single");
  for (const mode of ["main", "single", "multi"]) {
    assert.equal(sandbox.readChartPresentationMode(storage({
      "quoteChart.chartPresentationMode.v1": mode,
      compactSubchartMode: mode === "multi" ? "A" : "B",
    })), mode);
  }

  const rollbackCompatible = storage({ compactSubchartMode: "B" });
  assert.equal(sandbox.writeChartPresentationMode(rollbackCompatible, "main"), true);
  assert.equal(rollbackCompatible.value("quoteChart.chartPresentationMode.v1"), "main");
  assert.equal(rollbackCompatible.value("compactSubchartMode"), "B");
  sandbox.writeChartPresentationMode(rollbackCompatible, "single");
  assert.equal(rollbackCompatible.value("compactSubchartMode"), "A");
});

test("單一商品圖的多層資格只依目標商品判斷且不鎖住主副圖選單", () => {
  const mainOption = { disabled: false, title: "" };
  const multiOption = { disabled: false, title: "" };
  const elements = {
    "compact-subchart-mode": { value: "", disabled: false, title: "", attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, querySelector(selector) { if (selector === 'option[value="main"]') return mainOption; if (selector === 'option[value="multi"]') return multiOption; return null; } },
    "chart-grid": { classList: { toggle() {} } },
  };
  const fakeDocument = {
    body: { classList: { toggle() {} } },
    getElementById(id) { return elements[id] || null; },
  };
  const sandbox = {
    document: fakeDocument,
    state: { singleChartView: undefined, chartPresentationMode: "multi" },
    CHART_PRESENTATION_MODES: { main: "main", single: "single", multi: "multi" },
    normalizeChartPresentationMode(value) { return ["main", "single", "multi"].includes(value) ? value : null; },
    canonicalSymbol(value) { return String(value || "").trim().toUpperCase(); },
    symbolsForActiveTab() { return sandbox.activeSymbols; },
    currentChartCount() { return sandbox.chartCount; },
    activeSymbols: [],
    chartCount: 1,
  };
  const policySource = sourceFunction(appSource, "isTaiwanStockSymbol", "handleGlobalKeydown");
  vm.runInNewContext(`${policySource}; this.isTaiwanMultiLayerCompatibleSymbol = isTaiwanMultiLayerCompatibleSymbol; this.activeTabSupportsMultiLayerSubcharts = activeTabSupportsMultiLayerSubcharts; this.effectiveChartPresentationMode = effectiveChartPresentationMode; this.updateChipModeControl = updateChipModeControl;`, sandbox);

  sandbox.activeSymbols = [{ symbol: "2454.TW" }, { symbol: "AAPL" }];
  sandbox.state.singleChartView = { symbol: "2454.TW" };
  sandbox.updateChipModeControl();
  assert.equal(elements["compact-subchart-mode"].disabled, false);
  assert.equal(elements["compact-subchart-mode"].attributes["aria-disabled"], "false");
  assert.equal(elements["compact-subchart-mode"].value, "multi");
  assert.equal(multiOption.disabled, false);

  sandbox.activeSymbols = [{ symbol: "2454.TW" }];
  sandbox.state.singleChartView = { symbol: "AAPL" };
  sandbox.updateChipModeControl();
  assert.equal(elements["compact-subchart-mode"].disabled, false);
  assert.equal(elements["compact-subchart-mode"].attributes["aria-disabled"], "false");
  assert.equal(elements["compact-subchart-mode"].value, "single");
  assert.equal(multiOption.disabled, true);
  assert.match(multiOption.title, /只有全台股頁籤或台股單一商品/);

  sandbox.state.singleChartView = undefined;
  sandbox.activeSymbols = [{ symbol: "2454.TW" }, { symbol: "8069.TWO" }];
  assert.equal(sandbox.effectiveChartPresentationMode(), "multi");
  assert.equal(sandbox.isTaiwanMultiLayerCompatibleSymbol("^TWII"), true);
  assert.equal(sandbox.isTaiwanMultiLayerCompatibleSymbol("^DJI"), false);
  sandbox.activeSymbols = [{ symbol: "^TWII" }, { symbol: "2454.TW" }, { symbol: "8069.TWO" }];
  for (const chartCount of [1, 2, 3, 4]) {
    sandbox.chartCount = chartCount;
    sandbox.updateChipModeControl();
    assert.equal(sandbox.effectiveChartPresentationMode(), "multi");
    assert.equal(sandbox.effectiveChartPresentationMode("^TWII"), "single");
    assert.equal(sandbox.effectiveChartPresentationMode("2454.TW"), "multi");
    assert.equal(mainOption.disabled, false);
    assert.equal(multiOption.disabled, false);
  }
  sandbox.activeSymbols = [{ symbol: "2454.TW" }, { symbol: "AAPL" }];
  assert.equal(sandbox.effectiveChartPresentationMode(), "single");
  sandbox.state.chartPresentationMode = "main";
  assert.equal(sandbox.effectiveChartPresentationMode("AAPL"), "main");

  sandbox.chartCount = 6;
  sandbox.state.chartPresentationMode = "multi";
  sandbox.activeSymbols = [{ symbol: "2454.TW" }, { symbol: "8069.TWO" }];
  sandbox.updateChipModeControl();
  assert.equal(sandbox.effectiveChartPresentationMode(), "single");
  assert.equal(elements["compact-subchart-mode"].value, "single");
  assert.equal(mainOption.disabled, true);
  assert.equal(multiOption.disabled, true);
  assert.match(mainOption.title, /6／8 圖固定使用單一副圖/);
  assert.match(multiOption.title, /6／8 圖固定使用單一副圖/);

  sandbox.chartCount = 8;
  sandbox.updateChipModeControl();
  assert.equal(sandbox.effectiveChartPresentationMode(), "single");

  sandbox.chartCount = 4;
  sandbox.updateChipModeControl();
  assert.equal(sandbox.effectiveChartPresentationMode(), "multi");
  assert.equal(mainOption.disabled, false);
  assert.equal(multiOption.disabled, false);
});

test("主圖模式映射到 none lifecycle 並停止不可見副圖工作", () => {
  assert.equal(normalizeChipPaneMode("main"), "none");
  assert.equal(normalizeChipPaneMode("single"), "A");
  assert.equal(normalizeChipPaneMode("multi"), "B");
  assert.match(chipSource, /function desiredPaneIds\(\) \{\s*if \(mode === "none"\) return \[\];/s);
  assert.match(chipSource, /const suspended = mode === "none";[\s\S]*?stopBackfillPolling\(\);[\s\S]*?abortController\?\.abort\(\);/);
  assert.match(chipSource, /for \(const \[id, controller\] of controllers\) if \(!desired\.has\(id\)\) \{ controller\.destroy\(\); controllers\.delete\(id\); \}/);
  assert.match(chipSource, /if \(!suspended\) load\(\)/);
  assert.match(appSource, /mode === CHART_PRESENTATION_MODES\.main[\s\S]*?has-no-subchart/);
  assert.match(appSource, /subIndicatorMenu\.toggleAttribute\("inert", mainOnly\)/);
  assert.match(appSource, /subIndicatorMenuSummary\.setAttribute\("aria-disabled", String\(mainOnly\)\)/);
  assert.match(appSource, /subIndicatorMenuSummary\.tabIndex = mainOnly \? -1 : 0/);
  assert.match(styles, /\.sub-indicator-menu\.is-disabled > summary\s*\{[^}]*pointer-events:\s*none;/s);
  assert.match(appSource, /if \(effectivePanelSubchartMode\(\) !== CHART_PRESENTATION_MODES\.main\) \{\s*applyPayloadStep\("technical-subchart", \(\) => \{[\s\S]*?renderIndicatorChart/);
});

test("選單內複選保持展開，外部左鍵、另一選單及 cleanup 依生命週期運作", () => {
  const documentListeners = new Map();
  const fakeDocument = {
    addEventListener(name, listener) {
      if (!documentListeners.has(name)) documentListeners.set(name, new Set());
      documentListeners.get(name).add(listener);
    },
    removeEventListener(name, listener) { documentListeners.get(name)?.delete(listener); },
  };
  const fakeWindow = createFakeWindow();
  const sandbox = { document: fakeDocument, window: fakeWindow, wireIndicatorMenus: undefined };
  const menuSource = sourceFunction(appSource, "resolveIndicatorMenuPlacement", "managedInstruments");
  vm.runInNewContext(`${menuSource}; this.wireIndicatorMenus = wireIndicatorMenus;`, sandbox);
  const mainMenu = createMenu();
  const subMenu = createMenu();
  const cleanup = sandbox.wireIndicatorMenus([mainMenu, subMenu]);
  const pointerdown = [...documentListeners.get("pointerdown")][0];
  const keydown = [...documentListeners.get("keydown")][0];

  subMenu.open = true;
  pointerdown({ button: 0, target: { menu: subMenu } });
  assert.equal(subMenu.open, true);
  mainMenu.open = true;
  mainMenu.toggle();
  assert.equal(mainMenu.open, true);
  assert.equal(subMenu.open, false);
  pointerdown({ button: 2, target: {} });
  assert.equal(mainMenu.open, true);
  pointerdown({ button: 0, target: {} });
  assert.equal(mainMenu.open, false);
  subMenu.open = true;
  keydown({ key: "Escape" });
  assert.equal(subMenu.open, false);

  cleanup();
  assert.equal(documentListeners.get("pointerdown").size, 0);
  assert.equal(documentListeners.get("keydown").size, 0);
  assert.equal(fakeWindow.listenerCount("resize"), 0);
  assert.equal(fakeWindow.listenerCount("scroll"), 0);
  assert.equal(mainMenu.listenerCount(), 0);
  assert.equal(subMenu.listenerCount(), 0);
});

test("功能表定位依上下空間翻轉並在兩側不足時限制高度", () => {
  const sandbox = { window: { innerHeight: 800 } };
  const menuSource = sourceFunction(appSource, "resolveIndicatorMenuPlacement", "managedInstruments");
  vm.runInNewContext(`${menuSource}; this.resolveIndicatorMenuPlacement = resolveIndicatorMenuPlacement; this.resolveIndicatorMenuHorizontalAlignment = resolveIndicatorMenuHorizontalAlignment;`, sandbox);

  const down = sandbox.resolveIndicatorMenuPlacement({ top: 100, bottom: 132 }, 300, 800);
  assert.equal(down.direction, "down");
  assert.equal(down.maxHeight, 650);
  assert.equal(down.needsScroll, false);

  const up = sandbox.resolveIndicatorMenuPlacement({ top: 600, bottom: 632 }, 300, 700);
  assert.equal(up.direction, "up");
  assert.equal(up.maxHeight, 582);
  assert.equal(up.needsScroll, false);

  const constrained = sandbox.resolveIndicatorMenuPlacement({ top: 180, bottom: 212 }, 400, 400);
  assert.equal(constrained.direction, "down");
  assert.equal(constrained.maxHeight, 170);
  assert.equal(constrained.needsScroll, true);

  const rightAligned = sandbox.resolveIndicatorMenuHorizontalAlignment({ left: 1063, right: 1101 }, 260, 1280);
  assert.equal(rightAligned, "right");
  const leftAligned = sandbox.resolveIndicatorMenuHorizontalAlignment({ left: 109, right: 147 }, 260, 1280);
  assert.equal(leftAligned, "left");
});

test("開啟中的功能表在 viewport 改變後重新定位", () => {
  const documentListeners = new Map();
  const fakeDocument = {
    addEventListener(name, listener) {
      if (!documentListeners.has(name)) documentListeners.set(name, new Set());
      documentListeners.get(name).add(listener);
    },
    removeEventListener(name, listener) { documentListeners.get(name)?.delete(listener); },
  };
  const fakeWindow = createFakeWindow();
  fakeWindow.innerHeight = 700;
  const sandbox = { document: fakeDocument, window: fakeWindow };
  const menuSource = sourceFunction(appSource, "resolveIndicatorMenuPlacement", "managedInstruments");
  vm.runInNewContext(`${menuSource}; this.wireIndicatorMenus = wireIndicatorMenus;`, sandbox);
  const menu = createMenu({ top: 600, bottom: 632, scrollHeight: 300 });
  const cleanup = sandbox.wireIndicatorMenus([menu]);

  menu.open = true;
  menu.toggle();
  assert.equal(menu.classList.contains("opens-upward"), true);
  assert.equal(menu.menuMaxHeight(), "582px");

  menu.setSummaryRect({ top: 100, bottom: 132 });
  fakeWindow.innerHeight = 900;
  fakeWindow.dispatch("resize");
  assert.equal(menu.classList.contains("opens-upward"), false);
  assert.equal(menu.menuMaxHeight(), "750px");

  cleanup();
  assert.equal(menu.menuMaxHeight(), "");
});

test("K 線橫軸只有一個共用游標日期標籤", () => {
  assert.match(indexHtml, /class="panel-crosshair-date" hidden/);
  assert.match(appSource, /const panelCrosshairDate = element\.querySelector\("\.panel-crosshair-date"\)/);
  assert.match(appSource, /const dateText = formatChartDate\(time\)[\s\S]*?panelCrosshairDate\.textContent = dateText/);
  assert.match(appSource, /panelCrosshairDate\.hidden = false/);
  assert.match(appSource, /panelCrosshairDate\.hidden = true/);
  assert.match(styles, /\.panel-crosshair-date\s*\{/);
  assert.doesNotMatch(indexHtml, /panel-crosshair-date[^>]*>\s*日期/);
});

test("游標日期以完整日期格式顯示並限制於扣除價格軸的 plot 內", () => {
  const sandbox = { clampCrosshairDateX: undefined };
  vm.runInNewContext(`${sourceFunction(appSource, "clampCrosshairDateX", "formatTimeTick")}; this.clampCrosshairDateX = clampCrosshairDateX;`, sandbox);
  assert.equal(sandbox.clampCrosshairDateX(-20, 500, 72, 82), 41);
  assert.equal(sandbox.clampCrosshairDateX(250, 500, 72, 82), 250);
  assert.equal(sandbox.clampCrosshairDateX(490, 500, 72, 82), 387);
  assert.match(appSource, /const dateText = formatChartDate\(time\)/);
  assert.match(appSource, /hideSharedCrosshair\(\);[\s\S]*?panelCrosshairDate\.textContent = ""/);
});

test("費波那契待選價位不改寫既有收盤價十字線與跨 pane 日期同步", () => {
  const renderSource = sourceFunction(appSource, "renderSyncedCrosshair", "clearSyncedCrosshair");
  assert.match(renderSource, /chart\.setCrosshairPosition\(candle\.close, time, candleSeries\)/);
  assert.match(renderSource, /chipPaneManager\?\.syncCrosshair\(time\)/);
  assert.match(renderSource, /positionSharedCrosshair\(time\)/);
  assert.doesNotMatch(renderSource, /pending\.preview|fibonacci-price-guide/);
  assert.match(appSource, /renderFibonacciAnchorPriceGuide\(pendingFibonacci\)/);
});

test("費波那契選點暫時關閉主圖折線實心 marker 且 pending 拓展不改價格尺度", () => {
  const activeSource = sourceFunction(appSource, "isFibonacciSelectionActive", "updateFibonacciCrosshairMarkers");
  assert.match(activeSource, /annotationState\?\.pending\?\.type === "fibonacci"/);
  const markerSource = sourceFunction(appSource, "updateFibonacciCrosshairMarkers", "renderChartAnnotations");
  assert.match(markerSource, /\.\.\.bollingerSeries/);
  assert.match(markerSource, /\.\.\.movingAverageSeries/);
  assert.match(markerSource, /\.\.\.lineSeries/);
  assert.match(markerSource, /estimatedMarginCostSeries/);
  assert.match(markerSource, /defaultVisible = mainLineCrosshairMarkerDefaults\.get\(series\) !== false/);
  assert.match(markerSource, /series\.applyOptions\(\{ crosshairMarkerVisible: shouldHide \? false : defaultVisible \}\)/);
  const autoScaleSource = sourceFunction(appSource, "updateFibonacciAutoScale", "isFibonacciSelectionActive");
  assert.match(autoScaleSource, /completed\.filter\(\(entry\) => entry\.kind === "extension"/);
  assert.doesNotMatch(autoScaleSource, /pending|preview/);
});

test("主圖、技術副圖與籌碼副圖的十字準線折線 marker 維持緊湊", () => {
  assert.match(appSource, /const CROSSHAIR_MARKER_RADIUS = 2;/);
  assert.match(appSource, /const CROSSHAIR_MARKER_BORDER_WIDTH = 1;/);
  assert.match(chipSource, /const CROSSHAIR_MARKER_RADIUS = 2;/);
  assert.match(chipSource, /const CROSSHAIR_MARKER_BORDER_WIDTH = 1;/);

  const mainLineSource = sourceFunction(appSource, "addLine", "addIndicatorLine");
  assert.match(mainLineSource, /crosshairMarkerRadius: CROSSHAIR_MARKER_RADIUS/);
  assert.match(mainLineSource, /crosshairMarkerBorderWidth: CROSSHAIR_MARKER_BORDER_WIDTH/);
  assert.match(mainLineSource, /crosshairMarkerVisible: isFibonacciSelectionActive\(\) \? false : defaultCrosshairMarkerVisible/);

  const indicatorLineSource = sourceFunction(appSource, "addIndicatorLine", "addIndicatorHistogram");
  assert.match(indicatorLineSource, /crosshairMarkerRadius: CROSSHAIR_MARKER_RADIUS/);
  assert.match(indicatorLineSource, /crosshairMarkerBorderWidth: CROSSHAIR_MARKER_BORDER_WIDTH/);

  const chipLineSource = sourceFunction(chipSource, "addLine", "selectedSeriesIds");
  assert.match(chipLineSource, /crosshairMarkerRadius: CROSSHAIR_MARKER_RADIUS/);
  assert.match(chipLineSource, /crosshairMarkerBorderWidth: CROSSHAIR_MARKER_BORDER_WIDTH/);
});

test("沒有技術指標時移除技術副圖列與空白高度", () => {
  assert.match(appSource, /function hasSelectedTechnicalIndicators\(\)/);
  assert.match(appSource, /subchartSlot\.classList\.toggle\("has-technical-subchart", hasTechnical\)/);
  assert.match(appSource, /subchartPresentation\.mode !== CHART_PRESENTATION_MODES\.main[\s\S]*?&& hasSelectedTechnicalIndicators\(\)/);
  assert.match(styles, /\.subchart-slot\.is-mode-b:not\(\.has-technical-subchart\)/);
  assert.match(styles, /\.subchart-slot\.is-mode-a-technical:not\(\.has-technical-subchart\)/);
  assert.match(styles, /\.chart-grid\.is-mode-b-page-scroll \.subchart-slot\.is-mode-b:not\(\.has-technical-subchart\)\s*\{[^}]*display: block;/s);
  assert.match(styles, /\.chart-grid\.is-mode-b-page-scroll \.subchart-slot\.is-mode-b\s*\{[^}]*min-height: min-content;/s);
  assert.match(styles, /\.chart-grid\.is-mode-b-page-scroll \.subchart-slot\.is-mode-b \.chip-pane-region\s*\{[^}]*min-height: min-content;/s);
  assert.match(styles, /\.chart-grid\.is-mode-b-page-scroll \.subchart-slot\.is-mode-a-technical\.has-technical-subchart\s*\{[^}]*height: var\(--mode-b-technical-height\);[^}]*min-height: var\(--mode-b-technical-height\);/s);
  assert.doesNotMatch(styles, /\.chart-grid\.is-mode-b-page-scroll \.subchart-slot\.is-mode-a-technical\s*\{[^}]*min-height: var\(--mode-b-technical-height\);/s);
});

test("多層副圖只讓可見範圍附近的籌碼圖持有 Canvas，避免技術副圖被繪圖資源擠掉", () => {
  assert.match(chipSource, /function mountChart\(\)/);
  assert.match(chipSource, /function unmountChart\(\)/);
  assert.match(chipSource, /new IntersectionObserver\(/);
  assert.match(chipSource, /rootMargin: "240px 0px"/);
  assert.match(chipSource, /intersectionObserver\.observe\(element\)/);
  assert.match(chipSource, /mountedControllerCount: mountedControllers\(\)\.length/);
  assert.match(chipSource, /intersectionObserver\?\.disconnect\(\)/);
  assert.match(chipSource, /try \{ chart\.remove\(\); \} catch \{\}/);
});

test("籌碼 pane 使用短標題且 header 不建立來源 readout segment", () => {
  for (const title of ["外資", "投信", "自營商", "三大法人"]) {
    assert.match(chipSource, new RegExp(`title: "${title}"`));
  }
  assert.match(chipSource, /title\.textContent = definition\.title \|\| definition\.label/);
  assert.doesNotMatch(chipSource, /segment\("(?:法人來源|持股來源|來源)", providerLabel/);
  assert.match(chipSource, /\["資料來源", providerLabel/);
});

test("舊偏好會正規化成完整穩定 pane 順序", () => {
  const order = JSON.parse(JSON.stringify(normalizePaneOrder(
    ["short", "foreign-flow", "short", "unknown"],
    ["margin", "retail-holder"],
  )));
  assert.deepEqual(order.slice(0, 4), ["short", "foreign-flow-holding", "margin", "retail-holder"]);
  assert.equal(order.length, 12);
  assert.equal(new Set(order).size, order.length);
  assert.deepEqual(JSON.parse(JSON.stringify(movePaneInOrder(["a", "b", "c"], "c", 0))), ["c", "a", "b"]);
  assert.deepEqual(JSON.parse(JSON.stringify(movePaneInOrder(["a", "b", "c"], "a", 99))), ["b", "c", "a"]);
});

test("十二個籌碼副圖只屬於三個固定資料群組且群組內順序固定", () => {
  const normalizedGroups = JSON.parse(JSON.stringify(CHIP_PANE_GROUPS));
  assert.deepEqual(normalizedGroups, [
    {
      id: "institutional",
      label: "法人",
      paneIds: ["foreign-flow-holding", "investment-trust-flow", "dealer-flow", "institutional-total-flow"],
    },
    {
      id: "margin-financing",
      label: "融資券",
      paneIds: ["margin", "short", "securities-lending", "short-margin-ratio", "estimated-margin-maintenance"],
    },
    { id: "holder", label: "持股比", paneIds: ["big-holder", "retail-holder", "tdcc-holder-count"] },
  ]);
  assert.equal(new Set(normalizedGroups.flatMap((group) => group.paneIds)).size, 12);
  assert.equal(groupForPane("foreign-flow"), "institutional");
  assert.equal(groupForPane("short-margin-ratio"), "margin-financing");
  assert.equal(groupForPane("retail-holder"), "holder");
});

test("群組父選項具備 checked、unchecked、indeterminate 並可一次切換全部子項", () => {
  assert.equal(groupSelectionState("margin-financing", []), "unchecked");
  assert.equal(groupSelectionState("margin-financing", ["margin"]), "indeterminate");
  assert.equal(groupSelectionState("margin-financing", ["margin", "short", "securities-lending", "short-margin-ratio", "estimated-margin-maintenance"]), "checked");
  assert.deepEqual(
    JSON.parse(JSON.stringify(toggleGroupSelection("holder", ["margin"], true))),
    ["margin", "big-holder", "retail-holder", "tdcc-holder-count"],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(toggleGroupSelection("holder", ["margin", "big-holder", "retail-holder", "tdcc-holder-count"], false))),
    ["margin"],
  );
});

test("舊 pane 排序遷移成群組排序且輸出時仍維持群組內 canonical order", () => {
  const groupOrder = JSON.parse(JSON.stringify(normalizeGroupOrder(
    ["unknown", "holder", "holder"],
    ["short", "dealer-flow", "big-holder"],
    ["short", "dealer-flow", "big-holder"],
  )));
  assert.deepEqual(groupOrder, ["holder", "margin-financing", "institutional"]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(paneIdsForGroupOrder(groupOrder, ["dealer-flow", "foreign-flow-holding", "short-margin-ratio", "margin", "retail-holder"]))),
    ["retail-holder", "margin", "short-margin-ratio", "foreign-flow-holding", "dealer-flow"],
  );
});

test("副圖選單是三個可存取群組，方式 A 停用父項且子項仍可獨立控制", () => {
  assert.equal((indexHtml.match(/class="chip-group-indicator"/g) || []).length, 3);
  for (const [id, label] of [["institutional", "法人買賣超"], ["margin-financing", "融資券"], ["holder", "持股比"]]) {
    assert.match(indexHtml, new RegExp(`data-chip-group="${id}"[\\s\\S]*?value="${id}"[\\s\\S]*?<strong>${label}<\\/strong>`));
  }
  for (const [value, label] of [
    ["foreign-flow-holding", "外資"],
    ["investment-trust-flow", "投信"],
    ["dealer-flow", "自營商"],
    ["institutional-total-flow", "合計"],
    ["margin", "融資"],
    ["short", "融券"],
    ["securities-lending", "借券"],
    ["short-margin-ratio", "券資比"],
    ["big-holder", "大戶"],
    ["retail-holder", "散戶"],
  ]) {
    assert.match(indexHtml, new RegExp(`class="chip-indicator"[^>]*value="${value}"[^>]*\\/> ${label}<\\/label>`));
  }
  assert.match(chipSource, /input\.indeterminate = state === "indeterminate"/);
  assert.match(chipSource, /input\.disabled = mode !== "B"/);
  assert.match(chipSource, /setAttribute\("aria-checked", state === "indeterminate" \? "mixed"/);
  assert.match(chipSource, /toggleGroupSelection\(input\.value, selection\.modeBSelectedPaneIds, input\.checked\)/);
});

test("副圖選單限制桌面寬度並以較小次項字級建立層級", () => {
  assert.match(styles, /\.subchart-indicator-options\s*\{[^}]*width:\s*min\(188px,\s*calc\(100vw - 24px\)\);[^}]*min-width:\s*0;[^}]*right:\s*0;[^}]*left:\s*auto;/s);
  assert.match(styles, /\.chart-grid\.grid-6 \.subchart-indicator-options,\s*\.chart-grid\.grid-8 \.subchart-indicator-options\s*\{[^}]*width:\s*min\(180px,\s*calc\(100vw - 24px\)\);/s);
  assert.match(styles, /\.chart-panel:has\(\.indicator-menu\[open\]\)\s*\{[^}]*overflow:\s*visible;[^}]*z-index:\s*30;/s);
  assert.match(styles, /\.technical-indicator-options\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*gap:\s*6px 10px;/s);
  assert.match(styles, /\.technical-indicator-options > legend\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/s);
  assert.match(styles, /\.technical-indicator-options > label\s*\{[^}]*font-size:\s*12px;/s);
  assert.match(styles, /\.chip-indicator-options\s*\{[^}]*gap:\s*2px;/s);
  assert.match(styles, /\.chip-data-group\s*\{[^}]*gap:\s*2px;[^}]*padding:\s*0;[^}]*border-top:\s*0;/s);
  assert.match(styles, /\.chip-data-group-parent\s*\{[^}]*min-height:\s*22px;/s);
  assert.match(styles, /\.chip-data-group-parent\s*\{[^}]*font-size:\s*12px;/s);
  assert.match(styles, /\.chip-data-group-children label\s*\{[^}]*font-size:\s*11px;/s);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*?\.sub-indicator-menu \.subchart-indicator-options\s*\{[^}]*right:\s*0;[^}]*left:\s*auto;/s);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*?\.chip-data-group-children\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
});

test("技術指標齒輪提供全域參數設定、雙 RSI 與參考橫線", () => {
  assert.match(indexHtml, /class="indicator-settings-trigger"[^>]*aria-label="技術指標參數設定"/);
  assert.match(indexHtml, /id="indicator-settings-dialog"[^>]*aria-labelledby="indicator-settings-title"/);
  for (const name of ["rsiShortPeriod", "rsiLongPeriod", "kdPeriod", "kdRsvWeight", "kdKWeight", "macdFastPeriod", "macdSlowPeriod", "macdSignalPeriod", "atrPeriod"]) {
    assert.match(indexHtml, new RegExp(`name="${name}"[^>]*type="number"`));
  }
  assert.match(indexHtml, /id="indicator-settings-apply"[^>]*>套用至所有圖表/);
  assert.match(appSource, /quoteChart\.indicatorParameters\.v1/);
  assert.match(appSource, /state\.panelPayloadCache\.clear\(\)/);
  assert.match(appSource, /state\.panels\.forEach\(\(panel\) => panel\.load\?\.\(\)\)/);
  assert.match(appSource, /rsi:\s*\[70, 50, 30\]/);
  assert.match(appSource, /kd:\s*\[80, 20\]/);
  assert.match(indexHtml, /data-sub-readout="rsiShort"[\s\S]*data-sub-readout="rsiLong"/);
  assert.match(appSource, /indicators\.rsi\?\.short/);
  assert.match(appSource, /indicators\.rsi\?\.long/);
  assert.match(appSource, /function formatOscillatorValue\(value\)[\s\S]*minimumFractionDigits: 2, maximumFractionDigits: 2/);
  assert.match(styles, /\.indicator-settings-dialog\s*\{[^}]*width:\s*min\(620px, calc\(100vw - 24px\)\);[^}]*max-height:\s*calc\(100vh - 24px\);/s);
});

test("主圖功能表使用 viewport-safe 翻轉與緊湊兩欄布局", () => {
  assert.match(indexHtml, /class="indicator-options main-indicator-options"/);
  assert.match(indexHtml, /class="main-indicator-toggle-grid" role="group" aria-label="主圖指標"/);
  assert.match(indexHtml, /class="main-indicator-option-wide"><input class="main-indicator" type="checkbox" value="volumeProfile"/);
  assert.match(styles, /\.indicator-options\s*\{[^}]*max-height:\s*var\(--indicator-menu-max-height,[^;]+;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/s);
  assert.match(styles, /\.indicator-menu\.opens-upward > \.indicator-options\s*\{[^}]*top:\s*auto;[^}]*bottom:\s*calc\(100% \+ 6px\);/s);
  assert.match(styles, /\.indicator-menu\.aligns-right > \.indicator-options\s*\{[^}]*right:\s*0;[^}]*left:\s*auto;/s);
  assert.match(styles, /\.main-indicator-options\s*\{[^}]*width:\s*min\(260px,\s*calc\(100vw - 24px\)\);/s);
  assert.match(styles, /\.main-indicator-toggle-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
  assert.match(styles, /\.main-indicator-toggle-grid > label\s*\{[^}]*min-height:\s*22px;[^}]*font-size:\s*12px;/s);
  assert.match(styles, /\.chart-drawing-tools\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
  assert.match(styles, /\.chart-tool-button,\s*\.chart-tool-clear\s*\{[^}]*min-height:\s*26px;/s);
});

test("主圖三套壓撐公式預設關閉且共用所選參考 K、viewport-safe 與 cleanup 契約", () => {
  assert.match(indexHtml, /value="pivotPoint" \/> Pivot Point/);
  assert.match(indexHtml, /value="threeLevelPrice" \/> 三關價/);
  assert.match(indexHtml, /value="cdp" \/> CDP/);
  assert.doesNotMatch(indexHtml, /value="pivotPoint" checked/);
  assert.doesNotMatch(indexHtml, /value="threeLevelPrice" checked/);
  assert.doesNotMatch(indexHtml, /value="cdp" checked/);
  assert.match(indexHtml, /data-readout-row="pivotPoint"/);
  for (const key of ["pivotP", "pivotR1", "pivotR2", "pivotR3", "pivotS1", "pivotS2", "pivotS3"]) {
    assert.doesNotMatch(indexHtml, new RegExp(`data-main-indicator="${key}"`));
  }
  assert.match(appSource, /function selectedSupportResistanceFormulas\(selectedMain = getSelectedMainIndicators\(\)\)/);
  assert.match(appSource, /function selectedPivotMode\(\)[\s\S]*?selectedSupportResistanceFormulas\(\)\.size \? "traditional" : null/);
  assert.match(appSource, /withPanelIndicatorParameters[\s\S]*?&pivot=traditional/);
  assert.match(appSource, /panelPayloadCacheKey\(symbol, interval, pivotMode = null\)[\s\S]*?pivot:\$\{pivotMode === "traditional" \? "traditional" : "off"\}/);
  assert.match(appSource, /SUPPORT_RESISTANCE_FORMULA_IDS\.has\(input\.value\)[\s\S]*?refreshPivotPointSelection\(\)/);
  assert.match(appSource, /projection\?\.formulaLevels\?\.threeLevelPrice/);
  assert.match(appSource, /projection\?\.formulaLevels\?\.cdp/);
  assert.match(appSource, /label\.textContent = `\$\{SUPPORT_RESISTANCE_INTERVAL_PREFIX\[sourceInterval\] \|\| sourceInterval\} \$\{prefix\} \$\{style\.title\} \$\{formatQuotePrice/);
  assert.match(appSource, /const SUPPORT_RESISTANCE_INTERVAL_RANK = Object\.freeze\(\{[\s\S]*?"1m": 0,[\s\S]*?"1mo": 6,/);
  assert.match(appSource, /function supportResistanceSourceApplies\(sourceInterval, targetInterval\)[\s\S]*?sourceRank >= targetRank/);
  assert.match(appSource, /const supportResistanceSourcesBySymbol = new Map\(\)/);
  assert.match(appSource, /function persistSupportResistanceInputState\([\s\S]*?source\.enabled = enabled/);
  assert.match(appSource, /function restoreSupportResistanceInputsForContext\(symbol, interval\)[\s\S]*?source\?\.enabled\?\.has\(input\.value\)/);
  assert.match(appSource, /function applicableSupportResistanceSources\(\)[\s\S]*?supportResistanceSourceApplies\(source\.sourceInterval, targetInterval\)/);
  assert.match(appSource, /function pivotAnchorTimeForTarget\(source, projection\)[\s\S]*?supportResistanceReferenceKeyForTime\(row\.time, source\.sourceInterval\)/);
  assert.match(appSource, /label\.dataset\.sourceInterval = sourceInterval/);
  assert.match(indexHtml, /class="pivot-point-layer"/);
  assert.match(indexHtml, /class="pivot-point-reset"[^>]*>回到最新<\/button>/);
  assert.match(appSource, /contractVersion !== "selected-next-period-v1"/);
  assert.match(appSource, /function selectPivotProjectionForSurfaceEvent\(event\)/);
  assert.match(appSource, /function selectDefaultPivotProjection\(options = \{\}\)/);
  assert.match(appSource, /function renderPivotPointOverlay\(\)/);
  assert.match(appSource, /pivotPointLayer\.replaceChildren\(\)/);
  assert.doesNotMatch(appSource, /LineType\?\.WithSteps/);
  assert.match(appSource, /crosshairMarkerRadius: CROSSHAIR_MARKER_RADIUS/);
  assert.match(appSource, /applyPayload\(preparedPayload, \{ prepared: true, viewportSnapshot, oldCandleCount \}\);\s*writePanelPayloadCache\(symbol, interval, preparedPayload, pivotMode\)/);
  assert.match(appSource, /liveBatchCoordinator\.subscribe\(panelSubscriptionId/);
  assert.match(appSource, /display_count=\$\{encodeURIComponent\(oldCandleCount\)\}/);
  assert.match(appSource, /if \(\(payload\.candles \|\| \[\]\)\.length < oldCandleCount\)/);
  assert.match(appSource, /function captureViewportSnapshot\(candles/);
  assert.match(appSource, /function restoreViewportSnapshot\(snapshot, candles/);
  assert.match(appSource, /streamPivotMode !== selectedPivotMode\(\)/);
  assert.match(appSource, /function pausePanelStreamsForForegroundRequest\(\)[\s\S]*?state\.panels\.forEach\(\(panel\) => panel\.pauseStream\?\.\(\)\)/);
  assert.match(appSource, /finally \{\s*resumePanelStreamsAfterForegroundRequest\(\);\s*\}/);
  assert.match(styles, /\.pivot-point-line\.is-dashed/);
  assert.match(styles, /\.pivot-point-line\.is-dotted/);
  assert.match(styles, /\.pivot-point-reset\s*\{[\s\S]*?pointer-events: auto;/);
});

test("籌碼說明文字移除且不適用的商品或週期不顯示籌碼選項與 pane", () => {
  assert.doesNotMatch(indexHtml, /適用台股普通股與 ETF 日 K|不代表投資人身分/);
  assert.match(styles, /\.chip-indicator-options\[hidden\]\s*\{[^}]*display:\s*none;/s);
  assert.equal(window.QuoteChartChipPanes.isEligibleContext("2330.TW", "1d"), true);
  assert.equal(window.QuoteChartChipPanes.isEligibleContext("8069.TWO", "1d"), true);
  assert.equal(window.QuoteChartChipPanes.isEligibleContext("AAPL", "1d"), false);
  assert.equal(window.QuoteChartChipPanes.isEligibleContext("2330.TW", "1wk"), false);
  assert.match(appSource, /chipIndicatorOptions\.hidden = !window\.QuoteChartChipPanes\?\.isEligibleContext\(symbolSelect\.value, intervalSelect\.value\)/);
  assert.match(appSource, /updateChipIndicatorOptionsAvailability\(\);\s*chipPaneManager\?\.setContext\(\{ symbol, interval/s);
  assert.match(chipSource, /function desiredPaneIds\(\) \{\s*if \(mode === "none"\) return \[\];\s*if \(!isEligibleContext\(context\.symbol, context\.interval\)\) return \[\];/s);
});

test("十二個籌碼 pane 共用詳細資料與圖片匯出，技術副圖沒有詳細資料入口", () => {
  assert.match(chipSource, /const detailsMenuItem = document\.createElement\("button"\)/);
  assert.match(chipSource, /detailsMenuItem\.textContent = "詳細資料"/);
  assert.match(chipSource, /coordinateToTime\?\.\(event\.clientX - rect\.left\)/);
  assert.match(chipSource, /exportMenuItem\.textContent = "儲存圖片"/);
  assert.match(appSource, /panelExportAction\.textContent = "儲存圖片"/);
  assert.doesNotMatch(`${chipSource}\n${appSource}`, /儲存此商品所有線圖為圖片/);
  assert.match(appSource, /panelRemoveTechnicalAction\.textContent = "移除副圖"/);
  assert.match(appSource, /const fromTechnicalSubchart = Boolean\(event\.target\?\.closest\?\.\("\.indicator-wrap"\)\) && isTechnicalSubchartVisible\(\)/);
  assert.match(appSource, /function handleRemoveTechnicalSubchart\(\)[\s\S]*?input\.checked = false;[\s\S]*?applySubchartPresentation\(subchartPresentation\);[\s\S]*?applyPayload\(lastPayload\)/);
  assert.match(appSource, /if \(event\.target\?\.closest\?\.\("\.chip-pane-chart, \.chip-pane-context-menu"\)\) return/);
  assert.doesNotMatch(indexHtml, /technical[^\n]*詳細資料|RSI[^\n]*詳細資料|KD[^\n]*詳細資料|MACD[^\n]*詳細資料|ATR[^\n]*詳細資料/);
});

test("副圖 raw pointer 以 screen X 回映主圖 candle，不採漂移 pane 的 time", () => {
  assert.match(chipSource, /const localX = Number\(param\?\.point\?\.x\)/);
  assert.match(chipSource, /screenX: Number\.isFinite\(localX\) \? rect\.left \+ localX : undefined/);
  assert.match(appSource, /function sharedCandleTimeForScreenX\(screenX\)/);
  assert.match(appSource, /QuoteChartPayload\?\.plotCoordinateForScreenX/);
  assert.match(appSource, /function sharedCandleTimeForCrosshair\(param, sourceSurface = surface\)/);
  assert.match(appSource, /handleIndicatorCrosshairMove\(param\)[\s\S]*?sharedCandleTimeForCrosshair\(param, indicatorSurface\)/);
  assert.match(appSource, /onCrosshair: \(pointer\) => \{[\s\S]*?sharedCandleTimeForScreenX\(pointer\?\.screenX\)/);
});

test("跨 pane range 同步攜帶真實 time range 並保留 logical viewport", () => {
  assert.match(chipSource, /options\.onRange\?\.\(range, definition\.id, chart\?\.timeScale\(\)\.getVisibleRange\?\.\(\)\)/);
  assert.match(appSource, /function setSynchronizedVisibleTimeRange\(range, preferredLogicalRange, \{ commit = true \} = \{\}\)/);
  assert.match(appSource, /viewportCoordinator\?\.acceptCallback\?\.\("technical", range\)/);
  assert.match(appSource, /indicatorChart\.timeScale\(\)\.setVisibleRange\(range\)/);
  assert.match(appSource, /indicatorChart\.timeScale\(\)\.setVisibleLogicalRange\(fallbackLogicalRange\)/);
  assert.match(appSource, /chipPaneManager\?\.syncTimeRange\?\.\(range\)/);
  assert.match(appSource, /chipPaneManager\?\.syncRange\?\.\(fallbackLogicalRange\)/);
});

test("alignment debug 可區分技術 series 空資料與未建立並記錄各 pane range", () => {
  assert.match(appSource, /indicatorSeriesPointCounts: \{ \.\.\.indicatorSeriesPointCounts \}/);
  assert.match(appSource, /indicatorRecoveryCount,/);
  assert.match(appSource, /indicatorVisibleLogicalRange:/);
  assert.match(appSource, /indicatorVisibleTimeRange:/);
  assert.match(chipSource, /visibleLogicalRange: chart\?\.timeScale\(\)\.getVisibleLogicalRange\?\.\(\) \|\| null/);
  assert.match(chipSource, /visibleTimeRange: chart\?\.timeScale\(\)\.getVisibleRange\?\.\(\) \|\| null/);
  assert.match(appSource, /viewportInvariant,/);
  assert.match(appSource, /viewportState,/);
  assert.match(appSource, /ensureInitialViewportInvariant\(\)/);
  assert.match(appSource, /viewportCoordinator\?\.recordRepair\?\.\(canonicalRange\)/);
});

test("技術指標有資料但初次 time range 為空時只修復 viewport、不重建副圖", () => {
  assert.match(appSource, /const renderToken = \+\+indicatorRenderToken/);
  assert.match(appSource, /Object\.values\(indicatorSeriesPointCounts\)\.some/);
  assert.match(appSource, /!hasExpectedPoints \|\| isValidTimeRange\(indicatorChart\.timeScale\(\)\.getVisibleRange\?\.\(\)\)/);
  const recoveryBlock = appSource.slice(
    appSource.indexOf("        indicatorRecoveryCount += 1;"),
    appSource.indexOf("      }, 120);", appSource.indexOf("        indicatorRecoveryCount += 1;")),
  );
  assert.match(recoveryBlock, /indicatorChart\.resize\(indicatorSurface\.clientWidth, indicatorSurface\.clientHeight\)/);
  assert.match(recoveryBlock, /syncIndicatorVisibleRangeToMain\(\)/);
  assert.match(recoveryBlock, /refreshDayBoundaries\(lastPayload\?\.candles \|\| \[\]\)/);
  assert.doesNotMatch(recoveryBlock, /indicatorChart\.remove\(\)/);
  assert.doesNotMatch(recoveryBlock, /renderIndicatorChart\(/);
});

test("方式 B 提供單一資料群組拖曳把手與右鍵群組排序，方式 A 不增加常駐排序按鈕", () => {
  assert.match(chipSource, /className = "chip-pane-group-drag-handle"/);
  assert.match(chipSource, /header\.className = "chip-pane-group-header"/);
  assert.match(chipSource, /header\.addEventListener\("pointerdown", startDrag\)/);
  assert.match(chipSource, /function isPaneDragIgnoredTarget\(target/);
  assert.match(chipSource, /setAttribute\("aria-label", `拖曳調整\$\{definition\.label\}資料群組順序`\)/);
  assert.match(chipSource, /textContent = "上移資料群組"/);
  assert.match(chipSource, /textContent = "下移資料群組"/);
  assert.match(chipSource, /modeBGroupOrder/);
  assert.match(styles, /\.chip-pane-group-drag-handle\s*\{/);
  assert.match(styles, /\.chip-pane-group\.is-dragging\s*\{[^}]*display:\s*none/s);
  assert.doesNotMatch(indexHtml, /chip-pane-(?:move-up|move-down)/);
});

test("排序成功只保存一次且不重抓資料，取消與生命週期事件會回復原順序", () => {
  const moveBlock = chipSource.slice(chipSource.indexOf("    function movePane(id, direction)"), chipSource.indexOf("    function clearPaneDragListeners()"));
  const finishBlock = chipSource.slice(chipSource.indexOf("    function finishPaneDrag(commit = true)"), chipSource.indexOf("    function notifyPresentation()"));
  assert.match(moveBlock, /saveVisibleGroupOrder\(next\)/);
  assert.doesNotMatch(moveBlock, /\bload\s*\(/);
  assert.match(finishBlock, /if \(commit && previewOrder\.join\("\|"\) !== originalOrder\.join\("\|"\)\)/);
  assert.match(finishBlock, /saveVisibleGroupOrder\(previewOrder\)/);
  assert.match(finishBlock, /requestAnimationFrame/);
  assert.doesNotMatch(chipSource.slice(chipSource.indexOf("    function updatePaneDrag(event)"), chipSource.indexOf("    function startPaneDrag(id, event)")), /applyControllerOrder|onLayoutChange/);
  assert.match(finishBlock, /function cancelPaneDrag\(\) \{\s*finishPaneDrag\(false\)/);
  for (const lifecycle of ["pointercancel", "blur", "visibilitychange", "resize"]) assert.match(finishBlock, new RegExp(lifecycle));
  assert.match(chipSource, /const PANE_DRAG_EDGE_PX = \d+/);
  assert.match(chipSource, /const PANE_DRAG_MAX_SCROLL_PX = \d+/);
  assert.match(chipSource, /function paneDragScrollVelocity\(clientY, viewportHeight/);
  assert.match(chipSource, /global\.scrollBy\(0, scrollVelocity\)/);
  assert.match(chipSource, /function measurePaneDragRects\(\)/);
  assert.match(chipSource, /paneDrag\.rects = measurePaneDragRects\(\)/);
  assert.match(finishBlock, /global\.cancelAnimationFrame\(drag\.frame\)/);
  assert.equal(paneDragScrollVelocity(36, 800) < 0, true);
  assert.equal(paneDragScrollVelocity(400, 800), 0);
  assert.equal(paneDragScrollVelocity(780, 800) > 0, true);
  assert.match(chipSource, /if \(identityChanged\) \{\s*cancelPaneDrag\(\)/);
  assert.match(chipSource, /selection\.modeBSelectedPaneIds = selection\.modeBSelectedPaneIds\.filter/);
});

test("副圖重排在 DOM 變更前保存 viewport，完成 resize 後以時間錨點還原", () => {
  for (const functionName of ["pinPaneToTop", "pinPaneToBottom", "movePane"]) {
    const blockStart = chipSource.indexOf(`    function ${functionName}`);
    const blockEnd = chipSource.indexOf("\n    function ", blockStart + 1);
    const block = chipSource.slice(blockStart, blockEnd === -1 ? undefined : blockEnd);
    assert.ok(blockStart >= 0, `${functionName} 應存在`);
    assert.ok(block.indexOf('onLayoutChange?.({ preserveViewport: true') < block.indexOf("applyControllerOrder(next)"));
  }
  const finishBlock = chipSource.slice(chipSource.indexOf("    function finishPaneDrag(commit = true)"), chipSource.indexOf("    function cancelPaneDrag()"));
  assert.ok(finishBlock.indexOf('onLayoutChange?.({ preserveViewport: true') < finishBlock.indexOf("applyControllerOrder(previewOrder)"));
  const refreshBlock = appSource.slice(appSource.indexOf("  function refreshPanelLayout()"), appSource.indexOf("  function currentPriceScaleMinWidth()"));
  assert.match(refreshBlock, /chart\.resize\(surface\.clientWidth, surface\.clientHeight\)/);
  assert.match(refreshBlock, /if \(viewportSnapshot\) \{[\s\S]*restoreViewportSnapshot\(viewportSnapshot, lastPayload\?\.candles \|\| \[\]\)/);
  assert.match(refreshBlock, /scheduleOverlayRender\(\);[\s\S]*positionSharedCrosshair\(sharedHoverTime\)/);
  assert.match(appSource, /if \(preserveViewport && !pendingPanelViewportSnapshot\) \{[\s\S]*captureViewportSnapshot\(lastPayload\?\.candles \|\| \[\]\)/);
});

test("籌碼 warning 依資料集拆成純文字片段並使用不同識別色", () => {
  const warnings = warningMessages([
    "外資及陸資持股：尚未更新",
    "融資融券：尚未更新",
    "借券成交：沒有成交",
    "部分資料：其他資料仍正常顯示",
  ]);
  assert.equal(warnings.length, 4);
  const colors = warnings.slice(0, 3).map(warningColorForText);
  assert.equal(new Set(colors).size, 3);
  assert.notEqual(colors[0], "#fbbf24");
  assert.equal(warningColorForText(warnings[3]), "#cbd5e1");
  assert.match(chipSource, /options\.emptyStatus\.replaceChildren\(\)/);
  assert.match(chipSource, /item\.textContent = message/);
  assert.match(styles, /\.chip-pane-warning-item\s*\{[^}]*color:\s*var\(--chip-warning-color/);
});

test("信用交易 readout 的最新日期只取實際資料列，游標無資料時保留缺值狀態", () => {
  const latestBlock = chipSource.slice(chipSource.indexOf("    function latestReadoutDate()"), chipSource.indexOf("    function readoutForDate", chipSource.indexOf("    function latestReadoutDate()")));
  assert.match(latestBlock, /dailyRowsByDate\.keys\(\)/);
  const resolveBlock = chipSource.slice(chipSource.indexOf("    function resolveReadout(sessionDate)"), chipSource.indexOf("    function renderReadoutInto", chipSource.indexOf("    function resolveReadout(sessionDate)")));
  assert.match(resolveBlock, /const row = dailyRowsByDate\.get\(sessionDate\);/);
  assert.match(resolveBlock, /if \(!row\) return missingReadout\(sessionDate\)/);
});
