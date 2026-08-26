(function initKbarTurnover(globalScope) {
  const TURNOVER_SCHEMA_REVISION = "multiview-kbar-turnover/1";
  const TURNOVER_SOURCE_IDENTITY = "local-shioaji-simulation";
  const CANONICAL_INTEGER_DECIMAL = /^(?:0|[1-9]\d*)(?:\.0+)?$/;

  function parseTurnoverTwd(value) {
    if (typeof value === "number") {
      return Number.isSafeInteger(value) && value >= 0 ? value : null;
    }
    if (typeof value !== "string" || !CANONICAL_INTEGER_DECIMAL.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  function addTurnoverTwd(left, right) {
    const parsedLeft = parseTurnoverTwd(left);
    const parsedRight = parseTurnoverTwd(right);
    if (parsedLeft === null || parsedRight === null) return null;
    const total = parsedLeft + parsedRight;
    return Number.isSafeInteger(total) && total >= 0 ? total : null;
  }

  function formatTurnoverWan(turnoverTwd) {
    const parsed = parseTurnoverTwd(turnoverTwd);
    if (parsed === null) {
      return Object.freeze({ value: "—", accessibleName: "成交值 —" });
    }
    if (parsed === 0) {
      return Object.freeze({ value: "0萬", accessibleName: "成交值 0萬元" });
    }
    if (parsed < 1_000) {
      return Object.freeze({ value: "<0.1萬", accessibleName: "成交值小於 0.1萬元" });
    }
    const wan = parsed / 10_000;
    const formatted = wan >= 100
      ? Math.round(wan).toLocaleString("en-US")
      : wan.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return Object.freeze({ value: `${formatted}萬`, accessibleName: `成交值 ${formatted}萬元` });
  }

  function hasCurrentExactTurnover(candle) {
    return candle?.turnoverSchemaRevision === TURNOVER_SCHEMA_REVISION
      && parseTurnoverTwd(candle?.turnoverTwd) !== null;
  }

  globalScope.QuoteChartKbarTurnover = Object.freeze({
    TURNOVER_SCHEMA_REVISION,
    TURNOVER_SOURCE_IDENTITY,
    addTurnoverTwd,
    formatTurnoverWan,
    hasCurrentExactTurnover,
    parseTurnoverTwd,
  });
})(globalThis);
