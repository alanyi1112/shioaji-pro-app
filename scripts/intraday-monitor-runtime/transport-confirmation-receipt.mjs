import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

export const INTRADAY_MONITOR_PROVIDER_SUBSCRIPTION_EVENT_SCHEMA =
    'intraday-monitor-provider-subscription-event/1';
export const INTRADAY_MONITOR_TRANSPORT_RECEIPT_SCHEMA =
    'intraday-monitor-transport-confirmation-receipt/1';
export const INTRADAY_MONITOR_DEFAULT_TRANSPORT_RECEIPT_MAX_AGE_MS = 5_000;

const EVENT_KEYS = Object.freeze([
    'schemaVersion', 'planId', 'action', 'connectionGeneration', 'physicalKey',
    'providerEventCode', 'providerTopic', 'observedAtEpochMs',
    'providerConfirmed', 'operationCorrelated',
    'subscriptionTransportAuthority', 'brokerWriteAuthority',
]);
const issuedReceipts = new WeakMap();

function isProxy(value) {
    try { return utilTypes.isProxy(value); } catch { return true; }
}

function exactRecord(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || isProxy(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors).sort();
    const expected = [...keys].sort();
    if (actual.some((key) => typeof key !== 'string') || actual.length !== expected.length ||
        !actual.every((key, index) => key === expected[index])) return null;
    const output = {};
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set')) return null;
        output[key] = descriptor.value;
    }
    return output;
}

function token(value, maximum = 256) {
    return typeof value === 'string' && value.length >= 1 && value.length <= maximum &&
        value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function validProviderTopic(plan, topic) {
    if (!token(topic, 256)) return false;
    const prefix = plan.quoteType === 'tick' ? 'TIC/' : 'QUO/';
    return topic.startsWith(prefix) && topic.includes('/STK/') &&
        topic.endsWith(`/${plan.contract.exchange}/${plan.contract.code}`);
}

function deny(reason) {
    return Object.freeze({ issued: false, reasons: Object.freeze([reason]),
        subscriptionTransportAuthority: false, brokerWriteAuthority: false });
}

export function createIntradayMonitorTransportReceiptVerifier({
    nowEpochMs = () => Date.now(),
    maximumAgeMs = INTRADAY_MONITOR_DEFAULT_TRANSPORT_RECEIPT_MAX_AGE_MS,
} = {}) {
    if (typeof nowEpochMs !== 'function' || isProxy(nowEpochMs) ||
        !Number.isSafeInteger(maximumAgeMs) || maximumAgeMs < 1 || maximumAgeMs > 30_000) {
        throw new TypeError('transport receipt verifier options are invalid');
    }
    let closed = false;
    let lastNow = -1;
    function now() {
        const value = Reflect.apply(nowEpochMs, undefined, []);
        if (!Number.isSafeInteger(value) || value < 0 || value < lastNow) {
            throw new TypeError('transport receipt verifier clock is invalid');
        }
        lastNow = value;
        return value;
    }
    return Object.freeze({
        issue(plan, value) {
            if (closed) return deny('transport_receipt_verifier_closed');
            const event = exactRecord(value, EVENT_KEYS);
            if (!plan || typeof plan !== 'object' || isProxy(plan) || !event ||
                event.schemaVersion !== INTRADAY_MONITOR_PROVIDER_SUBSCRIPTION_EVENT_SCHEMA) {
                return deny('provider_confirmation_schema_invalid');
            }
            let current;
            try { current = now(); } catch { return deny('provider_confirmation_clock_invalid'); }
            if (!Number.isSafeInteger(event.observedAtEpochMs) || event.observedAtEpochMs > current ||
                current - event.observedAtEpochMs > maximumAgeMs) return deny('provider_confirmation_stale');
            if (event.planId !== plan.planId || event.action !== plan.action ||
                event.connectionGeneration !== plan.connectionGeneration ||
                event.physicalKey !== plan.physicalKey || event.providerEventCode !== 16 ||
                event.providerConfirmed !== true || event.operationCorrelated !== true ||
                event.subscriptionTransportAuthority !== false || event.brokerWriteAuthority !== false ||
                !validProviderTopic(plan, event.providerTopic)) {
                return deny('provider_confirmation_mismatch');
            }
            const seed = `${event.planId}\u001f${event.action}\u001f${event.connectionGeneration}\u001f${event.physicalKey}\u001f${event.providerTopic}\u001f${event.observedAtEpochMs}`;
            const receipt = Object.freeze({
                issued: true,
                schemaVersion: INTRADAY_MONITOR_TRANSPORT_RECEIPT_SCHEMA,
                receiptId: `sha256:${createHash('sha256').update(seed).digest('hex')}`,
                planId: event.planId,
                action: event.action,
                connectionGeneration: event.connectionGeneration,
                physicalKey: event.physicalKey,
                providerEventCode: 16,
                observedAtEpochMs: event.observedAtEpochMs,
                subscriptionTransportAuthority: false,
                brokerWriteAuthority: false,
            });
            issuedReceipts.set(receipt, Object.freeze({ ...event }));
            return receipt;
        },
        close() { closed = true; },
    });
}

export function inspectIssuedIntradayMonitorTransportReceipt(receipt) {
    if (!receipt || typeof receipt !== 'object' || isProxy(receipt)) return undefined;
    return issuedReceipts.get(receipt);
}
