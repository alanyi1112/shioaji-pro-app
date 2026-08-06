export const CHIP_DATASETS = [
  "institutional-flow",
  "foreign-holding",
  "margin-short",
  "securities-lending",
  "shareholder-distribution",
] as const;

export type ChipDataset = typeof CHIP_DATASETS[number];
export type ChipFrequency = "daily" | "weekly";
export type ChipReasonCode =
  | "available"
  | "partial_data"
  | "stale_cache"
  | "not_published"
  | "history_not_archived"
  | "provider_unavailable"
  | "rate_limited"
  | "not_eligible"
  | "unsupported_interval"
  | "history_source_unverified"
  | "invalid_response";

export type ChipDatasetEligibility = {
  supported: boolean;
  reason: "supported" | "not_eligible" | "unsupported_interval";
  providers: ChipProvenance["provider"][];
};

export type ChipProvenance = {
  provider: "finmind" | "twse" | "tpex" | "tdcc";
  dataset: ChipDataset;
  frequency: ChipFrequency;
  sourceDate: string | null;
  sourceDateVerified?: boolean;
  fetchedAt: string;
};

export type ChipCoverage = {
  dataset: ChipDataset;
  start: string | null;
  end: string | null;
  frequency: ChipFrequency;
  status: ChipReasonCode;
};

export type InstitutionalFlow = {
  foreignBuyShares: number | null;
  foreignSellShares: number | null;
  foreignNetShares: number | null;
  investmentTrustBuyShares: number | null;
  investmentTrustSellShares: number | null;
  investmentTrustNetShares: number | null;
  dealerSelfNetShares: number | null;
  dealerHedgingNetShares: number | null;
  dealerTotalNetShares: number | null;
  institutionalTotalNetShares: number | null;
  sourceTotalNetShares: number | null;
  sourceTotalVerified: boolean | null;
};

export type ForeignHolding = {
  heldShares: number | null;
  issuedShares: number | null;
  heldRatioPercent: number | null;
  recentlyDeclaredDate: string | null;
};

export type MarginShort = {
  marginBuyLots: number | null;
  marginSellLots: number | null;
  marginCashRepaymentLots: number | null;
  marginYesterdayBalanceLots: number | null;
  marginTodayBalanceLots: number | null;
  marginBalanceChangeLots: number | null;
  marginLimitLots: number | null;
  marginUtilizationPercent: number | null;
  shortBuyLots: number | null;
  shortSellLots: number | null;
  shortCashRepaymentLots: number | null;
  shortYesterdayBalanceLots: number | null;
  shortTodayBalanceLots: number | null;
  shortBalanceChangeLots: number | null;
  shortLimitLots: number | null;
  shortUtilizationPercent: number | null;
  offsetLots: number | null;
  estimatedCostPrice?: number | null;
  estimatedMaintenancePercent?: number | null;
  marginLoanRatioPercent?: number | null;
  marginLoanRatioSource?: string | null;
  marginLoanRatioSourceDate?: string | null;
  estimatedMarginSeeded?: boolean;
  estimatedMarginReseeded?: boolean;
  estimatedMarginStatus?: "available" | "seeded" | "reseeded" | "empty" | "partial" | "unavailable";
  estimatedMarginReasonCode?: string;
  estimatedMaintenanceReasonCode?: string;
  estimatedMarginFormulaVersion?: string;
  estimatedMarginClose?: number | null;
};

export type SecuritiesLending = {
  transactionShares: number | null;
  balanceShares: number | null;
  shortSaleBalanceShares: number | null;
};

export type ChipDailyRow = {
  symbol: string;
  sessionDate: string;
  institutionalFlow: InstitutionalFlow | null;
  foreignHolding: ForeignHolding | null;
  marginShort: MarginShort | null;
  securitiesLending: SecuritiesLending | null;
  provenance: Partial<Record<Exclude<ChipDataset, "shareholder-distribution">, ChipProvenance>>;
};

export type DistributionLevel = {
  level: number;
  range: string;
  holders: number;
  shares: number;
  ratioPercent: number;
};

export type DistributionRow = {
  symbol: string;
  dataDate: string;
  levels: DistributionLevel[];
  adjustment: DistributionLevel;
  total: DistributionLevel;
  provenance: ChipProvenance;
};

export type DistributionAggregate = {
  kind: "large-holder-tier" | "large-holder-400" | "retail-holder-tiers";
  levelIds: number[];
  description: string;
  holders: number;
  shares: number;
  lots: number;
  ratioPercent: number;
};

export type ChipAdapter<T> = {
  dataset: ChipDataset;
  provider: ChipProvenance["provider"];
  frequency: ChipFrequency;
  fetch(input: { symbol: string; start: string; end: string; signal?: AbortSignal }): Promise<T[]>;
};

type UnknownRecord = Record<string, unknown>;

export const TDCC_LEVEL_RANGES: Record<number, string> = {
  1: "1-999 股", 2: "1,000-5,000 股", 3: "5,001-10,000 股", 4: "10,001-15,000 股", 5: "15,001-20,000 股",
  6: "20,001-30,000 股", 7: "30,001-40,000 股", 8: "40,001-50,000 股", 9: "50,001-100,000 股", 10: "100,001-200,000 股",
  11: "200,001-400,000 股", 12: "400,001-600,000 股", 13: "600,001-800,000 股", 14: "800,001-1,000,000 股", 15: "1,000,001 股以上",
  16: "差異數調整", 17: "合計",
};

