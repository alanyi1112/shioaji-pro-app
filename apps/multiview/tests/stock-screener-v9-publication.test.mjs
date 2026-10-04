import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { publishCandlestickHistory } from '../worker/stock-screener-v9-publisher.ts';
import { readCandlestickPublication } from '../worker/stock-screener-v9-repository.ts';
import { handleStockScreener } from '../worker/stock-screener-route.ts';
import { parseCandlestickHttpQuery } from '../worker/stock-screener-v9-route.ts';
import { updateCandlestickScheduled, readCandlestickStoredCalendar } from '../../../scripts/stock-screener-candlestick-schedule.ts';
import { updateBollingerScheduled } from '../../../scripts/stock-screener-bollinger-schedule.ts';
import { saveSourceReview, SOURCE_POLICY_VERSION } from '../../../scripts/stock-screener-source-selection.mjs';
import { DAILY_QUOTES_URL, DAILY_QUOTES_MAPPING } from '../../../scripts/stock-screener-shioaji-daily-quotes.mjs';
import { bollingerUniverseHash } from '../../../src/lib/stock-screener-bollinger-source.ts';
import { technicalEvidenceHash } from '../../../src/lib/stock-screener-technical-patterns.ts';
import { migrateCriteriaV8ToV9 } from '../../../src/lib/stock-screener-v9.ts';
import { migrateCriteriaV7ToV8 } from '../../../src/lib/stock-screener-v8.ts';
import { DEFAULT_CRITERIA_V7 } from '../../../src/lib/stock-screener-v7.ts';
import { CLOSURE_POLICY, closureSourceUrl } from '../../../scripts/stock-screener-calendar-exceptions.ts';
import { validateScreenerGatewayRequest } from '../../../scripts/stock-screener-gateway.mjs';

// 隔離 fixture：日期網格／review／來源列皆非真實行情，不宣稱自然 watcher 或 live 驗收。
const now = () => new Date('2026-10-04T06:00:00Z');
const sessions = Array.from({ length: 64 }, (_, i) => new Date(Date.UTC(2026, 7, i + 1)).toISOString().slice(0, 10));
const through = sessions.at(-1), future = '2026-10-05';
const universe = [{ symbol: '2449.TW', code: '2449', name: 'fixture-2449', market: 'TWSE', listingDate: null },
  { symbol: '6488.TWO', code: '6488', name: 'fixture-6488', market: 'TPEx', listingDate: null }];
const sqls = await Promise.all(['0027_pale_randall_flagg.sql','0035_screener_bollinger_history.sql','0036_screener_bollinger_publication.sql',
  '0038_screener_source_selection.sql','0040_screener_candlestick_publication.sql'].map(f => readFile(new URL(`../drizzle/${f}`, import.meta.url), 'utf8')));
