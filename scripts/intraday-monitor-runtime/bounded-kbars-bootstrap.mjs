import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';
import {
    INTRADAY_MONITOR_BASELINE_SCHEMA,
    INTRADAY_MONITOR_BOOTSTRAP_MANIFEST_SCHEMA,
    INTRADAY_MONITOR_OBSERVATION_SCHEMA,
} from '../../src/lib/intraday-relative-volume-monitor-domain.ts';
import { completedMinuteWatermark } from './minute-accumulator.mjs';
import { createIntradayRelativeVolumeTriggerLedger } from './relative-volume-evaluator.mjs';

export const INTRADAY_MONITOR_BOOTSTRAP_POLICY_SCHEMA =
    'intraday-monitor-bootstrap-policy/1';
export const INTRADAY_MONITOR_BOOTSTRAP_RESULT_SCHEMA =
    'intraday-monitor-bootstrap-result/1';
export const INTRADAY_MONITOR_BOOTSTRAP_REQUEST_SPACING_MS = 260;
export const INTRADAY_MONITOR_BOOTSTRAP_REQUEST_TIMEOUT_MS = 8_000;
export const INTRADAY_MONITOR_BOOTSTRAP_TOTAL_DEADLINE_MS = 75_000;
export const INTRADAY_MONITOR_BOOTSTRAP_MAX_CONTRACTS = 200;

