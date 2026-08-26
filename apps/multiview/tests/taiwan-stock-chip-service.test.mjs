import assert from "node:assert/strict";
import test from "node:test";
import { changedChipDailyPatch, decorateDistributionRows, expectedTdccSnapshotMinimumDate, stateCovers, taiwanStockChipPayload } from "../worker/taiwan-stock-chip-service.ts";
import { parseTdccSnapshot } from "../worker/taiwan-stock-chip.ts";
import { holdingFixture, institutionalFixture, marginFixture, tdccEtfFixture, tdccFixture } from "./fixtures/taiwan-stock-chip.mjs";

const eligible = { eligible: true, symbol: "2330.TW", exchange: "TWSE", eligibleSymbols: new Set(["2330.TW"]) };
const etfEligible = { eligible: true, symbol: "00919.TW", exchange: "TWSE", quoteType: "ETF", eligibleSymbols: new Set(["00919.TW"]) };

class ChipStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async all() {
    if (this.sql.includes("FROM candle_history")) {
      const [symbol, start, end] = this.args;
      return { results: this.db.candles.filter((row) => row.symbol === symbol && row.time >= start && row.time <= end) };
    }
    if (this.sql.includes("FROM taiwan_stock_chip_daily")) {
      const [symbol, start, end] = this.args;
      return { results: [...this.db.daily.values()].filter((row) => row.symbol === symbol && row.session_date >= start && row.session_date <= end).sort((a, b) => a.session_date.localeCompare(b.session_date)) };
    }
    if (this.sql.includes("FROM taiwan_stock_shareholder_distribution")) {
      const [symbol, start, end] = this.args;
      return { results: [...this.db.distribution.values()].filter((row) => row.symbol === symbol && row.data_date >= start && row.data_date <= end).sort((a, b) => a.data_date.localeCompare(b.data_date)) };
    }
    return { results: [] };
  }
  async first() {
    if (this.sql.includes("FROM taiwan_stock_chip_fetch_state")) return this.db.states.get(`${this.args[0]}|${this.args[1]}`) || null;
    return null;
  }
  async run() {
    if (this.sql.startsWith("INSERT INTO taiwan_stock_chip_daily")) {
      this.db.dailyWrites += 1;
      const [symbol, session_date, exchange, institutional_flow_json, foreign_holding_json, margin_short_json, securities_lending_json, provenance_json, completeness_json] = this.args;
      const key = `${symbol}|${session_date}`;
      const current = this.db.daily.get(key) || { symbol, session_date };
      const mergeJson = (before, patch) => JSON.stringify({ ...JSON.parse(before || "{}"), ...JSON.parse(patch || "{}") });
      this.db.daily.set(key, {
        ...current, symbol, session_date, exchange,
        institutional_flow_json: institutional_flow_json ?? current.institutional_flow_json ?? null,
        foreign_holding_json: foreign_holding_json ?? current.foreign_holding_json ?? null,
        margin_short_json: margin_short_json ?? current.margin_short_json ?? null,
        securities_lending_json: securities_lending_json ?? current.securities_lending_json ?? null,
        provenance_json: mergeJson(current.provenance_json, provenance_json),
        completeness_json: mergeJson(current.completeness_json, completeness_json),
      });
    } else if (this.sql.startsWith("INSERT INTO taiwan_stock_shareholder_distribution")) {
      const [symbol, data_date, levels_json, adjustment_json, total_json, provider, frequency, source_fetched_at] = this.args;
      this.db.distribution.set(`${symbol}|${data_date}`, { symbol, data_date, levels_json, adjustment_json, total_json, provider, frequency, source_fetched_at });
    } else if (this.sql.startsWith("INSERT INTO taiwan_stock_chip_fetch_state")) {
      const [symbol, dataset, start, end, source_date, status, reason_code, last_success_at, last_attempt_at, retry_after] = this.args;
      const key = `${symbol}|${dataset}`;
      const current = this.db.states.get(key) || {};
      const correctingOverCoverage = source_date && current.coverage_end > source_date;
      this.db.states.set(key, {
        ...current, symbol, dataset,
        coverage_start: status === "available" ? (!current.coverage_start || start < current.coverage_start ? start : current.coverage_start) : current.coverage_start ?? null,
        coverage_end: status === "available" ? (correctingOverCoverage || !current.coverage_end || end > current.coverage_end ? end : current.coverage_end) : current.coverage_end ?? null,
        source_date: source_date ?? current.source_date ?? null,
        status, reason_code,
        last_success_at: last_success_at ?? current.last_success_at ?? null,
        last_attempt_at, retry_after,
      });
    }
    return { success: true };
  }
}

class ChipFakeD1 {
  constructor() { this.daily = new Map(); this.distribution = new Map(); this.states = new Map(); this.candles = []; this.dailyWrites = 0; this.queries = []; }
  prepare(sql) { this.queries.push(sql); return new ChipStatement(this, sql); }
  async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); }
}

