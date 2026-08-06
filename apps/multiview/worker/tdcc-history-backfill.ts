export const TDCC_HISTORY_JOB_STATES = ["idle", "queued", "running", "partial", "completed", "failed"] as const;
export type TdccHistoryJobState = typeof TDCC_HISTORY_JOB_STATES[number];
export const TDCC_HISTORY_MODES = ["official-file-import", "local-operator-query"] as const;
export type TdccHistoryMode = typeof TDCC_HISTORY_MODES[number];

export type TdccHistoryBackfillStatus = {
  jobId: string | null;
  mode: TdccHistoryMode | null;
  targetSymbolCount: number;
  status: TdccHistoryJobState;
  targetStart: string | null;
  targetEnd: string | null;
  expectedWeeks: number;
  completedWeeks: number;
  failedWeeks: number;
  checkpoint: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  savedWeeks: number;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  updatedAt: string | null;
};

type TdccHistoryJobRow = {
  job_id: string;
  mode: TdccHistoryMode;
  expected_symbols?: number | null;
  status: TdccHistoryJobState;
  target_start?: string | null;
  target_end?: string | null;
  expected_weeks?: number | null;
  completed_weeks?: number | null;
  failed_weeks?: number | null;
  checkpoint_date?: string | null;
  last_success_at?: string | null;
  last_error_code?: string | null;
  updated_at?: string | null;
  target_symbols_json?: string | null;
  expected_dates_json?: string | null;
};

type TdccHistoryCoverageRow = {
  coverage_start?: string | null;
  coverage_end?: string | null;
  saved_weeks?: number | null;
  last_success_at?: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const JOB_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TAIWAN_SYMBOL = /^[0-9A-Z]{4,8}\.(TW|TWO)$/;
const SAFE_ERRORS = new Set(["invalid_response", "history_source_unverified", "provider_unavailable", "rate_limited", "d1_unavailable"]);

function realIsoDate(value: unknown) {
  const text = String(value || "");
  if (!ISO_DATE.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}
export function validateTdccBackfillDates(input: unknown, now = new Date()) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 60) throw new Error("invalid_response");
  const dates = [...new Set(input.map(String))].sort();
  if (dates.length !== input.length || dates.some((date) => !realIsoDate(date))) throw new Error("invalid_response");
  const oldest = new Date(now); oldest.setUTCDate(oldest.getUTCDate() - 370);
  const newest = new Date(now); newest.setUTCDate(newest.getUTCDate() + 7);
  if (dates.some((date) => new Date(`${date}T00:00:00Z`) < oldest || new Date(`${date}T00:00:00Z`) > newest)) throw new Error("invalid_response");
  return dates;
}

export function safeTdccBackfillError(value: unknown) {
  const code = String(value || "invalid_response");
  return SAFE_ERRORS.has(code) ? code : "invalid_response";
}

export function validateTdccBackfillSymbols(input: unknown, mode: TdccHistoryMode) {
  if (mode === "official-file-import") {
    if (input !== undefined && (!Array.isArray(input) || input.length)) throw new Error("invalid_response");
    return [];
  }
  if (!Array.isArray(input) || input.length < 1 || input.length > 64) throw new Error("invalid_response");
  const symbols = input.map((value) => String(value || "").trim().toUpperCase());
  if (new Set(symbols).size !== symbols.length || symbols.some((symbol) => !TAIWAN_SYMBOL.test(symbol))) throw new Error("invalid_response");
  return symbols.sort();
}

function idleStatus(): TdccHistoryBackfillStatus {
  return {
    jobId: null, mode: null, targetSymbolCount: 0, status: "idle", targetStart: null, targetEnd: null,
    expectedWeeks: 0, completedWeeks: 0, failedWeeks: 0, checkpoint: null,
    coverageStart: null, coverageEnd: null, savedWeeks: 0, lastSuccessAt: null,
    lastErrorCode: null, updatedAt: null,
  };
}

