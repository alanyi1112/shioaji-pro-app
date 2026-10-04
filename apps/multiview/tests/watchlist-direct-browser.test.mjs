import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright-core";

const chromePath = process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : process.env.CHROME_BIN || "/usr/bin/google-chrome";
const chromeAvailable = await access(chromePath).then(() => true, () => false);
const source = await readFile(new URL("../public/static/app.js", import.meta.url), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  const next = /\n(?:async )?function /.exec(source.slice(start + 1));
  return source.slice(start, next ? start + 1 + next.index : undefined);
}

test("獨立瀏覽器 DOM：頁籤落點、高亮、模式預覽與可取消的移除確認", { skip: !chromeAvailable }, async (t) => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent(`
    <style>.market-tab { width: 140px; height: 40px; margin: 10px; } .is-watchlist-drop-target { outline: 2px solid orange; }</style>
    <div id="market-tabs"><button class="market-tab" data-market-tab="system:taiwan-stocks">台股</button><button class="market-tab" data-market-tab="personal:watch-b">觀察乙</button></div>
    <div id="chart-grid"></div><div id="ghost"></div><div id="indicator"></div>`);
  await page.evaluate(({ targetFn, clearFn, previewFn, confirmFn }) => {
    const install = (name, body) => { globalThis[name] = new Function(`return (${body})`)(); };
    install("directWatchlistTargetFromPoint", targetFn);
    install("clearDirectWatchlistDropTarget", clearFn);
    install("updatePanelDragPreview", previewFn);
    install("confirmDirectWatchlistRemoval", confirmFn);
    globalThis.state = { activeMarketTabId: "system:taiwan-stocks" };
    globalThis.validMarketTab = (key) => ({ tabKey: key, label: key === "personal:watch-b" ? "觀察乙" : "台股" });
    globalThis.tabIdentity = (tab) => tab.tabKey;
    globalThis.tabDisplayLabel = (tab) => tab?.label;
    globalThis.PANEL_REORDER_HELPERS = { targetIndexFromPoint: () => -1 };
    globalThis.watchlistDragFixture = {
      activated: true, fromHandle: true, panel: { getCanonicalSymbol: () => "2330.TW" },
      ghost: document.getElementById("ghost"), indicator: document.getElementById("indicator"), rects: [],
    };
  }, {
    targetFn: functionSource("directWatchlistTargetFromPoint"),
    clearFn: functionSource("clearDirectWatchlistDropTarget"),
    previewFn: functionSource("updatePanelDragPreview"),
    confirmFn: functionSource("confirmDirectWatchlistRemoval"),
  });
  const rect = await page.locator('[data-market-tab="personal:watch-b"]').boundingBox();
  const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const preview = await page.evaluate(({ point }) => {
    updatePanelDragPreview(watchlistDragFixture, point.x, point.y, true);
    return {
      target: watchlistDragFixture.targetTabKey,
      text: watchlistDragFixture.ghost.textContent,
      highlighted: document.querySelector('[data-market-tab="personal:watch-b"]').classList.contains("is-watchlist-drop-target"),
    };
  }, { point });
  assert.equal(preview.target, "personal:watch-b");
  assert.match(preview.text, /複製 2330.TW → 觀察乙/);
  assert.equal(preview.highlighted, true);
  await page.evaluate(() => {
    clearDirectWatchlistDropTarget();
    globalThis.confirmResult = confirmDirectWatchlistRemoval("2330.TW", { label: "台股" });
  });
  await page.getByRole("dialog", { name: "確認從清單移除商品" }).getByText(/只變更這個頁籤/).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => confirmResult), false);
  await page.evaluate(() => { globalThis.confirmResult = confirmDirectWatchlistRemoval("2330.TW", { label: "台股" }); });
  await page.getByRole("button", { name: "從這個頁籤移除" }).click();
  assert.equal(await page.evaluate(() => confirmResult), true);
  assert.equal(await page.locator("dialog").count(), 0);
});
