export const SCREENER_POST_CLOSE_PROBE_MINUTES = 14 * 60;
export const SCREENER_PUBLICATION_COOLDOWN_MS = 20 * 60 * 1000;
export const SCREENER_PUBLICATION_MAX_PROBES = 18;
export const SCREENER_SESSION_READINESS_ID = 'screener-session-readiness';

export type ScreenerPublicationMarket = 'TWSE' | 'TPEx';
export type ScreenerPublicationStatus = 'pending' | 'complete' | 'invalid' | 'blocked' | 'rate-limited';
export type ScreenerReadinessPhase = 'pre-close' | 'awaiting-publication' | 'complete' | 'invalid' | 'blocked' | 'rate-limited' | 'probe-budget-exhausted';

export interface ScreenerMarketPublication {
    status: ScreenerPublicationStatus;
    reportDate: string | null;
    hash: string | null;
    total: number | null;
    invalid: number | null;
    reason: string | null;
    checkedAt: string | null;
}

export interface ScreenerSessionReadiness {
    version: 1;
    expectedSessionDate: string;
    effectiveSessionDate: string | null;
    phase: ScreenerReadinessPhase;
    attempts: number;
    nextAttemptAt: string;
    updatedAt: string;
    markets: Record<ScreenerPublicationMarket, ScreenerMarketPublication>;
}

export type ScreenerMarketPublicationOutcome = Partial<Omit<ScreenerMarketPublication, 'status' | 'checkedAt'>> & {
    status: ScreenerPublicationStatus;
};

const isoDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
const isoTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const integerOrNull = (value: unknown): value is number | null => value === null
    || typeof value === 'number' && Number.isInteger(value) && value >= 0;

export function taipeiSessionClock(now: number | Date = Date.now()) {
    const epoch = now instanceof Date ? now.getTime() : now;
    if (!Number.isFinite(epoch)) throw new Error('invalid_clock');
    const shifted = new Date(epoch + 8 * 60 * 60 * 1000);
    return {
        date: shifted.toISOString().slice(0, 10),
        minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    };
}

/** Select the newest official common session that is eligible at this Taipei wall-clock time. */
export function resolveScreenerSessionTarget(officialSessions: readonly string[], now: number | Date = Date.now()) {
    if (!Array.isArray(officialSessions) || officialSessions.some((date, index) => !isoDate(date)
        || index > 0 && date <= officialSessions[index - 1]!)) throw new Error('invalid_official_sessions');
    const clock = taipeiSessionClock(now);
    const todayIsSession = officialSessions.includes(clock.date);
    const expectedSessionDate = todayIsSession && clock.minutes < SCREENER_POST_CLOSE_PROBE_MINUTES
        ? officialSessions[officialSessions.indexOf(clock.date) - 1] ?? null
        : [...officialSessions].reverse().find((date) => date <= clock.date) ?? null;
    return { expectedSessionDate,
        phase: todayIsSession ? clock.minutes < SCREENER_POST_CLOSE_PROBE_MINUTES ? 'pre-close' : 'post-close' : 'non-trading',
        taipeiDate: clock.date } as const;
}

export function resolveExpectedScreenerSession(officialSessions: readonly string[], now: number | Date = Date.now()): string | null {
    return resolveScreenerSessionTarget(officialSessions, now).expectedSessionDate;
}

const emptyMarket = (): ScreenerMarketPublication => ({
    status: 'pending', reportDate: null, hash: null, total: null, invalid: null, reason: 'source_not_published', checkedAt: null,
});

export function createScreenerSessionReadiness(expectedSessionDate: string, effectiveSessionDate: string | null, now: number | Date = Date.now()): ScreenerSessionReadiness {
    if (!isoDate(expectedSessionDate) || effectiveSessionDate !== null && !isoDate(effectiveSessionDate)) throw new Error('invalid_session_readiness');
    const updatedAt = new Date(now instanceof Date ? now.getTime() : now).toISOString();
    return { version: 1, expectedSessionDate, effectiveSessionDate,
        phase: effectiveSessionDate === expectedSessionDate ? 'complete' : 'awaiting-publication', attempts: 0,
        nextAttemptAt: updatedAt, updatedAt, markets: { TWSE: emptyMarket(), TPEx: emptyMarket() } };
}

export function normalizeScreenerSessionReadiness(value: unknown, expectedSessionDate: string,
    effectiveSessionDate: string | null, now: number | Date = Date.now()): ScreenerSessionReadiness {
    const parsed = parseScreenerSessionReadiness(value);
    if (!parsed || parsed.expectedSessionDate !== expectedSessionDate) return createScreenerSessionReadiness(expectedSessionDate, effectiveSessionDate, now);
    if (effectiveSessionDate === expectedSessionDate && parsed.phase !== 'complete') {
        return { ...parsed, effectiveSessionDate, phase: 'complete',
            updatedAt: new Date(now instanceof Date ? now.getTime() : now).toISOString() };
    }
    if (effectiveSessionDate && (!parsed.effectiveSessionDate || effectiveSessionDate > parsed.effectiveSessionDate)) {
        return { ...parsed, effectiveSessionDate,
            phase: effectiveSessionDate === expectedSessionDate ? 'complete' : parsed.phase,
            updatedAt: new Date(now instanceof Date ? now.getTime() : now).toISOString() };
    }
    return parsed;
}

