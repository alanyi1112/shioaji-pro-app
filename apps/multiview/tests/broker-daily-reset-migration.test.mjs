import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { initializeLocalConservativeIdentity } from '../../../scripts/broker-local-conservative-ledger.mjs';
import { classifyBrokerDailyResetWitness } from '../../../scripts/broker-daily-reset-witness.mjs';
import { planBrokerDailyResetMigration, persistBrokerDailyResetMigration }
    from '../../../scripts/broker-daily-reset-migration.mjs';
import { readLocalVerifiedDailyIdentity } from '../../../scripts/broker-local-verified-reset-ledger.mjs';
import { readScreenerBrokerCommitments } from '../../../scripts/stock-screener-broker-commitments.mjs';
import { brokerStockAccountScopeHash } from '../../../scripts/broker-account-scope.mjs';
import { createScreenerBrokerPorts } from '../../../scripts/stock-screener-broker-ports.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const migration = await readFile(new URL('../drizzle/0039_broker_bandwidth_reservations.sql', import.meta.url), 'utf8');
const now = new Date('2026-10-06T00:01:20Z');
const testAccounts = [{ signed: true, account_type: 'S', broker_id: '0001', account_id: '1234567' }];
const testKey = Buffer.alloc(32, 7);
async function fixture() {
    const db = new SqliteD1();
    db.exec('CREATE TABLE screener_runs(id TEXT PRIMARY KEY,scope TEXT,status TEXT,checkpoint TEXT,updated_at TEXT)');
    applyDrizzleSql(db, migration);
    const previous = await initializeLocalConservativeIdentity(db, new Date('2026-10-05T12:00:00Z'));
    const before = { generation: 'simulation:old', usedBytes: 70000000,
        remainingBytes: 454288000, limitBytes: 524288000,
        observedAt: '2026-10-05T12:11:46Z' };
    const after = { generation: 'simulation:new', usedBytes: 1000000,
        remainingBytes: 523288000, limitBytes: 524288000,
        observedAt: '2026-10-06T00:01:00Z' };
    const account = brokerStockAccountScopeHash(testAccounts, testKey);
    const witness = classifyBrokerDailyResetWitness({ before, after,
        beforeAccountHash: account, afterAccountHash: account,
        tradingDay: { tradeDate: '2026-10-06', twseTradingDay: true,
            tpexTradingDay: true, officialEvidenceHash: 'c'.repeat(64),
            verifiedAt: '2026-10-06T00:00:30Z' },
        observedAt: '2026-10-06T00:01:10Z' });
    const oldPolicy = { ...previous, version: 3, quotaEpochVerified: false,
        validThrough: '2026-10-10T15:59:59Z',
        minimumBaselineAllocationBytes: 85667193,
        budgetPolicy: { status: 'verified', evidenceHash: 'd'.repeat(64),
            validThrough: '2026-10-10T15:59:59Z', quoteReserveBytes: 314572800,
            otherConsumerJobKeys: ['monitor-baseline-allocation'],
            estimateMultiplier: 1.5, maxEstimatedBytes: 1000000,
            maxRequestsPerWindow: 2, rateWindowMs: 60000,
            measurements: [1, 2].map(index => ({ evidenceHash: String(index).repeat(64),
                usageBefore: 100, usageAfter: 244904, responseBytes: 1000,
                observedAt: '2026-10-03T12:00:00Z', provider: 'shioaji-daily-quotes' })) } };
    const proof = { version: 1, jobKey: 'monitor-baseline-allocation',
        scope: previous.scope, quotaEpoch: previous.quotaEpoch,
        quotaEpochEvidenceHash: previous.quotaEpochEvidenceHash,
        observedAt: '2026-10-06T00:01:10Z', remainingBytes: 85667193,
        state: 'committed', sourceEvidenceHash: 'e'.repeat(64) };
    const oldCommitment = { ...proof, evidenceHash: sha(proof) };
    await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
        VALUES('screener-bollinger-broker-budget-policy','policy','verified',?,?)`)
        .bind(JSON.stringify(oldPolicy), now.toISOString()).run();
    await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
        VALUES('broker-consumer-commitment:monitor-baseline-allocation','commitment','verified',?,?)`)
        .bind(JSON.stringify(oldCommitment), now.toISOString()).run();
    await db.prepare(`INSERT INTO broker_bandwidth_reservations(id,scope,quota_epoch,generation,job_key,owner,status,
        estimated_bytes,usage_before,policy_hash,created_at,lease_until,updated_at)
        VALUES('old-charged',?,?,?,'old-job','old-owner','charged',1000000,0,?, ?,?,?)`)
        .bind(previous.scope, previous.quotaEpoch, before.generation, 'f'.repeat(64),
            before.observedAt, before.observedAt, before.observedAt).run();
    return { db, witness, oldPolicy, oldCommitment };
}

