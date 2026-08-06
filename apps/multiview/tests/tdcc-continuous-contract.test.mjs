import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  TDCC_CONTINUOUS_CONTRACT,
  queueTdccContinuousSymbolBackfill,
  readTdccContinuousSymbolStatus,
  resolvedTdccContinuousDates,
  safeTdccContinuousError,
  tdccContinuousTargetSyncState,
  upsertTdccContinuousTarget,
  validateContinuousTargets,
} from "../worker/tdcc-continuous-backfill.ts";

const workflow = await readFile(new URL("../.github/workflows/tdcc-continuous-backfill.yml", import.meta.url), "utf8");
const dailyWorkflow = await readFile(new URL("../.github/workflows/taiwan-stock-chip-daily-backfill.yml", import.meta.url), "utf8");
const migration = await readFile(new URL("../drizzle/0006_thin_mentor.sql", import.meta.url), "utf8");
const workerSource = await readFile(new URL("../worker/app.ts", import.meta.url), "utf8");
const paneSource = await readFile(new URL("../public/static/chip-panes.js", import.meta.url), "utf8");
const runnerSource = await readFile(new URL("../scripts/tdcc-history-backfill.mjs", import.meta.url), "utf8");
const orchestratorScriptMatch = dailyWorkflow.match(/      - name: Run Sites daily chip orchestrator[\s\S]*?        run: \|\n([\s\S]*)$/);
assert.ok(orchestratorScriptMatch, "workflow orchestrator shell script should be present");
const orchestratorScript = orchestratorScriptMatch[1].split("\n").map((line) => line.replace(/^ {10}/, "")).join("\n");

function runOrchestratorScript(mockCurl) {
  return spawnSync("bash", [], {
    input: `${mockCurl}\n${orchestratorScript}\n`,
    encoding: "utf8",
    env: {
      ...process.env,
      SITES_BYPASS_TOKEN: "test-sites-token",
      TDCC_CONTINUOUS_BACKFILL_SECRET: "test-worker-secret",
      TDCC_TRIGGER: "schedule",
      CHIP_TRIGGER: "schedule",
      CHIP_BACKFILL_SCOPE: "daily",
      SITE_URL: "https://example.invalid",
      RUN_ID: "gha-test-1",
    },
  });
}

const pendingThenRecoverableCurl = String.raw`curl() {
  local payload=""
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "--data" ]; then payload="$2"; shift 2; else shift; fi
  done
  case "$payload" in
    *'"action":"orchestrator-fail"'*)
      echo '{"ok":true,"done":false,"summary":{"scope":"daily","status":"failed","phase":"failed","processedSymbols":60,"remainingSymbols":1,"pendingSymbols":1,"reason":"tick_limit_exceeded"},"recovery":{"status":"not_needed","nextRetryAt":null},"secret":"must-not-leak"}'
      ;;
    *)
      echo '{"ok":true,"done":false,"summary":{"scope":"daily","status":"running","phase":"daily","processedSymbols":1,"remainingSymbols":1,"pendingSymbols":1,"reason":"rate_limited"},"secret":"must-not-leak"}'
      ;;
  esac
}`;

const timeoutThenRecoverableCurl = String.raw`curl() {
  local payload=""
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "--data" ]; then payload="$2"; shift 2; else shift; fi
  done
  case "$payload" in
    *'"action":"orchestrator-fail"'*)
      echo '{"ok":true,"done":false,"summary":{"scope":"daily","status":"failed","phase":"failed","processedSymbols":0,"remainingSymbols":0,"pendingSymbols":0,"reason":"timeout"},"recovery":{"status":"not_needed","nextRetryAt":null}}'
      ;;
    *) return 28 ;;
  esac
}`;

test("continuous metadata 固定低速、有限批次、lease 與週資料語意", () => {
  assert.equal(TDCC_CONTINUOUS_CONTRACT.checkFrequency, "weekly-with-next-day-retry");
  assert.equal(TDCC_CONTINUOUS_CONTRACT.dataFrequency, "weekly");
  assert.equal(TDCC_CONTINUOUS_CONTRACT.minimumDelayMs >= 1000, true);
  assert.equal(TDCC_CONTINUOUS_CONTRACT.maximumClaimSymbols <= 4, true);
  assert.equal(TDCC_CONTINUOUS_CONTRACT.maximumWeeksPerClaim <= 12, true);
  assert.equal(TDCC_CONTINUOUS_CONTRACT.minimumHistoryWeeks, 51);
  assert.equal(TDCC_CONTINUOUS_CONTRACT.leaseSeconds, 900);
});

