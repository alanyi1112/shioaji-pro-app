import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import {saveSpecialMarketClosure} from './special-market-closures.mjs';
import os from 'node:os';
import path from 'node:path';

import { INTRADAY_MONITOR_CONFIG_SCHEMA, validateIntradayMonitorConfig }
    from '../../src/lib/intraday-relative-volume-monitor-domain.ts';
import { expectedTaiwanRegularSessionMinutes } from './historical-kbar-repair.mjs';
import { createDailyMinuteVolumeCandidate, DAILY_KBAR_TIMESTAMP_ENCODING,
    verifyDailyMinuteVolumeBaseline } from './daily-minute-volume-baseline.mjs';
import { createDailyMinuteVolumeRunner } from './daily-minute-volume-runner.mjs';
import { validateDirect160GapBootstrap } from './direct-160-gap-bootstrap.mjs';
import { IntradayMonitorEvidenceRepository } from './evidence-repository.mjs';
import { inspectDirect160ActiveClaim } from './direct-160-run-registry.mjs';

const sourceDate = '2026-10-05';
const targetDate = '2026-10-06';
const generation = 'simulation:daily-test-generation-001';
const planHash = 'a'.repeat(64);

function fixture() {
    const entry = { canonicalSymbol: '2330.TW', contractIdentity: {
        security_type: 'STK', region: 'TW', exchange: 'TSE', code: '2330', target_code: null } };
    const minutes = expectedTaiwanRegularSessionMinutes();
    const candidate = createDailyMinuteVolumeCandidate({ entry,
        contract: { ...entry.contractIdentity, unit: 1000,
            trading_suspended: false, update_date: sourceDate },
        kbars: { fetchedAt: `${sourceDate}T13:35:00+08:00`, data: {
            datetime: minutes.map(minute => `${sourceDate}T${minute}:00`),
            Open: minutes.map(() => 100), High: minutes.map(() => 101),
            Low: minutes.map(() => 99), Close: minutes.map(() => 100),
            Volume: minutes.map(() => 2), Amount: minutes.map(() => 2000),
        } }, tradeDate: sourceDate, sourceVersion: 'fixture/1',
        timestampEncoding: DAILY_KBAR_TIMESTAMP_ENCODING });
    const verified = verifyDailyMinuteVolumeBaseline({ candidate, authority: {
        officialTradingDay: true, identityVerified: true, instrumentStatus: 'normal',
        calendarVerified: true, symbol: '2330.TW', exchange: 'TSE', securityType: 'STK',
        tradeDate: sourceDate, previousApplicableTradeDate: sourceDate,
        targetTradeDate: targetDate, timeZone: 'Asia/Taipei',
        calendarSource: 'fixture', calendarSourceVersion: 'fixture/1',
    }, now: `${sourceDate}T13:36:00+08:00` });
    assert.equal(verified.ok, true);
    const config = validateIntradayMonitorConfig({
        schemaVersion: INTRADAY_MONITOR_CONFIG_SCHEMA, revision: 1,
        globalThreshold: '2', items: [{ contract: entry.contractIdentity,
            enabled: true, thresholdOverride: null, source: 'manual' }],
    });
    assert.equal(config.ok, true);
    return { manifests: [verified.manifest], config: config.value };
}

