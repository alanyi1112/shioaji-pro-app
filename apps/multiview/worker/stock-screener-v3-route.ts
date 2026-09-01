import { screenStocks, type ScreenerRow, type Verdict } from "../../../src/lib/stock-screener-domain.ts";
import { turnoverEvidence, type ScreenerResultRow } from "../../../src/lib/stock-screener-api.ts";
import {
  combineCriteriaV3, compareTechnicalRows, criteriaFingerprintV3, DEFAULT_CRITERIA_V3,
  isV3Cursor, SCREENER_V3_FORMULA_VERSION, selectStoredBoll, selectStoredFractal,
  validateCriteriaV3, type CriteriaV3, type ScreenerInputV3, type ScreenerResultV3,
  type ScreenerV3Counts, type ScreenerV3Progress, type TechnicalSort,
} from "../../../src/lib/stock-screener-technical-patterns.ts";
import type { ScreenerDatabase } from "./stock-screener-repository.ts";
import { readScreenerV3Snapshot } from "./stock-screener-v3-repository.ts";

const allowedKeys = new Set(["version", "mode", "volume", "volumeThreshold", "volumeTurnover", "volumeTurnoverMinimumWan",
  "holder", "holderThreshold", "holderMode", "holderStreakWeeks", "holderTurnover", "holderTurnoverMinimumWan",
  "fractal", "fractalAlgorithm", "fractalDirection", "bollReversal", "bollMode",
  "sort", "direction", "resultState", "limit", "cursor"]);
const sorts = ["code", "volumeMultiple", "turnover", "holderChange", "holderStreak", "confirmationDate", "algorithm", "direction", "outsideDistance"] as const;
type Sort = typeof sorts[number];

export function parseScreenerV3Query(params: URLSearchParams) {
  if ([...params.keys()].some((key) => !allowedKeys.has(key) || params.getAll(key).length !== 1)
    || params.toString().length > 3072 || params.get("version") !== "3") throw new Error("invalid_query");
  for (const key of ["volume", "holder", "volumeTurnover", "holderTurnover", "fractal", "bollReversal"])
    if (params.has(key) && !["true", "false"].includes(params.get(key)!)) throw new Error("invalid_query");
  const criteria: CriteriaV3 = {
    mode: (params.get("mode") ?? "all") as CriteriaV3["mode"],
    volume: { enabled: params.get("volume") !== "false", threshold: params.get("volumeThreshold") ?? DEFAULT_CRITERIA_V3.volume.threshold,
      turnover: { enabled: params.get("volumeTurnover") === "true", minimumWan: params.get("volumeTurnoverMinimumWan") ?? DEFAULT_CRITERIA_V3.volume.turnover.minimumWan } },
    holder: { enabled: params.get("holder") !== "false", threshold: params.get("holderThreshold") ?? DEFAULT_CRITERIA_V3.holder.threshold,
      mode: (params.get("holderMode") ?? DEFAULT_CRITERIA_V3.holder.mode) as CriteriaV3["holder"]["mode"],
      streakWeeks: Number(params.get("holderStreakWeeks") ?? DEFAULT_CRITERIA_V3.holder.streakWeeks),
      turnover: { enabled: params.get("holderTurnover") === "true", minimumWan: params.get("holderTurnoverMinimumWan") ?? DEFAULT_CRITERIA_V3.holder.turnover.minimumWan } },
    fractal: { enabled: params.get("fractal") === "true",
      algorithm: (params.get("fractalAlgorithm") ?? DEFAULT_CRITERIA_V3.fractal.algorithm) as CriteriaV3["fractal"]["algorithm"],
      direction: (params.get("fractalDirection") ?? DEFAULT_CRITERIA_V3.fractal.direction) as CriteriaV3["fractal"]["direction"] },
    bollReversal: { enabled: params.get("bollReversal") === "true",
      mode: (params.get("bollMode") ?? DEFAULT_CRITERIA_V3.bollReversal.mode) as CriteriaV3["bollReversal"]["mode"] },
  };
  const sort = (params.get("sort") ?? "code") as Sort;
  const direction = params.get("direction") ?? "asc";
  const resultState = (params.get("resultState") ?? "pass") as Verdict;
  const limitRaw = params.get("limit") ?? "50", limit = Number(limitRaw);
  if (!validateCriteriaV3(criteria) || !sorts.includes(sort) || !["asc", "desc"].includes(direction)
    || !["pass", "fail", "unknown"].includes(resultState) || !/^\d{1,3}$/.test(limitRaw) || limit < 1 || limit > 100)
    throw new Error("invalid_query");
  const criteriaKey = criteriaFingerprintV3(criteria);
  const fingerprint = `${criteriaKey}|${sort}|${direction}|${resultState}|${limit}`;
  let cursor = null;
  if (params.has("cursor")) {
    try { cursor = JSON.parse(atob(params.get("cursor")!)); } catch { throw new Error("invalid_cursor"); }
    if (!isV3Cursor(cursor) || cursor.fingerprint !== fingerprint) throw new Error("invalid_cursor");
  }
  return { version: 3 as const, criteria, sort, direction: direction as "asc" | "desc", resultState, limit, cursor, fingerprint, criteriaKey };
}

