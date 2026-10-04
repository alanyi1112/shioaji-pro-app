import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { saveSourceReview, readSourceReview, freezeSourceSelection, readSourceSelection, sourceWindowMapping,
    compareRestoredOfficialSource, sourceSelectionSchemaReady } from '../../../scripts/stock-screener-source-selection.mjs';
import { loadDailyQuotesBatch, DAILY_QUOTES_MAPPING, DAILY_QUOTES_URL } from '../../../scripts/stock-screener-shioaji-daily-quotes.mjs';
import { bollingerUniverseHash, bollingerSourceUrl, parseBollingerOfficialReport } from '../../../src/lib/stock-screener-bollinger-source.ts';
import { SCREENER_V8_MAPPING_VERSION } from '../../../src/lib/stock-screener-v8.ts';
import { assessSourceComparison, compareSourceVolume, compareSourceTurnover, BOLLINGER_SOURCE_COMPARISON_POLICY,
    BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY } from '../../../src/lib/stock-screener-source-comparison.ts';
import { technicalEvidenceHash } from '../../../src/lib/stock-screener-technical-patterns.ts';

// 全部來源 review、日期、simulation safety、raw response／receipt 為隔離 fixture；沒有來源 HTTP 或正式啟用。
const date = '2026-10-02', at = '2026-10-03T07:00:00Z', now = () => new Date(at);
const review = { status: 'verified', provider: 'shioaji-daily-quotes', endpoint: DAILY_QUOTES_URL,
    mappingVersion: DAILY_QUOTES_MAPPING, volumeUnit: 'shares', turnoverUnit: 'TWD', priceBasis: 'unadjusted',
    tradeScope: 'official-daily-compatible', usage: 'local-historical-screener', localDisplayVerified: true,
    markets: ['TWSE', 'TPEx'], evidenceHash: 'a'.repeat(64), reviewedAt: '2026-10-03T06:00:00Z',
    validThrough: '2026-10-04T06:00:00Z', minimumRows: 2 };
const universe = [{ symbol: '2449.TW', code: '2449', name: 'fixture-2449', market: 'TWSE', listingDate: null },
    { symbol: '6488.TWO', code: '6488', name: 'fixture-6488', market: 'TPEx', listingDate: null }];
const payload = () => ({ Date: [date, date], Code: ['2449', '6488'], Open: [100, 500], High: [102, 502], Low: [99, 499],
    Close: [101, 501], Volume: [1200, 4000], Transaction: [20, 100], Amount: [121000, 2000000] });
const response = () => ({ sourceUrl: DAILY_QUOTES_URL, status: 200, fetchedAt: at, text: JSON.stringify(payload()) });
const gate = { calendarStatus: 'verified', authorityHash: 'b'.repeat(64), commonSessions: [date],
    validThrough: review.validThrough, universeStatus: 'verified' };
const migrations = await Promise.all(['0035_screener_bollinger_history.sql', '0037_screener_daily_quotes_cache.sql',
    '0038_screener_source_selection.sql'].map(f => readFile(new URL(`../drizzle/${f}`, import.meta.url), 'utf8')));
