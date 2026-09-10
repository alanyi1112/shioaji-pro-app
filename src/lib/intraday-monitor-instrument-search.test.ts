import { describe, expect, it, vi } from 'vitest';
import {
    intradayMonitorInstrumentSearchUrl,
    searchIntradayMonitorInstruments,
} from './intraday-monitor-instrument-search';

function response(body: unknown, ok = true, status = 200) {
    return Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response);
}

describe('盤中監控商品搜尋', () => {
    it('只接受台股 EQUITY，保留繁中名稱、代號與市場', async () => {
        const fetchImpl = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => response({
            results: [
                { symbol: '8069.TWO', localizedName: '元太', name: 'E Ink', quoteType: 'EQUITY', score: 950, matchedBy: 'localized-exact' },
                { symbol: '2330.TW', name: '台積電', quoteType: 'EQUITY', score: 550, matchedBy: 'fuzzy' },
                { symbol: 'TXFR1', name: '臺指期', quoteType: 'FUTURE' },
                { symbol: 'AAPL', name: 'Apple', quoteType: 'EQUITY' },
            ],
            warnings: ['tpex_cache_stale'],
        }));
        await expect(searchIntradayMonitorInstruments('元太', {
            fetchImpl,
            multiviewUrl: 'http://127.0.0.1:5174/',
        })).resolves.toEqual({
            items: [
                { code: '8069', symbol: '8069.TWO', name: '元太', exchange: 'OTC', market: 'TPEx', score: 950, matchedBy: 'localized-exact' },
                { code: '2330', symbol: '2330.TW', name: '台積電', exchange: 'TSE', market: 'TWSE', score: 550, matchedBy: 'fuzzy' },
            ],
            warnings: ['tpex_cache_stale'],
        });
        expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('q=%E5%85%83%E5%A4%AA');
    });

    it('建立有界的 loopback MultiView 搜尋網址', () => {
        expect(intradayMonitorInstrumentSearchUrl(' 台積電 ', 99, 'http://localhost:5174/'))
            .toBe('http://localhost:5174/api/instrument-search?q=%E5%8F%B0%E7%A9%8D%E9%9B%BB&limit=20');
    });

    it('拒絕錯誤 response，不把失敗冒充無結果', async () => {
        await expect(searchIntradayMonitorInstruments('聯發科', {
            fetchImpl: vi.fn(() => response({ reason: 'offline' }, false, 503)),
        })).rejects.toThrow('instrument_search_http_503');
    });
});
