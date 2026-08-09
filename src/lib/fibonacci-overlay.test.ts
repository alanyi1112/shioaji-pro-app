import { describe, expect, it, vi } from 'vitest';
import {
    createFibonacciController,
    fibonacciIdentity,
} from './fibonacci-annotations';
import {
    buildFibonacciOverlayModel,
    completedExtensionAutoscaleBounds,
    LatestAnimationFrameScheduler,
} from './fibonacci-overlay';

const identity = fibonacciIdentity({
    securityType: 'STK',
    exchange: 'TSE',
    canonicalCode: '2330',
    timeframeMinutes: 5,
});

function controller() {
    const values = new Map<string, string>();
    const instance = createFibonacciController({
        getIdentity: () => identity,
        storage: {
            getItem: (key) => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, value),
            removeItem: (key) => values.delete(key),
        },
    });
    instance.restore();
    return instance;
}

const coordinates = {
    timeToCoordinate: (time: number) => time * 10,
    priceToCoordinate: (price: number) => 400 - price,
};

const renderOptions = {
    width: 500,
    height: 400,
    rightEdge: 440,
    coordinates,
    formatPrice: (price: number) => price.toFixed(2),
};

describe('Fibonacci overlay model', () => {
    it('第一張九個色帶、第二張單色且沒有第二組 band', () => {
        const instance = controller();
        instance.arm('retracement');
        instance.addPoint({ time: 10, price: 100 });
        instance.addPoint({ time: 20, price: 200 });
        instance.arm('extension');
        instance.addPoint({ time: 12, price: 110 });
        instance.addPoint({ time: 22, price: 210 });
        instance.addPoint({ time: 26, price: 150 });
        const model = buildFibonacciOverlayModel(
            instance.getSnapshot(),
            renderOptions,
        );
        expect(model.bands).toHaveLength(9);
        expect(new Set(model.bands.map((band) => band.color)).size).toBe(9);
        const extensionLines = model.lines.filter((line) =>
            line.key.includes('completed-extension'),
        );
        expect(
            extensionLines.filter((line) => line.kind === 'level'),
        ).toHaveLength(8);
        expect(
            extensionLines
                .filter((line) => line.kind === 'level')
                .every((line) => line.color === '#cbd5e1'),
        ).toBe(true);
        expect(model.labels.some((label) => label.text === '0.5 (150.00)')).toBe(
            true,
        );
    });

    it('水準線距小於半個像素時仍保留九個色帶', () => {
        const instance = controller();
        instance.arm('retracement');
        instance.addPoint({ time: 10, price: 100 });
        instance.addPoint({ time: 20, price: 100.1 });
        const model = buildFibonacciOverlayModel(instance.getSnapshot(), {
            ...renderOptions,
            coordinates: {
                ...coordinates,
                priceToCoordinate: (price: number) =>
                    150 - (price - 100),
            },
        });
        expect(model.lines.filter((line) => line.kind === 'level')).toHaveLength(
            10,
        );
        expect(model.bands).toHaveLength(9);
        expect(model.bands.every((band) => band.height > 0)).toBe(true);
    });

    it('pending 顯示小十字與價位導引，不建立 autoscale 或第二圖 band', () => {
        const instance = controller();
        instance.arm('retracement');
        instance.addPoint({ time: 10, price: 100 });
        instance.addPoint({ time: 20, price: 200 });
        instance.arm('extension');
        instance.addPoint({ time: 12, price: 110 });
        instance.addPoint({ time: 22, price: 210 });
        instance.previewPoint({ time: 26, price: 150 });
        const snapshot = instance.getSnapshot();
        const model = buildFibonacciOverlayModel(snapshot, renderOptions);
        expect(model.bands).toHaveLength(9);
        expect(model.anchors.filter((anchor) => anchor.preview)).toHaveLength(1);
        expect(
            model.lines.find((line) => line.kind === 'pending-price-guide'),
        ).toMatchObject({ x1: 0, x2: 440, color: '#38bdf8' });
        expect(model.labels.find((label) => label.pendingGuide)?.text).toBe(
            '待選 C｜150.00',
        );
        expect(completedExtensionAutoscaleBounds(snapshot)).toEqual({
            signature: '{"lower":[],"upper":[]}',
            lower: [],
            upper: [],
        });
    });

    it('completed extension 只用 B/C 時間提供最低與最高界線', () => {
        const instance = controller();
        instance.arm('extension');
        instance.addPoint({ time: 10, price: 100 });
        instance.addPoint({ time: 20, price: 200 });
        instance.addPoint({ time: 30, price: 150 });
        const bounds = completedExtensionAutoscaleBounds(instance.getSnapshot());
        expect(bounds.lower).toEqual([
            { time: 20, value: 211.8 },
            { time: 30, value: 211.8 },
        ]);
        expect(bounds.upper).toEqual([
            { time: 20, value: 350 },
            { time: 30, value: 350 },
        ]);
    });

    it('第一張為拓展時顯示八條彩色線與七個色帶', () => {
        const instance = controller();
        instance.arm('extension');
        instance.addPoint({ time: 10, price: 100 });
        instance.addPoint({ time: 20, price: 200 });
        instance.addPoint({ time: 30, price: 150 });
        const model = buildFibonacciOverlayModel(
            instance.getSnapshot(),
            renderOptions,
        );
        expect(model.lines.filter((line) => line.kind === 'level')).toHaveLength(
            8,
        );
        expect(model.bands).toHaveLength(7);
        expect(model.labels.some((label) => label.text.startsWith('-0.'))).toBe(
            false,
        );
    });

    it('畫面空間不足時標籤移入線內且不越過價格軸安全邊界', () => {
        const instance = controller();
        instance.arm('retracement');
        instance.addPoint({ time: 1, price: 100 });
        instance.addPoint({ time: 2, price: 200 });
        const model = buildFibonacciOverlayModel(instance.getSnapshot(), {
            ...renderOptions,
            rightEdge: 120,
        });
        expect(model.lines.filter((line) => line.kind === 'level')).toHaveLength(10);
        expect(model.lines.every((line) => line.x2 <= 120)).toBe(true);
        expect(model.labels.every((label) => label.anchor === 'start')).toBe(true);
    });
});

describe('LatestAnimationFrameScheduler', () => {
    it('同一 frame 只執行最新工作', () => {
        let callback: FrameRequestCallback | undefined;
        const scheduler = new LatestAnimationFrameScheduler(
            (job) => {
                callback = job;
                return 7;
            },
            vi.fn(),
        );
        const first = vi.fn();
        const latest = vi.fn();
        scheduler.schedule(first);
        scheduler.schedule(latest);
        callback?.(0);
        expect(first).not.toHaveBeenCalled();
        expect(latest).toHaveBeenCalledOnce();
    });

    it('invalidate 取消舊 generation', () => {
        let callback: FrameRequestCallback | undefined;
        const cancel = vi.fn();
        const scheduler = new LatestAnimationFrameScheduler(
            (job) => {
                callback = job;
                return 11;
            },
            cancel,
        );
        const job = vi.fn();
        scheduler.schedule(job);
        scheduler.invalidate();
        callback?.(0);
        expect(cancel).toHaveBeenCalledWith(11);
        expect(job).not.toHaveBeenCalled();
        expect(scheduler.hasPendingJob()).toBe(false);
    });
});
