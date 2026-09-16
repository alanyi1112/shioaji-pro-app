import { createHash } from 'node:crypto';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';

export const INTRADAY_MONITOR_PILOT_COHORT_RECEIPTS_SCHEMA =
    'intraday-monitor-pilot-cohort-receipts/1';

const CHANGE_ID = 'add-configurable-intraday-relative-volume-monitor';
const SYMBOL = /^\d{4,6}[A-Z]?\.(?:TW|TWO)$/;
const VERSION = /^[A-Za-z0-9:._-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const RECEIPT_KEYS = Object.freeze([
    'canonicalSymbol',
    'securityType',
    'region',
    'exchange',
    'code',
    'receiptHash',
]);
const MANIFEST_KEYS = Object.freeze([
    'schemaVersion',
    'changeId',
    'sourceEndpoint',
    'sourceVersion',
    'verifiedAt',
    'cohort',
    'receipts',
    'providerRequestAuthority',
    'subscriptionTransportAuthority',
    'serviceLifecycleAuthority',
    'brokerWriteAuthority',
    'manifestHash',
]);

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function exactRecord(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length &&
        actual.every((key, index) => key === expected[index]);
}

function hash(value) {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function withHash(seed, key) {
    return deepFreeze({ ...seed, [key]: hash(seed) });
}

function hashMatches(value, key) {
    if (!value || typeof value !== 'object' || !HASH.test(value[key])) return false;
    const seed = { ...value };
    delete seed[key];
    return hash(seed) === value[key];
}

function validInstant(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isLoopbackHttpUrl(value) {
    try {
        const url = new URL(value);
        return (
            ['http:', 'https:'].includes(url.protocol) &&
            ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        );
    } catch {
        return false;
    }
}

function canonicalFromContract(contract) {
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return null;
    const securityType = contract.security_type ?? contract.securityType;
    const region = contract.region;
    const exchange = contract.exchange;
    const code = String(contract.code ?? '').trim().toUpperCase();
    if (
        securityType !== 'STK' ||
        region !== 'TW' ||
        !['TSE', 'OTC'].includes(exchange) ||
        !/^\d{4,6}[A-Z]?$/.test(code)
    ) {
        return null;
    }
    return {
        canonicalSymbol: `${code}.${exchange === 'TSE' ? 'TW' : 'TWO'}`,
        securityType,
        region,
        exchange,
        code,
    };
}

function validReceipt(value) {
    if (!exactRecord(value, RECEIPT_KEYS) || !hashMatches(value, 'receiptHash')) return false;
    const seed = { ...value };
    delete seed.receiptHash;
    const canonical = canonicalFromContract({
        security_type: seed.securityType,
        region: seed.region,
        exchange: seed.exchange,
        code: seed.code,
    });
    return canonical?.canonicalSymbol === seed.canonicalSymbol;
}

function validManifest(value) {
    return Boolean(
        exactRecord(value, MANIFEST_KEYS) &&
            value.schemaVersion === INTRADAY_MONITOR_PILOT_COHORT_RECEIPTS_SCHEMA &&
            value.changeId === CHANGE_ID &&
            isLoopbackHttpUrl(value.sourceEndpoint) &&
            typeof value.sourceVersion === 'string' &&
            VERSION.test(value.sourceVersion) &&
            validInstant(value.verifiedAt) &&
            Array.isArray(value.cohort) &&
            value.cohort.length >= 1 &&
            value.cohort.length <= 200 &&
            value.cohort.every((symbol) => typeof symbol === 'string' && SYMBOL.test(symbol)) &&
            new Set(value.cohort).size === value.cohort.length &&
            Array.isArray(value.receipts) &&
            value.receipts.length === value.cohort.length &&
            value.receipts.every(validReceipt) &&
            value.receipts.every(
                (receipt, index) => receipt.canonicalSymbol === value.cohort[index],
            ) &&
            value.providerRequestAuthority === false &&
            value.subscriptionTransportAuthority === false &&
            value.serviceLifecycleAuthority === false &&
            value.brokerWriteAuthority === false &&
            hashMatches(value, 'manifestHash'),
    );
}

export function createIntradayMonitorPilotCohortReceiptManifest({
    requestedSymbols,
    contracts,
    sourceEndpoint,
    sourceVersion,
    verifiedAt,
} = {}) {
    const cohort = Array.isArray(requestedSymbols)
        ? requestedSymbols.map((value) => String(value).trim().toUpperCase())
        : [];
    if (
        cohort.length < 1 ||
        cohort.length > 200 ||
        cohort.some((symbol) => !SYMBOL.test(symbol)) ||
        new Set(cohort).size !== cohort.length ||
        !Array.isArray(contracts)
    ) {
        throw new TypeError('pilot cohort receipt input is invalid');
    }

    const bySymbol = new Map();
    for (const raw of contracts) {
        const normalized = canonicalFromContract(raw);
        if (!normalized || !cohort.includes(normalized.canonicalSymbol)) continue;
        if (bySymbol.has(normalized.canonicalSymbol)) {
            throw new TypeError('pilot cohort contract is ambiguous');
        }
        bySymbol.set(normalized.canonicalSymbol, normalized);
    }
    if (cohort.some((symbol) => !bySymbol.has(symbol))) {
        throw new TypeError('pilot cohort contract receipt is missing');
    }

    const receipts = cohort.map((symbol) =>
        withHash(bySymbol.get(symbol), 'receiptHash'),
    );
    const manifest = withHash(
        {
            schemaVersion: INTRADAY_MONITOR_PILOT_COHORT_RECEIPTS_SCHEMA,
            changeId: CHANGE_ID,
            sourceEndpoint,
            sourceVersion,
            verifiedAt,
            cohort,
            receipts,
            providerRequestAuthority: false,
            subscriptionTransportAuthority: false,
            serviceLifecycleAuthority: false,
            brokerWriteAuthority: false,
        },
        'manifestHash',
    );
    if (!validManifest(manifest)) {
        throw new TypeError('pilot cohort receipt manifest is invalid');
    }
    return manifest;
}

export function validateIntradayMonitorPilotCohortReceiptManifest(value) {
    const valid = validManifest(value);
    return deepFreeze({
        valid,
        reasons: valid ? [] : ['invalid_cohort_receipt_manifest'],
    });
}
