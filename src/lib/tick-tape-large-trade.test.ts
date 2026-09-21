import { expect, it } from 'vitest';
import { historyTickTapeInputs, normalizeTickTapeEvent, normalizeTickTapeDate, normalizeTickTapeTime } from './tick-tape-large-trade';
import type { ContractBase } from './types/contract';
const stock: ContractBase = { region: 'TW', exchange: 'TSE', code: '2330', security_type: 'STK', target_code: null };
it('拒收非法日期與時間，保留微秒', () => {
    expect(normalizeTickTapeDate('2026-02-30')).toBeNull();
    expect(normalizeTickTapeTime('24:00:00')).toBeNull();
    expect(normalizeTickTapeTime('09:00:00.123456')).toBe('09:00:00.123456');
});
it('歷史可選成交性質旗標不遺失', () => {
    const inputs = historyTickTapeInputs(stock, {
        datetime: ['2026-09-11T10:00:00.123456'], close: [100], volume: [10], tick_type: [1],
        bid_price: [], bid_volume: [], ask_price: [], ask_volume: [], simtrade: [true], intraday_odd: [true],
    }, 3);
    expect(normalizeTickTapeEvent(inputs[0]!)).toMatchObject({ generation: 3, simtrade: true, intradayOdd: true });
});
