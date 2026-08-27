import {
    createCipheriv,
    createDecipheriv,
    createHash,
    createHmac,
    randomBytes,
    randomUUID,
    timingSafeEqual,
} from 'node:crypto';

export const SMART_ORDER_CONTROL_PLANE_SECURITY_SCHEMA_VERSION =
    'smart-order-control-plane-security/2026-08-11.1';
export const SMART_ORDER_CONTROL_PLANE_MAX_BODY_BYTES = 64 * 1024;
export const SMART_ORDER_CONTROL_PLANE_MAX_ENVELOPE_BYTES =
    SMART_ORDER_CONTROL_PLANE_MAX_BODY_BYTES + 16;
export const SMART_ORDER_CONTROL_PLANE_MAX_RESPONSE_BYTES = 1024 * 1024;
export const SMART_ORDER_CONTROL_PLANE_MUTATION_CONTENT_TYPE =
    'application/vnd.realtimestock.smart-order-envelope';
export const SMART_ORDER_GATEWAY_PROOF_TTL_MS = 5_000;

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRATEGY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const RUNTIME_EPOCH_PATTERN = /^[A-Za-z0-9._:-]{1,240}$/;
const REQUEST_PROOF_SCHEMA_VERSION =
    'smart-order-control-plane-request-proof/2026-08-11.2';
const RESPONSE_PROOF_SCHEMA_VERSION =
    'smart-order-control-plane-response-proof/2026-08-11.1';
const SIDECAR_AUTHORITY_PATTERN = /^127\.0\.0\.1:\d{1,5}$/;
const ENVELOPE_NONCE_PATTERN = /^[A-Za-z0-9_-]{16}$/;
const MUTATION_ENVELOPE_SCHEMA_VERSION =
    'smart-order-control-plane-mutation-envelope/2026-08-11.1';
const FORWARDED_HEADER_NAMES = Object.freeze([
    'forwarded',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-proto',
    'x-real-ip',
]);

function deny(reason) {
    return Object.freeze({ allowed: false, reason });
}

function assertCapability(capability) {
    if (!(capability instanceof Uint8Array) || capability.byteLength !== 32) {
        throw new TypeError('gateway capability must be exactly 32 bytes');
    }
    return capability;
}

function assertBodyBytes(bodyBytes) {
    if (!(bodyBytes instanceof Uint8Array)) {
        throw new TypeError('bodyBytes must be a Uint8Array');
    }
    if (bodyBytes.byteLength > SMART_ORDER_CONTROL_PLANE_MAX_ENVELOPE_BYTES) {
        throw new RangeError('control-plane body exceeds its maximum size');
    }
    return bodyBytes;
}

function assertResponseBodyBytes(bodyBytes) {
    if (!(bodyBytes instanceof Uint8Array)) {
        throw new TypeError('response bodyBytes must be a Uint8Array');
    }
    if (bodyBytes.byteLength > SMART_ORDER_CONTROL_PLANE_MAX_RESPONSE_BYTES) {
        throw new RangeError('control-plane response exceeds its maximum size');
    }
    return bodyBytes;
}

function sha256Hex(value) {
    return createHash('sha256').update(value).digest('hex');
}

function canonicalProofInput({
    method,
    pathname,
    origin,
    runtimeEpochId,
    sidecarAuthority,
    requestId,
    timestampEpochMs,
    bodySha256,
    envelopeNonce,
}) {
    return [
        REQUEST_PROOF_SCHEMA_VERSION,
        runtimeEpochId,
        sidecarAuthority,
        method,
        pathname,
        origin,
        String(timestampEpochMs),
        requestId,
        bodySha256,
        envelopeNonce ?? '-',
    ].join('\n');
}

function hmacProof(capability, input) {
    return createHmac('sha256', capability)
        .update(canonicalProofInput(input))
        .digest('base64url');
}

function canonicalResponseProofInput({
    runtimeEpochId,
    sidecarAuthority,
    requestId,
    method,
    pathname,
    requestBodySha256,
    statusCode,
    contentType,
    bodySha256,
}) {
    return [
        RESPONSE_PROOF_SCHEMA_VERSION,
        runtimeEpochId,
        sidecarAuthority,
        requestId,
        method,
        pathname,
        requestBodySha256,
        String(statusCode),
        contentType,
        bodySha256,
    ].join('\n');
}

