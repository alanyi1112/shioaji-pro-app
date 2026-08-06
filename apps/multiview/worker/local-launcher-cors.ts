const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);
const ALLOWED_PATHS = new Set([
  "/api/health",
  "/local-shioaji/api/v1/info",
]);

export function withLocalLauncherCors(request: Request, response: Response) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin") || "";
  if (
    request.method !== "GET"
    || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    || !ALLOWED_PATHS.has(url.pathname)
    || !ALLOWED_ORIGINS.has(origin)
  ) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const localLauncherCorsContract = {
  origins: [...ALLOWED_ORIGINS],
  paths: [...ALLOWED_PATHS],
};
