import { describe, expect, it, vi } from 'vitest';
import { createBoundedKbarTransport } from './bounded-kbar-transport.mjs';
import { DIRECT_160_STORAGE } from './direct-160-storage.mjs';
import { DYNAMIC_DAILY_STORAGE } from './dynamic-daily-storage.mjs';

const contract = (code = '2330') => ({ securityType: 'STK', region: 'TW', exchange: 'TSE', code, targetCode: null, canonicalSymbol: `${code}.TW` });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function fixture({ simulation = true, recoverySubscribeAccepted = true } = {}) {
    let streamController;
    let subscribeCount = 0;
    const calls = [];
    const streamSignals = [];
    const fetchImpl = vi.fn(async (url, init = {}) => {
        calls.push({ path: new URL(url).pathname, method: init.method ?? 'GET', body: init.body ?? null });
        const path = new URL(url).pathname;
        if (path.endsWith('/info')) return json({ version: '1.7.1', simulation });
        if (path.endsWith('/data/kbar')) {
            streamSignals.push(init.signal);
            return new Response(new ReadableStream({ start(controller) { streamController = controller; } }),
                { headers: { 'content-type': 'text/event-stream' } });
        }
        if (path.endsWith('/subscribe/kbars')) {
            subscribeCount += 1;
            return json({ success: subscribeCount === 1 || recoverySubscribeAccepted,
                message: 'accepted' });
        }
        if (path.endsWith('/unsubscribe/kbars')) return json({ success: true, message: 'accepted' });
        throw new Error(`unexpected ${path}`);
    });
    return { fetchImpl, calls, streamSignals,
        push(frame) { streamController.enqueue(new TextEncoder().encode(frame)); },
        closeStream() { streamController.close(); },
        failStream(error) { streamController.error(error); } };
}

