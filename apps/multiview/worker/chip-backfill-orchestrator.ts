export const CHIP_BACKFILL_ORCHESTRATOR_CONTRACT = Object.freeze({
  runtime: "sites-worker",
  scheduler: "sites-scheduled+protected-http-tick",
  batchSize: 1,
  attemptCooldownMs: 4 * 60 * 60 * 1000,
  taipeiPublicationCutoffHour: 22,
  scopes: ["combined", "daily", "tdcc-weekly"] as const,
  safeReasonCodes: ["source_not_published", "rate_limited", "provider_unavailable", "timeout", "invalid_response", "tick_limit_exceeded"] as const,
});

export type ChipBackfillTrigger = "schedule" | "workflow_dispatch" | "scheduled";
export type ChipBackfillPhase = "latest" | "daily" | "completed" | "failed";
export type ChipBackfillScope = "combined" | "daily" | "tdcc-weekly";

type RunRow = {
  run_id?: string | null;
  scope?: string | null;
  trigger?: string | null;
  status?: string | null;
  phase?: string | null;
  expected_session_date?: string | null;
  latest_data_date?: string | null;
  processed_symbols_json?: string | null;
  processed_symbols?: number | null;
  remaining_symbols?: number | null;
  pending_symbols?: number | null;
  last_symbol?: string | null;
  last_reason_code?: string | null;
  heartbeat_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
};

const RUN_ID = /^[a-zA-Z0-9._:-]{1,96}$/;
const SYMBOL = /^[0-9A-Z]{4,8}\.(TW|TWO)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: unknown) {
  const text = String(value || "");
  if (!ISO_DATE.test(text)) return false;
  return new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
}

function iso(value: Date | string = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid_response");
  return date.toISOString();
}

function taipeiParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
  };
}

function previousWeekday(dateText: string, days = 1) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function latestCompletedTaiwanSessionDate(now: Date | string = new Date()) {
  const current = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(current.getTime())) throw new Error("invalid_response");
  const taipei = taipeiParts(current);
  const weekday = new Date(`${taipei.date}T00:00:00Z`).getUTCDay();
  if (weekday === 6) return previousWeekday(taipei.date);
  if (weekday === 0) return previousWeekday(taipei.date);
  if (taipei.hour < CHIP_BACKFILL_ORCHESTRATOR_CONTRACT.taipeiPublicationCutoffHour) return previousWeekday(taipei.date);
  return taipei.date;
}

function processedSymbols(row: RunRow) {
  try {
    const parsed = JSON.parse(String(row.processed_symbols_json || "[]"));
    return new Set(Array.isArray(parsed) ? parsed.map(String).filter((symbol) => SYMBOL.test(symbol)) : []);
  } catch {
    return new Set<string>();
  }
}

function toRun(row: RunRow | null) {
  if (!row) return null;
  return {
    runId: row.run_id || "",
    scope: CHIP_BACKFILL_ORCHESTRATOR_CONTRACT.scopes.includes(String(row.scope || "combined") as never) ? row.scope || "combined" : "combined",
    trigger: row.trigger || "",
    status: row.status || "",
    phase: row.phase || "",
    expectedSessionDate: row.expected_session_date || null,
    latestDataDate: row.latest_data_date || null,
    processedSymbols: Number(row.processed_symbols || 0),
    remainingSymbols: Number(row.remaining_symbols || 0),
    pendingSymbols: Number(row.pending_symbols || 0),
    lastSymbol: row.last_symbol || null,
    lastReasonCode: row.last_reason_code || null,
    heartbeatAt: row.heartbeat_at || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
  };
}

export function safeChipBackfillWorkflowSummary(value: unknown) {
  const run = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const status = String(run.status || "");
  const phase = String(run.phase || "");
  const scope = String(run.scope || "");
  const reason = String(run.lastReasonCode || "");
  const count = (input: unknown) => Number.isSafeInteger(Number(input)) && Number(input) >= 0 ? Number(input) : 0;
  return {
    scope: CHIP_BACKFILL_ORCHESTRATOR_CONTRACT.scopes.includes(scope as never) ? scope : "unknown",
    status: ["running", "completed", "failed"].includes(status) ? status : "unknown",
    phase: ["latest", "daily", "completed", "failed"].includes(phase) ? phase : "unknown",
    processedSymbols: count(run.processedSymbols),
    remainingSymbols: count(run.remainingSymbols),
    pendingSymbols: count(run.pendingSymbols),
    reason: CHIP_BACKFILL_ORCHESTRATOR_CONTRACT.safeReasonCodes.includes(reason as never) ? reason : null,
  };
}

export async function startChipBackfillOrchestratorRun(input: {
  db: D1Database;
  runId: string;
  trigger: ChipBackfillTrigger;
  scope?: ChipBackfillScope;
  now?: Date | string;
}) {
  const scope = input.scope || "combined";
  if (!RUN_ID.test(input.runId) || !["schedule", "workflow_dispatch", "scheduled"].includes(input.trigger) || !CHIP_BACKFILL_ORCHESTRATOR_CONTRACT.scopes.includes(scope)) throw new Error("invalid_response");
  const now = iso(input.now);
  const expected = latestCompletedTaiwanSessionDate(now);
  const phase: ChipBackfillPhase = scope === "daily" ? "daily" : "latest";
  await input.db.prepare(`INSERT INTO chip_backfill_orchestrator_runs
    (run_id,scope,trigger,status,phase,expected_session_date,heartbeat_at,started_at)
    VALUES (?,?,?,'running',?,?,?,?)
    ON CONFLICT(run_id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at,updated_at=CURRENT_TIMESTAMP`)
    .bind(input.runId, scope, input.trigger, phase, expected, now, now).run();
  const run = await readChipBackfillOrchestratorRun(input.db, input.runId);
  if (run?.scope !== scope) throw new Error("invalid_response");
  return run;
}

