import { createHash } from 'node:crypto';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';
import { INTRADAY_MONITOR_KBAR_SHADOW_EVIDENCE_MAXIMUM_BYTES } from './kbar-shadow-session-recorder.mjs';
import { createIntradayRelativeVolumeTriggerLedger } from './relative-volume-evaluator.mjs';
import { isHistoricalKbarBaselineManifest } from './historical-kbar-repair.mjs';
import {
    createIntradayMonitorPilotEvidenceBundle,
    createIntradayMonitorPilotShadowRecorder,
    validateIntradayMonitorPilotStagePlan,
} from './pilot-shadow-evidence.mjs';
import { validateIntradayMonitorPilotRuntimeAssurance } from './pilot-runtime-assurance.mjs';

const HASH = /^[a-f0-9]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COMPLETE_MINUTES = 270;
const NORMAL_CLOSE_MINUTE = '13:30';
const DELAYED_CLOSE_MINUTE = '13:33';
const CLOSE_FINALIZATION_TIME = '13:34:30';
export const INTRADAY_MONITOR_FUNCTIONAL_ACCEPTANCE_BUNDLE_SCHEMA =
    'intraday-monitor-functional-acceptance-bundle/1';
export const INTRADAY_MONITOR_FUNCTIONAL_ACCEPTANCE_BUNDLE_MAXIMUM_BYTES =
    16 * 1024 * 1024;

function digest(value) {
    return createHash('sha256').update(canonicalJson(value, {
        maximumBytes: INTRADAY_MONITOR_KBAR_SHADOW_EVIDENCE_MAXIMUM_BYTES,
    })).digest('hex');
}

function functionalDigest(value) {
    return createHash('sha256').update(canonicalJson(value, {
        maximumBytes: INTRADAY_MONITOR_FUNCTIONAL_ACCEPTANCE_BUNDLE_MAXIMUM_BYTES,
    })).digest('hex');
}

function rawEvidenceHashMatches(session) {
    if (typeof session?.evidenceHash !== 'string' || !session.evidenceHash.startsWith('sha256:')) return false;
    const seed = { ...session };
    delete seed.evidenceHash;
    return session.evidenceHash === `sha256:${digest(seed)}`;
}

function validThreshold(value) {
    if (typeof value !== 'string' || !/^(?:[1-9]\d?|100)(?:\.\d{1,2})?$/.test(value)) return false;
    const [whole, fraction = ''] = value.split('.');
    const hundredths = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return hundredths >= 100 && hundredths <= 10_000;
}

