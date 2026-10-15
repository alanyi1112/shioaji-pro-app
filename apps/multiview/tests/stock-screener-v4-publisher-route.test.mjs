import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { buildOhlcvTargets, buildOhlcvV4Targets } from '../../../scripts/stock-screener-ohlcv-bootstrap.mjs';
import { publishScreenerSnapshot } from '../worker/stock-screener-repository.ts';
import { publishPreparedScreenerV3 } from '../worker/stock-screener-v3-publisher.ts';
import { publishPreparedScreenerV4 } from '../worker/stock-screener-v4-publisher.ts';
import { readScreenerV4Snapshot, publishScreenerV4Snapshot } from '../worker/stock-screener-v4-repository.ts';
import { handleStockScreener } from '../worker/stock-screener-route.ts';
import { decodeScreenerResponse } from '../../../src/lib/stock-screener-api.ts';
import { isTechnicalOnlyV7 } from '../worker/stock-screener-v7-technical-query.ts';
import { parseScreenerV7Query } from '../worker/stock-screener-v7-route.ts';
import { prepareTechnicalV7Cache } from '../worker/stock-screener-v7-technical-cache.ts';
import { prepareScreenerDependencyCache, readScreenerDependencySnapshot, screenerConditionDependencies } from '../worker/stock-screener-dependency-cache.ts';
import { publishPreparedScreenerV5 } from '../worker/stock-screener-v5-publisher.ts';
import { publishPreparedScreenerV6 } from '../worker/stock-screener-v6-publisher.ts';
import { readBollingerLegacyJoin } from '../worker/stock-screener-v8-legacy-join.ts';
import { createScreenerSessionReadiness } from '../../../src/lib/stock-screener-session-readiness.ts';

