import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { initializeLocalConservativeIdentity } from '../../../scripts/broker-local-conservative-ledger.mjs';
import { saveScreenerBrokerCommitment } from '../../../scripts/stock-screener-broker-commitments.mjs';
import { reviewScreenerBrokerPolicy } from '../../../scripts/stock-screener-broker-policy-review.mjs';
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const id = 'screener-bollinger-broker-budget-policy';
const migration = await readFile(new URL('../drizzle/0039_broker_bandwidth_reservations.sql', import.meta.url), 'utf8');
async function fixture() {
    const db = new SqliteD1();
    db.exec('CREATE TABLE screener_runs(id TEXT PRIMARY KEY,scope TEXT,status TEXT,checkpoint TEXT,updated_at TEXT)');
    applyDrizzleSql(db, migration);
    const at = '2026-10-04T04:00:00.000Z', now = () => new Date(at), identity = await initializeLocalConservativeIdentity(db, now());
    const start = { generation: 'simulation:fixture', usedBytes: 100, limitBytes: 1000000, remainingBytes: 999900, observedAt: '2026-10-03T04:00:00.000Z' };
    const middle = { ...start, usedBytes: 200, remainingBytes: 999800, observedAt: '2026-10-03T04:01:00.000Z' };
    const end = { ...start, usedBytes: 300, remainingBytes: 999700, observedAt: '2026-10-03T04:02:00.000Z' };
    const raw1 = { date: '2026-10-01', before: start, response: { text: 'fixture-one', fetchedAt: start.observedAt } };
    const raw2 = { date: '2026-10-02', before: middle, response: { text: 'fixture-two', fetchedAt: middle.observedAt } };
    const save = (key, scope, status, payload) => db.prepare('INSERT INTO screener_runs VALUES(?,?,?,?,?)')
        .bind(key, scope, status, JSON.stringify(payload), at).run();
    await save('raw1', 'bollinger-source-calibration-raw', 'observed', raw1);
    await save('raw2', 'bollinger-source-calibration-raw', 'observed', raw2);
    await save('end', 'bollinger-source-calibration-usage', 'observed', end);
    const measurements = [];
    for (const [rawId, raw, finish, endObservationId] of [['raw1', raw1, middle, 'raw2'], ['raw2', raw2, end, 'end']]) {
        const proof = { version: 1, rawId, rawHash: hash(raw), date: raw.date, start: raw.before, end: finish,
            endObservationId, attribution: 'non-overlapping-shared-usage-upper-bound', quotaEpochVerified: false };
        const measurement = { evidenceHash: hash(proof), usageBefore: raw.before.usedBytes, usageAfter: finish.usedBytes,
            responseBytes: Buffer.byteLength(raw.response.text), observedAt: finish.observedAt, provider: 'shioaji-daily-quotes' };
        await save(`bollinger-calibration-measurement:${measurement.evidenceHash}`, 'bollinger-source-calibration-measurement', 'observed', { proof, measurement });
        measurements.push(measurement);
    }
    const record = { ...identity, version: 3, quotaEpochVerified: false, validThrough: '2026-10-05T06:00:00.000Z',
        consumerObservationMode: 'baseline-protected-allocation-v1', minimumBaselineAllocationBytes: 1000,
        budgetPolicy: { status: 'verified', evidenceHash: 'a'.repeat(64), validThrough: '2026-10-05T06:00:00.000Z',
            quoteReserveBytes: 5000, otherConsumerJobKeys: ['monitor-baseline-allocation'], estimateMultiplier: 1.5,
            maxEstimatedBytes: 1000, maxRequestsPerWindow: 2, rateWindowMs: 60000, measurements } };
    await save(id, 'fixture', 'verified', record);
    db.exec("INSERT INTO broker_bandwidth_reservations VALUES('old','old-scope','old-epoch','simulation:old','job','owner','charged',1000,0,0,1,'old-hash','2026-10-01','2026-10-01','2026-10-01')");
    const original = JSON.stringify(record), calls = [];
    const options = { db, root: '/fixture', now, validThrough: '2026-10-10T15:59:59.000Z',
        ports: { observeUsage: async () => { calls.push('usage'); return { ...start, usedBytes: 1000, remainingBytes: 999000, observedAt: at }; } },
        observeAllocations: async ({ record, now }) => saveScreenerBrokerCommitment(db, record, {
            version: 1, jobKey: 'monitor-baseline-allocation', scope: record.scope, quotaEpoch: record.quotaEpoch,
            quotaEpochEvidenceHash: record.quotaEpochEvidenceHash, observedAt: now.toISOString(), remainingBytes: 1000,
            state: 'committed', sourceEvidenceHash: 'b'.repeat(64) }, now) };
    return { db, record, original, calls, options, head: () => db.prepare('SELECT checkpoint FROM screener_runs WHERE id=?').bind(id).first(), close: () => db.close() };
}
test('授權複核保存原政策／原實測與舊charged；只更新有限效期，不送來源或清帳', async () => {
    const f = await fixture(); try {
        const result = await reviewScreenerBrokerPolicy(f.options);
        assert.equal(result.state, 'reviewed'); assert.equal(result.estimatedBytes, 150);
        assert.equal(result.retainedEstimatedBytes, 1000); assert.equal(result.protectedBytes, 6000);
        assert.deepEqual(f.calls, ['usage']);
        const next = JSON.parse((await f.head()).checkpoint);
        assert.equal(next.validThrough, f.options.validThrough); assert.equal(next.budgetPolicy.quoteReserveBytes, 5000);
        assert.deepEqual(next.budgetPolicy.measurements, f.record.budgetPolicy.measurements);
        assert.equal(next.quotaEpoch, f.record.quotaEpoch);
        const archive = await f.db.prepare("SELECT checkpoint FROM screener_runs WHERE scope='broker-budget-policy-archive'").first();
        assert.equal(archive.checkpoint, f.original);
        assert.equal((await f.db.prepare("SELECT status FROM broker_bandwidth_reservations WHERE id='old'").first()).status, 'charged');
        await assert.rejects(reviewScreenerBrokerPolicy(f.options), /invalid_broker_policy_review/);
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_runs WHERE scope='broker-budget-policy-review'").first()).n, 1);
    } finally { f.close(); }
});
test('期限超過七日、實測效期、無新效期及原政策已過期均拒絕', async () => {
    for (const validThrough of ['2026-11-04T00:00:00Z', 'invalid', '2026-10-05T06:00:00.000Z']) {
        const f = await fixture(); try {
            await assert.rejects(reviewScreenerBrokerPolicy({ ...f.options, validThrough }), /invalid_broker_policy_review/);
            assert.equal((await f.head()).checkpoint, f.original); assert.equal(f.calls.length, 0);
        } finally { f.close(); }
    }
    const f = await fixture(); try {
        await assert.rejects(reviewScreenerBrokerPolicy({ ...f.options, now: () => new Date('2026-10-06T00:00:00Z') }), /broker_policy_pending/);
        assert.equal(f.calls.length, 0);
    } finally { f.close(); }
});
test('原始校準或實測被篡改，複核拒絕且不先查usage', async () => {
    const f = await fixture(); try {
        await f.db.prepare("UPDATE screener_runs SET checkpoint='{}' WHERE id='raw1'").run();
        await assert.rejects(reviewScreenerBrokerPolicy(f.options), /broker_measurements_pending/);
        assert.equal(f.calls.length, 0); assert.equal((await f.head()).checkpoint, f.original);
    } finally { f.close(); }
});
test('餘額不足或活躍reservation不能延長政策／侵占保護池', async () => {
    for (const condition of ['budget', 'active']) {
        const f = await fixture(); try {
            if (condition === 'active') await f.db.prepare("UPDATE broker_bandwidth_reservations SET status='dispatched' WHERE id='old'").run();
            if (condition === 'budget') f.options.ports.observeUsage = async () => ({ generation: 'simulation:fixture', usedBytes: 995000,
                remainingBytes: 5000, limitBytes: 1000000, observedAt: f.options.now().toISOString() });
            await assert.rejects(reviewScreenerBrokerPolicy(f.options), /broker_policy_review_budget_denied/);
            assert.equal((await f.head()).checkpoint, f.original);
        } finally { f.close(); }
    }
});
test('安全port拒絕不能延長政策', async () => {
    const f = await fixture(); try {
        f.options.ports.observeUsage = async () => { throw new Error('simulation_runtime_pending'); };
        await assert.rejects(reviewScreenerBrokerPolicy(f.options), /simulation_runtime_pending/);
        assert.equal((await f.head()).checkpoint, f.original);
    } finally { f.close(); }
});
test('limit改變或用量觀察過期／未來不能延長政策', async () => {
    for (const condition of ['limit', 'stale', 'future']) {
        const f = await fixture(); try {
            await f.db.prepare('INSERT INTO broker_bandwidth_observations VALUES(?,?,?,?,?,?)')
                .bind('old', 'old', 'simulation:old', 100, 1000000, '2026-10-03T00:00:00Z').run();
            f.options.ports.observeUsage = async () => ({ generation: 'simulation:fixture', usedBytes: 1000,
                limitBytes: condition === 'limit' ? 2000000 : 1000000,
                remainingBytes: condition === 'limit' ? 1999000 : 999000,
                observedAt: condition === 'stale' ? '2026-10-04T03:58:00Z'
                    : condition === 'future' ? '2026-10-04T04:01:00Z' : f.options.now().toISOString() });
            await assert.rejects(reviewScreenerBrokerPolicy(f.options), condition === 'limit' ? /broker_limit_changed/ : /broker_usage_pending/);
            assert.equal((await f.head()).checkpoint, f.original);
            assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_runs WHERE scope='broker-local-counter'").first()).n, 0);
        } finally { f.close(); }
    }
});
test('複核寫入前政策、counter或工作承諾換版，CAS拒絕並保留原件', async () => {
    for (const target of [id, 'counter', 'broker-consumer-commitment:monitor-baseline-allocation']) {
        const f = await fixture(); try {
            const originalBatch = f.db.batch.bind(f.db);
            f.db.batch = async statements => {
                if (statements.some(s => s.sql.includes("'broker-budget-policy-review'"))) {
                    const key = target === 'counter' ? `broker-local-counter:${f.record.quotaEpochEvidenceHash}` : target;
                    await f.db.prepare("UPDATE screener_runs SET checkpoint='{}' WHERE id=?").bind(key).run();
                }
                return originalBatch(statements);
            };
            await assert.rejects(reviewScreenerBrokerPolicy(f.options), /broker_policy_review_raced/);
            assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM screener_runs WHERE scope='broker-budget-policy-review'").first()).n, 0);
            if (target !== id) assert.equal((await f.head()).checkpoint, f.original);
        } finally { f.close(); }
    }
});
