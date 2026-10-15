import test from 'node:test';
import assert from 'node:assert/strict';
import { createThresholdSwitchController } from './threshold-switch-controller.mjs';

const identity={sessionId:'fixture-session',ownerId:'fixture-owner',tradeDate:'2026-10-13',
    previousTradeDate:'2026-10-12',connectionGeneration:'simulation:fixture-generation-001'};
const authority={...identity,current:true,dataPlaneAuthority:true,notificationAuthority:true,phase:'running'};
function config(revision=1,threshold='1.5',overrides=[null,null]) {
    return {schemaVersion:'intraday-monitor-config/1',revision,globalThreshold:threshold,
        items:['2330','2408'].map((code,i)=>({contract:{security_type:'STK',region:'TW',
            exchange:'TSE',code,target_code:null},enabled:true,source:'manual',thresholdOverride:overrides[i]}))};
}
function watermark(symbol='2330.TW',minute='09:01',volume=25,baseline=10) {
    return {canonicalSymbol:symbol,minuteKey:minute,currentCumulativeVolume:volume,
        previousCumulativeVolume:baseline,receivedAt:`2026-10-13T${minute}:50+08:00`,sourceVersion:'fixture/1',
        continuityComplete:true,baselineComplete:true,sourceComplete:true};
}
const marks=(minute='09:01',volume=25,baseline=10)=>['2330.TW','2408.TW'].map(s=>watermark(s,minute,volume,baseline));
function input(minute='09:02',volume=25,baseline=10,symbol='2330.TW') {
    return {admitted:true,tradeDate:identity.tradeDate,baselineTradeDate:identity.previousTradeDate,
        canonicalSymbol:symbol,exchange:'TSE',minuteKey:minute,configRevision:1,threshold:'1.5',
        currentCumulativeVolume:volume,previousCumulativeVolume:baseline,todayCompleteness:'complete',
        baselineCompleteness:'complete',calendarCurrent:true,sessionCurrent:true,generationCurrent:true,
        continuityComplete:true,unit:'common_lot',sourceVersion:'fixture/1',observationMode:'live',
        revisionFirstComparable:false,createdAt:`2026-10-13T${minute}:50+08:00`};
}
function setup(options={}) {
    let at='2026-10-13T09:02:00+08:00';
    const receipts=[],failures=[];
    const core=createThresholdSwitchController({config:config(),...identity,
        activeSymbols:['2330.TW','2408.TW'],now:()=>at,
        persistTransition:receipt=>{receipts.push(receipt);return {persisted:true,transitionHash:receipt.transitionHash};},
        persistFailure:value=>{failures.push(value);return {persisted:true};},...options});
    return {core,receipts,failures,setTime:value=>{at=value;}};
}
const change=(core,candidate,expected=1,watermarks=marks(),auth=authority)=>
    core.apply({config:candidate,expectedComparisonRevision:expected,watermarks,authority:auth});

