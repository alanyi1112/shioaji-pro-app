import assert from "node:assert/strict";
import test from "node:test";
import { mergeCandleHistory } from "../worker/candle-history.ts";
import {
  auditTaiwanDailyContinuity,
  cacheTaiwanOfficialMonthPayload,
  clearTaiwanDailyContinuityRuntimeState,
  fetchTaiwanOfficialMonth,
  officialMonthKey,
  parseTpexOfficialMonth,
  parseTwseOfficialMonth,
  taiwanSessionDate,
} from "../worker/taiwan-daily-continuity.ts";
import { SqliteD1 } from "./helpers/sqlite-d1.mjs";
import {
  LARGAN_AUGUST_2026_MISSING_ROWS,
  larganGapHistoryFixture,
  taipeiSessionTime,
} from "./fixtures/daily-candle-continuity.mjs";

function twseMonthPayload(rows = LARGAN_AUGUST_2026_MISSING_ROWS) {
  return {
    stat: "OK",
    date: "20260801",
    title: "115年08月 3008 大立光 各日成交資訊",
    fields: ["日期", "成交股數", "成交金額", "開盤價", "最高價", "最低價", "收盤價", "漲跌價差", "成交筆數", "註記"],
    data: rows.map((row) => [
      `${Number(row.sessionDate.slice(0, 4)) - 1911}/${row.sessionDate.slice(5, 7)}/${row.sessionDate.slice(8, 10)}`,
      row.volume.toLocaleString("en-US"), "1,000", row.open.toFixed(2), row.high.toFixed(2), row.low.toFixed(2), row.close.toFixed(2), "0.00", "1", "",
    ]),
  };
}

function historyRow(sessionDate, close = 100) {
  return { time: taipeiSessionTime(sessionDate), open: close - 1, high: close + 1, low: close - 2, close, volume: 1000, source: "yahoo-chart", sourceTimeZone: "Asia/Taipei" };
}

test("TWSE 與 TPEx 月資料 parser 正規化民國日期、OHLCV 與成交量單位", () => {
  const twse = parseTwseOfficialMonth(twseMonthPayload(), "3008.TW", "2026-08-28T08:00:00.000Z");
  assert.equal(twse.length, 10);
  assert.equal(taiwanSessionDate(twse[0]), "2026-08-03");
  assert.deepEqual({ open: twse[0].open, high: twse[0].high, low: twse[0].low, close: twse[0].close, volume: twse[0].volume, source: twse[0].source }, {
    open: 3970, high: 4030, low: 3910, close: 3960, volume: 1846958, source: "twse-official",
  });

  const tpex = parseTpexOfficialMonth({
    stat: "ok", date: "20260801", code: "8069", tables: [{
      fields: ["日 期", "成交張數", "成交仟元", "開盤", "最高", "最低", "收盤", "漲跌", "筆數"],
      data: [["115/08/03", "7,399", "1,377,265", "186.00", "191.50", "179.00", "189.00", "0.00", "5,487"]],
    }],
  }, "8069.TWO", "2026-08-28T08:00:00.000Z");
  assert.equal(tpex.length, 1);
  assert.deepEqual({ date: taiwanSessionDate(tpex[0]), volume: tpex[0].volume, source: tpex[0].source }, { date: "2026-08-03", volume: 7399000, source: "tpex-official" });
});

test("受保護 runner 月資料寫入會重跑 parser、寫入 D1，後續稽核不再呼叫網路", async () => {
  clearTaiwanDailyContinuityRuntimeState();
  const db = new SqliteD1();
  db.exec("CREATE TABLE candle_cache (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  try {
    const now = new Date("2026-08-28T08:00:00.000Z");
    const cached = await cacheTaiwanOfficialMonthPayload({ db, symbol: "3008.TW", month: "2026-08", payload: twseMonthPayload(), now });
    assert.equal(cached.status, "available");
    assert.equal(cached.rows.length, 10);
    assert.equal(db.database.prepare("SELECT COUNT(*) AS rows FROM candle_cache WHERE cache_key=?").get(officialMonthKey("3008.TW", "2026-08")).rows, 1);

    clearTaiwanDailyContinuityRuntimeState();
    let networkCalls = 0;
    const reused = await fetchTaiwanOfficialMonth("3008.TW", "2026-08", {
      db,
      now: new Date("2026-08-28T08:01:00.000Z"),
      fetchImpl: async () => { networkCalls += 1; throw new Error("network_must_not_run"); },
    });
    assert.equal(reused.status, "available");
    assert.equal(reused.rows.length, 10);
    assert.equal(networkCalls, 0);
  } finally {
    db.close();
  }
});

