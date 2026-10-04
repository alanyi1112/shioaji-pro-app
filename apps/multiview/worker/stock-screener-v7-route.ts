import { effectiveCriteria, screenStocks, type ScreenerRow } from "../../../src/lib/stock-screener-domain.ts";
import { compareTechnicalRows, selectStoredBoll, selectStoredFractal } from "../../../src/lib/stock-screener-technical-patterns.ts";
import { evaluateMaCriteria, selectStoredDivergence, type ScreenerInputV4 } from "../../../src/lib/stock-screener-v4.ts";
import { evaluateChipCriteria } from "../../../src/lib/stock-screener-v5.ts";
import { evaluateInstitutionalCriteriaV6 } from "../../../src/lib/stock-screener-v6.ts";
import {
  DEFAULT_CRITERIA_V7, SCREENER_V7_FORMULA_VERSION, combineCriteriaV7, criteriaFingerprintV7,
  effectiveCriteriaV7, evaluateTechnicalCriteriaV7, validateCriteriaV7,
  type CriteriaV7, type ScreenerInputV7, type ScreenerSortV7,
} from "../../../src/lib/stock-screener-v7.ts";
import { SCREENER_OHLCV_V4_MAPPING_VERSION } from "../../../src/lib/stock-screener-ohlcv.ts";
import type { ScreenerDatabase } from "./stock-screener-repository.ts";
import { baseResult } from "./stock-screener-v3-route.ts";
import { handleStockScreenerV6, parseScreenerV6Query } from "./stock-screener-v6-route.ts";
import { readScreenerFreshness } from "./stock-screener-session-readiness.ts";
import { readScreenerV7Snapshot } from "./stock-screener-v7-repository.ts";

const technicalKeys = ["bollPosition", "rsiCross", "kdCross", "macdSignal"] as const;
const chipKeys = ["largeHolderTrend", "largeHolderConcentration", "retailHolderDecline", "trustOwnership",
  "priceMargin", "shortMarginRatio", "closeHigh", "closeSmaBreakout"] as const;
const institutionalKeys = ["foreignReversal", "trustReversal"] as const;
const volumeFields = ["Enabled", "BaselineDays", "Ratio", "MinimumAverageVolumeEnabled", "MinimumAverageVolumeLots"] as const;
const v7Params = [
  "bollPositionEnabled", "bollPositionMode", "bollPositionTolerancePercent", "bollPositionMiddleTrend",
  "rsiCrossEnabled", "rsiCrossMode", "rsiCrossHighThreshold", "rsiCrossLowThreshold",
  "kdCrossEnabled", "kdCrossMode", "kdCrossHighThreshold", "kdCrossLowThreshold",
  "macdSignalEnabled", "macdSignalMode", "macdSignalApproachThresholdPct",
  ...technicalKeys.flatMap((key) => volumeFields.map((field) => `${key}Volume${field}`)),
] as const;
const commonV6Params = ["version", "mode", "volume", "volumeThreshold", "volumeTurnover", "volumeTurnoverMinimumWan",
  "holder", "holderThreshold", "holderMode", "holderStreakWeeks", "holderTurnover", "holderTurnoverMinimumWan",
  "fractal", "fractalAlgorithm", "fractalDirection", "bollReversal", "bollMode", "ma", "maMode", "compressionDays",
  "maxSpreadPct", "divergence", "divergenceSource", "divergenceDirection", "requireZeroReset",
  "largeHolderTrendEnabled", "largeHolderTrendMinimumRatioPct", "largeHolderTrendMaximumRatioPct", "largeHolderTrendWeeks", "largeHolderTrendMinimumIncreasePp",
  "largeHolderConcentrationEnabled", "largeHolderConcentrationWeeks", "retailHolderDeclineEnabled", "retailHolderDeclineWeeks",
  "trustOwnershipEnabled", "trustOwnershipDays", "trustOwnershipMinimumPct", "priceMarginEnabled", "priceMarginDays",
  "shortMarginRatioEnabled", "shortMarginRatioMinimumPct", "closeHighEnabled", "closeHighDays", "closeSmaBreakoutEnabled", "closeSmaBreakoutPeriod",
  "foreignReversalEnabled", "foreignReversalSellStreakDays", "foreignReversalTodayNetBuyMinimumLots", "foreignReversalMinimumTurnoverPct",
  "foreignReversalComparisonDays", "foreignReversalTurnoverMultiple", "foreignReversalMaPeriod", "foreignReversalLiquidityDays",
  "foreignReversalMinimumAverageVolumeLots", "trustReversalEnabled", "trustReversalSellStreakDays", "trustReversalTodayNetBuyMinimumLots",
  "trustReversalMinimumTurnoverPct", "trustReversalComparisonDays", "trustReversalTurnoverMultiple", "trustReversalMaPeriod",
  "trustReversalLiquidityDays", "trustReversalMinimumAverageVolumeLots", "trustReversalMinimumRecoveryPct",
  "trustReversalMinimumParticipationPct", "trustReversalMaximumParticipationPct", "sort", "direction", "resultState", "limit", "cursor",
] as const;
const allowed = new Set<string>([...commonV6Params, ...v7Params]);
const sorts: readonly ScreenerSortV7[] = ["code", "volumeMultiple", "turnover", "holderChange", "holderStreak", "confirmationDate",
  "algorithm", "direction", "outsideDistance", "maSpread", "pivotDate", "priceDifference", "largeHolderRatio",
  "trustOwnershipPct", "shortMarginRatio", "closeHighDays", "smaPeriod", "foreignTodayNetBuy", "trustTodayNetBuy",
  "trustRecoveryPct", "trustParticipationPct", "bollDistance", "rsiFast", "kdFast", "macdDif", "volumeRatio"];