function hmacResponseProof(capability, input) {
    return createHmac('sha256', capability)
        .update(canonicalResponseProofInput(input))
        .digest('base64url');
}

function normalizeRuntimeEpochId(value) {
    return typeof value === 'string' && RUNTIME_EPOCH_PATTERN.test(value)
        ? value
        : null;
}

function normalizeSidecarAuthority(value) {
    if (typeof value !== 'string' || !SIDECAR_AUTHORITY_PATTERN.test(value)) {
        return null;
    }
    const port = Number(value.slice(value.lastIndexOf(':') + 1));
    return Number.isInteger(port) && port >= 1 && port <= 65_535
        ? value
        : null;
}

function normalizeEnvelopeNonce(value) {
    if (typeof value !== 'string' || !ENVELOPE_NONCE_PATTERN.test(value)) {
        return null;
    }
    try {
        const bytes = Buffer.from(value, 'base64url');
        return bytes.byteLength === 12 && bytes.toString('base64url') === value
            ? value
            : null;
    } catch {
        return null;
    }
}

function mutationBinding({
    runtimeEpochId,
    sidecarAuthority,
    requestId,
    method,
    pathname,
    origin,
}) {
    const canonicalRuntimeEpochId = normalizeRuntimeEpochId(runtimeEpochId);
    const canonicalSidecarAuthority = normalizeSidecarAuthority(
        sidecarAuthority,
    );
    const canonicalMethod = normalizeMethod(method);
    const canonicalPathname = normalizePathname(pathname);
    if (
        !canonicalRuntimeEpochId ||
        !canonicalSidecarAuthority ||
        !UUID_PATTERN.test(requestId ?? '') ||
        !canonicalMethod ||
        !canonicalPathname ||
        typeof origin !== 'string' ||
        origin.length === 0 ||
        origin.length > 256
    ) {
        throw new TypeError('mutation envelope binding is invalid');
    }
    return Object.freeze({
        runtimeEpochId: canonicalRuntimeEpochId,
        sidecarAuthority: canonicalSidecarAuthority,
        requestId,
        method: canonicalMethod,
        pathname: canonicalPathname,
        origin,
    });
}

function mutationEnvelopeAad(binding) {
    return Buffer.from(
        [
            MUTATION_ENVELOPE_SCHEMA_VERSION,
            binding.runtimeEpochId,
            binding.sidecarAuthority,
            binding.requestId,
            binding.method,
            binding.pathname,
            binding.origin,
        ].join('\n'),
        'utf8',
    );
}

function mutationEnvelopeKey(capability) {
    return createHmac('sha256', assertCapability(capability))
        .update('RealTimeStock smart-order mutation envelope key v1')
        .digest();
}

export function sealSmartOrderControlPlaneMutation({
    capability,
    runtimeEpochId,
    sidecarAuthority,
    requestId,
    method,
    pathname,
    origin,
    plaintextBytes,
}) {
    if (
        !(plaintextBytes instanceof Uint8Array) ||
        plaintextBytes.byteLength < 1 ||
        plaintextBytes.byteLength > SMART_ORDER_CONTROL_PLANE_MAX_BODY_BYTES
    ) {
        throw new RangeError('mutation plaintext size is invalid');
    }
    const binding = mutationBinding({
        runtimeEpochId,
        sidecarAuthority,
        requestId,
        method,
        pathname,
        origin,
    });
    const nonce = randomBytes(12);
    const key = mutationEnvelopeKey(capability);
    try {
        const cipher = createCipheriv('aes-256-gcm', key, nonce);
        cipher.setAAD(mutationEnvelopeAad(binding));
        const ciphertext = Buffer.concat([
            cipher.update(plaintextBytes),
            cipher.final(),
        ]);
        const authenticationTag = cipher.getAuthTag();
        return Object.freeze({
            nonce: nonce.toString('base64url'),
            bodyBytes: Buffer.concat([ciphertext, authenticationTag]),
        });
    } finally {
        key.fill(0);
    }
}

