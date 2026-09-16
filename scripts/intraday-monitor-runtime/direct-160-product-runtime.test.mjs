import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { fixtureBaseline } from './fixtures/direct-160-baseline.mjs';
import { activateDirect160ProductRuntime, createDirect160ProductSink,
    readDirect160ProductRuntimeState } from './direct-160-product-runtime.mjs';
import { DIRECT_160_STORAGE } from './direct-160-storage.mjs';
import { IntradayMonitorEvidenceRepository } from './evidence-repository.mjs';
import { IntradayMonitorConfigRepository } from './config-repository.mjs';
import { createTieredCohortManifests, createTieredStageEvidenceBundle, createTieredStagePlan,
    createTieredStageReview, createTieredStageSessionEvidence } from './tiered-capacity-stage-artifacts.mjs';
import { createStateBackedRuntime } from './vite-local-api-gateway.mjs';
import { reviewAndActivateDirect160Product } from './activate-direct-160-product.mjs';

function input() {
    const contracts = Array.from({ length: 160 }, (_, index) => ({ security_type: 'STK', region: 'TW',
        exchange: index % 2 ? 'OTC' : 'TSE', code: String(1001 + index), target_code: null }));
    const manifest = createTieredCohortManifests({ contracts,
        config: { revision: 4, items: contracts.map((contract) => ({ contract, enabled: true })) },
        sourceVersion: 'fixture-only/1', createdAt: '2026-09-14T14:00:00+08:00' })[160];
    const baseline = fixtureBaseline(manifest);
    const config = { revision: 4, globalThreshold: '1', items: manifest.cohort.map((entry, position) => ({
        position, contract: { securityType: 'STK', region: 'TW', exchange: entry.contractIdentity.exchange,
            code: entry.contractIdentity.code, targetCode: null, canonicalSymbol: entry.canonicalSymbol },
        enabled: true, thresholdOverride: null,
        effectiveThreshold: { decimal: '1', hundredths: 100, source: 'global' }, source: 'manual',
    })) };
    return { manifest, baseline, config };
}

function acceptance({ manifest, baseline }) {
    const plan = createTieredStagePlan({ manifest, createdAt: '2026-09-14T08:45:00+08:00', budgets: {
        maxCpuBasisPoints: 2_500, maxRssBytes: 1_073_741_824,
        maxDatabaseGrowthBytes: 33_554_432,
        minimumAvailableDiskBytes: DIRECT_160_STORAGE.minimumAvailableDiskBytes,
        maxEventToSealLatencyMs: 10_000, maxChartFreshnessMs: 10_000,
        reconnectRequired: true, existingFeaturesRequired: true,
    } });
    const tieredSession = createTieredStageSessionEvidence({ plan, manifest, evidence: {
        tradeDate: '2026-09-14', baselineHash: baseline.baselineHash,
        connectionGeneration: 'product_generation_20260914_0003', exactCohortCount: 160,
        minuteSlotCount: 43_200, coverageStartMinute: '09:01', coverageEndMinute: '13:30',
        complete: true, zeroVolumeProvenancePreserved: true, unknownNotCoerced: true,
        reconnectVerified: true, existingFeaturesHealthy: true,
        transport: { subscribeAccepted: true, unsubscribeAccepted: true, providerReleaseProven: false },
        replay: { runCount: 2, consistent: true, inputHash: 'a'.repeat(64),
            outputHash: 'b'.repeat(64), triggerCount: 1 },
        resources: { cpuBasisPoints: 100, maxRssBytes: 200_000_000, databaseGrowthBytes: 1_000_000,
            minimumAvailableDiskBytes: 10_000_000_000, maxEventToSealLatencyMs: 100,
            maxChartFreshnessMs: 1_000 },
        provider: { physicalUsage: null, globalOwnershipComplete: null, releaseProven: null, headroom: null },
        operations: { networkWrites: 0, subscriptionMutations: 0, notificationDispatches: 0,
            brokerWrites: 0, productionTransitions: 0, serviceLifecycleMutations: 0,
            activeLimitMutations: 0 },
    } });
    const bundle = createTieredStageEvidenceBundle({ plan, manifest, baseline, sessions: [tieredSession],
        createdAt: '2026-09-14T13:35:00+08:00' });
    const expectedMinuteSet = Array.from({ length: 270 }, (_, index) => {
        const minute = 9 * 60 + 1 + index;
        return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    });
    const capture = { tradeDate: '2026-09-14', manifestHash: manifest.manifestHash,
        baselineHash: baseline.baselineHash, tieredSession,
        session: { close: { accepted: true }, symbols: manifest.cohort.map((entry) => ({
            canonicalSymbol: entry.canonicalSymbol, complete: true, nominalCloseMinute: '13:30',
            delayedCloseState: 'not_observed', expectedMinuteSet,
            actualLastEvent: { minuteKey: '13:30' },
            closeEvidence: { status: 'verified', authority: 'bounded_session_close_authority',
                finalizedAt: '2026-09-14T05:34:30.000Z' },
            sealTime: '2026-09-14T05:34:30.000Z',
        })) },
        runtime: { firstMinuteCanary: { result: 'pass', expectedCount: 160,
            receivedCount: 160, missingCount: 0, liveAvailabilityComplete: true },
        localEventReconnect: { recovered: true }, passiveChartEvidenceHash: 'c'.repeat(64) },
        operations: { notificationDispatches: 0, brokerWrites: 0, productionTransitions: 0,
            serviceLifecycleMutations: 0, activeLimitMutations: 0 },
        assessment: { formalAcceptanceEvidence: true, readyForBundle: true,
            dataContinuityComplete: true, liveAvailabilityComplete: true } };
    return { bundle, capture, tieredSession };
}

