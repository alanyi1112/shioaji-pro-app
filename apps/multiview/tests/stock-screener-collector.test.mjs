import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SqliteD1, applyDrizzleSql } from "./helpers/sqlite-d1.mjs";
import { collectScreenerData, readLocalScreenerHolders } from "../worker/stock-screener-collector.ts";
import { SCREENER_SOURCES } from "../worker/stock-screener-sources.ts";
import { handleLocalMaintenance } from "../worker/local-maintenance.ts";
import { handleStockScreener } from "../worker/stock-screener-route.ts";

const migration = await readFile(new URL("../drizzle/0027_pale_randall_flagg.sql", import.meta.url), "utf8");
const start = Date.parse("2026-08-31T12:00:00Z");
const codes = Array.from({ length: 53 }, (_, i) => String(1000 + i));
const universe = codes.map(code => ({ code, symbol: `${code}.TW`, name: `測試${code}`, market: "TWSE", kind: "ordinary" }));
const holderRows = code => Array.from({ length: 17 }, (_, i) => ({ "資料日期": "20260828", "證券代號": code, "持股分級": String(i + 1), "人數": i === 14 || i === 16 ? "1" : "0", "股數": i === 14 || i === 16 ? "1000001" : "0", "占集保庫存數比例%": i === 14 || i === 16 ? "100.00" : "0.00" }));
function fixtures() {
  return new Map([
    [SCREENER_SOURCES.TWSE.universe, codes.map(code => ({ "出表日期": "1150830", "公司代號": code, "公司簡稱": `測試${code}`, "上市日期": "20200101", "產業別": "24", "已發行普通股數或TDR原股發行股數": "1000001" }))],
    [SCREENER_SOURCES.TPEx.universe, [{ Date: "1150830", SecuritiesCompanyCode: "4768", CompanyAbbreviation: "測試上櫃", DateOfListing: "20200101", SecuritiesIndustryCode: "24", IssueShares: "1000001" }]],
    [SCREENER_SOURCES.TWSE.volume, codes.map(code => ({ Date: "1150831", Code: code, TradeVolume: "3000" }))],
    [SCREENER_SOURCES.TPEx.volume, [{ Date: "1150831", SecuritiesCompanyCode: "4768", TradingShares: "6000" }]],
    [SCREENER_SOURCES.tdcc, [...codes, "4768"].flatMap(holderRows)],
  ]);
}
function setup() {
  const db = new SqliteD1();
  applyDrizzleSql(db, migration);
  const payloads = fixtures(), calls = [];
  let now = start;
  const options = { clock: () => now, minimumUniverseRows: { TWSE: 1, TPEx: 1 }, fetcher: async url => { calls.push(url); assert.ok(payloads.has(url)); return Response.json(payloads.get(url)); } };
  return { db, payloads, calls, options, advance: ms => { now += ms; } };
}
const count = async (db, table) => (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n;
const run = async (db, scope) => JSON.parse((await db.prepare("SELECT checkpoint FROM screener_runs WHERE id=?").bind(scope).first()).checkpoint);

test('正式維護拒絕過小名冊，不把可解析的截斷回應當成全市場',async()=>{
  const {db,options}=setup();
  try {
    const productionOptions={...options,minimumUniverseRows:undefined};
    assert.equal((await collectScreenerData(db,'screener-daily',productionOptions)).reason,'invalid_universe_coverage');
    assert.equal(await count(db,'screener_universe'),0);
  }finally{db.close();}
});

test("獨立 daily／weekly 收集與 checkpoint；名冊未審核不發布、GET 零抓取", async () => {
  const { db, calls, options } = setup();
  try {
    const daily = await collectScreenerData(db, "screener-daily", options);
    assert.equal(daily.state, "collected");
    assert.equal(daily.receipts.TWSE.offset, 53);
    assert.equal(daily.receipts.TPEx.offset, 1);
    assert.equal(await count(db, "screener_daily_volume"), 54);
    const weekly = await collectScreenerData(db, "screener-weekly", options);
    assert.equal(weekly.receipts.TDCC.offset, 54);
    assert.equal(await count(db, "screener_tdcc_weekly"), 54);
    assert.equal(await count(db, "screener_snapshots"), 0);
    assert.equal(JSON.parse((await db.prepare("SELECT payload FROM screener_universe LIMIT 1").first()).payload).review, "verified");
    assert.equal(calls.length, 7);
    assert.equal((await collectScreenerData(db, "screener-daily", options)).reason, "backoff");
    const reads = calls.length;
    for (let i = 0; i < 3; i++) {
      const response = await handleStockScreener(new Request("http://127.0.0.1:5174/api/stock-screener/results?holder=false"), { DB: db, DEPLOYMENT_TARGET: "local" });
      assert.equal((await response.json()).reason, "bootstrap_pending");
    }
    assert.equal(calls.length, reads);
    assert.equal((await db.prepare("PRAGMA integrity_check").first()).integrity_check, "ok");
  } finally { db.close(); }
});

test("daily 第二批交易失敗時 checkpoint 不前進；重跑只續作未完成批次", async () => {
  const { db, options, advance } = setup();
  const batch = db.batch.bind(db);
  let writes = 0, fail = true;
  db.batch = statements => {
    if (statements[0]?.sql.startsWith("INSERT INTO screener_daily_volume")) {
      writes++;
      if (writes === 2 && fail) return Promise.reject(new Error("fixture_interrupt"));
    }
    return batch(statements);
  };
  try {
    assert.equal((await collectScreenerData(db, "screener-daily", options)).state, "pending");
    assert.equal(await count(db, "screener_daily_volume"), 50);
    assert.equal((await run(db, "screener-daily")).receipts.TWSE.offset, 50);
    advance(16 * 60000); fail = false; writes = 0;
    assert.equal((await collectScreenerData(db, "screener-daily", options)).state, "collected");
    assert.equal(writes, 2); // three remaining TWSE rows and the TPEx batch only
    assert.equal(await count(db, "screener_daily_volume"), 54);
  } finally { db.close(); }
});

test("兩 scope 共用 lease，來源失敗也先等另一個請求完成才釋放", async () => {
  const { db, options } = setup();
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  let requests = 0;
  options.fetcher = async () => { requests++; entered(); await held; throw new Error("fixture_network"); };
  try {
    const first = collectScreenerData(db, "screener-daily", options);
    await waiting;
    assert.equal((await collectScreenerData(db, "screener-weekly", options)).reason, "lease_busy");
    assert.equal(requests, 2);
    release();
    assert.equal((await first).state, "pending");
    assert.equal((await db.prepare("SELECT status FROM screener_runs WHERE id='screener-collector-lease'").first()).status, "idle");
  } finally { release(); db.close(); }
});

test("Retry-After 與每日最多三次失敗；翌日休眠恢復可再試，不 busy-loop", async () => {
  const { db, options } = setup();
  const retryStart = start - 8 * 3600000;
  let retryNow = retryStart;
  const advance = ms => { retryNow += ms; };
  options.clock = () => retryNow;
  let calls = 0;
  options.fetcher = async () => { calls++; return new Response("", { status: 429, headers: { "retry-after": "7200" } }); };
  try {
    const first = await collectScreenerData(db, "screener-weekly", options);
    assert.equal(first.reason, "source_http_429");
    assert.equal(Date.parse(first.nextAttemptAt), retryStart + 7200000);
    await collectScreenerData(db, "screener-weekly", options);
    assert.equal(calls, 2);
    for (let i = 0; i < 2; i++) { advance(7200000); await collectScreenerData(db, "screener-weekly", options); }
    advance(7200000);
    const saved = await run(db, "screener-weekly");
    assert.equal(saved.attempts, 3);
    assert.equal((await collectScreenerData(db, "screener-weekly", options)).reason, "retry_budget_exhausted");
    advance(24 * 3600000);
    assert.equal((await collectScreenerData(db, "screener-weekly", options)).reason, "source_http_429");
    assert.equal((await run(db, "screener-weekly")).attempts, 1);
  } finally { db.close(); }
});

test("未收盤／未來日期拒收，混期可累積但不發布，較新稀疏回應不清空舊列", async () => {
  const { db, payloads, options, advance } = setup();
  try {
    const early = { ...options, clock: () => Date.parse("2026-08-31T07:00:00Z") };
    assert.equal((await collectScreenerData(db, "screener-daily", early)).reason, "source_not_closed");
    assert.equal(await count(db, "screener_daily_volume"), 0);
    payloads.get(SCREENER_SOURCES.TPEx.volume)[0].Date = "1150828";
    assert.equal((await collectScreenerData(db, "screener-daily", options)).state, "collected");
    assert.equal(await count(db, "screener_snapshots"), 0);
    advance(6 * 3600000);
    payloads.set(SCREENER_SOURCES.TWSE.volume, [payloads.get(SCREENER_SOURCES.TWSE.volume)[0]]);
    await collectScreenerData(db, "screener-daily", options);
    assert.equal(await count(db, "screener_daily_volume"), 54);
    advance(6 * 3600000);
    payloads.get(SCREENER_SOURCES.TWSE.volume)[0].Date = "1150909";
    assert.equal((await collectScreenerData(db, "screener-daily", options)).reason, "source_future_date");
  } finally { db.close(); }
});

test("lease 過期後舊工作不寫底稿／checkpoint、不覆蓋繼任者", async () => {
  const { db, options, advance } = setup();
  const fetcher = options.fetcher;
  options.fetcher = async url => { advance(16 * 60000); return fetcher(url); };
  try {
    assert.equal((await collectScreenerData(db, "screener-daily", options)).reason, "run_deadline");
    assert.equal(await count(db, "screener_universe"), 0);
    assert.equal((await run(db, "screener-daily")).receipts.catalog, undefined);
  } finally { db.close(); }
});

test("TDCC 本機重用嚴格驗證17級、safe integer與最多六期，不新增長歷史工作", async () => {
  const { db } = setup();
  db.exec("CREATE TABLE taiwan_stock_shareholder_distribution (symbol TEXT,data_date TEXT,levels_json TEXT,adjustment_json TEXT,total_json TEXT,provider TEXT,frequency TEXT,source_fetched_at TEXT)");
  const bands = holderRows("1000").map(row => ({ level: Number(row["持股分級"]), holders: Number(row["人數"]), shares: Number(row["股數"]), ratioPercent: Number(row["占集保庫存數比例%"])}));
  const insert = (code, date, values = bands) => db.prepare("INSERT INTO taiwan_stock_shareholder_distribution VALUES (?,?,?,?,?,'tdcc','weekly',?)").bind(`${code}.TW`, date, JSON.stringify(values.slice(0,15)), JSON.stringify(values[15]), JSON.stringify(values[16]), "2026-08-28T12:00:00Z").run();
  try {
    await insert("1000", "2026-08-21");
    await insert("1000", "2026-08-14");
    await insert("1001", "2026-08-21", bands.map((b,i) => i === 14 ? { ...b, shares: Number.MAX_SAFE_INTEGER + 1 } : b));
    const before = await count(db, "taiwan_stock_shareholder_distribution");
    const rows = await readLocalScreenerHolders(db, universe, ["2026-08-21", "2026-08-14"]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].point.bands.length, 17);
    assert.equal(rows[0].point.date, "2026-08-21");
    assert.equal(rows[0].point.provenance.source, "TDCC");
    assert.equal(await count(db, "taiwan_stock_shareholder_distribution"), before);
    await assert.rejects(readLocalScreenerHolders(db, universe, ["2026-08-21", "2026-08-14", "2026-08-07", "2026-07-31", "2026-07-24", "2026-07-17", "2026-07-10"]), /invalid_reuse_dates/);
  } finally { db.close(); }
});

