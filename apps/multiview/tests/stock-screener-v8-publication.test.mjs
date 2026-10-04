import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { prepareBollingerHistory } from '../../../scripts/stock-screener-bollinger-prepare.ts';
import { publishBollingerDaily } from '../worker/stock-screener-v8-publisher.ts';
import { readBollingerPublication, saveBollingerDailyProfile, readBollingerDailyProfile, bollingerPublicationRowsHash } from '../worker/stock-screener-v8-repository.ts';
import { handleStockScreener } from '../worker/stock-screener-route.ts';
import { bollingerSourceUrl, bollingerUniverseHash } from '../../../src/lib/stock-screener-bollinger-source.ts';
import { DEFAULT_CRITERIA_V7 } from '../../../src/lib/stock-screener-v7.ts';
import { migrateCriteriaV7ToV8, SCREENER_V8_MAPPING_VERSION } from '../../../src/lib/stock-screener-v8.ts';
import { bollingerScheduleDecision, bollingerScheduleTrigger, updateBollingerScheduled } from '../../../scripts/stock-screener-bollinger-schedule.ts';
import { updateScreener } from '../../../scripts/stock-screener-update.mjs';
import { prepareBollingerCalendar } from '../../../scripts/stock-screener-bollinger-calendar.ts';
import { createBollingerCalendarFetcher } from '../../../scripts/stock-screener-bollinger-source-fetch.mjs';
import { EventEmitter } from 'node:events';
import { emptyNotices } from './helpers/calendar-notices.mjs';
import { readBollingerLegacyJoin } from '../worker/stock-screener-v8-legacy-join.ts';
import { technicalEvidenceHash } from '../../../src/lib/stock-screener-technical-patterns.ts';
import { decodeBollingerResponse } from '../../../src/lib/stock-screener-bollinger-api.ts';

// 隔離的日期／來源／review，不代表正式市場驗收。
const sessions = Array.from({ length: 160 }, (_, i) => new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10));
const now = () => new Date('2026-10-03T04:00:00Z');
const sqls = await Promise.all(['0027_pale_randall_flagg.sql', '0035_screener_bollinger_history.sql', '0036_screener_bollinger_publication.sql']
  .map(f => readFile(new URL(`../drizzle/${f}`, import.meta.url), 'utf8')));
const criteria = () => { const c = migrateCriteriaV7ToV8(DEFAULT_CRITERIA_V7);
  for (const v of Object.values(c)) if (v && typeof v === 'object' && 'enabled' in v) v.enabled = false;
  c.bollSqueezeStages.enabled = true; return c; };