export function openSmartOrderControlPlaneMutation({
    capability,
    runtimeEpochId,
    sidecarAuthority,
    requestId,
    method,
    pathname,
    origin,
    nonce,
    bodyBytes,
}) {
    const binding = mutationBinding({
        runtimeEpochId,
        sidecarAuthority,
        requestId,
        method,
        pathname,
        origin,
    });
    const canonicalNonce = normalizeEnvelopeNonce(nonce);
    if (
        !canonicalNonce ||
        !(bodyBytes instanceof Uint8Array) ||
        bodyBytes.byteLength <= 16 ||
        bodyBytes.byteLength > SMART_ORDER_CONTROL_PLANE_MAX_ENVELOPE_BYTES
    ) {
        throw new TypeError('mutation envelope is invalid');
    }
    const nonceBytes = Buffer.from(canonicalNonce, 'base64url');
    const ciphertext = bodyBytes.subarray(0, bodyBytes.byteLength - 16);
    const authenticationTag = bodyBytes.subarray(bodyBytes.byteLength - 16);
    const key = mutationEnvelopeKey(capability);
    try {
        const decipher = createDecipheriv('aes-256-gcm', key, nonceBytes);
        decipher.setAAD(mutationEnvelopeAad(binding));
        decipher.setAuthTag(authenticationTag);
        const plaintext = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
        ]);
        if (
            plaintext.byteLength < 1 ||
            plaintext.byteLength > SMART_ORDER_CONTROL_PLANE_MAX_BODY_BYTES
        ) {
            plaintext.fill(0);
            throw new RangeError('mutation plaintext size is invalid');
        }
        return plaintext;
    } finally {
        key.fill(0);
    }
}

function normalizeMethod(value) {
    if (typeof value !== 'string' || !/^[A-Z]{3,7}$/.test(value)) return null;
    return value;
}

function normalizePathname(value) {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 512 ||
        !value.startsWith('/') ||
        value.includes('?') ||
        value.includes('#') ||
        value.includes('\\') ||
        value.includes('//') ||
        /%2f|%5c/i.test(value)
    ) {
        return null;
    }
    try {
        const decoded = decodeURIComponent(value);
        if (decoded !== value || decoded.split('/').includes('..')) return null;
    } catch {
        return null;
    }
    return value;
}

function normalizeHeaders(headers) {
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
        return null;
    }
    const normalized = new Map();
    for (const [rawName, rawValue] of Object.entries(headers)) {
        const name = rawName.toLowerCase();
        if (!/^[a-z0-9-]{1,64}$/.test(name) || normalized.has(name)) {
            return null;
        }
        if (Array.isArray(rawValue)) return null;
        if (
            typeof rawValue !== 'string' ||
            rawValue.length > 512 ||
            /[\r\n\u0000]/.test(rawValue)
        ) {
            return null;
        }
        normalized.set(name, rawValue);
    }
    return normalized;
}

