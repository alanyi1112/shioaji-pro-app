import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { LOCALIZED_INSTRUMENT_SEED, normalizeSearchText, normalizeSymbol, validateLocalizedSeed } from "../worker/instrument-catalog.ts";
import { inferTaiwanMarketPhase, inferUnitedStatesMarketPhase } from "../worker/market-phase.ts";

const root = new URL("../", import.meta.url);
const indexHtml = await readFile(new URL("../public/static/index.html", import.meta.url), "utf8");
const stockSetup = await readFile(new URL("../public/data/stock_setup.md", import.meta.url), "utf8");

async function worker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

function environment() {
  return {
    ASSETS: {
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        if (path === "/static/index.html") return new Response(indexHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
        if (path === "/data/stock_setup.md") return new Response(stockSetup, { headers: { "content-type": "text/markdown; charset=utf-8" } });
        return new Response("Not found", { status: 404 });
      },
    },
  };
}

const context = { waitUntil() {}, passThroughOnException() {} };

function twseMiIndexFixture({ date = "20260709", fields = ["證券代號", "收盤價"], rows = [] } = {}) {
  return {
    stat: "OK",
    date,
    tables: [
      { title: "市場統計", fields: ["指數", "收盤價"], data: [["發行量加權股價指數", "100.00"]] },
      { title: "每日收盤行情", fields, data: rows },
    ],
  };
}

class FakeStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() {
    if (this.sql.includes("FROM tpex_market_mirror")) return this.db.mirrors.get(this.args[0]) || null;
    if (this.sql.includes("FROM candle_cache")) return this.db.candles.get(this.args[0]) || null;
    if (this.sql.includes("FROM tdcc_shareholder_backfill_job") && this.sql.includes("WHERE job_id")) return this.db.backfillJobs.get(this.args[0]) || null;
    if (this.sql.includes("FROM tdcc_shareholder_backfill_job")) return [...this.db.backfillJobs.values()].at(-1) || null;
    if (this.sql.includes("COUNT(DISTINCT data_date)")) return { coverage_start: null, coverage_end: null, saved_weeks: 0, last_success_at: null };
    if (this.sql.includes("COUNT(*) AS rows FROM tdcc_continuous_symbols")) return { rows: this.db.continuousSymbols.size };
    if (this.sql.includes("FROM tdcc_continuous_symbols") && this.sql.includes("WHERE symbol=?")) return this.db.continuousSymbols.get(this.args[0]) || null;
    if (this.sql.includes("FROM user_instruments") && this.sql.includes("WHERE user_id = ? AND symbol = ? AND enabled = 1")) {
      return [...this.db.userInstruments.values()].find((item) => item.user_id === this.args[0] && item.symbol === this.args[1] && item.enabled) || null;
    }
    if (this.sql.includes("FROM user_instruments") && this.sql.includes("item_id")) {
      if (this.sql.includes("symbol = ?")) return this.db.userInstruments.get(`${this.args[0]}|${this.args[1]}|${this.args[2]}`) || null;
      return [...this.db.userInstruments.values()].find((item) => item.user_id === this.args[0] && item.item_id === this.args[1]) || null;
    }
    return null;
  }
  async all() {
    if (this.sql.includes("PRAGMA table_info(user_instruments)")) {
      return { results: ["item_id", "added_at", "date_status", "date_source", "recommender"].map((name) => ({ name })) };
    }
    if (this.sql.includes("FROM instrument_catalog") && this.db.catalogReadGate) await this.db.catalogReadGate;
    if (this.sql.includes("FROM instrument_catalog") && this.sql.includes("GROUP BY source")) {
      const grouped = new Map();
      for (const item of this.db.catalog.values()) {
        if (!item.active) continue;
        const current = grouped.get(item.source) || { source: item.source, rows: 0, source_updated_at: "" };
        current.rows += 1;
        if (item.source_updated_at > current.source_updated_at) current.source_updated_at = item.source_updated_at;
        grouped.set(item.source, current);
      }
      return { results: [...grouped.values()].sort((a, b) => a.source.localeCompare(b.source)) };
    }
    if (this.sql.includes("FROM instrument_catalog")) return { results: [...this.db.catalog.values()].filter((item) => item.active) };
    if (this.sql.includes("FROM user_instruments")) {
      return { results: [...this.db.userInstruments.values()]
        .filter((item) => this.sql.includes("WHERE enabled=1") ? item.enabled : item.user_id === this.args[0])
        .sort((a, b) => (a.sort_order ?? 999999) - (b.sort_order ?? 999999) || a.symbol.localeCompare(b.symbol)) };
    }
    if (this.sql.includes("FROM user_tabs")) return { results: [...this.db.userTabs.values()].filter((item) => item.user_id === this.args[0]) };
    if (this.sql.includes("FROM taiwan_stock_chip_fetch_state") && this.sql.includes("WHERE symbol=?")) {
      const requested = new Set(this.args.slice(1));
      return { results: [...this.db.chipStates.values()].filter((item) => item.symbol === this.args[0] && requested.has(item.dataset)) };
    }
    return { results: [] };
  }
  async run() {
    if (this.sql.startsWith("INSERT INTO tpex_market_mirror")) {
      this.db.mirrors.set(this.args[0], { payload: this.args[1], source_fetched_at: this.args[2] });
    } else if (this.sql.startsWith("DELETE FROM tpex_market_mirror")) {
      for (const key of this.db.mirrors.keys()) if (key < this.args[0]) this.db.mirrors.delete(key);
    } else if (this.sql.startsWith("INSERT INTO candle_cache")) {
      this.db.candles.set(this.args[0], { payload: this.args[1], expires_at: this.args[2] });
    } else if (this.sql.startsWith("INSERT INTO instrument_catalog")) {
      const [symbol, exchange, localized_name, english_name, aliases_json, normalized_search, market, group_name, quote_type, provider, source, active, source_updated_at] = this.args;
      this.db.catalog.set(`${symbol}|${exchange}`, { symbol, exchange, localized_name, english_name, aliases_json, normalized_search, market, group_name, quote_type, provider, source, active, source_updated_at });
    } else if (this.sql.startsWith("INSERT INTO user_instruments")) {
      const hasMetadata = this.sql.includes("(user_id,item_id,symbol");
      const [user_id, item_id, symbol, name, provider, tab_id, tab_label, group_name, market, enabled, sort_order, added_at, date_status, date_source, recommender] = hasMetadata
        ? this.args
        : [this.args[0], null, ...this.args.slice(1), null, "legacy_unknown", null, ""];
      const key = `${user_id}|${symbol}|${tab_id}`;
      const current = this.db.userInstruments.get(key);
      if (current && this.sql.includes("DO UPDATE SET sort_order=excluded.sort_order")) this.db.userInstruments.set(key, { ...current, sort_order });
      else this.db.userInstruments.set(key, { user_id, item_id, symbol, name, provider, tab_id, tab_label, group_name, market, enabled, sort_order, added_at, date_status, date_source, recommender });
    } else if (this.sql.startsWith("UPDATE user_instruments SET item_id")) {
      for (const [key, item] of this.db.userInstruments) {
        if (!item.item_id) this.db.userInstruments.set(key, { ...item, item_id: `legacy-${key}` });
      }
    } else if (this.sql.startsWith("UPDATE user_instruments SET name=")) {
      const hasRecommender = this.sql.includes("recommender=?");
      const [name, provider, tab_label, group_name, market, enabled, sort_order] = this.args;
      const recommender = hasRecommender ? this.args[7] : undefined;
      const offset = hasRecommender ? 8 : 7;
      const [user_id, symbol, tab_id] = this.args.slice(offset);
      const key = `${user_id}|${symbol}|${tab_id}`;
      const current = this.db.userInstruments.get(key);
      if (current) this.db.userInstruments.set(key, { ...current, name, provider, tab_label, group_name, market, enabled, sort_order, ...(hasRecommender ? { recommender } : {}) });
    } else if (this.sql.startsWith("UPDATE user_instruments SET recommender")) {
      const [recommender, userId, itemId] = this.args;
      for (const [key, item] of this.db.userInstruments) {
        if (item.user_id === userId && item.item_id === itemId) this.db.userInstruments.set(key, { ...item, recommender });
      }
    } else if (this.sql.startsWith("DELETE FROM user_instruments")) {
      const [userId, symbol, tabId] = this.args;
      for (const [key, item] of this.db.userInstruments) {
        if (item.user_id !== userId || (symbol && item.symbol !== symbol)) continue;
        if (this.sql.includes("tab_id IN") && ![tabId, ""].includes(item.tab_id)) continue;
        if (this.sql.includes("tab_id = ?") && item.tab_id !== tabId) continue;
        this.db.userInstruments.delete(key);
      }
    } else if (this.sql.startsWith("DELETE FROM instrument_catalog")) {
      const [source, sourceUpdatedAt] = this.args;
      for (const [key, item] of this.db.catalog) if (item.source === source && item.source_updated_at !== sourceUpdatedAt) this.db.catalog.delete(key);
    } else if (this.sql.startsWith("INSERT INTO tdcc_shareholder_backfill_job")) {
      const [job_id, mode, target_start, target_end, expected_dates_json, target_symbols_json, expected_symbols, expected_weeks] = this.args;
      this.db.backfillJobs.set(job_id, { job_id, mode, target_start, target_end, expected_dates_json, target_symbols_json, expected_symbols, expected_weeks, completed_weeks: 0, failed_weeks: 0, checkpoint_date: null, status: "queued", last_error_code: null, last_success_at: null, updated_at: "2026-07-16T00:00:00Z" });
    } else if (this.sql.startsWith("INSERT INTO tdcc_continuous_symbols")) {
      if (this.sql.includes("'catalog-baseline'")) {
        const [symbol, catalogRevision, firstSeenAt, lastSeenAt] = this.args;
        this.db.continuousSymbols.set(symbol, { ...(this.db.continuousSymbols.get(symbol) || {}), symbol, source: "catalog-baseline", official_baseline: 1, catalog_revision: catalogRevision, active: 0, status: "observed", first_seen_at: firstSeenAt, last_seen_at: lastSeenAt });
        return { success: true };
      }
      if (this.sql.includes("'official-new-listing'")) {
        const [symbol, catalogRevision, firstSeenAt, lastSeenAt] = this.args;
        this.db.continuousSymbols.set(symbol, { ...(this.db.continuousSymbols.get(symbol) || {}), symbol, source: "official-new-listing", official_baseline: 0, catalog_revision: catalogRevision, active: 1, status: "queued", first_seen_at: firstSeenAt, last_seen_at: lastSeenAt });
        return { success: true };
      }
      const [symbol, source, catalogRevision, active, status, targetStart, targetEnd, expectedWeeks, completedWeeks, checkpoint, latestSnapshotDate, historySuccessAt, firstSeenAt, lastSeenAt] = this.args;
      const current = this.db.continuousSymbols.get(symbol) || {};
      this.db.continuousSymbols.set(symbol, { ...current, symbol, source: source || "catalog-baseline", catalog_revision: catalogRevision || current.catalog_revision || "", active, status, target_start: targetStart || current.target_start || null, target_end: targetEnd || current.target_end || null, expected_weeks: Math.max(Number(current.expected_weeks || 0), Number(expectedWeeks || 0)), completed_weeks: Math.max(Number(current.completed_weeks || 0), Number(completedWeeks || 0)), failed_weeks: Number(current.failed_weeks || 0), missing_dates_json: current.missing_dates_json || "[]", checkpoint_date: checkpoint || current.checkpoint_date || null, latest_snapshot_date: latestSnapshotDate || current.latest_snapshot_date || null, history_success_at: historySuccessAt || current.history_success_at || null, first_seen_at: current.first_seen_at || firstSeenAt, last_seen_at: lastSeenAt });
    } else if (this.sql.startsWith("UPDATE tdcc_continuous_symbols SET status='queued'")) {
      const [lastSeenAt, symbol] = this.args;
      const current = this.db.continuousSymbols.get(symbol);
      if (current && current.active && !["blocked", "running", "queued"].includes(current.status)) this.db.continuousSymbols.set(symbol, { ...current, status: "queued", last_error_code: null, next_retry_at: null, lease_owner: null, lease_expires_at: null, last_seen_at: lastSeenAt });
    }
    return { success: true };
  }
}

class FakeD1 {
  constructor() { this.mirrors = new Map(); this.candles = new Map(); this.catalog = new Map(); this.userTabs = new Map(); this.userInstruments = new Map(); this.backfillJobs = new Map(); this.continuousSymbols = new Map(); this.chipStates = new Map(); this.batchCalls = []; this.preparedSql = []; this.catalogReadGate = null; }
  prepare(sql) { this.preparedSql.push(sql); return new FakeStatement(this, sql); }
  async batch(statements) { this.batchCalls.push(statements.map((statement) => statement.sql)); return Promise.all(statements.map((statement) => statement.run())); }
}

class FlakySchemaD1 extends FakeD1 {
  constructor() { super(); this.schemaAttempts = 0; }
  async batch(statements) {
    if (statements.some((statement) => statement.sql.includes("CREATE TABLE IF NOT EXISTS user_tabs"))) {
      this.schemaAttempts += 1;
      if (this.schemaAttempts === 1) throw new Error("temporary schema failure");
    }
    return super.batch(statements);
  }
}

test("Sites Worker 提供報價線圖首頁", async () => {
  const response = await (await worker()).fetch(new Request("http://localhost/"), environment(), context);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /報價線圖 multiview/);
  assert.match(html, /id="chart-grid"/);
  assert.match(html, /chart-count/);
  assert.doesNotMatch(html, /supabase-js/);
});

test("health 宣告本機 MultiView runtime", async () => {
  const response = await (await worker()).fetch(new Request("http://localhost/api/health"), environment(), context);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.runtime, "local-worker");
  assert.equal(payload.maxCharts, 8);
  assert.deepEqual(Object.keys(payload.taiwanStockChip.datasets), ["institutional-flow", "foreign-holding", "margin-short", "securities-lending", "shareholder-distribution"]);
  assert.deepEqual(payload.taiwanStockChip.datasets["margin-short"].providers, ["finmind", "twse", "tpex"]);
  assert.deepEqual(payload.taiwanStockChip.datasets["shareholder-distribution"].coverage, { start: null, end: null });
  assert.equal(payload.taiwanStockChip.finMindTokenConfigured, false);
  assert.equal(payload.taiwanStockChip.immediateWorkflowDispatchConfigured, false);
  assert.equal(payload.taiwanStockChip.backgroundOrchestrator.runtime, "sites-worker");
  assert.equal(JSON.stringify(payload).includes("FINMIND_API_TOKEN"), false);
});

test("continuous backfill control plane fail closed 且不公開秘密", async () => {
  const db = new FakeD1();
  const env = { ...environment(), DB: db, TDCC_CONTINUOUS_BACKFILL_SECRET: "test-only-secret" };
  const denied = await (await worker()).fetch(new Request("http://localhost/api/internal/tdcc-continuous-backfill"), env, context);
  assert.equal(denied.status, 401);
  const allowed = await (await worker()).fetch(new Request("http://localhost/api/internal/tdcc-continuous-backfill", { headers: { authorization: "Bearer test-only-secret" } }), env, context);
  assert.equal(allowed.status, 200);
  const payload = await allowed.json();
  assert.equal(payload.historyAutomationEnabled, false);
  assert.equal(JSON.stringify(payload).includes("test-only-secret"), false);
  assert.equal(payload.contract.scheduleUtc, "30 14 * * 6,0");
  assert.equal(payload.contract.checkFrequency, "weekly-with-next-day-retry");
  assert.deepEqual(payload.orchestrator.contract.scopes, ["combined", "daily", "tdcc-weekly"]);
  assert.equal(payload.contract.scheduler, "sites-worker-orchestrator");
  const claim = await (await worker()).fetch(new Request("http://localhost/api/internal/tdcc-continuous-backfill", {
    method: "POST",
    headers: { authorization: "Bearer test-only-secret", "content-type": "application/json" },
    body: JSON.stringify({ action: "claim", runId: "test-run", owner: "test-run", limit: 1 }),
  }), env, context);
  assert.equal(claim.status, 400);
  assert.equal((await claim.json()).error, "history_automation_not_permitted");
});

test("新增台股 ETF 會冪等加入 continuous target，不需修改 workflow", async () => {
  const db = new FakeD1();
  const env = { ...environment(), DB: db };
  const request = () => new Request("http://localhost/api/instruments", {
    method: "POST",
    headers: { "content-type": "application/json", "oai-authenticated-user-email": "holder@example.com" },
    body: JSON.stringify({ symbol: "006208.TW", name: "富邦台50", provider: "yfinance", tab: "台股", group: "ETF", market: "台灣股市", enabled: true }),
  });
  assert.equal((await (await worker()).fetch(request(), env, context)).status, 200);
  assert.equal((await (await worker()).fetch(request(), env, context)).status, 200);
  assert.equal(db.continuousSymbols.has("006208.TW"), true);
  assert.equal([...db.continuousSymbols.keys()].filter((symbol) => symbol === "006208.TW").length, 1);
});

test("不在內建與官方目錄的新清單台股仍以已儲存 metadata 啟動共享籌碼回補", async (t) => {
  const service = await worker();
  const db = new FakeD1();
  const background = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ msg: "test provider unavailable" }), { status: 429, headers: { "content-type": "application/json" } });
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await service.fetch(new Request("https://site.example/api/instruments", {
    method: "POST",
    headers: { "content-type": "application/json", "oai-authenticated-user-email": "member@example.com" },
    body: JSON.stringify({ symbol: "8046.TW", name: "南電", provider: "yfinance", tabId: "new-list", tab: "新增清單", group: "上市股票", market: "台灣股市", enabled: true }),
  }), { ...environment(), DB: db }, { waitUntil(promise) { background.push(promise); }, passThroughOnException() {} });

  assert.equal(response.status, 200);
  assert.equal(background.length, 1);
  await Promise.all(background);
  assert.equal(db.continuousSymbols.has("8046.TW"), true);
  assert.equal(db.continuousSymbols.get("8046.TW").source, "user");
});

