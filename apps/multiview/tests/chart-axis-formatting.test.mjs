import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [axisSource, indexHtml, chipSource, appSource] = await Promise.all([
  readFile(new URL("../public/static/chart-axis-formatting.js", import.meta.url), "utf8"),
  readFile(new URL("../public/static/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/static/chip-panes.js", import.meta.url), "utf8"),
  readFile(new URL("../public/static/app.js", import.meta.url), "utf8"),
]);

const window = {};
vm.runInNewContext(axisSource, { window, Intl, Number });
const {
  formatCompactLotsAxis,
  formatCompactPercentAxis,
  formatTechnicalAdaptiveAxis,
  formatTechnicalOscillatorAxis,
} = window.QuoteChartAxisFormatting;

test("籌碼張數軸以 K 縮寫千位並保留必要小數", () => {
  assert.equal(formatCompactLotsAxis(50_000), "50K張");
  assert.equal(formatCompactLotsAxis(1_500), "1.5K張");
  assert.equal(formatCompactLotsAxis(-50_000), "-50K張");
  assert.equal(formatCompactLotsAxis(500), "500張");
  assert.equal(formatCompactLotsAxis(12.5), "12.5張");
});

test("籌碼百分比軸移除尾端零並保留有效精度", () => {
  assert.equal(formatCompactPercentAxis(2), "2%");
  assert.equal(formatCompactPercentAxis(2.5), "2.5%");
  assert.equal(formatCompactPercentAxis(-0.25), "-0.25%");
  assert.equal(formatCompactPercentAxis(2, { signDisplay: "always" }), "+2%");
});

test("技術指標軸不補無意義小數零", () => {
  assert.equal(formatTechnicalOscillatorAxis(50), "50");
  assert.equal(formatTechnicalOscillatorAxis(50.25), "50.25");
  assert.equal(formatTechnicalOscillatorAxis(0.5), "0.5");
  assert.equal(formatTechnicalAdaptiveAxis(0.5), "0.5");
  assert.equal(formatTechnicalAdaptiveAxis(2), "2");
  assert.equal(formatTechnicalAdaptiveAxis(50), "50");
});

test("精簡 formatter 先於圖表程式載入且只接到數值軸", () => {
  const formatterIndex = indexHtml.indexOf("/static/chart-axis-formatting.js");
  assert.ok(formatterIndex >= 0);
  assert.ok(formatterIndex < indexHtml.indexOf("/static/chip-panes.js"));
  assert.ok(formatterIndex < indexHtml.indexOf("/static/app.js"));

  assert.match(chipSource, /formatter: formatCompactLotsAxis/);
  assert.match(chipSource, /formatter: formatCompactPercentAxis/);
  assert.match(appSource, /priceFormat: \{ type: "custom", formatter: formatTechnicalOscillatorAxis \}/);
  assert.match(appSource, /priceFormat: \{ type: "custom", formatter: formatTechnicalAdaptiveAxis \}/);
  assert.match(appSource, /setReadoutValue\(subReadout, "rsiShort",[\s\S]*?formatOscillatorValue\)/);
  assert.match(appSource, /setReadoutValue\(subReadout, "macd",[\s\S]*?formatAdaptiveIndicatorValue\)/);
});
