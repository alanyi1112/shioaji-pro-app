import type { ScreenerDatabase } from './stock-screener-repository.ts';
import { readBollingerPublication, readBollingerDailyProfile, saveBollingerDailyProfile,
  bollingerPublicationSchemaReady, readBollingerSourceConflicts, readBollingerSourceVolumeTolerances } from './stock-screener-v8-repository.ts';
import { queryBollingerSnapshot, type BollingerReadQuery } from '../../../src/lib/stock-screener-bollinger-query.ts';
import { validateCriteriaV8, type CriteriaV8, SCREENER_V8_FORMULA_VERSION, SCREENER_V8_MAPPING_VERSION } from '../../../src/lib/stock-screener-v8.ts';
import { screenerSearchV7 } from '../../../src/lib/stock-screener-api.ts';
import { handleStockScreenerV7 } from './stock-screener-v7-route.ts';
import { readBollingerLegacyJoin } from './stock-screener-v8-legacy-join.ts';
import { technicalEvidenceHash } from '../../../src/lib/stock-screener-technical-patterns.ts';

const json = (value: unknown, status = 200) => {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > 8 * 1024 * 1024) return Response.json({ version: 8, reason: 'response_too_large' }, { status: 503 });
  return new Response(body, { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
};
const pending = (reason: string) => ({ version: 8, state: 'pending', reason, snapshotId: null,
  formulaVersion: SCREENER_V8_FORMULA_VERSION, sourceMappingVersion: SCREENER_V8_MAPPING_VERSION,
  expectedSessionDate: null, effectiveSessionDate: null, rows: [], nextCursor: null });
export function parseBollingerHttpQuery(params: URLSearchParams) {
  const allowed = ['version', 'criteria', 'sort', 'direction', 'resultState', 'stage', 'limit', 'cursor', 'snapshotId'];
  if (params.toString().length > 16384 || params.get('version') !== '8'
    || [...params.keys()].some(k => !allowed.includes(k) || params.getAll(k).length !== 1)) throw new Error('invalid_query');
  let criteria: CriteriaV8;
  try { criteria = JSON.parse(params.get('criteria') ?? 'null'); } catch { throw new Error('invalid_query'); }
  if (!validateCriteriaV8(criteria)) throw new Error('invalid_query');
  const limit = params.get('limit') ?? '50', sort = params.get('sort') ?? 'code', direction = params.get('direction') ?? 'asc', state = params.get('resultState') ?? 'matched';
  if (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100
    || !['code', 'bbw', 'percentilePosition', 'b', 'breakoutVolumeRatio', 'momentum'].includes(sort)
    || !['asc', 'desc'].includes(direction) || !['matched', 'unknown', 'notMatched', 'all'].includes(state)
    || params.has('stage') && !['all', 'compressing', 'preparing', 'breakout', 'unknown', 'notMatched'].includes(params.get('stage')!)
    || params.has('snapshotId') && !/^[\w-]{36}$/.test(params.get('snapshotId')!)) throw new Error('invalid_query');
  return { criteria, query: { criteria: criteria.bollSqueezeStages, sort: { key: sort, direction }, state, limit: Number(limit),
    ...(params.has('stage') ? { stage: params.get('stage')! } : {}),
    ...(params.has('cursor') ? { cursor: params.get('cursor')! } : {}) } as BollingerReadQuery,
    snapshotId: params.get('snapshotId') ?? undefined };
}
/** Read-only，不根據籌碼 readiness 阻擋純價量結果。 */
export async function handleStockScreenerV8(request: Request, env: { DB?: ScreenerDatabase }, now = new Date()) {
  const url = new URL(request.url), status = url.pathname.endsWith('/status'), profileRoute = url.pathname.endsWith('/daily-profile');
  if (profileRoute) {
    if (url.searchParams.toString() !== 'version=8') return json({ reason: 'invalid_query' }, 400);
    if (!env.DB) return json(pending('local_data_service_unavailable'), 503);
    if (request.method === 'GET') {
      try {
        if (!await bollingerPublicationSchemaReady(env.DB)) return json(pending('schema_pending'), 503);
        return json({ version: 8, profile: await readBollingerDailyProfile(env.DB) });
      } catch { return json(pending('invalid_daily_profile'), 503); }
    }
    if (request.method !== 'PUT') return json({ reason: 'method_not_allowed' }, 405);
    const forbidden = ['forwarded', 'via', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'cf-connecting-ip'];
    if (request.headers.get('origin') && request.headers.get('origin') !== url.origin
      || request.headers.get('sec-fetch-site') === 'cross-site' || forbidden.some(h => request.headers.has(h))) return json({ reason: 'same_origin_required' }, 403);
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return json({ reason: 'json_required' }, 415);
    try {
      // byte-bounded streaming body，不能先 request.text() 無界配置。
      const reader = request.body?.getReader(); if (!reader) throw new Error('invalid_daily_profile');
      const chunks: Uint8Array[] = []; let bytes = 0; let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('body_timeout')), 3000); });
      try { for (;;) { const r = await Promise.race([reader.read(), timeout]); if (r.done) break; bytes += r.value.byteLength;
        if (bytes > 16384) throw new Error('payload_too_large'); chunks.push(r.value); } }
      finally { clearTimeout(timer!); void reader.cancel().catch(() => {}); }
      const joined = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
      const value = JSON.parse(new TextDecoder().decode(joined));
      return json({ version: 8, profile: await saveBollingerDailyProfile(env.DB, value, now), sourceRequests: 0 });
    } catch (e) { const reason = e instanceof Error ? e.message : 'invalid_daily_profile';
      return json({ reason: ['profile_revision_conflict', 'schema_pending', 'payload_too_large'].includes(reason) ? reason : 'invalid_daily_profile' },
        reason === 'profile_revision_conflict' ? 409 : reason === 'schema_pending' ? 503 : reason === 'payload_too_large' ? 413 : 400); }
  }
  let parsed: ReturnType<typeof parseBollingerHttpQuery> | null = null;
  try {
    if (status) { if (url.searchParams.toString() !== 'version=8') throw new Error('invalid_query'); }
    else parsed = parseBollingerHttpQuery(url.searchParams);
  } catch { return json({ reason: 'invalid_query' }, 400); }
  if (!status && parsed && !parsed.criteria.bollSqueezeStages.enabled) {
    const { bollSqueezeStages: _, ...criteria } = parsed.criteria;
    const projected = new URL(url); projected.search = screenerSearchV7({ criteria, sort: 'code', direction: parsed.query.sort.direction,
      resultState: parsed.query.state === 'matched' ? 'pass' : parsed.query.state === 'notMatched' ? 'fail' : 'unknown' });
    projected.searchParams.set('limit', String(parsed.query.limit));
    return handleStockScreenerV7(projected, env, now);
  }
  if (!env.DB) return json(pending('local_data_service_unavailable'), 503);
  try {
    if (!await bollingerPublicationSchemaReady(env.DB)) return json(pending('schema_pending'));
    const snapshot = await readBollingerPublication(env.DB, parsed?.snapshotId);
    const daily = await readBollingerDailyProfile(env.DB);
    const state = await env.DB.prepare("SELECT payload FROM screener_bollinger_state WHERE name='v8'").first<{ payload: string }>();
    const progress = state ? JSON.parse(state.payload) : null;
    if (!snapshot) return json({ ...pending('v8_preparation_pending'), profile: daily, preparation: progress,
      expectedSessionDate: progress?.expectedSessionDate ?? null }, parsed?.snapshotId ? 409 : 200);
    const expected = progress?.expectedSessionDate ?? snapshot.effectiveSessionDate;
    const stale = expected > snapshot.effectiveSessionDate || Date.parse(snapshot.metadata.validThrough) < now.getTime();
    const envelope = { version: 8, state: stale ? 'stale' : 'ready', reason: stale ? 'new_session_pending' : 'none',
      formulaVersion: SCREENER_V8_FORMULA_VERSION, sourceMappingVersion: snapshot.metadata.sourceMappingVersion,
      ...(snapshot.metadata.sourceEvidence ? { sourceEvidence: snapshot.metadata.sourceEvidence } : {}),
      sourceConflicts: await readBollingerSourceConflicts(env.DB, snapshot.metadata.sourceEvidence),
      sourceVolumeTolerances: await readBollingerSourceVolumeTolerances(env.DB, snapshot.metadata.sourceEvidence),
      expectedSessionDate: expected, effectiveSessionDate: snapshot.effectiveSessionDate, profile: daily, preparation: progress,
      snapshotId: snapshot.id, universeRevision: snapshot.universeRevision, createdAt: snapshot.createdAt,
      canUseResults: !stale, publishedProfileRevision: snapshot.metadata.profileRevision };
    if (status) return json({ ...envelope, counts: snapshot.metadata.counts, rows: [], nextCursor: null });
    const { bollSqueezeStages: _, ...legacy } = parsed!.criteria;
    const join = await readBollingerLegacyJoin(env.DB, legacy, snapshot.effectiveSessionDate, snapshot.universeRevision, snapshot.rows.map(r => r.symbol));
    const result = await queryBollingerSnapshot(snapshot, { ...parsed!.query, ...(join ? { combination: { mode: parsed!.criteria.mode,
      fingerprint: await technicalEvidenceHash({ legacy, snapshotId: join.snapshotId }), rows: join.rows } } : {}) });
    return json({ ...envelope, ...result, state: result.state === 'history_pending' ? 'history_pending' : envelope.state,
      reason: result.state === 'history_pending' ? 'history_pending' : envelope.reason,
      canUseResults: result.state === 'ready' && !stale,
      legacyJoin: join ? { snapshotId: join.snapshotId, reason: join.reason, enabled: join.enabled } : null });
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'invalid_v8_publication';
    return json({ ...pending(reason), state: 'unavailable' }, reason.includes('cursor') ? 409 : 503);
  }
}
