/** 只由背景 watcher 呼叫；官方／備援合計有界。沒有瀏覽器、登入、訂閱或 lifecycle 操作。 */
import { randomUUID } from 'node:crypto';
import { prepareBollingerHistory } from './stock-screener-bollinger-prepare.ts';
import { planBollingerHistory } from '../src/lib/stock-screener-bollinger-history.ts';
import { bollingerUniverseHash, validateBollingerSourceReview } from '../src/lib/stock-screener-bollinger-source.ts';
import { technicalEvidenceHash } from '../src/lib/stock-screener-technical-patterns.ts';
import { createDailyQuotesFetcher, loadDailyQuotesBatch, validDailyQuotesReview, DAILY_QUOTES_MAPPING, DAILY_QUOTES_URL } from './stock-screener-shioaji-daily-quotes.mjs';
import { createBollingerSourceFetcher } from './stock-screener-bollinger-source-fetch.mjs';
import { SOURCE_POLICY_VERSION, sourceSelectionSchemaReady, readSourceReview, readSourceSelection, freezeSourceSelection, sourceWindowMapping } from './stock-screener-source-selection.mjs';

export async function prepareSelectedBollingerHistory(options) {
    const { db, calendar, through, criteria, profileRevision, universeRevision, universe, reviewIds = {}, safety, admission,
        signal, trigger = 'watcher', now = () => new Date(), maxDurationMs = 15 * 60000 } = options;
    if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > 15 * 60000) throw new Error('invalid_source_budget');
    let plan;
    try { plan = planBollingerHistory(calendar, through, criteria, profileRevision, now()); }
    catch (e) { if (e.message === 'calendar_authority_pending') return { state: 'pending', reason: e.message, requested: 0 };
        throw e; }
    if (plan.state !== 'planned') return { state: 'pending', reason: 'history_pending', requested: 0, plan };
    if (!await sourceSelectionSchemaReady(db)) return { state: 'pending', reason: 'schema_pending', requested: 0, plan };
    const universeHash = await bollingerUniverseHash(universe), start = now(), deadline = start.getTime() + maxDurationMs;
    const reviews = {};
    for (const provider of ['official-twse','official-tpex','shioaji-daily-quotes']) {
        if (reviewIds[provider]) { const record = await readSourceReview(db, reviewIds[provider], now());
            if (record.provider !== provider) throw new Error('invalid_source_review'); reviews[provider] = record; }
    }
    const gate = { calendarStatus: calendar.status, authorityHash: calendar.authorityHash, validThrough: calendar.validThrough,
        commonSessions: calendar.commonSessions, universeStatus: options.universeEvidence?.status };
    if (options.universeEvidence?.hash !== universeHash || options.universeEvidence?.ordinary !== true || gate.universeStatus !== 'verified')
        return { state: 'pending', reason: 'universe_contract_pending', requested: 0, plan };
    const owner = randomUUID(), runId = randomUUID(), lease = 'screener-bollinger-source-lease';
    await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,lease_until,updated_at) VALUES(?,?,'running',?,?,?)
        ON CONFLICT(id) DO UPDATE SET checkpoint=excluded.checkpoint,lease_until=excluded.lease_until,status='running',updated_at=excluded.updated_at
        WHERE lease_until IS NULL OR lease_until<=?`).bind(lease, lease, owner, new Date(deadline).toISOString(), start.toISOString(), start.toISOString()).run();
    const owned = async () => { const r = await db.prepare('SELECT checkpoint,lease_until FROM screener_runs WHERE id=?').bind(lease).first();
        return r?.checkpoint === owner && Date.parse(r.lease_until) > now().getTime(); };
    if (!await owned()) return { state: 'pending', reason: 'lease_busy', requested: 0, plan };
    const controller = new AbortController();
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, maxDurationMs); if (signal?.aborted) abort();
    const guard = async () => {
        if (controller.signal.aborted || now().getTime() >= deadline) throw new Error('run_deadline');
        if (!await owned()) throw new Error('lease_lost');
        if (Date.parse(calendar.validThrough) <= now().getTime()) throw new Error('source_authority_pending');
    };
    let requested = 0, bytes = 0, processed = 0, reason = null, nextAttemptAt = null;
    const receipt = (status, payload) => db.prepare('INSERT INTO screener_bollinger_receipts(id,target_key,run_id,status,payload,created_at) VALUES(?,NULL,?,?,?,?)')
        .bind(randomUUID(), runId, status, JSON.stringify({ sourcePolicyVersion: SOURCE_POLICY_VERSION, through, trigger, universeRevision,
            requested, bytes, ...payload }), now().toISOString()).run();
    const wrapped = (fetcher, bound) => async (...args) => {
        await guard(); if (requested >= 2 || bytes + bound > 8 * 1024 ** 2) throw new Error('run_budget');
        requested++;
        try { const r = await fetcher(...args); const size = Buffer.byteLength(r.text ?? ''); bytes += size;
            if (size > bound || bytes > 8 * 1024 ** 2) throw new Error('invalid_source_size'); return r;
        } catch (e) { if (!e.message?.startsWith('invalid_source_size')) bytes += bound;
            throw e;
        }
    };
    const officialFetcher = wrapped(options.fetchOfficial ?? createBollingerSourceFetcher(undefined, { maxBytes: 4 * 1024 ** 2 }), 4 * 1024 ** 2);
    const brokerFetcher = wrapped(options.fetchDailyQuotes ?? createDailyQuotesFetcher(), 2 * 1024 ** 2);
    const keyFor = (market, date) => technicalEvidenceHash({ policyVersion: SOURCE_POLICY_VERSION, universeRevision, market, sessionDate: date });
    const freezeBroker = async (market, date, sourceReview, switchReason, failures) => {
        const cacheKey = `${sourceReview.review.mappingVersion}|${date}`;
        const cache = await db.prepare('SELECT * FROM screener_daily_quotes_cache WHERE cache_key=?').bind(cacheKey).first();
        if (cache?.status !== 'complete') return null;
        const fetched = await db.prepare("SELECT id FROM screener_daily_quotes_receipts WHERE cache_key=? AND status='complete' ORDER BY created_at,id LIMIT 1")
            .bind(cacheKey).first();
        if (!fetched) throw new Error('source_receipt_missing');
        await guard(); return freezeSourceSelection({ db, universeRevision, universe, market, sessionDate: date, gate,
            provider: 'shioaji-daily-quotes', reviewId: sourceReview.id, response: { sourceUrl: DAILY_QUOTES_URL,
                status: 200, text: cache.response_text, fetchedAt: cache.fetched_at }, fetchReceiptId: fetched.id,
            switchReason, officialFailureReceiptIds: failures, now, signal: controller.signal });
    };
    await receipt('provider_run_started', { maxRequests: 2, maxBytes: 8 * 1024 ** 2, deadline: new Date(deadline).toISOString() });
    try {
        for (const target of plan.targets) {
            await guard(); const key = await keyFor(target.market, target.sessionDate);
            const existing = await db.prepare('SELECT status,manifest FROM screener_source_selections WHERE selection_key=?').bind(key).first();
            if (existing?.status === 'complete') { const saved = await readSourceSelection(db, key);
                if (saved.manifest.universeHash !== universeHash) throw new Error('invalid_universe_revision'); processed++; continue; }
            const provider = target.market === 'TWSE' ? 'official-twse' : 'official-tpex';
            let sourceReview = reviews[provider], batch = await db.prepare('SELECT * FROM screener_bollinger_batches WHERE target_key=?').bind(target.key).first();
            if (existing) { const m = JSON.parse(existing.manifest);
                // 中途 staging 必須續原來源／review，不因官方恢復換掉 manifest。
                sourceReview = await readSourceReview(db, m.reviewId, now());
                if (m.provider === 'shioaji-daily-quotes') {
                    const recovered = await freezeBroker(target.market, target.sessionDate, sourceReview, m.switchReason, m.officialFailures.map(f => f.id));
                    if (recovered?.state === 'complete') { processed++; continue; }
                }
            }
            const officialValid = sourceReview?.provider === provider && validateBollingerSourceReview(sourceReview.review, target.market, now());
            if (officialValid && (!batch?.report || batch.status !== 'complete') && requested < 2) {
                await prepareBollingerHistory({ db, calendar, through, criteria, profileRevision, universeRevision, universe,
                    reviews: { [target.market]: sourceReview.review }, targetKeys: [target.key], trigger, now,
                    budget: { maxRequests: 1, maxBytes: 4 * 1024 ** 2, maxDurationMs: Math.max(1, deadline - now().getTime()) }, fetchReport: officialFetcher });
                batch = await db.prepare('SELECT * FROM screener_bollinger_batches WHERE target_key=?').bind(target.key).first();
            }
            if (officialValid && batch?.status === 'complete' && batch.report) {
                const saved = JSON.parse(batch.report);
                const fetched = await db.prepare(`SELECT id FROM screener_bollinger_receipts WHERE target_key=? AND status IN ('complete','source_verified')
                    ORDER BY CASE status WHEN 'complete' THEN 0 ELSE 1 END,created_at DESC,id LIMIT 1`).bind(target.key).first();
                if (!fetched) throw new Error('source_receipt_missing');
                await guard(); const frozen = await freezeSourceSelection({ db, universeRevision, universe, market: target.market,
                    sessionDate: target.sessionDate, provider, gate, reviewId: sourceReview.id, response: saved.response,
                    storedOfficialReport: saved, fetchReceiptId: fetched.id, now, signal: controller.signal });
                if (frozen.state === 'complete') { processed++; continue; }
            }
            const backup = reviews['shioaji-daily-quotes'];
            if (!backup || !validDailyQuotesReview(backup.review, now())) { reason ??= 'source_contract_pending'; continue; }
            const local = new Date(now().getTime() + 8 * 3600000).toISOString(), hhmm = local.slice(11,16);
            if (calendar.commonSessions.includes(local.slice(0,10)) && hhmm >= '08:30' && hhmm < '14:00') {
                reason ??= 'broker_intraday_reserved'; continue;
            }
            // 官方 review 成立但沒有開始／完成合法嘗試，不以「run 預算不足」冒充官方失敗。
            const failureRows = (await db.prepare(`SELECT id,payload FROM screener_bollinger_receipts WHERE target_key=? AND status IN ('failed','partial')
                ORDER BY created_at DESC,id LIMIT 18`).bind(target.key).all()).results ?? [];
            const failures = failureRows.filter(r => { const p = JSON.parse(r.payload); return p.market === target.market && p.sessionDate === target.sessionDate
                && /^(?:source|invalid)_\w{1,80}$/.test(p.reason ?? ''); }).map(r => r.id);
            if (officialValid && !failures.length) { reason ??= requested >= 2 ? 'run_budget' : 'source_not_ready'; continue; }
            const switchReason = !officialValid ? 'official_contract_pending'
                : batch?.next_attempt_at && Date.parse(batch.next_attempt_at) > now().getTime() ? 'official_source_cooldown' : 'official_source_failed';
            let frozen = await freezeBroker(target.market, target.sessionDate, backup, switchReason, failures);
            if (!frozen && requested < 2 && bytes + 2 * 1024 ** 2 <= 8 * 1024 ** 2) {
                const result = await loadDailyQuotesBatch({ db, sessionDate: target.sessionDate, review: backup.review, gate,
                    fetchReport: brokerFetcher, safety, admission, now, signal: controller.signal });
                if (result.nextAttemptAt && (!nextAttemptAt || result.nextAttemptAt < nextAttemptAt)) nextAttemptAt = result.nextAttemptAt;
                if (result.state === 'complete') frozen = await freezeBroker(target.market, target.sessionDate, backup, switchReason, failures);
                else {
                    reason ??= result.reason;
                    if (result.globalPause) { reason = result.reason; break; }
                }
            }
            if (frozen?.state === 'complete') processed++; else reason ??= 'run_budget';
        }
        await guard();
        const mapping = processed === plan.targets.length ? await sourceWindowMapping(db, { universeRevision, universeHash, sessions: plan.sessions }) : null;
        return { state: mapping ? 'complete' : 'pending', reason: mapping ? 'none' : reason ?? 'history_pending', plan, mapping,
            requested, bytes, processed, remaining: plan.targets.length - processed, nextAttemptAt, runId };
    } catch (e) {
        reason = /^(?:source_\w+|invalid_\w+|run_\w+|lease_lost)$/.test(e.message ?? '') ? e.message : 'source_preparation_failed';
        return { state: 'pending', reason, plan, requested, bytes, processed, remaining: plan.targets.length - processed, nextAttemptAt, runId };
    } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort();
        await receipt(processed === plan.targets.length && !reason ? 'provider_run_complete' : 'provider_run_partial',
            { reason, processed, remaining: plan.targets.length - processed, nextAttemptAt });
        await db.prepare("UPDATE screener_runs SET lease_until=NULL,status='released' WHERE id=? AND checkpoint=?").bind(lease, owner).run();
    }
}
