import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { createBrokerBandwidthAdmission, validateBrokerBudgetPolicy } from '../../../scripts/broker-bandwidth-reservations.mjs';

const migration = await readFile(new URL('../drizzle/0039_broker_bandwidth_reservations.sql', import.meta.url), 'utf8');
const at = '2026-10-03T07:00:00Z';
function fixture() {
    const db = new SqliteD1(); applyDrizzleSql(db, migration); let time = Date.parse(at);
    const now = () => new Date(time);
    const usage = { scope: 'a'.repeat(64), quotaEpoch: 'fixture-quota-epoch', quotaEpochVerified: true,
        quotaEpochEvidenceHash: 'b'.repeat(64), generation: 'fixture-generation', observedAt: at,
        usedBytes: 100, limitBytes: 10000, remainingBytes: 9900 };
    const policy = { version: 1, status: 'verified', evidenceHash: 'c'.repeat(64), commitmentsObservedAt: at,
        validThrough: '2026-10-04T07:00:00Z', quoteReserveBytes: 5000,
        otherJobCommitments: [{ jobKey: 'fixture-monitor', bytes: 1000 }], estimateMultiplier: 2,
        maxEstimatedBytes: 5000, maxRequestsPerWindow: 3, rateWindowMs: 60000,
        measurements: [1,2].map(i => ({ evidenceHash: String(i).repeat(64), usageBefore: 100, usageAfter: 1100,
            responseBytes: 300, observedAt: at, provider: 'shioaji-daily-quotes' })) };
    const options = { db, readUsage: async () => ({ ...usage, observedAt: now().toISOString() }),
        readPolicy: async () => ({ ...policy, commitmentsObservedAt: now().toISOString() }), now };
    const port = createBrokerBandwidthAdmission(options);
    return { db, port, options, policy, usage, now, advance: ms => { time += ms; },
        reserve: (job = 'fixture-job') => port.reserve({ cacheKey: job, generation: usage.generation }) };
}
test('依實測估量與可調保留額度 admission，不是固定剩餘 bytes 啟動門檻', async () => {
    const f = fixture(); try {
        assert(validateBrokerBudgetPolicy(f.policy, f.now()));
        const r = await f.reserve(); assert.equal(r.allowed, true); assert.equal(r.estimatedBytes, 2000);
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM broker_bandwidth_receipts').first()).n, 1);
        f.policy.quoteReserveBytes = 8000; assert.equal((await f.reserve('second')).allowed, false);
    } finally { f.db.close(); }
});
test('不同 port 並行保留不得超賣，其他工作承諾額度持續扣住', async () => {
    const f = fixture(); try {
        const other = createBrokerBandwidthAdmission(f.options);
        const r = await Promise.all([f.reserve('one'), other.reserve({ cacheKey: 'two', generation: f.usage.generation })]);
        assert.equal(r.filter(r => r.allowed).length, 1);
    } finally { f.db.close(); }
});
test('同工作／日租約 single flight', async () => {
    const f = fixture(); try { assert.equal((await f.reserve()).allowed, true); assert.equal((await f.reserve()).allowed, false); }
    finally { f.db.close(); }
});
test('未配置政策、缺實測、重複證據、承諾未知或過期都拒絕', async () => {
    const f = fixture(); try {
        for (const p of [null, { ...f.policy, measurements: [] }, { ...f.policy, measurements: [f.policy.measurements[0], f.policy.measurements[0]] },
            { ...f.policy, otherJobCommitments: null }, { ...f.policy, validThrough: at }, { ...f.policy, estimateMultiplier: Infinity }]) {
            const port = createBrokerBandwidthAdmission({ ...f.options, readPolicy: async () => p });
            assert.equal((await port.reserve({ cacheKey: 'one', generation: f.usage.generation })).allowed, false);
        }
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM broker_bandwidth_reservations').first()).n, 0);
    } finally { f.db.close(); }
});
test('usage 破損／過期／generation 改變／未驗 quota epoch 不能保留', async () => {
    const f = fixture(); try {
        for (const p of [{ remainingBytes: 1 }, { generation: 'other' }, { quotaEpochVerified: false },
            { observedAt: '2026-10-03T06:00:00Z' }, { usedBytes: NaN }]) {
            const port = createBrokerBandwidthAdmission({ ...f.options, readUsage: async () => ({ ...f.usage, ...p }) });
            assert.equal((await port.reserve({ cacheKey: 'one', generation: f.usage.generation })).allowed, false);
        }
    } finally { f.db.close(); }
});
test('usage 同 epoch 回退／limit 改變不會清債或放行', async () => {
    const f = fixture(); try {
        await f.reserve('one'); f.policy.quoteReserveBytes = 0; f.policy.otherJobCommitments = [];
        f.usage.usedBytes = 0; f.usage.remainingBytes = 10000; assert.equal((await f.reserve('two')).allowed, false);
        f.usage.usedBytes = 100; f.usage.limitBytes = 20000; f.usage.remainingBytes = 19900;
        assert.equal((await f.reserve('two')).allowed, false);
    } finally { f.db.close(); }
});
test('HTTP bytes 與共用 usage delta 分別記錄，不精確歸因也不釋放已耗預留', async () => {
    const f = fixture(); try {
        const r = await f.reserve(); await f.port.start(r);
        f.usage.usedBytes += 1300; f.usage.remainingBytes -= 1300;
        await f.port.settle({ ...r, requested: 1, responseBytes: 300 });
        const row = await f.db.prepare('SELECT * FROM broker_bandwidth_reservations').first();
        assert.equal(row.status, 'charged'); assert.equal(row.response_bytes, 300); assert.equal(row.usage_after, 1400);
        assert.equal(row.estimated_bytes, 2000); assert.equal((await f.reserve('two')).allowed, false);
        await f.port.settle({ ...r, requested: 1, responseBytes: 300 });
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM broker_bandwidth_receipts WHERE status='charged'").first()).n, 1);
    } finally { f.db.close(); }
});
test('尚未 dispatch 的已取消請求可以安全釋放', async () => {
    const f = fixture(); try {
        const r = await f.reserve(); await f.port.settle({ ...r, requested: 0, responseBytes: null });
        assert.equal((await f.db.prepare('SELECT status FROM broker_bandwidth_reservations').first()).status, 'released');
        assert.equal((await f.reserve()).allowed, true);
    } finally { f.db.close(); }
});
test('已 dispatch 後 requested=0 不能偽稱沒有消耗', async () => {
    const f = fixture(); try {
        const r = await f.reserve(); await f.port.start(r); await f.port.settle({ ...r, requested: 0, responseBytes: null });
        assert.equal((await f.db.prepare('SELECT status FROM broker_bandwidth_reservations').first()).status, 'charged');
    } finally { f.db.close(); }
});
test('API generation 換代不清除既有 epoch 預留，使用量未知保守隔離', async () => {
    const f = fixture(); try {
        const r = await f.reserve(); await f.port.start(r); f.usage.generation = 'fixture-new-generation';
        await f.port.settle({ ...r, requested: 1, responseBytes: 300 });
        assert.equal((await f.db.prepare('SELECT status FROM broker_bandwidth_reservations').first()).status, 'quarantined');
        assert.equal((await f.reserve('two')).allowed, false);
    } finally { f.db.close(); }
});
test('租約 expiry 不自動回收；須確認 owner 死亡；dispatched 保留債務', async () => {
    for (const dispatched of [false,true]) {
        const f = fixture(); try {
            const r = await f.reserve(); if (dispatched) await f.port.start(r); f.advance(61000);
            assert.equal(await f.port.recover({ ...r }), false);
            assert.equal(await f.port.recover({ ...r, verifyOwnerDead: async () => false }), false);
            assert.equal(await f.port.recover({ ...r, verifyOwnerDead: async () => true }), true);
            assert.equal((await f.db.prepare('SELECT status FROM broker_bandwidth_reservations').first()).status, dispatched ? 'quarantined' : 'released');
            assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM broker_bandwidth_receipts WHERE status='reserved'").first()).n, 1);
        } finally { f.db.close(); }
    }
});
test('別的 owner 不得 dispatch／settle，過期不送 HTTP', async () => {
    const f = fixture(); try {
        const r = await f.reserve(), other = createBrokerBandwidthAdmission(f.options);
        await assert.rejects(other.start(r), /broker_reservation_lost/);
        await assert.rejects(other.settle({ ...r, requested: 0, responseBytes: null }), /broker_reservation_lost/);
        f.advance(61000); await assert.rejects(f.port.start(r), /broker_reservation_lost/);
    } finally { f.db.close(); }
});
test('跨程序重建 admission 後速率限制仍保留，釋放未送也不重設請求紀錄', async () => {
    const f = fixture(); try {
        f.policy.maxRequestsPerWindow = 1;
        const r = await f.reserve(); await f.port.settle({ ...r, requested: 0, responseBytes: null });
        const denied = await createBrokerBandwidthAdmission(f.options).reserve({ cacheKey: 'two', generation: f.usage.generation });
        assert.equal(denied.allowed, false); assert.equal(denied.reason, 'broker_rate_limited');
        assert.equal(denied.nextAttemptAt, new Date(f.now().getTime() + 60000).toISOString());
        f.advance(61000); assert.equal((await f.reserve('two')).allowed, true);
    } finally { f.db.close(); }
});
test('估量超過 operator 上限明示 pending；未初始化 schema 不寫入', async () => {
    const f = fixture(); try { f.policy.maxEstimatedBytes = 100; assert.equal((await f.reserve()).reason, 'broker_estimate_pending'); }
    finally { f.db.close(); }
    const db = new SqliteD1(); try {
        assert.equal((await createBrokerBandwidthAdmission({ db }).reserve({})).reason, 'broker_budget_schema_pending');
    } finally { db.close(); }
});

