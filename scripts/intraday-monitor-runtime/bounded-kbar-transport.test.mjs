import { describe, expect, it, vi } from 'vitest';
import { createBoundedKbarTransport } from './bounded-kbar-transport.mjs';
import { DIRECT_160_STORAGE } from './direct-160-storage.mjs';

const contract = (code = '2330') => ({ securityType: 'STK', region: 'TW', exchange: 'TSE', code, targetCode: null, canonicalSymbol: `${code}.TW` });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function fixture({ simulation = true, recoverySubscribeAccepted = true } = {}) {
    let streamController;
    let subscribeCount = 0;
    const calls = [];
    const fetchImpl = vi.fn(async (url, init = {}) => {
        calls.push({ path: new URL(url).pathname, method: init.method ?? 'GET', body: init.body ?? null });
        const path = new URL(url).pathname;
        if (path.endsWith('/info')) return json({ version: '1.7.1', simulation });
        if (path.endsWith('/data/kbar')) return new Response(new ReadableStream({ start(controller) { streamController = controller; } }), { headers: { 'content-type': 'text/event-stream' } });
        if (path.endsWith('/subscribe/kbars')) {
            subscribeCount += 1;
            return json({ success: subscribeCount === 1 || recoverySubscribeAccepted,
                message: 'accepted' });
        }
        if (path.endsWith('/unsubscribe/kbars')) return json({ success: true, message: 'accepted' });
        throw new Error(`unexpected ${path}`);
    });
    return { fetchImpl, calls, push(frame) { streamController.enqueue(new TextEncoder().encode(frame)); } };
}

describe('bounded realtime KBar transport', () => {
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
});
