import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  aggregateCandleContinuityRun,
  candleContinuitySlaCheckpoint,
  claimCandleContinuityItems,
  completeCandleContinuityItem,
  failCandleContinuityRun,
  heartbeatCandleContinuityItems,
  peekCandleContinuityItem,
  planCandleContinuityTargets,
  readCandleContinuityAutomationHealth,
  safeCandleContinuityReason,
  safeCandleContinuityWorkflowSummary,
  startCandleContinuityRun,
} from "../worker/candle-continuity-automation.ts";
import { applyDrizzleSql, SqliteD1 } from "./helpers/sqlite-d1.mjs";

const migration = await readFile(new URL("../drizzle/0026_daily_candle_continuity_automation.sql", import.meta.url), "utf8");

function automationDb() {
  const db = new SqliteD1();
  applyDrizzleSql(db, migration);
  return db;
}

function target(symbol, priority = 10, status = "queued") {
  return { symbol, priority, status, coverageEnd: null, verifiedThrough: null, missingSessionCount: 0, checkedAt: null, reasonCode: null };
}

test("migration 可重跑且保留既有資料", async (t) => {
  const db = new SqliteD1();
  t.after(() => db.close());
  db.exec("CREATE TABLE existing_data (value TEXT NOT NULL)");
  db.exec("INSERT INTO existing_data VALUES ('kept')");
  applyDrizzleSql(db, migration);
  applyDrizzleSql(db, migration);
  assert.equal(await db.prepare("SELECT value FROM existing_data").first("value"), "kept");
  assert.equal((await db.prepare("PRAGMA table_info(candle_continuity_run_items)").all()).results.some((row) => row.name === "lease_owner"), true);
});

test("discovery 去重、排除非台股商品並固定新商品與 fresh 優先序", () => {
  const now = "2026-08-28T15:00:00.000Z";
  const result = planCandleContinuityTargets({
    expectedSession: "2026-08-28",
    now,
    candidates: [
      { symbol: "3008.tw", source: "setup", quoteType: "EQUITY", enabled: true },
      { symbol: "3008.TW", source: "user", quoteType: "EQUITY", enabled: true },
      { symbol: "4768.TWO", source: "user", quoteType: "EQUITY", enabled: true },
      { symbol: "0050.TW", source: "catalog", quoteType: "ETF", active: true, continuityStatus: "complete", missingSessionCount: 0, coverageEnd: "2026-08-28", verifiedThrough: "2026-08-28", checkedAt: "2026-08-28T14:00:00.000Z" },
      { symbol: "^TWII", source: "catalog", quoteType: "INDEX", active: true },
      { symbol: "03001P.TW", source: "catalog", quoteType: "WARRANT", active: true },
      { symbol: "2330.TW", source: "catalog", quoteType: "EQUITY", active: false },
      { symbol: "AAPL", source: "catalog", quoteType: "EQUITY", active: true },
    ],
  });
  assert.deepEqual(result.map((item) => item.symbol), ["3008.TW", "4768.TWO", "0050.TW"]);
  assert.deepEqual(result.map((item) => item.priority), [10, 10, 90]);
  assert.equal(result.at(-1).status, "fresh");
});

test("SLA checkpoint 固定為 expected session 次日台北 10:00", () => {
  assert.equal(candleContinuitySlaCheckpoint("2026-08-28"), "2026-08-29T02:00:00.000Z");
});

test("相同 run start 冪等且 run 中清單變動不改變快照", async (t) => {
  const db = automationDb();
  t.after(() => db.close());
  const input = { db, runId: "sites-100-1", deploymentTarget: "sites", trigger: "workflow_dispatch", expectedSession: "2026-08-28", now: "2026-08-28T15:00:00Z" };
  await startCandleContinuityRun({ ...input, targets: [target("3008.TW"), target("4768.TWO")] });
  const repeated = await startCandleContinuityRun({ ...input, targets: [target("3008.TW"), target("0050.TW")] });
  assert.equal(repeated.counts.target, 2);
  assert.deepEqual((await db.prepare("SELECT symbol FROM candle_continuity_run_items ORDER BY symbol").all()).results.map((row) => row.symbol), ["3008.TW", "4768.TWO"]);
});

