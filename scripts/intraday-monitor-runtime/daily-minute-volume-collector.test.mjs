import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { saveSpecialMarketClosure } from './special-market-closures.mjs';
import os from 'node:os';
import path from 'node:path';

import { baselineCalendar } from './direct-160-baseline.mjs';
import { expectedTaiwanRegularSessionMinutes } from './historical-kbar-repair.mjs';
import { createDailyMinuteVolumeCollector } from './daily-minute-volume-collector.mjs';
import { createDailyMinuteVolumeContractCache } from './daily-minute-volume-contract-cache.mjs';
import { DailyMinuteVolumeRepository } from './daily-minute-volume-repository.mjs';

const date = '2026-09-11';
const target = '2026-09-14';
const at = '2026-09-11T14:03:00+08:00';
const entry = { canonicalSymbol: '2330.TW', contractIdentity: {
    security_type: 'STK', region: 'TW', exchange: 'TSE', code: '2330', target_code: null } };
const contract = { ...entry.contractIdentity, unit: 1000,
    trading_suspended: false, update_date: date };
const minutes = expectedTaiwanRegularSessionMinutes();
const data = { datetime: minutes.map(minute => `${date}T${minute}:00`),
    Open: minutes.map(() => 10), High: minutes.map(() => 10),
    Low: minutes.map(() => 10), Close: minutes.map(() => 10),
    Volume: minutes.map(() => 2), Amount: minutes.map(() => 20000) };
const twse = { stat: 'ok', queryYear: 2026, fields: ['日期', '名稱', '說明'],
    data: [['2026-01-01', '中華民國開國紀念日', '依規定放假1日。']] };
const tpex = { data: { html: '<table><tr><td>中華民國115年有價證券櫃檯買賣市場開（休）市日期表</td></tr></table><table><tr><td>中華民國開國紀念日</td><td>1月1日</td><td>四</td><td>依規定放假1日。</td></tr></table>' } };

