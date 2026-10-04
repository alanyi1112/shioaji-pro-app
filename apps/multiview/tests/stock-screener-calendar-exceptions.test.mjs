import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { parseOfficialFullDayClosures, prepareBollingerCalendarExceptions, closureSourceUrl } from '../../../scripts/stock-screener-calendar-exceptions.ts';
import { prepareBollingerCalendar } from '../../../scripts/stock-screener-bollinger-calendar.ts';
import { planBollingerHistory } from '../../../src/lib/stock-screener-bollinger-history.ts';
import { DEFAULT_BOLLINGER_SQUEEZE } from '../../../src/lib/stock-screener-v8.ts';
import { createBollingerClosureFetcher } from '../../../scripts/stock-screener-bollinger-source-fetch.mjs';
import { EventEmitter } from 'node:events';

const at = new Date('2026-10-04T00:40:00Z');
const title = '臺灣證券交易所集中交易市場115年7月10日休市一天';
const row = (t = title, id = 'a'.repeat(32)) => [1,t,'115年07月09日',id,'b'.repeat(32)];
const body = (rows = [row()]) => ({stat:'ok', fields:['項次','標題','日期','zhId','enId'], totalCount:rows.length, data:rows});
const reply = async year => ({ status:200, sourceUrl:closureSourceUrl(year), text:JSON.stringify(body()) });
const sqls = await Promise.all(['0027_pale_randall_flagg.sql','0035_screener_bollinger_history.sql','0037_screener_daily_quotes_cache.sql']
    .map(f=>readFile(new URL(`../drizzle/${f}`,import.meta.url),'utf8')));
