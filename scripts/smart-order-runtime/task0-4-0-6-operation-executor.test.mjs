import { describe, expect, it } from 'vitest';
import { smartOrderTask0406FormalEvidenceFileName } from './task0-4-0-6-operation-executor.mjs';

describe('Task 0.4/0.6 immutable formal evidence naming', () => {
    const runId = '11111111-2222-4333-8444-555555555555';

    it('binds the profile, run and operation into a unique historical filename', () => {
        const first = smartOrderTask0406FormalEvidenceFileName({
            profile: 'round_trip_lmt_ioc',
            runId,
            operationId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
        });
        const second = smartOrderTask0406FormalEvidenceFileName({
            profile: 'round_trip_lmt_ioc',
            runId,
            operationId: '77777777-8888-4999-8aaa-bbbbbbbbbbbb',
        });
        expect(first).toBe(
            'task13-2-formal-0.4-order-deal-round-trip-11111111-2222-4333-8444-555555555555-66666666-7777-4888-8999-aaaaaaaaaaaa.json',
        );
        expect(second).not.toBe(first);
    });

    it('rejects unknown profiles instead of falling back to a shared slot', () => {
        expect(() =>
            smartOrderTask0406FormalEvidenceFileName({
                profile: 'unknown',
                runId,
                operationId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
            }),
        ).toThrow('formal evidence scope is invalid');
    });

    it('uses one immutable fixed formal slot per Task 13.3 profile', () => {
        expect(
            smartOrderTask0406FormalEvidenceFileName({
                profile: 'protected_exit_ioc_unfilled',
                runId: '11111111-2222-4333-8444-555555555555',
                operationId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
            }),
        ).toBe('task13-3-formal-protected-exit-ioc-unfilled.json');
    });
});
