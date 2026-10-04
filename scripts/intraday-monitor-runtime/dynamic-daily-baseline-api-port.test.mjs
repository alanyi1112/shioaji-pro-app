import { describe, expect, it } from 'vitest';

import { createDynamicDailyBaselineApiPort }
    from './dynamic-daily-baseline-api-port.mjs';

describe('每日基準唯讀本機 API port', () => {
    it('只走既有 simulation 資料端點，不提供 login、SSE 或交易路徑', async () => {
        const calls = [];
        const fetchImpl = async (url, init) => {
            calls.push({ url, method: init.method, body: init.body });
            if (url.endsWith('/info')) return Response.json({ simulation: true, version: 'fixture/1' });
            if (url.endsWith('/health')) return Response.json({ status: 'healthy' });
            if (url.endsWith('/auth/usage')) return Response.json({ bytes: 1,
                remaining_bytes: 99, limit_bytes: 100 });
            if (url.endsWith('/snapshots')) return Response.json([{ code: '2330',
                exchange: 'TSE', datetime: '2026-09-29T13:24:59' }]);
            return Response.json({ code: '2330' });
        };
        const port = createDynamicDailyBaselineApiPort({ fetchImpl,
            now: () => '2026-09-29T14:10:00+08:00' });
        const proof = await port.preflight();
        expect(proof).toMatchObject({ simulation: true,
            businessSessionCurrent: false, brokerWriteAuthority: false });
        await port.readUsage();
        expect(await port.readSnapshot2330()).toMatchObject([{ code: '2330' }]);
        const request = { code: '2330', exchange: 'TSE', canonicalSymbol: '2330.TW',
            tradeDate: '2026-09-29' };
        await port.fetchContract(request);
        const kbars = await port.fetchKbars(request);
        expect(kbars.value).toEqual({ data: { code: '2330' },
            fetchedAt: '2026-09-29T14:10:00+08:00' });
        await port.fetchTicks(request);
        expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
            '/api/v1/info', '/api/v1/health', '/api/v1/auth/usage',
            '/api/v1/data/snapshots',
            '/api/v1/data/contracts/2330/info', '/api/v1/data/kbars',
            '/api/v1/data/ticks',
        ]);
        expect(calls.filter((call) => call.method === 'POST')).toHaveLength(3);
        expect(JSON.stringify(calls)).not.toMatch(/login|stream|subscribe|orders/);
        expect(Object.keys(port)).toEqual(['schemaVersion', 'preflight', 'readUsage',
            'readSnapshot2330',
            'fetchContract', 'fetchKbars', 'fetchTicks']);
    });

    it('production、錯商品或超量回應 fail closed', async () => {
        const prod = createDynamicDailyBaselineApiPort({ fetchImpl: async (url) =>
            Response.json(url.endsWith('/info') ? { simulation: false, version: 'fixture' } :
                { status: 'healthy' }) });
        await expect(prod.preflight()).rejects.toThrow('simulation_business_session_unavailable');
        await expect(prod.fetchKbars({ code: '2330', exchange: 'TSE',
            canonicalSymbol: '2330.TWO' })).rejects.toThrow('daily_baseline_contract_invalid');
        const oversized = createDynamicDailyBaselineApiPort({ fetchImpl: async () =>
            new Response('{}', { headers: { 'content-length': String(16 * 1024 ** 2 + 1) } }) });
        await expect(oversized.readUsage()).rejects.toThrow('baseline_response_too_large');
    });
});
