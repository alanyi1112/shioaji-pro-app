import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import {
  buildOhlcvProgress, buildOhlcvTargets, ohlcvHistoryUrl, planOhlcvBootstrap,
  prepareScreenerOhlcv, pruneScreenerOhlcv, selectOhlcvSessions,
} from '../../../scripts/stock-screener-ohlcv-bootstrap.mjs';

const migrationNames = ['0027_pale_randall_flagg.sql', '0028_early_sir_ram.sql', '0029_plain_strong_guy.sql'];
const migrations = await Promise.all(migrationNames.map((name) => readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8')));
const setup = () => { const db = new SqliteD1(); migrations.forEach((migration) => applyDrizzleSql(db, migration)); return db; };
const sessions = Array.from({ length: 60 }, (_, index) => new Date(Date.UTC(2026, 5, 1) + index * 86400000).toISOString().slice(0, 10));
const universe = [
  { code: '1101', symbol: '1101.TW', name: '台泥', market: 'TWSE', kind: 'ordinary', listingDate: sessions[0] },
  { code: '7855', symbol: '7855.TW', name: '和運租車', market: 'TWSE', kind: 'ordinary', listingDate: sessions.at(-2) },
  { code: '4768', symbol: '4768.TWO', name: '晶呈科技', market: 'TPEx', kind: 'ordinary', listingDate: sessions[0] },
];
const fields = {
  TWSE: ['證券代號', '證券名稱', '開盤價', '最高價', '最低價', '收盤價'],
  TPEx: ['代號', '名稱', '開盤', '最高', '最低', '收盤'],
};
const payload = (market, date, { drift = false, empty = false, actualDate = date } = {}) => {
  const rows = market === 'TWSE'
    ? [['1101', '台泥', '10', '11', '9', '10.5'], ['7855', '和運租車', '20', '21', '19', '20.5']]
    : [['4768', '晶呈科技', '30', '31', '29', '30.5']];
  const table = { fields: drift ? fields[market].filter((field) => !['最低價', '最低'].includes(field)) : fields[market], data: empty ? [] : rows };
  return { stat: market === 'TWSE' ? 'OK' : 'ok', date: actualDate.replaceAll('-', ''), tables: market === 'TWSE' ? [table] : [table, { fields: table.fields, data: [] }] };
};
const marketDate = (url) => {
  const parsed = new URL(url);
  const market = parsed.hostname.includes('twse') ? 'TWSE' : 'TPEx';
  const raw = parsed.searchParams.get('date');
  const date = raw.includes('/') ? raw.replaceAll('/', '-') : `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`;
  return { market, date };
};
const officialFetcher = (options = {}) => async (url) => {
  const { market, date } = marketDate(url);
  const patch = options[`${market}|${date}`] ?? {};
  if (patch.status) return new Response(patch.body ?? '', { status: patch.status, headers: patch.headers });
  return Response.json(payload(market, date, patch));
};

test('官方共同日曆只取 through 前最新 60 日，跨年／連假缺日不自行補日', () => {
  const calendar = ['2025-12-29', '2025-12-30', '2025-12-31', ...sessions];
  assert.deepEqual(selectOhlcvSessions(calendar, sessions.at(-1)), sessions);
  assert.equal(selectOhlcvSessions([...calendar, '2027-01-01'], sessions.at(-1)).at(-1), sessions.at(-1));
  assert.equal(selectOhlcvSessions(calendar, sessions.at(-2)).at(-1), sessions.at(-2));
  assert.throws(() => selectOhlcvSessions(calendar.slice(-40), sessions.at(-1)), /calendar_coverage_pending/);
  assert.throws(() => selectOhlcvSessions([calendar[0], calendar[2], calendar[1]], calendar[1]), /invalid_ohlcv_calendar/);
  assert.match(ohlcvHistoryUrl('TWSE', sessions[0]), /MI_INDEX/);
  assert.match(ohlcvHistoryUrl('TPEx', sessions[0]), /dailyQuotes/);
});

test('只有兩市場官方報表共同證明颱風休市，才排除該日並向前補足第 60 個 session', () => {
  const calendar = ['2026-05-29', ...sessions];
  const closed = sessions[10];
  const oneSided = [{ market: 'TWSE', sessionDate: closed, status: 'failed', reason: 'invalid_report_date' }];
  assert.ok(selectOhlcvSessions(calendar, sessions.at(-1), oneSided).includes(closed));
  const confirmed = [...oneSided, { market: 'TPEx', sessionDate: closed, status: 'failed', reason: 'empty_report' }];
  const selected = selectOhlcvSessions(calendar, sessions.at(-1), confirmed);
  assert.equal(selected.length, 60);
  assert.equal(selected[0], '2026-05-29');
  assert.ok(!selected.includes(closed));
  assert.equal(selected.at(-1), sessions.at(-1));
  const ambiguous = confirmed.map((row) => ({ ...row, reason: 'invalid_report_date' }));
  assert.ok(selectOhlcvSessions(calendar, sessions.at(-1), ambiguous).includes(closed));
});

test('target 固定為 60 日 × 2 市場；新商品只改上市日後的 expected hash', () => {
  const base = universe.filter((stock) => stock.code !== '7855');
  const before = buildOhlcvTargets(base, sessions);
  const after = buildOhlcvTargets(universe, sessions);
  assert.equal(after.length, 120);
  const changed = after.filter((target, index) => target.expectedHash !== before[index].expectedHash);
  assert.deepEqual(changed.map((target) => target.key), [`TWSE|${sessions.at(-2)}`, `TWSE|${sessions.at(-1)}`]);
  assert.equal(after.find((target) => target.key === `TWSE|${sessions.at(-3)}`).universeEligible, 1);
  assert.equal(after.find((target) => target.key === `TWSE|${sessions.at(-1)}`).universeEligible, 2);
});

test('planner 與 progress 的 target/processed/remaining/failed/overdue/cursor 守恆', () => {
  const targets = buildOhlcvTargets(universe, sessions);
  const receipts = [
    { ...targets[0], market: targets[0].market, sessionDate: targets[0].sessionDate, status: 'collected', complete: true },
    { ...targets[1], market: targets[1].market, sessionDate: targets[1].sessionDate, status: 'failed', complete: false },
  ];
  const plan = planOhlcvBootstrap(universe, sessions, receipts);
  assert.deepEqual({ target: plan.target, processed: plan.processed, remaining: plan.remaining, failed: plan.failed }, { target: 120, processed: 1, remaining: 119, failed: 1 });
  const progress = buildOhlcvProgress(plan, '2026-09-01T10:00:00Z', Date.parse('2026-09-01T11:00:00Z'));
  assert.equal(progress.target, progress.processed + progress.remaining);
  assert.equal(progress.overdue, progress.remaining);
  assert.ok(progress.cursor);
});

test('bounded operator 依 checkpoint 續跑，完整 market+session 批次可完成 120 targets', async () => {
  const db = setup(); let calls = 0;
  const fetcher = async (...args) => { calls++; return officialFetcher()(...args); };
  try {
    const first = await prepareScreenerOhlcv(db, { universe, sessions, universeRevision: 'r1', validThrough: '2099-01-01T00:00:00Z', limit: 2, pauseMs: 0, fetcher });
    assert.deepEqual({ requested: first.requested, processed: first.progress.processed, remaining: first.progress.remaining }, { requested: 2, processed: 2, remaining: 118 });
    const second = await prepareScreenerOhlcv(db, { universe, sessions, universeRevision: 'r1', validThrough: '2099-01-01T00:00:00Z', limit: 120, pauseMs: 0, fetcher });
    assert.equal(second.state, 'complete');
    assert.deepEqual({ target: second.progress.target, processed: second.progress.processed, remaining: second.progress.remaining, failed: second.progress.failed, overdue: second.progress.overdue },
      { target: 120, processed: 120, remaining: 0, failed: 0, overdue: 0 });
    assert.equal(calls, 120);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM screener_daily_ohlcv').first()).n, 122);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM screener_runs WHERE scope='screener-ohlcv-period' AND status='collected'").first()).n, 120);
  } finally { db.close(); }
});

test('ignored date／schema drift 記 failed 且 remaining 不歸零；429、403、timeout 與 lease lost 停止 run', async () => {
  const latest = sessions.at(-1);
  for (const patch of [{ drift: true }, { actualDate: sessions.at(-2) }]) {
    const db = setup();
    try {
      const result = await prepareScreenerOhlcv(db, { universe, sessions, universeRevision: 'r1', validThrough: '2099-01-01T00:00:00Z', limit: 1, pauseMs: 0,
        fetcher: officialFetcher({ [`TPEx|${latest}`]: patch }) });
      assert.equal(result.progress.failed, 1);
      assert.equal(result.progress.remaining, 120);
    } finally { db.close(); }
  }
  for (const response of [
    { status: 429, headers: { 'retry-after': '120' } }, { status: 403, body: 'captcha' }, { status: 520, body: 'temporary' },
  ]) {
    const db = setup();
    try {
      await assert.rejects(prepareScreenerOhlcv(db, { universe, sessions, universeRevision: 'r1', validThrough: '2099-01-01T00:00:00Z', limit: 1, pauseMs: 0,
        fetcher: officialFetcher({ [`TPEx|${latest}`]: response }) }), /rate_limited|source_blocked|source_http_520/);
      const progress = await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE id='screener-ohlcv-progress'").first();
      assert.equal(progress.status, 'running');
      assert.deepEqual({ processed: JSON.parse(progress.checkpoint).processed, remaining: JSON.parse(progress.checkpoint).remaining }, { processed: 0, remaining: 120 });
    } finally { db.close(); }
  }
  const db = setup();
  try {
    await assert.rejects(prepareScreenerOhlcv(db, { universe, sessions, universeRevision: 'r1', validThrough: '2099-01-01T00:00:00Z', limit: 1, pauseMs: 0,
      fetcher: officialFetcher(), guard: async () => { throw new Error('lease_lost'); } }), /lease_lost/);
  } finally { db.close(); }
});

test('retention 只清理 OHLC 舊列，保留 60 日、兩版 v3 anchors 與其他選股／個人／交易資料', async () => {
  const db = new SqliteD1();
  const names = (await readdir(new URL('../drizzle/', import.meta.url))).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  const all = await Promise.all(names.map((name) => readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8')));
  all.forEach((migration) => applyDrizzleSql(db, migration));
  const insertOhlcv = (date) => db.prepare("INSERT INTO screener_daily_ohlcv(symbol,data_date,market,open,high,low,close,currency,price_basis,mapping_version,source_url,payload_hash,fetched_at,validation) VALUES('1101.TW',?,'TWSE','10','11','9','10','TWD','official-unadjusted-after-market-twd','official-daily-ohlcv-v1','https://www.twse.com.tw/x',?,'2026-09-01T00:00:00Z','canonical-complete-v1')").bind(date, 'a'.repeat(64)).run();
  try {
    await insertOhlcv('2025-01-01'); await insertOhlcv('2026-05-31'); await insertOhlcv(sessions[0]);
    await db.prepare("INSERT INTO screener_snapshots(id,created_at,status,metadata,schema_version) VALUES('v3','2026-09-01','published',?,3)")
      .bind(JSON.stringify({ technicalAnchors: { sessions: ['2026-05-31'] } })).run();
    await db.prepare("INSERT INTO screener_daily_volume(symbol,data_date,payload) VALUES('1101.TW','2026-08-31','{}')").run();
    await db.prepare("INSERT INTO user_tabs(user_id,id,label,sort_order,enabled,is_default,source_tab_id) VALUES('u','t','個人',1,1,0,'')").run();
    await db.prepare("INSERT INTO candle_history(provider,symbol,interval,time,open,high,low,close,volume,source,source_time_zone) VALUES('fixture','1101.TW','1d',1,10,11,9,10,1,'fixture','Asia/Taipei')").run();
    const before = {
      volume: (await db.prepare('SELECT count(*) AS n FROM screener_daily_volume').first()).n,
      tabs: (await db.prepare('SELECT count(*) AS n FROM user_tabs').first()).n,
      candles: (await db.prepare('SELECT count(*) AS n FROM candle_history').first()).n,
    };
    const kept = await pruneScreenerOhlcv(db, sessions);
    assert.ok(kept.includes('2026-05-31'));
    assert.deepEqual((await db.prepare('SELECT data_date FROM screener_daily_ohlcv ORDER BY data_date').all()).results.map((row) => row.data_date), ['2026-05-31', sessions[0]]);
    assert.deepEqual({ volume: (await db.prepare('SELECT count(*) AS n FROM screener_daily_volume').first()).n,
      tabs: (await db.prepare('SELECT count(*) AS n FROM user_tabs').first()).n,
      candles: (await db.prepare('SELECT count(*) AS n FROM candle_history').first()).n }, before);
  } finally { db.close(); }
});