function completeCapture(capture, plan) {
    const session = capture?.session;
    const resources = capture?.rehearsal?.resources;
    const latency = capture?.rehearsal?.kbarLatencyMs;
    if (capture?.schemaVersion !== 'intraday-monitor-bounded-kbar-capture/1' ||
        capture.captureMode !== 'full-session' || capture.interrupted !== false ||
        capture.cohortReceiptManifestHash !== plan.cohortReceiptManifestHash ||
        session?.schemaVersion !== 'intraday-monitor-kbar-shadow-session/1' ||
        !rawEvidenceHashMatches(session) ||
        session.assessment?.fullSession !== true ||
        session.assessment?.baselineEligible !== true ||
        session.assessment?.notificationEligible !== false ||
        session.expectedMinuteCountPerSymbol !== COMPLETE_MINUTES ||
        !Array.isArray(session.cohort) ||
        session.cohort.length !== plan.cohort.length ||
        session.cohort.some((symbol, index) => symbol !== plan.cohort[index]) ||
        !Array.isArray(session.symbols) || session.symbols.length !== plan.cohort.length ||
        session.close?.accepted !== true || session.close?.sealedCount !== plan.cohort.length ||
        session.close?.normalCloseMinute !== NORMAL_CLOSE_MINUTE ||
        session.close?.delayedCloseMinute !== DELAYED_CLOSE_MINUTE ||
        !Number.isFinite(Date.parse(session.close?.finalizedAt ?? '')) ||
        Date.parse(session.close.finalizedAt) < Date.parse(`${session.tradeDate}T${CLOSE_FINALIZATION_TIME}+08:00`) ||
        session.adapter?.sinkRejections !== 0 || session.adapter?.providerPhysicalUsage !== null ||
        capture.transport?.startReceipt?.subscribeAccepted !== true ||
        capture.transport?.startReceipt?.providerPhysicalUsage !== null ||
        capture.transport?.stopReceipt?.unsubscribeAccepted !== true ||
        capture.transport?.stopReceipt?.providerReleaseProven !== false ||
        capture.rehearsal?.formalAcceptanceEvidence !== true ||
        capture.rehearsal?.baselineEligible !== true ||
        capture.rehearsal?.notificationAuthority !== false ||
        !Number.isSafeInteger(latency?.p95) || latency.p95 < 0 ||
        !Number.isSafeInteger(resources?.cpuBasisPoints) || resources.cpuBasisPoints < 0 ||
        !Number.isSafeInteger(resources?.maxRssBytes) || resources.maxRssBytes < 1 ||
        resources.evidenceDatabaseWrites !== 0 || resources.evidenceDatabaseGrowthBytes !== 0 ||
        !Object.values(session.operations ?? {}).every((value) => value === false || value === 0)) {
        return false;
    }
    return session.symbols.every((symbol, symbolIndex) =>
        symbol?.canonicalSymbol === plan.cohort[symbolIndex] &&
        ['normal_or_revised_13_30', 'delayed_13_33'].includes(symbol.closeMode) &&
        symbol.complete === true && symbol.minuteCount === COMPLETE_MINUTES &&
        symbol.firstMinute === '09:01' && symbol.lastMinute === '13:30' &&
        Array.isArray(symbol.rows) && symbol.rows.length === COMPLETE_MINUTES &&
        symbol.rows.every((row, rowIndex) =>
            row?.canonicalSymbol === symbol.canonicalSymbol &&
            row.sequence === rowIndex + 1 &&
            Number.isSafeInteger(row.cumulativeVolume) && row.cumulativeVolume >= 0 &&
            row.unit === 'common_lot' && row.completeness === 'complete' &&
            typeof row.sourceVersion === 'string' && row.sourceVersion.length > 0 &&
            Number.isFinite(Date.parse(row.receivedTime)),
        ),
    );
}

export function validateIntradayMonitorBoundedKbarCapture(capture, plan) {
    const planValidation = validateIntradayMonitorPilotStagePlan(plan);
    if (!planValidation.valid) {
        return Object.freeze({
            valid: false,
            reasons: Object.freeze(['invalid_plan']),
            tradeDate: null,
            cohortSize: 0,
            completeSymbolCount: 0,
            expectedMinuteCountPerSymbol: COMPLETE_MINUTES,
            fullSession: false,
            baselineEligible: false,
        });
    }
    const valid = completeCapture(capture, plan);
    const symbols = Array.isArray(capture?.session?.symbols) ? capture.session.symbols : [];
    return Object.freeze({
        valid,
        reasons: Object.freeze(valid ? [] : ['invalid_full_session_capture']),
        tradeDate: DATE.test(capture?.session?.tradeDate ?? '') ? capture.session.tradeDate : null,
        cohortSize: Array.isArray(capture?.session?.cohort) ? capture.session.cohort.length : 0,
        completeSymbolCount: symbols.filter((symbol) =>
            symbol?.complete === true && symbol.minuteCount === COMPLETE_MINUTES &&
            symbol.firstMinute === '09:01' && symbol.lastMinute === '13:30',
        ).length,
        expectedMinuteCountPerSymbol: COMPLETE_MINUTES,
        fullSession: capture?.session?.assessment?.fullSession === true,
        baselineEligible: capture?.session?.assessment?.baselineEligible === true,
    });
}

