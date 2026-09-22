import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SqliteD1 } from "./helpers/sqlite-d1.mjs";

const indexHtml = await readFile(new URL("../public/static/index.html", import.meta.url), "utf8");
const stockSetup = await readFile(new URL("../public/data/stock_setup.md", import.meta.url), "utf8");
const workerSource = await readFile(new URL("../worker/app.ts", import.meta.url), "utf8");

async function builtWorker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("stock-screener-list-sync-test", `${process.pid}-${Date.now()}-${Math.random()}`);
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

async function post(service, env, email, body) {
  const response = await service.fetch(userRequest("/api/integrations/stock-screener-list/items", email, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), env, { waitUntil() {}, passThroughOnException() {} });
  return { response, payload: await response.json() };
}

async function initialized() {
  const service = await builtWorker();
  const db = new SqliteD1();
  const env = environment(db);
  await service.fetch(userRequest("/api/instruments?mode=read-only&purpose=intraday-monitor-import", "seed@example.com"), env, { waitUntil() {}, passThroughOnException() {} });
  db.exec(`
    CREATE TABLE IF NOT EXISTS screener_snapshots (
      id TEXT PRIMARY KEY NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL,
      metadata TEXT NOT NULL,
      schema_version INTEGER DEFAULT 1 NOT NULL
    );
    CREATE TABLE IF NOT EXISTS screener_universe (
      revision TEXT NOT NULL,
      symbol TEXT NOT NULL,
      market TEXT NOT NULL,
      data_date TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY(revision,symbol)
    );
    INSERT INTO instrument_catalog
      (symbol,exchange,localized_name,english_name,aliases_json,normalized_search,market,group_name,quote_type,provider,source,active,source_updated_at)
    VALUES
      ('2449.TW','TWSE','京元電子','','[]','2449tw 京元電子','台灣股市','上市股票','EQUITY','yfinance','twse-official-openapi',1,'2026-09-22'),
      ('8069.TWO','TPEx','元太','','[]','8069two 元太','台灣股市','上櫃股票','EQUITY','yfinance','tpex-official-openapi',1,'2026-09-22'),
      ('0050.TW','TWSE','元大台灣50','','[]','0050tw 元大台灣50','台灣股市','上市 ETF','ETF','yfinance','twse-official-openapi',1,'2026-09-22');
  `);
  return { service, db, env };
}

function seedVerifiedScreenerUniverse(db, stock, revision = "c".repeat(64)) {
  const metadata = JSON.stringify({ version: 4, sourceReview: "verified", universeRevision: revision });
  const payload = JSON.stringify({ stock, review: "verified", revision, sourceDate: "2026-09-21" });
  db.database.prepare("INSERT INTO screener_snapshots (id,created_at,status,metadata,schema_version) VALUES (?,?,?,?,?)")
    .run(`snapshot-${stock.symbol}`, "2026-09-22T12:00:00.000Z", "published", metadata, 4);
  db.database.prepare("INSERT INTO screener_universe (revision,symbol,market,data_date,payload) VALUES (?,?,?,?,?)")
    .run(revision, stock.symbol, stock.market, "2026-09-21", payload);
}

test("不存在時建立選股篩選頁籤，重送只保留一筆且不設為預設", async (t) => {
  const { service, db, env } = await initialized();
  t.after(() => db.close());
  const first = await post(service, env, "alice@example.com", { symbol: "2449.TW" });
  assert.equal(first.response.status, 200);
  assert.deepEqual(first.payload, {
    schemaVersion: "multiview-stock-screener-list-sync/1",
    ok: true,
    status: "added",
    symbol: "2449.TW",
    tabId: "stock-screener-filtered",
    tabLabel: "選股篩選",
  });
  const repeated = await post(service, env, "alice@example.com", { symbol: "2449.TW" });
  assert.equal(repeated.payload.status, "already_present");
  assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM user_tabs WHERE user_id=? AND label='選股篩選'").get("alice@example.com").count, 1);
  assert.deepEqual({ ...db.database.prepare("SELECT enabled,is_default FROM user_tabs WHERE user_id=? AND id='stock-screener-filtered'").get("alice@example.com") }, { enabled: 1, is_default: 0 });
  assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM user_instruments WHERE user_id=? AND symbol='2449.TW' AND tab_id='stock-screener-filtered'").get("alice@example.com").count, 1);

  const reloadedService = await builtWorker();
  const reload = await reloadedService.fetch(userRequest(
    "/api/instruments?mode=read-only&purpose=stock-screener-list-sync-refresh",
    "alice@example.com",
  ), env, { waitUntil() {}, passThroughOnException() {} });
  const reloadPayload = await reload.json();
  assert.equal(reloadPayload.personalTabs.filter((tab) => tab.label.trim() === "選股篩選").length, 1);
  assert.equal(reloadPayload.instruments.filter((item) => item.symbol === "2449.TW" && item.tabId === "stock-screener-filtered").length, 1);
});

