import { test } from 'vitest';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSpecialMarketClosures, saveSpecialMarketClosure } from './special-market-closures.mjs';
import { createMarketCalendar } from '../../src/lib/market-calendar.ts';
import { readLocalCalendarDataCheck } from '../local-calendar-check-bridge.mjs';
import { handleLocalMarketCalendarCheck } from '../../apps/multiview/worker/local-market-calendar-checks.ts';
import { SqliteD1 } from '../../apps/multiview/tests/helpers/sqlite-d1.mjs';
import { createIntradayMonitorLocalApiService } from './local-api-service.mjs';
import { createIntradayMonitorLocalApiGatewayMiddleware } from './vite-local-api-gateway.mjs';

// Exercise the real middleware/body parser without a listener, socket or HTTP request.
async function dispatch(middleware, pathname, { method = 'GET', body, headers = {} } = {}) {
    const request = new EventEmitter();
    const payload = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    Object.assign(request, {
        url: pathname, method,
        socket: { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1' },
        rawHeaders: Object.entries({ Host: '127.0.0.1:5173', Origin: 'http://127.0.0.1:5173',
            ...(payload ? { 'Content-Type': 'application/json' } : {}), ...headers }).flat(),
        destroy() {},
    });
    let result;
    const response = { statusCode: 0, setHeader() {}, end(value) {
        result = { status: this.statusCode, body: JSON.parse(value) };
    } };
    const pending = middleware(request, response, () => { throw Error('unexpected_route_fallthrough'); });
    if (payload) {
        const middle = Math.floor(payload.length / 2);
        request.emit('data', payload.subarray(0, middle));
        request.emit('data', payload.subarray(middle));
    }
    request.emit('end');
    await pending;
    assert.ok(result, 'middleware must complete the response');
    return result;
}

function fixture({ providers = true } = {}) {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'calendar-offline-api-')));
    const now = new Date('2026-10-23T22:00:00+08:00');
    const read = () => readSpecialMarketClosures(root, { now });
    const db = new SqliteD1();
    db.exec('CREATE TABLE candle_history(provider TEXT,symbol TEXT,interval TEXT,time INTEGER,open REAL,high REAL,low REAL,close REAL,volume REAL)');
    const calendar = () => createMarketCalendar({ verified: true, calendarVersion: 'fixture-annual',
        fetchedAtEpochMs: +now - 1000, validUntilEpochMs: +now + 3600000,
        days: ['2026-10-22', '2026-10-23'].map(tradeDate => ({ tradeDate, TSE: 'scheduled_trading', OTC: 'scheduled_trading' })) }, read(), now);
    const calls = { checks: 0, bridge: 0 };
    const forbidden = () => { throw Error('unexpected_monitor_or_repository_work'); };
    const service = createIntradayMonitorLocalApiService({ generation: 'generation_test_1234567890',
        configRepository: { read: forbidden, replace: forbidden },
        evidenceRepository: { currentRevision: forbidden, listTriggers: forbidden },
        leaseCoordinator: { acquire: forbidden, renew: forbidden, release: forbidden, status: forbidden },
        ...(providers ? {
            specialClosures: { read, save: input => saveSpecialMarketClosure(root, input, { now }) },
            marketCalendarProvider: calendar,
            calendarDataCheckProvider: query => {
                calls.checks++;
                return readLocalCalendarDataCheck(query, calendar(), { fetchImpl: async (url, init) => {
                    calls.bridge++;
                    assert.equal(url, 'http://127.0.0.1:5174/api/local-market-calendar/check');
                    assert.equal(init.redirect, 'manual');
                    return handleLocalMarketCalendarCheck(new Request(url, init), { DEPLOYMENT_TARGET: 'local', DB: db }, now);
                } });
            },
        } : {}),
    });
    return { calls, read, middleware: createIntradayMonitorLocalApiGatewayMiddleware({ service }),
        close() { service.close(); db.close(); rmSync(root, { recursive: true, force: true }); } };
}
const prefix = '/api/market-calendar/v1';
const closure = { action: 'close', date: '2026-10-22', markets: ['OTC'], reason: '離線歷史補登', confirmed: true, expectedRevision: 0 };
const query = { symbol: '2330.TW', from: '2026-10-23', through: '2026-10-23', dataset: 'candles', interval: '1d' };

