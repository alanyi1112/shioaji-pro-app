import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/static/chart-annotations.js", import.meta.url), "utf8");
const indexHtml = await readFile(new URL("../public/static/index.html", import.meta.url), "utf8");
const appScript = await readFile(new URL("../public/static/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/static/styles.css", import.meta.url), "utf8");
const exporter = await readFile(new URL("../public/static/panel-image-export.js", import.meta.url), "utf8");
const peRiverOverlay = await readFile(new URL("../public/static/pe-river-overlay.js", import.meta.url), "utf8");

function runtime() {
  const values = new Map();
  const window = { localStorage: {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] || null,
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  } };
  vm.runInNewContext(source, { window, Number, String, Array, Object, JSON, Math, Error });
  return { api: window.QuoteChartAnnotations, values };
}

test("費波那契回撤與拓展每條水準同時算出百分比及對應價格", () => {
  const { api } = runtime();
  const retracement = api.fibonacciLevels("retracement", [{ time: 1, price: 100 }, { time: 2, price: 200 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(retracement.map(({ ratioText, percentage, price }) => ({ ratioText, percentage, price: Number(price.toFixed(4)) })))), [
    { ratioText: "-0.62", percentage: "-62%", price: 262 },
    { ratioText: "-0.27", percentage: "-27%", price: 227 },
    { ratioText: "0", percentage: "0%", price: 200 },
    { ratioText: "0.236", percentage: "23.6%", price: 176.4 },
    { ratioText: "0.382", percentage: "38.2%", price: 161.8 },
    { ratioText: "0.5", percentage: "50%", price: 150 },
    { ratioText: "0.618", percentage: "61.8%", price: 138.2 },
    { ratioText: "0.705", percentage: "70.5%", price: 129.5 },
    { ratioText: "0.786", percentage: "78.6%", price: 121.4 },
    { ratioText: "1", percentage: "100%", price: 100 },
  ]);
  const extension = api.fibonacciLevels("extension", [{ time: 1, price: 100 }, { time: 2, price: 200 }, { time: 3, price: 150 }]);
  assert.equal(extension.length, 8);
  assert.deepEqual(JSON.parse(JSON.stringify(extension.map(({ ratio, ratioText, price }) => ({ ratio, ratioText, price: Number(price.toFixed(4)) })) )), [
    { ratio: 0.618, ratioText: "0.618", price: 211.8 },
    { ratio: 0.705, ratioText: "0.705", price: 220.5 },
    { ratio: 0.786, ratioText: "0.786", price: 228.6 },
    { ratio: 1, ratioText: "1", price: 250 },
    { ratio: 1.272, ratioText: "1.272", price: 277.2 },
    { ratio: 1.414, ratioText: "1.414", price: 291.4 },
    { ratio: 1.618, ratioText: "1.618", price: 311.8 },
    { ratio: 2, ratioText: "2", price: 350 },
  ]);
});

test("費波那契價格導引只從 pending preview 依序產生待選 A B C", () => {
  const { api } = runtime();
  assert.equal(api.fibonacciAnchorPriceGuide(), null);
  assert.equal(api.fibonacciAnchorPriceGuide({ type: "priceRange", anchors: [], preview: { time: 1, price: 100 } }), null);
  assert.equal(api.fibonacciAnchorPriceGuide({ type: "fibonacci", anchors: [], preview: { time: 1, price: Infinity } }), null);
  assert.deepEqual(JSON.parse(JSON.stringify(api.fibonacciAnchorPriceGuide({
    type: "fibonacci",
    anchors: [],
    preview: { time: "1", price: "123.456" },
  }))), { anchorLabel: "A", point: { time: 1, price: 123.456 } });
  assert.equal(api.fibonacciAnchorPriceGuide({
    type: "fibonacci",
    anchors: [{ time: 1, price: 100 }],
    preview: { time: 2, price: 120 },
  }).anchorLabel, "B");
  assert.equal(api.fibonacciAnchorPriceGuide({
    type: "fibonacci",
    anchors: [{ time: 1, price: 100 }, { time: 2, price: 120 }],
    preview: { time: 3, price: 110 },
  }).anchorLabel, "C");
  assert.equal(api.fibonacciAnchorPriceGuide({
    type: "fibonacci",
    anchors: [{ time: 1, price: 100 }, { time: 2, price: 120 }, { time: 3, price: 110 }],
    preview: { time: 4, price: 130 },
  }), null);
});

test("費波那契回撤 Option Alt 改為 high low，拓展仍可自由選價", () => {
  const { api } = runtime();
  const candle = { time: 10, low: 95, high: 125 };
  const raw = { time: 10, price: 111.25 };
  const pending = (kind, anchors) => ({ type: "fibonacci", kind, anchors });
  assert.deepEqual(JSON.parse(JSON.stringify(api.resolveFibonacciAnchorPoint(pending("retracement", []), raw, candle))), { time: 10, price: 95 });
  assert.deepEqual(JSON.parse(JSON.stringify(api.resolveFibonacciAnchorPoint(pending("retracement", [{ time: 8, price: 90 }]), raw, candle))), { time: 10, price: 125 });
  assert.equal(api.resolveFibonacciAnchorPoint(pending("retracement", []), { time: 12, price: 110 }, undefined), null);
  assert.equal(api.resolveFibonacciAnchorPoint(pending("retracement", [{ time: 8, price: 90 }]), { time: 12, price: 110 }, undefined), null);
  assert.deepEqual(JSON.parse(JSON.stringify(api.resolveFibonacciAnchorPoint(pending("extension", [{ time: 8, price: 90 }, { time: 9, price: 120 }]), raw, candle))), { time: 10, price: 95 });
  assert.deepEqual(JSON.parse(JSON.stringify(api.resolveFibonacciAnchorPoint(pending("extension", [{ time: 8, price: 90 }, { time: 9, price: 120 }]), { time: 12, price: 108.5 }, undefined))), { time: 12, price: 108.5 });
  assert.deepEqual(JSON.parse(JSON.stringify(api.resolveFibonacciAnchorPoint(pending("retracement", []), raw, candle, true))), { time: 10, price: 125 });
  assert.deepEqual(JSON.parse(JSON.stringify(api.resolveFibonacciAnchorPoint(pending("retracement", [{ time: 8, price: 130 }]), raw, candle, true))), { time: 10, price: 95 });
  assert.equal(api.resolveFibonacciAnchorPoint(pending("retracement", []), { time: 12, price: 108.5 }, undefined, true), null);
  assert.deepEqual(JSON.parse(JSON.stringify(api.resolveFibonacciAnchorPoint(pending("extension", [{ time: 8, price: 90 }, { time: 9, price: 120 }]), { time: 12, price: 108.5 }, undefined, true))), { time: 12, price: 108.5 });
});

test("價格範圍保留正負價差與以起點為分母的百分比", () => {
  const { api } = runtime();
  assert.deepEqual(JSON.parse(JSON.stringify(api.priceRange({ time: 1, price: 100 }, { time: 2, price: 112.5 }))), { difference: 12.5, percent: 12.5 });
  assert.deepEqual(JSON.parse(JSON.stringify(api.priceRange({ time: 1, price: 100 }, { time: 2, price: 80 }))), { difference: -20, percent: -20 });
  assert.equal(api.priceRange({ time: 1, price: 0 }, { time: 2, price: 80 }), null);
});

test("註記依商品與週期隔離並忽略損毀本機資料", () => {
  const { api, values } = runtime();
  let identity = "2330.TW|1d";
  const controller = api.createController({ getIdentity: () => identity });
  controller.armFibonacci("retracement");
  controller.addPoint({ time: 1, price: 100 });
  controller.addPoint({ time: 2, price: 200 });
  assert.equal(controller.getState().completed.fibonacci[0].levels.length, 10);
  identity = "2330.TW|1wk";
  controller.restore();
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getState().completed.fibonacci)), []);
  identity = "2330.TW|1d";
  controller.restore();
  assert.equal(controller.getState().completed.fibonacci[0].levels.at(-1).price, 100);
  values.set("quoteChart.annotations.v1.2330.TW|1d", "not-json");
  controller.restore();
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getState().completed.fibonacci)), []);
});

