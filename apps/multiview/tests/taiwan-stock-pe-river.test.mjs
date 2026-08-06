import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import {
  buildPeRiver,
  canonicalPeRiverSymbol,
  claimPeRiverBackfillMonths,
  failPeRiverBackfillMonth,
  ingestNormalizedPeRiverMonth,
  interpolatedPercentile,
  pairOfficialValuationRows,
  parseTpexHistoricalClose,
  parseTpexHistoricalPe,
  parseTwseHistoricalClose,
  parseTwseHistoricalPe,
  peRiverEligibility,
  queuePeRiverBackfill,
  readPeRiverRows,
  upsertPeRiverRows,
} from "../worker/taiwan-stock-pe-river.ts";
import { SqliteD1, applyDrizzleSql } from "./helpers/sqlite-d1.mjs";
import { ensurePeRiverPipelineColumns } from "../worker/pe-river-schema.ts";

const twse = JSON.parse(await readFile(new URL("./fixtures/twse-pe-river.json", import.meta.url), "utf8"));
const tpex = JSON.parse(await readFile(new URL("./fixtures/tpex-pe-river.json", import.meta.url), "utf8"));
const migration = await readFile(new URL("../drizzle/0011_blue_typhoid_mary.sql", import.meta.url), "utf8");
const pipelineMigration = await readFile(new URL("../drizzle/0012_pe_river_pipeline.sql", import.meta.url), "utf8");
const provisionalMigration = await readFile(new URL("../drizzle/0013_public_warstar.sql", import.meta.url), "utf8");

async function applyPeRiverMigrations(db) {
  applyDrizzleSql(db, migration);
  applyDrizzleSql(db, pipelineMigration);
  applyDrizzleSql(db, provisionalMigration);
  await ensurePeRiverPipelineColumns(db);
}

test("canonical 商品與 ordinary-stock eligibility 保守排除 ETF、非台股與非日 K", () => {
  assert.deepEqual(canonicalPeRiverSymbol("2330.tw"), { symbol: "2330.TW", stockCode: "2330", exchange: "TWSE" });
  assert.deepEqual(canonicalPeRiverSymbol("6488.TWO"), { symbol: "6488.TWO", stockCode: "6488", exchange: "TPEx" });
  assert.equal(peRiverEligibility({ symbol: "2330.TW", interval: "1d", quoteType: "EQUITY", groupName: "上市普通股" }).supported, true);
  assert.equal(peRiverEligibility({ symbol: "0050.TW", interval: "1d", quoteType: "ETF" }).reason, "not_eligible");
  assert.equal(peRiverEligibility({ symbol: "2330.TW", interval: "1wk", quoteType: "EQUITY" }).reason, "unsupported_interval");
  assert.equal(peRiverEligibility({ symbol: "BTC-USD", interval: "1d" }).supported, false);
});

test("TWSE parser 依欄位名稱配對同日官方收盤與本益比", () => {
  const peRows = parseTwseHistoricalPe(twse.pe, "2330.TW");
  const closeRows = parseTwseHistoricalClose(twse.close, "2330.TW");
  const paired = pairOfficialValuationRows({ symbol: "2330.TW", peRows, closeRows, fetchedAt: "2026-07-22T00:00:00Z" });
  assert.deepEqual(paired.map((row) => row.sessionDate), ["2026-01-02", "2026-01-05"]);
  assert.equal(paired[0].fiscalYear, "2025");
  assert.equal(paired[0].fiscalQuarter, "3");
  assert.ok(Math.abs(paired[0].referenceEps - (1585 / 28.82)) < 1e-10);

  const reordered = { fields: [...twse.pe.fields].reverse(), data: twse.pe.data.map((row) => [...row].reverse()) };
  assert.equal(parseTwseHistoricalPe(reordered, "2330.TW").length, 2);
  assert.deepEqual(parseTwseHistoricalPe({ fields: ["日期", "預估本益比"], data: [["115/01/02", "10"]] }, "2330.TW"), []);
});