test("margin-short response 回傳估算成本與固定 60% 估算維持率", async () => {
  const db = new ChipFakeD1();
  const rows = [
    {
      symbol: "2330.TW", session_date: "2026-07-01",
      margin_short_json: JSON.stringify({ marginBuyLots: 0, marginSellLots: 0, marginCashRepaymentLots: 0, marginYesterdayBalanceLots: 0, marginTodayBalanceLots: 100, marginBalanceChangeLots: 100 }),
      provenance_json: JSON.stringify({ "margin-short": { provider: "finmind", dataset: "margin-short", frequency: "daily", sourceDate: "2026-07-01", fetchedAt: "2026-07-02T00:00:00Z" } }),
    },
    {
      symbol: "2330.TW", session_date: "2026-07-02",
      margin_short_json: JSON.stringify({ marginBuyLots: 20, marginSellLots: 10, marginCashRepaymentLots: 5, marginYesterdayBalanceLots: 100, marginTodayBalanceLots: 105, marginBalanceChangeLots: 5 }),
      provenance_json: JSON.stringify({ "margin-short": { provider: "finmind", dataset: "margin-short", frequency: "daily", sourceDate: "2026-07-02", fetchedAt: "2026-07-03T00:00:00Z" } }),
    },
  ];
  rows.forEach((row) => db.daily.set(`${row.symbol}|${row.session_date}`, row));
  db.states.set("2330.TW|margin-short", { status: "available", coverage_start: "2026-07-01", coverage_end: "2026-07-02", source_date: "2026-07-02", last_success_at: new Date().toISOString() });
  db.candles.push(
    { symbol: "2330.TW", time: Date.parse("2026-07-01T00:00:00Z") / 1000, close: 50 },
    { symbol: "2330.TW", time: Date.parse("2026-07-02T00:00:00Z") / 1000, close: 60 },
  );
  const result = await taiwanStockChipPayload({
    url: new URL("http://local/api/taiwan-stock-chip?symbol=2330.TW&interval=1d&start=2026-07-01&end=2026-07-02&datasets=margin-short"),
    env: { DB: db },
    eligibility: eligible,
  });
  assert.equal(result.body.rows[0].marginShort.estimatedCostPrice, 50);
  assert.equal(result.body.rows[0].marginShort.estimatedMarginStatus, "seeded");
  assert.equal(result.body.rows[1].marginShort.estimatedCostPrice, 51.666667);
  assert.equal(result.body.rows[1].marginShort.estimatedMaintenancePercent, 193.548386);
  assert.equal(result.body.rows[1].marginShort.marginLoanRatioPercent, 60);
  assert.equal(result.body.rows[1].marginShort.marginLoanRatioSource, "fixed-60-percent-estimate-model");
  assert.equal(result.body.rows[1].marginShort.estimatedMaintenanceReasonCode, "available");
  assert.equal(result.body.cache.schemaVersion, "taiwan-chip-v4");
  assert.ok(db.queries.some((sql) => sql.includes("FROM candle_history WHERE provider = 'yfinance' AND symbol = ? AND interval = '1d'")));
});

test("TDCC response 以實際前一期 dataDate 回傳總戶數與級距人數變化", () => {
  const first = parseTdccSnapshot(tdccFixture, new Set(["2330.TW"]))[0];
  const secondFixture = tdccFixture.map((row) => ({
    ...row,
    "\uFEFF資料日期": "20260716",
    人數: row["持股分級"] === "17" ? "135" : row["持股分級"] === "16" ? "0" : String(Number(row.人數) + 1),
  }));
  const second = parseTdccSnapshot(secondFixture, new Set(["2330.TW"]))[0];
  const decorated = decorateDistributionRows([first, second]);
  assert.equal(decorated[0].holderMetrics.totalHolders, 120);
  assert.equal(decorated[0].holderMetrics.totalHoldersChange, null);
  assert.equal(decorated[1].holderMetrics.previousDataDate, "2026-07-09");
  assert.equal(decorated[1].holderMetrics.totalHolders, 135);
  assert.equal(decorated[1].holderMetrics.totalHoldersChange, 15);
  assert.equal(decorated[1].holderMetrics.largeHolder.holdersChange, 1);
  assert.deepEqual(decorated[1].largeHolder400.levelIds, [12, 13, 14, 15]);
});

test("籌碼 API 拒絕錯誤日期、過長範圍與未知 datasets", async () => {
  const invalidDate = await taiwanStockChipPayload({ url: new URL("http://local/api/taiwan-stock-chip?symbol=2330.TW&start=2026-13-01&end=2026-01-01"), env: {}, eligibility: eligible });
  assert.equal(invalidDate.status, 400);
  const tooLong = await taiwanStockChipPayload({ url: new URL("http://local/api/taiwan-stock-chip?symbol=2330.TW&start=2000-01-01&end=2026-01-01"), env: {}, eligibility: eligible });
  assert.equal(tooLong.status, 400);
  const unknown = await taiwanStockChipPayload({ url: new URL("http://local/api/taiwan-stock-chip?symbol=2330.TW&datasets=unknown"), env: {}, eligibility: eligible });
  assert.equal(unknown.status, 400);
});

test("融資券來源已提供當日資料時立即顯示，不受固定發布時間限制", async () => {
  const fetchImpl = async () => Response.json({
    status: 200,
    data: [
      { ...marginFixture[0], date: "2026-08-04", stock_id: "2330" },
      { ...marginFixture[0], date: "2026-08-05", stock_id: "2330", MarginPurchaseTodayBalance: 1040 },
    ],
  });
  const result = await taiwanStockChipPayload({
    url: new URL("http://local/api/taiwan-stock-chip?symbol=2330.TW&start=2026-08-01&end=2026-08-05&datasets=margin-short"),
    env: {}, eligibility: eligible, fetchImpl, now: "2026-08-05T14:00:00+08:00",
  });
  assert.deepEqual(result.body.rows.map((row) => row.sessionDate), ["2026-08-04", "2026-08-05"]);
  assert.equal(result.body.coverage[0].end, "2026-08-05");
  assert.deepEqual(result.body.availability["margin-short"], { status: "available", reason: "available", rowCount: 2 });
});

test("非日 K 與非台股普通股或 ETF 不呼叫上游", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error("unexpected"); };
  const weekly = await taiwanStockChipPayload({ url: new URL("http://local/api/taiwan-stock-chip?symbol=2330.TW&interval=1wk"), env: {}, eligibility: eligible, fetchImpl });
  assert.equal(weekly.status, 200);
  assert.equal(weekly.body.availability["institutional-flow"].reason, "unsupported_interval");
  assert.equal(weekly.body.datasetEligibility["institutional-flow"].reason, "unsupported_interval");
  const unsupported = await taiwanStockChipPayload({ url: new URL("http://local/api/taiwan-stock-chip?symbol=0050.TW"), env: {}, eligibility: { ...eligible, eligible: false, symbol: "0050.TW" }, fetchImpl });
  assert.equal(unsupported.body.eligible, false);
  assert.equal(unsupported.body.availability["institutional-flow"].reason, "not_eligible");
  assert.equal(unsupported.body.datasetEligibility["shareholder-distribution"].supported, false);
  assert.equal(calls, 0);
});

