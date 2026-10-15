import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { INTRADAY_MONITOR_CONFIG_SCHEMA,
    INTRADAY_MONITOR_OBSERVATION_SCHEMA, validateIntradayMonitorConfig }
    from '../../src/lib/intraday-relative-volume-monitor-domain.ts';
import { expectedTaiwanRegularSessionMinutes } from './historical-kbar-repair.mjs';
import { createDailyMinuteVolumeCandidate, DAILY_KBAR_TIMESTAMP_ENCODING,
    verifyDailyMinuteVolumeBaseline } from './daily-minute-volume-baseline.mjs';
import { createDailyMinuteVolumeProductSink } from './daily-minute-volume-product-sink.mjs';
import { IntradayMonitorEvidenceRepository } from './evidence-repository.mjs';
import { IntradayMonitorConfigRepository } from './config-repository.mjs';
import { createThresholdRuntime, readThresholdSwitchView } from './threshold-runtime.mjs';
import { thresholdConfigForRequest, isThresholdConfigCompatibility } from './threshold-switch-controller.mjs';
import { resolveThresholdSwitchDatabasePath } from './threshold-switch-repository.mjs';

const previousTradeDate = '2026-10-05';
const tradeDate = '2026-10-06';
const generation = 'simulation:test-generation-001';
const contract = { securityType: 'STK', region: 'TW', exchange: 'TSE',
    code: '2330', targetCode: null, canonicalSymbol: '2330.TW' };

function manifest() {
    const minutes = expectedTaiwanRegularSessionMinutes();
    const entry = { canonicalSymbol: contract.canonicalSymbol, contractIdentity: {
        security_type: 'STK', region: 'TW', exchange: 'TSE', code: '2330', target_code: null } };
    const candidate = createDailyMinuteVolumeCandidate({ entry,
        contract: { ...entry.contractIdentity, unit: 1000,
            trading_suspended: false, update_date: previousTradeDate },
        kbars: { fetchedAt: '2026-10-05T13:35:00+08:00', data: {
            datetime: minutes.map(key => `${previousTradeDate}T${key}:00`),
            Open: minutes.map(() => 100), High: minutes.map(() => 101),
            Low: minutes.map(() => 99), Close: minutes.map(() => 100),
            Volume: minutes.map(() => 2), Amount: minutes.map(() => 2000),
        } }, tradeDate: previousTradeDate, sourceVersion: 'fixture/1',
        timestampEncoding: DAILY_KBAR_TIMESTAMP_ENCODING });
    const verified = verifyDailyMinuteVolumeBaseline({ candidate, authority: {
        officialTradingDay: true, identityVerified: true, instrumentStatus: 'normal',
        calendarVerified: true, symbol: '2330.TW', exchange: 'TSE', securityType: 'STK',
        tradeDate: previousTradeDate, previousApplicableTradeDate: previousTradeDate,
        targetTradeDate: tradeDate, timeZone: 'Asia/Taipei',
        calendarSource: 'fixture-calendar', calendarSourceVersion: 'fixture-calendar/1',
    }, now: '2026-10-05T13:36:00+08:00' });
    assert.equal(verified.ok, true);
    return verified.manifest;
}

function config() {
    const validated = validateIntradayMonitorConfig({
        schemaVersion: INTRADAY_MONITOR_CONFIG_SCHEMA, revision: 1,
        globalThreshold: '2', items: [{ contract: {
            security_type: 'STK', region: 'TW', exchange: 'TSE', code: '2330', target_code: null,
        }, enabled: true, thresholdOverride: null, source: 'manual' }],
    });
    assert.equal(validated.ok, true);
    return validated.value;
}

function observation(minuteKey, cumulativeVolume, sequence) {
    return { schemaVersion: INTRADAY_MONITOR_OBSERVATION_SCHEMA, contract,
        tradeDate, minuteKey, exchangeTime: `${minuteKey}:59.000000`,
        receivedTime: `${tradeDate}T${minuteKey}:59+08:00`,
        connectionGeneration: generation, sequence, cumulativeVolume,
        unit: 'common_lot', source: 'shioaji-kbar-stream', sourceVersion: 'fixture/1',
        simtrade: false, intradayOdd: false, continuity: 'complete' };
}

function setup(readSuppressedSymbols = () => []) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'daily-product-sink-'));
    const evidenceDatabasePath = path.join(root, 'evidence.sqlite3');
    const recordedObservations = [];
    const sessionAuthority = { evaluate: () => ({ current: true,
        dataPlaneAuthority: true, notificationAuthority: true }),
        recordObservation: (value) => recordedObservations.push(value) };
    const sink = createDailyMinuteVolumeProductSink({ manifests: [manifest()],
        config: config(), tradeDate, previousTradeDate, connectionGeneration: generation,
        evidenceDatabasePath, sessionAuthority, readSuppressedSymbols });
    return { root, sink, evidenceDatabasePath, recordedObservations, cleanup() {
        rmSync(root, { recursive: true, force: true }); } };
}

