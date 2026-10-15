import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { classifyBrokerDailyResetWitness } from '../../../scripts/broker-daily-reset-witness.mjs';
import { createLocalVerifiedDailyIdentity, readLocalVerifiedDailyIdentity,
    localVerifiedDailyUsage } from '../../../scripts/broker-local-verified-reset-ledger.mjs';
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

test('新週期身分是候選證據的確定性衍生，不含原始帳號', () => {
    const { db, identity } = fixture(); try {
        assert.equal(identity.quotaEpoch, 'local-daily:2026-10-06');
        assert.equal(identity.quotaEpochEvidenceHash, witness.evidenceHash);
        assert.equal(identity.accountScopeHash, account);
        assert.equal(JSON.stringify(identity).includes('1234567'), false);
    } finally { db.close(); }
});

test('新週期只以同一帳戶且當期單調來源用量計帳，不刪舊週期觀察', async () => {
    const { db, identity } = fixture(); try {
        await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
            VALUES(?,'broker-daily-reset-witness','verified',?,?)`)
            .bind(`broker-daily-reset-witness:${witness.evidenceHash}`,
                JSON.stringify(witness.proof), after.observedAt).run();
        await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
            VALUES('broker-local-daily-reset-head','broker-local-daily-reset','verified',?,?)`)
            .bind(JSON.stringify(identity), after.observedAt).run();
        await db.prepare(`INSERT INTO broker_bandwidth_observations(scope,quota_epoch,generation,used_bytes,limit_bytes,observed_at)
            VALUES(?,?,?,?,?,?)`).bind('a'.repeat(64), 'local:old', before.generation,
            before.usedBytes, before.limitBytes, before.observedAt).run();
        assert.equal((await readLocalVerifiedDailyIdentity(db)).quotaEpoch, identity.quotaEpoch);
        const observed = await localVerifiedDailyUsage(db, identity, after, account);
        assert.equal(observed.usedBytes, 100);
        assert.equal(observed.remainingBytes, 9900);
        assert.equal(observed.quotaEpochVerified, false);
        assert.equal((await db.prepare('SELECT COUNT(*) n FROM broker_bandwidth_observations').first()).n, 2);
        await assert.rejects(localVerifiedDailyUsage(db, identity, after, 'e'.repeat(64)),
            /broker_daily_account_scope_changed/);
        await assert.rejects(localVerifiedDailyUsage(db, identity, { ...after,
            usedBytes: 99, remainingBytes: 9901,
            observedAt: '2026-10-06T08:02:00+08:00' }, account), /broker_daily_usage_nonmonotonic/);
    } finally { db.close(); }
});

test('有效新週期 admission 只計本週期預留，舊 charged 仍完整保留', async () => {
    const { db, identity } = fixture(); try {
        const at = new Date('2026-10-06T00:01:20Z');
        await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
            VALUES(?,'broker-daily-reset-witness','verified',?,?)`)
            .bind(`broker-daily-reset-witness:${witness.evidenceHash}`,
                JSON.stringify(witness.proof), at.toISOString()).run();
        await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
            VALUES('broker-local-daily-reset-head','broker-local-daily-reset','verified',?,?)`)
            .bind(JSON.stringify(identity), at.toISOString()).run();
        await db.prepare(`INSERT INTO broker_bandwidth_reservations(id,scope,quota_epoch,generation,job_key,owner,status,
            estimated_bytes,usage_before,policy_hash,created_at,lease_until,updated_at)
            VALUES(?,?,?,?,?,?,'charged',?,?,?,?,?,?)`)
            .bind('prior-charge', identity.scope, 'local:old', before.generation, 'old-job', 'old-owner',
                2000, before.usedBytes, 'f'.repeat(64), before.observedAt,
                before.observedAt, before.observedAt).run();
        const policy = { version: 1, status: 'verified', evidenceHash: 'e'.repeat(64),
            validThrough: '2026-10-06T01:00:00Z', commitmentsObservedAt: at.toISOString(),
            quoteReserveBytes: 5000, otherJobCommitments: [{ jobKey: 'monitor', bytes: 1000 }],
            estimateMultiplier: 1, maxEstimatedBytes: 2000,
            maxRequestsPerWindow: 2, rateWindowMs: 60000,
            measurements: [1, 2].map(i => ({ evidenceHash: String(i).repeat(64),
                usageBefore: 100, usageAfter: 1100, responseBytes: 300,
                observedAt: at.toISOString(), provider: 'shioaji-daily-quotes' })),
            quotaIdentity: { scope: identity.scope, quotaEpoch: identity.quotaEpoch,
                quotaEpochEvidenceHash: identity.quotaEpochEvidenceHash,
                identityMode: identity.identityMode } };
        const port = createBrokerBandwidthAdmission({ db, now: () => at,
            readPolicy: async () => policy,
            readUsage: () => localVerifiedDailyUsage(db, identity,
                { ...after, observedAt: at.toISOString() }, account) });
        const reservation = await port.reserve({ cacheKey: 'new-day-job', generation: after.generation });
        assert.equal(reservation.allowed, true);
        assert.equal((await db.prepare("SELECT status FROM broker_bandwidth_reservations WHERE id='prior-charge'").first()).status,
            'charged');
        assert.equal((await db.prepare('SELECT COUNT(*) n FROM broker_bandwidth_reservations').first()).n, 2);
    } finally { db.close(); }
});
