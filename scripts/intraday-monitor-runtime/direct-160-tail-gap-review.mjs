import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';
import { buildDirect160TieredSessionEvidence, runDirect160DeterministicReplay,
    validateDirect160LiveInputs } from './direct-160-live-stage.mjs';
import { DIRECT_160_STORAGE, writeDirect160Artifact } from './direct-160-storage.mjs';

export const DIRECT_160_TAIL_GAP_REVIEW_SCHEMA = 'intraday-monitor-direct-160-tail-gap-review/1';
export const DIRECT_160_TAIL_GAP_POLICY = Object.freeze({
    schemaVersion: 'intraday-monitor-direct-160-tail-gap-policy/1',
    maximumAffectedSymbols: 4,
    maximumMissingMinutesPerSymbol: 5,
    earliestMissingMinute: '13:26',
    requiredFinalMinute: '13:30',
});

const EXPECTED_MINUTES = Object.freeze(Array.from({ length: 270 }, (_, index) => {
    const minute = 9 * 60 + 1 + index;
    return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}));
const HASH = /^(?:sha256:)?[a-f0-9]{64}$/;

function hash(value, maximumBytes = DIRECT_160_STORAGE.bundleCanonicalBytes) {
    return `sha256:${createHash('sha256').update(canonicalJson(value, { maximumBytes })).digest('hex')}`;
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

function tailGapCandidates(capture) {
    const symbols = capture?.session?.symbols;
    if (!Array.isArray(symbols) || symbols.length !== 160) {
        throw new Error('tail_gap_exact_160_required');
    }
    const candidates = [];
    for (const item of symbols) {
        if (item?.complete === true) {
            if (item.minuteCount !== EXPECTED_MINUTES.length || item.firstMinute !== '09:01' ||
                item.lastMinute !== '13:30' || item.rows?.length !== EXPECTED_MINUTES.length ||
                item.slots?.length !== EXPECTED_MINUTES.length ||
                item.rows.some((row, index) => row?.minuteKey !== EXPECTED_MINUTES[index] ||
                    row.completeness !== 'complete') ||
                item.slots.some((slot, index) => slot?.minuteKey !== EXPECTED_MINUTES[index] ||
                    slot.completeness !== 'complete')) {
                throw new Error('tail_gap_complete_symbol_invalid');
            }
            continue;
        }
        const unknown = item?.slots?.filter((slot) => slot?.completeness === 'unknown') ?? [];
        const missing = unknown.map((slot) => slot.minuteKey);
        if (missing.length < 1 || missing.length > DIRECT_160_TAIL_GAP_POLICY.maximumMissingMinutesPerSymbol ||
            missing[0] < DIRECT_160_TAIL_GAP_POLICY.earliestMissingMinute ||
            missing.at(-1) !== DIRECT_160_TAIL_GAP_POLICY.requiredFinalMinute ||
            JSON.stringify(missing) !== JSON.stringify(EXPECTED_MINUTES.slice(-missing.length)) ||
            item.firstMinute !== '09:01' || item.lastMinute !== EXPECTED_MINUTES.at(-(missing.length + 1)) ||
            item.minuteCount !== EXPECTED_MINUTES.length - missing.length ||
            item.slots.slice(0, -missing.length).some((slot, index) =>
                slot?.minuteKey !== EXPECTED_MINUTES[index] || slot.completeness !== 'complete')) {
            throw new Error('tail_gap_policy_exceeded');
        }
        candidates.push({ item, missing });
    }
    if (candidates.length < 1 ||
        candidates.length > DIRECT_160_TAIL_GAP_POLICY.maximumAffectedSymbols) {
        throw new Error('tail_gap_symbol_limit_exceeded');
    }
    return candidates;
}

function validateCaptureEnvelope(capture, manifest, plan, baseline) {
    const input = validateDirect160LiveInputs({ manifest, plan, baseline, tradeDate: capture?.tradeDate });
    const canary = capture?.runtime?.firstMinuteCanary;
    const operations = capture?.operations;
    const valid = capture?.schemaVersion === 'intraday-monitor-direct-160-capture/1' &&
        capture.captureMode === 'full-session' && capture.interrupted === false && input.valid &&
        capture.manifestHash === manifest.manifestHash && capture.planHash === plan.planHash &&
        capture.baselineHash === baseline.baselineHash && capture.assessment?.liveAvailabilityComplete === true &&
        capture.assessment?.dataContinuityComplete === false && canary?.result === 'pass' &&
        canary.expectedCount === 160 && canary.receivedCount === 160 && canary.missingCount === 0 &&
        canary.liveAvailabilityComplete === true && capture.runtime?.localEventReconnect?.recovered === true &&
        HASH.test(capture.runtime?.passiveChartEvidenceHash ?? '') &&
        capture.transport?.startReceipt?.subscribeAccepted === true &&
        capture.transport?.stopReceipt?.unsubscribeAccepted === true &&
        capture.transport?.status?.malformedFrames === 0 &&
        operations?.notificationDispatches === 0 && operations?.brokerWrites === 0 &&
        operations?.productionTransitions === 0 && operations?.serviceLifecycleMutations === 0 &&
        operations?.activeLimitMutations === 0;
    if (!valid) throw new Error('tail_gap_capture_not_eligible');
}

function canonicalHistoricalPayload(payload, tradeDate) {
    const keys = ['datetime', 'Open', 'High', 'Low', 'Close', 'Volume', 'Amount'];
    if (!payload || keys.some((key) => !Array.isArray(payload[key]) ||
        payload[key].length !== EXPECTED_MINUTES.length)) {
        throw new Error('tail_gap_historical_shape_invalid');
    }
    const rows = EXPECTED_MINUTES.map((minuteKey, index) => {
        const datetime = payload.datetime[index];
        const actualMinute = typeof datetime === 'string' ? datetime.slice(11, 16) : null;
        const volume = payload.Volume[index];
        if (typeof datetime !== 'string' || !datetime.startsWith(`${tradeDate}T`) ||
            actualMinute !== minuteKey || !Number.isSafeInteger(volume) || volume < 0) {
            throw new Error('tail_gap_historical_coverage_invalid');
        }
        return { minuteKey, datetime, volume };
    });
    let cumulativeVolume = 0;
    return rows.map((row) => {
        cumulativeVolume += row.volume;
        return { ...row, cumulativeVolume };
    });
}

async function requestJson(fetchImpl, url, init = {}) {
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(8_000) });
    const text = await response.text();
    if (!response.ok || Buffer.byteLength(text) > 4 * 1024 * 1024) {
        throw new Error('tail_gap_historical_request_failed');
    }
    return JSON.parse(text);
}

