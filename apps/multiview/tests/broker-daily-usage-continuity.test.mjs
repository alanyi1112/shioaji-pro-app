import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { classifyBrokerDailyResetWitness } from '../../../scripts/broker-daily-reset-witness.mjs';
import { createLocalVerifiedDailyIdentity, readLocalVerifiedDailyIdentity,
    localVerifiedDailyUsage, activateDailyUsageContinuity } from '../../../scripts/broker-local-verified-reset-ledger.mjs';
import { createBrokerBandwidthAdmission } from '../../../scripts/broker-bandwidth-reservations.mjs';

const migration = await readFile(new URL('../drizzle/0039_broker_bandwidth_reservations.sql', import.meta.url), 'utf8');
const account = 'b'.repeat(64);
const before = { generation: 'simulation:one', usedBytes: 9000, remainingBytes: 1000,
    limitBytes: 10000, observedAt: '2026-10-05T23:00:00+08:00' };
const after = { generation: 'simulation:two', usedBytes: 100, remainingBytes: 9900,
    limitBytes: 10000, observedAt: '2026-10-06T08:01:00+08:00' };
const witness = classifyBrokerDailyResetWitness({ before, after,
    beforeAccountHash: account, afterAccountHash: account,
    tradingDay: { tradeDate: '2026-10-06', twseTradingDay: true,
        tpexTradingDay: true, officialEvidenceHash: 'c'.repeat(64),
        verifiedAt: '2026-10-06T08:00:30+08:00' },
    observedAt: '2026-10-06T08:01:10+08:00' });

function fixture() {
    const db = new SqliteD1();
    db.exec('CREATE TABLE screener_runs(id TEXT PRIMARY KEY,scope TEXT,status TEXT,checkpoint TEXT,updated_at TEXT)');
    applyDrizzleSql(db, migration);
    const identity = createLocalVerifiedDailyIdentity({ previous: {
        scope: 'a'.repeat(64), quotaEpochEvidenceHash: 'd'.repeat(64) }, witness });
    return { db, identity };
}

async function setup() {
    const f = fixture();
    for (const [id, scope, body] of [
        [`broker-daily-reset-witness:${witness.evidenceHash}`, 'broker-daily-reset-witness', witness.proof],
        ['broker-local-daily-reset-head', 'broker-local-daily-reset', f.identity],
    ]) await f.db.prepare('INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,?,\'verified\',?,?)')
        .bind(id, scope, JSON.stringify(body), after.observedAt).run();
    await localVerifiedDailyUsage(f.db, f.identity, after, account);
    return f;
}
const next = (used = 10, generation = 'simulation:reboot', minute = 2) => ({ ...after,
    usedBytes: used, remainingBytes: after.limitBytes - used, generation,
    observedAt: `2026-10-06T08:${String(minute).padStart(2, '0')}:00+08:00` });
const at = raw => new Date(raw.observedAt);
const activate = (f, raw = next()) => activateDailyUsageContinuity(f.db, f.identity, raw, account, at(raw));
const observe = (f, raw) => localVerifiedDailyUsage(f.db, f.identity, raw, account);

test('正常消費者缺舊帳戶收據時，跨程序計數回退仍阻擋且不寫入', async () => {
    const f = await setup(); try {
        f.db.exec('DELETE FROM broker_bandwidth_receipts');
        const before = f.db.database.prepare('SELECT * FROM broker_bandwidth_observations').all();
        await assert.rejects(observe(f, next()), /nonmonotonic/);
        assert.deepEqual(f.db.database.prepare('SELECT * FROM broker_bandwidth_observations').all(), before);
    } finally { f.db.close(); }
});

test('正常消費者以完整舊帳戶收據自動保守銜接，不要求重啟或清帳', async () => {
    const f = await setup(); try {
        assert.equal((await observe(f, next())).usedBytes, 110);
        assert.equal((await observe(f, next(5, 'simulation:next-boot', 3))).usedBytes, 115);
        assert.equal((await observe(f, next(7, 'simulation:next-boot', 4))).usedBytes, 117);
    } finally { f.db.close(); }
});

