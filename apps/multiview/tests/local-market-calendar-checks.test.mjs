import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketCalendar} from '../../../src/lib/market-calendar.ts';
import {checkLocalStoredMarketData,handleLocalMarketCalendarCheck} from '../worker/local-market-calendar-checks.ts';
import {SqliteD1} from './helpers/sqlite-d1.mjs';
import {readLocalCalendarDataCheck} from '../../../scripts/local-calendar-check-bridge.mjs';
const now=new Date('2026-10-23T22:00:00+08:00');
const empty={available:true,revision:0,hash:null,entries:[],liveHolds:[]};
const annual={verified:true,calendarVersion:'fixture-annual',fetchedAtEpochMs:+now-1000,validUntilEpochMs:+now+3600000,
  days:['2026-10-22','2026-10-23'].map(tradeDate=>({tradeDate,TSE:'scheduled_trading',OTC:'scheduled_trading'}))};
const calendar=createMarketCalendar(annual,{...empty,revision:1,hash:'a'.repeat(64),
  entries:[{date:'2026-10-23',markets:['TSE'],reason:'fixture',revision:1,recordedAt:now.toISOString(),source:'local_user'}]},now);
const q=(extra={})=>({symbol:'2330.TW',from:'2026-10-23',through:'2026-10-23',dataset:'candles',interval:'1d',...extra});
function db(){const d=new SqliteD1();d.exec(`CREATE TABLE candle_history(provider TEXT,symbol TEXT,interval TEXT,time INTEGER,open REAL,high REAL,low REAL,close REAL,volume REAL);
 CREATE TABLE screener_chip_daily(symbol TEXT,session_date TEXT,market TEXT,institutional_receipt_id TEXT,margin_receipt_id TEXT,institutional_invalid_reason TEXT,institutional_mapping_version TEXT,foreign_net_shares TEXT,investment_trust_net_shares TEXT,margin_today_balance_lots TEXT,short_today_balance_lots TEXT);
 CREATE TABLE screener_chip_receipts(id TEXT,market TEXT,dataset TEXT,requested_date TEXT,source_date TEXT,status TEXT,missing_count INTEGER,invalid_count INTEGER);
 CREATE TABLE screener_institutional_mapping_verifications(receipt_id TEXT,mapping_version TEXT,status TEXT);`);
 const prepare=d.prepare.bind(d);d.prepare=sql=>{assert.match(sql,/^SELECT /);return prepare(sql);};return d;}
