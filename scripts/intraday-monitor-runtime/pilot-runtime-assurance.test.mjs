import { describe, expect, it } from 'vitest';

import {
    createIntradayMonitorPilotRuntimeAssurance,
    validateIntradayMonitorPilotRuntimeAssurance,
} from './pilot-runtime-assurance.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

function input(overrides = {}) {
    return {
        tradeDate: '2026-09-08',
        previousTradeDate: '2026-09-07',
        observedAt: '2026-09-08T09:45:00+08:00',
        simulation: true,
        chart: {
            canonicalSymbol: 'IX0001',
            sourceUrl: 'http://127.0.0.1:5173/',
            firstObservedAt: '2026-09-08T09:44:55+08:00',
            lastObservedAt: '2026-09-08T09:44:56+08:00',
            freshnessMs: 1_000,
            canvasCount: 7,
            canvasWidth: 900,
            canvasHeight: 500,
            beforeSha256: A,
            afterSha256: B,
            changed: true,
        },
        reconnect: {
            transport: 'intraday-monitor-trigger-sse',
            attempted: true,
            recovered: true,
            clientGenerationBefore: 'probe_generation_1',
            clientGenerationAfter: 'probe_generation_2',
            generationAdvanced: true,
            serverGenerationBefore: 'server_generation_1',
            serverGenerationAfter: 'server_generation_1',
            cursorBefore: 'cursor-0',
            cursorAfter: 'cursor-0',
            cursorPreserved: true,
            oldConnectionClosed: true,
            replayedEventCount: 0,
            duplicateNotificationCount: 0,
        },
        existingFeatures: {
            chartFresh: true,
            watchlistHealthy: true,
            alertHealthy: true,
            smartOrderHealthy: true,
            simulationRuntimeHealthy: true,
        },
        regressionEvidenceRefs: [{ path: 'acceptance/regression.md', sha256: A }],
        operations: {
            methods: ['GET'],
            subscriptionMutations: 0,
            notificationDispatches: 0,
            brokerWrites: 0,
            productionTransitions: 0,
            serviceLifecycleMutations: 0,
        },
        ...overrides,
    };
}

describe('盤中監控 runtime assurance', () => {
    it('保存視覺 K 線變化、GET-only reconnect 與零權限證據', () => {
        const value = createIntradayMonitorPilotRuntimeAssurance(input());
        expect(validateIntradayMonitorPilotRuntimeAssurance(value)).toEqual({
            valid: true,
            ready: true,
            reasons: [],
        });
        expect(value.operations).toEqual({
            methods: ['GET'],
            subscriptionMutations: 0,
            notificationDispatches: 0,
            brokerWrites: 0,
            productionTransitions: 0,
            serviceLifecycleMutations: 0,
        });
    });

    it('畫面未變或 reconnect 未恢復時不進入 ready', () => {
        const value = createIntradayMonitorPilotRuntimeAssurance(input({
            chart: { ...input().chart, afterSha256: A, changed: false },
            reconnect: { ...input().reconnect, recovered: false },
        }));
        expect(validateIntradayMonitorPilotRuntimeAssurance(value)).toEqual({
            valid: true,
            ready: false,
            reasons: ['chart_freshness_not_observed', 'reconnect_not_recovered'],
        });
    });

    it('拒絕非 loopback 或 production 資料', () => {
        expect(() => createIntradayMonitorPilotRuntimeAssurance(input({
            chart: { ...input().chart, sourceUrl: 'https://example.com/' },
        }))).toThrow(/invalid/);
        expect(() => createIntradayMonitorPilotRuntimeAssurance(input({ simulation: false })))
            .toThrow(/invalid/);
    });

    it('保存實際 POST 與 subscription mutation，但拒絕進入 ready', () => {
        const value = createIntradayMonitorPilotRuntimeAssurance(input({
            operations: {
                ...input().operations,
                methods: ['GET', 'POST'],
                subscriptionMutations: 3,
            },
        }));
        expect(validateIntradayMonitorPilotRuntimeAssurance(value)).toEqual({
            valid: true,
            ready: false,
            reasons: [
                'browser_request_not_read_only',
                'subscription_mutation_detected',
                'authority_mutation_detected',
            ],
        });
    });

    it('不再替呼叫端補造 GET-only operations', () => {
        const missing = input();
        delete missing.operations;
        expect(() => createIntradayMonitorPilotRuntimeAssurance(missing)).toThrow(/invalid/);
    });
});
