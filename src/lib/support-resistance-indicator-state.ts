import {
    SUPPORT_RESISTANCE_INDICATOR_TYPES,
    newInstance,
    updateInstances,
    type IndicatorInstance,
    type OutputStyle,
} from './indicator-defs';
import type { SupportResistanceFormulaId } from './support-resistance';
import { clearSupportResistanceProductState } from './support-resistance-state';

export type SupportResistanceLineStyle = 'solid' | 'dashed' | 'dotted';

export interface SupportResistanceFormulaStyle {
    color: string;
    width: 1 | 2 | 3 | 4;
    lineStyle: SupportResistanceLineStyle;
}

export const SUPPORT_RESISTANCE_STYLE_DEFAULTS: Record<
    SupportResistanceFormulaId,
    SupportResistanceFormulaStyle
> = {
    'pivot-point': { color: '#f87171', width: 1, lineStyle: 'solid' },
    'three-level-price': { color: '#fb923c', width: 1, lineStyle: 'dashed' },
    cdp: { color: '#c084fc', width: 1, lineStyle: 'dotted' },
};

function validFormulaStyle(
    style: OutputStyle | undefined,
): SupportResistanceFormulaStyle | null {
    if (
        !style ||
        typeof style.color !== 'string' ||
        !/^#[0-9a-fA-F]{6}$/.test(style.color) ||
        ![1, 2, 3, 4].includes(style.width ?? 0) ||
        (style.lineStyle !== 'solid' &&
            style.lineStyle !== 'dashed' &&
            style.lineStyle !== 'dotted')
    ) {
        return null;
    }
    return {
        color: style.color,
        width: style.width as 1 | 2 | 3 | 4,
        lineStyle: style.lineStyle,
    };
}

export function getSupportResistanceFormulaStyle(
    instances: readonly IndicatorInstance[],
    formulaId: SupportResistanceFormulaId,
): SupportResistanceFormulaStyle | null {
    const type = SUPPORT_RESISTANCE_INDICATOR_TYPES[formulaId];
    return validFormulaStyle(
        instances.find((instance) => instance.type === type)?.styles?.line,
    );
}

export function setSupportResistanceFormulaStyle(
    formulaId: SupportResistanceFormulaId,
    style: SupportResistanceFormulaStyle | null,
): readonly IndicatorInstance[] {
    const type = SUPPORT_RESISTANCE_INDICATOR_TYPES[formulaId];
    return updateInstances((current) => {
        const existing = current.find((instance) => instance.type === type);
        if (!existing) {
            if (!style) return current;
            const created = newInstance(type);
            created.hidden = true;
            created.visibleTf = [1, 5, 15, 60, 1440];
            created.styles = { line: { ...style } };
            return [...current, created];
        }
        const nextStyles = { ...existing.styles };
        if (style) nextStyles.line = { ...style };
        else delete nextStyles.line;
        return current.map((instance) =>
            instance.id === existing.id
                ? {
                      ...instance,
                      ...(Object.keys(nextStyles).length > 0
                          ? { styles: nextStyles }
                          : { styles: undefined }),
                  }
                : instance,
        );
    });
}

export function supportResistanceFormulaEnabled(
    instances: readonly IndicatorInstance[],
    formulaId: SupportResistanceFormulaId,
): boolean {
    const type = SUPPORT_RESISTANCE_INDICATOR_TYPES[formulaId];
    return instances.some(
        (instance) => instance.type === type && !instance.hidden,
    );
}

export function enabledSupportResistanceFormulas(
    instances: readonly IndicatorInstance[],
): SupportResistanceFormulaId[] {
    return (
        Object.keys(
            SUPPORT_RESISTANCE_INDICATOR_TYPES,
        ) as SupportResistanceFormulaId[]
    ).filter((formulaId) =>
        supportResistanceFormulaEnabled(instances, formulaId),
    );
}

export function setSupportResistanceFormulaEnabled(
    formulaId: SupportResistanceFormulaId,
    enabled: boolean,
): readonly IndicatorInstance[] {
    const type = SUPPORT_RESISTANCE_INDICATOR_TYPES[formulaId];
    return updateInstances((current) => {
        const existing = current.find((instance) => instance.type === type);
        if (existing) {
            if (Boolean(!existing.hidden) === enabled) return current;
            return current.map((instance) =>
                instance.id === existing.id
                    ? { ...instance, hidden: !enabled }
                    : instance,
            );
        }
        if (!enabled) return current;
        const instance = newInstance(type);
        instance.visibleTf = [1, 5, 15, 60, 1440];
        return [...current, instance];
    });
}

export function updateSupportResistanceFormulaForProduct(
    productKey: string,
    formulaId: SupportResistanceFormulaId,
    enabled: boolean,
): readonly IndicatorInstance[] {
    const next = setSupportResistanceFormulaEnabled(formulaId, enabled);
    if (enabledSupportResistanceFormulas(next).length === 0) {
        clearSupportResistanceProductState(productKey);
    }
    return next;
}
