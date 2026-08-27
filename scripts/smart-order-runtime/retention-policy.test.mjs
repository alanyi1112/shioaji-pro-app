import { describe, expect, it } from 'vitest';
import {
    addTaipeiCalendarYear,
    evaluateRetentionEligibility,
} from './retention-policy.mjs';

function taipeiEpoch(value) {
    return Date.parse(`${value}+08:00`);
}

describe('smart-order calendar-year retention policy', () => {
    it('clamps leap day to the last valid day one Taipei calendar year later', () => {
        expect(addTaipeiCalendarYear(taipeiEpoch('2024-02-29T15:30:45.123'))).toBe(
            taipeiEpoch('2025-02-28T15:30:45.123'),
        );
    });

    it('preserves month-end wall time rather than adding a fixed 365 days', () => {
        expect(addTaipeiCalendarYear(taipeiEpoch('2023-03-01T00:00:00.000'))).toBe(
            taipeiEpoch('2024-03-01T00:00:00.000'),
        );
        expect(addTaipeiCalendarYear(taipeiEpoch('2025-01-31T23:59:59.999'))).toBe(
            taipeiEpoch('2026-01-31T23:59:59.999'),
        );
    });

    it('uses the later terminal or associated-evidence timestamp', () => {
        const terminalAtEpochMs = taipeiEpoch('2025-01-31T10:00:00.000');
        const lastEvidenceAtEpochMs = taipeiEpoch('2025-02-28T10:00:00.000');
        expect(
            evaluateRetentionEligibility({
                entityKind: 'strategy',
                state: 'completed',
                terminalAtEpochMs,
                lastEvidenceAtEpochMs,
                hasLiveDependency: false,
                nowEpochMs: taipeiEpoch('2026-02-27T23:59:59.999'),
            }),
        ).toMatchObject({
            eligible: false,
            retentionBaseEpochMs: lastEvidenceAtEpochMs,
            eligibleAtEpochMs: taipeiEpoch('2026-02-28T10:00:00.000'),
        });
        expect(
            evaluateRetentionEligibility({
                entityKind: 'strategy',
                state: 'completed',
                terminalAtEpochMs,
                lastEvidenceAtEpochMs,
                hasLiveDependency: false,
                nowEpochMs: taipeiEpoch('2026-02-28T10:00:00.000'),
            }).eligible,
        ).toBe(true);
    });

    it('never age-purges working, unknown, or dependency-bearing entities', () => {
        const ancient = taipeiEpoch('2020-01-01T00:00:00.000');
        const now = taipeiEpoch('2030-01-01T00:00:00.000');
        for (const candidate of [
            {
                entityKind: 'broker_order',
                state: 'submitted',
                terminalAtEpochMs: ancient,
                hasLiveDependency: false,
            },
            {
                entityKind: 'exit_claim',
                state: 'unknown',
                releasedAtEpochMs: ancient,
                hasLiveDependency: false,
            },
            {
                entityKind: 'protection_obligation',
                state: 'fulfilled',
                terminalAtEpochMs: ancient,
                hasLiveDependency: true,
            },
        ]) {
            expect(
                evaluateRetentionEligibility({ ...candidate, nowEpochMs: now }),
            ).toMatchObject({ eligible: false });
        }
    });

    it('requires an explicit terminal or released timestamp', () => {
        expect(
            evaluateRetentionEligibility({
                entityKind: 'entry_exposure_reservation',
                state: 'released',
                hasLiveDependency: false,
                nowEpochMs: taipeiEpoch('2030-01-01T00:00:00.000'),
            }),
        ).toEqual({
            eligible: false,
            reason: 'terminal_timestamp_missing',
        });
    });
});
