import { test } from 'vitest';
import assert from 'node:assert/strict';
import { begin, record, finish, groups } from './maintenance-run-receipt.mjs';

test('context recovery preserves unfinished checkpoints', () => {
  const run = record(begin(null, 't1'), 'tick-tape', 'progress', 'First-open verified; isolated SSE pending', 't2');
  assert.deepEqual(begin(run, 't3'), run);
  assert.throws(() => finish(run, 't4'), /local-data, cloudflare/);
});
test('blocked work cannot become successful execution', () => {
  let run = begin(null, 't1');
  for (const key of groups) run = record(run, key, 'blocked', 'Source unavailable; next check after cooldown', 't2');
  assert.equal(finish(run, 't3').status, 'incomplete');
});
test('all groups require evidence before verified', () => {
  let run = begin(null, 't1');
  assert.throws(() => record(run, 'local-data', 'verified', ' ', 't2'), /Evidence/);
  assert.throws(() => record(run, 'unknown', 'verified', 'evidence', 't2'), /Invalid/);
  for (const key of groups) run = record(run, key, 'verified', 'Verified result reference', 't2');
  const done = finish(run, 't3');
  assert.equal(done.status, 'verified');
  assert.notEqual(begin(done, 't4').startedAt, done.startedAt);
  assert.throws(() => record(done, 'local-data', 'progress', 'evidence', 't4'), /No active run/);
});
