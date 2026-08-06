import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  WATCHLIST_CHIP_PREWARM_CONTRACT,
  discoverWatchlistChipWarmTargets,
  readWatchlistChipPrewarmHealth,
  watchlistChipWarmWindow,
} from "../worker/watchlist-chip-prewarming.ts";
import { latestCompletedTaiwanSessionDate } from "../worker/chip-backfill-orchestrator.ts";
import { isEligibleWatchlistTaiwanEquity } from "../worker/taiwan-stock-chip.ts";

const workerEntrySource = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
const workerAppSource = await readFile(new URL("../worker/app.ts", import.meta.url), "utf8");

class Query {
  constructor(db, sql) { this.db = db; this.sql = sql; }
  async all() {
    if (this.sql.includes("FROM tdcc_continuous_symbols")) return { results: this.db.symbols.map((symbol) => ({ symbol })) };
    if (this.sql.includes("FROM taiwan_stock_chip_fetch_state")) return { results: this.db.states };
    return { results: [] };
  }
  async first() {
    if (this.sql.includes("FROM tdcc_continuous_runs")) return this.db.run || null;
    return null;
  }
}

const db = (symbols, states = [], run = { heartbeat_at: "2026-07-17T11:00:00.000Z", status: "completed", error_code: null }) => ({ symbols, states, run, prepare(sql) { return new Query(this, sql); } });
const state = (symbol, dataset, overrides = {}) => ({
  symbol,
  dataset,
  coverage_start: "2024-07-17",
  coverage_end: "2026-07-17",
  source_date: "2026-07-17",
  status: "available",
  reason_code: "available",
  last_success_at: "2026-07-17T10:00:00.000Z",
  last_attempt_at: "2026-07-17T10:00:00.000Z",
  retry_after: null,
  ...overrides,
});

test("預熱契約固定最近兩年、四類日資料與有限 targets", () => {
  assert.deepEqual(WATCHLIST_CHIP_PREWARM_CONTRACT.datasets, ["institutional-flow", "foreign-holding", "margin-short", "securities-lending"]);
  assert.equal(WATCHLIST_CHIP_PREWARM_CONTRACT.lookbackDays, 730);
  assert.equal(WATCHLIST_CHIP_PREWARM_CONTRACT.maxTargetsPerRun, 40);
  assert.deepEqual(watchlistChipWarmWindow("2026-07-17T15:00:00.000Z"), { start: "2024-07-17", end: "2026-07-17" });
  assert.equal(latestCompletedTaiwanSessionDate("2026-07-18T04:00:00.000Z"), "2026-07-17");
  assert.equal(latestCompletedTaiwanSessionDate("2026-07-20T01:00:00.000Z"), "2026-07-17");
});

test("新增清單商品的 response 使用 waitUntil 預熱，不在 workflow 固定 symbol", () => {
  assert.match(workerEntrySource, /handleAppRequest\(request, env, ctx\)/);
  assert.match(workerAppSource, /context\.waitUntil\(/);
  assert.match(workerAppSource, /prewarmTaiwanStockChipSymbol/);
  assert.match(workerAppSource, /item\?\.enabled !== false/);
  assert.match(workerAppSource, /Durable GitHub scheduler will retry/);
  assert.match(workerAppSource, /await upsertTdccContinuousTarget\(\{ db: env\.DB, target: \{ symbol, source: "user" \} \}\)/);
  const scheduleStart = workerAppSource.indexOf("function scheduleWatchlistChipPrewarm");
  const registerStart = workerAppSource.indexOf("async function registerAndWarmTaiwanChipTarget", scheduleStart);
  const missingTargetStart = workerAppSource.indexOf("function scheduleMissingTaiwanChipTarget", registerStart);
  const saveStart = workerAppSource.indexOf("async function saveInstrument", missingTargetStart);
  const saveEnd = workerAppSource.indexOf("function parseReorderRequest", saveStart);
  const scheduleBody = workerAppSource.slice(scheduleStart, registerStart);
  const backgroundBody = workerAppSource.slice(registerStart, missingTargetStart);
  const saveBody = workerAppSource.slice(saveStart, saveEnd);
  assert.match(scheduleBody, /registerAndWarmTaiwanChipTarget/);
  assert.equal(backgroundBody.indexOf("upsertTdccContinuousTarget") < backgroundBody.indexOf("prewarmTaiwanStockChipSymbol"), true);
  assert.match(backgroundBody, /Promise\.allSettled/);
  assert.match(backgroundBody, /queueTdccContinuousSymbolBackfill/);
  assert.match(backgroundBody, /dispatchTdccContinuousWorkflow/);
  assert.match(backgroundBody, /DEPLOYMENT_TARGET/);
  assert.doesNotMatch(saveBody, /refreshTdccContinuousTargets|syncTdccContinuousTargets/);
  assert.match(saveBody, /scheduleWatchlistChipPrewarm\(request, env, normalizedItems, context\)/);
});

test("清單台股不會被缺少 quoteType 的舊商品目錄資料排除", () => {
  const localEntry = { symbol: "2330.TW", exchange: "TWSE", quoteType: "EQUITY", active: true };
  const staleCatalog = { symbol: "2330.TW", exchange: "TWSE", quoteType: "", active: true };
  assert.equal(isEligibleWatchlistTaiwanEquity(localEntry, staleCatalog), true);
});

test("missing 優先、symbol 去重、retry-after dataset 暫不重抓且遵守 limit", async () => {
  const datasets = WATCHLIST_CHIP_PREWARM_CONTRACT.datasets;
  const states = [
    ...datasets.map((dataset) => state("2330.TW", dataset)),
    state("00919.TW", "institutional-flow", { retry_after: "2026-07-18T00:00:00.000Z", status: "unavailable", last_success_at: null }),
    state("00919.TW", "margin-short", { coverage_start: "2025-01-01" }),
  ];
  const result = await discoverWatchlistChipWarmTargets({ db: db(["2330.TW", "00919.TW", "00919.TW", "AAPL"], states), limit: 1, now: "2026-07-17T15:00:00.000Z" });
  assert.equal(result.targetSymbols, 2);
  assert.equal(result.pendingSymbols, 1);
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].symbol, "00919.TW");
  assert.deepEqual(result.targets[0].datasets, ["foreign-holding", "margin-short", "securities-lending"]);
});

