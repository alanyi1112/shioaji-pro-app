(function initRealtimeCharts(globalScope) {
  const REALTIME_INTERVALS = new Set(["1d", "1wk", "1mo"]);

  function taipeiMidnight(sessionDate) {
    return Math.floor(Date.parse(`${sessionDate}T00:00:00+08:00`) / 1000);
  }

  function availableIntervals(baseIntervals, symbol, capabilityEnabled) {
    void symbol;
    void capabilityEnabled;
    return [...new Set(baseIntervals || [])].filter((interval) => REALTIME_INTERVALS.has(interval));
  }

  function sessionDateForTime(value) {
    const timestamp = typeof value === "number" ? value * 1000 : Date.parse(value);
    if (!Number.isFinite(timestamp)) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date(timestamp)).reduce((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function periodKey(interval, sessionDate) {
    if (interval === "1d") return sessionDate;
    if (interval === "1mo") return sessionDate.slice(0, 7);
    const date = new Date(`${sessionDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return date.toISOString().slice(0, 10);
  }

  function candlePeriodKey(interval, candle) {
    const date = sessionDateForTime(candle.time);
    return date ? periodKey(interval, date) : "";
  }

  function validSnapshot(snapshot) {
    return snapshot
      && (/^\d{4,6}[A-Z]?\.(TW|TWO)$/.test(String(snapshot.canonicalSymbol || "")) || String(snapshot.canonicalSymbol || "") === "^TWII")
      && /^\d{4}-\d{2}-\d{2}$/.test(String(snapshot.sessionDate || ""))
      && [snapshot.open, snapshot.high, snapshot.low, snapshot.close, snapshot.averagePrice, snapshot.totalVolume].every(Number.isFinite);
  }

  function canonicalHandoffReady(payload, snapshot) {
    if (!payload || !validSnapshot(snapshot)) return false;
    const verification = String(
      payload.realtimeCanonicalHandoff?.verificationStatus
      || payload.quote?.verification?.status
      || payload.quote?.verification
      || "",
    ).toLowerCase();
    const sessionDate = String(payload.realtimeCanonicalHandoff?.sessionDate || payload.quote?.sessionDate || "");
    return verification === "verified" && sessionDate >= snapshot.sessionDate;
  }

  function aggregateCompletedDaily(dailyHistory, interval, sessionDate) {
    const target = periodKey(interval, sessionDate);
    const rows = (dailyHistory || []).filter((row) => {
      const date = sessionDateForTime(row.time);
      return date && date < sessionDate && periodKey(interval, date) === target;
    }).sort((a, b) => Number(a.time) - Number(b.time));
    if (!rows.length) return null;
    return {
      time: rows[0].time,
      open: Number(rows[0].open),
      high: Math.max(...rows.map((row) => Number(row.high))),
      low: Math.min(...rows.map((row) => Number(row.low))),
      close: Number(rows.at(-1).close),
      volume: rows.reduce((sum, row) => sum + Math.max(0, Number(row.volume) || 0), 0),
    };
  }

  function mergeRealtimeOverlay({ history = [], dailyHistory = [], interval, snapshot, state = "live" }) {
    const canonical = history.map((row) => ({ ...row }));
    if (!REALTIME_INTERVALS.has(interval) || !validSnapshot(snapshot) || !["live", "degraded"].includes(state)) {
      return { candles: canonical, applied: false, state };
    }
    const key = periodKey(interval, snapshot.sessionDate);
    const provisional = canonical.find((row) => candlePeriodKey(interval, row) === key);
    const withoutProvisional = canonical.filter((row) => candlePeriodKey(interval, row) !== key);
    const base = interval === "1d" ? null : aggregateCompletedDaily(dailyHistory, interval, snapshot.sessionDate);
    const time = provisional?.time ?? base?.time ?? taipeiMidnight(snapshot.sessionDate);
    const candle = interval === "1d" ? {
      time,
      open: Number(snapshot.open), high: Number(snapshot.high), low: Number(snapshot.low), close: Number(snapshot.close),
      volume: Number(snapshot.totalVolume),
    } : {
      time,
      open: base?.open ?? Number(snapshot.open),
      high: Math.max(base?.high ?? Number(snapshot.high), Number(snapshot.high)),
      low: Math.min(base?.low ?? Number(snapshot.low), Number(snapshot.low)),
      close: Number(snapshot.close),
      volume: (base?.volume || 0) + Number(snapshot.totalVolume),
    };
    const overlay = {
      ...candle,
      quoteTime: Math.floor(Date.parse(snapshot.sourceTime) / 1000),
      sourceUpdatedAt: snapshot.sourceTime,
      marketSession: "open",
      sourceTimeZone: "Asia/Taipei",
      realtime: {
        provider: snapshot.provider,
        periodKey: key,
        sessionDate: snapshot.sessionDate,
        sourceTime: snapshot.sourceTime,
        receivedTime: snapshot.receivedTime,
        freshness: state,
        provisional: true,
        continuity: snapshot.continuity,
        volumeAvailable: snapshot.volumeAvailable !== false,
      },
    };
    return { candles: [...withoutProvisional, overlay].sort((a, b) => Number(a.time) - Number(b.time)), candle: overlay, applied: true, state };
  }

  function createIntradayAccumulator(options = {}) {
    const bucketSeconds = Number(options.bucketSeconds || 60);
    let sessionDate = "";
    let lastSourceTime = 0;
    let lastSequence = 0;
    let lastTotalVolume = 0;
    let previousClose = Number(options.previousClose);
    const prices = [];
    const averages = [];
    const volumeByBucket = new Map();
    let summary = null;

    function reset(nextSessionDate) {
      sessionDate = nextSessionDate;
      lastSourceTime = 0;
      lastSequence = 0;
      lastTotalVolume = 0;
      prices.length = 0;
      averages.length = 0;
      volumeByBucket.clear();
      summary = null;
    }

    function append(snapshot) {
      if (!validSnapshot(snapshot)) return false;
      if (sessionDate && snapshot.sessionDate < sessionDate) return false;
      if (snapshot.sessionDate !== sessionDate) reset(snapshot.sessionDate);
      const sourceTime = Date.parse(snapshot.sourceTime);
      if (!Number.isFinite(sourceTime) || sourceTime < lastSourceTime || (sourceTime === lastSourceTime && Number(snapshot.sequence) <= lastSequence)) return false;
      const time = Math.floor(sourceTime / 1000);
      const bucketTime = Math.floor(time / bucketSeconds) * bucketSeconds;
      const totalVolume = Number(snapshot.totalVolume);
      const delta = lastSourceTime
        ? Math.max(0, totalVolume - lastTotalVolume)
        : Math.max(0, Number(snapshot.tickVolume) || 0);
      const color = prices.length && Number(snapshot.close) < Number(prices.at(-1).value) ? "#16a34a" : "#dc2626";
      prices.push({ time, value: Number(snapshot.close) });
      averages.push({ time, value: Number(snapshot.averagePrice) });
      const prior = volumeByBucket.get(bucketTime);
      volumeByBucket.set(bucketTime, { time: bucketTime, value: (prior?.value || 0) + delta, color });
      lastSourceTime = sourceTime;
      lastSequence = Number(snapshot.sequence);
      lastTotalVolume = Math.max(lastTotalVolume, totalVolume);
      summary = {
        sessionDate,
        sourceTime: snapshot.sourceTime,
        open: Number(snapshot.open), high: Number(snapshot.high), low: Number(snapshot.low), close: Number(snapshot.close),
        averagePrice: Number(snapshot.averagePrice), totalVolume: lastTotalVolume,
        previousClose: Number.isFinite(previousClose) ? previousClose : null,
        provider: snapshot.provider, continuity: snapshot.continuity,
      };
      return true;
    }

    function appendMany(snapshots) {
      return [...(snapshots || [])].sort((a, b) => Date.parse(a.sourceTime) - Date.parse(b.sourceTime) || Number(a.sequence) - Number(b.sequence)).reduce((count, item) => count + (append(item) ? 1 : 0), 0);
    }

    function loadMinuteSession(points, metadata = {}) {
      const ordered = [...(points || [])].sort((a, b) => Number(a.time) - Number(b.time));
      if (!ordered.length) return 0;
      reset(String(metadata.sessionDate || ""));
      for (const point of ordered) {
        const time = Number(point.time);
        const sourceTime = Number(point.sourceTime);
        if (!Number.isFinite(time) || !Number.isFinite(sourceTime) || !Number.isFinite(Number(point.close)) || !Number.isFinite(Number(point.averagePrice))) continue;
        prices.push({ time, value: Number(point.close) });
        averages.push({ time, value: Number(point.averagePrice) });
        volumeByBucket.set(time, { time, value: Math.max(0, Number(point.volume) || 0), color: prices.length > 1 && Number(point.close) < Number(prices.at(-2).value) ? "#16a34a" : "#dc2626" });
        lastSourceTime = Math.max(lastSourceTime, sourceTime);
        lastTotalVolume = Math.max(lastTotalVolume, Number(point.totalVolume) || 0);
      }
      summary = prices.length ? {
        sessionDate,
        sourceTime: new Date(lastSourceTime).toISOString(),
        open: Number(metadata.open), high: Number(metadata.high), low: Number(metadata.low), close: prices.at(-1).value,
        averagePrice: averages.at(-1).value, totalVolume: lastTotalVolume,
        previousClose: Number.isFinite(previousClose) ? previousClose : null,
        provider: "shioaji", continuity: ordered.some((point) => point.continuity === "partial") ? "partial" : "complete",
      } : null;
      return prices.length;
    }

    return {
      append,
      appendMany,
      loadMinuteSession,
      setPreviousClose(value) { previousClose = Number(value); },
      snapshot() {
        return { prices: prices.map((item) => ({ ...item })), averages: averages.map((item) => ({ ...item })), volumes: [...volumeByBucket.values()].sort((a, b) => a.time - b.time), summary: summary ? { ...summary } : null };
      },
    };
  }

  globalScope.QuoteChartRealtimeCharts = {
    availableIntervals,
    aggregateCompletedDaily,
    canonicalHandoffReady,
    createIntradayAccumulator,
    mergeRealtimeOverlay,
    periodKey,
    sessionDateForTime,
  };
})(globalThis);