test("ETF 各 dataset 獨立回應，來源空陣列只將該族群標示 not_published", async () => {
  const byDataset = {
    TaiwanStockInstitutionalInvestorsBuySell: institutionalFixture.map((row) => ({ ...row, stock_id: "00919" })),
    TaiwanStockShareholding: holdingFixture.map((row) => ({ ...row, stock_id: "00919" })),
    TaiwanStockMarginPurchaseShortSale: marginFixture.map((row) => ({ ...row, stock_id: "00919" })),
    TaiwanStockSecuritiesLending: [],
  };
  const fetchImpl = async (input) => {
    const dataset = new URL(String(input)).searchParams.get("dataset");
    return Response.json({ status: 200, data: byDataset[dataset] });
  };
  const url = new URL("http://local/api/taiwan-stock-chip?symbol=00919.TW&start=2026-07-01&end=2026-07-03&datasets=institutional-flow,foreign-holding,margin-short,securities-lending");
  const result = await taiwanStockChipPayload({ url, env: {}, eligibility: etfEligible, fetchImpl });
  assert.equal(result.body.eligible, true);
  assert.equal(Object.keys(result.body.datasetEligibility).length, 5);
  assert.ok(Object.values(result.body.datasetEligibility).every((item) => item.supported));
  assert.equal(result.body.availability["institutional-flow"].status, "available");
  assert.deepEqual(result.body.availability["foreign-holding"], { status: "partial", reason: "partial_data", rowCount: 2 });
  assert.deepEqual(result.body.availability["margin-short"], { status: "partial", reason: "partial_data", rowCount: 1 });
  assert.deepEqual(result.body.availability["securities-lending"], { status: "unavailable", reason: "not_published", rowCount: 0 });
  assert.ok(result.body.warnings.some((warning) => warning.startsWith("部分資料：")));
  assert.equal(result.body.warnings.some((warning) => /securities-lending|foreign-holding|partial_data/.test(warning)), false);
  assert.ok(result.body.rows.every((row) => row.securitiesLending === null));
});

test("部分資料 warning 使用中文說明外資持股與借券成交的內容及更新時段", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const previous = new Date(`${today}T00:00:00.000Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const previousDate = previous.toISOString().slice(0, 10);
  const earlier = new Date(previous);
  earlier.setUTCDate(earlier.getUTCDate() - 1);
  const earlierDate = earlier.toISOString().slice(0, 10);
  const fetchImpl = async (input) => {
    const dataset = new URL(String(input)).searchParams.get("dataset");
    if (dataset === "TaiwanStockShareholding") return Response.json({ status: 200, data: [{
      date: previousDate, stock_id: "00919", ForeignInvestmentShares: 100, NumberOfSharesIssued: 1000, ForeignInvestmentSharesRatio: 10,
    }] });
    if (dataset === "TaiwanStockSecuritiesLending") return Response.json({ status: 200, data: [{ date: earlierDate, stock_id: "00919", volume: 3000 }] });
    throw new Error(`unexpected ${dataset}`);
  };
  const result = await taiwanStockChipPayload({
    url: new URL(`http://local/api/taiwan-stock-chip?symbol=00919.TW&start=${earlierDate}&end=${today}&datasets=foreign-holding,securities-lending`),
    env: {}, eligibility: etfEligible, fetchImpl, now: `${today}T23:00:00+08:00`,
  });
  const holdingWarning = result.body.warnings.find((warning) => warning.startsWith("外資及陸資持股（"));
  const lendingWarning = result.body.warnings.find((warning) => warning.startsWith("借券成交（"));
  assert.match(holdingWarning, /持有股數.+已發行股數比例.+晚間 21:00.+自動補入/);
  assert.match(lendingWarning, /借入證券.+不等於借券賣出或放空.+15:00.+無成交可能不會新增一筆 0/);
  assert.equal(result.body.warnings.some((warning) => /securities-lending|foreign-holding|partial_data/.test(warning)), false);
});

test("相同 symbol dataset range 的併發請求共用 FinMind single-flight", async () => {
  let calls = 0;
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("dataset"), "TaiwanStockInstitutionalInvestorsBuySell");
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return Response.json({ status: 200, data: institutionalFixture });
  };
  const url = new URL("http://local/api/taiwan-stock-chip?symbol=2330.TW&start=2026-07-01&end=2026-07-03&datasets=institutional-flow");
  const responses = await Promise.all(Array.from({ length: 3 }, () => taiwanStockChipPayload({ url, env: {}, eligibility: eligible, fetchImpl })));
  assert.equal(calls, 1);
  assert.equal(responses[0].body.rows.length, 2);
  assert.equal(responses[0].body.rows[1].institutionalFlow.institutionalTotalNetShares, 9000);
});

test("TDCC 全市場快照共用 single-flight 且回傳大戶散戶級距結果", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return Response.json(tdccFixture);
  };
  const url = new URL("http://local/api/taiwan-stock-chip?symbol=2330.TW&start=2026-07-01&end=2026-07-15&datasets=shareholder-distribution");
  const [first, second] = await Promise.all([
    taiwanStockChipPayload({ url, env: {}, eligibility: eligible, fetchImpl }),
    taiwanStockChipPayload({ url, env: {}, eligibility: eligible, fetchImpl }),
  ]);
  assert.equal(calls, 1);
  for (const result of [first, second]) {
    assert.equal(result.body.distributionRows.length, 1);
    assert.deepEqual(result.body.distributionRows[0].largeHolder.levelIds, [15]);
    assert.deepEqual(result.body.distributionRows[0].retailHolder.levelIds, [1, 2, 3]);
  }
});

test("TDCC ETF 最新快照以 symbol + dataDate 冪等保存並逐週累積", async () => {
  const db = new ChipFakeD1();
  const url = new URL("http://local/api/taiwan-stock-chip?symbol=00919.TW&start=2026-07-01&end=2026-07-15&datasets=shareholder-distribution");
  const first = await taiwanStockChipPayload({ url, env: { DB: db }, eligibility: etfEligible, fetchImpl: async () => Response.json(tdccEtfFixture) });
  assert.equal(first.body.distributionRows.length, 1);
  const state = db.states.get("__MARKET__:tdcc-1-5-v3|shareholder-distribution");
  state.last_success_at = "2026-01-01T00:00:00.000Z";
  const newer = tdccEtfFixture.map((row) => ({ ...row, "\uFEFF資料日期": "20260716" }));
  const second = await taiwanStockChipPayload({ url, env: { DB: db }, eligibility: etfEligible, fetchImpl: async () => Response.json(newer) });
  assert.deepEqual(second.body.distributionRows.map((row) => row.dataDate), ["2026-07-09"]);
  assert.equal(db.distribution.size, 2);
  const repeated = await taiwanStockChipPayload({ url, env: { DB: db }, eligibility: etfEligible, fetchImpl: async () => { throw new Error("should hit cache"); } });
  assert.equal(repeated.body.distributionRows.length, 1);
  assert.equal(db.distribution.size, 2);
});

