import { describe, expect, it } from 'vitest';
import { CommonLotVolumeCursor } from './chart-volume-contract';
import { buildKbarReadoutDisplay } from './kbar-readout';
import {
    addKbarTurnoverTwd,
    formatKbarTurnoverWan,
    parseKbarTurnoverTwd,
} from './kbar-turnover';
import type { Candle, KBars } from './types/market';
import {
    aggregate,
    kbarsToCandles,
    reattachLiveCandleTail,
} from './utils/kbars';

function kbars(amount?: unknown[]): KBars {
    return {
        datetime: [
            '2026-08-25T09:00:00',
            '2026-08-25T09:01:00',
        ],
        Open: [100, 101],
        High: [102, 103],
        Low: [99, 100],
        Close: [101, 102],
        Volume: [10, 20],
        ...(amount === undefined ? {} : { Amount: amount }),
    };
}

describe('K 棒成交值 canonical contract', () => {
    it.each([
        [0, 0],
        [93_550_000, 93_550_000],
        ['93550000', 93_550_000],
        ['93550000.00', 93_550_000],
        [-1, null],
        [1.1, null],
        [' 1', null],
        ['1e3', null],
        [Number.MAX_SAFE_INTEGER + 1, null],
        [undefined, null],
    ])('嚴格解析 Amount=%j -> %j', (value, expected) => {
        expect(parseKbarTurnoverTwd(value)).toBe(expected);
    });

    it('只在 Amount 欄位完整對齊時逐列保留精確元值', () => {
        expect(
            kbarsToCandles(kbars([1_000_000, '2000000'])).map(
                (bar) => bar.turnoverTwd,
            ),
        ).toEqual([1_000_000, 2_000_000]);
        expect(
            kbarsToCandles(kbars([1_000_000])).map(
                (bar) => bar.turnoverTwd,
            ),
        ).toEqual([null, null]);
        expect(
            kbarsToCandles(kbars()).map((bar) => bar.turnoverTwd),
        ).toEqual([null, null]);
    });

    it('聚合只接受完整子集合，缺值或 safe integer 溢位即 unavailable', () => {
        const complete = kbarsToCandles(kbars([1_000_000, 2_000_000]));
        expect(aggregate(complete, 5)[0]?.turnoverTwd).toBe(3_000_000);
        const incomplete = complete.map((bar, index) => ({
            ...bar,
            turnoverTwd: index === 0 ? bar.turnoverTwd : null,
        }));
        expect(aggregate(incomplete, 5)[0]?.turnoverTwd).toBeNull();
        expect(
            addKbarTurnoverTwd(Number.MAX_SAFE_INTEGER, 1),
        ).toBeNull();
    });

    it('歷史 prepend 後以同 generation 的完整 live candle 取代與接回 tail', () => {
        const history = aggregate(
            kbarsToCandles(kbars([1_000_000, 2_000_000])),
            1,
        );
        const sameBucketLive: Candle = {
            ...history[1]!,
            close: 102.5,
            volume: 21,
            turnoverTwd: 2_150_000,
        };
        const nextLive: Candle = {
            ...sameBucketLive,
            time: sameBucketLive.time + 60,
            open: 102.5,
            turnoverTwd: 500_000,
        };
        expect(
            reattachLiveCandleTail(history, [sameBucketLive, nextLive]).map(
                ({ time, volume, turnoverTwd }) => ({
                    time,
                    volume,
                    turnoverTwd,
                }),
            ),
        ).toEqual([
            {
                time: history[0]!.time,
                volume: 10,
                turnoverTwd: 1_000_000,
            },
            {
                time: sameBucketLive.time,
                volume: 21,
                turnoverTwd: 2_150_000,
            },
            {
                time: nextLive.time,
                volume: 21,
                turnoverTwd: 500_000,
            },
        ]);
    });

    it.each([
        [93_550_000, '9,355萬', '成交值 9,355萬元'],
        [935_500, '93.6萬', '成交值 93.6萬元'],
        [999, '<0.1萬', '成交值小於 0.1萬元'],
        [0, '0萬', '成交值 0萬元'],
        [null, '—', '成交值 —'],
    ] as const)('以萬元顯示 %j', (amount, value, accessibleName) => {
        expect(formatKbarTurnoverWan(amount)).toEqual({
            value,
            accessibleName,
        });
    });

    it('只有主畫面台股整股 readout 顯示張與值', () => {
        const candle: Candle = {
            ...kbarsToCandles(kbars([93_550_000, 1]))[0]!,
            volume: 910,
        };
        const stock = buildKbarReadoutDisplay(
            candle,
            5,
            false,
            String,
            undefined,
            'STK',
        );
        expect(stock.fields.slice(-2)).toEqual([
            {
                key: 'volume',
                label: '量',
                value: '910張',
                rawValue: 910,
                tone: 'neutral',
            },
            {
                key: 'turnover',
                label: '值',
                value: '9,355萬',
                rawValue: 93_550_000,
                tone: 'neutral',
                accessibleName: '成交值 9,355萬元',
            },
        ]);
        expect(
            buildKbarReadoutDisplay(
                candle,
                5,
                false,
                String,
                undefined,
                'FUT',
            ).fields.some((field) => field.key === 'turnover'),
        ).toBe(false);
    });

    it('volume 與 turnover 共用 identity/session/sequence cursor，Amount 缺漏只關閉值', () => {
        const cursor = new CommonLotVolumeCursor();
        expect(
            cursor.reset({
                identity: '2330|5|generation-1',
                sessionDate: '2026-08-25',
                sourceTime: 1,
                sequence: 1,
                totalVolume: 10,
                totalTurnoverTwd: 1_000_000,
            }),
        ).toBe(true);
        expect(
            cursor.consume({
                identity: '2330|5|generation-1',
                sessionDate: '2026-08-25',
                sourceTime: 2,
                sequence: 2,
                totalVolume: 12,
                totalTurnoverTwd: 1_205_000,
                turnoverTwd: 205_000,
            }),
        ).toMatchObject({
            accepted: true,
            delta: 2,
            turnoverDeltaTwd: 205_000,
            turnoverAvailable: true,
        });
        expect(
            cursor.consume({
                identity: '2330|5|generation-1',
                sessionDate: '2026-08-25',
                sourceTime: 2,
                sequence: 2,
                totalVolume: 12,
                totalTurnoverTwd: 1_205_000,
                turnoverTwd: 205_000,
            }),
        ).toMatchObject({
            accepted: false,
            delta: 0,
            reason: 'sequence_not_advanced',
            turnoverAvailable: false,
        });
        expect(
            cursor.consume({
                identity: '2330|5|generation-1',
                sessionDate: '2026-08-25',
                sourceTime: 3,
                sequence: 3,
                totalVolume: 13,
                totalTurnoverTwd: 1_300_000,
                turnoverTwd: 95_000,
            }),
        ).toMatchObject({
            accepted: true,
            delta: 1,
            turnoverDeltaTwd: null,
            turnoverAvailable: false,
        });
    });

    it('非法 cumulative Amount 不得以合法 per-tick Amount 掩蓋', () => {
        const cursor = new CommonLotVolumeCursor();
        cursor.reset({
            identity: '2330|1|generation-2',
            sessionDate: '2026-08-25',
            sourceTime: 1,
            sequence: 1,
            totalVolume: 1,
            totalTurnoverTwd: 100_000,
        });
        expect(
            cursor.consume({
                identity: '2330|1|generation-2',
                sessionDate: '2026-08-25',
                sourceTime: 2,
                sequence: 2,
                totalVolume: 2,
                totalTurnoverTwd: 'NaN',
                turnoverTwd: 100_000,
            }),
        ).toMatchObject({
            accepted: true,
            delta: 1,
            turnoverDeltaTwd: null,
            turnoverAvailable: false,
        });
    });

    it('bootstrap 後 sequence 跳號時以 cumulative delta 為準，不誤比最後一筆 amount', () => {
        const cursor = new CommonLotVolumeCursor();
        cursor.reset({
            identity: '3441|5|generation-3',
            sessionDate: '2026-08-26',
            sourceTime: 1,
            sequence: 0,
            totalVolume: 100,
            totalTurnoverTwd: 10_000_000,
        });
        expect(
            cursor.consume({
                identity: '3441|5|generation-3',
                sessionDate: '2026-08-26',
                sourceTime: 2,
                sequence: 12,
                totalVolume: 105,
                totalTurnoverTwd: 10_600_000,
                turnoverTwd: 120_000,
            }),
        ).toMatchObject({
            accepted: true,
            delta: 5,
            turnoverDeltaTwd: 600_000,
            turnoverAvailable: true,
        });
    });
});
