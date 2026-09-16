import { createHash } from 'node:crypto';
import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';
import { createIntradayMonitorKbarStreamAdapter } from './kbar-stream-adapter.mjs';
import { DIRECT_160_STORAGE } from './direct-160-storage.mjs';

export const INTRADAY_MONITOR_KBAR_SHADOW_SESSION_SCHEMA = 'intraday-monitor-kbar-shadow-session/1';
export const INTRADAY_MONITOR_KBAR_SHADOW_EVIDENCE_MAXIMUM_BYTES = 4 * 1024 * 1024;

function expectedMinutes() {
    const output = [];
    for (let minute = 9 * 60 + 1; minute <= 13 * 60 + 30; minute += 1) {
        output.push(`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);
    }
    return output;
}

const EXPECTED_MINUTES = Object.freeze(expectedMinutes());

function hash(value, maximumBytes = INTRADAY_MONITOR_KBAR_SHADOW_EVIDENCE_MAXIMUM_BYTES) {
    return `sha256:${createHash('sha256').update(canonicalJson(value, {
        maximumBytes,
    })).digest('hex')}`;
}

export function createIntradayMonitorKbarShadowSession({ cohort, tradeDate, connectionGeneration, startedAt,
    nowEpochMs = () => Date.now(), storageProfile = null, onObservation = null } = {}) {
    const direct160 = storageProfile?.schemaVersion === DIRECT_160_STORAGE.schemaVersion &&
        Object.entries(DIRECT_160_STORAGE).every(([key, expected]) => storageProfile[key] === expected);
    if (storageProfile !== null && !direct160) throw new TypeError('shadow session storage profile is invalid');
    const maximumCohortSize = direct160 ? DIRECT_160_STORAGE.targetCount : 20;
    const maximumEvidenceBytes = direct160
        ? DIRECT_160_STORAGE.sessionCanonicalBytes
        : INTRADAY_MONITOR_KBAR_SHADOW_EVIDENCE_MAXIMUM_BYTES;
    if (!Array.isArray(cohort) || cohort.length < 1 || cohort.length > maximumCohortSize ||
        (direct160 && cohort.length !== DIRECT_160_STORAGE.targetCount) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') ||
        typeof connectionGeneration !== 'string' || connectionGeneration.length < 16 ||
        !Number.isFinite(Date.parse(startedAt ?? '')) || typeof nowEpochMs !== 'function') throw new TypeError('shadow session options are invalid');
    const rowsBySymbol = new Map(cohort.map((item) => [item.canonicalSymbol, new Map()]));
    let closeAttempted = false;
    let closeResult = null;
    let sinkRejections = 0;
    const adapter = createIntradayMonitorKbarStreamAdapter({
        cohort, tradeDate, connectionGeneration, nowEpochMs, maximumCohortSize,
        observationSink(observation) {
            const rows = rowsBySymbol.get(observation.contract.canonicalSymbol);
            if (!rows || rows.has(observation.minuteKey)) { sinkRejections += 1; return { accepted: false }; }
            const row = Object.freeze({
                canonicalSymbol: observation.contract.canonicalSymbol,
                minuteKey: observation.minuteKey,
                exchangeTime: observation.exchangeTime,
                cumulativeVolume: observation.cumulativeVolume,
                sequence: observation.sequence,
                receivedTime: observation.receivedTime,
                sealedAt: observation.receivedTime,
                sourceVersion: observation.sourceVersion,
                unit: 'common_lot',
                completeness: 'complete',
                reason: 'provider_kbar_observed',
            });
            rows.set(observation.minuteKey, row);
            if (typeof onObservation === 'function') {
                const result = onObservation(observation);
                if (result?.accepted !== true) {
                    rows.delete(observation.minuteKey);
                    sinkRejections += 1;
                    return { accepted: false };
                }
            }
            return { accepted: true };
        },
    });

    function recordKbar(value) {
        return adapter.accept(value);
    }

    function markDisconnected(value) {
        return adapter.markDisconnected(value);
    }

    function sealSessionClose(authority) {
        if (closeAttempted) return Object.freeze({ accepted: false, reason: 'close_already_attempted', brokerWriteAuthority: false });
        closeAttempted = true;
        closeResult = adapter.sealSessionClose(authority);
        return closeResult;
    }

    function evidence({ endedAt } = {}) {
        if (!closeAttempted || !Number.isFinite(Date.parse(endedAt ?? ''))) throw new Error('shadow session is not sealed');
        const adapterStatus = adapter.status();
        const adapterStateBySymbol = new Map(adapterStatus.symbols.map((item) => [item.canonicalSymbol, item]));
        const symbols = cohort.map((contract) => {
            const rows = [...(rowsBySymbol.get(contract.canonicalSymbol)?.values() ?? [])]
                .sort((left, right) => left.minuteKey.localeCompare(right.minuteKey));
            const actualMinutes = rows.map((row) => row.minuteKey);
            const complete = actualMinutes.length === EXPECTED_MINUTES.length &&
                actualMinutes.every((minute, index) => minute === EXPECTED_MINUTES[index]) &&
                rows.every((row, index) => row.sequence === index + 1);
            const rowsByMinute = new Map(rows.map((row) => [row.minuteKey, row]));
            const slots = direct160 ? EXPECTED_MINUTES.map((minuteKey) => rowsByMinute.get(minuteKey) ?? Object.freeze({
                canonicalSymbol: contract.canonicalSymbol,
                minuteKey,
                cumulativeVolume: null,
                sequence: null,
                receivedTime: null,
                sealedAt: null,
                sourceVersion: null,
                unit: 'common_lot',
                completeness: 'unknown',
                reason: 'provider_kbar_missing',
            })) : undefined;
            return Object.freeze({ canonicalSymbol: contract.canonicalSymbol,
                closeMode: adapterStateBySymbol.get(contract.canonicalSymbol)?.closeMode ?? 'pending', complete,
                minuteCount: rows.length, firstMinute: actualMinutes[0] ?? null,
                lastMinute: actualMinutes.at(-1) ?? null, rows,
                ...(direct160 ? {
                    nominalCloseMinute: '13:30',
                    delayedCloseState: adapterStateBySymbol.get(contract.canonicalSymbol)?.closeMode ===
                        'delayed_13_33' ? 'observed_and_folded' : 'not_observed',
                    expectedMinuteSet: EXPECTED_MINUTES,
                    actualLastEvent: rows.length > 0 ? {
                        minuteKey: rows.at(-1).minuteKey,
                        exchangeTime: rows.at(-1).exchangeTime,
                        receivedTime: rows.at(-1).receivedTime,
                        sourceVersion: rows.at(-1).sourceVersion,
                    } : null,
                    closeEvidence: {
                        status: complete ? 'verified' : 'unresolved',
                        mode: adapterStateBySymbol.get(contract.canonicalSymbol)?.closeMode ?? 'pending',
                        finalizedAt: closeResult?.finalizedAt ?? null,
                        authority: closeResult?.accepted === true ? 'bounded_session_close_authority' : null,
                    },
                    sealTime: rows.at(-1)?.sealedAt ?? null,
                    slots,
                } : {}) });
        });
        const fullSession = closeResult?.accepted === true && sinkRejections === 0 &&
            symbols.every((item) => item.complete) && adapterStatus.symbols.every((item) => !item.degraded);
        const seed = {
            schemaVersion: INTRADAY_MONITOR_KBAR_SHADOW_SESSION_SCHEMA,
            tradeDate,
            startedAt,
            endedAt,
            connectionGeneration,
            cohort: cohort.map((item) => item.canonicalSymbol),
            cohortHash: hash(cohort.map((item) => item.canonicalSymbol), maximumEvidenceBytes),
            expectedMinuteCountPerSymbol: EXPECTED_MINUTES.length,
            symbols,
            close: { attempted: true, accepted: closeResult?.accepted === true,
                sealedCount: closeResult?.sealedCount ?? 0, expectedCount: cohort.length,
                normalCloseMinute: closeResult?.normalCloseMinute ?? null,
                delayedCloseMinute: closeResult?.delayedCloseMinute ?? null,
                finalizedAt: closeResult?.finalizedAt ?? null },
            adapter: { rejectionCounts: adapterStatus.rejectionCounts, sinkRejections,
                providerPhysicalUsage: null },
            assessment: { fullSession, baselineEligible: fullSession, notificationEligible: false,
                unknownSlotCount: direct160 ? symbols.reduce((count, item) => count +
                    item.slots.filter((slot) => slot.completeness === 'unknown').length, 0) : null,
                note: fullSession ? '完整日只可成為下一適用交易日 baseline；本 session 不具通知權限。' :
                    'partial evidence 不得成為 baseline 或觸發通知。' },
            operations: { notificationDispatchCount: 0, brokerWriteAttemptCount: 0,
                productionTransitionCount: 0, serviceLifecycleMutationCount: 0,
                pollingFallback: false, rawPayloadSaved: false },
        };
        return Object.freeze({ ...seed,
            storageProfile: direct160 ? DIRECT_160_STORAGE.schemaVersion : null,
            evidenceHash: hash({ ...seed,
                storageProfile: direct160 ? DIRECT_160_STORAGE.schemaVersion : null,
            }, maximumEvidenceBytes) });
    }

    return Object.freeze({ recordKbar, markDisconnected, sealSessionClose, evidence, status: adapter.status });
}