test('300MiB 不變，全窗口足額時才原子遷移；舊政策/承諾/charged 完整保存', async () => {
    const f = await fixture(); try {
        const plan = planBrokerDailyResetMigration({ oldPolicy: f.oldPolicy,
            oldCommitments: [f.oldCommitment], witness: f.witness,
            missingRequests: 320, now });
        assert.equal(plan.quoteReserveBytes, 314572800);
        assert.ok(plan.headroomBytes > 0);
        const result = await persistBrokerDailyResetMigration({ db: f.db, plan,
            previousPolicy: f.oldPolicy, previousCommitments: [f.oldCommitment],
            witness: f.witness, now });
        assert.equal(result.state, 'migrated');
        const current = JSON.parse((await f.db.prepare(`SELECT checkpoint FROM screener_runs
            WHERE id='screener-bollinger-broker-budget-policy'`).first()).checkpoint);
        assert.equal(current.version, 4);
        assert.equal(current.budgetPolicy.quoteReserveBytes, 314572800);
        assert.equal((await readLocalVerifiedDailyIdentity(f.db)).quotaEpoch, 'local-daily:2026-10-06');
        assert.equal((await readScreenerBrokerCommitments(f.db, current, now)).otherJobCommitments[0].bytes,
            85667193);
        assert.equal((await f.db.prepare("SELECT status FROM broker_bandwidth_reservations WHERE id='old-charged'").first()).status,
            'charged');
        assert.equal((await f.db.prepare("SELECT checkpoint FROM screener_runs WHERE scope='broker-budget-policy-archive'").first()).checkpoint,
            JSON.stringify(f.oldPolicy));
        assert.equal((await f.db.prepare('SELECT checkpoint FROM screener_runs WHERE id=?')
            .bind(`broker-consumer-observation:${f.oldCommitment.evidenceHash}`).first()).checkpoint,
            JSON.stringify(f.oldCommitment));
        await assert.rejects(persistBrokerDailyResetMigration({ db: f.db, plan,
            previousPolicy: f.oldPolicy, previousCommitments: [f.oldCommitment],
            witness: f.witness, now }), /broker_daily_migration_policy_changed/);
        const root = await realpath(await mkdtemp(path.join(tmpdir(), 'broker-daily-port-')));
        try {
            await chmod(root, 0o700);
            await mkdir(path.join(root, 'IntradayMonitor'), { mode: 0o700 });
            await writeFile(path.join(root, 'IntradayMonitor', 'broker-quota-account-hmac.key'), testKey, { mode: 0o600 });
            await writeFile(path.join(root, 'runtime-mode'), 'simulation', { mode: 0o600 });
            await writeFile(path.join(root, 'runtime-api-generation'), afterGeneration(), { mode: 0o600 });
            const fetchImpl = async url => {
                const endpoint = url.split('/api/v1/')[1];
                return Response.json(endpoint === 'info' ? { simulation: true }
                    : endpoint === 'health' ? { status: 'healthy' }
                        : endpoint === 'data/snapshots' ? [{ code: '2330', close: 100 }]
                            : endpoint === 'auth/accounts' ? testAccounts
                                : { bytes: 1000000, remaining_bytes: 523288000, limit_bytes: 524288000 });
            };
            const port = createScreenerBrokerPorts({ db: f.db, root, fetchImpl, now: () => now });
            const reservation = await port.admission.reserve({ cacheKey: 'new-day-job',
                generation: afterGeneration() });
            assert.equal(reservation.allowed, true, JSON.stringify(reservation));
            assert.equal((await f.db.prepare("SELECT status FROM broker_bandwidth_reservations WHERE id='old-charged'").first()).status,
                'charged');
        } finally { await rm(root, { recursive: true, force: true }); }
    } finally { f.db.close(); }
});
function afterGeneration() { return 'simulation:new'; }

