import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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
import { readDynamicDailyActivePlan } from './dynamic-daily-active-plan.mjs';
import { readPostcloseTailRecoveryView } from './postclose-tail-recovery-view.mjs';
import { IntradayMonitorSessionStateRepository } from './session-state-repository.mjs';
import { resolveIntradayMonitorRuntimeArtifactBundleSync } from './runtime-artifact-bundle.mjs';
import {
    evaluateIntradayMonitorCurrentSession,
    normalizeIntradayMonitorSessionItems,
} from './current-session-authority.mjs';

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

function readPremarketCaptureFailure(appSupportRoot, tradeDate) {
    const receiptPath = path.join(appSupportRoot, 'IntradayMonitor', 'premarket',
        'receipts', `${tradeDate}-0850.json`);
    let receipt;
    try { receipt = JSON.parse(readFileSync(receiptPath, 'utf8')); }
    catch { return null; }
    if (receipt?.schemaVersion !== 'intraday-monitor-premarket-orchestrator/1' ||
        receipt.localDate !== tradeDate || receipt.step !== '08:50') return null;
    return receipt.rolloverOutcome === 'failed' ? receipt.reason ?? 'unknown' : null;
}

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
        if (pathname === '/daily-status') return 'daily_status';
        if (pathname === '/postclose-recovery') return 'postclose_recovery';
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
    const allowed = route === 'results' || route === 'events' || route === 'postclose_recovery'
        ? new Set(['tradeDate', 'limit', 'cursor'])
        : new Set();
    for (const key of url.searchParams.keys()) {
        if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) return false;
    }
    if (route === 'postclose_recovery') return url.searchParams.size === 1 &&
        /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('tradeDate') ?? '');
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