test("FinMind 失敗時 TPEx 官方當日資料立即回傳且保留來源", async () => {
  const tpexEligible = { eligible: true, symbol: "8069.TWO", exchange: "TPEx", eligibleSymbols: new Set(["8069.TWO"]) };
  const today = new Date().toISOString().slice(0, 10);
  const rocDate = `${String(Number(today.slice(0, 4)) - 1911).padStart(3, "0")}${today.slice(5, 7)}${today.slice(8, 10)}`;
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "api.finmindtrade.com") return new Response("", { status: 503 });
    if (url.pathname.endsWith("/tpex_3insti_daily_trading")) return Response.json([{
      Date: rocDate, SecuritiesCompanyCode: "8069",
      "ForeignInvestorsInclude MainlandAreaInvestors-Difference": "-1200",
      "SecuritiesInvestmentTrustCompanies-Difference": "300", TotalDifference: "-800",
    }]);
    if (url.pathname.endsWith("/tpex_3insti_qfii")) return Response.json([{
      Date: rocDate, SecuritiesCompanyCode: "8069", "CurrentlySharesOC/FIHeld": "475284885",
      NumberOfSharesIssued: "1154360555", "PercentageOfSharesOC/FMIHeld": "41.17%",
    }]);
    if (url.pathname.endsWith("/tpex_mainboard_margin_balance")) return Response.json([{
      Date: rocDate, SecuritiesCompanyCode: "8069", MarginPurchaseBalancePreviousDay: "100",
      MarginPurchaseBalance: "125", ShortSaleBalancePreviousDay: "20", ShortSaleBalance: "18",
    }]);
    throw new Error(`unexpected upstream ${url}`);
  };
  const url = new URL(`http://local/api/taiwan-stock-chip?symbol=8069.TWO&start=${today}&end=${today}&datasets=institutional-flow,foreign-holding,margin-short`);
  const result = await taiwanStockChipPayload({ url, env: {}, eligibility: tpexEligible, fetchImpl, now: `${today}T23:00:00+08:00` });
  assert.equal(result.status, 200);
  assert.equal(result.body.rows.length, 1);
  for (const dataset of ["institutional-flow", "foreign-holding", "margin-short"]) {
    assert.deepEqual(result.body.availability[dataset], { status: "available", reason: "available", rowCount: 1 });
    assert.deepEqual(result.body.sources.find((source) => source.dataset === dataset).providers, ["tpex"]);
  }
  assert.equal(result.body.rows[0].foreignHolding.heldRatioPercent, 41.17);
  assert.equal(result.body.rows[0].marginShort.marginBalanceChangeLots, 25);
  assert.equal(result.body.warnings.length, 3);
});

test("19:45 FinMind 當日落後時以 TWSE T86 補尾並以實際 rows 更新 coverage", async () => {
  const db = new ChipFakeD1();
  const today = new Date().toISOString().slice(0, 10);
  const previous = new Date(`${today}T00:00:00.000Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const previousDate = previous.toISOString().slice(0, 10);
  const finmindRows = institutionalFixture.map((row) => ({ ...row, stock_id: "00919", date: previousDate }));
  const fields = [
    "證券代號", "證券名稱",
    "外陸資買進股數(不含外資自營商)", "外陸資賣出股數(不含外資自營商)", "外陸資買賣超股數(不含外資自營商)",
    "外資自營商買進股數", "外資自營商賣出股數", "外資自營商買賣超股數",
    "投信買進股數", "投信賣出股數", "投信買賣超股數", "自營商買賣超股數",
    "自營商買進股數(自行買賣)", "自營商賣出股數(自行買賣)", "自營商買賣超股數(自行買賣)",
    "自營商買進股數(避險)", "自營商賣出股數(避險)", "自營商買賣超股數(避險)", "三大法人買賣超股數",
  ];
  const official = { stat: "OK", date: today.replaceAll("-", ""), fields, data: [["00919", "ETF", "100", "80", "20", "0", "0", "0", "10", "5", "5", "-15", "5", "10", "-5", "20", "30", "-10", "10"]] };
  const calls = [];
  const fetchImpl = async (input) => {
    const target = new URL(String(input));
    calls.push(target.hostname + target.pathname);
    if (target.hostname === "api.finmindtrade.com") return Response.json({ status: 200, data: finmindRows });
    if (target.hostname === "www.twse.com.tw") return Response.json(official);
    throw new Error(`unexpected ${target}`);
  };
  const result = await taiwanStockChipPayload({
    url: new URL(`http://local/api/taiwan-stock-chip?symbol=00919.TW&start=${previousDate}&end=${today}&datasets=institutional-flow`),
    env: { DB: db }, eligibility: etfEligible, fetchImpl, now: `${today}T19:45:00+08:00`,
  });
  assert.equal(calls.length, 2);
  assert.equal(result.body.rows.at(-1).sessionDate, today);
  assert.equal(result.body.rows.at(-1).provenance["institutional-flow"].provider, "twse");
  assert.deepEqual(result.body.availability["institutional-flow"], { status: "available", reason: "available", rowCount: 2 });
  assert.equal(result.body.coverage[0].end, today);
  assert.equal(db.states.get("00919.TW|institutional-flow").coverage_end, today);
  assert.equal(db.states.get("00919.TW|institutional-flow").source_date, today);
});

