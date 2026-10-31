import { emptyDaily, type ChipDailyRow } from "./taiwan-stock-chip.ts";
import { SCREENER_INSTITUTIONAL_MAPPING_VERSION } from "../../../src/lib/stock-screener-v6.ts";
type Dataset = "institutional-flow" | "margin-short";
const sha = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)))].map(v=>v.toString(16).padStart(2,"0")).join("");

export async function canonicalReceipt(db: D1Database, receiptId: string) {
  return db.prepare(`SELECT r.*,v.status AS mapping_status,v.payload_hash AS mapping_hash FROM screener_chip_receipts r
    LEFT JOIN screener_institutional_mapping_verifications v ON v.receipt_id=r.id AND v.mapping_version=? WHERE r.id=?`)
    .bind(SCREENER_INSTITUTIONAL_MAPPING_VERSION,receiptId).first<Record<string,unknown>>();
}

function receiptValid(r: Record<string,unknown> | null) {
  return r?.status === "verified" && r.requested_date === r.source_date && /^[a-f0-9]{64}$/.test(String(r.payload_hash))
    && r.normalization_version === "official-market-chip-v1" && Number.isFinite(Date.parse(String(r.fetched_at)))
    && ["TWSE","TPEx"].includes(String(r.market)) && ["institutional-flow","margin-short"].includes(String(r.dataset))
    && (r.dataset !== "institutional-flow" || r.mapping_status === "verified" && r.mapping_hash === r.payload_hash);
}

/** Complete common-source material only. Partial compatibility rows continue through the old projection. */
export function fullCanonicalDataset(row: ChipDailyRow, dataset: Dataset) {
  const value = dataset === "institutional-flow" ? row.institutionalFlow : row.marginShort;
  if (!value || Object.values(value).some(v=>typeof v === "number" && !Number.isFinite(v))) return false;
  if (dataset === "institutional-flow") {
    const v = row.institutionalFlow!;
    return [v.foreignBuyShares,v.foreignSellShares,v.foreignNetShares,v.investmentTrustBuyShares,v.investmentTrustSellShares,v.investmentTrustNetShares,
      v.dealerSelfNetShares,v.dealerHedgingNetShares,v.dealerTotalNetShares,v.institutionalTotalNetShares,v.sourceTotalNetShares].every(n=>typeof n === "number" && Number.isSafeInteger(n))
      && v.foreignBuyShares! >= 0 && v.foreignSellShares! >= 0 && v.investmentTrustBuyShares! >= 0 && v.investmentTrustSellShares! >= 0
      && v.foreignBuyShares! - v.foreignSellShares! === v.foreignNetShares
      && v.investmentTrustBuyShares! - v.investmentTrustSellShares! === v.investmentTrustNetShares
      && v.dealerSelfNetShares! + v.dealerHedgingNetShares! === v.dealerTotalNetShares
      && v.foreignNetShares! + v.investmentTrustNetShares! + v.dealerTotalNetShares! === v.institutionalTotalNetShares
      && v.sourceTotalVerified === true && v.institutionalTotalNetShares === v.sourceTotalNetShares;
  }
  const v = row.marginShort!;
  return [v.marginBuyLots,v.marginSellLots,v.marginCashRepaymentLots,v.marginYesterdayBalanceLots,v.marginTodayBalanceLots,v.marginBalanceChangeLots,
    v.shortBuyLots,v.shortSellLots,v.shortCashRepaymentLots,v.shortYesterdayBalanceLots,v.shortTodayBalanceLots,v.shortBalanceChangeLots]
    .every(n=>typeof n === "number" && Number.isSafeInteger(n))
    && [v.marginBuyLots,v.marginSellLots,v.marginCashRepaymentLots,v.marginYesterdayBalanceLots,v.marginTodayBalanceLots,v.shortBuyLots,v.shortSellLots,v.shortCashRepaymentLots,v.shortYesterdayBalanceLots,v.shortTodayBalanceLots].every(n=>n!>=0)
    && v.marginTodayBalanceLots! - v.marginYesterdayBalanceLots! === v.marginBalanceChangeLots
    && v.shortTodayBalanceLots! - v.shortYesterdayBalanceLots! === v.shortBalanceChangeLots;
}

