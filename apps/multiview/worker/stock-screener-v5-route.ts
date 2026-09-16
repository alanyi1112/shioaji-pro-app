import { effectiveCriteria, screenStocks, type ScreenerRow } from "../../../src/lib/stock-screener-domain.ts";
import { compareTechnicalRows, selectStoredBoll, selectStoredFractal } from "../../../src/lib/stock-screener-technical-patterns.ts";
import { evaluateMaCriteria, selectStoredDivergence, type ScreenerInputV4 } from "../../../src/lib/stock-screener-v4.ts";
import {
  DEFAULT_CRITERIA_V5, SCREENER_CHIP_MAPPING_VERSION, SCREENER_V5_FORMULA_VERSION, combineCriteriaV5,
  criteriaFingerprintV5, effectiveCriteriaV5, evaluateChipCriteria, validateCriteriaV5,
  type CriteriaV5, type ScreenerInputV5,
} from "../../../src/lib/stock-screener-v5.ts";
import type { ScreenerResultRowV5, ScreenerSortV5 } from "../../../src/lib/stock-screener-api.ts";
import type { ScreenerDatabase } from "./stock-screener-repository.ts";
import { baseResult } from "./stock-screener-v3-route.ts";
import { handleStockScreenerV4, parseScreenerV4Query } from "./stock-screener-v4-route.ts";
import { readScreenerFreshness } from "./stock-screener-session-readiness.ts";
import { readScreenerChipHealth } from "./stock-screener-chip-collector.ts";
import { readScreenerV5Snapshot } from "./stock-screener-v5-repository.ts";

const chipKeys = ["largeHolderTrend", "largeHolderConcentration", "retailHolderDecline", "trustOwnership",
  "priceMargin", "shortMarginRatio", "closeHigh", "closeSmaBreakout"] as const;
const v5Params = [
  "largeHolderTrendEnabled", "largeHolderTrendMinimumRatioPct", "largeHolderTrendMaximumRatioPct", "largeHolderTrendWeeks", "largeHolderTrendMinimumIncreasePp",
  "largeHolderConcentrationEnabled", "largeHolderConcentrationWeeks", "retailHolderDeclineEnabled", "retailHolderDeclineWeeks",
  "trustOwnershipEnabled", "trustOwnershipDays", "trustOwnershipMinimumPct", "priceMarginEnabled", "priceMarginDays",
  "shortMarginRatioEnabled", "shortMarginRatioMinimumPct", "closeHighEnabled", "closeHighDays",
  "closeSmaBreakoutEnabled", "closeSmaBreakoutPeriod",
] as const;
const v4Params = ["version", "mode", "volume", "volumeThreshold", "volumeTurnover", "volumeTurnoverMinimumWan",
  "holder", "holderThreshold", "holderMode", "holderStreakWeeks", "holderTurnover", "holderTurnoverMinimumWan",
  "fractal", "fractalAlgorithm", "fractalDirection", "bollReversal", "bollMode", "ma", "maMode", "compressionDays",
  "maxSpreadPct", "divergence", "divergenceSource", "divergenceDirection", "requireZeroReset", "sort", "direction",
  "resultState", "limit", "cursor"] as const;
const allowed = new Set<string>([...v4Params, ...v5Params]);
const sorts: ScreenerSortV5[] = ["code", "volumeMultiple", "turnover", "holderChange", "holderStreak", "confirmationDate",
  "algorithm", "direction", "outsideDistance", "maSpread", "pivotDate", "priceDifference", "largeHolderRatio",
  "trustOwnershipPct", "shortMarginRatio", "closeHighDays", "smaPeriod"];

const bool = (params: URLSearchParams, key: string, fallback = false) => {
  const value = params.get(key);
  if (value === null) return fallback;
  if (!["true", "false"].includes(value)) throw new Error("invalid_query");
  return value === "true";
};

