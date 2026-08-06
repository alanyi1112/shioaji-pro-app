import { describe, expect, it } from 'vitest';
import {
    REFERENCE_FORMULA_VERSION,
    atr,
    bollinger,
    boundedInteger,
    chronologicalCandles,
    macd,
    referenceSma,
    stoch,
    stochRsi,
    wilderRsiSeries,
} from './indicators';
import { DEF_BY_TYPE } from './indicator-defs';
import type { Candle } from './types/market';

const closes = [
    98, 101, 102, 104, 102, 105, 107, 107, 106, 110, 110, 111, 110, 113,
    114, 116, 114, 117, 119, 119, 118, 122, 122, 123, 122, 125, 126, 128,
    126, 129, 131, 131, 130, 134, 134, 135, 134, 137, 138, 140,
];

const referenceBars: Candle[] = closes.map((close, index) => ({
    time: 1000 + index * 60,
    open: close - 0.5,
    high: close + 1,
    low: close - 1.5,
    close,
    volume: index % 7 === 0 ? 0 : 100 + index,
}));

describe('MultiChart 固定參考公式', () => {
    it('固定 formula version，並隔離非有限資料後依 time 排序', () => {
        expect(REFERENCE_FORMULA_VERSION).toBe('multichart-ecae7ca-v1');
        const prepared = chronologicalCandles([
            referenceBars[2]!,
            { ...referenceBars[1]!, close: Number.NaN },
            referenceBars[0]!,
        ]);
        expect(prepared.map((bar) => bar.time)).toEqual([1000, 1120]);
        expect(() => boundedInteger(1.5, 1, 20, 'period')).toThrow(
            'period:out-of-range',
        );
    });

    it('RSI5／10 對齊 Wilder 暖機、固定值、平盤與單邊上漲', () => {
        const fixture = [10, 11, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17, 16, 18].map(
            (close, index): Candle => ({
                time: 1000 + index * 60,
                open: close,
                high: close + 1,
                low: close - 1,
                close,
                volume: 100 + index,
            }),
        );
        const short = wilderRsiSeries(fixture, 5);
        const long = wilderRsiSeries(fixture, 10);
        expect(short.slice(0, 5).map((point) => point.value)).toEqual(
            Array(5).fill(undefined),
        );
        expect(short[5]?.value).toBe(66.666667);
        expect(short.at(-1)?.value).toBe(72.184073);
        expect(long.slice(0, 10).map((point) => point.value)).toEqual(
            Array(10).fill(undefined),
        );
        expect(long[10]?.value).toBe(71.428571);
        expect(long.at(-1)?.value).toBe(70.532894);

        const flat = fixture.map((bar) => ({ ...bar, close: 20 }));
        expect(wilderRsiSeries(flat, 5)[5]?.value).toBe(50);
        const rising = fixture.map((bar, index) => ({ ...bar, close: index + 1 }));
        expect(wilderRsiSeries(rising, 5)[5]?.value).toBe(100);
        expect(() => wilderRsiSeries(fixture, 1)).toThrow(
            'rsi-period:out-of-range',
        );
    });

    it('KD 9／3／3 以 50 初始化並對齊來源固定值', () => {
        const fixture = [10, 11, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17, 16, 18].map(
            (close, index): Candle => ({
                time: 1000 + index * 60,
                open: close,
                high: close + 1,
                low: close - 1,
                close,
                volume: 100 + index,
            }),
        );
        const result = stoch(fixture, 9, 3, 3);
        expect(result.k.slice(0, 8).map((point) => point.value)).toEqual(
            Array(8).fill(undefined),
        );
        expect(result.k[8]?.value).toBe(61.904762);
        expect(result.d[8]?.value).toBe(53.968254);
        expect(result.k.at(-1)?.value).toBe(78.202365);
        expect(result.d.at(-1)?.value).toBe(73.076839);

        const flat = fixture.map((bar) => ({ ...bar, high: 20, low: 20, close: 20 }));
        expect(stoch(flat, 9, 3, 3).k[8]?.value).toBe(50);
        expect(() => stoch(fixture, 9, 21, 3)).toThrow(
            'kd-rsv-weight:out-of-range',
        );
    });

    it('MACD、ATR 與 BOLL 對齊固定來源期望值', () => {
        const macdResult = macd(referenceBars, 12, 26, 9);
        expect(macdResult.macd[25]).toEqual({ time: 2500, value: 6.941862 });
        expect(macdResult.signal[25]).toEqual({ time: 2500, value: 1.388372 });
        expect(macdResult.hist[25]).toEqual({ time: 2500, value: 5.55349 });
        expect(macdResult.macd.at(-1)?.value).toBe(7.08413);
        expect(macdResult.signal.at(-1)?.value).toBe(6.76018);
        expect(macdResult.hist.at(-1)?.value).toBe(0.32395);

        const atrResult = atr(referenceBars, 14);
        expect(atrResult.slice(0, 13).every((point) => point.value === undefined)).toBe(true);
        expect(atrResult[13]).toEqual({ time: 1780, value: 3.142857 });
        expect(atrResult.at(-1)?.value).toBe(3.084407);

        const boll = bollinger(referenceBars, 20, 2);
        expect(boll.upper[19]).toEqual({ time: 2140, value: 121.297821 });
        expect(boll.mid[19]).toEqual({ time: 2140, value: 109.25 });
        expect(boll.lower[19]).toEqual({ time: 2140, value: 97.202179 });

        const bollFixture = Array.from({ length: 20 }, (_, index): Candle => ({
            time: 5000 + index * 60,
            open: index % 2 === 0 ? 12.084524 : 17.915476,
            high: index % 2 === 0 ? 13.084524 : 18.915476,
            low: index % 2 === 0 ? 11.084524 : 16.915476,
            close: index % 2 === 0 ? 12.084524 : 17.915476,
            volume: 1,
        }));
        const fixedBoll = bollinger(bollFixture, 20, 2);
        expect(fixedBoll.upper[19]?.value).toBe(20.830952);
        expect(fixedBoll.mid[19]?.value).toBe(15);
        expect(fixedBoll.lower[19]?.value).toBe(9.169048);
    });

    it('參考均線組與 Volume MA5／10／20 保留零量及 render target', () => {
        const maPack = DEF_BY_TYPE.get('reference-ma-pack');
        const volumeMa = DEF_BY_TYPE.get('volume-ma');
        expect(maPack?.kind).toBe('series');
        expect(volumeMa?.kind).toBe('series');
        if (!maPack || maPack.kind !== 'series') throw new Error('missing MA pack');
        if (!volumeMa || volumeMa.kind !== 'series') throw new Error('missing Volume MA');

        expect(Object.keys(maPack.compute(referenceBars, {}))).toEqual([
            'ma5',
            'ma10',
            'ma20',
            'ma60',
            'ma120',
        ]);
        const result = volumeMa.compute(referenceBars, {});
        expect(result.ma5?.[4]).toEqual({ time: 1240, value: 82 });
        expect(result.ma10?.[9]).toEqual({ time: 1540, value: 83.8 });
        expect(result.ma20?.[19]?.value).toBe(93.45);
        expect(volumeMa.render).toEqual({ pane: 'main', priceScaleId: 'vol' });
        expect(referenceSma(referenceBars, 5, 'volume')).toEqual(result.ma5);
    });

    it('雙線 RSI 不改變 StochRSI 的單週期資料形狀', () => {
        const result = stochRsi(referenceBars, 14, 14, 3, 3);
        expect(result.k.length).toBeGreaterThan(0);
        expect(result.d.length).toBeGreaterThan(0);
        expect(result.k.every((point) => Number.isFinite(point.value))).toBe(true);
    });

    it('既有額外指標 registry 保持可用', () => {
        const preserved = [
            'vwap',
            'sar',
            'supertrend',
            'donchian',
            'keltner',
            'stochrsi',
            'cci',
            'obv',
            'mfi',
            'willr',
            'dmi',
            'roc',
            'bias',
        ];
        expect(preserved.every((type) => DEF_BY_TYPE.has(type))).toBe(true);
    });
});
