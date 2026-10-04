/** 既有 watcher 的獨立能力入口；沒有 Codex 排程、行情或服務生命週期操作。 */
import type { ScreenerDatabase } from '../apps/multiview/worker/stock-screener-repository.ts';
import { bollingerPublicationSchemaReady, readBollingerDailyProfile, readBollingerPublication } from '../apps/multiview/worker/stock-screener-v8-repository.ts';
import { publishBollingerDaily } from '../apps/multiview/worker/stock-screener-v8-publisher.ts';
import { prepareBollingerHistory, type BollingerPreparationOptions } from './stock-screener-bollinger-prepare.ts';
import { createBollingerSourceFetcher } from './stock-screener-bollinger-source-fetch.mjs';
import { planBollingerHistory, type VerifiedBollingerCalendar } from '../src/lib/stock-screener-bollinger-history.ts';
import { bollingerUniverseHash, validBollingerDate, type BollingerUniverseStock, type BollingerSourceReview } from '../src/lib/stock-screener-bollinger-source.ts';
import { SCREENER_V8_MAPPING_VERSION, SCREENER_V8_FORMULA_VERSION } from '../src/lib/stock-screener-v8.ts';
import { prepareBollingerCalendar, type BollingerCalendarFetcher } from './stock-screener-bollinger-calendar.ts';
import { prepareSelectedBollingerHistory } from './stock-screener-provider-prepare.mjs';
import { createScreenerBrokerPorts } from './stock-screener-broker-ports.mjs';
import { sourceSelectionSchemaReady } from './stock-screener-source-selection.mjs';
import type { ClosureFetcher } from './stock-screener-calendar-exceptions.ts';

