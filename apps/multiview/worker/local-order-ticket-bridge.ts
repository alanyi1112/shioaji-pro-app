import { handleLocalShioajiAdapter } from "./local-shioaji-adapter.ts";

type BridgeEnv = {
  SHIOAJI_API_TARGET?: string;
  REALTIME_STOCK_WEB_URL?: string;
};

const ALLOWED_SECURITY_TYPES = new Set(["STK", "WRT"]);
const ALLOWED_EXCHANGES = new Set(["TSE", "OTC", "OES"]);

function json(reasonCode: string, status: number) {
  return Response.json({ ok: false, reasonCode }, { status, headers: { "cache-control": "no-store" } });
}

function validLoopbackWeb(value: string | undefined) {
  const url = new URL(value || "http://127.0.0.1:5173");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname) || url.port !== "5173") throw new Error("invalid_web_target");
  if (url.username || url.password || (url.pathname !== "/" && url.pathname !== "")) throw new Error("invalid_web_target");
  return url;
}

function unavailablePage(code: string) {
  const safeCode = code.replace(/[^A-Z0-9]/g, "");
  return new Response(`<!doctype html><html lang="zh-Hant-TW"><meta charset="utf-8"><title>下單面板未啟動</title><style>body{font:16px system-ui;background:#0b1220;color:#e5e7eb;padding:32px}a{color:#60a5fa}</style><h1>RealTimeStock 下單面板未啟動</h1><p>無法連線到 127.0.0.1:5173。請先啟動 RealTimeStock，再重試 ${safeCode}。</p><p><a href="javascript:location.reload()">重新檢查</a></p>`, {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function handleLocalOrderTicketBridge(
  request: Request,
  env: BridgeEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/local-order-ticket") return null;
  if (request.method !== "GET" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) return json("bridge_not_allowed", 403);
  const allowed = new Set(["code", "security_type", "exchange"]);
  for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) return json("invalid_bridge_schema", 400);
  const code = String(url.searchParams.get("code") || "").trim().toUpperCase();
  const securityType = String(url.searchParams.get("security_type") || "");
  const exchange = String(url.searchParams.get("exchange") || "");
  if (!/^[A-Z0-9]{2,12}$/.test(code) || !ALLOWED_SECURITY_TYPES.has(securityType) || !ALLOWED_EXCHANGES.has(exchange)) return json("unsupported_order_contract", 400);

  const contractResponse = await handleLocalShioajiAdapter(new Request(
    `${url.origin}/local-shioaji/api/v1/data/contracts/${encodeURIComponent(code)}?security_type=${securityType}&region=TW`,
  ), env, fetchImpl);
  if (contractResponse?.status === 409) return json("simulation_required", 409);
  if (!contractResponse?.ok) return json("contract_resolution_failed", 422);
  const contract = await contractResponse.json() as Record<string, unknown>;
  if (String(contract.code || "").toUpperCase() !== code || contract.security_type !== securityType || contract.exchange !== exchange) return json("contract_mismatch", 422);

  let target: URL;
  try { target = validLoopbackWeb(env.REALTIME_STOCK_WEB_URL); }
  catch { return json("invalid_realtimestock_target", 503); }
  try {
    const probe = await fetchImpl(target, { method: "GET", redirect: "error", signal: AbortSignal.timeout(2_000) });
    if (!probe.ok) return unavailablePage(code);
  } catch {
    return unavailablePage(code);
  }
  target.searchParams.set("popout", "ticket");
  target.searchParams.set("bridge", "multiview");
  target.searchParams.set("code", code);
  target.searchParams.set("security_type", securityType);
  target.searchParams.set("exchange", exchange);
  return Response.redirect(target.toString(), 302);
}
