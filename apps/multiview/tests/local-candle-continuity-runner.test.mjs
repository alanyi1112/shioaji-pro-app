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

test('未驗證保留 counts；傳輸例外與日曆失敗分開且不洩漏原始訊息', async () => {
  const { localContinuityFailure } = await import('../scripts/local-candle-continuity.mjs');
  let failure;
  try { await runLocalContinuity({ secret, log, fetchImpl: async () => Response.json({ ok: true, result: {
    done: true, processed: 1, summary: { status: 'completed', counts: { target: 68, complete: 2, unknown: 66, arbitrary: 'secret' } }
  } }) }); } catch (e) { failure = localContinuityFailure(e); }
  assert.deepEqual(failure, { event: 'failed', error: 'local_continuity_unverified', counts: { target: 68, complete: 2, unknown: 66 } });
  assert.equal(localContinuityFailure(new Error('Bearer synthetic-secret')).error, 'local_continuity_transport_failed');
  assert.equal(localContinuityFailure(new Error('source'), true).error, 'calendar_seed_failed');
});

test('純重用入口不 seed 官方日曆；明確傳給 Worker，衝突模式先拒絕', async () => {
  let calls=0;
  await runLocalContinuity({ secret,log,reuseExistingOnly:true,fetchImpl:async(url,init)=>{
    calls++; assert.equal(url,'http://127.0.0.1:5174/api/internal/local-maintenance');
    assert.equal(JSON.parse(init.body).reuseExistingOnly,true);
    return Response.json({ok:true,result:{done:true,processed:0}});
  }});
  assert.equal(calls,1);
  await assert.rejects(runLocalContinuity({secret,log,reuseExistingOnly:true,seedCalendar:true,fetchImpl:()=>{throw Error('must_not_fetch')}}),/invalid_reuse_mode/);
});
