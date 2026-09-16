import { describe, expect, it, vi } from 'vitest';
import { createIntradayMonitorKbarStreamAdapter, INTRADAY_MONITOR_KBAR_EVENT_SCHEMA,
    issueIntradayMonitorKbarSessionCloseAuthority } from './kbar-stream-adapter.mjs';

const contract = (code = '2330') => ({ securityType: 'STK', region: 'TW', exchange: 'TSE', code, targetCode: null, canonicalSymbol: `${code}.TW` });
const event = (overrides = {}) => ({
    schemaVersion: INTRADAY_MONITOR_KBAR_EVENT_SCHEMA,
    code: '2330', date: '2026/09/07', time: '09:01:00', volume: 10,
    receivedTime: '2026-09-07T01:01:02.500Z', connectionGeneration: 'kbar_generation_0001',
    unit: 'common_lot', sourceVersion: 'shioaji-http-1.7.1', ...overrides,
});

function harness() {
    const observations = [];
    const sink = vi.fn((value) => { observations.push(value); return { accepted: true }; });
    const adapter = createIntradayMonitorKbarStreamAdapter({
        cohort: [contract(), contract('2454')], tradeDate: '2026-09-07',
        connectionGeneration: 'kbar_generation_0001', observationSink: sink,
        nowEpochMs: () => Date.parse('2026-09-07T14:00:00+08:00'),
    });
    return { adapter, observations, sink };
}

