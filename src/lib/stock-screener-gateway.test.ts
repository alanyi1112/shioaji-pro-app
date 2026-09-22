import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
    STOCK_SCREENER_MULTIVIEW_LIST_PATH,
    stockScreenerGateway,
    validateScreenerGatewayRequest,
    validateStockScreenerMultiViewListPayload,
    validateStockScreenerMultiViewListRequest,
} from '../../scripts/stock-screener-gateway.mjs';

const req = { url: '/api/stock-screener/results', method: 'GET', headers: { host: '127.0.0.1:5173' } };
describe('選股 allowlist 不接觸 broker', () => {
    it('固定 loopback，不接受 URL／未知路徑／寫入／跨站／重複參數', () => {
        expect(validateScreenerGatewayRequest(req)?.url).toBe('http://127.0.0.1:5174/api/stock-screener/results');
        expect(validateScreenerGatewayRequest({ ...req, url: '/api/stock-screener/results?version=2&holderMode=decrease-to-increase&holderStreakWeeks=4&holderTurnover=true&holderTurnoverMinimumWan=1000' })?.url).toContain('holderStreakWeeks=4');
        expect(validateScreenerGatewayRequest({ ...req, url: '/api/stock-screener/results?version=3&fractal=true&fractalAlgorithm=chan-containment&fractalDirection=any&bollReversal=true&bollMode=any' })?.url).toContain('fractalAlgorithm=chan-containment');
        expect(validateScreenerGatewayRequest({ ...req, url: '/api/stock-screener/results?version=4&ma=true&maMode=golden-cross&compressionDays=3&maxSpreadPct=1&divergence=true&divergenceSource=obv&divergenceDirection=bullish&requireZeroReset=false' })?.url).toContain('divergenceSource=obv');
        expect(validateScreenerGatewayRequest({ ...req, url: '/api/stock-screener/results?version=5&largeHolderTrendEnabled=true&largeHolderTrendMinimumRatioPct=10&largeHolderTrendMaximumRatioPct=80&largeHolderTrendWeeks=3&largeHolderTrendMinimumIncreasePp=0.1&sort=largeHolderRatio' })?.url).toContain('largeHolderTrendEnabled=true');
        expect(validateScreenerGatewayRequest({ ...req, url: '/api/stock-screener/status?version=2' })?.url).toBe('http://127.0.0.1:5174/api/stock-screener/status?version=2');
        expect(validateScreenerGatewayRequest({ ...req, url: '/api/stock-screener/status?version=3' })?.url).toBe('http://127.0.0.1:5174/api/stock-screener/status?version=3');
        expect(validateScreenerGatewayRequest({ ...req, url: '/api/stock-screener/status?version=4' })?.url).toBe('http://127.0.0.1:5174/api/stock-screener/status?version=4');
        expect(validateScreenerGatewayRequest({ ...req, url: '/api/stock-screener/status?version=5' })?.url).toBe('http://127.0.0.1:5174/api/stock-screener/status?version=5');
        expect(validateScreenerGatewayRequest({ ...req, url: '/api/stock-screener/status?version=6' })?.url).toBe('http://127.0.0.1:5174/api/stock-screener/status?version=6');
        expect(validateScreenerGatewayRequest({ ...req, url: '/api/stock-screener/results?version=6&foreignReversalEnabled=true&foreignReversalSellStreakDays=3&foreignReversalTodayNetBuyMinimumLots=1000' })?.url).toContain('foreignReversalEnabled=true');
        expect(validateScreenerGatewayRequest({ ...req, url: '/api/v1/contracts' })).toBeNull();
        for (const extra of [
            { method: 'POST' }, { url: '/api/stock-screener/delete' }, { url: '/api/stock-screener/results?url=http://evil' },
            { url: '/api/stock-screener/status?fractal=true' }, { url: '/api/stock-screener/status?version=7' },
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
    it('v3 離線回應保留 v3 schema，不會讓 UI 誤讀成 v2', async () => {
        let middleware: Function = () => {};
        const plugin = stockScreenerGateway(vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch, 10);
        (plugin.configureServer as Function)({ middlewares: { use(fn: Function) { middleware = fn; } } });
        const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
        await middleware({ ...req, url: '/api/stock-screener/status?version=3' }, res, vi.fn());
        expect(res.statusCode).toBe(503);
        expect(res.end).toHaveBeenCalledOnce();
        const body = JSON.parse(res.end.mock.calls[0]![0] as string);
        expect(body).toMatchObject({ version: 3, state: 'unavailable', technicalAnchors: null, preparation: null });
    });
    it('v4 離線回應保留 v4 schema 與 source mapping', async () => {
        let middleware: Function = () => {};
        const plugin = stockScreenerGateway(vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch, 10);
        (plugin.configureServer as Function)({ middlewares: { use(fn: Function) { middleware = fn; } } });
        const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
        await middleware({ ...req, url: '/api/stock-screener/status?version=4' }, res, vi.fn());
        const body = JSON.parse(res.end.mock.calls[0]![0] as string);
        expect(body).toMatchObject({ version: 4, state: 'unavailable', sourceMappingVersion: 'official-daily-ohlcv-v2' });
    });
    it('v5 離線回應保留籌碼 schema 與來源 mapping', async () => {
        let middleware: Function = () => {};
        const plugin = stockScreenerGateway(vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch, 10);
        (plugin.configureServer as Function)({ middlewares: { use(fn: Function) { middleware = fn; } } });
        const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
        await middleware({ ...req, url: '/api/stock-screener/status?version=5' }, res, vi.fn());
        const body = JSON.parse(res.end.mock.calls[0]![0] as string);
        expect(body).toMatchObject({ version: 5, state: 'unavailable', sourceMappingVersion: 'official-market-chip-v1', chipCoverage: null });
    });
});

const mutationBase = {
    url: STOCK_SCREENER_MULTIVIEW_LIST_PATH,
    method: 'POST',
    headers: {
        host: '127.0.0.1:5173',
        origin: 'http://127.0.0.1:5173',
        'content-type': 'application/json',
    },
    socket: { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1' },
};

function mutationRequest(body: unknown, overrides: Record<string, unknown> = {}) {
    const stream = Readable.from([typeof body === 'string' ? body : JSON.stringify(body)]);
    return Object.assign(stream, mutationBase, overrides);
}

function responseRecorder() {
    return { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
}

describe('選股結果同步 MultiView 固定用途 gateway', () => {
    it('只允許 loopback 同源固定 POST 與 canonical symbol payload', () => {
        expect(validateStockScreenerMultiViewListRequest(mutationBase as never)?.url).toBe('http://127.0.0.1:5174/api/integrations/stock-screener-list/items');
        expect(validateStockScreenerMultiViewListPayload({ symbol: ' 8069.two ' })).toEqual({ symbol: '8069.TWO' });
        expect(validateStockScreenerMultiViewListPayload({ symbol: '2449.TW', url: 'https://evil.example' })).toBeNull();
        expect(validateStockScreenerMultiViewListPayload({ symbol: '2449' })).toBeNull();
        for (const extra of [
            { method: 'GET' },
            { url: `${STOCK_SCREENER_MULTIVIEW_LIST_PATH}?target=http://evil.example` },
            { headers: { ...mutationBase.headers, host: 'example.com' } },
            { headers: { ...mutationBase.headers, origin: 'https://evil.example' } },
            { headers: { ...mutationBase.headers, 'x-forwarded-host': 'evil.example' } },
            { headers: { ...mutationBase.headers, 'content-type': 'text/plain' } },
            { socket: { remoteAddress: '10.0.0.2', localAddress: '127.0.0.1' } },
        ]) expect(validateStockScreenerMultiViewListRequest({ ...mutationBase, ...extra } as never)?.reason).toBeTruthy();
    });

    it('只轉送允許欄位，不轉送 cookie、caller header 或 target 控制資訊', async () => {
        let middleware: Function = () => {};
        const fetcher = vi.fn(async () => new Response(JSON.stringify({
            schemaVersion: 'multiview-stock-screener-list-sync/1', ok: true, status: 'added',
            symbol: '2449.TW', tabId: 'stock-screener-filtered', tabLabel: '選股篩選',
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
        const plugin = stockScreenerGateway(fetcher as unknown as typeof fetch, 50);
        (plugin.configureServer as Function)({ middlewares: { use(fn: Function) { middleware = fn; } } });
        const res = responseRecorder();
        await middleware(mutationRequest({ symbol: '2449.tw' }, {
            headers: { ...mutationBase.headers, cookie: 'not-forwarded', authorization: 'not-forwarded' },
        }), res, vi.fn());
        expect(res.statusCode).toBe(200);
        expect(fetcher).toHaveBeenCalledExactlyOnceWith(
            'http://127.0.0.1:5174/api/integrations/stock-screener-list/items',
            expect.objectContaining({
                method: 'POST',
                headers: { accept: 'application/json', 'content-type': 'application/json' },
                body: JSON.stringify({ symbol: '2449.TW' }),
            }),
        );
        expect(JSON.parse(res.end.mock.calls[0]![0] as string)).toMatchObject({ ok: true, status: 'added', symbol: '2449.TW' });
    });

    it('拒絕畸形／過大 body，MultiView 離線或逾時回傳可重試 503', async () => {
        let middleware: Function = () => {};
        const fetcher = vi.fn(() => new Promise<Response>(() => {}));
        const plugin = stockScreenerGateway(fetcher as unknown as typeof fetch, 10);
        (plugin.configureServer as Function)({ middlewares: { use(fn: Function) { middleware = fn; } } });
        const malformed = responseRecorder();
        await middleware(mutationRequest('{'), malformed, vi.fn());
        expect([malformed.statusCode, JSON.parse(malformed.end.mock.calls[0]![0] as string).reason]).toEqual([400, 'invalid_json']);
        const invalid = responseRecorder();
        await middleware(mutationRequest({ symbol: '2449.TW', method: 'DELETE' }), invalid, vi.fn());
        expect([invalid.statusCode, JSON.parse(invalid.end.mock.calls[0]![0] as string).reason]).toEqual([400, 'invalid_payload']);
        const offline = responseRecorder();
        await middleware(mutationRequest({ symbol: '2449.TW' }), offline, vi.fn());
        expect([offline.statusCode, JSON.parse(offline.end.mock.calls[0]![0] as string)]).toEqual([503, {
            schemaVersion: 'multiview-stock-screener-list-sync/1', ok: false, reason: 'multiview_unavailable', retryable: true,
        }]);
    });

    it('下游非成功回應只保留安全 reason 與 retryable，不外洩其他欄位', async () => {
        let middleware: Function = () => {};
        const fetcher = vi.fn(async () => new Response(JSON.stringify({
            ok: false, reason: 'write_not_confirmed', retryable: true, secret: 'must-not-forward', error: 'database detail',
        }), { status: 503 }));
        const plugin = stockScreenerGateway(fetcher as unknown as typeof fetch, 50);
        (plugin.configureServer as Function)({ middlewares: { use(fn: Function) { middleware = fn; } } });
        const res = responseRecorder();
        await middleware(mutationRequest({ symbol: '2449.TW' }), res, vi.fn());
        expect(JSON.parse(res.end.mock.calls[0]![0] as string)).toEqual({
            schemaVersion: 'multiview-stock-screener-list-sync/1', ok: false, reason: 'write_not_confirmed', retryable: true,
        });
    });
});