test('本機政策／實測／承諾未成立或估量超限，零 usage 請求', async () => {
    const f = fixture(); try {
        for (const p of [null, { ...f.policy, commitmentsObservedAt: '2026-10-03T06:58:59Z' },
            { ...f.policy, measurements: [] }, { ...f.policy, otherJobCommitments: null },
            { ...f.policy, maxEstimatedBytes: 1 }]) {
            let calls = 0;
            const port = createBrokerBandwidthAdmission({ ...f.options, readPolicy: async () => p,
                readUsage: async () => { calls++; return f.usage; } });
            assert.equal((await port.reserve({ cacheKey: 'preflight', generation: f.usage.generation })).allowed, false);
            assert.equal(calls, 0);
        }
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM broker_bandwidth_reservations').first()).n, 0);
    } finally { f.db.close(); }
});
test('usage 查詢期間承諾改變或過期，拒絕舊政策，不入帳', async () => {
    for (const expire of [false, true]) {
        const f = fixture(); try {
            let policy = structuredClone(f.policy);
            const port = createBrokerBandwidthAdmission({ ...f.options, readPolicy: async () => policy,
                readUsage: async () => {
                    if (expire) f.advance(61000);
                    else policy = { ...policy, otherJobCommitments: [{ jobKey: 'fixture-monitor', bytes: 7000 }] };
                    return { ...f.usage, observedAt: f.now().toISOString() };
                } });
            const r = await port.reserve({ cacheKey: 'changed', generation: f.usage.generation });
            assert.equal(r.reason, expire ? 'broker_policy_pending' : 'broker_policy_changed');
            assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM broker_bandwidth_reservations').first()).n, 0);
        } finally { f.db.close(); }
    }
});
test('dispatch 前政策改變不得送出；未送出的 reservation 仍可安全釋放', async () => {
    const f = fixture(); try {
        const r = await f.reserve();
        f.policy.otherJobCommitments = [{ jobKey: 'fixture-monitor', bytes: 7000 }];
        await assert.rejects(f.port.start(r), /broker_policy_changed/);
        assert.equal((await f.db.prepare('SELECT status FROM broker_bandwidth_reservations').first()).status, 'reserved');
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM broker_bandwidth_receipts WHERE status='dispatched'").first()).n, 0);
        await f.port.settle({ ...r, requested: 0, responseBytes: null });
        assert.equal((await f.db.prepare('SELECT status FROM broker_bandwidth_reservations').first()).status, 'released');
    } finally { f.db.close(); }
});
test('dispatch 前實測到期拒絕；保留原 reservation 與收據，不重置配額', async () => {
    const f = fixture(); try {
        const r = await f.reserve();
        f.policy.measurements = [];
        await assert.rejects(f.port.start(r), /broker_policy_pending/);
        assert.equal((await f.db.prepare('SELECT status FROM broker_bandwidth_reservations').first()).status, 'reserved');
        assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM broker_bandwidth_receipts WHERE status='reserved'").first()).n, 1);
    } finally { f.db.close(); }
});

