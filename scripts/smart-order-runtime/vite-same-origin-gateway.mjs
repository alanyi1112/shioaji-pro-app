import http from 'node:http';
import {
    createHash,
    randomBytes,
    randomUUID,
    timingSafeEqual,
} from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    SMART_ORDER_CONTROL_PLANE_MAX_BODY_BYTES,
    SMART_ORDER_CONTROL_PLANE_MUTATION_CONTENT_TYPE,
    createSmartOrderGatewayProof,
    sealSmartOrderControlPlaneMutation,
    verifySmartOrderControlPlaneResponseProof,
} from './control-plane-security.mjs';
import {
    DEFAULT_SMART_ORDER_BODY_DEADLINE_MS,
    createSmartOrderMutationAdmissionController,
    readSmartOrderBodyWithDeadline,
} from './control-plane-capacity.mjs';
import { isCanonicalSmartOrderDraft } from './canonical-strategy-draft.mjs';
import { createSmartOrderLoopbackPeerAttestor } from './loopback-peer-attestor.mjs';
import { canonicalManualStockBrokerWriteRequest } from './manual-broker-write-contract.mjs';
import { SMART_ORDER_STOCK_WRITE_ROUTES } from './manual-route-coverage.mjs';
import {
    assertLexicallyRepoExternalRoot,
    assertRepoExternalRoot,
} from './repo-external-root.mjs';

export const SMART_ORDER_VITE_GATEWAY_SCHEMA_VERSION =
    'smart-order-vite-same-origin-gateway/2026-08-20.1';
export const SMART_ORDER_VITE_GATEWAY_PREFIX = '/__smart-orders';
export const SMART_ORDER_BROWSER_CSRF_HEADER =
    'X-RealTimeStock-CSRF-Token';
export const SMART_ORDER_BROWSER_CSRF_ROUTE = '/v1/csrf-token';

const SIDECAR_DISCOVERY_SCHEMA_VERSION =
    'smart-order-local-sidecar/2026-08-11.1';
const LOOPBACK_HOST = '127.0.0.1';
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const CAPABILITY_BYTES = 32;
const MAX_DISCOVERY_BYTES = 1_024;
const MAX_RAW_HEADER_PAIRS = 64;
const MAX_REQUEST_URL_BYTES = 1_024;
const MAX_UPSTREAM_RESPONSE_BYTES = 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 5_000;
const MUTATION_GLOBAL_WINDOW_MS = 60_000;
const MUTATION_GLOBAL_RATE_LIMIT = 24;
const MUTATION_SESSION_RATE_LIMIT = 6;
const MUTATION_MAX_CONCURRENT = 4;
const MUTATION_MAX_CONCURRENT_PER_SESSION = 1;
const MUTATION_MAX_QUEUED = 8;
const MUTATION_MAX_QUEUED_PER_SESSION = 2;
const MUTATION_QUEUE_WAIT_MS = 750;
const CSRF_SESSION_COOKIE = 'rts_smart_order_session';
const CSRF_TOKEN_BYTES = 32;
const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DEFAULT_CSRF_TOKEN_TTL_MS = 2 * 60 * 1_000;
const DEFAULT_CSRF_SESSION_TTL_MS = 30 * 60 * 1_000;
const MAX_CSRF_SESSIONS = 256;
const MAX_CSRF_TOKENS_PER_SESSION = 8;
const SMART_ORDER_EVENT_SCHEMA_VERSION =
    'smart-order-event-projection/2026-08-11.1';
