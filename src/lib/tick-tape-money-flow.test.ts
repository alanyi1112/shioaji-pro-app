import { describe, expect, it } from 'vitest';
import type { TickTapeRow } from './tick-tape-large-trade';
import { MoneyFlowAccumulator } from './tick-tape-money-flow';

const row = (overrides: Partial<TickTapeRow> = {}): TickTapeRow => ({
    tradeKey: 'fixture',
    contractKey: 'STK:TSE:2330',
    generation: 1,
    source: 'history',
    tradeDate: '2026-09-22',
    time: '10:00:00.000001',
    close: 100,
    volume: 10,
    tickType: 1,
    intradayOdd: false,
    simtrade: false,
    tradeAmountTwd: 1_000_000,
    thresholdAtDetection: null,
    isLarge: false,
    eligibilityReason: 'eligible',
    ruleVersion: 'fixture',
    ...overrides,
});

describe('即時資金流向增量彙總', () => {
    it('以整數新台幣累計買賣方向，且每點精確滿足整體等於大單加非大單', () => {
        const accumulator = new MoneyFlowAccumulator();
        accumulator.append(row({ tradeAmountTwd: 1_000_001, tickType: 1, isLarge: true }));
        accumulator.append(row({ tradeKey: 'sell', tradeAmountTwd: 200_003, tickType: 2 }));
        const snapshot = accumulator.snapshot();
        expect(snapshot).toMatchObject({
            overallNetTwd: 799_998,
            largeNetTwd: 1_000_001,
            nonLargeNetTwd: -200_003,
        });
        expect(snapshot.points).toHaveLength(1);
        for (const point of snapshot.points) {
            expect(point.overallNetTwd).toBe(point.largeNetTwd + point.nonLargeNetTwd);
            expect(Number.isSafeInteger(point.overallNetTwd)).toBe(true);
        }
    });

    it('未知方向只累加摘要，不改變三種淨額', () => {
        const accumulator = new MoneyFlowAccumulator();
        accumulator.append(row({ tickType: 0, tradeAmountTwd: 333_330, isLarge: true }));
        accumulator.append(row({ tradeKey: 'unknown-2', tickType: 3, tradeAmountTwd: 100_000 }));
        expect(accumulator.snapshot()).toMatchObject({
            overallNetTwd: 0,
            largeNetTwd: 0,
            nonLargeNetTwd: 0,
            unknownDirectionAmountTwd: 433_330,
            unknownDirectionCount: 2,
            points: [{ minute: '10:00', minuteIndex: 600 }],
            unknownTrades: [
                { tradeDate: '2026-09-22', time: '10:00:00.000001', close: 100, volume: 10, tickType: 0, tradeAmountTwd: 333_330, source: 'history' },
                { tradeDate: '2026-09-22', time: '10:00:00.000001', close: 100, volume: 10, tickType: 3, tradeAmountTwd: 100_000, source: 'history' },
            ],
        });
    });

    it('未知方向明細最多保留最近 100 筆，但摘要仍計入全部合格成交', () => {
        const accumulator = new MoneyFlowAccumulator();
        for (let index = 0; index < 105; index += 1) {
            accumulator.append(row({
                tradeKey: `unknown-${index}`,
                time: `10:00:${String(index % 60).padStart(2, '0')}.${String(index).padStart(6, '0')}`,
                tickType: 0,
                source: index === 104 ? 'live' : 'history',
            }));
        }
        const snapshot = accumulator.snapshot();
        expect(snapshot.unknownDirectionCount).toBe(105);
        expect(snapshot.unknownDirectionAmountTwd).toBe(105_000_000);
        expect(snapshot.unknownTrades).toHaveLength(100);
        expect(snapshot.unknownTrades[0]?.time).toBe('10:00:05.000005');
        expect(snapshot.unknownTrades.at(-1)).toMatchObject({ time: '10:00:44.000104', source: 'live' });
        expect(snapshot.overallNetTwd).toBe(0);
    });

    it('同分鐘只更新最後點，跨分鐘保留真實時間位置且不補造空分鐘', () => {
        const accumulator = new MoneyFlowAccumulator();
        accumulator.append(row({ time: '09:01:00.000001', tradeAmountTwd: 100_000 }));
        accumulator.append(row({ time: '09:01:59.999999', tradeAmountTwd: 200_000 }));
        accumulator.append(row({ time: '09:07:00.000001', tradeAmountTwd: 300_000 }));
        expect(accumulator.snapshot().points).toEqual([
            { minute: '09:01', minuteIndex: 541, overallNetTwd: 300_000, largeNetTwd: 0, nonLargeNetTwd: 300_000 },
            { minute: '09:07', minuteIndex: 547, overallNetTwd: 600_000, largeNetTwd: 0, nonLargeNetTwd: 600_000 },
        ]);
    });

    it('開盤瞬間與 13:25 起合法成交納入整體及非大單，但不會成為大單', () => {
        const accumulator = new MoneyFlowAccumulator();
        accumulator.append(row({ time: '09:00:00.000000', isLarge: false, tradeAmountTwd: 500_000 }));
        accumulator.append(row({ time: '13:25:00.000000', isLarge: false, tradeAmountTwd: 200_000 }));
        expect(accumulator.snapshot()).toMatchObject({
            overallNetTwd: 700_000,
            largeNetTwd: 0,
            nonLargeNetTwd: 700_000,
        });
    });

    it.each([
        row({ close: Number.NaN }),
        row({ volume: 0 }),
        row({ tradeAmountTwd: Number.NaN }),
        row({ intradayOdd: true }),
        row({ simtrade: true }),
        row({ time: '14:00:00.000000' }),
        row({ contractKey: 'FUT:TAIFEX:TXFR1' }),
    ])('不合格事件 fail closed', (input) => {
        const accumulator = new MoneyFlowAccumulator();
        expect(accumulator.append(input)).toBe(false);
        expect(accumulator.snapshot()).toEqual(expect.objectContaining({ revision: 0, points: [] }));
    });

    it('無更新時重用 snapshot，亂序輸入要求先由 session replay 排序', () => {
        const accumulator = new MoneyFlowAccumulator();
        accumulator.append(row({ time: '10:01:00.000000' }));
        const first = accumulator.snapshot();
        expect(accumulator.snapshot()).toBe(first);
        expect(() => accumulator.append(row({ time: '10:00:00.000000' })))
            .toThrow('必須依時間排序');
    });

    it('安全整數溢位時不留下部分套用的成交', () => {
        const accumulator = new MoneyFlowAccumulator();
        accumulator.append(row({ tradeAmountTwd: Number.MAX_SAFE_INTEGER - 100, isLarge: true }));
        const before = accumulator.snapshot();
        expect(() => accumulator.append(row({
            tradeKey: 'overflow',
            time: '10:00:01.000000',
            tradeAmountTwd: 200,
            isLarge: true,
        }))).toThrow('安全整數範圍');
        expect(accumulator.snapshot()).toBe(before);
    });

    it.each([100_000, 500_000])('%i 筆 fixture 與獨立整數 oracle 完全一致', (count) => {
        const accumulator = new MoneyFlowAccumulator();
        let overall = 0;
        let large = 0;
        let unknownAmount = 0;
        let unknownCount = 0;
        const expectedPoints: Array<{
            minute: string;
            minuteIndex: number;
            overallNetTwd: number;
            largeNetTwd: number;
            nonLargeNetTwd: number;
        }> = [];
        const perMinute = Math.ceil(count / 300);
        for (let index = 0; index < count; index += 1) {
            const minuteIndex = 9 * 60 + Math.floor(index / perMinute);
            const minute = `${String(Math.floor(minuteIndex / 60)).padStart(2, '0')}:${String(minuteIndex % 60).padStart(2, '0')}`;
            const amount = 100_000 + (index % 37) * 10;
            const tickType = index % 11 === 0 ? 0 : index % 3 === 0 ? 2 : 1;
            const isLarge = index % 7 === 0;
            accumulator.append(row({
                tradeKey: `scale-${index}`,
                time: `${minute}:00.000000`,
                tradeAmountTwd: amount,
                tickType,
                isLarge,
            }));
            const sign = tickType === 1 ? 1 : tickType === 2 ? -1 : 0;
            overall += amount * sign;
            if (isLarge) large += amount * sign;
            if (sign === 0) { unknownAmount += amount; unknownCount += 1; }
            const point = { minute, minuteIndex, overallNetTwd: overall, largeNetTwd: large, nonLargeNetTwd: overall - large };
            if (expectedPoints.at(-1)?.minuteIndex === minuteIndex) expectedPoints[expectedPoints.length - 1] = point;
            else expectedPoints.push(point);
        }
        expect(accumulator.snapshot()).toMatchObject({
            overallNetTwd: overall,
            largeNetTwd: large,
            nonLargeNetTwd: overall - large,
            unknownDirectionAmountTwd: unknownAmount,
            unknownDirectionCount: unknownCount,
            points: expectedPoints,
        });
    }, 20_000);
});
