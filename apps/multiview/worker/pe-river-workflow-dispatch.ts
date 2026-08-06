const WORKFLOW_DISPATCH_URL = "https://api.github.com/repos/alanyi1112/MultiChartOnCodexSite/actions/workflows/pe-river-continuous-backfill.yml/dispatches";
const STALE_MS = 20 * 60 * 1000;

export async function dispatchPeRiverWorkflowIfStale(input: { db: D1Database; token?: string; fetchImpl?: typeof fetch; now?: Date }) {
  const now = input.now || new Date();
  const control = await input.db.prepare(`SELECT scheduler_heartbeat_at FROM taiwan_stock_pe_control WHERE control_key='global'`).first<{ scheduler_heartbeat_at?: string | null }>();
  const heartbeat = Date.parse(String(control?.scheduler_heartbeat_at || ""));
  if (Number.isFinite(heartbeat) && now.getTime() - heartbeat < STALE_MS) return { status: "recent" as const };
  if (!input.token) return { status: "unavailable" as const, reasonCode: "dispatch_not_configured" };
  await input.db.prepare(`INSERT INTO taiwan_stock_pe_control (control_key,scheduler_heartbeat_at) VALUES ('global',?) ON CONFLICT(control_key) DO UPDATE SET scheduler_heartbeat_at=excluded.scheduler_heartbeat_at,updated_at=CURRENT_TIMESTAMP`).bind(now.toISOString()).run();
  try {
    const response = await (input.fetchImpl || fetch)(WORKFLOW_DISPATCH_URL, {
      method: "POST",
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${input.token}`, "content-type": "application/json", "x-github-api-version": "2022-11-28" },
      body: JSON.stringify({ ref: "main" }),
      signal: AbortSignal.timeout(15000),
    });
    if (response.status !== 204) return { status: "failed" as const, reasonCode: response.status === 401 || response.status === 403 ? "dispatch_unauthorized" : "provider_unavailable" };
    return { status: "started" as const };
  } catch {
    return { status: "failed" as const, reasonCode: "provider_unavailable" };
  }
}