const SMART_ORDER_EVENT_MAX_ITEMS = 100;
const SMART_ORDER_EVENT_RETRY_MS = 1_000;
const RUNTIME_EPOCH_PATTERN = /^[A-Za-z0-9._:-]{1,240}$/;
const STRATEGY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const STOCK_WRITE_ROUTE_BY_ID = new Map(
    SMART_ORDER_STOCK_WRITE_ROUTES.map((route) => [route.routeId, route]),
);
const CANONICAL_STOCK_CONTRACT_PATTERN =
    /^(?:TSE|OTC):STK:[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const STRATEGY_KINDS = new Set([
    'quick',
    'good_till',
    'multi_condition',
    'parent_child',
    'stop_take',
    'trailing_exit',
    'scheduled_quantity',
]);
const RUNTIME_RISK_POLICY_EDITOR_SCHEMA_VERSION =
    'smart-order-runtime-risk-policy-editor/2026-08-14.1';
const RUNTIME_RISK_DIMENSIONS = Object.freeze([
    'quantityShares',
    'notionalMinorUnits',
    'cashMinorUnits',
    'positionShares',
    'orderCount',
]);
const KILL_SWITCH_NAMES = new Set([
    'pause_new_exposure',
    'pause_automation',
    'emergency_block_all_writes',
]);
const KILL_SWITCH_REASON_CODES = new Set([
    'automation_pause',
    'automation_pause_released',
    'emergency_after_linearization',
    'exposure_pause_released',
    'operator_emergency',
    'operator_pause',
    'operator_release',
]);

const REJECTED_PROXY_HEADERS = Object.freeze([
    'forwarded',
    'via',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-proto',
    'x-real-ip',
    'x-client-ip',
    'true-client-ip',
    'cf-connecting-ip',
    'cf-connecting-ipv6',
    'cf-ew-via',
    'cf-ray',
    'cdn-loop',
    'x-envoy-external-address',
    'x-original-forwarded-for',
    'x-original-host',
    'x-vercel-forwarded-for',
    'x-vercel-forwarded-host',
    'x-vercel-forwarded-proto',
]);

function deny(reason, statusCode = 403) {
    return Object.freeze({ allowed: false, reason, statusCode });
}

function ownerMatches(metadata) {
    return (
        typeof process.getuid !== 'function' || metadata.uid === process.getuid()
    );
}

function exactMode(metadata, expectedMode) {
    return (metadata.mode & 0o777) === expectedMode;
}

function isGatewayUrl(rawUrl) {
    return (
        rawUrl === SMART_ORDER_VITE_GATEWAY_PREFIX ||
        rawUrl.startsWith(`${SMART_ORDER_VITE_GATEWAY_PREFIX}/`) ||
        rawUrl.startsWith(`${SMART_ORDER_VITE_GATEWAY_PREFIX}?`) ||
        rawUrl.startsWith(`${SMART_ORDER_VITE_GATEWAY_PREFIX}#`)
    );
}

function normalizedRawHeaders(rawHeaders) {
    if (
        !Array.isArray(rawHeaders) ||
        rawHeaders.length % 2 !== 0 ||
        rawHeaders.length / 2 > MAX_RAW_HEADER_PAIRS
    ) {
        return null;
    }
    const result = new Map();
    for (let index = 0; index < rawHeaders.length; index += 2) {
        const rawName = rawHeaders[index];
        const rawValue = rawHeaders[index + 1];
        if (typeof rawName !== 'string' || typeof rawValue !== 'string') {
            return null;
        }
        const name = rawName.toLowerCase();
        if (
            !/^[a-z0-9-]{1,64}$/.test(name) ||
            result.has(name) ||
            rawValue.length > 2_048 ||
            /[\r\n\u0000]/.test(rawValue)
        ) {
            return null;
        }
        result.set(name, rawValue);
    }
    return result;
}

function classifySidecarRoute(method, pathname) {
    if (method === 'GET') {
        if (pathname === SMART_ORDER_BROWSER_CSRF_ROUTE) {
            return Object.freeze({
                routeId: 'csrf_token',
                pathname,
                mutation: false,
                eventStream: false,
                localOnly: true,
            });
        }
        if (pathname === '/v1/health') {
            return Object.freeze({
                routeId: 'health',
                pathname: '/health',
                mutation: false,
                eventStream: false,
            });
        }
        if (
            [
                '/v1/status',
                '/v1/readiness',
                '/v1/gate-status',
                '/v1/history',
                '/v1/risk/policy',
                '/v1/risk/kill-switch',
                '/v1/events',
                '/v1/strategies',
            ].includes(pathname)
        ) {
            return Object.freeze({
                routeId: pathname.slice('/v1/'.length),
                pathname,
                mutation: false,
                eventStream: pathname === '/v1/events',
            });
        }
        const match = pathname.match(
            /^\/v1\/strategies\/([^/]+)(?:\/(resolutions))?$/,
        );
        if (match && STRATEGY_ID_PATTERN.test(match[1])) {
            return Object.freeze({
                routeId:
                    match[2] === 'resolutions'
                        ? 'strategy_manual_resolution_list'
                        : 'strategy_get',
                pathname,
                mutation: false,
                eventStream: false,
            });
        }
        return null;
    }
    if (method === 'POST') {
        const tradingWriteMatch = pathname.match(
            /^\/v1\/trading-write\/(STK-(?:MAN|AUTO)-(?:PLACE|UPDATE|CANCEL)-[A-Z0-9-]+)$/,
        );
        if (tradingWriteMatch) {
            const brokerRoute = STOCK_WRITE_ROUTE_BY_ID.get(
                tradingWriteMatch[1],
            );
            if (
                !brokerRoute ||
                !['manual', 'automation'].includes(brokerRoute.family)
            ) {
                return null;
            }
            return Object.freeze({
                routeId: 'manual_broker_write_admission',
                brokerRouteId: brokerRoute.routeId,
                pathname,
                mutation: true,
                eventStream: false,
            });
        }
        if (pathname === '/v1/strategies') {
            return Object.freeze({
                routeId: 'strategy_create',
                pathname,
                mutation: true,
                eventStream: false,
            });
        }
        if (
            pathname === '/v1/protected-entry/confirmation-preview' ||
            pathname === '/v1/protected-entry/confirmation-accept'
        ) {
            return Object.freeze({
                routeId:
                    pathname === '/v1/protected-entry/confirmation-preview'
                        ? 'protected_entry_confirmation_preview'
                        : 'protected_entry_confirmation_accept',
                pathname,
                mutation: true,
                eventStream: false,
            });
        }
        const match = pathname.match(
            /^\/v1\/strategies\/([^/]+)\/(pause|resume|cancel|copy|cancel-broker-order|update-broker-order|confirmation-preview|confirmation-accept|drain-prepared|relinquish-protection-prepare|relinquish-protection-commit|resolve-final)$/,
        );
        if (match && STRATEGY_ID_PATTERN.test(match[1])) {
            return Object.freeze({
                routeId:
                    match[2] === 'cancel-broker-order'
                        ? 'broker_order_cancel_request'
                        : match[2] === 'update-broker-order'
                          ? 'broker_order_update_request'
                          : match[2] === 'confirmation-preview'
                            ? 'strategy_confirmation_preview'
                            : match[2] === 'confirmation-accept'
                              ? 'strategy_confirmation_accept'
                          : match[2] === 'drain-prepared'
                            ? 'strategy_prepared_intent_drain'
                            : match[2] === 'relinquish-protection-prepare'
                              ? 'strategy_protection_relinquish_prepare'
                              : match[2] === 'relinquish-protection-commit'
                                ? 'strategy_protection_relinquish_commit'
                                : match[2] === 'resolve-final'
                                  ? 'strategy_manual_resolution_apply_unique_final'
                        : `strategy_${match[2]}`,
                pathname,
                mutation: true,
                eventStream: false,
            });
        }
        return null;
    }
    if (method === 'PUT') {
        if (pathname === '/v1/risk/policy') {
            return Object.freeze({
                routeId: 'risk_policy_publish',
                pathname,
                mutation: true,
                eventStream: false,
            });
        }
        if (pathname === '/v1/risk/kill-switch') {
            return Object.freeze({
                routeId: 'risk_kill_switch',
                pathname,
                mutation: true,
                eventStream: false,
            });
        }
        const match = pathname.match(/^\/v1\/strategies\/([^/]+)$/);
        if (match && STRATEGY_ID_PATTERN.test(match[1])) {
            return Object.freeze({
                routeId: 'strategy_update_draft',
                pathname,
                mutation: true,
                eventStream: false,
            });
        }
    }
    return null;
}

function parseGatewayPath(rawUrl, method) {
    if (
        typeof rawUrl !== 'string' ||
        Buffer.byteLength(rawUrl) > MAX_REQUEST_URL_BYTES ||
        !rawUrl.startsWith(`${SMART_ORDER_VITE_GATEWAY_PREFIX}/`) ||
        rawUrl.includes('?') ||
        rawUrl.includes('#') ||
        rawUrl.includes('\\') ||
        rawUrl.includes('%') ||
        rawUrl.includes('//') ||
        /[^\x21-\x7e]/.test(rawUrl)
    ) {
        return null;
    }
    const pathname = rawUrl.slice(SMART_ORDER_VITE_GATEWAY_PREFIX.length);
    if (!pathname.startsWith('/v1/') && pathname !== '/v1/strategies') {
        return null;
    }
    return classifySidecarRoute(method, pathname);
}

function bodyHeaderDecision(route, headers) {
    if (headers.has('transfer-encoding') || headers.has('content-encoding')) {
        return deny('request_body_shape_invalid', 400);
    }
    const contentLength = headers.get('content-length');
    if (!route.mutation) {
        if (
            contentLength !== undefined ||
            headers.has('content-type') ||
            headers.has('expect')
        ) {
            return deny('body_not_allowed', 400);
        }
        return Object.freeze({ allowed: true, contentLength: 0 });
    }
    if (
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
            headers.get('content-type') ?? '',
        ) ||
        !/^\d{1,8}$/.test(contentLength ?? '')
    ) {
        return deny('json_content_length_required', 415);
    }
    const length = Number(contentLength);
    if (
        !Number.isSafeInteger(length) ||
        length < 1 ||
        length > SMART_ORDER_CONTROL_PLANE_MAX_BODY_BYTES
    ) {
        return deny(
            length > SMART_ORDER_CONTROL_PLANE_MAX_BODY_BYTES
                ? 'body_too_large'
                : 'json_body_required',
            length > SMART_ORDER_CONTROL_PLANE_MAX_BODY_BYTES ? 413 : 400,
        );
    }
    if (headers.has('expect')) {
        return deny('request_body_shape_invalid', 400);
    }
    return Object.freeze({ allowed: true, contentLength: length });
}

function isExactSameOriginReferer(value, expectedOrigin) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) {
        return false;
    }
    try {
        const parsed = new URL(value);
        return (
            parsed.origin === expectedOrigin &&
            parsed.username === '' &&
            parsed.password === '' &&
            parsed.protocol === 'http:' &&
            parsed.hostname === LOOPBACK_HOST &&
            parsed.hash === ''
        );
    } catch {
        return false;
    }
}

