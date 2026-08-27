import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';

export const SMART_ORDER_PROTECTED_ENTRY_PLAN_SCHEMA_VERSION =
    'smart-order-protected-entry-plan/2026-08-21.2';
export const SMART_ORDER_PROTECTED_ENTRY_INTENT_SCHEMA_VERSION =
    'smart-order-protected-entry-intent/2026-08-13.1';
export const SMART_ORDER_PROTECTED_ENTRY_RISK_POLICY_SCHEMA_VERSION =
    'smart-order-protected-entry-risk-policy/2026-08-13.1';
export const SMART_ORDER_FORMAL_PROTECTION_SCHEMA_VERSION =
    'smart-order-formal-protection/2026-08-13.2';

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function invalid(message) {
    throw new TypeError(`protected entry contract is invalid: ${message}`);
}

function structuredSnapshot(value, label, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object') return value;
    if (utilTypes.isProxy(value) || seen.has(value)) {
        invalid(`${label} must be an acyclic non-Proxy data structure`);
    }
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key !== 'string')) {
        invalid(`${label} must not contain symbol properties`);
    }
    if (Array.isArray(value)) {
        const expectedKeys = [
            ...Array.from({ length: value.length }, (_, index) => String(index)),
            'length',
        ];
        if (
            ownKeys.length !== expectedKeys.length ||
            ownKeys.some((key, index) => key !== expectedKeys[index])
        ) {
            invalid(`${label} must be a dense array without extra properties`);
        }
        const snapshot = Array.from({ length: value.length }, (_, index) => {
            const descriptor = descriptors[String(index)];
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
                invalid(`${label}[${index}] must be an own data property`);
            }
            return structuredSnapshot(
                descriptor.value,
                `${label}[${index}]`,
                seen,
            );
        });
        seen.delete(value);
        return Object.freeze(snapshot);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        invalid(`${label} must be a plain data object`);
    }
    const snapshot = Object.create(null);
    for (const key of ownKeys) {
        const descriptor = descriptors[key];
        if (
            !descriptor ||
            !Object.hasOwn(descriptor, 'value') ||
            descriptor.enumerable !== true
        ) {
            invalid(`${label}.${key} must be an enumerable own data property`);
        }
        snapshot[key] = structuredSnapshot(
            descriptor.value,
            `${label}.${key}`,
            seen,
        );
    }
    seen.delete(value);
    return Object.freeze(snapshot);
}

function exact(value, keys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        JSON.stringify(Object.keys(value).sort()) !==
            JSON.stringify([...keys].sort())
    ) {
        invalid(`${label} fields do not match the versioned schema`);
    }
    return value;
}

function token(value, label, maximum = 240) {
    if (
        typeof value !== 'string' ||
        value.length < 1 ||
        value.length > maximum ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        invalid(`${label} must be a bounded token`);
    }
    return value;
}

function digest(value, label) {
    if (typeof value !== 'string' || !SHA256.test(value)) {
        invalid(`${label} must be a SHA-256 digest`);
    }
    return value;
}

function positiveInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 1) {
        invalid(`${label} must be a positive safe integer`);
    }
    return value;
}

function canonicalDecimal(value, label, { positive = false } = {}) {
    if (
        typeof value !== 'string' ||
        value.length > 80 ||
        !DECIMAL.test(value)
    ) {
        invalid(`${label} must be a canonical decimal string`);
    }
    const [integer, fraction = ''] = value.split('.');
    if (
        (fraction.length > 0 && fraction.endsWith('0')) ||
        integer.length > 18 ||
        fraction.length > 18 ||
        (positive && value === '0')
    ) {
        invalid(`${label} is not canonical or is outside its bound`);
    }
    return value;
}

function nonNegativeInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        invalid(`${label} must be a non-negative safe integer`);
    }
    return value;
}

function priceMinorPerShare(value, label) {
    canonicalDecimal(value, label, { positive: true });
    const [integer, fraction = ''] = value.split('.');
    if (fraction.length > 2) {
        invalid(`${label} exceeds the two-decimal currency precision`);
    }
    const result = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0'));
    if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
        invalid(`${label} exceeds the safe integer range`);
    }
    return Number(result);
}

