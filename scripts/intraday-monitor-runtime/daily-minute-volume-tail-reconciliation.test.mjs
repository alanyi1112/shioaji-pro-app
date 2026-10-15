import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { reconcileDailyMinuteVolumeTail } from './daily-minute-volume-tail-reconciliation.mjs';

const sourceTradeDate = '2026-10-08';
const targetTradeDate = '2026-10-12';
const connectionGeneration = `simulation:${'a'.repeat(32)}`;

async function fixture({ invalidOverlap = false, middleGap = false, missingMinutes = 1 } = {}) {
    const root = await mkdtemp(path.join(tmpdir(), 'daily-tail-reconcile-'));
    const monitor = path.join(root, 'IntradayMonitor');
    const directory = path.join(monitor, 'daily-run', sourceTradeDate);
    await mkdir(directory, { recursive: true });
    const symbols = Array.from({ length: 160 }, (_, index) => `${String(1000 + index)}.TW`);
    const missingSymbol = symbols[159];
    const lastLiveMinute = missingMinutes === 2 ? '13:28' : '13:29';
    const liveCount = 270 - missingMinutes;
    const liveCoverageBySymbol = symbols.map(symbol => ({ canonicalSymbol: symbol,
        state: symbol === missingSymbol ? 'partial' : 'complete',
        observationCount: symbol === missingSymbol ? liveCount : 270,
        lastMinute: symbol === missingSymbol ? lastLiveMinute : '13:30',
        reason: symbol === missingSymbol ? middleGap ? 'kbar_minute_gap' : 'close_minute_missing' : 'session_closed',
    }));
    const summary = { runtimeMode: 'daily', tradeDate: sourceTradeDate,
        connectionGeneration, executionOutcome: 'partial',
        stream: { disconnect: null }, resources: { resourceFault: null },
        liveCoverageBySymbol };
    await writeFile(path.join(directory, 'summary.json'), `${JSON.stringify(summary)}\n`);
    const liveDb = new DatabaseSync(path.join(monitor, 'intraday-monitor-evidence.sqlite3'));
    liveDb.exec(`CREATE TABLE intraday_monitor_observations (
        trade_date TEXT, canonical_symbol TEXT, minute_key TEXT, cumulative_volume INTEGER);`);
    for (let index = 0; index < liveCount; index++) {
        const minuteOfDay = 9 * 60 + 1 + index;
        const minuteKey = `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
        liveDb.prepare('INSERT INTO intraday_monitor_observations VALUES (?,?,?,?)')
            .run(sourceTradeDate, missingSymbol, minuteKey, index);
    }
    liveDb.prepare('UPDATE intraday_monitor_observations SET minute_key=?, cumulative_volume=? WHERE minute_key=?')
        .run(lastLiveMinute, missingMinutes === 2 ? 741 : 5053, lastLiveMinute);
    liveDb.close();
    const baselineDb = new DatabaseSync(path.join(monitor, 'daily-minute-volume-baselines.sqlite3'));
    baselineDb.exec(`CREATE TABLE daily_baseline_manifests (
        source_date TEXT, target_date TEXT, symbol TEXT, manifest_id TEXT, manifest_json TEXT);`);
    const manifest = { baselineUsable: true, tradeDate: sourceTradeDate,
        targetTradeDate, symbol: missingSymbol, source: 'shioaji-http-historical-kbars',
        sourceVersion: 'test-source', closeMode: 'normal_or_revised_13_30',
        cumulativeSeries: Array.from({ length: 270 }, (_, index) => ({
            minuteKey: index === 267 ? '13:28' : index === 268 ? '13:29' :
                index === 269 ? '13:30' : 'other',
            cumulativeVolume: index === 267 ? invalidOverlap && missingMinutes === 2 ? 742 : 741 :
                index === 268 ? missingMinutes === 2 ? 741 : invalidOverlap ? 5054 : 5053 :
                    index === 269 ? missingMinutes === 2 ? 887 : 6643 : index,
        })) };
    baselineDb.prepare('INSERT INTO daily_baseline_manifests VALUES (?,?,?,?,?)')
        .run(sourceTradeDate, targetTradeDate, missingSymbol, 'manifest-159', JSON.stringify(manifest));
    baselineDb.close();
    const collectionReceipt = { outcome: 'complete', sourceDate: sourceTradeDate,
        targetDate: targetTradeDate, connectionGeneration, readyCount: 160,
        waitingCount: 0, results: symbols.map((symbol, index) => ({ symbol,
            state: 'ready', manifestId: `manifest-${index}` })) };
    return { root, collectionReceipt, missingSymbol };
}

test('postclose tail is a separate immutable non-live evidence artifact', async () => {
    const item = await fixture();
    try {
        const input = { root: item.root, sourceTradeDate, targetTradeDate,
            collectionReceipt: item.collectionReceipt,
            now: () => '2026-10-08T09:00:00.000Z' };
        const result = await reconcileDailyMinuteVolumeTail(input);
        assert.equal(result.state, 'postclose_verified_live_partial');
        assert.equal(result.rows[0].verifiedCloseMinuteVolume, 1590);
        assert.equal(result.rows[0].liveDelivered, false);
        assert.deepEqual(result.rows[0].verifiedTail.map(row => row.minuteKey), ['13:30']);
        const saved = JSON.parse(await readFile(result.file, 'utf8'));
        assert.equal(saved.liveAcceptance, false);
        assert.equal(saved.notificationAuthority, false);
        assert.equal((await reconcileDailyMinuteVolumeTail({ ...input,
            collectionReceipt: { ...item.collectionReceipt, alreadyPresent: true } })).alreadyPresent, true);
    } finally { await rm(item.root, { recursive: true, force: true }); }
});

test('13:28 live prefix accepts only a verified two-minute terminal tail', async () => {
    const item = await fixture({ missingMinutes: 2 });
    try {
        const result = await reconcileDailyMinuteVolumeTail({ root: item.root,
            sourceTradeDate, targetTradeDate, collectionReceipt: item.collectionReceipt });
        assert.equal(result.state, 'postclose_verified_live_partial');
        assert.equal(result.rows[0].lastLiveMinute, '13:28');
        assert.deepEqual(result.rows[0].verifiedTail.map(row =>
            [row.minuteKey, row.minuteVolume, row.liveDelivered]),
        [['13:29', 0, false], ['13:30', 146, false]]);
    } finally { await rm(item.root, { recursive: true, force: true }); }
});

test('mismatched overlap and non-tail gaps never create a repaired artifact', async () => {
    for (const options of [{ invalidOverlap: true }, { middleGap: true }]) {
        const item = await fixture(options);
        try {
            const result = await reconcileDailyMinuteVolumeTail({ root: item.root,
                sourceTradeDate, targetTradeDate, collectionReceipt: item.collectionReceipt });
            assert.equal(result.state, options.invalidOverlap ?
                'tail_overlap_or_source_unverified' : 'non_tail_or_unverified_live_gap');
        } finally { await rm(item.root, { recursive: true, force: true }); }
    }
});

test('incomplete baseline and changed generation fail closed without writing', async () => {
    const item = await fixture();
    try {
        const input = { root: item.root, sourceTradeDate, targetTradeDate,
            collectionReceipt: item.collectionReceipt };
        assert.equal((await reconcileDailyMinuteVolumeTail({ ...input,
            collectionReceipt: { ...item.collectionReceipt, readyCount: 159 } })).state,
        'baseline_not_complete');
        const summaryPath = path.join(item.root, 'IntradayMonitor', 'daily-run',
            sourceTradeDate, 'summary.json');
        const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
        await writeFile(summaryPath, `${JSON.stringify({ ...summary,
            connectionGeneration: `simulation:${'b'.repeat(32)}` })}\n`);
        assert.equal((await reconcileDailyMinuteVolumeTail(input)).state,
            'live_identity_or_integrity_unverified');
    } finally { await rm(item.root, { recursive: true, force: true }); }
});
