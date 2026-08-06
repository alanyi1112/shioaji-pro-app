import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildProvisionalPeRiverCandidates,
  discoverPeRiverTargets,
  joinFinMindPeHistory,
  latestFirstPlan,
  mergePreferredPeRows,
  parseTpexDailySnapshot,
  parseTwseDailySnapshot,
  parseTwseDailySnapshotBundle,
  provisionalPeRiverDateRange,
  reconcileProvisionalPeRiverRow,
  releaseFinMindBudget,
  resetPeRiverDataCachesForTest,
  reserveFinMindBudget,
  verifyProviderOverlap,
} from "../worker/pe-river-data-pipeline.ts";
import {
  completePeRiverHistoryTarget,
  readPeRiverContinuousHealth,
  refreshPeRiverOfficialLatest,
  startPeRiverContinuousRun,
} from "../worker/pe-river-continuous-backfill.ts";
import { ingestNormalizedPeRiverMonth, ingestProvisionalPeRiverRows, readPeRiverRows } from "../worker/taiwan-stock-pe-river.ts";
import { ensurePeRiverPipelineColumns } from "../worker/pe-river-schema.ts";
import { SqliteD1, applyDrizzleSql } from "./helpers/sqlite-d1.mjs";

const finmind = JSON.parse(await readFile(new URL("./fixtures/finmind-pe-river.json", import.meta.url), "utf8"));
const official = JSON.parse(await readFile(new URL("./fixtures/official-pe-daily.json", import.meta.url), "utf8"));
const provisionalFixture = JSON.parse(await readFile(new URL("./fixtures/provisional-pe-river.json", import.meta.url), "utf8"));
const migrations = await Promise.all([
  readFile(new URL("../drizzle/0011_blue_typhoid_mary.sql", import.meta.url), "utf8"),
  readFile(new URL("../drizzle/0012_pe_river_pipeline.sql", import.meta.url), "utf8"),
  readFile(new URL("../drizzle/0013_public_warstar.sql", import.meta.url), "utf8"),
]);
const cloudflareRuntimeMigration = await readFile(new URL("../drizzle/0018_cloudflare_pe_runtime_columns.sql", import.meta.url), "utf8");

async function pipelineDb() {
  const db = new SqliteD1();
  migrations.forEach((migration) => applyDrizzleSql(db, migration));
  await ensurePeRiverPipelineColumns(db);
  db.exec("CREATE TABLE user_instruments (user_id TEXT NOT NULL,symbol TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',provider TEXT NOT NULL DEFAULT '',tab_id TEXT NOT NULL DEFAULT '',tab_label TEXT NOT NULL DEFAULT '',group_name TEXT NOT NULL DEFAULT '',market TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 1,sort_order INTEGER,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,symbol,tab_id))");
  db.exec("CREATE TABLE instrument_catalog (symbol TEXT NOT NULL,exchange TEXT NOT NULL,localized_name TEXT NOT NULL DEFAULT '',english_name TEXT NOT NULL DEFAULT '',aliases_json TEXT NOT NULL DEFAULT '[]',normalized_search TEXT NOT NULL DEFAULT '',market TEXT NOT NULL DEFAULT '',group_name TEXT NOT NULL DEFAULT '',quote_type TEXT NOT NULL DEFAULT '',provider TEXT NOT NULL DEFAULT '',source TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,source_updated_at TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(symbol,exchange))");
  return db;
}

function provisionalRows() {
  return provisionalFixture.finmindRows.map((row) => ({
    exchange: "TWSE",
    symbol: provisionalFixture.symbol,
    ...row,
    referenceEps: row.officialClose / row.officialPeRatio,
    fiscalYear: null,
    fiscalQuarter: null,
    source: "finmind",
    provider: "finmind",
    validationStatus: "finmind_pending_verification",
    officialOverlapDate: null,
    sourceDate: row.sessionDate,
    fetchedAt: "2026-07-27T11:00:00Z"
  }));
}

