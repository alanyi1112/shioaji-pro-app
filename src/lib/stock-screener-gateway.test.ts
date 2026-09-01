import { describe, expect, it, vi } from 'vitest';
import { stockScreenerGateway, validateScreenerGatewayRequest } from '../../scripts/stock-screener-gateway.mjs';

const req = { url: '/api/stock-screener/results', method: 'GET', headers: { host: '127.0.0.1:5173' } };
describe('選股 allowlist 不接觸 broker', () => {
    it('固定 loopback，不接受 URL／未知路徑／寫入／跨站／重複參數', () => {
        expect(validateScreenerGatewayRequest(req)?.url).toBe('http://127.0.0.1:5174/api/stock-screener/results');
        expect(validateScreenerGatewayRequest({ ...req, url: '/api/stock-screener/results?version=2&holderMode=decrease-to-increase&holderStreakWeeks=4&holderTurnover=true&holderTurnoverMinimumWan=1000' })?.url).toContain('holderStreakWeeks=4');
        expect(validateScreenerGatewayRequest({ ...req, url: '/api/v1/contracts' })).toBeNull();
        for (const extra of [
            { method: 'POST' }, { url: '/api/stock-screener/delete' }, { url: '/api/stock-screener/results?url=http://evil' },
            { url: '/api/stock-screener/results?limit=101' }, { url: '/api/stock-screener/results?limit=1&limit=2' },
            { headers: { host: 'example.com' } }, { headers: { ...req.headers, origin: 'https://evil.example' } },
        ]) expect(validateScreenerGatewayRequest({ ...req, ...extra })?.reason).toBeTruthy();
    });
    it('離線與無回應 body 明確 503；不傳送 caller cookie', async () => {
        let middleware: Function = () => {};
        const fetcher = vi.fn(async (_url: string, _options: RequestInit) => ({ text: () => new Promise(() => {}) }));
        const plugin = stockScreenerGateway(fetcher as unknown as typeof fetch, 10);
        (plugin.configureServer as Function)({ middlewares: { use(fn: Function) { middleware = fn; } } });
        const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
        const next = vi.fn();
        await middleware({ ...req, headers: { ...req.headers, cookie: 'not-forwarded' } }, res, next);
        expect(res.statusCode).toBe(503);
        expect(next).not.toHaveBeenCalled();
        expect(fetcher.mock.calls[0]?.[1].headers).toEqual({ accept: 'application/json' });
        expect(res.end).toHaveBeenCalledWith(expect.stringContaining('local_data_service_unavailable'));
        expect(res.end).toHaveBeenCalledWith(expect.stringContaining('"version":2'));
    });
});