export async function advanceChipBackfillOrchestratorRun(input: {
  db: D1Database;
  runId: string;
  phase?: ChipBackfillPhase;
  latestDataDate?: string | null;
  symbols?: string[];
  remainingSymbols?: number;
  pendingSymbols?: number;
  lastReasonCode?: string | null;
  done?: boolean;
  now?: Date | string;
}) {
  if (!RUN_ID.test(input.runId) || (input.latestDataDate && !validDate(input.latestDataDate))) throw new Error("invalid_response");
  const row = await input.db.prepare("SELECT * FROM chip_backfill_orchestrator_runs WHERE run_id=?").bind(input.runId).first<RunRow>();
  if (!row) throw new Error("invalid_response");
  const symbols = processedSymbols(row);
  for (const value of input.symbols || []) {
    const symbol = String(value || "").toUpperCase();
    if (!SYMBOL.test(symbol)) throw new Error("invalid_response");
    symbols.add(symbol);
  }
  const now = iso(input.now);
  const done = Boolean(input.done);
  const phase = done ? "completed" : input.phase || row.phase || "daily";
  await input.db.prepare(`UPDATE chip_backfill_orchestrator_runs SET
    status=?,phase=?,latest_data_date=COALESCE(?,latest_data_date),
    processed_symbols_json=?,processed_symbols=?,remaining_symbols=?,pending_symbols=?,
    last_symbol=?,last_reason_code=?,heartbeat_at=?,completed_at=?,updated_at=CURRENT_TIMESTAMP
    WHERE run_id=?`).bind(
    done ? "completed" : phase === "failed" ? "failed" : "running",
    phase,
    input.latestDataDate || null,
    JSON.stringify([...symbols].sort()),
    symbols.size,
    Math.max(0, Number(input.remainingSymbols ?? row.remaining_symbols ?? 0)),
    Math.max(0, Number(input.pendingSymbols ?? row.pending_symbols ?? 0)),
    (input.symbols || []).at(-1) || row.last_symbol || null,
    input.lastReasonCode === undefined ? row.last_reason_code || null : input.lastReasonCode,
    now,
    done ? now : null,
    input.runId,
  ).run();
  const updated = await readChipBackfillOrchestratorRun(input.db, input.runId);
  if (!updated) throw new Error("invalid_response");
  return updated;
}

export async function failChipBackfillOrchestratorRun(input: { db: D1Database; runId: string; reason: string; now?: Date | string }) {
  if (!RUN_ID.test(input.runId)) throw new Error("invalid_response");
  const current = await readChipBackfillOrchestratorRun(input.db, input.runId);
  if (!current) throw new Error("invalid_response");
  if (["completed", "failed"].includes(current.status)) return current;
  const reason = CHIP_BACKFILL_ORCHESTRATOR_CONTRACT.safeReasonCodes.includes(input.reason as never) ? input.reason : "invalid_response";
  const now = iso(input.now);
  await input.db.prepare("UPDATE chip_backfill_orchestrator_runs SET status='failed',phase='failed',last_reason_code=?,heartbeat_at=?,completed_at=?,updated_at=CURRENT_TIMESTAMP WHERE run_id=?")
    .bind(reason, now, now, input.runId).run();
  const failed = await readChipBackfillOrchestratorRun(input.db, input.runId);
  if (!failed) throw new Error("invalid_response");
  return failed;
}

export async function readChipBackfillOrchestratorRun(db: D1Database, runId: string) {
  if (!RUN_ID.test(runId)) throw new Error("invalid_response");
  return toRun(await db.prepare("SELECT * FROM chip_backfill_orchestrator_runs WHERE run_id=?").bind(runId).first<RunRow>());
}

export async function readChipBackfillOrchestratorHealth(db?: D1Database) {
  if (!db) return { configured: false, status: "unavailable", runtime: CHIP_BACKFILL_ORCHESTRATOR_CONTRACT.runtime, lastReasonCode: "d1_unavailable" };
  try {
    const row = await db.prepare("SELECT * FROM chip_backfill_orchestrator_runs ORDER BY updated_at DESC LIMIT 1").first<RunRow>();
    if (!row) return { configured: true, status: "idle", runtime: CHIP_BACKFILL_ORCHESTRATOR_CONTRACT.runtime, contract: CHIP_BACKFILL_ORCHESTRATOR_CONTRACT };
    return { configured: true, runtime: CHIP_BACKFILL_ORCHESTRATOR_CONTRACT.runtime, contract: CHIP_BACKFILL_ORCHESTRATOR_CONTRACT, ...toRun(row) };
  } catch {
    return { configured: false, status: "unavailable", runtime: CHIP_BACKFILL_ORCHESTRATOR_CONTRACT.runtime, lastReasonCode: "d1_unavailable" };
  }
}
