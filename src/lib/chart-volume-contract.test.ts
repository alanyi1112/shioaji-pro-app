import { describe, expect, it } from 'vitest';
import fixture from '../../test-fixtures/chart-day-volume-parity.json';
import {
    CommonLotVolumeCursor,
    isAdvancingTaiwanStockTradeTick,
    normalizeTaiwanStockVolume,
    readCurrentTaiwanStockCanonicalVolume,
    TAIWAN_STOCK_VOLUME_NORMALIZATION_REVISION,
} from './chart-volume-contract';
import { selectDayBoundaries } from './kbar-readout';
import {
    aggregate,
    kbarsToTaiwanStockCandles,
    wallClockToUtc,
} from './utils/kbars';

describe('台股成交量共同契約 fixture', () => {
    it('只有真實正整數成交量 Tick 才能推進累計成交值 cursor', () => {
        expect(
            isAdvancingTaiwanStockTradeTick({
                simtrade: false,
                volume: 1,
            }),
        ).toBe(true);
        for (const candidate of [
            { simtrade: false, volume: 0 },
            { simtrade: true, volume: 1 },
            { simtrade: false, volume: -1 },
            { simtrade: false, volume: 1.5 },
            { simtrade: false, volume: Number.NaN },
        ]) {
            expect(isAdvancingTaiwanStockTradeTick(candidate)).toBe(false);
        }
    });

    it('固定 Shioaji 1 分 Kbars 的跨日 daily OHLCV 期望值', () => {
        const minuteBars = fixture.shioajiDailyAggregation.candles.map(
            (row) => ({
                time: wallClockToUtc(row.datetime),
                open: row.open,
                high: row.high,
                low: row.low,
                close: row.close,
                volume: row.volume,
                turnoverTwd: null,
            }),
        );
        expect(
            aggregate(minuteBars, 1440).map((row) => ({
                date: new Date(row.time * 1000).toISOString().slice(0, 10),
                open: row.open,
                high: row.high,
                low: row.low,
                close: row.close,
                volume: row.volume,
            })),
        ).toEqual(fixture.shioajiDailyAggregation.expectedDaily);
        expect(fixture.providerFallback).toEqual({
            primary: {
                provider: 'shioaji',
                canonicalVolumeUnit: 'common_lot',
            },
            fallback: {
                provider: 'yahoo-chart',
                sourceVolumeUnit: 'share',
                canonicalVolumeUnit: 'common_lot',
            },
            mustRemainAtomic: true,
            exactValueParityClaimed: false,
        });
    });

    it('production Kbars adapter 對 Shioaji lot 採 identity conversion', () => {
        const rows = fixture.shioajiDailyAggregation.candles;
        const candles = kbarsToTaiwanStockCandles({
            datetime: rows.map((row) => row.datetime),
            Open: rows.map((row) => row.open),
            High: rows.map((row) => row.high),
            Low: rows.map((row) => row.low),
            Close: rows.map((row) => row.close),
            Volume: rows.map((row) => row.volume),
            Amount: rows.map(() => 0),
        });
        expect(candles.map((row) => row.volume)).toEqual(
            rows.map((row) => row.volume),
        );
        expect(() =>
            kbarsToTaiwanStockCandles({
                datetime: ['2026-08-21T09:00:00'],
                Open: [1],
                High: [1],
                Low: [1],
                Close: [1],
                Volume: [-1],
                Amount: [0],
            }),
        ).toThrow('invalid_shioaji_stock_volume');
    });

    it('同一份 fixture 固定分鐘 K boundary 與排除時框', () => {
        const bars = fixture.dayBoundary.candles.map((row) => ({
            time: wallClockToUtc(row.datetime),
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            volume: row.volume,
            turnoverTwd: null,
        }));
        const expected = fixture.dayBoundary.expectedBoundaryPairs.map(
            (pair) => {
                const previousIndex = pair[0];
                const nextIndex = pair[1];
                if (previousIndex === undefined || nextIndex === undefined) {
                    throw new Error('invalid boundary fixture pair');
                }
                return {
                    previousTime: bars[previousIndex]!.time,
                    nextTime: bars[nextIndex]!.time,
                };
            },
        );
        for (const interval of fixture.dayBoundary.supportedIntervals) {
            expect(selectDayBoundaries(bars, interval)).toEqual(expected);
        }
        for (const interval of fixture.dayBoundary.excludedIntervals) {
            expect(selectDayBoundaries(bars, interval)).toEqual([]);
        }
        expect(selectDayBoundaries(bars.slice(1), '5m')).toEqual([]);
    });

    it('固定 bootstrap、重送、倒序、跨 session 與 fallback 原子性案例', () => {
        expect(fixture.liveVolumeCursor.bootstrap).toEqual({
            sessionDate: '2026-08-21',
            sourceTime: 1787261400,
            sequence: 10,
            totalVolume: 100,
        });
        expect(
            fixture.liveVolumeCursor.events.map(
                ({ accepted, expectedDelta }) => [accepted, expectedDelta],
            ),
        ).toEqual([
            [true, 3],
            [false, 0],
            [false, 0],
            [false, 0],
            [true, 2],
        ]);
        expect(fixture.providerFallback.mustRemainAtomic).toBe(true);
        expect(fixture.providerFallback.exactValueParityClaimed).toBe(false);
    });

    it('以共享 fixture 驗證 bootstrap 後 delta、重送、倒序與舊 session', () => {
        const identity = '2330|5|generation-1';
        const cursor = new CommonLotVolumeCursor();
        expect(
            cursor.reset({ identity, ...fixture.liveVolumeCursor.bootstrap }),
        ).toBe(true);
        for (const event of fixture.liveVolumeCursor.events) {
            const result = cursor.consume({ identity, ...event });
            expect(result.accepted).toBe(event.accepted);
            expect(result.delta).toBe(event.expectedDelta);
        }
        expect(cursor.snapshot()).toMatchObject({
            identity,
            sessionDate: '2026-08-21',
            sequence: 13,
            totalVolume: 105,
        });
        const unseeded = new CommonLotVolumeCursor();
        expect(
            unseeded.consume({
                identity,
                sessionDate: '2026-08-21',
                sourceTime: 1787261580,
                sequence: 1,
                totalVolume: 105,
            }),
        ).toEqual({
            accepted: false,
            delta: 0,
            turnoverDeltaTwd: null,
            turnoverAvailable: false,
            reason: 'unseeded',
        });
        expect(
            cursor.consume({
                identity,
                sessionDate: '2026-08-22',
                sourceTime: 1787347800,
                sequence: 14,
                totalVolume: 5,
            }),
        ).toEqual({
            accepted: false,
            delta: 0,
            turnoverDeltaTwd: null,
            turnoverAvailable: false,
            reason: 'session_change_requires_bootstrap',
        });
    });

    it('依 provider 與 source unit 正規化為 common_lot 並保留小數張', () => {
        for (const row of fixture.volumeNormalization) {
            expect(
                normalizeTaiwanStockVolume({
                    market: 'TW',
                    securityType: 'STK',
                    provider: row.provider,
                    sourceUnit: row.sourceVolumeUnit as
                        | 'common_lot'
                        | 'share',
                    value: row.sourceValue,
                }),
            ).toMatchObject({
                status: 'available',
                value: row.expectedCommonLot,
                unit: 'common_lot',
                normalizationRevision:
                    TAIWAN_STOCK_VOLUME_NORMALIZATION_REVISION,
            });
        }
    });

    it('provider／unit 矛盾、未知來源、非 STK 與非法值皆 fail closed', () => {
        expect(
            normalizeTaiwanStockVolume({
                market: 'TW',
                securityType: 'STK',
                provider: 'shioaji',
                sourceUnit: 'share',
                value: 1000,
            }),
        ).toEqual({
            status: 'unavailable',
            reason: 'provider_unit_mismatch',
        });
        expect(
            normalizeTaiwanStockVolume({
                market: 'TW',
                securityType: 'STK',
                provider: 'unknown',
                sourceUnit: 'share',
                value: 1000,
            }),
        ).toEqual({ status: 'unavailable', reason: 'unknown_provider' });
        expect(
            normalizeTaiwanStockVolume({
                market: 'TW',
                securityType: 'IND',
                provider: 'shioaji',
                sourceUnit: 'common_lot',
                value: 1,
            }),
        ).toEqual({
            status: 'unavailable',
            reason: 'unsupported_security_type',
        });
        for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(
                normalizeTaiwanStockVolume({
                    market: 'TW',
                    securityType: 'STK',
                    provider: 'shioaji',
                    sourceUnit: 'common_lot',
                    value,
                }),
            ).toEqual({
                status: 'unavailable',
                reason: 'invalid_source_value',
            });
        }
    });

    it('拒絕舊 revision、未知 unit 與偽造 canonical report', () => {
        const current = normalizeTaiwanStockVolume({
            market: 'TW',
            securityType: 'STK',
            provider: 'yahoo-chart',
            sourceUnit: 'share',
            value: 12345,
        });
        expect(readCurrentTaiwanStockCanonicalVolume(current)).toEqual(current);
        expect(
            readCurrentTaiwanStockCanonicalVolume({
                ...current,
                normalizationRevision: 'taiwan-stock-common-lot/0',
            }),
        ).toBeNull();
        expect(
            readCurrentTaiwanStockCanonicalVolume({
                ...current,
                sourceUnit: 'unknown',
            }),
        ).toBeNull();
        expect(
            readCurrentTaiwanStockCanonicalVolume({
                ...current,
                provider: 'shioaji',
                sourceUnit: 'share',
            }),
        ).toBeNull();
        expect(
            readCurrentTaiwanStockCanonicalVolume({
                ...current,
                market: 'US',
            }),
        ).toBeNull();
        expect(
            readCurrentTaiwanStockCanonicalVolume({
                ...current,
                securityType: 'IND',
            }),
        ).toBeNull();
        expect(
            readCurrentTaiwanStockCanonicalVolume({
                ...current,
                value: -1,
            }),
        ).toBeNull();
    });
});