test('跨重開機保留舊全額並加入新段全額；後續只加增量、不換額度身分或清帳', async () => {
    const f = await setup(); try {
        const head = JSON.stringify(await readLocalVerifiedDailyIdentity(f.db));
        const first = await activate(f); assert.equal(first.usedBytes, 110);
        const second = await observe(f, next(15, 'simulation:reboot', 3)); assert.equal(second.usedBytes, 115);
        assert.equal((await observe(f, next(15, 'simulation:reboot', 3))).usedBytes, 115);
        const third = await observe(f, next(4, 'simulation:another-reboot', 4)); assert.equal(third.usedBytes, 119);
        assert.equal(third.remainingBytes, 9881); assert.equal(third.quotaEpoch, f.identity.quotaEpoch);
        assert.equal(JSON.stringify(await readLocalVerifiedDailyIdentity(f.db)), head);
        const rows = f.db.database.prepare("SELECT payload FROM broker_bandwidth_receipts WHERE status='daily_usage_observed'").all();
        assert.equal(rows.length, 5); assert.equal(JSON.parse(rows[0].payload).rawUsedBytes, 100);
    } finally { f.db.close(); }
});

test('同程序回退、舊 generation 重播、過期時間與帳戶變更仍阻擋且不改觀察', async () => {
    const f = await setup(); try {
        await activate(f);
        for (const raw of [next(9, 'simulation:reboot', 3), next(110, after.generation, 3), next(11, 'simulation:reboot', 1)])
            await assert.rejects(observe(f, raw), /nonmonotonic/);
        await assert.rejects(localVerifiedDailyUsage(f.db, f.identity, next(), 'e'.repeat(64)), /account_scope_changed/);
        assert.equal(f.db.database.prepare('SELECT used_bytes FROM broker_bandwidth_observations').get().used_bytes, 110);
    } finally { f.db.close(); }
});

test('缺少舊帳戶收據、不同上限、未換程序與非新鮮啟用證據均拒絕', async () => {
    const f = await setup(); try {
        await assert.rejects(activate(f, next(101, after.generation)), /nonmonotonic/);
        await assert.rejects(activate(f, { ...next(), limitBytes: 9000, remainingBytes: 8990 }), /nonmonotonic/);
        await assert.rejects(activateDailyUsageContinuity(f.db, f.identity, next(), account,
            new Date(at(next()).getTime() + 60001)), /usage_pending/);
        f.db.exec('DELETE FROM broker_bandwidth_receipts');
        await assert.rejects(activate(f), /nonmonotonic/);
    } finally { f.db.close(); }
});

test('保守總量超額與 counter 雜湊損壞不得啟用 admission', async () => {
    const f = await setup(); try {
        await assert.rejects(activate(f, next(9950)), /conservative_budget_exhausted/);
        await activate(f);
        f.db.exec("UPDATE screener_runs SET checkpoint='{}' WHERE scope='broker-daily-usage-continuity'");
        await assert.rejects(observe(f, next(12, 'simulation:reboot', 3)), /usage_pending/);
    } finally { f.db.close(); }
});

