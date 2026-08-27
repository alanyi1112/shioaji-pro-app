import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';

export const SMART_ORDER_EXISTING_POSITION_PROTECTION_PLAN_SCHEMA_VERSION =
    'smart-order-existing-position-protection-plan/2026-08-21.1';
export const SMART_ORDER_EXISTING_POSITION_FORMAL_PROTECTION_SCHEMA_VERSION =
    'smart-order-existing-position-formal-protection/2026-08-21.1';

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function invalid(message) {
    throw new TypeError(`existing-position protection contract is invalid: ${message}`);
}

function snapshot(value, label, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object') return value;
    if (utilTypes.isProxy(value) || seen.has(value)) {
        invalid(`${label} must be an acyclic non-Proxy data structure`);
    }
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) {
        invalid(`${label} must not contain symbol properties`);
    }
    if (Array.isArray(value)) {
        const expected = [
            ...Array.from({ length: value.length }, (_, index) => String(index)),
            'length',
        ];
        if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
            invalid(`${label} must be a dense array without extra properties`);
        }
        const result = Array.from({ length: value.length }, (_, index) => {
            const descriptor = descriptors[String(index)];
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
                invalid(`${label}[${index}] must be an own data property`);
            }
            return snapshot(descriptor.value, `${label}[${index}]`, seen);
        });
        seen.delete(value);
        return Object.freeze(result);
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        invalid(`${label} must be a plain data object`);
    }
    const result = Object.create(null);
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
            invalid(`${label}.${key} must be an enumerable own data property`);
        }
        result[key] = snapshot(descriptor.value, `${label}.${key}`, seen);
    }
    seen.delete(value);
    return Object.freeze(result);
}

function exact(value, keys, label) {
    if (
        !value || typeof value !== 'object' || Array.isArray(value) ||
        JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())
    ) invalid(`${label} fields do not match the versioned schema`);
    return value;
}

function token(value, label, maximum = 240) {
    if (
        typeof value !== 'string' || value.length < 1 || value.length > maximum ||
        value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)
    ) invalid(`${label} must be a bounded token`);
    return value;
}

function digest(value, label) {
    if (typeof value !== 'string' || !SHA256.test(value)) invalid(`${label} must be a SHA-256 digest`);
    return value;
}

function positiveInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 1) invalid(`${label} must be a positive safe integer`);
    return value;
}

function decimal(value, label) {
    if (
        typeof value !== 'string' || !DECIMAL.test(value) || value === '0' ||
        value.length > 80 || (value.includes('.') && value.endsWith('0'))
    ) invalid(`${label} must be a positive canonical decimal`);
    return value;
}

function rational(value, label) {
    decimal(value, label);
    const [whole, fraction = ''] = value.split('.');
    return Object.freeze({
        numerator: BigInt(`${whole}${fraction}`) * 100n,
        denominator: 10n ** BigInt(fraction.length),
    });
}

function gcd(left, right) {
    left = left < 0n ? -left : left;
    right = right < 0n ? -right : right;
    while (right !== 0n) [left, right] = [right, left % right];
    return left;
}

function canonicalRational(numerator, denominator, label) {
    if (denominator <= 0n || numerator <= 0n) invalid(`${label} must be positive`);
    const divisor = gcd(numerator, denominator);
    return Object.freeze({
        numeratorMinorUnits: (numerator / divisor).toString(),
        denominator: (denominator / divisor).toString(),
    });
}

function distance(value, label) {
    if (value?.kind === 'absolute') {
        const record = exact(value, ['kind', 'value'], label);
        decimal(record.value, `${label}.value`);
        return record;
    }
    if (value?.kind === 'pct_bps') {
        const record = exact(value, ['kind', 'pctBps'], label);
        if (!Number.isSafeInteger(record.pctBps) || record.pctBps < 1 || record.pctBps > 9_999) {
            invalid(`${label}.pctBps must be 1-9999`);
        }
        return record;
    }
    if (value?.kind === 'fixed_atr') {
        const record = exact(value, ['atr', 'atrSnapshotRevision', 'kind', 'multiplier'], label);
        decimal(record.atr, `${label}.atr`);
        decimal(record.multiplier, `${label}.multiplier`);
        token(record.atrSnapshotRevision, `${label}.atrSnapshotRevision`);
        return record;
    }
    invalid(`${label}.kind is unsupported`);
}

function execution(value, label) {
    const record = exact(value, ['limitPrice', 'priceType', 'timeInForce'], label);
    if (!(
        (record.priceType === 'LMT' && ['ROD', 'IOC'].includes(record.timeInForce)) ||
        (record.priceType === 'MKT' && record.timeInForce === 'IOC')
    )) invalid(`${label} order-class combination is unsupported`);
    if (record.priceType === 'LMT') decimal(record.limitPrice, `${label}.limitPrice`);
    else if (record.limitPrice !== null) invalid(`${label}.limitPrice must be null for MKT`);
    return record;
}