export function parseScreenerV5Query(params: URLSearchParams) {
  if (params.get("version") !== "5" || params.toString().length > 8192
    || [...params.keys()].some((key) => !allowed.has(key) || params.getAll(key).length !== 1)) throw new Error("invalid_query");
  const projected = new URLSearchParams(params);
  projected.set("version", "4");
  for (const key of v5Params) projected.delete(key);
  projected.delete("cursor");
  const requestedSort = params.get("sort") ?? "code";
  if (!["code", "volumeMultiple", "turnover", "holderChange", "holderStreak", "confirmationDate", "algorithm", "direction",
    "outsideDistance", "maSpread", "pivotDate", "priceDifference"].includes(requestedSort)) projected.set("sort", "code");
  const legacyRequested = ["volume", "holder", "fractal", "bollReversal", "ma", "divergence"]
    .some((key) => params.get(key) === "true" || key === "volume" && !params.has(key));
  if (!legacyRequested) projected.set("volume", "true");
  const v4 = parseScreenerV4Query(projected);
  const legacyCriteria = !legacyRequested ? { ...v4.criteria, volume: { ...v4.criteria.volume, enabled: false } } : v4.criteria;
  const criteria: CriteriaV5 = effectiveCriteriaV5({ ...legacyCriteria,
    largeHolderTrend: { enabled: bool(params, "largeHolderTrendEnabled"),
      minimumRatioPct: params.get("largeHolderTrendMinimumRatioPct") ?? DEFAULT_CRITERIA_V5.largeHolderTrend.minimumRatioPct,
      maximumRatioPct: params.get("largeHolderTrendMaximumRatioPct") ?? DEFAULT_CRITERIA_V5.largeHolderTrend.maximumRatioPct,
      weeks: Number(params.get("largeHolderTrendWeeks") ?? DEFAULT_CRITERIA_V5.largeHolderTrend.weeks),
      minimumIncreasePp: params.get("largeHolderTrendMinimumIncreasePp") ?? DEFAULT_CRITERIA_V5.largeHolderTrend.minimumIncreasePp },
    largeHolderConcentration: { enabled: bool(params, "largeHolderConcentrationEnabled"),
      weeks: Number(params.get("largeHolderConcentrationWeeks") ?? DEFAULT_CRITERIA_V5.largeHolderConcentration.weeks) },
    retailHolderDecline: { enabled: bool(params, "retailHolderDeclineEnabled"),
      weeks: Number(params.get("retailHolderDeclineWeeks") ?? DEFAULT_CRITERIA_V5.retailHolderDecline.weeks) },
    trustOwnership: { enabled: bool(params, "trustOwnershipEnabled"),
      days: Number(params.get("trustOwnershipDays") ?? DEFAULT_CRITERIA_V5.trustOwnership.days),
      minimumPct: params.get("trustOwnershipMinimumPct") ?? DEFAULT_CRITERIA_V5.trustOwnership.minimumPct },
    priceMargin: { enabled: bool(params, "priceMarginEnabled"),
      days: Number(params.get("priceMarginDays") ?? DEFAULT_CRITERIA_V5.priceMargin.days) },
    shortMarginRatio: { enabled: bool(params, "shortMarginRatioEnabled"),
      minimumPct: params.get("shortMarginRatioMinimumPct") ?? DEFAULT_CRITERIA_V5.shortMarginRatio.minimumPct },
    closeHigh: { enabled: bool(params, "closeHighEnabled"), days: Number(params.get("closeHighDays") ?? DEFAULT_CRITERIA_V5.closeHigh.days) },
    closeSmaBreakout: { enabled: bool(params, "closeSmaBreakoutEnabled"),
      period: Number(params.get("closeSmaBreakoutPeriod") ?? DEFAULT_CRITERIA_V5.closeSmaBreakout.period) as 5 | 10 | 20 | 60 },
  });
  const sort = requestedSort as ScreenerSortV5;
  if (!validateCriteriaV5(criteria) || !sorts.includes(sort)) throw new Error("invalid_query");
  const criteriaKey = criteriaFingerprintV5(criteria);
  const limit = v4.limit, fingerprint = `${criteriaKey}|${sort}|${v4.direction}|${v4.resultState}|${limit}`;
  let cursor: { version: 5; snapshotId: string; offset: number; fingerprint: string } | null = null;
  if (params.has("cursor")) {
    try { cursor = JSON.parse(atob(params.get("cursor")!)); } catch { throw new Error("invalid_cursor"); }
    if (!cursor || cursor.version !== 5 || !/^[\w-]{36}$/.test(cursor.snapshotId) || !Number.isInteger(cursor.offset)
      || cursor.offset < 0 || cursor.offset > 10000 || cursor.fingerprint !== fingerprint
      || Object.keys(cursor).sort().join() !== "fingerprint,offset,snapshotId,version") throw new Error("invalid_cursor");
  }
  return { ...v4, version: 5 as const, criteria, sort, cursor, criteriaKey, fingerprint };
}

