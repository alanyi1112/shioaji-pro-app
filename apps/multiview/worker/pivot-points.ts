import type { Candle } from "./indicators";

export type PivotMode = "traditional";
export type PivotReferenceInterval = "1d" | "1wk" | "1mo";
export type TraditionalPivotLevels = {
  p: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
};
export type PivotReferenceStatus = "completed" | "provisional";
export type PivotApplication = "next-trading-day" | "next-trading-week" | "next-trading-month";
export type PivotTarget = { time: number; referencePeriodKey: string };
export type TraditionalPivotProjection = TraditionalPivotLevels & {
  referenceTime: number;
  referencePeriodKey: string;
  referenceStatus: PivotReferenceStatus;
  appliesTo: PivotApplication;
  applicablePeriodKey?: string;
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

export function normalizePivotMode(value: unknown): PivotMode | null {
  return String(value ?? "").trim().toLowerCase() === "traditional" ? "traditional" : null;
}

export function pivotReferenceInterval(interval: unknown): PivotReferenceInterval | null {
  const normalized = String(interval ?? "").trim().toLowerCase();
  if (["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"].includes(normalized)) return "1d";
  if (normalized === "1wk") return "1wk";
  if (normalized === "1mo") return "1mo";
  return null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function computeTraditionalPivot(input: Partial<Pick<Candle, "high" | "low" | "close">>): TraditionalPivotLevels | null {
  const { high, low, close } = input;
  if (!finiteNumber(high) || !finiteNumber(low) || !finiteNumber(close) || high < low) return null;
  const p = (high + low + close) / 3;
  const range = high - low;
  const r1 = 2 * p - low;
  const s1 = 2 * p - high;
  return {
    p,
    r1,
    r2: p + range,
    r3: r1 + range,
    s1,
    s2: p - range,
    s3: s1 - range,
  };
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
    : referenceInterval === "1mo" ? "next-trading-month" : "next-trading-day";
  const projections = orderedReferences.flatMap(([period, reference], index) => {
    if (!targetPeriods.has(period)) return [];
    const levels = computeTraditionalPivot(reference);
    if (!levels) return [];
    const nextPeriod = orderedReferences[index + 1]?.[0];
    return [{
      ...levels,
      referenceTime: reference.time,
      referencePeriodKey: period,
      referenceStatus: period === options.provisionalReferencePeriodKey ? "provisional" as const : "completed" as const,
      appliesTo,
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
