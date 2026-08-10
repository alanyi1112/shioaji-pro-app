import type { Candle } from "./indicators";

export type PivotMode = "traditional";
export type PivotReferenceInterval = "1m" | "5m" | "15m" | "1h" | "1d" | "1wk" | "1mo";
export type TraditionalPivotLevels = {
  p: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
};
export type ThreeLevelPriceLevels = {
  up: number;
  mid: number;
  down: number;
};
export type CdpLevels = {
  ah: number;
  nh: number;
  cdp: number;
  nl: number;
  al: number;
};
export type SupportResistanceFormulaLevels = {
  pivotPoint: TraditionalPivotLevels;
  threeLevelPrice: ThreeLevelPriceLevels;
  cdp: CdpLevels;
};
export type PivotReferenceStatus = "completed" | "provisional";
export type PivotApplication = "next-source-candle" | "next-trading-day" | "next-trading-week" | "next-trading-month";
export type PivotTarget = { time: number; referencePeriodKey: string };
export type TraditionalPivotProjection = TraditionalPivotLevels & {
  referenceTime: number;
  referencePeriodKey: string;
  referenceStatus: PivotReferenceStatus;
  appliesTo: PivotApplication;
  applicablePeriodKey?: string;
  formulaLevels: SupportResistanceFormulaLevels;
};
export type TraditionalPivotIndicator = {
  type: PivotMode;
  contractVersion: "selected-next-period-v1";
  referenceInterval: PivotReferenceInterval;
  status: "available" | "unavailable";
  targets: PivotTarget[];
  projections: TraditionalPivotProjection[];
};

export const PIVOT_PROJECTION_CONTRACT_VERSION = "selected-next-period-v1" as const;
export const THREE_LEVEL_PRICE_VERSION = "three-level-price-tw-v1" as const;
export const CDP_VERSION = "cdp-wilder-tw-v1" as const;

export function normalizePivotMode(value: unknown): PivotMode | null {
  return String(value ?? "").trim().toLowerCase() === "traditional" ? "traditional" : null;
}

export function pivotReferenceInterval(interval: unknown): PivotReferenceInterval | null {
  const normalized = String(interval ?? "").trim().toLowerCase();
  if (["1m", "5m", "15m", "1h", "1d", "1wk", "1mo"].includes(normalized)) {
    return normalized as PivotReferenceInterval;
  }
  return null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function roundPivot(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function validReferenceOhlc(input: Partial<Pick<Candle, "high" | "low" | "close">>) {
  const { high, low, close } = input;
  return finiteNumber(high)
    && finiteNumber(low)
    && finiteNumber(close)
    && high >= low
    && close >= low
    && close <= high;
}

export function computeTraditionalPivot(input: Partial<Pick<Candle, "high" | "low" | "close">>): TraditionalPivotLevels | null {
  const { high, low, close } = input;
  if (!validReferenceOhlc(input) || !finiteNumber(high) || !finiteNumber(low) || !finiteNumber(close)) return null;
  const p = (high + low + close) / 3;
  const range = high - low;
  const r1 = 2 * p - low;
  const s1 = 2 * p - high;
  return {
    p: roundPivot(p),
    r1: roundPivot(r1),
    r2: roundPivot(p + range),
    r3: roundPivot(r1 + range),
    s1: roundPivot(s1),
    s2: roundPivot(p - range),
    s3: roundPivot(s1 - range),
  };
}

export function computeThreeLevelPrice(input: Partial<Pick<Candle, "high" | "low" | "close">>): ThreeLevelPriceLevels | null {
  const { high, low } = input;
  if (!validReferenceOhlc(input) || !finiteNumber(high) || !finiteNumber(low)) return null;
  const range = high - low;
  return {
    up: roundPivot(high + range * 0.382),
    mid: roundPivot((high + low) / 2),
    down: roundPivot(low - range * 0.382),
  };
}

export function computeCdp(input: Partial<Pick<Candle, "high" | "low" | "close">>): CdpLevels | null {
  const { high, low, close } = input;
  if (!validReferenceOhlc(input) || !finiteNumber(high) || !finiteNumber(low) || !finiteNumber(close)) return null;
  const cdp = (2 * close + high + low) / 4;
  const range = high - low;
  return {
    ah: roundPivot(cdp + range),
    nh: roundPivot(2 * cdp - low),
    cdp: roundPivot(cdp),
    nl: roundPivot(2 * cdp - high),
    al: roundPivot(cdp - range),
  };
}

export function computeSupportResistanceFormulaLevels(
  input: Partial<Pick<Candle, "high" | "low" | "close">>,
): SupportResistanceFormulaLevels | null {
  const pivotPoint = computeTraditionalPivot(input);
  const threeLevelPrice = computeThreeLevelPrice(input);
  const cdp = computeCdp(input);
  return pivotPoint && threeLevelPrice && cdp ? { pivotPoint, threeLevelPrice, cdp } : null;
}

export function dateKeyInTimeZone(time: number, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(time * 1000)).reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return new Date(time * 1000).toISOString().slice(0, 10);
  }
}

export function referencePeriodKey(time: number, interval: PivotReferenceInterval, timeZone: string) {
  if (["1m", "5m", "15m", "1h"].includes(interval)) return String(time);
  const sessionDate = dateKeyInTimeZone(time, timeZone);
  if (interval === "1d") return sessionDate;
  if (interval === "1mo") return sessionDate.slice(0, 7);
  const monday = new Date(`${sessionDate}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

export function buildTraditionalPivotIndicator(
  targetRows: Candle[],
  referenceRows: Candle[],
  chartInterval: string,
  timeZone = "UTC",
  options: { provisionalReferencePeriodKey?: string } = {},
): TraditionalPivotIndicator {
  const referenceInterval = pivotReferenceInterval(chartInterval) ?? "1d";
  const referencesByPeriod = new Map<string, Candle>();
  [...referenceRows]
    .sort((left, right) => left.time - right.time)
    .forEach((row) => referencesByPeriod.set(referencePeriodKey(row.time, referenceInterval, timeZone), row));
  const orderedReferences = [...referencesByPeriod.entries()].sort(([left], [right]) => left.localeCompare(right));
  const targetPeriods = new Set(targetRows.map((row) => referencePeriodKey(row.time, referenceInterval, timeZone)));
  const targets = targetRows.map((row) => ({
    time: row.time,
    referencePeriodKey: referencePeriodKey(row.time, referenceInterval, timeZone),
  }));
  const appliesTo: PivotApplication = referenceInterval === "1wk"
    ? "next-trading-week"
    : referenceInterval === "1mo"
      ? "next-trading-month"
      : referenceInterval === "1d" ? "next-trading-day" : "next-source-candle";
  const projections = orderedReferences.flatMap(([period, reference], index) => {
    if (!targetPeriods.has(period)) return [];
    const formulaLevels = computeSupportResistanceFormulaLevels(reference);
    if (!formulaLevels) return [];
    const levels = formulaLevels.pivotPoint;
    const nextPeriod = orderedReferences[index + 1]?.[0];
    return [{
      ...levels,
      referenceTime: reference.time,
      referencePeriodKey: period,
      referenceStatus: period === options.provisionalReferencePeriodKey ? "provisional" as const : "completed" as const,
      appliesTo,
      formulaLevels,
      ...(nextPeriod ? { applicablePeriodKey: nextPeriod } : {}),
    }];
  });

  return {
    type: "traditional",
    contractVersion: PIVOT_PROJECTION_CONTRACT_VERSION,
    referenceInterval,
    status: projections.length ? "available" : "unavailable",
    targets,
    projections,
  };
}
