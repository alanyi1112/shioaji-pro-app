import { types as utilTypes } from 'node:util';

export const SMART_ORDER_GOOD_TILL_SETTLEMENT_POLICY_SCHEMA_VERSION =
    'smart-order-good-till-settlement-policy/2026-08-21.1';

const TERMINAL_BROKER_STATUSES = new Set([
    'Filled',
    'Cancelled',
    'Inactive',
    'Failed',
]);

function snapshot(candidate) {
    if (
        !candidate ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate) ||
        utilTypes.isProxy(candidate)
    ) {
        throw new TypeError('good-till settlement input must be a non-Proxy object');
    }
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const expected = [
        'brokerStatus',
        'cancelledShares',
        'confirmedFilledSharesBefore',
        'filledShares',
        'intentState',
        'orderShares',
        'remainingShares',
        'targetShares',
        'timeInForce',
    ];
    if (
        Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string') ||
        JSON.stringify(Object.keys(descriptors).sort()) !==
            JSON.stringify([...expected].sort())
    ) {
        throw new TypeError('good-till settlement input schema is invalid');
    }
    const result = {};
    for (const key of expected) {
        const descriptor = descriptors[key];
        if (
            descriptor?.enumerable !== true ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set')
        ) {
            throw new TypeError(`good-till settlement ${key} must be an own data property`);
        }
        result[key] = descriptor.value;
    }
    return Object.freeze(result);
}

function nonNegativeInteger(value, label, { minimum = 0 } = {}) {
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new TypeError(`${label} must be a safe integer >= ${minimum}`);
    }
    return value;
}

export function projectGoodTillReconciliationSettlement(candidate) {
    const input = snapshot(candidate);
    if (!['ROD', 'IOC'].includes(input.timeInForce)) {
        throw new TypeError('good-till settlement time-in-force is unsupported');
    }
    const orderShares = nonNegativeInteger(input.orderShares, 'orderShares', {
        minimum: 1,
    });
    const filledShares = nonNegativeInteger(input.filledShares, 'filledShares');
    const cancelledShares = nonNegativeInteger(
        input.cancelledShares,
        'cancelledShares',
    );
    const remainingShares = nonNegativeInteger(
        input.remainingShares,
        'remainingShares',
    );
    const targetShares = nonNegativeInteger(input.targetShares, 'targetShares', {
        minimum: 1,
    });
    const confirmedFilledSharesBefore = nonNegativeInteger(
        input.confirmedFilledSharesBefore,
        'confirmedFilledSharesBefore',
    );
    if (
        filledShares + cancelledShares + remainingShares !== orderShares ||
        confirmedFilledSharesBefore > targetShares
    ) {
        throw new Error('good-till settlement quantity projection is inconsistent');
    }
    const terminal = TERMINAL_BROKER_STATUSES.has(input.brokerStatus);
    if (!terminal) {
        return Object.freeze({
            schemaVersion:
                SMART_ORDER_GOOD_TILL_SETTLEMENT_POLICY_SCHEMA_VERSION,
            terminal: false,
            dailyState: ['unknown', 'reconciling'].includes(input.intentState)
                ? 'unknown_blocked'
                : 'working',
            dayActivationConsumed: true,
            automaticRetryAllowed: false,
            confirmedFilledShares: confirmedFilledSharesBefore,
            remainingTargetShares:
                targetShares - confirmedFilledSharesBefore,
        });
    }
    if (
        remainingShares !== 0 ||
        filledShares + cancelledShares !== orderShares
    ) {
        throw new Error('good-till terminal settlement is incomplete');
    }
    const confirmedFilledShares =
        confirmedFilledSharesBefore + filledShares;
    if (confirmedFilledShares > targetShares) {
        throw new Error('good-till confirmed fills exceed the target');
    }
    return Object.freeze({
        schemaVersion: SMART_ORDER_GOOD_TILL_SETTLEMENT_POLICY_SCHEMA_VERSION,
        terminal: true,
        dailyState:
            confirmedFilledShares === targetShares
                ? 'completed'
                : 'terminal_consumed',
        dayActivationConsumed: true,
        automaticRetryAllowed: false,
        confirmedFilledShares,
        remainingTargetShares: targetShares - confirmedFilledShares,
        activationState: filledShares > 0 ? 'filled' : 'failed',
        reservationState: filledShares > 0 ? 'consumed' : 'released',
    });
}