function routeFor(method, pathname) {
    if (method === 'GET' && pathname === '/health') {
        return Object.freeze({ routeId: 'health', access: 'authenticated_read' });
    }
    if (method === 'GET' && pathname === '/v1/status') {
        return Object.freeze({ routeId: 'status', access: 'authenticated_read' });
    }
    if (method === 'GET' && pathname === '/v1/readiness') {
        return Object.freeze({ routeId: 'readiness', access: 'authenticated_read' });
    }
    if (method === 'GET' && pathname === '/v1/gate-status') {
        return Object.freeze({ routeId: 'gate_status', access: 'authenticated_read' });
    }
    if (method === 'GET' && pathname === '/v1/history') {
        return Object.freeze({ routeId: 'history', access: 'authenticated_read' });
    }
    if (pathname === '/v1/risk/policy') {
        if (method === 'GET') {
            return Object.freeze({
                routeId: 'risk_policy_get',
                access: 'authenticated_read',
            });
        }
        if (method === 'PUT') {
            return Object.freeze({
                routeId: 'risk_policy_publish',
                access: 'authenticated_mutation',
            });
        }
        return null;
    }
    if (method === 'POST' && pathname === '/v1/lifecycle/quiesce') {
        return Object.freeze({
            routeId: 'lifecycle_quiesce',
            access: 'authenticated_mutation',
            browserGatewayAllowed: false,
        });
    }
    if (method === 'POST' && pathname === '/v1/lifecycle/stop') {
        return Object.freeze({
            routeId: 'lifecycle_stop',
            access: 'authenticated_mutation',
            browserGatewayAllowed: false,
        });
    }
    if (method === 'POST' && pathname === '/v1/gate-manifest/recompute') {
        return Object.freeze({
            routeId: 'gate_manifest_recompute',
            access: 'authenticated_mutation',
            browserGatewayAllowed: false,
        });
    }
    if (method === 'POST' && pathname === '/v1/task0-3c/reconcile') {
        return Object.freeze({
            routeId: 'task0_3c_reconcile',
            access: 'authenticated_mutation',
            browserGatewayAllowed: false,
        });
    }
    if (method === 'GET' && pathname === '/v1/gate-probe/status') {
        return Object.freeze({
            routeId: 'gate_probe_status',
            access: 'authenticated_read',
            browserGatewayAllowed: false,
        });
    }
    if (method === 'POST' && pathname === '/v1/gate-probe/prepare') {
        return Object.freeze({
            routeId: 'gate_probe_prepare',
            access: 'authenticated_mutation',
            browserGatewayAllowed: false,
        });
    }
    const tradingWriteMatch =
        method === 'POST'
            ? pathname.match(
                  /^\/v1\/trading-write\/(STK-(?:MAN|AUTO)-(?:PLACE|UPDATE|CANCEL)-[A-Z0-9-]+)$/,
              )
            : null;
    if (tradingWriteMatch) {
        return Object.freeze({
            routeId: 'manual_broker_write_admission',
            access: 'authenticated_mutation',
            brokerRouteId: tradingWriteMatch[1],
        });
    }
    const eventMatch =
        method === 'GET'
            ? pathname.match(/^\/v1\/events\/(initial|0|[1-9]\d{0,15})$/)
            : null;
    if (eventMatch) {
        const afterSequence =
            eventMatch[1] === 'initial' ? null : Number(eventMatch[1]);
        if (
            afterSequence !== null &&
            (!Number.isSafeInteger(afterSequence) || afterSequence < 0)
        ) {
            return null;
        }
        return Object.freeze({
            routeId: 'events',
            access: 'authenticated_sse',
            afterSequence,
        });
    }
    if (pathname === '/v1/strategies') {
        if (method === 'GET') {
            return Object.freeze({
                routeId: 'strategy_list',
                access: 'authenticated_read',
            });
        }
        if (method === 'POST') {
            return Object.freeze({
                routeId: 'strategy_create',
                access: 'authenticated_mutation',
            });
        }
        return null;
    }
    if (
        method === 'POST' &&
        (pathname === '/v1/protected-entry/confirmation-preview' ||
            pathname === '/v1/protected-entry/confirmation-accept')
    ) {
        return Object.freeze({
            routeId:
                pathname === '/v1/protected-entry/confirmation-preview'
                    ? 'protected_entry_confirmation_preview'
                    : 'protected_entry_confirmation_accept',
            access: 'authenticated_mutation',
        });
    }
    const strategyMatch = pathname.match(
        /^\/v1\/strategies\/([^/]+)(?:\/(pause|resume|cancel|copy|cancel-broker-order|update-broker-order|confirmation-preview|confirmation-accept|drain-prepared|relinquish-protection-prepare|relinquish-protection-commit|resolutions|resolve-final))?$/,
    );
    if (strategyMatch) {
        const strategyId = strategyMatch[1];
        const action = strategyMatch[2];
        if (!STRATEGY_ID_PATTERN.test(strategyId)) return null;
        if (!action && method === 'GET') {
            return Object.freeze({
                routeId: 'strategy_get',
                access: 'authenticated_read',
                strategyId,
            });
        }
        if (!action && method === 'PUT') {
            return Object.freeze({
                routeId: 'strategy_update_draft',
                access: 'authenticated_mutation',
                strategyId,
            });
        }
        if (action === 'resolutions' && method === 'GET') {
            return Object.freeze({
                routeId: 'strategy_manual_resolution_list',
                access: 'authenticated_read',
                strategyId,
            });
        }
        if (action && method === 'POST') {
            return Object.freeze({
                routeId:
                    action === 'cancel-broker-order'
                        ? 'broker_order_cancel_request'
                        : action === 'update-broker-order'
                          ? 'broker_order_update_request'
                        : action === 'confirmation-preview'
                          ? 'strategy_confirmation_preview'
                          : action === 'confirmation-accept'
                            ? 'strategy_confirmation_accept'
                        : action === 'drain-prepared'
                          ? 'strategy_prepared_intent_drain'
                          : action === 'relinquish-protection-prepare'
                            ? 'strategy_protection_relinquish_prepare'
                            : action === 'relinquish-protection-commit'
                              ? 'strategy_protection_relinquish_commit'
                              : action === 'resolve-final'
                                ? 'strategy_manual_resolution_apply_unique_final'
                        : `strategy_${action}`,
                access: 'authenticated_mutation',
                strategyId,
            });
        }
        return null;
    }
    if (pathname === '/v1/risk/kill-switch') {
        if (method === 'GET') {
            return Object.freeze({
                routeId: 'risk_kill_switch_get',
                access: 'authenticated_read',
            });
        }
        if (method === 'PUT') {
            return Object.freeze({
                routeId: 'risk_kill_switch',
                access: 'authenticated_mutation',
            });
        }
        return null;
    }
    return null;
}

