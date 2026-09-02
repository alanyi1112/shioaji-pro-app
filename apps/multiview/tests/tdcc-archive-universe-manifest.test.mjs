import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../../../src/lib/tdcc-archive-universe.json', import.meta.url), 'utf8'));

test('固定官方商品宇宙保留來源 hash、全市場計數與代表商品', () => {
  assert.equal(manifest.version, 'tdcc-archive-universe-2026-09-02-v1');
  assert.equal(manifest.counts.total, 2330);
  assert.equal(manifest.counts.equities, 1974);
  assert.equal(manifest.counts.etfs, 356);
  assert.equal(manifest.rows.length, manifest.counts.total);
  assert.equal(new Set(manifest.rows.map(row => row.symbol)).size, manifest.rows.length);
  assert.deepEqual(manifest.sources.map(source => source.id), ['twse-issuer', 'tpex-issuer', 'twse-catalog', 'tpex-catalog']);
  for (const source of manifest.sources) {
    assert.match(source.url, /^https:\/\//);
    assert.match(source.sourceDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(source.payloadSha256, /^[0-9a-f]{64}$/);
  }
  const rows = new Map(manifest.rows.map(row => [row.symbol, row]));
  assert.equal(rows.get('2330.TW')?.quoteType, 'EQUITY');
  assert.equal(rows.get('8103.TW')?.exchange, 'TWSE');
  assert.equal(rows.get('6488.TWO')?.exchange, 'TPEx');
  assert.equal(rows.get('0050.TW')?.quoteType, 'ETF');
  assert.equal(rows.get('006201.TWO')?.quoteType, 'ETF');
});
