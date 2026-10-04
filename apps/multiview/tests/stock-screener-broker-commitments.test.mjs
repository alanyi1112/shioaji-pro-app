import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SqliteD1 } from './helpers/sqlite-d1.mjs';
import { readScreenerBrokerCommitments } from '../../../scripts/stock-screener-broker-commitments.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const at = '2026-10-03T07:00:00Z';
function fixture() {
    const db = new SqliteD1();
    db.exec('CREATE TABLE screener_runs(id TEXT PRIMARY KEY,status TEXT,checkpoint TEXT)');
    const record = { version: 2, scope: 'a'.repeat(64), quotaEpoch: 'fixture-epoch', quotaEpochEvidenceHash: 'b'.repeat(64),
        budgetPolicy: { status: 'verified', evidenceHash: 'c'.repeat(64), validThrough: '2026-10-04T07:00:00Z',
            quoteReserveBytes: 5000, otherConsumerJobKeys: ['fixture-baseline', 'fixture-other'],
            estimateMultiplier: 2, maxEstimatedBytes: 3000, maxRequestsPerWindow: 3, rateWindowMs: 60000,
            measurements: [1, 2].map(i => ({ evidenceHash: String(i).repeat(64), usageBefore: 100, usageAfter: 1100,
                responseBytes: 300, observedAt: at, provider: 'shioaji-daily-quotes' })) } };
    const save = async (jobKey, overrides = {}, status = 'verified') => {
        const proof = { version: 1, jobKey, scope: record.scope, quotaEpoch: record.quotaEpoch,
            quotaEpochEvidenceHash: record.quotaEpochEvidenceHash, observedAt: at, remainingBytes: 1000,
            state: 'committed', sourceEvidenceHash: 'd'.repeat(64), ...overrides };
        await db.prepare('INSERT INTO screener_runs(id,status,checkpoint) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,checkpoint=excluded.checkpoint')
            .bind(`broker-consumer-commitment:${jobKey}`, status, JSON.stringify({ ...proof, evidenceHash: hash(proof) })).run();
    };
    const read = (now = new Date(at)) => readScreenerBrokerCommitments(db, record, now);
    return { db, record, save, read };
}

test('完整 roster 逐工作核對；使用最舊實際觀察時間，不虛填現在時間', async () => {
    const f = fixture(); try {
        await f.save('fixture-baseline'); await f.save('fixture-other', { observedAt: '2026-10-03T06:59:30Z' });
        const p = await f.read();
        assert.equal(p.commitmentsObservedAt, '2026-10-03T06:59:30.000Z');
        assert.deepEqual(p.otherJobCommitments, [{ jobKey: 'fixture-baseline', bytes: 1000 }, { jobKey: 'fixture-other', bytes: 1000 }]);
        assert.equal(p.quoteReserveBytes, 5000);
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_runs').first()).n, 2);
    } finally { f.db.close(); }
});
test('缺工作／空 roster／重複 roster／靜態冒充動態承諾，不把未知當零', async () => {
    const f = fixture(); try {
        await f.save('fixture-baseline'); await assert.rejects(f.read(), /broker_policy_pending/);
        await f.save('fixture-other');
        for (const keys of [[], ['fixture-baseline', 'fixture-baseline'], ['bad name']]) {
            f.record.budgetPolicy.otherConsumerJobKeys = keys;
            await assert.rejects(f.read(), /broker_policy_pending/);
        }
        f.record.budgetPolicy.otherConsumerJobKeys = ['fixture-baseline'];
        f.record.budgetPolicy.otherJobCommitments = [];
        await assert.rejects(f.read(), /broker_policy_pending/);
    } finally { f.db.close(); }
});
test('工作未驗證／觀察過期或未來／scope或quota不一致／非整數，不產生可用政策', async () => {
    const f = fixture(); try {
        await f.save('fixture-baseline');
        for (const override of [{ observedAt: '2026-10-03T06:58:59Z' }, { observedAt: '2026-10-03T07:00:01Z' },
            { scope: 'x'.repeat(64) }, { quotaEpoch: 'other-epoch' }, { quotaEpochEvidenceHash: 'f'.repeat(64) },
            { remainingBytes: -1 }, { remainingBytes: 1.5 }, { state: 'unknown' }, { sourceEvidenceHash: '' }]) {
            await f.save('fixture-other', override); await assert.rejects(f.read(), /broker_policy_pending/);
        }
        await f.save('fixture-other', {}, 'pending'); await assert.rejects(f.read(), /broker_policy_pending/);
    } finally { f.db.close(); }
});
test('complete 必須有同身份的實際零承諾證據；有剩餘額度不能假稱完成', async () => {
    const f = fixture(); try {
        await f.save('fixture-baseline'); await f.save('fixture-other', { state: 'complete' });
        await assert.rejects(f.read(), /broker_policy_pending/);
        await f.save('fixture-other', { state: 'complete', remainingBytes: 0 });
        assert.equal((await f.read()).otherJobCommitments[1].bytes, 0);
    } finally { f.db.close(); }
});
test('重新觀察相同條款 fingerprint 穩定；承諾或來源證據更新必須換版', async () => {
    const f = fixture(); try {
        await f.save('fixture-baseline'); await f.save('fixture-other');
        const before = await f.read();
        await f.save('fixture-other', { observedAt: '2026-10-03T07:00:00.007Z' });
        const observed = await f.read(new Date('2026-10-03T07:00:00.007Z'));
        assert.equal(observed.evidenceHash, before.evidenceHash);
        await f.save('fixture-other', { remainingBytes: 1100 });
        assert.notEqual((await f.read()).evidenceHash, before.evidenceHash);
        await f.save('fixture-other', { sourceEvidenceHash: 'e'.repeat(64) });
        assert.notEqual((await f.read()).evidenceHash, before.evidenceHash);
    } finally { f.db.close(); }
});
test('receipt payload 被手改，不能只憑 verified 狀態採用；既有 rows 保留', async () => {
    const f = fixture(); try {
        await f.save('fixture-baseline'); await f.save('fixture-other');
        const row = await f.db.prepare('SELECT checkpoint FROM screener_runs WHERE id=?').bind('broker-consumer-commitment:fixture-other').first();
        const e = JSON.parse(row.checkpoint); e.remainingBytes = 0;
        await f.db.prepare('UPDATE screener_runs SET checkpoint=? WHERE id=?').bind(JSON.stringify(e), 'broker-consumer-commitment:fixture-other').run();
        await assert.rejects(f.read(), /broker_policy_pending/);
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_runs').first()).n, 2);
    } finally { f.db.close(); }
});
