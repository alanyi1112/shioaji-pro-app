import { types as utilTypes } from 'node:util';
import {
    SMART_ORDER_EXISTING_POSITION_PROTECTION_PLAN_SCHEMA_VERSION,
    canonicalExistingPositionProtectionPlan,
} from './existing-position-protection-contract.mjs';
import { canonicalProtectedEntryPlan } from './protected-entry-contract.mjs';

export const SMART_ORDER_PROTECTIVE_TRIGGER_EVALUATOR_SCHEMA_VERSION =
    'smart-order-protective-trigger-evaluator/2026-08-21.1';

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function snapshot(value, keys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    const expected = [...keys].sort();
    if (
        actual.some((key) => typeof key !== 'string') ||
        actual.length !== expected.length ||
        !actual.sort().every((key, index) => key === expected[index])
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    const result = {};
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (
            !descriptor?.enumerable ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set')
        ) {
            throw new TypeError(`${label} must use own data properties`);
        }
        result[key] = descriptor.value;
    }
    return Object.freeze(result);
}

function decimalRational(value, label) {
    if (typeof value !== 'string' || !DECIMAL.test(value) || value === '0') {
        throw new TypeError(`${label} must be a canonical positive decimal`);
    }
    const [whole, fractional = ''] = value.split('.');
    if (fractional.endsWith('0')) {
        throw new TypeError(`${label} must not contain trailing decimal zeroes`);
    }
    return Object.freeze({
        numerator: BigInt(`${whole}${fractional}`),
        denominator: 10n ** BigInt(fractional.length),
    });
}

function minorPrice(value, label) {
    const parsed = decimalRational(value, label);
    return Object.freeze({
        numerator: parsed.numerator * 100n,
        denominator: parsed.denominator,
    });
}

function formalRational(value, label) {
    const record = snapshot(
        value,
        ['denominator', 'numeratorMinorUnits'],
        label,
    );
    if (
        typeof record.numeratorMinorUnits !== 'string' ||
        !/^-?(?:0|[1-9]\d*)$/.test(record.numeratorMinorUnits) ||
        typeof record.denominator !== 'string' ||
        !/^[1-9]\d*$/.test(record.denominator)
    ) {
        throw new TypeError(`${label} rational is invalid`);
    }
    return Object.freeze({
        numerator: BigInt(record.numeratorMinorUnits),
        denominator: BigInt(record.denominator),
    });
}

function compare(left, right) {
    const delta =
        left.numerator * right.denominator -
        right.numerator * left.denominator;
    return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}

function matchesComparator(observed, trigger, comparator) {
    const compared = compare(observed, trigger);
    return comparator === 'lte' ? compared <= 0 : compared >= 0;
}

function triggerPricePolicy(value) {
    const record = snapshot(
        value,
        ['categoryCode', 'limitDownMinorUnits', 'limitUpMinorUnits'],
        'contract price policy',
    );
    if (
        (record.categoryCode !== '00' &&
            !/^(?:0[1-9]|[1-9]\d)$/.test(record.categoryCode)) ||
        !Number.isSafeInteger(record.limitDownMinorUnits) ||
        record.limitDownMinorUnits <= 0 ||
        !Number.isSafeInteger(record.limitUpMinorUnits) ||
        record.limitUpMinorUnits < record.limitDownMinorUnits
    ) {
        throw new TypeError('contract price policy is invalid');
    }
    return record;
}

function tickMinorUnits(theoretical, categoryCode) {
    const below = (minorUnits) =>
        theoretical.numerator <
        BigInt(minorUnits) * theoretical.denominator;
    if (categoryCode === '00') return below(5_000) ? 1n : 5n;
    if (below(1_000)) return 1n;
    if (below(5_000)) return 5n;
    if (below(10_000)) return 10n;
    if (below(50_000)) return 50n;
    if (below(100_000)) return 100n;
    return 500n;
}

function decimalFromMinorUnits(value) {
    const whole = value / 100n;
    const cents = value % 100n;
    if (cents === 0n) return whole.toString();
    if (cents % 10n === 0n) return `${whole}.${cents / 10n}`;
    return `${whole}.${cents.toString().padStart(2, '0')}`;
}

function legalTrigger(theoretical, policy, comparator) {
    if (theoretical.numerator <= 0n) {
        throw new TypeError('protective trigger must be positive');
    }
    const tick = tickMinorUnits(theoretical, policy.categoryCode);
    const divisor = theoretical.denominator * tick;
    let ticks = theoretical.numerator / divisor;
    if (comparator === 'lte' && theoretical.numerator % divisor !== 0n) {
        ticks += 1n;
    }
    const minorUnits = ticks * tick;
    if (
        minorUnits < BigInt(policy.limitDownMinorUnits) ||
        minorUnits > BigInt(policy.limitUpMinorUnits)
    ) {
        throw new TypeError('protective trigger is outside current price limits');
    }
    return Object.freeze({
        rational: Object.freeze({ numerator: minorUnits, denominator: 1n }),
        decimal: decimalFromMinorUnits(minorUnits),
    });
}

