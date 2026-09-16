import { randomBytes } from 'node:crypto';

import {
    IntradayMonitorConfigRepository,
    resolveIntradayMonitorDatabasePath,
} from './config-repository.mjs';
import {
    IntradayMonitorEvidenceRepository,
    resolveIntradayMonitorEvidenceDatabasePath,
} from './evidence-repository.mjs';
import { createIntradayMonitorPageLeaseCoordinator } from './page-lease-coordinator.mjs';
import {
    INTRADAY_MONITOR_LOCAL_API_MAX_BODY_BYTES,
    INTRADAY_MONITOR_LOCAL_API_PREFIX,
    createIntradayMonitorLocalApiService,
} from './local-api-service.mjs';
import {
    readDirect160ProductRuntimeState,
    resolveDirect160ProductRuntimePath,
} from './direct-160-product-runtime.mjs';
import { createPassiveChartEvidenceRecorder } from './passive-chart-evidence-recorder.mjs';

const MAX_URL_BYTES = 2_048;
const MAX_RAW_HEADER_PAIRS = 64;
const BODY_TIMEOUT_MS = 3_000;
const REJECTED_PROXY_HEADERS = new Set([
    'forwarded', 'via', 'x-forwarded-for', 'x-forwarded-host',
    'x-forwarded-port', 'x-forwarded-proto', 'x-real-ip',
    'true-client-ip', 'cf-connecting-ip', 'cf-ray', 'cdn-loop',
]);
const JSON_HEADERS = Object.freeze({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
});

function isLoopbackAddress(value) {
    return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

function parseHeaders(request) {
    if (!Array.isArray(request.rawHeaders) || request.rawHeaders.length % 2 !== 0 || request.rawHeaders.length / 2 > MAX_RAW_HEADER_PAIRS) return null;
    const result = new Map();
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index]?.toLowerCase();
        const value = request.rawHeaders[index + 1];
        if (typeof name !== 'string' || typeof value !== 'string' || !/^[a-z0-9-]{1,64}$/.test(name) || result.has(name) || value.length > 2_048 || /[\r\n\0]/.test(value)) return null;
        result.set(name, value);
    }
    return result;
}

function routeFor(method, pathname) {
    if (method === 'GET') {
        if (pathname === '/config') return 'config';
        if (pathname === '/status') return 'status';
        if (pathname === '/capacity') return 'capacity';
        if (pathname === '/results') return 'results';
        if (pathname === '/events') return 'events';
        if (pathname === '/diagnostics') return 'diagnostics';
    }
    if (method === 'PUT' && pathname === '/config') return 'config_replace';
    if (method === 'POST' && pathname === '/leases/acquire') return 'lease_acquire';
    if (method === 'POST' && pathname === '/leases/renew') return 'lease_renew';
    if (method === 'POST' && pathname === '/leases/release') return 'lease_release';
    if (method === 'POST' && pathname === '/chart-evidence/observations') return 'chart_evidence_observe';
    return null;
}

function validQuery(route, url) {
    const allowed = route === 'results' || route === 'events'
        ? new Set(['tradeDate', 'limit', 'cursor'])
        : new Set();
    for (const key of url.searchParams.keys()) {
        if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) return false;
    }
    if (route === 'results' || route === 'events') return url.searchParams.has('tradeDate');
    return url.search === '';
}