const POLICY_KEYS = Object.freeze([
    'schemaVersion',
    'simulation',
    'source',
    'sourceVersion',
    'requestSpacingMs',
    'perRequestTimeoutMs',
    'totalDeadlineMs',
    'maxContracts',
    'periodicPolling',
]);
const RUN_KEYS = Object.freeze([
    'configRevision',
    'items',
    'activationMinuteKey',
]);
const ITEM_KEYS = Object.freeze(['contract', 'enabled', 'effectiveThreshold']);
const THRESHOLD_KEYS = Object.freeze(['decimal']);
const CONTRACT_KEYS = Object.freeze([
    'securityType',
    'region',
    'exchange',
    'code',
    'targetCode',
    'canonicalSymbol',
]);
const KBAR_COLUMNS = Object.freeze([
    'datetime',
    'Open',
    'High',
    'Low',
    'Close',
    'Volume',
    'Amount',
]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MINUTE = /^(?:09:(?:0[1-9]|[1-5]\d)|1[0-2]:[0-5]\d|13:(?:[0-2]\d|30))$/;
const issuedPolicies = new WeakMap();

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function exactSnapshot(value, keys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} schema is invalid`);
    }
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (
        actual.length !== expected.length ||
        !actual.every((key, index) => key === expected[index])
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    return Object.freeze({ ...value });
}

function validDate(value) {
    return (
        typeof value === 'string' &&
        DATE.test(value) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
    );
}

function minuteNumber(value) {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
}

function minuteKey(value) {
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function minuteRange(end) {
    if (typeof end !== 'string' || !MINUTE.test(end)) {
        throw new TypeError('completed minute is invalid');
    }
    const output = [];
    for (let minute = 9 * 60 + 1; minute <= minuteNumber(end); minute += 1) {
        output.push(minuteKey(minute));
    }
    return output;
}

function payloadHash(value) {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function normalizeContract(value) {
    const input = exactSnapshot(value, CONTRACT_KEYS, 'bootstrap contract');
    const suffix = input.exchange === 'TSE' ? 'TW' : 'TWO';
    if (
        input.securityType !== 'STK' ||
        input.region !== 'TW' ||
        !['TSE', 'OTC'].includes(input.exchange) ||
        input.targetCode !== null ||
        typeof input.code !== 'string' ||
        !/^\d{4,6}[A-Z]?$/.test(input.code) ||
        input.canonicalSymbol !== `${input.code}.${suffix}`
    ) {
        throw new TypeError('bootstrap contract is unsupported');
    }
    return input;
}

function normalizeThreshold(value) {
    const input = exactSnapshot(value, THRESHOLD_KEYS, 'bootstrap threshold');
    if (
        typeof input.decimal !== 'string' ||
        !/^(?:[1-9]\d?|100)(?:\.\d{1,2})?$/.test(input.decimal)
    ) {
        throw new TypeError('bootstrap threshold is invalid');
    }
    const [whole, fraction = ''] = input.decimal.split('.');
    const hundredths = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (hundredths < 100 || hundredths > 10_000) {
        throw new TypeError('bootstrap threshold is invalid');
    }
    const canonicalFraction = String(hundredths % 100)
        .padStart(2, '0')
        .replace(/0+$/, '');
    return canonicalFraction
        ? `${Math.floor(hundredths / 100)}.${canonicalFraction}`
        : String(Math.floor(hundredths / 100));
}

function normalizeRun(value, authorityByExchange) {
    const input = exactSnapshot(value, RUN_KEYS, 'bootstrap run');
    if (!Number.isSafeInteger(input.configRevision) || input.configRevision < 0) {
        throw new TypeError('bootstrap config revision is invalid');
    }
    if (
        !Array.isArray(input.items) ||
        input.items.length < 1 ||
        input.items.length > INTRADAY_MONITOR_BOOTSTRAP_MAX_CONTRACTS ||
        typeof input.activationMinuteKey !== 'string' ||
        !MINUTE.test(input.activationMinuteKey)
    ) {
        throw new TypeError('bootstrap run is invalid');
    }
    const seen = new Set();
    const items = input.items
        .map((raw) => {
            const item = exactSnapshot(raw, ITEM_KEYS, 'bootstrap item');
            if (typeof item.enabled !== 'boolean') {
                throw new TypeError('bootstrap item is invalid');
            }
            const contract = normalizeContract(item.contract);
            if (!authorityByExchange.has(contract.exchange)) {
                throw new TypeError('bootstrap session authority is missing');
            }
            if (seen.has(contract.canonicalSymbol)) {
                throw new TypeError('duplicate bootstrap contract');
            }
            seen.add(contract.canonicalSymbol);
            return Object.freeze({
                contract,
                enabled: item.enabled,
                threshold: normalizeThreshold(item.effectiveThreshold),
            });
        })
        .filter((item) => item.enabled);
    if (items.length < 1) throw new TypeError('bootstrap run has no enabled items');
    return Object.freeze({
        configRevision: input.configRevision,
        activationMinuteKey: input.activationMinuteKey,
        items: Object.freeze(items),
    });
}

export function issueIntradayMonitorBootstrapPolicy(value) {
    try {
        const input = exactSnapshot(value, POLICY_KEYS, 'bootstrap policy');
        if (
            input.schemaVersion !== INTRADAY_MONITOR_BOOTSTRAP_POLICY_SCHEMA ||
            input.simulation !== true ||
            input.source !== 'shioaji-kbars' ||
            typeof input.sourceVersion !== 'string' ||
            input.sourceVersion.length < 1 ||
            input.sourceVersion.length > 128 ||
            !Number.isSafeInteger(input.requestSpacingMs) ||
            input.requestSpacingMs < INTRADAY_MONITOR_BOOTSTRAP_REQUEST_SPACING_MS ||
            !Number.isSafeInteger(input.perRequestTimeoutMs) ||
            input.perRequestTimeoutMs < 1 ||
            input.perRequestTimeoutMs > INTRADAY_MONITOR_BOOTSTRAP_REQUEST_TIMEOUT_MS ||
            !Number.isSafeInteger(input.totalDeadlineMs) ||
            input.totalDeadlineMs < input.perRequestTimeoutMs ||
            input.totalDeadlineMs > INTRADAY_MONITOR_BOOTSTRAP_TOTAL_DEADLINE_MS ||
            !Number.isSafeInteger(input.maxContracts) ||
            input.maxContracts < 1 ||
            input.maxContracts > INTRADAY_MONITOR_BOOTSTRAP_MAX_CONTRACTS ||
            input.periodicPolling !== false
        ) {
            throw new TypeError('bootstrap policy is invalid');
        }
        const handle = deepFreeze({
            issued: true,
            schemaVersion: input.schemaVersion,
            simulation: true,
            source: input.source,
            sourceVersion: input.sourceVersion,
            requestSpacingMs: input.requestSpacingMs,
            perRequestTimeoutMs: input.perRequestTimeoutMs,
            totalDeadlineMs: input.totalDeadlineMs,
            maxContracts: input.maxContracts,
            periodicPolling: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
        issuedPolicies.set(handle, input);
        return handle;
    } catch (error) {
        return deepFreeze({
            issued: false,
            reasons: [error instanceof Error ? error.message : 'bootstrap policy is invalid'],
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    }
}

function inspectKbars(body, tradeDate, requestedEnd, coverageVerified) {
    if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        !KBAR_COLUMNS.every((column) => Array.isArray(body[column]))
    ) {
        return { valid: false, reasonCode: 'invalid_payload', rows: [] };
    }
    const lengths = KBAR_COLUMNS.map((column) => body[column].length);
    if (
        !lengths.every((length) => length === lengths[0]) ||
        lengths[0] > 100_000
    ) {
        return { valid: false, reasonCode: 'invalid_payload', rows: [] };
    }
    const raw = [];
    for (let index = 0; index < lengths[0]; index += 1) {
        const datetime = body.datetime[index];
        if (typeof datetime !== 'string' || !datetime.startsWith(`${tradeDate}T`)) {
            continue;
        }
        const key = datetime.slice(11, 16);
        if (key < '09:01' || key > requestedEnd) continue;
        if (
            !MINUTE.test(key) ||
            !Number.isFinite(body.Open[index]) ||
            !Number.isFinite(body.High[index]) ||
            !Number.isFinite(body.Low[index]) ||
            !Number.isFinite(body.Close[index]) ||
            !Number.isSafeInteger(body.Volume[index]) ||
            body.Volume[index] < 0 ||
            !Number.isFinite(body.Amount[index])
        ) {
            return { valid: false, reasonCode: 'invalid_payload', rows: [] };
        }
        raw.push({ minuteKey: key, volume: body.Volume[index] });
    }
    if (
        raw.some(
            (row, index) =>
                index > 0 && row.minuteKey <= raw[index - 1].minuteKey,
        )
    ) {
        return { valid: false, reasonCode: 'invalid_payload', rows: [] };
    }
    const observed = new Map(raw.map((row) => [row.minuteKey, row.volume]));
    let cumulativeVolume = 0;
    const rows = [];
    const expected = minuteRange(requestedEnd);
    if (coverageVerified) {
        for (const key of expected) {
            const volume = observed.get(key);
            if (volume !== undefined) cumulativeVolume += volume;
            rows.push({
                minuteKey: key,
                cumulativeVolume,
                provenance:
                    volume !== undefined
                        ? cumulativeVolume === 0
                            ? 'known_zero'
                            : 'observed'
                        : cumulativeVolume === 0
                          ? 'known_zero'
                          : 'carry_forward',
            });
        }
    } else {
        for (const row of raw) {
            cumulativeVolume += row.volume;
            rows.push({
                minuteKey: row.minuteKey,
                cumulativeVolume,
                provenance: cumulativeVolume === 0 ? 'known_zero' : 'observed',
            });
        }
    }
    return {
        valid: true,
        reasonCode: coverageVerified ? 'none' : 'coverage_unverified',
        rows,
        expectedMinuteCount: expected.length,
        actualMinuteCount: coverageVerified ? expected.length : raw.length,
        actualMinuteStart: rows[0]?.minuteKey ?? null,
        actualMinuteEnd: rows.at(-1)?.minuteKey ?? null,
        completeness: coverageVerified ? 'complete' : 'incomplete',
        coverageReceipt: coverageVerified ? 'verified' : 'unavailable',
    };
}

function emptyInspection(requestedEnd, reasonCode) {
    return {
        valid: false,
        reasonCode,
        rows: [],
        expectedMinuteCount: minuteRange(requestedEnd).length,
        actualMinuteCount: 0,
        actualMinuteStart: null,
        actualMinuteEnd: null,
        completeness: 'incomplete',
        coverageReceipt: 'unavailable',
    };
}

function createManifest({
    kind,
    canonicalSymbol,
    tradeDate,
    requestedEnd,
    inspection,
    sourceVersion,
    fetchedAt,
    activationMinuteKey,
}) {
    const evidence = {
        schemaVersion: INTRADAY_MONITOR_BOOTSTRAP_MANIFEST_SCHEMA,
        kind,
        canonicalSymbol,
        tradeDate,
        timeZone: 'Asia/Taipei',
        source: 'shioaji-kbars',
        sourceVersion,
        sourceUnit: 'common_lot',
        canonicalUnit: 'common_lot',
        requestedMinuteStart: '09:01',
        requestedMinuteEnd: requestedEnd,
        actualMinuteStart: inspection.actualMinuteStart,
        actualMinuteEnd: inspection.actualMinuteEnd,
        expectedMinuteCount: inspection.expectedMinuteCount,
        actualMinuteCount: inspection.actualMinuteCount,
        coverageReceipt: inspection.coverageReceipt,
        completeness: inspection.completeness,
        monitoringEffectiveFrom:
            kind === 'today'
                ? inspection.completeness === 'complete'
                    ? '09:01'
                    : activationMinuteKey
                : null,
        earlierMinutesBackfilled:
            kind === 'today' && inspection.completeness === 'complete',
        reasonCode: inspection.reasonCode,
    };
    return deepFreeze({
        ...evidence,
        payloadHash: payloadHash(evidence),
        fetchedAt,
    });
}

function createBaseline({ canonicalSymbol, tradeDate, inspection, sourceVersion, fetchedAt }) {
    const evidence = {
        schemaVersion: INTRADAY_MONITOR_BASELINE_SCHEMA,
        canonicalSymbol,
        tradeDate,
        timeZone: 'Asia/Taipei',
        source: 'shioaji-kbars',
        sourceVersion,
        sourceUnit: 'common_lot',
        canonicalUnit: 'common_lot',
        expectedMinuteCount: inspection.expectedMinuteCount,
        completeness: inspection.completeness,
        rows: inspection.rows,
    };
    return deepFreeze({
        ...evidence,
        payloadHash: payloadHash(evidence),
        fetchedAt,
    });
}

function createBootstrapObservations({ contract, tradeDate, rows, sourceVersion, fetchedAt }) {
    const generation = `bootstrap_${payloadHash({
        canonicalSymbol: contract.canonicalSymbol,
        tradeDate,
        sourceVersion,
        rows,
    }).slice(0, 48)}`;
    return rows.map((row, index) =>
        deepFreeze({
            schemaVersion: INTRADAY_MONITOR_OBSERVATION_SCHEMA,
            contract,
            tradeDate,
            minuteKey: row.minuteKey,
            exchangeTime: `${row.minuteKey}:59`,
            receivedTime: fetchedAt,
            connectionGeneration: generation,
            sequence: index + 1,
            cumulativeVolume: row.cumulativeVolume,
            unit: 'common_lot',
            source: 'shioaji-kbars-bootstrap',
            sourceVersion,
            simtrade: false,
            intradayOdd: false,
            continuity: 'complete',
        }),
    );
}

function persistResult({ repository, item, baseline, baselineManifest, todayManifest, todayInspection, tradeDate, previousTradeDate, configRevision, sourceVersion, fetchedAt }) {
    let revision = repository.currentRevision();
    revision = repository.putBootstrapBaseline(baseline, revision).revision;
    revision = repository.putBootstrapManifest(baselineManifest, revision).revision;
    revision = repository.putBootstrapManifest(todayManifest, revision).revision;
    const events = [];
    if (
        baseline.completeness === 'complete' &&
        todayInspection.completeness === 'complete'
    ) {
        const observations = createBootstrapObservations({
            contract: item.contract,
            tradeDate,
            rows: todayInspection.rows,
            sourceVersion,
            fetchedAt,
        });
        revision = repository.appendBootstrappedObservations(observations, revision).revision;
        const baselineByMinute = new Map(
            baseline.rows.map((row) => [row.minuteKey, row]),
        );
        const ledger = createIntradayRelativeVolumeTriggerLedger();
        for (const observation of observations) {
            const previous = baselineByMinute.get(observation.minuteKey);
            if (!previous) continue;
            const evaluated = ledger.evaluate({
                admitted: true,
                tradeDate,
                baselineTradeDate: previousTradeDate,
                canonicalSymbol: item.contract.canonicalSymbol,
                exchange: item.contract.exchange,
                minuteKey: observation.minuteKey,
                configRevision,
                threshold: item.threshold,
                currentCumulativeVolume: observation.cumulativeVolume,
                previousCumulativeVolume: previous.cumulativeVolume,
                todayCompleteness: 'complete',
                baselineCompleteness: 'complete',
                calendarCurrent: true,
                sessionCurrent: true,
                generationCurrent: true,
                continuityComplete: true,
                unit: 'common_lot',
                sourceVersion,
                observationMode: 'historical',
                revisionFirstComparable: observation.sequence === 1,
                createdAt: `${tradeDate}T${observation.minuteKey}:59+08:00`,
            });
            if (evaluated.newlyCreated && evaluated.triggerEvent) {
                revision = repository.appendTrigger(evaluated.triggerEvent, revision).revision;
                events.push(evaluated.triggerEvent);
            }
        }
    }
    return { revision, events };
}

async function withHardTimeout(task, timeoutMs, onTimeout) {
    let timer;
    try {
        return await Promise.race([
            task,
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    onTimeout();
                    reject(Object.assign(new Error('request_timeout'), { code: 'request_timeout' }));
                }, timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

export function createIntradayMonitorBoundedKbarsBootstrap({
    policy,
    sessionAuthorities,
    provider,
    repository,
    coverageVerifier = () => false,
    sessionNowEpochMs = () => Date.now(),
    monotonicNowMs = () => performance.now(),
    wallClockIso = () => new Date().toISOString(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
    const policyValue = issuedPolicies.get(policy);
    if (!policyValue) throw new TypeError('issued bootstrap policy is required');
    if (!Array.isArray(sessionAuthorities) || sessionAuthorities.length < 1 || sessionAuthorities.length > 2) {
        throw new TypeError('session authorities are required');
    }
    if (
        !provider ||
        typeof provider.preflight !== 'function' ||
        typeof provider.fetchKbars !== 'function' ||
        !repository ||
        typeof repository.currentRevision !== 'function' ||
        typeof coverageVerifier !== 'function' ||
        typeof sessionNowEpochMs !== 'function' ||
        typeof monotonicNowMs !== 'function' ||
        typeof wallClockIso !== 'function' ||
        typeof sleep !== 'function'
    ) {
        throw new TypeError('bootstrap dependencies are invalid');
    }
    const authorityByExchange = new Map();
    for (const authority of sessionAuthorities) {
        if (
            !authority?.issued ||
            !['TSE', 'OTC'].includes(authority.exchange) ||
            !validDate(authority.tradeDate) ||
            !validDate(authority.previousTradeDate) ||
            completedMinuteWatermark(authority, sessionNowEpochMs()) === null
        ) {
            throw new TypeError('issued current session authority is required');
        }
        authorityByExchange.set(authority.exchange, authority);
    }
    async function run(value) {
        const input = normalizeRun(value, authorityByExchange);
        if (input.items.length > policyValue.maxContracts) {
            throw new TypeError('bootstrap item count exceeds policy');
        }
        const dates = new Set(
            [...authorityByExchange.values()].flatMap((authority) => [
                authority.previousTradeDate,
                authority.tradeDate,
            ]),
        );
        if (dates.size !== 2) throw new TypeError('session authorities disagree');
        const firstAuthority = authorityByExchange.values().next().value;
        const tradeDate = firstAuthority.tradeDate;
        const previousTradeDate = firstAuthority.previousTradeDate;
        const watermarkByExchange = new Map(
            [...authorityByExchange].map(([exchange, authority]) => [
                exchange,
                completedMinuteWatermark(authority, sessionNowEpochMs()),
            ]),
        );
        const startedAt = monotonicNowMs();
        const preflightController = new AbortController();
        let preflight;
        try {
            preflight = await withHardTimeout(
                Promise.resolve(
                    provider.preflight({ signal: preflightController.signal }),
                ),
                Math.min(
                    policyValue.perRequestTimeoutMs,
                    policyValue.totalDeadlineMs,
                ),
                () => preflightController.abort(),
            );
        } catch {
            throw new Error('bootstrap provider preflight failed');
        }
        if (preflight?.simulation !== true || preflight?.sourceVersion !== policyValue.sourceVersion) {
            throw new Error('bootstrap provider preflight failed');
        }
        let nextRequestAt = startedAt;
        const results = [];
        const verifyCoverage = (request) => {
            if (provider.coverageReceiptAvailable !== true) return false;
            try {
                return coverageVerifier(request) === true;
            } catch {
                return false;
            }
        };
        for (const item of input.items) {
            const requestedEnd = watermarkByExchange.get(item.contract.exchange);
            let remaining = policyValue.totalDeadlineMs - (monotonicNowMs() - startedAt);
            let response = null;
            let requestReason = 'none';
            if (remaining <= 0) {
                requestReason = 'total_deadline_exceeded';
            } else {
                const waitMs = Math.max(0, nextRequestAt - monotonicNowMs());
                if (waitMs > 0) await sleep(waitMs);
                remaining = policyValue.totalDeadlineMs - (monotonicNowMs() - startedAt);
                if (remaining <= 0) {
                    requestReason = 'total_deadline_exceeded';
                }
            }
            if (requestReason === 'none') {
                const requestStartedAt = monotonicNowMs();
                const controller = new AbortController();
                try {
                    response = await withHardTimeout(
                        Promise.resolve(
                            provider.fetchKbars({
                                contract: item.contract,
                                start: previousTradeDate,
                                end: tradeDate,
                                signal: controller.signal,
                            }),
                        ),
                        Math.min(policyValue.perRequestTimeoutMs, remaining),
                        () => controller.abort(),
                    );
                    if (response?.ok !== true) requestReason = 'request_failed';
                } catch (error) {
                    requestReason = error?.code === 'request_timeout'
                        ? 'request_timeout'
                        : 'request_failed';
                }
                nextRequestAt = requestStartedAt + policyValue.requestSpacingMs;
            }
            const fetchedAt = wallClockIso();
            const baselineCoverage = response?.ok === true && verifyCoverage({
                contract: item.contract,
                tradeDate: previousTradeDate,
                requestedMinuteStart: '09:01',
                requestedMinuteEnd: '13:30',
                response,
            }) === true;
            const todayCoverage = response?.ok === true && verifyCoverage({
                contract: item.contract,
                tradeDate,
                requestedMinuteStart: '09:01',
                requestedMinuteEnd: requestedEnd,
                response,
            }) === true;
            const baselineInspection = requestReason === 'none'
                ? inspectKbars(response.body, previousTradeDate, '13:30', baselineCoverage)
                : emptyInspection('13:30', requestReason);
            const todayInspection = requestReason === 'none'
                ? inspectKbars(response.body, tradeDate, requestedEnd, todayCoverage)
                : emptyInspection(requestedEnd, requestReason);
            const normalizedBaselineInspection = baselineInspection.valid
                ? baselineInspection
                : emptyInspection('13:30', baselineInspection.reasonCode);
            const normalizedTodayInspection = todayInspection.valid
                ? todayInspection
                : emptyInspection(requestedEnd, todayInspection.reasonCode);
            const baseline = createBaseline({
                canonicalSymbol: item.contract.canonicalSymbol,
                tradeDate: previousTradeDate,
                inspection: normalizedBaselineInspection,
                sourceVersion: policyValue.sourceVersion,
                fetchedAt,
            });
            const baselineManifest = createManifest({
                kind: 'baseline',
                canonicalSymbol: item.contract.canonicalSymbol,
                tradeDate: previousTradeDate,
                requestedEnd: '13:30',
                inspection: normalizedBaselineInspection,
                sourceVersion: policyValue.sourceVersion,
                fetchedAt,
                activationMinuteKey: input.activationMinuteKey,
            });
            const todayManifest = createManifest({
                kind: 'today',
                canonicalSymbol: item.contract.canonicalSymbol,
                tradeDate,
                requestedEnd,
                inspection: normalizedTodayInspection,
                sourceVersion: policyValue.sourceVersion,
                fetchedAt,
                activationMinuteKey: input.activationMinuteKey,
            });
            const persisted = persistResult({
                repository,
                item,
                baseline,
                baselineManifest,
                todayManifest,
                todayInspection: normalizedTodayInspection,
                tradeDate,
                previousTradeDate,
                configRevision: input.configRevision,
                sourceVersion: policyValue.sourceVersion,
                fetchedAt,
            });
            results.push({
                canonicalSymbol: item.contract.canonicalSymbol,
                requestReason,
                baseline: baselineManifest,
                today: todayManifest,
                historicalTriggerIds: persisted.events.map((event) => event.eventId),
            });
        }
        const seed = {
            schemaVersion: INTRADAY_MONITOR_BOOTSTRAP_RESULT_SCHEMA,
            tradeDate,
            previousTradeDate,
            configured: input.items.length,
            baselineComplete: results.filter((result) => result.baseline.completeness === 'complete').length,
            todayBackfilled: results.filter((result) => result.today.earlierMinutesBackfilled).length,
            waitingBaseline: results.filter((result) => result.baseline.completeness !== 'complete').length,
            monitoringEffectiveFromBootstrap: results.filter((result) => result.today.earlierMinutesBackfilled).length,
            monitoringEffectiveFromActivation: results.filter((result) => !result.today.earlierMinutesBackfilled).length,
            historicalTriggerCount: results.reduce((sum, result) => sum + result.historicalTriggerIds.length, 0),
            results,
            requestPolicy: {
                requestSpacingMs: policyValue.requestSpacingMs,
                perRequestTimeoutMs: policyValue.perRequestTimeoutMs,
                totalDeadlineMs: policyValue.totalDeadlineMs,
                periodicPolling: false,
            },
            notificationDispatchAuthority: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        };
        return deepFreeze({ ...seed, resultHash: payloadHash(seed) });
    }

    return Object.freeze({ run });
}

export function createLocalShioajiKbarsBootstrapProvider({
    baseUrl = 'http://127.0.0.1:8080',
    fetchImpl = fetch,
} = {}) {
    const parsed = new URL(baseUrl);
    if (
        parsed.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash ||
        typeof fetchImpl !== 'function'
    ) {
        throw new TypeError('loopback Shioaji baseUrl is required');
    }
    const root = parsed.href.replace(/\/$/, '');
    async function readJson(path, init = {}) {
        const response = await fetchImpl(`${root}${path}`, {
            ...init,
            redirect: 'error',
            headers: {
                accept: 'application/json',
                ...(init.body ? { 'content-type': 'application/json' } : {}),
            },
        });
        const text = await response.text();
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch { body = null; }
        return { ok: response.ok, status: response.status, body };
    }
    return Object.freeze({
        async preflight({ signal } = {}) {
            const response = await readJson('/api/v1/info', { signal });
            return {
                simulation: response.ok && response.body?.simulation === true,
                sourceVersion:
                    response.ok && typeof response.body?.version === 'string'
                        ? response.body.version
                        : null,
            };
        },
        async fetchKbars({ contract, start, end, signal }) {
            return readJson('/api/v1/data/kbars', {
                method: 'POST',
                signal,
                body: JSON.stringify({
                    contract: {
                        security_type: contract.securityType,
                        region: contract.region,
                        exchange: contract.exchange,
                        code: contract.code,
                        target_code: contract.targetCode,
                    },
                    start,
                    end,
                }),
            });
        },
        coverageReceiptAvailable: false,
        subscriptionTransportAuthority: false,
        brokerWriteAuthority: false,
    });
}
