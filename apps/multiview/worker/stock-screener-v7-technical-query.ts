/** 純 v7 技術條件只依賴正式 v4 OHLCV；不發布快照、不讀取未選用的籌碼。 */
import { screenStocks, effectiveCriteria, combineVerdicts, type ScreenerRow } from '../../../src/lib/stock-screener-domain.ts';
import { readTechnicalV7Cache } from './stock-screener-v7-technical-cache.ts';
import { evaluateTechnicalCriteriaV7, SCREENER_V7_FORMULA_VERSION,
  DEFAULT_CRITERIA_V7, type CriteriaV7 } from '../../../src/lib/stock-screener-v7.ts';
import { SCREENER_OHLCV_V4_MAPPING_VERSION } from '../../../src/lib/stock-screener-ohlcv.ts';
import { readScreenerV4Snapshot } from './stock-screener-v4-repository.ts';
import { readScreenerFreshness } from './stock-screener-session-readiness.ts';
import { baseResult } from './stock-screener-v3-route.ts';
import type { ScreenerDatabase } from './stock-screener-repository.ts';
import type { parseScreenerV7Query } from './stock-screener-v7-route.ts';
import type { ScreenerResultRowV7 } from '../../../src/lib/stock-screener-api.ts';

const keys = ['bollPosition', 'rsiCross', 'kdCross', 'macdSignal'] as const;
export function isTechnicalOnlyV7(criteria: CriteriaV7) {
  return keys.some(k => criteria[k].enabled) && Object.entries(criteria).every(([k, v]) =>
    k === 'mode' || keys.includes(k as typeof keys[number]) || !v || typeof v !== 'object' || !v.enabled);
}
const emptyCounts = () => ({ total: 0, evaluated: 0, matched: 0, notMatched: 0, unknown: 0,
  missingByCondition: Object.fromEntries(['volume-multiple', 'large-holder-weekly-pp',
    ...Object.keys(DEFAULT_CRITERIA_V7).filter(k => !['mode', 'volume', 'holder'].includes(k))
      .map(k => k === 'bollReversal' ? 'boll-reversal' : k)].map(k => [k, 0])) });

