import { describe, expect, it } from 'vitest';
import type { ContractBase } from './types/contract';
import {
    LARGE_TRADE_MAX_ROWS,
    LARGE_TRADE_RULE_VERSION,
    createTickTapeLargeTradeState,
    ingestTickTapeEvent,
    nearestRankP70,
    replayTickTapeEvents,
    type TickTapeEventInput,
} from './tick-tape-large-trade';

const stock: ContractBase = {
    region: 'TW', exchange: 'TSE', code: '2330', security_type: 'STK', target_code: null,
};

function event(overrides: Partial<TickTapeEventInput> = {}): TickTapeEventInput {
    return {
        contract: stock,
        generation: 1,
        source: 'live',
        date: '2026-09-10',
        time: '10:00:00.123456',
        close: 200,
        volume: 5,
        tickType: 1,
        ...overrides,
    };
}

function ingestMany(inputs: TickTapeEventInput[]) {
    return inputs.reduce(
        (state, input) => ingestTickTapeEvent(state, input),
        createTickTapeLargeTradeState(stock, 1),
    );
}

describe('大單分類核心', () => {
    it('15 元、200 元與 400 元股票採 40 萬或 5 張價值，且邊界含等號', () => {
        const low = ingestMany([
            event({ close: 15, volume: 26, time: '10:00:01' }),
            event({ close: 15, volume: 27, time: '10:00:02' }),
        ]);
        expect(low.rows[1]?.isLarge).toBe(false);
        expect(low.rows[0]).toMatchObject({ isLarge: true, thresholdAtDetection: 400_000 });

        const middle = ingestMany([event({ close: 200, volume: 5 })]);
        expect(middle.rows[0]).toMatchObject({ isLarge: true, thresholdAtDetection: 1_000_000 });

        const high = ingestMany([
            event({ close: 400, volume: 4, time: '10:00:01' }),
            event({ close: 400, volume: 5, time: '10:00:02' }),
        ]);
        expect(high.rows[1]?.isLarge).toBe(false);
        expect(high.rows[0]).toMatchObject({ isLarge: true, thresholdAtDetection: 2_000_000 });
    });

    it('第 30 筆完成暖機，第 31 筆使用前置 P70 且候選不影響自己的門檻', () => {
        const warmup = Array.from({ length: 30 }, (_, index) => event({
            close: 100,
            volume: index < 21 ? 5 : 20,
            time: `10:00:${String(index).padStart(2, '0')}`,
        }));
        const state = ingestMany([
            ...warmup,
            event({ close: 100, volume: 100, time: '10:01:00' }),
        ]);
        expect(state.rows[0]).toMatchObject({
            isLarge: true,
            thresholdAtDetection: 500_000,
            tradeAmountTwd: 10_000_000,
        });
        expect(state.sampleAmounts).toHaveLength(31);
        expect(nearestRankP70(warmup.map((input) => Number(input.close) * input.volume * 1_000)))
            .toBe(500_000);
    });

    it('P70 高於固定門檻時採動態門檻，樣本只保留最近 120 筆', () => {
        const state = ingestMany([
            ...Array.from({ length: 130 }, (_, index) => event({
                close: 100,
                volume: 20,
                time: `10:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}`,
            })),
            event({ close: 100, volume: 19, time: '10:03:00' }),
        ]);
        expect(state.sampleAmounts).toHaveLength(120);
        expect(state.rows[0]).toMatchObject({ isLarge: false, thresholdAtDetection: 2_000_000 });
    });

    it.each([
        ['零量', { volume: 0 }, 'invalid_volume'],
        ['負價格', { close: -1 }, 'invalid_price'],
        ['盤中零股', { intradayOdd: true }, 'odd_lot'],
        ['試撮', { simtrade: true }, 'simtrade'],
        ['開盤集合競價', { time: '09:00:00' }, 'outside_continuous_session'],
        ['收盤集合競價', { time: '13:25:00' }, 'outside_continuous_session'],
    ])('%s fail closed', (_label, overrides, reason) => {
        const state = ingestMany([event(overrides)]);
        expect(state.rows[0]).toMatchObject({ isLarge: false, eligibilityReason: reason });
        expect(state.sampleAmounts).toHaveLength(0);
    });

    it('不支援非台股 STK 商品', () => {
        const future = { ...stock, exchange: 'TAIFEX' as const, security_type: 'FUT' as const, code: 'TXFR1' };
        const state = ingestTickTapeEvent(
            createTickTapeLargeTradeState(future, 1),
            event({ contract: future }),
        );
        expect(state.rows[0]).toMatchObject({
            isLarge: false,
            eligibilityReason: 'unsupported_contract',
        });
        expect(state.sampleAmounts).toHaveLength(0);
    });

    it('history/live 相同鍵只分類一次，歷史輸入會先依時序回放', () => {
        const same = event({ source: 'history', time: '10:00:02' });
        const state = replayTickTapeEvents(stock, 1, [
            event({ source: 'history', time: '10:00:03', volume: 6 }),
            same,
            { ...same, source: 'live' },
            event({ source: 'history', time: '10:00:01', volume: 4 }),
        ]);
        expect(state.rows).toHaveLength(3);
        expect(state.sampleAmounts).toHaveLength(3);
        expect(state.rows.map((row) => row.time)).toEqual([
            '10:00:03.000000', '10:00:02.000000', '10:00:01.000000',
        ]);
    });

    it('分類證據不可變，重播不會重算或重複記錄', () => {
        const first = event({ close: 200, volume: 5 });
        let state = ingestMany([first]);
        const evidence = state.largeRows[0];
        state = ingestTickTapeEvent(state, first);
        expect(state.largeRows).toHaveLength(1);
        expect(state.largeRows[0]).toBe(evidence);
        expect(evidence).toMatchObject({ ruleVersion: LARGE_TRADE_RULE_VERSION });
    });

    it('隔離舊 generation 與舊交易日，向前切換時重設', () => {
        let state = ingestMany([event()]);
        state = ingestTickTapeEvent(state, event({ generation: 2, date: '2026-09-11' }));
        expect(state).toMatchObject({ generation: 2, tradeDate: '2026-09-11' });
        expect(state.rows).toHaveLength(1);
        const current = state;
        expect(ingestTickTapeEvent(state, event({ generation: 1 }))).toBe(current);
        expect(ingestTickTapeEvent(state, event({ generation: 2, date: '2026-09-10' }))).toBe(current);
    });

    it('全部、大單與去重記憶體均維持上限', () => {
        const state = ingestMany(Array.from({ length: LARGE_TRADE_MAX_ROWS + 1 }, (_, index) => event({
            close: 200,
            volume: 50,
            time: `${String(9 + Math.floor(index / 3600)).padStart(2, '0')}:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}`,
        })));
        expect(state.rows).toHaveLength(120);
        expect(state.largeRows).toHaveLength(LARGE_TRADE_MAX_ROWS);
        expect(state.sampleAmounts).toHaveLength(120);
    });
});