export function authorizeSmartOrderBrowserGatewayRequest(request) {
    const rawUrl = request?.url;
    if (typeof rawUrl !== 'string' || !isGatewayUrl(rawUrl)) {
        return Object.freeze({ handled: false });
    }
    const method = request?.method;
    const headers = normalizedRawHeaders(request?.rawHeaders);
    if (!headers || typeof method !== 'string') {
        return { handled: true, ...deny('invalid_headers', 400) };
    }
    const localPort = request?.socket?.localPort;
    if (
        request.socket?.remoteAddress !== LOOPBACK_HOST ||
        request.socket?.localAddress !== LOOPBACK_HOST ||
        !Number.isInteger(localPort) ||
        localPort < 1 ||
        localPort > 65_535
    ) {
        return {
            handled: true,
            ...deny('non_loopback_gateway_forbidden'),
        };
    }
    const expectedHost = `${LOOPBACK_HOST}:${localPort}`;
    const expectedOrigin = `http://${expectedHost}`;
    if (headers.get('host') !== expectedHost) {
        return { handled: true, ...deny('host_not_allowed') };
    }
    if (
        REJECTED_PROXY_HEADERS.some((header) => headers.has(header)) ||
        [...headers.keys()].some(
            (header) =>
                header.startsWith('x-forwarded-') ||
                (header.startsWith('x-realtimestock-') &&
                    header !== SMART_ORDER_BROWSER_CSRF_HEADER.toLowerCase()),
        )
    ) {
        return {
            handled: true,
            ...deny('forwarded_or_internal_header_forbidden'),
        };
    }
    if (
        headers.get('sec-fetch-site') !== 'same-origin' ||
        headers.get('sec-fetch-mode') !== 'cors' ||
        headers.get('sec-fetch-dest') !== 'empty' ||
        headers.has('sec-fetch-user')
    ) {
        return {
            handled: true,
            ...deny('origin_or_fetch_metadata_not_allowed'),
        };
    }
    let route = parseGatewayPath(rawUrl, method);
    if (!route) {
        return {
            handled: true,
            ...deny('route_or_method_not_allowed', 404),
        };
    }
    const browserOrigin = headers.get('origin');
    const browserReferer = headers.get('referer');
    const exactOrigin = browserOrigin === expectedOrigin;
    const exactReferer = isExactSameOriginReferer(
        browserReferer,
        expectedOrigin,
    );
    if (
        (browserOrigin !== undefined && !exactOrigin) ||
        (browserReferer !== undefined && !exactReferer) ||
        (route.mutation ? !exactOrigin : !exactOrigin && !exactReferer)
    ) {
        return {
            handled: true,
            ...deny('origin_or_fetch_metadata_not_allowed'),
        };
    }
    const bodyDecision = bodyHeaderDecision(route, headers);
    if (!bodyDecision.allowed) {
        return { handled: true, ...bodyDecision };
    }
    const csrfToken = headers.get(
        SMART_ORDER_BROWSER_CSRF_HEADER.toLowerCase(),
    );
    if (route.mutation && csrfToken === undefined) {
        return { handled: true, ...deny('csrf_token_required') };
    }
    if (route.mutation && !CSRF_TOKEN_PATTERN.test(csrfToken)) {
        return { handled: true, ...deny('csrf_token_invalid') };
    }
    const lastEventId = headers.get('last-event-id');
    if (route.eventStream) {
        if (
            headers.get('accept') !== 'text/event-stream' ||
            (lastEventId !== undefined &&
                (!/^(?:0|[1-9]\d{0,15})$/.test(lastEventId) ||
                    !Number.isSafeInteger(Number(lastEventId))))
        ) {
            return {
                handled: true,
                ...deny('event_cursor_or_accept_invalid', 400),
            };
        }
        const afterSequence =
            lastEventId === undefined ? null : Number(lastEventId);
        route = Object.freeze({
            ...route,
            afterSequence,
            pathname: `/v1/events/${afterSequence === null ? 'initial' : afterSequence}`,
        });
    } else if (lastEventId !== undefined) {
        return {
            handled: true,
            ...deny('event_cursor_not_allowed', 400),
        };
    }
    return Object.freeze({
        handled: true,
        allowed: true,
        expectedOrigin,
        route,
        contentLength: bodyDecision.contentLength,
        csrfToken,
        browserCookie: headers.get('cookie'),
    });
}

function defaultAppSupportRoot() {
    return (
        process.env.REALTIME_STOCK_APP_SUPPORT ??
        path.join(
            os.homedir(),
            'Library',
            'Application Support',
            'RealTimeStock',
        )
    );
}

function explicitPrivateRoot(value) {
    return assertLexicallyRepoExternalRoot(
        value,
        'smart-order appSupportRoot',
    );
}

async function assertPrivateDirectory(directoryPath) {
    const metadata = await lstat(directoryPath);
    if (
        metadata.isSymbolicLink() ||
        !metadata.isDirectory() ||
        !ownerMatches(metadata) ||
        !exactMode(metadata, PRIVATE_DIRECTORY_MODE)
    ) {
        throw new Error('smart-order private directory is unsafe');
    }
}

async function readPrivateSnapshot(filePath, expectedBytes) {
    const handle = await open(
        filePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
        const metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            !ownerMatches(metadata) ||
            !exactMode(metadata, PRIVATE_FILE_MODE) ||
            metadata.size < 1 ||
            metadata.size > expectedBytes
        ) {
            throw new Error('smart-order private file is unsafe');
        }
        const bytes = Buffer.alloc(metadata.size);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        if (bytesRead !== bytes.length) {
            bytes.fill(0);
            throw new Error('smart-order private file changed while reading');
        }
        const current = await lstat(filePath);
        if (
            current.isSymbolicLink() ||
            current.dev !== metadata.dev ||
            current.ino !== metadata.ino ||
            current.size !== metadata.size ||
            current.mtimeMs !== metadata.mtimeMs
        ) {
            bytes.fill(0);
            throw new Error('smart-order private file identity changed');
        }
        return bytes;
    } finally {
        await handle.close();
    }
}

function strictDiscovery(bytes, nowEpochMs) {
    let discovery;
    try {
        const text = bytes.toString('utf8');
        if (!text.endsWith('\n') || text.includes('\u0000')) {
            throw new Error('invalid discovery encoding');
        }
        discovery = JSON.parse(text);
    } finally {
        bytes.fill(0);
    }
    if (
        !discovery ||
        typeof discovery !== 'object' ||
        Array.isArray(discovery) ||
        JSON.stringify(Object.keys(discovery).sort()) !==
            JSON.stringify(
                [
                    'host',
                    'port',
                    'runtimeEpochId',
                    'schemaVersion',
                    'startedAtEpochMs',
                ].sort(),
            ) ||
        discovery.schemaVersion !== SIDECAR_DISCOVERY_SCHEMA_VERSION ||
        discovery.host !== LOOPBACK_HOST ||
        !Number.isInteger(discovery.port) ||
        discovery.port < 1 ||
        discovery.port > 65_535 ||
        !RUNTIME_EPOCH_PATTERN.test(discovery.runtimeEpochId ?? '') ||
        !Number.isSafeInteger(discovery.startedAtEpochMs) ||
        discovery.startedAtEpochMs < 0 ||
        discovery.startedAtEpochMs > nowEpochMs + 30_000
    ) {
        throw new Error('smart-order runtime discovery is invalid');
    }
    return Object.freeze({ ...discovery });
}

export async function readSmartOrderGatewayAuthority({
    appSupportRoot,
    nowEpochMs = Date.now(),
}) {
    if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
        throw new TypeError('gateway authority time is invalid');
    }
    const requestedRoot = await assertRepoExternalRoot(
        appSupportRoot ?? defaultAppSupportRoot(),
        'smart-order appSupportRoot',
    );
    const root = await realpath(requestedRoot);
    if (!path.isAbsolute(root) || root === path.parse(root).root) {
        throw new Error('smart-order private root is unsafe');
    }
    const smartOrderRoot = path.join(root, 'smart-order');
    const privateDirectory = path.join(smartOrderRoot, 'private');
    const runDirectory = path.join(smartOrderRoot, 'run');
    for (const directory of [root, smartOrderRoot, privateDirectory, runDirectory]) {
        await assertPrivateDirectory(directory);
    }
    const discovery = strictDiscovery(
        await readPrivateSnapshot(
            path.join(runDirectory, 'control-plane.json'),
            MAX_DISCOVERY_BYTES,
        ),
        nowEpochMs,
    );
    const capability = await readPrivateSnapshot(
        path.join(privateDirectory, 'gateway-capability.bin'),
        CAPABILITY_BYTES,
    );
    if (capability.byteLength !== CAPABILITY_BYTES) {
        capability.fill(0);
        throw new Error('smart-order gateway capability is invalid');
    }
    return Object.freeze({ discovery, capability });
}

