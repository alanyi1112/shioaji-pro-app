import { beforeEach, describe, expect, it } from 'vitest';
import {
    SMART_ORDER_CALENDAR_SCHEMA_VERSION,
    SMART_ORDER_CALENDAR_TEST_ONLY,
    SMART_ORDER_CLOCK_EVALUATION_TTL_MS,
    SmartOrderCalendarError,
    createTradingCalendarSnapshot,
    evaluateClockContinuity,
    evaluateTradingClock,
    monotonicDurationNanoseconds,
    monotonicNanoseconds,
    taipeiTradeDate,
    taipeiTradeDateFromEpochMilliseconds,
    type TradingCalendarSnapshot,
    type TradingCalendarSnapshotInput,
} from './smart-order-domain-calendar';

const HASH = `sha256:${'a'.repeat(64)}`;

if (!SMART_ORDER_CALENDAR_TEST_ONLY) {
    throw new Error('calendar test support surface is unavailable in Vitest');
}
const CALENDAR_TEST_ONLY = SMART_ORDER_CALENDAR_TEST_ONLY;
let clockEpochCounter = 0;
let trustedTimeSourceSequence = 0;
let businessSessionSourceSequence = 0;
let cachedCalendar: TradingCalendarSnapshot | null = null;

beforeEach(() => {
    CALENDAR_TEST_ONLY.resetClockVerifier();
    clockEpochCounter = 0;
    trustedTimeSourceSequence = 0;
    businessSessionSourceSequence = 0;
    cachedCalendar = null;
});

function epoch(value: string): number {
    return Date.parse(value);
}

function clockSample(
    wallEpochMs: number,
    monotonicNs: bigint,
    sequence: number,
    clockEpochId = 'clock-epoch-1',
) {
    return {
        clockEpochId,
        sequence,
        wallEpochMs,
        monotonicNs: monotonicNanoseconds(monotonicNs),
    } as const;
}

function calendarInput(
    overrides: Partial<TradingCalendarSnapshotInput> = {},
): TradingCalendarSnapshotInput {
    const days: TradingCalendarSnapshotInput['days'] = [
        {
            tradeDate: '2026-08-10',
            state: 'trading',
            reasonCode: 'REGULAR_SESSION',
            sourceRevision: 'r1',
        },
        {
            tradeDate: '2026-08-11',
            state: 'closed',
            reasonCode: 'OFFICIAL_CLOSURE',
            sourceRevision: 'r1',
        },
        {
            tradeDate: '2026-08-12',
            state: 'suspended',
            reasonCode: 'EMERGENCY_SUSPENSION',
            sourceRevision: 'r2',
        },
    ];
    return {
        schemaVersion: SMART_ORDER_CALENDAR_SCHEMA_VERSION,
        calendarVersion: 'twse-tpex-2026-08-11-r1',
        sourceId: 'official-calendar-fixture',
        sourceRevision: 'r1',
        sourceSequence: 1,
        sourceIntegritySha256: HASH,
        coverageStart: '2026-08-10',
        coverageEnd: '2026-08-12',
        generatedAtEpochMs: epoch('2026-08-09T00:00:00.000Z'),
        expiresAtEpochMs: epoch('2026-08-13T00:00:00.000Z'),
        days,
        ...overrides,
    };
}

function calendar() {
    if (cachedCalendar) return cachedCalendar;
    cachedCalendar = CALENDAR_TEST_ONLY.attestTradingCalendarSnapshot(
        createTradingCalendarSnapshot(calendarInput()),
    );
    return cachedCalendar;
}

function expectCalendarError(
    action: () => unknown,
    code: SmartOrderCalendarError['code'],
): void {
    try {
        action();
        throw new Error('expected SmartOrderCalendarError');
    } catch (error) {
        expect(error).toBeInstanceOf(SmartOrderCalendarError);
        expect((error as SmartOrderCalendarError).code).toBe(code);
    }
}

