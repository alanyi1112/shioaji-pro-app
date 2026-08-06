import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parsePeRiverRunnerArgs, runPeRiverContinuous, runPeRiverTargets, safePeRiverRunnerError } from "../scripts/pe-river-continuous-backfill.mjs";

const finmind = JSON.parse(await readFile(new URL("./fixtures/finmind-pe-river.json", import.meta.url), "utf8"));
const official = JSON.parse(await readFile(new URL("./fixtures/official-pe-daily.json", import.meta.url), "utf8"));

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

test("runner 參數固定匿名來源，不要求 FinMind token", () => {
  const options = parsePeRiverRunnerArgs(["--trigger=schedule", "--run-id=test-run", "--site-url=https://site.example/"]);
  assert.deepEqual(options, { trigger: "schedule", runId: "test-run", siteUrl: "https://site.example" });
  assert.equal(safePeRiverRunnerError(new Error("HTTP 429")), "rate_limit_waiting");
});

test("runner 永遠先 latest 後 history，按月 bounded ingest 且只輸出安全 contract", async () => {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body, authorization: init.headers?.authorization || null });
    if (url.endsWith("/api/internal/pe-river-continuous-backfill") && body?.action === "start") return json({ ok: true, order: ["latest", "history"], latest: [{ symbol: "2330.TW", exchange: "TWSE" }, { symbol: "8069.TWO", exchange: "TPEx" }], history: [{ jobId: "pe-river:2330.TW", symbol: "2330.TW", exchange: "TWSE", startDate: "2026-07-21", endDate: "2026-07-22", attempt: 1 }], budget: { used: 2, limit: 240 } });
    if (url.endsWith("/api/internal/pe-river-continuous-backfill") && body?.action === "latest-refresh") return json({ ok: true, accepted: 1, provisionalAccepted: 1, provisional: [{ symbol: "2330.TW", status: "pending", dates: ["2026-07-22"] }], failures: { TPEx: "provider_unavailable" }, rows: [{ symbol: "2330.TW", exchange: "TWSE", sessionDate: "2026-07-21", officialClose: 2410, officialPeRatio: 32.4, validationStatus: "official_verified", source: "twse", provider: "twse", sourceDate: "2026-07-21" }] });
    if (url.includes("openapi.twse.com.tw")) return json(official.twse);
    if (url.includes("tpex_mainboard_peratio_analysis")) return json(official.tpexPe);
    if (url.includes("tpex_mainboard_quotes")) return json(official.tpexClose);
    if (url.includes("api.finmindtrade.com") && url.includes("TaiwanStockPER")) return json(finmind.twse.per);
    if (url.includes("api.finmindtrade.com") && url.includes("TaiwanStockPrice")) return json(finmind.twse.price);
    if (url.endsWith("/api/internal/taiwan-stock-pe-river")) return json({ ok: true, accepted: body.rows.length });
    if (url.endsWith("/api/internal/pe-river-continuous-backfill")) return json({ ok: true, status: "complete" });
    return json({}, 404);
  };
  const summary = await runPeRiverContinuous({ siteUrl: "https://site.example", trigger: "schedule", runId: "runner-test" }, { fetchImpl, controlHeaders: { authorization: "Bearer control" }, ingestHeaders: { authorization: "Bearer ingest" } });
  assert.equal(summary.latestAccepted, 2);
  assert.equal(summary.provisionalAccepted, 1);
  assert.equal(summary.fallbackAccepted, 1);
  assert.equal(summary.historyCompleted, 1);
  const latestComplete = calls.findIndex((call) => call.body?.action === "latest-refresh");
  const firstFinMind = calls.findIndex((call) => call.url.includes("api.finmindtrade.com"));
  assert.ok(latestComplete >= 0 && latestComplete < firstFinMind);
  assert.equal(calls.filter((call) => call.url.includes("api.finmindtrade.com")).length, 2);
  assert.equal(calls.filter((call) => call.url.endsWith("/api/internal/taiwan-stock-pe-river")).every((call) => call.body.rows.length <= 31), true);
  assert.equal(JSON.stringify(calls).includes("FINMIND_API_TOKEN"), false);
});