function safeExposureProduct(left, right, label) {
    const result = BigInt(left) * BigInt(right);
    if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
        invalid(`${label} exceeds the safe integer range`);
    }
    return Number(result);
}

function decimalRational(value, label) {
    canonicalDecimal(value, label, { positive: true });
    const [integer, fraction = ''] = value.split('.');
    return {
        numerator: BigInt(`${integer}${fraction}`),
        denominator: 10n ** BigInt(fraction.length),
    };
}

function greatestCommonDivisor(left, right) {
    left = left < 0n ? -left : left;
    right = right < 0n ? -right : right;
    while (right !== 0n) [left, right] = [right, left % right];
    return left;
}

function canonicalRational(numerator, denominator, label) {
    if (numerator < 1n || denominator < 1n) {
        invalid(`${label} must be a positive rational price`);
    }
    const divisor = greatestCommonDivisor(numerator, denominator);
    return Object.freeze({
        numeratorMinorUnits: (numerator / divisor).toString(),
        denominator: (denominator / divisor).toString(),
    });
}

function riskPolicy(value, expectedRevision) {
    const record = exact(
        value,
        [
            'buyFeeBps',
            'cashBufferMinorUnits',
            'minimumBuyFeeMinorUnits',
            'policyRevision',
            'schemaVersion',
        ],
        'plan.riskPolicy',
    );
    if (
        record.schemaVersion !==
            SMART_ORDER_PROTECTED_ENTRY_RISK_POLICY_SCHEMA_VERSION ||
        record.policyRevision !== expectedRevision
    ) {
        invalid('plan.riskPolicy version or revision is not current');
    }
    if (
        !Number.isSafeInteger(record.buyFeeBps) ||
        record.buyFeeBps < 0 ||
        record.buyFeeBps > 10_000
    ) {
        invalid('plan.riskPolicy.buyFeeBps must be 0-10000');
    }
    nonNegativeInteger(
        record.minimumBuyFeeMinorUnits,
        'plan.riskPolicy.minimumBuyFeeMinorUnits',
    );
    nonNegativeInteger(
        record.cashBufferMinorUnits,
        'plan.riskPolicy.cashBufferMinorUnits',
    );
    const serialized = canonicalJson(record);
    return Object.freeze({
        policy: record,
        policyHash: `sha256:${createHash('sha256')
            .update(serialized)
            .digest('hex')}`,
    });
}

function date(value, label) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        invalid(`${label} must use YYYY-MM-DD`);
    }
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day
    ) {
        invalid(`${label} must be a real Gregorian date`);
    }
    return value;
}

function distance(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        invalid(`${label} must be a distance definition`);
    }
    if (value.kind === 'absolute') {
        const record = exact(value, ['kind', 'value'], label);
        canonicalDecimal(record.value, `${label}.value`, { positive: true });
        return;
    }
    if (value.kind === 'pct_bps') {
        const record = exact(value, ['kind', 'pctBps'], label);
        if (
            !Number.isSafeInteger(record.pctBps) ||
            record.pctBps < 1 ||
            record.pctBps > 9_999
        ) {
            invalid(`${label}.pctBps must be 1-9999`);
        }
        return;
    }
    if (value.kind === 'fixed_atr') {
        const record = exact(
            value,
            ['atrSnapshotSha256', 'kind', 'multiplier'],
            label,
        );
        digest(record.atrSnapshotSha256, `${label}.atrSnapshotSha256`);
        canonicalDecimal(record.multiplier, `${label}.multiplier`, {
            positive: true,
        });
        return;
    }
    invalid(`${label}.kind is unsupported`);
}

function execution(value, label) {
    const record = exact(
        value,
        ['limitPrice', 'priceType', 'timeInForce'],
        label,
    );
    if (!['LMT', 'MKT'].includes(record.priceType)) {
        invalid(`${label}.priceType is unsupported`);
    }
    if (!['ROD', 'IOC'].includes(record.timeInForce)) {
        invalid(`${label}.timeInForce is unsupported`);
    }
    if (
        !(
            (record.priceType === 'LMT' &&
                ['ROD', 'IOC'].includes(record.timeInForce)) ||
            (record.priceType === 'MKT' && record.timeInForce === 'IOC')
        )
    ) {
        invalid(`${label} order-class combination is unsupported`);
    }
    if (record.priceType === 'LMT') {
        canonicalDecimal(record.limitPrice, `${label}.limitPrice`, {
            positive: true,
        });
    } else if (record.limitPrice !== null) {
        invalid(`${label}.limitPrice must be null for MKT`);
    }
}