function latestFetch(twseRows) {
  return async (input) => {
    const url = String(input);
    if (url.includes("BWIBBU_d")) return new Response(JSON.stringify(twseRows), { status: 200 });
    if (url.includes("peratio_analysis")) return new Response(JSON.stringify(official.tpexPe), { status: 200 });
    if (url.includes("tpex_mainboard_quotes")) return new Response(JSON.stringify(official.tpexClose), { status: 200 });
    if (url.includes("TaiwanStockPER")) return new Response(JSON.stringify(finmind.twse.per), { status: 200 });
    if (url.includes("TaiwanStockPrice")) return new Response(JSON.stringify(finmind.twse.price), { status: 200 });
    return new Response("{}", { status: 404 });
  };
}

test("D1 test double 嚴格拒絕 placeholder 與 bind 數量不一致", () => {
  const db = new SqliteD1();
  try {
    assert.throws(() => db.prepare("SELECT ? AS first, ? AS second").bind(1), /D1_BIND_COUNT_MISMATCH expected=2 actual=1/);
  } finally { db.close(); }
});

test("pipeline migration 可套用於已由 runtime 建立 control table 的既有 D1", async () => {
  const db = new SqliteD1();
  try {
    applyDrizzleSql(db, migrations[0]);
    db.exec("CREATE TABLE taiwan_stock_pe_control (control_key TEXT PRIMARY KEY NOT NULL, scheduler_heartbeat_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    applyDrizzleSql(db, migrations[1]);
    applyDrizzleSql(db, migrations[1]);
    applyDrizzleSql(db, migrations[2]);
    await ensurePeRiverPipelineColumns(db);
    const columns = await db.prepare("PRAGMA table_info(taiwan_stock_pe_fetch_state)").all();
    assert.equal(columns.results.some((column) => column.name === "latest_source_date"), true);
    assert.equal(columns.results.some((column) => column.name === "verified_end"), true);
  } finally { db.close(); }
});

test("Cloudflare deploy-time migration 補齊過去由 Sites runtime 建立的本益比欄位", async () => {
  const db = new SqliteD1();
  try {
    migrations.forEach((migration) => applyDrizzleSql(db, migration));
    applyDrizzleSql(db, cloudflareRuntimeMigration);
    const expected = {
      taiwan_stock_pe_valuation_daily: ["provider", "original_source", "validation_status", "official_overlap_date"],
      taiwan_stock_pe_fetch_state: ["latest_source_date", "provider_verified_at", "lane"],
      taiwan_stock_pe_backfill_job: ["lane", "latest_source_date", "provider_verified_at"],
      taiwan_stock_pe_backfill_month: ["dataset_status_json", "ingest_cursor"],
    };
    for (const [table, names] of Object.entries(expected)) {
      const columns = await db.prepare(`PRAGMA table_info(${table})`).all();
      const actual = new Set(columns.results.map((column) => column.name));
      assert.equal(names.every((name) => actual.has(name)), true, table);
    }
  } finally { db.close(); }
});

test("FinMind PER 與收盤依 sessionDate join，亂序、缺值與負 P/E 保留 gap", () => {
  const rows = joinFinMindPeHistory({ symbol: finmind.twse.symbol, pePayload: finmind.twse.per, pricePayload: finmind.twse.price, fetchedAt: "2026-07-22T12:00:00Z" });
  assert.deepEqual(rows.map((row) => row.sessionDate), ["2026-07-21", "2026-07-22"]);
  assert.equal(rows[0].referenceEps, 2410 / 32.4);
  assert.equal(rows[0].validationStatus, "finmind_pending_verification");
  assert.equal(joinFinMindPeHistory({ symbol: "2330.TW", pePayload: finmind.invalid.per, pricePayload: finmind.invalid.price }).length, 0);
});

test("TWSE、TPEx 官方最新快照解析收盤、本益比、民國日期與財報年季", () => {
  const twse = parseTwseDailySnapshot(official.twse);
  const twseBundle = parseTwseDailySnapshotBundle(official.twse);
  const tpex = parseTpexDailySnapshot(official.tpexPe, official.tpexClose);
  assert.equal(twse.length, 1);
  assert.deepEqual(twseBundle.gaps, [{ exchange: "TWSE", symbol: "1101.TW", sessionDate: "2026-07-21", officialClose: 24.05, source: "twse", reasonCode: "official_gap" }]);
  assert.deepEqual([twse[0].sessionDate, twse[0].officialClose, twse[0].fiscalYear, twse[0].fiscalQuarter], ["2026-07-21", 2410, "2026", "1"]);
  assert.deepEqual([tpex[0].sessionDate, tpex[0].officialClose, tpex[0].officialPeRatio], ["2026-07-22", 194.5, 20.2]);
});

test("最近共同交易日以 0.01 核對，官方延遲與 mismatch 都不冒充 verified", () => {
  const history = joinFinMindPeHistory({ symbol: finmind.twse.symbol, pePayload: finmind.twse.per, pricePayload: finmind.twse.price });
  const officialRows = parseTwseDailySnapshot(official.twse);
  assert.deepEqual(verifyProviderOverlap(history, officialRows), { status: "finmind_overlap_verified", overlapDate: "2026-07-21", peDifference: 0, closeDifference: 0 });
  assert.equal(verifyProviderOverlap(history, officialRows.map((row) => ({ ...row, officialClose: row.officialClose + 0.02 }))).status, "source_mismatch");
  assert.equal(verifyProviderOverlap(history, []).status, "official_not_published");
});

test("provisional latest 只接受盤後同日資料、最多三個 session，14 日外 fail closed", () => {
  assert.equal(provisionalPeRiverDateRange("2026-07-21", new Date("2026-07-22T10:00:00Z")).status, "ready");
  assert.equal(provisionalPeRiverDateRange("2026-07-01", new Date("2026-07-22T12:00:00Z")).status, "provisional_capped");
  assert.equal(provisionalPeRiverDateRange("2026-07-22", new Date("2026-07-22T12:00:00Z")).status, "not_needed");

  const beforeClose = buildProvisionalPeRiverCandidates({ historyRows: provisionalRows().slice(0, 2), officialSourceDate: "2026-07-21", now: new Date("2026-07-22T10:29:00Z"), enabled: true });
  assert.equal(beforeClose.rows.length, 0);
  const afterClose = buildProvisionalPeRiverCandidates({ historyRows: provisionalRows(), officialSourceDate: "2026-07-21", now: new Date("2026-07-27T11:00:00Z"), enabled: true });
  assert.equal(afterClose.status, "provisional_capped");
  assert.deepEqual(afterClose.rows.map((row) => row.sessionDate), ["2026-07-22", "2026-07-23", "2026-07-24"]);
  assert.equal(afterClose.rows.every((row) => row.validationStatus === "finmind_provisional_latest"), true);
});

test("provisional 追認逐項使用 0.01 absolute difference，0.011 進入 mismatch", () => {
  const provisional = { ...provisionalRows()[1], validationStatus: "finmind_provisional_latest" };
  const officialBase = { ...provisional, source: "twse", provider: "twse", validationStatus: "official_verified" };
  const matched = reconcileProvisionalPeRiverRow(provisional, { ...officialBase, ...provisionalFixture.officialMatch });
  assert.deepEqual(matched, { status: "official_verified", peDifference: 0.01, closeDifference: 0.01 });
  assert.equal(reconcileProvisionalPeRiverRow(provisional, { ...officialBase, ...provisionalFixture.officialMismatch }).status, "source_mismatch");
  assert.equal(reconcileProvisionalPeRiverRow(provisional, { ...officialBase, sessionDate: "2026-07-23" }).status, "official_not_published");
});

test("provisional D1 寫入原子分離 verifiedEnd 與 displayEnd，重跑不覆蓋官方", async () => {
  const db = await pipelineDb();
  try {
    const verified = { ...provisionalRows()[0], source: "twse", provider: "twse", validationStatus: "official_verified" };
    await ingestNormalizedPeRiverMonth({ db, symbol: verified.symbol, month: "2026-07", rows: [verified] });
    const candidates = buildProvisionalPeRiverCandidates({ historyRows: provisionalRows().slice(0, 2), officialSourceDate: "2026-07-21", now: new Date("2026-07-22T11:00:00Z"), enabled: true });
    const first = await ingestProvisionalPeRiverRows({ db, symbol: verified.symbol, rows: candidates.rows, officialSourceDate: "2026-07-21", status: "pending", now: new Date("2026-07-22T11:01:00Z") });
    assert.equal(first.accepted, 1);
    const state = await db.prepare("SELECT verified_end,display_end,provisional_dates_json FROM taiwan_stock_pe_fetch_state WHERE symbol=?").bind(verified.symbol).first();
    assert.deepEqual([state.verified_end, state.display_end, JSON.parse(state.provisional_dates_json)], ["2026-07-21", "2026-07-22", ["2026-07-22"]]);
    await ingestProvisionalPeRiverRows({ db, symbol: verified.symbol, rows: candidates.rows, officialSourceDate: "2026-07-21", status: "pending", now: new Date("2026-07-22T11:02:00Z") });
    assert.equal((await readPeRiverRows(db, verified.symbol)).length, 2);
  } finally { db.close(); }
});

test("provisional D1 狀態更新失敗時 valuation row 一併 rollback", async () => {
  const db = await pipelineDb();
  try {
    const verified = { ...provisionalRows()[0], source: "twse", provider: "twse", validationStatus: "official_verified" };
    await ingestNormalizedPeRiverMonth({ db, symbol: verified.symbol, month: "2026-07", rows: [verified] });
    const candidates = buildProvisionalPeRiverCandidates({ historyRows: provisionalRows().slice(0, 2), officialSourceDate: "2026-07-21", now: new Date("2026-07-22T11:00:00Z"), enabled: true });
    db.exec("CREATE TRIGGER fail_provisional_state BEFORE UPDATE OF provisional_status ON taiwan_stock_pe_fetch_state WHEN NEW.provisional_status='pending' BEGIN SELECT RAISE(ABORT, 'forced_provisional_state'); END");
    await assert.rejects(ingestProvisionalPeRiverRows({ db, symbol: verified.symbol, rows: candidates.rows, officialSourceDate: "2026-07-21", status: "pending", now: new Date("2026-07-22T11:01:00Z") }), /forced_provisional_state/);
    assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM taiwan_stock_pe_valuation_daily WHERE session_date='2026-07-22'").first("count"), 0);
    assert.equal((await db.prepare("SELECT display_end FROM taiwan_stock_pe_fetch_state WHERE symbol='2330.TW'").first()).display_end, "2026-07-21");
  } finally { db.close(); }
});

test("latest lane 完成官方 D-1、FinMind D 暫代，再由官方 D 原子追認", async () => {
  const db = await pipelineDb();
  try {
    db.exec("INSERT INTO user_instruments (user_id,symbol,enabled) VALUES ('u','2330.TW',1)");
    resetPeRiverDataCachesForTest();
    const pending = await refreshPeRiverOfficialLatest({ db, runId: "provisional-run-1", fetchImpl: latestFetch(official.twse), now: new Date("2026-07-22T11:00:00Z"), provisionalEnabled: true });
    assert.equal(pending.provisionalAccepted, 1);
    const pendingState = await db.prepare("SELECT verified_end,display_end,official_source_date,provisional_status FROM taiwan_stock_pe_fetch_state WHERE symbol='2330.TW'").first();
    assert.deepEqual({ ...pendingState }, { verified_end: "2026-07-21", display_end: "2026-07-22", official_source_date: "2026-07-21", provisional_status: "pending" });
    assert.equal((await db.prepare("SELECT validation_status FROM taiwan_stock_pe_valuation_daily WHERE symbol='2330.TW' AND session_date='2026-07-22'").first()).validation_status, "finmind_provisional_latest");
    let repeatedFinMindCalls = 0;
    const repeatedFetch = async (input, init) => {
      if (String(input).includes("api.finmindtrade.com")) repeatedFinMindCalls += 1;
      return latestFetch(official.twse)(input, init);
    };
    const repeated = await refreshPeRiverOfficialLatest({ db, runId: "provisional-run-repeat", fetchImpl: repeatedFetch, now: new Date("2026-07-22T15:00:00Z"), provisionalEnabled: true });
    assert.equal(repeated.provisional[0].status, "deduped");
    assert.equal(repeatedFinMindCalls, 0);

    const caughtUp = [{ Date: "20260722", Code: "2330", ClosePrice: "2400.00", PEratio: "32.27", FiscalYearQuarter: "2026Q1" }];
    resetPeRiverDataCachesForTest();
    const promoted = await refreshPeRiverOfficialLatest({ db, runId: "provisional-run-2", fetchImpl: latestFetch(caughtUp), now: new Date("2026-07-22T15:30:00Z"), provisionalEnabled: true });
    assert.equal(promoted.provisionalAccepted, 0);
    const promotedRow = await db.prepare("SELECT provider,validation_status,official_close,official_pe_ratio FROM taiwan_stock_pe_valuation_daily WHERE symbol='2330.TW' AND session_date='2026-07-22'").first();
    assert.deepEqual({ ...promotedRow }, { provider: "twse", validation_status: "official_verified", official_close: 2400, official_pe_ratio: 32.27 });
    const promotedState = await db.prepare("SELECT verified_end,display_end,provisional_dates_json,provisional_status,provisional_quarantined FROM taiwan_stock_pe_fetch_state WHERE symbol='2330.TW'").first();
    assert.deepEqual({ ...promotedState }, { verified_end: "2026-07-22", display_end: "2026-07-22", provisional_dates_json: "[]", provisional_status: null, provisional_quarantined: 0 });
  } finally { resetPeRiverDataCachesForTest(); db.close(); }
});

test("官方到齊但超過 0.01 時仍以官方值取代，並 quarantine 後續 provisional", async () => {
  const db = await pipelineDb();
  try {
    db.exec("INSERT INTO user_instruments (user_id,symbol,enabled) VALUES ('u','2330.TW',1)");
    resetPeRiverDataCachesForTest();
    await refreshPeRiverOfficialLatest({ db, runId: "mismatch-run-1", fetchImpl: latestFetch(official.twse), now: new Date("2026-07-22T11:00:00Z"), provisionalEnabled: true });
    const mismatchOfficial = [{ Date: "20260722", Code: "2330", ClosePrice: "2400.011", PEratio: "32.27", FiscalYearQuarter: "2026Q1" }];
    resetPeRiverDataCachesForTest();
    await refreshPeRiverOfficialLatest({ db, runId: "mismatch-run-2", fetchImpl: latestFetch(mismatchOfficial), now: new Date("2026-07-22T15:30:00Z"), provisionalEnabled: true });
    const row = await db.prepare("SELECT provider,validation_status,official_close FROM taiwan_stock_pe_valuation_daily WHERE symbol='2330.TW' AND session_date='2026-07-22'").first();
    assert.equal(row.provider, "twse");
    assert.equal(row.validation_status, "official_verified");
    assert.equal(row.official_close, 2400.011);
    const state = await db.prepare("SELECT reason_code,provisional_status,provisional_quarantined,mismatch_date,mismatch_close_difference FROM taiwan_stock_pe_fetch_state WHERE symbol='2330.TW'").first();
    assert.deepEqual({ ...state }, { reason_code: "source_mismatch", provisional_status: "source_mismatch", provisional_quarantined: 1, mismatch_date: "2026-07-22", mismatch_close_difference: 0.011 });
  } finally { resetPeRiverDataCachesForTest(); db.close(); }
});

test("官方同日明確無有效 P/E 時保留 official gap 並移除 provisional 可見點", async () => {
  const db = await pipelineDb();
  try {
    db.exec("INSERT INTO user_instruments (user_id,symbol,enabled) VALUES ('u','1101.TW',1)");
    await ingestNormalizedPeRiverMonth({ db, symbol: "1101.TW", month: "2026-07", rows: [{ sessionDate: "2026-07-21", officialClose: 24.05, officialPeRatio: 12, source: "finmind", provider: "finmind", validationStatus: "finmind_provisional_latest", sourceDate: "2026-07-21" }] });
    resetPeRiverDataCachesForTest();
    await refreshPeRiverOfficialLatest({ db, runId: "gap-run-1", fetchImpl: latestFetch(official.twse), now: new Date("2026-07-22T11:00:00Z"), provisionalEnabled: false });
    const row = await db.prepare("SELECT provider,validation_status FROM taiwan_stock_pe_valuation_daily WHERE symbol='1101.TW' AND session_date='2026-07-21'").first();
    assert.deepEqual({ ...row }, { provider: "twse", validation_status: "official_gap" });
    const state = await db.prepare("SELECT reason_code,provisional_status,display_end FROM taiwan_stock_pe_fetch_state WHERE symbol='1101.TW'").first();
    assert.deepEqual({ ...state }, { reason_code: "official_gap", provisional_status: null, display_end: null });
  } finally { resetPeRiverDataCachesForTest(); db.close(); }
});

test("官方 verified row 優先，FinMind retry 不得覆蓋同日官方資料", () => {
  const finMindRow = joinFinMindPeHistory({ symbol: finmind.twse.symbol, pePayload: finmind.twse.per, pricePayload: finmind.twse.price })[0];
  const officialRow = parseTwseDailySnapshot(official.twse)[0];
  const merged = mergePreferredPeRows([officialRow], [{ ...finMindRow, fetchedAt: "2027-01-01T00:00:00Z" }]);
  assert.equal(merged[0].source, "twse");
  assert.equal(merged[0].validationStatus, "official_verified");
});

test("D1 全域免費額度原子保留、上限等待、release 與小時 rollover", async () => {
  const db = await pipelineDb();
  try {
    const first = await reserveFinMindBudget(db, 16, new Date("2026-07-22T10:15:00Z"), 20);
    const denied = await reserveFinMindBudget(db, 6, new Date("2026-07-22T10:20:00Z"), 20);
    assert.equal(first.reserved, true);
    assert.equal(denied.reserved, false);
    await releaseFinMindBudget(db, 2, first.windowStart);
    assert.equal((await reserveFinMindBudget(db, 6, new Date("2026-07-22T10:25:00Z"), 20)).reserved, true);
    const rolled = await reserveFinMindBudget(db, 2, new Date("2026-07-22T11:00:00Z"), 20);
    assert.equal(rolled.used, 2);
  } finally { db.close(); }
});

test("target discovery 排除 ETF 並建立 latest-first、最多 8 個 history targets", async () => {
  const db = await pipelineDb();
  try {
    db.exec("INSERT INTO user_instruments (user_id,symbol,enabled) VALUES ('u','2330.TW',1),('u','8069.TWO',1),('u','0050.TW',1)");
    const targets = await discoverPeRiverTargets(db);
    assert.deepEqual(targets.map((target) => target.symbol), ["2330.TW", "8069.TWO"]);
    const plan = latestFirstPlan(targets, Array.from({ length: 12 }, (_, index) => ({ symbol: `99${String(index).padStart(2, "0")}.TW` })));
    assert.deepEqual(plan.order, ["latest", "history"]);
    assert.equal(plan.history.length, 8);
  } finally { db.close(); }
});

test("history runner 只在 lease 過期後重新認領中斷的 running target", async () => {
  const db = await pipelineDb();
  try {
    db.exec("INSERT INTO user_instruments (user_id,symbol,enabled) VALUES ('u','8069.TWO',1)");
    const first = await startPeRiverContinuousRun({ db, runId: "lease-run-1", trigger: "workflow_dispatch", now: new Date("2026-07-22T11:30:00Z") });
    assert.equal(first.history.length, 1);
    assert.equal(first.history[0].attempt, 1);
    assert.equal((await startPeRiverContinuousRun({ db, runId: "lease-run-2", trigger: "workflow_dispatch", now: new Date("2026-07-22T11:31:00Z") })).history.length, 0);
    const resumed = await startPeRiverContinuousRun({ db, runId: "lease-run-3", trigger: "workflow_dispatch", now: new Date("2026-07-22T11:51:00Z") });
    assert.equal(resumed.history.length, 1);
    assert.equal(resumed.history[0].attempt, 2);
    assert.equal(resumed.history[0].leaseOwner, "lease-run-3");
  } finally { db.close(); }
});

test("無 panel 流量時 schedule 仍先 latest、claim history、保存 heartbeat 與 checkpoint", async () => {
  const db = await pipelineDb();
  try {
    db.exec("INSERT INTO user_instruments (user_id,symbol,enabled) VALUES ('u','2330.TW',1),('u','8069.TWO',1)");
    const run = await startPeRiverContinuousRun({ db, runId: "pe-run-1", trigger: "schedule", now: new Date("2026-07-22T11:30:00Z") });
    assert.deepEqual(run.order, ["latest", "history"]);
    assert.equal(run.latest.length, 2);
    assert.equal(run.history.length, 2);
    assert.equal(run.history[0].months.length, 61);
    assert.deepEqual(run.history[0].checkpoints[0].datasetStatus, {});
    assert.equal(run.history[0].checkpoints[0].attempt, 1);
    assert.equal((await startPeRiverContinuousRun({ db, runId: "pe-run-2", trigger: "schedule", now: new Date("2026-07-22T11:31:00Z") })).history.length, 0);
    const officialFetch = async (input) => {
      const url = String(input);
      if (url.includes("BWIBBU_d")) return new Response(JSON.stringify(official.twse), { status: 200 });
      if (url.includes("peratio_analysis")) return new Response(JSON.stringify(official.tpexPe), { status: 200 });
      if (url.includes("tpex_mainboard_quotes")) return new Response(JSON.stringify(official.tpexClose), { status: 200 });
      return new Response("{}", { status: 404 });
    };
    await ingestNormalizedPeRiverMonth({
      db,
      symbol: "2330.TW",
      month: "2026-07",
      rows: [{ sessionDate: "2026-07-21", officialClose: 2410, officialPeRatio: 32.4, source: "finmind", validationStatus: "finmind_pending_verification" }],
    });
    const latest = await refreshPeRiverOfficialLatest({ db, runId: "pe-run-1", fetchImpl: officialFetch, now: new Date("2026-07-22T11:32:00Z") });
    assert.equal(latest.accepted, 2);
    assert.equal(latest.promoted, 1);
    assert.equal((await db.prepare("SELECT validation_status FROM taiwan_stock_pe_valuation_daily WHERE symbol='2330.TW' AND session_date='2026-07-21'").first()).validation_status, "official_verified");
    const historyRows = Array.from({ length: 252 }, (_, index) => ({ sessionDate: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10), officialClose: 200, officialPeRatio: 20, source: "finmind", validationStatus: "finmind_overlap_verified", officialOverlapDate: "2026-07-21" }));
    for (const [month, rows] of Map.groupBy(historyRows, (row) => row.sessionDate.slice(0, 7))) await ingestNormalizedPeRiverMonth({ db, symbol: "2330.TW", month, rows });
    const checkpointRow = await db.prepare("SELECT dataset_status_json FROM taiwan_stock_pe_backfill_month WHERE symbol='2330.TW' AND status='complete' LIMIT 1").first();
    const checkpoint = JSON.parse(checkpointRow.dataset_status_json);
    assert.equal(checkpoint.PER.status, "complete");
    assert.equal(checkpoint.price.status, "complete");
    assert.equal(checkpoint.normalized.cursor, checkpoint.normalized.rowCount);
    const completed = await completePeRiverHistoryTarget({ db, runId: "pe-run-1", jobId: "pe-river:2330.TW", symbol: "2330.TW", validationStatus: "finmind_overlap_verified", overlapDate: "2026-07-21" });
    assert.equal(completed.status, "available");
    const health = await readPeRiverContinuousHealth(db);
    assert.equal(health.scheduler.lastLatestRunAt, "2026-07-22T11:32:00.000Z");
    assert.equal(health.latest.twseSourceDate, "2026-07-21");
    assert.equal(health.latest.tpexSourceDate, "2026-07-22");
  } finally { db.close(); }
});

