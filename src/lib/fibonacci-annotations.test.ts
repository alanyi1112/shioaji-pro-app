import { describe, expect, it, vi } from 'vitest';
import {
    createFibonacciController,
    dispatchFibonacciPointer,
    EXTENSION_LEVELS,
    FIBONACCI_FORMULA_VERSION,
    FIBONACCI_STORAGE_VERSION,
    fibonacciAnchorPriceGuide,
    fibonacciIdentity,
    fibonacciLevelColor,
    fibonacciLevels,
    fibonacciProductIdentity,
    fibonacciStorageKey,
    futureTimeForLogicalPosition,
    resolveFibonacciAnchorPoint,
    RETRACEMENT_LEVELS,
    subscribeFibonacciProductClear,
    type FibonacciStorage,
} from './fibonacci-annotations';

function memoryStorage(initial: Record<string, string> = {}): {
    storage: FibonacciStorage;
    values: Map<string, string>;
} {
    const values = new Map(Object.entries(initial));
    return {
        values,
        storage: {
            get length() {
                return values.size;
            },
            getItem: (key) => values.get(key) ?? null,
            key: (index) => [...values.keys()][index] ?? null,
            setItem: (key, value) => values.set(key, value),
            removeItem: (key) => values.delete(key),
        },
    };
}

describe('MultiChart Fibonacci 公式基準', () => {
    it('鎖定來源版本、比率與六位小數 fixture', () => {
        expect(FIBONACCI_FORMULA_VERSION).toBe(
            'multichart-ecae7ca-fibonacci-v2',
        );
        expect(RETRACEMENT_LEVELS).toEqual([
            -0.62, -0.27, 0, 0.236, 0.382, 0.5, 0.618, 0.705, 0.786, 1,
        ]);
        expect(EXTENSION_LEVELS).toEqual([
            0.618, 0.705, 0.786, 1, 1.272, 1.414, 1.618, 2,
        ]);
        expect(
            fibonacciLevels('retracement', [
                { time: 1, price: 100 },
                { time: 2, price: 200 },
            ]).map((level) => [
                level.ratioText,
                level.percentage,
                Number(level.price.toFixed(6)),
            ]),
        ).toEqual([
            ['-0.62', '-62%', 262],
            ['-0.27', '-27%', 227],
            ['0', '0%', 200],
            ['0.236', '23.6%', 176.4],
            ['0.382', '38.2%', 161.8],
            ['0.5', '50%', 150],
            ['0.618', '61.8%', 138.2],
            ['0.705', '70.5%', 129.5],
            ['0.786', '78.6%', 121.4],
            ['1', '100%', 100],
        ]);
        expect(
            fibonacciLevels('extension', [
                { time: 1, price: 100 },
                { time: 2, price: 200 },
                { time: 3, price: 150 },
            ]).map((level) => Number(level.price.toFixed(6))),
        ).toEqual([211.8, 220.5, 228.6, 250, 277.2, 291.4, 311.8, 350]);
    });

    it('支援下跌、平盤並拒絕非法輸入', () => {
        expect(
            fibonacciLevels('retracement', [
                { time: 1, price: 200 },
                { time: 2, price: 100 },
            ]).map((level) => Number(level.price.toFixed(6))),
        ).toEqual([38, 73, 100, 123.6, 138.2, 150, 161.8, 170.5, 178.6, 200]);
        expect(
            fibonacciLevels('extension', [
                { time: 1, price: 100 },
                { time: 2, price: 100 },
                { time: 3, price: 150 },
            ]).every((level) => level.price === 150),
        ).toBe(true);
        expect(
            fibonacciLevels('retracement', [
                { time: 1, price: Number.NaN },
                { time: 2, price: 100 },
            ]),
        ).toEqual([]);
        expect(
            fibonacciLevels('extension', [
                { time: 1, price: 100 },
                { time: 2, price: 200 },
            ]),
        ).toEqual([]);
    });

    it('新增比率使用固定色且既有比率維持各種類原色', () => {
        expect(fibonacciLevelColor('retracement', -0.62)).toBe('#a78bfa');
        expect(fibonacciLevelColor('retracement', -0.27)).toBe('#e879f9');
        expect(fibonacciLevelColor('extension', -0.27)).toBe('#cbd5e1');
        expect(fibonacciLevelColor('retracement', 0.705)).toBe('#f472b6');
        expect(fibonacciLevelColor('extension', 0.705)).toBe('#f472b6');
        expect(fibonacciLevelColor('retracement', 0.618)).toBe('#2dd4bf');
        expect(fibonacciLevelColor('extension', 0.618)).toBe('#fb7185');
    });
});

