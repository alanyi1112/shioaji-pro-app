import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateDistribution,
  createFinMindAdapter,
  createTdccHistoryAdapter,
  datasetEligibility,
  isEligibleTaiwanEquity,
  mergeChipRows,
  mergeChipDailyRow,
  normalizeForeignHoldingRows,
  normalizeInstitutionalRows,
  normalizeMarginShortRows,
  normalizeSecuritiesLendingRows,
  normalizeTpexForeignHoldingLatest,
  normalizeTpexInstitutionalLatest,
  normalizeTpexMarginLatest,
  normalizeTwseInstitutionalLatest,
  normalizeTwseMarginReport,
  parseTdccSnapshot,
} from "../worker/taiwan-stock-chip.ts";
import { holdingFixture, institutionalFixture, lendingFixture, marginFixture, tdccEtfFixture, tdccFixture } from "./fixtures/taiwan-stock-chip.mjs";

test("法人資料只用相容分項組成合計，且保留明確零值", () => {
  const rows = normalizeInstitutionalRows(institutionalFixture, "2330.TW", "2026-07-15T00:00:00Z");
  assert.deepEqual(rows.map((row) => row.sessionDate), ["2026-07-01", "2026-07-02"]);
  assert.equal(rows[0].institutionalFlow.foreignNetShares, 0);
  assert.equal(rows[0].institutionalFlow.institutionalTotalNetShares, 0);
  assert.equal(rows[1].institutionalFlow.foreignNetShares, 7500);
  assert.equal(rows[1].institutionalFlow.foreignBuyShares, 12000);
  assert.equal(rows[1].institutionalFlow.foreignSellShares, 4500);
  assert.equal(rows[1].institutionalFlow.investmentTrustBuyShares, 3000);
  assert.equal(rows[1].institutionalFlow.investmentTrustSellShares, 2000);
  assert.equal(rows[1].institutionalFlow.dealerSelfNetShares, 1000);
  assert.equal(rows[1].institutionalFlow.dealerHedgingNetShares, -500);
  assert.equal(rows[1].institutionalFlow.dealerTotalNetShares, 500);
  assert.equal(rows[1].institutionalFlow.institutionalTotalNetShares, 9000);
  assert.equal(rows[1].institutionalFlow.sourceTotalVerified, true);
});

test("法人分項不完整時不推算自營商或三大法人合計", () => {
  const rows = normalizeInstitutionalRows(institutionalFixture.filter((row) => row.name !== "Dealer_Hedging"), "2330.TW");
  assert.equal(rows.at(-1).institutionalFlow.dealerTotalNetShares, null);
  assert.equal(rows.at(-1).institutionalFlow.institutionalTotalNetShares, null);
});

test("來源總計與完整分項不一致時拒絕三大法人合計", () => {
  const mismatched = institutionalFixture.map((row) => row.name === "Institutional_Total" ? { ...row, net: 999999 } : row);
  const row = normalizeInstitutionalRows(mismatched, "2330.TW").at(-1);
  assert.equal(row.institutionalFlow.sourceTotalVerified, false);
  assert.equal(row.institutionalFlow.institutionalTotalNetShares, null);
});

test("外資持股採來源發布比率，不由買賣超推算", () => {
  const rows = normalizeForeignHoldingRows(holdingFixture, "2330.TW");
  assert.equal(rows[0].foreignHolding.heldShares, 0);
  assert.equal(rows[0].foreignHolding.heldRatioPercent, 0);
  assert.equal(rows[1].foreignHolding.heldRatioPercent, 69.5);
  assert.equal(rows[1].foreignHolding.recentlyDeclaredDate, "2026-07-01");
});

test("融資融券保留張數單位並從正式餘額計算增減", () => {
  const [row] = normalizeMarginShortRows(marginFixture, "2330.TW");
  assert.equal(row.marginShort.marginBalanceChangeLots, 30);
  assert.equal(row.marginShort.marginLimitLots, 2000);
  assert.equal(row.marginShort.marginUtilizationPercent, 51.5);
  assert.equal(row.marginShort.shortBalanceChangeLots, 2);
  assert.equal(row.marginShort.shortLimitLots, 100);
  assert.equal(row.marginShort.shortUtilizationPercent, 22);
  assert.equal(row.marginShort.offsetLots, 2);
});

