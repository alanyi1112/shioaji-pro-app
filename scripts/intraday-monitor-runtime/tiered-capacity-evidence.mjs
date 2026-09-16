import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';
import { validateIntradayMonitorPilotEvidenceBundle } from './pilot-shadow-evidence.mjs';
import { validateIntradayMonitorFunctionalAcceptanceBundle, INTRADAY_MONITOR_FUNCTIONAL_ACCEPTANCE_BUNDLE_SCHEMA } from './pilot-acceptance-bundle.mjs';

function validateSourceBundle(value) {
    try {
        return value?.schemaVersion === INTRADAY_MONITOR_FUNCTIONAL_ACCEPTANCE_BUNDLE_SCHEMA
            ? validateIntradayMonitorFunctionalAcceptanceBundle(value)
            : validateIntradayMonitorPilotEvidenceBundle(value);
    } catch { return { valid: false, readyForHumanReview: false }; }
}

export const TIERED_CAPACITY_PREREQUISITE_REVIEW_SCHEMA =
    'intraday-monitor-tiered-capacity-prerequisite-review/1';
export const TIERED_OFFLINE_LOAD_FIXTURE_SCHEMA =
    'intraday-monitor-tiered-offline-load-fixture/1';
export const TIERED_OFFLINE_LOAD_EVIDENCE_SCHEMA =
    'intraday-monitor-tiered-offline-load-evidence/1';

export const TIERED_CAPACITY_STAGES = Object.freeze([50, 100, 160]);

const SOURCE_CHANGE = 'add-configurable-intraday-relative-volume-monitor';
const SYNTHETIC_EVIDENCE_CLASS = 'synthetic_load_only';
const HASH = /^[a-f0-9]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_PRIOR_STAGE = new Map([[50, 20], [100, 50], [160, 20]]);
const PROVIDER_UNKNOWN_KEYS = Object.freeze([
    'physicalUsage', 'globalOwnershipComplete', 'releaseProven', 'headroom',
]);
const ZERO_OPERATION_KEYS = Object.freeze([
    'networkRequests', 'subscriptionMutations', 'notificationDispatches',
    'brokerWrites', 'productionTransitions', 'serviceLifecycleMutations',
    'activeLimitMutations',
]);
const LIMITATIONS = Object.freeze([
    'NOT_FORMAL_MARKET_EVIDENCE',
    'NOT_PROVIDER_CAPACITY_EVIDENCE',
    'NOT_PROVIDER_PHYSICAL_USAGE_EVIDENCE',
]);
const OFFLINE_CANONICAL_MAXIMUM_BYTES = 128 * 1024 * 1024;

async function writeNew(filePath, value) {
    const handle = await open(filePath, 'wx', 0o600);
    try {
        await handle.writeFile(value);
    } finally {
        await handle.close();
    }
}

function offlineOutputPaths(prefix, target) {
    return {
        fixture: `${prefix}.stage-${target}.fixture.json`,
        evidence: `${prefix}.stage-${target}.evidence.json`,
    };
}

function digest(value) {
    return createHash('sha256').update(
        typeof value === 'string' || Buffer.isBuffer(value) ? value : canonicalJson(value, {
            maximumBytes: OFFLINE_CANONICAL_MAXIMUM_BYTES,
        }),
    ).digest('hex');
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
}

function exactRecord(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length &&
        actual.every((key, index) => key === expected[index]);
}

