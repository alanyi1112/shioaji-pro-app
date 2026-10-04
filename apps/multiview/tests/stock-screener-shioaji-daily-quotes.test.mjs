import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { DAILY_QUOTES_MAPPING, DAILY_QUOTES_URL, validDailyQuotesReview, parseDailyQuotes, projectDailyQuotes,
    createDailyQuotesFetcher, loadDailyQuotesBatch } from '../../../scripts/stock-screener-shioaji-daily-quotes.mjs';

// 所有 review／日曆／session／response 均為隔離 fixture，不是正式來源許可或自動發布。
const date = '2026-10-02', at = '2026-10-03T07:00:00Z';
const review = { status: 'verified', provider: 'shioaji-daily-quotes', endpoint: DAILY_QUOTES_URL,
    mappingVersion: DAILY_QUOTES_MAPPING, volumeUnit: 'shares', turnoverUnit: 'TWD', priceBasis: 'unadjusted',
    tradeScope: 'official-daily-compatible', usage: 'local-historical-screener', localDisplayVerified: true,
    markets: ['TWSE', 'TPEx'], evidenceHash: 'a'.repeat(64), reviewedAt: '2026-10-03T06:00:00Z',
    validThrough: '2026-10-04T06:00:00Z', minimumRows: 2 };
const payload = () => ({ Date: [date, date], Code: ['2449', '6488'], Open: [100, 500], High: [102, 502],
    Low: [99, 499], Close: [101, 501], Volume: [1200, 4000], Transaction: [20, 100], Amount: [121000, 2000000] });
const response = p => ({ sourceUrl: DAILY_QUOTES_URL, status: 200, fetchedAt: at, text: typeof p === 'string' ? p : JSON.stringify(p ?? payload()) });
const parse = p => parseDailyQuotes(response(p), date, review, new Date(at));
const universe = [
    { symbol: '2449.TW', code: '2449', name: 'fixture-2449', market: 'TWSE', listingDate: null },
    { symbol: '6488.TWO', code: '6488', name: 'fixture-6488', market: 'TPEx', listingDate: null },
];
const migration = await readFile(new URL('../drizzle/0037_screener_daily_quotes_cache.sql', import.meta.url), 'utf8');
function fixture() {
    const db = new SqliteD1(); applyDrizzleSql(db, migration);
    let time = Date.parse(at), calls = 0, settled = [], reservations = 0;
    const now = () => new Date(time);
    const options = { db, sessionDate: date, review, now,
        gate: { calendarStatus: 'verified', authorityHash: 'b'.repeat(64), commonSessions: [date],
            validThrough: review.validThrough, universeStatus: 'verified' },
        safety: async () => ({ simulation: true, businessSessionEstablished: true, observedAt: now().toISOString(), generation: 'fixture-generation' }),
        admission: { reserve: async () => ({ allowed: true, reservationId: `fixture-reservation-${++reservations}` }),
            settle: async x => { settled.push(x); } },
        fetchReport: async () => { calls++; return { ...response(), fetchedAt: now().toISOString() }; } };
    return { db, options, calls: () => calls, settled, advance: ms => { time += ms; } };
}

