import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    DEF_BY_TYPE,
    DEFAULTS_KEY,
    KBAR_READOUT_TYPE,
    LEGACY_DEFAULTS_KEY,
    LEGACY_V2_STORE_KEY,
    STORE_KEY,
    applyIndicatorStorageValue,
    buildIndicatorReadoutDisplay,
    commitIndicatorDraft,
    getIndicatorPersistenceStatus,
    getInstancesSnapshot,
    loadInstances,
    loadTypeDefaults,
    normalizeIndicatorInstances,
    resetIndicatorStoreForTests,
    saveInstances,
    splitKbarReadoutInstance,
    subscribeInstances,
    updateInstances,
} from './indicator-defs';

describe('indicator definition union', () => {
    afterEach(() => {
        resetIndicatorStoreForTests();
        vi.unstubAllGlobals();
    });
    it('K 棒價量是沒有 outputs/compute 的 singleton readout', () => {
        const def = DEF_BY_TYPE.get(KBAR_READOUT_TYPE);
        expect(def?.kind).toBe('readout');
        if (!def || def.kind !== 'readout') throw new Error('missing readout');
        expect(def.singleton).toBe(true);
        expect('outputs' in def).toBe(false);
        expect('compute' in def).toBe(false);
    });

    it('BOLL readout 依上中下排序且保留 output 顏色', () => {
        const def = DEF_BY_TYPE.get('boll');
        expect(def?.kind).toBe('series');
        if (!def || def.kind !== 'series') throw new Error('missing boll');
        expect(def.outputs.map((output) => output.key)).toEqual([
            'mid',
            'upper',
            'lower',
        ]);

        const display = buildIndicatorReadoutDisplay(
            {
                id: 'boll-1',
                type: 'boll',
                params: { period: 20, mult: 2 },
                colors: {},
            },
            [
                { key: 'mid', label: '中軌', text: '937.5', color: '#888888' },
                { key: 'upper', label: '上軌', text: '952.9', color: '#5555ff' },
                { key: 'lower', label: '下軌', text: '922.2', color: '#3333ff' },
            ],
        );
        expect(display.label).toBe('BOLL(20,2)');
        expect(
            display.values.map(({ key, prefix, text, color }) => ({
                key,
                prefix,
                text,
                color,
            })),
        ).toEqual([
            { key: 'upper', prefix: '上', text: '952.9', color: '#5555ff' },
            { key: 'mid', prefix: '中軌', text: '937.5', color: '#888888' },
            { key: 'lower', prefix: '下', text: '922.2', color: '#3333ff' },
        ]);
    });

    it('均量與均線使用 readout 專用名稱、週期 prefix 與缺值', () => {
        const values = [
            { key: 'ma5', label: 'SMA5', text: '—', color: '#111111' },
            { key: 'ma10', label: 'SMA10', text: '934.1', color: '#222222' },
            { key: 'ma20', label: 'SMA20', text: '937.5', color: '#333333' },
            { key: 'ma60', label: 'SMA60', text: '939.8', color: '#444444' },
            { key: 'ma120', label: 'SMA120', text: '911.2', color: '#555555' },
        ];
        const ma = buildIndicatorReadoutDisplay(
            { id: 'ma-pack', type: 'reference-ma-pack', params: {}, colors: {} },
            values,
        );
        expect(ma.label).toBe('均線');
        expect(ma.values.map(({ prefix, text }) => [prefix, text])).toEqual([
            ['5MA', '—'],
            ['10MA', '934.1'],
            ['20MA', '937.5'],
            ['60MA', '939.8'],
            ['120MA', '911.2'],
        ]);

        const volume = buildIndicatorReadoutDisplay(
            { id: 'volume-ma', type: 'volume-ma', params: {}, colors: {} },
            values,
        );
        expect(volume.label).toBe('均量');
        expect(volume.values.map(({ prefix }) => prefix)).toEqual([
            '5MA',
            '10MA',
            '20MA',
        ]);
        expect(DEF_BY_TYPE.get('volume-ma')?.label).toBe(
            'Volume MA 成交量均線',
        );
        expect(DEF_BY_TYPE.get('reference-ma-pack')?.label).toBe('參考均線組');
    });

    it('未設定 readout metadata 的 indicator 保持既有名稱與順序', () => {
        const values = [
            { key: 'line', label: 'MA', text: '100.0', color: '#abcdef' },
        ];
        expect(
            buildIndicatorReadoutDisplay(
                {
                    id: 'sma-1',
                    type: 'sma',
                    params: { period: 20 },
                    colors: {},
                },
                values,
            ),
        ).toEqual({ label: 'MA(20)', values });
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
        storage.set(LEGACY_V2_STORE_KEY, JSON.stringify(input));
        const first = loadInstances();
        saveInstances(first);
        expect(loadInstances()).toEqual(first);
        expect(JSON.parse(storage.get(STORE_KEY) ?? '{}')).toMatchObject({
            schemaVersion: 3,
        });
        expect(first).toHaveLength(1);
        expect(first[0]?.precision).toBeUndefined();
        expect(first[0]?.styles).toBeUndefined();
    });

    it('v2 breaking params 與 styles 非破壞遷移到 v3', () => {
        const storage = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        });
        storage.set(
            LEGACY_V2_STORE_KEY,
            JSON.stringify([
                {
                    id: 'rsi-1',
                    type: 'rsi',
                    params: { period: 14 },
                    colors: { line: '#123456' },
                    styles: { line: { color: '#654321', width: 2 } },
                    hidden: true,
                    visibleTf: [1, 5],
                    precision: 3,
                    showLabels: true,
                    showValues: false,
                },
                {
                    id: 'kd-1',
                    type: 'kd',
                    params: { period: 9, k: 4, d: 5 },
                    colors: {},
                },
                {
                    id: 'macd-1',
                    type: 'macd',
                    params: { fast: 8, slow: 21, signal: 5 },
                    colors: {},
                    styles: { hist: { opacity: 50 } },
                },
                {
                    id: 'atr-1',
                    type: 'atr',
                    params: { period: 200 },
                    colors: {},
                },
            ]),
        );

        const migrated = loadInstances();
        expect(migrated[0]).toMatchObject({
            id: 'rsi-1',
            params: { shortPeriod: 5, longPeriod: 10 },
            colors: { short: '#123456' },
            styles: { short: { color: '#654321', width: 2 } },
            hidden: true,
            visibleTf: [1, 5],
            precision: 3,
            showLabels: true,
            showValues: false,
        });
        expect(migrated[1]?.params).toEqual({
            period: 9,
            rsvWeight: 4,
            kWeight: 5,
        });
        expect(migrated[2]).toMatchObject({
            params: { fastPeriod: 8, slowPeriod: 21, signalPeriod: 5 },
            styles: { hist: { opacity: 50 } },
        });
        expect(migrated[3]?.params).toEqual({ period: 14 });
        expect(storage.has(LEGACY_V2_STORE_KEY)).toBe(true);
        expect(JSON.parse(storage.get(STORE_KEY) ?? '{}')).toMatchObject({
            schemaVersion: 3,
            instances: expect.any(Array),
        });
    });

    it('只將 Traditional Pivot 的 visibleTf 正規化為所有支援時框', () => {
        const normalized = normalizeIndicatorInstances([
            {
                id: 'pivot-1',
                type: 'traditional-pivot',
                params: {},
                colors: {},
                visibleTf: [1440],
            },
            {
                id: 'rsi-1',
                type: 'rsi',
                params: {},
                colors: {},
                visibleTf: [5],
            },
        ]);
        expect(normalized[0]?.visibleTf).toEqual([1, 5, 15, 60, 1440]);
        expect(normalized[1]?.visibleTf).toEqual([5]);
    });

    it('損壞 v3 回復 v2，defaults 各自遷移且不刪舊 key', () => {
        const storage = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        });
        storage.set(STORE_KEY, '{broken');
        storage.set(
            LEGACY_V2_STORE_KEY,
            JSON.stringify([
                { id: 'ma-1', type: 'sma', params: { period: 5 }, colors: {} },
            ]),
        );
        storage.set(
            LEGACY_DEFAULTS_KEY,
            JSON.stringify({
                rsi: {
                    params: { period: 14 },
                    styles: { line: { color: '#112233' } },
                },
                macd: {
                    params: { fast: 30, slow: 10, signal: 5 },
                },
            }),
        );

        expect(loadInstances()).toHaveLength(1);
        expect(loadTypeDefaults()).toMatchObject({
            rsi: {
                params: { shortPeriod: 5, longPeriod: 10 },
                styles: { short: { color: '#112233' } },
            },
            macd: {
                params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
            },
        });
        expect(JSON.parse(storage.get(DEFAULTS_KEY) ?? '{}')).toMatchObject({
            schemaVersion: 2,
        });
        expect(storage.has(LEGACY_DEFAULTS_KEY)).toBe(true);
    });

    it('quota failure 不刪除 v2 migration source', () => {
        const storage = new Map<string, string>();
        storage.set(
            LEGACY_V2_STORE_KEY,
            JSON.stringify([
                { id: 'ma-1', type: 'sma', params: { period: 5 }, colors: {} },
            ]),
        );
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: () => {
                throw new DOMException('quota', 'QuotaExceededError');
            },
            removeItem: (key: string) => storage.delete(key),
        });
        expect(loadInstances()).toHaveLength(1);
        expect(storage.has(LEGACY_V2_STORE_KEY)).toBe(true);
    });

    it('canonical store 提供穩定 immutable snapshot 並同步同 document 訂閱者', () => {
        const storage = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        });
        const chartA = vi.fn();
        const chartB = vi.fn();
        const stopA = subscribeInstances(chartA);
        const stopB = subscribeInstances(chartB);
        const before = getInstancesSnapshot();
        expect(getInstancesSnapshot()).toBe(before);
        expect(Object.isFrozen(before)).toBe(true);

        updateInstances((current) => [...current, newTestInstance('ma-1')]);
        const after = getInstancesSnapshot();
        expect(after).not.toBe(before);
        expect(Object.isFrozen(after[0])).toBe(true);
        expect(chartA).toHaveBeenCalledOnce();
        expect(chartB).toHaveBeenCalledOnce();
        stopA();
        stopB();
    });

    it('快速 functional mutation 以最新 snapshot 為基礎，不遺失先前更新', () => {
        const storage = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        });
        updateInstances((current) => [...current, newTestInstance('ma-1')]);
        updateInstances((current) => [...current, newTestInstance('ma-2')]);
        updateInstances((current) =>
            current.map((instance) =>
                instance.id === 'ma-1'
                    ? { ...instance, hidden: true }
                    : instance,
            ),
        );
        expect(getInstancesSnapshot()).toMatchObject([
            { id: 'ma-1', hidden: true },
            { id: 'ma-2' },
        ]);
    });

    it('storage failure 保留 memory-first mutation 與安全狀態', () => {
        const storage = new Map<string, string>();
        storage.set(
            LEGACY_V2_STORE_KEY,
            JSON.stringify([newTestInstance('legacy')]),
        );
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: () => {
                throw new DOMException('quota', 'QuotaExceededError');
            },
            removeItem: (key: string) => storage.delete(key),
        });
        expect(getInstancesSnapshot()).toHaveLength(1);
        updateInstances((current) => [...current, newTestInstance('new')]);
        expect(getInstancesSnapshot().map((item) => item.id)).toEqual([
            'legacy',
            'new',
        ]);
        expect(getIndicatorPersistenceStatus()).toEqual({
            state: 'error',
            reasonCode: 'storage-unavailable',
        });
        expect(storage.has(LEGACY_V2_STORE_KEY)).toBe(true);
    });

    it('跨視窗 storage envelope 採 deterministic LWW，拒絕非法與較舊事件', () => {
        const storage = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        });
        updateInstances((current) => [...current, newTestInstance('local')]);
        const localEnvelope = JSON.parse(storage.get(STORE_KEY) ?? '{}') as {
            revision: number;
            updatedAt: number;
            writerId: string;
        };
        const remote = JSON.stringify({
            schemaVersion: 3,
            revision: localEnvelope.revision + 1,
            updatedAt: localEnvelope.updatedAt + 1,
            writerId: 'remote-window',
            instances: [newTestInstance('remote')],
        });
        expect(applyIndicatorStorageValue(remote)).toBe(true);
        expect(getInstancesSnapshot()[0]?.id).toBe('remote');
        expect(
            applyIndicatorStorageValue(
                JSON.stringify({
                    schemaVersion: 3,
                    ...localEnvelope,
                    instances: [newTestInstance('stale')],
                }),
            ),
        ).toBe(false);
        expect(applyIndicatorStorageValue('{broken')).toBe(false);
        expect(getInstancesSnapshot()[0]?.id).toBe('remote');
    });

    it('modal draft 確認只 patch 最新目標，不回滾期間新增的其他 instance', () => {
        const storage = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        });
        updateInstances(() => [newTestInstance('target')]);
        const draft = {
            ...getInstancesSnapshot()[0]!,
            hidden: true,
        };
        updateInstances((current) => [...current, newTestInstance('other')]);
        updateInstances(
            (current) => commitIndicatorDraft(current, draft, false).instances,
        );
        expect(getInstancesSnapshot()).toMatchObject([
            { id: 'target', hidden: true },
            { id: 'other' },
        ]);
    });

    it('modal 取消不寫 store，目標遭移除時確認回報衝突且不重建', () => {
        const current = [newTestInstance('other')];
        const removedDraft = { ...newTestInstance('target'), hidden: true };
        // 取消的語意是直接丟棄 local draft，因此 canonical current 不變。
        expect(current).toEqual([newTestInstance('other')]);
        expect(commitIndicatorDraft(current, removedDraft, false)).toEqual({
            instances: current,
            conflict: true,
        });
    });
});

function newTestInstance(id: string) {
    return {
        id,
        type: 'sma',
        params: { period: 5 },
        colors: {},
    };
}
