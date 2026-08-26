import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  advanceChipBackfillOrchestratorRun,
  failChipBackfillOrchestratorRun,
  latestCompletedTaiwanSessionDate,
  readChipBackfillOrchestratorHealth,
  safeChipBackfillWorkflowSummary,
  startChipBackfillOrchestratorRun,
} from "../worker/chip-backfill-orchestrator.ts";

const migration = await readFile(new URL("../drizzle/0015_short_tinkerer.sql", import.meta.url), "utf8");
const scopeMigration = await readFile(new URL("../drizzle/0020_chunky_justice.sql", import.meta.url), "utf8");
const entrySource = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
const appSource = await readFile(new URL("../worker/app.ts", import.meta.url), "utf8");
const prewarmSource = await readFile(new URL("../worker/watchlist-chip-prewarming.ts", import.meta.url), "utf8");

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() {
    if (this.sql.includes("WHERE run_id=?")) return this.db.rows.get(this.args[0]) || null;
    return [...this.db.rows.values()].at(-1) || null;
  }
  async run() {
    if (this.sql.startsWith("INSERT INTO chip_backfill_orchestrator_runs")) {
      const [runId, scope, trigger, phase, expected, heartbeat, started] = this.args;
      const existing = this.db.rows.get(runId);
      this.db.rows.set(runId, existing
        ? { ...existing, heartbeat_at: heartbeat }
        : { run_id: runId, scope, trigger, status: "running", phase, expected_session_date: expected, processed_symbols_json: "[]", processed_symbols: 0, remaining_symbols: 0, pending_symbols: 0, heartbeat_at: heartbeat, started_at: started });
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE chip_backfill_orchestrator_runs SET")) {
      if (this.sql.includes("status='failed',phase='failed'")) {
        const [reason, heartbeat, completed, runId] = this.args;
        const row = this.db.rows.get(runId);
        this.db.rows.set(runId, { ...row, status: "failed", phase: "failed", last_reason_code: reason, heartbeat_at: heartbeat, completed_at: completed });
        return { success: true };
      }
      const [status, phase, latest, processedJson, processed, remaining, pending, lastSymbol, reason, heartbeat, completed, runId] = this.args;
      const row = this.db.rows.get(runId);
      this.db.rows.set(runId, { ...row, status, phase, latest_data_date: latest || row.latest_data_date, processed_symbols_json: processedJson, processed_symbols: processed, remaining_symbols: remaining, pending_symbols: pending, last_symbol: lastSymbol, last_reason_code: reason, heartbeat_at: heartbeat, completed_at: completed });
      return { success: true };
    }
    return { success: true };
  }
}

class Db {
  constructor() { this.rows = new Map(); }
  prepare(sql) { return new Statement(this, sql); }
}

test("最近已完成交易日依台北時間、截止時間與週末回退", () => {
  assert.equal(latestCompletedTaiwanSessionDate("2026-07-17T01:00:00.000Z"), "2026-07-16");
  assert.equal(latestCompletedTaiwanSessionDate("2026-07-17T15:00:00.000Z"), "2026-07-17");
  assert.equal(latestCompletedTaiwanSessionDate("2026-07-18T15:00:00.000Z"), "2026-07-17");
  assert.equal(latestCompletedTaiwanSessionDate("2026-07-19T15:00:00.000Z"), "2026-07-17");
});

test("orchestrator run 可冪等 start、累積去重 symbol 並保存完成終態", async () => {
  const db = new Db();
  await startChipBackfillOrchestratorRun({ db, runId: "gha-1-1", trigger: "schedule", scope: "daily", now: "2026-07-17T15:00:00.000Z" });
  await advanceChipBackfillOrchestratorRun({ db, runId: "gha-1-1", phase: "daily", symbols: ["2330.TW"], remainingSymbols: 2, pendingSymbols: 3, now: "2026-07-17T15:01:00.000Z" });
  await startChipBackfillOrchestratorRun({ db, runId: "gha-1-1", trigger: "schedule", scope: "daily", now: "2026-07-17T15:02:00.000Z" });
  const done = await advanceChipBackfillOrchestratorRun({ db, runId: "gha-1-1", symbols: ["2330.TW", "2317.TW"], remainingSymbols: 0, pendingSymbols: 1, lastReasonCode: "source_not_published", done: true, now: "2026-07-17T15:03:00.000Z" });
  assert.equal(done.status, "completed");
  assert.equal(done.scope, "daily");
  assert.equal(done.phase, "completed");
  assert.equal(done.processedSymbols, 2);
  assert.equal(done.remainingSymbols, 0);
  assert.equal(done.pendingSymbols, 1);
  assert.equal(done.lastReasonCode, "source_not_published");
  const preserved = await failChipBackfillOrchestratorRun({ db, runId: "gha-1-1", reason: "tick_limit_exceeded", now: "2026-07-17T15:04:00.000Z" });
  assert.equal(preserved.status, "completed");
  assert.equal(preserved.lastReasonCode, "source_not_published");
  const health = await readChipBackfillOrchestratorHealth(db);
  assert.equal(health.runId, "gha-1-1");
  assert.equal(health.runtime, "sites-worker");
});

