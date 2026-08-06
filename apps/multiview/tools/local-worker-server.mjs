import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteD1 } from "../tests/helpers/sqlite-d1.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const publicRoot = resolve(root, "public");
const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("local-worker-server", `${Date.now()}-${Math.random()}`);
const worker = (await import(workerUrl.href)).default;
const db = new SqliteD1();
const port = Number(process.env.LOCAL_WORKER_PORT || 3100);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

async function assetResponse(request) {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const relative = pathname === "/" ? "static/index.html" : pathname.replace(/^\/+/, "");
  const path = resolve(publicRoot, relative);
  if (path !== publicRoot && !path.startsWith(`${publicRoot}${sep}`)) return new Response("Forbidden", { status: 403 });
  try {
    const body = await readFile(path);
    return new Response(body, { headers: { "content-type": contentTypes[extname(path)] || "application/octet-stream" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

const env = {
  DB: db,
  ASSETS: { fetch: assetResponse },
  IMAGES: {},
};

const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://127.0.0.1:${port}${incoming.url || "/"}`, {
      method: incoming.method,
      headers: { ...incoming.headers, "oai-authenticated-user-email": "local-acceptance@example.invalid" },
      ...(body ? { body } : {}),
    });
    const context = { waitUntil(promise) { Promise.resolve(promise).catch(() => {}); }, passThroughOnException() {} };
    const response = await worker.fetch(request, env, context);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    outgoing.end(error instanceof Error ? error.message : "Internal Server Error");
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Local Worker acceptance server: http://127.0.0.1:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
