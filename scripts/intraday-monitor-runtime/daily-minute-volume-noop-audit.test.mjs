import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';
import { baselineCalendar } from './direct-160-baseline.mjs';
import { expectedTaiwanRegularSessionMinutes } from './historical-kbar-repair.mjs';
import { createDailyMinuteVolumeCandidate, verifyDailyMinuteVolumeBaseline, DAILY_KBAR_TIMESTAMP_ENCODING } from './daily-minute-volume-baseline.mjs';
import { DailyMinuteVolumeRepository } from './daily-minute-volume-repository.mjs';
import { DAILY_MINUTE_VOLUME_COLLECTION_SCHEMA } from './daily-minute-volume-collector.mjs';
import { auditDailyMinuteVolumeSameKeyNoop, inspectDailyMinuteVolumeSameKeyNoop } from './daily-minute-volume-noop-audit.mjs';

async function fixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'daily-noop-audit-'));
    const sourceDate = '2026-09-11', targetDate = '2026-09-14', at = '2026-09-11T16:30:00+08:00';
    const twse = { stat: 'ok', queryYear: 2026, fields: ['日期', '名稱', '說明'], data: [['2026-01-01', '元旦', '依規定放假1日。']] };
    const tpex = { data: { html: '<table><tr><td>中華民國115年有價證券櫃檯買賣市場開（休）市日期表</td></tr></table><table><tr><td>中華民國開國紀念日</td><td>1月1日</td><td>四</td><td>依規定放假1日。</td></tr></table>' } };
    const calendar = baselineCalendar(twse, tpex, sourceDate, targetDate, Date.parse(at));
    const databasePath = path.join(root, 'IntradayMonitor', 'daily-minute-volume-baselines.sqlite3');
    const repository = new DailyMinuteVolumeRepository(databasePath);
    const minutes = expectedTaiwanRegularSessionMinutes();
    const results = [];
    try {
        for (let index = 0; index < 160; index += 1) {
            const exchange = index < 121 ? 'TSE' : 'OTC', code = String(1001 + index);
            const symbol = `${code}.${exchange === 'TSE' ? 'TW' : 'TWO'}`;
            const identity = { code, exchange, security_type: 'STK', region: 'TW', target_code: null };
            const candidate = createDailyMinuteVolumeCandidate({ entry: { canonicalSymbol: symbol, contractIdentity: identity },
                contract: { ...identity, unit: 1000, trading_suspended: false, update_date: sourceDate },
                kbars: { fetchedAt: at, data: { datetime: minutes.map(minute => `${sourceDate}T${minute}:00`),
                    Open: minutes.map(() => 10), High: minutes.map(() => 10), Low: minutes.map(() => 10),
                    Close: minutes.map(() => 10), Volume: minutes.map(() => 2), Amount: minutes.map(() => 20000) } },
                tradeDate: sourceDate, sourceVersion: 'fixture-only/1', timestampEncoding: DAILY_KBAR_TIMESTAMP_ENCODING });
            const verified = verifyDailyMinuteVolumeBaseline({ candidate, now: at, authority: {
                officialTradingDay: true, identityVerified: true, instrumentStatus: 'normal', calendarVerified: true,
                symbol, exchange, securityType: 'STK', tradeDate: sourceDate, previousApplicableTradeDate: sourceDate,
                targetTradeDate: targetDate, timeZone: 'Asia/Taipei', calendarSource: 'TWSE and TPEx official annual calendars',
                calendarSourceVersion: calendar.sourceVersion } });
            assert.equal(verified.ok, true);
            repository.putManifest(verified.manifest, repository.currentRevision());
            results.push({ symbol, state: 'ready', source: 'single_kbar', manifestId: verified.manifest.manifestId });
        }
    } finally { repository.close(); }
    const receipt = { schemaVersion: DAILY_MINUTE_VOLUME_COLLECTION_SCHEMA, sourceDate, targetDate, attempt: 1,
        claimId: 'fixture-native-origin', connectionGeneration: 'simulation:fixture-generation-001', sourceVersion: 'fixture-only/1',
        calendarVersion: calendar.sourceVersion, completedAt: at, outcome: 'complete', readyCount: 160,
        waitingCount: 0, conflictCount: 0, requests: 320, responseBytes: 8000, results,
        brokerWriteAuthority: false, notificationAuthority: false, liveCaptureAcceptance: false };
    const claim = { schemaVersion: DAILY_MINUTE_VOLUME_COLLECTION_SCHEMA, sourceDate, targetDate, attempt: 1,
        claimId: receipt.claimId, connectionGeneration: receipt.connectionGeneration, ownerPid: process.pid,
        requestedSymbols: results.map(row => row.symbol) };
    const directory = path.join(root, 'IntradayMonitor', 'daily-minute-volume-collection', sourceDate);
    await mkdir(directory, { recursive: true });
    const receiptFile = path.join(directory, 'attempt-01-receipt.json'), claimFile = path.join(directory, 'attempt-01-claim.json');
    await writeFile(receiptFile, `${JSON.stringify(receipt)}\n`);
    await writeFile(claimFile, `${JSON.stringify(claim)}\n`);
    return { root, receipt, receiptFile, claimFile, databasePath, input: { root, collectionReceipt: receipt,
        calendar: { tradeDate: sourceDate, targetTradeDate: targetDate, twse, tpex, calendarSourceVersion: calendar.sourceVersion },
        limits: { maxRequests: 320, maxResponseBytes: 2097152, requestTimeoutMs: 20000, maxAttempts: 3,
            cooldownMs: 900000, deadlineTime: '18:30:00' }, trigger: 'scheduled', now: () => '2026-09-11T16:31:00+08:00' },
        close: () => rm(root, { recursive: true, force: true }) };
}

