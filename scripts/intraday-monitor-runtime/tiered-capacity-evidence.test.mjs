import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';
import {
    createIntradayMonitorPilotEvidenceBundle,
    createIntradayMonitorPilotShadowRecorder,
    createIntradayMonitorPilotStagePlan,
} from './pilot-shadow-evidence.mjs';
import {
    createTieredCapacityPrerequisiteReview,
    createTieredOfflineLoadFixture,
    evaluateTieredCapacityPrerequisite,
    evaluateTieredCapacityStageGate,
    runTieredOfflineLoadReplay,
    runOfflineTieredCapacityLoad,
    validateTieredLiveEvidenceCandidate,
    validateTieredOfflineLoadEvidence,
    validateTieredOfflineLoadFixture,
} from './tiered-capacity-evidence.mjs';

const H = 'a'.repeat(64);
const B = 'b'.repeat(64);

function digest(value) {
    return createHash('sha256').update(canonicalJson(value, {
        maximumBytes: 128 * 1024 * 1024,
    })).digest('hex');
}

function pilotPlan() {
    return createIntradayMonitorPilotStagePlan({
        stage: 20,
        cohort: Array.from({ length: 20 }, (_, index) => `${String(1001 + index)}.TW`),
        cohortReceiptManifestHash: B,
        minimumActiveMonitorCount: 20,
        resourceBudgets: {
            maxCpuBasisPoints: 2_000,
            maxRssBytes: 128_000_000,
            maxDatabaseGrowthBytes: 5_000_000,
            maxSseLatencyMs: 100,
            maxChartFreshnessMs: 2_000,
        },
        createdAt: '2026-09-04T19:45:00+08:00',
    });
}

function pilotSession(plan, tradeDate, previousTradeDate, reconnect) {
    const recorder = createIntradayMonitorPilotShadowRecorder({
        plan,
        session: {
            tradeDate,
            previousTradeDate,
            calendarSourceVersion: 'calendar_sha256_0001',
            connectionGeneration: `generation_${tradeDate.replaceAll('-', '')}`,
            startedAt: `${tradeDate}T08:59:00+08:00`,
            coverageStartMinute: '09:01',
        },
    });
    const common = {
        configRevision: 1,
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
        triggerCount: 1,
        incompleteTriggerCount: 0,
        notificationDispatchCount: 0,
        duplicateNotificationCount: 0,
        brokerWriteAttemptCount: 0,
        productionTransitionCount: 0,
        serviceLifecycleMutationCount: 0,
        cpuBasisPoints: 1_000,
        rssBytes: 64_000_000,
        databaseBytes: 1_000_000,
        sseLatencyMs: 10,
        chartFreshnessMs: 500,
        connectionGeneration: `generation_${tradeDate.replaceAll('-', '')}`,
        sourceVersion: '1.7.1',
    };
    recorder.recordSample({
        ...common,
        capturedAt: `${tradeDate}T09:01:30+08:00`,
        minuteKey: '09:01',
        minuteEvidenceCount: 20,
        completeMinuteEvidenceCount: 20,
    });
    recorder.recordSample({
        ...common,
        capturedAt: `${tradeDate}T13:30:30+08:00`,
        minuteKey: '13:30',
        minuteEvidenceCount: 5_400,
        completeMinuteEvidenceCount: 5_400,
    });
    return recorder.finish({
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
    });
}

function pilotBundle() {
    const plan = pilotPlan();
    return createIntradayMonitorPilotEvidenceBundle({
        plan,
        sessions: [
            pilotSession(plan, '2026-09-08', '2026-09-07', true),
            pilotSession(plan, '2026-09-09', '2026-09-08', false),
        ],
        createdAt: '2026-09-09T14:00:00+08:00',
    });
}

