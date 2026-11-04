import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHART_DAILY_HISTORY_PATH as route, createChartDailyHistoryMiddleware, validateChartDailyHistoryRequest } from './chart-daily-history-gateway.mjs';
const req = symbol => ({ method: 'GET', url: `${route}?symbol=${symbol}`, headers: { host: '127.0.0.1:5173' }, socket: { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1' } });
const source = symbol => ({ symbol, interval: '1d', candles: [], volumeContract: { provider: 'yahoo-chart', canonicalVolumeUnit: 'common_lot' } });
const call = (middleware, request = req('2330.TW')) => new Promise(resolve => middleware(request, { setHeader() {}, end(body) { resolve({ status: this.statusCode, body: JSON.parse(body) }); } }, () => resolve(null)));

test('固定日線白名單，不接受遠端、跨站、任意參數或分鐘K', () => {
    assert.equal(validateChartDailyHistoryRequest(req('2330.TW')).symbol, '2330.TW');
    for (const query of ['2330.TW&interval=1m', 'TXF', '2330.TW&symbol=2454.TW', '2330.TW&target=http://elsewhere']) assert.equal(validateChartDailyHistoryRequest(req(query)).status, 400);
    assert.equal(validateChartDailyHistoryRequest({ ...req('2330.TW'), headers: { host: 'evil:5173' } }).status, 403);
    assert.equal(validateChartDailyHistoryRequest({ ...req('2330.TW'), headers: { host: '127.0.0.1:5173', origin: 'https://elsewhere' } }).status, 403);
});
test('併發同股合併、快取重用、來源固定5174日線且不轉送credentials', async () => {
    const calls = [];
    const middleware = createChartDailyHistoryMiddleware({ fetchImpl: async (url, options) => { calls.push({ url, options }); return Response.json(source('2330.TW')); } });
    const result = await Promise.all([call(middleware), call(middleware)]);
    assert.equal(result[0].status, 200); assert.equal(result[1].body.brokerRequests, 0);
    await call(middleware);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:5174/api/candles?symbol=2330.TW&interval=1d&display_count=500');
    assert.deepEqual(calls[0].options.headers, { accept: 'application/json' });
});
test('失敗一分鐘冷卻；不備援券商、不無限重試', async () => {
    let count = 0, at = 0;
    const middleware = createChartDailyHistoryMiddleware({ now: () => at, fetchImpl: async () => { count++; throw Error('offline'); } });
    assert.equal((await call(middleware)).status, 503);
    assert.equal((await call(middleware)).status, 503); assert.equal(count, 1);
    at = 60001;
    await call(middleware); assert.equal(count, 2);
});
test('即使服務回應成功，錯誤商品與券商來源仍拒絕', async () => {
    for (const value of [source('2454.TW'), { ...source('2330.TW'), volumeContract: { provider: 'shioaji-kbars', canonicalVolumeUnit: 'common_lot' } }]) {
        const middleware = createChartDailyHistoryMiddleware({ fetchImpl: async () => Response.json(value) });
        assert.equal((await call(middleware)).status, 503);
    }
});
