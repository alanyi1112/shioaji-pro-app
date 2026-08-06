import assert from "node:assert/strict";
import test from "node:test";
import {
  completeTdccBackfillWeek,
  failTdccBackfillWeek,
  markTdccBackfillWeekRunning,
  readTdccHistoryBackfillDefinition,
  readTdccHistoryBackfillStatus,
  safeTdccBackfillError,
  startTdccHistoryBackfill,
  validateTdccBackfillDates,
  validateTdccBackfillSymbols,
} from "../worker/tdcc-history-backfill.ts";

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() {
    if (this.sql.includes("FROM tdcc_shareholder_backfill_job") && this.sql.includes("WHERE job_id")) return this.db.jobs.get(this.args[0]) || null;
    if (this.sql.includes("FROM tdcc_shareholder_backfill_job")) return [...this.db.jobs.values()].at(-1) || null;
    if (this.sql.includes("COUNT(DISTINCT data_date)")) {
      const rows = [...this.db.distribution.values()];
      const dates = [...new Set(rows.map((row) => row.data_date))].sort();
      return { coverage_start: dates[0] || null, coverage_end: dates.at(-1) || null, saved_weeks: dates.length, last_success_at: rows.map((row) => row.source_fetched_at).sort().at(-1) || null };
    }
    return null;
  }
  async run() {
    if (this.sql.startsWith("INSERT INTO tdcc_shareholder_backfill_job")) {
      const [job_id, mode, target_start, target_end, expected_dates_json, target_symbols_json, expected_symbols, expected_weeks] = this.args;
      const current = this.db.jobs.get(job_id) || {};
      const weeks = [...this.db.weeks.values()].filter((row) => row.job_id === job_id);
      this.db.jobs.set(job_id, { ...current, job_id, mode, target_start, target_end, expected_dates_json, target_symbols_json, expected_symbols, expected_weeks, completed_weeks: weeks.filter((row) => row.status === "completed").length, failed_weeks: weeks.filter((row) => row.status === "failed").length, checkpoint_date: weeks.filter((row) => row.status === "completed").map((row) => row.data_date).sort().at(-1) || null, status: "queued", last_error_code: null, updated_at: "2026-07-16T00:00:00Z" });
    } else if (this.sql.startsWith("INSERT INTO tdcc_shareholder_backfill_week")) {
      const [job_id, data_date] = this.args; const key = `${job_id}|${data_date}`; const current = this.db.weeks.get(key) || {};
      this.db.weeks.set(key, { ...current, job_id, data_date, status: "running", attempts: Number(current.attempts || 0) + 1, error_code: null });
    } else if (this.sql.startsWith("UPDATE tdcc_shareholder_backfill_week SET status='completed'")) {
      const [row_count, symbol_count, job_id, data_date] = this.args; const key = `${job_id}|${data_date}`;
      this.db.weeks.set(key, { ...this.db.weeks.get(key), status: "completed", row_count, symbol_count, error_code: null });
    } else if (this.sql.startsWith("UPDATE tdcc_shareholder_backfill_week SET status='failed'")) {
      const [error_code, job_id, data_date] = this.args; const key = `${job_id}|${data_date}`;
      this.db.weeks.set(key, { ...this.db.weeks.get(key), status: "failed", error_code });
    } else if (this.sql.startsWith("UPDATE tdcc_shareholder_backfill_job SET status='running'")) {
      const job = this.db.jobs.get(this.args[0]); Object.assign(job, { status: "running", last_error_code: null });
    } else if (this.sql.startsWith("UPDATE tdcc_shareholder_backfill_job SET")) {
      const job_id = this.args.at(-1); const job = this.db.jobs.get(job_id); const weeks = [...this.db.weeks.values()].filter((row) => row.job_id === job_id);
      const completed = weeks.filter((row) => row.status === "completed"); const failed = weeks.filter((row) => row.status === "failed");
      job.completed_weeks = completed.length; job.failed_weeks = failed.length; job.checkpoint_date = completed.map((row) => row.data_date).sort().at(-1) || null;
      if (this.sql.includes("last_success_at=CURRENT_TIMESTAMP")) job.status = completed.length >= job.expected_weeks ? "completed" : "running";
      else { job.status = completed.length ? "partial" : "failed"; job.last_error_code = this.args.at(-2); }
    }
    return { success: true };
  }
}

class FakeD1 {
  constructor() { this.jobs = new Map(); this.weeks = new Map(); this.distribution = new Map(); }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); }
}