test("登入使用者可要求單一商品安全回補，日資料走 waitUntil、TDCC 只排入 queue", async () => {
  const service = await worker();
  const denied = await service.fetch(new Request("https://site.example/api/taiwan-stock-chip/backfill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: "2330.TW", datasets: ["institutional-flow"], start: "2026-07-01", end: "2026-07-19" }) }), { ...environment(), DB: new FakeD1() }, context);
  assert.equal(denied.status, 401);

  const invalid = await service.fetch(new Request("http://localhost/api/taiwan-stock-chip/backfill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: "2330.TW", datasets: ["unknown"], start: "2026-07-01", end: "2026-07-19" }) }), { ...environment(), DB: new FakeD1() }, context);
  assert.equal(invalid.status, 400);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ msg: "rate limited" }), { status: 429, headers: { "content-type": "application/json" } });
  try {
    const db = new FakeD1();
    const background = [];
    const execution = { waitUntil(promise) { background.push(promise); }, passThroughOnException() {} };
    const accepted = await service.fetch(new Request("https://site.example/api/taiwan-stock-chip/backfill", { method: "POST", headers: { "content-type": "application/json", "oai-authenticated-user-email": "holder@example.com" }, body: JSON.stringify({ symbol: "2330.TW", datasets: ["institutional-flow"], start: "2026-07-01", end: "2026-07-19" }) }), { ...environment(), DB: db }, execution);
    const acceptedPayload = await accepted.json();
    assert.equal(accepted.status, 202);
    assert.equal(acceptedPayload.status, "accepted");
    assert.deepEqual(acceptedPayload.daily.accepted, ["institutional-flow"]);
    assert.equal(background.length, 1);
    await Promise.all(background);

    const tdcc = await service.fetch(new Request("https://site.example/api/taiwan-stock-chip/backfill", { method: "POST", headers: { "content-type": "application/json", "oai-authenticated-user-email": "holder@example.com" }, body: JSON.stringify({ symbol: "2330.TW", datasets: ["shareholder-distribution"], start: "2026-07-01", end: "2026-07-19" }) }), { ...environment(), DB: db }, execution);
    const tdccPayload = await tdcc.json();
    assert.equal(tdcc.status, 202);
    assert.equal(tdccPayload.status, "queued");
    assert.equal(tdccPayload.tdcc.backfill.status, "queued");
    assert.equal(db.continuousSymbols.get("2330.TW").status, "queued");
    assert.equal(JSON.stringify(tdccPayload).includes("holder@example.com"), false);

    db.continuousSymbols.set("2330.TW", {
      ...db.continuousSymbols.get("2330.TW"),
      status: "completed",
      target_start: "2026-07-09",
      target_end: "2026-07-17",
      expected_weeks: 2,
      completed_weeks: 2,
      missing_dates_json: "[]",
    });
    const shortHistory = await service.fetch(new Request("https://site.example/api/taiwan-stock-chip/backfill", { method: "POST", headers: { "content-type": "application/json", "oai-authenticated-user-email": "holder@example.com" }, body: JSON.stringify({ symbol: "2330.TW", datasets: ["shareholder-distribution"], start: "2025-07-19", end: "2026-07-19" }) }), { ...environment(), DB: db }, execution);
    const shortHistoryPayload = await shortHistory.json();
    assert.equal(shortHistory.status, 202);
    assert.equal(shortHistoryPayload.status, "queued");
    assert.equal(shortHistoryPayload.message, "TDCC 已排入背景回補；立即啟動服務尚未設定。");
    assert.equal(shortHistoryPayload.dispatch.status, "unavailable");
    assert.equal(db.continuousSymbols.get("2330.TW").status, "queued");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TDCC 立即回補以伺服器秘密 dispatch 固定 workflow，response 不外洩秘密", async (t) => {
  const service = await worker();
  const db = new FakeD1();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const response = await service.fetch(new Request("https://site.example/api/taiwan-stock-chip/backfill", {
    method: "POST",
    headers: { "content-type": "application/json", "oai-authenticated-user-email": "holder@example.com" },
    body: JSON.stringify({ symbol: "2330.TW", datasets: ["shareholder-distribution"], start: "2025-07-19", end: "2026-07-19" }),
  }), { ...environment(), DB: db, GITHUB_WORKFLOW_DISPATCH_TOKEN: "test-only-dispatch-token" }, context);
  const payload = await response.json();
  assert.equal(response.status, 202);
  assert.equal(payload.status, "started");
  assert.equal(payload.dispatch.status, "started");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /alanyi1112\/MultiChartOnCodexSite\/actions\/workflows\/tdcc-continuous-backfill\.yml\/dispatches$/);
  assert.equal(JSON.stringify(payload).includes("test-only-dispatch-token"), false);
  assert.equal(JSON.stringify(payload).includes("holder@example.com"), false);
});

test("日資料完整、retry-after 與 cooldown 不建立重複背景工作", async () => {
  const service = await worker();
  const now = new Date();
  const future = new Date(now.getTime() + 10 * 60000).toISOString();
  const db = new FakeD1();
  db.chipStates.set("2330.TW|institutional-flow", { symbol: "2330.TW", dataset: "institutional-flow", status: "unavailable", coverage_start: null, coverage_end: null, last_success_at: null, last_attempt_at: new Date(now.getTime() - 120000).toISOString(), retry_after: future });
  const background = [];
  const response = await service.fetch(new Request("http://localhost/api/taiwan-stock-chip/backfill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: "2330.TW", datasets: ["institutional-flow"], start: "2026-07-01", end: "2026-07-19" }) }), { ...environment(), DB: db }, { waitUntil(promise) { background.push(promise); } });
  const payload = await response.json();
  assert.equal(payload.status, "retry-waiting");
  assert.deepEqual(payload.daily.retryWaiting, ["institutional-flow"]);
  assert.equal(background.length, 0);
});

test("儲存商品先回應，完整 target reconciliation 不在 foreground", async () => {
  const service = await worker();
  const db = new FakeD1();
  db.catalogReadGate = new Promise(() => {});
  const background = [];
  const response = await service.fetch(new Request("http://localhost/api/instruments", {
    method: "POST",
    headers: { "content-type": "application/json", "oai-authenticated-user-email": "speed@example.com" },
    body: JSON.stringify({ symbol: "2324.TW", name: "仁寶", provider: "yfinance", tabId: "money", tab: "錢線百分百", group: "上市股票", market: "台灣股市", enabled: true, defaultOrder: 15 }),
  }), { ...environment(), DB: db }, { waitUntil(promise) { background.push(promise); }, passThroughOnException() {} });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.instruments.some((item) => item.symbol === "2324.TW" && item.tabId === "money" && item.name === "仁寶"), true);
  assert.equal(db.userInstruments.has("speed@example.com|2324.TW|money"), true);
  assert.equal(background.length, 1);
  assert.equal(await Promise.race([background[0].then(() => "settled"), new Promise((resolve) => setTimeout(() => resolve("pending"), 5))]), "pending");
  assert.equal(db.preparedSql.some((sql) => sql.includes("UPDATE tdcc_continuous_symbols SET active=0")), false);
  assert.equal(db.preparedSql.some((sql) => sql.includes("COUNT(*) AS rows FROM tdcc_continuous_symbols")), false);
});

test("清單 metadata 保存台北加入日期、推薦人並以 owner 隔離", async () => {
  const service = await worker();
  const db = new FakeD1();
  const env = { ...environment(), DB: db };
  const save = async (email, recommender = "王小明") => {
    const response = await service.fetch(new Request("https://site.example/api/instruments", {
      method: "POST",
      headers: { "content-type": "application/json", "oai-authenticated-user-email": email },
      body: JSON.stringify({ symbol: "9999.TW", name: "測試台股", tabId: "my-list", tab: "我的清單", group: "上市股票", market: "台灣股市", recommender }),
    }), env, context);
    return { response, payload: await response.json() };
  };
  const first = await save("alice@example.com");
  assert.equal(first.response.status, 200);
  const item = first.payload.instruments.find((candidate) => candidate.symbol === "9999.TW" && candidate.tabId === "my-list");
  assert.match(item.itemId, /^[0-9a-f-]{36}$/);
  assert.match(item.addedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(item.dateStatus, "known");
  assert.equal(item.dateSource, "server");
  assert.equal(item.recommender, "王小明");

  const denied = await service.fetch(new Request(`https://site.example/api/watchlist-items/${item.itemId}/metadata`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "oai-authenticated-user-email": "bob@example.com" },
    body: JSON.stringify({ recommender: "不應寫入" }),
  }), env, context);
  assert.equal(denied.status, 404);
  assert.equal(JSON.stringify(await denied.json()).includes("9999.TW"), false);

  const updated = await service.fetch(new Request(`https://site.example/api/watchlist-items/${item.itemId}/metadata`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "oai-authenticated-user-email": "alice@example.com" },
    body: JSON.stringify({ recommender: " 李老師 " }),
  }), env, context);
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).instruments.find((candidate) => candidate.itemId === item.itemId).recommender, "李老師");

  const invalid = await save("charlie@example.com", "甲".repeat(81));
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.payload.ok, false);
});

test("相同 D1 binding 共用 schema initialization，失敗後可重試", async () => {
  const service = await worker();
  const db = new FakeD1();
  const env = { ...environment(), DB: db };
  const [first, second] = await Promise.all([
    service.fetch(new Request("http://localhost/api/instruments"), env, context),
    service.fetch(new Request("http://localhost/api/instruments"), env, context),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await service.fetch(new Request("http://localhost/api/instruments"), env, context)).status, 200);
  assert.equal(db.batchCalls.filter((batch) => batch.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS user_tabs"))).length, 1);

  const retryService = await worker();
  const flaky = new FlakySchemaD1();
  const flakyEnv = { ...environment(), DB: flaky };
  await assert.rejects(() => retryService.fetch(new Request("http://localhost/api/instruments"), flakyEnv, context), /temporary schema failure/);
  assert.equal((await retryService.fetch(new Request("http://localhost/api/instruments"), flakyEnv, context)).status, 200);
  assert.equal(flaky.schemaAttempts, 2);
});

test("商品設定保留四個市場且只開放日／週／月 K", async () => {
  const response = await (await worker()).fetch(new Request("http://localhost/api/instruments"), environment(), context);
  const payload = await response.json();
  assert.ok(payload.instruments.length >= 70);
  assert.deepEqual(payload.marketTabs.map((tab) => tab.label), ["台股", "美股", "匯率債券", "期貨期指"]);
  assert.deepEqual(payload.intervals, ["1d", "1wk", "1mo"]);
});

test("刪除系統頁籤商品後不會從預設清單復活，且不影響其他頁籤", async () => {
  const service = await worker();
  const db = new FakeD1();
  db.userInstruments.set("local-sites-user|2330.TW|my-tab", {
    user_id: "local-sites-user", symbol: "2330.TW", name: "台積電自選", provider: "yfinance",
    tab_id: "my-tab", tab_label: "自選", group_name: "個股", market: "台灣股市", enabled: 1, sort_order: 1,
  });
  const env = { ...environment(), DB: db };

  const response = await service.fetch(new Request("http://localhost/api/instruments/2330.TW?tabId=taiwan-stocks&tabLabel=%E5%8F%B0%E8%82%A1&scope=system", { method: "DELETE" }), env, context);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.instruments.some((item) => item.symbol === "2330.TW" && !item.tabId), false);
  assert.equal(payload.instruments.some((item) => item.symbol === "2330.TW" && item.tabId === "my-tab"), true);
  assert.equal(db.userInstruments.get("local-sites-user|2330.TW|")?.enabled, 0);

  const reloaded = await service.fetch(new Request("http://localhost/api/instruments"), env, context);
  const reloadedPayload = await reloaded.json();
  assert.equal(reloadedPayload.instruments.some((item) => item.symbol === "2330.TW" && !item.tabId), false);
  assert.equal(reloadedPayload.instruments.some((item) => item.symbol === "2330.TW" && item.tabId === "my-tab"), true);
});

test("前端刪除商品會傳送目前頁籤範圍", async () => {
  const appScript = await readFile(new URL("../public/static/app.js", import.meta.url), "utf8");
  assert.match(appScript, /deleteManagedInstrument\(symbol, tab\)/);
  assert.match(appScript, /scope: reorderScopeForTab\(tab\)/);
  assert.match(appScript, /tabId: tab\?\.id \|\| ""/);
});

test("主圖估算融資成本與清單 metadata UI 保留偏好、缺值及無績效邊界", async () => {
  const appScript = await readFile(new URL("../public/static/app.js", import.meta.url), "utf8");
  assert.match(indexHtml, /value="estimatedMarginCost" \/> 估算融資成本/);
  assert.match(indexHtml, /data-readout-row="estimatedMarginCost"/);
  assert.match(appScript, /quoteChart\.estimatedMarginCost\.v1:/);
  assert.match(appScript, /state\.activeMarketTabId/);
  assert.match(appScript, /estimatedMarginAbortController\?\.abort\(\)/);
  assert.match(indexHtml, /chip-panes\.js\?v=20260807-inline-ticket-toolbar-v1/);
  assert.match(indexHtml, /chart-payload\.js\?v=20260805-crosshair-alignment-v1[\s\S]*app\.js\?v=20260807-inline-ticket-toolbar-v1/);
  assert.match(appScript, /requestData\?\.\(\{[\s\S]*datasets: \["margin-short"\]/);
  assert.match(appScript, /加入日期未知/);
  assert.match(indexHtml, /id="watchlist-symbol-recommender"[^>]*maxlength="80"/);
  assert.match(appScript, /recommenderInput\.addEventListener\("blur"/);
  assert.match(appScript, /recommenderInput\.dataset\.savedValue/);
  assert.match(appScript, /\/api\/watchlist-items\/\$\{encodeURIComponent\(item\.itemId\)\}\/metadata/);
  assert.doesNotMatch(indexHtml, /績效追蹤|投資報酬|報酬率|理論上下限/);
  assert.doesNotMatch(appScript, /performance|績效追蹤|投資報酬|報酬率|理論上下限/);
});

test("個人頁籤排序以單次 batch 保存 revision，且不改寫非排序欄位", async () => {
  const service = await worker();
  const db = new FakeD1();
  db.userTabs.set("local-sites-user|my-tab", { user_id: "local-sites-user", id: "my-tab", label: "自選", sort_order: 1, enabled: 1, is_default: 1, source_tab_id: "" });
  db.userInstruments.set("local-sites-user|AAA|my-tab", { user_id: "local-sites-user", symbol: "AAA", name: "原始甲", provider: "sample", tab_id: "my-tab", tab_label: "自選", group_name: "原始分類", market: "原始市場", enabled: 1, sort_order: 1 });
  db.userInstruments.set("local-sites-user|BBB|my-tab", { user_id: "local-sites-user", symbol: "BBB", name: "原始乙", provider: "hyperliquid", tab_id: "my-tab", tab_label: "自選", group_name: "原始分類", market: "原始市場", enabled: 1, sort_order: 2 });
  const env = { ...environment(), DB: db };
  const response = await service.fetch(new Request("http://localhost/api/instruments/reorder", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tabId: "my-tab", tabLabel: "自選", scope: "personal", revision: 7, items: [{ symbol: "BBB", tabId: "my-tab" }, { symbol: "AAA", tabId: "my-tab" }] }),
  }), env, context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, tabId: "my-tab", tabLabel: "自選", scope: "personal", revision: 7, order: ["BBB", "AAA"] });
  assert.equal(db.batchCalls.filter((sql) => sql.every((statement) => statement.startsWith("INSERT INTO user_instruments"))).at(-1).length, 2);
  assert.deepEqual({ ...db.userInstruments.get("local-sites-user|AAA|my-tab") }, { user_id: "local-sites-user", item_id: "legacy-local-sites-user|AAA|my-tab", symbol: "AAA", name: "原始甲", provider: "sample", tab_id: "my-tab", tab_label: "自選", group_name: "原始分類", market: "原始市場", enabled: 1, sort_order: 2 });
  const reloaded = await service.fetch(new Request("http://localhost/api/instruments"), env, context);
  const payload = await reloaded.json();
  assert.deepEqual(payload.marketTabs.find((tab) => tab.id === "my-tab").defaultSymbols, ["BBB", "AAA"]);
});

