/** 純價量能力自己的官方日曆；不讀 TDCC、broker 或瀏覽器。 */
import type { ScreenerDatabase } from '../apps/multiview/worker/stock-screener-repository.ts';
import type { VerifiedBollingerCalendar } from '../src/lib/stock-screener-bollinger-history.ts';
import { validBollingerDate } from '../src/lib/stock-screener-bollinger-source.ts';
import { technicalEvidenceHash } from '../src/lib/stock-screener-technical-patterns.ts';
import { parseTwseOfficialCalendar, parseTpexOfficialCalendar, buildOfficialMarketCalendarSnapshot } from './smart-order-runtime/official-market-calendar-core.mjs';
import { createBollingerCalendarFetcher, bollingerTransportFailureEvidence } from './stock-screener-bollinger-source-fetch.mjs';
import { prepareBollingerCalendarExceptions, type ClosureFetcher } from './stock-screener-calendar-exceptions.ts';

type CalendarReply = { sourceUrl: string; status: number; retryAfter?: string | null; text: string };
export type BollingerCalendarFetcher = (market: 'TWSE' | 'TPEx', year: number, signal: AbortSignal) => Promise<CalendarReply>;
const CACHE = 'screener-bollinger-calendar', LEASE = 'screener-bollinger-lease';
const valid = (e: any, at: Date) => e?.version === 1 && Array.isArray(e.sessions) && e.sessions.length <= 800
    && e.sessions.length > 0 && e.sessions.every((d: unknown, i: number) => validBollingerDate(d) && (!i || d > e.sessions[i - 1]))
    && Array.isArray(e.sourceHashes) && e.sourceHashes.length >= 2 && e.sourceHashes.every((h: unknown) => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h))
    && Date.parse(e.validThrough) > at.getTime();

