import { describe, expect, it } from 'vitest';
import {
    INTRADAY_MONITOR_REPLAY_FIXTURE_SCHEMA,
    runIntradayMonitorDeterministicReplay,
} from './deterministic-replay-runner.mjs';

function step(overrides = {}) {
    return {
        admitted: true,
        tradeDate: '2026-09-04',
        baselineTradeDate: '2026-09-03',
        canonicalSymbol: '2330.TW',
        exchange: 'TSE',
        minuteKey: '10:04',
        configRevision: 7,
        threshold: '1.5',
        currentCumulativeVolume: 1_400,
        previousCumulativeVolume: 1_000,
        todayCompleteness: 'complete',
        baselineCompleteness: 'complete',
        calendarCurrent: true,
        sessionCurrent: true,
        generationCurrent: true,
        continuityComplete: true,
        unit: 'common_lot',
        sourceVersion: 'synthetic-fixture/1',
        observationMode: 'historical',
        revisionFirstComparable: false,
        createdAt: '2026-09-04T10:05:00+08:00',
        ...overrides,
    };
}

function fixture() {
    return {
        schemaVersion: INTRADAY_MONITOR_REPLAY_FIXTURE_SCHEMA,
        evidenceClass: 'synthetic_non_market',
        scenarioId: 'threshold-cross-gap-and-day-rollover',
        steps: [
            step(),
            step({ minuteKey: '10:05', currentCumulativeVolume: 1_500, createdAt: '2026-09-04T10:06:00+08:00' }),
            step({ minuteKey: '10:06', currentCumulativeVolume: 1_600, continuityComplete: false, createdAt: '2026-09-04T10:07:00+08:00' }),
            step({ tradeDate: '2026-09-05', baselineTradeDate: '2026-09-04', minuteKey: '10:04', currentCumulativeVolume: 1_500, previousCumulativeVolume: 0, createdAt: '2026-09-05T10:05:00+08:00' }),
        ],
    };
}

describe('deterministic intraday monitor replay runner', () => {
    it('replays identical synthetic evidence to identical event IDs, hashes, counts, and reasons', () => {
        const first = runIntradayMonitorDeterministicReplay(fixture());
        const second = runIntradayMonitorDeterministicReplay(fixture());
        expect(second).toEqual(first);
        expect(first).toMatchObject({
            evidenceClass: 'synthetic_non_market',
            stepCount: 4,
            matched: 1,
            notMatched: 1,
            unknown: 2,
            conservationValid: true,
            notificationDispatchAuthority: false,
            providerRequestAuthority: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
        expect(first.replayHash).toMatch(/^[a-f0-9]{64}$/);
        expect(first.events).toHaveLength(1);
        expect(first.events[0]).toMatchObject({
            kind: 'historical',
            minuteKey: '10:05',
        });
        expect(first.evaluations[2]).toMatchObject({
            classification: 'unknown',
            reason: 'continuity_unproven',
            newlyCreated: false,
            notificationEligible: false,
        });
        expect(first.evaluations[3]).toMatchObject({
            classification: 'unknown',
            reason: 'zero_denominator',
            eventId: null,
        });
    });

    it('refuses fixtures that could be mistaken for formal market evidence', () => {
        expect(() =>
            runIntradayMonitorDeterministicReplay({
                ...fixture(),
                evidenceClass: 'production_market',
            }),
        ).toThrow(/fixture/);
    });
});
