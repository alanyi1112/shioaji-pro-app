import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { initializeLocalConservativeIdentity, readLocalConservativeIdentity, localConservativeUsage } from '../../../scripts/broker-local-conservative-ledger.mjs';
import { createBrokerBandwidthAdmission } from '../../../scripts/broker-bandwidth-reservations.mjs';

const migration = await readFile(new URL('../drizzle/0039_broker_bandwidth_reservations.sql', import.meta.url), 'utf8');
function fixture() {
    const db = new SqliteD1();
    db.exec('CREATE TABLE screener_runs(id TEXT PRIMARY KEY,scope TEXT,status TEXT,checkpoint TEXT,updated_at TEXT)');
    applyDrizzleSql(db, migration);
    let time = Date.parse('2026-10-03T15:00:00Z');
    const now = () => new Date(time);
    const raw = { generation: 'simulation:fixture', usedBytes: 1000, remainingBytes: 9000, limitBytes: 10000 };
    const policy = { version: 1, status: 'verified', evidenceHash: 'c'.repeat(64), validThrough: '2026-10-06T00:00:00Z',
        quoteReserveBytes: 5000, otherJobCommitments: [{ jobKey: 'monitor', bytes: 1000 }],
        estimateMultiplier: 2, maxEstimatedBytes: 3000, maxRequestsPerWindow: 3, rateWindowMs: 60000,
        measurements: [1,2].map(i => ({ evidenceHash: String(i).repeat(64), usageBefore: 100, usageAfter: 1100,
            responseBytes: 300, observedAt: now().toISOString(), provider: 'shioaji-daily-quotes' })) };
    return { db, raw, now, policy, advance: ms => { time += ms; } };
}
test('本機身份只建立一次，換日或重建port不產生來源額度週期', async () => {
    const f = fixture(); try {
        const first = await initializeLocalConservativeIdentity(f.db, f.now()); f.advance(86400000);
        assert.deepEqual(await initializeLocalConservativeIdentity(f.db, f.now()), first);
        assert.equal(first.identityMode, 'local-conservative-v1');
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_runs').first()).n, 1);
    } finally { f.db.close(); }
});
test('真實計數下降／換generation，仍使用持久高水位；原始與保守值分列', async () => {
    const f = fixture(); try {
        const identity = await initializeLocalConservativeIdentity(f.db, f.now());
        const observe = () => localConservativeUsage(f.db, identity, { ...f.raw, observedAt: f.now().toISOString() });
        assert.equal((await observe()).usedBytes, 1000);
        f.advance(1); f.raw.usedBytes = 1500; f.raw.remainingBytes = 8500; await observe();
        f.advance(86400000); f.raw.generation = 'simulation:new'; f.raw.usedBytes = 10; f.raw.remainingBytes = 9990;
        const result = await observe(); assert.equal(result.usedBytes, 1500); assert.equal(result.remainingBytes, 8500);
        assert.equal(result.quotaEpochVerified, false);
        const receipt = await f.db.prepare("SELECT payload FROM broker_bandwidth_receipts WHERE status='local_usage_observed' ORDER BY created_at DESC LIMIT 1").first();
        assert.equal(JSON.parse(receipt.payload).rawUsedBytes, 10);
        assert.equal(JSON.parse(receipt.payload).conservativeUsedBytes, 1500);
        f.advance(1); f.raw.usedBytes = 110; f.raw.remainingBytes = 9890;
        assert.equal((await observe()).usedBytes, 1600); // 新段的 100 bytes 亦扣入，不能一直躲在舊高水位下。
    } finally { f.db.close(); }
});
test('原scope／epoch已耗預留仍計入，換本機身份不得忽略舊債', async () => {
    const f = fixture(); try {
        await f.db.prepare(`INSERT INTO broker_bandwidth_reservations(id,scope,quota_epoch,generation,job_key,owner,status,
            estimated_bytes,usage_before,policy_hash,created_at,lease_until,updated_at) VALUES(?,?,?,?,?,?,'charged',?,?,?,?,?,?)`)
            .bind('old', 'a'.repeat(64), 'old-epoch', 'old-generation', 'old-job', 'old-owner', 2000, 0, 'b'.repeat(64),
                f.now().toISOString(), f.now().toISOString(), f.now().toISOString()).run();
        const identity = await initializeLocalConservativeIdentity(f.db, f.now());
        const port = createBrokerBandwidthAdmission({ db: f.db, now: f.now,
            readPolicy: async () => ({ ...f.policy, commitmentsObservedAt: f.now().toISOString(), quotaIdentity: identity }),
            readUsage: () => localConservativeUsage(f.db, identity, { ...f.raw, observedAt: f.now().toISOString() }) });
        const r = await port.reserve({ cacheKey: 'new-job', generation: f.raw.generation });
        assert.equal(r.allowed, false); // 9000 - 6000 - 2000 < 2000
        assert.equal((await f.db.prepare("SELECT status FROM broker_bandwidth_reservations WHERE id='old'").first()).status, 'charged');
    } finally { f.db.close(); }
});
test('有效本機帳本可reserve/dispatch/settle，延遲扣量仍持續扣住estimate', async () => {
    const f = fixture(); try {
        const identity = await initializeLocalConservativeIdentity(f.db, f.now());
        const options = { db: f.db, now: f.now, readPolicy: async () => ({ ...f.policy, commitmentsObservedAt: f.now().toISOString(), quotaIdentity: identity }),
            readUsage: () => localConservativeUsage(f.db, identity, { ...f.raw, observedAt: f.now().toISOString() }) };
        const port = createBrokerBandwidthAdmission(options);
        const r = await port.reserve({ cacheKey: 'job', generation: f.raw.generation }); assert.equal(r.allowed, true);
        await port.start(r); await port.settle({ ...r, requested: 1, responseBytes: 300 });
        const row = await f.db.prepare('SELECT status,estimated_bytes FROM broker_bandwidth_reservations').first();
        assert.equal(row.status, 'charged'); assert.equal(row.estimated_bytes, 2000);
        f.advance(86400000); f.raw.usedBytes = 0; f.raw.remainingBytes = 10000;
        const rebuilt = createBrokerBandwidthAdmission(options);
        assert.equal((await rebuilt.reserve({ cacheKey: 'next', generation: f.raw.generation })).allowed, false);
    } finally { f.db.close(); }
});
test('本機錨點破損或limit變動fail closed，不自動重建清債', async () => {
    const f = fixture(); try {
        const identity = await initializeLocalConservativeIdentity(f.db, f.now());
        await localConservativeUsage(f.db, identity, { ...f.raw, observedAt: f.now().toISOString() });
        await assert.rejects(localConservativeUsage(f.db, identity, { ...f.raw, limitBytes: 20000, remainingBytes: 19000,
            observedAt: f.now().toISOString() }), /broker_limit_changed/);
        await f.db.prepare("UPDATE screener_runs SET checkpoint='{}' WHERE id='broker-local-conservative-anchor'").run();
        await assert.rejects(readLocalConservativeIdentity(f.db), /broker_local_identity_pending/);
        await assert.rejects(initializeLocalConservativeIdentity(f.db, f.now()), /broker_local_identity_pending/);
    } finally { f.db.close(); }
});
test('計數head版本或時間破損不自動覆寫，不發布虛假的usage觀察', async () => {
    for (const change of [{version:2}, {observedAt:'invalid'}, {conservativeUsedBytes:10001}]) {
        const f = fixture(); try {
            const identity = await initializeLocalConservativeIdentity(f.db, f.now());
            await localConservativeUsage(f.db, identity, {...f.raw,observedAt:f.now().toISOString()});
            const id = `broker-local-counter:${identity.quotaEpochEvidenceHash}`;
            const row = await f.db.prepare('SELECT checkpoint FROM screener_runs WHERE id=?').bind(id).first();
            const broken = JSON.stringify({...JSON.parse(row.checkpoint),...change});
            await f.db.prepare('UPDATE screener_runs SET checkpoint=? WHERE id=?').bind(broken,id).run();
            const before = (await f.db.prepare('SELECT COUNT(*) n FROM broker_bandwidth_receipts').first()).n;
            await assert.rejects(localConservativeUsage(f.db, identity, {...f.raw,observedAt:f.now().toISOString()}), /broker_usage_pending/);
            assert.equal((await f.db.prepare('SELECT checkpoint FROM screener_runs WHERE id=?').bind(id).first()).checkpoint,broken);
            assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM broker_bandwidth_receipts').first()).n,before);
        } finally {f.db.close();}
    }
});
