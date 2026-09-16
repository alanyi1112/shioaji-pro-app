import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    observeFreshPassiveChartCommits,
    readPassiveChartFreshness,
    readPassiveChartGeometry,
} from './passive-chart-freshness';

describe('被動 K 線 freshness 觀測', () => {
    afterEach(() => document.body.replaceChildren());

    it('只讀取既有 DOM 診斷資料，不產生網路或 subscription mutation', () => {
        const node = document.createElement('div');
        node.dataset.chartDiagnosticSchema = 'candle-chart-passive-freshness/1';
        node.dataset.chartCode = '2330';
        node.dataset.chartTimeframeMinutes = '5';
        node.dataset.chartLastVisualCommitAt = '2026-09-08T03:00:00.000Z';
        node.dataset.chartLastSourceTime = '2026-09-08T02:59:00.000Z';
        document.body.append(node);
        expect(readPassiveChartFreshness(document, Date.parse('2026-09-08T03:00:02.500Z'))).toEqual({
            schemaVersion: 'candle-chart-passive-freshness-observation/1',
            observedAt: '2026-09-08T03:00:02.500Z',
            charts: [{ code: '2330', timeframeMinutes: 5,
                lastVisualCommitAt: '2026-09-08T03:00:00.000Z',
                lastSourceTime: '2026-09-08T02:59:00.000Z', freshnessMs: 2_500 }],
            operations: { domReads: 1, networkRequests: 0, navigationCount: 0, reloadCount: 0,
                subscriptionMutations: 0, brokerWrites: 0, productionTransitions: 0,
                serviceLifecycleMutations: 0 },
        });
    });

    it('忽略尚未有 visual commit 或時間異常的節點', () => {
        document.body.innerHTML = `
            <div data-chart-diagnostic-schema="candle-chart-passive-freshness/1" data-chart-code="2330" data-chart-timeframe-minutes="5"></div>
            <div data-chart-diagnostic-schema="candle-chart-passive-freshness/1" data-chart-code="2454" data-chart-timeframe-minutes="1" data-chart-last-visual-commit-at="2099-01-01T00:00:00Z"></div>`;
        expect(readPassiveChartFreshness(document, Date.parse('2026-09-08T03:00:00Z')).charts).toEqual([]);
    });

    it('忽略過期 commit，並在真實 visual commit 改變時立即產生一次新觀察', async () => {
        let now = Date.parse('2026-09-16T03:07:20.000Z');
        const node = document.createElement('div');
        node.dataset.chartDiagnosticSchema = 'candle-chart-passive-freshness/1';
        node.dataset.chartCode = '2330';
        node.dataset.chartTimeframeMinutes = '1';
        node.dataset.chartLastVisualCommitAt = '2026-09-16T03:07:00.000Z';
        node.dataset.chartLastSourceTime = '2026-09-16T03:07:00.000Z';
        const canvas = document.createElement('canvas');
        vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
            x: 0, y: 0, top: 10, left: 10, right: 810, bottom: 430,
            width: 800, height: 420, toJSON() { return {}; },
        });
        node.append(canvas);
        document.body.append(node);
        const samples: Array<{ observation: { charts: ReadonlyArray<{ lastVisualCommitAt: string }> } }> = [];
        const stop = observeFreshPassiveChartCommits((sample) => samples.push(sample), {
            root: document,
            now: () => now,
            fallbackPollMs: 60_000,
        });
        expect(samples).toHaveLength(0);
        now += 100;
        node.dataset.chartLastVisualCommitAt = new Date(now).toISOString();
        node.dataset.chartLastSourceTime = '2026-09-16T03:07:01.000Z';
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(samples).toHaveLength(1);
        expect(samples[0]?.observation.charts[0]?.lastVisualCommitAt).toBe(new Date(now).toISOString());
        stop();
    });
});

describe('readPassiveChartGeometry', () => {
    it('量測實際可見 canvas，供同日被動圖表 evidence 使用', () => {
        document.body.innerHTML = `<div data-chart-diagnostic-schema="candle-chart-passive-freshness/1"><canvas></canvas></div>`;
        const canvas = document.querySelector('canvas')!;
        vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
            x: 0, y: 0, top: 10, left: 10, right: 810, bottom: 430,
            width: 800, height: 420, toJSON() { return {}; },
        });
        const value = readPassiveChartGeometry(document, Date.parse('2026-09-16T01:02:10Z'));
        expect(value).toMatchObject({ chartCount: 1, canvasCount: 1,
            largestCanvasWidth: 800, largestCanvasHeight: 420,
            allCanvasesVisible: true });
    });
});