function replaySteps(capture, baseline, configRevision, threshold) {
    if (!baseline) return [];
    const baselineBySymbol = new Map(baseline.session.symbols.map((item) => [item.canonicalSymbol, item]));
    const steps = [];
    for (const symbol of capture.session.symbols) {
        const prior = baselineBySymbol.get(symbol.canonicalSymbol);
        if (!prior || prior.rows.length !== symbol.rows.length) throw new Error('baseline cohort is incomplete');
        for (let index = 0; index < symbol.rows.length; index += 1) {
            const current = symbol.rows[index];
            const previous = prior.rows[index];
            if (current.minuteKey !== previous.minuteKey) throw new Error('baseline minute mismatch');
            steps.push({
                admitted: true,
                tradeDate: capture.session.tradeDate,
                baselineTradeDate: baseline.session.tradeDate,
                canonicalSymbol: symbol.canonicalSymbol,
                exchange: symbol.canonicalSymbol.endsWith('.TWO') ? 'OTC' : 'TSE',
                minuteKey: current.minuteKey,
                configRevision,
                threshold,
                currentCumulativeVolume: current.cumulativeVolume,
                previousCumulativeVolume: previous.cumulativeVolume,
                todayCompleteness: 'complete',
                baselineCompleteness: 'complete',
                calendarCurrent: true,
                sessionCurrent: true,
                generationCurrent: true,
                continuityComplete: true,
                unit: 'common_lot',
                sourceVersion: current.sourceVersion,
                observationMode: 'historical',
                revisionFirstComparable: index === 0,
                createdAt: current.receivedTime,
            });
        }
    }
    return steps;
}

function normalizedLiveBaseline(capture, plan, targetTradeDate) {
    if (!completeCapture(capture, plan) || capture.session.tradeDate >= targetTradeDate) {
        throw new TypeError('functional live baseline capture is invalid');
    }
    return {
        kind: 'live_capture',
        provenance: 'live_full_session_verified',
        tradeDate: capture.session.tradeDate,
        targetTradeDate,
        cohortHash: capture.session.cohortHash,
        referenceHash: capture.session.evidenceHash,
        symbols: capture.session.symbols.map((item) => ({
            canonicalSymbol: item.canonicalSymbol,
            cumulativeSeries: item.rows.map((row) => ({
                minuteKey: row.minuteKey,
                cumulativeVolume: row.cumulativeVolume,
            })),
        })),
    };
}

function normalizedHistoricalBaseline(manifests, plan, targetTradeDate) {
    if (!Array.isArray(manifests) || manifests.length !== plan.cohort.length) {
        throw new TypeError('functional historical baseline cohort is incomplete');
    }
    const bySymbol = new Map(manifests.map((manifest) => [manifest?.symbol, manifest]));
    const ordered = plan.cohort.map((symbol) => bySymbol.get(symbol));
    if (
        bySymbol.size !== plan.cohort.length ||
        ordered.some((manifest) =>
            !isHistoricalKbarBaselineManifest(manifest) ||
            manifest.targetTradeDate !== targetTradeDate)
    ) {
        throw new TypeError('functional historical baseline manifest is invalid');
    }
    const tradeDates = new Set(ordered.map((manifest) => manifest.tradeDate));
    const cohortHashes = new Set(ordered.map((manifest) => manifest.cohortHash));
    if (tradeDates.size !== 1 || cohortHashes.size !== 1) {
        throw new TypeError('functional historical baseline authority is inconsistent');
    }
    return {
        kind: 'historical_baseline_manifests',
        provenance: 'historical_baseline_verified',
        tradeDate: ordered[0].tradeDate,
        targetTradeDate,
        cohortHash: ordered[0].cohortHash,
        referenceHash: `sha256:${functionalDigest(
            ordered.map((manifest) => manifest.manifestId),
        )}`,
        symbols: ordered.map((manifest) => ({
            canonicalSymbol: manifest.symbol,
            cumulativeSeries: manifest.cumulativeSeries.map((row) => ({
                minuteKey: row.minuteKey,
                cumulativeVolume: row.cumulativeVolume,
            })),
        })),
    };
}