describe('Fibonacci 錨點 resolver', () => {
    const candle = {
        time: 10,
        low: 95,
        high: 125,
    };
    const raw = { time: 10, price: 111.23 };

    it('一般操作依序吸附 A low、B high、C low', () => {
        expect(
            resolveFibonacciAnchorPoint(
                { kind: 'retracement', anchors: [] },
                raw,
                candle,
            ),
        ).toEqual({ time: 10, price: 95 });
        expect(
            resolveFibonacciAnchorPoint(
                {
                    kind: 'retracement',
                    anchors: [{ time: 8, price: 90 }],
                },
                raw,
                candle,
            ),
        ).toEqual({ time: 10, price: 125 });
        expect(
            resolveFibonacciAnchorPoint(
                {
                    kind: 'extension',
                    anchors: [
                        { time: 8, price: 90 },
                        { time: 9, price: 120 },
                    ],
                },
                raw,
                candle,
            ),
        ).toEqual({ time: 10, price: 95 });
    });

    it('A/B 空白區無效，C 與 Option/Alt 可使用正規化自由價位', () => {
        const normalizePrice = (price: number) =>
            Number((Math.round(price * 2) / 2).toFixed(2));
        expect(
            resolveFibonacciAnchorPoint(
                { kind: 'retracement', anchors: [] },
                { time: 12, price: 108.23 },
                undefined,
                { normalizePrice },
            ),
        ).toBeNull();
        expect(
            resolveFibonacciAnchorPoint(
                {
                    kind: 'extension',
                    anchors: [
                        { time: 8, price: 90 },
                        { time: 9, price: 120 },
                    ],
                },
                { time: 12, price: 108.23 },
                undefined,
                { normalizePrice },
            ),
        ).toEqual({ time: 12, price: 108 });
        expect(
            resolveFibonacciAnchorPoint(
                { kind: 'retracement', anchors: [] },
                { time: 12, price: 108.26 },
                undefined,
                { freePrice: true, normalizePrice },
            ),
        ).toEqual({ time: 12, price: 108.5 });
    });

    it('未來 logical position 只投影時間，不建立 candle', () => {
        const candles = [{ time: 100 }, { time: 400 }];
        expect(futureTimeForLogicalPosition(3, candles, 5)).toBe(1000);
        expect(futureTimeForLogicalPosition(0, candles, 5)).toBe(100);
        expect(futureTimeForLogicalPosition(Number.NaN, candles, 5)).toBeUndefined();
        expect(futureTimeForLogicalPosition(2, [], 5)).toBeUndefined();
    });
});