export async function readTdccHistoryBackfillStatus(db?: D1Database): Promise<TdccHistoryBackfillStatus> {
  if (!db) return idleStatus();
  try {
    const job = await db.prepare("SELECT * FROM tdcc_shareholder_backfill_job ORDER BY updated_at DESC LIMIT 1").first<TdccHistoryJobRow>();
    const coverage = await db.prepare("SELECT MIN(data_date) AS coverage_start, MAX(data_date) AS coverage_end, COUNT(DISTINCT data_date) AS saved_weeks, MAX(source_fetched_at) AS last_success_at FROM taiwan_stock_shareholder_distribution").first<TdccHistoryCoverageRow>();
    if (!job) return { ...idleStatus(), coverageStart: coverage?.coverage_start || null, coverageEnd: coverage?.coverage_end || null, savedWeeks: Number(coverage?.saved_weeks || 0), lastSuccessAt: coverage?.last_success_at || null };
    return {
      jobId: String(job.job_id),
      mode: TDCC_HISTORY_MODES.includes(job.mode) ? job.mode : "official-file-import",
      targetSymbolCount: Number(job.expected_symbols || 0),
      status: TDCC_HISTORY_JOB_STATES.includes(job.status) ? job.status : "failed",
      targetStart: job.target_start || null,
      targetEnd: job.target_end || null,
      expectedWeeks: Number(job.expected_weeks || 0),
      completedWeeks: Number(job.completed_weeks || 0),
      failedWeeks: Number(job.failed_weeks || 0),
      checkpoint: job.checkpoint_date || null,
      coverageStart: coverage?.coverage_start || null,
      coverageEnd: coverage?.coverage_end || null,
      savedWeeks: Number(coverage?.saved_weeks || 0),
      lastSuccessAt: coverage?.last_success_at || job.last_success_at || null,
      lastErrorCode: job.last_error_code || null,
      updatedAt: job.updated_at || null,
    };
  } catch {
    return idleStatus();
  }
}

export async function startTdccHistoryBackfill(input: { db: D1Database; jobId: string; expectedDates: string[]; mode?: TdccHistoryMode; targetSymbols?: string[]; now?: Date }) {
  if (!JOB_ID.test(input.jobId)) throw new Error("invalid_response");
  const mode = input.mode || "official-file-import";
  if (!TDCC_HISTORY_MODES.includes(mode)) throw new Error("invalid_response");
  const dates = validateTdccBackfillDates(input.expectedDates, input.now);
  const targetSymbols = validateTdccBackfillSymbols(input.targetSymbols, mode);
  await input.db.prepare(`INSERT INTO tdcc_shareholder_backfill_job
    (job_id,mode,target_start,target_end,expected_dates_json,target_symbols_json,expected_symbols,expected_weeks,completed_weeks,failed_weeks,checkpoint_date,status,last_error_code,last_success_at)
    VALUES (?,?,?,?,?,?,?,?,0,0,NULL,'queued',NULL,NULL)
    ON CONFLICT(job_id) DO UPDATE SET mode=excluded.mode,target_start=excluded.target_start,target_end=excluded.target_end,
      expected_dates_json=excluded.expected_dates_json,target_symbols_json=excluded.target_symbols_json,expected_symbols=excluded.expected_symbols,expected_weeks=excluded.expected_weeks,
      completed_weeks=(SELECT COUNT(*) FROM tdcc_shareholder_backfill_week WHERE job_id=excluded.job_id AND status='completed'),
      failed_weeks=(SELECT COUNT(*) FROM tdcc_shareholder_backfill_week WHERE job_id=excluded.job_id AND status='failed'),
      checkpoint_date=(SELECT MAX(data_date) FROM tdcc_shareholder_backfill_week WHERE job_id=excluded.job_id AND status='completed'),
      status='queued',last_error_code=NULL,updated_at=CURRENT_TIMESTAMP`).bind(
    input.jobId, mode, dates[0], dates.at(-1), JSON.stringify(dates), JSON.stringify(targetSymbols), targetSymbols.length, dates.length,
  ).run();
  return readTdccHistoryBackfillStatus(input.db);
}

async function readJob(db: D1Database, jobId: string) {
  if (!JOB_ID.test(jobId)) throw new Error("invalid_response");
  const job = await db.prepare("SELECT * FROM tdcc_shareholder_backfill_job WHERE job_id = ?").bind(jobId).first<TdccHistoryJobRow>();
  if (!job) throw new Error("invalid_response");
  return job;
}

