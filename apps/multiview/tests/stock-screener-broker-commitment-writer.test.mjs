import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SqliteD1 } from './helpers/sqlite-d1.mjs';
import { readScreenerBrokerCommitments, saveScreenerBrokerCommitment } from '../../../scripts/stock-screener-broker-commitments.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const at = '2026-10-03T13:00:00.000Z';
function fixture() {
    const db = new SqliteD1();
    db.exec('CREATE TABLE screener_runs(id TEXT PRIMARY KEY,scope TEXT NOT NULL,status TEXT NOT NULL,checkpoint TEXT NOT NULL,updated_at TEXT NOT NULL)');
    const record = { version: 2, scope: 'a'.repeat(64), quotaEpoch: 'fixture-epoch', quotaEpochEvidenceHash: 'b'.repeat(64),
        quotaEpochVerified: true, validThrough: '2026-10-04T13:00:00Z',
        budgetPolicy: { status: 'verified', evidenceHash: 'c'.repeat(64), validThrough: '2026-10-04T13:00:00Z',
            quoteReserveBytes: 5000, otherConsumerJobKeys: ['fixture-baseline'], estimateMultiplier: 2,
            maxEstimatedBytes: 3000, maxRequestsPerWindow: 3, rateWindowMs: 60000,
            measurements: [1, 2].map(i => ({ evidenceHash: String(i).repeat(64), usageBefore: 100, usageAfter: 1100,
                responseBytes: 300, observedAt: at, provider: 'shioaji-daily-quotes' })) } };
    db.database.prepare('INSERT INTO screener_runs VALUES(?,?,?,?,?)').run('screener-bollinger-broker-budget-policy',
        'fixture', 'verified', JSON.stringify(record), at);
    const proof = overrides => ({ version: 1, jobKey: 'fixture-baseline', scope: record.scope,
        quotaEpoch: record.quotaEpoch, quotaEpochEvidenceHash: record.quotaEpochEvidenceHash,
        observedAt: at, remainingBytes: 1000, state: 'committed', sourceEvidenceHash: 'd'.repeat(64), ...overrides });
    const save = (overrides = {}, now = new Date(at)) => saveScreenerBrokerCommitment(db, record, proof(overrides), now);
    const head = () => db.prepare('SELECT checkpoint FROM screener_runs WHERE id=?').bind('broker-consumer-commitment:fixture-baseline').first();
    const count = async () => (await db.prepare("SELECT COUNT(*) n FROM screener_runs WHERE scope='broker-consumer-observation'").first()).n;
    return { db, record, proof, save, head, count };
}

