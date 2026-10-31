import { emptyDaily, type ChipDailyRow, type DistributionRow, TDCC_LEVEL_RANGES } from "./taiwan-stock-chip.ts";
import { SCREENER_INSTITUTIONAL_MAPPING_VERSION } from "../../../src/lib/stock-screener-v6.ts";
import { validateTdcc, type HolderPoint } from "../../../src/lib/stock-screener-domain.ts";
import { readCanonicalChipRows } from "./shared-chip-canonical.ts";
import { mergeChipRows } from "./taiwan-stock-chip.ts";

type Row = Record<string, unknown>;
const number = (v: unknown): number | null => {
  if (typeof v !== "number" && (typeof v !== "string" || !/^-?\d+$/.test(v))) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
};
const iso = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

/** Read-only compatibility projection. No receipt, wrong mapping or missing column means no fabricated data. */
export function projectVerifiedChip(row: Row, symbol: string, start: string, end: string): ChipDailyRow | null {
  const day = String(row.session_date || "");
  const market = symbol.endsWith(".TWO") ? "TPEx" : symbol.endsWith(".TW") ? "TWSE" : "";
  if (!market || row.symbol !== symbol || row.market !== market || !iso(day) || day < start || day > end) return null;
  const result = emptyDaily(symbol, day);
  for (const [prefix, dataset] of [["i", "institutional-flow"], ["m", "margin-short"]] as const) {
    if (row[`${prefix}_status`] !== "verified" || row[`${prefix}_market`] !== market
      || row[`${prefix}_dataset`] !== dataset || row[`${prefix}_requested_date`] !== day || row[`${prefix}_source_date`] !== day
      || !hash(row[`${prefix}_payload_hash`]) || row[`${prefix}_normalization_version`] !== "official-market-chip-v1"
      || !Number.isFinite(Date.parse(String(row[`${prefix}_fetched_at`] || "")))) continue;
    if (prefix === "i") {
      if (row.institutional_invalid_reason || row.institutional_mapping_version !== SCREENER_INSTITUTIONAL_MAPPING_VERSION
        || row.mapping_status !== "verified") continue;
      const values = ["foreign_buy_shares", "foreign_sell_shares", "foreign_net_shares", "investment_trust_buy_shares", "investment_trust_sell_shares", "investment_trust_net_shares"].map(k => number(row[k]));
      if (values.some(v => v === null) || values[0]! < 0 || values[1]! < 0 || values[3]! < 0 || values[4]! < 0
        || values[0]! - values[1]! !== values[2] || values[3]! - values[4]! !== values[5]) continue;
      result.institutionalFlow = { foreignBuyShares: values[0], foreignSellShares: values[1], foreignNetShares: values[2],
        investmentTrustBuyShares: values[3], investmentTrustSellShares: values[4], investmentTrustNetShares: values[5],
        dealerSelfNetShares: null, dealerHedgingNetShares: null, dealerTotalNetShares: null,
        institutionalTotalNetShares: null, sourceTotalNetShares: null, sourceTotalVerified: null };
    } else {
      const values = ["margin_yesterday_balance_lots", "margin_today_balance_lots", "margin_balance_change_lots", "short_yesterday_balance_lots", "short_today_balance_lots", "short_balance_change_lots"].map(k => number(row[k]));
      if (values.some(v => v === null) || [0, 1, 3, 4].some(i => values[i]! < 0)
        || values[1]! - values[0]! !== values[2] || values[4]! - values[3]! !== values[5]) continue;
      result.marginShort = { marginBuyLots: null, marginSellLots: null, marginCashRepaymentLots: null,
        marginYesterdayBalanceLots: values[0], marginTodayBalanceLots: values[1], marginBalanceChangeLots: values[2],
        marginLimitLots: null, marginUtilizationPercent: null, shortBuyLots: null, shortSellLots: null, shortCashRepaymentLots: null,
        shortYesterdayBalanceLots: values[3], shortTodayBalanceLots: values[4], shortBalanceChangeLots: values[5],
        shortLimitLots: null, shortUtilizationPercent: null, offsetLots: null };
    }
    result.provenance[dataset] = { provider: market === "TWSE" ? "twse" : "tpex", dataset, frequency: "daily",
      sourceDate: day, sourceDateVerified: true, fetchedAt: String(row[`${prefix}_fetched_at`]),
      receiptId: String(row[`${prefix}_id`]), payloadHash: String(row[`${prefix}_payload_hash`]), sharedStore: "screener_chip_daily" };
  }
  return Object.keys(result.provenance).length ? result : null;
}

