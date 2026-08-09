import { describe, expect, it } from 'vitest';
import type { Candle } from './types/market';
import {
    buildCandleTimeIndex,
    buildKbarReadoutDisplay,
    buildPreviousSessionCloseIndex,
    formatKbarInterval,
    formingDeadline,
    isReadoutBarForming,
    resolveReadoutReference,
    resolveReadoutCandle,
    selectDayBoundaries,
} from './kbar-readout';
import { wallClockToUtc } from './utils/kbars';

function candle(time: string, close = 191, volume = 39053): Candle {
    return {
        time: wallClockToUtc(time),
        open: 193.5,
        high: 199,
        low: 189.5,
        close,
        volume,
    };
}

describe('K 棒價量格式', () => {
    it('格式化 1m、5m、60m 與 1D 區間', () => {
        const time = wallClockToUtc('2026-08-06T09:45:00');
        expect(formatKbarInterval(time, 1).short).toBe(
            '09:45:00–09:45:59',
        );
        expect(formatKbarInterval(time, 5).short).toBe('09:45–09:49');
        expect(formatKbarInterval(time, 60).short).toBe('09:45–10:44');
        expect(formatKbarInterval(time, 1440).short).toBe('2026/08/06');
    });

    it('跨日期時在起訖兩端顯示日期', () => {
        const time = wallClockToUtc('2026-08-06T23:30:00');
        expect(formatKbarInterval(time, 60).short).toBe(
            '08/06 23:30–08/07 00:29',
        );
    });

    it('依序顯示開高低收量，forming 時改成最新', () => {
        const bar = candle('2026-08-06T09:45:00');
        const price = (value: number) => value.toFixed(2);
        expect(buildKbarReadoutDisplay(bar, 5, false, price).fields).toEqual([
            {
                key: 'open',
                label: '開',
                value: '193.50',
                rawValue: 193.5,
                tone: 'flat',
            },
            {
                key: 'high',
                label: '高',
                value: '199.00',
                rawValue: 199,
                tone: 'flat',
            },
            {
                key: 'low',
                label: '低',
                value: '189.50',
                rawValue: 189.5,
                tone: 'flat',
            },
            {
                key: 'close',
                label: '收',
                value: '191.00',
                rawValue: 191,
                tone: 'flat',
            },
            {
                key: 'volume',
                label: '量',
                value: '39,053',
                rawValue: 39053,
                tone: 'neutral',
            },
        ]);
        expect(
            buildKbarReadoutDisplay(bar, 5, true, price).fields[3],
        ).toEqual({
            key: 'close',
            label: '最新',
            value: '191.00',
            rawValue: 191,
            tone: 'flat',
        });
    });

    it('以可靠 reference 對價格欄位判色，量保持中性', () => {
        const bar = candle('2026-08-06T09:45:00');
        const display = buildKbarReadoutDisplay(
            bar,
            5,
            false,
            (value) => value.toFixed(2),
            193,
        );
        expect(display.fields.map(({ tone }) => tone)).toEqual([
            'up',
            'up',
            'down',
            'down',
            'neutral',
        ]);
    });
});

