export const CANDLE_CONTINUITY_AUDIT_BATCH_LIMIT = 8;
export const CANDLE_CONTINUITY_AUDIT_CONCURRENCY = 2;

export type CandleContinuityAuditItem = {
  symbol: string;
  status: "complete" | "partial" | "unknown" | "failed";
  missingSessionCount: number;
  verifiedThrough: string | null;
  checkedAt: string | null;
  reasonCode: string | null;
};

type AcceptanceSummaryOptions = { from?: string; through?: string };

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sessionDate(value: unknown) {
  const seconds = Number(jsonRecord(value).time);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString().slice(0, 10) : "";
}

export function summarizeCandleContinuityAcceptance(value: unknown, options: AcceptanceSummaryOptions = {}) {
  const payload = jsonRecord(value);
  const candles = Array.isArray(payload.candles) ? payload.candles : [];
  const dataWindow = jsonRecord(payload.dataWindow);
  const cache = jsonRecord(dataWindow.cache);
  const dataQuality = jsonRecord(payload.dataQuality);
  const quote = jsonRecord(payload.quote);
  const quoteQuality = jsonRecord(quote.dataQuality);
  const continuity = jsonRecord(dataQuality.continuity || dataWindow.continuity || cache.continuity || quoteQuality.continuity);
  const verification = jsonRecord(quote.verification);
  const dates = candles.map(sessionDate).filter(Boolean);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(options.from || "")) ? String(options.from) : "0000-01-01";
  const through = /^\d{4}-\d{2}-\d{2}$/.test(String(options.through || "")) ? String(options.through) : "9999-12-31";
  return {
    candleCount: candles.length,
    firstSessionDate: dates[0] || null,
    lastSessionDate: dates.at(-1) || null,
    windowSessionDates: dates.filter((date) => date >= from && date <= through).slice(0, 32),
    uniqueSessionDates: new Set(dates).size,
    cacheState: String(cache.state || "none"),
    cacheStore: String(cache.store || "none"),
    continuityStatus: String(continuity.status || "unknown"),
    missingSessionCount: Math.max(0, Number(continuity.missingSessionCount) || 0),
    verifiedThrough: typeof continuity.verifiedThrough === "string" ? continuity.verifiedThrough : null,
    verificationStatus: String(verification.status || "unverified"),
    verificationScope: typeof verification.scope === "string" ? verification.scope : null,
  };
}

function eligibleSymbol(value: unknown) {
  const symbol = String(value || "").trim().toUpperCase();
  return /^\d{4,6}[A-Z]?\.(TW|TWO)$/.test(symbol) ? symbol : "";
}

export function planCandleContinuityAuditBatch(
  values: unknown[],
  options: { cursor?: string | null; limit?: number } = {},
) {
  const cursor = eligibleSymbol(options.cursor) || "";
  const limit = Math.max(1, Math.min(CANDLE_CONTINUITY_AUDIT_BATCH_LIMIT, Math.floor(Number(options.limit) || CANDLE_CONTINUITY_AUDIT_BATCH_LIMIT)));
  const candidates = [...new Set(values.map(eligibleSymbol).filter(Boolean))].sort().filter((symbol) => !cursor || symbol > cursor);
  const symbols = candidates.slice(0, limit);
  return {
    symbols,
    nextCursor: candidates.length > symbols.length ? symbols.at(-1) || null : null,
    remaining: Math.max(0, candidates.length - symbols.length),
  };
}

function safeFailureReason(error: unknown) {
  const value = error instanceof Error ? error.message : String(error || "");
  if (value.includes("rate_limited")) return "rate_limited";
  if (value.includes("provider_unavailable")) return "provider_unavailable";
  if (value.includes("d1_unavailable") || value.includes("write_failed")) return "storage_unavailable";
  return "audit_failed";
}

export async function runCandleContinuityAuditBatch(
  symbols: string[],
  auditor: (symbol: string) => Promise<Omit<CandleContinuityAuditItem, "symbol">>,
  concurrency = CANDLE_CONTINUITY_AUDIT_CONCURRENCY,
) {
  const results = new Array<CandleContinuityAuditItem>(symbols.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(CANDLE_CONTINUITY_AUDIT_CONCURRENCY, Math.floor(concurrency) || 1)) }, async () => {
    while (nextIndex < symbols.length) {
      const index = nextIndex++;
      const symbol = symbols[index];
      try {
        results[index] = { symbol, ...(await auditor(symbol)) };
      } catch (error) {
        results[index] = {
          symbol,
          status: "failed",
          missingSessionCount: 0,
          verifiedThrough: null,
          checkedAt: null,
          reasonCode: safeFailureReason(error),
        };
      }
    }
  });
  await Promise.all(workers);
  return results;
}
