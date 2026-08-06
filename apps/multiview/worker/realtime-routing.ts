import { deploymentTargetForRequest, requestPrincipal, type RequestPrincipal } from "./request-principal.ts";

type DurableObjectStub = { fetch(request: Request): Promise<Response> };
type DurableObjectNamespace = { getByName(name: string): DurableObjectStub };

export type RealtimeEnv = {
  DEPLOYMENT_TARGET?: string;
  SHIOAJI_REALTIME_ENABLED?: string;
  REALTIME_LOCAL_TEST?: string;
  SHIOAJI_INGEST_SECRET?: string;
  SHIOAJI_INGEST_SECRET_NEXT?: string;
  REALTIME_HUB?: DurableObjectNamespace;
};

const CONNECTION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function realtimeCapability(env: RealtimeEnv) {
  const target = String(env.DEPLOYMENT_TARGET || "").toLowerCase();
  const enabled = String(env.SHIOAJI_REALTIME_ENABLED || "").toLowerCase() === "true";
  const localTest = target === "local" && String(env.REALTIME_LOCAL_TEST || "").toLowerCase() === "true";
  const cloudflareReady = target === "cloudflare" && Boolean(String(env.SHIOAJI_INGEST_SECRET || "").trim());
  return enabled && Boolean(env.REALTIME_HUB) && (cloudflareReady || localTest);
}

function isLocalSimulationRequest(request: Request, env: RealtimeEnv) {
  return String(env.DEPLOYMENT_TARGET || "").toLowerCase() === "local"
    && String(env.REALTIME_LOCAL_TEST || "").toLowerCase() === "true"
    && ["localhost", "127.0.0.1", "::1"].includes(new URL(request.url).hostname);
}

export function realtimeViewerCapabilityForPrincipal(env: RealtimeEnv, principal: RequestPrincipal) {
  if (!realtimeCapability(env)) return false;
  const target = String(env.DEPLOYMENT_TARGET || "").toLowerCase();
  if (target === "local") return principal.kind === "local";
  return target === "cloudflare" && principal.kind === "user" && principal.accessRole === "owner";
}

export function realtimeViewerCapability(request: Request, env: RealtimeEnv) {
  const principal = requestPrincipal(request);
  if (!realtimeViewerCapabilityForPrincipal(env, principal)) return false;
  return principal.deploymentTarget === "cloudflare" || isLocalSimulationRequest(request, env);
}

async function sameSecret(left: string, right: string) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let difference = x.length ^ y.length;
  for (let index = 0; index < Math.max(x.length, y.length); index += 1) {
    difference |= (x[index] || 0) ^ (y[index] || 0);
  }
  return difference === 0;
}

function hubRequest(request: Request, role: "ingest" | "browser", connectionId?: string) {
  const headers = new Headers();
  headers.set("upgrade", "websocket");
  headers.set("x-realtime-role", role);
  if (connectionId) headers.set("x-realtime-connection-id", connectionId);
  return new Request(request.url, { method: "GET", headers });
}