test("maintenance 新 scope 仍須本機、授權，不呼叫原 daily 或允許自訂 URL／期別", async () => {
  const secret = "fixture-only-".repeat(4), calls = [];
  const env = { DB: {}, LOCAL_PIPELINE_SECRET: secret, DEPLOYMENT_TARGET: "local" };
  const actions = { daily: async () => { throw new Error("not daily"); }, screener: async (_, scope) => { calls.push(scope); return { state: "pending" }; } };
  const request = body => new Request("http://127.0.0.1:5174/api/internal/local-maintenance", { method: "POST", headers: { "x-multiview-local-authorization": `Bearer ${secret}` }, body: JSON.stringify(body) });
  const ctx = { waitUntil() {} };
  for (const scope of ["screener-daily", "screener-weekly"]) assert.equal((await handleLocalMaintenance(request({ action: scope }), env, ctx, actions)).status, 200);
  assert.deepEqual(calls, ["screener-daily", "screener-weekly"]);
  assert.equal((await handleLocalMaintenance(request({ action: "screener-daily" }), { ...env, DEPLOYMENT_TARGET: "cloudflare" }, ctx, actions)).status, 403);
  for (const body of [null, [], { action: "screener-weekly", previousWeek: "2026-08-21" }, { action: "screener-daily", url: "http://evil" }]) assert.equal((await handleLocalMaintenance(request(body), env, ctx, actions)).status, 400);
});
