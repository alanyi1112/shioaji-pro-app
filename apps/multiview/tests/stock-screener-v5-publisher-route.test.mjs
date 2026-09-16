import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { technicalEvidenceHash } from '../../../src/lib/stock-screener-technical-patterns.ts';
import { collectScreenerChipSession } from '../worker/stock-screener-chip-collector.ts';
import { chipDownloadDecision, chipRetryAfter } from '../worker/stock-screener-chip-policy.ts';
import { publishScreenerV5Snapshot } from '../worker/stock-screener-v5-repository.ts';
import { handleStockScreener } from '../worker/stock-screener-route.ts';
import { parseScreenerV5Query } from '../worker/stock-screener-v5-route.ts';

const migrations = await Promise.all(['0027_pale_randall_flagg.sql', '0028_early_sir_ram.sql', '0029_plain_strong_guy.sql',
  '0031_screener_ohlcv_v4.sql', '0032_screener_chip_v5.sql']
  .map((name) => readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8')));
const setup = () => { const db = new SqliteD1(); migrations.forEach((migration) => applyDrizzleSql(db, migration)); return db; };
const sessions = Array.from({ length: 130 }, (_, index) => new Date(Date.UTC(2026, 3, 26) + index * 86400000).toISOString().slice(0, 10));
const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/screener-chip-v5/${name}`, import.meta.url), 'utf8'));

test('分類窗口使用台北時間，歷史可補，六次後隔日續跑', () => {
  const before = new Date('2026-09-11T12:59:59Z');
  assert.equal(chipDownloadDecision('2026-09-11', 'margin-short', before).allowed, false);
  assert.equal(chipDownloadDecision('2026-09-11', 'margin-short', new Date('2026-09-11T13:00:00Z')).allowed, true);
  assert.equal(chipDownloadDecision('2026-09-10', 'margin-short', before).allowed, true);
  assert.equal(chipDownloadDecision('2026-09-12', 'institutional-flow', before).allowed, false);
  assert.equal(chipDownloadDecision('2026-09-11', 'institutional-flow', new Date('2026-09-11T07:59:59Z')).allowed, false);
  assert.equal(chipDownloadDecision('2026-09-11', 'institutional-flow', new Date('2026-09-11T08:00:00Z')).allowed, true);
  const rate = chipRetryAfter('2026-09-11', before, null, 'rate_limited', 7200000);
  assert.equal(Date.parse(rate.nextAttemptAt) - before.getTime(), 7200000);
  const capped = chipRetryAfter('2026-09-11', before, { day: '2026-09-11', attempts: 5 }, 'empty_report');
  assert.equal(capped.nextAttemptAt, '2026-09-11T16:00:00.000Z');
});

test('空報表不阻擋另一市場；冷卻跨呼叫保存且成功資料不重抓', async () => {
  const db = setup();
  try {
    for (const market of ['TWSE', 'TPEx']) {
      const stock = { code: '2330', symbol: market === 'TWSE' ? '2330.TW' : '2330.TWO', name: '測試', market, kind: 'ordinary', listingDate: '1994-09-05' };
      await db.prepare("INSERT INTO screener_universe(revision,symbol,market,data_date,payload) VALUES('r',?,?,?,?)")
        .bind(stock.symbol, market, '2026-09-11', JSON.stringify({ stock })).run();
    }
    const payloads = {
      'TWSE:institutional-flow': await fixture('twse-t86.json'), 'TWSE:margin-short': { stat: 'OK', date: '20260911', data: [] },
      'TPEx:institutional-flow': await fixture('tpex-institutional.json'), 'TPEx:margin-short': await fixture('tpex-margin.json'),
    };
    const first = await collectScreenerChipSession(db, '2026-09-11', { now: new Date('2026-09-11T13:00:00Z'), payloads });
    assert.equal(first.state, 'pending');
    assert.equal(first.outcomes[0].reason, 'empty_report');
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM screener_chip_receipts WHERE status='verified'").first()).n, 3);
    let calls = 0;
    const second = await collectScreenerChipSession(db, '2026-09-11', { now: new Date('2026-09-11T13:05:00Z'), fetcher: async () => { calls++; throw new Error('unexpected'); } });
    assert.equal(second.state, 'pending'); assert.equal(calls, 0);
    payloads['TWSE:margin-short'] = await fixture('twse-mi-margn.json');
    assert.equal((await collectScreenerChipSession(db, '2026-09-11', { now: new Date('2026-09-11T13:30:00Z'), payloads })).state, 'complete');
  } finally { db.close(); }
});

async function seedV5(db) {
  const stock = { code: '2330', symbol: '2330.TW', name: '台積電', market: 'TWSE', kind: 'ordinary', listingDate: sessions[0],
    currentVolume: null, previousVolume: null, currentHolder: null, previousHolder: null, holderSeries: [],
    technical: { fractal: null, bollReversal: null, evidenceHash: 'a'.repeat(64) },
    technicalV4: { ma: { verdict: 'unknown', reason: 'insufficient_history' }, divergence: {}, evidenceHash: 'b'.repeat(64) } };
  const raw = { dailySessions: sessions, tdccWeeks: [], daily: [],
    closes: sessions.map((sessionDate, index) => ({ sessionDate, close: String(index + 1) })),
    issuedCommonShares: { shares: '1000000', asOfDate: sessions[0], sourceUrl: 'https://example.invalid', payloadHash: 'c'.repeat(64), normalizationVersion: 'v1' },
    dailyThrough: sessions.at(-1), weeklyThrough: sessions.at(-1), mappingVersion: 'official-market-chip-v1' };
  const input = { ...stock, chipV5: { ...raw, evidenceHash: await technicalEvidenceHash(raw) } };
  const metadata = { version: 5, schemaVersion: 5, formulaVersion: 'after-market-v5-chip-price-1', sourceMappingVersion: 'official-market-chip-v1',
    baseSnapshotId: '00000000-0000-4000-8000-000000000001', universeRevision: 'r5', effectiveSessionDate: sessions.at(-1),
    expectedSessionDate: sessions.at(-1), dailyThrough: sessions.at(-1), weeklyThrough: sessions.at(-1), dailySessions: sessions,
    tdccPeriods: sessions.slice(-4), receiptsHash: 'd'.repeat(64), total: 1, validThrough: '2099-01-01T00:00:00Z',
    anchors: { daily: { previous: sessions.at(-2), current: sessions.at(-1) }, weekly: null, weeklyPeriods: [] },
    technicalAnchors: { sessions, through: sessions.at(-1) },
    coverage: { daily: { TWSE: { target: 1, institutional: 1, margin: 1 }, TPEx: { target: 0, institutional: 0, margin: 0 } },
      tdcc: { target: 1, covered: 0 }, issuedShares: { target: 1, valid: 1, missing: 0 } } };
  return publishScreenerV5Snapshot(db, metadata, [input], new Date('2026-09-14T00:00:00Z'));
}

test('v5 migration is additive and keeps existing screener rows', async () => {
  const db = setup();
  try {
    await db.prepare("INSERT INTO screener_universe(revision,symbol,market,data_date,payload) VALUES('old','2330.TW','TWSE','2026-09-11','{}')").run();
    assert.equal((await db.prepare('PRAGMA integrity_check').first()).integrity_check, 'ok');
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM screener_universe WHERE revision='old'").first()).n, 1);
    const columns = (await db.prepare("PRAGMA table_info('screener_universe')").all()).results.map((row) => row.name);
    assert.ok(columns.includes('issued_common_shares'));
  } finally { db.close(); }
});

test('chip collector 重跑相同內容為冪等，來源內容變更才新增 receipt', async () => {
  const db = setup();
  try {
    const twse = { code: '2330', symbol: '2330.TW', name: '台積電', market: 'TWSE', kind: 'ordinary', listingDate: '1994-09-05' };
    const tpex = { code: '2330', symbol: '2330.TWO', name: '測試上櫃', market: 'TPEx', kind: 'ordinary', listingDate: '2020-01-01' };
    for (const stock of [twse, tpex]) await db.prepare(`INSERT INTO screener_universe(revision,symbol,market,data_date,payload)
      VALUES('r-chip',?,?,?,?)`).bind(stock.symbol, stock.market, '2026-09-11', JSON.stringify({ stock })).run();
    const payloads = {
      'TWSE:institutional-flow': await fixture('twse-t86.json'), 'TWSE:margin-short': await fixture('twse-mi-margn.json'),
      'TPEx:institutional-flow': await fixture('tpex-institutional.json'), 'TPEx:margin-short': await fixture('tpex-margin.json'),
    };
    assert.equal((await collectScreenerChipSession(db, '2026-09-11', { payloads, refreshVerified: true })).state, 'complete');
    assert.equal((await collectScreenerChipSession(db, '2026-09-11', { payloads })).state, 'complete');
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM screener_chip_receipts').first()).n, 4);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM screener_chip_runs WHERE status='complete'").first()).n, 2);
    const corrected = structuredClone(payloads);
    corrected['TWSE:institutional-flow'].data[0][7] = 901;
    corrected['TWSE:institutional-flow'].data[0][9] = 301;
    assert.equal((await collectScreenerChipSession(db, '2026-09-11', { payloads: corrected, refreshVerified: true })).state, 'complete');
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM screener_chip_receipts').first()).n, 5);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM screener_chip_receipts WHERE status='verified'").first()).n, 5);
  } finally { db.close(); }
});

test('v5 query rejects unknown keys and supports a chip-only condition', () => {
  const query = parseScreenerV5Query(new URLSearchParams('version=5&volume=false&holder=false&fractal=false&bollReversal=false&ma=false&divergence=false&closeHighEnabled=true&closeHighDays=20&sort=code&direction=asc&resultState=pass&limit=50'));
  assert.equal(query.criteria.closeHigh.enabled, true);
  assert.equal(query.criteria.volume.enabled, false);
  assert.throws(() => parseScreenerV5Query(new URLSearchParams('version=5&closeHighEnabled=true&evil=true')), /invalid_query/);
});

test('v5 GET reads immutable snapshot without database writes', async () => {
  const db = setup();
  try {
    const snapshotId = await seedV5(db);
    const before = (await db.prepare('SELECT total_changes() AS n').first()).n;
    const query = 'version=5&volume=false&holder=false&fractal=false&bollReversal=false&ma=false&divergence=false&closeHighEnabled=true&closeHighDays=20&sort=code&direction=asc&resultState=pass&limit=50';
    const response = await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?${query}`), { DB: db, DEPLOYMENT_TARGET: 'local' }, new Date('2000-01-01T00:00:00Z'));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.version, 5); assert.equal(body.snapshotId, snapshotId); assert.equal(body.rows.length, 1);
    assert.equal(body.rows[0].chipV5.outcomes.closeHigh.verdict, 'pass');
    assert.equal(body.counts.matched + body.counts.notMatched + body.counts.unknown, body.counts.total);
    assert.equal((await db.prepare('SELECT total_changes() AS n').first()).n, before);
  } finally { db.close(); }
});