function contentTypeIsMutationEnvelope(value) {
    return (
        typeof value === 'string' &&
        value === SMART_ORDER_CONTROL_PLANE_MUTATION_CONTENT_TYPE
    );
}

function proofsMatch(expected, received) {
    if (
        typeof received !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(received)
    ) {
        return false;
    }
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(received);
    return (
        expectedBuffer.byteLength === receivedBuffer.byteLength &&
        timingSafeEqual(expectedBuffer, receivedBuffer)
    );
}

export function createSmartOrderGatewayProof({
    capability,
    method,
    pathname,
    origin,
    runtimeEpochId,
    sidecarAuthority,
    envelopeNonce,
    bodyBytes = new Uint8Array(),
    nowEpochMs,
    requestId = randomUUID(),
}) {
    assertCapability(capability);
    const canonicalMethod = normalizeMethod(method);
    const canonicalPathname = normalizePathname(pathname);
    if (!canonicalMethod || !canonicalPathname) {
        throw new TypeError('gateway proof method or pathname is invalid');
    }
    if (typeof origin !== 'string' || origin.length === 0 || origin.length > 256) {
        throw new TypeError('gateway proof origin is invalid');
    }
    const canonicalRuntimeEpochId = normalizeRuntimeEpochId(runtimeEpochId);
    if (!canonicalRuntimeEpochId) {
        throw new TypeError('gateway proof runtimeEpochId is invalid');
    }
    const canonicalSidecarAuthority = normalizeSidecarAuthority(
        sidecarAuthority,
    );
    if (!canonicalSidecarAuthority) {
        throw new TypeError('gateway proof sidecarAuthority is invalid');
    }
    if (!UUID_PATTERN.test(requestId)) {
        throw new TypeError('gateway proof requestId must be a UUIDv4');
    }
    if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
        throw new TypeError('gateway proof time is invalid');
    }
    const body = assertBodyBytes(bodyBytes);
    const route = routeFor(canonicalMethod, canonicalPathname);
    const mutation = route?.access === 'authenticated_mutation';
    const canonicalEnvelopeNonce =
        envelopeNonce === undefined ? null : normalizeEnvelopeNonce(envelopeNonce);
    if (
        (mutation && !canonicalEnvelopeNonce) ||
        (!mutation && envelopeNonce !== undefined)
    ) {
        throw new TypeError('gateway proof envelope nonce is invalid');
    }
    const bodySha256 = sha256Hex(body);
    const proof = hmacProof(capability, {
        method: canonicalMethod,
        pathname: canonicalPathname,
        origin,
        runtimeEpochId: canonicalRuntimeEpochId,
        sidecarAuthority: canonicalSidecarAuthority,
        requestId,
        timestampEpochMs: nowEpochMs,
        bodySha256,
        envelopeNonce: canonicalEnvelopeNonce,
    });
    return Object.freeze({
        requestId,
        runtimeEpochId: canonicalRuntimeEpochId,
        sidecarAuthority: canonicalSidecarAuthority,
        timestampEpochMs: nowEpochMs,
        bodySha256,
        envelopeNonce: canonicalEnvelopeNonce,
        proof,
    });
}

