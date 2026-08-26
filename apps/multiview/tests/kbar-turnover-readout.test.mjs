import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [indexHtml, appSource, stylesSource, payloadSource, exporterSource] = await Promise.all([
  readFile(new URL("../public/static/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/static/app.js", import.meta.url), "utf8"),
  readFile(new URL("../public/static/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../public/static/chart-payload.js", import.meta.url), "utf8"),
  readFile(new URL("../public/static/panel-image-export.js", import.meta.url), "utf8"),
]);

test("OHLC readout 在成交量後顯示不可拆分的值欄位與完整可存取名稱", () => {
  const volumeIndex = indexHtml.indexOf('data-main-readout="ohlcVolume"');
  const turnoverIndex = indexHtml.indexOf('data-main-readout="turnover"');
  const changeIndex = indexHtml.indexOf('data-main-readout="change"');
  assert.ok(volumeIndex >= 0 && turnoverIndex > volumeIndex && changeIndex > turnoverIndex);
  assert.match(indexHtml, /data-main-readout="turnover" title="成交值 —" aria-label="成交值 —">值 <b data-ohlc="turnover">—<\/b>/);
  assert.match(stylesSource, /\.readout-row\s*\{[^}]*flex-wrap: wrap/s);
  assert.match(stylesSource, /\.readout-row > span\s*\{[^}]*flex: 0 0 auto;[^}]*white-space: nowrap;/s);
  assert.match(stylesSource, /\.readout-row > span\[data-main-readout="turnover"\]\s*\{[^}]*pointer-events: auto;/s);
  assert.match(stylesSource, /\.chart-grid\.grid-4\.is-mode-b-page-scroll \.indicator-readout span,[\s\S]*?\.chart-grid\.grid-8 \.indicator-readout span/);
});

test("fixed、floating、crosshair、latest fallback與forming共用canonical candle成交值", () => {
  assert.match(appSource, /toggleReadoutGroup\(mainReadout, \["open", "high", "low", "close", "ohlcVolume", "turnover", "change"\], true\)/);
  assert.match(appSource, /setReadoutValue\(mainReadout, "ohlcVolume", candle\?\.volume, volumeFormatter\);\s*setTurnoverReadout\(mainReadout, candle\);/);
  assert.match(appSource, /function setTurnoverReadout\(root, candle\)[\s\S]*?hasCurrentExactTurnover\?\.\(candle\)[\s\S]*?formatTurnoverWan\?\.\(turnoverTwd\)[\s\S]*?item\.title = display\.accessibleName;[\s\S]*?item\.setAttribute\("aria-label", display\.accessibleName\);/);
  assert.match(appSource, /function hideSharedCrosshair\(\)[\s\S]*?restoreLatestMainReadout\(\)/);
  assert.match(appSource, /function renderIntraday\(snapshot\)[\s\S]*?setTurnoverReadout\(mainReadout, null\)/);
  assert.match(appSource, /function clearPanelValues\(\)[\s\S]*?setTurnoverReadout\(mainReadout, null\)/);
  assert.doesNotMatch(appSource, /turnoverTwd\s*=\s*[^;]*(?:open|high|low|close|volume|weightedAmount)/);
});

test("成交值沿用per-panel latest-wins與payload signature，不建立額外hot-path重繪", () => {
  assert.match(payloadSource, /function renderSignature\(payload\)[\s\S]*?candles: payload\.candles \|\| \[\]/);
  assert.match(appSource, /const nextPayloadRenderSignature = window\.QuoteChartPayload\.renderSignature\(payload\);[\s\S]*?crosshairPayloadRevision \+= 1/);
  assert.match(appSource, /function syncCrosshairForTime\(time\)[\s\S]*?pendingSharedHoverTime = time;[\s\S]*?if \(crosshairRenderFrame\) return;[\s\S]*?panelLifecycle\.requestFrame/);
  assert.match(appSource, /function renderSyncedCrosshair\(time\)[\s\S]*?updateReadoutsForTime\(time\)/);
  const turnoverSetter = appSource.slice(appSource.indexOf("function setTurnoverReadout"), appSource.indexOf("function setReadoutDate"));
  assert.doesNotMatch(turnoverSetter, /createChart|addSeries|setData|renderMainOverlays|chipPaneManager|updateTechnicalReadout/);
});