test("D1 已有來源日期正確的當日融資券時立即顯示", async () => {
  const db = new ChipFakeD1();
  const previousDate = "2026-08-04";
  const today = "2026-08-05";
  for (const sessionDate of [previousDate, today]) {
    db.daily.set(`2330.TW|${sessionDate}`, {
      symbol: "2330.TW", session_date: sessionDate, exchange: "TWSE",
      institutional_flow_json: JSON.stringify({ institutionalTotalNetShares: sessionDate === today ? 9930788 : 100 }),
      margin_short_json: JSON.stringify({ marginTodayBalanceLots: sessionDate === today ? 1040 : 1030 }),
      provenance_json: JSON.stringify({
        "institutional-flow": { provider: sessionDate === today ? "twse" : "finmind", dataset: "institutional-flow", frequency: "daily", sourceDate: sessionDate, fetchedAt: new Date().toISOString() },
        "margin-short": { provider: "finmind", dataset: "margin-short", frequency: "daily", sourceDate: sessionDate, fetchedAt: new Date().toISOString() },
      }),
    });
  }
  for (const dataset of ["institutional-flow", "margin-short"]) db.states.set(`2330.TW|${dataset}`, {
    status: "available", coverage_start: previousDate, coverage_end: today, source_date: today, last_success_at: new Date().toISOString(),
  });

  const result = await taiwanStockChipPayload({
    url: new URL(`http://local/api/taiwan-stock-chip?symbol=2330.TW&start=${previousDate}&end=${today}&datasets=institutional-flow,margin-short`),
    env: { DB: db }, eligibility: eligible, now: `${today}T19:45:00+08:00`,
    fetchImpl: async () => { throw new Error("unexpected upstream request"); },
  });

  assert.deepEqual(result.body.rows.map((row) => row.sessionDate), [previousDate, today]);
  assert.equal(result.body.rows[0].institutionalFlow.institutionalTotalNetShares, 100);
  assert.equal(result.body.rows[0].marginShort.marginTodayBalanceLots, 1030);
  assert.equal(result.body.rows[1].institutionalFlow.institutionalTotalNetShares, 9930788);
  assert.equal(result.body.rows[1].provenance["institutional-flow"].provider, "twse");
  assert.equal(result.body.rows[1].marginShort.marginTodayBalanceLots, 1040);
  assert.equal(result.body.rows[1].provenance["margin-short"].sourceDate, today);
  assert.equal(result.body.coverage.find((item) => item.dataset === "institutional-flow").end, today);
  assert.equal(result.body.coverage.find((item) => item.dataset === "margin-short").end, today);
});

test("舊版無日期 TWSE 融資券快取不會把 8/4 冒充成 8/5", async () => {
  const db = new ChipFakeD1();
  const previousDate = "2026-08-04";
  const today = "2026-08-05";
  db.daily.set(`2330.TW|${previousDate}`, {
    symbol: "2330.TW", session_date: previousDate, exchange: "TWSE",
    margin_short_json: JSON.stringify({ marginTodayBalanceLots: 1030 }),
    provenance_json: JSON.stringify({
      "margin-short": { provider: "finmind", dataset: "margin-short", frequency: "daily", sourceDate: previousDate, fetchedAt: new Date().toISOString() },
    }),
  });
  db.daily.set(`2330.TW|${today}`, {
    symbol: "2330.TW", session_date: today, exchange: "TWSE",
    margin_short_json: JSON.stringify({ marginTodayBalanceLots: 1030 }),
    provenance_json: JSON.stringify({
      "margin-short": { provider: "twse", dataset: "margin-short", frequency: "daily", sourceDate: today, fetchedAt: new Date().toISOString() },
    }),
  });
  db.states.set("2330.TW|margin-short", {
    status: "available", coverage_start: previousDate, coverage_end: today, source_date: today, last_success_at: new Date().toISOString(),
  });
  const calls = [];
  const fetchImpl = async (input) => {
    const target = new URL(String(input));
    calls.push(target.href);
    if (target.hostname === "api.finmindtrade.com") return Response.json({ status: 200, data: [{ ...marginFixture[0], stock_id: "2330", date: previousDate }] });
    if (target.hostname === "www.twse.com.tw") return Response.json({ stat: "很抱歉，沒有符合條件的資料" });
    throw new Error(`unexpected ${target}`);
  };

  const result = await taiwanStockChipPayload({
    url: new URL(`http://local/api/taiwan-stock-chip?symbol=2330.TW&start=${previousDate}&end=${today}&datasets=margin-short`),
    env: { DB: db }, eligibility: eligible, fetchImpl, now: `${today}T20:00:00+08:00`,
  });

  assert.deepEqual(result.body.rows.map((row) => row.sessionDate), [previousDate]);
  assert.equal(result.body.rows[0].marginShort.marginTodayBalanceLots, marginFixture[0].MarginPurchaseTodayBalance);
  assert.equal(result.body.coverage[0].end, previousDate);
  assert.equal(db.states.get("2330.TW|margin-short").coverage_end, previousDate);
  assert.ok(calls.some((url) => url.includes("api.finmindtrade.com")));
  assert.ok(calls.some((url) => url.includes("/rwd/zh/marginTrading/MI_MARGN?date=20260805")));
  assert.equal(calls.some((url) => url.includes("openapi.twse.com.tw")), false);
});