export async function handleRealtimeRoute(request: Request, env: RealtimeEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== "/api/realtime/ingest" && path !== "/api/realtime/stream") return null;
  if (!realtimeCapability(env)) {
    return Response.json({ ok: false, reasonCode: "realtime_disabled" }, { status: 404 });
  }
  if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return Response.json({ ok: false, reasonCode: "websocket_upgrade_required" }, { status: 426 });
  }
  const hub = env.REALTIME_HUB!.getByName("taiwan-market-v1");
  if (path === "/api/realtime/stream") {
    if (!realtimeViewerCapability(request, env)) {
      return Response.json({ ok: false, reasonCode: "realtime_browser_unauthorized" }, { status: 403 });
    }
    return hub.fetch(hubRequest(request, "browser"));
  }

  const requestUrl = new URL(request.url);
  const localSimulation = isLocalSimulationRequest(request, env)
    && (request.headers.get("x-realtime-local-simulation") === "true" || requestUrl.searchParams.get("simulation") === "true");
  const configured = [
    String(env.SHIOAJI_INGEST_SECRET || ""),
    String(env.SHIOAJI_INGEST_SECRET_NEXT || ""),
  ].filter(Boolean);
  const provided = String(request.headers.get("x-realtime-ingest-secret") || "");
  const connectionId = String(request.headers.get("x-realtime-connection-id") || (localSimulation ? requestUrl.searchParams.get("connectionId") : "") || "");
  const timestamp = Number(request.headers.get("x-realtime-timestamp") || (localSimulation ? requestUrl.searchParams.get("timestamp") : ""));
  if (
    (!localSimulation && !configured.length)
    || (!localSimulation && !provided)
    || !CONNECTION_ID.test(connectionId)
    || !Number.isFinite(timestamp)
    || Math.abs(Date.now() - timestamp) > 30_000
    || (!localSimulation && !(await Promise.all(configured.map((candidate) => sameSecret(candidate, provided)))).some(Boolean))
  ) {
    return Response.json({ ok: false, reasonCode: "realtime_ingest_unauthorized" }, { status: 403 });
  }
  return hub.fetch(hubRequest(request, "ingest", connectionId));
}

export async function readRealtimeHealth(env: RealtimeEnv) {
  if (!realtimeCapability(env)) {
    return {
      realtimeEnabled: false,
      gatewayState: "unavailable",
      sourceAgeMs: null,
      subscriptionCount: 0,
      dropCount: 0,
      replayCount: 0,
      quota: null,
      persistence: { durableObjectSqlite: Boolean(env.REALTIME_HUB), d1TickWrites: 0 },
    };
  }
  try {
    const stub = env.REALTIME_HUB!.getByName("taiwan-market-v1");
    const response = await stub.fetch(new Request("https://realtime.internal/_health"));
    if (!response.ok) throw new Error("realtime_health_unavailable");
    return await response.json();
  } catch {
    return {
      realtimeEnabled: true,
      gatewayState: "unavailable",
      sourceAgeMs: null,
      subscriptionCount: 0,
      dropCount: 0,
      replayCount: 0,
      quota: null,
      persistence: { durableObjectSqlite: true, d1TickWrites: 0 },
    };
  }
}

async function realtimeScopeId(request: Request, env: RealtimeEnv) {
  const principal = requestPrincipal(request);
  const identity = String(principal.accessUserId || principal.userId || "").trim();
  if (!identity) return null;
  const target = deploymentTargetForRequest(request);
  const keyMaterial = target === "local"
    ? "multichart-local-realtime-scope-v1"
    : String(env.SHIOAJI_INGEST_SECRET || "");
  if (!keyMaterial) return null;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyMaterial),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(identity)));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function notifyRealtimeWatchlistSymbols(request: Request, env: RealtimeEnv, symbols: string[]) {
  if (!realtimeCapability(env)) return { status: "disabled", acceptedSymbolCount: 0 };
  if (!realtimeViewerCapability(request, env)) return { status: "not-authorized", acceptedSymbolCount: 0 };
  const normalized = [...new Set(symbols.map((symbol) => String(symbol).trim().toUpperCase()))]
    .filter((symbol) => /^\d{4,6}[A-Z]?\.(TW|TWO)$/.test(symbol))
    .slice(0, 32);
  const scopeId = await realtimeScopeId(request, env);
  if (!scopeId) return { status: "not-authorized", acceptedSymbolCount: 0 };
  try {
    const stub = env.REALTIME_HUB!.getByName("taiwan-market-v1");
    const response = await stub.fetch(new Request("https://realtime.internal/_watchlist", {
      method: "POST",
      headers: { "content-type": "application/json", "x-realtime-role": "internal" },
      body: JSON.stringify({ scopeId, symbols: normalized }),
    }));
    const payload = await response.json() as { status?: string; acceptedSymbolCount?: number };
    return response.ok
      ? { status: String(payload.status || "queued"), acceptedSymbolCount: Number(payload.acceptedSymbolCount || 0) }
      : { status: "failed", acceptedSymbolCount: 0 };
  } catch {
    return { status: "failed", acceptedSymbolCount: 0 };
  }
}
