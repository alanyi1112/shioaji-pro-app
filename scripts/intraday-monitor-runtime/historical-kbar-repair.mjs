import { createHash } from 'node:crypto';

export const HISTORICAL_KBAR_REPAIR_CANDIDATE_SCHEMA =
    'intraday-historical-kbar-repair-candidate/1';
export const HISTORICAL_KBAR_BASELINE_CANDIDATE_SCHEMA =
    'intraday-historical-kbar-baseline-candidate/1';
export const HISTORICAL_KBAR_INTERRUPTION_SCHEMA =
    'intraday-historical-kbar-interruption/1';
export const HISTORICAL_KBAR_REPAIR_MANIFEST_SCHEMA =
    'intraday-historical-kbar-repair-manifest/1';
export const HISTORICAL_KBAR_BASELINE_MANIFEST_SCHEMA =
    'intraday-historical-kbar-baseline-manifest/1';
export const HISTORICAL_KBAR_REPAIR_PROVENANCE =
    'historical_repaired_verified';
export const HISTORICAL_KBAR_BASELINE_PROVENANCE =
    'historical_baseline_verified';
export const LIVE_FULL_SESSION_PROVENANCE = 'live_full_session_verified';
export const HISTORICAL_KBAR_REPAIR_VERIFIER_VERSION =
    'post-close-historical-kbar-repair/1';
export const HISTORICAL_KBAR_BASELINE_VERIFIER_VERSION =
    'historical-kbar-baseline/1';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MINUTE = /^\d{2}:\d{2}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const EXCHANGES = new Set(['TSE', 'OTC']);
const SOURCE_UNITS = new Set(['common_lot', 'share']);
const VOLUME_SEMANTICS = new Set(['minute_delta', 'cumulative']);
const CLOSE_ENCODINGS = new Set(['normal_13_30', 'delayed_13_33']);
const REQUIRED_ARRAY_FIELDS = Object.freeze([
    'datetime',
    'Open',
    'High',
    'Low',
    'Close',
    'Volume',
    'Amount',
]);

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function canonicalJson(value) {
    const ancestors = new Set();
    const normalize = (candidate, path) => {
        if (
            candidate === null ||
            typeof candidate === 'string' ||
            typeof candidate === 'boolean'
        ) {
            return candidate;
        }
        if (typeof candidate === 'number') {
            if (!Number.isFinite(candidate)) {
                throw new TypeError(`${path} must be finite`);
            }
            return candidate;
        }
        if (Array.isArray(candidate)) {
            if (ancestors.has(candidate)) throw new TypeError(`${path} is circular`);
            ancestors.add(candidate);
            const output = candidate.map((entry, index) =>
                normalize(entry, `${path}[${index}]`),
            );
            ancestors.delete(candidate);
            return output;
        }
        if (candidate && typeof candidate === 'object') {
            const prototype = Object.getPrototypeOf(candidate);
            if (prototype !== Object.prototype && prototype !== null) {
                throw new TypeError(`${path} must contain plain objects`);
            }
            if (ancestors.has(candidate)) throw new TypeError(`${path} is circular`);
            ancestors.add(candidate);
            const output = {};
            for (const key of Object.keys(candidate).sort()) {
                output[key] = normalize(candidate[key], `${path}.${key}`);
            }
            ancestors.delete(candidate);
            return output;
        }
        throw new TypeError(`${path} contains unsupported data`);
    };
    return JSON.stringify(normalize(value, '$'));
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function validDate(value) {
    return (
        typeof value === 'string' &&
        DATE.test(value) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
    );
}

function validIso(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function minuteNumber(value) {
    if (typeof value !== 'string' || !MINUTE.test(value)) return null;
    const [hour, minute] = value.split(':').map(Number);
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
}

function minuteKey(value) {
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function expectedTaiwanRegularSessionMinutes() {
    const output = [];
    for (let value = 9 * 60 + 1; value <= 13 * 60 + 30; value += 1) {
        output.push(minuteKey(value));
    }
    return output;
}

const EXPECTED_MINUTES = Object.freeze(expectedTaiwanRegularSessionMinutes());
const EXPECTED_MINUTE_SET = new Set(EXPECTED_MINUTES);

function taipeiDateAndMinute(isoValue) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(isoValue));
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
        tradeDate: `${map.year}-${map.month}-${map.day}`,
        minuteKey: `${map.hour}:${map.minute}`,
        second: Number(map.second),
    };
}

function sourcePayload(candidate) {
    return {
        schemaVersion: candidate.schemaVersion,
        symbol: candidate.symbol,
        exchange: candidate.exchange,
        securityType: candidate.securityType,
        tradeDate: candidate.tradeDate,
        timeZone: candidate.timeZone,
        source: candidate.source,
        sourceVersion: candidate.sourceVersion,
        sourceUnit: candidate.sourceUnit,
        canonicalUnit: candidate.canonicalUnit,
        volumeSemantics: candidate.volumeSemantics,
        closeEncoding: candidate.closeEncoding,
        arrays: candidate.arrays,
    };
}

