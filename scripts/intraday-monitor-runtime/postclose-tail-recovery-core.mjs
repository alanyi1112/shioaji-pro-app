import { createHash } from 'node:crypto';

import { expectedTaiwanRegularSessionMinutes } from './historical-kbar-repair.mjs';
import { DIRECT_160_TAIL_GAP_POLICY } from './direct-160-tail-gap-review.mjs';

export const POSTCLOSE_TAIL_RECOVERY_SCHEMA = 'intraday-monitor-postclose-tail-recovery/1';
const MINUTES = Object.freeze(expectedTaiwanRegularSessionMinutes());
const HASH = /^(?:sha256:)?[a-f0-9]{64}$/;

function safeOperations(operations) {
    return operations?.notificationDispatches === 0 && operations?.brokerWrites === 0 &&
        operations?.productionTransitions === 0 && operations?.serviceLifecycleMutations === 0 &&
        operations?.activeLimitMutations === 0;
}

function classifySymbol(item) {
    if (!item || !Array.isArray(item.rows) || !Array.isArray(item.slots) ||
        item.slots.length !== MINUTES.length || typeof item.canonicalSymbol !== 'string') {
        return { symbol: item?.canonicalSymbol ?? null, state: 'invalid', reason: 'slot_shape_invalid' };
    }
    let prefixLength = 0;
    for (let index = 0; index < MINUTES.length; index += 1) {
        const slot = item.slots[index];
        if (slot?.minuteKey !== MINUTES[index]) {
            return { symbol: item.canonicalSymbol, state: 'invalid', reason: 'slot_minute_invalid' };
        }
        if (slot.completeness === 'complete') {
            if (prefixLength !== index || item.rows[index]?.minuteKey !== MINUTES[index] ||
                item.rows[index]?.completeness !== 'complete' ||
                item.rows[index]?.cumulativeVolume !== slot.cumulativeVolume ||
                !Number.isSafeInteger(slot.cumulativeVolume) || slot.cumulativeVolume < 0) {
                return { symbol: item.canonicalSymbol, state: 'invalid', reason: 'live_prefix_invalid' };
            }
            prefixLength += 1;
        } else if (slot.completeness !== 'unknown') {
            return { symbol: item.canonicalSymbol, state: 'invalid', reason: 'slot_completeness_invalid' };
        }
    }
    if (item.rows.length !== prefixLength || item.minuteCount !== prefixLength ||
        item.firstMinute !== (prefixLength ? '09:01' : null) ||
        item.lastMinute !== (prefixLength ? MINUTES[prefixLength - 1] : null) ||
        item.complete !== (prefixLength === MINUTES.length)) {
        return { symbol: item.canonicalSymbol, state: 'invalid', reason: 'prefix_identity_invalid' };
    }
    if (prefixLength === MINUTES.length) {
        return { symbol: item.canonicalSymbol, state: 'complete', missingMinutes: [] };
    }
    if (prefixLength < 1) {
        return { symbol: item.canonicalSymbol, state: 'invalid', reason: 'opening_minute_missing' };
    }
    return { symbol: item.canonicalSymbol, state: 'tail',
        missingMinutes: MINUTES.slice(prefixLength), liveLastMinute: MINUTES[prefixLength - 1] };
}

