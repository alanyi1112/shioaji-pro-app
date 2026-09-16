import { types as utilTypes } from 'node:util';
import { INTRADAY_MONITOR_OBSERVATION_SCHEMA } from './minute-accumulator.mjs';

export const INTRADAY_MONITOR_KBAR_EVENT_SCHEMA = 'intraday-monitor-kbar-event/1';
export const INTRADAY_MONITOR_KBAR_ADAPTER_SCHEMA = 'intraday-monitor-kbar-adapter/1';
export const INTRADAY_MONITOR_KBAR_CLOSE_AUTHORITY_SCHEMA = 'intraday-monitor-kbar-close-authority/1';
export const INTRADAY_MONITOR_KBAR_PILOT_LIMIT = 20;
export const INTRADAY_MONITOR_KBAR_STAGE_LIMIT = 160;
export const INTRADAY_MONITOR_NORMAL_CLOSE_MINUTE = '13:30';
export const INTRADAY_MONITOR_DELAYED_CLOSE_MINUTE = '13:33';
export const INTRADAY_MONITOR_CLOSE_FINALIZATION_TIME = '13:34:30';
const issuedCloseAuthorities = new WeakMap();

const EVENT_KEYS = Object.freeze([
    'schemaVersion', 'code', 'date', 'time', 'volume', 'receivedTime',
    'connectionGeneration', 'unit', 'sourceVersion',
]);
const CONTRACT_KEYS = Object.freeze([
    'securityType', 'region', 'exchange', 'code', 'targetCode', 'canonicalSymbol',
]);

function isProxy(value) {
    try { return utilTypes.isProxy(value); } catch { return true; }
}

function exactRecord(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || isProxy(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors).sort();
    const expected = [...keys].sort();
    if (actual.some((key) => typeof key !== 'string') || actual.length !== expected.length ||
        !actual.every((key, index) => key === expected[index])) return null;
    const output = {};
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set')) return null;
        output[key] = descriptor.value;
    }
    return output;
}

function normalizeContract(value) {
    const input = exactRecord(value, CONTRACT_KEYS);
    if (!input || input.securityType !== 'STK' || input.region !== 'TW' ||
        !['TSE', 'OTC'].includes(input.exchange) || !/^\d{4,6}[A-Z]?$/.test(input.code) ||
        input.targetCode !== null) return null;
    const suffix = input.exchange === 'TSE' ? 'TW' : 'TWO';
    if (input.canonicalSymbol !== `${input.code}.${suffix}`) return null;
    return Object.freeze({ ...input });
}

function minuteNumber(key) {
    const [hour, minute] = key.split(':').map(Number);
    return hour * 60 + minute;
}

function isRegularKbarMinute(key) {
    const value = minuteNumber(key);
    return value >= 9 * 60 + 1 && value <= 13 * 60 + 30;
}

function reject(reason) {
    return Object.freeze({ accepted: false, reason, brokerWriteAuthority: false });
}

function taipeiParts(epochMs) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epochMs));
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return { tradeDate: `${map.year}-${map.month}-${map.day}`, minuteOfDay: Number(map.hour) * 60 + Number(map.minute) };
}

