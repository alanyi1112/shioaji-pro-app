import { SMART_ORDER_DOMAIN_TEST_MODE } from './smart-order-domain-test-mode';

/**
 * Smart-order calendar and clock primitives.
 *
 * Trading decisions must never infer a session from weekdays alone.  This
 * module consumes an explicit, versioned calendar snapshot and keeps wall
 * clock, trusted clock and monotonic duration as separate concepts.
 *
 * This file is a pure domain verifier, not a production calendar/session/time
 * source adapter and not runtime-ready by itself. Production capability minting
 * remains a separate runtime-integration task and must fail closed until wired.
 */

export const SMART_ORDER_CALENDAR_SCHEMA_VERSION =
    'smart-order-calendar/2026-08-11.1' as const;
export const TAIPEI_TIME_ZONE = 'Asia/Taipei' as const;
export const SMART_ORDER_MAX_TRUSTED_SKEW_MS = 2_000 as const;
export const SMART_ORDER_MAX_CLOCK_JUMP_SKEW_MS = 2_000 as const;
export const SMART_ORDER_TRUSTED_TIME_TTL_MS = 5_000 as const;
export const SMART_ORDER_BUSINESS_SESSION_TTL_MS = 5_000 as const;
export const SMART_ORDER_CLOCK_EVALUATION_TTL_MS = 5_000 as const;

declare const taipeiTradeDateBrand: unique symbol;
declare const monotonicNanosecondsBrand: unique symbol;

export type TaipeiTradeDate = string & {
    readonly [taipeiTradeDateBrand]: 'TaipeiTradeDate';
};
export type MonotonicNanoseconds = bigint & {
    readonly [monotonicNanosecondsBrand]: 'MonotonicNanoseconds';
};

export type TradingCalendarDayState = 'trading' | 'closed' | 'suspended';

export type SmartOrderCalendarErrorCode =
    | 'invalid_trade_date'
    | 'invalid_calendar_snapshot'
    | 'invalid_calendar_version'
    | 'invalid_calendar_integrity'
    | 'invalid_epoch_milliseconds'
    | 'invalid_monotonic_time'
    | 'invalid_clock_threshold';

export class SmartOrderCalendarError extends Error {
    readonly code: SmartOrderCalendarErrorCode;

    constructor(code: SmartOrderCalendarErrorCode, message: string) {
        super(message);
        this.name = 'SmartOrderCalendarError';
        this.code = code;
    }
}

export interface TradingCalendarDayInput {
    readonly tradeDate: string;
    readonly state: TradingCalendarDayState;
    readonly reasonCode: string;
    readonly sourceRevision: string;
}

export interface TradingCalendarSnapshotInput {
    readonly schemaVersion: typeof SMART_ORDER_CALENDAR_SCHEMA_VERSION;
    readonly calendarVersion: string;
    readonly sourceId: string;
    readonly sourceRevision: string;
    readonly sourceSequence: number;
    readonly sourceIntegritySha256: string;
    readonly coverageStart: string;
    readonly coverageEnd: string;
    readonly generatedAtEpochMs: number;
    readonly expiresAtEpochMs: number;
    readonly days: readonly TradingCalendarDayInput[];
}

export interface TradingCalendarDay {
    readonly tradeDate: TaipeiTradeDate;
    readonly state: TradingCalendarDayState;
    readonly reasonCode: string;
    readonly sourceRevision: string;
}

export interface TradingCalendarSnapshot {
    readonly schemaVersion: typeof SMART_ORDER_CALENDAR_SCHEMA_VERSION;
    readonly calendarVersion: string;
    readonly sourceId: string;
    readonly sourceRevision: string;
    readonly sourceSequence: number;
    readonly sourceIntegritySha256: `sha256:${string}`;
    readonly coverageStart: TaipeiTradeDate;
    readonly coverageEnd: TaipeiTradeDate;
    readonly generatedAtEpochMs: number;
    readonly expiresAtEpochMs: number;
    readonly days: readonly TradingCalendarDay[];
}

export interface ClockSample {
    readonly clockEpochId: string;
    readonly sequence: number;
    readonly wallEpochMs: number;
    readonly monotonicNs: MonotonicNanoseconds;
}

export interface TrustedClockSamplePair {
    readonly clockEpochId: string;
    readonly previousSequence: number;
    readonly currentSequence: number;
    readonly previous: ClockSample;
    readonly current: ClockSample;
}

export interface TrustedTimeEvidence {
    readonly sourceId: string;
    readonly sourceRevision: string;
    readonly sourceSequence: number;
    readonly authorityEpochMs: number;
    readonly observedAtMonotonicNs: MonotonicNanoseconds;
    readonly validUntilMonotonicNs: MonotonicNanoseconds;
}

export type BusinessSessionState =
    | 'open'
    | 'closed'
    | 'suspended'
    | 'unknown';

export interface TrustedBusinessSessionEvidence {
    readonly sourceId: string;
    readonly sourceRevision: string;
    readonly sourceSequence: number;
    readonly tradeDate: TaipeiTradeDate;
    readonly state: BusinessSessionState;
    readonly observedAtMonotonicNs: MonotonicNanoseconds;
    readonly validUntilMonotonicNs: MonotonicNanoseconds;
}

