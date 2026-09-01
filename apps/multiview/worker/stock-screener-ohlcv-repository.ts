import { validateCanonicalOhlc, type SourcedOhlc } from "../../../src/lib/stock-screener-ohlcv.ts";
import type { ScreenerDatabase, ScreenerStatement } from "./stock-screener-repository.ts";

export const OHLCV_VALIDATION = "canonical-complete-v1" as const;
export const OHLCV_UPSERT_SQL = `INSERT INTO screener_daily_ohlcv
  (symbol,data_date,market,open,high,low,close,currency,price_basis,mapping_version,source_url,payload_hash,fetched_at,validation)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(data_date,symbol) DO UPDATE SET
    market=excluded.market,open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,
    currency=excluded.currency,price_basis=excluded.price_basis,mapping_version=excluded.mapping_version,
    source_url=excluded.source_url,payload_hash=excluded.payload_hash,fetched_at=excluded.fetched_at,validation=excluded.validation
  WHERE excluded.validation='canonical-complete-v1'
    AND screener_daily_ohlcv.validation='canonical-complete-v1'
    AND excluded.fetched_at >= screener_daily_ohlcv.fetched_at`;

export function validateSourcedOhlcv(point: SourcedOhlc): boolean {
  return validateCanonicalOhlc(point) && /^(?:[1-9]\d{3})\.(?:TW|TWO)$/.test(point.symbol)
    && point.symbol.endsWith(point.market === "TWSE" ? ".TW" : ".TWO")
    && point.currency === "TWD" && point.priceBasis === "official-unadjusted-after-market-twd"
    && point.mappingVersion === "official-daily-ohlcv-v1"
    && !!point.provenance?.source && /^https:\/\/(?:openapi\.twse\.com\.tw|www\.twse\.com\.tw|www\.tpex\.org\.tw)\//.test(point.provenance.sourceUrl)
    && Number.isFinite(Date.parse(point.provenance.fetchedAt)) && /^[a-f0-9]{64}$/.test(point.provenance.payloadHash);
}

export function shouldReplaceOhlcv(existing: SourcedOhlc, candidate: SourcedOhlc): boolean {
  return validateSourcedOhlcv(existing) && validateSourcedOhlcv(candidate)
    && existing.symbol === candidate.symbol && existing.sessionDate === candidate.sessionDate
    && existing.market === candidate.market && existing.priceBasis === candidate.priceBasis
    && existing.mappingVersion === candidate.mappingVersion
    && Date.parse(candidate.provenance.fetchedAt) >= Date.parse(existing.provenance.fetchedAt);
}

export function ohlcvUpsertStatement(db: ScreenerDatabase, point: SourcedOhlc): ScreenerStatement {
  if (!validateSourcedOhlcv(point)) throw new Error("invalid_ohlcv");
  return db.prepare(OHLCV_UPSERT_SQL).bind(point.symbol, point.sessionDate, point.market,
    point.open, point.high, point.low, point.close, point.currency, point.priceBasis, point.mappingVersion,
    point.provenance.sourceUrl, point.provenance.payloadHash, point.provenance.fetchedAt, OHLCV_VALIDATION);
}
