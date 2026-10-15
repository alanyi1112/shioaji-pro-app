import { expectedTaiwanRegularSessionMinutes, hashHistoricalKbarValue,
    normalizeHistoricalKbarMinuteRows, isHistoricalKbarBaselineManifest }
    from './historical-kbar-repair.mjs';

export const DAILY_MINUTE_VOLUME_BASELINE_SCHEMA = 'intraday-minute-volume-baseline/2';
export const DAILY_MINUTE_VOLUME_CANDIDATE_SCHEMA = 'intraday-minute-volume-candidate/2';
export const DAILY_MINUTE_VOLUME_PROVENANCE = 'minute_volume_baseline_verified_v2';
export const DAILY_MINUTE_VOLUME_VERIFIER = 'intraday-minute-volume-verifier/2';
export const DAILY_KBAR_TIMESTAMP_ENCODING = 'shioaji-http-kbars-end-minute/1';
const MINUTES = expectedTaiwanRegularSessionMinutes();
const HASH = /^sha256:[a-f0-9]{64}$/;
const instant = value => typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const count = value => Number.isSafeInteger(value) && value >= 0;
function date(value) {
    try { return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
    catch { return false; }
}
function identity(symbol, exchange) {
    return ['TSE', 'OTC'].includes(exchange) &&
        new RegExp(`^\\d{4,6}[A-Z]?\\.${exchange === 'TSE' ? 'TW' : 'TWO'}$`).test(symbol ?? '');
}
function freeze(value) {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
    }
    return value;
}
const noAuthority = { liveCaptureAcceptance: false, notificationEligible: false,
    retroactiveTriggerEligible: false, brokerWriteAuthority: false,
    productionAuthority: false, serviceLifecycleAuthority: false };
const reject = reasonCodes => freeze({ ok: false, baselineUsable: false,
    reasonCodes: [...new Set(reasonCodes)], ...noAuthority });

export function computeDailyMinuteVolumePayloadHash(candidate) {
    const { fetchedAt, payloadHash, ...body } = candidate;
    return hashHistoricalKbarValue(body);
}

export function createDailyMinuteVolumeCandidate({ entry, contract, kbars,
    tradeDate, sourceVersion, timestampEncoding } = {}) {
    if (contract?.code !== entry?.contractIdentity?.code ||
        contract?.exchange !== entry?.contractIdentity?.exchange ||
        contract?.security_type !== 'STK' || contract?.region !== 'TW' ||
        contract?.unit !== 1000 || contract?.trading_suspended !== false ||
        contract?.update_date !== tradeDate || !date(tradeDate) ||
        !identity(entry?.canonicalSymbol, contract.exchange) ||
        !Array.isArray(kbars?.data?.datetime) ||
        timestampEncoding !== DAILY_KBAR_TIMESTAMP_ENCODING) {
        throw new TypeError('daily_source_identity_or_encoding_unverified');
    }
    const datetimes = kbars.data.datetime.map(value => {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
            throw new TypeError('daily_source_datetime_encoding_invalid');
        }
        return `${value}+08:00`;
    });
    const candidate = { schemaVersion: DAILY_MINUTE_VOLUME_CANDIDATE_SCHEMA,
        symbol: entry.canonicalSymbol, exchange: contract.exchange,
        securityType: 'STK', tradeDate, timeZone: 'Asia/Taipei',
        source: 'shioaji-http-historical-kbars', sourceVersion,
        fetchedAt: kbars.fetchedAt, sourceUnit: 'common_lot', canonicalUnit: 'common_lot',
        volumeSemantics: 'minute_delta', timestampEncoding,
        closeEncoding: datetimes.some(t => t.slice(11, 16) === '13:33') ?
            'delayed_13_33' : 'normal_13_30',
        arrays: { ...structuredClone(kbars.data), datetime: datetimes } };
    return { ...candidate, payloadHash: computeDailyMinuteVolumePayloadHash(candidate) };
}

