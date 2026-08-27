const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1_000;

export const SMART_ORDER_RETENTION_SCHEMA_VERSION =
    'smart-order-retention/2026-08-11.1';

const TERMINAL_STATES = Object.freeze({
    strategy: new Set(['cancelled', 'completed', 'expired', 'failed']),
    activation: new Set(['filled', 'cancelled', 'failed', 'missed']),
    order_intent: new Set(['terminal', 'cancelled_proven_unsent']),
    broker_order: new Set(['filled', 'cancelled', 'failed', 'inactive']),
    pending_protection_commitment: new Set([
        'materialized',
        'zero_fill_terminal',
        'released_pre_dispatch',
        'released_manual',
    ]),
    protection_obligation: new Set([
        'fulfilled',
        'zero_fill_terminal',
        'released_manual',
    ]),
    entry_exposure_reservation: new Set(['consumed', 'released']),
    exit_claim: new Set(['consumed', 'released']),
    resolution_case: new Set(['resolved']),
    safety_blocker: new Set(['resolved']),
});

function epochMilliseconds(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} must be a non-negative epoch millisecond`);
    }
    return value;
}

export function addTaipeiCalendarYear(epochMs) {
    const instant = epochMilliseconds(epochMs, 'epochMs');
    const local = new Date(instant + TAIPEI_OFFSET_MS);
    const targetYear = local.getUTCFullYear() + 1;
    const month = local.getUTCMonth();
    const lastTargetDay = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate();
    const targetDay = Math.min(local.getUTCDate(), lastTargetDay);
    const anniversaryLocal = Date.UTC(
        targetYear,
        month,
        targetDay,
        local.getUTCHours(),
        local.getUTCMinutes(),
        local.getUTCSeconds(),
        local.getUTCMilliseconds(),
    );
    return epochMilliseconds(
        anniversaryLocal - TAIPEI_OFFSET_MS,
        'calendarYearAnniversary',
    );
}

export function evaluateRetentionEligibility(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('retention input must be an object');
    }
    const terminalStates = TERMINAL_STATES[input.entityKind];
    if (!terminalStates) {
        throw new TypeError('retention entityKind is unsupported');
    }
    if (typeof input.state !== 'string' || !terminalStates.has(input.state)) {
        return Object.freeze({
            eligible: false,
            reason: 'non_terminal_or_unknown_state',
        });
    }
    if (input.hasLiveDependency === true) {
        return Object.freeze({
            eligible: false,
            reason: 'live_dependency',
        });
    }
    if (input.hasLiveDependency !== false) {
        throw new TypeError('hasLiveDependency must be an explicit boolean');
    }
    const lifecycleCandidates = [
        input.terminalAtEpochMs,
        input.releasedAtEpochMs,
    ].filter((value) => value !== undefined && value !== null);
    if (lifecycleCandidates.length === 0) {
        return Object.freeze({
            eligible: false,
            reason: 'terminal_timestamp_missing',
        });
    }
    const evidenceCandidates = [
        ...lifecycleCandidates,
        input.lastEvidenceAtEpochMs,
    ].filter((value) => value !== undefined && value !== null);
    const retentionBaseEpochMs = Math.max(
        ...evidenceCandidates.map((value, index) =>
            epochMilliseconds(value, `retentionTimestamp[${index}]`),
        ),
    );
    const eligibleAtEpochMs = addTaipeiCalendarYear(retentionBaseEpochMs);
    const nowEpochMs = epochMilliseconds(input.nowEpochMs, 'nowEpochMs');
    if (nowEpochMs < eligibleAtEpochMs) {
        return Object.freeze({
            eligible: false,
            reason: 'retention_period_active',
            retentionBaseEpochMs,
            eligibleAtEpochMs,
        });
    }
    return Object.freeze({
        eligible: true,
        reason: 'calendar_year_elapsed',
        retentionBaseEpochMs,
        eligibleAtEpochMs,
    });
}
