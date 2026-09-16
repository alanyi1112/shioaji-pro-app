import { fixtureBaseline } from './fixtures/direct-160-baseline.mjs';
import { describe, expect, it } from 'vitest';

import {
    createTieredCohortManifests,
    createTieredExecutionToken,
    createTieredStageEvidenceBundle,
    createTieredStagePlan,
    createTieredStageReview,
    createTieredStageSessionEvidence,
    decideTieredRollback,
    evaluateTieredStagePreflight,
    validateTieredCohortManifest,
    validateTieredExecutionToken,
    validateTieredStageEvidenceBundle,
    validateTieredStagePlan,
} from './tiered-capacity-stage-artifacts.mjs';
import { evaluateTieredCapacityStageGate } from './tiered-capacity-evidence.mjs';

const H = 'a'.repeat(64);
const createdAt = '2026-09-08T12:00:00+08:00';

function inputs() {
    const contracts = Array.from({ length: 200 }, (_, index) => ({
        security_type: 'STK', region: 'TW', exchange: index % 2 ? 'OTC' : 'TSE',
        code: String(1001 + index), target_code: null,
    }));
    return {
        config: { revision: 3, items: contracts.map((contract) => ({ contract, enabled: true })) },
        contracts,
    };
}

function budgets() {
    return {
        maxCpuBasisPoints: 4_000,
        maxRssBytes: 512_000_000,
        maxDatabaseGrowthBytes: 50_000_000,
        minimumAvailableDiskBytes: 8_589_934_592,
        maxEventToSealLatencyMs: 2_000,
        maxChartFreshnessMs: 3_000,
        reconnectRequired: true,
        existingFeaturesRequired: true,
    };
}