const isoDate = (value: unknown): string | null => {
  const text = String(value ?? "").trim().replaceAll("/", "-");
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};

const finite = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).replaceAll(",", "").replaceAll("%", "").trim());
  return Number.isFinite(number) ? number : null;
};

const integer = (value: unknown): number | null => {
  const number = finite(value);
  return number === null || !Number.isInteger(number) ? null : number;
};

const ratio = (value: unknown): number | null => {
  const number = finite(value);
  return number !== null && number >= 0 && number <= 100 ? number : null;
};

const signedRatio = (value: unknown): number | null => {
  const number = finite(value);
  return number !== null && number >= -100 && number <= 100 ? number : null;
};

const canonicalSymbol = (stockId: string, suffix?: "TW" | "TWO") => {
  const normalized = stockId.trim().toUpperCase();
  if (/^[0-9A-Z]{4,8}\.(TW|TWO)$/.test(normalized)) return normalized;
  if (!/^[0-9A-Z]{4,8}$/.test(normalized) || !suffix) throw new Error("invalid_symbol");
  return `${normalized}.${suffix}`;
};

const stockCode = (symbol: string) => canonicalSymbol(symbol).split(".")[0];
const sourceNow = (fetchedAt?: string) => fetchedAt || new Date().toISOString();

export const emptyDaily = (symbol: string, sessionDate: string): ChipDailyRow => ({
  symbol,
  sessionDate,
  institutionalFlow: null,
  foreignHolding: null,
  marginShort: null,
  securitiesLending: null,
  provenance: {},
});

const rocDate = (value: unknown) => {
  const text = String(value ?? "").trim();
  if (!/^\d{7}$/.test(text)) return isoDate(value);
  const year = Number(text.slice(0, 3)) + 1911;
  return isoDate(`${year}${text.slice(3)}`);
};

const firstFinite = (row: UnknownRecord, keys: string[]) => {
  for (const key of keys) { const value = finite(row[key]); if (value !== null) return value; }
  return null;
};

const utilizationPercent = (todayBalance: number | null, limit: number | null, published?: unknown) => {
  const sourceValue = ratio(published);
  if (sourceValue !== null) return sourceValue;
  return todayBalance !== null && todayBalance >= 0 && limit !== null && limit > 0
    ? todayBalance / limit * 100
    : null;
};

const verifiedDifference = (buy: number | null, sell: number | null, published: number | null) => {
  if (buy === null || sell === null || published === null) return null;
  return buy - sell === published ? published : null;
};

const completeSum = (...values: Array<number | null>) => values.every((value) => value !== null)
  ? values.reduce<number>((sum, value) => sum + (value as number), 0)
  : null;

export function normalizeTpexInstitutionalLatest(payload: unknown, symbol: string, fetchedAt?: string): ChipDailyRow[] {
  const canonical = canonicalSymbol(symbol);
  const code = stockCode(canonical);
  if (!Array.isArray(payload)) return [];
  return (payload as UnknownRecord[]).flatMap((raw) => {
    if (String(raw.SecuritiesCompanyCode ?? "").trim() !== code) return [];
    const sessionDate = rocDate(raw.Date);
    if (!sessionDate) return [];
    const row = emptyDaily(canonical, sessionDate);
    row.institutionalFlow = {
      foreignBuyShares: firstFinite(raw, ["ForeignInvestorsIncludeMainlandAreaInvestors-TotalBuy", "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Total Buy", "ForeignInvestorsInclude MainlandAreaInvestors-Buy", "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Buy"]),
      foreignSellShares: firstFinite(raw, ["ForeignInvestorsIncludeMainlandAreaInvestors-TotalSell", "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Total Sell", "ForeignInvestorsInclude MainlandAreaInvestors-Sell", "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Sell"]),
      foreignNetShares: firstFinite(raw, ["ForeignInvestorsInclude MainlandAreaInvestors-Difference", "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference"]),
      investmentTrustBuyShares: firstFinite(raw, ["SecuritiesInvestmentTrustCompanies-TotalBuy", "SecuritiesInvestmentTrustCompanies-Buy"]),
      investmentTrustSellShares: firstFinite(raw, ["SecuritiesInvestmentTrustCompanies-TotalSell", "SecuritiesInvestmentTrustCompanies-Sell"]),
      investmentTrustNetShares: finite(raw["SecuritiesInvestmentTrustCompanies-Difference"]),
      dealerSelfNetShares: null,
      dealerHedgingNetShares: null,
      dealerTotalNetShares: null,
      institutionalTotalNetShares: null,
      sourceTotalNetShares: finite(raw.TotalDifference),
      sourceTotalVerified: null,
    };
    row.provenance["institutional-flow"] = { provider: "tpex", dataset: "institutional-flow", frequency: "daily", sourceDate: sessionDate, fetchedAt: sourceNow(fetchedAt) };
    return [row];
  });
}

