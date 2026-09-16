import { randomUUID } from 'node:crypto';

import { validateDirect160BaselineSet } from './direct-160-baseline.mjs';
import { DIRECT_160_STORAGE, assessDirect160Disk, hashDirect160 } from './direct-160-storage.mjs';
import { TIERED_CAPACITY_STAGES, evaluateTieredCapacityStageGate } from './tiered-capacity-evidence.mjs';

export const TIERED_COHORT_MANIFEST_SCHEMA = 'intraday-monitor-tiered-cohort-manifest/1';
export const TIERED_STAGE_PLAN_SCHEMA = 'intraday-monitor-tiered-stage-plan/3';
export const TIERED_EXECUTION_TOKEN_SCHEMA = 'intraday-monitor-tiered-execution-token/3';
export const TIERED_STAGE_SESSION_SCHEMA = 'intraday-monitor-tiered-stage-session/1';
export const TIERED_STAGE_BUNDLE_SCHEMA = 'intraday-monitor-tiered-stage-bundle/2';
export const TIERED_STAGE_REVIEW_SCHEMA = 'intraday-monitor-tiered-stage-review/1';

const HASH = /^[a-f0-9]{64}$/;
const SYMBOL = /^\d{4}\.(?:TW|TWO)$/;
const ZERO_OPERATIONS = Object.freeze({
    networkWrites: 0,
    subscriptionMutations: 0,
    notificationDispatches: 0,
    brokerWrites: 0,
    productionTransitions: 0,
    serviceLifecycleMutations: 0,
    activeLimitMutations: 0,
});

function digest(value) {
    return hashDirect160(value, 'bundle');
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
}

