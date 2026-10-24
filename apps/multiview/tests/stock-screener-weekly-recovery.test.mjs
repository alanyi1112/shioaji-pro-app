import test from 'node:test';
import assert from 'node:assert/strict';
import {weeklyRecoveryPeriods} from '../../../scripts/stock-screener-weekly-recovery.mjs';
const now=new Date('2026-10-23T17:10:00.000Z');
const original={version:1,weeks:['2026-10-08','2026-10-16'],sourceHashes:['a'.repeat(64)],fetchedAt:'2026-10-23T08:28:00.000Z',validThrough:'2026-10-27T06:00:00.000Z'};
const calendar={status:'verified',commonSessions:['2026-10-21','2026-10-22','2026-10-26'],validThrough:'2026-10-24T08:00:00.000Z',authorityHash:'b'.repeat(64)};
const weekly=[{date:'2026-10-22',hash:'c'.repeat(64)}];
test('只加入來源實際揭露的週四，不推測休市週五，也不刷新原證據時間',()=>{
 const p=weeklyRecoveryPeriods(original,calendar,weekly,'2026-10-22',now);
 assert.deepEqual(p.weeks,['2026-10-08','2026-10-16','2026-10-22']);
 assert.equal(p.fetchedAt,original.fetchedAt);assert.equal(p.validThrough,calendar.validThrough);
 assert.deepEqual(p.sourceHashes,['a'.repeat(64),'b'.repeat(64),'c'.repeat(64)]);
 assert.deepEqual(original.weeks,['2026-10-08','2026-10-16']);
});
test('過期、未知日曆、非交易日、未來週與缺收據全部拒絕',()=>{
 for(const [o,c,w,d]of[
 [{...original,fetchedAt:'2026-10-22T00:00:00Z'},calendar,weekly,'2026-10-22'],
 [original,{...calendar,status:'unknown'},weekly,'2026-10-22'],
 [original,calendar,weekly,'2026-10-23'],[original,calendar,[{...weekly[0],date:'2026-10-23'}],'2026-10-22'],
 [original,calendar,[],'2026-10-22'],[original,{...calendar,validThrough:now.toISOString()},weekly,'2026-10-22'],
 [original,calendar,[{...weekly[0],hash:'invalid'}],'2026-10-22']])assert.throws(()=>weeklyRecoveryPeriods(o,c,w,d,now),/invalid_period_evidence/);
});

test('新整批官方週來源可接續舊歷史日期事實，原時間與雜湊另保留，不假裝舊來源剛下載',()=>{
 const old={...original,fetchedAt:'2026-10-22T00:00:00Z'};
 const fresh=[{...weekly[0],fetchedAt:'2026-10-23T17:05:00.000Z'}];
 const p=weeklyRecoveryPeriods(old,calendar,fresh,'2026-10-22',now);
 assert.equal(p.fetchedAt,fresh[0].fetchedAt);
 assert.equal(p.reusedPeriodEvidence.originalFetchedAt,old.fetchedAt);
 assert.equal(p.reusedPeriodEvidence.latestSourceReceiptHash,fresh[0].hash);
 assert.equal(old.fetchedAt,'2026-10-22T00:00:00Z');
 assert.throws(()=>weeklyRecoveryPeriods(old,calendar,[{...fresh[0],fetchedAt:'2026-10-24T00:00:00Z'}],'2026-10-22',now),/invalid_period_evidence/);
});

test('新掛牌當日量值重用實際報表，不補掛牌前一日、不覆寫原值；錯日期拒絕',async()=>{
 const {SqliteD1,applyDrizzleSql}=await import('./helpers/sqlite-d1.mjs');
 const {readFile}=await import('node:fs/promises');
 const {repairNewListingVolumes}=await import('../../../scripts/stock-screener-weekly-recovery.mjs');
 const db=new SqliteD1();applyDrizzleSql(db,await readFile(new URL('../drizzle/0027_pale_randall_flagg.sql',import.meta.url),'utf8'));
 const stocks=[{symbol:'2249.TWO',market:'TPEx',listingDate:'2026-10-22'}];
 const report={sourceUrl:'https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=2026%2F10%2F22&id=&response=json',status:200,fetchedAt:now.toISOString(),
  text:JSON.stringify({date:'20261022',stat:'ok',tables:[{fields:['代號','成交股數','成交金額(元)'],data:[['2249','658,967','44,883,816']]},{fields:['代號','成交股數','成交金額(元)'],data:[]}]})};
 assert.equal(await repairNewListingVolumes(db,stocks,'2026-10-22',[report],now),1);
 assert.equal(await repairNewListingVolumes(db,stocks,'2026-10-22',[report],now),0);
 const rows=(await db.prepare('SELECT data_date,payload FROM screener_daily_volume').all()).results;
 assert.equal(rows.length,1);assert.equal(rows[0].data_date,'2026-10-22');assert.equal(JSON.parse(rows[0].payload).shares,'658967');
 assert.equal(JSON.parse(rows[0].payload).turnoverNtd,'44883816');
 await assert.rejects(repairNewListingVolumes(db,stocks,'2026-10-22',[{...report,text:report.text.replace('20261022','20261021')}],now),/invalid_report_date/);
 db.close();
});
