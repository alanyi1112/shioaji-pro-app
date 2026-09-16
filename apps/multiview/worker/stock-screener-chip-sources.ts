import type { ScreenerMarket, UniverseStock } from "../../../src/lib/stock-screener-domain.ts";
import {
  emptyDaily,
  normalizeTpexInstitutionalLatest, normalizeTpexMarginLatest,
  normalizeTwseInstitutionalLatest, normalizeTwseMarginReport,
  type ChipDailyRow,
} from "./taiwan-stock-chip.ts";

export const SCREENER_CHIP_NORMALIZATION_VERSION = "official-market-chip-v1" as const;
export type ScreenerChipDataset = "institutional-flow" | "margin-short";

export function screenerChipSourceUrl(market: ScreenerMarket, dataset: ScreenerChipDataset, sessionDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) throw new Error("invalid_report_date");
  const compact = sessionDate.replaceAll("-", "");
  if (market === "TWSE" && dataset === "institutional-flow") {
    return `https://www.twse.com.tw/rwd/zh/fund/T86?date=${compact}&selectType=ALL&response=json`;
  }
  if (market === "TWSE") {
    return `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${compact}&selectType=ALL&response=json`;
  }
  const [year, month, day] = sessionDate.split("-");
  const roc = `${Number(year) - 1911}/${month}/${day}`;
  if (dataset === "institutional-flow") {
    return `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=EW&t=D&d=${roc}&s=0,asc`;
  }
  return `https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/margin_bal_result.php?l=zh-tw&o=json&d=${roc}&s=0,asc`;
}

export interface CanonicalScreenerChipRow {
  symbol: string; market: ScreenerMarket; sessionDate: string;
  investmentTrustBuyShares: string | null; investmentTrustSellShares: string | null; investmentTrustNetShares: string | null;
  marginYesterdayBalanceLots: string | null; marginTodayBalanceLots: string | null; marginBalanceChangeLots: string | null;
  shortYesterdayBalanceLots: string | null; shortTodayBalanceLots: string | null; shortBalanceChangeLots: string | null;
}