test('日 K 休市排除／單市場真缺口，版本每次重核且沒有 DB 寫入',async()=>{
 const d=db();try{
  assert.equal((await checkLocalStoredMarketData(d,calendar,q(),now)).status,'complete');
  const other=await checkLocalStoredMarketData(d,calendar,q({symbol:'8069.TWO'}),now);
  assert.equal(other.status,'partial');assert.deepEqual(other.missing,['2026-10-23']);
  const reopened=createMarketCalendar(annual,empty,now);
  const fresh=await checkLocalStoredMarketData(d,reopened,q(),now);assert.equal(fresh.status,'partial');assert.notEqual(fresh.calendarVersion,other.calendarVersion);
  assert.equal(fresh.externalRequests,0);assert.equal(fresh.changedDb,false);assert.deepEqual(fresh.repairRows,[]);
 }finally{d.close();}
});
test('現存休市資料衝突不得隱藏；日 K 不寫回或補造',async()=>{
 const d=db();try{d.database.prepare('INSERT INTO candle_history VALUES(?,?,?,?,?,?,?,?,?)').run('yfinance','2330.TW','1d',Date.parse('2026-10-23T09:00:00+08:00')/1000,100,102,99,101,1000);
 const before=d.database.prepare('SELECT total_changes() n').get().n;
 const r=await checkLocalStoredMarketData(d,calendar,q(),now);assert.equal(r.status,'conflict');assert.deepEqual(r.conflicts,['2026-10-23']);
 assert.equal(d.database.prepare('SELECT total_changes() n').get().n,before);
 }finally{d.close();}
});
test('分 K 不存在持久證據回 unknown；明確範圍全分鐘才能通過',async()=>{
 const d=db();try{const query=q({from:'2026-10-22',through:'2026-10-22',interval:'1m'});
 assert.equal((await checkLocalStoredMarketData(d,calendar,query,now)).reason,'intraday_store_not_proven');
 const insert=d.database.prepare('INSERT INTO candle_history VALUES(?,?,?,?,?,?,?,?,?)');
 for(let n=0;n<270;n++)insert.run('yfinance','2330.TW','1m',Date.parse('2026-10-22T09:00:00+08:00')/1000+n*60,100,102,99,101,1000);
 assert.equal((await checkLocalStoredMarketData(d,calendar,query,now)).status,'complete');
 }finally{d.close();}
});
test('籌碼休市不缺日報；前一資料日仍缺；TDCC 缺期別阻擋、不用休市取消整週',async()=>{
 const d=db();try{
 assert.equal((await checkLocalStoredMarketData(d,calendar,q({dataset:'institutional-flow'}),now)).status,'not_expected');
 assert.equal((await checkLocalStoredMarketData(d,calendar,q({dataset:'margin-short',from:'2026-10-22',through:'2026-10-22'}),now)).status,'missing');
 assert.equal((await checkLocalStoredMarketData(d,calendar,q({dataset:'tdcc-weekly'}),now)).reason,'weekly_period_contract_missing');
 }finally{d.close();}
});
test('籌碼必須同日 receipt 與映射；錯日期衝突、未驗不能 pass',async()=>{
 const d=db();try{
 d.database.exec(`INSERT INTO screener_chip_daily(symbol,session_date,market,margin_receipt_id,margin_today_balance_lots,short_today_balance_lots) VALUES('2330.TW','2026-10-22','TWSE','r','1','0');
 INSERT INTO screener_chip_receipts VALUES('r','TWSE','margin-short','2026-10-22','2026-10-21','verified',0,0);`);
 const query=q({dataset:'margin-short',from:'2026-10-22',through:'2026-10-22'});
 assert.equal((await checkLocalStoredMarketData(d,calendar,query,now)).status,'conflict');
 d.database.exec(`UPDATE screener_chip_receipts SET source_date='2026-10-22',status='staging'`);
 assert.equal((await checkLocalStoredMarketData(d,calendar,query,now)).status,'unknown');
 d.database.exec(`UPDATE screener_chip_receipts SET status='verified'`);
 assert.equal((await checkLocalStoredMarketData(d,calendar,query,now)).status,'available');
 }finally{d.close();}
});
for(const [label,modify,reason]of[
 ['投影過期',c=>({...c,observedAt:new Date(+now-10001).toISOString()}),'calendar_projection_unavailable_or_stale'],
 ['年度效期到期',c=>({...c,annual:{...annual,validUntilEpochMs:+now}}),'calendar_or_data_unconfirmed'],
 ['設定不可驗',c=>({...c,closures:{...empty,available:false}}),'calendar_projection_unavailable_or_stale']
])test(label+' 不降級開市，也不新增查詢來源',async()=>{const d=db();try{
 const result=await checkLocalStoredMarketData(d,modify(calendar),q({from:'2026-10-22',through:'2026-10-22'}),now);
 assert.equal(result.status,'unknown');assert.equal(result.reason,reason);
 }finally{d.close();}});
test('DB/schema 缺證不初始化、不 migration',async()=>{
 const result=await checkLocalStoredMarketData({prepare(){throw Error('no schema');}},calendar,q(),now);
 assert.equal(result.status,'unknown');assert.equal(result.reason,'local_schema_or_read_unavailable');
});
for(const value of [q({symbol:'BTC'}),q({symbol:"2330.TW' OR 1=1"}),q({dataset:'repair'}),q({from:'2026-02-30'}),q({interval:'1m',from:'2026-10-01'}),{...q(),url:'https://example.invalid'}])
 test('固定白名單拒絕 '+JSON.stringify(value),async()=>{
  const r=await checkLocalStoredMarketData({prepare(){throw Error('must not read');}},calendar,value,now);assert.equal(r.reason,'check_input_invalid');
 });