test("target discovery 接受普通股與六碼 ETF、跨使用者同 symbol 去重", () => {
  const targets = validateContinuousTargets([
    { symbol: "2330.tw", source: "user" },
    { symbol: "2330.TW", source: "setup" },
    { symbol: "009816.TW", source: "user" },
    { symbol: "8069.TWO", source: "official-new-listing" },
  ]);
  assert.deepEqual(targets.map((item) => item.symbol), ["009816.TW", "2330.TW", "8069.TWO"]);
  assert.equal(targets.find((item) => item.symbol === "2330.TW").source, "setup");
  assert.throws(() => validateContinuousTargets([{ symbol: "AAPL", source: "user" }]), /invalid_response/);
});

test("個股狀態依 symbol 隔離，不使用全域 job", async () => {
  const rows = new Map([
    ["2330.TW", { symbol: "2330.TW", source: "setup", active: 1, status: "completed", expected_weeks: 52, completed_weeks: 52, failed_weeks: 0, missing_dates_json: "[]", latest_snapshot_date: "2026-07-10", history_success_at: "2026-07-17T00:00:00Z" }],
    ["00919.TW", { symbol: "00919.TW", source: "user", active: 1, status: "queued", expected_weeks: 52, completed_weeks: 1, failed_weeks: 0, missing_dates_json: '["2026-07-03"]', latest_snapshot_date: "2026-07-10" }],
  ]);
  const db = { prepare: () => ({ bind(symbol) { this.symbol = symbol; return this; }, async first() { return rows.get(this.symbol) || null; } }) };
  const stock = await readTdccContinuousSymbolStatus(db, "2330.TW");
  const etf = await readTdccContinuousSymbolStatus(db, "00919.TW");
  assert.equal(stock.status, "completed");
  assert.equal(stock.completedWeeks, 52);
  assert.equal(etf.status, "queued");
  assert.deepEqual(etf.missingDates, ["2026-07-03"]);
});

test("來源失敗只映射 allowlist，不洩漏 response 或秘密", () => {
  assert.equal(safeTdccContinuousError(new Error("HTTP 429 secret=abc")), "rate_limited");
  assert.equal(safeTdccContinuousError(new Error("captcha page body")), "captcha_or_blocked");
  assert.equal(safeTdccContinuousError(new Error("DOM changed token=abc")), "invalid_response");
  assert.equal(safeTdccContinuousError(new Error("request timeout")), "timeout");
  assert.equal(safeTdccContinuousError(new Error("tick_limit_exceeded")), "tick_limit_exceeded");
});

test("operator 只能以原安全錯誤碼重新排入明確 blocked symbols", () => {
  assert.match(workerSource, /action === "retry-blocked"/);
  assert.match(workerSource, /\["candidate_mismatch", "invalid_response"\]/);
  assert.match(workerSource, /status='blocked' AND last_error_code=\?/);
  assert.match(workerSource, /symbols\.length > 20/);
});

test("TDCC 合法查無資料以 not_published gap 完成，不當成 runner 失敗", () => {
  assert.match(workerSource, /action === "complete-gap"/);
  assert.match(workerSource, /gapReason: "not_published"/);
  assert.match(runnerSource, /action: "complete-gap"/);
  assert.match(runnerSource, /event: "week-gap"/);
  assert.doesNotMatch(runnerSource, /if \(!rows\) throw new Error\("invalid_response"\)/);
});

test("已確認 not_published 的週次在下一批規劃視為完成，不會重複查詢", () => {
  const resolved = resolvedTdccContinuousDates(
    [{ data_date: "2026-07-10" }],
    [
      { data_date: "2026-07-03", status: "completed", error_code: "not_published" },
      { data_date: "2026-06-26", status: "failed", error_code: "timeout" },
    ],
  );
  assert.deepEqual([...resolved.completed].sort(), ["2026-07-03", "2026-07-10"]);
  assert.equal(resolved.completed.has("2026-06-26"), false);
});

test("target 同步不會把部分歷史誤標完成，且保留執行中與阻擋狀態", () => {
  assert.equal(tdccContinuousTargetSyncState({ expectedWeeks: 51, completedWeeks: 13, missingDates: ["2026-07-03"] }), "partial");
  assert.equal(tdccContinuousTargetSyncState({ expectedWeeks: 51, completedWeeks: 51, missingDates: [] }), "completed");
  assert.equal(tdccContinuousTargetSyncState({ existingStatus: "queued", expectedWeeks: 2, completedWeeks: 2, missingDates: [] }), "queued");
  assert.equal(tdccContinuousTargetSyncState({ existingStatus: "completed", expectedWeeks: 2, completedWeeks: 2, missingDates: [] }), "partial");
  assert.equal(tdccContinuousTargetSyncState({ completedWeeks: 1 }), "partial");
  assert.equal(tdccContinuousTargetSyncState({ completedWeeks: 0 }), "queued");
  assert.equal(tdccContinuousTargetSyncState({ existingStatus: "running", expectedWeeks: 51, completedWeeks: 13 }), "running");
  assert.equal(tdccContinuousTargetSyncState({ existingStatus: "blocked", expectedWeeks: 51, completedWeeks: 13 }), "blocked");
});

class TargetStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() {
    const symbol = this.args[0];
    if (this.sql.includes("FROM taiwan_stock_shareholder_distribution")) return this.db.coverage.get(symbol) || null;
    if (this.sql.includes("FROM tdcc_continuous_symbols") && this.sql.includes("WHERE symbol")) return this.db.rows.get(symbol) || null;
    return null;
  }
  async run() {
    if (this.sql.startsWith("UPDATE tdcc_continuous_symbols SET status='queued'")) {
      const [lastSeenAt, symbol] = this.args;
      const existing = this.db.rows.get(symbol);
      if (existing && existing.active && !["blocked", "running", "queued"].includes(existing.status)) {
        this.db.rows.set(symbol, { ...existing, status: "queued", last_error_code: null, next_retry_at: null, lease_owner: null, lease_expires_at: null, last_seen_at: lastSeenAt });
        this.db.writes.push(symbol);
      }
      return { success: true };
    }
    if (!this.sql.startsWith("INSERT INTO tdcc_continuous_symbols")) return { success: true };
    const [symbol, source, revision, active, status, targetStart, targetEnd, expectedWeeks, completedWeeks, checkpointDate, latestSnapshotDate, historySuccessAt, firstSeenAt, lastSeenAt] = this.args;
    const existing = this.db.rows.get(symbol) || {};
    this.db.rows.set(symbol, {
      ...existing,
      symbol,
      source: existing.source === "setup" && source === "user" ? existing.source : source,
      catalog_revision: revision || existing.catalog_revision || "",
      active,
      status,
      target_start: existing.target_start || targetStart,
      target_end: targetEnd || existing.target_end,
      expected_weeks: Math.max(Number(existing.expected_weeks || 0), Number(expectedWeeks || 0)),
      completed_weeks: Math.max(Number(existing.completed_weeks || 0), Number(completedWeeks || 0)),
      missing_dates_json: existing.missing_dates_json || "[]",
      checkpoint_date: existing.checkpoint_date || checkpointDate,
      latest_snapshot_date: latestSnapshotDate || existing.latest_snapshot_date,
      history_success_at: existing.history_success_at || historySuccessAt,
      first_seen_at: existing.first_seen_at || firstSeenAt,
      last_seen_at: lastSeenAt,
    });
    this.db.writes.push(symbol);
    return { success: true };
  }
}

class TargetDb {
  constructor(rows, coverage) { this.rows = rows; this.coverage = coverage; this.writes = []; }
  prepare(sql) { return new TargetStatement(this, sql); }
}

test("單一 target upsert 冪等保留狀態與 revision，且不改寫其他 symbol", async () => {
  const untouched = { symbol: "2317.TW", source: "setup", active: 1, status: "completed", catalog_revision: "catalog-v1", expected_weeks: 52, completed_weeks: 52, missing_dates_json: "[]" };
  const rows = new Map([
    ["2317.TW", { ...untouched }],
    ["2330.TW", { symbol: "2330.TW", source: "setup", active: 1, status: "completed", catalog_revision: "catalog-v2", expected_weeks: 51, completed_weeks: 51, missing_dates_json: "[]" }],
    ["00919.TW", { symbol: "00919.TW", source: "user", active: 1, status: "blocked", catalog_revision: "catalog-v2", expected_weeks: 51, completed_weeks: 13, missing_dates_json: '["2026-07-03"]' }],
    ["8069.TWO", { symbol: "8069.TWO", source: "user", active: 1, status: "running", catalog_revision: "catalog-v2", expected_weeks: 51, completed_weeks: 20, missing_dates_json: '["2026-07-03"]' }],
  ]);
  const coverage = new Map([
    ["2330.TW", { coverage_start: "2025-07-17", coverage_end: "2026-07-17", saved_weeks: 51, last_success_at: "2026-07-18T00:00:00Z" }],
    ["00919.TW", { coverage_start: "2026-01-01", coverage_end: "2026-07-17", saved_weeks: 13, last_success_at: "2026-07-18T00:00:00Z" }],
    ["8069.TWO", { coverage_start: "2026-01-01", coverage_end: "2026-07-17", saved_weeks: 20, last_success_at: "2026-07-18T00:00:00Z" }],
  ]);
  const db = new TargetDb(rows, coverage);

  await upsertTdccContinuousTarget({ db, target: { symbol: "2330.tw", source: "user" }, now: "2026-07-19T00:00:00Z" });
  await upsertTdccContinuousTarget({ db, target: { symbol: "2330.TW", source: "user" }, now: "2026-07-19T00:01:00Z" });
  await upsertTdccContinuousTarget({ db, target: { symbol: "00919.TW", source: "user" }, now: "2026-07-19T00:02:00Z" });
  await upsertTdccContinuousTarget({ db, target: { symbol: "8069.TWO", source: "user" }, now: "2026-07-19T00:03:00Z" });

  assert.equal(rows.size, 4);
  assert.equal(rows.get("2330.TW").status, "completed");
  assert.equal(rows.get("2330.TW").source, "setup");
  assert.equal(rows.get("2330.TW").catalog_revision, "catalog-v2");
  assert.equal(rows.get("00919.TW").status, "blocked");
  assert.equal(rows.get("8069.TWO").status, "running");
  assert.deepEqual(rows.get("2317.TW"), untouched);
  assert.deepEqual(db.writes, ["2330.TW", "2330.TW", "00919.TW", "8069.TWO"]);
});

