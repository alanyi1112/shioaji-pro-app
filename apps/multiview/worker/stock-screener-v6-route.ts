import { effectiveCriteria, screenStocks, type ScreenerRow } from "../../../src/lib/stock-screener-domain.ts";
import { compareTechnicalRows, selectStoredBoll, selectStoredFractal } from "../../../src/lib/stock-screener-technical-patterns.ts";
import { evaluateMaCriteria, selectStoredDivergence, type ScreenerInputV4 } from "../../../src/lib/stock-screener-v4.ts";
import { evaluateChipCriteria } from "../../../src/lib/stock-screener-v5.ts";
import {
  DEFAULT_CRITERIA_V6, SCREENER_INSTITUTIONAL_MAPPING_VERSION, SCREENER_V6_FORMULA_VERSION,
  combineCriteriaV6, criteriaFingerprintV6, effectiveCriteriaV6, evaluateInstitutionalCriteriaV6, validateCriteriaV6,
  type CriteriaV6, type ScreenerInputV6, type ScreenerSortV6,
} from "../../../src/lib/stock-screener-v6.ts";
import type { ScreenerDatabase } from "./stock-screener-repository.ts";
import { baseResult } from "./stock-screener-v3-route.ts";
import { handleStockScreenerV5, parseScreenerV5Query } from "./stock-screener-v5-route.ts";
import { readScreenerFreshness } from "./stock-screener-session-readiness.ts";
import { readScreenerChipHealth } from "./stock-screener-chip-collector.ts";
import { readScreenerV6Snapshot } from "./stock-screener-v6-repository.ts";

const chipKeys = ["largeHolderTrend", "largeHolderConcentration", "retailHolderDecline", "trustOwnership",
  "priceMargin", "shortMarginRatio", "closeHigh", "closeSmaBreakout"] as const;
const institutionalKeys = ["foreignReversal", "trustReversal"] as const;
const commonFields = ["SellStreakDays", "TodayNetBuyMinimumLots", "MinimumTurnoverPct", "ComparisonDays",
  "TurnoverMultiple", "MaPeriod", "LiquidityDays", "MinimumAverageVolumeLots"] as const;
const v6Params = [
  ...commonFields.flatMap((field) => [`foreignReversal${field}`, `trustReversal${field}`]),
  "foreignReversalEnabled", "trustReversalEnabled", "trustReversalMinimumRecoveryPct",
  "trustReversalMinimumParticipationPct", "trustReversalMaximumParticipationPct",
] as const;
const v5Params = ["version", "mode", "volume", "volumeThreshold", "volumeTurnover", "volumeTurnoverMinimumWan",
  "holder", "holderThreshold", "holderMode", "holderStreakWeeks", "holderTurnover", "holderTurnoverMinimumWan",
  "fractal", "fractalAlgorithm", "fractalDirection", "bollReversal", "bollMode", "ma", "maMode", "compressionDays",
  "maxSpreadPct", "divergence", "divergenceSource", "divergenceDirection", "requireZeroReset",
  "largeHolderTrendEnabled", "largeHolderTrendMinimumRatioPct", "largeHolderTrendMaximumRatioPct", "largeHolderTrendWeeks", "largeHolderTrendMinimumIncreasePp",
  "largeHolderConcentrationEnabled", "largeHolderConcentrationWeeks", "retailHolderDeclineEnabled", "retailHolderDeclineWeeks",
  "trustOwnershipEnabled", "trustOwnershipDays", "trustOwnershipMinimumPct", "priceMarginEnabled", "priceMarginDays",
  "shortMarginRatioEnabled", "shortMarginRatioMinimumPct", "closeHighEnabled", "closeHighDays", "closeSmaBreakoutEnabled", "closeSmaBreakoutPeriod",
  "sort", "direction", "resultState", "limit", "cursor"] as const;
const allowed = new Set<string>([...v5Params, ...v6Params]);
const sorts: ScreenerSortV6[] = ["code", "volumeMultiple", "turnover", "holderChange", "holderStreak", "confirmationDate",
  "algorithm", "direction", "outsideDistance", "maSpread", "pivotDate", "priceDifference", "largeHolderRatio",
  "trustOwnershipPct", "shortMarginRatio", "closeHighDays", "smaPeriod", "foreignTodayNetBuy", "trustTodayNetBuy",
  "trustRecoveryPct", "trustParticipationPct"];