test("orchestrator 失敗收尾保留 allowlist reason 且重送不改寫終態", async () => {
  const db = new Db();
  await startChipBackfillOrchestratorRun({ db, runId: "gha-2-1", trigger: "schedule", now: "2026-07-26T15:38:39.000Z" });
  const failed = await failChipBackfillOrchestratorRun({ db, runId: "gha-2-1", reason: "tick_limit_exceeded", now: "2026-07-26T15:42:27.000Z" });
  assert.equal(failed.status, "failed");
  assert.equal(failed.phase, "failed");
  assert.equal(failed.lastReasonCode, "tick_limit_exceeded");
  const repeated = await failChipBackfillOrchestratorRun({ db, runId: "gha-2-1", reason: "rate_limited", now: "2026-07-26T16:00:00.000Z" });
  assert.equal(repeated.lastReasonCode, "tick_limit_exceeded");
  assert.equal(repeated.completedAt, "2026-07-26T15:42:27.000Z");
});

test("orchestrator scope 決定初始 phase，且相同 run id 不得混用 scope", async () => {
  const db = new Db();
  const weekly = await startChipBackfillOrchestratorRun({ db, runId: "weekly-1", trigger: "schedule", scope: "tdcc-weekly", now: "2026-07-26T15:00:00.000Z" });
  const daily = await startChipBackfillOrchestratorRun({ db, runId: "daily-1", trigger: "schedule", scope: "daily", now: "2026-07-26T15:00:00.000Z" });
  assert.equal(weekly.phase, "latest");
  assert.equal(daily.phase, "daily");
  await assert.rejects(() => startChipBackfillOrchestratorRun({ db, runId: "daily-1", trigger: "schedule", scope: "tdcc-weekly" }), /invalid_response/);
});

test("workflow 摘要只保留安全 phase、計數與 allowlist reason", () => {
  assert.deepEqual(safeChipBackfillWorkflowSummary({
    scope: "daily",
    status: "running",
    phase: "daily",
    processedSymbols: 7,
    remainingSymbols: 6,
    pendingSymbols: 18,
    lastReasonCode: "rate_limited",
    secret: "must-not-leak",
  }), {
    scope: "daily",
    status: "running",
    phase: "daily",
    processedSymbols: 7,
    remainingSymbols: 6,
    pendingSymbols: 18,
    reason: "rate_limited",
  });
  assert.deepEqual(safeChipBackfillWorkflowSummary({
    scope: "secret-scope",
    status: "token=secret",
    phase: "private-response",
    processedSymbols: -1,
    remainingSymbols: "not-a-number",
    pendingSymbols: 1.5,
    lastReasonCode: "secret=hidden",
  }), {
    scope: "unknown",
    status: "unknown",
    phase: "unknown",
    processedSymbols: 0,
    remainingSymbols: 0,
    pendingSymbols: 0,
    reason: null,
  });
});

test("D1 migration、Worker scheduled handler 與 health 均包含 orchestrator", () => {
  assert.match(migration, /CREATE TABLE `chip_backfill_orchestrator_runs`/);
  assert.match(migration, /processed_symbols_json/);
  assert.match(scopeMigration, /ADD `scope` text DEFAULT 'combined' NOT NULL/);
  assert.match(appSource, /scope: "daily"/);
  assert.match(entrySource, /async scheduled\(/);
  assert.match(entrySource, /runChipBackfillScheduled/);
  assert.match(appSource, /backgroundOrchestrator/);
  assert.match(appSource, /orchestrator-start/);
  assert.match(appSource, /orchestrator-tick/);
  assert.match(appSource, /orchestrator-fail/);
  assert.match(appSource, /finalizeChipBackfillOrchestratorFailure/);
  assert.match(appSource, /tick < WATCHLIST_CHIP_PREWARM_CONTRACT\.maxTargetsPerRun/);
  assert.match(appSource, /nextProcessed <= processed/);
  assert.match(appSource, /SELECT \* FROM user_instruments WHERE symbol = \?/);
  assert.match(prewarmSource, /FROM chip_backfill_orchestrator_runs WHERE scope IN \('daily','combined'\)/);
  assert.doesNotMatch(prewarmSource, /FROM tdcc_continuous_runs ORDER BY updated_at DESC LIMIT 1/);
});
