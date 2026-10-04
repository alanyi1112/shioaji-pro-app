import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteD1 } from './helpers/sqlite-d1.mjs';
import { initializeLocalConservativeIdentity } from '../../../scripts/broker-local-conservative-ledger.mjs';
import { observeRuntimeBudgetAllocations } from '../../../scripts/stock-screener-runtime-budget-producer.mjs';
import { readScreenerBrokerCommitments } from '../../../scripts/stock-screener-broker-commitments.mjs';
import { createBaselineBandwidthBudget } from '../../../scripts/intraday-monitor-runtime/baseline-bandwidth-budget.mjs';

async function fixture() {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'screener-budget-observer-')));
    const directory = path.join(root,'IntradayMonitor/postclose-baseline/budgets'); await mkdir(directory,{recursive:true,mode:0o700});
    const db = new SqliteD1(); db.exec('CREATE TABLE screener_runs(id TEXT PRIMARY KEY,scope TEXT,status TEXT,checkpoint TEXT,updated_at TEXT)');
    const now = new Date(), tradeDate = now.toISOString().slice(0,10), manifestHash = 'a'.repeat(64);
    const samples = [1,2].map(days => ({tradeDate:new Date(now.getTime()-days*86400000).toISOString().slice(0,10),
        consumedBytes:20_000_000,providerLimitBytes:500_000_000,manifestHash,
        sourceSha256:'b'.repeat(64),usageStartSha256:'c'.repeat(64),usageEndSha256:'d'.repeat(64),
        verificationSha256:'e'.repeat(64),baselineSha256:'f'.repeat(64)}));
    const budget = createBaselineBandwidthBudget({usage:{bytes:0,limit_bytes:500_000_000,remaining_bytes:500_000_000},samples,
        manifestHash,tradeDate,attempt:1,observedAt:now.toISOString()});
    const file=path.join(directory,`${tradeDate}.json`); await writeFile(file,JSON.stringify(budget),{mode:0o600});
    const identity = await initializeLocalConservativeIdentity(db,now);
    const record={version:3,...identity,quotaEpochVerified:false,validThrough:new Date(now.getTime()+86400000).toISOString(),
        consumerObservationMode:'baseline-protected-allocation-v1',minimumBaselineAllocationBytes:70_000_000,
        budgetPolicy:{status:'verified',evidenceHash:'c'.repeat(64),validThrough:new Date(now.getTime()+86400000).toISOString(),
            quoteReserveBytes:100_000_000,otherConsumerJobKeys:['monitor-baseline-allocation'],estimateMultiplier:2,
            maxEstimatedBytes:3000,maxRequestsPerWindow:2,rateWindowMs:60000,
            measurements:[1,2].map(i=>({evidenceHash:String(i).repeat(64),usageBefore:0,usageAfter:1000,responseBytes:300,
                observedAt:now.toISOString(),provider:'shioaji-daily-quotes'}))}};
    await db.prepare('INSERT INTO screener_runs VALUES(?,?,?,?,?)').bind('screener-bollinger-broker-budget-policy','policy','verified',JSON.stringify(record),now.toISOString()).run();
    return {db,root,record,now,file,budget,close:async()=>{db.close();await rm(root,{recursive:true,force:true});}};
}
test('真實預算重算後保留完整forecast／配置底額，不冒稱昨日完成為零',async()=>{
    const f=await fixture();try{
        await observeRuntimeBudgetAllocations(f);
        const result=await readScreenerBrokerCommitments(f.db,f.record,f.now);
        assert.equal(result.otherJobCommitments[0].bytes,70_000_000);
        const original=(await f.db.prepare("SELECT COUNT(*) n FROM screener_runs WHERE scope='broker-consumer-observation'").first()).n;
        assert.equal((await observeRuntimeBudgetAllocations(f)).state,'unchanged');
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_runs WHERE scope='broker-consumer-observation'").first()).n,original);
    }finally{await f.close();}
});
test('預算缺席／forecast破損／未知roster拒絕，不虛填零或改舊觀察',async()=>{
    for(const failure of ['missing','tampered','roster']){
        const f=await fixture();try{
            if(failure==='missing')await rm(f.file);
            if(failure==='tampered')await writeFile(f.file,JSON.stringify({...f.budget,forecastBytes:1}));
            if(failure==='roster')f.record.budgetPolicy.otherConsumerJobKeys.push('unknown-job');
            await assert.rejects(observeRuntimeBudgetAllocations(f));
            assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_runs WHERE scope='broker-consumer-observation'").first()).n,0);
        }finally{await f.close();}
    }
});