export function authorizeSmartOrderControlPlaneRequest({
    capability,
    method,
    pathname,
    headers,
    bodyBytes = new Uint8Array(),
    expectedPort,
    expectedOrigin,
    expectedRuntimeEpochId,
    nowEpochMs,
}) {
    try {
        assertCapability(capability);
        assertBodyBytes(bodyBytes);
    } catch {
        return deny('invalid_server_security_context');
    }
    const canonicalMethod = normalizeMethod(method);
    const canonicalPathname = normalizePathname(pathname);
    const normalizedHeaders = normalizeHeaders(headers);
    if (!canonicalMethod || !canonicalPathname || !normalizedHeaders) {
        return deny('invalid_request_shape');
    }
    if (!Number.isInteger(expectedPort) || expectedPort < 1 || expectedPort > 65535) {
        return deny('invalid_server_security_context');
    }
    if (
        typeof expectedOrigin !== 'string' ||
        !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(expectedOrigin)
    ) {
        return deny('invalid_server_security_context');
    }
    const canonicalRuntimeEpochId = normalizeRuntimeEpochId(
        expectedRuntimeEpochId,
    );
    if (!canonicalRuntimeEpochId) {
        return deny('invalid_server_security_context');
    }
    if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
        return deny('invalid_server_security_context');
    }
    if (normalizedHeaders.get('host') !== `127.0.0.1:${expectedPort}`) {
        return deny('host_not_allowed');
    }
    if (
        FORWARDED_HEADER_NAMES.some((name) => normalizedHeaders.has(name))
    ) {
        return deny('forwarded_or_remote_request_forbidden');
    }
    const route = routeFor(canonicalMethod, canonicalPathname);
    if (!route) return deny('route_or_method_not_allowed');
    if (normalizedHeaders.has('x-realtimestock-provenance')) {
        return deny('client_supplied_provenance_forbidden');
    }
    if (
        normalizedHeaders.get('origin') !== expectedOrigin ||
        normalizedHeaders.get('sec-fetch-site') !== 'same-origin'
    ) {
        return deny('origin_or_fetch_metadata_not_allowed');
    }
    const requestId = normalizedHeaders.get('x-realtimestock-request-id');
    const receivedRuntimeEpochId = normalizedHeaders.get(
        'x-realtimestock-runtime-epoch',
    );
    const receivedEnvelopeNonce = normalizedHeaders.get(
        'x-realtimestock-envelope-nonce',
    );
    const timestampText = normalizedHeaders.get(
        'x-realtimestock-gateway-timestamp',
    );
    const timestampEpochMs = Number(timestampText);
    if (
        !UUID_PATTERN.test(requestId ?? '') ||
        receivedRuntimeEpochId !== canonicalRuntimeEpochId ||
        !/^\d{1,16}$/.test(timestampText ?? '') ||
        !Number.isSafeInteger(timestampEpochMs) ||
        Math.abs(nowEpochMs - timestampEpochMs) >
            SMART_ORDER_GATEWAY_PROOF_TTL_MS
    ) {
        return deny('request_proof_expired_or_invalid');
    }
    const bodySha256 = sha256Hex(bodyBytes);
    const mutation = route.access === 'authenticated_mutation';
    const canonicalEnvelopeNonce = mutation
        ? normalizeEnvelopeNonce(receivedEnvelopeNonce)
        : null;
    if (
        (mutation && !canonicalEnvelopeNonce) ||
        (!mutation && receivedEnvelopeNonce !== undefined)
    ) {
        return deny('mutation_envelope_invalid');
    }
    const expectedProof = hmacProof(capability, {
        method: canonicalMethod,
        pathname: canonicalPathname,
        origin: expectedOrigin,
        runtimeEpochId: canonicalRuntimeEpochId,
        sidecarAuthority: `127.0.0.1:${expectedPort}`,
        requestId,
        timestampEpochMs,
        bodySha256,
        envelopeNonce: canonicalEnvelopeNonce,
    });
    if (
        !proofsMatch(
            expectedProof,
            normalizedHeaders.get('x-realtimestock-gateway-proof'),
        )
    ) {
        return deny('gateway_proof_invalid');
    }
    if (mutation) {
        if (
            !contentTypeIsMutationEnvelope(
                normalizedHeaders.get('content-type'),
            )
        ) {
            return deny('mutation_envelope_content_type_required');
        }
        if (bodyBytes.byteLength === 0) return deny('json_body_required');
    } else if (
        bodyBytes.byteLength !== 0 ||
        normalizedHeaders.has('content-type')
    ) {
        return deny('body_not_allowed');
    }
    return Object.freeze({
        allowed: true,
        route,
        requestId,
        runtimeEpochId: canonicalRuntimeEpochId,
        sidecarAuthority: `127.0.0.1:${expectedPort}`,
        method: canonicalMethod,
        pathname: canonicalPathname,
        envelopeNonce: canonicalEnvelopeNonce,
        replayRequired: mutation,
        bodySha256,
    });
}