export function canonicalExistingPositionProtectionPlan(candidate) {
    candidate = snapshot(candidate, 'plan');
    const plan = exact(candidate, [
        'accountBrokerRef', 'accountIdRef', 'basis', 'confirmationSnapshotHash',
        'contractKey', 'contractPricePolicy', 'contractUnit', 'position',
        'protection', 'riskRevision', 'schemaVersion', 'tradeDate',
    ], 'plan');
    if (plan.schemaVersion !== SMART_ORDER_EXISTING_POSITION_PROTECTION_PLAN_SCHEMA_VERSION) {
        invalid('plan.schemaVersion is unsupported');
    }
    token(plan.accountBrokerRef, 'plan.accountBrokerRef');
    token(plan.accountIdRef, 'plan.accountIdRef');
    token(plan.contractKey, 'plan.contractKey');
    token(plan.tradeDate, 'plan.tradeDate');
    token(plan.riskRevision, 'plan.riskRevision');
    digest(plan.confirmationSnapshotHash, 'plan.confirmationSnapshotHash');
    positiveInteger(plan.contractUnit, 'plan.contractUnit');
    const basis = exact(plan.basis, ['priceDecimal', 'source'], 'plan.basis');
    if (!['broker_average_cost', 'user_specified'].includes(basis.source)) invalid('plan.basis.source is unsupported');
    decimal(basis.priceDecimal, 'plan.basis.priceDecimal');
    const policy = exact(plan.contractPricePolicy, ['categoryCode', 'limitDownMinorUnits', 'limitUpMinorUnits'], 'plan.contractPricePolicy');
    if (
        (policy.categoryCode !== '00' && !/^(?:0[1-9]|[1-9]\d)$/.test(policy.categoryCode)) ||
        !Number.isSafeInteger(policy.limitDownMinorUnits) || policy.limitDownMinorUnits < 1 ||
        !Number.isSafeInteger(policy.limitUpMinorUnits) || policy.limitUpMinorUnits < policy.limitDownMinorUnits
    ) invalid('plan.contractPricePolicy is invalid');
    const position = exact(plan.position, [
        'accountHeadRevision', 'availableShares', 'evidenceHash', 'lineageId',
        'quantityShares',
    ], 'plan.position');
    positiveInteger(position.quantityShares, 'plan.position.quantityShares');
    positiveInteger(position.availableShares, 'plan.position.availableShares');
    if (position.availableShares > position.quantityShares) invalid('plan.position.availableShares exceeds quantityShares');
    if (!Number.isSafeInteger(position.accountHeadRevision) || position.accountHeadRevision < 0) invalid('plan.position.accountHeadRevision is invalid');
    token(position.lineageId, 'plan.position.lineageId');
    digest(position.evidenceHash, 'plan.position.evidenceHash');
    const protection = exact(plan.protection, ['family', 'legs'], 'plan.protection');
    if (
        !['fixed', 'trailing'].includes(protection.family) ||
        !Array.isArray(protection.legs) ||
        protection.legs.length < (protection.family === 'fixed' ? 1 : 2) ||
        protection.legs.length > (protection.family === 'fixed' ? 2 : 3)
    ) {
        invalid('plan.protection family or leg count is invalid');
    }
    const ids = new Set();
    const types = new Set();
    for (const [index, candidateLeg] of protection.legs.entries()) {
        const leg = exact(candidateLeg, ['comparator', 'distance', 'execution', 'legId', 'type'], `plan.protection.legs[${index}]`);
        token(leg.legId, `plan.protection.legs[${index}].legId`, 128);
        if (ids.has(leg.legId)) invalid('protection leg IDs must be unique');
        ids.add(leg.legId);
        const allowedTypes = protection.family === 'fixed'
            ? ['stop', 'take']
            : ['trailing_activation', 'trailing_retracement', 'fixed_stop'];
        if (!allowedTypes.includes(leg.type) || types.has(leg.type)) invalid('protection leg types are invalid');
        types.add(leg.type);
        if (
            (['stop', 'trailing_retracement', 'fixed_stop'].includes(leg.type) &&
                leg.comparator !== 'lte') ||
            (['take', 'trailing_activation'].includes(leg.type) &&
                leg.comparator !== 'gte')
        ) invalid('protection comparator conflicts with leg type');
        distance(leg.distance, `plan.protection.legs[${index}].distance`);
        execution(leg.execution, `plan.protection.legs[${index}].execution`);
    }
    if (
        protection.family === 'trailing' &&
        (!types.has('trailing_activation') ||
            !types.has('trailing_retracement'))
    ) {
        invalid('trailing protection requires activation and retracement legs');
    }
    const fixedAtrBindings = protection.legs
        .filter((leg) => leg.distance.kind === 'fixed_atr')
        .map((leg) => `${leg.distance.atr}\u001f${leg.distance.atrSnapshotRevision}`);
    if (new Set(fixedAtrBindings).size > 1) {
        invalid('all fixed-ATR legs must reuse one immutable ATR snapshot');
    }
    const serialized = canonicalJson(plan, { maximumBytes: 64 * 1024 });
    return Object.freeze({
        plan: Object.freeze(JSON.parse(serialized)),
        planJson: serialized,
        planSha256: `sha256:${createHash('sha256').update(serialized).digest('hex')}`,
        contractUnit: plan.contractUnit,
    });
}