function parseSafeJsonObjectBody(body) {
    let root;
    try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
        root = JSON.parse(text);
    } catch {
        return null;
    }
    if (!root || typeof root !== 'object' || Array.isArray(root)) return null;
    const pending = [{ value: root, depth: 0 }];
    let visited = 0;
    while (pending.length > 0) {
        const current = pending.pop();
        visited += 1;
        if (visited > 2_048 || current.depth > 32) return null;
        const value = current.value;
        if (!value || typeof value !== 'object') continue;
        for (const [key, child] of Object.entries(value)) {
            if (
                key.length === 0 ||
                key.length > 128 ||
                /[\u0000-\u001f\u007f]/.test(key) ||
                ['__proto__', 'prototype', 'constructor'].includes(key)
            ) {
                return null;
            }
            if (child && typeof child === 'object') {
                pending.push({ value: child, depth: current.depth + 1 });
            }
        }
    }
    return root;
}

function hasExactKeys(value, required, optional = []) {
    const allowed = new Set([...required, ...optional]);
    const keys = Object.keys(value);
    return (
        required.every((key) => Object.hasOwn(value, key)) &&
        keys.every((key) => allowed.has(key)) &&
        keys.length >= required.length
    );
}

function validOperationId(value) {
    return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

function validExpectedRevision(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function validNonNegativeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function validRuntimeRiskPolicyEditor(value) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !hasExactKeys(value, [
            'accountDailyLossLimitMinorUnits',
            'accountLimits',
            'buyFeeBps',
            'cashBufferMinorUnits',
            'identityDailyLossLimitMinorUnits',
            'identityLimits',
            'minimumBuyFeeMinorUnits',
            'schemaVersion',
        ]) ||
        value.schemaVersion !== RUNTIME_RISK_POLICY_EDITOR_SCHEMA_VERSION ||
        !validNonNegativeInteger(value.buyFeeBps) ||
        value.buyFeeBps > 10_000 ||
        !validNonNegativeInteger(value.minimumBuyFeeMinorUnits) ||
        !validNonNegativeInteger(value.cashBufferMinorUnits) ||
        !validNonNegativeInteger(value.accountDailyLossLimitMinorUnits) ||
        !validNonNegativeInteger(value.identityDailyLossLimitMinorUnits)
    ) {
        return false;
    }
    for (const limits of [value.accountLimits, value.identityLimits]) {
        if (
            !limits ||
            typeof limits !== 'object' ||
            Array.isArray(limits) ||
            !hasExactKeys(limits, RUNTIME_RISK_DIMENSIONS) ||
            RUNTIME_RISK_DIMENSIONS.some(
                (dimension) =>
                    limits[dimension] !== null &&
                    !validNonNegativeInteger(limits[dimension]),
            )
        ) {
            return false;
        }
    }
    const enabled = RUNTIME_RISK_DIMENSIONS.filter((dimension) => {
        const accountEnabled = value.accountLimits[dimension] !== null;
        return (
            accountEnabled && value.identityLimits[dimension] !== null
        );
    });
    return (
        enabled.length > 0 &&
        RUNTIME_RISK_DIMENSIONS.every(
            (dimension) =>
                (value.accountLimits[dimension] !== null) ===
                (value.identityLimits[dimension] !== null),
        )
    );
}

function validProtectedEntryConfirmationRequest(value) {
    const token = (candidate) =>
        typeof candidate === 'string' &&
        candidate.length >= 1 &&
        candidate.length <= 240 &&
        candidate.trim() === candidate &&
        !/[\u0000-\u001f\u007f]/.test(candidate);
    const decimal = (candidate) => {
        if (
            typeof candidate !== 'string' ||
            !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(candidate) ||
            candidate === '0' ||
            candidate.length > 80
        ) {
            return false;
        }
        const fractionalDigits = candidate.split('.')[1] ?? '';
        return !(
            fractionalDigits.length > 0 &&
            fractionalDigits.endsWith('0')
        );
    };
    const execution = (candidate) =>
        candidate &&
        typeof candidate === 'object' &&
        !Array.isArray(candidate) &&
        hasExactKeys(candidate, ['limitPrice', 'priceType', 'timeInForce']) &&
        (((candidate.priceType === 'LMT' &&
            (candidate.timeInForce === 'ROD' ||
                candidate.timeInForce === 'IOC')) &&
            decimal(candidate.limitPrice)) ||
            (candidate.priceType === 'MKT' &&
                candidate.timeInForce === 'IOC' &&
                candidate.limitPrice === null));
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !hasExactKeys(value, [
            'accountBrokerRef',
            'accountIdRef',
            'commonLots',
            'contractKey',
            'entryOrder',
            'protection',
            'schemaVersion',
        ]) ||
        value.schemaVersion !==
            'smart-order-protected-entry-confirmation-request/2026-08-20.1' ||
        !token(value.accountBrokerRef) ||
        !token(value.accountIdRef) ||
        !/^(?:TSE|OTC):STK:[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(
            value.contractKey,
        ) ||
        !Number.isSafeInteger(value.commonLots) ||
        value.commonLots < 1 ||
        !execution(value.entryOrder) ||
        !value.protection ||
        typeof value.protection !== 'object' ||
        Array.isArray(value.protection) ||
        !hasExactKeys(value.protection, ['family', 'legs']) ||
        !['fixed', 'trailing'].includes(value.protection.family) ||
        !Array.isArray(value.protection.legs) ||
        value.protection.legs.length < 1 ||
        value.protection.legs.length > 3
    ) {
        return false;
    }
    return value.protection.legs.every((leg) => {
        if (
            !leg ||
            typeof leg !== 'object' ||
            Array.isArray(leg) ||
            !hasExactKeys(leg, [
                'comparator',
                'distance',
                'execution',
                'legId',
                'type',
            ]) ||
            !['lte', 'gte'].includes(leg.comparator) ||
            !token(leg.legId) ||
            ![
                'stop',
                'take',
                'trailing_activation',
                'trailing_retracement',
                'fixed_stop',
            ].includes(leg.type) ||
            !execution(leg.execution)
        ) {
            return false;
        }
        const distance = leg.distance;
        if (!distance || typeof distance !== 'object' || Array.isArray(distance)) {
            return false;
        }
        return (
            (hasExactKeys(distance, ['kind', 'value']) &&
                distance.kind === 'absolute' &&
                decimal(distance.value)) ||
            (hasExactKeys(distance, ['kind', 'pctBps']) &&
                distance.kind === 'pct_bps' &&
                Number.isSafeInteger(distance.pctBps) &&
                distance.pctBps >= 1 &&
                distance.pctBps <= 9_999) ||
            (hasExactKeys(distance, ['kind', 'multiplier']) &&
                distance.kind === 'fixed_atr' &&
                decimal(distance.multiplier))
        );
    });
}