export function authorizeIntradayMonitorGatewayRequest(request) {
    const rawUrl = request.url ?? '/';
    if (!(rawUrl === INTRADAY_MONITOR_LOCAL_API_PREFIX || rawUrl.startsWith(`${INTRADAY_MONITOR_LOCAL_API_PREFIX}/`) || rawUrl.startsWith(`${INTRADAY_MONITOR_LOCAL_API_PREFIX}?`))) return null;
    if (Buffer.byteLength(rawUrl) > MAX_URL_BYTES || /%(?:2f|5c|2e|00)/i.test(rawUrl)) return { allowed: false, status: 400, reason: 'invalid_url' };
    const headers = parseHeaders(request);
    if (!headers) return { allowed: false, status: 400, reason: 'invalid_headers' };
    if (!isLoopbackAddress(request.socket?.remoteAddress) || !isLoopbackAddress(request.socket?.localAddress)) return { allowed: false, status: 403, reason: 'loopback_required' };
    if ([...REJECTED_PROXY_HEADERS].some((name) => headers.has(name))) return { allowed: false, status: 403, reason: 'hosted_target_disabled' };
    const host = headers.get('host') ?? '';
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\]):(?:[1-9]\d{0,4})$/.test(host)) return { allowed: false, status: 403, reason: 'local_only' };
    const origin = headers.get('origin');
    if (origin !== undefined && origin !== `http://${host}`) return { allowed: false, status: 403, reason: 'same_origin_required' };
    if (headers.get('sec-fetch-site') === 'cross-site') return { allowed: false, status: 403, reason: 'same_origin_required' };
    let url;
    try { url = new URL(rawUrl, 'http://127.0.0.1'); } catch { return { allowed: false, status: 400, reason: 'invalid_url' }; }
    const pathname = url.pathname.slice(INTRADAY_MONITOR_LOCAL_API_PREFIX.length) || '/';
    const route = routeFor(request.method ?? 'GET', pathname);
    if (!route) return { allowed: false, status: 404, reason: 'route_not_allowed' };
    if (!validQuery(route, url)) return { allowed: false, status: 400, reason: 'invalid_query' };
    const mutation = route === 'config_replace' || route.startsWith('lease_') ||
        route === 'chart_evidence_observe';
    if (mutation && (headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') return { allowed: false, status: 415, reason: 'json_required' };
    if (!mutation && headers.has('content-length') && headers.get('content-length') !== '0') return { allowed: false, status: 400, reason: 'get_body_forbidden' };
    const declaredLength = headers.get('content-length');
    if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > INTRADAY_MONITOR_LOCAL_API_MAX_BODY_BYTES)) return { allowed: false, status: 413, reason: 'payload_too_large' };
    return { allowed: true, route, mutation, url, headers };
}

function sendJson(response, result) {
    response.statusCode = result.status;
    for (const [name, value] of Object.entries(JSON_HEADERS)) response.setHeader(name, value);
    response.end(JSON.stringify(result.body));
}

