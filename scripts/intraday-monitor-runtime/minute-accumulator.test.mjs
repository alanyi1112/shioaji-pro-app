import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    INTRADAY_MONITOR_OBSERVATION_SCHEMA,
    TAIWAN_REGULAR_SESSION_CALENDAR_SCHEMA,
    completedMinuteWatermark,
    createIntradayMonitorMinuteAccumulator,
    issueTaiwanRegularSessionAuthority,
} from './minute-accumulator.mjs';

function contract(code = '2330') {
    return { securityType: 'STK', region: 'TW', exchange: 'TSE', code, targetCode: null, canonicalSymbol: `${code}.TW` };
}

function calendar({ sessionState = 'open', tradeDate = '2026-09-07' } = {}) {
    return {
        schemaVersion: TAIWAN_REGULAR_SESSION_CALENDAR_SCHEMA,
        exchange: 'TSE',
        tradeDate,
        officialTradingDates: ['2026-09-03', '2026-09-04', '2026-09-07'],
        generatedAtEpochMs: Date.parse(`${tradeDate}T08:00:00+08:00`),
        validUntilEpochMs: Date.parse(`${tradeDate}T23:59:59+08:00`),
        sourceVersion: `sha256:${createHash('sha256').update('calendar').digest('hex')}`,
        sessionState,
        timeZone: 'Asia/Taipei',
    };
}

function observation(overrides = {}) {
    return {
        schemaVersion: INTRADAY_MONITOR_OBSERVATION_SCHEMA,
        contract: contract(),
        tradeDate: '2026-09-07',
        minuteKey: '09:00',
        exchangeTime: '09:00:30.000',
        receivedTime: '2026-09-07T09:00:30.100+08:00',
        connectionGeneration: 'connection_generation_001',
        sequence: 1,
        cumulativeVolume: 0,
        unit: 'common_lot',
        source: 'shioaji-tick-stk',
        sourceVersion: 'shioaji-mapping/1',
        simtrade: false,
        intradayOdd: false,
        continuity: 'complete',
        ...overrides,
    };
}

function harness({ now = '2026-09-07T09:04:10+08:00', sessionState = 'open' } = {}) {
    const clock = { value: Date.parse(now) };
    const authority = issueTaiwanRegularSessionAuthority(calendar({ sessionState }), clock.value);
    expect(authority.issued).toBe(true);
    const accumulator = createIntradayMonitorMinuteAccumulator({
        sessionAuthority: authority,
        connectionGeneration: 'connection_generation_001',
        nowEpochMs: () => clock.value,
    });
    accumulator.registerContract(contract());
    return { accumulator, authority, clock };
}

describe('Taiwan regular-session completed-minute authority', () => {
    it('derives the previous official trading day and an open-session watermark', () => {
        const now = Date.parse('2026-09-07T10:05:30+08:00');
        const authority = issueTaiwanRegularSessionAuthority(calendar(), now);
        expect(authority).toMatchObject({ issued: true, previousTradeDate: '2026-09-04', providerRequestAuthority: false, brokerWriteAuthority: false });
        expect(completedMinuteWatermark(authority, now)).toBe('10:04');
    });

    it('caps a verified closed session at 13:30 and rejects stale or incomplete calendars', () => {
        const now = Date.parse('2026-09-07T14:00:00+08:00');
        const authority = issueTaiwanRegularSessionAuthority(calendar({ sessionState: 'closed' }), now);
        expect(completedMinuteWatermark(authority, now)).toBe('13:30');
        expect(issueTaiwanRegularSessionAuthority({ ...calendar(), officialTradingDates: ['2026-09-07'] }, now).issued).toBe(false);
        expect(issueTaiwanRegularSessionAuthority({ ...calendar(), validUntilEpochMs: now }, now).issued).toBe(false);
    });
});

