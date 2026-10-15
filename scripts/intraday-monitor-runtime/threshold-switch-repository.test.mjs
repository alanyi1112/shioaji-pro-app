import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { IntradayMonitorConfigRepository } from './config-repository.mjs';
import { ThresholdSwitchRepository,THRESHOLD_RUNTIME_SESSION_SCHEMA } from './threshold-switch-repository.mjs';
import { createThresholdSwitchController,thresholdConfigForRequest } from './threshold-switch-controller.mjs';
const identity={sessionId:'fixture-session',ownerId:'fixture-owner',ownerPid:process.pid,
    tradeDate:'2026-10-13',previousTradeDate:'2026-10-12',connectionGeneration:'simulation:fixture-generation-001'};
const authority={...identity,current:true,dataPlaneAuthority:true,notificationAuthority:true,phase:'running'};
const raw={schemaVersion:'intraday-monitor-config/1',revision:0,globalThreshold:'1.5',items:[{
    contract:{security_type:'STK',region:'TW',exchange:'TSE',code:'2330',target_code:null},
    enabled:true,thresholdOverride:null,source:'manual'}]};
const watermark={canonicalSymbol:'2330.TW',minuteKey:'09:01',currentCumulativeVolume:25,
    previousCumulativeVolume:10,receivedAt:'2026-10-13T09:01:50+08:00',sourceVersion:'fixture/1',
    continuityComplete:true,baselineComplete:true,sourceComplete:true};
function setup(){
    const root=mkdtempSync(path.join(os.tmpdir(),'threshold-journal-'));
    const configPath=path.join(root,'config.sqlite3'),journalPath=path.join(root,'threshold.sqlite3');
    const config=new IntradayMonitorConfigRepository(configPath);
    config.replace(raw);
    const first=thresholdConfigForRequest(config.read());
    const journal=new ThresholdSwitchRepository(journalPath,{configDatabasePath:configPath});
    const initial={schemaVersion:THRESHOLD_RUNTIME_SESSION_SCHEMA,...identity,config:first,
        activeSymbols:['2330.TW'],createdAt:'2026-10-13T09:00:00+08:00'};
    journal.initialize(initial);
    const core=createThresholdSwitchController({...identity,config:first,activeSymbols:['2330.TW'],
        now:()=> '2026-10-13T09:02:00+08:00',persistTransition:r=>journal.append(r),persistFailure:r=>journal.appendFailure(r)});
    return {root,config,journal,initial,core,journalPath,cleanup(){journal.close();config.close();rmSync(root,{recursive:true,force:true});}};
}
function apply(env,threshold){
    const current=thresholdConfigForRequest(env.config.read());
    env.config.replace({...current,globalThreshold:threshold});
    return env.core.apply({config:thresholdConfigForRequest(env.config.read()),
        expectedComparisonRevision:env.core.snapshot().activeComparisonRevision,watermarks:[watermark],authority});
}
test('真實SQLite交易保存不可變receipt與head，同鍵重用不增加紀錄',()=>{
    const env=setup();try{
        const result=apply(env,'2');assert.equal(result.applied,true);
        assert.equal(env.journal.read(identity.sessionId).head.revision,2);
        assert.equal(env.journal.read(identity.sessionId).receipts.length,1);
        assert.equal(env.journal.append(result.receipt).alreadyPresent,true);
        assert.equal(env.journal.read(identity.sessionId).receipts.length,1);
        assert.throws(()=>env.journal.database.exec('DELETE FROM threshold_receipts'),/threshold_receipt_immutable/);
        assert.throws(()=>env.journal.database.exec('UPDATE threshold_sessions SET hash=\'bad\''),/threshold_session_immutable/);
    }finally{env.cleanup();}
});
test('重新開啟readOnly核完整chain，重建core不重新寫入或補發通知',()=>{
    const env=setup();try{
        apply(env,'2');apply(env,'3');
        const reader=new ThresholdSwitchRepository(env.journalPath,{readOnly:true});
        try{
            const saved=reader.read(identity.sessionId);let writes=0;
            const restored=createThresholdSwitchController({...identity,config:env.initial.config,
                activeSymbols:['2330.TW'],persistTransition:()=>{writes++;throw new Error('forbidden');},now:()=> '2026-10-13T09:02:00+08:00'});
            for(const receipt of saved.receipts)restored.restore(receipt);
            assert.equal(restored.snapshot().globalThreshold,'3');assert.equal(writes,0);
            assert.throws(()=>reader.append(saved.lastReceipt),/threshold_repository_readonly/);
        }finally{reader.close();}
    }finally{env.cleanup();}
});
test('saved config已被另一分頁取代，journal拒絕舊要求並保持原head',()=>{
    const env=setup();try{
        const current=thresholdConfigForRequest(env.config.read());env.config.replace({...current,globalThreshold:'2'});
        const stale=thresholdConfigForRequest(env.config.read());env.config.replace({...stale,globalThreshold:'3'});
        const result=env.core.apply({config:stale,expectedComparisonRevision:1,watermarks:[watermark],authority});
        assert.equal(result.applied,false);assert.equal(result.reason,'threshold_saved_config_changed');
        assert.equal(env.journal.read(identity.sessionId).head.revision,1);
        assert.equal(env.journal.read(identity.sessionId).receipts.length,0);
        assert.equal(env.journal.read(identity.sessionId).lastFailure.reason,'threshold_saved_config_changed');
    }finally{env.cleanup();}
});
test('head遭毀損不能宣稱applied；receipt遭改不能restore',()=>{
    const env=setup();try{
        const result=apply(env,'2');const bad=structuredClone(result.receipt);bad.globalThreshold='3';
        assert.throws(()=>env.core.restore(bad),/threshold_restore_receipt_invalid/);
        env.journal.database.prepare('UPDATE threshold_heads SET revision=? WHERE session_id=?').run(99,identity.sessionId);
        assert.throws(()=>env.journal.read(identity.sessionId),/threshold_head_invalid/);
    }finally{env.cleanup();}
});
test('不同owner不能接管相同session，來源config初始值不符也拒絕',()=>{
    const env=setup();try{
        assert.throws(()=>env.journal.initialize({...env.initial,ownerId:'other'}),/threshold_session_conflict/);
        const current=thresholdConfigForRequest(env.config.read());env.config.replace({...current,globalThreshold:'3'});
        assert.throws(()=>env.journal.initialize({...env.initial,sessionId:'other'}),/threshold_saved_config_changed/);
        assert.equal(env.journal.read('other'),null);
    }finally{env.cleanup();}
});
