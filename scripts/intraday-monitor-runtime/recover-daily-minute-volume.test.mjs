import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { recoverDailyMinuteVolumeAfterBudgetCorrection,
    recoverDailyMinuteVolumeAfterEarlyWake } from './recover-daily-minute-volume.mjs';

async function fixture() {
    const root=await realpath(await mkdtemp(path.join(tmpdir(),'daily-v2-recovery-')));
    const directory=path.join(root,'IntradayMonitor','daily-minute-volume-collection','2026-10-06');
    await mkdir(directory,{recursive:true});
    await writeFile(path.join(root,'runtime-mode'),'simulation');
    await writeFile(path.join(root,'runtime-api-generation'),'simulation:original');
    await writeFile(path.join(root,'IntradayMonitor','daily-runtime-mode.json'),JSON.stringify({
        schemaVersion:'intraday-minute-volume-runtime-mode/1',mode:'daily',
        screenerDatabasePath:'/local/test.sqlite3',limits:{ maxRequests:320,
            maxResponseBytes:2*1024*1024,requestTimeoutMs:20000,
            maxAttempts:3,cooldownMs:900000,deadlineTime:'18:30:00' } }),{mode:0o600});
    for (let attempt=1;attempt<=3;attempt+=1) {
        await writeFile(path.join(directory,`attempt-0${attempt}-receipt.json`),JSON.stringify({
            schemaVersion:'intraday-minute-volume-collection/2',sourceDate:'2026-10-06',
            targetDate:'2026-10-07',attempt,outcome:'partial',readyCount:117,waitingCount:43,
            conflictCount:0,stoppedReason:'broker_budget_or_rate_denied',
            completedAt:'2026-10-06T08:03:21Z',calendarVersion:'sha256:test',
            sourceVersion:'shioaji-http-1.7.1',connectionGeneration:'simulation:original',
            results:Array.from({length:160},(_,index)=>({symbol:String(index),
                state:index<117?'ready':'waiting'})) }));
    }
    const input={ root,sourceTradeDate:'2026-10-06',now:()=>new Date('2026-10-06T10:40:00Z'),
        resolveCalendar:async()=>({targetTradeDate:'2026-10-07',calendarSourceVersion:'sha256:test'}),
        databaseFactory:()=>({prepare:sql=>({first:async()=>sql.includes('broker_bandwidth_reservations')
            ? {n:0} : {checkpoint:JSON.stringify({version:4,
                consumerObservationMode:'daily-baseline-allocation-v1',
                budgetPolicy:{quoteReserveBytes:314572800}})}}),close:()=>{}}) };
    return {input,root,cleanup:()=>rm(root,{recursive:true,force:true})};
}
test('正式三次原收據保留，合法政策只增一張有界第 4 次補件',async()=>{
    const f=await fixture();try {
        let called=0;
        const result=await recoverDailyMinuteVolumeAfterBudgetCorrection({ ...f.input,
            run:async options=>{ called++;assert.equal(options.attempt,4);
                assert.equal(options.mode.limits.maxAttempts,4);
                assert.equal(options.mode.limits.maxRequests,120);
                assert.equal(options.mode.limits.deadlineTime,'20:00:00');
                return {outcome:'complete'}; } });
        assert.equal(result.outcome,'complete');assert.equal(called,1);
    }finally{await f.cleanup();}
});
test('舊政策或不同 generation 時不執行補件',async()=>{
    const f=await fixture();try{
        let called=0;
        await assert.rejects(recoverDailyMinuteVolumeAfterBudgetCorrection({ ...f.input,
            databaseFactory:()=>({prepare:()=>({first:async()=>({checkpoint:JSON.stringify({
                version:4,consumerObservationMode:'baseline-protected-allocation-v1',
                budgetPolicy:{quoteReserveBytes:314572800}})})}),close:()=>{}}),
            run:async()=>{called++;} }),/daily_collection_recovery_policy_invalid/);
        assert.equal(called,0);
    }finally{await f.cleanup();}
});
test('監控 owner 仍在時拒絕額外補件',async()=>{
    const f=await fixture();try{
        const registry=path.join(f.root,'direct-160-live','registry');
        await mkdir(registry,{recursive:true});
        await writeFile(path.join(registry,'active.lock'),'owned');
        let called=0;
        await assert.rejects(recoverDailyMinuteVolumeAfterBudgetCorrection({ ...f.input,
            run:async()=>{called++;} }),/daily_collection_recovery_active_owner/);
        assert.equal(called,0);
    }finally{await f.cleanup();}
});
test('第 4 次只剩 timer 提早喚醒時，冷卻後僅補三檔且保留原收據',async()=>{
    const f=await fixture();try{
        const directory=path.join(f.root,'IntradayMonitor','daily-minute-volume-collection','2026-10-06');
        await writeFile(path.join(directory,'attempt-04-receipt.json'),JSON.stringify({
            schemaVersion:'intraday-minute-volume-collection/2',sourceDate:'2026-10-06',
            targetDate:'2026-10-07',attempt:4,outcome:'partial',readyCount:157,waitingCount:3,
            conflictCount:0,stoppedReason:null,completedAt:'2026-10-06T11:17:02Z',
            calendarVersion:'sha256:test',sourceVersion:'shioaji-http-1.7.1',
            connectionGeneration:'simulation:original',results:Array.from({length:160},(_,index)=>({
                symbol:String(index),state:index<157?'ready':'waiting',
                ...(index<157?{}:{reason:'daily_collection_cooldown_clock_not_advanced'}) })) }));
        let called=0;
        const result=await recoverDailyMinuteVolumeAfterEarlyWake({ ...f.input,
            now:()=>new Date('2026-10-06T11:33:00Z'),run:async options=>{
                called++;assert.equal(options.attempt,5);
                assert.equal(options.mode.limits.maxAttempts,5);
                assert.equal(options.mode.limits.maxRequests,20);
                return {outcome:'complete'};
            } });
        assert.equal(result.outcome,'complete');assert.equal(called,1);
        await assert.rejects(recoverDailyMinuteVolumeAfterEarlyWake({ ...f.input,
            now:()=>new Date('2026-10-06T11:20:00Z'),run:async()=>{called++;} }),
        /daily_collection_recovery_receipt_invalid/);
        assert.equal(called,1);
        const receiptFile=path.join(directory,'attempt-04-receipt.json');
        const invalid=JSON.parse(await readFile(receiptFile,'utf8'));
        invalid.results[157].reason='baseline_provider_unavailable';
        await writeFile(receiptFile,JSON.stringify(invalid));
        await assert.rejects(recoverDailyMinuteVolumeAfterEarlyWake({ ...f.input,
            now:()=>new Date('2026-10-06T11:33:00Z'),run:async()=>{called++;} }),
        /daily_collection_recovery_receipt_invalid/);
        assert.equal(called,1);
    }finally{await f.cleanup();}
});