test('single shared owner and SQLite sink work without Stage/capture; summary is partial when not sealed', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'daily-runner-'));
    let clock = Date.parse(`${targetDate}T08:50:00+08:00`);
    let onEvent, subscriptions = 0, stops = 0;
    const transportFactory = options => {
        onEvent = options.onEvent;
        return { async start() { subscriptions++;
            return { started: true, cohortSize: 1, subscribeAccepted: true }; },
        async stop() { stops++; return { stopped: true, unsubscribeAccepted: true }; },
        status() { return { phase: stops ? 'stopped' : 'running', subscriptionCount: subscriptions }; } };
    };
    try {
        writeFileSync(path.join(root, 'runtime-mode'), 'simulation\n');
        writeFileSync(path.join(root, 'runtime-api-generation'), `${generation}\n`);
        const inputs = { ...fixture(), appSupportRoot: root, tradeDate: targetDate,
            previousTradeDate: sourceDate, connectionGeneration: generation, planHash,
            sessionAuthority: { evaluate() { return { current: true,
                controlPlaneAuthority: true, dataPlaneAuthority: true,
                notificationAuthority: true }; },
            markControlPlane() { return { current: true }; },
            recordFirstKbar() { return { current: true }; },
            recordObservation() { return { current: true }; },
            beginClosing() { return { current: true }; } },
            now: () => new Date(clock).toISOString(), nowEpochMs: () => clock,
            transportFactory, limits: { maxRssBytes: Number.MAX_SAFE_INTEGER,
                minimumFreeDiskBytes: 1, maximumEventProcessingMs: 10000 } };
        const first = createDailyMinuteVolumeRunner(inputs);
        assert.equal((await first.start()).started, true);
        assert.ok(await inspectDirect160ActiveClaim(path.join(root, 'direct-160-live', 'registry')));
        const second = createDailyMinuteVolumeRunner(inputs);
        await assert.rejects(() => second.start(), /daily_monitor_session_already_active/);
        const event = (minute, volume) => ({ schemaVersion: 'intraday-monitor-kbar-event/1',
            code: '2330', date: targetDate, time: `${minute}:00`, volume,
            receivedTime: new Date(clock).toISOString(), connectionGeneration: generation,
            unit: 'common_lot', sourceVersion: 'fixture/1' });
        clock = Date.parse(`${targetDate}T09:01:10+08:00`);
        assert.equal(onEvent(event('09:01', 2)).accepted, true);
        clock = Date.parse(`${targetDate}T09:02:10+08:00`);
        assert.equal(onEvent(event('09:02', 8)).accepted, true);
        clock = Date.parse(`${targetDate}T09:03:10+08:00`);
        assert.equal(onEvent(event('09:03', 2)).accepted, true);
        assert.equal(first.status().sink.items[0].lastComparableMinute, '09:02');
        assert.throws(() => first.beginClosing(), /daily_runner_closing_window_invalid/);
        clock = Date.parse(`${targetDate}T13:30:15+08:00`);
        assert.equal(first.beginClosing().delayedCloseStillAccepted, true);
        clock = Date.parse(`${targetDate}T13:34:30+08:00`);
        assert.equal(first.sealClose().accepted, false);
        const stopped = await first.stop();
        assert.equal(stopped.stopped, true);
        assert.equal(stopped.receipt.executionOutcome, 'partial');
        assert.equal(stopped.receipt.aggregate[0].observationCount, 2);
        assert.equal(subscriptions, 1);
        assert.equal(stops, 1);
        assert.equal(await inspectDirect160ActiveClaim(path.join(root, 'direct-160-live', 'registry')), null);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

function localRuntime(root, clock, transportFactory, extra = {}) {
    writeFileSync(path.join(root, 'runtime-mode'), 'simulation\n');
    writeFileSync(path.join(root, 'runtime-api-generation'), `${generation}\n`);
    return { ...fixture(), appSupportRoot: root, tradeDate: targetDate,
        previousTradeDate: sourceDate, connectionGeneration: generation, planHash,
        sessionAuthority: { evaluate() { return { current: true,
            controlPlaneAuthority: true, dataPlaneAuthority: true,
            notificationAuthority: true }; },
        markControlPlane() { return { current: true }; },
        recordFirstKbar() { return { current: true }; },
        recordObservation() { return { current: true }; },
        beginClosing() { return { current: true }; } },
        now: () => new Date(clock.value).toISOString(), nowEpochMs: () => clock.value,
        transportFactory, limits: { maxRssBytes: Number.MAX_SAFE_INTEGER,
            minimumFreeDiskBytes: 1, maximumEventProcessingMs: 10_000,
            diskCheckIntervalMs: 1_000 }, ...extra };
}

test('late special closure blocks subsequent comparison, transport and health without deleting prior receipts', async()=>{
    const root=realpathSync(mkdtempSync(path.join(os.tmpdir(),'daily-runner-manual-close-')));
    const clock={value:Date.parse(`${targetDate}T08:50:00+08:00`)};
    let onEvent,transportFetch,fetches=0;
    const transportFactory=options=>{onEvent=options.onEvent;transportFetch=options.fetchImpl;
        return {async start(){return {started:true,cohortSize:1,subscribeAccepted:true};},
            async stop(){return {stopped:true};},status(){return {phase:'running',streamActive:true};}};};
    try {
        const runner=createDailyMinuteVolumeRunner(localRuntime(root,clock,transportFactory,{fetchImpl:async()=>{fetches++;throw Error('unexpected_request');}}));
        assert.equal((await runner.start()).started,true);
        clock.value=Date.parse(`${targetDate}T09:01:10+08:00`);
        saveSpecialMarketClosure(root,{action:'close',date:targetDate,reason:'開盤後臨時宣布休市',expectedRevision:0,confirmed:true},{now:new Date(clock.value)});
        const result=onEvent({schemaVersion:'intraday-monitor-kbar-event/1',code:'2330',date:targetDate,time:'09:01:00',volume:2,
            receivedTime:new Date(clock.value).toISOString(),connectionGeneration:generation,unit:'common_lot',sourceVersion:'fixture/1'});
        assert.equal(result.accepted,false);assert.equal(result.reason,'special_market_closure');
        assert.throws(()=>transportFetch('http://127.0.0.1:8080/unused'),/special_market_closure/);
        assert.equal(fetches,0);assert.equal((await runner.checkHealth()).reason,'special_market_closure');
        const stopped=await runner.stop();assert.equal(stopped.stopped,true);
    }finally{rmSync(root,{recursive:true,force:true});}
});

function streamEvent(clock, minute, volume) {
    return { schemaVersion: 'intraday-monitor-kbar-event/1',
        code: '2330', date: targetDate, time: `${minute}:00`, volume,
        receivedTime: new Date(clock.value).toISOString(), connectionGeneration: generation,
        unit: 'common_lot', sourceVersion: 'fixture/1' };
}

test('來源gap保存事故及未知商品範圍，不重連健康socket且不掩蓋後續長期沉默', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'daily-source-gap-'));
    const clock = { value: Date.parse(`${targetDate}T08:50:00+08:00`) };
    let onEvent, starts = 0, reconnects = 0;
    const transportFactory = options => {
        onEvent = options.onEvent;
        return {
            async start() { starts++; return { started: true, subscribeAccepted: true }; },
            async stop() { return { stopped: true, unsubscribeAccepted: true }; },
            async reconnectEndedStream() { reconnects++; return { recovered: true }; },
            status() { return { phase: 'running', streamActive: true, sourceGapEvents: 1,
                sourceDroppedFrames: 2, sourceGapInvalid: false, sourceGapSamples: [] }; },
        };
    };
    try {
        const runner = createDailyMinuteVolumeRunner(localRuntime(root, clock, transportFactory));
        await runner.start();
        clock.value = Date.parse(`${targetDate}T09:01:10+08:00`);
        onEvent(streamEvent(clock, '09:01', 2));
        assert.equal((await runner.checkHealth()).reason, 'kbar_source_gap_reported');
        clock.value = Date.parse(`${targetDate}T09:06:10+08:00`);
        assert.equal((await runner.checkHealth()).reason, 'kbar_source_silent');
        clock.value = Date.parse(`${targetDate}T09:09:11+08:00`);
        await assert.rejects(() => runner.checkHealth(), /daily_runner_stream_unrecoverable/);
        const stopped = await runner.stop();
        assert.equal(stopped.receipt.executionOutcome, 'partial');
        const incident = JSON.parse(readFileSync(stopped.receipt.health.incidents[0].incidentPath, 'utf8'));
        assert.equal(incident.transport.sourceDroppedFrames, 2);
        assert.equal(incident.transport.affectedSymbols, null);
        assert.equal(starts, 1);
        assert.equal(reconnects, 0);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('最後健康檢查後才報來源gap也不可把完整欄位數誤判為全日ended', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'daily-final-gap-'));
    const clock = { value: Date.parse(`${targetDate}T08:50:00+08:00`) };
    let onEvent, sourceGapEvents = 0;
    const transportFactory = options => {
        onEvent = options.onEvent;
        return { async start() { return { started: true, subscribeAccepted: true }; },
            async stop() { sourceGapEvents = 1; return { stopped: true, unsubscribeAccepted: true }; },
            status() { return { phase: 'running', streamActive: true, sourceGapEvents,
                sourceDroppedFrames: sourceGapEvents ? 2 : 0 }; } };
    };
    try {
        const runner = createDailyMinuteVolumeRunner(localRuntime(root, clock, transportFactory));
        await runner.start();
        for (const minute of expectedTaiwanRegularSessionMinutes()) {
            clock.value = Date.parse(`${targetDate}T${minute}:10+08:00`);
            assert.equal(onEvent(streamEvent(clock, minute, 2)).accepted, true);
        }
        clock.value = Date.parse(`${targetDate}T13:30:15+08:00`);
        runner.beginClosing();
        assert.equal((await runner.checkHealth()).state, 'healthy');
        clock.value = Date.parse(`${targetDate}T13:34:30+08:00`);
        assert.equal(runner.sealClose().accepted, true);
        const stopped = await runner.stop();
        assert.equal(stopped.receipt.aggregate[0].observationCount, 270);
        assert.equal(stopped.receipt.executionOutcome, 'partial');
        assert.equal(stopped.receipt.stream.transport.sourceDroppedFrames, 2);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runtime disk reserve fault is measured, fail-closed, and scoped without erasing committed observations', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'daily-runner-disk-'));
    const clock = { value: Date.parse(`${targetDate}T08:50:00+08:00`) };
    let onEvent, diskAvailable = 1024;
    const transportFactory = options => { onEvent = options.onEvent; return {
        async start() { return { started: true, subscribeAccepted: true }; },
        async stop() { return { stopped: true, unsubscribeAccepted: true }; },
        status() { return { phase: 'running' }; },
    }; };
    try {
        const runner = createDailyMinuteVolumeRunner(localRuntime(root, clock,
            transportFactory, { diskSpaceProbe: () => diskAvailable }));
        await runner.start();
        clock.value = Date.parse(`${targetDate}T09:01:10+08:00`);
        assert.equal(onEvent(streamEvent(clock, '09:01', 2)).accepted, true);
        clock.value = Date.parse(`${targetDate}T09:02:10+08:00`);
        assert.equal(onEvent(streamEvent(clock, '09:02', 3)).accepted, true);
        assert.equal(runner.status().sink.items[0].observationCount, 1);
        diskAvailable = 0;
        clock.value = Date.parse(`${targetDate}T09:03:10+08:00`);
        assert.deepEqual(onEvent(streamEvent(clock, '09:03', 4)),
            { accepted: false, reason: 'disk_reserve_insufficient' });
        assert.equal(runner.status().sink.items[0].observationCount, 1);
        const stopped = await runner.stop();
        assert.equal(stopped.receipt.executionOutcome, 'partial');
        assert.equal(stopped.receipt.resources.resourceFault, 'disk_reserve_insufficient');
        assert.equal(stopped.receipt.resources.affectedScope, 'all_active_symbols');
        assert.equal(stopped.receipt.resources.lastAvailableDiskBytes, 0);
        assert.ok(stopped.receipt.resources.cpuUserMicroseconds >= 0);
        assert.ok(stopped.receipt.resources.cpuSystemMicroseconds >= 0);
        assert.ok(stopped.receipt.resources.evidenceDatabaseBytes > 0);
        assert.equal(stopped.receipt.aggregate[0].observationCount, 1);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('one 3006 ms processing outlier is measured without rejecting the remaining stream', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'daily-runner-outlier-'));
    const clock = { value: Date.parse(`${targetDate}T08:50:00+08:00`) };
    let onEvent, probes = 0;
    const transportFactory = options => { onEvent = options.onEvent; return {
        async start() { return { started: true, subscribeAccepted: true }; },
        async stop() { return { stopped: true, unsubscribeAccepted: true }; },
        status() { return { phase: 'running' }; },
    }; };
    try {
        const runner = createDailyMinuteVolumeRunner(localRuntime(root, clock,
            transportFactory, { limits: { maxRssBytes: Number.MAX_SAFE_INTEGER,
                minimumFreeDiskBytes: 1, maximumEventProcessingMs: 3_000,
                diskCheckIntervalMs: 1_000 }, diskSpaceProbe: () => {
                if (++probes === 2) clock.value += 3_006;
                return 1024;
            } }));
        await runner.start();
        clock.value = Date.parse(`${targetDate}T09:01:10+08:00`);
        assert.equal(onEvent(streamEvent(clock, '09:01', 2)).accepted, true);
        clock.value = Date.parse(`${targetDate}T09:02:10+08:00`);
        assert.equal(onEvent(streamEvent(clock, '09:02', 3)).accepted, true);
        assert.equal(runner.status().maxEventProcessingMs, 3_006);
        assert.equal(runner.status().slowEventCount, 1);
        assert.equal(runner.status().resourceFault, null);
        assert.equal((await runner.checkHealth()).state, 'healthy');
        clock.value = Date.parse(`${targetDate}T09:03:10+08:00`);
        assert.equal(onEvent(streamEvent(clock, '09:03', 4)).accepted, true);
        assert.equal(runner.status().sink.items[0].observationCount, 2);
        const stopped = await runner.stop();
        assert.equal(stopped.receipt.resources.maxEventProcessingMs, 3_006);
        assert.equal(stopped.receipt.resources.slowEventCount, 1);
        assert.equal(stopped.receipt.resources.resourceFault, null);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('hard processing stall preserves committed event, records incident, and blocks later events', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'daily-runner-backpressure-'));
    const clock = { value: Date.parse(`${targetDate}T08:50:00+08:00`) };
    let onEvent, probes = 0;
    const transportFactory = options => { onEvent = options.onEvent; return {
        async start() { return { started: true, subscribeAccepted: true }; },
        async stop() { return { stopped: true, unsubscribeAccepted: true }; },
        status() { return { phase: 'running' }; },
    }; };
    try {
        const runner = createDailyMinuteVolumeRunner(localRuntime(root, clock,
            transportFactory, { diskSpaceProbe: () => {
                if (++probes === 2) clock.value += 55_000;
                return 1024;
            } }));
        await runner.start();
        clock.value = Date.parse(`${targetDate}T09:01:10+08:00`);
        assert.equal(onEvent(streamEvent(clock, '09:01', 2)).accepted, true);
        clock.value = Date.parse(`${targetDate}T09:02:10+08:00`);
        const committed = onEvent(streamEvent(clock, '09:02', 3));
        assert.equal(committed.accepted, true);
        assert.equal(committed.sealedMinute, '09:01');
        assert.equal(runner.status().resourceFault, 'event_processing_backpressure');
        await assert.rejects(() => runner.checkHealth(), /daily_runner_resource_unrecoverable/);
        assert.equal(runner.status().health.incidentCount, 1);
        const incident = JSON.parse(readFileSync(path.join(root, 'IntradayMonitor',
            'daily-run', targetDate, 'incidents', '001.json'), 'utf8'));
        assert.equal(incident.reason, 'event_processing_backpressure');
        assert.equal(incident.fatal, true);
        clock.value = Date.parse(`${targetDate}T09:03:10+08:00`);
        assert.deepEqual(onEvent(streamEvent(clock, '09:03', 4)),
            { accepted: false, reason: 'event_processing_backpressure' });
        const stopped = await runner.stop();
        assert.equal(stopped.receipt.aggregate[0].observationCount, 1);
        assert.equal(stopped.receipt.resources.affectedScope, 'all_active_symbols');
        assert.equal(stopped.receipt.health.incidentCount, 1);
        assert.equal(stopped.receipt.liveCoverageBySymbol[0].reason,
            'event_processing_backpressure');
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('three slow events within one minute trip sustained backpressure without a hard stall', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'daily-runner-burst-'));
    const clock = { value: Date.parse(`${targetDate}T08:50:00+08:00`) };
    let onEvent, probes = 0;
    const transportFactory = options => { onEvent = options.onEvent; return {
        async start() { return { started: true, subscribeAccepted: true }; },
        async stop() { return { stopped: true, unsubscribeAccepted: true }; },
        status() { return { phase: 'running' }; },
    }; };
    try {
        const runner = createDailyMinuteVolumeRunner(localRuntime(root, clock,
            transportFactory, { diskSpaceProbe: () => {
                if (++probes >= 2) clock.value += 11_000;
                return 1024;
            } }));
        await runner.start();
        clock.value = Date.parse(`${targetDate}T09:01:10+08:00`);
        assert.equal(onEvent(streamEvent(clock, '09:01', 2)).accepted, true);
        for (const [time, minute] of [
            ['09:02:10', '09:02'], ['09:02:30', '09:03'], ['09:02:50', '09:04'],
        ]) {
            clock.value = Date.parse(`${targetDate}T${time}+08:00`);
            onEvent(streamEvent(clock, minute, 3));
        }
        assert.equal(runner.status().slowEventCount, 3);
        assert.equal(runner.status().maxEventProcessingMs, 11_000);
        assert.equal(runner.status().resourceFault, 'event_processing_backpressure');
        await assert.rejects(() => runner.checkHealth(), /daily_runner_resource_unrecoverable/);
        const stopped = await runner.stop();
        assert.equal(stopped.receipt.executionOutcome, 'partial');
        assert.equal(stopped.receipt.resources.backpressurePolicy.burstEvents, 3);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('summary collision records failure separately and leaves SQLite observations readable', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'daily-runner-summary-'));
    const clock = { value: Date.parse(`${targetDate}T08:50:00+08:00`) };
    let onEvent;
    const transportFactory = options => { onEvent = options.onEvent; return {
        async start() { return { started: true, subscribeAccepted: true }; },
        async stop() { return { stopped: true, unsubscribeAccepted: true }; },
        status() { return { phase: 'running' }; },
    }; };
    try {
        const summaryDirectory = path.join(root, 'IntradayMonitor', 'daily-run', targetDate);
        mkdirSync(summaryDirectory, { recursive: true });
        const summaryPath = path.join(summaryDirectory, 'summary.json');
        writeFileSync(summaryPath, 'original immutable summary\n');
        const runner = createDailyMinuteVolumeRunner(localRuntime(root, clock, transportFactory));
        await runner.start();
        clock.value = Date.parse(`${targetDate}T09:01:10+08:00`);
        assert.equal(onEvent(streamEvent(clock, '09:01', 2)).accepted, true);
        clock.value = Date.parse(`${targetDate}T09:02:10+08:00`);
        assert.equal(onEvent(streamEvent(clock, '09:02', 3)).accepted, true);
        const stopped = await runner.stop();
        assert.equal(stopped.reason, 'summary_write_failed');
        assert.equal(readFileSync(summaryPath, 'utf8'), 'original immutable summary\n');
        const sidecar = JSON.parse(readFileSync(path.join(summaryDirectory,
            'summary-write-failed.json'), 'utf8'));
        assert.equal(sidecar.reason, 'summary_exists');
        const repository = new IntradayMonitorEvidenceRepository(stopped.evidenceDatabasePath);
        try { assert.equal(repository.summarizeDailyTradeDate(targetDate)[0].observationCount, 1); }
        finally { repository.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('late first bar repairs a verified historical prefix once, then compares only fresh live minutes', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'daily-runner-gap-'));
    const clock = { value: Date.parse(`${targetDate}T08:50:00+08:00`) };
    let onEvent, requests = 0;
    const transportFactory = options => { onEvent = options.onEvent; return {
        async start() { return { started: true, subscribeAccepted: true }; },
        async stop() { return { stopped: true, unsubscribeAccepted: true }; },
        status() { return { phase: 'running' }; },
    }; };
    const repairWorkerFactory = () => ({ async run({ contracts, endMinute, overlapMinute,
        liveGeneration, liveOverlapBySymbol }) {
        requests += 1;
        assert.equal(endMinute, '09:02');
        assert.equal(overlapMinute, '09:03');
        const contract = contracts[0];
        const data = { datetime: ['09:01', '09:02', '09:03'].map(minute =>
            `${targetDate}T${minute}:00`),
        Open: [1, 1, 1], High: [1, 1, 1], Low: [1, 1, 1], Close: [1, 1, 1],
        Volume: [2, 3, 4], Amount: [2, 3, 4] };
        const verified = validateDirect160GapBootstrap({ contract, tradeDate: targetDate,
            endMinute, overlapMinute, first: data, second: data,
            fetchedAt: new Date(clock.value).toISOString(),
            refetchedAt: new Date(clock.value).toISOString(),
            restGeneration: `rest:${liveGeneration}`, liveGeneration,
            sourceVersion: 'fixture/1',
            liveOverlap: liveOverlapBySymbol.get(contract.canonicalSymbol) });
        assert.equal(verified.ok, true);
        return { receipts: [verified.receipt], results: [verified] };
    } });
    try {
        const runner = createDailyMinuteVolumeRunner(localRuntime(root, clock,
            transportFactory, { repairWorkerFactory }));
        await runner.start();
        clock.value = Date.parse(`${targetDate}T09:02:10+08:00`);
        assert.equal(onEvent(streamEvent(clock, '09:02', 3)).accepted, true);
        clock.value = Date.parse(`${targetDate}T09:03:10+08:00`);
        assert.equal(onEvent(streamEvent(clock, '09:03', 4)).reason, 'historical_prefix_missing');
        for (let attempt = 0; attempt < 20 && runner.status().historicalGapRepair.pending; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(runner.status().historicalGapRepair.completed, 1,
            JSON.stringify(runner.status().historicalGapRepair));
        assert.equal(runner.status().sink.items[0].observationCount, 2);
        assert.equal(runner.status().sink.items[0].lastComparableMinute, null);
        clock.value = Date.parse(`${targetDate}T09:04:10+08:00`);
        assert.equal(onEvent(streamEvent(clock, '09:04', 5)).sealedMinute, '09:03');
        assert.equal(runner.status().sink.items[0].lastComparableMinute, '09:03');
        assert.equal(requests, 1);
        const stopped = await runner.stop();
        assert.equal(stopped.receipt.historicalGapRepair.completed, 1);
        assert.equal(stopped.receipt.liveCoverageBySymbol[0].state, 'partial');
        assert.equal(stopped.receipt.liveCoverageBySymbol[0].reason, 'historical_prefix_not_live');
        const repository = new IntradayMonitorEvidenceRepository(path.join(root,
            'IntradayMonitor', 'intraday-monitor-evidence.sqlite3'));
        try {
            const rows = repository.database.prepare(`SELECT payload_json FROM intraday_monitor_observations
                WHERE canonical_symbol=? AND trade_date=? ORDER BY minute_key`)
                .all('2330.TW', targetDate).map(row => JSON.parse(row.payload_json));
            assert.equal(rows.length, 3);
            assert.equal(rows[0].source, 'shioaji-kbars-bootstrap');
            assert.equal(rows[1].source, 'shioaji-kbars-bootstrap');
            assert.equal(rows[2].source, 'shioaji-kbar-stream');
            assert.equal(repository.listTriggers(targetDate).length, 0);
        } finally { repository.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ended SSE reconnect keeps continuity closed until a same-generation REST/live overlap is verified', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'daily-runner-reconnect-'));
    const clock = { value: Date.parse(`${targetDate}T08:50:00+08:00`) };
    let onEvent, disconnect, onRecovered, reconnects = 0;
    const transportFactory = options => {
        onEvent = options.onEvent; disconnect = options.onDisconnect;
        onRecovered = options.onRecovered;
        return { async start() { return { started: true, subscribeAccepted: true }; },
            async reconnectEndedStream() { reconnects += 1;
                onRecovered({ connectionGeneration: generation });
                return { recovered: true, secondStreamCreated: true }; },
            async stop() { return { stopped: true, unsubscribeAccepted: true }; },
            status() { return { phase: 'running', cohortHash: 'test-cohort' }; } };
    };
    const repairWorkerFactory = () => ({ async run({ contracts, endMinute, overlapMinute,
        liveGeneration, liveOverlapBySymbol }) {
        const contract = contracts[0];
        const data = { datetime: ['09:01', '09:02', '09:03'].map(minute =>
            `${targetDate}T${minute}:00`),
        Open: [1, 1, 1], High: [1, 1, 1], Low: [1, 1, 1], Close: [1, 1, 1],
        Volume: [2, 3, 4], Amount: [2, 3, 4] };
        const verified = validateDirect160GapBootstrap({ contract, tradeDate: targetDate,
            endMinute, overlapMinute, first: data, second: data,
            fetchedAt: new Date(clock.value).toISOString(),
            refetchedAt: new Date(clock.value).toISOString(),
            restGeneration: `rest:${liveGeneration}`, liveGeneration,
            sourceVersion: 'fixture/1',
            liveOverlap: liveOverlapBySymbol.get(contract.canonicalSymbol) });
        assert.equal(verified.ok, true);
        return { receipts: [verified.receipt], results: [verified] };
    } });
    try {
        const runner = createDailyMinuteVolumeRunner(localRuntime(root, clock,
            transportFactory, { repairWorkerFactory }));
        await runner.start();
        clock.value = Date.parse(`${targetDate}T09:01:10+08:00`);
        onEvent(streamEvent(clock, '09:01', 2));
        clock.value = Date.parse(`${targetDate}T09:02:10+08:00`);
        onEvent(streamEvent(clock, '09:02', 3));
        disconnect({ connectionGeneration: generation, reason: 'stream_ended' });
        assert.equal(onEvent(streamEvent(clock, '09:02', 3)).reason, 'stream_disconnected');
        for (let attempt = 0; attempt < 20 && !runner.status().reconnectReceipt; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(reconnects, 1);
        assert.equal(runner.status().reconnectReceipt.recovered, true);
        assert.equal(runner.status().adapter.symbols[0].degraded, true);
        clock.value = Date.parse(`${targetDate}T09:03:10+08:00`);
        assert.equal(onEvent(streamEvent(clock, '09:03', 4)).reason, 'symbol_degraded');
        for (let attempt = 0; attempt < 20 && runner.status().historicalGapRepair.pending; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(runner.status().historicalGapRepair.completed, 1);
        clock.value = Date.parse(`${targetDate}T09:04:10+08:00`);
        assert.equal(onEvent(streamEvent(clock, '09:04', 5)).sealedMinute, '09:03');
        const stopped = await runner.stop();
        assert.equal(stopped.receipt.executionOutcome, 'partial');
        assert.equal(stopped.receipt.historicalGapRepair.receipts[0].historicalRows, 1);
        assert.equal(stopped.receipt.aggregate[0].observationCount, 3);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('盤中無來源事件留下不可變停滯證據；reader 停止後安全退出且不清除既有 SQLite', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'daily-runner-health-'));
    const clock = { value: Date.parse(`${targetDate}T08:50:00+08:00`) };
    let onEvent, onDisconnect, streamActive = true, subscriptions = 0, stops = 0;
    const transportFactory = options => {
        onEvent = options.onEvent; onDisconnect = options.onDisconnect;
        return { async start() { subscriptions += 1;
            return { started: true, subscribeAccepted: true }; },
        async stop() { stops += 1; return { stopped: true, unsubscribeAccepted: true }; },
        status() { return { phase: 'running', streamActive, bytes: 1234,
            maximumBytes: 128 * 1024 * 1024, recoveryAttempts: 0 }; } };
    };
    try {
        const runner = createDailyMinuteVolumeRunner(localRuntime(root, clock, transportFactory));
        await runner.start();
        clock.value = Date.parse(`${targetDate}T09:01:10+08:00`);
        onEvent(streamEvent(clock, '09:01', 2));
        clock.value = Date.parse(`${targetDate}T09:02:10+08:00`);
        onEvent(streamEvent(clock, '09:02', 3));
        clock.value = Date.parse(`${targetDate}T09:06:10+08:00`);
        assert.deepEqual(await runner.checkHealth(), { state: 'stalled', reason: 'kbar_source_silent' });
        assert.equal((await runner.checkHealth()).state, 'stalled');
        const incidentDir = path.join(root, 'IntradayMonitor', 'daily-run', targetDate, 'incidents');
        const first = JSON.parse(readFileSync(path.join(incidentDir, '001.json'), 'utf8'));
        assert.equal(first.reason, 'kbar_source_silent');
        assert.equal(first.fatal, false);
        assert.equal(runner.status().health.incidentCount, 1);
        streamActive = false;
        onDisconnect({ connectionGeneration: generation, reason: 'stream_byte_limit' });
        await assert.rejects(() => runner.checkHealth(), /daily_runner_stream_unrecoverable/);
        const second = JSON.parse(readFileSync(path.join(incidentDir, '002.json'), 'utf8'));
        assert.equal(second.reason, 'stream_byte_limit');
        assert.equal(second.fatal, true);
        const stopped = await runner.stop();
        assert.equal(stopped.receipt.executionOutcome, 'partial');
        assert.equal(stopped.receipt.health.incidentCount, 2);
        assert.equal(stopped.receipt.aggregate[0].observationCount, 1);
        assert.equal(subscriptions, 1);
        assert.equal(stops, 1);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('連續交易時段長時間無 KBar 才 fail closed；收盤集合競價不因暫停逐筆交易誤判', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'daily-runner-silence-'));
    const clock = { value: Date.parse(`${targetDate}T08:50:00+08:00`) };
    let onEvent, stops = 0;
    const transportFactory = options => { onEvent = options.onEvent; return {
        async start() { return { started: true, subscribeAccepted: true }; },
        async stop() { stops += 1; return { stopped: true, unsubscribeAccepted: true }; },
        status() { return { phase: 'running', streamActive: true, bytes: 100 }; },
    }; };
    try {
        const runner = createDailyMinuteVolumeRunner(localRuntime(root, clock, transportFactory));
        await runner.start();
        clock.value = Date.parse(`${targetDate}T09:01:10+08:00`);
        onEvent(streamEvent(clock, '09:01', 2));
        clock.value = Date.parse(`${targetDate}T09:06:10+08:00`);
        assert.equal((await runner.checkHealth()).state, 'stalled');
        clock.value = Date.parse(`${targetDate}T09:09:11+08:00`);
        await assert.rejects(() => runner.checkHealth(), /daily_runner_stream_unrecoverable/);
        assert.equal(runner.status().health.lastReason, 'kbar_source_silent_prolonged');
        clock.value = Date.parse(`${targetDate}T13:27:00+08:00`);
        assert.equal((await runner.checkHealth()).state, 'healthy');
        const stopped = await runner.stop();
        assert.equal(stopped.receipt.executionOutcome, 'partial');
        assert.equal(stopped.receipt.health.incidentCount, 2);
        assert.equal(stops, 1);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