const v6Sorts = new Set(sorts.slice(0, 21));
const bool = (params: URLSearchParams, key: string, fallback = false) => {
  const value = params.get(key);
  if (value === null) return fallback;
  if (!["true", "false"].includes(value)) throw new Error("invalid_query");
  return value === "true";
};
const number = (params: URLSearchParams, key: string, fallback: number) => Number(params.get(key) ?? fallback);
const text = (params: URLSearchParams, key: string, fallback: string) => params.get(key) ?? fallback;

function projectedV6Params(params: URLSearchParams) {
  const projected = new URLSearchParams(params);
  projected.set("version", "6");
  for (const key of v7Params) projected.delete(key);
  projected.delete("cursor");
  if (!v6Sorts.has((projected.get("sort") ?? "code") as ScreenerSortV7)) projected.set("sort", "code");
  // v6 validation requires one v1-v6 branch. It is removed again after parsing when this was only a parser sentinel.
  const sentinel = !["volume", "holder", "fractal", "bollReversal", "ma", "divergence", "largeHolderTrendEnabled",
    "largeHolderConcentrationEnabled", "retailHolderDeclineEnabled", "trustOwnershipEnabled", "priceMarginEnabled",
    "shortMarginRatioEnabled", "closeHighEnabled", "closeSmaBreakoutEnabled", "foreignReversalEnabled", "trustReversalEnabled"]
    .some((key) => projected.get(key) === "true" || key === "volume" && !projected.has(key));
  if (sentinel) projected.set("foreignReversalEnabled", "true");
  return { projected, sentinel };
}

