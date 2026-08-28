import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  claimTdccContinuousSymbols,
  completeTdccContinuousWeek,
  failTdccContinuousWork,
  planTdccContinuousDates,
  probeTdccContinuousQueue,
  readTdccContinuousHealth,
  readTdccContinuousSymbolStatus,
  recordTdccLatestSnapshot,
  startTdccContinuousRun,
  syncTdccContinuousTargets,
} from "../worker/tdcc-continuous-backfill.ts";
import { applyDrizzleSql, SqliteD1 } from "./helpers/sqlite-d1.mjs";
import { AEMC_SAVED_DATES, LARGAN_SAVED_DATES, OFFICIAL_TDCC_DATES, savedDateRows } from "./fixtures/tdcc-holder-continuity.mjs";

const migration3 = await readFile(new URL("../drizzle/0003_mute_sprite.sql", import.meta.url), "utf8");
const migration6 = await readFile(new URL("../drizzle/0006_thin_mentor.sql", import.meta.url), "utf8");
const migration7 = await readFile(new URL("../drizzle/0007_clever_mach_iv.sql", import.meta.url), "utf8");
const migration8 = await readFile(new URL("../drizzle/0008_dazzling_rafael_vega.sql", import.meta.url), "utf8");
const migration24 = await readFile(new URL("../drizzle/0024_gifted_thunderbolt_ross.sql", import.meta.url), "utf8");

function continuousDb() {
  const db = new SqliteD1();
  applyDrizzleSql(db, migration3);
  applyDrizzleSql(db, migration6);
  applyDrizzleSql(db, migration7);
  applyDrizzleSql(db, migration8);
  applyDrizzleSql(db, migration24);
  return db;
}

async function insertSymbol(db, { symbol, source = "user", status = "queued", firstSeenAt, active = 1, leaseOwner = null, leaseExpiresAt = null }) {
  await db.prepare(`INSERT INTO tdcc_continuous_symbols
    (symbol,source,official_baseline,catalog_revision,active,status,first_seen_at,last_seen_at,lease_owner,lease_expires_at)
    VALUES (?,?,0,'test',?,?,?,?,?,?)`).bind(symbol, source, active, status, firstSeenAt, firstSeenAt, leaseOwner, leaseExpiresAt).run();
}

test("continuous migrations 保留既有 TDCC rows，並補上 baseline 與 retry 欄位", async (t) => {
  const db = new SqliteD1();
  t.after(() => db.close());
  applyDrizzleSql(db, migration3);
  await db.prepare(`INSERT INTO taiwan_stock_shareholder_distribution
    (symbol,data_date,levels_json,adjustment_json,total_json,provider,frequency,source_fetched_at)
    VALUES ('2330.TW','2026-07-10','[]','{}','{}','tdcc','weekly','2026-07-17T00:00:00Z')`).run();
  applyDrizzleSql(db, migration6);
  applyDrizzleSql(db, migration7);
  applyDrizzleSql(db, migration8);
  applyDrizzleSql(db, migration24);
  assert.equal(await db.prepare("SELECT COUNT(*) AS rows FROM taiwan_stock_shareholder_distribution").first("rows"), 1);
  assert.equal((await db.prepare("PRAGMA table_info(tdcc_continuous_symbols)").all()).results.some((row) => row.name === "official_baseline"), true);
  assert.equal((await db.prepare("PRAGMA table_info(tdcc_continuous_runs)").all()).results.some((row) => row.name === "next_retry_at"), true);
});

