import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_QUICK_FIELD_MAPPING,
    SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION,
    SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
    currentSmartOrderQuickFieldMapping,
    isCurrentSmartOrderQuickFieldMappingDefinition,
} from './quick-field-mapping.mjs';

describe('quick field three-layer mapping', () => {
    it('binds the exact nine UI fields to local units and Shioaji sources', () => {
        expect(SMART_ORDER_QUICK_FIELD_MAPPING.map((row) => row.field)).toEqual([
            'last_price',
            'bid_price',
            'ask_price',
            'up_amount',
            'down_amount',
            'up_percent',
            'down_percent',
            'tick_quantity',
            'total_quantity',
        ]);
        expect(currentSmartOrderQuickFieldMapping('up_percent')).toMatchObject({
            uiLabel: '漲幅',
            sourceField: 'pct_chg',
            sourceUnit: 'integer_basis_points',
            localUnit: 'percent_decimal',
            transform: 'integer_basis_points_to_percent_decimal',
        });
        expect(currentSmartOrderQuickFieldMapping('tick_quantity')).toMatchObject({
            sourceField: 'volume',
            sourceUnit: 'CommonLot',
            localUnit: 'CommonLot',
        });
        expect(SMART_ORDER_QUICK_FIELD_MAPPING.every((row) => row.comparators.join(',') === 'gte,lte')).toBe(true);
        expect(SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(Object.isFrozen(SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION)).toBe(true);
    });

    it('does not accept a structural clone as the current mapping authority', () => {
        expect(isCurrentSmartOrderQuickFieldMappingDefinition(SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION)).toBe(true);
        expect(isCurrentSmartOrderQuickFieldMappingDefinition({ ...SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION })).toBe(false);
    });
});
