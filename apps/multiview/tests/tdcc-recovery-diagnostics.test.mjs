import test from 'node:test';
import assert from 'node:assert/strict';
import { tdccFailureDiagnostic, syncTdccContinuousTargets } from '../worker/tdcc-continuous-backfill.ts';

test('TDCC 分類只輸出安全代碼，不傳原始例外或任意欄位', () => {
  const e = new Error('Cannot perform I/O on behalf of a different request; Bearer synthetic-secret');
  e.tdccDiagnostic = { stage: 'target-sync', symbol: '2330.TW', secret: 'synthetic' };
  assert.deepEqual(tdccFailureDiagnostic(e), { stage: 'target-sync', category: 'request_context_mismatch', symbol: '2330.TW' });
  const d = tdccFailureDiagnostic(new Error('sensitive unknown message'), 'bad?secret');
  assert.deepEqual(d, { stage: 'control', category: 'unclassified_exception', symbol: null });
});

test('目標同步錯誤保留 stage/symbol，安全 category 與既有 fail-closed 錯誤', async () => {
  const db = { prepare(sql) { return { bind() { return this; }, async first() {
    if (sql.includes('COUNT(*)')) return { rows: 1 };
    throw new Error('D1_TYPE_ERROR synthetic-secret');
  }, async all() { return { results: [] }; } }; } };
  await assert.rejects(syncTdccContinuousTargets({ db, targets: [{ symbol: '2330.TW', source: 'setup' }] }), e => {
    assert.equal(e.message, 'invalid_response'); assert.equal(e.tdccCategory, 'binding_invalid');
    assert.equal(tdccFailureDiagnostic(e).stage, 'target-sync');
    return true;
  });
});

test('runner 只保留安全控制端診斷，不接受任意 status 或敏感欄位', async () => {
  const { safeControlDiagnostic } = await import('../scripts/tdcc-history-backfill.mjs');
  assert.deepEqual(safeControlDiagnostic({stage:'target-sync',category:'binding_invalid',symbol:'2330.TW',secret:'synthetic'},400),
    {stage:'target-sync',category:'binding_invalid',symbol:'2330.TW',status:400});
  assert.deepEqual(safeControlDiagnostic({stage:'Bearer synthetic',category:'synthetic-secret',symbol:'bad'},999),
    {stage:'control',category:'unclassified_exception',symbol:null,status:null});
});