export function issueIntradayMonitorKbarSessionCloseAuthority({ tradeDate, observedAtEpochMs, timeZone } = {}, nowEpochMs) {
    const now = Number(nowEpochMs);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') || timeZone !== 'Asia/Taipei' ||
        !Number.isSafeInteger(observedAtEpochMs) || !Number.isSafeInteger(now) || observedAtEpochMs > now) {
        return reject('close_authority_invalid');
    }
    const local = taipeiParts(observedAtEpochMs);
    const finalizationEpochMs = Date.parse(`${tradeDate}T${INTRADAY_MONITOR_CLOSE_FINALIZATION_TIME}+08:00`);
    if (local.tradeDate !== tradeDate || observedAtEpochMs < finalizationEpochMs) return reject('session_not_closed');
    const authority = Object.freeze({ issued: true, schemaVersion: INTRADAY_MONITOR_KBAR_CLOSE_AUTHORITY_SCHEMA,
        tradeDate, observedAt: new Date(observedAtEpochMs).toISOString(), timeZone: 'Asia/Taipei',
        normalCloseMinute: INTRADAY_MONITOR_NORMAL_CLOSE_MINUTE,
        delayedCloseMinute: INTRADAY_MONITOR_DELAYED_CLOSE_MINUTE,
        finalizationTime: INTRADAY_MONITOR_CLOSE_FINALIZATION_TIME,
        brokerWriteAuthority: false, serviceLifecycleAuthority: false });
    issuedCloseAuthorities.set(authority, Object.freeze({ tradeDate, observedAt: authority.observedAt }));
    return authority;
}

