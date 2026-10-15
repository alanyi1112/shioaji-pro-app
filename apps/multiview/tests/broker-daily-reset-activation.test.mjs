import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { initializeLocalConservativeIdentity }
    from '../../../scripts/broker-local-conservative-ledger.mjs';
import { classifyBrokerDailyResetWitness }
    from '../../../scripts/broker-daily-reset-witness.mjs';
import { prepareBrokerDailyResetActivation, commitBrokerDailyResetActivation }
    from '../../../scripts/broker-daily-reset-activation.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const schema = '2026-10-06T00:01:20Z';
const now = () => new Date(schema);
const accountHash = 'a'.repeat(64);
const migration = await import('node:fs/promises').then(fs => fs.readFile(
    new URL('../drizzle/0039_broker_bandwidth_reservations.sql', import.meta.url), 'utf8'));

async function fixture({ reserveBytes = 314572800 } = {}) {
    const db = new SqliteD1();
    db.exec('CREATE TABLE screener_runs(id TEXT PRIMARY KEY,scope TEXT,status TEXT,checkpoint TEXT,updated_at TEXT)');
    applyDrizzleSql(db, migration);
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'broker-reset-activation-')));
    await chmod(root, 0o700);
    await writeFile(path.join(root, 'runtime-mode'), 'simulation', { mode: 0o600 });
    await writeFile(path.join(root, 'runtime-api-generation'), 'simulation:new', { mode: 0o600 });
    const previous = await initializeLocalConservativeIdentity(db, new Date('2026-10-05T12:00:00Z'));
    const policy = { ...previous, version: 3, quotaEpochVerified: false,
        validThrough: '2026-10-10T15:59:59Z',
        budgetPolicy: { status: 'verified', evidenceHash: 'd'.repeat(64),
            validThrough: '2026-10-10T15:59:59Z',
            quoteReserveBytes: reserveBytes, otherConsumerJobKeys: ['monitor-baseline-allocation'],
            estimateMultiplier: 1.5, maxEstimatedBytes: 1000000,
            maxRequestsPerWindow: 2, rateWindowMs: 60000,
            measurements: [1, 2].map(index => ({ evidenceHash: String(index).repeat(64),
                usageBefore: 100, usageAfter: 244904, responseBytes: 1000,
                observedAt: '2026-10-03T12:00:00Z', provider: 'shioaji-daily-quotes' })) } };
    const commitmentBody = { version: 1, jobKey: 'monitor-baseline-allocation',
        scope: previous.scope, quotaEpoch: previous.quotaEpoch,
        quotaEpochEvidenceHash: previous.quotaEpochEvidenceHash,
        observedAt: '2026-10-06T00:01:10Z', remainingBytes: 85667193,
        state: 'committed', sourceEvidenceHash: 'e'.repeat(64) };
    const commitment = { ...commitmentBody, evidenceHash: sha(commitmentBody) };
    for (const [id, checkpoint] of [
        ['screener-bollinger-broker-budget-policy', policy],
        ['broker-consumer-commitment:monitor-baseline-allocation', commitment],
    ]) await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
        VALUES(?,'fixture','verified',?,?)`).bind(id, JSON.stringify(checkpoint), schema).run();
    const witness = classifyBrokerDailyResetWitness({
        before: { generation: 'simulation:old', usedBytes: 70000000,
            remainingBytes: 454288000, limitBytes: 524288000,
            observedAt: '2026-10-05T12:11:46Z' },
        after: { generation: 'simulation:new', usedBytes: 1000000,
            remainingBytes: 523288000, limitBytes: 524288000,
            observedAt: '2026-10-06T00:01:00Z' },
        beforeAccountHash: accountHash, afterAccountHash: accountHash,
        tradingDay: { tradeDate: '2026-10-06', twseTradingDay: true,
            tpexTradingDay: true, officialEvidenceHash: 'c'.repeat(64),
            verifiedAt: '2026-10-06T00:00:30Z' },
        observedAt: '2026-10-06T00:01:10Z',
    });
    const envelope = { witness, officialEvidenceHash: 'c'.repeat(64) };
    const fetchImpl = async url => {
        const endpoint = url.split('/api/v1/')[1];
        return Response.json(endpoint === 'info' ? { simulation: true }
            : endpoint === 'health' ? { status: 'healthy' }
                : endpoint === 'data/snapshots' ? [{ code: '2330', close: 100 }]
                    : { bytes: 1000000, remaining_bytes: 523288000, limit_bytes: 524288000 });
    };
    const common = { db, root, now, fetchImpl,
        buildWitness: async () => envelope };
    return { ...common, witness, envelope, policy,
        cleanup: async () => { db.close(); await rm(root, { recursive: true, force: true }); } };
}

test('準備不改額度政策；同一官方證據、帳戶及 generation 才可寫入新週期', async () => {
    const f = await fixture();
    try {
        const prepared = await prepareBrokerDailyResetActivation({ ...f,
            beforeEvidenceHash: '1'.repeat(64),
            recordAfter: async () => ({ evidenceHash: '2'.repeat(64) }),
            refreshAllocations: async () => ({ state: 'unchanged' }) });
        assert.equal(prepared.plan.quoteReserveBytes, 314572800);
        assert.equal(prepared.admissionAuthority, false);
        assert.equal(JSON.parse((await f.db.prepare(`SELECT checkpoint FROM screener_runs
            WHERE id='screener-bollinger-broker-budget-policy'`).first()).checkpoint).version, 3);
        const result = await commitBrokerDailyResetActivation({ ...f, prepared,
            readAccountHash: async () => accountHash });
        assert.equal(result.state, 'migrated');
        assert.equal(result.quoteReserveBytes, 314572800);
        assert.equal(JSON.parse((await f.db.prepare(`SELECT checkpoint FROM screener_runs
            WHERE id='screener-bollinger-broker-budget-policy'`).first()).checkpoint).version, 4);
    } finally { await f.cleanup(); }
});

test('真實時鐘在 prepare 與 commit 間推進時保留原 witness 身分，逾期仍拒絕', async () => {
    const f = await fixture();
    try {
        const proof = f.witness.proof;
        const buildWitness = async ({ now: observedAt }) => ({
            witness: classifyBrokerDailyResetWitness({
                before: proof.before, after: proof.after,
                beforeAccountHash: accountHash, afterAccountHash: accountHash,
                tradingDay: { tradeDate: '2026-10-06', twseTradingDay: true,
                    tpexTradingDay: true, officialEvidenceHash: 'c'.repeat(64),
                    verifiedAt: '2026-10-06T00:00:30Z' },
                observedAt: observedAt.toISOString(),
            }),
            officialEvidenceHash: 'c'.repeat(64),
        });
        const prepared = await prepareBrokerDailyResetActivation({ ...f,
            now: () => new Date('2026-10-06T00:01:20Z'), buildWitness,
            beforeEvidenceHash: '1'.repeat(64),
            recordAfter: async () => ({ evidenceHash: '2'.repeat(64) }),
            refreshAllocations: async () => ({ state: 'unchanged' }) });
        const result = await commitBrokerDailyResetActivation({ ...f, prepared, buildWitness,
            now: () => new Date('2026-10-06T00:01:25Z'),
            readAccountHash: async () => accountHash });
        assert.equal(result.state, 'migrated');
        await assert.rejects(commitBrokerDailyResetActivation({ ...f, prepared, buildWitness,
            now: () => new Date('2026-10-06T00:02:25Z'),
            readAccountHash: async () => accountHash }),
        /broker_daily_migration_witness_expired/);
    } finally { await f.cleanup(); }
});

test('commit 前來源帳戶或官方證據改變即拒絕，政策仍是 v3', async () => {
    for (const changed of ['account', 'official']) {
        const f = await fixture();
        try {
            const prepared = await prepareBrokerDailyResetActivation({ ...f,
                beforeEvidenceHash: '1'.repeat(64),
                recordAfter: async () => ({ evidenceHash: '2'.repeat(64) }),
                refreshAllocations: async () => ({ state: 'unchanged' }) });
            await assert.rejects(commitBrokerDailyResetActivation({ ...f, prepared,
                readAccountHash: async () => changed === 'account' ? 'b'.repeat(64) : accountHash,
                buildWitness: async () => changed === 'official'
                    ? { ...f.envelope, officialEvidenceHash: 'e'.repeat(64) } : f.envelope }),
            /broker_daily_migration_source_changed/);
            assert.equal(JSON.parse((await f.db.prepare(`SELECT checkpoint FROM screener_runs
                WHERE id='screener-bollinger-broker-budget-policy'`).first()).checkpoint).version, 3);
        } finally { await f.cleanup(); }
    }
});

test('保護池不足以覆蓋全窗口時，準備階段拒絕且不寫入', async () => {
    const f = await fixture({ reserveBytes: 450000000 });
    try {
        await assert.rejects(prepareBrokerDailyResetActivation({ ...f,
            beforeEvidenceHash: '1'.repeat(64),
            recordAfter: async () => ({ evidenceHash: '2'.repeat(64) }),
            refreshAllocations: async () => ({ state: 'unchanged' }) }),
        /broker_daily_migration_full_window_budget_denied/);
        assert.equal(JSON.parse((await f.db.prepare(`SELECT checkpoint FROM screener_runs
            WHERE id='screener-bollinger-broker-budget-policy'`).first()).checkpoint).version, 3);
    } finally { await f.cleanup(); }
});

test('commit 前 API generation 換代或監控 owner 出現時拒絕', async () => {
    for (const changed of ['generation', 'owner']) {
        const f = await fixture();
        try {
            const prepared = await prepareBrokerDailyResetActivation({ ...f,
                beforeEvidenceHash: '1'.repeat(64),
                recordAfter: async () => ({ evidenceHash: '2'.repeat(64) }),
                refreshAllocations: async () => ({ state: 'unchanged' }) });
            if (changed === 'generation') {
                await writeFile(path.join(f.root, 'runtime-api-generation'), 'simulation:changed', { mode: 0o600 });
            } else {
                const registry = path.join(f.root, 'direct-160-live', 'registry');
                await mkdir(registry, { recursive: true, mode: 0o700 });
                await writeFile(path.join(registry, 'active.lock'), 'owned', { mode: 0o600 });
            }
            await assert.rejects(commitBrokerDailyResetActivation({ ...f, prepared,
                readAccountHash: async () => accountHash }),
            changed === 'owner' ? /broker_daily_migration_active_monitor_owner/
                : /broker_daily_migration_source_changed/);
            assert.equal(JSON.parse((await f.db.prepare(`SELECT checkpoint FROM screener_runs
                WHERE id='screener-bollinger-broker-budget-policy'`).first()).checkpoint).version, 3);
        } finally { await f.cleanup(); }
    }
});

test('daily 模式可用下一交易日新證據續轉，且未調降 300MiB 保護池', async () => {
    const f = await fixture();
    try {
        const prepared = await prepareBrokerDailyResetActivation({ ...f,
            beforeEvidenceHash: '1'.repeat(64),
            recordAfter: async () => ({ evidenceHash: '2'.repeat(64) }),
            refreshAllocations: async () => ({ state: 'unchanged' }) });
        await commitBrokerDailyResetActivation({ ...f, prepared,
            readAccountHash: async () => accountHash });
        await mkdir(path.join(f.root, 'IntradayMonitor'), { mode: 0o700 });
        await writeFile(path.join(f.root, 'IntradayMonitor', 'daily-runtime-mode.json'),
            JSON.stringify({ schemaVersion: 'intraday-minute-volume-runtime-mode/1',
                mode: 'daily', screenerDatabasePath: path.join(f.root, 'screener.sqlite3'),
                limits: { maxRequests: 320, maxResponseBytes: 2 * 1024 ** 2,
                    requestTimeoutMs: 20000, maxAttempts: 3,
                    cooldownMs: 15 * 60_000, deadlineTime: '18:30:00' } }), { mode: 0o600 });
        const nextTime = new Date('2026-10-07T00:01:20Z');
        const body = { version: 1, jobKey: 'monitor-baseline-allocation',
            scope: prepared.plan.policy.scope, quotaEpoch: prepared.plan.policy.quotaEpoch,
            quotaEpochEvidenceHash: prepared.plan.policy.quotaEpochEvidenceHash,
            observedAt: '2026-10-07T00:01:10Z', remainingBytes: 85667193,
            state: 'committed', sourceEvidenceHash: '7'.repeat(64) };
        const refreshed = { ...body, evidenceHash: sha(body) };
        const receiptId = `broker-consumer-observation:${refreshed.evidenceHash}`;
        await f.db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
            VALUES(?,'broker-consumer-observation','verified',?,?)`)
            .bind(receiptId, JSON.stringify(refreshed), nextTime.toISOString()).run();
        await f.db.prepare(`UPDATE screener_runs SET checkpoint=?,updated_at=? WHERE id=?`)
            .bind(JSON.stringify({ version: 2, jobKey: body.jobKey, receiptId }),
                nextTime.toISOString(), `broker-consumer-commitment:${body.jobKey}`).run();
        const nextWitness = classifyBrokerDailyResetWitness({
            before: { generation: 'simulation:prior', usedBytes: 70000000,
                remainingBytes: 454288000, limitBytes: 524288000,
                observedAt: '2026-10-06T12:11:46Z' },
            after: { generation: 'simulation:new', usedBytes: 1000000,
                remainingBytes: 523288000, limitBytes: 524288000,
                observedAt: '2026-10-07T00:01:00Z' },
            beforeAccountHash: accountHash, afterAccountHash: accountHash,
            tradingDay: { tradeDate: '2026-10-07', twseTradingDay: true,
                tpexTradingDay: true, officialEvidenceHash: '8'.repeat(64),
                verifiedAt: '2026-10-07T00:00:30Z' },
            observedAt: '2026-10-07T00:01:10Z',
        });
        const next = await prepareBrokerDailyResetActivation({ ...f,
            now: () => nextTime, beforeEvidenceHash: '3'.repeat(64),
            recordAfter: async () => ({ evidenceHash: '4'.repeat(64) }),
            buildWitness: async () => ({ witness: nextWitness,
                officialEvidenceHash: '8'.repeat(64) }),
            refreshAllocations: async () => ({ state: 'unchanged' }) });
        assert.equal(next.plan.quoteReserveBytes, 314572800);
        const result = await commitBrokerDailyResetActivation({ ...f, prepared: next,
            now: () => nextTime, readAccountHash: async () => accountHash,
            buildWitness: async () => ({ witness: nextWitness,
                officialEvidenceHash: '8'.repeat(64) }) });
        assert.equal(result.state, 'migrated');
        assert.equal(JSON.parse((await f.db.prepare(`SELECT checkpoint FROM screener_runs
            WHERE id='screener-bollinger-broker-budget-policy'`).first()).checkpoint).quotaEpoch,
        'local-daily:2026-10-07');
    } finally { await f.cleanup(); }
});
