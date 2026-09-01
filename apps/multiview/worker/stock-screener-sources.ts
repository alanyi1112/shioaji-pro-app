import {
  isIsoDate, validateStock, validateTdcc,
  type HolderPoint, type Provenance, type ScreenerMarket, type UniverseStock, type VolumePoint,
} from "../../../src/lib/stock-screener-domain.ts";

export const SCREENER_SOURCES = {
  TWSE: {
    universe: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
    volume: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
  },
  TPEx: {
    universe: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O",
    // data.gov.tw/11370: 上櫃股票行情 (includes Average/NextReferencePrice).
    // Do not substitute the different tpex_mainboard_quotes dataset.
    volume: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
  },
  tdcc: "https://openapi.tdcc.com.tw/v1/opendata/1-5",
} as const;

type RecordRow = Record<string, unknown>;
function records(payload: unknown): RecordRow[] {
  if (!Array.isArray(payload) || !payload.length || payload.length > 250000
    || payload.some((row) => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("invalid_source_payload");
  return payload.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/^\uFEFF/, "").trim(), value])));
}
const text = (value: unknown) => String(value ?? "").trim();

export function sourceDate(value: unknown): string {
  const raw = text(value);
  if (isIsoDate(raw)) return raw;
  const compact = raw.replaceAll("/", "");
  if (!/^\d{7,8}$/.test(compact)) throw new Error("invalid_source_date");
  const yearDigits = compact.length - 4;
  const year = Number(compact.slice(0, yearDigits)) + (yearDigits === 3 ? 1911 : 0);
  const date = `${year}-${compact.slice(-4, -2)}-${compact.slice(-2)}`;
  if (!isIsoDate(date)) throw new Error("invalid_source_date");
  return date;
}

/** Official issuer registers establish market and security family. Industry 91 is TDR,
 * not an ordinary share. Common-share capital, effective date and FL033103 code rules
 * are independent checks; unknown classification fails closed instead of being dropped.
 */
export function parseUniverse(payload: unknown, market: ScreenerMarket) {
  const rows = records(payload);
  const dates = new Set(rows.map((row) => sourceDate(row[market === "TWSE" ? "出表日期" : "Date"])));
  if (dates.size !== 1) throw new Error("mixed_source_dates");
  const date = [...dates][0];
  const stocks: UniverseStock[] = [];
  const excluded: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const code = text(row[market === "TWSE" ? "公司代號" : "SecuritiesCompanyCode"]);
    if (seen.has(code)) throw new Error("duplicate_security");
    seen.add(code);
    const name = text(row[market === "TWSE" ? "公司簡稱" : "CompanyAbbreviation"]);
    const industry = text(row[market === "TWSE" ? "產業別" : "SecuritiesIndustryCode"]);
    const commonShares = text(row[market === "TWSE" ? "已發行普通股數或TDR原股發行股數" : "IssueShares"]);
    // Legacy TDR codes can be FOUR digits (9103/9105/9110/9136).
    if (industry === "91" && /-DR$/.test(name) && /^(?:\d{4}|\d{6})$/.test(code)) { excluded.push(code); continue; }
    if (!/^\d{2}$/.test(industry) || industry === "91" || !/^(?:0|[1-9]\d{0,19})$/.test(commonShares)
      || !/^[1-9]\d{3}$/.test(code) || /-DR$/.test(name)) throw new Error("invalid_security_classification");
    const listed = sourceDate(row[market === "TWSE" ? "上市日期" : "DateOfListing"]);
    if (listed > date) { excluded.push(code); continue; }
    const stock: UniverseStock = { code, symbol: `${code}.${market === "TWSE" ? "TW" : "TWO"}`, market, kind: "ordinary",
      name, listingDate: listed, classificationVersion: "official-issuer-common-stock-FL033103-1131231-v1" };
    if (!validateStock(stock)) throw new Error("invalid_security");
    stocks.push(stock);
  }
  return { date, stocks, excluded };
}

export function mergeUniverses(twse: ReturnType<typeof parseUniverse>, tpex: ReturnType<typeof parseUniverse>) {
  // Issuer directories are published independently, unlike daily comparison anchors.
  // Keep both actual publication dates; never relabel the older catalog as the newer one.
  if (Math.abs(Date.parse(twse.date) - Date.parse(tpex.date)) > 3 * 86400000) throw new Error("universe_date_mismatch");
  const stocks = new Map<string, UniverseStock>();
  for (const stock of [...twse.stocks, ...tpex.stocks]) {
    const before = stocks.get(stock.code);
    if (before) {
      if (!before.listingDate || !stock.listingDate || before.listingDate === stock.listingDate) throw new Error("market_transfer_unresolved");
      // Stable company code survives a market transfer; the latest effective admission wins.
      if (before.listingDate > stock.listingDate) continue;
    }
    stocks.set(stock.code, stock);
  }
  return { date: twse.date > tpex.date ? twse.date : tpex.date, dates: { TWSE: twse.date, TPEx: tpex.date }, stocks: [...stocks.values()].sort((a, b) => a.code.localeCompare(b.code)) };
}

