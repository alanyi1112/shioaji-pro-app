import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { aggregate, kbarsToTaiwanStockCandles } from './utils/kbars';
import type { KBars } from './types/market';

type FixtureCandle = {
    datetime: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};

const fixture = JSON.parse(
    readFileSync(
        new URL('../../test-fixtures/chart-day-volume-parity.json', import.meta.url),
        'utf8',
    ),
) as {
    shioajiDailyAggregation: {
        candles: FixtureCandle[];
        expectedDaily: Array<{
            date: string;
            open: number;
            high: number;
            low: number;
            close: number;
            volume: number;
        }>;
    };
};

const realtimeChartsSource = readFileSync(
    new URL('../../apps/multiview/public/static/realtime-charts.js', import.meta.url),
    'utf8',
);
const realtimeIndicatorsSource = readFileSync(
    new URL('../../apps/multiview/public/static/realtime-indicators.js', import.meta.url),
    'utf8',
);
const sandbox: Record<string, unknown> = {
    globalThis: undefined,
    Intl,
    Date,
    Set,
    Map,
};
sandbox.globalThis = sandbox;
vm.runInNewContext(realtimeChartsSource, sandbox);
vm.runInNewContext(realtimeIndicatorsSource, sandbox);

const multiViewCharts = sandbox.QuoteChartRealtimeCharts as {
    aggregateDailyCandles: (rows: unknown[]) => Array<Record<string, unknown>>;
};
const multiViewIndicators = sandbox.QuoteChartRealtimeIndicators as {
    compute: (rows: unknown[]) => {
        volume: Array<{ value: number }>;
    };
};

function fixtureKbars(rows: FixtureCandle[]): KBars {
    return {
        datetime: rows.map((row) => row.datetime),
        Open: rows.map((row) => row.open),
        High: rows.map((row) => row.high),
        Low: rows.map((row) => row.low),
        Close: rows.map((row) => row.close),
        Volume: rows.map((row) => row.volume),
        Amount: rows.map((row) => row.close * row.volume),
    };
}

function ohlcv(rows: Array<Record<string, unknown>>) {
    return rows.map((row) => ({
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
    }));
}

describe('主交易畫面與 MultiView 台股日 K common_lot parity', () => {
    it('同一 Shioaji fixture 產生完全相同的 daily OHLCV 與 volume-derived input', () => {
        const source = fixture.shioajiDailyAggregation.candles;
        const mainDaily = aggregate(kbarsToTaiwanStockCandles(fixtureKbars(source)), 1440);
        const multiDaily = multiViewCharts.aggregateDailyCandles(
            source.map((row) => ({
                ...row,
                time: Date.parse(`${row.datetime}+08:00`) / 1000,
                sourceTime: Date.parse(`${row.datetime}+08:00`),
                continuity: 'complete',
            })),
        );

        expect(ohlcv(mainDaily as unknown as Array<Record<string, unknown>>)).toEqual(
            ohlcv(multiDaily),
        );
        expect(mainDaily.map((row) => row.volume)).toEqual(
            multiViewIndicators.compute(multiDaily).volume.map((row) => row.value),
        );
        expect(mainDaily.map((row) => row.volume)).toEqual(
            fixture.shioajiDailyAggregation.expectedDaily.map((row) => row.volume),
        );
    });
});