test('並行讀取以 CAS 單一入帳，輸家不重複寫 receipt 或回退高水位', async () => {
    const f = await setup(); try {
        await activate(f);
        const results = await Promise.allSettled([observe(f, next(15, 'simulation:reboot', 3)),
            observe(f, next(20, 'simulation:reboot', 3))]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        assert.match(results.find(r => r.status === 'rejected').reason.message, /usage_raced/);
        assert.equal(f.db.database.prepare("SELECT COUNT(*) n FROM broker_bandwidth_receipts WHERE status='daily_usage_observed'").get().n, 3);
        const winner = results.find(r => r.status === 'fulfilled').value.usedBytes;
        assert.equal(f.db.database.prepare('SELECT used_bytes FROM broker_bandwidth_observations').get().used_bytes, winner);
    } finally { f.db.close(); }
});

test('實際 admission 保留原 charged／quarantined；保護額度不足照常拒絕', async () => {
    const f = await setup(); try {
        const raw = next(), now = () => at(raw);
        for (const [id, status] of [['old-charge', 'charged'], ['old-unknown', 'quarantined']])
            await f.db.prepare(`INSERT INTO broker_bandwidth_reservations(id,scope,quota_epoch,generation,job_key,owner,status,
                estimated_bytes,usage_before,policy_hash,created_at,lease_until,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
                .bind(id, f.identity.scope, f.identity.quotaEpoch, after.generation, id, 'original', status,
                    2000, 100, 'f'.repeat(64), after.observedAt, after.observedAt, after.observedAt).run();
        const saved = f.db.database.prepare('SELECT * FROM broker_bandwidth_reservations ORDER BY id').all();
        await activate(f);
        const policy = { version: 1, status: 'verified', evidenceHash: 'e'.repeat(64),
            validThrough: '2026-10-06T01:00:00Z', commitmentsObservedAt: raw.observedAt,
            quoteReserveBytes: 5000, otherJobCommitments: [], estimateMultiplier: 1,
            maxEstimatedBytes: 2000, maxRequestsPerWindow: 10, rateWindowMs: 60000,
            measurements: [1, 2].map(i => ({ evidenceHash: String(i).repeat(64), usageBefore: 100,
                usageAfter: 1100, responseBytes: 300, observedAt: raw.observedAt, provider: 'shioaji-daily-quotes' })),
            quotaIdentity: { scope: f.identity.scope, quotaEpoch: f.identity.quotaEpoch,
                quotaEpochEvidenceHash: f.identity.quotaEpochEvidenceHash, identityMode: f.identity.identityMode } };
        const admission = createBrokerBandwidthAdmission({ db: f.db, now, readPolicy: async () => policy,
            readUsage: () => observe(f, raw) });
        const result = await admission.reserve({ cacheKey: 'repair-one', generation: raw.generation });
        assert.equal(result.allowed, false); assert.equal(result.reason, 'broker_budget_or_rate_denied');
        assert.deepEqual(f.db.database.prepare('SELECT * FROM broker_bandwidth_reservations ORDER BY id').all(), saved);
        policy.quoteReserveBytes = 4000;
        const allowed = await admission.reserve({ cacheKey: 'repair-one', generation: raw.generation });
        assert.equal(allowed.allowed, true);
        for (const original of saved) assert.deepEqual(f.db.database.prepare('SELECT * FROM broker_bandwidth_reservations WHERE id=?').get(original.id), original);
        assert.equal(f.db.database.prepare("SELECT SUM(estimated_bytes) n FROM broker_bandwidth_reservations WHERE status<>'released'").get().n, 5000);
    } finally { f.db.close(); }
});

test('原生 SQLite changes 回傳與 D1 meta.changes 均可入帳', async () => {
    const f = await setup(); try {
        const batch = f.db.batch.bind(f.db);
        f.db.batch = async statements => (await batch(statements)).map(result => ({ changes: result.meta.changes }));
        assert.equal((await activate(f)).usedBytes, 110);
        assert.equal((await observe(f, next(12, 'simulation:reboot', 3))).usedBytes, 112);
    } finally { f.db.close(); }
});

test('合法 reset witness 才能切新額度身分；舊 counter 與收據保留且不混入新週期', async () => {
    const f = await setup(); try {
        await activate(f);
        const newAfter = { ...after, generation: 'simulation:reboot', observedAt: '2026-10-07T08:01:00+08:00' };
        const newWitness = classifyBrokerDailyResetWitness({ before: { ...before, observedAt: '2026-10-06T23:00:00+08:00' },
            after: newAfter, beforeAccountHash: account, afterAccountHash: account,
            tradingDay: { tradeDate: '2026-10-07', twseTradingDay: true, tpexTradingDay: true,
                officialEvidenceHash: 'c'.repeat(64), verifiedAt: '2026-10-07T08:00:30+08:00' },
            observedAt: '2026-10-07T08:01:10+08:00' });
        const newIdentity = createLocalVerifiedDailyIdentity({ previous: { ...f.identity, dailyIdentityHash: f.identity.identityHash }, witness: newWitness });
        await f.db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,'broker-daily-reset-witness','verified',?,?)")
            .bind(`broker-daily-reset-witness:${newWitness.evidenceHash}`, JSON.stringify(newWitness.proof), newAfter.observedAt).run();
        await f.db.prepare("UPDATE screener_runs SET checkpoint=? WHERE id='broker-local-daily-reset-head'").bind(JSON.stringify(newIdentity)).run();
        assert.equal((await localVerifiedDailyUsage(f.db, newIdentity, newAfter, account)).usedBytes, 100);
        assert.equal(f.db.database.prepare("SELECT COUNT(*) n FROM screener_runs WHERE scope='broker-daily-usage-continuity'").get().n, 1);
        assert.equal(f.db.database.prepare('SELECT used_bytes FROM broker_bandwidth_observations WHERE quota_epoch=?').get(f.identity.quotaEpoch).used_bytes, 110);
    } finally { f.db.close(); }
});
