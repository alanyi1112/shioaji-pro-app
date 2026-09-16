import http from 'node:http';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IntradayMonitorConfigRepository } from './config-repository.mjs';
import { createIntradayMonitorPageLeaseCoordinator } from './page-lease-coordinator.mjs';
import {
    INTRADAY_MONITOR_LOCAL_API_MAX_BODY_BYTES,
    INTRADAY_MONITOR_LOCAL_API_PREFIX,
    createIntradayMonitorLocalApiService,
    intradayMonitorLocalApiSchemas,
} from './local-api-service.mjs';
import {
    authorizeIntradayMonitorGatewayRequest,
    createIntradayMonitorLocalApiGatewayMiddleware,
} from './vite-local-api-gateway.mjs';

const GENERATION = 'generation_test_1234567890';
const CLIENT = 'client_identity_1234567890';
const KEY = 'idempotency_key_1234567890';
const roots = [];
const servers = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function configRepository() {
    const root = await mkdtemp(path.join(tmpdir(), 'intraday-api-'));
    roots.push(root);
    return new IntradayMonitorConfigRepository(path.join(root, 'config.sqlite3'));
}

function trigger(index, kind = 'live') {
    return {
        schemaVersion: 'intraday-monitor-trigger/1',
        eventId: `event_identity_${String(index).padStart(16, '0')}`,
        eventHash: String(index).padStart(64, 'a').slice(-64),
        kind,
        tradeDate: '2026-09-04',
        baselineTradeDate: '2026-09-03',
        canonicalSymbol: `${2330 + index}.TW`,
        exchange: 'TSE',
        minuteKey: '10:00',
        configRevision: 1,
        threshold: '1.5',
        currentCumulativeVolume: 150,
        previousCumulativeVolume: 100,
        unit: 'common_lot',
        sourceVersion: 'fixture/1',
        formulaVersion: 'relative-volume/1',
        completeness: 'complete',
        createdAt: '2026-09-04T02:00:00.000Z',
    };
}

async function fixture({ triggers = [], configRepo, counters = {}, capacity = null } = {}) {
    const repository = configRepo ?? await configRepository();
    const leaseCoordinator = createIntradayMonitorPageLeaseCoordinator({
        sessionController: {
            startIntradayDemands() {
                counters.start = (counters.start ?? 0) + 1;
                return { allowed: true, subscriptionTransportAuthority: false, brokerWriteAuthority: false };
            },
            flushMinuteEvidence() {
                counters.flush = (counters.flush ?? 0) + 1;
                return { allowed: true, persistedRevision: 0, subscriptionTransportAuthority: false, brokerWriteAuthority: false };
            },
            releaseIntradayDemands() {
                counters.release = (counters.release ?? 0) + 1;
                return { allowed: true, subscriptionTransportAuthority: false, brokerWriteAuthority: false };
            },
        },
        nowEpochMs: () => 1_788_486_400_000,
        scheduleWakeup: () => ({ unref() {} }),
        cancelWakeup: () => {},
    });
    const evidenceRepository = {
        currentRevision() { counters.evidenceRead = (counters.evidenceRead ?? 0) + 1; return triggers.length; },
        listTriggers(tradeDate) { counters.resultRead = (counters.resultRead ?? 0) + 1; return triggers.filter((item) => item.tradeDate === tradeDate); },
    };
    const service = createIntradayMonitorLocalApiService({
        configRepository: repository,
        leaseCoordinator,
        evidenceRepository,
        generation: GENERATION,
        capacityProvider() {
            counters.capacityRead = (counters.capacityRead ?? 0) + 1;
            return capacity ?? { gate0EvidenceCurrent: false, globalOwnershipComplete: false, active: 0, waiting: 1, degraded: 0, confirmedPhysicalUsage: null, confirmedOtherPhysicalUsage: null, availableForMonitor: 0, reason: 'gate_evidence_missing' };
        },
        diagnosticsProvider() {
            counters.diagnosticsRead = (counters.diagnosticsRead ?? 0) + 1;
            return {
                state: 'feature_off',
                reason: 'gate_evidence_missing',
                ownershipRevision: 4,
                account: 'must-not-leak',
                password: 'must-not-leak',
                baseline: { complete: false, itemCount: 0, credential: 'must-not-leak' },
                completedMinute: {},
            };
        },
        now: () => '2026-09-04T08:00:00.000Z',
        cursorSecret: Buffer.alloc(32, 7),
    });
    return { service, repository, leaseCoordinator, counters };
}

