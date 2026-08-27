import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
    SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
} from './quick-field-mapping.mjs';
import {
    canonicalSmartOrderQuickCondition,
    evaluateSmartOrderQuickCondition,
    projectSmartOrderQuickConditionTransition,
} from './quick-condition-evaluator.mjs';

const condition = (field, comparator, threshold) => ({
    field,
    comparator,
    threshold,
    mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
});

const observation = (field, value, localUnit) => ({
    field,
    value,
    localUnit,
    mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
    mappingDefinitionSha256:
        SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
});

describe('quick condition evaluator', () => {
    it.each([
        ['last_price', 'price_decimal'],
        ['bid_price', 'price_decimal'],
        ['ask_price', 'price_decimal'],
        ['up_amount', 'price_decimal'],
        ['down_amount', 'price_decimal'],
        ['up_percent', 'percent_decimal'],
        ['down_percent', 'percent_decimal'],
        ['tick_quantity', 'CommonLot'],
        ['total_quantity', 'CommonLot'],
    ])('binds the current mapping for %s', (field, localUnit) => {
        const result = evaluateSmartOrderQuickCondition(
            condition(field, 'gte', '1'),
            observation(field, '1', localUnit),
        );
        expect(result.conditionTrue).toBe(true);
        expect(result.brokerWriteAuthority).toBe(false);
    });

    it('requires a false-to-true edge by default and only triggers immediately after explicit policy confirmation', () => {
        expect(
            projectSmartOrderQuickConditionTransition({
                activationPolicy: 'require_rearm',
                previousState: null,
                conditionTrue: true,
            }),
        ).toEqual({
            nextState: 'true_latched',
            triggerNow: false,
            brokerWriteAuthority: false,
        });
        expect(
            projectSmartOrderQuickConditionTransition({
                activationPolicy: 'require_rearm',
                previousState: 'ready_after_false',
                conditionTrue: true,
            }),
        ).toEqual({
            nextState: 'triggered',
            triggerNow: true,
            brokerWriteAuthority: false,
        });
        expect(
            projectSmartOrderQuickConditionTransition({
                activationPolicy: 'immediate_if_true',
                previousState: null,
                conditionTrue: true,
            }),
        ).toEqual({
            nextState: 'triggered',
            triggerNow: true,
            brokerWriteAuthority: false,
        });
    });

    it('uses exact decimal gte/lte comparisons without Number coercion', () => {
        expect(
            evaluateSmartOrderQuickCondition(
                condition('last_price', 'gte', '9007199254740991.01'),
                observation(
                    'last_price',
                    '9007199254740991.02',
                    'price_decimal',
                ),
            ).conditionTrue,
        ).toBe(true);
        expect(
            evaluateSmartOrderQuickCondition(
                condition('up_percent', 'lte', '3.01'),
                observation('up_percent', '3.02', 'percent_decimal'),
            ).conditionTrue,
        ).toBe(false);
    });

    it('rejects stale mapping, wrong units, negative and non-canonical thresholds', () => {
        expect(() =>
            canonicalSmartOrderQuickCondition({
                ...condition('last_price', 'gte', '1'),
                mappingRevision: 'stale',
            }),
        ).toThrow();
        expect(() =>
            evaluateSmartOrderQuickCondition(
                condition('tick_quantity', 'gte', '1'),
                observation('tick_quantity', '1', 'Share'),
            ),
        ).toThrow();
        expect(() =>
            canonicalSmartOrderQuickCondition(
                condition('last_price', 'gte', '-1'),
            ),
        ).toThrow();
        expect(() =>
            canonicalSmartOrderQuickCondition(
                condition('last_price', 'gte', '1.0'),
            ),
        ).toThrow();
    });
});
