import { Worker } from 'node:worker_threads';
import path from 'node:path';

export const SMART_ORDER_DB_WATCHDOG_SCHEMA_VERSION =
    'smart-order-db-watchdog/2026-08-11.1';
export const DEFAULT_DB_WORKER_LATENCY_LIMIT_MS = 250;
export const DEFAULT_DB_QUEUE_AGE_LIMIT_MS = 250;
export const DEFAULT_DB_MAX_PENDING_REQUESTS = 64;
const READINESS_GATED_METHODS = new Set([
    'startRuntimeEpoch',
    'markRuntimeEpochReady',
    'insertStrategy',
    'prepareIntent',
    'rearmPreparedIntent',
    'markIntentDispatching',
    'verifyDispatchGrant',
    'beginBrokerEventReconciliation',
    'recordCanonicalBrokerEvent',
    'recordBrokerOrderEvidence',
    'materializeProtectedEntryFill',
    'recordProtectiveQuoteObservation',
]);

function boundedPositive(value, fallback, label) {
    const candidate = value ?? fallback;
    if (!Number.isFinite(candidate) || candidate <= 0 || candidate > 60_000) {
        throw new TypeError(`${label} must be between 0 and 60000ms`);
    }
    return candidate;
}

function boundedPendingRequests(value) {
    const candidate = value ?? DEFAULT_DB_MAX_PENDING_REQUESTS;
    if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > 1_024) {
        throw new TypeError('maxPendingRequests must be between 1 and 1024');
    }
    return candidate;
}

export class SmartOrderRepositoryClient {
    #worker;
    #nextRequestId = 1;
    #pending = new Map();
    #readyPromise;
    #readySettled = false;
    #rejectReady;
    #closed = false;
    #closing = false;
    #closePromise;
    #workerFailed = false;
    #watchdog;