test("拓展三點選取會依序保留 A B 錨點進度並在第三點完成", () => {
  const { api } = runtime();
  const controller = api.createController({ getIdentity: () => "2330.TW|1d" });
  controller.armFibonacci("extension");
  controller.addPoint({ time: 1, price: 100 });
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getState().pending)), {
    type: "fibonacci",
    kind: "extension",
    anchors: [{ time: 1, price: 100 }],
    remaining: 2,
  });
  controller.addPoint({ time: 2, price: 200 });
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getState().pending)), {
    type: "fibonacci",
    kind: "extension",
    anchors: [{ time: 1, price: 100 }, { time: 2, price: 200 }],
    remaining: 1,
  });
  controller.addPoint({ time: 3, price: 150 });
  assert.equal(controller.getState().pending, null);
  assert.equal(controller.getState().completed.fibonacci[0].anchors.length, 3);
});

test("費波那契下一點會即時預覽但不保存，離開或取消後清除", () => {
  const { api, values } = runtime();
  const controller = api.createController({ getIdentity: () => "2330.TW|1d" });
  controller.armFibonacci("extension");
  controller.previewPoint({ time: 1, price: 100 });
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getState().pending.preview)), { time: 1, price: 100 });
  assert.equal(api.fibonacciAnchorPriceGuide(controller.getState().pending).anchorLabel, "A");
  assert.equal(values.size, 0);
  controller.addPoint({ time: 1, price: 100 });
  assert.equal(controller.getState().pending.preview, undefined);
  controller.previewPoint({ time: 2, price: 200 });
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getState().pending.preview)), { time: 2, price: 200 });
  assert.deepEqual(JSON.parse(JSON.stringify(api.fibonacciAnchorPriceGuide(controller.getState().pending))), {
    anchorLabel: "B",
    point: { time: 2, price: 200 },
  });
  controller.previewPoint();
  assert.equal(controller.getState().pending.preview, undefined);
  assert.equal(api.fibonacciAnchorPriceGuide(controller.getState().pending), null);
  assert.equal(values.size, 0);
  controller.cancel();
  assert.equal(controller.getState().pending, null);
  assert.equal(api.fibonacciAnchorPriceGuide(controller.getState().pending), null);
});