test('未覆蓋整個160檔、舊預留未結束或重設後觀察已過期時拒絕，零改正式政策', async () => {
    const f = await fixture(); try {
        assert.throws(() => planBrokerDailyResetMigration({ oldPolicy: f.oldPolicy,
            oldCommitments: [f.oldCommitment], witness: f.witness,
            missingRequests: 1, now }), /broker_daily_migration_inputs_invalid/);
        assert.throws(() => planBrokerDailyResetMigration({ oldPolicy: f.oldPolicy,
            oldCommitments: [f.oldCommitment], witness: f.witness,
            missingRequests: 320, now: new Date(now.getTime() + 120000) }),
        /broker_daily_migration_inputs_invalid/);
        assert.throws(() => planBrokerDailyResetMigration({ oldPolicy: {
            ...f.oldPolicy, budgetPolicy: { ...f.oldPolicy.budgetPolicy,
                quoteReserveBytes: 450000000 } }, oldCommitments: [f.oldCommitment],
            witness: f.witness, missingRequests: 320, now }),
        /broker_daily_migration_full_window_budget_denied/);
        const plan = planBrokerDailyResetMigration({ oldPolicy: f.oldPolicy,
            oldCommitments: [f.oldCommitment], witness: f.witness,
            missingRequests: 320, now });
        await f.db.prepare(`INSERT INTO broker_bandwidth_reservations(id,scope,quota_epoch,generation,job_key,owner,status,
            estimated_bytes,usage_before,policy_hash,created_at,lease_until,updated_at)
            VALUES('active',?,?,?,'active-job','owner','reserved',1000,0,?, ?,?,?)`)
            .bind(f.oldPolicy.scope, f.oldPolicy.quotaEpoch, 'simulation:old',
                'f'.repeat(64), now.toISOString(), now.toISOString(), now.toISOString()).run();
        await assert.rejects(persistBrokerDailyResetMigration({ db: f.db, plan,
            previousPolicy: f.oldPolicy, previousCommitments: [f.oldCommitment],
            witness: f.witness, now }), /broker_daily_migration_active_reservation/);
        assert.equal(JSON.parse((await f.db.prepare(`SELECT checkpoint FROM screener_runs
            WHERE id='screener-bollinger-broker-budget-policy'`).first()).checkpoint).version, 3);
    } finally { f.db.close(); }
});

