import { describe, expect, it, vi } from 'vitest';
import { openMultiViewWindow, resolveMultiViewUrl } from './multiview-window';

describe('MultiView window', () => {
    it('預設只開啟 127.0.0.1:5174', () => {
        const open = vi.fn(() => null);
        openMultiViewWindow({ open } as unknown as Window, undefined);
        expect(open).toHaveBeenCalledWith(
            'http://127.0.0.1:5174/',
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
});