test('canonical 股數與實際金額，不乘1000、不以收盤價乘量', () => {
    const batch = parse();
    assert.equal(batch.points[0].bar.volumeShares, '1200');
    assert.equal(batch.points[0].bar.turnoverNtd, '121000');
    assert.equal(batch.mappingVersion, DAILY_QUOTES_MAPPING);
    assert.match(batch.payloadHash, /^[a-f0-9]{64}$/);
});
test('原始int64不經Number：保留9007199254740993及上限', () => {
    const text = JSON.stringify(payload()).replace('1200', '9007199254740993').replace('121000', '9223372036854775807');
    const batch = parse(text);
    assert.equal(batch.points[0].bar.volumeShares, '9007199254740993');
    assert.equal(batch.points[0].bar.turnoverNtd, '9223372036854775807');
    assert.throws(() => parse(text.replace('9223372036854775807', '9223372036854775808')), /invalid_report_integer/);
});
test('33342359與33342358逐字保留，不使用float32或自行校正一股差異', () => {
    for (const shares of ['33342359', '33342358']) {
        const text = JSON.stringify(payload()).replace('1200', shares).replace('121000', '58467099660');
        const point = parse(text).points[0];
        assert.equal(point.bar.volumeShares, shares);
        assert.equal(point.sourceValues.volumeShares, shares);
        assert.equal(point.bar.turnoverNtd, '58467099660');
    }
});
test('日期／重複代碼／arrays長度／OHLC破損整批拒絕', () => {
    for (const mutate of [p => { p.Date[0] = '2026-10-01'; }, p => { p.Code[1] = p.Code[0]; },
        p => { p.Amount.pop(); }, p => { p.High[0] = 98; }, p => { p.Volume[0] = 1.5; },
        p => { p.Amount[0] = -1; }, p => { p.Close[0] = null; }, p => { p.Code[0] = 2449; }]) {
        const p = payload(); mutate(p); assert.throws(() => parse(p), /invalid_report_/);
    }
});
test('HTML、duplicate keys、嵌套、非JSON number與trailing comma不放行', () => {
    const text = JSON.stringify(payload());
    for (const raw of ['<html>error</html>', text.replace('{', '{"Code":[], '), text.replace('1200', '01'),
        text.replace('1200', 'NaN'), text.replace('1200', 'Infinity'), text.replace('1200', '{}'),
        text.replace('1200', '"1200"'), text.replace('}', ',}'), `${text} garbage`]) {
        assert.throws(() => parse(raw), /invalid_report_/);
    }
});
test('零成交保存no_trade，不造K棒；與金額／筆數矛盾拒絕', () => {
    const p = payload(); p.Volume[0] = p.Amount[0] = p.Transaction[0] = 0;
    p.Open[0] = p.High[0] = p.Low[0] = p.Close[0] = 0;
    const point = parse(p).points[0]; assert.equal(point.readiness, 'no_trade'); assert.equal(point.bar, null);
    p.Amount[0] = 1; assert.throws(() => parse(p), /invalid_report_no_trade/);
});
test('真實全空OHLC且有成交統計保留逐股missing_ohlcv；舊v1仍拒絕不重解釋', async () => {
    const p = payload(); for (const key of ['Open','High','Low','Close']) p[key][0] = null;
    const batch = parse(p), projected = await projectDailyQuotes(batch, universe);
    assert.equal(projected[0].readiness, 'missing_ohlcv'); assert.equal(projected[0].bar, null);
    assert.equal(projected[0].sourceValues.volumeShares, '1200');
    assert.equal(projected[1].readiness, 'ready');
    assert.throws(() => parseDailyQuotes(response(p), date, { ...review, mappingVersion:'shioaji-daily-quotes-shares-twd-v1' }, new Date(at)), /invalid_report_ohlcv/);
    p.Amount[0] = 0; assert.throws(() => parse(p), /invalid_report_ohlcv/);
});
test('review 的市場、價格基礎、交易範圍、本機用途、效期與單位獨立驗證', () => {
    assert(validDailyQuotesReview(review, new Date(at)));
    for (const patch of [{ status: 'pending' }, { volumeUnit: 'lots' }, { priceBasis: 'adjusted' },
        { tradeScope: 'unknown' }, { usage: 'public-redistribution' }, { markets: ['TWSE'] },
        { validThrough: at }, { reviewedAt: review.validThrough }, { endpoint: 'https://example.com' }]) {
        assert.equal(validDailyQuotesReview({ ...review, ...patch }, new Date(at)), false);
    }
});
test('已授權 API 的個人本機用途不要求額外展示許可旗標；技術契約仍需 verified', () => {
    const { localDisplayVerified: _legacy, ...local } = review;
    assert.equal(validDailyQuotesReview(local, new Date(at)), true);
    assert.equal(validDailyQuotesReview({ ...local, localDisplayVerified: false }, new Date(at)), true);
    assert.equal(validDailyQuotesReview({ ...local, status: 'pending' }, new Date(at)), false);
    assert.equal(parseDailyQuotes(response(), date, local, new Date(at)).points.length, 2);
});
test('依verified母體投影雙市場，額外ETF不混母體；缺失／上市前／停牌分列', async () => {
    const p = payload();
    const projected = await projectDailyQuotes(parse(p), [...universe,
        { ...universe[0], code: '9999', symbol: '9999.TW' },
        { ...universe[0], code: '8888', symbol: '8888.TW', listingDate: '2026-10-03' },
        { ...universe[0], code: '7777', symbol: '7777.TW', suspendedSessions: [date] }]);
    assert.deepEqual(projected.map(r => r.readiness), ['ready', 'source_missing', 'before_listing', 'suspended', 'ready']);
    assert(projected.every(r => r.provenance.provider === 'shioaji-daily-quotes'));
    assert.equal(projected.at(-1).market, 'TPEx');
});
test('persist cache跨市場／新loader重用同一日期，receipt不重寫', async () => {
    const f = fixture();
    try {
        const first = await loadDailyQuotesBatch(f.options);
        const receipt = await f.db.prepare("SELECT * FROM screener_daily_quotes_receipts WHERE status='complete'").first();
        const second = await loadDailyQuotesBatch({ ...f.options, fetchReport: async () => { throw new Error('should_not_fetch'); } });
        assert.equal(first.requested, 1); assert.equal(second.requested, 0); assert.equal(f.calls(), 1);
        assert.equal(first.batch.payloadHash, second.batch.payloadHash);
        assert.deepEqual({ ...await f.db.prepare('SELECT * FROM screener_daily_quotes_receipts WHERE id=?').bind(receipt.id).first() }, { ...receipt });
        assert.equal(f.settled.length, 1); assert.equal(f.settled[0].requested, 1);
    } finally { f.db.close(); }
});
test('並行日期租約：只允許一個來源請求，另一市場等待或重用', async () => {
    const f = fixture(); let resolve, started;
    try {
        const begin = new Promise(r => { started = r; });
        const original = f.options.fetchReport;
        const run = loadDailyQuotesBatch({ ...f.options, fetchReport: async () => { started(); await new Promise(r => { resolve = r; }); return original(); } });
        await begin;
        const second = await loadDailyQuotesBatch(f.options);
        assert.equal(second.reason, 'daily_quotes_lease_busy'); assert.equal(second.requested, 0);
        resolve(); await run;
        assert.equal((await loadDailyQuotesBatch(f.options)).requested, 0); assert.equal(f.calls(), 1);
    } finally { f.db.close(); }
});
test('review／authority／schema缺少時零請求', async () => {
    const f = fixture(), legacy = new SqliteD1();
    try {
        for (const patch of [{ review: null }, { gate: { ...f.options.gate, validThrough: at } },
            { gate: { ...f.options.gate, commonSessions: [] } }, { gate: { ...f.options.gate, universeStatus: 'unknown' } }, { db: legacy }]) {
            const result = await loadDailyQuotesBatch({ ...f.options, ...patch });
            assert.equal(result.state, 'pending'); assert.equal(result.requested, 0);
        }
        assert.equal(f.calls(), 0);
    } finally { legacy.close(); f.db.close(); }
});
test('session非simulation／缺admission／預算拒絕均不發來源、不耗attempt', async () => {
    for (const patch of [{ safety: async () => ({ simulation: false }) }, { admission: null },
        { admission: { reserve: async () => ({ allowed: false }), settle: async () => {} } }]) {
        const f = fixture();
        try {
            const result = await loadDailyQuotesBatch({ ...f.options, ...patch });
            assert.equal(result.state, 'pending'); assert.equal(result.requested, 0); assert.equal(f.calls(), 0);
            assert.equal((await f.db.prepare('SELECT attempts FROM screener_daily_quotes_cache').first()).attempts, 0);
        } finally { f.db.close(); }
    }
});
test('admission後API generation變更拒絕且release，原attempt保持0', async () => {
    const f = fixture(); let n = 0;
    try {
        const result = await loadDailyQuotesBatch({ ...f.options, safety: async () => ({ simulation: true,
            businessSessionEstablished: true, observedAt: at, generation: `${n++}` }) });
        assert.equal(result.reason, 'simulation_generation_changed'); assert.equal(f.calls(), 0);
        assert.equal(f.settled.length, 1); assert.equal(f.settled[0].requested, 0);
    } finally { f.db.close(); }
});
test('錯日invalid不自動解除；保留失敗收據及attempt', async () => {
    const f = fixture();
    try {
        const p = payload(); p.Date[0] = '2026-10-01';
        const first = await loadDailyQuotesBatch({ ...f.options, fetchReport: async () => response(p) });
        assert.equal(first.reason, 'invalid_report_date');
        const receipt = await f.db.prepare("SELECT id,payload FROM screener_daily_quotes_receipts WHERE status='failed'").first();
        f.advance(3600000); const second = await loadDailyQuotesBatch(f.options);
        assert.equal(second.reason, 'invalid_report_date'); assert.equal(second.requested, 0);
        assert.equal(second.nextAttemptAt, null, 'invalid 沒有自動重試期限');
        assert.equal((await f.db.prepare('SELECT attempts FROM screener_daily_quotes_cache').first()).attempts, 1);
        assert.equal((await f.db.prepare('SELECT payload FROM screener_daily_quotes_receipts WHERE id=?').bind(receipt.id).first()).payload, receipt.payload);
    } finally { f.db.close(); }
});
test('429尊重Retry-After至少1小時，冷卻中不抓不reset', async () => {
    const f = fixture();
    try {
        const result = await loadDailyQuotesBatch({ ...f.options, fetchReport: async () => ({ ...response(), status: 429, retryAfter: '7200' }) });
        assert.equal(Date.parse(result.nextAttemptAt) - Date.parse(at), 7200000);
        const saved = (await f.db.prepare('SELECT * FROM screener_daily_quotes_receipts ORDER BY id').all()).results;
        const waiting = await loadDailyQuotesBatch(f.options);
        assert.equal(waiting.reason, 'source_cooldown');
        assert.equal(waiting.nextAttemptAt, result.nextAttemptAt, '冷卻讀取必須保留原最早期限，不填現在時間');
        assert.deepEqual((await f.db.prepare('SELECT * FROM screener_daily_quotes_receipts ORDER BY id').all()).results, saved);
        assert.equal(f.calls(), 0); assert.equal((await f.db.prepare('SELECT attempts FROM screener_daily_quotes_cache').first()).attempts, 1);
    } finally { f.db.close(); }
});
test('空批次冷卻重讀揭露原期限，零來源／admission且不改原失敗或快取', async () => {
    const f = fixture(); let requests = 0, admissions = 0;
    try {
        const empty = Object.fromEntries(Object.keys(payload()).map(key => [key, []]));
        const first = await loadDailyQuotesBatch({ ...f.options, fetchReport: async () => { requests++; return response(empty); } });
        assert.equal(first.reason, 'source_not_published');
        const cache = await f.db.prepare('SELECT * FROM screener_daily_quotes_cache').first();
        const receipts = (await f.db.prepare('SELECT * FROM screener_daily_quotes_receipts ORDER BY id').all()).results;
        const waiting = await loadDailyQuotesBatch({ ...f.options,
            admission: { reserve: async () => { admissions++; throw new Error('must_not_reserve'); }, settle: async () => {} },
            fetchReport: async () => { requests++; throw new Error('must_not_fetch'); } });
        assert.equal(waiting.reason, 'source_cooldown'); assert.equal(waiting.requested, 0);
        assert.equal(waiting.nextAttemptAt, cache.next_attempt_at);
        assert.equal(requests, 1); assert.equal(admissions, 0);
        assert.deepEqual(await f.db.prepare('SELECT * FROM screener_daily_quotes_cache').first(), cache);
        assert.deepEqual((await f.db.prepare('SELECT * FROM screener_daily_quotes_receipts ORDER BY id').all()).results, receipts);
    } finally { f.db.close(); }
});
test('lease過期不能寫成功，原started保留，20分鐘內不立即重抓', async () => {
    const f = fixture();
    try {
        const result = await loadDailyQuotesBatch({ ...f.options, fetchReport: async () => { const r = response(); f.advance(61000); return r; } });
        assert.equal(result.reason, 'daily_quotes_lease_lost');
        assert.equal((await loadDailyQuotesBatch(f.options)).reason, 'source_cooldown');
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_daily_quotes_receipts WHERE status='complete'").first()).n, 0);
    } finally { f.db.close(); }
});
test('快取內容損毁時fail closed，不重抓或覆寫', async () => {
    const f = fixture();
    try {
        await loadDailyQuotesBatch(f.options);
        await f.db.prepare("UPDATE screener_daily_quotes_cache SET response_text='{}'").run();
        await assert.rejects(loadDailyQuotesBatch(f.options), /invalid_cached_report/); assert.equal(f.calls(), 1);
    } finally { f.db.close(); }
});