function leg(value, index) {
    const label = `protection.legs[${index}]`;
    const record = exact(
        value,
        ['comparator', 'distance', 'execution', 'legId', 'type'],
        label,
    );
    token(record.legId, `${label}.legId`, 128);
    if (!['stop', 'take', 'trailing_activation', 'trailing_retracement', 'fixed_stop'].includes(record.type)) {
        invalid(`${label}.type is unsupported`);
    }
    if (!['lte', 'gte'].includes(record.comparator)) {
        invalid(`${label}.comparator is unsupported`);
    }
    if (
        (['stop', 'trailing_retracement', 'fixed_stop'].includes(record.type) &&
            record.comparator !== 'lte') ||
        (['take', 'trailing_activation'].includes(record.type) &&
            record.comparator !== 'gte')
    ) {
        invalid(`${label}.comparator conflicts with the long-position leg`);
    }
    distance(record.distance, `${label}.distance`);
    execution(record.execution, `${label}.execution`);
}

function atrSnapshot(value) {
    if (value === null) return;
    const record = exact(
        value,
        [
            'algorithmVersion',
            'asOfTradingDate',
            'completenessSha256',
            'period',
            'sourceSha256',
            'timeframe',
            'value',
        ],
        'fixedAtrSnapshot',
    );
    if (record.timeframe !== '1d' || record.period !== 14) {
        invalid('fixedAtrSnapshot must be Wilder ATR(14) on completed daily bars');
    }
    token(record.algorithmVersion, 'fixedAtrSnapshot.algorithmVersion');
    date(record.asOfTradingDate, 'fixedAtrSnapshot.asOfTradingDate');
    digest(record.completenessSha256, 'fixedAtrSnapshot.completenessSha256');
    digest(record.sourceSha256, 'fixedAtrSnapshot.sourceSha256');
    canonicalDecimal(record.value, 'fixedAtrSnapshot.value', { positive: true });
}

function entryOrder(value) {
    const record = exact(
        value,
        [
            'baseShares',
            'commonLots',
            'contractUnit',
            'limitPrice',
            'orderCond',
            'orderLot',
            'priceType',
            'side',
            'timeInForce',
        ],
        'entryOrder',
    );
    if (
        record.side !== 'Buy' ||
        record.orderCond !== 'Cash' ||
        record.orderLot !== 'Common'
    ) {
        invalid('entryOrder must be first-phase Cash Common Buy');
    }
    const baseShares = positiveInteger(record.baseShares, 'entryOrder.baseShares');
    const commonLots = positiveInteger(record.commonLots, 'entryOrder.commonLots');
    const contractUnit = positiveInteger(record.contractUnit, 'entryOrder.contractUnit');
    if (baseShares !== commonLots * contractUnit) {
        invalid('entryOrder quantity tuple is inconsistent');
    }
    execution(
        {
            limitPrice: record.limitPrice,
            priceType: record.priceType,
            timeInForce: record.timeInForce,
        },
        'entryOrder',
    );
    return record;
}

function contractPricePolicy(value) {
    const record = exact(
        value,
        ['categoryCode', 'limitDownMinorUnits', 'limitUpMinorUnits'],
        'contractPricePolicy',
    );
    if (
        (record.categoryCode !== '00' &&
            !/^(?:0[1-9]|[1-9]\d)$/.test(record.categoryCode)) ||
        !Number.isSafeInteger(record.limitDownMinorUnits) ||
        record.limitDownMinorUnits <= 0 ||
        !Number.isSafeInteger(record.limitUpMinorUnits) ||
        record.limitUpMinorUnits < record.limitDownMinorUnits
    ) {
        invalid('contractPricePolicy is invalid');
    }
    return record;
}

