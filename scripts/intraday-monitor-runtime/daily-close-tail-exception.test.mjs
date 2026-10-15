import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { evaluateCloseTailException, publishCloseTailException, readCloseTailExceptionView }
    from './daily-close-tail-exception.mjs';
import { expectedTaiwanRegularSessionMinutes, hashHistoricalKbarValue } from './historical-kbar-repair.mjs';
import { DAILY_MINUTE_VOLUME_CANDIDATE_SCHEMA, DAILY_KBAR_TIMESTAMP_ENCODING,
    computeDailyMinuteVolumePayloadHash, verifyDailyMinuteVolumeBaseline } from './daily-minute-volume-baseline.mjs';
import { thresholdConfigProof, createThresholdSwitchController } from './threshold-switch-controller.mjs';
import { assessCompletedDailyCloseTail } from './assess-daily-close-tail.mjs';
import { ThresholdSwitchRepository, THRESHOLD_RUNTIME_SESSION_SCHEMA } from './threshold-switch-repository.mjs';

const date = '2026-10-15', previous = '2026-10-14', target = '2026-10-16';
const generation = 'simulation:fixture-close-tail-generation';
const keys = expectedTaiwanRegularSessionMinutes();
function baseManifest(tradeDate, targetTradeDate, delta) {
    const candidate = { schemaVersion: DAILY_MINUTE_VOLUME_CANDIDATE_SCHEMA,
        symbol: '1000.TW', exchange: 'TSE', securityType: 'STK', tradeDate,
        timeZone: 'Asia/Taipei', source: 'shioaji-http-historical-kbars', sourceVersion: 'fixture-only/1',
        fetchedAt: `${tradeDate}T14:00:00+08:00`, sourceUnit: 'common_lot',
        canonicalUnit: 'common_lot', volumeSemantics: 'minute_delta',
        timestampEncoding: DAILY_KBAR_TIMESTAMP_ENCODING, closeEncoding: 'normal_13_30',
        arrays: { datetime: keys.map(m => `${tradeDate}T${m}:00+08:00`),
            ...Object.fromEntries(['Open', 'High', 'Low', 'Close'].map(k => [k, keys.map(() => 10)])),
            Volume: keys.map(() => delta), Amount: keys.map(() => delta * 10000) } };
    candidate.payloadHash = computeDailyMinuteVolumePayloadHash(candidate);
    const result = verifyDailyMinuteVolumeBaseline({ candidate, authority: {
        officialTradingDay: true, identityVerified: true, instrumentStatus: 'normal',
        calendarVerified: true, symbol: candidate.symbol, exchange: 'TSE', securityType: 'STK',
        timeZone: 'Asia/Taipei', tradeDate, previousApplicableTradeDate: tradeDate,
        targetTradeDate, calendarSource: 'fixture-only', calendarSourceVersion: 'fixture-calendar' },
    now: `${tradeDate}T14:01:00+08:00` });
    assert.equal(result.ok, true);
    return result.manifest;
}
function rename(manifest, symbol) {
    const { manifestId, ...body } = structuredClone(manifest);
    body.symbol = symbol;
    return { ...body, manifestId: hashHistoricalKbarValue(body) };
}
function fixture({ missingCount = 3, zeroBaseline = false } = {}) {
    const symbols = Array.from({ length: 160 }, (_, i) => `${1000 + i}.TW`);
    const config = { schemaVersion: 'intraday-monitor-config/1', revision: 0,
        globalThreshold: '1.5', items: symbols.map((symbol, i) => ({
            contract: { security_type: 'STK', region: 'TW', exchange: 'TSE', code: symbol.slice(0, 4), target_code: null },
            enabled: true, source: 'manual', thresholdOverride: i === 1 ? '3' : null })) };
    const proof = thresholdConfigProof(config);
    const initial = { schemaVersion: THRESHOLD_RUNTIME_SESSION_SCHEMA, sessionId: 'fixture-session',
        ownerId: 'fixture-owner', ownerPid: process.pid, tradeDate: date, previousTradeDate: previous,
        connectionGeneration: generation, config, activeSymbols: symbols, createdAt: `${date}T08:50:00+08:00` };
    const session = { ...initial, configRevision: 0, cohortHash: 'fixture-plan',
        itemStates: symbols.map(canonicalSymbol => ({ canonicalSymbol })),
        calendarAuthority: { current: true, tradeDate: date, previousTradeDate: previous,
            sourceVersions: ['fixture-calendar'] } };
    const currentBase = baseManifest(date, target, 2);
    const previousBase = baseManifest(previous, date, zeroBaseline ? 0 : 1);
    const manifests = symbols.map(s => rename(currentBase, s));
    const previousManifests = symbols.map(s => rename(previousBase, s));
    const coverage = symbols.map((canonicalSymbol, i) => ({
        canonicalSymbol, state: i < missingCount ? 'partial' : 'complete',
        observationCount: i < missingCount ? 269 : 270,
        lastMinute: i < missingCount ? '13:29' : '13:30',
        reason: i < missingCount ? 'close_minute_missing' : 'session_closed' }));
    const summary = { schemaVersion: 'intraday-monitor-daily-runner/1', runtimeMode: 'daily',
        tradeDate: date, previousTradeDate: previous, connectionGeneration: generation,
        planHash: 'fixture-plan', executionOutcome: 'partial', liveCoverageBySymbol: coverage,
        closeReceipt: { expectedCount: 160, sealedCount: 160 - missingCount,
            reason: 'close_incomplete', finalizedAt: `${date}T13:34:30+08:00` },
        stopReceipt: { stopped: true, unsubscribeAccepted: true },
        stream: { disconnect: null, transport: { malformedFrames: 0, sourceGapEvents: 0,
            sourceDroppedFrames: 0, sourceGapInvalid: false, nonKbarEventOverflow: 0,
            lastDisconnectReason: null } }, resources: { resourceFault: null },
        health: { incidentCount: 0 }, comparisonFailure: null,
        thresholdSwitch: { journalHealthy: true, lastFailure: null,
            activeComparisonRevision: 0, configHash: proof.configHash, transitionHash: null } };
    const liveRows = coverage.flatMap(c => keys.slice(0, c.observationCount).map((minute_key, i) => ({
        canonical_symbol: c.canonicalSymbol, minute_key, cumulative_volume: (i + 1) * 2,
        payload: { tradeDate: date, minuteKey: minute_key, contract: { canonicalSymbol: c.canonicalSymbol },
            cumulativeVolume: (i + 1) * 2, unit: 'common_lot', source: 'shioaji-kbar-stream',
            sourceVersion: 'fixture-only/1', continuity: 'complete', simtrade: false,
            intradayOdd: false, connectionGeneration: generation } })));
    const collectionReceipt = { outcome: 'complete', readyCount: 160, waitingCount: 0, conflictCount: 0,
        attempt: 1, claimId: 'fixture-claim', calendarVersion: 'fixture-calendar',
        sourceDate: date, targetDate: target, connectionGeneration: generation,
        results: manifests.map(m => ({ symbol: m.symbol, manifestId: m.manifestId, state: 'ready' })) };
    return { summary, session, liveRows, collectionReceipt, manifests, previousManifests,
        thresholdState: { initial, receipts: [] } };
}
test('三檔尾筆例外，完整量比、個別覆寫、零即時權限', () => {
    const f = fixture(), before = JSON.stringify(f.summary);
    const r = evaluateCloseTailException(f);
    assert.equal(r.state, 'passed_with_close_tail_exception');
    assert.equal(r.rows.length, 3);
    assert.equal(r.rows[0].ratio, 2);
    assert.equal(r.rows[0].comparison, 'matched');
    assert.equal(r.rows[1].threshold, '3');
    assert.equal(r.rows[1].comparison, 'not_matched');
    assert.equal(r.liveAcceptance, false);
    assert.equal(r.notificationAuthority, false);
    assert.equal(JSON.stringify(f.summary), before);
});
test('分母零不是0倍或達標', () => {
    const r = evaluateCloseTailException(fixture({ zeroBaseline: true }));
    assert.equal(r.state, 'passed_with_close_tail_exception');
    assert.equal(r.rows[0].ratio, null);
    assert.equal(r.rows[0].comparison, 'zero_baseline');
});
for (const n of [1, 10, 11]) test(`缺${n}檔邊界`, () =>
    assert.equal(evaluateCloseTailException(fixture({ missingCount: n })).state,
        n <= 10 ? 'passed_with_close_tail_exception' : 'rejected'));