function theoreticalTrigger(basis, leg) {
    if (leg.distance.kind === 'pct_bps') {
        const factor = BigInt(leg.comparator === 'lte' ? 10_000 - leg.distance.pctBps : 10_000 + leg.distance.pctBps);
        return { numerator: basis.numerator * factor, denominator: basis.denominator * 10_000n };
    }
    let offset = rational(
        leg.distance.kind === 'absolute' ? leg.distance.value : leg.distance.atr,
        `${leg.legId} distance`,
    );
    if (leg.distance.kind === 'fixed_atr') {
        const multiplier = rational(leg.distance.multiplier, `${leg.legId} multiplier`);
        offset = {
            numerator: offset.numerator * multiplier.numerator,
            denominator: offset.denominator * multiplier.denominator * 100n,
        };
    }
    return {
        numerator: basis.numerator * offset.denominator +
            (leg.comparator === 'lte' ? -1n : 1n) * offset.numerator * basis.denominator,
        denominator: basis.denominator * offset.denominator,
    };
}

export function deriveExistingPositionProtectionLegTrigger(candidate) {
    candidate = snapshot(candidate, 'leg trigger input');
    const record = exact(
        candidate,
        ['basisPriceDecimal', 'comparator', 'distance', 'legId'],
        'leg trigger input',
    );
    const comparator = token(record.comparator, 'leg trigger comparator');
    if (!['lte', 'gte'].includes(comparator)) {
        invalid('leg trigger comparator is unsupported');
    }
    const leg = Object.freeze({
        comparator,
        distance: distance(record.distance, 'leg trigger distance'),
        legId: token(record.legId, 'leg trigger legId'),
    });
    const basis = rational(
        decimal(record.basisPriceDecimal, 'leg trigger basisPriceDecimal'),
        'leg trigger basisPriceDecimal',
    );
    const trigger = theoreticalTrigger(basis, leg);
    return canonicalRational(
        trigger.numerator,
        trigger.denominator,
        'leg trigger',
    );
}

export function deriveExistingPositionFormalProtection(candidate, quantityShares) {
    const canonical = canonicalExistingPositionProtectionPlan(candidate);
    const shares = positiveInteger(quantityShares, 'formal quantityShares');
    if (shares > canonical.plan.position.availableShares) invalid('formal quantity exceeds confirmed available shares');
    const basis = rational(canonical.plan.basis.priceDecimal, 'plan.basis.priceDecimal');
    const legs = canonical.plan.protection.legs.map((leg) => {
        const pendingSavedHigh = leg.type === 'trailing_retracement';
        const trigger = pendingSavedHigh ? null : theoreticalTrigger(basis, leg);
        return Object.freeze({
            legId: leg.legId,
            type: leg.type,
            comparator: leg.comparator,
            triggerState: pendingSavedHigh ? 'pending_saved_high' : 'formal',
            triggerBasis: pendingSavedHigh
                ? 'durable_saved_high'
                : canonical.plan.basis.source,
            triggerPrice: trigger === null
                ? null
                : canonicalRational(
                      trigger.numerator,
                      trigger.denominator,
                      `${leg.legId} trigger`,
                  ),
            distance: Object.freeze({ ...leg.distance }),
            execution: Object.freeze({ ...leg.execution }),
        });
    });
    const fixedAtrDistance = canonical.plan.protection.legs.find(
        (leg) => leg.distance.kind === 'fixed_atr',
    )?.distance;
    const fixedAtrSnapshotSha256 = fixedAtrDistance === undefined
        ? null
        : `sha256:${createHash('sha256').update(canonicalJson({
              atr: fixedAtrDistance.atr,
              atrSnapshotRevision: fixedAtrDistance.atrSnapshotRevision,
          })).digest('hex')}`;
    return Object.freeze({
        schemaVersion: SMART_ORDER_EXISTING_POSITION_FORMAL_PROTECTION_SCHEMA_VERSION,
        protectionPlanSha256: canonical.planSha256,
        weightedAverageBasis: canonicalRational(basis.numerator, basis.denominator, 'position basis'),
        cumulativeFilledShares: shares,
        fixedAtrSnapshotSha256,
        legs: Object.freeze(legs),
    });
}