export function computeHistoricalKbarPayloadHash(candidate) {
    return sha256(sourcePayload(candidate));
}

function rejected(reasonCodes, details = {}) {
    return deepFreeze({
        ok: false,
        reasonCodes: [...new Set(reasonCodes)],
        details,
        baselineUsable: false,
        liveCaptureAcceptance: false,
        notificationEligible: false,
        retroactiveTriggerEligible: false,
        brokerWriteAuthority: false,
        productionAuthority: false,
        serviceLifecycleAuthority: false,
    });
}

function validSymbol(symbol, exchange) {
    if (typeof symbol !== 'string') return false;
    const suffix = exchange === 'TSE' ? '.TW' : '.TWO';
    return /^\d{4,6}[A-Z]?$/.test(symbol.slice(0, -suffix.length)) && symbol.endsWith(suffix);
}

function normalizeCommonLot(value, sourceUnit) {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    if (sourceUnit === 'common_lot') return value;
    if (sourceUnit === 'share' && value % 1_000 === 0) return value / 1_000;
    return null;
}

function sameNumber(left, right) {
    return typeof left === 'number' && typeof right === 'number' && Object.is(left, right);
}

function validPriceRow(row) {
    return (
        ['open', 'high', 'low', 'close', 'amount'].every(
            (key) => typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] >= 0,
        ) &&
        row.high >= Math.max(row.open, row.close, row.low) &&
        row.low <= Math.min(row.open, row.close, row.high)
    );
}

function compareLiveOverlap(liveMinutes, canonicalRows) {
    const canonicalByMinute = new Map(canonicalRows.map((row) => [row.minuteKey, row]));
    const mismatches = [];
    const comparedMinutes = [];
    for (const live of liveMinutes) {
        const candidate = canonicalByMinute.get(live.minuteKey);
        if (!candidate) {
            mismatches.push({ minuteKey: live.minuteKey, field: 'missing_historical_minute' });
            continue;
        }
        comparedMinutes.push(live.minuteKey);
        if (candidate.volumeCommonLot !== live.volumeCommonLot) {
            mismatches.push({ minuteKey: live.minuteKey, field: 'volumeCommonLot' });
        }
        for (const field of ['open', 'high', 'low', 'close', 'amount']) {
            if (
                Object.hasOwn(live, field) &&
                live[field] !== null &&
                !sameNumber(live[field], candidate[field])
            ) {
                mismatches.push({ minuteKey: live.minuteKey, field });
            }
        }
    }
    return { comparedMinutes, mismatches };
}

export function createHistoricalKbarInterruptionRecord(input) {
    const reasons = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return rejected(['invalid_interruption_evidence']);
    }
    if (!validDate(input.tradeDate)) reasons.push('invalid_trade_date');
    if (!EXCHANGES.has(input.exchange) || !validSymbol(input.symbol, input.exchange)) {
        reasons.push('unknown_instrument_identity');
    }
    if (!validIso(input.interruptionStart) || !validIso(input.interruptionEnd)) {
        reasons.push('invalid_interruption_window');
    } else if (Date.parse(input.interruptionStart) > Date.parse(input.interruptionEnd)) {
        reasons.push('invalid_interruption_window');
    }
    if (typeof input.streamGeneration !== 'string' || input.streamGeneration.length === 0) {
        reasons.push('unknown_stream_generation');
    }
    if (
        !Number.isSafeInteger(input.sequenceStart) ||
        !Number.isSafeInteger(input.sequenceEnd) ||
        input.sequenceStart < 0 ||
        input.sequenceEnd < input.sequenceStart
    ) {
        reasons.push('invalid_sequence');
    }
    if (!HASH.test(input.cohortHash ?? '')) reasons.push('invalid_cohort_hash');
    if (typeof input.sourceVersion !== 'string' || input.sourceVersion.length === 0) {
        reasons.push('unknown_source_version');
    }
    if (!HASH.test(input.payloadHash ?? '')) reasons.push('invalid_live_payload_hash');
    if (typeof input.reason !== 'string' || input.reason.length === 0) {
        reasons.push('missing_interruption_reason');
    }
    if (!Array.isArray(input.liveMinutes)) reasons.push('invalid_live_minutes');
    const liveMinutes = [];
    const seen = new Set();
    if (Array.isArray(input.liveMinutes)) {
        for (const row of input.liveMinutes) {
            if (
                !row ||
                typeof row !== 'object' ||
                !EXPECTED_MINUTE_SET.has(row.minuteKey) ||
                !Number.isSafeInteger(row.volumeCommonLot) ||
                row.volumeCommonLot < 0 ||
                seen.has(row.minuteKey)
            ) {
                reasons.push('invalid_live_minutes');
                continue;
            }
            seen.add(row.minuteKey);
            liveMinutes.push({ ...row });
        }
    }
    if (reasons.length > 0) return rejected(reasons);
    liveMinutes.sort((left, right) => left.minuteKey.localeCompare(right.minuteKey));
    const seed = {
        schemaVersion: HISTORICAL_KBAR_INTERRUPTION_SCHEMA,
        symbol: input.symbol,
        exchange: input.exchange,
        tradeDate: input.tradeDate,
        state: 'degraded',
        partial: true,
        comparisonPaused: true,
        notificationsPaused: true,
        liveCaptureAcceptance: false,
        interruptionStart: input.interruptionStart,
        interruptionEnd: input.interruptionEnd,
        streamGeneration: input.streamGeneration,
        sequenceStart: input.sequenceStart,
        sequenceEnd: input.sequenceEnd,
        cohortHash: input.cohortHash,
        sourceVersion: input.sourceVersion,
        payloadHash: input.payloadHash,
        reason: input.reason,
        liveMinutes,
    };
    return deepFreeze({ ...seed, interruptionId: sha256(seed) });
}

