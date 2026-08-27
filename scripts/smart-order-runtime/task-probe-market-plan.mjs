import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';

export const SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION =
    'smart-order-task-probe-market-plan/2026-08-25.1';
export const SMART_ORDER_TASK_PROBE_MAX_PLAN_LIFETIME_MS = 300_000;

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASKS = new Set(['0.3b', '0.3c', '0.4', '0.6', '13.3']);
const PURPOSES = new Set([
    'working_non_marketable',
    'marketable_fill',
    'ioc_zero_fill',
    'market_order',
    'cancel_same_run_target',
]);
const MAX_TICK_SEARCH_MINOR_UNITS = 20_000;
const issuedPlans = new WeakSet();

function exact(value, keys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        throw new TypeError(`${label} must be an exact non-Proxy object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    if (
        actual.some((key) => typeof key !== 'string') ||
        actual.length !== keys.length ||
        ![...actual].sort().every((key, index) => key === [...keys].sort()[index])
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

function integer(value, label, minimum = 0) {
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new TypeError(`${label} must be a safe integer >= ${minimum}`);
    }
    return value;
}

function digest(value, label) {
    if (typeof value !== 'string' || !DIGEST.test(value)) {
        throw new TypeError(`${label} must be a SHA-256 digest`);
    }
    return value;
}

function date(value, label) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new TypeError(`${label} must be a trade date`);
    }
    return value;
}

function stockTickMinorUnits(categoryCode, priceMinorUnits) {
    if (categoryCode === '00') return priceMinorUnits < 5_000 ? 1 : 5;
    if (!/^(?:0[1-9]|[1-9]\d)$/.test(categoryCode)) return null;
    if (priceMinorUnits < 1_000) return 1;
    if (priceMinorUnits < 5_000) return 5;
    if (priceMinorUnits < 10_000) return 10;
    if (priceMinorUnits < 50_000) return 50;
    if (priceMinorUnits < 100_000) return 100;
    return 500;
}

function tickValid(categoryCode, value) {
    const tick = stockTickMinorUnits(categoryCode, value);
    return tick !== null && value > 0 && value % tick === 0;
}

function seekTick({ categoryCode, from, direction, ordinal, lower, upper }) {
    let found = 0;
    for (let offset = 0; offset <= MAX_TICK_SEARCH_MINOR_UNITS; offset += 1) {
        const candidate = from + direction * offset;
        if (candidate < lower || candidate > upper) continue;
        if (!tickValid(categoryCode, candidate)) continue;
        found += 1;
        if (found === ordinal) return candidate;
    }
    throw new Error('probe market plan has no bounded legal tick candidate');
}

function minorUnitsToDecimal(value) {
    const integerPart = Math.floor(value / 100);
    const fraction = String(value % 100).padStart(2, '0').replace(/0+$/, '');
    return fraction.length > 0 ? `${integerPart}.${fraction}` : String(integerPart);
}

function canonicalTarget(value, accountScopeSha256, tradeDate, runId) {
    if (value === null) return null;
    const target = exact(
        value,
        [
            'accountScopeSha256',
            'originRunId',
            'priceMinorUnits',
            'revision',
            'targetIdSha256',
            'tradeDate',
        ],
        'probe target',
    );
    if (
        !UUID.test(target.originRunId ?? '') ||
        target.originRunId.toLowerCase() !== runId ||
        target.accountScopeSha256 !== accountScopeSha256 ||
        target.tradeDate !== tradeDate ||
        !Number.isSafeInteger(target.revision) ||
        target.revision < 0 ||
        !Number.isSafeInteger(target.priceMinorUnits) ||
        target.priceMinorUnits < 1
    ) {
        throw new TypeError('probe target is outside the fixed account/run scope');
    }
    return Object.freeze({
        originRunId: target.originRunId.toLowerCase(),
        targetIdSha256: digest(target.targetIdSha256, 'targetIdSha256'),
        accountScopeSha256,
        tradeDate,
        priceMinorUnits: target.priceMinorUnits,
        revision: target.revision,
    });
}

function priceFor(input, contract, quote, target) {
    if (input.priceType === 'MKT') {
        if (
            input.purpose !== 'market_order' ||
            input.operation !== 'place' ||
            input.timeInForce !== 'IOC' ||
            input.priceOrdinal !== 0
        ) {
            throw new TypeError('MKT probe plan must be an exact place MKT+IOC');
        }
        return null;
    }
    if (input.priceType !== 'LMT' || !['ROD', 'IOC'].includes(input.timeInForce)) {
        throw new TypeError('probe execution policy is unsupported');
    }
    const ordinal = integer(input.priceOrdinal, 'priceOrdinal', 1);
    if (ordinal > 10) throw new TypeError('priceOrdinal exceeds the bounded plan');
    const bounds = {
        categoryCode: contract.categoryCode,
        lower: contract.limitDownMinorUnits,
        upper: contract.limitUpMinorUnits,
        ordinal,
    };
    if (input.purpose === 'working_non_marketable' || input.purpose === 'ioc_zero_fill') {
        const candidate = input.side === 'Buy'
            ? seekTick({ ...bounds, from: quote.bestBidMinorUnits - 1, direction: -1 })
            : seekTick({ ...bounds, from: quote.bestAskMinorUnits + 1, direction: 1 });
        if (
            input.operation !== 'update_price' ||
            candidate !== target?.priceMinorUnits
        ) {
            return candidate;
        }
        return input.side === 'Buy'
            ? seekTick({
                  ...bounds,
                  from: quote.bestBidMinorUnits - 1,
                  direction: -1,
                  ordinal: ordinal + 1,
              })
            : seekTick({
                  ...bounds,
                  from: quote.bestAskMinorUnits + 1,
                  direction: 1,
                  ordinal: ordinal + 1,
              });
    }
    if (input.purpose === 'marketable_fill') {
        return input.side === 'Buy'
            ? seekTick({ ...bounds, from: quote.bestAskMinorUnits, direction: 1 })
            : seekTick({ ...bounds, from: quote.bestBidMinorUnits, direction: -1 });
    }
    throw new TypeError('LMT probe purpose is invalid');
}

export function buildSmartOrderTaskProbeMarketPlan(value) {
    const input = exact(
        value,
        [
            'accountScopeSha256',
            'apiGenerationSha256',
            'contract',
            'nowEpochMs',
            'operation',
            'positionsSha256',
            'priceOrdinal',
            'priceType',
            'purpose',
            'quantityCommonLots',
            'quote',
            'runId',
            'schemaVersion',
            'side',
            'sourceFingerprintSha256',
            'target',
            'taskId',
            'timeInForce',
            'tradeDate',
            'workingOrdersSha256',
        ],
        'task probe market plan input',
    );
    if (
        input.schemaVersion !== SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION ||
        !TASKS.has(input.taskId) ||
        !PURPOSES.has(input.purpose) ||
        !['place', 'update_price', 'cancel'].includes(input.operation) ||
        !['Buy', 'Sell'].includes(input.side) ||
        input.quantityCommonLots !== 1
    ) {
        throw new TypeError('task probe market plan scope is invalid');
    }
    const accountScopeSha256 = digest(
        input.accountScopeSha256,
        'accountScopeSha256',
    );
    const tradeDate = date(input.tradeDate, 'tradeDate');
    if (!UUID.test(input.runId ?? '')) {
        throw new TypeError('runId must be a UUID');
    }
    const runId = input.runId.toLowerCase();
    const nowEpochMs = integer(input.nowEpochMs, 'nowEpochMs');
    const contract = exact(
        input.contract,
        [
            'categoryCode',
            'contractKey',
            'contractUnit',
            'evidenceSha256',
            'limitDownMinorUnits',
            'limitUpMinorUnits',
            'observedAtEpochMs',
            'referenceMinorUnits',
            'updateDate',
            'validUntilEpochMs',
        ],
        'probe contract evidence',
    );
    const quote = exact(
        input.quote,
        [
            'bestAskMinorUnits',
            'bestBidMinorUnits',
            'evidenceSha256',
            'exchangeTimeEpochMs',
            'observedAtEpochMs',
            'tradeDate',
            'validUntilEpochMs',
        ],
        'probe quote evidence',
    );
    for (const [label, observed, validUntil] of [
        ['contract', contract.observedAtEpochMs, contract.validUntilEpochMs],
        ['quote', quote.observedAtEpochMs, quote.validUntilEpochMs],
    ]) {
        integer(observed, `${label}.observedAtEpochMs`);
        integer(validUntil, `${label}.validUntilEpochMs`);
        if (
            observed > nowEpochMs ||
            validUntil <= nowEpochMs ||
            validUntil <= observed ||
            validUntil - observed >
                SMART_ORDER_TASK_PROBE_MAX_PLAN_LIFETIME_MS
        ) {
            throw new Error(`${label} evidence is stale or overlong`);
        }
    }
    if (
        contract.updateDate !== tradeDate ||
        quote.tradeDate !== tradeDate ||
        !/^(?:TSE|OTC):[A-Z0-9]+:STK:Common$/.test(contract.contractKey ?? '') ||
        !Number.isSafeInteger(contract.contractUnit) ||
        contract.contractUnit < 1 ||
        !Number.isSafeInteger(contract.referenceMinorUnits) ||
        !Number.isSafeInteger(contract.limitDownMinorUnits) ||
        !Number.isSafeInteger(contract.limitUpMinorUnits) ||
        contract.limitDownMinorUnits > contract.referenceMinorUnits ||
        contract.limitUpMinorUnits < contract.referenceMinorUnits ||
        !Number.isSafeInteger(quote.bestBidMinorUnits) ||
        !Number.isSafeInteger(quote.bestAskMinorUnits) ||
        quote.bestBidMinorUnits < contract.limitDownMinorUnits ||
        quote.bestAskMinorUnits > contract.limitUpMinorUnits ||
        quote.bestBidMinorUnits >= quote.bestAskMinorUnits ||
        !tickValid(contract.categoryCode, quote.bestBidMinorUnits) ||
        !tickValid(contract.categoryCode, quote.bestAskMinorUnits) ||
        !Number.isSafeInteger(quote.exchangeTimeEpochMs) ||
        quote.exchangeTimeEpochMs > quote.observedAtEpochMs ||
        quote.observedAtEpochMs - quote.exchangeTimeEpochMs >
            SMART_ORDER_TASK_PROBE_MAX_PLAN_LIFETIME_MS
    ) {
        throw new Error('current contract, tick, BBO or trusted time is invalid');
    }
    const target = canonicalTarget(
        input.target,
        accountScopeSha256,
        tradeDate,
        runId,
    );
    if (
        (input.operation === 'place' && target !== null) ||
        (input.operation !== 'place' && target === null) ||
        (input.operation === 'update_price' && input.priceOrdinal !== 2) ||
        (input.operation === 'cancel' &&
            (input.purpose !== 'cancel_same_run_target' ||
                input.priceType !== null ||
                input.timeInForce !== null ||
                input.priceOrdinal !== 0)) ||
        (input.operation === 'update_price' && input.taskId !== '0.3b')
    ) {
        throw new TypeError('probe operation and target scope are inconsistent');
    }
    const priceMinorUnits =
        input.operation === 'cancel'
            ? null
            : priceFor(input, contract, quote, target);
    if (
        input.operation === 'update_price' &&
        priceMinorUnits === target.priceMinorUnits
    ) {
        throw new Error('probe update price must differ from the current target price');
    }
    const plan = Object.freeze({
        schemaVersion: SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
        taskId: input.taskId,
        runId,
        operation: input.operation,
        purpose: input.purpose,
        contractKey: contract.contractKey,
        side: input.side,
        priceType: input.priceType,
        timeInForce: input.timeInForce,
        priceMinorUnits,
        price: priceMinorUnits === null ? null : minorUnitsToDecimal(priceMinorUnits),
        quantityCommonLots: 1,
        accountScopeSha256,
        tradeDate,
        target,
        sourceFingerprintSha256: digest(
            input.sourceFingerprintSha256,
            'sourceFingerprintSha256',
        ),
        apiGenerationSha256: digest(
            input.apiGenerationSha256,
            'apiGenerationSha256',
        ),
        contractEvidenceSha256: digest(
            contract.evidenceSha256,
            'contract.evidenceSha256',
        ),
        quoteEvidenceSha256: digest(
            quote.evidenceSha256,
            'quote.evidenceSha256',
        ),
        positionsSha256: digest(input.positionsSha256, 'positionsSha256'),
        workingOrdersSha256: digest(
            input.workingOrdersSha256,
            'workingOrdersSha256',
        ),
        observedAtEpochMs: Math.max(
            contract.observedAtEpochMs,
            quote.observedAtEpochMs,
        ),
        validUntilEpochMs: Math.min(
            contract.validUntilEpochMs,
            quote.validUntilEpochMs,
        ),
        automaticRetryAllowed: false,
        blindCleanupAllowed: false,
        brokerWriteAuthority: false,
    });
    issuedPlans.add(plan);
    return Object.freeze({
        plan,
        planSha256: `sha256:${createHash('sha256')
            .update(canonicalJson(plan))
            .digest('hex')}`,
    });
}

export function isIssuedSmartOrderTaskProbeMarketPlan(plan) {
    return !!plan && typeof plan === 'object' && issuedPlans.has(plan);
}

export function assertSmartOrderTaskProbePinnedPriceCurrent({
    plan,
    contract,
    quote,
}) {
    if (!isIssuedSmartOrderTaskProbeMarketPlan(plan)) {
        throw new TypeError('pinned probe market plan was not issued here');
    }
    if (plan.operation === 'cancel') return true;
    const marketOrder = plan.priceType === 'MKT';
    if (
        !contract ||
        typeof contract !== 'object' ||
        Array.isArray(contract) ||
        utilTypes.isProxy(contract) ||
        !quote ||
        typeof quote !== 'object' ||
        Array.isArray(quote) ||
        utilTypes.isProxy(quote) ||
        contract.contractKey !== plan.contractKey ||
        contract.updateDate !== plan.tradeDate ||
        quote.tradeDate !== plan.tradeDate ||
        (!marketOrder && !Number.isSafeInteger(plan.priceMinorUnits)) ||
        !Number.isSafeInteger(contract.limitDownMinorUnits) ||
        !Number.isSafeInteger(contract.limitUpMinorUnits) ||
        (!marketOrder && plan.priceMinorUnits < contract.limitDownMinorUnits) ||
        (!marketOrder && plan.priceMinorUnits > contract.limitUpMinorUnits) ||
        (!marketOrder && !tickValid(contract.categoryCode, plan.priceMinorUnits)) ||
        !Number.isSafeInteger(quote.bestBidMinorUnits) ||
        !Number.isSafeInteger(quote.bestAskMinorUnits) ||
        quote.bestBidMinorUnits >= quote.bestAskMinorUnits
    ) {
        throw new Error('pinned probe price is invalid against the current market');
    }
    if (marketOrder) {
        if (
            plan.operation !== 'place' ||
            plan.purpose !== 'market_order' ||
            plan.timeInForce !== 'IOC' ||
            plan.priceMinorUnits !== null ||
            plan.price !== null
        ) {
            throw new Error('pinned MKT probe is not an exact price-less IOC');
        }
        return true;
    }
    const nonMarketable =
        plan.purpose === 'working_non_marketable' ||
        plan.purpose === 'ioc_zero_fill';
    const marketable = plan.purpose === 'marketable_fill';
    if (
        (nonMarketable &&
            ((plan.side === 'Buy' && plan.priceMinorUnits >= quote.bestAskMinorUnits) ||
                (plan.side === 'Sell' && plan.priceMinorUnits <= quote.bestBidMinorUnits))) ||
        (marketable &&
            ((plan.side === 'Buy' && plan.priceMinorUnits < quote.bestAskMinorUnits) ||
                (plan.side === 'Sell' && plan.priceMinorUnits > quote.bestBidMinorUnits))) ||
        (!nonMarketable && !marketable)
    ) {
        throw new Error('pinned probe price purpose drifted against the current BBO');
    }
    if (
        plan.operation === 'update_price' &&
        plan.target?.priceMinorUnits === plan.priceMinorUnits
    ) {
        throw new Error('pinned probe update price no longer changes the target');
    }
    return true;
}