test("TPEx parser 支援 tables schema 且官方 P/E 空白保留 gap", () => {
  const peRows = parseTpexHistoricalPe(tpex.pe, "6488.TWO");
  const closeRows = parseTpexHistoricalClose(tpex.close, "6488.TWO");
  const paired = pairOfficialValuationRows({ symbol: "6488.TWO", peRows, closeRows });
  assert.equal(peRows.length, 2);
  assert.equal(peRows[1].officialPeRatio, null);
  assert.equal(paired.length, 1);
  assert.equal(paired[0].sessionDate, "2026-01-02");
  assert.deepEqual(parseTpexHistoricalPe({ tables: [{ fields: ["日期", "forward P/E"], data: [["115/01/02", "20"]] }] }, "6488.TWO"), []);
});

test("不同市場、代號或日期不得混算，零負與非有限值不產生參考 EPS", () => {
  const peRows = parseTwseHistoricalPe(twse.pe, "2330.TW");
  const wrongDate = parseTwseHistoricalClose({ ...twse.close, data: [["115/01/03", ...twse.close.data[0].slice(1)]] }, "2330.TW");
  assert.equal(pairOfficialValuationRows({ symbol: "2330.TW", peRows, closeRows: wrongDate }).length, 0);
  assert.equal(pairOfficialValuationRows({ symbol: "6488.TWO", peRows, closeRows: parseTpexHistoricalClose(tpex.close, "6488.TWO") }).length, 0);
  assert.equal(parseTwseHistoricalPe({ fields: ["日期", "本益比", "財報年/季"], data: [["115/01/02", "-3", "114/3"], ["115/01/03", "Infinity", "114/3"]] }, "2330.TW").every((row) => row.officialPeRatio === null), true);
});