export function isHistoricalKbarInterruptionRecord(value) {
    if (!value || typeof value !== 'object' || value.schemaVersion !== HISTORICAL_KBAR_INTERRUPTION_SCHEMA ||
        !HASH.test(value.interruptionId ?? '')) return false;
    const normalized = createHistoricalKbarInterruptionRecord(value);
    return normalized?.ok !== false && normalized.interruptionId === value.interruptionId;
}

function validateCandidateIdentity(
    candidate,
    authority,
    reasons,
    expectedSchema = HISTORICAL_KBAR_REPAIR_CANDIDATE_SCHEMA,
) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        reasons.push('invalid_candidate');
        return;
    }
    if (candidate.schemaVersion !== expectedSchema) {
        reasons.push('unknown_candidate_schema');
    }
    if (
        candidate.symbol !== authority.symbol ||
        candidate.exchange !== authority.exchange ||
        candidate.tradeDate !== authority.tradeDate ||
        candidate.securityType !== 'STK' ||
        !validSymbol(candidate.symbol, candidate.exchange)
    ) {
        reasons.push('unknown_instrument_identity');
    }
    if (candidate.timeZone !== 'Asia/Taipei') reasons.push('invalid_timezone');
    if (typeof candidate.source !== 'string' || candidate.source.length === 0) {
        reasons.push('unknown_source');
    }
    if (typeof candidate.sourceVersion !== 'string' || candidate.sourceVersion.length === 0) {
        reasons.push('unknown_source_version');
    }
    if (!validIso(candidate.fetchedAt)) reasons.push('invalid_fetch_time');
    if (!SOURCE_UNITS.has(candidate.sourceUnit) || candidate.canonicalUnit !== 'common_lot') {
        reasons.push('unknown_volume_unit');
    }
    if (!VOLUME_SEMANTICS.has(candidate.volumeSemantics)) {
        reasons.push('unknown_volume_semantics');
    }
    if (!CLOSE_ENCODINGS.has(candidate.closeEncoding)) reasons.push('unknown_close_encoding');
    if (!HASH.test(candidate.payloadHash ?? '')) reasons.push('invalid_payload_hash');
}

function validateArrays(candidate, reasons) {
    if (!candidate?.arrays || typeof candidate.arrays !== 'object') {
        reasons.push('invalid_kbar_structure');
        return [];
    }
    const arrays = candidate.arrays;
    if (REQUIRED_ARRAY_FIELDS.some((field) => !Array.isArray(arrays[field]))) {
        reasons.push('invalid_kbar_structure');
        return [];
    }
    const length = arrays.datetime.length;
    if (length === 0 || REQUIRED_ARRAY_FIELDS.some((field) => arrays[field].length !== length)) {
        reasons.push('invalid_kbar_structure');
        return [];
    }
    const rows = [];
    let previousEpoch = -1;
    let previousCumulative = 0;
    const seenMinutes = new Set();
    for (let index = 0; index < length; index += 1) {
        const datetime = arrays.datetime[index];
        if (!validIso(datetime)) {
            reasons.push('invalid_kbar_datetime');
            continue;
        }
        const epoch = Date.parse(datetime);
        const taipei = taipeiDateAndMinute(datetime);
        if (
            taipei.tradeDate !== candidate.tradeDate ||
            taipei.second !== 0 ||
            (taipei.minuteKey !== '13:33' && !EXPECTED_MINUTE_SET.has(taipei.minuteKey))
        ) {
            reasons.push('outside_regular_session');
        }
        if (epoch <= previousEpoch) reasons.push('minute_not_strictly_increasing');
        if (seenMinutes.has(taipei.minuteKey)) reasons.push('duplicate_minute');
        previousEpoch = epoch;
        seenMinutes.add(taipei.minuteKey);

        const rawVolume = arrays.Volume[index];
        const normalizedVolume = normalizeCommonLot(rawVolume, candidate.sourceUnit);
        if (normalizedVolume === null) reasons.push('invalid_volume');
        let volumeCommonLot = normalizedVolume ?? 0;
        if (candidate.volumeSemantics === 'cumulative' && normalizedVolume !== null) {
            if (normalizedVolume < previousCumulative) reasons.push('cumulative_volume_regression');
            volumeCommonLot = normalizedVolume - previousCumulative;
            previousCumulative = normalizedVolume;
        }
        const row = {
            minuteKey: taipei.minuteKey,
            open: arrays.Open[index],
            high: arrays.High[index],
            low: arrays.Low[index],
            close: arrays.Close[index],
            volumeCommonLot,
            amount: arrays.Amount[index],
            provenance: 'historical_observed',
        };
        if (!validPriceRow(row)) reasons.push('invalid_ohlc_amount');
        rows.push(row);
    }
    return rows;
}