test("少量 TDCC 週資料在 target refresh 後仍可排隊，不會被誤判完成", async () => {
  const rows = new Map([
    ["3481.TW", { symbol: "3481.TW", source: "user", active: 1, status: "queued", expected_weeks: 2, completed_weeks: 2, missing_dates_json: "[]" }],
  ]);
  const coverage = new Map([
    ["3481.TW", { coverage_start: "2026-07-10", coverage_end: "2026-07-17", saved_weeks: 2, last_success_at: "2026-07-19T05:30:00Z" }],
  ]);
  const db = new TargetDb(rows, coverage);

  await upsertTdccContinuousTarget({ db, target: { symbol: "3481.TW", source: "user" }, now: "2026-07-19T09:30:00Z" });

  assert.equal(rows.get("3481.TW").status, "queued");
  assert.equal(rows.get("3481.TW").completed_weeks, 2);
});

test("使用者要求只將可重試單一 TDCC target 排入，保留 running、blocked 與其他 symbol", async () => {
  const untouched = { symbol: "2317.TW", source: "setup", active: 1, status: "completed", expected_weeks: 51, completed_weeks: 51, missing_dates_json: "[]" };
  const rows = new Map([
    ["2317.TW", { ...untouched }],
    ["2324.TW", { symbol: "2324.TW", source: "user", active: 1, status: "completed", expected_weeks: 1, completed_weeks: 1, missing_dates_json: "[]", lease_owner: "old-owner", lease_expires_at: "2026-07-18T00:00:00Z" }],
    ["00919.TW", { symbol: "00919.TW", source: "user", active: 1, status: "running", expected_weeks: 51, completed_weeks: 20, missing_dates_json: '["2026-07-03"]', lease_owner: "runner-1" }],
    ["8069.TWO", { symbol: "8069.TWO", source: "user", active: 1, status: "blocked", expected_weeks: 51, completed_weeks: 13, missing_dates_json: '["2026-07-03"]', last_error_code: "captcha_or_blocked" }],
  ]);
  const db = new TargetDb(rows, new Map());
  const queued = await queueTdccContinuousSymbolBackfill({ db, symbol: "2324.tw", now: "2026-07-19T06:00:00Z" });
  const repeated = await queueTdccContinuousSymbolBackfill({ db, symbol: "2324.TW", now: "2026-07-19T06:01:00Z" });
  const running = await queueTdccContinuousSymbolBackfill({ db, symbol: "00919.TW" });
  const blocked = await queueTdccContinuousSymbolBackfill({ db, symbol: "8069.TWO" });

  assert.equal(queued.status, "queued");
  assert.equal(repeated.status, "queued");
  assert.equal(rows.get("2324.TW").lease_owner, null);
  assert.equal(running.status, "already-running");
  assert.equal(rows.get("00919.TW").lease_owner, "runner-1");
  assert.equal(blocked.status, "blocked");
  assert.equal(rows.get("8069.TWO").last_error_code, "captcha_or_blocked");
  assert.deepEqual(rows.get("2317.TW"), untouched);
  assert.deepEqual(db.writes, ["2324.TW"]);
});