test('寫入 immutable receipt 與唯讀 head；精確重跑 no-op，不刷新 observedAt', async () => {
    const f = fixture(); try {
        const first = await f.save(); const head = await f.head();
        assert.equal(first.state, 'saved'); assert.equal(JSON.parse(head.checkpoint).version, 2);
        assert.equal((await readScreenerBrokerCommitments(f.db, f.record, new Date(at))).commitmentsObservedAt, at);
        assert.equal((await f.save()).state, 'unchanged'); assert.deepEqual(await f.head(), head);
        assert.equal(await f.count(), 1);
        await assert.rejects(f.save({}, new Date('2026-10-03T13:01:01Z')), /invalid_broker_commitment/);
        assert.equal(await f.count(), 1);
    } finally { f.db.close(); }
});
test('合法更新保留原始 observation；過期或未來／未登錄／未知／錯誤身份／機密欄位拒絕且零寫入', async () => {
    const f = fixture(); try {
        for (const change of [{ observedAt: '2026-10-03T12:58:59Z' }, { observedAt: '2026-10-03T13:00:01Z' },
            { jobKey: 'not-registered' }, { state: 'unknown' }, { remainingBytes: -1 }, { remainingBytes: 1.1 },
            { scope: 'f'.repeat(64) }, { quotaEpoch: 'wrong' }, { sourceEvidenceHash: '' },
            { state: 'complete' }, { apiKey: '[REDACTED_SECRET]' }]) {
            await assert.rejects(f.save(change), /invalid_broker_commitment/);
        }
        assert.equal(await f.count(), 0);
        const first = await f.save();
        await f.save({ observedAt: '2026-10-03T13:00:01.000Z', remainingBytes: 0, state: 'complete' }, new Date('2026-10-03T13:00:01Z'));
        const old = await f.db.prepare('SELECT checkpoint FROM screener_runs WHERE id=?').bind(first.receiptId).first();
        assert.equal(JSON.parse(old.checkpoint).remainingBytes, 1000);
        assert.equal(await f.count(), 2);
        assert.equal((await readScreenerBrokerCommitments(f.db, f.record, new Date('2026-10-03T13:00:01Z'))).otherJobCommitments[0].bytes, 0);
    } finally { f.db.close(); }
});
test('配置中途換版／未驗證，拒絕寫工作 receipt，不把傳入配置當正式配置', async () => {
    const f = fixture(); try {
        f.record.quotaEpoch = 'changed';
        await assert.rejects(f.save(), /broker_policy_changed/);
        assert.equal(await f.count(), 0);
        f.record.quotaEpoch = 'fixture-epoch';
        await f.db.prepare("UPDATE screener_runs SET status='pending' WHERE id='screener-bollinger-broker-budget-policy'").run();
        await assert.rejects(f.save(), /broker_policy_pending/);
        assert.equal(await f.count(), 0);
    } finally { f.db.close(); }
});
test('讀配置後 transaction 前被改版，零新增 observation／head，不刷新舊證據', async () => {
    const f = fixture(); try {
        const batch = f.db.batch.bind(f.db);
        f.db.batch = async statements => {
            await f.db.prepare("UPDATE screener_runs SET status='pending' WHERE id='screener-bollinger-broker-budget-policy'").run();
            return batch(statements);
        };
        await assert.rejects(f.save(), /broker_commitment_changed/);
        assert.equal(await f.count(), 0); assert.equal(await f.head(), null);
    } finally { f.db.close(); }
});
test('既有 v1 observation 轉 v2 head 時先另存原 payload，不能抹掉舊承諾', async () => {
    const f = fixture(); try {
        const proof = f.proof(), prior = { ...proof, evidenceHash: sha(proof) };
        await f.db.prepare('INSERT INTO screener_runs VALUES(?,?,?,?,?)').bind('broker-consumer-commitment:fixture-baseline',
            'fixture', 'verified', JSON.stringify(prior), at).run();
        const t = new Date('2026-10-03T13:00:01Z');
        await f.save({ observedAt: t.toISOString(), remainingBytes: 900 }, t);
        const saved = await f.db.prepare('SELECT checkpoint FROM screener_runs WHERE id=?').bind(`broker-consumer-observation:${prior.evidenceHash}`).first();
        assert.equal(saved.checkpoint, JSON.stringify(prior)); assert.equal(await f.count(), 2);
        assert.equal((await readScreenerBrokerCommitments(f.db, f.record, t)).otherJobCommitments[0].bytes, 900);
    } finally { f.db.close(); }
});
test('兩個 writer 同時首次建立 head，不能因不存在舊 checkpoint 而相互覆蓋', async () => {
    const f = fixture(); try {
        const results = await Promise.allSettled([f.save(), f.save({ remainingBytes: 900 })]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        assert.match(results.find(r => r.status === 'rejected').reason.message, /broker_commitment_changed/);
        assert.equal(await f.count(), 2);
        assert.equal((await readScreenerBrokerCommitments(f.db, f.record, new Date(at))).otherJobCommitments[0].bytes, 1000);
    } finally { f.db.close(); }
});
test('既有 v1 原觀察的 archive 鍵已被破壞，不能覆蓋唯一仍完整的舊 head', async () => {
    const f = fixture(); try {
        const proof = f.proof(), prior = { ...proof, evidenceHash: sha(proof) };
        await f.db.prepare('INSERT INTO screener_runs VALUES(?,?,?,?,?)').bind('broker-consumer-commitment:fixture-baseline',
            'fixture', 'verified', JSON.stringify(prior), at).run();
        await f.db.prepare('INSERT INTO screener_runs VALUES(?,?,?,?,?)').bind(`broker-consumer-observation:${prior.evidenceHash}`,
            'broker-consumer-observation', 'verified', '{}', at).run();
        const before = await f.head(), t = new Date('2026-10-03T13:00:01Z');
        await assert.rejects(f.save({ observedAt: t.toISOString(), remainingBytes: 900 }, t), /broker_commitment_changed/);
        assert.deepEqual(await f.head(), before);
        assert.equal((await readScreenerBrokerCommitments(f.db, f.record, t)).otherJobCommitments[0].bytes, 1000);
    } finally { f.db.close(); }
});
test('pointer 仍在但 journal 缺席，producer 與 writer 都拒絕，不依 pointer 假稱驗證', async () => {
    const f = fixture(); try {
        const first = await f.save();
        await f.db.prepare('DELETE FROM screener_runs WHERE id=?').bind(first.receiptId).run();
        await assert.rejects(readScreenerBrokerCommitments(f.db, f.record, new Date(at)), /broker_policy_pending/);
        await assert.rejects(f.save(), /broker_policy_pending/);
        assert.equal(await f.count(), 0);
    } finally { f.db.close(); }
});
test('同時競爭以 CAS 只更新一次 head；另一份 observation 保留但不能覆蓋勝者', async () => {
    const f = fixture(); try {
        await f.save();
        const t = new Date('2026-10-03T13:00:01Z');
        const results = await Promise.allSettled([f.save({ observedAt: t.toISOString(), remainingBytes: 900 }, t),
            f.save({ observedAt: t.toISOString(), remainingBytes: 800 }, t)]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        assert.match(results.find(r => r.status === 'rejected').reason.message, /broker_commitment_changed/);
        assert.equal(await f.count(), 3);
        assert.equal((await readScreenerBrokerCommitments(f.db, f.record, t)).otherJobCommitments[0].bytes, 900);
    } finally { f.db.close(); }
});
test('不接受倒退／相同時間不同觀察，也不以壞掉或遺失的 immutable receipt 當可信 head', async () => {
    const f = fixture(); try {
        const first = await f.save();
        await assert.rejects(f.save({ observedAt: '2026-10-03T12:59:59Z' }), /broker_commitment_changed/);
        await assert.rejects(f.save({ remainingBytes: 900 }), /broker_commitment_changed/);
        assert.equal(await f.count(), 1);
        await f.db.prepare('UPDATE screener_runs SET checkpoint=? WHERE id=?').bind(JSON.stringify({ ...f.proof(), evidenceHash: sha(f.proof()), remainingBytes: 0 }), first.receiptId).run();
        await assert.rejects(readScreenerBrokerCommitments(f.db, f.record, new Date(at)), /broker_policy_pending/);
        await assert.rejects(f.save(), /broker_policy_pending/);
    } finally { f.db.close(); }
});
