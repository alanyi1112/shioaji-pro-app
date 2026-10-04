import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,chmod,rm,symlink,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteD1,applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { readFile } from 'node:fs/promises';
import { createScreenerBrokerPorts } from '../../../scripts/stock-screener-broker-ports.mjs';
import { createHash } from 'node:crypto';
import { initializeLocalConservativeIdentity } from '../../../scripts/broker-local-conservative-ledger.mjs';
import { saveScreenerBrokerCommitment } from '../../../scripts/stock-screener-broker-commitments.mjs';
const migration=await readFile(new URL('../drizzle/0039_broker_bandwidth_reservations.sql',import.meta.url),'utf8');
function policyRecord(stamp) {
    return {version:1,scope:'a'.repeat(64),quotaEpoch:'fixture-epoch',quotaEpochVerified:true,quotaEpochEvidenceHash:'b'.repeat(64),
        validThrough:'2026-10-04T07:00:00Z',budgetPolicy:{version:1,status:'verified',evidenceHash:'c'.repeat(64),commitmentsObservedAt:stamp,
            validThrough:'2026-10-04T07:00:00Z',quoteReserveBytes:5000,otherJobCommitments:[{jobKey:'fixture-monitor',bytes:1000}],
            estimateMultiplier:2,maxEstimatedBytes:3000,maxRequestsPerWindow:3,rateWindowMs:60000,
            measurements:[1,2].map(i=>({evidenceHash:String(i).repeat(64),usageBefore:100,usageAfter:1100,responseBytes:300,observedAt:stamp,provider:'shioaji-daily-quotes'}))}};
}
async function savePolicy(f, policy) {
    await f.db.prepare('INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET checkpoint=excluded.checkpoint')
        .bind('screener-bollinger-broker-budget-policy','fixture','verified',JSON.stringify(policy),f.now().toISOString()).run();
}
async function fixture(){
    const root=await realpath(await mkdtemp(path.join(tmpdir(),'screener-broker-port-')));await chmod(root,0o700);
    await writeFile(path.join(root,'runtime-mode'),'simulation',{mode:0o600});
    await writeFile(path.join(root,'runtime-api-generation'),'simulation:fixture-generation',{mode:0o600});
    const db=new SqliteD1();db.exec('CREATE TABLE screener_runs(id TEXT PRIMARY KEY,scope TEXT,status TEXT,checkpoint TEXT,updated_at TEXT)');applyDrizzleSql(db,migration);
    const now=()=>new Date('2026-10-03T07:00:00Z'),calls=[];
    const options={db,root,now,fetchImpl:async(url,init)=>{calls.push({url,init});const endpoint=url.split('/api/v1/')[1];
        return Response.json(endpoint==='info'?{simulation:true}:endpoint==='health'?{status:'healthy'}:endpoint==='data/snapshots'?[{code:'2330',close:100}]
            :{bytes:100,limit_bytes:10000,remaining_bytes:9900});}};
    const close=async()=>{db.close();await rm(root,{recursive:true,force:true});};
    return {root,db,now,calls,options,close};
}
test('唯讀simulation/businesssession Gate只GET info/health及2330Snapshot；無login/subscription/order',async()=>{
    const f=await fixture();try{
        const state=await createScreenerBrokerPorts(f.options).safety();assert.equal(state.businessSessionEstablished,true);assert.equal(state.generation,'simulation:fixture-generation');
        assert.deepEqual(f.calls.map(c=>c.url.split('/api/v1/')[1]),['info','health','data/snapshots']);
        assert.deepEqual(JSON.parse(f.calls.at(-1).init.body).contracts.map(c=>c.code),['2330']);
    }finally{await f.close();}
});
test('production、privatepath權限不足與symlink不讀行情、不升級simulation',async()=>{
    for(const mode of ['production','permissions','symlink']){
        const f=await fixture();try{
            if(mode==='production')await writeFile(path.join(f.root,'runtime-mode'),'production');
            if(mode==='permissions')await chmod(path.join(f.root,'runtime-mode'),0o644);
            if(mode==='symlink'){await rm(path.join(f.root,'runtime-mode'));await symlink(path.join(f.root,'runtime-api-generation'),path.join(f.root,'runtime-mode'));}
            await assert.rejects(createScreenerBrokerPorts(f.options).safety(),/simulation_runtime_pending/);assert.equal(f.calls.length,0);
        }finally{await f.close();}
    }
});
test('HTTP200但非simulation／health異常／空或錯商品Snapshot不能當businesssession',async()=>{
    for(const body of [{simulation:false},{status:'unhealthy'},[],[{code:'2449',close:100}],[{code:'2330',close:0}]]){
        const f=await fixture();try{
            const endpoint='simulation'in body?'info':'status'in body?'health':'data/snapshots';const original=f.options.fetchImpl;
            const port=createScreenerBrokerPorts({...f.options,fetchImpl:async(url,init)=>url.endsWith(endpoint)?Response.json(body):original(url,init)});
            await assert.rejects(port.safety(),/simulation_session_pending/);
        }finally{await f.close();}
    }
});
test('generation中途換代拒絕、不把新API當舊session',async()=>{
    const f=await fixture();try{
        const original=f.options.fetchImpl;const port=createScreenerBrokerPorts({...f.options,fetchImpl:async(url,init)=>{
            const result=await original(url,init);if(url.endsWith('data/snapshots'))await writeFile(path.join(f.root,'runtime-api-generation'),'simulation:new-generation');return result;}});
        await assert.rejects(port.safety(),/simulation_session_pending/);
    }finally{await f.close();}
});
test('沒有正式quota epoch/預算政策，不讀usage、不下載、append denied',async()=>{
    const f=await fixture();try{
        const port=createScreenerBrokerPorts(f.options);const r=await port.admission.reserve({cacheKey:'fixture-job',generation:'simulation:fixture-generation'});
        assert.equal(r.allowed,false);assert.equal(f.calls.length,0);
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM broker_bandwidth_receipts').first()).n,1);
    }finally{await f.close();}
});
test('verified配置接上共用usage與集中ledger；reserve/dispatch/settle保存分離用量，不送daily quotes',async()=>{
    const f=await fixture();try{
        const stamp=f.now().toISOString();
        const policy=policyRecord(stamp);
        await f.db.prepare('INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,?,?,?,?)')
            .bind('screener-bollinger-broker-budget-policy','fixture','verified',JSON.stringify(policy),stamp).run();
        const port=createScreenerBrokerPorts(f.options);
        const r=await port.admission.reserve({cacheKey:'fixture-job',generation:'simulation:fixture-generation'});
        assert.equal(r.allowed,true);assert.equal(r.estimatedBytes,2000);
        await port.admission.start(r);await port.admission.settle({...r,requested:1,responseBytes:300});
        const saved=await f.db.prepare('SELECT status,response_bytes,usage_after FROM broker_bandwidth_reservations WHERE id=?').bind(r.reservationId).first();
        assert.equal(saved.status,'charged');assert.equal(saved.response_bytes,300);assert.equal(saved.usage_after,100);
        assert.equal(f.calls.filter(c=>c.url.endsWith('/auth/usage')).length,2);
        assert(f.calls.every(c=>/\/(info|health|data\/snapshots|auth\/usage)$/.test(c.url)));
    }finally{await f.close();}
});
test('v2 正式接線逐工作 producer，receipt 缺席時零usage；有效承諾才reserve/dispatch',async()=>{
    const f=await fixture();try{
        const record=policyRecord(f.now().toISOString());record.version=2;
        delete record.budgetPolicy.commitmentsObservedAt;delete record.budgetPolicy.otherJobCommitments;
        record.budgetPolicy.otherConsumerJobKeys=['fixture-monitor'];await savePolicy(f,record);
        const port=createScreenerBrokerPorts(f.options);
        assert.equal((await port.admission.reserve({cacheKey:'fixture-job',generation:'simulation:fixture-generation'})).allowed,false);
        assert.equal(f.calls.length,0);
        const proof={version:1,jobKey:'fixture-monitor',scope:record.scope,quotaEpoch:record.quotaEpoch,
            quotaEpochEvidenceHash:record.quotaEpochEvidenceHash,observedAt:f.now().toISOString(),remainingBytes:1000,
            state:'committed',sourceEvidenceHash:'d'.repeat(64)};
        const evidenceHash=createHash('sha256').update(JSON.stringify(proof)).digest('hex');
        await f.db.prepare('INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,?,?,?,?)')
            .bind('broker-consumer-commitment:fixture-monitor','fixture','verified',JSON.stringify({...proof,evidenceHash}),f.now().toISOString()).run();
        const r=await port.admission.reserve({cacheKey:'fixture-job',generation:'simulation:fixture-generation'});
        assert.equal(r.allowed,true);await port.admission.start(r);
        await port.admission.settle({...r,requested:1,responseBytes:300});
        assert.equal((await f.db.prepare('SELECT status FROM broker_bandwidth_reservations').first()).status,'charged');
        assert(f.calls.every(c=>/\/(info|health|data\/snapshots|auth\/usage)$/.test(c.url)));
    }finally{await f.close();}
});
test('同 budget條款但quota record在usage途中或dispatch前換版，實際port拒絕',async()=>{
    for(const phase of ['usage','dispatch']){
        const f=await fixture();try{
            const record=policyRecord(f.now().toISOString());await savePolicy(f,record);
            const original=f.options.fetchImpl;
            const port=createScreenerBrokerPorts({...f.options,fetchImpl:async(url,init)=>{
                const result=await original(url,init);
                if(phase==='usage'&&url.endsWith('auth/usage'))await savePolicy(f,{...record,quotaEpoch:'unexpected-epoch'});
                return result;
            }});
            const r=await port.admission.reserve({cacheKey:'fixture-job',generation:'simulation:fixture-generation'});
            if(phase==='usage'){
                assert.equal(r.allowed,false);assert.equal(r.reason,'broker_policy_changed');
                assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM broker_bandwidth_reservations').first()).n,0);
            }else{
                assert.equal(r.allowed,true);await savePolicy(f,{...record,quotaEpoch:'unexpected-epoch'});
                await assert.rejects(port.admission.start(r),/broker_policy_changed/);
                assert.equal((await f.db.prepare('SELECT status FROM broker_bandwidth_reservations').first()).status,'reserved');
            }
        }finally{await f.close();}
    }
});
test('有界HTTPJSON size/非200/redirect，不將任意body或error記到receipt',async()=>{
    for(const response of [()=>new Response('x'.repeat(65537)),()=>Response.json({fixture:'not_healthy'},{status:500})]){
        const f=await fixture();try{
            const port=createScreenerBrokerPorts({...f.options,fetchImpl:async()=>response()});await assert.rejects(port.safety(),/simulation_/);
        }finally{await f.close();}
    }
});