async function prepareAnnualBollingerCalendar(db: ScreenerDatabase, { now = () => new Date(), deadline,
    fetchCalendar = createBollingerCalendarFetcher() }: { now?: () => Date; deadline: number; fetchCalendar?: BollingerCalendarFetcher }) {
    const at = now();
    // 合法舊 cache 可以共用；缺少／到期時，自己更新，絕不要求舊 v5 工作成功。
    for (const id of [CACHE, 'screener-period-evidence']) {
        const row = await db.prepare("SELECT checkpoint FROM screener_runs WHERE id=? AND status='verified'").bind(id).first<{ checkpoint: string }>();
        try { const e = row && JSON.parse(row.checkpoint); if (valid(e, at)) return { state: 'ready' as const,
            calendar: { status: 'verified', commonSessions: e.sessions, validThrough: e.validThrough,
                authorityHash: await technicalEvidenceHash(e) } as VerifiedBollingerCalendar }; } catch { /* 不信任非法 cache */ }
    }
    const last = await db.prepare("SELECT checkpoint FROM screener_runs WHERE id='screener-bollinger-calendar-attempt'").first<{ checkpoint: string }>();
    try { const e = last && JSON.parse(last.checkpoint); if (Date.parse(e?.nextAttemptAt) > at.getTime())
        return { state: 'pending' as const, reason: 'calendar_authority_pending', nextAttemptAt: e.nextAttemptAt }; } catch { /* 重新驗證 */ }
    const owner = crypto.randomUUID(), runId = crypto.randomUUID(), end = Math.min(deadline, at.getTime() + 180000);
    if (end <= at.getTime()) return { state: 'pending' as const, reason: 'run_deadline' };
    await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,lease_until,updated_at) VALUES(?,'bollinger-calendar','running',?,?,?)
        ON CONFLICT(id) DO UPDATE SET status='running',checkpoint=excluded.checkpoint,lease_until=excluded.lease_until,updated_at=excluded.updated_at
        WHERE screener_runs.lease_until IS NULL OR screener_runs.lease_until<=?`)
        .bind(LEASE, owner, new Date(end).toISOString(), at.toISOString(), at.toISOString()).run();
    const owns = async () => { const lease = await db.prepare('SELECT checkpoint,lease_until FROM screener_runs WHERE id=?').bind(LEASE)
        .first<{ checkpoint: string; lease_until: string }>(); return lease?.checkpoint === owner && Date.parse(lease.lease_until) > now().getTime(); };
    if (!await owns()) return { state: 'pending' as const, reason: 'lease_busy' };
    let requested = 0, bytes = 0, retryMs = 20 * 60000;
    const receipt = async (status: string, payload: object) => db.prepare(`INSERT INTO screener_bollinger_receipts
        (id,target_key,run_id,status,payload,created_at) VALUES(?,NULL,?,?,?,?)`)
        .bind(crypto.randomUUID(), runId, status, JSON.stringify({ capability: 'bollinger-history-v1', trigger: 'watcher-calendar', requested, bytes, ...payload }), now().toISOString()).run();
    try {
        const year = Number(new Date(at.getTime() + 8 * 3600000).toISOString().slice(0, 4));
        const sessions: string[] = [], sourceHashes: string[] = [], sources: object[] = [];
        for (const y of [year - 2, year - 1, year]) {
            const reports: Record<string, any> = {};
            for (const market of ['TWSE', 'TPEx'] as const) {
                if (!await owns() || requested >= 6) throw new Error('run_deadline');
                const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
                requested++;
                const response = await Promise.race([fetchCalendar(market, y, controller.signal), new Promise<never>((_, reject) => {
                    timer = setTimeout(() => { controller.abort(); reject(new Error('source_timeout')); }, Math.min(30000, end - now().getTime()));
                })]).finally(() => { clearTimeout(timer); controller.abort(); });
                const expected = market === 'TWSE' ? `https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json&queryYear=${y - 1911}`
                    : `https://www.tpex.org.tw/www/zh-tw/bulletin/tradingDate?date=${y}`;
                if (response.sourceUrl !== expected) throw new Error('invalid_calendar_source');
                if (response.status === 429) { const retry = response.retryAfter ?? '';
                    const delay = /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - now().getTime();
                    retryMs = Number.isSafeInteger(delay) && delay > 0 && delay <= 365 * 86400000 ? Math.max(3600000, delay) : 3600000;
                    throw new Error('rate_limited'); }
                if (response.status !== 200) throw new Error('source_transport_failed');
                const size = new TextEncoder().encode(response.text).byteLength; bytes += size;
                if (size > 2 * 1024 * 1024 || bytes > 12 * 1024 * 1024) throw new Error('invalid_source_size');
                const payload = JSON.parse(response.text), hash = await technicalEvidenceHash(response.text);
                reports[market] = market === 'TWSE' ? parseTwseOfficialCalendar(payload, y) : parseTpexOfficialCalendar(payload, y);
                sources.push({ market, year: y, sourceUrl: expected, hash, bytes: size }); sourceHashes.push(hash);
            }
            const merged = buildOfficialMarketCalendarSnapshot({ twse: reports.TWSE, tpex: reports.TPEx, fetchedAtEpochMs: at.getTime() });
            sessions.push(...merged.days.filter((d: any) => d.TSE === 'scheduled_trading' && d.OTC === 'scheduled_trading').map((d: any) => d.tradeDate));
        }
        const today = new Date(at.getTime() + 8 * 3600000).toISOString().slice(0, 10), next = sessions.find(d => d > today);
        if (!next || !await owns()) throw new Error('calendar_coverage_pending');
        // 年度日曆採有界 30 日 cache，不每天重抓三年；年度範圍外仍 fail closed。
        // 這是盤後規劃 authority，不授予 broker write；每日發布仍須兩市場當日日報驗證。
        const validUntil = Math.min(at.getTime() + 30 * 86400000, Date.parse(`${year}-12-31T23:59:59+08:00`));
        const evidence = { version: 1, sessions, sourceHashes, sources, fetchedAt: at.toISOString(), validThrough: new Date(validUntil).toISOString() };
        await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) SELECT ?,'bollinger-calendar','verified',?,?
            WHERE EXISTS(SELECT 1 FROM screener_runs WHERE id=? AND checkpoint=? AND lease_until>?)
            ON CONFLICT(id) DO UPDATE SET status='verified',checkpoint=excluded.checkpoint,updated_at=excluded.updated_at`)
            .bind(CACHE, JSON.stringify(evidence), now().toISOString(), LEASE, owner, now().toISOString()).run();
        if (!await owns()) throw new Error('lease_lost');
        await receipt('calendar_verified', evidence);
        return { state: 'ready' as const, calendar: { status: 'verified', commonSessions: sessions, validThrough: evidence.validThrough,
            authorityHash: await technicalEvidenceHash(evidence) } as VerifiedBollingerCalendar };
    } catch (error) {
        const reason = error instanceof Error && /^(invalid_calendar_\w+|source_\w+|rate_limited|calendar_coverage_pending|run_deadline|lease_lost|invalid_source_size)$/.test(error.message)
            ? error.message : 'calendar_authority_pending';
        const nextAttemptAt = new Date(now().getTime() + retryMs).toISOString();
        await receipt('calendar_failed', { reason, nextAttemptAt, transport: bollingerTransportFailureEvidence(error) });
        await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES('screener-bollinger-calendar-attempt','bollinger-calendar','pending',?,?)
            ON CONFLICT(id) DO UPDATE SET checkpoint=excluded.checkpoint,updated_at=excluded.updated_at`)
            .bind(JSON.stringify({ reason, nextAttemptAt }), now().toISOString()).run();
        return { state: 'pending' as const, reason: 'calendar_authority_pending', nextAttemptAt };
    } finally { await db.prepare("UPDATE screener_runs SET status='idle',lease_until=NULL WHERE id=? AND checkpoint=?").bind(LEASE, owner).run(); }
}

export async function prepareBollingerCalendar(db: ScreenerDatabase, options: {
    now?: () => Date; deadline: number; fetchCalendar?: BollingerCalendarFetcher; fetchNotices?: ClosureFetcher;
}) {
    const annual = await prepareAnnualBollingerCalendar(db, options);
    if (annual.state !== 'ready') return annual;
    return prepareBollingerCalendarExceptions(db, annual.calendar, options);
}