export function parseScreenerV7Query(params: URLSearchParams) {
  if (params.get("version") !== "7" || params.toString().length > 16384
    || [...params.keys()].some((key) => !allowed.has(key) || params.getAll(key).length !== 1)) throw new Error("invalid_query");
  const { projected, sentinel } = projectedV6Params(params);
  const v6 = parseScreenerV6Query(projected);
  const volume = (prefix: typeof technicalKeys[number]) => ({
    enabled: bool(params, `${prefix}VolumeEnabled`, DEFAULT_CRITERIA_V7[prefix].volumeConfirmation.enabled),
    baselineDays: number(params, `${prefix}VolumeBaselineDays`, DEFAULT_CRITERIA_V7[prefix].volumeConfirmation.baselineDays),
    ratio: text(params, `${prefix}VolumeRatio`, DEFAULT_CRITERIA_V7[prefix].volumeConfirmation.ratio),
    minimumAverageVolumeEnabled: bool(params, `${prefix}VolumeMinimumAverageVolumeEnabled`, DEFAULT_CRITERIA_V7[prefix].volumeConfirmation.minimumAverageVolumeEnabled),
    minimumAverageVolumeLots: text(params, `${prefix}VolumeMinimumAverageVolumeLots`, DEFAULT_CRITERIA_V7[prefix].volumeConfirmation.minimumAverageVolumeLots),
  });
  const criteria: CriteriaV7 = effectiveCriteriaV7({ ...v6.criteria,
    ...(sentinel ? { foreignReversal: { ...v6.criteria.foreignReversal, enabled: false } } : {}),
    bollPosition: { enabled: bool(params, "bollPositionEnabled"),
      mode: text(params, "bollPositionMode", DEFAULT_CRITERIA_V7.bollPosition.mode) as CriteriaV7["bollPosition"]["mode"],
      tolerancePercent: text(params, "bollPositionTolerancePercent", DEFAULT_CRITERIA_V7.bollPosition.tolerancePercent),
      middleTrend: text(params, "bollPositionMiddleTrend", DEFAULT_CRITERIA_V7.bollPosition.middleTrend) as CriteriaV7["bollPosition"]["middleTrend"],
      volumeConfirmation: volume("bollPosition") },
    rsiCross: { enabled: bool(params, "rsiCrossEnabled"),
      mode: text(params, "rsiCrossMode", DEFAULT_CRITERIA_V7.rsiCross.mode) as CriteriaV7["rsiCross"]["mode"],
      highThreshold: text(params, "rsiCrossHighThreshold", DEFAULT_CRITERIA_V7.rsiCross.highThreshold),
      lowThreshold: text(params, "rsiCrossLowThreshold", DEFAULT_CRITERIA_V7.rsiCross.lowThreshold), volumeConfirmation: volume("rsiCross") },
    kdCross: { enabled: bool(params, "kdCrossEnabled"),
      mode: text(params, "kdCrossMode", DEFAULT_CRITERIA_V7.kdCross.mode) as CriteriaV7["kdCross"]["mode"],
      highThreshold: text(params, "kdCrossHighThreshold", DEFAULT_CRITERIA_V7.kdCross.highThreshold),
      lowThreshold: text(params, "kdCrossLowThreshold", DEFAULT_CRITERIA_V7.kdCross.lowThreshold), volumeConfirmation: volume("kdCross") },
    macdSignal: { enabled: bool(params, "macdSignalEnabled"),
      mode: text(params, "macdSignalMode", DEFAULT_CRITERIA_V7.macdSignal.mode) as CriteriaV7["macdSignal"]["mode"],
      approachThresholdPct: text(params, "macdSignalApproachThresholdPct", DEFAULT_CRITERIA_V7.macdSignal.approachThresholdPct),
      volumeConfirmation: volume("macdSignal") },
  });
  const requestedSort = (params.get("sort") ?? "code") as ScreenerSortV7;
  if (!validateCriteriaV7(criteria) || !sorts.includes(requestedSort)) throw new Error("invalid_query");
  const criteriaKey = criteriaFingerprintV7(criteria);
  const fingerprint = `${criteriaKey}|${requestedSort}|${v6.direction}|${v6.resultState}|${v6.limit}`;
  let cursor: { version: 7; snapshotId: string; offset: number; fingerprint: string } | null = null;
  if (params.has("cursor")) {
    try { cursor = JSON.parse(atob(params.get("cursor")!)); } catch { throw new Error("invalid_cursor"); }
    if (!cursor || cursor.version !== 7 || !/^[\w-]{36}$/.test(cursor.snapshotId) || !Number.isInteger(cursor.offset)
      || cursor.offset < 0 || cursor.offset > 10000 || cursor.fingerprint !== fingerprint
      || Object.keys(cursor).sort().join() !== "fingerprint,offset,snapshotId,version") throw new Error("invalid_cursor");
  }
  return { ...v6, version: 7 as const, criteria, sort: requestedSort, cursor, criteriaKey, fingerprint };
}

const json = (payload: unknown, status = 200) => Response.json(payload, { status, headers: { "cache-control": "no-store" } });
const missingKeys = ["volume-multiple", "large-holder-weekly-pp", "fractal", "boll-reversal", "ma", "divergence",
  ...chipKeys, ...institutionalKeys, ...technicalKeys];