test('1.5→2→3→1.5即時切換，精確公式、生效收據與零追溯通知',()=>{
    const env=setup();
    for(const [revision,threshold,matched] of [[2,'2',true],[3,'3',false],[4,'1.5',true]]) {
        const result=change(env.core,config(revision,threshold),revision-1);
        assert.equal(result.applied,true);
        assert.equal(result.notificationEligible,false);
        assert.equal(result.receipt.reclassified[0].classification,matched?'matched':'not_matched');
        assert.equal(result.receipt.globalThreshold,threshold);
        assert.equal(result.receipt.effectiveAt,'2026-10-13T09:02:00+08:00');
        assert.equal(result.receipt.effectiveThresholds[0].effectiveMinute,'09:01');
        assert.equal(result.receipt.retroactiveNotificationCount,0);
        assert.equal(result.receipt.brokerWriteAuthority,false);
    }
    assert.equal(env.receipts.length,3);
    assert.equal(env.core.snapshot().activeComparisonRevision,4);
    assert.equal(env.core.snapshot().globalThreshold,'1.5');
});
test('新門檻起點未符合，切換後真實穿越只通知一次',()=>{
    const {core}=setup();
    assert.equal(change(core,config(2,'3')).applied,true);
    const hit=core.evaluate(input('09:02',31),authority);
    assert.equal(hit.triggerEvent.kind,'live');
    assert.equal(hit.triggerEvent.configRevision,2);
    assert.equal(hit.triggerEvent.threshold,'3');
    assert.equal(hit.notificationEligible,true);
    assert.equal(core.evaluate(input('09:03',35),authority).notificationEligible,false);
});
test('降門檻當下已符合，後續維持符合不補發live',()=>{
    const {core}=setup({config:config(1,'3')});
    assert.equal(change(core,config(2,'1.5')).receipt.reclassified[0].classification,'matched');
    const value=core.evaluate(input('09:02',26),authority);
    assert.equal(value.notificationEligible,false);
    assert.equal(value.newlyCreated,false);
    assert.equal(value.triggerEvent.kind,'historical');
});
test('同版本同內容重複要求不寫第二收據；不同內容拒絕',()=>{
    const {core,receipts}=setup();
    change(core,config(2,'2'));
    assert.equal(change(core,config(2,'2'),2).alreadyPresent,true);
    assert.equal(receipts.length,1);
    assert.equal(change(core,config(2,'3'),2).reason,'threshold_revision_conflict');
    assert.equal(core.snapshot().globalThreshold,'2');
});
test('兩分頁CAS競爭與亂序版本保留舊有效門檻',()=>{
    const {core,receipts}=setup();
    change(core,config(2,'2'));
    assert.equal(change(core,config(3,'3'),1).reason,'threshold_revision_conflict');
    assert.equal(change(core,config(1,'1.5'),2).reason,'threshold_revision_conflict');
    assert.equal(receipts.length,1);
    assert.equal(core.snapshot().activeComparisonRevision,2);
});
test('收據port拒絕／拋錯／wrong hash不切換，仍能以舊門檻判斷',()=>{
    for(const persistTransition of [()=>({persisted:false}),()=>{throw new Error('fixture_disk_full');},
        ()=>({persisted:true,transitionHash:'wrong'})]) {
        const {core,failures}=setup({persistTransition});
        assert.equal(change(core,config(2,'3')).applied,false);
        assert.equal(core.snapshot().globalThreshold,'1.5');
        assert.equal(core.snapshot().activeComparisonRevision,1);
        assert.equal(failures.length,1);
        core.evaluate(input('09:02',10),authority);
        assert.equal(core.evaluate(input('09:03',16),authority).notificationEligible,true);
    }
});
test('不受全域門檻影響的個別覆寫，維持原epoch不重複通知',()=>{
    const {core,setTime}=setup({config:config(1,'1.5',[null,'3'])});
    core.evaluate(input('09:01',10,10,'2408.TW'),authority);
    assert.equal(core.evaluate(input('09:02',31,10,'2408.TW'),authority).notificationEligible,true);
    setTime('2026-10-13T09:03:00+08:00');
    const result=change(core,config(2,'2',[null,'3']),1,marks('09:02',31));
    assert.deepEqual(result.receipt.changedSymbols,['2330.TW']);
    assert.equal(result.receipt.effectiveThresholds[1].epochRevision,1);
    assert.equal(core.evaluate(input('09:03',35,10,'2408.TW'),authority).notificationEligible,false);
});
test('個別覆寫切換可生效，其他商品不重置epoch',()=>{
    const {core}=setup();
    const result=change(core,config(2,'1.5',['3',null]));
    assert.deepEqual(result.receipt.changedSymbols,['2330.TW']);
    assert.equal(core.snapshot().thresholds[0].threshold,'3');
    assert.equal(core.snapshot().thresholds[1].epochRevision,1);
});
test('新增／停用／排序／來源變更不能取得門檻熱切換權限',()=>{
    for(const mutate of [c=>{c.items.pop();},c=>{c.items[0].enabled=false;},c=>{c.items.reverse();},
        c=>{c.items[0].source='watchlist';}]) {
        const {core,receipts}=setup();const candidate=config(2,'2');mutate(candidate);
        assert.equal(change(core,candidate).reason,'threshold_only_change_required');
        assert.equal(receipts.length,0);
    }
});
test('owner／generation／日期／current／data plane不符，拒絕切換與通知',()=>{
    for(const delta of [{ownerId:'other'},{connectionGeneration:'simulation:fixture-generation-002'},
        {tradeDate:'2026-10-14'},{sessionId:'other'},{current:false},{dataPlaneAuthority:false},{phase:'ended'}]) {
        const {core,receipts}=setup();const auth={...authority,...delta};
        assert.equal(change(core,config(2,'2'),1,marks(),auth).reason,'threshold_source_authority_invalid');
        assert.equal(core.evaluate(input(),auth).notificationEligible,false);
        assert.equal(receipts.length,0);
    }
});
test('無封閉分鐘／零分母／stale／連續性未知，切換不捏造可比較值',()=>{
    for(const rows of [marks().map(v=>({canonicalSymbol:v.canonicalSymbol,minuteKey:null})),
        marks('09:01',25,0),marks().map(v=>({...v,continuityComplete:false}))]) {
        const {core}=setup();assert.equal(change(core,config(2,'2'),1,rows).receipt.reclassified[0].classification,'unknown');
    }
    const {core,setTime}=setup();setTime('2026-10-13T09:05:00+08:00');
    assert.equal(change(core,config(2,'2')).receipt.reclassified[0].classification,'unknown');
});
test('未核實分鐘／未來來源時間／漏商品／倒退水位拒絕，不清空原epoch',()=>{
    for(const rows of [marks().slice(0,1),marks('09:00'),marks('09:03'),marks().map(v=>({...v,receivedAt:'2026-10-13T09:03:00+08:00'}))]) {
        const {core}=setup();assert.equal(change(core,config(2,'2'),1,rows).reason,'threshold_watermarks_invalid');
    }
    const {core}=setup();core.evaluate(input('09:02',25),authority);
    assert.equal(change(core,config(2,'2'),1,marks('09:01')).reason,'threshold_watermark_regression');
    assert.equal(core.evaluate(input('09:02',30),authority).reason,'threshold_observation_not_advancing');
});
test('closing仍可切門檻但不重開通知，收尾窗口不延長',()=>{
    const {core,setTime}=setup();setTime('2026-10-13T13:31:00+08:00');
    const auth={...authority,phase:'closing'};
    assert.equal(change(core,config(2,'3'),1,marks('13:29'),auth).applied,true);
    assert.equal(core.evaluate(input('13:30',31),auth).notificationEligible,false);
    setTime('2026-10-13T13:34:31+08:00');
    assert.equal(change(core,config(3,'2'),2,marks('13:30',31),auth).reason,'threshold_switch_window_invalid');
});
test('canonical門檻1.50／2.00／3.00與非法decimal，且caller不能改凍結receipt',()=>{
    const {core}=setup();const requested=config(2,'2.00');const rows=marks();
    const result=change(core,requested,1,rows);requested.globalThreshold='3';rows[0].currentCumulativeVolume=999;
    assert.equal(core.snapshot().globalThreshold,'2');
    assert.equal(result.receipt.watermarks[0].currentCumulativeVolume,25);
    assert.throws(()=>{result.receipt.watermarks[0].currentCumulativeVolume=777;});
    assert.equal(change(core,config(3,'0.5'),2).reason,'threshold_config_invalid');
});