function repairedSymbol(item, historicalRows, hashes, reviewedAt, sourceVersion) {
    for (const row of item.rows) {
        const historical = historicalRows.find((candidate) => candidate.minuteKey === row.minuteKey);
        if (!historical || historical.cumulativeVolume !== row.cumulativeVolume) {
            throw new Error('tail_gap_live_prefix_conflict');
        }
    }
    const originalLastLiveEvent = item.actualLastEvent;
    const existing = new Set(item.rows.map((row) => row.minuteKey));
    const rows = historicalRows.map((historical, index) => {
        const live = item.rows[index];
        if (live) return { ...live, liveDelivered: true };
        if (existing.has(historical.minuteKey)) throw new Error('tail_gap_row_identity_conflict');
        return {
            canonicalSymbol: item.canonicalSymbol,
            minuteKey: historical.minuteKey,
            exchangeTime: `${historical.minuteKey}:00.000000`,
            cumulativeVolume: historical.cumulativeVolume,
            sequence: index + 1,
            receivedTime: reviewedAt,
            sealedAt: reviewedAt,
            sourceVersion,
            unit: 'common_lot',
            completeness: 'complete',
            reason: 'post_close_historical_tail_repair',
            liveDelivered: false,
        };
    });
    return {
        ...item,
        complete: true,
        minuteCount: EXPECTED_MINUTES.length,
        lastMinute: '13:30',
        rows,
        slots: rows,
        closeMode: 'post_close_tail_repaired',
        actualLastLiveEvent: originalLastLiveEvent,
        actualLastEvent: {
            minuteKey: '13:30',
            exchangeTime: '13:30:00.000000',
            receivedTime: reviewedAt,
            sourceVersion,
            liveDelivered: false,
        },
        closeEvidence: {
            status: 'verified',
            mode: 'post_close_tail_repaired',
            authority: 'stable_post_close_kbar_double_read',
            finalizedAt: reviewedAt,
            firstHash: hashes.firstHash,
            secondHash: hashes.secondHash,
        },
        sealTime: reviewedAt,
    };
}

