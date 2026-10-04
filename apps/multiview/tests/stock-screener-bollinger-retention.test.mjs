import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { pruneScreenerOhlcv, pruneScreenerOhlcvV4 } from '../../../scripts/stock-screener-ohlcv-bootstrap.mjs';

const migrations = await Promise.all(['0027_pale_randall_flagg.sql', '0028_early_sir_ram.sql',
    '0029_plain_strong_guy.sql', '0031_screener_ohlcv_v4.sql'].map(name => readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8')));
const sessions = Array.from({ length: 180 }, (_, i) => new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10));
const setup = () => { const db = new SqliteD1(); migrations.forEach(sql => applyDrizzleSql(db, sql)); return db; };
const insert = (db, date, validation) => db.prepare(`INSERT INTO screener_daily_ohlcv
    (symbol,data_date,market,open,high,low,close,currency,price_basis,mapping_version,source_url,payload_hash,fetched_at,validation)
    VALUES('2449.TW',?,'TWSE','100','101','99','100','TWD','official-unadjusted-after-market-twd','official-daily-ohlcv-v1','https://www.twse.com.tw/x',?,'2026-01-01',?)`)
    .bind(date, 'a'.repeat(64), validation).run();

for (const [name, prune, window, validation] of [['v3', pruneScreenerOhlcv, 60, 'canonical-complete-v1'],
    ['v4', pruneScreenerOhlcvV4, 130, 'canonical-complete-v2']]) {
    test(`${name} prune 保留新能力160日計畫及全部v8快照，無關舊列仍可清理`, async () => {
        const db = setup();
        try {
            for (const date of sessions) await insert(db, date, validation);
            await insert(db, '2024-12-01', validation);
            await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES('bplan','screener-bollinger-history-plan','running',?,'2026-01-01')")
                .bind(JSON.stringify({ capability: 'bollinger-history-v1', sessions: sessions.slice(-160) })).run();
            await db.prepare("INSERT INTO screener_snapshots(id,created_at,status,metadata,schema_version) VALUES('b8','2026-01-01','published',?,8)")
                .bind(JSON.stringify({ capability: 'bollinger-history-v1', historySessions: ['2024-12-01'] })).run();
            const kept = await prune(db, sessions.slice(-window));
            assert.equal(kept.length, 161);
            const rows = (await db.prepare('SELECT data_date FROM screener_daily_ohlcv ORDER BY data_date').all()).results.map(r => r.data_date);
            assert.deepEqual(rows, ['2024-12-01', ...sessions.slice(-160)]);
            assert.equal((await db.prepare("SELECT count(*) AS n FROM screener_runs WHERE id='bplan'").first()).n, 1);
        } finally { db.close(); }
    });
    test(`${name} prune 不接受破損保留依賴，不會在未知狀態刪除資料`, async () => {
        const db = setup();
        try {
            await insert(db, sessions[0], validation);
            await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES('bplan','screener-bollinger-history-plan','pending',?,'2026-01-01')")
                .bind(JSON.stringify({ capability: 'bollinger-history-v1', sessions: ['2026-02-30'] })).run();
            await assert.rejects(prune(db, sessions.slice(-window)), /invalid_bollinger_retention/);
            assert.equal((await db.prepare('SELECT count(*) AS n FROM screener_daily_ohlcv').first()).n, 1);
        } finally { db.close(); }
    });
}
