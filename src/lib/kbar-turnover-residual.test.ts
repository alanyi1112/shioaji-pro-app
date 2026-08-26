import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const project = new URL('../../', import.meta.url);

function source(path: string): string {
    return readFileSync(new URL(path, project), 'utf8');
}

describe('主交易畫面成交值 residual boundary', () => {
    it('production 只沿用既有四個 Kbars request，沒有 turnover series 或 left axis', () => {
        const chart = source('src/components/candle-chart.tsx');
        expect(chart.match(/fetchKbars\(/g)).toHaveLength(4);
        expect(chart).not.toMatch(/turnover[^\n]{0,120}addHistogramSeries/i);
        expect(chart).not.toMatch(/turnover[^\n]{0,120}priceScaleId/i);
        expect(chart).not.toContain('turnoverAxis');
    });

    it('MultiView 只在本機 readout 資料鏈消費 turnover，production indicators 不消費', () => {
        for (const path of [
            'apps/multiview/app/page.tsx',
            'src/lib/indicators.ts',
            'src/lib/indicator-checkpoints.ts',
            'src/lib/market-overlays.ts',
        ]) {
            expect(source(path), path).not.toContain('turnoverTwd');
        }
        const multiview = [
            'apps/multiview/public/static/kbar-turnover.js',
            'apps/multiview/public/static/realtime-charts.js',
            'apps/multiview/public/static/daily-minute-drilldown-contract.js',
            'apps/multiview/public/static/app.js',
        ]
            .map(source)
            .join('\n');
        expect(multiview).toContain('turnoverTwd');
        expect(multiview).not.toMatch(
            /turnover[^\n]{0,120}(?:addHistogramSeries|priceScaleId|Axis|checkbox)/i,
        );
    });
});