export async function reviewDirect160TailGapCapture({ capture, manifest, plan, baseline,
    sourceCaptureSha256, fetchImpl = fetch, api = 'http://127.0.0.1:8080',
    reviewedAt = new Date().toISOString() } = {}) {
    validateCaptureEnvelope(capture, manifest, plan, baseline);
    if (!HASH.test(sourceCaptureSha256 ?? '') || !Number.isFinite(Date.parse(reviewedAt)) ||
        !/^http:\/\/127\.0\.0\.1:\d+$/.test(api) || typeof fetchImpl !== 'function') {
        throw new Error('tail_gap_review_input_invalid');
    }
    const candidates = tailGapCandidates(capture);
    const info = await requestJson(fetchImpl, `${api}/api/v1/info`);
    if (info?.simulation !== true || typeof info.version !== 'string') {
        throw new Error('tail_gap_simulation_preflight_failed');
    }
    const repairedBySymbol = new Map();
    const repairs = [];
    for (const { item, missing } of candidates) {
        const entry = manifest.cohort.find((candidate) => candidate.canonicalSymbol === item.canonicalSymbol);
        if (!entry) throw new Error('tail_gap_contract_missing');
        const body = JSON.stringify({ contract: entry.contractIdentity,
            start: capture.tradeDate, end: capture.tradeDate });
        const first = await requestJson(fetchImpl, `${api}/api/v1/data/kbars`, { method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/json' }, body });
        const second = await requestJson(fetchImpl, `${api}/api/v1/data/kbars`, { method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/json' }, body });
        const firstHash = hash(first);
        const secondHash = hash(second);
        if (firstHash !== secondHash) throw new Error('tail_gap_historical_refetch_drift');
        const firstRows = canonicalHistoricalPayload(first, capture.tradeDate);
        const secondRows = canonicalHistoricalPayload(second, capture.tradeDate);
        if (JSON.stringify(firstRows) !== JSON.stringify(secondRows)) {
            throw new Error('tail_gap_historical_refetch_drift');
        }
        const sourceVersion = `shioaji-http-${info.version}`;
        repairedBySymbol.set(item.canonicalSymbol,
            repairedSymbol(item, firstRows, { firstHash, secondHash }, reviewedAt, sourceVersion));
        repairs.push({ canonicalSymbol: item.canonicalSymbol, missingMinutes: missing,
            originalLastLiveMinute: item.lastMinute, firstHash, secondHash,
            finalCumulativeVolume: firstRows.at(-1).cumulativeVolume,
            liveDelivered: false, notificationAuthority: false });
    }
    const symbols = capture.session.symbols.map((item) => repairedBySymbol.get(item.canonicalSymbol) ?? item);
    const sessionSeed = {
        ...capture.session,
        symbols,
        close: { ...capture.session.close, accepted: true, sealedCount: 160, finalizedAt: reviewedAt,
            acceptanceMode: 'bounded_post_close_tail_repair' },
        assessment: { ...capture.session.assessment, fullSession: true, baselineEligible: true,
            notificationEligible: false, unknownSlotCount: 0,
            note: '盤中 live 完整性通過；少量收盤尾端缺口以穩定雙抓 historical KBar 補齊，回補列不具 live 或通知資格。' },
    };
    delete sessionSeed.evidenceHash;
    const session = { ...sessionSeed,
        evidenceHash: hash(sessionSeed, DIRECT_160_STORAGE.sessionCanonicalBytes) };
    const replay = runDirect160DeterministicReplay({ session, baseline, manifest });
    const tieredSession = buildDirect160TieredSessionEvidence({ plan, manifest, baseline, session,
        replay, transport: capture.transport,
        resources: capture.resources,
        assurances: { reconnectVerified: true, existingFeaturesHealthy: true } });
    const tailGapReview = {
        schemaVersion: DIRECT_160_TAIL_GAP_REVIEW_SCHEMA,
        policy: DIRECT_160_TAIL_GAP_POLICY,
        sourceCaptureSha256: sourceCaptureSha256.replace(/^sha256:/, ''),
        reviewedAt,
        affectedSymbolCount: repairs.length,
        repairs,
        stableRefetch: true,
        fullHistoricalMinuteCount: 270,
        postCloseDataContinuityComplete: true,
        tailLiveCompletenessException: true,
        historicalRowsLiveDelivered: false,
        notificationAuthority: false,
        retroactiveTriggerAuthority: false,
        brokerWriteAuthority: false,
        productionAuthority: false,
    };
    const derived = {
        ...capture,
        evidenceClass: 'live_bounded_stage_with_post_close_tail_repair',
        endedAt: reviewedAt,
        session,
        replay,
        tieredSession,
        tailGapReview,
        runtime: { ...capture.runtime, tailGapReview },
        productRuntime: { ...capture.productRuntime, phase: 'pending_review',
            evaluationState: 'ready_for_review', approvedActiveLimit: 20 },
        assessment: { ...capture.assessment, formalAcceptanceEvidence: true,
            readyForBundle: true, dataContinuityComplete: true,
            postCloseDataContinuityComplete: true, tailLiveCompletenessException: true,
            liveAvailabilityComplete: true },
    };
    return deepFreeze(derived);
}

function argument(name) {
    return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function absolute(name) {
    const value = argument(name);
    if (!value || !path.isAbsolute(value)) throw new Error(`--${name} must be an absolute path`);
    return value;
}

async function main() {
    if (!process.argv.includes('--execute')) throw new Error('--execute required');
    const capturePath = absolute('capture');
    const outputPath = absolute('output');
    const [captureBytes, plan, manifest, baseline] = await Promise.all([
        readFile(capturePath),
        readFile(absolute('plan'), 'utf8').then(JSON.parse),
        readFile(absolute('manifest'), 'utf8').then(JSON.parse),
        readFile(absolute('baseline'), 'utf8').then(JSON.parse),
    ]);
    const capture = JSON.parse(captureBytes.toString('utf8'));
    const sourceCaptureSha256 = createHash('sha256').update(captureBytes).digest('hex');
    const derived = await reviewDirect160TailGapCapture({ capture, plan, manifest, baseline,
        sourceCaptureSha256 });
    const receipt = await writeDirect160Artifact(outputPath, derived, 'capture');
    process.stdout.write(`${JSON.stringify({ created: true, outputPath,
        affectedSymbolCount: derived.tailGapReview.affectedSymbolCount,
        formalAcceptanceEvidence: derived.assessment.formalAcceptanceEvidence,
        receipt }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
