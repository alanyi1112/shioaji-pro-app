import type { HistoryCandle } from "./candle-history";

export const TAIWAN_STOCK_VOLUME_NORMALIZATION_REVISION = "taiwan-stock-common-lot/1";

export type TaiwanStockVolumeUnit = "share" | "common_lot";

export type TaiwanStockVolumeContract = {
  market: "TW";
  securityType: "STK";
  provider: string;
  sourceVolumeUnit: TaiwanStockVolumeUnit;
  canonicalVolumeUnit: "common_lot";
  normalizationRevision: typeof TAIWAN_STOCK_VOLUME_NORMALIZATION_REVISION;
  sourceFingerprint: string;
};

const COMMON_LOT_PROVIDERS = new Set(["shioaji", "shioaji-kbars", "shioaji-realtime"]);
const SHARE_PROVIDERS = new Set([
  "yahoo-chart",
  "yfinance",
  "yfinance-weekly-from-daily-v1",
  "yfinance-monthly-from-daily-v1",
  "yfinance+twse-official-tail-v1",
  "twse",
  "tpex",
  "twse-official",
  "tpex-official",
  "twse-mis",
]);

export function isTaiwanRegularStockSymbol(symbol: string) {
  return /^\d{4,6}[A-Z]?\.(TW|TWO)$/i.test(String(symbol || "").trim());
}

function canonicalProvider(provider: string) {
  return String(provider || "").trim().toLowerCase();
}

export function sourceVolumeUnitForProvider(provider: string): TaiwanStockVolumeUnit {
  const normalized = canonicalProvider(provider);
  if (COMMON_LOT_PROVIDERS.has(normalized)) return "common_lot";
  if (SHARE_PROVIDERS.has(normalized)) return "share";
  throw new Error("taiwan_stock_volume_provider_unknown");
}

export function taiwanStockVolumeContract(provider: string): TaiwanStockVolumeContract {
  const normalized = canonicalProvider(provider);
  const sourceVolumeUnit = sourceVolumeUnitForProvider(normalized);
  return {
    market: "TW",
    securityType: "STK",
    provider: normalized,
    sourceVolumeUnit,
    canonicalVolumeUnit: "common_lot",
    normalizationRevision: TAIWAN_STOCK_VOLUME_NORMALIZATION_REVISION,
    sourceFingerprint: [normalized, sourceVolumeUnit, "common_lot", TAIWAN_STOCK_VOLUME_NORMALIZATION_REVISION].join("|"),
  };
}

export function normalizeTaiwanStockVolume(value: number, provider: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error("taiwan_stock_volume_invalid");
  return sourceVolumeUnitForProvider(provider) === "share" ? value / 1000 : value;
}

export function normalizeTaiwanStockCandleRows(rows: HistoryCandle[], provider: string) {
  const contract = taiwanStockVolumeContract(provider);
  return {
    contract,
    rows: rows.map((row) => ({
      ...row,
      volume: normalizeTaiwanStockVolume(row.volume, contract.provider),
    })),
  };
}

export function hasCurrentTaiwanStockVolumeContract(value: unknown): value is TaiwanStockVolumeContract {
  if (!value || typeof value !== "object") return false;
  const contract = value as Partial<TaiwanStockVolumeContract>;
  if (contract.market !== "TW" || contract.securityType !== "STK") return false;
  if (contract.canonicalVolumeUnit !== "common_lot" || contract.normalizationRevision !== TAIWAN_STOCK_VOLUME_NORMALIZATION_REVISION) return false;
  try {
    const expected = taiwanStockVolumeContract(String(contract.provider || ""));
    return contract.sourceVolumeUnit === expected.sourceVolumeUnit
      && contract.sourceFingerprint === expected.sourceFingerprint;
  } catch {
    return false;
  }
}