test("target discovery 去重普通股與 ETF，首次 catalog 只建 baseline，後續新上市才 queued", async (t) => {
  const db = continuousDb();
  t.after(() => db.close());
  await syncTdccContinuousTargets({
    db,
    targets: [
      { symbol: "2330.TW", source: "setup" },
      { symbol: "00919.TW", source: "user" },
      { symbol: "00919.TW", source: "user" },
    ],
    observedCatalogSymbols: ["2330.TW", "00919.TW", "1101.TW", "00981A.TW"],
    catalogRevision: "r1",
    now: "2026-07-17T00:00:00.000Z",
  });
  assert.equal(await db.prepare("SELECT COUNT(*) AS rows FROM tdcc_continuous_symbols").first("rows"), 4);
  assert.equal((await db.prepare("SELECT status FROM tdcc_continuous_symbols WHERE symbol='1101.TW'").first()).status, "observed");
  assert.equal((await db.prepare("SELECT active FROM tdcc_continuous_symbols WHERE symbol='00919.TW'").first()).active, 1);

  await syncTdccContinuousTargets({
    db,
    targets: [{ symbol: "2330.TW", source: "setup" }, { symbol: "00919.TW", source: "user" }],
    observedCatalogSymbols: ["2330.TW", "00919.TW", "1101.TW", "00981A.TW", "00982A.TW"],
    catalogRevision: "r2",
    now: "2026-07-18T00:00:00.000Z",
  });
  const newListing = await db.prepare("SELECT source,status,active FROM tdcc_continuous_symbols WHERE symbol='00982A.TW'").first();
  assert.deepEqual({ ...newListing }, { source: "official-new-listing", status: "queued", active: 1 });
  assert.equal((await db.prepare("SELECT active FROM tdcc_continuous_symbols WHERE symbol='1101.TW'").first()).active, 0);
});

test("claim 原子隔離 owner、優先新上市與 oldest-first，過期 lease 可續跑", async (t) => {
  const db = continuousDb();
  t.after(() => db.close());
  await insertSymbol(db, { symbol: "2330.TW", firstSeenAt: "2026-07-01T00:00:00Z" });
  await insertSymbol(db, { symbol: "00919.TW", source: "official-new-listing", firstSeenAt: "2026-07-10T00:00:00Z" });
  await insertSymbol(db, { symbol: "2317.TW", firstSeenAt: "2026-07-02T00:00:00Z" });
  await insertSymbol(db, { symbol: "0050.TW", status: "running", firstSeenAt: "2026-06-01T00:00:00Z", leaseOwner: "dead-run", leaseExpiresAt: "2026-07-16T00:00:00Z" });
  await insertSymbol(db, { symbol: "0056.TW", status: "running", firstSeenAt: "2026-05-01T00:00:00Z", leaseOwner: "live-run", leaseExpiresAt: "2026-07-19T00:00:00Z" });

  const first = await claimTdccContinuousSymbols({ db, owner: "run-a", limit: 2, now: "2026-07-17T00:00:00Z" });
  assert.deepEqual(first.map((item) => item.symbol), ["00919.TW", "0050.TW"]);
  const second = await claimTdccContinuousSymbols({ db, owner: "run-b", limit: 2, now: "2026-07-17T00:00:00Z" });
  assert.deepEqual(second.map((item) => item.symbol), ["2330.TW", "2317.TW"]);
  assert.equal(first.some((item) => second.some((other) => other.symbol === item.symbol)), false);
  assert.equal((await readTdccContinuousSymbolStatus(db, "0056.TW")).status, "running");
});

test("清單 target 只有兩週資料時同步後保持未核對，仍能被 durable runner claim", async (t) => {
  const db = continuousDb();
  t.after(() => db.close());
  await db.prepare(`INSERT INTO taiwan_stock_shareholder_distribution
    (symbol,data_date,levels_json,adjustment_json,total_json,provider,frequency,source_fetched_at)
    VALUES
    ('3481.TW','2026-07-10','[]','{}','{}','tdcc','weekly','2026-07-19T05:30:00Z'),
    ('3481.TW','2026-07-17','[]','{}','{}','tdcc','weekly','2026-07-19T05:30:00Z')`).run();
  await syncTdccContinuousTargets({
    db,
    targets: [{ symbol: "3481.TW", source: "user" }],
    observedCatalogSymbols: ["3481.TW"],
    catalogRevision: "r-short-history",
    now: "2026-07-19T09:30:00Z",
  });

  const beforeClaim = await readTdccContinuousSymbolStatus(db, "3481.TW");
  assert.equal(beforeClaim.status, "partial");
  assert.equal(beforeClaim.completedWeeks, 0);
  assert.equal(beforeClaim.officialPlanThrough, null);
  const claims = await claimTdccContinuousSymbols({ db, owner: "run-short-history", limit: 1, now: "2026-07-19T09:31:00Z" });
  assert.deepEqual(claims.map((item) => item.symbol), ["3481.TW"]);
});

