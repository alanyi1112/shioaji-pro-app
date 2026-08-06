import { describe, expect, it, vi } from 'vitest';
import {
    openMultiViewWindow,
    probeMultiView,
    resolveMultiViewLauncherUrl,
    resolveMultiViewUrl,
} from './multiview-window';

describe('MultiView window', () => {
    it('預設同步開啟 5173 launcher 並只攜帶合法 5174 target', () => {
        const open = vi.fn(() => null);
        openMultiViewWindow(
            { open } as unknown as Window,
            undefined,
            'http://127.0.0.1:5173',
        );
        expect(open).toHaveBeenCalledWith(
            'http://127.0.0.1:5173/?popout=multiview-launcher&target=http%3A%2F%2F127.0.0.1%3A5174%2F',
            'realtimestock-multiview',
        );
    });

    it('拒絕非 loopback 或錯誤 port 設定', () => {
        expect(resolveMultiViewUrl('https://example.com')).toBe(
            'http://127.0.0.1:5174/',
        );
        expect(resolveMultiViewUrl('http://127.0.0.1:8080')).toBe(
            'http://127.0.0.1:5174/',
        );
    });

    it('拒絕非 loopback launcher origin', () => {
        expect(
            resolveMultiViewLauncherUrl(
                'http://localhost:5174/',
                'https://example.com',
            ),
        ).toBe(
            'http://127.0.0.1:5173/?popout=multiview-launcher&target=http%3A%2F%2Flocalhost%3A5174%2F',
        );
    });

    it('health 與 simulation 可用時回 ready', async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        ok: true,
                        deploymentTarget: 'local',
                        persistence: { d1: true },
                        taiwanStockChip: {},
                        taiwanStockPeRiver: {},
                    }),
                    { status: 200 },
                ),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ simulation: true }), {
                    status: 200,
                }),
            );
        await expect(probeMultiView(undefined, fetcher)).resolves.toMatchObject({
            code: 'ready',
            multiview: 'available',
            shioaji: 'simulation',
        });
    });

    it('5174 無法連線時保守回 unavailable', async () => {
        const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
        await expect(probeMultiView(undefined, fetcher)).resolves.toMatchObject({
            code: 'unavailable',
            reasonCode: 'multiview_unavailable',
        });
    });

    it('Shioaji business session 失敗時顯示延遲 fallback', async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        ok: true,
                        deploymentTarget: 'local',
                        persistence: { d1: true },
                        taiwanStockChip: {},
                        taiwanStockPeRiver: {},
                    }),
                    { status: 200 },
                ),
            )
            .mockResolvedValueOnce(new Response('{}', { status: 502 }));
        await expect(probeMultiView(undefined, fetcher)).resolves.toMatchObject({
            code: 'fallback',
            reasonCode: 'shioaji_business_unavailable',
        });
    });
});
