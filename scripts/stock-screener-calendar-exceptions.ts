/** 年度表是預定開市日；明確的官方全日休市公告優先，不以空行情推論。 */
import type { ScreenerDatabase } from '../apps/multiview/worker/stock-screener-repository.ts';
import type { VerifiedBollingerCalendar } from '../src/lib/stock-screener-bollinger-history.ts';
import { technicalEvidenceHash } from '../src/lib/stock-screener-technical-patterns.ts';
import { createBollingerClosureFetcher, bollingerTransportFailureEvidence } from './stock-screener-bollinger-source-fetch.mjs';

export const CLOSURE_POLICY = 'official-full-day-market-closures-v1';
export const closureSourceUrl = (year: number) => `https://www.twse.com.tw/rwd/zh/news/newsList?response=json&startDate=${year}&endDate=${year}`;
type Reply = { sourceUrl: string; status: number; text: string; retryAfter?: string | null };
export type ClosureFetcher = (year: number, signal: AbortSignal) => Promise<Reply>;
const taipeiDay = (d: Date) => new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10);
function date(year: number, month: number, day: number) {
    const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
        throw new Error('invalid_closure_date');
    return value;
}

/** 僅接受交易所自己的完整新聞清單及明確全市場／全日語意。 */
export function parseOfficialFullDayClosures(text: string, year: number, at: Date) {
    if (!Number.isInteger(year) || year < 2020 || year > 2200) throw new Error('invalid_closure_schema');
    let body; try { body = JSON.parse(text); } catch { throw new Error('invalid_closure_schema'); }
    const fields = ['項次', '標題', '日期', 'zhId', 'enId'];
    if (body?.stat !== 'ok' || !Array.isArray(body.fields) || JSON.stringify(body.fields) !== JSON.stringify(fields)
        || !Array.isArray(body.data) || body.data.length > 3000 || !Number.isInteger(body.totalCount)
        || body.totalCount !== body.data.length) throw new Error('invalid_closure_feed_coverage');
    const ids = new Set<string>();
    const notices: Array<{ market: 'TWSE'; dates: string[]; publishedDate: string; title: string; id: string; sourceUrl: string }> = [];
    for (const row of body.data) {
        if (!Array.isArray(row) || row.length !== 5 || !Number.isInteger(row[0]) || typeof row[1] !== 'string' || row[1].length > 1000
            || typeof row[2] !== 'string' || !/^[a-f0-9]{32}$/.test(row[3]) || ids.has(row[3])) throw new Error('invalid_closure_schema');
        ids.add(row[3]);
        const published = /^(\d{3})年(\d{2})月(\d{2})日$/.exec(row[2]);
        if (!published || Number(published[1]) + 1911 !== year) throw new Error('invalid_closure_feed_year');
        const publishedDate = date(year, Number(published[2]), Number(published[3]));
        if (publishedDate > taipeiDay(at)) throw new Error('invalid_closure_date');
        const title = row[1].replace(/\s+/g, '');
        // 個股停牌、下午停班、盤後停止、條件式規則均不是全日休市。
        if (!title.includes('集中交易市場') || !/休市|恢復交易|取消休市/.test(title)) continue;
        if (title.includes('\uFFFD')) throw new Error('calendar_closure_review_required');
        if (/如遇|若|假如|不休市|正常交易|個股|個別|部分商品|盤後|下午|夜盤/.test(title)
            || /(?:公司代號|股票代號)[：:]?\d{4,6}/.test(title)) continue;
        if (/取消|撤銷|恢復/.test(title)) throw new Error('calendar_closure_review_required');
        const m = /集中交易市場(\d{3,4})年(\d{1,2})月(\d{1,2})日(?:至(?:(\d{3,4})年)?(?:(\d{1,2})月)?(\d{1,2})日)?(?:全日)?休市(?:一天|一日|1天|1日|\d+天|\d+日)?[。！!]*$/.exec(title);
        if (!m) throw new Error('calendar_closure_review_required');
        const y = Number(m[1]) < 1911 ? Number(m[1]) + 1911 : Number(m[1]);
        const endYear = m[4] ? (Number(m[4]) < 1911 ? Number(m[4]) + 1911 : Number(m[4])) : y;
        const start = date(y, Number(m[2]), Number(m[3]));
        const end = m[6] ? date(endYear, Number(m[5] ?? m[2]), Number(m[6])) : start;
        if (end < start || Date.parse(end) - Date.parse(start) > 7 * 86400000 || publishedDate > end) throw new Error('invalid_closure_date');
        const dates: string[] = [];
        for (let ms = Date.parse(start); ms <= Date.parse(end); ms += 86400000) dates.push(new Date(ms).toISOString().slice(0, 10));
        notices.push({ market: 'TWSE', dates, publishedDate, title: row[1], id: row[3],
            sourceUrl: `https://www.twse.com.tw/zh/about/news/news/content.html?${row[3]}` });
    }
    return notices;
}