const cases = [
    ['13:28不可當單筆', f => { f.summary.liveCoverageBySymbol[0].lastMinute = '13:28'; }],
    ['中段缺口', f => { f.liveRows[1].minute_key = '09:03'; }],
    ['歷史前綴', f => { f.liveRows[0].payload.source = 'shioaji-kbars-bootstrap'; }],
    ['generation不符', f => { f.session.connectionGeneration += 'changed'; }],
    ['未到收尾', f => { f.summary.closeReceipt.finalizedAt = `${date}T13:30:00+08:00`; }],
    ['資源故障', f => { f.summary.resources.resourceFault = 'backpressure'; }],
    ['gap通知', f => { f.summary.stream.transport.sourceGapEvents = 1; }],
    ['未知gap', f => { delete f.summary.stream.transport.sourceDroppedFrames; }],
    ['斷線', f => { f.summary.stream.disconnect = { reason: 'failed' }; }],
    ['比較故障', f => { f.summary.comparisonFailure = 'config_mismatch'; }],
    ['manifest毀損', f => { f.manifests[0].payloadHash = 'invalid'; }],
    ['前日日期錯誤', f => { f.previousManifests[0].tradeDate = '2026-10-13'; }],
    ['銜接量衝突', f => { const { manifestId, ...m } = f.manifests[0];
        m.cumulativeSeries[268].cumulativeVolume += 1;
        f.manifests[0] = { ...m, manifestId: hashHistoricalKbarValue(m) };
        f.collectionReceipt.results[0].manifestId = f.manifests[0].manifestId; }],
    ['收尾門檻不符', f => { f.summary.thresholdSwitch.activeComparisonRevision = 1; }],
    ['不可追認舊日', f => { f.summary.tradeDate = '2026-10-08'; }],
];
for (const [name, mutate] of cases) test(name, () => {
    const f = fixture(); mutate(f);
    assert.equal(evaluateCloseTailException(f).state, 'rejected');
});
test('盤後尚未完整保持pending，不採部分manifest', () => {
    const f = fixture(); f.collectionReceipt.readyCount = 159;
    assert.equal(evaluateCloseTailException(f).state, 'pending_postclose');
});
test('採收盤前真正durable門檻，不讀盤後全域設定', () => {
    const f = fixture(), receipts = [];
    const initial = f.thresholdState.initial;
    const core = createThresholdSwitchController({ ...initial,
        now: () => `${date}T10:01:00+08:00`,
        persistTransition: r => { receipts.push(r); return { persisted: true, transitionHash: r.transitionHash }; },
        persistFailure: () => ({ persisted: true }) });
    const config = { ...structuredClone(initial.config), revision: 1, globalThreshold: '3' };
    const switched = core.apply({ config, expectedComparisonRevision: 0,
        authority: { ...initial, current: true, dataPlaneAuthority: true, phase: 'running' },
        watermarks: initial.activeSymbols.map(canonicalSymbol => ({ canonicalSymbol,
            minuteKey: '10:00', currentCumulativeVolume: 120, previousCumulativeVolume: 60,
            receivedAt: `${date}T10:00:50+08:00`, sourceVersion: 'fixture-only/1',
            continuityComplete: true, baselineComplete: true, sourceComplete: true })) });
    assert.equal(switched.applied, true);
    f.thresholdState.receipts = receipts;
    f.summary.thresholdSwitch = { ...f.summary.thresholdSwitch,
        activeComparisonRevision: 1, configHash: switched.receipt.configHash,
        transitionHash: switched.receipt.transitionHash };
    // Unacknowledged/current config is intentionally not an input to the evaluator.
    config.globalThreshold = '1.5';
    const r = evaluateCloseTailException(f);
    assert.equal(r.state, 'passed_with_close_tail_exception');
    assert.equal(r.rows[0].threshold, '3');
    assert.equal(r.rows[0].comparisonRevision, 1);
    assert.equal(r.rows[0].comparison, 'not_matched');
});
test('獨立補算入口無完成原收據只回pending，不建立任何檔案', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'close-tail-no-collection-'));
    try {
        assert.equal((await assessCompletedDailyCloseTail({ root, tradeDate: date })).state, 'pending_postclose');
        assert.deepEqual(fs.readdirSync(root), []);
    } finally { fs.rmdirSync(root); }
});
test('本機真實SQLite與不可變收據：no-op、衝突拒絕、reader損壞不通過', async () => {
    const f = fixture();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'close-tail-fixture-'));
    const monitor = path.join(root, 'IntradayMonitor'), dir = path.join(monitor, 'daily-run', date);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(monitor, 'session-state', 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(f.summary));
    fs.writeFileSync(path.join(monitor, 'session-state', 'sessions', `${date}.json`), JSON.stringify(f.session));
    const collectionDir = path.join(monitor, 'daily-minute-volume-collection', date);
    fs.mkdirSync(collectionDir, { recursive: true });
    fs.writeFileSync(path.join(collectionDir, 'attempt-01-receipt.json'), JSON.stringify(f.collectionReceipt));
    fs.writeFileSync(path.join(collectionDir, 'attempt-01-claim.json'), JSON.stringify({
        claimId: 'fixture-claim', attempt: 1, ownerPid: process.pid, sourceDate: date, targetDate: target,
        connectionGeneration: generation, requestedSymbols: f.manifests.map(m => m.symbol) }));
    const journal = new ThresholdSwitchRepository(path.join(monitor, 'threshold-switch.sqlite3'));
    journal.initialize(f.thresholdState.initial); journal.close();
    const live = new DatabaseSync(path.join(monitor, 'intraday-monitor-evidence.sqlite3'));
    live.exec('CREATE TABLE intraday_monitor_observations(canonical_symbol TEXT,trade_date TEXT,minute_key TEXT,cumulative_volume INTEGER,payload_json TEXT);BEGIN');
    const insert = live.prepare('INSERT INTO intraday_monitor_observations VALUES(?,?,?,?,?)');
    for (const r of f.liveRows) insert.run(r.canonical_symbol, date, r.minute_key, r.cumulative_volume, JSON.stringify(r.payload));
    live.exec('COMMIT'); live.close();
    const db = new DatabaseSync(path.join(monitor, 'daily-minute-volume-baselines.sqlite3'));
    db.exec('CREATE TABLE daily_baseline_manifests(symbol TEXT,source_date TEXT,target_date TEXT,manifest_json TEXT);BEGIN');
    const put = db.prepare('INSERT INTO daily_baseline_manifests VALUES(?,?,?,?)');
    for (const m of [...f.manifests, ...f.previousManifests]) put.run(m.symbol, m.tradeDate, m.targetTradeDate, JSON.stringify(m));
    db.exec('COMMIT'); db.close();
    try {
        const input = { root, tradeDate: date, collectionReceipt: f.collectionReceipt };
        await assert.rejects(() => publishCloseTailException({ ...input,
            collectionReceipt: { ...f.collectionReceipt, claimId: 'forged-claim' } }), /origin_conflict/);
        const sourceFiles = [path.join(dir, 'summary.json'), path.join(monitor, 'intraday-monitor-evidence.sqlite3'),
            path.join(collectionDir, 'attempt-01-claim.json'), path.join(collectionDir, 'attempt-01-receipt.json')];
        const sourceHashes = () => sourceFiles.map(file => createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
        const before = sourceHashes();
        const a = await publishCloseTailException(input);
        assert.equal(a.state, 'passed_with_close_tail_exception');
        assert.equal((await publishCloseTailException(input)).alreadyPresent, true);
        assert.deepEqual(sourceHashes(), before);
        assert.equal(fs.statSync(a.file).mode & 0o777, 0o600);
        assert.equal(readCloseTailExceptionView({ root, tradeDate: date, summary: JSON.stringify(f.summary) }).state,
            'passed_with_close_tail_exception');
        assert.equal(readCloseTailExceptionView({ root, tradeDate: date, summary: 'changed' }).state, 'invalid_evidence');
        const rejectedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'close-tail-rejected-fixture-'));
        try {
            fs.cpSync(root, rejectedRoot, { recursive: true });
            const rejectedDir = path.join(rejectedRoot, 'IntradayMonitor', 'daily-run', date);
            fs.unlinkSync(path.join(rejectedDir, 'daily-close-tail-exception.json'));
            const unsafeSummary = { ...f.summary, resources: { resourceFault: 'fixture_failure' } };
            const unsafeText = JSON.stringify(unsafeSummary);
            fs.writeFileSync(path.join(rejectedDir, 'summary.json'), unsafeText);
            assert.equal((await publishCloseTailException({ ...input, root: rejectedRoot })).state, 'rejected');
            assert.equal(readCloseTailExceptionView({ root: rejectedRoot, tradeDate: date, summary: unsafeText }).state, 'rejected');
        } finally { fs.rmSync(rejectedRoot, { recursive: true, force: true }); }
        const original = fs.readFileSync(a.file, 'utf8');
        fs.writeFileSync(a.file, original.replace('"artifactHash":"', '"artifactHash":"bad'));
        assert.equal(readCloseTailExceptionView({ root, tradeDate: date, summary: JSON.stringify(f.summary) }).state, 'invalid_evidence');
        await assert.rejects(() => publishCloseTailException(input), /assessment_conflict/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