export function createIntradayMonitorKbarStreamAdapter({
    cohort,
    tradeDate,
    connectionGeneration,
    observationSink,
    nowEpochMs = () => Date.now(),
    futureSkewMs = 2_000,
    maximumCohortSize = INTRADAY_MONITOR_KBAR_PILOT_LIMIT,
} = {}) {
    if (![INTRADAY_MONITOR_KBAR_PILOT_LIMIT, INTRADAY_MONITOR_KBAR_STAGE_LIMIT].includes(maximumCohortSize) ||
        !Array.isArray(cohort) || cohort.length < 1 || cohort.length > maximumCohortSize ||
        !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') ||
        typeof connectionGeneration !== 'string' || connectionGeneration.length < 16 ||
        connectionGeneration.length > 128 || typeof observationSink !== 'function' || isProxy(observationSink) ||
        typeof nowEpochMs !== 'function' || isProxy(nowEpochMs) || !Number.isSafeInteger(futureSkewMs) ||
        futureSkewMs < 0 || futureSkewMs > 10_000) {
        throw new TypeError('kbar adapter options are invalid');
    }
    const contracts = cohort.map(normalizeContract);
    if (contracts.some((item) => !item) || new Set(contracts.map((item) => item.code)).size !== contracts.length) {
        throw new TypeError('kbar cohort is invalid');
    }
    const states = new Map(contracts.map((contract) => [contract.code, {
        contract,
        forming: null,
        sealedMinute: null,
        cumulativeVolume: 0,
        sequence: 0,
        delayedClose: null,
        closeMode: 'pending',
        degraded: false,
        reason: 'awaiting_first_kbar',
    }]));
    const rejectionCounts = new Map();
    let connected = true;
    let lastNow = -1;

    function currentNow() {
        const value = Reflect.apply(nowEpochMs, undefined, []);
        if (!Number.isSafeInteger(value) || value < 0 || value < lastNow) return null;
        lastNow = value;
        return value;
    }

    function decline(reason) {
        rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
        return reject(reason);
    }

    function accept(value) {
        const input = exactRecord(value, EVENT_KEYS);
        if (!input || input.schemaVersion !== INTRADAY_MONITOR_KBAR_EVENT_SCHEMA) return decline('invalid_event');
        const state = states.get(String(input.code));
        if (!state) return decline('cohort_symbol_unknown');
        if (!connected) return decline('stream_disconnected');
        if (input.connectionGeneration !== connectionGeneration) return decline('stale_generation');
        const normalizedDate = typeof input.date === 'string' ? input.date.replaceAll('/', '-') : '';
        if (normalizedDate !== tradeDate) return decline('cross_date');
        if (typeof input.time !== 'string' || !/^\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(input.time)) {
            return decline('invalid_bar_time');
        }
        const minuteKey = input.time.slice(0, 5);
        const isDelayedCloseKbar = minuteKey === INTRADAY_MONITOR_DELAYED_CLOSE_MINUTE;
        if (!isRegularKbarMinute(minuteKey) && !isDelayedCloseKbar) return decline('outside_regular_session');
        if (!Number.isSafeInteger(input.volume) || input.volume < 0) return decline('invalid_volume');
        if (input.unit !== 'common_lot') return decline('unknown_unit');
        if (typeof input.sourceVersion !== 'string' || input.sourceVersion.length < 1 || input.sourceVersion.length > 128) {
            return decline('invalid_source_version');
        }
        const receivedEpochMs = Date.parse(input.receivedTime);
        const barEpochMs = Date.parse(`${tradeDate}T${input.time}+08:00`);
        const now = currentNow();
        if (!Number.isFinite(receivedEpochMs) || !Number.isFinite(barEpochMs) || now === null ||
            barEpochMs > receivedEpochMs + futureSkewMs || receivedEpochMs > now + futureSkewMs) {
            return decline('invalid_received_time');
        }
        if (state.degraded) return decline('symbol_degraded');
        if (isDelayedCloseKbar) {
            const hasRegularCloseForming = state.forming?.minuteKey === INTRADAY_MONITOR_NORMAL_CLOSE_MINUTE &&
                state.sealedMinute === '13:29';
            const hasPreCloseForming = state.forming?.minuteKey === '13:29' && state.sealedMinute === '13:28';
            if (!hasRegularCloseForming && !hasPreCloseForming) {
                state.degraded = true;
                state.reason = 'delayed_close_without_regular_close_sequence';
                return decline('delayed_close_without_regular_close_sequence');
            }
            if (hasPreCloseForming) {
                const cumulativeVolume = state.cumulativeVolume + state.forming.volume;
                if (!Number.isSafeInteger(cumulativeVolume)) {
                    state.degraded = true;
                    state.reason = 'cumulative_volume_overflow';
                    return decline('cumulative_volume_overflow');
                }
                const nextSequence = state.sequence + 1;
                const observation = Object.freeze({
                    schemaVersion: INTRADAY_MONITOR_OBSERVATION_SCHEMA,
                    contract: state.contract,
                    tradeDate,
                    minuteKey: '13:29',
                    exchangeTime: state.forming.time,
                    receivedTime: input.receivedTime,
                    connectionGeneration,
                    sequence: nextSequence,
                    cumulativeVolume,
                    unit: 'common_lot',
                    source: 'shioaji-kbar-stream',
                    sourceVersion: state.forming.sourceVersion,
                    simtrade: false,
                    intradayOdd: false,
                    continuity: 'complete',
                });
                let sinkResult;
                try { sinkResult = Reflect.apply(observationSink, undefined, [observation]); }
                catch { sinkResult = null; }
                if (sinkResult?.accepted !== true) {
                    state.degraded = true;
                    state.reason = 'observation_sink_rejected';
                    return decline('observation_sink_rejected');
                }
                state.sealedMinute = '13:29';
                state.cumulativeVolume = cumulativeVolume;
                state.sequence = nextSequence;
                state.forming = null;
            }
            const isRevision = Boolean(state.delayedClose);
            if (state.delayedClose) {
                if (input.volume < state.delayedClose.volume) {
                    state.degraded = true;
                    state.reason = 'delayed_close_volume_regression';
                    return decline('delayed_close_volume_regression');
                }
                if (input.volume === state.delayedClose.volume) return decline('duplicate_delayed_close_kbar');
            }
            state.delayedClose = Object.freeze({ minuteKey, time: input.time, volume: input.volume,
                receivedTime: input.receivedTime, sourceVersion: input.sourceVersion });
            state.closeMode = 'delayed_13_33';
            state.reason = 'delayed_close_pending';
            return Object.freeze({ accepted: true,
                reason: isRevision ? 'delayed_close_revised' : 'delayed_close_forming',
                canonicalSymbol: state.contract.canonicalSymbol, sealed: false, brokerWriteAuthority: false });
        }
        if (state.forming?.minuteKey === minuteKey) {
            if (input.volume < state.forming.volume) {
                state.degraded = true;
                state.reason = 'forming_volume_regression';
                return decline('forming_volume_regression');
            }
            if (input.volume === state.forming.volume) return decline('duplicate_forming_kbar');
            state.forming = Object.freeze({ minuteKey, time: input.time, volume: input.volume, receivedTime: input.receivedTime, sourceVersion: input.sourceVersion });
            return Object.freeze({ accepted: true, reason: 'forming_revised', canonicalSymbol: state.contract.canonicalSymbol, sealed: false, brokerWriteAuthority: false });
        }
        if (!state.forming) {
            state.forming = Object.freeze({ minuteKey, time: input.time, volume: input.volume, receivedTime: input.receivedTime, sourceVersion: input.sourceVersion });
            state.reason = 'forming';
            return Object.freeze({ accepted: true, reason: 'forming', canonicalSymbol: state.contract.canonicalSymbol, sealed: false, brokerWriteAuthority: false });
        }
        if (minuteNumber(minuteKey) !== minuteNumber(state.forming.minuteKey) + 1) {
            state.degraded = true;
            state.reason = 'kbar_minute_gap';
            return decline('kbar_minute_gap');
        }
        const cumulativeVolume = state.cumulativeVolume + state.forming.volume;
        if (!Number.isSafeInteger(cumulativeVolume)) {
            state.degraded = true;
            state.reason = 'cumulative_volume_overflow';
            return decline('cumulative_volume_overflow');
        }
        const nextSequence = state.sequence + 1;
        const observation = Object.freeze({
            schemaVersion: INTRADAY_MONITOR_OBSERVATION_SCHEMA,
            contract: state.contract,
            tradeDate,
            minuteKey: state.forming.minuteKey,
            exchangeTime: state.forming.time,
            receivedTime: input.receivedTime,
            connectionGeneration,
            sequence: nextSequence,
            cumulativeVolume,
            unit: 'common_lot',
            source: 'shioaji-kbar-stream',
            sourceVersion: state.forming.sourceVersion,
            simtrade: false,
            intradayOdd: false,
            continuity: 'complete',
        });
        let sinkResult;
        try { sinkResult = Reflect.apply(observationSink, undefined, [observation]); }
        catch { sinkResult = null; }
        if (sinkResult?.accepted !== true) {
            state.degraded = true;
            state.reason = 'observation_sink_rejected';
            return decline('observation_sink_rejected');
        }
        const sealedMinute = state.forming.minuteKey;
        state.sealedMinute = sealedMinute;
        state.cumulativeVolume = cumulativeVolume;
        state.sequence = nextSequence;
        state.forming = Object.freeze({ minuteKey, time: input.time, volume: input.volume, receivedTime: input.receivedTime, sourceVersion: input.sourceVersion });
        state.reason = 'forming';
        return Object.freeze({ accepted: true, reason: 'sealed_previous', canonicalSymbol: state.contract.canonicalSymbol,
            sealed: true, sealedMinute, cumulativeVolume, sequence: nextSequence, brokerWriteAuthority: false });
    }

    function markDisconnected(value) {
        const input = exactRecord(value, ['connectionGeneration']);
        if (!input || input.connectionGeneration !== connectionGeneration) return decline('disconnect_generation_mismatch');
        connected = false;
        for (const state of states.values()) {
            state.degraded = true;
            state.reason = 'stream_disconnected';
        }
        return Object.freeze({ accepted: true, brokerWriteAuthority: false });
    }

    function sealSessionClose(authority) {
        const close = issuedCloseAuthorities.get(authority);
        if (!close || close.tradeDate !== tradeDate || !connected) return decline('close_authority_invalid');
        let sealedCount = 0;
        for (const state of states.values()) {
            const hasRegularCloseForming = state.forming?.minuteKey === INTRADAY_MONITOR_NORMAL_CLOSE_MINUTE;
            const hasDelayedCloseOnly = state.delayedClose?.minuteKey === INTRADAY_MONITOR_DELAYED_CLOSE_MINUTE &&
                state.forming === null && state.sealedMinute === '13:29';
            if (state.degraded || (!hasRegularCloseForming && !hasDelayedCloseOnly)) {
                state.degraded = true;
                state.reason = 'close_minute_missing';
                continue;
            }
            const cumulativeVolume = state.cumulativeVolume + (state.forming?.volume ?? 0) + (state.delayedClose?.volume ?? 0);
            const nextSequence = state.sequence + 1;
            if (!Number.isSafeInteger(cumulativeVolume)) {
                state.degraded = true;
                state.reason = 'cumulative_volume_overflow';
                continue;
            }
            const observation = Object.freeze({
                schemaVersion: INTRADAY_MONITOR_OBSERVATION_SCHEMA,
                contract: state.contract,
                tradeDate,
                minuteKey: INTRADAY_MONITOR_NORMAL_CLOSE_MINUTE,
                exchangeTime: state.delayedClose?.time ?? state.forming?.time,
                receivedTime: close.observedAt,
                connectionGeneration,
                sequence: nextSequence,
                cumulativeVolume,
                unit: 'common_lot',
                source: 'shioaji-kbar-stream',
                sourceVersion: state.delayedClose?.sourceVersion ?? state.forming?.sourceVersion,
                simtrade: false,
                intradayOdd: false,
                continuity: 'complete',
            });
            let sinkResult;
            try { sinkResult = Reflect.apply(observationSink, undefined, [observation]); }
            catch { sinkResult = null; }
            if (sinkResult?.accepted !== true) {
                state.degraded = true;
                state.reason = 'observation_sink_rejected';
                continue;
            }
            state.sealedMinute = INTRADAY_MONITOR_NORMAL_CLOSE_MINUTE;
            state.cumulativeVolume = cumulativeVolume;
            state.sequence = nextSequence;
            state.forming = null;
            state.closeMode = state.delayedClose ? 'delayed_13_33' : 'normal_or_revised_13_30';
            state.delayedClose = null;
            state.reason = 'session_closed';
            sealedCount += 1;
        }
        return Object.freeze({ accepted: sealedCount === states.size, sealedCount, expectedCount: states.size,
            reason: sealedCount === states.size ? 'session_closed' : 'close_incomplete',
            normalCloseMinute: INTRADAY_MONITOR_NORMAL_CLOSE_MINUTE,
            delayedCloseMinute: INTRADAY_MONITOR_DELAYED_CLOSE_MINUTE,
            finalizedAt: close.observedAt,
            brokerWriteAuthority: false });
    }

    function status() {
        return Object.freeze({
            schemaVersion: INTRADAY_MONITOR_KBAR_ADAPTER_SCHEMA,
            tradeDate,
            connectionGeneration,
            cohortSize: states.size,
            connected,
            symbols: Object.freeze([...states.values()].map((state) => Object.freeze({
                canonicalSymbol: state.contract.canonicalSymbol,
                formingMinute: state.forming?.minuteKey ?? null,
                delayedCloseMinute: state.delayedClose?.minuteKey ?? null,
                sealedMinute: state.sealedMinute,
                cumulativeVolume: state.cumulativeVolume,
                sequence: state.sequence,
                closeMode: state.closeMode,
                degraded: state.degraded,
                reason: state.reason,
            }))),
            rejectionCounts: Object.freeze(Object.fromEntries([...rejectionCounts.entries()].sort())),
            providerPhysicalUsage: null,
            pollingFallbackAllowed: false,
            brokerWriteAuthority: false,
            productionAuthority: false,
            serviceLifecycleAuthority: false,
        });
    }

    return Object.freeze({ accept, markDisconnected, sealSessionClose, status });
}