const json = (payload: unknown, status = 200) => Response.json(payload, { status, headers: { "cache-control": "no-store" } });
const missingKeys = ["volume-multiple", "large-holder-weekly-pp", "fractal", "boll-reversal", "ma", "divergence", ...chipKeys];
const emptyCounts = () => ({ total: 0, evaluated: 0, matched: 0, notMatched: 0, unknown: 0,
  missingByCondition: Object.fromEntries(missingKeys.map((key) => [key, 0])) });
const pending = (reason: string, health: unknown = null) => ({ version: 5, state: "pending", reason, snapshotId: null,
  universeRevision: null, formulaVersion: SCREENER_V5_FORMULA_VERSION, sourceMappingVersion: SCREENER_CHIP_MAPPING_VERSION,
  criteriaFingerprint: null, expectedSessionDate: null, effectiveSessionDate: null, createdAt: null,
  anchors: { daily: null, weekly: null, weeklyPeriods: [] }, technicalAnchors: null, counts: null, byMarket: null,
  preparation: null, chipCoverage: null, chipHealth: health, rows: [], nextCursor: null });

function projectV4(url: URL) {
  const projected = new URL(url); projected.searchParams.set("version", "4");
  for (const key of v5Params) projected.searchParams.delete(key);
  if (!["code", "volumeMultiple", "turnover", "holderChange", "holderStreak", "confirmationDate", "algorithm", "direction",
    "outsideDistance", "maSpread", "pivotDate", "priceDifference"].includes(projected.searchParams.get("sort") ?? "")) projected.searchParams.set("sort", "code");
  projected.searchParams.delete("cursor");
  return projected;
}

const chipEnabled = (criteria: CriteriaV5) => chipKeys.some((key) => criteria[key].enabled);

