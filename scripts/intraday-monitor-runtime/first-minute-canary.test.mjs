import { describe, expect, it } from 'vitest';

import { createBoundedKbarRecoveryAuthority, evaluateFirstMinuteCanary }
    from './first-minute-canary.mjs';

const cohort = Array.from({ length: 160 }, (_, index) => `${1001 + index}.TW`);
const generation = 'simulation:canary_generation_0001';

function items(receivedCount, minute = '09:01', receivedAt = '2026-09-16T09:02:00+08:00') {
    return cohort.map((canonicalSymbol, index) => ({ canonicalSymbol,
        dataPlaneState: index < receivedCount ? 'active' : 'awaiting_first_kbar',
        firstEventMinute: index < receivedCount ? minute : null,
        firstEventAt: index < receivedCount ? receivedAt : null }));
}

function evaluate(values = items(160)) {
    return evaluateFirstMinuteCanary({ tradeDate: '2026-09-16', connectionGeneration: generation,
        cohort, items: values, evaluatedAt: '2026-09-16T09:02:15+08:00' });
}

describe('09:02:15 第一分鐘 canary', () => {
    it('160 檔 09:01 都準時收到才通過', () => {
        expect(evaluate()).toMatchObject({ result: 'pass', receivedCount: 160,
            missingCount: 0, liveAvailabilityComplete: true, incident: null });
    });

    it('只有 159 檔時保存缺少清單並永久標記 live failure', () => {
        const result = evaluate(items(159));
        expect(result).toMatchObject({ result: 'fail', receivedCount: 159, missingCount: 1,
            liveAvailabilityComplete: false,
            incident: { code: 'first_minute_kbar_missing', immutableLiveFailure: true } });
        expect(result.missing).toEqual([cohort[159]]);
    });

    it('全數第一筆延至 09:10 時不把後到資料冒充開盤可用', () => {
        expect(evaluate(items(160, '09:10', '2026-09-16T09:11:00+08:00'))).toMatchObject({
            result: 'fail', receivedCount: 0, missingCount: 160, liveAvailabilityComplete: false,
        });
    });

    it('deadline 前不得提早宣告 canary 結果', () => {
        expect(() => evaluateFirstMinuteCanary({ tradeDate: '2026-09-16',
            connectionGeneration: generation, cohort, items: items(160),
            evaluatedAt: '2026-09-16T09:02:14+08:00' })).toThrow('too_early');
    });

    it('SSE 已斷線時即使 160 檔都有 09:01 仍 fail closed', () => {
        expect(evaluateFirstMinuteCanary({ tradeDate: '2026-09-16',
            connectionGeneration: generation, cohort, items: items(160), streamState: 'disconnected',
            evaluatedAt: '2026-09-16T09:02:15+08:00' })).toMatchObject({
            result: 'fail', liveAvailabilityComplete: false,
            incident: { code: 'kbar_stream_disconnected' },
        });
    });

    it('同一 run 只核發一次相同 cohort recovery，禁止第二條 stream 與輪替', () => {
        const authority = createBoundedKbarRecoveryAuthority({ tradeDate: '2026-09-16',
            connectionGeneration: generation, cohortHash: `sha256:${'a'.repeat(64)}` });
        expect(authority.issue({ missingCount: 160 })).toMatchObject({ allowed: true,
            maximumAttempts: 1, rotateSymbols: false, secondStreamAllowed: false });
        expect(authority.issue({ missingCount: 1 })).toEqual({ allowed: false,
            reason: 'recovery_already_attempted' });
    });
});