test("gap-only 規劃、checkpoint 續跑與唯一鍵重跑維持冪等", async (t) => {
  const db = continuousDb();
  t.after(() => db.close());
  await insertSymbol(db, { symbol: "009816.TW", status: "running", firstSeenAt: "2026-02-03T00:00:00Z", leaseOwner: "run-etf", leaseExpiresAt: "2026-07-18T00:00:00Z" });
  await db.prepare(`INSERT INTO taiwan_stock_shareholder_distribution
    (symbol,data_date,levels_json,adjustment_json,total_json,provider,frequency,source_fetched_at)
    VALUES ('009816.TW','2026-07-03','[]','{}','{}','tdcc','weekly','2026-07-17T00:00:00Z')`).run();
  const officialDates = ["2026-06-26", "2026-07-03", "2026-07-10"];
  const first = await planTdccContinuousDates({ db, symbol: "009816.TW", owner: "run-etf", officialDates, preListingDates: ["2026-06-26"], now: "2026-07-17T00:00:00Z" });
  assert.deepEqual(first.missingDates, ["2026-07-10"]);
  assert.equal(first.expectedWeeks, 3);
  assert.equal(first.completedWeeks, 2);
  assert.equal((await db.prepare("SELECT error_code FROM tdcc_continuous_items WHERE symbol='009816.TW' AND data_date='2026-06-26'").first()).error_code, "pre_listing");
  await completeTdccContinuousWeek({ db, symbol: "009816.TW", dataDate: "2026-07-10", owner: "run-etf", gapReason: "not_published", now: "2026-07-17T00:01:00Z" });
  assert.equal((await readTdccContinuousSymbolStatus(db, "009816.TW")).checkpoint, "2026-07-10");
  await db.prepare("UPDATE tdcc_continuous_symbols SET status='running',lease_owner='run-etf-2',lease_expires_at='2026-07-18T00:00:00Z' WHERE symbol='009816.TW'").run();
  const repeated = await planTdccContinuousDates({ db, symbol: "009816.TW", owner: "run-etf-2", officialDates, preListingDates: ["2026-06-26"], now: "2026-07-17T00:02:00Z" });
  assert.deepEqual(repeated.missingDates, []);
  assert.equal(await db.prepare("SELECT COUNT(*) AS rows FROM tdcc_continuous_items WHERE symbol='009816.TW'").first("rows"), 3);
});

test("blocked 與 retryable 失敗逐 symbol 隔離，health 不洩漏錯誤內容", async (t) => {
  const db = continuousDb();
  t.after(() => db.close());
  await insertSymbol(db, { symbol: "2330.TW", status: "running", firstSeenAt: "2026-07-01T00:00:00Z", leaseOwner: "run-stock", leaseExpiresAt: "2026-07-18T00:00:00Z" });
  await insertSymbol(db, { symbol: "00919.TW", status: "running", firstSeenAt: "2026-07-01T00:00:00Z", leaseOwner: "run-etf", leaseExpiresAt: "2026-07-18T00:00:00Z" });
  await failTdccContinuousWork({ db, symbol: "2330.TW", owner: "run-stock", reason: "captcha page secret=hidden", now: "2026-07-17T00:00:00Z" });
  await failTdccContinuousWork({ db, symbol: "00919.TW", owner: "run-etf", reason: "HTTP 429 token=hidden", retryable: true, now: "2026-07-17T00:00:00Z" });
  const stock = await readTdccContinuousSymbolStatus(db, "2330.TW");
  const etf = await readTdccContinuousSymbolStatus(db, "00919.TW");
  assert.equal(stock.status, "blocked");
  assert.equal(stock.lastErrorCode, "captcha_or_blocked");
  assert.equal(etf.status, "partial");
  assert.equal(etf.lastErrorCode, "rate_limited");
  assert.equal(etf.nextRetryAt, "2026-07-17T06:00:00.000Z");
  assert.equal(JSON.stringify({ stock, etf }).includes("secret=hidden"), false);
});

function tdccRows(symbols, dataDate = "20260710") {
  const rows = [];
  for (const symbol of symbols) {
    const code = symbol.replace(/\.(TW|TWO)$/, "");
    for (let level = 1; level <= 17; level += 1) rows.push({
      "資料日期": dataDate,
      "證券代號": code,
      "持股分級": String(level),
      "持股數分級": level === 16 ? "差異調整" : level === 17 ? "合計" : `級距 ${level}`,
      "人數": String(level === 17 ? 15 : level === 16 ? 0 : 1),
      "股數": String(level === 17 ? 15000 : level === 16 ? 0 : 1000),
      "占集保庫存數比例%": level === 17 ? "15.00" : level === 16 ? "0.00" : "1.00",
    });
  }
  while (rows.length < 1000) rows.push({ "資料日期": dataDate, "證券代號": `X${String(rows.length).padStart(4, "0")}` });
  return rows;
}

