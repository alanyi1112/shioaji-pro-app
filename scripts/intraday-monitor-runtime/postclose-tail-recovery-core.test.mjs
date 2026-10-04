import assert from 'node:assert/strict';
import test from 'node:test';

import { expectedTaiwanRegularSessionMinutes } from './historical-kbar-repair.mjs';
import { buildPostcloseTailDataRecovery, classifyPostcloseTailCapture }
    from './postclose-tail-recovery-core.mjs';

const MINUTES = expectedTaiwanRegularSessionMinutes();
const SHA = 'a'.repeat(64);
const DATE = '2026-10-02';

function fixture({ missingCount = 1, affectedCount = 1 } = {}) {
    const symbols = Array.from({ length: 160 }, (_, index) => {
        const canonicalSymbol = `${String(2000 + index)}.TW`;
        const count = index < affectedCount ? MINUTES.length - missingCount : MINUTES.length;
        const rows = MINUTES.slice(0, count).map((minuteKey, rowIndex) => ({
            canonicalSymbol, minuteKey, cumulativeVolume: rowIndex + 1,
            completeness: 'complete',
        }));
        return { canonicalSymbol, complete: count === MINUTES.length, rows,
            slots: [...rows, ...MINUTES.slice(count).map((minuteKey) => ({
                canonicalSymbol, minuteKey, completeness: 'unknown',
            }))], minuteCount: count, firstMinute: '09:01', lastMinute: MINUTES[count - 1] };
    });
    const capture = { schemaVersion: 'intraday-monitor-direct-160-capture/1',
        captureMode: 'full-session', interrupted: false, tradeDate: DATE,
        endedAt: '2026-10-02T05:34:30.500Z', connectionGeneration: 'simulation:fixture',
        manifestHash: SHA, planHash: SHA, baselineHash: SHA,
        assessment: { formalAcceptanceEvidence: false },
        session: { tradeDate: DATE, connectionGeneration: 'simulation:fixture',
            cohortHash: `sha256:${SHA}`, symbols },
        runtime: { firstMinuteCanary: { result: 'pass', receivedCount: 160, missingCount: 0 } },
        transport: { startReceipt: { subscribeAccepted: true,
            brokerWriteAuthority: false, productionAuthority: false },
            stopReceipt: { unsubscribeAccepted: true,
                brokerWriteAuthority: false, productionAuthority: false } },
        operations: { notificationDispatches: 0, brokerWrites: 0,
            productionTransitions: 0, serviceLifecycleMutations: 0, activeLimitMutations: 0 } };
    const baseline = { schemaVersion: 'intraday-monitor-direct-160-baseline-set/1',
        calendar: { previousTradeDate: DATE }, manifestHash: SHA,
        baselineUsable: true, liveCaptureAcceptance: false,
        manifests: symbols.map(({ canonicalSymbol }) => ({ symbol: canonicalSymbol,
            tradeDate: DATE, cohortHash: `sha256:${SHA}`, manifestId: `sha256:${SHA}`,
            sourceUnit: 'common_lot', canonicalUnit: 'common_lot',
            sourceVersion: 'shioaji-http/1.7.1', closeMode: 'normal_or_revised_13_30',
            payloadHash: `sha256:${SHA}`, refetchPayloadHash: `sha256:${SHA}`,
            minuteCoverage: { canonicalMinuteCount: 270, knownZeroMinutes: [] },
            finalVolumeReconciliation: { matched: true, sessionScope: 'regular_session',
                actualVolumeCommonLot: 270 },
            cumulativeSeries: MINUTES.map((minuteKey, rowIndex) => ({ minuteKey,
                cumulativeVolume: rowIndex + 1, provenance: 'historical_observed' })) })) };
    return { capture, baseline };
}

function classify(capture) {
    return classifyPostcloseTailCapture({ capture, sourceCaptureSha256: SHA,
        observedAt: '2026-10-02T05:35:00Z' });
}

test('one symbol missing two tail minutes remains a bounded candidate', () => {
    const { capture } = fixture({ missingCount: 2 });
    const result = classify(capture);
    assert.equal(result.classification, 'bounded_tail_candidate');
    assert.deepEqual(result.symbols[0].missingMinutes, ['13:29', '13:30']);
    assert.equal(result.derivedAcceptance, false);
});