test('daily sink compares same sealed minute and persists only observations/triggers', () => {
    const env = setup();
    try {
        const first = env.sink.receive(observation('09:01', 2, 1));
        assert.equal(first.classification, 'not_matched');
        assert.equal(first.triggerCreated, false);
        const second = env.sink.receive(observation('09:02', 10, 2));
        assert.equal(second.classification, 'matched');
        assert.equal(second.triggerCreated, true);
        assert.equal(second.notificationEligible, true);
        assert.deepEqual(env.recordedObservations.map(({ completedMinute,
            currentCumulativeVolume, previousCumulativeVolume }) => ({ completedMinute,
            currentCumulativeVolume, previousCumulativeVolume })), [
            { completedMinute: '09:01', currentCumulativeVolume: 2,
                previousCumulativeVolume: 2 },
            { completedMinute: '09:02', currentCumulativeVolume: 10,
                previousCumulativeVolume: 4 },
        ]);
        const state = env.sink.snapshot();
        assert.equal(state.runtimeMode, 'daily');
        assert.equal(state.items[0].lastComparableMinute, '09:02');
        assert.equal(state.items[0].triggerCount, 1);
        const closed = env.sink.close();
        assert.equal(closed.phase, 'ended');
        assert.equal(closed.notificationAuthority, false);
        assert.deepEqual(closed.aggregate.map(row => row.observationCount), [2]);
        const repository = new IntradayMonitorEvidenceRepository(env.evidenceDatabasePath);
        assert.equal(repository.getBaselineMinute('2330.TW', previousTradeDate,
            '09:02')?.cumulativeVolume, 4);
        repository.close();
    } finally { env.cleanup(); }
});

test('真實SQLite bridge的2→3→1.5切換保留原session，分鐘持续寫入且重分類不通知', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'threshold-sink-integration-'));
    const configFile = path.join(root, 'config.sqlite3');
    const repository = new IntradayMonitorConfigRepository(configFile);
    let runtime, sink, at = `${tradeDate}T09:01:59+08:00`;
    const session = { sessionId:'fixture-session-integration',tradeDate,previousTradeDate,
        connectionGeneration:generation,configRevision:1 };
    try {
        const raw = {...thresholdConfigForRequest(config()),revision:0};
        const initial = repository.replace(raw);
        const claimPath = path.join(root, 'direct-160-live', 'registry', 'fixture-claim.json');
        mkdirSync(path.dirname(claimPath), {recursive:true});
        writeFileSync(path.join(path.dirname(claimPath),'active.lock'), JSON.stringify({
            ownerPid:process.pid,tradeDate,connectionGeneration:generation,claimPath }));
        runtime = createThresholdRuntime({root,session,initialConfig:initial,activeSymbols:['2330.TW'],
            ownerId:path.basename(claimPath),ownerPid:process.pid,configDatabasePath:configFile,
            readConfig:()=>repository.read(),now:()=>at});
        const sessionAuthority = {evaluate:()=>({current:isThresholdConfigCompatibility(
            runtime.compatibility(repository.read()),session,repository.read().revision),
            dataPlaneAuthority:true,notificationAuthority:true,phase:'running'}),recordObservation:()=>{}};
        sink = createDailyMinuteVolumeProductSink({manifests:[manifest()],config:initial,tradeDate,
            previousTradeDate,connectionGeneration:generation,evidenceDatabasePath:path.join(root,'evidence.sqlite3'),
            sessionAuthority,thresholdRuntime:runtime,now:()=>at});
        expectAccepted(sink.receive(observation('09:01',4,1)));
        for (const [threshold,minute,volume,sequence] of [['3','09:02',8,2],['1.5','09:03',12,3]]) {
            const current = repository.read();
            repository.replace({...thresholdConfigForRequest(current),globalThreshold:threshold});
            at = `${tradeDate}T${minute}:00+08:00`;
            assert.equal(sink.syncThresholds().applied,true);
            assert.equal(readThresholdSwitchView(root,session,repository.read()).state,'applied');
            at = `${tradeDate}T${minute}:59+08:00`;
            expectAccepted(sink.receive(observation(minute,volume,sequence)));
        }
        assert.equal(session.configRevision,1);
        assert.equal(runtime.snapshot().activeComparisonRevision,3);
        const state = sink.snapshot();
        assert.equal(state.items[0].observationCount,3);
        assert.equal(state.items[0].lastMinute,'09:03');
        assert.equal(state.comparisonFailure,null);
        const faultDb = new DatabaseSync(resolveThresholdSwitchDatabasePath(root));
        faultDb.exec("CREATE TRIGGER fixture_reject_switch BEFORE INSERT ON threshold_receipts BEGIN SELECT RAISE(ABORT,'fixture_disk_refusal'); END;");
        faultDb.close();
        repository.replace({...thresholdConfigForRequest(repository.read()),globalThreshold:'3'});
        at = `${tradeDate}T09:04:00+08:00`;
        assert.equal(sink.syncThresholds().applied,false);
        assert.equal(readThresholdSwitchView(root,session,repository.read()).state,'failed');
        at = `${tradeDate}T09:04:59+08:00`;
        const result = sink.receive(observation('09:04',15,4));
        assert.equal(result.accepted,true);
        assert.equal(result.classification,'matched'); // 原1.5倍仍有效，保存3倍未冒充套用。
        assert.equal(result.notificationEligible,false);
        assert.equal(sink.snapshot().items[0].observationCount,4);
        assert.equal(runtime.snapshot().activeComparisonRevision,3);
    } finally {sink?.close();runtime?.close();repository.close();rmSync(root,{recursive:true,force:true});}
    function expectAccepted(value){assert.equal(value.accepted,true);}
});

