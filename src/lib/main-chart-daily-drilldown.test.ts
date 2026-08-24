import { describe, expect, it } from 'vitest';
import {
    TargetDateSingleFlight,
    type ValidatedTargetDateResponse,
} from './daily-minute-drilldown-contract';
import {
    loadMainChartTargetDate,
    mainChartDailyTargetEligible,
    mainChartTargetDateReasonMessage,
} from './main-chart-daily-drilldown';
import type { Candle } from './types/market';

const targetDate = '2026-08-21';
const firstTime = Date.UTC(2026, 7, 21, 1, 0) / 1000;

function candle(time = firstTime): Candle {
    return {
        time,
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 12,
    };
}

describe('主交易畫面指定日期 simulation loader', () => {
    it('forming 今日棒與未支援商品 fail closed，歷史台股日 K 可進入', () => {
        const beforeClose = Date.parse('2026-08-24T05:29:59Z');
        const afterClose = Date.parse('2026-08-24T05:30:00Z');
        expect(
            mainChartDailyTargetEligible({
                targetDate: '2026-08-24',
                securityType: 'STK',
                nowMs: beforeClose,
            }),
        ).toBe(false);
        expect(
            mainChartDailyTargetEligible({
                targetDate: '2026-08-24',
                securityType: 'STK',
                nowMs: afterClose,
            }),
        ).toBe(true);
        expect(
            mainChartDailyTargetEligible({
                targetDate: '2026-08-23',
                securityType: 'IND',
                nowMs: beforeClose,
            }),
        ).toBe(true);
        expect(
            mainChartDailyTargetEligible({
                targetDate: '2026-08-23',
                securityType: 'FUT',
                nowMs: afterClose,
            }),
        ).toBe(false);
    });

    it('先重驗 simulation，再以同日有界 Kbars 建立 current response', async () => {
        const order: string[] = [];
        const result = await loadMainChartTargetDate({
            symbol: '2330',
            targetDate,
            generation: 7,
            getInfo: async () => {
                order.push('info');
                return { simulation: true };
            },
            getKbars: async (request) => {
                order.push(`kbars:${request.startDate}:${request.endDate}`);
                return { rows: 1 };
            },
            normalizeKbars: () => [candle()],
        });
        expect(order).toEqual([
            'info',
            `kbars:${targetDate}:${targetDate}`,
        ]);
        expect(result).toMatchObject({
            status: 'accepted',
            request: {
                symbol: '2330',
                targetDate,
                targetInterval: '1m',
                maxCandles: 600,
            },
            response: {
                symbol: '2330',
                targetDate,
                mode: 'simulation',
                candles: [{ sessionDate: targetDate, volume: 12 }],
            },
        });
    });

    it('相同商品／日期跨 generation 共用一次 info 與 Kbars read', async () => {
        const singleFlight =
            new TargetDateSingleFlight<ValidatedTargetDateResponse>();
        let infoCalls = 0;
        let kbarCalls = 0;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const common = {
            symbol: '2330',
            targetDate,
            getInfo: async () => {
                infoCalls += 1;
                return { simulation: true };
            },
            getKbars: async () => {
                kbarCalls += 1;
                await gate;
                return {};
            },
            normalizeKbars: () => [candle()],
            singleFlight,
        };
        const first = loadMainChartTargetDate({ ...common, generation: 7 });
        const second = loadMainChartTargetDate({ ...common, generation: 8 });
        await Promise.resolve();
        release();
        await expect(first).resolves.toMatchObject({ status: 'accepted' });
        await expect(second).resolves.toMatchObject({ status: 'accepted' });
        expect(infoCalls).toBe(1);
        expect(kbarCalls).toBe(1);
    });

    it('非 simulation 在任何 Kbars read 前 fail closed', async () => {
        let kbarCalls = 0;
        const result = await loadMainChartTargetDate({
            symbol: '2330',
            targetDate,
            generation: 7,
            getInfo: async () => ({ simulation: false }),
            getKbars: async () => {
                kbarCalls += 1;
                return {};
            },
            normalizeKbars: () => [candle()],
        });
        expect(result).toEqual({
            status: 'rejected',
            targetDate,
            reason: 'simulation_required',
        });
        expect(kbarCalls).toBe(0);
    });

    it('當日與歷史日使用相同 exact-date contract，且 response 不攜帶額外欄位', async () => {
        const today = '2026-08-24';
        const todayTime = Date.UTC(2026, 7, 24, 1, 0) / 1000;
        const row = {
            ...candle(todayTime),
            account_id: 'must-not-project',
        } as Candle;
        const result = await loadMainChartTargetDate({
            symbol: '2330',
            targetDate: today,
            generation: 9,
            getInfo: async () => ({ simulation: true }),
            getKbars: async (request) => ({
                start: request.startDate,
                end: request.endDate,
            }),
            normalizeKbars: () => [row],
        });
        expect(result).toMatchObject({
            status: 'accepted',
            request: { startDate: today, endDate: today },
            response: { candles: [{ sessionDate: today }] },
        });
        expect(JSON.stringify(result)).not.toContain('account_id');
        expect(JSON.stringify(result)).not.toContain('must-not-project');
    });

    it('混日／空資料／來源錯誤都保留可辨識 reason', async () => {
        const common = {
            symbol: '2330',
            targetDate,
            generation: 7,
            getInfo: async () => ({ simulation: true }),
            getKbars: async () => ({}),
        };
        await expect(
            loadMainChartTargetDate({
                ...common,
                normalizeKbars: () => [candle(firstTime + 86_400)],
            }),
        ).resolves.toMatchObject({
            status: 'rejected',
            reason: 'mixed_session_date',
        });
        await expect(
            loadMainChartTargetDate({
                ...common,
                normalizeKbars: () => [],
            }),
        ).resolves.toMatchObject({
            status: 'rejected',
            reason: 'empty_response',
        });
        await expect(
            loadMainChartTargetDate({
                ...common,
                getKbars: async () => {
                    throw new Error('redacted transport failure');
                },
                normalizeKbars: () => [candle()],
            }),
        ).resolves.toEqual({
            status: 'rejected',
            targetDate,
            reason: 'source_unavailable',
        });
        expect(mainChartTargetDateReasonMessage('simulation_required')).toContain(
            'simulation',
        );
    });
});