function functionalReplaySteps(capture, baseline, configRevision, threshold) {
    const baselineBySymbol = new Map(
        baseline.symbols.map((item) => [item.canonicalSymbol, item]),
    );
    const steps = [];
    for (const symbol of capture.session.symbols) {
        const prior = baselineBySymbol.get(symbol.canonicalSymbol);
        if (!prior || prior.cumulativeSeries.length !== symbol.rows.length) {
            throw new Error('functional baseline cohort is incomplete');
        }
        for (let index = 0; index < symbol.rows.length; index += 1) {
            const current = symbol.rows[index];
            const previous = prior.cumulativeSeries[index];
            if (current.minuteKey !== previous.minuteKey) {
                throw new Error('functional baseline minute mismatch');
            }
            steps.push({
                admitted: true,
                tradeDate: capture.session.tradeDate,
                baselineTradeDate: baseline.tradeDate,
                canonicalSymbol: symbol.canonicalSymbol,
                exchange: symbol.canonicalSymbol.endsWith('.TWO') ? 'OTC' : 'TSE',
                minuteKey: current.minuteKey,
                configRevision,
                threshold,
                currentCumulativeVolume: current.cumulativeVolume,
                previousCumulativeVolume: previous.cumulativeVolume,
                todayCompleteness: 'complete',
                baselineCompleteness: 'complete',
                calendarCurrent: true,
                sessionCurrent: true,
                generationCurrent: true,
                continuityComplete: true,
                unit: 'common_lot',
                sourceVersion: current.sourceVersion,
                observationMode: 'historical',
                revisionFirstComparable: index === 0,
                createdAt: current.receivedTime,
            });
        }
    }
    return steps;
}

function functionalReplayEvidence(capture, baseline, configRevision, threshold) {
    const input = {
        schemaVersion: 'intraday-monitor-functional-replay-input/1',
        evidenceClass: 'bounded_kbar_market_evidence',
        tradeDate: capture.session.tradeDate,
        baselineTradeDate: baseline.tradeDate,
        baselineProvenance: baseline.provenance,
        baselineReferenceHash: baseline.referenceHash,
        configRevision,
        threshold,
        steps: functionalReplaySteps(capture, baseline, configRevision, threshold),
    };
    const first = runReplay(input);
    const second = runReplay(input);
    const firstHash = functionalDigest(first);
    const secondHash = functionalDigest(second);
    return {
        replay: {
            executed: true,
            consistent: firstHash === secondHash,
            inputHash: functionalDigest(input),
            outputHash: firstHash,
            triggerCount: first.triggerCount,
            recomputedTriggerCount: second.triggerCount,
        },
        evaluations: first.evaluations,
    };
}