test("系統頁籤排序保存為個人 override，並全批拒絕重複、跨頁籤與未知項目", async () => {
  const service = await worker();
  const db = new FakeD1();
  const env = { ...environment(), DB: db };
  const initial = await (await service.fetch(new Request("http://localhost/api/instruments"), env, context)).json();
  const taiwan = initial.marketTabs.find((tab) => tab.id === "taiwan-stocks").defaultSymbols;
  const order = [taiwan[1], taiwan[0], ...taiwan.slice(2)];
  const request = (body) => service.fetch(new Request("http://localhost/api/instruments/reorder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), env, context);
  const response = await request({ tabId: "taiwan-stocks", tabLabel: "台股", scope: "system", revision: 11, items: order.map((symbol) => ({ symbol, tabId: "" })) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).order, order);
  assert.equal(db.userInstruments.get(`local-sites-user|${order[0]}|`)?.sort_order, 1);

  const before = [...db.userInstruments.values()].map((item) => ({ ...item }));
  assert.equal((await request({ tabId: "taiwan-stocks", tabLabel: "台股", scope: "system", revision: 12, items: [{ symbol: order[0], tabId: "" }, { symbol: order[0], tabId: "" }] })).status, 400);
  assert.equal((await request({ tabId: "taiwan-stocks", tabLabel: "台股", scope: "system", revision: 13, items: order.map((symbol) => ({ symbol, tabId: "other" })) })).status, 400);
  assert.equal((await request({ tabId: "taiwan-stocks", tabLabel: "台股", scope: "system", revision: 14, items: [...order.slice(0, -1).map((symbol) => ({ symbol, tabId: "" })), { symbol: "UNKNOWN", tabId: "" }] })).status, 409);
  assert.deepEqual([...db.userInstruments.values()].map((item) => ({ ...item })), before);
});

test("同一 symbol 在個人與系統頁籤的排序彼此隔離", async () => {
  const service = await worker();
  const db = new FakeD1();
  db.userTabs.set("local-sites-user|my-tab", { user_id: "local-sites-user", id: "my-tab", label: "重疊清單", sort_order: 1, enabled: 1, is_default: 1, source_tab_id: "" });
  for (const [index, symbol] of ["2330.TW", "2317.TW"].entries()) db.userInstruments.set(`local-sites-user|${symbol}|my-tab`, { user_id: "local-sites-user", symbol, name: `個人 ${symbol}`, provider: "sample", tab_id: "my-tab", tab_label: "重疊清單", group_name: "個人", market: "台灣股市", enabled: 1, sort_order: index + 1 });
  const env = { ...environment(), DB: db };
  const initial = await (await service.fetch(new Request("http://localhost/api/instruments"), env, context)).json();
  const originalSystemOrder = initial.marketTabs.find((tab) => tab.id === "taiwan-stocks").defaultSymbols;
  const response = await service.fetch(new Request("http://localhost/api/instruments/reorder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tabId: "my-tab", tabLabel: "重疊清單", scope: "personal", revision: 2, items: [{ symbol: "2317.TW", tabId: "my-tab" }, { symbol: "2330.TW", tabId: "my-tab" }] }) }), env, context);
  assert.equal(response.status, 200);
  const reloaded = await (await service.fetch(new Request("http://localhost/api/instruments"), env, context)).json();
  assert.deepEqual(reloaded.marketTabs.find((tab) => tab.id === "my-tab").defaultSymbols, ["2317.TW", "2330.TW"]);
  assert.deepEqual(reloaded.marketTabs.find((tab) => tab.id === "taiwan-stocks").defaultSymbols, originalSystemOrder);
});

test("前端排序協調器、拖曳把手與 K 線原地同步 contract 完整", async () => {
  const [appScript, styles] = await Promise.all([
    readFile(new URL("../public/static/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/static/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(appScript, /WATCHLIST_REORDER_DEBOUNCE_MS = 250/);
  assert.match(appScript, /watchlistReorderControllers: new Map\(\)/);
  assert.doesNotMatch(appScript, /watchlistReorderPendingKey/);
  assert.match(appScript, /controller\.inFlight \|\| !controller\.dirty/);
  assert.match(appScript, /controller\.revision === revision/);
  assert.match(appScript, /restoreManagedInstrumentOrder\(controller\.confirmed, controller\.tab\)/);
  assert.match(appScript, /flushWatchlistReorder\(previousTab\)/);
  assert.match(appScript, /flushWatchlistReorder\(tab\)/);
  assert.match(appScript, /watchlist-drag-handle/);
  assert.match(appScript, /setPointerCapture/);
  assert.match(appScript, /pointercancel/);
  assert.match(appScript, /window\.addEventListener\("pointerup", drag\.onUp, true\)/);
  assert.match(appScript, /window\.addEventListener\("pointercancel", drag\.onCancel, true\)/);
  assert.match(appScript, /window\.removeEventListener\("pointerup", drag\.onUp, true\)/);
  assert.match(appScript, /event\.pointerType === "mouse" && \(event\.buttons & 1\) === 0/);
  assert.match(appScript, /window\.addEventListener\("blur", drag\.onBlur\)/);
  assert.match(appScript, /document\.addEventListener\("visibilitychange", drag\.onVisibilityChange\)/);
  assert.match(appScript, /WATCHLIST_DRAG_MAX_SCROLL_PX/);
  assert.match(appScript, /event\.key !== "Escape"/);
  assert.match(appScript, /applyOrderedSymbol\(defaultSymbolForPanel\(index\)\)/);
  assert.match(appScript, /if \(changed\) panel\.load\(\)/);
  assert.match(styles, /touch-action: none/);
  assert.match(styles, /\.watchlist-drop-indicator/);
  assert.match(styles, /cursor: grabbing/);
});

test("頁籤管理改用 canonical 拖曳排序與明確隱藏恢復 contract", async () => {
  const [appScript, styles] = await Promise.all([
    readFile(new URL("../public/static/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/static/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(indexHtml, /id="watchlist-visible-tabs-title">顯示中的頁籤/);
  assert.match(indexHtml, /id="watchlist-hidden-tabs-title">已隱藏頁籤（0）/);
  assert.match(indexHtml, /id="watchlist-hidden-tab-list"/);
  assert.match(indexHtml, /id="watchlist-tab-reset"[^>]*>恢復系統預設/);
  assert.doesNotMatch(indexHtml, /id="watchlist-tab-order"/);
  assert.doesNotMatch(indexHtml, /id="watchlist-tab-enabled"/);

  assert.match(appScript, /managedTabs: \[\]/);
  assert.match(appScript, /state\.managedTabs = payload\.managedTabs \|\| payload\.marketTabs/);
  assert.match(appScript, /const tabs = state\.managedTabs\.length \? state\.managedTabs : state\.marketTabs/);
  assert.doesNotMatch(appScript, /\[\.\.\.visibleTabs, \.\.\.hiddenPersonalTabs\]/);
  assert.match(appScript, /WATCHLIST_TAB_REORDER_DEBOUNCE_MS = 250/);
  assert.match(appScript, /watchlistTabReorderController: undefined/);
  assert.match(appScript, /orderedTabKeys: draft\.map\(\(tab\) => tabIdentity\(tab\)\)/);
  assert.match(appScript, /payload\.acceptedRevision !== revision/);
  assert.match(appScript, /controller\.revision === revision && !controller\.dirty/);
  assert.match(appScript, /preserveTabDraft/);
  assert.match(appScript, /settleWatchlistTabReorder\(\)/);

  assert.match(appScript, /watchlist-tab-drag-handle/);
  assert.doesNotMatch(appScript, /上移頁籤|下移頁籤/);
  assert.match(appScript, /function managedTabVisibilityIcon\(action\)/);
  assert.match(appScript, /document\.createElementNS\(namespace, "svg"\)/);
  assert.match(appScript, /svg\.setAttribute\("stroke", "currentColor"\)/);
  assert.match(appScript, /svg\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(appScript, /managedTabVisibilityControl\("hide", `隱藏頁籤/);
  assert.match(appScript, /managedTabVisibilityControl\("show", `取消隱藏頁籤/);
  assert.match(appScript, /handleManagedTabDragHandleKeydown\(event, tabKey\)/);
  assert.match(appScript, /event\.key === "ArrowUp" \? -1 : event\.key === "ArrowDown" \? 1 : 0/);
  assert.match(appScript, /window\.requestAnimationFrame\(\(\) => focusManagedTabDragHandle\(tabKey\)\)/);
  assert.match(appScript, /startWatchlistTabDrag/);
  assert.match(appScript, /window\.addEventListener\("pointerup", drag\.onUp, true\)/);
  assert.match(appScript, /window\.addEventListener\("pointercancel", drag\.onCancel, true\)/);
  assert.match(appScript, /window\.addEventListener\("blur", drag\.onBlur\)/);
  assert.match(appScript, /document\.addEventListener\("visibilitychange", drag\.onVisibilityChange\)/);
  assert.match(appScript, /cancelWatchlistTabDrag/);
  assert.match(appScript, /watchlistTabDragFrame/);

  assert.match(appScript, /fetchWithPausedPanelStreams\("\/api\/tabs\/reorder"/);
  assert.match(appScript, /fetchWithPausedPanelStreams\("\/api\/tabs\/visibility"/);
  assert.match(appScript, /async function fetchWithPausedPanelStreams/);
  assert.match(appScript, /enabled \? "已取消隱藏並移到最後，可再拖曳調整。"/);
  assert.match(appScript, /visibleTabs\.length <= 1/);
  assert.match(appScript, /applyHiddenActiveTabFallback/);
  assert.match(appScript, /previousVisible\[index \+ 1\], previousVisible\[index - 1\]/);
  assert.match(appScript, /function resetWatchlistManagerViewport\(\)/);
  assert.match(appScript, /shell\.scrollTop = 0/);
  assert.match(appScript, /manager\.scrollTop = 0/);
  assert.match(appScript, /hiddenDetails\.open = state\.managedTabs\.some\(\(tab\) => tab\.enabled === false\)/);
  assert.match(appScript, /fetchWithPausedPanelStreams\("\/api\/tabs\/reset"/);
  assert.match(appScript, /tab\.source !== "personal"/);

  assert.match(styles, /\.watchlist-tab-row\.is-dragging/);
  assert.match(styles, /\.watchlist-tab-drop-indicator/);
  assert.match(styles, /\.watchlist-hidden-tab-row/);
  assert.match(styles, /grid-template-columns: 28px minmax\(0, 1fr\) 30px/);
  assert.match(styles, /\.watchlist-tab-control svg\s*\{[^}]*width: 18px;[^}]*height: 18px;/s);
  assert.match(styles, /\.watchlist-tab-drag-handle:focus-visible/);
  assert.match(styles, /touch-action: none/);
  assert.match(styles, /@media \(max-width: 620px\)/);
});

test("商品目錄 migration 與 runtime schema 保持既有 D1 資料表相容", async () => {
  const [migration, chipMigration, backfillMigration, backfillTargetMigration, workerSource] = await Promise.all([
    readFile(new URL("../drizzle/0002_fat_susan_delgado.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0003_mute_sprite.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0004_neat_hex.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0005_safe_ken_ellis.sql", import.meta.url), "utf8"),
    readFile(new URL("../worker/app.ts", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /CREATE TABLE `instrument_catalog`/);
  assert.match(migration, /PRIMARY KEY\(`symbol`, `exchange`\)/);
  assert.match(migration, /instrument_catalog_symbol_idx/);
  assert.match(workerSource, /CREATE TABLE IF NOT EXISTS user_instruments/);
  assert.match(workerSource, /CREATE TABLE IF NOT EXISTS tpex_market_mirror/);
  assert.match(workerSource, /CREATE TABLE IF NOT EXISTS instrument_catalog/);
  for (const table of ["taiwan_stock_chip_daily", "taiwan_stock_shareholder_distribution", "taiwan_stock_chip_fetch_state"]) {
    assert.match(chipMigration, new RegExp("CREATE TABLE `" + table + "`"));
    assert.match(workerSource, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  for (const table of ["tdcc_shareholder_backfill_job", "tdcc_shareholder_backfill_week"]) {
    assert.match(backfillMigration, new RegExp("CREATE TABLE `" + table + "`"));
    assert.match(workerSource, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.doesNotMatch(chipMigration, /DROP TABLE|ALTER TABLE|DELETE FROM/);
  assert.doesNotMatch(backfillMigration, /DROP TABLE|ALTER TABLE|DELETE FROM/);
  assert.match(backfillTargetMigration, /ADD `target_symbols_json`/);
  assert.match(backfillTargetMigration, /ADD `expected_symbols`/);
  assert.doesNotMatch(backfillTargetMigration, /DROP TABLE|DELETE FROM/);
});

test("舊 D1 runtime 升級新增籌碼表且保留既有資料", async () => {
  const service = await worker();
  const db = new FakeD1();
  db.candles.set("existing", { payload: "{}", expires_at: 1 });
  db.userInstruments.set("local-sites-user|2330.TW|my-tab", { user_id: "local-sites-user", symbol: "2330.TW", name: "台積電", provider: "yfinance", tab_id: "my-tab", tab_label: "自選", group_name: "個股", market: "台灣股市", enabled: 1, sort_order: 1 });
  const response = await service.fetch(new Request("http://localhost/api/instruments"), { ...environment(), DB: db }, context);
  assert.equal(response.status, 200);
  const schemaSql = db.batchCalls.flat();
  assert.ok(schemaSql.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS taiwan_stock_chip_daily")));
  assert.ok(schemaSql.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS taiwan_stock_shareholder_distribution")));
  assert.ok(schemaSql.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS taiwan_stock_chip_fetch_state")));
  assert.ok(schemaSql.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS tdcc_shareholder_backfill_job")));
  assert.ok(schemaSql.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS tdcc_shareholder_backfill_week")));
  assert.ok(db.candles.has("existing"));
  assert.ok(db.userInstruments.has("local-sites-user|2330.TW|my-tab"));
});

test("海外繁中 seed 完整涵蓋目前非台股商品且無重複", () => {
  const symbols = stockSetup.split("\n")
    .filter((line) => line.startsWith("|") && !line.includes("---") && !line.includes("頁籤 |"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim())[3])
    .filter((symbol) => symbol && !/\.TW(O)?$/.test(symbol));
  const validation = validateLocalizedSeed(symbols);
  assert.deepEqual(validation, { duplicates: [], missingSymbols: [], invalid: [] });
  assert.ok(LOCALIZED_INSTRUMENT_SEED.length >= symbols.length);
  assert.equal(normalizeSearchText(" ＮＶＤＡ． "), "nvda");
  assert.equal(normalizeSymbol(" 8069.two "), "8069.TWO");
});

test("受保護商品目錄 ingest 驗證完整台股並保留上一版", async () => {
  const service = await worker();
  const db = new FakeD1();
  const env = { ...environment(), DB: db, TPEX_MIRROR_INGEST_SECRET: "test-ingest-secret" };
  const fetchedAt = "2026-07-11T12:00:00.000Z";
  const tpexRows = Array.from({ length: 500 }, (_, index) => ({ SecuritiesCompanyCode: String(1000 + index), CompanyName: `測試上櫃${index}` }));
  tpexRows.push({ SecuritiesCompanyCode: "8069", CompanyName: "元太" });
  const tpexBody = JSON.stringify({ source: "tpex-official-openapi", fetchedAt, rows: tpexRows });
  const unauthorized = await service.fetch(new Request("http://localhost/api/internal/instrument-catalog", { method: "POST", headers: { "content-type": "application/json" }, body: tpexBody }), env, context);
  assert.equal(unauthorized.status, 401);
  const acceptedTpex = await service.fetch(new Request("http://localhost/api/internal/instrument-catalog", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-ingest-secret" }, body: tpexBody }), env, context);
  assert.equal(acceptedTpex.status, 200);
  assert.equal((await acceptedTpex.json()).rows, 501);

  const twseRows = Array.from({ length: 800 }, (_, index) => ({ Code: String(2000 + index), Name: `測試上市${index}` }));
  twseRows.push({ Code: "00919", Name: "群益台灣精選高息" });
  const twseBody = JSON.stringify({ source: "twse-official-openapi", fetchedAt, rows: twseRows });
  const acceptedTwse = await service.fetch(new Request("http://localhost/api/internal/instrument-catalog", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-ingest-secret" }, body: twseBody }), env, context);
  assert.equal(acceptedTwse.status, 200);
  assert.equal((await acceptedTwse.json()).rows, 801);

  const tpexSearch = await service.fetch(new Request("http://localhost/api/instrument-search?q=元太&limit=8"), env, context);
  const tpexCandidate = (await tpexSearch.json()).results[0];
  assert.deepEqual([tpexCandidate.symbol, tpexCandidate.name, tpexCandidate.exchange, tpexCandidate.source], ["8069.TWO", "元太", "TPEx", "taiwan-catalog"]);
  const twseSearch = await service.fetch(new Request("http://localhost/api/instrument-search?q=群益台灣&limit=8"), env, context);
  const twseCandidate = (await twseSearch.json()).results[0];
  assert.deepEqual([twseCandidate.symbol, twseCandidate.name, twseCandidate.exchange, twseCandidate.quoteType], ["00919.TW", "群益台灣精選高息", "TWSE", "ETF"]);
  const etfChip = await service.fetch(new Request("http://localhost/api/taiwan-stock-chip?symbol=00919.TW&interval=1wk&datasets=institutional-flow"), env, context);
  const etfChipPayload = await etfChip.json();
  assert.equal(etfChipPayload.eligible, true);
  assert.equal(etfChipPayload.datasetEligibility["institutional-flow"].reason, "unsupported_interval");
  const unauthorizedTdcc = await service.fetch(new Request("http://localhost/api/internal/tdcc-shareholder-distribution", { method: "POST" }), env, context);
  assert.equal(unauthorizedTdcc.status, 401);
  const unconfiguredHistory = await service.fetch(new Request("http://localhost/api/internal/tdcc-shareholder-backfill", { method: "GET" }), env, context);
  assert.equal(unconfiguredHistory.status, 503);
  const unauthorizedHistory = await service.fetch(new Request("http://localhost/api/internal/tdcc-shareholder-backfill", { method: "GET" }), { ...env, TDCC_HISTORY_INGEST_SECRET: "test-history-secret" }, context);
  assert.equal(unauthorizedHistory.status, 401);
  const targetedHistory = await service.fetch(new Request("http://localhost/api/internal/tdcc-shareholder-backfill", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-history-secret" },
    body: JSON.stringify({
      action: "start",
      source: "tdcc-official-history-query",
      jobId: "tdcc-local-test",
      expectedDates: ["2026-07-03", "2026-07-09"],
      targetSymbols: ["2330.TW", "00919.TW"],
    }),
  }), { ...env, TDCC_HISTORY_INGEST_SECRET: "test-history-secret" }, context);
  assert.equal(targetedHistory.status, 200);
  const targetedPayload = await targetedHistory.json();
  assert.equal(targetedPayload.backfill.mode, "local-operator-query");
  assert.equal(targetedPayload.backfill.targetSymbolCount, 2);
  const incompleteHistoryRows = await service.fetch(new Request("http://localhost/api/internal/tdcc-shareholder-backfill", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-history-secret" },
    body: JSON.stringify({
      action: "ingest-week",
      source: "tdcc-official-history-export",
      jobId: "tdcc-one-year",
      dataDate: "2026-07-09",
      fetchedAt,
      rows: Array.from({ length: 34 }, () => ({})),
    }),
  }), { ...env, TDCC_HISTORY_INGEST_SECRET: "test-history-secret" }, context);
  assert.equal(incompleteHistoryRows.status, 400);

  const invalidRows = [...tpexRows];
  invalidRows[0] = { SecuritiesCompanyCode: "1000", CompanyName: "" };
  const rejected = await service.fetch(new Request("http://localhost/api/internal/instrument-catalog", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-ingest-secret" }, body: JSON.stringify({ source: "tpex-official-openapi", fetchedAt: "2026-07-11T13:00:00.000Z", rows: invalidRows }) }), env, context);
  assert.equal(rejected.status, 400);
  assert.ok(db.catalog.has("8069.TWO|TPEx"));
  assert.equal(db.mirrors.size, 0);
  assert.equal(db.candles.size, 0);
});

test("繁中與模糊商品搜尋回傳中文主名稱及穩定候選 contract", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "query1.finance.yahoo.com") {
      const query = url.searchParams.get("q");
      return Response.json({ quotes: query?.toLowerCase().includes("nvda") ? [{ symbol: "NVDA", longname: "NVIDIA Corporation", exchange: "NMS", quoteType: "EQUITY" }] : [] });
    }
    if (["openapi.twse.com.tw", "www.tpex.org.tw"].includes(url.hostname)) return Response.json([]);
    throw new Error(`unexpected upstream ${url}`);
  };
  try {
    const service = await worker();
    const env = { ...environment(), DB: new FakeD1() };
    const expectations = {
      "輝達": ["NVDA", "輝達"],
      "蘋果": ["AAPL", "蘋果公司"],
      "蘋果公": ["AAPL", "蘋果公司"],
      "日經": ["^N225", "日經 225 指數"],
      "布蘭特原油": ["BZ=F", "布蘭特原油期貨"],
      "那斯達克": ["^IXIC", "那斯達克綜合指數"],
      "美元日圓": ["JPY=X", "美元兌日圓"],
      "nvda": ["NVDA", "輝達"],
    };
    for (const [query, [symbol, localizedName]] of Object.entries(expectations)) {
      const response = await service.fetch(new Request(`http://localhost/api/instrument-search?q=${encodeURIComponent(query)}&limit=8`), env, context);
      const payload = await response.json();
      assert.equal(payload.results[0].symbol, symbol, query);
      assert.equal(payload.results[0].name, localizedName, query);
      assert.equal(payload.results[0].localizedName, localizedName, query);
      for (const key of ["provider", "source", "market", "exchange", "group", "quoteType", "matchedBy", "score"]) assert.ok(key in payload.results[0], `${query}:${key}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("台股目錄會以繁中 enrich Yahoo 並保留獨立來源 warnings", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "openapi.twse.com.tw") throw new Error("TWSE unavailable");
    if (url.hostname === "www.tpex.org.tw") return Response.json([{ SecuritiesCompanyCode: "8069", CompanyName: "元太" }]);
    if (url.hostname === "query1.finance.yahoo.com") throw new Error("Yahoo unavailable");
    throw new Error(`unexpected upstream ${url}`);
  };
  try {
    const response = await (await worker()).fetch(new Request("http://localhost/api/instrument-search?q=8069&limit=8"), environment(), context);
    const payload = await response.json();
    assert.equal(payload.results[0].symbol, "8069.TWO");
    assert.equal(payload.results[0].name, "元太");
    assert.deepEqual(payload.warnings.map((item) => item.source), ["twse", "yahoo-search"]);
    assert.match(payload.warning, /TWSE/);
    assert.match(payload.warning, /外部商品搜尋/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("商品搜尋 UI 顯示繁中主名稱與英文輔助名稱並保留明確儲存", async () => {
  const [appScript, styles] = await Promise.all([
    readFile(new URL("../public/static/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/static/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(indexHtml, /placeholder="輸入中文股名、商品別名或代號"/);
  assert.match(appScript, /suggestion\.localizedName \|\| suggestion\.name/);
  assert.match(appScript, /watchlist-search-english/);
  assert.match(appScript, /suggestion\.symbol, suggestion\.exchange, suggestion\.quoteType/);
  assert.match(appScript, /選一個候選項目填入下方表單（\$\{payload\.warning\}）/);
  assert.match(appScript, /已填入，確認後再按儲存商品/);
  assert.doesNotMatch(appScript.slice(appScript.indexOf("function selectInstrumentSuggestion"), appScript.indexOf("function updateInstrumentSearchStatus")), /savePersonalInstrument\(/);
  assert.match(styles, /\.watchlist-search-name/);
  assert.match(styles, /\.watchlist-search-english/);
  assert.match(styles, /\.watchlist-search-symbol/);
});

test("sample K 線包含全部指標 contract", async () => {
  const response = await (await worker()).fetch(new Request("http://localhost/api/candles?symbol=SAMPLE&interval=1d"), environment(), context);
  const payload = await response.json();
  assert.equal(payload.candles.length, 160);
  for (const key of ["moving_average", "volume_moving_average", "rsi", "kd", "macd", "bollinger", "atr", "fvg", "volume_profile", "poc", "vah", "val"]) assert.ok(key in payload.indicators, key);
  assert.equal(payload.indicators.volume_moving_average.ma5.length, payload.candles.length);
  assert.equal(payload.indicators.volume_moving_average.ma10.length, payload.candles.length);
  assert.equal(payload.indicators.volume_moving_average.ma20.length, payload.candles.length);
  assert.equal(payload.dataWindow.displayCandles, 160);
  assert.equal(payload.quote.kind, "intraday");
  assert.equal(payload.quote.verification.status, "unverified");
  assert.equal(payload.quote.verification.reason, "unsupported_quote_kind");
});

test("Pivot Point 預設 lazy，合法模式回傳 selected projection contract 並隔離 cache", async () => {
  const service = await worker();
  const db = new FakeD1();
  const env = { ...environment(), DB: db };
  const offResponse = await service.fetch(new Request("http://localhost/api/candles?symbol=SAMPLE&interval=1d&display_count=20"), env, context);
  const off = await offResponse.json();
  assert.equal(offResponse.status, 200);
  assert.equal("pivot_points" in off.indicators, false);

  const invalidResponse = await service.fetch(new Request("http://localhost/api/candles?symbol=SAMPLE&interval=1d&display_count=20&pivot=fibonacci"), env, context);
  const invalid = await invalidResponse.json();
  assert.equal("pivot_points" in invalid.indicators, false);

  const onResponse = await service.fetch(new Request("http://localhost/api/candles?symbol=SAMPLE&interval=1d&display_count=20&pivot=traditional"), env, context);
  const on = await onResponse.json();
  assert.equal(onResponse.status, 200);
  assert.equal(on.indicators.pivot_points.type, "traditional");
  assert.equal(on.indicators.pivot_points.contractVersion, "selected-next-period-v1");
  assert.equal(on.indicators.pivot_points.referenceInterval, "1d");
  assert.equal(on.indicators.pivot_points.status, "available");
  assert.deepEqual(on.indicators.pivot_points.targets.map((target) => target.time), on.candles.map((row) => row.time));
  assert.equal(on.indicators.pivot_points.projections.length, on.candles.length);
  for (const projection of on.indicators.pivot_points.projections) {
    for (const key of ["p", "r1", "r2", "r3", "s1", "s2", "s3"]) assert.equal(Number.isFinite(projection[key]), true, key);
    assert.equal(["completed", "provisional"].includes(projection.referenceStatus), true);
    assert.equal(projection.appliesTo, "next-trading-day");
  }
  const cacheKeys = [...db.candles.keys()];
  assert.equal(cacheKeys.some((key) => key.endsWith("|pivot:off")), true);
  assert.equal(cacheKeys.some((key) => key.endsWith("|pivot:traditional")), true);
});

test("分 K 與日內 Pivot 明確停用，且不發出上游請求", async () => {
  const originalFetch = globalThis.fetch;
  let intradayCalls = 0;
  let dailyCalls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (!url.pathname.includes("/v8/finance/chart/PIVOTFAIL")) throw new Error(`unexpected ${url}`);
    if (url.searchParams.get("interval") === "1d") {
      dailyCalls += 1;
      throw new Error("daily unavailable");
    }
    intradayCalls += 1;
    const start = Math.floor(Date.parse("2026-07-01T01:00:00Z") / 1000);
    const timestamp = Array.from({ length: 300 }, (_, index) => start + index * 60);
    const close = timestamp.map((_, index) => 100 + index / 10);
    return Response.json({ chart: { result: [{
      timestamp,
      indicators: { quote: [{
        open: close.map((value) => value - 0.1),
        high: close.map((value) => value + 0.2),
        low: close.map((value) => value - 0.2),
        close,
        volume: close.map((_, index) => 1000 + index),
      }] },
      meta: { regularMarketTime: timestamp.at(-1), marketState: "REGULAR", exchangeTimezoneName: "America/New_York" },
    }] } });
  };
  try {
    const service = await worker();
    const offResponse = await service.fetch(new Request("http://localhost/api/candles?symbol=PIVOTFAIL&interval=1m&display_count=20"), environment(), context);
    const off = await offResponse.json();
    assert.equal(offResponse.status, 400, JSON.stringify({ off, intradayCalls, dailyCalls }));
    assert.equal(off.reasonCode, "unsupported_interval");
    assert.equal(dailyCalls, 0);

    const onResponse = await service.fetch(new Request("http://localhost/api/candles?symbol=PIVOTFAIL&interval=1m&display_count=20&pivot=traditional"), environment(), context);
    const on = await onResponse.json();
    assert.equal(onResponse.status, 400);
    assert.equal(on.reasonCode, "unsupported_interval");
    assert.equal(dailyCalls, 0);
    assert.equal(intradayCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Pivot Point stream 與 candles 使用相同模式及最新水準", async () => {
  const service = await worker();
  const candlesResponse = await service.fetch(new Request("http://localhost/api/candles?symbol=SAMPLE&interval=1d&pivot=traditional"), environment(), context);
  const candles = await candlesResponse.json();
  const streamResponse = await service.fetch(new Request("http://localhost/api/stream?symbol=SAMPLE&interval=1d&pivot=traditional"), environment(), context);
  const reader = streamResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event;
  while (!event) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    buffer += decoder.decode(chunk.value, { stream: true });
    for (const block of buffer.split("\n\n")) {
      const line = block.split("\n").find((item) => item.startsWith("data: "));
      if (!line) continue;
      const parsed = JSON.parse(line.slice(6));
      if (parsed.type === "candle") event = parsed;
    }
  }
  await reader.cancel();
  assert.equal(event.indicators.pivot_points.type, "traditional");
  assert.equal(event.indicators.pivot_points.contractVersion, "selected-next-period-v1");
  assert.deepEqual(event.indicators.pivot_points.projections.at(-1), candles.indicators.pivot_points.projections.at(-1));
});

test("candles 接受有界副圖參數並以參數簽章隔離 cache，stream 共用解析", async () => {
  const service = await worker();
  const response = await service.fetch(new Request("http://localhost/api/candles?symbol=SAMPLE&interval=1d&rsi_short=6&rsi_long=12&kd_period=14&kd_rsv_weight=4&kd_k_weight=5&macd_fast=8&macd_slow=21&macd_signal=5&atr_period=20"), environment(), context);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.indicators.parameters, {
    rsi: { shortPeriod: 6, longPeriod: 12 },
    kd: { period: 14, rsvWeight: 4, kWeight: 5 },
    macd: { fastPeriod: 8, slowPeriod: 21, signalPeriod: 5 },
    atr: { period: 20 },
  });
  assert.equal(payload.indicators.rsi.short.length, payload.candles.length);
  assert.equal(payload.indicators.rsi.long.length, payload.candles.length);

  const workerSource = await readFile(new URL("../worker/app.ts", import.meta.url), "utf8");
  assert.match(workerSource, /indicatorParameterSignature\(indicatorParameters\)/);
  assert.match(workerSource, /streamResponse[\s\S]*indicatorParametersFromSearchParams\(url\.searchParams\)/);
  assert.match(workerSource, /cachedCandlePayload\(env, symbol, interval, 160, indicatorParameters, pivotMode, realtimeViewerCapability\(request, env\)\)/);
});

test("週線與月線由交易所時區的日 K 聚合並使用獨立歷史 provider identity", async () => {
  const [marketSource, workerSource] = await Promise.all([
    readFile(new URL("../worker/market-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/app.ts", import.meta.url), "utf8"),
  ]);
  assert.match(marketSource, /\["1wk", "1mo"\]\.includes\(interval\) \? "1d" : interval/);
  assert.match(marketSource, /aggregateWeeklyCandles\(rows, String\(result\?\.meta\?\.exchangeTimezoneName \|\| "UTC"\)\)/);
  assert.match(marketSource, /aggregateMonthlyCandles\(rows, String\(result\?\.meta\?\.exchangeTimezoneName \|\| "UTC"\)\)/);
  assert.match(marketSource, /weekStart\.setUTCDate\(weekStart\.getUTCDate\(\) - \(\(weekStart\.getUTCDay\(\) \+ 6\) % 7\)\)/);
  assert.match(workerSource, /baseProvider === "yfinance" && interval === "1wk"[\s\S]*?"yfinance-weekly-from-daily-v1"/);
  assert.match(workerSource, /baseProvider === "yfinance" && interval === "1mo"[\s\S]*?"yfinance-monthly-from-daily-v1"/);
});

test("台股市場階段會綜合上游狀態、交易時段與來源時間保守判定", () => {
  const now = new Date("2026-07-13T02:05:00.000Z");
  const currentQuoteTime = Date.parse("2026-07-13T02:04:00.000Z") / 1000;
  const base = { sessionDate: "2026-07-13", sourceQuoteTime: currentQuoteTime, sourceTimeZone: "Asia/Taipei", hasValidCandle: true, now };
  assert.equal(inferTaiwanMarketPhase({ ...base, marketState: "REGULAR" }), "open");
  assert.equal(inferTaiwanMarketPhase({ ...base, marketState: "mystery" }), "open");
  assert.equal(inferTaiwanMarketPhase({ ...base, marketState: "CLOSED", now: new Date("2026-07-13T05:45:00.000Z") }), "closing");
  assert.equal(inferTaiwanMarketPhase({ ...base, marketState: "CLOSED", now: new Date("2026-07-13T07:30:00.000Z") }), "closed");
  assert.equal(inferTaiwanMarketPhase({ ...base, marketState: "unknown", sourceQuoteTime: Date.parse("2026-07-13T05:30:08.000Z") / 1000, now: new Date("2026-07-13T07:30:00.000Z") }), "closed");
  assert.equal(inferTaiwanMarketPhase({ ...base, marketState: "mystery", sessionDate: "2026-07-10" }), "unknown");
  assert.equal(inferTaiwanMarketPhase({ ...base, marketState: "mystery", sourceQuoteTime: null }), "unknown");
  assert.equal(inferTaiwanMarketPhase({ ...base, marketState: "mystery", sourceQuoteTime: currentQuoteTime - 61 * 60 }), "unknown");
  assert.equal(inferTaiwanMarketPhase({ ...base, marketState: "mystery", now: new Date("2026-07-12T02:05:00.000Z") }), "closed");
});

test("美股市場階段會以紐約交易時段、交易日與來源新鮮度保守判定", () => {
  const now = new Date("2026-07-21T14:06:00.000Z");
  const sourceQuoteTime = Date.parse("2026-07-21T14:05:00.000Z") / 1000;
  const base = { sessionDate: "2026-07-21", sourceQuoteTime, sourceTimeZone: "America/New_York", hasValidCandle: true, now };
  assert.equal(inferUnitedStatesMarketPhase({ ...base, marketState: "unknown" }), "open");
  assert.equal(inferUnitedStatesMarketPhase({ ...base, marketState: "REGULAR" }), "open");
  assert.equal(inferUnitedStatesMarketPhase({ ...base, marketState: "unknown", sourceQuoteTime: sourceQuoteTime - 61 * 60 }), "unknown");
  assert.equal(inferUnitedStatesMarketPhase({ ...base, marketState: "unknown", sessionDate: "2026-07-20" }), "unknown");
  assert.equal(inferUnitedStatesMarketPhase({ ...base, marketState: "unknown", sourceQuoteTime: null }), "unknown");
  assert.equal(inferUnitedStatesMarketPhase({ ...base, marketState: "POST" }), "closed");
  assert.equal(inferUnitedStatesMarketPhase({ ...base, marketState: "unknown", now: new Date("2026-07-25T14:06:00.000Z") }), "closed");
});

test("美股盤中價格列顯示紐約來源報價時間且不顯示收盤核對文字", async () => {
  const appScript = await readFile(new URL("../public/static/app.js", import.meta.url), "utf8");
  const helperBlock = appScript.slice(
    appScript.indexOf("function formatQuoteTimeParts"),
    appScript.indexOf("function nodesOverlap"),
  );
  const formatQuoteDataState = new Function(
    "timeToDate",
    "globalThis",
    `${helperBlock}\nreturn formatQuoteDataState;`,
  )((time) => new Date(Number(time) * 1000), { MultiChartQuoteDisplayState: { isTaiwanMarketClosedDay: () => false } });
  const quoteTime = Date.parse("2026-07-21T14:05:00.000Z") / 1000;
  const state = formatQuoteDataState({
    kind: "intraday",
    marketPhase: "open",
    sourceQuoteTime: quoteTime,
    sourceTimeZone: "America/New_York",
    sessionDate: "2026-07-21",
    freshness: "fresh",
    verification: { status: "not_applicable", reason: "market_open" },
  });
  assert.equal(state.full, "07/21 10:05");
  assert.equal(state.compact, "10:05");
  assert.equal(state.status, "not_applicable");
  assert.doesNotMatch(`${state.full} ${state.compact}`, /收盤|未驗證|待核對|已核對/);
});

test("美股盤中 API 不啟動收盤第二來源核對", async () => {
  const originalFetch = globalThis.fetch;
  const sourceQuoteTime = Math.floor(Date.now() / 1000);
  const upstreamCalls = { yahoo: 0, massive: 0 };
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "query1.finance.yahoo.com") {
      upstreamCalls.yahoo += 1;
      return Response.json({ chart: { result: [{
        timestamp: [sourceQuoteTime - 86400, sourceQuoteTime],
        meta: { regularMarketTime: sourceQuoteTime, marketState: "REGULAR", exchangeTimezoneName: "America/New_York" },
        indicators: { quote: [{ open: [51900, 52020], high: [52200, 52150], low: [51800, 51980], close: [52000, 52123.4], volume: [1000, 800] }] },
      }] } });
    }
    if (url.hostname === "api.massive.com") upstreamCalls.massive += 1;
    throw new Error(`unexpected verifier call ${url}`);
  };
  try {
    const response = await (await worker()).fetch(new Request("http://localhost/api/candles?symbol=%5EDJI&interval=1d&display_count=20"), environment(), context);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.quote.marketPhase, "open");
    assert.equal(payload.quote.kind, "intraday");
    assert.deepEqual(payload.quote.verification, { status: "not_applicable", provider: null, reason: "market_open" });
    assert.equal(upstreamCalls.massive, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("費半來源沒有成交量時維持原值、揭露不可用且不抓其他商品", async () => {
  const originalFetch = globalThis.fetch;
  const sourceQuoteTime = Math.floor(Date.now() / 1000);
  const yahooSymbols = [];
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname !== "query1.finance.yahoo.com") throw new Error(`unexpected upstream ${url}`);
    const symbol = decodeURIComponent(url.pathname.split("/").at(-1));
    yahooSymbols.push(symbol);
    return Response.json({ chart: { result: [{
      timestamp: [sourceQuoteTime - 86400, sourceQuoteTime],
      meta: { regularMarketTime: sourceQuoteTime, marketState: "REGULAR", exchangeTimezoneName: "America/New_York" },
      indicators: { quote: [{ open: [12000, 12100], high: [12200, 12250], low: [11900, 12050], close: [12100, 12180], volume: [0, 0] }] },
    }] } });
  };
  try {
    const response = await (await worker()).fetch(new Request("http://localhost/api/candles?symbol=%5ESOX&interval=1d&display_count=20"), environment(), context);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(yahooSymbols, ["^SOX"]);
    assert.deepEqual(payload.candles.map((row) => row.volume), [0, 0]);
    assert.equal(payload.candles.at(-1).close, 12180);
    assert.deepEqual(payload.quote.volumeAvailability, {
      status: "unavailable",
      reason: "source_not_provided",
      message: "此指數來源未提供成交量",
    });
    assert.deepEqual(payload.dataQuality.volumeAvailability, payload.quote.volumeAvailability);
    assert.equal(payload.quote.sourceProvider, "yfinance");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("費半原始來源恢復成交量時直接顯示且不再標示不可用", async () => {
  const originalFetch = globalThis.fetch;
  const sourceQuoteTime = Math.floor(Date.now() / 1000);
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    assert.equal(decodeURIComponent(url.pathname.split("/").at(-1)), "^SOX");
    return Response.json({ chart: { result: [{
      timestamp: [sourceQuoteTime - 86400, sourceQuoteTime],
      meta: { regularMarketTime: sourceQuoteTime, marketState: "REGULAR", exchangeTimezoneName: "America/New_York" },
      indicators: { quote: [{ open: [12000, 12100], high: [12200, 12250], low: [11900, 12050], close: [12100, 12180], volume: [900000, 1100000] }] },
    }] } });
  };
  try {
    const response = await (await worker()).fetch(new Request("http://localhost/api/candles?symbol=%5ESOX&interval=1d&display_count=20"), environment(), context);
    const payload = await response.json();
    assert.deepEqual(payload.candles.map((row) => row.volume), [900000, 1100000]);
    assert.equal(payload.quote.volumeAvailability, undefined);
    assert.equal(payload.dataQuality.volumeAvailability, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("週末與已知平日休市可辨識，海外商品不套用台股休市", async () => {
  const source = await readFile(new URL("../public/static/quote-display-state.js", import.meta.url), "utf8");
  const sandbox = { Intl, Date, Object };
  vm.runInNewContext(source, sandbox);
  const { isTaiwanMarketClosedDay } = sandbox.MultiChartQuoteDisplayState;
  const fridayQuote = { sourceTimeZone: "Asia/Taipei", sessionDate: "2026-07-17", marketPhase: "closed" };
  assert.equal(isTaiwanMarketClosedDay(fridayQuote, new Date("2026-07-18T00:30:00.000Z")), true);
  assert.equal(isTaiwanMarketClosedDay(fridayQuote, new Date("2026-07-19T00:30:00.000Z")), true);
  assert.equal(isTaiwanMarketClosedDay(fridayQuote, new Date("2026-07-20T02:00:00.000Z")), true);
  assert.equal(isTaiwanMarketClosedDay({ ...fridayQuote, sourceTimeZone: "America/New_York" }, new Date("2026-07-18T00:30:00.000Z")), false);
});

test("台股盤中 quote contract 不呼叫任何官方收盤來源且 candles 與 stream 一致", async () => {
  const originalFetch = globalThis.fetch;
  const upstreamCalls = { yahoo: 0, twse: 0, tpex: 0, mis: 0, massive: 0 };
  const sourceQuoteTime = Math.floor(Date.now() / 1000);
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "query1.finance.yahoo.com") {
      upstreamCalls.yahoo += 1;
      return Response.json({ chart: { result: [{
        timestamp: [sourceQuoteTime - 86400, sourceQuoteTime],
        meta: { regularMarketTime: sourceQuoteTime, marketState: "REGULAR", exchangeTimezoneName: "Asia/Taipei" },
        indicators: { quote: [{ open: [99, 100], high: [101, 102], low: [98, 99], close: [100, 101], volume: [1200, 800] }] },
      }] } });
    }
    if (["www.twse.com.tw", "openapi.twse.com.tw"].includes(url.hostname)) upstreamCalls.twse += 1;
    else if (url.hostname === "www.tpex.org.tw") upstreamCalls.tpex += 1;
    else if (url.hostname === "mis.twse.com.tw") upstreamCalls.mis += 1;
    else if (url.hostname === "api.massive.com") upstreamCalls.massive += 1;
    throw new Error(`unexpected verifier call ${url}`);
  };
  try {
    const service = await worker();
    const env = environment();
    const candleResponse = await service.fetch(new Request("http://localhost/api/candles?symbol=2330.TW&interval=1d&display_count=20"), env, context);
    assert.equal(candleResponse.status, 200);
    const payload = await candleResponse.json();
    assert.equal(payload.quote.marketPhase, "open");
    assert.equal(payload.quote.kind, "intraday");
    assert.equal(payload.quote.sourceQuoteTime, sourceQuoteTime);
    assert.equal(payload.quote.sourceTimeZone, "Asia/Taipei");
    assert.deepEqual(payload.quote.verification, { status: "not_applicable", provider: null, reason: "market_open" });
    assert.ok(["preopen", "open", "closing", "closed", "unknown"].includes(payload.quote.marketPhase));
    assert.ok(["intraday", "session-close"].includes(payload.quote.kind));
    assert.ok(["not_applicable", "pending", "verified", "unverified", "mismatch"].includes(payload.quote.verification.status));

    const streamResponse = await service.fetch(new Request("http://localhost/api/stream?symbol=2330.TW&interval=1d"), env, context);
    const reader = streamResponse.body.getReader();
    let buffer = "";
    let event;
    while (!event) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      buffer += new TextDecoder().decode(chunk.value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) if (block.startsWith("data: ")) {
        const parsed = JSON.parse(block.slice(6));
        if (parsed.type === "candle") event = parsed;
      }
    }
    await reader.cancel();
    for (const field of ["marketPhase", "kind", "sourceQuoteTime", "sourceTimeZone", "verification"]) assert.deepEqual(event.quote[field], payload.quote[field], field);
    assert.deepEqual({ ...upstreamCalls, yahoo: 0 }, { yahoo: 0, twse: 0, tpex: 0, mis: 0, massive: 0 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("台股盤中 stale cache 保留來源時間並以 freshness 優先", async () => {
  const originalFetch = globalThis.fetch;
  const db = new FakeD1();
  const sourceQuoteTime = Date.parse("2026-07-13T02:00:00.000Z") / 1000;
  const cached = {
    symbol: "2330.TW",
    interval: "1d",
    candles: [{ time: sourceQuoteTime, open: 100, high: 101, low: 99, close: 100, volume: 800 }],
    quoteTime: sourceQuoteTime,
    quote: {
      kind: "intraday", marketPhase: "open", marketSession: "regular", sessionDate: "2026-07-13",
      sourceProvider: "yfinance", sourceQuoteTime, sourceTimeZone: "Asia/Taipei", freshness: "fresh",
      verification: { status: "not_applicable", provider: null, reason: "market_open" }, dataQuality: { ignoredSessionDates: [] },
    },
    dataQuality: { ignoredSessionDates: [] }, indicators: {},
    dataWindow: { cache: { store: "d1", state: "hit", source: "yfinance" } },
  };
  db.candles.set("quote-state-v15-valid-ohlc|2330.TW|1d|20|r5.10-k9.3.3-m12.26.9-a14|pivot:off", { payload: JSON.stringify(cached), expires_at: 0 });
  globalThis.fetch = async () => { throw new Error("primary unavailable"); };
  try {
    const response = await (await worker()).fetch(new Request("http://localhost/api/candles?symbol=2330.TW&interval=1d&display_count=20"), { ...environment(), DB: db }, context);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.quote.freshness, "stale");
    assert.equal(payload.quote.sourceQuoteTime, sourceQuoteTime);
    assert.equal(payload.quote.verification.status, "not_applicable");
    assert.equal(payload.dataWindow.cache.state, "stale");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("不保留 starter 預覽標記", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.match(layout, /報價線圖 multiview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(readFile(new URL("../app/_sites-preview/SkeletonPreview.tsx", root), "utf8"));
});

test("台股官方核對會對齊交易日、重用全市場資料並保持 stream parity", async () => {
  const originalFetch = globalThis.fetch;
  const officialCalls = { twse: 0, tpex: 0 };
  const closeBySymbol = { "2330.TW": 100, "2317.TW": 50, "6146.TWO": 206, "8069.TWO": 200.5 };
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "query1.finance.yahoo.com" && url.pathname.includes("/v8/finance/chart/")) {
      const symbol = decodeURIComponent(url.pathname.split("/").pop());
      const close = closeBySymbol[symbol];
      assert.ok(close, `unexpected Yahoo symbol ${symbol}`);
      return Response.json({ chart: { result: [{
        timestamp: [1783472400, 1783558800, 1783645200],
        meta: { regularMarketTime: 1783558800, marketState: "CLOSED" },
        indicators: { quote: [{
          open: [close - 1, close, close], high: [close, close, close], low: [close - 1, close, close], close: [close - 0.5, close, close], volume: [1000, 1200, 0],
        }] },
      }] } });
    }
    if (url.hostname === "www.twse.com.tw") {
      officialCalls.twse += 1;
      assert.equal(url.searchParams.get("date"), "20260709");
      assert.equal(url.searchParams.get("type"), "ALLBUT0999");
      await new Promise((resolve) => setTimeout(resolve, 20));
      return Response.json(twseMiIndexFixture({
        fields: ["收盤價", "證券名稱", "證券代號"],
        rows: [["100.00", "台積電", "2330"], ["50.00", "鴻海", "2317"]],
      }));
    }
    if (url.hostname === "openapi.twse.com.tw") throw new Error(`unexpected TWSE OpenAPI fallback ${url}`);
    if (url.hostname === "www.tpex.org.tw") {
      officialCalls.tpex += 1;
      return new Response("unavailable", { status: 503 });
    }
    if (url.hostname === "mis.twse.com.tw") {
      const code = url.searchParams.get("ex_ch").match(/otc_(\d+)\.tw/)?.[1];
      return Response.json({ msgArray: [{ c: code, ex: "otc", d: code === "6146" ? "20260708" : "20260709", z: code === "6146" ? "206.0000" : "200.5000" }] });
    }
    throw new Error(`unexpected upstream ${url}`);
  };

  try {
    const service = await worker();
    const env = environment();
    const requestCandles = async (symbol) => {
      const response = await service.fetch(new Request(`http://localhost/api/candles?symbol=${symbol}&interval=1d&display_count=20`), env, context);
      assert.equal(response.status, 200);
      return response.json();
    };
    const [tsmc, honHai] = await Promise.all([requestCandles("2330.TW"), requestCandles("2317.TW")]);
    assert.equal(officialCalls.twse, 1);
    assert.equal(tsmc.quote.verification.status, "verified");
    assert.equal(tsmc.quote.verification.provider, "twse");
    assert.equal(tsmc.quote.verification.referenceSessionDate, "2026-07-09");
    assert.match(tsmc.quote.verification.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(honHai.quote.verification.status, "verified");
    assert.deepEqual(tsmc.dataQuality, { ignoredSessionDates: ["2026-07-10"], reason: "zero_volume_flat_carry_forward" });
    assert.deepEqual(tsmc.quote.dataQuality, tsmc.dataQuality);
    assert.equal(new Date(tsmc.candles.at(-1).time * 1000).toISOString().slice(0, 10), "2026-07-09");

    const tpex = await requestCandles("6146.TWO");
    assert.equal(tpex.quote.verification.status, "pending");
    assert.equal(tpex.quote.verification.reason, "reference_not_published");
    assert.equal(tpex.quote.verification.referenceSessionDate, "2026-07-08");
    assert.equal(tpex.quote.verification.provider, "twse-mis");
    const tpexVerified = await requestCandles("8069.TWO");
    assert.equal(tpexVerified.quote.verification.status, "verified");
    assert.equal(tpexVerified.quote.verification.provider, "twse-mis");
    assert.equal(officialCalls.tpex, 1);

    const streamResponse = await service.fetch(new Request("http://localhost/api/stream?symbol=2330.TW&interval=1d"), env, context);
    const reader = streamResponse.body.getReader();
    let buffer = "";
    let candleEvent;
    while (!candleEvent) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      buffer += new TextDecoder().decode(chunk.value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        if (!block.startsWith("data: ")) continue;
        const event = JSON.parse(block.slice(6));
        if (event.type === "candle") candleEvent = event;
      }
    }
    await reader.cancel();
    assert.equal(candleEvent.quote.verification.status, "verified");
    assert.equal(candleEvent.quote.verification.referenceSessionDate, "2026-07-09");
    assert.equal(candleEvent.source, "yfinance");
    assert.equal(officialCalls.twse, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TWSE MI_INDEX 尚未發布時維持 pending，且共用 negative cache、不啟動 fallback", async () => {
  const originalFetch = globalThis.fetch;
  const calls = { miIndex: 0, mis: 0, openapi: 0 };
  const closeBySymbol = { "2330.TW": 100, "2317.TW": 50 };
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "query1.finance.yahoo.com") {
      const symbol = decodeURIComponent(url.pathname.split("/").pop());
      const close = closeBySymbol[symbol];
      return Response.json({ chart: { result: [{
        timestamp: [1783472400, 1783558800, 1783645200],
        meta: { regularMarketTime: 1783558800, marketState: "CLOSED", exchangeTimezoneName: "Asia/Taipei" },
        indicators: { quote: [{ open: [close - 1, close, close], high: [close, close, close], low: [close - 1, close, close], close: [close - 0.5, close, close], volume: [1000, 1200, 0] }] },
      }] } });
    }
    if (url.hostname === "www.twse.com.tw") {
      calls.miIndex += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return Response.json({ stat: "很抱歉，沒有符合條件的資料!" });
    }
    if (url.hostname === "mis.twse.com.tw") calls.mis += 1;
    if (url.hostname === "openapi.twse.com.tw") calls.openapi += 1;
    throw new Error(`unexpected fallback ${url}`);
  };
  try {
    const service = await worker();
    const requestCandles = async (symbol, displayCount = 20) => {
      const response = await service.fetch(new Request(`http://localhost/api/candles?symbol=${symbol}&interval=1d&display_count=${displayCount}`), environment(), context);
      assert.equal(response.status, 200);
      return response.json();
    };
    const [tsmc, honHai] = await Promise.all([requestCandles("2330.TW"), requestCandles("2317.TW")]);
    const cachedPending = await requestCandles("2330.TW", 21);
    for (const payload of [tsmc, honHai, cachedPending]) {
      assert.equal(payload.quote.verification.status, "pending");
      assert.equal(payload.quote.verification.provider, "twse");
      assert.equal(payload.quote.verification.reason, "reference_not_published");
    }
    assert.deepEqual(calls, { miIndex: 1, mis: 0, openapi: 0 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TWSE MI_INDEX HTTP 失敗時先使用 tse MIS，不會越級呼叫 STOCK_DAY_ALL", async () => {
  const originalFetch = globalThis.fetch;
  const calls = { miIndex: 0, mis: 0, openapi: 0 };
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "query1.finance.yahoo.com") {
      return Response.json({ chart: { result: [{
        timestamp: [1783472400, 1783558800, 1783645200],
        meta: { regularMarketTime: 1783558800, marketState: "CLOSED", exchangeTimezoneName: "Asia/Taipei" },
        indicators: { quote: [{ open: [99, 100, 100], high: [100, 100, 100], low: [99, 100, 100], close: [99.5, 100, 100], volume: [1000, 1200, 0] }] },
      }] } });
    }
    if (url.hostname === "www.twse.com.tw") {
      calls.miIndex += 1;
      return new Response("unavailable", { status: 503 });
    }
    if (url.hostname === "mis.twse.com.tw") {
      calls.mis += 1;
      assert.equal(url.searchParams.get("ex_ch"), "tse_2330.tw");
      return Response.json({ msgArray: [{ c: "2330", ex: "tse", d: "20260709", z: "100.00" }] });
    }
    if (url.hostname === "openapi.twse.com.tw") calls.openapi += 1;
    throw new Error(`unexpected upstream ${url}`);
  };
  try {
    const response = await (await worker()).fetch(new Request("http://localhost/api/candles?symbol=2330.TW&interval=1d&display_count=20"), environment(), context);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.quote.verification.status, "verified");
    assert.equal(payload.quote.verification.provider, "twse-mis");
    assert.equal(payload.quote.verification.referenceSessionDate, "2026-07-09");
    assert.deepEqual(calls, { miIndex: 1, mis: 1, openapi: 0 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TWSE MI_INDEX 回傳日期不同時不得直接比較", async () => {
  const originalFetch = globalThis.fetch;
  let misCalls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "query1.finance.yahoo.com") {
      return Response.json({ chart: { result: [{
        timestamp: [1783472400, 1783558800, 1783645200],
        meta: { regularMarketTime: 1783558800, marketState: "CLOSED", exchangeTimezoneName: "Asia/Taipei" },
        indicators: { quote: [{ open: [99, 100, 100], high: [100, 100, 100], low: [99, 100, 100], close: [99.5, 100, 100], volume: [1000, 1200, 0] }] },
      }] } });
    }
    if (url.hostname === "www.twse.com.tw") {
      return Response.json(twseMiIndexFixture({ date: "20260708", rows: [["2330", "100.00"]] }));
    }
    if (url.hostname === "mis.twse.com.tw") {
      misCalls += 1;
      return Response.json({ msgArray: [{ c: "2330", ex: "tse", d: "20260709", z: "100.00" }] });
    }
    throw new Error(`unexpected upstream ${url}`);
  };
  try {
    const response = await (await worker()).fetch(new Request("http://localhost/api/candles?symbol=2330.TW&interval=1d&display_count=20"), environment(), context);
    const payload = await response.json();
    assert.equal(payload.quote.verification.status, "verified");
    assert.equal(payload.quote.verification.provider, "twse-mis");
    assert.equal(misCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TWSE MI_INDEX 格式錯誤且 MIS 失敗時，最後以 STOCK_DAY_ALL 保守核對", async () => {
  const originalFetch = globalThis.fetch;
  const calls = { miIndex: 0, mis: 0, openapi: 0 };
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "query1.finance.yahoo.com") {
      return Response.json({ chart: { result: [{
        timestamp: [1783472400, 1783558800, 1783645200],
        meta: { regularMarketTime: 1783558800, marketState: "CLOSED", exchangeTimezoneName: "Asia/Taipei" },
        indicators: { quote: [{ open: [49, 50, 50], high: [50, 50, 50], low: [49, 50, 50], close: [49.5, 50, 50], volume: [1000, 1200, 0] }] },
      }] } });
    }
    if (url.hostname === "www.twse.com.tw") {
      calls.miIndex += 1;
      return Response.json({ stat: "OK", date: "20260709", tables: "malformed" });
    }
    if (url.hostname === "mis.twse.com.tw") {
      calls.mis += 1;
      return new Response("unavailable", { status: 503 });
    }
    if (url.hostname === "openapi.twse.com.tw") {
      calls.openapi += 1;
      return Response.json([{ Date: "1150709", Code: "2317", ClosingPrice: "50.00" }]);
    }
    throw new Error(`unexpected upstream ${url}`);
  };
  try {
    const response = await (await worker()).fetch(new Request("http://localhost/api/candles?symbol=2317.TW&interval=1d&display_count=20"), environment(), context);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.quote.verification.status, "verified");
    assert.equal(payload.quote.verification.provider, "twse");
    assert.equal(payload.quote.verification.referenceSessionDate, "2026-07-09");
    assert.deepEqual(calls, { miIndex: 1, mis: 1, openapi: 1 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TWSE 無成交、空值與非有限收盤價不會誤報 mismatch", async () => {
  const originalFetch = globalThis.fetch;
  const closeBySymbol = { "2330.TW": 100, "2317.TW": 50, "2303.TW": 60, "2454.TW": 100 };
  let miIndexCalls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "query1.finance.yahoo.com") {
      const symbol = decodeURIComponent(url.pathname.split("/").pop());
      const close = closeBySymbol[symbol];
      return Response.json({ chart: { result: [{
        timestamp: [1783472400, 1783558800, 1783645200],
        meta: { regularMarketTime: 1783558800, marketState: "CLOSED", exchangeTimezoneName: "Asia/Taipei" },
        indicators: { quote: [{ open: [close - 1, close, close], high: [close, close, close], low: [close - 1, close, close], close: [close - 0.5, close, close], volume: [1000, 1200, 0] }] },
      }] } });
    }
    if (url.hostname === "www.twse.com.tw") {
      miIndexCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return Response.json(twseMiIndexFixture({
        fields: ["收盤價", "證券代號"],
        rows: [["--", "2330"], ["", "2317"], ["not-a-number", "2303"], ["99.00", "2454"]],
      }));
    }
    throw new Error(`invalid MI_INDEX rows must not trigger fallback ${url}`);
  };
  try {
    const service = await worker();
    const requestCandles = async (symbol) => {
      const response = await service.fetch(new Request(`http://localhost/api/candles?symbol=${symbol}&interval=1d&display_count=20`), environment(), context);
      assert.equal(response.status, 200);
      return response.json();
    };
    const [dash, empty, nonFinite, validMismatch] = await Promise.all(Object.keys(closeBySymbol).map(requestCandles));
    for (const payload of [dash, empty, nonFinite]) {
      assert.equal(payload.quote.verification.status, "unverified");
      assert.equal(payload.quote.verification.reason, "invalid_reference_data");
    }
    assert.equal(validMismatch.quote.verification.status, "mismatch");
    assert.equal(validMismatch.quote.verification.reason, "close_mismatch");
    assert.equal(miIndexCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("報價狀態會直接顯示已核對並套用 verified 樣式", async () => {
  const [appScript, styles] = await Promise.all([
    readFile(new URL("../public/static/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/static/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(appScript, /`\$\{base\}・已核對`/);
  assert.match(appScript, /盤中顯示主來源資料時間，收盤後才進行第二來源核對/);
  assert.match(appScript, /盤中・時間待確認/);
  assert.match(appScript, /MultiChartQuoteDisplayState\?\.isTaiwanMarketClosedDay\(value\)/);
  assert.match(appScript, /full: `\$\{base\}・休市`/);
  assert.match(appScript, /verification === "verified" \? "verified" : "closed"/);
  const quoteStateBlock = appScript.slice(appScript.indexOf("function formatQuoteDataState"), appScript.indexOf("function formatQuoteVerificationTitle"));
  assert.equal(quoteStateBlock.indexOf('freshness === "stale"') < quoteStateBlock.indexOf("if (marketClosed)"), true);
  assert.match(appScript, /sourceTimeZone/);
  assert.match(appScript, /is-quote-\$\{status\}/);
  assert.match(appScript, /"tpex-mirror": "TPEx 官方鏡像"/);
  assert.match(styles, /\.price-strip\.is-quote-verified \.quote-time-strip/);
  assert.match(styles, /\.price-strip\.is-quote-not-applicable \.quote-time-strip/);
  assert.match(styles, /\.price-strip\.is-quote-pending \.quote-time-strip/);
  assert.match(styles, /\.price-strip\.is-quote-mismatch \.quote-time-strip/);
  assert.match(styles, /\.price-strip\.is-quote-closed \.quote-time-strip/);
});

test("價格更新動畫只在盤中實際變價時觸發", async () => {
  const appScript = await readFile(new URL("../public/static/app.js", import.meta.url), "utf8");
  const helperBlock = appScript.slice(
    appScript.indexOf("function shouldAnimateLatestPriceUpdate"),
    appScript.indexOf("function latestPriceLabelForPayload"),
  );
  const shouldAnimateLatestPriceUpdate = new Function(
    "marketSessionState",
    `${helperBlock}\nreturn shouldAnimateLatestPriceUpdate;`,
  )((payload) => payload?.normalizedMarketState || "closed");

  assert.equal(shouldAnimateLatestPriceUpdate(undefined, 100, { normalizedMarketState: "open", quote: { kind: "intraday" } }), false);
  assert.equal(shouldAnimateLatestPriceUpdate(100, 100, { normalizedMarketState: "open", quote: { kind: "intraday" } }), false);
  assert.equal(shouldAnimateLatestPriceUpdate(100, 101, { normalizedMarketState: "open", quote: { kind: "intraday" } }), true);
  assert.equal(shouldAnimateLatestPriceUpdate(100, 101, { normalizedMarketState: "closed", quote: { kind: "session-close" } }), false);
  assert.equal(shouldAnimateLatestPriceUpdate(100, 101, { normalizedMarketState: "open", quote: { kind: "session-close" } }), false);
  assert.match(appScript, /updateLatestPriceState\(latestCandle\.close, candles\[candles\.length - 2\]\?\.close, payload\)/);
  assert.match(appScript, /updateLatestPriceState\(latest\.close, previous\?\.close, lastPayload\)/);
  assert.match(appScript, /if \(shouldAnimate\) triggerLatestPriceUpdate\(latestPriceState\.trend\)/);
  assert.match(appScript, /if \(retryAttempt === 0\) lastRenderedPrice = undefined/);
  assert.match(appScript, /lastRenderedPrice = undefined/);
});

test("TPEx 官方鏡像需授權寫入並可讓 .TWO 保守核對", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "query1.finance.yahoo.com") {
      return Response.json({ chart: { result: [{
        timestamp: [1783472400, 1783558800, 1783645200],
        meta: { regularMarketTime: 1783558800, marketState: "CLOSED" },
        indicators: { quote: [{ open: [199, 200.5, 200.5], high: [200, 200.5, 200.5], low: [198, 200.5, 200.5], close: [199, 200.5, 200.5], volume: [1000, 1200, 0] }] },
      }] } });
    }
    if (["www.tpex.org.tw", "mis.twse.com.tw"].includes(url.hostname)) return new Response("unavailable", { status: 503 });
    throw new Error(`unexpected upstream ${url}`);
  };
  try {
    const service = await worker();
    const env = { ...environment(), DB: new FakeD1(), TPEX_MIRROR_INGEST_SECRET: "test-ingest-secret" };
    const rows = Array.from({ length: 500 }, (_, index) => ({ Date: "1150709", SecuritiesCompanyCode: String(1000 + index), Close: "1.00" }));
    rows.push({ Date: "1150709", SecuritiesCompanyCode: "8069", Close: "200.50" });
    const body = JSON.stringify({ source: "tpex-official-openapi", fetchedAt: new Date().toISOString(), rows });
    const rejected = await service.fetch(new Request("http://localhost/api/internal/tpex-mirror", { method: "POST", headers: { "content-type": "application/json" }, body }), env, context);
    assert.equal(rejected.status, 401);
    const accepted = await service.fetch(new Request("http://localhost/api/internal/tpex-mirror", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-ingest-secret" }, body }), env, context);
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { ok: true, sessionDate: "2026-07-09", rows: 501, fetchedAt: JSON.parse(body).fetchedAt });

    const response = await service.fetch(new Request("http://localhost/api/candles?symbol=8069.TWO&interval=1d&display_count=26"), env, context);
    const payload = await response.json();
    assert.equal(payload.quote.verification.status, "verified");
    assert.equal(payload.quote.verification.provider, "tpex-mirror");
    assert.equal(payload.quote.verification.referenceSessionDate, "2026-07-09");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("主副圖支援三模式、所有圖數、十二個可排序 pane 與安全生命週期", async () => {
  const [appScript, chipScript, styles] = await Promise.all([
    readFile(new URL("../public/static/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/static/chip-panes.js", import.meta.url), "utf8"),
    readFile(new URL("../public/static/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(indexHtml, /<option value="3">3<\/option>/);
  assert.match(indexHtml, /<span>主副圖<\/span>[\s\S]*?<option value="main">主圖<\/option>[\s\S]*?<option value="single" selected>單一副圖<\/option>[\s\S]*?<option value="multi">多層副圖<\/option>/);
  assert.match(indexHtml, /<div class="volume-availability-note" role="note" hidden><\/div>/);
  assert.doesNotMatch(indexHtml, /A 單一副圖|B 多層副圖|chip-mode-note|1～3 圖可/);
  assert.match(appScript, /CHART_COUNTS = \[1, 2, 3, 4, 6, 8\]/);
  assert.match(appScript, /3: "grid-3"/);
  assert.match(appScript, /function singleSubchartOnlyChartCount\(chartCount = currentChartCount\(\)\)/);
  assert.match(appScript, /if \(singleSubchartOnlyChartCount\(\)\) return CHART_PRESENTATION_MODES\.single/);
  assert.match(appScript, /mainOption\.disabled = singleOnly/);
  assert.match(appScript, /multiOption\.disabled = multiDisabled/);
  assert.doesNotMatch(appScript, /focusedPanelIndex|togglePanelFocus|clearFocusedPanel|is-panel-focused|is-focus-hidden/);
  assert.match(appScript, /CHART_PRESENTATION_MODE_KEY = "quoteChart\.chartPresentationMode\.v1"/);
  assert.match(appScript, /readChartPresentationMode\(localStorage\)/);
  assert.match(appScript, /function isTaiwanStockSymbol\(symbol\)/);
  assert.match(appScript, /\/\\\.TW\(O\)\?\$\/\.test\(canonicalSymbol\(symbol\)\)/);
  assert.match(appScript, /function isTaiwanMultiLayerCompatibleSymbol\(symbol\)/);
  assert.match(appScript, /\["\^TWII"\]\.includes\(normalized\)/);
  assert.match(appScript, /function activeTabSupportsMultiLayerSubcharts\(\)/);
  assert.match(appScript, /if \(currentChartCount\(\) === 1 && state\.singleChartView\?\.symbol\) return isTaiwanStockSymbol\(state\.singleChartView\.symbol\)/);
  assert.match(appScript, /symbols\.length > 0 && symbols\.every\(isTaiwanMultiLayerCompatibleSymbol\)/);
  assert.match(appScript, /preferred !== CHART_PRESENTATION_MODES\.multi/);
  assert.match(appScript, /if \(symbol && !isTaiwanStockSymbol\(symbol\)\) return CHART_PRESENTATION_MODES\.single/);
  assert.match(appScript, /select\.disabled = false/);
  assert.match(appScript, /multiOption\.disabled = multiDisabled/);
  assert.match(appScript, /只有全台股頁籤或台股單一商品可使用多層副圖/);
  assert.match(appScript, /6／8 圖固定使用單一副圖/);
  assert.match(appScript, /availability\?\.reason === "source_not_provided"/);
  assert.match(appScript, /updateVolumeAvailability\(\{ quote: event\.quote \}, selectedMain\.has\("volume"\)\)/);
  assert.match(styles, /\.volume-availability-note\s*\{[^}]*bottom: 28px;[^}]*z-index: 8;[^}]*pointer-events: none;/s);
  assert.match(styles, /\.chip-mode-control select:disabled\s*\{[^}]*color: #64748b;[^}]*cursor: not-allowed;[^}]*opacity: 0\.72;/s);
  assert.match(indexHtml, /<details class="indicator-menu sub-indicator-menu">[\s\S]*?<legend><span>技術指標<\/span>[\s\S]*?<legend>籌碼資料<\/legend>[\s\S]*?<\/details>/);
  assert.doesNotMatch(indexHtml, /chip-indicator-menu|<summary>籌碼<\/summary>/);
  assert.match(indexHtml, /<div class="subchart-slot[^>]*>[\s\S]*?<div class="indicator-wrap">[\s\S]*?<div class="chip-pane-region">/);
  assert.match(indexHtml, /subchart-slot is-mode-a-technical" data-subchart-mode="A" data-mode-a-slot-kind="technical"/);
  assert.match(styles, /\.chart-grid\.grid-3\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /\.chart-grid\.grid-4\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)[^}]*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /\.chart-grid\.grid-4\.is-mode-b-page-scroll\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);[^}]*grid-template-rows:\s*auto;/s);
  assert.match(styles, /\.chart-grid\.grid-3 \.panel-toolbar,[\s\S]*?--interval-width: 46px;[\s\S]*?--menu-width: 38px;[\s\S]*?--price-width: 120px;/);
  assert.match(styles, /\.chart-grid\.grid-3 \.price-strip,[\s\S]*?grid-column: 5;[\s\S]*?width: var\(--price-width\);/);
  assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*\.chart-grid\.grid-3/);
  assert.match(styles, /\.subchart-slot\.is-mode-a-technical \.indicator-wrap,[\s\S]*\.subchart-slot\.is-mode-a-chip \.chip-pane-region/);
  assert.match(appScript, /function updatePageScrollLayout\(\)/);
  assert.match(appScript, /document\.body\.classList\.toggle\("is-mode-b-page-scroll", enabled\)/);
  assert.match(appScript, /grid\?\.classList\.toggle\("is-mode-b-page-scroll", enabled\)/);
  assert.match(appScript, /const enabled = effectiveChartPresentationMode\(\) === CHART_PRESENTATION_MODES\.multi/);
  assert.match(styles, /body\.is-mode-b-page-scroll\s*\{[^}]*height: auto;[^}]*min-height: 100vh;[^}]*overflow-y: auto;[^}]*overflow-x: hidden;/s);
  assert.match(styles, /\.chart-grid\.is-mode-b-page-scroll\s*\{[^}]*height: auto;[^}]*grid-template-rows: auto;[^}]*align-items: start;/s);
  assert.match(styles, /\.chart-grid\.is-mode-b-page-scroll \.chart-panel\s*\{[^}]*grid-template-rows:[^}]*--mode-b-main-chart-height[^}]*auto/s);
  assert.match(styles, /\.chart-grid\.is-mode-b-page-scroll \.subchart-slot\.is-mode-b\s*\{[^}]*grid-template-rows: var\(--mode-b-technical-height\) auto;[^}]*overflow: visible;/s);
  assert.match(styles, /\.chart-grid\.is-mode-b-page-scroll \.subchart-slot\.is-mode-a-technical\.has-technical-subchart\s*\{[^}]*height: var\(--mode-b-technical-height\);[^}]*min-height: var\(--mode-b-technical-height\);/s);
  assert.match(styles, /\.chart-grid\.is-mode-b-page-scroll \.subchart-slot\.is-mode-b \.chip-pane-region\s*\{[^}]*overflow: visible;[^}]*overscroll-behavior: auto;/s);
  assert.doesNotMatch(styles, /\.subchart-slot\.is-mode-b \.chip-pane-region\s*\{[^}]*overflow-y: auto/s);
  assert.doesNotMatch(styles, /\.subchart-slot\.is-mode-b \.chip-pane-region\s*\{[^}]*overscroll-behavior: contain/s);
  assert.match(appScript, /updatePageScrollLayout\(\);[\s\S]*select\.value = effectiveChartPresentationMode\(\)/);
  assert.match(appScript, /grid\?\.classList\.toggle\("is-mode-b-four-up", enabled && currentChartCount\(\) === 4\)/);
  assert.doesNotMatch(styles, /\.chip-pane-remove/);
  assert.doesNotMatch(chipScript, /className = "chip-pane-remove"|textContent = "移除"/);
  assert.match(chipScript, /availability\?\.status === "available"\) return ""/);
  assert.match(chipScript, /status\.hidden = !status\.textContent/);
  assert.match(chipScript, /contextMenu\.className = "chip-pane-context-menu"/);
  assert.match(chipScript, /removeMenuItem\.textContent = "移除副圖"/);
  assert.match(chipScript, /backfillMenuItem\.className = "chip-pane-context-menu-action chip-pane-context-menu-backfill"/);
  assert.match(chipScript, /backfillMenuItem\.textContent = backfillState\.label/);
  assert.match(chipScript, /fetch\("\/api\/taiwan-stock-chip\/backfill"/);
  assert.match(chipScript, /backfillMenuItem\.removeEventListener\("click", requestBackfillFromContextMenu\)/);
  assert.match(chipScript, /function startBackfillPolling\(symbol\)/);
  assert.match(chipScript, /invalidateChipRequestCache\(symbol\);\s*await load\(\)/);
  assert.match(chipScript, /if \(identityChanged\) \{[\s\S]*?clearTimeout\(reloadTimer\);[\s\S]*?stopBackfillPolling\(\);/);
  assert.match(chipScript, /destroy\(\) \{ generation \+= 1; cancelPaneDrag\(\); clearTimeout\(reloadTimer\); stopBackfillPolling\(\);/);
  assert.match(chipScript, /surface\.addEventListener\("contextmenu", handleContextMenu\)/);
  assert.match(chipScript, /document\.addEventListener\("pointerdown", handleContextMenuPointerDown, true\)/);
  assert.match(chipScript, /surface\.removeEventListener\("contextmenu", handleContextMenu\)/);
  assert.match(chipScript, /contextMenu\.remove\(\)/);
  assert.match(chipScript, /selection\.modeASlotKind = "technical";[\s\S]*persist\(\);[\s\S]*reconcile\(\);/);
  assert.match(styles, /\.chip-pane-context-menu\s*\{[^}]*position: fixed;[^}]*z-index: 10000;/s);
  assert.match(styles, /\.chip-pane-context-menu-remove:hover,[\s\S]*\.chip-pane-context-menu-remove:focus-visible/);

  const registryBlock = chipScript.slice(chipScript.indexOf("const CHIP_PANE_REGISTRY"), chipScript.indexOf("const CHIP_PANE_GROUPS"));
  for (const id of ["foreign-flow-holding", "investment-trust-flow", "dealer-flow", "institutional-total-flow", "margin", "short", "securities-lending", "short-margin-ratio", "estimated-margin-maintenance", "big-holder", "retail-holder", "tdcc-holder-count"]) {
    assert.match(registryBlock, new RegExp(`id: "${id}"`));
  }
  assert.equal((registryBlock.match(/id: "/g) || []).length, 12);
  assert.ok(registryBlock.indexOf('id: "short"') < registryBlock.indexOf('id: "short-margin-ratio"'));
  assert.ok(registryBlock.indexOf('id: "securities-lending"') < registryBlock.indexOf('id: "short-margin-ratio"'));
  assert.ok(registryBlock.indexOf('id: "short-margin-ratio"') < registryBlock.indexOf('id: "estimated-margin-maintenance"'));
  assert.doesNotMatch(registryBlock, /id: "foreign-flow"[,}]/);
  assert.doesNotMatch(registryBlock, /id: "foreign-holding"[,}]/);
  assert.match(indexHtml, /value="foreign-flow-holding" \/> 外資/);
  assert.match(indexHtml, /value="short-margin-ratio" \/> 券資比/);
  assert.match(indexHtml, /value="estimated-margin-maintenance" \/> 估算融資維持率/);
  assert.match(indexHtml, /value="tdcc-holder-count" \/> 集保戶數/);
  assert.doesNotMatch(indexHtml, /value="foreign-flow"|value="foreign-holding"/);
  assert.match(chipScript, /DEFAULT_MODE_B_PANES = CHIP_PANE_REGISTRY\.map\(\(pane\) => pane\.id\)\.filter\(\(paneId\) => paneId !== "tdcc-holder-count"\)/);
  assert.match(appScript, /SUB_INDICATOR_DEFAULTS = \["kd", "atr"\]/);
  assert.match(appScript, /function seriesTrendAt\(series, time\)/);
  assert.match(appScript, /point\?\.value === null \|\| point\?\.value === undefined/);
  assert.match(appScript, /subchartPresentation = \{ mode: CHART_PRESENTATION_MODES\.single, modeASlotKind: "technical", paneIds: \[\] \}/);
  assert.match(chipScript, /const SELECTION_DEFAULTS_VERSION = 11/);
  assert.match(chipScript, /const HOLDER_LINE_DEFAULTS_VERSION = 11/);
  assert.match(chipScript, /const LEGACY_HOLDER_DEFAULT_SERIES = \["ratio", "change", "holders"\]/);
  assert.match(chipScript, /defaultsVersion: SELECTION_DEFAULTS_VERSION/);
  assert.match(chipScript, /seriesByPane/);
  assert.match(chipScript, /defaults: \["net", "holdingRatio"\]/);
  assert.match(chipScript, /defaults: \["balance", "change"\]/);
  assert.match(chipScript, /"big-holder": \{[\s\S]*?defaults: \["ratio", "change"\][\s\S]*?id: "holders", label: "股東人數"/);
  assert.match(chipScript, /"retail-holder": \{[\s\S]*?defaults: \["ratio", "change"\][\s\S]*?id: "holders", label: "股東人數"/);
  assert.match(chipScript, /"dealer-flow": \{[\s\S]*?defaults: \["self"\][\s\S]*?id: "self", label: "自行"[\s\S]*?id: "hedging", label: "避險"[\s\S]*?id: "net", label: "合計"/);
  assert.match(chipScript, /"short-margin-ratio": \{[\s\S]*?defaults: \["ratio"\][\s\S]*?id: "ratio", label: "券資比", color: "#facc15"[\s\S]*?id: "change", label: "日變化", color: "#e879f9"/);
  assert.match(chipScript, /stored\?\.seriesByPane\?\.\[paneId\]/);
  assert.match(chipScript, /const legacyHolderDefault = \["big-holder", "retail-holder"\]\.includes\(paneId\)[\s\S]*?validStoredIds\.filter\(\(id\) => id !== "holders"\)/);
  assert.match(chipScript, /\["foreign-flow", "foreign-holding"\]\.includes\(id\) \? "foreign-flow-holding" : id/);
  assert.match(chipScript, /\.map\(migratePaneId\).*\.filter\(\(id\) => validIds\.has\(id\)\)/);
  assert.match(chipScript, /selection\.modeASlotKind === "chip" \? \[selection\.modeAActivePaneId\] : \[\]/);
  assert.match(chipScript, /activateTechnicalSlot\(\)/);
  assert.match(chipScript, /options\.onPresentationChange\?\.\(\{/);
  assert.match(appScript, /onPresentationChange: \(presentation\) => \{\s*if \(isPanelActive\(\)\) applySubchartPresentation\(presentation\);\s*\}/);
  assert.match(appScript, /effectivePanelSubchartMode\(\) === CHART_PRESENTATION_MODES\.single\) chipPaneManager\?\.activateTechnicalSlot\(\)/);
  assert.match(appScript, /isTechnicalSubchartVisible\(\)/);
  assert.match(chipScript, /const controllers = new Map\(\)/);
  assert.match(chipScript, /const requestCache = new Map\(\)/);
  assert.match(chipScript, /const requestInFlight = new Map\(\)/);
  assert.match(chipScript, /abortController = new AbortController\(\)/);
  assert.match(chipScript, /current !== generation/);
  assert.match(chipScript, /abortController\?\.abort\(\)/);
  assert.match(chipScript, /waitForSharedRequest\(request, signal\)/);
  assert.match(chipScript, /signal\.addEventListener\("abort", onAbort, \{ once: true \}\)/);
  assert.doesNotMatch(chipScript, /fetch\(`\/api\/taiwan-stock-chip\?\$\{params\}`, \{ signal \}\)/);
  assert.match(chipScript, /resizeObserver\?\.disconnect\(\)/);
  assert.match(chipScript, /chart\.remove\(\)/);
  assert.match(chipScript, /context\.interval !== "1d"/);
  assert.match(chipScript, /!\/\\\.TW\(O\)\?\$\//);
  assert.match(chipScript, /不推論投資人身分/);
  assert.match(chipScript, /value > 0 \? "#dc2626" : value < 0 \? "#16a34a"/);
  assert.match(indexHtml, /value="big-holder" \/> 大戶/);
  assert.match(indexHtml, /value="retail-holder" \/> 散戶/);
  assert.doesNotMatch(indexHtml, /大戶持股（TDCC 週資料）|散戶持股（TDCC 週資料）/);
  assert.doesNotMatch(indexHtml, /適用台股普通股與 ETF 日 K|不代表投資人身分/);
  assert.doesNotMatch(chipScript, /title: "持股比例"/);
  assert.doesNotMatch(chipScript, /title: "週增減"/);
  assert.match(chipScript, /lastValueVisible: false/);
  assert.doesNotMatch(chipScript, /lastValueVisible: true/);
  assert.match(chipScript, /kind: "foreign-combined"/);
  assert.match(chipScript, /datasets: \["institutional-flow", "foreign-holding"\]/);
  assert.match(chipScript, /rightGroup === "flow" \? "right" : "foreign-flow-scale"/);
  assert.match(chipScript, /rightGroup === "ratio" \? "right" : "foreign-ratio-scale"/);
  assert.match(chipScript, /rightGroup === "shares" \? "right" : "foreign-holding-scale"/);
  assert.match(chipScript, /priceScaleId: "right"/);
  assert.match(chipScript, /priceScaleId: HOLDER_CHANGE_PRICE_SCALE_ID/);
  assert.match(chipScript, /priceScaleId: SHORT_MARGIN_RATIO_CHANGE_PRICE_SCALE_ID/);
  assert.match(chipScript, /chart\.priceScale\(SHORT_MARGIN_RATIO_CHANGE_PRICE_SCALE_ID\)\.applyOptions\(\{ visible: false/);
  assert.match(chipScript, /definition\.kind === "short-margin-ratio"/);
  assert.match(chipScript, /shortMarginRatioRows\(daily\)/);
  assert.match(chipScript, /shortMarginRatioPercent\(row\.marginShort\)/);
  assert.match(chipScript, /首筆／無前日比較/);
  assert.match(chipScript, /leftPriceScale: \{ visible: false/);
  assert.match(chipScript, /computed\.filter\(\(item\) => item\.direction !== null\)/);
  assert.match(chipScript, /首筆／無前週比較/);
  assert.match(chipScript, /目前僅 1 期／尚無前週比較/);
  const holderRenderStart = chipScript.indexOf('const ratioColor = definition.id === "big-holder"');
  const holderRenderBlock = chipScript.slice(
    holderRenderStart,
    chipScript.indexOf("holderSnapshots = computed;", holderRenderStart),
  );
  assert.equal((holderRenderBlock.match(/lineWidth: 1/g) || []).length, 2);
  assert.equal((holderRenderBlock.match(/pointMarkersRadius: CROSSHAIR_MARKER_RADIUS/g) || []).length, 2);
  assert.doesNotMatch(holderRenderBlock, /computed\.length === 1 \? 5 : 3/);
  assert.doesNotMatch(chipScript, /首筆／歷史累積中/);
  assert.match(chipScript, /週資料／當週最後營業日/);
  assert.match(chipScript, /歷史回補中/);
  assert.match(chipScript, /datasetEligibility/);
  assert.doesNotMatch(chipScript, /個百分點|\s百分點/);
  assert.ok(chipScript.includes('directionalSegment("週變化", exact.direction, (value) => `${formatSigned(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`)'));
  assert.ok(chipScript.includes('directionalSegment("持股", exact.lotsChange, (value) => `${formatSigned(value, { maximumFractionDigits: 1 })} 張`)'));
  assert.match(chipScript, /const lotsChange = previousLots === null \? null : aggregate\.lots - previousLots/);
  assert.match(chipScript, /\["持股增減", holdingLotsChange\]/);
  assert.doesNotMatch(chipScript, /className = "chip-series-control"|summary\.textContent = "項目"/);
  assert.match(chipScript, /seriesSection\.className = "chip-pane-context-series"/);
  assert.match(chipScript, /seriesTitle\.textContent = "線圖項目"/);
  assert.match(chipScript, /input\.setAttribute\("role", "menuitemcheckbox"\)/);
  assert.match(chipScript, /contextMenu\.appendChild\(seriesSection\)/);
  assert.match(chipScript, /detailsMenuItem\.textContent = "詳細資料"/);
  assert.match(chipScript, /detailsPinnedDate = contextMenuTargetDate \|\| sharedReadoutDate \|\| latestReadoutDate\(\);[\s\S]*?renderDetailTable\(detailsPinnedDate\)/);
  assert.match(chipScript, /definition\.kind === "holder"[\s\S]*?holderDetailModel[\s\S]*?dailyDetailModel/);
  assert.match(chipScript, /detailsPinnedDate = ""/);
  assert.match(chipScript, /global\.addEventListener\("scroll", closeContextMenu, true\)/);
  assert.match(chipScript, /global\.removeEventListener\("scroll", closeContextMenu, true\)/);
  assert.match(chipScript, /holderDetails\.className = "chip-holder-details chip-pane-details"/);
  assert.match(chipScript, /table\.className = "chip-holder-details-table chip-pane-details-table"/);
  assert.match(chipScript, /headings\[1\]\.textContent = model\.previousDate \|\| "無前期資料"/);
  assert.match(chipScript, /headings\[2\]\.textContent = model\.currentDate \|\| targetDate \|\| "無資料"/);
  assert.doesNotMatch(chipScript, /headings\[[12]\]\.textContent\s*=.*(?:前一筆|指向值)/);
  assert.match(chipScript, /\["官方級距", exact\.aggregate\.description\]/);
  assert.match(chipScript, /\["持股張數",/);
  assert.match(chipScript, /\["持股人數",/);
  assert.match(chipScript, /contextMenu\.append\(detailsMenuItem, detailsSeparator\)/);
  assert.match(chipScript, /for \(const controller of controllers\.values\(\)\) controller\.closeOverlays\?\.\(\)/);
  assert.match(chipScript, /\(seriesInputs\[0\] \|\| detailsMenuItem \|\| \(!backfillMenuItem\.hidden \? backfillMenuItem : removeMenuItem\)\)\.focus/);
  assert.match(chipScript, /onSeriesSelectionChange\?\.\(definition\.id, selected\);\s*render\(lastPayload, lastCandles\);/);
  assert.match(chipScript, /foreignBuyShares/);
  assert.match(chipScript, /investmentTrustBuyShares/);
  const trustSeriesBlock = chipScript.slice(chipScript.indexOf('"investment-trust-flow": {'), chipScript.indexOf("    margin: {"));
  assert.doesNotMatch(trustSeriesBlock, /holding|持股/i);
  assert.match(chipScript, /UtilizationPercent/);
  assert.match(chipScript, /function previousActualValue\(sessionDate, getter\)/);
  assert.match(chipScript, /number - previous/);
  assert.match(chipScript, /rightPriceScale: \{ visible: true, borderVisible: true, ticksVisible: true/);
  assert.match(chipScript, /const rightGroup = flowHasData \? "flow"/);
  assert.match(chipScript, /const rightGroup = balanceHasData \? "balance"/);
  assert.match(chipScript, /priceScaleId: "right", color/);
  assert.match(styles, /\.chip-series-choices\s*\{[^}]*display: grid;[^}]*grid-template-columns:/s);
  assert.match(styles, /\.chip-pane-context-menu\s*\{[^}]*max-height: calc\(100vh - 16px\);[^}]*overflow-y: auto;/s);
  assert.match(styles, /\.chip-series-choice:has\(input:focus-visible\)/);
  assert.match(styles, /\.chip-pane-header\s*\{[^}]*flex-wrap: wrap;/s);
  assert.match(styles, /\.chip-pane\.is-holder-pane \.chip-pane-header\s*\{[^}]*flex-wrap: wrap;/s);
  assert.match(styles, /\.chip-pane\.is-holder-pane \.chip-pane-inline-readout\s*\{[^}]*flex: 1 1 160px;/s);
  assert.match(styles, /\.chip-pane\.is-holder-pane \.chip-threshold-select\s*\{[^}]*margin-left: auto;/s);
  assert.match(styles, /\.chip-holder-details\s*\{[^}]*position: fixed;[^}]*z-index: 10001;[^}]*overflow: auto;/s);
  assert.match(styles, /\.chip-holder-details\s*\{[^}]*width: max-content;[^}]*max-width: calc\(100vw - 16px\);/s);
  assert.match(styles, /\.chip-holder-details-table th,\s*\.chip-holder-details-table td\s*\{[^}]*padding: 3px 4px;/s);
  assert.match(styles, /\.chip-holder-details-table\s*\{[^}]*width: max-content;[^}]*border-collapse: collapse;/s);
  assert.match(styles, /\.chip-pane-details-table\s*\{[^}]*min-width: 0;/s);
  assert.doesNotMatch(styles, /\.chip-holder-details\s*\{[^}]*width: min\(500px|\.chip-pane-details-table\s*\{[^}]*min-width: 460px|\.chip-holder-details-table\s*\{[^}]*width: 100%/s);
  assert.match(chipScript, /global\.innerHeight - detailsRect\.height - 8/);
  assert.match(chipScript, /holderDetails\.remove\(\)/);
  assert.match(styles, /\.chip-holder-details-table\s*\{[^}]*border-collapse: collapse;/s);
  assert.match(styles, /\.chip-pane-inline-readout\s*\{[^}]*flex-wrap: wrap;[^}]*overflow: visible;[^}]*white-space: normal;/s);
  assert.match(styles, /\.chip-pane-group-body\s*\{[^}]*margin-inline: -1px;/s);
  assert.match(styles, /\.chip-readout-date,[\s\S]*?\.chip-readout-segment\s*\{[^}]*white-space: nowrap;/s);
  assert.match(styles, /\.chart-grid\.is-mode-b-page-scroll \.chip-pane\s*\{[^}]*height: auto;[^}]*min-height: 96px;/s);
  assert.doesNotMatch(styles, /\.chip-pane-header strong\s*\{[^}]*text-overflow: ellipsis;/s);
  assert.match(chipScript, /modeBPaneOrder: normalizePaneOrder\(stored\?\.modeBPaneOrder, modeBSelectedPaneIds\)/);
  assert.match(chipScript, /dragHandle\.className = "chip-pane-group-drag-handle"/);
  assert.match(chipScript, /moveUpMenuItem\.textContent = "上移資料群組"/);
  assert.match(chipScript, /moveDownMenuItem\.textContent = "下移資料群組"/);
  assert.match(chipScript, /pinToTopMenuItem\.textContent = "置頂"/);
  assert.match(chipScript, /pinToTopMenuItem\.disabled = !options\.canPinToTop\?\.\(definition\.id\)/);
  assert.match(chipScript, /function pinPaneToTop\(id\)[\s\S]*?movePaneInOrder\(ids, groupId, 0\)[\s\S]*?saveVisibleGroupOrder\(next\)[\s\S]*?applyControllerOrder\(next\)/);
  assert.match(chipScript, /pinToTopMenuItem\.removeEventListener\("click", pinToTopFromContextMenu\)/);
  assert.match(chipScript, /pinToBottomMenuItem\.textContent = "置底"/);
  assert.match(chipScript, /pinToBottomMenuItem\.setAttribute\("aria-label", `將\$\{definition\.label\}資料群組置底`\)/);
  assert.match(chipScript, /pinToBottomMenuItem\.disabled = !options\.canPinToBottom\?\.\(definition\.id\)/);
  assert.match(chipScript, /function canPinPaneToBottom\(id\)[\s\S]*?index >= 0 && index < ids\.length - 1/);
  assert.match(chipScript, /function pinPaneToBottom\(id\)[\s\S]*?movePaneInOrder\(ids, groupId, ids\.length - 1\)[\s\S]*?saveVisibleGroupOrder\(next\)[\s\S]*?applyControllerOrder\(next\)[\s\S]*?updateInputs\(\)[\s\S]*?options\.onLayoutChange\?\.\(\)/);
  assert.match(chipScript, /pinToBottomMenuItem\.removeEventListener\("click", pinToBottomFromContextMenu\)/);
  assert.match(chipScript, /function startPaneDrag\(id, event\)/);
  assert.match(styles, /\.chart-panel\.has-no-subchart \.subchart-slot\s*\{[^}]*display: none;/s);
  assert.match(indexHtml, /styles\.css\?v=20260807-toolbar-spacing-v2/);
  assert.match(indexHtml, /chart-annotations\.js\?v=20260727-fibonacci-snap-coexist-v1/);
  assert.match(indexHtml, /chip-panes\.js\?v=20260807-inline-ticket-toolbar-v1/);
  assert.match(indexHtml, /panel-image-export\.js\?v=20260721-panel-frame-v4/);
  assert.match(indexHtml, /app\.js\?v=20260807-inline-ticket-toolbar-v1/);
});

test("固定範圍 VP 價格標籤無範圍前綴，水平線為 1px 且控制線為 2px", async () => {
  const [appScript, styles] = await Promise.all([
    readFile(new URL("../public/static/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/static/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(appScript, /appendFixedProfileLevels\(profileRange\.profile, left, right, isSelected, profileRange\.id\)/);
  assert.match(appScript, /value\.classList\.toggle\("is-muted", !isSelected\)/);
  assert.match(appScript, /value\.dataset\.rangeId = rangeId/);
  assert.match(appScript, /value\.textContent = `\$\{entry\.label\} \$\{formatQuotePrice\(entry\.price,/);
  assert.doesNotMatch(appScript, /value\.textContent = `\$\{rangeName/);
  assert.doesNotMatch(appScript, /if \(!showLabel\) return/);
  assert.doesNotMatch(appScript, /range\.style\.border(?:Left|Right)Color/);
  assert.doesNotMatch(appScript, /range\.style\.boxShadow/);

  assert.match(styles, /\.fixed-profile-range\s*\{[^}]*border: 0;[^}]*background: transparent;/s);
  assert.match(styles, /\.fixed-profile-range\.is-selected\s*\{[^}]*background: rgba\(250, 204, 21, 0\.025\);/s);
  assert.match(styles, /\.fixed-profile-range\.is-muted\s*\{[^}]*background: transparent;/s);
  assert.match(styles, /\.fixed-profile-buy-segment,[\s\S]*?opacity: 0\.18;/);
  assert.match(styles, /\.fixed-profile-bucket\.value-area[^{]*\{[^}]*opacity: 0\.46;/s);
  assert.match(styles, /\.fixed-profile-bucket\.poc\.value-area[^{]*\{[^}]*opacity: 0\.62;/s);
  assert.match(styles, /\.fixed-profile-level\.is-muted\s*\{[^}]*opacity: 0\.58;/s);
  assert.match(styles, /\.fixed-profile-level-label\.is-muted\s*\{[^}]*opacity: 0\.68;/s);
  assert.match(styles, /\.fixed-profile-level\s*\{[^}]*border-top-width: 1px;/s);
  assert.doesNotMatch(styles, /\.fixed-profile-level\.(?:poc|vah|val)\s*\{[^}]*border-top-width:/s);
  assert.match(styles, /\.fixed-profile-drag-handle\s*\{[^}]*width: 2px;[^}]*margin-left: -1px;[^}]*box-shadow: none;[^}]*opacity: 0\.62;/s);
  assert.doesNotMatch(styles, /\.fixed-profile-drag-handle\.(?:left|right)\s*\{[^}]*border-(?:left|right):/s);
});

test("K 線縮放與平移後不會被 layout 或延遲 refit 重設", async () => {
  const appScript = await readFile(new URL("../public/static/app.js", import.meta.url), "utf8");
  const applyPayloadBlock = appScript.slice(appScript.indexOf("function applyPayload"), appScript.indexOf("function resetHistoryLoadState"));
  const layoutBlock = appScript.slice(appScript.indexOf("function refreshPanelLayout"), appScript.indexOf("function currentPriceScaleMinWidth"));
  const synchronizedRangeBlock = appScript.slice(appScript.indexOf("function setSynchronizedVisibleLogicalRange"), appScript.indexOf("function syncIndicatorVisibleRangeToMain"));
  const refitScheduleBlock = appScript.slice(appScript.indexOf("function scheduleTimeScaleRefit"), appScript.indexOf("function schedulePanelLayoutRefresh"));

  assert.match(appScript, /function armHistoryInteraction\(\) \{[\s\S]*?historyInteractionArmed = true;[\s\S]*?cancelScheduledTimeScaleRefit\(\);[\s\S]*?\}/);
  assert.match(appScript, /surface\.addEventListener\("wheel", armHistoryInteraction/);
  assert.match(appScript, /surface\.addEventListener\("pointerdown", armHistoryInteraction/);
  assert.match(applyPayloadBlock, /const userVisibleLogicalRange = !preserveVisibleLogicalRange && historyInteractionArmed/);
  assert.match(applyPayloadBlock, /else if \(isFiniteLogicalRange\(userVisibleLogicalRange\)\) \{[\s\S]*?setSynchronizedVisibleLogicalRange\(userVisibleLogicalRange\)/);
  assert.match(layoutBlock, /const visibleLogicalRange = chart\.timeScale\(\)\.getVisibleLogicalRange\?\.\(\)/);
  assert.match(layoutBlock, /setSynchronizedVisibleLogicalRange\(visibleLogicalRange\)/);
  assert.doesNotMatch(layoutBlock, /refitTimeScalesToCandles/);
  assert.match(synchronizedRangeBlock, /chipPaneManager\?\.syncRange\(range\)/);
  assert.match(refitScheduleBlock, /if \(historyInteractionArmed\) return/);
  assert.match(refitScheduleBlock, /if \(isPanelActive\(\) && !historyInteractionArmed\)/);
  assert.match(refitScheduleBlock, /function cancelScheduledTimeScaleRefit\(\)/);
});

test("多圖 panel 雙擊以 page-scoped URL 在新分頁開啟單圖", async () => {
  const appScript = await readFile(new URL("../public/static/app.js", import.meta.url), "utf8");
  const initBlock = appScript.slice(appScript.indexOf("async function init()"), appScript.indexOf("function normalizeMainReadoutMode"));
  const openSingleBlock = appScript.slice(appScript.indexOf("function openPanelInNewTab"), appScript.indexOf("function isTaiwanStockSymbol"));
  assert.match(appScript, /function parseSingleChartViewRequest\(search/);
  assert.match(appScript, /function resolveSingleChartViewRequest\(request/);
  assert.match(appScript, /function buildSingleChartUrl\(\{ symbol, interval, tabId \}/);
  assert.match(appScript, /searchParams\.set\("view", "single"\)/);
  assert.match(appScript, /searchParams\.set\("symbol", canonicalSymbol\(symbol\)\)/);
  assert.match(appScript, /window\.open\(url\.href, "_blank", "noopener"\)/);
  assert.match(appScript, /const SINGLE_CHART_OPEN_STREAM_RESUME_DELAY_MS = 3000/);
  assert.match(openSingleBlock, /const openerPanels = \[\.\.\.state\.panels\];\s*openerPanels\.forEach\(\(currentPanel\) => currentPanel\.pauseStream\?\.\(\)\);\s*const opened = window\.open/);
  assert.match(openSingleBlock, /window\.setTimeout\(\(\) => \{\s*openerPanels\.forEach\(\(currentPanel\) => currentPanel\.resumeStream\?\.\(\)\);\s*\}, SINGLE_CHART_OPEN_STREAM_RESUME_DELAY_MS\)/);
  assert.match(appScript, /element\.addEventListener\("dblclick", \(event\) => openPanelInNewTab\(element, event/);
  assert.match(appScript, /if \(!state\.singleChartView\) localStorage\.setItem\("chartCount", countSelect\.value\)/);
  assert.match(appScript, /countSelect\.value = state\.singleChartRequest \? "1"/);
  assert.match(appScript, /fillIntervalOptions\(intervalSelect, defaultIntervalForPanel\(panelPosition\), symbolSelect\.value\)/);
  assert.match(initBlock, /const instrumentsPromise = loadInstruments\(\);\s*const appConfigPromise = loadAppConfig\(\);\s*await Promise\.all\(\[instrumentsPromise, appConfigPromise\]\);/);
  assert.match(initBlock, /await Promise\.all\(\[instrumentsPromise, appConfigPromise\]\);[\s\S]*renderPanels\(Number\(countSelect\.value\)\);/);
  assert.doesNotMatch(initBlock, /await loadAppConfig\(\)[\s\S]*await loadInstruments\(\)/);
  assert.match(appScript, /select, input, button, summary, details, a, \[role="menu"\], \[contenteditable="true"\]/);
  assert.doesNotMatch(appScript, /setFocusedPanel|refreshFocusedPanelLayouts/);
});

test("多圖 panel 支援直覺拖曳、鍵盤排序、原地同步與完整 cleanup", async () => {
  const [appScript, styles, reorderScript] = await Promise.all([
    readFile(new URL("../public/static/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/static/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../public/static/panel-reordering.js", import.meta.url), "utf8"),
  ]);
  const applyBlock = appScript.slice(appScript.indexOf("function applyPanelReorder"), appScript.indexOf("function panelDragStartAllowed"));
  const moveBlock = appScript.slice(appScript.indexOf("function handlePanelDragMove"), appScript.indexOf("function panelDropIsValid"));
  const cleanupBlock = appScript.slice(appScript.indexOf("function cleanupPanelDrag"), appScript.indexOf("function handlePanelReorderKeydown"));
  const canonicalSyncBlock = appScript.slice(appScript.indexOf("function syncExistingPanelsToCanonicalOrder"), appScript.indexOf("function applyPanelReorder"));
  const syncBlock = appScript.slice(appScript.indexOf("function syncChartOrderForTab"), appScript.indexOf("function providerForSymbol"));
  assert.match(indexHtml, /id="panel-reorder-status"[^>]*aria-live="polite"/);
  assert.match(indexHtml, /class="panel-reorder-handle"[^>]*data-export-exclude="true"/);
  assert.match(indexHtml, /static\/panel-reordering\.js/);
  assert.match(appScript, /priceStrip\.addEventListener\("pointerdown", handlePanelReorderPointerDown\)/);
  assert.match(appScript, /symbolSelect\.addEventListener\("change", \(\) => \{[\s\S]*?updatePanelReorderLabel\(\)/);
  assert.match(appScript, /let canonicalItemSymbol =/);
  assert.doesNotMatch(appScript, /let canonicalSymbol =/);
  assert.match(appScript, /event\.button !== 0/);
  assert.match(appScript, /PANEL_DRAG_MOVEMENT_THRESHOLD_PX = 6/);
  assert.match(appScript, /select, details, summary, button, input, textarea, a/);
  assert.match(moveBlock, /updatePanelDragPreview\(drag, event\.clientX, event\.clientY\)/);
  assert.doesNotMatch(moveBlock, /appendChild|state\.panels\s*=/);
  assert.match(appScript, /window\.addEventListener\("pointermove", drag\.onMove, true\)/);
  assert.match(appScript, /window\.addEventListener\("pointerup", drag\.onUp, true\)/);
  assert.match(appScript, /window\.addEventListener\("pointercancel", drag\.onCancel, true\)/);
  assert.match(appScript, /window\.addEventListener\("blur", drag\.onBlur\)/);
  assert.match(appScript, /document\.addEventListener\("visibilitychange", drag\.onVisibility\)/);
  assert.match(cleanupBlock, /removeEventListener\("pointermove", drag\.onMove, true\)/);
  assert.match(cleanupBlock, /drag\.ghost\?\.remove\(\)/);
  assert.match(applyBlock, /replacePageSlice/);
  assert.match(applyBlock, /stageManagedInstrumentOrder\([\s\S]*source: "panel"/);
  assert.match(applyBlock, /stageManagedInstrumentOrder\([\s\S]*refreshExistingPanelSymbolOptions\(\)/);
  assert.doesNotMatch(applyBlock, /renderPanels|\.load\(/);
  assert.match(canonicalSyncBlock, /if \(synced\) refreshExistingPanelSymbolOptions\(\)/);
  assert.match(appScript, /panel\.refreshSymbolOptions\?\.\(panel\.getDisplaySymbol\?\.\(\)\)/);
  assert.match(syncBlock, /if \(syncExistingPanelsToCanonicalOrder\(tab\)\)/);
  assert.match(appScript, /Date\.now\(\) < state\.panelDragSuppressUntil/);
  assert.match(appScript, /handlePanelReorderKeydown/);
  assert.match(appScript, /quoteChartDebugMatrix/);
  assert.match(appScript, /dataset\.quoteChartDebugMatrix/);
  assert.match(appScript, /getBoundingClientRect\(\)/);
  assert.match(reorderScript, /targetIndexFromPoint/);
  assert.match(reorderScript, /keyboardTargetIndex/);
  assert.match(styles, /\.price-strip\[data-panel-reorder-enabled="true"\]/);
  assert.match(styles, /cursor: grab/);
  assert.match(styles, /\.panel-reorder-ghost/);
  assert.match(styles, /\.panel-reorder-drop-indicator/);
  assert.match(styles, /\.panel-reorder-handle:focus-visible/);
});

test("籌碼 series 舊偏好 migration 保留原主要線並隔離 tab、symbol、pane", async () => {
  const chipScript = await readFile(new URL("../public/static/chip-panes.js", import.meta.url), "utf8");
  const values = new Map([
    ["quoteChart.chipPanes.v1:tab-a:2330.TW", JSON.stringify({
      defaultsVersion: 3,
      modeASlotKind: "chip",
      modeAActivePaneId: "foreign-flow",
      modeBSelectedPaneIds: ["foreign-holding", "margin"],
    })],
    ["quoteChart.chipPanes.v1:tab-b:2330.TW", JSON.stringify({
      defaultsVersion: 4,
      modeASlotKind: "chip",
      modeAActivePaneId: "margin",
      modeBSelectedPaneIds: ["margin"],
      seriesByPane: { margin: ["utilization", "unknown"], "dealer-flow": ["hedging", "unknown"] },
    })],
    ["quoteChart.chipPanes.v1:tab-c:2330.TW", JSON.stringify({
      defaultsVersion: 4,
      modeASlotKind: "chip",
      modeAActivePaneId: "short-margin-ratio",
      modeBSelectedPaneIds: ["margin", "short", "short-margin-ratio"],
      seriesByPane: { "short-margin-ratio": ["ratio", "change", "unknown"] },
    })],
    ["quoteChart.chipPanes.v1:tab-legacy-holder:2330.TW", JSON.stringify({
      defaultsVersion: 10,
      seriesByPane: {
        "big-holder": ["ratio", "change", "holders"],
        "retail-holder": ["holders", "change", "ratio"],
      },
    })],
    ["quoteChart.chipPanes.v1:tab-custom-holder:2330.TW", JSON.stringify({
      defaultsVersion: 10,
      seriesByPane: {
        "big-holder": ["ratio", "holders"],
        "retail-holder": ["holders"],
      },
    })],
    ["quoteChart.chipPanes.v1:tab-saved-holder:2330.TW", JSON.stringify({
      defaultsVersion: 11,
      modeBSelectedPaneIds: ["big-holder", "retail-holder", "tdcc-holder-count"],
    })],
  ]);
  const localStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
  const window = {};
  vm.runInNewContext(chipScript, { window, localStorage, structuredClone }, { filename: "chip-panes.js" });
  const { readSelection, selectionStorageKey } = window.QuoteChartChipPanes.__test;

  assert.equal(selectionStorageKey("tab-a", "2330.tw"), "quoteChart.chipPanes.v1:tab-a:2330.TW");
  const migrated = JSON.parse(JSON.stringify(readSelection("tab-a", "2330.TW")));
  assert.equal(migrated.defaultsVersion, 11);
  assert.equal(migrated.modeAActivePaneId, "foreign-flow-holding");
  assert.deepEqual(migrated.modeBSelectedPaneIds, ["foreign-flow-holding", "margin", "estimated-margin-maintenance"]);
  assert.deepEqual(migrated.modeBPaneOrder.slice(0, 3), ["foreign-flow-holding", "margin", "estimated-margin-maintenance"]);
  assert.deepEqual(migrated.modeBGroupOrder, ["institutional", "margin-financing", "holder"]);
  assert.deepEqual(migrated.seriesByPane["foreign-flow-holding"], ["net", "holdingRatio"]);
  assert.deepEqual(migrated.seriesByPane["investment-trust-flow"], ["net"]);
  assert.deepEqual(migrated.seriesByPane["dealer-flow"], ["self"]);
  assert.deepEqual(migrated.seriesByPane.margin, ["balance", "change"]);
  assert.deepEqual(migrated.seriesByPane["short-margin-ratio"], ["ratio"]);

  const customized = JSON.parse(JSON.stringify(readSelection("tab-b", "2330.TW")));
  assert.equal(customized.defaultsVersion, 11);
  assert.deepEqual(customized.modeBSelectedPaneIds, ["margin", "estimated-margin-maintenance"]);
  assert.deepEqual(customized.modeBPaneOrder.slice(0, 2), ["margin", "estimated-margin-maintenance"]);
  assert.deepEqual(customized.modeBGroupOrder, ["margin-financing", "institutional", "holder"]);
  assert.deepEqual(customized.seriesByPane.margin, ["utilization"]);
  assert.deepEqual(customized.seriesByPane["dealer-flow"], ["hedging"]);
  assert.deepEqual(JSON.parse(JSON.stringify(readSelection("tab-a", "2317.TW").seriesByPane.margin)), ["balance", "change"]);
  const ratioCustomized = JSON.parse(JSON.stringify(readSelection("tab-c", "2330.TW")));
  assert.equal(ratioCustomized.modeAActivePaneId, "short-margin-ratio");
  assert.deepEqual(ratioCustomized.modeBSelectedPaneIds, ["margin", "short", "short-margin-ratio", "estimated-margin-maintenance"]);
  assert.deepEqual(ratioCustomized.modeBPaneOrder.slice(0, 4), ["margin", "short", "short-margin-ratio", "estimated-margin-maintenance"]);
  assert.deepEqual(ratioCustomized.seriesByPane["short-margin-ratio"], ["ratio", "change"]);

  const legacyHolder = JSON.parse(JSON.stringify(readSelection("tab-legacy-holder", "2330.TW")));
  assert.deepEqual(legacyHolder.seriesByPane["big-holder"], ["ratio", "change"]);
  assert.deepEqual(legacyHolder.seriesByPane["retail-holder"], ["change", "ratio"]);

  const customHolder = JSON.parse(JSON.stringify(readSelection("tab-custom-holder", "2330.TW")));
  assert.deepEqual(customHolder.seriesByPane["big-holder"], ["ratio", "holders"]);
  assert.deepEqual(customHolder.seriesByPane["retail-holder"], ["holders"]);

  const firstUse = JSON.parse(JSON.stringify(readSelection("tab-new", "2330.TW")));
  assert.deepEqual(firstUse.seriesByPane["dealer-flow"], ["self"]);
  assert.deepEqual(firstUse.seriesByPane["big-holder"], ["ratio", "change"]);
  assert.deepEqual(firstUse.seriesByPane["retail-holder"], ["ratio", "change"]);
  assert.deepEqual(firstUse.seriesByPane["tdcc-holder-count"], ["holders"]);
  assert.deepEqual(firstUse.modeBSelectedPaneIds, [
    "foreign-flow-holding",
    "investment-trust-flow",
    "dealer-flow",
    "institutional-total-flow",
    "margin",
    "short",
    "securities-lending",
    "short-margin-ratio",
    "estimated-margin-maintenance",
    "big-holder",
    "retail-holder",
  ]);

  const savedHolder = JSON.parse(JSON.stringify(readSelection("tab-saved-holder", "2330.TW")));
  assert.deepEqual(savedHolder.modeBSelectedPaneIds, ["big-holder", "retail-holder", "tdcc-holder-count"]);

  values.set("quoteChart.chipPanes.v1:tab-empty:2330.TW", JSON.stringify({ modeBSelectedPaneIds: [] }));
  const explicitlyEmpty = JSON.parse(JSON.stringify(readSelection("tab-empty", "2330.TW")));
  assert.deepEqual(explicitlyEmpty.modeBSelectedPaneIds, []);

  values.set("quoteChart.chipPanes.v1:tab-removed-new-pane:2330.TW", JSON.stringify({
    defaultsVersion: 10,
    modeBSelectedPaneIds: ["margin", "short"],
  }));
  const explicitlyRemovedNewPane = JSON.parse(JSON.stringify(readSelection("tab-removed-new-pane", "2330.TW")));
  assert.deepEqual(explicitlyRemovedNewPane.modeBSelectedPaneIds, ["margin", "short"]);

  values.set("quoteChart.chipPanes.v1:tab-empty-dealer:2330.TW", JSON.stringify({
    seriesByPane: { "dealer-flow": [] },
  }));
  const emptyDealer = JSON.parse(JSON.stringify(readSelection("tab-empty-dealer", "2330.TW")));
  assert.deepEqual(emptyDealer.seriesByPane["dealer-flow"], ["self"]);
});

test("多層副圖一般 wheel 捲頁且保持圖表範圍，Alt wheel 明確縮放", async () => {
  const [interactionScript, appScript, chipScript] = await Promise.all([
    readFile(new URL("../public/static/chart-interactions.js", import.meta.url), "utf8"),
    readFile(new URL("../public/static/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/static/chip-panes.js", import.meta.url), "utf8"),
  ]);
  assert.match(indexHtml, /chart-interactions\.js[^<]*<\/script>[\s\S]*chip-panes\.js[^<]*<\/script>[\s\S]*live-batch-coordinator\.js[^<]*<\/script>[\s\S]*app\.js/);
  assert.match(indexHtml, /chip-panes\.js\?v=20260807-inline-ticket-toolbar-v1/);
  assert.match(appScript, /QuoteChartInteractions\.chartInteractionOptions\(mode\)/);
  assert.match(appScript, /bindWheelRouting\(surface, \(\) => subchartPresentation\.mode\)/);
  assert.match(appScript, /mainWheelRoutingCleanup = window\.QuoteChartInteractions\.bindWheelRouting\(surface, \(\) => subchartPresentation\.mode\);\s*chart = LightweightCharts\.createChart/s);
  assert.match(appScript, /indicatorWheelRoutingCleanup = window\.QuoteChartInteractions\.bindWheelRouting\(indicatorSurface, \(\) => subchartPresentation\.mode\);\s*indicatorChart = createIndicatorChart\(\)/s);
  assert.match(appScript, /mainWheelRoutingCleanup\?\.\(\)/);
  assert.match(appScript, /indicatorWheelRoutingCleanup\?\.\(\)/);
  assert.match(chipScript, /setInteractionMode\(mode\)/);
  assert.match(chipScript, /wheelRoutingCleanup = global\.QuoteChartInteractions\.bindWheelRouting\(surface, \(\) => interactionMode\);\s*chart = global\.LightweightCharts\.createChart/s);
  assert.match(chipScript, /let rangeInputEnabled = false;/);
  assert.match(chipScript, /if \(rangeInputEnabled\) options\.onRange\?\.\(range, definition\.id, chart\?\.timeScale\(\)\.getVisibleRange\?\.\(\)\)/);
  assert.match(chipScript, /deferRangeInputUntilLayoutSettles\(\);/);
  assert.match(chipScript, /rangeInputEnabled = Boolean\(chart && !destroyed\)/);
  assert.match(chipScript, /wheelRoutingCleanup\?\.\(\)/);
  assert.doesNotMatch(appScript, /setPageScrollEnabled/);
  assert.doesNotMatch(chipScript, /setPageScrollEnabled|pageScrollEnabled/);
  const listeners = new Map();
  const scrollCalls = [];
  const surface = {
    addEventListener(name, listener, options) { listeners.set(name, { listener, options }); },
    removeEventListener(name, listener) {
      if (listeners.get(name)?.listener === listener) listeners.delete(name);
    },
  };
  const sandbox = {
    window: {
      innerHeight: 800,
      scrollBy(options) { scrollCalls.push(options); },
    },
  };
  vm.runInNewContext(interactionScript, sandbox);
  const interactions = sandbox.window.QuoteChartInteractions;
  const modeMain = interactions.chartInteractionOptions("main");
  const modeA = interactions.chartInteractionOptions("single");
  const modeB = interactions.chartInteractionOptions("multi");
  assert.equal(interactions.normalizeMode("main"), "main");
  assert.equal(interactions.normalizeMode("A"), "single");
  assert.equal(interactions.normalizeMode("B"), "multi");
  assert.equal(modeMain.handleScroll.vertTouchDrag, true);
  assert.equal(modeA.handleScroll.mouseWheel, true);
  assert.equal(modeA.handleScale.mouseWheel, true);
  assert.equal(modeA.handleScroll.pressedMouseMove, true);
  assert.equal(modeA.handleScroll.vertTouchDrag, true);
  assert.equal(modeB.handleScroll.mouseWheel, true);
  assert.equal(modeB.handleScale.mouseWheel, true);
  assert.equal(modeB.handleScroll.pressedMouseMove, true);
  assert.equal(modeB.handleScroll.horzTouchDrag, true);
  assert.equal(modeB.handleScroll.vertTouchDrag, false);
  assert.equal(modeB.handleScale.pinch, true);

  let activeMode = "multi";
  const cleanup = interactions.bindWheelRouting(surface, () => activeMode);
  assert.equal(listeners.get("wheel")?.options?.capture, true);
  assert.equal(listeners.get("wheel")?.options?.passive, false);
  const wheel = listeners.get("wheel").listener;
  let prevented = 0;
  let stopped = 0;
  wheel({ altKey: false, ctrlKey: false, metaKey: false, deltaY: 4, deltaMode: 1, preventDefault() { prevented += 1; }, stopImmediatePropagation() { stopped += 1; } });
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.equal(scrollCalls[0].top, 64);
  assert.equal(scrollCalls[0].left, 0);
  assert.equal(scrollCalls[0].behavior, "auto");
  wheel({ altKey: true, ctrlKey: false, metaKey: false, deltaY: 4, deltaMode: 1, preventDefault() { prevented += 1; }, stopImmediatePropagation() { stopped += 1; } });
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.equal(scrollCalls.length, 1);
  wheel({ altKey: false, ctrlKey: true, metaKey: false, deltaY: 2, deltaMode: 2, preventDefault() { prevented += 1; }, stopImmediatePropagation() { stopped += 1; } });
  wheel({ altKey: false, ctrlKey: false, metaKey: true, deltaY: 2, deltaMode: 2, preventDefault() { prevented += 1; }, stopImmediatePropagation() { stopped += 1; } });
  assert.equal(prevented, 1);
  assert.equal(scrollCalls.length, 1);
  wheel({ altKey: false, ctrlKey: false, metaKey: false, deltaY: 2, deltaMode: 2, preventDefault() { prevented += 1; }, stopImmediatePropagation() { stopped += 1; } });
  assert.equal(prevented, 2);
  assert.equal(stopped, 2);
  assert.equal(scrollCalls[1].top, 1600);
  wheel({ altKey: false, ctrlKey: false, metaKey: false, deltaY: 0, deltaMode: 0, preventDefault() { prevented += 1; }, stopImmediatePropagation() { stopped += 1; } });
  assert.equal(scrollCalls.length, 2);
  activeMode = "single";
  wheel({ altKey: false, ctrlKey: false, metaKey: false, deltaY: 4, deltaMode: 1, preventDefault() { prevented += 1; }, stopImmediatePropagation() { stopped += 1; } });
  assert.equal(prevented, 2);
  assert.equal(scrollCalls.length, 2);
  cleanup();
  assert.equal(listeners.has("wheel"), false);
});

test("共用垂直線、標題列逐日讀值、TDCC 缺值與 1px 對齊 contract 完整", async () => {
  const [appScript, chipScript, styles] = await Promise.all([
    readFile(new URL("../public/static/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/static/chip-panes.js", import.meta.url), "utf8"),
    readFile(new URL("../public/static/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(indexHtml, /class="panel-crosshair-line" hidden aria-hidden="true"/);
  assert.match(indexHtml, /class="main-readout indicator-readout main-readout--fixed hidden" role="status" aria-live="polite"/);
  assert.match(indexHtml, /class="main-readout-mode-select" aria-label="K 線數值顯示方式">[\s\S]*?<option value="fixed" selected>圖區左上角<\/option>[\s\S]*?<option value="floating">浮動視窗<\/option>/);
  assert.match(indexHtml, /data-main-readout="date"><b data-main-date>--<\/b>/);
  assert.doesNotMatch(indexHtml, /data-main-readout="date">日期/);
  assert.match(indexHtml, /class="technical-pane-header">[\s\S]*?<strong>技術指標<\/strong>[\s\S]*?sub-readout indicator-readout technical-pane-inline-readout hidden/);
  assert.match(indexHtml, /data-sub-readout="date"><b data-sub-date>--<\/b>/);
  assert.doesNotMatch(indexHtml, /data-sub-readout="date">日期/);
  assert.doesNotMatch(indexHtml, /sub-readout indicator-readout cursor-tooltip/);
  assert.match(styles, /\.panel-crosshair-line\s*\{[^}]*position: absolute;[^}]*pointer-events: none;/s);
  assert.match(styles, /\.cursor-tooltip\s*\{[^}]*position: absolute;[^}]*pointer-events: none;/s);
  assert.match(styles, /\.main-readout--fixed\s*\{[^}]*left: 8px;[^}]*right: var\(--axis-safe-width\);[^}]*background: linear-gradient/s);
  assert.match(styles, /\.technical-pane-header\s*\{[^}]*min-height: 24px;[^}]*display: flex;[^}]*overflow: hidden;/s);
  assert.match(styles, /\.technical-pane-inline-readout\s*\{[^}]*position: static;[^}]*display: flex;[^}]*overflow: hidden;/s);
  assert.doesNotMatch(styles, /\.chip-pane-tooltip/);
  assert.match(styles, /\.chip-pane-inline-readout\s*\{[^}]*display: flex;[^}]*flex-wrap: wrap;[^}]*overflow: visible;/s);
  assert.match(styles, /\.chip-readout-label\s*\{[^}]*color: var\(--readout-series-color, #cbd5e1\);/s);
  assert.match(styles, /\.chip-readout-value\.is-positive\s*\{[^}]*color: #f87171;/s);
  assert.match(styles, /\.chip-readout-value\.is-negative\s*\{[^}]*color: #4ade80;/s);
  assert.doesNotMatch(styles, /\.chip-readout-segment\.is-(?:positive|negative)/);

  assert.match(appScript, /crosshair: SHARED_CROSSHAIR_OPTIONS/);
  assert.match(chipScript, /crosshair: SHARED_CROSSHAIR_OPTIONS/);
  assert.match(appScript, /function positionSharedCrosshair\(time\)/);
  assert.match(appScript, /function hideSharedCrosshair\(\)/);
  assert.match(appScript, /const MAIN_READOUT_MODE_KEY = "mainReadoutMode"/);
  assert.match(appScript, /mainReadoutMode: MAIN_READOUT_MODES\.fixed/);
  assert.match(appScript, /state\.mainReadoutMode = normalizeMainReadoutMode\(localStorage\.getItem\(MAIN_READOUT_MODE_KEY\)\)/);
  assert.match(appScript, /localStorage\.setItem\(MAIN_READOUT_MODE_KEY, state\.mainReadoutMode\)/);
  assert.match(appScript, /state\.panels\.forEach\(\(panel\) => panel\.refreshMainReadoutMode\?\.\(\)\)/);
  assert.match(appScript, /mainReadout\.classList\.toggle\("main-readout--fixed", mode === MAIN_READOUT_MODES\.fixed\)/);
  assert.match(appScript, /mainReadout\.classList\.toggle\("cursor-tooltip", mode === MAIN_READOUT_MODES\.floating\)/);
  assert.match(appScript, /if \(state\.mainReadoutMode === MAIN_READOUT_MODES\.fixed\) restoreLatestMainReadout\(\)/);
  assert.match(appScript, /if \(state\.mainReadoutMode === MAIN_READOUT_MODES\.floating\) \{\s*positionCursorTooltip\(mainReadout, surface, screenX\)/s);
  assert.match(appScript, /setReadoutDate\(mainReadout, candle\?\.time \?\? time\)/);
  assert.match(appScript, /function restoreLatestTechnicalReadout\(\)/);
  assert.match(appScript, /updateTechnicalReadoutForTime\(time, \{ latest: true \}\)/);
  assert.match(appScript, /function yyyyMmDd\(value\)/);
  assert.doesNotMatch(appScript, /positionCursorTooltip\(subReadout/);
  assert.match(appScript, /chipPaneManager\?\.showReadouts\(time\)/);
  assert.match(appScript, /chipPaneManager\?\.restoreLatestReadouts\(\)/);
  assert.match(appScript, /chipPaneManager\?\.measureCoordinates\(time\)/);
  assert.match(appScript, /delta <= ALIGNMENT_DELTA_LIMIT_PX/);
  assert.match(chipScript, /measureCoordinates\(time\)/);
  assert.match(chipScript, /setAxisSafeWidth\(width\)/);
  assert.match(chipScript, /measureAxisSafeWidth\(\)/);

  assert.match(chipScript, /function resolveReadout\(sessionDate\)/);
  assert.match(chipScript, /當日無資料/);
  assert.match(chipScript, /最近一筆/);
  assert.match(chipScript, /dataDate === sessionDate/);
  assert.match(chipScript, /className = "chip-pane-inline-readout"/);
  assert.doesNotMatch(chipScript, /className = "chip-pane-tooltip"/);
  assert.doesNotMatch(chipScript, /function renderTooltip/);
  assert.match(chipScript, /function formatSigned\(value/);
  assert.match(chipScript, /directionFor\(number\)/);
  assert.match(chipScript, /function seriesColorForReadout\(definition, seriesId\)/);
  assert.match(chipScript, /labelNode\.className = "chip-readout-label"/);
  assert.match(chipScript, /valueNode\.className = "chip-readout-value"/);
  assert.match(chipScript, /node\.style\.setProperty\("--readout-series-color", seriesColor\)/);
  assert.doesNotMatch(chipScript, /node\.classList\.add\(`is-\$\{item\.direction\}`\)/);
  assert.match(chipScript, /trendSegment\(sessionDate, "變化"/);
  assert.match(chipScript, /showArrow: number !== null && previous !== null/);
  assert.match(chipScript, /directionalSegment\("持股", exact\.lotsChange/);
  assert.doesNotMatch(chipScript, /className = "chip-pane-details"/);

  assert.match(styles, /--mode-b-technical-height: 104px/);
  assert.match(styles, /\.subchart-slot\.is-mode-b \.indicator-wrap\s*\{[^}]*display: grid;[^}]*grid-template-rows: auto minmax\(0, 1fr\);/s);
  assert.match(styles, /\.chart-grid\.is-mode-b-page-scroll \.chip-pane\s*\{[^}]*height: auto;[^}]*min-height: 96px;/s);
  assert.match(styles, /\.chart-grid\.is-mode-b-page-scroll \.chip-pane-chart\s*\{[^}]*min-height: 64px;/s);
  assert.match(styles, /\.chip-pane-header\s*\{[^}]*min-height: 24px;/s);
  assert.doesNotMatch(styles, /\.chip-pane-tooltip/);
});

test("籌碼資料提示位於副圖尾端且提供可關閉控制", async () => {
  const [appScript, chipScript, styles] = await Promise.all([
    readFile(new URL("../public/static/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/static/chip-panes.js", import.meta.url), "utf8"),
    readFile(new URL("../public/static/styles.css", import.meta.url), "utf8"),
  ]);
  const stackIndex = indexHtml.indexOf('class="chip-pane-stack"');
  const noticeIndex = indexHtml.indexOf('class="chip-pane-notice"');
  assert.ok(stackIndex >= 0 && noticeIndex > stackIndex);
  assert.match(indexHtml, /class="chip-pane-notice" role="status" aria-live="polite" hidden/);
  assert.match(indexHtml, /class="chip-pane-notice-close" aria-label="關閉籌碼資料提示"[^>]*data-export-exclude="true"/);
  assert.match(appScript, /notice: chipPaneNotice/);
  assert.match(appScript, /noticeClose: chipPaneNoticeClose/);
  assert.match(chipScript, /options\.noticeClose\?\.addEventListener\("click", closeNotice\)/);
  assert.match(chipScript, /warningNoticeSignature\(context, warningText\)/);
  assert.match(chipScript, /dismissedNoticeSignature = currentNoticeSignature/);
  assert.match(styles, /\.chip-pane-notice\s*\{[^}]*display: flex;[^}]*border-top:/s);
  assert.match(styles, /\.subchart-slot\.is-mode-a-chip \.chip-pane-region\s*\{[^}]*display: flex;[^}]*flex-direction: column;/s);
  assert.doesNotMatch(styles, /\.subchart-slot\.is-mode-a-chip \.chip-pane-(?:empty|notice)[^{]*\{[^}]*position: absolute;/s);
});

test("頂端工具列縮窄台股來源並將顯示控制群組固定在最右側", async () => {
  const styles = await readFile(new URL("../public/static/styles.css", import.meta.url), "utf8");

  assert.match(indexHtml, /class="source-mode-control source-mode-primary"/);
  assert.match(indexHtml, /class="display-controls" aria-label="圖表顯示設定"[\s\S]*class="chart-count-control"[\s\S]*class="chip-mode-control"/);
  assert.match(styles, /\.source-mode-primary select\s*\{[^}]*width: 120px;[^}]*min-width: 120px;[^}]*max-width: 120px;/s);
  assert.match(styles, /\.display-controls\s*\{[^}]*display: inline-flex;[^}]*margin-left: auto;[^}]*flex: 0 0 auto;/s);
  assert.match(styles, /\.market-tabs\s*\{[^}]*overflow: visible;/s);
});