test("費波那契價格導引與點選保存共用相同 preview 數值且完成後清除", () => {
  const { api, values } = runtime();
  const controller = api.createController({ getIdentity: () => "2330.TW|1d" });
  controller.armFibonacci("retracement");
  controller.addPoint({ time: 1, price: 100 });
  controller.previewPoint({ time: 2, price: 123.456 });
  const guide = api.fibonacciAnchorPriceGuide(controller.getState().pending);
  assert.equal(guide.point.price, 123.456);
  controller.addPoint(guide.point);
  assert.equal(controller.getState().completed.fibonacci[0].anchors[1].price, 123.456);
  assert.equal(controller.getState().pending, null);
  assert.equal(api.fibonacciAnchorPriceGuide(controller.getState().pending), null);
  const saved = JSON.parse(values.get("quoteChart.annotations.v1.2330.TW|1d"));
  assert.equal(saved.completed.fibonacci[0].anchors[1].price, 123.456);
});

test("回撤與拓展各保留一張並以完成 order 決定先後", () => {
  const { api, values } = runtime();
  const controller = api.createController({ getIdentity: () => "2330.TW|1d" });
  controller.armFibonacci("retracement");
  controller.addPoint({ time: 1, price: 100 });
  controller.addPoint({ time: 2, price: 200 });
  controller.armFibonacci("extension");
  controller.addPoint({ time: 3, price: 110 });
  controller.addPoint({ time: 4, price: 210 });
  controller.addPoint({ time: 5, price: 150 });
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getState().completed.fibonacci.map(({ kind, order }) => ({ kind, order })))), [
    { kind: "retracement", order: 1 },
    { kind: "extension", order: 2 },
  ]);
  controller.armFibonacci("retracement");
  controller.addPoint({ time: 6, price: 120 });
  controller.addPoint({ time: 7, price: 220 });
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getState().completed.fibonacci.map(({ kind, order }) => ({ kind, order })))), [
    { kind: "extension", order: 2 },
    { kind: "retracement", order: 3 },
  ]);
  const saved = JSON.parse(values.get("quoteChart.annotations.v1.2330.TW|1d"));
  assert.equal(saved.version, 3);
  assert.equal(saved.completed.fibonacci.length, 2);
});