function createFunctionalPilotSession({
    plan,
    capture,
    assurance,
    baseline,
    gateEvidenceSha256,
    configRevision,
    threshold,
    calendarSourceVersion,
}) {
    const assuranceResult = validateIntradayMonitorPilotRuntimeAssurance(assurance);
    if (
        !completeCapture(capture, plan) ||
        !assuranceResult.ready ||
        assurance.tradeDate !== capture.session.tradeDate ||
        assurance.previousTradeDate !== baseline.tradeDate ||
        baseline.targetTradeDate !== capture.session.tradeDate ||
        assurance.chart.freshnessMs > plan.resourceBudgets.maxChartFreshnessMs
    ) {
        throw new TypeError('functional pilot capture or assurance is invalid');
    }
    const replayed = functionalReplayEvidence(
        capture,
        baseline,
        configRevision,
        threshold,
    );
    const recorder = createIntradayMonitorPilotShadowRecorder({
        plan,
        session: {
            tradeDate: capture.session.tradeDate,
            previousTradeDate: assurance.previousTradeDate,
            calendarSourceVersion,
            connectionGeneration: capture.session.connectionGeneration,
            startedAt: capture.session.startedAt,
            coverageStartMinute: '09:01',
        },
    });
    const sourceVersions = new Set(capture.session.symbols.flatMap((item) =>
        item.rows.map((row) => row.sourceVersion)));
    if (sourceVersions.size !== 1) {
        throw new TypeError('functional pilot source version is inconsistent');
    }
    recorder.recordSample({
        capturedAt: capture.session.endedAt,
        minuteKey: '13:30',
        configRevision,
        configured: plan.cohort.length,
        eligible: plan.cohort.length,
        active: plan.cohort.length,
        waiting: 0,
        unknown: finalUnknownCount(replayed.evaluations, plan.cohort),
        degraded: 0,
        gate0EvidenceCurrent: Boolean(gateEvidenceSha256),
        globalOwnershipComplete: null,
        confirmedPhysicalUsage: null,
        confirmedOtherPhysicalUsage: null,
        headroom: null,
        minuteEvidenceCount: plan.cohort.length * COMPLETE_MINUTES,
        completeMinuteEvidenceCount: plan.cohort.length * COMPLETE_MINUTES,
        triggerCount: replayed.replay.triggerCount,
        incompleteTriggerCount: 0,
        notificationDispatchCount: 0,
        duplicateNotificationCount: assurance.reconnect.duplicateNotificationCount,
        brokerWriteAttemptCount: capture.session.operations.brokerWriteAttemptCount,
        productionTransitionCount: capture.session.operations.productionTransitionCount,
        serviceLifecycleMutationCount:
            capture.session.operations.serviceLifecycleMutationCount,
        cpuBasisPoints: capture.rehearsal.resources.cpuBasisPoints,
        rssBytes: capture.rehearsal.resources.maxRssBytes,
        databaseBytes: capture.rehearsal.resources.evidenceDatabaseGrowthBytes,
        sseLatencyMs: capture.rehearsal.kbarLatencyMs.p95,
        chartFreshnessMs: assurance.chart.freshnessMs,
        connectionGeneration: capture.session.connectionGeneration,
        sourceVersion: [...sourceVersions][0],
    });
    return recorder.finish({
        endedAt: capture.session.endedAt,
        coverageEndMinute: '13:30',
        replay: replayed.replay,
        reconnect: {
            attempted: assurance.reconnect.attempted,
            recovered: assurance.reconnect.recovered,
            generationAdvanced: assurance.reconnect.generationAdvanced,
        },
        existingFeatures: assurance.existingFeatures,
    });
}

function runReplay(input) {
    const ledger = createIntradayRelativeVolumeTriggerLedger();
    const evaluations = input.steps.map((step) => {
        const result = ledger.evaluate(step);
        return {
            tradeDate: step.tradeDate,
            canonicalSymbol: step.canonicalSymbol,
            minuteKey: step.minuteKey,
            classification: result.classification,
            reason: result.reason,
            eventId: result.triggerEvent?.eventId ?? null,
            eventHash: result.triggerEvent?.eventHash ?? null,
            newlyCreated: result.newlyCreated,
            notificationEligible: result.notificationEligible,
        };
    });
    const events = ledger.getEvents();
    return { evaluations, events, triggerCount: events.length };
}

function replayEvidence(capture, baseline, configRevision, threshold) {
    const input = {
        schemaVersion: 'intraday-monitor-recorded-replay-input/1',
        evidenceClass: 'bounded_kbar_market_evidence',
        tradeDate: capture.session.tradeDate,
        baselineTradeDate: baseline?.session.tradeDate ?? null,
        configRevision,
        threshold,
        steps: replaySteps(capture, baseline, configRevision, threshold),
    };
    const first = runReplay(input);
    const second = runReplay(input);
    const firstHash = digest(first);
    const secondHash = digest(second);
    return {
        replay: {
            executed: true,
            consistent: firstHash === secondHash,
            inputHash: digest(input),
            outputHash: firstHash,
            triggerCount: first.triggerCount,
            recomputedTriggerCount: second.triggerCount,
        },
        evaluations: first.evaluations,
    };
}