export async function persistCanonicalChipRows(db: D1Database, receiptId: string, rows: ChipDailyRow[], onlySymbols?: ReadonlySet<string>, observation?: {sourceHash:string;observedAt:string}) {
  const receipt = await canonicalReceipt(db,receiptId);
  if (!receiptValid(receipt)) throw new Error("canonical_receipt_unverified");
  const dataset = receipt!.dataset as Dataset;
  const observedAt=observation?.observedAt || String(receipt!.fetched_at);
  if(observation && (observation.sourceHash!==receipt!.payload_hash || !Number.isFinite(Date.parse(observedAt)) || Date.parse(observedAt)>Date.now() || Date.parse(observedAt)<Date.parse(String(receipt!.fetched_at))))throw new Error("canonical_observation_invalid");
  let stored=0;
  for (const row of rows) {
    if (onlySymbols && !onlySymbols.has(row.symbol)) continue;
    const market = row.symbol.endsWith(".TWO") ? "TPEx" : row.symbol.endsWith(".TW") ? "TWSE" : "";
    if (market !== receipt!.market || row.sessionDate !== receipt!.source_date || row.provenance[dataset]?.sourceDate !== row.sessionDate
      || !fullCanonicalDataset(row,dataset)) throw new Error("canonical_row_invalid");
    const payload=emptyDaily(row.symbol,row.sessionDate);
    if(dataset === "institutional-flow") payload.institutionalFlow=row.institutionalFlow; else payload.marginShort=row.marginShort;
    payload.provenance[dataset]={...row.provenance[dataset]!,sourceDateVerified:true,fetchedAt:observedAt,receiptId,payloadHash:String(receipt!.payload_hash),sharedStore:"screener_chip_canonical_rows"};
    const text=JSON.stringify(payload);
    const materialHash=await sha(text);
    const existing=await db.prepare("SELECT payload_sha256 FROM screener_chip_canonical_rows WHERE receipt_id=? AND symbol=? AND dataset=? AND source_observed_at=?").bind(receiptId,row.symbol,dataset,observedAt).first<{payload_sha256:string}>();
    if(existing && existing.payload_sha256!==materialHash) throw new Error("canonical_material_conflict");
    if(existing)continue;
    await db.prepare("INSERT INTO screener_chip_canonical_rows(receipt_id,symbol,session_date,dataset,payload_json,payload_sha256,source_observed_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(receipt_id,symbol,dataset,source_observed_at) DO NOTHING").bind(receiptId,row.symbol,row.sessionDate,dataset,text,materialHash,observedAt).run();
    stored++;
  }
  return stored;
}

export async function readCanonicalChipRows(db: D1Database,symbol: string,start: string,end: string) {
  let rows: {receipt_id:string;session_date:string;dataset:Dataset;payload_json:string;payload_sha256:string;source_observed_at:string}[];
  try{rows=(await db.prepare("SELECT receipt_id,session_date,dataset,payload_json,payload_sha256,source_observed_at FROM screener_chip_canonical_rows WHERE symbol=? AND session_date>=? AND session_date<=? ORDER BY session_date,source_observed_at,receipt_id").bind(symbol,start,end).all<typeof rows[number]>()).results || [];}
  catch(error){if(/no such table.*screener_chip_canonical_rows/i.test(String(error)))return [];throw error;}
  const accepted:ChipDailyRow[]=[];
  for(const r of rows){
    if(await sha(r.payload_json)!==r.payload_sha256)continue;
    const receipt=await canonicalReceipt(db,r.receipt_id);if(!receiptValid(receipt)||receipt!.dataset!==r.dataset||receipt!.source_date!==r.session_date)continue;
    let row:ChipDailyRow;try{row=JSON.parse(r.payload_json);}catch{continue;}
    if(row.symbol!==symbol||row.sessionDate!==r.session_date||receipt!.market!==(symbol.endsWith('.TWO')?'TPEx':symbol.endsWith('.TW')?'TWSE':'')
      ||row.provenance[r.dataset]?.sourceDate!==row.sessionDate||row.provenance[r.dataset]?.sourceDateVerified!==true||row.provenance[r.dataset]?.receiptId!==r.receipt_id
      ||row.provenance[r.dataset]?.payloadHash!==receipt!.payload_hash||row.provenance[r.dataset]?.fetchedAt!==r.source_observed_at
      ||!Number.isFinite(Date.parse(r.source_observed_at))||Date.parse(r.source_observed_at)>Date.now()||Date.parse(r.source_observed_at)<Date.parse(String(receipt!.fetched_at))||!fullCanonicalDataset(row,r.dataset))continue;
    accepted.push(row);
  }
  return accepted;
}