function browserMutationBodyMatchesRoute(route, body) {
    if (route.routeId === 'manual_broker_write_admission') {
        if (!hasExactKeys(body, ['operationId', 'request'])) return false;
        if (!validOperationId(body.operationId)) return false;
        const brokerRoute = STOCK_WRITE_ROUTE_BY_ID.get(route.brokerRouteId);
        try {
            const canonical = canonicalManualStockBrokerWriteRequest(
                body.request,
            );
            return (
                (brokerRoute.operation === 'update'
                    ? ['update_price', 'update_quantity'].includes(
                          canonical.request.operation,
                      )
                    : brokerRoute.operation === canonical.request.operation)
            );
        } catch {
            return false;
        }
    }
    if (route.routeId === 'risk_policy_publish') {
        return (
            hasExactKeys(body, [
                'expectedRevision',
                'operationId',
                'policy',
            ]) &&
            (body.expectedRevision === null ||
                validExpectedRevision(body.expectedRevision)) &&
            validOperationId(body.operationId) &&
            validRuntimeRiskPolicyEditor(body.policy)
        );
    }
    if (route.routeId === 'risk_kill_switch') {
        return (
            hasExactKeys(body, [
                'enabled',
                'expectedArbiterRevision',
                'operationId',
                'reasonCode',
                'switchName',
            ]) &&
            typeof body.enabled === 'boolean' &&
            validExpectedRevision(body.expectedArbiterRevision) &&
            validOperationId(body.operationId) &&
            KILL_SWITCH_REASON_CODES.has(body.reasonCode) &&
            KILL_SWITCH_NAMES.has(body.switchName)
        );
    }
    if (route.routeId === 'strategy_create') {
        return (
            hasExactKeys(
                body,
                ['operationId', 'strategyKind'],
                ['workspaceContractKey'],
            ) &&
            validOperationId(body.operationId) &&
            STRATEGY_KINDS.has(body.strategyKind) &&
            (body.workspaceContractKey === undefined ||
                (typeof body.workspaceContractKey === 'string' &&
                    CANONICAL_STOCK_CONTRACT_PATTERN.test(
                        body.workspaceContractKey,
                    )))
        );
    }
    if (
        [
            'strategy_pause',
            'strategy_cancel',
            'strategy_copy',
        ].includes(route.routeId)
    ) {
        return (
            hasExactKeys(body, ['expectedRevision', 'operationId']) &&
            validExpectedRevision(body.expectedRevision) &&
            validOperationId(body.operationId)
        );
    }
    if (route.routeId === 'strategy_resume') {
        return (
            hasExactKeys(body, [
                'activationPolicyAcknowledged',
                'expectedRevision',
                'operationId',
            ]) &&
            body.activationPolicyAcknowledged === true &&
            validExpectedRevision(body.expectedRevision) &&
            validOperationId(body.operationId)
        );
    }
    if (route.routeId === 'broker_order_cancel_request') {
        return (
            hasExactKeys(body, [
                'expectedRevision',
                'operationId',
                'userConfirmationAcknowledged',
            ]) &&
            body.userConfirmationAcknowledged === true &&
            validExpectedRevision(body.expectedRevision) &&
            validOperationId(body.operationId)
        );
    }
    if (route.routeId === 'broker_order_update_request') {
        return (
            hasExactKeys(body, [
                'expectedRevision',
                'operationId',
                'quantityShares',
                'userConfirmationAcknowledged',
            ]) &&
            body.userConfirmationAcknowledged === true &&
            validExpectedRevision(body.expectedRevision) &&
            Number.isSafeInteger(body.quantityShares) &&
            body.quantityShares > 0 &&
            validOperationId(body.operationId)
        );
    }
    if (
        route.routeId === 'strategy_confirmation_preview' ||
        route.routeId === 'strategy_confirmation_accept'
    ) {
        const isAccept = route.routeId === 'strategy_confirmation_accept';
        const required = [
            'accountBrokerRef',
            'accountIdRef',
            'basisSelection',
            'confirmationId',
            'expectedRevision',
            'operationId',
            ...(isAccept ? ['snapshotHash', 'userAcknowledged'] : []),
        ];
        const basis = body?.basisSelection;
        const basisValid =
            basis === null ||
            (hasExactKeys(basis, ['source']) &&
                basis.source === 'broker_average_cost') ||
            (hasExactKeys(basis, ['priceDecimal', 'source']) &&
                basis.source === 'user_specified' &&
                typeof basis.priceDecimal === 'string' &&
                /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(
                    basis.priceDecimal,
                ));
        const boundedAccountRef = (value) =>
            typeof value === 'string' &&
            value.length >= 1 &&
            value.length <= 128 &&
            value.trim() === value &&
            !/[\u0000-\u001f\u007f]/.test(value);
        return (
            hasExactKeys(body, required) &&
            boundedAccountRef(body.accountBrokerRef) &&
            boundedAccountRef(body.accountIdRef) &&
            basisValid &&
            validOperationId(body.confirmationId) &&
            validExpectedRevision(body.expectedRevision) &&
            validOperationId(body.operationId) &&
            (!isAccept ||
                (body.userAcknowledged === true &&
                    typeof body.snapshotHash === 'string' &&
                    SHA256_PATTERN.test(body.snapshotHash)))
        );
    }
    if (
        route.routeId === 'protected_entry_confirmation_preview' ||
        route.routeId === 'protected_entry_confirmation_accept'
    ) {
        const isAccept =
            route.routeId === 'protected_entry_confirmation_accept';
        return (
            hasExactKeys(body, [
                'confirmationId',
                'confirmationRequest',
                'operationId',
                ...(isAccept ? ['snapshotHash', 'userAcknowledged'] : []),
            ]) &&
            validOperationId(body.confirmationId) &&
            validOperationId(body.operationId) &&
            validProtectedEntryConfirmationRequest(body.confirmationRequest) &&
            (!isAccept
                ? body.confirmationId === body.operationId
                : body.confirmationId !== body.operationId &&
                  body.userAcknowledged === true &&
                  typeof body.snapshotHash === 'string' &&
                  SHA256_PATTERN.test(body.snapshotHash))
        );
    }
    if (route.routeId === 'strategy_prepared_intent_drain') {
        return (
            hasExactKeys(body, [
                'expectedRevision',
                'operationId',
                'userConfirmationAcknowledged',
            ]) &&
            body.userConfirmationAcknowledged === true &&
            validExpectedRevision(body.expectedRevision) &&
            validOperationId(body.operationId)
        );
    }
    if (route.routeId === 'strategy_protection_relinquish_prepare') {
        return (
            hasExactKeys(body, [
                'expectedRevision',
                'operationId',
                'operatorAcknowledgedManualHandoff',
            ]) &&
            body.operatorAcknowledgedManualHandoff === true &&
            validExpectedRevision(body.expectedRevision) &&
            validOperationId(body.operationId)
        );
    }
    if (route.routeId === 'strategy_protection_relinquish_commit') {
        return (
            hasExactKeys(body, [
                'challengeId',
                'expectedRevision',
                'operationId',
                'operatorAcknowledgedManualHandoff',
            ]) &&
            body.operatorAcknowledgedManualHandoff === true &&
            validExpectedRevision(body.expectedRevision) &&
            validOperationId(body.challengeId) &&
            validOperationId(body.operationId) &&
            body.challengeId !== body.operationId
        );
    }
    if (
        route.routeId ===
        'strategy_manual_resolution_apply_unique_final'
    ) {
        return (
            hasExactKeys(body, [
                'expectedRevision',
                'operationId',
                'resolutionKey',
                'userAcknowledgedFinalEvidence',
            ]) &&
            body.userAcknowledgedFinalEvidence === true &&
            validExpectedRevision(body.expectedRevision) &&
            validOperationId(body.operationId) &&
            typeof body.resolutionKey === 'string' &&
            SHA256_PATTERN.test(body.resolutionKey)
        );
    }
    if (route.routeId === 'strategy_update_draft') {
        return (
            hasExactKeys(body, [
                'draft',
                'expectedRevision',
                'operationId',
            ]) &&
            isCanonicalSmartOrderDraft(body.draft) &&
            validExpectedRevision(body.expectedRevision) &&
            validOperationId(body.operationId)
        );
    }
    return false;
}

function csrfDigest(value) {
    return createHash('sha256').update(value, 'utf8').digest();
}