function finalUnknownCount(evaluations, cohort) {
    if (evaluations.length === 0) return cohort.length;
    const latest = new Map();
    for (const item of evaluations) latest.set(item.canonicalSymbol, item);
    return cohort.filter((symbol) => latest.get(symbol)?.classification === 'unknown').length;
}

export function createIntradayMonitorPilotBundleFromCaptures({
    plan,
    captures,
    assurances,
    gateEvidenceSha256,
    configRevision,
    threshold,
    calendarSourceVersion,
    createdAt,
} = {}) {
    if (!validateIntradayMonitorPilotStagePlan(plan).valid ||
        !Array.isArray(captures) || captures.length < 1 || captures.length > 16 ||
        !Array.isArray(assurances) || assurances.length !== captures.length ||
        !HASH.test(gateEvidenceSha256 ?? '') ||
        !Number.isSafeInteger(configRevision) || configRevision < 0 ||
        !validThreshold(threshold) ||
        typeof calendarSourceVersion !== 'string' || !/^[A-Za-z0-9:._-]{1,128}$/.test(calendarSourceVersion) ||
        !Number.isFinite(Date.parse(createdAt ?? ''))) {
        throw new TypeError('pilot bundle build input is invalid');
    }
    const orderedCaptures = [...captures].sort((left, right) =>
        left?.session?.tradeDate?.localeCompare(right?.session?.tradeDate ?? '') ?? 0,
    );
    if (orderedCaptures.some((capture, index) =>
        !completeCapture(capture, plan) ||
        (index > 0 && capture.session.tradeDate <= orderedCaptures[index - 1].session.tradeDate))) {
        throw new TypeError('pilot full-session capture is invalid');
    }
    const assuranceByDate = new Map(assurances.map((value) => [value?.tradeDate, value]));
    const sessions = orderedCaptures.map((capture, index) => {
        const assurance = assuranceByDate.get(capture.session.tradeDate);
        const assuranceResult = validateIntradayMonitorPilotRuntimeAssurance(assurance);
        if (!assuranceResult.ready || assurance.previousTradeDate >= capture.session.tradeDate ||
            assurance.chart.freshnessMs > plan.resourceBudgets.maxChartFreshnessMs) {
            throw new TypeError('pilot runtime assurance is not ready');
        }
        const baseline = index === 0 ? null : orderedCaptures[index - 1];
        if (baseline && assurance.previousTradeDate !== baseline.session.tradeDate) {
            throw new TypeError('pilot previous trading day does not match captured baseline');
        }
        const replayed = replayEvidence(capture, baseline, configRevision, threshold);
        const recorder = createIntradayMonitorPilotShadowRecorder({
            plan,
            session: {
                tradeDate: capture.session.tradeDate,
                previousTradeDate: assurance.previousTradeDate,
                calendarSourceVersion,
                connectionGeneration: capture.session.connectionGeneration,
                startedAt: capture.session.startedAt,
                coverageStartMinute: '09:01',
            },
        });
        const sourceVersions = new Set(capture.session.symbols.flatMap((item) =>
            item.rows.map((row) => row.sourceVersion)));
        if (sourceVersions.size !== 1) throw new TypeError('pilot source version is inconsistent');
        recorder.recordSample({
            capturedAt: capture.session.endedAt,
            minuteKey: '13:30',
            configRevision,
            configured: plan.cohort.length,
            eligible: plan.cohort.length,
            active: plan.cohort.length,
            waiting: baseline ? 0 : plan.cohort.length,
            unknown: finalUnknownCount(replayed.evaluations, plan.cohort),
            degraded: 0,
            gate0EvidenceCurrent: Boolean(gateEvidenceSha256),
            globalOwnershipComplete: null,
            confirmedPhysicalUsage: null,
            confirmedOtherPhysicalUsage: null,
            headroom: null,
            minuteEvidenceCount: plan.cohort.length * COMPLETE_MINUTES,
            completeMinuteEvidenceCount: plan.cohort.length * COMPLETE_MINUTES,
            triggerCount: replayed.replay.triggerCount,
            incompleteTriggerCount: 0,
            notificationDispatchCount: 0,
            duplicateNotificationCount: assurance.reconnect.duplicateNotificationCount,
            brokerWriteAttemptCount: capture.session.operations.brokerWriteAttemptCount,
            productionTransitionCount: capture.session.operations.productionTransitionCount,
            serviceLifecycleMutationCount: capture.session.operations.serviceLifecycleMutationCount,
            cpuBasisPoints: capture.rehearsal.resources.cpuBasisPoints,
            rssBytes: capture.rehearsal.resources.maxRssBytes,
            databaseBytes: capture.rehearsal.resources.evidenceDatabaseGrowthBytes,
            sseLatencyMs: capture.rehearsal.kbarLatencyMs.p95,
            chartFreshnessMs: assurance.chart.freshnessMs,
            connectionGeneration: capture.session.connectionGeneration,
            sourceVersion: [...sourceVersions][0],
        });
        return recorder.finish({
            endedAt: capture.session.endedAt,
            coverageEndMinute: '13:30',
            replay: replayed.replay,
            reconnect: {
                attempted: assurance.reconnect.attempted,
                recovered: assurance.reconnect.recovered,
                generationAdvanced: assurance.reconnect.generationAdvanced,
            },
            existingFeatures: assurance.existingFeatures,
        });
    });
    return createIntradayMonitorPilotEvidenceBundle({ plan, sessions, createdAt });
}