test("TDCC 回補日期只接受一年內、不重複的官方週日期", () => {
  const now = new Date("2026-07-16T00:00:00Z");
  assert.deepEqual(validateTdccBackfillDates(["2026-07-09", "2026-07-03"], now), ["2026-07-03", "2026-07-09"]);
  assert.throws(() => validateTdccBackfillDates(["2026-07-09", "2026-07-09"], now), /invalid_response/);
  assert.throws(() => validateTdccBackfillDates(["2024-01-01", "2026-07-09"], now), /invalid_response/);
  assert.throws(() => validateTdccBackfillDates(["2026-02-30", "2026-07-09"], now), /invalid_response/);
});

test("本機低速查詢只接受明確且不重複的台股目標清單", () => {
  assert.deepEqual(validateTdccBackfillSymbols(["2330.tw", "00919.TW"], "local-operator-query"), ["00919.TW", "2330.TW"]);
  assert.deepEqual(validateTdccBackfillSymbols(undefined, "official-file-import"), []);
  assert.throws(() => validateTdccBackfillSymbols(["2330.TW"], "official-file-import"), /invalid_response/);
  assert.throws(() => validateTdccBackfillSymbols(["2330.TW", "2330.tw"], "local-operator-query"), /invalid_response/);
  assert.throws(() => validateTdccBackfillSymbols(["AAPL"], "local-operator-query"), /invalid_response/);
});

test("本機低速查詢 job 保存目標清單與模式", async () => {
  const db = new FakeD1();
  const started = await startTdccHistoryBackfill({
    db,
    jobId: "tdcc-local-test",
    expectedDates: ["2026-07-03", "2026-07-09"],
    mode: "local-operator-query",
    targetSymbols: ["2330.TW", "00919.TW"],
    now: new Date("2026-07-16T00:00:00Z"),
  });
  assert.equal(started.mode, "local-operator-query");
  assert.equal(started.targetSymbolCount, 2);
  assert.deepEqual(await readTdccHistoryBackfillDefinition(db, "tdcc-local-test"), {
    mode: "local-operator-query",
    targetSymbols: ["00919.TW", "2330.TW"],
    expectedDates: ["2026-07-03", "2026-07-09"],
  });
});

test("TDCC 回補 job 可從 queued 續跑至 completed，coverage 以 distinct 日期計算", async () => {
  const db = new FakeD1();
  db.distribution.set("2330|2026-07-03", { data_date: "2026-07-03", source_fetched_at: "2026-07-16T01:00:00Z" });
  const started = await startTdccHistoryBackfill({ db, jobId: "tdcc-one-year", expectedDates: ["2026-07-03", "2026-07-09"], now: new Date("2026-07-16T00:00:00Z") });
  assert.equal(started.status, "queued"); assert.equal(started.expectedWeeks, 2); assert.equal(started.savedWeeks, 1);
  await markTdccBackfillWeekRunning(db, "tdcc-one-year", "2026-07-03");
  const running = await completeTdccBackfillWeek(db, "tdcc-one-year", "2026-07-03", 34, 2);
  assert.equal(running.status, "running"); assert.equal(running.completedWeeks, 1); assert.equal(running.checkpoint, "2026-07-03");
  await markTdccBackfillWeekRunning(db, "tdcc-one-year", "2026-07-09");
  const complete = await completeTdccBackfillWeek(db, "tdcc-one-year", "2026-07-09", 34, 2);
  assert.equal(complete.status, "completed"); assert.equal(complete.completedWeeks, 2);
});

test("TDCC 回補失敗只輸出 allowlist error 並保留已成功週", async () => {
  const db = new FakeD1();
  await startTdccHistoryBackfill({ db, jobId: "tdcc-one-year", expectedDates: ["2026-07-03", "2026-07-09"], now: new Date("2026-07-16T00:00:00Z") });
  await markTdccBackfillWeekRunning(db, "tdcc-one-year", "2026-07-03");
  await completeTdccBackfillWeek(db, "tdcc-one-year", "2026-07-03", 17, 1);
  await markTdccBackfillWeekRunning(db, "tdcc-one-year", "2026-07-09");
  const partial = await failTdccBackfillWeek(db, "tdcc-one-year", "2026-07-09", "secret upstream body");
  assert.equal(partial.status, "partial"); assert.equal(partial.completedWeeks, 1); assert.equal(partial.failedWeeks, 1); assert.equal(partial.lastErrorCode, "invalid_response");
  assert.equal(safeTdccBackfillError("rate_limited"), "rate_limited");
});

test("沒有 job 時狀態為 idle，不得暗示正在下載", async () => {
  assert.deepEqual((await readTdccHistoryBackfillStatus(new FakeD1())).status, "idle");
});
