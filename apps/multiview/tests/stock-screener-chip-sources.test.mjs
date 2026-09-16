import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseOfficialChipBatch, screenerChipSourceUrl } from "../worker/stock-screener-chip-sources.ts";

const stock = (market) => ({ code: "2330", symbol: `2330.${market === "TWSE" ? "TW" : "TWO"}`, name: "測試",
  market, kind: "ordinary", listingDate: "1994-09-05" });

test("TWSE T86 全市場 parser 驗證 report date 與投信買賣超", () => {
  const fields = ["證券代號","外陸資買進股數(不含外資自營商)","外陸資賣出股數(不含外資自營商)","外陸資買賣超股數(不含外資自營商)",
    "外資自營商買進股數","外資自營商賣出股數","外資自營商買賣超股數","投信買進股數","投信賣出股數","投信買賣超股數",
    "自營商買賣超股數","自營商買賣超股數(自行買賣)","自營商買賣超股數(避險)","三大法人買賣超股數"];
  const parsed = parseOfficialChipBatch({ stat: "OK", date: "20260911", fields, data: [["2330",10,5,5,0,0,0,900,600,300,0,0,0,305]] },
    "TWSE", "institutional-flow", "2026-09-11", [stock("TWSE")], "2026-09-11T08:00:00Z");
  assert.equal(parsed.rows[0].investmentTrustNetShares, "300");
  assert.throws(() => parseOfficialChipBatch({ stat: "OK", date: "20260910", fields, data: [["2330",10,5,5,0,0,0,900,600,300,0,0,0,305]] },
    "TWSE", "institutional-flow", "2026-09-11", [stock("TWSE")], "2026-09-11T08:00:00Z"), /report_date_mismatch/);
});

test("TPEx 信用交易 parser 保留張數並拒絕負餘額", () => {
  const payload = [{ Date: "1150911", SecuritiesCompanyCode: "2330", MarginPurchaseBalancePreviousDay: 100,
    MarginPurchaseBalance: 90, MarginPurchase: 1, MarginSales: 11, CashRedemption: 0, MarginPurchaseQuota: 500,
    ShortSaleBalancePreviousDay: 10, ShortSaleBalance: 12, ShortConvering: 0, ShortSale: 2, StockRedemption: 0, ShortSaleQuota: 200, Offsetting: 0 }];
  const parsed = parseOfficialChipBatch(payload, "TPEx", "margin-short", "2026-09-11", [stock("TPEx")], "2026-09-11T08:00:00Z");
  assert.equal(parsed.rows[0].marginBalanceChangeLots, "-10");
  assert.equal(parsed.rows[0].shortTodayBalanceLots, "12");
  const invalid = structuredClone(payload); invalid[0].MarginPurchaseBalance = -1;
  assert.throws(() => parseOfficialChipBatch(invalid, "TPEx", "margin-short", "2026-09-11", [stock("TPEx")], "2026-09-11T08:00:00Z"), /empty_report/);
});

test("source URLs are official market batch reports", () => {
  assert.match(screenerChipSourceUrl("TWSE", "institutional-flow", "2026-09-11"), /T86/);
  assert.match(screenerChipSourceUrl("TWSE", "margin-short", "2026-09-11"), /MI_MARGN/);
  assert.match(screenerChipSourceUrl("TPEx", "institutional-flow", "2026-09-11"), /3itrade_hedge_result\.php.*d=115\/09\/11/);
  assert.match(screenerChipSourceUrl("TPEx", "margin-short", "2026-09-11"), /margin_bal_result\.php.*d=115\/09\/11/);
});

test("四份去識別化契約 fixture 都能依市場與資料集解析", async () => {
  const directory = new URL('./fixtures/screener-chip-v5/', import.meta.url);
  const cases = [
    ['twse-t86.json', 'TWSE', 'institutional-flow'], ['twse-mi-margn.json', 'TWSE', 'margin-short'],
    ['tpex-institutional.json', 'TPEx', 'institutional-flow'], ['tpex-margin.json', 'TPEx', 'margin-short'],
  ];
  for (const [name, market, dataset] of cases) {
    const payload = JSON.parse(await readFile(new URL(name, directory), 'utf8'));
    const parsed = parseOfficialChipBatch(payload, market, dataset, '2026-09-11', [stock(market)], '2026-09-11T08:00:00Z');
    assert.equal(parsed.rows.length, 1); assert.equal(parsed.rows[0].sessionDate, '2026-09-11');
  }
});