const bool = (params: URLSearchParams, key: string) => {
  const value = params.get(key);
  if (value === null) return false;
  if (!['true', 'false'].includes(value)) throw new Error('invalid_query');
  return value === 'true';
};
const number = (params: URLSearchParams, key: string, fallback: number) => Number(params.get(key) ?? fallback);
const text = (params: URLSearchParams, key: string, fallback: string) => params.get(key) ?? fallback;

export function parseScreenerV6Query(params: URLSearchParams) {
  if (params.get("version") !== "6" || params.toString().length > 12288
    || [...params.keys()].some((key) => !allowed.has(key) || params.getAll(key).length !== 1)) throw new Error("invalid_query");
  const projected = new URLSearchParams(params); projected.set("version", "5");
  for (const key of v6Params) projected.delete(key);
  projected.delete("cursor");
  const requestedSort = (params.get("sort") ?? "code") as ScreenerSortV6;
  if (!["code", "volumeMultiple", "turnover", "holderChange", "holderStreak", "confirmationDate", "algorithm", "direction",
    "outsideDistance", "maSpread", "pivotDate", "priceDifference", "largeHolderRatio", "trustOwnershipPct", "shortMarginRatio",
    "closeHighDays", "smaPeriod"].includes(requestedSort)) projected.set("sort", "code");
  const oldConditionRequested = ["volume", "holder", "fractal", "bollReversal", "ma", "divergence",
    "largeHolderTrendEnabled", "largeHolderConcentrationEnabled", "retailHolderDeclineEnabled", "trustOwnershipEnabled",
    "priceMarginEnabled", "shortMarginRatioEnabled", "closeHighEnabled", "closeSmaBreakoutEnabled"]
    .some((key) => params.get(key) === "true" || key === "volume" && !params.has(key));
  if (!oldConditionRequested) projected.set("closeHighEnabled", "true");
  const v5 = parseScreenerV5Query(projected);
  const v5Criteria = !oldConditionRequested ? { ...v5.criteria, closeHigh: { ...v5.criteria.closeHigh, enabled: false } } : v5.criteria;
  const common = (prefix: "foreignReversal" | "trustReversal") => ({
    enabled: bool(params, `${prefix}Enabled`),
    sellStreakDays: number(params, `${prefix}SellStreakDays`, DEFAULT_CRITERIA_V6[prefix].sellStreakDays),
    todayNetBuyMinimumLots: text(params, `${prefix}TodayNetBuyMinimumLots`, DEFAULT_CRITERIA_V6[prefix].todayNetBuyMinimumLots),
    minimumTurnoverPct: text(params, `${prefix}MinimumTurnoverPct`, DEFAULT_CRITERIA_V6[prefix].minimumTurnoverPct),
    comparisonDays: number(params, `${prefix}ComparisonDays`, DEFAULT_CRITERIA_V6[prefix].comparisonDays),
    turnoverMultiple: text(params, `${prefix}TurnoverMultiple`, DEFAULT_CRITERIA_V6[prefix].turnoverMultiple),
    maPeriod: number(params, `${prefix}MaPeriod`, DEFAULT_CRITERIA_V6[prefix].maPeriod),
    liquidityDays: number(params, `${prefix}LiquidityDays`, DEFAULT_CRITERIA_V6[prefix].liquidityDays),
    minimumAverageVolumeLots: text(params, `${prefix}MinimumAverageVolumeLots`, DEFAULT_CRITERIA_V6[prefix].minimumAverageVolumeLots),
  });
  const criteria: CriteriaV6 = effectiveCriteriaV6({ ...v5Criteria,
    foreignReversal: common("foreignReversal"),
    trustReversal: { ...common("trustReversal"),
      minimumRecoveryPct: text(params, "trustReversalMinimumRecoveryPct", DEFAULT_CRITERIA_V6.trustReversal.minimumRecoveryPct),
      minimumParticipationPct: text(params, "trustReversalMinimumParticipationPct", DEFAULT_CRITERIA_V6.trustReversal.minimumParticipationPct),
      maximumParticipationPct: text(params, "trustReversalMaximumParticipationPct", DEFAULT_CRITERIA_V6.trustReversal.maximumParticipationPct) },
  });
  if (!validateCriteriaV6(criteria) || !sorts.includes(requestedSort)) throw new Error("invalid_query");
  const criteriaKey = criteriaFingerprintV6(criteria);
  const fingerprint = `${criteriaKey}|${requestedSort}|${v5.direction}|${v5.resultState}|${v5.limit}`;
  let cursor: { version: 6; snapshotId: string; offset: number; fingerprint: string } | null = null;
  if (params.has("cursor")) {
    try { cursor = JSON.parse(atob(params.get("cursor")!)); } catch { throw new Error("invalid_cursor"); }
    if (!cursor || cursor.version !== 6 || !/^[\w-]{36}$/.test(cursor.snapshotId) || !Number.isInteger(cursor.offset)
      || cursor.offset < 0 || cursor.offset > 10000 || cursor.fingerprint !== fingerprint
      || Object.keys(cursor).sort().join() !== "fingerprint,offset,snapshotId,version") throw new Error("invalid_cursor");
  }
  return { ...v5, version: 6 as const, criteria, sort: requestedSort, cursor, criteriaKey, fingerprint };
}

