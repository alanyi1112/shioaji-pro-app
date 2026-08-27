import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TickListener = (tick: { code: string; close: string | number }) => void;

const runtime = vi.hoisted(() => ({
    listeners: [] as TickListener[],
    unsubscribes: [] as ReturnType<typeof vi.fn>[],
    notify: vi.fn(),
    ensureContract: vi.fn(),
    placeQuickOrder: vi.fn(),
}));

vi.mock('./stream', () => ({
    onAnyTick: vi.fn((listener: TickListener) => {
        runtime.listeners.push(listener);
        const unsubscribe = vi.fn();
        runtime.unsubscribes.push(unsubscribe);
        return unsubscribe;
    }),
}));

vi.mock('./contracts-cache', () => ({
    ensureContract: runtime.ensureContract,
}));

vi.mock('./trade', () => ({
    notify: runtime.notify,
    placeQuickOrder: runtime.placeQuickOrder,
}));

function installStorage(seed: unknown[] | null) {
    let raw = seed === null ? null : JSON.stringify(seed);
    const storage = {
        getItem: vi.fn((key: string) =>
            key === 'sj-pro-triggers' ? raw : null,
        ),
        setItem: vi.fn((key: string, value: string) => {
            if (key === 'sj-pro-triggers') raw = value;
        }),
        removeItem: vi.fn(),
        clear: vi.fn(() => {
            raw = null;
        }),
        key: vi.fn(() => null),
        get length() {
            return raw === null ? 0 : 1;
        },
    } satisfies Storage;
    vi.stubGlobal('localStorage', storage);
    return { storage, read: () => raw };
}

describe('legacy trigger alert-only authority', () => {
    beforeEach(() => {
        vi.resetModules();
        runtime.listeners.length = 0;
        runtime.unsubscribes.length = 0;
        runtime.notify.mockReset();
        runtime.ensureContract.mockReset();
        runtime.placeQuickOrder.mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keeps persisted stop/take inventory unchanged and never reaches a broker call', async () => {
        const legacy = [
            {
                id: 'old-stop',
                code: '2330',
                condition: 'below',
                price: 900,
                action: 'Sell',
                quantity: 1,
                kind: 'stop',
                group: 'oco-old',
                unknownLegacyField: 'preserve-me',
            },
            {
                id: 'old-take',
                code: '2330',
                condition: 'above',
                price: 1_100,
                action: 'Sell',
                quantity: 1,
                kind: 'take',
                group: 'oco-old',
            },
            {
                id: 'impure-alert',
                code: '2330',
                condition: 'above',
                price: 700,
                action: 'Buy',
                quantity: 9,
                kind: 'alert',
            },
        ];
        const storage = installStorage(legacy);
        const engine = await import('./trigger-engine');

        expect(engine.LEGACY_TRIGGER_AUTHORITY).toEqual({
            schemaVersion: 'legacy-trigger-authority/2026-08-12.1',
            tradingSender: 'permanently_retired',
            alertRuntime: 'notification_only',
            brokerWriteAuthorized: false,
        });
        expect(Object.isFrozen(engine.LEGACY_TRIGGER_AUTHORITY)).toBe(true);

        engine.startLegacyAlertEngine();
        runtime.listeners[0]?.({ code: '2330', close: 800 });
        runtime.listeners[0]?.({ code: '2330', close: 1_200 });

        expect(runtime.ensureContract).not.toHaveBeenCalled();
        expect(runtime.placeQuickOrder).not.toHaveBeenCalled();
        expect(runtime.notify).not.toHaveBeenCalled();
        expect(engine.getTriggers().map((trigger) => trigger.kind)).toEqual([
            'stop',
            'take',
        ]);
        expect(engine.removeTrigger('old-stop')).toBe(false);
        expect(storage.storage.setItem).not.toHaveBeenCalled();
        expect(storage.read()).toBe(JSON.stringify(legacy));

        engine.stopLegacyAlertEngine();
    });

    it('fails closed for a newly requested legacy stop before persistence or broker work', async () => {
        const storage = installStorage(null);
        const engine = await import('./trigger-engine');
        const unsafeLegacyCall = engine.addTrigger as (value: unknown) => unknown;

        expect(() =>
            unsafeLegacyCall({
                code: '2330',
                condition: 'below',
                price: 900,
                action: 'Sell',
                quantity: 1,
                kind: 'stop',
            }),
        ).toThrowError(engine.LegacyTradingTriggerDisabledError);

        expect(runtime.ensureContract).not.toHaveBeenCalled();
        expect(runtime.placeQuickOrder).not.toHaveBeenCalled();
        expect(runtime.notify).not.toHaveBeenCalled();
        expect(storage.storage.setItem).not.toHaveBeenCalled();
        expect(storage.read()).toBeNull();
    });

    it('still fires and consumes a pure notification alert without trading', async () => {
        const blockedLegacy = {
            id: 'old-stop-to-preserve',
            code: '2330',
            condition: 'below',
            price: 900,
            action: 'Sell',
            quantity: 1,
            kind: 'stop',
            unknownLegacyField: 'preserve-me',
        };
        const storage = installStorage([
            blockedLegacy,
            {
                id: 'alert-1',
                code: '2330',
                condition: 'above',
                price: 1_000,
                action: 'Sell',
                quantity: 0,
                kind: 'alert',
            },
        ]);
        const engine = await import('./trigger-engine');

        engine.startLegacyAlertEngine();
        runtime.listeners[0]?.({ code: '2330', close: 1_001 });

        expect(runtime.notify).toHaveBeenCalledOnce();
        expect(runtime.notify).toHaveBeenCalledWith(
            expect.objectContaining({
                title: '🔔 到價警示',
                body: expect.stringContaining('只通知，不下單'),
            }),
        );
        expect(runtime.ensureContract).not.toHaveBeenCalled();
        expect(runtime.placeQuickOrder).not.toHaveBeenCalled();
        expect(engine.getTriggers().map((trigger) => trigger.kind)).toEqual([
            'stop',
        ]);
        expect(storage.read()).toBe(JSON.stringify([blockedLegacy]));

        engine.stopLegacyAlertEngine();
    });

    it('has one idempotent start/stop authority and invalidates stale listeners', async () => {
        installStorage(null);
        const engine = await import('./trigger-engine');
        engine.addTrigger({
            code: '2330',
            condition: 'above',
            price: 1_000,
            action: 'Sell',
            quantity: 0,
            kind: 'alert',
        });
        runtime.notify.mockClear();

        const stopA = engine.startLegacyAlertEngine();
        const staleListener = runtime.listeners[0];
        const stopB = engine.startLegacyAlertEngine();

        expect(stopA).toBe(stopB);
        expect(runtime.listeners).toHaveLength(1);

        stopA();
        stopB();
        expect(runtime.unsubscribes[0]).toHaveBeenCalledOnce();

        engine.startLegacyAlertEngine();
        expect(runtime.listeners).toHaveLength(2);
        staleListener?.({ code: '2330', close: 1_001 });
        expect(runtime.notify).not.toHaveBeenCalled();
        expect(engine.getTriggers()).toHaveLength(1);

        runtime.listeners[1]?.({ code: '2330', close: 1_001 });
        expect(runtime.notify).toHaveBeenCalledOnce();
        expect(engine.getTriggers()).toHaveLength(0);

        engine.stopLegacyAlertEngine();
        expect(runtime.unsubscribes[1]).toHaveBeenCalledOnce();
    });
});
