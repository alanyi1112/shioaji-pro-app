import test from 'node:test';
import assert from 'node:assert/strict';
import { runLocalContinuity } from '../scripts/local-candle-continuity.mjs';

const secret = 'synthetic-test-only'.repeat(3);
const log = () => {};
test('接續到完成，沒有可領取項目時結束，不忙迴圈重試', async () => {
  let calls = 0;
  const result = await runLocalContinuity({ secret, log, fetchImpl: async (url, init) => {
    assert.equal(new URL(url).hostname, '127.0.0.1');
    assert.equal(JSON.parse(init.body).action, 'continuity');
    return Response.json({ ok: true, result: { done: ++calls === 3, processed: 1 } });
  } });
  assert.equal(calls, 3); assert.equal(result.done, true);
  calls = 0;
  await runLocalContinuity({ secret, log, fetchImpl: async () => { calls++; return Response.json({ ok: true, result: { done: false, processed: 0 } }); } });
  assert.equal(calls, 1);
});
test('批次上限與回應錯誤不會被宣告為完整', async () => {
  const result = await runLocalContinuity({ secret, log, maxBatches: 2, fetchImpl: async () => Response.json({ ok: true, result: { done: false, processed: 1 } }) });
  assert.equal(result.bounded, true); assert.equal(result.done, false);
  await assert.rejects(runLocalContinuity({ secret, log, fetchImpl: async () => Response.json({ ok: false }, { status: 503 }) }), /local_continuity_failed/);
});

test('run 結束但仍有 unknown 不回報 verified', async () => {
  await assert.rejects(runLocalContinuity({ secret, log, fetchImpl: async () => Response.json({ ok: true, result: { done: true, processed: 0, summary: { status: 'completed', counts: { target: 2, complete: 1, unknown: 1 } } } }) }), /local_continuity_unverified/);
});
