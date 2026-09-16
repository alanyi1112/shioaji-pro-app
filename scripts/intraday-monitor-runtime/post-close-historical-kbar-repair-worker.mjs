import {
    createHistoricalKbarInterruptionRecord,
    validateAndBuildHistoricalKbarRepair,
} from './historical-kbar-repair.mjs';

export const POST_CLOSE_HISTORICAL_KBAR_REPAIR_AUTHORITY_SCHEMA =
    'post-close-historical-kbar-repair-authority/1';
export const POST_CLOSE_HISTORICAL_KBAR_REPAIR_RUN_SCHEMA =
    'post-close-historical-kbar-repair-run/1';
export const POST_CLOSE_HISTORICAL_KBAR_REPAIR_MAX_SYMBOLS = 200;
export const POST_CLOSE_HISTORICAL_KBAR_REPAIR_REQUEST_TIMEOUT_MS = 8_000;
export const POST_CLOSE_HISTORICAL_KBAR_REPAIR_TOTAL_DEADLINE_MS = 300_000;

const issuedAuthorities = new WeakMap();

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function failResult(symbol, reasonCodes) {
    return deepFreeze({
        symbol: typeof symbol === 'string' ? symbol : null,
        ok: false,
        reasonCodes: [...new Set(reasonCodes)],
        manifestId: null,
        repositoryRevision: null,
        baselineUsable: false,
        liveCaptureAcceptance: false,
        notificationEligible: false,
        retroactiveTriggerEligible: false,
    });
}

function dateIsValid(value) {
    return (
        typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
    );
}

export function issuePostCloseHistoricalKbarRepairAuthority({ tradeDate, observedAtEpochMs,
    timeZone, simulation, sessionFinalized } = {}, nowEpochMs) {
    const now = Number(nowEpochMs);
    const earliest = dateIsValid(tradeDate)
        ? Date.parse(`${tradeDate}T13:34:30+08:00`)
        : Number.NaN;
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(observedAtEpochMs) ||
        observedAtEpochMs > now || observedAtEpochMs < earliest || timeZone !== 'Asia/Taipei' ||
        simulation !== true || sessionFinalized !== true) {
        return deepFreeze({ issued: false, reason: 'post_close_authority_invalid',
            historicalDataRequestAuthority: false, brokerWriteAuthority: false,
            productionAuthority: false, serviceLifecycleAuthority: false });
    }
    const authority = deepFreeze({ issued: true,
        schemaVersion: POST_CLOSE_HISTORICAL_KBAR_REPAIR_AUTHORITY_SCHEMA,
        tradeDate, observedAt: new Date(observedAtEpochMs).toISOString(), timeZone,
        simulation: true, historicalDataRequestAuthority: true,
        notificationAuthority: false, brokerWriteAuthority: false,
        productionAuthority: false, serviceLifecycleAuthority: false });
    issuedAuthorities.set(authority, { tradeDate, issuedAtEpochMs: observedAtEpochMs });
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