const migrations = await Promise.all(['0027_pale_randall_flagg.sql', '0028_early_sir_ram.sql', '0029_plain_strong_guy.sql',
  '0031_screener_ohlcv_v4.sql']
  .map((name) => readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8')));
const setup = () => { const db = new SqliteD1(); migrations.forEach((migration) => applyDrizzleSql(db, migration)); return db; };
const sessions = Array.from({ length: 130 }, (_, index) => new Date(Date.UTC(2026, 3, 26) + index * 86400000).toISOString().slice(0, 10));
const v3Sessions = sessions.slice(-60);
const inputs = [
  { code: '1101', symbol: '1101.TW', name: '台泥', market: 'TWSE', kind: 'ordinary', listingDate: sessions[0], currentVolume: null, previousVolume: null, currentHolder: null, previousHolder: null },
  { code: '5483', symbol: '5483.TWO', name: '中美晶', market: 'TPEx', kind: 'ordinary', listingDate: sessions[0], currentVolume: null, previousVolume: null, currentHolder: null, previousHolder: null },
  { code: '7855', symbol: '7855.TW', name: '新股', market: 'TWSE', kind: 'ordinary', listingDate: sessions.at(-2), currentVolume: null, previousVolume: null, currentHolder: null, previousHolder: null },
];
const metadata = { version: 2, schemaVersion: 2, formulaVersion: 'after-market-v2', sourceReview: 'verified',
  anchors: { daily: { previous: sessions.at(-2), current: sessions.at(-1) }, weekly: null, weeklyPeriods: [] },
  universeRevision: 'r4', total: inputs.length, validThrough: '2099-01-01T00:00:00Z', expectedSessionDate: sessions.at(-1) };

async function seed(db) {
  await publishScreenerSnapshot(db, metadata, inputs);
  for (const stock of inputs) for (const sessionDate of sessions) {
    if (stock.listingDate > sessionDate) continue;
    await db.prepare("INSERT INTO screener_daily_ohlcv(symbol,data_date,market,open,high,low,close,currency,price_basis,mapping_version,source_url,payload_hash,fetched_at,validation,volume_shares,volume_unit,volume_field,volume_mapping_version) VALUES(?,?,?,?,?,?,?,'TWD','official-unadjusted-after-market-twd','official-daily-ohlcv-v2','https://example.invalid',?,'2026-09-02T00:00:00Z','canonical-complete-v2',?,'shares','成交股數','official-daily-ohlcv-v2')")
      .bind(stock.symbol, sessionDate, stock.market, '100', '102', '98', '100', 'a'.repeat(64), '1000').run();
  }
  for (const target of buildOhlcvTargets(inputs, v3Sessions)) {
    const receipt = { version: 1, market: target.market, sessionDate: target.sessionDate, status: 'collected', complete: true,
      universeRevision: 'r4', expectedHash: target.expectedHash, universeEligible: target.universeEligible,
      valid: target.universeEligible, invalid: 0, missing: 0, payloadHash: 'b'.repeat(64) };
    await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,'screener-ohlcv-period','collected',?,'2026-09-02T00:00:00Z')")
      .bind(`screener-ohlcv:${target.market}:${target.sessionDate}`, JSON.stringify(receipt)).run();
  }
  const v3Progress = { version: 3, target: 120, processed: 120, remaining: 0, failed: 0, overdue: 0, cursor: null,
    markets: { TWSE: { target: 60, processed: 60, failed: 0 }, TPEx: { target: 60, processed: 60, failed: 0 } },
    sessions: v3Sessions, through: sessions.at(-1), universeRevision: 'r4' };
  await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES('screener-ohlcv-progress','screener-ohlcv-progress','complete',?,'2026-09-02T00:00:00Z')")
    .bind(JSON.stringify(v3Progress)).run();
  const v3 = await publishPreparedScreenerV3(db, new Date('2026-09-02T01:00:00Z'));
  assert.equal(v3.state, 'published');
  for (const target of buildOhlcvV4Targets(inputs, sessions)) {
    const receipt = { version: 2, dataCapability: 'ohlcv-v4', sourceMappingVersion: 'official-daily-ohlcv-v2',
      market: target.market, sessionDate: target.sessionDate, status: 'collected', complete: true,
      universeRevision: 'r4', expectedHash: target.expectedHash, universeEligible: target.universeEligible,
      valid: target.universeEligible, invalid: 0, missing: 0, payloadHash: 'c'.repeat(64), invalidSymbols: [], missingSymbols: [] };
    await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,'screener-ohlcv-v4-period','collected',?,'2026-09-02T00:00:00Z')")
      .bind(`screener-ohlcv-v4:${target.market}:${target.sessionDate}`, JSON.stringify(receipt)).run();
  }
  const v4Progress = { version: 4, dataCapability: 'ohlcv-v4', target: 260, processed: 260, remaining: 0, failed: 0, overdue: 0, cursor: null,
    markets: { TWSE: { target: 130, processed: 130, failed: 0 }, TPEx: { target: 130, processed: 130, failed: 0 } },
    sessions, through: sessions.at(-1), universeRevision: 'r4' };
  await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES('screener-ohlcv-v4-progress','screener-ohlcv-v4-progress','complete',?,'2026-09-02T00:00:00Z')")
    .bind(JSON.stringify(v4Progress)).run();
}