test('Worker 正式站完全不使用本機日曆，loopback 跨來源也拒絕',async()=>{
 const request=(origin='http://127.0.0.1:5174')=>new Request('http://127.0.0.1:5174/api/local-market-calendar/check',
  {method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({calendar,query:q()})});
 assert.equal((await handleLocalMarketCalendarCheck(request(),{DEPLOYMENT_TARGET:'cloudflare'},now)).status,404);
 assert.equal((await handleLocalMarketCalendarCheck(request('https://example.invalid'),{DEPLOYMENT_TARGET:'local'},now)).status,403);
 const d=db();try{const r=await handleLocalMarketCalendarCheck(request(),{DEPLOYMENT_TARGET:'local',DB:d},now);
 assert.equal(r.status,200);assert.equal((await r.json()).check.status,'complete');}finally{d.close();}
});
test('本機 bridge 僅單次固定 POST，不跟轉址、不接受 query 假 calendar',async()=>{
 let count=0;const r=await readLocalCalendarDataCheck(q(),calendar,{fetchImpl:async(url,init)=>{
  count++;assert.equal(url,'http://127.0.0.1:5174/api/local-market-calendar/check');assert.equal(init.redirect,'manual');
  assert.equal(JSON.parse(init.body).calendar.version,calendar.version);
  return Response.json({ok:true,check:{schemaVersion:'local-market-calendar-check/1',calendarVersion:calendar.version,
    externalRequests:0,changedDb:false,automaticRepairAllowed:false,status:'complete'}});
 }});assert.equal(r.status,200);assert.equal(count,1);
 const invalid=await readLocalCalendarDataCheck({...q(),calendar},calendar,{fetchImpl:()=>{throw Error('never');}});assert.equal(invalid.status,422);
});
test('本機 Vite 僅附加相同 Host 可通過，不採信代理 Host 改寫來源',async()=>{
 const request=headers=>new Request('http://127.0.0.1:5174/api/local-market-calendar/check',{
  method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({calendar,query:q()})});
 const d=db();try{
  const r=await handleLocalMarketCalendarCheck(request({'x-forwarded-host':'127.0.0.1:5174'}),{DEPLOYMENT_TARGET:'local',DB:d},now);
  assert.equal(r.status,200);assert.equal((await r.json()).check.status,'complete');
  for(const headers of [
   {'x-forwarded-host':'example.invalid'}, {'x-forwarded-host':'localhost:5174'},
   {'x-forwarded-host':''}, {'x-forwarded-host':'127.0.0.1:5174, example.invalid'},
   {'x-forwarded-host':'127.0.0.1:5174',forwarded:'host=127.0.0.1:5174'},
   {'x-forwarded-host':'127.0.0.1:5174','x-forwarded-for':'127.0.0.1'},
   {'x-forwarded-host':'127.0.0.1:5174',origin:'https://example.invalid'},
  ])assert.equal((await handleLocalMarketCalendarCheck(request(headers),{DEPLOYMENT_TARGET:'local',DB:d},now)).status,403);
  assert.equal((await handleLocalMarketCalendarCheck(request({'x-forwarded-host':'127.0.0.1:5174'}),{DEPLOYMENT_TARGET:'cloudflare',DB:d},now)).status,404);
 }finally{d.close();}
});
for(const response of [()=>new Response(null,{status:307,headers:{location:'https://example.invalid'}}),()=>new Response('x'.repeat(512*1024+1)),()=>Response.json({ok:true,check:{status:'complete'}})])
 test('bridge 失敗有界，不重試／放行',async()=>{let count=0;const r=await readLocalCalendarDataCheck(q(),calendar,{fetchImpl:async()=>{count++;return response();}});assert.equal(r.status,503);assert.equal(count,1);});
