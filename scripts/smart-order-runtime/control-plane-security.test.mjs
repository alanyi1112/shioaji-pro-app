import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_CONTROL_PLANE_MAX_BODY_BYTES,
    SMART_ORDER_CONTROL_PLANE_MUTATION_CONTENT_TYPE,
    authorizeSmartOrderControlPlaneRequest,
    createSmartOrderControlPlaneResponseProof,
    createSmartOrderGatewayProof,
    openSmartOrderControlPlaneMutation,
    sealSmartOrderControlPlaneMutation,
    verifySmartOrderControlPlaneResponseProof,
} from './control-plane-security.mjs';

const capability = randomBytes(32);
const port = 41731;
const origin = 'http://127.0.0.1:5173';
const now = 1_786_380_000_000;
const runtimeEpochId = 'runtime-epoch-security-test';
const sidecarAuthority = `127.0.0.1:${port}`;

function authenticatedRequest({
    method = 'GET',
    pathname = '/v1/status',
    body = new Uint8Array(),
    overrides = {},
} = {}) {
    const proof = createSmartOrderGatewayProof({
        capability,
        method,
        pathname,
        origin,
        runtimeEpochId,
        sidecarAuthority,
        bodyBytes: body,
        nowEpochMs: now,
        requestId: '123e4567-e89b-42d3-a456-426614174000',
    });
    return authorizeSmartOrderControlPlaneRequest({
        capability,
        method,
        pathname,
        bodyBytes: body,
        expectedPort: port,
        expectedOrigin: origin,
        expectedRuntimeEpochId: runtimeEpochId,
        nowEpochMs: now,
        headers: {
            host: `127.0.0.1:${port}`,
            origin,
            'sec-fetch-site': 'same-origin',
            'x-realtimestock-runtime-epoch': runtimeEpochId,
            'x-realtimestock-request-id': proof.requestId,
            'x-realtimestock-gateway-timestamp': String(
                proof.timestampEpochMs,
            ),
            'x-realtimestock-gateway-proof': proof.proof,
            ...overrides,
        },
    });
}