/** 官方 session grid + 14:00；不猜週一至週五、不查來源或寫入。 */
export function bollingerScheduleDecision(calendar: VerifiedBollingerCalendar, now = new Date()) {
  if (calendar?.status !== 'verified' || !Number.isFinite(Date.parse(calendar.validThrough)) || Date.parse(calendar.validThrough) < now.getTime()
    || !/^[a-f0-9]{64}$/.test(calendar.authorityHash) || !Array.isArray(calendar.commonSessions) || !calendar.commonSessions.length
    || calendar.commonSessions.some((d, i) => !validBollingerDate(d) || i > 0 && d <= calendar.commonSessions[i - 1]!))
    return { state: 'pending' as const, reason: 'calendar_authority_pending', through: null, nextAttemptAt: null };
  const through = calendar.commonSessions.filter(d => Date.parse(`${d}T14:00:00+08:00`) <= now.getTime()).at(-1) ?? null;
  const next = calendar.commonSessions.find(d => Date.parse(`${d}T14:00:00+08:00`) > now.getTime());
  if (!next) return { state: 'pending' as const, reason: 'calendar_coverage_pending', through, nextAttemptAt: null };
  if (Date.parse(calendar.validThrough) < Date.parse(`${next}T14:00:00+08:00`))
    return { state: 'pending' as const, reason: 'calendar_coverage_pending', through, nextAttemptAt: null };
  return { state: through ? 'due' as const : 'waiting' as const, reason: through ? 'none' : 'source_not_closed', through,
    nextAttemptAt: new Date(`${next}T14:00:00+08:00`).toISOString() };
}
/** 首次到期檢查若已錯過既有五分鐘 slot，誠實記成晚啟動，不冒充 14:00 run。 */
export function bollingerScheduleTrigger(through: string, at: Date, hasCurrentProgress: boolean) {
  const today = new Date(at.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  return today !== through || !hasCurrentProgress && at.getTime() > Date.parse(`${through}T14:05:00+08:00`)
    ? 'late-boot' as const : 'watcher' as const;
}
export async function updateBollingerScheduled(db: ScreenerDatabase, options: {
  now?: () => Date; fetchReport?: BollingerPreparationOptions['fetchReport']; fetchCalendar?: BollingerCalendarFetcher; fetchNotices?: ClosureFetcher;
} = {}) {
  const now = options.now ?? (() => new Date());
  const deadline = now().getTime() + 15 * 60000;
  if (!await bollingerPublicationSchemaReady(db)) return { state: 'skipped', reason: 'schema_pending' };
  const profile = await readBollingerDailyProfile(db);
  if (!profile?.enabled) return { state: 'skipped', reason: 'profile_disabled' };
  const calendarResult = await prepareBollingerCalendar(db, { now, deadline, fetchCalendar: options.fetchCalendar, fetchNotices: options.fetchNotices });
  if (calendarResult.state !== 'ready') {
    const payload = JSON.stringify(calendarResult);
    await db.prepare(`INSERT INTO screener_bollinger_state(name,payload,updated_at) VALUES('v8',?,?)
      ON CONFLICT(name) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at WHERE payload<>excluded.payload`)
      .bind(payload, now().toISOString()).run();
    return calendarResult;
  }
  const calendar = calendarResult.calendar;
  const decision = bollingerScheduleDecision(calendar, now());
  if (decision.state !== 'due' || !decision.through) return decision;
  const through = decision.through;
  const universeRows = (await db.prepare(`SELECT revision,symbol,market,data_date,payload FROM screener_universe WHERE revision=
    (SELECT revision FROM screener_universe ORDER BY data_date DESC,revision DESC LIMIT 1) ORDER BY symbol`)
    .all<{ revision: string; symbol: string; market: string; data_date: string; payload: string }>()).results ?? [];
  if (!universeRows.length) return { state: 'pending', reason: 'universe_contract_pending' };
  // 正式 repository 保存 ScreenerInput envelope，不是裸 stock；fixture 必須沿用真實格式。
  // 不能只把 .stock 取出便宣稱 verified，需核對來源審查、revision 與 SQL identity。
  let originals;
  try {
    originals = universeRows.map(row => {
      const e = JSON.parse(row.payload), s = e?.stock;
      if (e?.review !== 'verified' || e.revision !== row.revision || e.sourceDate !== row.data_date
        || s?.symbol !== row.symbol || s.market !== row.market || s.kind !== 'ordinary' || !s.classificationVersion
        || e.provenance?.source !== row.market || !/^[a-f0-9]{64}$/.test(e.provenance?.payloadHash ?? ''))
        throw new Error('universe_contract_pending');
      return s;
    });
  } catch { return { state: 'pending', reason: 'universe_contract_pending' }; }
  const universe: BollingerUniverseStock[] = originals.map(r => ({ symbol: r.symbol, code: r.code, name: r.name, market: r.market, listingDate: r.listingDate ?? null }));
  const universeRevision = universeRows[0]!.revision, universeHash = await bollingerUniverseHash(universe);
  const sourcePolicy = await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE id='screener-bollinger-source-policy'").first<{ status: string; checkpoint: string }>();
  let useSourceSelections = false;
  try { useSourceSelections = sourcePolicy?.status === 'verified' && JSON.parse(sourcePolicy.checkpoint).policyVersion === 'bollinger-source-selection-v1'; }
  catch { return { state: 'pending', reason: 'source_policy_invalid' }; }
  if (useSourceSelections && !await sourceSelectionSchemaReady(db)) return { state: 'pending', reason: 'schema_pending' };
  const key = JSON.stringify([through, universeRevision, SCREENER_V8_MAPPING_VERSION, SCREENER_V8_FORMULA_VERSION, profile.revision]);
  const plan = planBollingerHistory(calendar, through, profile.criteria.bollSqueezeStages, String(profile.revision), now());
  const completed = await db.prepare("SELECT id,metadata FROM screener_bollinger_publications WHERE publication_key=? AND status='published'").bind(key).first<{ id: string; metadata: string }>();
  if (completed && !useSourceSelections && JSON.stringify(JSON.parse(completed.metadata).historySessions) !== JSON.stringify(plan.sessions))
    return { state: 'pending', reason: 'calendar_publication_review_required' };
  if (completed && !useSourceSelections) return { state: 'skipped', reason: 'session_complete_sleeping', effectiveSessionDate: through,
    snapshotId: completed.id, nextAttemptAt: decision.nextAttemptAt };
  if (useSourceSelections) {
    const published = await db.prepare(`SELECT id FROM screener_bollinger_publications WHERE status='published'
      AND json_extract(metadata,'$.effectiveSessionDate')=? AND json_extract(metadata,'$.universeRevision')=?
      AND json_extract(metadata,'$.universeHash')=?
      AND json_extract(metadata,'$.profileRevision')=? AND json_extract(metadata,'$.sourceMappingVersion') LIKE 'bollinger-source-selection-v1:%'
      AND json_extract(metadata,'$.historySessions')=?
      ORDER BY created_at DESC,id LIMIT 1`).bind(through, universeRevision, universeHash, profile.revision, JSON.stringify(plan.sessions)).first<{ id: string }>();
    if (published) {
      if (!await readBollingerPublication(db, published.id)) throw new Error('invalid_v8_publication');
      return { state: 'skipped', reason: 'session_complete_sleeping', effectiveSessionDate: through,
        snapshotId: published.id, nextAttemptAt: decision.nextAttemptAt };
    }
  }
  const reviewRow = await db.prepare("SELECT checkpoint FROM screener_runs WHERE id='screener-bollinger-source-review' AND status='verified'")
    .first<{ checkpoint: string }>();
  let reviews: Record<'TWSE' | 'TPEx', BollingerSourceReview>;
  try { reviews = reviewRow ? JSON.parse(reviewRow.checkpoint).reviews : {}; } catch { reviews = {} as typeof reviews; }
  const priorProgress = await db.prepare("SELECT payload FROM screener_bollinger_state WHERE name='v8'").first<{ payload: string }>();
  const trigger = bollingerScheduleTrigger(through, now(), !!priorProgress && JSON.parse(priorProgress.payload).expectedSessionDate === through);
  // 新來源政策須明確配置；不把舊官方 review 或 probe 擅自升級為備援展示許可。
  const reviewIds: Record<string,string> = {};
  if (useSourceSelections) for (const provider of ['official-twse','official-tpex','shioaji-daily-quotes']) {
    const r = await db.prepare('SELECT id FROM screener_source_reviews WHERE provider=? ORDER BY created_at DESC,id DESC LIMIT 1').bind(provider).first<{ id: string }>();
    if (r) reviewIds[provider] = r.id;
  }
  const preparation = useSourceSelections ? await prepareSelectedBollingerHistory({ db, calendar, through, criteria: profile.criteria.bollSqueezeStages,
    profileRevision: String(profile.revision), universeRevision, universe, universeEvidence: { status: 'verified', hash: universeHash, ordinary: true },
    reviewIds, now, trigger, maxDurationMs: Math.max(1, deadline - now().getTime()),
    fetchOfficial: options.fetchReport, ...createScreenerBrokerPorts({ db, now }) }) : await prepareBollingerHistory({ db, calendar, through, criteria: profile.criteria.bollSqueezeStages,
    profileRevision: String(profile.revision), universeRevision, universe, reviews, now, trigger,
    budget: { maxRequests: 2, maxBytes: 8 * 1024 * 1024, maxDurationMs: Math.max(1, deadline - now().getTime()) },
    fetchReport: options.fetchReport ?? createBollingerSourceFetcher() });
  const publication = preparation.state === 'complete' && now().getTime() < deadline ? await publishBollingerDaily({ db, calendar, through, universeRevision, universe, reviews,
    universeEvidence: { status: 'verified', hash: universeHash, ordinary: true }, now, trigger, useSourceSelections, maxDurationMs: deadline - now().getTime() }) : null;
  const available = (await db.prepare(`SELECT session_date FROM ${useSourceSelections ? 'screener_source_selections' : 'screener_bollinger_batches'} WHERE session_date IN
    (${plan.sessions.map(() => '?').join(',')}) AND status='complete' ${useSourceSelections ? 'AND universe_revision=?' : ''}
    GROUP BY session_date HAVING COUNT(DISTINCT market)=2`)
    .bind(...plan.sessions, ...(useSourceSelections ? [universeRevision] : [])).all<{ session_date: string }>()).results?.length ?? 0;
  const result = { state: publication?.state ?? (preparation.state === 'complete' ? 'pending' : preparation.state),
    reason: 'reason' in preparation ? preparation.reason : preparation.state === 'complete' && !publication ? 'run_deadline' : 'none',
    expectedSessionDate: through, trigger, profileRevision: profile.revision, requiredDays: plan.requiredDays, plannedDays: plan.plannedDays,
    availableDays: available,
    preparation, publication, nextAttemptAt: publication && ['published', 'unchanged'].includes(publication.state) ? decision.nextAttemptAt
      : 'nextAttemptAt' in preparation && preparation.nextAttemptAt ? preparation.nextAttemptAt : null };
  const payload = JSON.stringify(result), previous = await db.prepare("SELECT payload FROM screener_bollinger_state WHERE name='v8'").first<{ payload: string }>();
  if (previous?.payload !== payload) await db.prepare(`INSERT INTO screener_bollinger_state(name,payload,updated_at) VALUES('v8',?,?)
    ON CONFLICT(name) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`).bind(payload, now().toISOString()).run();
  return result;
}
