import { CHIP_BACKFILL_ORCHESTRATOR_CONTRACT, latestCompletedTaiwanSessionDate } from "./chip-backfill-orchestrator.ts";

export const WATCHLIST_CHIP_PREWARM_CONTRACT = Object.freeze({
  scheduler: "sites-worker-orchestrator",
  datasets: ["institutional-flow", "foreign-holding", "margin-short", "securities-lending"] as const,
  lookbackDays: 365,
  freshnessMs: 20 * 60 * 60 * 1000,
  maxTargetsPerRun: 40,
  requestTimeoutMs: 45 * 1000,
  interSymbolDelayMs: 500,
});

type WarmState = {
  symbol: string;
  dataset: string;
  coverage_start?: string | null;
  coverage_end?: string | null;
  source_date?: string | null;
  status?: string | null;
  reason_code?: string | null;
  last_success_at?: string | null;
  last_attempt_at?: string | null;
  retry_after?: string | null;
};

type WarmTargetRow = {
  symbol: string;
};

type SchedulerRunRow = {
  heartbeat_at?: string | null;
  status?: string | null;
  last_reason_code?: string | null;
};

export type WatchlistChipWarmTarget = {
  symbol: string;
  datasets: string[];
  start: string;
  end: string;
};

const realDate = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

export function watchlistChipWarmWindow(now: Date | string = new Date()) {
  const endDate = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(endDate.getTime())) throw new Error("invalid_response");
  const end = latestCompletedTaiwanSessionDate(endDate);
  const startDate = new Date(`${end}T00:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() - WATCHLIST_CHIP_PREWARM_CONTRACT.lookbackDays);
  return { start: startDate.toISOString().slice(0, 10), end };
}

function isFresh(state: WarmState | undefined, window: { start: string; end: string }, nowMs: number) {
  if (
    !state
    || state.status !== "available"
    || !realDate(state.coverage_start)
    || !realDate(state.coverage_end)
    || !realDate(state.source_date)
    || String(state.coverage_start) > window.start
    || String(state.coverage_end) < window.end
    || String(state.source_date) < window.end
  ) return false;
  const lastSuccess = Date.parse(String(state.last_success_at || ""));
  return Number.isFinite(lastSuccess) && nowMs - lastSuccess < WATCHLIST_CHIP_PREWARM_CONTRACT.freshnessMs;
}

async function readTargetsAndStates(db: D1Database) {
  const [targetRows, stateRows] = await Promise.all([
    db.prepare("SELECT symbol FROM tdcc_continuous_symbols WHERE active = 1 ORDER BY symbol").all<WarmTargetRow>(),
    db.prepare("SELECT symbol,dataset,coverage_start,coverage_end,source_date,status,reason_code,last_success_at,last_attempt_at,retry_after FROM taiwan_stock_chip_fetch_state WHERE dataset IN ('institutional-flow','foreign-holding','margin-short','securities-lending')").all<WarmState>(),
  ]);
  const symbols = [...new Set((targetRows.results || []).map((row) => String(row.symbol || "").trim().toUpperCase()).filter((symbol) => /^[0-9A-Z]{4,8}\.(TW|TWO)$/.test(symbol)))];
  const states = new Map<string, WarmState>();
  for (const row of stateRows.results || []) states.set(`${String(row.symbol)}|${String(row.dataset)}`, row as WarmState);
  return { symbols, states };
}

export async function discoverWatchlistChipWarmTargets(input: { db: D1Database; limit?: number; now?: Date | string; attemptCooldownMs?: number }) {
  const now = input.now instanceof Date ? input.now : input.now ? new Date(input.now) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("invalid_response");
  const window = watchlistChipWarmWindow(now);
  const limit = Math.max(1, Math.min(WATCHLIST_CHIP_PREWARM_CONTRACT.maxTargetsPerRun, Math.trunc(Number(input.limit || WATCHLIST_CHIP_PREWARM_CONTRACT.maxTargetsPerRun))));
  const { symbols, states } = await readTargetsAndStates(input.db);
  let pendingSymbols = 0;
  let deferredSymbols = 0;
  const cooldownMs = Math.max(0, Number(input.attemptCooldownMs ?? 0));
  const candidates = symbols.flatMap((symbol) => {
    const due: string[] = [];
    let pending = false;
    const successTimes: number[] = [];
    let missing = 0;
    for (const dataset of WATCHLIST_CHIP_PREWARM_CONTRACT.datasets) {
      const state = states.get(`${symbol}|${dataset}`);
      const retryAfter = Date.parse(String(state?.retry_after || ""));
      const lastSuccess = Date.parse(String(state?.last_success_at || ""));
      if (Number.isFinite(lastSuccess)) successTimes.push(lastSuccess);
      const coverageComplete = Boolean(
        state
        && state.status === "available"
        && realDate(state.coverage_start)
        && realDate(state.coverage_end)
        && realDate(state.source_date)
        && String(state.coverage_start) <= window.start
        && String(state.coverage_end) >= window.end
        && String(state.source_date) >= window.end,
      );
      if (!coverageComplete) missing += 1;
      if (!isFresh(state, window, now.getTime())) pending = true;
      if (Number.isFinite(retryAfter) && retryAfter > now.getTime()) continue;
      const lastAttempt = Date.parse(String(state?.last_attempt_at || ""));
      if (cooldownMs && Number.isFinite(lastAttempt) && now.getTime() - lastAttempt < cooldownMs) continue;
      if (!isFresh(state, window, now.getTime())) due.push(dataset);
    }
    if (pending) pendingSymbols += 1;
    if (!due.length) {
      if (pending) deferredSymbols += 1;
      return [];
    }
    return [{ symbol, datasets: due, start: window.start, end: window.end, missing, oldestSuccess: successTimes.length ? Math.min(...successTimes) : 0 }];
  }).sort((a, b) => b.missing - a.missing || a.oldestSuccess - b.oldestSuccess || a.symbol.localeCompare(b.symbol));
  return {
    ...window,
    targetSymbols: symbols.length,
    pendingSymbols,
    dueSymbols: candidates.length,
    deferredSymbols,
    targets: candidates.slice(0, limit).map(({ symbol, datasets, start, end }) => ({ symbol, datasets, start, end })),
  };
}

export async function readWatchlistChipPrewarmHealth(db: D1Database | undefined, now: Date | string = new Date()) {
  if (!db) return { configured: false, status: "unavailable", scheduler: WATCHLIST_CHIP_PREWARM_CONTRACT.scheduler, targetSymbols: 0, readySymbols: 0, pendingSymbols: 0, retryWaitingSymbols: 0, lastSuccessAt: null, lastErrorCode: "d1_unavailable" };
  try {
    const current = now instanceof Date ? now : new Date(now);
    const window = watchlistChipWarmWindow(current);
    const { symbols, states } = await readTargetsAndStates(db);
    const schedulerRun = await db.prepare("SELECT heartbeat_at,status,last_reason_code FROM chip_backfill_orchestrator_runs WHERE scope IN ('daily','combined') ORDER BY updated_at DESC LIMIT 1").first<SchedulerRunRow>();
    const schedulerHeartbeat = Date.parse(String(schedulerRun?.heartbeat_at || ""));
    const schedulerStale = !Number.isFinite(schedulerHeartbeat) || current.getTime() - schedulerHeartbeat > 36 * 3600000;
    let readySymbols = 0;
    let retryWaitingSymbols = 0;
    const successes: string[] = [];
    const reasons: string[] = [];
    for (const symbol of symbols) {
      let ready = true;
      let waiting = false;
      for (const dataset of WATCHLIST_CHIP_PREWARM_CONTRACT.datasets) {
        const state = states.get(`${symbol}|${dataset}`);
        if (state?.last_success_at) successes.push(String(state.last_success_at));
        if (state?.reason_code && !["available", "partial_data", "not_published"].includes(String(state.reason_code))) reasons.push(String(state.reason_code));
        if (!isFresh(state, window, current.getTime())) ready = false;
        const retryAfter = Date.parse(String(state?.retry_after || ""));
        if (Number.isFinite(retryAfter) && retryAfter > current.getTime()) waiting = true;
      }
      if (ready) readySymbols += 1;
      if (waiting) retryWaitingSymbols += 1;
    }
    const pendingSymbols = Math.max(0, symbols.length - readySymbols);
    return {
      configured: true,
      status: schedulerStale ? "scheduler_stale" : schedulerRun?.status === "failed" ? "degraded" : pendingSymbols ? "warming" : "healthy",
      scheduler: WATCHLIST_CHIP_PREWARM_CONTRACT.scheduler,
      lastHeartbeatAt: schedulerRun?.heartbeat_at || null,
      window,
      targetSymbols: symbols.length,
      readySymbols,
      pendingSymbols,
      retryWaitingSymbols,
      lastSuccessAt: successes.sort().at(-1) || null,
      lastErrorCode: schedulerStale ? "scheduler_stale" : reasons.includes("rate_limited") ? "rate_limited" : schedulerRun?.last_reason_code || reasons.at(-1) || null,
    };
  } catch {
    return { configured: false, status: "unavailable", scheduler: WATCHLIST_CHIP_PREWARM_CONTRACT.scheduler, targetSymbols: 0, readySymbols: 0, pendingSymbols: 0, retryWaitingSymbols: 0, lastSuccessAt: null, lastErrorCode: "d1_unavailable" };
  }
}

export const WATCHLIST_CHIP_ATTEMPT_COOLDOWN_MS = CHIP_BACKFILL_ORCHESTRATOR_CONTRACT.attemptCooldownMs;