test("latest-refresh endpoint 無前端流量也保存新週、同週重跑冪等且共用 single-flight", async (t) => {
  const db = continuousDb();
  t.after(() => db.close());
  const setup = `| 頁籤 | 分組 | 預設排序 | 代號 | 名稱 | 資料源 | 啟用 |\n|---|---|---|---|---|---|---|\n| 台股 | 個股 | 1 | 2330.TW | 台積電 | yfinance | yes |\n| 台股 | ETF | 2 | 00919.TW | 群益台灣精選高息 | yfinance | yes |`;
  const env = {
    DB: db,
    TDCC_CONTINUOUS_BACKFILL_SECRET: "test-secret",
    TDCC_HISTORY_AUTOMATION_ENABLED: "true",
    ASSETS: { fetch: async () => new Response(setup) },
  };
  const headers = { authorization: "Bearer test-secret", "content-type": "application/json" };
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("continuous-behavior", `${process.pid}-${Date.now()}`);
  const service = (await import(workerUrl.href)).default;
  const context = { waitUntil() {}, passThroughOnException() {} };
  const post = (body) => service.fetch(new Request("http://local/api/internal/tdcc-continuous-backfill", { method: "POST", headers, body: JSON.stringify(body) }), env, context);
  await post({ action: "start-run", runId: "integration-run", trigger: "workflow_dispatch" });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("openapi.tdcc.com.tw")) {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(JSON.stringify(tdccRows(["2330.TW", "00919.TW"])), { headers: { "content-type": "application/json" } });
    }
    return originalFetch(url, init);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const responses = await Promise.all([
    post({ action: "refresh-latest", runId: "integration-run" }),
    post({ action: "refresh-latest", runId: "integration-run" }),
  ]);
  assert.deepEqual(responses.map((response) => response?.status), [200, 200]);
  assert.equal(calls, 1);
  assert.equal(await db.prepare("SELECT COUNT(*) AS rows FROM taiwan_stock_shareholder_distribution").first("rows"), 2);
  const again = await post({ action: "refresh-latest", runId: "integration-run" });
  assert.equal(again?.status, 200);
  assert.equal(await db.prepare("SELECT COUNT(*) AS rows FROM taiwan_stock_shareholder_distribution").first("rows"), 2);
  const health = await readTdccContinuousHealth(db, new Date());
  assert.equal(health.latestDataDate, "2026-07-10");
});

test("record latest snapshot 只更新已返回 targets，且 latest 優先 heartbeat 可獨立完成", async (t) => {
  const db = continuousDb();
  t.after(() => db.close());
  await insertSymbol(db, { symbol: "2330.TW", firstSeenAt: "2026-07-01T00:00:00Z" });
  await insertSymbol(db, { symbol: "00919.TW", firstSeenAt: "2026-07-01T00:00:00Z" });
  await startTdccContinuousRun({ db, runId: "latest-first", trigger: "schedule", now: "2026-07-17T00:00:00Z" });
  assert.deepEqual(await recordTdccLatestSnapshot({ db, runId: "latest-first", dataDate: "2026-07-10", symbols: ["2330.TW", "2330.TW"], now: "2026-07-17T00:01:00Z" }), { dataDate: "2026-07-10", symbols: 1 });
  assert.equal((await readTdccContinuousSymbolStatus(db, "2330.TW")).latestSnapshotDate, "2026-07-10");
  assert.equal((await readTdccContinuousSymbolStatus(db, "00919.TW")).latestSnapshotDate, null);
  const health = await readTdccContinuousHealth(db, new Date("2026-07-17T00:02:00Z"));
  assert.equal(health.lastRunId, "latest-first");
  assert.equal(health.lastRunTrigger, "schedule");
  assert.equal(health.lastRunStatus, "running");
  assert.equal(health.latestDataDate, "2026-07-10");
  assert.equal(health.lastHeartbeatAt, "2026-07-17T00:01:00.000Z");
});