test("history completion 使用嚴格 binding 並以 D1 batch 原子落地", async () => {
  const db = await pipelineDb();
  try {
    db.exec("INSERT INTO user_instruments (user_id,symbol,enabled) VALUES ('u','2330.TW',1)");
    const run = await startPeRiverContinuousRun({ db, runId: "atomic-run", trigger: "workflow_dispatch", now: new Date("2026-07-22T16:00:00Z") });
    assert.equal(run.history.length, 1);
    await ingestNormalizedPeRiverMonth({
      db,
      symbol: "2330.TW",
      month: "2026-07",
      rows: [{ sessionDate: "2026-07-21", officialClose: 2410, officialPeRatio: 32.4, source: "finmind", validationStatus: "finmind_overlap_verified", officialOverlapDate: "2026-07-21" }],
    });
    db.exec("CREATE TRIGGER fail_history_completion BEFORE UPDATE OF last_history_run_at ON taiwan_stock_pe_control WHEN NEW.last_history_run_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'forced_history_completion'); END");
    await assert.rejects(completePeRiverHistoryTarget({ db, runId: "atomic-run", jobId: "pe-river:2330.TW", symbol: "2330.TW", validationStatus: "finmind_overlap_verified", overlapDate: "2026-07-21", now: new Date("2026-07-22T16:05:00Z") }), /forced_history_completion/);
    const rolledBackJob = await db.prepare("SELECT status,lease_owner FROM taiwan_stock_pe_backfill_job WHERE job_id=?").bind("pe-river:2330.TW").first();
    assert.equal(rolledBackJob.status, "running");
    assert.equal(rolledBackJob.lease_owner, "atomic-run");
    assert.equal((await db.prepare("SELECT last_history_run_at FROM taiwan_stock_pe_control WHERE control_key='global'").first()).last_history_run_at, null);
    assert.equal((await db.prepare("SELECT latest_source_date FROM taiwan_stock_pe_fetch_state WHERE symbol=?").bind("2330.TW").first()).latest_source_date, null);

    db.exec("DROP TRIGGER fail_history_completion");
    const completed = await completePeRiverHistoryTarget({ db, runId: "atomic-run", jobId: "pe-river:2330.TW", symbol: "2330.TW", validationStatus: "finmind_overlap_verified", overlapDate: "2026-07-21", now: new Date("2026-07-22T16:06:00Z") });
    assert.equal(completed.status, "insufficient_history");
    const completedJob = await db.prepare("SELECT status,lease_owner FROM taiwan_stock_pe_backfill_job WHERE job_id=?").bind("pe-river:2330.TW").first();
    assert.equal(completedJob.status, "partial");
    assert.equal(completedJob.lease_owner, null);
    assert.equal((await db.prepare("SELECT latest_source_date FROM taiwan_stock_pe_fetch_state WHERE symbol=?").bind("2330.TW").first()).latest_source_date, "2026-07-21");
    assert.equal((await readPeRiverContinuousHealth(db)).scheduler.lastHistoryRunAt, "2026-07-22T16:06:00.000Z");
  } finally { db.close(); }
});
