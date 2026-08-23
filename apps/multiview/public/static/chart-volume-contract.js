(function (global) {
  "use strict";

  const REVISION = "taiwan-stock-common-lot/1";
  const COMMON_LOT_PROVIDERS = new Set(["shioaji", "shioaji-kbars", "shioaji-realtime"]);
  const SHARE_PROVIDERS = new Set([
    "yahoo-chart", "yfinance", "yfinance-weekly-from-daily-v1", "yfinance-monthly-from-daily-v1",
    "yfinance+twse-official-tail-v1", "twse", "tpex", "twse-official", "tpex-official", "twse-mis",
  ]);

  function isTaiwanRegularStockSymbol(symbol) {
    return /^\d{4,6}[A-Z]?\.(TW|TWO)$/i.test(String(symbol || "").trim());
  }

  function sourceVolumeUnitForProvider(provider) {
    const normalized = String(provider || "").trim().toLowerCase();
    if (COMMON_LOT_PROVIDERS.has(normalized)) return "common_lot";
    if (SHARE_PROVIDERS.has(normalized)) return "share";
    throw new Error("taiwan_stock_volume_provider_unknown");
  }

  function contractForProvider(provider) {
    const normalized = String(provider || "").trim().toLowerCase();
    const sourceVolumeUnit = sourceVolumeUnitForProvider(normalized);
    return Object.freeze({
      market: "TW",
      securityType: "STK",
      provider: normalized,
      sourceVolumeUnit,
      canonicalVolumeUnit: "common_lot",
      normalizationRevision: REVISION,
      sourceFingerprint: [normalized, sourceVolumeUnit, "common_lot", REVISION].join("|"),
    });
  }

  function hasCurrentContract(value) {
    if (!value || typeof value !== "object") return false;
    if (value.market !== "TW" || value.securityType !== "STK" || value.canonicalVolumeUnit !== "common_lot" || value.normalizationRevision !== REVISION) return false;
    try {
      const expected = contractForProvider(value.provider);
      return value.sourceVolumeUnit === expected.sourceVolumeUnit && value.sourceFingerprint === expected.sourceFingerprint;
    } catch {
      return false;
    }
  }

  function normalizeSourceVolume(value, provider) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) throw new Error("taiwan_stock_volume_invalid");
    return sourceVolumeUnitForProvider(provider) === "share" ? numeric / 1000 : numeric;
  }

  function assertPayload(payload) {
    if (!isTaiwanRegularStockSymbol(payload?.symbol)) return payload;
    if (!hasCurrentContract(payload.volumeContract)) throw new Error("taiwan_stock_volume_contract_invalid");
    if ((payload.candles || []).some((row) => !Number.isFinite(Number(row?.volume)) || Number(row.volume) < 0)) throw new Error("taiwan_stock_volume_invalid");
    return payload;
  }

  global.QuoteChartVolumeContract = Object.freeze({
    REVISION,
    isTaiwanRegularStockSymbol,
    sourceVolumeUnitForProvider,
    contractForProvider,
    hasCurrentContract,
    normalizeSourceVolume,
    assertPayload,
  });
})(typeof window !== "undefined" ? window : globalThis);
