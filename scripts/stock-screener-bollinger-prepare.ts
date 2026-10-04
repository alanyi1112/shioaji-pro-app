/** 有界準備器，僅背景呼叫；未接正式 watcher，沒有 broker 或服務生命週期操作。 */
import type { ScreenerDatabase } from '../apps/multiview/worker/stock-screener-repository.ts';
import { planBollingerHistory, type VerifiedBollingerCalendar } from '../src/lib/stock-screener-bollinger-history.ts';
import { BOLLINGER_HISTORY_CAPABILITY, type BollingerSqueezeCriteria } from '../src/lib/stock-screener-v8.ts';
import { technicalEvidenceHash } from '../src/lib/stock-screener-technical-patterns.ts';
import { bollingerTransportFailureEvidence } from './stock-screener-bollinger-source-fetch.mjs';
import { bollingerSourceUrl, bollingerUniverseHash, parseBollingerOfficialReport, projectBollingerReport,
    validateBollingerSourceReview, type BollingerOfficialReport, type BollingerSourceResponse,
    type BollingerSourceReview, type BollingerUniverseStock } from '../src/lib/stock-screener-bollinger-source.ts';

type Target = ReturnType<typeof planBollingerHistory>['targets'][number];
interface BatchRecord { status: string; attempts: number; next_attempt_at: string | null; report: string | null; reason: string | null }
export interface BollingerPreparationOptions {
    db: ScreenerDatabase; calendar: VerifiedBollingerCalendar; through: string;
    criteria: BollingerSqueezeCriteria; profileRevision: string; universeRevision: string;
    universe: BollingerUniverseStock[]; reviews: Record<'TWSE' | 'TPEx', BollingerSourceReview>;
    fetchReport: (target: Target, signal: AbortSignal) => Promise<BollingerSourceResponse>;
    now?: () => Date; trigger: 'manual' | 'watcher' | 'late-boot';
    budget?: { maxRequests: number; maxBytes: number; maxDurationMs: number };
    /** 僅背景 provider coordinator 使用；未指定維持原雙市場／全窗口行為。 */
    targetKeys?: string[];
}
const LEASE = 'screener-bollinger-lease';
const WAIT_MS = 20 * 60000;
const RUN_MAX_MS = 15 * 60000;
const targetRow = (db: ScreenerDatabase, key: string) => db.prepare('SELECT status,attempts,next_attempt_at,report,reason FROM screener_bollinger_batches WHERE target_key=?')
    .bind(key).first<BatchRecord>();
const reasonOf = (e: unknown, fallback = 'preparation_failed') => {
    const message = e instanceof Error ? e.message : '';
    return /^(?:invalid_\w+|source_\w+|run_deadline|lease_lost|run_budget)$/.test(message) ? message : fallback;
};

