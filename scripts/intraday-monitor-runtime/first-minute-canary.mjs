export const FIRST_MINUTE_CANARY_SCHEMA = 'intraday-monitor-first-minute-canary/1';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function evaluateFirstMinuteCanary({ tradeDate, connectionGeneration, cohort, items,
    evaluatedAt, streamState = 'connected' } = {}) {
    if (!DATE.test(tradeDate ?? '') || typeof connectionGeneration !== 'string' ||
        connectionGeneration.length < 16 || !Array.isArray(cohort) || cohort.length !== 160 ||
        new Set(cohort).size !== 160 || !Array.isArray(items) ||
        !Number.isFinite(Date.parse(evaluatedAt ?? '')) ||
        !['connected', 'disconnected'].includes(streamState)) {
        throw new TypeError('first minute canary input is invalid');
    }
    const deadline = Date.parse(`${tradeDate}T09:02:15+08:00`);
    if (Date.parse(evaluatedAt) < deadline) throw new Error('first_minute_canary_too_early');
    const bySymbol = new Map(items.map((item) => [item.canonicalSymbol, item]));
    const received = [];
    const missing = [];
    const latencies = [];
    for (const canonicalSymbol of cohort) {
        const item = bySymbol.get(canonicalSymbol);
        const receivedAt = Date.parse(item?.firstEventAt ?? '');
        const valid = item?.firstEventMinute === '09:01' && Number.isFinite(receivedAt) &&
            receivedAt <= deadline && item?.dataPlaneState === 'active';
        if (valid) {
            received.push(canonicalSymbol);
            latencies.push({ canonicalSymbol, latencyMs: Math.max(0,
                receivedAt - Date.parse(`${tradeDate}T09:01:00+08:00`)) });
        } else missing.push(canonicalSymbol);
    }
    const liveAvailabilityComplete = missing.length === 0 && streamState === 'connected';
    return Object.freeze({
        schemaVersion: FIRST_MINUTE_CANARY_SCHEMA, tradeDate, connectionGeneration,
        deadlineAt: new Date(deadline).toISOString(), evaluatedAt,
        expectedCount: 160, receivedCount: received.length, missingCount: missing.length,
        received: Object.freeze(received), missing: Object.freeze(missing),
        firstEventLatencies: Object.freeze(latencies), liveAvailabilityComplete,
        streamState, result: liveAvailabilityComplete ? 'pass' : 'fail',
        incident: liveAvailabilityComplete ? null : Object.freeze({
            code: streamState === 'disconnected' ? 'kbar_stream_disconnected' : 'first_minute_kbar_missing',
            immutableLiveFailure: true,
            notificationRequired: true,
        }),
    });
}

export function createBoundedKbarRecoveryAuthority({ tradeDate, connectionGeneration,
    cohortHash } = {}) {
    if (!DATE.test(tradeDate ?? '') || typeof connectionGeneration !== 'string' ||
        connectionGeneration.length < 16 || !/^sha256:[a-f0-9]{64}$/.test(cohortHash ?? '')) {
        throw new TypeError('recovery authority input is invalid');
    }
    let issued = false;
    return Object.freeze({
        issue({ missingCount } = {}) {
            if (issued) return Object.freeze({ allowed: false, reason: 'recovery_already_attempted' });
            if (!Number.isSafeInteger(missingCount) || missingCount < 1 || missingCount > 160) {
                return Object.freeze({ allowed: false, reason: 'recovery_not_required' });
            }
            issued = true;
            return Object.freeze({ allowed: true, tradeDate, connectionGeneration, cohortHash,
                maximumAttempts: 1, rotateSymbols: false, secondStreamAllowed: false });
        },
        status: () => Object.freeze({ attempted: issued, maximumAttempts: 1 }),
    });
}