describe('smart-order loopback control-plane security contract', () => {
    it('accepts an authenticated same-origin read without exposing capability bytes', () => {
        const decision = authenticatedRequest();
        expect(decision).toMatchObject({
            allowed: true,
            route: { routeId: 'status', access: 'authenticated_read' },
            replayRequired: false,
        });
        expect(JSON.stringify(decision)).not.toContain(
            capability.toString('base64url'),
        );
    });

    it('keeps Runtime risk policy reads and publications on separate authenticated routes', () => {
        expect(
            authenticatedRequest({ pathname: '/v1/risk/policy' }),
        ).toMatchObject({
            allowed: true,
            route: {
                routeId: 'risk_policy_get',
                access: 'authenticated_read',
            },
            replayRequired: false,
        });
        const requestId = '123e4567-e89b-42d3-a456-426614174001';
        const plaintext = Buffer.from(
            '{"expectedRevision":null,"operationId":"00000000-0000-4000-8000-000000000061","policy":{}}',
        );
        const envelope = sealSmartOrderControlPlaneMutation({
            capability,
            runtimeEpochId,
            sidecarAuthority,
            requestId,
            method: 'PUT',
            pathname: '/v1/risk/policy',
            origin,
            plaintextBytes: plaintext,
        });
        const proof = createSmartOrderGatewayProof({
            capability,
            method: 'PUT',
            pathname: '/v1/risk/policy',
            origin,
            runtimeEpochId,
            sidecarAuthority,
            envelopeNonce: envelope.nonce,
            bodyBytes: envelope.bodyBytes,
            nowEpochMs: now,
            requestId,
        });
        expect(
            authorizeSmartOrderControlPlaneRequest({
                capability,
                method: 'PUT',
                pathname: '/v1/risk/policy',
                bodyBytes: envelope.bodyBytes,
                expectedPort: port,
                expectedOrigin: origin,
                expectedRuntimeEpochId: runtimeEpochId,
                nowEpochMs: now,
                headers: {
                    host: `127.0.0.1:${port}`,
                    origin,
                    'sec-fetch-site': 'same-origin',
                    'content-type':
                        SMART_ORDER_CONTROL_PLANE_MUTATION_CONTENT_TYPE,
                    'x-realtimestock-runtime-epoch': runtimeEpochId,
                    'x-realtimestock-envelope-nonce': envelope.nonce,
                    'x-realtimestock-request-id': requestId,
                    'x-realtimestock-gateway-timestamp': String(
                        proof.timestampEpochMs,
                    ),
                    'x-realtimestock-gateway-proof': proof.proof,
                },
            }),
        ).toMatchObject({
            allowed: true,
            route: {
                routeId: 'risk_policy_publish',
                access: 'authenticated_mutation',
            },
            replayRequired: true,
        });
        plaintext.fill(0);
        envelope.bodyBytes.fill(0);
    });

    it('keeps kill-switch status read-only while classifying mutation separately', () => {
        expect(
            authenticatedRequest({ pathname: '/v1/risk/kill-switch' }),
        ).toMatchObject({
            allowed: true,
            route: {
                routeId: 'risk_kill_switch_get',
                access: 'authenticated_read',
            },
            replayRequired: false,
        });
    });

    it('keeps Gate manifest recomputation on a private authenticated mutation route', () => {
        const requestId = '123e4567-e89b-42d3-a456-426614174017';
        const plaintext = Buffer.from(
            '{"operationId":"00000000-0000-4000-8000-000000000017"}',
        );
        const envelope = sealSmartOrderControlPlaneMutation({
            capability,
            runtimeEpochId,
            sidecarAuthority,
            requestId,
            method: 'POST',
            pathname: '/v1/gate-manifest/recompute',
            origin,
            plaintextBytes: plaintext,
        });
        const proof = createSmartOrderGatewayProof({
            capability,
            method: 'POST',
            pathname: '/v1/gate-manifest/recompute',
            origin,
            runtimeEpochId,
            sidecarAuthority,
            envelopeNonce: envelope.nonce,
            bodyBytes: envelope.bodyBytes,
            nowEpochMs: now,
            requestId,
        });
        expect(
            authorizeSmartOrderControlPlaneRequest({
                capability,
                method: 'POST',
                pathname: '/v1/gate-manifest/recompute',
                bodyBytes: envelope.bodyBytes,
                expectedPort: port,
                expectedOrigin: origin,
                expectedRuntimeEpochId: runtimeEpochId,
                nowEpochMs: now,
                headers: {
                    host: `127.0.0.1:${port}`,
                    origin,
                    'sec-fetch-site': 'same-origin',
                    'content-type':
                        SMART_ORDER_CONTROL_PLANE_MUTATION_CONTENT_TYPE,
                    'x-realtimestock-runtime-epoch': runtimeEpochId,
                    'x-realtimestock-envelope-nonce': envelope.nonce,
                    'x-realtimestock-request-id': requestId,
                    'x-realtimestock-gateway-timestamp': String(
                        proof.timestampEpochMs,
                    ),
                    'x-realtimestock-gateway-proof': proof.proof,
                },
            }),
        ).toMatchObject({
            allowed: true,
            route: {
                routeId: 'gate_manifest_recompute',
                access: 'authenticated_mutation',
                browserGatewayAllowed: false,
            },
            replayRequired: true,
        });
        plaintext.fill(0);
        envelope.bodyBytes.fill(0);
    });

    it('keeps the Gate probe status and preparation routes private to authenticated sidecar callers', () => {
        expect(
            authenticatedRequest({ pathname: '/v1/gate-probe/status' }),
        ).toMatchObject({
            allowed: true,
            route: {
                routeId: 'gate_probe_status',
                access: 'authenticated_read',
                browserGatewayAllowed: false,
            },
            replayRequired: false,
        });

        const requestId = '123e4567-e89b-42d3-a456-426614174091';
        const plaintext = Buffer.from(
            JSON.stringify({ envelope: { operationId: requestId } }),
        );
        const envelope = sealSmartOrderControlPlaneMutation({
            capability,
            runtimeEpochId,
            sidecarAuthority,
            requestId,
            method: 'POST',
            pathname: '/v1/gate-probe/prepare',
            origin,
            plaintextBytes: plaintext,
        });
        const proof = createSmartOrderGatewayProof({
            capability,
            method: 'POST',
            pathname: '/v1/gate-probe/prepare',
            origin,
            runtimeEpochId,
            sidecarAuthority,
            envelopeNonce: envelope.nonce,
            bodyBytes: envelope.bodyBytes,
            nowEpochMs: now,
            requestId,
        });
        expect(
            authorizeSmartOrderControlPlaneRequest({
                capability,
                method: 'POST',
                pathname: '/v1/gate-probe/prepare',
                bodyBytes: envelope.bodyBytes,
                expectedPort: port,
                expectedOrigin: origin,
                expectedRuntimeEpochId: runtimeEpochId,
                nowEpochMs: now,
                headers: {
                    host: `127.0.0.1:${port}`,
                    origin,
                    'sec-fetch-site': 'same-origin',
                    'content-type':
                        SMART_ORDER_CONTROL_PLANE_MUTATION_CONTENT_TYPE,
                    'x-realtimestock-runtime-epoch': runtimeEpochId,
                    'x-realtimestock-envelope-nonce': envelope.nonce,
                    'x-realtimestock-request-id': requestId,
                    'x-realtimestock-gateway-timestamp': String(
                        proof.timestampEpochMs,
                    ),
                    'x-realtimestock-gateway-proof': proof.proof,
                },
            }),
        ).toMatchObject({
            allowed: true,
            route: {
                routeId: 'gate_probe_prepare',
                access: 'authenticated_mutation',
                browserGatewayAllowed: false,
            },
            replayRequired: true,
        });
        plaintext.fill(0);
        envelope.bodyBytes.fill(0);
    });

    it('accepts a bound JSON mutation and requires durable replay reservation', () => {
        const plaintext = Buffer.from('{"strategyKind":"trailing_exit"}');
        const requestId = '123e4567-e89b-42d3-a456-426614174000';
        const envelope = sealSmartOrderControlPlaneMutation({
            capability,
            runtimeEpochId,
            sidecarAuthority,
            requestId,
            method: 'POST',
            pathname: '/v1/strategies',
            origin,
            plaintextBytes: plaintext,
        });
        const proof = createSmartOrderGatewayProof({
            capability,
            method: 'POST',
            pathname: '/v1/strategies',
            origin,
            runtimeEpochId,
            sidecarAuthority,
            envelopeNonce: envelope.nonce,
            bodyBytes: envelope.bodyBytes,
            nowEpochMs: now,
            requestId,
        });
        const decision = authorizeSmartOrderControlPlaneRequest({
            capability,
            method: 'POST',
            pathname: '/v1/strategies',
            bodyBytes: envelope.bodyBytes,
            expectedPort: port,
            expectedOrigin: origin,
            expectedRuntimeEpochId: runtimeEpochId,
            nowEpochMs: now,
            headers: {
                host: `127.0.0.1:${port}`,
                origin,
                'sec-fetch-site': 'same-origin',
                'x-realtimestock-runtime-epoch': runtimeEpochId,
                'content-type': SMART_ORDER_CONTROL_PLANE_MUTATION_CONTENT_TYPE,
                'x-realtimestock-envelope-nonce': envelope.nonce,
                'x-realtimestock-request-id': proof.requestId,
                'x-realtimestock-gateway-timestamp': String(
                    proof.timestampEpochMs,
                ),
                'x-realtimestock-gateway-proof': proof.proof,
            },
        });
        expect(decision).toMatchObject({
            allowed: true,
            route: { routeId: 'strategy_create' },
            replayRequired: true,
        });
    });

    it('seals mutation plaintext and binds decryption to capability, epoch, route and nonce', () => {
        const requestId = '123e4567-e89b-42d3-a456-426614174000';
        const plaintext = Buffer.from(
            '{"strategyKind":"trailing_exit","contract":"TSE:2330"}',
        );
        const envelope = sealSmartOrderControlPlaneMutation({
            capability,
            runtimeEpochId,
            sidecarAuthority,
            requestId,
            method: 'POST',
            pathname: '/v1/strategies',
            origin,
            plaintextBytes: plaintext,
        });
        expect(envelope.bodyBytes.toString('utf8')).not.toContain(
            'trailing_exit',
        );
        expect(
            openSmartOrderControlPlaneMutation({
                capability,
                runtimeEpochId,
                sidecarAuthority,
                requestId,
                method: 'POST',
                pathname: '/v1/strategies',
                origin,
                nonce: envelope.nonce,
                bodyBytes: envelope.bodyBytes,
            }),
        ).toEqual(plaintext);

        const wrongCapability = randomBytes(32);
        expect(() =>
            openSmartOrderControlPlaneMutation({
                capability: wrongCapability,
                runtimeEpochId,
                sidecarAuthority,
                requestId,
                method: 'POST',
                pathname: '/v1/strategies',
                origin,
                nonce: envelope.nonce,
                bodyBytes: envelope.bodyBytes,
            }),
        ).toThrow();
        wrongCapability.fill(0);
        expect(() =>
            openSmartOrderControlPlaneMutation({
                capability,
                runtimeEpochId: 'runtime-epoch-stale',
                sidecarAuthority,
                requestId,
                method: 'POST',
                pathname: '/v1/strategies',
                origin,
                nonce: envelope.nonce,
                bodyBytes: envelope.bodyBytes,
            }),
        ).toThrow();
        expect(() =>
            openSmartOrderControlPlaneMutation({
                capability,
                runtimeEpochId,
                sidecarAuthority,
                requestId,
                method: 'POST',
                pathname: '/v1/strategies/s1/pause',
                origin,
                nonce: envelope.nonce,
                bodyBytes: envelope.bodyBytes,
            }),
        ).toThrow();
        const tampered = Buffer.from(envelope.bodyBytes);
        tampered[0] ^= 1;
        expect(() =>
            openSmartOrderControlPlaneMutation({
                capability,
                runtimeEpochId,
                sidecarAuthority,
                requestId,
                method: 'POST',
                pathname: '/v1/strategies',
                origin,
                nonce: envelope.nonce,
                bodyBytes: tampered,
            }),
        ).toThrow();
    });

    it.each([
        ['wrong host', { host: 'localhost:41731' }, 'host_not_allowed'],
        [
            'wrong origin',
            { origin: 'https://attacker.example' },
            'origin_or_fetch_metadata_not_allowed',
        ],
        [
            'cross-site fetch metadata',
            { 'sec-fetch-site': 'cross-site' },
            'origin_or_fetch_metadata_not_allowed',
        ],
        [
            'forwarded request',
            { forwarded: 'for=127.0.0.1' },
            'forwarded_or_remote_request_forbidden',
        ],
        [
            'client provenance',
            { 'x-realtimestock-provenance': 'manual_user_confirmed' },
            'client_supplied_provenance_forbidden',
        ],
    ])('rejects %s before dispatch', (_label, overrides, reason) => {
        expect(authenticatedRequest({ overrides })).toEqual({
            allowed: false,
            reason,
        });
    });

    it('rejects stale, tampered, duplicate, and body-replayed proofs', () => {
        expect(
            authenticatedRequest({
                overrides: {
                    'x-realtimestock-gateway-timestamp': String(now - 5_001),
                },
            }),
        ).toEqual({
            allowed: false,
            reason: 'request_proof_expired_or_invalid',
        });
        expect(
            authenticatedRequest({
                overrides: { 'x-realtimestock-gateway-proof': 'a'.repeat(43) },
            }),
        ).toEqual({ allowed: false, reason: 'gateway_proof_invalid' });
        expect(
            authenticatedRequest({
                overrides: { origin: [origin, origin] },
            }),
        ).toEqual({ allowed: false, reason: 'invalid_request_shape' });

        const originalBody = Buffer.from('{"state":"paused"}');
        const replayRequestId = '123e4567-e89b-42d3-a456-426614174000';
        const envelope = sealSmartOrderControlPlaneMutation({
            capability,
            runtimeEpochId,
            sidecarAuthority,
            requestId: replayRequestId,
            method: 'POST',
            pathname: '/v1/strategies/s1/pause',
            origin,
            plaintextBytes: originalBody,
        });
        const proof = createSmartOrderGatewayProof({
            capability,
            method: 'POST',
            pathname: '/v1/strategies/s1/pause',
            origin,
            runtimeEpochId,
            sidecarAuthority,
            envelopeNonce: envelope.nonce,
            bodyBytes: envelope.bodyBytes,
            nowEpochMs: now,
            requestId: replayRequestId,
        });
        const tamperedEnvelope = Buffer.from(envelope.bodyBytes);
        tamperedEnvelope[0] ^= 1;
        expect(
            authorizeSmartOrderControlPlaneRequest({
                capability,
                method: 'POST',
                pathname: '/v1/strategies/s1/pause',
                bodyBytes: tamperedEnvelope,
                expectedPort: port,
                expectedOrigin: origin,
                expectedRuntimeEpochId: runtimeEpochId,
                nowEpochMs: now,
                headers: {
                    host: `127.0.0.1:${port}`,
                    origin,
                    'sec-fetch-site': 'same-origin',
                    'x-realtimestock-runtime-epoch': runtimeEpochId,
                    'content-type': SMART_ORDER_CONTROL_PLANE_MUTATION_CONTENT_TYPE,
                    'x-realtimestock-envelope-nonce': envelope.nonce,
                    'x-realtimestock-request-id': proof.requestId,
                    'x-realtimestock-gateway-timestamp': String(now),
                    'x-realtimestock-gateway-proof': proof.proof,
                },
            }),
        ).toEqual({ allowed: false, reason: 'gateway_proof_invalid' });
    });

    it('requires gateway authentication even for the minimal health read', () => {
        expect(
            authorizeSmartOrderControlPlaneRequest({
                capability,
                method: 'GET',
                pathname: '/health',
                headers: { host: `127.0.0.1:${port}` },
                expectedPort: port,
                expectedOrigin: origin,
                expectedRuntimeEpochId: runtimeEpochId,
                nowEpochMs: now,
            }),
        ).toEqual({
            allowed: false,
            reason: 'origin_or_fetch_metadata_not_allowed',
        });
        expect(authenticatedRequest({ pathname: '/health' })).toMatchObject({
            allowed: true,
            route: { routeId: 'health', access: 'authenticated_read' },
        });
        expect(
            authorizeSmartOrderControlPlaneRequest({
                capability,
                method: 'GET',
                pathname: '/health',
                headers: {
                    host: `127.0.0.1:${port}`,
                    'x-forwarded-host': 'public.example',
                },
                expectedPort: port,
                expectedOrigin: origin,
                expectedRuntimeEpochId: runtimeEpochId,
                nowEpochMs: now,
            }),
        ).toEqual({
            allowed: false,
            reason: 'forwarded_or_remote_request_forbidden',
        });
        expect(
            authorizeSmartOrderControlPlaneRequest({
                capability,
                method: 'GET',
                pathname: '/health',
                headers: {
                    host: `127.0.0.1:${port}`,
                    origin: 'https://attacker.example',
                    'sec-fetch-site': 'cross-site',
                },
                expectedPort: port,
                expectedOrigin: origin,
                expectedRuntimeEpochId: runtimeEpochId,
                nowEpochMs: now,
            }),
        ).toEqual({
            allowed: false,
            reason: 'origin_or_fetch_metadata_not_allowed',
        });
    });

    it('binds the bounded event cursor into the authenticated pathname', () => {
        expect(
            authenticatedRequest({ pathname: '/v1/events/initial' }),
        ).toMatchObject({
            allowed: true,
            route: {
                routeId: 'events',
                access: 'authenticated_sse',
                afterSequence: null,
            },
        });
        expect(
            authenticatedRequest({ pathname: '/v1/events/42' }),
        ).toMatchObject({
            allowed: true,
            route: {
                routeId: 'events',
                access: 'authenticated_sse',
                afterSequence: 42,
            },
        });
        expect(
            authenticatedRequest({ pathname: '/v1/events/9007199254740992' }),
        ).toEqual({
            allowed: false,
            reason: 'route_or_method_not_allowed',
        });

        const wrongCapability = randomBytes(32);
        const proof = createSmartOrderGatewayProof({
            capability: wrongCapability,
            method: 'GET',
            pathname: '/v1/events/42',
            origin,
            runtimeEpochId,
            sidecarAuthority,
            nowEpochMs: now,
            requestId: '123e4567-e89b-42d3-a456-426614174000',
        });
        expect(
            authorizeSmartOrderControlPlaneRequest({
                capability,
                method: 'GET',
                pathname: '/v1/events/42',
                expectedPort: port,
                expectedOrigin: origin,
                expectedRuntimeEpochId: runtimeEpochId,
                nowEpochMs: now,
                headers: {
                    host: `127.0.0.1:${port}`,
                    origin,
                    'sec-fetch-site': 'same-origin',
                    'x-realtimestock-runtime-epoch': runtimeEpochId,
                    'x-realtimestock-request-id': proof.requestId,
                    'x-realtimestock-gateway-timestamp': String(now),
                    'x-realtimestock-gateway-proof': proof.proof,
                },
            }),
        ).toEqual({ allowed: false, reason: 'gateway_proof_invalid' });
        wrongCapability.fill(0);
    });

    it('rejects method confusion, encoded paths, non-JSON mutation, and oversized bodies', () => {
        expect(
            authenticatedRequest({ method: 'GET', pathname: '/v1/strategies/s1/pause' }),
        ).toEqual({
            allowed: false,
            reason: 'route_or_method_not_allowed',
        });
        expect(
            authorizeSmartOrderControlPlaneRequest({
                capability,
                method: 'GET',
                pathname: '/v1/%73tatus',
                headers: { host: `127.0.0.1:${port}` },
                expectedPort: port,
                expectedOrigin: origin,
                expectedRuntimeEpochId: runtimeEpochId,
                nowEpochMs: now,
            }),
        ).toEqual({ allowed: false, reason: 'invalid_request_shape' });

        const plaintext = Buffer.from('{}');
        const requestId = '123e4567-e89b-42d3-a456-426614174000';
        const envelope = sealSmartOrderControlPlaneMutation({
            capability,
            runtimeEpochId,
            sidecarAuthority,
            requestId,
            method: 'POST',
            pathname: '/v1/strategies',
            origin,
            plaintextBytes: plaintext,
        });
        const proof = createSmartOrderGatewayProof({
            capability,
            method: 'POST',
            pathname: '/v1/strategies',
            origin,
            runtimeEpochId,
            sidecarAuthority,
            envelopeNonce: envelope.nonce,
            bodyBytes: envelope.bodyBytes,
            nowEpochMs: now,
            requestId,
        });
        expect(
            authorizeSmartOrderControlPlaneRequest({
                capability,
                method: 'POST',
                pathname: '/v1/strategies',
                bodyBytes: envelope.bodyBytes,
                expectedPort: port,
                expectedOrigin: origin,
                expectedRuntimeEpochId: runtimeEpochId,
                nowEpochMs: now,
                headers: {
                    host: `127.0.0.1:${port}`,
                    origin,
                    'sec-fetch-site': 'same-origin',
                    'x-realtimestock-runtime-epoch': runtimeEpochId,
                    'x-realtimestock-envelope-nonce': envelope.nonce,
                    'x-realtimestock-request-id': proof.requestId,
                    'x-realtimestock-gateway-timestamp': String(now),
                    'x-realtimestock-gateway-proof': proof.proof,
                },
            }),
        ).toEqual({
            allowed: false,
            reason: 'mutation_envelope_content_type_required',
        });

        expect(() =>
            sealSmartOrderControlPlaneMutation({
                capability,
                runtimeEpochId,
                sidecarAuthority,
                requestId,
                method: 'POST',
                pathname: '/v1/strategies',
                origin,
                plaintextBytes: Buffer.alloc(
                    SMART_ORDER_CONTROL_PLANE_MAX_BODY_BYTES + 1,
                ),
            }),
        ).toThrow('plaintext size');
    });

    it('authenticates a response against request, epoch, authority, status and body', () => {
        const requestId = '123e4567-e89b-42d3-a456-426614174000';
        const body = Buffer.from('{"ok":true}\n');
        const requestBodySha256 =
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        const response = createSmartOrderControlPlaneResponseProof({
            capability,
            runtimeEpochId,
            sidecarAuthority,
            requestId,
            method: 'GET',
            pathname: '/v1/status',
            requestBodySha256,
            statusCode: 200,
            contentType: 'application/json; charset=utf-8',
            bodyBytes: body,
        });
        const verify = (overrides = {}) =>
            verifySmartOrderControlPlaneResponseProof({
                capability,
                runtimeEpochId,
                sidecarAuthority,
                requestId,
                method: 'GET',
                pathname: '/v1/status',
                requestBodySha256,
                statusCode: 200,
                contentType: 'application/json; charset=utf-8',
                bodyBytes: body,
                proof: response.proof,
                bodySha256: response.bodySha256,
                ...overrides,
            });
        expect(verify()).toBe(true);
        expect(verify({ runtimeEpochId: 'runtime-epoch-stale' })).toBe(false);
        expect(verify({ statusCode: 409 })).toBe(false);
        expect(verify({ pathname: '/v1/readiness' })).toBe(false);
        expect(verify({ bodyBytes: Buffer.from('{"ok":false}\n') })).toBe(
            false,
        );
    });
});
