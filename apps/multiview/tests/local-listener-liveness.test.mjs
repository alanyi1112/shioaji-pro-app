import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createListenerLivenessState, installListenerLivenessGuard,
  probeLocalListener, LISTENER_GRACE_MS, LISTENER_POLL_MS } from '../build/local-listener-liveness.mjs';

test('初始啟動未曾監聽不誤判，使用 60 秒寬限與 5 秒取樣', () => {
  assert.equal(LISTENER_GRACE_MS, 60_000);
  assert.equal(LISTENER_POLL_MS, 5_000);
  const state = createListenerLivenessState();
  assert.equal(state.observe(false, 0), false);
  assert.equal(state.observe(false, 999_999), false);
  assert.equal(state.snapshot().armed, false);
});

test('持續失去 listener 到期只觸發一次；正常監聽不受資料查詢影響', () => {
  const state = createListenerLivenessState();
  assert.equal(state.observe(true, 1), false);
  assert.equal(state.observe(false, 10), false);
  assert.equal(state.observe(false, 60_009), false);
  assert.equal(state.observe(false, 60_010), true);
  assert.equal(state.observe(false, 100_000), false);
});

test('短暫關閉後重新監聽會清除缺席水位', () => {
  const state = createListenerLivenessState();
  state.observe(true, 0); state.observe(false, 10);
  assert.equal(state.observe(true, 59_999), false);
  assert.equal(state.observe(false, 100_000), false);
  assert.equal(state.observe(false, 159_999), false);
  assert.equal(state.observe(false, 160_000), true);
});

function harness() {
  const host = new EventEmitter(), callbacks = new Map();
  let time = 0, failures = 0, serial = 0;
  const options = { host, clock: () => time, fail: () => failures++, probe: () => true,
    startTimer(fn) { const id = ++serial; callbacks.set(id, fn); return { id, unref() {} }; },
    clearTimer(timer) { callbacks.delete(timer.id); } };
  const httpServer = Object.assign(new EventEmitter(), { listening: true });
  return { host, options, server: { httpServer },
    async tick(now) { await Promise.resolve(); time = now; await Promise.all([...callbacks.values()].map(fn => fn())); },
    failures: () => failures, count: () => callbacks.size };
}

test('Vite 重載接管後只保留一組觀測，不以舊 server 誤殺新 listener', async () => {
  const h = harness(), first = installListenerLivenessGuard(h.server, h.options);
  h.server.httpServer.listening = false; await h.tick(1);
  const replacement = { httpServer: Object.assign(new EventEmitter(), { listening: false }) };
  const second = installListenerLivenessGuard(replacement, h.options);
  assert.equal(second.state, first.state);
  assert.equal(h.count(), 1);
  replacement.httpServer.listening = true; await h.tick(60_002);
  assert.equal(h.failures(), 0);
  second.stop(); assert.equal(h.count(), 0);
});

test('已運作的服務重載後若永久無法重新監聽，仍能有界失效', async () => {
  const h = harness(); installListenerLivenessGuard(h.server, h.options);
  installListenerLivenessGuard({ httpServer: new EventEmitter() }, h.options);
  await h.tick(1); await h.tick(60_001);
  assert.equal(h.failures(), 1);
  assert.equal(h.count(), 0);
});

test('正常 SIGTERM／SIGINT 取消防護，舊 callback 不觸發復原', async () => {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const h = harness(); installListenerLivenessGuard(h.server, h.options);
    h.server.httpServer.listening = false; await h.tick(1);
    h.host.emit(signal); await h.tick(60_001);
    assert.equal(h.failures(), 0);
    assert.equal(h.count(), 0);
    assert.equal(h.host.listenerCount('SIGTERM'), 0);
    assert.equal(h.host.listenerCount('SIGINT'), 0);
  }
});

test('首次 listening 事件在取樣間隔內立即武裝', () => {
  const h = harness(); h.server.httpServer.listening = false;
  const guard = installListenerLivenessGuard(h.server, h.options);
  h.server.httpServer.listening = true; h.server.httpServer.emit('listening');
  assert.equal(guard.state.snapshot().armed, true);
  guard.stop();
});

test('Node handle 假稱 listening 但 TCP 無法連線仍判定失效', async () => {
  const h = harness();
  h.options.probe = () => false;
  installListenerLivenessGuard(h.server, h.options);
  await h.tick(1); await h.tick(60_001);
  assert.equal(h.server.httpServer.listening, true);
  assert.equal(h.failures(), 1);
});

test('慢 TCP probe 單飛，正常停止後遲到結果不誤退出', async () => {
  const h = harness(); let finish, probes = 0;
  h.options.probe = () => { probes++; return new Promise(resolve => { finish = resolve; }); };
  const guard = installListenerLivenessGuard(h.server, h.options);
  await h.tick(1); await h.tick(120_000);
  assert.equal(probes, 1);
  guard.stop(); finish(false); await Promise.resolve();
  assert.equal(h.failures(), 0);
});

test('獨立子程序真的關閉測試 listener 後退出 86，不建立 HTTP 或券商請求', () => {
  const moduleUrl = new URL('../build/local-listener-liveness.mjs', import.meta.url).href;
  const script = `import {createServer} from 'node:http';
    import {installListenerLivenessGuard} from ${JSON.stringify(moduleUrl)};
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      installListenerLivenessGuard({httpServer:server}, {graceMs:80,pollMs:10,probe:()=>true});
      setInterval(() => {}, 1000);
      server.close();
    });`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script],
    { encoding: 'utf8', timeout: 4000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 86);
  assert.equal(result.signal, null);
  assert.deepEqual(JSON.parse(result.stderr.trim()), { event: 'multiview_listener_lost',
    reason: 'listener_closed_beyond_grace', exitCode: 86 });
});

test('真實 TCP 握手可辨識開啟／關閉，且不送 HTTP payload', async () => {
  let requests = 0;
  const server = createServer(() => requests++);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try { assert.equal(await probeLocalListener(port), true); }
  finally { await new Promise(resolve => server.close(resolve)); }
  assert.equal(await probeLocalListener(port), false);
  assert.equal(requests, 0);
});
