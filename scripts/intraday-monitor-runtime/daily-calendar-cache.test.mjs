import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildOfficialMarketCalendarSnapshot, parseTwseOfficialCalendar, parseTpexOfficialCalendar } from '../smart-order-runtime/official-market-calendar-core.mjs';
import { readDailyCalendarCache, saveDailyCalendarCache, verifyDailyCalendarCache } from './daily-calendar-cache.mjs';
const twse = { stat:'ok', queryYear:2026, fields:['日期','名稱','說明'], data:[['2026-01-01','元旦','依規定放假1日。'],['2026-01-02','國曆新年開始交易日','國曆新年開始交易。']] };
const tpex = { data:{html:'<table class="page-table"><tr><td>中華民國115年有價證券櫃檯買賣市場開（休）市日期表</td></tr></table><table class="page-table"><tr><th>紀念節日名稱</th><th>日期</th><th>星期</th><th>說明</th></tr><tr><td>中華民國開國紀念日</td><td>1月1日</td><td>四</td><td>依規定放假1日。</td></tr><tr><td>國曆新年開始交易日</td><td>1月2日</td><td>五</td><td>國曆新年開始交易。</td></tr></table>'}};
const fetchedAt='2026-10-12T05:35:00.000Z';
const version=buildOfficialMarketCalendarSnapshot({twse:parseTwseOfficialCalendar(twse,2026),tpex:parseTpexOfficialCalendar(tpex,2026),fetchedAtEpochMs:Date.parse(fetchedAt)}).calendarVersion;
const calendar={tradeDate:'2026-10-12',targetTradeDate:'2026-10-13',twse,tpex,calendarSourceVersion:version};
test('日曆獨立於v1包，exclusive不可變保存、同鍵no-op及零寫入權限',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'daily-calendar-'));
 try { const first=await saveDailyCalendarCache({root,calendar,fetchedAt});
  assert.equal((await saveDailyCalendarCache({root,calendar,fetchedAt})).alreadyPresent,true);
  const read=await readDailyCalendarCache({root,now:new Date('2026-10-13T08:20:00+08:00'),tradeDate:'2026-10-13'});
  assert.equal(read.snapshot.calendarVersion,version); assert.equal(read.value.brokerWriteAuthority,false);
  assert.equal(first.file,read.file);
 } finally {await rm(root,{recursive:true,force:true});}
});
test('錯誤來源hash、目標日、future及過期不得取得日曆權限',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'daily-calendar-'));
 try { const saved=await saveDailyCalendarCache({root,calendar,fetchedAt}); const value=JSON.parse(await readFile(saved.file,'utf8'));
  for(const change of [{calendarVersion:'sha256:'+'a'.repeat(64)},{targetTradeDate:'2026-10-14'},{fetchedAt:'2026-10-14T00:00:00Z'}]) {
   const { evidenceHash: _hash, ...body } = {...value,...change};
   const rehashed = {...body,evidenceHash:createHash('sha256').update(JSON.stringify(body)).digest('hex')};
   assert.throws(()=>verifyDailyCalendarCache(rehashed,new Date('2026-10-13T08:20:00+08:00')));
  }
  await assert.rejects(readDailyCalendarCache({root,now:new Date('2026-10-21T08:20:00+08:00'),tradeDate:'2026-10-21'}),/stale/);
  await writeFile(saved.file,JSON.stringify({...value,twse:{...twse,data:[]}}));
  await assert.rejects(readDailyCalendarCache({root,now:new Date('2026-10-13T08:20:00+08:00'),tradeDate:'2026-10-13'}),/hash/);
 } finally {await rm(root,{recursive:true,force:true});}
});
test('無新快取可沿用legacy；operator-repair不冒充postclose',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'daily-calendar-'));
 try {assert.equal(await readDailyCalendarCache({root,now:new Date(fetchedAt),tradeDate:'2026-10-13'}),null);
  await saveDailyCalendarCache({root,calendar,fetchedAt,trigger:'operator-repair'});
  assert.equal((await readDailyCalendarCache({root,now:new Date(fetchedAt),tradeDate:'2026-10-13'})).value.trigger,'operator-repair');
 } finally {await rm(root,{recursive:true,force:true});}
});
