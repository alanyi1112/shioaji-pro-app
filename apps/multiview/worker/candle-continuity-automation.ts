import { runD1Batch } from "./d1-batch.ts";

export const CANDLE_CONTINUITY_AUTOMATION_CONTRACT = Object.freeze({
  batchLimit: 8,
  concurrency: 2,
  leaseSeconds: 180,
  maximumTicks: 60,
  maximumRunMs: 15 * 60 * 1000,
  requestTimeoutMs: 90_000,
  anomalyLimit: 20,
  sitesScheduleUtc: "0 15 * * *",
  cloudflareScheduleUtc: "30 15 * * *",
});

export const CANDLE_CONTINUITY_SAFE_REASONS = [
  "audit_failed",
  "audit_request_budget",
  "d1_unavailable",
  "invalid_response",
  "provider_unavailable",
  "rate_limited",
  "reference_not_published",
  "storage_unavailable",
  "tick_limit_exceeded",
  "timeout",
] as const;

type SafeReason = typeof CANDLE_CONTINUITY_SAFE_REASONS[number];
type RunStatus = "running" | "retry_waiting" | "completed" | "failed";
type ItemStatus = "queued" | "running" | "retry_waiting" | "fresh" | "complete" | "partial" | "unknown" | "failed" | "overdue";
type Trigger = "schedule" | "workflow_dispatch" | "local";
type DeploymentTarget = "sites" | "cloudflare" | "local";

const SYMBOL = /^\d{4,6}[A-Z]?\.(TW|TWO)$/;
const RUN_ID = /^[a-zA-Z0-9._:-]{1,128}$/;
const OWNER = /^[a-zA-Z0-9._:-]{1,128}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const terminalStatuses = new Set<ItemStatus>(["fresh", "complete", "partial", "unknown", "failed", "overdue"]);
const safeReasons = new Set<string>(CANDLE_CONTINUITY_SAFE_REASONS);

function iso(value: Date | string = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid_response");
  return date.toISOString();
}

function validDate(value: unknown) {
  const text = String(value || "");
  if (!ISO_DATE.test(text)) return false;
  return new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
}

function normalizedSymbol(value: unknown) {
  const symbol = String(value || "").trim().toUpperCase();
  if (!SYMBOL.test(symbol)) throw new Error("invalid_response");
  return symbol;
}

function validatedRunId(value: unknown) {
  const runId = String(value || "");
  if (!RUN_ID.test(runId)) throw new Error("invalid_response");
  return runId;
}

function validatedOwner(value: unknown) {
  const owner = String(value || "");
  if (!OWNER.test(owner)) throw new Error("invalid_response");
  return owner;
}

export function safeCandleContinuityReason(value: unknown): SafeReason {
  const raw = String(value instanceof Error ? value.message : value || "audit_failed");
  if (safeReasons.has(raw)) return raw as SafeReason;
  if (/429|rate.?limit/i.test(raw)) return "rate_limited";
  if (/timeout|abort/i.test(raw)) return "timeout";
  if (/not.?published|reference/i.test(raw)) return "reference_not_published";
  if (/d1|storage|write/i.test(raw)) return "storage_unavailable";
  if (/provider|fetch|http/i.test(raw)) return "provider_unavailable";
  return "audit_failed";
}

export type CandleContinuityDiscoveryCandidate = {
  symbol?: unknown;
  source?: "setup" | "user" | "catalog";
  enabled?: unknown;
  active?: unknown;
  quoteType?: unknown;
  group?: unknown;
  market?: unknown;
  coverageEnd?: unknown;
  continuityStatus?: unknown;
  missingSessionCount?: unknown;
  verifiedThrough?: unknown;
  checkedAt?: unknown;
  reasonCode?: unknown;
};

export type CandleContinuityTarget = {
  symbol: string;
  priority: number;
  status: "queued" | "fresh";
  coverageEnd: string | null;
  verifiedThrough: string | null;
  missingSessionCount: number;
  checkedAt: string | null;
  reasonCode: SafeReason | null;
};