test('離線 body parser → store → bridge → Worker SELECT 同版往返；讀取不自動執行檢查', async () => {
    const env = fixture();
    try {
        assert.equal((await dispatch(env.middleware, prefix + '/special-closures')).body.closures.revision, 0);
        assert.equal(env.calls.checks, 0);
        assert.equal((await dispatch(env.middleware, prefix + '/special-closures', { method: 'POST', body: closure })).status, 200);
        assert.equal((await dispatch(env.middleware, '/api/intraday-monitor/v1/special-closures')).body.closures.revision, 1);
        const projected = await dispatch(env.middleware, prefix + '/projection');
        assert.match(projected.body.calendar.version, /manual:1:/);
        const first = await dispatch(env.middleware, prefix + '/checks', { method: 'POST', body: query });
        assert.equal(first.status, 200);
        assert.equal(first.body.check.status, 'partial');
        assert.deepEqual(first.body.check.missing, ['2026-10-23']);
        assert.equal((await dispatch(env.middleware, prefix + '/special-closures', { method: 'POST',
            body: { ...closure, date: '2026-10-23', markets: ['TSE'], expectedRevision: 1 } })).status, 200);
        const second = await dispatch(env.middleware, prefix + '/checks', { method: 'POST', body: query });
        assert.equal(second.body.check.status, 'complete');
        assert.deepEqual(second.body.check.excluded, ['2026-10-23']);
        assert.match(second.body.check.calendarVersion, /manual:2:/);
        assert.equal(second.body.check.externalRequests, 0);
        assert.equal(second.body.check.changedDb, false);
        assert.equal(second.body.check.automaticRepairAllowed, false);
        assert.deepEqual(env.calls, { checks: 2, bridge: 2 });
    } finally { env.close(); }
});

test('離線同源／JSON／白名單／輸入負例不觸及 store 或資料查詢', async () => {
    const env = fixture();
    try {
        for (const [pathname, options, status] of [
            [prefix + '/special-closures', { method: 'POST', body: closure, headers: { Origin: 'https://evil.invalid' } }, 403],
            [prefix + '/special-closures', { method: 'POST', body: closure, headers: { 'Content-Type': 'text/plain' } }, 415],
            [prefix + '/special-closures', { method: 'POST', body: '{broken' }, 400],
            [prefix + '/special-closures', { method: 'POST', body: 'x'.repeat(128 * 1024 + 1) }, 413],
            [prefix + '/checks?download=true', { method: 'POST', body: query }, 400],
            [prefix + '/leases/acquire', { method: 'POST', body: {} }, 404],
            [prefix + '/checks', { method: 'POST', body: { ...query, url: 'https://evil.invalid' } }, 422],
        ]) assert.equal((await dispatch(env.middleware, pathname, options)).status, status);
        assert.equal(env.read().revision, 0);
        assert.equal(env.calls.bridge, 0);
    } finally { env.close(); }
});

test('離線 provider 缺失、CAS 衝突與缺確認皆失效安全', async () => {
    const absent = fixture({ providers: false });
    try {
        for (const [pathname, options] of [
            [prefix + '/projection', {}], [prefix + '/special-closures', {}],
            [prefix + '/checks', { method: 'POST', body: query }],
            [prefix + '/special-closures', { method: 'POST', body: closure }],
        ]) assert.equal((await dispatch(absent.middleware, pathname, options)).status, 503);
    } finally { absent.close(); }
    const env = fixture();
    try {
        assert.equal((await dispatch(env.middleware, prefix + '/special-closures', { method: 'POST', body: closure })).status, 200);
        assert.equal((await dispatch(env.middleware, prefix + '/special-closures', { method: 'POST', body: closure })).status, 409);
        assert.equal((await dispatch(env.middleware, prefix + '/special-closures', { method: 'POST',
            body: { ...closure, date: '2026-10-23', expectedRevision: 1, confirmed: false } })).status, 422);
        assert.equal(env.read().revision, 1);
    } finally { env.close(); }
});
