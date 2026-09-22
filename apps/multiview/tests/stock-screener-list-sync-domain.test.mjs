import assert from "node:assert/strict";
import test from "node:test";

import {
  STOCK_SCREENER_MULTIVIEW_TAB_ID,
  catalogEntryFromVerifiedScreenerUniverse,
  parseStockScreenerListSyncInput,
  resolveStockScreenerCatalogEntry,
  resolveStockScreenerTargetTab,
} from "../worker/stock-screener-list-sync.ts";

const tab = (overrides = {}) => ({
  id: "mine",
  label: "自選",
  sort_order: 1,
  enabled: 1,
  is_default: 0,
  source_tab_id: "",
  ...overrides,
});

const catalog = (overrides = {}) => ({
  symbol: "2449.TW",
  exchange: "TWSE",
  localizedName: "京元電子",
  englishName: "",
  aliases: [],
  market: "台灣股市",
  group: "上市股票",
  quoteType: "EQUITY",
  provider: "yfinance",
  source: "taiwan-catalog",
  active: true,
  ...overrides,
});

test("同步輸入只接受單一 canonical 台股 symbol", () => {
  assert.deepEqual(parseStockScreenerListSyncInput({ symbol: " 2449.tw " }), { symbol: "2449.TW" });
  for (const value of [null, {}, { symbol: "2449" }, { symbol: "AAPL" }, { symbol: "2449.TW", url: "https://evil.example" }]) {
    assert.equal(parseStockScreenerListSyncInput(value), null);
  }
});

test("目標頁籤使用精確正規化名稱與穩定 identity", () => {
  assert.deepEqual(resolveStockScreenerTargetTab([]), { ok: true, mode: "create", tabId: STOCK_SCREENER_MULTIVIEW_TAB_ID });
  assert.deepEqual(resolveStockScreenerTargetTab([tab({ id: "existing", label: " 選股篩選 " })]), { ok: true, mode: "existing", tabId: "existing" });
  assert.deepEqual(resolveStockScreenerTargetTab([
    tab({ id: "a", label: "選股篩選" }),
    tab({ id: "b", label: "選股篩選" }),
  ]), { ok: false, reason: "duplicate_target_tabs" });
  assert.deepEqual(resolveStockScreenerTargetTab([
    tab({ id: STOCK_SCREENER_MULTIVIEW_TAB_ID, label: "其他用途" }),
  ]), { ok: false, reason: "reserved_tab_id_conflict" });
});

test("catalog 驗證保留 TWSE/TPEx 後綴並拒絕 ETF、矛盾與歧義", () => {
  assert.deepEqual(resolveStockScreenerCatalogEntry("2449.TW", [catalog()]), { ok: true, entry: catalog() });
  const tpex = catalog({ symbol: "8069.TWO", exchange: "TPEx", localizedName: "元太", group: "上櫃股票" });
  assert.deepEqual(resolveStockScreenerCatalogEntry("8069.TWO", [tpex]), { ok: true, entry: tpex });
  assert.deepEqual(resolveStockScreenerCatalogEntry("2449.TW", []), { ok: false, reason: "catalog_symbol_not_found" });
  assert.deepEqual(resolveStockScreenerCatalogEntry("2449.TW", [catalog(), catalog({ source: "other" })]), { ok: false, reason: "catalog_symbol_ambiguous" });
  assert.deepEqual(resolveStockScreenerCatalogEntry("2449.TW", [catalog({ quoteType: "ETF" })]), { ok: false, reason: "unsupported_instrument" });
  assert.deepEqual(resolveStockScreenerCatalogEntry("2449.TW", [catalog({ exchange: "TPEx" })]), { ok: false, reason: "unsupported_instrument" });
});

test("已發布 verified screener universe 可轉為受限 catalog，矛盾或非普通股仍 fail closed", () => {
  const revision = "a".repeat(64);
  const stock = {
    code: "2454",
    symbol: "2454.TW",
    market: "TWSE",
    kind: "ordinary",
    name: "聯發科",
    classificationVersion: "official-issuer-common-stock-FL033103-1131231-v1",
  };
  const row = (overrides = {}) => ({
    expectedRevision: revision,
    revision,
    symbol: "2454.TW",
    market: "TWSE",
    dataDate: "2026-09-21",
    payload: JSON.stringify({ stock, review: "verified", revision }),
    ...overrides,
  });
  assert.deepEqual(catalogEntryFromVerifiedScreenerUniverse("2454.TW", row()), {
    symbol: "2454.TW",
    exchange: "TWSE",
    localizedName: "聯發科",
    englishName: "",
    aliases: [],
    market: "台灣股市",
    group: "上市股票",
    quoteType: "EQUITY",
    provider: "yfinance",
    source: "verified-screener-universe",
    sourceUpdatedAt: "2026-09-21",
    active: true,
  });
  assert.equal(catalogEntryFromVerifiedScreenerUniverse("2454.TW", row({ expectedRevision: "b".repeat(64) })), null);
  assert.equal(catalogEntryFromVerifiedScreenerUniverse("2454.TW", row({ payload: JSON.stringify({ stock, review: "pending", revision }) })), null);
  assert.equal(catalogEntryFromVerifiedScreenerUniverse("2454.TW", row({ payload: JSON.stringify({ stock: { ...stock, kind: "etf" }, review: "verified", revision }) })), null);
  assert.equal(catalogEntryFromVerifiedScreenerUniverse("2454.TW", row({ market: "TPEx" })), null);
  assert.equal(catalogEntryFromVerifiedScreenerUniverse("2454.TW", row({ payload: "{" })), null);
});