test('嘗試18次後不再請求，不影響官方批次或其他來源', async () => {
    const f = fixture();
    try {
        await loadDailyQuotesBatch({ ...f.options, fetchReport: async () => { throw new Error('source_connection_reset'); } });
        await f.db.prepare('UPDATE screener_daily_quotes_cache SET attempts=18,next_attempt_at=NULL').run();
        f.advance(1200001);
        const result = await loadDailyQuotesBatch(f.options);
        assert.equal(result.reason, 'source_attempts_exhausted'); assert.equal(result.requested, 0); assert.equal(f.calls(), 0);
        assert.equal(result.nextAttemptAt, null, '嘗試耗盡不得顯示自動恢復期限');
    } finally { f.db.close(); }
});
test('第二次session核對耗盡租約時不發請求、不記started且釋放額度', async () => {
    const f = fixture(); let checks = 0;
    try {
        const result = await loadDailyQuotesBatch({ ...f.options, safety: async () => {
            if (++checks === 2) f.advance(60001);
            return { simulation: true, businessSessionEstablished: true,
                observedAt: f.options.now().toISOString(), generation: 'fixture-generation' };
        } });
        assert.equal(result.reason, 'daily_quotes_lease_lost'); assert.equal(result.requested, 0); assert.equal(f.calls(), 0);
        assert.equal((await f.db.prepare('SELECT attempts FROM screener_daily_quotes_cache').first()).attempts, 0);
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_daily_quotes_receipts WHERE status='started'").first()).n, 0);
        assert.equal(f.settled.length, 1); assert.equal(f.settled[0].requested, 0);
    } finally { f.db.close(); }
});
test('review換版不能重置同日嘗試、invalid或覆寫凍結批次', async () => {
    const f = fixture();
    try {
        await loadDailyQuotesBatch(f.options);
        await assert.rejects(loadDailyQuotesBatch({ ...f.options, review: { ...review, evidenceHash: 'c'.repeat(64) } }), /invalid_stored_review/);
        assert.equal(f.calls(), 1);
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_daily_quotes_cache').first()).n, 1);
    } finally { f.db.close(); }
});
test('Retry-After超過7日仍完整尊重，不截成提早重試', async () => {
    const f = fixture();
    try {
        const result = await loadDailyQuotesBatch({ ...f.options, fetchReport: async () => ({ ...response(), status: 429, retryAfter: '691200' }) });
        assert.equal(Date.parse(result.nextAttemptAt) - Date.parse(at), 8 * 86400000);
    } finally { f.db.close(); }
});
test('任意錯誤訊息不寫入收據；有界error code保存', async () => {
    const f = fixture();
    try {
        const result = await loadDailyQuotesBatch({ ...f.options, fetchReport: async () => { throw new Error('fixture-sensitive-text'); } });
        assert.equal(result.reason, 'source_transport_failed');
        const rows = (await f.db.prepare('SELECT payload FROM screener_daily_quotes_receipts').all()).results;
        assert(rows.every(r => !r.payload.includes('fixture-sensitive-text')));
    } finally { f.db.close(); }
});