describe('realtime KBar one-bar delay adapter', () => {
    it('收到下一個連續分鐘後才 seal 前一根並輸出累積量', () => {
        const { adapter, observations } = harness();
        expect(adapter.accept(event())).toMatchObject({ accepted: true, reason: 'forming', sealed: false });
        expect(observations).toHaveLength(0);
        expect(adapter.accept(event({ time: '09:02:00', volume: 7, receivedTime: '2026-09-07T01:02:02.500Z' })))
            .toMatchObject({ accepted: true, reason: 'sealed_previous', sealedMinute: '09:01', cumulativeVolume: 10 });
        expect(adapter.accept(event({ time: '09:03:00', volume: 3, receivedTime: '2026-09-07T01:03:02.500Z' })))
            .toMatchObject({ sealedMinute: '09:02', cumulativeVolume: 17 });
        expect(observations.map((item) => [item.minuteKey, item.cumulativeVolume, item.source]))
            .toEqual([['09:01', 10, 'shioaji-kbar-stream'], ['09:02', 17, 'shioaji-kbar-stream']]);
    });

    it('接受 provider 分鐘標籤最多提早 2 秒抵達，且仍以 one-bar delay seal', () => {
        const observations = [];
        let now = Date.parse('2026-09-07T09:00:59.800+08:00');
        const adapter = createIntradayMonitorKbarStreamAdapter({
            cohort: [contract()], tradeDate: '2026-09-07',
            connectionGeneration: 'kbar_generation_0001',
            observationSink(value) { observations.push(value); return { accepted: true }; },
            nowEpochMs: () => now,
        });
        expect(adapter.accept(event({
            time: '09:01:00', receivedTime: '2026-09-07T01:00:59.800Z',
        }))).toMatchObject({ accepted: true, reason: 'forming', sealed: false });
        now = Date.parse('2026-09-07T09:01:59.900+08:00');
        expect(adapter.accept(event({
            time: '09:02:00', volume: 7, receivedTime: '2026-09-07T01:01:59.900Z',
        }))).toMatchObject({ accepted: true, reason: 'sealed_previous', sealedMinute: '09:01' });
        expect(observations).toHaveLength(1);
        expect(observations[0]).toMatchObject({ minuteKey: '09:01', cumulativeVolume: 10 });
    });

    it('provider 分鐘標籤超過 2 秒未來偏移仍 fail closed', () => {
        const adapter = createIntradayMonitorKbarStreamAdapter({
            cohort: [contract()], tradeDate: '2026-09-07',
            connectionGeneration: 'kbar_generation_0001',
            observationSink() { return { accepted: true }; },
            nowEpochMs: () => Date.parse('2026-09-07T09:00:57.000+08:00'),
        });
        expect(adapter.accept(event({
            time: '09:01:00', receivedTime: '2026-09-07T01:00:57.000Z',
        }))).toMatchObject({ accepted: false, reason: 'invalid_received_time' });
    });

    it('forming 同分鐘只允許非倒退修訂且不重複累加', () => {
        const { adapter, observations } = harness();
        adapter.accept(event());
        expect(adapter.accept(event())).toMatchObject({ accepted: false, reason: 'duplicate_forming_kbar' });
        expect(adapter.accept(event({ volume: 12 }))).toMatchObject({ accepted: true, reason: 'forming_revised' });
        adapter.accept(event({ time: '09:02:00', volume: 7, receivedTime: '2026-09-07T01:02:02.500Z' }));
        expect(observations).toHaveLength(1);
        expect(observations[0].cumulativeVolume).toBe(12);
    });

    it('缺分鐘後 fail closed 且不把新棒送入 sink', () => {
        const { adapter, observations } = harness();
        adapter.accept(event());
        expect(adapter.accept(event({ time: '09:03:00', receivedTime: '2026-09-07T01:03:02.500Z' })))
            .toMatchObject({ accepted: false, reason: 'kbar_minute_gap' });
        expect(observations).toHaveLength(0);
        expect(adapter.status().symbols[0]).toMatchObject({ degraded: true, reason: 'kbar_minute_gap' });
    });

    it.each([
        ['cohort_symbol_unknown', { code: '3008' }],
        ['stale_generation', { connectionGeneration: 'kbar_generation_old1' }],
        ['cross_date', { date: '2026/09/06' }],
        ['invalid_volume', { volume: -1 }],
        ['unknown_unit', { unit: 'share' }],
        ['invalid_received_time', { time: '13:30:00', receivedTime: '2026-09-07T06:01:00.000Z' }],
    ])('拒絕 %s', (reason, override) => {
        const { adapter } = harness();
        expect(adapter.accept(event(override))).toMatchObject({ accepted: false, reason });
    });

    it('斷線後所有商品 degraded，且不具有交易、production 或重啟權限', () => {
        const { adapter } = harness();
        expect(adapter.markDisconnected({ connectionGeneration: 'kbar_generation_0001' }).accepted).toBe(true);
        expect(adapter.accept(event())).toMatchObject({ accepted: false, reason: 'stream_disconnected' });
        expect(adapter.status()).toMatchObject({ connected: false, providerPhysicalUsage: null,
            pollingFallbackAllowed: false, brokerWriteAuthority: false, productionAuthority: false,
            serviceLifecycleAuthority: false });
        expect(adapter.status().symbols.every((item) => item.degraded)).toBe(true);
    });

    it('13:34:30 後由不可偽造 close authority seal 13:30 最後一根', () => {
        const observations = [];
        const adapter = createIntradayMonitorKbarStreamAdapter({ cohort: [contract()], tradeDate: '2026-09-07',
            connectionGeneration: 'kbar_generation_0001', observationSink(value) { observations.push(value); return { accepted: true }; },
            nowEpochMs: () => Date.parse('2026-09-07T14:00:00+08:00') });
        adapter.accept(event({ time: '13:30:00', volume: 88, receivedTime: '2026-09-07T05:30:02.500Z' }));
        expect(adapter.sealSessionClose({ issued: true })).toMatchObject({ accepted: false, reason: 'close_authority_invalid' });
        const epoch = Date.parse('2026-09-07T13:34:30+08:00');
        const authority = issueIntradayMonitorKbarSessionCloseAuthority({ tradeDate: '2026-09-07',
            observedAtEpochMs: epoch, timeZone: 'Asia/Taipei' }, epoch);
        expect(authority.issued).toBe(true);
        expect(adapter.sealSessionClose(authority)).toMatchObject({ accepted: true, sealedCount: 1, expectedCount: 1 });
        expect(observations[0]).toMatchObject({ minuteKey: '13:30', cumulativeVolume: 88, source: 'shioaji-kbar-stream' });
        expect(adapter.status().symbols[0]).toMatchObject({ formingMinute: null, delayedCloseMinute: null,
            sealedMinute: '13:30', closeMode: 'normal_or_revised_13_30', reason: 'session_closed' });
    });

    it('13:34:30 前拒絕 close authority，避免漏掉個股延後收盤', () => {
        const epoch = Date.parse('2026-09-07T13:34:29+08:00');
        expect(issueIntradayMonitorKbarSessionCloseAuthority({ tradeDate: '2026-09-07',
            observedAtEpochMs: epoch, timeZone: 'Asia/Taipei' }, epoch)).toMatchObject({ accepted: false, reason: 'session_not_closed' });
    });

    it('13:33 延後收盤 KBar 只併入 13:30 累積端點，不補造額外分鐘', () => {
        const observations = [];
        const adapter = createIntradayMonitorKbarStreamAdapter({ cohort: [contract()], tradeDate: '2026-09-07',
            connectionGeneration: 'kbar_generation_0001', observationSink(value) { observations.push(value); return { accepted: true }; },
            nowEpochMs: () => Date.parse('2026-09-07T14:00:00+08:00') });
        expect(adapter.accept(event({ time: '13:29:00', volume: 10,
            receivedTime: '2026-09-07T05:29:02.500Z' }))).toMatchObject({ accepted: true, sealed: false });
        expect(adapter.accept(event({ time: '13:30:00', volume: 20,
            receivedTime: '2026-09-07T05:30:02.500Z' }))).toMatchObject({
            accepted: true, sealed: true, sealedMinute: '13:29', cumulativeVolume: 10,
        });
        expect(adapter.accept(event({ time: '13:33:00', volume: 30,
            receivedTime: '2026-09-07T05:33:02.500Z' }))).toMatchObject({
            accepted: true, reason: 'delayed_close_forming', sealed: false,
        });
        expect(adapter.status().symbols[0]).toMatchObject({ formingMinute: '13:30',
            delayedCloseMinute: '13:33', sealedMinute: '13:29', closeMode: 'delayed_13_33' });
        const epoch = Date.parse('2026-09-07T13:34:30+08:00');
        const authority = issueIntradayMonitorKbarSessionCloseAuthority({ tradeDate: '2026-09-07',
            observedAtEpochMs: epoch, timeZone: 'Asia/Taipei' }, epoch);
        expect(adapter.sealSessionClose(authority)).toMatchObject({ accepted: true, sealedCount: 1,
            normalCloseMinute: '13:30', delayedCloseMinute: '13:33' });
        expect(observations.map((item) => [item.minuteKey, item.cumulativeVolume]))
            .toEqual([['13:29', 10], ['13:30', 60]]);
        expect(adapter.status().symbols[0]).toMatchObject({ closeMode: 'delayed_13_33',
            sealedMinute: '13:30', cumulativeVolume: 60, sequence: 2 });
    });

    it('缺少連續 13:29／13:30 證據時拒絕 13:33 延後收盤棒並使商品 fail closed', () => {
        const adapter = createIntradayMonitorKbarStreamAdapter({ cohort: [contract()], tradeDate: '2026-09-07',
            connectionGeneration: 'kbar_generation_0001', observationSink() { return { accepted: true }; },
            nowEpochMs: () => Date.parse('2026-09-07T14:00:00+08:00') });
        expect(adapter.accept(event({ time: '13:33:00', volume: 30,
            receivedTime: '2026-09-07T05:33:02.500Z' }))).toMatchObject({
            accepted: false, reason: 'delayed_close_without_regular_close_sequence',
        });
        expect(adapter.status().symbols[0]).toMatchObject({ degraded: true,
            reason: 'delayed_close_without_regular_close_sequence' });
    });

    it('provider 未送 13:30 零量棒時，13:29 後的 13:33 延後撮合仍可形成 canonical 13:30 端點', () => {
        const observations = [];
        const adapter = createIntradayMonitorKbarStreamAdapter({ cohort: [contract()], tradeDate: '2026-09-07',
            connectionGeneration: 'kbar_generation_0001', observationSink(value) { observations.push(value); return { accepted: true }; },
            nowEpochMs: () => Date.parse('2026-09-07T14:00:00+08:00') });
        adapter.accept(event({ time: '13:28:00', volume: 8, receivedTime: '2026-09-07T05:28:02.500Z' }));
        adapter.accept(event({ time: '13:29:00', volume: 9, receivedTime: '2026-09-07T05:29:02.500Z' }));
        expect(adapter.accept(event({ time: '13:33:00', volume: 33,
            receivedTime: '2026-09-07T05:33:02.500Z' }))).toMatchObject({
            accepted: true, reason: 'delayed_close_forming', sealed: false,
        });
        expect(observations.map((item) => [item.minuteKey, item.cumulativeVolume]))
            .toEqual([['13:28', 8], ['13:29', 17]]);
        const epoch = Date.parse('2026-09-07T13:34:30+08:00');
        const authority = issueIntradayMonitorKbarSessionCloseAuthority({ tradeDate: '2026-09-07',
            observedAtEpochMs: epoch, timeZone: 'Asia/Taipei' }, epoch);
        expect(adapter.sealSessionClose(authority)).toMatchObject({ accepted: true, sealedCount: 1 });
        expect(observations.at(-1)).toMatchObject({ minuteKey: '13:30', cumulativeVolume: 50, sequence: 3 });
        expect(adapter.status().symbols[0]).toMatchObject({ closeMode: 'delayed_13_33',
            sealedMinute: '13:30', cumulativeVolume: 50, sequence: 3 });
    });
});
