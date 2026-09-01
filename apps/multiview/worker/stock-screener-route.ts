import {
  criteriaFingerprint, DEFAULT_CRITERIA, screenStocks, validateCriteria,
  type Criteria, type ScreenerRow, type Verdict,
} from "../../../src/lib/stock-screener-domain.ts";
import type { ScreenerResponse, ScreenerResultRow, ScreenerSort } from "../../../src/lib/stock-screener-api.ts";
import { turnoverEvidence } from "../../../src/lib/stock-screener-api.ts";
import { readScreenerSnapshot, type ScreenerDatabase } from "./stock-screener-repository.ts";
import { handleStockScreenerV3 } from "./stock-screener-v3-route.ts";

const prefix = "/api/stock-screener";
const allowedKeys = new Set(["version", "mode", "volume", "volumeThreshold", "volumeTurnover", "volumeTurnoverMinimumWan",
  "holder", "holderThreshold", "holderMode", "holderStreakWeeks", "holderTurnover", "holderTurnoverMinimumWan",
  "sort", "direction", "resultState", "limit", "cursor"]);
export function parseScreenerQuery(params: URLSearchParams) {
  if ([...params.keys()].some((key) => !allowedKeys.has(key) || params.getAll(key).length !== 1)
    || params.toString().length > 2048) throw new Error("invalid_query");
  for (const key of ["volume", "holder", "volumeTurnover", "holderTurnover"]) if (params.has(key) && !["true", "false"].includes(params.get(key)!)) throw new Error("invalid_query");
  if (params.has("version") && params.get("version") !== "2") throw new Error("invalid_query");
  const criteria: Criteria = {
    mode: (params.get("mode") ?? "all") as Criteria["mode"],
    volume: { enabled: params.get("volume") !== "false", threshold: params.get("volumeThreshold") ?? DEFAULT_CRITERIA.volume.threshold,
      turnover: { enabled: params.get("volumeTurnover") === "true", minimumWan: params.get("volumeTurnoverMinimumWan") ?? DEFAULT_CRITERIA.volume.turnover.minimumWan } },
    holder: { enabled: params.get("holder") !== "false", threshold: params.get("holderThreshold") ?? DEFAULT_CRITERIA.holder.threshold,
      mode: (params.get("holderMode") ?? DEFAULT_CRITERIA.holder.mode) as Criteria["holder"]["mode"],
      streakWeeks: Number(params.get("holderStreakWeeks") ?? DEFAULT_CRITERIA.holder.streakWeeks),
      turnover: { enabled: params.get("holderTurnover") === "true", minimumWan: params.get("holderTurnoverMinimumWan") ?? DEFAULT_CRITERIA.holder.turnover.minimumWan } },
  };
  const sort = (params.get("sort") ?? "code") as ScreenerSort;
  const direction = params.get("direction") ?? "asc";
  const resultState = (params.get("resultState") ?? "pass") as Verdict;
  const limitRaw = params.get("limit") ?? "50";
  const limit = Number(limitRaw);
  if (!validateCriteria(criteria) || !["code", "volumeMultiple", "turnover", "holderChange", "holderStreak"].includes(sort)
    || !["asc", "desc"].includes(direction) || !["pass", "fail", "unknown"].includes(resultState)
    || !/^\d{1,3}$/.test(limitRaw) || limit < 1 || limit > 100) throw new Error("invalid_query");
  const fingerprint = `${criteriaFingerprint(criteria)}|${sort}|${direction}|${resultState}|${limit}`;
  let cursor: { id: string; offset: number; fingerprint: string } | null = null;
  if (params.has("cursor")) {
    try { cursor = JSON.parse(atob(params.get("cursor")!)); } catch { throw new Error("invalid_cursor"); }
    if (!cursor || !/^[\w-]{36}$/.test(cursor.id) || !Number.isInteger(cursor.offset) || cursor.offset < 0 || cursor.offset > 10000
      || cursor.fingerprint !== fingerprint || Object.keys(cursor).sort().join() !== "fingerprint,id,offset") throw new Error("invalid_cursor");
  }
  return { criteria, sort, direction, resultState, limit, cursor, fingerprint };
}