function validInstant(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function withHash(seed, key) {
    return deepFreeze({ ...seed, [key]: digest(seed) });
}

function hashMatches(value, key) {
    if (!HASH.test(value?.[key] ?? '')) return false;
    const seed = { ...value };
    delete seed[key];
    return digest(seed) === value[key];
}

function canonical(contract) {
    if (contract?.security_type !== 'STK' || contract.region !== 'TW' ||
        !['TSE', 'OTC'].includes(contract.exchange) ||
        !/^(?!00)\d{4}$/.test(contract.code ?? '') || contract.target_code !== null) return null;
    return `${contract.code}.${contract.exchange === 'TSE' ? 'TW' : 'TWO'}`;
}

function validManifest(value) {
    return Boolean(
        value?.schemaVersion === TIERED_COHORT_MANIFEST_SCHEMA &&
        TIERED_CAPACITY_STAGES.includes(value.stage) && value.targetCount === value.stage &&
        Number.isSafeInteger(value.configRevision) && value.configRevision >= 1 &&
        typeof value.sourceVersion === 'string' && value.sourceVersion.length > 0 &&
        validInstant(value.createdAt) && Array.isArray(value.cohort) &&
        value.cohort.length === value.stage && new Set(value.cohort).size === value.stage &&
        value.cohort.every((entry, index) => entry?.ordinal === index + 1 &&
            SYMBOL.test(entry.canonicalSymbol ?? '') && entry.eligibilityReason === 'configured_enabled_supported_tw_stock' &&
            entry.contractIdentity?.security_type === 'STK' && entry.contractIdentity.region === 'TW' &&
            ['TSE', 'OTC'].includes(entry.contractIdentity.exchange) &&
            canonical(entry.contractIdentity) === entry.canonicalSymbol && HASH.test(entry.receiptHash ?? '') &&
            digest({ ordinal: entry.ordinal, canonicalSymbol: entry.canonicalSymbol,
                contractIdentity: entry.contractIdentity, eligibilityReason: entry.eligibilityReason }) === entry.receiptHash) &&
        value.provider?.physicalUsage === null && value.provider?.globalOwnershipComplete === null &&
        value.provider?.releaseProven === null && value.provider?.headroom === null &&
        Object.entries(ZERO_OPERATIONS).every(([key, expected]) => value.operations?.[key] === expected) &&
        hashMatches(value, 'manifestHash')
    );
}

export function createTieredCohortManifests({ config, contracts, sourceVersion, createdAt } = {}) {
    if (!config || !Number.isSafeInteger(config.revision) || config.revision < 1 ||
        !Array.isArray(config.items) || !Array.isArray(contracts) ||
        typeof sourceVersion !== 'string' || sourceVersion.length < 1 || !validInstant(createdAt)) {
        throw new TypeError('tiered cohort input is invalid');
    }
    const contractBySymbol = new Map();
    for (const contract of contracts) {
        const symbol = canonical(contract);
        if (!symbol) continue;
        if (contractBySymbol.has(symbol)) throw new TypeError('ambiguous supported contract');
        contractBySymbol.set(symbol, contract);
    }
    const candidates = [];
    for (const item of config.items) {
        if (item?.enabled !== true) continue;
        const symbol = canonical(item.contract);
        if (!symbol || candidates.some((candidate) => candidate.symbol === symbol)) continue;
        const verified = contractBySymbol.get(symbol);
        if (!verified || canonical(verified) !== symbol) continue;
        candidates.push({ symbol, contract: verified });
    }
    if (candidates.length < 160) throw new TypeError('fewer than 160 eligible configured contracts');
    return deepFreeze(Object.fromEntries(TIERED_CAPACITY_STAGES.map((stage) => {
        const cohort = candidates.slice(0, stage).map(({ symbol, contract }, index) => {
            const seed = {
                ordinal: index + 1,
                canonicalSymbol: symbol,
                contractIdentity: {
                    security_type: contract.security_type,
                    region: contract.region,
                    exchange: contract.exchange,
                    code: contract.code,
                    target_code: contract.target_code,
                },
                eligibilityReason: 'configured_enabled_supported_tw_stock',
            };
            return { ...seed, receiptHash: digest(seed) };
        });
        const manifest = withHash({
            schemaVersion: TIERED_COHORT_MANIFEST_SCHEMA,
            stage,
            targetCount: stage,
            configRevision: config.revision,
            sourceVersion,
            createdAt,
            cohort,
            provider: { physicalUsage: null, globalOwnershipComplete: null, releaseProven: null, headroom: null },
            operations: { ...ZERO_OPERATIONS },
        }, 'manifestHash');
        if (!validManifest(manifest)) throw new TypeError('generated cohort manifest is invalid');
        return [stage, manifest];
    })));
}

export function validateTieredCohortManifest(value) {
    const valid = validManifest(value);
    return deepFreeze({ valid, reasons: valid ? [] : ['invalid_tiered_cohort_manifest'] });
}

function validBudgets(value) {
    return value && ['maxCpuBasisPoints', 'maxRssBytes', 'maxDatabaseGrowthBytes',
        'minimumAvailableDiskBytes', 'maxEventToSealLatencyMs', 'maxChartFreshnessMs'].every(
        (key) => Number.isSafeInteger(value[key]) && value[key] > 0,
    ) && value.reconnectRequired === true && value.existingFeaturesRequired === true;
}

export function createTieredStagePlan({ manifest, budgets, createdAt } = {}) {
    if (!validManifest(manifest) || !validBudgets(budgets) || !validInstant(createdAt)) {
        throw new TypeError('tiered stage plan input is invalid');
    }
    return withHash({
        schemaVersion: TIERED_STAGE_PLAN_SCHEMA,
        stage: manifest.stage,
        manifestHash: manifest.manifestHash,
        exactCohortCount: manifest.stage,
        minimumCompleteTradingDays: 1,
        baselinePolicy: manifest.stage === 160 ? 'verified_previous_session_1m_kbar' : null,
        stabilityFollowupBlocking: false,
        budgets: structuredClone(budgets),
        executionPath: manifest.stage === 160 ? 'direct_20_to_160' : 'optional_diagnostic',
        storageProfile: manifest.stage === 160 ? { ...DIRECT_160_STORAGE } : null,
        simulationOnly: true,
        featureEnabled: false,
        notificationsEnabled: false,
        provider: { physicalUsage: null, globalOwnershipComplete: null, releaseProven: null, headroom: null },
        operations: { ...ZERO_OPERATIONS },
        createdAt,
    }, 'planHash');
}

export function validateTieredStagePlan(value, manifest) {
    const valid = Boolean(validManifest(manifest) && value?.schemaVersion === TIERED_STAGE_PLAN_SCHEMA &&
        value.stage === manifest.stage && value.manifestHash === manifest.manifestHash &&
        value.exactCohortCount === value.stage && value.minimumCompleteTradingDays === 1 &&
        value.baselinePolicy === (manifest.stage === 160 ? 'verified_previous_session_1m_kbar' : null) &&
        value.stabilityFollowupBlocking === false &&
        validBudgets(value.budgets) &&
        value.executionPath === (manifest.stage === 160 ? 'direct_20_to_160' : 'optional_diagnostic') &&
        (manifest.stage === 160 ? value.storageProfile?.schemaVersion === DIRECT_160_STORAGE.schemaVersion &&
            Object.entries(DIRECT_160_STORAGE).every(([key, expected]) => value.storageProfile[key] === expected) &&
            value.budgets.minimumAvailableDiskBytes >= DIRECT_160_STORAGE.minimumAvailableDiskBytes : value.storageProfile === null) && value.simulationOnly === true && value.featureEnabled === false &&
        value.notificationsEnabled === false && value.provider?.physicalUsage === null &&
        value.provider?.globalOwnershipComplete === null && value.provider?.releaseProven === null &&
        value.provider?.headroom === null && Object.entries(ZERO_OPERATIONS).every(([key, expected]) =>
            value.operations?.[key] === expected) && validInstant(value.createdAt) && hashMatches(value, 'planHash'));
    return deepFreeze({ valid, reasons: valid ? [] : ['invalid_tiered_stage_plan'] });
}

export function evaluateTieredStagePreflight({ plan, manifest, gate, runtime, storage } = {}) {
    const reasons = new Set();
    if (!validateTieredStagePlan(plan, manifest).valid) reasons.add('invalid_plan_or_manifest');
    if (gate?.readyForExecutionAuthority !== true || gate?.targetStage !== plan?.stage) reasons.add('prior_stage_gate_not_ready');
    if (runtime?.loopback !== true) reasons.add('endpoint_not_loopback');
    if (runtime?.simulation !== true || runtime?.production !== false) reasons.add('simulation_boundary_invalid');
    if (runtime?.featureEnabled !== false) reasons.add('feature_must_remain_off');
    if (runtime?.notificationsEnabled !== false) reasons.add('notifications_must_remain_off');
    if (runtime?.brokerAuthority !== false) reasons.add('broker_authority_present');
    if (runtime?.uniqueStageProcess !== true) reasons.add('unique_stage_process_not_confirmed');
    if (runtime?.legalTradingDay !== true) reasons.add('illegal_trading_day');
    if (runtime?.withinStartupWindow !== true) reasons.add('outside_startup_window');
    if (storage?.writable !== true || !Number.isSafeInteger(storage?.availableDiskBytes) ||
        storage.availableDiskBytes < (plan?.budgets?.minimumAvailableDiskBytes ?? Number.MAX_SAFE_INTEGER)) {
        reasons.add('evidence_storage_not_ready');
    }
    if (plan?.stage === 160 && !assessDirect160Disk(storage?.availableDiskBytes).ready) reasons.add('direct_160_disk_reserve_not_ready');
    return deepFreeze({
        readyForToken: reasons.size === 0,
        reasons: [...reasons].sort(),
        stage: plan?.stage ?? null,
        planHash: plan?.planHash ?? null,
        manifestHash: manifest?.manifestHash ?? null,
        validatorExecutionAuthority: false,
        providerRequestAuthority: false,
        subscriptionTransportAuthority: false,
        serviceLifecycleAuthority: false,
        brokerWriteAuthority: false,
    });
}

export function createTieredExecutionToken({ preflight, priorBundleSha256, issuedAt, expiresAt, nonce = randomUUID() } = {}) {
    if (preflight?.readyForToken !== true || !HASH.test(priorBundleSha256 ?? '') ||
        !validInstant(issuedAt) || !validInstant(expiresAt) || Date.parse(expiresAt) <= Date.parse(issuedAt) ||
        typeof nonce !== 'string' || nonce.length < 8) throw new TypeError('execution token input is invalid');
    return withHash({
        schemaVersion: TIERED_EXECUTION_TOKEN_SCHEMA,
        stage: preflight.stage,
        planHash: preflight.planHash,
        manifestHash: preflight.manifestHash,
        priorBundleSha256,
        nonce,
        issuedAt,
        expiresAt,
        consumedAt: null,
        singleUse: true,
        subscriptionTransportAuthority: false,
        serviceLifecycleAuthority: false,
        brokerWriteAuthority: false,
    }, 'tokenHash');
}

export function validateTieredExecutionToken(value, { plan, manifest, now } = {}) {
    const gate = evaluateTieredCapacityStageGate({
        targetStage: value?.stage,
        priorApprovedStage: value?.stage === 100 ? 50 : 20,
        priorDecision: 'GO', priorBundleValid: HASH.test(value?.priorBundleSha256 ?? ''),
        priorBundleSha256: value?.priorBundleSha256, executionTokenUsed: value?.consumedAt !== null,
    });
    const valid = Boolean(value?.schemaVersion === TIERED_EXECUTION_TOKEN_SCHEMA &&
        validateTieredStagePlan(plan, manifest).valid && value.stage === plan.stage &&
        value.planHash === plan.planHash && value.manifestHash === manifest.manifestHash &&
        validInstant(value.issuedAt) && validInstant(value.expiresAt) && validInstant(now) &&
        Date.parse(now) >= Date.parse(value.issuedAt) && Date.parse(now) < Date.parse(value.expiresAt) &&
        value.consumedAt === null && value.singleUse === true && gate.readyForExecutionAuthority &&
        value.subscriptionTransportAuthority === false && value.serviceLifecycleAuthority === false &&
        value.brokerWriteAuthority === false && hashMatches(value, 'tokenHash'));
    return deepFreeze({ valid, reasons: valid ? [] : ['invalid_or_unusable_execution_token'],
        grantsExecutionAuthority: false });
}

function validResources(resources, budgets) {
    return resources && Number.isSafeInteger(resources.cpuBasisPoints) && resources.cpuBasisPoints >= 0 &&
        Number.isSafeInteger(resources.maxRssBytes) && resources.maxRssBytes > 0 &&
        Number.isSafeInteger(resources.databaseGrowthBytes) && resources.databaseGrowthBytes >= 0 &&
        Number.isSafeInteger(resources.minimumAvailableDiskBytes) && resources.minimumAvailableDiskBytes >= 0 &&
        Number.isSafeInteger(resources.maxEventToSealLatencyMs) && resources.maxEventToSealLatencyMs >= 0 &&
        Number.isSafeInteger(resources.maxChartFreshnessMs) && resources.maxChartFreshnessMs >= 0 &&
        resources.cpuBasisPoints <= budgets.maxCpuBasisPoints && resources.maxRssBytes <= budgets.maxRssBytes &&
        resources.databaseGrowthBytes <= budgets.maxDatabaseGrowthBytes &&
        resources.minimumAvailableDiskBytes >= budgets.minimumAvailableDiskBytes &&
        resources.maxEventToSealLatencyMs <= budgets.maxEventToSealLatencyMs &&
        resources.maxChartFreshnessMs <= budgets.maxChartFreshnessMs;
}

function validStageSession(value, plan, manifest) {
    return Boolean(value?.schemaVersion === TIERED_STAGE_SESSION_SCHEMA &&
        value.evidenceClass === 'live_bounded_stage' && value.stage === plan.stage &&
        value.planHash === plan.planHash && value.manifestHash === manifest.manifestHash &&
        /^\d{4}-\d{2}-\d{2}$/.test(value.tradeDate ?? '') &&
        typeof value.connectionGeneration === 'string' && value.connectionGeneration.length >= 16 &&
        value.exactCohortCount === plan.stage && value.minuteSlotCount === plan.stage * 270 &&
        value.coverageStartMinute === '09:01' && value.coverageEndMinute === '13:30' &&
        value.complete === true && value.zeroVolumeProvenancePreserved === true &&
        value.unknownNotCoerced === true && value.reconnectVerified === true &&
        value.existingFeaturesHealthy === true && value.transport?.subscribeAccepted === true &&
        value.transport?.unsubscribeAccepted === true && value.transport?.providerReleaseProven === false &&
        value.replay?.runCount >= 2 && value.replay?.consistent === true &&
        HASH.test(value.replay?.inputHash ?? '') && HASH.test(value.replay?.outputHash ?? '') &&
        Number.isSafeInteger(value.replay?.triggerCount) && value.replay.triggerCount >= 0 &&
        validResources(value.resources, plan.budgets) &&
        value.provider?.physicalUsage === null && value.provider?.globalOwnershipComplete === null &&
        value.provider?.releaseProven === null && value.provider?.headroom === null &&
        Object.entries(ZERO_OPERATIONS).every(([key, expected]) => value.operations?.[key] === expected) &&
        hashMatches(value, 'sessionHash'));
}

export function createTieredStageSessionEvidence({ plan, manifest, evidence } = {}) {
    if (!validateTieredStagePlan(plan, manifest).valid || !evidence || typeof evidence !== 'object') {
        throw new TypeError('tiered stage session input is invalid');
    }
    const session = withHash({
        schemaVersion: TIERED_STAGE_SESSION_SCHEMA,
        evidenceClass: 'live_bounded_stage',
        stage: plan.stage,
        planHash: plan.planHash,
        manifestHash: manifest.manifestHash,
        tradeDate: evidence.tradeDate,
        baselineHash: evidence.baselineHash ?? null,
        connectionGeneration: evidence.connectionGeneration,
        exactCohortCount: evidence.exactCohortCount,
        minuteSlotCount: evidence.minuteSlotCount,
        coverageStartMinute: evidence.coverageStartMinute,
        coverageEndMinute: evidence.coverageEndMinute,
        complete: evidence.complete,
        zeroVolumeProvenancePreserved: evidence.zeroVolumeProvenancePreserved,
        unknownNotCoerced: evidence.unknownNotCoerced,
        reconnectVerified: evidence.reconnectVerified,
        existingFeaturesHealthy: evidence.existingFeaturesHealthy,
        transport: structuredClone(evidence.transport),
        replay: structuredClone(evidence.replay),
        resources: structuredClone(evidence.resources),
        provider: structuredClone(evidence.provider),
        operations: structuredClone(evidence.operations),
    }, 'sessionHash');
    if (!validStageSession(session, plan, manifest)) throw new TypeError('tiered stage session is invalid');
    return session;
}

export function createTieredStageEvidenceBundle({ plan, manifest, sessions, baseline = null, createdAt } = {}) {
    if (!validateTieredStagePlan(plan, manifest).valid || !Array.isArray(sessions) ||
        sessions.some((session) => !validStageSession(session, plan, manifest)) ||
        !validInstant(createdAt)) throw new TypeError('tiered stage bundle input is invalid');
    return withHash({
        schemaVersion: TIERED_STAGE_BUNDLE_SCHEMA,
        stage: plan.stage,
        plan,
        manifest,
        baseline,
        sessions: [...sessions].sort((left, right) => left.tradeDate.localeCompare(right.tradeDate)),
        createdAt,
        provider: { physicalUsage: null, globalOwnershipComplete: null, releaseProven: null, headroom: null },
        operations: { ...ZERO_OPERATIONS },
    }, 'bundleHash');
}

export function validateTieredStageEvidenceBundle(value) {
    const plan = value?.plan;
    const manifest = value?.manifest;
    const reasons = new Set();
    if (value?.schemaVersion !== TIERED_STAGE_BUNDLE_SCHEMA ||
        !validateTieredStagePlan(plan, manifest).valid || value.stage !== plan?.stage ||
        !Array.isArray(value.sessions) || !validInstant(value.createdAt) ||
        value.provider?.physicalUsage !== null || value.provider?.globalOwnershipComplete !== null ||
        value.provider?.releaseProven !== null || value.provider?.headroom !== null ||
        !Object.entries(ZERO_OPERATIONS).every(([key, expected]) => value.operations?.[key] === expected) ||
        !hashMatches(value, 'bundleHash')) reasons.add('invalid_stage_bundle');
    if (!reasons.size) {
        if (value.sessions.some((session) => !validStageSession(session, plan, manifest))) {
            reasons.add('invalid_stage_session');
        }
        const dates = value.sessions.map((session) => session.tradeDate);
        if (new Set(dates).size !== dates.length) reasons.add('duplicate_trade_date');
        if (new Set(value.sessions.map((session) => session.connectionGeneration)).size !== value.sessions.length) {
            reasons.add('connection_generation_reused');
        }
        if (plan.stage === 160 && (dates.length !== 1 || !validateDirect160BaselineSet(value.baseline, manifest, dates[0]))) {
            reasons.add('verified_previous_session_baseline_required');
        }
        if (plan.stage === 160 && value.baseline && value.sessions.some(session => session.baselineHash !== value.baseline.baselineHash)) {
            reasons.add('session_baseline_hash_mismatch');
        }
        if (dates.length < plan.minimumCompleteTradingDays) reasons.add('insufficient_complete_trading_days');
    }
    return deepFreeze({
        valid: !reasons.has('invalid_stage_bundle') && !reasons.has('invalid_stage_session'),
        readyForHumanReview: reasons.size === 0,
        reasons: [...reasons].sort(),
        stage: Number.isSafeInteger(value?.stage) ? value.stage : null,
        completeTradingDays: Array.isArray(value?.sessions) ? new Set(value.sessions.map((item) => item?.tradeDate)).size : 0,
        automaticStagePromotionAuthority: false,
        providerPhysicalUsage: null,
        providerHeadroom: null,
    });
}

export function createTieredStageReview({ bundle, decision, approvedActiveLimit, reviewerSignoff, reviewedAt } = {}) {
    const validation = validateTieredStageEvidenceBundle(bundle);
    if (!validation.readyForHumanReview || !['GO', 'NO_GO'].includes(decision) ||
        reviewerSignoff !== true || !validInstant(reviewedAt) ||
        ![20, 50, 100, 160].includes(approvedActiveLimit) ||
        (decision === 'GO' && approvedActiveLimit !== bundle.stage) ||
        (decision === 'NO_GO' && approvedActiveLimit >= bundle.stage)) {
        throw new TypeError('tiered stage review input is invalid');
    }
    return withHash({
        schemaVersion: TIERED_STAGE_REVIEW_SCHEMA,
        stage: bundle.stage,
        bundleHash: bundle.bundleHash,
        decision,
        approvedActiveLimit,
        reviewerSignoff,
        reviewedAt,
        automaticStagePromotionAuthority: false,
        activeLimitMutationAuthority: false,
    }, 'reviewHash');
}

export function decideTieredRollback({ attemptedStage, review } = {}) {
    const fallback = 20; // 未提供可驗證的更高核准證據時，只保留已完成的 20 檔。
    const approved = review?.schemaVersion === TIERED_STAGE_REVIEW_SCHEMA &&
        review.stage === attemptedStage && review.decision === 'GO' && review.reviewerSignoff === true &&
        review.approvedActiveLimit === attemptedStage && hashMatches(review, 'reviewHash');
    return deepFreeze({
        attemptedStage,
        retainedActiveLimit: approved ? attemptedStage : fallback,
        outcome: approved ? 'GO' : 'ROLLBACK',
        automaticRetryAuthority: false,
        automaticStagePromotionAuthority: false,
        activeLimitMutationAuthority: false,
    });
}