function buildFunctionalAcceptanceSeed({
    plan,
    baselineCapture = null,
    historicalBaselineManifests = null,
    capture,
    assurance,
    gateEvidenceSha256,
    configRevision,
    threshold,
    calendarSourceVersion,
    createdAt,
} = {}) {
    if (
        !validateIntradayMonitorPilotStagePlan(plan).valid ||
        !HASH.test(gateEvidenceSha256 ?? '') ||
        !Number.isSafeInteger(configRevision) ||
        configRevision < 0 ||
        !validThreshold(threshold) ||
        typeof calendarSourceVersion !== 'string' ||
        !/^[A-Za-z0-9:._-]{1,128}$/.test(calendarSourceVersion) ||
        !Number.isFinite(Date.parse(createdAt ?? '')) ||
        (baselineCapture === null) === (historicalBaselineManifests === null)
    ) {
        throw new TypeError('functional acceptance bundle input is invalid');
    }
    const tradeDate = capture?.session?.tradeDate;
    if (!DATE.test(tradeDate ?? '')) {
        throw new TypeError('functional acceptance trade date is invalid');
    }
    const baseline = baselineCapture
        ? normalizedLiveBaseline(baselineCapture, plan, tradeDate)
        : normalizedHistoricalBaseline(
            historicalBaselineManifests,
            plan,
            tradeDate,
        );
    const session = createFunctionalPilotSession({
        plan,
        capture,
        assurance,
        baseline,
        gateEvidenceSha256,
        configRevision,
        threshold,
        calendarSourceVersion,
    });
    return {
        schemaVersion: INTRADAY_MONITOR_FUNCTIONAL_ACCEPTANCE_BUNDLE_SCHEMA,
        plan,
        baselineSource: baselineCapture
            ? { kind: 'live_capture', capture: baselineCapture, manifests: null }
            : {
                kind: 'historical_baseline_manifests',
                capture: null,
                manifests: historicalBaselineManifests,
            },
        baselineReference: {
            kind: baseline.kind,
            provenance: baseline.provenance,
            tradeDate: baseline.tradeDate,
            targetTradeDate: baseline.targetTradeDate,
            cohortHash: baseline.cohortHash,
            referenceHash: baseline.referenceHash,
            symbolCount: baseline.symbols.length,
        },
        capture,
        assurance,
        session,
        gateEvidenceSha256,
        configRevision,
        threshold,
        calendarSourceVersion,
        createdAt,
        stabilityFollowUpRequired: false,
        notificationDispatchAuthority: false,
        providerRequestAuthority: false,
        subscriptionTransportAuthority: false,
        serviceLifecycleAuthority: false,
        brokerWriteAuthority: false,
    };
}

