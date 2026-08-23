(function initRealtimeIndicators(globalScope) {
  const acceptance = globalScope.QuoteChartAcceptance;
  const rounded = (value) => value == null ? null : Number(value.toFixed(6));
  const point = (time, value) => ({ time, value: rounded(value) });
  const sma = (values, period) => values.map((_, index) => index + 1 < period ? null : values.slice(index + 1 - period, index + 1).reduce((sum, value) => sum + value, 0) / period);
  const ema = (values, period) => {
    const alpha = 2 / (period + 1); let current = null;
    return values.map((value, index) => {
      if (index + 1 < period) return null;
      current = current == null ? values.slice(index + 1 - period, index + 1).reduce((sum, item) => sum + item, 0) / period : value * alpha + current * (1 - alpha);
      return current;
    });
  };
  const wilderRsi = (values, period) => {
    let averageGain = null; let averageLoss = null; const gains = []; const losses = [];
    return values.map((value, index) => {
      if (!index) return null;
      const change = value - values[index - 1]; const gain = Math.max(change, 0); const loss = Math.max(-change, 0);
      gains.push(gain); losses.push(loss);
      if (index < period) return null;
      if (averageGain == null || averageLoss == null) {
        averageGain = gains.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
        averageLoss = losses.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
      } else {
        averageGain = (averageGain * (period - 1) + gain) / period;
        averageLoss = (averageLoss * (period - 1) + loss) / period;
      }
      if (averageGain === 0 && averageLoss === 0) return 50;
      if (averageLoss === 0) return 100;
      return 100 - 100 / (1 + averageGain / averageLoss);
    });
  };
  const standardDeviation = (values) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  };
  const volumeProfile = (rows, bins = 24) => {
    if (!rows.length) return { volume_profile: [], poc: null, vah: null, val: null };
    const low = Math.min(...rows.map((row) => Number(row.low)));
    const high = Math.max(...rows.map((row) => Number(row.high)));
    if (high === low) return { volume_profile: [{ low, high, volume: rows.reduce((sum, row) => sum + Number(row.volume), 0) }], poc: low, vah: low, val: low };
    const step = (high - low) / bins;
    const volumes = Array.from({ length: bins }, () => 0);
    for (const row of rows) {
      const typical = (Number(row.high) + Number(row.low) + Number(row.close)) / 3;
      const index = Math.min(bins - 1, Math.max(0, Math.floor((typical - low) / step)));
      volumes[index] += Number(row.volume) || 0;
    }
    const profile = volumes.map((volume, index) => ({ low: rounded(low + index * step), high: rounded(low + (index + 1) * step), volume: rounded(volume) }));
    let pocIndex = 0;
    volumes.forEach((volume, index) => { if (volume > volumes[pocIndex]) pocIndex = index; });
    const target = volumes.reduce((sum, value) => sum + value, 0) * 0.7;
    let lower = pocIndex; let upper = pocIndex; let covered = volumes[pocIndex];
    while (covered < target && (lower > 0 || upper < bins - 1)) {
      const nextLower = lower > 0 ? volumes[lower - 1] : -1;
      const nextUpper = upper < bins - 1 ? volumes[upper + 1] : -1;
      if (nextUpper >= nextLower) { upper += 1; covered += Math.max(0, nextUpper); }
      else { lower -= 1; covered += Math.max(0, nextLower); }
    }
    return { volume_profile: profile, poc: rounded((profile[pocIndex].low + profile[pocIndex].high) / 2), vah: profile[upper].high, val: profile[lower].low };
  };

  function compute(rows, input = {}, { volumeAvailable = true } = {}) {
    acceptance?.increment("indicatorFullRecomputeCount");
    const parameters = {
      rsi: { shortPeriod: Number(input.rsi?.shortPeriod || 5), longPeriod: Number(input.rsi?.longPeriod || 10) },
      kd: { period: Number(input.kd?.period || 9), rsvWeight: Number(input.kd?.rsvWeight || 3), kWeight: Number(input.kd?.kWeight || 3) },
      macd: { fastPeriod: Number(input.macd?.fastPeriod || 12), slowPeriod: Number(input.macd?.slowPeriod || 26), signalPeriod: Number(input.macd?.signalPeriod || 9) },
      atr: { period: Number(input.atr?.period || 14) },
    };
    const closes = rows.map((row) => Number(row.close)); const volumes = rows.map((row) => Number(row.volume) || 0);
    const moving_average = {};
    for (const period of [5, 10, 20, 60, 120]) moving_average[`ma${period}`] = sma(closes, period).map((value, index) => point(rows[index].time, value));
    const rsi = {
      short: wilderRsi(closes, parameters.rsi.shortPeriod).map((value, index) => point(rows[index].time, value)),
      long: wilderRsi(closes, parameters.rsi.longPeriod).map((value, index) => point(rows[index].time, value)),
    };
    let currentK = 50; let currentD = 50; const kValues = []; const dValues = [];
    rows.forEach((row, index) => {
      if (index + 1 < parameters.kd.period) { kValues.push(null); dValues.push(null); return; }
      const window = rows.slice(index + 1 - parameters.kd.period, index + 1);
      const low = Math.min(...window.map((item) => item.low)); const high = Math.max(...window.map((item) => item.high));
      const rsv = high === low ? 50 : (row.close - low) / (high - low) * 100;
      currentK = (currentK * (parameters.kd.rsvWeight - 1) + rsv) / parameters.kd.rsvWeight;
      currentD = (currentD * (parameters.kd.kWeight - 1) + currentK) / parameters.kd.kWeight;
      kValues.push(currentK); dValues.push(currentD);
    });
    const kd = { k: kValues.map((value, index) => point(rows[index].time, value)), d: dValues.map((value, index) => point(rows[index].time, value)) };
    const fast = ema(closes, parameters.macd.fastPeriod); const slow = ema(closes, parameters.macd.slowPeriod);
    const macdValues = fast.map((value, index) => value == null || slow[index] == null ? null : value - slow[index]);
    const signalValues = ema(macdValues.map((value) => value ?? 0), parameters.macd.signalPeriod);
    const macd = {
      line: macdValues.map((value, index) => point(rows[index].time, value)),
      signal: signalValues.map((value, index) => point(rows[index].time, macdValues[index] == null ? null : value)),
      histogram: macdValues.map((value, index) => point(rows[index].time, value == null || signalValues[index] == null ? null : value - signalValues[index])),
    };
    const bollinger = { upper: [], middle: [], lower: [] };
    rows.forEach((row, index) => {
      if (index + 1 < 20) { bollinger.upper.push(point(row.time, null)); bollinger.middle.push(point(row.time, null)); bollinger.lower.push(point(row.time, null)); return; }
      const window = closes.slice(index - 19, index + 1); const middle = window.reduce((sum, value) => sum + value, 0) / 20; const deviation = standardDeviation(window);
      bollinger.upper.push(point(row.time, middle + 2 * deviation)); bollinger.middle.push(point(row.time, middle)); bollinger.lower.push(point(row.time, middle - 2 * deviation));
    });
    let currentAtr = null; const trueRanges = [];
    const atr = rows.map((row, index) => {
      const previous = index ? rows[index - 1].close : row.close;
      const tr = index ? Math.max(row.high - row.low, Math.abs(row.high - previous), Math.abs(row.low - previous)) : row.high - row.low;
      trueRanges.push(tr);
      if (index + 1 < parameters.atr.period) return point(row.time, null);
      currentAtr = currentAtr == null ? trueRanges.slice(-parameters.atr.period).reduce((sum, value) => sum + value, 0) / parameters.atr.period : (currentAtr * (parameters.atr.period - 1) + tr) / parameters.atr.period;
      return point(row.time, currentAtr);
    });
    const volume = volumeAvailable ? rows.map((row) => ({ time: row.time, value: rounded(row.volume), color: row.close >= row.open ? "#dc2626" : "#16a34a" })) : [];
    const volume_moving_average = volumeAvailable ? Object.fromEntries([5, 10, 20].map((period) => [`ma${period}`, sma(volumes, period).map((value, index) => point(rows[index].time, value))])) : { ma5: [], ma10: [], ma20: [] };
    const fvg = [];
    for (let index = 2; index < rows.length; index += 1) {
      const first = rows[index - 2]; const third = rows[index];
      if (third.low > first.high) fvg.push({ type: "bullish", from: rounded(first.high), to: rounded(third.low), time: third.time });
      if (third.high < first.low) fvg.push({ type: "bearish", from: rounded(third.high), to: rounded(first.low), time: third.time });
    }
    return { parameters, moving_average, rsi, kd, macd, bollinger, atr, volume, volume_moving_average, fvg, ...volumeProfile(rows) };
  }

  function createLatestWinsScheduler(options = {}) {
    const setTimeoutImpl = options.setTimeoutImpl || globalScope.setTimeout?.bind(globalScope);
    const clearTimeoutImpl = options.clearTimeoutImpl || globalScope.clearTimeout?.bind(globalScope);
    const delay = Math.max(100, Math.min(250, Number(options.delay || 150)));
    let timer; let generation = 0; let pending;
    return {
      request(key, rows, parameters, computeOptions, onResult) {
        generation += 1; const current = generation;
        pending = { key, rows: rows.map((row) => ({ ...row })), parameters, computeOptions, onResult, current };
        if (timer) clearTimeoutImpl(timer);
        timer = setTimeoutImpl(() => {
          timer = undefined; const job = pending; pending = undefined;
          if (!job || job.current !== generation) return;
          const result = compute(job.rows, job.parameters, job.computeOptions);
          if (job.current === generation) job.onResult(result, job.key);
        }, delay);
      },
      cancel() { generation += 1; pending = undefined; if (timer) clearTimeoutImpl(timer); timer = undefined; },
    };
  }

  globalScope.QuoteChartRealtimeIndicators = { compute, createLatestWinsScheduler };
})(globalThis);