test("claim 限制 8 檔、穩定分頁、fresh 不被 claim 且 51 檔以上無遺漏", async (t) => {
  const db = automationDb();
  t.after(() => db.close());
  const targets = Array.from({ length: 55 }, (_, index) => target(`${String(1000 + index).padStart(4, "0")}.TW`, index === 54 ? 90 : 10, index === 54 ? "fresh" : "queued"));
  await startCandleContinuityRun({ db, runId: "local-55", deploymentTarget: "local", trigger: "local", expectedSession: "2026-08-28", targets, now: "2026-08-28T15:00:00Z" });
  const seen = new Set();
  let tick = 0;
  while (true) {
    tick += 1;
    const owner = `owner-${tick}`;
    const symbols = await claimCandleContinuityItems({ db, runId: "local-55", owner, now: `2026-08-28T15:${String(tick).padStart(2, "0")}:00Z` });
    if (!symbols.length) break;
    assert.equal(symbols.length <= 8, true);
    for (const symbol of symbols) {
      assert.equal(seen.has(symbol), false);
      seen.add(symbol);
      await completeCandleContinuityItem({ db, runId: "local-55", symbol, owner, outcome: { status: "complete", coverageEnd: "2026-08-28", verifiedThrough: "2026-08-28", missingSessionCount: 0 }, now: `2026-08-28T15:${String(tick).padStart(2, "0")}:30Z` });
    }
  }
  const summary = await aggregateCandleContinuityRun(db, "local-55", "2026-08-28T16:00:00Z");
  assert.equal(seen.size, 54);
  assert.deepEqual(summary.counts, { target: 55, processed: 55, remaining: 0, complete: 55, partial: 0, unknown: 0, failed: 0, overdue: 0 });
  assert.equal(summary.status, "completed");
});

test("peek 只回下一個 symbol 且不 claim、不增加 attempts 或改 lease", async (t) => {
  const db = automationDb();
  t.after(() => db.close());
  await startCandleContinuityRun({
    db,
    runId: "sites-peek",
    deploymentTarget: "sites",
    trigger: "workflow_dispatch",
    expectedSession: "2026-08-28",
    targets: [target("4768.TWO", 20), target("3008.TW", 10)],
    now: "2026-08-28T15:00:00Z",
  });
  assert.equal(await peekCandleContinuityItem({ db, runId: "sites-peek", now: "2026-08-28T15:00:01Z" }), "3008.TW");
  assert.equal(await peekCandleContinuityItem({ db, runId: "sites-peek", now: "2026-08-28T15:00:02Z" }), "3008.TW");
  const row = await db.prepare("SELECT status,attempts,lease_owner FROM candle_continuity_run_items WHERE run_id='sites-peek' AND symbol='3008.TW'").first();
  assert.deepEqual({ ...row }, { status: "queued", attempts: 0, lease_owner: null });
});

test("lease 過期可接手，過期 owner 與舊結果不能覆寫", async (t) => {
  const db = automationDb();
  t.after(() => db.close());
  await startCandleContinuityRun({ db, runId: "sites-lease", deploymentTarget: "sites", trigger: "schedule", expectedSession: "2026-08-28", targets: [target("3008.TW")], now: "2026-08-28T15:00:00Z" });
  assert.deepEqual(await claimCandleContinuityItems({ db, runId: "sites-lease", owner: "old", leaseSeconds: 30, now: "2026-08-28T15:00:00Z" }), ["3008.TW"]);
  assert.deepEqual(await claimCandleContinuityItems({ db, runId: "sites-lease", owner: "new", leaseSeconds: 60, now: "2026-08-28T15:01:00Z" }), ["3008.TW"]);
  await assert.rejects(() => completeCandleContinuityItem({ db, runId: "sites-lease", symbol: "3008.TW", owner: "old", outcome: { status: "complete" }, now: "2026-08-28T15:01:01Z" }), /lease_conflict/);
  await heartbeatCandleContinuityItems({ db, runId: "sites-lease", owner: "new", symbols: ["3008.TW"], now: "2026-08-28T15:01:10Z" });
  await completeCandleContinuityItem({ db, runId: "sites-lease", symbol: "3008.TW", owner: "new", outcome: { status: "complete", verifiedThrough: "2026-08-28" }, now: "2026-08-28T15:01:11Z" });
  assert.equal((await db.prepare("SELECT status FROM candle_continuity_run_items WHERE run_id='sites-lease'").first()).status, "complete");
});