test("借券只保存來源提供的成交股數，不杜撰餘額", () => {
  const [row] = normalizeSecuritiesLendingRows(lendingFixture, "2330.TW");
  assert.equal(row.securitiesLending.transactionShares, 3500);
  assert.equal(row.securitiesLending.balanceShares, null);
  assert.equal(row.securitiesLending.shortSaleBalanceShares, null);
});

test("TPEx 官方最新資料保留可證明欄位，不把自營商合計冒充分項", () => {
  const institutional = normalizeTpexInstitutionalLatest([{
    Date: "1150715",
    SecuritiesCompanyCode: "8069",
    "ForeignInvestorsInclude MainlandAreaInvestors-Difference": "-1,200",
    "ForeignInvestorsIncludeMainlandAreaInvestors-TotalBuy": "10,000",
    "ForeignInvestorsIncludeMainlandAreaInvestors-TotalSell": "11,200",
    "SecuritiesInvestmentTrustCompanies-Difference": "300",
    "SecuritiesInvestmentTrustCompanies-TotalBuy": "900",
    "SecuritiesInvestmentTrustCompanies-TotalSell": "600",
    "Dealers-Difference": "100",
    TotalDifference: "-800",
  }], "8069.TWO")[0];
  assert.equal(institutional.sessionDate, "2026-07-15");
  assert.equal(institutional.institutionalFlow.foreignNetShares, -1200);
  assert.equal(institutional.institutionalFlow.foreignBuyShares, 10000);
  assert.equal(institutional.institutionalFlow.foreignSellShares, 11200);
  assert.equal(institutional.institutionalFlow.investmentTrustNetShares, 300);
  assert.equal(institutional.institutionalFlow.investmentTrustBuyShares, 900);
  assert.equal(institutional.institutionalFlow.investmentTrustSellShares, 600);
  assert.equal(institutional.institutionalFlow.dealerSelfNetShares, null);
  assert.equal(institutional.institutionalFlow.dealerHedgingNetShares, null);
  assert.equal(institutional.institutionalFlow.institutionalTotalNetShares, null);
  assert.equal(institutional.institutionalFlow.sourceTotalNetShares, -800);
  assert.equal(institutional.provenance["institutional-flow"].provider, "tpex");

  const holding = normalizeTpexForeignHoldingLatest([{
    Date: "1150715",
    SecuritiesCompanyCode: "8069",
    "CurrentlySharesOC/FIHeld": "475,284,885",
    NumberOfSharesIssued: "1,154,360,555",
    "PercentageOfSharesOC/FMIHeld": "41.17%",
  }], "8069.TWO")[0];
  assert.equal(holding.foreignHolding.heldShares, 475284885);
  assert.equal(holding.foreignHolding.heldRatioPercent, 41.17);
});