const emptyCounts = (): ScreenerV3Counts => ({ total: 0, evaluated: 0, matched: 0, notMatched: 0, unknown: 0,
  missingByCondition: { "volume-multiple": 0, "large-holder-weekly-pp": 0, fractal: 0, "boll-reversal": 0 } });

function baseResult(row: ScreenerRow, criteria: CriteriaV3): ScreenerResultRow {
  const ratio = (point: ScreenerRow["currentHolder"]) => point?.bands.find((band) => band.level === 15)?.ratio ?? null;
  const current = row.currentVolume?.shares ?? null, previous = row.previousVolume?.shares ?? null;
  const series = row.holderSeries ?? [row.previousHolder, row.currentHolder].filter((point): point is NonNullable<typeof point> => point !== null);
  const hc = ratio(series.at(-1) ?? null), hp = ratio(series.at(-2) ?? null);
  const changes = row.holder?.changesPpHundredths?.map((value) => Number(value) / 100) ?? [];
  const volumeSignal = row.volume?.signal ?? row.volume, holderSignal = row.holder?.signal ?? row.holder;
  const turnoverNtd = row.currentVolume?.turnoverNtd ?? null;
  return { code: row.code, symbol: row.symbol, name: row.name, market: row.market, kind: row.kind, verdict: row.verdict,
    volume: { current, previous, multiple: volumeSignal && volumeSignal.verdict !== "unknown" && current !== null && previous !== null && BigInt(previous) > 0 ? Number(current) / Number(previous) : null,
      reason: row.volume?.reason ?? null, turnover: turnoverEvidence(turnoverNtd, row.currentVolume?.date ?? null,
        volumeSignal?.verdict ?? null, row.volume?.turnover?.verdict ?? null, row.volume?.turnover?.reason ?? null) },
    holder: { mode: criteria.holder.mode, current: hc, previous: hp, changePp: holderSignal && holderSignal.verdict !== "unknown" ? changes.at(-1) ?? null : null,
      reason: row.holder?.reason ?? null, streakWeeks: row.holder?.streakWeeks ?? null, changesPp: changes,
      series: series.map((point) => ({ date: point.date, ratio: ratio(point)! })),
      turnover: turnoverEvidence(turnoverNtd, row.currentVolume?.date ?? null, holderSignal?.verdict ?? null,
        row.holder?.turnover?.verdict ?? null, row.holder?.turnover?.reason ?? null) },
    sources: [...new Set([row.currentVolume, row.previousVolume, ...series].flatMap((point) => point ? [point.provenance.source] : []))] };
}