// 純函式：不下載、不發布、不授予交易或通知權限。
export function verifyDailyMinuteVolumeBaseline({ candidate, authority,
    finalVolumeAuthority = null, now } = {}) {
    const reasons = [];
    if (!candidate || candidate.schemaVersion !== DAILY_MINUTE_VOLUME_CANDIDATE_SCHEMA) {
        return reject(['daily_candidate_schema_invalid']);
    }
    if (!identity(candidate.symbol, candidate.exchange) || candidate.securityType !== 'STK' ||
        candidate.timeZone !== 'Asia/Taipei' || !date(candidate.tradeDate)) {
        reasons.push('daily_candidate_identity_invalid');
    }
    if (candidate.timestampEncoding !== DAILY_KBAR_TIMESTAMP_ENCODING) {
        reasons.push('timestamp_encoding_unverified');
    }
    if (!['common_lot', 'share'].includes(candidate.sourceUnit) ||
        candidate.canonicalUnit !== 'common_lot') reasons.push('unknown_volume_unit');
    if (!['minute_delta', 'cumulative'].includes(candidate.volumeSemantics)) {
        reasons.push('unknown_volume_semantics');
    }
    if (!['normal_13_30', 'delayed_13_33'].includes(candidate.closeEncoding)) {
        reasons.push('unknown_close_encoding');
    }
    if (!Array.isArray(candidate.arrays?.datetime) || candidate.arrays.datetime.length > 271) {
        reasons.push('daily_source_row_limit');
    }
    if (!text(candidate.source) || !text(candidate.sourceVersion)) reasons.push('unknown_source_version');
    if (authority?.officialTradingDay !== true || authority?.identityVerified !== true ||
        authority?.instrumentStatus !== 'normal' || authority?.calendarVerified !== true ||
        authority?.symbol !== candidate.symbol || authority?.exchange !== candidate.exchange ||
        authority?.tradeDate !== candidate.tradeDate || authority?.securityType !== 'STK' ||
        authority?.timeZone !== 'Asia/Taipei' ||
        authority?.previousApplicableTradeDate !== candidate.tradeDate ||
        !date(authority?.targetTradeDate) || candidate.tradeDate >= authority.targetTradeDate ||
        !text(authority?.calendarSource) || !text(authority?.calendarSourceVersion)) {
        reasons.push('calendar_or_instrument_authority_unverified');
    }
    if (!instant(now) || !instant(candidate.fetchedAt)) reasons.push('invalid_verification_time');
    else {
        const finalized = Date.parse(`${candidate.tradeDate}T13:34:30+08:00`);
        if (Date.parse(candidate.fetchedAt) < finalized || Date.parse(now) < finalized) {
            reasons.push('session_not_finalized');
        }
        if (Date.parse(candidate.fetchedAt) > Date.parse(now)) reasons.push('future_fetch_time');
        if (Date.parse(now) >= Date.parse(`${authority?.targetTradeDate}T09:01:00+08:00`)) {
            reasons.push('baseline_bootstrap_window_closed');
        }
    }
    try {
        if (!HASH.test(candidate.payloadHash ?? '') ||
            candidate.payloadHash !== computeDailyMinuteVolumePayloadHash(candidate)) {
            reasons.push('payload_hash_mismatch');
        }
    } catch { reasons.push('payload_not_hashable'); }
    if (finalVolumeAuthority !== null && (finalVolumeAuthority?.status !== 'verified' ||
        finalVolumeAuthority.sessionScope !== 'regular_session' ||
        finalVolumeAuthority.unit !== 'common_lot' ||
        !count(finalVolumeAuthority.volumeCommonLot) ||
        finalVolumeAuthority.symbol !== candidate.symbol ||
        finalVolumeAuthority.exchange !== candidate.exchange ||
        finalVolumeAuthority.tradeDate !== candidate.tradeDate ||
        !text(finalVolumeAuthority.source) || !text(finalVolumeAuthority.sourceVersion))) {
        reasons.push('final_volume_authority_unverified');
    }
    if (reasons.length) return reject(reasons);
    const normalized = normalizeHistoricalKbarMinuteRows({ candidate, authority, finalVolumeAuthority });
    reasons.push(...normalized.reasonCodes);
    let cumulative = 0;
    const cumulativeSeries = normalized.rows.map(row => {
        cumulative += row.volumeCommonLot;
        if (!count(cumulative)) reasons.push('cumulative_volume_overflow');
        return { minuteKey: row.minuteKey, cumulativeVolume: cumulative, provenance: row.provenance };
    });
    if (finalVolumeAuthority && cumulative !== finalVolumeAuthority.volumeCommonLot) {
        reasons.push('final_volume_mismatch');
    }
    if (reasons.length) return reject(reasons);
    const body = {
        schemaVersion: DAILY_MINUTE_VOLUME_BASELINE_SCHEMA,
        symbol: candidate.symbol, exchange: candidate.exchange,
        tradeDate: candidate.tradeDate, sourceTradeDate: candidate.tradeDate,
        targetTradeDate: authority.targetTradeDate, timeZone: 'Asia/Taipei',
        source: candidate.source, sourceVersion: candidate.sourceVersion,
        sourceUnit: candidate.sourceUnit, canonicalUnit: 'common_lot',
        timestampEncoding: candidate.timestampEncoding, fetchedAt: candidate.fetchedAt,
        payloadHash: candidate.payloadHash, verifierVersion: DAILY_MINUTE_VOLUME_VERIFIER,
        calendarReference: { source: authority.calendarSource,
            sourceVersion: authority.calendarSourceVersion },
        minuteCoverage: { expectedMinuteCount: 270, canonicalMinuteCount: 270,
            firstMinute: '09:01', lastMinute: '13:30',
            knownZeroCarryForwardCount: normalized.knownZeroMinutes.length },
        knownZeroMinutes: normalized.knownZeroMinutes,
        closeMode: normalized.closeMode,
        validationChecks: { sourceStructure: 'verified',
            closeTotalCheck: finalVolumeAuthority ? 'matched' : 'not_observed',
            independentReconciliation: finalVolumeAuthority !== null,
            refetchCheck: 'not_requested' },
        finalVolumeReconciliation: finalVolumeAuthority ? {
            matched: true, expectedVolumeCommonLot: finalVolumeAuthority.volumeCommonLot,
            actualVolumeCommonLot: cumulative, source: finalVolumeAuthority.source,
            sourceVersion: finalVolumeAuthority.sourceVersion,
            unit: 'common_lot', sessionScope: 'regular_session' } : null,
        provenance: DAILY_MINUTE_VOLUME_PROVENANCE, cumulativeSeries,
        baselineUsable: true, nextApplicableTradeDateOnly: true, ...noAuthority,
    };
    return freeze({ ok: true, manifest: { ...body, manifestId: hashHistoricalKbarValue(body) },
        baselineUsable: true, ...noAuthority });
}

