import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/static/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/static/index.html", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/static/styles.css", import.meta.url), "utf8");

function functionSource(name) {
  const syncStart = source.indexOf(`function ${name}(`);
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : syncStart;
  assert.ok(start >= 0, `missing ${name}`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

test("單圖可由標題手把開始跨頁籤拖曳，圖面一般拖曳仍不觸發", () => {
  const listeners = [];
  const panel = { element: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) }, getCanonicalIdentity: () => "source:AAA" };
  const state = { panelDrag: undefined, panels: [panel] };
  const context = {
    state,
    panelReorderingEnabled: () => false,
    panelDragStartAllowed: () => true,
    panelRectangles: () => [{ left: 0, top: 0, width: 100, height: 100 }],
    handlePanelDragMove() {}, finishPanelDrag() {}, cancelPanelDrag() {}, exposeQuoteChartDebug() {},
    window: { addEventListener: (...args) => listeners.push(args) },
    document: { addEventListener: (...args) => listeners.push(args) },
  };
  vm.runInNewContext(functionSource("startPanelDragCandidate"), context);
  const event = (handle) => ({ button: 0, pointerId: 7, pointerType: "mouse", clientX: 5, clientY: 8,
    target: { closest: (selector) => handle && selector === ".panel-reorder-handle" },
    currentTarget: { setPointerCapture() {} }, });
  context.startPanelDragCandidate(event(false), panel);
  assert.equal(state.panelDrag, undefined);
  context.startPanelDragCandidate(event(true), panel);
  assert.equal(state.panelDrag.fromHandle, true);
  assert.ok(listeners.some(([type]) => type === "pointerup"));
});

test("跨頁籤放開時才判定 Option 複製；無效落點取消，不執行同頁籤排序", () => {
  const requests = [];
  const target = { id: "watch-b", tabKey: "personal:watch-b" };
  const state = { panelDrag: undefined, panelDragSuppressUntil: 0, panelReorderMetrics: { cancels: 0 } };
  const context = {
    state,
    PANEL_DRAG_CLICK_SUPPRESSION_MS: 250,
    panelDropIsValid: () => false,
    directWatchlistTargetFromPoint: () => target,
    cleanupPanelDrag: () => { state.panelDrag = undefined; },
    performDirectWatchlistMutation: (request) => { requests.push(request); },
    applyPanelReorder: () => { throw new Error("unexpected same-tab reorder"); },
    setPanelReorderStatus() {}, exposeQuoteChartDebug() {},
    Date,
  };
  vm.runInNewContext(functionSource("finishPanelDrag"), context);
  const panel = { getCanonicalSymbol: () => "2330.TW" };
  const drop = (altKey) => {
    state.panelDrag = { pointerId: 7, activated: true, fromHandle: true, sourceIndex: 0, targetIndex: 0, panel };
    context.finishPanelDrag({ pointerId: 7, clientX: 20, clientY: 20, altKey, preventDefault() {}, stopPropagation() {} });
  };
  drop(false);
  drop(true);
  assert.deepEqual(requests.map((item) => item.mode), ["move", "copy"]);
  context.directWatchlistTargetFromPoint = () => undefined;
  drop(true);
  assert.equal(requests.length, 2);
  assert.equal(state.panelReorderMetrics.cancels, 1);
});

test("顯示商品與 canonical 不符時拒絕快捷操作，沒有任何網路寫入", async () => {
  const calls = [];
  const tab = { tabKey: "system:taiwan-stocks", id: "taiwan-stocks", label: "台股" };
  const context = {
    state: { watchlistDirectMutationPending: false },
    activeMarketTab: () => tab,
    orderedInstrumentsForTab: () => [{ symbol: "2330.TW" }],
    setPanelReorderStatus: (message) => calls.push(message),
    fetch: () => { throw new Error("unexpected network request"); },
  };
  vm.runInNewContext(functionSource("performDirectWatchlistMutation"), context);
  await context.performDirectWatchlistMutation({ panel: { getCanonicalSymbol: () => "2330.TW", getDisplaySymbol: () => "2317.TW" }, mode: "remove" });
  assert.match(calls[0], /顯示商品與清單商品不一致/);
  assert.equal(context.state.watchlistDirectMutationPending, false);
});

test("右鍵與可見操作入口、確認文案及跨頁籤落點有明確 UI 契約", () => {
  assert.match(html, /class="panel-watchlist-menu-trigger"/);
  assert.match(source, /element\.addEventListener\("contextmenu", handlePanelContextMenu\)/);
  assert.match(source, /panelWatchlistMenuTrigger\.addEventListener\("click", handleWatchlistMenuTriggerClick\)/);
  assert.match(source, /confirmDirectWatchlistRemoval\(symbol, tab\)/);
  assert.match(source, /event\.altKey \? "copy" : "move"/);
  assert.match(styles, /\.market-tab\.is-watchlist-drop-target/);
  assert.match(styles, /\.watchlist-remove-confirm::backdrop/);
});
