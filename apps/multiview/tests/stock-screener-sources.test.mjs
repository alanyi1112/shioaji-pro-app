import assert from "node:assert/strict";
import test from "node:test";
import { fetchScreenerSource, mergeUniverses, parseDailyVolumes, parseHolderBatch, parseUniverse, SCREENER_SOURCES, sourceDate } from "../worker/stock-screener-sources.ts";

const provenance = { source: "official", sourceUrl: "https://example.invalid", fetchedAt: "2026-08-31T10:00:00Z", payloadHash: "fixture", normalizationVersion: "1" };
const listed = { "出表日期": "1150830", "公司代號": "2330", "公司簡稱": "台積電", "上市日期": "19940905", "產業別": "24", "已發行普通股數或TDR原股發行股數": "1000001" };
test("官方名冊日期、去重、未上市、非普通股與轉市場衝突", () => {
  const twse = parseUniverse([listed, { ...listed, "公司代號": "910322", "產業別": "91", "公司簡稱": "康師傅-DR" }, { ...listed, "公司代號": "7777", "上市日期": "20260901" }], "TWSE");
  assert.equal(twse.stocks.length, 1);
  assert.equal(twse.date, "2026-08-30");
  assert.equal(twse.excluded.length, 2);
  assert.throws(() => parseUniverse([listed, listed], "TWSE"), /duplicate_security/);
  assert.throws(() => mergeUniverses(twse, { ...twse, stocks: [{ ...twse.stocks[0], market: "TPEx", symbol: "2330.TWO" }] }), /market_transfer_unresolved/);
  assert.throws(() => sourceDate("1150230"), /invalid_source_date/);
  assert.deepEqual(parseUniverse([{ ...listed, "公司代號": "9103", "產業別": "91", "公司簡稱": "美德醫療-DR" }], "TWSE").stocks, []);
  for (const patch of [{ "公司代號": "0050" }, { "產業別": "" }, { "已發行普通股數或TDR原股發行股數": "" }, { "產業別": "91" }]) assert.throws(() => parseUniverse([{ ...listed, ...patch }], "TWSE"), /invalid_security_classification/);
  const transferred = mergeUniverses(twse, { ...twse, stocks: [{ ...twse.stocks[0], market: "TPEx", symbol: "2330.TWO", listingDate: "2026-08-30" }] });
  assert.equal(transferred.stocks.length, 1);
  assert.equal(transferred.stocks[0].symbol, "2330.TWO");
});
test("日量與成交值使用同一官方列，未知／缺值隔離、不轉成零或乘一千", () => {
  const result = parseDailyVolumes([{ Date: "1150828", Code: "2330", TradeVolume: "3001", TradeValue: "12345600" },
    { Date: "1150828", Code: "3008", TradeVolume: "--", TradeValue: "900" },
    { Date: "1150828", Code: "3010", TradeVolume: "10" }], "TWSE", provenance);
  assert.equal(result.points.get("2330.TW").shares, "3001");
  assert.equal(result.points.get("2330.TW").turnoverNtd, "12345600");
  assert.equal(result.points.get("2330.TW").turnoverCurrency, "TWD");
  assert.equal(result.points.get("3008.TW").shares, null);
  assert.equal(result.points.get("3008.TW").turnoverNtd, "900");
  assert.equal(result.invalid.get("3008.TW"), "invalid_volume");
  assert.equal(result.invalid.get("3010.TW"), "missing_turnover");
  assert.throws(() => parseDailyVolumes([{ Date: "1150828" }, { Date: "1150831" }], "TWSE", provenance), /mixed_source_dates/);
  const tpex = parseDailyVolumes([{ Date: "1150828", SecuritiesCompanyCode: "4768", TradingShares: "12345", TransactionAmount: "779730" }], "TPEx", provenance).points.get("4768.TWO");
  assert.equal(tpex.shares, "12345"); assert.equal(tpex.turnoverNtd, "779730"); assert.equal(tpex.turnoverField, "TransactionAmount");
});
test("TDCC BOM 及單一商品不完整不得拖累其他商品", () => {
  const universe = parseUniverse([listed, { ...listed, "公司代號": "3008" }], "TWSE").stocks;
  const rows = Array.from({ length: 17 }, (_, i) => ({ "\uFEFF資料日期": "20260828", "證券代號": "2330", "持股分級": String(i + 1), "人數": i === 14 || i === 16 ? "1" : "0", "股數": i === 14 || i === 16 ? "1000001" : "0", "占集保庫存數比例%": i === 14 || i === 16 ? "100.00" : "0.00" }));
  const result = parseHolderBatch([...rows, { ...rows[0], "證券代號": "3008" }], universe, provenance);
  assert.equal(result.points.size, 1);
  assert.equal(result.invalid.get("3008.TW"), "incomplete_tdcc");
});
test("fetch＋body timeout 即使 body 忽略 abort 也會結束；拒絕任意 URL", async () => {
  await assert.rejects(fetchScreenerSource("http://127.0.0.1/private"), /source_not_allowed/);
  let aborted = false;
  await assert.rejects(fetchScreenerSource(SCREENER_SOURCES.tdcc, async (_, options) => {
    options.signal.addEventListener("abort", () => { aborted = true; });
    return { ok: true, text: () => new Promise(() => {}) };
  }, 10), /source_timeout/);
  assert.equal(aborted, true);
});