async function seedDependencies(db, dataset = 'institutional-flow', omitIndex = -1) {
  for (const name of ['0032_screener_chip_v5.sql', '0033_screener_institutional_reversal_v6.sql'])
    applyDrizzleSql(db, await readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8'));
  await db.prepare(`INSERT INTO screener_chip_runs(id,target_session_date,universe_revision,status,checkpoint,started_at,updated_at)
    VALUES('dependency-fixture',?,'r4','complete','{}','2026-09-02','2026-09-02')`).bind(sessions.at(-1)).run();
  for (const [index, date] of sessions.slice(-21).entries()) for (const market of ['TWSE','TPEx']) {
    if (index === omitIndex) continue;
    const id = `${dataset}:${date}:${market}`;
    await db.prepare(`INSERT INTO screener_chip_receipts(id,run_id,market,dataset,requested_date,source_date,source_url,
      payload_hash,normalization_version,status,row_count,universe_target,missing_count,invalid_count,fetched_at)
      VALUES(?,'dependency-fixture',?,?,?,?,'https://example.invalid',?,'fixture','verified',1,1,0,0,'2026-09-02')`)
      .bind(id,market,dataset,date,date,'c'.repeat(64)).run();
    if (dataset === 'institutional-flow') await db.prepare(`INSERT INTO screener_institutional_mapping_verifications
      (receipt_id,mapping_version,payload_hash,status,row_count,universe_target,missing_count,invalid_count,verified_at)
      VALUES(?,'official-market-institutional-v2',?,'verified',1,1,0,0,'2026-09-02')`).bind(id,'c'.repeat(64)).run();
    for (const stock of inputs.filter(r => r.market === market)) await db.prepare(`INSERT INTO screener_chip_daily
      (symbol,session_date,market,investment_trust_net_shares,foreign_net_shares,institutional_receipt_id,institutional_mapping_version,
        margin_today_balance_lots,short_today_balance_lots,margin_receipt_id,updated_at)
      VALUES(?,?,?,'1000','2000',?,'official-market-institutional-v2','100','5',?,'2026-09-02')`)
      .bind(stock.symbol,date,market,dataset==='institutional-flow'?id:null,dataset==='margin-short'?id:null).run();
  }
}

test('啟用條件依賴矩陣：價量／技術／集保不等待融資券，法人不等待集保，選用融資券才等待它', async () => {
  const db = setup();
  try {
    await seed(db); await seedDependencies(db);
    await publishPreparedScreenerV4(db, new Date('2026-09-02T02:00:00Z'));
    const built = await prepareScreenerDependencyCache(db);
    assert.equal(built.state,'unchanged');
    assert.equal((await publishPreparedScreenerV5(db)).state,'pending');
    assert.equal((await publishPreparedScreenerV6(db)).state,'pending');
    const changes = (await db.prepare('SELECT total_changes() n').first()).n;
    const readonly = { prepare(sql) {
      assert.doesNotMatch(sql,/screener_(?:daily_ohlcv|chip_daily|tdcc_weekly|universe)\b/);
      assert.doesNotMatch(sql,/^(?:INSERT|UPDATE|DELETE|CREATE|ALTER)/i); return db.prepare(sql);
    }, batch() { throw Error('get_must_not_write'); } };
    const query = async (version, extra, allowHealth = false) => {
      const params = new URLSearchParams(`version=${version}&volume=false&holder=false`);
      for (const [key,value] of new URLSearchParams(extra)) params.set(key,value);
      const r = await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?${params}`),
        {DB:allowHealth ? db : readonly,DEPLOYMENT_TARGET:'local'},new Date('2026-09-02T03:00:00Z'));
      const body = await r.json(); assert.equal(r.status,200,`${params}: ${JSON.stringify(body)}`); assert.ok(decodeScreenerResponse(body)); return body;
    };
    for (const key of ['closeHigh','closeSmaBreakout','largeHolderTrend','largeHolderConcentration','retailHolderDecline','trustOwnership']) {
      const r = await query(5,`${key}Enabled=true&resultState=unknown`);
      assert.equal(r.effectiveSessionDate,sessions.at(-1),key); assert.ok(r.dependencyScope,key);
      assert.notEqual(r.state,'pending',key);
    }
    for (const key of ['foreignReversal','trustReversal']) {
      const r = await query(6,`${key}Enabled=true&resultState=unknown`);
      assert.equal(r.effectiveSessionDate,sessions.at(-1)); assert.ok(r.dependencyScope);
      assert.ok(r.dependencyScope.required.every(k=>!k.endsWith('margin-short')));
    }
    for (const key of ['volume','holder','fractal','bollReversal','ma','divergence','closeHigh','closeSmaBreakout',
      'largeHolderTrend','largeHolderConcentration','retailHolderDecline','trustOwnership','foreignReversal','trustReversal']) {
      const extra = ['volume','holder','fractal','bollReversal','ma','divergence'].includes(key)?`${key}=true`:`${key}Enabled=true`;
      for (const mode of ['all','any']) {
        const r = await query(7,`bollPositionEnabled=true&${extra}&mode=${mode}&resultState=unknown`);
        assert.equal(r.effectiveSessionDate,sessions.at(-1),`${key}/${mode}`); assert.ok(r.dependencyScope);
      }
    }
    for (const key of ['priceMargin','shortMarginRatio']) {
      const r = await query(5,`${key}Enabled=true`,true);
      assert.equal(r.state,'pending'); assert.equal(r.rows.length,0); assert.equal(r.dependencyScope,undefined);
    }
    const criteria = parseScreenerV7Query(new URLSearchParams('version=7&volume=false&holder=false&closeHighEnabled=true')).criteria;
    const joined = await readBollingerLegacyJoin(readonly,criteria,sessions.at(-1),'r4',inputs.map(r=>r.symbol));
    assert.equal(joined.reason,'none'); assert.equal(joined.enabled.join(),'closeHigh');
    assert.equal((await db.prepare('SELECT total_changes() n').first()).n,changes);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM screener_snapshots WHERE schema_version>=5').first()).n,0);
    await db.prepare("DELETE FROM screener_runs WHERE scope IN ('screener-v7-technical-manifest','screener-v7-technical-feature')").run();
    const priceWithoutIndicators=await query(5,'closeHighEnabled=true');
    assert.equal(priceWithoutIndicators.effectiveSessionDate,sessions.at(-1));
    assert.ok(priceWithoutIndicators.dependencyScope);
    const joinedWithoutIndicators=await readBollingerLegacyJoin(readonly,criteria,sessions.at(-1),'r4',inputs.map(r=>r.symbol));
    assert.equal(joinedWithoutIndicators.reason,'none');
    assert.equal((await prepareScreenerDependencyCache(db)).state,'unchanged');
  } finally { db.close(); }
});

test('單獨融資券不依賴法人／集保；同日缺一市場或中間日期仍拒絕，disabled 分支完全不進日期 Gate', async () => {
  for (const omit of [-1,20,18]) {
    const db=setup();
    try {
      await seed(db); await seedDependencies(db,'margin-short',omit); await publishPreparedScreenerV4(db);
      const c=parseScreenerV7Query(new URLSearchParams('version=7&volume=false&holder=false&priceMarginEnabled=true')).criteria;
      const current=await readScreenerDependencySnapshot(db,c);
      assert.equal(!!current,omit===-1);
      const without=await readScreenerDependencySnapshot(db,{...c,priceMargin:{...c.priceMargin,enabled:false}});
      assert.ok(without); assert.equal(without.dependencyScope.required.length,0);
      const trust={...c,priceMargin:{...c.priceMargin,enabled:false},trustOwnership:{...c.trustOwnership,enabled:true}};
      assert.equal(await readScreenerDependencySnapshot(db,trust),null);
    } finally { db.close(); }
  }
});

test('條件底稿冪等、原資料變動不影響已發出的 cursor；損毀時 fail closed', async () => {
  const db=setup();
  try {
    await seed(db); await seedDependencies(db); await publishPreparedScreenerV4(db);
    const c=parseScreenerV7Query(new URLSearchParams('version=7&volume=false&holder=false&closeHighEnabled=true')).criteria;
    const a=await readScreenerDependencySnapshot(db,c);
    const before=(await db.prepare('SELECT total_changes() n').first()).n;
    assert.equal((await prepareScreenerDependencyCache(db)).state,'unchanged');
    assert.equal((await db.prepare('SELECT total_changes() n').first()).n,before);
    await db.prepare("UPDATE screener_chip_daily SET investment_trust_net_shares='3000'").run();
    const second=await prepareScreenerDependencyCache(db); assert.equal(second.state,'published'); assert.notEqual(second.snapshotId,a.id);
    assert.equal((await readScreenerDependencySnapshot(db,c,a.id)).id,a.id);
    await db.prepare("UPDATE screener_runs SET checkpoint='{}' WHERE scope='screener-condition-dependencies-v1' AND id LIKE '%:row:%'").run();
    await assert.rejects(()=>readScreenerDependencySnapshot(db,c),/invalid_dependency_snapshot|Cannot/);
  } finally { db.close(); }
});

test('千張大戶與三種集保週條件不等待未啟用的日資料；加上成交量／成交值仍等待，週缺漏仍保留', async () => {
  const db=setup();
  try {
    await seed(db); await seedDependencies(db); await publishPreparedScreenerV4(db);
    const readiness=createScreenerSessionReadiness('2026-09-03',sessions.at(-1),new Date('2026-09-03T06:00:00Z'));
    await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES('screener-session-readiness','screener-session-readiness','awaiting-publication',?,?)")
      .bind(JSON.stringify(readiness),readiness.updatedAt).run();
    const get=async p=>(await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?${p}`),{DB:db,DEPLOYMENT_TARGET:'local'},new Date('2026-09-03T07:00:00Z'))).json();
    const holder=await get('version=3&volume=false&holder=true');
    assert.equal(holder.dailyRequired,false); assert.equal(holder.reason,'period_pending'); // fixture 沒有週資料，不可假稱 ready。
    const withVolume=await get('version=3&volume=true&holder=true'); assert.equal(withVolume.state,'pending');
    const withTurnover=await get('version=3&volume=false&holder=true&holderTurnover=true'); assert.equal(withTurnover.state,'pending');
    for(const key of ['largeHolderTrend','largeHolderConcentration','retailHolderDecline']) {
      const r=await get(`version=5&volume=false&holder=false&${key}Enabled=true&resultState=unknown`);
      assert.equal(r.dailyRequired,false); assert.equal(r.state,'partial'); assert.equal(r.expectedSessionDate,'2026-09-03');
      assert.equal(r.effectiveSessionDate,sessions.at(-1)); assert.equal(r.counts.unknown,3); // 只免除未選日資料，不偽造週資料。
      const mixed=await get(`version=5&volume=true&holder=false&${key}Enabled=true`); assert.equal(mixed.state,'pending');
    }
  } finally {db.close();}
});

