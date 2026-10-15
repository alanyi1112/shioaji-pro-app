import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPremarketCaptureFailure } from './premarket-failure-classifier.mjs';

function inputs() {
    const tradeDate = '2026-10-12';
    const items = Array.from({ length: 160 }, (_, i) => ({ canonicalSymbol: `${1000 + i}.TW` }));
    return { tradeDate, receipt: { schemaVersion: 'intraday-monitor-premarket-orchestrator/1',
        localDate: tradeDate, step: '08:50', sessionId: 'today-session', rolloverOutcome: 'failed',
        reason: 'daily_minute_volume_execution_failed', actualStartedAt: `${tradeDate}T00:50:00Z`,
        actualEndedAt: `${tradeDate}T05:34:36Z` },
    session: { tradeDate, previousTradeDate: '2026-10-08', sessionId: 'today-session',
        connectionGeneration: 'simulation:today', cohortHash: 'a'.repeat(64), itemStates: items },
    summary: { schemaVersion: 'intraday-monitor-daily-runner/1', runtimeMode: 'daily',
        tradeDate, previousTradeDate: '2026-10-08', connectionGeneration: 'simulation:today',
        planHash: 'a'.repeat(64), executionOutcome: 'partial', completedAt: `${tradeDate}T05:34:35Z`,
        startReceipt: { started: true, subscribeAccepted: true }, liveCoverageBySymbol: items } };
}

test('已啟動的同日partial不誤分類為啟動失敗，原partial不修改', () => {
    const x = inputs();
    assert.equal(classifyPremarketCaptureFailure(x), null);
    assert.equal(x.summary.executionOutcome, 'partial');
    assert.equal(x.receipt.rolloverOutcome, 'failed');
});
for (const [label, mutate] of [
    ['缺summary', x => { x.summary = null; }],
    ['昨天summary', x => { x.summary.tradeDate = '2026-10-08'; }],
    ['generation不符', x => { x.summary.connectionGeneration = 'simulation:old'; }],
    ['cohort不符', x => { x.summary.planHash = 'b'.repeat(64); }],
    ['session不符', x => { x.receipt.sessionId = 'old-session'; }],
    ['未確認啟動', x => { x.summary.startReceipt.started = false; }],
    ['商品缺口不明', x => { x.summary.liveCoverageBySymbol = x.summary.liveCoverageBySymbol.slice(1); }],
    ['時間不合法', x => { x.receipt.actualEndedAt = 'invalid'; }],
]) test(`${label}不得用partial遮蔽真正啟動失敗`, () => {
    const x = inputs(); mutate(x);
    assert.equal(classifyPremarketCaptureFailure(x), 'daily_minute_volume_execution_failed');
});
test('legacy失敗及盤前Gate failure保留原語意', () => {
    const x = inputs(); x.receipt.reason = 'direct_160_capture_failed';
    assert.equal(classifyPremarketCaptureFailure(x), 'direct_160_capture_failed');
    x.receipt.reason = 'baseline_missing';
    assert.equal(classifyPremarketCaptureFailure(x), 'baseline_missing');
});