export function normalizeTpexForeignHoldingLatest(payload: unknown, symbol: string, fetchedAt?: string): ChipDailyRow[] {
  const canonical = canonicalSymbol(symbol);
  const code = stockCode(canonical);
  if (!Array.isArray(payload)) return [];
  return (payload as UnknownRecord[]).flatMap((raw) => {
    if (String(raw.SecuritiesCompanyCode ?? "").trim() !== code) return [];
    const sessionDate = rocDate(raw.Date);
    if (!sessionDate) return [];
    const row = emptyDaily(canonical, sessionDate);
    row.foreignHolding = {
      heldShares: finite(raw["CurrentlySharesOC/FIHeld"]),
      issuedShares: finite(raw.NumberOfSharesIssued),
      heldRatioPercent: ratio(raw["PercentageOfSharesOC/FMIHeld"]),
      recentlyDeclaredDate: null,
    };
    row.provenance["foreign-holding"] = { provider: "tpex", dataset: "foreign-holding", frequency: "daily", sourceDate: sessionDate, fetchedAt: sourceNow(fetchedAt) };
    return [row];
  });
}

export function normalizeTpexMarginLatest(payload: unknown, symbol: string, fetchedAt?: string): ChipDailyRow[] {
  const canonical = canonicalSymbol(symbol);
  const code = stockCode(canonical);
  if (!Array.isArray(payload)) return [];
  return (payload as UnknownRecord[]).flatMap((raw) => {
    if (String(raw.SecuritiesCompanyCode ?? "").trim() !== code) return [];
    const sessionDate = rocDate(raw.Date);
    if (!sessionDate) return [];
    const marginYesterday = finite(raw.MarginPurchaseBalancePreviousDay); const marginToday = finite(raw.MarginPurchaseBalance);
    const shortYesterday = finite(raw.ShortSaleBalancePreviousDay); const shortToday = finite(raw.ShortSaleBalance);
    const marginLimit = finite(raw.MarginPurchaseQuota);
    const shortLimit = finite(raw.ShortSaleQuota);
    const row = emptyDaily(canonical, sessionDate);
    row.marginShort = {
      marginBuyLots: finite(raw.MarginPurchase), marginSellLots: finite(raw.MarginSales), marginCashRepaymentLots: finite(raw.CashRedemption), marginYesterdayBalanceLots: marginYesterday, marginTodayBalanceLots: marginToday, marginBalanceChangeLots: marginYesterday !== null && marginToday !== null ? marginToday - marginYesterday : null,
      marginLimitLots: marginLimit, marginUtilizationPercent: utilizationPercent(marginToday, marginLimit, raw.MarginPurchaseUtilizationRate),
      shortBuyLots: finite(raw.ShortConvering), shortSellLots: finite(raw.ShortSale), shortCashRepaymentLots: finite(raw.StockRedemption), shortYesterdayBalanceLots: shortYesterday, shortTodayBalanceLots: shortToday, shortBalanceChangeLots: shortYesterday !== null && shortToday !== null ? shortToday - shortYesterday : null,
      shortLimitLots: shortLimit, shortUtilizationPercent: utilizationPercent(shortToday, shortLimit, raw.ShortSaleUtilizationRate),
      offsetLots: finite(raw.Offsetting),
    };
    row.provenance["margin-short"] = { provider: "tpex", dataset: "margin-short", frequency: "daily", sourceDate: sessionDate, fetchedAt: sourceNow(fetchedAt) };
    return [row];
  });
}

export function normalizeTwseInstitutionalLatest(payload: unknown, symbol: string, fetchedAt?: string): ChipDailyRow[] {
  const canonical = canonicalSymbol(symbol);
  const code = stockCode(canonical);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const report = payload as UnknownRecord;
  const sessionDate = isoDate(report.date);
  if (String(report.stat || "") !== "OK" || !sessionDate || !Array.isArray(report.fields) || !Array.isArray(report.data)) return [];
  const fields = (report.fields as unknown[]).map((field) => String(field || "").trim());
  const requiredFields = [
    "證券代號",
    "外陸資買進股數(不含外資自營商)",
    "外陸資賣出股數(不含外資自營商)",
    "外陸資買賣超股數(不含外資自營商)",
    "外資自營商買進股數",
    "外資自營商賣出股數",
    "外資自營商買賣超股數",
    "投信買進股數",
    "投信賣出股數",
    "投信買賣超股數",
    "自營商買賣超股數",
    "自營商買賣超股數(自行買賣)",
    "自營商買賣超股數(避險)",
    "三大法人買賣超股數",
  ];
  if (requiredFields.some((field) => !fields.includes(field))) return [];
  const indexes = new Map(fields.map((field, index) => [field, index]));
  const value = (row: unknown[], field: string) => finite(row[indexes.get(field)!]);
  return (report.data as unknown[]).flatMap((candidate) => {
    if (!Array.isArray(candidate) || String(candidate[indexes.get("證券代號")!]).trim() !== code) return [];
    const foreignRegularBuy = value(candidate, "外陸資買進股數(不含外資自營商)");
    const foreignRegularSell = value(candidate, "外陸資賣出股數(不含外資自營商)");
    const foreignRegularNet = verifiedDifference(foreignRegularBuy, foreignRegularSell, value(candidate, "外陸資買賣超股數(不含外資自營商)"));
    const foreignDealerBuy = value(candidate, "外資自營商買進股數");
    const foreignDealerSell = value(candidate, "外資自營商賣出股數");
    const foreignDealerNet = verifiedDifference(foreignDealerBuy, foreignDealerSell, value(candidate, "外資自營商買賣超股數"));
    const foreignBuy = completeSum(foreignRegularBuy, foreignDealerBuy);
    const foreignSell = completeSum(foreignRegularSell, foreignDealerSell);
    const foreignNet = completeSum(foreignRegularNet, foreignDealerNet);
    const trustBuy = value(candidate, "投信買進股數");
    const trustSell = value(candidate, "投信賣出股數");
    const trustNet = verifiedDifference(trustBuy, trustSell, value(candidate, "投信買賣超股數"));
    const dealerSelfNet = value(candidate, "自營商買賣超股數(自行買賣)");
    const dealerHedgingNet = value(candidate, "自營商買賣超股數(避險)");
    const publishedDealerTotal = value(candidate, "自營商買賣超股數");
    const calculatedDealerTotal = completeSum(dealerSelfNet, dealerHedgingNet);
    const dealerTotal = calculatedDealerTotal !== null && calculatedDealerTotal === publishedDealerTotal ? calculatedDealerTotal : null;
    const calculatedInstitutionalTotal = completeSum(foreignNet, trustNet, dealerTotal);
    const sourceTotal = value(candidate, "三大法人買賣超股數");
    const sourceTotalVerified = calculatedInstitutionalTotal === null || sourceTotal === null ? null : calculatedInstitutionalTotal === sourceTotal;
    const row = emptyDaily(canonical, sessionDate);
    row.institutionalFlow = {
      foreignBuyShares: foreignBuy,
      foreignSellShares: foreignSell,
      foreignNetShares: foreignNet,
      investmentTrustBuyShares: trustBuy,
      investmentTrustSellShares: trustSell,
      investmentTrustNetShares: trustNet,
      dealerSelfNetShares: dealerSelfNet,
      dealerHedgingNetShares: dealerHedgingNet,
      dealerTotalNetShares: dealerTotal,
      institutionalTotalNetShares: sourceTotalVerified ? calculatedInstitutionalTotal : null,
      sourceTotalNetShares: sourceTotal,
      sourceTotalVerified,
    };
    row.provenance["institutional-flow"] = { provider: "twse", dataset: "institutional-flow", frequency: "daily", sourceDate: sessionDate, fetchedAt: sourceNow(fetchedAt) };
    return [row];
  });
}

