export const SMART_ORDER_CONTROL_PLANE_CAPACITY_SCHEMA_VERSION =
    'smart-order-control-plane-capacity/2026-08-11.1';

export const DEFAULT_SMART_ORDER_BODY_DEADLINE_MS = 2_000;

function positiveInteger(value, label, { maximum = 60_000 } = {}) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
        throw new TypeError(`${label} is invalid`);
    }
    return value;
}

function admissionDenial(reason) {
    return Object.freeze({
        allowed: false,
        reason,
        release() {},
    });
}

/**
 * A deliberately small, in-memory admission boundary. It bounds both active
 * work and queued work; rate buckets are also capped so rotating session IDs
 * cannot turn the limiter itself into an unbounded allocation.
 */
export function createSmartOrderMutationAdmissionController({
    now = () => Date.now(),
    globalWindowMs = 60_000,
    globalRateLimit = 24,
    sessionRateLimit = 6,
    maxConcurrent = 4,
    maxConcurrentPerSession = 1,
    maxQueued = 8,
    maxQueuedPerSession = 2,
    maxSessionBuckets = 256,
    queueWaitMs = 750,
} = {}) {
    for (const [label, value, maximum] of [
        ['globalWindowMs', globalWindowMs, 60 * 60 * 1_000],
        ['globalRateLimit', globalRateLimit, 100_000],
        ['sessionRateLimit', sessionRateLimit, 100_000],
        ['maxConcurrent', maxConcurrent, 1_024],
        ['maxConcurrentPerSession', maxConcurrentPerSession, 1_024],
        ['maxQueued', maxQueued, 4_096],
        ['maxQueuedPerSession', maxQueuedPerSession, 1_024],
        ['maxSessionBuckets', maxSessionBuckets, 4_096],
        ['queueWaitMs', queueWaitMs, 30_000],
    ]) {
        positiveInteger(value, label, { maximum });
    }
    if (
        sessionRateLimit > globalRateLimit ||
        maxConcurrentPerSession > maxConcurrent ||
        maxQueuedPerSession > maxQueued
    ) {
        throw new TypeError('mutation admission limits are inconsistent');
    }

    const globalAdmissions = [];
    const sessions = new Map();
    const queue = [];
    let active = 0;
    let closed = false;

    const currentTime = () => {
        const value = now();
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new TypeError('mutation admission clock is invalid');
        }
        return value;
    };
    const pruneTimes = (values, cutoff) => {
        while (values.length > 0 && values[0] <= cutoff) values.shift();
    };
    const prune = (nowEpochMs) => {
        const cutoff = nowEpochMs - globalWindowMs;
        pruneTimes(globalAdmissions, cutoff);
        for (const [sessionKey, session] of sessions) {
            pruneTimes(session.admissions, cutoff);
            if (
                session.active === 0 &&
                session.queued === 0 &&
                session.admissions.length === 0
            ) {
                sessions.delete(sessionKey);
            }
        }
    };
    const sessionBucket = (sessionKey, nowEpochMs) => {
        let session = sessions.get(sessionKey);
        if (session) {
            session.lastSeenEpochMs = nowEpochMs;
            sessions.delete(sessionKey);
            sessions.set(sessionKey, session);
            return session;
        }
        while (sessions.size >= maxSessionBuckets) {
            const evictable = [...sessions].find(
                ([, candidate]) =>
                    candidate.active === 0 &&
                    candidate.queued === 0 &&
                    candidate.admissions.length === 0,
            );
            if (!evictable) return null;
            sessions.delete(evictable[0]);
        }
        session = {
            active: 0,
            queued: 0,
            admissions: [],
            lastSeenEpochMs: nowEpochMs,
        };
        sessions.set(sessionKey, session);
        return session;
    };
    const grant = (session) => {
        active += 1;
        session.active += 1;
        let released = false;
        return Object.freeze({
            allowed: true,
            release() {
                if (released) return;
                released = true;
                active -= 1;
                session.active -= 1;
                drain();
            },
        });
    };
    const removeQueued = (candidate) => {
        const index = queue.indexOf(candidate);
        if (index < 0) return false;
        queue.splice(index, 1);
        candidate.session.queued -= 1;
        clearTimeout(candidate.timer);
        return true;
    };
    const drain = () => {
        if (closed) return;
        while (active < maxConcurrent) {
            const index = queue.findIndex(
                (candidate) =>
                    candidate.session.active < maxConcurrentPerSession,
            );
            if (index < 0) return;
            const candidate = queue[index];
            removeQueued(candidate);
            candidate.resolve(grant(candidate.session));
        }
    };

    return Object.freeze({
        async acquire(sessionKey) {
            if (
                typeof sessionKey !== 'string' ||
                sessionKey.length < 1 ||
                sessionKey.length > 256
            ) {
                throw new TypeError('mutation admission session key is invalid');
            }
            if (closed) return admissionDenial('mutation_admission_closed');
            const nowEpochMs = currentTime();
            prune(nowEpochMs);
            const session = sessionBucket(sessionKey, nowEpochMs);
            if (!session) {
                return admissionDenial('mutation_backpressure');
            }
            if (
                globalAdmissions.length >= globalRateLimit ||
                session.admissions.length >= sessionRateLimit
            ) {
                return admissionDenial('mutation_rate_limited');
            }

            // Count every accepted admission attempt, including requests which
            // later time out in the bounded queue. Overload must not be free.
            globalAdmissions.push(nowEpochMs);
            session.admissions.push(nowEpochMs);
            if (
                active < maxConcurrent &&
                session.active < maxConcurrentPerSession
            ) {
                return grant(session);
            }
            if (
                queue.length >= maxQueued ||
                session.queued >= maxQueuedPerSession
            ) {
                return admissionDenial('mutation_backpressure');
            }
            return new Promise((resolve) => {
                const candidate = { session, resolve, timer: undefined };
                candidate.timer = setTimeout(() => {
                    if (!removeQueued(candidate)) return;
                    resolve(admissionDenial('mutation_backpressure'));
                }, queueWaitMs);
                candidate.timer.unref?.();
                session.queued += 1;
                queue.push(candidate);
            });
        },
        status() {
            return Object.freeze({
                active,
                queued: queue.length,
                sessionBuckets: sessions.size,
                globalAdmissionsInWindow: globalAdmissions.length,
                maxConcurrent,
                maxQueued,
                maxSessionBuckets,
                closed,
            });
        },
        close() {
            if (closed) return;
            closed = true;
            for (const candidate of queue.splice(0)) {
                candidate.session.queued -= 1;
                clearTimeout(candidate.timer);
                candidate.resolve(
                    admissionDenial('mutation_admission_closed'),
                );
            }
        },
    });
}

