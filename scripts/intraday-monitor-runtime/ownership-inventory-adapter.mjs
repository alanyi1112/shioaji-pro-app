import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

export const INTRADAY_MONITOR_OWNERSHIP_INVENTORY_SCHEMA =
    'intraday-monitor-ownership-inventory/1';
export const INTRADAY_MONITOR_OWNERSHIP_ADAPTER_SCHEMA =
    'intraday-monitor-ownership-adapter/1';
export const INTRADAY_MONITOR_OFFICIAL_PHYSICAL_LIMIT = 200;
export const INTRADAY_MONITOR_LOCAL_PHYSICAL_LIMIT = 160;
export const INTRADAY_MONITOR_REQUIRED_HEADROOM = 40;
export const INTRADAY_MONITOR_DEFAULT_INVENTORY_MAX_AGE_MS = 30_000;

const INVENTORY_KEYS = Object.freeze([
    'schemaVersion',
    'evidenceId',
    'generatedAtEpochMs',
    'validUntilEpochMs',
    'connectionGeneration',
    'countingDimension',
    'ownershipComplete',
    'externalUsageVisible',
    'officialPhysicalLimit',
    'localPhysicalLimit',
    'requiredHeadroom',
    'owners',
    'pollingFallbackAllowed',
    'subscriptionTransportAuthority',
    'brokerWriteAuthority',
]);
const OWNER_KEYS = Object.freeze([
    'ownerId',
    'ownerKind',
    'connectionGeneration',
    'physicalKey',
    'contract',
    'quoteType',
    'refCount',
    'confirmation',
    'observedAtEpochMs',
]);
const CONTRACT_KEYS = Object.freeze(['code', 'exchange', 'securityType']);
const OWNER_KINDS = new Set([
    'chart',
    'watchlist',
    'alert',
    'smart_order_safety',
    'multiview',
    'intraday_monitor',
    'external_client',
]);
const QUOTE_TYPES = new Set(['tick', 'bidask']);
const CONFIRMATIONS = new Set([
    'confirmed',
    'unknown',
    'unsubscribe_pending',
]);
const EXCHANGES = new Set(['TSE', 'OTC']);
const issuedInventories = new WeakMap();

function isProxy(value) {
    try {
        return utilTypes.isProxy(value);
    } catch {
        return true;
    }
}