function configRequest(overrides = {}) {
    return {
        schemaVersion: intradayMonitorLocalApiSchemas.configReplace,
        idempotencyKey: KEY,
        expectedRevision: 0,
        config: {
            schemaVersion: 'intraday-monitor-config/1',
            revision: 0,
            globalThreshold: '2.0',
            items: [{
                contract: { security_type: 'STK', region: 'TW', exchange: 'TSE', code: '2330', target_code: null },
                enabled: true,
                thresholdOverride: null,
                source: 'manual',
            }],
        },
        ...overrides,
    };
}

function leaseRequest(action, overrides = {}) {
    return {
        schemaVersion: intradayMonitorLocalApiSchemas.leaseRequest,
        idempotencyKey: `${KEY}_${action}`,
        clientId: CLIENT,
        generation: GENERATION,
        ...overrides,
    };
}

async function startServer(service) {
    const middleware = createIntradayMonitorLocalApiGatewayMiddleware({ service });
    const server = http.createServer((request, response) => middleware(request, response, () => { response.statusCode = 418; response.end('next'); }));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port: 0 }, resolve); });
    servers.push(server);
    return server.address().port;
}

function request(port, { pathname = `${INTRADAY_MONITOR_LOCAL_API_PREFIX}/status`, method = 'GET', body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
        const outgoing = http.request({
            host: '127.0.0.1', port, path: pathname, method,
            headers: {
                Host: `127.0.0.1:${port}`,
                Origin: `http://127.0.0.1:${port}`,
                'Sec-Fetch-Site': 'same-origin',
                ...(payload === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) }),
                ...headers,
            },
        }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.once('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let parsed = text;
                try { parsed = JSON.parse(text); } catch {}
                resolve({ status: response.statusCode, headers: response.headers, body: parsed });
            });
        });
        outgoing.once('error', reject);
        if (payload !== undefined) outgoing.write(payload);
        outgoing.end();
    });
}

function readSseReplay(port, { cursor } = {}) {
    return new Promise((resolve, reject) => {
        const outgoing = http.request({
            host: '127.0.0.1',
            port,
            path: `${INTRADAY_MONITOR_LOCAL_API_PREFIX}/events?tradeDate=2026-09-04&limit=2`,
            headers: {
                Host: `127.0.0.1:${port}`,
                Origin: `http://127.0.0.1:${port}`,
                'Sec-Fetch-Site': 'same-origin',
                Accept: 'text/event-stream',
                ...(cursor ? { 'Last-Event-ID': cursor } : {}),
            },
        }, (response) => {
            let text = '';
            response.on('data', (chunk) => {
                text += chunk.toString('utf8');
                if (!text.includes('\n\n')) return;
                response.destroy();
                const id = text.match(/^id: (.+)$/m)?.[1] ?? null;
                const data = text.match(/^data: (.+)$/m)?.[1];
                resolve({ status: response.statusCode, id, body: data ? JSON.parse(data) : null });
            });
        });
        outgoing.once('error', reject);
        outgoing.end();
    });
}