export function isDailyMinuteVolumeBaseline(value) {
    try {
        if (!value || value.schemaVersion !== DAILY_MINUTE_VOLUME_BASELINE_SCHEMA ||
            value.provenance !== DAILY_MINUTE_VOLUME_PROVENANCE || value.baselineUsable !== true ||
            value.nextApplicableTradeDateOnly !== true ||
            !identity(value.symbol, value.exchange) || !date(value.tradeDate) ||
            value.sourceTradeDate !== value.tradeDate || !date(value.targetTradeDate) ||
            value.tradeDate >= value.targetTradeDate || value.timeZone !== 'Asia/Taipei' ||
            value.canonicalUnit !== 'common_lot' || !['common_lot', 'share'].includes(value.sourceUnit) ||
            !text(value.source) || !text(value.sourceVersion) || !instant(value.fetchedAt) ||
            Date.parse(value.fetchedAt) < Date.parse(`${value.tradeDate}T13:34:30+08:00`) ||
            Date.parse(value.fetchedAt) >= Date.parse(`${value.targetTradeDate}T09:01:00+08:00`) ||
            value.timestampEncoding !== DAILY_KBAR_TIMESTAMP_ENCODING ||
            value.verifierVersion !== DAILY_MINUTE_VOLUME_VERIFIER || !HASH.test(value.payloadHash ?? '') ||
            !text(value.calendarReference?.source) || !text(value.calendarReference?.sourceVersion) ||
            !['normal_or_revised_13_30', 'delayed_13_33'].includes(value.closeMode) ||
            Object.keys(noAuthority).some(key => value[key] !== false) ||
            Object.hasOwn(value, 'refetchTime') || Object.hasOwn(value, 'refetchHash') ||
            value.validationChecks?.sourceStructure !== 'verified' ||
            value.validationChecks?.refetchCheck !== 'not_requested' ||
            value.minuteCoverage?.canonicalMinuteCount !== 270 ||
            value.minuteCoverage.expectedMinuteCount !== 270 ||
            value.minuteCoverage.firstMinute !== '09:01' || value.minuteCoverage.lastMinute !== '13:30' ||
            !Array.isArray(value.cumulativeSeries) || value.cumulativeSeries.length !== 270 ||
            value.cumulativeSeries.some((row, i, rows) => row.minuteKey !== MINUTES[i] ||
                !['historical_observed', 'known_zero_carry_forward',
                    'historical_delayed_close_merged', 'historical_delayed_close_bridge'].includes(row.provenance) ||
                !count(row.cumulativeVolume) || (i > 0 && row.cumulativeVolume < rows[i - 1].cumulativeVolume)) ||
            !Array.isArray(value.knownZeroMinutes) ||
            new Set(value.knownZeroMinutes).size !== value.knownZeroMinutes.length ||
            value.minuteCoverage.knownZeroCarryForwardCount !== value.knownZeroMinutes.length ||
            value.knownZeroMinutes.some(m => !MINUTES.includes(m)) ||
            value.cumulativeSeries.some((row, i, rows) =>
                (row.provenance === 'known_zero_carry_forward') !== value.knownZeroMinutes.includes(row.minuteKey) ||
                (row.provenance === 'known_zero_carry_forward' &&
                    row.cumulativeVolume !== (rows[i - 1]?.cumulativeVolume ?? 0)))) {
            return false;
        }
        const total = value.finalVolumeReconciliation;
        if (total === null) {
            if (value.validationChecks.closeTotalCheck !== 'not_observed' ||
                value.validationChecks.independentReconciliation !== false ||
                value.minuteCoverage.knownZeroCarryForwardCount !== 0) return false;
        } else if (total?.matched !== true || total.unit !== 'common_lot' ||
            total.sessionScope !== 'regular_session' || !text(total.source) || !text(total.sourceVersion) ||
            !count(total.actualVolumeCommonLot) || total.actualVolumeCommonLot !== total.expectedVolumeCommonLot ||
            total.actualVolumeCommonLot !== value.cumulativeSeries.at(-1).cumulativeVolume ||
            value.validationChecks.closeTotalCheck !== 'matched' ||
            value.validationChecks.independentReconciliation !== true) return false;
        const { manifestId, ...body } = value;
        return HASH.test(manifestId ?? '') && manifestId === hashHistoricalKbarValue(body);
    } catch { return false; }
}