function setup({ failKbars = false, failKbarsOnce = false, maxRequests = 2,
    rateLimitOnce = false, withContractCache = false, earlyWakeOnce = false,
    frozenWait = false, closeAfterContract = false } = {}) {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'daily-minute-collector-')));
    const repository = new DailyMinuteVolumeRepository(path.join(root, 'baseline.sqlite3'));
    const calls = { contract: 0, kbars: 0, reservations: 0, waits: 0, settles: [] };
    let current = at;
    const apiPort = { async fetchContract() { calls.contract++;
        if(closeAfterContract)saveSpecialMarketClosure(root,{action:'close',date,reason:'工作開始後臨時休市',confirmed:true,expectedRevision:0},{now:new Date(current)});
        return { value: contract, responseBytes: 100 }; },
        async fetchKbars() { calls.kbars++;
            if (failKbars || failKbarsOnce && calls.kbars === 1) {
                throw new Error('baseline_provider_unavailable');
            }
            return { value: { data, fetchedAt: at }, responseBytes: 3000 };
        } };
    const admission = {
        async reserve() { calls.reservations++;
            if (rateLimitOnce && calls.reservations === 1) return { allowed: false,
                reason: 'broker_rate_limited', nextAttemptAt: new Date(Date.parse(current) + 60_000).toISOString() };
            return { allowed: true,
            reservationId: `reservation-${calls.reservations}` }; },
        async start() {}, async settle(value) { calls.settles.push(value); },
    };
    const cache = withContractCache ? createDailyMinuteVolumeContractCache(root) : null;
    const collector = createDailyMinuteVolumeCollector({ apiPort, admission,
        repository, now: () => current, wait: async ms => {
            calls.waits += 1;
            if (!frozenWait) current = new Date(Date.parse(current) + ms -
                (earlyWakeOnce && calls.waits === 1 ? 1 : 0)).toISOString();
        }, ...(cache ? { readCachedContract: cache.readCachedContract,
            writeCachedContract: cache.writeCachedContract } : {}) });
    const calendar = baselineCalendar(twse, tpex, date, target, Date.parse(at));
    const options = { root, entries: [entry], calendar, sourceVersion: 'fixture-only/1',
        connectionGeneration: 'simulation:fixture-generation-001',
        limits: { deadlineAt: `${date}T15:00:00+08:00`, maxRequests,
            maxResponseBytes: 10000, requestTimeoutMs: 1000,
            maxAttempts: 3, cooldownMs: 0 } };
    return { collector, repository, calls, options, close() {
        repository.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('daily collector makes one K query, publishes v2 and same-key rerun is read only', async () => {
    const env = setup();
    try {
        const receipt = await env.collector.collect(env.options);
        assert.equal(receipt.outcome, 'complete');
        assert.equal(receipt.requests, 2);
        assert.equal(receipt.responseBytes, 3100);
        assert.equal(env.calls.kbars, 1);
        assert.equal(env.calls.contract, 1);
        assert.equal(env.calls.settles.length, 2);
        const saved = env.repository.latestForSymbolDate('2330.TW', 'TSE', date, target);
        assert.equal(saved?.cumulativeSeries.at(-1).cumulativeVolume, 540);
        assert.equal(saved?.validationChecks.closeTotalCheck, 'not_observed');
        const next = await env.collector.collect(env.options);
        assert.equal(next.alreadyPresent, true);
        assert.equal(env.calls.kbars, 1);
    } finally { env.close(); }
});

test('late manual closure prevents the next request, preserving the real first request and settlement', async () => {
    const env=setup({closeAfterContract:true});
    try {
        const receipt=await env.collector.collect(env.options);
        assert.equal(receipt.outcome,'partial');assert.equal(receipt.requests,1);
        assert.equal(receipt.results[0].reason,'special_market_closure');
        assert.equal(env.calls.contract,1);assert.equal(env.calls.kbars,0);
        assert.equal(env.calls.settles.length,1);assert.equal(env.repository.currentRevision(),0);
    } finally {env.close();}
});

test('a closed target rejects the old D-to-T before any collector claim or request', async () => {
    const env=setup();
    try {
        saveSpecialMarketClosure(env.options.root,{action:'close',date:target,reason:'目標日臨時休市',confirmed:true,expectedRevision:0},{now:new Date(at)});
        await assert.rejects(()=>env.collector.collect(env.options),/special_market_closure/);
        assert.equal(env.calls.reservations,0);assert.equal(env.calls.contract,0);assert.equal(env.calls.kbars,0);
    } finally {env.close();}
});

test('central rate limit waits until the recorded admission time without increasing request budget', async () => {
    const env = setup({ rateLimitOnce: true });
    try {
        const receipt = await env.collector.collect(env.options);
        assert.equal(receipt.outcome, 'complete');
        assert.equal(receipt.requests, 2);
        assert.equal(receipt.rateWaits, 1);
        assert.equal(receipt.rateWaitMs, 60_000);
        assert.equal(env.calls.reservations, 3);
        assert.equal(env.calls.kbars, 1);
    } finally { env.close(); }
});

test('one-millisecond early timer wake waits the remainder instead of dropping a valid symbol', async () => {
    const env = setup({ rateLimitOnce: true, earlyWakeOnce: true });
    try {
        const receipt = await env.collector.collect(env.options);
        assert.equal(receipt.outcome, 'complete');
        assert.equal(receipt.requests, 2);
        assert.equal(receipt.rateWaits, 1);
        assert.equal(env.calls.waits, 2);
    } finally { env.close(); }
});

test('stuck clock remains bounded and fails closed', async () => {
    const env = setup({ rateLimitOnce: true, frozenWait: true });
    try {
        const receipt = await env.collector.collect(env.options);
        assert.equal(receipt.outcome, 'partial');
        assert.equal(receipt.results[0].reason, 'daily_collection_cooldown_clock_not_advanced');
        assert.equal(env.calls.waits, 1);
        assert.equal(env.calls.kbars, 0);
    } finally { env.close(); }
});

test('provider failure stays partial and preserves quota settlement', async () => {
    const env = setup({ failKbars: true });
    try {
        const receipt = await env.collector.collect(env.options);
        assert.equal(receipt.outcome, 'partial');
        assert.equal(receipt.results[0].reason, 'baseline_provider_unavailable');
        assert.equal(env.repository.currentRevision(), 0);
        assert.equal(env.calls.settles.length, 2);
        assert.equal(env.calls.settles[1].requested, 1);
        assert.equal(env.calls.settles[1].responseBytes, null);
    } finally { env.close(); }
});

test('retry reuses a verified same-day contract but makes a new KBar request', async () => {
    const env = setup({ failKbarsOnce: true, withContractCache: true });
    try {
        const first = await env.collector.collect(env.options);
        assert.equal(first.outcome, 'partial');
        const second = await env.collector.collect({ ...env.options, attempt: 2 });
        assert.equal(second.outcome, 'complete');
        assert.equal(second.requests, 1);
        assert.equal(env.calls.contract, 1);
        assert.equal(env.calls.kbars, 2);
    } finally { env.close(); }
});

test('same attempt cannot reuse a receipt under a changed source version', async () => {
    const env = setup();
    try {
        await env.collector.collect(env.options);
        await assert.rejects(env.collector.collect({ ...env.options,
            sourceVersion: 'fixture-only/2' }),
        /daily_collection_receipt_identity_conflict/);
        assert.equal(env.calls.kbars, 1);
    } finally { env.close(); }
});

test('request budget prevents K query and records affected symbol', async () => {
    const env = setup({ maxRequests: 1 });
    try {
        const receipt = await env.collector.collect(env.options);
        assert.equal(receipt.outcome, 'partial');
        assert.equal(receipt.results[0].reason, 'daily_collection_request_limit');
        assert.equal(env.calls.kbars, 0);
        assert.equal(env.calls.reservations, 1);
    } finally { env.close(); }
});