export function canonicalProtectedEntryPlan(candidate) {
    candidate = structuredSnapshot(candidate, 'plan');
    const plan = exact(
        candidate,
        [
            'accountBrokerRef',
            'accountIdRef',
            'basis',
            'confirmationSnapshotHash',
            'contractKey',
            'contractPricePolicy',
            'entryOrder',
            'fixedAtrSnapshot',
            'modeRevision',
            'protection',
            'riskPolicy',
            'riskRevision',
            'schemaVersion',
        ],
        'plan',
    );
    if (plan.schemaVersion !== SMART_ORDER_PROTECTED_ENTRY_PLAN_SCHEMA_VERSION) {
        invalid('plan.schemaVersion is unsupported');
    }
    token(plan.accountBrokerRef, 'plan.accountBrokerRef');
    token(plan.accountIdRef, 'plan.accountIdRef');
    token(plan.contractKey, 'plan.contractKey');
    contractPricePolicy(plan.contractPricePolicy);
    digest(plan.confirmationSnapshotHash, 'plan.confirmationSnapshotHash');
    token(plan.modeRevision, 'plan.modeRevision');
    token(plan.riskRevision, 'plan.riskRevision');
    const order = entryOrder(plan.entryOrder);
    if (order.priceType !== 'LMT') {
        invalid(
            'protected entry MKT requires a future verifier-issued worst-price authority',
        );
    }
    const verifiedRiskPolicy = riskPolicy(
        plan.riskPolicy,
        plan.riskRevision,
    );
    const worstPriceMinorPerShare = priceMinorPerShare(
        order.limitPrice,
        'plan.entryOrder.limitPrice',
    );
    const notionalMinorUnits = safeExposureProduct(
        order.baseShares,
        worstPriceMinorPerShare,
        'protected entry notional',
    );
    const proportionalFee = Number(
        (BigInt(notionalMinorUnits) *
            BigInt(verifiedRiskPolicy.policy.buyFeeBps) +
            9_999n) /
            10_000n,
    );
    const feeMinorUnits = Math.max(
        proportionalFee,
        verifiedRiskPolicy.policy.minimumBuyFeeMinorUnits,
    );
    const cashMinorUnitsBigInt =
        BigInt(notionalMinorUnits) +
        BigInt(feeMinorUnits) +
        BigInt(verifiedRiskPolicy.policy.cashBufferMinorUnits);
    if (cashMinorUnitsBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
        invalid('protected entry cash exposure exceeds the safe integer range');
    }
    const basis = exact(
        plan.basis,
        ['previewPrice', 'source'],
        'plan.basis',
    );
    if (basis.source !== 'entry_weighted_average_fill') {
        invalid('plan.basis.source must await broker weighted-average fill');
    }
    canonicalDecimal(basis.previewPrice, 'plan.basis.previewPrice', {
        positive: true,
    });
    atrSnapshot(plan.fixedAtrSnapshot);
    const protection = exact(plan.protection, ['family', 'legs'], 'plan.protection');
    if (!['fixed', 'trailing'].includes(protection.family)) {
        invalid('plan.protection.family is unsupported');
    }
    if (
        !Array.isArray(protection.legs) ||
        protection.legs.length < 1 ||
        protection.legs.length > 3
    ) {
        invalid('plan.protection.legs must contain 1-3 legs');
    }
    const legIds = new Set();
    for (const [index, item] of protection.legs.entries()) {
        leg(item, index);
        if (legIds.has(item.legId)) invalid('protection leg IDs must be unique');
        legIds.add(item.legId);
    }
    const types = new Set(protection.legs.map((item) => item.type));
    if (
        (protection.family === 'fixed' &&
            [...types].some((type) => !['stop', 'take'].includes(type))) ||
        (protection.family === 'trailing' &&
            (!types.has('trailing_activation') ||
                !types.has('trailing_retracement') ||
                [...types].some((type) =>
                    !['trailing_activation', 'trailing_retracement', 'fixed_stop'].includes(type),
                )))
    ) {
        invalid('protection leg set conflicts with its family');
    }
    const serialized = canonicalJson(plan, { maximumBytes: 64 * 1024 });
    const canonical = JSON.parse(serialized);
    const planSha256 = `sha256:${createHash('sha256')
        .update(serialized)
        .digest('hex')}`;
    return Object.freeze({
        plan: Object.freeze(canonical),
        planJson: serialized,
        planSha256,
        baseShares: order.baseShares,
        riskPolicyHash: verifiedRiskPolicy.policyHash,
        worstCaseExposure: Object.freeze({
            quantityShares: order.baseShares,
            notionalMinorUnits,
            cashMinorUnits: Number(cashMinorUnitsBigInt),
            positionShares: order.baseShares,
            orderCount: 1,
        }),
    });
}