function eligibleCandidate(candidate: CandleContinuityDiscoveryCandidate) {
  const symbol = String(candidate.symbol || "").trim().toUpperCase();
  if (!SYMBOL.test(symbol) || candidate.enabled === false || candidate.enabled === 0 || candidate.active === false || candidate.active === 0) return false;
  const quoteType = String(candidate.quoteType || "").trim().toUpperCase();
  const group = String(candidate.group || "").toUpperCase();
  const market = String(candidate.market || "").toUpperCase();
  if (quoteType && !["EQUITY", "ETF", "STOCK"].includes(quoteType)) return false;
  if (/INDEX|WARRANT|WRT|FUTURE|OPTION|REIT/.test(`${quoteType} ${group} ${market}`)) return false;
  return true;
}

function checkedFresh(checkedAt: string | null, now: string) {
  if (!checkedAt) return false;
  const age = Date.parse(now) - Date.parse(checkedAt);
  return Number.isFinite(age) && age >= 0 && age <= 20 * 60 * 60 * 1000;
}

function targetFromCandidate(candidate: CandleContinuityDiscoveryCandidate, expectedSession: string, now: string): CandleContinuityTarget {
  const symbol = normalizedSymbol(candidate.symbol);
  const continuityStatus = String(candidate.continuityStatus || "unknown");
  const missingSessionCount = Math.max(0, Number(candidate.missingSessionCount) || 0);
  const coverageEnd = validDate(candidate.coverageEnd) ? String(candidate.coverageEnd) : null;
  const verifiedThrough = validDate(candidate.verifiedThrough) ? String(candidate.verifiedThrough) : null;
  const checkedAt = typeof candidate.checkedAt === "string" && Number.isFinite(Date.parse(candidate.checkedAt)) ? candidate.checkedAt : null;
  const complete = continuityStatus === "complete" && missingSessionCount === 0 && verifiedThrough !== null && verifiedThrough >= expectedSession;
  const fresh = complete && checkedFresh(checkedAt, now);
  let priority = 60;
  if (!checkedAt) priority = 10;
  else if (missingSessionCount > 0) priority = 20;
  else if (String(candidate.reasonCode || "") === "reference_not_published") priority = 50;
  else if (["partial", "unknown"].includes(continuityStatus) || !checkedFresh(checkedAt, now)) priority = 30;
  else if (!coverageEnd || coverageEnd < expectedSession || !verifiedThrough || verifiedThrough < expectedSession) priority = 40;
  else if (fresh) priority = 90;
  return {
    symbol,
    priority,
    status: fresh ? "fresh" : "queued",
    coverageEnd,
    verifiedThrough,
    missingSessionCount,
    checkedAt,
    reasonCode: candidate.reasonCode ? safeCandleContinuityReason(candidate.reasonCode) : null,
  };
}

export function planCandleContinuityTargets(input: {
  candidates: CandleContinuityDiscoveryCandidate[];
  expectedSession: string;
  now?: Date | string;
}) {
  if (!validDate(input.expectedSession) || !Array.isArray(input.candidates) || input.candidates.length > 10_000) throw new Error("invalid_response");
  const now = iso(input.now);
  const merged = new Map<string, CandleContinuityDiscoveryCandidate>();
  for (const candidate of input.candidates) {
    if (!eligibleCandidate(candidate)) continue;
    const symbol = String(candidate.symbol || "").trim().toUpperCase();
    const previous = merged.get(symbol);
    if (!previous) merged.set(symbol, candidate);
    else merged.set(symbol, {
      ...previous,
      ...candidate,
      source: previous.source === "setup" || candidate.source === "setup" ? "setup" : previous.source === "user" || candidate.source === "user" ? "user" : "catalog",
      checkedAt: String(candidate.checkedAt || "") > String(previous.checkedAt || "") ? candidate.checkedAt : previous.checkedAt,
    });
  }
  return [...merged.values()]
    .map((candidate) => targetFromCandidate(candidate, input.expectedSession, now))
    .sort((a, b) => a.priority - b.priority || a.symbol.localeCompare(b.symbol));
}