async function fixture() {
    const db = new SqliteD1(); for (const migration of migrations) applyDrizzleSql(db, migration);
    const r = await saveSourceReview(db, { provider: 'shioaji-daily-quotes', review }, now());
    await loadDailyQuotesBatch({ db, sessionDate: date, review, gate, now,
        safety: async () => ({ simulation: true, businessSessionEstablished: true, observedAt: at, generation: 'fixture-generation' }),
        admission: { reserve: async () => ({ allowed: true, reservationId: 'fixture-reservation' }), settle: async () => {} },
        fetchReport: async () => response() });
    const receipt = await db.prepare("SELECT id FROM screener_daily_quotes_receipts WHERE status='complete'").first();
    const options = { db, provider: 'shioaji-daily-quotes', reviewId: r.id, market: 'TWSE', sessionDate: date,
        universeRevision: 'fixture-universe', universe, response: response(), fetchReceiptId: receipt.id, gate,
        switchReason: 'official_contract_pending', now };
    return { db, options };
}
async function official(db, market = 'TWSE', patch = {}) {
    const provider = market === 'TWSE' ? 'official-twse' : 'official-tpex';
    const url = new URL(bollingerSourceUrl(market, date));
    const r = { ...review, provider: undefined, markets: undefined, market,
        endpoint: url.origin + url.pathname, mappingVersion: SCREENER_V8_MAPPING_VERSION, minimumRows: 1,
        evidenceHash: (market === 'TWSE' ? 'c' : 'd').repeat(64) };
    delete r.provider; delete r.markets;
    const saved = await saveSourceReview(db, { provider, review: r }, now());
    const values = market === 'TWSE' ? ['2449', '1200', '121000', '100', '102', '99', '101']
        : ['6488', '4000', '2000000', '500', '502', '499', '501'];
    Object.assign(values, patch);
    const fields = market === 'TWSE' ? ['證券代號', '成交股數', '成交金額', '開盤價', '最高價', '最低價', '收盤價']
        : ['代號', '成交股數', '成交金額(元)', '開盤', '最高', '最低', '收盤'];
    const response = { sourceUrl: bollingerSourceUrl(market, date), status: 200, fetchedAt: at,
        text: JSON.stringify({ date: date.replaceAll('-', ''), stat: 'OK', tables: market === 'TWSE'
            ? [{ fields, data: [values] }] : [{ fields, data: [values] }, { fields, data: [] }] }) };
    const report = await parseBollingerOfficialReport(response, market, date, r, now());
    const fetchReceiptId = crypto.randomUUID();
    await db.prepare('INSERT INTO screener_bollinger_receipts VALUES(?,?,?,?,?,?)')
        .bind(fetchReceiptId, 'fixture-official', 'fixture-run', 'complete', JSON.stringify({ market, sessionDate: date,
            payloadHash: report.payloadHash, reviewHash: report.reviewHash }), at).run();
    return { provider, market, sessionDate: date, reviewId: saved.id, response, fetchReceiptId, universe, now };
}
test('review immutable／同鍵no-op，pending與verified各自保留不自動解除', async () => {
    const f = await fixture();
    try {
        const id = f.options.reviewId;
        assert.equal((await saveSourceReview(f.db, { provider: 'shioaji-daily-quotes', review }, now())).id, id);
        const pending = { status: 'pending', evidenceHash: 'e'.repeat(64), reviewedAt: review.reviewedAt, validThrough: review.validThrough };
        await saveSourceReview(f.db, { provider: 'shioaji-daily-quotes', review: pending, reason: 'source_contract_pending' }, now());
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_source_reviews').first()).n, 2);
        await assert.rejects(saveSourceReview(f.db, { provider: 'shioaji-daily-quotes', review: { ...review, minimumRows: 3 } }, now()), /invalid_review_revision/);
    } finally { f.db.close(); }
});
test('review 拒絕秘密欄位、任意 URL／訊息、技術範圍 unknown、公開用途及到期', async () => {
    const f = await fixture();
    try {
        for (const patch of [{ token: 'fixture-sensitive' }, { endpoint: 'http://127.0.0.1:8080/?secret=fixture' },
            { tradeScope: 'unknown' }, { usage: 'public-redistribution' }, { validThrough: at }])
            await assert.rejects(saveSourceReview(f.db, { provider: 'shioaji-daily-quotes', review: { ...review, ...patch } }, now()));
        await assert.rejects(saveSourceReview(f.db, { provider: 'shioaji-daily-quotes', review: { ...review, status: 'pending' }, reason: 'source_fixtureSensitive' }, now()));
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_source_reviews').first()).n, 1);
    } finally { f.db.close(); }
});
test('Shioaji 個人本機用途無額外展示許可 Gate，官網來源限制與舊 review 原值仍保留', async () => {
    const f = await fixture();
    try {
        const local = { ...review, evidenceHash: 'e'.repeat(64) }; delete local.localDisplayVerified;
        const saved = await saveSourceReview(f.db, { provider: 'shioaji-daily-quotes', review: local }, now());
        assert.equal(Object.hasOwn((await readSourceReview(f.db, saved.id, now())).review, 'localDisplayVerified'), false);
        const legacy = await saveSourceReview(f.db, { provider: 'shioaji-daily-quotes', review: { ...review,
            evidenceHash: 'f'.repeat(64), localDisplayVerified: false } }, now());
        assert.equal((await readSourceReview(f.db, legacy.id, now())).review.localDisplayVerified, false);
        assert.equal((await readSourceReview(f.db, f.options.reviewId, now())).review.localDisplayVerified, true);
        for (const market of ['TWSE', 'TPEx']) {
            const url = new URL(bollingerSourceUrl(market, date));
            const officialReview = { ...local, market, mappingVersion: SCREENER_V8_MAPPING_VERSION,
                endpoint: url.origin + url.pathname, localDisplayVerified: false };
            delete officialReview.provider; delete officialReview.markets;
            await assert.rejects(saveSourceReview(f.db, { provider: market === 'TWSE' ? 'official-twse' : 'official-tpex',
                review: officialReview }, now()), /invalid_source_review/);
        }
    } finally { f.db.close(); }
});
test('review payload損毀時fail closed，不覆寫', async () => {
    const f = await fixture();
    try {
        await f.db.prepare("UPDATE screener_source_reviews SET payload='{}'").run();
        await assert.rejects(readSourceReview(f.db, f.options.reviewId), /invalid_stored_review/);
    } finally { f.db.close(); }
});
test('同一date cache供兩市場，逐列provenance與manifest固定收據／review', async () => {
    const f = await fixture();
    try {
        const tse = await freezeSourceSelection(f.options), otc = await freezeSourceSelection({ ...f.options, market: 'TPEx' });
        assert.equal(tse.state, 'complete'); assert.equal(otc.state, 'complete');
        assert.equal(tse.manifest.payloadHash, otc.manifest.payloadHash);
        assert.equal(tse.manifest.fetchReceiptId, otc.manifest.fetchReceiptId);
        assert.equal(tse.rows[0].provenance.provider, 'shioaji-daily-quotes');
        assert.equal(tse.rows[0].provenance.actualDate, date); assert.equal(tse.rows[0].bar.turnoverNtd, '121000');
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_daily_quotes_receipts WHERE status='complete'").first()).n, 1);
    } finally { f.db.close(); }
});
test('並行同一manifest只留一份，重跑不改時間／manifest／列', async () => {
    const f = await fixture();
    try {
        const [a, b] = await Promise.all([freezeSourceSelection(f.options), freezeSourceSelection(f.options)]);
        assert.equal(a.key, b.key);
        const before = await f.db.prepare('SELECT * FROM screener_source_selections').first();
        await freezeSourceSelection({ ...f.options, now: () => new Date('2026-10-03T07:30:00Z') });
        assert.deepEqual({ ...await f.db.prepare('SELECT * FROM screener_source_selections').first() }, { ...before });
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_source_selected_rows').first()).n, 1);
    } finally { f.db.close(); }
});
test('並行不同市場不能讓同universe revision凍結成兩套母體', async () => {
    const f = await fixture();
    try {
        const results = await Promise.allSettled([freezeSourceSelection(f.options), freezeSourceSelection({ ...f.options,
            market: 'TPEx', universe: universe.map(s => ({ ...s, name: `${s.name}-changed` })) })]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        assert.equal(results.find(r => r.status === 'rejected').reason.message, 'invalid_universe_revision');
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_source_selections').first()).n, 1);
    } finally { f.db.close(); }
});
test('official invalid／failure原件保留，備援manifest引用理由／hash', async () => {
    const f = await fixture();
    try {
        await f.db.prepare('INSERT INTO screener_bollinger_batches VALUES(?,?,?,?,?,?,?,?,?)')
            .bind('fixture-old', 'TWSE', date, 'invalid', 2, null, 'invalid_report_schema', null, at).run();
        await f.db.prepare('INSERT INTO screener_bollinger_receipts VALUES(?,?,?,?,?,?)')
            .bind('fixture-failed', 'fixture-old', 'fixture-run', 'failed', JSON.stringify({ market: 'TWSE', sessionDate: date, reason: 'invalid_report_schema' }), at).run();
        const original = await f.db.prepare('SELECT * FROM screener_bollinger_batches').first();
        const result = await freezeSourceSelection({ ...f.options, switchReason: 'official_source_failed', officialFailureReceiptIds: ['fixture-failed'] });
        assert.equal(result.manifest.officialFailures[0].id, 'fixture-failed');
        assert.match(result.manifest.officialFailures[0].hash, /^[a-f0-9]{64}$/);
        assert.deepEqual({ ...await f.db.prepare('SELECT * FROM screener_bollinger_batches').first() }, { ...original });
    } finally { f.db.close(); }
});
test('缺原來源收據或跨日期／市場失敗收據不能掛到manifest', async () => {
    const f = await fixture();
    try {
        await assert.rejects(freezeSourceSelection({ ...f.options, fetchReceiptId: 'missing' }), /source_receipt_missing/);
        await assert.rejects(freezeSourceSelection({ ...f.options, switchReason: 'official_source_failed' }), /invalid_source_switch_reason/);
        await f.db.prepare('INSERT INTO screener_bollinger_receipts VALUES(?,?,?,?,?,?)')
            .bind('wrong-market', 'fixture-old', 'fixture-run', 'partial', JSON.stringify({ market: 'TPEx', sessionDate: date, reason: 'source_connection_reset' }), at).run();
        await assert.rejects(freezeSourceSelection({ ...f.options, switchReason: 'official_source_failed', officialFailureReceiptIds: ['wrong-market'] }), /invalid_source_failure_receipt/);
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_source_selections').first()).n, 0);
    } finally { f.db.close(); }
});
test('raw response／cache／complete receipt不一致拒絕', async () => {
    const f = await fixture();
    try {
        const changed = payload(); changed.Amount[0]++;
        await assert.rejects(freezeSourceSelection({ ...f.options, response: { ...response(), text: JSON.stringify(changed) } }), /invalid_cached_report/);
        await f.db.prepare("UPDATE screener_daily_quotes_receipts SET payload='{}' WHERE status='complete'").run();
        await assert.rejects(freezeSourceSelection(f.options), /invalid_source_receipt/);
    } finally { f.db.close(); }
});
test('日曆缺口／過期、母體未驗證，不建立來源選擇', async () => {
    const f = await fixture();
    try {
        for (const patch of [{ commonSessions: [] }, { validThrough: at }, { universeStatus: 'unknown' }])
            await assert.rejects(freezeSourceSelection({ ...f.options, gate: { ...gate, ...patch } }), /source_authority_pending/);
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_source_selections').first()).n, 0);
    } finally { f.db.close(); }
});
test('已凍結後改source／switch reason或同revision換母體均拒絕', async () => {
    const f = await fixture();
    try {
        await freezeSourceSelection(f.options);
        const candidate = await official(f.db);
        await assert.rejects(freezeSourceSelection({ ...f.options, ...candidate, switchReason: null }), /source_selection_frozen/);
        await assert.rejects(freezeSourceSelection({ ...f.options, universe: [...universe, { ...universe[0], symbol: '9999.TW', code: '9999' }] }), /invalid_universe_revision/);
    } finally { f.db.close(); }
});
test('staging投影中止保留前批列，同一快取續跑不重抓、不換manifest', async () => {
    const f = await fixture();
    try {
        const stocks = [universe[1], ...Array.from({ length: 70 }, (_, i) => ({ ...universe[0], symbol: `${1000 + i}.TW`, code: String(1000 + i) }))];
        const abort = new AbortController(), original = f.db.batch.bind(f.db);
        f.db.batch = async statements => { const result = await original(statements); abort.abort(); return result; };
        const options = { ...f.options, universe: stocks };
        await assert.rejects(freezeSourceSelection({ ...options, signal: abort.signal }), /source_projection_aborted/);
        const record = await f.db.prepare('SELECT * FROM screener_source_selections').first();
        assert.equal(record.status, 'staging'); assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_source_selected_rows').first()).n, 50);
        await assert.rejects(readSourceSelection(f.db, record.selection_key), /source_selection_pending/);
        f.db.batch = original;
        const complete = await freezeSourceSelection(options);
        assert.equal(complete.rows.length, 70); assert.equal(complete.manifest.manifestHash, record.manifest_hash);
    } finally { f.db.close(); }
});
test('選擇列或manifest損毀不能讀成成功或由重跑覆寫', async () => {
    for (const table of ['screener_source_selected_rows', 'screener_source_selections']) {
        const f = await fixture();
        try {
            const frozen = await freezeSourceSelection(f.options);
            await f.db.prepare(table.endsWith('rows') ? "UPDATE screener_source_selected_rows SET payload='{}'" : "UPDATE screener_source_selections SET manifest='{}'").run();
            await assert.rejects(readSourceSelection(f.db, frozen.key), /invalid_source_/);
            await assert.rejects(freezeSourceSelection(f.options), /invalid_source_/);
        } finally { f.db.close(); }
    }
});
test('最後一批寫完後中止或authority到期仍不可切complete', async () => {
    for (const mode of ['abort', 'expired']) {
        const f = await fixture(), controller = new AbortController(); let time = Date.parse(at);
        try {
            const original = f.db.batch.bind(f.db);
            f.db.batch = async statements => {
                const result = await original(statements);
                if (mode === 'abort') controller.abort(); else time = Date.parse(gate.validThrough);
                return result;
            };
            await assert.rejects(freezeSourceSelection({ ...f.options, signal: controller.signal, now: () => new Date(time) }),
                mode === 'abort' ? /source_projection_aborted/ : /source_authority_pending/);
            const record = await f.db.prepare('SELECT * FROM screener_source_selections').first();
            assert.equal(record.status, 'staging'); assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_source_selected_rows').first()).n, 1);
            await assert.rejects(readSourceSelection(f.db, record.selection_key), /source_selection_pending/);
        } finally { f.db.close(); }
    }
});
test('窗口mapping必須雙市場／全部日期complete；順序固定且不能沿用舊官方mapping', async () => {
    const f = await fixture();
    try {
        const universeHash = await bollingerUniverseHash(universe);
        await freezeSourceSelection(f.options);
        await assert.rejects(sourceWindowMapping(f.db, { universeRevision: f.options.universeRevision, universeHash, sessions: [date] }), /source_selection_pending/);
        await freezeSourceSelection({ ...f.options, market: 'TPEx' });
        const a = await sourceWindowMapping(f.db, { universeRevision: f.options.universeRevision, universeHash, sessions: [date] });
        const b = await sourceWindowMapping(f.db, { universeRevision: f.options.universeRevision, universeHash, sessions: [date], markets: ['TPEx', 'TWSE'] });
        assert.equal(a.dataMappingVersion, b.dataMappingVersion); assert.notEqual(a.dataMappingVersion, SCREENER_V8_MAPPING_VERSION);
        assert.equal(a.manifest.entries.length, 2);
        await assert.rejects(sourceWindowMapping(f.db, { universeRevision: f.options.universeRevision, universeHash, sessions: [date, date] }), /invalid_source_window/);
    } finally { f.db.close(); }
});
test('官方恢復相符只追加matched；小數顯示不同不誤判衝突', async () => {
    const f = await fixture();
    try {
        const frozen = await freezeSourceSelection(f.options), candidate = await official(f.db, 'TWSE', { 3: '100.00' });
        const result = await compareRestoredOfficialSource({ db: f.db, selectionKey: frozen.key, ...candidate });
        assert.equal(result.status, 'matched');
        const again = await compareRestoredOfficialSource({ db: f.db, selectionKey: frozen.key, ...candidate });
        assert.equal(again.id, result.id); assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_source_comparisons').first()).n, 1);
        assert.deepEqual(await readSourceSelection(f.db, frozen.key), { key: frozen.key, manifest: frozen.manifest, rows: frozen.rows, dataMappingVersion: frozen.dataMappingVersion });
    } finally { f.db.close(); }
});
test('新版金額最多差1元追加matched，舊政策conflict／時間／凍結原值不改寫', async () => {
    const f = await fixture();
    try {
        const frozen = await freezeSourceSelection(f.options), candidate = await official(f.db, 'TWSE', { 2: '121001' });
        const before = await compareRestoredOfficialSource({ db: f.db, selectionKey: frozen.key, ...candidate });
        assert.equal(before.status, 'conflict');
        const old = await f.db.prepare('SELECT * FROM screener_source_comparisons WHERE id=?').bind(before.id).first();
        const options = { db: f.db, selectionKey: frozen.key, ...candidate, comparisonPolicy: BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY };
        const after = await compareRestoredOfficialSource(options);
        assert.equal(after.status, 'matched'); assert.notEqual(after.id, before.id);
        assert.equal(after.differences[0].verdict, 'within_source_tolerance');
        assert.equal(after.differences[0].turnoverDifferences.length, 2);
        assert.ok(after.differences[0].turnoverDifferences.every(d => d.absoluteDifferenceNtd === '1' && d.withinTolerance));
        assert.equal((await compareRestoredOfficialSource(options)).id, after.id);
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_source_comparisons').first()).n, 2);
        assert.deepEqual(await f.db.prepare('SELECT * FROM screener_source_comparisons WHERE id=?').bind(before.id).first(), old);
        assert.deepEqual(await readSourceSelection(f.db, frozen.key), { key: frozen.key, manifest: frozen.manifest,
            rows: frozen.rows, dataMappingVersion: frozen.dataMappingVersion });
        const over = await official(f.db, 'TWSE', { 2: '121002' });
        assert.equal((await compareRestoredOfficialSource({ ...options, ...over })).status, 'conflict');
    } finally { f.db.close(); }
});
test('金額整數容差正負1／零／int64精確；2元與其他欄位一律不放寬', () => {
    for (const [a,b] of [['100','101'], ['101','100'], ['0','1'], ['9223372036854775807','9223372036854775806']])
        assert.equal(compareSourceTurnover(a,b).withinTolerance, true);
    for (const [a,b] of [['100','102'], ['102','100'], ['9223372036854775807','9223372036854775805']])
        assert.equal(compareSourceTurnover(a,b).withinTolerance, false);
    for (const invalid of ['-1','1.0','1e2','9223372036854775808']) assert.throws(() => compareSourceTurnover(invalid,'1'));
    const raw = { readiness: 'ready', sourceAmounts: {volumeShares:'10000',turnoverNtd:'1000000'},
        bar: {sessionDate:date,open:'100',high:'102',low:'99',close:'101',volumeShares:'10000',turnoverNtd:'1000000'} };
    const amountOnly = structuredClone(raw); amountOnly.bar.turnoverNtd='1000001'; amountOnly.sourceAmounts.turnoverNtd='1000001';
    assert.equal(assessSourceComparison(raw,amountOnly).verdict,'conflict');
    assert.equal(assessSourceComparison(raw,amountOnly,BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY).verdict,'within_source_tolerance');
    for (const patch of [r=>{r.bar.close='102';},r=>{r.bar.sessionDate='2026-10-01';},r=>{r.readiness='source_missing';},
        r=>{r.bar=null;},r=>{r.sourceAmounts=null;},r=>{r.bar.volumeShares='9800';},r=>{r.bar.turnoverNtd='1000002';}]) {
        const changed=structuredClone(amountOnly); patch(changed);
        assert.equal(assessSourceComparison(raw,changed,BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY).verdict,'conflict');
    }
    assert.throws(()=>assessSourceComparison(raw,amountOnly,{...BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY,turnoverToleranceNtd:2}),/invalid_source_comparison_policy/);
});
test('官方恢復Amount不一致追加conflict，舊列／manifest／head不改寫', async () => {
    const f = await fixture();
    try {
        f.db.exec("CREATE TABLE fixture_head(payload TEXT); INSERT INTO fixture_head VALUES('unchanged')");
        const frozen = await freezeSourceSelection(f.options), candidate = await official(f.db, 'TWSE', { 2: '121001' });
        const result = await compareRestoredOfficialSource({ db: f.db, selectionKey: frozen.key, ...candidate });
        assert.equal(result.status, 'conflict'); assert.equal(result.differences[0].symbol, '2449.TW');
        assert.equal((await readSourceSelection(f.db, frozen.key)).rows[0].bar.turnoverNtd, '121000');
        assert.equal((await f.db.prepare('SELECT payload FROM fixture_head').first()).payload, 'unchanged');
    } finally { f.db.close(); }
});
test('成交量只差一股以新1%政策通過，仍保存差異／原值，不改manifest', async () => {
    const f = await fixture();
    try {
        const frozen = await freezeSourceSelection(f.options), candidate = await official(f.db, 'TWSE', { 1: '1201' });
        const result = await compareRestoredOfficialSource({ db: f.db, selectionKey: frozen.key, ...candidate });
        assert.equal(result.status, 'matched');
        assert.deepEqual(result.comparisonPolicy, BOLLINGER_SOURCE_COMPARISON_POLICY);
        assert.equal(result.differences[0].verdict, 'within_volume_tolerance');
        assert.equal(result.differences[0].volumeDifferences[0].absoluteDifferenceShares, '1');
        assert.equal(result.differences[0].frozen.bar.volumeShares, '1200');
        assert.equal(result.differences[0].official.bar.volumeShares, '1201');
        assert.equal((await readSourceSelection(f.db, frozen.key)).rows[0].bar.volumeShares, '1200');
        assert.equal((await readSourceSelection(f.db, frozen.key)).manifest.manifestHash, frozen.manifest.manifestHash);
    } finally { f.db.close(); }
});
test('1%包含等號、以上與以下對稱、官方零量與大int64皆用整數核對', () => {
    for (const [frozen, official, accepted] of [['101', '100', true], ['99', '100', true], ['102', '100', false],
        ['98', '100', false], ['1', '0', false], ['0', '1', false], ['0', '0', true],
        ['33342358', '33342359', true], ['9097271247288401920', '9007199254740992000', true],
        ['9097271247288401921', '9007199254740992000', false]])
        assert.equal(compareSourceVolume(frozen, official).withinTolerance, accepted, `${frozen}/${official}`);
    for (const bad of ['-1', '1.1', '01', 'NaN', '9223372036854775808'])
        assert.throws(() => compareSourceVolume(bad, '100'), /invalid_source_comparison_volume/);
});
test('容差不放寬價格／金額／日期／readiness或缺資料', () => {
    const raw = { readiness: 'ready', sourceAmounts: { volumeShares: '100', turnoverNtd: '10000' },
        bar: { sessionDate: date, open: '100', high: '102', low: '99', close: '101', volumeShares: '100', turnoverNtd: '10000' } };
    for (const patch of [r => { r.bar.close = '102'; }, r => { r.bar.turnoverNtd = '10001'; },
        r => { r.sourceAmounts.turnoverNtd = '10001'; }, r => { r.bar.sessionDate = '2026-10-01'; },
        r => { r.readiness = 'source_missing'; }, r => { r.bar = null; }, r => { r.sourceAmounts = null; }]) {
        const candidate = structuredClone(raw); patch(candidate);
        assert.equal(assessSourceComparison(raw, candidate).verdict, 'conflict');
    }
});
test('超過1%仍為conflict；新政策只追加，舊strict conflict與其時間原樣保存', async () => {
    const f = await fixture();
    try {
        const frozen = await freezeSourceSelection(f.options), candidate = await official(f.db, 'TWSE', { 1: '1201' });
        const result = await compareRestoredOfficialSource({ db: f.db, selectionKey: frozen.key, ...candidate });
        const { comparisonPolicy, ...oldBody } = result;
        delete oldBody.id; delete oldBody.status;
        oldBody.differences = oldBody.differences.map(({ symbol, frozen, official }) => ({ symbol, frozen, official }));
        const oldId = await technicalEvidenceHash(oldBody), originalAt = '2026-10-03T06:30:00Z';
        await f.db.prepare('INSERT INTO screener_source_comparisons VALUES(?,?,?,?,?)')
            .bind(oldId, frozen.key, 'conflict', JSON.stringify(oldBody), originalAt).run();
        const original = await f.db.prepare('SELECT * FROM screener_source_comparisons WHERE id=?').bind(oldId).first();
        const repeated = await compareRestoredOfficialSource({ db: f.db, selectionKey: frozen.key, ...candidate });
        assert.equal(repeated.id, result.id); assert.notEqual(repeated.id, oldId);
        assert.deepEqual(await f.db.prepare('SELECT * FROM screener_source_comparisons WHERE id=?').bind(oldId).first(), original);
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_source_comparisons').first()).n, 2);
        const over = await official(f.db, 'TWSE', { 1: '1180' });
        assert.equal((await compareRestoredOfficialSource({ db: f.db, selectionKey: frozen.key, ...over })).status, 'conflict');
        assert.equal((await readSourceSelection(f.db, frozen.key)).rows[0].bar.volumeShares, '1200');
    } finally { f.db.close(); }
});
test('上櫃官方恢復也可核對；錯市場或未驗證收據不能追加比較', async () => {
    const f = await fixture();
    try {
        const frozen = await freezeSourceSelection({ ...f.options, market: 'TPEx' }), candidate = await official(f.db, 'TPEx');
        assert.equal((await compareRestoredOfficialSource({ db: f.db, selectionKey: frozen.key, ...candidate })).status, 'matched');
        await assert.rejects(compareRestoredOfficialSource({ db: f.db, selectionKey: frozen.key, ...candidate, market: 'TWSE' }), /invalid_source_comparison/);
        await assert.rejects(compareRestoredOfficialSource({ db: f.db, selectionKey: frozen.key, ...candidate, fetchReceiptId: 'missing' }), /source_receipt_missing/);
    } finally { f.db.close(); }
});
test('pending review不能凍結；已過期review仍可讀既有歷史、不能凍結新選擇', async () => {
    const f = await fixture();
    try {
        const pending = await saveSourceReview(f.db, { provider: 'shioaji-daily-quotes',
            review: { status: 'pending', evidenceHash: 'e'.repeat(64), reviewedAt: review.reviewedAt,
                validThrough: review.validThrough }, reason: 'source_contract_pending' }, now());
        await assert.rejects(freezeSourceSelection({ ...f.options, reviewId: pending.id }), /source_contract_pending/);
        const frozen = await freezeSourceSelection(f.options);
        assert.equal((await readSourceReview(f.db, f.options.reviewId, new Date('2026-10-05T07:00:00Z'))).review.status, 'verified');
        await assert.rejects(freezeSourceSelection({ ...f.options, market: 'TPEx', gate: { ...gate, validThrough: '2026-10-06T07:00:00Z' },
            now: () => new Date('2026-10-05T07:00:00Z') }), /source_contract_pending/);
        assert.equal((await readSourceSelection(f.db, frozen.key)).manifest.manifestHash, frozen.manifest.manifestHash);
    } finally { f.db.close(); }
});
test('review／收據重解釋不准官方恢復比較；混用市場review也拒絕', async () => {
    const f = await fixture();
    try {
        const frozen = await freezeSourceSelection(f.options), candidate = await official(f.db);
        await f.db.prepare('UPDATE screener_bollinger_receipts SET payload=? WHERE id=?')
            .bind(JSON.stringify({ market: 'TWSE', sessionDate: date, payloadHash: frozen.manifest.payloadHash, reviewHash: 'e'.repeat(64) }), candidate.fetchReceiptId).run();
        await assert.rejects(compareRestoredOfficialSource({ db: f.db, selectionKey: frozen.key, ...candidate }), /invalid_source_receipt/);
        await assert.rejects(freezeSourceSelection({ ...f.options, ...candidate, market: 'TPEx', switchReason: null }), /invalid_source_selection/);
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_source_comparisons').first()).n, 0);
    } finally { f.db.close(); }
});
test('舊schema零投影寫入；migration僅新增表、不碰舊來源和publication', async () => {
    const db = new SqliteD1();
    try {
        assert.equal(await sourceSelectionSchemaReady(db), false);
        assert.deepEqual(await freezeSourceSelection({ db }), { state: 'pending', reason: 'schema_pending' });
        db.exec("CREATE TABLE screener_bollinger_head(payload TEXT); INSERT INTO screener_bollinger_head VALUES('old')");
        applyDrizzleSql(db, migrations[2]);
        assert.equal((await db.prepare('SELECT payload FROM screener_bollinger_head').first()).payload, 'old');
    } finally { db.close(); }
});
