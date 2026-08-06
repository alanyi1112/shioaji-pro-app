export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteTime?: number;
  marketSession?: string;
  sourceTimeZone?: string;
};

const rounded = (value: number | null) => value === null ? null : Number(value.toFixed(6));
const point = (time: number, value: number | null) => ({ time, value: rounded(value) });

export type IndicatorParameters = {
  rsi: { shortPeriod: number; longPeriod: number };
  kd: { period: number; rsvWeight: number; kWeight: number };
  macd: { fastPeriod: number; slowPeriod: number; signalPeriod: number };
  atr: { period: number };
};

export const DEFAULT_INDICATOR_PARAMETERS: IndicatorParameters = Object.freeze({
  rsi: Object.freeze({ shortPeriod: 5, longPeriod: 10 }),
  kd: Object.freeze({ period: 9, rsvWeight: 3, kWeight: 3 }),
  macd: Object.freeze({ fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }),
  atr: Object.freeze({ period: 14 }),
});

const integerInRange = (value: unknown, minimum: number, maximum: number, fallback: number) => {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isInteger(numeric) && numeric >= minimum && numeric <= maximum ? numeric : fallback;
};

export function normalizeIndicatorParameters(input: Partial<{
  rsi: Partial<IndicatorParameters["rsi"]>;
  kd: Partial<IndicatorParameters["kd"]>;
  macd: Partial<IndicatorParameters["macd"]>;
  atr: Partial<IndicatorParameters["atr"]>;
}> = {}): IndicatorParameters {
  const shortPeriod = integerInRange(input.rsi?.shortPeriod, 2, 100, DEFAULT_INDICATOR_PARAMETERS.rsi.shortPeriod);
  const longPeriod = integerInRange(input.rsi?.longPeriod, 2, 100, DEFAULT_INDICATOR_PARAMETERS.rsi.longPeriod);
  const fastPeriod = integerInRange(input.macd?.fastPeriod, 2, 200, DEFAULT_INDICATOR_PARAMETERS.macd.fastPeriod);
  const slowPeriod = integerInRange(input.macd?.slowPeriod, 3, 200, DEFAULT_INDICATOR_PARAMETERS.macd.slowPeriod);
  return {
    rsi: shortPeriod < longPeriod
      ? { shortPeriod, longPeriod }
      : { ...DEFAULT_INDICATOR_PARAMETERS.rsi },
    kd: {
      period: integerInRange(input.kd?.period, 2, 100, DEFAULT_INDICATOR_PARAMETERS.kd.period),
      rsvWeight: integerInRange(input.kd?.rsvWeight, 1, 20, DEFAULT_INDICATOR_PARAMETERS.kd.rsvWeight),
      kWeight: integerInRange(input.kd?.kWeight, 1, 20, DEFAULT_INDICATOR_PARAMETERS.kd.kWeight),
    },
    macd: fastPeriod < slowPeriod
      ? {
        fastPeriod,
        slowPeriod,
        signalPeriod: integerInRange(input.macd?.signalPeriod, 2, 100, DEFAULT_INDICATOR_PARAMETERS.macd.signalPeriod),
      }
      : { ...DEFAULT_INDICATOR_PARAMETERS.macd },
    atr: {
      period: integerInRange(input.atr?.period, 2, 100, DEFAULT_INDICATOR_PARAMETERS.atr.period),
    },
  };
}

export function indicatorParametersFromSearchParams(searchParams: Pick<URLSearchParams, "get">) {
  return normalizeIndicatorParameters({
    rsi: { shortPeriod: searchParams.get("rsi_short"), longPeriod: searchParams.get("rsi_long") },
    kd: {
      period: searchParams.get("kd_period"),
      rsvWeight: searchParams.get("kd_rsv_weight"),
      kWeight: searchParams.get("kd_k_weight"),
    },
    macd: {
      fastPeriod: searchParams.get("macd_fast"),
      slowPeriod: searchParams.get("macd_slow"),
      signalPeriod: searchParams.get("macd_signal"),
    },
    atr: { period: searchParams.get("atr_period") },
  });
}