describe('分級 cohort、plan 與 preflight artifacts', () => {
    it('直接 160 的 plan 綁定空間 profile，token v3 接受 20 GO 並拒絕低磁碟與舊 token', () => {
        const manifest = createTieredCohortManifests({ ...inputs(), sourceVersion: '1.7.1', createdAt })[160];
        const plan = createTieredStagePlan({ manifest, budgets: budgets(), createdAt });
        const gate = evaluateTieredCapacityStageGate({ targetStage: 160, priorApprovedStage: 20,
            priorDecision: 'GO', priorBundleValid: true, priorBundleSha256: H });
        const runtime = { loopback: true, simulation: true, production: false, featureEnabled: false,
            notificationsEnabled: false, brokerAuthority: false, uniqueStageProcess: true,
            legalTradingDay: true, withinStartupWindow: true };
        const preflight = evaluateTieredStagePreflight({ plan, manifest, gate, runtime,
            storage: { writable: true, availableDiskBytes: 10_000_000_000 } });
        expect(preflight.readyForToken).toBe(true);
        expect(evaluateTieredStagePreflight({ plan, manifest, gate, runtime,
            storage: { writable: true, availableDiskBytes: 4_000_000_000 } }).readyForToken).toBe(false);
        expect(validateTieredStagePlan({ ...plan, storageProfile: { ...plan.storageProfile, captureOutputBytes: 1 } }, manifest).valid).toBe(false);
        const token = createTieredExecutionToken({ preflight, priorBundleSha256: H,
            issuedAt: '2026-09-11T08:50:00+08:00', expiresAt: '2026-09-11T09:00:30+08:00' });
        const context = { plan, manifest, now: '2026-09-11T08:55:00+08:00' };
        expect(validateTieredExecutionToken(token, context).valid).toBe(true);
        expect(validateTieredExecutionToken({ ...token, schemaVersion: 'intraday-monitor-tiered-execution-token/1' }, context).valid).toBe(false);
    });
    it('由相同排序產生巢狀 exact 50/100/160 immutable manifests', () => {
        const source = inputs();
        source.config.items.unshift({
            enabled: true,
            contract: { security_type: 'STK', region: 'TW', exchange: 'TSE', code: '0050', target_code: null },
        });
        source.contracts.unshift({ security_type: 'STK', region: 'TW', exchange: 'TSE', code: '0050', target_code: null });
        const manifests = createTieredCohortManifests({ ...source, sourceVersion: '1.7.1', createdAt });
        expect(Object.keys(manifests)).toEqual(['50', '100', '160']);
        for (const stage of [50, 100, 160]) {
            expect(validateTieredCohortManifest(manifests[stage])).toEqual({ valid: true, reasons: [] });
            expect(manifests[stage].cohort).toHaveLength(stage);
            expect(manifests[stage].provider).toEqual({
                physicalUsage: null, globalOwnershipComplete: null, releaseProven: null, headroom: null,
            });
        }
        expect(manifests[100].cohort.slice(0, 50)).toEqual(manifests[50].cohort);
        expect(manifests[160].cohort.slice(0, 100)).toEqual(manifests[100].cohort);
        expect(manifests[50].cohort.some((entry) => entry.canonicalSymbol.startsWith('0050.'))).toBe(false);
    });

    it('拒絕不足 160、重複 contract 與 hash 漂移', () => {
        const source = inputs();
        expect(() => createTieredCohortManifests({
            config: { ...source.config, items: source.config.items.slice(0, 159) },
            contracts: source.contracts, sourceVersion: '1.7.1', createdAt,
        })).toThrow(/160/);
        expect(() => createTieredCohortManifests({
            ...source, contracts: [...source.contracts, source.contracts[0]], sourceVersion: '1.7.1', createdAt,
        })).toThrow(/ambiguous/);
        const manifest = createTieredCohortManifests({ ...source, sourceVersion: '1.7.1', createdAt })[50];
        expect(validateTieredCohortManifest({ ...manifest, configRevision: 4 }).valid).toBe(false);
    });

    it('plan 鎖定完整 budgets，一個盤中日搭配可信前日基準', () => {
        const manifests = createTieredCohortManifests({ ...inputs(), sourceVersion: '1.7.1', createdAt });
        for (const stage of [50, 100, 160]) {
            const plan = createTieredStagePlan({ manifest: manifests[stage], budgets: budgets(), createdAt });
            expect(validateTieredStagePlan(plan, manifests[stage])).toEqual({ valid: true, reasons: [] });
            expect(plan.minimumCompleteTradingDays).toBe(1);
            expect(plan.provider.physicalUsage).toBeNull();
        }
    });

    it('preflight 只產生判定，缺唯一 process 或啟動窗時 fail closed', () => {
        const manifest = createTieredCohortManifests({ ...inputs(), sourceVersion: '1.7.1', createdAt })[50];
        const plan = createTieredStagePlan({ manifest, budgets: budgets(), createdAt });
        const gate = evaluateTieredCapacityStageGate({ targetStage: 50, priorApprovedStage: 20,
            priorDecision: 'GO', priorBundleValid: true, priorBundleSha256: H });
        const runtime = { loopback: true, simulation: true, production: false, featureEnabled: false,
            notificationsEnabled: false, brokerAuthority: false, uniqueStageProcess: true,
            legalTradingDay: true, withinStartupWindow: true };
        const storage = { writable: true, availableDiskBytes: 10_000_000_000 };
        expect(evaluateTieredStagePreflight({ plan, manifest, gate, runtime, storage })).toMatchObject({
            readyForToken: true, reasons: [], validatorExecutionAuthority: false,
        });
        expect(evaluateTieredStagePreflight({ plan, manifest, gate, runtime: {
            ...runtime, uniqueStageProcess: false, withinStartupWindow: false,
        }, storage })).toMatchObject({
            readyForToken: false,
            reasons: ['outside_startup_window', 'unique_stage_process_not_confirmed'],
        });
    });

    it('一次性 token 綁定 plan/manifest/prior bundle 且 validator 不授權執行', () => {
        const manifest = createTieredCohortManifests({ ...inputs(), sourceVersion: '1.7.1', createdAt })[50];
        const plan = createTieredStagePlan({ manifest, budgets: budgets(), createdAt });
        const preflight = { readyForToken: true, stage: 50, planHash: plan.planHash, manifestHash: manifest.manifestHash };
        const token = createTieredExecutionToken({ preflight, priorBundleSha256: H,
            issuedAt: '2026-09-09T08:50:00+08:00', expiresAt: '2026-09-09T09:00:30+08:00', nonce: 'nonce_stage_50' });
        expect(validateTieredExecutionToken(token, { plan, manifest, now: '2026-09-09T08:55:00+08:00' })).toEqual({
            valid: true, reasons: [], grantsExecutionAuthority: false,
        });
        expect(validateTieredExecutionToken({ ...token, consumedAt: '2026-09-09T08:56:00+08:00' },
            { plan, manifest, now: '2026-09-09T08:57:00+08:00' }).valid).toBe(false);
        expect(validateTieredExecutionToken(token, { plan, manifest, now: '2026-09-09T09:01:00+08:00' }).valid).toBe(false);
    });

    it('Stage 160 以可信基準加一個完整盤中日交給審查', () => {
        const manifest = createTieredCohortManifests({ ...inputs(), sourceVersion: '1.7.1', createdAt })[160];
        const plan = createTieredStagePlan({ manifest, budgets: budgets(), createdAt });
        const baseline = fixtureBaseline(manifest);
        const evidence = (tradeDate, connectionGeneration) => createTieredStageSessionEvidence({
            plan, manifest, evidence: {
                tradeDate, connectionGeneration, baselineHash: baseline.baselineHash, exactCohortCount: 160, minuteSlotCount: 43_200,
                coverageStartMinute: '09:01', coverageEndMinute: '13:30', complete: true,
                zeroVolumeProvenancePreserved: true, unknownNotCoerced: true,
                reconnectVerified: true, existingFeaturesHealthy: true,
                transport: { subscribeAccepted: true, unsubscribeAccepted: true, providerReleaseProven: false },
                replay: { runCount: 2, consistent: true, inputHash: H, outputHash: H, triggerCount: 0 },
                resources: { cpuBasisPoints: 1_000, maxRssBytes: 200_000_000,
                    databaseGrowthBytes: 1_000_000, minimumAvailableDiskBytes: 10_000_000_000,
                    maxEventToSealLatencyMs: 500, maxChartFreshnessMs: 1_000 },
                provider: { physicalUsage: null, globalOwnershipComplete: null, releaseProven: null, headroom: null },
                operations: { networkWrites: 0, subscriptionMutations: 0, notificationDispatches: 0,
                    brokerWrites: 0, productionTransitions: 0, serviceLifecycleMutations: 0,
                    activeLimitMutations: 0 },
            },
        });
        const first = evidence('2026-09-14', 'generation_stage160_day1');
        const pending = createTieredStageEvidenceBundle({ plan, manifest, sessions: [first], createdAt });
        expect(validateTieredStageEvidenceBundle(pending)).toMatchObject({
            valid: true, readyForHumanReview: false,
            reasons: ['verified_previous_session_baseline_required'], completeTradingDays: 1,
        });
        const bundle = createTieredStageEvidenceBundle({ plan, manifest, sessions: [first], baseline, createdAt });
        expect(validateTieredStageEvidenceBundle(bundle)).toMatchObject({
            valid: true, readyForHumanReview: true, reasons: [], completeTradingDays: 1,
            automaticStagePromotionAuthority: false,
        });
        const wrongBaseline = structuredClone(baseline); wrongBaseline.manifests.pop();
        expect(validateTieredStageEvidenceBundle(createTieredStageEvidenceBundle({ plan, manifest,
            sessions: [first], baseline: wrongBaseline, createdAt })).readyForHumanReview).toBe(false);
        const review = createTieredStageReview({ bundle, decision: 'GO', approvedActiveLimit: 160,
            reviewerSignoff: true, reviewedAt: '2026-09-11T15:00:00+08:00' });
        expect(decideTieredRollback({ attemptedStage: 160, review })).toMatchObject({
            outcome: 'GO', retainedActiveLimit: 160, activeLimitMutationAuthority: false,
        });
        expect(decideTieredRollback({ attemptedStage: 160, review: null })).toMatchObject({
            outcome: 'ROLLBACK', retainedActiveLimit: 20, automaticRetryAuthority: false,
        });
    });

    it('Stage bundle 拒絕 generation 重用與超出預算', () => {
        const manifest = createTieredCohortManifests({ ...inputs(), sourceVersion: '1.7.1', createdAt })[160];
        const plan = createTieredStagePlan({ manifest, budgets: budgets(), createdAt });
        const make = (date) => createTieredStageSessionEvidence({ plan, manifest, evidence: {
            tradeDate: date, connectionGeneration: 'generation_reused_160', exactCohortCount: 160,
            minuteSlotCount: 43_200, coverageStartMinute: '09:01', coverageEndMinute: '13:30', complete: true,
            zeroVolumeProvenancePreserved: true, unknownNotCoerced: true, reconnectVerified: true,
            existingFeaturesHealthy: true,
            transport: { subscribeAccepted: true, unsubscribeAccepted: true, providerReleaseProven: false },
            replay: { runCount: 2, consistent: true, inputHash: H, outputHash: H, triggerCount: 0 },
            resources: { cpuBasisPoints: 100, maxRssBytes: 100_000_000, databaseGrowthBytes: 0,
                minimumAvailableDiskBytes: 10_000_000_000, maxEventToSealLatencyMs: 100,
                maxChartFreshnessMs: 100 },
            provider: { physicalUsage: null, globalOwnershipComplete: null, releaseProven: null, headroom: null },
            operations: { networkWrites: 0, subscriptionMutations: 0, notificationDispatches: 0,
                brokerWrites: 0, productionTransitions: 0, serviceLifecycleMutations: 0,
                activeLimitMutations: 0 },
        } });
        const bundle = createTieredStageEvidenceBundle({ plan, manifest,
            sessions: [make('2026-09-10'), make('2026-09-11')], createdAt });
        expect(validateTieredStageEvidenceBundle(bundle)).toMatchObject({
            valid: true, readyForHumanReview: false, reasons: ['connection_generation_reused', 'verified_previous_session_baseline_required'],
        });
        expect(() => createTieredStageSessionEvidence({ plan, manifest,
            evidence: { ...make('2026-09-12'), resources: { ...make('2026-09-12').resources,
                maxRssBytes: budgets().maxRssBytes + 1 } } })).toThrow();
    });
});