const criteria = () => {
  const c = migrateCriteriaV8ToV9(migrateCriteriaV7ToV8(DEFAULT_CRITERIA_V7));
  for (const v of Object.values(c)) if (v && typeof v === 'object' && 'enabled' in v) v.enabled = false;
  c.candlestickReversal.enabled = true; return c;
};
async function fixture() {
  const db = new SqliteD1(); sqls.forEach(s => applyDrizzleSql(db, s));
  const universeHash = await bollingerUniverseHash(universe);
  const review = { status: 'verified', provider: 'shioaji-daily-quotes', endpoint: DAILY_QUOTES_URL, mappingVersion: DAILY_QUOTES_MAPPING,
    volumeUnit: 'shares', turnoverUnit: 'TWD', priceBasis: 'unadjusted', tradeScope: 'official-daily-compatible',
    usage: 'local-historical-screener', markets: ['TWSE','TPEx'], evidenceHash: 'a'.repeat(64),
    reviewedAt: '2026-10-03T06:00:00Z', validThrough: '2026-10-06T06:00:00Z', minimumRows: 2 };
  const r = await saveSourceReview(db, { provider: 'shioaji-daily-quotes', review }, now());
  db.exec(`INSERT INTO screener_source_universes VALUES('fixture-v9-u','${universeHash}','${now().toISOString()}')`);
  for (const sessionDate of sessions) for (const market of ['TWSE','TPEx']) {
    const rows = universe.filter(u => u.market === market).map(u => ({ symbol: u.symbol, market, sessionDate, readiness: 'ready',
      bar: { sessionDate, open: '100', high: '102', low: '99', close: '101', volumeShares: '10000', turnoverNtd: '1000000' },
      sourceValues: null, provenance: { provider: r.provider, payloadHash: 'b'.repeat(64) } }));
    const key = await technicalEvidenceHash({ policyVersion: SOURCE_POLICY_VERSION, universeRevision: 'fixture-v9-u', market, sessionDate });
    const body = { policyVersion: SOURCE_POLICY_VERSION, universeRevision: 'fixture-v9-u', universeHash, market, sessionDate,
      actualDate: sessionDate, requestedDate: sessionDate, provider: r.provider, payloadHash: 'b'.repeat(64), reviewId: r.id,
      reviewHash: review.evidenceHash, rowsHash: await technicalEvidenceHash(rows), rowCount: rows.length,
      mappingVersion: DAILY_QUOTES_MAPPING, switchReason: 'official_contract_pending', officialFailures: [] };
    const manifestHash = await technicalEvidenceHash(body);
    await db.prepare("INSERT INTO screener_source_selections VALUES(?,?,?,?,?,'complete',?,?)")
      .bind(key, manifestHash, 'fixture-v9-u', market, sessionDate, JSON.stringify({ ...body, manifestHash }), now().toISOString()).run();
    for (const row of rows) await db.prepare('INSERT INTO screener_source_selected_rows VALUES(?,?,?)').bind(key,row.symbol,JSON.stringify(row)).run();
  }
  const calendar = { status: 'verified', commonSessions: [...sessions,future], validThrough: '2026-10-06T06:00:00Z', authorityHash: 'c'.repeat(64) };
  return { db, options: { db, calendar, through, universeRevision: 'fixture-v9-u', universeHash, universe, now } };
}
async function http(db, c = criteria(), extra = {}, path = 'results', at = now()) {
  const params = path === 'status' ? { version: '9' } : { version: '9', criteria: JSON.stringify(c), resultState: 'fail', limit: '1', ...extra };
  const request = new Request(`http://127.0.0.1:5174/api/stock-screener/${path}?${new URLSearchParams(params)}`);
  const response = await handleStockScreener(request, { DB: db, DEPLOYMENT_TARGET: 'local' }, at);
  return { status: response.status, body: await response.json() };
}
test('獨立完整 OHLC 發布、64 日缺口／hash、atomic head 與同鍵 no-op，不建立布林 profile', async () => {
  const f = await fixture(); try {
    const first = await publishCandlestickHistory(f.options); assert.equal(first.state,'published');
    const p = await readCandlestickPublication(f.db); assert.equal(p.rows.length,2); assert.equal(p.metadata.historySessions.length,64);
    assert.equal(p.rows[0].history.points[0].bar.open,'100');
    const counts = f.db.database.prepare('SELECT COUNT(*) n FROM screener_candlestick_receipts').get().n;
    assert.deepEqual(await publishCandlestickHistory(f.options),{ state:'unchanged',snapshotId:first.snapshotId });
    assert.equal(f.db.database.prepare('SELECT COUNT(*) n FROM screener_candlestick_receipts').get().n,counts);
    assert.equal(f.db.database.prepare('SELECT COUNT(*) n FROM screener_bollinger_profiles').get().n,0);
    assert.equal(f.db.database.prepare('SELECT COUNT(*) n FROM screener_bollinger_publications').get().n,0);
  } finally { f.db.close(); }
});
test('來源空洞 pending 保持原 head；非法 source／price basis／日期不得發布', async () => {
  const f = await fixture(); try {
    const p = await publishCandlestickHistory(f.options);
    assert.deepEqual(await publishCandlestickHistory({ ...f.options, through: future, now:()=>new Date('2026-10-05T07:00:00Z') }),{ state:'pending',reason:'full_ohlcv_source_pending' });
    assert.equal((await readCandlestickPublication(f.db)).id,p.snapshotId);
    await assert.rejects(publishCandlestickHistory({ ...f.options, universeHash:'e'.repeat(64) }), /authority_pending/);
    const r = f.db.database.prepare('SELECT selection_key,payload FROM screener_source_selected_rows LIMIT 1').get();
    const bad = JSON.parse(r.payload); bad.bar.open = '200';
    await f.db.prepare('UPDATE screener_source_selected_rows SET payload=? WHERE selection_key=?').bind(JSON.stringify(bad),r.selection_key).run();
    await assert.rejects(publishCandlestickHistory(f.options), /invalid_source_projection/);
  } finally { f.db.close(); }
});
test('status／分頁／證據為唯讀；全母體守恆、穩定游標、clone／DB 改動重驗', async t => {
  const fetcher=t.mock.method(globalThis,'fetch',()=>{ throw new Error('source_network_forbidden'); });
  const f = await fixture(); try {
    await publishCandlestickHistory(f.options);
    const originalPrepare = f.db.prepare.bind(f.db), counts = { select:0, write:0 };
    f.db.prepare = sql => { counts[/^(SELECT|PRAGMA)/.test(sql) ? 'select':'write']++; return originalPrepare(sql); };
    const status = await http(f.db,criteria(),{},'status'); assert.equal(status.body.state,'ready');
    const statusReads=counts.select;
    const a = await http(f.db); assert.equal(a.status,200); assert.deepEqual(a.body.counts,{ total:2,pass:0,fail:2,unknown:0 });
    const queryReads=counts.select-statusReads;
    assert.equal(a.body.rows[0].outcome.matches.length,5);
    const b = await http(f.db,criteria(),{ cursor:a.body.nextCursor,snapshotId:a.body.snapshotId });
    assert.equal(b.body.rows.length,1); assert.notEqual(a.body.rows[0].symbol,b.body.rows[0].symbol);
    assert.equal(counts.write,0); assert.ok(counts.select>0);
    assert.equal(fetcher.mock.callCount(),0);
    assert.deepEqual({ status:1,query:1,pagination:1,evidence:0,source:fetcher.mock.callCount(),writes:counts.write },
      { status:1,query:1,pagination:1,evidence:0,source:0,writes:0 });
    assert.ok(statusReads>0 && queryReads>0 && counts.select-statusReads-queryReads>0);
    assert.equal((await http(f.db,criteria(),{ cursor:a.body.nextCursor,limit:'2' })).status,409);
    const p = await readCandlestickPublication(f.db), r = structuredClone(p.rows[0]); r.history.points[0].bar.open='99';
    await originalPrepare('UPDATE screener_candlestick_rows SET payload=? WHERE snapshot_id=? AND symbol=?').bind(JSON.stringify(r),p.id,r.symbol).run();
    assert.equal((await http(f.db)).status,503);
  } finally { f.db.close(); }
});
test('缺舊同日能力保留 unknown；外層 all／any 且 profile 不變，過期底稿 stale', async () => {
  const f = await fixture(); try {
    await publishCandlestickHistory(f.options);
    const c = criteria(); c.volume.enabled = true;
    const all = await http(f.db,c); assert.equal(all.status,200); assert.equal(all.body.legacyJoin.reason,'same_session_legacy_pending');
    c.mode='any'; const any = await http(f.db,c,{ resultState:'unknown' }); assert.equal(any.body.counts.unknown,2);
    c.volume.enabled=false; c.bollSqueezeStages.enabled=true;
    assert.equal((await http(f.db,c,{ resultState:'unknown' })).body.bollingerJoin.reason,'same_session_bollinger_pending');
    assert.equal((await http(f.db,criteria(),{},'status',new Date('2026-10-05T06:00:01Z'))).body.state,'stale');
    assert.equal(f.db.database.prepare('SELECT COUNT(*) n FROM screener_bollinger_profiles').get().n,0);
  } finally { f.db.close(); }
});
test('schema 不足不影響舊功能；status 不建 schema，gateway GET-only／版本／界線', async () => {
  const db = new SqliteD1(); try {
    assert.equal((await http(db)).body.reason,'v9_schema_pending');
    assert.equal((await updateCandlestickScheduled(db)).reason,'v9_schema_pending');
    assert.equal((await updateBollingerScheduled(db)).reason,'schema_pending');
    const req = { method:'GET',url:'/api/stock-screener/status?version=9',headers:{ host:'127.0.0.1:5173' } };
    assert.equal(validateScreenerGatewayRequest(req).version,9);
    assert.equal(validateScreenerGatewayRequest({ ...req,method:'PUT' }).status,405);
    assert.equal(validateScreenerGatewayRequest({ ...req,url:'/api/stock-screener/daily-profile?version=9' }).status,400);
    assert.throws(()=>parseCandlestickHttpQuery(new URLSearchParams({ version:'9',criteria:JSON.stringify(criteria()),limit:'101' })),/invalid_v9_query/);
    assert.throws(()=>parseCandlestickHttpQuery(new URLSearchParams({ version:'9',criteria:JSON.stringify(criteria()),stage:'compressing' })),/invalid_v9_query/);
  } finally { db.close(); }
});
test('背景只讀正式已存 authority 重算；profile 停用仍可獨立準備，無來源 HTTP', async () => {
  const f = await fixture(); try {
    assert.equal(await readCandlestickStoredCalendar(f.db,now()),null);
    const b = { version:1,sessions:[...sessions,future],sourceHashes:['a'.repeat(64),'b'.repeat(64)],validThrough:'2026-10-06T06:00:00Z' };
    const text = JSON.stringify({ stat:'ok',fields:['項次','標題','日期','zhId','enId'],data:[],totalCount:0 });
    const sourceHash = await technicalEvidenceHash(text), proof = { year:2026,sourceHash,sourceUrl:closureSourceUrl(2026),notices:[] };
    const baseAuthorityHash = await technicalEvidenceHash(b), commonSessions=b.sessions;
    const authorityHash=await technicalEvidenceHash({ policy:CLOSURE_POLICY,baseAuthorityHash,proofs:[proof],commonSessions });
    for (const [id,payload] of [['screener-bollinger-calendar',b],['bollinger-calendar-closures:2026',{
      policy:CLOSURE_POLICY,sourceUrl:closureSourceUrl(2026),sourceHash,text,fetchedAt:now().toISOString() }],['bollinger-calendar-effective',{
        policy:CLOSURE_POLICY,baseAuthorityHash,authorityHash,commonSessions,proofs:[{ year:2026,sourceHash,notices:[] }] }]])
      await f.db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,'fixture','verified',?,?)").bind(id,JSON.stringify(payload),now().toISOString()).run();
    for (const u of universe) await f.db.prepare('INSERT INTO screener_universe VALUES(?,?,?,?,?)').bind('fixture-v9-u',u.symbol,u.market,through,
      JSON.stringify({ review:'verified',revision:'fixture-v9-u',sourceDate:through,stock:{ ...u,kind:'ordinary',classificationVersion:'fixture' },
        provenance:{ source:u.market,payloadHash:'f'.repeat(64) } })).run();
    assert.equal((await readCandlestickStoredCalendar(f.db,now())).authorityHash,authorityHash);
    // 正式年度準備器會合法重用 screener-period-evidence，v9 必須接受同一 hash 的 cache。
    await f.db.prepare("UPDATE screener_runs SET id='screener-period-evidence' WHERE id='screener-bollinger-calendar'").run();
    assert.equal((await readCandlestickStoredCalendar(f.db,now())).authorityHash,authorityHash);
    await f.db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES('screener-bollinger-calendar','fixture','verified',?,?)")
      .bind(JSON.stringify({...b,sourceHashes:['d'.repeat(64),'e'.repeat(64)]}),now().toISOString()).run();
    assert.equal((await readCandlestickStoredCalendar(f.db,now())).authorityHash,authorityHash);
    await f.db.prepare("UPDATE screener_runs SET checkpoint=? WHERE id='screener-period-evidence'").bind(JSON.stringify({...b,sourceHashes:['d'.repeat(64),'e'.repeat(64)]})).run();
    assert.equal(await readCandlestickStoredCalendar(f.db,now()),null);
    await f.db.prepare("UPDATE screener_runs SET checkpoint=? WHERE id='screener-period-evidence'").bind(JSON.stringify(b)).run();
    const r=await updateCandlestickScheduled(f.db,now); assert.equal(r.state,'published');
    assert.equal((await updateBollingerScheduled(f.db)).reason,'profile_disabled');
    const second=await updateCandlestickScheduled(f.db,now); assert.equal(second.state,'unchanged');
    const before=f.db.database.prepare('SELECT total_changes() n').get().n;
    await updateCandlestickScheduled(f.db,now);
    assert.equal(f.db.database.prepare('SELECT total_changes() n').get().n,before);
  } finally { f.db.close(); }
});