test("D1 migration 保留逐 symbol、run、item 唯一鍵與 queue/lease index", () => {
  for (const table of ["tdcc_continuous_runs", "tdcc_continuous_symbols", "tdcc_continuous_items"]) assert.match(migration, new RegExp(`CREATE TABLE.*${table}`, "s"));
  assert.match(migration, /PRIMARY KEY\(`symbol`,\s*`data_date`\)/);
  assert.match(migration, /tdcc_continuous_symbols_queue_idx/);
  assert.match(migration, /tdcc_continuous_symbols_lease_idx/);
});

test("GitHub scheduler 有最小權限、單例、timeout、secret preflight 且無固定 symbols", () => {
  assert.match(workflow, /cron: "30 14 \* \* 6,0"/);
  assert.match(workflow, /CHIP_BACKFILL_SCOPE: tdcc-weekly/);
  assert.match(dailyWorkflow, /cron: "30 14 \* \* \*"/);
  assert.match(dailyWorkflow, /CHIP_BACKFILL_SCOPE: daily/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /timeout-minutes: 25/);
  assert.match(workflow, /secrets\.SITES_BYPASS_TOKEN/);
  assert.match(workflow, /secrets\.TDCC_CONTINUOUS_BACKFILL_SECRET/);
  assert.doesNotMatch(workflow, /--symbols=/);
  assert.doesNotMatch(workflow, /set -x/);
  assert.doesNotMatch(workflow, /playwright install|Install Chromium/);
  assert.doesNotMatch(dailyWorkflow, /--history-only|actions\/checkout/);
});

test("workflow 只喚醒 Sites orchestrator，再執行 history-only 來源 adapter", () => {
  assert.match(workflow, /orchestrator-start/);
  assert.match(workflow, /orchestrator-tick/);
  assert.match(workflow, /orchestrator-fail/);
  assert.match(workflow, /trap finalize_failure EXIT/);
  assert.match(workflow, /tick_limit_exceeded/);
  assert.match(workflow, /chip-orchestrator tick=/);
  for (const field of ["status", "phase", "processedSymbols", "remainingSymbols", "pendingSymbols", "reason"]) assert.match(workflow, new RegExp(field));
  assert.doesNotMatch(workflow, /echo ["']?\$response/);
  assert.match(workflow, /--history-only/);
  assert.doesNotMatch(workflow, /refresh-latest|chip-targets/);
  assert.match(runnerSource, /if \(!options\.historyOnly\)/);
});

test("每日 workflow tick 上限會輸出安全摘要、只收尾 daily run 並失敗退出", () => {
  const result = runOrchestratorScript(pendingThenRecoverableCurl);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /tick=60 scope=daily status=running phase=daily processed=1 remaining=1 pending=1 reason=rate_limited/);
  assert.match(result.stdout, /tick=finalize scope=daily status=failed phase=failed processed=60 remaining=1 pending=1 reason=tick_limit_exceeded recovery=not_needed/);
  assert.doesNotMatch(result.stdout, /must-not-leak|test-sites-token|test-worker-secret/);
});

test("每日 workflow HTTP timeout 只以 allowlist reason 收尾，不輸出完整 response", () => {
  const result = runOrchestratorScript(timeoutThenRecoverableCurl);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /tick=finalize scope=daily status=failed phase=failed processed=0 remaining=0 pending=0 reason=timeout recovery=not_needed/);
  assert.doesNotMatch(result.stdout, /test-sites-token|test-worker-secret/);
});

test("history-only adapter 未獲允許時安全 no-op，不接手 latest 或 daily", () => {
  const permissionPosition = runnerSource.indexOf("if (!control.historyAutomationEnabled)");
  const historyPosition = runnerSource.indexOf("createTdccHistorySession()", permissionPosition);
  assert.equal(permissionPosition < historyPosition, true);
  assert.match(runnerSource, /historySkipped: "history_automation_not_permitted"/);
});

test("TDCC 公開表單 session 僅存在 GitHub runner，Worker 與前端只含控制面與逐 symbol UI 狀態", () => {
  assert.match(runnerSource, /SYNCHRONIZER_TOKEN/);
  assert.doesNotMatch(runnerSource, /chromium\.launch|playwright-core/);
  assert.doesNotMatch(workerSource, /from ["']playwright/);
  assert.doesNotMatch(paneSource, /playwright|TDCC_CONTINUOUS_BACKFILL_SECRET/);
  for (const label of ["等待背景回補", "背景歷史回補中", "回補未完成", "來源阻擋", "歷史已更新", "目前僅 1 期／尚無前週比較"]) assert.match(paneSource, new RegExp(label));
});
