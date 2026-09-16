import { describe, expect, it } from 'vitest';

import {
    createIntradayMonitorPilotEvidenceBundle,
    createIntradayMonitorPilotShadowRecorder,
    createIntradayMonitorPilotStagePlan,
    validateIntradayMonitorPilotEvidenceBundle,
    validateIntradayMonitorPilotStagePlan,
} from './pilot-shadow-evidence.mjs';

const H = 'a'.repeat(64);
const RECEIPT_H = 'b'.repeat(64);
const RESOURCE_BUDGETS = Object.freeze({
    maxCpuBasisPoints: 2_000,
    maxRssBytes: 128_000_000,
    maxDatabaseGrowthBytes: 5_000_000,
    maxSseLatencyMs: 100,
    maxChartFreshnessMs: 2_000,
});

function cohort(size = 20) {
    return Array.from({ length: size }, (_, index) =>
        `${String(1001 + index)}.TW`,
    );
}

function plan(size = 20) {
    return createIntradayMonitorPilotStagePlan({
        stage: size,
        cohort: cohort(size),
        cohortReceiptManifestHash: RECEIPT_H,
        minimumActiveMonitorCount: size,
        resourceBudgets: RESOURCE_BUDGETS,
        createdAt: '2026-09-04T19:45:00+08:00',
    });
}

function sample(overrides = {}) {
    return {
        capturedAt: '2026-09-07T09:01:30+08:00',
        minuteKey: '09:01',
        configRevision: 7,
        configured: 20,
        eligible: 20,
        active: 20,
        waiting: 0,
        unknown: 0,
        degraded: 0,
        gate0EvidenceCurrent: true,
        globalOwnershipComplete: null,
        confirmedPhysicalUsage: null,
        confirmedOtherPhysicalUsage: null,
        headroom: null,
        minuteEvidenceCount: 20,
        completeMinuteEvidenceCount: 20,
        triggerCount: 1,
        incompleteTriggerCount: 0,
        notificationDispatchCount: 0,
        duplicateNotificationCount: 0,
        brokerWriteAttemptCount: 0,
        productionTransitionCount: 0,
        serviceLifecycleMutationCount: 0,
        cpuBasisPoints: 1_250,
        rssBytes: 64_000_000,
        databaseBytes: 1_000_000,
        sseLatencyMs: 15,
        chartFreshnessMs: 500,
        connectionGeneration: 'generation_000001',
        sourceVersion: '1.7.1',
        ...overrides,
    };
}

function sessionEvidence({
    tradeDate = '2026-09-07',
    previousTradeDate = '2026-09-04',
    reconnect = false,
    sampleOverrides = {},
    firstSampleOverrides = {},
    finalSampleOverrides = {},
} = {}) {
    const stagePlan = plan();
    const recorder = createIntradayMonitorPilotShadowRecorder({
        plan: stagePlan,
        session: {
            tradeDate,
            previousTradeDate,
            calendarSourceVersion: 'calendar_sha256_0001',
            connectionGeneration: `generation_${tradeDate.replaceAll('-', '')}`,
            startedAt: `${tradeDate}T08:59:00+08:00`,
            coverageStartMinute: '09:01',
        },
    });
    recorder.recordSample(sample({
        capturedAt: `${tradeDate}T09:01:30+08:00`,
        ...sampleOverrides,
        ...firstSampleOverrides,
    }));
    recorder.recordSample(sample({
        capturedAt: `${tradeDate}T13:30:30+08:00`,
        minuteKey: '13:30',
        minuteEvidenceCount: 5_400,
        completeMinuteEvidenceCount: 5_400,
        ...sampleOverrides,
        ...finalSampleOverrides,
    }));
    return {
        plan: stagePlan,
        evidence: recorder.finish({
            endedAt: `${tradeDate}T13:31:00+08:00`,
            coverageEndMinute: '13:30',
            replay: {
                executed: true,
                consistent: true,
                inputHash: H,
                outputHash: H,
                triggerCount: 1,
                recomputedTriggerCount: 1,
            },
            reconnect: {
                attempted: reconnect,
                recovered: reconnect,
                generationAdvanced: reconnect,
            },
            existingFeatures: {
                chartFresh: true,
                watchlistHealthy: true,
                alertHealthy: true,
                smartOrderHealthy: true,
                simulationRuntimeHealthy: true,
            },
        }),
    };
}

