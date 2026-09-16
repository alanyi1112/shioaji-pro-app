import { types as utilTypes } from 'node:util';

export const TAIWAN_REGULAR_SESSION_CALENDAR_SCHEMA =
    'taiwan-regular-session-calendar/1';
export const TAIWAN_REGULAR_SESSION_AUTHORITY_SCHEMA =
    'taiwan-regular-session-authority/1';
export const INTRADAY_MONITOR_OBSERVATION_SCHEMA =
    'intraday-monitor-observation/1';
export const INTRADAY_MONITOR_MINUTE_ACCUMULATOR_SCHEMA =
    'intraday-monitor-minute-accumulator/1';
export const INTRADAY_MONITOR_FUTURE_SKEW_MS = 2_000;

const CALENDAR_KEYS = Object.freeze([
    'schemaVersion',
    'exchange',
    'tradeDate',
    'officialTradingDates',
    'generatedAtEpochMs',
    'validUntilEpochMs',
    'sourceVersion',
    'sessionState',
    'timeZone',
]);
const OBSERVATION_KEYS = Object.freeze([
    'schemaVersion',
    'contract',
    'tradeDate',
    'minuteKey',
    'exchangeTime',
    'receivedTime',
    'connectionGeneration',
    'sequence',
    'cumulativeVolume',
    'unit',
    'source',
    'sourceVersion',
    'simtrade',
    'intradayOdd',
    'continuity',
]);
const CONTRACT_KEYS = Object.freeze([
    'securityType',
    'region',
    'exchange',
    'code',
    'targetCode',
    'canonicalSymbol',
]);
const DISCONNECT_KEYS = Object.freeze(['connectionGeneration']);
const REPLACE_KEYS = Object.freeze(['connectionGeneration']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MINUTE = /^(?:09:[0-5]\d|1[0-2]:[0-5]\d|13:(?:[0-2]\d|30))$/;
const EXCHANGE_TIME = /^\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const issuedCalendarAuthorities = new WeakMap();

function isProxy(value) {
    try {
        return utilTypes.isProxy(value);
    } catch {
        return true;
    }
}

function exactSnapshot(value, keys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || isProxy(value)) {
        throw new TypeError(`${label} schema is invalid`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    const expected = [...keys].sort();
    if (actual.some((key) => typeof key !== 'string')) {
        throw new TypeError(`${label} symbol properties are forbidden`);
    }
    actual.sort();
    if (actual.length !== expected.length || !actual.every((key, index) => key === expected[index])) {
        throw new TypeError(`${label} schema is invalid`);
    }
    const output = {};
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set')) {
            throw new TypeError(`${label} must use enumerable data properties`);
        }
        output[key] = descriptor.value;
    }
    return Object.freeze(output);
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function safeEpoch(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} is invalid`);
    return value;
}

function validDate(value) {
    if (typeof value !== 'string' || !DATE.test(value)) return false;
    return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function normalizeContract(value, exchange) {
    const input = exactSnapshot(value, CONTRACT_KEYS, 'observation contract');
    const suffix = exchange === 'TSE' ? 'TW' : 'TWO';
    if (
        input.securityType !== 'STK' ||
        input.region !== 'TW' ||
        input.exchange !== exchange ||
        input.targetCode !== null ||
        typeof input.code !== 'string' ||
        !/^\d{4,6}[A-Z]?$/.test(input.code) ||
        input.canonicalSymbol !== `${input.code}.${suffix}`
    ) {
        throw new TypeError('observation contract is unsupported');
    }
    return Object.freeze({ ...input });
}

function minuteNumber(key) {
    const [hour, minute] = key.split(':').map(Number);
    return hour * 60 + minute;
}

function minuteKey(value) {
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function sessionMinutesThrough(watermark) {
    if (watermark === null) return [];
    const end = minuteNumber(watermark);
    const output = [];
    for (let minute = 9 * 60; minute <= end; minute += 1) {
        output.push(minuteKey(minute));
    }
    return output;
}

function taipeiParts(epochMs) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(epochMs));
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
        tradeDate: `${map.year}-${map.month}-${map.day}`,
        hour: Number(map.hour),
        minute: Number(map.minute),
        second: Number(map.second),
    };
}

export function issueTaiwanRegularSessionAuthority(value, nowEpochMs) {
    let input;
    try {
        input = exactSnapshot(value, CALENDAR_KEYS, 'regular-session calendar');
        const now = safeEpoch(nowEpochMs, 'nowEpochMs');
        if (
            input.schemaVersion !== TAIWAN_REGULAR_SESSION_CALENDAR_SCHEMA ||
            !['TSE', 'OTC'].includes(input.exchange) ||
            !validDate(input.tradeDate) ||
            !Array.isArray(input.officialTradingDates) ||
            input.officialTradingDates.length < 2 ||
            input.officialTradingDates.some((date) => !validDate(date)) ||
            new Set(input.officialTradingDates).size !== input.officialTradingDates.length ||
            [...input.officialTradingDates].sort().some((date, index) => date !== input.officialTradingDates[index]) ||
            !input.officialTradingDates.includes(input.tradeDate) ||
            !Number.isSafeInteger(input.generatedAtEpochMs) ||
            !Number.isSafeInteger(input.validUntilEpochMs) ||
            input.generatedAtEpochMs > now ||
            input.validUntilEpochMs <= now ||
            !HASH.test(input.sourceVersion) ||
            !['pre_open', 'open', 'closed'].includes(input.sessionState) ||
            input.timeZone !== 'Asia/Taipei'
        ) {
            throw new TypeError('regular-session calendar is invalid');
        }
        const position = input.officialTradingDates.indexOf(input.tradeDate);
        if (position < 1) throw new TypeError('previous official trading day is missing');
        const projection = deepFreeze({
            ...input,
            previousTradeDate: input.officialTradingDates[position - 1],
            officialTradingDates: [...input.officialTradingDates],
        });
        const handle = deepFreeze({
            issued: true,
            schemaVersion: TAIWAN_REGULAR_SESSION_AUTHORITY_SCHEMA,
            exchange: input.exchange,
            tradeDate: input.tradeDate,
            previousTradeDate: projection.previousTradeDate,
            validUntilEpochMs: input.validUntilEpochMs,
            sessionState: input.sessionState,
            timeZone: 'Asia/Taipei',
            providerRequestAuthority: false,
            brokerWriteAuthority: false,
        });
        issuedCalendarAuthorities.set(handle, projection);
        return handle;
    } catch (error) {
        return deepFreeze({
            issued: false,
            reasons: [error instanceof Error ? error.message : 'calendar_invalid'],
            providerRequestAuthority: false,
            brokerWriteAuthority: false,
        });
    }
}

export function completedMinuteWatermark(authority, nowEpochMs) {
    const projection = issuedCalendarAuthorities.get(authority);
    if (!projection) return null;
    const now = safeEpoch(nowEpochMs, 'nowEpochMs');
    if (now >= projection.validUntilEpochMs) return null;
    if (projection.sessionState === 'pre_open') return null;
    if (projection.sessionState === 'closed') return '13:30';
    const local = taipeiParts(now);
    if (local.tradeDate !== projection.tradeDate) return null;
    const currentMinute = local.hour * 60 + local.minute;
    const completed = Math.min(13 * 60 + 29, currentMinute - 1);
    return completed < 9 * 60 ? null : minuteKey(completed);
}

export function createIntradayMonitorMinuteAccumulator({
    sessionAuthority,
    connectionGeneration,
    nowEpochMs = () => Date.now(),
    futureSkewMs = INTRADAY_MONITOR_FUTURE_SKEW_MS,
} = {}) {
    const session = issuedCalendarAuthorities.get(sessionAuthority);
    if (!session) throw new TypeError('issued session authority is required');
    if (typeof connectionGeneration !== 'string' || connectionGeneration.length < 16 || connectionGeneration.length > 128) {
        throw new TypeError('connectionGeneration is invalid');
    }
    if (typeof nowEpochMs !== 'function' || isProxy(nowEpochMs) || !Number.isSafeInteger(futureSkewMs) || futureSkewMs < 0 || futureSkewMs > 10_000) {
        throw new TypeError('minute accumulator options are invalid');
    }
    const symbols = new Map();
    const rejectionCounts = new Map();
    let generation = connectionGeneration;
    let connected = true;
    let acceptedCount = 0;
    let lastNow = -1;
    let clockInvalid = false;

    function currentNow() {
        if (clockInvalid) return undefined;
        const value = Reflect.apply(nowEpochMs, undefined, []);
        if (!Number.isSafeInteger(value) || value < 0 || value < lastNow) {
            clockInvalid = true;
            return undefined;
        }
        lastNow = value;
        return value;
    }

    function reject(reason) {
        rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
        return deepFreeze({ accepted: false, reason, brokerWriteAuthority: false });
    }

    function registerContract(value) {
        let contract;
        try {
            contract = normalizeContract(value, session.exchange);
        } catch {
            return reject('invalid_contract');
        }
        if (!symbols.has(contract.canonicalSymbol)) {
            symbols.set(contract.canonicalSymbol, {
                contract,
                headSequence: 0,
                headCumulativeVolume: null,
                observations: new Map(),
                rows: new Map(),
                continuityProven: false,
                observationMode: null,
            });
        }
        return deepFreeze({ accepted: true, canonicalSymbol: contract.canonicalSymbol, brokerWriteAuthority: false });
    }

    function recordObservation(value) {
        let input;
        try {
            input = exactSnapshot(value, OBSERVATION_KEYS, 'minute observation');
        } catch {
            return reject('invalid_observation');
        }
        if (input.schemaVersion !== INTRADAY_MONITOR_OBSERVATION_SCHEMA) return reject('invalid_observation');
        let contract;
        try {
            contract = normalizeContract(input.contract, session.exchange);
        } catch {
            return reject('invalid_contract');
        }
        const state = symbols.get(contract.canonicalSymbol);
        if (!state) return reject('symbol_not_registered');
        if (!connected) return reject('stream_disconnected');
        if (input.connectionGeneration !== generation) return reject('stale_generation');
        if (input.tradeDate !== session.tradeDate) return reject('cross_date');
        if (typeof input.exchangeTime !== 'string' || !EXCHANGE_TIME.test(input.exchangeTime) || typeof input.minuteKey !== 'string' || !MINUTE.test(input.minuteKey) || input.exchangeTime.slice(0, 5) !== input.minuteKey) return reject('invalid_exchange_time');
        const exchangeEpochMs = Date.parse(`${input.tradeDate}T${input.exchangeTime}+08:00`);
        const receivedEpochMs = Date.parse(input.receivedTime);
        const now = currentNow();
        if (!Number.isFinite(exchangeEpochMs) || !Number.isFinite(receivedEpochMs) || now === undefined || exchangeEpochMs > now + futureSkewMs || receivedEpochMs > now + futureSkewMs || receivedEpochMs < exchangeEpochMs) return reject('future_or_invalid_time');
        if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) return reject('invalid_sequence');
        if (input.sequence === state.headSequence) return reject('duplicate_sequence');
        if (input.sequence < state.headSequence) return reject('backward_sequence');
        if (!Number.isSafeInteger(input.cumulativeVolume) || input.cumulativeVolume < 0) return reject('invalid_cumulative_volume');
        if (state.headCumulativeVolume !== null && input.cumulativeVolume < state.headCumulativeVolume) return reject('cumulative_volume_regression');
        if (input.unit !== 'common_lot') return reject('unknown_unit');
        if (!['shioaji-tick-stk', 'shioaji-kbar-stream'].includes(input.source) || typeof input.sourceVersion !== 'string' || input.sourceVersion.length < 1) return reject('invalid_source');
        const observationMode = input.source === 'shioaji-kbar-stream' ? 'kbar' : 'tick';
        if (state.observationMode !== null && state.observationMode !== observationMode) return reject('source_mode_changed');
        if (input.simtrade !== false) return reject('simtrade_rejected');
        if (input.intradayOdd !== false) return reject('intraday_odd_lot_rejected');
        if (!['complete', 'partial'].includes(input.continuity)) return reject('invalid_continuity');
        state.headSequence = input.sequence;
        state.headCumulativeVolume = input.cumulativeVolume;
        state.continuityProven = input.continuity === 'complete';
        state.observationMode = observationMode;
        const prior = state.observations.get(input.minuteKey);
        if (!prior || prior.sequence < input.sequence) {
            state.observations.set(input.minuteKey, deepFreeze({ ...input, contract }));
            for (const completedKey of [...state.rows.keys()]) {
                if (completedKey >= input.minuteKey) state.rows.delete(completedKey);
            }
        }
        acceptedCount += 1;
        return deepFreeze({ accepted: true, reason: 'none', canonicalSymbol: contract.canonicalSymbol, sequence: input.sequence, continuityComplete: state.continuityProven, brokerWriteAuthority: false });
    }

    function flushCompleted() {
        const now = currentNow();
        if (now === undefined) return reject('clock_invalid');
        const watermark = completedMinuteWatermark(sessionAuthority, now);
        if (watermark === null) return deepFreeze({ allowed: false, reason: 'completed_minute_unavailable', rows: [], brokerWriteAuthority: false });
        const minutes = sessionMinutesThrough(watermark);
        const output = [];
        for (const state of symbols.values()) {
            let carried = null;
            const stateMinutes = state.observationMode === 'kbar'
                ? minutes.filter((key) => key !== '09:00')
                : minutes;
            for (const key of stateMinutes) {
                if (state.rows.has(key)) {
                    const existing = state.rows.get(key);
                    if (existing.completeness === 'complete') carried = existing.cumulativeVolume;
                    else carried = null;
                    output.push(existing);
                    continue;
                }
                const observation = state.observations.get(key);
                let row;
                if (observation) {
                    const complete = observation.continuity === 'complete';
                    row = deepFreeze({
                        canonicalSymbol: state.contract.canonicalSymbol,
                        tradeDate: session.tradeDate,
                        minuteKey: key,
                        cumulativeVolume: observation.cumulativeVolume,
                        provenance: complete ? (observation.cumulativeVolume === 0 ? 'known_zero' : 'observed') : 'observed_partial',
                        completeness: complete ? 'complete' : 'incomplete',
                        sequence: observation.sequence,
                        connectionGeneration: generation,
                    });
                    carried = complete ? observation.cumulativeVolume : null;
                } else if (carried !== null && connected && state.observationMode !== 'kbar') {
                    row = deepFreeze({
                        canonicalSymbol: state.contract.canonicalSymbol,
                        tradeDate: session.tradeDate,
                        minuteKey: key,
                        cumulativeVolume: carried,
                        provenance: 'carry_forward',
                        completeness: 'complete',
                        sequence: state.headSequence,
                        connectionGeneration: generation,
                    });
                } else {
                    row = deepFreeze({
                        canonicalSymbol: state.contract.canonicalSymbol,
                        tradeDate: session.tradeDate,
                        minuteKey: key,
                        cumulativeVolume: null,
                        provenance: 'missing',
                        completeness: 'missing',
                        sequence: null,
                        connectionGeneration: generation,
                    });
                }
                state.rows.set(key, row);
                output.push(row);
            }
        }
        return deepFreeze({ allowed: true, watermark, rows: output, brokerWriteAuthority: false });
    }

    function markDisconnected(value) {
        let input;
        try { input = exactSnapshot(value, DISCONNECT_KEYS, 'minute disconnect'); } catch { return reject('disconnect_schema_invalid'); }
        if (!connected || input.connectionGeneration !== generation) return reject('stale_generation');
        connected = false;
        for (const state of symbols.values()) state.continuityProven = false;
        return deepFreeze({ accepted: true, reason: 'stream_disconnected', brokerWriteAuthority: false });
    }

    function replaceConnection(value) {
        let input;
        try { input = exactSnapshot(value, REPLACE_KEYS, 'minute connection replacement'); } catch { return reject('connection_replacement_schema_invalid'); }
        if (typeof input.connectionGeneration !== 'string' || input.connectionGeneration.length < 16 || input.connectionGeneration === generation) return reject('connection_generation_not_advanced');
        generation = input.connectionGeneration;
        connected = true;
        for (const state of symbols.values()) {
            state.headSequence = 0;
            state.headCumulativeVolume = null;
            state.continuityProven = false;
            state.observations.clear();
        }
        return deepFreeze({ accepted: true, reason: 'connection_generation_replaced', connectionGeneration: generation, brokerWriteAuthority: false });
    }

    function status() {
        return deepFreeze({
            schemaVersion: INTRADAY_MONITOR_MINUTE_ACCUMULATOR_SCHEMA,
            tradeDate: session.tradeDate,
            previousTradeDate: session.previousTradeDate,
            exchange: session.exchange,
            connectionGeneration: generation,
            connected,
            registeredSymbolCount: symbols.size,
            acceptedObservationCount: acceptedCount,
            rejectionCounts: Object.fromEntries([...rejectionCounts.entries()].sort()),
            completedMinuteWatermark: currentNow() === undefined ? null : completedMinuteWatermark(sessionAuthority, lastNow),
            clockInvalid,
            pollingFallbackAllowed: false,
            providerRequestAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    return Object.freeze({ registerContract, recordObservation, flushCompleted, markDisconnected, replaceConnection, status });
}
