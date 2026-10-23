import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import { readSpecialMarketClosures as read, saveSpecialMarketClosure as save,
    specialMarketClosureDecision as decision } from './special-market-closures.mjs';
import { runPremarketStep } from './premarket-orchestrator.mjs';
import { runPostcloseDailyBaseline } from './postclose-daily-baseline.mjs';
import { auditIntradayMonitorFailures } from './audit-monitor-failures.mjs';
import { resolveIntradayMonitorPremarketTradingDay } from './trading-calendar-authority.mjs';
import {selectSharedMonitorTradingDay} from './trading-calendar-authority.mjs';

test('歷史單市場補登、局部撤銷與舊 v1 唯讀遷移鏈',()=>{
    const r=root(),d=path.join(r,'IntradayMonitor/special-market-closures');fs.mkdirSync(d,{recursive:true,mode:0o700});
    const body={schemaVersion:'manual-special-market-closures/1',revision:1,parentHash:null,action:'close',date:'2026-10-23',reason:'舊設定',source:'local_user',recordedAt:now.toISOString()};
    const bytes=JSON.stringify({...body,hash:createHash('sha256').update(JSON.stringify(body)).digest('hex')});
    const f=path.join(d,'000001.json');fs.writeFileSync(f,bytes,{mode:0o600});
    assert.equal(read(r,{now}).revision,1);
    put(r,{date:'2026-10-22',markets:['OTC'],expectedRevision:1});
    assert.equal(decision({root:r,dates:['2026-10-22'],markets:['TSE'],now}).allowed,true);
    assert.equal(decision({root:r,dates:['2026-10-22'],markets:['OTC'],now}).allowed,false);
    put(r,{date:'2026-10-23',action:'revoke',markets:['TSE'],expectedRevision:2});
    assert.deepEqual(read(r,{now}).entries.find(e=>e.date==='2026-10-23').markets,['OTC']);
    assert.equal(fs.readFileSync(f,'utf8'),bytes);
    assert.ok(fs.existsSync(path.join(r,'MarketCalendar/special-closures/000002.json')));
});
test('量比／名單日曆同一核心跳過人工休市，版本修訂使舊來源鏈失效',()=>{
    const r=root(),snapshots=[{calendarVersion:'fixture',fetchedAtEpochMs:+now-1,validUntilEpochMs:+now+10000,
        days:['2026-10-20','2026-10-21','2026-10-22','2026-10-23'].map(tradeDate=>({tradeDate,TSE:'scheduled_trading',OTC:'scheduled_trading'}))}];
    const get=()=>selectSharedMonitorTradingDay({tradeDate:'2026-10-23',snapshots,observedAt:now.toISOString(),root:r});
    const before=get();assert.equal(before.previousTradeDate,'2026-10-22');
    put(r,{date:'2026-10-22'});
    const after=get();assert.equal(after.previousTradeDate,'2026-10-21');assert.notDeepEqual(after.sourceVersions,before.sourceVersions);
    assert.match(after.calendarVersion,/manual:1:/);
    assert.throws(()=>selectSharedMonitorTradingDay({tradeDate:'2026-10-23',snapshots,observedAt:new Date(+now+10001).toISOString(),root:r}),/shared_calendar_unconfirmed/);
});
import { createIntradayMonitorLocalApiService } from './local-api-service.mjs';
import { authorizeIntradayMonitorGatewayRequest } from './vite-local-api-gateway.mjs';

