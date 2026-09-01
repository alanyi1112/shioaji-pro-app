import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { validateHistoryTableShape, parseScreenerTpexCalendar, boundedOfficialText } from '../../../scripts/stock-screener-periods.mjs';
import { updateScreener, pruneScreenerInputs, planScreenerHistory, buildHistoryProgress, dailySql, archiveHolderSql, parseDailyReport } from '../../../scripts/stock-screener-update.mjs';
const migrations = await Promise.all(['0027_pale_randall_flagg.sql','0028_early_sir_ram.sql'].map(name=>readFile(new URL(`../drizzle/${name}`, import.meta.url),'utf8')));
const setup = () => { const db=new SqliteD1(); for(const migration of migrations) applyDrizzleSql(db,migration); return db; };
const html = rows => `<div class="securities-overview"><table>${rows.map(row=>`<tr>${row.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</table></div>`;
const rows = () => [...Array.from({length:15},(_,i)=>[String(i+1),'級距','1','100','6.66']),['16','合　計','15','1500','100.00']];
test('歷史日報只接受逐市場核對的成交值欄名與同列資料', () => {
  const source={source:'official',sourceUrl:'https://example.invalid',fetchedAt:'2026-09-01T10:30:00Z',payloadHash:'fixture',normalizationVersion:'official-daily-trade-value-v1'};
  const twse=parseDailyReport({stat:'OK',date:'20260901',tables:[{fields:['證券代號','成交股數','成交金額'],data:[['2330','1,000','12,345,600']]}]},'TWSE','2026-09-01',source);
  assert.equal(twse.points.get('2330.TW').turnoverNtd,'12345600');
  const tpex=parseDailyReport({stat:'ok',date:'20260901',tables:[
    {fields:['代號','成交股數','成交金額(元)'],data:[['4768','2,000','7,797,300']]},
    {fields:['代號','成交股數','成交金額(元)'],data:[]},
  ]},'TPEx','2026-09-01',source);
  assert.equal(tpex.points.get('4768.TWO').turnoverNtd,'7797300');
  assert.throws(()=>parseDailyReport({stat:'ok',date:'20260901',tables:[
    {fields:['代號','成交股數','成交金額'],data:[['4768','2000','7797300']]},
    {fields:['代號','成交股數','成交金額'],data:[]},
  ]},'TPEx','2026-09-01',source),/invalid_report_schema/);
});
test('TDCC官網省略零調整列只能在十五級與合計精確對帳後接受；不明缺列不補零', () => {
  assert.equal(validateHistoryTableShape(html(rows())),16);
  const wrong = rows(); wrong.at(-1)[3]='1501';
  assert.throws(()=>validateHistoryTableShape(html(wrong)),/incomplete_tdcc/);
  assert.throws(()=>validateHistoryTableShape(html(rows().slice(1))),/incomplete_tdcc/);
  const unsafe = rows(); unsafe[0][3]='9007199254740993';
  assert.throws(()=>validateHistoryTableShape(html(unsafe)),/invalid_integer_precision/);
});
test('上櫃日曆僅略過明確非股票 rowspan 列，未知單欄列仍 fail closed', () => {
  const title = '<table><tr><td>115年開（休）市日期表</td></tr></table>';
  const holiday = '<tr><td>國慶日</td><td>10月9日</td><td>五</td><td>休市</td></tr>';
  const bond = '<tr><td>農曆春節前債券等殖成交系統（含比對系統）最後交易日</td></tr>';
  assert.deepEqual(parseScreenerTpexCalendar({data:{html:`${title}<table>${holiday}${bond}</table>`}},2026).closedDates,['2026-10-09']);
  assert.throws(()=>parseScreenerTpexCalendar({data:{html:`${title}<table>${holiday}<tr><td>未知股票規則</td></tr></table>`}},2026));
});
test('六期 planner 只補缺期、新商品不查上市前週期且可從 checkpoint 續跑',()=>{
  const weeks=['2026-07-24','2026-07-31','2026-08-07','2026-08-14','2026-08-21','2026-08-28'];
  const universe=[{symbol:'2330.TW',listingDate:'1994-09-05'},{symbol:'9999.TW',listingDate:'2026-08-10'}];
  const known=new Set(['2026-08-28|2330.TW','2026-08-21|2330.TW','2026-08-28|9999.TW']);
  const checked=new Set(['2026-08-14|2330.TW']);
  const plan=planScreenerHistory(universe,weeks,known,checked);
  assert.equal(plan.target,9); assert.equal(plan.processed,4);
  assert.deepEqual(plan.work.map(x=>x.key),['2026-08-21|9999.TW','2026-08-14|9999.TW','2026-08-07|2330.TW','2026-07-31|2330.TW','2026-07-24|2330.TW']);
  assert.deepEqual(buildHistoryProgress(plan,1,'2026-09-01T10:00:00Z',Date.parse('2026-09-01T11:00:00Z')),{version:2,target:9,processed:4,remaining:5,failed:1,overdue:5,cursor:'2026-08-21|9999.TW'});
  const crossYearWeeks=['2025-12-05','2025-12-12','2025-12-19','2025-12-26','2026-01-02','2026-01-09'];
  const crossYearPlan=planScreenerHistory([{symbol:'2330.TW',listingDate:'1994-09-05'}],crossYearWeeks,new Set(),new Set());
  assert.equal(crossYearPlan.target,6);
  assert.deepEqual(crossYearPlan.work.map(x=>x.date),crossYearWeeks.slice(0,-1).reverse());
  assert.throws(()=>planScreenerHistory(universe,weeks.slice(0,1)),/invalid_history_plan/);
});
test('同日較新稀疏日列不得清空已驗證成交值或其原成交量',async()=>{
  const db=setup();
  try {
    const old={date:'2026-08-31',shares:'100',turnoverNtd:'500000',provenance:{fetchedAt:'2026-08-31T10:00:00Z'}};
    const sparse={date:'2026-08-31',shares:'101',turnoverNtd:null,provenance:{fetchedAt:'2026-08-31T11:00:00Z'}};
    await db.prepare(dailySql).bind('2330.TW','2026-08-31',JSON.stringify(old)).run();
    await db.prepare(dailySql).bind('2330.TW','2026-08-31',JSON.stringify(sparse)).run();
    assert.deepEqual(JSON.parse((await db.prepare("SELECT payload FROM screener_daily_volume WHERE symbol='2330.TW'").first()).payload),old);
  } finally { db.close(); }
});

test('固定鏡像只能補缺，抓取時間較新也不得覆蓋既有官方 TDCC 列',async()=>{
  const db=setup();
  try {
    const official={date:'2026-08-28',bands:[],provenance:{source:'TDCC',sourceUrl:'https://openapi.tdcc.com.tw/v1/opendata/1-5',fetchedAt:'2026-08-29T01:00:00Z'}};
    const mirror={...official,provenance:{...official.provenance,sourceUrl:'https://raw.githubusercontent.com/pinned.csv',fetchedAt:'2026-09-01T01:00:00Z'}};
    await db.prepare(archiveHolderSql).bind('2330.TW','2026-08-28',JSON.stringify(official)).run();
    await db.prepare(archiveHolderSql).bind('2330.TW','2026-08-28',JSON.stringify(mirror)).run();
    assert.deepEqual(JSON.parse((await db.prepare("SELECT payload FROM screener_tdcc_weekly WHERE symbol='2330.TW'").first()).payload),official);
  } finally {db.close();}
});

test('選股排程預設停用、盤中不抓取，隔離於既有 broker 與長歷史工作', async t => {
  const db=setup(); let calls=0;
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-08-31T01:00:00Z')});
  const fetcher=async()=>{calls++;throw new Error('must_not_fetch');};
  try {
    assert.equal((await updateScreener(db,{scheduled:true,fetcher})).reason,'schedule_disabled');
    assert.equal((await updateScreener(db,{fetcher})).reason,'source_not_closed');
    assert.equal(calls,0);
    const source=await readFile(new URL('../../../scripts/realtimestock-runtime',import.meta.url),'utf8');
    assert.match(source,/--run-id="local-pe-[\s\S]*?service_multiview_screener_pipeline/);
    assert.match(source,/--checkpoint="\$\{checkpoint_dir\}\/continuous.json"[\s\S]*?service_multiview_screener_pipeline/);
    const handler=source.slice(source.indexOf('service_multiview_screener_pipeline()'),source.indexOf('service_multiview_tdcc_watcher()'));
    assert.match(handler,/--scheduled/); assert.doesNotMatch(handler,/--bootstrap-week/);
    assert.match(source,/tdcc-watcher-noop[^\n]*queue_empty[\s\S]*?service_multiview_screener_pipeline\s+return 0/);
  } finally {db.close();}
});
test('operator 共用 lease、Retry-After、每日三次上限與隔日恢復，禁止 busy-loop', async t => {
  const db=setup(); let calls=0,now=Date.parse('2026-08-31T10:00:00Z');
  t.mock.timers.enable({apis:['Date'],now});
  const fetcher=async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'7200'}});};
  try {
    for(let i=0;i<3;i++) {
      const result=await updateScreener(db,{fetcher});
      assert.equal(result.reason,'rate_limited');
      assert.equal(Date.parse(result.nextAttemptAt),now+7200000);
      assert.equal((await updateScreener(db,{fetcher})).reason,'backoff');
      now+=7200000;t.mock.timers.setTime(now);
    }
    assert.equal(calls,3);
    assert.equal((await db.prepare("SELECT status FROM screener_runs WHERE id='screener-operator-lease'").first()).status,'idle');
    t.mock.timers.setTime(Date.parse('2026-09-01T10:00:00Z'));
    assert.equal((await updateScreener(db,{fetcher})).reason,'rate_limited');
    assert.equal(calls,4);
  } finally {db.close();}
});
test('operator 遇人機驗證持續封鎖，不自動重試或另找入口', async t => {
  const db=setup(); let calls=0;
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-08-31T10:00:00Z')});
  try {
    const fetcher=async()=>{calls++;return new Response('captcha',{status:403});};
    assert.equal((await updateScreener(db,{fetcher})).reason,'source_blocked');
    t.mock.timers.setTime(Date.parse('2026-09-01T10:00:00Z'));
    assert.equal((await updateScreener(db,{fetcher})).reason,'source_blocked');
    assert.equal(calls,1);
  } finally {db.close();}
});
test('HTTP body 也有硬 timeout；abort 不會留下永遠等候的工作',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let entered; const reading=new Promise(resolve=>{entered=resolve;});
  const result=boundedOfficialText('https://www.twse.com.tw/fixture',async()=>({text:()=>{entered();return new Promise(()=>{});}}));
  const rejected=assert.rejects(result,/source_timeout/);
  await reading;t.mock.timers.tick(30001);await rejected;
});
test('底稿保留必要六期與既有快照錨點，只清理選股自身資料',async()=>{
  const db=setup();
  try {
    for(const date of ['2026-08-20','2026-08-27','2026-08-28','2026-08-31']) await db.prepare("INSERT INTO screener_daily_volume(symbol,data_date,payload) VALUES('2330.TW',?,'{}')").bind(date).run();
    const weeks=['2026-07-10','2026-07-17','2026-07-24','2026-07-31','2026-08-07','2026-08-14','2026-08-21','2026-08-28'];
    for(const date of weeks) await db.prepare("INSERT INTO screener_tdcc_weekly(symbol,data_date,payload,validation) VALUES('2330.TW',?,'{}','full-17')").bind(date).run();
    await db.prepare("INSERT INTO screener_snapshots(id,created_at,status,metadata) VALUES('old','2026-08-28','published',?)").bind(JSON.stringify({universeRevision:'old',anchors:{daily:{current:'2026-08-28',previous:'2026-08-27'},weekly:{current:'2026-07-24',previous:'2026-07-17'},weeklyPeriods:['2026-07-17','2026-07-24']}})).run();
    await pruneScreenerInputs(db,{through:'2026-08-31',sessions:['2026-08-28','2026-08-31'],weeks},'current');
    assert.deepEqual((await db.prepare('SELECT data_date FROM screener_daily_volume ORDER BY data_date').all()).results.map(x=>x.data_date),['2026-08-27','2026-08-28','2026-08-31']);
    assert.deepEqual((await db.prepare('SELECT data_date FROM screener_tdcc_weekly ORDER BY data_date').all()).results.map(x=>x.data_date),weeks.slice(1));
    assert.equal((await db.prepare('PRAGMA integrity_check').first()).integrity_check,'ok');
  }finally{db.close();}
});