export function normalizeTwseMarginReport(payload: unknown, symbol: string, fetchedAt?: string): ChipDailyRow[] {
  const canonical = canonicalSymbol(symbol);
  const code = stockCode(canonical);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const report = payload as UnknownRecord;
  const date = isoDate(report.date);
  if (String(report.stat || "") !== "OK" || !date || !Array.isArray(report.tables)) return [];
  const expectedFields = ["代號", "名稱", "買進", "賣出", "現金償還", "前日餘額", "今日餘額", "次一營業日限額", "買進", "賣出", "現券償還", "前日餘額", "今日餘額", "次一營業日限額", "資券互抵", "註記"];
  const expectedGroups = [{ title: "股票", span: 2 }, { title: "融資", span: 6 }, { title: "融券", span: 6 }, { title: "", span: 1 }, { title: "", span: 1 }];
  const table = (report.tables as UnknownRecord[]).find((candidate) => {
    const fields = Array.isArray(candidate.fields) ? candidate.fields.map((field) => String(field || "").trim()) : [];
    const groups = Array.isArray(candidate.groups) ? candidate.groups.map((group) => {
      const value = group as UnknownRecord;
      return { title: String(value.title || "").trim(), span: Number(value.span) };
    }) : [];
    return JSON.stringify(fields) === JSON.stringify(expectedFields) && JSON.stringify(groups) === JSON.stringify(expectedGroups) && Array.isArray(candidate.data);
  });
  if (!table || !Array.isArray(table.data)) return [];
  const source = (table.data as unknown[][]).find((raw) => Array.isArray(raw) && String(raw[0] ?? "").trim() === code);
  if (!source || source.length < expectedFields.length) return [];
  const marginYesterday = finite(source[5]); const marginToday = finite(source[6]);
  const shortYesterday = finite(source[11]); const shortToday = finite(source[12]);
  const marginLimit = finite(source[7]); const shortLimit = finite(source[13]);
  const row = emptyDaily(canonical, date);
  row.marginShort = {
    marginBuyLots: finite(source[2]), marginSellLots: finite(source[3]), marginCashRepaymentLots: finite(source[4]), marginYesterdayBalanceLots: marginYesterday, marginTodayBalanceLots: marginToday, marginBalanceChangeLots: marginYesterday !== null && marginToday !== null ? marginToday - marginYesterday : null,
    marginLimitLots: marginLimit, marginUtilizationPercent: utilizationPercent(marginToday, marginLimit),
    shortBuyLots: finite(source[8]), shortSellLots: finite(source[9]), shortCashRepaymentLots: finite(source[10]), shortYesterdayBalanceLots: shortYesterday, shortTodayBalanceLots: shortToday, shortBalanceChangeLots: shortYesterday !== null && shortToday !== null ? shortToday - shortYesterday : null,
    shortLimitLots: shortLimit, shortUtilizationPercent: utilizationPercent(shortToday, shortLimit),
    offsetLots: finite(source[14]),
  };
  row.provenance["margin-short"] = { provider: "twse", dataset: "margin-short", frequency: "daily", sourceDate: date, sourceDateVerified: true, fetchedAt: sourceNow(fetchedAt) };
  return [row];
}

function sortedUnique<T extends { sessionDate: string }>(rows: T[]) {
  return [...new Map(rows.map((row) => [row.sessionDate, row])).values()].sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
}