function parseCsrfSessionCookie(rawCookie) {
    if (
        typeof rawCookie !== 'string' ||
        rawCookie.length === 0 ||
        rawCookie.length > 4_096 ||
        /[\r\n\u0000]/.test(rawCookie)
    ) {
        return null;
    }
    let result = null;
    for (const part of rawCookie.split(';')) {
        const separator = part.indexOf('=');
        if (separator < 1) continue;
        const name = part.slice(0, separator).trim();
        if (name !== CSRF_SESSION_COOKIE) continue;
        const value = part.slice(separator + 1).trim();
        if (result !== null || !CSRF_TOKEN_PATTERN.test(value)) return null;
        result = value;
    }
    return result;
}

function createCsrfSessionStore({
    now,
    tokenTtlMs,
    sessionTtlMs,
}) {
    if (
        !Number.isSafeInteger(tokenTtlMs) ||
        tokenTtlMs < 1_000 ||
        tokenTtlMs > 10 * 60 * 1_000 ||
        !Number.isSafeInteger(sessionTtlMs) ||
        sessionTtlMs < tokenTtlMs ||
        sessionTtlMs > 24 * 60 * 60 * 1_000
    ) {
        throw new TypeError('smart-order CSRF lifetime configuration is invalid');
    }
    const sessions = new Map();

    const currentTime = () => {
        const value = now();
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new TypeError('smart-order CSRF clock is invalid');
        }
        return value;
    };
    const prune = (nowEpochMs) => {
        for (const [sessionId, session] of sessions) {
            if (session.expiresAtEpochMs <= nowEpochMs) {
                sessions.delete(sessionId);
                continue;
            }
            session.tokens = session.tokens.filter(
                (token) => token.expiresAtEpochMs > nowEpochMs,
            );
        }
    };
    const allocateSession = (nowEpochMs) => {
        while (sessions.size >= MAX_CSRF_SESSIONS) {
            sessions.delete(sessions.keys().next().value);
        }
        const sessionId = randomBytes(CSRF_TOKEN_BYTES).toString('base64url');
        const session = {
            expiresAtEpochMs: nowEpochMs + sessionTtlMs,
            tokens: [],
        };
        sessions.set(sessionId, session);
        return { sessionId, session };
    };

    return Object.freeze({
        issue(rawCookie) {
            const nowEpochMs = currentTime();
            prune(nowEpochMs);
            const requestedSessionId = parseCsrfSessionCookie(rawCookie);
            let sessionId = requestedSessionId;
            let session =
                requestedSessionId === null
                    ? undefined
                    : sessions.get(requestedSessionId);
            if (!session) {
                ({ sessionId, session } = allocateSession(nowEpochMs));
            } else {
                session.expiresAtEpochMs = nowEpochMs + sessionTtlMs;
                sessions.delete(sessionId);
                sessions.set(sessionId, session);
            }
            const csrfToken = randomBytes(CSRF_TOKEN_BYTES).toString(
                'base64url',
            );
            const expiresAtEpochMs = nowEpochMs + tokenTtlMs;
            session.tokens.push({
                digest: csrfDigest(csrfToken),
                expiresAtEpochMs,
            });
            if (session.tokens.length > MAX_CSRF_TOKENS_PER_SESSION) {
                session.tokens.splice(
                    0,
                    session.tokens.length - MAX_CSRF_TOKENS_PER_SESSION,
                );
            }
            return Object.freeze({
                sessionId,
                csrfToken,
                expiresAtEpochMs,
                sessionMaxAgeSeconds: Math.max(
                    1,
                    Math.floor(sessionTtlMs / 1_000),
                ),
            });
        },
        consume(rawCookie, csrfToken) {
            const nowEpochMs = currentTime();
            prune(nowEpochMs);
            const sessionId = parseCsrfSessionCookie(rawCookie);
            const session = sessionId === null ? undefined : sessions.get(sessionId);
            if (!session || !CSRF_TOKEN_PATTERN.test(csrfToken ?? '')) {
                return null;
            }
            const candidateDigest = csrfDigest(csrfToken);
            const index = session.tokens.findIndex(
                (candidate) =>
                    candidate.digest.byteLength === candidateDigest.byteLength &&
                    timingSafeEqual(candidate.digest, candidateDigest),
            );
            candidateDigest.fill(0);
            if (index < 0) return null;
            session.tokens.splice(index, 1);
            return sessionId;
        },
    });
}

function proxyToSidecar({
    discovery,
    capability,
    proof,
    envelopeNonce,
    origin,
    route,
    method,
    body,
}) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let deadline;
        const safeResolve = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);
            resolve(value);
        };
        const safeReject = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);
            reject(error);
        };
        const headers = {
            Host: `${LOOPBACK_HOST}:${discovery.port}`,
            Origin: origin,
            'Sec-Fetch-Site': 'same-origin',
            'X-RealTimeStock-Request-Id': proof.requestId,
            'X-RealTimeStock-Runtime-Epoch': proof.runtimeEpochId,
            'X-RealTimeStock-Gateway-Timestamp': String(
                proof.timestampEpochMs,
            ),
            'X-RealTimeStock-Gateway-Proof': proof.proof,
            Accept: route.eventStream
                ? 'text/event-stream'
                : 'application/json',
            Connection: 'close',
        };
        if (route.mutation) {
            headers['Content-Type'] =
                SMART_ORDER_CONTROL_PLANE_MUTATION_CONTENT_TYPE;
            headers['Content-Length'] = String(body.byteLength);
            headers['X-RealTimeStock-Envelope-Nonce'] = envelopeNonce;
        }
        const outgoing = http.request(
            {
                host: LOOPBACK_HOST,
                port: discovery.port,
                method,
                path: route.pathname,
                headers,
                agent: false,
                timeout: UPSTREAM_TIMEOUT_MS,
                family: 4,
            },
            (upstream) => {
                const chunks = [];
                let total = 0;
                upstream.on('data', (chunk) => {
                    const bytes = Buffer.isBuffer(chunk)
                        ? chunk
                        : Buffer.from(chunk);
                    total += bytes.byteLength;
                    if (total > MAX_UPSTREAM_RESPONSE_BYTES) {
                        upstream.destroy(
                            Object.assign(new Error('upstream too large'), {
                                code: 'UPSTREAM_INVALID',
                            }),
                        );
                        return;
                    }
                    chunks.push(bytes);
                });
                upstream.once('error', safeReject);
                upstream.once('end', () => {
                    const contentType = upstream.headers['content-type'];
                    const responseBody = Buffer.concat(chunks, total);
                    const responseRequestId =
                        upstream.headers[
                            'x-realtimestock-response-request-id'
                        ];
                    const responseRuntimeEpoch =
                        upstream.headers['x-realtimestock-runtime-epoch'];
                    const responseBodySha256 =
                        upstream.headers[
                            'x-realtimestock-response-body-sha256'
                        ];
                    const responseProof =
                        upstream.headers['x-realtimestock-response-proof'];
                    if (
                        typeof contentType !== 'string' ||
                        !/^(?:application\/json|text\/event-stream)(?:\s*;|$)/i.test(
                            contentType,
                        ) ||
                        !Number.isInteger(upstream.statusCode) ||
                        upstream.statusCode < 200 ||
                        upstream.statusCode > 599 ||
                        (upstream.statusCode >= 300 &&
                            upstream.statusCode < 400) ||
                        responseRequestId !== proof.requestId ||
                        responseRuntimeEpoch !== discovery.runtimeEpochId ||
                        !verifySmartOrderControlPlaneResponseProof({
                            capability,
                            runtimeEpochId: discovery.runtimeEpochId,
                            sidecarAuthority: `${LOOPBACK_HOST}:${discovery.port}`,
                            requestId: proof.requestId,
                            method,
                            pathname: route.pathname,
                            requestBodySha256: proof.bodySha256,
                            statusCode: upstream.statusCode,
                            contentType,
                            bodyBytes: responseBody,
                            proof: responseProof,
                            bodySha256: responseBodySha256,
                        })
                    ) {
                        safeReject(
                            Object.assign(new Error('invalid upstream response'), {
                                code: 'UPSTREAM_INVALID',
                            }),
                        );
                        return;
                    }
                    safeResolve({
                        statusCode: upstream.statusCode,
                        contentType,
                        body: responseBody,
                    });
                });
            },
        );
        outgoing.once('timeout', () =>
            outgoing.destroy(
                Object.assign(new Error('upstream timeout'), {
                    code: 'UPSTREAM_UNAVAILABLE',
                }),
            ),
        );
        outgoing.once('error', safeReject);
        deadline = setTimeout(
            () =>
                outgoing.destroy(
                    Object.assign(new Error('upstream total timeout'), {
                        code: 'UPSTREAM_UNAVAILABLE',
                    }),
                ),
            UPSTREAM_TIMEOUT_MS,
        );
        deadline.unref?.();
        if (body.byteLength > 0) outgoing.write(body);
        outgoing.end();
    });
}