export function parseDailyVolumes(payload: unknown, market: ScreenerMarket, provenance: Provenance) {
  const rows = records(payload);
  const dates = new Set(rows.map((row) => sourceDate(row.Date)));
  if (dates.size !== 1) throw new Error("mixed_source_dates");
  const date = [...dates][0];
  const points = new Map<string, VolumePoint>();
  const invalid = new Map<string, string>();
  const seen = new Set<string>();
  for (const row of rows) {
    const code = text(row[market === "TWSE" ? "Code" : "SecuritiesCompanyCode"]);
    if (!/^[1-9]\d{3}$/.test(code)) continue;
    if (seen.has(code)) throw new Error("duplicate_security");
    seen.add(code);
    // Both OpenAPI endpoints publish shares and New Taiwan dollar trade value
    // on the same official daily row, never Shioaji lots or client estimates.
    const shares = text(row[market === "TWSE" ? "TradeVolume" : "TradingShares"]);
    const turnover = text(row[market === "TWSE" ? "TradeValue" : "TransactionAmount"]);
    const symbol = `${code}.${market === "TWSE" ? "TW" : "TWO"}`;
    const validShares = /^(?:0|[1-9]\d{0,19})$/.test(shares);
    const validTurnover = /^(?:0|[1-9]\d{0,24})$/.test(turnover);
    if (!validShares && !validTurnover) { invalid.set(symbol, "invalid_volume_and_turnover"); continue; }
    if (!validShares) invalid.set(symbol, "invalid_volume");
    else if (!validTurnover) invalid.set(symbol, turnover ? "invalid_turnover" : "missing_turnover");
    const basis = market === "TWSE" ? "TWSE-STOCK_DAY_ALL-v1" : "TPEx-daily-close-quotes-v1";
    points.set(symbol, { date, shares: validShares ? shares : null, market, unit: "shares", basis,
      turnoverNtd: validTurnover ? turnover : null, turnoverCurrency: "TWD",
      turnoverField: market === "TWSE" ? "TradeValue" : "TransactionAmount",
      turnoverBasis: basis, turnoverMappingVersion: "official-daily-trade-value-v1", provenance });
  }
  return { date, points, invalid };
}

/** A malformed stock does not poison the remaining market batch. */
export function parseHolderBatch(payload: unknown, universe: UniverseStock[], provenance: Provenance) {
  const rows = records(payload);
  const dates = new Set(rows.map((row) => sourceDate(row["資料日期"])));
  if (dates.size !== 1) throw new Error("mixed_source_dates");
  const date = [...dates][0];
  const byCode = new Map(universe.map((stock) => [stock.code, stock.symbol]));
  const points = new Map<string, HolderPoint>();
  for (const row of rows) {
    const symbol = byCode.get(text(row["證券代號"]));
    if (!symbol) continue;
    const point = points.get(symbol) ?? { date, provenance, bands: [] };
    point.bands.push({ level: Number(row["持股分級"]), holders: text(row["人數"]), shares: text(row["股數"]), ratio: text(row["占集保庫存數比例%"]) });
    points.set(symbol, point);
  }
  const invalid = new Map<string, string>();
  for (const [symbol, point] of points) {
    const reason = validateTdcc(point);
    if (reason !== "none") { invalid.set(symbol, reason); points.delete(symbol); }
  }
  return { date, points, invalid };
}

/** Full fetch + body has a hard deadline even when a transport ignores abort. */
export class ScreenerSourceError extends Error {
  retryAfterMs: number;
  constructor(message: string, retryAfterMs = 0) { super(message); this.retryAfterMs = retryAfterMs; }
}
export async function fetchScreenerSource(url: string, fetcher: typeof fetch = fetch, timeoutMs = 30000) {
  const allowed = [SCREENER_SOURCES.TWSE.universe, SCREENER_SOURCES.TWSE.volume,
    SCREENER_SOURCES.TPEx.universe, SCREENER_SOURCES.TPEx.volume, SCREENER_SOURCES.tdcc] as string[];
  if (!allowed.includes(url)) throw new Error("source_not_allowed");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    const response = await fetcher(url, { signal: controller.signal, redirect: "error", headers: { "accept-encoding": "identity" } });
    if (!response.ok) {
      const retry = response.headers?.get("retry-after");
      const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 0;
      throw new ScreenerSourceError(`source_http_${response.status}`, Number.isFinite(delay) ? Math.max(0, delay) : 0);
    }
    const body = await response.text();
    if (body.length > 32 * 1024 * 1024) throw new Error("source_too_large");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    const payloadHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return { payload: JSON.parse(body) as unknown, payloadHash, fetchedAt: new Date().toISOString() };
  })();
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("source_timeout")); }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); controller.abort(); }
}