export function resolveDailyMinuteVolumeBaseline({ symbol, exchange, sourceTradeDate,
    targetTradeDate, v2 = [], legacy = [] } = {}) {
    const matching = values => values.filter(m => m?.symbol === symbol && m.exchange === exchange &&
        m.tradeDate === sourceTradeDate && m.targetTradeDate === targetTradeDate);
    const newer = matching(v2), older = matching(legacy);
    if (newer.some(m => !isDailyMinuteVolumeBaseline(m)) ||
        older.some(m => !isHistoricalKbarBaselineManifest(m))) {
        return { state: 'waiting_baseline', reason: 'baseline_invalid', manifest: null };
    }
    const candidates = [...newer, ...older];
    const series = new Set(candidates.map(m => hashHistoricalKbarValue(m.cumulativeSeries.map(
        ({ minuteKey, cumulativeVolume }) => ({ minuteKey, cumulativeVolume })))));
    if (series.size > 1) return { state: 'waiting_baseline', reason: 'baseline_source_conflict', manifest: null };
    const ids = new Set(newer.map(m => m.manifestId));
    if (ids.size > 1) return { state: 'waiting_baseline', reason: 'baseline_source_conflict', manifest: null };
    const manifest = newer[0] ?? older[0] ?? null;
    return { state: manifest ? 'baseline_ready' : 'waiting_baseline',
        reason: manifest ? null : 'baseline_missing', manifest };
}