const integer = (value: number | null): string | null => Number.isSafeInteger(value) ? String(value) : null;
const numeric = (value: unknown) => {
  const text = String(value ?? "").replaceAll(",", "").trim();
  if (!/^-?\d+$/.test(text)) return null;
  const result = Number(text);
  return Number.isSafeInteger(result) ? result : null;
};
const reportDate = (value: unknown) => {
  const text = String(value ?? "").trim();
  if (!/^\d{8}$/.test(text)) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`;
};
const empty = (stock: UniverseStock, date: string): CanonicalScreenerChipRow => ({ symbol: stock.symbol, market: stock.market,
  sessionDate: date, investmentTrustBuyShares: null, investmentTrustSellShares: null, investmentTrustNetShares: null,
  marginYesterdayBalanceLots: null, marginTodayBalanceLots: null, marginBalanceChangeLots: null,
  shortYesterdayBalanceLots: null, shortTodayBalanceLots: null, shortBalanceChangeLots: null });

type UnknownRecord = Record<string, unknown>;
const TPEX_INSTITUTIONAL_FIELDS = ["代號", "名稱", "買進股數", "賣出股數", "買賣超股數", "買進股數", "賣出股數", "買賣超股數",
  "買進股數", "賣出股數", "買賣超股數", "買進股數", "賣出股數", "買賣超股數", "買進股數", "賣出股數", "買賣超股數",
  "買進股數", "賣出股數", "買賣超股數", "買進股數", "賣出股數", "買賣超股數", "三大法人買賣超股數合計"];
const TPEX_MARGIN_FIELDS = ["代號", "名稱", "前資餘額(張)", "資買", "資賣", "現償", "資餘額", "資屬證金", "資使用率(%)", "資限額",
  "前券餘額(張)", "券賣", "券買", "券償", "券餘額", "券屬證金", "券使用率(%)", "券限額", "資券相抵(張)", "備註"];

function tpexHistoricalTable(payload: unknown, fields: readonly string[], requestedDate: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const report = payload as UnknownRecord;
  if (String(report.stat).toLowerCase() !== "ok" || reportDate(report.date) !== requestedDate || !Array.isArray(report.tables)) return null;
  const table = (report.tables as UnknownRecord[]).find((candidate) => Array.isArray(candidate.fields)
    && JSON.stringify(candidate.fields.map((field) => String(field).trim())) === JSON.stringify(fields)
    && Array.isArray(candidate.data));
  return table && Array.isArray(table.data) ? table.data as unknown[][] : null;
}

function normalizeTpexHistorical(payload: unknown, stock: UniverseStock, dataset: ScreenerChipDataset,
  requestedDate: string, fetchedAt: string): ChipDailyRow[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const fields = dataset === "institutional-flow" ? TPEX_INSTITUTIONAL_FIELDS : TPEX_MARGIN_FIELDS;
  const data = tpexHistoricalTable(payload, fields, requestedDate);
  if (!data) return [];
  const code = stock.symbol.split(".")[0];
  const source = data.find((row) => Array.isArray(row) && String(row[0] ?? "").trim() === code);
  if (!source) return [];
  const row = emptyDaily(stock.symbol, requestedDate);
  if (dataset === "institutional-flow") {
    row.institutionalFlow = {
      foreignBuyShares: null, foreignSellShares: null, foreignNetShares: null,
      investmentTrustBuyShares: numeric(source[11]), investmentTrustSellShares: numeric(source[12]), investmentTrustNetShares: numeric(source[13]),
      dealerSelfNetShares: null, dealerHedgingNetShares: null, dealerTotalNetShares: null,
      institutionalTotalNetShares: null, sourceTotalNetShares: numeric(source[23]), sourceTotalVerified: null,
    };
  } else {
    const marginYesterday = numeric(source[2]), marginToday = numeric(source[6]);
    const shortYesterday = numeric(source[10]), shortToday = numeric(source[14]);
    row.marginShort = {
      marginBuyLots: numeric(source[3]), marginSellLots: numeric(source[4]), marginCashRepaymentLots: numeric(source[5]),
      marginYesterdayBalanceLots: marginYesterday, marginTodayBalanceLots: marginToday,
      marginBalanceChangeLots: marginYesterday === null || marginToday === null ? null : marginToday - marginYesterday,
      marginLimitLots: numeric(source[9]), marginUtilizationPercent: null,
      shortBuyLots: numeric(source[12]), shortSellLots: numeric(source[11]), shortCashRepaymentLots: numeric(source[13]),
      shortYesterdayBalanceLots: shortYesterday, shortTodayBalanceLots: shortToday,
      shortBalanceChangeLots: shortYesterday === null || shortToday === null ? null : shortToday - shortYesterday,
      shortLimitLots: numeric(source[17]), shortUtilizationPercent: null, offsetLots: numeric(source[18]),
    };
  }
  row.provenance[dataset] = { provider: "tpex", dataset, frequency: "daily", sourceDate: requestedDate,
    sourceDateVerified: true, fetchedAt };
  return [row];
}

function normalize(payload: unknown, stock: UniverseStock, dataset: ScreenerChipDataset, requestedDate: string, fetchedAt: string): ChipDailyRow[] {
  if (stock.market === "TWSE" && dataset === "institutional-flow") return normalizeTwseInstitutionalLatest(payload, stock.symbol, fetchedAt);
  if (stock.market === "TWSE") return normalizeTwseMarginReport(payload, stock.symbol, fetchedAt);
  const historical = normalizeTpexHistorical(payload, stock, dataset, requestedDate, fetchedAt);
  if (historical) return historical;
  if (dataset === "institutional-flow") return normalizeTpexInstitutionalLatest(payload, stock.symbol, fetchedAt);
  return normalizeTpexMarginLatest(payload, stock.symbol, fetchedAt);
}

/** Parse one official market-wide report. Missing securities remain explicit missing rows, never fabricated zeroes. */
export function parseOfficialChipBatch(payload: unknown, market: ScreenerMarket, dataset: ScreenerChipDataset,
  requestedDate: string, universe: readonly UniverseStock[], fetchedAt: string) {
  if (!Array.isArray(payload) && (!payload || typeof payload !== "object")) throw new Error("invalid_report_schema");
  const eligible = universe.filter((stock) => stock.market === market && (!stock.listingDate || stock.listingDate <= requestedDate));
  if (!eligible.length || eligible.length > 5000) throw new Error("invalid_report_universe");
  const rows: CanonicalScreenerChipRow[] = [], missing: string[] = [], invalid: Record<string, string> = {};
  for (const stock of eligible) {
    const candidates = normalize(payload, stock, dataset, requestedDate, fetchedAt);
    if (candidates.length > 1) throw new Error("duplicate_security");
    const candidate = candidates[0];
    if (!candidate) { missing.push(stock.symbol); continue; }
    if (candidate.sessionDate !== requestedDate) throw new Error("report_date_mismatch");
    const row = empty(stock, requestedDate);
    if (dataset === "institutional-flow") {
      if (!candidate.institutionalFlow) { invalid[stock.symbol] = "missing_institutional_flow"; continue; }
      row.investmentTrustBuyShares = integer(candidate.institutionalFlow.investmentTrustBuyShares);
      row.investmentTrustSellShares = integer(candidate.institutionalFlow.investmentTrustSellShares);
      row.investmentTrustNetShares = integer(candidate.institutionalFlow.investmentTrustNetShares);
      if (row.investmentTrustBuyShares === null || row.investmentTrustSellShares === null || row.investmentTrustNetShares === null
        || BigInt(row.investmentTrustBuyShares) - BigInt(row.investmentTrustSellShares) !== BigInt(row.investmentTrustNetShares)) {
        invalid[stock.symbol] = "invalid_investment_trust_totals"; continue;
      }
    } else {
      if (!candidate.marginShort) { invalid[stock.symbol] = "missing_margin_short"; continue; }
      row.marginYesterdayBalanceLots = integer(candidate.marginShort.marginYesterdayBalanceLots);
      row.marginTodayBalanceLots = integer(candidate.marginShort.marginTodayBalanceLots);
      row.marginBalanceChangeLots = integer(candidate.marginShort.marginBalanceChangeLots);
      row.shortYesterdayBalanceLots = integer(candidate.marginShort.shortYesterdayBalanceLots);
      row.shortTodayBalanceLots = integer(candidate.marginShort.shortTodayBalanceLots);
      row.shortBalanceChangeLots = integer(candidate.marginShort.shortBalanceChangeLots);
      if ([row.marginYesterdayBalanceLots, row.marginTodayBalanceLots, row.shortYesterdayBalanceLots, row.shortTodayBalanceLots]
        .some((value) => value === null || BigInt(value!) < BigInt(0))) { invalid[stock.symbol] = "invalid_margin_balances"; continue; }
      if (BigInt(row.marginTodayBalanceLots!) - BigInt(row.marginYesterdayBalanceLots!) !== BigInt(row.marginBalanceChangeLots!)
        || BigInt(row.shortTodayBalanceLots!) - BigInt(row.shortYesterdayBalanceLots!) !== BigInt(row.shortBalanceChangeLots!)) {
        invalid[stock.symbol] = "invalid_balance_change"; continue;
      }
    }
    rows.push(row);
  }
  if (!rows.length) throw new Error("empty_report");
  return { market, dataset, requestedDate, sourceDate: requestedDate, rows, target: eligible.length, missing, invalid,
    normalizationVersion: SCREENER_CHIP_NORMALIZATION_VERSION };
}

export async function chipPayloadHash(payload: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