function preparation(value: unknown): ScreenerV3Progress | null {
  try {
    const row = value as { version?: number; target?: number; processed?: number; remaining?: number; failed?: number; overdue?: number; cursor?: string | null; markets?: ScreenerV3Progress["markets"] };
    return row?.version === 3 && Number.isInteger(row.target) && Number.isInteger(row.processed) && Number.isInteger(row.remaining)
      && Number.isInteger(row.failed) && Number.isInteger(row.overdue) && row.markets?.TWSE && row.markets?.TPEx
      ? { version: 3, target: row.target!, processed: row.processed!, remaining: row.remaining!, failed: row.failed!, overdue: row.overdue!, cursor: row.cursor ?? null, markets: row.markets } : null;
  } catch { return null; }
}

const json = (payload: unknown, status = 200) => Response.json(payload, { status, headers: { "cache-control": "no-store" } });
const pendingPayload = (reason: string, progress: ScreenerV3Progress | null = null) => ({ version: 3, state: "pending", reason,
  snapshotId: null, universeRevision: null, formulaVersion: SCREENER_V3_FORMULA_VERSION, criteriaFingerprint: null,
  expectedSessionDate: null, createdAt: null, anchors: { daily: null, weekly: null, weeklyPeriods: [] },
  technicalAnchors: null, counts: null, byMarket: null, preparation: progress, rows: [], nextCursor: null });

