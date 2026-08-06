const PREFIX = "/local-shioaji";
const MAX_BODY_BYTES = 32 * 1024;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_SYMBOLS = 8;
const REST_TIMEOUT_MS = 8_000;
const SIMULATION_CHECK_TTL_MS = 2_000;
const ALLOWED_SECURITY_TYPES = new Set(["STK", "IND", "WRT"]);
const ALLOWED_EXCHANGES = new Set(["TSE", "OTC", "OES"]);
const ALLOWED_QUOTE_TYPES = new Set(["Tick", "BidAsk", "Quote"]);

type AdapterEnv = { SHIOAJI_API_TARGET?: string };
type JsonRecord = Record<string, unknown>;

const counters = {
  accepted: 0,
  rejected: 0,
  upstreamErrors: 0,
  activeStreams: 0,
};

const simulationChecks = new WeakMap<typeof fetch, Map<string, { expiresAt: number; result: Promise<boolean> }>>();

function response(reasonCode: string, status: number) {
  return Response.json({ ok: false, reasonCode }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function reject(reasonCode: string, status = 403) {
  counters.rejected += 1;
  return response(reasonCode, status);
}

function ownKeys(value: JsonRecord, allowed: string[]) {
  const set = new Set(allowed);
  return Object.keys(value).every((key) => set.has(key));
}

function validContract(value: unknown, extraKeys: string[] = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as JsonRecord;
  if (!ownKeys(item, ["security_type", "region", "exchange", "code", "target_code", ...extraKeys])) return false;
  const code = String(item.code || "").trim().toUpperCase();
  const targetCode = item.target_code == null ? null : String(item.target_code).trim().toUpperCase();
  return ALLOWED_SECURITY_TYPES.has(String(item.security_type || ""))
    && String(item.region || "TW") === "TW"
    && ALLOWED_EXCHANGES.has(String(item.exchange || ""))
    && /^[A-Z0-9]{2,12}$/.test(code)
    && (targetCode === null || /^[A-Z0-9]{2,12}$/.test(targetCode));
}

async function jsonBody(request: Request): Promise<JsonRecord | null> {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (!text || new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonRecord : null;
  } catch {
    return null;
  }
}

function validContractQuery(url: URL) {
  const allowed = new Set(["security_type", "region"]);
  for (const key of url.searchParams.keys()) if (!allowed.has(key)) return false;
  const region = url.searchParams.get("region");
  const securityType = url.searchParams.get("security_type");
  return (!region || region === "TW") && (!securityType || ALLOWED_SECURITY_TYPES.has(securityType));
}

function contractPath(path: string) {
  const match = path.match(/^\/api\/v1\/data\/contracts\/([^/]+)(?:\/info)?$/);
  if (!match) return false;
  try {
    const code = decodeURIComponent(match[1]).trim().toUpperCase();
    return !["FUTURES", "OPTIONS", "WARRANTS"].includes(code) && /^[A-Z0-9]{2,12}$/.test(code);
  } catch {
    return false;
  }
}

async function validateBody(path: string, body: JsonRecord | null) {
  if (!body) return false;
  if (path === "/api/v1/data/snapshots") {
    return ownKeys(body, ["contracts"])
      && Array.isArray(body.contracts)
      && body.contracts.length >= 1
      && body.contracts.length <= MAX_SYMBOLS
      && body.contracts.every((item) => validContract(item));
  }
  if (path === "/api/v1/data/kbars") {
    return ownKeys(body, ["contract", "start", "end"])
      && validContract(body.contract)
      && /^\d{4}-\d{2}-\d{2}$/.test(String(body.start || ""))
      && /^\d{4}-\d{2}-\d{2}$/.test(String(body.end || ""))
      && String(body.start) <= String(body.end);
  }
  if (["/api/v1/stream/subscribe", "/api/v1/stream/unsubscribe"].includes(path)) {
    return ownKeys(body, ["security_type", "region", "exchange", "code", "target_code", "quote_type", "intraday_odd"])
      && validContract(body, ["quote_type", "intraday_odd"])
      && ALLOWED_QUOTE_TYPES.has(String(body.quote_type || ""))
      && body.intraday_odd === false;
  }
  return false;
}

function upstreamBase(env: AdapterEnv) {
  const url = new URL(env.SHIOAJI_API_TARGET || "http://127.0.0.1:8080");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) throw new Error("invalid_target");
  if (url.username || url.password || (url.pathname !== "/" && url.pathname !== "")) throw new Error("invalid_target");
  return url;
}

function isStream(path: string, method: string) {
  return method === "GET" && path === "/api/v1/stream/data";
}

async function simulationAvailable(base: URL, fetchImpl: typeof fetch) {
  let checks = simulationChecks.get(fetchImpl);
  if (!checks) {
    checks = new Map();
    simulationChecks.set(fetchImpl, checks);
  }
  const key = base.origin;
  const now = Date.now();
  const current = checks.get(key);
  if (current && current.expiresAt > now) return current.result;
  const result = (async () => {
    try {
      const upstream = await fetchImpl(new URL("/api/v1/info", base), {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(REST_TIMEOUT_MS),
      });
      if (!upstream.ok) return false;
      const text = await upstream.text();
      if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return false;
      const payload = JSON.parse(text) as JsonRecord;
      return payload.simulation === true;
    } catch {
      return false;
    }
  })();
  checks.set(key, { expiresAt: now + SIMULATION_CHECK_TTL_MS, result });
  return result;
}

export function localShioajiAdapterHealth() {
  return { configured: true, dataOnly: true, simulationOnly: true, maxSymbols: MAX_SYMBOLS, ...counters };
}

export async function handleLocalShioajiAdapter(
  request: Request,
  env: AdapterEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response | null> {
  const incoming = new URL(request.url);
  if (incoming.pathname !== PREFIX && !incoming.pathname.startsWith(`${PREFIX}/`)) return null;
  if (!["127.0.0.1", "localhost", "::1"].includes(incoming.hostname)) return reject("loopback_origin_required");

  const path = incoming.pathname.slice(PREFIX.length) || "/";
  const method = request.method.toUpperCase();
  let bodyText: string | undefined;

  const simpleGet = method === "GET"
    && ["/api/v1/info", "/api/v1/health", "/api/v1/stream/data"].includes(path)
    && incoming.search === "";
  const contractGet = method === "GET" && contractPath(path) && validContractQuery(incoming);
  const post = method === "POST" && [
    "/api/v1/data/snapshots",
    "/api/v1/data/kbars",
    "/api/v1/stream/subscribe",
    "/api/v1/stream/unsubscribe",
  ].includes(path);

  if (!simpleGet && !contractGet && !post) return reject("route_not_allowed");
  if (post) {
    const body = await jsonBody(request);
    if (!(await validateBody(path, body))) return reject("invalid_request_schema", 400);
    bodyText = JSON.stringify(body);
  }

  let base: URL;
  try {
    base = upstreamBase(env);
  } catch {
    return reject("invalid_upstream_target", 503);
  }
  const target = new URL(path, base);
  target.search = incoming.search;
  if (!["/api/v1/info", "/api/v1/health"].includes(path) && !(await simulationAvailable(base, fetchImpl))) {
    return reject("simulation_required", 409);
  }
  const streaming = isStream(path, method);
  const controller = streaming ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), REST_TIMEOUT_MS) : null;
  try {
    const upstream = await fetchImpl(target, {
      method,
      headers: {
        accept: streaming ? "text/event-stream" : "application/json",
        ...(bodyText ? { "content-type": "application/json" } : {}),
      },
      body: bodyText,
      signal: controller?.signal ?? request.signal,
      redirect: "error",
    });
    counters.accepted += 1;
    if (streaming) {
      counters.activeStreams += 1;
      const stream = upstream.body?.pipeThrough(new TransformStream({
        flush() { counters.activeStreams = Math.max(0, counters.activeStreams - 1); },
      }));
      return new Response(stream, {
        status: upstream.status,
        headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" },
      });
    }
    const declared = Number(upstream.headers.get("content-length") || 0);
    if (declared > MAX_RESPONSE_BYTES) return response("upstream_response_too_large", 502);
    const payload = await upstream.arrayBuffer();
    if (payload.byteLength > MAX_RESPONSE_BYTES) return response("upstream_response_too_large", 502);
    return new Response(payload, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "no-store" },
    });
  } catch (error) {
    counters.upstreamErrors += 1;
    return response(error instanceof DOMException && error.name === "AbortError" ? "upstream_timeout" : "upstream_unavailable", error instanceof DOMException && error.name === "AbortError" ? 504 : 502);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
