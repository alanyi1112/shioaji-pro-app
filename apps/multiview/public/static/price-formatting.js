(function exposeQuotePriceFormatting(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.QuotePriceFormatting = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createQuotePriceFormatting() {
  "use strict";

  const TAIWAN_EQUITY_TICK_RULES = Object.freeze([
    Object.freeze({ below: 10, tickSize: 0.01 }),
    Object.freeze({ below: 50, tickSize: 0.05 }),
    Object.freeze({ below: 100, tickSize: 0.1 }),
    Object.freeze({ below: 500, tickSize: 0.5 }),
    Object.freeze({ below: 1000, tickSize: 1 }),
    Object.freeze({ below: Infinity, tickSize: 5 }),
  ]);
  const TAIWAN_ETF_TICK_RULES = Object.freeze([
    Object.freeze({ below: 50, tickSize: 0.01 }),
    Object.freeze({ below: Infinity, tickSize: 0.05 }),
  ]);
  const FRACTION_DIGITS_BY_TICK = Object.freeze({
    "0.01": 2,
    "0.05": 2,
    "0.1": 1,
    "0.5": 1,
    "1": 0,
    "5": 0,
  });

  function isTaiwanSymbol(symbol = "") {
    const normalized = String(symbol).trim().toUpperCase();
    return normalized.endsWith(".TW") || normalized.endsWith(".TWO");
  }

  function taiwanSecurityType(symbol, instrument = {}) {
    if (!isTaiwanSymbol(symbol)) return undefined;
    const quoteType = String(instrument?.quoteType || instrument?.securityType || "").trim().toUpperCase();
    if (quoteType === "ETF") return "ETF";
    if (["EQUITY", "STOCK"].includes(quoteType)) return "EQUITY";
    const group = String(instrument?.group || "").trim().toUpperCase();
    if (group.includes("ETF")) return "ETF";
    const code = String(symbol).trim().toUpperCase().replace(/\.TWO?$/, "");
    if (/^00[0-9A-Z]{2,4}$/.test(code)) return "ETF";
    return "EQUITY";
  }

  function taiwanTickSize(value, securityType = "EQUITY") {
    const numeric = Math.abs(Number(value));
    if (!Number.isFinite(numeric)) return undefined;
    const rules = securityType === "ETF" ? TAIWAN_ETF_TICK_RULES : TAIWAN_EQUITY_TICK_RULES;
    return rules.find((rule) => numeric < rule.below)?.tickSize;
  }

  function fractionDigitsForTick(tickSize) {
    const digits = FRACTION_DIGITS_BY_TICK[String(tickSize)];
    return Number.isInteger(digits) ? digits : 2;
  }

  function taiwanPricePrecision(symbol, value, context = "trade-price", referencePrice, instrument = {}) {
    if (!isTaiwanSymbol(symbol)) return undefined;
    if (context === "derived-price") return { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false };
    const anchor = context === "change" ? referencePrice : value;
    const securityType = taiwanSecurityType(symbol, instrument);
    const tickSize = taiwanTickSize(anchor, securityType);
    if (tickSize === undefined) return { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false };
    const digits = fractionDigitsForTick(tickSize);
    return { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false };
  }

  return Object.freeze({
    TAIWAN_EQUITY_TICK_RULES,
    TAIWAN_ETF_TICK_RULES,
    isTaiwanSymbol,
    taiwanSecurityType,
    taiwanTickSize,
    fractionDigitsForTick,
    taiwanPricePrecision,
  });
});