test("TWSE 與 TPEx 官方融資券都以來源實際日期及正式餘額計算增減", () => {
  const [tpex] = normalizeTpexMarginLatest([{
    Date: "1150715", SecuritiesCompanyCode: "8069",
    MarginPurchaseBalancePreviousDay: "100", MarginPurchaseBalance: "125",
    MarginPurchaseQuota: "500", MarginPurchaseUtilizationRate: "25.00",
    MarginPurchase: "30", MarginSales: "5", CashRedemption: "0",
    ShortSaleBalancePreviousDay: "20", ShortSaleBalance: "18",
    ShortSaleQuota: "200", ShortSaleUtilizationRate: "9.00",
    ShortConvering: "3", ShortSale: "1", StockRedemption: "0", Offsetting: "1",
  }], "8069.TWO");
  assert.equal(tpex.marginShort.marginBalanceChangeLots, 25);
  assert.equal(tpex.marginShort.marginLimitLots, 500);
  assert.equal(tpex.marginShort.marginUtilizationPercent, 25);
  assert.equal(tpex.marginShort.shortBalanceChangeLots, -2);
  assert.equal(tpex.marginShort.shortLimitLots, 200);
  assert.equal(tpex.marginShort.shortUtilizationPercent, 9);
  assert.equal(tpex.provenance["margin-short"].provider, "tpex");

  const fields = ["代號", "名稱", "買進", "賣出", "現金償還", "前日餘額", "今日餘額", "次一營業日限額", "買進", "賣出", "現券償還", "前日餘額", "今日餘額", "次一營業日限額", "資券互抵", "註記"];
  const groups = [{ title: "股票", span: 2 }, { title: "融資", span: 6 }, { title: "融券", span: 6 }, { title: "", span: 1 }, { title: "", span: 1 }];
  const [twse] = normalizeTwseMarginReport({
    stat: "OK", date: "20260715", tables: [{ fields, groups, data: [["2330", "台積電", "5", "15", "0", "1,000", "990", "2,000", "1", "3", "0", "10", "12", "100", "2", ""]] }],
  }, "2330.TW");
  assert.equal(twse.marginShort.marginBalanceChangeLots, -10);
  assert.equal(twse.marginShort.marginUtilizationPercent, 49.5);
  assert.equal(twse.marginShort.shortBalanceChangeLots, 2);
  assert.equal(twse.marginShort.shortUtilizationPercent, 12);
  assert.equal(twse.provenance["margin-short"].provider, "twse");
  assert.equal(twse.provenance["margin-short"].sourceDate, "2026-07-15");
  assert.equal(twse.provenance["margin-short"].sourceDateVerified, true);
  assert.deepEqual(normalizeTwseMarginReport({ stat: "OK", tables: [{ fields, groups, data: [] }] }, "2330.TW"), []);
  assert.deepEqual(normalizeTwseMarginReport([{ 股票代號: "2330", 融資今日餘額: "990" }], "2330.TW"), []);
});

test("TWSE T86 依 fields 名稱正規化當日三大法人並驗證合計", () => {
  const fields = [
    "證券代號", "證券名稱",
    "外陸資買進股數(不含外資自營商)", "外陸資賣出股數(不含外資自營商)", "外陸資買賣超股數(不含外資自營商)",
    "外資自營商買進股數", "外資自營商賣出股數", "外資自營商買賣超股數",
    "投信買進股數", "投信賣出股數", "投信買賣超股數", "自營商買賣超股數",
    "自營商買進股數(自行買賣)", "自營商賣出股數(自行買賣)", "自營商買賣超股數(自行買賣)",
    "自營商買進股數(避險)", "自營商賣出股數(避險)", "自營商買賣超股數(避險)", "三大法人買賣超股數",
  ];
  const data = [["00919", "群益台灣精選高息", "7,315,553", "5,953,327", "1,362,226", "0", "0", "0", "0", "0", "0", "-4,020,856", "35,000", "299,000", "-264,000", "5,453,860", "9,210,716", "-3,756,856", "-2,658,630"]];
  const [row] = normalizeTwseInstitutionalLatest({ stat: "OK", date: "20260721", fields, data }, "00919.TW", "2026-07-21T10:00:00Z");
  assert.equal(row.sessionDate, "2026-07-21");
  assert.equal(row.institutionalFlow.foreignBuyShares, 7315553);
  assert.equal(row.institutionalFlow.foreignNetShares, 1362226);
  assert.equal(row.institutionalFlow.dealerSelfNetShares, -264000);
  assert.equal(row.institutionalFlow.dealerHedgingNetShares, -3756856);
  assert.equal(row.institutionalFlow.dealerTotalNetShares, -4020856);
  assert.equal(row.institutionalFlow.institutionalTotalNetShares, -2658630);
  assert.equal(row.institutionalFlow.sourceTotalVerified, true);
  assert.equal(row.provenance["institutional-flow"].provider, "twse");
  assert.deepEqual(normalizeTwseInstitutionalLatest({ stat: "OK", date: "20260721", fields: fields.filter((field) => field !== "三大法人買賣超股數"), data }, "00919.TW"), []);
});

test("融資融券限額缺漏或為零時不推算使用率", () => {
  const [row] = normalizeMarginShortRows([{
    ...marginFixture[0], MarginPurchaseLimit: 0, ShortSaleLimit: null,
  }], "2330.TW");
  assert.equal(row.marginShort.marginUtilizationPercent, null);
  assert.equal(row.marginShort.shortUtilizationPercent, null);
});