export function deriveProtectedEntryWorstCaseExposure(
    candidate,
    quantityShares,
) {
    const canonical = canonicalProtectedEntryPlan(candidate);
    const shares = nonNegativeInteger(
        quantityShares,
        'remaining protected entry quantityShares',
    );
    if (shares > canonical.baseShares) {
        invalid('remaining protected entry quantity exceeds the confirmed order');
    }
    if (shares === 0) {
        return Object.freeze({
            quantityShares: 0,
            notionalMinorUnits: 0,
            cashMinorUnits: 0,
            positionShares: 0,
            orderCount: 0,
        });
    }
    const order = canonical.plan.entryOrder;
    const policy = canonical.plan.riskPolicy;
    const worstPriceMinorPerShare = priceMinorPerShare(
        order.limitPrice,
        'plan.entryOrder.limitPrice',
    );
    const notionalMinorUnits = safeExposureProduct(
        shares,
        worstPriceMinorPerShare,
        'remaining protected entry notional',
    );
    const proportionalFee = Number(
        (BigInt(notionalMinorUnits) * BigInt(policy.buyFeeBps) + 9_999n) /
            10_000n,
    );
    const feeMinorUnits = Math.max(
        proportionalFee,
        policy.minimumBuyFeeMinorUnits,
    );
    const cashMinorUnits =
        BigInt(notionalMinorUnits) +
        BigInt(feeMinorUnits) +
        BigInt(policy.cashBufferMinorUnits);
    if (cashMinorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
        invalid('remaining protected entry cash exposure exceeds safe integer range');
    }
    return Object.freeze({
        quantityShares: shares,
        notionalMinorUnits,
        cashMinorUnits: Number(cashMinorUnits),
        positionShares: shares,
        orderCount: 1,
    });
}