const roots = [];
const root = () => { const p = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rts-special-closure-'))); roots.push(p); return p; };
const now = new Date('2026-10-23T01:00:00+08:00');
const request = (extras = {}) => ({action:'close',date:'2026-10-23',reason:'颱風臨時休市',expectedRevision:0,confirmed:true,...extras});
const put = (r, extras = {}) => save(r, request(extras), {now});
afterEach(() => { for (const p of roots.splice(0)) fs.rmSync(p, {recursive:true,force:true}); });

test('未設定的唯讀不建立目錄，不提供官方／強制開市權威', () => {
    const r=root(); assert.equal(read(r,{now}).revision,0);
    assert.equal(fs.existsSync(path.join(r,'IntradayMonitor')),false);
    assert.equal(decision({root:r,dates:['2026-10-23'],now}).allowed,true);
});
test('保存真正日期／全日雙市場、私密權限、完整 hash 與跨程序讀回', () => {
    const r=root(), state=put(r);
    assert.equal(state.revision,1); assert.match(state.hash,/^[a-f0-9]{64}$/);
    assert.deepEqual(state.entries[0].markets,['TSE','OTC']);
    assert.equal(state.entries[0].scope,'full_day'); assert.equal(state.source,'local_user');
    assert.equal(fs.statSync(path.join(r,'MarketCalendar/special-closures/000001.json')).mode&0o777,0o600);
    assert.deepEqual(read(r,{now}),state);
    assert.equal(decision({root:r,dates:['2026-10-22','2026-10-23'],now}).reason,'special_market_closure');
});
for (const [name, patch] of [
    ['不存在日期',{date:'2026-02-30'}],['歷史過界',{date:'1999-10-22'}],
    ['超過一年',{date:'2028-10-23'}],['格式錯誤',{date:'2026-1-1'}],
    ['空理由',{reason:''}],['超長理由',{reason:'a'.repeat(201)}],
    ['控制字元',{reason:'a\nb'}],['未確認',{confirmed:false}],
    ['強制開市',{action:'open'}],['單市場',{market:'TSE'}],
    ['負 revision',{expectedRevision:-1}],['假確認字串',{confirmed:'true'}],
]) test(`拒絕${name}且不半寫`,()=>{const r=root();assert.throws(()=>put(r,patch));assert.equal(read(r,{now}).revision,0);});
test('版本 CAS、重複日期及今日更正不自動重新開市',()=>{
    const r=root(); put(r);
    assert.throws(()=>put(r),/revision_conflict/);
    assert.throws(()=>put(r,{expectedRevision:1}),/already_exists/);
    put(r,{action:'revoke',expectedRevision:1});
    assert.equal(read(r,{now}).revision,2);
    assert.equal(decision({root:r,dates:['2026-10-23'],now}).reason,'special_closure_reopen_requires_review');
    assert.equal(decision({root:r,dates:['2026-10-23'],now,purpose:'data'}).allowed,true);
});
test('未來撤銷與重建保留原文歷程，不刪原檔',()=>{
    const r=root(); put(r,{date:'2026-10-27'});
    put(r,{action:'revoke',date:'2026-10-27',reason:'公告更正',expectedRevision:1});
    assert.equal(read(r,{now}).entries.length,0);
    const s=put(r,{date:'2026-10-27',expectedRevision:2});
    assert.equal(s.history.length,3);assert.equal(s.history[0].reason,'颱風臨時休市');
});
test('損毀／部分寫入不當空設定，blocked 且不可覆寫',()=>{
    const r=root(); put(r); const f=path.join(r,'MarketCalendar/special-closures/000001.json');
    fs.writeFileSync(f,'{');
    assert.equal(decision({root:r,dates:['2026-10-27'],now}).reason,'special_closure_settings_unavailable');
    assert.throws(()=>put(r,{expectedRevision:1,date:'2026-10-27'}));
    assert.equal(fs.readFileSync(f,'utf8'),'{');
});
test('缺版／多餘檔／寬鬆權限／symlink 都阻擋',()=>{
    for(const kind of ['gap','extra','mode','link']){
        const r=root();put(r);const d=path.join(r,'MarketCalendar/special-closures'),f=path.join(d,'000001.json');
        if(kind==='gap')fs.renameSync(f,path.join(d,'000002.json'));
        if(kind==='extra')fs.writeFileSync(path.join(d,'other'),'x',{mode:0o600});
        if(kind==='mode')fs.chmodSync(f,0o644);
        if(kind==='link'){fs.renameSync(f,path.join(r,'original'));fs.symlinkSync(path.join(r,'original'),f);}
        assert.equal(decision({root:r,dates:['2026-10-23'],now}).allowed,false);
    }
});
test('時鐘倒退不將未來版本當有效',()=>{
    const r=root();put(r);
    assert.equal(decision({root:r,dates:['2026-10-23'],now:new Date(+now-1)}).allowed,false);
});
test('四個真正獨立程序使用相同 revision，僅一筆成功',async()=>{
    const r=root(),run=promisify(execFile);
    const code=`import{saveSpecialMarketClosure as save}from ${JSON.stringify(new URL('./special-market-closures.mjs',import.meta.url).href)};
        try{save(${JSON.stringify(r)},${JSON.stringify(request())},{now:new Date(${JSON.stringify(now.toISOString())})});process.stdout.write('ok');}
        catch(e){process.stdout.write(e.code??'blocked');process.exitCode=2;}`;
    const results=await Promise.allSettled(Array.from({length:4},()=>run(process.execPath,['--input-type=module','-e',code])));
    assert.equal(results.filter(v=>v.status==='fulfilled').length,1);
    assert.equal(read(r,{now}).revision,1);
});
const forbidden=()=>{throw Error('unexpected_external_or_repository_work');};
test('盤前閉市在 config、官方查詢、暖機之前 no-op',async()=>{
    const r=root();put(r);
    const result=await runPremarketStep({root:r,now,step:'08:20',dryRun:true,resolveTradingDay:forbidden,warmup:forbidden});
    assert.equal(result.reason,'special_market_closure'); assert.equal(result.requests,0);
});
test('盤後及重試閉市在 mode、日曆、採集之前 no-op',async()=>{
    const r=root();put(r);
    for(const trigger of ['scheduled','retry']){
        const result=await runPostcloseDailyBaseline({root:r,now:new Date('2026-10-23T13:35:00+08:00'),trigger,
            fetchImpl:forbidden,execute:forbidden,dailyModeReader:forbidden,calendarResolver:forbidden});
        assert.equal(result.reason,'special_market_closure');assert.equal(result.requests,0);
    }
});
test('失敗稽核不誤報閉市缺工作，不發通知',async()=>{
    const r=root();put(r);
    const result=await auditIntradayMonitorFailures({root:r,now,resolveTradingDay:forbidden,notify:forbidden});
    assert.equal(result.checked,false);assert.equal(result.requests,0);
});
test('盤前日曆可無 annual cache 表達人工休市，不冒稱官方',async()=>{
    const r=root();put(r);const result=await resolveIntradayMonitorPremarketTradingDay({root:r,now});
    assert.equal(result.isTradingDate,false);assert.equal(result.source,'local_user');
});
test('local API 保存獨立於名單窗口，錯版／缺確認不改寫',()=>{
    const r=root(); const service=createIntradayMonitorLocalApiService({generation:'generation_test_1234567890',
        configRepository:{read:forbidden,replace:forbidden},leaseCoordinator:{acquire:forbidden,renew:forbidden,release:forbidden,status:forbidden},
        evidenceRepository:{currentRevision:forbidden,listTriggers:forbidden},
        specialClosures:{read:()=>read(r,{now}),save:i=>save(r,i,{now})}});
    assert.equal(service.readSpecialClosures().status,200);
    assert.equal(service.saveSpecialClosure(request()).status,200);
    assert.equal(service.saveSpecialClosure(request()).status,409);
    assert.equal(service.saveSpecialClosure(request({confirmed:false})).status,422);
    assert.equal(read(r,{now}).revision,1);service.close();
});
test('新路由沿用 loopback／same-origin／JSON 邊界',()=>{
    const req=(method,origin)=>({method,url:'/api/intraday-monitor/v1/special-closures',
        socket:{remoteAddress:'127.0.0.1',localAddress:'127.0.0.1'},rawHeaders:['Host','127.0.0.1:5173',...(origin?['Origin',origin]:[]),'Content-Type','application/json']});
    assert.equal(authorizeIntradayMonitorGatewayRequest(req('GET')).route,'special_closures');
    assert.equal(authorizeIntradayMonitorGatewayRequest(req('POST')).route,'special_closure_save');
    assert.equal(authorizeIntradayMonitorGatewayRequest(req('POST','https://evil.invalid')).allowed,false);
});
