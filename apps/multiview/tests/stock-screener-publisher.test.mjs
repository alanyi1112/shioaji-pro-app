import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { publishCollectedScreener } from '../worker/stock-screener-publisher.ts';
import { readScreenerSnapshot } from '../worker/stock-screener-repository.ts';
import { parseDailyReport } from '../../../scripts/stock-screener-update.mjs';
const migrations = await Promise.all(['0027_pale_randall_flagg.sql','0028_early_sir_ram.sql'].map(name=>readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8')));
const now = new Date('2026-08-31T11:00:00Z');
const periods = { version: 1, through: '2026-08-31', sessions: ['2026-08-27','2026-08-28','2026-08-31','2026-09-01'], weeks: ['2026-08-21','2026-08-28'], fetchedAt: now.toISOString(), validThrough: '2026-09-01T10:00:00Z', sourceHashes: ['a'.repeat(64)] };
const stock = { code: '2330', symbol: '2330.TW', name: 'fixture', market: 'TWSE', kind: 'ordinary', classificationVersion: 'official-issuer-common-stock-FL033103-1131231-v1' };
const provenance = {source:'official',sourceUrl:'https://example.invalid',fetchedAt:now.toISOString(),payloadHash:'fixture',normalizationVersion:'1'};
const holderPoint=(ratio,date)=>{const scaled=Math.round(Number(ratio)*100);return {date,provenance,bands:Array.from({length:17},(_,i)=>{const level=i+1;return {level,
  shares:String(level===1?10000-scaled:level===15?scaled:level===17?10000:0),holders:String(level===1||level===15?1:level===17?2:0),
  ratio:level===15?ratio:level===1?((10000-scaled)/100).toFixed(2):level===17?'100.00':'0.00'};})};};
test('發布須有完整名冊及整期 receipt，不能從單股有值猜前一期；日／週獨立', async () => {
  const db = new SqliteD1(); for (const migration of migrations) applyDrizzleSql(db, migration);
  try {
    assert.equal((await publishCollectedScreener(db, periods, now)).reason, 'catalog_pending');
    await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES ('screener-daily','screener-daily','collected',?,?)").bind(JSON.stringify({ receipts: { catalog: { hash:'revision',total:1,offset:1,complete:true } } }), now.toISOString()).run();
    await db.prepare("INSERT INTO screener_universe(revision,symbol,market,data_date,payload) VALUES('revision','2330.TW','TWSE','2026-08-31',?)").bind(JSON.stringify({ stock, review:'verified',sourceDate:'2026-08-31' })).run();
    assert.equal((await publishCollectedScreener(db, periods, now)).reason, 'period_pending');
    for (const source of ['TWSE','TPEx']) for (const date of ['2026-08-28','2026-08-31']) await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES (?,'screener-source-period','collected',?,?)").bind(`${source}:${date}`,JSON.stringify({ source,date,complete:true }),now.toISOString()).run();
    const result = await publishCollectedScreener(db, periods, now);
    assert.equal(result.state,'published');
    assert.deepEqual(result.anchors,{daily:{current:'2026-08-31',previous:'2026-08-28'},weekly:null,weeklyPeriods:['2026-08-21','2026-08-28']});
    const snapshot = await readScreenerSnapshot(db);
    assert.equal(snapshot.metadata.version,2);
    assert.deepEqual(snapshot.metadata.anchors.weeklyPeriods,['2026-08-21','2026-08-28']);
    assert.equal(snapshot.inputs[0].currentVolume,null);
    assert.equal(snapshot.inputs[0].currentHolder,null);
    await assert.rejects(publishCollectedScreener(db,{...periods,fetchedAt:'2026-08-30T11:00:00Z'},now),/invalid_period_evidence/);
  } finally { db.close(); }
});
test('官方歷史批次按欄名解析精確股數與成交值，日期被忽略／未知格式拒絕', () => {
  const provenance = {source:'TWSE',normalizationVersion:'screener-official-v1'};
  const payload = {stat:'OK',date:'20260828',tables:[{fields:['成交金額','成交股數','證券代號'],data:[['12,345,600','9,007,199,254,740,993','2330']]}]};
  const point = parseDailyReport(payload,'TWSE','2026-08-28',provenance).points.get('2330.TW');
  assert.equal(point.shares,'9007199254740993'); assert.equal(point.turnoverNtd,'12345600'); assert.equal(point.turnoverField,'TradeValue');
  assert.throws(()=>parseDailyReport(payload,'TWSE','2026-08-31',provenance),/invalid_report_date/);
  assert.throws(()=>parseDailyReport({...payload,tables:[]},'TWSE','2026-08-28',provenance),/invalid_report_schema/);
});
test('v2 publisher 以官方六期順序嵌入 holder series 與成交值覆蓋，不用最近任意列補位',async()=>{
  const db=new SqliteD1(); for(const migration of migrations) applyDrizzleSql(db,migration);
  const weeks=['2026-07-24','2026-07-31','2026-08-07','2026-08-14','2026-08-21','2026-08-28'];
  const evidence={...periods,weeks};
  try {
    await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES ('screener-daily','screener-daily','collected',?,?)").bind(JSON.stringify({receipts:{catalog:{hash:'revision',total:1,offset:1,complete:true}}}),now.toISOString()).run();
    await db.prepare("INSERT INTO screener_universe(revision,symbol,market,data_date,payload) VALUES('revision','2330.TW','TWSE','2026-08-31',?)").bind(JSON.stringify({stock,review:'verified',sourceDate:'2026-08-31'})).run();
    for(const source of ['TWSE','TPEx']) for(const date of ['2026-08-28','2026-08-31']) await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES (?,'screener-source-period','collected',?,?)").bind(`${source}:${date}`,JSON.stringify({source,date,complete:true}),now.toISOString()).run();
    for(const date of weeks) {
      await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES (?,'screener-source-period','collected',?,?)").bind(`TDCC:${date}`,JSON.stringify({source:'TDCC',date,complete:true}),now.toISOString()).run();
      await db.prepare("INSERT INTO screener_tdcc_weekly(symbol,data_date,payload,validation) VALUES('2330.TW',?,?,'full-17')").bind(date,JSON.stringify(holderPoint('60.20',date))).run();
    }
    for(const date of ['2026-08-28','2026-08-31']) await db.prepare("INSERT INTO screener_daily_volume(symbol,data_date,payload) VALUES('2330.TW',?,?)").bind(date,JSON.stringify({date,shares:'100',market:'TWSE',unit:'shares',basis:'fixture',turnoverNtd:'12345600',turnoverCurrency:'TWD',turnoverField:'TradeValue',turnoverBasis:'fixture',turnoverMappingVersion:'official-daily-trade-value-v1',provenance})).run();
    await publishCollectedScreener(db,evidence,now);
    const snapshot=await readScreenerSnapshot(db);
    assert.deepEqual(snapshot.metadata.anchors.weeklyPeriods,weeks); assert.equal(snapshot.inputs[0].holderSeries.length,6);
    assert.deepEqual(snapshot.metadata.turnoverCoverage,{valid:1,missing:0}); assert.deepEqual(snapshot.metadata.holderHistoryCoverage,{requiredPeriods:weeks,complete:1,pending:0});
    assert.equal(snapshot.metadata.background.remaining,0);
  } finally {db.close();}
});
