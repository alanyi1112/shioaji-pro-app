import {
    LIVE_FULL_SESSION_PROVENANCE,
    selectIntradayBaseline,
    validateAndBuildHistoricalKbarBaseline,
} from './historical-kbar-repair.mjs';

export const HISTORICAL_KBAR_BASELINE_AUTHORITY_SCHEMA =
    'historical-kbar-baseline-authority/1';
export const HISTORICAL_KBAR_BASELINE_RUN_SCHEMA =
    'historical-kbar-baseline-run/1';
export const HISTORICAL_KBAR_BASELINE_MAX_SYMBOLS = 20;
export const HISTORICAL_KBAR_BASELINE_REQUEST_TIMEOUT_MS = 8_000;
export const HISTORICAL_KBAR_BASELINE_TOTAL_DEADLINE_MS = 300_000;

const issuedAuthorities = new WeakMap();

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function validDate(value) {
    return (
        typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
    );
}

function failResult(symbol, reasonCodes) {
    return deepFreeze({
        symbol: typeof symbol === 'string' ? symbol : null,
        ok: false,
        selected: 'none',
        reasonCodes: [...new Set(reasonCodes)],
        manifestId: null,
        repositoryRevision: null,
        baselineUsable: false,
        liveCaptureAcceptance: false,
        notificationEligible: false,
        retroactiveTriggerEligible: false,
    });
}

export function issueHistoricalKbarBaselineAuthority({
    previousTradeDate,
    targetTradeDate,
    observedAtEpochMs,
    timeZone,
    simulation,
    previousSessionFinalized,
    calendarVerified,
    calendarSource,
    calendarSourceVersion,
    cohortHash,
} = {}, nowEpochMs) {
    const now = Number(nowEpochMs);
    const earliest = validDate(previousTradeDate)
        ? Date.parse(`${previousTradeDate}T13:34:30+08:00`)
        : Number.NaN;
    const latest = validDate(targetTradeDate)
        ? Date.parse(`${targetTradeDate}T09:01:00+08:00`)
        : Number.NaN;
    if (
        !Number.isSafeInteger(now) ||
        !Number.isSafeInteger(observedAtEpochMs) ||
        observedAtEpochMs > now ||
        observedAtEpochMs < earliest ||
        observedAtEpochMs >= latest ||
        previousTradeDate >= targetTradeDate ||
        timeZone !== 'Asia/Taipei' ||
        simulation !== true ||
        previousSessionFinalized !== true ||
        calendarVerified !== true ||
        typeof calendarSource !== 'string' ||
        calendarSource.length === 0 ||
        typeof calendarSourceVersion !== 'string' ||
        calendarSourceVersion.length === 0 ||
        !/^sha256:[a-f0-9]{64}$/.test(cohortHash ?? '')
    ) {
        return deepFreeze({
            issued: false,
            reason: 'historical_baseline_authority_invalid',
            historicalDataRequestAuthority: false,
            brokerWriteAuthority: false,
            productionAuthority: false,
            serviceLifecycleAuthority: false,
        });
    }
    const authority = deepFreeze({
        issued: true,
        schemaVersion: HISTORICAL_KBAR_BASELINE_AUTHORITY_SCHEMA,
        previousTradeDate,
        targetTradeDate,
        observedAt: new Date(observedAtEpochMs).toISOString(),
        timeZone: 'Asia/Taipei',
        simulation: true,
        previousSessionFinalized: true,
        calendarVerified: true,
        calendarSource,
        calendarSourceVersion,
        cohortHash,
        historicalDataRequestAuthority: true,
        notificationAuthority: false,
        brokerWriteAuthority: false,
        productionAuthority: false,
        serviceLifecycleAuthority: false,
    });
    issuedAuthorities.set(authority, {
        previousTradeDate,
        targetTradeDate,
        issuedAtEpochMs: observedAtEpochMs,
        calendarSource,
        calendarSourceVersion,
        cohortHash,
    });
    return authority;
}