describe('K 棒價量 reference resolver', () => {
    const today = wallClockToUtc('2026-08-06T12:00:00');

    it('當日 STK／IND／WRT 使用目前有效 reference', () => {
        for (const securityType of ['STK', 'IND', 'WRT'] as const) {
            expect(
                resolveReadoutReference({
                    candle: candle('2026-08-06T09:45:00'),
                    reference: 193,
                    securityType,
                    forming: false,
                    nowWallClockSeconds: today,
                }),
            ).toBe(193);
        }
    });

    it('歷史日、無效 reference 與未知商品降級為 undefined', () => {
        expect(
            resolveReadoutReference({
                candle: candle('2026-08-05T13:29:00'),
                reference: 193,
                securityType: 'STK',
                forming: false,
                nowWallClockSeconds: today,
            }),
        ).toBeUndefined();
        expect(
            resolveReadoutReference({
                candle: candle('2026-08-06T09:45:00'),
                reference: 0,
                securityType: 'STK',
                forming: false,
                nowWallClockSeconds: today,
            }),
        ).toBeUndefined();
        expect(
            resolveReadoutReference({
                candle: candle('2026-08-06T09:45:00'),
                reference: 193,
                securityType: null,
                forming: false,
                nowWallClockSeconds: today,
            }),
        ).toBeUndefined();
    });

    it('歷史 STK／IND／WRT 使用 candle 日期對應的前一 session close', () => {
        const references = new Map([
            ['2026-08-05', 188],
            ['2026-08-06', 193],
        ]);
        for (const securityType of ['STK', 'IND', 'WRT'] as const) {
            expect(
                resolveReadoutReference({
                    candle: candle('2026-08-05T09:45:00'),
                    reference: 999,
                    historicalReferences: references,
                    securityType,
                    forming: false,
                    nowWallClockSeconds: today,
                }),
            ).toBe(188);
        }
    });

    it('週末最新 completed session 使用歷史索引，載入邊界保持 unavailable', () => {
        const weekend = wallClockToUtc('2026-08-09T12:00:00');
        const friday = candle('2026-08-07T13:25:00');
        expect(
            resolveReadoutReference({
                candle: friday,
                reference: 999,
                historicalReferences: new Map([['2026-08-07', 193]]),
                securityType: 'STK',
                forming: false,
                nowWallClockSeconds: weekend,
            }),
        ).toBe(193);
        expect(
            resolveReadoutReference({
                candle: friday,
                reference: 999,
                historicalReferences: new Map(),
                securityType: 'STK',
                forming: false,
                nowWallClockSeconds: weekend,
            }),
        ).toBeUndefined();
    });

    it('FUT／OPT 只有可證明 forming 的最新 candle 使用 reference', () => {
        for (const securityType of ['FUT', 'OPT'] as const) {
            const bar = candle('2026-08-06T23:59:00');
            expect(
                resolveReadoutReference({
                    candle: bar,
                    reference: 20000,
                    securityType,
                    forming: true,
                    nowWallClockSeconds: today,
                }),
            ).toBe(20000);
            expect(
                resolveReadoutReference({
                    candle: bar,
                    reference: 20000,
                    securityType,
                    forming: false,
                    nowWallClockSeconds: today,
                }),
            ).toBeUndefined();
        }
    });
});

describe('K 棒歷史昨收索引', () => {
    it('依非連續交易日與最後有效 close 建立下一 session 的昨收', () => {
        const rows = [
            candle('2026-08-06T13:25:00', 191),
            candle('2026-08-03T13:25:00', 180),
            candle('2026-08-05T09:00:00', 185),
            candle('2026-08-05T13:25:00', 188),
            { ...candle('2026-08-05T13:29:00'), close: Number.NaN },
        ];
        expect([...buildPreviousSessionCloseIndex(rows)]).toEqual([
            ['2026-08-05', 180],
            ['2026-08-06', 188],
        ]);
    });

    it('第一個載入日沒有 reference，prepend 後才補齊', () => {
        const initial = [
            candle('2026-08-06T09:00:00', 190),
            candle('2026-08-07T09:00:00', 195),
        ];
        expect(buildPreviousSessionCloseIndex(initial).get('2026-08-06')).toBeUndefined();
        expect(buildPreviousSessionCloseIndex(initial).get('2026-08-07')).toBe(190);

        const prepended = [candle('2026-08-05T13:25:00', 188), ...initial];
        expect(buildPreviousSessionCloseIndex(prepended).get('2026-08-06')).toBe(188);
    });

    it('前一 session 沒有有效 close 時不跨越該日借用更早資料', () => {
        const rows = [
            candle('2026-08-03T13:25:00', 180),
            { ...candle('2026-08-05T13:25:00'), close: 0 },
            candle('2026-08-06T09:00:00', 190),
        ];
        const references = buildPreviousSessionCloseIndex(rows);
        expect(references.get('2026-08-05')).toBe(180);
        expect(references.get('2026-08-06')).toBeUndefined();
    });
});