test("TDCC 依語意欄位解析 1 至 17 級並排除不合格商品", () => {
  const [row] = parseTdccSnapshot(tdccFixture, new Set(["2330.TW"]), "2026-07-15T00:00:00Z");
  assert.equal(row.symbol, "2330.TW");
  assert.equal(row.dataDate, "2026-07-09");
  assert.equal(row.levels.length, 15);
  assert.equal(row.adjustment.level, 16);
  assert.equal(row.total.level, 17);
  assert.deepEqual(parseTdccSnapshot(tdccFixture, new Set(["8069.TWO"])), []);
});

test("TDCC 可正規化 ETF 尾端空白代號並解析完整 17 級距", () => {
  const [row] = parseTdccSnapshot(tdccEtfFixture, new Set(["00919.TW"]));
  assert.equal(row.symbol, "00919.TW");
  assert.equal(row.levels.length, 15);
  assert.equal(row.adjustment.level, 16);
  assert.equal(row.total.level, 17);
  const [activeEtf] = parseTdccSnapshot(tdccEtfFixture.map((item) => ({ ...item, "證券代號": "00981A  " })), new Set(["00981A.TW"]));
  assert.equal(activeEtf.symbol, "00981A.TW");
});

test("TDCC 最新 OpenAPI 資料日期含 BOM 且正差異採官方扣減語意時仍可解析", () => {
  const rows = tdccFixture.map((row) => ({ ...row }));
  rows[15] = { ...rows[15], "人數": "1", "股數": "1000" };
  rows[16] = { ...rows[16], "人數": "120", "股數": "119000" };
  const parsed = parseTdccSnapshot(rows, new Set(["2330.TW"]));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].dataDate, "2026-07-09");
});

test("TDCC history adapter 未證明自動介接時 fail closed，已驗證批次則嚴格去重", async () => {
  await assert.rejects(createTdccHistoryAdapter().fetch({ dataDates: ["2026-07-09"], eligibleSymbols: new Set(["2330.TW"]) }), /history_source_unverified/);
  const older = tdccFixture.map((row) => ({ ...row, "\uFEFF資料日期": "20260702" }));
  const adapter = createTdccHistoryAdapter({
    automatedAccessVerified: true,
    fetchBatch: async (date) => date === "2026-07-02" ? older : tdccFixture,
  });
  const rows = await adapter.fetch({ dataDates: ["2026-07-09", "2026-07-02"], eligibleSymbols: new Set(["2330.TW"]) });
  assert.deepEqual(rows.map((row) => row.dataDate), ["2026-07-02", "2026-07-09"]);
  const idempotent = await adapter.fetch({ dataDates: ["2026-07-02", "2026-07-02"], eligibleSymbols: new Set(["2330.TW"]) });
  assert.equal(idempotent.length, 1);
});

test("TDCC 正式 OpenAPI 未提供級距文字時使用官方分級定義", () => {
  const withoutRangeText = tdccFixture.map((row) => {
    const copy = { ...row };
    delete copy["持股數分級"];
    return copy;
  });
  const [parsed] = parseTdccSnapshot(withoutRangeText, new Set(["2330.TW"]));
  assert.equal(parsed.levels[0].range, "1-999 股");
  assert.equal(parsed.levels[14].range, "1,000,001 股以上");
  assert.equal(parsed.adjustment.range, "差異數調整");
});

test("TDCC 分級 16 以帶正負號數值加到分級合計", () => {
  const adjusted = tdccFixture.map((row) => {
    if (row["持股分級"] === "16") return { ...row, 人數: "1", 股數: "1000", "占集保庫存數比例%": "0" };
    if (row["持股分級"] === "17") return { ...row, 人數: "120", 股數: "121000" };
    return row;
  });
  const [parsed] = parseTdccSnapshot(adjusted, new Set(["2330.TW"]));
  assert.equal(parsed.adjustment.holders, 1);
  assert.equal(parsed.adjustment.shares, 1000);
  assert.equal(parsed.total.shares, 121000);
});

