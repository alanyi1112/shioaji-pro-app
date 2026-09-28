import assert from "node:assert/strict";
import test from "node:test";
import { handleLocalMaintenance } from "../worker/local-maintenance.ts";

const endpoint = "http://127.0.0.1:5174/api/internal/local-maintenance";
const secret = "a".repeat(64);
const context = { waitUntil() {} };
const actions = { async daily() {} };

test("本機 maintenance 只接受 loopback、精確 secret 與最小 schema", async () => {
  const remote = await handleLocalMaintenance(new Request(endpoint.replace("127.0.0.1", "example.com"), { method: "POST" }), { LOCAL_PIPELINE_SECRET: secret }, context, actions);
  assert.equal(remote.status, 403);
  const missing = await handleLocalMaintenance(new Request(endpoint, { method: "POST", body: "{}" }), { LOCAL_PIPELINE_SECRET: secret }, context, actions);
  assert.equal(missing.status, 401);
  const invalid = await handleLocalMaintenance(new Request(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-multiview-local-authorization": `Bearer ${secret}` },
    body: JSON.stringify({ action: "daily", account: "must-not-cross-boundary" }),
  }), { LOCAL_PIPELINE_SECRET: secret }, context, actions);
  assert.equal(invalid.status, 400);
});

test("合法 maintenance 在沒有 D1 時明確 fail closed", async () => {
  const response = await handleLocalMaintenance(new Request(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-multiview-local-authorization": `Bearer ${secret}` },
    body: JSON.stringify({ action: "daily", scheduledTime: Date.now() }),
  }), { LOCAL_PIPELINE_SECRET: secret }, context, actions);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reasonCode, "d1_unavailable");
});

test("continuity 僅在受保護 local deployment 呼叫，回傳逐批結果", async () => {
  let calls = 0;
  const make = (host = '127.0.0.1') => new Request(endpoint.replace('127.0.0.1', host), { method: 'POST', headers: { 'x-multiview-local-authorization': `Bearer ${secret}` }, body: JSON.stringify({ action: 'continuity' }) });
  const callbacks = { ...actions, async continuity() { calls++; return { done: false, processed: 1 }; } };
  for (const target of ['cloudflare', undefined]) {
    assert.equal((await handleLocalMaintenance(make(), { DB: {}, LOCAL_PIPELINE_SECRET: secret, DEPLOYMENT_TARGET: target }, context, callbacks)).status, 403);
  }
  assert.equal(calls, 0);
  const response = await handleLocalMaintenance(make(), { DB: {}, LOCAL_PIPELINE_SECRET: secret, DEPLOYMENT_TARGET: 'local' }, context, callbacks);
  assert.deepEqual((await response.json()).result, { done: false, processed: 1 });
  assert.equal(calls, 1);
});