export function canonicalSmartOrderLegalProtectiveTrigger(candidate) {
    const record = snapshot(
        candidate,
        ['comparator', 'contractPricePolicy', 'theoreticalTrigger'],
        'legal protective trigger input',
    );
    if (!['lte', 'gte'].includes(record.comparator)) {
        throw new TypeError('legal protective trigger comparator is invalid');
    }
    const result = legalTrigger(
        formalRational(
            record.theoreticalTrigger,
            'legal protective trigger theoreticalTrigger',
        ),
        triggerPricePolicy(record.contractPricePolicy),
        record.comparator,
    );
    const tickMinor = tickMinorUnits(
        result.rational,
        record.contractPricePolicy.categoryCode,
    );
    return Object.freeze({
        decimal: result.decimal,
        minorUnits: Number(result.rational.numerator),
        tickMinorUnits: Number(tickMinor),
    });
}

function retracementTrigger(savedHigh, leg, fixedAtrSnapshot) {
    const distance = leg.distance;
    if (distance.kind === 'pct_bps') {
        if (
            !Number.isSafeInteger(distance.pctBps) ||
            distance.pctBps < 1 ||
            distance.pctBps > 9_999
        ) {
            throw new TypeError('trailing pct_bps distance is invalid');
        }
        return Object.freeze({
            numerator: savedHigh.numerator * BigInt(10_000 - distance.pctBps),
            denominator: savedHigh.denominator * 10_000n,
        });
    }
    let offset;
    if (distance.kind === 'absolute') {
        offset = minorPrice(distance.value, 'trailing absolute distance');
    } else if (distance.kind === 'fixed_atr') {
        if (!fixedAtrSnapshot) {
            throw new TypeError('trailing fixed ATR snapshot is unavailable');
        }
        const atr = minorPrice(fixedAtrSnapshot.value, 'fixed ATR value');
        const multiplier = decimalRational(
            distance.multiplier,
            'fixed ATR multiplier',
        );
        offset = Object.freeze({
            numerator: atr.numerator * multiplier.numerator,
            denominator: atr.denominator * multiplier.denominator,
        });
    } else {
        throw new TypeError('trailing retracement distance is invalid');
    }
    return Object.freeze({
        numerator:
            savedHigh.numerator * offset.denominator -
            offset.numerator * savedHigh.denominator,
        denominator: savedHigh.denominator * offset.denominator,
    });
}

function freezeResult(result) {
    return Object.freeze({
        ...result,
        retracementTriggerDecimal:
            result.retracementTriggerDecimal ?? null,
        triggeredLegIds: Object.freeze([...result.triggeredLegIds].sort()),
    });
}

/**
 * Pure, authority-free evaluator. It compares a module-validated live price
 * against a durable formal protection projection. It never performs I/O,
 * creates an intent, rearms an intent, or grants broker authority.
 */
