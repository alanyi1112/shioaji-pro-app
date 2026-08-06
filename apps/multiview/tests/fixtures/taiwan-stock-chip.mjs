export const institutionalFixture = [
  { date: "2026-07-02", stock_id: "2330", name: "Foreign_Investor", buy: 11000, sell: 4000 },
  { date: "2026-07-02", stock_id: "2330", name: "Foreign_Dealer_Self", buy: 1000, sell: 500 },
  { date: "2026-07-02", stock_id: "2330", name: "Investment_Trust", buy: 3000, sell: 2000 },
  { date: "2026-07-02", stock_id: "2330", name: "Dealer_self", buy: 2000, sell: 1000 },
  { date: "2026-07-02", stock_id: "2330", name: "Dealer_Hedging", buy: 500, sell: 1000 },
  { date: "2026-07-02", stock_id: "2330", name: "Institutional_Total", net: 9000 },
  { date: "2026-07-01", stock_id: "2330", name: "Foreign_Investor", buy: 0, sell: 0 },
  { date: "2026-07-01", stock_id: "2330", name: "Foreign_Dealer_Self", buy: 0, sell: 0 },
  { date: "2026-07-01", stock_id: "2330", name: "Investment_Trust", buy: 0, sell: 0 },
  { date: "2026-07-01", stock_id: "2330", name: "Dealer_self", buy: 0, sell: 0 },
  { date: "2026-07-01", stock_id: "2330", name: "Dealer_Hedging", buy: 0, sell: 0 },
  { date: "2026-07-03", stock_id: "8069", name: "Foreign_Investor", buy: 999, sell: 0 },
];

export const holdingFixture = [
  { date: "2026-07-02", stock_id: "2330", ForeignInvestmentShares: 18000000000, NumberOfSharesIssued: 25900000000, ForeignInvestmentSharesRatio: 69.5, RecentlyDeclareDate: "2026-07-01" },
  { date: "2026-07-01", stock_id: "2330", ForeignInvestmentShares: 0, NumberOfSharesIssued: 25900000000, ForeignInvestmentSharesRatio: 0, RecentlyDeclareDate: null },
];

export const marginFixture = [
  { date: "2026-07-02", stock_id: "2330", MarginPurchaseBuy: 100, MarginPurchaseSell: 60, MarginPurchaseCashRepayment: 10, MarginPurchaseYesterdayBalance: 1000, MarginPurchaseTodayBalance: 1030, MarginPurchaseLimit: 2000, ShortSaleBuy: 4, ShortSaleSell: 7, ShortSaleCashRepayment: 1, ShortSaleYesterdayBalance: 20, ShortSaleTodayBalance: 22, ShortSaleLimit: 100, OffsetLoanAndShort: 2 },
];

export const lendingFixture = [
  { date: "2026-07-02", stock_id: "2330", transaction_type: "借券", volume: 1000 },
  { date: "2026-07-02", stock_id: "2330", transaction_type: "借券", volume: 2500 },
];

const ranges = ["1-999", "1,000-5,000", "5,001-10,000", "10,001-15,000", "15,001-20,000", "20,001-30,000", "30,001-40,000", "40,001-50,000", "50,001-100,000", "100,001-200,000", "200,001-400,000", "400,001-600,000", "600,001-800,000", "800,001-1,000,000", "1,000,001以上", "差異數調整", "合計"];

export const tdccFixture = ranges.map((range, index) => ({
  "\uFEFF資料日期": "20260709",
  "證券代號": "2330  ",
  "持股分級": String(index + 1),
  "持股數分級": range,
  "人數": index + 1 === 17 ? "120" : index + 1 === 16 ? "0" : String(index + 1),
  "股數": index + 1 === 17 ? "120000" : index + 1 === 16 ? "0" : String((index + 1) * 1000),
  "占集保庫存數比例%": index + 1 === 17 ? "100" : index + 1 === 16 ? "0" : index + 1 === 15 ? "86" : "1",
}));

export const tdccEtfFixture = tdccFixture.map((row) => ({ ...row, "證券代號": "00919   " }));
