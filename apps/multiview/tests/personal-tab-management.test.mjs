import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SqliteD1 } from "./helpers/sqlite-d1.mjs";
import {
  personalTabKey,
  resolveEffectiveTabs,
  systemTabKey,
} from "../worker/personal-tabs.ts";

const indexHtml = await readFile(new URL("../public/static/index.html", import.meta.url), "utf8");
const stockSetup = await readFile(new URL("../public/data/stock_setup.md", import.meta.url), "utf8");
const appSource = await readFile(new URL("../public/static/app.js", import.meta.url), "utf8");
const execution = { waitUntil() {}, passThroughOnException() {} };

test("儲存頁籤會在 pending 重繪前保留設為預設的勾選值", () => {
  const start = appSource.indexOf("async function savePersonalTab()");
  const end = appSource.indexOf("function newPersonalTabId()", start + 1);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const source = appSource.slice(start, end);
  const captureIndex = source.indexOf("const isDefault = defaultInput?.checked === true;");
  const pendingIndex = source.indexOf("state.watchlistTabMutationPending = true;");
  assert.ok(captureIndex >= 0);
  assert.ok(pendingIndex >= 0);
  assert.ok(captureIndex < pendingIndex);
  assert.match(source, /body: JSON\.stringify\([\s\S]*?isDefault,[\s\S]*?\)/);
  assert.doesNotMatch(source, /isDefault: defaultInput\?\.checked === true/);
});

