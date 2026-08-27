import path from 'node:path';
import { describe, expect, it } from 'vitest';
import viteConfig, {
    isSmartOrderSidecarOnlyModule,
    smartOrderSidecarOnlyBoundary,
} from './vite.config';

const projectRoot = path.resolve(import.meta.dirname);

describe('smart-order Node sidecar browser boundary', () => {
    it.each([
        'smart-order-domain.ts',
        'smart-order-domain-calendar.ts',
        'smart-order-domain-atr.ts',
        'smart-order-risk-domain.ts',
        'smart-order-resolution-domain.ts',
        'smart-order-activation-domain.ts',
        'smart-order-observation-domain.ts',
        'smart-order-state-machine.ts',
    ])('classifies %s as sidecar-only', (fileName) => {
        const sourcePath = path.join(projectRoot, 'src/lib', fileName);
        expect(isSmartOrderSidecarOnlyModule(sourcePath)).toBe(true);
        expect(isSmartOrderSidecarOnlyModule(`${sourcePath}?v=browser`)).toBe(
            true,
        );
    });

    it('does not block browser-safe application or test modules', () => {
        expect(
            isSmartOrderSidecarOnlyModule(
                path.join(projectRoot, 'src/lib/runtime-mode-shared.ts'),
            ),
        ).toBe(false);
        expect(
            isSmartOrderSidecarOnlyModule(
                path.join(
                    projectRoot,
                    'src/lib/smart-order-domain-calendar.test.ts',
                ),
            ),
        ).toBe(false);
    });

    it('enables the boundary and disables issuer seams for every build mode', async () => {
        if (typeof viteConfig !== 'function') {
            throw new Error('Expected the Vite config to be a factory');
        }
        const config = await viteConfig({
            command: 'build',
            mode: 'test',
            isSsrBuild: false,
            isPreview: false,
        });
        expect(
            (config.resolve?.alias as Record<string, string>)[
                './smart-order-domain-test-mode'
            ],
        ).toBe(
            path.join(
                projectRoot,
                'src/lib/smart-order-domain-test-mode.ts',
            ),
        );
        expect(
            (config.resolve?.alias as Record<string, string>)[
                './smart-order-browser-gateway-mode'
            ],
        ).toBe(
            path.join(
                projectRoot,
                'src/lib/smart-order-browser-gateway-mode.ts',
            ),
        );
        expect(
            (config.plugins ?? [])
                .flat(Number.POSITIVE_INFINITY)
                .map((plugin) =>
                    plugin && typeof plugin === 'object'
                        ? plugin.name
                        : undefined,
                ),
        ).toContain('smart-order-sidecar-only-boundary');
    });

    it('only enables the browser control plane for managed local Vite serve', async () => {
        if (typeof viteConfig !== 'function') {
            throw new Error('Expected the Vite config to be a factory');
        }
        const serveConfig = await viteConfig({
            command: 'serve',
            mode: 'development',
            isSsrBuild: false,
            isPreview: false,
        });
        expect(
            (serveConfig.resolve?.alias as Record<string, string>)[
                './smart-order-browser-gateway-mode'
            ],
        ).toBe(
            path.join(
                projectRoot,
                'src/lib/smart-order-browser-gateway-mode.vite.ts',
            ),
        );
        expect(
            (serveConfig.plugins ?? [])
                .flat(Number.POSITIVE_INFINITY)
                .map((plugin) =>
                    plugin && typeof plugin === 'object'
                        ? plugin.name
                        : undefined,
                ),
        ).toContain('realtimestock-smart-order-same-origin-gateway');
    });

    it('keeps the packaged and static browser control plane fail closed', async () => {
        if (typeof viteConfig !== 'function') {
            throw new Error('Expected the Vite config to be a factory');
        }
        const previewConfig = await viteConfig({
            command: 'serve',
            mode: 'production',
            isSsrBuild: false,
            isPreview: true,
        });
        expect(
            (previewConfig.resolve?.alias as Record<string, string>)[
                './smart-order-browser-gateway-mode'
            ],
        ).toBe(
            path.join(
                projectRoot,
                'src/lib/smart-order-browser-gateway-mode.ts',
            ),
        );
        expect(
            (previewConfig.plugins ?? [])
                .flat(Number.POSITIVE_INFINITY)
                .map((plugin) =>
                    plugin && typeof plugin === 'object'
                        ? plugin.name
                        : undefined,
                ),
        ).not.toContain('realtimestock-smart-order-same-origin-gateway');
        const packagedMode = await import(
            './src/lib/smart-order-browser-gateway-mode.ts?packaged-probe'
        );
        expect(packagedMode.SMART_ORDER_BROWSER_GATEWAY_AVAILABLE).toBe(false);
        const localViteMode = await import(
            './src/lib/smart-order-browser-gateway-mode.vite.ts?serve-probe'
        );
        expect(localViteMode.SMART_ORDER_BROWSER_GATEWAY_AVAILABLE).toBe(true);
    });

    it('fails the build before loading a sidecar-only module', async () => {
        const plugin = smartOrderSidecarOnlyBoundary();
        if (typeof plugin.load !== 'function') {
            throw new Error('Expected a load hook on the boundary plugin');
        }
        const sidecarPath = path.join(
            projectRoot,
            'src/lib/smart-order-domain-atr.ts',
        );
        expect(() =>
            plugin.load.call(
                {
                    error(message: unknown) {
                        throw new Error(String(message));
                    },
                } as never,
                sidecarPath,
                { ssr: false },
            ),
        ).toThrow('只能由 Node sidecar 載入');
    });

    it('keeps the real test-mode module false even when a global is injected', async () => {
        Object.defineProperty(globalThis, '__SMART_ORDER_DOMAIN_TEST__', {
            configurable: true,
            value: true,
        });
        const productionMode = await import(
            './src/lib/smart-order-domain-test-mode.ts?production-probe'
        );
        expect(productionMode.SMART_ORDER_DOMAIN_TEST_MODE).toBe(false);
        delete (globalThis as Record<string, unknown>).__SMART_ORDER_DOMAIN_TEST__;
    });
});