test('complete live capture requires no postclose recovery; unsafe capture is ineligible', () => {
    const { capture } = fixture({ affectedCount: 0 });
    assert.equal(classify(capture).classification, 'complete_live');
    capture.operations.brokerWrites = 1;
    assert.equal(classify(capture).classification, 'non_tail_or_ineligible');
    assert.equal(classify(capture).reason, 'capture_safety_gate_unverified');
});

test('160 missing final minutes are correlated and never gain derived acceptance', () => {
    const { capture, baseline } = fixture({ affectedCount: 160 });
    const classification = classify(capture);
    assert.equal(classification.classification, 'correlated_tail_failure');
    const recovery = buildPostcloseTailDataRecovery({ classification, capture, baseline,
        sourceManifestSha256: SHA, verifiedAt: '2026-10-02T06:00:00Z' });
    assert.equal(recovery.postcloseDataRecovered, true);
    assert.equal(recovery.symbols.length, 160);
    assert.equal(recovery.symbols[0].rows[0].minuteKey, '13:30');
    assert.equal(recovery.symbols[0].rows[0].liveDelivered, false);
    assert.equal(recovery.liveAcceptance, false);
    assert.equal(recovery.derivedAcceptance, false);
    assert.equal(recovery.notificationAuthority, false);
    assert.equal(capture.session.symbols[0].rows.length, 269);
});

test('opening or middle gap and unfinished close are ineligible', () => {
    const { capture } = fixture();
    capture.session.symbols[0].slots[0].completeness = 'unknown';
    assert.equal(classify(capture).classification, 'non_tail_or_ineligible');
    const other = fixture().capture;
    other.session.symbols[0].slots[100].completeness = 'unknown';
    assert.equal(classify(other).classification, 'non_tail_or_ineligible');
    const early = fixture().capture;
    early.endedAt = '2026-10-02T05:30:00Z';
    assert.equal(classify(early).reason, 'closing_window_not_finished');
    assert.equal(classify(fixture({ affectedCount: 160, missingCount: 6 }).capture)
        .classification, 'non_tail_or_ineligible');
});

test('verified delayed 13:33 closes only canonical 13:30', () => {
    const { capture, baseline } = fixture();
    const source = baseline.manifests[0];
    source.closeMode = 'delayed_13_33';
    source.cumulativeSeries[269].provenance = 'historical_delayed_close_bridge';
    const result = buildPostcloseTailDataRecovery({ classification: classify(capture),
        capture, baseline, sourceManifestSha256: SHA });
    assert.equal(result.symbols[0].state, 'postclose_data_recovered');
    assert.deepEqual(result.symbols[0].rows.map((row) => row.minuteKey), ['13:30']);
});

test('source drift, live prefix conflict, unknown zero and missing source fail closed', () => {
    const { capture, baseline } = fixture();
    const classification = classify(capture);
    baseline.manifests[0].refetchPayloadHash = `sha256:${'b'.repeat(64)}`;
    let result = buildPostcloseTailDataRecovery({ classification, capture, baseline,
        sourceManifestSha256: SHA });
    assert.equal(result.symbols[0].state, 'source_unverified');
    baseline.manifests[0].refetchPayloadHash = baseline.manifests[0].payloadHash;
    baseline.manifests[0].cumulativeSeries[100].cumulativeVolume += 1;
    result = buildPostcloseTailDataRecovery({ classification, capture, baseline,
        sourceManifestSha256: SHA });
    assert.equal(result.symbols[0].state, 'live_prefix_conflict');
    baseline.manifests[0].cumulativeSeries[100].cumulativeVolume -= 1;
    baseline.manifests[0].cumulativeSeries[269].provenance = 'known_zero_carry_forward';
    result = buildPostcloseTailDataRecovery({ classification, capture, baseline,
        sourceManifestSha256: SHA });
    assert.equal(result.symbols[0].state, 'source_unverified');
    assert.throws(() => buildPostcloseTailDataRecovery({ classification, capture,
        baseline: null, sourceManifestSha256: SHA }), /source_unverified/);
});