export async function readTdccHistoryBackfillDefinition(db: D1Database, jobId: string) {
  const job = await readJob(db, jobId);
  const mode: TdccHistoryMode = TDCC_HISTORY_MODES.includes(job.mode) ? job.mode : "official-file-import";
  const targetSymbols = validateTdccBackfillSymbols(JSON.parse(String(job.target_symbols_json || "[]")), mode);
  return {
    mode,
    targetSymbols,
    expectedDates: validateTdccBackfillDates(JSON.parse(String(job.expected_dates_json || "[]"))),
  };
}

export async function markTdccBackfillWeekRunning(db: D1Database, jobId: string, dataDate: string) {
  const job = await readJob(db, jobId);
  const expected = JSON.parse(String(job.expected_dates_json || "[]"));
  if (!realIsoDate(dataDate) || !Array.isArray(expected) || !expected.includes(dataDate)) throw new Error("invalid_response");
  await db.batch([
    db.prepare(`INSERT INTO tdcc_shareholder_backfill_week (job_id,data_date,status,row_count,symbol_count,error_code,attempts)
      VALUES (?,?,'running',0,0,NULL,1)
      ON CONFLICT(job_id,data_date) DO UPDATE SET status='running',error_code=NULL,attempts=tdcc_shareholder_backfill_week.attempts+1,updated_at=CURRENT_TIMESTAMP`).bind(jobId, dataDate),
    db.prepare("UPDATE tdcc_shareholder_backfill_job SET status='running',last_error_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE job_id=?").bind(jobId),
  ]);
}

export async function completeTdccBackfillWeek(db: D1Database, jobId: string, dataDate: string, rowCount: number, symbolCount: number) {
  await readJob(db, jobId);
  await db.batch([
    db.prepare(`UPDATE tdcc_shareholder_backfill_week SET status='completed',row_count=?,symbol_count=?,error_code=NULL,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND data_date=?`).bind(rowCount, symbolCount, jobId, dataDate),
    db.prepare(`UPDATE tdcc_shareholder_backfill_job SET
      completed_weeks=(SELECT COUNT(*) FROM tdcc_shareholder_backfill_week WHERE job_id=? AND status='completed'),
      failed_weeks=(SELECT COUNT(*) FROM tdcc_shareholder_backfill_week WHERE job_id=? AND status='failed'),
      checkpoint_date=(SELECT MAX(data_date) FROM tdcc_shareholder_backfill_week WHERE job_id=? AND status='completed'),
      status=CASE WHEN (SELECT COUNT(*) FROM tdcc_shareholder_backfill_week WHERE job_id=? AND status='completed') >= expected_weeks THEN 'completed' ELSE 'running' END,
      last_success_at=CURRENT_TIMESTAMP,last_error_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE job_id=?`).bind(jobId, jobId, jobId, jobId, jobId),
  ]);
  return readTdccHistoryBackfillStatus(db);
}

export async function failTdccBackfillWeek(db: D1Database, jobId: string, dataDate: string, reason: unknown) {
  const code = safeTdccBackfillError(reason);
  await readJob(db, jobId);
  await db.batch([
    db.prepare(`UPDATE tdcc_shareholder_backfill_week SET status='failed',error_code=?,updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND data_date=?`).bind(code, jobId, dataDate),
    db.prepare(`UPDATE tdcc_shareholder_backfill_job SET
      completed_weeks=(SELECT COUNT(*) FROM tdcc_shareholder_backfill_week WHERE job_id=? AND status='completed'),
      failed_weeks=(SELECT COUNT(*) FROM tdcc_shareholder_backfill_week WHERE job_id=? AND status='failed'),
      status=CASE WHEN (SELECT COUNT(*) FROM tdcc_shareholder_backfill_week WHERE job_id=? AND status='completed') > 0 THEN 'partial' ELSE 'failed' END,
      last_error_code=?,updated_at=CURRENT_TIMESTAMP WHERE job_id=?`).bind(jobId, jobId, jobId, code, jobId),
  ]);
  return readTdccHistoryBackfillStatus(db);
}
