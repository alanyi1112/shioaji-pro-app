import { describe, expect, it } from 'vitest';
import {
    createSmartOrderMutationAdmissionController,
    readSmartOrderBodyWithDeadline,
} from './control-plane-capacity.mjs';

describe('smart-order bounded control-plane capacity', () => {
    it('bounds active work, queue depth and session buckets under UUID/session churn', async () => {
        const admission = createSmartOrderMutationAdmissionController({
            now: () => 10_000,
            globalRateLimit: 16,
            sessionRateLimit: 4,
            maxConcurrent: 2,
            maxConcurrentPerSession: 1,
            maxQueued: 2,
            maxQueuedPerSession: 1,
            maxSessionBuckets: 4,
            queueWaitMs: 1_000,
        });
        const first = await admission.acquire('session-1');
        const second = await admission.acquire('session-2');
        expect(first.allowed).toBe(true);
        expect(second.allowed).toBe(true);

        const queuedThird = admission.acquire('session-3');
        const queuedFourth = admission.acquire('session-4');
        await Promise.resolve();
        expect(admission.status()).toMatchObject({
            active: 2,
            queued: 2,
            sessionBuckets: 4,
        });

        const churnResults = await Promise.all(
            Array.from({ length: 1_000 }, (_, index) =>
                admission.acquire(`rotated-session-${index}`),
            ),
        );
        expect(churnResults.every((result) => result.allowed === false)).toBe(
            true,
        );
        expect(admission.status()).toMatchObject({
            active: 2,
            queued: 2,
            sessionBuckets: 4,
            maxQueued: 2,
            maxSessionBuckets: 4,
        });

        first.release();
        const third = await queuedThird;
        expect(third.allowed).toBe(true);
        third.release();
        const fourth = await queuedFourth;
        expect(fourth.allowed).toBe(true);
        fourth.release();
        second.release();
        admission.close();
        expect(admission.status()).toMatchObject({ active: 0, queued: 0 });
    });

    it('enforces both per-session and global mutation rates', async () => {
        let now = 20_000;
        const perSession = createSmartOrderMutationAdmissionController({
            now: () => now,
            globalWindowMs: 1_000,
            globalRateLimit: 4,
            sessionRateLimit: 2,
            maxConcurrent: 1,
            maxConcurrentPerSession: 1,
            maxQueued: 1,
            maxQueuedPerSession: 1,
            maxSessionBuckets: 4,
            queueWaitMs: 100,
        });
        for (let index = 0; index < 2; index += 1) {
            const lease = await perSession.acquire('same-session');
            expect(lease.allowed).toBe(true);
            lease.release();
        }
        await expect(perSession.acquire('same-session')).resolves.toMatchObject({
            allowed: false,
            reason: 'mutation_rate_limited',
        });
        for (const session of ['other-1', 'other-2']) {
            const lease = await perSession.acquire(session);
            expect(lease.allowed).toBe(true);
            lease.release();
        }
        await expect(perSession.acquire('rotated-session')).resolves.toMatchObject(
            {
                allowed: false,
                reason: 'mutation_rate_limited',
            },
        );
        now += 1_001;
        const afterWindow = await perSession.acquire('same-session');
        expect(afterWindow.allowed).toBe(true);
        afterWindow.release();
        perSession.close();
    });

    it('destroys a stalled incoming body when the total deadline expires', async () => {
        let destroyedWith;
        const stalledRequest = {
            async *[Symbol.asyncIterator]() {
                yield Buffer.from('{');
                await new Promise(() => {});
            },
            destroy(error) {
                destroyedWith = error;
            },
        };
        await expect(
            readSmartOrderBodyWithDeadline(stalledRequest, {
                expectedLength: 2,
                maxBytes: 64,
                deadlineMs: 20,
            }),
        ).rejects.toMatchObject({ code: 'BODY_DEADLINE_EXCEEDED' });
        expect(destroyedWith).toMatchObject({
            code: 'BODY_DEADLINE_EXCEEDED',
        });
    });

    it('rejects length overflow and mismatch without retaining partial bytes', async () => {
        const overflow = {
            async *[Symbol.asyncIterator]() {
                yield Buffer.from('abc');
            },
        };
        await expect(
            readSmartOrderBodyWithDeadline(overflow, {
                expectedLength: 2,
                maxBytes: 2,
                deadlineMs: 100,
                tooLargeCode: 'BODY_SHAPE_INVALID',
            }),
        ).rejects.toMatchObject({ code: 'BODY_SHAPE_INVALID' });

        const short = {
            async *[Symbol.asyncIterator]() {
                yield Buffer.from('a');
            },
        };
        await expect(
            readSmartOrderBodyWithDeadline(short, {
                expectedLength: 2,
                maxBytes: 2,
                deadlineMs: 100,
            }),
        ).rejects.toMatchObject({ code: 'BODY_SHAPE_INVALID' });
    });
});