test("latest snapshot 晚於官方計畫時撤銷錯誤完成狀態，但保護 running／blocked 且不倒退日期", async (t) => {
  const db = continuousDb();
  t.after(() => db.close());
  for (const [symbol, status] of [["3008.TW", "completed"], ["2330.TW", "running"], ["2317.TW", "blocked"]]) {
    await insertSymbol(db, { symbol, status, firstSeenAt: "2026-08-01T00:00:00Z", leaseOwner: status === "running" ? "active-owner" : null, leaseExpiresAt: status === "running" ? "2026-08-30T00:00:00Z" : null });
    await db.prepare("UPDATE tdcc_continuous_symbols SET official_plan_through='2026-08-14',latest_snapshot_date='2026-08-14',expected_weeks=51,completed_weeks=51 WHERE symbol=?").bind(symbol).run();
    await db.prepare(`INSERT INTO taiwan_stock_shareholder_distribution
      (symbol,data_date,levels_json,adjustment_json,total_json,provider,frequency,source_fetched_at)
      VALUES (?,'2026-08-21','[]','{}','{}','tdcc','weekly','2026-08-22T00:00:00Z')`).bind(symbol).run();
  }
  await recordTdccLatestSnapshot({ db, dataDate: "2026-08-21", symbols: ["3008.TW", "2330.TW", "2317.TW"], now: "2026-08-22T00:01:00Z" });
  assert.equal((await readTdccContinuousSymbolStatus(db, "3008.TW")).status, "partial");
  assert.equal((await readTdccContinuousSymbolStatus(db, "2330.TW")).status, "running");
  assert.equal((await readTdccContinuousSymbolStatus(db, "2317.TW")).status, "blocked");
  await recordTdccLatestSnapshot({ db, dataDate: "2026-08-07", symbols: ["3008.TW"], now: "2026-08-22T00:02:00Z" });
  assert.equal((await readTdccContinuousSymbolStatus(db, "3008.TW")).latestSnapshotDate, "2026-08-21");
});

test("reconcile 以官方 51 日期重建大立光 ledger，重跑不增加 item 且只留下兩個真缺週", async (t) => {
  const db = continuousDb();
  t.after(() => db.close());
  await insertSymbol(db, { symbol: "3008.TW", status: "running", firstSeenAt: "2025-08-01T00:00:00Z", leaseOwner: "largan-run", leaseExpiresAt: "2026-08-30T00:00:00Z" });
  for (const row of savedDateRows(LARGAN_SAVED_DATES)) {
    await db.prepare(`INSERT INTO taiwan_stock_shareholder_distribution
      (symbol,data_date,levels_json,adjustment_json,total_json,provider,frequency,source_fetched_at)
      VALUES ('3008.TW',?, '[]','{}','{}','tdcc','weekly','2026-08-22T00:00:00Z')`).bind(row.data_date).run();
  }
  const first = await planTdccContinuousDates({ db, symbol: "3008.TW", owner: "largan-run", officialDates: OFFICIAL_TDCC_DATES, now: "2026-08-22T00:01:00Z" });
  assert.deepEqual(first.missingDates, ["2026-08-07", "2026-08-14"]);
  assert.equal(first.completedWeeks, 49);
  assert.equal(first.officialPlanThrough, "2026-08-21");
  await db.prepare("UPDATE tdcc_continuous_items SET updated_at='2000-01-01 00:00:00' WHERE symbol='3008.TW'").run();
  const repeated = await planTdccContinuousDates({ db, symbol: "3008.TW", owner: "largan-run", officialDates: OFFICIAL_TDCC_DATES, now: "2026-08-22T00:02:00Z" });
  assert.deepEqual(repeated.missingDates, first.missingDates);
  assert.equal(await db.prepare("SELECT COUNT(*) AS rows FROM tdcc_continuous_items WHERE symbol='3008.TW'").first("rows"), 51);
  assert.equal(await db.prepare("SELECT COUNT(*) AS rows FROM tdcc_continuous_items WHERE symbol='3008.TW' AND updated_at!='2000-01-01 00:00:00'").first("rows"), 0);
});