test('v4 次交易日再次轉換：保留前一日身分、承諾與 charged，300MiB 不變', async () => {
    const f = await fixture();
    const next = new Date('2026-10-07T00:01:20Z');
    try {
        const first = planBrokerDailyResetMigration({ oldPolicy: f.oldPolicy,
            oldCommitments: [f.oldCommitment], witness: f.witness,
            missingRequests: 320, now });
        await persistBrokerDailyResetMigration({ db: f.db, plan: first,
            previousPolicy: f.oldPolicy, previousCommitments: [f.oldCommitment],
            witness: f.witness, now });
        const priorIdentity = await readLocalVerifiedDailyIdentity(f.db);
        const priorHead = (await f.db.prepare(`SELECT checkpoint FROM screener_runs
            WHERE id='broker-local-daily-reset-head'`).first()).checkpoint;
        const body = { version: 1, jobKey: 'monitor-baseline-allocation',
            scope: first.policy.scope, quotaEpoch: first.policy.quotaEpoch,
            quotaEpochEvidenceHash: first.policy.quotaEpochEvidenceHash,
            observedAt: '2026-10-07T00:01:10Z', remainingBytes: 85667193,
            state: 'committed', sourceEvidenceHash: '7'.repeat(64) };
        const refreshed = { ...body, evidenceHash: sha(body) };
        const receiptId = `broker-consumer-observation:${refreshed.evidenceHash}`;
        await f.db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
            VALUES(?,'broker-consumer-observation','verified',?,?)`)
            .bind(receiptId, JSON.stringify(refreshed), next.toISOString()).run();
        await f.db.prepare(`UPDATE screener_runs SET checkpoint=?,updated_at=? WHERE id=?`)
            .bind(JSON.stringify({ version: 2, jobKey: body.jobKey, receiptId }),
                next.toISOString(), `broker-consumer-commitment:${body.jobKey}`).run();
        const account = brokerStockAccountScopeHash(testAccounts, testKey);
        const nextWitness = classifyBrokerDailyResetWitness({
            before: { generation: 'simulation:prior', usedBytes: 70000000,
                remainingBytes: 454288000, limitBytes: 524288000,
                observedAt: '2026-10-06T12:11:46Z' },
            after: { generation: 'simulation:next', usedBytes: 1000000,
                remainingBytes: 523288000, limitBytes: 524288000,
                observedAt: '2026-10-07T00:01:00Z' },
            beforeAccountHash: account, afterAccountHash: account,
            tradingDay: { tradeDate: '2026-10-07', twseTradingDay: true,
                tpexTradingDay: true, officialEvidenceHash: '8'.repeat(64),
                verifiedAt: '2026-10-07T00:00:30Z' },
            observedAt: '2026-10-07T00:01:10Z',
        });
        assert.throws(() => planBrokerDailyResetMigration({ oldPolicy: first.policy,
            oldCommitments: [refreshed], previousDailyIdentity: priorIdentity,
            witness: f.witness, missingRequests: 320, now }),
        /broker_daily_migration_inputs_invalid/);
        const second = planBrokerDailyResetMigration({ oldPolicy: first.policy,
            oldCommitments: [refreshed], previousDailyIdentity: priorIdentity,
            witness: nextWitness, missingRequests: 320, now: next });
        assert.equal(second.policy.validThrough, '2026-10-14T00:01:20.000Z');
        assert.equal(second.policy.budgetPolicy.validThrough, second.policy.validThrough);
        const dailyPolicy = { ...first.policy,
            consumerObservationMode: 'daily-baseline-allocation-v1' };
        const completedBody = { ...body, remainingBytes: 0, state: 'complete' };
        const completed = { ...completedBody, evidenceHash: sha(completedBody) };
        const dailyNext = planBrokerDailyResetMigration({ oldPolicy: dailyPolicy,
            oldCommitments: [completed], previousDailyIdentity: priorIdentity,
            witness: nextWitness, missingRequests: 320, now: next });
        assert.equal(dailyNext.newCommitments[0].remainingBytes, 85667193);
        assert.equal(dailyNext.newCommitments[0].state, 'committed');
        assert.equal(dailyNext.quoteReserveBytes, 314572800);
        assert.equal(dailyNext.requiredTopUpBytes,
            dailyNext.requiredBytes - dailyNext.newCommitments[0].remainingBytes);
        assert.throws(() => planBrokerDailyResetMigration({ oldPolicy: {
            ...dailyPolicy, budgetPolicy: { ...dailyPolicy.budgetPolicy,
                measurements: dailyPolicy.budgetPolicy.measurements.map(value => ({
                    ...value, observedAt: '2026-08-01T00:00:00Z' })) } },
            oldCommitments: [completed], previousDailyIdentity: priorIdentity,
            witness: nextWitness, missingRequests: 320, now: next }),
        /broker_daily_migration_measurements_expired/);
        const witnessWithRemaining = remainingBytes => classifyBrokerDailyResetWitness({
            before: { generation: 'simulation:prior', usedBytes: 200000000,
                remainingBytes: 324288000, limitBytes: 524288000,
                observedAt: '2026-10-06T12:11:46Z' },
            after: { generation: 'simulation:next', usedBytes: 524288000 - remainingBytes,
                remainingBytes, limitBytes: 524288000,
                observedAt: '2026-10-07T00:01:00Z' },
            beforeAccountHash: account, afterAccountHash: account,
            tradingDay: { tradeDate: '2026-10-07', twseTradingDay: true,
                tpexTradingDay: true, officialEvidenceHash: '8'.repeat(64),
                verifiedAt: '2026-10-07T00:00:30Z' },
            observedAt: '2026-10-07T00:01:10Z',
        });
        const enoughAfterOtherUsage = planBrokerDailyResetMigration({ oldPolicy: dailyPolicy,
            oldCommitments: [completed], previousDailyIdentity: priorIdentity,
            witness: witnessWithRemaining(450000000), missingRequests: 320, now: next });
        assert.ok(enoughAfterOtherUsage.headroomBytes > 0);
        assert.throws(() => planBrokerDailyResetMigration({ oldPolicy: dailyPolicy,
            oldCommitments: [completed], previousDailyIdentity: priorIdentity,
            witness: witnessWithRemaining(420000000), missingRequests: 320, now: next }),
        /broker_daily_migration_full_window_budget_denied/);
        assert.equal(second.identity.previousIdentityHash, priorIdentity.identityHash);
        assert.equal(second.quoteReserveBytes, 314572800);
        await persistBrokerDailyResetMigration({ db: f.db, plan: second,
            previousPolicy: first.policy, previousCommitments: [refreshed],
            previousDailyIdentity: priorIdentity, witness: nextWitness, now: next });
        assert.equal((await readLocalVerifiedDailyIdentity(f.db)).quotaEpoch,
            'local-daily:2026-10-07');
        assert.equal((await f.db.prepare('SELECT checkpoint FROM screener_runs WHERE id=?')
            .bind(`broker-local-daily-reset-archive:${priorIdentity.identityHash}`).first()).checkpoint,
            priorHead);
        assert.equal((await f.db.prepare('SELECT checkpoint FROM screener_runs WHERE id=?')
            .bind(`broker-consumer-observation:${refreshed.evidenceHash}`).first()).checkpoint,
            JSON.stringify(refreshed));
        assert.equal((await f.db.prepare("SELECT status FROM broker_bandwidth_reservations WHERE id='old-charged'").first()).status,
            'charged');
        const current = JSON.parse((await f.db.prepare(`SELECT checkpoint FROM screener_runs
            WHERE id='screener-bollinger-broker-budget-policy'`).first()).checkpoint);
        assert.equal(current.quotaEpoch, 'local-daily:2026-10-07');
        assert.equal(current.budgetPolicy.quoteReserveBytes, 314572800);
        await assert.rejects(persistBrokerDailyResetMigration({ db: f.db, plan: second,
            previousPolicy: first.policy, previousCommitments: [refreshed],
            previousDailyIdentity: priorIdentity, witness: nextWitness, now: next }),
        /broker_daily_migration_policy_changed/);
    } finally { f.db.close(); }
});