test("workflow contract 有兩個盤後窗口、singleton、最小權限與 8 target 上限", async () => {
  const workflow = await readFile(new URL("../.github/workflows/pe-river-continuous-backfill.yml", import.meta.url), "utf8");
  const runner = await readFile(new URL("../scripts/pe-river-continuous-backfill.mjs", import.meta.url), "utf8");
  assert.match(workflow, /30 11 \* \* 1-5/);
  assert.match(workflow, /30 15 \* \* 1-5/);
  assert.match(workflow, /group: pe-river-continuous-backfill/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /timeout-minutes: 25/);
  assert.match(workflow, /Refresh official and provisional latest data/);
  assert.match(runner, /PE_RIVER_MAX_HISTORY_TARGETS/);
  assert.match(runner, /PROTECTED_POST_TIMEOUT_MS = 90_000/);
  assert.doesNotMatch(workflow, /FINMIND_API_TOKEN/);
});

test("相同歷史來源只下載一次，再依序 ingest 兩個獨立 target", async () => {
  let sourceDownloads = 0;
  const ingestOrder = [];
  const fetchHistory = async () => {
    sourceDownloads += 1;
    return {
      rows: [{ symbol: "2330.TW", exchange: "TWSE", sessionDate: "2026-07-21", officialClose: 2410, officialPeRatio: 32.4, fiscalYear: "2026", fiscalQuarter: "Q2", source: "finmind", provider: "finmind", sourceDate: "2026-07-21" }],
    };
  };
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const body = init.body ? JSON.parse(init.body) : null;
    if (url.pathname.endsWith("pe-river-continuous-backfill") && body.action === "start") return json({ ok: true, order: ["latest", "history"], latest: [{ symbol: "2330.TW", exchange: "TWSE" }], history: [{ jobId: "pe-river:2330.TW", symbol: "2330.TW", exchange: "TWSE", startDate: "2026-07-21", endDate: "2026-07-21", months: ["2026-07"], attempt: 1 }], budget: { used: 1, limit: 240 } });
    if (url.pathname.endsWith("pe-river-continuous-backfill") && body.action === "latest-refresh") return json({ ok: true, accepted: 1, provisionalAccepted: 0, rows: [{ symbol: "2330.TW", exchange: "TWSE", sessionDate: "2026-07-21", officialClose: 2410, officialPeRatio: 32.4, validationStatus: "official_verified", source: "twse", provider: "twse", sourceDate: "2026-07-21" }] });
    if (url.pathname.endsWith("taiwan-stock-pe-river")) {
      ingestOrder.push(url.host);
      return json({ ok: true, accepted: body.rows.length });
    }
    if (url.pathname.endsWith("pe-river-continuous-backfill")) return json({ ok: true });
    return json({}, 404);
  };
  const summary = await runPeRiverTargets([
    { targetId: "sites", siteUrl: "https://sites.example", trigger: "schedule", runId: "sites-run", controlHeaders: { authorization: "Bearer sites-control" }, ingestHeaders: { authorization: "Bearer sites-ingest" } },
    { targetId: "cloudflare", siteUrl: "https://cloudflare.example", trigger: "schedule", runId: "cloudflare-run", controlHeaders: { authorization: "Bearer cf-control" }, ingestHeaders: { authorization: "Bearer cf-ingest" } },
  ], { fetchImpl, fetchHistory });
  assert.equal(sourceDownloads, 1);
  assert.equal(summary.sourceDownloads, 1);
  assert.equal(summary.completedTargets, 2);
  assert.deepEqual([...new Set(ingestOrder)], ["sites.example", "cloudflare.example"]);
  assert.equal(summary.targets.every((target) => target.historyCompleted === 1), true);
});

