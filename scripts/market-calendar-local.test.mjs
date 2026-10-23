import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildOfficialMarketCalendarSnapshot,parseTwseOfficialCalendar,parseTpexOfficialCalendar} from './smart-order-runtime/official-market-calendar-core.mjs';
import {saveDailyCalendarCache,verifyDailyCalendarCache} from './intraday-monitor-runtime/daily-calendar-cache.mjs';
import {saveSpecialMarketClosure,readSpecialMarketClosures} from './market-calendar-store.mjs';
import {readLocalMarketCalendar} from './market-calendar-local.mjs';
import {selectSharedMonitorTradingDay} from './intraday-monitor-runtime/trading-calendar-authority.mjs';
import {createMarketCalendar,marketCalendarDay} from '../src/lib/market-calendar.ts';
const twse={stat:'ok',queryYear:2026,fields:['日期','名稱','說明'],data:[['2026-01-01','元旦','依規定放假1日。'],['2026-01-02','國曆新年開始交易日','國曆新年開始交易。']]};
const tpex={data:{html:'<table class="page-table"><tr><td>中華民國115年有價證券櫃檯買賣市場開（休）市日期表</td></tr></table><table class="page-table"><tr><th>紀念節日名稱</th><th>日期</th><th>星期</th><th>說明</th></tr><tr><td>中華民國開國紀念日</td><td>1月1日</td><td>四</td><td>依規定放假1日。</td></tr><tr><td>國曆新年開始交易日</td><td>1月2日</td><td>五</td><td>國曆新年開始交易。</td></tr></table>'}};
const now=new Date('2026-10-12T13:35:00+08:00');
const annual=buildOfficialMarketCalendarSnapshot({twse:parseTwseOfficialCalendar(twse,2026),tpex:parseTpexOfficialCalendar(tpex,2026),fetchedAtEpochMs:+now});
async function fixture(run){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'shared-calendar-')));
 try{await run(root);}finally{fs.rmSync(root,{recursive:true,force:true});}}
test('新 cache 保存人工版本與跳過休市後的 target；三類 consumer 的版本相同',()=>fixture(async root=>{
 const state=saveSpecialMarketClosure(root,{action:'close',date:'2026-10-13',markets:['TSE','OTC'],reason:'fixture',confirmed:true,expectedRevision:0},{now});
 const manualClosures={available:true,revision:state.revision,hash:state.hash,entries:state.entries,liveHolds:state.liveHolds};
 const calendar=createMarketCalendar({...annual,verified:true},manualClosures,now);
 const saved=await saveDailyCalendarCache({root,fetchedAt:now.toISOString(),calendar:{tradeDate:'2026-10-12',targetTradeDate:'2026-10-14',
  twse,tpex,calendarSourceVersion:annual.calendarVersion,manualClosures,sharedCalendarVersion:calendar.version}});
 const value=JSON.parse(fs.readFileSync(saved.file,'utf8'));
 assert.equal(value.schemaVersion,'intraday-monitor-official-calendar-cache/2');
 assert.equal(verifyDailyCalendarCache(value,now).calendarVersion,annual.calendarVersion);
 const projected=readLocalMarketCalendar(root,{now});
 const monitor=selectSharedMonitorTradingDay({root,tradeDate:'2026-10-14',snapshots:[annual],observedAt:now.toISOString()});
 assert.equal(projected.version,calendar.version);assert.equal(monitor.calendarVersion,projected.version);
 assert.equal(monitor.previousTradeDate,'2026-10-12');assert.equal(marketCalendarDay(projected,'2026-10-13','TSE',now).state,'closed');
 assert.throws(()=>verifyDailyCalendarCache({...value,sharedCalendarVersion:'fake'},now),/hash_mismatch/);
}));
test('不改 cache 的實際效期，當下重核過期 unknown；人工休市仍只提供排除',()=>fixture(async root=>{
 const before=readLocalMarketCalendar(root,{now});assert.equal(before.annual,null);
 const state=saveSpecialMarketClosure(root,{action:'close',date:'2026-10-13',reason:'fixture',confirmed:true,expectedRevision:0},{now});
 await saveDailyCalendarCache({root,fetchedAt:now.toISOString(),calendar:{tradeDate:'2026-10-12',targetTradeDate:'2026-10-13',twse,tpex,calendarSourceVersion:annual.calendarVersion}});
 const later=new Date(annual.validUntilEpochMs),projection=readLocalMarketCalendar(root,{now:later});
 assert.equal(marketCalendarDay(projection,'2026-10-12','TSE',later).state,'unknown');
 assert.equal(marketCalendarDay(projection,'2026-10-13','TSE',later).state,'closed');
 assert.equal(readSpecialMarketClosures(root,{now:later}).hash,state.hash);
}));
test('最新 cache 損毀不回落、不生成目錄或啟動網路',()=>fixture(async root=>{
 const saved=await saveDailyCalendarCache({root,fetchedAt:now.toISOString(),calendar:{tradeDate:'2026-10-12',targetTradeDate:'2026-10-13',twse,tpex,calendarSourceVersion:annual.calendarVersion}});
 fs.writeFileSync(saved.file,'{');const before=fs.readdirSync(root);
 assert.equal(readLocalMarketCalendar(root,{now}).annual,null);assert.deepEqual(fs.readdirSync(root),before);
}));