test("coverage 尾端未涵蓋預熱窗口時仍會排入回補", async () => {
  const states = WATCHLIST_CHIP_PREWARM_CONTRACT.datasets.map((dataset) => state("2330.TW", dataset));
  states[0].coverage_end = "2026-07-16";
  const result = await discoverWatchlistChipWarmTargets({ db: db(["2330.TW"], states), now: "2026-07-17T15:00:00.000Z" });
  assert.equal(result.pendingSymbols, 1);
  assert.deepEqual(result.targets[0].datasets, ["institutional-flow"]);
});

test("coverage_end 被請求範圍墊高但 source_date 落後時仍為 pending", async () => {
  const states = WATCHLIST_CHIP_PREWARM_CONTRACT.datasets.map((dataset) => state("2330.TW", dataset));
  states[0].source_date = "2026-07-16";
  const target = await discoverWatchlistChipWarmTargets({ db: db(["2330.TW"], states), now: "2026-07-17T15:00:00.000Z" });
  assert.deepEqual(target.targets[0].datasets, ["institutional-flow"]);
  const health = await readWatchlistChipPrewarmHealth(db(["2330.TW"], states), "2026-07-17T15:00:00.000Z");
  assert.equal(health.readySymbols, 0);
  assert.equal(health.pendingSymbols, 1);
});

test("完整且新鮮 coverage 為 ready，缺資料與等待重試為 pending", async () => {
  const datasets = WATCHLIST_CHIP_PREWARM_CONTRACT.datasets;
  const states = [
    ...datasets.map((dataset) => state("2330.TW", dataset)),
    state("00919.TW", "institutional-flow", { status: "unavailable", reason_code: "rate_limited", retry_after: "2026-07-18T00:00:00.000Z", last_success_at: null }),
  ];
  const health = await readWatchlistChipPrewarmHealth(db(["2330.TW", "00919.TW"], states), "2026-07-17T15:00:00.000Z");
  assert.equal(health.status, "warming");
  assert.equal(health.targetSymbols, 2);
  assert.equal(health.readySymbols, 1);
  assert.equal(health.pendingSymbols, 1);
  assert.equal(health.retryWaitingSymbols, 1);
  assert.equal(health.lastErrorCode, "rate_limited");
});

test("scheduler heartbeat 過期時 health 保留資料計數並標示 stale", async () => {
  const states = WATCHLIST_CHIP_PREWARM_CONTRACT.datasets.map((dataset) => state("2330.TW", dataset));
  const health = await readWatchlistChipPrewarmHealth(db(["2330.TW"], states, { heartbeat_at: "2026-07-15T00:00:00.000Z", status: "completed", error_code: null }), "2026-07-17T15:00:00.000Z");
  assert.equal(health.status, "scheduler_stale");
  assert.equal(health.readySymbols, 1);
  assert.equal(health.lastErrorCode, "scheduler_stale");
});

test("近期嘗試的 pending symbol 會冷卻，其他到期 symbol 仍可被挑選", async () => {
  const datasets = WATCHLIST_CHIP_PREWARM_CONTRACT.datasets;
  const states = [
    ...datasets.map((dataset) => state("2330.TW", dataset, { coverage_end: "2026-07-16", source_date: "2026-07-16", last_attempt_at: "2026-07-17T14:30:00.000Z" })),
    ...datasets.map((dataset) => state("2317.TW", dataset, { coverage_end: "2026-07-16", source_date: "2026-07-16", last_attempt_at: "2026-07-16T10:00:00.000Z" })),
  ];
  const result = await discoverWatchlistChipWarmTargets({ db: db(["2330.TW", "2317.TW"], states), limit: 1, now: "2026-07-17T15:00:00.000Z", attemptCooldownMs: 4 * 3600000 });
  assert.equal(result.pendingSymbols, 2);
  assert.equal(result.dueSymbols, 1);
  assert.equal(result.deferredSymbols, 1);
  assert.equal(result.targets[0].symbol, "2317.TW");
});