test('條件 head 並行 CAS 只有一個發布者，保留真正上一版 cursor，下一成功版才淘汰再上一版', async () => {
  const db=setup();
  try {
    await seed(db);await seedDependencies(db);await publishPreparedScreenerV4(db);
    const c=parseScreenerV7Query(new URLSearchParams('version=7&volume=false&holder=false&closeHighEnabled=true')).criteria;
    const first=await readScreenerDependencySnapshot(db,c);
    await db.prepare("UPDATE screener_chip_daily SET investment_trust_net_shares='4000'").run();
    const pair=await Promise.all([prepareScreenerDependencyCache(db),prepareScreenerDependencyCache(db)]);
    assert.equal(pair.filter(r=>r.state==='published').length,1);
    assert.equal(pair.filter(r=>r.reason==='dependency_publication_conflict').length,1);
    assert.ok(await readScreenerDependencySnapshot(db,c,first.id));
    const second=await readScreenerDependencySnapshot(db,c);
    await db.prepare("UPDATE screener_chip_daily SET investment_trust_net_shares='5000'").run();
    assert.equal((await prepareScreenerDependencyCache(db)).state,'published');
    assert.equal(await readScreenerDependencySnapshot(db,c,first.id),null);
    assert.ok(await readScreenerDependencySnapshot(db,c,second.id));
  } finally {db.close();}
});