describe('smart-order versioned trading calendar', () => {
    it('exposes issuers only through the frozen explicit test-support surface', () => {
        expect(Object.isFrozen(CALENDAR_TEST_ONLY)).toBe(true);
        expect(Object.keys(CALENDAR_TEST_ONLY).sort()).toEqual([
            'attestTradingCalendarSnapshot',
            'issueBusinessSessionEvidence',
            'issueClockSamplePair',
            'issueLocalClockSample',
            'issueTradingClockEvaluationBundle',
            'issueTrustedTimeEvidence',
            'resetClockVerifier',
        ]);
    });

    it('classifies every covered date explicitly and freezes the snapshot', () => {
        const snapshot = calendar();
        expect(snapshot.days.map((day) => day.state)).toEqual([
            'trading',
            'closed',
            'suspended',
        ]);
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.days)).toBe(true);
        expect(Object.isFrozen(snapshot.days[0])).toBe(true);
    });

    it('rejects missing, duplicate or out-of-order calendar dates', () => {
        const base = {
            schemaVersion: SMART_ORDER_CALENDAR_SCHEMA_VERSION,
            calendarVersion: 'r1',
            sourceId: 'fixture',
            sourceRevision: 'r1',
            sourceSequence: 1,
            sourceIntegritySha256: HASH,
            coverageStart: '2026-08-10',
            coverageEnd: '2026-08-11',
            generatedAtEpochMs: 1,
            expiresAtEpochMs: 2,
        } as const;
        expectCalendarError(
            () =>
                createTradingCalendarSnapshot({
                    ...base,
                    days: [
                        {
                            tradeDate: '2026-08-10',
                            state: 'trading',
                            reasonCode: 'OPEN',
                            sourceRevision: 'r1',
                        },
                    ],
                }),
            'invalid_calendar_snapshot',
        );
        expectCalendarError(
            () =>
                createTradingCalendarSnapshot({
                    ...base,
                    days: [
                        {
                            tradeDate: '2026-08-11',
                            state: 'closed',
                            reasonCode: 'CLOSED',
                            sourceRevision: 'r1',
                        },
                        {
                            tradeDate: '2026-08-10',
                            state: 'trading',
                            reasonCode: 'OPEN',
                            sourceRevision: 'r1',
                        },
                    ],
                }),
            'invalid_calendar_snapshot',
        );
    });

    it('rejects invalid dates and unversioned integrity evidence', () => {
        expectCalendarError(
            () => taipeiTradeDate('2026-02-30'),
            'invalid_trade_date',
        );
        expectCalendarError(
            () =>
                createTradingCalendarSnapshot({
                    schemaVersion: SMART_ORDER_CALENDAR_SCHEMA_VERSION,
                    calendarVersion: 'r1',
                    sourceId: 'fixture',
                    sourceRevision: 'r1',
                    sourceSequence: 1,
                    sourceIntegritySha256: 'not-a-hash',
                    coverageStart: '2026-08-10',
                    coverageEnd: '2026-08-10',
                    generatedAtEpochMs: 1,
                    expiresAtEpochMs: 2,
                    days: [
                        {
                            tradeDate: '2026-08-10',
                            state: 'trading',
                            reasonCode: 'OPEN',
                            sourceRevision: 'r1',
                        },
                    ],
                }),
            'invalid_calendar_integrity',
        );
    });

    it('attests only canonical snapshots and permanently retires an older same-source revision', () => {
        const r1 = calendar();
        expectCalendarError(
            () =>
                CALENDAR_TEST_ONLY.attestTradingCalendarSnapshot(
                    Object.freeze({ ...r1 }),
                ),
            'invalid_calendar_integrity',
        );

        const r2 = createTradingCalendarSnapshot(
            calendarInput({
                calendarVersion: 'twse-tpex-2026-08-11-r2',
                sourceRevision: 'r2',
                sourceSequence: 2,
                sourceIntegritySha256: `sha256:${'b'.repeat(64)}`,
                generatedAtEpochMs: epoch('2026-08-09T00:00:01.000Z'),
            }),
        );
        expect(
            CALENDAR_TEST_ONLY.attestTradingCalendarSnapshot(r2),
        ).toBe(r2);
        expectCalendarError(
            () => CALENDAR_TEST_ONLY.attestTradingCalendarSnapshot(r1),
            'invalid_calendar_integrity',
        );

        const rollback = createTradingCalendarSnapshot(
            calendarInput({
                calendarVersion: 'twse-tpex-2026-08-11-r3',
                sourceRevision: 'r1',
                sourceSequence: 3,
                generatedAtEpochMs: epoch('2026-08-09T00:00:02.000Z'),
            }),
        );
        expectCalendarError(
            () =>
                CALENDAR_TEST_ONLY.attestTradingCalendarSnapshot(rollback),
            'invalid_calendar_integrity',
        );
    });
});