export function normalizeInstitutionalRows(payload: unknown, symbol: string, fetchedAt?: string): ChipDailyRow[] {
  const canonical = canonicalSymbol(symbol);
  const code = stockCode(canonical);
  if (!Array.isArray(payload)) return [];
  const dates = new Map<string, Map<string, { buy: number; sell: number }>>();
  const sourceTotals = new Map<string, number>();
  for (const raw of payload as UnknownRecord[]) {
    if (String(raw.stock_id ?? "").trim() !== code) continue;
    const date = isoDate(raw.date);
    if (!date) continue;
    const name = String(raw.name ?? "").trim();
    const buy = finite(raw.buy);
    const sell = finite(raw.sell);
    if (name === "Institutional_Total") {
      const total = finite(raw.net ?? (buy !== null && sell !== null ? buy - sell : null));
      if (total !== null) sourceTotals.set(date, total);
      continue;
    }
    if (!name || buy === null || sell === null) continue;
    const byName = dates.get(date) || new Map();
    const previous = byName.get(name) || { buy: 0, sell: 0 };
    byName.set(name, { buy: previous.buy + buy, sell: previous.sell + sell });
    dates.set(date, byName);
  }
  return [...dates.entries()].map(([sessionDate, groups]) => {
    const gross = (name: string, side: "buy" | "sell") => groups.has(name) ? groups.get(name)![side] : null;
    const net = (name: string) => groups.has(name) ? groups.get(name)!.buy - groups.get(name)!.sell : null;
    const sumComplete = (...values: Array<number | null>) => values.every((value) => value !== null) ? values.reduce<number>((sum, value) => sum + (value as number), 0) : null;
    const foreign = sumComplete(net("Foreign_Investor"), net("Foreign_Dealer_Self"));
    const foreignBuy = sumComplete(gross("Foreign_Investor", "buy"), gross("Foreign_Dealer_Self", "buy"));
    const foreignSell = sumComplete(gross("Foreign_Investor", "sell"), gross("Foreign_Dealer_Self", "sell"));
    const trust = net("Investment_Trust");
    const dealerSelf = net("Dealer_self");
    const dealerHedging = net("Dealer_Hedging");
    const dealerTotal = sumComplete(dealerSelf, dealerHedging);
    const calculatedInstitutionalTotal = sumComplete(foreign, trust, dealerTotal);
    const sourceTotal = sourceTotals.get(sessionDate) ?? null;
    const sourceTotalVerified = sourceTotal === null || calculatedInstitutionalTotal === null ? null : sourceTotal === calculatedInstitutionalTotal;
    const institutionalTotal = sourceTotalVerified === false ? null : calculatedInstitutionalTotal;
    const row = emptyDaily(canonical, sessionDate);
    row.institutionalFlow = {
      foreignBuyShares: foreignBuy,
      foreignSellShares: foreignSell,
      foreignNetShares: foreign,
      investmentTrustBuyShares: gross("Investment_Trust", "buy"),
      investmentTrustSellShares: gross("Investment_Trust", "sell"),
      investmentTrustNetShares: trust,
      dealerSelfNetShares: dealerSelf,
      dealerHedgingNetShares: dealerHedging,
      dealerTotalNetShares: dealerTotal,
      institutionalTotalNetShares: institutionalTotal,
      sourceTotalNetShares: sourceTotal,
      sourceTotalVerified,
    };
    row.provenance["institutional-flow"] = { provider: "finmind", dataset: "institutional-flow", frequency: "daily", sourceDate: sessionDate, fetchedAt: sourceNow(fetchedAt) };
    return row;
  }).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
}

export function normalizeForeignHoldingRows(payload: unknown, symbol: string, fetchedAt?: string): ChipDailyRow[] {
  const canonical = canonicalSymbol(symbol);
  const code = stockCode(canonical);
  if (!Array.isArray(payload)) return [];
  return sortedUnique((payload as UnknownRecord[]).flatMap((raw) => {
    if (String(raw.stock_id ?? "").trim() !== code) return [];
    const sessionDate = isoDate(raw.date);
    if (!sessionDate) return [];
    const heldShares = finite(raw.ForeignInvestmentShares);
    const issuedShares = finite(raw.NumberOfSharesIssued);
    const publishedRatio = ratio(raw.ForeignInvestmentSharesRatio);
    const row = emptyDaily(canonical, sessionDate);
    row.foreignHolding = { heldShares, issuedShares, heldRatioPercent: publishedRatio, recentlyDeclaredDate: isoDate(raw.RecentlyDeclareDate) };
    row.provenance["foreign-holding"] = { provider: "finmind", dataset: "foreign-holding", frequency: "daily", sourceDate: sessionDate, fetchedAt: sourceNow(fetchedAt) };
    return [row];
  }));
}