test("晶呈科技只有最新一週時 reconcile 建立完整 51 週 ledger 並保留 50 個可續跑缺週", async (t) => {
  const db = continuousDb();
  t.after(() => db.close());
  await insertSymbol(db, { symbol: "4768.TWO", status: "running", firstSeenAt: "2026-08-21T00:00:00Z", leaseOwner: "aemc-run", leaseExpiresAt: "2026-08-30T00:00:00Z" });
  await db.prepare(`INSERT INTO taiwan_stock_shareholder_distribution
    (symbol,data_date,levels_json,adjustment_json,total_json,provider,frequency,source_fetched_at)
    VALUES ('4768.TWO',?, '[]','{}','{}','tdcc','weekly','2026-08-22T00:00:00Z')`).bind(AEMC_SAVED_DATES[0]).run();
  const plan = await planTdccContinuousDates({ db, symbol: "4768.TWO", owner: "aemc-run", officialDates: OFFICIAL_TDCC_DATES, now: "2026-08-22T00:01:00Z" });
  assert.equal(plan.expectedWeeks, 51);
  assert.equal(plan.completedWeeks, 1);
  assert.equal(plan.missingDates.length, 50);
  assert.equal(await db.prepare("SELECT COUNT(*) AS rows FROM tdcc_continuous_items WHERE symbol='4768.TWO'").first("rows"), 51);
});

test("逐 symbol evidence bounded，且 fresh global run 不掩蓋 missing／reconcile／handoff overdue", async (t) => {
  const db = continuousDb();
  t.after(() => db.close());
  await insertSymbol(db, { symbol: "4768.TWO", status: "queued", firstSeenAt: "2026-08-28T00:00:00Z" });
  const missing = OFFICIAL_TDCC_DATES.slice(0, 13).sort();
  await db.prepare(`UPDATE tdcc_continuous_symbols SET expected_weeks=51,completed_weeks=1,missing_dates_json=?,official_plan_through='2026-08-14',latest_snapshot_date='2026-08-21',coverage_verified_at='2026-08-28T00:00:00Z' WHERE symbol='4768.TWO'`).bind(JSON.stringify(missing)).run();
  await startTdccContinuousRun({ db, runId: "fresh-run", trigger: "schedule", now: "2026-08-28T01:00:00Z" });
  const symbol = await readTdccContinuousSymbolStatus(db, "4768.TWO");
  assert.equal(symbol.missingWeeks, 13);
  assert.equal(symbol.missingDates.length, 12);
  assert.equal(symbol.queuedSince, "2026-08-28T00:00:00Z");
  assert.equal(symbol.handoff.status, "pending");
  const health = await readTdccContinuousHealth(db, new Date("2026-08-28T01:00:30Z"));
  assert.equal(health.status, "degraded");
  assert.equal(health.missingTargetSymbols, 1);
  assert.equal(health.reconciliationRequiredSymbols, 1);
  assert.equal(health.handoffOverdueSymbols, 1);
});

test("queue-only probe 無工作安全 no-op，且只計入可重試、lease 已到期的 target", async (t) => {
  const db = continuousDb();
  t.after(() => db.close());
  const empty = await probeTdccContinuousQueue({ db, now: "2026-08-28T01:00:00Z" });
  assert.deepEqual(empty, { checkedAt: "2026-08-28T01:00:00.000Z", handoffSeconds: 300, runnableTargets: 0, overdueTargets: 0, oldestQueuedAt: null, shouldRun: false });
  await insertSymbol(db, { symbol: "4768.TWO", status: "queued", firstSeenAt: "2026-08-28T00:50:00Z" });
  await insertSymbol(db, { symbol: "2330.TW", status: "running", firstSeenAt: "2026-08-28T00:00:00Z", leaseOwner: "live", leaseExpiresAt: "2026-08-28T02:00:00Z" });
  await insertSymbol(db, { symbol: "2317.TW", status: "failed", firstSeenAt: "2026-08-28T00:00:00Z" });
  await db.prepare("UPDATE tdcc_continuous_symbols SET next_retry_at='2026-08-28T02:00:00Z' WHERE symbol='2317.TW'").run();
  const queued = await probeTdccContinuousQueue({ db, now: "2026-08-28T01:00:00Z" });
  assert.equal(queued.shouldRun, true);
  assert.equal(queued.runnableTargets, 1);
  assert.equal(queued.overdueTargets, 1);
  assert.equal(queued.oldestQueuedAt, "2026-08-28T00:00:00Z");
});
