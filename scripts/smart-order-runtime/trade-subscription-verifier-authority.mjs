import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';

const issuedVerifiers = new WeakSet();
const evidenceBindings = new WeakMap();

function digest(value) {
    return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function isPlainDataObject(value) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(descriptors).every((key) => {
        const descriptor = descriptors[key];
        return (
            typeof key === 'string' &&
            descriptor?.enumerable === true &&
            Object.hasOwn(descriptor, 'value') &&
            !Object.hasOwn(descriptor, 'get') &&
            !Object.hasOwn(descriptor, 'set')
        );
    });
}

function snapshotExpected(value) {
    if (!isPlainDataObject(value)) {
        throw new TypeError('trade transport evidence binding must be a plain data object');
    }
    return Object.freeze(structuredClone(value));
}

/**
 * Issues one process-private verifier for the production read-only Shioaji
 * observer.  This is not an HTTP or browser capability: only the sidecar
 * module receives the verifier/evidence issuer pair. Evidence is one-shot and
 * binds the exact coordinator expectation. No broker-write authority is
 * created here.
 */
export function createSmartOrderTradeSubscriptionTransportAuthority() {
    const issue = (kind, expected) => {
        const evidence = Object.freeze({ kind: 'private_trade_transport_evidence' });
        const binding = Object.freeze({
            kind,
            expected: snapshotExpected(expected),
        });
        evidenceBindings.set(evidence, binding);
        return evidence;
    };
    const verify = (kind, evidence, expected) => {
        const binding = evidenceBindings.get(evidence);
        if (!binding || binding.kind !== kind) {
            return Object.freeze({ valid: false, evidenceSha256: digest(['invalid', kind]) });
        }
        evidenceBindings.delete(evidence);
        let current;
        try {
            current = snapshotExpected(expected);
        } catch {
            return Object.freeze({ valid: false, evidenceSha256: digest(['invalid', kind]) });
        }
        const valid = canonicalJson(binding.expected) === canonicalJson(current);
        return Object.freeze({
            valid,
            evidenceSha256: digest([
                'smart-order-trade-transport-evidence/2026-08-13.1',
                kind,
                binding.expected,
            ]),
        });
    };
    const verifier = Object.freeze({
        verifyConnectionEvidence(evidence, expected) {
            return verify('connection', evidence, expected);
        },
        verifyEventEvidence(evidence, expected) {
            return verify('event', evidence, expected);
        },
        verifySubscriptionEvidence(evidence, expected) {
            return verify('subscription', evidence, expected);
        },
    });
    issuedVerifiers.add(verifier);
    return Object.freeze({
        verifier,
        issueConnectionEvidence(expected) {
            return issue('connection', expected);
        },
        issueEventEvidence(expected) {
            return issue('event', expected);
        },
        issueSubscriptionEvidence(expected) {
            return issue('subscription', expected);
        },
    });
}

export function isVerifiedSmartOrderTradeSubscriptionTransportVerifier(value) {
    return Boolean(value && typeof value === 'object' && issuedVerifiers.has(value));
}