export function createIntradayMonitorLocalApiGatewayMiddleware({ service, chartEvidenceRecorder = null,
    postcloseRecoveryRoot = null } = {}) {
    if (!service) throw new TypeError('service is required');
    return async (request, response, next) => {
        const checked = authorizeIntradayMonitorGatewayRequest(request);
        if (!checked) return next();
        if (!checked.allowed) return sendJson(response, boundaryError(checked.status, checked.reason));
        if (checked.route === 'events') return openEventStream(request, response, service, checked);
        if (checked.route === 'postclose_recovery') {
            if (!postcloseRecoveryRoot) return sendJson(response,
                boundaryError(503, 'postclose_recovery_unavailable'));
            const recovery = readPostcloseTailRecoveryView(postcloseRecoveryRoot,
                checked.url.searchParams.get('tradeDate'));
            return sendJson(response, { status: 200, body: {
                schemaVersion: 'intraday-monitor-postclose-recovery-response/1',
                ok: true, recovery, brokerWriteAuthority: false } });
        }
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
        else if (checked.route === 'daily_status') result = await service.readDailyStatus();
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
    const sessionRepository = new IntradayMonitorSessionStateRepository(appSupportRoot);
    const taipeiDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei',
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const runtimeGeneration = () => {
        try { return readFileSync(path.join(appSupportRoot, 'runtime-api-generation'), 'utf8').trim(); }
        catch { return null; }
    };
    const lateBootPrepared = (tradeDate, session) => {
        if (!session) return null;
        try {
            const receipt = JSON.parse(readFileSync(path.join(appSupportRoot,
                'IntradayMonitor', 'premarket', 'receipts',
                `${tradeDate}-late-boot-prepared.json`), 'utf8'));
            return receipt.schemaVersion === 'intraday-monitor-late-boot-catchup/1' &&
                receipt.tradeDate === tradeDate && receipt.source === 'late_boot' &&
                receipt.sessionId === session.sessionId &&
                receipt.sessionIdentityHash === session.sessionIdentityHash &&
                receipt.generation === session.connectionGeneration &&
                receipt.baselineHash?.replace(/^sha256:/, '') === session.baselineHash
                ? receipt : null;
        } catch { return null; }
    };
    const currentProjection = () => {
        const config = configRepository.read();
        const authorityTradeDate = taipeiDate();
        const session = sessionRepository.readSession(authorityTradeDate);
        const approval = sessionRepository.readApproval();
        const authority = session?.calendarAuthority?.tradeDate === authorityTradeDate
            ? session.calendarAuthority
            : { current: false, tradeDate: authorityTradeDate, previousTradeDate: null };
        const bundle = approval
            ? resolveIntradayMonitorRuntimeArtifactBundleSync({ appSupportRoot,
                bundleHash: approval.artifactBundleHash })
            : { valid: false, bundleHash: null };
        const evaluated = evaluateIntradayMonitorCurrentSession({ authority, session, approval,
            artifactBundle: bundle, savedConfigRevision: config.revision,
            apiGeneration: runtimeGeneration(),
            premarketCaptureFailure: readPremarketCaptureFailure(appSupportRoot, authorityTradeDate),
            nowEpochMs: Date.now() });
        const configuredItems = config.items.map((item) => ({
            canonicalSymbol: `${item.contract.code}.${item.contract.exchange === 'TSE' ? 'TW' : 'TWO'}`,
            enabled: item.enabled,
            eligible: item.enabled && /^(?!00)\d{4}$/.test(item.contract.code),
        }));
        const normalized = normalizeIntradayMonitorSessionItems({ configuredItems,
            sessionItems: session?.itemStates ?? [],
            approvedActiveLimit: approval?.approvedActiveLimit ?? 20,
            currentSession: evaluated });
        const firstKbarAt = evaluated.current
            ? session.itemStates.map((item) => item.firstKbarAt).filter(Boolean).sort()[0] ?? null
            : null;
        return { config, approval, session, evaluated, normalized, firstKbarAt,
            lateBoot: lateBootPrepared(authorityTradeDate, session), bundle };
    };
    const sessionController = Object.freeze({
        startIntradayDemands: () => {
            const current = currentProjection();
            return { allowed: current.evaluated.current,
                reason: current.evaluated.reason ?? 'current_session_ready',
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
        dailyStatusProvider: async () => {
            const saved = await readDynamicDailyActivePlan(appSupportRoot, taipeiDate());
            if (!saved) return {};
            const { plan, baselineGate } = saved;
            return { plan, expectedGeneration: runtimeGeneration(),
                coverage: { planHash: plan.planHash, tradeDate: plan.tradeDate,
                    previousTradeDate: plan.previousTradeDate,
                    baselineReadyCount: baselineGate.baselineReadyCount,
                    items: baselineGate.items.map((item) => ({
                        canonicalSymbol: item.canonicalSymbol, state: item.state,
                        reason: item.reason, manifestId: item.manifestId,
                        sourceHash: item.sourceHash })) } };
        },
        capacityProvider: () => {
            const current = currentProjection();
            const { approval, session, evaluated, normalized, lateBoot } = current;
            return { gate0EvidenceCurrent: evaluated.current, globalOwnershipComplete: false,
                boundedTransportReady: evaluated.current && normalized.capacity.dataActive === normalized.capacity.admitted,
                controlPlaneSubscriptionRequested: evaluated.current && session?.controlPlane?.requested === true,
                awaitingFirstKbar: normalized.capacity.awaitingFirstKbar,
                notificationAuthority: evaluated.notificationAuthority,
                approvedActiveLimit: approval?.approvedActiveLimit ?? 20,
                evaluationStageTarget: approval?.stage ?? null,
                evaluationState: approval?.decision ?? 'not_scheduled',
                dataActive: normalized.capacity.dataActive,
                active: normalized.capacity.active,
                waiting: normalized.capacity.waitingGate + normalized.capacity.waitingPilotLimit +
                    normalized.capacity.waitingCapacity + normalized.capacity.waitingBaseline +
                    normalized.capacity.awaitingFirstKbar + normalized.capacity.waitingContinuity,
                waitingGate: normalized.capacity.waitingGate,
                waitingPilotLimit: normalized.capacity.waitingPilotLimit,
                waitingCapacity: normalized.capacity.waitingCapacity,
                waitingBaseline: normalized.capacity.waitingBaseline,
                degraded: normalized.capacity.degraded,
                confirmedPhysicalUsage: null, confirmedOtherPhysicalUsage: null,
                providerReleaseProven: null, confirmedHeadroom: null,
                availableForMonitor: evaluated.current ? normalized.capacity.dataActive : 0,
                evidenceAt: evaluated.evidenceAt,
                reason: evaluated.reason ?? 'none',
                approval,
                session: { authorityTradeDate: evaluated.authorityTradeDate,
                    sessionTradeDate: evaluated.sessionTradeDate, phase: evaluated.phase,
                    current: evaluated.current, configRevision: evaluated.configRevision,
                    savedConfigRevision: evaluated.savedConfigRevision,
                    startedAt: session?.createdAt ?? null, updatedAt: session?.updatedAt ?? null,
                    staleReason: evaluated.reason,
                    controlPlaneRequested: session?.controlPlane?.requested === true,
                    controlPlaneAccepted: session?.controlPlane?.accepted === true,
                    firstKbarAt: current.firstKbarAt,
                    startupSource: lateBoot ? 'late_boot' : session ? 'scheduled' : 'unknown',
                    coldStartRisk: lateBoot !== null,
                    scheduled0820Success: lateBoot?.scheduled0820Success ?? null },
                baselineSummary: normalized.baselineSummary,
                freshness: { evidenceAt: evaluated.evidenceAt, ageMs: evaluated.ageMs,
                    budgetMs: evaluated.budgetMs, fresh: evaluated.fresh },
                items: normalized.items.map((item) => ({ ...item,
                    baselineState: item.baselineState,
                    baselineTradeDate: item.baselineTradeDate,
                    subscriptionState: item.subscriptionState })) };
        },
        diagnosticsProvider: () => {
            const current = currentProjection();
            const { session, evaluated, normalized } = current;
            const legacy = state();
            const minutes = evaluated.current && legacy?.tradeDate === session?.tradeDate
                ? legacy.items.map((item) => item.completedMinute).filter(Boolean).sort() : [];
            return { state: evaluated.current ? (normalized.capacity.degraded > 0 ? 'degraded' : 'active') : 'idle',
                reason: evaluated.reason ?? 'none',
                baseline: { complete: normalized.baselineSummary.complete === normalized.capacity.configured,
                    tradeDate: normalized.baselineSummary.tradeDates.length === 1
                        ? normalized.baselineSummary.tradeDates[0] : null,
                    sourceVersion: session?.baselineHash ? `daily-session/${session.baselineHash}` : null,
                    itemCount: normalized.baselineSummary.complete },
                completedMinute: { tradeDate: evaluated.current ? session.tradeDate : null,
                    minuteKey: minutes.at(-1) ?? null, evidenceAt: evaluated.evidenceAt } };
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
                postcloseRecoveryRoot: appSupportRoot,
            }));
            server.httpServer?.once('close', () => runtime.close());
        },
    };
}