function bodyError(message, code) {
    return Object.assign(new Error(message), { code });
}

/**
 * Reads a Node request async iterator under one total deadline. Destroying the
 * request on expiry is important: merely rejecting a Promise would leave the
 * HTTP parser and its partial body alive.
 */
export async function readSmartOrderBodyWithDeadline(
    request,
    {
        expectedLength,
        maxBytes,
        deadlineMs = DEFAULT_SMART_ORDER_BODY_DEADLINE_MS,
        startedAtMonotonicMs = performance.now(),
        tooLargeCode = 'BODY_TOO_LARGE',
    },
) {
    if (
        expectedLength !== undefined &&
        (!Number.isSafeInteger(expectedLength) || expectedLength < 0)
    ) {
        throw new TypeError('expected body length is invalid');
    }
    positiveInteger(maxBytes, 'maxBytes', { maximum: 16 * 1024 * 1024 });
    positiveInteger(deadlineMs, 'deadlineMs', { maximum: 30_000 });
    if (
        typeof startedAtMonotonicMs !== 'number' ||
        !Number.isFinite(startedAtMonotonicMs) ||
        startedAtMonotonicMs < 0
    ) {
        throw new TypeError('body deadline start is invalid');
    }
    if (!request || typeof request[Symbol.asyncIterator] !== 'function') {
        throw new TypeError('request body is not async iterable');
    }

    const chunks = [];
    let total = 0;
    const iterator = request[Symbol.asyncIterator]();
    try {
        while (true) {
            const remaining =
                deadlineMs - (performance.now() - startedAtMonotonicMs);
            if (remaining <= 0) {
                throw bodyError(
                    'request body deadline exceeded',
                    'BODY_DEADLINE_EXCEEDED',
                );
            }
            let timer;
            const next = await Promise.race([
                iterator.next(),
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () =>
                            reject(
                                bodyError(
                                    'request body deadline exceeded',
                                    'BODY_DEADLINE_EXCEEDED',
                                ),
                            ),
                        Math.max(1, Math.ceil(remaining)),
                    );
                }),
            ]).finally(() => clearTimeout(timer));
            if (next.done) break;
            const bytes = Buffer.isBuffer(next.value)
                ? next.value
                : Buffer.from(next.value);
            total += bytes.byteLength;
            if (
                total > maxBytes ||
                (expectedLength !== undefined && total > expectedLength)
            ) {
                throw bodyError('request body is too large', tooLargeCode);
            }
            chunks.push(bytes);
        }
        if (expectedLength !== undefined && total !== expectedLength) {
            throw bodyError(
                'request content length mismatch',
                'BODY_SHAPE_INVALID',
            );
        }
        return Buffer.concat(chunks, total);
    } catch (error) {
        for (const chunk of chunks) chunk.fill(0);
        if (error?.code === 'BODY_DEADLINE_EXCEEDED') {
            try {
                request.destroy?.(error);
            } catch {
                // The caller still receives the fail-closed deadline result.
            }
        }
        try {
            void iterator.return?.().catch?.(() => {});
        } catch {
            // A destroyed IncomingMessage may throw from iterator.return().
        }
        throw error;
    }
}
