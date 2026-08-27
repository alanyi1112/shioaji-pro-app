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
  extractFunction(appSource, "nextCategoryPrefetchSymbols"),
  extractFunction(appSource, "shouldPrefetchAdjacentChipPayload"),
  "this.categoryPageIndexForSymbol = categoryPageIndexForSymbol;",
  "this.categoryPaginationState = categoryPaginationState;",
  "this.nextCategoryPrefetchSymbols = nextCategoryPrefetchSymbols;",
  "this.shouldPrefetchAdjacentChipPayload = shouldPrefetchAdjacentChipPayload;",
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

test("下一頁預載數量依 1／2／3／4 圖與最後剩餘商品縮減", () => {
  const symbols = Array.from({ length: 11 }, (_, index) => `S${index}`);
  for (const chartCount of [1, 2, 3, 4]) {
    assert.deepEqual(
      [...paginationSandbox.nextCategoryPrefetchSymbols(symbols, chartCount, 0)],
      symbols.slice(chartCount, chartCount * 2),
    );
  }
  assert.deepEqual([...paginationSandbox.nextCategoryPrefetchSymbols(symbols, 4, 1)], symbols.slice(8, 11));
  assert.deepEqual([...paginationSandbox.nextCategoryPrefetchSymbols(symbols, 4, 2)], []);
});

test("籌碼預載只允許可見、多層、日 K、1 至 4 圖的台股", () => {
  const valid = { presentationMode: "multi", chartCount: 4, interval: "1d", symbol: "2330.TW", visibilityState: "visible", saveData: false, effectiveType: "4g" };
  assert.equal(paginationSandbox.shouldPrefetchAdjacentChipPayload(valid), true);
  assert.equal(paginationSandbox.shouldPrefetchAdjacentChipPayload({ ...valid, symbol: "8069.TWO" }), true);
  for (const invalid of [
    { presentationMode: "single" },
    { presentationMode: "main" },
    { chartCount: 6 },
    { chartCount: 8 },
    { interval: "1wk" },
    { symbol: "AAPL" },
    { visibilityState: "hidden" },
    { saveData: true },
    { effectiveType: "slow-2g" },
    { effectiveType: "2g" },
  ]) assert.equal(paginationSandbox.shouldPrefetchAdjacentChipPayload({ ...valid, ...invalid }), false);
  assert.equal(paginationSandbox.shouldPrefetchAdjacentChipPayload({ ...valid, effectiveType: "" }), true, "缺少 Network Information API 時維持 bounded fallback");
});

test("offscreen 籌碼預載只走共享 requestData，不建立圖表、SSE 或 backfill", () => {
  const body = extractFunction(appSource, "prefetchChipPayload");
  assert.match(body, /QuoteChartChipPanes\?\.requestData/);
  assert.match(body, /prefetch: true/);
  assert.doesNotMatch(body, /createChart|EventSource|subscribe|backfill|poll/i);
});

test("離開單圖後清除 route state，panel 預設商品回到多圖切片", () => {
  assert.match(appSource, /if \(nextCount > 1\) leaveSingleChartViewForGrid\(nextCount\);/);
  assert.match(appSource, /state\.singleChartView = undefined;[\s\S]*state\.singleChartRequest = undefined;/);
  assert.match(appSource, /\["view", "symbol", "interval", "tab"\]\.forEach\(\(key\) => url\.searchParams\.delete\(key\)\)/);
  assert.match(appSource, /function defaultSymbolForPanel\(index\) \{[\s\S]*isSingleChartViewActive\(\)/);
  assert.match(appSource, /function defaultIntervalForPanel\(index\) \{[\s\S]*isSingleChartViewActive\(\)/);
  assert.match(appSource, /mode: isSingleChartViewActive\(\) \? "single" : "grid"/);
});