describe('intraday minute observation accumulator', () => {
    it('stores observed, known-zero, and continuity-proven carry-forward separately from missing', () => {
        const { accumulator } = harness();
        accumulator.registerContract(contract('2454'));
        expect(accumulator.recordObservation(observation()).accepted).toBe(true);
        expect(accumulator.recordObservation(observation({ minuteKey: '09:02', exchangeTime: '09:02:10.000', receivedTime: '2026-09-07T09:02:10.100+08:00', sequence: 2, cumulativeVolume: 10 })).accepted).toBe(true);
        const flushed = accumulator.flushCompleted();
        const rows2330 = flushed.rows.filter((row) => row.canonicalSymbol === '2330.TW');
        const rows2454 = flushed.rows.filter((row) => row.canonicalSymbol === '2454.TW');
        expect(rows2330.map((row) => [row.minuteKey, row.cumulativeVolume, row.provenance])).toEqual([
            ['09:00', 0, 'known_zero'],
            ['09:01', 0, 'carry_forward'],
            ['09:02', 10, 'observed'],
            ['09:03', 10, 'carry_forward'],
        ]);
        expect(rows2454.every((row) => row.provenance === 'missing' && row.cumulativeVolume === null)).toBe(true);
        expect(accumulator.flushCompleted().rows).toEqual(flushed.rows);

        expect(accumulator.recordObservation(observation({
            contract: contract('2454'),
            minuteKey: '09:02',
            exchangeTime: '09:02:20.000',
            receivedTime: '2026-09-07T09:02:20.100+08:00',
            sequence: 1,
            cumulativeVolume: 8,
        })).accepted).toBe(true);
        const repaired2454 = accumulator.flushCompleted().rows.filter(
            (row) => row.canonicalSymbol === '2454.TW',
        );
        expect(repaired2454.find((row) => row.minuteKey === '09:02')).toMatchObject({
            cumulativeVolume: 8,
            provenance: 'observed',
            completeness: 'complete',
        });
    });

    it.each([
        ['stale_generation', { connectionGeneration: 'connection_generation_old' }],
        ['cross_date', { tradeDate: '2026-09-06', receivedTime: '2026-09-06T09:00:30+08:00' }],
        ['future_or_invalid_time', { exchangeTime: '10:00:00', minuteKey: '10:00', receivedTime: '2026-09-07T10:00:00.100+08:00' }],
        ['invalid_cumulative_volume', { cumulativeVolume: -1 }],
        ['invalid_cumulative_volume', { cumulativeVolume: Number.NaN }],
        ['simtrade_rejected', { simtrade: true }],
        ['intraday_odd_lot_rejected', { intradayOdd: true }],
        ['unknown_unit', { unit: 'share' }],
        ['invalid_exchange_time', { minuteKey: '09:01' }],
    ])('rejects %s without advancing state', (reason, overrides) => {
        const { accumulator } = harness();
        expect(accumulator.recordObservation(observation(overrides))).toMatchObject({ accepted: false, reason });
        expect(accumulator.status().acceptedObservationCount).toBe(0);
    });

    it('rejects duplicate/backward sequence and cumulative regression', () => {
        const { accumulator } = harness();
        expect(accumulator.recordObservation(observation({ sequence: 2, cumulativeVolume: 10 })).accepted).toBe(true);
        expect(accumulator.recordObservation(observation({ sequence: 2, cumulativeVolume: 10 })).reason).toBe('duplicate_sequence');
        expect(accumulator.recordObservation(observation({ sequence: 1, cumulativeVolume: 10 })).reason).toBe('backward_sequence');
        expect(accumulator.recordObservation(observation({ minuteKey: '09:01', exchangeTime: '09:01:00', receivedTime: '2026-09-07T09:01:00.100+08:00', sequence: 3, cumulativeVolume: 9 })).reason).toBe('cumulative_volume_regression');
    });

    it('marks partial continuity and disconnected gaps as incomplete without inventing zero', () => {
        const { accumulator } = harness();
        accumulator.recordObservation(observation({ cumulativeVolume: 5 }));
        accumulator.recordObservation(observation({ minuteKey: '09:01', exchangeTime: '09:01:00', receivedTime: '2026-09-07T09:01:00.100+08:00', sequence: 2, cumulativeVolume: 6, continuity: 'partial' }));
        const rows = accumulator.flushCompleted().rows;
        expect(rows.find((row) => row.minuteKey === '09:01')).toMatchObject({ completeness: 'incomplete', provenance: 'observed_partial' });
        expect(rows.find((row) => row.minuteKey === '09:02')).toMatchObject({ completeness: 'missing', cumulativeVolume: null });
    });

    it('KBar stream 只接受明確 sealed minute，不對漏棒 carry-forward', () => {
        const { accumulator } = harness();
        expect(accumulator.recordObservation(observation({
            minuteKey: '09:01',
            exchangeTime: '09:01:00',
            receivedTime: '2026-09-07T09:02:02.500+08:00',
            cumulativeVolume: 10,
            source: 'shioaji-kbar-stream',
        })).accepted).toBe(true);
        const rows = accumulator.flushCompleted().rows;
        expect(rows.map((row) => row.minuteKey)).toEqual(['09:01', '09:02', '09:03']);
        expect(rows[0]).toMatchObject({ minuteKey: '09:01', cumulativeVolume: 10, provenance: 'observed', completeness: 'complete' });
        expect(rows[1]).toMatchObject({ minuteKey: '09:02', cumulativeVolume: null, provenance: 'missing', completeness: 'missing' });
        expect(rows[2]).toMatchObject({ minuteKey: '09:03', cumulativeVolume: null, provenance: 'missing', completeness: 'missing' });
        expect(accumulator.recordObservation(observation({
            minuteKey: '09:02', exchangeTime: '09:02:00',
            receivedTime: '2026-09-07T09:02:02.600+08:00', sequence: 2,
            cumulativeVolume: 11, source: 'shioaji-tick-stk',
        }))).toMatchObject({ accepted: false, reason: 'source_mode_changed' });
    });

    it('rejects old-generation packets after rollover and resumes only with explicit complete continuity', () => {
        const { accumulator } = harness();
        accumulator.recordObservation(observation({ cumulativeVolume: 5 }));
        expect(accumulator.markDisconnected({ connectionGeneration: 'connection_generation_001' }).accepted).toBe(true);
        expect(accumulator.recordObservation(observation({ sequence: 2, cumulativeVolume: 6 })).reason).toBe('stream_disconnected');
        expect(accumulator.replaceConnection({ connectionGeneration: 'connection_generation_002' }).accepted).toBe(true);
        expect(accumulator.recordObservation(observation({ sequence: 2, cumulativeVolume: 6 })).reason).toBe('stale_generation');
        expect(accumulator.recordObservation(observation({ connectionGeneration: 'connection_generation_002', minuteKey: '09:03', exchangeTime: '09:03:00', receivedTime: '2026-09-07T09:03:00.100+08:00', sequence: 1, cumulativeVolume: 6, continuity: 'complete' })).accepted).toBe(true);
        expect(accumulator.status()).toMatchObject({ connected: true, connectionGeneration: 'connection_generation_002', pollingFallbackAllowed: false, providerRequestAuthority: false, brokerWriteAuthority: false });
    });
});
