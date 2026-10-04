/** v9 GET-only，不載入 publisher、不補資料、不保存 profile。 */
import type { ScreenerDatabase } from './stock-screener-repository.ts';
import { readCandlestickPublication, candlestickSchemaReady } from './stock-screener-v9-repository.ts';
import { readBollingerLegacyJoin } from './stock-screener-v8-legacy-join.ts';
import { readBollingerPublication } from './stock-screener-v8-repository.ts';
import { handleStockScreenerV8 } from './stock-screener-v8-route.ts';
import { queryCandlestickSnapshot, type CandlestickReadQuery } from '../../../src/lib/stock-screener-candlestick-query.ts';
import { validateCriteriaV9, CANDLESTICK_FORMULA_VERSION, CANDLESTICK_HISTORY_CAPABILITY, type CriteriaV9 } from '../../../src/lib/stock-screener-v9.ts';
import { CANDLESTICK_CATALOG_VERSION } from '../../../src/lib/stock-screener-candlestick-catalog.ts';
import { evaluateBollingerStages } from '../../../src/lib/stock-screener-v8.ts';
import { technicalEvidenceHash } from '../../../src/lib/stock-screener-technical-patterns.ts';
import type { Verdict } from '../../../src/lib/stock-screener-domain.ts';

const pending = (reason: string) => ({ version: 9, state: 'pending', reason, snapshotId: null, canUseResults: false,
  formulaVersion: CANDLESTICK_FORMULA_VERSION, capability: CANDLESTICK_HISTORY_CAPABILITY, catalogVersion: CANDLESTICK_CATALOG_VERSION,
  effectiveSessionDate: null, expectedSessionDate: null, counts: null, rows: [], nextCursor: null });
