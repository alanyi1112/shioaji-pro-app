import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SqliteD1, applyDrizzleSql } from "./helpers/sqlite-d1.mjs";
import { ohlcvUpsertStatement, shouldReplaceOhlcv } from "../worker/stock-screener-ohlcv-repository.ts";

const directory = new URL("../drizzle/", import.meta.url);
const files = readdirSync(directory).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
const migration29 = "0029_plain_strong_guy.sql";
const sql = (name) => readFileSync(new URL(name, directory), "utf8").replaceAll("--> statement-breakpoint", "\n");
const applyBefore29 = (db) => files.slice(0, files.indexOf(migration29)).forEach((name) => db.exec(sql(name)));
const digestRows = (db) => createHash("sha256").update(JSON.stringify({
  tabs: db.prepare("SELECT * FROM user_tabs ORDER BY user_id,id").all(),
  instruments: db.prepare("SELECT * FROM user_instruments ORDER BY user_id,symbol,tab_id").all(),
})).digest("hex");

test("0029 additive staging migration 保留個人資料與既有 v2 snapshot，索引完整且 journal 唯一", () => {
  const db = new DatabaseSync(":memory:");
  try {
    applyBefore29(db);
    db.exec("INSERT INTO user_tabs(user_id,id,label,sort_order,enabled,is_default,source_tab_id) VALUES('private-user','tab-1','個人',1,1,0,'')");
    db.exec("INSERT INTO user_instruments(user_id,item_id,symbol,name,provider,tab_id,tab_label,group_name,market,enabled) VALUES('private-user','item-1','3008.TW','大立光','yfinance','tab-1','個人','個人','TW',1)");
    db.exec("INSERT INTO screener_snapshots(id,created_at,status,metadata,schema_version) VALUES('v2','2026-09-01T00:00:00Z','published','{\"version\":2}',2)");
    db.exec("INSERT INTO screener_snapshot_rows(snapshot_id,symbol,payload) VALUES('v2','3008.TW','{\"version\":2}')");
    const before = digestRows(db);
    db.exec(sql(migration29));
    assert.equal(digestRows(db), before);
    assert.deepEqual({ ...db.prepare("SELECT id,schema_version,metadata FROM screener_snapshots").get() }, { id: "v2", schema_version: 2, metadata: "{\"version\":2}" });
    assert.deepEqual({ ...db.prepare("SELECT snapshot_id,symbol,payload FROM screener_snapshot_rows").get() }, { snapshot_id: "v2", symbol: "3008.TW", payload: "{\"version\":2}" });
    assert.deepEqual(db.prepare("PRAGMA table_info(screener_daily_ohlcv)").all().map((row) => row.name),
      ["symbol", "data_date", "market", "open", "high", "low", "close", "currency", "price_basis", "mapping_version", "source_url", "payload_hash", "fetched_at", "validation"]);
    const indexes = db.prepare("PRAGMA index_list(screener_daily_ohlcv)").all().map((row) => row.name);
    assert.ok(indexes.includes("screener_daily_ohlcv_market_date_idx"));
    assert.ok(indexes.includes("screener_daily_ohlcv_symbol_date_idx"));
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", directory), "utf8"));
    assert.equal(journal.entries.filter((entry) => entry.tag === "0029_plain_strong_guy").length, 1);
  } finally { db.close(); }
});

test("0029 migration ledger 重跑不重套；交易 rollback 不留下半套 schema", () => {
  const rerun = new DatabaseSync(":memory:");
  const rollback = new DatabaseSync(":memory:");
  try {
    applyBefore29(rerun);
    rerun.exec("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TEXT)");
    const applyOnce = () => {
      if (rerun.prepare("SELECT 1 FROM d1_migrations WHERE name=?").get(migration29)) return false;
      rerun.exec("BEGIN IMMEDIATE");
      try { rerun.exec(sql(migration29)); rerun.prepare("INSERT INTO d1_migrations(name,applied_at) VALUES(?,?)").run(migration29, "2026-09-02T00:00:00Z"); rerun.exec("COMMIT"); }
      catch (error) { rerun.exec("ROLLBACK"); throw error; }
      return true;
    };
    assert.equal(applyOnce(), true);
    assert.equal(applyOnce(), false);
    assert.equal(rerun.prepare("SELECT count(*) AS n FROM d1_migrations WHERE name=?").get(migration29).n, 1);

    applyBefore29(rollback);
    rollback.exec("BEGIN IMMEDIATE");
    rollback.exec(sql(migration29));
    assert.equal(rollback.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='screener_daily_ohlcv'").get().n, 1);
    rollback.exec("ROLLBACK");
    assert.equal(rollback.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='screener_daily_ohlcv'").get().n, 0);
    assert.equal(rollback.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='screener_snapshots'").get().n, 1);
  } finally { rerun.close(); rollback.close(); }
});

const point = (fetchedAt, patch = {}) => ({
  symbol: "2330.TW", market: "TWSE", sessionDate: "2026-08-31",
  open: "100", high: "105", low: "99", close: "104", currency: "TWD",
  priceBasis: "official-unadjusted-after-market-twd", mappingVersion: "official-daily-ohlcv-v1",
  provenance: { source: "TWSE", sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
    fetchedAt, payloadHash: "a".repeat(64), normalizationVersion: "official-daily-ohlcv-v1" }, ...patch,
});

test("完整且較新的同日 OHLC 才能覆蓋；舊或稀疏回應不清空 verified row", async () => {
  const migrations = await Promise.all(["0027_pale_randall_flagg.sql", "0028_early_sir_ram.sql", migration29]
    .map((name) => import("node:fs/promises").then(({ readFile }) => readFile(new URL(name, directory), "utf8"))));
  const db = new SqliteD1();
  try {
    migrations.forEach((migration) => applyDrizzleSql(db, migration));
    const original = point("2026-09-01T10:00:00Z");
    const older = point("2026-09-01T09:00:00Z", { close: "103" });
    const newer = point("2026-09-01T11:00:00Z", { close: "104.5" });
    assert.equal(shouldReplaceOhlcv(original, older), false);
    assert.equal(shouldReplaceOhlcv(original, newer), true);
    assert.equal(shouldReplaceOhlcv(original, point("2026-09-01T12:00:00Z", { close: "" })), false);
    await ohlcvUpsertStatement(db, original).run();
    await ohlcvUpsertStatement(db, older).run();
    assert.equal((await db.prepare("SELECT close FROM screener_daily_ohlcv WHERE symbol='2330.TW'").first()).close, "104");
    assert.throws(() => ohlcvUpsertStatement(db, point("2026-09-01T12:00:00Z", { close: "" })), /invalid_ohlcv/);
    await ohlcvUpsertStatement(db, newer).run();
    assert.equal((await db.prepare("SELECT close FROM screener_daily_ohlcv WHERE symbol='2330.TW'").first()).close, "104.5");
    assert.equal((await db.prepare("PRAGMA integrity_check").first()).integrity_check, "ok");
  } finally { db.close(); }
});