test("百分位使用 rank=(n-1)*p 線性插值且同 response 固定七個 multiplier", () => {
  assert.equal(interpolatedPercentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(interpolatedPercentile([10, 20, 30, 40, 50], 0.3), 22);
  const rows = Array.from({ length: 252 }, (_, index) => {
    const date = new Date(Date.UTC(2025, 0, 1 + index));
    const officialPeRatio = 10 + index / 20;
    return { exchange: "TWSE", symbol: "2330.TW", sessionDate: date.toISOString().slice(0, 10), officialClose: officialPeRatio * 10, officialPeRatio, referenceEps: 10, fiscalYear: "2024", fiscalQuarter: "3", source: "twse", sourceDate: date.toISOString().slice(0, 10), fetchedAt: "2026-07-22T00:00:00Z" };
  });
  const river = buildPeRiver(rows);
  assert.equal(river.status, "available");
  assert.equal(river.coverage.validSamples, 252);
  assert.deepEqual(Object.keys(river.multipliers), ["p5", "p20", "p35", "p50", "p65", "p80", "p95"]);
  assert.equal(river.points[0].prices.p50, rows[0].referenceEps * river.multipliers.p50);
  assert.equal(buildPeRiver(rows.slice(0, 251)).status, "insufficient_history");
});

test("provisional 最新尾端只延伸價格座標，不改變 verified percentile 與 252 筆門檻", () => {
  const verified = Array.from({ length: 252 }, (_, index) => {
    const date = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
    return { exchange: "TWSE", symbol: "2330.TW", sessionDate: date, officialClose: 200 + index, officialPeRatio: 10 + index / 100, referenceEps: (200 + index) / (10 + index / 100), fiscalYear: null, fiscalQuarter: null, source: "finmind", provider: "finmind", validationStatus: "finmind_overlap_verified", sourceDate: date, fetchedAt: "2026-07-22T00:00:00Z" };
  });
  const baseline = buildPeRiver(verified);
  const provisional = { ...verified.at(-1), sessionDate: "2026-07-22", officialClose: 2400, officialPeRatio: 999, referenceEps: 2400 / 999, validationStatus: "finmind_provisional_latest", officialOverlapDate: null };
  const river = buildPeRiver([...verified, provisional]);
  assert.deepEqual(river.multipliers, baseline.multipliers);
  assert.equal(river.coverage.validSamples, 252);
  assert.equal(river.coverage.verifiedEnd, verified.at(-1).sessionDate);
  assert.equal(river.coverage.displayEnd, "2026-07-22");
  assert.equal(river.points.at(-1).validationStatus, "finmind_provisional_latest");
  assert.equal(buildPeRiver([...verified.slice(0, 251), provisional]).status, "insufficient_history");
});

test("additive migration、唯一鍵與 repository upsert 保留 actual coverage", async () => {
  const db = new SqliteD1();
  try {
    db.exec("CREATE TABLE candle_cache (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    await applyPeRiverMigrations(db);
    const row = { exchange: "TWSE", symbol: "2330.TW", sessionDate: "2026-01-02", officialClose: 1585, officialPeRatio: 28.82, referenceEps: 1585 / 28.82, fiscalYear: "2025", fiscalQuarter: "3", source: "twse", sourceDate: "2026-01-02", fetchedAt: "2026-07-22T00:00:00Z" };
    await upsertPeRiverRows(db, [row, { ...row, officialClose: 1600, referenceEps: 1600 / 28.82 }]);
    const saved = await readPeRiverRows(db, "2330.TW");
    assert.equal(saved.length, 1);
    assert.equal(saved[0].officialClose, 1600);
    assert.equal(db.database.prepare("SELECT COUNT(*) AS rows FROM candle_cache").get().rows, 0);
  } finally { db.close(); }
});

test("normalized private ingest 驗證月份、唯一日期、正數與最大筆數", async () => {
  const db = new SqliteD1();
  try {
    await applyPeRiverMigrations(db);
    const result = await ingestNormalizedPeRiverMonth({ db, symbol: "6488.TWO", month: "2026-01", rows: [{ sessionDate: "2026-01-02", officialClose: 405.5, officialPeRatio: 19.42, fiscalYear: "2025", fiscalQuarter: "3" }] });
    assert.equal(result.accepted, 1);
    await assert.rejects(ingestNormalizedPeRiverMonth({ db, symbol: "6488.TWO", month: "2026-01", rows: [{ sessionDate: "2026-02-02", officialClose: 405.5, officialPeRatio: 19.42 }] }), /invalid_payload/);
    await assert.rejects(ingestNormalizedPeRiverMonth({ db, symbol: "6488.TWO", month: "2026-01", rows: [{ sessionDate: "2026-01-02", officialClose: 0, officialPeRatio: 19.42 }] }), /invalid_payload/);
  } finally { db.close(); }
});

test("月份 runner 可續跑、dedupe、lease 與 bounded retry", async () => {
  const db = new SqliteD1();
  try {
    await applyPeRiverMigrations(db);
    const queued = await queuePeRiverBackfill(db, { symbol: "2330.TW", targetStart: "2026-01-01", targetEnd: "2026-03-31" });
    assert.deepEqual(queued.missingMonths, ["2026-01", "2026-02", "2026-03"]);
    const duplicate = await queuePeRiverBackfill(db, { symbol: "2330.TW", targetStart: "2026-01-01", targetEnd: "2026-03-31" });
    assert.deepEqual(duplicate.missingMonths, ["2026-01", "2026-02", "2026-03"]);
    assert.equal(db.database.prepare("SELECT COUNT(*) AS rows FROM taiwan_stock_pe_backfill_month").get().rows, 3);
    const claimed = await claimPeRiverBackfillMonths(db, { owner: "runner-a", limit: 2, now: new Date("2026-07-22T00:00:00Z") });
    assert.equal(claimed.length, 2);
    assert.equal((await claimPeRiverBackfillMonths(db, { owner: "runner-b", limit: 4, now: new Date("2026-07-22T00:00:00Z") })).length, 1);
    const failed = await failPeRiverBackfillMonth(db, { exchange: "TWSE", symbol: "2330.TW", targetMonth: claimed[0].targetMonth, owner: "runner-a", error: new Error("HTTP 429"), attempt: 1, now: new Date("2026-07-22T00:00:00Z") });
    assert.equal(failed.status, "retry_waiting");
    assert.equal(failed.reasonCode, "rate_limit_waiting");
    assert.ok(failed.retryAfter > "2026-07-22T00:00:00Z");
  } finally { db.close(); }
});

test("本機 Worker API smoke 涵蓋 .TW、.TWO、ETF、partial 與 available", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("pe-river-test", `${Date.now()}-${Math.random()}`);
  const worker = (await import(workerUrl.href)).default;
  const db = new SqliteD1();
  const env = { DB: db, ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
  const context = { waitUntil() {}, passThroughOnException() {} };
  try {
    await worker.fetch(new Request("http://localhost/api/health"), env, context);
    const deniedIngest = await worker.fetch(new Request("https://example.com/api/internal/taiwan-stock-pe-river", { method: "POST", headers: { authorization: "Bearer test-secret", "content-type": "application/json" }, body: JSON.stringify({ symbol: "2330.TW", month: "2026-01", rows: [] }) }), { ...env, PE_RIVER_INGEST_SECRET: "test-secret" }, context);
    assert.equal(deniedIngest.status, 401);
    assert.equal((await deniedIngest.text()).includes("test-secret"), false);
    const deniedControl = await worker.fetch(new Request("https://example.com/api/internal/pe-river-continuous-backfill", { method: "POST", headers: { authorization: "Bearer control-secret", "content-type": "application/json" }, body: JSON.stringify({ action: "start", runId: "test-run", trigger: "workflow_dispatch" }) }), { ...env, PE_RIVER_BACKFILL_SECRET: "control-secret" }, context);
    assert.equal(deniedControl.status, 401);
    const licenseBlocked = await worker.fetch(new Request("https://example.com/api/internal/pe-river-continuous-backfill", { method: "POST", headers: { authorization: "Bearer control-secret", "OAI-Sites-Authorization": "Bearer sites-bypass", "content-type": "application/json" }, body: JSON.stringify({ action: "start", runId: "test-run", trigger: "workflow_dispatch" }) }), { ...env, PE_RIVER_BACKFILL_SECRET: "control-secret", PE_RIVER_ACCESS_MODE: "public" }, context);
    assert.equal(licenseBlocked.status, 412);
    assert.equal((await licenseBlocked.json()).reasonCode, "license_review_required");
    const controlStarted = await worker.fetch(new Request("https://example.com/api/internal/pe-river-continuous-backfill", { method: "POST", headers: { authorization: "Bearer control-secret", "OAI-Sites-Authorization": "Bearer sites-bypass", "content-type": "application/json" }, body: JSON.stringify({ action: "start", runId: "test-run", trigger: "workflow_dispatch" }) }), { ...env, PE_RIVER_BACKFILL_SECRET: "control-secret", PE_RIVER_ACCESS_MODE: "custom" }, context);
    assert.equal(controlStarted.status, 200);
    assert.deepEqual((await controlStarted.json()).order, ["latest", "history"]);
    const authorizedIngest = await worker.fetch(new Request("https://example.com/api/internal/taiwan-stock-pe-river", { method: "POST", headers: { authorization: "Bearer test-secret", "OAI-Sites-Authorization": "Bearer sites-bypass", "content-type": "application/json" }, body: JSON.stringify({ symbol: "6488.TWO", month: "2026-01", rows: [{ sessionDate: "2026-01-02", officialClose: 405.5, officialPeRatio: 19.42 }] }) }), { ...env, PE_RIVER_INGEST_SECRET: "test-secret" }, context);
    assert.equal(authorizedIngest.status, 200);
    const cloudflareHeaderIngest = await worker.fetch(new Request("https://example.com/api/internal/taiwan-stock-pe-river", { method: "POST", headers: { "x-multichart-pipeline-authorization": "Bearer test-secret", "OAI-Sites-Authorization": "Bearer sites-bypass", "content-type": "application/json" }, body: JSON.stringify({ symbol: "6488.TWO", month: "2026-01", rows: [{ sessionDate: "2026-01-03", officialClose: 406, officialPeRatio: 19.5 }] }) }), { ...env, PE_RIVER_INGEST_SECRET: "test-secret" }, context);
    assert.equal(cloudflareHeaderIngest.status, 200);
    const blocked = await (await worker.fetch(new Request("http://localhost/api/taiwan-stock-pe-river?symbol=6488.TWO&interval=1d"), env, context)).json();
    assert.equal(blocked.eligibility.supported, true);
    assert.equal(blocked.status, "insufficient_history");
    assert.equal(blocked.backfill.reasonCode, "running");
    assert.equal(blocked.backfill.status, "queued");

    const etf = await (await worker.fetch(new Request("http://localhost/api/taiwan-stock-pe-river?symbol=0050.TW&interval=1d"), env, context)).json();
    assert.equal(etf.status, "not_eligible");
    assert.equal(etf.points.length, 0);

    const weekly = await (await worker.fetch(new Request("http://localhost/api/taiwan-stock-pe-river?symbol=2330.TW&interval=1wk"), env, context)).json();
    assert.equal(weekly.status, "unsupported_interval");

    const rows = Array.from({ length: 252 }, (_, index) => {
      const date = new Date(Date.UTC(2025, 0, 1 + index));
      const officialPeRatio = 12 + index / 50;
      return { exchange: "TWSE", symbol: "2330.TW", sessionDate: date.toISOString().slice(0, 10), officialClose: officialPeRatio * 10, officialPeRatio, referenceEps: 10, fiscalYear: "2024", fiscalQuarter: "3", source: "twse", sourceDate: date.toISOString().slice(0, 10), fetchedAt: "2026-07-22T00:00:00Z" };
    });
    await upsertPeRiverRows(db, rows);
    const available = await (await worker.fetch(new Request("http://localhost/api/taiwan-stock-pe-river?symbol=2330.TW&interval=1d"), env, context)).json();
    assert.equal(available.status, "available");
    assert.equal(available.coverage.validSamples, 252);
    assert.equal(available.points.length, 252);
    assert.equal("peer" in available, false);
    assert.equal("industry" in available, false);
    await upsertPeRiverRows(db, [{ ...rows.at(-1), sessionDate: "2026-07-22", officialClose: 2400, officialPeRatio: 32.27, referenceEps: 2400 / 32.27, source: "finmind", provider: "finmind", validationStatus: "finmind_provisional_latest", fiscalYear: null, fiscalQuarter: null, sourceDate: "2026-07-22" }]);
    const provisional = await (await worker.fetch(new Request("http://localhost/api/taiwan-stock-pe-river?symbol=2330.TW&interval=1d"), env, context)).json();
    assert.equal(provisional.coverage.verifiedEnd, rows.at(-1).sessionDate);
    assert.equal(provisional.coverage.displayEnd, "2026-07-22");
    assert.deepEqual(provisional.provisional.dates, ["2026-07-22"]);
    assert.equal(provisional.points.at(-1).validationStatus, "finmind_provisional_latest");
    assert.equal(provisional.warnings.some((warning) => warning.includes("FinMind 暫代")), true);
  } finally { db.close(); }
});

test("frontend contract 預設不請求、latest-wins、SVG 標籤、右鍵詳細說明與 PNG clone", async () => {
  const html = await readFile(new URL("../public/static/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/static/app.js", import.meta.url), "utf8");
  const overlay = await readFile(new URL("../public/static/pe-river-overlay.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/static/styles.css", import.meta.url), "utf8");
  const exporter = await readFile(new URL("../public/static/panel-image-export.js", import.meta.url), "utf8");
  assert.match(html, /value="peRiver" \/> 本益比河流圖/);
  assert.doesNotMatch(html, /value="peRiver" checked/);
  assert.doesNotMatch(html, /data-readout-row="peRiver"/);
  assert.match(app, /input\.value === "peRiver"/);
  assert.match(app, /本益比河流圖詳細說明/);
  assert.match(app, /panelPeRiverDetailsAction\.setAttribute\("aria-expanded", String\(expanded\)\)/);
  assert.match(app, /peRiverController\?\.getDetailLines\?\.\(\)/);
  assert.match(app, /function closePanelContextMenu\(\)[\s\S]*panelPeRiverDetails\.replaceChildren\(\)/);
  assert.match(overlay, /\/api\/taiwan-stock-pe-river\?symbol=/);
  assert.match(overlay, /panelLoadToken !== getLoadToken\(\)/);
  assert.match(overlay, /abortController\?\.abort\(\)/);
  assert.match(overlay, /layer\.replaceChildren\(\)/);
  assert.match(overlay, /FinMind 暫代本益比/);
  assert.match(overlay, /暫定參考 EPS/);
  assert.match(overlay, /p5.*p20.*p35.*p50.*p65.*p80.*p95/);
  assert.match(overlay, /七條界線與六個歷史百分位區帶/);
  assert.match(overlay, /stroke-dasharray/);
  assert.match(overlay, /finmind_provisional_latest/);
  assert.match(overlay, /data-pe-river-level/);
  assert.match(overlay, /stroke: COLORS\[index\]/);
  assert.match(overlay, /getDetailLines\(\) \{ return \[\.\.\.detailLines\]; \}/);
  assert.match(css, /\.pe-river-layer[\s\S]*pointer-events:\s*none/);
  assert.match(css, /\.panel-context-menu-pe-river-details\[hidden\][\s\S]*display:\s*none/);
  assert.doesNotMatch(overlay, /同業|產業本益比|目標價|投資建議語意/);
  assert.match(exporter, /source\.cloneNode\(false\)/);
  assert.match(exporter, /for \(const child of source\.childNodes\)/);

  const window = {};
  vm.runInNewContext(overlay, { window, document: {}, Date, Math, Number, Object, String, Array, Set, Map, fetch: async () => ({ json: async () => ({}) }), AbortController, console });
  assert.equal(window.QuoteChartPeRiver.eligibleCandidate("2330.TW", "1d").supported, true);
  assert.equal(window.QuoteChartPeRiver.eligibleCandidate("0050.TW", "1d").supported, false);
  assert.equal(window.QuoteChartPeRiver.splitSegments([{ sessionDate: "2026-01-02", candleIndex: 0 }, { sessionDate: "2026-01-05", candleIndex: 1 }]).length, 1);
  assert.equal(window.QuoteChartPeRiver.splitSegments([{ sessionDate: "2026-01-02", candleIndex: 0 }, { sessionDate: "2026-01-06", candleIndex: 2 }]).length, 0);
  assert.equal(window.QuoteChartPeRiver.__test.lineLabelText("p5", 10.01), "—P5 10.01x—");
  const placedLabels = window.QuoteChartPeRiver.__test.placeLineLabels([{ key: "p5", y: 100 }, { key: "p20", y: 104 }, { key: "p35", y: 108 }], 200);
  assert.equal(placedLabels.every((entry, index) => index === 0 || entry.centerY - placedLabels[index - 1].centerY >= 18), true);
  assert.equal(placedLabels.every((entry) => entry.centerY >= 10 && entry.centerY <= 190), true);
  assert.match(window.QuoteChartPeRiver.__test.safeStatusText({ status: "available", coverage: { validSamples: 252, verifiedEnd: "2026-07-21", displayEnd: "2026-07-22" }, provisional: { dates: ["2026-07-22"] } }), /FinMind 暫代至 2026-07-22/);
});
