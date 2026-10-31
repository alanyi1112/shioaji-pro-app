import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteD1 } from './helpers/sqlite-d1.mjs';
import { readChipWatchlistRows } from '../worker/chip-watchlist.ts';
import { projectVerifiedChip, readVerifiedSharedChip, readVerifiedSharedDistribution } from '../worker/shared-chip-data.ts';
import { discoverWatchlistChipWarmTargets } from '../worker/watchlist-chip-prewarming.ts';
import { mergeChipRows } from '../worker/taiwan-stock-chip.ts';

test('系統頁籤 ETF、舊清單與使用者隔離；停用不授權', async () => {
  const db = new SqliteD1();
  try {
    db.exec(`CREATE TABLE user_instruments(user_id TEXT,symbol TEXT,name TEXT,provider TEXT,tab_id TEXT,tab_label TEXT,group_name TEXT,market TEXT,enabled INTEGER,sort_order INTEGER,updated_at TEXT);
      CREATE TABLE user_system_tab_instruments(user_id TEXT,symbol TEXT,name TEXT,provider TEXT,system_tab_id TEXT,group_name TEXT,market TEXT,enabled INTEGER,sort_order INTEGER,updated_at TEXT);
      INSERT INTO user_system_tab_instruments VALUES ('a','00406A.TW','主動中信台灣收益','yfinance','taiwan-stocks','上市 ETF','台股',1,1,'2026-10-31');
      INSERT INTO user_system_tab_instruments VALUES ('b','0050.TW','元大台灣50','yfinance','taiwan-stocks','上市 ETF','台股',1,1,'2026-10-31');
      INSERT INTO user_system_tab_instruments VALUES ('a','00919.TW','停用','yfinance','taiwan-stocks','上市 ETF','台股',0,1,'2026-10-31');
      INSERT INTO user_instruments VALUES ('a','2330.TW','台積電','yfinance','personal','個人','股票','台股',1,1,'2026-10-30');
      CREATE TABLE tdcc_continuous_symbols(symbol TEXT,active INTEGER);
      CREATE TABLE taiwan_stock_chip_fetch_state(symbol TEXT,dataset TEXT,coverage_start TEXT,coverage_end TEXT,source_date TEXT,status TEXT,reason_code TEXT,last_success_at TEXT,last_attempt_at TEXT,retry_after TEXT);`);
    assert.deepEqual((await readChipWatchlistRows(db, 'a')).map(r=>r.symbol), ['2330.TW','00406A.TW']);
    assert.deepEqual(await readChipWatchlistRows(db, null), []);
    assert.equal((await readChipWatchlistRows(db)).length, 3);
    const targets = await discoverWatchlistChipWarmTargets({db,now:'2026-10-31T03:00:00Z'});
    assert.equal(targets.targets.some(t=>t.symbol==='00406A.TW'), true);
    assert.equal(targets.targets.some(t=>t.symbol==='00919.TW'), false);
  } finally { db.close(); }
});

function fixture() {
  const row = {symbol:'2330.TW',session_date:'2026-10-30',market:'TWSE',
    institutional_mapping_version:'official-market-institutional-v2',institutional_invalid_reason:null,mapping_status:'verified',
    foreign_buy_shares:'1234',foreign_sell_shares:'234',foreign_net_shares:'1000',
    investment_trust_buy_shares:'30',investment_trust_sell_shares:'20',investment_trust_net_shares:'10',
    margin_yesterday_balance_lots:'10',margin_today_balance_lots:'12',margin_balance_change_lots:'2',
    short_yesterday_balance_lots:'3',short_today_balance_lots:'2',short_balance_change_lots:'-1'};
  for (const [p,d] of [['i','institutional-flow'],['m','margin-short']]) Object.assign(row,{[`${p}_id`]:p,[`${p}_status`]:'verified',[`${p}_market`]:'TWSE',
    [`${p}_dataset`]:d,[`${p}_requested_date`]:'2026-10-30',[`${p}_source_date`]:'2026-10-30',
    [`${p}_payload_hash`]:'a'.repeat(64),[`${p}_normalization_version`]:'official-market-chip-v1',[`${p}_fetched_at`]:'2026-10-30T13:00:00Z'});
  return row;
}
const project = row => projectVerifiedChip(row,'2330.TW','2026-10-01','2026-10-30');

test('同日期已驗證來源保留真實股與張，不補自營商或法人合計', () => {
  const result = project(fixture());
  assert.equal(result.institutionalFlow.foreignNetShares,1000);
  assert.equal(result.institutionalFlow.dealerTotalNetShares,null);
  assert.equal(result.institutionalFlow.institutionalTotalNetShares,null);
  assert.equal(result.marginShort.shortBalanceChangeLots,-1);
  assert.equal(result.provenance['institutional-flow'].receiptId,'i');
  assert.equal(result.provenance['margin-short'].sharedStore,'screener_chip_daily');
  const full = structuredClone(result);
  full.institutionalFlow.dealerTotalNetShares=50;
  full.institutionalFlow.institutionalTotalNetShares=1060;
  assert.equal(mergeChipRows([full],[result])[0].institutionalFlow.dealerTotalNetShares,50);
});

test('壞收據、錯日、錯單位數值、錯市場與未驗 mapping 逐類 fail closed', () => {
  for (const patch of [{i_status:'staging'},{i_source_date:'2026-10-29'},{i_dataset:'margin-short'},
    {i_payload_hash:'bad'},{institutional_mapping_version:'v1'},{mapping_status:'pending'},
    {institutional_invalid_reason:'bad'},{foreign_buy_shares:null},{foreign_buy_shares:'1.2'},
    {foreign_net_shares:'999'},{foreign_buy_shares:'9007199254740993'}]) {
    assert.equal(project({...fixture(),...patch}).institutionalFlow,null,JSON.stringify(patch));
  }
  assert.equal(project({...fixture(),market:'TPEx'}),null);
  assert.equal(project({...fixture(),symbol:'00406A.TW'}),null);
  assert.equal(project({...fixture(),margin_balance_change_lots:'3'}).marginShort,null);
});

test('共用讀取僅 SELECT 並限制 symbol/date；未部署選股表維持既有原件路徑', async () => {
  const db=new SqliteD1();
  try {
    assert.deepEqual(await readVerifiedSharedChip(db,'00406A.TW','2026-10-01','2026-10-30'),[]);
    assert.deepEqual(await readVerifiedSharedDistribution(db,'00406A.TW','2026-10-01','2026-10-30'),[]);
  } finally {db.close();}
});