function normalizeClose(rows, candidate, reasons) {
    const delayedIndex = rows.findIndex((row) => row.minuteKey === '13:33');
    const closeIndex = rows.findIndex((row) => row.minuteKey === '13:30');
    if (candidate.closeEncoding === 'normal_13_30') {
        if (delayedIndex >= 0) reasons.push('unexpected_delayed_close_row');
        return {
            rows: rows.filter((row) => row.minuteKey !== '13:33'),
            closeMode: 'normal_or_revised_13_30',
        };
    }
    if (delayedIndex < 0) {
        reasons.push('missing_delayed_close_row');
        return { rows, closeMode: 'unknown' };
    }
    const hasContinuousPrelude = EXPECTED_MINUTES
        .filter((minute) => minute <= '13:29')
        .every((minute) => rows.some((row) => row.minuteKey === minute));
    if (!hasContinuousPrelude) reasons.push('delayed_close_continuity_incomplete');
    const delayed = rows[delayedIndex];
    const output = rows.filter((row) => row.minuteKey !== '13:33');
    if (closeIndex >= 0) {
        const targetIndex = output.findIndex((row) => row.minuteKey === '13:30');
        const existing = output[targetIndex];
        output[targetIndex] = {
            ...existing,
            high: Math.max(existing.high, delayed.high),
            low: Math.min(existing.low, delayed.low),
            close: delayed.close,
            volumeCommonLot: existing.volumeCommonLot + delayed.volumeCommonLot,
            amount: existing.amount + delayed.amount,
            provenance: 'historical_delayed_close_merged',
        };
    } else {
        output.push({
            ...delayed,
            minuteKey: '13:30',
            provenance: 'historical_delayed_close_bridge',
        });
        output.sort((left, right) => left.minuteKey.localeCompare(right.minuteKey));
    }
    return { rows: output, closeMode: 'delayed_13_33' };
}

function fillKnownZeroMinutes(rows, candidate, authority, finalVolumeAuthority, reasons) {
    const byMinute = new Map(rows.map((row) => [row.minuteKey, row]));
    const missing = EXPECTED_MINUTES.filter((minute) => !byMinute.has(minute));
    if (missing.length === 0) return { rows, repairedMinutes: [] };
    if (candidate.volumeSemantics !== 'minute_delta') {
        reasons.push('missing_minute_without_zero_proof');
        return { rows, repairedMinutes: [] };
    }
    const proofs = new Set(candidate.knownZeroMinutes ?? []);
    if (missing.some((minute) => !proofs.has(minute))) {
        reasons.push('missing_minute_without_zero_proof');
        return { rows, repairedMinutes: [] };
    }
    const observedTotal = rows.reduce((sum, row) => sum + row.volumeCommonLot, 0);
    if (
        authority.instrumentStatus !== 'normal' ||
        finalVolumeAuthority.status !== 'verified' ||
        observedTotal !== finalVolumeAuthority.volumeCommonLot
    ) {
        reasons.push('missing_minute_zero_not_reconciled');
        return { rows, repairedMinutes: [] };
    }
    const output = [];
    let priorClose = candidate.previousClose;
    for (const minute of EXPECTED_MINUTES) {
        const row = byMinute.get(minute);
        if (row) {
            output.push(row);
            priorClose = row.close;
            continue;
        }
        if (typeof priorClose !== 'number' || !Number.isFinite(priorClose) || priorClose < 0) {
            reasons.push('missing_carry_forward_close');
            continue;
        }
        output.push({
            minuteKey: minute,
            open: priorClose,
            high: priorClose,
            low: priorClose,
            close: priorClose,
            volumeCommonLot: 0,
            amount: 0,
            provenance: 'known_zero_carry_forward',
        });
    }
    return { rows: output, repairedMinutes: missing };
}

