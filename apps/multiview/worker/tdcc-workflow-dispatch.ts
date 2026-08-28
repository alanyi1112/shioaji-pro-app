const GITHUB_WORKFLOW_DISPATCH_URLS = Object.freeze({
  sites: "https://api.github.com/repos/alanyi1112/MultiChartOnCodexSite/actions/workflows/tdcc-continuous-backfill.yml/dispatches",
  cloudflare: "https://api.github.com/repos/alanyi1112/MultiChartOnCodexSite/actions/workflows/cloudflare-tdcc-continuous-backfill.yml/dispatches",
});
const GITHUB_WORKFLOW_REF = "main";
const DISPATCH_COOLDOWN_MS = 2 * 60 * 1000;
const RUN_HEARTBEAT_FRESH_MS = 20 * 60 * 1000;

export const TDCC_WORKFLOW_DISPATCH_CONTRACT = Object.freeze({
  urls: GITHUB_WORKFLOW_DISPATCH_URLS,
  ref: GITHUB_WORKFLOW_REF,
  cooldownMs: DISPATCH_COOLDOWN_MS,
  runningHeartbeatFreshMs: RUN_HEARTBEAT_FRESH_MS,
});

export type TdccWorkflowDispatchStatus = "started" | "already-running" | "cooldown" | "unavailable" | "failed";
export type TdccWorkflowDeploymentTarget = "sites" | "cloudflare";

type DispatchRow = {
  symbol?: string | null;
  status?: string | null;
  deployment_target?: string | null;
  requested_at?: string | null;
  cooldown_until?: string | null;
  last_error_code?: string | null;
};

type RunningRow = { run_id?: string | null; heartbeat_at?: string | null };

function normalizedSymbol(value: unknown) {
  const symbol = String(value || "").trim().toUpperCase();
  if (!/^[0-9A-Z]{4,8}\.(TW|TWO)$/.test(symbol)) throw new Error("invalid_response");
  return symbol;
}

function iso(value: Date | string | undefined) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) throw new Error("invalid_response");
  return date.toISOString();
}

function safeDispatchError(status?: number, error?: unknown) {
  if (status === 401 || status === 403) return "dispatch_unauthorized";
  if (status === 404) return "workflow_not_found";
  if (status === 429) return "rate_limited";
  if (error instanceof Error && (error.name === "AbortError" || /timeout|abort/i.test(error.message))) return "timeout";
  return "provider_unavailable";
}

async function saveDispatch(input: {
  db: D1Database;
  symbol: string;
  status: string;
  deploymentTarget: TdccWorkflowDeploymentTarget;
  requestedAt: string;
  cooldownUntil: string | null;
  errorCode?: string | null;
}) {
  await input.db.prepare(`INSERT INTO tdcc_backfill_dispatches
    (symbol,status,deployment_target,requested_at,cooldown_until,last_error_code,updated_at)
    VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(symbol) DO UPDATE SET status=excluded.status,deployment_target=excluded.deployment_target,requested_at=excluded.requested_at,
      cooldown_until=excluded.cooldown_until,last_error_code=excluded.last_error_code,updated_at=CURRENT_TIMESTAMP`)
    .bind(input.symbol, input.status, input.deploymentTarget, input.requestedAt, input.cooldownUntil, input.errorCode || null).run();
}