function validInstant(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function safeCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function validUnknownProvider(value) {
    return exactRecord(value, PROVIDER_UNKNOWN_KEYS) &&
        PROVIDER_UNKNOWN_KEYS.every((key) => value[key] === null);
}

function validZeroOperations(value) {
    return exactRecord(value, ZERO_OPERATION_KEYS) &&
        ZERO_OPERATION_KEYS.every((key) => value[key] === 0);
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

function validReview(value) {
    return Boolean(
        exactRecord(value, [
            'schemaVersion', 'sourceChange', 'sourceBundleSha256',
            'approvedActiveLimit', 'decision', 'reviewerSignoff',
            'reviewedAt', 'reviewHash',
        ]) &&
        value.schemaVersion === TIERED_CAPACITY_PREREQUISITE_REVIEW_SCHEMA &&
        value.sourceChange === SOURCE_CHANGE &&
        HASH.test(value.sourceBundleSha256) &&
        value.approvedActiveLimit === 20 &&
        ['GO', 'NO_GO'].includes(value.decision) &&
        typeof value.reviewerSignoff === 'boolean' &&
        (value.reviewedAt === null || validInstant(value.reviewedAt)) &&
        hashMatches(value, 'reviewHash'),
    );
}

export function createTieredCapacityPrerequisiteReview({
    sourceBundle,
    decision,
    approvedActiveLimit,
    reviewerSignoff,
    reviewedAt,
} = {}) {
    const sourceValidation = validateSourceBundle(sourceBundle);
    if (!sourceValidation.valid) throw new TypeError('source pilot bundle is invalid');
    const seed = {
        schemaVersion: TIERED_CAPACITY_PREREQUISITE_REVIEW_SCHEMA,
        sourceChange: SOURCE_CHANGE,
        sourceBundleSha256: digest(sourceBundle),
        approvedActiveLimit,
        decision,
        reviewerSignoff,
        reviewedAt,
    };
    const review = withHash(seed, 'reviewHash');
    if (!validReview(review)) throw new TypeError('tiered prerequisite review is invalid');
    return review;
}

export function evaluateTieredCapacityPrerequisite({ sourceBundle, review } = {}) {
    const reasons = new Set();
    const sourceValidation = validateSourceBundle(sourceBundle);
    if (!sourceValidation.valid) reasons.add('invalid_20_pilot_bundle');
    else {
        if (!sourceValidation.readyForHumanReview) reasons.add('20_pilot_not_ready_for_human_review');
        if (sourceValidation.metrics?.stage !== 20) reasons.add('source_stage_not_20');
        if ((sourceValidation.metrics?.completeTradingDays ?? 0) < (sourceBundle?.schemaVersion === INTRADAY_MONITOR_FUNCTIONAL_ACCEPTANCE_BUNDLE_SCHEMA ? 1 : 2)) {
            reasons.add('two_complete_trading_days_missing');
        }
    }
    if (!validReview(review)) reasons.add('invalid_20_pilot_review');
    else {
        if (review.sourceBundleSha256 !== digest(sourceBundle)) reasons.add('source_bundle_hash_mismatch');
        if (review.decision !== 'GO' || !review.reviewerSignoff || review.reviewedAt === null) {
            reasons.add('reviewer_go_missing');
        }
        if (review.approvedActiveLimit !== 20) reasons.add('approved_active_limit_not_20');
    }
    return deepFreeze({
        valid: !reasons.has('invalid_20_pilot_bundle') &&
            !reasons.has('invalid_20_pilot_review'),
        liveStage50Eligible: reasons.size === 0,
        liveStage160Eligible: reasons.size === 0,
        offlinePlaneEligible: true,
        reasons: [...reasons].sort(),
        providerPhysicalUsage: null,
        globalOwnershipComplete: null,
        providerReleaseProven: null,
        providerHeadroom: null,
        providerRequestAuthority: false,
        subscriptionTransportAuthority: false,
        automaticStagePromotionAuthority: false,
    });
}

export function evaluateTieredCapacityStageGate({
    targetStage,
    priorApprovedStage,
    priorDecision,
    priorBundleValid,
    priorBundleSha256,
    executionTokenUsed = false,
} = {}) {
    const reasons = new Set();
    if (!TIERED_CAPACITY_STAGES.includes(targetStage)) reasons.add('invalid_target_stage');
    const requiredPrior = REQUIRED_PRIOR_STAGE.get(targetStage) ?? null;
    if (requiredPrior !== priorApprovedStage) reasons.add('stage_sequence_violation');
    if (priorDecision !== 'GO') reasons.add('prior_stage_go_missing');
    if (priorBundleValid !== true || !HASH.test(priorBundleSha256 ?? '')) {
        reasons.add('prior_stage_bundle_invalid');
    }
    if (executionTokenUsed !== false) reasons.add('execution_token_already_used');
    return deepFreeze({
        targetStage,
        requiredPriorStage: requiredPrior,
        readyForExecutionAuthority: reasons.size === 0,
        reasons: [...reasons].sort(),
        providerPhysicalUsage: null,
        globalOwnershipComplete: null,
        providerReleaseProven: null,
        providerHeadroom: null,
        subscriptionTransportAuthority: false,
        automaticStagePromotionAuthority: false,
    });
}

export async function runOfflineTieredCapacityLoad({
    capturePath,
    outputPrefix,
    targets,
    createdAt,
    runs = 2,
} = {}) {
    if (typeof capturePath !== 'string' || capturePath.length < 1 ||
        typeof outputPrefix !== 'string' || outputPrefix.length < 1 ||
        !path.isAbsolute(outputPrefix) || !Array.isArray(targets) || targets.length < 1 ||
        new Set(targets).size !== targets.length ||
        targets.some((target) => !TIERED_CAPACITY_STAGES.includes(target)) ||
        !Number.isFinite(Date.parse(createdAt ?? '')) ||
        !Number.isSafeInteger(runs) || runs < 2 || runs > 10) {
        throw new TypeError('offline tiered capacity CLI input is invalid');
    }
    const capture = JSON.parse(await readFile(capturePath, 'utf8'));
    const results = [];
    for (const target of [...targets].sort((left, right) => left - right)) {
        const paths = offlineOutputPaths(outputPrefix, target);
        const fixture = createTieredOfflineLoadFixture({ capture, targetCount: target, createdAt });
        const fixtureValidation = validateTieredOfflineLoadFixture(fixture);
        if (!fixtureValidation.valid) throw new Error(`stage_${target}_fixture_invalid`);
        const evidence = runTieredOfflineLoadReplay(fixture, { runs, createdAt });
        const evidenceValidation = validateTieredOfflineLoadEvidence(evidence);
        if (!evidenceValidation.valid) throw new Error(`stage_${target}_evidence_invalid`);
        await writeNew(paths.fixture, `${JSON.stringify(fixture)}\n`);
        await writeNew(paths.evidence, `${JSON.stringify(evidence, null, 2)}\n`);
        results.push({
            target,
            fixturePath: paths.fixture,
            evidencePath: paths.evidence,
            fixtureHash: fixture.fixtureHash,
            evidenceHash: evidence.evidenceHash,
            replayConsistent: evidence.replay.consistent,
            resources: evidence.resources,
            formalMarketEvidenceEligible: false,
            providerCapacityEvidenceEligible: false,
        });
    }
    return Object.freeze(results);
}

function validSourceRow(row, canonicalSymbol, index) {
    return Boolean(
        row && typeof row === 'object' &&
        row.canonicalSymbol === canonicalSymbol &&
        /^\d{2}:\d{2}$/.test(row.minuteKey ?? '') &&
        row.sequence === index + 1 &&
        safeCount(row.cumulativeVolume) &&
        validInstant(row.receivedTime) &&
        typeof row.sourceVersion === 'string' && row.sourceVersion.length > 0 &&
        row.unit === 'common_lot' &&
        row.completeness === 'complete',
    );
}

function sourceSessionHashMatches(session) {
    if (typeof session?.evidenceHash !== 'string' ||
        !session.evidenceHash.startsWith('sha256:')) return false;
    const seed = { ...session };
    delete seed.evidenceHash;
    return session.evidenceHash === `sha256:${digest(seed)}`;
}

function validSourceCapture(capture) {
    const session = capture?.session;
    if (capture?.schemaVersion !== 'intraday-monitor-bounded-kbar-capture/1' ||
        capture.captureMode !== 'full-session' || capture.interrupted !== false ||
        session?.schemaVersion !== 'intraday-monitor-kbar-shadow-session/1' ||
        !sourceSessionHashMatches(session) ||
        !DATE.test(session.tradeDate ?? '') ||
        session.assessment?.fullSession !== true ||
        session.assessment?.baselineEligible !== true ||
        session.assessment?.notificationEligible !== false ||
        session.expectedMinuteCountPerSymbol !== 270 ||
        !Array.isArray(session.cohort) || session.cohort.length < 1 ||
        session.cohort.length > 200 ||
        !Array.isArray(session.symbols) || session.symbols.length !== session.cohort.length ||
        session.close?.accepted !== true ||
        session.close?.sealedCount !== session.cohort.length ||
        session.close?.normalCloseMinute !== '13:30' ||
        session.close?.delayedCloseMinute !== '13:33' ||
        !Number.isFinite(Date.parse(session.close?.finalizedAt ?? '')) ||
        Date.parse(session.close.finalizedAt) < Date.parse(`${session.tradeDate}T13:34:30+08:00`) ||
        session.adapter?.sinkRejections !== 0 ||
        session.adapter?.providerPhysicalUsage !== null) return false;
    return session.symbols.every((symbol, symbolIndex) =>
        symbol?.canonicalSymbol === session.cohort[symbolIndex] &&
        ['normal_or_revised_13_30', 'delayed_13_33'].includes(symbol.closeMode) &&
        symbol.complete === true && symbol.minuteCount === 270 &&
        symbol.firstMinute === '09:01' && symbol.lastMinute === '13:30' &&
        Array.isArray(symbol.rows) && symbol.rows.length === 270 &&
        symbol.rows.every((row, rowIndex) =>
            validSourceRow(row, symbol.canonicalSymbol, rowIndex)),
    );
}

function syntheticSymbol(index) {
    return `SYNTH_LOAD_${String(index + 1).padStart(3, '0')}`;
}

function mappedRows(source, synthetic) {
    return source.rows.map((row) => ({
        syntheticSymbol: synthetic,
        sourceCanonicalSymbol: source.canonicalSymbol,
        minuteKey: row.minuteKey,
        cumulativeVolume: row.cumulativeVolume,
        sequence: row.sequence,
        receivedTime: row.receivedTime,
        sourceVersion: row.sourceVersion,
        unit: row.unit,
        completeness: row.completeness,
    }));
}

function validMapping(value, index) {
    if (!exactRecord(value, [
        'mappingIndex', 'syntheticSymbol', 'sourceCanonicalSymbol',
        'sourceRowsSha256', 'rows',
    ]) || value.mappingIndex !== index || value.syntheticSymbol !== syntheticSymbol(index) ||
        typeof value.sourceCanonicalSymbol !== 'string' || value.sourceCanonicalSymbol.length < 1 ||
        !HASH.test(value.sourceRowsSha256 ?? '') || !Array.isArray(value.rows) ||
        value.rows.length !== 270 || digest(value.rows.map((row) => ({
            canonicalSymbol: row.sourceCanonicalSymbol,
            minuteKey: row.minuteKey,
            cumulativeVolume: row.cumulativeVolume,
            sequence: row.sequence,
            receivedTime: row.receivedTime,
            sourceVersion: row.sourceVersion,
            unit: row.unit,
            completeness: row.completeness,
        }))) !== value.sourceRowsSha256) return false;
    let prior = -1;
    return value.rows.every((row, rowIndex) => {
        const valid = row?.syntheticSymbol === value.syntheticSymbol &&
            row.sourceCanonicalSymbol === value.sourceCanonicalSymbol &&
            row.sequence === rowIndex + 1 && /^\d{2}:\d{2}$/.test(row.minuteKey ?? '') &&
            safeCount(row.cumulativeVolume) && row.cumulativeVolume >= prior &&
            validInstant(row.receivedTime) && typeof row.sourceVersion === 'string' &&
            row.sourceVersion.length > 0 && row.unit === 'common_lot' &&
            row.completeness === 'complete';
        prior = row.cumulativeVolume;
        return valid;
    });
}

function validOfflineFixture(value) {
    return Boolean(
        exactRecord(value, [
            'schemaVersion', 'evidenceClass', 'sourceCaptureSchemaVersion',
            'sourceCaptureSha256', 'sourceTradeDate', 'targetCount', 'mapping',
            'operations', 'provider', 'createdAt', 'fixtureHash',
        ]) &&
        value.schemaVersion === TIERED_OFFLINE_LOAD_FIXTURE_SCHEMA &&
        value.evidenceClass === SYNTHETIC_EVIDENCE_CLASS &&
        value.sourceCaptureSchemaVersion === 'intraday-monitor-bounded-kbar-capture/1' &&
        HASH.test(value.sourceCaptureSha256 ?? '') && DATE.test(value.sourceTradeDate ?? '') &&
        TIERED_CAPACITY_STAGES.includes(value.targetCount) &&
        Array.isArray(value.mapping) && value.mapping.length === value.targetCount &&
        value.mapping.every(validMapping) && validZeroOperations(value.operations) &&
        validUnknownProvider(value.provider) && validInstant(value.createdAt) &&
        hashMatches(value, 'fixtureHash'),
    );
}

export function createTieredOfflineLoadFixture({ capture, targetCount, createdAt } = {}) {
    if (!validSourceCapture(capture) || !TIERED_CAPACITY_STAGES.includes(targetCount) ||
        !validInstant(createdAt)) {
        throw new TypeError('tiered offline fixture input is invalid');
    }
    const mapping = Array.from({ length: targetCount }, (_, index) => {
        const source = capture.session.symbols[index % capture.session.symbols.length];
        const synthetic = syntheticSymbol(index);
        return {
            mappingIndex: index,
            syntheticSymbol: synthetic,
            sourceCanonicalSymbol: source.canonicalSymbol,
            sourceRowsSha256: digest(source.rows),
            rows: mappedRows(source, synthetic),
        };
    });
    return withHash({
        schemaVersion: TIERED_OFFLINE_LOAD_FIXTURE_SCHEMA,
        evidenceClass: SYNTHETIC_EVIDENCE_CLASS,
        sourceCaptureSchemaVersion: capture.schemaVersion,
        sourceCaptureSha256: digest(capture),
        sourceTradeDate: capture.session.tradeDate,
        targetCount,
        mapping,
        operations: Object.fromEntries(ZERO_OPERATION_KEYS.map((key) => [key, 0])),
        provider: Object.fromEntries(PROVIDER_UNKNOWN_KEYS.map((key) => [key, null])),
        createdAt,
    }, 'fixtureHash');
}

export function validateTieredOfflineLoadFixture(value) {
    const valid = validOfflineFixture(value);
    return deepFreeze({
        valid,
        reasons: valid ? [] : ['invalid_synthetic_load_fixture'],
        formalMarketEvidenceEligible: false,
        providerCapacityEvidenceEligible: false,
        providerPhysicalUsage: null,
        providerHeadroom: null,
    });
}

export function validateTieredLiveEvidenceCandidate(value) {
    if (value?.evidenceClass === SYNTHETIC_EVIDENCE_CLASS) {
        return deepFreeze({
            valid: false,
            reasons: ['synthetic_load_evidence_not_allowed_for_live_stage'],
        });
    }
    return deepFreeze({ valid: false, reasons: ['unsupported_live_stage_evidence_schema'] });
}

function replayOnce(fixture) {
    const itemLatencyMicros = [];
    const items = fixture.mapping.map((mapping) => {
        const started = process.hrtime.bigint();
        let prior = 0;
        let checksum = 0;
        let triggerCount = 0;
        for (const row of mapping.rows) {
            const delta = row.cumulativeVolume - prior;
            if (prior > 0 && row.cumulativeVolume * 100 >= prior * 150) triggerCount += 1;
            checksum = (checksum + row.cumulativeVolume * row.sequence + delta) % 2_147_483_647;
            prior = row.cumulativeVolume;
        }
        itemLatencyMicros.push(Number(process.hrtime.bigint() - started) / 1_000);
        return {
            syntheticSymbol: mapping.syntheticSymbol,
            rowCount: mapping.rows.length,
            finalCumulativeVolume: prior,
            triggerCount,
            checksum,
        };
    });
    const output = {
        targetCount: fixture.targetCount,
        itemCount: items.length,
        rowCount: items.reduce((total, item) => total + item.rowCount, 0),
        triggerCount: items.reduce((total, item) => total + item.triggerCount, 0),
        items,
    };
    return { output, outputHash: digest(output), itemLatencyMicros };
}

function percentile(values, ratio) {
    const ordered = [...values].sort((left, right) => left - right);
    return ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)] ?? 0;
}