function jsonResponse(response, statusCode, code, extra = {}) {
    if (response.headersSent) {
        response.destroy();
        return;
    }
    const serialized = `${JSON.stringify({ code, ...extra })}\n`;
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Length', Buffer.byteLength(serialized));
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Connection', 'close');
    response.end(serialized);
}

function csrfTokenResponse(response, issuance) {
    if (response.headersSent) {
        response.destroy();
        return;
    }
    const serialized = `${JSON.stringify({
        schemaVersion: 'smart-order-browser-csrf/2026-08-11.1',
        csrfToken: issuance.csrfToken,
        expiresAtEpochMs: issuance.expiresAtEpochMs,
        sessionBound: true,
        singleUse: true,
    })}\n`;
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Length', Buffer.byteLength(serialized));
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'none'");
    response.setHeader(
        'Set-Cookie',
        `${CSRF_SESSION_COOKIE}=${issuance.sessionId}; Path=${SMART_ORDER_VITE_GATEWAY_PREFIX}; HttpOnly; SameSite=Strict; Max-Age=${issuance.sessionMaxAgeSeconds}`,
    );
    response.setHeader('Connection', 'close');
    response.end(serialized);
}

function forwardResponse(response, upstream) {
    response.statusCode = upstream.statusCode;
    response.setHeader('Content-Type', upstream.contentType);
    response.setHeader('Content-Length', upstream.body.byteLength);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.end(upstream.body);
}

function safeEventSnapshot(body) {
    const root = parseSafeJsonObjectBody(body);
    if (
        !root ||
        !hasExactKeys(root, [
            'accountIdentifiersExposed',
            'cursorStatus',
            'entityIdentifiersExposed',
            'events',
            'fromSequence',
            'highWaterSequence',
            'journalPayloadExposed',
            'nextSequence',
            'schemaVersion',
        ]) ||
        root.schemaVersion !== SMART_ORDER_EVENT_SCHEMA_VERSION ||
        !['initialized', 'current', 'gap'].includes(root.cursorStatus) ||
        !Number.isSafeInteger(root.nextSequence) ||
        root.nextSequence < 0 ||
        !Number.isSafeInteger(root.highWaterSequence) ||
        root.highWaterSequence < root.nextSequence ||
        root.accountIdentifiersExposed !== false ||
        root.entityIdentifiersExposed !== false ||
        root.journalPayloadExposed !== false ||
        !Array.isArray(root.events) ||
        root.events.length > SMART_ORDER_EVENT_MAX_ITEMS ||
        (root.cursorStatus !== 'current' && root.events.length !== 0)
    ) {
        throw Object.assign(new Error('event snapshot is invalid'), {
            code: 'UPSTREAM_INVALID',
        });
    }
    let previous = root.fromSequence;
    if (
        previous !== null &&
        (!Number.isSafeInteger(previous) || previous < 0)
    ) {
        throw Object.assign(new Error('event cursor is invalid'), {
            code: 'UPSTREAM_INVALID',
        });
    }
    const events = root.events.map((event) => {
        if (
            !event ||
            typeof event !== 'object' ||
            Array.isArray(event) ||
            !hasExactKeys(event, [
                'brokerEpochMs',
                'entityKind',
                'exchangeEpochMs',
                'reasonCode',
                'receiveEpochMs',
                'revision',
                'sequence',
                'summaryCode',
            ]) ||
            !Number.isSafeInteger(event.sequence) ||
            event.sequence < 1 ||
            (previous !== null && event.sequence !== previous + 1) ||
            typeof event.entityKind !== 'string' ||
            event.entityKind.length < 1 ||
            event.entityKind.length > 64 ||
            typeof event.reasonCode !== 'string' ||
            event.reasonCode.length < 1 ||
            event.reasonCode.length > 160 ||
            typeof event.summaryCode !== 'string' ||
            event.summaryCode.length < 1 ||
            event.summaryCode.length > 160 ||
            !Number.isSafeInteger(event.revision) ||
            event.revision < 0 ||
            !Number.isSafeInteger(event.receiveEpochMs) ||
            event.receiveEpochMs < 0 ||
            (event.exchangeEpochMs !== null &&
                (!Number.isSafeInteger(event.exchangeEpochMs) ||
                    event.exchangeEpochMs < 0 ||
                    event.exchangeEpochMs > event.receiveEpochMs)) ||
            (event.brokerEpochMs !== null &&
                (!Number.isSafeInteger(event.brokerEpochMs) ||
                    event.brokerEpochMs < 0 ||
                    event.brokerEpochMs > event.receiveEpochMs))
        ) {
            throw Object.assign(new Error('event item is invalid'), {
                code: 'UPSTREAM_INVALID',
            });
        }
        previous = event.sequence;
        return Object.freeze({
            sequence: event.sequence,
            entityKind: event.entityKind,
            reasonCode: event.reasonCode,
            revision: event.revision,
            summaryCode: event.summaryCode,
            exchangeEpochMs: event.exchangeEpochMs,
            brokerEpochMs: event.brokerEpochMs,
            receiveEpochMs: event.receiveEpochMs,
        });
    });
    if (
        root.cursorStatus === 'current' &&
        root.nextSequence !== (events.at(-1)?.sequence ?? root.fromSequence)
    ) {
        throw Object.assign(new Error('event next cursor is invalid'), {
            code: 'UPSTREAM_INVALID',
        });
    }
    return Object.freeze({
        schemaVersion: root.schemaVersion,
        cursorStatus: root.cursorStatus,
        fromSequence: root.fromSequence,
        nextSequence: root.nextSequence,
        highWaterSequence: root.highWaterSequence,
        events: Object.freeze(events),
    });
}

function eventStreamBytes(snapshot) {
    const frames = [`retry: ${SMART_ORDER_EVENT_RETRY_MS}\n\n`];
    if (snapshot.events.length > 0) {
        for (const event of snapshot.events) {
            frames.push(
                `id: ${event.sequence}\n` +
                    'event: smart-order\n' +
                    `data: ${JSON.stringify(event)}\n\n`,
            );
        }
    } else {
        const eventName =
            snapshot.cursorStatus === 'gap'
                ? 'gap'
                : snapshot.cursorStatus === 'initialized'
                  ? 'cursor'
                  : 'heartbeat';
        frames.push(
            `id: ${snapshot.nextSequence}\n` +
                `event: ${eventName}\n` +
                `data: ${JSON.stringify({
                    schemaVersion: snapshot.schemaVersion,
                    cursorStatus: snapshot.cursorStatus,
                    nextSequence: snapshot.nextSequence,
                    highWaterSequence: snapshot.highWaterSequence,
                })}\n\n`,
        );
    }
    return Buffer.from(frames.join(''), 'utf8');
}