const pureV7 = 'version=7&volume=false&holder=false&bollPositionEnabled=true&bollPositionMode=lower-outside&resultState=fail&limit=1';
test('純布林位置以當日已發布 v4 技術資料判定，完全沒有 v5/v6/v7 或籌碼表仍可查詢', async () => {
  const db = setup();
  try {
    await seed(db); await publishPreparedScreenerV4(db, new Date('2026-09-02T02:00:00Z'));
    const before = (await db.prepare('SELECT total_changes() AS n').first()).n;
    const readonly = { prepare(sql) { if (/screener_daily_ohlcv/.test(sql) || /^(?:INSERT|UPDATE|DELETE)/.test(sql)) throw Error('get_must_not_recalculate'); return db.prepare(sql); },
      batch() { throw Error('get_must_not_write'); } };
    const get = async query => (await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?${query}`),
      { DB: readonly, DEPLOYMENT_TARGET: 'local' }, new Date('2026-09-02T03:00:00Z'))).json();
    const body = await get(pureV7);
    assert.equal(body.version, 7); assert.equal(body.queryDataScope, 'technical-only');
    assert.equal(body.sourceSnapshotVersion, 4); assert.equal(body.effectiveSessionDate, sessions.at(-1));
    assert.equal(body.expectedSessionDate, sessions.at(-1)); assert.notEqual(body.state, 'pending');
    assert.equal(body.counts.total, 3); assert.equal(body.counts.unknown, 1);
    assert.equal(body.rows.length, 1); assert.equal(body.rows[0].chipV5, null); assert.equal(body.rows[0].institutionalV6, null);
    assert.equal(body.rows[0].technicalV7.through, sessions.at(-1));
    assert.equal(body.chipCoverage, null); assert.equal(body.institutionalCoverage, null);
    assert.ok(decodeScreenerResponse(body)); assert.ok(body.nextCursor);
    const second = await get(`${pureV7}&cursor=${encodeURIComponent(body.nextCursor)}`);
    assert.equal(second.snapshotId, body.snapshotId); assert.notEqual(second.rows[0].symbol, body.rows[0].symbol);
    assert.equal((await db.prepare('SELECT total_changes() AS n').first()).n, before);
    assert.equal((await prepareTechnicalV7Cache(db)).state, 'unchanged');
    assert.equal((await db.prepare('SELECT total_changes() AS n').first()).n, before);
    assert.throws(() => decodeScreenerResponse({ ...body, queryDataScope: undefined }), /invalid_screener_response/);
    assert.throws(() => decodeScreenerResponse({ ...body, chipCoverage: {} }), /invalid_screener_response/);
    const combined = await get(`${pureV7}&trustOwnershipEnabled=true`);
    assert.notEqual(combined.queryDataScope, 'technical-only'); assert.equal(combined.rows.length, 0);
  } finally { db.close(); }
});

test('純技術路徑涵蓋四指標，但任何額外條件仍遵守原同日聯集／交集 Gate', () => {
  const base = parseScreenerV7Query(new URLSearchParams(pureV7)).criteria;
  assert.equal(isTechnicalOnlyV7(base), true);
  for (const key of ['volume','holder','fractal','bollReversal','ma','divergence','largeHolderTrend','largeHolderConcentration',
    'retailHolderDecline','trustOwnership','priceMargin','shortMarginRatio','closeHigh','closeSmaBreakout','foreignReversal','trustReversal']) {
    assert.equal(isTechnicalOnlyV7({ ...base, [key]: { ...base[key], enabled: true } }), false, key);
  }
});

test('背景封存 unknown；GET 不隨 raw rows 改變，過期或底稿損毀不解鎖，無底稿不借昨日籌碼', async () => {
  const db = setup();
  try {
    const request = () => new Request(`http://127.0.0.1/api/stock-screener/results?${pureV7}`);
    const empty = await (await handleStockScreener(request(), { DB: db, DEPLOYMENT_TARGET: 'local' })).json();
    assert.equal(empty.state, 'pending'); assert.equal(empty.reason, 'v7_preparation_pending');
    await seed(db); await publishPreparedScreenerV4(db, new Date('2026-09-02T02:00:00Z'));
    await db.prepare('DELETE FROM screener_daily_ohlcv WHERE symbol=? AND data_date=?').bind('1101.TW', sessions.at(-1)).run();
    const missing = await (await handleStockScreener(request(), { DB: db, DEPLOYMENT_TARGET: 'local' }, new Date('2026-09-02T03:00:00Z'))).json();
    assert.equal(missing.state, 'partial'); assert.equal(missing.counts.unknown, 1);
    assert.equal(missing.counts.missingByCondition.bollPosition, 1);
    const stale = await (await handleStockScreener(request(), { DB: db, DEPLOYMENT_TARGET: 'local' }, new Date('2100-01-01T00:00:00Z'))).json();
    assert.equal(stale.state, 'stale'); assert.equal(stale.rows.length, 0); assert.equal(stale.nextCursor, null);
    await db.prepare("UPDATE screener_runs SET checkpoint='{}' WHERE scope='screener-v7-technical-feature'").run();
    const corrupt = await handleStockScreener(request(), { DB: db, DEPLOYMENT_TARGET: 'local' }, new Date('2026-09-02T03:00:00Z'));
    assert.equal(corrupt.status, 503); assert.equal((await corrupt.json()).rows.length, 0);
  } finally { db.close(); }
});

test('完整 130 日 OHLCV 與 260 receipts 才原子發布 v4，並保存 compact hash', async () => {
  const db = setup();
  try {
    await seed(db);
    const result = await publishPreparedScreenerV4(db, new Date('2026-09-02T02:00:00Z'));
    assert.equal(result.state, 'published');
    const snapshot = await readScreenerV4Snapshot(db);
    assert.equal(snapshot.inputs.length, 3);
    assert.equal(snapshot.metadata.technicalAnchors.sessions.length, 130);
    assert.equal(snapshot.metadata.sourceMappingVersion, 'official-daily-ohlcv-v2');
    assert.equal(snapshot.inputs[0].technicalV4.ma.evidence.points.length, 11);
    assert.match(snapshot.inputs[0].technicalV4.evidenceHash, /^[a-f0-9]{64}$/);
    assert.equal(snapshot.inputs[2].technicalV4.ma.reason, 'insufficient_history');
    assert.equal((await publishPreparedScreenerV4(db)).state, 'unchanged');
    assert.equal((await db.prepare('PRAGMA integrity_check').first()).integrity_check, 'ok');
  } finally { db.close(); }
});

test('v4 GET 僅讀 immutable features，維持守恆、穩定 cursor 並拒絕惡意參數', async () => {
  const db = setup();
  try {
    await seed(db); await publishPreparedScreenerV4(db, new Date('2026-09-02T02:00:00Z'));
    const before = (await db.prepare('SELECT total_changes() AS n').first()).n;
    const query = 'version=4&volume=false&holder=false&fractal=false&bollReversal=false&ma=true&maMode=bullish-preparation&compressionDays=3&maxSpreadPct=1&divergence=false&sort=code&direction=asc&resultState=fail&limit=1';
    const first = await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?${query}`), { DB: db, DEPLOYMENT_TARGET: 'local' });
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.equal(body.version, 4); assert.equal(body.rows.length, 1); assert.equal(body.technicalAnchors.sessions.length, 130);
    assert.equal(body.counts.matched + body.counts.notMatched + body.counts.unknown, body.counts.total);
    assert.equal(body.rows[0].technicalV4.ma.verdict, 'fail');
    const second = await (await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?${query}&cursor=${encodeURIComponent(body.nextCursor)}`), { DB: db, DEPLOYMENT_TARGET: 'local' })).json();
    assert.equal(new Set([...body.rows, ...second.rows].map((row) => row.code)).size, 2);
    assert.equal((await db.prepare('SELECT total_changes() AS n').first()).n, before);
    const next=new Date(Date.parse(`${sessions.at(-1)}T00:00:00Z`)+86400000).toISOString().slice(0,10);
    const readiness={version:1,expectedSessionDate:next,effectiveSessionDate:sessions.at(-1),phase:'awaiting-publication',attempts:1,
      nextAttemptAt:'2026-09-03T06:20:00Z',updatedAt:'2026-09-03T06:00:00Z',markets:{
        TWSE:{status:'pending',reportDate:sessions.at(-1),hash:null,total:null,invalid:null,reason:'source_not_published',checkedAt:'2026-09-03T06:00:00Z'},
        TPEx:{status:'complete',reportDate:next,hash:'b'.repeat(64),total:700,invalid:0,reason:null,checkedAt:'2026-09-03T06:00:00Z'}}};
    await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES('screener-session-readiness','screener-session-readiness','awaiting-publication',?,?)")
      .bind(JSON.stringify(readiness),readiness.updatedAt).run();
    const stale=await (await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?${query}`),{DB:db,DEPLOYMENT_TARGET:'local'})).json();
    assert.equal(stale.state,'pending');assert.equal(stale.reason,'awaiting_twse');assert.equal(stale.expectedSessionDate,next);
    assert.equal(stale.effectiveSessionDate,sessions.at(-1));assert.deepEqual(stale.rows,[]);
    for (const extra of ['&maMode=evil', '&compressionDays=11', '&maxSpreadPct=5.01', '&divergenceSource=evil', '&requireZeroReset=yes', '&url=http://evil']) {
      assert.equal((await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?${query}${extra}`), { DB: db, DEPLOYMENT_TARGET: 'local' })).status, 400);
    }
  } finally { db.close(); }
});