describe('bounded realtime KBar transport', () => {
    it('保存來源 gap 的丟失兩筆證據，與158筆收到的KBar分開且不重訂閱', async () => {
        const f = fixture();
        const events = [];
        const transport = createBoundedKbarTransport({ fetchImpl: f.fetchImpl,
            storageProfile: DYNAMIC_DAILY_STORAGE,
            onEvent: value => { events.push(value); return { accepted: true }; } });
        const contracts = Array.from({ length: 160 }, (_, i) => contract(String(1000 + i)));
        await transport.start({ contracts, connectionGeneration: 'gap_diagnostic_generation_001' });
        f.push('event: kbar_gap\ndata: {"type":"lagged","dropped":2}\n\n' +
            contracts.slice(2).map(c => `event: kbar\ndata: ${JSON.stringify({ code: c.code,
                date: '2026/10/12', time: '13:30:00', volume: 1 })}\n\n`).join(''));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(events).toHaveLength(158);
        expect(transport.status()).toMatchObject({ kbarFrames: 158, deliveredEvents: 158,
            sourceGapEvents: 1, sourceDroppedFrames: 2, sourceGapInvalid: false,
            nonKbarEventCounts: { kbar_gap: 1 }, streamActive: true });
        expect(transport.status().sourceGapSamples[0]).toMatchObject({
            reason: 'server_subscriber_lagged', dropped: 2 });
        await transport.stop();
        expect(f.calls.filter(c => c.path.endsWith('/subscribe/kbars'))).toHaveLength(1);
    });

    it('畸形gap維持unknown、樣本有界、不保存敏感原文且不影響heartbeat分類', async () => {
        const f = fixture();
        const transport = createBoundedKbarTransport({ fetchImpl: f.fetchImpl,
            onEvent: () => ({ accepted: true }) });
        await transport.start({ contracts: [contract()], connectionGeneration: 'gap_invalid_generation_001' });
        f.push('event: heartbeat\ndata: {}\n\n' +
            Array.from({ length: 12 }, () => 'event: kbar_gap\ndata: {"type":"lagged","dropped":-2,"token":"DO_NOT_STORE"}\n\n').join(''));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(transport.status()).toMatchObject({ sourceGapEvents: 12,
            sourceDroppedFrames: null, sourceGapInvalid: true, malformedFrames: 0,
            nonKbarEventCounts: { heartbeat: 1, kbar_gap: 12 } });
        expect(transport.status().sourceGapSamples).toHaveLength(8);
        expect(JSON.stringify(transport.status())).not.toContain('DO_NOT_STORE');
        await transport.stop();
    });
    it('訂閱接受後先通知 runner 控制面，才完成 start，且拒絕的訂閱不通知', async () => {
        const f = fixture();
        const sequence = [];
        const transport = createBoundedKbarTransport({ fetchImpl: f.fetchImpl,
            onEvent: () => ({ accepted: true }),
            onSubscribeAccepted() { sequence.push('control-plane'); } });
        await transport.start({ contracts: [contract()],
            connectionGeneration: 'daily_generation_boundary_0001' });
        sequence.push('start-returned');
        expect(sequence).toEqual(['control-plane', 'start-returned']);
        await transport.stop();
    });
    it('只建立一個固定 batch，白名單轉換事件並對相同 cohort 退訂一次', async () => {
        const f = fixture();
        const events = [];
        const transport = createBoundedKbarTransport({ fetchImpl: f.fetchImpl,
            onEvent(value) { events.push(value); return { accepted: true }; },
            now: () => '2026-09-07T01:36:02.500Z' });
        const started = await transport.start({ contracts: [contract(), contract('2454')], connectionGeneration: 'kbar_generation_0001' });
        expect(started).toMatchObject({ started: true, cohortSize: 2,
            controlPlaneState: 'subscription_requested', dataPlaneReady: false,
            providerPhysicalUsage: null, brokerWriteAuthority: false });
        f.push('event: kbar\ndata: {"code":"2330","date":"2026/09/07","time":"09:36:00","volume":33,"extra":"discarded"}\n\n');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(events).toEqual([{ schemaVersion: 'intraday-monitor-kbar-event/1', code: '2330', date: '2026/09/07',
            time: '09:36:00', volume: 33, receivedTime: '2026-09-07T01:36:02.500Z',
            connectionGeneration: 'kbar_generation_0001', unit: 'common_lot', sourceVersion: 'shioaji-http-1.7.1' }]);
        const stopped = await transport.stop();
        expect(stopped).toMatchObject({ stopped: true, unsubscribeAccepted: true, providerReleaseProven: false });
        expect(f.calls.filter((item) => item.path.endsWith('/subscribe/kbars'))).toHaveLength(1);
        expect(f.calls.filter((item) => item.path.endsWith('/unsubscribe/kbars'))).toHaveLength(1);
        expect(() => transport.start({ contracts: [contract()], connectionGeneration: 'kbar_generation_0002' })).rejects.toThrow('transport_session_already_used');
    });

    it('尾盤逐檔只記實際進入 SSE reader 的幀，不把缺棒補成已收到', async () => {
        const f = fixture();
        const transport = createBoundedKbarTransport({ fetchImpl: f.fetchImpl,
            storageProfile: DYNAMIC_DAILY_STORAGE,
            onEvent: () => ({ accepted: true }),
            now: () => '2026-10-08T05:34:00.000Z' });
        await transport.start({ contracts: [contract('2603'), contract('5284')],
            connectionGeneration: 'daily_close_diagnostic_0001' });
        f.push('event: kbar\ndata: {"code":"2603","date":"2026/10/08","time":"13:29:00","volume":12}\n\n');
        f.push('event: kbar\ndata: {"code":"5284","date":"2026/10/08","time":"13:30:00","volume":7}\n\n');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(transport.status().closeFramesByCode).toEqual({
            2603: { '13:29': { frames: 1, lastReceivedAt: '2026-10-08T05:34:00.000Z', lastVolume: 12 } },
            5284: { '13:30': { frames: 1, lastReceivedAt: '2026-10-08T05:34:00.000Z', lastVolume: 7 } },
        });
        await transport.stop();
        expect(f.calls.filter(item => item.path.endsWith('/subscribe/kbars'))).toHaveLength(1);
    });

    it('非 simulation 在建立 SSE 或 subscription 前拒絕', async () => {
        const f = fixture({ simulation: false });
        const transport = createBoundedKbarTransport({ fetchImpl: f.fetchImpl, onEvent: () => ({ accepted: true }) });
        await expect(transport.start({ contracts: [contract()], connectionGeneration: 'kbar_generation_0001' }))
            .rejects.toThrow('simulation mode not confirmed');
        expect(f.calls.map((item) => item.path)).toEqual(['/api/v1/info']);
    });

    it('超過 20 檔或重複 cohort 在任何網路呼叫前拒絕', async () => {
        const fetchImpl = vi.fn();
        const transport = createBoundedKbarTransport({ fetchImpl, onEvent: () => ({ accepted: true }) });
        const many = Array.from({ length: 21 }, (_, index) => contract(String(1000 + index)));
        await expect(transport.start({ contracts: many, connectionGeneration: 'kbar_generation_0001' }))
            .rejects.toThrow('start request is invalid');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('只有完整 direct-160 profile 才接受 exact 160，並維持單次 subscribe/unsubscribe', async () => {
        const f = fixture();
        const contracts = Array.from({ length: 160 }, (_, index) => contract(String(1000 + index)));
        const transport = createBoundedKbarTransport({ fetchImpl: f.fetchImpl,
            storageProfile: DIRECT_160_STORAGE, onEvent: () => ({ accepted: true }) });
        await expect(transport.start({ contracts: contracts.slice(0, 159),
            connectionGeneration: 'direct_160_generation_1' })).rejects.toThrow('start request is invalid');
        expect(f.calls).toHaveLength(0);
        const started = await transport.start({ contracts, connectionGeneration: 'direct_160_generation_1' });
        expect(started).toMatchObject({ cohortSize: 160,
            storageProfile: DIRECT_160_STORAGE.schemaVersion });
        await transport.stop();
        expect(f.calls.filter((item) => item.path.endsWith('/subscribe/kbars'))).toHaveLength(1);
        expect(f.calls.filter((item) => item.path.endsWith('/unsubscribe/kbars'))).toHaveLength(1);
        expect(transport.status()).toMatchObject({ maximumBytes: DIRECT_160_STORAGE.streamTotalBytes,
            maximumFrameBytes: DIRECT_160_STORAGE.streamFrameBytes });
    });

    it('每日產品 profile 接受 1–160 檔單一 batch，不放寬歷史 Stage exact160', async () => {
        const f = fixture();
        const transport = createBoundedKbarTransport({ fetchImpl: f.fetchImpl,
            storageProfile: DYNAMIC_DAILY_STORAGE, onEvent: () => ({ accepted: true }) });
        const tooMany = Array.from({ length: 161 }, (_, index) => contract(String(1000 + index)));
        await expect(transport.start({ contracts: tooMany,
            connectionGeneration: 'daily_generation_0001' })).rejects.toThrow('start request is invalid');
        expect(f.calls).toHaveLength(0);
        const contracts = Array.from({ length: 159 }, (_, index) => contract(String(1000 + index)));
        const started = await transport.start({ contracts,
            connectionGeneration: 'daily_generation_0001' });
        expect(started).toMatchObject({ cohortSize: 159,
            storageProfile: DYNAMIC_DAILY_STORAGE.schemaVersion });
        await transport.stop();
        expect(f.calls.filter((item) => item.path.endsWith('/data/kbar'))).toHaveLength(1);
        expect(f.calls.filter((item) => item.path.endsWith('/subscribe/kbars'))).toHaveLength(1);
        expect(f.calls.filter((item) => item.path.endsWith('/unsubscribe/kbars'))).toHaveLength(1);
    });

    it('只允許同一 generation 與 cohort 執行一次 unsubscribe/resubscribe recovery', async () => {
        const f = fixture();
        const transport = createBoundedKbarTransport({ fetchImpl: f.fetchImpl,
            onEvent: () => ({ accepted: true }) });
        const started = await transport.start({ contracts: [contract()],
            connectionGeneration: 'kbar_generation_recovery_0001' });
        expect(await transport.recover({ connectionGeneration: 'wrong_generation_0000001',
            requestedCohortHash: started.cohortHash })).toMatchObject({ recovered: false,
            reason: 'recovery_authority_mismatch' });
        expect(await transport.recover({ connectionGeneration: 'kbar_generation_recovery_0001',
            requestedCohortHash: started.cohortHash })).toMatchObject({ recovered: true,
            attempt: 1, secondStreamCreated: false, symbolsRotated: false });
        expect(await transport.recover({ connectionGeneration: 'kbar_generation_recovery_0001',
            requestedCohortHash: started.cohortHash })).toEqual({ recovered: false,
            reason: 'recovery_already_attempted' });
        await transport.stop();
        expect(f.calls.filter((item) => item.path.endsWith('/subscribe/kbars'))).toHaveLength(2);
        expect(f.calls.filter((item) => item.path.endsWith('/unsubscribe/kbars'))).toHaveLength(2);
        expect(f.calls.filter((item) => item.path.endsWith('/data/kbar'))).toHaveLength(1);
    });

    it('唯一一次 recovery 失敗後將 transport 標為 failed 且不再重試', async () => {
        const f = fixture({ recoverySubscribeAccepted: false });
        const transport = createBoundedKbarTransport({ fetchImpl: f.fetchImpl,
            onEvent: () => ({ accepted: true }) });
        const started = await transport.start({ contracts: [contract()],
            connectionGeneration: 'kbar_generation_recovery_0002' });
        expect(await transport.recover({ connectionGeneration: 'kbar_generation_recovery_0002',
            requestedCohortHash: started.cohortHash })).toMatchObject({ recovered: false,
            attempt: 1, subscribeAccepted: false });
        expect(transport.status()).toMatchObject({ phase: 'failed', recoveryAttempts: 1 });
        expect(await transport.recover({ connectionGeneration: 'kbar_generation_recovery_0002',
            requestedCohortHash: started.cohortHash })).toMatchObject({ recovered: false,
            reason: 'recovery_already_attempted' });
        await transport.stop();
    });

    it('實體 SSE 結束後同一 owner 最多重開一次，舊 reader 結束後才新建且來源身分相同', async () => {
        const f = fixture();
        const events = [], disconnected = [], recovered = [];
        const transport = createBoundedKbarTransport({ fetchImpl: f.fetchImpl,
            onEvent(value) { events.push(value); return { accepted: true }; },
            onDisconnect(value) { disconnected.push(value); },
            onRecovered(value) { recovered.push(value); } });
        const started = await transport.start({ contracts: [contract()],
            connectionGeneration: 'kbar_generation_reconnect_0001' });
        f.closeStream();
        for (let index = 0; index < 20 && transport.status().streamActive; index += 1) {
            await new Promise(resolve => setTimeout(resolve, 1));
        }
        expect(disconnected).toHaveLength(1);
        const result = await transport.reconnectEndedStream({
            connectionGeneration: 'kbar_generation_reconnect_0001',
            requestedCohortHash: started.cohortHash });
        expect(result).toMatchObject({ recovered: true, secondStreamCreated: true,
            concurrentStreamCreated: false, symbolsRotated: false });
        expect(recovered).toHaveLength(1);
        expect(f.calls.filter(item => item.path.endsWith('/data/kbar'))).toHaveLength(2);
        f.push('event: kbar\ndata: {"code":"2330","date":"2026/09/07","time":"09:36:00","volume":3}\n\n');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(events).toHaveLength(1);
        expect(await transport.reconnectEndedStream({
            connectionGeneration: 'kbar_generation_reconnect_0001',
            requestedCohortHash: started.cohortHash })).toMatchObject({ recovered: false,
                reason: 'recovery_already_attempted' });
        await transport.stop();
    });

    it('SSE reader 異常結束時立即中止舊 socket、保留原因，才容許同 owner 有界重連', async () => {
        const f = fixture();
        const disconnected = [];
        const transport = createBoundedKbarTransport({ fetchImpl: f.fetchImpl,
            onEvent: () => ({ accepted: true }), onDisconnect(value) { disconnected.push(value); } });
        const started = await transport.start({ contracts: [contract()],
            connectionGeneration: 'kbar_generation_failed_reader_0001' });
        f.failStream(new Error('test_reader_failed'));
        for (let index = 0; index < 20 && transport.status().streamActive; index += 1) {
            await new Promise(resolve => setTimeout(resolve, 1));
        }
        expect(f.streamSignals[0].aborted).toBe(true);
        expect(disconnected).toMatchObject([{ reason: 'stream_read_failed' }]);
        expect(transport.status()).toMatchObject({ streamActive: false,
            lastDisconnectReason: 'stream_read_failed' });
        expect(await transport.reconnectEndedStream({
            connectionGeneration: 'kbar_generation_failed_reader_0001',
            requestedCohortHash: started.cohortHash })).toMatchObject({ recovered: true,
            concurrentStreamCreated: false });
        expect(f.calls.filter(item => item.path.endsWith('/data/kbar'))).toHaveLength(2);
        await transport.stop();
    });
});