async function fixture({ complete = true } = {}) {
  const db = new SqliteD1(); sqls.forEach(sql => applyDrizzleSql(db, sql));
  const universe = [{ symbol: '2449.TW', code: '2449', name: 'fixture-TSE', market: 'TWSE', listingDate: null },
    { symbol: '6488.TWO', code: '6488', name: 'fixture-OTC', market: 'TPEx', listingDate: null }];
  const reviews = Object.fromEntries(['TWSE', 'TPEx'].map(m => [m, { status: 'verified', market: m, mappingVersion: SCREENER_V8_MAPPING_VERSION,
    volumeUnit: 'shares', turnoverUnit: 'TWD', usage: 'local-historical-screener', minimumRows: 2,
    endpoint: new URL(bollingerSourceUrl(m, sessions.at(-1))).origin + new URL(bollingerSourceUrl(m, sessions.at(-1))).pathname,
    evidenceHash: 'a'.repeat(64), reviewedAt: '2026-10-01T00:00:00Z', validThrough: '2026-10-04T00:00:00Z' }]));
  const c = criteria();
  await saveBollingerDailyProfile(db, { expectedRevision: 0, enabled: true, criteria: c }, now());
  const options = { db, universe, universeRevision: 'fixture-u', through: sessions.at(-1), now, trigger: 'manual', reviews,
    calendar: { status: 'verified', commonSessions: sessions, validThrough: '2026-10-04T00:00:00Z', authorityHash: 'b'.repeat(64) },
    universeEvidence: { status: 'verified', ordinary: true, hash: await bollingerUniverseHash(universe) } };
  let requests = 0;
  const fetchReport = async t => {
    requests++; const i = sessions.indexOf(t.sessionDate), price = String(100 + i * .1);
    const table = { fields: t.market === 'TWSE' ? ['證券代號', '成交股數', '成交金額', '開盤價', '最高價', '最低價', '收盤價']
      : ['代號', '成交股數', '成交金額(元)', '開盤', '最高', '最低', '收盤'],
      data: [[t.market === 'TWSE' ? '2449' : '6488', '1000000', '120000001', price, String(Number(price) + 1), '99', price],
        [t.market === 'TWSE' ? '2330' : '6510', '100', '10000', '100', '101', '99', '100']] };
    return { status: 200, sourceUrl: bollingerSourceUrl(t.market, t.sessionDate), fetchedAt: now().toISOString(),
      text: JSON.stringify({ stat: 'OK', date: t.sessionDate.replaceAll('-', ''), tables: t.market === 'TWSE' ? [table]
        : [{ ...table, data: table.data.slice(0, 1) }, { ...table, data: table.data.slice(1) }] }) };
  };
  if (complete) for (let i = 0; i < 18; i++) await prepareBollingerHistory({ ...options, criteria: c.bollSqueezeStages, profileRevision: '1', fetchReport,
    budget: { maxRequests: 18, maxBytes: 8000000, maxDurationMs: 900000 } });
  return { db, options, c, requests: () => requests };
}
const request = (path, params = {}, init) => new Request(`http://127.0.0.1:5174/api/stock-screener/${path}?${new URLSearchParams({ version: '8', ...params })}`, init);
test('逐列串流雜湊與既有 canonical 全陣列完全一致，不接受底稿以外欄位竄改', async () => {
  for (const rows of [[], [{ symbol: '測試.TW', nested: { z: null, a: ['2026-10-02', 3, true] } }],
    [{ z: { dates: ['😀', '\\n', 'é'], x: undefined } }, { a: [null, false, 0] }]]) {
    assert.equal(bollingerPublicationRowsHash(rows), await technicalEvidenceHash(rows));
  }
  const f = await fixture();
  try {
    await publishBollingerDaily(f.options);
    await readBollingerPublication(f.db);
    // features 雜湊仍合法，但 dailyOutcome／其他發布欄位也必須受完整 rowsHash 保護。
    await f.db.prepare("UPDATE screener_bollinger_rows SET payload=json_set(payload,'$.name','tampered') WHERE symbol='2449.TW'").run();
    await assert.rejects(readBollingerPublication(f.db), /invalid_v8_publication/);
  } finally { f.db.close(); }
});
test('擴大回看窗的HTTP回應可被前端解碼，待準備不能沿用可操作旗標或改每日設定', async () => {
  const f = await fixture();
  try {
    await publishBollingerDaily(f.options);
    const before = await f.db.prepare('SELECT total_changes() n').first();
    const query = structuredClone(f.c);
    query.bollSqueezeStages.lookbackDays = 250;
    query.bollSqueezeStages.setupDays = 20;
    const r = await handleStockScreener(request('results', { criteria: JSON.stringify(query) }),
      { DB: f.db, DEPLOYMENT_TARGET: 'local' }, now());
    assert.equal(r.status, 200);
    const response = decodeBollingerResponse(await r.json());
    assert.equal(response.state, 'history_pending');
    assert.equal(response.reason, 'history_pending');
    assert.equal(response.canUseResults, false);
    assert.equal(response.requiredDays, 290);
    assert.equal(response.availableDays, 160);
    assert.deepEqual(response.rows, []);
    assert.equal(response.nextCursor, null);
    assert.deepEqual(await f.db.prepare('SELECT total_changes() n').first(), before);
    assert.deepEqual((await readBollingerDailyProfile(f.db)).criteria, f.c);
    assert.equal(f.requests(), 320); // 全為 fixture 準備；查詢沒有新增來源請求。
  } finally { f.db.close(); }
});
test('大型發布只讀一次metadata，分批讀凍結列並核對完整rowsHash；不改head或寫DB', async () => {
  const f = await fixture();
  try {
    await publishBollingerDaily(f.options);
    const original = await readBollingerPublication(f.db);
    const rows = Array.from({ length: 75 }, (_, i) => ({ ...structuredClone(original.rows[0]), symbol: `${1000+i}.TW`, code: String(1000+i) }));
    await f.db.prepare('DELETE FROM screener_bollinger_rows WHERE snapshot_id=?').bind(original.id).run();
    for (const row of rows) await f.db.prepare('INSERT INTO screener_bollinger_rows(snapshot_id,symbol,payload) VALUES(?,?,?)')
      .bind(original.id,row.symbol,JSON.stringify(row)).run();
    const metadata = { ...original.metadata, total: rows.length, rowsHash: await technicalEvidenceHash(rows) };
    await f.db.prepare('UPDATE screener_bollinger_publications SET metadata=? WHERE id=?').bind(JSON.stringify(metadata),original.id).run();
    const before = await f.db.prepare('SELECT total_changes() n').first();
    const calls=[];
    const guarded = { prepare(sql) {
      calls.push(sql);
      assert(!/JOIN screener_bollinger_rows/.test(sql),'metadata_repeated_per_stock');
      if (/FROM screener_bollinger_rows/.test(sql)) assert(/LIMIT 50/.test(sql),'unbounded_d1_rows_response');
      return f.db.prepare(sql);
    }};
    const result=await readBollingerPublication(guarded);
    assert.equal(result.rows.length,75); assert.deepEqual(result.metadata,metadata);
    assert.equal(calls.filter(sql=>/FROM screener_bollinger_publications/.test(sql)).length,1);
    assert.equal(calls.filter(sql=>/FROM screener_bollinger_rows/.test(sql)).length,2);
    assert.deepEqual(await f.db.prepare('SELECT total_changes() n').first(),before);
    await f.db.prepare("UPDATE screener_bollinger_rows SET payload=json_set(payload,'$.features.evidenceHash','bad') WHERE symbol='1074.TW'").run();
    await assert.rejects(readBollingerPublication(guarded),/invalid_v8_publication/);
  } finally { f.db.close(); }
});
test('價量独立發布／守恆／atomic head，不需要任何籌碼 head；同鍵zero-write no-op', async () => {
  const f = await fixture();
  try {
    const result = await publishBollingerDaily(f.options); assert.equal(result.state, 'published');
    const snapshot = await readBollingerPublication(f.db); assert.equal(snapshot.rows.length, 2);
    assert.equal(snapshot.metadata.counts.total.total, 2);
    assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_snapshots').first()).n, 0);
    const before = (await f.db.prepare('SELECT COUNT(*) n FROM screener_bollinger_receipts').first()).n;
    assert.equal((await publishBollingerDaily({ ...f.options, reviews: {} })).state, 'unchanged');
    assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_bollinger_receipts').first()).n, before);
    assert.equal(f.requests(), 320);
  } finally { f.db.close(); }
});
test('缺history／review不發布，留pending證據，來源失敗不改calendar', async () => {
  const f = await fixture({ complete: false });
  try {
    assert.equal((await publishBollingerDaily({ ...f.options, reviews: {} })).reason, 'source_contract_pending');
    assert.equal((await publishBollingerDaily(f.options)).reason, 'history_pending');
    assert.equal(await readBollingerPublication(f.db), null);
    assert.equal(f.requests(), 0);
  } finally { f.db.close(); }
});
test('並行publisher單一lease；其他writer不能半份切head', async () => {
  const f = await fixture();
  try { const results = await Promise.all([publishBollingerDaily(f.options), publishBollingerDaily(f.options)]);
    assert.equal(results.filter(r => r.state === 'published').length, 1);
    assert.equal(results.filter(r => r.reason === 'lease_busy').length, 1);
    assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_bollinger_publications WHERE status='published'").first()).n, 1);
  } finally { f.db.close(); }
});
test('每日profile revision CAS 即使相同payload也只一個caller成功；不抓來源', async () => {
  const f = await fixture({ complete: false });
  try {
    const p = { expectedRevision: 1, enabled: true, criteria: f.c };
    const results = await Promise.allSettled([saveBollingerDailyProfile(f.db, p, now()), saveBollingerDailyProfile(f.db, p, now())]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await readBollingerDailyProfile(f.db)).revision, 2); assert.equal(f.requests(), 0);
    await assert.rejects(saveBollingerDailyProfile(f.db, { ...p, criteria: { ...f.c, mode: 'bad' } }), /invalid_daily_profile/);
  } finally { f.db.close(); }
});
test('新profile同日另發布，保留舊報告／失敗收據／舊head隔離', async () => {
  const f = await fixture();
  try { const a = await publishBollingerDaily(f.options);
    f.c.bollSqueezeStages.breakoutVolumeRatio = '1.5';
    await saveBollingerDailyProfile(f.db, { expectedRevision: 1, enabled: true, criteria: f.c }, now());
    const b = await publishBollingerDaily(f.options); assert.notEqual(a.snapshotId, b.snapshotId);
    assert.equal((await readBollingerPublication(f.db, a.snapshotId)).metadata.profileRevision, 1);
    assert.equal((await readBollingerPublication(f.db)).metadata.profileRevision, 2); assert.equal(f.requests(), 320);
  } finally { f.db.close(); }
});
test('已完成batch但逐商品payload不一致不得發布／不刪失敗證據', async () => {
  const f = await fixture();
  try { await f.db.prepare("UPDATE screener_bollinger_daily SET payload='{}' WHERE symbol='2449.TW' AND session_date=?").bind(sessions.at(-1)).run();
    await assert.rejects(publishBollingerDaily(f.options), /invalid_history_projection/);
    assert.equal(await readBollingerPublication(f.db), null);
    assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_bollinger_receipts WHERE status='publication_failed'").first()).n, 1);
  } finally { f.db.close(); }
});
test('唯讀HTTP排序分頁，不写DB；cursor綁定設定／snapshot；無v8明示pending', async () => {
  const f = await fixture();
  try {
    const env = { DB: f.db, DEPLOYMENT_TARGET: 'local' };
    let r = await handleStockScreener(request('results', { criteria: JSON.stringify(f.c) }), env, now());
    assert.equal((await r.json()).reason, 'v8_preparation_pending');
    await publishBollingerDaily(f.options);
    const before = (await f.db.prepare('SELECT COUNT(*) n FROM screener_bollinger_receipts').first()).n;
    r = await handleStockScreener(request('results', { criteria: JSON.stringify(f.c), resultState: 'all', limit: '1' }), env, now());
    const result = await r.json(); assert.equal(result.rows.length, 1); assert(result.nextCursor);
    r = await handleStockScreener(request('results', { criteria: JSON.stringify(f.c), resultState: 'all', limit: '1', cursor: result.nextCursor, snapshotId: result.snapshotId }), env, now());
    assert.equal((await r.json()).rows[0].symbol, '6488.TWO');
    const changed = structuredClone(f.c); changed.bollSqueezeStages.percentile = 21;
    r = await handleStockScreener(request('results', { criteria: JSON.stringify(changed), resultState: 'all', limit: '1', cursor: result.nextCursor }), env, now());
    assert.equal(r.status, 409);
    assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_bollinger_receipts').first()).n, before);
  } finally { f.db.close(); }
});
test('profile local-only／same-origin／有界body及CAS；GET不是下載入口', async () => {
  const f = await fixture({ complete: false });
  try { const env = { DB: f.db, DEPLOYMENT_TARGET: 'local' };
    const body = JSON.stringify({ expectedRevision: 1, enabled: true, criteria: f.c });
    assert.equal((await handleStockScreener(request('daily-profile', {}, { method: 'PUT', headers: { 'content-type': 'application/json', origin: 'http://evil.test' }, body }), env)).status, 403);
    assert.equal((await handleStockScreener(request('daily-profile', {}, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(16385) }), env)).status, 413);
    assert.equal((await handleStockScreener(request('daily-profile', {}, { method: 'PUT', headers: { 'content-type': 'application/json' }, body }), env)).status, 200);
    assert.equal((await handleStockScreener(request('daily-profile', {}, { method: 'PUT', headers: { 'content-type': 'application/json' }, body }), env)).status, 409);
    assert.equal((await handleStockScreener(request('daily-profile'), { ...env, DEPLOYMENT_TARGET: 'cloudflare' })).status, 404);
    assert.equal(f.requests(), 0);
  } finally { f.db.close(); }
});
test('舊資料庫新route fail closed，舊route仍是原版pending', async () => {
  const db = new SqliteD1(); applyDrizzleSql(db, sqls[0]);
  try { const env = { DB: db, DEPLOYMENT_TARGET: 'local' };
    const newer = await handleStockScreener(request('status'), env, now()); assert.equal((await newer.json()).reason, 'schema_pending');
    const old = await handleStockScreener(new Request('http://127.0.0.1:5174/api/stock-screener/status?version=7'), env, now());
    assert.equal((await old.json()).version, 7);
  } finally { db.close(); }
});
test('14:00邊界／休市／晚開機取最近已完成官方日，不猜weekday', () => {
  const calendar = { status: 'verified', commonSessions: ['2026-10-02', '2026-10-05', '2026-10-06'], authorityHash: 'b'.repeat(64), validThrough: '2026-10-06T06:00:00Z' };
  assert.equal(bollingerScheduleDecision(calendar, new Date('2026-10-05T05:59:59Z')).through, '2026-10-02');
  assert.equal(bollingerScheduleDecision(calendar, new Date('2026-10-05T06:00:00Z')).through, '2026-10-05');
  assert.equal(bollingerScheduleDecision(calendar, new Date('2026-10-03T10:00:00Z')).through, '2026-10-02');
  assert.equal(bollingerScheduleDecision(calendar, new Date('2026-10-05T10:00:00Z')).nextAttemptAt, '2026-10-06T06:00:00.000Z');
  assert.equal(bollingerScheduleDecision({ ...calendar, validThrough: '2026-10-01T00:00:00Z' }, now()).state, 'pending');
  assert.equal(bollingerScheduleDecision({ ...calendar, commonSessions: [] }, now()).through, null);
  assert.equal(bollingerScheduleTrigger('2026-10-02', new Date('2026-10-02T10:00:00Z'), false), 'late-boot');
  assert.equal(bollingerScheduleTrigger('2026-10-02', new Date('2026-10-02T10:00:00Z'), true), 'watcher');
  assert.equal(bollingerScheduleTrigger('2026-10-02', new Date('2026-10-02T06:00:00Z'), false), 'watcher');
});
const installContext = async f => {
  await f.db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES('screener-period-evidence','screener-calendar','verified',?,?)")
    .bind(JSON.stringify({ version: 1, sessions: [...sessions, '2026-10-04'], sourceHashes: ['b'.repeat(64), 'c'.repeat(64)], validThrough: '2026-10-04T12:00:00Z' }), now().toISOString()).run();
  await prepareBollingerCalendar(f.db, { now, deadline: now().getTime()+900000, fetchNotices: emptyNotices });
  for (const s of f.options.universe) await f.db.prepare('INSERT INTO screener_universe(revision,symbol,market,data_date,payload) VALUES(?,?,?,?,?)')
    .bind(f.options.universeRevision, s.symbol, s.market, sessions.at(-1), JSON.stringify({ stock: { ...s, kind: 'ordinary', classificationVersion: 'fixture' },
      review: 'verified', revision: f.options.universeRevision, sourceDate: sessions.at(-1),
      provenance: { source: s.market, payloadHash: 'e'.repeat(64) } })).run();
};
test('新能力沒有來源review fail closed；v5 schedule disabled不遮蔽v8pending', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: now() }); // updateScreener 使用實際 Date；固定隔離 fixture 時鐘。
  const f = await fixture({ complete: false });
  try { await installContext(f);
    const result = await updateBollingerScheduled(f.db, { now, fetchReport: async () => { throw new Error('unexpected_network'); } });
    assert.equal(result.reason, 'source_contract_pending');
    assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_bollinger_batches').first()).n, 0);
    const existing = await updateScreener(f.db, { scheduled: true });
    assert.equal(existing.reason, 'schedule_disabled'); assert.equal(existing.bollinger.reason, 'source_contract_pending');
  } finally { f.db.close(); }
});
test('正式母體envelope審查／revision／SQL identity損毁均拒絕；不抓來源', async () => {
  for (const mutate of [e=>{e.review='pending';},e=>{e.revision='other';},e=>{e.stock.symbol='9999.TW';},
    e=>{e.stock.market='TPEx';},e=>{e.sourceDate='2026-01-01';},e=>{e.provenance.payloadHash=null;}]) {
    const f=await fixture({complete:false});
    try {await installContext(f);
      const row=await f.db.prepare('SELECT payload FROM screener_universe WHERE symbol=?').bind('2449.TW').first();
      const e=JSON.parse(row.payload);mutate(e);
      await f.db.prepare('UPDATE screener_universe SET payload=? WHERE symbol=?').bind(JSON.stringify(e),'2449.TW').run();
      const r=await updateBollingerScheduled(f.db,{now,fetchReport:async()=>{throw Error('unexpected_network');}});
      assert.equal(r.reason,'universe_contract_pending');
    }finally{f.db.close();}
  }
});
test('已發布profile同日再次喚醒唯讀休眠；profile改動恢復工作且不等待籌碼', async () => {
  const f = await fixture();
  try { await publishBollingerDaily(f.options); await installContext(f);
    const before = (await f.db.prepare('SELECT COUNT(*) n FROM screener_bollinger_receipts').first()).n;
    const result = await updateBollingerScheduled(f.db, { now, fetchReport: async () => { throw new Error('unexpected_network'); } });
    assert.equal(result.reason, 'session_complete_sleeping'); assert.equal(result.nextAttemptAt, '2026-10-04T06:00:00.000Z');
    assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_bollinger_receipts').first()).n, before);
    await saveBollingerDailyProfile(f.db, { expectedRevision: 1, enabled: true, criteria: f.c }, now());
    assert.equal((await updateBollingerScheduled(f.db, { now })).reason, 'source_contract_pending');
  } finally { f.db.close(); }
});
test('官方交易日更正後，舊窗口成功鍵不能冒充新窗口完成；舊head及收據保留',async()=>{
  const f=await fixture();try {
    await publishBollingerDaily(f.options);await installContext(f);
    const old=await readBollingerPublication(f.db);
    const row=await f.db.prepare("SELECT checkpoint FROM screener_runs WHERE id='screener-period-evidence'").first();
    const annual=JSON.parse(row.checkpoint);annual.sessions=annual.sessions.filter(d=>d!==sessions[10]);
    await f.db.prepare("UPDATE screener_runs SET checkpoint=? WHERE id='screener-period-evidence'").bind(JSON.stringify(annual)).run();
    const r=await updateBollingerScheduled(f.db,{now,fetchReport:async()=>{throw Error('unexpected_network')}});
    assert.equal(r.reason,'calendar_publication_review_required');
    assert.deepEqual(await readBollingerPublication(f.db),old);
  } finally {f.db.close()}
});

