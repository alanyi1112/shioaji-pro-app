import { test } from 'vitest';
import assert from 'node:assert/strict';

import { runDailyMinuteVolumeLifecycle } from './daily-minute-volume-execute.mjs';

const tradeDate = '2026-10-06';

test('08:50 輕量執行器只在收盤及延後撮合窗口轉換，完整收尾後釋放 owner', async () => {
    const transitions = [];
    const runner = {
        async start(value) { transitions.push(['start', value.latestAllowedAt]); },
        beginClosing() { transitions.push(['closing']); },
        sealClose() { transitions.push(['seal']); },
        async stop() { transitions.push(['stop']);
            return { receipt: { executionOutcome: 'ended' } }; },
    };
    const waited = [];
    const result = await runDailyMinuteVolumeLifecycle({ runner, tradeDate,
        wait: async epoch => { waited.push(new Date(epoch).toISOString()); } });
    assert.equal(result.outcome, 'complete');
    assert.deepEqual(waited, ['2026-10-06T05:30:15.000Z',
        '2026-10-06T05:34:30.000Z']);
    assert.deepEqual(transitions, [
        ['start', '2026-10-06T09:00:00+08:00'], ['closing'], ['seal'], ['stop'],
    ]);
});

test('關閉失敗或中斷不得冒充完整執行，仍嘗試釋放 owner', async () => {
    let stopped = 0;
    const runner = {
        async start() {},
        beginClosing() { throw new Error('closing_authority_unavailable'); },
        sealClose() { throw new Error('must_not_seal'); },
        async stop() { stopped++; return { receipt: { executionOutcome: 'partial' } }; },
    };
    const failed = await runDailyMinuteVolumeLifecycle({ runner, tradeDate,
        wait: async () => {} });
    assert.equal(failed.failure, 'closing_authority_unavailable');
    assert.equal(failed.outcome, 'partial');
    assert.equal(stopped, 1);
    const controller = new AbortController();
    const interrupted = await runDailyMinuteVolumeLifecycle({ runner: {
        ...runner, beginClosing() { throw new Error('must_not_close'); },
    }, tradeDate, signal: controller.signal,
    wait: async () => controller.abort() });
    assert.equal(interrupted.interrupted, true);
    assert.equal(interrupted.outcome, 'partial');
    assert.equal(stopped, 2);
});

test('盤中 health pulse 偵測不可復原串流後收尾為 partial，不等到 13:34 才發現', async () => {
    const transitions = [];
    const runner = {
        async start() { transitions.push('start'); },
        async checkHealth() { transitions.push('health');
            throw new Error('daily_runner_stream_unrecoverable'); },
        beginClosing() { transitions.push('closing'); },
        sealClose() { transitions.push('seal'); },
        async stop() { transitions.push('stop');
            return { receipt: { executionOutcome: 'partial' } }; },
    };
    const result = await runDailyMinuteVolumeLifecycle({ runner, tradeDate,
        wait: async (_epoch, _signal, _now, onPulse) => onPulse() });
    assert.equal(result.failure, 'daily_runner_stream_unrecoverable');
    assert.equal(result.outcome, 'partial');
    assert.deepEqual(transitions, ['start', 'health', 'stop']);
});