test("version 2 單張費波那契會遷移為 version 3 第一張", () => {
  const { api, values } = runtime();
  values.set("quoteChart.annotations.v1.2330.TW|1d", JSON.stringify({
    version: 2,
    completed: {
      fibonacci: { kind: "extension", anchors: [{ time: 1, price: 100 }, { time: 2, price: 200 }, { time: 3, price: 150 }] },
      priceRange: null,
    },
  }));
  const controller = api.createController({ getIdentity: () => "2330.TW|1d" });
  controller.restore();
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getState().completed.fibonacci.map(({ kind, order }) => ({ kind, order })))), [{ kind: "extension", order: 1 }]);
  const migrated = JSON.parse(values.get("quoteChart.annotations.v1.2330.TW|1d"));
  assert.equal(migrated.version, 3);
  assert.equal(migrated.completed.fibonacci[0].kind, "extension");
});

test("新增費波那契比率有穩定 ratio key 與固定色", () => {
  const { api } = runtime();
  assert.equal(api.fibonacciLevelKey(-0.62), "negative-0-62");
  assert.equal(api.fibonacciLevelKey(0.705), "0-705");
  assert.equal(api.fibonacciLevelColor("retracement", -0.62), "#a78bfa");
  assert.equal(api.fibonacciLevelColor("retracement", -0.27), "#e879f9");
  assert.equal(api.fibonacciLevelColor("extension", -0.27), "#cbd5e1");
  assert.equal(api.fibonacciLevelColor("retracement", 0.705), "#f472b6");
  assert.equal(api.fibonacciLevelColor("extension", 0.705), "#f472b6");
  assert.equal(api.fibonacciLevelColor("retracement", 0.618), "#2dd4bf");
  assert.equal(api.fibonacciLevelColor("extension", 0.618), "#fb7185");
});

test("分種類清除只處理目前 interval，全部清除只處理目前商品所有 interval 並保留價格範圍", () => {
  const { api, values } = runtime();
  let identity = "2330.TW|1d";
  const current = api.createController({ getIdentity: () => identity });
  current.restore();
  current.armFibonacci("retracement");
  current.addPoint({ time: 1, price: 100 });
  current.addPoint({ time: 2, price: 200 });
  current.armFibonacci("extension");
  current.addPoint({ time: 1, price: 100 });
  current.addPoint({ time: 2, price: 200 });
  current.addPoint({ time: 3, price: 150 });
  current.armPriceRange();
  current.addPoint({ time: 1, price: 100 });
  current.addPoint({ time: 2, price: 120 });
  current.clear("retracement");
  assert.deepEqual(JSON.parse(JSON.stringify(current.getState().completed.fibonacci.map(({ kind }) => kind))), ["extension"]);
  assert.ok(current.getState().completed.priceRange);

  identity = "2330.TW|1wk";
  current.restore();
  current.armFibonacci("retracement");
  current.addPoint({ time: 1, price: 90 });
  current.addPoint({ time: 2, price: 180 });
  identity = "2317.TW|1d";
  current.restore();
  current.armFibonacci("retracement");
  current.addPoint({ time: 1, price: 80 });
  current.addPoint({ time: 2, price: 160 });

  identity = "2330.TW|1d";
  current.restore();
  current.clearAllFibonacciIntervals();
  assert.ok(JSON.parse(values.get("quoteChart.annotations.v1.2330.TW|1d")).completed.priceRange);
  assert.equal(values.has("quoteChart.annotations.v1.2330.TW|1wk"), false);
  assert.equal(values.has("quoteChart.annotations.v1.2317.TW|1d"), true);
});