export function createIntradayMonitorFunctionalAcceptanceBundle(input = {}) {
    const seed = buildFunctionalAcceptanceSeed(input);
    return Object.freeze({ ...seed, bundleHash: functionalDigest(seed) });
}

export function validateIntradayMonitorFunctionalAcceptanceBundle(value) {
    if (
        !value ||
        typeof value !== 'object' ||
        value.schemaVersion !== INTRADAY_MONITOR_FUNCTIONAL_ACCEPTANCE_BUNDLE_SCHEMA ||
        !HASH.test(value.bundleHash ?? '')
    ) {
        return Object.freeze({
            valid: false,
            readyForHumanReview: false,
            reasons: Object.freeze(['invalid_functional_bundle']),
            metrics: null,
        });
    }
    try {
        const rebuilt = buildFunctionalAcceptanceSeed({
            plan: value.plan,
            baselineCapture:
                value.baselineSource?.kind === 'live_capture'
                    ? value.baselineSource.capture
                    : null,
            historicalBaselineManifests:
                value.baselineSource?.kind === 'historical_baseline_manifests'
                    ? value.baselineSource.manifests
                    : null,
            capture: value.capture,
            assurance: value.assurance,
            gateEvidenceSha256: value.gateEvidenceSha256,
            configRevision: value.configRevision,
            threshold: value.threshold,
            calendarSourceVersion: value.calendarSourceVersion,
            createdAt: value.createdAt,
        });
        const { bundleHash, ...actualSeed } = value;
        if (
            bundleHash !== functionalDigest(actualSeed) ||
            canonicalJson(rebuilt, {
                maximumBytes: INTRADAY_MONITOR_FUNCTIONAL_ACCEPTANCE_BUNDLE_MAXIMUM_BYTES,
            }) !== canonicalJson(actualSeed, {
                maximumBytes: INTRADAY_MONITOR_FUNCTIONAL_ACCEPTANCE_BUNDLE_MAXIMUM_BYTES,
            })
        ) {
            throw new TypeError('functional bundle content mismatch');
        }
        const finalSample = rebuilt.session.samples.at(-1);
        const reasons = [];
        if (!rebuilt.session.replay.executed || !rebuilt.session.replay.consistent) {
            reasons.push('replay_not_reproducible');
        }
        if (
            rebuilt.session.replay.triggerCount !==
            rebuilt.session.replay.recomputedTriggerCount
        ) {
            reasons.push('replay_trigger_count_mismatch');
        }
        if (finalSample.unknown > 0) reasons.push('functional_comparison_unknown');
        if (!Object.values(rebuilt.session.existingFeatures).every(Boolean)) {
            reasons.push('existing_feature_regression');
        }
        return Object.freeze({
            valid: true,
            readyForHumanReview: reasons.length === 0,
            reasons: Object.freeze(reasons),
            metrics: Object.freeze({
                stage: rebuilt.plan.stage,
                configuredMonitorCount: rebuilt.plan.cohort.length,
                baselineProvenance: rebuilt.baselineReference.provenance,
                baselineTradeDate: rebuilt.baselineReference.tradeDate,
                liveTradeDate: rebuilt.session.tradeDate,
                completeTradingDays: 1,
                stabilityFollowUpRequired: false,
                triggerCount: rebuilt.session.replay.triggerCount,
                providerPhysicalUsage: null,
                providerHeadroom: null,
            }),
        });
    } catch {
        return Object.freeze({
            valid: false,
            readyForHumanReview: false,
            reasons: Object.freeze(['invalid_functional_bundle']),
            metrics: null,
        });
    }
}