    constructor({
        appSupportRoot,
        databasePath,
        backupDirectory,
        repositoryExpectationPath,
        installationIdPath,
        identityKeyPath,
        testOnlyMaxPageCount,
        testOnlyBrokerCorrelationIdentifierKinds,
        testOnlyJournalMaxRows,
        testOnlyFailMigrationAfterSchemaRewrite,
        testOnlyFailReplayCompletionAfterMutation,
        testOnlyMaxRequestReplays,
        testOnlyMaxStrategies,
        testOnlyMaxDraftStrategies,
        testOnlyBlockingBackupDelayMs,
        testOnlyExposureArbiterHeads,
        testOnlyExposureClockNowEpochMs,
        testOnlyExposureClockAdvanceToEpochMs,
        testOnlyExternalSellVisibilityHeads,
        testOnlyAllowUnverifiedIdentitySeed,
        testOnlyRequireCanonicalPnl,
        testOnlyAllowSyntheticGateManifestProjection,
        workerLatencyLimitMs,
        queueAgeLimitMs,
        maxPendingRequests,
    }) {
        if (typeof databasePath !== 'string' || databasePath.length === 0) {
            throw new TypeError('databasePath is required');
        }
        if (
            testOnlyAllowSyntheticGateManifestProjection === true &&
            process.env.VITEST !== 'true'
        ) {
            throw new Error(
                'synthetic Gate manifest projection is test-only',
            );
        }
        this.#watchdog = {
            schemaVersion: SMART_ORDER_DB_WATCHDOG_SCHEMA_VERSION,
            workerLatencyLimitMs: boundedPositive(
                workerLatencyLimitMs,
                DEFAULT_DB_WORKER_LATENCY_LIMIT_MS,
                'workerLatencyLimitMs',
            ),
            queueAgeLimitMs: boundedPositive(
                queueAgeLimitMs,
                DEFAULT_DB_QUEUE_AGE_LIMIT_MS,
                'queueAgeLimitMs',
            ),
            repositoryReady: true,
            blocker: null,
            maxObservedWorkerLatencyMs: 0,
            maxObservedQueueAgeMs: 0,
            maxPendingRequests: boundedPendingRequests(maxPendingRequests),
            maxObservedPendingRequests: 0,
        };
        this.#worker = new Worker(
            new URL('./repository-worker.mjs', import.meta.url),
            {
                workerData: {
                    appSupportRoot,
                    databasePath,
                    backupDirectory,
                    repositoryExpectationPath:
                        repositoryExpectationPath ??
                        path.join(
                            path.dirname(path.dirname(databasePath)),
                            'private',
                            'repository-expectation.json',
                        ),
                    installationIdPath:
                        installationIdPath ??
                        path.join(
                            path.dirname(path.dirname(databasePath)),
                            'private',
                            'installation-id',
                        ),
                    identityKeyPath:
                        identityKeyPath ??
                        path.join(
                            path.dirname(path.dirname(databasePath)),
                            'private',
                            'identity-hmac-key.bin',
                        ),
                    testOnlyMaxPageCount,
                    testOnlyBrokerCorrelationIdentifierKinds,
                    testOnlyJournalMaxRows,
                    testOnlyFailMigrationAfterSchemaRewrite,
                    testOnlyFailReplayCompletionAfterMutation,
                    testOnlyMaxRequestReplays,
                    testOnlyMaxStrategies,
                    testOnlyMaxDraftStrategies,
                    testOnlyBlockingBackupDelayMs,
                    testOnlyExposureArbiterHeads,
                    testOnlyExposureClockNowEpochMs,
                    testOnlyExposureClockAdvanceToEpochMs,
                    testOnlyExternalSellVisibilityHeads,
                    testOnlyAllowUnverifiedIdentitySeed,
                    testOnlyRequireCanonicalPnl,
                    testOnlyAllowSyntheticGateManifestProjection,
                    queueAgeLimitMs: this.#watchdog.queueAgeLimitMs,
                },
            },
        );
        this.#readyPromise = new Promise((resolve, reject) => {
            this.#rejectReady = reject;
            const onMessage = (message) => {
                if (message?.type === 'ready') {
                    this.#worker.off('message', onMessage);
                    this.#readySettled = true;
                    resolve();
                } else if (message?.type === 'startup-error') {
                    this.#worker.off('message', onMessage);
                    const error = new Error(message.error?.message ?? 'repository startup failed');
                    error.name = message.error?.name ?? 'Error';
                    this.#readySettled = true;
                    this.#workerFailed = true;
                    this.#markNotReady('startup_error');
                    reject(error);
                    void this.#worker.terminate();
                }
            };
            this.#worker.on('message', onMessage);
        });
        this.#worker.on('message', (message) => this.#handleMessage(message));
        this.#worker.on('error', (error) => this.#failAll(error, 'worker_error'));
        this.#worker.on('exit', (code) => {
            if (!this.#closed && !this.#workerFailed) {
                this.#failAll(
                    new Error(`repository worker exited with code ${code}`),
                    'worker_exit',
                );
            }
        });
    }

    #markNotReady(blocker) {
        this.#watchdog.repositoryReady = false;
        this.#watchdog.blocker = blocker;
    }

    #observeMetrics(message) {
        const workerDurationMs = Number(message.workerDurationMs ?? 0);
        const queueAgeMs = Number(message.queueAgeMs ?? 0);
        this.#watchdog.maxObservedWorkerLatencyMs = Math.max(
            this.#watchdog.maxObservedWorkerLatencyMs,
            workerDurationMs,
        );
        this.#watchdog.maxObservedQueueAgeMs = Math.max(
            this.#watchdog.maxObservedQueueAgeMs,
            queueAgeMs,
        );
        if (workerDurationMs > this.#watchdog.workerLatencyLimitMs) {
            this.#markNotReady('worker_latency_exceeded');
        }
        if (queueAgeMs > this.#watchdog.queueAgeLimitMs) {
            this.#markNotReady('queue_age_exceeded');
        }
    }

    #clearPendingWatchdogs(pending) {
        clearTimeout(pending.queueTimer);
        clearTimeout(pending.latencyTimer);
    }

    #handleMessage(message) {
        if (!message || typeof message.id !== 'number') return;
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        if (message.type === 'started') {
            clearTimeout(pending.queueTimer);
            const queueAgeMs = Number(message.queueAgeMs ?? 0);
            this.#watchdog.maxObservedQueueAgeMs = Math.max(
                this.#watchdog.maxObservedQueueAgeMs,
                queueAgeMs,
            );
            if (queueAgeMs > this.#watchdog.queueAgeLimitMs) {
                this.#markNotReady('queue_age_exceeded');
            }
            pending.latencyTimer = setTimeout(() => {
                this.#markNotReady('worker_latency_exceeded');
            }, this.#watchdog.workerLatencyLimitMs);
            return;
        }
        this.#pending.delete(message.id);
        this.#clearPendingWatchdogs(pending);
        this.#observeMetrics(message);
        if (message.ok) {
            if (
                pending.readinessGated === true &&
                this.#watchdog.repositoryReady !== true
            ) {
                pending.reject(
                    new Error(
                        'repository watchdog blocks readiness-gated operation',
                    ),
                );
            } else {
                pending.resolve(message.result);
            }
        } else {
            const error = new Error(message.error?.message ?? 'repository operation failed');
            error.name = message.error?.name ?? 'Error';
            pending.reject(error);
            if (message.fatalRepositoryError === true) {
                this.#failAll(error, 'repository_fatal_error');
            }
        }
    }

    #failAll(error, blocker) {
        this.#workerFailed = true;
        this.#markNotReady(blocker);
        if (!this.#readySettled) {
            this.#readySettled = true;
            this.#rejectReady?.(error);
        }
        for (const pending of this.#pending.values()) {
            this.#clearPendingWatchdogs(pending);
            pending.reject(error);
        }
        this.#pending.clear();
    }

    async ready() {
        await this.#readyPromise;
        return this;
    }

    async request(method, payload = {}) {
        if (this.#closed) throw new Error('repository client is closed');
        if (this.#closing && method !== 'close') {
            throw new Error('repository client is closing');
        }
        if (this.#workerFailed) throw new Error('repository worker is unavailable');
        await this.#readyPromise;
        if (this.#workerFailed) throw new Error('repository worker is unavailable');
        if (
            !this.#watchdog.repositoryReady &&
            READINESS_GATED_METHODS.has(method)
        ) {
            throw new Error('repository watchdog blocks readiness-gated operation');
        }
        if (this.#pending.size >= this.#watchdog.maxPendingRequests) {
            throw new Error('repository request backpressure');
        }
        const id = this.#nextRequestId;
        this.#nextRequestId += 1;
        if (!Number.isSafeInteger(this.#nextRequestId)) {
            this.#markNotReady('request_sequence_exhausted');
            throw new Error('repository request sequence exhausted');
        }
        return new Promise((resolve, reject) => {
            const pending = {
                resolve,
                reject,
                readinessGated: READINESS_GATED_METHODS.has(method),
                queueTimer: setTimeout(() => {
                    this.#markNotReady('queue_age_exceeded');
                }, this.#watchdog.queueAgeLimitMs),
                latencyTimer: undefined,
            };
            this.#pending.set(id, pending);
            this.#watchdog.maxObservedPendingRequests = Math.max(
                this.#watchdog.maxObservedPendingRequests,
                this.#pending.size,
            );
            try {
                this.#worker.postMessage({
                    id,
                    method,
                    payload,
                    enqueuedAtMonotonicMs: performance.now(),
                });
            } catch (error) {
                this.#pending.delete(id);
                this.#clearPendingWatchdogs(pending);
                this.#failAll(error, 'worker_post_failed');
                reject(error);
            }
        });
    }

    watchdogStatus() {
        return Object.freeze({ ...this.#watchdog });
    }

    async close() {
        if (this.#closed) return;
        if (this.#closePromise) return this.#closePromise;
        this.#closing = true;
        this.#closePromise = (async () => {
            if (!this.#workerFailed) {
                try {
                    await this.request('close');
                } finally {
                    this.#closed = true;
                    await this.#worker.terminate();
                }
                return;
            }
            this.#closed = true;
            await this.#worker.terminate();
        })();
        return this.#closePromise;
    }
}

export async function openSmartOrderRepository(options) {
    const client = new SmartOrderRepositoryClient(options);
    await client.ready();
    return client;
}