test("同頁相同商品 panel 同步全部清除而其他商品不受影響", () => {
  const { api } = runtime();
  const current = api.createController({ getIdentity: () => "2330.TW|1d" });
  const sameProduct = api.createController({ getIdentity: () => "2330.TW|1wk" });
  const otherProduct = api.createController({ getIdentity: () => "2317.TW|1d" });
  [current, sameProduct, otherProduct].forEach((controller) => {
    controller.restore();
    controller.armFibonacci("retracement");
    controller.addPoint({ time: 1, price: 100 });
    controller.addPoint({ time: 2, price: 200 });
  });
  const unsubscribe = api.subscribeProductClear((symbol) => {
    sameProduct.applyProductClear(symbol);
    otherProduct.applyProductClear(symbol);
  });
  current.clearAllFibonacciIntervals();
  unsubscribe();
  assert.equal(sameProduct.getState().completed.fibonacci.length, 0);
  assert.equal(otherProduct.getState().completed.fibonacci.length, 1);
});

test("價格範圍以兩次左鍵完成，第一點後即時預覽且暫態不保存", () => {
  const { api, values } = runtime();
  const controller = api.createController({ getIdentity: () => "2330.TW|1d" });
  controller.armPriceRange();
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getState().pending)), {
    type: "priceRange",
    anchors: [],
    remaining: 2,
  });
  controller.addPoint({ time: 1, price: 100 });
  controller.previewPoint({ time: 2, price: 112.5 });
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getState().pending)), {
    type: "priceRange",
    anchors: [{ time: 1, price: 100 }],
    preview: { time: 2, price: 112.5 },
    remaining: 1,
  });
  assert.equal(values.size, 0);
  controller.addPoint({ time: 2, price: 112.5 });
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getState().completed.priceRange.result)), {
    difference: 12.5,
    percent: 12.5,
  });
  const saved = JSON.parse(values.get("quoteChart.annotations.v1.2330.TW|1d"));
  assert.equal(saved.version, 3);
  assert.equal(saved.completed.priceRange.end.price, 112.5);
});

test("舊版 distance 本機資料會遷移為 priceRange", () => {
  const { api, values } = runtime();
  values.set("quoteChart.annotations.v1.2330.TW|1d", JSON.stringify({
    version: 1,
    completed: {
      fibonacci: null,
      distance: { start: { time: 1, price: 100 }, end: { time: 2, price: 80 } },
    },
  }));
  const controller = api.createController({ getIdentity: () => "2330.TW|1d" });
  controller.restore();
  assert.equal(controller.getState().completed.priceRange.result.percent, -20);
  const migrated = JSON.parse(values.get("quoteChart.annotations.v1.2330.TW|1d"));
  assert.equal(migrated.version, 3);
  assert.equal(migrated.completed.distance, undefined);
  assert.equal(migrated.completed.priceRange.end.price, 80);
});

test("本益比河流圖維持 P50 1.4px、其他 1px 與 provisional 虛線透明度", () => {
  assert.match(peRiverOverlay, /"stroke-width": key === "p50" \? 1\.4 : 1/);
  assert.match(peRiverOverlay, /"stroke-dasharray": provisional \? "5 4" : "none"/);
  assert.match(peRiverOverlay, /opacity: provisional \? 0\.72 : 1/);
  assert.match(peRiverOverlay, /lineLabelText\(key, payload\.multipliers\[key\]\)/);
  assert.match(peRiverOverlay, /placeLineLabels\(labelEntries, height, labelHeight\)/);
  assert.match(peRiverOverlay, /class: `pe-river-level-leader pe-river-level-leader-\$\{key\}`/);
  assert.match(peRiverOverlay, /stroke: COLORS\[index\][\s\S]*"stroke-width": 1/);
  assert.match(peRiverOverlay, /fill: COLORS\[index\]/);
});