test("TWSE 日期報表取得 8/5 融資券後立即補入，且保留可驗證來源日期", async () => {
  const previousDate = "2026-08-04";
  const today = "2026-08-05";
  const fields = ["代號", "名稱", "買進", "賣出", "現金償還", "前日餘額", "今日餘額", "次一營業日限額", "買進", "賣出", "現券償還", "前日餘額", "今日餘額", "次一營業日限額", "資券互抵", "註記"];
  const groups = [{ title: "股票", span: 2 }, { title: "融資", span: 6 }, { title: "融券", span: 6 }, { title: "", span: 1 }, { title: "", span: 1 }];
  const calls = [];
  const fetchImpl = async (input) => {
    const target = new URL(String(input));
    calls.push(target.href);
    if (target.hostname === "api.finmindtrade.com") return Response.json({ status: 200, data: [{ ...marginFixture[0], stock_id: "2330", date: previousDate }] });
    if (target.hostname === "www.twse.com.tw") return Response.json({
      stat: "OK", date: "20260805", tables: [{ fields, groups, data: [["2330", "台積電", "20", "10", "0", "1,030", "1,040", "2,000", "2", "1", "0", "12", "13", "100", "1", ""]] }],
    });
    throw new Error(`unexpected ${target}`);
  };

  const result = await taiwanStockChipPayload({
    url: new URL(`http://local/api/taiwan-stock-chip?symbol=2330.TW&start=${previousDate}&end=${today}&datasets=margin-short`),
    env: {}, eligibility: eligible, fetchImpl, now: `${today}T14:00:00+08:00`,
  });

  assert.deepEqual(result.body.rows.map((row) => row.sessionDate), [previousDate, today]);
  assert.equal(result.body.rows[1].marginShort.marginTodayBalanceLots, 1040);
  assert.equal(result.body.rows[1].provenance["margin-short"].provider, "twse");
  assert.equal(result.body.rows[1].provenance["margin-short"].sourceDate, today);
  assert.equal(result.body.rows[1].provenance["margin-short"].sourceDateVerified, true);
  assert.deepEqual(result.body.availability["margin-short"], { status: "available", reason: "available", rowCount: 2 });
  assert.equal(result.body.coverage[0].end, today);
  assert.equal(calls.some((url) => url.includes("openapi.twse.com.tw")), false);
});

