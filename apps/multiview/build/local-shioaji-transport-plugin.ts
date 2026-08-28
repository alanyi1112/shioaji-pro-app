import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { handleLocalShioajiAdapter } from "../worker/local-shioaji-adapter";
import { handleLocalOrderTicketBridge } from "../worker/local-order-ticket-bridge";
import { withLocalLauncherCors } from "../worker/local-launcher-cors";

const DATA_PREFIX = "/local-shioaji";
const ORDER_TICKET_PATH = "/local-order-ticket";
const MAX_BODY_BYTES = 32 * 1024;

type Options = { upstream: string; webTarget?: string };

async function requestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function safeFailure(response: ServerResponse, status: number, reasonCode: string) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify({ ok: false, reasonCode }));
}

async function writeResponse(response: ServerResponse, result: Response) {
  response.statusCode = result.status;
  for (const [name, value] of result.headers) {
    if (!["connection", "content-encoding", "transfer-encoding"].includes(name.toLowerCase())) response.setHeader(name, value);
  }
  if (!result.body) {
    response.end();
    return;
  }
  Readable.fromWeb(result.body as never).pipe(response);
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, options: Options) {
  try {
    const method = String(request.method || "GET").toUpperCase();
    const body = method === "GET" || method === "HEAD" ? undefined : await requestBody(request);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
      else if (value != null) headers.set(name, value);
    }
    const host = String(request.headers.host || "127.0.0.1:5174");
    const adapterRequest = new Request(`http://${host}${request.url || "/"}`, { method, headers, body });
    const env = { SHIOAJI_API_TARGET: options.upstream, REALTIME_STOCK_WEB_URL: options.webTarget };
    const result = new URL(adapterRequest.url).pathname === ORDER_TICKET_PATH
      ? await handleLocalOrderTicketBridge(adapterRequest, env, fetch)
      : await handleLocalShioajiAdapter(adapterRequest, env, fetch);
    if (!result) {
      safeFailure(response, 404, "route_not_found");
      return;
    }
    await writeResponse(response, withLocalLauncherCors(adapterRequest, result));
  } catch (error) {
    safeFailure(response, error instanceof Error && error.message === "request_too_large" ? 413 : 502, "local_adapter_unavailable");
  }
}

export function localShioajiTransportPlugin(options: Options): Plugin {
  const upstream = new URL(options.upstream);
  if (
    upstream.protocol !== "http:"
    || !["127.0.0.1", "localhost", "::1"].includes(upstream.hostname)
    || upstream.username
    || upstream.password
  ) throw new Error("MultiView local transport upstream 必須是無憑證的 loopback HTTP");
  const webTarget = new URL(options.webTarget || "http://127.0.0.1:5173");
  if (
    webTarget.protocol !== "http:"
    || !["127.0.0.1", "localhost", "::1"].includes(webTarget.hostname)
    || webTarget.port !== "5173"
    || webTarget.username
    || webTarget.password
    || (webTarget.pathname !== "/" && webTarget.pathname !== "")
  ) throw new Error("MultiView order ticket target 必須是無憑證的 5173 loopback HTTP");
  return {
    name: "multiview-local-shioaji-transport",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || "/", "http://127.0.0.1:5174").pathname;
        if (pathname !== ORDER_TICKET_PATH && pathname !== DATA_PREFIX && !pathname.startsWith(`${DATA_PREFIX}/`)) return next();
        void handleRequest(request, response, { upstream: upstream.toString(), webTarget: webTarget.toString() });
      });
    },
  };
}

export const localShioajiTransportContract = {
  dataPrefix: DATA_PREFIX,
  orderTicketPath: ORDER_TICKET_PATH,
  maxBodyBytes: MAX_BODY_BYTES,
};