function resultRow(row: ScreenerRow, criteria: Criteria): ScreenerResultRow {
  const ratio = (point: ScreenerRow["currentHolder"]) => point?.bands.find((band) => band.level === 15)?.ratio ?? null;
  const current = row.currentVolume?.shares ?? null, previous = row.previousVolume?.shares ?? null;
  const series = row.holderSeries ?? [row.previousHolder, row.currentHolder].filter((point): point is NonNullable<typeof point> => point !== null);
  const hc = ratio(series.at(-1) ?? null), hp = ratio(series.at(-2) ?? null);
  const changes = row.holder?.changesPpHundredths?.map(value => Number(value) / 100) ?? [];
  const volumeSignal = row.volume?.signal ?? row.volume;
  const holderSignal = row.holder?.signal ?? row.holder;
  const turnoverNtd = row.currentVolume?.turnoverNtd ?? null;
  return {
    code: row.code, symbol: row.symbol, name: row.name, market: row.market, kind: row.kind, verdict: row.verdict,
    volume: { current, previous, multiple: volumeSignal && volumeSignal.verdict !== "unknown" && current !== null && previous !== null && BigInt(previous) > 0 ? Number(current) / Number(previous) : null,
      reason: row.volume?.reason ?? null, turnover: turnoverEvidence(turnoverNtd, row.currentVolume?.date ?? null,
        volumeSignal?.verdict ?? null, row.volume?.turnover?.verdict ?? null, row.volume?.turnover?.reason ?? null) },
    holder: { mode: criteria.holder.mode, current: hc, previous: hp, changePp: holderSignal && holderSignal.verdict !== "unknown" ? changes.at(-1) ?? null : null,
      reason: row.holder?.reason ?? null, streakWeeks: row.holder?.streakWeeks ?? null, changesPp: changes,
      series: series.map(point => ({ date: point.date, ratio: ratio(point)! })),
      turnover: turnoverEvidence(turnoverNtd, row.currentVolume?.date ?? null, holderSignal?.verdict ?? null,
        row.holder?.turnover?.verdict ?? null, row.holder?.turnover?.reason ?? null) },
    sources: [...new Set([row.currentVolume, row.previousVolume, ...series].flatMap((point) => point ? [point.provenance.source] : []))],
  };
}
const response = (payload: unknown, status = 200) => Response.json(payload, { status, headers: { "cache-control": "no-store" } });
const pending = (reason: string): ScreenerResponse => ({ version: 2, state: "pending", reason, snapshotId: null, universeRevision: null, formulaVersion: "after-market-v2", criteriaFingerprint: null, expectedSessionDate: null, createdAt: null, anchors: { daily: null, weekly: null, weeklyPeriods: [] }, counts: null, byMarket: null, rows: [], nextCursor: null });

