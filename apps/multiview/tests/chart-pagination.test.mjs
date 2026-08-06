import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const appSource = await readFile(new URL("../public/static/app.js", import.meta.url), "utf8");
const CHART_COUNTS = [1, 2, 3, 4, 6, 8];

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `找不到 ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`無法解析 ${name}`);
}

const paginationSandbox = { CHART_COUNTS };
vm.runInNewContext([
  extractFunction(appSource, "categoryPageIndexForSymbol"),
  extractFunction(appSource, "categoryPaginationState"),
  "this.categoryPageIndexForSymbol = categoryPageIndexForSymbol;",
  "this.categoryPaginationState = categoryPaginationState;",
].join("\n"), paginationSandbox);

test("單圖商品轉入多圖時依 page size 換算分類頁", () => {
  const symbols = Array.from({ length: 19 }, (_, index) => `S${index}`);
  for (const pageSize of CHART_COUNTS) {
    assert.equal(paginationSandbox.categoryPageIndexForSymbol(symbols, "S0", pageSize), 0);
    assert.equal(paginationSandbox.categoryPageIndexForSymbol(symbols, "S1", pageSize), Math.floor(1 / pageSize));
    assert.equal(paginationSandbox.categoryPageIndexForSymbol(symbols, "S7", pageSize), Math.floor(7 / pageSize));
    assert.equal(paginationSandbox.categoryPageIndexForSymbol(symbols, "S18", pageSize), Math.floor(18 / pageSize));
  }
  assert.equal(paginationSandbox.categoryPageIndexForSymbol(symbols, "missing", 6), undefined);
});

test("所有圖表數量的分類頁切片都從 canonical index 開始", () => {
  const symbols = Array.from({ length: 19 }, (_, index) => `S${index}`);
  for (const pageSize of CHART_COUNTS) {
    const firstPage = paginationSandbox.categoryPaginationState(symbols, pageSize, 0);
    const secondPage = paginationSandbox.categoryPaginationState(symbols, pageSize, 1);
    assert.deepEqual(firstPage.visibleSymbols, symbols.slice(0, pageSize));
    assert.deepEqual(secondPage.visibleSymbols, symbols.slice(pageSize, pageSize * 2));
  }
});

test("離開單圖後清除 route state，panel 預設商品回到多圖切片", () => {
  assert.match(appSource, /if \(nextCount > 1\) leaveSingleChartViewForGrid\(nextCount\);/);
  assert.match(appSource, /state\.singleChartView = undefined;[\s\S]*state\.singleChartRequest = undefined;/);
  assert.match(appSource, /\["view", "symbol", "interval", "tab"\]\.forEach\(\(key\) => url\.searchParams\.delete\(key\)\)/);
  assert.match(appSource, /function defaultSymbolForPanel\(index\) \{[\s\S]*isSingleChartViewActive\(\)/);
  assert.match(appSource, /function defaultIntervalForPanel\(index\) \{[\s\S]*isSingleChartViewActive\(\)/);
  assert.match(appSource, /mode: isSingleChartViewActive\(\) \? "single" : "grid"/);
});