const json = (payload: unknown, status = 200) => Response.json(payload, { status, headers: { "cache-control": "no-store" } });
const missingKeys = ["volume-multiple", "large-holder-weekly-pp", "fractal", "boll-reversal", "ma", "divergence", ...chipKeys, ...institutionalKeys];
const emptyCounts = () => ({ total: 0, evaluated: 0, matched: 0, notMatched: 0, unknown: 0,
  missingByCondition: Object.fromEntries(missingKeys.map((key) => [key, 0])) });
const pending = (reason: string, health: unknown = null) => ({ version: 6, state: "pending", reason, snapshotId: null,
  universeRevision: null, formulaVersion: SCREENER_V6_FORMULA_VERSION, sourceMappingVersion: SCREENER_INSTITUTIONAL_MAPPING_VERSION,
  criteriaFingerprint: null, expectedSessionDate: null, effectiveSessionDate: null, createdAt: null,
  anchors: { daily: null, weekly: null, weeklyPeriods: [] }, technicalAnchors: null, counts: null, byMarket: null,
  preparation: null, chipCoverage: null, institutionalCoverage: null, chipHealth: health, rows: [], nextCursor: null });

function projectV5(url: URL) {
  const projected = new URL(url); projected.searchParams.set("version", "5");
  for (const key of v6Params) projected.searchParams.delete(key);
  if (!["code", "volumeMultiple", "turnover", "holderChange", "holderStreak", "confirmationDate", "algorithm", "direction",
    "outsideDistance", "maSpread", "pivotDate", "priceDifference", "largeHolderRatio", "trustOwnershipPct", "shortMarginRatio",
    "closeHighDays", "smaPeriod"].includes(projected.searchParams.get("sort") ?? "")) projected.searchParams.set("sort", "code");
  projected.searchParams.delete("cursor");
  return projected;
}