test('新條件全關投影 v3；任一新條件開啟但 v4 未 ready 時 rows 為空', async () => {
  const db = setup();
  try {
    await seed(db);
    const projected = await (await handleStockScreener(new Request('http://127.0.0.1/api/stock-screener/status?version=4'), { DB: db, DEPLOYMENT_TARGET: 'local' })).json();
    assert.equal(projected.version, 3);
    const pending = await (await handleStockScreener(new Request('http://127.0.0.1/api/stock-screener/results?version=4&volume=false&holder=false&ma=true&divergence=false'), { DB: db, DEPLOYMENT_TARGET: 'local' })).json();
    assert.equal(pending.version, 4); assert.equal(pending.state, 'pending'); assert.equal(pending.reason, 'v4_preparation_pending'); assert.deepEqual(pending.rows, []);
  } finally { db.close(); }
});


test('只有舊日期契約可撤回缺日訊號，同契約稀疏回歸仍拒絕', async () => {
  const { technicalEvidenceHash } = await import('../../../src/lib/stock-screener-technical-patterns.ts');
  const db = setup();
  try {
    await seed(db);
    await publishPreparedScreenerV4(db);
    const snapshot = await readScreenerV4Snapshot(db);
    const inputs = structuredClone(snapshot.inputs);
    inputs[0].technicalV4.ma = { verdict: 'unknown', reason: 'non_adjacent_sessions' };
    const { evidenceHash, ...evidence } = inputs[0].technicalV4;
    inputs[0].technicalV4.evidenceHash = await technicalEvidenceHash(evidence);
    await assert.rejects(publishScreenerV4Snapshot(db, snapshot.metadata, inputs), /snapshot_sparse_regression/);
    const legacy = { ...snapshot.metadata }; delete legacy.sessionAlignmentVersion;
    await db.prepare('UPDATE screener_snapshots SET metadata=? WHERE id=?').bind(JSON.stringify(legacy), snapshot.id).run();
    await publishScreenerV4Snapshot(db, snapshot.metadata, inputs);
    assert.equal((await readScreenerV4Snapshot(db)).inputs[0].technicalV4.ma.reason, 'non_adjacent_sessions');
  } finally { db.close(); }
});
