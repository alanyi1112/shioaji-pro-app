import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createBollingerSourceFetcher, createBollingerCalendarFetcher, bollingerTransportFailureEvidence } from '../../../scripts/stock-screener-bollinger-source-fetch.mjs';

const target = { market: 'TPEx', sessionDate: '2026-10-02' };
function transport({ status = 200, body = '{}', failure = false, aborted = false, partialBody = '' } = {}) {
    const calls = [];
    const request = (url, options, callback) => {
        calls.push({ url, options }); const req = new EventEmitter();
        req.destroy = error => req.emit('error', error);
        req.end = () => queueMicrotask(() => {
            const socket = new EventEmitter(); socket.authorized = true; socket.getProtocol = () => 'TLSv1.2';
            req.emit('socket', socket); socket.emit('secureConnect'); req.emit('finish');
            if (failure) { req.emit('error', failure instanceof Error ? failure : Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })); return; }
            const res = new EventEmitter(); res.headers = { 'retry-after': '7200' }; res.statusCode = status;
            res.destroy = error => res.emit('error', error);
            callback(res);
            if (aborted) { if (partialBody) res.emit('data', Buffer.from(partialBody)); res.emit('aborted'); return; }
            res.emit('data', Buffer.from(body)); res.emit('end');
        });
        return req;
    };
    return { request, calls };
}
test('官方transport每呼叫只發一次，TPEx維持TLS驗證／signal／timeout與identity', async () => {
    const t = transport(), signal = new AbortController().signal;
    const result = await createBollingerSourceFetcher(t.request)(target, signal);
    assert.equal(t.calls.length, 1); assert.equal(result.status, 200); assert.equal(result.text, '{}');
    assert.equal(t.calls[0].options.signal, signal); assert.equal(t.calls[0].options.maxVersion, 'TLSv1.2');
    assert.equal(t.calls[0].options.rejectUnauthorized, undefined); assert.equal(t.calls[0].options.timeout, 30000);
    assert.equal(t.calls[0].options.headers['accept-encoding'], 'identity');
    assert(result.sourceUrl.includes('date=2026%2F10%2F02'));
});
test('429／轉址均交由上層Gate，不跟轉址或暗中重試', async () => {
    for (const status of [429, 302]) {
        const t = transport({ status });
        const result = await createBollingerSourceFetcher(t.request)(target, new AbortController().signal);
        assert.equal(result.status, status); assert.equal(result.retryAfter, '7200'); assert.equal(t.calls.length, 1);
    }
});
test('ECONNRESET／半份body中止不回成功，也不內建五次重試', async () => {
    for (const scenario of [{ failure: true }, { aborted: true }]) {
        const t = transport(scenario);
        await assert.rejects(createBollingerSourceFetcher(t.request)(target, new AbortController().signal));
        assert.equal(t.calls.length, 1);
    }
});
test('連線重設保留原cause及TLS／階段證據，不把未收到HTTP當成403或來源日期不存在', async () => {
    const original = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const t = transport({ failure: original });
    await assert.rejects(createBollingerSourceFetcher(t.request)(target, new AbortController().signal), error => {
        assert.equal(error.message, 'source_connection_reset'); assert.equal(error.cause, original);
        assert.deepEqual(bollingerTransportFailureEvidence(error), { version: 1, phase: 'request_sent', code: 'ECONNRESET',
            bytes: 0, statusCode: null, tlsProtocol: 'TLSv1.2', tlsAuthorized: true });
        return true;
    });
    assert.equal(t.calls.length, 1);
});
test('DNS／TLS／逾時／中止分開分類，不持久化任意原始訊息', async () => {
    for (const [code, reason] of [['ENOTFOUND', 'source_dns_failed'], ['ERR_TLS_CERT_ALTNAME_INVALID', 'source_tls_verification_failed'],
        ['ETIMEDOUT', 'source_timeout'], ['ABORT_ERR', 'source_aborted'], ['UNKNOWN_CODE', 'source_transport_failed']]) {
        const t = transport({ failure: Object.assign(new Error('sensitive fixture must not be persisted'), { code }) });
        await assert.rejects(createBollingerCalendarFetcher(t.request)('TPEx', 2026, new AbortController().signal), error => {
            assert.equal(error.message, reason);
            const evidence = bollingerTransportFailureEvidence(error);
            assert.equal(evidence.code, code === 'UNKNOWN_CODE' ? null : code);
            assert(!JSON.stringify(evidence).includes('sensitive fixture')); return true;
        });
        assert.equal(t.calls.length, 1);
    }
    assert.equal(bollingerTransportFailureEvidence(new Error('not a transport failure')), null);
});
test('有HTTP但半份body中斷保留狀態碼與已收到bytes，不發布截斷JSON', async () => {
    const t = transport({ aborted: true, partialBody: '{"date":' });
    await assert.rejects(createBollingerSourceFetcher(t.request)(target, new AbortController().signal), error => {
        assert.equal(error.message, 'source_response_aborted');
        assert.deepEqual(bollingerTransportFailureEvidence(error), { version: 1, phase: 'response_body', code: null,
            bytes: 8, statusCode: 200, tlsProtocol: 'TLSv1.2', tlsAuthorized: true }); return true;
    });
    assert.equal(t.calls.length, 1);
});
test('超過8MiB回應中止，不以截斷JSON冒充合法資料', async () => {
    const t = transport({ body: 'x'.repeat(8 * 1024 * 1024 + 1) });
    await assert.rejects(createBollingerSourceFetcher(t.request)(target, new AbortController().signal), /invalid_source_size/);
    assert.equal(t.calls.length, 1);
});
test('日曆transport固定年度官方URL，每次一request／2MiB上限，錯誤不重試', async () => {
    const t = transport(), signal = new AbortController().signal;
    const result = await createBollingerCalendarFetcher(t.request)('TPEx', 2026, signal);
    assert.equal(result.sourceUrl, 'https://www.tpex.org.tw/www/zh-tw/bulletin/tradingDate?date=2026');
    assert.equal(t.calls.length, 1); assert.equal(t.calls[0].options.signal, signal);
    assert.equal(t.calls[0].options.maxVersion, 'TLSv1.2'); assert.equal(t.calls[0].options.rejectUnauthorized, undefined);
    for (const scenario of [{ failure: true }, { aborted: true }, { body: 'x'.repeat(2 * 1024 * 1024 + 1) }]) {
        const p = transport(scenario); await assert.rejects(createBollingerCalendarFetcher(p.request)('TWSE', 2026, signal));
        assert.equal(p.calls.length, 1);
    }
    await assert.rejects(createBollingerCalendarFetcher(t.request)('other', 2026, signal)); assert.equal(t.calls.length, 1);
});
