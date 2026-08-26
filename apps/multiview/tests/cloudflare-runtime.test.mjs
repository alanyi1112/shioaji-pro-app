import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { D1_SAFE_BATCH_SIZE, runD1Batch } from "../worker/d1-batch.ts";
import { SqliteD1 } from "./helpers/sqlite-d1.mjs";

const appSource = await readFile(new URL("../public/static/app.js", import.meta.url), "utf8");
const coordinatorSource = await readFile(new URL("../public/static/live-batch-coordinator.js", import.meta.url), "utf8");
const indexHtml = await readFile(new URL("../public/static/index.html", import.meta.url), "utf8");
const workerSource = await readFile(new URL("../worker/app.ts", import.meta.url), "utf8");
const entrySource = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../drizzle/0016_living_mentallo.sql", import.meta.url), "utf8");
const deployDocs = await readFile(new URL("../docs/cloudflare-deployment.md", import.meta.url), "utf8");
const cloudflareConfig = await readFile(new URL("../scripts/cloudflare-config.mjs", import.meta.url), "utf8");

async function builtWorker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("cloudflare-runtime-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

test("Sites 與 Cloudflare visible panels 共用頁面級 batch coordinator，production panel path 不建立 EventSource", () => {
  assert.match(indexHtml, /acceptance-metrics\.js\?v=20260807-business-recovery-v1[\s\S]*live-batch-coordinator\.js\?v=20260807-runtime-e2e-v1[\s\S]*chart-volume-contract\.js\?v=20260824-common-lot-v1[\s\S]*kbar-turnover\.js\?v=20260826-turnover-readout-v1[\s\S]*daily-minute-drilldown-contract\.js\?v=20260826-turnover-readout-v2[\s\S]*realtime-coordinator\.js\?v=20260826-turnover-readout-v2[\s\S]*realtime-charts\.js\?v=20260826-turnover-readout-v1[\s\S]*chart-payload\.js\?v=20260826-turnover-readout-v1[\s\S]*panel-reordering\.js\?v=20260804-panel-reorder-v1[\s\S]*app\.js\?v=20260826-turnover-readout-v2/);
  assert.match(appSource, /const liveBatchCoordinator = window\.QuoteChartLiveBatch\.createLiveBatchCoordinator\(\)/);
  assert.match(appSource, /liveBatchCoordinator\.subscribe\(panelSubscriptionId/);
  assert.match(coordinatorSource, /fetchImpl\("\/api\/candles\/batch"/);
  assert.match(coordinatorSource, /isHidden\(\) \|\| !isOnline\(\)/);
  assert.match(coordinatorSource, /sessions\.some[\s\S]*\? DEFAULT_OPEN_DELAY_MS[\s\S]*: DEFAULT_CLOSED_DELAY_MS/);
  assert.match(coordinatorSource, /windowTarget\?\.addEventListener\?\.\("online", requestImmediate\)/);
  assert.match(coordinatorSource, /documentTarget\?\.addEventListener\?\.\("visibilitychange"/);
  assert.doesNotMatch(appSource, /new EventSource\(/);
  assert.doesNotMatch(appSource, /state\.appConfig\.deploymentTarget === "cloudflare"/);
  assert.match(appSource, /await Promise\.all\(\[instrumentsPromise, appConfigPromise\]\)/);
});

test("batch candles 限制八圖並逐項回傳，不因單一商品失敗清除其他結果", async () => {
  const service = await builtWorker();
  const response = await service.fetch(new Request("https://multiview.example/api/candles/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requests: [
      { id: "panel-0", symbol: "SAMPLE", interval: "1d", pivot: "off", indicatorQuery: "rsi_short=5&rsi_long=10" },
      { id: "panel-1", symbol: "SAMPLE", interval: "1wk", pivot: "traditional", indicatorQuery: "" },
    ] }),
  }), {}, { waitUntil() {}, passThroughOnException() {} });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.items.map((item) => item.id), ["panel-0", "panel-1"]);
  assert.equal(payload.items.every((item) => item.ok && item.payload.candles.length > 0), true);

  const tooMany = await service.fetch(new Request("https://multiview.example/api/candles/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requests: Array.from({ length: 9 }, (_, index) => ({ id: `p-${index}`, symbol: "SAMPLE", interval: "1d" })) }),
  }), {}, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(tooMany.status, 400);
});

