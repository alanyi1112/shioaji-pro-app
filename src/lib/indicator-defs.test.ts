import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    DEF_BY_TYPE,
    KBAR_READOUT_TYPE,
    loadInstances,
    normalizeIndicatorInstances,
    saveInstances,
    splitKbarReadoutInstance,
} from './indicator-defs';

describe('indicator definition union', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('K 棒價量是沒有 outputs/compute 的 singleton readout', () => {
        const def = DEF_BY_TYPE.get(KBAR_READOUT_TYPE);
        expect(def?.kind).toBe('readout');
        if (!def || def.kind !== 'readout') throw new Error('missing readout');
        expect(def.singleton).toBe(true);
        expect('outputs' in def).toBe(false);
        expect('compute' in def).toBe(false);
    });

    it('normalization 保留一般順序並移除重複 readout', () => {
        const normalized = normalizeIndicatorInstances([
            { id: 'ma-1', type: 'sma', params: { period: 5 }, colors: {} },
            {
                id: 'readout-1',
                type: KBAR_READOUT_TYPE,
                params: {},
                colors: {},
            },
            {
                id: 'readout-2',
                type: KBAR_READOUT_TYPE,
                params: {},
                colors: {},
            },
            { id: 'ma-2', type: 'sma', params: { period: 10 }, colors: {} },
            { id: '', type: 'sma' },
            { id: 'unknown', type: 'missing' },
        ]);
        expect(normalized.map((item) => item.id)).toEqual([
            'ma-1',
            'readout-1',
            'ma-2',
        ]);
        const split = splitKbarReadoutInstance(normalized);
        expect(split.readout?.id).toBe('readout-1');
        expect(split.rest.map((item) => item.id)).toEqual(['ma-1', 'ma-2']);
    });

    it('save/load 對損壞欄位與重複 readout 可重入正規化', () => {
        const storage = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        });
        const input = [
            {
                id: 'readout-1',
                type: KBAR_READOUT_TYPE,
                params: {},
                colors: {},
                precision: 999,
                styles: { bogus: { plot: 'network', color: 'javascript:' } },
            },
            {
                id: 'readout-2',
                type: KBAR_READOUT_TYPE,
                params: {},
                colors: {},
            },
        ];
        storage.set('sj-pro-indicators-v2', JSON.stringify(input));
        const first = loadInstances();
        saveInstances(first);
        expect(loadInstances()).toEqual(first);
        expect(first).toHaveLength(1);
        expect(first[0]?.precision).toBeUndefined();
        expect(first[0]?.styles).toBeUndefined();
    });
});
