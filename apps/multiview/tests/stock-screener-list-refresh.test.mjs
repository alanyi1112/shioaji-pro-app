import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../public/static/app.js", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return source.slice(start, end);
}

test("外部選股清單 refresh 使用 single-flight 唯讀 API", () => {
  const refresh = functionSource("refreshPersonalListsFromServer", "wireStockScreenerListRefresh");
  assert.match(refresh, /if \(personalListRefreshPromise\) return personalListRefreshPromise/);
  assert.match(refresh, /mode=read-only&purpose=stock-screener-list-sync-refresh/);
  assert.match(refresh, /applyInstrumentSetupPayload\(payload\)/);
  assert.match(refresh, /\.finally\(\(\) => \{ personalListRefreshPromise = undefined; \}\)/);
  assert.doesNotMatch(refresh, /renderPanels|selectMarketTab|activeMarketTabId\s*=|singleChartView\s*=|setInterval/);
});

test("focus 與恢復 visible 共用同一 refresh 且不輪詢", () => {
  const wire = functionSource("wireStockScreenerListRefresh", "getAuthHeaders");
  assert.match(wire, /document\.visibilityState === "hidden"/);
  assert.match(wire, /window\.addEventListener\("focus", refresh\)/);
  assert.match(wire, /document\.addEventListener\("visibilitychange", refresh\)/);
  assert.equal((wire.match(/refreshPersonalListsFromServer\(\)/g) || []).length, 1);
  assert.doesNotMatch(wire, /setInterval|setTimeout|renderPanels|activeMarketTabId\s*=/);
});

test("初始化完成後才接上外部清單 refresh", () => {
  const init = functionSource("init", "cloneIndicatorParameters");
  assert.ok(init.indexOf("await Promise.all([instrumentsPromise, appConfigPromise])") < init.indexOf("wireStockScreenerListRefresh()"));
  assert.ok(init.indexOf("renderPanels(Number(countSelect.value))") < init.indexOf("wireStockScreenerListRefresh()"));
});