/** 重用年度表；公告按年度 checkpoint，當年度每個台北日期最多更新一次，舊年度最多30日。 */
export async function prepareBollingerCalendarExceptions(db: ScreenerDatabase, base: VerifiedBollingerCalendar,
    { now = () => new Date(), deadline, fetchNotices = createBollingerClosureFetcher() }: {
        now?: () => Date; deadline: number; fetchNotices?: ClosureFetcher;
    }) {
    const at = now(), runId = crypto.randomUUID(), owner = crypto.randomUUID(), leaseId = 'bollinger-calendar-closures-lease';
    const end = Math.min(deadline, at.getTime() + 180000);
    const years = [...new Set(base.commonSessions.map(d => Number(d.slice(0, 4))))].sort();
    if (!years.length || years.length > 3 || end <= at.getTime()) return { state: 'pending' as const, reason: 'calendar_closure_pending', nextAttemptAt: null };
    const readFresh = async (year: number) => {
        const row = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?').bind(`bollinger-calendar-closures:${year}`)
            .first<{ status: string; checkpoint: string }>();
        let cached: any; try { cached = row && JSON.parse(row.checkpoint); } catch { return null; }
        if (row?.status === 'pending' && cached?.policy === CLOSURE_POLICY && Date.parse(cached.nextAttemptAt) > at.getTime())
            return { pending: true as const, reason: cached.reason ?? 'calendar_closure_pending', nextAttemptAt: cached.nextAttemptAt };
        if (row?.status !== 'verified' || cached?.policy !== CLOSURE_POLICY || cached.sourceUrl !== closureSourceUrl(year)
            || typeof cached.text !== 'string' || !Number.isFinite(Date.parse(cached.fetchedAt)) || Date.parse(cached.fetchedAt) > at.getTime()
            || (year === Number(taipeiDay(at).slice(0, 4)) ? taipeiDay(new Date(cached.fetchedAt)) !== taipeiDay(at)
                : at.getTime() - Date.parse(cached.fetchedAt) >= 30 * 86400000)
            || await technicalEvidenceHash(cached.text) !== cached.sourceHash) return null;
        return { pending: false as const, text: cached.text as string };
    };
    type Proof = { year: number; sourceHash: string; sourceUrl: string; notices: ReturnType<typeof parseOfficialFullDayClosures> };
    const project = async (proofs: Proof[]) => {
        const removed = new Set(proofs.flatMap(p => p.notices.flatMap(n => n.dates)));
        const commonSessions = base.commonSessions.filter(d => !removed.has(d));
        const authorityHash = await technicalEvidenceHash({ policy: CLOSURE_POLICY, baseAuthorityHash: base.authorityHash, proofs, commonSessions });
        const evidence = { policy: CLOSURE_POLICY, baseAuthorityHash: base.authorityHash, authorityHash, commonSessions,
            excluded: base.commonSessions.filter(d => removed.has(d)), proofs: proofs.map(({ year, sourceHash, notices }) => ({ year, sourceHash, notices })) };
        return { evidence, calendar: { ...base, commonSessions, authorityHash } };
    };
    // 完成後的同日喚醒必須是真正 zero-write；冷卻也不建立第二份失敗收據。
    try {
        const cachedProofs: Proof[] = [];
        for (const year of years) {
            const cached = await readFresh(year);
            if (cached?.pending) return { state: 'pending' as const, reason: cached.reason, nextAttemptAt: cached.nextAttemptAt };
            if (!cached) break;
            cachedProofs.push({ year, sourceHash: await technicalEvidenceHash(cached.text), sourceUrl: closureSourceUrl(year),
                notices: parseOfficialFullDayClosures(cached.text, year, at) });
        }
        if (cachedProofs.length === years.length) {
            const p = await project(cachedProofs);
            const old = await db.prepare("SELECT checkpoint FROM screener_runs WHERE id='bollinger-calendar-effective'").first<{ checkpoint: string }>();
            if (old && JSON.parse(old.checkpoint).authorityHash === p.calendar.authorityHash) return { state: 'ready' as const, calendar: p.calendar };
        }
    } catch { /* 壞快取走有租約的正式驗證，不能當作合法交易日。 */ }
    await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,lease_until,updated_at) VALUES(?,'bollinger-calendar-closures','running',?,?,?)
        ON CONFLICT(id) DO UPDATE SET status='running',checkpoint=excluded.checkpoint,lease_until=excluded.lease_until,updated_at=excluded.updated_at
        WHERE screener_runs.lease_until IS NULL OR screener_runs.lease_until<=?`)
        .bind(leaseId, owner, new Date(end).toISOString(), at.toISOString(), at.toISOString()).run();
    const owns = async () => { const row = await db.prepare('SELECT checkpoint,lease_until FROM screener_runs WHERE id=?').bind(leaseId)
        .first<{ checkpoint: string; lease_until: string }>(); return row?.checkpoint === owner && Date.parse(row.lease_until) > now().getTime(); };
    if (!await owns()) return { state: 'pending' as const, reason: 'lease_busy', nextAttemptAt: null };
    let requested = 0, bytes = 0, delay = 20 * 60000;
    let responseEvidence: { year: number; sourceUrl: string; status: number; text: string; sourceHash: string } | undefined;
    const receipt = async (status: string, payload: object) => db.prepare(`INSERT INTO screener_bollinger_receipts
        (id,target_key,run_id,status,payload,created_at) VALUES(?,NULL,?,?,?,?)`)
        .bind(crypto.randomUUID(), runId, status, JSON.stringify({ policy: CLOSURE_POLICY, requested, bytes, ...payload }), now().toISOString()).run();
    const proofs: Proof[] = [];
    try {
        for (const year of years) {
            responseEvidence = undefined;
            const key = `bollinger-calendar-closures:${year}`;
            const cached = await readFresh(year);
            if (cached?.pending) return { state: 'pending' as const, reason: cached.reason, nextAttemptAt: cached.nextAttemptAt };
            const fresh = !!cached;
            let text = cached?.text ?? '';
            if (!fresh) {
                if (!await owns() || requested >= 3) throw new Error('run_deadline');
                requested++;
                const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
                const r = await Promise.race([fetchNotices(year, controller.signal), new Promise<never>((_, reject) => {
                    timer = setTimeout(() => { controller.abort(); reject(new Error('source_timeout')); }, Math.min(30000, end - now().getTime()));
                })]).finally(() => { clearTimeout(timer); controller.abort(); });
                if (r.sourceUrl !== closureSourceUrl(year)) throw new Error('invalid_closure_source');
                const size = new TextEncoder().encode(r.text).byteLength; bytes += size;
                if (size > 2 * 1024 * 1024 || bytes > 6 * 1024 * 1024) throw new Error('invalid_source_size');
                responseEvidence = { year, sourceUrl: r.sourceUrl, status: r.status, text: r.text, sourceHash: await technicalEvidenceHash(r.text) };
                if (r.status === 429) { const retry = r.retryAfter ?? '';
                    const ms = /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - now().getTime();
                    delay = Number.isSafeInteger(ms) && ms > 0 && ms <= 365 * 86400000 ? Math.max(3600000, ms) : 3600000;
                    throw new Error('rate_limited'); }
                if (r.status !== 200) throw new Error('source_transport_failed');
                text = r.text;
            }
            const notices = parseOfficialFullDayClosures(text, year, at), sourceHash = await technicalEvidenceHash(text);
            proofs.push({ year, sourceHash, sourceUrl: closureSourceUrl(year), notices });
            if (!fresh) {
                if (!await owns()) throw new Error('lease_lost');
                const evidence = { policy: CLOSURE_POLICY, year, sourceUrl: closureSourceUrl(year), sourceHash, text, notices, fetchedAt: now().toISOString() };
                // 原始新聞清單 append-only 保存；年度 head 只供續跑，不改原下載失敗或年度 authority。
                await receipt('calendar_closure_verified', evidence);
                await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,'bollinger-calendar-closures','verified',?,?)
                    ON CONFLICT(id) DO UPDATE SET status='verified',checkpoint=excluded.checkpoint,updated_at=excluded.updated_at`)
                    .bind(key, JSON.stringify(evidence), now().toISOString()).run();
            }
        }
        if (!await owns()) throw new Error('lease_lost');
        // 一市場全日休市即非兩市場共同交易日；不把 TWSE 公告冒充 TPEx 公告。
        const { evidence, calendar } = await project(proofs);
        const old = await db.prepare("SELECT checkpoint FROM screener_runs WHERE id='bollinger-calendar-effective'").first<{ checkpoint: string }>();
        if (!old || JSON.parse(old.checkpoint).authorityHash !== calendar.authorityHash) {
            await receipt('calendar_replanned', evidence);
            await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES('bollinger-calendar-effective','bollinger-calendar-closures','verified',?,?)
                ON CONFLICT(id) DO UPDATE SET checkpoint=excluded.checkpoint,updated_at=excluded.updated_at`)
                .bind(JSON.stringify(evidence), now().toISOString()).run();
        }
        return { state: 'ready' as const, calendar };
    } catch (error) {
        const reason = error instanceof Error && /^(invalid_closure_\w+|calendar_closure_review_required|invalid_source_size|source_\w+|rate_limited|run_deadline|lease_lost)$/.test(error.message)
            ? error.message : 'calendar_closure_pending';
        const nextAttemptAt = new Date(now().getTime() + delay).toISOString();
        await receipt('calendar_closure_failed', { reason, nextAttemptAt, ...(responseEvidence ? { responseEvidence } : {}), transport: bollingerTransportFailureEvidence(error) });
        const failedYear = years[proofs.length];
        if (failedYear && await owns()) await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,'bollinger-calendar-closures','pending',?,?)
            ON CONFLICT(id) DO UPDATE SET status='pending',checkpoint=excluded.checkpoint,updated_at=excluded.updated_at`)
            .bind(`bollinger-calendar-closures:${failedYear}`, JSON.stringify({ policy: CLOSURE_POLICY, reason, nextAttemptAt }), now().toISOString()).run();
        return { state: 'pending' as const, reason, nextAttemptAt };
    } finally { await db.prepare("UPDATE screener_runs SET status='idle',lease_until=NULL WHERE id=? AND checkpoint=?").bind(leaseId, owner).run(); }
}
