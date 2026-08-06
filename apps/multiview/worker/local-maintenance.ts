type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };
type LocalMaintenanceEnv = { DB?: unknown; LOCAL_PIPELINE_SECRET?: string };
type LocalMaintenanceActions = { daily(env: LocalMaintenanceEnv, scheduledTime: number): Promise<void> };

function reply(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { "cache-control": "no-store" } });
}

export async function handleLocalMaintenance(
  request: Request,
  env: LocalMaintenanceEnv,
  context: ExecutionContext,
  actions: LocalMaintenanceActions,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/internal/local-maintenance") return null;
  if (request.method !== "POST" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    return reply({ ok: false, reasonCode: "local_only" }, 403);
  }
  const expected = String(env.LOCAL_PIPELINE_SECRET || "");
  const supplied = request.headers.get("x-multiview-local-authorization") || "";
  if (!expected || expected.length < 32 || supplied !== `Bearer ${expected}`) {
    return reply({ ok: false, reasonCode: "unauthorized" }, 401);
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return reply({ ok: false, reasonCode: "invalid_payload" }, 400);
  }
  if (Object.keys(body).some((key) => !["action", "scheduledTime"].includes(key)) || body.action !== "daily") {
    return reply({ ok: false, reasonCode: "invalid_payload" }, 400);
  }
  const scheduledTime = Number(body.scheduledTime || Date.now());
  if (!Number.isFinite(scheduledTime) || Math.abs(Date.now() - scheduledTime) > 24 * 60 * 60 * 1000) {
    return reply({ ok: false, reasonCode: "invalid_scheduled_time" }, 400);
  }
  if (!env.DB) return reply({ ok: false, reasonCode: "d1_unavailable" }, 503);
  const work = actions.daily(env, scheduledTime);
  context.waitUntil(work);
  await work;
  return reply({ ok: true, action: "daily", scheduledTime, reasonCode: "none" });
}
