import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { SqliteD1 } from "./helpers/sqlite-d1.mjs";

const chromePath = process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : process.env.CHROME_BIN || "/usr/bin/google-chrome";
const chromeAvailable = await access(chromePath).then(() => true, () => false);
const publicRoot = new URL("../public/", import.meta.url).pathname;
const setup = await readFile(new URL("../public/data/stock_setup.md", import.meta.url), "utf8");
const html = await readFile(new URL("../public/static/index.html", import.meta.url), "utf8");

async function worker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("watchlist-app-browser", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

test("隔離完整應用：Option 複製、移動遞補、快捷移除與刷新一致", { skip: !chromeAvailable, timeout: 30000 }, async (t) => {
  const service = await worker();
  const db = new SqliteD1();
  t.after(() => db.close());
  const environment = { DB: db, ASSETS: { fetch: async (request) => new Response(new URL(request.url).pathname === "/data/stock_setup.md" ? setup : html) } };
  const execution = { waitUntil() {}, passThroughOnException() {} };
  await service.fetch(new Request("https://fixture.invalid/api/instruments", {
    headers: { "oai-authenticated-user-email": "fixture@example.com" },
  }), environment, execution);
  db.exec("INSERT INTO user_tabs (user_id,id,label,sort_order,enabled,is_default,source_tab_id) VALUES ('fixture@example.com','watch-one','測試清單',5,1,0,'')");
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1450, height: 900 } });
  page.setDefaultTimeout(5000);
  const writes = [];
  const externalRequests = [];
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== "fixture.invalid") {
      externalRequests.push(url.hostname);
      return route.abort();
    }
    if (url.pathname === "/api/config") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ deploymentTarget: "sites", sourceModes: ["yahoo"], defaultSourceMode: "yahoo", capabilities: { taiwanRealtime: false }, supabaseConfigured: false }) });
    if (url.pathname.startsWith("/api/instruments")) {
      if (request.method() !== "GET") writes.push({ path: url.pathname, method: request.method() });
      const response = await service.fetch(new Request(`https://fixture.invalid${url.pathname}${url.search}`, {
        method: request.method(),
        headers: { "content-type": "application/json", "oai-authenticated-user-email": "fixture@example.com" },
        body: request.method() === "GET" ? undefined : request.postData(),
      }), environment, execution);
      return route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
    }
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/local-shioaji/")) {
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "isolated_fixture_unavailable" }) });
    }
    const pathname = url.pathname === "/" ? "/static/index.html" : url.pathname;
    if (!/^\/(static|vendor|data)\//.test(pathname) || pathname.includes("..")) return route.fulfill({ status: 404, body: "" });
    try {
      const body = await readFile(join(publicRoot, pathname.slice(1)));
      const contentType = pathname.endsWith(".js") ? "text/javascript" : pathname.endsWith(".css") ? "text/css" : pathname.endsWith(".html") ? "text/html" : "application/octet-stream";
      return route.fulfill({ status: 200, contentType, body });
    } catch { return route.fulfill({ status: 404, body: "" }); }
  });
  await page.goto("http://fixture.invalid/static/index.html");
  await page.locator(".chart-panel").first().waitFor({ timeout: 5000 }).catch(() => {
    throw new Error(`chart_panel_missing errors=${JSON.stringify(browserErrors)}`);
  });
  await page.locator("#chart-count").selectOption("1");
  const symbol = await page.locator(".chart-panel .symbol-select").first().inputValue();
  const sourceTabKey = await page.locator(".market-tab.is-active").first().getAttribute("data-market-tab");
  await page.evaluate(() => { window.__sourcePanelBeforeCopy = document.querySelector(".chart-panel"); });
  const handle = page.locator(".chart-panel .panel-reorder-handle").first();
  await handle.waitFor({ state: "visible" });
  const target = page.locator('[data-market-tab="personal:watch-one"]');
  const sourceBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 });
  await page.keyboard.down("Alt");
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.getByText(new RegExp(`${symbol} 已複製到`)).waitFor();
  assert.ok(writes.some((entry) => entry.path === "/api/instruments/transfer"));
  assert.ok(await page.locator(".chart-panel").count());
  assert.equal(await page.evaluate(() => document.querySelector(".chart-panel") === window.__sourcePanelBeforeCopy), true, "複製不應重建來源線圖卡片");
  assert.equal(await page.locator(".chart-panel .symbol-select").first().inputValue(), symbol);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM user_instruments WHERE user_id='fixture@example.com' AND tab_id='watch-one' AND symbol=? AND enabled=1").get(symbol).count, 1);
  await page.reload();
  await target.click();
  await page.locator(".chart-panel").first().waitFor();
  assert.equal(await page.locator(".chart-panel .symbol-select").first().inputValue(), symbol);
  assert.equal(await page.locator(`.market-tab[data-market-tab="${sourceTabKey}"]`).count(), 1);
  await page.waitForTimeout(600);
  const buttonHit = await page.locator(".chart-panel .panel-watchlist-menu-trigger").first().evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === button;
  });
  assert.equal(buttonHit, true, "清單操作按鈕不得被報價內容蓋住");
  await page.locator(".chart-panel .panel-watchlist-menu-trigger").first().click();
  const menus = await page.locator(".panel-context-menu").evaluateAll((nodes) => nodes.map((node) => ({ hidden: node.hidden, text: node.innerText.slice(0, 120) })));
  assert.ok(menus.some((item) => !item.hidden), `menus=${JSON.stringify(menus)} errors=${JSON.stringify(browserErrors)}`);
  const menuState = await page.locator(".panel-context-menu:visible").last().evaluate((node) => ({ hidden: node.hidden, text: node.innerText }));
  assert.match(menuState.text, /移除/, `menu=${JSON.stringify(menuState)} errors=${JSON.stringify(browserErrors)}`);
  assert.match(menuState.text, new RegExp(`移除「${symbol.replaceAll(".", "\\.")}`), `menu=${JSON.stringify(menuState)} errors=${JSON.stringify(browserErrors)}`);
  const menu = page.locator(".panel-context-menu:visible").last();
  const menuBox = await menu.boundingBox();
  assert.equal(Math.round(menuBox.width), 240, "跨頁籤選單需容納操作名稱");
  assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= 1450, "選單不得超出視窗");
  await page.setViewportSize({ width: 220, height: 900 });
  await page.locator(".chart-panel .panel-watchlist-menu-trigger").first().click();
  if (!(await menu.isVisible())) await page.locator(".chart-panel .panel-watchlist-menu-trigger").first().click();
  const narrowBox = await menu.boundingBox();
  assert.ok(narrowBox.width <= 204 && narrowBox.x >= 0 && narrowBox.x + narrowBox.width <= 220, "窄視窗選單應縮小並保持可見");
  await page.setViewportSize({ width: 1450, height: 900 });
  await page.getByRole("menuitem", { name: new RegExp(`移除「${symbol}`) }).click();
  await page.getByRole("dialog", { name: "確認從清單移除商品" }).getByRole("button", { name: "從這個頁籤移除" }).click();
  await page.getByText("這個頁籤目前沒有商品。可從清單管理新增，或從其他頁籤拖入商品。").waitFor();
  assert.ok(writes.some((entry) => entry.path === "/api/instruments/remove-from-tab"));
  assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM user_instruments WHERE user_id='fixture@example.com' AND tab_id='watch-one' AND enabled=1").get().count, 0);
  await page.reload();
  await target.click();
  await page.getByText("這個頁籤目前沒有商品。可從清單管理新增，或從其他頁籤拖入商品。").waitFor();
  await page.locator(`.market-tab[data-market-tab="${sourceTabKey}"]`).click();
  await page.locator("#chart-count").selectOption("2");
  const beforeMove = await page.locator(".chart-panel .symbol-select").evaluateAll((nodes) => nodes.map((node) => node.value));
  assert.equal(beforeMove.length, 2);
  const moveHandleBox = await page.locator(".chart-panel .panel-reorder-handle").first().boundingBox();
  const moveTargetBox = await target.boundingBox();
  await page.mouse.move(moveHandleBox.x + moveHandleBox.width / 2, moveHandleBox.y + moveHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(moveTargetBox.x + moveTargetBox.width / 2, moveTargetBox.y + moveTargetBox.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction((nextSymbol) => document.querySelector(".chart-panel .symbol-select")?.value === nextSymbol, beforeMove[1]);
  assert.equal(await page.locator(".chart-panel .symbol-select").first().inputValue(), beforeMove[1], "來源卡片應由下一檔遞補");
  await target.click();
  assert.equal(await page.locator(".chart-panel .symbol-select").first().inputValue(), beforeMove[0], "移動商品應成為目的頁籤第一檔");
  await page.reload();
  await target.click();
  assert.equal(await page.locator(".chart-panel .symbol-select").first().inputValue(), beforeMove[0], "刷新後應保留移動結果");
  assert.equal(externalRequests.length, 0);
});