export function normalizeMarginShortRows(payload: unknown, symbol: string, fetchedAt?: string): ChipDailyRow[] {
  const canonical = canonicalSymbol(symbol);
  const code = stockCode(canonical);
  if (!Array.isArray(payload)) return [];
  return sortedUnique((payload as UnknownRecord[]).flatMap((raw) => {
    if (String(raw.stock_id ?? "").trim() !== code) return [];
    const sessionDate = isoDate(raw.date);
    if (!sessionDate) return [];
    const marginYesterday = finite(raw.MarginPurchaseYesterdayBalance);
    const marginToday = finite(raw.MarginPurchaseTodayBalance);
    const shortYesterday = finite(raw.ShortSaleYesterdayBalance);
    const shortToday = finite(raw.ShortSaleTodayBalance);
    const marginLimit = finite(raw.MarginPurchaseLimit);
    const shortLimit = finite(raw.ShortSaleLimit);
    const row = emptyDaily(canonical, sessionDate);
    row.marginShort = {
      marginBuyLots: finite(raw.MarginPurchaseBuy), marginSellLots: finite(raw.MarginPurchaseSell), marginCashRepaymentLots: finite(raw.MarginPurchaseCashRepayment),
      marginYesterdayBalanceLots: marginYesterday, marginTodayBalanceLots: marginToday, marginBalanceChangeLots: marginYesterday !== null && marginToday !== null ? marginToday - marginYesterday : null,
      marginLimitLots: marginLimit, marginUtilizationPercent: utilizationPercent(marginToday, marginLimit),
      shortBuyLots: finite(raw.ShortSaleBuy), shortSellLots: finite(raw.ShortSaleSell), shortCashRepaymentLots: finite(raw.ShortSaleCashRepayment),
      shortYesterdayBalanceLots: shortYesterday, shortTodayBalanceLots: shortToday, shortBalanceChangeLots: shortYesterday !== null && shortToday !== null ? shortToday - shortYesterday : null,
      shortLimitLots: shortLimit, shortUtilizationPercent: utilizationPercent(shortToday, shortLimit),
      offsetLots: finite(raw.OffsetLoanAndShort),
    };
    row.provenance["margin-short"] = { provider: "finmind", dataset: "margin-short", frequency: "daily", sourceDate: sessionDate, fetchedAt: sourceNow(fetchedAt) };
    return [row];
  }));
}

export function normalizeSecuritiesLendingRows(payload: unknown, symbol: string, fetchedAt?: string): ChipDailyRow[] {
  const canonical = canonicalSymbol(symbol);
  const code = stockCode(canonical);
  if (!Array.isArray(payload)) return [];
  const dates = new Map<string, number>();
  for (const raw of payload as UnknownRecord[]) {
    if (String(raw.stock_id ?? "").trim() !== code) continue;
    const date = isoDate(raw.date);
    const volume = finite(raw.volume);
    if (!date || volume === null) continue;
    dates.set(date, (dates.get(date) || 0) + volume);
  }
  return [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([sessionDate, transactionShares]) => {
    const row = emptyDaily(canonical, sessionDate);
    row.securitiesLending = { transactionShares, balanceShares: null, shortSaleBalanceShares: null };
    row.provenance["securities-lending"] = { provider: "finmind", dataset: "securities-lending", frequency: "daily", sourceDate: sessionDate, fetchedAt: sourceNow(fetchedAt) };
    return row;
  });
}

function normalizedKeys(raw: UnknownRecord) {
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key.replace(/^\uFEFF/, "").trim(), value]));
}