const emptyCounts = () => ({ total: 0, evaluated: 0, matched: 0, notMatched: 0, unknown: 0,
  missingByCondition: Object.fromEntries(missingKeys.map((key) => [key, 0])) });
const pending = (reason: string) => ({ version: 7, state: "pending", reason, snapshotId: null,
  universeRevision: null, formulaVersion: SCREENER_V7_FORMULA_VERSION, sourceMappingVersion: SCREENER_OHLCV_V4_MAPPING_VERSION,
  criteriaFingerprint: null, expectedSessionDate: null, effectiveSessionDate: null, createdAt: null,
  anchors: { daily: null, weekly: null, weeklyPeriods: [] }, technicalAnchors: null, counts: null, byMarket: null,
  preparation: null, chipCoverage: null, institutionalCoverage: null, technicalCoverage: null, rows: [], nextCursor: null });

function projectV6(url: URL) {
  const projected = new URL(url); projected.searchParams.set("version", "6");
  for (const key of v7Params) projected.searchParams.delete(key);
  if (!v6Sorts.has((projected.searchParams.get("sort") ?? "code") as ScreenerSortV7)) projected.searchParams.set("sort", "code");
  projected.searchParams.delete("cursor");
  return projected;
}

export async function handleStockScreenerV7(url: URL, env: { DB?: ScreenerDatabase }, now = new Date()) {
  let query: ReturnType<typeof parseScreenerV7Query>;
  try { query = parseScreenerV7Query(url.searchParams); } catch (error) { return json({ reason: (error as Error).message }, 400); }
  const newEnabled = technicalKeys.some((key) => query.criteria[key].enabled);
  if (!newEnabled && !url.pathname.endsWith("/status")) return handleStockScreenerV6(projectV6(url), env, now);
  if (!env.DB) return json({ ...pending("d1_unavailable"), state: "unavailable" }, 503);
  try {
    const snapshot = await readScreenerV7Snapshot(env.DB, query.cursor?.snapshotId);
    if (!snapshot) {
      if (query.cursor) return json({ reason: "snapshot_expired" }, 409);
      return json(pending("v7_preparation_pending"));
    }
    const freshness = await readScreenerFreshness(env.DB, snapshot.metadata.effectiveSessionDate);
    const legacy = query.criteria.volume.enabled || query.criteria.holder.enabled ? query.criteria
      : { ...query.criteria, volume: { ...query.criteria.volume, enabled: true } };
    const evaluated = screenStocks(snapshot.inputs, snapshot.metadata.anchors, effectiveCriteria(legacy));
    const counts = emptyCounts(), byMarket = { TWSE: emptyCounts(), TPEx: emptyCounts() };
    const rows = evaluated.rows.map((base, index) => {
      const input = snapshot.inputs[index] as ScreenerInputV7;
      const fractal = query.criteria.fractal.enabled ? selectStoredFractal(input.technical, query.criteria.fractal) : null;
      const bollReversal = query.criteria.bollReversal.enabled ? selectStoredBoll(input.technical, query.criteria.bollReversal) : null;
      const ma = query.criteria.ma.enabled ? evaluateMaCriteria((input as ScreenerInputV4).technicalV4.ma, query.criteria.ma) : null;
      const divergence = query.criteria.divergence.enabled ? selectStoredDivergence((input as ScreenerInputV4).technicalV4.divergence, query.criteria.divergence) : null;
      const chip = evaluateChipCriteria(input.chipV5, query.criteria);
      const institutional = evaluateInstitutionalCriteriaV6(input.institutionalV6, query.criteria);
      const technicalV7 = evaluateTechnicalCriteriaV7(input.technicalV7, query.criteria);
      const verdict = combineCriteriaV7(query.criteria, { volume: base.volume?.verdict, holder: base.holder?.verdict,
        fractal: fractal?.verdict, bollReversal: bollReversal?.verdict, ma: ma?.verdict, divergence: divergence?.verdict },
      chip, institutional, technicalV7);
      for (const summary of [counts, byMarket[input.market]]) {
        summary.total++;
        if (verdict === "unknown") summary.unknown++;
        else {
          summary.evaluated++;
          if (verdict === "pass") summary.matched++;
          else summary.notMatched++;
        }
        const known: Record<string, boolean> = { "volume-multiple": query.criteria.volume.enabled && base.volume?.verdict === "unknown",
          "large-holder-weekly-pp": query.criteria.holder.enabled && base.holder?.verdict === "unknown",
          fractal: query.criteria.fractal.enabled && fractal?.verdict === "unknown", "boll-reversal": query.criteria.bollReversal.enabled && bollReversal?.verdict === "unknown",
          ma: query.criteria.ma.enabled && ma?.verdict === "unknown", divergence: query.criteria.divergence.enabled && divergence?.verdict === "unknown" };
        for (const [key, value] of Object.entries(known)) if (value) summary.missingByCondition[key]++;
        for (const key of chipKeys) if (query.criteria[key].enabled && chip[key].verdict === "unknown") summary.missingByCondition[key]++;
        for (const key of institutionalKeys) if (query.criteria[key].enabled && institutional[key].verdict === "unknown") summary.missingByCondition[key]++;
        for (const key of technicalKeys) if (query.criteria[key].enabled && technicalV7[key].verdict === "unknown") summary.missingByCondition[key]++;
      }
      return { ...baseResult({ ...base, verdict } as ScreenerRow, query.criteria), verdict, technical: { fractal, bollReversal },
        technicalV4: { ma, divergence, evidenceHash: input.technicalV4.evidenceHash },
        chipV5: { outcomes: chip, evidenceHash: input.chipV5.evidenceHash, dailyThrough: input.chipV5.dailyThrough,
          weeklyThrough: input.chipV5.weeklyThrough },
        institutionalV6: { outcomes: institutional, evidenceHash: input.institutionalV6.evidenceHash,
          dailyThrough: input.institutionalV6.dailyThrough },
        technicalV7: { outcomes: technicalV7, evidenceHash: input.technicalV7.evidenceHash, through: input.technicalV7.through } };
    }).filter((row) => row.verdict === query.resultState);
    const metric = (row: typeof rows[number]): number | string | null => {
      const selectedVolume = technicalKeys.find((key) => query.criteria[key].enabled && query.criteria[key].volumeConfirmation.enabled);
      if (query.sort === "volumeRatio") return selectedVolume ? row.technicalV7.outcomes[selectedVolume].volumeConfirmation.ratio : null;
      if (query.sort === "bollDistance") {
        const actual = row.technicalV7.outcomes.bollPosition.signal.actual as { close?: number; current?: { middle: number } } | undefined;
        return actual?.close !== undefined && actual.current ? Math.abs(actual.close - actual.current.middle) : null;
      }
      if (query.sort === "rsiFast") return (row.technicalV7.outcomes.rsiCross.signal.actual as { current?: { fast: number } } | undefined)?.current?.fast ?? null;
      if (query.sort === "kdFast") return (row.technicalV7.outcomes.kdCross.signal.actual as { current?: { fast: number } } | undefined)?.current?.fast ?? null;
      if (query.sort === "macdDif") return (row.technicalV7.outcomes.macdSignal.signal.actual as { current?: { dif: number } } | undefined)?.current?.dif ?? null;
      if (query.sort === "foreignTodayNetBuy") return Number(row.institutionalV6.outcomes.foreignReversal.evidence.today.netShares ?? NaN);
      if (query.sort === "trustTodayNetBuy") return Number(row.institutionalV6.outcomes.trustReversal.evidence.today.netShares ?? NaN);
      if (query.sort === "trustRecoveryPct") return row.institutionalV6.outcomes.trustReversal.evidence.metrics.recoveryPct;
      if (query.sort === "trustParticipationPct") return row.institutionalV6.outcomes.trustReversal.evidence.metrics.participationPct;
      if (query.sort === "largeHolderRatio") return Number((row.chipV5.outcomes.largeHolderTrend.evidence as { weeks?: { ratioPct: string }[] })?.weeks?.at(-1)?.ratioPct ?? NaN);
      if (query.sort === "trustOwnershipPct") return Number((row.chipV5.outcomes.trustOwnership.evidence as { ratioPct?: number })?.ratioPct ?? NaN);
      if (query.sort === "shortMarginRatio") return Number((row.chipV5.outcomes.shortMarginRatio.evidence as { ratioPct?: number })?.ratioPct ?? NaN);
      if (query.sort === "closeHighDays") return query.criteria.closeHigh.days;
      if (query.sort === "smaPeriod") return query.criteria.closeSmaBreakout.period;
      if (query.sort === "maSpread") return row.technicalV4.ma?.evidence?.current.spreadPct ?? null;
      if (query.sort === "pivotDate") return row.technicalV4.divergence?.evidence?.second.confirmationDate ?? null;
      if (query.sort === "priceDifference") return row.technicalV4.divergence?.evidence?.priceDifferencePct ?? null;
      if (query.sort === "volumeMultiple") return row.volume.multiple;
      if (query.sort === "holderChange") return row.holder.changePp;
      if (query.sort === "holderStreak") return row.holder.streakWeeks;
      if (query.sort === "turnover") return row.volume.turnover.ntd;
      return null;
    };
    rows.sort((a, b) => {
      if (["confirmationDate", "algorithm", "direction", "outsideDistance"].includes(query.sort)) return compareTechnicalRows(query.sort as never, query.direction,
        { code: a.code, verdict: a.verdict, fractal: a.technical.fractal?.evidence, boll: a.technical.bollReversal?.evidence },
        { code: b.code, verdict: b.verdict, fractal: b.technical.fractal?.evidence, boll: b.technical.bollReversal?.evidence });
      if (query.sort === "code") return a.code.localeCompare(b.code) * (query.direction === "desc" ? -1 : 1);
      const left = metric(a), right = metric(b), lm = left === null || typeof left === "number" && !Number.isFinite(left),
        rm = right === null || typeof right === "number" && !Number.isFinite(right);
      if (lm || rm) return lm === rm ? a.code.localeCompare(b.code) : lm ? 1 : -1;
      const cmp = left! < right! ? -1 : left! > right! ? 1 : 0;
      return (query.direction === "desc" ? -cmp : cmp) || a.code.localeCompare(b.code);
    });
    const offset = query.cursor?.offset ?? 0, next = offset + query.limit;
    if (offset > rows.length) return json({ reason: "invalid_cursor" }, 400);
    const freshnessPending = freshness.pending || !!freshness.expectedSessionDate && snapshot.metadata.effectiveSessionDate < freshness.expectedSessionDate;
    const stale = now.getTime() > Date.parse(snapshot.metadata.validThrough) || freshnessPending;
    const hasMissing = Object.values(counts.missingByCondition).some((count) => count > 0);
    return json({ version: 7, state: freshnessPending ? "pending" : stale ? "stale" : hasMissing ? "partial" : "ready",
      reason: freshnessPending ? freshness.reason : stale ? "snapshot_stale" : "none", snapshotId: snapshot.id,
      universeRevision: snapshot.metadata.universeRevision, formulaVersion: SCREENER_V7_FORMULA_VERSION,
      sourceMappingVersion: SCREENER_OHLCV_V4_MAPPING_VERSION, criteriaFingerprint: query.criteriaKey,
      expectedSessionDate: freshness.expectedSessionDate ?? snapshot.metadata.expectedSessionDate,
      effectiveSessionDate: snapshot.metadata.effectiveSessionDate, sessionReadiness: freshness.readiness,
      createdAt: snapshot.createdAt, anchors: snapshot.metadata.anchors, technicalAnchors: snapshot.metadata.technicalAnchors,
      counts, byMarket, preparation: null, chipCoverage: snapshot.metadata.coverage,
      institutionalCoverage: snapshot.metadata.institutionalCoverage, technicalCoverage: snapshot.metadata.technicalCoverage,
      rows: url.pathname.endsWith("/status") || stale ? [] : rows.slice(offset, next),
      nextCursor: !url.pathname.endsWith("/status") && !stale && next < rows.length
        ? btoa(JSON.stringify({ version: 7, snapshotId: snapshot.id, offset: next, fingerprint: query.fingerprint })) : null });
  } catch (error) {
    if (/no such (?:table|column).*screener_/.test(String(error))) return json(pending("schema_pending"));
    return json({ ...pending("snapshot_unavailable"), state: "unavailable" }, 503);
  }
}
