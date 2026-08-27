import { createHash } from 'node:crypto';
import { SMART_ORDER_GATE_PROBE_MAX_LIFETIME_MS } from './gate-probe-safety-envelope.mjs';

export const SMART_ORDER_TASK_0_4_0_6_LIVE_OBSERVER_SCHEMA_VERSION =
    'smart-order-task-0.4-0.6-live-observer/2026-08-26.1';

const BASE_URL = 'http://127.0.0.1:8080';
const STREAM_URL = `${BASE_URL}/api/v1/stream/data/order_event`;
const SUBSCRIBE_URL = `${BASE_URL}/api/v1/auth/subscribe_trade`;
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024;
const MAX_EVENTS = 256;
const MAX_LIFETIME_MS = SMART_ORDER_GATE_PROBE_MAX_LIFETIME_MS;
const issuedObservers = new WeakSet();

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function account(value) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        value.account_type !== 'S' ||
        typeof value.broker_id !== 'string' ||
        value.broker_id.length < 1 ||
        typeof value.account_id !== 'string' ||
        value.account_id.length < 1
    ) {
        throw new TypeError('Task 0.4/0.6 observer account is invalid');
    }
    return Object.freeze({
        broker_id: value.broker_id,
        account_id: value.account_id,
        account_type: 'S',
    });
}

function responseIdentity(response, expectedUrl, contentType) {
    if (
        !response ||
        response.url !== expectedUrl ||
        response.redirected === true ||
        !response.ok ||
        !String(response.headers?.get?.('content-type') ?? '')
            .toLowerCase()
            .startsWith(contentType)
    ) {
        throw new Error('Task 0.4/0.6 observer response identity is invalid');
    }
}

async function openStream(fetchImpl, signal) {
    const response = await Reflect.apply(fetchImpl, globalThis, [STREAM_URL, {
        method: 'GET',
        headers: { accept: 'text/event-stream' },
        redirect: 'error',
        cache: 'no-store',
        signal,
    }]);
    responseIdentity(response, STREAM_URL, 'text/event-stream');
    if (!response.body?.getReader) {
        throw new Error('Task 0.4/0.6 observer stream is unavailable');
    }
    return response.body.getReader();
}

async function subscribe(fetchImpl, fixedAccount) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
        const response = await Reflect.apply(fetchImpl, globalThis, [SUBSCRIBE_URL, {
            method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify(fixedAccount),
            redirect: 'error',
            cache: 'no-store',
            signal: controller.signal,
        }]);
        responseIdentity(response, SUBSCRIBE_URL, 'application/json');
        const value = await response.json();
        if (
            value?.subscribe_trade !== true ||
            value?.account?.broker_id !== fixedAccount.broker_id ||
            value?.account?.account_id !== fixedAccount.account_id ||
            value?.account?.account_type !== 'S'
        ) {
            throw new Error('Task 0.4/0.6 trade subscription is not account-bound');
        }
    } finally {
        clearTimeout(timer);
    }
}

function parseBlock(block) {
    let eventName = 'message';
    const data = [];
    for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (eventName !== 'order_event' || data.length === 0) return null;
    return JSON.parse(data.join('\n'));
}

function exactEventProgress(events, {
    expectedCustomField,
    expectedDeal,
    expectedSeqno,
    expectedTradeId,
}) {
    let orderObserved = false;
    let dealObserved = false;
    for (const event of events) {
        if (event?.state === 'StockOrder') {
            const order = event?.data?.StockOrder?.order;
            orderObserved ||=
                order?.id === expectedTradeId &&
                order?.seqno === expectedSeqno &&
                (order?.custom_field === undefined ||
                    order?.custom_field === null ||
                    order?.custom_field === expectedCustomField);
        } else if (event?.state === 'StockDeal') {
            const deal = event?.data?.StockDeal;
            dealObserved ||=
                deal?.trade_id === expectedTradeId &&
                deal?.seqno === expectedSeqno;
        }
    }
    return Object.freeze({
        complete: orderObserved && (!expectedDeal || dealObserved),
        orderObserved,
        dealObserved,
    });
}