export function parseTdccSnapshot(payload: unknown, eligibleSymbols?: ReadonlySet<string>, fetchedAt?: string): DistributionRow[] {
  if (!Array.isArray(payload)) throw new Error("invalid_response");
  const groups = new Map<string, { dataDate: string; levels: Map<number, DistributionLevel> }>();
  for (const source of payload as UnknownRecord[]) {
    const raw = normalizedKeys(source);
    const code = String(raw["證券代號"] ?? raw["證券代碼"] ?? "").trim();
    if (!/^[0-9A-Z]{4,8}$/.test(code)) continue;
    const candidates = [`${code}.TW`, `${code}.TWO`];
    const symbol = eligibleSymbols ? candidates.find((candidate) => eligibleSymbols.has(candidate)) : candidates[0];
    if (!symbol) continue;
    const dataDate = isoDate(raw["資料日期"] ?? raw["\ufeff資料日期"]);
    const level = integer(raw["持股分級"]);
    const holders = integer(raw["人數"]);
    const shares = integer(raw["股數"]);
    const ratioValue = raw["占集保庫存數比例%"] ?? raw["占集保庫存數比例"];
    const ratioPercent = level === 16 ? signedRatio(ratioValue) : ratio(ratioValue);
    const range = String(raw["持股數分級"] ?? raw["持股分級說明"] ?? TDCC_LEVEL_RANGES[level || 0] ?? "").trim();
    if (!dataDate || level === null || level < 1 || level > 17 || holders === null || shares === null || ratioPercent === null || !range) throw new Error("invalid_response");
    const existing = groups.get(symbol) || { dataDate, levels: new Map() };
    if (existing.dataDate !== dataDate || existing.levels.has(level)) throw new Error("invalid_response");
    existing.levels.set(level, { level, range, holders, shares, ratioPercent });
    groups.set(symbol, existing);
  }
  const rows: DistributionRow[] = [...groups.entries()].map(([symbol, group]) => {
    if ([...Array(17)].some((_, index) => !group.levels.has(index + 1))) throw new Error("invalid_response");
    const levels = [...Array(15)].map((_, index) => group.levels.get(index + 1)!);
    const adjustment = group.levels.get(16)!;
    const total = group.levels.get(17)!;
    const holdersTotal = levels.reduce((sum, item) => sum + item.holders, 0);
    const sharesSubtotal = levels.reduce((sum, item) => sum + item.shares, 0);
    const ratioSubtotal = levels.reduce((sum, item) => sum + item.ratioPercent, 0);
    const sharesReconciled = [sharesSubtotal + adjustment.shares, sharesSubtotal - adjustment.shares].includes(total.shares);
    const ratioDelta = Math.min(
      Math.abs(ratioSubtotal + adjustment.ratioPercent - total.ratioPercent),
      Math.abs(ratioSubtotal - adjustment.ratioPercent - total.ratioPercent),
    );
    if (holdersTotal !== total.holders || !sharesReconciled || ratioDelta > 0.5) throw new Error("invalid_response");
    return {
      symbol,
      dataDate: group.dataDate,
      levels,
      adjustment,
      total,
      provenance: { provider: "tdcc", dataset: "shareholder-distribution", frequency: "weekly", sourceDate: group.dataDate, fetchedAt: sourceNow(fetchedAt) },
    };
  });
  return rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function aggregateDistribution(row: DistributionRow, kind: DistributionAggregate["kind"]): DistributionAggregate {
  const levelIds = kind === "large-holder-tier" ? [15] : kind === "large-holder-400" ? [12, 13, 14, 15] : [1, 2, 3];
  const selected = levelIds.map((level) => row.levels.find((item) => item.level === level));
  if (selected.some((item) => !item)) throw new Error("unsupported_threshold");
  const items = selected as DistributionLevel[];
  const shares = items.reduce((sum, item) => sum + item.shares, 0);
  return {
    kind,
    levelIds,
    description: kind === "large-holder-tier"
      ? "1,000,001 股以上持股級距"
      : kind === "large-holder-400"
        ? "400,001 股以上持股級距（分級 12 至 15）"
        : "10 張以下持股級距（分級 1 至 3）",
    holders: items.reduce((sum, item) => sum + item.holders, 0),
    shares,
    lots: shares / 1000,
    ratioPercent: items.reduce((sum, item) => sum + item.ratioPercent, 0),
  };
}

export function mergeChipDailyRow(existing: ChipDailyRow | undefined, patch: ChipDailyRow): ChipDailyRow {
  if (!existing) return patch;
  if (existing.symbol !== patch.symbol || existing.sessionDate !== patch.sessionDate) throw new Error("row_identity_mismatch");
  const preferPatch = (dataset: Exclude<ChipDataset, "shareholder-distribution">, before: unknown, next: unknown) => {
    if (next === null || next === undefined) return false;
    if (before === null || before === undefined) return true;
    const countKnown = (value: unknown): number => {
      if (value === null || value === undefined) return 0;
      if (typeof value !== "object") return 1;
      return Object.values(value as UnknownRecord).reduce((sum, item) => sum + countKnown(item), 0);
    };
    if (countKnown(next) < countKnown(before)) return false;
    const beforeTime = Date.parse(existing.provenance[dataset]?.fetchedAt || "");
    const nextTime = Date.parse(patch.provenance[dataset]?.fetchedAt || "");
    return !Number.isFinite(beforeTime) || !Number.isFinite(nextTime) || nextTime >= beforeTime;
  };
  const institutionalFlow = preferPatch("institutional-flow", existing.institutionalFlow, patch.institutionalFlow) ? patch.institutionalFlow : existing.institutionalFlow;
  const foreignHolding = preferPatch("foreign-holding", existing.foreignHolding, patch.foreignHolding) ? patch.foreignHolding : existing.foreignHolding;
  const marginShort = preferPatch("margin-short", existing.marginShort, patch.marginShort) ? patch.marginShort : existing.marginShort;
  const securitiesLending = preferPatch("securities-lending", existing.securitiesLending, patch.securitiesLending) ? patch.securitiesLending : existing.securitiesLending;
  const provenance = { ...existing.provenance };
  if (institutionalFlow === patch.institutionalFlow && patch.provenance["institutional-flow"]) provenance["institutional-flow"] = patch.provenance["institutional-flow"];
  if (foreignHolding === patch.foreignHolding && patch.provenance["foreign-holding"]) provenance["foreign-holding"] = patch.provenance["foreign-holding"];
  if (marginShort === patch.marginShort && patch.provenance["margin-short"]) provenance["margin-short"] = patch.provenance["margin-short"];
  if (securitiesLending === patch.securitiesLending && patch.provenance["securities-lending"]) provenance["securities-lending"] = patch.provenance["securities-lending"];
  return {
    ...existing,
    institutionalFlow,
    foreignHolding,
    marginShort,
    securitiesLending,
    provenance,
  };
}

export function mergeChipRows(...sets: ChipDailyRow[][]) {
  const rows = new Map<string, ChipDailyRow>();
  for (const set of sets) for (const row of set) rows.set(row.sessionDate, mergeChipDailyRow(rows.get(row.sessionDate), row));
  return [...rows.values()].sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
}

export function isEligibleTaiwanEquity(input: { symbol: string; exchange: string; quoteType: string; active?: boolean }) {
  const symbol = input.symbol.trim().toUpperCase();
  const suffixMatches = (input.exchange === "TWSE" && symbol.endsWith(".TW")) || (input.exchange === "TPEx" && symbol.endsWith(".TWO"));
  return input.active !== false && ["EQUITY", "ETF"].includes(input.quoteType) && suffixMatches && /^[0-9A-Z]{4,8}\.(TW|TWO)$/.test(symbol);
}

export function isEligibleWatchlistTaiwanEquity(
  localEntry: { symbol: string; exchange: string; quoteType: string; active?: boolean },
  catalogEntry?: { symbol: string; exchange: string; quoteType: string; active?: boolean },
) {
  return isEligibleTaiwanEquity(localEntry)
    || Boolean(catalogEntry && isEligibleTaiwanEquity(catalogEntry));
}

export function datasetEligibility(input: { eligible: boolean; exchange: "TWSE" | "TPEx" | ""; interval?: string }): Record<ChipDataset, ChipDatasetEligibility> {
  const providers: Record<ChipDataset, ChipProvenance["provider"][]> = {
    "institutional-flow": input.exchange === "TPEx" ? ["finmind", "tpex"] : input.exchange === "TWSE" ? ["finmind", "twse"] : [],
    "foreign-holding": input.exchange === "TPEx" ? ["finmind", "tpex"] : ["finmind"],
    "margin-short": input.exchange === "TPEx" ? ["finmind", "tpex"] : input.exchange === "TWSE" ? ["finmind", "twse"] : [],
    "securities-lending": ["finmind"],
    "shareholder-distribution": ["tdcc"],
  };
  const reason = !input.eligible ? "not_eligible" : input.interval && input.interval !== "1d" ? "unsupported_interval" : "supported";
  return Object.fromEntries(CHIP_DATASETS.map((dataset) => [dataset, {
    supported: reason === "supported",
    reason,
    providers: reason === "not_eligible" ? [] : providers[dataset],
  }])) as Record<ChipDataset, ChipDatasetEligibility>;
}

export const TDCC_HISTORY_SOURCE_CONTRACT = {
  portalUrl: "https://www.tdcc.com.tw/portal/zh/smWeb/qryStock",
  latestOpenDataUrl: "https://openapi.tdcc.com.tw/v1/opendata/1-5",
  latestCsvUrl: "https://smart.tdcc.com.tw/opendata/getOD.ashx?id=1-5",
  dataGovLicenseUrl: "https://data.gov.tw/dataset/11452",
  retention: "one-year",
  frequency: "weekly",
  dataDateSemantics: "當週最後營業日營業結束後",
  historyQueryContract: "interactive-post-with-csrf-per-symbol-and-date",
  officialBulkHistoryAvailable: false,
  automatedAccessVerified: false,
  localOperatorFallback: "explicit-user-authorized-low-rate-targeted-query",
  localOperatorMinimumIntervalMs: 1000,
  reason: "history_source_unverified" as const,
};

export function createTdccHistoryAdapter(options: {
  fetchBatch?: (dataDate: string, signal?: AbortSignal) => Promise<unknown>;
  automatedAccessVerified?: boolean;
} = {}) {
  return {
    dataset: "shareholder-distribution" as const,
    provider: "tdcc" as const,
    frequency: "weekly" as const,
    async fetch(input: { dataDates: string[]; eligibleSymbols: ReadonlySet<string>; signal?: AbortSignal }) {
      if (!options.automatedAccessVerified || !options.fetchBatch) throw new Error("history_source_unverified");
      const rows = new Map<string, DistributionRow>();
      for (const dataDate of [...new Set(input.dataDates)].sort()) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDate)) throw new Error("invalid_response");
        const batch = parseTdccSnapshot(await options.fetchBatch(dataDate, input.signal), input.eligibleSymbols);
        if (batch.some((row) => row.dataDate !== dataDate)) throw new Error("invalid_response");
        for (const row of batch) {
          const key = `${row.symbol}|${row.dataDate}`;
          if (rows.has(key)) throw new Error("invalid_response");
          rows.set(key, row);
        }
      }
      return [...rows.values()].sort((a, b) => a.dataDate.localeCompare(b.dataDate) || a.symbol.localeCompare(b.symbol));
    },
  };
}