function fixture() {
    const db = new SqliteD1(); sqls.forEach(s=>applyDrizzleSql(db,s)); let ms = at.getTime(), requests = 0;
    const commonSessions = Array.from({length:250},(_,i)=>new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10))
        .filter(d=>![0,6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
    const base = { status:'verified', commonSessions:[...commonSessions,'2026-10-02','2026-10-05'], authorityHash:'c'.repeat(64),validThrough:'2026-11-01T00:00:00Z' };
    const now = ()=>new Date(ms);
    return {db,base,now,advance:d=>{ms+=d},options:{now,deadline:ms+900000,fetchNotices:async y=>{requests++;return reply(y)}},calls:()=>requests};
}
test('官方具名全日休市可解析民國／西元及跨月區間，不依颱風名稱寫死',()=>{
    assert.deepEqual(parseOfficialFullDayClosures(JSON.stringify(body()),2026,at)[0].dates,['2026-07-10']);
    assert.deepEqual(parseOfficialFullDayClosures(JSON.stringify(body([row('臺灣證券交易所集中交易市場2026年7月31日至8月2日全日休市3日')])),2026,at)[0].dates,
        ['2026-07-31','2026-08-01','2026-08-02']);
    assert.equal(parseOfficialFullDayClosures(JSON.stringify(body([row('因其他緊急因素，臺灣證券交易所集中交易市場115年7月10日全日休市')])),2026,at).length,1);
});
test('個股停牌／條件式說明／盤後及下午停止，不誤排除整個交易日',()=>{
    for(const t of ['個股因颱風停止交易','如遇颱風，集中交易市場115年7月10日休市一天',
        '集中交易市場115年7月10日下午休市','集中交易市場115年7月10日盤後停止交易','集中交易市場115年7月10日不休市'])
        assert.equal(parseOfficialFullDayClosures(JSON.stringify(body([row(t)])),2026,at).length,0);
    assert.equal(parseOfficialFullDayClosures(JSON.stringify(body([row('自115年6月18日起，中福國際股份有限公司（中福，公司代號：1435）上市有價證券恢復在集中交易市場買賣及恢復交易方法')])),2026,at).length,0);
    for(const t of ['集中交易市場明天休市','集中交易市場取消休市','取消集中交易市場115年7月10日休市一天','集中交易市場115年7月32日休市一天'])
        assert.throws(()=>parseOfficialFullDayClosures(JSON.stringify(body([row(t)])),2026,at),/closure/);
});
test('同一公告single-flight；失去租約的慢請求不得覆寫新來源head',async()=>{
    const f=fixture();let finish;
    try {
        const delayed=prepareBollingerCalendarExceptions(f.db,f.base,{...f.options,fetchNotices:()=>new Promise(r=>{finish=r})});
        while(!finish) await new Promise(r=>setImmediate(r));
        const competing=await prepareBollingerCalendarExceptions(f.db,f.base,f.options);
        assert.equal(competing.reason,'lease_busy');assert.equal(f.calls(),0);
        await f.db.prepare("UPDATE screener_runs SET checkpoint='new-owner' WHERE id='bollinger-calendar-closures-lease'").run();
        await f.db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES('bollinger-calendar-closures:2026','bollinger-calendar-closures','verified','new-head',?)").bind(at.toISOString()).run();
        finish(await reply(2026));assert.equal((await delayed).reason,'lease_lost');
        assert.equal((await f.db.prepare("SELECT checkpoint FROM screener_runs WHERE id='bollinger-calendar-closures:2026'").first()).checkpoint,'new-head');
    } finally {f.db.close()}
});
test('完整schema／總筆數／年份／公告身份／非法日期嚴格驗證，HTML及空行情不能成休市',()=>{
    for(const b of [body([row(),row()]),{...body(),totalCount:2},{...body(),fields:['日期','標題']},
        body([[1,title,'114年07月09日','a'.repeat(32),'']]),body([[1,title,'115年07月32日','a'.repeat(32),'']])])
        assert.throws(()=>parseOfficialFullDayClosures(JSON.stringify(b),2026,at),/closure/);
    for(const s of ['<html>error</html>','{"Date":[],"Code":[]}',JSON.stringify({...body(),stat:'error'})])
        assert.throws(()=>parseOfficialFullDayClosures(s,2026,at),/closure/);
});
test('7/10從共同交易日排除，160日窗口向前延伸，舊calendar與18次失敗原值不改',async()=>{
    const f=fixture();try{
        await f.db.prepare("INSERT INTO screener_daily_quotes_cache(cache_key,session_date,review_hash,status,attempts,reason,updated_at) VALUES('old','2026-07-10','old','pending',18,'source_not_published',?)").bind(at.toISOString()).run();
        const before=await f.db.prepare("SELECT * FROM screener_daily_quotes_cache WHERE cache_key='old'").first();
        const original=structuredClone(f.base);
        const old=planBollingerHistory(f.base,'2026-10-02',DEFAULT_BOLLINGER_SQUEEZE,'1',at);
        const r=await prepareBollingerCalendarExceptions(f.db,f.base,f.options);assert.equal(r.state,'ready');
        const p=planBollingerHistory(r.calendar,'2026-10-02',DEFAULT_BOLLINGER_SQUEEZE,'1',at);
        assert.equal(p.sessions.length,160);assert(!p.sessions.includes('2026-07-10'));assert(p.sessions[0]<old.sessions[0]);
        assert.deepEqual(f.base,original);assert.notEqual(r.calendar.authorityHash,f.base.authorityHash);
        assert.deepEqual(await f.db.prepare("SELECT * FROM screener_daily_quotes_cache WHERE cache_key='old'").first(),before);
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_bollinger_receipts WHERE status='calendar_replanned'").first()).n,1);
    }finally{f.db.close()}
});
test('同日公告快取重算no-op，下一台北日期自動刷新；新年度表不必每日重抓',async()=>{
    const f=fixture();try{
        const a=await prepareBollingerCalendarExceptions(f.db,f.base,f.options);
        const count=(await f.db.prepare('SELECT COUNT(*) n FROM screener_bollinger_receipts').first()).n;
        const changes=f.db.database.prepare('SELECT total_changes() n').get().n;
        const b=await prepareBollingerCalendarExceptions(f.db,f.base,f.options);assert.equal(f.calls(),1);assert.equal(a.calendar.authorityHash,b.calendar.authorityHash);
        assert.equal(f.db.database.prepare('SELECT total_changes() n').get().n,changes);
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_bollinger_receipts').first()).n,count);
        f.advance(86400000);const c=await prepareBollingerCalendarExceptions(f.db,f.base,{...f.options,deadline:f.now().getTime()+900000});
        assert.equal(c.state,'ready');assert.equal(f.calls(),2);
    }finally{f.db.close()}
});
test('傳輸錯誤／429／部分清單保留pending與冷卻，不能猜休市或送行情請求',async()=>{
    for(const bad of [{status:429,retryAfter:'7200'}, {text:'<html>failure</html>'},{text:JSON.stringify({...body(),totalCount:2})}]){
        const f=fixture();let calls=0;try{
            const opts={...f.options,fetchNotices:async y=>{calls++;return {...await reply(y),...bad}}};
            const a=await prepareBollingerCalendarExceptions(f.db,f.base,opts);assert.equal(a.state,'pending');assert(a.nextAttemptAt);
            const original=(await f.db.prepare("SELECT payload FROM screener_bollinger_receipts WHERE status='calendar_closure_failed'").first()).payload;
            assert.equal(JSON.parse(original).responseEvidence.text,bad.text ?? JSON.stringify(body()));
            assert.equal((await prepareBollingerCalendarExceptions(f.db,f.base,opts)).state,'pending');assert.equal(calls,1);
            assert.equal((await f.db.prepare("SELECT payload FROM screener_bollinger_receipts WHERE status='calendar_closure_failed'").first()).payload,original);
            assert(f.base.commonSessions.includes('2026-07-10'));
        }finally{f.db.close()}
    }
});
test('舊verified年度cache必須經新公告Gate，保留原annual checkpoint與失敗收據',async()=>{
    const f=fixture();try{
        const checkpoint=JSON.stringify({version:1,sessions:f.base.commonSessions,sourceHashes:['a'.repeat(64),'b'.repeat(64)],validThrough:f.base.validThrough});
        await f.db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES('screener-period-evidence','screener-calendar','verified',?,?)").bind(checkpoint,at.toISOString()).run();
        const r=await prepareBollingerCalendar(f.db,{...f.options,fetchCalendar:async()=>{throw Error('must reuse annual')}});
        assert.equal(r.state,'ready');assert(!r.calendar.commonSessions.includes('2026-07-10'));
        assert.equal((await f.db.prepare("SELECT checkpoint FROM screener_runs WHERE id='screener-period-evidence'").first()).checkpoint,checkpoint);
    }finally{f.db.close()}
});
test('公告端點固定年度參數，30秒／2MiB／不重試／不跟轉址',async()=>{
    let calls=0;
    const fetcher=createBollingerClosureFetcher((url,opts,callback)=>{
        calls++;assert.equal(url,closureSourceUrl(2026));assert.equal(opts.timeout,30000);
        const req=new EventEmitter();req.end=()=>{const res=new EventEmitter();res.statusCode=302;res.headers={location:'https://evil.test/'};
            callback(res);res.emit('end');};return req;
    });
    assert.equal((await fetcher(2026,new AbortController().signal)).status,302);assert.equal(calls,1);
    await assert.rejects(fetcher(0),/invalid_closure_target/);assert.equal(calls,1);
});