describe('Fibonacci controller 與 storage', () => {
    const identity = fibonacciIdentity({
        securityType: 'STK',
        exchange: 'TSE',
        canonicalCode: '2330',
        timeframeMinutes: 5,
    });

    it('identity 與 storage key 不包含帳戶或行情內容', () => {
        expect(identity).toBe('STK|TSE|2330|5');
        expect(fibonacciStorageKey(identity)).toBe(
            'realtimestock.fibonacci.v1.STK%7CTSE%7C2330%7C5',
        );
        expect(fibonacciProductIdentity(identity)).toBe('STK|TSE|2330');
        expect(
            fibonacciIdentity({
                securityType: null,
                exchange: null,
                canonicalCode: '',
                timeframeMinutes: 5,
            }),
        ).toBe('');
    });

    it('支援 arm、preview、剩餘點數、完成與 immutable snapshot', () => {
        const { storage, values } = memoryStorage();
        const onChange = vi.fn();
        const controller = createFibonacciController({
            getIdentity: () => identity,
            storage,
            onChange,
        });
        controller.restore();
        controller.arm('retracement');
        controller.previewPoint({ time: 1, price: 100 });
        const pending = controller.getSnapshot().pending;
        expect(pending?.remaining).toBe(2);
        expect(fibonacciAnchorPriceGuide(pending)).toEqual({
            anchorLabel: 'A',
            point: { time: 1, price: 100 },
        });
        pending!.anchors.push({ time: 99, price: 99 });
        expect(controller.getSnapshot().pending?.anchors).toEqual([]);
        expect(controller.addPoint({ time: 1, price: 100 })).toEqual({
            completed: false,
            remaining: 1,
        });
        controller.previewPoint({ time: 2, price: 123.5 });
        const guide = fibonacciAnchorPriceGuide(controller.getSnapshot().pending);
        expect(guide?.anchorLabel).toBe('B');
        expect(controller.addPoint(guide!.point)).toEqual({ completed: true });
        expect(controller.getSnapshot().completed[0]?.anchors[1]?.price).toBe(
            123.5,
        );
        expect(controller.getSnapshot().status).toBe('idle');
        expect(values.size).toBe(1);
        expect(onChange).toHaveBeenCalled();
    });

    it('回撤與拓展各一張，重畫同類後 order 與角色互換', () => {
        const { storage } = memoryStorage();
        const controller = createFibonacciController({
            getIdentity: () => identity,
            storage,
        });
        controller.restore();
        controller.arm('retracement');
        controller.addPoint({ time: 1, price: 100 });
        controller.addPoint({ time: 2, price: 200 });
        controller.arm('extension');
        controller.addPoint({ time: 3, price: 110 });
        controller.addPoint({ time: 4, price: 210 });
        controller.addPoint({ time: 5, price: 150 });
        expect(
            controller
                .getSnapshot()
                .completed.map(({ kind, order, role }) => ({ kind, order, role })),
        ).toEqual([
            { kind: 'retracement', order: 1, role: 'primary' },
            { kind: 'extension', order: 2, role: 'secondary' },
        ]);
        controller.arm('retracement');
        controller.addPoint({ time: 6, price: 120 });
        controller.addPoint({ time: 7, price: 220 });
        expect(
            controller
                .getSnapshot()
                .completed.map(({ kind, order, role }) => ({ kind, order, role })),
        ).toEqual([
            { kind: 'extension', order: 2, role: 'primary' },
            { kind: 'retracement', order: 3, role: 'secondary' },
        ]);
        controller.clear('retracement');
        expect(controller.getSnapshot().completed).toHaveLength(1);
        expect(controller.getSnapshot().completed[0]?.role).toBe('primary');
        controller.clear('all');
        expect(controller.getSnapshot().completed).toEqual([]);
    });

    it('只保存 completed，cancel 與 pending 不寫入 storage', () => {
        const { storage, values } = memoryStorage();
        const controller = createFibonacciController({
            getIdentity: () => identity,
            storage,
        });
        controller.restore();
        controller.arm('extension');
        controller.previewPoint({ time: 1, price: 100 });
        expect(values.size).toBe(0);
        expect(controller.cancel()).toBe(true);
        expect(values.size).toBe(0);
        expect(controller.cancel()).toBe(false);
    });

    it('reload 與換 identity 只還原各自 completed', () => {
        const { storage } = memoryStorage();
        let currentIdentity = identity;
        const first = createFibonacciController({
            getIdentity: () => currentIdentity,
            storage,
        });
        first.restore();
        first.arm('retracement');
        first.addPoint({ time: 1, price: 100 });
        first.addPoint({ time: 2, price: 200 });

        const reloaded = createFibonacciController({
            getIdentity: () => currentIdentity,
            storage,
        });
        expect(reloaded.restore().completed).toHaveLength(1);
        currentIdentity = 'STK|OTC|6488|5';
        expect(reloaded.restore().completed).toEqual([]);
        reloaded.arm('extension');
        reloaded.addPoint({ time: 1, price: 50 });
        reloaded.addPoint({ time: 2, price: 80 });
        reloaded.addPoint({ time: 3, price: 60 });
        currentIdentity = identity;
        expect(reloaded.restore().completed[0]?.kind).toBe('retracement');
    });

    it('v1 anchors 會保留並依種類遷移為 v2 水準', () => {
        const key = fibonacciStorageKey(identity);
        const { storage, values } = memoryStorage({
            [key]: JSON.stringify({
                version: FIBONACCI_STORAGE_VERSION,
                formulaVersion: 'multichart-ecae7ca-fibonacci-v1',
                completed: [
                    {
                        kind: 'retracement',
                        anchors: [
                            { time: 1, price: 100 },
                            { time: 2, price: 200 },
                        ],
                        order: 1,
                    },
                ],
            }),
        });
        const controller = createFibonacciController({
            getIdentity: () => identity,
            storage,
        });
        expect(controller.restore().completed[0]?.levels).toHaveLength(10);
        expect(JSON.parse(values.get(key)!).formulaVersion).toBe(
            FIBONACCI_FORMULA_VERSION,
        );
    });

    it('全部清除只移除目前商品所有 timeframe 並保留其他商品', () => {
        const sameProduct60 = 'STK|TSE|2330|60';
        const otherProduct = 'STK|TSE|2317|5';
        const completedPayload = (formulaVersion = FIBONACCI_FORMULA_VERSION) =>
            JSON.stringify({
                version: FIBONACCI_STORAGE_VERSION,
                formulaVersion,
                completed: [
                    {
                        kind: 'retracement',
                        anchors: [
                            { time: 1, price: 100 },
                            { time: 2, price: 200 },
                        ],
                        order: 1,
                    },
                ],
            });
        const { storage, values } = memoryStorage({
            [fibonacciStorageKey(identity)]: completedPayload(),
            [fibonacciStorageKey(sameProduct60)]: completedPayload(),
            [fibonacciStorageKey(otherProduct)]: completedPayload(),
        });
        const controller = createFibonacciController({
            getIdentity: () => identity,
            storage,
        });
        controller.restore();
        controller.clear('all');
        expect(values.has(fibonacciStorageKey(identity))).toBe(false);
        expect(values.has(fibonacciStorageKey(sameProduct60))).toBe(false);
        expect(values.has(fibonacciStorageKey(otherProduct))).toBe(true);
        expect(controller.getSnapshot().completed).toEqual([]);
    });

    it('同頁相同商品 controller 同步全部清除且不同商品不受影響', () => {
        const { storage } = memoryStorage();
        const sameProductIdentity = 'STK|TSE|2330|60';
        const otherProductIdentity = 'STK|TSE|2317|5';
        const first = createFibonacciController({
            getIdentity: () => identity,
            storage,
        });
        const sameProduct = createFibonacciController({
            getIdentity: () => sameProductIdentity,
            storage,
        });
        const otherProduct = createFibonacciController({
            getIdentity: () => otherProductIdentity,
            storage,
        });
        for (const controller of [first, sameProduct, otherProduct]) {
            controller.restore();
            controller.arm('retracement');
            controller.addPoint({ time: 1, price: 100 });
            controller.addPoint({ time: 2, price: 200 });
        }
        const unsubscribe = subscribeFibonacciProductClear((productIdentity) => {
            sameProduct.applyProductClear(productIdentity);
            otherProduct.applyProductClear(productIdentity);
        });
        first.clear('all');
        unsubscribe();
        expect(sameProduct.getSnapshot().completed).toEqual([]);
        expect(otherProduct.getSnapshot().completed).toHaveLength(1);
    });

    it('損毀版本、非法 anchors 與同類重複安全正規化', () => {
        const key = fibonacciStorageKey(identity);
        const { storage, values } = memoryStorage({
            [key]: JSON.stringify({
                version: FIBONACCI_STORAGE_VERSION,
                formulaVersion: FIBONACCI_FORMULA_VERSION,
                completed: [
                    {
                        kind: 'retracement',
                        anchors: [
                            { time: 1, price: 100 },
                            { time: 2, price: 200 },
                        ],
                        order: 1,
                    },
                    {
                        kind: 'retracement',
                        anchors: [
                            { time: 3, price: 110 },
                            { time: 4, price: 210 },
                        ],
                        order: 2,
                    },
                    {
                        kind: 'extension',
                        anchors: [{ time: 3, price: Number.POSITIVE_INFINITY }],
                        order: 3,
                    },
                ],
            }),
        });
        const controller = createFibonacciController({
            getIdentity: () => identity,
            storage,
        });
        expect(controller.restore().completed).toMatchObject([
            { kind: 'retracement', order: 2 },
        ]);
        values.set(key, JSON.stringify({ version: 999, completed: [] }));
        const invalid = createFibonacciController({
            getIdentity: () => identity,
            storage,
        });
        expect(invalid.restore().persistence).toEqual({
            state: 'error',
            reasonCode: 'storage-invalid',
        });
        expect(values.has(key)).toBe(false);
    });

    it('quota 失敗保留 session memory 且只暴露安全 reason code', () => {
        const values = new Map<string, string>();
        const storage: FibonacciStorage = {
            getItem: (key) => values.get(key) ?? null,
            setItem: () => {
                throw new Error('secret raw payload must stay private');
            },
            removeItem: (key) => values.delete(key),
        };
        const controller = createFibonacciController({
            getIdentity: () => identity,
            storage,
        });
        controller.restore();
        controller.arm('retracement');
        controller.addPoint({ time: 1, price: 100 });
        controller.addPoint({ time: 2, price: 200 });
        expect(controller.getSnapshot().persistence).toEqual({
            state: 'error',
            reasonCode: 'storage-write-failed',
        });
        expect(controller.restore().completed).toHaveLength(1);
        expect(JSON.stringify(controller.getSnapshot())).not.toContain('secret');
    });

    it('pending pointer move/click 被 controller 消耗且不呼叫交易 fallback', () => {
        const { storage } = memoryStorage();
        const controller = createFibonacciController({
            getIdentity: () => identity,
            storage,
        });
        const setPickedPrice = vi.fn();
        const placeQuickOrder = vi.fn();
        const addTrigger = vi.fn();
        const fallback = () => {
            setPickedPrice();
            placeQuickOrder();
            addTrigger();
        };
        controller.restore();
        controller.arm('retracement');
        expect(
            dispatchFibonacciPointer(
                controller,
                'move',
                { time: 1, price: 100 },
                fallback,
            ),
        ).toEqual({ consumed: true });
        expect(
            dispatchFibonacciPointer(
                controller,
                'click',
                { time: 1, price: 100 },
                fallback,
            ),
        ).toEqual({ consumed: true, completed: false, remaining: 1 });
        expect(setPickedPrice).not.toHaveBeenCalled();
        expect(placeQuickOrder).not.toHaveBeenCalled();
        expect(addTrigger).not.toHaveBeenCalled();
        controller.cancel();
        expect(
            dispatchFibonacciPointer(controller, 'move', null, fallback),
        ).toEqual({ consumed: false });
        expect(setPickedPrice).toHaveBeenCalledOnce();
        expect(placeQuickOrder).toHaveBeenCalledOnce();
        expect(addTrigger).toHaveBeenCalledOnce();
    });

    for (const panelCount of [1, 2, 4, 8]) {
        it(`${panelCount} 圖 controller 依商品與時框 identity 隔離`, () => {
            const { storage, values } = memoryStorage();
            const controllers = Array.from({ length: panelCount }, (_, index) => {
                const panelIdentity = fibonacciIdentity({
                    securityType: index % 2 === 0 ? 'STK' : 'IND',
                    exchange: index % 2 === 0 ? 'TSE' : 'TAIFEX',
                    canonicalCode: index % 2 === 0 ? `23${30 + index}` : `IX00${index}`,
                    timeframeMinutes: index % 3 === 0 ? 1 : index % 3 === 1 ? 5 : 60,
                });
                const instance = createFibonacciController({
                    getIdentity: () => panelIdentity,
                    storage,
                });
                instance.restore();
                instance.arm(index % 2 === 0 ? 'retracement' : 'extension');
                instance.addPoint({ time: 10, price: 100 + index });
                instance.addPoint({ time: 20, price: 200 + index });
                if (index % 2 === 1) {
                    instance.addPoint({ time: 30, price: 150 + index });
                }
                return { panelIdentity, instance };
            });
            expect(new Set(controllers.map(({ panelIdentity }) => panelIdentity)).size).toBe(
                panelCount,
            );
            expect(values.size).toBe(panelCount);
            controllers.forEach(({ panelIdentity, instance }) => {
                expect(instance.getSnapshot().identity).toBe(panelIdentity);
                expect(instance.getSnapshot().completed).toHaveLength(1);
            });
        });
    }
});
