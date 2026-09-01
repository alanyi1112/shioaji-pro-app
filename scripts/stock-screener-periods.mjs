/** Official period discovery for the local operator; no broker/runtime authority is imported. */
import { createHash } from 'node:crypto';
import { parseTwseOfficialCalendar, parseTpexOfficialCalendar, buildOfficialMarketCalendarSnapshot } from './smart-order-runtime/official-market-calendar-core.mjs';
import { createTdccHistorySession, TDCC_HISTORY_URL } from '../apps/multiview/scripts/tdcc-history-backfill.mjs';
import { ScreenerSourceError } from '../apps/multiview/worker/stock-screener-sources.ts';

export const hashText = text => createHash('sha256').update(text).digest('hex');
export function parseScreenerTpexCalendar(payload, year) {
    // The official 2026 table has one bond-only row whose date/description are
    // row-spanned from the preceding STOCK row. Keep the stock row unchanged.
    // Do not change the separate trading-authority parser or its authorization hashes.
    const html = payload?.data?.html;
    if (typeof html !== 'string') throw new Error('invalid_calendar');
    const normalized = html.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (row, body) => {
        const cells = [...body.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)];
        const text = cells[0]?.[1].replace(/<[^>]+>/g, '').replace(/\s+/g, '');
        return cells.length === 1 && text === '農曆春節前債券等殖成交系統（含比對系統）最後交易日' ? '' : row;
    });
    return parseTpexOfficialCalendar({ ...payload, data: { ...payload.data, html: normalized } }, year);
}
export async function boundedOfficialText(url, fetcher = fetch, init = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['www.twse.com.tw', 'www.tpex.org.tw', 'www.tdcc.com.tw'].includes(parsed.hostname)) throw new Error('source_not_allowed');
    const controller = new AbortController();
    const signal = init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal;
    let timer;
    try {
        return await Promise.race([(async () => {
            const response = await fetcher(url, { ...init, signal, redirect:'error', headers: { ...init.headers, 'accept-encoding': 'identity' } });
            const text = await response.text();
            if (response.status === 429) {
                const retry = response.headers.get('retry-after');
                const delay = /^\d+$/.test(retry ?? '') ? Number(retry)*1000 : Date.parse(retry ?? '')-Date.now();
                throw new ScreenerSourceError('rate_limited',Number.isFinite(delay)?Math.max(0,delay):0);
            }
            if (response.status===403 || /驗證碼|captcha|access denied|request rejected|forbidden/i.test(text)) throw new Error('source_blocked');
            if (!response.ok) throw new Error(`source_http_${response.status}`);
            if (text.length > 16 * 1024 * 1024) throw new Error('source_too_large');
            return { text, response, hash: hashText(text), fetchedAt: new Date().toISOString() };
        })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('source_timeout')); }, 30000); })]);
    } finally { clearTimeout(timer); controller.abort(); }
}

export function validateHistoryTableShape(html) {
    const marker = html.search(/class=["'][^"']*securities-overview/i);
    const start = html.indexOf('<table', marker), end = html.indexOf('</table>', start);
    const rows = [...html.slice(start, end).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
        .map(row => [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cell[1].replace(/<[^>]+>/g,'').replace(/&nbsp;|&#160;/g,'').replaceAll(',','').trim()))
        .filter(row => row.length === 5);
    if (marker < 0 || ![16,17].includes(rows.length)) throw new Error('incomplete_tdcc');
    // The public form omits an exactly-zero adjustment row. Prove it from ALL
    // fifteen bands and the official total before allowing legacy normalization.
    // A missing band or nonzero discrepancy must never be silently filled.
    const exact = value => { if (!/^(?:0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('invalid_integer_precision'); return BigInt(value); };
    if (rows.length === 16) {
        if (!rows.at(-1)[1].replace(/\s+/g,'').includes('合計') || rows.slice(0,15).some((row,i)=>row[0]!==String(i+1))) throw new Error('incomplete_tdcc');
        for (const index of [2,3]) if (rows.slice(0,15).reduce((sum,row)=>sum+exact(row[index]),0n)!==exact(rows.at(-1)[index])) throw new Error('incomplete_tdcc');
    }
    return rows.length;
}

/** Preserve session cookies in memory only; all absent adjustment rows need exact proof. */
export function screenerTdccSession(fetcher = fetch) {
    const session = createTdccHistorySession(async (url, init) => {
        if (url !== TDCC_HISTORY_URL) throw new Error('source_not_allowed');
        const result = await boundedOfficialText(url, fetcher, init);
        if (init?.method === 'POST' && !/查無此資料/.test(result.text)) {
            validateHistoryTableShape(result.text);
        }
        // Return only the bounded already-read body while retaining session headers internally.
        return new Response(result.text, { status: result.response.status, headers: result.response.headers });
    });
    return session;
}

export async function discoverScreenerPeriods(now = new Date(), fetcher = fetch) {
    const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10), year = Number(day.slice(0, 4));
    const sessions = [], hashes = [];
    for (const y of day.slice(5, 7) === '01' ? [year - 1, year] : [year]) {
        const a = await boundedOfficialText(`https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json&queryYear=${y - 1911}`, fetcher);
        const b = await boundedOfficialText(`https://www.tpex.org.tw/www/zh-tw/bulletin/tradingDate?date=${y}`, fetcher);
        const calendar = buildOfficialMarketCalendarSnapshot({ twse: parseTwseOfficialCalendar(JSON.parse(a.text), y), tpex: parseScreenerTpexCalendar(JSON.parse(b.text), y), fetchedAtEpochMs: now.getTime() });
        sessions.push(...calendar.days.filter(d => d.TSE === 'scheduled_trading' && d.OTC === 'scheduled_trading').map(d => d.tradeDate));
        hashes.push(a.hash, b.hash);
    }
    const weeks = (await screenerTdccSession(fetcher).refresh()).map(raw => `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`).sort();
    const next = sessions.find(date => date > day);
    // Year-end unknown future calendar is fail-closed, never invented.
    if (!next) throw new Error('calendar_coverage_pending');
    hashes.push(hashText(JSON.stringify(weeks)));
    return { version: 1, sessions, weeks, through: day, fetchedAt: now.toISOString(), sourceHashes: hashes,
        validThrough: new Date(`${next}T18:00:00+08:00`).toISOString() };
}