test('原生完成後實際重入同鍵collector，160份重新驗hash，零下載且原件不變', async () => {
    const env = await fixture();
    try {
        const before = await readFile(env.receiptFile);
        const result = await auditDailyMinuteVolumeSameKeyNoop(env.input);
        const saved = JSON.parse(await readFile(result.file, 'utf8'));
        assert.equal(saved.state, 'same_key_noop_verified');
        assert.equal(saved.count, 160); assert.equal(saved.manifests.filter(row => row.exchange === 'OTC').length, 39);
        assert.equal(saved.newDownloadRequests, 0); assert.equal(saved.newReservations, 0);
        assert.equal(saved.originalReceiptRequests, 320); assert.equal(saved.sameOriginalProcess, true);
        assert.equal(saved.liveAcceptance, false); assert.equal(saved.notificationAuthority, false);
        assert.deepEqual(await readFile(env.receiptFile), before);
        const second = await auditDailyMinuteVolumeSameKeyNoop({ ...env.input, now: () => '2026-09-11T16:32:00+08:00' });
        assert.equal(second.alreadyPresent, true); assert.equal(second.evidenceHash, result.evidenceHash);
    } finally { await env.close(); }
});

test('partial不取得no-op證據，人工查核不冒充scheduled', async () => {
    const env = await fixture();
    try {
        assert.equal((await auditDailyMinuteVolumeSameKeyNoop({ ...env.input,
            collectionReceipt: { ...env.receipt, outcome: 'partial' } })).state, 'baseline_not_complete_or_identity_invalid');
        const result = await auditDailyMinuteVolumeSameKeyNoop({ ...env.input, trigger: 'manual' });
        const saved = JSON.parse(await readFile(result.file, 'utf8'));
        assert.equal(saved.originTrigger, 'manual');
        await assert.rejects(auditDailyMinuteVolumeSameKeyNoop(env.input), /artifact_conflict/);
    } finally { await env.close(); }
});

test('manifest內容或原claim身分不符即拒絕，不下載或覆寫收據', async () => {
    const env = await fixture();
    try {
        const before = await readFile(env.receiptFile);
        const db = new DatabaseSync(env.databasePath);
        const row = db.prepare('SELECT manifest_json FROM daily_baseline_manifests LIMIT 1').get();
        const value = JSON.parse(row.manifest_json); value.cumulativeSeries[0].cumulativeVolume = 9;
        db.prepare('UPDATE daily_baseline_manifests SET manifest_json=? WHERE manifest_id=?').run(JSON.stringify(value),value.manifestId);
        db.close();
        const result = await inspectDailyMinuteVolumeSameKeyNoop(env.input);
        assert.equal(result.state, 'diagnostic_failed'); assert.match(result.reason, /manifest_unverified/);
        assert.deepEqual(await readFile(env.receiptFile), before);
        await writeFile(env.claimFile, '{}');
        await assert.rejects(auditDailyMinuteVolumeSameKeyNoop(env.input), /origin_conflict/);
    } finally { await env.close(); }
});

test('審核收據被更改或下一日窗口已關閉不得宣稱no-op', async () => {
    const env = await fixture();
    try {
        const result = await auditDailyMinuteVolumeSameKeyNoop(env.input);
        const artifact = JSON.parse(await readFile(result.file, 'utf8')); artifact.newDownloadRequests = 1;
        await writeFile(result.file, JSON.stringify(artifact));
        await assert.rejects(auditDailyMinuteVolumeSameKeyNoop(env.input), /artifact_conflict/);
        await assert.rejects(auditDailyMinuteVolumeSameKeyNoop({ ...env.input,
            now: () => '2026-09-14T09:02:00+08:00' }), /calendar_or_time_invalid/);
    } finally { await env.close(); }
});
