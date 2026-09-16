import { effectiveCriteria, screenStocks, type ScreenerRow, type Verdict } from "../../../src/lib/stock-screener-domain.ts";
import type { ScreenerResultRowV4 } from "../../../src/lib/stock-screener-api.ts";
import {
  compareTechnicalRows, selectStoredBoll, selectStoredFractal,
} from "../../../src/lib/stock-screener-technical-patterns.ts";
import {
  combineCriteriaV4, criteriaFingerprintV4, DEFAULT_CRITERIA_V4, effectiveCriteriaV4,
  evaluateMaCriteria, isV4Cursor, SCREENER_V4_FORMULA_VERSION, selectStoredDivergence,
  validateCriteriaV4, validateScreenerV4Progress, type CriteriaV4, type ScreenerInputV4, type ScreenerV4Counts, type ScreenerV4Progress,
} from "../../../src/lib/stock-screener-v4.ts";
import { SCREENER_OHLCV_V4_MAPPING_VERSION } from "../../../src/lib/stock-screener-ohlcv.ts";
import type { ScreenerDatabase } from "./stock-screener-repository.ts";
import { baseResult, handleStockScreenerV3 } from "./stock-screener-v3-route.ts";
import { readScreenerV4Snapshot } from "./stock-screener-v4-repository.ts";
import { readScreenerFreshness } from "./stock-screener-session-readiness.ts";

const allowedKeys = new Set(["version", "mode", "volume", "volumeThreshold", "volumeTurnover", "volumeTurnoverMinimumWan",
  "holder", "holderThreshold", "holderMode", "holderStreakWeeks", "holderTurnover", "holderTurnoverMinimumWan",
  "fractal", "fractalAlgorithm", "fractalDirection", "bollReversal", "bollMode",
  "ma", "maMode", "compressionDays", "maxSpreadPct", "divergence", "divergenceSource", "divergenceDirection", "requireZeroReset",
  "sort", "direction", "resultState", "limit", "cursor"]);
const sorts = ["code", "volumeMultiple", "turnover", "holderChange", "holderStreak", "confirmationDate", "algorithm", "direction",
  "outsideDistance", "maSpread", "pivotDate", "priceDifference"] as const;
type Sort = typeof sorts[number];