function startReader(reader, signal) {
    const events = [];
    let totalBytes = 0;
    let buffer = '';
    let terminalError;
    let notify;
    const changed = () => {
        notify?.();
        notify = undefined;
    };
    const done = (async () => {
        const decoder = new TextDecoder();
        try {
            while (!signal.aborted) {
                const next = await reader.read();
                if (next.done) break;
                const bytes = next.value instanceof Uint8Array
                    ? next.value
                    : new Uint8Array(next.value);
                totalBytes += bytes.byteLength;
                if (totalBytes > MAX_TOTAL_BYTES) {
                    throw new Error('Task 0.4/0.6 observer stream is oversized');
                }
                buffer += decoder.decode(bytes, { stream: true });
                let boundary;
                while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
                    const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? '\n\n';
                    const block = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + separator.length);
                    if (Buffer.byteLength(block) > MAX_EVENT_BYTES) {
                        throw new Error('Task 0.4/0.6 observer event is oversized');
                    }
                    const payload = parseBlock(block);
                    if (payload !== null) {
                        events.push(payload);
                        if (events.length > MAX_EVENTS) {
                            throw new Error('Task 0.4/0.6 observer event count exceeded');
                        }
                        changed();
                    }
                }
                if (Buffer.byteLength(buffer) > MAX_EVENT_BYTES) {
                    throw new Error('Task 0.4/0.6 observer buffer is oversized');
                }
            }
        } catch (error) {
            if (!signal.aborted) terminalError = error;
        } finally {
            changed();
        }
    })();
    done.catch(() => {});
    return Object.freeze({
        events,
        done,
        error: () => terminalError,
        waitForChange: (timeoutMs) =>
            new Promise((resolve) => {
                const timer = setTimeout(resolve, timeoutMs);
                notify = () => {
                    clearTimeout(timer);
                    resolve();
                };
            }),
    });
}

