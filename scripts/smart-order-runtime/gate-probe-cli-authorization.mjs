import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import {
    canonicalSmartOrderGateProbeSafetyEnvelope,
    smartOrderGateProbeEnvelopeIsCurrent,
} from './gate-probe-safety-envelope.mjs';

export const SMART_ORDER_GATE_PROBE_CLI_AUTHORIZATION_SCHEMA_VERSION =
    'smart-order-gate-probe-cli-authorization/2026-08-25.1';

const PROOF_PATTERN = /^hmac-sha256:[0-9a-f]{64}$/;

function snapshot(value, keys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        throw new TypeError(`${label} must be an exact non-Proxy object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
        Reflect.ownKeys(descriptors).some(
            (key) => typeof key !== 'string' || !keys.includes(key),
        ) ||
        keys.some((key) => !Object.hasOwn(descriptors, key))
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    const result = {};
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (
            descriptor?.enumerable !== true ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set')
        ) {
            throw new TypeError(`${label}.${key} must be an own data property`);
        }
        result[key] = descriptor.value;
    }
    return Object.freeze(result);
}

function capabilityBytes(value) {
    if (!(value instanceof Uint8Array) || value.byteLength !== 32) {
        throw new TypeError('gate probe CLI capability is invalid');
    }
    return value;
}

function epoch(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} is invalid`);
    }
    return value;
}

function digest(value, label) {
    if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
        throw new TypeError(`${label} is invalid`);
    }
    return value;
}

function unsignedAuthorization(
    canonical,
    authorizedAtEpochMs,
    apiGenerationSha256,
    runtimeEpochIdSha256,
) {
    return Object.freeze({
        schemaVersion:
            SMART_ORDER_GATE_PROBE_CLI_AUTHORIZATION_SCHEMA_VERSION,
        operationId: canonical.envelope.operationId,
        runId: canonical.envelope.runId,
        envelopeSha256: canonical.envelopeSha256,
        apiGenerationSha256: digest(
            apiGenerationSha256,
            'gate probe CLI API generation digest',
        ),
        runtimeEpochIdSha256: digest(
            runtimeEpochIdSha256,
            'gate probe CLI Runtime epoch digest',
        ),
        authorizedAtEpochMs,
        validUntilEpochMs: canonical.envelope.validUntilEpochMs,
    });
}

function authorizationProof(capability, unsigned) {
    return `hmac-sha256:${createHmac('sha256', capabilityBytes(capability))
        .update(JSON.stringify(unsigned))
        .digest('hex')}`;
}

export function issueSmartOrderGateProbeCliAuthorization({
    capability,
    envelope,
    authorizedAtEpochMs,
    apiGenerationSha256,
    runtimeEpochIdSha256,
}) {
    const canonical = canonicalSmartOrderGateProbeSafetyEnvelope(envelope);
    const authorizedAt = epoch(
        authorizedAtEpochMs,
        'gate probe CLI authorizedAtEpochMs',
    );
    if (!smartOrderGateProbeEnvelopeIsCurrent(canonical.envelope, authorizedAt)) {
        throw new Error('gate probe CLI authorization is expired or overlong');
    }
    const unsigned = unsignedAuthorization(
        canonical,
        authorizedAt,
        apiGenerationSha256,
        runtimeEpochIdSha256,
    );
    return Object.freeze({
        ...unsigned,
        proof: authorizationProof(capability, unsigned),
    });
}

export function verifySmartOrderGateProbeCliAuthorization({
    capability,
    envelope,
    authorization,
    nowEpochMs,
    expectedApiGenerationSha256,
    expectedRuntimeEpochIdSha256,
}) {
    const canonical = canonicalSmartOrderGateProbeSafetyEnvelope(envelope);
    const now = epoch(nowEpochMs, 'gate probe CLI verification nowEpochMs');
    const input = snapshot(
        authorization,
        [
            'authorizedAtEpochMs',
            'apiGenerationSha256',
            'envelopeSha256',
            'operationId',
            'proof',
            'runId',
            'runtimeEpochIdSha256',
            'schemaVersion',
            'validUntilEpochMs',
        ],
        'gate probe CLI authorization',
    );
    const unsigned = unsignedAuthorization(
        canonical,
        epoch(input.authorizedAtEpochMs, 'gate probe CLI authorizedAtEpochMs'),
        input.apiGenerationSha256,
        input.runtimeEpochIdSha256,
    );
    if (
        input.schemaVersion !== unsigned.schemaVersion ||
        input.operationId !== unsigned.operationId ||
        input.runId !== unsigned.runId ||
        input.envelopeSha256 !== unsigned.envelopeSha256 ||
        input.validUntilEpochMs !== unsigned.validUntilEpochMs ||
        input.apiGenerationSha256 !==
            digest(
                expectedApiGenerationSha256,
                'expected gate probe API generation digest',
            ) ||
        input.runtimeEpochIdSha256 !==
            digest(
                expectedRuntimeEpochIdSha256,
                'expected gate probe Runtime epoch digest',
            ) ||
        input.authorizedAtEpochMs > now ||
        !smartOrderGateProbeEnvelopeIsCurrent(canonical.envelope, now) ||
        !PROOF_PATTERN.test(input.proof ?? '')
    ) {
        throw new Error('gate probe CLI authorization binding is invalid');
    }
    const expected = Buffer.from(
        authorizationProof(capability, unsigned),
        'utf8',
    );
    const actual = Buffer.from(input.proof, 'utf8');
    const valid =
        expected.byteLength === actual.byteLength &&
        timingSafeEqual(expected, actual);
    expected.fill(0);
    actual.fill(0);
    if (!valid) {
        throw new Error('gate probe CLI authorization proof is invalid');
    }
    return Object.freeze({
        cliAuthorizationSha256: `sha256:${createHash('sha256')
            .update(JSON.stringify(input))
            .digest('hex')}`,
        envelopeSha256: canonical.envelopeSha256,
        operationId: canonical.envelope.operationId,
        authorizedAtEpochMs: input.authorizedAtEpochMs,
        validUntilEpochMs: input.validUntilEpochMs,
    });
}