describe('direct 160 product runtime', () => {
    it('以 adapter 已接受的逐檔第一筆 09:01 KBar 通過 09:02:15 canary，不多等一根 KBar 才確認 data plane', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'direct-160-first-kbar-canary-'));
        const statePath = path.join(root, 'state.json');
        const evidenceDatabasePath = path.join(root, 'evidence.sqlite3');
        const { manifest, baseline, config } = input();
        const generation = 'simulation:product_generation_canary_0001';
        const sink = createDirect160ProductSink({ manifest, baseline, config,
            tradeDate: '2026-09-14', connectionGeneration: generation,
            evidenceDatabasePath, statePath, now: () => '2026-09-14T09:02:15+08:00' });
        sink.installBaselines();
        for (const entry of manifest.cohort) {
            expect(sink.recordFirstKbarEvidence({ canonicalSymbol: entry.canonicalSymbol,
                minuteKey: '09:01', receivedAt: '2026-09-14T09:02:02+08:00' }))
                .toMatchObject({ accepted: true, duplicate: false });
        }
        expect(sink.state()).toMatchObject({ dataActive: 160, awaitingFirstKbar: 0,
            boundedTransportReady: true, persistedObservationCount: 0 });
        expect(sink.runFirstMinuteCanary('2026-09-14T09:02:15+08:00')).toMatchObject({
            receivedCount: 160, missingCount: 0, liveAvailabilityComplete: true, result: 'pass',
        });
        sink.fail('test_complete');
    }, 30_000);

    it('09:10 首筆 live 前先安裝 09:01–09:09 bootstrap，從開盤重建累積量且不發歷史通知', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'direct-160-bootstrap-prefix-'));
        const statePath = path.join(root, 'state.json');
        const evidenceDatabasePath = path.join(root, 'evidence.sqlite3');
        const { manifest, baseline, config } = input();
        const generation = 'simulation:product_generation_bootstrap_0001';
        const sink = createDirect160ProductSink({ manifest, baseline, config,
            tradeDate: '2026-09-14', connectionGeneration: generation,
            evidenceDatabasePath, statePath, now: () => '2026-09-14T09:11:00+08:00' });
        sink.installBaselines();
        const entry = manifest.cohort[0];
        const minutes = Array.from({ length: 9 }, (_, index) => `09:${String(index + 1).padStart(2, '0')}`);
        const rows = minutes.map((minuteKey, index) => ({ minuteKey, open: 100, high: 101,
            low: 99, close: 100, volumeCommonLot: 1, amount: 1000, cumulativeVolume: index + 1 }));
        const gap = { schemaVersion: 'intraday-monitor-direct-160-gap-bootstrap/1',
            canonicalSymbol: entry.canonicalSymbol, tradeDate: '2026-09-14',
            requestedMinuteEnd: '09:09', expectedMinuteCount: 9, source: 'shioaji-kbars-bootstrap',
            sourceVersion: 'shioaji-http-1.7.1', sourceUnit: 'common_lot', canonicalUnit: 'common_lot',
            fetchedAt: '2026-09-14T09:10:01+08:00', refetchedAt: '2026-09-14T09:10:02+08:00',
            liveGeneration: generation, liveDelivered: false, stableRefetch: true,
            rangeHash: `sha256:${'a'.repeat(64)}`, refetchRangeHash: `sha256:${'a'.repeat(64)}`,
            rows };
        expect(sink.installBootstrapGaps([gap])).toEqual({ requested: 1, installed: 1,
            degraded: 0, notificationAuthority: false });
        expect(sink.persistObservation({ schemaVersion: 'intraday-monitor-observation/1',
            contract: { securityType: 'STK', region: 'TW', exchange: entry.contractIdentity.exchange,
                code: entry.contractIdentity.code, targetCode: null, canonicalSymbol: entry.canonicalSymbol },
            tradeDate: '2026-09-14', minuteKey: '09:10', exchangeTime: '09:10:00',
            receivedTime: '2026-09-14T09:11:00+08:00', connectionGeneration: generation,
            sequence: 1, cumulativeVolume: 3, unit: 'common_lot', source: 'shioaji-kbar-stream',
            sourceVersion: 'shioaji-http-1.7.1', simtrade: false, intradayOdd: false,
            continuity: 'complete' })).toMatchObject({ accepted: true });
        const state = readDirect160ProductRuntimeState(statePath);
        expect(state.items[0]).toMatchObject({ state: 'active', bootstrapState: 'complete',
            bootstrapEndMinute: '09:09', currentCumulativeVolume: 12,
            liveAccumulatorMode: 'bootstrap_prefix' });
        expect(state).toMatchObject({ persistedObservationCount: 10, persistedTriggerCount: 0,
            notificationAuthority: false });
        sink.fail('test_complete');
    }, 30_000);

    it('bootstrap 尚在雙抓時暫存首筆 live，安裝前段後依序接回且不遺失 09:10', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'direct-160-bootstrap-deferred-'));
        const statePath = path.join(root, 'state.json');
        const evidenceDatabasePath = path.join(root, 'evidence.sqlite3');
        const { manifest, baseline, config } = input();
        const generation = 'simulation:product_generation_bootstrap_0002';
        const sink = createDirect160ProductSink({ manifest, baseline, config,
            tradeDate: '2026-09-14', connectionGeneration: generation,
            evidenceDatabasePath, statePath, now: () => '2026-09-14T09:11:00+08:00' });
        sink.installBaselines();
        const entry = manifest.cohort[0];
        expect(sink.requireBootstrapPrefixes([{ canonicalSymbol: entry.canonicalSymbol,
            endMinute: '09:09' }])).toMatchObject({ accepted: 1 });
        expect(sink.recordFirstKbarEvidence({ canonicalSymbol: entry.canonicalSymbol,
            minuteKey: '09:10', receivedAt: '2026-09-14T09:11:00+08:00' }))
            .toMatchObject({ accepted: true, duplicate: false });
        const observation = { schemaVersion: 'intraday-monitor-observation/1',
            contract: { securityType: 'STK', region: 'TW', exchange: entry.contractIdentity.exchange,
                code: entry.contractIdentity.code, targetCode: null, canonicalSymbol: entry.canonicalSymbol },
            tradeDate: '2026-09-14', minuteKey: '09:10', exchangeTime: '09:10:00',
            receivedTime: '2026-09-14T09:11:00+08:00', connectionGeneration: generation,
            sequence: 1, cumulativeVolume: 3, unit: 'common_lot', source: 'shioaji-kbar-stream',
            sourceVersion: 'shioaji-http-1.7.1', simtrade: false, intradayOdd: false,
            continuity: 'complete' };
        expect(sink.persistObservation(observation)).toMatchObject({ accepted: true, deferred: true });
        expect(sink.state()).toMatchObject({ persistedObservationCount: 0 });
        expect(sink.state().items[0]).toMatchObject({ canonicalSymbol: entry.canonicalSymbol,
            state: 'waiting_continuity', reason: 'bootstrap_prefix_pending' });
        const rows = Array.from({ length: 9 }, (_, index) => ({
            minuteKey: `09:${String(index + 1).padStart(2, '0')}`, open: 100, high: 101,
            low: 99, close: 100, volumeCommonLot: 1, amount: 1000, cumulativeVolume: index + 1,
        }));
        const gap = { schemaVersion: 'intraday-monitor-direct-160-gap-bootstrap/1',
            canonicalSymbol: entry.canonicalSymbol, tradeDate: '2026-09-14',
            requestedMinuteEnd: '09:09', expectedMinuteCount: 9, source: 'shioaji-kbars-bootstrap',
            sourceVersion: 'shioaji-http-1.7.1', sourceUnit: 'common_lot', canonicalUnit: 'common_lot',
            fetchedAt: '2026-09-14T09:10:01+08:00', refetchedAt: '2026-09-14T09:10:02+08:00',
            liveGeneration: generation, liveDelivered: false, stableRefetch: true,
            rangeHash: `sha256:${'b'.repeat(64)}`, refetchRangeHash: `sha256:${'b'.repeat(64)}`, rows };
        expect(sink.installBootstrapGaps([gap])).toMatchObject({ installed: 1 });
        expect(sink.state()).toMatchObject({ persistedObservationCount: 10 });
        expect(sink.state().items[0]).toMatchObject({ canonicalSymbol: entry.canonicalSymbol,
            state: 'active', completedMinute: '09:10', currentCumulativeVolume: 12,
            liveAccumulatorMode: 'bootstrap_prefix' });
        sink.fail('test_complete');
    }, 30_000);

    it('將 160 檔 baseline、分鐘觀測與量比 trigger 寫入產品 evidence repository', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'direct-160-product-'));
        const evidenceDatabasePath = path.join(root, 'evidence.sqlite3');
        const statePath = path.join(root, 'state.json');
        const { manifest, baseline, config } = input();
        const sink = createDirect160ProductSink({ manifest, baseline, config,
            tradeDate: '2026-09-14', connectionGeneration: 'simulation:product_generation_20260914_0001',
            evidenceDatabasePath, statePath, now: () => '2026-09-14T09:02:00+08:00' });
        expect(sink.installBaselines()).toEqual({ installed: 160, accepted: true });
        expect(readDirect160ProductRuntimeState(statePath)).toMatchObject({
            dataActive: 0, awaitingFirstKbar: 160, boundedTransportReady: false,
        });
        const firstEntry = manifest.cohort[0];
        expect(sink.persistObservation({ schemaVersion: 'intraday-monitor-observation/1',
            contract: { securityType: 'STK', region: 'TW', exchange: firstEntry.contractIdentity.exchange,
                code: firstEntry.contractIdentity.code, targetCode: null, canonicalSymbol: firstEntry.canonicalSymbol },
            tradeDate: '2026-09-13', minuteKey: '09:01', exchangeTime: '09:01:00',
            receivedTime: '2026-09-14T09:02:00+08:00',
            connectionGeneration: 'simulation:product_generation_20260914_0001', sequence: 1,
            cumulativeVolume: 1, unit: 'common_lot', source: 'shioaji-kbar-stream',
            sourceVersion: 'shioaji-http-1.7.1', simtrade: false, intradayOdd: false,
            continuity: 'complete' })).toEqual({ accepted: false, reason: 'observation_envelope_invalid' });
        const invalidEnvelope = { schemaVersion: 'intraday-monitor-observation/1',
            contract: { securityType: 'STK', region: 'TW', exchange: firstEntry.contractIdentity.exchange,
                code: firstEntry.contractIdentity.code, targetCode: null, canonicalSymbol: firstEntry.canonicalSymbol },
            tradeDate: '2026-09-14', minuteKey: '09:01', exchangeTime: '09:01:00',
            receivedTime: '2026-09-14T09:02:00+08:00', connectionGeneration: 'simulation:wrong_generation_0000001',
            sequence: 1, cumulativeVolume: 1, unit: 'common_lot', source: 'shioaji-kbar-stream',
            sourceVersion: 'shioaji-http-1.7.1', simtrade: false, intradayOdd: false,
            continuity: 'complete' };
        expect(sink.persistObservation(invalidEnvelope)).toEqual({ accepted: false,
            reason: 'observation_envelope_invalid' });
        expect(sink.persistObservation({ ...invalidEnvelope,
            connectionGeneration: 'simulation:product_generation_20260914_0001',
            contract: { ...invalidEnvelope.contract, code: '9999' },
        })).toEqual({ accepted: false, reason: 'observation_envelope_invalid' });
        for (const [index, entry] of manifest.cohort.entries()) {
            const prior = baseline.manifests[index].cumulativeSeries[0].cumulativeVolume;
            expect(sink.persistObservation({ schemaVersion: 'intraday-monitor-observation/1',
                contract: { securityType: 'STK', region: 'TW', exchange: entry.contractIdentity.exchange,
                    code: entry.contractIdentity.code, targetCode: null, canonicalSymbol: entry.canonicalSymbol },
                tradeDate: '2026-09-14', minuteKey: '09:01', exchangeTime: '09:01:00',
                receivedTime: '2026-09-14T09:02:00+08:00',
                connectionGeneration: 'simulation:product_generation_20260914_0001', sequence: 1,
                cumulativeVolume: prior, unit: 'common_lot', source: 'shioaji-kbar-stream',
                sourceVersion: 'shioaji-http-1.7.1', simtrade: false, intradayOdd: false,
                continuity: 'complete' })).toMatchObject({ accepted: true, classification: 'matched', triggerCreated: true });
            if (index === 158) {
                expect(readDirect160ProductRuntimeState(statePath)).toMatchObject({
                    dataActive: 159, awaitingFirstKbar: 1, boundedTransportReady: false,
                });
            }
        }
        const running = readDirect160ProductRuntimeState(statePath);
        expect(running).toMatchObject({ phase: 'running_evaluation', approvedActiveLimit: 20,
            persistedObservationCount: 160, persistedTriggerCount: 160,
            dataActive: 160, awaitingFirstKbar: 0, boundedTransportReady: true });
        const duplicatePrior = baseline.manifests[0].cumulativeSeries[0].cumulativeVolume;
        expect(sink.persistObservation({ ...invalidEnvelope,
            connectionGeneration: 'simulation:product_generation_20260914_0001',
            cumulativeVolume: duplicatePrior,
        })).toMatchObject({ accepted: true, triggerCreated: false });
        expect(readDirect160ProductRuntimeState(statePath)).toMatchObject({
            dataActive: 160, awaitingFirstKbar: 0, boundedTransportReady: true,
            persistedObservationCount: 160, persistedTriggerCount: 160,
        });
        expect(running.items.every((item) => item.completedMinute === '09:01')).toBe(true);
        const repository = new IntradayMonitorEvidenceRepository(evidenceDatabasePath);
        expect(repository.listTriggers('2026-09-14')).toHaveLength(160);
        repository.close();
        expect(sink.finishPendingReview()).toMatchObject({ phase: 'pending_review',
            evaluationState: 'ready_for_review', approvedActiveLimit: 20 });
    }, 30_000);

    it('拒絕產品 config 與 immutable cohort 漂移', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'direct-160-product-drift-'));
        const { manifest, baseline, config } = input();
        const drifted = { ...config, items: [...config.items] };
        drifted.items[0] = { ...drifted.items[0], contract: { ...drifted.items[0].contract, code: '9999', canonicalSymbol: '9999.TW' } };
        expect(() => createDirect160ProductSink({ manifest, baseline, config: drifted,
            tradeDate: '2026-09-14', connectionGeneration: 'product_generation_20260914_0002',
            evidenceDatabasePath: path.join(root, 'evidence.sqlite3'), statePath: path.join(root, 'state.json') }))
            .toThrow('inputs are invalid');
        expect(() => createDirect160ProductSink({ manifest, baseline, config,
            tradeDate: '2026-09-14', connectionGeneration: 'product_generation_20260914_0002',
            evidenceDatabasePath: path.join(root, 'unapproved.sqlite3'),
            statePath: path.join(root, 'unapproved-state.json'), approvedActiveLimit: 160 }))
            .toThrow('inputs are invalid');
    });

    it('只有同一份完整 bundle 與 GO review 可把正式上限原子啟用為 160', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'direct-160-product-activation-'));
        const statePath = path.join(root, 'state.json');
        const { manifest, baseline, config } = input();
        const sink = createDirect160ProductSink({ manifest, baseline, config,
            tradeDate: '2026-09-14', connectionGeneration: 'product_generation_20260914_0003',
            evidenceDatabasePath: path.join(root, 'evidence.sqlite3'), statePath });
        sink.installBaselines();
        sink.finishPendingReview();
        const { bundle, capture } = acceptance({ manifest, baseline });
        const review = createTieredStageReview({ bundle, decision: 'GO', approvedActiveLimit: 160,
            reviewerSignoff: true, reviewedAt: '2026-09-14T13:36:00+08:00' });
        expect(() => activateDirect160ProductRuntime({ statePath,
            capture: { ...capture, runtime: { ...capture.runtime,
                firstMinuteCanary: { ...capture.runtime.firstMinuteCanary,
                    result: 'fail', receivedCount: 159, missingCount: 1,
                    liveAvailabilityComplete: false } } },
            bundle, review, activatedAt: '2026-09-14T13:36:00+08:00' }))
            .toThrow('activation evidence is invalid');
        expect(() => activateDirect160ProductRuntime({ statePath, capture,
            bundle: { ...bundle, bundleHash: '0'.repeat(64) }, review,
            activatedAt: '2026-09-14T13:36:00+08:00' })).toThrow('activation evidence is invalid');
        expect(readDirect160ProductRuntimeState(statePath)).toMatchObject({
            phase: 'pending_review', approvedActiveLimit: 20,
        });
        expect(activateDirect160ProductRuntime({ statePath, capture, bundle, review,
            activatedAt: '2026-09-14T13:36:00+08:00' })).toMatchObject({
            phase: 'complete_go', evaluationState: 'go', approvedActiveLimit: 160,
            operations: { activeLimitMutations: 1 },
        });
        expect(activateDirect160ProductRuntime({ statePath, capture, bundle, review,
            activatedAt: '2026-09-14T13:37:00+08:00' })).toMatchObject({
            phase: 'complete_go', approvedActiveLimit: 160,
            operations: { activeLimitMutations: 1 },
        });
        const reviewPath = path.join(root, 'review.json');
        expect(await reviewAndActivateDirect160Product({ capture, bundle, statePath, reviewPath,
            reviewedAt: '2026-09-14T13:38:00+08:00' })).toMatchObject({
            state: { phase: 'complete_go', approvedActiveLimit: 160 },
        });
        expect(await reviewAndActivateDirect160Product({ capture, bundle, statePath, reviewPath,
            reviewedAt: '2026-09-14T13:39:00+08:00' })).toMatchObject({
            receipt: { created: false },
            state: { phase: 'complete_go', operations: { activeLimitMutations: 1 } },
        });
    });

    it('state-backed gateway 在只有 control-plane receipt 時公開等待逐檔第一筆行情', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'direct-160-state-backed-'));
        const monitorRoot = path.join(root, 'IntradayMonitor');
        const statePath = path.join(monitorRoot, 'direct-160-product-runtime.json');
        const evidenceDatabasePath = path.join(monitorRoot, 'intraday-monitor-evidence.sqlite3');
        const { manifest, baseline, config } = input();
        const configRepository = new IntradayMonitorConfigRepository(
            path.join(monitorRoot, 'intraday-monitor.sqlite3'));
        configRepository.replace({ schemaVersion: 'intraday-monitor-config/1', revision: 0,
            globalThreshold: '1', items: config.items.map((item) => ({
                contract: { security_type: item.contract.securityType, region: item.contract.region,
                    exchange: item.contract.exchange, code: item.contract.code,
                    target_code: item.contract.targetCode },
                enabled: true, thresholdOverride: null, source: 'manual',
            })) });
        const sink = createDirect160ProductSink({ manifest, baseline, config: configRepository.read(),
            tradeDate: '2026-09-14', connectionGeneration: 'product_generation_20260914_0004',
            evidenceDatabasePath, statePath });
        sink.installBaselines();
        configRepository.close();
        const runtime = createStateBackedRuntime(root);
        try {
            expect(runtime.service.readStatus()).toMatchObject({ status: 200, body: { capacity: {
                configured: 160, approvedActiveLimit: 20, evaluationStageTarget: 160,
                evaluationState: 'running', boundedTransportReady: false,
                controlPlaneSubscriptionRequested: true, awaitingFirstKbar: 160,
                globalOwnershipComplete: false, dataActive: 0, waiting: 160,
            } } });
        } finally {
            runtime.close();
            sink.fail('test_complete');
        }
    });
});