function validateAuthorities(authority, finalVolumeAuthority, candidate, now, reasons) {
    if (
        !authority ||
        authority.officialTradingDay !== true ||
        authority.timeZone !== 'Asia/Taipei' ||
        authority.securityType !== 'STK' ||
        authority.identityVerified !== true ||
        authority.instrumentStatus !== 'normal' ||
        !EXCHANGES.has(authority.exchange) ||
        !validDate(authority.tradeDate) ||
        !validSymbol(authority.symbol, authority.exchange)
    ) {
        reasons.push('calendar_or_instrument_authority_unverified');
    }
    if (!validIso(now)) {
        reasons.push('invalid_verification_time');
    } else if (authority?.tradeDate) {
        const earliest = Date.parse(`${authority.tradeDate}T13:34:30+08:00`);
        if (Date.parse(now) < earliest) reasons.push('session_not_finalized');
    }
    if (
        !finalVolumeAuthority ||
        finalVolumeAuthority.status !== 'verified' ||
        finalVolumeAuthority.sessionScope !== 'regular_session' ||
        finalVolumeAuthority.unit !== 'common_lot' ||
        !Number.isSafeInteger(finalVolumeAuthority.volumeCommonLot) ||
        finalVolumeAuthority.volumeCommonLot < 0 ||
        finalVolumeAuthority.symbol !== candidate?.symbol ||
        finalVolumeAuthority.exchange !== candidate?.exchange ||
        finalVolumeAuthority.tradeDate !== candidate?.tradeDate ||
        typeof finalVolumeAuthority.source !== 'string' ||
        typeof finalVolumeAuthority.sourceVersion !== 'string'
    ) {
        reasons.push('final_volume_authority_unverified');
    }
}