async function compatibleRows<T>(db: D1Database, sql: string, args: string[]) {
  try { return (await db.prepare(sql).bind(...args).all<T>()).results || []; }
  catch (error) {
    // Independent older installations may not yet have screener tables. Other storage errors are not hidden.
    if (/no such table.*screener_/i.test(String(error))) return [];
    throw error;
  }
}

export async function readVerifiedSharedChip(db: D1Database, symbol: string, start: string, end: string) {
  const columns = ["id", "market", "dataset", "status", "requested_date", "source_date", "payload_hash", "normalization_version", "fetched_at"];
  const aliases = ["i", "m"].flatMap(p => columns.map(k => `${p}.${k} AS ${p}_${k}`)).join(",");
  const rows = await compatibleRows<Row>(db, `SELECT d.*,${aliases},v.status AS mapping_status FROM screener_chip_daily d
    LEFT JOIN screener_chip_receipts i ON i.id=d.institutional_receipt_id
    LEFT JOIN screener_chip_receipts m ON m.id=d.margin_receipt_id
    LEFT JOIN screener_institutional_mapping_verifications v ON v.receipt_id=i.id AND v.mapping_version=?
    WHERE d.symbol=? AND d.session_date>=? AND d.session_date<=? ORDER BY d.session_date`, [SCREENER_INSTITUTIONAL_MAPPING_VERSION, symbol, start, end]);
  return mergeChipRows(rows.flatMap(row => { const item = projectVerifiedChip(row, symbol, start, end); return item ? [item] : []; }),await readCanonicalChipRows(db,symbol,start,end));
}

export async function readVerifiedSharedDistribution(db: D1Database, symbol: string, start: string, end: string): Promise<DistributionRow[]> {
  const rows = await compatibleRows<{ symbol: string; data_date: string; payload: string; validation: string }>(db,
    "SELECT symbol,data_date,payload,validation FROM screener_tdcc_weekly WHERE symbol=? AND data_date>=? AND data_date<=? AND validation='full-17' ORDER BY data_date", [symbol, start, end]);
  return rows.flatMap(row => {
    try {
      const p: HolderPoint = JSON.parse(row.payload);
      if (row.symbol !== symbol || p.date !== row.data_date || p.provenance?.source !== "TDCC" || !hash(p.provenance.payloadHash)
        || !Number.isFinite(Date.parse(p.provenance.fetchedAt)) || validateTdcc(p) !== "none") return [];
      const bands = p.bands.map(b => ({ level: b.level, range: TDCC_LEVEL_RANGES[b.level], holders: number(b.holders), shares: number(b.shares), ratioPercent: Number(b.ratio) }));
      if (bands.some(b => b.holders === null || b.shares === null || !Number.isFinite(b.ratioPercent))) return [];
      return [{ symbol, dataDate: p.date, levels: bands.filter(b => b.level < 16), adjustment: bands.find(b => b.level === 16)!, total: bands.find(b => b.level === 17)!,
        provenance: { provider: "tdcc", dataset: "shareholder-distribution", frequency: "weekly", sourceDate: p.date,
          fetchedAt: p.provenance.fetchedAt, payloadHash: p.provenance.payloadHash, sharedStore: "screener_tdcc_weekly" } } as DistributionRow];
    } catch { return []; }
  });
}
