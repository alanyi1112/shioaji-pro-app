import test from 'node:test';
import assert from 'node:assert/strict';
import { brokerStockAccountScopeHash } from '../../../scripts/broker-account-scope.mjs';

const a = { signed: true, account_type: 'S', broker_id: '0001', account_id: '1234567' };
const b = { signed: true, account_type: 'S', broker_id: '0002', account_id: '7654321' };
const key = Buffer.alloc(32, 7);

test('固定證券帳戶摘要與回應順序無關，也不包含原始帳號', () => {
    const first = brokerStockAccountScopeHash([a, b, { signed: true, account_type: 'F' }], key);
    assert.equal(first, brokerStockAccountScopeHash([b, a], key));
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(first.includes(a.account_id), false);
    assert.notEqual(first, brokerStockAccountScopeHash([a], key));
    assert.notEqual(first, brokerStockAccountScopeHash([a, b], Buffer.alloc(32, 8)));
});

test('空帳戶、重複、未簽署及識別欄位錯誤 fail closed', () => {
    for (const value of [[], [a, a], [{ ...a, signed: false }], [{ ...a, broker_id: '' }],
        [{ ...a, account_id: 'unsafe/identifier' }]]) {
        assert.throws(() => brokerStockAccountScopeHash(value, key), /broker_account_scope_unverified/);
    }
    assert.throws(() => brokerStockAccountScopeHash([a], Buffer.alloc(4)), /broker_account_scope_key_unverified/);
});