export function parseScreenerV4Query(params: URLSearchParams) {
  if ([...params.keys()].some((key) => !allowedKeys.has(key) || params.getAll(key).length !== 1)
    || params.toString().length > 4096 || params.get("version") !== "4") throw new Error("invalid_query");
  for (const key of ["volume", "holder", "volumeTurnover", "holderTurnover", "fractal", "bollReversal", "ma", "divergence", "requireZeroReset"]) {
    if (params.has(key) && !["true", "false"].includes(params.get(key)!)) throw new Error("invalid_query");
  }
  const criteria: CriteriaV4 = effectiveCriteriaV4({
    mode: (params.get("mode") ?? "all") as CriteriaV4["mode"],
    volume: { enabled: params.get("volume") !== "false", threshold: params.get("volumeThreshold") ?? DEFAULT_CRITERIA_V4.volume.threshold,
      turnover: { enabled: params.get("volumeTurnover") === "true", minimumWan: params.get("volumeTurnoverMinimumWan") ?? DEFAULT_CRITERIA_V4.volume.turnover.minimumWan } },
    holder: { enabled: params.get("holder") !== "false", threshold: params.get("holderThreshold") ?? DEFAULT_CRITERIA_V4.holder.threshold,
      mode: (params.get("holderMode") ?? DEFAULT_CRITERIA_V4.holder.mode) as CriteriaV4["holder"]["mode"],
      streakWeeks: Number(params.get("holderStreakWeeks") ?? DEFAULT_CRITERIA_V4.holder.streakWeeks),
      turnover: { enabled: params.get("holderTurnover") === "true", minimumWan: params.get("holderTurnoverMinimumWan") ?? DEFAULT_CRITERIA_V4.holder.turnover.minimumWan } },
    fractal: { enabled: params.get("fractal") === "true", algorithm: (params.get("fractalAlgorithm") ?? DEFAULT_CRITERIA_V4.fractal.algorithm) as CriteriaV4["fractal"]["algorithm"],
      direction: (params.get("fractalDirection") ?? DEFAULT_CRITERIA_V4.fractal.direction) as CriteriaV4["fractal"]["direction"] },
    bollReversal: { enabled: params.get("bollReversal") === "true", mode: (params.get("bollMode") ?? DEFAULT_CRITERIA_V4.bollReversal.mode) as CriteriaV4["bollReversal"]["mode"] },
    ma: { enabled: params.get("ma") === "true", mode: (params.get("maMode") ?? DEFAULT_CRITERIA_V4.ma.mode) as CriteriaV4["ma"]["mode"],
      compressionDays: Number(params.get("compressionDays") ?? DEFAULT_CRITERIA_V4.ma.compressionDays), maxSpreadPct: params.get("maxSpreadPct") ?? DEFAULT_CRITERIA_V4.ma.maxSpreadPct },
    divergence: { enabled: params.get("divergence") === "true", source: (params.get("divergenceSource") ?? DEFAULT_CRITERIA_V4.divergence.source) as CriteriaV4["divergence"]["source"],
      direction: (params.get("divergenceDirection") ?? DEFAULT_CRITERIA_V4.divergence.direction) as CriteriaV4["divergence"]["direction"],
      requireZeroReset: params.get("requireZeroReset") === "true" },
  });
  const sort = (params.get("sort") ?? "code") as Sort;
  const direction = params.get("direction") ?? "asc";
  const resultState = (params.get("resultState") ?? "pass") as Verdict;
  const limitRaw = params.get("limit") ?? "50", limit = Number(limitRaw);
  if (!validateCriteriaV4(criteria) || !sorts.includes(sort) || !["asc", "desc"].includes(direction)
    || !["pass", "fail", "unknown"].includes(resultState) || !/^\d{1,3}$/.test(limitRaw) || limit < 1 || limit > 100) {
    throw new Error("invalid_query");
  }
  const criteriaKey = criteriaFingerprintV4(criteria);
  const fingerprint = `${criteriaKey}|${sort}|${direction}|${resultState}|${limit}`;
  let cursor = null;
  if (params.has("cursor")) {
    try { cursor = JSON.parse(atob(params.get("cursor")!)); } catch { throw new Error("invalid_cursor"); }
    if (!isV4Cursor(cursor) || cursor.fingerprint !== fingerprint) throw new Error("invalid_cursor");
  }
  return { version: 4 as const, criteria, sort, direction: direction as "asc" | "desc", resultState, limit, cursor, fingerprint, criteriaKey };
}

const emptyCounts = (): ScreenerV4Counts => ({ total: 0, evaluated: 0, matched: 0, notMatched: 0, unknown: 0,
  missingByCondition: { "volume-multiple": 0, "large-holder-weekly-pp": 0, fractal: 0, "boll-reversal": 0, ma: 0, divergence: 0 } });
const json = (payload: unknown, status = 200) => Response.json(payload, { status, headers: { "cache-control": "no-store" } });
const pendingPayload = (reason: string, progress: ScreenerV4Progress | null = null) => ({ version: 4, state: "pending", reason,
  snapshotId: null, universeRevision: null, formulaVersion: SCREENER_V4_FORMULA_VERSION,
  sourceMappingVersion: SCREENER_OHLCV_V4_MAPPING_VERSION, criteriaFingerprint: null,
  expectedSessionDate: null, effectiveSessionDate: null, createdAt: null,
  sessionReadiness: null,
  anchors: { daily: null, weekly: null, weeklyPeriods: [] }, technicalAnchors: null,
  counts: null, byMarket: null, preparation: progress, rows: [], nextCursor: null });

function progress(value: unknown): ScreenerV4Progress | null {
  const row = value as ScreenerV4Progress & { dataCapability?: string };
  return row?.dataCapability === "ohlcv-v4" && validateScreenerV4Progress(row) ? row : null;
}

function v3ProjectionUrl(url: URL): URL {
  const projected = new URL(url);
  projected.searchParams.set("version", "3");
  for (const key of ["ma", "maMode", "compressionDays", "maxSpreadPct", "divergence", "divergenceSource", "divergenceDirection", "requireZeroReset"]) projected.searchParams.delete(key);
  if (["maSpread", "pivotDate", "priceDifference"].includes(projected.searchParams.get("sort") ?? "")) projected.searchParams.set("sort", "code");
  projected.searchParams.delete("cursor");
  return projected;
}