test('承諾觀察時間更新但額度／證據不變，正常跨毫秒 reserve/dispatch 不誤拒絕', async () => {
    const f = fixture(); try {
        // 模擬真實時鐘與唯讀 producer：每次核對重新觀察，不變更任何承諾值。
        const r = await f.reserve(); f.advance(7);
        await f.port.start(r);
        assert.equal((await f.db.prepare('SELECT status FROM broker_bandwidth_reservations').first()).status, 'dispatched');
        await f.port.settle({ ...r, requested: 1, responseBytes: 300 });
    } finally { f.db.close(); }
});

test('usage 等待期間只更新觀察時間不拒絕，但 quota identity 改變不得放行', async () => {
    for (const changeIdentity of [false, true]) {
        const f = fixture(); try {
            const identity = { scope: f.usage.scope, quotaEpoch: f.usage.quotaEpoch,
                quotaEpochEvidenceHash: f.usage.quotaEpochEvidenceHash };
            const port = createBrokerBandwidthAdmission({ ...f.options,
                readPolicy: async () => ({ ...f.policy, commitmentsObservedAt: f.now().toISOString(), quotaIdentity: identity }),
                readUsage: async () => {
                    f.advance(7);
                    return { ...f.usage, observedAt: f.now().toISOString(),
                        ...(changeIdentity ? { quotaEpoch: 'unexpected-epoch' } : {}) };
                } });
            const r = await port.reserve({ cacheKey: 'observed', generation: f.usage.generation });
            assert.equal(r.allowed, !changeIdentity);
            if (changeIdentity) assert.equal(r.reason, 'broker_usage_pending');
        } finally { f.db.close(); }
    }
});

test('quota identity 破損或 dispatch 前換版，不能用新週期免除既有保留', async () => {
    const f = fixture(); try {
        f.policy.quotaIdentity = { scope: f.usage.scope, quotaEpoch: f.usage.quotaEpoch,
            quotaEpochEvidenceHash: f.usage.quotaEpochEvidenceHash };
        const r = await f.reserve(); assert.equal(r.allowed, true);
        f.policy.quotaIdentity = { ...f.policy.quotaIdentity, quotaEpoch: 'new-epoch' };
        await assert.rejects(f.port.start(r), /broker_policy_changed/);
        assert.equal((await f.db.prepare('SELECT status FROM broker_bandwidth_reservations').first()).status, 'reserved');
        assert.equal(validateBrokerBudgetPolicy({ ...f.policy, quotaIdentity: { scope: 'bad' } }, f.now()), false);
    } finally { f.db.close(); }
});
