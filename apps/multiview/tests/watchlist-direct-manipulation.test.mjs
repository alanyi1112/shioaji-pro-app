import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SqliteD1, applyDrizzleSql } from "./helpers/sqlite-d1.mjs";

const setup = await readFile(new URL("../public/data/stock_setup.md", import.meta.url), "utf8");
const html = await readFile(new URL("../public/static/index.html", import.meta.url), "utf8");
const execution = { waitUntil() {}, passThroughOnException() {} };

async function worker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("watchlist-direct-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

function env(db) {
  return {
    DB: db,
    ASSETS: {
      fetch: async (request) => new Response(new URL(request.url).pathname === "/data/stock_setup.md" ? setup : html),
    },
  };
}

async function call(service, environment, path, email, body) {
  const headers = new Headers({ "content-type": "application/json" });
  if (email) headers.set("oai-authenticated-user-email", email);
  const response = await service.fetch(new Request(`https://site.example${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), environment, execution);
  return { status: response.status, payload: await response.json() };
}

const transfer = (sourceTabKey, targetTabKey, symbol, mode) => ({ sourceTabKey, targetTabKey, symbol, mode });
const list = (payload, tabKey) => payload.marketTabs.find((tab) => tab.tabKey === tabKey)?.defaultSymbols || [];

test("系統頁籤對系統頁籤複製能各自保有同一商品，刷新仍置頂", async (t) => {
  const service = await worker();
  const db = new SqliteD1();
  t.after(() => db.close());
  const environment = env(db);
  const result = await call(service, environment, "/api/instruments/transfer", "alice@example.com",
    transfer("system:taiwan-stocks", "system:us-stocks", "2330.TW", "copy"));
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.equal(list(result.payload, "system:us-stocks")[0], "2330.TW");
  assert.ok(list(result.payload, "system:taiwan-stocks").includes("2330.TW"));
  const refreshed = await call(service, environment, "/api/instruments", "alice@example.com");
  assert.equal(list(refreshed.payload, "system:us-stocks")[0], "2330.TW");
  assert.ok(list(refreshed.payload, "system:taiwan-stocks").includes("2330.TW"));
  const bob = await call(service, environment, "/api/instruments", "bob@example.com");
  assert.ok(!list(bob.payload, "system:us-stocks").includes("2330.TW"));
});

test("系統預設移至個人頁籤只隱藏該系統頁籤的個人視圖", async (t) => {
  const service = await worker();
  const db = new SqliteD1();
  t.after(() => db.close());
  const environment = env(db);
  await call(service, environment, "/api/instruments", "alice@example.com");
  db.exec("INSERT INTO user_tabs (user_id,id,label,sort_order,enabled,is_default,source_tab_id) VALUES ('alice@example.com','personal-watch','觀察',5,1,0,'')");
  const result = await call(service, environment, "/api/instruments/transfer", "alice@example.com",
    transfer("system:taiwan-stocks", "personal:personal-watch", "2330.TW", "move"));
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.equal(list(result.payload, "personal:personal-watch")[0], "2330.TW");
  assert.ok(!list(result.payload, "system:taiwan-stocks").includes("2330.TW"));
  const bob = await call(service, environment, "/api/instruments", "bob@example.com");
  assert.ok(list(bob.payload, "system:taiwan-stocks").includes("2330.TW"));
});

test("目的地已有商品時保留其推薦人，移動後不重複", async (t) => {
  const service = await worker();
  const db = new SqliteD1();
  t.after(() => db.close());
  const environment = env(db);
  await call(service, environment, "/api/instruments", "alice@example.com");
  db.exec("INSERT INTO user_tabs (user_id,id,label,sort_order,enabled,is_default,source_tab_id) VALUES ('alice@example.com','personal-watch','觀察',5,1,0,'')");
  db.exec("INSERT INTO user_instruments (user_id,item_id,symbol,name,provider,tab_id,tab_label,group_name,market,enabled,sort_order,recommender) VALUES ('alice@example.com','existing-1','2330.TW','台積電','yfinance','personal-watch','觀察','個股','台股',1,50,'原備註')");
  const result = await call(service, environment, "/api/instruments/transfer", "alice@example.com",
    transfer("system:taiwan-stocks", "personal:personal-watch", "2330.TW", "move"));
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.equal(list(result.payload, "personal:personal-watch").filter((symbol) => symbol === "2330.TW").length, 1);
  assert.equal(db.database.prepare("SELECT recommender FROM user_instruments WHERE user_id='alice@example.com' AND tab_id='personal-watch' AND symbol='2330.TW'").get().recommender, "原備註");
});

test("線圖快捷移除僅隱藏指定系統頁籤，錯誤及未登入不寫入", async (t) => {
  const service = await worker();
  const db = new SqliteD1();
  t.after(() => db.close());
  const environment = env(db);
  const unauthenticated = await call(service, environment, "/api/instruments/remove-from-tab", null,
    { sourceTabKey: "system:taiwan-stocks", symbol: "2330.TW" });
  assert.equal(unauthenticated.status, 401);
  const wrongSource = await call(service, environment, "/api/instruments/remove-from-tab", "alice@example.com",
    { sourceTabKey: "system:us-stocks", symbol: "2330.TW" });
  assert.equal(wrongSource.status, 409);
  const removed = await call(service, environment, "/api/instruments/remove-from-tab", "alice@example.com",
    { sourceTabKey: "system:taiwan-stocks", symbol: "2330.TW" });
  assert.equal(removed.status, 200, JSON.stringify(removed.payload));
  assert.ok(!list(removed.payload, "system:taiwan-stocks").includes("2330.TW"));
  const bob = await call(service, environment, "/api/instruments", "bob@example.com");
  assert.ok(list(bob.payload, "system:taiwan-stocks").includes("2330.TW"));
});

test("個人頁籤可移往另一個個人頁籤，來源只隱藏確切成員", async (t) => {
  const service = await worker();
  const db = new SqliteD1();
  t.after(() => db.close());
  const environment = env(db);
  await call(service, environment, "/api/instruments", "alice@example.com");
  db.exec("INSERT INTO user_tabs (user_id,id,label,sort_order,enabled,is_default,source_tab_id) VALUES ('alice@example.com','watch-a','觀察甲',5,1,0,''),('alice@example.com','watch-b','觀察乙',6,1,0,'')");
  db.exec("INSERT INTO user_instruments (user_id,item_id,symbol,name,provider,tab_id,tab_label,group_name,market,enabled,sort_order,recommender) VALUES ('alice@example.com','personal-a','2330.TW','台積電','yfinance','watch-a','觀察甲','個股','台股',1,2,'來源備註')");
  const result = await call(service, environment, "/api/instruments/transfer", "alice@example.com",
    transfer("personal:watch-a", "personal:watch-b", "2330.TW", "move"));
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.ok(!list(result.payload, "personal:watch-a").includes("2330.TW"));
  assert.equal(list(result.payload, "personal:watch-b")[0], "2330.TW");
  assert.ok(list(result.payload, "system:taiwan-stocks").includes("2330.TW"));
  assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM user_instruments WHERE user_id='alice@example.com' AND tab_id='watch-a' AND symbol='2330.TW'").get().count, 0);
});

test("個人頁籤快捷移除只刪該頁籤的確切列", async (t) => {
  const service = await worker();
  const db = new SqliteD1();
  t.after(() => db.close());
  const environment = env(db);
  await call(service, environment, "/api/instruments", "alice@example.com");
  db.exec("INSERT INTO user_tabs (user_id,id,label,sort_order,enabled,is_default,source_tab_id) VALUES ('alice@example.com','watch-a','觀察甲',5,1,0,''),('alice@example.com','watch-b','觀察乙',6,1,0,'')");
  db.exec("INSERT INTO user_instruments (user_id,item_id,symbol,name,provider,tab_id,tab_label,group_name,market,enabled,sort_order) VALUES ('alice@example.com','item-a','AAA','甲','sample','watch-a','觀察甲','個股','自訂',1,1),('alice@example.com','item-b','AAA','甲','sample','watch-b','觀察乙','個股','自訂',1,1)");
  const removed = await call(service, environment, "/api/instruments/remove-from-tab", "alice@example.com",
    { sourceTabKey: "personal:watch-a", symbol: "AAA" });
  assert.equal(removed.status, 200, JSON.stringify(removed.payload));
  assert.ok(!list(removed.payload, "personal:watch-a").includes("AAA"));
  assert.ok(list(removed.payload, "personal:watch-b").includes("AAA"));
  assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM user_instruments WHERE user_id='alice@example.com' AND tab_id='watch-a' AND symbol='AAA'").get().count, 0);
});

test("個人對系統移動與系統對系統移動使用各自的成員身分", async (t) => {
  const service = await worker();
  const db = new SqliteD1();
  t.after(() => db.close());
  const environment = env(db);
  await call(service, environment, "/api/instruments", "alice@example.com");
  db.exec("INSERT INTO user_tabs (user_id,id,label,sort_order,enabled,is_default,source_tab_id) VALUES ('alice@example.com','watch-a','觀察',5,1,0,'')");
  db.exec("INSERT INTO user_instruments (user_id,item_id,symbol,name,provider,tab_id,tab_label,group_name,market,enabled,sort_order) VALUES ('alice@example.com','personal-a','AAA','甲','sample','watch-a','觀察','個股','自訂',1,1)");
  const first = await call(service, environment, "/api/instruments/transfer", "alice@example.com",
    transfer("personal:watch-a", "system:us-stocks", "AAA", "move"));
  assert.equal(first.status, 200, JSON.stringify(first.payload));
  assert.ok(!list(first.payload, "personal:watch-a").includes("AAA"));
  assert.equal(list(first.payload, "system:us-stocks")[0], "AAA");
  const second = await call(service, environment, "/api/instruments/transfer", "alice@example.com",
    transfer("system:us-stocks", "system:fx-bonds", "AAA", "move"));
  assert.equal(second.status, 200, JSON.stringify(second.payload));
  assert.ok(!list(second.payload, "system:us-stocks").includes("AAA"));
  assert.equal(list(second.payload, "system:fx-bonds")[0], "AAA");
});

test("停用目的頁籤與過期來源拒絕寫入；失敗注入使兩邊回滾", async (t) => {
  const service = await worker();
  const db = new SqliteD1();
  t.after(() => db.close());
  const environment = env(db);
  await call(service, environment, "/api/instruments", "alice@example.com");
  db.exec("INSERT INTO user_tabs (user_id,id,label,sort_order,enabled,is_default,source_tab_id) VALUES ('alice@example.com','watch-off','暫停',5,0,0,'')");
  const disabled = await call(service, environment, "/api/instruments/transfer", "alice@example.com",
    transfer("system:taiwan-stocks", "personal:watch-off", "2330.TW", "move"));
  assert.equal(disabled.status, 409);
  const stale = await call(service, environment, "/api/instruments/transfer", "alice@example.com",
    transfer("system:us-stocks", "system:fx-bonds", "2330.TW", "move"));
  assert.equal(stale.status, 409);
  const originalBatch = db.batch.bind(db);
  db.batch = async () => { throw new Error("injected_failure"); };
  const failed = await call(service, environment, "/api/instruments/transfer", "alice@example.com",
    transfer("system:taiwan-stocks", "system:us-stocks", "2330.TW", "move"));
  assert.equal(failed.status, 503);
  db.batch = originalBatch;
  const refreshed = await call(service, environment, "/api/instruments", "alice@example.com");
  assert.ok(list(refreshed.payload, "system:taiwan-stocks").includes("2330.TW"));
  assert.ok(!list(refreshed.payload, "system:us-stocks").includes("2330.TW"));
});

test("兩個同時移動同一來源只有一個可提交，另一個不留半成品", async (t) => {
  const service = await worker();
  const db = new SqliteD1();
  t.after(() => db.close());
  const environment = env(db);
  const requests = ["system:us-stocks", "system:fx-bonds"].map((target) =>
    call(service, environment, "/api/instruments/transfer", "alice@example.com",
      transfer("system:taiwan-stocks", target, "2330.TW", "move")));
  const results = await Promise.all(requests);
  assert.equal(results.filter((item) => item.status === 200).length, 1, JSON.stringify(results));
  assert.equal(results.filter((item) => item.status === 409).length, 1, JSON.stringify(results));
  const refreshed = await call(service, environment, "/api/instruments", "alice@example.com");
  assert.ok(!list(refreshed.payload, "system:taiwan-stocks").includes("2330.TW"));
  assert.equal(["system:us-stocks", "system:fx-bonds"].filter((key) => list(refreshed.payload, key).includes("2330.TW")).length, 1);
});

test("舊系統覆寫相容遷移僅複製可判定歸屬的列，原列和未知列均保留", async (t) => {
  const service = await worker();
  const db = new SqliteD1();
  t.after(() => db.close());
  const environment = env(db);
  await call(service, environment, "/api/instruments", "alice@example.com");
  db.exec("INSERT INTO user_tabs (user_id,id,label,sort_order,enabled,is_default,source_tab_id) VALUES ('alice@example.com','override-us','海外股票',5,1,0,'us-stocks')");
  db.exec("INSERT INTO user_instruments (user_id,item_id,symbol,name,provider,tab_id,tab_label,group_name,market,enabled,sort_order) VALUES ('alice@example.com','old-tw','2330.TW','台積電','yfinance','','台股','個股','台股',1,6),('alice@example.com','old-us','AAA','甲','sample','','海外股票','個股','美股',1,3),('alice@example.com','old-unknown','ZZZ','未知','sample','','未知頁籤','個股','其他',1,9)");
  const migration = await readFile(new URL("../drizzle/0034_multiview_system_tab_memberships.sql", import.meta.url), "utf8");
  applyDrizzleSql(db, migration);
  assert.equal(db.database.prepare("SELECT system_tab_id FROM user_system_tab_instruments WHERE symbol='2330.TW'").get()?.system_tab_id, "taiwan-stocks");
  assert.equal(db.database.prepare("SELECT system_tab_id FROM user_system_tab_instruments WHERE symbol='AAA'").get()?.system_tab_id, "us-stocks");
  assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM user_system_tab_instruments WHERE symbol='ZZZ'").get().count, 0);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM user_instruments WHERE user_id='alice@example.com'").get().count, 3);
  const payload = (await call(service, environment, "/api/instruments", "alice@example.com")).payload;
  assert.ok(payload.tabDiagnostics.some((item) => item.code === "legacy_system_membership_unresolved" && item.symbol === "ZZZ"));
  const metadataResponse = await service.fetch(new Request("https://site.example/api/watchlist-items/migrated-system%3Ataiwan-stocks%3Aold-tw/metadata", {
    method: "PATCH",
    headers: { "content-type": "application/json", "oai-authenticated-user-email": "alice@example.com" },
    body: JSON.stringify({ recommender: "保留在新頁籤" }),
  }), environment, execution);
  assert.equal(metadataResponse.status, 200);
  assert.equal(db.database.prepare("SELECT recommender FROM user_system_tab_instruments WHERE item_id='migrated-system:taiwan-stocks:old-tw'").get()?.recommender, "保留在新頁籤");
  assert.equal(db.database.prepare("SELECT recommender FROM user_instruments WHERE item_id='old-tw'").get()?.recommender, "");
});
