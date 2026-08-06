import { describe, expect, it } from 'vitest';
import { buildQuoteSummaryMetrics } from './quote-summary';

describe('buildQuoteSummaryMetrics', () => {
    it('依三列指定順序建立一般商品摘要並逐價位判色', () => {
        const metrics = buildQuoteSummaryMetrics({
            isIndex: false,
            reference: 193,
            open: 193.5,
            high: 199,
            low: 188.5,
            volume: 57791,
            limitUp: 212,
            limitDown: 174,
            time: '11:24:12',
            bid: 188.5,
            bidVolume: 276,
            ask: 189,
            askVolume: 301,
        });

        expect(metrics.map(({ label }) => label)).toEqual([
            '開',
            '高',
            '低',
            '量',
            '參考',
            '漲停',
            '跌停',
            '時間',
            '委買',
            '買量',
            '委賣',
            '賣量',
        ]);
        expect(metrics.map(({ value }) => value)).toEqual([
            '193.50',
            '199.00',
            '188.50',
            '57,791',
            '193.00',
            '212.00',
            '174.00',
            '11:24:12',
            '188.50',
            '276',
            '189.00',
            '301',
        ]);
        expect(metrics.map(({ tone }) => tone)).toEqual([
            'up',
            'up',
            'down',
            'neutral',
            'flat',
            'up',
            'down',
            'neutral',
            'down',
            'neutral',
            'down',
            'neutral',
        ]);
    });

    it('缺值維持欄位位置並以破折號與中性方向呈現', () => {
        const metrics = buildQuoteSummaryMetrics({ isIndex: false });
        expect(metrics).toHaveLength(12);
        expect(metrics.every(({ value }) => value === '—')).toBe(true);
        expect(
            metrics
                .filter(({ key }) =>
                    ['open', 'high', 'low', 'bid', 'ask'].includes(key),
                )
                .every(({ tone }) => tone === 'flat'),
        ).toBe(true);
    });

    it('指數價位相對 reference 判色，家數保留 category 色', () => {
        const metrics = buildQuoteSummaryMetrics({
            isIndex: true,
            reference: 20000,
            open: 19990,
            high: 20100,
            low: 19800,
            raiseCount: 500,
            flatCount: 100,
            fallCount: 300,
            limitUpCount: 5,
            noTradeCount: 12,
            limitDownCount: 2,
        });
        const tones = Object.fromEntries(
            metrics.map(({ key, tone }) => [key, tone]),
        );
        expect(tones.open).toBe('down');
        expect(tones.high).toBe('up');
        expect(tones.low).toBe('down');
        expect(tones['raise-count']).toBe('up');
        expect(tones['flat-count']).toBe('flat');
        expect(tones['fall-count']).toBe('down');
        expect(tones['no-trade-count']).toBe('neutral');
    });

    it('平盤價位使用 flat', () => {
        const metrics = buildQuoteSummaryMetrics({
            isIndex: false,
            reference: 193,
            open: 193,
            high: 193,
            low: 193,
            bid: 193,
            ask: 193,
        });
        expect(
            metrics
                .filter(({ key }) =>
                    ['open', 'high', 'low', 'bid', 'ask'].includes(key),
                )
                .every(({ tone }) => tone === 'flat'),
        ).toBe(true);
    });
});