export async function dispatchTdccContinuousWorkflow(input: {
  db: D1Database;
  symbol: string;
  token?: string;
  now?: Date | string;
  fetchImpl?: typeof fetch;
  deploymentTarget?: TdccWorkflowDeploymentTarget;
}) {
  const symbol = normalizedSymbol(input.symbol);
  const requestedAt = iso(input.now);
  const nowMs = Date.parse(requestedAt);
  const deploymentTarget = input.deploymentTarget || "sites";
  if (!["sites", "cloudflare"].includes(deploymentTarget)) throw new Error("invalid_response");
  const runningAfter = new Date(nowMs - RUN_HEARTBEAT_FRESH_MS).toISOString();
  const running = await input.db.prepare(`SELECT run_id,heartbeat_at FROM tdcc_continuous_runs
    WHERE status='running' AND heartbeat_at>=? ORDER BY heartbeat_at DESC LIMIT 1`).bind(runningAfter).first<RunningRow>();
  if (running?.run_id) {
    const cooldownUntil = new Date(nowMs + DISPATCH_COOLDOWN_MS).toISOString();
    await saveDispatch({ db: input.db, symbol, status: "already-running", deploymentTarget, requestedAt, cooldownUntil });
    return { status: "already-running" as const, deploymentTarget, requestedAt, cooldownUntil };
  }

  const existing = await input.db.prepare("SELECT symbol,status,deployment_target,requested_at,cooldown_until,last_error_code FROM tdcc_backfill_dispatches WHERE symbol=?")
    .bind(symbol).first<DispatchRow>();
  const existingCooldown = Date.parse(String(existing?.cooldown_until || ""));
  if (Number.isFinite(existingCooldown) && existingCooldown > nowMs && ["dispatching", "started", "already-running"].includes(String(existing?.status || ""))) {
    return { status: "cooldown" as const, deploymentTarget: String(existing?.deployment_target || deploymentTarget), requestedAt: existing?.requested_at || requestedAt, cooldownUntil: existing?.cooldown_until || null };
  }

  const cooldownUntil = new Date(nowMs + DISPATCH_COOLDOWN_MS).toISOString();
  await saveDispatch({ db: input.db, symbol, status: "dispatching", deploymentTarget, requestedAt, cooldownUntil });
  const token = String(input.token || "").trim();
  if (!token) {
    await saveDispatch({ db: input.db, symbol, status: "unavailable", deploymentTarget, requestedAt, cooldownUntil: null, errorCode: "dispatch_not_configured" });
    return { status: "unavailable" as const, deploymentTarget, requestedAt, cooldownUntil: null, errorCode: "dispatch_not_configured" };
  }

  try {
    const response = await (input.fetchImpl || fetch)(GITHUB_WORKFLOW_DISPATCH_URLS[deploymentTarget], {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "MultiChartOnCodexSite-TDCC-Dispatcher",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ ref: GITHUB_WORKFLOW_REF }),
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 204) {
      await saveDispatch({ db: input.db, symbol, status: "started", deploymentTarget, requestedAt, cooldownUntil });
      return { status: "started" as const, deploymentTarget, requestedAt, cooldownUntil };
    }
    const errorCode = safeDispatchError(response.status);
    await saveDispatch({ db: input.db, symbol, status: "failed", deploymentTarget, requestedAt, cooldownUntil: null, errorCode });
    return { status: "failed" as const, deploymentTarget, requestedAt, cooldownUntil: null, errorCode };
  } catch (error) {
    const errorCode = safeDispatchError(undefined, error);
    await saveDispatch({ db: input.db, symbol, status: "failed", deploymentTarget, requestedAt, cooldownUntil: null, errorCode });
    return { status: "failed" as const, deploymentTarget, requestedAt, cooldownUntil: null, errorCode };
  }
}

export async function readTdccWorkflowDispatch(db: D1Database | undefined, symbol: string) {
  if (!db) return null;
  const normalized = normalizedSymbol(symbol);
  const row = await db.prepare("SELECT symbol,status,deployment_target,requested_at,cooldown_until,last_error_code FROM tdcc_backfill_dispatches WHERE symbol=?")
    .bind(normalized).first<DispatchRow>();
  if (!row) return null;
  return {
    symbol: normalized,
    status: String(row.status || "failed") as TdccWorkflowDispatchStatus,
    deploymentTarget: String(row.deployment_target || "unknown"),
    requestedAt: row.requested_at || null,
    cooldownUntil: row.cooldown_until || null,
    lastErrorCode: row.last_error_code || null,
  };
}