describe('Asia/Taipei time and monotonic duration', () => {
    it('derives the Taipei date at the UTC+8 boundary without host timezone', () => {
        expect(
            taipeiTradeDateFromEpochMilliseconds(
                epoch('2026-08-09T15:59:59.999Z'),
            ),
        ).toBe('2026-08-09');
        expect(
            taipeiTradeDateFromEpochMilliseconds(
                epoch('2026-08-09T16:00:00.000Z'),
            ),
        ).toBe('2026-08-10');
        expect(
            taipeiTradeDateFromEpochMilliseconds(
                epoch('2026-12-31T16:00:00.000Z'),
            ),
        ).toBe('2027-01-01');
    });

    it('uses monotonic bigint duration and rejects regression', () => {
        expect(
            monotonicDurationNanoseconds(
                monotonicNanoseconds(1_000_000_000n),
                monotonicNanoseconds(3_500_000_000n),
            ),
        ).toBe(2_500_000_000n);
        expectCalendarError(
            () =>
                monotonicDurationNanoseconds(
                    monotonicNanoseconds(2n),
                    monotonicNanoseconds(1n),
                ),
            'invalid_monotonic_time',
        );
    });

    it('detects forward, backward and monotonic clock anomalies', () => {
        const previous = clockSample(1_000, 1_000_000_000n, 1);
        expect(
            evaluateClockContinuity({
                previous,
                current: clockSample(2_000, 2_000_000_000n, 2),
                maxSkewMs: 2,
            }).kind,
        ).toBe('continuous');
        expect(
            evaluateClockContinuity({
                previous,
                current: clockSample(7_000, 2_000_000_000n, 2),
                maxSkewMs: 2_000,
            }).kind,
        ).toBe('jump_forward');
        expect(
            evaluateClockContinuity({
                previous: clockSample(7_000, 1_000_000_000n, 1),
                current: clockSample(2_000, 2_000_000_000n, 2),
                maxSkewMs: 2_000,
            }).kind,
        ).toBe('jump_backward');
        expect(
            evaluateClockContinuity({
                previous: clockSample(1_000, 2n, 1),
                current: clockSample(1_001, 1n, 2),
                maxSkewMs: 2,
            }).kind,
        ).toBe('monotonic_regression');
    });
});