async function builtWorker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("personal-tabs-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

function environment(db) {
  return {
    DB: db,
    ASSETS: {
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        if (path === "/static/index.html") return new Response(indexHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
        if (path === "/data/stock_setup.md") return new Response(stockSetup, { headers: { "content-type": "text/markdown; charset=utf-8" } });
        return new Response("Not found", { status: 404 });
      },
    },
  };
}

function userRequest(path, email, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("oai-authenticated-user-email", email);
  return new Request(`https://site.example${path}`, { ...init, headers });
}

async function jsonRequest(service, env, path, email, method, body) {
  const response = await service.fetch(userRequest(path, email, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, execution);
  return { response, payload: await response.json() };
}

function systemTabs() {
  return [
    { id: "taiwan-stocks", label: "台股", displayLabel: "台股", sortOrder: 1, enabled: true, isDefault: true, source: "system", defaultSymbols: ["2330.TW"] },
    { id: "us-stocks", label: "美股", displayLabel: "美股", sortOrder: 2, enabled: true, isDefault: false, source: "system", defaultSymbols: ["AAPL"] },
    { id: "fx-bonds", label: "匯率債券", displayLabel: "匯率債券", sortOrder: 3, enabled: true, isDefault: false, source: "system", defaultSymbols: ["TWD=X"] },
  ];
}

function row(overrides = {}) {
  return {
    id: "personal-one",
    label: "自選",
    sort_order: 4,
    enabled: 1,
    is_default: 0,
    source_tab_id: "",
    updated_at: "2026-07-29 10:00:00",
    ...overrides,
  };
}

test("effective tabs 合併 system override 並保留唯一 tabKey", () => {
  const model = resolveEffectiveTabs(systemTabs(), [
    row({ id: "override-tw", label: "台股觀察", sort_order: 2, source_tab_id: "taiwan-stocks", updated_at: "2026-07-29 11:00:00" }),
    row({ id: "personal-one", label: "台股", sort_order: 2 }),
  ]);

  assert.deepEqual(model.marketTabs.map((tab) => tab.tabKey), [
    systemTabKey("taiwan-stocks"),
    systemTabKey("us-stocks"),
    personalTabKey("personal-one"),
    systemTabKey("fx-bonds"),
  ]);
  const taiwan = model.marketTabs.find((tab) => tab.tabKey === systemTabKey("taiwan-stocks"));
  assert.equal(taiwan.label, "台股觀察");
  assert.equal(taiwan.source, "personal-override");
  assert.equal(taiwan.overrideRowId, "override-tw");
  assert.equal(model.marketTabs.filter((tab) => tab.tabKey === systemTabKey("taiwan-stocks")).length, 1);
  assert.equal(model.marketTabs.find((tab) => tab.tabKey === personalTabKey("personal-one")).label, "台股");
});

test("歷史 row id 等於 system id 時辨識為 override", () => {
  const model = resolveEffectiveTabs(systemTabs(), [
    row({ id: "us-stocks", label: "美股精選", sort_order: 1, source_tab_id: "" }),
  ]);
  const us = model.managedTabs.find((tab) => tab.tabKey === systemTabKey("us-stocks"));
  assert.equal(us.label, "美股精選");
  assert.equal(us.overrideRowId, "us-stocks");
  assert.equal(model.managedTabs.some((tab) => tab.tabKey === personalTabKey("us-stocks")), false);
});

test("重複 override 以最新資料決定且只產生安全診斷", () => {
  const model = resolveEffectiveTabs(systemTabs(), [
    row({ id: "older", label: "舊名稱", source_tab_id: "taiwan-stocks", updated_at: "2026-07-28 10:00:00" }),
    row({ id: "newer", label: "新名稱", source_tab_id: "taiwan-stocks", updated_at: "2026-07-29 10:00:00" }),
  ]);
  assert.equal(model.managedTabs.find((tab) => tab.tabKey === systemTabKey("taiwan-stocks")).label, "新名稱");
  assert.deepEqual(model.diagnostics, [{ code: "duplicate_system_override", blocking: false, tabKey: systemTabKey("taiwan-stocks") }]);
  assert.equal(model.blockingDiagnostics.length, 0);
});

test("未知 source_tab_id 保留資料但阻擋破壞性異動", () => {
  const model = resolveEffectiveTabs(systemTabs(), [
    row({ id: "unknown-override", label: "舊分類", source_tab_id: "removed-system-tab" }),
  ]);
  assert.equal(model.managedTabs.some((tab) => tab.tabKey === personalTabKey("unknown-override")), true);
  assert.deepEqual(model.blockingDiagnostics, [{ code: "unknown_system_override", blocking: true, tabKey: personalTabKey("unknown-override") }]);
});

test("重複及非連續 sort_order 產生 deterministic order 並正規化唯一預設", () => {
  const model = resolveEffectiveTabs(systemTabs(), [
    row({ id: "b", label: "B", sort_order: 2, is_default: 1, updated_at: "2026-07-29 10:00:00" }),
    row({ id: "a", label: "A", sort_order: 2, is_default: 1, updated_at: "2026-07-29 09:00:00" }),
    row({ id: "hidden", label: "隱藏", sort_order: 99, enabled: 0, is_default: 1 }),
  ]);
  assert.deepEqual(model.marketTabs.map((tab) => tab.tabKey), [
    systemTabKey("taiwan-stocks"),
    systemTabKey("us-stocks"),
    personalTabKey("a"),
    personalTabKey("b"),
    systemTabKey("fx-bonds"),
  ]);
  assert.deepEqual(model.managedTabs.filter((tab) => tab.isDefault).map((tab) => tab.tabKey), [personalTabKey("a")]);
  assert.equal(model.managedTabs.find((tab) => tab.id === "hidden").isDefault, false);
});

test("頁籤 reorder 驗證完整清單並以 owner 範圍正規化 1..N", async (t) => {
  const service = await builtWorker();
  const db = new SqliteD1();
  t.after(() => db.close());
  const env = environment(db);
  await service.fetch(userRequest("/api/instruments", "alice@example.com"), env, execution);
  db.exec(`
    INSERT INTO user_tabs (user_id,id,label,sort_order,enabled,is_default,source_tab_id,updated_at) VALUES
      ('alice@example.com','mine-a','台股',2,1,0,'','2026-07-29 09:00:00'),
      ('alice@example.com','mine-b','觀察',2,1,0,'','2026-07-29 10:00:00'),
      ('alice@example.com','tw-override','台股精選',2,1,1,'taiwan-stocks','2026-07-29 11:00:00'),
      ('bob@example.com','mine-a','Bob 清單',77,1,1,'','2026-07-29 09:00:00');
  `);

  const beforeResponse = await service.fetch(userRequest("/api/instruments", "alice@example.com"), env, execution);
  const before = await beforeResponse.json();
  assert.equal(before.marketTabs.filter((tab) => tab.tabKey === "system:taiwan-stocks").length, 1);
  assert.equal(before.marketTabs.find((tab) => tab.tabKey === "system:taiwan-stocks").label, "台股精選");
  assert.equal(before.marketTabs.find((tab) => tab.tabKey === "personal:mine-a").label, "台股");

  const orderedTabKeys = before.marketTabs.map((tab) => tab.tabKey).reverse();
  const saved = await jsonRequest(service, env, "/api/tabs/reorder", "alice@example.com", "POST", { orderedTabKeys, revision: 7 });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.payload.acceptedRevision, 7);
  assert.deepEqual(saved.payload.marketTabs.map((tab) => tab.tabKey), orderedTabKeys);
  assert.deepEqual(saved.payload.marketTabs.map((tab) => tab.sortOrder), orderedTabKeys.map((_, index) => index + 1));

  const aliceRows = db.database.prepare("SELECT sort_order FROM user_tabs WHERE user_id='alice@example.com' AND enabled=1 ORDER BY sort_order").all();
  assert.deepEqual(aliceRows.map((item) => item.sort_order), orderedTabKeys.map((_, index) => index + 1));
  assert.equal(db.database.prepare("SELECT sort_order FROM user_tabs WHERE user_id='bob@example.com' AND id='mine-a'").get().sort_order, 77);

  const snapshot = JSON.stringify(aliceRows);
  const invalid = await jsonRequest(service, env, "/api/tabs/reorder", "alice@example.com", "POST", { orderedTabKeys: [orderedTabKeys[0], orderedTabKeys[0]], revision: 8 });
  assert.equal(invalid.response.status, 400);
  assert.equal(JSON.stringify(db.database.prepare("SELECT sort_order FROM user_tabs WHERE user_id='alice@example.com' AND enabled=1 ORDER BY sort_order").all()), snapshot);
});

test("visibility 建立 system override、保留商品並將取消隱藏頁籤放到最後", async (t) => {
  const service = await builtWorker();
  const db = new SqliteD1();
  t.after(() => db.close());
  const env = environment(db);
  await service.fetch(userRequest("/api/instruments", "visibility@example.com"), env, execution);

  const hidden = await jsonRequest(service, env, "/api/tabs/visibility", "visibility@example.com", "POST", { tabKey: "system:us-stocks", enabled: false });
  assert.equal(hidden.response.status, 200);
  assert.equal(hidden.payload.marketTabs.some((tab) => tab.tabKey === "system:us-stocks"), false);
  assert.equal(hidden.payload.managedTabs.find((tab) => tab.tabKey === "system:us-stocks").enabled, false);
  const override = db.database.prepare("SELECT enabled,source_tab_id FROM user_tabs WHERE user_id=? AND source_tab_id=?").get("visibility@example.com", "us-stocks");
  assert.equal(override.enabled, 0);
  assert.equal(override.source_tab_id, "us-stocks");

  const unchanged = await jsonRequest(service, env, "/api/tabs/visibility", "visibility@example.com", "POST", { tabKey: "system:us-stocks", enabled: false });
  assert.equal(unchanged.response.status, 409);

  const shown = await jsonRequest(service, env, "/api/tabs/visibility", "visibility@example.com", "POST", { tabKey: "system:us-stocks", enabled: true });
  assert.equal(shown.response.status, 200);
  assert.equal(shown.payload.marketTabs.at(-1).tabKey, "system:us-stocks");
  assert.deepEqual(shown.payload.marketTabs.map((tab) => tab.sortOrder), shown.payload.marketTabs.map((_, index) => index + 1));

  await jsonRequest(service, env, "/api/tabs/visibility", "visibility@example.com", "POST", { tabKey: "system:taiwan-stocks", enabled: false });
  await jsonRequest(service, env, "/api/tabs/visibility", "visibility@example.com", "POST", { tabKey: "system:fx-bonds", enabled: false });
  await jsonRequest(service, env, "/api/tabs/visibility", "visibility@example.com", "POST", { tabKey: "system:index-futures", enabled: false });
  const last = await jsonRequest(service, env, "/api/tabs/visibility", "visibility@example.com", "POST", { tabKey: "system:us-stocks", enabled: false });
  assert.equal(last.response.status, 400);
  assert.equal(last.payload.reason, "last_visible_tab");
});

test("metadata 不再改動排序／visibility，system reset 與 custom delete 維持隔離", async (t) => {
  const service = await builtWorker();
  const db = new SqliteD1();
  t.after(() => db.close());
  const env = environment(db);
  await service.fetch(userRequest("/api/instruments", "owner@example.com"), env, execution);

  const created = await jsonRequest(service, env, "/api/tabs", "owner@example.com", "POST", { id: "mine", label: "我的分類", sortOrder: 99, enabled: false, isDefault: false });
  assert.equal(created.response.status, 200);
  const createdTab = created.payload.managedTabs.find((tab) => tab.tabKey === "personal:mine");
  assert.equal(createdTab.enabled, true);
  assert.equal(createdTab.sortOrder, 5);

  const renamed = await jsonRequest(service, env, "/api/tabs", "owner@example.com", "POST", { tabKey: "personal:mine", label: "改名分類", sortOrder: 1, enabled: false, isDefault: true });
  assert.equal(renamed.response.status, 200);
  const renamedTab = renamed.payload.managedTabs.find((tab) => tab.tabKey === "personal:mine");
  assert.equal(renamedTab.sortOrder, 5);
  assert.equal(renamedTab.enabled, true);
  assert.equal(renamedTab.isDefault, true);

  await jsonRequest(service, env, "/api/tabs", "owner@example.com", "POST", { tabKey: "system:taiwan-stocks", label: "台股改名", isDefault: false });
  const reset = await jsonRequest(service, env, "/api/tabs/reset", "owner@example.com", "POST", { tabKey: "system:taiwan-stocks" });
  assert.equal(reset.response.status, 200);
  assert.equal(reset.payload.managedTabs.find((tab) => tab.tabKey === "system:taiwan-stocks").label, "台股");
  assert.equal(reset.payload.managedTabs.find((tab) => tab.tabKey === "system:taiwan-stocks").hasOverride, false);

  const denied = await jsonRequest(service, env, "/api/tabs/system%3Ataiwan-stocks", "owner@example.com", "DELETE");
  assert.equal(denied.response.status, 400);
  const removed = await jsonRequest(service, env, "/api/tabs/personal%3Amine", "owner@example.com", "DELETE");
  assert.equal(removed.response.status, 200);
  assert.equal(removed.payload.managedTabs.some((tab) => tab.tabKey === "personal:mine"), false);

  const other = await service.fetch(userRequest("/api/instruments", "other@example.com"), env, execution);
  assert.equal((await other.json()).managedTabs.some((tab) => tab.tabKey === "personal:mine"), false);
});
