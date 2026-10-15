import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SqliteD1, applyDrizzleSql } from '../../apps/multiview/tests/helpers/sqlite-d1.mjs';
import { classifyBrokerDailyResetWitness } from '../broker-daily-reset-witness.mjs';
import { createLocalVerifiedDailyIdentity } from '../broker-local-verified-reset-ledger.mjs';
import { createInterruptionConservativeAdmission } from './interruption-conservative-admission.mjs';

async function fixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'interruption-admission-'));
    const db = new SqliteD1();
    db.exec('CREATE TABLE screener_runs(id TEXT PRIMARY KEY,scope TEXT,status TEXT,checkpoint TEXT,updated_at TEXT)');
    applyDrizzleSql(db, await readFile(new URL('../../apps/multiview/drizzle/0039_broker_bandwidth_reservations.sql', import.meta.url), 'utf8'));
    const account = 'b'.repeat(64), generation = 'simulation:after-reboot';
    let at = new Date('2026-10-14T09:00:00Z');
    const limit = 524288000;
    const witness = classifyBrokerDailyResetWitness({
        before: { generation: 'simulation:yesterday', usedBytes: 9000, remainingBytes: limit - 9000,
            limitBytes: limit, observedAt: '2026-10-13T15:00:00Z' },
        after: { generation: 'simulation:morning', usedBytes: 100, remainingBytes: limit - 100,
            limitBytes: limit, observedAt: '2026-10-14T00:01:00Z' },
        beforeAccountHash: account, afterAccountHash: account,
        tradingDay: { tradeDate: '2026-10-14', twseTradingDay: true, tpexTradingDay: true,
            officialEvidenceHash: 'c'.repeat(64), verifiedAt: '2026-10-14T00:00:30Z' },
        observedAt: '2026-10-14T00:01:10Z' });
    const identity = createLocalVerifiedDailyIdentity({ previous: { scope: 'a'.repeat(64),
        quotaEpochEvidenceHash: 'd'.repeat(64) }, witness });
    for (const [id, value] of [[`broker-daily-reset-witness:${witness.evidenceHash}`, witness.proof],
        ['broker-local-daily-reset-head', identity]]) {
        await db.prepare("INSERT INTO screener_runs VALUES(?,'fixture','verified',?,?)")
            .bind(id, JSON.stringify(value), at.toISOString()).run();
    }
    await db.prepare('INSERT INTO broker_bandwidth_observations VALUES(?,?,?,?,?,?)')
        .bind(identity.scope, identity.quotaEpoch, 'simulation:before-reboot', 10000, limit, '2026-10-14T07:00:00Z').run();
    const record = { version: 4, scope: identity.scope, quotaEpoch: identity.quotaEpoch,
        quotaEpochEvidenceHash: identity.quotaEpochEvidenceHash, quotaEpochVerified: false,
        dailyIdentityHash: identity.identityHash, validThrough: '2026-10-15T00:00:00Z',
        budgetPolicy: { quoteReserveBytes: 314572800 } };
    await db.prepare("INSERT INTO screener_runs VALUES('screener-bollinger-broker-budget-policy','fixture','verified',?,?)")
        .bind(JSON.stringify(record), at.toISOString()).run();
    let used = 2000, currentAccount = account, currentGeneration = generation;
    const input = { db, root, recoveryRoot: root, generation, now: () => at,
        ports: { observeUsage: async () => ({ generation: currentGeneration, usedBytes: used,
            remainingBytes: limit - used, limitBytes: limit, observedAt: at.toISOString() }) },
        readAccountScope: async () => currentAccount, observeAllocation: async () => {},
        readCommitments: async () => ({ version: 1, status: 'verified', evidenceHash: 'e'.repeat(64),
            validThrough: record.validThrough, commitmentsObservedAt: at.toISOString(),
            quoteReserveBytes: 314572800, otherJobCommitments: [], estimateMultiplier: 1,
            maxEstimatedBytes: 2000, maxRequestsPerWindow: 2, rateWindowMs: 60000,
            measurements: [1, 2].map(i => ({ evidenceHash: String(i).repeat(64),
                usageBefore: 100, usageAfter: 1100, responseBytes: 300,
                observedAt: at.toISOString(), provider: 'shioaji-daily-quotes' })) }) };
    return { db, root, input, identity, generation,
        setUsed: n => { used = n; }, setAccount: v => { currentAccount = v; },
        setGeneration: v => { currentGeneration = v; }, advance: ms => { at = new Date(at.valueOf() + ms); },
        close: async () => { db.close(); await rm(root, { recursive: true, force: true }); } };
}
test('same epoch central admission retains carry, charged history and two-request limit', async () => {
    const f = await fixture();
    try {
        const port = await createInterruptionConservativeAdmission(f.input);
        const first = await port.reserve({ cacheKey: 'monitor-minute-v2:one', generation: f.generation });
        assert.equal(first.allowed, true);
        await port.start(first); await port.settle({ ...first, requested: 1, responseBytes: 20 });
        const second = await port.reserve({ cacheKey: 'monitor-minute-v2:two', generation: f.generation });
        assert.equal(second.allowed, true);
        await port.start(second); await port.settle({ ...second, requested: 1, responseBytes: 20 });
        const third = await port.reserve({ cacheKey: 'monitor-minute-v2:three', generation: f.generation });
        assert.equal(third.allowed, false); assert.equal(third.reason, 'broker_rate_limited');
        assert.equal((await f.db.prepare('SELECT used_bytes FROM broker_bandwidth_observations').first()).used_bytes, 12000);
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM broker_bandwidth_reservations WHERE status='charged'").first()).n, 2);
        const observed = (await f.db.prepare("SELECT payload FROM broker_bandwidth_receipts WHERE status='same_epoch_conservative_usage_observed' LIMIT 1").first()).payload;
        assert.equal(JSON.parse(observed).rawUsedBytes, 2000); assert.equal(JSON.parse(observed).resetsQuota, false);
        // Reopening the same carry cannot reduce usage or multiply the carry.
        f.advance(60001); f.setUsed(3000);
        const reopened = await createInterruptionConservativeAdmission(f.input);
        assert.equal((await reopened.reserve({ cacheKey: 'monitor-minute-v2:four', generation: f.generation })).allowed, true);
        assert.equal((await f.db.prepare('SELECT used_bytes FROM broker_bandwidth_observations').first()).used_bytes, 13000);
    } finally { await f.close(); }
});
for (const kind of ['account', 'generation', 'counter']) test(`rejects changed ${kind} without clearing reservations`, async () => {
    const f = await fixture(); try {
        const port = await createInterruptionConservativeAdmission(f.input);
        const first = await port.reserve({ cacheKey: 'monitor-minute-v2:one', generation: f.generation });
        assert.equal(first.allowed, true);
        if (kind === 'account') f.setAccount('f'.repeat(64));
        if (kind === 'generation') f.setGeneration('simulation:another');
        if (kind === 'counter') f.setUsed(1000);
        const rejected = await port.reserve({ cacheKey: 'monitor-minute-v2:two', generation: f.generation });
        assert.equal(rejected.allowed, false);
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM broker_bandwidth_reservations').first()).n, 1);
        assert.equal((await f.db.prepare('SELECT used_bytes FROM broker_bandwidth_observations').first()).used_bytes, 12000);
    } finally { await f.close(); }
});