export async function startSmartOrderTask0406LiveObserver({
    account: accountValue,
    accountScopeSha256,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
}) {
    const fixedAccount = account(accountValue);
    if (
        typeof fetchImpl !== 'function' ||
        typeof now !== 'function' ||
        !/^sha256:[0-9a-f]{64}$/.test(accountScopeSha256 ?? '')
    ) {
        throw new TypeError('Task 0.4/0.6 observer configuration is invalid');
    }
    const preController = new AbortController();
    const postController = new AbortController();
    const createdAtEpochMs = now();
    const deadlineEpochMs = createdAtEpochMs + MAX_LIFETIME_MS;
    let preReader;
    let postReader;
    let readerState;
    try {
        preReader = await openStream(fetchImpl, preController.signal);
        await subscribe(fetchImpl, fixedAccount);
        preController.abort();
        await preReader.cancel().catch(() => {});
        preReader = undefined;
        postReader = await openStream(fetchImpl, postController.signal);
        readerState = startReader(postReader, postController.signal);
        const observer = Object.freeze({
            schemaVersion: SMART_ORDER_TASK_0_4_0_6_LIVE_OBSERVER_SCHEMA_VERSION,
            accountScopeSha256,
            evidenceSha256: sha256(
                JSON.stringify({ accountScopeSha256, createdAtEpochMs, deadlineEpochMs }),
            ),
            validUntilEpochMs: deadlineEpochMs,
            brokerAuthority: false,
            async revalidateReady({ minimumRemainingMs = 7_000 } = {}) {
                if (
                    postController.signal.aborted ||
                    readerState.error() ||
                    deadlineEpochMs - now() < minimumRemainingMs
                ) {
                    throw new Error('Task 0.4/0.6 observer is not current');
                }
                return Object.freeze({
                    current: true,
                    observerDeadlineEpochMs: deadlineEpochMs,
                    minimumRemainingMs,
                    brokerAuthority: false,
                });
            },
            markDispatchBoundary() {
                if (postController.signal.aborted || readerState.error()) {
                    throw new Error('Task 0.4/0.6 observer dispatch boundary is unavailable');
                }
                return readerState.events.length;
            },
            async collect({ afterIndex, minimumEvents = 1, settleMs = 750, timeoutMs = 10_000 } = {}) {
                if (
                    !Number.isSafeInteger(afterIndex) ||
                    afterIndex < 0 ||
                    afterIndex > readerState.events.length ||
                    !Number.isSafeInteger(minimumEvents) ||
                    minimumEvents < 1 ||
                    !Number.isSafeInteger(settleMs) ||
                    settleMs < 0 ||
                    settleMs > 2_000
                ) {
                    throw new TypeError('Task 0.4/0.6 observer collection scope is invalid');
                }
                const boundedDeadline = Math.min(deadlineEpochMs, now() + timeoutMs);
                while (
                    readerState.events.length - afterIndex < minimumEvents &&
                    !readerState.error() &&
                    now() < boundedDeadline
                ) {
                    await readerState.waitForChange(
                        Math.max(1, Math.min(250, boundedDeadline - now())),
                    );
                }
                if (readerState.error()) throw readerState.error();
                if (readerState.events.length - afterIndex >= minimumEvents && settleMs > 0) {
                    await readerState.waitForChange(
                        Math.max(1, Math.min(settleMs, boundedDeadline - now())),
                    );
                }
                return Object.freeze(readerState.events.slice(afterIndex));
            },
            async collectExact({
                afterIndex,
                expectedCustomField,
                expectedDeal,
                expectedSeqno,
                expectedTradeId,
                settleMs = 750,
                timeoutMs = 15_000,
            }) {
                if (
                    !Number.isSafeInteger(afterIndex) ||
                    afterIndex < 0 ||
                    afterIndex > readerState.events.length ||
                    typeof expectedTradeId !== 'string' ||
                    expectedTradeId.length < 1 ||
                    expectedTradeId.length > 160 ||
                    typeof expectedSeqno !== 'string' ||
                    expectedSeqno.length < 1 ||
                    expectedSeqno.length > 160 ||
                    !/^[A-Z0-9]{6}$/.test(expectedCustomField ?? '') ||
                    typeof expectedDeal !== 'boolean' ||
                    !Number.isSafeInteger(settleMs) ||
                    settleMs < 0 ||
                    settleMs > 2_000 ||
                    !Number.isSafeInteger(timeoutMs) ||
                    timeoutMs < 100 ||
                    timeoutMs > 20_000
                ) {
                    throw new TypeError('Task 0.4/0.6 exact observer scope is invalid');
                }
                const boundedDeadline = Math.min(deadlineEpochMs, now() + timeoutMs);
                let progress = exactEventProgress(
                    readerState.events.slice(afterIndex),
                    { expectedCustomField, expectedDeal, expectedSeqno, expectedTradeId },
                );
                while (!progress.complete && !readerState.error() && now() < boundedDeadline) {
                    await readerState.waitForChange(
                        Math.max(1, Math.min(250, boundedDeadline - now())),
                    );
                    progress = exactEventProgress(
                        readerState.events.slice(afterIndex),
                        { expectedCustomField, expectedDeal, expectedSeqno, expectedTradeId },
                    );
                }
                if (readerState.error()) throw readerState.error();
                if (progress.complete && settleMs > 0) {
                    await readerState.waitForChange(
                        Math.max(1, Math.min(settleMs, boundedDeadline - now())),
                    );
                }
                return Object.freeze({
                    events: Object.freeze(readerState.events.slice(afterIndex)),
                    ...progress,
                    brokerAuthority: false,
                });
            },
            async close() {
                postController.abort();
                await postReader?.cancel().catch(() => {});
                await readerState.done;
            },
        });
        issuedObservers.add(observer);
        return observer;
    } catch (error) {
        preController.abort();
        postController.abort();
        await preReader?.cancel().catch(() => {});
        await postReader?.cancel().catch(() => {});
        await readerState?.done.catch(() => {});
        throw error;
    }
}

export function isIssuedSmartOrderTask0406LiveObserver(value) {
    return Boolean(value && typeof value === 'object' && issuedObservers.has(value));
}
