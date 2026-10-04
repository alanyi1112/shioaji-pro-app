import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { buildOfficialMarketCalendarSnapshot, parseTpexOfficialCalendar,
    parseTwseOfficialCalendar } from '../smart-order-runtime/official-market-calendar-core.mjs';
import { hashDirect160 } from './direct-160-storage.mjs';
import { resolveIntradayMonitorPremarketTradingDay, resolveIntradayMonitorTradingDay,
    selectIntradayMonitorTradingDay } from './trading-calendar-authority.mjs';

const twsePayload = {
    stat: 'ok', date: '20260101', title: '115 年市場開休市日期',
    fields: ['日期', '名稱', '說明'],
    data: [
        ['2026-01-01', '中華民國開國紀念日', '依規定放假1日。'],
        ['2026-01-02', '國曆新年開始交易日', '國曆新年開始交易。'],
    ],
    queryYear: 2026, total: 2,
};
const twseOpenApiPayload = [
    { Date: '1150101', Name: '中華民國開國紀念日', Description: '依規定放假1日。' },
    { Date: '1150102', Name: '國曆新年開始交易日', Description: '國曆新年開始交易。' },
];
const tpexPayload = { data: { html: `
    <table class="page-table"><tr><td>中華民國115年有價證券櫃檯買賣市場開（休）市日期表</td></tr></table>
    <table class="page-table">
      <tr><th>紀念節日名稱</th><th>日期</th><th>星期</th><th>說明</th></tr>
      <tr><td>中華民國開國紀念日</td><td>1月1日</td><td>四</td><td>依規定放假1日。</td></tr>
      <tr><td>國曆新年開始交易日</td><td>1月2日</td><td>五</td><td>國曆新年開始交易。</td></tr>
    </table>
` } };
const response = (payload) => ({ ok: true, status: 200, json: async () => payload });

function snapshot(year, days) {
    return {
        calendarVersion: `${year}-${'a'.repeat(64)}`,
        days,
    };
}

async function localBaseline(root, { fetchedAt = Date.parse('2026-09-21T14:00:00+08:00'),
    previousTradeDate = '2026-09-21', targetTradeDate = '2026-09-22' } = {}) {
    const directory = path.join(root, 'intraday-baselines',
        `${previousTradeDate}-for-${targetTradeDate}-verified`);
    await mkdir(directory, { recursive: true });
    const official = buildOfficialMarketCalendarSnapshot({
        twse: parseTwseOfficialCalendar(twsePayload, 2026),
        tpex: parseTpexOfficialCalendar(tpexPayload, 2026),
        fetchedAtEpochMs: fetchedAt,
    });
    const body = { schemaVersion: 'intraday-monitor-direct-160-baseline-set/1',
        baselineUsable: true, manifests: Array.from({ length: 160 }, (_, index) => ({ index })),
        calendar: { twse: twsePayload, tpex: tpexPayload,
            fetchedAtEpochMs: fetchedAt, previousTradeDate, targetTradeDate,
            sourceVersion: official.calendarVersion } };
    const file = path.join(directory, 'baseline-set.json');
    await writeFile(file, JSON.stringify({ ...body, baselineHash: hashDirect160(body, 'bundle') }));
    return file;
}