export function createFinMindAdapter<T>(options: {
  dataset: Exclude<ChipDataset, "shareholder-distribution">;
  finMindDataset: string;
  normalize: (payload: unknown, symbol: string, fetchedAt?: string) => T[];
  token?: string;
  fetchImpl?: typeof fetch;
}): ChipAdapter<T> {
  const fetchImpl = options.fetchImpl || fetch;
  return {
    dataset: options.dataset,
    provider: "finmind",
    frequency: "daily",
    async fetch({ symbol, start, end, signal }) {
      const conservativeStart = new Date(`${end}T00:00:00Z`);
      conservativeStart.setUTCDate(conservativeStart.getUTCDate() - 370);
      const effectiveStart = options.token?.trim() ? start : [start, conservativeStart.toISOString().slice(0, 10)].sort().at(-1)!;
      const url = new URL("https://api.finmindtrade.com/api/v4/data");
      url.searchParams.set("dataset", options.finMindDataset);
      url.searchParams.set("data_id", stockCode(symbol));
      url.searchParams.set("start_date", effectiveStart);
      url.searchParams.set("end_date", end);
      const headers: Record<string, string> = { accept: "application/json" };
      if (options.token?.trim()) headers.Authorization = `Bearer ${options.token.trim()}`;
      const timeout = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(12000) : undefined;
      const requestSignal = signal && timeout && typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeout]) : signal || timeout;
      const response = await fetchImpl(url, { headers, signal: requestSignal });
      if (response.status === 402 || response.status === 429) throw new Error("rate_limited");
      if (!response.ok) throw new Error("provider_unavailable");
      const body = await response.json() as { status?: number; data?: unknown };
      if (body.status !== 200 || !Array.isArray(body.data)) throw new Error("invalid_response");
      return options.normalize(body.data, symbol);
    },
  };
}
