import { createHash } from 'node:crypto';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';
import { createBoundedKbarTransport } from './bounded-kbar-transport.mjs';
import { validateDirect160BaselineSet } from './direct-160-baseline.mjs';
import { DIRECT_160_STORAGE } from './direct-160-storage.mjs';
import { createIntradayMonitorKbarShadowSession } from './kbar-shadow-session-recorder.mjs';
import { createIntradayRelativeVolumeTriggerLedger } from './relative-volume-evaluator.mjs';
import {
    createTieredStageSessionEvidence,
    validateTieredCohortManifest,
    validateTieredStagePlan,
} from './tiered-capacity-stage-artifacts.mjs';

export const DIRECT_160_REPLAY_SCHEMA = 'intraday-monitor-direct-160-replay/1';

function hash(value, maximumBytes = DIRECT_160_STORAGE.bundleCanonicalBytes) {
    return createHash('sha256').update(canonicalJson(value, { maximumBytes })).digest('hex');
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

function contract(entry) {
    const value = entry.contractIdentity;
    return Object.freeze({
        securityType: value.security_type,
        region: value.region,
        exchange: value.exchange,
        code: value.code,
        targetCode: value.target_code,
        canonicalSymbol: entry.canonicalSymbol,
    });
}

export function validateDirect160LiveInputs({ manifest, plan, baseline, tradeDate } = {}) {
    const reasons = new Set();
    if (!validateTieredCohortManifest(manifest).valid || manifest?.stage !== 160 ||
        manifest?.cohort?.length !== DIRECT_160_STORAGE.targetCount) reasons.add('invalid_exact_160_manifest');
    if (!validateTieredStagePlan(plan, manifest).valid || plan?.stage !== 160 ||
        plan?.storageProfile?.schemaVersion !== DIRECT_160_STORAGE.schemaVersion) reasons.add('invalid_direct_160_plan');
    if (!validateDirect160BaselineSet(baseline, manifest, tradeDate)) reasons.add('invalid_previous_session_baseline');
    return deepFreeze({ valid: reasons.size === 0, reasons: [...reasons].sort() });
}

export function createDirect160GenerationGuard() {
    let claimed = null;
    let released = false;
    return Object.freeze({
        claim({ connectionGeneration, manifestHash } = {}) {
            if (claimed || typeof connectionGeneration !== 'string' || connectionGeneration.length < 16 ||
                connectionGeneration.length > 128 || connectionGeneration === manifestHash ||
                !/^[a-f0-9]{64}$/.test(manifestHash ?? '')) throw new Error('direct_160_generation_not_fresh');
            claimed = Object.freeze({ connectionGeneration, manifestHash });
            return Object.freeze({ accepted: true, ...claimed });
        },
        release({ connectionGeneration, manifestHash } = {}) {
            if (!claimed || released || connectionGeneration !== claimed.connectionGeneration ||
                manifestHash !== claimed.manifestHash) throw new Error('direct_160_generation_release_mismatch');
            released = true;
            return Object.freeze({ accepted: true, reusable: false, providerReleaseProven: false });
        },
        status() {
            return Object.freeze({ claimed: Boolean(claimed), released, reusable: false,
                connectionGeneration: claimed?.connectionGeneration ?? null,
                manifestHash: claimed?.manifestHash ?? null });
        },
    });
}

export function createDirect160StageComponents({ manifest, plan, baseline, tradeDate,
    connectionGeneration, fetchImpl = fetch, now = () => new Date().toISOString(),
    nowEpochMs = () => Date.now(), onDisconnect = null, onKbarResult = null,
    onObservation = null } = {}) {
    const validation = validateDirect160LiveInputs({ manifest, plan, baseline, tradeDate });
    if (!validation.valid) throw new TypeError(validation.reasons.join(','));
    const contracts = manifest.cohort.map(contract);
    const session = createIntradayMonitorKbarShadowSession({
        cohort: contracts,
        tradeDate,
        connectionGeneration,
        startedAt: now(),
        nowEpochMs,
        storageProfile: DIRECT_160_STORAGE,
        onObservation,
    });
    const transport = createBoundedKbarTransport({
        fetchImpl,
        storageProfile: DIRECT_160_STORAGE,
        now,
        onEvent: (event) => {
            const startedAtEpochMs = Date.now();
            const result = session.recordKbar(event);
            if (typeof onKbarResult === 'function') onKbarResult({
                event,
                result,
                processingLatencyMs: Math.max(0, Date.now() - startedAtEpochMs),
            });
            return result;
        },
        onDisconnect: (value) => {
            session.markDisconnected(value);
            if (typeof onDisconnect === 'function') onDisconnect(value);
        },
    });
    return Object.freeze({ contracts, session, transport });
}

function replayOnce({ session, baseline, manifest, threshold, configRevision }) {
    const baselineBySymbol = new Map(baseline.manifests.map((item) => [item.symbol,
        new Map(item.cumulativeSeries.map((row) => [row.minuteKey, row]))]));
    const ledger = createIntradayRelativeVolumeTriggerLedger();
    const counts = { matched: 0, notMatched: 0, unknown: 0 };
    const unknownReasons = new Map();
    const samples = [];
    let notificationEligibleCount = 0;
    let stepCount = 0;
    for (let minuteIndex = 0; minuteIndex < 270; minuteIndex += 1) {
        for (let symbolIndex = 0; symbolIndex < session.symbols.length; symbolIndex += 1) {
            const symbol = session.symbols[symbolIndex];
            const row = symbol.rows[minuteIndex];
            const prior = baselineBySymbol.get(symbol.canonicalSymbol)?.get(row?.minuteKey);
            const entry = manifest.cohort[symbolIndex];
            const result = ledger.evaluate({
                admitted: true,
                tradeDate: session.tradeDate,
                baselineTradeDate: baseline.calendar.previousTradeDate,
                canonicalSymbol: symbol.canonicalSymbol,
                exchange: entry.contractIdentity.exchange,
                minuteKey: row?.minuteKey ?? `${String(9 + Math.floor((minuteIndex + 1) / 60)).padStart(2, '0')}:${String((minuteIndex + 1) % 60).padStart(2, '0')}`,
                configRevision,
                threshold,
                currentCumulativeVolume: row?.cumulativeVolume ?? 0,
                previousCumulativeVolume: prior?.cumulativeVolume ?? 0,
                todayCompleteness: row?.completeness === 'complete' ? 'complete' : 'missing',
                baselineCompleteness: prior ? 'complete' : 'missing',
                calendarCurrent: true,
                sessionCurrent: true,
                generationCurrent: true,
                continuityComplete: row?.completeness === 'complete',
                unit: 'common_lot',
                sourceVersion: row?.sourceVersion ?? 'missing',
                observationMode: row?.liveDelivered === false ? 'historical' : 'live',
                revisionFirstComparable: minuteIndex === 0,
                createdAt: row?.receivedTime ?? session.endedAt,
            });
            stepCount += 1;
            if (result.classification === 'matched') counts.matched += 1;
            else if (result.classification === 'not_matched') counts.notMatched += 1;
            else {
                counts.unknown += 1;
                unknownReasons.set(result.reason, (unknownReasons.get(result.reason) ?? 0) + 1);
            }
            if (result.notificationEligible) notificationEligibleCount += 1;
            if (samples.length < 32 && (stepCount === 1 || stepCount % 1379 === 0 || stepCount === 43_200)) {
                samples.push({ step: stepCount, canonicalSymbol: symbol.canonicalSymbol,
                    minuteKey: row?.minuteKey ?? null, classification: result.classification,
                    reason: result.reason, eventId: result.triggerEvent?.eventId ?? null,
                    eventHash: result.triggerEvent?.eventHash ?? null });
            }
        }
    }
    const events = ledger.getEvents();
    const seed = { stepCount, ...counts, unknownReasons: Object.fromEntries([...unknownReasons].sort()),
        notificationEligibleCount, triggerCount: events.length,
        triggerIds: events.map((event) => event.eventId), triggerHashes: events.map((event) => event.eventHash), samples };
    return deepFreeze({ ...seed, outputHash: hash(seed) });
}

export function runDirect160DeterministicReplay({ session, baseline, manifest,
    threshold = '1', configRevision = manifest?.configRevision } = {}) {
    if (session?.assessment?.fullSession !== true || session?.cohort?.length !== 160 ||
        session?.symbols?.length !== 160 || session.symbols.some((item) => !item.complete || item.rows?.length !== 270) ||
        !validateDirect160BaselineSet(baseline, manifest, session.tradeDate) ||
        typeof threshold !== 'string' || !Number.isSafeInteger(configRevision) || configRevision < 1) {
        throw new TypeError('direct 160 replay input is invalid');
    }
    const inputHash = hash({ sessionHash: session.evidenceHash, baselineHash: baseline.baselineHash,
        manifestHash: manifest.manifestHash, threshold, configRevision });
    const first = replayOnce({ session, baseline, manifest, threshold, configRevision });
    const second = replayOnce({ session, baseline, manifest, threshold, configRevision });
    const consistent = first.outputHash === second.outputHash;
    return deepFreeze({
        schemaVersion: DIRECT_160_REPLAY_SCHEMA,
        runCount: 2,
        consistent,
        inputHash,
        outputHash: first.outputHash,
        stepCount: first.stepCount,
        matched: first.matched,
        notMatched: first.notMatched,
        unknown: first.unknown,
        unknownReasons: first.unknownReasons,
        triggerCount: first.triggerCount,
        triggerIds: first.triggerIds,
        triggerHashes: first.triggerHashes,
        notificationEligibleCount: first.notificationEligibleCount,
        notificationDispatchCount: 0,
        samples: first.samples,
    });
}

export function buildDirect160TieredSessionEvidence({ plan, manifest, baseline, session,
    replay, transport, resources, assurances } = {}) {
    const unknownReasons = replay?.unknownReasons ?? {};
    const acceptableUnknown = replay?.unknown === 0 ||
        (Number.isSafeInteger(replay?.unknown) && replay.unknown > 0 &&
            Object.keys(unknownReasons).length === 1 &&
            unknownReasons.zero_denominator === replay.unknown);
    const incomplete = [
        [replay?.schemaVersion === DIRECT_160_REPLAY_SCHEMA, 'replay_schema'],
        [replay?.runCount === 2, 'replay_count'],
        [replay?.consistent === true, 'replay_consistency'],
        [replay?.stepCount === 43_200, 'replay_steps'],
        [acceptableUnknown, 'replay_unknown'],
        [replay?.notificationDispatchCount === 0, 'notification_dispatch'],
        [session?.assessment?.fullSession === true, 'full_session'],
        [transport?.startReceipt?.subscribeAccepted === true, 'subscribe'],
        [transport?.stopReceipt?.unsubscribeAccepted === true, 'unsubscribe'],
        [assurances?.reconnectVerified === true, 'reconnect'],
        [assurances?.existingFeaturesHealthy === true, 'existing_features'],
    ].filter(([valid]) => !valid).map(([, reason]) => reason);
    if (incomplete.length) {
        const unknown = incomplete.includes('replay_unknown')
            ? `:${JSON.stringify(replay?.unknownReasons ?? {})}` : '';
        throw new TypeError(`direct 160 session evidence is incomplete: ${incomplete.join(',')}${unknown}`);
    }
    return createTieredStageSessionEvidence({ plan, manifest, evidence: {
        tradeDate: session.tradeDate,
        baselineHash: baseline.baselineHash,
        connectionGeneration: session.connectionGeneration,
        exactCohortCount: 160,
        minuteSlotCount: 43_200,
        coverageStartMinute: '09:01',
        coverageEndMinute: '13:30',
        complete: true,
        zeroVolumeProvenancePreserved: true,
        unknownNotCoerced: true,
        reconnectVerified: true,
        existingFeaturesHealthy: true,
        transport: { subscribeAccepted: true, unsubscribeAccepted: true, providerReleaseProven: false },
        replay: { runCount: 2, consistent: true, inputHash: replay.inputHash,
            outputHash: replay.outputHash, triggerCount: replay.triggerCount },
        resources,
        provider: { physicalUsage: null, globalOwnershipComplete: null, releaseProven: null, headroom: null },
        operations: { networkWrites: 0, subscriptionMutations: 0, notificationDispatches: 0,
            brokerWrites: 0, productionTransitions: 0, serviceLifecycleMutations: 0,
            activeLimitMutations: 0 },
    } });
}