export function createSmartOrderControlPlaneResponseProof({
    capability,
    runtimeEpochId,
    sidecarAuthority,
    requestId,
    method,
    pathname,
    requestBodySha256,
    statusCode,
    contentType,
    bodyBytes,
}) {
    assertCapability(capability);
    const canonicalRuntimeEpochId = normalizeRuntimeEpochId(runtimeEpochId);
    if (!canonicalRuntimeEpochId) {
        throw new TypeError('response proof runtimeEpochId is invalid');
    }
    const canonicalSidecarAuthority = normalizeSidecarAuthority(
        sidecarAuthority,
    );
    const canonicalMethod = normalizeMethod(method);
    const canonicalPathname = normalizePathname(pathname);
    if (
        !canonicalSidecarAuthority ||
        !canonicalMethod ||
        !canonicalPathname ||
        typeof requestBodySha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(requestBodySha256)
    ) {
        throw new TypeError('response proof request binding is invalid');
    }
    if (!UUID_PATTERN.test(requestId ?? '')) {
        throw new TypeError('response proof requestId must be a UUIDv4');
    }
    if (
        !Number.isInteger(statusCode) ||
        statusCode < 200 ||
        statusCode > 599 ||
        (statusCode >= 300 && statusCode < 400)
    ) {
        throw new TypeError('response proof statusCode is invalid');
    }
    if (
        typeof contentType !== 'string' ||
        contentType.length === 0 ||
        contentType.length > 128 ||
        /[\r\n\u0000]/.test(contentType)
    ) {
        throw new TypeError('response proof contentType is invalid');
    }
    const body = assertResponseBodyBytes(bodyBytes);
    const bodySha256 = sha256Hex(body);
    return Object.freeze({
        runtimeEpochId: canonicalRuntimeEpochId,
        sidecarAuthority: canonicalSidecarAuthority,
        requestId,
        bodySha256,
        proof: hmacResponseProof(capability, {
            runtimeEpochId: canonicalRuntimeEpochId,
            sidecarAuthority: canonicalSidecarAuthority,
            requestId,
            method: canonicalMethod,
            pathname: canonicalPathname,
            requestBodySha256,
            statusCode,
            contentType,
            bodySha256,
        }),
    });
}

export function verifySmartOrderControlPlaneResponseProof({
    capability,
    runtimeEpochId,
    sidecarAuthority,
    requestId,
    method,
    pathname,
    requestBodySha256,
    statusCode,
    contentType,
    bodyBytes,
    proof,
    bodySha256,
}) {
    let expected;
    try {
        expected = createSmartOrderControlPlaneResponseProof({
            capability,
            runtimeEpochId,
            sidecarAuthority,
            requestId,
            method,
            pathname,
            requestBodySha256,
            statusCode,
            contentType,
            bodyBytes,
        });
    } catch {
        return false;
    }
    return (
        bodySha256 === expected.bodySha256 &&
        proofsMatch(expected.proof, proof)
    );
}