export async function handleStockScreenerV6(url: URL, env: { DB?: ScreenerDatabase }, now = new Date()) {
  let query: ReturnType<typeof parseScreenerV6Query>;
  try { query = parseScreenerV6Query(url.searchParams); } catch (error) { return json({ reason: (error as Error).message }, 400); }
  if (!query.criteria.foreignReversal.enabled && !query.criteria.trustReversal.enabled && !url.pathname.endsWith("/status")) {
    return handleStockScreenerV5(projectV5(url), env, now);
  }
  if (!env.DB) return json({ ...pending("d1_unavailable"), state: "unavailable" }, 503);
  try {
    const snapshot = await readScreenerV6Snapshot(env.DB, query.cursor?.snapshotId);
    if (!snapshot) {
      if (query.cursor) return json({ reason: "snapshot_expired" }, 409);
      return json(pending("v6_preparation_pending", await readScreenerChipHealth(env.DB)));
    }
    const freshness = await readScreenerFreshness(env.DB, snapshot.metadata.effectiveSessionDate);
    const legacy = query.criteria.volume.enabled || query.criteria.holder.enabled ? query.criteria
      : { ...query.criteria, volume: { ...query.criteria.volume, enabled: true } };
    const evaluated = screenStocks(snapshot.inputs, snapshot.metadata.anchors, effectiveCriteria(legacy));
    const counts = emptyCounts(), byMarket = { TWSE: emptyCounts(), TPEx: emptyCounts() };
    const rows = evaluated.rows.map((base, index) => {
      const input = snapshot.inputs[index] as ScreenerInputV6;
      const fractal = query.criteria.fractal.enabled ? selectStoredFractal(input.technical, query.criteria.fractal) : null;
      const bollReversal = query.criteria.bollReversal.enabled ? selectStoredBoll(input.technical, query.criteria.bollReversal) : null;
      const ma = query.criteria.ma.enabled ? evaluateMaCriteria((input as ScreenerInputV4).technicalV4.ma, query.criteria.ma) : null;
      const divergence = query.criteria.divergence.enabled ? selectStoredDivergence((input as ScreenerInputV4).technicalV4.divergence, query.criteria.divergence) : null;
      const chip = evaluateChipCriteria(input.chipV5, query.criteria);
      const institutional = evaluateInstitutionalCriteriaV6(input.institutionalV6, query.criteria);
      const verdict = combineCriteriaV6(query.criteria, { volume: base.volume?.verdict, holder: base.holder?.verdict,
        fractal: fractal?.verdict, bollReversal: bollReversal?.verdict, ma: ma?.verdict, divergence: divergence?.verdict }, chip, institutional);
      for (const summary of [counts, byMarket[input.market]]) {
        summary.total++;
        if (verdict === "unknown") summary.unknown++; else { summary.evaluated++; verdict === "pass" ? summary.matched++ : summary.notMatched++; }
        const known: Record<string, boolean> = { "volume-multiple": query.criteria.volume.enabled && base.volume?.verdict === "unknown",
          "large-holder-weekly-pp": query.criteria.holder.enabled && base.holder?.verdict === "unknown",
          fractal: query.criteria.fractal.enabled && fractal?.verdict === "unknown", "boll-reversal": query.criteria.bollReversal.enabled && bollReversal?.verdict === "unknown",
          ma: query.criteria.ma.enabled && ma?.verdict === "unknown", divergence: query.criteria.divergence.enabled && divergence?.verdict === "unknown" };
        for (const [key, value] of Object.entries(known)) if (value) summary.missingByCondition[key]++;
        for (const key of chipKeys) if (query.criteria[key].enabled && chip[key].verdict === "unknown") summary.missingByCondition[key]++;
        for (const key of institutionalKeys) if (query.criteria[key].enabled && institutional[key].verdict === "unknown") summary.missingByCondition[key]++;
      }
      return { ...baseResult({ ...base, verdict } as ScreenerRow, query.criteria), verdict, technical: { fractal, bollReversal },
        technicalV4: { ma, divergence, evidenceHash: input.technicalV4.evidenceHash },
        chipV5: { outcomes: chip, evidenceHash: input.chipV5.evidenceHash, dailyThrough: input.chipV5.dailyThrough,
          weeklyThrough: input.chipV5.weeklyThrough },
        institutionalV6: { outcomes: institutional, evidenceHash: input.institutionalV6.evidenceHash,
          dailyThrough: input.institutionalV6.dailyThrough } };
    }).filter((row) => row.verdict === query.resultState);
    const metric = (row: typeof rows[number]): number | string | null => {
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
    return json({ version: 6, state: freshnessPending ? "pending" : stale ? "stale" : hasMissing ? "partial" : "ready",
      reason: freshnessPending ? freshness.reason : stale ? "snapshot_stale" : "none", snapshotId: snapshot.id,
      universeRevision: snapshot.metadata.universeRevision, formulaVersion: SCREENER_V6_FORMULA_VERSION,
      sourceMappingVersion: SCREENER_INSTITUTIONAL_MAPPING_VERSION, criteriaFingerprint: query.criteriaKey,
      expectedSessionDate: freshness.expectedSessionDate ?? snapshot.metadata.expectedSessionDate,
      effectiveSessionDate: snapshot.metadata.effectiveSessionDate, sessionReadiness: freshness.readiness,
      createdAt: snapshot.createdAt, anchors: snapshot.metadata.anchors, technicalAnchors: snapshot.metadata.technicalAnchors,
      counts, byMarket, preparation: null, chipCoverage: snapshot.metadata.coverage,
      institutionalCoverage: snapshot.metadata.institutionalCoverage,
      rows: url.pathname.endsWith("/status") || stale ? [] : rows.slice(offset, next),
      nextCursor: !url.pathname.endsWith("/status") && !stale && next < rows.length
        ? btoa(JSON.stringify({ version: 6, snapshotId: snapshot.id, offset: next, fingerprint: query.fingerprint })) : null });
  } catch (error) {
    if (/no such (?:table|column).*screener_/.test(String(error))) return json(pending("schema_pending"));
    return json({ ...pending("snapshot_unavailable"), state: "unavailable" }, 503);
  }
}
