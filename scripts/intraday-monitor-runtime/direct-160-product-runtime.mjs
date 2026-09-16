import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync,
    unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { INTRADAY_MONITOR_BASELINE_SCHEMA } from '../../src/lib/intraday-relative-volume-monitor-domain.ts';
import { IntradayMonitorEvidenceRepository } from './evidence-repository.mjs';
import { createIntradayRelativeVolumeTriggerLedger } from './relative-volume-evaluator.mjs';
import { decideTieredRollback, validateTieredStageEvidenceBundle } from './tiered-capacity-stage-artifacts.mjs';
import { evaluateFirstMinuteCanary } from './first-minute-canary.mjs';

export const DIRECT_160_PRODUCT_RUNTIME_SCHEMA = 'intraday-monitor-direct-160-product-runtime/1';
export const DIRECT_160_PRODUCT_RUNTIME_FILE = 'direct-160-product-runtime.json';
const HASH = /^[a-f0-9]{64}$/;
const PHASES = new Set(['running_evaluation', 'running_approved', 'pending_review',
    'complete_go', 'complete_no_go', 'failed']);

export function resolveDirect160ProductRuntimePath(appSupportRoot) {
    if (typeof appSupportRoot !== 'string' || !path.isAbsolute(appSupportRoot)) {
        throw new TypeError('application support root is invalid');
    }
    return path.join(appSupportRoot, 'IntradayMonitor', DIRECT_160_PRODUCT_RUNTIME_FILE);
}

function canonicalSymbol(item) {
    return `${item.contract.code}.${item.contract.exchange === 'TSE' ? 'TW' : 'TWO'}`;
}

function validState(value) {
    return Boolean(value?.schemaVersion === DIRECT_160_PRODUCT_RUNTIME_SCHEMA &&
        PHASES.has(value.phase) && /^\d{4}-\d{2}-\d{2}$/.test(value.tradeDate ?? '') &&
        /^\d{4}-\d{2}-\d{2}$/.test(value.baselineTradeDate ?? '') && value.baselineTradeDate < value.tradeDate &&
        HASH.test(value.manifestHash ?? '') && HASH.test(value.baselineHash ?? '') &&
        typeof value.connectionGeneration === 'string' && value.connectionGeneration.length >= 16 &&
        Number.isSafeInteger(value.configRevision) && value.configRevision >= 0 &&
        [20, 160].includes(value.approvedActiveLimit) && value.evaluationStageTarget === 160 &&
        ['running', 'ready_for_review', 'go', 'no_go'].includes(value.evaluationState) &&
        Array.isArray(value.items) && value.items.length === 160 &&
        value.items.every((item) => /^\d{4,6}[A-Z]?\.(?:TW|TWO)$/.test(item?.canonicalSymbol ?? '') &&
            ['awaiting_first_kbar', 'waiting_continuity', 'active', 'degraded'].includes(item.state) &&
            ['complete', 'unknown'].includes(item.baselineState) &&
            ['requested', 'confirmed', 'unknown'].includes(item.subscriptionState) &&
            ['awaiting_first_kbar', 'active'].includes(item.dataPlaneState) &&
            (item.firstEventAt === null || (typeof item.firstEventAt === 'string' &&
                Number.isFinite(Date.parse(item.firstEventAt)))) &&
            (item.firstEventMinute === null || /^\d{2}:\d{2}$/.test(item.firstEventMinute)) &&
            ['none', 'complete', 'conflict'].includes(item.bootstrapState) &&
            (item.bootstrapEndMinute === null || /^\d{2}:\d{2}$/.test(item.bootstrapEndMinute)) &&
            (item.bootstrapCumulativeVolume === null || Number.isSafeInteger(item.bootstrapCumulativeVolume)) &&
            (item.completedMinute === null || /^\d{2}:\d{2}$/.test(item.completedMinute)) &&
            (item.currentCumulativeVolume === null || Number.isSafeInteger(item.currentCumulativeVolume)) &&
            (item.previousCumulativeVolume === null || Number.isSafeInteger(item.previousCumulativeVolume))) &&
        new Set(value.items.map((item) => item.canonicalSymbol)).size === 160 &&
        Number.isSafeInteger(value.persistedObservationCount) && value.persistedObservationCount >= 0 &&
        Number.isSafeInteger(value.persistedTriggerCount) && value.persistedTriggerCount >= 0 &&
        typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)) &&
        value.provider?.physicalUsage === null && value.provider?.globalOwnershipComplete === null &&
        value.provider?.releaseProven === null && value.provider?.headroom === null &&
        typeof value.boundedTransportReady === 'boolean' &&
        (value.liveAvailabilityComplete === null || typeof value.liveAvailabilityComplete === 'boolean') &&
        (value.firstMinuteCanary === null || value.firstMinuteCanary?.tradeDate === value.tradeDate) &&
        typeof value.notificationAuthority === 'boolean' &&
        Number.isSafeInteger(value.operations?.notificationDispatches) &&
        value.operations.notificationDispatches >= 0 &&
        value.operations?.brokerWrites === 0 && value.operations?.productionTransitions === 0 &&
        Number.isSafeInteger(value.operations?.serviceLifecycleMutations) &&
        value.operations.serviceLifecycleMutations >= 0 &&
        Number.isSafeInteger(value.operations?.activeLimitMutations) &&
        value.operations.activeLimitMutations >= 0);
}