function validOfflineEvidence(value) {
    return Boolean(
        exactRecord(value, [
            'schemaVersion', 'evidenceClass', 'fixtureHash', 'targetCount',
            'replay', 'resources', 'operations', 'provider', 'limitations',
            'createdAt', 'evidenceHash',
        ]) &&
        value.schemaVersion === TIERED_OFFLINE_LOAD_EVIDENCE_SCHEMA &&
        value.evidenceClass === SYNTHETIC_EVIDENCE_CLASS && HASH.test(value.fixtureHash ?? '') &&
        TIERED_CAPACITY_STAGES.includes(value.targetCount) &&
        value.replay?.runCount >= 2 && value.replay?.consistent === true &&
        HASH.test(value.replay?.inputHash ?? '') && HASH.test(value.replay?.outputHash ?? '') &&
        safeCount(value.replay?.triggerCount) && Array.isArray(value.replay?.runs) &&
        value.replay.runs.length === value.replay.runCount &&
        value.replay.runs.every((run, index) => run?.run === index + 1 &&
            safeCount(run.elapsedMicros) && run.outputHash === value.replay.outputHash) &&
        exactRecord(value.resources, [
            'cpuUserMicros', 'cpuSystemMicros', 'rssBeforeBytes', 'rssAfterBytes',
            'maxRssBytes', 'databaseGrowthBytes', 'diskBytes',
            'eventProcessingLatencyMicrosP95',
        ]) && Object.values(value.resources).every(safeCount) &&
        value.resources.databaseGrowthBytes === 0 &&
        validZeroOperations(value.operations) && validUnknownProvider(value.provider) &&
        Array.isArray(value.limitations) &&
        LIMITATIONS.every((item) => value.limitations.includes(item)) &&
        validInstant(value.createdAt) && hashMatches(value, 'evidenceHash'),
    );
}