function readSseTriggerFrames(port, { triggers, expected = 2 } = {}) {
    return new Promise((resolve, reject) => {
        const outgoing = http.request({
            host: '127.0.0.1', port,
            path: `${INTRADAY_MONITOR_LOCAL_API_PREFIX}/events?tradeDate=2026-09-04&limit=100`,
            headers: { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}`,
                'Sec-Fetch-Site': 'same-origin', Accept: 'text/event-stream' },
        }, (response) => {
            let pending = '';
            const frames = [];
            let seeded = false;
            const timer = setTimeout(() => { response.destroy(); reject(new Error('SSE trigger timeout')); }, 5_000);
            response.on('data', (chunk) => {
                pending += chunk.toString('utf8').replaceAll('\r', '');
                let boundary;
                while ((boundary = pending.indexOf('\n\n')) >= 0) {
                    const frame = pending.slice(0, boundary);
                    pending = pending.slice(boundary + 2);
                    const event = frame.match(/^event: (.+)$/m)?.[1];
                    if (event === 'replay' && !seeded) {
                        seeded = true;
                        triggers.push(trigger(1), trigger(2));
                    } else if (event === 'trigger') {
                        const id = frame.match(/^id: (.+)$/m)?.[1] ?? null;
                        const data = frame.match(/^data: (.+)$/m)?.[1];
                        frames.push({ id, body: data ? JSON.parse(data) : null });
                        if (frames.length === expected) {
                            clearTimeout(timer);
                            response.destroy();
                            resolve(frames);
                            return;
                        }
                    }
                }
            });
        });
        outgoing.once('error', reject);
        outgoing.end();
    });
}

describe('intraday monitor local API service', () => {
    it('atomically replaces config with revision and idempotency protection', async () => {
        const { service } = await fixture();
        const first = service.replaceConfig(configRequest());
        expect(first).toMatchObject({ status: 200, body: { ok: true, revision: 1, config: { globalThreshold: '2', items: [{ contract: { code: '2330' } }] } } });
        expect(service.replaceConfig(configRequest())).toEqual(first);
        const reusedKey = configRequest();
        reusedKey.config.globalThreshold = '3';
        expect(service.replaceConfig(reusedKey)).toMatchObject({ status: 409, body: { reason: 'idempotency_conflict' } });

        const conflict = configRequest({ idempotencyKey: `${KEY}_new`, expectedRevision: 0 });
        expect(service.replaceConfig(conflict)).toMatchObject({ status: 409, body: { reason: 'revision_conflict' } });
    });

    it('returns itemized config errors and rejects unknown or trading fields', async () => {
        const { service } = await fixture();
        const invalid = configRequest({ idempotencyKey: `${KEY}_bad` });
        invalid.config.items[0].contract.code = 'bad';
        expect(service.replaceConfig(invalid)).toMatchObject({ status: 422, body: { reason: 'invalid_config', details: [{ path: '$.items[0].contract', code: 'invalid_contract' }] } });
        expect(service.replaceConfig({ ...configRequest(), orderPrice: 100 })).toMatchObject({ status: 400, body: { reason: 'invalid_config_request' } });
    });

    it('acquires, renews, releases, and rejects stale-generation leases', async () => {
        const { service, counters } = await fixture();
        expect(service.mutateLease('acquire', leaseRequest('stale', { generation: 'stale_generation_12345' }))).toMatchObject({ status: 409, body: { reason: 'stale_generation', details: { currentGeneration: GENERATION } } });
        const acquired = service.mutateLease('acquire', leaseRequest('acquire'));
        expect(acquired).toMatchObject({ status: 200, body: { action: 'acquired', lease: { clientId: CLIENT, generation: GENERATION }, ttlMs: 15000 } });
        expect(counters.start).toBe(1);
        const leaseId = acquired.body.lease.leaseId;
        const renewed = service.mutateLease('renew', leaseRequest('renew', { leaseId }));
        expect(renewed).toMatchObject({ status: 200, body: { action: 'renewed' } });
        expect(renewed.body.lease.leaseId).not.toBe(leaseId);
        expect(service.mutateLease('release', leaseRequest('release', { leaseId: renewed.body.lease.leaseId }))).toMatchObject({ status: 200, body: { action: 'released', activeLeaseCount: 0, stopCompleted: true } });
        expect(counters.flush).toBe(1);
        expect(counters.release).toBe(1);
    });

    it('paginates results with signed generation-bound cursors and replay without notification authority', async () => {
        const { service } = await fixture({ triggers: [trigger(1), trigger(2), trigger(3, 'historical')] });
        const first = service.readResults({ tradeDate: '2026-09-04', limit: '2', cursor: null });
        expect(first).toMatchObject({ status: 200, body: { generation: GENERATION, items: [{ notificationAuthority: false }, { notificationAuthority: false }], replayNotificationAuthority: false } });
        expect(first.body.nextCursor).toBeTruthy();
        const second = service.readEvents({ tradeDate: '2026-09-04', limit: '2', cursor: first.body.nextCursor });
        expect(second).toMatchObject({ status: 200, body: { items: [{ eventId: trigger(3).eventId, notificationAuthority: false }], nextCursor: null } });
        expect(service.readResults({ tradeDate: '2026-09-04', limit: '2', cursor: `${first.body.nextCursor}x` })).toMatchObject({ status: 409, body: { reason: 'invalid_cursor' } });
    });

    it('projects status, capacity, and diagnostics without secrets', async () => {
        const { service } = await fixture();
        expect(service.replaceConfig(configRequest())).toMatchObject({ status: 200, body: { revision: 1 } });
        expect(service.readStatus()).toMatchObject({ status: 200, body: {
            state: 'feature_off', reason: 'gate_evidence_missing', generation: GENERATION,
            capacity: { configured: 1, eligible: 1, pilotCohort: 1, dataActive: 0, active: 0, waiting: 1, waitingGate: 1, waitingPilotLimit: 0, waitingCapacity: 0, waitingBaseline: 0, availableForMonitor: 0, subscriptionTransportAuthority: false },
            itemStatuses: [{ canonicalSymbol: '2330.TW', state: 'waiting_gate', reason: 'gate_evidence_missing', effectiveThreshold: '2', baseline: { state: 'unknown' }, subscription: { state: 'none' } }],
        } });
        expect(service.readCapacity()).toMatchObject({ status: 200, body: { active: 0, requiredHeadroom: 40, brokerWriteAuthority: false } });
        const diagnostics = service.readDiagnostics();
        expect(diagnostics).toMatchObject({ status: 200, body: { state: 'feature_off', secretsExposed: false, accountIdentifiersExposed: false, brokerWriteAuthority: false } });
        expect(JSON.stringify(diagnostics)).not.toContain('must-not-leak');
    });

    it('固定排序前 20 檔為 pilot cohort，其餘啟用商品等待 pilot limit', async () => {
        const { service } = await fixture();
        const request = configRequest({ idempotencyKey: `${KEY}_cohort` });
        request.config.items = [{
            contract: { security_type: 'STK', region: 'TW', exchange: 'TSE',
                code: '00988A', target_code: null },
            enabled: true,
            thresholdOverride: null,
            source: 'manual',
        }, {
            contract: { security_type: 'STK', region: 'TW', exchange: 'TSE',
                code: '0050', target_code: null },
            enabled: true,
            thresholdOverride: null,
            source: 'manual',
        }, ...Array.from({ length: 23 }, (_, index) => ({
            contract: { security_type: 'STK', region: 'TW', exchange: 'TSE',
                code: String(1001 + index), target_code: null },
            enabled: true,
            thresholdOverride: null,
            source: 'manual',
        }))];
        expect(service.replaceConfig(request)).toMatchObject({ status: 200 });
        const status = service.readStatus();
        expect(status).toMatchObject({ status: 200, body: { capacity: {
            configured: 25, eligible: 23, pilotCohort: 20, dataActive: 0,
            approvedActiveLimit: 20, evaluationStageTarget: null,
            evaluationState: 'not_scheduled',
            waiting: 23, waitingGate: 20, waitingPilotLimit: 3,
        } } });
        expect(status.body.itemStatuses[0]).toMatchObject({ state: 'degraded', reason: 'kbar_contract_unsupported' });
        expect(status.body.itemStatuses[1]).toMatchObject({ state: 'degraded', reason: 'kbar_contract_unsupported' });
        expect(status.body.itemStatuses.slice(2, 22).every((item) =>
            item.state === 'waiting_gate' && item.reason === 'gate_evidence_missing')).toBe(true);
        expect(status.body.itemStatuses.slice(22).every((item) =>
            item.state === 'waiting_pilot_limit' && item.reason === 'approved_active_limit')).toBe(true);
    });

    it('fails closed while repositories are offline', async () => {
        const offline = { read: vi.fn(() => { throw new Error('offline'); }), replace: vi.fn(() => { throw new Error('offline'); }) };
        const { service } = await fixture({ configRepo: offline });
        expect(service.readConfig()).toMatchObject({ status: 503, body: { reason: 'config_repository_unavailable' } });
        expect(service.readStatus()).toMatchObject({ status: 503, body: { reason: 'config_repository_unavailable' } });
    });

    it('bounded KBar evaluation 可在 global ownership unknown 時顯示 exact stage target', async () => {
        const repository = await configRepository();
        const current = repository.read();
        const items = Array.from({ length: 25 }, (_, index) => ({
            contract: { security_type: 'STK', region: 'TW', exchange: 'TSE',
                code: String(1001 + index), target_code: null }, enabled: true,
            thresholdOverride: null, source: 'manual',
        }));
        repository.replace({ schemaVersion: 'intraday-monitor-config/1', revision: current.revision,
            globalThreshold: '2', items });
        const rawItems = items.map((item) => ({ canonicalSymbol: `${item.contract.code}.TW`,
            state: 'active', reason: 'none', baselineState: 'complete', baselineTradeDate: '2026-09-14',
            baselineSourceVersion: 'fixture/1', subscriptionState: 'confirmed',
            physicalKey: `bounded-kbar:${item.contract.code}.TW`, completedMinute: '09:01',
            currentCumulativeVolume: 20, previousCumulativeVolume: 10,
            updatedAt: '2026-09-15T09:02:00+08:00' }));
        const { service } = await fixture({ configRepo: repository, capacity: {
            gate0EvidenceCurrent: true, globalOwnershipComplete: false, boundedTransportReady: true,
            approvedActiveLimit: 20, evaluationStageTarget: 160, evaluationState: 'running',
            active: 25, availableForMonitor: 25, items: rawItems, reason: 'bounded_kbar_stage_running',
        } });
        expect(service.readStatus()).toMatchObject({ status: 200, body: { state: 'idle', capacity: {
            approvedActiveLimit: 20, evaluationStageTarget: 160, boundedTransportReady: true,
            globalOwnershipComplete: false, dataActive: 25, waitingPilotLimit: 0,
        } } });
    });
});

describe('intraday monitor loopback gateway', () => {
    it('serves fixed local routes and leaves GET free of runtime/subscription mutations', async () => {
        const counters = {};
        const { service } = await fixture({ counters });
        const port = await startServer(service);
        expect(await request(port)).toMatchObject({ status: 200, body: { state: 'feature_off', brokerWriteAuthority: false } });
        expect(counters.start ?? 0).toBe(0);
        expect(counters.flush ?? 0).toBe(0);
        expect(counters.release ?? 0).toBe(0);
    });

    it('rejects hosted, cross-origin, malformed, and oversized requests before service access', async () => {
        const service = { readStatus: vi.fn() };
        const port = await startServer(service);
        expect(await request(port, { headers: { Host: 'example.com', Origin: 'https://example.com' } })).toMatchObject({ status: 403, body: { reason: 'local_only' } });
        expect(await request(port, { headers: { Origin: 'http://evil.invalid' } })).toMatchObject({ status: 403, body: { reason: 'same_origin_required' } });
        expect(await request(port, { headers: { 'X-Forwarded-For': '127.0.0.1' } })).toMatchObject({ status: 403, body: { reason: 'hosted_target_disabled' } });
        expect(authorizeIntradayMonitorGatewayRequest({
            url: `${INTRADAY_MONITOR_LOCAL_API_PREFIX}/config`, method: 'PUT',
            rawHeaders: ['Host', '127.0.0.1:5173', 'Origin', 'http://127.0.0.1:5173', 'Content-Type', 'application/json', 'Content-Length', String(INTRADAY_MONITOR_LOCAL_API_MAX_BODY_BYTES + 1)],
            socket: { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1' },
        })).toMatchObject({ allowed: false, status: 413, reason: 'payload_too_large' });
        expect(service.readStatus).not.toHaveBeenCalled();
    });

    it('routes JSON mutations with no-store security headers', async () => {
        const { service } = await fixture();
        const port = await startServer(service);
        const response = await request(port, { pathname: `${INTRADAY_MONITOR_LOCAL_API_PREFIX}/config`, method: 'PUT', body: configRequest() });
        expect(response).toMatchObject({ status: 200, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }, body: { ok: true, revision: 1 } });
    });

    it('routes passive chart observations only to an explicit local recorder', async () => {
        const { service } = await fixture();
        const chartEvidenceRecorder = { observe: vi.fn(async () => ({ status: 202,
            body: { ok: true, state: 'awaiting_visual_commit_advance',
                brokerWriteAuthority: false } })) };
        const middleware = createIntradayMonitorLocalApiGatewayMiddleware({ service,
            chartEvidenceRecorder });
        const server = http.createServer((request, response) => middleware(request, response,
            () => { response.statusCode = 418; response.end('next'); }));
        await new Promise((resolve, reject) => { server.once('error', reject);
            server.listen({ host: '127.0.0.1', port: 0 }, resolve); });
        servers.push(server);
        const response = await request(server.address().port, {
            pathname: `${INTRADAY_MONITOR_LOCAL_API_PREFIX}/chart-evidence/observations`,
            method: 'POST', body: { schemaVersion: 'fixture/1' },
        });
        expect(response).toMatchObject({ status: 202,
            body: { state: 'awaiting_visual_commit_advance', brokerWriteAuthority: false } });
        expect(chartEvidenceRecorder.observe).toHaveBeenCalledOnce();
    });

    it('reconnects SSE from Last-Event-ID without granting replay notification authority', async () => {
        const { service } = await fixture({ triggers: [trigger(1), trigger(2), trigger(3)] });
        const port = await startServer(service);
        const first = await readSseReplay(port);
        expect(first).toMatchObject({ status: 200, body: { items: [{ notificationAuthority: false }, { notificationAuthority: false }], replayNotificationAuthority: false } });
        expect(first.id).toBeTruthy();
        const reconnect = await readSseReplay(port, { cursor: first.id });
        expect(reconnect).toMatchObject({ status: 200, body: { items: [{ eventId: trigger(3).eventId, notificationAuthority: false }], replayNotificationAuthority: false } });
    });

    it('polls triggers persisted by an external recorder with one durable cursor per event', async () => {
        const triggers = [];
        const { service } = await fixture({ triggers });
        const port = await startServer(service);
        const frames = await readSseTriggerFrames(port, { triggers });
        expect(frames.map((frame) => frame.body.eventId)).toEqual([trigger(1).eventId, trigger(2).eventId]);
        expect(frames[0].id).toBeTruthy();
        expect(frames[1].id).toBeTruthy();
        expect(frames[0].id).not.toBe(frames[1].id);
        expect(frames.every((frame) => frame.body.notificationAuthority === false &&
            frame.body.brokerWriteAuthority === false)).toBe(true);
        const reconnect = await readSseReplay(port, { cursor: frames[0].id });
        expect(reconnect.body.items.map((item) => item.eventId)).toEqual([trigger(2).eventId]);
    });
});