test("相同頁面級 batch 以共享市場資料字串快取回應，避免每次輪詢重算所有圖", async () => {
  const service = await builtWorker();
  const db = new SqliteD1();
  const body = JSON.stringify({ requests: [
    { id: "panel-0", symbol: "SAMPLE", interval: "1d", pivot: "off", indicatorQuery: "" },
    { id: "panel-1", symbol: "SAMPLE", interval: "1d", pivot: "off", indicatorQuery: "rsi_short=5" },
  ] });
  const invoke = () => service.fetch(new Request("http://localhost/api/candles/batch", { method: "POST", headers: { "content-type": "application/json" }, body }), { DB: db }, { waitUntil() {}, passThroughOnException() {} });
  try {
    const first = await (await invoke()).text();
    const second = await (await invoke()).text();
    assert.equal(second, first);
    assert.equal(db.database.prepare("SELECT COUNT(*) AS rows FROM candle_cache WHERE cache_key LIKE 'candle-batch-v1|%'").get().rows, 1);
  } finally {
    db.close();
  }
});

test("D1 batch helper 將 statement 固定切成最多四十筆", async () => {
  const calls = [];
  const db = { async batch(statements) { calls.push(statements); } };
  await runD1Batch(db, Array.from({ length: 81 }, (_, index) => index));
  assert.equal(D1_SAFE_BATCH_SIZE, 40);
  assert.deepEqual(calls.map((items) => items.length), [40, 40, 1]);
  await assert.rejects(() => runD1Batch(db, [1], 41), /invalid_d1_batch_size/);
});

test("Cloudflare 以 deploy-time migration 管理 schema，Sites hosting 設定保持獨立", () => {
  assert.match(migration, /CREATE TABLE `runtime_metadata`/);
  assert.match(entrySource, /markDeployTimeMigrations\(env\.DB\)/);
  assert.match(workerSource, /migrationManagedDatabases\.has\(key\)/);
  assert.match(workerSource, /SELECT value FROM runtime_metadata/);
  assert.match(deployDocs, /\.openai\/hosting\.json/);
  assert.doesNotMatch(deployDocs, /[a-f0-9]{32,}/i);
});

test("Access runtime bindings 避開 Cloudflare 平台保留前綴", () => {
  assert.match(cloudflareConfig, /ACCESS_TEAM_DOMAIN: String\(process\.env\.CLOUDFLARE_ACCESS_TEAM_DOMAIN\)/);
  assert.match(cloudflareConfig, /ACCESS_AUD: String\(process\.env\.CLOUDFLARE_ACCESS_AUD\)/);
  assert.doesNotMatch(cloudflareConfig, /\n\s+CLOUDFLARE_ACCESS_(?:TEAM_DOMAIN|AUD):/);
  assert.match(entrySource, /env\.ACCESS_OWNER_EMAIL/);
  assert.doesNotMatch(entrySource, /env\.CLOUDFLARE_ACCESS_OWNER_EMAIL/);
});

test("Cloudflare 本益比資料管線固定為私人非商業模式", () => {
  assert.match(cloudflareConfig, /PE_RIVER_ACCESS_MODE: "private"/);
  assert.match(cloudflareConfig, /PE_RIVER_COMMERCIAL_USE: "false"/);
  assert.doesNotMatch(cloudflareConfig, /PE_RIVER_ACCESS_MODE: "free"/);
});

test("Cloudflare TDCC 歷史自動查詢只接受明確 true，未設定仍 fail closed", () => {
  assert.match(cloudflareConfig, /process\.env\.TDCC_HISTORY_AUTOMATION_ENABLED \|\| "false"/);
  assert.match(cloudflareConfig, /toLowerCase\(\) === "true"/);
  assert.match(cloudflareConfig, /TDCC_HISTORY_AUTOMATION_ENABLED: tdccHistoryAutomationEnabled/);
  assert.doesNotMatch(cloudflareConfig, /TDCC_HISTORY_AUTOMATION_ENABLED: "true"/);
});