test('並行 publisher 只有一個成功 head；另一份不覆寫來源或成功收據', async () => {
  const f = await fixture(); try {
    const results = await Promise.all([publishCandlestickHistory(f.options),publishCandlestickHistory(f.options)]);
    assert.equal(results.filter(r=>r.state==='published').length,1);
    assert.equal(f.db.database.prepare("SELECT COUNT(*) n FROM screener_candlestick_publications WHERE status='published'").get().n,1);
    assert.equal(f.db.database.prepare("SELECT COUNT(*) n FROM screener_candlestick_receipts WHERE status='published'").get().n,1);
    assert.ok(await readCandlestickPublication(f.db));
  } finally { f.db.close(); }
});
test('最後一批遭破壞不可切 head；失敗 staging／receipt 保留，合法重試另立 snapshot', async () => {
  const f = await fixture(); try {
    const originalBatch=f.db.batch.bind(f.db); let injected=false;
    f.db.batch=async statements=>{
      const result=await originalBatch(statements);
      if (!injected && statements.some(s=>s.sql.startsWith('INSERT INTO screener_candlestick_rows'))) {
        injected=true; f.db.database.prepare("UPDATE screener_candlestick_rows SET payload=json_set(payload,'$.name','corrupted')").run();
      }
      return result;
    };
    await assert.rejects(publishCandlestickHistory(f.options),/invalid_v9_rows_hash/);
    assert.equal(await readCandlestickPublication(f.db),null);
    assert.equal(f.db.database.prepare("SELECT COUNT(*) n FROM screener_candlestick_publications WHERE status='failed'").get().n,1);
    assert.equal(f.db.database.prepare("SELECT COUNT(*) n FROM screener_candlestick_receipts WHERE status='failed'").get().n,1);
    f.db.batch=originalBatch;
    assert.equal((await publishCandlestickHistory(f.options)).state,'published');
    assert.equal(f.db.database.prepare("SELECT COUNT(*) n FROM screener_candlestick_publications WHERE status='failed'").get().n,1);
  } finally { f.db.close(); }
});
test('能力／price basis 改動不沿用同鍵成功；immutable DB 重新驗證每次讀取', async () => {
  for (const field of ['capability','priceBasis','formulaVersion','calendarHash','universeHash','sourceMappingVersion']) {
    const f=await fixture(); try {
      await publishCandlestickHistory(f.options);
      await f.db.prepare(`UPDATE screener_candlestick_publications SET metadata=json_set(metadata,'$.${field}','invalid')`).run();
      await assert.rejects(readCandlestickPublication(f.db));
      assert.equal((await http(f.db)).status,503);
    } finally { f.db.close(); }
  }
});
