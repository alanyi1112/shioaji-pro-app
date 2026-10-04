import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackFixture } from './helpers/bollinger-fallback.mjs';
import { calibrateScreenerSource, settleCalibrationMeasurements, compareCalibrationProjection } from '../../../scripts/stock-screener-source-calibration.mjs';
import { BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY } from '../../../src/lib/stock-screener-source-comparison.ts';
async function setup() {
    const f = await fallbackFixture(); let calls = 0, reads = 0;
    const opts = { db:f.db, dates:f.sessions.slice(-2), universe:f.options.universe, calendar:f.options.calendar, now:f.now,
        budget: { quoteReserveBytes:1000,otherConsumerReserveBytes:2000,maxChargePerRequestBytes:10000 },
        observeUsage:async()=> { reads++; return {generation:'fixture',usedBytes:calls*100,remainingBytes:100000-calls*100,limitBytes:100000,observedAt:f.now().toISOString()}; },
        fetchReport:async date=> {calls++; return f.response(date);} };
    return {f,opts,calls:()=>calls,reads:()=>reads};
}
test('共享usage延後更新只追加非重疊上界，不覆寫原始delta或創造quota政策',async()=>{
    const t=await setup();try {
        await calibrateScreenerSource(t.opts);
        const original=(await t.f.db.prepare("SELECT id,checkpoint FROM screener_runs WHERE scope='bollinger-source-calibration-raw' ORDER BY id").all()).results;
        const r=await settleCalibrationMeasurements({db:t.f.db,now:t.f.now,observeUsage:async()=>({generation:'fixture',usedBytes:300,
            limitBytes:100000,remainingBytes:99700,observedAt:t.f.now().toISOString()})});
        assert.deepEqual(r.measurements.map(m=>m.usageAfter-m.usageBefore),[100,200]);
        assert.equal(r.quotaEpochVerified,false);assert.equal(r.policyInstalled,false);assert.equal(t.calls(),2);
        assert.deepEqual((await t.f.db.prepare("SELECT id,checkpoint FROM screener_runs WHERE scope='bollinger-source-calibration-raw' ORDER BY id").all()).results,original);
        assert.equal((await t.f.db.prepare('SELECT COUNT(*) n FROM broker_bandwidth_reservations').first()).n,0);
    }finally{t.f.db.close();}
});
test('延後counter零增量／換generation仍pending，觀察保留，不捏造實測',async()=>{
    for(const usedBytes of [100,0]) {
        const t=await setup();try{
            await calibrateScreenerSource(t.opts);
            await assert.rejects(settleCalibrationMeasurements({db:t.f.db,now:t.f.now,observeUsage:async()=>({generation:'changed',usedBytes,
                limitBytes:100000,remainingBytes:100000-usedBytes,observedAt:t.f.now().toISOString()})}),/measurements_pending/);
            assert.equal((await t.f.db.prepare("SELECT COUNT(*) n FROM screener_runs WHERE scope='bollinger-source-calibration-usage'").first()).n,1);
        }finally{t.f.db.close();}
    }
});
test('校準新政策一元通過，但日期／價格／unknown不能被容差解除',()=>{
    const date='2026-10-02',stocks=[{code:'2449',symbol:'2449.TW',market:'TWSE'}];
    const bar={sessionDate:date,open:'100',high:'102',low:'99',close:'101',volumeShares:'1000',turnoverNtd:'101000'};
    const point={code:'2449',readiness:'ready',bar,sourceValues:bar};
    const b={sessionDate:date,payloadHash:'a'.repeat(64),points:[point]};
    const o={market:'TWSE',sessionDate:date,payloadHash:'b'.repeat(64),points:[{...point,bar:{...bar,turnoverNtd:'101001'}}]};
    assert.equal(compareCalibrationProjection(b,o,stocks).counts.conflict,1);
    assert.equal(compareCalibrationProjection(b,o,stocks,BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY).counts.within_source_tolerance,1);
    for(const patch of [r=>{r.sessionDate='2026-10-01';},r=>{r.points[0].bar.close='102';},r=>{r.points[0].bar.turnoverNtd='101002';}]) {
        const changed=structuredClone(o);patch(changed);
        assert.equal(compareCalibrationProjection(b,changed,stocks,BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY).counts.conflict,1);
    }
    const missing=structuredClone(o);missing.points[0].readiness='missing_ohlcv';missing.points[0].bar=null;
    assert.equal(compareCalibrationProjection(b,missing,stocks,BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY).counts.unknown,1);
});
test('兩日期分開觀察共享usage；原始檔及hash留下但不形成正式cache/head',async()=>{
    const t=await setup();try {
        const r=await calibrateScreenerSource(t.opts);assert.equal(r.state,'complete');assert.equal(t.calls(),2);
        assert.deepEqual(r.receipts.map(e=>[e.usageBefore,e.usageAfter,e.sharedUsageDelta]),[[0,100,100],[100,200,100]]);
        for(const e of r.receipts) { assert.equal(e.markets.TWSE.total,1);assert.equal(e.markets.TPEx.readiness.ready,1);
            assert.equal((await t.f.db.prepare('SELECT status FROM screener_runs WHERE id=?').bind(e.rawId).first()).status,'observed'); }
        assert.equal((await t.f.db.prepare('SELECT COUNT(*) n FROM screener_daily_quotes_cache').first()).n,0);
        assert.equal((await t.f.db.prepare('SELECT COUNT(*) n FROM screener_bollinger_head').first()).n,0);
        await assert.rejects(calibrateScreenerSource(t.opts),/already_recorded/);assert.equal(t.calls(),2);
    }finally{t.f.db.close();}
});
test('未知或非法設定／日曆未成立：零HTTP、零claim',async()=>{
    for(const patch of [{budget:null},{budget:{quoteReserveBytes:1,otherConsumerReserveBytes:0,maxChargePerRequestBytes:100}},
        {calendar:{status:'pending'}},{dates:['2026-01-01','2026-01-01']}]) {
        const t=await setup();try {await assert.rejects(calibrateScreenerSource({...t.opts,...patch}),/pending/);
            assert.equal(t.calls(),0);assert.equal(t.reads(),0);
        }finally{t.f.db.close();}
    }
});
test('保留額度不足拒絕，不侵占其他用途，失敗claim不容再試',async()=>{
    const t=await setup();try {const r=await calibrateScreenerSource({...t.opts,budget:{quoteReserveBytes:90000,otherConsumerReserveBytes:9000,maxChargePerRequestBytes:10000}});
        assert.equal(r.reason,'broker_calibration_budget_denied');assert.equal(t.calls(),0);
        await assert.rejects(calibrateScreenerSource(t.opts),/already_recorded/);
    }finally{t.f.db.close();}
});
test('schema錯誤仍保留原始回應、used數值及partial；不補第二請求',async()=>{
    const t=await setup();try {const r=await calibrateScreenerSource({...t.opts,fetchReport:async d=>({...t.f.response(d),text:'<html>error</html>'})});
        assert.equal(r.reason,'invalid_report_schema');assert.equal(r.requested,1);
        assert.equal((await t.f.db.prepare("SELECT COUNT(*) n FROM screener_runs WHERE scope='bollinger-source-calibration-raw'").first()).n,1);
    }finally{t.f.db.close();}
});
test('generation／額度倒退不認成reset，原始觀察保留',async()=>{
    const t=await setup();let n=0;try {const r=await calibrateScreenerSource({...t.opts,observeUsage:async()=>({generation:++n===1?'old':'new',usedBytes:100,remainingBytes:99900,limitBytes:100000,observedAt:t.f.now().toISOString()})});
        assert.equal(r.reason,'broker_calibration_identity_changed');assert.equal(t.calls(),1);
    }finally{t.f.db.close();}
});
test('實際共享增量超出校準上限立即停止，不把HTTP bytes當精確broker消耗',async()=>{
    const t=await setup();let n=0;try {const r=await calibrateScreenerSource({...t.opts,observeUsage:async()=>({generation:'fixture',usedBytes:++n===1?0:20000,remainingBytes:n===1?100000:80000,limitBytes:100000,observedAt:t.f.now().toISOString()})});
        assert.equal(r.reason,'broker_calibration_charge_exceeded');assert.equal(t.calls(),1);assert.equal(r.receipts.length,1);
        assert.equal(r.receipts[0].measurementScope,'shared-counter-upper-bound-not-exclusive-attribution');
    }finally{t.f.db.close();}
});
test('並行校準僅一個claim成功，總來源request仍為二',async()=>{
    const t=await setup();try {const r=await Promise.allSettled([calibrateScreenerSource(t.opts),calibrateScreenerSource(t.opts)]);
        assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(t.calls(),2);
    }finally{t.f.db.close();}
});
test('來源修正後只續未送日期，重用原始response；原partial不改寫、總計仍二次',async()=>{
    const t=await setup();try {
        const r=await calibrateScreenerSource({...t.opts,fetchReport:async d=>({...t.f.response(d),text:'<html>error</html>'})});
        const before=await t.f.db.prepare('SELECT checkpoint FROM screener_runs WHERE id=?').bind(r.runId).first();
        // 無法修正的舊raw不能用新fetch覆蓋；即使允許continuation仍無額外request。
        const c=await calibrateScreenerSource({...t.opts,continuation:true});
        assert.equal(c.reason,'invalid_report_schema');assert.equal(c.requested,0);assert.equal(c.totalRequested,1);
        assert.equal((await t.f.db.prepare('SELECT checkpoint FROM screener_runs WHERE id=?').bind(r.runId).first()).checkpoint,before.checkpoint);
    }finally{t.f.db.close();}
});
test('usage讀取失敗仍保留已收到的來源response、不造usage after',async()=>{
    const t=await setup();let n=0;try {
        const observe=t.opts.observeUsage;const r=await calibrateScreenerSource({...t.opts,observeUsage:async()=>{if(++n===2)throw Error('broker_generation_changed');return observe();}});
        assert.equal(r.reason,'broker_generation_changed');assert.equal(r.requested,1);
        const row=await t.f.db.prepare("SELECT checkpoint FROM screener_runs WHERE scope='bollinger-source-calibration-response'").first();
        assert.equal(JSON.parse(row.checkpoint).response.status,200);assert.equal(Object.hasOwn(JSON.parse(row.checkpoint),'after'),false);
    }finally{t.f.db.close();}
});