function transport(responseOptions = {}) {
    let calls = 0, saved, stream;
    const request = (url, options, callback) => {
        calls++; const req = new EventEmitter(); req.destroy = () => {};
        req.end = body => {
            saved = { url, options, body };
            queueMicrotask(() => {
                stream = new EventEmitter(); stream.statusCode = responseOptions.status ?? 200;
                stream.headers = responseOptions.headers ?? {}; stream.destroy = () => {};
                callback(stream);
                if (responseOptions.hang) return;
                stream.emit('data', Buffer.from(responseOptions.text ?? JSON.stringify(payload()))); stream.emit('end');
            });
        };
        return req;
    };
    return { request, calls: () => calls, saved: () => saved, stream: () => stream };
}
test('transport只一次固定loopback POST，不帶憑證、不跟302', async () => {
    const t = transport({ status: 302, headers: { location: 'https://example.com' } });
    const result = await createDailyQuotesFetcher({ request: t.request })(date);
    assert.equal(result.status, 302); assert.equal(t.calls(), 1);
    assert.equal(t.saved().url, DAILY_QUOTES_URL); assert.equal(t.saved().options.method, 'POST');
    assert.deepEqual(JSON.parse(t.saved().body), { date, exclude: true });
    assert.deepEqual(Object.keys(t.saved().options.headers).sort(), ['Accept', 'Accept-Encoding', 'Content-Length', 'Content-Type'].sort());
});
test('response硬上限、整體deadline與預先abort均有界', async () => {
    const huge = transport(); await assert.rejects(createDailyQuotesFetcher({ request: huge.request, maxBytes: 10 })(date), /invalid_source_size/);
    const hang = transport({ hang: true }); await assert.rejects(createDailyQuotesFetcher({ request: hang.request, timeoutMs: 10 })(date), /source_timeout/);
    const aborted = new AbortController(); aborted.abort(); const t = transport();
    await assert.rejects(createDailyQuotesFetcher({ request: t.request })(date, aborted.signal), /source_aborted/); assert.equal(t.calls(), 0);
    await assert.rejects(createDailyQuotesFetcher({ request: t.request })('2026-02-30'), /invalid_source_target/); assert.equal(t.calls(), 0);
});
test('半份response被中止或使用者途中abort不能當完整成功', async () => {
    const partial = transport({ hang: true });
    const run = createDailyQuotesFetcher({ request: partial.request })(date);
    await Promise.resolve();
    partial.stream().emit('data', Buffer.from('{"Date":['));
    partial.stream().emit('aborted');
    await assert.rejects(run, /source_response_aborted/);
    const t = transport({ hang: true }), controller = new AbortController();
    const abortRun = createDailyQuotesFetcher({ request: t.request })(date, controller.signal);
    await Promise.resolve(); controller.abort();
    await assert.rejects(abortRun, /source_aborted/);
});