export function deriveProtectedEntryFormalProtection(
    candidate,
    fillNotionalMinorUnits,
    cumulativeFilledShares,
) {
    const canonical = canonicalProtectedEntryPlan(candidate);
    const notional = nonNegativeInteger(
        fillNotionalMinorUnits,
        'formal protection fillNotionalMinorUnits',
    );
    const shares = positiveInteger(
        cumulativeFilledShares,
        'formal protection cumulativeFilledShares',
    );
    if (shares > canonical.baseShares || notional === 0) {
        invalid('formal protection fill basis is outside the confirmed order');
    }
    const basisNumerator = BigInt(notional);
    const basisDenominator = BigInt(shares);
    const fixedAtrSnapshotSha256 =
        canonical.plan.fixedAtrSnapshot === null
            ? null
            : `sha256:${createHash('sha256')
                  .update(canonicalJson(canonical.plan.fixedAtrSnapshot))
                  .digest('hex')}`;
    const legs = canonical.plan.protection.legs.map((item) => {
        const distanceProjection = Object.freeze({ ...item.distance });
        const executionProjection = Object.freeze({ ...item.execution });
        if (
            item.distance.kind === 'fixed_atr' &&
            (fixedAtrSnapshotSha256 === null ||
                item.distance.atrSnapshotSha256 !== fixedAtrSnapshotSha256)
        ) {
            invalid(
                `formal protection ${item.legId} ATR snapshot is not fixed to the confirmed plan`,
            );
        }
        if (item.type === 'trailing_retracement') {
            return Object.freeze({
                legId: item.legId,
                type: item.type,
                comparator: item.comparator,
                triggerState: 'pending_saved_high',
                triggerBasis: 'durable_saved_high',
                triggerPrice: null,
                distance: distanceProjection,
                execution: executionProjection,
            });
        }
        let trigger;
        if (item.distance.kind === 'pct_bps') {
            const factor = BigInt(
                item.comparator === 'lte'
                    ? 10_000 - item.distance.pctBps
                    : 10_000 + item.distance.pctBps,
            );
            trigger = canonicalRational(
                basisNumerator * factor,
                basisDenominator * 10_000n,
                `formal protection ${item.legId}`,
            );
        } else {
            let offset = decimalRational(
                item.distance.kind === 'absolute'
                    ? item.distance.value
                    : canonical.plan.fixedAtrSnapshot?.value,
                `formal protection ${item.legId} distance`,
            );
            if (item.distance.kind === 'fixed_atr') {
                const multiplier = decimalRational(
                    item.distance.multiplier,
                    `formal protection ${item.legId} multiplier`,
                );
                offset = {
                    numerator: offset.numerator * multiplier.numerator,
                    denominator: offset.denominator * multiplier.denominator,
                };
            }
            const offsetMinorNumerator = offset.numerator * 100n;
            const basisScaled = basisNumerator * offset.denominator;
            const offsetScaled = offsetMinorNumerator * basisDenominator;
            trigger = canonicalRational(
                item.comparator === 'lte'
                    ? basisScaled - offsetScaled
                    : basisScaled + offsetScaled,
                basisDenominator * offset.denominator,
                `formal protection ${item.legId}`,
            );
        }
        return Object.freeze({
            legId: item.legId,
            type: item.type,
            comparator: item.comparator,
            triggerState: 'formal',
            triggerBasis: 'weighted_average_fill',
            triggerPrice: trigger,
            distance: distanceProjection,
            execution: executionProjection,
        });
    });
    return Object.freeze({
        schemaVersion: SMART_ORDER_FORMAL_PROTECTION_SCHEMA_VERSION,
        protectionPlanSha256: canonical.planSha256,
        weightedAverageBasis: canonicalRational(
            basisNumerator,
            basisDenominator,
            'formal protection weighted-average basis',
        ),
        cumulativeFilledShares: shares,
        fixedAtrSnapshotSha256,
        legs: Object.freeze(legs),
    });
}

export function snapshotProtectedEntryAdmissionInput(candidate) {
    return structuredSnapshot(candidate, 'protected entry admission');
}

export function canonicalProtectedEntryIntentPayload(candidate) {
    candidate = structuredSnapshot(candidate, 'intent payload');
    const payload = exact(
        candidate,
        [
            'confirmationSnapshotHash',
            'entryOrder',
            'protectionPlan',
            'protectionPlanSha256',
            'schemaVersion',
        ],
        'intent payload',
    );
    if (
        payload.schemaVersion !==
        SMART_ORDER_PROTECTED_ENTRY_INTENT_SCHEMA_VERSION
    ) {
        invalid('intent payload schemaVersion is unsupported');
    }
    digest(payload.confirmationSnapshotHash, 'intent.confirmationSnapshotHash');
    digest(payload.protectionPlanSha256, 'intent.protectionPlanSha256');
    const payloadEntryOrder = entryOrder(payload.entryOrder);
    const protectionPlan = canonicalProtectedEntryPlan(payload.protectionPlan);
    if (
        payload.confirmationSnapshotHash !==
        protectionPlan.plan.confirmationSnapshotHash
    ) {
        invalid(
            'intent.confirmationSnapshotHash does not match the canonical plan',
        );
    }
    if (
        canonicalJson(payloadEntryOrder) !==
        canonicalJson(protectionPlan.plan.entryOrder)
    ) {
        invalid('intent.entryOrder does not match the canonical plan');
    }
    if (protectionPlan.planSha256 !== payload.protectionPlanSha256) {
        invalid('intent protectionPlanSha256 does not match the canonical plan');
    }
    const serialized = canonicalJson(payload, { maximumBytes: 64 * 1024 });
    return Object.freeze({
        payload: Object.freeze(JSON.parse(serialized)),
        payloadJson: serialized,
        payloadSha256: `sha256:${createHash('sha256')
            .update(serialized)
            .digest('hex')}`,
    });
}