export function createPostCloseHistoricalKbarRepairWorker({
    resolveInstrumentAuthority,
    fetchFinalVolumeAuthority,
    fetchHistoricalKbars,
    repository,
    nowEpochMs = () => Date.now(),
    requestTimeoutMs = POST_CLOSE_HISTORICAL_KBAR_REPAIR_REQUEST_TIMEOUT_MS,
    totalDeadlineMs = POST_CLOSE_HISTORICAL_KBAR_REPAIR_TOTAL_DEADLINE_MS,
} = {}) {
    if (typeof resolveInstrumentAuthority !== 'function' ||
        typeof fetchFinalVolumeAuthority !== 'function' ||
        typeof fetchHistoricalKbars !== 'function' ||
        !repository || typeof repository.currentRevision !== 'function' ||
        typeof repository.putManifest !== 'function' || typeof repository.readInterruption !== 'function' ||
        typeof nowEpochMs !== 'function' ||
        !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 30_000 ||
        !Number.isSafeInteger(totalDeadlineMs) || totalDeadlineMs < requestTimeoutMs ||
        totalDeadlineMs > POST_CLOSE_HISTORICAL_KBAR_REPAIR_TOTAL_DEADLINE_MS) {
        throw new TypeError('post-close repair worker options are invalid');
    }

    async function run({ authority, interruptions } = {}) {
        const issued = issuedAuthorities.get(authority);
        const startedAtEpochMs = Reflect.apply(nowEpochMs, undefined, []);
        if (!issued || !Number.isSafeInteger(startedAtEpochMs) ||
            startedAtEpochMs < issued.issuedAtEpochMs) {
            return deepFreeze({ schemaVersion: POST_CLOSE_HISTORICAL_KBAR_REPAIR_RUN_SCHEMA,
                allowed: false, reason: 'post_close_authority_required', results: [],
                allSucceeded: false, baselineUsableCount: 0, liveCaptureAcceptanceCount: 0,
                notificationDispatchCount: 0, retroactiveTriggerCount: 0,
                brokerWriteAttemptCount: 0, productionTransitionCount: 0,
                serviceLifecycleMutationCount: 0 });
        }
        if (!Array.isArray(interruptions) || interruptions.length < 1 ||
            interruptions.length > POST_CLOSE_HISTORICAL_KBAR_REPAIR_MAX_SYMBOLS) {
            return deepFreeze({ schemaVersion: POST_CLOSE_HISTORICAL_KBAR_REPAIR_RUN_SCHEMA,
                allowed: false, reason: 'invalid_interruption_batch', results: [],
                allSucceeded: false, baselineUsableCount: 0, liveCaptureAcceptanceCount: 0,
                notificationDispatchCount: 0, retroactiveTriggerCount: 0,
                brokerWriteAttemptCount: 0, productionTransitionCount: 0,
                serviceLifecycleMutationCount: 0 });
        }

        const deadlineAt = startedAtEpochMs + totalDeadlineMs;
        const seen = new Set();
        const results = [];
        for (const rawInterruption of interruptions) {
            const interruption = createHistoricalKbarInterruptionRecord(rawInterruption);
            const symbol = rawInterruption?.symbol;
            if (interruption?.ok === false) {
                results.push(failResult(symbol, ['invalid_interruption_evidence']));
                continue;
            }
            if (interruption.tradeDate !== issued.tradeDate) {
                results.push(failResult(interruption.symbol, ['interruption_trade_date_mismatch']));
                continue;
            }
            if (seen.has(interruption.symbol)) {
                results.push(failResult(interruption.symbol, ['duplicate_interruption_symbol']));
                continue;
            }
            seen.add(interruption.symbol);
            let storedInterruption;
            try {
                storedInterruption = repository.readInterruption(interruption.interruptionId);
            } catch (error) {
                results.push(failResult(interruption.symbol,
                    [typeof error?.code === 'string' ? error.code : 'interruption_repository_unavailable']));
                continue;
            }
            if (!storedInterruption || JSON.stringify(storedInterruption) !== JSON.stringify(interruption)) {
                results.push(failResult(interruption.symbol, ['interruption_evidence_not_persisted']));
                continue;
            }
            const remainingMs = deadlineAt - Reflect.apply(nowEpochMs, undefined, []);
            if (!Number.isSafeInteger(remainingMs) || remainingMs < 1) {
                results.push(failResult(interruption.symbol, ['repair_total_deadline_exceeded']));
                continue;
            }
            const request = { symbol: interruption.symbol, exchange: interruption.exchange,
                tradeDate: interruption.tradeDate, timeZone: 'Asia/Taipei', simulation: true,
                authority, brokerWriteAuthority: false, productionAuthority: false,
                serviceLifecycleAuthority: false };
            try {
                const providerCall = (provider, payload) => {
                    const currentRemainingMs = deadlineAt - Reflect.apply(nowEpochMs, undefined, []);
                    if (!Number.isSafeInteger(currentRemainingMs) || currentRemainingMs < 1) {
                        throw new Error('repair_total_deadline_exceeded');
                    }
                    return callBounded(provider, payload, Math.min(requestTimeoutMs, currentRemainingMs));
                };
                const instrumentAuthority = await providerCall(resolveInstrumentAuthority,
                    { ...request, requestKind: 'instrument_authority' });
                const finalVolumeAuthority = await providerCall(fetchFinalVolumeAuthority,
                    { ...request, requestKind: 'regular_session_final_volume' });
                const candidate = await providerCall(fetchHistoricalKbars,
                    { ...request, requestKind: 'historical_1m_kbars', requestOrdinal: 1 });
                const refetchCandidate = await providerCall(fetchHistoricalKbars,
                    { ...request, requestKind: 'historical_1m_kbars', requestOrdinal: 2 });
                const verified = validateAndBuildHistoricalKbarRepair({ authority: instrumentAuthority,
                    finalVolumeAuthority, interruption, candidate, refetchCandidate,
                    now: new Date(Reflect.apply(nowEpochMs, undefined, [])).toISOString() });
                if (!verified.ok) {
                    results.push(failResult(interruption.symbol, verified.reasonCodes));
                    continue;
                }
                const expectedRevision = repository.currentRevision();
                const saved = repository.putManifest(verified.manifest, expectedRevision);
                results.push(deepFreeze({ symbol: interruption.symbol, ok: true, reasonCodes: [],
                    manifestId: saved.manifestId, repositoryRevision: saved.revision,
                    baselineUsable: true, liveCaptureAcceptance: false,
                    notificationEligible: false, retroactiveTriggerEligible: false }));
            } catch (error) {
                results.push(failResult(interruption.symbol,
                    [typeof error?.code === 'string' ? error.code : error?.message ?? 'repair_provider_failed']));
            }
        }
        const baselineUsableCount = results.filter((item) => item.baselineUsable).length;
        return deepFreeze({ schemaVersion: POST_CLOSE_HISTORICAL_KBAR_REPAIR_RUN_SCHEMA,
            allowed: true, reason: 'none', results,
            allSucceeded: results.length === interruptions.length && results.every((item) => item.ok),
            baselineUsableCount, liveCaptureAcceptanceCount: 0,
            notificationDispatchCount: 0, retroactiveTriggerCount: 0,
            brokerWriteAttemptCount: 0, productionTransitionCount: 0,
            serviceLifecycleMutationCount: 0 });
    }

    return Object.freeze({ run });
}