test("1／2／4／8 panel在窄版或字級放大時只於欄位邊界換行", () => {
  assert.match(appSource, /const CHART_COUNTS = \[1, 2, 3, 4, 6, 8\]/);
  for (const count of [1, 2, 4, 8]) {
    assert.match(appSource, new RegExp(`${count}: "grid-${count}"`));
    assert.match(stylesSource, new RegExp(`\\.chart-grid\\.grid-${count} \\{`));
  }
  const rowRule = stylesSource.match(/\.readout-row\s*\{([^}]*)\}/s)?.[1] || "";
  const itemRule = stylesSource.match(/\.readout-row > span\s*\{([^}]*)\}/s)?.[1] || "";
  assert.match(rowRule, /flex-wrap: wrap/);
  assert.doesNotMatch(rowRule, /height:|overflow: hidden/);
  assert.match(itemRule, /flex: 0 0 auto/);
  assert.match(itemRule, /white-space: nowrap/);
  assert.match(stylesSource, /\.indicator-readout\s*\{[^}]*max-width: calc\(100% - var\(--axis-safe-width\) - 16px\)/s);
});

test("完整panel匯出保留值欄位且成交值能力不外溢到axis、series、設定或交易", () => {
  assert.doesNotMatch(indexHtml.slice(indexHtml.indexOf('data-main-readout="turnover"'), changeIndexAfterTurnover(indexHtml)), /data-export-exclude/);
  assert.match(exporterSource, /serializePanel\(panel, dimensions\)/);
  assert.match(exporterSource, /for \(const child of source\.childNodes\) target\.appendChild\(cloneNodeForExport\(child\)\)/);
  assert.match(indexHtml, /panel-image-export\.js\?v=20260826-turnover-readout-v1/);
  assert.match(appSource, /const panelImageExporter = window\.QuoteChartPanelImageExporter;[\s\S]*?typeof panelImageExporter\?\.exportPanelImage !== "function"[\s\S]*?throw new Error\("圖片匯出元件尚未載入"\)/);

  const turnoverFiles = `${indexHtml}\n${appSource}`;
  assert.doesNotMatch(turnoverFiles, /turnover(?:PriceScale|Series|Axis)|成交值(?:軸|指標|設定)|data-(?:main-)?indicator="turnover"/i);
  assert.doesNotMatch(turnoverFiles, /turnover[^\n]{0,80}(?:broker|order|trade|position|D1)|(?:broker|order|trade|position|D1)[^\n]{0,80}turnover/i);
});

test("指定日期舊結果在商品／日期／interval／generation漂移時整份丟棄，返回一般週期重新載入provider", () => {
  const drilldownBlock = appSource.slice(appSource.indexOf("async function loadDailyCandleTargetDate"), appSource.indexOf("function handlePanelDoubleClick"));
  assert.match(drilldownBlock, /const generation = \+\+dailyDrilldownGeneration/);
  assert.match(drilldownBlock, /baselineLoadToken !== loadToken/);
  assert.match(drilldownBlock, /baselineSymbol !== symbolSelect\.value/);
  assert.match(drilldownBlock, /baselineInterval !== intervalSelect\.value/);
  assert.match(drilldownBlock, /preparedPayload\.targetDateSnapshot\?\.targetDate !== target\.targetDate/);
  assert.match(drilldownBlock, /preparedPayload\.targetDateSnapshot\?\.requestIdentity !== validation\.snapshot\.requestIdentity/);
  assert.match(appSource, /symbolSelect\.addEventListener\("change", \(\) => \{[\s\S]*?load\(\);/);
  assert.match(appSource, /intervalSelect\.addEventListener\("change", \(\) => \{[\s\S]*?load\(\);/);
  assert.match(appSource, /async function load\(options = \{\}\)[\s\S]*?const currentLoadToken = \+\+loadToken[\s\S]*?\/api\/candles\?symbol=/);
  assert.doesNotMatch(drilldownBlock, /D1|Cloudflare|weightedAmount|close\s*\*\s*volume/);
});

function changeIndexAfterTurnover(source) {
  const changeIndex = source.indexOf('data-main-readout="change"');
  return changeIndex >= 0 ? changeIndex : source.length;
}