export function evaluateSmartOrderProtectiveTrigger(input) {
    const request = snapshot(
        input,
        ['formalProtection', 'observedPrice', 'previousHead', 'protectionPlan'],
        'protective trigger evaluation',
    );
    const formal = snapshot(
        request.formalProtection,
        [
            'cumulativeFilledShares',
            'fixedAtrSnapshotSha256',
            'legs',
            'protectionPlanSha256',
            'schemaVersion',
            'weightedAverageBasis',
        ],
        'formal protection',
    );
    const plan = request.protectionPlan?.schemaVersion ===
        SMART_ORDER_EXISTING_POSITION_PROTECTION_PLAN_SCHEMA_VERSION
        ? canonicalExistingPositionProtectionPlan(request.protectionPlan).plan
        : canonicalProtectedEntryPlan(request.protectionPlan).plan;
    if (!Array.isArray(formal.legs) || utilTypes.isProxy(formal.legs)) {
        throw new TypeError('formal protection legs are invalid');
    }
    const protection = snapshot(plan.protection, ['family', 'legs'], 'protection');
    if (!['fixed', 'trailing'].includes(protection.family)) {
        throw new TypeError('protection family is invalid');
    }
    const pricePolicy = triggerPricePolicy(plan.contractPricePolicy);
    const observed = minorPrice(request.observedPrice, 'observedPrice');
    const formalLegs = formal.legs.map((candidate, index) => {
        const leg = snapshot(
            candidate,
            [
                'comparator',
                'distance',
                'execution',
                'legId',
                'triggerBasis',
                'triggerPrice',
                'triggerState',
                'type',
            ],
            `formal leg[${index}]`,
        );
        return leg;
    });
    const byId = new Map(formalLegs.map((leg) => [leg.legId, leg]));
    if (byId.size !== formalLegs.length) {
        throw new TypeError('formal protection leg IDs are not unique');
    }

    if (protection.family === 'fixed') {
        if (request.previousHead !== null) {
            const head = snapshot(
                request.previousHead,
                ['family', 'savedHighDecimal', 'state'],
                'protective trigger head',
            );
            if (
                head.family !== 'fixed' ||
                head.savedHighDecimal !== null ||
                !['monitoring', 'triggered'].includes(head.state)
            ) {
                throw new TypeError('fixed protective trigger head is invalid');
            }
            if (head.state === 'triggered') {
                return freezeResult({
                    family: 'fixed',
                    nextState: 'triggered',
                    savedHighDecimal: null,
                    triggeredLegIds: [],
                });
            }
        }
        const triggeredLegIds = formalLegs
            .filter((leg) => {
                if (leg.triggerState !== 'formal' || leg.triggerPrice === null) {
                    throw new TypeError('fixed formal trigger is unavailable');
                }
                return matchesComparator(
                    observed,
                    legalTrigger(
                        formalRational(leg.triggerPrice, `${leg.legId} trigger`),
                        pricePolicy,
                        leg.comparator,
                    ).rational,
                    leg.comparator,
                );
            })
            .map((leg) => leg.legId);
        return freezeResult({
            family: 'fixed',
            nextState: triggeredLegIds.length > 0 ? 'triggered' : 'monitoring',
            savedHighDecimal: null,
            triggeredLegIds,
        });
    }

    const prior =
        request.previousHead === null
            ? Object.freeze({
                  family: 'trailing',
                  savedHighDecimal: null,
                  state: 'pending_activation',
              })
            : snapshot(
                  request.previousHead,
                  ['family', 'savedHighDecimal', 'state'],
                  'protective trigger head',
              );
    if (
        prior.family !== 'trailing' ||
        !['pending_activation', 'active', 'triggered'].includes(prior.state) ||
        ((prior.state === 'active' || prior.state === 'triggered') !==
            (prior.savedHighDecimal !== null))
    ) {
        throw new TypeError('trailing protective trigger head is invalid');
    }
    if (prior.state === 'triggered') {
        return freezeResult({
            family: 'trailing',
            nextState: 'triggered',
            savedHighDecimal: prior.savedHighDecimal,
            triggeredLegIds: [],
        });
    }
    const activation = formalLegs.find(
        (leg) => leg.type === 'trailing_activation',
    );
    const retracement = formalLegs.find(
        (leg) => leg.type === 'trailing_retracement',
    );
    const fixedStop = formalLegs.find((leg) => leg.type === 'fixed_stop');
    if (!activation || !retracement) {
        throw new TypeError('trailing activation/retracement pair is incomplete');
    }
    const triggeredLegIds = [];
    if (fixedStop) {
        if (fixedStop.triggerState !== 'formal' || fixedStop.triggerPrice === null) {
            throw new TypeError('trailing fixed stop formal trigger is unavailable');
        }
        if (
            matchesComparator(
                observed,
                legalTrigger(
                    formalRational(fixedStop.triggerPrice, 'fixed stop trigger'),
                    pricePolicy,
                    fixedStop.comparator,
                ).rational,
                fixedStop.comparator,
            )
        ) {
            triggeredLegIds.push(fixedStop.legId);
        }
    }
    let savedHigh =
        prior.savedHighDecimal === null
            ? null
            : minorPrice(prior.savedHighDecimal, 'savedHighDecimal');
    let savedHighDecimal = prior.savedHighDecimal;
    let active = prior.state === 'active';
    if (!active) {
        if (activation.triggerState !== 'formal' || activation.triggerPrice === null) {
            throw new TypeError('trailing activation formal trigger is unavailable');
        }
        active = matchesComparator(
            observed,
            legalTrigger(
                formalRational(
                    activation.triggerPrice,
                    'trailing activation trigger',
                ),
                pricePolicy,
                activation.comparator,
            ).rational,
            activation.comparator,
        );
        if (active) {
            savedHigh = observed;
            savedHighDecimal = request.observedPrice;
        }
    } else if (compare(observed, savedHigh) > 0) {
        savedHigh = observed;
        savedHighDecimal = request.observedPrice;
    }
    let retracementTriggerDecimal = null;
    if (active) {
        const trigger = legalTrigger(
            retracementTrigger(
                savedHigh,
                retracement,
                plan.fixedAtrSnapshot ??
                    (retracement.distance.kind === 'fixed_atr'
                        ? Object.freeze({ value: retracement.distance.atr })
                        : null),
            ),
            pricePolicy,
            retracement.comparator,
        );
        retracementTriggerDecimal = trigger.decimal;
        if (
            matchesComparator(
                observed,
                trigger.rational,
                retracement.comparator,
            )
        ) {
            triggeredLegIds.push(retracement.legId);
        }
    }
    return freezeResult({
        family: 'trailing',
        nextState:
            triggeredLegIds.length > 0
                ? 'triggered'
                : active
                  ? 'active'
                  : 'pending_activation',
        savedHighDecimal,
        retracementTriggerDecimal,
        triggeredLegIds,
    });
}