function forwardEventStreamResponse(response, upstream) {
    if (upstream.statusCode !== 200) {
        forwardResponse(response, upstream);
        return;
    }
    const body = eventStreamBytes(safeEventSnapshot(upstream.body));
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Content-Length', body.byteLength);
    response.setHeader('Cache-Control', 'no-store, no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('X-Accel-Buffering', 'no');
    response.end(body);
}

export function createSmartOrderSameOriginGatewayMiddleware({
    appSupportRoot,
    now = () => Date.now(),
    csrfTokenTtlMs = DEFAULT_CSRF_TOKEN_TTL_MS,
    csrfSessionTtlMs = DEFAULT_CSRF_SESSION_TTL_MS,
} = {}) {
    let privateRoot;
    try {
        privateRoot = explicitPrivateRoot(
            appSupportRoot ?? defaultAppSupportRoot(),
        );
    } catch {
        privateRoot = null;
    }
    const csrfSessions = createCsrfSessionStore({
        now,
        tokenTtlMs: csrfTokenTtlMs,
        sessionTtlMs: csrfSessionTtlMs,
    });
    const peerAttestor = createSmartOrderLoopbackPeerAttestor();
    const mutationAdmission = createSmartOrderMutationAdmissionController({
        now,
        globalWindowMs: MUTATION_GLOBAL_WINDOW_MS,
        globalRateLimit: MUTATION_GLOBAL_RATE_LIMIT,
        sessionRateLimit: MUTATION_SESSION_RATE_LIMIT,
        maxConcurrent: MUTATION_MAX_CONCURRENT,
        maxConcurrentPerSession: MUTATION_MAX_CONCURRENT_PER_SESSION,
        maxQueued: MUTATION_MAX_QUEUED,
        maxQueuedPerSession: MUTATION_MAX_QUEUED_PER_SESSION,
        maxSessionBuckets: MAX_CSRF_SESSIONS,
        queueWaitMs: MUTATION_QUEUE_WAIT_MS,
    });
    return async (request, response, next) => {
        const requestStartedAtMonotonicMs = performance.now();
        const decision = authorizeSmartOrderBrowserGatewayRequest(request);
        if (!decision.handled) {
            next();
            return;
        }
        if (!decision.allowed) {
            jsonResponse(response, decision.statusCode, decision.reason, {
                brokerWriteAttempted: false,
            });
            return;
        }
        let peerAuthenticated = false;
        try {
            peerAuthenticated = await peerAttestor.attest(request.socket);
        } catch {
            peerAuthenticated = false;
        }
        if (!peerAuthenticated) {
            jsonResponse(response, 403, 'gateway_peer_not_authorized', {
                brokerWriteAttempted: false,
            });
            return;
        }
        if (decision.route.localOnly) {
            try {
                csrfTokenResponse(
                    response,
                    csrfSessions.issue(decision.browserCookie),
                );
            } catch {
                jsonResponse(
                    response,
                    503,
                    'csrf_session_unavailable',
                    { brokerWriteAttempted: false },
                );
            }
            return;
        }
        let mutationAdmissionLease;
        if (decision.route.mutation) {
            const csrfSessionId = csrfSessions.consume(
                decision.browserCookie,
                decision.csrfToken,
            );
            if (csrfSessionId === null) {
                jsonResponse(response, 403, 'csrf_token_invalid', {
                    brokerWriteAttempted: false,
                });
                return;
            }
            try {
                mutationAdmissionLease =
                    await mutationAdmission.acquire(csrfSessionId);
            } catch {
                jsonResponse(response, 503, 'mutation_admission_unavailable', {
                    brokerWriteAttempted: false,
                });
                return;
            }
            if (!mutationAdmissionLease.allowed) {
                jsonResponse(response, 429, mutationAdmissionLease.reason, {
                    brokerWriteAttempted: false,
                });
                return;
            }
        }
        let body;
        let upstreamBody;
        let capability;
        try {
            if (privateRoot === null) {
                throw new Error('private gateway root is unavailable');
            }
            body = await readSmartOrderBodyWithDeadline(request, {
                expectedLength: decision.contentLength,
                maxBytes: SMART_ORDER_CONTROL_PLANE_MAX_BODY_BYTES,
                deadlineMs: DEFAULT_SMART_ORDER_BODY_DEADLINE_MS,
                startedAtMonotonicMs: requestStartedAtMonotonicMs,
                tooLargeCode: 'BODY_SHAPE_INVALID',
            });
            if (decision.route.mutation) {
                const parsedBody = parseSafeJsonObjectBody(body);
                if (
                    !parsedBody ||
                    !browserMutationBodyMatchesRoute(
                        decision.route,
                        parsedBody,
                    )
                ) {
                    throw Object.assign(
                        new Error('mutation body does not match route schema'),
                        { code: 'BODY_SHAPE_INVALID' },
                    );
                }
            }
            const nowEpochMs = now();
            const authority = await readSmartOrderGatewayAuthority({
                appSupportRoot: privateRoot,
                nowEpochMs,
            });
            capability = authority.capability;
            const requestId = randomUUID();
            const envelope = decision.route.mutation
                ? sealSmartOrderControlPlaneMutation({
                      capability,
                      runtimeEpochId: authority.discovery.runtimeEpochId,
                      sidecarAuthority: `${LOOPBACK_HOST}:${authority.discovery.port}`,
                      requestId,
                      method: request.method,
                      pathname: decision.route.pathname,
                      origin: decision.expectedOrigin,
                      plaintextBytes: body,
                  })
                : Object.freeze({ bodyBytes: body, nonce: undefined });
            upstreamBody = envelope.bodyBytes;
            const proof = createSmartOrderGatewayProof({
                capability,
                method: request.method,
                pathname: decision.route.pathname,
                origin: decision.expectedOrigin,
                runtimeEpochId: authority.discovery.runtimeEpochId,
                sidecarAuthority: `${LOOPBACK_HOST}:${authority.discovery.port}`,
                envelopeNonce: envelope.nonce,
                bodyBytes: upstreamBody,
                nowEpochMs,
                requestId,
            });
            const upstream = await proxyToSidecar({
                discovery: authority.discovery,
                capability,
                proof,
                origin: decision.expectedOrigin,
                route: decision.route,
                method: request.method,
                body: upstreamBody,
                envelopeNonce: envelope.nonce,
            });
            if (decision.route.eventStream) {
                forwardEventStreamResponse(response, upstream);
            } else {
                forwardResponse(response, upstream);
            }
        } catch (error) {
            capability?.fill(0);
            body?.fill(0);
            const bodyShapeInvalid = error?.code === 'BODY_SHAPE_INVALID';
            const bodyDeadlineExceeded =
                error?.code === 'BODY_DEADLINE_EXCEEDED';
            jsonResponse(
                response,
                bodyShapeInvalid ? 400 : bodyDeadlineExceeded ? 408 : 503,
                bodyShapeInvalid
                    ? 'request_body_shape_invalid'
                    : bodyDeadlineExceeded
                      ? 'request_body_timeout'
                      : 'smart_order_runtime_unavailable',
                { brokerWriteAttempted: false },
            );
            return;
        } finally {
            mutationAdmissionLease?.release();
            capability?.fill(0);
            if (upstreamBody && upstreamBody !== body) upstreamBody.fill(0);
            body?.fill(0);
        }
    };
}

export function smartOrderSameOriginGateway(options = {}) {
    return {
        name: 'realtimestock-smart-order-same-origin-gateway',
        enforce: 'pre',
        configureServer(server) {
            server.middlewares.use(
                createSmartOrderSameOriginGatewayMiddleware(options),
            );
        },
    };
}