test('v3 真實usage不需要provider epoch；錨點及完整工作承諾成立才放行',async()=>{
    const f=await fixture();try{
        const identity=await initializeLocalConservativeIdentity(f.db,f.now());
        const record={...policyRecord(f.now().toISOString()),...identity,version:3,quotaEpochVerified:false};
        delete record.budgetPolicy.commitmentsObservedAt;delete record.budgetPolicy.otherJobCommitments;
        record.budgetPolicy.otherConsumerJobKeys=['fixture-monitor'];await savePolicy(f,record);
        const port=createScreenerBrokerPorts(f.options);
        assert.equal((await port.admission.reserve({cacheKey:'job',generation:'simulation:fixture-generation'})).allowed,false);
        assert.equal(f.calls.length,0);
        const proof={version:1,jobKey:'fixture-monitor',scope:identity.scope,quotaEpoch:identity.quotaEpoch,
            quotaEpochEvidenceHash:identity.quotaEpochEvidenceHash,observedAt:f.now().toISOString(),remainingBytes:1000,
            state:'committed',sourceEvidenceHash:'d'.repeat(64)};
        await saveScreenerBrokerCommitment(f.db,record,proof,f.now());
        const r=await port.admission.reserve({cacheKey:'job',generation:'simulation:fixture-generation'});
        assert.equal(r.allowed,true);await port.admission.start(r);
        await port.admission.settle({...r,requested:1,responseBytes:300});
        const observation=await f.db.prepare('SELECT * FROM broker_bandwidth_observations').first();
        assert.equal(observation.quota_epoch,identity.quotaEpoch);
        const receipt=await f.db.prepare("SELECT payload FROM broker_bandwidth_receipts WHERE status='local_usage_observed' LIMIT 1").first();
        assert.equal(JSON.parse(receipt.payload).providerQuotaEpochVerified,false);
        assert(f.calls.every(c=>/\/(info|health|data\/snapshots|auth\/usage)$/.test(c.url)));
    }finally{await f.close();}
});