test("單一 target ingest 失敗不回滾或阻斷另一 target，摘要只含安全 reason", async () => {
  const fetchHistory = async () => ({ rows: [{ symbol: "2330.TW", exchange: "TWSE", sessionDate: "2026-07-21", officialClose: 2410, officialPeRatio: 32.4, source: "finmind", provider: "finmind", sourceDate: "2026-07-21" }] });
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const body = init.body ? JSON.parse(init.body) : null;
    if (url.pathname.endsWith("pe-river-continuous-backfill") && body.action === "start") return json({ ok: true, order: ["latest", "history"], latest: [], history: [{ jobId: "pe-river:2330.TW", symbol: "2330.TW", exchange: "TWSE", startDate: "2026-07-21", endDate: "2026-07-21", attempt: 1 }], budget: { used: 1, limit: 240 } });
    if (url.pathname.endsWith("pe-river-continuous-backfill") && body.action === "latest-refresh") return json({ ok: true, accepted: 0, provisionalAccepted: 0, rows: [], failures: { TWSE: "official_not_published", TPEx: "official_not_published" } });
    if (url.pathname.endsWith("taiwan-stock-pe-river") && url.host === "bad.example") return json({ ok: false, reasonCode: "schema_mismatch", detail: "credential=never-log" }, 400);
    if (url.pathname.endsWith("taiwan-stock-pe-river")) return json({ ok: true, accepted: body.rows.length });
    if (url.pathname.endsWith("pe-river-continuous-backfill")) return json({ ok: true });
    throw new Error("unexpected");
  };
  const summary = await runPeRiverTargets([
    { targetId: "bad", siteUrl: "https://bad.example", trigger: "schedule", runId: "same-schedule", controlHeaders: {}, ingestHeaders: {} },
    { targetId: "good", siteUrl: "https://good.example", trigger: "schedule", runId: "same-schedule", controlHeaders: {}, ingestHeaders: {} },
  ], { fetchImpl, fetchHistory });
  assert.equal(summary.partialTargets, 1);
  assert.equal(summary.completedTargets, 1);
  assert.equal(summary.sourceDownloads, 1);
  assert.equal(summary.targets.find((target) => target.targetId === "good").historyCompleted, 1);
  assert.equal(JSON.stringify(summary).includes("credential"), false);
});

test("來源未發布與 rate limit 都 bounded 結束，重複 schedule runId 不產生無界重試", async () => {
  let historyDownloads = 0;
  let failedActions = 0;
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const body = init.body ? JSON.parse(init.body) : null;
    if (url.pathname.endsWith("pe-river-continuous-backfill") && body.action === "start") return json({ ok: true, order: ["latest", "history"], latest: [], history: [{ jobId: "pe-river:2330.TW", symbol: "2330.TW", exchange: "TWSE", startDate: "2026-07-21", endDate: "2026-07-21", attempt: 2 }], budget: { used: 2, limit: 240 } });
    if (url.pathname.endsWith("pe-river-continuous-backfill") && body.action === "latest-refresh") return json({ ok: true, accepted: 0, provisionalAccepted: 0, rows: [], failures: { TWSE: "official_not_published", TPEx: "official_not_published" } });
    if (url.pathname.endsWith("pe-river-continuous-backfill") && body.action === "history-failed") { failedActions += 1; return json({ ok: true }); }
    if (url.pathname.endsWith("pe-river-continuous-backfill")) return json({ ok: true });
    return json([], 200);
  };
  const fetchHistory = async () => { historyDownloads += 1; throw new Error("HTTP 429 token=never-log"); };
  const target = { targetId: "cloudflare", siteUrl: "https://target.example", trigger: "schedule", runId: "duplicate-schedule", controlHeaders: {}, ingestHeaders: {} };
  const summary = await runPeRiverTargets([target, target], { fetchImpl, fetchHistory });
  assert.equal(historyDownloads, 1);
  assert.equal(failedActions, 2);
  assert.equal(summary.sourceDownloads, 1);
  assert.equal(summary.partialTargets, 2);
  assert.equal(JSON.stringify(summary).includes("never-log"), false);
});