export function classifyPostcloseTailCapture({ capture, sourceCaptureSha256,
    observedAt = new Date().toISOString() } = {}) {
    const reject = (reason) => Object.freeze({ schemaVersion: POSTCLOSE_TAIL_RECOVERY_SCHEMA,
        classification: 'non_tail_or_ineligible', reason, tradeDate: capture?.tradeDate ?? null,
        sourceCaptureSha256: sourceCaptureSha256 ?? null, affectedSymbolCount: null,
        symbols: [], liveAcceptance: capture?.assessment?.formalAcceptanceEvidence === true,
        derivedAcceptance: false, notificationAuthority: false });
    if (!HASH.test(sourceCaptureSha256 ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(capture?.tradeDate ?? '') ||
        !Number.isFinite(Date.parse(observedAt)) || !Number.isFinite(Date.parse(capture?.endedAt))) {
        return reject('capture_identity_unverified');
    }
    if (Date.parse(capture.endedAt) < Date.parse(`${capture.tradeDate}T13:34:30+08:00`) ||
        Date.parse(observedAt) < Date.parse(`${capture.tradeDate}T13:34:30+08:00`)) {
        return reject('closing_window_not_finished');
    }
    if (capture.schemaVersion !== 'intraday-monitor-direct-160-capture/1' ||
        capture.captureMode !== 'full-session' || capture.interrupted !== false ||
        !HASH.test(capture.manifestHash ?? '') || !HASH.test(capture.planHash ?? '') ||
        !HASH.test(capture.baselineHash ?? '') ||
        capture.session?.tradeDate !== capture.tradeDate ||
        !/^simulation:[A-Za-z0-9._:-]+$/.test(capture.connectionGeneration ?? '') ||
        capture.connectionGeneration !== capture.session?.connectionGeneration ||
        !Array.isArray(capture.session?.symbols) || capture.session.symbols.length !== 160 ||
        new Set(capture.session.symbols.map((item) => item?.canonicalSymbol)).size !== 160 ||
        capture.runtime?.firstMinuteCanary?.result !== 'pass' ||
        capture.runtime.firstMinuteCanary.receivedCount !== 160 ||
        capture.runtime.firstMinuteCanary.missingCount !== 0 ||
        capture.transport?.startReceipt?.subscribeAccepted !== true ||
        capture.transport?.stopReceipt?.unsubscribeAccepted !== true ||
        capture.transport.startReceipt.brokerWriteAuthority !== false ||
        capture.transport.startReceipt.productionAuthority !== false ||
        capture.transport.stopReceipt.brokerWriteAuthority !== false ||
        capture.transport.stopReceipt.productionAuthority !== false ||
        !safeOperations(capture.operations)) {
        return reject('capture_safety_gate_unverified');
    }
    const symbols = capture.session.symbols.map(classifySymbol);
    const invalid = symbols.find((item) => item.state === 'invalid');
    if (invalid) return Object.freeze({ ...reject(invalid.reason), symbols });
    const tails = symbols.filter((item) => item.state === 'tail');
    const shortFinalTail = tails.every((item) => item.missingMinutes.length <=
            DIRECT_160_TAIL_GAP_POLICY.maximumMissingMinutesPerSymbol &&
            item.missingMinutes[0] >= DIRECT_160_TAIL_GAP_POLICY.earliestMissingMinute &&
            item.missingMinutes.at(-1) === DIRECT_160_TAIL_GAP_POLICY.requiredFinalMinute);
    const eligible = shortFinalTail &&
        tails.length <= DIRECT_160_TAIL_GAP_POLICY.maximumAffectedSymbols;
    const classification = tails.length === 0 ? 'complete_live' :
        eligible ? 'bounded_tail_candidate' :
            shortFinalTail && tails.length > DIRECT_160_TAIL_GAP_POLICY.maximumAffectedSymbols ?
                'correlated_tail_failure' : 'non_tail_or_ineligible';
    return Object.freeze({ schemaVersion: POSTCLOSE_TAIL_RECOVERY_SCHEMA, classification,
        reason: classification === 'non_tail_or_ineligible' ? 'tail_policy_exceeded' : null,
        tradeDate: capture.tradeDate, sourceCaptureSha256: sourceCaptureSha256.replace(/^sha256:/, ''),
        cohortHash: capture.session.cohortHash, manifestHash: capture.manifestHash,
        connectionGeneration: capture.connectionGeneration, affectedSymbolCount: tails.length,
        symbols, liveAcceptance: capture.assessment?.formalAcceptanceEvidence === true,
        derivedAcceptance: false, notificationAuthority: false });
}

export function buildPostcloseTailDataRecovery({ classification, capture, baseline,
    sourceManifestSha256, verifiedAt = new Date().toISOString() } = {}) {
    if (!['bounded_tail_candidate', 'correlated_tail_failure'].includes(classification?.classification) ||
        !HASH.test(sourceManifestSha256 ?? '') || !Number.isFinite(Date.parse(verifiedAt)) ||
        baseline?.schemaVersion !== 'intraday-monitor-direct-160-baseline-set/1' ||
        baseline?.calendar?.previousTradeDate !== capture?.tradeDate ||
        baseline.manifestHash !== capture.manifestHash || baseline.baselineUsable !== true ||
        baseline.liveCaptureAcceptance !== false || !Array.isArray(baseline.manifests) ||
        baseline.manifests.length !== 160) {
        throw new Error('postclose_recovery_source_unverified');
    }
    const sourceBySymbol = new Map(baseline.manifests.map((item) => [item.symbol, item]));
    const output = [];
    for (const symbol of classification.symbols.filter((item) => item.state === 'tail')) {
        const source = sourceBySymbol.get(symbol.symbol);
        const live = capture.session.symbols.find((item) => item.canonicalSymbol === symbol.symbol);
        if (!source || !live || source.tradeDate !== capture.tradeDate ||
            source.cohortHash !== `sha256:${capture.manifestHash}` ||
            source.finalVolumeReconciliation?.matched !== true ||
            source.finalVolumeReconciliation?.sessionScope !== 'regular_session' ||
            source.sourceUnit !== 'common_lot' || source.canonicalUnit !== 'common_lot' ||
            !['normal_or_revised_13_30', 'delayed_13_33'].includes(source.closeMode) ||
            !HASH.test(source.payloadHash ?? '') || source.payloadHash !== source.refetchPayloadHash ||
            source.minuteCoverage?.canonicalMinuteCount !== MINUTES.length ||
            !Array.isArray(source.cumulativeSeries) || source.cumulativeSeries.length !== MINUTES.length) {
            output.push({ canonicalSymbol: symbol.symbol, state: 'source_unverified',
                originalLastLiveMinute: symbol.liveLastMinute, rows: [] });
            continue;
        }
        const series = source.cumulativeSeries;
        const validSeries = series.every((row, index) => row.minuteKey === MINUTES[index] &&
            Number.isSafeInteger(row.cumulativeVolume) && row.cumulativeVolume >= 0 &&
            (index === 0 || row.cumulativeVolume >= series[index - 1].cumulativeVolume) &&
            (row.provenance === 'historical_observed' ||
                (row.minuteKey === '13:30' && source.closeMode === 'delayed_13_33' &&
                    ['historical_delayed_close_merged', 'historical_delayed_close_bridge']
                        .includes(row.provenance)) ||
                (row.provenance === 'known_zero_carry_forward' &&
                    source.minuteCoverage?.knownZeroMinutes?.includes(row.minuteKey))));
        const prefixMatches = live.rows.every((row, index) =>
            row.minuteKey === series[index]?.minuteKey &&
            row.cumulativeVolume === series[index]?.cumulativeVolume);
        const finalMatches = series.at(-1)?.cumulativeVolume ===
            source.finalVolumeReconciliation?.actualVolumeCommonLot;
        if (!validSeries || !prefixMatches || !finalMatches) {
            output.push({ canonicalSymbol: symbol.symbol,
                state: !prefixMatches ? 'live_prefix_conflict' : 'source_unverified',
                originalLastLiveMinute: symbol.liveLastMinute, rows: [] });
            continue;
        }
        output.push({ canonicalSymbol: symbol.symbol, state: 'postclose_data_recovered',
            originalLastLiveMinute: symbol.liveLastMinute,
            sourceManifestId: source.manifestId, sourceVersion: source.sourceVersion,
            sourceTradeDate: source.tradeDate, sourcePayloadHash: source.payloadHash,
            closeMode: source.closeMode,
            rows: series.slice(live.rows.length).map((row) => ({ ...row,
                canonicalSymbol: symbol.symbol, source: 'postclose_verified',
                sourceTradeDate: source.tradeDate, verifiedAt, liveDelivered: false,
                notificationAuthority: false, retroactiveTriggerAuthority: false })) });
    }
    return Object.freeze({ schemaVersion: POSTCLOSE_TAIL_RECOVERY_SCHEMA,
        sourceCaptureSha256: classification.sourceCaptureSha256,
        sourceManifestSha256: sourceManifestSha256.replace(/^sha256:/, ''),
        tradeDate: capture.tradeDate, classification: classification.classification,
        verifiedAt, symbols: output,
        postcloseDataRecovered: output.length > 0 &&
            output.every((item) => item.state === 'postclose_data_recovered'),
        liveAcceptance: classification.liveAcceptance, derivedAcceptance: false,
        notificationAuthority: false, retroactiveTriggerAuthority: false,
        brokerWriteAuthority: false, productionAuthority: false });
}

export function sha256Bytes(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}