function boundaryError(status, reason) {
    return { status, body: { schemaVersion: 'intraday-monitor-local-api/1', ok: false, reason, brokerWriteAuthority: false } };
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        const timer = setTimeout(() => reject(new Error('body_timeout')), BODY_TIMEOUT_MS);
        timer.unref?.();
        request.on('data', (chunk) => {
            size += chunk.length;
            if (size > INTRADAY_MONITOR_LOCAL_API_MAX_BODY_BYTES) {
                reject(new Error('payload_too_large'));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.once('end', () => {
            clearTimeout(timer);
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch { reject(new Error('invalid_json')); }
        });
        request.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
}

function queryObject(url, fallbackCursor = null) {
    return {
        tradeDate: url.searchParams.get('tradeDate'),
        limit: url.searchParams.get('limit') ?? '50',
        cursor: url.searchParams.get('cursor') ?? fallbackCursor,
    };
}

function openEventStream(request, response, service, checked) {
    const snapshot = service.readEvents(
        queryObject(checked.url, checked.headers.get('last-event-id') ?? null),
    );
    if (snapshot.status !== 200) return sendJson(response, snapshot);
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.write(`id: ${snapshot.body.cursor}\n`);
    response.write(`event: replay\n`);
    response.write(`data: ${JSON.stringify(snapshot.body)}\n\n`);
    const tradeDate = checked.url.searchParams.get('tradeDate');
    let repositoryCursor = snapshot.body.cursor;
    const unsubscribe = service.subscribe((projection) => {
        if (projection.event.tradeDate !== tradeDate || response.writableEnded) return;
        response.write(`id: ${projection.cursor}\n`);
        response.write('event: trigger\n');
        response.write(`data: ${JSON.stringify(projection.event)}\n\n`);
    });
    const heartbeat = setInterval(() => {
        if (!response.writableEnded) response.write(': heartbeat\n\n');
    }, 15_000);
    heartbeat.unref?.();
    let polling = false;
    const poll = setInterval(() => {
        if (polling || response.writableEnded) return;
        polling = true;
        try {
            let cursor = repositoryCursor;
            // 一次只投影一筆，使 Last-Event-ID 精確指向已送出的事件；若連線在一批事件
            // 中途斷線，重連不會跳過尚未送出的同批事件。
            for (let itemIndex = 0; itemIndex < 200; itemIndex += 1) {
                const next = service.readEvents({ tradeDate, limit: '1', cursor });
                if (next.status !== 200) break;
                for (const item of next.body.items) {
                    const projected = { ...item,
                        notificationAuthority: service.liveNotificationAuthority?.() === true,
                        brokerWriteAuthority: false };
                    response.write(`id: ${next.body.cursor}\n`);
                    response.write('event: trigger\n');
                    response.write(`data: ${JSON.stringify(projected)}\n\n`);
                }
                repositoryCursor = next.body.cursor;
                if (!next.body.nextCursor || next.body.items.length === 0) break;
                cursor = next.body.nextCursor;
            }
        } finally { polling = false; }
    }, 1_000);
    poll.unref?.();
    const close = () => { clearInterval(heartbeat); clearInterval(poll); unsubscribe(); };
    request.once('close', close);
    response.once('close', close);
}

export function createIntradayMonitorLocalApiGatewayMiddleware({ service, chartEvidenceRecorder = null } = {}) {
    if (!service) throw new TypeError('service is required');
    return async (request, response, next) => {
        const checked = authorizeIntradayMonitorGatewayRequest(request);
        if (!checked) return next();
        if (!checked.allowed) return sendJson(response, boundaryError(checked.status, checked.reason));
        if (checked.route === 'events') return openEventStream(request, response, service, checked);
        let result;
        if (checked.mutation) {
            let body;
            try { body = await readJsonBody(request); }
            catch (error) { return sendJson(response, boundaryError(error.message === 'payload_too_large' ? 413 : 400, error.message === 'payload_too_large' ? 'payload_too_large' : 'invalid_json')); }
            if (checked.route === 'config_replace') result = service.replaceConfig(body);
            else if (checked.route === 'chart_evidence_observe') {
                if (!chartEvidenceRecorder) return sendJson(response,
                    boundaryError(503, 'chart_evidence_recorder_unavailable'));
                result = await chartEvidenceRecorder.observe(body);
            }
            else result = service.mutateLease(checked.route.slice('lease_'.length), body);
        } else if (checked.route === 'config') result = service.readConfig();
        else if (checked.route === 'status') result = service.readStatus();
        else if (checked.route === 'capacity') result = service.readCapacity();
        else if (checked.route === 'results') result = service.readResults(queryObject(checked.url));
        else result = service.readDiagnostics();
        return sendJson(response, result);
    };
}

export function createStateBackedRuntime(appSupportRoot) {
    const configRepository = new IntradayMonitorConfigRepository(resolveIntradayMonitorDatabasePath(appSupportRoot));
    const evidenceRepository = new IntradayMonitorEvidenceRepository(resolveIntradayMonitorEvidenceDatabasePath(appSupportRoot));
    const statePath = resolveDirect160ProductRuntimePath(appSupportRoot);
    const state = () => readDirect160ProductRuntimeState(statePath);
    const sessionController = Object.freeze({
        startIntradayDemands: () => {
            const current = state();
            return { allowed: Boolean(current),
                reason: current ? 'product_runtime_available' : 'gate_evidence_missing',
                subscriptionTransportAuthority: false, brokerWriteAuthority: false };
        },
        flushMinuteEvidence: () => ({ allowed: true, persistedRevision: evidenceRepository.currentRevision(), subscriptionTransportAuthority: false, brokerWriteAuthority: false }),
        releaseIntradayDemands: () => ({ allowed: true, subscriptionTransportAuthority: false, brokerWriteAuthority: false }),
    });
    const leaseCoordinator = createIntradayMonitorPageLeaseCoordinator({ sessionController });
    const generation = `local_${randomBytes(24).toString('base64url')}`;
    const service = createIntradayMonitorLocalApiService({
        configRepository,
        evidenceRepository,
        leaseCoordinator,
        generation,
        capacityProvider: () => {
            const enabledItems = configRepository.read().items.filter((item) => item.enabled);
            const eligible = enabledItems.filter((item) => /^(?!00)\d{4}$/.test(item.contract.code)).length;
            const current = state();
            if (!current) return { gate0EvidenceCurrent: false, globalOwnershipComplete: false, active: 0,
                waiting: eligible, waitingGate: Math.min(eligible, 20), waitingPilotLimit: Math.max(0, eligible - 20),
                degraded: enabledItems.length - eligible, confirmedPhysicalUsage: null, confirmedOtherPhysicalUsage: null,
                availableForMonitor: 0, reason: 'gate_evidence_missing' };
            const running = current.phase === 'running_evaluation' || current.phase === 'running_approved';
            const usable = !['failed', 'complete_no_go'].includes(current.phase);
            const dataActive = current.items.filter((item) => item.dataPlaneState === 'active').length;
            const awaitingFirstKbar = current.items.filter((item) =>
                item.dataPlaneState === 'awaiting_first_kbar').length;
            return { gate0EvidenceCurrent: usable, globalOwnershipComplete: false,
                boundedTransportReady: current.boundedTransportReady,
                controlPlaneSubscriptionRequested: current.controlPlaneSubscriptionRequested === true,
                awaitingFirstKbar, notificationAuthority: current.notificationAuthority,
                approvedActiveLimit: current.approvedActiveLimit,
                evaluationStageTarget: 160, evaluationState: current.evaluationState,
                dataActive: running ? dataActive : 0,
                active: running ? current.items.filter((item) => item.state === 'active').length : 0,
                waiting: running ? awaitingFirstKbar : Math.min(eligible, current.approvedActiveLimit),
                waitingGate: 0, waitingPilotLimit: Math.max(0, eligible - current.approvedActiveLimit),
                degraded: current.items.filter((item) => item.state === 'degraded').length,
                confirmedPhysicalUsage: null, confirmedOtherPhysicalUsage: null,
                providerReleaseProven: null, confirmedHeadroom: null,
                availableForMonitor: running ? dataActive : 0,
                evidenceAt: current.updatedAt,
                reason: running ? 'bounded_kbar_stage_running' : current.phase === 'complete_go'
                    ? 'approved_160' : current.phase === 'pending_review' ? 'pending_review' : 'capture_failed',
                items: current.items.map((item) => ({ ...item,
                    state: running ? item.state : 'waiting_gate',
                    reason: running ? item.reason : current.phase === 'complete_go' ? 'outside_session' : current.phase })) };
        },
        diagnosticsProvider: () => {
            const current = state();
            if (!current) return { state: 'feature_off', reason: 'gate_evidence_missing',
                baseline: { complete: false, itemCount: 0 }, completedMinute: {} };
            const running = current.phase === 'running_evaluation' || current.phase === 'running_approved';
            const minutes = current.items.map((item) => item.completedMinute).filter(Boolean).sort();
            return { state: running ? 'active' : current.phase === 'failed' ? 'degraded' : 'idle',
                reason: running ? 'none' : current.phase,
                baseline: { complete: true, tradeDate: current.baselineTradeDate,
                    sourceVersion: `direct-160/${current.baselineHash}`, itemCount: 160 },
                completedMinute: { tradeDate: current.tradeDate, minuteKey: minutes.at(-1) ?? null,
                    evidenceAt: current.updatedAt } };
        },
    });
    return {
        service,
        close() {
            service.close();
            leaseCoordinator.close();
            evidenceRepository.close();
            configRepository.close();
        },
    };
}

export function intradayMonitorLocalApiGateway({ appSupportRoot, runtimeFactory = createStateBackedRuntime } = {}) {
    if (typeof appSupportRoot !== 'string') throw new TypeError('appSupportRoot is required');
    return {
        name: 'realtimestock-intraday-monitor-local-api',
        configureServer(server) {
            const runtime = runtimeFactory(appSupportRoot);
            const chartEvidenceRecorder = createPassiveChartEvidenceRecorder({ appSupportRoot });
            server.middlewares.use(createIntradayMonitorLocalApiGatewayMiddleware({
                service: runtime.service, chartEvidenceRecorder,
            }));
            server.httpServer?.once('close', () => runtime.close());
        },
    };
}