export function indicatorParameterSignature(parameters: IndicatorParameters) {
  const normalized = normalizeIndicatorParameters(parameters);
  return [
    `r${normalized.rsi.shortPeriod}.${normalized.rsi.longPeriod}`,
    `k${normalized.kd.period}.${normalized.kd.rsvWeight}.${normalized.kd.kWeight}`,
    `m${normalized.macd.fastPeriod}.${normalized.macd.slowPeriod}.${normalized.macd.signalPeriod}`,
    `a${normalized.atr.period}`,
  ].join("-");
}

function sma(values: number[], window: number): Array<number | null> {
  return values.map((_, index) => index + 1 < window
    ? null
    : values.slice(index + 1 - window, index + 1).reduce((sum, value) => sum + value, 0) / window);
}

function ema(values: number[], period: number): Array<number | null> {
  const alpha = 2 / (period + 1);
  let current: number | null = null;
  return values.map((value, index) => {
    if (index + 1 < period) return null;
    if (current === null) current = values.slice(index + 1 - period, index + 1).reduce((sum, item) => sum + item, 0) / period;
    else current = value * alpha + current * (1 - alpha);
    return current;
  });
}

function wilderRsi(values: number[], period: number): Array<number | null> {
  let averageGain: number | null = null;
  let averageLoss: number | null = null;
  const gains: number[] = [];
  const losses: number[] = [];
  return values.map((value, index) => {
    if (!index) return null;
    const change = value - values[index - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    gains.push(gain);
    losses.push(loss);
    if (index < period) return null;
    if (averageGain === null || averageLoss === null) {
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
}

function standardDeviation(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function volumeProfile(rows: Candle[], bins = 24) {
  if (!rows.length) return { volume_profile: [], poc: null, vah: null, val: null };
  const low = Math.min(...rows.map((row) => row.low));
  const high = Math.max(...rows.map((row) => row.high));
  if (high === low) return { volume_profile: [{ low, high, volume: rows.reduce((sum, row) => sum + row.volume, 0) }], poc: low, vah: low, val: low };
  const step = (high - low) / bins;
  const volumes = Array.from({ length: bins }, () => 0);
  for (const row of rows) {
    const typical = (row.high + row.low + row.close) / 3;
    const index = Math.min(bins - 1, Math.max(0, Math.floor((typical - low) / step)));
    volumes[index] += row.volume;
  }
  const profile = volumes.map((volume, index) => ({
    low: rounded(low + index * step),
    high: rounded(low + (index + 1) * step),
    volume: rounded(volume),
  }));
  let pocIndex = 0;
  volumes.forEach((volume, index) => { if (volume > volumes[pocIndex]) pocIndex = index; });
  const target = volumes.reduce((sum, value) => sum + value, 0) * 0.7;
  let lower = pocIndex;
  let upper = pocIndex;
  let covered = volumes[pocIndex];
  while (covered < target && (lower > 0 || upper < bins - 1)) {
    const nextLower = lower > 0 ? volumes[lower - 1] : -1;
    const nextUpper = upper < bins - 1 ? volumes[upper + 1] : -1;
    if (nextUpper >= nextLower) { upper += 1; covered += Math.max(0, nextUpper); }
    else { lower -= 1; covered += Math.max(0, nextLower); }
  }
  return {
    volume_profile: profile,
    poc: rounded(((profile[pocIndex].low ?? 0) + (profile[pocIndex].high ?? 0)) / 2),
    vah: profile[upper].high,
    val: profile[lower].low,
  };
}

export function computeIndicators(rows: Candle[], inputParameters: Parameters<typeof normalizeIndicatorParameters>[0] = {}) {
  const parameters = normalizeIndicatorParameters(inputParameters);
  const closes = rows.map((row) => row.close);
  const volumes = rows.map((row) => row.volume);
  const moving_average: Record<string, ReturnType<typeof point>[]> = {};
  for (const window of [5, 10, 20, 60, 120]) {
    moving_average[`ma${window}`] = sma(closes, window).map((value, index) => point(rows[index].time, value));
  }

  const rsi = {
    short: wilderRsi(closes, parameters.rsi.shortPeriod).map((value, index) => point(rows[index].time, value)),
    long: wilderRsi(closes, parameters.rsi.longPeriod).map((value, index) => point(rows[index].time, value)),
  };

  let currentK = 50;
  let currentD = 50;
  const kValues: Array<number | null> = [];
  const dValues: Array<number | null> = [];
  rows.forEach((row, index) => {
    if (index + 1 < parameters.kd.period) {
      kValues.push(null);
      dValues.push(null);
      return;
    }
    const window = rows.slice(index + 1 - parameters.kd.period, index + 1);
    const low = Math.min(...window.map((item) => item.low));
    const high = Math.max(...window.map((item) => item.high));
    const rsv = high === low ? 50 : (row.close - low) / (high - low) * 100;
    currentK = (currentK * (parameters.kd.rsvWeight - 1) + rsv) / parameters.kd.rsvWeight;
    currentD = (currentD * (parameters.kd.kWeight - 1) + currentK) / parameters.kd.kWeight;
    kValues.push(currentK);
    dValues.push(currentD);
  });
  const kd = {
    k: kValues.map((value, index) => point(rows[index].time, value)),
    d: dValues.map((value, index) => point(rows[index].time, value)),
  };

  const fast = ema(closes, parameters.macd.fastPeriod);
  const slow = ema(closes, parameters.macd.slowPeriod);
  const macdValues = fast.map((value, index) => value === null || slow[index] === null ? null : value - (slow[index] as number));
  const signalValues = ema(macdValues.map((value) => value ?? 0), parameters.macd.signalPeriod);
  const macd = {
    line: macdValues.map((value, index) => point(rows[index].time, value)),
    signal: signalValues.map((value, index) => point(rows[index].time, macdValues[index] === null ? null : value)),
    histogram: macdValues.map((value, index) => point(rows[index].time, value === null || signalValues[index] === null ? null : value - (signalValues[index] as number))),
  };

  const bollinger = { upper: [] as ReturnType<typeof point>[], middle: [] as ReturnType<typeof point>[], lower: [] as ReturnType<typeof point>[] };
  rows.forEach((row, index) => {
    if (index + 1 < 20) {
      bollinger.upper.push(point(row.time, null)); bollinger.middle.push(point(row.time, null)); bollinger.lower.push(point(row.time, null));
      return;
    }
    const window = closes.slice(index - 19, index + 1);
    const middle = window.reduce((sum, value) => sum + value, 0) / 20;
    const deviation = standardDeviation(window);
    bollinger.upper.push(point(row.time, middle + 2 * deviation));
    bollinger.middle.push(point(row.time, middle));
    bollinger.lower.push(point(row.time, middle - 2 * deviation));
  });

  let currentAtr: number | null = null;
  const trueRanges: number[] = [];
  const atr = rows.map((row, index) => {
    const previous = index ? rows[index - 1].close : row.close;
    const tr = index ? Math.max(row.high - row.low, Math.abs(row.high - previous), Math.abs(row.low - previous)) : row.high - row.low;
    trueRanges.push(tr);
    if (index + 1 < parameters.atr.period) return point(row.time, null);
    currentAtr = currentAtr === null
      ? trueRanges.slice(-parameters.atr.period).reduce((sum, value) => sum + value, 0) / parameters.atr.period
      : (currentAtr * (parameters.atr.period - 1) + tr) / parameters.atr.period;
    return point(row.time, currentAtr);
  });

  const fvg: Array<{ type: string; from: number; to: number; time: number }> = [];
  for (let index = 2; index < rows.length; index += 1) {
    const first = rows[index - 2]; const third = rows[index];
    if (third.low > first.high) fvg.push({ type: "bullish", from: rounded(first.high)!, to: rounded(third.low)!, time: third.time });
    if (third.high < first.low) fvg.push({ type: "bearish", from: rounded(third.high)!, to: rounded(first.low)!, time: third.time });
  }
  const profile = volumeProfile(rows);
  return {
    volume: rows.map((row) => ({ time: row.time, value: rounded(row.volume), color: row.close >= row.open ? "#dc2626" : "#16a34a" })),
    volume_moving_average: {
      ma5: sma(volumes, 5).map((value, index) => point(rows[index].time, value)),
      ma10: sma(volumes, 10).map((value, index) => point(rows[index].time, value)),
      ma20: sma(volumes, 20).map((value, index) => point(rows[index].time, value)),
    },
    parameters, moving_average, rsi, kd, macd, bollinger, atr, fvg, ...profile,
  };
}