test("來源只回前一日且官方未發布時不會把 requested end 寫成 coverage", async () => {
  const db = new ChipFakeD1();
  const today = new Date().toISOString().slice(0, 10);
  const previous = new Date(`${today}T00:00:00.000Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const previousDate = previous.toISOString().slice(0, 10);
  const finmindRows = institutionalFixture.map((row) => ({ ...row, date: previousDate }));
  let finmindCalls = 0;
  const fetchImpl = async (input) => {
    const target = new URL(String(input));
    if (target.hostname === "api.finmindtrade.com") {
      finmindCalls += 1;
      return Response.json({ status: 200, data: finmindRows });
    }
    if (target.hostname === "www.twse.com.tw") return Response.json({ stat: "OK", date: today.replaceAll("-", ""), fields: [], data: [] });
    throw new Error(`unexpected ${target}`);
  };
  const url = new URL(`http://local/api/taiwan-stock-chip?symbol=2330.TW&start=${previousDate}&end=${today}&datasets=institutional-flow`);
  const first = await taiwanStockChipPayload({ url, env: { DB: db }, eligibility: eligible, fetchImpl, now: `${today}T23:00:00+08:00` });
  assert.deepEqual(first.body.availability["institutional-flow"], { status: "partial", reason: "partial_data", rowCount: 1 });
  assert.equal(db.states.get("2330.TW|institutional-flow").coverage_end, previousDate);
  assert.equal(db.states.get("2330.TW|institutional-flow").source_date, previousDate);
  const second = await taiwanStockChipPayload({ url, env: { DB: db }, eligibility: eligible, fetchImpl, now: `${today}T23:00:00+08:00` });
  assert.equal(second.body.cache.mode, "d1_hit");
  assert.deepEqual(second.body.availability["institutional-flow"], { status: "partial", reason: "partial_data", rowCount: 1 });
  assert.equal(finmindCalls, 1);
});

test("partial_data 冷卻到期後才重新檢查來源", () => {
  const now = Date.parse("2026-07-30T06:00:00.000Z");
  const state = {
    status: "available", coverage_start: "2026-07-01", coverage_end: "2026-07-29", source_date: "2026-07-29",
    reason_code: "partial_data", last_success_at: "2026-07-30T05:50:00.000Z", retry_after: "2026-07-30T06:20:00.000Z",
  };
  assert.equal(stateCovers(state, "2026-07-01", "2026-07-30", "institutional-flow", now), true);
  assert.equal(stateCovers(state, "2026-07-01", "2026-07-30", "institutional-flow", Date.parse("2026-07-30T06:21:00.000Z")), false);
});

test("TDCC 發布窗口前接受前一期，窗口後要求新資料週", () => {
  assert.equal(expectedTdccSnapshotMinimumDate("2026-08-21T02:00:00.000Z"), "2026-08-10");
  assert.equal(expectedTdccSnapshotMinimumDate("2026-08-22T14:29:00.000Z"), "2026-08-10");
  assert.equal(expectedTdccSnapshotMinimumDate("2026-08-22T14:30:00.000Z"), "2026-08-17");
  assert.equal(expectedTdccSnapshotMinimumDate("2026-08-26T00:00:00.000Z"), "2026-08-17");
  const oldWeek = {
    status: "available", coverage_start: "2026-08-14", coverage_end: "2026-08-14", source_date: "2026-08-14",
    reason_code: "available", last_success_at: "2026-08-21T00:56:00.000Z",
  };
  assert.equal(stateCovers(oldWeek, "2025-08-01", "2026-08-21", "shareholder-distribution", Date.parse("2026-08-21T02:00:00.000Z")), true);
  assert.equal(stateCovers(oldWeek, "2025-08-01", "2026-08-26", "shareholder-distribution", Date.parse("2026-08-26T00:00:00.000Z")), false);
  assert.equal(stateCovers({ ...oldWeek, source_date: "2026-08-21", coverage_end: "2026-08-21" }, "2025-08-01", "2026-08-26", "shareholder-distribution", Date.parse("2026-08-26T00:00:00.000Z")), true);
});

test("籌碼 canonical 內容相同時忽略 fetchedAt，實際資料變更才產生 patch", () => {
  const before = {
    symbol: "2330.TW", sessionDate: "2026-07-29", foreignHolding: null, marginShort: null, securitiesLending: null,
    institutionalFlow: { foreignBuyShares: 100, foreignSellShares: 80, foreignNetShares: 20, investmentTrustBuyShares: 0, investmentTrustSellShares: 0, investmentTrustNetShares: 0, dealerSelfNetShares: 0, dealerHedgingNetShares: 0, dealerTotalNetShares: 0, institutionalTotalNetShares: 20, sourceTotalNetShares: 20, sourceTotalVerified: true },
    provenance: { "institutional-flow": { provider: "finmind", dataset: "institutional-flow", frequency: "daily", sourceDate: "2026-07-29", fetchedAt: "2026-07-29T12:00:00.000Z" } },
  };
  const fetchedAgain = structuredClone(before);
  fetchedAgain.provenance["institutional-flow"].fetchedAt = "2026-07-30T12:00:00.000Z";
  assert.equal(changedChipDailyPatch(before, fetchedAgain), null);
  fetchedAgain.institutionalFlow.foreignNetShares = 21;
  assert.equal(changedChipDailyPatch(before, fetchedAgain).institutionalFlow.foreignNetShares, 21);
});

test("過期 coverage 重抓相同籌碼歷史時不重寫 D1 rows", async () => {
  const db = new ChipFakeD1();
  const url = new URL("http://local/api/taiwan-stock-chip?symbol=2330.TW&start=2026-07-01&end=2026-07-02&datasets=institutional-flow");
  const fetchImpl = async () => Response.json({ status: 200, data: institutionalFixture });
  await taiwanStockChipPayload({ url, env: { DB: db }, eligibility: eligible, fetchImpl });
  assert.equal(db.dailyWrites, 2);
  db.states.get("2330.TW|institutional-flow").last_success_at = "2026-01-01T00:00:00.000Z";
  await taiwanStockChipPayload({ url, env: { DB: db }, eligibility: eligible, fetchImpl });
  assert.equal(db.dailyWrites, 2);
});

test("D1 完整 coverage 命中時不重抓上游，且 partial upsert 保留其他族群", async () => {
  const db = new ChipFakeD1();
  let calls = 0;
  const fetchImpl = async (input) => {
    calls += 1;
    const dataset = new URL(String(input)).searchParams.get("dataset");
    if (dataset === "TaiwanStockInstitutionalInvestorsBuySell") return Response.json({ status: 200, data: institutionalFixture });
    throw new Error(`unexpected ${dataset}`);
  };
  const institutionalUrl = new URL("http://local/api/taiwan-stock-chip?symbol=2330.TW&start=2026-07-01&end=2026-07-02&datasets=institutional-flow");
  const first = await taiwanStockChipPayload({ url: institutionalUrl, env: { DB: db }, eligibility: eligible, fetchImpl });
  assert.equal(first.body.cache.mode, "d1_refreshed");
  assert.equal(first.body.rows.length, 2);
  assert.deepEqual(first.body.coverage[0], { dataset: "institutional-flow", start: "2026-07-01", end: "2026-07-02", requestedStart: "2026-07-01", requestedEnd: "2026-07-02", frequency: "daily", status: "available" });
  const second = await taiwanStockChipPayload({ url: institutionalUrl, env: { DB: db }, eligibility: eligible, fetchImpl: async () => { throw new Error("cache miss"); } });
  assert.equal(second.body.cache.mode, "d1_hit");
  assert.equal(second.body.availability["institutional-flow"].status, "available");
  assert.equal(calls, 1);

  const holdingUrl = new URL("http://local/api/taiwan-stock-chip?symbol=2330.TW&start=2026-07-01&end=2026-07-02&datasets=foreign-holding");
  const holding = await taiwanStockChipPayload({
    url: holdingUrl, env: { DB: db }, eligibility: eligible,
    fetchImpl: async () => Response.json({ status: 200, data: [
      { date: "2026-07-01", stock_id: "2330", ForeignInvestmentShares: 100, NumberOfSharesIssued: 1000, ForeignInvestmentRemainingRatio: 10 },
      { date: "2026-07-02", stock_id: "2330", ForeignInvestmentShares: 110, NumberOfSharesIssued: 1000, ForeignInvestmentRemainingRatio: 11 },
    ] }),
  });
  assert.ok(holding.body.rows.every((row) => row.institutionalFlow && row.foreignHolding));
});

test("舊 D1 籌碼 JSON 缺少新欄位時 API 明確補為 null", async () => {
  const db = new ChipFakeD1();
  const sessionDate = "2026-07-02";
  db.daily.set(`2330.TW|${sessionDate}`, {
    symbol: "2330.TW", session_date: sessionDate, exchange: "TWSE",
    institutional_flow_json: JSON.stringify({ foreignNetShares: 1234, investmentTrustNetShares: -500 }),
    margin_short_json: JSON.stringify({ marginTodayBalanceLots: 100, shortTodayBalanceLots: 2 }),
    provenance_json: JSON.stringify({
      "institutional-flow": { provider: "finmind", dataset: "institutional-flow", frequency: "daily", sourceDate: sessionDate, fetchedAt: new Date().toISOString() },
      "margin-short": { provider: "finmind", dataset: "margin-short", frequency: "daily", sourceDate: sessionDate, fetchedAt: new Date().toISOString() },
    }),
  });
  for (const dataset of ["institutional-flow", "margin-short"]) db.states.set(`2330.TW|${dataset}`, {
    status: "available", coverage_start: sessionDate, coverage_end: sessionDate, source_date: sessionDate, last_success_at: new Date().toISOString(),
  });
  const result = await taiwanStockChipPayload({
    url: new URL(`http://local/api/taiwan-stock-chip?symbol=2330.TW&start=${sessionDate}&end=${sessionDate}&datasets=institutional-flow,margin-short`),
    env: { DB: db }, eligibility: eligible, fetchImpl: async () => { throw new Error("should use D1"); },
  });
  const row = result.body.rows[0];
  assert.equal(row.institutionalFlow.foreignNetShares, 1234);
  assert.equal(row.institutionalFlow.foreignBuyShares, null);
  assert.equal(row.institutionalFlow.investmentTrustSellShares, null);
  assert.equal(row.marginShort.marginTodayBalanceLots, 100);
  assert.equal(row.marginShort.marginLimitLots, null);
  assert.equal(row.marginShort.shortUtilizationPercent, null);
});

test("官方使用率與同列餘額限額不一致時回傳安全 warning 且保留來源值", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const rocDate = `${String(Number(today.slice(0, 4)) - 1911).padStart(3, "0")}${today.slice(5, 7)}${today.slice(8, 10)}`;
  const tpexEligibility = { eligible: true, symbol: "8069.TWO", exchange: "TPEx", eligibleSymbols: new Set(["8069.TWO"]) };
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "api.finmindtrade.com") return new Response("", { status: 503 });
    if (url.pathname.endsWith("/tpex_mainboard_margin_balance")) return Response.json([{
      Date: rocDate, SecuritiesCompanyCode: "8069",
      MarginPurchaseBalancePreviousDay: "20", MarginPurchaseBalance: "25", MarginPurchaseQuota: "100", MarginPurchaseUtilizationRate: "50.0",
      ShortSaleBalancePreviousDay: "2", ShortSaleBalance: "2", ShortSaleQuota: "100", ShortSaleUtilizationRate: "2.0",
    }]);
    throw new Error(`unexpected ${url}`);
  };
  const result = await taiwanStockChipPayload({
    url: new URL(`http://local/api/taiwan-stock-chip?symbol=8069.TWO&start=${today}&end=${today}&datasets=margin-short`),
    env: {}, eligibility: tpexEligibility, fetchImpl, now: `${today}T23:00:00+08:00`,
  });
  assert.equal(result.body.rows[0].marginShort.marginUtilizationPercent, 50);
  assert.ok(result.body.warnings.includes("融資融券：融資使用率與餘額／限額交叉驗證不一致"));
  assert.equal(result.body.warnings.some((warning) => /50\.0|25|100/.test(warning)), false);
});

