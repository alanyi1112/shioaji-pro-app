import { inferredExchange, normalizeSymbol, type CatalogEntry } from "./instrument-catalog.ts";
import type { UserTabRow } from "./personal-tabs.ts";

export const STOCK_SCREENER_MULTIVIEW_TAB_ID = "stock-screener-filtered";
export const STOCK_SCREENER_MULTIVIEW_TAB_LABEL = "選股篩選";
export const STOCK_SCREENER_LIST_SYNC_SCHEMA_VERSION = "multiview-stock-screener-list-sync/1";

export type StockScreenerListSyncInput = { symbol: string };
export type StockScreenerListSyncStatus = "added" | "already_present";

export type StockScreenerTargetResolution =
  | { ok: true; mode: "existing"; tabId: string }
  | { ok: true; mode: "create"; tabId: typeof STOCK_SCREENER_MULTIVIEW_TAB_ID }
  | { ok: false; reason: "duplicate_target_tabs" | "reserved_tab_id_conflict" };

export type StockScreenerCatalogResolution =
  | { ok: true; entry: CatalogEntry }
  | { ok: false; reason: "catalog_symbol_not_found" | "catalog_symbol_ambiguous" | "unsupported_instrument" };

export type VerifiedScreenerUniverseCatalogRow = {
  expectedRevision: unknown;
  revision: unknown;
  symbol: unknown;
  market: unknown;
  dataDate: unknown;
  payload: unknown;
};

export function normalizeStockScreenerListLabel(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function parseStockScreenerListSyncInput(value: unknown): StockScreenerListSyncInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length !== 1 || !("symbol" in object)) return null;
  const symbol = normalizeSymbol(object.symbol);
  return /^[0-9A-Z]{4,8}\.(TW|TWO)$/.test(symbol) ? { symbol } : null;
}

export function resolveStockScreenerTargetTab(rows: UserTabRow[]): StockScreenerTargetResolution {
  const personalRows = rows.filter((row) => !String(row.source_tab_id || "").trim());
  const matches = personalRows.filter(
    (row) => normalizeStockScreenerListLabel(row.label) === STOCK_SCREENER_MULTIVIEW_TAB_LABEL,
  );
  if (matches.length > 1) return { ok: false, reason: "duplicate_target_tabs" };
  if (matches.length === 1) return { ok: true, mode: "existing", tabId: matches[0].id };
  if (personalRows.some((row) => row.id === STOCK_SCREENER_MULTIVIEW_TAB_ID)) {
    return { ok: false, reason: "reserved_tab_id_conflict" };
  }
  return { ok: true, mode: "create", tabId: STOCK_SCREENER_MULTIVIEW_TAB_ID };
}

export function resolveStockScreenerCatalogEntry(
  symbolValue: unknown,
  entries: CatalogEntry[],
): StockScreenerCatalogResolution {
  const symbol = normalizeSymbol(symbolValue);
  const matches = entries.filter((entry) => entry.active !== false && normalizeSymbol(entry.symbol) === symbol);
  if (!matches.length) return { ok: false, reason: "catalog_symbol_not_found" };
  if (matches.length > 1) return { ok: false, reason: "catalog_symbol_ambiguous" };
  const entry = matches[0];
  const expectedExchange = symbol.endsWith(".TW") ? "TWSE" : "TPEx";
  const exchange = String(entry.exchange || "").trim();
  const suffixMatches = exchange === expectedExchange
    && inferredExchange(entry.symbol, entry.exchange) === expectedExchange;
  if (!suffixMatches || entry.quoteType !== "EQUITY" || !entry.localizedName.trim() || !entry.provider.trim()) {
    return { ok: false, reason: "unsupported_instrument" };
  }
  return { ok: true, entry: { ...entry, symbol, exchange } };
}

export function catalogEntryFromVerifiedScreenerUniverse(
  symbolValue: unknown,
  row: VerifiedScreenerUniverseCatalogRow,
): CatalogEntry | null {
  const requestedSymbol = normalizeSymbol(symbolValue);
  const revision = String(row.revision ?? "").trim();
  const expectedRevision = String(row.expectedRevision ?? "").trim();
  const rowSymbol = normalizeSymbol(row.symbol);
  const rowMarket = String(row.market ?? "").trim();
  const dataDate = String(row.dataDate ?? "").trim();
  if (!/^[a-f0-9]{64}$/.test(revision) || revision !== expectedRevision
    || rowSymbol !== requestedSymbol || !/^\d{4}-\d{2}-\d{2}$/.test(dataDate)) return null;

  let payload: Record<string, unknown>;
  try {
    const parsed = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    payload = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const stock = payload.stock && typeof payload.stock === "object" && !Array.isArray(payload.stock)
    ? payload.stock as Record<string, unknown>
    : null;
  if (!stock || payload.review !== "verified" || payload.revision !== revision) return null;
  const stockSymbol = normalizeSymbol(stock.symbol);
  const stockMarket = String(stock.market ?? "").trim();
  const expectedMarket = requestedSymbol.endsWith(".TW") ? "TWSE" : requestedSymbol.endsWith(".TWO") ? "TPEx" : "";
  const localizedName = String(stock.name ?? "").normalize("NFKC").trim();
  const code = String(stock.code ?? "").trim();
  if (!expectedMarket || rowMarket !== expectedMarket || stockMarket !== expectedMarket
    || stockSymbol !== requestedSymbol || code !== requestedSymbol.split(".")[0]
    || stock.kind !== "ordinary"
    || stock.classificationVersion !== "official-issuer-common-stock-FL033103-1131231-v1"
    || !localizedName) return null;

  return {
    symbol: requestedSymbol,
    exchange: expectedMarket,
    localizedName,
    englishName: "",
    aliases: [],
    market: "台灣股市",
    group: expectedMarket === "TWSE" ? "上市股票" : "上櫃股票",
    quoteType: "EQUITY",
    provider: "yfinance",
    source: "verified-screener-universe",
    sourceUpdatedAt: dataDate,
    active: true,
  };
}
