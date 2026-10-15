import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBrokerDailyResetWitness } from '../../../scripts/broker-daily-reset-witness.mjs';

const before = { generation: 'simulation:old', usedBytes: 410000000,
    remainingBytes: 90000000, limitBytes: 500000000,
    observedAt: '2026-10-05T23:58:00+08:00' };
const after = { generation: 'simulation:new', usedBytes: 1000000,
    remainingBytes: 499000000, limitBytes: 500000000,
    observedAt: '2026-10-06T08:03:00+08:00' };
const tradingDay = { tradeDate: '2026-10-06', twseTradingDay: true,
    tpexTradingDay: true, officialEvidenceHash: 'a'.repeat(64),
    verifiedAt: '2026-10-06T08:01:00+08:00' };
const args = { before, after, tradingDay, beforeAccountHash: 'b'.repeat(64),
    afterAccountHash: 'b'.repeat(64), observedAt: '2026-10-06T08:03:20+08:00' };

test('官方交易日、同一帳戶與跨 08:00 真實計數下降只形成候選證據', () => {
    const result = classifyBrokerDailyResetWitness(args);
    assert.equal(result.state, 'candidate');
    assert.equal(result.authorizesAdmission, false);
    assert.equal(result.proof.before.usedBytes, before.usedBytes);
    assert.equal(result.proof.after.usedBytes, after.usedBytes);
    assert.match(result.evidenceHash, /^[a-f0-9]{64}$/);
});

test('日期本身、非交易日、同帳戶未證實及計數未下降均不能聲稱重設', () => {
    const cases = [
        [{ tradingDay: { ...tradingDay, tpexTradingDay: false } }, 'official_session_unverified'],
        [{ afterAccountHash: 'c'.repeat(64) }, 'account_scope_changed'],
        [{ after: { ...after, usedBytes: 420000000, remainingBytes: 80000000 } }, 'counter_drop_not_observed'],
        [{ after: { ...after, limitBytes: 600000000, remainingBytes: 599000000 } }, 'quota_limit_changed'],
        [{ before: { ...before, observedAt: '2026-10-06T08:00:01+08:00' } }, 'reset_window_unverified'],
        [{ after: { ...after, observedAt: '2026-10-06T07:59:59+08:00' } }, 'reset_window_unverified'],
    ];
    for (const [override, reason] of cases) {
        assert.deepEqual(classifyBrokerDailyResetWitness({ ...args, ...override }),
            { state: 'unverified', reason });
    }
});

test('損壞或不平衡的來源用量直接拒絕', () => {
    assert.throws(() => classifyBrokerDailyResetWitness({ ...args,
        after: { ...after, remainingBytes: 499000001 } }), /broker_reset_witness_invalid/);
});

test('前一官方交易日為週五時，週一可用同日私密錨點；不能用任意舊日', () => {
    const friday = { ...before, observedAt: '2026-10-16T19:00:00+08:00' };
    const monday = { ...after, observedAt: '2026-10-19T08:05:00+08:00' };
    const day = { ...tradingDay, tradeDate: '2026-10-19',
        previousTradeDate: '2026-10-16', verifiedAt: '2026-10-19T08:01:00+08:00' };
    const result = classifyBrokerDailyResetWitness({ ...args, before: friday,
        after: monday, tradingDay: day, observedAt: '2026-10-19T08:05:10+08:00' });
    assert.equal(result.state, 'candidate');
    assert.equal(classifyBrokerDailyResetWitness({ ...args, before: friday,
        after: monday, tradingDay: { ...day, previousTradeDate: '2026-10-15' },
        observedAt: '2026-10-19T08:05:10+08:00' }).reason, 'reset_window_unverified');
});