function minuteKey(index) {
    const minuteOfDay = 9 * 60 + 1 + index;
    return `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
}

function sourceCapture() {
    const tradeDate = '2026-09-08';
    const symbols = ['2330.TW', '2454.TW'].map((canonicalSymbol, symbolIndex) => ({
        canonicalSymbol,
        closeMode: 'normal_or_revised_13_30',
        complete: true,
        minuteCount: 270,
        firstMinute: '09:01',
        lastMinute: '13:30',
        rows: Array.from({ length: 270 }, (_, index) => ({
            canonicalSymbol,
            minuteKey: minuteKey(index),
            cumulativeVolume: (index + 1) * (symbolIndex + 1) * 10,
            sequence: index + 1,
            receivedTime: `${tradeDate}T${minuteKey(index)}:30+08:00`,
            sourceVersion: 'shioaji-http-1.7.1',
            unit: 'common_lot',
            completeness: 'complete',
        })),
    }));
    const seed = {
        schemaVersion: 'intraday-monitor-kbar-shadow-session/1',
        tradeDate,
        startedAt: `${tradeDate}T08:55:00+08:00`,
        endedAt: `${tradeDate}T13:34:30+08:00`,
        connectionGeneration: 'generation_20260908',
        cohort: symbols.map((item) => item.canonicalSymbol),
        cohortHash: `sha256:${H}`,
        expectedMinuteCountPerSymbol: 270,
        symbols,
        close: { attempted: true, accepted: true, sealedCount: 2, expectedCount: 2,
            normalCloseMinute: '13:30', delayedCloseMinute: '13:33',
            finalizedAt: `${tradeDate}T13:34:30+08:00` },
        adapter: { rejectionCounts: {}, sinkRejections: 0, providerPhysicalUsage: null },
        assessment: {
            fullSession: true,
            baselineEligible: true,
            notificationEligible: false,
            note: 'complete',
        },
        operations: {
            notificationDispatchCount: 0,
            brokerWriteAttemptCount: 0,
            productionTransitionCount: 0,
            serviceLifecycleMutationCount: 0,
            pollingFallback: false,
            rawPayloadSaved: false,
        },
    };
    return {
        schemaVersion: 'intraday-monitor-bounded-kbar-capture/1',
        captureMode: 'full-session',
        session: { ...seed, evidenceHash: `sha256:${digest(seed)}` },
        interrupted: false,
    };
}

describe('盤中監控分級容量 evidence', () => {
    it('只有 20 檔兩日 bundle 與人工 GO 才允許 Stage 50', () => {
        const sourceBundle = pilotBundle();
        const review = createTieredCapacityPrerequisiteReview({
            sourceBundle,
            decision: 'GO',
            approvedActiveLimit: 20,
            reviewerSignoff: true,
            reviewedAt: '2026-09-09T15:00:00+08:00',
        });
        expect(evaluateTieredCapacityPrerequisite({ sourceBundle, review })).toMatchObject({
            valid: true,
            liveStage50Eligible: true,
            offlinePlaneEligible: true,
            reasons: [],
            providerPhysicalUsage: null,
            providerHeadroom: null,
            subscriptionTransportAuthority: false,
        });
        const noGo = createTieredCapacityPrerequisiteReview({
            sourceBundle,
            decision: 'NO_GO',
            approvedActiveLimit: 20,
            reviewerSignoff: true,
            reviewedAt: '2026-09-09T15:00:00+08:00',
        });
        expect(evaluateTieredCapacityPrerequisite({ sourceBundle, review: noGo })).toMatchObject({
            liveStage50Eligible: false,
            offlinePlaneEligible: true,
            reasons: ['reviewer_go_missing'],
        });
    });

    it('允許 20 直接測試 160，但拒絕重用 token', () => {
        expect(evaluateTieredCapacityStageGate({
            targetStage: 50,
            priorApprovedStage: 20,
            priorDecision: 'GO',
            priorBundleValid: true,
            priorBundleSha256: H,
        })).toMatchObject({ readyForExecutionAuthority: true, reasons: [] });
        expect(evaluateTieredCapacityStageGate({
            targetStage: 160,
            priorApprovedStage: 20,
            priorDecision: 'GO',
            priorBundleValid: true,
            priorBundleSha256: H,
            executionTokenUsed: true,
        })).toMatchObject({
            readyForExecutionAuthority: false,
            reasons: ['execution_token_already_used'],
            providerPhysicalUsage: null,
            providerHeadroom: null,
        });
    });

    it('由完整 capture 建立 160 檔 synthetic-only fixture 並重播一致', () => {
        const fixture = createTieredOfflineLoadFixture({
            capture: sourceCapture(),
            targetCount: 160,
            createdAt: '2026-09-08T14:00:00+08:00',
        });
        expect(validateTieredOfflineLoadFixture(fixture)).toEqual({
            valid: true,
            reasons: [],
            formalMarketEvidenceEligible: false,
            providerCapacityEvidenceEligible: false,
            providerPhysicalUsage: null,
            providerHeadroom: null,
        });
        expect(fixture.mapping).toHaveLength(160);
        expect(fixture.mapping[0]).toMatchObject({
            syntheticSymbol: 'SYNTH_LOAD_001',
            sourceCanonicalSymbol: '2330.TW',
        });
        expect(fixture.provider).toEqual({
            physicalUsage: null,
            globalOwnershipComplete: null,
            releaseProven: null,
            headroom: null,
        });
        const evidence = runTieredOfflineLoadReplay(fixture, {
            runs: 2,
            createdAt: '2026-09-08T14:01:00+08:00',
        });
        expect(validateTieredOfflineLoadEvidence(evidence)).toMatchObject({
            valid: true,
            readyForOfflineReview: true,
            formalMarketEvidenceEligible: false,
            providerCapacityEvidenceEligible: false,
        });
        expect(evidence).toMatchObject({
            targetCount: 160,
            replay: { runCount: 2, consistent: true },
            operations: {
                networkRequests: 0,
                subscriptionMutations: 0,
                notificationDispatches: 0,
                brokerWrites: 0,
                productionTransitions: 0,
                serviceLifecycleMutations: 0,
                activeLimitMutations: 0,
            },
            resources: { databaseGrowthBytes: 0 },
        });
        expect(validateTieredLiveEvidenceCandidate(fixture)).toEqual({
            valid: false,
            reasons: ['synthetic_load_evidence_not_allowed_for_live_stage'],
        });
    });

    it('拒絕 partial capture、篡改 operations 與虛構 provider usage', () => {
        const partial = { ...sourceCapture(), captureMode: 'partial-rehearsal' };
        expect(() => createTieredOfflineLoadFixture({
            capture: partial,
            targetCount: 160,
            createdAt: '2026-09-08T14:00:00+08:00',
        })).toThrow(/invalid/);

        const fixture = createTieredOfflineLoadFixture({
            capture: sourceCapture(),
            targetCount: 50,
            createdAt: '2026-09-08T14:00:00+08:00',
        });
        const tampered = structuredClone(fixture);
        tampered.operations.networkRequests = 1;
        const seed = { ...tampered };
        delete seed.fixtureHash;
        tampered.fixtureHash = digest(seed);
        expect(validateTieredOfflineLoadFixture(tampered)).toMatchObject({ valid: false });

        const invented = structuredClone(fixture);
        invented.provider.physicalUsage = 50;
        const inventedSeed = { ...invented };
        delete inventedSeed.fixtureHash;
        invented.fixtureHash = digest(inventedSeed);
        expect(validateTieredOfflineLoadFixture(invented)).toMatchObject({ valid: false });
    });

    it('CLI helper 以新檔原子保存 fixture 與 evidence', async () => {
        const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'tiered-capacity-'));
        try {
            const capturePath = path.join(temporaryRoot, 'capture.json');
            const outputPrefix = path.join(temporaryRoot, 'offline-load');
            await writeFile(capturePath, JSON.stringify(sourceCapture()));
            const results = await runOfflineTieredCapacityLoad({
                capturePath,
                outputPrefix,
                targets: [50],
                createdAt: '2026-09-08T14:00:00+08:00',
                runs: 2,
            });
            expect(results).toHaveLength(1);
            expect(results[0]).toMatchObject({
                target: 50,
                replayConsistent: true,
                formalMarketEvidenceEligible: false,
                providerCapacityEvidenceEligible: false,
            });
            const evidence = JSON.parse(await readFile(results[0].evidencePath, 'utf8'));
            expect(validateTieredOfflineLoadEvidence(evidence)).toMatchObject({ valid: true });
            await expect(runOfflineTieredCapacityLoad({
                capturePath,
                outputPrefix,
                targets: [50],
                createdAt: '2026-09-08T14:00:00+08:00',
                runs: 2,
            })).rejects.toThrow(/EEXIST/);
        } finally {
            await rm(temporaryRoot, { recursive: true, force: true });
        }
    });
});