test("沿用唯一既有同名頁籤並保留 TW/TWO catalog identity", async (t) => {
  const { service, db, env } = await initialized();
  t.after(() => db.close());
  db.exec("INSERT INTO user_tabs (user_id,id,label,sort_order,enabled,is_default,source_tab_id) VALUES ('alice@example.com','existing-filter',' 選股篩選 ',8,1,0,'')");
  const tw = await post(service, env, "alice@example.com", { symbol: "2449.tw" });
  const two = await post(service, env, "alice@example.com", { symbol: "8069.TWO" });
  assert.equal(tw.payload.tabId, "existing-filter");
  assert.equal(two.payload.tabId, "existing-filter");
  assert.deepEqual(db.database.prepare("SELECT symbol,name,provider,market FROM user_instruments WHERE user_id=? AND tab_id=? ORDER BY symbol").all("alice@example.com", "existing-filter").map((row) => ({ ...row })), [
    { symbol: "2449.TW", name: "京元電子", provider: "yfinance", market: "台灣股市" },
    { symbol: "8069.TWO", name: "元太", provider: "yfinance", market: "台灣股市" },
  ]);
});

test("instrument_catalog 缺少時，以已發布 verified universe 驗證真實選股商品", async (t) => {
  const { service, db, env } = await initialized();
  t.after(() => db.close());
  seedVerifiedScreenerUniverse(db, {
    code: "2454",
    symbol: "2454.TW",
    market: "TWSE",
    kind: "ordinary",
    name: "聯發科",
    classificationVersion: "official-issuer-common-stock-FL033103-1131231-v1",
  });
  const result = await post(service, env, "alice@example.com", { symbol: "2454.TW" });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.payload, {
    schemaVersion: "multiview-stock-screener-list-sync/1",
    ok: true,
    status: "added",
    symbol: "2454.TW",
    tabId: "stock-screener-filtered",
    tabLabel: "選股篩選",
  });
  assert.deepEqual({ ...db.database.prepare(
    "SELECT symbol,name,provider,market,group_name FROM user_instruments WHERE user_id=? AND symbol=?",
  ).get("alice@example.com", "2454.TW") }, {
    symbol: "2454.TW",
    name: "聯發科",
    provider: "yfinance",
    market: "台灣股市",
    group_name: "上市股票",
  });
});

test("併發建立與不同 principal 均收斂在各自唯一頁籤", async (t) => {
  const { service, db, env } = await initialized();
  t.after(() => db.close());
  const [left, right] = await Promise.all([
    post(service, env, "alice@example.com", { symbol: "2449.TW" }),
    post(service, env, "alice@example.com", { symbol: "8069.TWO" }),
  ]);
  assert.equal(left.payload.ok, true);
  assert.equal(right.payload.ok, true);
  await post(service, env, "bob@example.com", { symbol: "2449.TW" });
  assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM user_tabs WHERE label='選股篩選'").get().count, 2);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM user_tabs WHERE user_id='alice@example.com' AND label='選股篩選'").get().count, 1);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM user_instruments WHERE user_id='alice@example.com' AND tab_id='stock-screener-filtered'").get().count, 2);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM user_instruments WHERE user_id='bob@example.com' AND tab_id='stock-screener-filtered'").get().count, 1);
});