test("TDCC 分級 16 接受官方可能出現的負差異調整", () => {
  const adjusted = tdccEtfFixture.map((row) => {
    if (row["持股分級"] === "16") return { ...row, 人數: "0", 股數: "-1000", "占集保庫存數比例%": "-0.00" };
    if (row["持股分級"] === "17") return { ...row, 人數: "120", 股數: "119000" };
    return row;
  });
  const [parsed] = parseTdccSnapshot(adjusted, new Set(["00919.TW"]));
  assert.equal(parsed.adjustment.shares, -1000);
  assert.equal(parsed.total.shares, 119000);
});

test("TDCC 大戶與散戶只聚合支援的官方級距，不納入調整與合計", () => {
  const [row] = parseTdccSnapshot(tdccFixture, new Set(["2330.TW"]));
  const large = aggregateDistribution(row, "large-holder-tier");
  const retail = aggregateDistribution(row, "retail-holder-tiers");
  assert.deepEqual(large.levelIds, [15]);
  assert.equal(large.shares, 15000);
  assert.equal(large.lots, 15);
  assert.deepEqual(retail.levelIds, [1, 2, 3]);
  assert.equal(retail.holders, 6);
  assert.equal(retail.shares, 6000);
  assert.equal(retail.ratioPercent, 3);
  assert.match(large.description, /持股級距/);
});

test("TDCC 400 張以上精確使用分級 12 至 15", () => {
  const [row] = parseTdccSnapshot(tdccFixture, new Set(["2330.TW"]));
  const aggregate = aggregateDistribution(row, "large-holder-400");
  assert.deepEqual(aggregate.levelIds, [12, 13, 14, 15]);
  assert.equal(aggregate.holders, 54);
  assert.equal(aggregate.shares, 54_000);
  assert.equal(aggregate.lots, 54);
  assert.equal(aggregate.ratioPercent, 89);
  assert.match(aggregate.description, /400,001 股以上/);
});

test("TDCC 格式變更、重複級距與非有限值會拒絕", () => {
  assert.throws(() => parseTdccSnapshot(tdccFixture.slice(0, -1), new Set(["2330.TW"])), /invalid_response/);
  assert.throws(() => parseTdccSnapshot([...tdccFixture, tdccFixture[0]], new Set(["2330.TW"])), /invalid_response/);
  assert.throws(() => parseTdccSnapshot(tdccFixture.map((row, index) => index ? row : { ...row, 股數: "NaN" }), new Set(["2330.TW"])), /invalid_response/);
});

test("各資料族群合併不會清除其他族群", () => {
  const rows = mergeChipRows(
    normalizeInstitutionalRows(institutionalFixture, "2330.TW"),
    normalizeForeignHoldingRows(holdingFixture, "2330.TW"),
    normalizeMarginShortRows(marginFixture, "2330.TW"),
    normalizeSecuritiesLendingRows(lendingFixture, "2330.TW"),
  );
  const row = rows.find((item) => item.sessionDate === "2026-07-02");
  assert.ok(row.institutionalFlow && row.foreignHolding && row.marginShort && row.securitiesLending);
});

test("較舊或較低完整度的同族群資料不覆蓋較新完整資料", () => {
  const complete = normalizeInstitutionalRows(institutionalFixture, "2330.TW", "2026-07-15T10:00:00Z").at(-1);
  const older = normalizeInstitutionalRows(institutionalFixture.map((row) => ({ ...row, net: row.net + 1 })), "2330.TW", "2026-07-15T09:00:00Z").at(-1);
  const partial = normalizeTpexInstitutionalLatest([{
    Date: "1150702", SecuritiesCompanyCode: "2330",
    "ForeignInvestorsInclude MainlandAreaInvestors-Difference": "999", "SecuritiesInvestmentTrustCompanies-Difference": "888", TotalDifference: "1887",
  }], "2330.TW", "2026-07-15T11:00:00Z")[0];
  assert.equal(mergeChipDailyRow(complete, older).institutionalFlow.foreignNetShares, complete.institutionalFlow.foreignNetShares);
  assert.equal(mergeChipDailyRow(complete, partial).institutionalFlow.dealerSelfNetShares, complete.institutionalFlow.dealerSelfNetShares);
  assert.equal(mergeChipDailyRow(complete, partial).provenance["institutional-flow"].provider, "finmind");
});