export function validateAndBuildHistoricalKbarRepair({
    authority,
    finalVolumeAuthority,
    interruption,
    candidate,
    refetchCandidate,
    now,
    verifierVersion = HISTORICAL_KBAR_REPAIR_VERIFIER_VERSION,
} = {}) {
    const reasons = [];
    const interruptionRecord = createHistoricalKbarInterruptionRecord(interruption);
    if (!interruptionRecord || interruptionRecord.ok === false) {
        reasons.push('invalid_interruption_evidence');
    }
    validateAuthorities(authority, finalVolumeAuthority, candidate, now, reasons);
    validateCandidateIdentity(candidate, authority ?? {}, reasons);
    validateCandidateIdentity(refetchCandidate, authority ?? {}, reasons);
    if (
        interruptionRecord?.symbol !== candidate?.symbol ||
        interruptionRecord?.tradeDate !== candidate?.tradeDate ||
        interruptionRecord?.exchange !== candidate?.exchange
    ) {
        reasons.push('interruption_identity_mismatch');
    }
    if (
        candidate?.source !== refetchCandidate?.source ||
        candidate?.sourceVersion !== refetchCandidate?.sourceVersion ||
        candidate?.symbol !== refetchCandidate?.symbol ||
        candidate?.tradeDate !== refetchCandidate?.tradeDate
    ) {
        reasons.push('refetch_identity_mismatch');
    }
    let candidateHash;
    let refetchHash;
    try {
        candidateHash = computeHistoricalKbarPayloadHash(candidate);
        refetchHash = computeHistoricalKbarPayloadHash(refetchCandidate);
    } catch {
        reasons.push('payload_not_hashable');
    }
    if (candidateHash && candidate?.payloadHash !== candidateHash) {
        reasons.push('payload_hash_mismatch');
    }
    if (refetchHash && refetchCandidate?.payloadHash !== refetchHash) {
        reasons.push('refetch_payload_hash_mismatch');
    }
    if (
        candidateHash &&
        refetchHash &&
        (candidateHash !== refetchHash || candidate?.payloadHash !== refetchCandidate?.payloadHash)
    ) {
        reasons.push('refetch_payload_unstable');
    }

    let rows = validateArrays(candidate, reasons);
    const close = normalizeClose(rows, candidate ?? {}, reasons);
    rows = close.rows;
    const filled = fillKnownZeroMinutes(
        rows,
        candidate ?? {},
        authority ?? {},
        finalVolumeAuthority ?? {},
        reasons,
    );
    rows = filled.rows;
    if (rows.length !== EXPECTED_MINUTES.length) reasons.push('minute_coverage_incomplete');
    if (
        rows.length === EXPECTED_MINUTES.length &&
        rows.some((row, index) => row.minuteKey !== EXPECTED_MINUTES[index])
    ) {
        reasons.push('minute_coverage_invalid');
    }
    const finalVolume = rows.reduce((sum, row) => sum + row.volumeCommonLot, 0);
    if (finalVolume !== finalVolumeAuthority?.volumeCommonLot) {
        reasons.push('final_volume_mismatch');
    }
    const overlap = compareLiveOverlap(interruptionRecord?.liveMinutes ?? [], rows);
    if (overlap.mismatches.length > 0) reasons.push('live_overlap_mismatch');
    if (typeof verifierVersion !== 'string' || verifierVersion.length === 0) {
        reasons.push('unknown_verifier_version');
    }
    if (reasons.length > 0) {
        return rejected(reasons, {
            overlapMismatches: overlap.mismatches,
            expectedMinuteCount: EXPECTED_MINUTES.length,
            actualMinuteCount: rows.length,
        });
    }

    let cumulativeVolume = 0;
    const cumulativeSeries = rows.map((row) => {
        cumulativeVolume += row.volumeCommonLot;
        return {
            minuteKey: row.minuteKey,
            cumulativeVolume,
            provenance: row.provenance,
        };
    });
    const manifestBody = {
        schemaVersion: HISTORICAL_KBAR_REPAIR_MANIFEST_SCHEMA,
        symbol: candidate.symbol,
        exchange: candidate.exchange,
        tradeDate: candidate.tradeDate,
        timeZone: 'Asia/Taipei',
        source: candidate.source,
        sourceVersion: candidate.sourceVersion,
        sourceUnit: candidate.sourceUnit,
        canonicalUnit: 'common_lot',
        fetchTime: candidate.fetchedAt,
        refetchTime: refetchCandidate.fetchedAt,
        repairedGap: {
            interruptionStart: interruptionRecord.interruptionStart,
            interruptionEnd: interruptionRecord.interruptionEnd,
            minutes: filled.repairedMinutes,
        },
        liveOverlap: {
            matched: true,
            comparedMinutes: overlap.comparedMinutes,
            mismatchCount: 0,
        },
        minuteCoverage: {
            expectedMinuteCount: EXPECTED_MINUTES.length,
            canonicalMinuteCount: cumulativeSeries.length,
            firstMinute: cumulativeSeries[0].minuteKey,
            lastMinute: cumulativeSeries.at(-1).minuteKey,
            knownZeroCarryForwardCount: filled.repairedMinutes.length,
        },
        finalVolumeReconciliation: {
            matched: true,
            expectedVolumeCommonLot: finalVolumeAuthority.volumeCommonLot,
            actualVolumeCommonLot: finalVolume,
            source: finalVolumeAuthority.source,
            sourceVersion: finalVolumeAuthority.sourceVersion,
            unit: 'common_lot',
            sessionScope: 'regular_session',
        },
        closeMode: close.closeMode,
        payloadHash: candidate.payloadHash,
        verifierVersion,
        provenance: HISTORICAL_KBAR_REPAIR_PROVENANCE,
        interruptionEvidence: {
            streamGeneration: interruptionRecord.streamGeneration,
            sequenceStart: interruptionRecord.sequenceStart,
            sequenceEnd: interruptionRecord.sequenceEnd,
            cohortHash: interruptionRecord.cohortHash,
            sourceVersion: interruptionRecord.sourceVersion,
            payloadHash: interruptionRecord.payloadHash,
            reason: interruptionRecord.reason,
        },
        cumulativeSeries,
        baselineUsable: true,
        liveCaptureAcceptance: false,
        notificationEligible: false,
        retroactiveTriggerEligible: false,
        nextApplicableTradeDateOnly: true,
        brokerWriteAuthority: false,
        productionAuthority: false,
        serviceLifecycleAuthority: false,
    };
    const manifest = deepFreeze({
        ...manifestBody,
        manifestId: sha256(manifestBody),
    });
    return deepFreeze({
        ok: true,
        manifest,
        baselineUsable: true,
        liveCaptureAcceptance: false,
        notificationEligible: false,
        retroactiveTriggerEligible: false,
        brokerWriteAuthority: false,
        productionAuthority: false,
        serviceLifecycleAuthority: false,
    });
}

function validateHistoricalBaselineCalendarAuthority(authority, candidate, now, reasons) {
    if (
        authority?.calendarVerified !== true ||
        authority?.previousApplicableTradeDate !== candidate?.tradeDate ||
        !validDate(authority?.targetTradeDate) ||
        !validDate(authority?.previousApplicableTradeDate) ||
        authority.previousApplicableTradeDate >= authority.targetTradeDate ||
        authority?.timeZone !== 'Asia/Taipei' ||
        typeof authority?.calendarSource !== 'string' ||
        authority.calendarSource.length === 0 ||
        typeof authority?.calendarSourceVersion !== 'string' ||
        authority.calendarSourceVersion.length === 0
    ) {
        reasons.push('previous_trade_date_authority_unverified');
        return;
    }
    if (validIso(now)) {
        const targetSessionStart = Date.parse(
            `${authority.targetTradeDate}T09:01:00+08:00`,
        );
        if (Date.parse(now) >= targetSessionStart) {
            reasons.push('baseline_bootstrap_window_closed');
        }
    }
}