describe('盤中監控分階段 shadow evidence 工具包', () => {
    it('建立固定 cohort、feature-off 且無 authority 的 stage plan', () => {
        const value = plan();
        expect(value).toMatchObject({
            stage: 20,
            minimumCompleteTradingDays: 2,
            requiredHeadroom: 40,
            minimumActiveMonitorCount: 20,
            cohortReceiptManifestHash: RECEIPT_H,
            resourceBudgets: RESOURCE_BUDGETS,
            userVisibleFeatureEnabled: false,
            notificationsEnabled: false,
            simulationOnly: true,
            providerRequestAuthority: false,
            automaticSubscriptionAuthority: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
        expect(Object.isFrozen(value)).toBe(true);
        expect(validateIntradayMonitorPilotStagePlan(value)).toEqual({
            valid: true,
            reasons: [],
        });
        expect(() => createIntradayMonitorPilotStagePlan({
            stage: 20,
            cohort: [...cohort(19), '1001.TW'],
            cohortReceiptManifestHash: RECEIPT_H,
            minimumActiveMonitorCount: 20,
            resourceBudgets: RESOURCE_BUDGETS,
            createdAt: '2026-09-04T19:45:00+08:00',
        })).toThrow(/invalid/);
        expect(() => createIntradayMonitorPilotStagePlan({
            stage: 200,
            cohort: cohort(200),
            cohortReceiptManifestHash: RECEIPT_H,
            minimumActiveMonitorCount: 200,
            resourceBudgets: RESOURCE_BUDGETS,
            createdAt: '2026-09-04T19:45:00+08:00',
        })).toThrow(/invalid/);
    });

    it('兩個完整交易日、零安全違規且含重連證據時進入人工審閱', () => {
        const first = sessionEvidence({ reconnect: true });
        const second = sessionEvidence({
            tradeDate: '2026-09-08',
            previousTradeDate: '2026-09-07',
        });
        const bundle = createIntradayMonitorPilotEvidenceBundle({
            plan: first.plan,
            sessions: [first.evidence, second.evidence],
            createdAt: '2026-09-08T14:00:00+08:00',
        });
        expect(validateIntradayMonitorPilotEvidenceBundle(bundle)).toEqual({
            valid: true,
            readyForHumanReview: true,
            reasons: [],
            metrics: {
                stage: 20,
                configuredMonitorCount: 20,
                minimumActiveMonitorCount: 20,
                resourceBudgets: RESOURCE_BUDGETS,
                completeTradingDays: 2,
                sessionCount: 2,
                sampleCount: 4,
                providerPhysicalUsage: null,
                providerHeadroom: null,
                maxCpuBasisPoints: 1_250,
                maxRssBytes: 64_000_000,
                maxDatabaseBytes: 1_000_000,
                maxDatabaseGrowthBytes: 0,
                maxSseLatencyMs: 15,
                maxChartFreshnessMs: 500,
                reconnectVerified: true,
            },
        });
    });

    it('資料不完整卻觸發、資源超標與安全 mutation 必須 fail closed', () => {
        const first = sessionEvidence({
            reconnect: true,
            sampleOverrides: {
                incompleteTriggerCount: 1,
                notificationDispatchCount: 1,
                brokerWriteAttemptCount: 1,
                productionTransitionCount: 1,
                serviceLifecycleMutationCount: 1,
                cpuBasisPoints: 2_001,
                rssBytes: 128_000_001,
                sseLatencyMs: 101,
                chartFreshnessMs: 2_001,
            },
            finalSampleOverrides: {
                databaseBytes: 7_000_001,
            },
        });
        const bundle = createIntradayMonitorPilotEvidenceBundle({
            plan: first.plan,
            sessions: [first.evidence],
            createdAt: '2026-09-07T14:00:00+08:00',
        });
        expect(validateIntradayMonitorPilotEvidenceBundle(bundle)).toMatchObject({
            readyForHumanReview: false,
            reasons: expect.arrayContaining([
                'broker_write_attempted',
                'chart_freshness_budget_exceeded',
                'cpu_budget_exceeded',
                'database_growth_budget_exceeded',
                'incomplete_data_triggered',
                'insufficient_complete_trading_days',
                'notification_dispatch_not_zero',
                'production_transition_detected',
                'rss_budget_exceeded',
                'service_lifecycle_mutation_detected',
                'sse_latency_budget_exceeded',
            ]),
        });
    });

    it('拒絕用 request 或 connection 推算 provider physical usage 與 headroom', () => {
        expect(() => sessionEvidence({
            sampleOverrides: {
                globalOwnershipComplete: true,
                confirmedPhysicalUsage: 20,
                confirmedOtherPhysicalUsage: 0,
                headroom: 180,
            },
        })).toThrow(/sample/);
    });

    it('bundle 或 sample 被竄改後 hash 驗證失敗', () => {
        const first = sessionEvidence({ reconnect: true });
        const bundle = createIntradayMonitorPilotEvidenceBundle({
            plan: first.plan,
            sessions: [first.evidence],
            createdAt: '2026-09-07T14:00:00+08:00',
        });
        expect(validateIntradayMonitorPilotEvidenceBundle({
            ...bundle,
            sessions: [{ ...first.evidence, coverageEndMinute: '13:29' }],
        })).toEqual({
            valid: false,
            readyForHumanReview: false,
            reasons: ['invalid_bundle'],
            metrics: null,
        });
    });
});