test("同名重複、保留 identity 衝突與不支援商品皆 fail closed", async (t) => {
  const { service, db, env } = await initialized();
  t.after(() => db.close());
  db.exec(`INSERT INTO user_tabs (user_id,id,label,sort_order,enabled,is_default,source_tab_id) VALUES
    ('duplicate@example.com','one','選股篩選',1,1,0,''),
    ('duplicate@example.com','two','選股篩選',2,1,0,''),
    ('reserved@example.com','stock-screener-filtered','別的頁籤',1,1,0,'')`);
  const duplicate = await post(service, env, "duplicate@example.com", { symbol: "2449.TW" });
  const reserved = await post(service, env, "reserved@example.com", { symbol: "2449.TW" });
  const etf = await post(service, env, "etf@example.com", { symbol: "0050.TW" });
  const unknown = await post(service, env, "unknown@example.com", { symbol: "9999.TW" });
  assert.deepEqual([duplicate.response.status, duplicate.payload.reason], [409, "duplicate_target_tabs"]);
  assert.deepEqual([reserved.response.status, reserved.payload.reason], [409, "reserved_tab_id_conflict"]);
  assert.deepEqual([etf.response.status, etf.payload.reason], [422, "unsupported_instrument"]);
  assert.deepEqual([unknown.response.status, unknown.payload.reason], [422, "catalog_symbol_not_found"]);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM user_instruments").get().count, 0);
});

test("payload 不接受裸代碼或 target 控制欄位，且 endpoint 不排程背景副作用", async (t) => {
  const { service, db, env } = await initialized();
  t.after(() => db.close());
  let waitUntilCalls = 0;
  const request = userRequest("/api/integrations/stock-screener-list/items", "alice@example.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ symbol: "2449.TW", url: "https://evil.example" }),
  });
  const response = await service.fetch(request, env, { waitUntil() { waitUntilCalls += 1; }, passThroughOnException() {} });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).reason, "invalid_payload");
  assert.equal(waitUntilCalls, 0);
  assert.equal((await post(service, env, "alice@example.com", { symbol: "2449" })).response.status, 400);
  const refresh = await service.fetch(userRequest(
    "/api/instruments?mode=read-only&purpose=stock-screener-list-sync-refresh",
    "alice@example.com",
  ), env, { waitUntil() {}, passThroughOnException() {} });
  assert.deepEqual((await refresh.json()).realtime, { status: "not-requested", acceptedSymbolCount: 0 });
});

test("未完成 schema migration 時 fail closed，同步 endpoint 不自行建表", async (t) => {
  const service = await builtWorker();
  const db = new SqliteD1();
  t.after(() => db.close());
  const result = await post(service, environment(db), "alice@example.com", { symbol: "2449.TW" });
  assert.equal(result.response.status, 503);
  assert.deepEqual(result.payload, {
    schemaVersion: "multiview-stock-screener-list-sync/1",
    ok: false,
    reason: "persistence_unavailable",
    retryable: true,
  });
  assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('user_tabs','user_instruments')").get().count, 0);
});

test("固定用途 endpoint 不執行 DDL、provider、預熱、回補、訂閱或 runtime lifecycle", () => {
  const catalogStart = workerSource.indexOf("async function readStockScreenerSyncCatalog");
  const catalogEnd = workerSource.indexOf("function localCatalogEntry", catalogStart);
  assert.notEqual(catalogStart, -1);
  assert.notEqual(catalogEnd, -1);
  const catalogSource = workerSource.slice(catalogStart, catalogEnd);
  assert.match(catalogSource, /SELECT \* FROM instrument_catalog/);
  assert.match(catalogSource, /SELECT metadata FROM screener_snapshots/);
  assert.match(catalogSource, /SELECT revision,symbol,market,data_date,payload FROM screener_universe/);
  assert.doesNotMatch(catalogSource, /fetch\s*\(|INSERT\s|UPDATE\s|DELETE\s|CREATE\s|ALTER\s|DROP\s/i);

  const start = workerSource.indexOf("async function syncStockScreenerListItem");
  const end = workerSource.indexOf("async function syncRealtimeWatchlist", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const endpointSource = workerSource.slice(start, end);
  assert.doesNotMatch(endpointSource, /ensureDb|CREATE\s|ALTER\s|DROP\s|fetch\s*\(|scheduleWatchlistChipPrewarm|syncRealtimeWatchlist|backfill|runtime|placeOrder|submitOrder|orderTicket/i);
  assert.match(endpointSource, /user_tabs/);
  assert.match(endpointSource, /user_instruments/);
  assert.match(endpointSource, /readStockScreenerSyncCatalog/);
});