const json = (value: unknown, status = 200) => {
  const body = JSON.stringify(value), oversized = new TextEncoder().encode(body).byteLength > 8 * 1024 * 1024;
  return new Response(oversized ? JSON.stringify(pending('response_too_large')) : body, { status: oversized ? 503 : status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
};
export function parseCandlestickHttpQuery(p: URLSearchParams): { query: CandlestickReadQuery; snapshotId?: string } {
  const allowed = ['version', 'criteria', 'sort', 'direction', 'resultState', 'limit', 'cursor', 'snapshotId'];
  if (p.toString().length > 16384 || p.get('version') !== '9' || [...p.keys()].some(k => !allowed.includes(k) || p.getAll(k).length !== 1)) throw new Error('invalid_v9_query');
  let criteria: CriteriaV9; try { criteria = JSON.parse(p.get('criteria') ?? 'null'); } catch { throw new Error('invalid_v9_query'); }
  const limit = p.get('limit') ?? '50', direction = p.get('direction') ?? 'asc', resultState = p.get('resultState') ?? 'pass';
  if (!validateCriteriaV9(criteria) || p.has('sort') && p.get('sort') !== 'code' || !['asc', 'desc'].includes(direction)
    || !['pass', 'fail', 'unknown'].includes(resultState) || !/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100
    || p.has('snapshotId') && !/^[a-f0-9-]{36}$/.test(p.get('snapshotId')!)
    || p.has('cursor') && !/^[A-Za-z0-9_-]{1,512}$/.test(p.get('cursor')!)) throw new Error('invalid_v9_query');
  return { query: { criteria, direction: direction as 'asc' | 'desc', resultState: resultState as Verdict,
    limit: Number(limit), ...(p.has('cursor') ? { cursor: p.get('cursor')! } : {}) }, snapshotId: p.get('snapshotId') ?? undefined };
}
export async function handleStockScreenerV9(request: Request, env: { DB?: ScreenerDatabase }, now = new Date()) {
  if (request.method !== 'GET') return json({ reason: 'method_not_allowed' }, 405);
  const url = new URL(request.url), status = url.pathname.endsWith('/status');
  let parsed: ReturnType<typeof parseCandlestickHttpQuery> | null = null;
  try {
    if (status) { if (url.search !== '?version=9') throw new Error('invalid_v9_query'); }
    else parsed = parseCandlestickHttpQuery(url.searchParams);
  } catch { return json({ reason: 'invalid_v9_query' }, 400); }
  if (parsed && !parsed.query.criteria.candlestickReversal.enabled) {
    const { candlestickReversal: _, ...criteria } = parsed.query.criteria;
    const projected = new URL(url); projected.search = new URLSearchParams({ version: '8', criteria: JSON.stringify(criteria), sort: 'code',
      direction: parsed.query.direction, resultState: parsed.query.resultState === 'pass' ? 'matched' : parsed.query.resultState === 'fail' ? 'notMatched' : 'unknown',
      limit: String(parsed.query.limit), ...(parsed.query.cursor ? { cursor: parsed.query.cursor } : {}), ...(parsed.snapshotId ? { snapshotId: parsed.snapshotId } : {}) }).toString();
    return handleStockScreenerV8(new Request(projected), env, now);
  }
  if (!env.DB) return json(pending('local_data_service_unavailable'), 503);
  try {
    if (!await candlestickSchemaReady(env.DB)) return json(pending('v9_schema_pending'));
    const snapshot = await readCandlestickPublication(env.DB, parsed?.snapshotId);
    const record = await env.DB.prepare("SELECT payload FROM screener_candlestick_state WHERE name='v9'").first<{ payload: string }>();
    const preparation = record ? JSON.parse(record.payload) : null;
    if (!snapshot) return json({ ...pending('v9_preparation_pending'), preparation }, parsed?.snapshotId ? 409 : 200);
    const m = snapshot.metadata, expected = preparation?.expectedSessionDate ?? m.effectiveSessionDate;
    const stale = expected > m.effectiveSessionDate || Date.parse(m.validThrough) <= now.getTime();
    const envelope = { version: 9, state: stale ? 'stale' : 'ready', reason: stale ? 'new_session_pending' : 'none',
      snapshotId: snapshot.id, createdAt: snapshot.createdAt, formulaVersion: m.formulaVersion, capability: m.capability,
      catalogVersion: CANDLESTICK_CATALOG_VERSION, sourceMappingVersion: m.sourceMappingVersion, sourceEvidence: m.sourceEvidence,
      calendarHash: m.calendarHash, sourceHashes: m.sourceHashes, rowsHash: m.rowsHash, universeHash: m.universeHash,
      universeRevision: m.universeRevision, expectedSessionDate: expected, effectiveSessionDate: m.effectiveSessionDate,
      canUseResults: !stale, preparation };
    if (status) return json({ ...envelope, total: m.total, rows: [], nextCursor: null });
    const { candlestickReversal: _, bollSqueezeStages, ...legacy } = parsed!.query.criteria;
    const symbols = snapshot.rows.map(r => r.symbol);
    const join = await readBollingerLegacyJoin(env.DB, legacy, snapshot.through, snapshot.universeRevision, symbols);
    let bollinger: Record<string, { verdict: Verdict; evidence: unknown }> | undefined, bollingerJoin: { snapshotId: string | null; reason: string } | null = null;
    if (bollSqueezeStages.enabled) {
      bollinger = Object.fromEntries(symbols.map(s => [s, { verdict: 'unknown' as Verdict, evidence: null }]));
      bollingerJoin = { snapshotId: null, reason: 'same_session_bollinger_pending' };
      let b;
      try { b = await readBollingerPublication(env.DB); }
      catch { b = null; bollingerJoin.reason = 'same_session_bollinger_invalid'; }
      if (b && b.effectiveSessionDate === snapshot.through && b.universeRevision === snapshot.universeRevision
        && b.metadata.universeHash === snapshot.universeHash && b.rows.length === symbols.length && b.rows.every(r => symbols.includes(r.symbol))) {
        bollinger = Object.fromEntries(await Promise.all(b.rows.map(async r => { const e = await evaluateBollingerStages(r.features, bollSqueezeStages);
          return [r.symbol, { verdict: e.branchVerdict, evidence: e }]; })));
        bollingerJoin = { snapshotId: b.id, reason: 'none' };
      }
    }
    const combination = join || bollinger ? { fingerprint: await technicalEvidenceHash({ legacy: join?.snapshotId ?? null,
      legacyReason: join?.reason ?? null, bollinger: bollingerJoin }), ...(join ? { legacy: join.rows } : {}), ...(bollinger ? { bollinger } : {}) } : undefined;
    return json({ ...envelope, ...await queryCandlestickSnapshot(snapshot, parsed!.query, combination),
      legacyJoin: join ? { snapshotId: join.snapshotId, reason: join.reason, enabled: join.enabled } : null, bollingerJoin });
  } catch (error) {
    const reason = error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : 'invalid_v9_publication';
    return json({ ...pending(reason), state: 'unavailable' }, reason.includes('cursor') ? 409 : 503);
  }
}
