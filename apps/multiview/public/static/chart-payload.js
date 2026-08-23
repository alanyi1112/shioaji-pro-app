(function initChartPayload(global) {
  function clonePayload(payload) {
    if (!payload || typeof payload !== "object") return undefined;
    try {
      return JSON.parse(JSON.stringify(payload));
    } catch {
      return undefined;
    }
  }

  function validTime(time) {
    if (typeof time === "number") return Number.isFinite(time);
    if (typeof time === "string") return time.trim().length > 0;
    return Boolean(time && typeof time === "object"
      && Number.isFinite(Number(time.year))
      && Number.isFinite(Number(time.month))
      && Number.isFinite(Number(time.day)));
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === "") return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }

  function timeKey(time) {
    if (!validTime(time)) return "";
    if (typeof time === "object") {
      return `${Number(time.year)}-${String(Number(time.month)).padStart(2, "0")}-${String(Number(time.day)).padStart(2, "0")}`;
    }
    return String(time);
  }

  function normalizeCandles(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row) => {
      if (!row || !validTime(row.time)) return [];
      const open = finiteNumber(row.open);
      const high = finiteNumber(row.high);
      const low = finiteNumber(row.low);
      const close = finiteNumber(row.close);
      if ([open, high, low, close].some((value) => value === undefined)) return [];
      return [{ ...row, open, high, low, close }];
    });
  }

  function normalizeValueSeries(rows, options = {}) {
    if (!Array.isArray(rows)) return [];
    const preserveWhitespace = options.preserveWhitespace === true;
    const allowedTimes = options.allowedTimes instanceof Set ? options.allowedTimes : undefined;
    return rows.flatMap((row) => {
      if (!row || !validTime(row.time)) return [];
      if (allowedTimes && !allowedTimes.has(timeKey(row.time))) return [];
      const value = finiteNumber(row.value);
      if (value !== undefined) return [{ ...row, value }];
      return preserveWhitespace ? [{ time: row.time }] : [];
    });
  }

  function normalizeSeriesAtPath(root, path, options) {
    let owner = root;
    for (let index = 0; index < path.length - 1; index += 1) {
      owner = owner?.[path[index]];
      if (!owner || typeof owner !== "object") return;
    }
    const key = path[path.length - 1];
    if (Array.isArray(owner?.[key])) owner[key] = normalizeValueSeries(owner[key], options);
  }

  function preparePayload(payload) {
    const prepared = clonePayload(payload);
    if (!prepared) {
      const error = new Error("圖表資料格式無效");
      error.code = "invalid-chart-payload";
      throw error;
    }
    try {
      global.QuoteChartVolumeContract?.assertPayload?.(prepared);
    } catch {
      const error = new Error("台股成交量來源或單位契約無效");
      error.code = "invalid-chart-payload";
      throw error;
    }
    prepared.candles = normalizeCandles(prepared.candles);
    if (!prepared.candles.length) {
      const error = new Error("回傳資料沒有可繪製 K 線");
      error.code = "invalid-chart-payload";
      throw error;
    }
    const candleTimes = new Set(prepared.candles.map((row) => timeKey(row.time)));
    const indicators = prepared.indicators && typeof prepared.indicators === "object"
      ? prepared.indicators
      : {};
    prepared.indicators = indicators;
    [
      ["volume"],
      ["volume_moving_average", "ma5"],
      ["volume_moving_average", "ma10"],
      ["volume_moving_average", "ma20"],
      ["moving_average", "ma5"],
      ["moving_average", "ma10"],
      ["moving_average", "ma20"],
      ["moving_average", "ma60"],
      ["moving_average", "ma120"],
      ["bollinger", "upper"],
      ["bollinger", "middle"],
      ["bollinger", "lower"],
      ["rsi", "short"],
      ["rsi", "long"],
      ["kd", "k"],
      ["kd", "d"],
      ["macd", "line"],
      ["macd", "signal"],
      ["macd", "histogram"],
      ["atr"],
    ].forEach((path) => normalizeSeriesAtPath(indicators, path, { allowedTimes: candleTimes }));
    return prepared;
  }

  function plotCoordinateForScreenX(screenX, plotLeft, plotWidth, axisSafeWidth = 0) {
    const x = Number(screenX) - Number(plotLeft);
    const rightEdge = Number(plotWidth) - Math.max(0, Number(axisSafeWidth) || 0);
    return Number.isFinite(x) && Number.isFinite(rightEdge) && x >= 0 && x <= rightEdge ? x : undefined;
  }

  function renderSignature(payload) {
    if (!payload) return "";
    return JSON.stringify({
      candles: payload.candles || [],
      indicators: payload.indicators || {},
      quote: payload.quote || null,
      quoteTime: payload.quoteTime || null,
      marketSession: payload.marketSession || null,
      realtimeCanonicalHandoff: payload.realtimeCanonicalHandoff || null,
      volumeContract: payload.volumeContract || null,
    });
  }

  global.QuoteChartPayload = {
    normalizeCandles,
    normalizeValueSeries,
    plotCoordinateForScreenX,
    preparePayload,
    renderSignature,
  };
})(globalThis);