export function readDirect160ProductRuntimeState(statePath) {
    if (typeof statePath !== 'string' || !path.isAbsolute(statePath)) return null;
    try {
        const value = JSON.parse(readFileSync(statePath, 'utf8'));
        return validState(value) ? value : null;
    } catch { return null; }
}

function writeState(statePath, value) {
    if (!validState(value)) throw new TypeError('direct 160 product runtime state is invalid');
    const directory = path.dirname(statePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
    let descriptor = null;
    try {
        descriptor = openSync(temporaryPath, 'wx', 0o600);
        writeFileSync(descriptor, `${JSON.stringify(value)}\n`);
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = null;
        renameSync(temporaryPath, statePath);
        let directoryDescriptor = null;
        try {
            directoryDescriptor = openSync(directory, 'r');
            fsyncSync(directoryDescriptor);
        } finally {
            if (directoryDescriptor !== null) closeSync(directoryDescriptor);
        }
    } catch (error) {
        if (descriptor !== null) closeSync(descriptor);
        try { unlinkSync(temporaryPath); } catch {}
        throw error;
    }
}

function productBaseline(item) {
    const provenance = (value) => {
        if (value === 'historical_known_zero') return 'known_zero';
        if (value === 'historical_carry_forward') return 'carry_forward';
        if (value === 'historical_observed') return 'observed';
        throw new TypeError('direct 160 baseline provenance is invalid');
    };
    return {
        schemaVersion: INTRADAY_MONITOR_BASELINE_SCHEMA,
        canonicalSymbol: item.symbol,
        tradeDate: item.tradeDate,
        timeZone: 'Asia/Taipei',
        source: item.source,
        sourceVersion: item.sourceVersion,
        sourceUnit: 'common_lot',
        canonicalUnit: 'common_lot',
        expectedMinuteCount: 270,
        completeness: 'complete',
        rows: item.cumulativeSeries.map((row) => ({ minuteKey: row.minuteKey,
            cumulativeVolume: row.cumulativeVolume, provenance: provenance(row.provenance) })),
        payloadHash: String(item.payloadHash).replace(/^sha256:/, ''),
        fetchedAt: item.fetchTime,
    };
}

export function createDirect160ProductSink({ manifest, baseline, config, tradeDate,
    connectionGeneration, evidenceDatabasePath, statePath, approvedActiveLimit = 20,
    now = () => new Date().toISOString() } = {}) {
    const enabled = config?.items?.filter((item) => item.enabled).slice(0, 160) ?? [];
    const manifestSymbols = manifest?.cohort?.map((item) => item.canonicalSymbol) ?? [];
    const priorState = approvedActiveLimit === 160 ? readDirect160ProductRuntimeState(statePath) : null;
    if (manifestSymbols.length !== 160 || enabled.length !== 160 ||
        enabled.some((item, index) => canonicalSymbol(item) !== manifestSymbols[index]) ||
        baseline?.calendar?.targetTradeDate !== tradeDate || baseline?.manifests?.length !== 160 ||
        baseline.manifests.some((item, index) => item.symbol !== manifestSymbols[index] ||
            item.tradeDate !== baseline.calendar.previousTradeDate || item.cumulativeSeries?.length !== 270) ||
        ![20, 160].includes(approvedActiveLimit) || typeof now !== 'function' ||
        (approvedActiveLimit === 160 && (priorState?.phase !== 'complete_go' ||
            priorState.evaluationState !== 'go' || priorState.approvedActiveLimit !== 160 ||
            priorState.manifestHash !== manifest?.manifestHash))) {
        throw new TypeError('direct 160 product sink inputs are invalid');
    }
    const repository = new IntradayMonitorEvidenceRepository(evidenceDatabasePath);
    const ledger = createIntradayRelativeVolumeTriggerLedger();
    const baselineBySymbol = new Map(baseline.manifests.map((item) => [item.symbol,
        new Map(item.cumulativeSeries.map((row) => [row.minuteKey, row.cumulativeVolume]))]));
    const configBySymbol = new Map(enabled.map((item) => [canonicalSymbol(item), item]));
    const items = manifestSymbols.map((symbol) => ({ canonicalSymbol: symbol, state: 'awaiting_first_kbar',
        reason: 'awaiting_first_kbar', baselineState: 'complete', baselineTradeDate: baseline.calendar.previousTradeDate,
        baselineSourceVersion: baseline.manifests.find((item) => item.symbol === symbol)?.sourceVersion ?? null,
        subscriptionState: 'requested', dataPlaneState: 'awaiting_first_kbar',
        firstEventAt: null, firstEventMinute: null, physicalKey: `bounded-kbar:${symbol}`,
        bootstrapState: 'none', bootstrapEndMinute: null, bootstrapCumulativeVolume: null,
        bootstrapRangeHash: null, liveAccumulatorMode: null,
        completedMinute: null, currentCumulativeVolume: null, previousCumulativeVolume: null,
        updatedAt: now() }));
    const itemBySymbol = new Map(items.map((item) => [item.canonicalSymbol, item]));
    const completedByMinute = new Map();
    const bootstrapBySymbol = new Map();
    const requiredBootstrapEndBySymbol = new Map();
    const deferredLiveBySymbol = new Map();
    let persistedObservationCount = 0;
    let persistedTriggerCount = 0;
    let closed = false;
    let phase = approvedActiveLimit === 160 ? 'running_approved' : 'running_evaluation';
    let evaluationState = approvedActiveLimit === 160 ? 'go' : 'running';
    let firstMinuteCanary = null;
    let liveAvailabilityComplete = null;
    const priorActiveLimitMutations = priorState?.operations?.activeLimitMutations ?? 0;

    function snapshot() {
        return {
            schemaVersion: DIRECT_160_PRODUCT_RUNTIME_SCHEMA, phase, tradeDate,
            baselineTradeDate: baseline.calendar.previousTradeDate,
            manifestHash: manifest.manifestHash, baselineHash: baseline.baselineHash,
            connectionGeneration, configRevision: config.revision, approvedActiveLimit,
            evaluationStageTarget: 160, evaluationState,
            controlPlaneSubscriptionRequested: true,
            dataActive: items.filter((item) => item.dataPlaneState === 'active').length,
            awaitingFirstKbar: items.filter((item) => item.dataPlaneState === 'awaiting_first_kbar').length,
            boundedTransportReady: (phase === 'running_evaluation' || phase === 'running_approved') &&
                items.every((item) => item.state === 'active' && item.dataPlaneState === 'active'),
            firstMinuteCanary, liveAvailabilityComplete,
            notificationAuthority: phase === 'running_approved', items,
            persistedObservationCount, persistedTriggerCount, updatedAt: now(),
            provider: { physicalUsage: null, globalOwnershipComplete: null, releaseProven: null, headroom: null },
            operations: { notificationDispatches: 0, brokerWrites: 0, productionTransitions: 0,
                serviceLifecycleMutations: 0, activeLimitMutations: priorActiveLimitMutations },
        };
    }

    function save() { writeState(statePath, snapshot()); }

    function installBaselines() {
        for (const item of baseline.manifests) {
            repository.putBaseline(productBaseline(item), repository.currentRevision());
        }
        save();
        return { installed: 160, accepted: true };
    }

    function installBootstrapGaps(receipts) {
        if (closed || !Array.isArray(receipts)) throw new TypeError('bootstrap gap receipts are invalid');
        let installed = 0;
        for (const receipt of receipts) {
            const item = itemBySymbol.get(receipt?.canonicalSymbol);
            const valid = Boolean(item && receipt?.schemaVersion ===
                'intraday-monitor-direct-160-gap-bootstrap/1' && receipt.tradeDate === tradeDate &&
                receipt.liveGeneration === connectionGeneration && receipt.source === 'shioaji-kbars-bootstrap' &&
                receipt.sourceUnit === 'common_lot' && receipt.canonicalUnit === 'common_lot' &&
                receipt.liveDelivered === false && receipt.stableRefetch === true &&
                receipt.rangeHash === receipt.refetchRangeHash && /^sha256:[a-f0-9]{64}$/.test(receipt.rangeHash ?? '') &&
                Array.isArray(receipt.rows) && receipt.rows.length === receipt.expectedMinuteCount &&
                receipt.rows[0]?.minuteKey === '09:01' &&
                receipt.rows.at(-1)?.minuteKey === receipt.requestedMinuteEnd);
            if (!valid) {
                if (item) Object.assign(item, { state: 'degraded', reason: 'bootstrap_receipt_invalid',
                    bootstrapState: 'conflict', updatedAt: now() });
                requiredBootstrapEndBySymbol.delete(receipt?.canonicalSymbol);
                deferredLiveBySymbol.delete(receipt?.canonicalSymbol);
                continue;
            }
            const contract = configBySymbol.get(receipt.canonicalSymbol).contract;
            const observations = receipt.rows.map((row, index) => ({
                schemaVersion: 'intraday-monitor-observation/1', contract,
                tradeDate, minuteKey: row.minuteKey, exchangeTime: `${row.minuteKey}:59`,
                receivedTime: receipt.refetchedAt,
                connectionGeneration: `bootstrap_${receipt.rangeHash.slice(7, 55)}`,
                sequence: index + 1, cumulativeVolume: row.cumulativeVolume,
                unit: 'common_lot', source: 'shioaji-kbars-bootstrap',
                sourceVersion: receipt.sourceVersion, simtrade: false, intradayOdd: false,
                continuity: 'complete',
            }));
            try {
                const saved = repository.appendBootstrappedObservations(observations,
                    repository.currentRevision());
                persistedObservationCount += saved.inserted;
                const rows = new Map(receipt.rows.map((row) => [row.minuteKey, row]));
                bootstrapBySymbol.set(receipt.canonicalSymbol, { receipt, rows,
                    endNumber: receipt.requestedMinuteEnd.split(':').map(Number)
                        .reduce((total, value, index) => index === 0 ? value * 60 : total + value, 0),
                    finalCumulativeVolume: receipt.rows.at(-1).cumulativeVolume });
                requiredBootstrapEndBySymbol.delete(receipt.canonicalSymbol);
                const deferred = deferredLiveBySymbol.get(receipt.canonicalSymbol) ?? [];
                deferredLiveBySymbol.delete(receipt.canonicalSymbol);
                Object.assign(item, { bootstrapState: 'complete',
                    bootstrapEndMinute: receipt.requestedMinuteEnd,
                    bootstrapCumulativeVolume: receipt.rows.at(-1).cumulativeVolume,
                    bootstrapRangeHash: receipt.rangeHash,
                    completedMinute: receipt.requestedMinuteEnd,
                    currentCumulativeVolume: receipt.rows.at(-1).cumulativeVolume,
                    liveAccumulatorMode: deferred.length > 0 ? 'bootstrap_prefix' : item.liveAccumulatorMode,
                    reason: 'bootstrap_prefix_ready', updatedAt: receipt.refetchedAt });
                for (const observation of deferred) persistObservation(observation);
                installed += 1;
            } catch {
                Object.assign(item, { state: 'degraded', reason: 'bootstrap_evidence_conflict',
                    bootstrapState: 'conflict', updatedAt: now() });
            }
        }
        save();
        return { requested: receipts.length, installed, degraded: receipts.length - installed,
            notificationAuthority: false };
    }

    function requireBootstrapPrefixes(requests) {
        if (closed || !Array.isArray(requests)) throw new TypeError('bootstrap prefix requests are invalid');
        let accepted = 0;
        for (const request of requests) {
            const item = itemBySymbol.get(request?.canonicalSymbol);
            if (!item || !/^\d{2}:\d{2}$/.test(request?.endMinute ?? '') ||
                request.endMinute < '09:01' || request.endMinute > '13:29' ||
                bootstrapBySymbol.has(request.canonicalSymbol) ||
                requiredBootstrapEndBySymbol.has(request.canonicalSymbol)) continue;
            requiredBootstrapEndBySymbol.set(request.canonicalSymbol, request.endMinute);
            Object.assign(item, { state: 'waiting_continuity', reason: 'bootstrap_prefix_pending',
                updatedAt: now() });
            accepted += 1;
        }
        if (accepted > 0) save();
        return { requested: requests.length, accepted, notificationAuthority: false };
    }

    function failBootstrapPrefixes(symbols, reason = 'bootstrap_prefix_failed') {
        if (closed || !Array.isArray(symbols)) throw new TypeError('bootstrap failure symbols are invalid');
        let degraded = 0;
        for (const symbol of symbols) {
            const item = itemBySymbol.get(symbol);
            if (!item) continue;
            requiredBootstrapEndBySymbol.delete(symbol);
            deferredLiveBySymbol.delete(symbol);
            Object.assign(item, { state: 'degraded', reason, bootstrapState: 'conflict', updatedAt: now() });
            degraded += 1;
        }
        if (degraded > 0) save();
        return { degraded, notificationAuthority: false };
    }

    function recordFirstKbarEvidence({ canonicalSymbol, minuteKey, receivedAt } = {}) {
        if (closed || !/^\d{2}:\d{2}$/.test(minuteKey ?? '') ||
            !Number.isFinite(Date.parse(receivedAt ?? ''))) {
            return { accepted: false, reason: 'first_kbar_evidence_invalid' };
        }
        const item = itemBySymbol.get(canonicalSymbol);
        if (!item) return { accepted: false, reason: 'first_kbar_symbol_unknown' };
        if (item.dataPlaneState === 'active') return { accepted: true, duplicate: true };
        const prefixPending = requiredBootstrapEndBySymbol.has(canonicalSymbol);
        Object.assign(item, {
            dataPlaneState: 'active', firstEventAt: receivedAt, firstEventMinute: minuteKey,
            subscriptionState: 'confirmed',
            state: prefixPending ? 'waiting_continuity' : 'active',
            reason: prefixPending ? 'bootstrap_prefix_pending' : 'none',
            updatedAt: receivedAt,
        });
        save();
        return { accepted: true, duplicate: false };
    }

    function persistObservation(observation) {
        const expectedItem = configBySymbol.get(observation?.contract?.canonicalSymbol);
        const expectedContract = expectedItem?.contract;
        const validIdentity = Boolean(expectedContract && observation?.contract?.securityType === 'STK' &&
            observation.contract.region === 'TW' && observation.contract.exchange === expectedContract.exchange &&
            observation.contract.code === expectedContract.code && observation.contract.targetCode === null);
        const validEnvelope = Boolean(observation?.schemaVersion === 'intraday-monitor-observation/1' &&
            observation.tradeDate === tradeDate && observation.connectionGeneration === connectionGeneration &&
            /^\d{2}:\d{2}$/.test(observation.minuteKey ?? '') &&
            observation.source === 'shioaji-kbar-stream' && typeof observation.sourceVersion === 'string' &&
            observation.sourceVersion.length > 0 && observation.unit === 'common_lot' && validIdentity);
        if (closed || !validEnvelope) {
            return { accepted: false, reason: 'observation_envelope_invalid' };
        }
        try {
            const symbol = observation.contract.canonicalSymbol;
            const runtimeItem = itemBySymbol.get(symbol);
            const firstEvent = runtimeItem.dataPlaneState === 'awaiting_first_kbar';
            if (firstEvent) {
                Object.assign(runtimeItem, { dataPlaneState: 'active', firstEventAt: observation.receivedTime,
                    firstEventMinute: observation.minuteKey, subscriptionState: 'confirmed' });
            }
            const previousMinute = runtimeItem.completedMinute;
            const [hour, minute] = observation.minuteKey.split(':').map(Number);
            const minuteNumber = hour * 60 + minute;
            const expectedPrevious = minuteNumber === 9 * 60 + 1 ? null : minuteNumber - 1;
            const priorNumber = previousMinute ? previousMinute.split(':').map(Number)
                .reduce((total, value, index) => index === 0 ? value * 60 : total + value, 0) : null;
            const bootstrap = bootstrapBySymbol.get(symbol);
            if (requiredBootstrapEndBySymbol.has(symbol) && !bootstrap) {
                const pending = deferredLiveBySymbol.get(symbol) ?? [];
                pending.push(observation);
                deferredLiveBySymbol.set(symbol, pending);
                Object.assign(runtimeItem, { state: 'waiting_continuity',
                    reason: 'bootstrap_prefix_pending', completedMinute: observation.minuteKey,
                    updatedAt: observation.receivedTime });
                if (firstEvent) save();
                return { accepted: true, deferred: true, reason: 'bootstrap_prefix_pending' };
            }
            const bootstrapOverlap = bootstrap && minuteNumber <= bootstrap.endNumber;
            let canonicalCumulativeVolume = observation.cumulativeVolume;
            let bootstrapContinuity = false;
            if (bootstrapOverlap) {
                const historical = bootstrap.rows.get(observation.minuteKey);
                if (!historical || historical.cumulativeVolume !== observation.cumulativeVolume) {
                    Object.assign(runtimeItem, { state: 'degraded', reason: 'rest_sse_overlap_conflict',
                        bootstrapState: 'conflict', updatedAt: observation.receivedTime });
                    save();
                    return { accepted: false, reason: 'rest_sse_overlap_conflict' };
                }
                runtimeItem.liveAccumulatorMode = 'live_full';
                bootstrapContinuity = true;
            } else if (bootstrap && firstEvent && minuteNumber === bootstrap.endNumber + 1) {
                runtimeItem.liveAccumulatorMode = 'bootstrap_prefix';
                canonicalCumulativeVolume = bootstrap.finalCumulativeVolume + observation.cumulativeVolume;
                bootstrapContinuity = true;
            } else if (bootstrap && runtimeItem.liveAccumulatorMode === 'bootstrap_prefix') {
                canonicalCumulativeVolume = bootstrap.finalCumulativeVolume + observation.cumulativeVolume;
                bootstrapContinuity = priorNumber === expectedPrevious;
            }
            const continuityReady = bootstrapContinuity || observation.minuteKey === '09:01' ||
                previousMinute === observation.minuteKey ||
                (runtimeItem.state === 'active' && priorNumber === expectedPrevious);
            Object.assign(runtimeItem, continuityReady
                ? { state: 'active', reason: 'none' }
                : { state: 'waiting_continuity', reason: 'minute_continuity_unknown' });
            const canonicalObservation = canonicalCumulativeVolume === observation.cumulativeVolume
                ? observation : { ...observation, cumulativeVolume: canonicalCumulativeVolume };
            if (!bootstrapOverlap) {
                const receipt = repository.appendObservation(canonicalObservation, repository.currentRevision());
                if (receipt.inserted) persistedObservationCount += 1;
            }
            const previous = baselineBySymbol.get(symbol)?.get(observation.minuteKey);
            const configItem = configBySymbol.get(symbol);
            const threshold = configItem.thresholdOverride ?? config.globalThreshold;
            const result = ledger.evaluate({ admitted: continuityReady, tradeDate,
                baselineTradeDate: baseline.calendar.previousTradeDate, canonicalSymbol: symbol,
                exchange: observation.contract.exchange, minuteKey: observation.minuteKey,
                configRevision: config.revision, threshold,
                currentCumulativeVolume: canonicalCumulativeVolume,
                previousCumulativeVolume: previous ?? 0, todayCompleteness: 'complete',
                baselineCompleteness: previous === undefined ? 'missing' : 'complete',
                calendarCurrent: true, sessionCurrent: true, generationCurrent: true,
                continuityComplete: continuityReady && observation.continuity === 'complete', unit: 'common_lot',
                sourceVersion: observation.sourceVersion, observationMode: 'live',
                revisionFirstComparable: observation.minuteKey === '09:01', createdAt: observation.receivedTime });
            if (result.triggerEvent && result.newlyCreated) {
                const trigger = repository.appendTrigger(result.triggerEvent, repository.currentRevision());
                if (trigger.inserted) persistedTriggerCount += 1;
            }
            Object.assign(runtimeItem, { completedMinute: observation.minuteKey,
                currentCumulativeVolume: canonicalCumulativeVolume,
                previousCumulativeVolume: previous ?? null, updatedAt: observation.receivedTime });
            const completed = completedByMinute.get(observation.minuteKey) ?? new Set();
            completed.add(symbol);
            completedByMinute.set(observation.minuteKey, completed);
            if (firstEvent || completed.size === 160) save();
            return { accepted: true, classification: result.classification,
                triggerCreated: Boolean(result.newlyCreated) };
        } catch {
            const item = itemBySymbol.get(observation.contract.canonicalSymbol);
            if (item) Object.assign(item, { state: 'degraded', reason: 'evidence_persistence_failed',
                updatedAt: now() });
            save();
            return { accepted: false };
        }
    }

    function finishPendingReview() {
        if (closed) throw new TypeError('product runtime is closed');
        phase = liveAvailabilityComplete === false ? 'complete_no_go' : 'pending_review';
        evaluationState = liveAvailabilityComplete === false ? 'no_go' : 'ready_for_review';
        closed = true;
        save();
        repository.close();
        return snapshot();
    }

    function runFirstMinuteCanary(evaluatedAt = now(), streamState = 'connected') {
        if (closed) throw new TypeError('product runtime is closed');
        if (firstMinuteCanary) return firstMinuteCanary;
        firstMinuteCanary = evaluateFirstMinuteCanary({ tradeDate, connectionGeneration,
            cohort: manifestSymbols, items, evaluatedAt, streamState });
        liveAvailabilityComplete = firstMinuteCanary.liveAvailabilityComplete;
        if (!liveAvailabilityComplete) {
            evaluationState = 'no_go';
        }
        save();
        return firstMinuteCanary;
    }

    function fail(reason = 'capture_failed') {
        if (closed) return snapshot();
        phase = 'failed';
        evaluationState = 'no_go';
        for (const item of items) if (item.state !== 'degraded') {
            item.state = 'degraded'; item.reason = reason; item.updatedAt = now();
        }
        closed = true;
        save();
        repository.close();
        return snapshot();
    }

    return Object.freeze({ installBaselines, installBootstrapGaps, requireBootstrapPrefixes,
        failBootstrapPrefixes, recordFirstKbarEvidence, persistObservation,
        runFirstMinuteCanary, finishPendingReview, fail,
        state: () => snapshot() });
}

export function activateDirect160ProductRuntime({ statePath, capture, bundle, review,
    activatedAt = new Date().toISOString() } = {}) {
    const state = readDirect160ProductRuntimeState(statePath);
    const validation = validateTieredStageEvidenceBundle(bundle);
    const rollback = decideTieredRollback({ attemptedStage: 160, review });
    const liveAcceptanceComplete = validateDirect160LiveAcceptanceCapture(capture);
    const evidenceMatches = Boolean(state && validation.readyForHumanReview && liveAcceptanceComplete &&
        rollback.outcome === 'GO' &&
        rollback.retainedActiveLimit === 160 &&
        capture?.assessment?.formalAcceptanceEvidence === true && capture.assessment.readyForBundle === true &&
        capture.tradeDate === state.tradeDate && capture.manifestHash === state.manifestHash &&
        capture.baselineHash === state.baselineHash && bundle.bundleHash === review.bundleHash &&
        Number.isFinite(Date.parse(activatedAt)));
    if (!evidenceMatches) {
        throw new TypeError('direct 160 product activation evidence is invalid');
    }
    if (state.phase === 'complete_go' && state.evaluationState === 'go' &&
        state.approvedActiveLimit === 160) return state;
    if (state.phase !== 'pending_review' || state.evaluationState !== 'ready_for_review') {
        throw new TypeError('direct 160 product activation evidence is invalid');
    }
    const activated = { ...state, phase: 'complete_go', approvedActiveLimit: 160,
        evaluationState: 'go', boundedTransportReady: true, notificationAuthority: false,
        updatedAt: activatedAt,
        operations: { ...state.operations, activeLimitMutations: state.operations.activeLimitMutations + 1 } };
    writeState(statePath, activated);
    return activated;
}

export function validateDirect160TailGapReview(capture) {
    const review = capture?.tailGapReview;
    const symbols = capture?.session?.symbols;
    const repairs = review?.repairs;
    if (review?.schemaVersion !== 'intraday-monitor-direct-160-tail-gap-review/1' ||
        review?.policy?.maximumAffectedSymbols !== 4 ||
        review?.policy?.maximumMissingMinutesPerSymbol !== 5 ||
        review?.policy?.earliestMissingMinute !== '13:26' ||
        review?.policy?.requiredFinalMinute !== '13:30' ||
        review?.stableRefetch !== true || review?.fullHistoricalMinuteCount !== 270 ||
        review?.postCloseDataContinuityComplete !== true ||
        review?.tailLiveCompletenessException !== true ||
        review?.historicalRowsLiveDelivered !== false ||
        review?.notificationAuthority !== false || review?.retroactiveTriggerAuthority !== false ||
        review?.brokerWriteAuthority !== false || review?.productionAuthority !== false ||
        !HASH.test(review?.sourceCaptureSha256 ?? '') ||
        !Number.isFinite(Date.parse(review?.reviewedAt ?? '')) ||
        !Array.isArray(repairs) || repairs.length < 1 || repairs.length > 4 ||
        review.affectedSymbolCount !== repairs.length || !Array.isArray(symbols)) return false;
    const repairBySymbol = new Map(repairs.map((repair) => [repair?.canonicalSymbol, repair]));
    const allowedTail = ['13:26', '13:27', '13:28', '13:29', '13:30'];
    if (repairBySymbol.size !== repairs.length) return false;
    return repairs.every((repair) => {
        const symbol = symbols.find((item) => item?.canonicalSymbol === repair.canonicalSymbol);
        const missing = repair?.missingMinutes;
        const repairedRows = symbol?.rows?.filter((row) => row?.liveDelivered === false) ?? [];
        return Array.isArray(missing) && missing.length >= 1 && missing.length <= 5 &&
            JSON.stringify(missing) === JSON.stringify(allowedTail.slice(-missing.length)) &&
            repairedRows.length === missing.length &&
            repairedRows.every((row, index) => row.minuteKey === missing[index] &&
                row.completeness === 'complete' && row.reason === 'post_close_historical_tail_repair') &&
            symbol?.actualLastLiveEvent?.minuteKey === repair.originalLastLiveMinute &&
            symbol?.actualLastEvent?.minuteKey === '13:30' &&
            symbol?.closeEvidence?.authority === 'stable_post_close_kbar_double_read' &&
            symbol?.closeEvidence?.firstHash === repair.firstHash &&
            symbol?.closeEvidence?.secondHash === repair.secondHash &&
            repair.firstHash === repair.secondHash && /^(?:sha256:)?[a-f0-9]{64}$/.test(repair.firstHash ?? '') &&
            repair.liveDelivered === false && repair.notificationAuthority === false;
    }) && symbols.every((symbol) => Array.isArray(symbol.rows) && symbol.rows.length === 270 &&
        (repairBySymbol.has(symbol.canonicalSymbol) ||
            symbol.rows.every((row) => row?.liveDelivered !== false)));
}

export function prepareDirect160ProductRuntimeTailGapReview({ statePath, capture,
    preparedAt = new Date().toISOString() } = {}) {
    const state = readDirect160ProductRuntimeState(statePath);
    if (!state || state.phase !== 'failed' || state.evaluationState !== 'no_go' ||
        state.approvedActiveLimit !== 20 || !validateDirect160LiveAcceptanceCapture(capture) ||
        !validateDirect160TailGapReview(capture) || capture.tradeDate !== state.tradeDate ||
        capture.manifestHash !== state.manifestHash || capture.baselineHash !== state.baselineHash ||
        !Number.isFinite(Date.parse(preparedAt))) {
        throw new TypeError('direct 160 tail gap review preparation evidence is invalid');
    }
    const repaired = new Map(capture.tailGapReview.repairs.map((repair) => [repair.canonicalSymbol, repair]));
    const symbols = new Map(capture.session.symbols.map((item) => [item.canonicalSymbol, item]));
    const items = state.items.map((item) => {
        const symbol = symbols.get(item.canonicalSymbol);
        const update = repaired.has(item.canonicalSymbol)
            ? { completedMinute: '13:30', currentCumulativeVolume: symbol.rows.at(-1).cumulativeVolume }
            : {};
        return { ...item, ...update, state: 'active', reason: 'none', subscriptionState: 'confirmed',
            dataPlaneState: 'active', updatedAt: preparedAt };
    });
    const prepared = { ...state, phase: 'pending_review', evaluationState: 'ready_for_review',
        boundedTransportReady: true, liveAvailabilityComplete: true, items,
        dataActive: 160, awaitingFirstKbar: 0, waiting: 0, degraded: 0, updatedAt: preparedAt };
    writeState(statePath, prepared);
    return prepared;
}

export function validateDirect160LiveAcceptanceCapture(capture) {
    const symbols = capture?.session?.symbols;
    const firstMinuteCanary = capture?.runtime?.firstMinuteCanary;
    const zeroOperations = capture?.operations?.notificationDispatches === 0 &&
        capture.operations.brokerWrites === 0 && capture.operations.productionTransitions === 0 &&
        capture.operations.serviceLifecycleMutations === 0 && capture.operations.activeLimitMutations === 0;
    const tailGapReviewValid = validateDirect160TailGapReview(capture);
    return Boolean(capture?.assessment?.formalAcceptanceEvidence === true &&
        capture.assessment.readyForBundle === true &&
        capture.assessment.dataContinuityComplete === true &&
        capture.assessment.liveAvailabilityComplete === true &&
        firstMinuteCanary?.result === 'pass' && firstMinuteCanary.expectedCount === 160 &&
        firstMinuteCanary.receivedCount === 160 && firstMinuteCanary.missingCount === 0 &&
        firstMinuteCanary.liveAvailabilityComplete === true &&
        capture.runtime?.localEventReconnect?.recovered === true &&
        HASH.test(capture.runtime?.passiveChartEvidenceHash ?? '') &&
        capture.session?.close?.accepted === true && Array.isArray(symbols) && symbols.length === 160 &&
        symbols.every((item) => item?.complete === true && item.nominalCloseMinute === '13:30' &&
            ['not_observed', 'observed_and_folded'].includes(item.delayedCloseState) &&
            Array.isArray(item.expectedMinuteSet) && item.expectedMinuteSet.length === 270 &&
            item.expectedMinuteSet[0] === '09:01' && item.expectedMinuteSet.at(-1) === '13:30' &&
            new Set(item.expectedMinuteSet).size === 270 && item.actualLastEvent?.minuteKey === '13:30' &&
            item.closeEvidence?.status === 'verified' &&
            (item.closeEvidence.authority === 'bounded_session_close_authority' ||
                (item.closeEvidence.authority === null &&
                    item.closeEvidence.mode === 'normal_or_revised_13_30' &&
                    item.rows?.at(-1)?.minuteKey === '13:30' &&
                    item.rows.at(-1).liveDelivered !== false) ||
                (tailGapReviewValid && item.closeEvidence.authority === 'stable_post_close_kbar_double_read')) &&
            Number.isFinite(Date.parse(item.closeEvidence.finalizedAt ?? '')) &&
            Number.isFinite(Date.parse(item.sealTime ?? ''))) && zeroOperations);
}
