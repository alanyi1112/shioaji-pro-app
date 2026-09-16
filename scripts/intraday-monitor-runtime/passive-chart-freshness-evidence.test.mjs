import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
    createPassiveChartFreshnessEvidence,
    validatePassiveChartFreshnessEvidence,
} from './passive-chart-freshness-evidence.mjs';

const fixturePath = new URL('../../openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/passive-chart-freshness-2026-09-08.json', import.meta.url);

describe('被動 K 線 freshness evidence', () => {
    function observation(observedAt, lastVisualCommitAt) {
        return {
            schemaVersion: 'candle-chart-passive-freshness-observation/1',
            observedAt,
            charts: [{ code: '2330', timeframeMinutes: 5, lastVisualCommitAt,
                lastSourceTime: lastVisualCommitAt,
                freshnessMs: Date.parse(observedAt) - Date.parse(lastVisualCommitAt) }],
            operations: { domReads: 1, networkRequests: 0, navigationCount: 0, reloadCount: 0,
                subscriptionMutations: 0, brokerWrites: 0, productionTransitions: 0,
                serviceLifecycleMutations: 0 },
        };
    }

    it('接受 canonical、零網路、零互動且 visual commit 推進的 evidence', async () => {
        const evidence = JSON.parse(await readFile(fixturePath, 'utf8'));
        expect(validatePassiveChartFreshnessEvidence(evidence)).toEqual({
            valid: true, ready: true, reasons: [], networkRequestAuthority: false,
            subscriptionTransportAuthority: false,
        });
    });

    it('拒絕 hash 漂移與 navigation/subscription mutation', async () => {
        const evidence = JSON.parse(await readFile(fixturePath, 'utf8'));
        expect(validatePassiveChartFreshnessEvidence({ ...evidence,
            operations: { ...evidence.operations, navigationCount: 1 } }).valid).toBe(false);
        expect(validatePassiveChartFreshnessEvidence({ ...evidence,
            operations: { ...evidence.operations, subscriptionMutations: 1 } }).valid).toBe(false);
    });

    it('由兩次同日唯讀 DOM 觀測建立可驗證且不可偽稱 provider usage 的 evidence', () => {
        const evidence = createPassiveChartFreshnessEvidence({
            tradeDate: '2026-09-11', sourceUrl: 'http://127.0.0.1:5173/?layout=intraday-stock-selection',
            canonicalSymbol: '2330', timeframeMinutes: 5,
            firstObservation: observation('2026-09-11T01:10:02.000Z', '2026-09-11T01:10:01.000Z'),
            secondObservation: observation('2026-09-11T01:10:17.000Z', '2026-09-11T01:10:16.500Z'),
            geometry: { observedAt: '2026-09-11T01:10:18.000Z', chartCount: 1, canvasCount: 7,
                largestCanvasWidth: 900, largestCanvasHeight: 500, allCanvasesVisible: true },
            operations: { domReads: 3, networkRequests: 0, navigationCount: 0, reloadCount: 0,
                clickCount: 0, subscriptionMutations: 0, notificationDispatches: 0,
                brokerWrites: 0, productionTransitions: 0, serviceLifecycleMutations: 0 },
        });
        expect(validatePassiveChartFreshnessEvidence(evidence).ready).toBe(true);
        expect(evidence.provider).toEqual({ physicalUsage: null, globalOwnershipComplete: null,
            releaseProven: null, headroom: null });
    });

    it('拒絕跨交易日觀測、不同商品及帶互動的 operation ledger', () => {
        const base = {
            tradeDate: '2026-09-11', sourceUrl: 'http://127.0.0.1:5173/',
            canonicalSymbol: '2330', timeframeMinutes: 5,
            firstObservation: observation('2026-09-11T01:10:02.000Z', '2026-09-11T01:10:01.000Z'),
            secondObservation: observation('2026-09-11T01:10:17.000Z', '2026-09-11T01:10:16.500Z'),
            geometry: { observedAt: '2026-09-11T01:10:18.000Z', chartCount: 1, canvasCount: 7,
                largestCanvasWidth: 900, largestCanvasHeight: 500, allCanvasesVisible: true },
            operations: { domReads: 3, networkRequests: 0, navigationCount: 0, reloadCount: 0,
                clickCount: 0, subscriptionMutations: 0, notificationDispatches: 0,
                brokerWrites: 0, productionTransitions: 0, serviceLifecycleMutations: 0 },
        };
        expect(() => createPassiveChartFreshnessEvidence({ ...base, tradeDate: '2026-09-10' }))
            .toThrow(/invalid/);
        expect(() => createPassiveChartFreshnessEvidence({ ...base, canonicalSymbol: '2454' }))
            .toThrow(/invalid/);
        expect(() => createPassiveChartFreshnessEvidence({ ...base,
            operations: { ...base.operations, clickCount: 1 } })).toThrow(/invalid/);
    });
});
