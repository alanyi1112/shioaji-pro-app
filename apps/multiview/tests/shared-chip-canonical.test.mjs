import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
import{SqliteD1}from'./helpers/sqlite-d1.mjs';import{emptyDaily}from'../worker/taiwan-stock-chip.ts';
import{persistCanonicalChipRows,readCanonicalChipRows,fullCanonicalDataset}from'../worker/shared-chip-canonical.ts';
import{readWatchlistChipPrewarmHealth}from'../worker/watchlist-chip-prewarming.ts';
const schema=await readFile(new URL('../drizzle/0041_shared_verified_chip_rows.sql',import.meta.url),'utf8');
const at='2026-10-31T09:00:00Z',hash='a'.repeat(64);
function database(){const db=new SqliteD1();db.exec(`CREATE TABLE screener_chip_receipts(id TEXT PRIMARY KEY,market TEXT,dataset TEXT,status TEXT,requested_date TEXT,source_date TEXT,payload_hash TEXT,normalization_version TEXT,fetched_at TEXT);
CREATE TABLE screener_institutional_mapping_verifications(receipt_id TEXT,mapping_version TEXT,status TEXT,payload_hash TEXT);
CREATE TABLE taiwan_stock_chip_fetch_state(symbol TEXT,dataset TEXT,coverage_start TEXT,coverage_end TEXT,source_date TEXT,status TEXT,reason_code TEXT,last_success_at TEXT,last_attempt_at TEXT,retry_after TEXT);
CREATE TABLE tdcc_continuous_symbols(symbol TEXT,active INTEGER);CREATE TABLE user_instruments(symbol TEXT,enabled INTEGER);CREATE TABLE user_system_tab_instruments(symbol TEXT,enabled INTEGER);
CREATE TABLE chip_backfill_orchestrator_runs(scope TEXT,heartbeat_at TEXT,status TEXT,last_reason_code TEXT,updated_at TEXT);
INSERT INTO tdcc_continuous_symbols VALUES('2330.TW',1);INSERT INTO chip_backfill_orchestrator_runs VALUES('daily','${at}','completed',NULL,'${at}');`);db.exec(schema);return db;}
function fixture(dataset){const row=emptyDaily('2330.TW','2026-10-30');
 if(dataset==='institutional-flow')row.institutionalFlow={foreignBuyShares:30,foreignSellShares:10,foreignNetShares:20,investmentTrustBuyShares:8,investmentTrustSellShares:3,investmentTrustNetShares:5,dealerSelfNetShares:2,dealerHedgingNetShares:3,dealerTotalNetShares:5,institutionalTotalNetShares:30,sourceTotalNetShares:30,sourceTotalVerified:true};
 else row.marginShort={marginBuyLots:5,marginSellLots:1,marginCashRepaymentLots:1,marginYesterdayBalanceLots:10,marginTodayBalanceLots:13,marginBalanceChangeLots:3,marginLimitLots:100,marginUtilizationPercent:13,shortBuyLots:2,shortSellLots:1,shortCashRepaymentLots:0,shortYesterdayBalanceLots:3,shortTodayBalanceLots:2,shortBalanceChangeLots:-1,shortLimitLots:100,shortUtilizationPercent:2,offsetLots:1};
 row.provenance[dataset]={provider:'twse',dataset,frequency:'daily',sourceDate:'2026-10-30',fetchedAt:at,sourceDateVerified:true};return row;}
async function receipt(db,id,dataset){await db.prepare('INSERT INTO screener_chip_receipts VALUES(?,?,?,?,?,?,?,?,?)').bind(id,'TWSE',dataset,'verified','2026-10-30','2026-10-30',hash,'official-market-chip-v1',at).run();if(dataset==='institutional-flow')await db.prepare('INSERT INTO screener_institutional_mapping_verifications VALUES(?,?,?,?)').bind(id,'official-market-institutional-v2','verified',hash).run();}

test('完整來源欄位加到共用層；冪等不重寫，修改既有內容或mapping後fail closed',async()=>{const db=database();try{
 await receipt(db,'i','institutional-flow');const row=fixture('institutional-flow');
 assert.equal(await persistCanonicalChipRows(db,'i',[row]),1);assert.equal(await persistCanonicalChipRows(db,'i',[row]),0);
 assert.equal((await readCanonicalChipRows(db,'2330.TW','2026-10-29','2026-10-30'))[0].institutionalFlow.dealerTotalNetShares,5);
 const changed=structuredClone(row);changed.institutionalFlow.dealerSelfNetShares=3;changed.institutionalFlow.dealerHedgingNetShares=2;
 await assert.rejects(persistCanonicalChipRows(db,'i',[changed]),/canonical_material_conflict/);
 db.exec("UPDATE screener_institutional_mapping_verifications SET status='invalid'");
 assert.deepEqual(await readCanonicalChipRows(db,'2330.TW','2026-10-29','2026-10-30'),[]);
 await assert.rejects(persistCanonicalChipRows(db,'i',[row]),/canonical_receipt_unverified/);
 }finally{db.close();}});