export function publicationProbeDecision(readiness: ScreenerSessionReadiness, now: number | Date = Date.now()) {
    const epoch = now instanceof Date ? now.getTime() : now;
    if (readiness.phase === 'complete' && readiness.effectiveSessionDate === readiness.expectedSessionDate) return { allowed: false, reason: 'session_complete' } as const;
    if (readiness.phase === 'blocked') return { allowed: false, reason: 'source_blocked' } as const;
    if (readiness.phase === 'invalid') return { allowed: false, reason: 'invalid_source' } as const;
    if (readiness.attempts >= SCREENER_PUBLICATION_MAX_PROBES) return { allowed: false, reason: 'probe_budget_exhausted' } as const;
    if (epoch < Date.parse(readiness.nextAttemptAt)) return { allowed: false, reason: 'publication_cooldown' } as const;
    return { allowed: true, reason: 'probe_due' } as const;
}

export function recordScreenerPublicationProbe(readiness: ScreenerSessionReadiness,
    outcomes: Partial<Record<ScreenerPublicationMarket, ScreenerMarketPublicationOutcome>>,
    now: number | Date = Date.now(), retryAfterMs = 0): ScreenerSessionReadiness {
    const epoch = now instanceof Date ? now.getTime() : now;
    if (!Number.isFinite(epoch) || !Number.isFinite(retryAfterMs) || retryAfterMs < 0) throw new Error('invalid_session_readiness');
    const checkedAt = new Date(epoch).toISOString();
    const markets = { ...readiness.markets };
    for (const market of ['TWSE', 'TPEx'] as const) {
        const outcome = outcomes[market];
        if (!outcome) continue;
        markets[market] = {
            status: outcome.status,
            reportDate: outcome.reportDate ?? null,
            hash: outcome.hash ?? null,
            total: outcome.total ?? null,
            invalid: outcome.invalid ?? null,
            reason: outcome.reason ?? (outcome.status === 'complete' ? null : 'source_not_published'),
            checkedAt,
        };
    }
    const attempts = readiness.attempts + 1;
    const complete = markets.TWSE.status === 'complete' && markets.TPEx.status === 'complete'
        && markets.TWSE.reportDate === readiness.expectedSessionDate && markets.TPEx.reportDate === readiness.expectedSessionDate;
    const statuses = new Set([markets.TWSE.status, markets.TPEx.status]);
    const phase: ScreenerReadinessPhase = complete ? 'complete'
        : statuses.has('blocked') ? 'blocked'
        : statuses.has('rate-limited') ? 'rate-limited'
        : statuses.has('invalid') ? 'invalid'
        : attempts >= SCREENER_PUBLICATION_MAX_PROBES ? 'probe-budget-exhausted' : 'awaiting-publication';
    return {
        ...readiness, attempts, markets, phase, effectiveSessionDate: complete ? readiness.expectedSessionDate : readiness.effectiveSessionDate,
        nextAttemptAt: new Date(epoch + Math.max(SCREENER_PUBLICATION_COOLDOWN_MS, retryAfterMs)).toISOString(), updatedAt: checkedAt,
    };
}

export function parseScreenerSessionReadiness(value: unknown): ScreenerSessionReadiness | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Partial<ScreenerSessionReadiness>;
    if (row.version !== 1 || !isoDate(row.expectedSessionDate) || row.effectiveSessionDate !== null && !isoDate(row.effectiveSessionDate)
        || !['pre-close', 'awaiting-publication', 'complete', 'invalid', 'blocked', 'rate-limited', 'probe-budget-exhausted'].includes(row.phase ?? '')
        || !Number.isInteger(row.attempts) || row.attempts! < 0 || row.attempts! > SCREENER_PUBLICATION_MAX_PROBES
        || !isoTime(row.nextAttemptAt) || !isoTime(row.updatedAt) || !row.markets) return null;
    for (const market of ['TWSE', 'TPEx'] as const) {
        const status = row.markets[market];
        if (!status || !['pending', 'complete', 'invalid', 'blocked', 'rate-limited'].includes(status.status)
            || status.reportDate !== null && !isoDate(status.reportDate) || status.hash !== null && typeof status.hash !== 'string'
            || !integerOrNull(status.total) || !integerOrNull(status.invalid)
            || status.reason !== null && typeof status.reason !== 'string' || status.checkedAt !== null && !isoTime(status.checkedAt)) return null;
    }
    return row as ScreenerSessionReadiness;
}

export function screenerReadinessReason(readiness: ScreenerSessionReadiness): string {
    if (readiness.phase === 'complete') return 'none';
    if (readiness.phase === 'blocked') return 'source_blocked';
    if (readiness.phase === 'rate-limited') return 'rate_limited';
    if (readiness.phase === 'invalid') return 'invalid_source';
    if (readiness.phase === 'probe-budget-exhausted') return 'publication_probe_exhausted';
    if (readiness.markets.TWSE.status === 'complete' && readiness.markets.TPEx.status !== 'complete') return 'awaiting_tpex';
    if (readiness.markets.TPEx.status === 'complete' && readiness.markets.TWSE.status !== 'complete') return 'awaiting_twse';
    return 'source_not_published';
}