describe('smart-order trading clock readiness', () => {
    function readyInput(
        now: number,
        options: {
            calendar?: ReturnType<typeof calendar>;
            tradeDate?: string;
            sessionState?: 'open' | 'closed' | 'suspended' | 'unknown';
            authorityEpochMs?: number;
            observedAtMonotonicNs?: bigint;
            trustedTimeMissing?: boolean;
            businessSessionMissing?: boolean;
            clockEpochId?: string;
            previousWallEpochMs?: number;
            previousMonotonicNs?: bigint;
            currentMonotonicNs?: bigint;
            trustedTimeSourceId?: string;
            businessSessionSourceId?: string;
        } = {},
    ) {
        const clockEpochId =
            options.clockEpochId ?? `clock-epoch-${++clockEpochCounter}`;
        const observedAtMonotonicNs = monotonicNanoseconds(
            options.observedAtMonotonicNs ?? 9_000_000_000n,
        );
        const previousClockSample = CALENDAR_TEST_ONLY.issueLocalClockSample({
            clockEpochId,
            sequence: 1,
            wallEpochMs: options.previousWallEpochMs ?? now - 1_000,
            monotonicNs: monotonicNanoseconds(
                options.previousMonotonicNs ?? 9_000_000_000n,
            ),
        });
        const currentClockSample = CALENDAR_TEST_ONLY.issueLocalClockSample({
            clockEpochId,
            sequence: 2,
            wallEpochMs: now,
            monotonicNs: monotonicNanoseconds(
                options.currentMonotonicNs ?? 10_000_000_000n,
            ),
        });
        const clockSamplePair = CALENDAR_TEST_ONLY.issueClockSamplePair({
            previous: previousClockSample,
            current: currentClockSample,
        });
        const trustedTime = options.trustedTimeMissing
            ? null
            : CALENDAR_TEST_ONLY.issueTrustedTimeEvidence({
                  sourceId:
                      options.trustedTimeSourceId ?? 'trusted-clock-fixture',
                  sourceRevision: `clock-r${++trustedTimeSourceSequence}`,
                  sourceSequence: trustedTimeSourceSequence,
                  authorityEpochMs:
                      options.authorityEpochMs ?? now - 1_000,
                  observedAtMonotonicNs,
              });
        const businessSession = options.businessSessionMissing
            ? null
            : CALENDAR_TEST_ONLY.issueBusinessSessionEvidence({
                  sourceId:
                      options.businessSessionSourceId ??
                      'business-session-fixture',
                  sourceRevision: `session-r${++businessSessionSourceSequence}`,
                  sourceSequence: businessSessionSourceSequence,
                  tradeDate: options.tradeDate ?? '2026-08-10',
                  state: options.sessionState ?? 'open',
                  observedAtMonotonicNs,
              });
        return CALENDAR_TEST_ONLY.issueTradingClockEvaluationBundle({
            calendar: options.calendar ?? calendar(),
            clockSamplePair,
            trustedTime,
            businessSession,
        });
    }

    it('allows only an explicitly classified trading date', () => {
        const now = epoch('2026-08-10T01:00:00.000Z');
        expect(
            evaluateTradingClock(readyInput(now)),
        ).toMatchObject({
            ready: true,
            tradeDate: '2026-08-10',
            trustedSkewMs: 0n,
        });

        const closed = epoch('2026-08-11T01:00:00.000Z');
        expect(
            evaluateTradingClock(
                readyInput(closed, {
                    tradeDate: '2026-08-11',
                    sessionState: 'closed',
                }),
            ),
        ).toMatchObject({
            ready: false,
            reason: 'non_trading_day',
            tradeDate: '2026-08-11',
        });
    });

    it('blocks an official temporary suspension without guessing a weekday session', () => {
        const suspended = epoch('2026-08-12T01:00:00.000Z');

        expect(
            evaluateTradingClock(
                readyInput(suspended, {
                    tradeDate: '2026-08-12',
                    sessionState: 'suspended',
                }),
            ),
        ).toMatchObject({
            ready: false,
            reason: 'suspended_session',
            tradeDate: '2026-08-12',
        });
    });

    it('blocks an early close when the business session closes on a trading day', () => {
        const now = epoch('2026-08-10T04:00:00.000Z');

        expect(
            evaluateTradingClock(
                readyInput(now, {
                    tradeDate: '2026-08-10',
                    sessionState: 'closed',
                }),
            ),
        ).toMatchObject({
            ready: false,
            reason: 'business_session_mismatch',
            tradeDate: '2026-08-10',
        });
    });

    it('fails closed for missing time, skew, unknown date and suspension', () => {
        const now = epoch('2026-08-10T01:00:00.000Z');
        const missingTimeBundle = readyInput(now, {
            trustedTimeMissing: true,
        });
        expect(
            evaluateTradingClock(missingTimeBundle),
        ).toMatchObject({ ready: false, reason: 'trusted_time_missing' });
        expect(evaluateTradingClock(missingTimeBundle)).toMatchObject({
            ready: false,
            reason: 'clock_evaluation_replayed',
        });
        expect(
            evaluateTradingClock(
                readyInput(now, { authorityEpochMs: now + 1_001 }),
            ),
        ).toMatchObject({ ready: false, reason: 'trusted_time_skew' });

        const suspended = epoch('2026-08-12T01:00:00.000Z');
        expect(
            evaluateTradingClock(
                readyInput(suspended, {
                    tradeDate: '2026-08-12',
                    sessionState: 'suspended',
                }),
            ),
        ).toMatchObject({
            ready: false,
            reason: 'suspended_session',
        });

        const outside = epoch('2026-08-13T00:30:00.000Z');
        const notExpiredCalendar =
            CALENDAR_TEST_ONLY.attestTradingCalendarSnapshot(
                createTradingCalendarSnapshot(
                    calendarInput({
                        calendarVersion: 'outside-calendar-r1',
                        sourceId: 'outside-calendar-fixture',
                        expiresAtEpochMs: outside + 10_000,
                    }),
                ),
            );
        expect(
            evaluateTradingClock(
                readyInput(outside, {
                    calendar: notExpiredCalendar,
                    tradeDate: '2026-08-13',
                    sessionState: 'unknown',
                }),
            ),
        ).toMatchObject({ ready: false, reason: 'unknown_trade_date' });
    });

    it('blocks a wall-clock jump even when the trusted clock is currently close', () => {
        const now = epoch('2026-08-10T01:00:00.000Z');
        expect(
            evaluateTradingClock(
                readyInput(now, {
                    previousWallEpochMs: now - 10_000,
                    previousMonotonicNs: 9_999_000_000n,
                }),
            ),
        ).toMatchObject({ ready: false, reason: 'clock_jump' });
    });

    it('rejects forged evaluation bundles/components and stale evidence', () => {
        const now = epoch('2026-08-10T01:00:00.000Z');
        const canonical = readyInput(now);
        expect(
            evaluateTradingClock({
                ...canonical,
            }),
        ).toMatchObject({
            ready: false,
            reason: 'clock_evaluation_untrusted',
        });
        expectCalendarError(
            () =>
                CALENDAR_TEST_ONLY.issueTradingClockEvaluationBundle({
                    calendar: Object.freeze({ ...canonical.calendar }),
                    clockSamplePair: canonical.clockSamplePair,
                    trustedTime: canonical.trustedTime,
                    businessSession: canonical.businessSession,
                }),
            'invalid_calendar_integrity',
        );
        expectCalendarError(
            () =>
                CALENDAR_TEST_ONLY.issueTradingClockEvaluationBundle({
                    calendar: canonical.calendar,
                    clockSamplePair: canonical.clockSamplePair,
                    trustedTime: canonical.trustedTime
                        ? Object.freeze({ ...canonical.trustedTime })
                        : null,
                    businessSession: canonical.businessSession,
                }),
            'invalid_calendar_integrity',
        );
        expect(evaluateTradingClock(canonical)).toMatchObject({ ready: true });
        expect(evaluateTradingClock(canonical)).toMatchObject({
            ready: false,
            reason: 'clock_evaluation_replayed',
        });
        expect(
            evaluateTradingClock(
                readyInput(now, {
                    observedAtMonotonicNs: 0n,
                    trustedTimeSourceId: 'stale-clock-fixture',
                    businessSessionSourceId: 'stale-session-fixture',
                }),
            ),
        ).toMatchObject({ ready: false, reason: 'trusted_time_stale' });
    });

    it('rejects an unused old pair/time/session bundle after the verifier head advances', () => {
        const now = epoch('2026-08-10T01:00:00.000Z');
        const oldBundle = readyInput(now, {
            clockEpochId: 'replay-epoch',
        });
        const previous = oldBundle.clockSamplePair.current;
        const nextMonotonicNs = monotonicNanoseconds(
            oldBundle.validUntilMonotonicNs + 1n,
        );
        const nextWallEpochMs =
            previous.wallEpochMs +
            Number((nextMonotonicNs - previous.monotonicNs) / 1_000_000n);
        const current = CALENDAR_TEST_ONLY.issueLocalClockSample({
            clockEpochId: 'replay-epoch',
            sequence: 3,
            wallEpochMs: nextWallEpochMs,
            monotonicNs: nextMonotonicNs,
        });
        const nextPair = CALENDAR_TEST_ONLY.issueClockSamplePair({
            previous,
            current,
        });
        const freshBundle =
            CALENDAR_TEST_ONLY.issueTradingClockEvaluationBundle({
                calendar: oldBundle.calendar,
                clockSamplePair: nextPair,
                trustedTime: CALENDAR_TEST_ONLY.issueTrustedTimeEvidence({
                    sourceId: 'trusted-clock-fixture',
                    sourceRevision: 'clock-r2',
                    sourceSequence: 2,
                    authorityEpochMs: nextWallEpochMs,
                    observedAtMonotonicNs: nextMonotonicNs,
                }),
                businessSession:
                    CALENDAR_TEST_ONLY.issueBusinessSessionEvidence({
                        sourceId: 'business-session-fixture',
                        sourceRevision: 'session-r2',
                        sourceSequence: 2,
                        tradeDate: '2026-08-10',
                        state: 'open',
                        observedAtMonotonicNs: nextMonotonicNs,
                    }),
            });

        expect(evaluateTradingClock(oldBundle)).toMatchObject({
            ready: false,
            reason: 'trusted_time_untrusted',
        });
        expect(evaluateTradingClock(freshBundle)).toMatchObject({
            ready: true,
            tradeDate: '2026-08-10',
        });

        const wrongPrevious = CALENDAR_TEST_ONLY.issueLocalClockSample({
            clockEpochId: 'replay-epoch',
            sequence: 3,
            wallEpochMs: nextWallEpochMs,
            monotonicNs: nextMonotonicNs,
        });
        const wrongCurrent = CALENDAR_TEST_ONLY.issueLocalClockSample({
            clockEpochId: 'replay-epoch',
            sequence: 4,
            wallEpochMs: nextWallEpochMs + 1,
            monotonicNs: monotonicNanoseconds(nextMonotonicNs + 1_000_000n),
        });
        expectCalendarError(
            () =>
                CALENDAR_TEST_ONLY.issueTradingClockEvaluationBundle({
                    calendar: oldBundle.calendar,
                    clockSamplePair: CALENDAR_TEST_ONLY.issueClockSamplePair({
                        previous: wrongPrevious,
                        current: wrongCurrent,
                    }),
                    trustedTime: freshBundle.trustedTime,
                    businessSession: freshBundle.businessSession,
                }),
            'invalid_monotonic_time',
        );
    });

    it('invalidates an open r1 bundle immediately when the session source advances to suspended r2', () => {
        const now = epoch('2026-08-10T01:00:00.000Z');
        const openR1 = readyInput(now);

        CALENDAR_TEST_ONLY.issueBusinessSessionEvidence({
            sourceId: 'business-session-fixture',
            sourceRevision: 'session-r2',
            sourceSequence: 2,
            tradeDate: '2026-08-10',
            state: 'suspended',
            observedAtMonotonicNs: monotonicNanoseconds(9_000_000_001n),
        });

        expect(evaluateTradingClock(openR1)).toMatchObject({
            ready: false,
            reason: 'business_session_untrusted',
        });
        expectCalendarError(
            () =>
                CALENDAR_TEST_ONLY.issueBusinessSessionEvidence({
                    sourceId: 'business-session-fixture',
                    sourceRevision: 'session-r1',
                    sourceSequence: 3,
                    tradeDate: '2026-08-10',
                    state: 'open',
                    observedAtMonotonicNs: monotonicNanoseconds(
                        9_000_000_002n,
                    ),
                }),
            'invalid_monotonic_time',
        );
    });

    it('invalidates an unused r1 bundle immediately when the authoritative calendar advances to r2', () => {
        const now = epoch('2026-08-10T01:00:00.000Z');
        const calendarR1 = calendar();
        const r1Bundle = readyInput(now, { calendar: calendarR1 });
        const calendarR2 = createTradingCalendarSnapshot(
            calendarInput({
                calendarVersion: 'twse-tpex-2026-08-11-r2',
                sourceRevision: 'r2',
                sourceSequence: 2,
                sourceIntegritySha256: `sha256:${'b'.repeat(64)}`,
                generatedAtEpochMs: epoch('2026-08-09T00:00:01.000Z'),
                days: calendarInput().days.map((day) =>
                    day.tradeDate === '2026-08-10'
                        ? {
                              ...day,
                              state: 'suspended' as const,
                              reasonCode: 'EMERGENCY_SUSPENSION_R2',
                              sourceRevision: 'r2',
                          }
                        : day,
                ),
            }),
        );
        CALENDAR_TEST_ONLY.attestTradingCalendarSnapshot(calendarR2);

        expect(evaluateTradingClock(r1Bundle)).toMatchObject({
            ready: false,
            reason: 'calendar_untrusted',
        });
        expectCalendarError(
            () =>
                CALENDAR_TEST_ONLY.issueTradingClockEvaluationBundle({
                    calendar: calendarR1,
                    clockSamplePair: r1Bundle.clockSamplePair,
                    trustedTime: r1Bundle.trustedTime,
                    businessSession: r1Bundle.businessSession,
                }),
            'invalid_calendar_integrity',
        );
    });

    it('invalidates a bundle immediately when its trusted-time source head advances', () => {
        const now = epoch('2026-08-10T01:00:00.000Z');
        const clockR1 = readyInput(now);

        CALENDAR_TEST_ONLY.issueTrustedTimeEvidence({
            sourceId: 'trusted-clock-fixture',
            sourceRevision: 'clock-r2',
            sourceSequence: 2,
            authorityEpochMs: now - 1_000,
            observedAtMonotonicNs: monotonicNanoseconds(9_000_000_001n),
        });

        expect(evaluateTradingClock(clockR1)).toMatchObject({
            ready: false,
            reason: 'trusted_time_untrusted',
        });
    });

    it('fails closed on business-session contradictions and unknown state', () => {
        const now = epoch('2026-08-10T01:00:00.000Z');
        expect(
            evaluateTradingClock(
                readyInput(now, { sessionState: 'closed' }),
            ),
        ).toMatchObject({ ready: false, reason: 'business_session_mismatch' });
        expect(
            evaluateTradingClock(
                readyInput(now, { sessionState: 'unknown' }),
            ),
        ).toMatchObject({ ready: false, reason: 'business_session_unknown' });
        expect(
            evaluateTradingClock(
                readyInput(now, { tradeDate: '2026-08-11' }),
            ),
        ).toMatchObject({ ready: false, reason: 'business_session_mismatch' });
        const canonical = readyInput(now);
        expectCalendarError(
            () =>
                CALENDAR_TEST_ONLY.issueTradingClockEvaluationBundle({
                    calendar: canonical.calendar,
                    clockSamplePair: canonical.clockSamplePair,
                    trustedTime: canonical.trustedTime,
                    businessSession: canonical.businessSession
                        ? Object.freeze({ ...canonical.businessSession })
                        : null,
                }),
            'invalid_calendar_integrity',
        );
    });

    it('treats calendar expiry as exclusive and rejects a relaxed clock ceiling', () => {
        const now = epoch('2026-08-10T01:00:00.000Z');
        const expiresAt = now + 1;
        const expiringCalendar =
            CALENDAR_TEST_ONLY.attestTradingCalendarSnapshot(
                createTradingCalendarSnapshot(
                    calendarInput({
                        calendarVersion: 'expiring-calendar-r1',
                        sourceId: 'expiring-calendar-fixture',
                        expiresAtEpochMs: expiresAt,
                    }),
                ),
            );
        expect(
            evaluateTradingClock(
                readyInput(now, { calendar: expiringCalendar }),
            ),
        ).toMatchObject({ ready: true });
        expect(
            evaluateTradingClock(
                readyInput(expiresAt, {
                    calendar: expiringCalendar,
                    authorityEpochMs: now - 999,
                }),
            ),
        ).toMatchObject({ ready: false, reason: 'calendar_expired' });
        expectCalendarError(
            () =>
                evaluateClockContinuity({
                    previous: clockSample(1, 1n, 1),
                    current: clockSample(2, 2n, 2),
                    maxSkewMs: 2_001,
                }),
            'invalid_clock_threshold',
        );
    });

    it('rejects a calendar before its generated-at boundary', () => {
        const beforeGeneration = epoch('2026-08-08T23:59:59.999Z');
        expect(
            evaluateTradingClock(
                readyInput(beforeGeneration, {
                    tradeDate: '2026-08-09',
                    sessionState: 'unknown',
                }),
            ),
        ).toMatchObject({
            ready: false,
            reason: 'calendar_not_yet_valid',
        });
    });
});
