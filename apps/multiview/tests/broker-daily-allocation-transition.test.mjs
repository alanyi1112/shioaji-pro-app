import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { initializeLocalConservativeIdentity } from '../../../scripts/broker-local-conservative-ledger.mjs';
import { classifyBrokerDailyResetWitness } from '../../../scripts/broker-daily-reset-witness.mjs';
import { planBrokerDailyResetMigration, persistBrokerDailyResetMigration }
    from '../../../scripts/broker-daily-reset-migration.mjs';
import { createBaselineBandwidthBudget }
    from '../../../scripts/intraday-monitor-runtime/baseline-bandwidth-budget.mjs';
import { transitionDailyBaselineAllocation }
    from '../../../scripts/broker-daily-allocation-transition.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const at = new Date('2026-10-06T10:30:00Z');
const migration = await readFile(new URL('../drizzle/0039_broker_bandwidth_reservations.sql', import.meta.url), 'utf8');
async function fixture() {
    const db = new SqliteD1();
    db.exec('CREATE TABLE screener_runs(id TEXT PRIMARY KEY,scope TEXT,status TEXT,checkpoint TEXT,updated_at TEXT)');
    applyDrizzleSql(db, migration);
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'daily-allocation-transition-')));
    const directory = path.join(root, 'IntradayMonitor/postclose-baseline/budgets');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const samples = ['2026-10-05','2026-10-02'].map(tradeDate => ({ tradeDate,
        consumedBytes:20_000_000, providerLimitBytes:524_288_000, manifestHash:'a'.repeat(64),
        sourceSha256:'b'.repeat(64), usageStartSha256:'c'.repeat(64), usageEndSha256:'d'.repeat(64),
        verificationSha256:'e'.repeat(64), baselineSha256:'f'.repeat(64) }));
    const budget = createBaselineBandwidthBudget({ usage:{ bytes:40_000_000,
        limit_bytes:524_288_000, remaining_bytes:484_288_000 }, samples,
        manifestHash:'a'.repeat(64), tradeDate:'2026-10-06', attempt:1, observedAt:at.toISOString() });
    const budgetFile=path.join(directory, '2026-10-06.json');
    await writeFile(budgetFile, JSON.stringify(budget), { mode:0o600 });
    await utimes(budgetFile,at,at);
    await writeFile(path.join(root, 'IntradayMonitor/daily-runtime-mode.json'), JSON.stringify({
        schemaVersion:'intraday-minute-volume-runtime-mode/1', mode:'daily',
        screenerDatabasePath:'/local/screener.sqlite3', limits:{ maxRequests:320,
            maxResponseBytes:2*1024*1024, requestTimeoutMs:20000,
            maxAttempts:3, cooldownMs:900000, deadlineTime:'19:00:00' } }), { mode:0o600 });
    const old = await initializeLocalConservativeIdentity(db, new Date('2026-10-05T12:00:00Z'));
    const policy = { ...old, version:3, quotaEpochVerified:false,
        consumerObservationMode:'baseline-protected-allocation-v1',
        minimumBaselineAllocationBytes:85_667_193, validThrough:'2026-10-10T15:59:59Z',
        budgetPolicy:{ status:'verified', evidenceHash:'d'.repeat(64), validThrough:'2026-10-10T15:59:59Z',
            quoteReserveBytes:314_572_800, otherConsumerJobKeys:['monitor-baseline-allocation'],
            estimateMultiplier:1.5, maxEstimatedBytes:1_000_000, maxRequestsPerWindow:2,
            rateWindowMs:60000, measurements:[1,2].map(i => ({ evidenceHash:String(i).repeat(64),
                usageBefore:100, usageAfter:244904, responseBytes:1000,
                observedAt:'2026-10-03T12:00:00Z', provider:'shioaji-daily-quotes' })) } };
    const body = { version:1, jobKey:'monitor-baseline-allocation', scope:old.scope,
        quotaEpoch:old.quotaEpoch, quotaEpochEvidenceHash:old.quotaEpochEvidenceHash,
        observedAt:'2026-10-06T00:01:10Z', remainingBytes:85_667_193,
        state:'committed', sourceEvidenceHash:'e'.repeat(64) };
    const commitment = { ...body, evidenceHash:sha(body) };
    for (const [id,value] of [['screener-bollinger-broker-budget-policy',policy],
        ['broker-consumer-commitment:monitor-baseline-allocation',commitment]]) {
        await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
            VALUES(?,'fixture','verified',?,?)`).bind(id,JSON.stringify(value),at.toISOString()).run();
    }
    const account='a'.repeat(64);
    const witness=classifyBrokerDailyResetWitness({ before:{ generation:'simulation:old',
        usedBytes:70_000_000, remainingBytes:454_288_000, limitBytes:524_288_000,
        observedAt:'2026-10-05T12:11:46Z' }, after:{ generation:'simulation:new',
        usedBytes:1_000_000, remainingBytes:523_288_000, limitBytes:524_288_000,
        observedAt:'2026-10-06T00:01:00Z' }, beforeAccountHash:account, afterAccountHash:account,
        tradingDay:{ tradeDate:'2026-10-06', twseTradingDay:true, tpexTradingDay:true,
            officialEvidenceHash:'c'.repeat(64), verifiedAt:'2026-10-06T00:00:30Z' },
        observedAt:'2026-10-06T00:01:10Z' });
    const plannedAt = new Date('2026-10-06T00:01:20Z');
    const plan = planBrokerDailyResetMigration({ oldPolicy:policy, oldCommitments:[commitment],
        witness, missingRequests:320, now:plannedAt });
    await persistBrokerDailyResetMigration({ db, plan, previousPolicy:policy,
        previousCommitments:[commitment], witness, now:plannedAt });
    for (const [id,status,bytes,epoch] of [
        ['today','charged',50_000_000,plan.policy.quotaEpoch],
        ['old','charged',90_000_000,old.quotaEpoch]]) {
        await db.prepare(`INSERT INTO broker_bandwidth_reservations(id,scope,quota_epoch,generation,
            job_key,owner,status,estimated_bytes,usage_before,policy_hash,created_at,lease_until,updated_at)
            VALUES(?,?,?,'simulation:new',?,'test',?,?,0,?,?,?,?)`)
            .bind(id,plan.policy.scope,epoch,`monitor-minute-v2:${id}`,status,bytes,
                'f'.repeat(64),at.toISOString(),at.toISOString(),at.toISOString()).run();
    }
    const input={ db,root,now:()=>at, accountHashReader:async()=>account,
        portsFactory:()=>({ safety:async()=>({ simulation:true,generation:'simulation:new' }),
            observeUsage:async()=>({ generation:'simulation:new', usedBytes:40_000_000,
                remainingBytes:484_288_000, limitBytes:524_288_000, observedAt:at.toISOString() }) }) };
    return { db,root,input,cleanup:async()=>{ db.close(); await rm(root,{recursive:true,force:true}); } };
}

test('同週期逐筆額度承接舊基準保留，跨週期不抵扣；300MiB及原收據不變', async()=>{
    const f=await fixture(); try {
        const result=await transitionDailyBaselineAllocation(f.input);
        assert.equal(result.state,'transitioned');
        assert.equal(result.quoteReserveBytes,314_572_800);
        assert.equal(result.retainedEstimatedBytes,50_000_000);
        assert.equal(result.newCommitmentBytes,35_667_193);
        const current=JSON.parse((await f.db.prepare(`SELECT checkpoint FROM screener_runs
            WHERE id='screener-bollinger-broker-budget-policy'`).first()).checkpoint);
        assert.equal(current.consumerObservationMode,'daily-baseline-allocation-v1');
        assert.equal((await f.db.prepare(`SELECT COUNT(*) n FROM screener_runs
            WHERE scope='broker-budget-policy-archive'`).first()).n,2);
        assert.equal((await f.db.prepare(`SELECT status FROM broker_bandwidth_reservations WHERE id='old'`).first()).status,'charged');
        await assert.rejects(transitionDailyBaselineAllocation(f.input),/broker_allocation_transition_pending/);
    } finally { await f.cleanup(); }
});

test('active reservation 出現時政策不轉換', async()=>{
    const f=await fixture(); try {
        await f.db.prepare(`UPDATE broker_bandwidth_reservations SET status='reserved' WHERE id='today'`).run();
        await assert.rejects(transitionDailyBaselineAllocation(f.input),/broker_allocation_transition_pending/);
        const current=JSON.parse((await f.db.prepare(`SELECT checkpoint FROM screener_runs
            WHERE id='screener-bollinger-broker-budget-policy'`).first()).checkpoint);
        assert.equal(current.consumerObservationMode,'baseline-protected-allocation-v1');
    } finally { await f.cleanup(); }
});
test('帳戶身分不符時不轉換政策或移動工作承諾', async()=>{
    const f=await fixture(); try {
        await assert.rejects(transitionDailyBaselineAllocation({ ...f.input,
            accountHashReader:async()=> 'b'.repeat(64) }),
        /broker_allocation_transition_pending/);
        const current=JSON.parse((await f.db.prepare(`SELECT checkpoint FROM screener_runs
            WHERE id='screener-bollinger-broker-budget-policy'`).first()).checkpoint);
        assert.equal(current.consumerObservationMode,'baseline-protected-allocation-v1');
        assert.equal((await f.db.prepare(`SELECT COUNT(*) n FROM screener_runs
            WHERE scope='broker-budget-policy-transition'`).first()).n,0);
    } finally { await f.cleanup(); }
});