export async function queryTechnicalOnlyV7(db: ScreenerDatabase, query: ReturnType<typeof parseScreenerV7Query>,
  status: boolean, now: Date) {
  if (!isTechnicalOnlyV7(query.criteria)) throw new Error('technical_only_required');
  const snapshot = await readScreenerV4Snapshot(db, query.cursor?.snapshotId);
  if (!snapshot) return null;
  if (snapshot.inputs.length > 10000) throw new Error('technical_query_budget_exceeded');
  const date = snapshot.metadata.effectiveSessionDate;
  const freshness = await readScreenerFreshness(db, date);
  const pending = freshness.pending || !!freshness.expectedSessionDate && date < freshness.expectedSessionDate;
  const stale = now.getTime() > Date.parse(snapshot.metadata.validThrough) || pending;
  const cache = await readTechnicalV7Cache(db, snapshot);
  if (!cache) return null;
  const counts = emptyCounts(), byMarket = { TWSE: emptyCounts(), TPEx: emptyCounts() };
  const coverage = cache.manifest.coverage;
  const compatible = { ...query.criteria, volume: { ...query.criteria.volume, enabled: true } };
  const base = screenStocks(snapshot.inputs, snapshot.metadata.anchors, effectiveCriteria(compatible)).rows;
  const rows: ScreenerResultRowV7[] = [];
  for (let i = 0; i < snapshot.inputs.length; i++) {
    const input = snapshot.inputs[i]!;
    const feature = cache.features.get(input.symbol)!;
    const outcomes = evaluateTechnicalCriteriaV7(feature, query.criteria);
    const selected = keys.filter(k => query.criteria[k].enabled).map(k => outcomes[k].verdict);
    const verdict = combineVerdicts(selected, query.criteria.mode);
    for (const summary of [counts, byMarket[input.market]]) {
      summary.total++;
      if (verdict === 'unknown') summary.unknown++;
      else { summary.evaluated++; if (verdict === 'pass') summary.matched++; else summary.notMatched++; }
      for (const k of keys) if (query.criteria[k].enabled && outcomes[k].verdict === 'unknown') summary.missingByCondition[k]!++;
    }
    if (verdict === query.resultState) rows.push({ ...baseResult({ ...base[i]!, verdict } as ScreenerRow, query.criteria),
      technical: { fractal: null, bollReversal: null },
      technicalV4: { ma: null, divergence: null, evidenceHash: input.technicalV4.evidenceHash },
      chipV5: null, institutionalV6: null,
      technicalV7: { outcomes, evidenceHash: feature.evidenceHash, through: feature.through } });
  }
  const metric = (r: typeof rows[number]): number | null => {
    const k = keys.find(k => query.criteria[k].enabled && query.criteria[k].volumeConfirmation.enabled);
    if (query.sort === 'volumeRatio') return k ? r.technicalV7.outcomes[k].volumeConfirmation.ratio : null;
    const o = r.technicalV7.outcomes;
    if (query.sort === 'volumeMultiple') return r.volume.multiple;
    if (query.sort === 'turnover') return r.volume.turnover.ntd === null ? null : Number(r.volume.turnover.ntd);
    if (query.sort === 'holderChange') return r.holder.changePp;
    if (query.sort === 'holderStreak') return r.holder.streakWeeks;
    if (query.sort === 'bollDistance') { const a = o.bollPosition.signal.actual as { close?: number; current?: { middle: number } };
      return a?.close !== undefined && a.current ? Math.abs(a.close - a.current.middle) : null; }
    if (query.sort === 'rsiFast') return (o.rsiCross.signal.actual as { current?: { fast: number } })?.current?.fast ?? null;
    if (query.sort === 'kdFast') return (o.kdCross.signal.actual as { current?: { fast: number } })?.current?.fast ?? null;
    if (query.sort === 'macdDif') return (o.macdSignal.signal.actual as { current?: { dif: number } })?.current?.dif ?? null;
    return null;
  };
  rows.sort((a, b) => { const x = metric(a), y = metric(b);
    return (x === null ? y === null ? 0 : 1 : y === null ? -1 : (x - y) * (query.direction === 'asc' ? 1 : -1))
      || a.code.localeCompare(b.code) * (query.sort === 'code' && query.direction === 'desc' ? -1 : 1) || a.symbol.localeCompare(b.symbol); });
  const offset = query.cursor?.offset ?? 0, next = offset + query.limit;
  if (offset > rows.length) throw new Error('invalid_cursor');
  return { version: 7, queryDataScope: 'technical-only', sourceSnapshotVersion: 4,
    state: pending ? 'pending' : stale ? 'stale' : counts.unknown ? 'partial' : 'ready',
    reason: pending ? freshness.reason : stale ? 'snapshot_stale' : 'none', snapshotId: snapshot.id,
    universeRevision: snapshot.metadata.universeRevision, formulaVersion: SCREENER_V7_FORMULA_VERSION,
    sourceMappingVersion: SCREENER_OHLCV_V4_MAPPING_VERSION, criteriaFingerprint: query.criteriaKey,
    expectedSessionDate: freshness.expectedSessionDate ?? snapshot.metadata.expectedSessionDate, effectiveSessionDate: date,
    sessionReadiness: freshness.readiness, createdAt: snapshot.createdAt, anchors: snapshot.metadata.anchors,
    technicalAnchors: snapshot.metadata.technicalAnchors, counts, byMarket, preparation: null,
    chipCoverage: null, institutionalCoverage: null, technicalCoverage: coverage,
    rows: status || stale ? [] : rows.slice(offset, next),
    nextCursor: !status && !stale && next < rows.length
      ? btoa(JSON.stringify({ version: 7, snapshotId: snapshot.id, offset: next, fingerprint: query.fingerprint })) : null };
}
