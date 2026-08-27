import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalManualStockBrokerWriteRequest } from './manual-broker-write-contract.mjs';

export const SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION =
    'smart-order-gate-probe-safety-envelope/2026-08-25.1';

export const SMART_ORDER_GATE_PROBE_MAX_LIFETIME_MS = 300_000;

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

function snapshot(value, requiredKeys, optionalKeys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        throw new TypeError(`${label} must be a non-Proxy object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    if (
        keys.some((key) => typeof key !== 'string' || !allowed.has(key)) ||
        requiredKeys.some((key) => !Object.hasOwn(descriptors, key))
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

function uuid(value, label) {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
        throw new TypeError(`${label} must be a UUID`);
    }
    return value.toLowerCase();
}

function digest(value, label) {
    if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
        throw new TypeError(`${label} must be a SHA-256 digest`);
    }
    return value;
}

function epoch(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} must be a non-negative safe integer`);
    }
    return value;
}

function sha256Json(value) {
    const json = JSON.stringify(value);
    return Object.freeze({
        json,
        sha256: `sha256:${createHash('sha256').update(json).digest('hex')}`,
    });
}

function accountFromRequest(request) {
    return request.operation === 'place'
        ? request.payload.stock_order.account
        : request.payload.account;
}

function operationFromRequest(request) {
    if (request.operation === 'place') return 'place';
    if (request.operation === 'cancel') return 'cancel';
    return 'update';
}

export function smartOrderGateProbeAccountScopeSha256(account) {
    const current = snapshot(
        account,
        ['account_id', 'account_type', 'broker_id'],
        [],
        'gate probe account',
    );
    if (
        current.account_type !== 'S' ||
        typeof current.broker_id !== 'string' ||
        current.broker_id.length < 1 ||
        typeof current.account_id !== 'string' ||
        current.account_id.length < 1
    ) {
        throw new TypeError('gate probe requires a fixed stock account');
    }
    return sha256Json({
        accountType: 'S',
        brokerId: current.broker_id,
        accountId: current.account_id,
    }).sha256;
}

export function canonicalSmartOrderGateProbeTarget(value, label = 'gate probe target') {
    const input = snapshot(
        value,
        [
            'accountScopeSha256',
            'correlationUnique',
            'nonTerminal',
            'originRunId',
            'quantityCommonLots',
            'revision',
            'targetIdSha256',
            'tradeDate',
            'tradeIdSha256',
        ],
        [],
        label,
    );
    if (
        input.correlationUnique !== true ||
        input.nonTerminal !== true ||
        input.quantityCommonLots !== 1 ||
        !Number.isSafeInteger(input.revision) ||
        input.revision < 0 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.tradeDate ?? '')
    ) {
        throw new TypeError(`${label} is not a unique live one-CommonLot target`);
    }
    return Object.freeze({
        originRunId: uuid(input.originRunId, `${label}.originRunId`),
        targetIdSha256: digest(
            input.targetIdSha256,
            `${label}.targetIdSha256`,
        ),
        tradeIdSha256: digest(
            input.tradeIdSha256,
            `${label}.tradeIdSha256`,
        ),
        accountScopeSha256: digest(
            input.accountScopeSha256,
            `${label}.accountScopeSha256`,
        ),
        tradeDate: input.tradeDate,
        revision: input.revision,
        quantityCommonLots: 1,
        nonTerminal: true,
        correlationUnique: true,
    });
}

export function canonicalSmartOrderGateProbeSafetyEnvelope(value) {
    const input = snapshot(
        value,
        [
            'confirmation',
            'nonce',
            'operationId',
            'request',
            'runId',
            'schemaVersion',
            'target',
            'tradeDate',
            'validUntilEpochMs',
        ],
        [],
        'gate probe safety envelope',
    );
    if (
        input.schemaVersion !==
            SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.tradeDate ?? '')
    ) {
        throw new TypeError('gate probe safety envelope binding is invalid');
    }
    const canonicalRequest = canonicalManualStockBrokerWriteRequest(
        input.request,
    );
    const request = canonicalRequest.request;
    const operation = operationFromRequest(request);
    const runId = uuid(input.runId, 'gateProbe.runId');
    const operationId = uuid(input.operationId, 'gateProbe.operationId');
    const nonce = uuid(input.nonce, 'gateProbe.nonce');
    const validUntilEpochMs = epoch(
        input.validUntilEpochMs,
        'gateProbe.validUntilEpochMs',
    );
    const account = accountFromRequest(request);
    const accountScopeSha256 = smartOrderGateProbeAccountScopeSha256(account);
    const confirmation = snapshot(
        input.confirmation,
        [
            'accountScopeSha256',
            'confirmed',
            'expectedOperation',
            'maximumCommonLots',
            'simulation',
        ],
        [],
        'gate probe explicit confirmation',
    );
    if (
        confirmation.simulation !== true ||
        confirmation.confirmed !== true ||
        confirmation.maximumCommonLots !== 1 ||
        confirmation.expectedOperation !== operation ||
        confirmation.accountScopeSha256 !== accountScopeSha256
    ) {
        throw new TypeError('gate probe explicit confirmation is invalid');
    }

    let target = null;
    if (operation === 'place') {
        if (
            input.target !== null ||
            request.payload.stock_order.order_lot !== 'Common' ||
            request.payload.stock_order.quantity !== 1
        ) {
            throw new TypeError(
                'gate probe place must be exactly one CommonLot without a target',
            );
        }
    } else {
        target = canonicalSmartOrderGateProbeTarget(input.target);
        const tradeIdSha256 = sha256Json(request.payload.trade_id).sha256;
        if (
            target.originRunId !== runId ||
            target.accountScopeSha256 !== accountScopeSha256 ||
            target.tradeDate !== input.tradeDate ||
            target.tradeIdSha256 !== tradeIdSha256 ||
            (request.operation === 'update_quantity' &&
                request.payload.quantity !== 1)
        ) {
            throw new TypeError(
                'gate probe update/cancel target is outside the same run and fixed account scope',
            );
        }
    }

    const projection = Object.freeze({
        schemaVersion: SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
        runId,
        operationId,
        nonceSha256: sha256Json(nonce).sha256,
        operation,
        requestSha256: canonicalRequest.requestSha256,
        accountScopeSha256,
        tradeDate: input.tradeDate,
        quantityCommonLots: 1,
        target,
        confirmationSha256: sha256Json({
            accountScopeSha256,
            confirmed: true,
            expectedOperation: operation,
            maximumCommonLots: 1,
            simulation: true,
        }).sha256,
        validUntilEpochMs,
    });
    const sourceEnvelope = Object.freeze({
        schemaVersion: SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
        runId,
        operationId,
        nonce,
        request,
        target,
        tradeDate: input.tradeDate,
        confirmation: Object.freeze({
            accountScopeSha256,
            confirmed: true,
            expectedOperation: operation,
            maximumCommonLots: 1,
            simulation: true,
        }),
        validUntilEpochMs,
    });
    const canonical = sha256Json(projection);
    return Object.freeze({
        envelope: projection,
        sourceEnvelope,
        envelopeJson: canonical.json,
        envelopeSha256: canonical.sha256,
        request,
        requestJson: canonicalRequest.requestJson,
    });
}

export function smartOrderGateProbeEnvelopeIsCurrent(
    envelope,
    nowEpochMs,
) {
    const now = epoch(nowEpochMs, 'gateProbe.nowEpochMs');
    return (
        envelope.validUntilEpochMs > now &&
        envelope.validUntilEpochMs - now <=
            SMART_ORDER_GATE_PROBE_MAX_LIFETIME_MS
    );
}
