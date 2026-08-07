import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  acquireCandleHistory,
  candleHistoryIdentity,
  candleHistoryKey,
  candleHistoryTtlSeconds,
  changedCandleHistoryTail,
  clearCandleHistoryRuntimeState,
  isStructurallyValidCandle,
  mergeCandleHistory,
  readCandleHistory,
  requiredCandleHistoryRows,
  shouldPersistCandleHistory,
  upsertCandleHistory,
  withCandleHistorySingleFlight,
} from "../worker/candle-history.ts";
import { SqliteD1, applyDrizzleSql } from "./helpers/sqlite-d1.mjs";

const migration = await readFile(new URL("../drizzle/0009_gorgeous_rachel_grey.sql", import.meta.url), "utf8");
const stateMigration = await readFile(new URL("../drizzle/0021_bumpy_bruce_banner.sql", import.meta.url), "utf8");
const indexHtml = await readFile(new URL("../public/static/index.html", import.meta.url), "utf8");
const stockSetup = await readFile(new URL("../public/data/stock_setup.md", import.meta.url), "utf8");

async function builtWorker(label) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("history-test", `${label}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

function workerEnvironment(db) {
  return {
    DB: db,
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

const workerContext = { waitUntil() {}, passThroughOnException() {} };

function yahooChartFixture(count = 500) {
  const start = Math.floor(Date.parse("2024-01-01T00:00:00Z") / 1000);
  const timestamp = Array.from({ length: count }, (_, index) => start + index * 86400);
  const close = timestamp.map((_, index) => 100 + index);
  return {
    chart: {
      result: [{
        timestamp,
        indicators: { quote: [{
          open: close.map((value) => value - 1),
          high: close.map((value) => value + 2),
          low: close.map((value) => value - 2),
          close,
          volume: close.map((value) => value * 100),
        }] },
        meta: { regularMarketTime: timestamp.at(-1), marketState: "CLOSED", exchangeTimezoneName: "America/New_York" },
      }],
    },
  };
}

function candle(time, close = time, extra = {}) {
  return { time, open: close - 1, high: close + 1, low: close - 2, close, volume: close * 10, ...extra };
}

function candles(count, start = 1) {
  return Array.from({ length: count }, (_, index) => candle(start + index));
}

test("candle_history migration 建立必要欄位、唯一鍵與 lookup index，重跑仍安全", async () => {
  const db = new SqliteD1();
  try {
    applyDrizzleSql(db, migration);
    applyDrizzleSql(db, migration);

    const columns = db.database.prepare("PRAGMA table_info(candle_history)").all();
    assert.deepEqual(columns.map((row) => row.name), [
      "provider", "symbol", "interval", "time", "open", "high", "low", "close", "volume",
      "quote_time", "source", "source_updated_at", "market_session", "source_time_zone", "fetched_at", "updated_at",
    ]);
    assert.deepEqual(columns.filter((row) => row.pk).map((row) => row.name), ["provider", "symbol", "interval", "time"]);

    const indexes = db.database.prepare("PRAGMA index_list(candle_history)").all();
    assert.equal(indexes.some((row) => row.name === "candle_history_lookup_idx"), true);

    const insert = "INSERT INTO candle_history (provider,symbol,interval,time,open,high,low,close,volume,source) VALUES (?,?,?,?,?,?,?,?,?,?)";
    db.database.prepare(insert).run("yfinance", "2330.TW", "1d", 1, 1, 2, 0.5, 1.5, 10, "yahoo-chart");
    assert.throws(
      () => db.database.prepare(insert).run("yfinance", "2330.TW", "1d", 1, 2, 3, 1, 2.5, 20, "yahoo-chart"),
      /UNIQUE constraint failed/,
    );
  } finally {
    db.close();
  }
});

test("candle_history_state 記住短歷史已完成 full window，跨帳戶只做共享 tail／coverage hit", async () => {
  const db = new SqliteD1();
  applyDrizzleSql(db, migration);
  applyDrizzleSql(db, stateMigration);
  clearCandleHistoryRuntimeState();
  let calls = 0;
  const modes = [];
  const fetcher = async ({ mode }) => {
    calls += 1;
    modes.push(mode);
    return { rows: candles(77), source: "yahoo-chart" };
  };
  try {
    const first = await acquireCandleHistory({
      db, provider: "yfinance", symbol: "009819.TW", interval: "1d", displayCount: 160,
      fetcher, coverageComplete: () => false, now: new Date("2026-07-31T06:00:00Z"),
    });
    assert.equal(first.rows.length, 77);
    assert.equal(first.cache.fullWindowComplete, true);
    assert.deepEqual(modes, ["full"]);

    clearCandleHistoryRuntimeState();
    const sharedComplete = await acquireCandleHistory({
      db, provider: "yfinance", symbol: "009819.TW", interval: "1d", displayCount: 160,
      fetcher, coverageComplete: () => true, now: new Date("2026-07-31T07:00:00Z"),
    });
    assert.equal(sharedComplete.cache.state, "hit");
    assert.equal(sharedComplete.cache.store, "d1");
    assert.equal(calls, 1);

    clearCandleHistoryRuntimeState();
    const tailOnly = await acquireCandleHistory({
      db, provider: "yfinance", symbol: "009819.TW", interval: "1d", displayCount: 160,
      fetcher, coverageComplete: () => false, now: new Date("2026-07-31T08:00:00Z"),
    });
    assert.equal(tailOnly.cache.state, "refreshed");
    assert.deepEqual(modes, ["full", "tail"]);
  } finally {
    db.close();
    clearCandleHistoryRuntimeState();
  }
});

test("台股 Yahoo 當日 close 空缺時以官方 OHLCV 補成共享 K 棒，下一帳戶不重抓", async () => {
  const db = new SqliteD1();
  const originalFetch = globalThis.fetch;
  const priorTime = Date.parse("2026-07-30T01:00:00Z") / 1000;
  const sourceQuoteTime = Date.parse("2026-07-31T05:30:00Z") / 1000;
  let yahooCalls = 0;
  let officialCalls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "query1.finance.yahoo.com") {
      yahooCalls += 1;
      return Response.json({ chart: { result: [{
        timestamp: [priorTime, Date.parse("2026-07-31T01:00:00Z") / 1000],
        meta: { regularMarketTime: sourceQuoteTime, marketState: "CLOSED", exchangeTimezoneName: "Asia/Taipei" },
        indicators: { quote: [{ open: [3865, 4000], high: [4030, 4080], low: [3670, 3880], close: [3715, null], volume: [2728418, 2970845] }] },
      }] } });
    }
    if (url.hostname === "www.twse.com.tw") {
      officialCalls += 1;
      assert.equal(url.searchParams.get("date"), "20260731");
      return Response.json({
        date: "20260731", stat: "OK",
        tables: [{
          fields: ["證券代號", "證券名稱", "成交股數", "開盤價", "最高價", "最低價", "收盤價"],
          data: [["3008", "大立光", "2,970,845", "4,000.00", "4,080.00", "3,880.00", "4,035.00"]],
        }],
      });
    }
    throw new Error(`unexpected upstream ${url}`);
  };
  try {
    const env = workerEnvironment(db);
    const firstService = await builtWorker("official-tail-first-account");
    const first = await (await firstService.fetch(new Request("http://localhost/api/candles?symbol=3008.TW&interval=1d&display_count=20"), env, workerContext)).json();
    assert.equal(first.quote.sessionDate, "2026-07-31");
    assert.equal(first.candles.at(-1).close, 4035);
    assert.equal(first.candles.at(-1).volume, 2970845);
    assert.equal(first.dataWindow.cache.fullWindowComplete, true);
    assert.deepEqual({ yahooCalls, officialCalls }, { yahooCalls: 1, officialCalls: 1 });

    clearCandleHistoryRuntimeState();
    const secondService = await builtWorker("official-tail-second-account");
    const second = await (await secondService.fetch(new Request("http://localhost/api/candles?symbol=3008.TW&interval=1d&display_count=21"), env, workerContext)).json();
    assert.equal(second.quote.sessionDate, "2026-07-31");
    assert.equal(second.candles.at(-1).close, 4035);
    assert.equal(second.dataWindow.cache.store, "d1");
    assert.deepEqual({ yahooCalls, officialCalls }, { yahooCalls: 1, officialCalls: 1 });
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
    clearCandleHistoryRuntimeState();
  }
});

test("history key、持久化週期、TTL 與 required rows 不依賴 display_count 身分", () => {
  assert.deepEqual(candleHistoryIdentity("yahoo-chart", " 2330.tw ", "1d"), { provider: "yfinance", symbol: "2330.TW", interval: "1d" });
  assert.equal(candleHistoryKey("yfinance", "2330.tw", "1d"), "yfinance|2330.TW|1d");
  assert.equal(shouldPersistCandleHistory("yahoo-chart", "1d"), true);
  assert.equal(shouldPersistCandleHistory("yfinance", "1wk"), true);
  assert.equal(shouldPersistCandleHistory("yfinance", "1m"), false);
  assert.equal(candleHistoryTtlSeconds("1m"), 30);
  assert.equal(candleHistoryTtlSeconds("1d"), 900);
  assert.equal(candleHistoryTtlSeconds("1mo"), 21600);
  assert.equal(requiredCandleHistoryRows("2330.TW", "1d", 160), 285);
  assert.equal(requiredCandleHistoryRows("AAPL", "1d", 320), 440);
  assert.equal(requiredCandleHistoryRows("AAPL", "1d", 99999), 1720);
});

test("merge 依 time 去重排序，incoming 覆蓋同 time 尾端資料", () => {
  const merged = mergeCandleHistory(
    [candle(2, 2), candle(1, 1), { ...candle(9), close: Number.NaN }],
    [candle(2, 20, { quoteTime: 22, sourceUpdatedAt: "new" }), candle(3, 3)],
  );
  assert.deepEqual(merged.map((row) => row.time), [1, 2, 3]);
  assert.equal(merged[1].close, 20);
  assert.equal(merged[1].quoteTime, 22);
  assert.equal(merged[1].sourceUpdatedAt, "new");
});

test("K 線結構驗證拒絕空值轉零、零價、負量與不一致 OHLC，並保留合法負價格", () => {
  const malformed = [
    { ...candle(4, 4), open: null },
    { time: 5, open: 0, high: 0, low: 0, close: 103.04, volume: 0 },
    { time: 6, open: 0, high: 0, low: 0, close: 0, volume: 10 },
    { ...candle(7, 7), volume: -1 },
    { time: 8, open: 10, high: 9, low: 8, close: 10, volume: 10 },
  ];
  for (const row of malformed) assert.equal(isStructurallyValidCandle(row), false);
  const negativePrice = { time: 9, open: -5, high: -2, low: -10, close: -7, volume: 10 };
  assert.equal(isStructurallyValidCandle(negativePrice), true);
  assert.deepEqual(
    mergeCandleHistory([], [...malformed, negativePrice]).map((row) => row.time),
    [9],
  );
});

test("Yahoo 上游的不完整 OHLC 在寫入歷史及 API 輸出前就會被拒絕", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ chart: { result: [{
    timestamp: [1, 2, 3],
    meta: { regularMarketTime: 3, marketState: "CLOSED", exchangeTimezoneName: "America/New_York" },
    indicators: { quote: [{
      open: [100, 0, 102], high: [102, 0, 104], low: [99, 0, 101], close: [101, 103.04, 103], volume: [1000, 0, 1200],
    }] },
  }] } });
  try {
    const service = await builtWorker("invalid-upstream-ohlc");
    const response = await service.fetch(
      new Request("http://localhost/api/candles?symbol=AAPL&interval=1d&display_count=20"),
      workerEnvironment(undefined),
      workerContext,
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.candles.map((row) => row.time), [1, 3]);
    assert.equal(payload.candles.some((row) => row.open === 0 && row.high === 0 && row.low === 0), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("merge 保留官方收盤 K 棒，不被盤中 MIS 或 Yahoo 覆蓋", () => {
  const official = { ...candle(2, 20), source: "twse-official" };
  assert.equal(mergeCandleHistory([official], [{ ...candle(2, 19), source: "twse-mis" }])[0].close, 20);
  assert.equal(mergeCandleHistory([official], [{ ...candle(2, 18), source: "yahoo-chart" }])[0].close, 20);
  assert.equal(mergeCandleHistory([{ ...candle(2, 18), source: "yahoo-chart" }], [{ ...candle(2, 19), source: "twse-mis" }])[0].close, 19);
  assert.equal(mergeCandleHistory([{ ...candle(2, 19), source: "twse-mis" }], [official])[0].close, 20);
});

test("changed tail 只保留新增或變動 K 棒，完全相同時僅刷新最新一筆 freshness", () => {
  const existing = candles(5);
  assert.deepEqual(changedCandleHistoryTail(existing, [candle(4), candle(5)]).map((row) => row.time), [5]);
  assert.deepEqual(changedCandleHistoryTail(existing, [candle(4, 400), candle(5), candle(6)]).map((row) => row.time), [4, 6]);
  assert.deepEqual(changedCandleHistoryTail(existing, []), []);
});

test("D1 repository 分批 upsert、覆蓋同 time 並依時間讀回", async () => {
  const db = new SqliteD1();
  applyDrizzleSql(db, migration);
  const identity = candleHistoryIdentity("yfinance", "AAPL", "1d");
  try {
    const initial = await upsertCandleHistory(db, identity, candles(161), "yahoo-chart", new Date("2026-07-18T00:00:00Z"));
    assert.deepEqual(initial, { ok: true, rows: 161 });
    const correction = await upsertCandleHistory(db, identity, [candle(161, 999, { quoteTime: 123 })], "yahoo-chart", new Date("2026-07-18T00:10:00Z"));
    assert.deepEqual(correction, { ok: true, rows: 1 });
    assert.equal(db.database.prepare("SELECT COUNT(*) AS rows FROM candle_history").get().rows, 161);

    const read = await readCandleHistory(db, identity, 3);
    assert.equal(read.ok, true);
    assert.deepEqual(read.rows.map((row) => row.time), [159, 160, 161]);
    assert.equal(read.rows.at(-1).close, 999);
    assert.equal(read.rows.at(-1).quoteTime, 123);
    assert.equal(read.fetchedAt, Date.parse("2026-07-18T00:10:00Z") / 1000);
  } finally {
    db.close();
  }
});

test("single-flight 合併同 key 最大 required rows，不同 key 可並行", async () => {
  const inflight = new Map();
  let sameKeyCalls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const task = (required) => withCandleHistorySingleFlight(inflight, "same", required, async (maximum) => {
    sameKeyCalls += 1;
    await gate;
    return maximum();
  });
  const first = task(280);
  const second = task(445);
  release();
  assert.deepEqual(await Promise.all([first, second]), [445, 445]);
  assert.equal(sameKeyCalls, 1);

  let active = 0;
  let maximumActive = 0;
  const run = (key) => withCandleHistorySingleFlight(inflight, key, 1, async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return key;
  });
  assert.deepEqual(await Promise.all([run("A"), run("B")]), ["A", "B"]);
  assert.equal(maximumActive, 2);
});

test("acquisition 首次 backfill、跨 display_count 共用、清除 memory 後 D1 hit", async () => {
  const db = new SqliteD1();
  applyDrizzleSql(db, migration);
  clearCandleHistoryRuntimeState();
  let calls = 0;
  const fetcher = async ({ requiredRows }) => {
    calls += 1;
    return { rows: candles(Math.max(500, requiredRows)), source: "yahoo-chart" };
  };
  try {
    const first = await acquireCandleHistory({ db, provider: "yfinance", symbol: "AAPL", interval: "1d", displayCount: 160, fetcher, now: new Date("2026-07-18T00:00:00Z") });
    assert.equal(first.cache.state, "backfilled");
    assert.equal(first.cache.persistent, true);
    const larger = await acquireCandleHistory({ db, provider: "yfinance", symbol: "AAPL", interval: "1d", displayCount: 320, fetcher, now: new Date("2026-07-18T00:01:00Z") });
    assert.equal(larger.cache.state, "hit");
    assert.equal(calls, 1);

    clearCandleHistoryRuntimeState();
    const afterRestart = await acquireCandleHistory({ db, provider: "yfinance", symbol: "AAPL", interval: "1d", displayCount: 320, fetcher, now: new Date("2026-07-18T00:02:00Z") });
    assert.equal(afterRestart.cache.state, "hit");
    assert.equal(afterRestart.cache.store, "d1");
    assert.equal(calls, 1);
  } finally {
    db.close();
    clearCandleHistoryRuntimeState();
  }
});

test("acquisition 過期時刷新尾端，上游失敗則回 stale history", async () => {
  const db = new SqliteD1();
  applyDrizzleSql(db, migration);
  const identity = candleHistoryIdentity("yfinance", "AAPL", "1d");
  await upsertCandleHistory(db, identity, candles(300), "yahoo-chart", new Date("2026-07-18T00:00:00Z"));
  clearCandleHistoryRuntimeState();
  try {
    const refreshed = await acquireCandleHistory({
      db, provider: "yfinance", symbol: "AAPL", interval: "1d", displayCount: 160, now: new Date("2026-07-18T00:20:00Z"),
      fetcher: async ({ mode }) => ({ rows: [candle(300, 999)], source: `yahoo-${mode}` }),
    });
    assert.equal(refreshed.cache.state, "refreshed");
    assert.equal(refreshed.rows.at(-1).close, 999);

    clearCandleHistoryRuntimeState();
    const stale = await acquireCandleHistory({
      db, provider: "yfinance", symbol: "AAPL", interval: "1d", displayCount: 160, now: new Date("2026-07-18T01:00:00Z"),
      fetcher: async () => { throw new Error("upstream secret details"); },
    });
    assert.equal(stale.freshness, "stale");
    assert.equal(stale.cache.state, "stale");
    assert.equal(stale.cache.reason, "provider_unavailable");
    assert.equal(JSON.stringify(stale).includes("secret details"), false);
  } finally {
    db.close();
    clearCandleHistoryRuntimeState();
  }
});

test("acquisition 過期但尾端未變時不重寫整段 history", async () => {
  const db = new SqliteD1();
  applyDrizzleSql(db, migration);
  const identity = candleHistoryIdentity("yfinance", "AAPL", "1d");
  await upsertCandleHistory(db, identity, candles(300), "yahoo-chart", new Date("2026-07-18T00:00:00Z"));
  clearCandleHistoryRuntimeState();
  try {
    const refreshed = await acquireCandleHistory({
      db, provider: "yfinance", symbol: "AAPL", interval: "1d", displayCount: 160, now: new Date("2026-07-18T00:20:00Z"),
      fetcher: async ({ mode }) => ({ rows: candles(5, 296), source: `yahoo-${mode}` }),
    });
    assert.equal(refreshed.cache.state, "refreshed");
    assert.equal(db.database.prepare("SELECT COUNT(*) AS rows FROM candle_history").get().rows, 300);
    assert.equal(db.database.prepare("SELECT fetched_at FROM candle_history WHERE time=299").get().fetched_at, "2026-07-18T00:00:00.000Z");
    assert.equal(db.database.prepare("SELECT fetched_at FROM candle_history WHERE time=300").get().fetched_at, "2026-07-18T00:20:00.000Z");
  } finally {
    db.close();
    clearCandleHistoryRuntimeState();
  }
});

test("D1 write failure 不阻斷合法上游資料並回 write_failed", async () => {
  clearCandleHistoryRuntimeState();
  const brokenDb = { prepare() { throw new Error("database internals"); }, async batch() { throw new Error("database internals"); } };
  const result = await acquireCandleHistory({
    db: brokenDb, provider: "yfinance", symbol: "MSFT", interval: "1d", displayCount: 160, now: new Date("2026-07-18T00:00:00Z"),
    fetcher: async () => ({ rows: candles(300), source: "yahoo-chart" }),
  });
  assert.equal(result.cache.state, "write_failed");
  assert.equal(result.rows.length, 300);
  assert.equal(JSON.stringify(result).includes("database internals"), false);
  clearCandleHistoryRuntimeState();
});

test("Worker `/api/candles` 跨 display_count 共用 history，重新載入 Worker 後命中 D1", async () => {
  const db = new SqliteD1();
  const originalFetch = globalThis.fetch;
  let yahooCalls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "query1.finance.yahoo.com" && url.pathname.includes("/v8/finance/chart/")) {
      yahooCalls += 1;
      return Response.json(yahooChartFixture());
    }
    throw new Error(`unexpected upstream ${url}`);
  };
  try {
    const firstService = await builtWorker("first");
    const env = workerEnvironment(db);
    const firstResponse = await firstService.fetch(new Request("http://localhost/api/candles?symbol=AAPL&interval=1d&display_count=20"), env, workerContext);
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    assert.equal(first.dataWindow.cache.state, "backfilled");
    assert.equal(first.dataWindow.cache.persistent, true);
    assert.equal(first.candles.length, 20);

    const larger = await (await firstService.fetch(new Request("http://localhost/api/candles?symbol=AAPL&interval=1d&display_count=320"), env, workerContext)).json();
    assert.equal(larger.candles.length, 320);
    assert.equal(larger.dataWindow.cache.state, "hit");
    assert.equal(larger.dataWindow.cache.store, "worker-memory");
    assert.equal(yahooCalls, 1);
    assert.equal(new Set(larger.candles.map((row) => row.time)).size, larger.candles.length);
    assert.equal(larger.dataWindow.displayFrom, larger.candles[0].time);
    assert.equal(larger.dataWindow.displayTo, larger.candles.at(-1).time);
    assert.equal(larger.indicators.moving_average.ma20.at(-1).time, larger.candles.at(-1).time);

    const nextService = await builtWorker("next-isolate");
    const afterRestart = await (await nextService.fetch(new Request("http://localhost/api/candles?symbol=AAPL&interval=1d&display_count=321"), env, workerContext)).json();
    assert.equal(afterRestart.dataWindow.cache.state, "hit");
    assert.equal(afterRestart.dataWindow.cache.store, "d1");
    assert.equal(afterRestart.dataWindow.cache.historyStore, "candle_history");
    assert.equal(yahooCalls, 1);
    assert.equal(db.database.prepare("SELECT COUNT(*) AS rows FROM candle_history WHERE provider='yfinance' AND symbol='AAPL' AND interval='1d'").get().rows, 500);

    const streamResponse = await nextService.fetch(new Request("http://localhost/api/stream?symbol=AAPL&interval=1d"), env, workerContext);
    const reader = streamResponse.body.getReader();
    let buffer = "";
    while ((buffer.match(/\n\n/g) || []).length < 2) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += new TextDecoder().decode(chunk.value, { stream: true });
    }
    await reader.cancel();
    const events = buffer.trim().split("\n\n").map((block) => JSON.parse(block.replace(/^data:\s*/, "")));
    assert.equal(events[0].type, "status");
    assert.equal(events[1].type, "candle");
    assert.equal(events[1].candle.time, afterRestart.candles.at(-1).time);
    assert.equal(events[1].quote.freshness, "fresh");
    assert.equal(yahooCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("Worker 以部分 D1 history 補回完整 window，且只呼叫一次上游", async () => {
  const db = new SqliteD1();
  applyDrizzleSql(db, migration);
  const identity = candleHistoryIdentity("yfinance", "AAPL", "1d");
  await upsertCandleHistory(db, identity, candles(100), "yahoo-chart", new Date("2026-07-18T00:00:00Z"));
  const originalFetch = globalThis.fetch;
  let yahooCalls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "query1.finance.yahoo.com") {
      yahooCalls += 1;
      return Response.json(yahooChartFixture(500));
    }
    throw new Error(`unexpected upstream ${url}`);
  };
  try {
    const service = await builtWorker("partial-backfill");
    const response = await service.fetch(new Request("http://localhost/api/candles?symbol=AAPL&interval=1d&display_count=320"), workerEnvironment(db), workerContext);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.dataWindow.cache.state, "backfilled");
    assert.equal(payload.dataWindow.cache.store, "d1");
    assert.equal(payload.candles.length, 320);
    assert.equal(yahooCalls, 1);
    assert.equal(db.database.prepare("SELECT COUNT(*) AS rows FROM candle_history WHERE provider='yfinance' AND symbol='AAPL' AND interval='1d'").get().rows, 600);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("Worker history 不足 warmup 時回傳合法實際資料，不補造 indicator rows", async () => {
  const db = new SqliteD1();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "query1.finance.yahoo.com") return Response.json(yahooChartFixture(100));
    throw new Error(`unexpected upstream ${url}`);
  };
  try {
    const service = await builtWorker("insufficient-warmup");
    const response = await service.fetch(new Request("http://localhost/api/candles?symbol=MSFT&interval=1d&display_count=160"), workerEnvironment(db), workerContext);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.candles.length, 100);
    assert.equal(payload.dataWindow.availableWarmupCandles, 0);
    assert.equal(payload.dataWindow.insufficientWarmup, true);
    assert.equal(payload.dataWindow.warmupStatus, "insufficient");
    assert.equal(payload.indicators.moving_average.ma120.length, 100);
    assert.equal(payload.indicators.moving_average.ma120.every((point) => point.value === null), true);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("Worker D1 history 過期且 Yahoo 失敗時回 stale，不洩漏上游錯誤", async () => {
  const db = new SqliteD1();
  applyDrizzleSql(db, migration);
  const identity = candleHistoryIdentity("yfinance", "AAPL", "1d");
  await upsertCandleHistory(db, identity, candles(300), "yahoo-chart", new Date("2020-01-01T00:00:00Z"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("upstream token secret-value"); };
  try {
    const service = await builtWorker("stale");
    const response = await service.fetch(new Request("http://localhost/api/candles?symbol=AAPL&interval=1d&display_count=20"), workerEnvironment(db), workerContext);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.quote.freshness, "stale");
    assert.equal(payload.dataWindow.cache.state, "stale");
    assert.equal(payload.dataWindow.cache.tailRefresh, "failed");
    assert.equal(JSON.stringify(payload).includes("secret-value"), false);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("Worker Yahoo 首次使用 full range、到期使用 tail range，並保留 Hyperliquid sample fallback", async () => {
  const db = new SqliteD1();
  const originalFetch = globalThis.fetch;
  const yahooRanges = [];
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "query1.finance.yahoo.com") {
      yahooRanges.push(url.searchParams.get("range"));
      return Response.json(yahooChartFixture());
    }
    if (url.hostname === "api.hyperliquid.xyz") throw new Error("hyperliquid unavailable");
    throw new Error(`unexpected upstream ${url}`);
  };
  try {
    const first = await builtWorker("full-range");
    const env = workerEnvironment(db);
    const firstPayload = await (await first.fetch(new Request("http://localhost/api/candles?symbol=AAPL&interval=1d&display_count=20"), env, workerContext)).json();
    assert.equal(firstPayload.dataWindow.cache.state, "backfilled");
    assert.deepEqual(yahooRanges, ["2y"]);

    db.database.prepare("UPDATE candle_history SET fetched_at='2020-01-01T00:00:00.000Z'").run();
    const refreshedService = await builtWorker("tail-range");
    const refreshed = await (await refreshedService.fetch(new Request("http://localhost/api/candles?symbol=AAPL&interval=1d&display_count=21"), env, workerContext)).json();
    assert.equal(refreshed.dataWindow.cache.state, "refreshed");
    assert.equal(refreshed.dataWindow.cache.tailRefresh, "success");
    assert.deepEqual(yahooRanges, ["2y", "5d"]);

    const crypto = await (await refreshedService.fetch(new Request("http://localhost/api/candles?symbol=BTC&interval=1d&display_count=20"), env, workerContext)).json();
    assert.equal(crypto.quote.sourceProvider, "sample");
    assert.equal(crypto.candles.length, 20);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("Sites frontend 保留 history window 擴張、停止條件與可視範圍位移 contract", async () => {
  const appScript = await readFile(new URL("../public/static/app.js", import.meta.url), "utf8");
  assert.match(appScript, /const HISTORY_LOAD_BATCH_BARS = 160/);
  assert.match(appScript, /display_count=\$\{encodeURIComponent\(nextDisplayCount\)\}/);
  assert.match(appScript, /if \(nextCount <= currentCount\) \{[\s\S]*?historyHasMoreBefore = false/);
  assert.match(appScript, /historyHasMoreBefore = Boolean\(payload\.dataWindow\?\.hasMoreBefore\)/);
  assert.match(appScript, /const preparedPayload = preparePanelPayload\(payload\);[\s\S]*?applyPayload\(preparedPayload, \{ prepared: true, preserveVisibleLogicalRange, oldCandleCount: currentCount \}\);[\s\S]*?writePanelPayloadCache\(symbol, interval, preparedPayload, pivotMode\)/);
  assert.match(appScript, /const addedCandles = Math\.max\(0, newCandleCount - oldCandleCount\)/);
  assert.match(appScript, /setSynchronizedVisibleLogicalRange\(preservedRange\)/);
});