test("受保護 runner 月資料拒絕非法商品與月份不符 payload，且不污染 D1", async () => {
  clearTaiwanDailyContinuityRuntimeState();
  const db = new SqliteD1();
  db.exec("CREATE TABLE candle_cache (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  try {
    await assert.rejects(() => cacheTaiwanOfficialMonthPayload({ db, symbol: "3008", month: "2026-08", payload: twseMonthPayload() }), /invalid_response/);
    await assert.rejects(() => cacheTaiwanOfficialMonthPayload({ db, symbol: "3008.TW", month: "2026-07", payload: twseMonthPayload() }), /invalid_response/);
    await assert.rejects(() => cacheTaiwanOfficialMonthPayload({ db, symbol: "00981A.TW", month: "2026-08", payload: twseMonthPayload() }), /invalid_response/);
    assert.equal(db.database.prepare("SELECT COUNT(*) AS rows FROM candle_cache").get().rows, 0);
  } finally {
    db.close();
  }
});

test("受保護 runner 月資料接受含單一字母尾碼的新 ETF", async () => {
  clearTaiwanDailyContinuityRuntimeState();
  const db = new SqliteD1();
  db.exec("CREATE TABLE candle_cache (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  try {
    const payload = { ...twseMonthPayload(), title: "115年08月 00981A 主動統一台股增長 各日成交資訊" };
    const cached = await cacheTaiwanOfficialMonthPayload({ db, symbol: "00981A.TW", month: "2026-08", payload });
    assert.equal(cached.status, "available");
    assert.equal(cached.symbol, "00981A.TW");
  } finally {
    db.close();
  }
});

test("大立光 rows 足夠且 full flag 為真時仍找出十個官方交易日缺口，修復後才 complete", async () => {
  clearTaiwanDailyContinuityRuntimeState();
  const fixture = larganGapHistoryFixture();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return Response.json(twseMonthPayload()); };
  const first = await auditTaiwanDailyContinuity({
    symbol: fixture.symbol, rows: fixture.rows, requiredRows: 285, expectedThrough: "2026-08-28", fetchImpl, now: new Date("2026-08-28T08:00:00Z"),
  });
  assert.equal(fixture.rows.length >= 285, true);
  assert.equal(fixture.state.fullWindowComplete, true);
  assert.equal(first.status, "partial");
  assert.equal(first.missingSessionCount, 10);
  assert.deepEqual(first.missingSessionDates, fixture.missingSessionDates);
  assert.deepEqual(first.repairRows.map(taiwanSessionDate), fixture.missingSessionDates);
  assert.equal(calls, 1);

  const repairedRows = mergeCandleHistory(fixture.rows, first.repairRows);
  const second = await auditTaiwanDailyContinuity({
    symbol: fixture.symbol, rows: repairedRows, requiredRows: 285, expectedThrough: "2026-08-28", fetchImpl, now: new Date("2026-08-28T08:01:00Z"),
  });
  assert.equal(second.status, "complete");
  assert.equal(second.missingSessionCount, 0);
  assert.equal(second.verifiedThrough, "2026-08-28");
  assert.equal(calls, 1);
});

test("官方月資料沒有候選平日 row 時視為合法排除，不補造休市或停牌 candle", async () => {
  clearTaiwanDailyContinuityRuntimeState();
  const rows = [historyRow("2026-08-03"), historyRow("2026-08-05")];
  const payload = twseMonthPayload([
    { sessionDate: "2026-08-03", open: 100, high: 101, low: 99, close: 100, volume: 1000 },
    { sessionDate: "2026-08-05", open: 100, high: 101, low: 99, close: 100, volume: 1000 },
  ]);
  const result = await auditTaiwanDailyContinuity({ symbol: "3008.TW", rows, requiredRows: 2, expectedThrough: "2026-08-05", fetchImpl: async () => Response.json(payload), now: new Date("2026-08-05T08:00:00Z") });
  assert.equal(result.status, "complete");
  assert.deepEqual(result.excludedSessionDates, ["2026-08-04"]);
  assert.deepEqual(result.repairRows, []);
});

test("週末與 requested scope 以前的上市前日期不形成候選缺口", async () => {
  clearTaiwanDailyContinuityRuntimeState();
  let calls = 0;
  const result = await auditTaiwanDailyContinuity({
    symbol: "3008.TW",
    rows: [historyRow("2026-08-07"), historyRow("2026-08-10")],
    requiredRows: 2,
    expectedThrough: "2026-08-10",
    fetchImpl: async () => { calls += 1; return Response.json(twseMonthPayload()); },
    now: new Date("2026-08-10T08:00:00Z"),
  });
  assert.equal(result.status, "complete");
  assert.equal(calls, 0);
  assert.deepEqual(result.missingSessionDates, []);
});