async function callBounded(provider, request, timeoutMs) {
    const controller = new AbortController();
    let timeout;
    try {
        return await Promise.race([
            Promise.resolve().then(() => Reflect.apply(provider, undefined, [
                Object.freeze({ ...request, signal: controller.signal }),
            ])),
            new Promise((_, reject) => {
                timeout = setTimeout(() => {
                    controller.abort();
                    reject(new Error('provider_timeout'));
                }, timeoutMs);
                timeout.unref?.();
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

export function createHistoricalKbarBaselineWorker({
    resolveLiveBaseline,
    resolveInstrumentAuthority,
    fetchFinalVolumeAuthority,
    fetchHistoricalKbars,
    repository,
    nowEpochMs = () => Date.now(),
    requestTimeoutMs = HISTORICAL_KBAR_BASELINE_REQUEST_TIMEOUT_MS,
    totalDeadlineMs = HISTORICAL_KBAR_BASELINE_TOTAL_DEADLINE_MS,
} = {}) {
    if (
        typeof resolveLiveBaseline !== 'function' ||
        typeof resolveInstrumentAuthority !== 'function' ||
        typeof fetchFinalVolumeAuthority !== 'function' ||
        typeof fetchHistoricalKbars !== 'function' ||
        !repository ||
        typeof repository.currentRevision !== 'function' ||
        typeof repository.putManifest !== 'function' ||
        typeof nowEpochMs !== 'function' ||
        !Number.isSafeInteger(requestTimeoutMs) ||
        requestTimeoutMs < 1 ||
        requestTimeoutMs > 30_000 ||
        !Number.isSafeInteger(totalDeadlineMs) ||
        totalDeadlineMs < requestTimeoutMs ||
        totalDeadlineMs > HISTORICAL_KBAR_BASELINE_TOTAL_DEADLINE_MS
    ) {
        throw new TypeError('historical baseline worker options are invalid');
    }

    async function run({ authority, cohort } = {}) {
        const issued = issuedAuthorities.get(authority);
        const startedAtEpochMs = Reflect.apply(nowEpochMs, undefined, []);
        if (
            !issued ||
            !Number.isSafeInteger(startedAtEpochMs) ||
            startedAtEpochMs < issued.issuedAtEpochMs ||
            startedAtEpochMs >= Date.parse(`${issued.targetTradeDate}T09:01:00+08:00`)
        ) {
            return deepFreeze({
                schemaVersion: HISTORICAL_KBAR_BASELINE_RUN_SCHEMA,
                allowed: false,
                reason: 'historical_baseline_authority_required',
                results: [],
                allSucceeded: false,
                baselineUsableCount: 0,
                liveBaselineCount: 0,
                notificationDispatchCount: 0,
                retroactiveTriggerCount: 0,
                brokerWriteAttemptCount: 0,
                productionTransitionCount: 0,
                serviceLifecycleMutationCount: 0,
            });
        }
        if (
            !Array.isArray(cohort) ||
            cohort.length < 1 ||
            cohort.length > HISTORICAL_KBAR_BASELINE_MAX_SYMBOLS
        ) {
            return deepFreeze({
                schemaVersion: HISTORICAL_KBAR_BASELINE_RUN_SCHEMA,
                allowed: false,
                reason: 'invalid_baseline_cohort',
                results: [],
                allSucceeded: false,
                baselineUsableCount: 0,
                liveBaselineCount: 0,
                notificationDispatchCount: 0,
                retroactiveTriggerCount: 0,
                brokerWriteAttemptCount: 0,
                productionTransitionCount: 0,
                serviceLifecycleMutationCount: 0,
            });
        }

        const deadlineAt = startedAtEpochMs + totalDeadlineMs;
        const seen = new Set();
        const results = [];
        for (const item of cohort) {
            const symbol = item?.symbol;
            const exchange = item?.exchange;
            if (
                typeof symbol !== 'string' ||
                !['TSE', 'OTC'].includes(exchange) ||
                seen.has(symbol)
            ) {
                results.push(failResult(symbol, [
                    seen.has(symbol) ? 'duplicate_baseline_symbol' : 'invalid_baseline_symbol',
                ]));
                continue;
            }
            seen.add(symbol);
            try {
                const liveLookupRemainingMs =
                    deadlineAt - Reflect.apply(nowEpochMs, undefined, []);
                if (
                    !Number.isSafeInteger(liveLookupRemainingMs) ||
                    liveLookupRemainingMs < 1
                ) {
                    throw new Error('historical_baseline_total_deadline_exceeded');
                }
                const liveBaseline = await callBounded(
                    resolveLiveBaseline,
                    {
                        symbol,
                        exchange,
                        tradeDate: issued.previousTradeDate,
                        targetTradeDate: issued.targetTradeDate,
                        requestKind: 'live_full_session_baseline_lookup',
                        providerRequestAuthority: false,
                        brokerWriteAuthority: false,
                        productionAuthority: false,
                        serviceLifecycleAuthority: false,
                    },
                    Math.min(requestTimeoutMs, liveLookupRemainingMs),
                );
                const selected = selectIntradayBaseline({ liveBaseline });
                if (
                    selected.selected === 'live' &&
                    liveBaseline?.provenance === LIVE_FULL_SESSION_PROVENANCE &&
                    liveBaseline?.symbol === symbol &&
                    liveBaseline?.tradeDate === issued.previousTradeDate
                ) {
                    results.push(deepFreeze({
                        symbol,
                        ok: true,
                        selected: 'live',
                        reasonCodes: [],
                        manifestId: null,
                        repositoryRevision: null,
                        baselineUsable: true,
                        liveCaptureAcceptance: true,
                        notificationEligible: false,
                        retroactiveTriggerEligible: false,
                    }));
                    continue;
                }

                const providerCall = (provider, payload) => {
                    const remainingMs = deadlineAt - Reflect.apply(nowEpochMs, undefined, []);
                    if (!Number.isSafeInteger(remainingMs) || remainingMs < 1) {
                        throw new Error('historical_baseline_total_deadline_exceeded');
                    }
                    return callBounded(provider, payload, Math.min(requestTimeoutMs, remainingMs));
                };
                const request = {
                    symbol,
                    exchange,
                    tradeDate: issued.previousTradeDate,
                    targetTradeDate: issued.targetTradeDate,
                    timeZone: 'Asia/Taipei',
                    simulation: true,
                    authority,
                    brokerWriteAuthority: false,
                    productionAuthority: false,
                    serviceLifecycleAuthority: false,
                };
                const instrument = await providerCall(resolveInstrumentAuthority, {
                    ...request,
                    requestKind: 'instrument_authority',
                });
                const finalVolumeAuthority = await providerCall(
                    fetchFinalVolumeAuthority,
                    { ...request, requestKind: 'regular_session_final_volume' },
                );
                const candidate = await providerCall(fetchHistoricalKbars, {
                    ...request,
                    requestKind: 'historical_1m_kbars',
                    requestOrdinal: 1,
                });
                const refetchCandidate = await providerCall(fetchHistoricalKbars, {
                    ...request,
                    requestKind: 'historical_1m_kbars',
                    requestOrdinal: 2,
                });
                const verified = validateAndBuildHistoricalKbarBaseline({
                    authority: {
                        ...instrument,
                        targetTradeDate: issued.targetTradeDate,
                        previousApplicableTradeDate: issued.previousTradeDate,
                        calendarVerified: true,
                        calendarSource: issued.calendarSource,
                        calendarSourceVersion: issued.calendarSourceVersion,
                    },
                    finalVolumeAuthority,
                    candidate,
                    refetchCandidate,
                    cohortHash: issued.cohortHash,
                    now: new Date(Reflect.apply(nowEpochMs, undefined, [])).toISOString(),
                });
                if (!verified.ok) {
                    results.push(failResult(symbol, verified.reasonCodes));
                    continue;
                }
                const saved = repository.putManifest(
                    verified.manifest,
                    repository.currentRevision(),
                );
                results.push(deepFreeze({
                    symbol,
                    ok: true,
                    selected: 'historical_baseline',
                    reasonCodes: [],
                    manifestId: saved.manifestId,
                    repositoryRevision: saved.revision,
                    baselineUsable: true,
                    liveCaptureAcceptance: false,
                    notificationEligible: false,
                    retroactiveTriggerEligible: false,
                }));
            } catch (error) {
                results.push(failResult(symbol, [
                    typeof error?.code === 'string'
                        ? error.code
                        : error?.message ?? 'historical_baseline_provider_failed',
                ]));
            }
        }
        return deepFreeze({
            schemaVersion: HISTORICAL_KBAR_BASELINE_RUN_SCHEMA,
            allowed: true,
            reason: 'none',
            results,
            allSucceeded:
                results.length === cohort.length && results.every((item) => item.ok),
            baselineUsableCount: results.filter((item) => item.baselineUsable).length,
            liveBaselineCount: results.filter((item) => item.selected === 'live').length,
            notificationDispatchCount: 0,
            retroactiveTriggerCount: 0,
            brokerWriteAttemptCount: 0,
            productionTransitionCount: 0,
            serviceLifecycleMutationCount: 0,
        });
    }

    return Object.freeze({ run });
}
