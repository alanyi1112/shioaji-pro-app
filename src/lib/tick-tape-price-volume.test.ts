import { describe, expect, it } from 'vitest';
import { PriceVolumeDistributionAccumulator } from './tick-tape-price-volume';
import type { TickTapeRow } from './tick-tape-large-trade';

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

describe('分價量表增量彙總', () => {
    it('依價位與方向彙總，使用共同總量計算均價及兩種佔比', () => {
        const accumulator = new PriceVolumeDistributionAccumulator();
        accumulator.append(row({ close: 100, volume: 10, tickType: 1 }));
        accumulator.append(row({ close: 100, volume: 5, tickType: 2, isLarge: true }));
        accumulator.append(row({ close: 101, volume: 5, tickType: 0, isLarge: true }));
        const result = accumulator.snapshot();
        expect(result).toMatchObject({
            totalVolume: 20,
            largeVolume: 10,
            totalAveragePrice: 100.25,
            largeAveragePrice: 100.5,
            maximumBucketVolume: 15,
            openPrice: 100,
            currentPrice: 101,
            highPrice: 101,
            lowPrice: 100,
        });
        expect(result.rows).toEqual([
            {
                price: 101,
                totalVolume: 5,
                buyVolume: 0,
                sellVolume: 0,
                unknownVolume: 5,
                largeVolume: 5,
                totalShare: 0.25,
                largeShare: 0.25,
                barRatio: 1 / 3,
                markers: ['high', 'current'],
            },
            {
                price: 100,
                totalVolume: 15,
                buyVolume: 10,
                sellVolume: 5,
                unknownVolume: 0,
                largeVolume: 5,
                totalShare: 0.75,
                largeShare: 0.25,
                barRatio: 1,
                markers: ['open', 'low'],
            },
        ]);
        expect(result.rows.reduce((sum, item) => sum + item.totalShare, 0)).toBe(1);
    });

    it('沒有成交與沒有大單都不產生假均價或除以零', () => {
        const empty = new PriceVolumeDistributionAccumulator().snapshot();
        expect(empty).toMatchObject({
            totalVolume: 0,
            totalAveragePrice: null,
            largeAveragePrice: null,
            rows: [],
        });
        const accumulator = new PriceVolumeDistributionAccumulator();
        accumulator.append(row({ close: 33.33, volume: 30 }));
        expect(accumulator.snapshot()).toMatchObject({
            totalAveragePrice: 33.33,
            largeAveragePrice: null,
        });
    });

    it('相同內容的獨立成交逐筆累加且 snapshot 在無更新時重用', () => {
        const accumulator = new PriceVolumeDistributionAccumulator();
        expect(accumulator.append(row())).toBe(true);
        expect(accumulator.append(row({ tradeKey: 'fixture#2' }))).toBe(true);
        const first = accumulator.snapshot();
        expect(first.totalVolume).toBe(20);
        expect(accumulator.snapshot()).toBe(first);
    });

    it.each([
        row({ close: Number.NaN }),
        row({ volume: 0 }),
        row({ intradayOdd: true }),
        row({ simtrade: true }),
        row({ time: '14:00:00.000000' }),
        row({ contractKey: 'FUT:TAIFEX:TXFR1' }),
    ])('不合格事件 fail closed', (input) => {
        const accumulator = new PriceVolumeDistributionAccumulator();
        expect(accumulator.append(input)).toBe(false);
        expect(accumulator.snapshot().rows).toEqual([]);
    });

    it('多個標記落在同一價位時全部保留', () => {
        const accumulator = new PriceVolumeDistributionAccumulator();
        accumulator.append(row({ close: 100, isLarge: true }));
        expect(accumulator.snapshot().rows[0]?.markers).toEqual([
            'high',
            'current',
            'open',
            'low',
        ]);
    });
});