test("官方整月尚未發布時維持 unknown，不把空 response 當休市證據", async () => {
  clearTaiwanDailyContinuityRuntimeState();
  const result = await auditTaiwanDailyContinuity({
    symbol: "3008.TW",
    rows: [historyRow("2026-08-03"), historyRow("2026-08-05")],
    requiredRows: 2,
    expectedThrough: "2026-08-05",
    fetchImpl: async () => Response.json({ stat: "OK", date: "20260801", fields: [], data: [] }),
    now: new Date("2026-08-05T08:00:00Z"),
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.reasonCode, "reference_not_published");
  assert.deepEqual(result.excludedSessionDates, []);
});

test("官方端點失敗最多重試一次並 fail closed 為 unknown", async () => {
  clearTaiwanDailyContinuityRuntimeState();
  let calls = 0;
  const result = await auditTaiwanDailyContinuity({
    symbol: "3008.TW",
    rows: [historyRow("2026-08-03"), historyRow("2026-08-05")],
    requiredRows: 2,
    expectedThrough: "2026-08-05",
    fetchImpl: async () => { calls += 1; return new Response("upstream", { status: 503 }); },
    now: new Date("2026-08-05T08:00:00Z"),
  });
  assert.equal(calls, 2);
  assert.equal(result.status, "unknown");
  assert.equal(result.reasonCode, "provider_unavailable");
  assert.deepEqual(result.repairRows, []);
});

test("同 symbol／month 並行稽核共用 single-flight", async () => {
  clearTaiwanDailyContinuityRuntimeState();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    await Promise.resolve();
    return Response.json(twseMonthPayload());
  };
  const input = { symbol: "3008.TW", rows: [historyRow("2026-08-03"), historyRow("2026-08-05")], requiredRows: 2, expectedThrough: "2026-08-05", fetchImpl, now: new Date("2026-08-05T08:00:00Z") };
  const [first, second] = await Promise.all([auditTaiwanDailyContinuity(input), auditTaiwanDailyContinuity(input)]);
  assert.equal(calls, 1);
  assert.equal(first.missingSessionCount, second.missingSessionCount);
});

test("長區間每次最多六個官方網路請求，後續稽核利用月快取續跑至 complete", async () => {
  clearTaiwanDailyContinuityRuntimeState();
  const monthRows = [
    ["2026-01-05", "2026-01-07"],
    ["2026-02-02", "2026-02-04"],
    ["2026-03-02", "2026-03-04"],
    ["2026-04-06", "2026-04-08"],
    ["2026-05-04", "2026-05-06"],
    ["2026-06-01", "2026-06-03"],
    ["2026-07-06", "2026-07-08"],
  ];
  const rows = monthRows.flatMap((dates) => dates.map((date) => historyRow(date)));
  let calls = 0;
  let activeCalls = 0;
  let maximumActiveCalls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    activeCalls += 1;
    maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
    await new Promise((resolve) => setTimeout(resolve, 2));
    activeCalls -= 1;
    const month = new URL(url).searchParams.get("date").slice(0, 6);
    const dates = monthRows[Number(month.slice(4, 6)) - 1];
    return Response.json({
      stat: "OK",
      date: `${month}01`,
      fields: ["日期", "成交股數", "開盤價", "最高價", "最低價", "收盤價"],
      data: dates.map((date) => [
        `${Number(date.slice(0, 4)) - 1911}/${date.slice(5, 7)}/${date.slice(8, 10)}`,
        "1,000", "99", "101", "98", "100",
      ]),
    });
  };
  const input = {
    symbol: "3008.TW",
    rows,
    requiredRows: rows.length,
    expectedThrough: "2026-07-08",
    fetchImpl,
    now: new Date("2026-07-08T08:00:00Z"),
  };

  const first = await auditTaiwanDailyContinuity(input);
  assert.equal(first.status, "unknown");
  assert.equal(first.reasonCode, "audit_request_budget");
  assert.equal(first.officialRequests, 6);
  assert.equal(calls, 6);
  assert.equal(maximumActiveCalls, 2);

  const second = await auditTaiwanDailyContinuity({ ...input, now: new Date("2026-07-08T08:01:00Z") });
  assert.equal(second.status, "complete");
  assert.equal(second.verifiedThrough, "2026-07-08");
  assert.equal(second.officialRequests, 1);
  assert.equal(calls, 7);

  clearTaiwanDailyContinuityRuntimeState();
  calls = 0;
  maximumActiveCalls = 0;
  const boundedFirst = await auditTaiwanDailyContinuity({ ...input, maxOfficialMonths: 4 });
  assert.equal(boundedFirst.status, "unknown");
  assert.equal(boundedFirst.reasonCode, "audit_request_budget");
  assert.equal(boundedFirst.officialRequests, 4);
  assert.equal(calls, 4);
  const boundedSecond = await auditTaiwanDailyContinuity({ ...input, maxOfficialMonths: 4, now: new Date("2026-07-08T08:01:00Z") });
  assert.equal(boundedSecond.status, "complete");
  assert.equal(boundedSecond.officialRequests, 3);
  assert.equal(calls, 7);
  assert.equal(maximumActiveCalls, 2);
});