export function validateAndBuildHistoricalKbarBaseline({
    authority,
    finalVolumeAuthority,
    candidate,
    refetchCandidate,
    cohortHash,
    now,
    verifierVersion = HISTORICAL_KBAR_BASELINE_VERIFIER_VERSION,
} = {}) {
    const reasons = [];
    validateAuthorities(authority, finalVolumeAuthority, candidate, now, reasons);
    validateHistoricalBaselineCalendarAuthority(authority, candidate, now, reasons);
    validateCandidateIdentity(
        candidate,
        authority ?? {},
        reasons,
        HISTORICAL_KBAR_BASELINE_CANDIDATE_SCHEMA,
    );
    validateCandidateIdentity(
        refetchCandidate,
        authority ?? {},
        reasons,
        HISTORICAL_KBAR_BASELINE_CANDIDATE_SCHEMA,
    );
    if (
        candidate?.source !== refetchCandidate?.source ||
        candidate?.sourceVersion !== refetchCandidate?.sourceVersion ||
        candidate?.symbol !== refetchCandidate?.symbol ||
        candidate?.exchange !== refetchCandidate?.exchange ||
        candidate?.tradeDate !== refetchCandidate?.tradeDate
    ) {
        reasons.push('refetch_identity_mismatch');
    }
    let candidateHash;
    let refetchHash;
    try {
        candidateHash = computeHistoricalKbarPayloadHash(candidate);
        refetchHash = computeHistoricalKbarPayloadHash(refetchCandidate);
    } catch {
        reasons.push('payload_not_hashable');
    }
    if (candidateHash && candidate?.payloadHash !== candidateHash) {
        reasons.push('payload_hash_mismatch');
    }
    if (refetchHash && refetchCandidate?.payloadHash !== refetchHash) {
        reasons.push('refetch_payload_hash_mismatch');
    }
    if (
        candidateHash &&
        refetchHash &&
        (candidateHash !== refetchHash ||
            candidate?.payloadHash !== refetchCandidate?.payloadHash)
    ) {
        reasons.push('refetch_payload_unstable');
    }
    if (!HASH.test(cohortHash ?? '')) reasons.push('invalid_cohort_hash');
    if (typeof verifierVersion !== 'string' || verifierVersion.length === 0) {
        reasons.push('unknown_verifier_version');
    }

    let rows = validateArrays(candidate, reasons);
    const close = normalizeClose(rows, candidate ?? {}, reasons);
    rows = close.rows;
    const filled = fillKnownZeroMinutes(
        rows,
        candidate ?? {},
        authority ?? {},
        finalVolumeAuthority ?? {},
        reasons,
    );
    rows = filled.rows;
    if (rows.length !== EXPECTED_MINUTES.length) reasons.push('minute_coverage_incomplete');
    if (
        rows.length === EXPECTED_MINUTES.length &&
        rows.some((row, index) => row.minuteKey !== EXPECTED_MINUTES[index])
    ) {
        reasons.push('minute_coverage_invalid');
    }
    const finalVolume = rows.reduce((sum, row) => sum + row.volumeCommonLot, 0);
    if (finalVolume !== finalVolumeAuthority?.volumeCommonLot) {
        reasons.push('final_volume_mismatch');
    }
    if (reasons.length > 0) {
        return rejected(reasons, {
            expectedMinuteCount: EXPECTED_MINUTES.length,
            actualMinuteCount: rows.length,
        });
    }

    let cumulativeVolume = 0;
    const cumulativeSeries = rows.map((row) => {
        cumulativeVolume += row.volumeCommonLot;
        return {
            minuteKey: row.minuteKey,
            cumulativeVolume,
            provenance: row.provenance,
        };
    });
    const manifestBody = {
        schemaVersion: HISTORICAL_KBAR_BASELINE_MANIFEST_SCHEMA,
        symbol: candidate.symbol,
        exchange: candidate.exchange,
        tradeDate: candidate.tradeDate,
        targetTradeDate: authority.targetTradeDate,
        timeZone: 'Asia/Taipei',
        calendarSource: authority.calendarSource,
        calendarSourceVersion: authority.calendarSourceVersion,
        source: candidate.source,
        sourceVersion: candidate.sourceVersion,
        sourceUnit: candidate.sourceUnit,
        canonicalUnit: 'common_lot',
        fetchTime: candidate.fetchedAt,
        refetchTime: refetchCandidate.fetchedAt,
        minuteCoverage: {
            expectedMinuteCount: EXPECTED_MINUTES.length,
            canonicalMinuteCount: cumulativeSeries.length,
            firstMinute: cumulativeSeries[0].minuteKey,
            lastMinute: cumulativeSeries.at(-1).minuteKey,
            knownZeroCarryForwardCount: filled.repairedMinutes.length,
            knownZeroMinutes: filled.repairedMinutes,
        },
        finalVolumeReconciliation: {
            matched: true,
            expectedVolumeCommonLot: finalVolumeAuthority.volumeCommonLot,
            actualVolumeCommonLot: finalVolume,
            source: finalVolumeAuthority.source,
            sourceVersion: finalVolumeAuthority.sourceVersion,
            unit: 'common_lot',
            sessionScope: 'regular_session',
        },
        closeMode: close.closeMode,
        payloadHash: candidate.payloadHash,
        refetchPayloadHash: refetchCandidate.payloadHash,
        verifierVersion,
        cohortHash,
        provenance: HISTORICAL_KBAR_BASELINE_PROVENANCE,
        cumulativeSeries,
        baselineUsable: true,
        liveCaptureAcceptance: false,
        notificationEligible: false,
        retroactiveTriggerEligible: false,
        nextApplicableTradeDateOnly: true,
        brokerWriteAuthority: false,
        productionAuthority: false,
        serviceLifecycleAuthority: false,
    };
    const manifest = deepFreeze({
        ...manifestBody,
        manifestId: sha256(manifestBody),
    });
    return deepFreeze({
        ok: true,
        manifest,
        baselineUsable: true,
        liveCaptureAcceptance: false,
        notificationEligible: false,
        retroactiveTriggerEligible: false,
        brokerWriteAuthority: false,
        productionAuthority: false,
        serviceLifecycleAuthority: false,
    });
}