test("主圖工具、註記圖層與匯出路徑保持可見且不攔截圖表手勢", () => {
  assert.match(indexHtml, /data-chart-tool="retracement"[^>]*>費波那契回撤/);
  assert.match(indexHtml, /data-chart-tool="extension"[^>]*>費波那契拓展/);
  assert.match(indexHtml, /data-chart-tool="price-range"[^>]*>價格範圍/);
  assert.match(indexHtml, /value="retracement">清除回撤/);
  assert.match(indexHtml, /value="extension">清除拓展/);
  assert.match(indexHtml, /value="all-fibonacci">全部清除/);
  assert.match(indexHtml, /value="price-range">清除價格範圍/);
  assert.match(indexHtml, /class="chart-annotation-layer" aria-label="主圖繪圖與價格範圍"/);
  assert.match(indexHtml, /chart-annotations\.js/);
  assert.match(appScript, /chartAnnotationController\?\.armPriceRange\(\)/);
  assert.match(appScript, /chartAnnotationController\?\.clearAllFibonacciIntervals\?\.\(\)/);
  assert.match(appScript, /intervalSelect\.value === "intraday"/);
  assert.match(appScript, /chartAnnotationController\.addPoint\(point\)/);
  assert.match(appScript, /const point = chartPointForPanelEvent\(event\)[\s\S]*?chartAnnotationController\.addPoint\(point\)/);
  assert.match(appScript, /formatQuotePrice\(entry\.price/);
  assert.match(appScript, /\["A", "B", "C"\]\[index\]/);
  assert.match(appScript, /annotationState\.pending\?\.type === "priceRange"/);
  assert.match(appScript, /chartAnnotationController\.previewPoint\(chartPointForPanelEvent\(event\)\)/);
  assert.match(appScript, /const candle = candleAt\(coordinateTime\)/);
  assert.match(appScript, /resolveFibonacciAnchorPoint\?\.\(pending, rawPoint, candle, event\.altKey === true\)/);
  assert.match(appScript, /function handleWindowMouseLocation\(event\)[\s\S]*?chartHost !== surface[\s\S]*?chartAnnotationController\.previewPoint\(\)[\s\S]*?if \(sharedHoverTime === undefined\) return/);
  assert.match(appScript, /fibonacciAnchorPriceGuide\?\.\(pending\)/);
  assert.match(appScript, /const formattedPrice = formatQuotePrice\(guide\.point\.price, symbolSelect\.value, "derived-price"\)/);
  assert.match(appScript, /`待選 \$\{guide\.anchorLabel\}｜\$\{formattedPrice\}`/);
  assert.match(appScript, /lineY < 0 \|\| lineY > height/);
  assert.match(appScript, /x1: 0,[\s\S]*?x2: rightEdge,[\s\S]*?class: "chart-annotation-fibonacci-price-guide-line"/);
  assert.match(appScript, /class: "chart-annotation-fibonacci-price-guide"[\s\S]*?"data-export-exclude": ""/);
  assert.match(appScript, /chart-annotation-price-range-fill/);
  assert.match(appScript, /chart-annotation-price-range-arrowhead/);
  assert.match(appScript, /\$\{ticks\} 格/);
  assert.match(appScript, /const rangeIndexes = kind === "extension" \? \[1, 2\] : \[0, 1\]/);
  assert.match(appScript, /const lineEndX = rightEdge/);
  assert.match(appScript, /x2: lineEndX/);
  assert.match(appScript, /if \(isPreview\) \{[\s\S]*?chart-annotation-fibonacci-anchor-preview-cross[\s\S]*?\} else \{[\s\S]*?cx: point\.x,\s*cy: point\.y,\s*r: 4/s);
  assert.match(appScript, /group\.setAttribute\("data-export-exclude", ""\)/);
  assert.doesNotMatch(appScript, /r: 5\.5/);
  assert.doesNotMatch(appScript, /chart-annotation-fibonacci-anchor-label/);
  assert.match(appScript, /previewAnchors\.length === required/);
  assert.match(appScript, /chart-annotation-fibonacci-band--\$\{modifier\}/);
  assert.doesNotMatch(appScript, /bandBottom - bandTop < 0\.5/);
  assert.match(appScript, /fibonacciLevelColor\?\.\(kind, entry\.ratio\)/);
  assert.match(appScript, /data-fibonacci-ratio/);
  assert.match(appScript, /if \(!monochrome\) \{[\s\S]*?chart-annotation-fibonacci-band--\$\{modifier\}/);
  assert.match(appScript, /const hasLeftSpace = lineStartX >= estimatedLabelWidth \+ 12/);
  assert.match(appScript, /\$\{entry\.ratioText.*\} \(\$\{formatQuotePrice/);
  assert.match(appScript, /fibonacciAutoScaleLowerSeries\.setData\(lowerData\)/);
  assert.match(appScript, /fibonacciAutoScaleUpperSeries\.setData\(upperData\)/);
  assert.match(appScript, /chart\.priceScale\("right"\)\.applyOptions\(\{ autoScale: true \}\)/);
  const autoScaleStart = appScript.indexOf("function updateFibonacciAutoScale");
  const autoScaleEnd = appScript.indexOf("function isFibonacciSelectionActive", autoScaleStart);
  const autoScaleSource = appScript.slice(autoScaleStart, autoScaleEnd);
  assert.match(autoScaleSource, /Array\.isArray\(annotationState\?\.completed\?\.fibonacci\)/);
  assert.match(autoScaleSource, /filter\(\(entry\) => entry\.kind === "extension"/);
  assert.doesNotMatch(autoScaleSource, /annotationState\?\.pending|pending\.preview|pending\.anchors/);
  assert.match(appScript, /function updateFibonacciCrosshairMarkers[\s\S]*?defaultVisible = mainLineCrosshairMarkerDefaults\.get\(series\) !== false[\s\S]*?crosshairMarkerVisible: shouldHide \? false : defaultVisible/);
  assert.match(appScript, /onChange: scheduleAnnotationStateRender/);
  assert.match(appScript, /function scheduleAnnotationStateRender[\s\S]*?panelLifecycle\.requestFrame[\s\S]*?updateFibonacciCrosshairMarkers\(nextState\)[\s\S]*?updateFibonacciAutoScale\(nextState\)[\s\S]*?renderChartAnnotations\(\)/);
  assert.match(appScript, /function addLine[\s\S]*?defaultCrosshairMarkerVisible = options\.crosshairMarkerVisible !== false[\s\S]*?crosshairMarkerVisible: isFibonacciSelectionActive\(\) \? false : defaultCrosshairMarkerVisible/);
  assert.match(appScript, /chart-annotation-fibonacci-anchor--\$\{point\.label\.toLowerCase\(\)\}/);
  assert.match(styles, /\.chart-annotation-layer\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(styles, /\.chart-annotation-fibonacci-line\s*\{[^}]*stroke-width:\s*1\s*;/s);
  assert.match(styles, /\.chart-annotation-fibonacci-band\s*\{[^}]*fill-opacity:\s*0\.12/s);
  assert.match(styles, /\.chart-annotation-fibonacci-ratio-negative-0-62\s*\{[^}]*#a78bfa/s);
  assert.match(styles, /\.chart-annotation-fibonacci-ratio-negative-0-27\s*\{[^}]*#e879f9/s);
  assert.match(styles, /\.chart-annotation-fibonacci-ratio-0-705\s*\{[^}]*#f472b6/s);
  assert.match(styles, /\.chart-panel\.is-intraday \.chart-tool-button\[data-chart-tool="retracement"\]/);
  assert.match(styles, /\.chart-annotation-fibonacci-guide\s*\{[^}]*stroke-width:\s*1\s*;[^}]*stroke-dasharray:\s*8 7/s);
  assert.match(styles, /\.chart-annotation-fibonacci-guide\.is-pending\s*\{[^}]*stroke-dasharray:\s*5 5[^}]*opacity:\s*0\.72/s);
  assert.match(styles, /\.chart-annotation-fibonacci-line\.is-monochrome,[\s\S]*?--fibonacci-level-color:\s*#cbd5e1/s);
  assert.doesNotMatch(styles, /\.chart-annotation-fibonacci-band\.is-monochrome/);
  assert.match(styles, /\.chart-annotation-fibonacci-guide\.is-monochrome\s*\{[^}]*stroke:\s*#cbd5e1/s);
  assert.match(appScript, /fibonacci\.forEach\(\(drawing, index\) => \{[\s\S]*?const monochrome = fibonacci\.length > 1 && index > 0/);
  assert.match(appScript, /const monochrome = fibonacci\.some\(\(drawing\) => drawing\.kind !== pendingFibonacci\.kind\)/);
  assert.doesNotMatch(appScript, /chart-annotation-fibonacci-line-halo/);
  assert.doesNotMatch(styles, /\.chart-annotation-fibonacci-line--retracement\s*\{[^}]*stroke-dasharray/s);
  assert.doesNotMatch(styles, /\.chart-annotation-fibonacci-line--extension\s*\{[^}]*stroke-dasharray/s);
  assert.match(styles, /\.chart-annotation-fibonacci-anchor-circle\s*\{[^}]*fill:\s*none[^}]*stroke-width:\s*1\.25/s);
  assert.match(styles, /\.chart-annotation-fibonacci-anchor\.is-preview\s*\{[^}]*opacity:\s*1/s);
  assert.match(styles, /\.chart-annotation-fibonacci-anchor-preview-halo\s*\{[^}]*stroke-width:\s*1\s*;/s);
  assert.match(styles, /\.chart-annotation-fibonacci-anchor-preview-cross\s*\{[^}]*stroke:\s*#f8fafc[^}]*stroke-width:\s*1\s*;/s);
  assert.match(styles, /\.chart-annotation-fibonacci-anchor-preview-halo,[^}]*pointer-events:\s*none/s);
  assert.doesNotMatch(styles, /\.chart-annotation-fibonacci-anchor\.is-preview \.chart-annotation-fibonacci-anchor-circle/);
  assert.match(styles, /\.chart-annotation-fibonacci-price-guide\s*\{[^}]*color:\s*#38bdf8[^}]*pointer-events:\s*none/s);
  assert.match(styles, /\.chart-annotation-fibonacci-price-guide-line\s*\{[^}]*stroke:\s*currentColor[^}]*stroke-width:\s*1\.5/s);
  assert.match(styles, /\.chart-annotation-fibonacci-price-guide-halo\s*\{[^}]*stroke-width:\s*4/s);
  assert.match(styles, /\.chart-annotation-fibonacci-price-guide-label\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
  assert.doesNotMatch(styles, /\.chart-annotation-fibonacci-price-guide-line\s*\{[^}]*stroke-dasharray/s);
  assert.doesNotMatch(styles, /\.chart-annotation-fibonacci-anchor-label/);
  assert.match(styles, /\.chart-annotation-price-range-fill\s*\{[^}]*fill-opacity:\s*0\.14/s);
  assert.match(styles, /\.chart-annotation-price-range-arrowhead\s*\{[^}]*stroke:\s*currentColor/s);
  assert.match(styles, /\.chart-annotation-price-range\s*\{[^}]*color:\s*#ef4444/s);
  assert.match(styles, /\.chart-annotation-price-range--down\s*\{[^}]*color:\s*#22c55e/s);
  assert.match(styles, /\.chart-annotation-price-range-boundary\s*\{[^}]*stroke-width:\s*1/s);
  assert.match(styles, /\.chart-annotation-price-range-arrow,[^}]*stroke-width:\s*2/s);
  assert.match(styles, /\.chart-grid\.grid-4 \.panel-toolbar \.symbol-select/);
  assert.match(exporter, /source\.cloneNode\(false\)/);
  assert.doesNotMatch(exporter, /chart-annotation-layer/);
});