test('late first minute becomes partial and cannot produce retrospective trigger', () => {
    const env = setup();
    try {
        const late = env.sink.receive(observation('09:02', 10, 1));
        assert.equal(late.accepted, true);
        assert.equal(late.comparable, false);
        assert.deepEqual(env.recordedObservations[0], {
            canonicalSymbol: '2330.TW', receivedAt: `${tradeDate}T09:02:59+08:00`,
            continuityComplete: false, completedMinute: '09:02',
            currentCumulativeVolume: 10, previousCumulativeVolume: 4,
        });
        const next = env.sink.receive(observation('09:03', 12, 2));
        assert.equal(next.comparable, false);
        const status = env.sink.snapshot();
        assert.equal(status.items[0].state, 'waiting_continuity');
        assert.equal(status.items[0].triggerCount, 0);
        env.sink.close();
    } finally { env.cleanup(); }
});

test('persistent suppression keeps live observation but never compares or notifies until a later live minute', () => {
    let suppressed = ['2330.TW'];
    const env = setup(() => suppressed);
    try {
        const first = env.sink.receive(observation('09:01', 2, 1));
        assert.deepEqual({ accepted: first.accepted, comparable: first.comparable,
            notificationEligible: first.notificationEligible },
        { accepted: true, comparable: false, notificationEligible: false });
        assert.equal(env.sink.snapshot().items[0].state, 'suppressed');
        suppressed = [];
        const next = env.sink.receive(observation('09:02', 10, 2));
        assert.equal(next.comparable, true);
        assert.equal(next.triggerCreated, true);
        assert.equal(env.sink.snapshot().items[0].observationCount, 2);
        env.sink.close();
    } finally { env.cleanup(); }
});

test('dynamic partial gate keeps a missing-baseline slot without comparing or notifying it', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'daily-product-partial-'));
    const second = { ...contract, code: '2317', canonicalSymbol: '2317.TW' };
    const original = config();
    const dynamicConfig = { ...original, items: [...original.items,
        { ...original.items[0], contract: second }] };
    const evidenceDatabasePath = path.join(root, 'evidence.sqlite3');
    const recordedObservations = [];
    const sink = createDailyMinuteVolumeProductSink({ manifests: [manifest()],
        config: dynamicConfig, tradeDate, previousTradeDate,
        connectionGeneration: generation, evidenceDatabasePath,
        allowMissingBaseline: true,
        sessionAuthority: { evaluate: () => ({ current: true,
            dataPlaneAuthority: true, notificationAuthority: true }),
            recordObservation: (value) => recordedObservations.push(value) } });
    try {
        const missing = sink.receive({ ...observation('09:01', 20, 1), contract: second });
        assert.deepEqual({ accepted: missing.accepted, comparable: missing.comparable,
            notificationEligible: missing.notificationEligible },
        { accepted: true, comparable: false, notificationEligible: false });
        assert.equal(sink.snapshot().items.find(item => item.canonicalSymbol === '2317.TW').state,
            'waiting_baseline');
        assert.equal(recordedObservations[0].completedMinute, '09:01');
        assert.equal(recordedObservations[0].currentCumulativeVolume, 20);
        assert.equal(recordedObservations[0].previousCumulativeVolume, null);
        assert.equal(sink.receive(observation('09:01', 2, 2)).comparable, true);
        assert.equal(sink.close().aggregate.length, 2);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
