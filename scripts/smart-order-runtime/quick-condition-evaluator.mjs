import {
    SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
    SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
    currentSmartOrderQuickFieldMapping,
} from './quick-field-mapping.mjs';

export const SMART_ORDER_QUICK_CONDITION_EVALUATOR_SCHEMA_VERSION =
    'smart-order-quick-condition-evaluator/2026-08-21.1';

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function canonicalNonNegativeDecimal(value, label) {
    if (
        typeof value !== 'string' ||
        value.length < 1 ||
        value.length > 80 ||
        !DECIMAL_PATTERN.test(value) ||
        (value.includes('.') && value.endsWith('0')) ||
        value.split('.')[0].length > 18 ||
        (value.split('.')[1] ?? '').length > 18
    ) {
        throw new TypeError(`${label} must be a bounded canonical non-negative decimal`);
    }
    return value;
}

function compareCanonicalDecimals(left, right) {
    const [leftInteger, leftFraction = ''] = left.split('.');
    const [rightInteger, rightFraction = ''] = right.split('.');
    if (leftInteger.length !== rightInteger.length) {
        return leftInteger.length < rightInteger.length ? -1 : 1;
    }
    if (leftInteger !== rightInteger) return leftInteger < rightInteger ? -1 : 1;
    const scale = Math.max(leftFraction.length, rightFraction.length);
    const scaledLeft = leftFraction.padEnd(scale, '0');
    const scaledRight = rightFraction.padEnd(scale, '0');
    if (scaledLeft === scaledRight) return 0;
    return scaledLeft < scaledRight ? -1 : 1;
}

export function canonicalSmartOrderQuickCondition(value) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype ||
        Object.keys(value).sort().join('\u001f') !==
            ['comparator', 'field', 'mappingRevision', 'threshold']
                .sort()
                .join('\u001f')
    ) {
        throw new TypeError('quick condition schema is invalid');
    }
    const mapping = currentSmartOrderQuickFieldMapping(value.field);
    if (
        !mapping ||
        !mapping.comparators.includes(value.comparator) ||
        value.mappingRevision !== SMART_ORDER_QUICK_FIELD_MAPPING_REVISION
    ) {
        throw new TypeError('quick condition mapping or comparator is unsupported');
    }
    return Object.freeze({
        field: value.field,
        comparator: value.comparator,
        threshold: canonicalNonNegativeDecimal(
            value.threshold,
            'quickCondition.threshold',
        ),
        localUnit: mapping.localUnit,
        sourceKind: mapping.sourceKind,
        mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
        mappingDefinitionSha256:
            SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
    });
}

export function evaluateSmartOrderQuickCondition(condition, observation) {
    const canonical = canonicalSmartOrderQuickCondition(condition);
    if (
        !observation ||
        typeof observation !== 'object' ||
        Array.isArray(observation) ||
        observation.field !== canonical.field ||
        observation.localUnit !== canonical.localUnit ||
        observation.mappingRevision !== canonical.mappingRevision ||
        observation.mappingDefinitionSha256 !==
            canonical.mappingDefinitionSha256
    ) {
        throw new TypeError('quick observation does not match the canonical condition');
    }
    const observedValue = canonicalNonNegativeDecimal(
        observation.value,
        'quickObservation.value',
    );
    const comparison = compareCanonicalDecimals(
        observedValue,
        canonical.threshold,
    );
    return Object.freeze({
        schemaVersion: SMART_ORDER_QUICK_CONDITION_EVALUATOR_SCHEMA_VERSION,
        field: canonical.field,
        comparator: canonical.comparator,
        threshold: canonical.threshold,
        observedValue,
        conditionTrue:
            canonical.comparator === 'gte'
                ? comparison >= 0
                : comparison <= 0,
        mappingRevision: canonical.mappingRevision,
        mappingDefinitionSha256: canonical.mappingDefinitionSha256,
        brokerWriteAuthority: false,
    });
}

export function projectSmartOrderQuickConditionTransition({
    activationPolicy,
    previousState,
    conditionTrue,
}) {
    if (
        !['require_rearm', 'immediate_if_true'].includes(activationPolicy) ||
        ![null, 'true_latched', 'ready_after_false'].includes(previousState) ||
        typeof conditionTrue !== 'boolean'
    ) {
        throw new TypeError('quick condition transition input is invalid');
    }
    const triggerNow =
        conditionTrue &&
        (activationPolicy === 'immediate_if_true' ||
            previousState === 'ready_after_false');
    return Object.freeze({
        nextState: triggerNow
            ? 'triggered'
            : conditionTrue
              ? 'true_latched'
              : 'ready_after_false',
        triggerNow,
        brokerWriteAuthority: false,
    });
}