const calendarReply = async (market, year) => ({ status: 200, sourceUrl: market === 'TWSE'
  ? `https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json&queryYear=${year - 1911}`
  : `https://www.tpex.org.tw/www/zh-tw/bulletin/tradingDate?date=${year}`,
  text: JSON.stringify(market === 'TWSE' ? { stat: 'ok', queryYear: year, fields: ['日期','名稱','說明'],
    data: [[`${year}-01-01`, '中華民國開國紀念日', '依規定放假1日。']] }
    : { data: { html: `<table><tr><td>中華民國${year - 1911}年開（休）市日期表</td></tr>
      <tr><th>名稱</th><th>日期</th><th>星期</th><th>說明</th></tr>
      <tr><td>中華民國開國紀念日</td><td>1月1日</td><td>四</td><td>依規定放假1日。</td></tr></table>` } }) });
test('沒有v5／TDCC日曆也自行準備三年度官方grid；cache重觸發零request', async () => {
  const f = await fixture({ complete: false }); let calls = 0;
  try {
    const options = { now, deadline: now().getTime() + 900000, fetchNotices: emptyNotices, fetchCalendar: async (...args) => { calls++; return calendarReply(...args); } };
    const r = await prepareBollingerCalendar(f.db, options);
    assert.equal(r.state, 'ready'); assert.equal(calls, 6); assert(r.calendar.commonSessions.length >= 400);
    assert.equal(r.calendar.validThrough, '2026-11-02T04:00:00.000Z');
    assert.equal((await prepareBollingerCalendar(f.db, options)).state, 'ready'); assert.equal(calls, 6);
    assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_bollinger_receipts WHERE status='calendar_verified'").first()).n, 1);
  } finally { f.db.close(); }
});
test('日曆429／HTML／到期不猜休市；冷卻且原失敗receipt保留', async () => {
  for (const reply of [{ status: 429, retryAfter: '7200', text: '' }, { status: 200, text: '<html>not calendar</html>' }]) {
    const f = await fixture({ complete: false }); let calls = 0;
    try { const options = { now, deadline: now().getTime() + 900000, fetchCalendar: async (m,y) => { calls++; return { ...await calendarReply(m,y), ...reply }; } };
      const r = await prepareBollingerCalendar(f.db, options); assert.equal(r.state, 'pending');
      assert(Date.parse(r.nextAttemptAt) - now().getTime() >= (reply.status === 429 ? 7200000 : 1200000));
      assert.equal((await prepareBollingerCalendar(f.db, options)).state, 'pending'); assert.equal(calls, 1);
      assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_bollinger_receipts WHERE status='calendar_failed'").first()).n, 1);
      assert.equal(await f.db.prepare("SELECT checkpoint FROM screener_runs WHERE id='screener-bollinger-calendar'").first(), null);
    } finally { f.db.close(); }
  }
});
test('官方日曆連線重設保留傳輸分類與原收據，冷卻期間不重試或猜交易日', async () => {
  const f = await fixture({ complete: false }); let calls = 0;
  try {
    const fetchCalendar = createBollingerCalendarFetcher(() => {
      calls++; const req = new EventEmitter(); req.destroy = e => req.emit('error', e);
      req.end = () => queueMicrotask(() => { req.emit('finish');
        req.emit('error', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })); }); return req;
    });
    const options = { now, deadline: now().getTime() + 900000, fetchCalendar };
    const r = await prepareBollingerCalendar(f.db, options); assert.equal(r.reason, 'calendar_authority_pending');
    const before = await f.db.prepare("SELECT id,payload FROM screener_bollinger_receipts WHERE status='calendar_failed'").first();
    const p = JSON.parse(before.payload); assert.equal(p.reason, 'source_connection_reset'); assert.equal(p.transport.code, 'ECONNRESET');
    assert.equal(p.transport.statusCode, null); assert.equal(p.transport.bytes, 0);
    assert.equal((await prepareBollingerCalendar(f.db, options)).state, 'pending'); assert.equal(calls, 1);
    const after = await f.db.prepare('SELECT payload FROM screener_bollinger_receipts WHERE id=?').bind(before.id).first();
    assert.equal(after.payload, before.payload);
    assert.equal(await f.db.prepare("SELECT checkpoint FROM screener_runs WHERE id='screener-bollinger-calendar'").first(), null);
  } finally { f.db.close(); }
});
test('v8-only早期入口不執行v5 writer；repo watcher在TDCC前檢查且沒有更改頻率', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: now() });
  const f = await fixture({ complete: false });
  try { await installContext(f);
    const result = await updateScreener(f.db, { scheduled: true, bollingerOnly: true });
    assert.equal(result.reason, 'source_contract_pending');
    assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_runs WHERE scope NOT LIKE '%bollinger%' AND id<>'screener-period-evidence'").first()).n, 0);
    const script = await readFile(new URL('../../../scripts/realtimestock-runtime', import.meta.url), 'utf8');
    const hook = script.slice(script.indexOf('service_multiview_tdcc_watcher() {'), script.indexOf('service_multiview_tdcc_watcher() {') + 2000);
    assert(hook.indexOf('service_multiview_screener_pipeline --bollinger-only') < hook.indexOf('read_multiview_pipeline_secret'));
    assert(!hook.includes('launchctl')); assert(script.includes('<integer>300</integer>'));
  } finally { f.db.close(); }
});
test('同日舊分支不存在為unknown，不寫資料；stale與非法分類fail closed', async () => {
  const f = await fixture();
  try { const { bollSqueezeStages, ...c } = structuredClone(f.c); c.trustOwnership.enabled = true;
    const legacy = await readBollingerLegacyJoin(f.db, c, sessions.at(-1), 'fixture-u', ['2449.TW','6488.TWO']);
    assert.equal(legacy.reason, 'same_session_legacy_pending'); assert.equal(legacy.rows['2449.TW'].verdict, 'unknown');
    await publishBollingerDaily(f.options);
    await f.db.prepare("INSERT INTO screener_bollinger_state(name,payload,updated_at) VALUES('v8',?,?)")
      .bind(JSON.stringify({ expectedSessionDate: '2026-10-02' }), now().toISOString()).run();
    const response = await handleStockScreener(request('results', { criteria: JSON.stringify(f.c), resultState: 'all' }), { DB: f.db, DEPLOYMENT_TARGET: 'local' }, now());
    const r = await response.json(); assert.equal(r.state, 'stale'); assert.equal(r.canUseResults, false); assert.equal(r.rows.length, 2);
    assert.equal((await handleStockScreener(request('results', { criteria: JSON.stringify(f.c), stage: 'invented' }), { DB: f.db, DEPLOYMENT_TARGET: 'local' }, now())).status, 400);
  } finally { f.db.close(); }
});
test('重用已凍結features也先驗hash，破損舊底稿不能切新head', async () => {
  const f = await fixture();
  try { const first = await publishBollingerDaily(f.options);
    await f.db.prepare("UPDATE screener_bollinger_rows SET payload=json_set(payload,'$.features.evidenceHash','bad') WHERE snapshot_id=? AND symbol='2449.TW'")
      .bind(first.snapshotId).run();
    await saveBollingerDailyProfile(f.db, { expectedRevision: 1, enabled: true, criteria: f.c }, now());
    await assert.rejects(publishBollingerDaily(f.options), /invalid_/);
    assert.equal((await f.db.prepare("SELECT snapshot_id FROM screener_bollinger_head WHERE name='v8'").first()).snapshot_id, first.snapshotId);
    assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_bollinger_receipts WHERE status='publication_failed'").first()).n, 1);
  } finally { f.db.close(); }
});
test('publisher遵守排程剩餘run預算，逾時留失敗收據而不切head', async () => {
  const f = await fixture(); let offset = 0;
  try { const prepare = f.db.prepare.bind(f.db);
    f.db.prepare = sql => { const s = prepare(sql), run = s.run.bind(s);
      if (sql.startsWith('INSERT INTO screener_bollinger_receipts')) s.run = async () => {
        const r = await run(); if (s.args.includes('publication_started')) offset = 101; return r;
      }; return s; };
    await assert.rejects(publishBollingerDaily({ ...f.options, maxDurationMs: 100, now: () => new Date(now().getTime() + offset) }), /run_deadline/);
    assert.equal(await readBollingerPublication(f.db), null);
    const failed = await f.db.prepare("SELECT payload FROM screener_bollinger_receipts WHERE status='publication_failed'").first();
    assert.equal(JSON.parse(failed.payload).reason, 'run_deadline');
    assert.equal((await f.db.prepare("SELECT lease_until FROM screener_runs WHERE id='screener-bollinger-lease'").first()).lease_until, null);
  } finally { f.db.close(); }
});