test("台股普通股與 ETF eligibility 同時核對 active、symbol、exchange 與 quoteType", () => {
  assert.equal(isEligibleTaiwanEquity({ symbol: "2330.TW", exchange: "TWSE", quoteType: "EQUITY" }), true);
  assert.equal(isEligibleTaiwanEquity({ symbol: "8069.TWO", exchange: "TPEx", quoteType: "EQUITY" }), true);
  assert.equal(isEligibleTaiwanEquity({ symbol: "0050.TW", exchange: "TWSE", quoteType: "ETF" }), true);
  assert.equal(isEligibleTaiwanEquity({ symbol: "00679B.TW", exchange: "TWSE", quoteType: "ETF" }), true);
  assert.equal(isEligibleTaiwanEquity({ symbol: "00981A.TW", exchange: "TWSE", quoteType: "ETF" }), true);
  assert.equal(isEligibleTaiwanEquity({ symbol: "00919.TW", exchange: "TWSE", quoteType: "WARRANT" }), false);
  assert.equal(isEligibleTaiwanEquity({ symbol: "00919.TW", exchange: "TWSE", quoteType: "ETF", active: false }), false);
  assert.equal(isEligibleTaiwanEquity({ symbol: "2330.TW", exchange: "TPEx", quoteType: "EQUITY" }), false);
});

test("五個 dataset capability matrix 支援上市櫃普通股與 ETF，非日 K 與不合格商品逐項關閉", () => {
  for (const exchange of ["TWSE", "TPEx"]) {
    const matrix = datasetEligibility({ eligible: true, exchange, interval: "1d" });
    assert.equal(Object.keys(matrix).length, 5);
    assert.ok(Object.values(matrix).every((item) => item.supported && item.reason === "supported" && item.providers.length));
  }
  const weekly = datasetEligibility({ eligible: true, exchange: "TWSE", interval: "1wk" });
  assert.ok(Object.values(weekly).every((item) => !item.supported && item.reason === "unsupported_interval"));
  const warrant = datasetEligibility({ eligible: false, exchange: "TWSE", interval: "1d" });
  assert.ok(Object.values(warrant).every((item) => !item.supported && item.reason === "not_eligible" && !item.providers.length));
});

test("FinMind token 只放 Authorization header，額度錯誤轉安全 reason code", async () => {
  let seen;
  const adapter = createFinMindAdapter({
    dataset: "foreign-holding",
    finMindDataset: "TaiwanStockShareholding",
    normalize: normalizeForeignHoldingRows,
    token: "secret-token",
    fetchImpl: async (url, init) => {
      seen = { url: String(url), headers: init.headers };
      return Response.json({ status: 200, data: holdingFixture });
    },
  });
  const rows = await adapter.fetch({ symbol: "2330.TW", start: "2026-07-01", end: "2026-07-03" });
  assert.equal(rows.length, 2);
  assert.doesNotMatch(seen.url, /secret-token/);
  assert.equal(seen.headers.Authorization, "Bearer secret-token");

  const limited = createFinMindAdapter({ ...adapter, finMindDataset: "TaiwanStockShareholding", normalize: normalizeForeignHoldingRows, fetchImpl: async () => new Response("", { status: 402 }) });
  await assert.rejects(limited.fetch({ symbol: "2330.TW", start: "2026-07-01", end: "2026-07-03" }), /rate_limited/);
});

test("FinMind 匿名模式只查保守範圍，token 模式保留完整要求範圍", async () => {
  const starts = [];
  const fetchImpl = async (input) => {
    starts.push(new URL(String(input)).searchParams.get("start_date"));
    return Response.json({ status: 200, data: [] });
  };
  const common = { dataset: "foreign-holding", finMindDataset: "TaiwanStockShareholding", normalize: normalizeForeignHoldingRows, fetchImpl };
  await createFinMindAdapter(common).fetch({ symbol: "2330.TW", start: "2020-01-01", end: "2026-07-15" });
  await createFinMindAdapter({ ...common, token: "runtime-only" }).fetch({ symbol: "2330.TW", start: "2020-01-01", end: "2026-07-15" });
  assert.deepEqual(starts, ["2025-07-10", "2020-01-01"]);
});