test('缺欄位、錯日、錯市場或混入未授權商品都不能補成完整資料',async()=>{const db=database();try{
 await receipt(db,'m','margin-short');const row=fixture('margin-short');row.marginShort.marginUtilizationPercent=0.5;
 assert.equal(fullCanonicalDataset(row,'margin-short'),true);
 const bad=structuredClone(row);bad.marginShort.marginBuyLots=null;
 await assert.rejects(persistCanonicalChipRows(db,'m',[bad]),/canonical_row_invalid/);
 await assert.rejects(persistCanonicalChipRows(db,'m',[{...row,sessionDate:'2026-10-29'}]),/canonical_row_invalid/);
 await assert.rejects(persistCanonicalChipRows(db,'m',[{...row,symbol:'2330.TWO'}]),/canonical_row_invalid/);
 assert.equal(await persistCanonicalChipRows(db,'m',[row],new Set(['00406A.TW'])),0);
 await persistCanonicalChipRows(db,'m',[row]);db.exec("UPDATE screener_chip_canonical_rows SET payload_json='{}'");
 assert.deepEqual(await readCanonicalChipRows(db,'2330.TW','2026-10-29','2026-10-30'),[]);
 }finally{db.close();}});

test('來源觀測必須對應原收據hash與真實時間，重新驗證不能冒充新取得',async()=>{const db=database();try{
 await receipt(db,'m','margin-short');const row=fixture('margin-short');
 await assert.rejects(persistCanonicalChipRows(db,'m',[row],undefined,{sourceHash:'b'.repeat(64),observedAt:at}),/canonical_observation_invalid/);
 await assert.rejects(persistCanonicalChipRows(db,'m',[row],undefined,{sourceHash:hash,observedAt:'2026-10-30T09:00:00Z'}),/canonical_observation_invalid/);
 await assert.rejects(persistCanonicalChipRows(db,'m',[row],undefined,{sourceHash:hash,observedAt:'2099-01-01T00:00:00Z'}),/canonical_observation_invalid/);
 assert.equal(await persistCanonicalChipRows(db,'m',[row],undefined,{sourceHash:hash,observedAt:at}),1);
 }finally{db.close();}});

test('原狀態不改寫，共用新日期能接續健康判定；借券歷史不足仍不能通過原Gate',async()=>{const db=database();try{
 for(const dataset of['institutional-flow','margin-short','foreign-holding','securities-lending'])await db.prepare('INSERT INTO taiwan_stock_chip_fetch_state VALUES(?,?,?,?,?,?,?,?,?,?)').bind('2330.TW',dataset,'2025-10-01',['institutional-flow','margin-short'].includes(dataset)?'2026-10-28':'2026-10-30',['institutional-flow','margin-short'].includes(dataset)?'2026-10-28':'2026-10-30','available','available',at,at,null).run();
 const before=(await db.prepare('SELECT * FROM taiwan_stock_chip_fetch_state ORDER BY dataset').all()).results;
 assert.equal((await readWatchlistChipPrewarmHealth(db,new Date(at),'2026-10-30')).readySymbols,0);
 for(const [id,dataset]of[['i','institutional-flow'],['m','margin-short']]){await receipt(db,id,dataset);await persistCanonicalChipRows(db,id,[fixture(dataset)]);}
 assert.equal((await readWatchlistChipPrewarmHealth(db,new Date(at),'2026-10-30')).readySymbols,1);
 assert.deepEqual((await db.prepare('SELECT * FROM taiwan_stock_chip_fetch_state ORDER BY dataset').all()).results,before);
 db.exec("UPDATE taiwan_stock_chip_fetch_state SET coverage_start='2025-11-11' WHERE dataset='securities-lending'");
 const incomplete=await readWatchlistChipPrewarmHealth(db,new Date(at),'2026-10-30');
 assert.equal(incomplete.readySymbols,0);
 assert.equal(incomplete.lastErrorCode,'coverage_window_incomplete');
 assert.deepEqual(incomplete.pendingDatasets.map(x=>[x.dataset,x.reason]),[['securities-lending','coverage_window_incomplete']]);
 }finally{db.close();}});