export function candleContinuitySlaCheckpoint(expectedSession: string) {
  if (!validDate(expectedSession)) throw new Error("invalid_response");
  const next = new Date(`${expectedSession}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return `${next.toISOString().slice(0, 10)}T02:00:00.000Z`;
}

type RunRow = Record<string, unknown>;
type ItemRow = Record<string, unknown>;

function runSummary(row: RunRow | null) {
  if (!row) return null;
  return {
    runId: String(row.run_id || ""),
    deploymentTarget: String(row.deployment_target || ""),
    trigger: String(row.trigger || ""),
    commitSha: row.commit_sha || null,
    expectedSession: String(row.expected_session || ""),
    slaCheckpoint: String(row.sla_checkpoint || ""),
    status: String(row.status || ""),
    phase: String(row.phase || ""),
    cursor: Number(row.cursor || 0),
    heartbeatAt: row.heartbeat_at || null,
    reasonCode: row.reason_code || null,
    counts: {
      target: Number(row.target_count || 0),
      processed: Number(row.processed_count || 0),
      remaining: Number(row.remaining_count || 0),
      complete: Number(row.complete_count || 0),
      partial: Number(row.partial_count || 0),
      unknown: Number(row.unknown_count || 0),
      failed: Number(row.failed_count || 0),
      overdue: Number(row.overdue_count || 0),
    },
  };
}

async function readRun(db: D1Database, runId: string) {
  return db.prepare("SELECT * FROM candle_continuity_runs WHERE run_id=?").bind(runId).first<RunRow>();
}

export async function aggregateCandleContinuityRun(db: D1Database, runIdValue: string, nowValue: Date | string = new Date()) {
  const runId = validatedRunId(runIdValue);
  const now = iso(nowValue);
  const run = await readRun(db, runId);
  if (!run) throw new Error("invalid_response");
  const checkpointPassed = now >= String(run.sla_checkpoint || "");
  if (checkpointPassed) {
    await db.prepare(`UPDATE candle_continuity_run_items SET status='overdue',reason_code=COALESCE(reason_code,'audit_failed'),completed_at=COALESCE(completed_at,?),updated_at=CURRENT_TIMESTAMP
      WHERE run_id=? AND status IN ('queued','running','retry_waiting','partial','unknown')`).bind(now, runId).run();
  }
  const counts = await db.prepare(`SELECT COUNT(*) AS target_count,
    SUM(CASE WHEN status IN ('fresh','complete','partial','unknown','failed','overdue') THEN 1 ELSE 0 END) AS processed_count,
    SUM(CASE WHEN status IN ('queued','running','retry_waiting') THEN 1 ELSE 0 END) AS remaining_count,
    SUM(CASE WHEN status IN ('fresh','complete') THEN 1 ELSE 0 END) AS complete_count,
    SUM(CASE WHEN status='partial' THEN 1 ELSE 0 END) AS partial_count,
    SUM(CASE WHEN status='unknown' THEN 1 ELSE 0 END) AS unknown_count,
    SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed_count,
    SUM(CASE WHEN status='overdue' THEN 1 ELSE 0 END) AS overdue_count,
    MAX(CASE WHEN status IN ('fresh','complete','partial','unknown','failed','overdue') THEN ordinal ELSE 0 END) AS cursor
    FROM candle_continuity_run_items WHERE run_id=?`).bind(runId).first<Record<string, unknown>>();
  const remaining = Number(counts?.remaining_count || 0);
  const retry = await db.prepare("SELECT COUNT(*) AS rows FROM candle_continuity_run_items WHERE run_id=? AND status='retry_waiting'").bind(runId).first<{ rows?: number }>();
  const currentStatus = String(run.status || "") as RunStatus;
  let status: RunStatus = currentStatus;
  let phase = String(run.phase || "audit");
  let completedAt = run.completed_at || null;
  if (!["failed", "completed"].includes(currentStatus)) {
    if (remaining === 0) { status = "completed"; phase = "completed"; completedAt = now; }
    else if (Number(retry?.rows || 0) === remaining) { status = "retry_waiting"; phase = "waiting"; }
    else { status = "running"; phase = "audit"; }
  }
  await db.prepare(`UPDATE candle_continuity_runs SET status=?,phase=?,cursor=?,target_count=?,processed_count=?,remaining_count=?,complete_count=?,partial_count=?,unknown_count=?,failed_count=?,overdue_count=?,heartbeat_at=?,completed_at=?,updated_at=CURRENT_TIMESTAMP WHERE run_id=?`)
    .bind(status, phase, Number(counts?.cursor || 0), Number(counts?.target_count || 0), Number(counts?.processed_count || 0), remaining, Number(counts?.complete_count || 0), Number(counts?.partial_count || 0), Number(counts?.unknown_count || 0), Number(counts?.failed_count || 0), Number(counts?.overdue_count || 0), now, completedAt, runId).run();
  return runSummary(await readRun(db, runId));
}

export async function startCandleContinuityRun(input: {
  db: D1Database;
  runId: string;
  deploymentTarget: DeploymentTarget;
  trigger: Trigger;
  expectedSession: string;
  targets: CandleContinuityTarget[];
  commitSha?: string | null;
  now?: Date | string;
}) {
  const runId = validatedRunId(input.runId);
  if (!["sites", "cloudflare", "local"].includes(input.deploymentTarget) || !["schedule", "workflow_dispatch", "local"].includes(input.trigger) || !validDate(input.expectedSession)) throw new Error("invalid_response");
  const now = iso(input.now);
  const existing = await readRun(input.db, runId);
  if (existing) {
    if (existing.deployment_target !== input.deploymentTarget || existing.expected_session !== input.expectedSession || existing.trigger !== input.trigger) throw new Error("invalid_response");
    return aggregateCandleContinuityRun(input.db, runId, now);
  }
  const targets = [...input.targets].sort((a, b) => a.priority - b.priority || a.symbol.localeCompare(b.symbol));
  await input.db.prepare(`INSERT INTO candle_continuity_runs
    (run_id,deployment_target,trigger,commit_sha,expected_session,sla_checkpoint,status,phase,target_count,remaining_count,heartbeat_at,started_at)
    VALUES (?,?,?,?,?,?,'running','audit',?,?,?,?)`).bind(runId, input.deploymentTarget, input.trigger, input.commitSha || null, input.expectedSession, candleContinuitySlaCheckpoint(input.expectedSession), targets.length, targets.filter((item) => item.status === "queued").length, now, now).run();
  await runD1Batch(input.db, targets.map((target, index) => input.db.prepare(`INSERT INTO candle_continuity_run_items
    (run_id,symbol,ordinal,priority,status,coverage_end,verified_through,missing_session_count,checked_at,reason_code,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id,symbol) DO NOTHING`).bind(
      runId, normalizedSymbol(target.symbol), index + 1, target.priority, target.status, target.coverageEnd, target.verifiedThrough,
      target.missingSessionCount, target.checkedAt, target.reasonCode, target.status === "fresh" ? now : null,
    )), 40);
  return aggregateCandleContinuityRun(input.db, runId, now);
}

export async function claimCandleContinuityItems(input: { db: D1Database; runId: string; owner: string; limit?: number; leaseSeconds?: number; now?: Date | string }) {
  const runId = validatedRunId(input.runId);
  const owner = validatedOwner(input.owner);
  const now = iso(input.now);
  const run = await readRun(input.db, runId);
  if (!run || !["running", "retry_waiting"].includes(String(run.status))) return [];
  const limit = Math.max(1, Math.min(CANDLE_CONTINUITY_AUTOMATION_CONTRACT.batchLimit, Math.floor(Number(input.limit) || CANDLE_CONTINUITY_AUTOMATION_CONTRACT.batchLimit)));
  const leaseSeconds = Math.max(30, Math.min(900, Math.floor(Number(input.leaseSeconds) || CANDLE_CONTINUITY_AUTOMATION_CONTRACT.leaseSeconds)));
  const leaseExpires = new Date(Date.parse(now) + leaseSeconds * 1000).toISOString();
  await input.db.prepare(`UPDATE candle_continuity_run_items SET status='queued',lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE run_id=? AND status='running' AND lease_expires_at<=?`).bind(runId, now).run();
  const candidates = await input.db.prepare(`SELECT symbol FROM candle_continuity_run_items WHERE run_id=?
    AND (status='queued' OR (status='retry_waiting' AND retry_after<=?)) ORDER BY priority,ordinal LIMIT ?`).bind(runId, now, limit).all<{ symbol?: string }>();
  const claimed: string[] = [];
  for (const row of candidates.results || []) {
    const symbol = normalizedSymbol(row.symbol);
    const result = await input.db.prepare(`UPDATE candle_continuity_run_items SET status='running',attempts=attempts+1,lease_owner=?,lease_expires_at=?,retry_after=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE run_id=? AND symbol=? AND (status='queued' OR (status='retry_waiting' AND retry_after<=?))`).bind(owner, leaseExpires, runId, symbol, now).run();
    if (Number(result.meta?.changes || 0) === 1) claimed.push(symbol);
  }
  await input.db.prepare("UPDATE candle_continuity_runs SET status='running',phase='audit',heartbeat_at=?,updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND status IN ('running','retry_waiting')").bind(now, runId).run();
  if (!claimed.length) await aggregateCandleContinuityRun(input.db, runId, now);
  return claimed;
}

export async function heartbeatCandleContinuityItems(input: { db: D1Database; runId: string; owner: string; symbols: string[]; now?: Date | string; leaseSeconds?: number }) {
  const runId = validatedRunId(input.runId);
  const owner = validatedOwner(input.owner);
  const now = iso(input.now);
  const lease = new Date(Date.parse(now) + Math.max(30, Math.min(900, Number(input.leaseSeconds) || CANDLE_CONTINUITY_AUTOMATION_CONTRACT.leaseSeconds)) * 1000).toISOString();
  await runD1Batch(input.db, input.symbols.map((value) => input.db.prepare("UPDATE candle_continuity_run_items SET lease_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND symbol=? AND status='running' AND lease_owner=?").bind(lease, runId, normalizedSymbol(value), owner)), 40);
  await input.db.prepare("UPDATE candle_continuity_runs SET heartbeat_at=?,updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND status IN ('running','retry_waiting')").bind(now, runId).run();
}

export type CandleContinuityOutcome = {
  status: "complete" | "partial" | "unknown" | "failed";
  coverageEnd?: string | null;
  verifiedThrough?: string | null;
  missingSessionCount?: number;
  checkedAt?: string | null;
  reasonCode?: unknown;
  retryable?: boolean;
  retryAfter?: string | null;
};

export async function completeCandleContinuityItem(input: { db: D1Database; runId: string; symbol: string; owner: string; outcome: CandleContinuityOutcome; now?: Date | string }) {
  const runId = validatedRunId(input.runId);
  const symbol = normalizedSymbol(input.symbol);
  const owner = validatedOwner(input.owner);
  const now = iso(input.now);
  const claimed = await input.db.prepare("SELECT attempts FROM candle_continuity_run_items WHERE run_id=? AND symbol=? AND status='running' AND lease_owner=? AND lease_expires_at>?")
    .bind(runId, symbol, owner, now).first<{ attempts?: number }>();
  if (!claimed) throw new Error("lease_conflict");
  const shouldRetry = Boolean(input.outcome.retryable) && Number(claimed.attempts || 0) < 2;
  const status: ItemStatus = shouldRetry ? "retry_waiting" : input.outcome.status;
  const reasonCode = input.outcome.reasonCode ? safeCandleContinuityReason(input.outcome.reasonCode) : null;
  const retryAfter = shouldRetry
    ? iso(input.outcome.retryAfter || new Date(Date.parse(now) + 30 * 60 * 1000))
    : null;
  const result = await input.db.prepare(`UPDATE candle_continuity_run_items SET status=?,coverage_end=?,verified_through=?,missing_session_count=?,checked_at=?,reason_code=?,retry_after=?,lease_owner=NULL,lease_expires_at=NULL,completed_at=?,updated_at=CURRENT_TIMESTAMP
    WHERE run_id=? AND symbol=? AND status='running' AND lease_owner=? AND lease_expires_at>?`).bind(
      status,
      validDate(input.outcome.coverageEnd) ? input.outcome.coverageEnd : null,
      validDate(input.outcome.verifiedThrough) ? input.outcome.verifiedThrough : null,
      Math.max(0, Number(input.outcome.missingSessionCount) || 0),
      input.outcome.checkedAt && Number.isFinite(Date.parse(input.outcome.checkedAt)) ? input.outcome.checkedAt : now,
      reasonCode,
      retryAfter,
      terminalStatuses.has(status) ? now : null,
      runId, symbol, owner, now,
    ).run();
  if (Number(result.meta?.changes || 0) !== 1) throw new Error("lease_conflict");
  return aggregateCandleContinuityRun(input.db, runId, now);
}

export async function failCandleContinuityRun(input: { db: D1Database; runId: string; reason: unknown; now?: Date | string }) {
  const runId = validatedRunId(input.runId);
  const reason = safeCandleContinuityReason(input.reason);
  if (!safeReasons.has(String(input.reason || ""))) throw new Error("invalid_response");
  const now = iso(input.now);
  await input.db.prepare(`UPDATE candle_continuity_runs SET status='failed',phase='failed',reason_code=?,heartbeat_at=?,completed_at=?,updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND status IN ('running','retry_waiting')`).bind(reason, now, now, runId).run();
  await input.db.prepare("UPDATE candle_continuity_run_items SET status='queued',lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND status='running'").bind(runId).run();
  return aggregateCandleContinuityRun(input.db, runId, now);
}

export async function readCandleContinuityRunItems(db: D1Database, runIdValue: string, limit = 20) {
  const runId = validatedRunId(runIdValue);
  const bounded = Math.max(1, Math.min(CANDLE_CONTINUITY_AUTOMATION_CONTRACT.anomalyLimit, Math.floor(limit)));
  const total = Number(await db.prepare("SELECT COUNT(*) AS rows FROM candle_continuity_run_items WHERE run_id=? AND status NOT IN ('fresh','complete')").bind(runId).first("rows") || 0);
  const rows = await db.prepare(`SELECT symbol,status,verified_through,missing_session_count,checked_at,reason_code FROM candle_continuity_run_items
    WHERE run_id=? AND status NOT IN ('fresh','complete') ORDER BY priority,symbol LIMIT ?`).bind(runId, bounded).all<ItemRow>();
  return {
    total,
    truncated: total > bounded,
    items: (rows.results || []).map((row) => ({
      symbol: String(row.symbol || ""),
      status: String(row.status || "unknown"),
      verifiedThrough: row.verified_through || null,
      missingSessionCount: Math.max(0, Number(row.missing_session_count) || 0),
      checkedAt: row.checked_at || null,
      reasonCode: row.reason_code && safeReasons.has(String(row.reason_code)) ? row.reason_code : null,
    })),
  };
}

export async function readCandleContinuityAutomationHealth(db: D1Database | undefined, deploymentTarget?: string, now: Date | string = new Date()) {
  if (!db) return { configured: false, status: "unavailable", latestRun: null, anomalies: { total: 0, truncated: false, items: [] } };
  try {
    const run = deploymentTarget
      ? await db.prepare("SELECT * FROM candle_continuity_runs WHERE deployment_target=? ORDER BY updated_at DESC LIMIT 1").bind(deploymentTarget).first<RunRow>()
      : await db.prepare("SELECT * FROM candle_continuity_runs ORDER BY updated_at DESC LIMIT 1").first<RunRow>();
    if (!run) return { configured: true, status: "not_run", latestRun: null, anomalies: { total: 0, truncated: false, items: [] } };
    const latestRun = await aggregateCandleContinuityRun(db, String(run.run_id), now);
    const anomalies = await readCandleContinuityRunItems(db, String(run.run_id));
    const degraded = Number(latestRun?.counts.partial || 0) + Number(latestRun?.counts.unknown || 0) + Number(latestRun?.counts.failed || 0) + Number(latestRun?.counts.overdue || 0) > 0;
    return { configured: true, status: degraded ? "degraded" : latestRun?.status, latestRun, anomalies };
  } catch {
    return { configured: false, status: "migration_required", latestRun: null, anomalies: { total: 0, truncated: false, items: [] } };
  }
}

export function safeCandleContinuityWorkflowSummary(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const summary = input.summary && typeof input.summary === "object" ? input.summary as Record<string, unknown> : input;
  const counts = summary.counts && typeof summary.counts === "object" ? summary.counts as Record<string, unknown> : {};
  return [
    `target=${String(summary.deploymentTarget || "unknown")}`,
    `run=${String(summary.runId || "unknown")}`,
    `session=${String(summary.expectedSession || "unknown")}`,
    `status=${String(summary.status || "unknown")}`,
    `processed=${Math.max(0, Number(counts.processed) || 0)}`,
    `remaining=${Math.max(0, Number(counts.remaining) || 0)}`,
    `complete=${Math.max(0, Number(counts.complete) || 0)}`,
    `partial=${Math.max(0, Number(counts.partial) || 0)}`,
    `unknown=${Math.max(0, Number(counts.unknown) || 0)}`,
    `failed=${Math.max(0, Number(counts.failed) || 0)}`,
    `overdue=${Math.max(0, Number(counts.overdue) || 0)}`,
    `reason=${summary.reasonCode && safeReasons.has(String(summary.reasonCode)) ? summary.reasonCode : "none"}`,
  ].join(" ");
}
