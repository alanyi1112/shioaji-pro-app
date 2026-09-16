import { describe, expect, it } from 'vitest';

import { createPremarketScheduleReceipt, formatTaipeiLocalTime,
    nextApplicableTradeDate, taipeiLocalToUtc } from './premarket-schedule.mjs';

const calendar = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21'];

function receipt(overrides = {}) {
    return createPremarketScheduleReceipt({
        requestedTradeDate: '2026-09-16', requestedLocalTime: '08:45',
        schedulerId: 'local.premarket.160', computedFireAt: '2026-09-16T00:45:00.000Z',
        readBackAt: '2026-09-15T14:00:00+08:00', officialTradingDates: calendar,
        ...overrides,
    });
}

describe('盤前排程台北時間 receipt', () => {
    it('固定以 Asia/Taipei 產生 canonical UTC 並通過 read-back', () => {
        expect(receipt()).toMatchObject({
            tradeDate: '2026-09-16', requestedLocalTime: '08:45:00',
            timeZone: 'Asia/Taipei', scheduledForUtc: '2026-09-16T00:45:00.000Z',
            computedLocalTime: '2026-09-16 08:45:00',
            consistency: { status: 'ready', reasons: [] },
        });
    });

    it('台灣無夏令時間，冬季與夏季都維持 UTC+8', () => {
        expect(taipeiLocalToUtc('2026-01-15', '08:20')).toBe('2026-01-15T00:20:00.000Z');
        expect(taipeiLocalToUtc('2026-07-15', '08:20')).toBe('2026-07-15T00:20:00.000Z');
        expect(formatTaipeiLocalTime('2026-07-15T00:20:00Z')).toBe('2026-07-15 08:20:00');
    });

    it('scheduler 把 08:45 誤當 UTC 時 fail closed 並保存八小時偏移', () => {
        expect(receipt({ computedFireAt: '2026-09-16T08:45:00Z' })).toMatchObject({
            computedLocalTime: '2026-09-16 16:45:00',
            consistency: { status: 'invalid', reasons: ['scheduler_computed_local_time_mismatch'] },
            incident: { code: 'scheduler_computed_local_time_mismatch' },
        });
    });

    it('UTC instant 跨日仍回讀成要求的台北交易日', () => {
        expect(receipt({ requestedLocalTime: '00:15',
            computedFireAt: '2026-09-15T16:15:00Z' })).toMatchObject({
            scheduledForUtc: '2026-09-15T16:15:00.000Z',
            computedLocalTime: '2026-09-16 00:15:00',
            consistency: { status: 'ready' },
        });
    });

    it('非交易日會拒絕，明確要求時才解析到下一適用交易日', () => {
        expect(receipt({ requestedTradeDate: '2026-09-19',
            computedFireAt: '2026-09-19T00:45:00Z' })).toMatchObject({
            tradeDate: null,
            consistency: { status: 'invalid', reasons: ['requested_date_is_not_an_applicable_trade_date'] },
        });
        expect(nextApplicableTradeDate('2026-09-19', calendar)).toBe('2026-09-21');
        expect(receipt({ requestedTradeDate: '2026-09-19', useNextApplicableTradeDate: true,
            computedFireAt: '2026-09-21T00:45:00Z' })).toMatchObject({
            tradeDate: '2026-09-21', usedNextApplicableTradeDate: true,
            consistency: { status: 'ready' },
        });
    });

    it('觸發時間已過卻沒有一致 run claim 時建立 incident', () => {
        const missing = receipt({ readBackAt: '2026-09-16T08:46:00+08:00' });
        expect(missing).toMatchObject({ fireTimePassed: true, runClaimRequired: true,
            runClaimMatches: false,
            consistency: { status: 'invalid', reasons: ['scheduler_run_missing'] },
            incident: { code: 'scheduler_run_missing' } });
        expect(receipt({ readBackAt: '2026-09-16T08:46:00+08:00',
            runClaim: { tradeDate: '2026-09-16', schedulerId: 'local.premarket.160', runId: 'run-1' },
        })).toMatchObject({ runClaimMatches: true, consistency: { status: 'ready' } });
    });
});
