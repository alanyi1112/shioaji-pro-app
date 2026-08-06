import { spawn } from "node:child_process";

const host = "localhost";
const port = 4189;
const origin = `http://${host}:${port}`;
const socketOrigin = `ws://${host}:${port}`;
const timeoutMs = 60_000;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForPreview() {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/config`);
      if (response.ok) return response.json();
    } catch {
      // Preview is still starting.
    }
    await wait(250);
  }
  throw new Error("realtime_preview_start_timeout");
}

function opened(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("realtime_preview_websocket_timeout")), 10_000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("realtime_preview_websocket_failed"));
    }, { once: true });
  });
}

function waitForMessage(socket, label, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`realtime_preview_${label}_timeout`)), 15_000);
    const listener = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (!predicate(payload)) return;
        clearTimeout(timer);
        socket.removeEventListener("message", listener);
        resolve(payload);
      } catch {
        // Ignore unrelated or malformed messages; the timeout remains bounded.
      }
    };
    socket.addEventListener("message", listener);
  });
}

function taipeiSessionDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

const preview = spawn("npm", ["run", "dev", "--", "--host", host, "--port", String(port)], {
  cwd: process.cwd(),
  env: { ...process.env, ENABLE_REALTIME_LOCAL_TEST: "true" },
  stdio: ["ignore", "ignore", "ignore"],
});

let browser;
let ingest;
try {
  const config = await waitForPreview();
  if (config?.deploymentTarget !== "local" || config?.capabilities?.taiwanRealtime !== true) {
    throw new Error("realtime_preview_capability_missing");
  }

  browser = new WebSocket(`${socketOrigin}/api/realtime/stream`);
  const browserReady = waitForMessage(browser, "browser_ready", (payload) => payload.type === "ready" && payload.role === "browser");
  await opened(browser);
  browser.send(JSON.stringify({ type: "subscribe", symbols: ["2330.TW"] }));
  await browserReady;

  const now = new Date();
  const connectionId = `local-simulation-${process.pid}-${Date.now()}`;
  ingest = new WebSocket(`${socketOrigin}/api/realtime/ingest?simulation=true&timestamp=${Date.now()}&connectionId=${connectionId}`);
  const ingestReady = waitForMessage(ingest, "ingest_ready", (payload) => payload.type === "ready" && payload.role === "ingest");
  await opened(ingest);
  await ingestReady;

  const marketBatch = waitForMessage(browser, "market_batch", (payload) => payload.type === "market-batch-v1" && payload.updates?.[0]?.canonicalSymbol === "2330.TW");
  ingest.send(JSON.stringify({
    type: "market-batch-v1",
    connectionId,
    sequence: 1,
    sentAt: now.toISOString(),
    updates: [{
      canonicalSymbol: "2330.TW", exchange: "TWSE", sessionDate: taipeiSessionDate(now),
      sourceTime: now.toISOString(), receivedTime: now.toISOString(),
      open: 100, high: 102, low: 99, close: 101, averagePrice: 100.5,
      tickVolume: 2, totalVolume: 20, simtrade: true, sequence: 1,
      connectionId, provider: "shioaji", continuity: "complete", reasonCode: "none",
    }],
  }));
  const delivered = await marketBatch;
  if (delivered.updates.length !== 1) throw new Error("realtime_preview_delivery_invalid");

  const healthResponse = await fetch(`${origin}/api/health`);
  const health = await healthResponse.json();
  if (!healthResponse.ok || health?.realtime?.persistence?.d1TickWrites !== 0) {
    throw new Error("realtime_preview_health_invalid");
  }
  console.log("realtime-preview: local Durable Object ingest/stream passed; D1 Tick writes=0");
} finally {
  try { browser?.close(); } catch {}
  try { ingest?.close(); } catch {}
  preview.kill("SIGTERM");
}