export async function handleStockScreener(request: Request, env: { DB?: ScreenerDatabase; DEPLOYMENT_TARGET?: string }, now = new Date()): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(prefix)) return null;
  if (env.DEPLOYMENT_TARGET !== "local" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return response({ reason: "local_only" }, 404);
  if (request.method !== "GET") return response({ reason: "method_not_allowed" }, 405);
  if (![`${prefix}/status`, `${prefix}/results`].includes(url.pathname)) return response({ reason: "route_not_allowed" }, 404);
  if (url.searchParams.get("version") === "3") return handleStockScreenerV3(url, env, now);
  let query: ReturnType<typeof parseScreenerQuery>;
  try {
    if (url.pathname.endsWith("/status") && url.search) throw new Error("invalid_query");
    query = parseScreenerQuery(url.searchParams);
  } catch (error) { return response({ reason: (error as Error).message }, 400); }
  if (!env.DB) return response({ ...pending("d1_unavailable"), state: "unavailable" }, 503);
  try {
    const snapshot = await readScreenerSnapshot(env.DB, query.cursor?.id, 2);
    if (!snapshot) {
      if (query.cursor) return response({ reason: "snapshot_expired" }, 409);
      const legacy = await readScreenerSnapshot(env.DB);
      return response(pending(legacy && legacy.metadata.version !== 2 ? "snapshot_version_pending" : "bootstrap_pending"));
    }
    if (snapshot.metadata.version !== 2) return query.cursor ? response({ reason: "snapshot_version_expired" }, 409) : response(pending("snapshot_version_pending"));
    const evaluated = screenStocks(snapshot.inputs, snapshot.metadata.anchors, query.criteria);
    const rows = evaluated.rows.filter((row) => row.verdict === query.resultState);
    const metric = (row: ScreenerRow): [bigint, bigint] | null => {
      if (query.sort === "volumeMultiple") return row.volume && row.volume.verdict !== "unknown" && row.currentVolume && row.previousVolume
        && row.currentVolume.shares !== null && row.previousVolume.shares !== null ? [BigInt(row.currentVolume.shares), BigInt(row.previousVolume.shares)] : null;
      if (query.sort === "turnover") return row.currentVolume?.turnoverNtd != null ? [BigInt(row.currentVolume.turnoverNtd), BigInt(1)] : null;
      if (query.sort === "holderStreak") return row.holder?.streakWeeks != null ? [BigInt(row.holder.streakWeeks), BigInt(1)] : null;
      if (!row.holder || row.holder.verdict === "unknown") return null;
      const change = row.holder.changesPpHundredths?.at(-1);
      return change !== undefined ? [BigInt(change), BigInt(1)] : null;
    };
    rows.sort((a, b) => {
      if (query.sort === "code") return a.code.localeCompare(b.code) * (query.direction === "desc" ? -1 : 1);
      const av = metric(a), bv = metric(b);
      // Unknown values always last, even descending. Code is a stable tie-break.
      if (av === null || bv === null) return av === bv ? a.code.localeCompare(b.code) : av === null ? 1 : -1;
      const left = av[0] * bv[1], right = bv[0] * av[1];
      const cmp = left < right ? -1 : left > right ? 1 : 0;
      return (query.direction === "desc" ? -cmp : cmp) || a.code.localeCompare(b.code);
    });
    const offset = query.cursor?.offset ?? 0;
    if (offset > rows.length) return response({ reason: "invalid_cursor" }, 400);
    const next = offset + query.limit;
    const stale = now.getTime() > Date.parse(snapshot.metadata.validThrough);
    const dailyRequired = query.criteria.volume.enabled || query.criteria.holder.enabled && query.criteria.holder.turnover.enabled;
    const noPeriods = (dailyRequired && !snapshot.metadata.anchors.daily)
      || (query.criteria.holder.enabled && !snapshot.metadata.anchors.weekly);
    const hasMissing = Object.values(evaluated.counts.missingByCondition).some((count) => count > 0);
    const sourcePending = (dailyRequired && snapshot.metadata.expectedSessionDate && snapshot.metadata.anchors.daily && snapshot.metadata.anchors.daily.current < snapshot.metadata.expectedSessionDate)
      || (query.criteria.holder.enabled && snapshot.metadata.expectedWeekDate && snapshot.metadata.anchors.weekly && snapshot.metadata.anchors.weekly.current < snapshot.metadata.expectedWeekDate);
    const state = stale ? "stale" : noPeriods || sourcePending ? "pending" : hasMissing ? "partial" : "ready";
    const payload: ScreenerResponse = {
      version: 2, state, reason: stale ? "snapshot_stale" : noPeriods ? "period_pending" : sourcePending ? "source_not_published" : "none",
      snapshotId: snapshot.id, createdAt: snapshot.createdAt, anchors: snapshot.metadata.anchors,
      universeRevision: snapshot.metadata.universeRevision, formulaVersion: "after-market-v2",
      criteriaFingerprint: criteriaFingerprint(query.criteria), expectedSessionDate: snapshot.metadata.expectedSessionDate ?? null,
      counts: evaluated.counts, byMarket: evaluated.byMarket,
      rows: url.pathname.endsWith("/status") ? [] : rows.slice(offset, next).map(row => resultRow(row, query.criteria)),
      nextCursor: !url.pathname.endsWith("/status") && next < rows.length ? btoa(JSON.stringify({ id: snapshot.id, offset: next, fingerprint: query.fingerprint })) : null,
    };
    return response(payload);
  } catch (error) {
    // Missing additive migration is a pending bootstrap, never an implicit DDL write on GET.
    if (/no such (?:table.*screener_|column.*schema_version)/.test(String(error))) return response(pending("schema_pending"));
    return response({ ...pending("snapshot_unavailable"), state: "unavailable" }, 503);
  }
}