export interface TrustedTradingClockEvaluationBundle {
    readonly calendar: TradingCalendarSnapshot;
    readonly calendarHead: TradingCalendarSnapshot;
    readonly clockSamplePair: TrustedClockSamplePair;
    readonly trustedTime: TrustedTimeEvidence | null;
    readonly businessSession: TrustedBusinessSessionEvidence | null;
    readonly clockEpochId: string;
    readonly previousSequence: number;
    readonly currentSequence: number;
    readonly issuedAtMonotonicNs: MonotonicNanoseconds;
    readonly validUntilMonotonicNs: MonotonicNanoseconds;
    readonly trustedTimeHead: TrustedTimeEvidence | null;
    readonly businessSessionHead: TrustedBusinessSessionEvidence | null;
}

export type ClockContinuity =
    | Readonly<{
          kind: 'continuous';
          wallDeltaMs: bigint;
          monotonicDeltaNs: bigint;
          absoluteSkewNs: bigint;
      }>
    | Readonly<{
          kind: 'jump_forward' | 'jump_backward';
          wallDeltaMs: bigint;
          monotonicDeltaNs: bigint;
          absoluteSkewNs: bigint;
      }>
    | Readonly<{
          kind: 'monotonic_regression';
          wallDeltaMs: bigint;
          monotonicDeltaNs: bigint;
          absoluteSkewNs: bigint;
      }>;

export type TradingClockReadinessReason =
    | 'calendar_untrusted'
    | 'calendar_expired'
    | 'calendar_not_yet_valid'
    | 'unknown_trade_date'
    | 'non_trading_day'
    | 'suspended_session'
    | 'trusted_time_missing'
    | 'trusted_time_untrusted'
    | 'trusted_time_stale'
    | 'trusted_time_skew'
    | 'clock_baseline_missing'
    | 'local_clock_untrusted'
    | 'clock_evaluation_untrusted'
    | 'clock_evaluation_stale'
    | 'clock_evaluation_replayed'
    | 'clock_jump'
    | 'monotonic_regression'
    | 'business_session_missing'
    | 'business_session_untrusted'
    | 'business_session_stale'
    | 'business_session_unknown'
    | 'business_session_mismatch';

export type TradingClockReadiness =
    | Readonly<{
          ready: true;
          tradeDate: TaipeiTradeDate;
          calendarVersion: string;
          day: TradingCalendarDay;
          trustedSkewMs: bigint;
      }>
    | Readonly<{
          ready: false;
          reason: TradingClockReadinessReason;
          tradeDate?: TaipeiTradeDate;
          calendarVersion: string;
          trustedSkewMs?: bigint;
      }>;

function fail(code: SmartOrderCalendarErrorCode, message: string): never {
    throw new SmartOrderCalendarError(code, message);
}

const canonicalCalendars = new WeakSet<object>();
const trustedCalendars = new WeakSet<object>();
const trustedTimes = new WeakSet<object>();
const trustedBusinessSessions = new WeakSet<object>();
const trustedLocalClockSamples = new WeakSet<object>();
const trustedClockSamplePairs = new WeakSet<object>();
const trustedClockEvaluationBundles = new WeakSet<object>();
const consumedClockEvaluationBundles = new WeakSet<object>();
let verifierClockHead: ClockSample | null = null;
const retiredClockEpochIds = new Set<string>();
const calendarHeadsBySource = new Map<string, TradingCalendarSnapshot>();
const retiredCalendarRevisionsBySource = new Map<string, Set<string>>();
const trustedTimeHeadsBySource = new Map<string, TrustedTimeEvidence>();
const retiredTrustedTimeRevisionsBySource = new Map<string, Set<string>>();
const businessSessionHeadsBySource = new Map<
    string,
    TrustedBusinessSessionEvidence
>();
const retiredBusinessSessionRevisionsBySource = new Map<
    string,
    Set<string>
>();

function requireSourceSequence(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 1) {
        return fail(
            'invalid_monotonic_time',
            `${label} must be a positive safe integer`,
        );
    }
    return value;
}

function requireNextSourceHead(
    current:
        | TrustedTimeEvidence
        | TrustedBusinessSessionEvidence
        | undefined,
    next: Readonly<{
        sourceId: string;
        sourceRevision: string;
        sourceSequence: number;
        observedAtMonotonicNs: MonotonicNanoseconds;
    }>,
    retiredRevisions: Set<string>,
    label: string,
): void {
    if (!current) return;
    if (
        next.sourceSequence !== current.sourceSequence + 1 ||
        next.sourceRevision === current.sourceRevision ||
        retiredRevisions.has(next.sourceRevision) ||
        next.observedAtMonotonicNs < current.observedAtMonotonicNs
    ) {
        return fail(
            'invalid_monotonic_time',
            `${label} must advance revision and adjacent source sequence without monotonic regression`,
        );
    }
    retiredRevisions.add(current.sourceRevision);
}

function retiredRevisionSet(
    registry: Map<string, Set<string>>,
    sourceId: string,
): Set<string> {
    const existing = registry.get(sourceId);
    if (existing) return existing;
    const created = new Set<string>();
    registry.set(sourceId, created);
    return created;
}

function requireNonEmptyToken(value: string, label: string): string {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 160 ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        return fail(
            'invalid_calendar_snapshot',
            `${label} must be a bounded non-empty token`,
        );
    }
    return value;
}

