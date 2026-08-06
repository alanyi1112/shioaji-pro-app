import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/static/panel-reordering.js", import.meta.url), "utf8");
const window = {};
vm.runInNewContext(source, { window }, { filename: "panel-reordering.js" });
const helpers = window.QuoteChartPanelReordering;

function rect(left, top, width = 100, height = 80) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

test("只有 2／3／4／6／8 圖且至少兩個 panel 啟用排序", () => {
  for (const count of [2, 3, 4, 6, 8]) assert.equal(helpers.enabledForCount(count, count), true);
  assert.equal(helpers.enabledForCount(1, 1), false);
  assert.equal(helpers.enabledForCount(6, 1), false);
});

test("第二頁 visible identity 重排只替換同一 page slice", () => {
  const full = ["A", "B", "C", "D", "E", "F", "G", "H"];
  assert.deepEqual(Array.from(helpers.replacePageSlice(full, 1, 3, ["F", "D", "E"])), ["A", "B", "C", "F", "D", "E", "G", "H"]);
  assert.deepEqual(full, ["A", "B", "C", "D", "E", "F", "G", "H"]);
});

test("visible identity 重複、遺漏或跨頁時拒絕合併", () => {
  const full = ["A", "B", "C", "D", "E", "F"];
  assert.equal(helpers.replacePageSlice(full, 1, 3, ["D", "D", "F"]), null);
  assert.equal(helpers.replacePageSlice(full, 1, 3, ["D", "E"]), null);
  assert.equal(helpers.replacePageSlice(full, 1, 3, ["A", "E", "F"]), null);
});

test("pointer target 依實際 rectangle 命中或選擇最近 slot", () => {
  const rects = [rect(0, 0), rect(110, 0), rect(0, 90), rect(110, 90)];
  assert.equal(helpers.targetIndexFromPoint(rects, 160, 40), 1);
  assert.equal(helpers.targetIndexFromPoint(rects, 40, 135), 2);
  assert.equal(helpers.targetIndexFromPoint(rects, 220, 180), 3);
});

test("鍵盤 target 依 responsive grid 幾何選擇相鄰位置", () => {
  const grid = [rect(0, 0), rect(110, 0), rect(0, 90), rect(110, 90)];
  assert.equal(helpers.keyboardTargetIndex(grid, 0, "right"), 1);
  assert.equal(helpers.keyboardTargetIndex(grid, 0, "down"), 2);
  assert.equal(helpers.keyboardTargetIndex(grid, 3, "up"), 1);
  assert.equal(helpers.keyboardTargetIndex(grid, 3, "right"), -1);
  const column = [rect(0, 0, 220), rect(0, 90, 220), rect(0, 180, 220)];
  assert.equal(helpers.keyboardTargetIndex(column, 1, "down"), 2);
  assert.equal(helpers.keyboardTargetIndex(column, 1, "left"), -1);
});

test("moveItem 保持 identity 完整且不修改原陣列", () => {
  const order = ["A", "B", "C", "D"];
  assert.deepEqual(Array.from(helpers.moveItem(order, 0, 3)), ["B", "C", "D", "A"]);
  assert.deepEqual(order, ["A", "B", "C", "D"]);
});