export async function handleStockScreenerV3(url: URL, env: { DB?: ScreenerDatabase }, now = new Date()) {
  let query: ReturnType<typeof parseScreenerV3Query>;
  try { query = parseScreenerV3Query(url.searchParams); }
  catch (error) { return json({ reason: (error as Error).message }, 400); }
  if (!env.DB) return json({ ...pendingPayload("d1_unavailable"), state: "unavailable" }, 503);
  try {
    const snapshot = await readScreenerV3Snapshot(env.DB, query.cursor?.snapshotId);
    if (!snapshot) {
      if (query.cursor) return json({ reason: "snapshot_expired" }, 409);
      const progressRow = await env.DB.prepare("SELECT checkpoint FROM screener_runs WHERE id='screener-ohlcv-progress'").first<{ checkpoint: string }>();
      let progress: ScreenerV3Progress | null = null;
      try { progress = preparation(progressRow ? JSON.parse(progressRow.checkpoint) : null); } catch { progress = null; }
      return json(pendingPayload("v3_preparation_pending", progress));
    }
    const baseCriteria = query.criteria.volume.enabled || query.criteria.holder.enabled ? query.criteria
      : { ...query.criteria, volume: { ...query.criteria.volume, enabled: true } };
    const evaluated = screenStocks(snapshot.inputs, snapshot.metadata.anchors, baseCriteria);
    const counts = emptyCounts(), byMarket = { TWSE: emptyCounts(), TPEx: emptyCounts() };
    const rows = evaluated.rows.map((base, index) => {
      const input = snapshot.inputs[index] as ScreenerInputV3;
      const fractal = query.criteria.fractal.enabled ? selectStoredFractal(input.technical, query.criteria.fractal) : null;
      const bollReversal = query.criteria.bollReversal.enabled ? selectStoredBoll(input.technical, query.criteria.bollReversal) : null;
      const verdict = combineCriteriaV3(query.criteria, { volume: base.volume?.verdict, holder: base.holder?.verdict,
        fractal: fractal?.verdict, bollReversal: bollReversal?.verdict });
      for (const summary of [counts, byMarket[input.market]]) {
        summary.total++;
        if (verdict === "unknown") summary.unknown++;
        else { summary.evaluated++; if (verdict === "pass") summary.matched++; else summary.notMatched++; }
        if (query.criteria.volume.enabled && base.volume?.verdict === "unknown") summary.missingByCondition["volume-multiple"]++;
        if (query.criteria.holder.enabled && base.holder?.verdict === "unknown") summary.missingByCondition["large-holder-weekly-pp"]++;
        if (query.criteria.fractal.enabled && fractal?.verdict === "unknown") summary.missingByCondition.fractal++;
        if (query.criteria.bollReversal.enabled && bollReversal?.verdict === "unknown") summary.missingByCondition["boll-reversal"]++;
      }
      const shaped = baseResult({ ...base, verdict }, query.criteria);
      return { ...shaped, verdict, technical: { fractal, bollReversal } };
    }).filter((row) => row.verdict === query.resultState);
    const baseMetric = (row: ScreenerResultRow & ScreenerResultV3): [bigint, bigint] | null => {
      if (query.sort === "volumeMultiple") return row.volume.current !== null && row.volume.previous !== null && BigInt(row.volume.previous) > 0 ? [BigInt(row.volume.current), BigInt(row.volume.previous)] : null;
      if (query.sort === "turnover") return row.volume.turnover.ntd !== null ? [BigInt(row.volume.turnover.ntd), BigInt(1)] : null;
      if (query.sort === "holderStreak") return row.holder.streakWeeks !== null ? [BigInt(row.holder.streakWeeks), BigInt(1)] : null;
      if (query.sort === "holderChange") return row.holder.changePp !== null ? [BigInt(Math.round(row.holder.changePp * 100)), BigInt(1)] : null;
      return null;
    };
    rows.sort((a, b) => {
      if (["confirmationDate", "algorithm", "direction", "outsideDistance"].includes(query.sort))
        return compareTechnicalRows(query.sort as TechnicalSort, query.direction,
          { code: a.code, verdict: a.verdict, fractal: a.technical.fractal?.evidence, boll: a.technical.bollReversal?.evidence },
          { code: b.code, verdict: b.verdict, fractal: b.technical.fractal?.evidence, boll: b.technical.bollReversal?.evidence });
      if (query.sort === "code") return a.code.localeCompare(b.code) * (query.direction === "desc" ? -1 : 1);
      const left = baseMetric(a), right = baseMetric(b);
      if (left === null || right === null) return left === right ? a.code.localeCompare(b.code) : left === null ? 1 : -1;
      const x = left[0] * right[1], y = right[0] * left[1], cmp = x < y ? -1 : x > y ? 1 : 0;
      return (query.direction === "desc" ? -cmp : cmp) || a.code.localeCompare(b.code);
    });
    const offset = query.cursor?.offset ?? 0;
    if (offset > rows.length) return json({ reason: "invalid_cursor" }, 400);
    const next = offset + query.limit, stale = now.getTime() > Date.parse(snapshot.metadata.validThrough);
    const hasMissing = Object.values(counts.missingByCondition).some((count) => count > 0);
    const payload = { version: 3, state: stale ? "stale" : hasMissing ? "partial" : "ready",
      reason: stale ? "snapshot_stale" : "none", snapshotId: snapshot.id, universeRevision: snapshot.metadata.universeRevision,
      formulaVersion: SCREENER_V3_FORMULA_VERSION, criteriaFingerprint: query.criteriaKey,
      expectedSessionDate: snapshot.metadata.technicalAnchors.through, createdAt: snapshot.createdAt,
      anchors: snapshot.metadata.anchors, technicalAnchors: snapshot.metadata.technicalAnchors, counts, byMarket,
      preparation: snapshot.metadata.progress, rows: url.pathname.endsWith("/status") ? [] : rows.slice(offset, next),
      nextCursor: !url.pathname.endsWith("/status") && next < rows.length
        ? btoa(JSON.stringify({ version: 3, snapshotId: snapshot.id, offset: next, fingerprint: query.fingerprint })) : null };
    return json(payload);
  } catch (error) {
    if (/no such table.*screener_/.test(String(error))) return json(pendingPayload("schema_pending"));
    return json({ ...pendingPayload("snapshot_unavailable"), state: "unavailable" }, 503);
  }
}