function requireEpochMilliseconds(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 0) {
        return fail(
            'invalid_epoch_milliseconds',
            `${label} must be a non-negative safe integer`,
        );
    }
    return value;
}

function tradeDateOrdinal(value: string): number {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
        return fail(
            'invalid_trade_date',
            'trade date must use YYYY-MM-DD',
        );
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1970 || year > 2200 || month < 1 || month > 12) {
        return fail('invalid_trade_date', 'trade date is outside bounds');
    }
    const epochMs = Date.UTC(year, month - 1, day);
    const date = new Date(epochMs);
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() + 1 !== month ||
        date.getUTCDate() !== day
    ) {
        return fail('invalid_trade_date', 'trade date does not exist');
    }
    return epochMs / 86_400_000;
}

export function taipeiTradeDate(value: string): TaipeiTradeDate {
    tradeDateOrdinal(value);
    return value as TaipeiTradeDate;
}

export function monotonicNanoseconds(
    value: bigint,
): MonotonicNanoseconds {
    if (typeof value !== 'bigint' || value < 0n) {
        return fail(
            'invalid_monotonic_time',
            'monotonic time must be a non-negative bigint',
        );
    }
    return value as MonotonicNanoseconds;
}

const taipeiDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

export function taipeiTradeDateFromEpochMilliseconds(
    epochMs: number,
): TaipeiTradeDate {
    requireEpochMilliseconds(epochMs, 'epochMs');
    const parts = taipeiDateFormatter.formatToParts(new Date(epochMs));
    const byType = new Map(parts.map((part) => [part.type, part.value]));
    const year = byType.get('year');
    const month = byType.get('month');
    const day = byType.get('day');
    if (!year || !month || !day) {
        return fail(
            'invalid_epoch_milliseconds',
            'unable to derive Asia/Taipei trade date',
        );
    }
    return taipeiTradeDate(`${year}-${month}-${day}`);
}

export function createTradingCalendarSnapshot(
    input: TradingCalendarSnapshotInput,
): TradingCalendarSnapshot {
    if (input.schemaVersion !== SMART_ORDER_CALENDAR_SCHEMA_VERSION) {
        return fail(
            'invalid_calendar_version',
            'calendar schema version is not supported',
        );
    }
    const calendarVersion = requireNonEmptyToken(
        input.calendarVersion,
        'calendarVersion',
    );
    const sourceId = requireNonEmptyToken(input.sourceId, 'sourceId');
    const sourceRevision = requireNonEmptyToken(
        input.sourceRevision,
        'sourceRevision',
    );
    const sourceSequence = requireSourceSequence(
        input.sourceSequence,
        'calendar.sourceSequence',
    );
    if (!/^sha256:[0-9a-f]{64}$/.test(input.sourceIntegritySha256)) {
        return fail(
            'invalid_calendar_integrity',
            'source integrity must be a lowercase SHA-256 digest',
        );
    }
    const coverageStart = taipeiTradeDate(input.coverageStart);
    const coverageEnd = taipeiTradeDate(input.coverageEnd);
    const startOrdinal = tradeDateOrdinal(coverageStart);
    const endOrdinal = tradeDateOrdinal(coverageEnd);
    if (endOrdinal < startOrdinal || endOrdinal - startOrdinal > 3_660) {
        return fail(
            'invalid_calendar_snapshot',
            'calendar coverage is reversed or exceeds ten years',
        );
    }
    const generatedAtEpochMs = requireEpochMilliseconds(
        input.generatedAtEpochMs,
        'generatedAtEpochMs',
    );
    const expiresAtEpochMs = requireEpochMilliseconds(
        input.expiresAtEpochMs,
        'expiresAtEpochMs',
    );
    if (expiresAtEpochMs <= generatedAtEpochMs) {
        return fail(
            'invalid_calendar_snapshot',
            'calendar expiry must be after generation',
        );
    }
    if (!Array.isArray(input.days)) {
        return fail('invalid_calendar_snapshot', 'calendar days are required');
    }
    const expectedCount = endOrdinal - startOrdinal + 1;
    if (input.days.length !== expectedCount) {
        return fail(
            'invalid_calendar_snapshot',
            'calendar must explicitly classify every covered date',
        );
    }

    const days = input.days.map((day, index): TradingCalendarDay => {
        const tradeDate = taipeiTradeDate(day.tradeDate);
        if (tradeDateOrdinal(tradeDate) !== startOrdinal + index) {
            return fail(
                'invalid_calendar_snapshot',
                'calendar dates must be unique, contiguous and ordered',
            );
        }
        if (!['trading', 'closed', 'suspended'].includes(day.state)) {
            return fail(
                'invalid_calendar_snapshot',
                'calendar day state is unsupported',
            );
        }
        return Object.freeze({
            tradeDate,
            state: day.state,
            reasonCode: requireNonEmptyToken(day.reasonCode, 'reasonCode'),
            sourceRevision: requireNonEmptyToken(
                day.sourceRevision,
                'day.sourceRevision',
            ),
        });
    });

    const snapshot = Object.freeze({
        schemaVersion: SMART_ORDER_CALENDAR_SCHEMA_VERSION,
        calendarVersion,
        sourceId,
        sourceRevision,
        sourceSequence,
        sourceIntegritySha256:
            input.sourceIntegritySha256 as `sha256:${string}`,
        coverageStart,
        coverageEnd,
        generatedAtEpochMs,
        expiresAtEpochMs,
        days: Object.freeze(days),
    });
    canonicalCalendars.add(snapshot);
    return snapshot;
}