describe('K 棒價量資料選取與 lifecycle', () => {
    it('命中游標時間，沒有命中時回到最新 candle', () => {
        const bars = [
            candle('2026-08-06T09:40:00', 190),
            candle('2026-08-06T09:45:00', 191),
        ];
        const index = buildCandleTimeIndex(bars);
        expect(resolveReadoutCandle(bars, index, bars[0]!.time)?.close).toBe(190);
        expect(resolveReadoutCandle(bars, index, 123)?.close).toBe(191);
        expect(resolveReadoutCandle([], new Map(), null)).toBeNull();
    });

    it('只在已知 forming bar 且 deadline 前顯示最新', () => {
        const time = wallClockToUtc('2026-08-06T09:45:00');
        expect(formingDeadline(time, 5, 'STK')).toBe(time + 300);
        expect(
            isReadoutBarForming({
                barTime: time,
                formingBarTime: time,
                minutes: 5,
                securityType: 'STK',
                nowWallClockSeconds: time + 299,
            }),
        ).toBe(true);
        expect(
            isReadoutBarForming({
                barTime: time,
                formingBarTime: time,
                minutes: 5,
                securityType: 'STK',
                nowWallClockSeconds: time + 300,
            }),
        ).toBe(false);
        expect(formingDeadline(time, 1440, 'FUT')).toBeNull();
        expect(formingDeadline(time, 1440, 'STK')).toBe(
            time + 13 * 60 * 60 + 30 * 60,
        );
        expect(
            isReadoutBarForming({
                barTime: time,
                formingBarTime: null,
                minutes: 5,
                securityType: 'STK',
                nowWallClockSeconds: time + 1,
            }),
        ).toBe(false);
        expect(
            isReadoutBarForming({
                barTime: time,
                formingBarTime: time + 300,
                minutes: 5,
                securityType: 'STK',
                nowWallClockSeconds: time + 301,
            }),
        ).toBe(false);
    });
});

describe('跨日分隔線 boundary', () => {
    const bars = [
        candle('2026-08-05T13:29:00'),
        candle('2026-08-06T09:00:00'),
        candle('2026-08-06T09:05:00'),
    ];

    it('只選出日期改變的相鄰 candles', () => {
        expect(selectDayBoundaries(bars, 5)).toEqual([
            { previousTime: bars[0]!.time, nextTime: bars[1]!.time },
        ]);
    });

    it('同日缺口不增加 boundary，1D 完全排除', () => {
        expect(selectDayBoundaries(bars.slice(1), 5)).toEqual([]);
        expect(selectDayBoundaries(bars, 1440)).toEqual([]);
    });

    it('期貨夜盤跨午夜仍以台灣顯示日期分隔', () => {
        const night = [
            candle('2026-08-06T23:59:00'),
            candle('2026-08-07T00:00:00'),
        ];
        expect(selectDayBoundaries(night, 1)).toHaveLength(1);
    });
});

describe('1／2／4／8 圖隔離 fixture', () => {
    for (const chartCount of [1, 2, 4, 8]) {
        it(`${chartCount} 圖各自使用商品、時框、游標與 current bar`, () => {
            const charts = Array.from({ length: chartCount }, (_, index) => {
                const minutes = [1, 5, 15, 60][index % 4]!;
                const first = candle(
                    `2026-08-05T09:${padFixture(index)}:00`,
                    100 + index,
                    1000 + index,
                );
                const latest = candle(
                    `2026-08-06T10:${padFixture(index)}:00`,
                    200 + index,
                    2000 + index,
                );
                const bars = [first, latest];
                return {
                    minutes,
                    bars,
                    index: buildCandleTimeIndex(bars),
                    selectedTime: index % 2 === 0 ? first.time : null,
                };
            });

            const initial = charts.map((chart) => {
                const selected = resolveReadoutCandle(
                    chart.bars,
                    chart.index,
                    chart.selectedTime,
                );
                return {
                    close: selected?.close,
                    interval: buildKbarReadoutDisplay(
                        selected ?? null,
                        chart.minutes,
                        false,
                        String,
                    ).interval,
                    boundaries: selectDayBoundaries(
                        chart.bars,
                        chart.minutes,
                    ).length,
                };
            });
            expect(initial.map((state) => state.close)).toEqual(
                charts.map((_, index) =>
                    index % 2 === 0 ? 100 + index : 200 + index,
                ),
            );
            expect(initial.every((state) => state.boundaries === 1)).toBe(true);
            expect(new Set(initial.map((state) => state.interval)).size).toBe(
                chartCount,
            );

            // High-frequency updates only replace the target chart's latest
            // canonical candle; no crosshair movement is required.
            const target = charts[chartCount - 1]!;
            for (let close = 300; close < 400; close++) {
                target.bars[target.bars.length - 1] = {
                    ...target.bars[target.bars.length - 1]!,
                    close,
                };
            }
            const updatedTarget = resolveReadoutCandle(
                target.bars,
                buildCandleTimeIndex(target.bars),
                null,
            );
            expect(updatedTarget?.close).toBe(399);
            if (chartCount > 1) {
                expect(
                    charts[0]!.bars[charts[0]!.bars.length - 1]!.close,
                ).toBe(200);
            }
        });
    }
});

function padFixture(index: number): string {
    return String(index).padStart(2, '0');
}