test("D1 過期資料在上游失敗時回 stale_cache，negative cache 阻止立即重試", async () => {
  const db = new ChipFakeD1();
  const url = new URL("http://local/api/taiwan-stock-chip?symbol=2330.TW&start=2026-07-01&end=2026-07-02&datasets=institutional-flow");
  await taiwanStockChipPayload({ url, env: { DB: db }, eligibility: eligible, fetchImpl: async () => Response.json({ status: 200, data: institutionalFixture }) });
  const state = db.states.get("2330.TW|institutional-flow");
  state.last_success_at = "2026-01-01T00:00:00.000Z";
  let failedCalls = 0;
  const unavailable = async () => { failedCalls += 1; return new Response("", { status: 503 }); };
  const stale = await taiwanStockChipPayload({ url, env: { DB: db }, eligibility: eligible, fetchImpl: unavailable });
  assert.deepEqual(stale.body.availability["institutional-flow"], { status: "partial", reason: "stale_cache", rowCount: 2 });
  assert.equal(stale.body.rows.length, 2);
  const negativeHit = await taiwanStockChipPayload({ url, env: { DB: db }, eligibility: eligible, fetchImpl: unavailable });
  assert.equal(negativeHit.body.availability["institutional-flow"].reason, "stale_cache");
  assert.equal(failedCalls, 2);
});

test("不同 symbol 或 range 不共用 FinMind single-flight", async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    calls.push(`${url.searchParams.get("data_id")}|${url.searchParams.get("start_date")}|${url.searchParams.get("end_date")}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Response.json({ status: 200, data: institutionalFixture.map((row) => ({ ...row, stock_id: url.searchParams.get("data_id") })) });
  };
  const request = (symbol, start, end) => taiwanStockChipPayload({
    url: new URL(`http://local/api/taiwan-stock-chip?symbol=${symbol}&start=${start}&end=${end}&datasets=institutional-flow`),
    env: {}, eligibility: { ...eligible, symbol }, fetchImpl,
  });
  await Promise.all([
    request("2330.TW", "2026-07-01", "2026-07-02"),
    request("2317.TW", "2026-07-01", "2026-07-02"),
    request("2330.TW", "2026-07-01", "2026-07-03"),
  ]);
  assert.equal(new Set(calls).size, 3);
});

test("TDCC 只有較新合法快照時明確回傳 history_not_archived", async () => {
  const url = new URL("http://local/api/taiwan-stock-chip?symbol=2330.TW&start=2026-06-01&end=2026-06-30&datasets=shareholder-distribution");
  const result = await taiwanStockChipPayload({ url, env: {}, eligibility: eligible, fetchImpl: async () => Response.json(tdccFixture) });
  assert.deepEqual(result.body.availability["shareholder-distribution"], { status: "unavailable", reason: "history_not_archived", rowCount: 0 });
  assert.deepEqual(result.body.coverage[0], {
    dataset: "shareholder-distribution", start: null, end: null,
    requestedStart: "2026-06-01", requestedEnd: "2026-06-30",
    frequency: "weekly", status: "history_not_archived",
    frequencyLabel: "週資料／當週最後營業日", savedWeeks: 0,
    expectedWeeks: 0, backfillStatus: "idle", lastSuccessAt: null,
  });
  assert.equal(result.body.backfill.status, "idle");
});

test("單一資料族群失敗不會清除其他成功族群，完全無資料才 unavailable", async () => {
  const fetchImpl = async (input) => {
    const dataset = new URL(String(input)).searchParams.get("dataset");
    if (dataset === "TaiwanStockInstitutionalInvestorsBuySell") return Response.json({ status: 200, data: institutionalFixture });
    return new Response("", { status: 503 });
  };
  const partialUrl = new URL("http://local/api/taiwan-stock-chip?symbol=2330.TW&start=2026-07-01&end=2026-07-02&datasets=institutional-flow,foreign-holding");
  const partial = await taiwanStockChipPayload({ url: partialUrl, env: {}, eligibility: eligible, fetchImpl });
  assert.equal(partial.body.rows.length, 2);
  assert.equal(partial.body.availability["institutional-flow"].status, "available");
  assert.deepEqual(partial.body.availability["foreign-holding"], { status: "unavailable", reason: "provider_unavailable", rowCount: 0 });
  assert.ok(partial.body.rows.every((row) => row.institutionalFlow && row.foreignHolding === null));

  const emptyUrl = new URL("http://local/api/taiwan-stock-chip?symbol=2330.TW&start=2026-06-01&end=2026-06-02&datasets=foreign-holding");
  const empty = await taiwanStockChipPayload({ url: emptyUrl, env: {}, eligibility: eligible, fetchImpl });
  assert.deepEqual(empty.body.availability["foreign-holding"], { status: "unavailable", reason: "provider_unavailable", rowCount: 0 });
  assert.equal(empty.body.rows.length, 0);
});