/**
 * Test-only trust seam. Production calendar attestation will be minted by the
 * sidecar source verifier and is deliberately unavailable from ordinary app
 * code. A structurally identical clone is not trusted because trust is bound
 * to object identity in this module.
 */
function attestTradingCalendarSnapshot(
    snapshot: TradingCalendarSnapshot,
): TradingCalendarSnapshot {
    if (
        !canonicalCalendars.has(snapshot) ||
        !Object.isFrozen(snapshot) ||
        !Object.isFrozen(snapshot.days) ||
        snapshot.days.some((day) => !Object.isFrozen(day))
    ) {
        return fail(
            'invalid_calendar_integrity',
            'calendar evidence must be the canonical frozen object created by this verifier',
        );
    }
    const current = calendarHeadsBySource.get(snapshot.sourceId);
    if (current === snapshot) return snapshot;
    const retired = retiredRevisionSet(
        retiredCalendarRevisionsBySource,
        snapshot.sourceId,
    );
    if (!current) {
        if (retired.has(snapshot.sourceRevision)) {
            return fail(
                'invalid_calendar_integrity',
                'a retired calendar source revision cannot become current again',
            );
        }
    } else {
        if (
            snapshot.sourceSequence !== current.sourceSequence + 1 ||
            snapshot.sourceRevision === current.sourceRevision ||
            retired.has(snapshot.sourceRevision) ||
            snapshot.generatedAtEpochMs < current.generatedAtEpochMs
        ) {
            return fail(
                'invalid_calendar_integrity',
                'calendar head must advance revision and adjacent source sequence without generation rollback',
            );
        }
        retired.add(current.sourceRevision);
    }
    trustedCalendars.add(snapshot);
    calendarHeadsBySource.set(snapshot.sourceId, snapshot);
    return snapshot;
}

function issueTrustedTimeEvidence(input: {
    sourceId: string;
    sourceRevision: string;
    sourceSequence: number;
    authorityEpochMs: number;
    observedAtMonotonicNs: MonotonicNanoseconds;
}): TrustedTimeEvidence {
    const authorityEpochMs = requireEpochMilliseconds(
        input.authorityEpochMs,
        'authorityEpochMs',
    );
    const observedAtMonotonicNs = monotonicNanoseconds(
        input.observedAtMonotonicNs,
    );
    const sourceId = requireNonEmptyToken(
        input.sourceId,
        'trustedTime.sourceId',
    );
    const sourceRevision = requireNonEmptyToken(
            input.sourceRevision,
            'trustedTime.sourceRevision',
        );
    const sourceSequence = requireSourceSequence(
        input.sourceSequence,
        'trustedTime.sourceSequence',
    );
    const evidence = Object.freeze({
        sourceId,
        sourceRevision,
        sourceSequence,
        authorityEpochMs,
        observedAtMonotonicNs,
        validUntilMonotonicNs: monotonicNanoseconds(
            observedAtMonotonicNs +
                BigInt(SMART_ORDER_TRUSTED_TIME_TTL_MS) * 1_000_000n,
        ),
    });
    requireNextSourceHead(
        trustedTimeHeadsBySource.get(sourceId),
        evidence,
        retiredRevisionSet(retiredTrustedTimeRevisionsBySource, sourceId),
        'trusted time head',
    );
    trustedTimes.add(evidence);
    trustedTimeHeadsBySource.set(sourceId, evidence);
    return evidence;
}

function issueLocalClockSample(input: {
    clockEpochId: string;
    sequence: number;
    wallEpochMs: number;
    monotonicNs: MonotonicNanoseconds;
}): ClockSample {
    if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) {
        return fail(
            'invalid_monotonic_time',
            'local clock sample sequence must be a non-negative safe integer',
        );
    }
    const sample = Object.freeze({
        clockEpochId: requireNonEmptyToken(
            input.clockEpochId,
            'localClock.clockEpochId',
        ),
        sequence: input.sequence,
        wallEpochMs: requireEpochMilliseconds(
            input.wallEpochMs,
            'localClock.wallEpochMs',
        ),
        monotonicNs: monotonicNanoseconds(input.monotonicNs),
    });
    trustedLocalClockSamples.add(sample);
    return sample;
}

function issueClockSamplePair(input: {
    previous: ClockSample;
    current: ClockSample;
}): TrustedClockSamplePair {
    if (
        !trustedLocalClockSamples.has(input.previous) ||
        !trustedLocalClockSamples.has(input.current) ||
        input.previous === input.current ||
        input.previous.clockEpochId !== input.current.clockEpochId ||
        input.current.sequence !== input.previous.sequence + 1
    ) {
        return fail(
            'invalid_monotonic_time',
            'clock pair must bind adjacent verifier-issued samples in one epoch',
        );
    }
    const pair = Object.freeze({
        clockEpochId: input.current.clockEpochId,
        previousSequence: input.previous.sequence,
        currentSequence: input.current.sequence,
        previous: input.previous,
        current: input.current,
    });
    trustedClockSamplePairs.add(pair);
    return pair;
}