export function runTieredOfflineLoadReplay(fixture, { runs = 2, createdAt } = {}) {
    if (!validOfflineFixture(fixture) || !Number.isSafeInteger(runs) || runs < 2 || runs > 10 ||
        !validInstant(createdAt)) throw new TypeError('tiered offline replay input is invalid');
    const rssBeforeBytes = process.memoryUsage.rss();
    const cpuBefore = process.cpuUsage();
    const runResults = [];
    const allLatencies = [];
    let firstOutput = null;
    for (let index = 0; index < runs; index += 1) {
        const started = process.hrtime.bigint();
        const result = replayOnce(fixture);
        const elapsedMicros = Math.ceil(Number(process.hrtime.bigint() - started) / 1_000);
        runResults.push({ run: index + 1, elapsedMicros, outputHash: result.outputHash });
        allLatencies.push(...result.itemLatencyMicros);
        if (index === 0) firstOutput = result.output;
    }
    const cpu = process.cpuUsage(cpuBefore);
    const rssAfterBytes = process.memoryUsage.rss();
    const outputHashes = new Set(runResults.map((run) => run.outputHash));
    const seed = {
        schemaVersion: TIERED_OFFLINE_LOAD_EVIDENCE_SCHEMA,
        evidenceClass: SYNTHETIC_EVIDENCE_CLASS,
        fixtureHash: fixture.fixtureHash,
        targetCount: fixture.targetCount,
        replay: {
            runCount: runs,
            consistent: outputHashes.size === 1,
            inputHash: fixture.fixtureHash,
            outputHash: runResults[0].outputHash,
            triggerCount: firstOutput.triggerCount,
            runs: runResults,
        },
        resources: {
            cpuUserMicros: cpu.user,
            cpuSystemMicros: cpu.system,
            rssBeforeBytes,
            rssAfterBytes,
            maxRssBytes: Math.max(rssBeforeBytes, rssAfterBytes),
            databaseGrowthBytes: 0,
            diskBytes: Buffer.byteLength(canonicalJson(fixture, {
                maximumBytes: OFFLINE_CANONICAL_MAXIMUM_BYTES,
            })),
            eventProcessingLatencyMicrosP95: Math.ceil(percentile(allLatencies, 0.95)),
        },
        operations: Object.fromEntries(ZERO_OPERATION_KEYS.map((key) => [key, 0])),
        provider: Object.fromEntries(PROVIDER_UNKNOWN_KEYS.map((key) => [key, null])),
        limitations: [...LIMITATIONS],
        createdAt,
    };
    const evidence = withHash(seed, 'evidenceHash');
    if (!validOfflineEvidence(evidence)) throw new TypeError('tiered offline evidence is invalid');
    return evidence;
}

export function validateTieredOfflineLoadEvidence(value) {
    const valid = validOfflineEvidence(value);
    const reasons = [];
    if (!valid) reasons.push('invalid_synthetic_load_evidence');
    return deepFreeze({
        valid,
        readyForOfflineReview: valid,
        reasons,
        formalMarketEvidenceEligible: false,
        providerCapacityEvidenceEligible: false,
        providerPhysicalUsage: null,
        providerHeadroom: null,
    });
}
