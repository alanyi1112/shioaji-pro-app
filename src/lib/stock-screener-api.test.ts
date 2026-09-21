import { describe, expect, it } from 'vitest';
import { decodeScreenerResponse } from './stock-screener-api';

const sessions = Array.from({ length: 130 }, (_, index) => new Date(Date.UTC(2026, 3, 21 + index)).toISOString().slice(0, 10));
const counts = { total: 1, evaluated: 1, matched: 1, notMatched: 0, unknown: 0,
    missingByCondition: { 'volume-multiple': 0, 'large-holder-weekly-pp': 0, fractal: 0, 'boll-reversal': 0, ma: 0, divergence: 0 } };
const response = () => ({ version: 4, state: 'ready', reason: 'none', snapshotId: crypto.randomUUID(), universeRevision: 'r4',
    formulaVersion: 'after-market-v4-ma-divergence-multichart-ecae7ca-v1', sourceMappingVersion: 'official-daily-ohlcv-v2',
    criteriaFingerprint: 'v4', expectedSessionDate: sessions.at(-1), effectiveSessionDate: sessions.at(-1),
    createdAt: '2026-09-02T12:00:00Z', anchors: { daily: { previous: sessions.at(-2), current: sessions.at(-1) }, weekly: null, weeklyPeriods: [] },
    technicalAnchors: { sessions, through: sessions.at(-1) }, counts, byMarket: null, preparation: null, nextCursor: null,
    rows: [{ code: '1101', symbol: '1101.TW', name: '台泥', market: 'TWSE', kind: 'ordinary', verdict: 'pass', sources: ['TWSE'],
        volume: { current: '3000', previous: '1000', currentDate: sessions.at(-1), previousDate: sessions.at(-2), multiple: 3, reason: 'none', turnover: { ntd: null, wan: null, date: null, signalVerdict: 'pass', verdict: null, reason: null } },
        holder: { mode: 'weekly-increase', current: null, previous: null, changePp: null, reason: 'history_pending', streakWeeks: null, changesPp: [], series: [], turnover: { ntd: null, wan: null, date: null, signalVerdict: null, verdict: null, reason: null } },
        technical: { fractal: null, bollReversal: null }, technicalV4: { evidenceHash: 'a'.repeat(64), divergence: null,
            ma: { verdict: 'pass', reason: 'none', evidence: { mode: 'golden-cross', compressionEnd: sessions.at(-2),
                previous: { sessionDate: sessions.at(-2), close: '99', sma5: 99, sma10: 100, sma20: 100, spreadPct: 1, gap: -1 },
                current: { sessionDate: sessions.at(-1), close: '101', sma5: 101, sma10: 100, sma20: 100, spreadPct: 1, gap: 1 },
                compressionWindow: [
                    { sessionDate: sessions.at(-3), close: '99', sma5: 99, sma10: 100, sma20: 100, spreadPct: 1, gap: -1 },
                    { sessionDate: sessions.at(-2), close: '99', sma5: 99, sma10: 100, sma20: 100, spreadPct: 1, gap: -1 },
                ] } } } }],
});

describe('選股 v4 browser response trust boundary', () => {
    it('接受守恆、130 session 與完整有限 evidence', () => expect(decodeScreenerResponse(response()).version).toBe(4));
    it('接受完整 publication readiness，拒絕未知或不守恆的 readiness', () => {
        const value = response() as ReturnType<typeof response> & { sessionReadiness?: unknown };
        value.sessionReadiness = {
            version: 1, expectedSessionDate: sessions.at(-1), effectiveSessionDate: sessions.at(-1), phase: 'complete', attempts: 1,
            nextAttemptAt: '2026-09-02T12:20:00Z', updatedAt: '2026-09-02T12:00:00Z', markets: {
                TWSE: { status: 'complete', reportDate: sessions.at(-1), hash: 'a'.repeat(64), total: 1084, invalid: 0,
                    reason: null, checkedAt: '2026-09-02T12:00:00Z' },
                TPEx: { status: 'complete', reportDate: sessions.at(-1), hash: 'b'.repeat(64), total: 890, invalid: 0,
                    reason: null, checkedAt: '2026-09-02T12:00:00Z' },
            },
        };
        expect(decodeScreenerResponse(value).sessionReadiness?.phase).toBe('complete');
        (value.sessionReadiness as { markets: { TWSE: { status: string } } }).markets.TWSE.status = 'future-status';
        expect(() => decodeScreenerResponse(value)).toThrow('invalid_screener_response');
    });
    it.each([
        (value: ReturnType<typeof response>) => { value.version = 5; },
        (value: ReturnType<typeof response>) => { value.counts.matched = 2; },
        (value: ReturnType<typeof response>) => { value.technicalAnchors.sessions.pop(); },
        (value: ReturnType<typeof response>) => { value.rows[0]!.technicalV4.evidenceHash = 'bad'; },
        (value: ReturnType<typeof response>) => { value.rows[0]!.technicalV4.ma.evidence.current.sma5 = Number.NaN; },
        (value: ReturnType<typeof response>) => { value.rows[0]!.technicalV4.ma.evidence.current.sessionDate = value.rows[0]!.technicalV4.ma.evidence.previous.sessionDate; },
        (value: ReturnType<typeof response>) => { value.rows[0]!.technicalV4.ma.reason = 'future_reason'; },
        (value: ReturnType<typeof response>) => { value.rows[0]!.technicalV4.ma.evidence.mode = 'any-bullish'; },
        (value: ReturnType<typeof response>) => { value.sourceMappingVersion = 'official-daily-ohlcv-v999'; },
    ])('拒絕未知版本、守恆錯誤、錨點或 evidence 漂移 %#', (mutate) => {
        const value = response(); mutate(value); expect(() => decodeScreenerResponse(value)).toThrow('invalid_screener_response');
    });

    it('拒絕 preparation 失敗數超過 remaining 的假進度', () => {
        const value = response() as unknown as { preparation: unknown } & Record<string, unknown>;
        value.preparation = { version: 4, target: 260, processed: 259, remaining: 1, failed: 2, overdue: 0,
            cursor: 'ohlcv-v4|TWSE|2026-01-01', markets: {
                TWSE: { target: 130, processed: 130, failed: 0 }, TPEx: { target: 130, processed: 129, failed: 2 },
            } };
        expect(() => decodeScreenerResponse(value)).toThrow('invalid_screener_response');
    });
});