function issueBusinessSessionEvidence(input: {
    sourceId: string;
    sourceRevision: string;
    sourceSequence: number;
    tradeDate: string;
    state: BusinessSessionState;
    observedAtMonotonicNs: MonotonicNanoseconds;
}): TrustedBusinessSessionEvidence {
    if (!['open', 'closed', 'suspended', 'unknown'].includes(input.state)) {
        return fail(
            'invalid_calendar_snapshot',
            'business session state is unsupported',
        );
    }
    const observedAtMonotonicNs = monotonicNanoseconds(
        input.observedAtMonotonicNs,
    );
    const sourceId = requireNonEmptyToken(
        input.sourceId,
        'businessSession.sourceId',
    );
    const sourceRevision = requireNonEmptyToken(
            input.sourceRevision,
            'businessSession.sourceRevision',
        );
    const sourceSequence = requireSourceSequence(
        input.sourceSequence,
        'businessSession.sourceSequence',
    );
    const evidence = Object.freeze({
        sourceId,
        sourceRevision,
        sourceSequence,
        tradeDate: taipeiTradeDate(input.tradeDate),
        state: input.state,
        observedAtMonotonicNs,
        validUntilMonotonicNs: monotonicNanoseconds(
            observedAtMonotonicNs +
                BigInt(SMART_ORDER_BUSINESS_SESSION_TTL_MS) * 1_000_000n,
        ),
    });
    requireNextSourceHead(
        businessSessionHeadsBySource.get(sourceId),
        evidence,
        retiredRevisionSet(
            retiredBusinessSessionRevisionsBySource,
            sourceId,
        ),
        'business session head',
    );
    trustedBusinessSessions.add(evidence);
    businessSessionHeadsBySource.set(sourceId, evidence);
    return evidence;
}

function issueTradingClockEvaluationBundle(input: {
    calendar: TradingCalendarSnapshot;
    clockSamplePair: TrustedClockSamplePair;
    trustedTime: TrustedTimeEvidence | null;
    businessSession: TrustedBusinessSessionEvidence | null;
}): TrustedTradingClockEvaluationBundle {
    if (
        !trustedCalendars.has(input.calendar) ||
        calendarHeadsBySource.get(input.calendar.sourceId) !== input.calendar ||
        !trustedClockSamplePairs.has(input.clockSamplePair) ||
        (input.trustedTime !== null && !trustedTimes.has(input.trustedTime)) ||
        (input.businessSession !== null &&
            !trustedBusinessSessions.has(input.businessSession))
    ) {
        return fail(
            'invalid_calendar_integrity',
            'clock evaluation bundle requires verifier-issued components',
        );
    }
    if (
        (input.trustedTime !== null &&
            trustedTimeHeadsBySource.get(input.trustedTime.sourceId) !==
                input.trustedTime) ||
        (input.businessSession !== null &&
            businessSessionHeadsBySource.get(
                input.businessSession.sourceId,
            ) !== input.businessSession)
    ) {
        return fail(
            'invalid_calendar_integrity',
            'clock evaluation bundle must bind the current time and session source heads',
        );
    }
    const pair = input.clockSamplePair;
    if (
        pair.previous === pair.current ||
        pair.clockEpochId !== pair.previous.clockEpochId ||
        pair.clockEpochId !== pair.current.clockEpochId ||
        pair.previousSequence !== pair.previous.sequence ||
        pair.currentSequence !== pair.current.sequence ||
        pair.currentSequence !== pair.previousSequence + 1
    ) {
        return fail(
            'invalid_monotonic_time',
            'clock evaluation bundle requires an adjacent sample pair',
        );
    }
    if (verifierClockHead !== null) {
        if (verifierClockHead.clockEpochId === pair.clockEpochId) {
            if (
                pair.previous !== verifierClockHead ||
                pair.previousSequence !== verifierClockHead.sequence ||
                pair.currentSequence !== verifierClockHead.sequence + 1
            ) {
                return fail(
                    'invalid_monotonic_time',
                    'same-epoch clock head must advance by one adjacent sample',
                );
            }
        } else {
            retiredClockEpochIds.add(verifierClockHead.clockEpochId);
            if (retiredClockEpochIds.has(pair.clockEpochId)) {
                return fail(
                    'invalid_monotonic_time',
                    'a retired clock epoch cannot become current again',
                );
            }
        }
    } else if (retiredClockEpochIds.has(pair.clockEpochId)) {
        return fail(
            'invalid_monotonic_time',
            'a retired clock epoch cannot become current again',
        );
    }
    const issuedAtMonotonicNs = pair.current.monotonicNs;
    const bundle = Object.freeze({
        calendar: input.calendar,
        calendarHead: input.calendar,
        clockSamplePair: pair,
        trustedTime: input.trustedTime,
        businessSession: input.businessSession,
        clockEpochId: pair.clockEpochId,
        previousSequence: pair.previousSequence,
        currentSequence: pair.currentSequence,
        issuedAtMonotonicNs,
        validUntilMonotonicNs: monotonicNanoseconds(
            issuedAtMonotonicNs +
                BigInt(SMART_ORDER_CLOCK_EVALUATION_TTL_MS) * 1_000_000n,
        ),
        trustedTimeHead: input.trustedTime,
        businessSessionHead: input.businessSession,
    });
    verifierClockHead = pair.current;
    trustedClockEvaluationBundles.add(bundle);
    return bundle;
}