export async function handleStockScreenerV5(url: URL, env: { DB?: ScreenerDatabase }, now = new Date()) {
  let query: ReturnType<typeof parseScreenerV5Query>;
  try { query = parseScreenerV5Query(url.searchParams); } catch (error) { return json({ reason: (error as Error).message }, 400); }
  if (!chipEnabled(query.criteria) && !url.pathname.endsWith("/status")) return handleStockScreenerV4(projectV4(url), env, now);
  if (!env.DB) return json({ ...pending("d1_unavailable"), state: "unavailable" }, 503);
  try {
    const snapshot = await readScreenerV5Snapshot(env.DB, query.cursor?.snapshotId);
    if (!snapshot) {
      if (query.cursor) return json({ reason: "snapshot_expired" }, 409);
      return json(pending("v5_preparation_pending", await readScreenerChipHealth(env.DB)));
    }
    const freshness = await readScreenerFreshness(env.DB, snapshot.metadata.effectiveSessionDate);
    const legacyCriteria = query.criteria.volume.enabled || query.criteria.holder.enabled ? query.criteria
      : { ...query.criteria, volume: { ...query.criteria.volume, enabled: true } };
    const evaluated = screenStocks(snapshot.inputs, snapshot.metadata.anchors, effectiveCriteria(legacyCriteria));
    const counts = emptyCounts(), byMarket = { TWSE: emptyCounts(), TPEx: emptyCounts() };
    const rows = evaluated.rows.map((base, index) => {
      const input = snapshot.inputs[index] as ScreenerInputV5;
      const fractal = query.criteria.fractal.enabled ? selectStoredFractal(input.technical, query.criteria.fractal) : null;
      const bollReversal = query.criteria.bollReversal.enabled ? selectStoredBoll(input.technical, query.criteria.bollReversal) : null;
      const ma = query.criteria.ma.enabled ? evaluateMaCriteria((input as ScreenerInputV4).technicalV4.ma, query.criteria.ma) : null;
      const divergence = query.criteria.divergence.enabled ? selectStoredDivergence((input as ScreenerInputV4).technicalV4.divergence, query.criteria.divergence) : null;
      const chip = evaluateChipCriteria(input.chipV5, query.criteria);
      const verdict = combineCriteriaV5(query.criteria, { volume: base.volume?.verdict, holder: base.holder?.verdict,
        fractal: fractal?.verdict, bollReversal: bollReversal?.verdict, ma: ma?.verdict, divergence: divergence?.verdict }, chip);
      for (const summary of [counts, byMarket[input.market]]) {
        summary.total++;
        if (verdict === "unknown") summary.unknown++;
        else {
          summary.evaluated++;
          if (verdict === "pass") summary.matched++;
          else summary.notMatched++;
        }
        const legacyUnknown: Record<string, boolean> = { "volume-multiple": query.criteria.volume.enabled && base.volume?.verdict === "unknown",
          "large-holder-weekly-pp": query.criteria.holder.enabled && base.holder?.verdict === "unknown",
          fractal: query.criteria.fractal.enabled && fractal?.verdict === "unknown", "boll-reversal": query.criteria.bollReversal.enabled && bollReversal?.verdict === "unknown",
          ma: query.criteria.ma.enabled && ma?.verdict === "unknown", divergence: query.criteria.divergence.enabled && divergence?.verdict === "unknown" };
        for (const [key, value] of Object.entries(legacyUnknown)) if (value) summary.missingByCondition[key]++;
        for (const key of chipKeys) if (query.criteria[key].enabled && chip[key].verdict === "unknown") summary.missingByCondition[key]++;
      }
      return { ...baseResult({ ...base, verdict } as ScreenerRow, query.criteria), verdict, technical: { fractal, bollReversal },
        technicalV4: { ma, divergence, evidenceHash: input.technicalV4.evidenceHash },
        chipV5: { outcomes: chip, evidenceHash: input.chipV5.evidenceHash, dailyThrough: input.chipV5.dailyThrough,
          weeklyThrough: input.chipV5.weeklyThrough } } as ScreenerResultRowV5;
    }).filter((row) => row.verdict === query.resultState);
    const metric = (row: ScreenerResultRowV5): number | string | null => {
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
      const left = metric(a), right = metric(b), leftMissing = left === null || typeof left === "number" && !Number.isFinite(left), rightMissing = right === null || typeof right === "number" && !Number.isFinite(right);
      if (leftMissing || rightMissing) return leftMissing === rightMissing ? a.code.localeCompare(b.code) : leftMissing ? 1 : -1;
      const cmp = left! < right! ? -1 : left! > right! ? 1 : 0;
      return (query.direction === "desc" ? -cmp : cmp) || a.code.localeCompare(b.code);
    });
    const offset = query.cursor?.offset ?? 0, next = offset + query.limit;
    if (offset > rows.length) return json({ reason: "invalid_cursor" }, 400);
    const freshnessPending = freshness.pending || !!freshness.expectedSessionDate && snapshot.metadata.effectiveSessionDate < freshness.expectedSessionDate;
    const stale = now.getTime() > Date.parse(snapshot.metadata.validThrough) || freshnessPending;
    const hasMissing = Object.values(counts.missingByCondition).some((count) => count > 0);
    return json({ version: 5, state: freshnessPending ? "pending" : stale ? "stale" : hasMissing ? "partial" : "ready",
      reason: freshnessPending ? freshness.reason : stale ? "snapshot_stale" : "none", snapshotId: snapshot.id,
      universeRevision: snapshot.metadata.universeRevision, formulaVersion: SCREENER_V5_FORMULA_VERSION,
      sourceMappingVersion: SCREENER_CHIP_MAPPING_VERSION, criteriaFingerprint: query.criteriaKey,
      expectedSessionDate: freshness.expectedSessionDate ?? snapshot.metadata.expectedSessionDate,
      effectiveSessionDate: snapshot.metadata.effectiveSessionDate, sessionReadiness: freshness.readiness,
      createdAt: snapshot.createdAt, anchors: snapshot.metadata.anchors, technicalAnchors: snapshot.metadata.technicalAnchors,
      counts, byMarket, preparation: null, chipCoverage: snapshot.metadata.coverage,
      rows: url.pathname.endsWith("/status") || stale ? [] : rows.slice(offset, next),
      nextCursor: !url.pathname.endsWith("/status") && !stale && next < rows.length
        ? btoa(JSON.stringify({ version: 5, snapshotId: snapshot.id, offset: next, fingerprint: query.fingerprint })) : null });
  } catch (error) {
    if (/no such (?:table|column).*screener_/.test(String(error))) return json(pending("schema_pending"));
    return json({ ...pending("snapshot_unavailable"), state: "unavailable" }, 503);
  }
}