test('160檔只保存有界封閉水位，持久化確認前不改任何active版本',()=>{
    const raw=config();raw.items=Array.from({length:160},(_,i)=>({ ...raw.items[0],
        contract:{...raw.items[0].contract,code:String(1000+i)} }));
    const symbols=raw.items.map(item=>`${item.contract.code}.TW`);
    let core;
    let calls=0;
    core=createThresholdSwitchController({config:raw,...identity,activeSymbols:symbols,
        now:()=> '2026-10-13T09:02:00+08:00',persistTransition:receipt=>{
            calls++;
            assert.equal(core.snapshot().activeComparisonRevision,1);
            assert.equal(core.snapshot().globalThreshold,'1.5');
            assert.equal(receipt.watermarks.length,160);
            assert.equal(receipt.changedSymbols.length,160);
            assert.equal(receipt.effectiveThresholds.length,160);
            return {persisted:true,transitionHash:receipt.transitionHash};
        }});
    const next=structuredClone(raw);next.revision=2;next.globalThreshold='3';
    const result=change(core,next,1,symbols.map(s=>watermark(s)));
    assert.equal(result.applied,true);
    assert.equal(core.snapshot().activeComparisonRevision,2);
    assert.equal(core.snapshot().thresholds.length,160);
    assert.equal(calls,1);
});
test('來源未知／通知關閉以及first new epoch unknown不會產生追溯通知',()=>{
    const {core}=setup();
    const rows=marks().map(v=>({...v,previousCumulativeVolume:null,baselineComplete:false}));
    assert.equal(change(core,config(2,'3'),1,rows).applied,true);
    const first=core.evaluate(input('09:02',35),authority);
    assert.equal(first.triggerEvent.kind,'historical');
    assert.equal(first.notificationEligible,false);
    const other=setup().core;
    other.evaluate(input('09:01',10),authority);
    assert.equal(other.evaluate(input('09:02',20),{...authority,notificationAuthority:false}).notificationEligible,false);
    assert.equal(other.evaluate({...input('09:03',25),generationCurrent:false},authority).classification,'unknown');
});