describe('盤中監控官方交易日 authority', () => {
    it('盤前從前一交易日已驗證的本機雙市場日曆判定，不向網站發請求', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'premarket-calendar-local-'));
        try {
            await localBaseline(root);
            const trading = await resolveIntradayMonitorPremarketTradingDay({ root,
                now: new Date('2026-09-22T08:20:00+08:00') });
            expect(trading).toMatchObject({ current: true, tradeDate: '2026-09-22',
                previousTradeDate: '2026-09-21', isTradingDate: true,
                authorityKind: 'verified_postclose_local_snapshot' });
            const weekend = await resolveIntradayMonitorPremarketTradingDay({ root,
                now: new Date('2026-09-26T08:20:00+08:00') });
            expect(weekend).toMatchObject({ current: true, isTradingDate: false });
        } finally { await rm(root, { recursive: true, force: true }); }
    });

    it('本機來源過期或 hash 被改動時 fail closed，不回退成網路即時查詢', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'premarket-calendar-invalid-'));
        try {
            const file = await localBaseline(root);
            const stale = await resolveIntradayMonitorPremarketTradingDay({ root,
                now: new Date('2026-09-30T08:20:00+08:00') });
            expect(stale).toMatchObject({ current: false,
                reason: 'verified_calendar_snapshot_invalid_or_stale' });
            await writeFile(file, '{"schemaVersion":"tampered"}');
            const invalid = await resolveIntradayMonitorPremarketTradingDay({ root,
                now: new Date('2026-09-22T08:20:00+08:00') });
            expect(invalid.current).toBe(false);
        } finally { await rm(root, { recursive: true, force: true }); }
    });
    it('官方來源短暫失敗後在同一時點有界重試，仍須雙來源完整驗證', async () => {
        let twseFailures = 0;
        const fetchImpl = vi.fn(async (url) => {
            if (url.includes('twse.com.tw') && twseFailures++ < 2) {
                throw new Error('fetch failed');
            }
            return response(url.includes('openapi.twse.com.tw')
                ? twseOpenApiPayload : url.includes('twse.com.tw') ? twsePayload : tpexPayload);
        });
        const result = await resolveIntradayMonitorTradingDay({
            now: new Date('2026-09-22T08:20:00+08:00'), fetchImpl,
        });
        expect(result).toMatchObject({ current: true, tradeDate: '2026-09-22',
            previousTradeDate: '2026-09-21', isTradingDate: true });
        expect(fetchImpl).toHaveBeenCalledTimes(5);
        for (const [, options] of fetchImpl.mock.calls) {
            expect(options.signal).toBeInstanceOf(AbortSignal);
            expect(options.redirect).toBe('error');
        }
    });

    it('三次皆失敗時維持 calendar authority 不可用，不猜測交易日', async () => {
        const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed'));
        const result = await resolveIntradayMonitorTradingDay({
            now: new Date('2026-09-22T08:20:00+08:00'), fetchImpl,
        });
        expect(fetchImpl).toHaveBeenCalledTimes(9);
        expect(result).toMatchObject({ current: false, tradeDate: '2026-09-22',
            previousTradeDate: null, isTradingDate: null, reason: 'fetch failed',
            brokerWriteAuthority: false, productionAuthority: false });
    });

    it('優先使用 TWSE 官方 OpenAPI，舊端點回 HTML 不影響當日 rollover', async () => {
        const fetchImpl = vi.fn(async (url) => url.includes('openapi.twse.com.tw')
            ? response(twseOpenApiPayload)
            : url.includes('twse.com.tw')
                ? { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }
                : response(tpexPayload));
        const result = await resolveIntradayMonitorTradingDay({
            now: new Date('2026-09-22T08:20:00+08:00'), fetchImpl,
        });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(fetchImpl.mock.calls.some(([url]) => url.includes('www.twse.com.tw'))).toBe(false);
        expect(result).toMatchObject({ current: true, isTradingDate: true,
            previousTradeDate: '2026-09-21' });
    });

    it('OpenAPI schema 不合法時仍須改用另一個官方年度來源完整驗證', async () => {
        const fetchImpl = vi.fn(async (url) => response(url.includes('openapi.twse.com.tw')
            ? [{ Date: '1140101', Name: '錯誤年份', Description: '錯誤年份' }]
            : url.includes('twse.com.tw') ? twsePayload : tpexPayload));
        const result = await resolveIntradayMonitorTradingDay({
            now: new Date('2026-09-22T08:20:00+08:00'), fetchImpl,
        });
        expect(result).toMatchObject({ current: true, isTradingDate: true });
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('兩個 TWSE 官方端點都不可用時仍 fail closed', async () => {
        const fetchImpl = vi.fn(async (url) => url.includes('twse.com.tw')
            ? { ok: false, status: 403 } : response(tpexPayload));
        const result = await resolveIntradayMonitorTradingDay({
            now: new Date('2026-09-22T08:20:00+08:00'), fetchImpl,
        });
        expect(result).toMatchObject({ current: false, isTradingDate: null,
            reason: 'calendar_authority_unavailable' });
    });

    it('來源未回應也會在有限時間內停止並維持 fail-closed', async () => {
        vi.useFakeTimers();
        try {
            const fetchImpl = vi.fn(() => new Promise(() => {}));
            const resultPromise = resolveIntradayMonitorTradingDay({
                now: new Date('2026-09-22T08:20:00+08:00'), fetchImpl,
            });
            await vi.advanceTimersByTimeAsync(13_000);
            const result = await resultPromise;
            expect(fetchImpl).toHaveBeenCalledTimes(6);
            expect(result).toMatchObject({ current: false, isTradingDate: null,
                reason: 'calendar_fetch_timeout' });
        } finally { vi.useRealTimers(); }
    });

    it('以 Asia/Taipei 官方共同開市日解析當日及上一適用交易日', () => {
        expect(selectIntradayMonitorTradingDay({
            tradeDate: '2026-09-22',
            snapshots: [snapshot(2026, [
                { tradeDate: '2026-09-21', TSE: 'scheduled_trading', OTC: 'scheduled_trading' },
                { tradeDate: '2026-09-22', TSE: 'scheduled_trading', OTC: 'scheduled_trading' },
            ])],
            observedAt: '2026-09-22T00:20:00.000Z',
        })).toMatchObject({
            current: true,
            tradeDate: '2026-09-22',
            previousTradeDate: '2026-09-21',
            isTradingDate: true,
        });
    });

    it('非交易日仍保留官方 authority 與上一交易日，供 no-op receipt 使用', () => {
        expect(selectIntradayMonitorTradingDay({
            tradeDate: '2026-09-26',
            snapshots: [snapshot(2026, [
                { tradeDate: '2026-09-25', TSE: 'scheduled_trading', OTC: 'scheduled_trading' },
                { tradeDate: '2026-09-26', TSE: 'closed', OTC: 'closed' },
            ])],
            observedAt: '2026-09-26T00:20:00.000Z',
        })).toMatchObject({ current: true, isTradingDate: false, previousTradeDate: '2026-09-25' });
    });

    it('跨年時可從前一年 snapshot 取得 previous trade date', () => {
        expect(selectIntradayMonitorTradingDay({
            tradeDate: '2027-01-04',
            snapshots: [
                snapshot(2026, [{ tradeDate: '2026-12-31', TSE: 'scheduled_trading', OTC: 'scheduled_trading' }]),
                snapshot(2027, [{ tradeDate: '2027-01-04', TSE: 'scheduled_trading', OTC: 'scheduled_trading' }]),
            ],
            observedAt: '2027-01-04T00:20:00.000Z',
        })).toMatchObject({ previousTradeDate: '2026-12-31', isTradingDate: true });
    });
});