test("retry waiting 保留進度，fail 只接受 allowlist 並可安全 resume", async (t) => {
  const db = automationDb();
  t.after(() => db.close());
  await startCandleContinuityRun({ db, runId: "cloudflare-retry", deploymentTarget: "cloudflare", trigger: "schedule", expectedSession: "2026-08-28", targets: [target("3008.TW"), target("4768.TWO")], now: "2026-08-28T15:00:00Z" });
  const claimed = await claimCandleContinuityItems({ db, runId: "cloudflare-retry", owner: "cf-owner", now: "2026-08-28T15:00:01Z" });
  await completeCandleContinuityItem({ db, runId: "cloudflare-retry", symbol: claimed[0], owner: "cf-owner", outcome: { status: "complete", verifiedThrough: "2026-08-28" }, now: "2026-08-28T15:00:02Z" });
  const waiting = await completeCandleContinuityItem({ db, runId: "cloudflare-retry", symbol: claimed[1], owner: "cf-owner", outcome: { status: "failed", reasonCode: "rate_limited", retryable: true, retryAfter: "2026-08-28T15:30:00Z" }, now: "2026-08-28T15:00:03Z" });
  assert.equal(waiting.status, "retry_waiting");
  assert.deepEqual(await claimCandleContinuityItems({ db, runId: "cloudflare-retry", owner: "too-early", now: "2026-08-28T15:20:00Z" }), []);
  assert.deepEqual(await claimCandleContinuityItems({ db, runId: "cloudflare-retry", owner: "resume", now: "2026-08-28T15:31:00Z" }), ["4768.TWO"]);
  await assert.rejects(() => failCandleContinuityRun({ db, runId: "cloudflare-retry", reason: "token=secret" }), /invalid_response/);
  const failed = await failCandleContinuityRun({ db, runId: "cloudflare-retry", reason: "provider_unavailable", now: "2026-08-28T15:31:01Z" });
  assert.equal(failed.status, "failed");
  assert.equal((await db.prepare("SELECT status FROM candle_continuity_run_items WHERE symbol='3008.TW'").first()).status, "complete");
});

test("checkpoint 後 unresolved 轉 overdue，health bounded 20 且不洩漏來源或秘密", async (t) => {
  const db = automationDb();
  t.after(() => db.close());
  const targets = Array.from({ length: 25 }, (_, index) => target(`${String(2000 + index)}.TW`));
  await startCandleContinuityRun({ db, runId: "sites-overdue", deploymentTarget: "sites", trigger: "schedule", expectedSession: "2026-08-28", targets, now: "2026-08-28T15:00:00Z" });
  const health = await readCandleContinuityAutomationHealth(db, "sites", "2026-08-29T02:01:00Z");
  assert.equal(health.status, "degraded");
  assert.equal(health.latestRun.counts.overdue, 25);
  assert.equal(health.anomalies.total, 25);
  assert.equal(health.anomalies.items.length, 20);
  assert.equal(health.anomalies.truncated, true);
  assert.equal(JSON.stringify(health).includes("user"), false);
  assert.equal(JSON.stringify(health).includes("secret"), false);
});

test("retryable item 最多跨 tick 重試一次，第二次仍失敗即終止", async (t) => {
  const db = automationDb();
  t.after(() => db.close());
  await startCandleContinuityRun({ db, runId: "sites-retry-cap", deploymentTarget: "sites", trigger: "schedule", expectedSession: "2026-08-28", targets: [target("3008.TW")], now: "2026-08-28T15:00:00Z" });
  await claimCandleContinuityItems({ db, runId: "sites-retry-cap", owner: "first", now: "2026-08-28T15:00:01Z" });
  const waiting = await completeCandleContinuityItem({ db, runId: "sites-retry-cap", symbol: "3008.TW", owner: "first", outcome: { status: "failed", reasonCode: "timeout", retryable: true, retryAfter: "2026-08-28T15:01:02Z" }, now: "2026-08-28T15:00:02Z" });
  assert.equal(waiting.status, "retry_waiting");
  await claimCandleContinuityItems({ db, runId: "sites-retry-cap", owner: "second", now: "2026-08-28T15:01:03Z" });
  const terminal = await completeCandleContinuityItem({ db, runId: "sites-retry-cap", symbol: "3008.TW", owner: "second", outcome: { status: "failed", reasonCode: "timeout", retryable: true }, now: "2026-08-28T15:01:04Z" });
  assert.equal(terminal.status, "completed");
  assert.equal(terminal.counts.failed, 1);
  assert.equal((await db.prepare("SELECT attempts,status FROM candle_continuity_run_items WHERE run_id='sites-retry-cap'").first()).attempts, 2);
});

test("reason 與 workflow summary 僅輸出 allowlist 安全欄位", () => {
  assert.equal(safeCandleContinuityReason("HTTP 429 token=hidden"), "rate_limited");
  assert.equal(safeCandleContinuityReason("audit_request_budget"), "audit_request_budget");
  const line = safeCandleContinuityWorkflowSummary({ summary: { deploymentTarget: "sites", runId: "sites-1", expectedSession: "2026-08-28", status: "completed", reasonCode: "token=hidden", counts: { processed: 1, complete: 1 } }, targets: ["SECRET.TW"] });
  assert.equal(line.includes("token=hidden"), false);
  assert.equal(line.includes("SECRET.TW"), false);
  assert.match(line, /^target=sites run=sites-1 /);
});
