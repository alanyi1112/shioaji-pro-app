import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
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
// 選用的休市驗收：只讀既有行情快取，清單 mutation 仍只在獨立 SQLite 執行。
// 不呼叫行情下載器、不連 broker、不複製使用者清單或身分到測試環境。
const liveCachePath = process.env.MULTIVIEW_ACCEPTANCE_D1_PATH;
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function userListFingerprint(database) {
  return digest(["user_tabs", "user_instruments", "user_system_tab_instruments", "user_watchlist_mutation_revision"].map((table) =>
    database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
}
async function liveBoundarySnapshot() {
  const read = async (path) => {
    const response = await fetch(`http://127.0.0.1:8080${path}`, { signal: AbortSignal.timeout(5000) });
    assert.ok(response.ok, `唯讀安全檢查失敗：${path} ${response.status}`);
    return response.json();
  };
  const [stream, watchlist] = await Promise.all([
    read("/api/v1/stream/status"), read("/api/v1/watchlist"),
  ]);
  // 帳務與使用者清單僅在本機取 hash，報告不輸出其原始內容。
  return { streamStatus: stream.status, activeConnections: stream.active_connections,
    watchlistHash: digest(watchlist) };
}
const liveSetup = `| 頁籤 | 分組 | 預設排序 | 代號 | 名稱 | 資料源 | 啟用 |
|------|------|----------|------|------|--------|------|
| 台股 | 個股 | 1 | 2449.TW | 京元電 | yfinance | yes |
| 台股 | 個股 | 2 | 2330.TW | 台積電 | yfinance | yes |`;

async function worker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("watchlist-app-browser", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

for (const initialChartCount of [1, 2]) {
test(`隔離完整應用（${initialChartCount} 圖）：Option 複製、移動遞補、快捷移除與刷新一致`, { skip: !chromeAvailable, timeout: 30000 }, async (t) => {
  const service = await worker();
  const liveDb = liveCachePath ? new DatabaseSync(liveCachePath, { readOnly: true }) : null;
  if (liveDb) t.after(() => liveDb.close());
  const realListsBefore = liveDb ? userListFingerprint(liveDb) : null;
  const boundaryBefore = liveDb ? await liveBoundarySnapshot() : null;
  const livePayloads = new Map();
  if (liveDb) {
    for (const symbol of ["2449.TW", "2330.TW"]) {
      const row = liveDb.prepare("SELECT payload FROM candle_cache WHERE json_extract(payload,'$.symbol')=? AND json_extract(payload,'$.interval')='1d' ORDER BY expires_at DESC LIMIT 1").get(symbol);
      assert.ok(row, `${symbol} 必須有真正保存的日 K 快取，不可回退 fixture`);
      const payload = JSON.parse(row.payload);
      assert.ok(payload.candles.length >= 160 && payload.quote?.sessionDate, "真實快取須保留來源日期與完整的可顯示資料");
      livePayloads.set(symbol, payload);
    }
  }
  const sourceSetup = liveDb ? liveSetup : setup;
  const db = new SqliteD1();
  t.after(() => db.close());
  const environment = { DB: db, ASSETS: { fetch: async (request) => new Response(new URL(request.url).pathname === "/data/stock_setup.md" ? sourceSetup : html) } };
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
  const candleRequests = [];
  const blockedApiRequests = [];
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
    if (url.pathname === "/api/candles") {
      candleRequests.push({ symbol: url.searchParams.get("symbol"), interval: url.searchParams.get("interval") });
      if (liveDb) {
        const payload = livePayloads.get(url.searchParams.get("symbol"));
        assert.ok(payload && url.searchParams.get("interval") === "1d", "只允許明列的真實日 K 快取");
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
      }
      // 明確的隔離 K 線 fixture；不請求正式行情，也不建立真實 SSE。
      const provider = "yahoo-chart";
      const candles = Array.from({ length: 200 }, (_, index) => ({
        time: Date.UTC(2026, 0, 1 + index) / 1000,
        open: 100 + index / 10, high: 102 + index / 10, low: 99 + index / 10,
        close: 101 + index / 10, volume: 20,
      }));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        symbol: url.searchParams.get("symbol"), interval: url.searchParams.get("interval"), provider,
        source: "isolated-fixture-only", candles, indicators: {},
        volumeContract: { market: "TW", securityType: "STK", provider, sourceVolumeUnit: "share",
          canonicalVolumeUnit: "common_lot", normalizationRevision: "taiwan-stock-common-lot/1",
          sourceFingerprint: "yahoo-chart|share|common_lot|taiwan-stock-common-lot/1" },
      }) });
    }
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
      blockedApiRequests.push({ path: url.pathname, method: request.method() });
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
  await page.locator("#chart-count").selectOption(String(initialChartCount));
  await page.waitForFunction((count) => window.__quoteChartDebug?.panelViewState().length === count &&
    window.__quoteChartDebug.panelViewState().every((panel) => panel.loaded && panel.visibleLogicalRange), initialChartCount).catch(async () => {
      throw new Error(`fixture_charts_not_loaded ${JSON.stringify(await page.evaluate(() => ({
        panels: window.__quoteChartDebug?.panelViewState().map(({ symbol, loaded, candleCount }) => ({ symbol, loaded, candleCount })),
        statuses: [...document.querySelectorAll(".chart-panel")].map((panel) => panel.innerText.slice(-140)),
      })))} errors=${JSON.stringify(browserErrors)}`);
    });
  const symbol = await page.locator(".chart-panel .symbol-select").first().inputValue();
  const sourceTabKey = await page.locator(".market-tab.is-active").first().getAttribute("data-market-tab");
  const beforeCopy = await page.evaluate(() => {
    window.__panelsBeforeCopy = [...document.querySelectorAll(".chart-panel")];
    window.__canvasesBeforeCopy = window.__panelsBeforeCopy.map((panel) => panel.querySelector("canvas"));
    return window.__quoteChartDebug.panelViewState().map(({ symbol, visibleLogicalRange, barSpacing }) => ({ symbol, visibleLogicalRange, barSpacing }));
  });
  const beforeCopySubscriptions = await page.evaluate(() => window.__quoteChartDebug.matrix().panelReorder.streamSubscriptionCount);
  const beforeCopyRequests = candleRequests.length;
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
  assert.equal(await page.evaluate(() => [...document.querySelectorAll(".chart-panel")].every((panel, index) =>
    panel === window.__panelsBeforeCopy[index] && panel.querySelector("canvas") === window.__canvasesBeforeCopy[index])), true, "複製不得重建來源與未受影響的線圖／canvas");
  assert.deepEqual(await page.evaluate(() => window.__quoteChartDebug.panelViewState().map(({ symbol, visibleLogicalRange, barSpacing }) =>
    ({ symbol, visibleLogicalRange, barSpacing }))), beforeCopy, "複製不得重設任何線圖 viewport");
  assert.equal(await page.evaluate(() => window.__quoteChartDebug.matrix().realtimeConnectionCount), 0, "隔離操作不得建立行情連線");
  assert.equal(await page.evaluate(() => window.__quoteChartDebug.matrix().panelReorder.streamSubscriptionCount), beforeCopySubscriptions, "複製不得重建既有圖表更新註冊");
  assert.equal(candleRequests.length, beforeCopyRequests, "複製不得重新載入來源 K 線");
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
  await page.waitForFunction(() => window.__quoteChartDebug.panelViewState().every((panel) => panel.loaded && panel.visibleLogicalRange));
  // loaded 表示 payload 已寫入；圖表初始 fit 與 ResizeObserver 仍可能待下一影格。
  // 先等真正可見範圍穩定，再量測 mutation 前後縮放，不拿初始預設 6 作基準。
  await page.evaluate(async () => {
    let previous;
    let stable = 0;
    for (let frame = 0; frame < 60; frame++) {
      await new Promise(requestAnimationFrame);
      const current = JSON.stringify(window.__quoteChartDebug.panelViewState().map(({ visibleLogicalRange, barSpacing }) => ({ visibleLogicalRange, barSpacing })));
      stable = current === previous ? stable + 1 : 0;
      if (stable >= 3) return;
      previous = current;
    }
    throw new Error("before_move_viewport_not_stable");
  });
  const beforeMoveSpacing = await page.evaluate(() => {
    window.__unaffectedPanel = document.querySelectorAll(".chart-panel")[1];
    window.__unaffectedCanvas = window.__unaffectedPanel.querySelector("canvas");
    return window.__quoteChartDebug.panelViewState()[1].barSpacing;
  });
  const moveHandleBox = await page.locator(".chart-panel .panel-reorder-handle").first().boundingBox();
  const moveTargetBox = await target.boundingBox();
  await page.mouse.move(moveHandleBox.x + moveHandleBox.width / 2, moveHandleBox.y + moveHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(moveTargetBox.x + moveTargetBox.width / 2, moveTargetBox.y + moveTargetBox.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction((nextSymbol) => document.querySelector(".chart-panel .symbol-select")?.value === nextSymbol, beforeMove[1]);
  assert.equal(await page.locator(".chart-panel .symbol-select").first().inputValue(), beforeMove[1], "來源卡片應由下一檔遞補");
  assert.equal(await page.evaluate(() => [...document.querySelectorAll(".chart-panel")].includes(window.__unaffectedPanel) &&
    window.__unaffectedPanel.querySelector("canvas") === window.__unaffectedCanvas), true, "移動不得重建未受影響的線圖／canvas");
  assert.equal(await page.evaluate(() => window.__quoteChartDebug.panelViewState()[0].barSpacing), beforeMoveSpacing, "移動不得重設未受影響線圖的縮放");
  if (liveDb && process.env.MULTIVIEW_ACCEPTANCE_OUTPUT_DIR) {
    await mkdir(process.env.MULTIVIEW_ACCEPTANCE_OUTPUT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.MULTIVIEW_ACCEPTANCE_OUTPUT_DIR, `move-preserved-${initialChartCount}.png`) });
  }
  await target.click();
  assert.equal(await page.locator(".chart-panel .symbol-select").first().inputValue(), beforeMove[0], "移動商品應成為目的頁籤第一檔");
  await page.reload();
  await target.click();
  assert.equal(await page.locator(".chart-panel .symbol-select").first().inputValue(), beforeMove[0], "刷新後應保留移動結果");
  assert.equal(externalRequests.length, 0);
  assert.deepEqual(writes.map(({ path }) => path), ["/api/instruments/transfer", "/api/instruments/remove-from-tab", "/api/instruments/transfer"]);
  assert.equal(browserErrors.length, 0, `browserErrors=${JSON.stringify(browserErrors)}`);
  if (liveDb) {
    const boundaryAfter = await liveBoundarySnapshot();
    assert.deepEqual(boundaryAfter, boundaryBefore, "真正行情連線與 Shioaji 清單必須未變");
    const realListsAfter = userListFingerprint(liveDb);
    assert.equal(realListsAfter, realListsBefore, "使用者的真正清單與 revision 必須完全未變");
    const evidence = {
      schemaVersion: "multiview-isolated-real-cache-acceptance/1", observedAt: new Date().toISOString(), initialChartCount,
      boundaryBefore, boundaryAfter,
      sourceMode: "persisted-real-market-data-not-live-stream", realListsBefore, realListsAfter,
      sources: [...livePayloads].map(([symbol, payload]) => ({ symbol, sessionDate: payload.quote.sessionDate,
        sourceProvider: payload.quote.sourceProvider, quoteVerification: payload.quote.verification,
        candles: payload.candles.length, payloadHash: digest(payload), first: payload.candles[0].time, last: payload.candles.at(-1).time })),
      copy: { panelsAndCanvasesPreserved: true, viewport: beforeCopy, streamRegistrationsBefore: beforeCopySubscriptions,
        streamRegistrationsAfter: beforeCopySubscriptions, candleRequestsAdded: 0 },
      move: { sourceFallback: beforeMove[1], unaffectedCanvasPreserved: true, barSpacing: beforeMoveSpacing },
      refreshPersistence: true, emptyState: true, writes, candleRequests, blockedApiRequests, externalRequests, browserErrors,
    };
    t.diagnostic(JSON.stringify(evidence));
    if (process.env.MULTIVIEW_ACCEPTANCE_OUTPUT_DIR) await writeFile(join(process.env.MULTIVIEW_ACCEPTANCE_OUTPUT_DIR, `real-cache-${initialChartCount}.json`), JSON.stringify(evidence, null, 2));
  }
});
}
