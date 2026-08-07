import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    BUSINESS_SESSION_PROBE_INTERVAL_MS,
    createBusinessSessionMonitor,
} from './business-session-monitor';
import type { RuntimeMode } from './runtime-mode-shared';

function createHarness(probe: () => Promise<void>) {
    let mode: RuntimeMode = 'simulation';
    let modeListener: (() => void) | null = null;
    const monitor = createBusinessSessionMonitor({
        getMode: () => mode,
        subscribeMode: (listener) => {
            modeListener = listener;
            return () => {
                modeListener = null;
            };
        },
        probe,
        now: () => Date.now(),
        setInterval: (callback, delay) => setInterval(callback, delay),
        clearInterval: (timer) =>
            clearInterval(timer as ReturnType<typeof setInterval>),
    });
    return {
        monitor,
        setMode(next: RuntimeMode) {
            mode = next;
            modeListener?.();
        },
    };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('business session monitor', () => {
    it('以單一低頻 business probe 運作，不依賴 SSE 或 Tick', async () => {
        vi.useFakeTimers();
        const probe = vi.fn().mockResolvedValue(undefined);
        const { monitor } = createHarness(probe);

        monitor.start();
        await vi.runAllTicks();
        expect(probe).toHaveBeenCalledTimes(1);
        expect(monitor.getSnapshot().status).toBe('available');

        await vi.advanceTimersByTimeAsync(
            BUSINESS_SESSION_PROBE_INTERVAL_MS,
        );
        expect(probe).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(1);
        monitor.stop();
    });

    it('精確分類 SSE 仍可存在時的 SessionNotEstablished', async () => {
        const probe = vi
            .fn()
            .mockRejectedValue(new Error('SessionNotEstablished'));
        const { monitor } = createHarness(probe);

        await monitor.check();

        expect(monitor.getSnapshot().status).toBe(
            'session-unavailable',
        );
    });

    it('generic failure 保持 unavailable，下一次成功可恢復', async () => {
        const probe = vi
            .fn()
            .mockRejectedValueOnce(new Error('fetch failed'))
            .mockResolvedValue(undefined);
        const { monitor } = createHarness(probe);

        await monitor.check();
        expect(monitor.getSnapshot().status).toBe('unavailable');
        await monitor.check();
        expect(monitor.getSnapshot().status).toBe('available');
    });

    it('非 simulation 不送 business probe，切回後才檢查', async () => {
        const probe = vi.fn().mockResolvedValue(undefined);
        const harness = createHarness(probe);
        harness.setMode('production-readonly');

        harness.monitor.start();
        await Promise.resolve();
        expect(probe).not.toHaveBeenCalled();
        expect(harness.monitor.getSnapshot().status).toBe('idle');

        harness.setMode('simulation');
        await Promise.resolve();
        await Promise.resolve();
        expect(probe).toHaveBeenCalledTimes(1);
        expect(harness.monitor.getSnapshot().status).toBe('available');
        harness.monitor.stop();
    });

    it('同一時間只允許一個 probe', async () => {
        let resolveProbe!: () => void;
        const probe = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    resolveProbe = resolve;
                }),
        );
        const { monitor } = createHarness(probe);

        const first = monitor.check();
        const second = monitor.check();
        expect(probe).toHaveBeenCalledTimes(1);
        expect(first).toBe(second);
        resolveProbe();
        await first;
        expect(monitor.getSnapshot().status).toBe('available');
    });
});