function resetClockVerifier(): void {
    verifierClockHead = null;
    retiredClockEpochIds.clear();
    calendarHeadsBySource.clear();
    retiredCalendarRevisionsBySource.clear();
    trustedTimeHeadsBySource.clear();
    retiredTrustedTimeRevisionsBySource.clear();
    businessSessionHeadsBySource.clear();
    retiredBusinessSessionRevisionsBySource.clear();
}

export function monotonicDurationNanoseconds(
    start: MonotonicNanoseconds,
    end: MonotonicNanoseconds,
): bigint {
    if (end < start) {
        return fail(
            'invalid_monotonic_time',
            'monotonic clock must not move backwards',
        );
    }
    return end - start;
}

export function evaluateClockContinuity(input: {
    previous: ClockSample;
    current: ClockSample;
    maxSkewMs?: number;
}): ClockContinuity {
    const maxSkewMs = input.maxSkewMs ?? SMART_ORDER_MAX_CLOCK_JUMP_SKEW_MS;
    if (
        !Number.isSafeInteger(maxSkewMs) ||
        maxSkewMs < 0 ||
        maxSkewMs > SMART_ORDER_MAX_CLOCK_JUMP_SKEW_MS
    ) {
        return fail(
            'invalid_clock_threshold',
            'clock skew threshold cannot exceed the fixed safety ceiling',
        );
    }
    requireEpochMilliseconds(input.previous.wallEpochMs, 'previous.wallEpochMs');
    requireEpochMilliseconds(input.current.wallEpochMs, 'current.wallEpochMs');
    if (
        input.previous === input.current ||
        input.previous.clockEpochId !== input.current.clockEpochId ||
        !Number.isSafeInteger(input.previous.sequence) ||
        !Number.isSafeInteger(input.current.sequence) ||
        input.previous.sequence < 0 ||
        input.current.sequence <= input.previous.sequence
    ) {
        return Object.freeze({
            kind: 'monotonic_regression',
            wallDeltaMs:
                BigInt(input.current.wallEpochMs) -
                BigInt(input.previous.wallEpochMs),
            monotonicDeltaNs:
                input.current.monotonicNs - input.previous.monotonicNs,
            absoluteSkewNs: 0n,
        });
    }
    const wallDeltaMs =
        BigInt(input.current.wallEpochMs) -
        BigInt(input.previous.wallEpochMs);
    const monotonicDeltaNs =
        input.current.monotonicNs - input.previous.monotonicNs;
    if (monotonicDeltaNs < 0n) {
        return Object.freeze({
            kind: 'monotonic_regression',
            wallDeltaMs,
            monotonicDeltaNs,
            absoluteSkewNs: -monotonicDeltaNs,
        });
    }
    const skewNs = wallDeltaMs * 1_000_000n - monotonicDeltaNs;
    const absoluteSkewNs = skewNs < 0n ? -skewNs : skewNs;
    const thresholdNs = BigInt(maxSkewMs) * 1_000_000n;
    const kind =
        absoluteSkewNs <= thresholdNs
            ? 'continuous'
            : skewNs > 0n
              ? 'jump_forward'
              : 'jump_backward';
    return Object.freeze({
        kind,
        wallDeltaMs,
        monotonicDeltaNs,
        absoluteSkewNs,
    });
}

function absoluteMilliseconds(left: number, right: number): bigint {
    const difference = BigInt(left) - BigInt(right);
    return difference < 0n ? -difference : difference;
}