export async function prepareBollingerHistory(options: BollingerPreparationOptions) {
    const { db, calendar, through, criteria, profileRevision, universeRevision, universe, reviews, fetchReport, trigger } = options;
    const now = options.now ?? (() => new Date()), start = now();
    const budget = options.budget ?? { maxRequests: 2, maxBytes: 8 * 1024 * 1024, maxDurationMs: RUN_MAX_MS };
    if (!Number.isInteger(budget.maxRequests) || budget.maxRequests < 1 || budget.maxRequests > 18
        || !Number.isInteger(budget.maxBytes) || budget.maxBytes < 1 || budget.maxBytes > 64 * 1024 * 1024
        || !Number.isInteger(budget.maxDurationMs) || budget.maxDurationMs < 1 || budget.maxDurationMs > RUN_MAX_MS
        || !universeRevision || !['manual', 'watcher', 'late-boot'].includes(trigger)) throw new Error('invalid_bollinger_budget');
    const plan = planBollingerHistory(calendar, through, criteria, profileRevision, start);
    if (options.targetKeys && (!options.targetKeys.length || options.targetKeys.some(k => !plan.targets.some(t => t.key === k))
        || new Set(options.targetKeys).size !== options.targetKeys.length)) throw new Error('invalid_bollinger_targets');
    const targets = options.targetKeys ? plan.targets.filter(t => options.targetKeys!.includes(t.key)) : plan.targets;
    const universeHash = await bollingerUniverseHash(universe);
    if (plan.state !== 'planned') return { state: 'history_pending', requested: 0, plan };
    // 本輪查證未完成的來源沒有 review，不寫成功 receipt、不呼叫 fetch。
    if (!targets.every(t => validateBollingerSourceReview(reviews?.[t.market], t.market, start)))
        return { state: 'pending', reason: 'source_contract_pending', requested: 0, plan };
    const schema = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('screener_bollinger_batches','screener_bollinger_receipts','screener_bollinger_daily')")
        .all<{ name: string }>()).results ?? [];
    if (schema.length !== 3) return { state: 'pending', reason: 'schema_pending', requested: 0, plan };
    const planHash = await technicalEvidenceHash({ plan, universeRevision, universeHash });
    const planId = `screener-bollinger-plan:${planHash}`, runId = crypto.randomUUID(), owner = crypto.randomUUID();
    const revisions = (await db.prepare("SELECT checkpoint FROM screener_runs WHERE scope='screener-bollinger-history-plan'").all<{ checkpoint: string }>()).results ?? [];
    for (const row of revisions) {
        const prior = JSON.parse(row.checkpoint);
        if (prior.universeRevision === universeRevision && prior.universeHash !== universeHash) throw new Error('invalid_universe_revision');
    }
    const deadline = start.getTime() + budget.maxDurationMs;
    await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,lease_until,updated_at)
        VALUES(?,'screener-bollinger-lease','running',?,?,?) ON CONFLICT(id) DO UPDATE SET
        status='running',checkpoint=excluded.checkpoint,lease_until=excluded.lease_until,updated_at=excluded.updated_at
        WHERE screener_runs.lease_until IS NULL OR screener_runs.lease_until<=?`)
        .bind(LEASE, owner, new Date(deadline).toISOString(), start.toISOString(), start.toISOString()).run();
    const owned = async () => {
        const r = await db.prepare('SELECT checkpoint,lease_until FROM screener_runs WHERE id=?').bind(LEASE)
            .first<{ checkpoint: string; lease_until: string | null }>();
        return r?.checkpoint === owner && Date.parse(r.lease_until ?? '') > now().getTime();
    };
    if (!await owned()) return { state: 'skipped', reason: 'lease_busy', requested: 0, plan };
    const guard = async () => {
        if (now().getTime() >= deadline) throw new Error('run_deadline');
        if (!await owned()) throw new Error('lease_lost');
    };
    const receipt = (status: string, payload: unknown, target: Target | null = null) => db.prepare(
        'INSERT INTO screener_bollinger_receipts(id,target_key,run_id,status,payload,created_at) VALUES(?,?,?,?,?,?)')
        .bind(crypto.randomUUID(), target?.key ?? null, runId, status,
            JSON.stringify({ capability: BOLLINGER_HISTORY_CAPABILITY, trigger, through, universeRevision, ...payload as object }), now().toISOString());
    const leaseCondition = "EXISTS(SELECT 1 FROM screener_runs WHERE id='screener-bollinger-lease' AND checkpoint=? AND lease_until>?)";
    const saveRows = async (report: BollingerOfficialReport) => {
        const projection = projectBollingerReport(report, universe), at = now().toISOString();
        const existing = (await db.prepare('SELECT symbol,payload FROM screener_bollinger_daily WHERE universe_revision=? AND session_date=? AND market=?')
            .bind(universeRevision, report.sessionDate, report.market).all<{ symbol: string; payload: string }>()).results ?? [];
        const expected = new Map(projection.map(row => [row.symbol, JSON.stringify(row)]));
        if (existing.some(row => expected.get(row.symbol) !== row.payload)) throw new Error('invalid_stored_projection');
        for (let offset = 0; offset < projection.length; offset += 50) {
            await guard();
            await db.batch(projection.slice(offset, offset + 50).map(row => db.prepare(`INSERT INTO screener_bollinger_daily
                (universe_revision,symbol,session_date,market,readiness,payload) SELECT ?,?,?,?,?,? WHERE ${leaseCondition}
                ON CONFLICT(universe_revision,session_date,symbol) DO NOTHING`)
                .bind(universeRevision, row.symbol, row.sessionDate, row.market, row.readiness, JSON.stringify(row), owner, at)));
        }
        return projection;
    };
    let requested = 0, bytes = 0, processed = 0, reason: string | null = null;
    let nextAttemptAt: string | null = null;
    await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
        VALUES(?,'screener-bollinger-history-plan','running',?,?) ON CONFLICT(id) DO UPDATE SET status='running',updated_at=excluded.updated_at`)
        .bind(planId, JSON.stringify({ ...plan, universeRevision, universeHash }), start.toISOString()).run();
    await receipt('started', { budget, start: start.toISOString() }).run();
    try {
        for (const target of targets) {
            await guard();
            let previous = await targetRow(db, target.key);
            if (previous?.report && !['invalid', 'exhausted'].includes(previous.status)) {
                const saved = JSON.parse(previous.report ?? 'null');
                if (!saved?.report || await technicalEvidenceHash(saved.report) !== saved.hash
                    || saved.report.market !== target.market || saved.report.sessionDate !== target.sessionDate
                    || saved.report.reviewHash !== reviews[target.market].evidenceHash) throw new Error('invalid_cached_report');
                await saveRows(saved.report);
                await guard();
                if (previous.status !== 'complete') await db.batch([
                    db.prepare(`UPDATE screener_bollinger_batches SET status='complete',reason=NULL,next_attempt_at=NULL,updated_at=?
                        WHERE target_key=? AND ${leaseCondition}`).bind(now().toISOString(), target.key, owner, now().toISOString()),
                    receipt('projection_recovered', { attempt: previous.attempts, payloadHash: saved.report.payloadHash,
                        market: target.market, sessionDate: target.sessionDate, requested: 0 }, target),
                ]);
                processed++;
                continue;
            }
            if (previous?.status === 'invalid' || previous?.status === 'exhausted') { reason = previous.reason; continue; }
            if (previous?.next_attempt_at && Date.parse(previous.next_attempt_at) > now().getTime()) {
                const at = previous.next_attempt_at;
                if (!nextAttemptAt || at < nextAttemptAt) nextAttemptAt = at;
                continue;
            }
            if (requested >= budget.maxRequests || bytes >= budget.maxBytes) { reason ??= 'run_budget'; break; }
            if (!validateBollingerSourceReview(reviews[target.market], target.market, now())) throw new Error('source_contract_pending');
            const attempt = (previous?.attempts ?? 0) + 1;
            if (attempt > 18) throw new Error('invalid_attempt_count');
            const attemptAt = now(), provisionalNext = new Date(attemptAt.getTime() + WAIT_MS).toISOString();
            await db.prepare(`INSERT INTO screener_bollinger_batches(target_key,market,session_date,status,attempts,next_attempt_at,updated_at)
                VALUES(?,?,?,'running',?,?,?) ON CONFLICT(target_key) DO UPDATE SET status='running',attempts=excluded.attempts,
                next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at`)
                .bind(target.key, target.market, target.sessionDate, attempt, provisionalNext, attemptAt.toISOString()).run();
            await receipt('attempt_started', { attempt, market: target.market, sessionDate: target.sessionDate }, target).run();
            requested++;
            const controller = new AbortController();
            let timer: ReturnType<typeof setTimeout> | undefined;
            let response: BollingerSourceResponse | undefined;
            try {
                response = await Promise.race([fetchReport(target, controller.signal), new Promise<never>((_, reject) => {
                    timer = setTimeout(() => { controller.abort(); reject(new Error('source_timeout')); }, Math.min(30000, deadline - now().getTime()));
                })]);
                bytes += new TextEncoder().encode(response.text).byteLength;
                await guard();
                if (bytes > budget.maxBytes) throw new Error('run_budget');
                const report = await parseBollingerOfficialReport(response, target.market, target.sessionDate, reviews[target.market], now());
                // 先持久化已驗證全市場批次再投影：中止後用相同來源補列，不重抓並混入另一版資料。
                const saved = JSON.stringify({ report, hash: await technicalEvidenceHash(report), response });
                await guard();
                await db.batch([
                    db.prepare(`UPDATE screener_bollinger_batches SET report=?,updated_at=? WHERE target_key=? AND ${leaseCondition}`)
                        .bind(saved, now().toISOString(), target.key, owner, now().toISOString()),
                    receipt('source_verified', { attempt, payloadHash: report.payloadHash, bytes: report.bytes,
                        market: target.market, sessionDate: target.sessionDate }, target),
                ]);
                const projection = await saveRows(report);
                await guard();
                await db.batch([
                    db.prepare(`UPDATE screener_bollinger_batches SET status='complete',report=?,reason=NULL,next_attempt_at=NULL,updated_at=?
                        WHERE target_key=? AND ${leaseCondition}`).bind(saved, now().toISOString(), target.key, owner, now().toISOString()),
                    receipt('complete', { attempt, sourceUrl: bollingerSourceUrl(target.market, target.sessionDate),
                        sessionDate: report.sessionDate, market: report.market, payloadHash: report.payloadHash,
                        reviewHash: report.reviewHash, rowCount: report.points.length, universeCount: projection.length,
                        bytes: report.bytes, readiness: projection.reduce<Record<string, number>>((a, r) => {
                            a[r.readiness] = (a[r.readiness] ?? 0) + 1; return a;
                        }, {}) }, target),
                ]);
                if ((await targetRow(db, target.key))?.status !== 'complete') throw new Error('lease_lost');
                processed++;
            } catch (error) {
                const failure = reasonOf(error, response ? 'preparation_failed' : 'source_transport_failed'); reason = failure;
                if (failure === 'lease_lost') throw error;
                let delay = WAIT_MS;
                if (response?.status === 429) {
                    const raw = response.retryAfter ?? '', retryMs = /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now().getTime();
                    delay = Math.max(3600000, Number.isFinite(retryMs) ? retryMs : 0);
                }
                const permanent = failure.startsWith('invalid_') || failure === 'source_http_403';
                const status = permanent ? 'invalid' : attempt >= 18 ? 'exhausted' : 'pending';
                const next = status === 'pending' ? new Date(now().getTime() + delay).toISOString() : null;
                // 過期租約不能蓋過新 owner 的狀態；started receipt 留作中止證據。
                if (await owned()) await db.batch([
                    db.prepare(`UPDATE screener_bollinger_batches SET status=?,reason=?,next_attempt_at=?,updated_at=?
                        WHERE target_key=? AND ${leaseCondition}`).bind(status, failure, next, now().toISOString(), target.key, owner, now().toISOString()),
                    receipt(status === 'pending' ? 'partial' : 'failed', { attempt, reason: failure, nextAttemptAt: next,
                        market: target.market, sessionDate: target.sessionDate, statusCode: response?.status ?? null,
                        transport: bollingerTransportFailureEvidence(error) }, target),
                ]);
                if (next && (!nextAttemptAt || next < nextAttemptAt)) nextAttemptAt = next;
                if (failure === 'run_budget' || failure === 'run_deadline') break;
            } finally { if (timer) clearTimeout(timer); controller.abort(); }
        }
    } catch (error) { reason = reasonOf(error); }
    finally {
        const complete = processed === targets.length;
        const progress = { ...plan, universeRevision, universeHash, runId, requested, bytes, processed,
            remaining: targets.length - processed, nextAttemptAt, reason, cursor: null };
        if (await owned()) {
            await db.prepare(`UPDATE screener_runs SET status=?,checkpoint=?,updated_at=? WHERE id=?`)
                .bind(complete ? 'complete' : 'pending', JSON.stringify(progress), now().toISOString(), planId).run();
        }
        await receipt(complete ? 'run_complete' : 'run_partial', { ...progress, end: now().toISOString() }).run();
        await db.prepare('UPDATE screener_runs SET lease_until=NULL,status=? WHERE id=? AND checkpoint=?')
            .bind(complete ? 'complete' : 'pending', LEASE, owner).run();
    }
    return { state: processed === targets.length ? 'complete' : 'pending', plan, requested, bytes, processed,
        remaining: targets.length - processed, nextAttemptAt, reason, runId };
}