export async function handleStockScreenerV4(url: URL, env: { DB?: ScreenerDatabase }, now = new Date()) {
  let query: ReturnType<typeof parseScreenerV4Query>;
  try { query = parseScreenerV4Query(url.searchParams); }
  catch (error) { return json({ reason: (error as Error).message }, 400); }
  if (!query.criteria.ma.enabled && !query.criteria.divergence.enabled) return handleStockScreenerV3(v3ProjectionUrl(url), env, now);
  if (!env.DB) return json({ ...pendingPayload("d1_unavailable"), state: "unavailable" }, 503);
  try {
    const snapshot = await readScreenerV4Snapshot(env.DB, query.cursor?.snapshotId);
    if (!snapshot) {
      if (query.cursor) return json({ reason: "snapshot_expired" }, 409);
      const row = await env.DB.prepare("SELECT checkpoint FROM screener_runs WHERE id='screener-ohlcv-v4-progress'").first<{ checkpoint: string }>();
      let prepared: ScreenerV4Progress | null = null;
      try { prepared = progress(row ? JSON.parse(row.checkpoint) : null); } catch { prepared = null; }
      const freshness = await readScreenerFreshness(env.DB, null);
      return json({ ...pendingPayload("v4_preparation_pending", prepared),
        expectedSessionDate: freshness.expectedSessionDate, effectiveSessionDate: freshness.effectiveSessionDate,
        sessionReadiness: freshness.readiness });
    }
    const freshness = await readScreenerFreshness(env.DB, snapshot.metadata.effectiveSessionDate);
    const expectedSessionDate = freshness.readiness ? freshness.expectedSessionDate : snapshot.metadata.expectedSessionDate;
    const baseCriteria = query.criteria.volume.enabled || query.criteria.holder.enabled ? query.criteria
      : { ...query.criteria, volume: { ...query.criteria.volume, enabled: true } };
    const evaluated = screenStocks(snapshot.inputs, snapshot.metadata.anchors, effectiveCriteria(baseCriteria));
    const counts = emptyCounts(), byMarket = { TWSE: emptyCounts(), TPEx: emptyCounts() };
    const rows = evaluated.rows.map((base, index) => {
      const input = snapshot.inputs[index] as ScreenerInputV4;
      const fractal = query.criteria.fractal.enabled ? selectStoredFractal(input.technical, query.criteria.fractal) : null;
      const bollReversal = query.criteria.bollReversal.enabled ? selectStoredBoll(input.technical, query.criteria.bollReversal) : null;
      const ma = query.criteria.ma.enabled ? evaluateMaCriteria(input.technicalV4.ma, query.criteria.ma) : null;
      const divergence = query.criteria.divergence.enabled ? selectStoredDivergence(input.technicalV4.divergence, query.criteria.divergence) : null;
      const verdict = combineCriteriaV4(query.criteria, { volume: base.volume?.verdict, holder: base.holder?.verdict,
        fractal: fractal?.verdict, bollReversal: bollReversal?.verdict, ma: ma?.verdict, divergence: divergence?.verdict });
      for (const summary of [counts, byMarket[input.market]]) {
        summary.total++;
        if (verdict === "unknown") summary.unknown++;
        else { summary.evaluated++; if (verdict === "pass") summary.matched++; else summary.notMatched++; }
        if (query.criteria.volume.enabled && base.volume?.verdict === "unknown") summary.missingByCondition["volume-multiple"]++;
        if (query.criteria.holder.enabled && base.holder?.verdict === "unknown") summary.missingByCondition["large-holder-weekly-pp"]++;
        if (query.criteria.fractal.enabled && fractal?.verdict === "unknown") summary.missingByCondition.fractal++;
        if (query.criteria.bollReversal.enabled && bollReversal?.verdict === "unknown") summary.missingByCondition["boll-reversal"]++;
        if (query.criteria.ma.enabled && ma?.verdict === "unknown") summary.missingByCondition.ma++;
        if (query.criteria.divergence.enabled && divergence?.verdict === "unknown") summary.missingByCondition.divergence++;
      }
      return { ...baseResult({ ...base, verdict } as ScreenerRow, query.criteria), verdict,
        technical: { fractal, bollReversal }, technicalV4: { ma, divergence, evidenceHash: input.technicalV4.evidenceHash } } as ScreenerResultRowV4;
    }).filter((row) => row.verdict === query.resultState);
    const baseMetric = (row: ScreenerResultRowV4): number | bigint | string | null => {
      if (query.sort === "volumeMultiple") return row.volume.multiple;
      if (query.sort === "turnover") return row.volume.turnover.ntd === null ? null : BigInt(row.volume.turnover.ntd);
      if (query.sort === "holderStreak") return row.holder.streakWeeks;
      if (query.sort === "holderChange") return row.holder.changePp;
      if (query.sort === "maSpread") return row.technicalV4.ma?.evidence?.current.spreadPct ?? null;
      if (query.sort === "pivotDate") return row.technicalV4.divergence?.evidence?.second.confirmationDate ?? null;
      if (query.sort === "priceDifference") return row.technicalV4.divergence?.evidence?.priceDifferencePct ?? null;
      return null;
    };
    rows.sort((a, b) => {
      if (["confirmationDate", "algorithm", "direction", "outsideDistance"].includes(query.sort)) {
        return compareTechnicalRows(query.sort as "confirmationDate" | "algorithm" | "direction" | "outsideDistance", query.direction,
          { code: a.code, verdict: a.verdict, fractal: a.technical.fractal?.evidence, boll: a.technical.bollReversal?.evidence },
          { code: b.code, verdict: b.verdict, fractal: b.technical.fractal?.evidence, boll: b.technical.bollReversal?.evidence });
      }
      if (query.sort === "code") return a.code.localeCompare(b.code) * (query.direction === "desc" ? -1 : 1);
      const left = baseMetric(a), right = baseMetric(b);
      if (left === null || right === null) return left === right ? a.code.localeCompare(b.code) : left === null ? 1 : -1;
      const cmp = left < right ? -1 : left > right ? 1 : 0;
      return (query.direction === "desc" ? -cmp : cmp) || a.code.localeCompare(b.code);
    });
    const offset = query.cursor?.offset ?? 0;
    if (offset > rows.length) return json({ reason: "invalid_cursor" }, 400);
    const next = offset + query.limit, freshnessPending = freshness.pending
      || !!expectedSessionDate && snapshot.metadata.effectiveSessionDate < expectedSessionDate;
    const stale = now.getTime() > Date.parse(snapshot.metadata.validThrough) || freshnessPending;
    const hasMissing = Object.values(counts.missingByCondition).some((count) => count > 0);
    const payload = { version: 4, state: freshnessPending ? "pending" : stale ? "stale" : hasMissing ? "partial" : "ready",
      reason: freshnessPending ? (freshness.pending ? freshness.reason : "source_not_published") : stale ? "snapshot_stale" : "none", snapshotId: snapshot.id,
      universeRevision: snapshot.metadata.universeRevision, formulaVersion: snapshot.metadata.formulaVersion,
      sourceMappingVersion: snapshot.metadata.sourceMappingVersion, criteriaFingerprint: query.criteriaKey,
      expectedSessionDate,
      effectiveSessionDate: snapshot.metadata.effectiveSessionDate, sessionReadiness: freshness.readiness,
      createdAt: snapshot.createdAt, anchors: snapshot.metadata.anchors, technicalAnchors: snapshot.metadata.technicalAnchors,
      counts, byMarket, preparation: snapshot.metadata.progress,
      rows: url.pathname.endsWith("/status") || stale ? [] : rows.slice(offset, next),
      nextCursor: !url.pathname.endsWith("/status") && !stale && next < rows.length
        ? btoa(JSON.stringify({ version: 4, snapshotId: snapshot.id, offset: next, fingerprint: query.fingerprint })) : null };
    return json(payload);
  } catch (error) {
    if (/no such (?:table.*screener_|column.*volume_shares)/.test(String(error))) return json(pendingPayload("schema_pending"));
    return json({ ...pendingPayload("snapshot_unavailable"), state: "unavailable" }, 503);
  }
}