export function evaluateTradingClock(
    bundle: TrustedTradingClockEvaluationBundle,
): TradingClockReadiness {
    const calendarVersion =
        bundle &&
        typeof bundle === 'object' &&
        bundle.calendar &&
        typeof bundle.calendar.calendarVersion === 'string'
            ? bundle.calendar.calendarVersion
            : 'untrusted-calendar';
    if (!trustedClockEvaluationBundles.has(bundle)) {
        return Object.freeze({
            ready: false,
            reason: 'clock_evaluation_untrusted',
            calendarVersion,
        });
    }
    if (consumedClockEvaluationBundles.has(bundle)) {
        return Object.freeze({
            ready: false,
            reason: 'clock_evaluation_replayed',
            calendarVersion,
        });
    }
    const pair = bundle.clockSamplePair;
    const head = verifierClockHead;
    if (
        bundle.calendarHead !== bundle.calendar ||
        calendarHeadsBySource.get(bundle.calendar.sourceId) !==
            bundle.calendar ||
        bundle.trustedTimeHead !== bundle.trustedTime ||
        bundle.businessSessionHead !== bundle.businessSession ||
        (bundle.trustedTime !== null &&
            trustedTimeHeadsBySource.get(bundle.trustedTime.sourceId) !==
                bundle.trustedTime) ||
        (bundle.businessSession !== null &&
            businessSessionHeadsBySource.get(
                bundle.businessSession.sourceId,
            ) !== bundle.businessSession)
    ) {
        return Object.freeze({
            ready: false,
            reason:
                calendarHeadsBySource.get(bundle.calendar.sourceId) !==
                    bundle.calendar
                    ? 'calendar_untrusted'
                    : bundle.trustedTime !== null &&
                trustedTimeHeadsBySource.get(bundle.trustedTime.sourceId) !==
                    bundle.trustedTime
                    ? 'trusted_time_untrusted'
                    : 'business_session_untrusted',
            calendarVersion,
        });
    }
    if (
        head === null ||
        pair.current !== head ||
        bundle.clockEpochId !== head.clockEpochId ||
        bundle.currentSequence !== head.sequence ||
        bundle.issuedAtMonotonicNs !== head.monotonicNs
    ) {
        return Object.freeze({
            ready: false,
            reason:
                head !== null &&
                head.monotonicNs > bundle.validUntilMonotonicNs
                    ? 'clock_evaluation_stale'
                    : 'clock_evaluation_untrusted',
            calendarVersion,
        });
    }
    if (
        !trustedClockSamplePairs.has(pair) ||
        !trustedLocalClockSamples.has(pair.previous) ||
        !trustedLocalClockSamples.has(pair.current) ||
        pair.currentSequence !== pair.previousSequence + 1 ||
        bundle.previousSequence !== pair.previousSequence ||
        bundle.currentSequence !== pair.currentSequence ||
        head.monotonicNs > bundle.validUntilMonotonicNs
    ) {
        return Object.freeze({
            ready: false,
            reason:
                head.monotonicNs > bundle.validUntilMonotonicNs
                    ? 'clock_evaluation_stale'
                    : 'clock_evaluation_untrusted',
            calendarVersion,
        });
    }
    consumedClockEvaluationBundles.add(bundle);
    const input = {
        calendar: bundle.calendar,
        currentClockSample: pair.current,
        clockSamplePair: pair,
        trustedTime: bundle.trustedTime,
        businessSession: bundle.businessSession,
        previousClockSample: pair.previous,
    } as const;
    if (!trustedCalendars.has(input.calendar)) {
        return Object.freeze({
            ready: false,
            reason: 'calendar_untrusted',
            calendarVersion: input.calendar.calendarVersion,
        });
    }
    if (!trustedLocalClockSamples.has(input.currentClockSample)) {
        return Object.freeze({
            ready: false,
            reason: 'local_clock_untrusted',
            calendarVersion: input.calendar.calendarVersion,
        });
    }
    const wallEpochMs = input.currentClockSample.wallEpochMs;
    const currentMonotonicNs = input.currentClockSample.monotonicNs;
    if (input.trustedTime === null) {
        return Object.freeze({
            ready: false,
            reason: 'trusted_time_missing',
            calendarVersion: input.calendar.calendarVersion,
        });
    }
    if (!trustedTimes.has(input.trustedTime)) {
        return Object.freeze({
            ready: false,
            reason: 'trusted_time_untrusted',
            calendarVersion: input.calendar.calendarVersion,
        });
    }
    if (
        currentMonotonicNs < input.trustedTime.observedAtMonotonicNs ||
        currentMonotonicNs > input.trustedTime.validUntilMonotonicNs
    ) {
        return Object.freeze({
            ready: false,
            reason:
                currentMonotonicNs < input.trustedTime.observedAtMonotonicNs
                    ? 'monotonic_regression'
                    : 'trusted_time_stale',
            calendarVersion: input.calendar.calendarVersion,
        });
    }
    const authorityDeltaMs =
        (currentMonotonicNs - input.trustedTime.observedAtMonotonicNs) /
        1_000_000n;
    const trustedEpochBigInt =
        BigInt(input.trustedTime.authorityEpochMs) + authorityDeltaMs;
    if (trustedEpochBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
        return fail(
            'invalid_epoch_milliseconds',
            'projected trusted time exceeds safe epoch range',
        );
    }
    const trustedEpochMs = Number(trustedEpochBigInt);
    const trustedSkewMs = absoluteMilliseconds(wallEpochMs, trustedEpochMs);
    if (trustedSkewMs > BigInt(SMART_ORDER_MAX_TRUSTED_SKEW_MS)) {
        return Object.freeze({
            ready: false,
            reason: 'trusted_time_skew',
            calendarVersion: input.calendar.calendarVersion,
            trustedSkewMs,
        });
    }
    if (input.previousClockSample === null) {
        return Object.freeze({
            ready: false,
            reason: 'clock_baseline_missing',
            calendarVersion: input.calendar.calendarVersion,
            trustedSkewMs,
        });
    }
    if (!trustedLocalClockSamples.has(input.previousClockSample)) {
        return Object.freeze({
            ready: false,
            reason: 'local_clock_untrusted',
            calendarVersion: input.calendar.calendarVersion,
            trustedSkewMs,
        });
    }
    if (
        input.clockSamplePair === null ||
        !trustedClockSamplePairs.has(input.clockSamplePair) ||
        input.clockSamplePair.previous !== input.previousClockSample ||
        input.clockSamplePair.current !== input.currentClockSample ||
        input.clockSamplePair.clockEpochId !==
            input.currentClockSample.clockEpochId ||
        input.clockSamplePair.previousSequence !==
            input.previousClockSample.sequence ||
        input.clockSamplePair.currentSequence !==
            input.currentClockSample.sequence
    ) {
        return Object.freeze({
            ready: false,
            reason: 'local_clock_untrusted',
            calendarVersion: input.calendar.calendarVersion,
            trustedSkewMs,
        });
    }
    const continuity = evaluateClockContinuity({
        previous: input.previousClockSample,
        current: input.currentClockSample,
    });
    if (continuity.kind === 'monotonic_regression') {
        return Object.freeze({
            ready: false,
            reason: 'monotonic_regression',
            calendarVersion: input.calendar.calendarVersion,
            trustedSkewMs,
        });
    }
    if (continuity.kind !== 'continuous') {
        return Object.freeze({
            ready: false,
            reason: 'clock_jump',
            calendarVersion: input.calendar.calendarVersion,
            trustedSkewMs,
        });
    }

    if (trustedEpochMs < input.calendar.generatedAtEpochMs) {
        return Object.freeze({
            ready: false,
            reason: 'calendar_not_yet_valid',
            calendarVersion: input.calendar.calendarVersion,
            trustedSkewMs,
        });
    }
    if (trustedEpochMs >= input.calendar.expiresAtEpochMs) {
        return Object.freeze({
            ready: false,
            reason: 'calendar_expired',
            calendarVersion: input.calendar.calendarVersion,
            trustedSkewMs,
        });
    }

    const tradeDate = taipeiTradeDateFromEpochMilliseconds(trustedEpochMs);
    const startOrdinal = tradeDateOrdinal(input.calendar.coverageStart);
    const index = tradeDateOrdinal(tradeDate) - startOrdinal;
    const day = input.calendar.days[index];
    if (!day || day.tradeDate !== tradeDate) {
        return Object.freeze({
            ready: false,
            reason: 'unknown_trade_date',
            tradeDate,
            calendarVersion: input.calendar.calendarVersion,
            trustedSkewMs,
        });
    }
    if (input.businessSession === null) {
        return Object.freeze({
            ready: false,
            reason: 'business_session_missing',
            tradeDate,
            calendarVersion: input.calendar.calendarVersion,
            trustedSkewMs,
        });
    }
    if (!trustedBusinessSessions.has(input.businessSession)) {
        return Object.freeze({
            ready: false,
            reason: 'business_session_untrusted',
            tradeDate,
            calendarVersion: input.calendar.calendarVersion,
            trustedSkewMs,
        });
    }
    if (
        currentMonotonicNs < input.businessSession.observedAtMonotonicNs ||
        currentMonotonicNs > input.businessSession.validUntilMonotonicNs
    ) {
        return Object.freeze({
            ready: false,
            reason:
                currentMonotonicNs <
                input.businessSession.observedAtMonotonicNs
                    ? 'monotonic_regression'
                    : 'business_session_stale',
            tradeDate,
            calendarVersion: input.calendar.calendarVersion,
            trustedSkewMs,
        });
    }
    if (input.businessSession.tradeDate !== tradeDate) {
        return Object.freeze({
            ready: false,
            reason: 'business_session_mismatch',
            tradeDate,
            calendarVersion: input.calendar.calendarVersion,
            trustedSkewMs,
        });
    }
    if (input.businessSession.state === 'unknown') {
        return Object.freeze({
            ready: false,
            reason: 'business_session_unknown',
            tradeDate,
            calendarVersion: input.calendar.calendarVersion,
            trustedSkewMs,
        });
    }
    if (day.state === 'closed') {
        if (input.businessSession.state === 'open') {
            return Object.freeze({
                ready: false,
                reason: 'business_session_mismatch',
                tradeDate,
                calendarVersion: input.calendar.calendarVersion,
                trustedSkewMs,
            });
        }
        return Object.freeze({
            ready: false,
            reason: 'non_trading_day',
            tradeDate,
            calendarVersion: input.calendar.calendarVersion,
            trustedSkewMs,
        });
    }
    if (day.state === 'suspended') {
        if (input.businessSession.state === 'open') {
            return Object.freeze({
                ready: false,
                reason: 'business_session_mismatch',
                tradeDate,
                calendarVersion: input.calendar.calendarVersion,
                trustedSkewMs,
            });
        }
        return Object.freeze({
            ready: false,
            reason: 'suspended_session',
            tradeDate,
            calendarVersion: input.calendar.calendarVersion,
            trustedSkewMs,
        });
    }
    if (input.businessSession.state !== 'open') {
        return Object.freeze({
            ready: false,
            reason: 'business_session_mismatch',
            tradeDate,
            calendarVersion: input.calendar.calendarVersion,
            trustedSkewMs,
        });
    }
    return Object.freeze({
        ready: true,
        tradeDate,
        calendarVersion: input.calendar.calendarVersion,
        day,
        trustedSkewMs,
    });
}

/**
 * Explicit unit-test support surface. A production library build defines the
 * compile-time marker as false, making this value statically `undefined` and
 * allowing bundlers to remove every issuer implementation and object key.
 * This module therefore needs neither Vite ImportMeta ambient types nor Node
 * ambient types.
 */
export const SMART_ORDER_CALENDAR_TEST_ONLY =
    SMART_ORDER_DOMAIN_TEST_MODE
        ? Object.freeze({
              attestTradingCalendarSnapshot,
              issueTrustedTimeEvidence,
              issueLocalClockSample,
              issueClockSamplePair,
              issueBusinessSessionEvidence,
              issueTradingClockEvaluationBundle,
              resetClockVerifier,
          })
        : undefined;
