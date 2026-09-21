import { describe, expect, it } from 'vitest';
import {
    createScreenerSessionReadiness, normalizeScreenerSessionReadiness, parseScreenerSessionReadiness,
    publicationProbeDecision, recordScreenerPublicationProbe, resolveExpectedScreenerSession,
    resolveScreenerSessionTarget, screenerReadinessReason, SCREENER_PUBLICATION_COOLDOWN_MS,
    SCREENER_PUBLICATION_MAX_PROBES,
} from './stock-screener-session-readiness';

const sessions = ['2025-12-31', '2026-01-02', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];
const taipei = (value: string) => new Date(`${value}+08:00`);

describe('盤後選股 session readiness', () => {
    it('14:00 是當日報表唯一切換邊界', () => {
        expect(resolveScreenerSessionTarget(sessions, taipei('2026-09-03T13:59:59')).phase).toBe('pre-close');
        expect(resolveExpectedScreenerSession(sessions, taipei('2026-09-03T13:59:59'))).toBe('2026-09-02');
        expect(resolveScreenerSessionTarget(sessions, taipei('2026-09-03T14:00:00'))).toEqual({
            expectedSessionDate: '2026-09-03', phase: 'post-close', taipeiDate: '2026-09-03',
        });
    });

    it('週末、假日與臨時休市只取官方日曆最後共同交易日', () => {
        expect(resolveScreenerSessionTarget(sessions, taipei('2026-09-05T14:00:00'))).toEqual({
            expectedSessionDate: '2026-09-04', phase: 'non-trading', taipeiDate: '2026-09-05',
        });
        const holidayCalendar = ['2026-09-30', '2026-10-02'];
        expect(resolveExpectedScreenerSession(holidayCalendar, taipei('2026-10-01T18:00:00'))).toBe('2026-09-30');
        expect(resolveExpectedScreenerSession(['2025-12-31', '2026-01-02'], taipei('2026-01-01T14:00:00'))).toBe('2025-12-31');
        expect(resolveExpectedScreenerSession(['2026-01-02'], taipei('2026-01-02T13:59:00'))).toBeNull();
    });

    it('候選日變更時重置，20 分鐘 cooldown 與 Retry-After 取較長者', () => {
        const started = taipei('2026-09-03T14:00:00');
        const old = createScreenerSessionReadiness('2026-09-02', '2026-09-02', started);
        const fresh = normalizeScreenerSessionReadiness(old, '2026-09-03', '2026-09-02', started);
        expect(fresh.attempts).toBe(0);
        expect(publicationProbeDecision(fresh, started)).toEqual({ allowed: true, reason: 'probe_due' });
        const partial = recordScreenerPublicationProbe(fresh, {
            TWSE: { status: 'complete', reportDate: '2026-09-03', hash: 'a'.repeat(64), total: 1080, invalid: 0 },
            TPEx: { status: 'pending', reportDate: '2026-09-02', reason: 'source_not_published' },
        }, started, 30 * 60 * 1000);
        expect(partial.phase).toBe('awaiting-publication');
        expect(screenerReadinessReason(partial)).toBe('awaiting_tpex');
        expect(Date.parse(partial.nextAttemptAt) - started.getTime()).toBe(30 * 60 * 1000);
        expect(publicationProbeDecision(partial, new Date(started.getTime() + SCREENER_PUBLICATION_COOLDOWN_MS))).toEqual({
            allowed: false, reason: 'publication_cooldown',
        });
    });

    it('雙市場完整才完成，blocked／rate-limited／invalid 與 probe 上限 fail closed', () => {
        const started = taipei('2026-09-03T14:00:00');
        const initial = createScreenerSessionReadiness('2026-09-03', '2026-09-02', started);
        const complete = recordScreenerPublicationProbe(initial, {
            TWSE: { status: 'complete', reportDate: '2026-09-03', hash: 'a', total: 1080, invalid: 0 },
            TPEx: { status: 'complete', reportDate: '2026-09-03', hash: 'b', total: 890, invalid: 0 },
        }, started);
        expect(complete.phase).toBe('complete');
        expect(complete.effectiveSessionDate).toBe('2026-09-03');
        expect(publicationProbeDecision(complete, started)).toEqual({ allowed: false, reason: 'session_complete' });

        for (const [status, phase, reason] of [
            ['blocked', 'blocked', 'source_blocked'], ['rate-limited', 'rate-limited', 'rate_limited'], ['invalid', 'invalid', 'invalid_source'],
        ] as const) {
            const value = recordScreenerPublicationProbe(initial, { TWSE: { status, reason } }, started);
            expect(value.phase).toBe(phase);
            expect(screenerReadinessReason(value)).toBe(reason);
        }

        let capped = initial;
        for (let attempt = 0; attempt < SCREENER_PUBLICATION_MAX_PROBES; attempt++) {
            capped = recordScreenerPublicationProbe(capped, { TWSE: { status: 'pending' }, TPEx: { status: 'pending' } },
                new Date(started.getTime() + attempt * SCREENER_PUBLICATION_COOLDOWN_MS));
        }
        expect(capped.phase).toBe('probe-budget-exhausted');
        expect(publicationProbeDecision(capped, new Date(Date.parse(capped.nextAttemptAt) + 1))).toEqual({
            allowed: false, reason: 'probe_budget_exhausted',
        });
        expect(parseScreenerSessionReadiness(capped)).toEqual(capped);
        expect(parseScreenerSessionReadiness({ ...capped, attempts: 19 })).toBeNull();
    });
});
