import { describe, expect, it } from 'vitest';
import { createIntradayMonitorKbarShadowSession,
    INTRADAY_MONITOR_KBAR_SHADOW_EVIDENCE_MAXIMUM_BYTES } from './kbar-shadow-session-recorder.mjs';
import { INTRADAY_MONITOR_KBAR_EVENT_SCHEMA, issueIntradayMonitorKbarSessionCloseAuthority } from './kbar-stream-adapter.mjs';

const contract = () => ({ securityType: 'STK', region: 'TW', exchange: 'TSE', code: '2330', targetCode: null, canonicalSymbol: '2330.TW' });
function minuteKey(value) { return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
function event(minute, volume = 1) {
    const key = minuteKey(minute);
    return { schemaVersion: INTRADAY_MONITOR_KBAR_EVENT_SCHEMA, code: '2330', date: '2026/09/07',
        time: `${key}:00`, volume, receivedTime: `2026-09-07T${String(Math.floor(minute / 60) - 8).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:02.500Z`,
        connectionGeneration: 'kbar_generation_0001', unit: 'common_lot', sourceVersion: 'shioaji-http-1.7.1' };
}

function cohortContract(index) {
    const code = String(1000 + index);
    const exchange = index % 2 === 0 ? 'TSE' : 'OTC';
    return { securityType: 'STK', region: 'TW', exchange, code, targetCode: null,
        canonicalSymbol: `${code}.${exchange === 'TSE' ? 'TW' : 'TWO'}` };
}

function cohortEvent(contractValue, minute, volume = 1) {
    const key = minuteKey(minute);
    return { schemaVersion: INTRADAY_MONITOR_KBAR_EVENT_SCHEMA, code: contractValue.code, date: '2026/09/09',
        time: `${key}:00`, volume,
        receivedTime: `2026-09-09T${String(Math.floor(minute / 60) - 8).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:02.500Z`,
        connectionGeneration: 'kbar_generation_full_20_270', unit: 'common_lot',
        sourceVersion: 'shioaji-http-1.7.1' };
}

describe('KBar shadow full-session evidence', () => {
    it('09:01–13:30 全部 seal 後才可成為 baseline', () => {
        const session = createIntradayMonitorKbarShadowSession({ cohort: [contract()], tradeDate: '2026-09-07',
            connectionGeneration: 'kbar_generation_0001', startedAt: '2026-09-07T00:59:30.000Z',
            nowEpochMs: () => Date.parse('2026-09-07T14:00:00+08:00') });
        for (let minute = 9 * 60 + 1; minute <= 13 * 60 + 30; minute += 1) {
            expect(session.recordKbar(event(minute))).toMatchObject({ accepted: true });
        }
        const closedAt = Date.parse('2026-09-07T13:34:30+08:00');
        const authority = issueIntradayMonitorKbarSessionCloseAuthority({ tradeDate: '2026-09-07', observedAtEpochMs: closedAt,
            timeZone: 'Asia/Taipei' }, closedAt);
        expect(session.sealSessionClose(authority)).toMatchObject({ accepted: true, sealedCount: 1 });
        const evidence = session.evidence({ endedAt: '2026-09-07T05:34:30.000Z' });
        expect(evidence).toMatchObject({ expectedMinuteCountPerSymbol: 270,
            assessment: { fullSession: true, baselineEligible: true, notificationEligible: false },
            operations: { notificationDispatchCount: 0, brokerWriteAttemptCount: 0, productionTransitionCount: 0,
                serviceLifecycleMutationCount: 0, pollingFallback: false, rawPayloadSaved: false } });
        expect(evidence.symbols[0]).toMatchObject({ complete: true, closeMode: 'normal_or_revised_13_30',
            minuteCount: 270, firstMinute: '09:01', lastMinute: '13:30' });
        expect(evidence.close).toMatchObject({ normalCloseMinute: '13:30', delayedCloseMinute: '13:33',
            finalizedAt: '2026-09-07T05:34:30.000Z' });
        expect(evidence.symbols[0].rows.at(-1)).toMatchObject({ cumulativeVolume: 270, sequence: 270 });
        expect(evidence.evidenceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('晚開頁缺少開盤分鐘時只能產生 partial evidence', () => {
        const session = createIntradayMonitorKbarShadowSession({ cohort: [contract()], tradeDate: '2026-09-07',
            connectionGeneration: 'kbar_generation_0001', startedAt: '2026-09-07T01:30:00.000Z',
            nowEpochMs: () => Date.parse('2026-09-07T14:00:00+08:00') });
        for (let minute = 9 * 60 + 30; minute <= 13 * 60 + 30; minute += 1) session.recordKbar(event(minute));
        const closedAt = Date.parse('2026-09-07T13:34:30+08:00');
        const authority = issueIntradayMonitorKbarSessionCloseAuthority({ tradeDate: '2026-09-07', observedAtEpochMs: closedAt,
            timeZone: 'Asia/Taipei' }, closedAt);
        session.sealSessionClose(authority);
        expect(session.evidence({ endedAt: '2026-09-07T05:34:30.000Z' })).toMatchObject({
            assessment: { fullSession: false, baselineEligible: false, notificationEligible: false },
            symbols: [{ complete: false, firstMinute: '09:30', lastMinute: '13:30' }],
        });
    });

    it('完整 20 檔 × 270 分鐘 evidence 超過通用 1 MiB 時仍可在專用上限內穩定雜湊', () => {
        const cohort = Array.from({ length: 20 }, (_, index) => cohortContract(index));
        const session = createIntradayMonitorKbarShadowSession({ cohort, tradeDate: '2026-09-09',
            connectionGeneration: 'kbar_generation_full_20_270', startedAt: '2026-09-09T00:52:12.000Z',
            nowEpochMs: () => Date.parse('2026-09-09T14:00:00+08:00') });
        for (let minute = 9 * 60 + 1; minute <= 13 * 60 + 30; minute += 1) {
            for (const contractValue of cohort) {
                expect(session.recordKbar(cohortEvent(contractValue, minute))).toMatchObject({ accepted: true });
            }
        }
        const closedAt = Date.parse('2026-09-09T13:34:30+08:00');
        const authority = issueIntradayMonitorKbarSessionCloseAuthority({ tradeDate: '2026-09-09',
            observedAtEpochMs: closedAt, timeZone: 'Asia/Taipei' }, closedAt);
        expect(session.sealSessionClose(authority)).toMatchObject({ accepted: true, sealedCount: 20 });
        const first = session.evidence({ endedAt: '2026-09-09T05:34:30.000Z' });
        const second = session.evidence({ endedAt: '2026-09-09T05:34:30.000Z' });
        const serializedBytes = Buffer.byteLength(JSON.stringify({ ...first, evidenceHash: undefined }));

        expect(first).toMatchObject({ expectedMinuteCountPerSymbol: 270,
            assessment: { fullSession: true, baselineEligible: true },
            close: { accepted: true, sealedCount: 20, expectedCount: 20 } });
        expect(first.symbols).toHaveLength(20);
        expect(first.symbols.every((item) => item.complete && item.rows.length === 270)).toBe(true);
        expect(serializedBytes).toBeGreaterThan(1024 * 1024);
        expect(serializedBytes).toBeLessThan(INTRADAY_MONITOR_KBAR_SHADOW_EVIDENCE_MAXIMUM_BYTES);
        expect(second.evidenceHash).toBe(first.evidenceHash);
    });
});