function exactSnapshot(value, keys, label) {
    if (
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        isProxy(value)
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    if (actual.some((key) => typeof key !== 'string')) {
        throw new TypeError(`${label} symbol properties are forbidden`);
    }
    const expected = [...keys].sort();
    actual.sort();
    if (
        actual.length !== expected.length ||
        !actual.every((key, index) => key === expected[index])
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    const snapshot = {};
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (
            !descriptor?.enumerable ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set')
        ) {
            throw new TypeError(`${label} must use enumerable data properties`);
        }
        snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
}

function boundedToken(value, label, maximum = 256) {
    if (
        typeof value !== 'string' ||
        value.length < 1 ||
        value.length > maximum ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        throw new TypeError(`${label} is invalid`);
    }
    return value;
}

function safeEpoch(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} is invalid`);
    }
    return value;
}

function normalizeContract(value) {
    const input = exactSnapshot(value, CONTRACT_KEYS, 'ownership contract');
    const code = boundedToken(input.code, 'contract.code', 16);
    const exchange = boundedToken(input.exchange, 'contract.exchange', 8);
    if (
        input.securityType !== 'STK' ||
        !EXCHANGES.has(exchange) ||
        !/^\d{4,6}[A-Z]?$/.test(code)
    ) {
        throw new TypeError('ownership contract is not a Taiwan regular-lot stock');
    }
    return Object.freeze({ code, exchange, securityType: 'STK' });
}

export function intradayMonitorPhysicalKey(
    connectionGeneration,
    contract,
    quoteType,
) {
    const generation = boundedToken(
        connectionGeneration,
        'connectionGeneration',
        128,
    );
    const normalizedContract = normalizeContract(contract);
    if (!QUOTE_TYPES.has(quoteType)) {
        throw new TypeError('quoteType is unsupported');
    }
    const canonical = JSON.stringify([
        generation,
        normalizedContract.exchange,
        normalizedContract.securityType,
        normalizedContract.code,
        quoteType,
    ]);
    return `sha256:${createHash('sha256')
        .update(`intraday-monitor-physical\u001f${canonical}`)
        .digest('hex')}`;
}

function invalidInventory(reasons) {
    return Object.freeze({
        issued: false,
        schemaVersion: INTRADAY_MONITOR_OWNERSHIP_ADAPTER_SCHEMA,
        reasons: Object.freeze([...new Set(reasons)].sort()),
        subscriptionTransportAuthority: false,
        brokerWriteAuthority: false,
    });
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
        return value;
    }
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function normalizeOwner(value, context) {
    const input = exactSnapshot(value, OWNER_KEYS, 'ownership owner');
    const ownerId = boundedToken(input.ownerId, 'ownerId');
    const ownerKind = boundedToken(input.ownerKind, 'ownerKind', 64);
    if (!OWNER_KINDS.has(ownerKind)) {
        throw new TypeError('ownerKind is unsupported');
    }
    if (input.connectionGeneration !== context.connectionGeneration) {
        throw new TypeError('owner connection generation is mixed');
    }
    const contract = normalizeContract(input.contract);
    if (!QUOTE_TYPES.has(input.quoteType)) {
        throw new TypeError('owner quoteType is unsupported');
    }
    if (
        !Number.isSafeInteger(input.refCount) ||
        input.refCount < 1 ||
        input.refCount > 1_000_000
    ) {
        throw new TypeError('owner refCount is invalid');
    }
    if (!CONFIRMATIONS.has(input.confirmation)) {
        throw new TypeError('owner confirmation is invalid');
    }
    const observedAtEpochMs = safeEpoch(
        input.observedAtEpochMs,
        'owner.observedAtEpochMs',
    );
    if (
        observedAtEpochMs > context.generatedAtEpochMs ||
        context.generatedAtEpochMs - observedAtEpochMs > context.maximumAgeMs
    ) {
        throw new TypeError('owner evidence is stale');
    }
    const expectedPhysicalKey = intradayMonitorPhysicalKey(
        context.connectionGeneration,
        contract,
        input.quoteType,
    );
    if (input.physicalKey !== expectedPhysicalKey) {
        throw new TypeError('owner physicalKey does not match canonical identity');
    }
    return Object.freeze({
        ownerId,
        ownerKind,
        connectionGeneration: context.connectionGeneration,
        physicalKey: expectedPhysicalKey,
        contract,
        quoteType: input.quoteType,
        refCount: input.refCount,
        confirmation: input.confirmation,
        observedAtEpochMs,
        freshness: 'current',
    });
}

function normalizeInventory(value, nowEpochMs, maximumAgeMs) {
    const input = exactSnapshot(value, INVENTORY_KEYS, 'ownership inventory');
    if (input.schemaVersion !== INTRADAY_MONITOR_OWNERSHIP_INVENTORY_SCHEMA) {
        throw new TypeError('ownership inventory schema version is unsupported');
    }
    const evidenceId = boundedToken(input.evidenceId, 'evidenceId');
    const generatedAtEpochMs = safeEpoch(
        input.generatedAtEpochMs,
        'generatedAtEpochMs',
    );
    const validUntilEpochMs = safeEpoch(
        input.validUntilEpochMs,
        'validUntilEpochMs',
    );
    if (
        generatedAtEpochMs > nowEpochMs ||
        validUntilEpochMs <= nowEpochMs ||
        validUntilEpochMs <= generatedAtEpochMs ||
        validUntilEpochMs - generatedAtEpochMs > maximumAgeMs
    ) {
        throw new TypeError('ownership inventory is not current');
    }
    const connectionGeneration = boundedToken(
        input.connectionGeneration,
        'connectionGeneration',
        128,
    );
    const countingDimension = boundedToken(
        input.countingDimension,
        'countingDimension',
        128,
    );
    if (
        input.ownershipComplete !== true ||
        input.externalUsageVisible !== true
    ) {
        throw new TypeError('global ownership is incomplete');
    }
    if (
        input.officialPhysicalLimit !==
            INTRADAY_MONITOR_OFFICIAL_PHYSICAL_LIMIT ||
        input.localPhysicalLimit !== INTRADAY_MONITOR_LOCAL_PHYSICAL_LIMIT ||
        input.requiredHeadroom !== INTRADAY_MONITOR_REQUIRED_HEADROOM ||
        input.localPhysicalLimit + input.requiredHeadroom !==
            input.officialPhysicalLimit
    ) {
        throw new TypeError('ownership inventory limit contract is invalid');
    }
    if (
        input.pollingFallbackAllowed !== false ||
        input.subscriptionTransportAuthority !== false ||
        input.brokerWriteAuthority !== false
    ) {
        throw new TypeError('ownership inventory attempts to widen authority');
    }
    if (!Array.isArray(input.owners) || input.owners.length > 10_000) {
        throw new TypeError('ownership owners are invalid');
    }
    const context = {
        connectionGeneration,
        generatedAtEpochMs,
        maximumAgeMs,
    };
    const owners = input.owners.map((owner) => normalizeOwner(owner, context));
    const ownerIdentity = new Set();
    const physical = new Map();
    for (const owner of owners) {
        const identity = `${owner.ownerKind}\u001f${owner.ownerId}\u001f${owner.physicalKey}`;
        if (ownerIdentity.has(identity)) {
            throw new TypeError('duplicate owner identity');
        }
        ownerIdentity.add(identity);
        const existing = physical.get(owner.physicalKey);
        if (
            existing &&
            (existing.quoteType !== owner.quoteType ||
                existing.contract.code !== owner.contract.code ||
                existing.contract.exchange !== owner.contract.exchange ||
                existing.confirmation !== owner.confirmation)
        ) {
            throw new TypeError('physical ownership records conflict');
        }
        if (!existing) {
            physical.set(owner.physicalKey, {
                physicalKey: owner.physicalKey,
                connectionGeneration,
                contract: owner.contract,
                quoteType: owner.quoteType,
                confirmation: owner.confirmation,
                ownerRefCount: owner.refCount,
                ownerKinds: new Set([owner.ownerKind]),
            });
        } else {
            existing.ownerRefCount += owner.refCount;
            existing.ownerKinds.add(owner.ownerKind);
        }
    }
    const physicalSubscriptions = [...physical.values()]
        .map((entry) =>
            deepFreeze({
                ...entry,
                ownerKinds: [...entry.ownerKinds].sort(),
            }),
        )
        .sort((left, right) =>
            left.physicalKey.localeCompare(right.physicalKey),
        );
    if (physicalSubscriptions.length > input.officialPhysicalLimit) {
        throw new TypeError('ownership inventory exceeds official limit');
    }
    const confirmedPhysicalUsage = physicalSubscriptions.filter(
        (entry) => entry.confirmation === 'confirmed',
    ).length;
    const retainedPhysicalUsage = physicalSubscriptions.length;
    const inventoryHasUnknownPhysicalState = physicalSubscriptions.some(
        (entry) => entry.confirmation !== 'confirmed',
    );
    return deepFreeze({
        schemaVersion: INTRADAY_MONITOR_OWNERSHIP_INVENTORY_SCHEMA,
        evidenceId,
        generatedAtEpochMs,
        validUntilEpochMs,
        connectionGeneration,
        countingDimension,
        ownershipComplete: true,
        externalUsageVisible: true,
        officialPhysicalLimit: input.officialPhysicalLimit,
        localPhysicalLimit: input.localPhysicalLimit,
        requiredHeadroom: input.requiredHeadroom,
        owners: [...owners].sort((left, right) => {
            const leftKey = `${left.ownerKind}\u001f${left.ownerId}\u001f${left.physicalKey}`;
            const rightKey = `${right.ownerKind}\u001f${right.ownerId}\u001f${right.physicalKey}`;
            return leftKey.localeCompare(rightKey);
        }),
        physicalSubscriptions,
        confirmedPhysicalUsage,
        retainedPhysicalUsage,
        inventoryHasUnknownPhysicalState,
        availableForMonitor: inventoryHasUnknownPhysicalState
            ? 0
            : Math.max(0, input.localPhysicalLimit - confirmedPhysicalUsage),
        pollingFallbackAllowed: false,
        subscriptionTransportAuthority: false,
        brokerWriteAuthority: false,
    });
}

export function createIntradayMonitorOwnershipInventoryAdapter({
    nowEpochMs = () => Date.now(),
    maximumAgeMs = INTRADAY_MONITOR_DEFAULT_INVENTORY_MAX_AGE_MS,
} = {}) {
    if (
        typeof nowEpochMs !== 'function' ||
        isProxy(nowEpochMs) ||
        !Number.isSafeInteger(maximumAgeMs) ||
        maximumAgeMs < 1 ||
        maximumAgeMs > 300_000
    ) {
        throw new TypeError('ownership adapter options are invalid');
    }
    let closed = false;
    let lastNow = -1;
    function currentNow() {
        const value = Reflect.apply(nowEpochMs, undefined, []);
        if (!Number.isSafeInteger(value) || value < 0 || value < lastNow) {
            throw new TypeError('ownership adapter clock is invalid');
        }
        lastNow = value;
        return value;
    }
    return Object.freeze({
        issue(value) {
            if (closed) return invalidInventory(['ownership_adapter_closed']);
            let projection;
            try {
                projection = normalizeInventory(
                    value,
                    currentNow(),
                    maximumAgeMs,
                );
            } catch (error) {
                return invalidInventory([
                    error instanceof Error
                        ? error.message
                        : 'ownership_inventory_invalid',
                ]);
            }
            const handle = deepFreeze({
                issued: true,
                schemaVersion: INTRADAY_MONITOR_OWNERSHIP_ADAPTER_SCHEMA,
                evidenceId: projection.evidenceId,
                connectionGeneration: projection.connectionGeneration,
                countingDimension: projection.countingDimension,
                generatedAtEpochMs: projection.generatedAtEpochMs,
                validUntilEpochMs: projection.validUntilEpochMs,
                confirmedPhysicalUsage: projection.confirmedPhysicalUsage,
                retainedPhysicalUsage: projection.retainedPhysicalUsage,
                availableForMonitor: projection.availableForMonitor,
                pollingFallbackAllowed: false,
                subscriptionTransportAuthority: false,
                brokerWriteAuthority: false,
            });
            issuedInventories.set(handle, projection);
            return handle;
        },
        status() {
            return Object.freeze({
                schemaVersion: INTRADAY_MONITOR_OWNERSHIP_ADAPTER_SCHEMA,
                maximumAgeMs,
                closed,
                readOnly: true,
                pollingFallbackAllowed: false,
                subscriptionTransportAuthority: false,
                brokerWriteAuthority: false,
            });
        },
        close() {
            closed = true;
        },
    });
}

export function inspectIssuedIntradayMonitorOwnershipInventory(handle) {
    if (!handle || typeof handle !== 'object' || isProxy(handle)) return undefined;
    const projection = issuedInventories.get(handle);
    if (!projection) return undefined;
    return projection;
}
