import { describe, expect, it, vi } from 'vitest';
import { notifySmartOrderAuthorizationRequired } from './authorization-required-notifier.mjs';

describe('smart-order authorization-required notifier', () => {
    it('plays exactly one bundled macOS sound without a shell', () => {
        const child = {
            once: vi.fn(),
            unref: vi.fn(),
        };
        const spawnImpl = vi.fn(() => child);

        expect(
            notifySmartOrderAuthorizationRequired({
                platform: 'darwin',
                spawnImpl,
                testRun: false,
            }),
        ).toBe(true);
        expect(spawnImpl).toHaveBeenCalledTimes(1);
        expect(spawnImpl).toHaveBeenCalledWith(
            '/usr/bin/afplay',
            ['/System/Library/Sounds/Glass.aiff'],
            { detached: true, stdio: 'ignore' },
        );
        expect(child.unref).toHaveBeenCalledTimes(1);
    });

    it('is a no-op on unsupported platforms and fails closed silently', () => {
        const spawnImpl = vi.fn();
        expect(
            notifySmartOrderAuthorizationRequired({
                platform: 'linux',
                spawnImpl,
                testRun: false,
            }),
        ).toBe(false);
        expect(spawnImpl).not.toHaveBeenCalled();
        expect(
            notifySmartOrderAuthorizationRequired({
                platform: 'darwin',
                testRun: false,
                spawnImpl: () => {
                    throw new Error('unavailable');
                },
            }),
        ).toBe(false);
    });
});
