import { describe, expect, it } from 'vitest';

import { createIntradayMonitorPilotCohortReceiptManifest } from './pilot-cohort-receipts.mjs';
import { createIntradayMonitorPilotStagePlan } from './pilot-shadow-evidence.mjs';
import {
    evaluateIntradayMonitorPremarketReadiness,
    INTRADAY_MONITOR_PREMARKET_RUNTIME_SNAPSHOT_SCHEMA,
} from './premarket-readiness.mjs';

const RESOURCE_BUDGETS = {
    maxCpuBasisPoints: 2_000,
    maxRssBytes: 128_000_000,
    maxDatabaseGrowthBytes: 5_000_000,
    maxSseLatencyMs: 100,
    maxChartFreshnessMs: 2_000,
};

function fixture() {
    const cohortReceipts = createIntradayMonitorPilotCohortReceiptManifest({
        requestedSymbols: ['2330.TW'],
        contracts: [{ security_type: 'STK', region: 'TW', exchange: 'TSE', code: '2330' }],
        sourceEndpoint: 'http://127.0.0.1:8080/api/v1/data/contracts',
        sourceVersion: '1.7.1',
        verifiedAt: '2026-09-04T21:00:00+08:00',
    });
    const plan = createIntradayMonitorPilotStagePlan({
        stage: 20,
        cohort: cohortReceipts.cohort,
        cohortReceiptManifestHash: cohortReceipts.manifestHash,
        minimumActiveMonitorCount: 1,
        resourceBudgets: RESOURCE_BUDGETS,
        createdAt: '2026-09-04T21:01:00+08:00',
    });
    const runtime = {
        schemaVersion: INTRADAY_MONITOR_PREMARKET_RUNTIME_SNAPSHOT_SCHEMA,
        capturedAt: '2026-09-07T08:30:00+08:00',
        endpointUrl: 'http://127.0.0.1:8080',
        simulation: true,
        production: false,
        featureEnabled: false,
        notificationsEnabled: false,
        gate0Decision: 'go',
        gate0EvidenceCurrent: true,
        globalOwnershipComplete: true,
        confirmedActiveCapacity: 1,
        configRevision: 7,
        plannedTradeDate: '2026-09-07',
        calendarAuthorityReady: true,
        connectionGeneration: 'generation_000001',
        providerRequestAuthority: false,
        automaticSubscriptionAuthority: false,
        subscriptionTransportAuthority: false,
        serviceLifecycleAuthority: false,
        brokerWriteAuthority: false,
    };
    const storage = {
        evidenceDirectory: '/tmp/evidence',
        directoryExists: true,
        readable: true,
        writable: true,
        availableDiskBytes: 10_000_000,
        minimumRequiredDiskBytes: 1_000_000,
        capturedAt: '2026-09-07T08:30:00+08:00',
    };
    return { plan, cohortReceipts, runtime, storage };
}

describe('盤中監控開盤前唯讀 preflight', () => {
    it('所有證據完整時只核准進入受控試辦，不取得外部權限', () => {
        const result = evaluateIntradayMonitorPremarketReadiness(fixture());
        expect(result).toMatchObject({
            validInputs: true,
            readyForControlledPilot: true,
            reasons: [],
            checks: {
                preflightProviderRequestAuthority: false,
                networkRequestPerformed: false,
                subscriptionMutationPerformed: false,
                serviceLifecycleMutationPerformed: false,
                brokerWritePerformed: false,
            },
        });
    });

    it('Gate 0 NO-GO、容量不足或通知開啟時拒絕', () => {
        const input = fixture();
        const result = evaluateIntradayMonitorPremarketReadiness({
            ...input,
            runtime: {
                ...input.runtime,
                gate0Decision: 'no_go',
                gate0EvidenceCurrent: false,
                globalOwnershipComplete: false,
                confirmedActiveCapacity: 0,
                notificationsEnabled: true,
            },
        });
        expect(result.readyForControlledPilot).toBe(false);
        expect(result.reasons).toEqual(expect.arrayContaining([
            'confirmed_capacity_below_plan_minimum',
            'gate0_evidence_not_current',
            'gate0_not_go',
            'notifications_must_remain_off',
            'ownership_incomplete',
        ]));
    });

    it('plan 未綁定同一份 cohort receipt 時拒絕', () => {
        const input = fixture();
        const otherReceipts = createIntradayMonitorPilotCohortReceiptManifest({
            requestedSymbols: ['6488.TWO'],
            contracts: [{ security_type: 'STK', region: 'TW', exchange: 'OTC', code: '6488' }],
            sourceEndpoint: 'http://127.0.0.1:8080/api/v1/data/contracts',
            sourceVersion: '1.7.1',
            verifiedAt: '2026-09-04T21:00:00+08:00',
        });
        const result = evaluateIntradayMonitorPremarketReadiness({
            ...input,
            cohortReceipts: otherReceipts,
        });
        expect(result.readyForControlledPilot).toBe(false);
        expect(result.reasons).toEqual(expect.arrayContaining([
            'cohort_mismatch',
            'cohort_receipt_hash_mismatch',
        ]));
    });
});
