import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPassiveChartEvidenceCollection } from './passive-chart-evidence-collection';
import type { IntradayMonitorStatusView } from './intraday-monitor-api';
import type { PassiveChartEvidenceSample } from './passive-chart-freshness';

const status = (phase: string, current = true, fresh = true) => ({
    approval: { stage: 160, decision: 'go' },
    capacity: { evaluationStageTarget: 160, evaluationState: 'go' },
    session: { current, phase, sessionTradeDate: '2026-10-01' },
    freshness: { fresh },
}) as IntradayMonitorStatusView;

const sample = {
    geometry: { observedAt: '2026-10-01T01:02:00.000Z', chartCount: 1,
        canvasCount: 1, largestCanvasWidth: 800, largestCanvasHeight: 400,
        allCanvasesVisible: true },
    observation: { schemaVersion: 'candle-chart-passive-freshness-observation/1',
        observedAt: '2026-10-01T01:02:00.000Z', charts: [
            { code: '2330', timeframeMinutes: 1, lastVisualCommitAt: '2026-10-01T01:01:59.000Z',
                lastSourceTime: '2026-10-01T01:01:00.000Z', freshnessMs: 1_000 },
        ], operations: { domReads: 1, networkRequests: 0, navigationCount: 0, reloadCount: 0,
            subscriptionMutations: 0, brokerWrites: 0, productionTransitions: 0,
            serviceLifecycleMutations: 0 } },
} as const satisfies PassiveChartEvidenceSample;

describe('跨面板被動 K 線證據收集', () => {
    afterEach(() => vi.useRealTimers());

    it('不需要盤中監控面板掛載，但只在今日 running session 觀測與送出真實圖表樣本', async () => {
        vi.useFakeTimers();
        let currentStatus = status('idle');
        let onSample: ((value: PassiveChartEvidenceSample) => void) | undefined;
        const readStatus = vi.fn(async () => currentStatus);
        const stopObserving = vi.fn();
        const observe = vi.fn((callback: typeof onSample) => {
            onSample = callback;
            return stopObserving;
        });
        const submit = vi.fn(async (_body: Record<string, unknown>) =>
            ({ state: submit.mock.calls.length === 1 ? 'awaiting_visual_commit_advance' : 'complete',
                tradeDate: '2026-10-01' }));
        const stop = startPassiveChartEvidenceCollection({ readStatus, observe, submit, intervalMs: 1_000 });
        await vi.advanceTimersByTimeAsync(0);
        expect(readStatus).toHaveBeenCalledOnce();
        expect(observe).not.toHaveBeenCalled();

        currentStatus = status('running', false);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(observe).not.toHaveBeenCalled();
        currentStatus = status('running', true, false);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(observe).not.toHaveBeenCalled();
        currentStatus = status('running');
        await vi.advanceTimersByTimeAsync(1_000);
        expect(observe).toHaveBeenCalledOnce();
        onSample?.({ ...sample, observation: { ...sample.observation, charts: [
            { ...sample.observation.charts[0]!, lastSourceTime: '2026-09-30T13:30:00.000Z' },
        ] } });
        expect(submit).not.toHaveBeenCalled();
        onSample?.(sample);
        await vi.advanceTimersByTimeAsync(0);
        expect(submit).toHaveBeenCalledOnce();
        expect(stopObserving).not.toHaveBeenCalled();
        onSample?.({ ...sample, observation: { ...sample.observation, charts: [
            { ...sample.observation.charts[0]!, lastVisualCommitAt: '2026-10-01T01:02:00.000Z' },
        ] } });
        await vi.advanceTimersByTimeAsync(0);
        expect(submit).toHaveBeenCalledOnce();
        onSample?.({ ...sample, observation: { ...sample.observation, charts: [
            { ...sample.observation.charts[0]!, lastSourceTime: '2026-10-01T01:02:00.000Z' },
        ] } });
        await vi.advanceTimersByTimeAsync(0);
        expect(submit).toHaveBeenCalledTimes(2);
        expect(submit.mock.calls[0]?.[0]).toMatchObject({
            sourceUrl: window.location.href,
            observation: sample.observation,
            geometry: sample.geometry,
        });
        expect(stopObserving).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(observe).toHaveBeenCalledOnce();
        stop();
    });

    it('session 不再 running 時解除觀測，且停止後不再送出樣本', async () => {
        vi.useFakeTimers();
        let currentStatus = status('running');
        let onSample: ((value: PassiveChartEvidenceSample) => void) | undefined;
        const observe = vi.fn((callback: typeof onSample) => {
            onSample = callback;
            return vi.fn();
        });
        const submit = vi.fn(async (_body: Record<string, unknown>) =>
            ({ state: 'awaiting_visual_commit_advance' }));
        const stop = startPassiveChartEvidenceCollection({
            readStatus: async () => currentStatus, observe, submit, intervalMs: 1_000,
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(observe).toHaveBeenCalledOnce();
        currentStatus = status('idle');
        await vi.advanceTimersByTimeAsync(1_000);
        onSample?.(sample);
        expect(submit).not.toHaveBeenCalled();
        stop();
    });
});
