import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    STORE_KEY,
    getIndicatorPersistenceStatus,
    getInstancesSnapshot,
    normalizeIndicatorInstances,
    resetIndicatorStoreForTests,
} from './indicator-defs';
import {
    enabledSupportResistanceFormulas,
    getSupportResistanceFormulaStyle,
    setSupportResistanceFormulaStyle,
    setSupportResistanceFormulaEnabled,
    updateSupportResistanceFormulaForProduct,
} from './support-resistance-indicator-state';
import {
    clearSupportResistanceProductState,
    getSupportResistanceProductState,
    resetSupportResistanceProductStatesForTests,
    setSupportResistanceProductState,
    supportResistanceProductKey,
} from './support-resistance-state';

describe('support/resistance canonical and document-session state', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(() => null),
            setItem: vi.fn(),
            removeItem: vi.fn(),
        });
        resetIndicatorStoreForTests();
        resetSupportResistanceProductStatesForTests();
    });

    it('uses a product key without timeframe, formula or instance id and isolates products', () => {
        const key = supportResistanceProductKey({ security_type: 'STK', exchange: 'TSE', code: ' 2330 ' });
        expect(key).toBe('STK|TSE|2330');
        expect(key).not.toMatch(/1440|pivot|instance/);
        setSupportResistanceProductState({ key, pinned: true, reference: {
            date: '2026-08-07', high: 110, low: 90, close: 100,
            firstTime: 1, lastTime: 2, status: 'completed', mode: 'pinned',
        } });
        expect(getSupportResistanceProductState(key)?.reference.date).toBe('2026-08-07');
        expect(getSupportResistanceProductState('STK|TSE|2303')).toBeNull();
        clearSupportResistanceProductState(key);
        expect(getSupportResistanceProductState(key)).toBeNull();
    });

    it('updates checkbox state through the functional canonical store contract', () => {
        const existing = normalizeIndicatorInstances([
            { id: 'rsi-1', type: 'rsi', params: {}, colors: {} },
        ]);
        const storageValue = JSON.stringify({
            schemaVersion: 3,
            revision: 1,
            updatedAt: 1,
            writerId: 'seed',
            instances: existing,
        });
        localStorage.getItem = vi.fn((key: string) =>
            key === STORE_KEY ? storageValue : null,
        );
        resetIndicatorStoreForTests();
        setSupportResistanceFormulaEnabled('pivot-point', true);
        setSupportResistanceFormulaEnabled('cdp', true);
        expect(enabledSupportResistanceFormulas(getInstancesSnapshot())).toEqual(['pivot-point', 'cdp']);
        setSupportResistanceFormulaEnabled('pivot-point', false);
        expect(enabledSupportResistanceFormulas(getInstancesSnapshot())).toEqual(['cdp']);
        expect(getInstancesSnapshot().some((instance) => instance.id === 'rsi-1')).toBe(true);
        expect(localStorage.setItem).toHaveBeenCalledWith(STORE_KEY, expect.any(String));
    });

    it('clears a pinned reference only after the last formula is disabled and reload returns to automatic', () => {
        const key = 'STK|TSE|2330';
        setSupportResistanceProductState({ key, pinned: true, reference: {
            date: '2026-08-07', high: 110, low: 90, close: 100,
            firstTime: 1, lastTime: 2, status: 'completed', mode: 'pinned',
        } });
        updateSupportResistanceFormulaForProduct(key, 'pivot-point', true);
        updateSupportResistanceFormulaForProduct(key, 'cdp', true);
        updateSupportResistanceFormulaForProduct(key, 'pivot-point', false);
        expect(getSupportResistanceProductState(key)?.pinned).toBe(true);
        updateSupportResistanceFormulaForProduct(key, 'cdp', false);
        expect(getSupportResistanceProductState(key)).toBeNull();

        setSupportResistanceFormulaEnabled('three-level-price', true);
        resetSupportResistanceProductStatesForTests();
        expect(enabledSupportResistanceFormulas(getInstancesSnapshot())).toContain('three-level-price');
        expect(getSupportResistanceProductState(key)).toBeNull();
    });

    it('keeps in-memory state and a safe reason code when persistence fails', () => {
        vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('quota'); });
        setSupportResistanceFormulaEnabled('three-level-price', true);
        expect(enabledSupportResistanceFormulas(getInstancesSnapshot())).toEqual(['three-level-price']);
        expect(getIndicatorPersistenceStatus()).toEqual({ state: 'error', reasonCode: 'storage-unavailable' });
    });

    it('stores formula styles canonically without enabling hidden formulas and preserves them across enable, reload and reset', () => {
        const custom = { color: '#123456', width: 3 as const, lineStyle: 'dotted' as const };
        setSupportResistanceFormulaStyle('pivot-point', custom);
        expect(enabledSupportResistanceFormulas(getInstancesSnapshot())).toEqual([]);
        expect(getSupportResistanceFormulaStyle(getInstancesSnapshot(), 'pivot-point')).toEqual(custom);
        expect(getSupportResistanceFormulaStyle(getInstancesSnapshot(), 'cdp')).toBeNull();

        setSupportResistanceFormulaEnabled('pivot-point', true);
        expect(enabledSupportResistanceFormulas(getInstancesSnapshot())).toEqual(['pivot-point']);
        expect(getSupportResistanceFormulaStyle(getInstancesSnapshot(), 'pivot-point')).toEqual(custom);

        const persisted = vi.mocked(localStorage.setItem).mock.calls.at(-1)?.[1];
        expect(persisted).toBeTruthy();
        vi.mocked(localStorage.getItem).mockReturnValue(persisted ?? null);
        resetIndicatorStoreForTests();
        expect(getSupportResistanceFormulaStyle(getInstancesSnapshot(), 'pivot-point')).toEqual(custom);
        expect(enabledSupportResistanceFormulas(getInstancesSnapshot())).toEqual(['pivot-point']);

        setSupportResistanceFormulaStyle('pivot-point', null);
        expect(getSupportResistanceFormulaStyle(getInstancesSnapshot(), 'pivot-point')).toBeNull();
        expect(enabledSupportResistanceFormulas(getInstancesSnapshot())).toEqual(['pivot-point']);
    });

    it('keeps formula style in memory when persistence fails', () => {
        vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('quota'); });
        const custom = { color: '#abcdef', width: 4 as const, lineStyle: 'dashed' as const };
        setSupportResistanceFormulaStyle('cdp', custom);
        expect(getSupportResistanceFormulaStyle(getInstancesSnapshot(), 'cdp')).toEqual(custom);
        expect(enabledSupportResistanceFormulas(getInstancesSnapshot())).toEqual([]);
        expect(getIndicatorPersistenceStatus()).toEqual({ state: 'error', reasonCode: 'storage-unavailable' });
    });

    it('migrates legacy Pivot idempotently, maps hidden to unchecked and lets modern state win', () => {
        const visible = { id: 'legacy-visible', type: 'traditional-pivot', params: {}, colors: {} };
        const hidden = { id: 'legacy-hidden', type: 'traditional-pivot', params: {}, colors: {}, hidden: true };
        expect(normalizeIndicatorInstances([visible])[0]).toMatchObject({ id: 'legacy-visible', type: 'support-resistance-pivot' });
        expect(normalizeIndicatorInstances([hidden])[0]).toMatchObject({ type: 'support-resistance-pivot', hidden: true });
        const modern = { id: 'modern', type: 'support-resistance-pivot', params: {}, colors: {}, hidden: true };
        expect(normalizeIndicatorInstances([visible, modern])).toEqual([expect.objectContaining({ id: 'modern', hidden: true })]);
        expect(normalizeIndicatorInstances(normalizeIndicatorInstances([visible]))).toHaveLength(1);
    });
});
