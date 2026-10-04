import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { prepareBollingerHistory } from '../../../scripts/stock-screener-bollinger-prepare.ts';
import { bollingerSourceUrl, MAX_BOLLINGER_REPORT_ROWS, parseBollingerOfficialReport, projectBollingerReport } from '../../../src/lib/stock-screener-bollinger-source.ts';
import { DEFAULT_BOLLINGER_SQUEEZE, SCREENER_V8_MAPPING_VERSION } from '../../../src/lib/stock-screener-v8.ts';
import { createBollingerSourceFetcher } from '../../../scripts/stock-screener-bollinger-source-fetch.mjs';
import { EventEmitter } from 'node:events';

// 隔離 fixture grid，不代表官方交易日或正式來源契約成立。
const sessions = Array.from({ length: 180 }, (_, i) => new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10));
const start = Date.parse('2026-10-03T04:00:00Z');
const migrations = await Promise.all(['0027_pale_randall_flagg.sql', '0035_screener_bollinger_history.sql']
    .map(name => readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8')));
const review = market => ({ status: 'verified', market, mappingVersion: SCREENER_V8_MAPPING_VERSION,
    volumeUnit: 'shares', turnoverUnit: 'TWD', usage: 'local-historical-screener',
    endpoint: new URL(bollingerSourceUrl(market, sessions.at(-1))).origin + new URL(bollingerSourceUrl(market, sessions.at(-1))).pathname,
    evidenceHash: 'a'.repeat(64), reviewedAt: '2026-10-01T00:00:00Z', validThrough: '2026-10-04T00:00:00Z', minimumRows: 2 });
const stock = (code, market = 'TWSE', listingDate = null) => ({ symbol: `${code}.${market === 'TWSE' ? 'TW' : 'TWO'}`, code,
    name: `fixture-${code}`, market, listingDate });
const fields = market => market === 'TWSE'
    ? ['證券代號', '成交股數', '成交金額', '開盤價', '最高價', '最低價', '收盤價']
    : ['代號', '成交股數', '成交金額(元)', '開盤', '最高', '最低', '收盤'];
const response = (target, clock, rows) => {
    const data = rows ?? (target.market === 'TWSE' ? [['2449', '1,200', '150,001', '100', '102', '99', '101'],
        ['2330', '1,000', '121,234', '100', '102', '99', '101']]
        : [['6488', '1,200', '150,001', '100', '102', '99', '101'], ['6510', '1,000', '121,234', '100', '102', '99', '101']]);
    const table = { fields: fields(target.market), data };
    return { status: 200, fetchedAt: clock().toISOString(), sourceUrl: bollingerSourceUrl(target.market, target.sessionDate),
        text: JSON.stringify({ stat: 'OK', date: target.sessionDate.replaceAll('-', ''),
            tables: target.market === 'TWSE' ? [table] : [{ ...table, data: data.slice(0, 1) }, { ...table, data: data.slice(1) }] }) };
};
function fixture() {
    const db = new SqliteD1(); migrations.forEach(sql => applyDrizzleSql(db, sql));
    let ms = start, requests = [];
    const now = () => new Date(ms);
    const o = { db, calendar: { status: 'verified', commonSessions: sessions, authorityHash: 'b'.repeat(64), validThrough: '2026-10-04T00:00:00Z' },
        through: sessions.at(-1), criteria: { ...structuredClone(DEFAULT_BOLLINGER_SQUEEZE), enabled: true }, profileRevision: 'profile-1',
        universeRevision: 'universe-1', universe: [stock('2449'), stock('6488', 'TPEx')], reviews: { TWSE: review('TWSE'), TPEx: review('TPEx') },
        trigger: 'manual', now, fetchReport: async target => { requests.push(target); return response(target, now); } };
    return { db, o, requests, now, advance: delta => { ms += delta; } };
}
test('原始欄位量與金額分開 canonical 保存；未知金額不以收盤價乘量替代', async () => {
    const f = fixture();
    try {
        const t = { market: 'TWSE', sessionDate: sessions.at(-1) };
        const parsed = await parseBollingerOfficialReport(response(t, f.now, [
            ['2449', '9,007,199,254,740,993', '90,071,992,547,409,939', '100', '102', '99', '101'],
            ['2330', '100', '--', '100', '102', '99', '101']]), 'TWSE', t.sessionDate, review('TWSE'), f.now());
        assert.equal(parsed.points[0].bar.volumeShares, '9007199254740993');
        assert.equal(parsed.points[0].bar.turnoverNtd, '90071992547409939');
        assert.equal(parsed.points[1].bar.turnoverNtd, null);
        assert.equal(parsed.points[1].readiness, 'missing_turnover');
        assert.match(parsed.payloadHash, /^[a-f0-9]{64}$/);
    } finally { f.db.close(); }
});
test('TPEx 原始日報超過一萬列仍合法，普通股投影與來源收據不混入權證', async () => {
    const f = fixture();
    try {
        const rows = response({ market: 'TPEx', sessionDate: sessions.at(-1) }, f.now);
        const payload = JSON.parse(rows.text);
        payload.tables[0].data.push(...Array.from({ length: 11926 }, (_, i) =>
            [`W${String(i).padStart(5, '0')}`, '10', '1000', '100', '102', '99', '101']));
        const recovered = { ...rows, text: JSON.stringify(payload) };
        const parsed = await parseBollingerOfficialReport(recovered, 'TPEx', sessions.at(-1), review('TPEx'), f.now());
        assert.equal(parsed.points.length, 11928);
        const projection = projectBollingerReport(parsed, f.o.universe);
        assert.deepEqual(projection.map(p => [p.symbol, p.readiness]), [['6488.TWO', 'ready']]);
        const original = f.o.fetchReport;
        f.o.fetchReport = target => target.market === 'TPEx' ? recovered : original(target);
        const prepared = await prepareBollingerHistory(f.o);
        assert.equal(prepared.processed, 2);
        const batch = await f.db.prepare("SELECT report FROM screener_bollinger_batches WHERE market='TPEx'").first();
        assert.equal(JSON.parse(batch.report).report.points.length, 11928);
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_bollinger_daily WHERE market='TPEx'").first()).n, 1);
    } finally { f.db.close(); }
});
test('原始日報列數上限合計兩表，達上限可解析、超過上限拒絕', async () => {
    const f = fixture();
    try {
        const target = { market: 'TPEx', sessionDate: sessions.at(-1) };
        const rows = Array.from({ length: MAX_BOLLINGER_REPORT_ROWS }, (_, i) =>
            [`W${String(i).padStart(5, '0')}`, '10', '1000', '100', '102', '99', '101']);
        const parsed = await parseBollingerOfficialReport(response(target, f.now, rows), 'TPEx', target.sessionDate, review('TPEx'), f.now());
        assert.equal(parsed.points.length, MAX_BOLLINGER_REPORT_ROWS);
        await assert.rejects(parseBollingerOfficialReport(response(target, f.now, [...rows,
            ['W99999', '10', '1000', '100', '102', '99', '101']]), 'TPEx', target.sessionDate, review('TPEx'), f.now()),
        /invalid_report_universe/);
    } finally { f.db.close(); }
});
test('超過一萬列日報仍拒絕跨表重複代碼，不靠截斷或去重掩蓋資料錯誤', async () => {
    const f = fixture();
    try {
        const target = { market: 'TPEx', sessionDate: sessions.at(-1) };
        const rows = Array.from({ length: 11928 }, (_, i) =>
            [`W${String(i).padStart(5, '0')}`, '10', '1000', '100', '102', '99', '101']);
        rows[rows.length - 1] = rows[0];
        await assert.rejects(parseBollingerOfficialReport(response(target, f.now, rows), 'TPEx', target.sessionDate, review('TPEx'), f.now()),
            /invalid_report_universe/);
    } finally { f.db.close(); }
});
test('逐商品保留上市前、下市後、明確停牌、無成交及來源缺失，不造K棒', async () => {
    const f = fixture();
    try {
        const t = { market: 'TWSE', sessionDate: sessions.at(-1) };
        const parsed = await parseBollingerOfficialReport(response(t, f.now, [
            ['2449', '0', '0', '--', '--', '--', '--'], ['2330', '100', '10100', '100', '102', '99', '101']]), 'TWSE', t.sessionDate, review('TWSE'), f.now());
        const projected = projectBollingerReport(parsed, [stock('2449'), stock('9999'), stock('8888', 'TWSE', '2027-01-01'),
            { ...stock('7777'), delistingDate: '2025-01-01' }, { ...stock('2330'), suspendedSessions: [t.sessionDate] }]);
        assert.deepEqual(projected.map(r => r.readiness), ['no_trade', 'source_missing', 'before_listing', 'after_delisting', 'suspended']);
        assert(projected.every(r => r.bar === null));
    } finally { f.db.close(); }
});
test('未驗證來源與calendar不足不發請求，不寫成功或偽造休市', async () => {
    const f = fixture();
    try {
        const result = await prepareBollingerHistory({ ...f.o, reviews: {} });
        assert.equal(result.reason, 'source_contract_pending'); assert.equal(f.requests.length, 0);
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_runs').first()).n, 0);
        const pending = await prepareBollingerHistory({ ...f.o, calendar: { ...f.o.calendar, commonSessions: sessions.slice(-130) } });
        assert.equal(pending.state, 'history_pending'); assert.equal(f.requests.length, 0);
    } finally { f.db.close(); }
});
test('最新日期優先、每輪有界、重跑只續缺項，已完成市場不重抓', async () => {
    const f = fixture();
    try {
        const one = await prepareBollingerHistory(f.o);
        assert.equal(one.requested, 2); assert.equal(one.processed, 2); assert.equal(one.remaining, 318);
        assert.deepEqual(f.requests.map(t => [t.market, t.sessionDate]), [['TWSE', sessions.at(-1)], ['TPEx', sessions.at(-1)]]);
        const two = await prepareBollingerHistory(f.o);
        assert.equal(two.requested, 2); assert.equal(two.processed, 4);
        assert.equal(f.requests[2].sessionDate, sessions.at(-2));
        const row = await f.db.prepare("SELECT payload FROM screener_bollinger_daily WHERE symbol='2449.TW' AND session_date=?").bind(sessions.at(-1)).first();
        const p = JSON.parse(row.payload); assert.equal(p.bar.turnoverNtd, '150001'); assert.equal(p.provenance.turnoverUnit, 'TWD');
        const plan = JSON.parse((await f.db.prepare("SELECT checkpoint FROM screener_runs WHERE scope='screener-bollinger-history-plan'").first()).checkpoint);
        assert.equal(plan.sessions.length, 160); assert.equal(plan.processed, 4);
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_bollinger_receipts WHERE status='complete'").first()).n, 4);
    } finally { f.db.close(); }
});
test('來源schema／日期invalid持久化且不自動解除，另一市場仍可推進', async () => {
    const f = fixture();
    try {
        const original = f.o.fetchReport;
        f.o.fetchReport = async t => {
            if (t.market === 'TPEx') return original(t);
            f.requests.push(t); return { ...response(t, f.now), text: '<html>failure</html>' };
        };
        await prepareBollingerHistory(f.o);
        const before = f.requests.length;
        f.advance(3600000); f.o.fetchReport = original;
        await prepareBollingerHistory(f.o);
        assert.equal(f.requests.slice(before).filter(t => t.sessionDate === sessions.at(-1) && t.market === 'TWSE').length, 0);
        const row = await f.db.prepare("SELECT status,reason FROM screener_bollinger_batches WHERE market='TWSE' AND session_date=?").bind(sessions.at(-1)).first();
        assert.deepEqual({ ...row }, { status: 'invalid', reason: 'invalid_report_schema' });
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_bollinger_receipts WHERE status='failed'").first()).n, 1);
        assert(f.o.calendar.commonSessions.includes(sessions.at(-1)));
        await assert.rejects(parseBollingerOfficialReport({ ...response({ market: 'TWSE', sessionDate: sessions.at(-1) }, f.now),
            text: JSON.stringify({ date: '20250101', stat: 'OK', tables: [] }) }, 'TWSE', sessions.at(-1), review('TWSE'), f.now()), /invalid_report_date/);
    } finally { f.db.close(); }
});
test('429尊重Retry-After至少一小時；冷卻重觸發不重置attempt或失敗收據', async () => {
    const f = fixture();
    try {
        f.o.fetchReport = async t => { f.requests.push(t); return { ...response(t, f.now), status: 429, retryAfter: '7200' }; };
        const first = await prepareBollingerHistory(f.o);
        assert.equal(first.nextAttemptAt, new Date(start + 7200000).toISOString());
        const count = (await f.db.prepare("SELECT COUNT(*) n FROM screener_bollinger_receipts WHERE status='partial'").first()).n;
        await prepareBollingerHistory({ ...f.o, budget: { maxRequests: 1, maxBytes: 8000000, maxDurationMs: 900000 } });
        assert.equal(f.requests.filter(t => t.sessionDate === sessions.at(-1)).length, 2);
        assert.equal((await f.db.prepare("SELECT attempts FROM screener_bollinger_batches WHERE market='TWSE' AND session_date=?").bind(sessions.at(-1)).first()).attempts, 1);
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_bollinger_receipts WHERE status='partial'").first()).n, count + 1);
    } finally { f.db.close(); }
});
test('同市場日期來源嘗試最多18次，profile變動不清除耗盡狀態', async () => {
    const f = fixture();
    try {
        const t = { market: 'TWSE', sessionDate: sessions.at(-1) };
        await f.db.prepare("INSERT INTO screener_bollinger_batches VALUES(?,?,?,'pending',17,NULL,'source_transport_failed',NULL,?)")
            .bind(`bollinger-history-v1|TWSE|${t.sessionDate}`, 'TWSE', t.sessionDate, f.now().toISOString()).run();
        f.o.fetchReport = async target => { f.requests.push(target); throw new Error('ECONNRESET'); };
        await prepareBollingerHistory({ ...f.o, budget: { maxRequests: 1, maxBytes: 8000000, maxDurationMs: 900000 } });
        const row = await f.db.prepare("SELECT status,attempts FROM screener_bollinger_batches WHERE market='TWSE'").first();
        assert.equal(row.status, 'exhausted'); assert.equal(row.attempts, 18);
        await prepareBollingerHistory({ ...f.o, profileRevision: 'profile-2' });
        assert.equal(f.requests.filter(r => r.market === 'TWSE' && r.sessionDate === t.sessionDate).length, 1);
    } finally { f.db.close(); }
});
test('真實transport失敗分類寫入新partial收據，冷卻期間保留舊失敗且不重抓', async () => {
    const f = fixture(); let count = 0;
    try {
        const fetcher = createBollingerSourceFetcher(() => {
            count++; const req = new EventEmitter();
            req.end = () => queueMicrotask(() => { req.emit('finish');
                req.emit('error', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })); });
            req.destroy = e => req.emit('error', e); return req;
        });
        const options = { ...f.o, fetchReport: fetcher, budget: { maxRequests: 1, maxBytes: 8000000, maxDurationMs: 900000 } };
        const result = await prepareBollingerHistory(options);
        assert.equal(result.reason, 'source_connection_reset'); assert.equal(count, 1);
        const before = await f.db.prepare("SELECT id,payload FROM screener_bollinger_receipts WHERE status='partial'").first();
        const p = JSON.parse(before.payload); assert.equal(p.reason, 'source_connection_reset');
        assert.equal(p.transport.code, 'ECONNRESET'); assert.equal(p.transport.statusCode, null);
        assert.equal(p.transport.phase, 'request_sent'); assert.equal(p.transport.bytes, 0);
        // 第二輪最多只處理另一市場；原市場冷卻中，不重試或改寫第一份收據。
        await prepareBollingerHistory(options); assert.equal(count, 2);
        const after = await f.db.prepare('SELECT payload FROM screener_bollinger_receipts WHERE id=?').bind(before.id).first();
        assert.equal(after.payload, before.payload);
        assert.equal((await f.db.prepare("SELECT attempts FROM screener_bollinger_batches WHERE market='TWSE'").first()).attempts, 1);
    } finally { f.db.close(); }
});
test('並行單一lease，第二個程序不抓來源，第一個成功receipt保留', async () => {
    const f = fixture(); let resolve;
    try {
        let started;
        const signal = new Promise(r => { started = r; });
        const original = f.o.fetchReport;
        f.o.fetchReport = async t => { started(); await new Promise(r => { resolve = r; }); return original(t); };
        const run = prepareBollingerHistory({ ...f.o, budget: { maxRequests: 1, maxBytes: 8000000, maxDurationMs: 900000 } });
        await signal;
        const second = await prepareBollingerHistory(f.o); assert.equal(second.reason, 'lease_busy');
        resolve(); await run; assert.equal(f.requests.length, 1);
    } finally { f.db.close(); }
});
test('中止後既有完成資料保留；過期owner不得寫完成，冷卻到期只續缺項', async () => {
    const f = fixture();
    try {
        const original = f.o.fetchReport;
        let n = 0;
        f.o.fetchReport = async t => { n++; const r = await original(t); if (n === 2) f.advance(900001); return r; };
        const first = await prepareBollingerHistory(f.o);
        assert.equal(first.processed, 1); assert.equal(first.reason, 'run_deadline');
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_bollinger_receipts WHERE status='complete'").first()).n, 1);
        f.advance(1200000); f.o.fetchReport = original;
        await prepareBollingerHistory(f.o);
        assert.equal(f.requests.filter(t => t.market === 'TWSE' && t.sessionDate === sessions.at(-1)).length, 1);
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_bollinger_receipts WHERE status='run_partial'").first()).n, 2);
    } finally { f.db.close(); }
});
test('已驗證market/date frozen batch可用於新母體，不重抓來源', async () => {
    const f = fixture();
    try {
        await prepareBollingerHistory(f.o);
        const next = await prepareBollingerHistory({ ...f.o, universeRevision: 'universe-2', universe: [...f.o.universe, stock('2330')] });
        assert.equal(next.processed, 4);
        assert.equal(f.requests.filter(t => t.sessionDate === sessions.at(-1)).length, 2);
        assert.equal((await f.db.prepare("SELECT readiness FROM screener_bollinger_daily WHERE symbol='2330.TW' AND session_date=?").bind(sessions.at(-1)).first()).readiness, 'ready');
    } finally { f.db.close(); }
});
test('投影中止使用已保存相同來源續跑，沒有重抓／覆寫／混版', async () => {
    const f = fixture();
    const batch = f.db.batch.bind(f.db);
    try {
        let failed = false;
        f.db.batch = statements => {
            if (!failed && statements.some(s => s.sql.includes('INSERT INTO screener_bollinger_daily'))) {
                failed = true; throw new Error('isolated_projection_stop');
            }
            return batch(statements);
        };
        const first = await prepareBollingerHistory(f.o);
        assert.equal(first.processed, 1);
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_bollinger_receipts WHERE status='source_verified'").first()).n, 2);
        const before = f.requests.length;
        await prepareBollingerHistory(f.o);
        assert.equal(f.requests.slice(before).filter(t => t.sessionDate === sessions.at(-1)).length, 0);
        const recovered = await f.db.prepare("SELECT payload FROM screener_bollinger_receipts WHERE status='projection_recovered'").first();
        assert.equal(JSON.parse(recovered.payload).requested, 0);
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_bollinger_daily WHERE session_date=?").bind(sessions.at(-1)).first()).n, 2);
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_bollinger_receipts WHERE status='partial'").first()).n, 1);
    } finally { f.db.close(); }
});
test('雙市場日期不一致僅保存合法市場，錯誤市場invalid、不建立混日完成', async () => {
    const f = fixture();
    try {
        const original = f.o.fetchReport;
        f.o.fetchReport = async t => {
            const r = await original(t);
            if (t.market !== 'TPEx') return r;
            const p = JSON.parse(r.text); p.date = sessions.at(-2).replaceAll('-', '');
            return { ...r, text: JSON.stringify(p) };
        };
        const result = await prepareBollingerHistory(f.o);
        assert.equal(result.processed, 1); assert.equal(result.state, 'pending');
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_bollinger_daily WHERE market='TPEx'").first()).n, 0);
        const row = await f.db.prepare("SELECT status,reason FROM screener_bollinger_batches WHERE market='TPEx'").first();
        assert.equal(row.status, 'invalid'); assert.equal(row.reason, 'invalid_report_date');
    } finally { f.db.close(); }
});
test('同一universe revision不接受不同清單，避免 immutable rows混用', async () => {
    const f = fixture();
    try {
        await prepareBollingerHistory(f.o);
        await assert.rejects(prepareBollingerHistory({ ...f.o, universe: [...f.o.universe, stock('2330')] }), /invalid_universe_revision/);
        assert.equal(f.requests.length, 2);
    } finally { f.db.close(); }
});
test('320個market/date有界續跑完成，完成重觸發零source request', async () => {
    const f = fixture();
    try {
        const options = { ...f.o, budget: { maxRequests: 18, maxBytes: 8000000, maxDurationMs: 900000 } };
        let result;
        for (let i = 0; i < 18; i++) result = await prepareBollingerHistory(options);
        assert.equal(result.state, 'complete'); assert.equal(result.remaining, 0); assert.equal(result.processed, 320);
        assert.equal(f.requests.length, 320);
        const unchanged = await prepareBollingerHistory(options);
        assert.equal(unchanged.state, 'complete'); assert.equal(unchanged.requested, 0);
        assert.equal(f.requests.length, 320);
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_bollinger_daily").first()).n, 320);
    } finally { f.db.close(); }
});
test('尚未安裝新schema的舊資料庫回pending，舊版資料不受影響', async () => {
    const f = fixture(), legacy = new SqliteD1();
    try {
        applyDrizzleSql(legacy, migrations[0]);
        const result = await prepareBollingerHistory({ ...f.o, db: legacy });
        assert.equal(result.reason, 'schema_pending'); assert.equal(result.requested, 0);
        assert.equal((await legacy.prepare('SELECT COUNT(*) n FROM screener_runs').first()).n, 0);
    } finally { legacy.close(); f.db.close(); }
});