export function isHistoricalKbarBaselineManifest(value) {
    const structurallyValid = Boolean(
        value &&
        typeof value === 'object' &&
        value.schemaVersion === HISTORICAL_KBAR_BASELINE_MANIFEST_SCHEMA &&
        HASH.test(value.manifestId ?? '') &&
        HASH.test(value.payloadHash ?? '') &&
        value.refetchPayloadHash === value.payloadHash &&
        HASH.test(value.cohortHash ?? '') &&
        validDate(value.tradeDate) &&
        validDate(value.targetTradeDate) &&
        value.tradeDate < value.targetTradeDate &&
        value.provenance === HISTORICAL_KBAR_BASELINE_PROVENANCE &&
        value.baselineUsable === true &&
        value.liveCaptureAcceptance === false &&
        value.notificationEligible === false &&
        value.retroactiveTriggerEligible === false &&
        value.brokerWriteAuthority === false &&
        value.productionAuthority === false &&
        value.serviceLifecycleAuthority === false &&
        Array.isArray(value.cumulativeSeries) &&
        value.cumulativeSeries.length === EXPECTED_MINUTES.length &&
        value.cumulativeSeries.every(
            (row, index) =>
                row.minuteKey === EXPECTED_MINUTES[index] &&
                Number.isSafeInteger(row.cumulativeVolume) &&
                row.cumulativeVolume >= 0,
        )
    );
    if (!structurallyValid) return false;
    try {
        const { manifestId, ...body } = value;
        return manifestId === sha256(body);
    } catch {
        return false;
    }
}

export function isHistoricalKbarRepairManifest(value) {
    const structurallyValid = Boolean(
        value &&
        typeof value === 'object' &&
        value.schemaVersion === HISTORICAL_KBAR_REPAIR_MANIFEST_SCHEMA &&
        HASH.test(value.manifestId ?? '') &&
        HASH.test(value.payloadHash ?? '') &&
        value.provenance === HISTORICAL_KBAR_REPAIR_PROVENANCE &&
        value.baselineUsable === true &&
        value.liveCaptureAcceptance === false &&
        value.notificationEligible === false &&
        value.retroactiveTriggerEligible === false &&
        value.brokerWriteAuthority === false &&
        value.productionAuthority === false &&
        value.serviceLifecycleAuthority === false &&
        Array.isArray(value.cumulativeSeries) &&
        value.cumulativeSeries.length === EXPECTED_MINUTES.length &&
        value.cumulativeSeries.every(
            (row, index) =>
                row.minuteKey === EXPECTED_MINUTES[index] &&
                Number.isSafeInteger(row.cumulativeVolume) &&
                row.cumulativeVolume >= 0,
        ),
    );
    if (!structurallyValid) return false;
    try {
        const { manifestId, ...body } = value;
        return manifestId === sha256(body);
    } catch {
        return false;
    }
}

export function selectIntradayBaseline({
    liveBaseline = null,
    historicalBaseline = null,
    repairedBaseline = null,
} = {}) {
    if (
        liveBaseline?.provenance === LIVE_FULL_SESSION_PROVENANCE &&
        liveBaseline?.baselineUsable === true
    ) {
        return deepFreeze({ selected: 'live', baseline: liveBaseline });
    }
    if (isHistoricalKbarBaselineManifest(historicalBaseline)) {
        return deepFreeze({
            selected: 'historical_baseline',
            baseline: historicalBaseline,
        });
    }
    if (isHistoricalKbarRepairManifest(repairedBaseline)) {
        return deepFreeze({ selected: 'historical_repair', baseline: repairedBaseline });
    }
    return deepFreeze({ selected: 'none', baseline: null });
}
