import { describe, expect, it, vi } from 'vitest';
import {
    decodeMultiViewMonitorImportLists,
    multiViewMonitorImportUrl,
    readMultiViewMonitorImportLists,
} from './intraday-monitor-multiview-watchlists';

const fixture = {
    managedTabs: [
        { tabKey: 'system:taiwan-stocks', id: 'taiwan-stocks', label: '台股', displayLabel: '台股', enabled: true, defaultSymbols: ['2330.TW', 'AAPL'] },
        { tabKey: 'personal:mine', id: 'mine', label: '舊名稱', displayLabel: '追蹤觀察', enabled: true, defaultSymbols: ['8069.TWO', '2454.TW'] },
        { tabKey: 'system:us-stocks', id: 'us-stocks', label: '美股', enabled: true, defaultSymbols: ['AAPL'] },
    ],
    instruments: [
        { symbol: '2330.TW', name: '台積電', tab: '台股', tabId: '', enabled: true, defaultOrder: 2 },
        { symbol: '8069.TWO', name: '元太', tab: '舊名稱', tabId: 'mine', enabled: true, defaultOrder: 2 },
        { symbol: '2454.TW', name: '聯發科', tab: '追蹤觀察', tabId: 'mine', enabled: true, defaultOrder: 1 },
        { symbol: 'AAPL', name: 'Apple', tab: '美股', tabId: '', enabled: true, defaultOrder: 1 },
        { symbol: '2603.TW', name: '長榮', tab: '台股', tabId: '', enabled: false, defaultOrder: 1 },
    ],
};

describe('MultiView 我的清單盤中監控匯入', () => {
    it('依頁籤順序分組且只保留可交由 Shioaji 驗證的台股代碼', () => {
        expect(decodeMultiViewMonitorImportLists(fixture)).toEqual([
            {
                id: 'system:taiwan-stocks', name: '台股', enabled: true,
                items: [{ code: '2330', symbol: '2330.TW', name: '台積電', exchange: 'TSE' }],
            },
            {
                id: 'personal:mine', name: '追蹤觀察', enabled: true,
                items: [
                    { code: '2454', symbol: '2454.TW', name: '聯發科', exchange: 'TSE' },
                    { code: '8069', symbol: '8069.TWO', name: '元太', exchange: 'OTC' },
                ],
            },
        ]);
    });

    it('固定呼叫 loopback 5174 的唯讀模式', () => {
        expect(multiViewMonitorImportUrl('https://example.com/unsafe')).toBe(
            'http://127.0.0.1:5174/api/instruments?mode=read-only&purpose=intraday-monitor-import',
        );
    });

    it('HTTP 失敗不會被誤判成空清單', async () => {
        const fetchImpl = vi.fn(async () => new Response('{}', { status: 503 }));
        await expect(readMultiViewMonitorImportLists({ fetchImpl })).rejects.toThrow('multiview_watchlists_http_503');
    });
});
