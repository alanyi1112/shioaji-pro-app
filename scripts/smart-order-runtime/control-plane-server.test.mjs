import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
    SMART_ORDER_CONTROL_PLANE_MAX_ENVELOPE_BYTES,
    SMART_ORDER_CONTROL_PLANE_MUTATION_CONTENT_TYPE,
    createSmartOrderGatewayProof,
    sealSmartOrderControlPlaneMutation,
    verifySmartOrderControlPlaneResponseProof,
} from './control-plane-security.mjs';
import {
    SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
    smartOrderGateProbeAccountScopeSha256,
} from './gate-probe-safety-envelope.mjs';
import { startSmartOrderControlPlaneServer } from './control-plane-server.mjs';
import { issueSmartOrderGateProbeCliAuthorization } from './gate-probe-cli-authorization.mjs';

const servers = [];
const origin = 'http://127.0.0.1:5173';
const runtimeEpochId = 'runtime-epoch-control-plane-test';
const gateProbeApiGeneration = 'simulation:control-plane-gate-probe';
const gateProbeApiGenerationSha256 = `sha256:${createHash('sha256')
    .update(gateProbeApiGeneration)
    .digest('hex')}`;
const gateProbeRuntimeEpochSha256 = `sha256:${createHash('sha256')
    .update(runtimeEpochId)
    .digest('hex')}`;

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function startFixture(runtimeController, lifecycleCallbacks = {}) {
    const capability = randomBytes(32);
    const gateProbeCliCapability = randomBytes(32);
    const gateProbeControlPlaneAuthority = Object.freeze({});
    const server = await startSmartOrderControlPlaneServer({
        capability,
        gateProbeCliCapability,
        gateProbeControlPlaneAuthority,
        runtimeEpochId,
        expectedOrigin: origin,
        runtimeController:
            runtimeController ??
            {
                status: () => ({
                    role: 'primary',
                    state: 'reconciling',
                    dispatchAllowed: false,
                    watchdog: { repositoryReady: true },
                    secret: 'must-not-leak',
                }),
            },
        ...lifecycleCallbacks,
    });
    servers.push(server);
    return { capability, gateProbeCliCapability, runtimeEpochId, server };
}

async function lifecycleStopRequest({
    capability,
    server,
    operation = 'graceful_stop',
    requestId = '123e4567-e89b-42d3-a456-426614174099',
    onRequest,
}) {
    const pathname = '/v1/lifecycle/stop';
    const completionNonce = '123e4567-e89b-42d3-a456-426614174098';
    const plaintext = Buffer.from(
        JSON.stringify({ operation, completionNonce }),
        'utf8',
    );
    const envelope = sealSmartOrderControlPlaneMutation({
        capability,
        runtimeEpochId,
        sidecarAuthority: `${server.host}:${server.port}`,
        requestId,
        method: 'POST',
        pathname,
        origin,
        plaintextBytes: plaintext,
    });
    plaintext.fill(0);
    const proof = createSmartOrderGatewayProof({
        capability,
        method: 'POST',
        pathname,
        origin,
        runtimeEpochId,
        sidecarAuthority: `${server.host}:${server.port}`,
        requestId,
        envelopeNonce: envelope.nonce,
        bodyBytes: envelope.bodyBytes,
        nowEpochMs: Date.now(),
    });
    const response = await request({
        server,
        method: 'POST',
        pathname,
        headers: {
            Host: `${server.host}:${server.port}`,
            Origin: origin,
            'Sec-Fetch-Site': 'same-origin',
            'Content-Type': SMART_ORDER_CONTROL_PLANE_MUTATION_CONTENT_TYPE,
            'Content-Length': String(envelope.bodyBytes.byteLength),
            'X-RealTimeStock-Runtime-Epoch': runtimeEpochId,
            'X-RealTimeStock-Request-Id': requestId,
            'X-RealTimeStock-Gateway-Timestamp': String(
                proof.timestampEpochMs,
            ),
            'X-RealTimeStock-Gateway-Proof': proof.proof,
            'X-RealTimeStock-Envelope-Nonce': envelope.nonce,
        },
        body: envelope.bodyBytes,
        onRequest,
    });
    envelope.bodyBytes.fill(0);
    return response;
}

async function strategyDrainRequest({
    capability,
    server,
    pathname,
    payload,
    method = 'POST',
    requestId = '123e4567-e89b-42d3-a456-426614174199',
}) {
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    const envelope = sealSmartOrderControlPlaneMutation({
        capability,
        runtimeEpochId,
        sidecarAuthority: `${server.host}:${server.port}`,
        requestId,
        method,
        pathname,
        origin,
        plaintextBytes: plaintext,
    });
    plaintext.fill(0);
    const proof = createSmartOrderGatewayProof({
        capability,
        method,
        pathname,
        origin,
        runtimeEpochId,
        sidecarAuthority: `${server.host}:${server.port}`,
        requestId,
        envelopeNonce: envelope.nonce,
        bodyBytes: envelope.bodyBytes,
        nowEpochMs: Date.now(),
    });
    const response = await request({
        server,
        method,
        pathname,
        headers: {
            Host: `${server.host}:${server.port}`,
            Origin: origin,
            'Sec-Fetch-Site': 'same-origin',
            'Content-Type': SMART_ORDER_CONTROL_PLANE_MUTATION_CONTENT_TYPE,
            'Content-Length': String(envelope.bodyBytes.byteLength),
            'X-RealTimeStock-Runtime-Epoch': runtimeEpochId,
            'X-RealTimeStock-Request-Id': requestId,
            'X-RealTimeStock-Gateway-Timestamp': String(
                proof.timestampEpochMs,
            ),
            'X-RealTimeStock-Gateway-Proof': proof.proof,
            'X-RealTimeStock-Envelope-Nonce': envelope.nonce,
        },
        body: envelope.bodyBytes,
    });
    envelope.bodyBytes.fill(0);
    return response;
}

function request({
    server,
    method = 'GET',
    pathname,
    headers = {},
    body,
    onRequest,
}) {
    return new Promise((resolve, reject) => {
        const request = http.request(
            {
                host: server.host,
                port: server.port,
                method,
                path: pathname,
                headers,
            },
            (response) => {
                const chunks = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    resolve({
                        status: response.statusCode,
                        headers: response.headers,
                        rawBody: Buffer.from(text, 'utf8'),
                        body: JSON.parse(text),
                    });
                });
            },
        );
        onRequest?.(request);
        request.once('error', reject);
        if (body) request.write(body);
        request.end();
    });
}

function rawRequest({ server, payload }) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({
            host: server.host,
            port: server.port,
        });
        const chunks = [];
        socket.once('connect', () => socket.end(payload));
        socket.on('data', (chunk) => chunks.push(chunk));
        socket.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        socket.once('error', reject);
    });
}

function gatewayHeaders({
    capability,
    server,
    method,
    pathname,
    body,
    envelopeNonce,
}) {
    const nowEpochMs = Date.now();
    const proof = createSmartOrderGatewayProof({
        capability,
        method,
        pathname,
        origin,
        runtimeEpochId,
        sidecarAuthority: `${server.host}:${server.port}`,
        envelopeNonce,
        bodyBytes: body ?? new Uint8Array(),
        nowEpochMs,
        requestId: '123e4567-e89b-42d3-a456-426614174000',
    });
    return {
        Host: `${server.host}:${server.port}`,
        Origin: origin,
        'Sec-Fetch-Site': 'same-origin',
        'X-RealTimeStock-Runtime-Epoch': runtimeEpochId,
        'X-RealTimeStock-Request-Id': proof.requestId,
        'X-RealTimeStock-Gateway-Timestamp': String(proof.timestampEpochMs),
        'X-RealTimeStock-Gateway-Proof': proof.proof,
        ...(envelopeNonce
            ? { 'X-RealTimeStock-Envelope-Nonce': envelopeNonce }
            : {}),
    };
}

function gateProbeEnvelope(operationId) {
    const account = {
        broker_id: 'broker-control-plane',
        account_id: 'account-control-plane',
        account_type: 'S',
    };
    return {
        schemaVersion: SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
        runId: '123e4567-e89b-42d3-a456-426614174090',
        operationId,
        nonce: '123e4567-e89b-42d3-a456-426614174092',
        request: {
            schemaVersion:
                'smart-order-manual-broker-write-request/2026-08-14.1',
            operation: 'place',
            brokerPath: '/api/v1/order/place_order',
            payload: {
                contract: {
                    security_type: 'STK',
                    region: 'TW',
                    exchange: 'TSE',
                    code: '2330',
                    target_code: null,
                },
                stock_order: {
                    action: 'Buy',
                    price: 100,
                    quantity: 1,
                    price_type: 'LMT',
                    order_type: 'ROD',
                    order_lot: 'Common',
                    account,
                },
            },
        },
        target: null,
        tradeDate: '2026-08-20',
        confirmation: {
            accountScopeSha256:
                smartOrderGateProbeAccountScopeSha256(account),
            confirmed: true,
            expectedOperation: 'place',
            maximumCommonLots: 1,
            simulation: true,
        },
        validUntilEpochMs: Date.now() + 30_000,
    };
}

describe('smart-order loopback control-plane server', () => {
    it('runs Gate manifest recomputation only through the private sidecar mutation route', async () => {
        const calls = [];
        const { capability, gateProbeCliCapability, server } = await startFixture({
            status() {
                return {
                    apiGenerationSha256: gateProbeApiGenerationSha256,
                };
            },
            async recomputeGateManifests(input) {
                calls.push(input);
                return Object.freeze({
                    stored: true,
                    state: 'observe_only',
                    manifestCount: 3,
                    manifestSha256: Object.freeze([
                        `sha256:${'1'.repeat(64)}`,
                        `sha256:${'2'.repeat(64)}`,
                        `sha256:${'3'.repeat(64)}`,
                    ]),
                    brokerWriteAuthority: false,
                    writeMasterAuthority: false,
                });
            },
        });
        const response = await strategyDrainRequest({
            capability,
            server,
            pathname: '/v1/gate-manifest/recompute',
            payload: {
                operationId: '123e4567-e89b-42d3-a456-426614174017',
            },
            requestId: '123e4567-e89b-42d3-a456-426614174018',
        });
        expect(response).toMatchObject({
            status: 200,
            body: {
                result: {
                    stored: true,
                    state: 'observe_only',
                    manifestCount: 3,
                    brokerWriteAuthority: false,
                    writeMasterAuthority: false,
                },
                brokerWriteAttempted: false,
            },
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual({
            nowEpochMs: expect.any(Number),
            operationId: '123e4567-e89b-42d3-a456-426614174017',
        });

        const invalid = await strategyDrainRequest({
            capability,
            server,
            pathname: '/v1/gate-manifest/recompute',
            payload: { operationId: 'not-a-uuid' },
            requestId: '123e4567-e89b-42d3-a456-426614174019',
        });
        expect(invalid).toMatchObject({
            status: 400,
            body: {
                code: 'invalid_request',
                brokerWriteAttempted: false,
            },
        });
        expect(calls).toHaveLength(1);
    });

    it('projects only bounded Gate probe status and fail-closes private preparation without write authority', async () => {
        const calls = [];
        const operationId = '123e4567-e89b-42d3-a456-426614174091';
        const { capability, gateProbeCliCapability, server } = await startFixture({
            status() {
                return {
                    apiGenerationSha256: gateProbeApiGenerationSha256,
                };
            },
            async gateProbeSafetyStatus() {
                return Object.freeze({
                    schemaVersion:
                        'smart-order-gate-probe-durable-result/2026-08-20.1',
                    state: 'idle',
                    unknownOperationCount: 0,
                    unresolvedOperationCount: 0,
                    terminalOperationCount: 0,
                    activeTargetCount: 0,
                    automaticRetryAllowed: false,
                    cleanupAllowed: false,
                    durableReplayProtection: true,
                    brokerAuthority: false,
                    writeMasterAuthority: false,
                });
            },
            async prepareGateProbeSafetyEnvelope(input) {
                calls.push(input);
                return Object.freeze({
                    prepared: false,
                    state: 'observe_only',
                    reason: 'gate_probe_manifest_not_eligible',
                    automaticRetryAllowed: false,
                    cleanupAllowed: false,
                    brokerWriteAttempted: false,
                    adapterAuthorityGranted: false,
                    brokerAuthority: false,
                    writeMasterAuthority: false,
                });
            },
        });
        const statusPath = '/v1/gate-probe/status';
        await expect(
            request({
                server,
                pathname: statusPath,
                headers: gatewayHeaders({
                    capability,
                    server,
                    method: 'GET',
                    pathname: statusPath,
                }),
            }),
        ).resolves.toMatchObject({
            status: 200,
            body: {
                result: {
                    state: 'idle',
                    durableReplayProtection: true,
                    brokerAuthority: false,
                    writeMasterAuthority: false,
                },
                brokerWriteAttempted: false,
                brokerAuthority: false,
                writeMasterAuthority: false,
            },
        });

        const genericEnvelope = gateProbeEnvelope(operationId);
        const genericCapabilityOnly = await strategyDrainRequest({
            capability,
            server,
            pathname: '/v1/gate-probe/prepare',
            payload: {
                cliAuthorization: issueSmartOrderGateProbeCliAuthorization({
                    capability,
                    envelope: genericEnvelope,
                    authorizedAtEpochMs: Date.now(),
                    apiGenerationSha256: gateProbeApiGenerationSha256,
                    runtimeEpochIdSha256: gateProbeRuntimeEpochSha256,
                }),
                envelope: genericEnvelope,
            },
            requestId: operationId,
        });
        expect(genericCapabilityOnly).toMatchObject({
            status: 400,
            body: {
                code: 'invalid_request',
                brokerWriteAttempted: false,
            },
        });
        expect(calls).toHaveLength(0);

        const preparedEnvelope = gateProbeEnvelope(operationId);
        const prepared = await strategyDrainRequest({
            capability,
            server,
            pathname: '/v1/gate-probe/prepare',
            payload: {
                cliAuthorization: issueSmartOrderGateProbeCliAuthorization({
                    capability: gateProbeCliCapability,
                    envelope: preparedEnvelope,
                    authorizedAtEpochMs: Date.now(),
                    apiGenerationSha256: gateProbeApiGenerationSha256,
                    runtimeEpochIdSha256: gateProbeRuntimeEpochSha256,
                }),
                envelope: preparedEnvelope,
            },
            requestId: operationId,
        });
        expect(prepared).toMatchObject({
            status: 423,
            body: {
                result: {
                    prepared: false,
                    state: 'observe_only',
                    brokerWriteAttempted: false,
                    brokerAuthority: false,
                    writeMasterAuthority: false,
                },
                brokerWriteAttempted: false,
                brokerAuthority: false,
                writeMasterAuthority: false,
            },
        });
        expect(calls).toHaveLength(1);

        const mismatchedEnvelope = gateProbeEnvelope(operationId);
        const mismatched = await strategyDrainRequest({
            capability,
            server,
            pathname: '/v1/gate-probe/prepare',
            payload: {
                cliAuthorization: issueSmartOrderGateProbeCliAuthorization({
                    capability: gateProbeCliCapability,
                    envelope: mismatchedEnvelope,
                    authorizedAtEpochMs: Date.now(),
                    apiGenerationSha256: gateProbeApiGenerationSha256,
                    runtimeEpochIdSha256: gateProbeRuntimeEpochSha256,
                }),
                envelope: mismatchedEnvelope,
            },
            requestId: '123e4567-e89b-42d3-a456-426614174093',
        });
        expect(mismatched).toMatchObject({
            status: 400,
            body: {
                code: 'invalid_request',
                brokerWriteAttempted: false,
            },
        });
        expect(calls).toHaveLength(1);
    });

    it('derives manual provenance from the pathname and keeps automation out of the manual confirmation path', async () => {
        const { capability, server } = await startFixture();
        const requestPayload = {
            schemaVersion:
                'smart-order-manual-broker-write-request/2026-08-14.1',
            operation: 'place',
            brokerPath: '/api/v1/order/place_order',
            payload: {
                contract: {
                    security_type: 'STK',
                    region: 'TW',
                    exchange: 'TSE',
                    code: '2330',
                    target_code: null,
                },
                stock_order: {
                    action: 'Sell',
                    price: 0,
                    quantity: 17,
                    price_type: 'MKT',
                    order_type: 'FOK',
                    order_lot: 'IntradayOdd',
                    daytrade_short: false,
                    account: {
                        broker_id: 'TEST',
                        account_id: 'SIMULATION',
                        account_type: 'S',
                    },
                },
            },
        };
        const manual = await strategyDrainRequest({
            capability,
            server,
            pathname:
                '/v1/trading-write/STK-MAN-PLACE-TICKET',
            payload: {
                operationId: '123e4567-e89b-42d3-a456-426614174301',
                request: requestPayload,
            },
            requestId: '123e4567-e89b-42d3-a456-426614174302',
        });
        expect(manual.status).toBe(423);
        expect(manual.body).toMatchObject({
            code: 'broker_write_gate_closed',
            classified: true,
            provenance: 'manual_user_confirmed',
            reason: 'downstream_broker_admission_required',
            automationAccountEligibility: 'disabled',
            brokerWriteAttempted: false,
            brokerWriteAuthority: false,
            writeMasterAuthority: false,
        });
        expect(JSON.stringify(manual.body)).not.toMatch(
            /TEST|SIMULATION|2330|IntradayOdd|FOK/,
        );

        const automation = await strategyDrainRequest({
            capability,
            server,
            pathname:
                '/v1/trading-write/STK-AUTO-PLACE-GRID-FOLLOW',
            payload: {
                operationId: '123e4567-e89b-42d3-a456-426614174303',
                request: requestPayload,
            },
            requestId: '123e4567-e89b-42d3-a456-426614174304',
        });
        expect(automation.status).toBe(423);
        expect(automation.body).toMatchObject({
            code: 'broker_write_gate_closed',
            classified: false,
            provenance: 'unknown',
            reason: 'automation_binding_invalid',
            brokerWriteAttempted: false,
        });
    });
    it('reads and replay-protects a Runtime-owned risk policy without granting broker authority', async () => {
        const calls = [];
        const missing = {
            schemaVersion:
                'smart-order-runtime-risk-policy-view/2026-08-14.1',
            state: 'missing',
            revision: null,
            policyHash: null,
            policy: null,
            exposureHeadsCurrent: false,
            brokerWriteAuthority: false,
            accountIdentifiersExposed: false,
            identityIdentifiersExposed: false,
        };
        const { capability, server } = await startFixture({
            async riskPolicy() {
                return missing;
            },
            async executeReplayProtectedStrategyMutation(input) {
                calls.push(input);
                return {
                    state: 'completed',
                    resultHash: `sha256:${'7'.repeat(64)}`,
                    result: {
                        ...missing,
                        state: 'reconciliation_required',
                        revision: 0,
                        policyHash: `sha256:${'8'.repeat(64)}`,
                        policy: { revision: 0 },
                        publishedAtEpochMs: 1_786_380_000_100,
                        runtimeState: 'reconciling',
                        runtimeRevision: 2,
                        dispatchAllowed: false,
                        replayed: false,
                    },
                };
            },
        });
        const read = await request({
            server,
            pathname: '/v1/risk/policy',
            headers: gatewayHeaders({
                capability,
                server,
                method: 'GET',
                pathname: '/v1/risk/policy',
            }),
        });
        expect(read).toMatchObject({ status: 200, body: missing });
        const operationId = '123e4567-e89b-42d3-a456-426614174201';
        const response = await strategyDrainRequest({
            capability,
            server,
            method: 'PUT',
            pathname: '/v1/risk/policy',
            requestId: operationId,
            payload: {
                expectedRevision: null,
                operationId,
                policy: {
                    schemaVersion:
                        'smart-order-runtime-risk-policy-editor/2026-08-14.1',
                    buyFeeBps: 15,
                    minimumBuyFeeMinorUnits: 2000,
                    cashBufferMinorUnits: 10000,
                    accountLimits: {
                        quantityShares: 50_000,
                        notionalMinorUnits: 50_000_000,
                        cashMinorUnits: 55_000_000,
                        positionShares: 40_000,
                        orderCount: 20,
                    },
                    identityLimits: {
                        quantityShares: 100_000,
                        notionalMinorUnits: 100_000_000,
                        cashMinorUnits: 110_000_000,
                        positionShares: 80_000,
                        orderCount: 40,
                    },
                    accountDailyLossLimitMinorUnits: 1_000_000,
                    identityDailyLossLimitMinorUnits: 2_000_000,
                },
            },
        });
        expect(response).toMatchObject({
            status: 200,
            body: {
                brokerWriteAttempted: false,
                result: {
                    state: 'reconciliation_required',
                    brokerWriteAuthority: false,
                    dispatchAllowed: false,
                },
            },
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            requestId: operationId,
            operationKind: 'risk_policy_publish',
            mutation: {
                kind: 'risk_policy_publish',
                expectedRevision: null,
            },
        });
        expect(calls[0].mutation).not.toHaveProperty('runtimeEpochId');
        expect(calls[0].mutation).not.toHaveProperty('senderFence');
    });

    it('projects reason-specific manual resolution and routes unique-final acknowledgement through replay protection', async () => {
        const calls = [];
        const projection = {
            schemaVersion:
                'smart-order-manual-resolution-list/2026-08-20.1',
            policySchemaVersion:
                'smart-order-manual-resolution/2026-08-11.6',
            strategyId: 'strategy-manual',
            strategyRevision: 4,
            strategyState: 'manual_intervention',
            cases: [
                {
                    resolutionKey: `sha256:${'1'.repeat(64)}`,
                    reasonCode: 'BROKER_OUTCOME_UNKNOWN',
                    caseRevision: 0,
                    state: 'open',
                    requiredEvidence: [
                        'broker_full_orders_trades_deals',
                        'broker_position_and_working_set',
                        'canonical_broker_correlation',
                    ],
                    allowedOperations: [
                        'apply_unique_final_evidence',
                        'break_glass_relinquish',
                        'remain_open',
                    ],
                    executableOperations: [
                        'apply_unique_final_evidence',
                        'remain_open',
                    ],
                    uniqueFinalReady: true,
                    uniqueFinalEvidenceHash: `sha256:${'2'.repeat(64)}`,
                    breakGlassAllowed: true,
                    oldIntentDisposition: 'never_resend',
                    updatedAtEpochMs: 1_786_380_000_100,
                    accountIdentifiersExposed: false,
                    entityIdentifiersExposed: false,
                    brokerWriteAuthority: false,
                },
            ],
            genericResumeAllowed: false,
            brokerWriteAuthority: false,
        };
        const result = {
            schemaVersion:
                'smart-order-manual-resolution-result/2026-08-20.1',
            strategyId: 'strategy-manual',
            strategyState: 'paused',
            strategyRevision: 5,
            resolutionState: 'resolved',
            resolutionRevision: 1,
            uniqueFinalEvidenceHash: `sha256:${'3'.repeat(64)}`,
            originalIntentState: 'terminal',
            originalIntentRedispatchAllowed: false,
            safetyBlockerCount: 1,
            rearmSupersededCount: 0,
            brokerWriteAttempted: false,
            brokerAuthorityGranted: false,
        };
        const { capability, server } = await startFixture({
            async listManualResolutionCases(input) {
                expect(input).toEqual({ strategyId: 'strategy-manual' });
                return projection;
            },
            async executeReplayProtectedStrategyMutation(input) {
                calls.push(input);
                return {
                    state: 'completed',
                    resultHash: `sha256:${'4'.repeat(64)}`,
                    result,
                };
            },
        });
        await expect(
            request({
                server,
                pathname: '/v1/strategies/strategy-manual/resolutions',
                headers: gatewayHeaders({
                    capability,
                    server,
                    method: 'GET',
                    pathname:
                        '/v1/strategies/strategy-manual/resolutions',
                }),
            }),
        ).resolves.toMatchObject({ status: 200, body: projection });
        const operationId =
            '123e4567-e89b-42d3-a456-426614174251';
        await expect(
            strategyDrainRequest({
                capability,
                server,
                pathname:
                    '/v1/strategies/strategy-manual/resolve-final',
                requestId: operationId,
                payload: {
                    expectedRevision: 4,
                    operationId,
                    resolutionKey: `sha256:${'1'.repeat(64)}`,
                    userAcknowledgedFinalEvidence: true,
                },
            }),
        ).resolves.toMatchObject({
            status: 200,
            body: {
                brokerWriteAttempted: false,
                result: {
                    originalIntentRedispatchAllowed: false,
                    brokerWriteAttempted: false,
                    brokerAuthorityGranted: false,
                },
            },
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            requestId: operationId,
            operationKind: 'manual_resolution_apply_unique_final',
            mutation: {
                expectedRevision: 4,
                kind: 'manual_resolution_apply_unique_final',
                resolutionKey: `sha256:${'1'.repeat(64)}`,
                strategyId: 'strategy-manual',
                userAcknowledgedFinalEvidence: true,
            },
        });
        expect(calls[0].mutation).not.toHaveProperty('runtimeEpochId');
        expect(calls[0].mutation).not.toHaveProperty('senderFence');
    });

    it('reads and replay-protects the durable kill-switch arbiter without granting broker authority', async () => {
        const calls = [];
        const initial = {
            schemaVersion: 'smart-order-kill-switch-arbiter/2026-08-12.1',
            arbiterRevision: 0,
            switches: {
                pause_new_exposure: {
                    enabled: false,
                    revision: 0,
                    updatedAtEpochMs: 0,
                    reasonCode: 'initial_disabled',
                },
                pause_automation: {
                    enabled: false,
                    revision: 0,
                    updatedAtEpochMs: 0,
                    reasonCode: 'initial_disabled',
                },
                emergency_block_all_writes: {
                    enabled: false,
                    revision: 0,
                    updatedAtEpochMs: 0,
                    reasonCode: 'initial_disabled',
                },
            },
            enabled: [],
            denyUnionActive: false,
            brokerWriteAuthority: false,
            accountIdentifiersExposed: false,
            identityIdentifiersExposed: false,
        };
        const { capability, server } = await startFixture({
            async killSwitchStatus() {
                return initial;
            },
            async executeReplayProtectedStrategyMutation(input) {
                calls.push(input);
                if (input.mutation.expectedArbiterRevision === 7) {
                    return {
                        state: 'failed',
                        resultHash: `sha256:${'8'.repeat(64)}`,
                        resultStatus: 409,
                        result: {
                            code: 'stale_revision',
                            status: 409,
                        },
                    };
                }
                return {
                    state: 'completed',
                    resultHash: `sha256:${'9'.repeat(64)}`,
                    result: {
                        ...initial,
                        arbiterRevision: 1,
                        switches: {
                            ...initial.switches,
                            emergency_block_all_writes: {
                                enabled: true,
                                revision: 1,
                                updatedAtEpochMs: 1_786_380_000_200,
                                reasonCode: 'operator_emergency',
                            },
                        },
                        enabled: ['emergency_block_all_writes'],
                        denyUnionActive: true,
                        changed: true,
                        replayed: false,
                    },
                };
            },
        });
        await expect(
            request({
                server,
                pathname: '/v1/risk/kill-switch',
                headers: gatewayHeaders({
                    capability,
                    server,
                    method: 'GET',
                    pathname: '/v1/risk/kill-switch',
                }),
            }),
        ).resolves.toMatchObject({
            status: 200,
            body: {
                arbiterRevision: 0,
                enabled: [],
                brokerWriteAuthority: false,
            },
        });
        const operationId = '123e4567-e89b-42d3-a456-426614174208';
        const response = await strategyDrainRequest({
            capability,
            server,
            method: 'PUT',
            pathname: '/v1/risk/kill-switch',
            requestId: operationId,
            payload: {
                enabled: true,
                expectedArbiterRevision: 0,
                operationId,
                reasonCode: 'operator_emergency',
                switchName: 'emergency_block_all_writes',
            },
        });
        expect(response).toMatchObject({
            status: 200,
            body: {
                brokerWriteAttempted: false,
                result: {
                    arbiterRevision: 1,
                    enabled: ['emergency_block_all_writes'],
                    brokerWriteAuthority: false,
                },
            },
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            requestId: operationId,
            operationKind: 'risk_kill_switch',
            mutation: {
                enabled: true,
                expectedArbiterRevision: 0,
                kind: 'risk_kill_switch',
                reasonCode: 'operator_emergency',
                switchName: 'emergency_block_all_writes',
            },
        });
        expect(calls[0].mutation).not.toHaveProperty('runtimeEpochId');
        expect(calls[0].mutation).not.toHaveProperty('senderFence');

        const staleOperationId =
            '123e4567-e89b-42d3-a456-426614174210';
        await expect(
            strategyDrainRequest({
                capability,
                server,
                method: 'PUT',
                pathname: '/v1/risk/kill-switch',
                requestId: staleOperationId,
                payload: {
                    enabled: true,
                    expectedArbiterRevision: 7,
                    operationId: staleOperationId,
                    reasonCode: 'operator_pause',
                    switchName: 'pause_new_exposure',
                },
            }),
        ).resolves.toMatchObject({
            status: 409,
            body: {
                code: 'stale_revision',
                resultHash: `sha256:${'8'.repeat(64)}`,
                brokerWriteAttempted: false,
            },
        });
        expect(calls).toHaveLength(2);

        await expect(
            strategyDrainRequest({
                capability,
                server,
                method: 'PUT',
                pathname: '/v1/risk/kill-switch',
                requestId:
                    '123e4567-e89b-42d3-a456-426614174211',
                payload: {
                    enabled: true,
                    expectedArbiterRevision: 1,
                    operationId: 'invalid-operation-id',
                    reasonCode: 'operator_pause',
                    switchName: 'pause_new_exposure',
                },
            }),
        ).resolves.toMatchObject({
            status: 422,
            body: {
                code: 'operation_id_invalid',
                brokerWriteAttempted: false,
            },
        });
        expect(calls).toHaveLength(2);
    });

    it('keeps all four drain operations on separate authenticated routes', async () => {
        const calls = [];
        const { capability, server } = await startFixture({
            async executeReplayProtectedStrategyMutation(input) {
                calls.push(['replay-protected', input]);
                const brokerCancel =
                    input.mutation.kind === 'cancel_broker_order';
                const result = brokerCancel
                    ? {
                          brokerAuthorityGranted: false,
                          brokerWriteAttempted: false,
                          cancelIntentState: 'prepared',
                          dispatchAllowed: false,
                          replayed: false,
                          strategyId: input.mutation.strategyId,
                          strategyRevision: input.mutation.expectedRevision,
                          targetState: 'submitted',
                          userConfirmationConsumed: true,
                      }
                    : {
                          strategyId: input.mutation.strategyId,
                          strategyKind: 'quick',
                          state: 'cancel_pending',
                          definitionHash: `sha256:${'1'.repeat(64)}`,
                          accountBound: true,
                          createdAtEpochMs: 1,
                          updatedAtEpochMs: 2,
                          revision: input.mutation.expectedRevision + 1,
                      };
                return {
                    state: 'completed',
                    result,
                    resultHash: `sha256:${'2'.repeat(64)}`,
                };
            },
            async drainPreparedIntentProvenUnsent(input) {
                calls.push(['drain', input]);
                return {
                    strategyId: input.strategyId,
                    brokerWriteAttempted: false,
                    brokerAuthorityGranted: false,
                };
            },
            async prepareProtectionRelinquishment(input) {
                calls.push(['prepare', input]);
                return {
                    strategyId: input.strategyId,
                    challengeId: input.operationId,
                    brokerWriteAttempted: false,
                    relinquished: false,
                };
            },
            async commitProtectionRelinquishment(input) {
                calls.push(['commit', input]);
                return {
                    strategyId: input.strategyId,
                    brokerWriteAttempted: false,
                    relinquished: true,
                    unmonitored: true,
                };
            },
        });
        const strategyId = 'strategy-drain';
        const operationIds = [
            '123e4567-e89b-42d3-a456-426614174191',
            '123e4567-e89b-42d3-a456-426614174192',
            '123e4567-e89b-42d3-a456-426614174193',
            '123e4567-e89b-42d3-a456-426614174194',
            '123e4567-e89b-42d3-a456-426614174195',
        ];
        const challengeId = operationIds[1];
        const responses = [];
        responses.push(
            await strategyDrainRequest({
                capability,
                server,
                pathname: `/v1/strategies/${strategyId}/cancel`,
                requestId: operationIds[3],
                payload: {
                    expectedRevision: 4,
                    operationId: operationIds[3],
                },
            }),
        );
        responses.push(
            await strategyDrainRequest({
                capability,
                server,
                pathname: `/v1/strategies/${strategyId}/cancel-broker-order`,
                requestId: operationIds[4],
                payload: {
                    expectedRevision: 4,
                    operationId: operationIds[4],
                    userConfirmationAcknowledged: true,
                },
            }),
        );
        responses.push(
            await strategyDrainRequest({
                capability,
                server,
                pathname: `/v1/strategies/${strategyId}/drain-prepared`,
                requestId: operationIds[0],
                payload: {
                    expectedRevision: 4,
                    operationId: operationIds[0],
                    userConfirmationAcknowledged: true,
                },
            }),
        );
        responses.push(
            await strategyDrainRequest({
                capability,
                server,
                pathname: `/v1/strategies/${strategyId}/relinquish-protection-prepare`,
                requestId: operationIds[1],
                payload: {
                    expectedRevision: 4,
                    operationId: operationIds[1],
                    operatorAcknowledgedManualHandoff: true,
                },
            }),
        );
        responses.push(
            await strategyDrainRequest({
                capability,
                server,
                pathname: `/v1/strategies/${strategyId}/relinquish-protection-commit`,
                requestId: operationIds[2],
                payload: {
                    challengeId,
                    expectedRevision: 4,
                    operationId: operationIds[2],
                    operatorAcknowledgedManualHandoff: true,
                },
            }),
        );
        expect(responses.map((response) => response.status)).toEqual([
            200, 200, 200, 200, 200,
        ]);
        expect(
            responses.every(
                (response) => response.body.brokerWriteAttempted === false,
            ),
        ).toBe(true);
        expect(calls.map(([kind]) => kind)).toEqual([
            'replay-protected',
            'replay-protected',
            'drain',
            'prepare',
            'commit',
        ]);
        expect(calls[0][1].mutation).toMatchObject({
            kind: 'cancel',
            strategyId,
        });
        expect(calls[1][1].mutation).toMatchObject({
            kind: 'cancel_broker_order',
            strategyId,
            userConfirmationAcknowledged: true,
        });
        expect(calls[4][1]).toMatchObject({
            challengeId,
            strategyId,
            expectedRevision: 4,
            operatorAcknowledgedManualHandoff: true,
        });
    });

    it('binds a paused protective remainder resume to private current contract evidence', async () => {
        const calls = [];
        const strategyConfirmationControlPlaneAuthority = Object.freeze({});
        const contractEvidence = Object.freeze({ issued: true });
        const strategyId = 'strategy-existing-position-remainder';
        const operationId = '123e4567-e89b-42d3-a456-426614174196';
        const runtimeController = {
            async getStrategy() {
                return {
                    strategyId,
                    strategyKind: 'stop_take',
                    state: 'paused',
                    revision: 4,
                };
            },
            async strategyProtectionRearmEvidenceContext(input) {
                expect(input).toEqual({
                    controlPlaneAuthority:
                        strategyConfirmationControlPlaneAuthority,
                    expectedRevision: 4,
                    strategyId,
                });
                return {
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    brokerWriteAuthority: false,
                    contractKey: 'TSE:STK:2330',
                    decisionTradingDate: '2026-08-11',
                    expectedRevision: 4,
                    fixedAtrRequired: false,
                    strategyDefinitionHash: `sha256:${'1'.repeat(64)}`,
                    strategyId,
                };
            },
            async executeReplayProtectedStrategyMutation(input) {
                calls.push(input);
                return {
                    state: 'completed',
                    resultHash: `sha256:${'2'.repeat(64)}`,
                    result: {
                        strategyId,
                        strategyKind: 'stop_take',
                        state: 'monitoring',
                        definitionHash: `sha256:${'1'.repeat(64)}`,
                        accountBound: true,
                        createdAtEpochMs: 1,
                        updatedAtEpochMs: 2,
                        revision: 5,
                    },
                };
            },
        };
        const { capability, server } = await startFixture(runtimeController, {
            strategyConfirmationControlPlaneAuthority,
            async strategyConfirmationEvidenceProvider(input) {
                expect(input).toMatchObject({
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    contractKey: 'TSE:STK:2330',
                    expectedRevision: 4,
                    fixedAtrRequired: false,
                    strategyId,
                });
                return contractEvidence;
            },
        });
        await expect(
            strategyDrainRequest({
                capability,
                server,
                pathname: `/v1/strategies/${strategyId}/resume`,
                requestId: operationId,
                payload: {
                    activationPolicyAcknowledged: true,
                    expectedRevision: 4,
                    operationId,
                },
            }),
        ).resolves.toMatchObject({
            status: 200,
            body: {
                brokerWriteAttempted: false,
                result: { state: 'monitoring', revision: 5 },
            },
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            operationKind: 'strategy_resume',
            mutation: {
                activationPolicyAcknowledged: true,
                contractEvidence,
                controlPlaneAuthority:
                    strategyConfirmationControlPlaneAuthority,
                expectedRevision: 4,
                kind: 'resume',
                strategyId,
            },
        });
    });

    it('derives every multi-condition monitor contract before Runtime confirmation', async () => {
        const calls = [];
        const evidenceCalls = [];
        const strategyConfirmationControlPlaneAuthority = Object.freeze({});
        const evidences = new Map(
            ['TSE:STK:2330', 'TSE:STK:2303', 'OTC:STK:6488'].map(
                (contractKey) => [contractKey, Object.freeze({ contractKey })],
            ),
        );
        const strategyId = 'multi-confirmation-control-plane';
        const operationId = '123e4567-e89b-42d3-a456-426614174296';
        const { capability, server } = await startFixture(
            {
                async getStrategy() {
                    return {
                        strategyId,
                        strategyKind: 'multi_condition',
                        state: 'draft',
                        revision: 1,
                        definition: {
                            parameters: {
                                order: { contractKey: 'TSE:STK:2330' },
                                conditions: [
                                    { monitorContractKey: 'TSE:STK:2303' },
                                    { monitorContractKey: 'OTC:STK:6488' },
                                ],
                            },
                        },
                    };
                },
                async executeReplayProtectedStrategyMutation(input) {
                    calls.push(input);
                    return {
                        state: 'completed',
                        resultHash: `sha256:${'1'.repeat(64)}`,
                        result: {
                            schemaVersion:
                                'smart-order-canonical-confirmation/2026-08-20.1',
                            state: 'previewed',
                            snapshotHash: `sha256:${'2'.repeat(64)}`,
                            strategyId,
                            strategyKind: 'multi_condition',
                            strategyRevision: 1,
                            resolvedDefinitionHash: `sha256:${'3'.repeat(64)}`,
                            fixedAccountLabel: '固定股票帳號（Runtime 已驗證）',
                            contract: {},
                            position: null,
                            fixedAtrSnapshot: null,
                            riskRevision: 1,
                            modeGeneration: 'generation',
                            runtimeRevision: 1,
                            validUntilEpochMs: Date.now() + 5_000,
                            warnings: [],
                            brokerWriteAttempted: false,
                            brokerWriteAuthority: false,
                            accountIdentifiersExposed: false,
                        },
                    };
                },
            },
            {
                strategyConfirmationControlPlaneAuthority,
                async strategyConfirmationEvidenceProvider(input) {
                    evidenceCalls.push(input.contractKey);
                    return evidences.get(input.contractKey);
                },
            },
        );
        const response = await strategyDrainRequest({
            capability,
            server,
            pathname: `/v1/strategies/${strategyId}/confirmation-preview`,
            requestId: operationId,
            payload: {
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                basisSelection: null,
                confirmationId: operationId,
                expectedRevision: 1,
                operationId,
            },
        });
        expect(response).toMatchObject({
            status: 200,
            body: { brokerWriteAttempted: false },
        });
        expect(evidenceCalls).toEqual([
            'TSE:STK:2330',
            'TSE:STK:2303',
            'OTC:STK:6488',
        ]);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            operationKind: 'strategy_confirmation_preview',
            mutation: {
                contractEvidence: evidences.get('TSE:STK:2330'),
                monitorContractEvidence: [
                    evidences.get('TSE:STK:2303'),
                    evidences.get('OTC:STK:6488'),
                ],
                controlPlaneAuthority:
                    strategyConfirmationControlPlaneAuthority,
                kind: 'strategy_confirmation_preview',
                strategyId,
            },
        });
    });

    it('derives distinct parent and child contract evidence before parent-child confirmation', async () => {
        const calls = [];
        const evidenceCalls = [];
        const strategyConfirmationControlPlaneAuthority = Object.freeze({});
        const parentEvidence = Object.freeze({
            contractKey: 'TSE:STK:2330',
        });
        const childEvidence = Object.freeze({
            contractKey: 'TSE:STK:2303',
        });
        const strategyId = 'parent-child-confirmation-control-plane';
        const operationId = '123e4567-e89b-42d3-a456-426614174297';
        const { capability, server } = await startFixture(
            {
                async getStrategy() {
                    return {
                        strategyId,
                        strategyKind: 'parent_child',
                        state: 'draft',
                        revision: 1,
                        definition: {
                            parameters: {
                                parent: {
                                    monitorContractKey: 'TSE:STK:2330',
                                    order: { contractKey: 'TSE:STK:2330' },
                                },
                                child: {
                                    monitorContractKey: 'TSE:STK:2303',
                                    order: { contractKey: 'TSE:STK:2303' },
                                },
                            },
                        },
                    };
                },
                async executeReplayProtectedStrategyMutation(input) {
                    calls.push(input);
                    return {
                        state: 'completed',
                        resultHash: `sha256:${'4'.repeat(64)}`,
                        result: {
                            schemaVersion:
                                'smart-order-canonical-confirmation/2026-08-20.1',
                            state: 'previewed',
                            snapshotHash: `sha256:${'5'.repeat(64)}`,
                            strategyId,
                            strategyKind: 'parent_child',
                            strategyRevision: 1,
                            resolvedDefinitionHash: `sha256:${'6'.repeat(64)}`,
                            fixedAccountLabel:
                                '固定股票帳號（Runtime 已驗證）',
                            contract: {},
                            childContract: {},
                            position: null,
                            fixedAtrSnapshot: null,
                            riskRevision: 1,
                            modeGeneration: 'generation',
                            runtimeRevision: 1,
                            validUntilEpochMs: Date.now() + 5_000,
                            warnings: [],
                            brokerWriteAttempted: false,
                            brokerWriteAuthority: false,
                            accountIdentifiersExposed: false,
                        },
                    };
                },
            },
            {
                strategyConfirmationControlPlaneAuthority,
                async strategyConfirmationEvidenceProvider(input) {
                    evidenceCalls.push(input.contractKey);
                    return input.contractKey === 'TSE:STK:2330'
                        ? parentEvidence
                        : childEvidence;
                },
            },
        );
        const response = await strategyDrainRequest({
            capability,
            server,
            pathname: `/v1/strategies/${strategyId}/confirmation-preview`,
            requestId: operationId,
            payload: {
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                basisSelection: null,
                confirmationId: operationId,
                expectedRevision: 1,
                operationId,
            },
        });
        expect(response).toMatchObject({
            status: 200,
            body: { brokerWriteAttempted: false },
        });
        expect(evidenceCalls).toEqual([
            'TSE:STK:2330',
            'TSE:STK:2303',
        ]);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            operationKind: 'strategy_confirmation_preview',
            mutation: {
                contractEvidence: parentEvidence,
                monitorContractEvidence: [childEvidence],
                controlPlaneAuthority:
                    strategyConfirmationControlPlaneAuthority,
                kind: 'strategy_confirmation_preview',
                strategyId,
            },
        });
    });

    it('routes a confirmed broker quantity reduction through replay-protected Runtime admission', async () => {
        const calls = [];
        const { capability, server } = await startFixture({
            async executeReplayProtectedStrategyMutation(input) {
                calls.push(input);
                return {
                    state: 'completed',
                    resultHash: `sha256:${'2'.repeat(64)}`,
                    result: {
                        brokerAuthorityGranted: false,
                        brokerWriteAttempted: false,
                        dispatchAllowed: false,
                        quantityShares: input.mutation.quantityShares,
                        replayed: false,
                        strategyId: input.mutation.strategyId,
                        strategyRevision: input.mutation.expectedRevision,
                        targetState: 'submitted',
                        updateIntentState: 'prepared',
                        userConfirmationConsumed: true,
                    },
                };
            },
        });
        const operationId = '123e4567-e89b-42d3-a456-426614174196';
        const response = await strategyDrainRequest({
            capability,
            server,
            pathname: '/v1/strategies/strategy-update/update-broker-order',
            requestId: operationId,
            payload: {
                expectedRevision: 7,
                operationId,
                quantityShares: 500,
                userConfirmationAcknowledged: true,
            },
        });
        expect(response).toMatchObject({
            status: 200,
            body: {
                brokerWriteAttempted: false,
                result: {
                    brokerAuthorityGranted: false,
                    dispatchAllowed: false,
                    quantityShares: 500,
                    updateIntentState: 'prepared',
                },
            },
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            operationKind: 'broker_order_update_request',
            mutation: {
                expectedRevision: 7,
                kind: 'update_broker_order',
                quantityShares: 500,
                strategyId: 'strategy-update',
                userConfirmationAcknowledged: true,
            },
        });
    });
    it('publishes the exact handoff barrier before durable stop and retains it through cleanup', async () => {
        const order = [];
        let precommitBinding;
        let committedBinding;
        const apiGenerationSha256 = `sha256:${'a'.repeat(64)}`;
        const runtimeEpochIdSha256 = `sha256:${createHash('sha256')
            .update(runtimeEpochId)
            .digest('hex')}`;
        const { capability, server } = await startFixture(
            {
                status: () => ({
                    role: 'primary',
                    state: 'quiescing',
                    revision: 4,
                    apiGenerationSha256,
                    dispatchAllowed: false,
                    watchdog: { repositoryReady: true },
                }),
                async commitLifecycleStop() {
                    expect(order).toEqual(['precommit']);
                    order.push('commit');
                    return {
                        state: 'stopped',
                        revision: 5,
                        operation: 'graceful_stop',
                        runtimeEpochIdSha256,
                        apiGenerationSha256,
                        dispatchAllowed: false,
                        brokerWriteAttempted: false,
                    };
                },
            },
            {
                async onLifecycleStopPrecommit(binding) {
                    precommitBinding = binding;
                    order.push('precommit');
                },
                async onLifecycleStopAborted() {
                    order.push('abort');
                },
                async onLifecycleStopCommitted(binding) {
                    committedBinding = binding;
                    order.push('cleanup');
                },
            },
        );
        const response = await lifecycleStopRequest({ capability, server });
        expect(response).toMatchObject({
            status: 202,
            body: {
                state: 'stopped',
                committed: true,
                stopRevision: 5,
                cleanupPending: true,
                dispatchAllowed: false,
                brokerWriteAttempted: false,
            },
        });
        await new Promise((resolve) => setImmediate(resolve));
        expect(order).toEqual(['precommit', 'commit', 'cleanup']);
        expect(precommitBinding).toMatchObject({
            operation: 'graceful_stop',
            runtimeEpochIdSha256,
            apiGenerationSha256,
            stopRevision: 5,
        });
        expect(committedBinding).toMatchObject(precommitBinding);
    });

    it('runs committed cleanup even when the lifecycle caller loses the HTTP response', async () => {
        const order = [];
        let releaseCommit;
        let commitEntered;
        let cleanupCompleted;
        let outgoing;
        const commitEnteredPromise = new Promise((resolve) => {
            commitEntered = resolve;
        });
        const releaseCommitPromise = new Promise((resolve) => {
            releaseCommit = resolve;
        });
        const cleanupCompletedPromise = new Promise((resolve) => {
            cleanupCompleted = resolve;
        });
        const apiGenerationSha256 = `sha256:${'c'.repeat(64)}`;
        const runtimeEpochIdSha256 = `sha256:${createHash('sha256')
            .update(runtimeEpochId)
            .digest('hex')}`;
        const { capability, server } = await startFixture(
            {
                status: () => ({
                    role: 'primary',
                    state: 'quiescing',
                    revision: 10,
                    apiGenerationSha256,
                    dispatchAllowed: false,
                    watchdog: { repositoryReady: true },
                }),
                async commitLifecycleStop() {
                    order.push('commit-entered');
                    commitEntered();
                    await releaseCommitPromise;
                    order.push('commit-returned');
                    return {
                        state: 'stopped',
                        revision: 11,
                        operation: 'graceful_stop',
                        runtimeEpochIdSha256,
                        apiGenerationSha256,
                        dispatchAllowed: false,
                        brokerWriteAttempted: false,
                    };
                },
            },
            {
                async onLifecycleStopPrecommit() {
                    order.push('precommit');
                },
                async onLifecycleStopAborted() {
                    order.push('abort');
                },
                async onLifecycleStopCommitted() {
                    order.push('cleanup');
                    cleanupCompleted();
                },
            },
        );
        const responseLost = lifecycleStopRequest({
            capability,
            server,
            requestId: '123e4567-e89b-42d3-a456-426614174096',
            onRequest(request) {
                outgoing = request;
            },
        }).then(
            () => null,
            (error) => error,
        );
        await commitEnteredPromise;
        outgoing.destroy(new Error('fixture lifecycle response lost'));
        releaseCommit();
        await cleanupCompletedPromise;
        await expect(responseLost).resolves.toMatchObject({
            message: 'fixture lifecycle response lost',
        });
        expect(order).toEqual([
            'precommit',
            'commit-entered',
            'commit-returned',
            'cleanup',
        ]);
    });

    it('removes the exact pre-commit barrier only when durable stop is blocked', async () => {
        const order = [];
        let precommitBinding;
        const apiGenerationSha256 = `sha256:${'b'.repeat(64)}`;
        const { capability, server } = await startFixture(
            {
                status: () => ({
                    role: 'primary',
                    state: 'quiescing',
                    revision: 8,
                    apiGenerationSha256,
                    dispatchAllowed: false,
                    watchdog: { repositoryReady: true },
                }),
                async commitLifecycleStop() {
                    expect(order).toEqual(['precommit']);
                    order.push('commit');
                    const error = new Error('fixture blocker');
                    error.name = 'RuntimeStopBlockedError';
                    throw error;
                },
            },
            {
                async onLifecycleStopPrecommit(binding) {
                    precommitBinding = binding;
                    order.push('precommit');
                },
                async onLifecycleStopAborted(binding) {
                    expect(binding).toEqual(precommitBinding);
                    order.push('abort');
                },
                async onLifecycleStopCommitted() {
                    order.push('cleanup');
                },
            },
        );
        const response = await lifecycleStopRequest({
            capability,
            server,
            requestId: '123e4567-e89b-42d3-a456-426614174097',
        });
        expect(response).toMatchObject({
            status: 409,
            body: {
                committed: false,
                cleanupPending: false,
                brokerWriteAttempted: false,
            },
        });
        expect(order).toEqual(['precommit', 'commit', 'abort']);
    });

    it('binds only IPv4 loopback and authenticates the minimal health result', async () => {
        const { capability, server } = await startFixture();
        expect(server.host).toBe('127.0.0.1');
        const unauthenticated = await request({
            server,
            pathname: '/health',
            headers: { Host: `${server.host}:${server.port}` },
        });
        expect(unauthenticated).toMatchObject({
            status: 403,
            body: { code: 'origin_or_fetch_metadata_not_allowed' },
        });
        const response = await request({
            server,
            pathname: '/health',
            headers: gatewayHeaders({
                capability,
                server,
                method: 'GET',
                pathname: '/health',
            }),
        });
        expect(response).toMatchObject({
            status: 200,
            body: { status: 'ok', writeEnabled: false },
        });
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('returns only redacted runtime status for a valid gateway proof', async () => {
        const { capability, server } = await startFixture();
        const response = await request({
            server,
            pathname: '/v1/status',
            headers: gatewayHeaders({
                capability,
                server,
                method: 'GET',
                pathname: '/v1/status',
            }),
        });
        expect(response).toMatchObject({
            status: 200,
            body: {
                runtime: {
                    role: 'primary',
                    state: 'reconciling',
                    repositoryReady: true,
                    dispatchAllowedByRepository: false,
                },
                secretValuesExposed: false,
            },
        });
        expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
        expect(JSON.stringify(response.body)).not.toContain(
            capability.toString('base64url'),
        );
        expect(
            verifySmartOrderControlPlaneResponseProof({
                capability,
                runtimeEpochId,
                sidecarAuthority: `${server.host}:${server.port}`,
                requestId: response.headers[
                    'x-realtimestock-response-request-id'
                ],
                method: 'GET',
                pathname: '/v1/status',
                requestBodySha256:
                    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                statusCode: response.status,
                contentType: response.headers['content-type'],
                bodyBytes: response.rawBody,
                proof: response.headers['x-realtimestock-response-proof'],
                bodySha256:
                    response.headers[
                        'x-realtimestock-response-body-sha256'
                    ],
            }),
        ).toBe(true);
    });

    it('keeps public trading readiness false with the exact missing deny-union even when the repository reports ready', async () => {
        const { capability, server } = await startFixture({
            status: () => ({
                role: 'primary',
                state: 'ready',
                dispatchAllowed: true,
                apiGenerationSha256: `sha256:${'a'.repeat(64)}`,
                watchdog: { repositoryReady: true },
            }),
        });
        const response = await request({
            server,
            pathname: '/v1/readiness',
            headers: gatewayHeaders({
                capability,
                server,
                method: 'GET',
                pathname: '/v1/readiness',
            }),
        });
        expect(response).toMatchObject({
            status: 200,
            body: {
                ready: false,
                writeMaster: 'disabled',
                runtime: {
                    state: 'ready',
                    repositoryReady: true,
                    dispatchAllowedByRepository: true,
                },
                quote: {
                    state: 'unverified',
                    authoritativeForActivation: false,
                },
            },
        });
        expect(response.body.blockers).toEqual([
            'account_reconciliation:missing',
            'calendar:missing',
            'canonical_pnl:missing',
            'canonical_risk:missing',
            'contract:missing',
            'external_working_visibility:missing',
            'fixed_account:missing',
            'fresh_quote:missing',
            'gate_manifest:missing',
            'global_resources:missing',
            'identity:missing',
            'mode_api_attestation:missing',
            'repository_integrity:missing',
            'single_writer_fence:missing',
            'trade_subscription:missing',
            'unknown_intent_clear:missing',
            'production_readiness_authority_unintegrated',
            'write_master_disabled',
        ]);
        expect(JSON.stringify(response.body)).not.toMatch(
            /account-must-not-leak|broker-must-not-leak|capability-must-not-leak/,
        );
    });

    it('projects the private current quote head without granting activation or write readiness', async () => {
        const asOfExchangeTime = '2026-08-21T01:02:03.000Z';
        const { capability, server } = await startFixture(
            {
                status: () => ({
                    role: 'primary',
                    state: 'ready',
                    dispatchAllowed: true,
                    watchdog: { repositoryReady: true },
                }),
            },
            {
                quoteReadinessProvider: () =>
                    Object.freeze({
                        state: 'fresh',
                        asOfExchangeTime,
                        authoritativeForActivation: false,
                    }),
            },
        );
        const response = await request({
            server,
            pathname: '/v1/readiness',
            headers: gatewayHeaders({
                capability,
                server,
                method: 'GET',
                pathname: '/v1/readiness',
            }),
        });
        expect(response).toMatchObject({
            status: 200,
            body: {
                ready: false,
                writeMaster: 'disabled',
                quote: {
                    state: 'fresh',
                    asOfExchangeTime,
                    authoritativeForActivation: false,
                },
            },
        });
    });

    it('fails closed when a quote provider omits the eligible exchange time or returns an accessor', async () => {
        let accessorReads = 0;
        const malformedProviders = [
            () =>
                Object.freeze({
                    state: 'fresh',
                    asOfExchangeTime: null,
                    authoritativeForActivation: false,
                }),
            () => {
                const result = {
                    state: 'stale',
                    authoritativeForActivation: false,
                };
                Object.defineProperty(result, 'asOfExchangeTime', {
                    enumerable: true,
                    get() {
                        accessorReads += 1;
                        return '2026-08-21T01:02:03.000Z';
                    },
                });
                return result;
            },
        ];
        for (const quoteReadinessProvider of malformedProviders) {
            const { capability, server } = await startFixture(undefined, {
                quoteReadinessProvider,
            });
            const response = await request({
                server,
                pathname: '/v1/readiness',
                headers: gatewayHeaders({
                    capability,
                    server,
                    method: 'GET',
                    pathname: '/v1/readiness',
                }),
            });
            expect(response.body.quote).toEqual({
                state: 'unverified',
                asOfExchangeTime: null,
                authoritativeForActivation: false,
            });
        }
        expect(accessorReads).toBe(0);
    });

    it('forces automation observe-only while the account automation gate remains disabled', async () => {
        const { capability, server } = await startFixture({
            status: () => ({
                role: 'primary',
                state: 'ready',
                dispatchAllowed: true,
                apiGenerationSha256: `sha256:${'a'.repeat(64)}`,
                watchdog: { repositoryReady: true },
            }),
            async gateManifestStatus({ provenance }) {
                return {
                    present: true,
                    state: 'eligible',
                    blocker: 'none',
                    validUntilEpochMs: Date.now() + 60_000,
                    featureGates: {
                        good_till: true,
                        multi_condition: true,
                        parent_child: true,
                        quick: true,
                        scheduled_quantity: true,
                        stop_take: true,
                        trailing_exit: true,
                    },
                    provenance,
                };
            },
        });
        const response = await request({
            server,
            pathname: '/v1/readiness',
            headers: gatewayHeaders({
                capability,
                server,
                method: 'GET',
                pathname: '/v1/readiness',
            }),
        });
        expect(response.body.gates.automation).toMatchObject({
            present: true,
            state: 'observe_only',
            blocker: 'automation_account_gate_disabled',
            authoritativeForDispatch: false,
            featureGates: {
                good_till: false,
                multi_condition: false,
                parent_child: false,
                quick: false,
                scheduled_quantity: false,
                stop_take: false,
                trailing_exit: false,
            },
        });
        expect(response.body.gates.manual_user_confirmed.state).toBe(
            'eligible',
        );
        expect(response.body.gates.gate_probe.state).toBe('eligible');
    });

    it('projects only bounded lifecycle drain counts and hides repository identifiers', async () => {
        const { capability, server } = await startFixture({
            status: () => ({
                role: 'primary',
                state: 'reconciling',
                dispatchAllowed: false,
                watchdog: { repositoryReady: true },
            }),
            async lifecycleAudit() {
                return {
                    schemaVersion: 'smart-order-lifecycle-audit/2026-08-12.4',
                    reconciliation: 'required_before_any_write_or_drain',
                    blockerCount: 3,
                    productionReadonlyBlockerCount: 2,
                    gracefulStopBlockerCount: 3,
                    uninstallBlockerCount: 3,
                    productionReadonlyDrainAllowed: false,
                    gracefulStopAllowed: false,
                    uninstallAllowed: false,
                    counts: {
                        reconciliation_blockers: 0,
                        non_terminal_strategies: 0,
                        non_terminal_activations: 0,
                        proven_unsent_prepared_intents: 0,
                        side_effect_intents: 0,
                        non_terminal_broker_orders: 1,
                        non_terminal_commitments: 0,
                        active_protection_obligations: 2,
                        active_entry_reservations: 0,
                        active_exit_claims: 0,
                        open_resolution_cases: 0,
                        open_safety_blockers: 0,
                    },
                    drainRecords: [
                        {
                            ordinal: 1,
                            kind: 'broker_order',
                            state: 'submitted',
                            quantityShares: 500,
                            quantityState: 'conservative_maximum',
                            disposition:
                                'cancel_working_order_or_reconcile',
                        },
                        {
                            ordinal: 2,
                            kind: 'protection_obligation',
                            state: 'monitoring',
                            quantityShares: 500,
                            quantityState: 'conservative_maximum',
                            disposition:
                                'prove_zero_fill_confirmed_exit_or_break_glass',
                        },
                        {
                            ordinal: 3,
                            kind: 'protection_obligation',
                            state: 'pending_entry_fill',
                            quantityShares: 0,
                            quantityState: 'exact',
                            disposition:
                                'prove_zero_fill_confirmed_exit_or_break_glass',
                        },
                    ],
                    drainRecordsTruncated: false,
                    runtimeTrackedUnprotectedRemainder: {
                        state: 'unknown',
                        shares: null,
                        conservativeMaximumShares: 500,
                        currentAccountReconciliationRequired: true,
                    },
                    accountIdentifiersExposed: false,
                    entityIdentifiersExposed: false,
                    strategyDefinitionsExposed: false,
                    accountIdRef: 'account-must-not-leak',
                    strategyId: 'strategy-must-not-leak',
                };
            },
        });
        const response = await request({
            server,
            pathname: '/v1/status',
            headers: gatewayHeaders({
                capability,
                server,
                method: 'GET',
                pathname: '/v1/status',
            }),
        });
        expect(response).toMatchObject({
            status: 200,
            body: {
                lifecycle: {
                    state: 'verified_repository_projection',
                    writeMaster: 'disabled',
                    activeObligationCount: 2,
                    blockerCount: 3,
                    productionReadonlyBlockerCount: 2,
                    gracefulStopBlockerCount: 3,
                    uninstallBlockerCount: 3,
                    productionReadonlyDrainAllowed: false,
                    gracefulStopAllowed: false,
                    uninstallAllowed: false,
                    drainItems: expect.arrayContaining([
                        {
                            kind: 'broker_order',
                            count: 1,
                            disposition:
                                'cancel_working_order_or_reconcile',
                        },
                        {
                            kind: 'protection_obligation',
                            count: 2,
                            disposition:
                                'prove_zero_fill_confirmed_exit_or_break_glass',
                        },
                    ]),
                    drainRecords: [
                        {
                            ordinal: 1,
                            kind: 'broker_order',
                            state: 'submitted',
                            quantityShares: 500,
                            quantityState: 'conservative_maximum',
                            disposition:
                                'cancel_working_order_or_reconcile',
                        },
                        {
                            ordinal: 2,
                            kind: 'protection_obligation',
                            state: 'monitoring',
                            quantityShares: 500,
                            quantityState: 'conservative_maximum',
                            disposition:
                                'prove_zero_fill_confirmed_exit_or_break_glass',
                        },
                        {
                            ordinal: 3,
                            kind: 'protection_obligation',
                            state: 'pending_entry_fill',
                            quantityShares: 0,
                            quantityState: 'exact',
                            disposition:
                                'prove_zero_fill_confirmed_exit_or_break_glass',
                        },
                    ],
                    drainRecordsTruncated: false,
                    runtimeTrackedUnprotectedRemainder: {
                        state: 'unknown',
                        shares: null,
                        conservativeMaximumShares: 500,
                        currentAccountReconciliationRequired: true,
                    },
                },
            },
        });
        expect(JSON.stringify(response.body)).not.toMatch(
            /account-must-not-leak|strategy-must-not-leak/,
        );
    });

    it.each([
        ['stale schema', { schemaVersion: 'smart-order-lifecycle-audit/2026-08-12.3' }],
        [
            'identifier field',
            {
                drainRecords: [
                    {
                        ordinal: 1,
                        kind: 'broker_order',
                        state: 'submitted',
                        quantityShares: 500,
                        quantityState: 'conservative_maximum',
                        disposition: 'cancel_working_order_or_reconcile',
                        brokerOrderId: 'must-not-enter-control-plane',
                    },
                ],
            },
        ],
        [
            'policy mismatch',
            {
                drainRecords: [
                    {
                        ordinal: 1,
                        kind: 'broker_order',
                        state: 'submitted',
                        quantityShares: 500,
                        quantityState: 'conservative_maximum',
                        disposition: 'release_proven_unsent_or_reconcile',
                    },
                ],
            },
        ],
        [
            'ordinal gap',
            {
                drainRecords: [
                    {
                        ordinal: 2,
                        kind: 'broker_order',
                        state: 'submitted',
                        quantityShares: 500,
                        quantityState: 'conservative_maximum',
                        disposition: 'cancel_working_order_or_reconcile',
                    },
                ],
            },
        ],
    ])('fails closed on a lifecycle drain record with %s', async (_name, override) => {
        const valid = {
            schemaVersion: 'smart-order-lifecycle-audit/2026-08-12.4',
            reconciliation: 'required_before_any_write_or_drain',
            blockerCount: 1,
            productionReadonlyBlockerCount: 1,
            gracefulStopBlockerCount: 1,
            uninstallBlockerCount: 1,
            productionReadonlyDrainAllowed: false,
            gracefulStopAllowed: false,
            uninstallAllowed: false,
            counts: {
                reconciliation_blockers: 0,
                non_terminal_strategies: 0,
                non_terminal_activations: 0,
                proven_unsent_prepared_intents: 0,
                side_effect_intents: 0,
                non_terminal_broker_orders: 1,
                non_terminal_commitments: 0,
                active_protection_obligations: 0,
                active_entry_reservations: 0,
                active_exit_claims: 0,
                open_resolution_cases: 0,
                open_safety_blockers: 0,
            },
            drainRecords: [
                {
                    ordinal: 1,
                    kind: 'broker_order',
                    state: 'submitted',
                    quantityShares: 500,
                    quantityState: 'conservative_maximum',
                    disposition: 'cancel_working_order_or_reconcile',
                },
            ],
            drainRecordsTruncated: false,
            runtimeTrackedUnprotectedRemainder: {
                state: 'known',
                shares: 0,
                conservativeMaximumShares: 0,
                currentAccountReconciliationRequired: false,
            },
            accountIdentifiersExposed: false,
            entityIdentifiersExposed: false,
            strategyDefinitionsExposed: false,
        };
        const { capability, server } = await startFixture({
            status: () => ({
                role: 'primary',
                state: 'reconciling',
                dispatchAllowed: false,
                watchdog: { repositoryReady: true },
            }),
            async lifecycleAudit() {
                return { ...valid, ...override };
            },
        });
        const response = await request({
            server,
            pathname: '/v1/status',
            headers: gatewayHeaders({
                capability,
                server,
                method: 'GET',
                pathname: '/v1/status',
            }),
        });
        expect(response.body.lifecycle).toMatchObject({
            state: 'unverified',
            blockerCount: null,
            drainRecords: [],
            drainRecordsTruncated: true,
            writeMaster: 'disabled',
        });
        expect(JSON.stringify(response.body)).not.toContain(
            'must-not-enter-control-plane',
        );
    });

    it('keeps a valid truncated lifecycle projection bounded without reducing the blocker count', async () => {
        const drainRecords = Array.from({ length: 100 }, (_value, index) => ({
            ordinal: index + 1,
            kind: 'strategy',
            state: 'monitoring',
            quantityShares: null,
            quantityState: 'not_applicable',
            disposition: 'pause_or_cancel_strategy',
        }));
        const { capability, server } = await startFixture({
            status: () => ({
                role: 'primary',
                state: 'reconciling',
                dispatchAllowed: false,
                watchdog: { repositoryReady: true },
            }),
            async lifecycleAudit() {
                return {
                    schemaVersion: 'smart-order-lifecycle-audit/2026-08-12.4',
                    reconciliation: 'required_before_any_write_or_drain',
                    blockerCount: 101,
                    productionReadonlyBlockerCount: 101,
                    gracefulStopBlockerCount: 101,
                    uninstallBlockerCount: 101,
                    productionReadonlyDrainAllowed: false,
                    gracefulStopAllowed: false,
                    uninstallAllowed: false,
                    counts: {
                        reconciliation_blockers: 0,
                        non_terminal_strategies: 101,
                        non_terminal_activations: 0,
                        proven_unsent_prepared_intents: 0,
                        side_effect_intents: 0,
                        non_terminal_broker_orders: 0,
                        non_terminal_commitments: 0,
                        active_protection_obligations: 0,
                        active_entry_reservations: 0,
                        active_exit_claims: 0,
                        open_resolution_cases: 0,
                        open_safety_blockers: 0,
                    },
                    drainRecords,
                    drainRecordsTruncated: true,
                    runtimeTrackedUnprotectedRemainder: {
                        state: 'known',
                        shares: 0,
                        conservativeMaximumShares: 0,
                        currentAccountReconciliationRequired: false,
                    },
                    accountIdentifiersExposed: false,
                    entityIdentifiersExposed: false,
                    strategyDefinitionsExposed: false,
                };
            },
        });
        const response = await request({
            server,
            pathname: '/v1/status',
            headers: gatewayHeaders({
                capability,
                server,
                method: 'GET',
                pathname: '/v1/status',
            }),
        });
        expect(response.body.lifecycle).toMatchObject({
            state: 'verified_repository_projection',
            blockerCount: 101,
            gracefulStopBlockerCount: 101,
            gracefulStopAllowed: false,
            uninstallAllowed: false,
            drainRecordsTruncated: true,
        });
        expect(response.body.lifecycle.drainRecords).toHaveLength(100);
        expect(response.body.lifecycle.drainItems).toContainEqual({
            kind: 'strategy',
            count: 101,
            disposition: 'pause_or_cancel_strategy',
        });
    });

    it.each(['rollback', 'feature_off'])(
        'routes %s through the strict graceful-stop lifecycle projection',
        async (operation) => {
            const observedOperations = [];
            const lifecycle = {
                schemaVersion:
                    'smart-order-lifecycle-audit/2026-08-12.4',
                reconciliation: 'current_no_side_effects',
                blockerCount: 0,
                productionReadonlyBlockerCount: 0,
                gracefulStopBlockerCount: 0,
                uninstallBlockerCount: 0,
                productionReadonlyDrainAllowed: true,
                gracefulStopAllowed: true,
                uninstallAllowed: true,
                counts: {
                    reconciliation_blockers: 0,
                    non_terminal_strategies: 0,
                    non_terminal_activations: 0,
                    proven_unsent_prepared_intents: 0,
                    side_effect_intents: 0,
                    non_terminal_broker_orders: 0,
                    non_terminal_commitments: 0,
                    active_protection_obligations: 0,
                    active_entry_reservations: 0,
                    active_exit_claims: 0,
                    open_resolution_cases: 0,
                    open_safety_blockers: 0,
                },
                drainRecords: [],
                drainRecordsTruncated: false,
                runtimeTrackedUnprotectedRemainder: {
                    state: 'known',
                    shares: 0,
                    conservativeMaximumShares: 0,
                    currentAccountReconciliationRequired: false,
                },
                accountIdentifiersExposed: false,
                entityIdentifiersExposed: false,
                strategyDefinitionsExposed: false,
            };
            const { capability, server } = await startFixture({
                status: () => ({
                    role: 'primary',
                    state: 'observe_only',
                    dispatchAllowed: false,
                    watchdog: { repositoryReady: true },
                }),
                async quiesce(input) {
                    observedOperations.push(input.operation);
                    return {
                        state: 'quiescing',
                        operation: input.operation,
                        drainAllowed: true,
                        selectedBlockerCount: 0,
                        lifecycle,
                    };
                },
            });
            const plaintext = Buffer.from(JSON.stringify({ operation }));
            const requestId =
                operation === 'rollback'
                    ? '123e4567-e89b-42d3-a456-426614174001'
                    : '123e4567-e89b-42d3-a456-426614174002';
            const envelope = sealSmartOrderControlPlaneMutation({
                capability,
                runtimeEpochId,
                sidecarAuthority: `${server.host}:${server.port}`,
                requestId,
                method: 'POST',
                pathname: '/v1/lifecycle/quiesce',
                origin,
                plaintextBytes: plaintext,
            });
            const headers = gatewayHeaders({
                capability,
                server,
                method: 'POST',
                pathname: '/v1/lifecycle/quiesce',
                body: envelope.bodyBytes,
                envelopeNonce: envelope.nonce,
            });
            headers['X-RealTimeStock-Request-Id'] = requestId;
            headers['Content-Type'] =
                SMART_ORDER_CONTROL_PLANE_MUTATION_CONTENT_TYPE;
            headers['Content-Length'] = String(envelope.bodyBytes.byteLength);
            // Recompute the request proof with the same explicit request ID.
            const proof = createSmartOrderGatewayProof({
                capability,
                method: 'POST',
                pathname: '/v1/lifecycle/quiesce',
                origin,
                runtimeEpochId,
                sidecarAuthority: `${server.host}:${server.port}`,
                envelopeNonce: envelope.nonce,
                bodyBytes: envelope.bodyBytes,
                nowEpochMs: Date.now(),
                requestId,
            });
            headers['X-RealTimeStock-Gateway-Timestamp'] = String(
                proof.timestampEpochMs,
            );
            headers['X-RealTimeStock-Gateway-Proof'] = proof.proof;

            const response = await request({
                server,
                method: 'POST',
                pathname: '/v1/lifecycle/quiesce',
                headers,
                body: envelope.bodyBytes,
            });
            expect(response).toMatchObject({
                status: 200,
                body: {
                    state: 'quiescing',
                    operation,
                    drainAllowed: true,
                    blockerCount: 0,
                    dispatchAllowed: false,
                    writeMaster: 'disabled',
                    brokerWriteAttempted: false,
                },
            });
            expect(observedOperations).toEqual([operation]);
        },
    );

    it('rejects malicious Host and query routing before a handler', async () => {
        const { capability, server } = await startFixture();
        const maliciousHost = await request({
            server,
            pathname: '/health',
            headers: { Host: `localhost:${server.port}` },
        });
        expect(maliciousHost).toMatchObject({
            status: 403,
            body: { code: 'host_not_allowed' },
        });
        const query = await request({
            server,
            pathname: '/v1/status?redirect=https://attacker.example',
            headers: gatewayHeaders({
                capability,
                server,
                method: 'GET',
                pathname: '/v1/status',
            }),
        });
        expect(query).toMatchObject({
            status: 400,
            body: { code: 'query_not_allowed' },
        });
    });

    it('returns only a bounded terminal history allowlist from the Runtime repository', async () => {
        let calls = 0;
        const { capability, server } = await startFixture({
            async listHistory(input) {
                calls += 1;
                expect(input).toEqual({ limit: 100 });
                return [
                    {
                        type: 'strategy',
                        strategyId: 'strategy-history-1',
                        strategyKind: 'trailing_exit',
                        state: 'completed',
                        maskedAccountLabel: '固定帳號 ····5431',
                        reasonCode: 'STRATEGY_TERMINAL_IMPORTED',
                        revision: 7,
                        createdAtEpochMs: 1_786_377_600_000,
                        updatedAtEpochMs: 1_786_377_600_100,
                        terminalAtEpochMs: 1_786_377_600_100,
                        exchangeEpochMs: 1_786_377_600_080,
                        brokerEpochMs: 1_786_377_600_090,
                        receiveEpochMs: 1_786_377_600_100,
                        accountIdRef: 'account-must-not-leak',
                        accountBrokerRef: 'broker-must-not-leak',
                        identityGroupId: 'identity-must-not-leak',
                        payloadHash: `sha256:${'f'.repeat(64)}`,
                        journalPayload: { secret: 'must-not-leak' },
                        summaryCode: 'must-not-leak',
                    },
                ];
            },
        });
        const response = await request({
            server,
            pathname: '/v1/history',
            headers: gatewayHeaders({
                capability,
                server,
                method: 'GET',
                pathname: '/v1/history',
            }),
        });
        expect(response).toMatchObject({
            status: 200,
            body: {
                schemaVersion: 'smart-order-history-projection/2026-08-12.2',
                source: 'runtime_repository',
                accountIdentifiersExposed: false,
                journalPayloadExposed: false,
                history: [
                    {
                        type: 'strategy',
                        strategyId: 'strategy-history-1',
                        strategyKind: 'trailing_exit',
                        state: 'completed',
                        maskedAccountLabel: '固定帳號 ····5431',
                        reasonCode: 'STRATEGY_TERMINAL_IMPORTED',
                        revision: 7,
                    },
                ],
            },
        });
        expect(calls).toBe(1);
        expect(Object.keys(response.body.history[0]).sort()).toEqual(
            [
                'brokerEpochMs',
                'createdAtEpochMs',
                'exchangeEpochMs',
                'maskedAccountLabel',
                'reasonCode',
                'receiveEpochMs',
                'revision',
                'state',
                'strategyId',
                'strategyKind',
                'terminalAtEpochMs',
                'type',
                'updatedAtEpochMs',
            ].sort(),
        );
        expect(JSON.stringify(response.body)).not.toMatch(
            /account-must-not-leak|broker-must-not-leak|identity-must-not-leak|"payloadHash":|"journalPayload":|"summaryCode":|sha256:/,
        );
    });

    it('returns a bounded redacted event projection for the authenticated cursor path', async () => {
        let receivedInput;
        const { capability, server } = await startFixture({
            async listEvents(input) {
                receivedInput = input;
                return {
                    schemaVersion: 'smart-order-event-projection/2026-08-11.1',
                    cursorStatus: 'current',
                    fromSequence: 7,
                    nextSequence: 8,
                    highWaterSequence: 8,
                    events: [
                        {
                            sequence: 8,
                            entityKind: 'strategy',
                            reasonCode: 'STRATEGY_PERSISTED',
                            revision: 2,
                            summaryCode: 'strategy_state_changed',
                            exchangeEpochMs: null,
                            brokerEpochMs: null,
                            receiveEpochMs: 1_786_377_600_100,
                        },
                    ],
                    accountIdentifiersExposed: false,
                    entityIdentifiersExposed: false,
                    journalPayloadExposed: false,
                    ignoredAccount: 'must-not-leak',
                };
            },
        });
        const pathname = '/v1/events/7';
        const response = await request({
            server,
            pathname,
            headers: gatewayHeaders({
                capability,
                server,
                method: 'GET',
                pathname,
            }),
        });
        expect(response).toMatchObject({
            status: 503,
            body: { code: 'event_read_service_unavailable' },
        });
        expect(receivedInput).toEqual({ afterSequence: 7, limit: 100 });
    });

    it('keeps SSE authenticated, same-origin, no-CORS, and side-effect free on rejection', async () => {
        let eventReads = 0;
        const fixture = await startFixture({
            async listEvents() {
                eventReads += 1;
                return {
                    schemaVersion:
                        'smart-order-event-projection/2026-08-11.1',
                    cursorStatus: 'initialized',
                    fromSequence: null,
                    nextSequence: 0,
                    highWaterSequence: 0,
                    events: [],
                    accountIdentifiersExposed: false,
                    entityIdentifiersExposed: false,
                    journalPayloadExposed: false,
                };
            },
        });
        const pathname = '/v1/events/initial';
        const missingProof = await request({
            server: fixture.server,
            pathname,
            headers: { Host: `${fixture.server.host}:${fixture.server.port}` },
        });
        expect(missingProof).toMatchObject({
            status: 403,
            body: { code: 'origin_or_fetch_metadata_not_allowed' },
        });

        const wrongCapability = randomBytes(32);
        const wrongProof = await request({
            server: fixture.server,
            pathname,
            headers: gatewayHeaders({
                capability: wrongCapability,
                server: fixture.server,
                method: 'GET',
                pathname,
            }),
        });
        wrongCapability.fill(0);
        expect(wrongProof).toMatchObject({
            status: 403,
            body: { code: 'gateway_proof_invalid' },
        });
        expect(wrongProof.headers['access-control-allow-origin']).toBeUndefined();
        expect(JSON.stringify(wrongProof.body)).not.toContain(
            fixture.capability.toString('base64url'),
        );

        const foreignOriginHeaders = gatewayHeaders({
            capability: fixture.capability,
            server: fixture.server,
            method: 'GET',
            pathname,
        });
        foreignOriginHeaders.Origin = 'https://attacker.example';
        const foreignOrigin = await request({
            server: fixture.server,
            pathname,
            headers: foreignOriginHeaders,
        });
        expect(foreignOrigin).toMatchObject({
            status: 403,
            body: { code: 'origin_or_fetch_metadata_not_allowed' },
        });
        expect(eventReads).toBe(0);
    });

    it('passes only an exact redacted event projection', async () => {
        const { capability, server } = await startFixture({
            async listEvents() {
                return {
                    schemaVersion: 'smart-order-event-projection/2026-08-11.1',
                    cursorStatus: 'current',
                    fromSequence: 7,
                    nextSequence: 8,
                    highWaterSequence: 8,
                    events: [
                        {
                            sequence: 8,
                            entityKind: 'strategy',
                            reasonCode: 'STRATEGY_PERSISTED',
                            revision: 2,
                            summaryCode: 'strategy_state_changed',
                            exchangeEpochMs: null,
                            brokerEpochMs: null,
                            receiveEpochMs: 1_786_377_600_100,
                        },
                    ],
                    accountIdentifiersExposed: false,
                    entityIdentifiersExposed: false,
                    journalPayloadExposed: false,
                };
            },
        });
        const pathname = '/v1/events/7';
        const response = await request({
            server,
            pathname,
            headers: gatewayHeaders({
                capability,
                server,
                method: 'GET',
                pathname,
            }),
        });
        expect(response).toMatchObject({
            status: 200,
            body: {
                cursorStatus: 'current',
                fromSequence: 7,
                nextSequence: 8,
                events: [
                    {
                        sequence: 8,
                        entityKind: 'strategy',
                        reasonCode: 'STRATEGY_PERSISTED',
                    },
                ],
                accountIdentifiersExposed: false,
                entityIdentifiersExposed: false,
                journalPayloadExposed: false,
            },
        });
        expect(JSON.stringify(response.body)).not.toMatch(
            /strategy-id|"accountId"|ignoredAccount|payloadHash|"journalPayload":/i,
        );
    });

    it('serves the repository formal protection projection on the authenticated strategy read path', async () => {
        const formalProtection = {
            schemaVersion:
                'smart-order-formal-protection-view/2026-08-13.1',
            state: 'pending_saved_high',
            cumulativeFilledShares: 200,
            asOfEpochMs: 1_786_377_600_100,
            estimatedBasis: {
                numeratorMinorUnits: '10000',
                denominator: '1',
            },
            formalBasis: {
                numeratorMinorUnits: '10100',
                denominator: '1',
            },
            legs: [
                {
                    type: 'stop',
                    comparator: 'lte',
                    triggerState: 'formal',
                    triggerBasis: 'weighted_average_fill',
                    estimatedTriggerPrice: {
                        numeratorMinorUnits: '9700',
                        denominator: '1',
                    },
                    formalTriggerPrice: {
                        numeratorMinorUnits: '9797',
                        denominator: '1',
                    },
                    differsFromEstimate: true,
                },
                {
                    type: 'trailing_retracement',
                    comparator: 'lte',
                    triggerState: 'pending_saved_high',
                    triggerBasis: 'durable_saved_high',
                    estimatedTriggerPrice: null,
                    formalTriggerPrice: null,
                    differsFromEstimate: null,
                },
            ],
            accountIdentifiersExposed: false,
            entityIdentifiersExposed: false,
        };
        const { capability, server } = await startFixture({
            async listStrategies(input) {
                expect(input).toEqual({ limit: 100 });
                return [
                    {
                        strategyId: 'strategy-visible-id',
                        activity: {
                            schemaVersion:
                                'smart-order-active-activity/2026-08-13.3',
                            formalProtection,
                            accountIdentifiersExposed: false,
                            entityIdentifiersExposed: false,
                        },
                    },
                ];
            },
        });
        const pathname = '/v1/strategies';
        const response = await request({
            server,
            pathname,
            headers: gatewayHeaders({
                capability,
                server,
                method: 'GET',
                pathname,
            }),
        });
        expect(response).toMatchObject({
            status: 200,
            body: {
                source: 'runtime_snapshot',
                accountIdentifiersExposed: false,
                strategies: [
                    {
                        activity: {
                            formalProtection,
                            accountIdentifiersExposed: false,
                            entityIdentifiersExposed: false,
                        },
                    },
                ],
            },
        });
        expect(JSON.stringify(response.body)).not.toMatch(
            /accountIdRef|brokerAccountId|definitionHash|formalProtectionSha256/i,
        );
    });

    it('keeps history GET side-effect free and fails closed without a repository-backed method', async () => {
        const missing = await startFixture();
        const missingResponse = await request({
            server: missing.server,
            pathname: '/v1/history',
            headers: gatewayHeaders({
                capability: missing.capability,
                server: missing.server,
                method: 'GET',
                pathname: '/v1/history',
            }),
        });
        expect(missingResponse).toMatchObject({
            status: 501,
            body: { code: 'history_read_service_not_wired' },
        });

        let calls = 0;
        const fixture = await startFixture({
            async listHistory() {
                calls += 1;
                return [];
            },
        });
        const query = await request({
            server: fixture.server,
            pathname: '/v1/history?limit=1',
            headers: gatewayHeaders({
                capability: fixture.capability,
                server: fixture.server,
                method: 'GET',
                pathname: '/v1/history',
            }),
        });
        expect(query).toMatchObject({
            status: 400,
            body: { code: 'query_not_allowed' },
        });
        const body = Buffer.from('{}');
        const bodyResponse = await request({
            server: fixture.server,
            pathname: '/v1/history',
            headers: {
                ...gatewayHeaders({
                    capability: fixture.capability,
                    server: fixture.server,
                    method: 'GET',
                    pathname: '/v1/history',
                    body,
                }),
                'Content-Length': String(body.byteLength),
            },
            body,
        });
        expect(bodyResponse).toMatchObject({
            status: 403,
            body: { code: 'body_not_allowed' },
        });
        expect(calls).toBe(0);
    });

    it('fails closed when the Runtime repository exceeds the 100-item history bound', async () => {
        const { capability, server } = await startFixture({
            async listHistory() {
                return Array.from({ length: 101 }, (_, index) => ({
                    type: 'strategy',
                    strategyId: `strategy-history-${index}`,
                    strategyKind: 'quick',
                    state: 'completed',
                    maskedAccountLabel: '固定帳號 ····5431',
                    reasonCode: 'STRATEGY_TERMINAL_IMPORTED',
                    revision: 1,
                    createdAtEpochMs: 1,
                    updatedAtEpochMs: 2,
                    terminalAtEpochMs: 2,
                    exchangeEpochMs: null,
                    brokerEpochMs: null,
                    receiveEpochMs: 2,
                }));
            },
        });
        const response = await request({
            server,
            pathname: '/v1/history',
            headers: gatewayHeaders({
                capability,
                server,
                method: 'GET',
                pathname: '/v1/history',
            }),
        });
        expect(response).toMatchObject({
            status: 503,
            body: { code: 'history_read_service_unavailable' },
        });
    });

    it('fails closed when the repository history reason is outside the terminal allowlist', async () => {
        const { capability, server } = await startFixture({
            async listHistory() {
                return [
                    {
                        type: 'strategy',
                        strategyId: 'strategy-history-invalid',
                        strategyKind: 'quick',
                        state: 'completed',
                        maskedAccountLabel: '固定帳號 ····5431',
                        reasonCode: 'NOT_TERMINAL',
                        revision: 1,
                        createdAtEpochMs: 1,
                        updatedAtEpochMs: 2,
                        terminalAtEpochMs: 2,
                        exchangeEpochMs: null,
                        brokerEpochMs: null,
                        receiveEpochMs: 2,
                    },
                ];
            },
        });
        const response = await request({
            server,
            pathname: '/v1/history',
            headers: gatewayHeaders({
                capability,
                server,
                method: 'GET',
                pathname: '/v1/history',
            }),
        });
        expect(response).toMatchObject({
            status: 503,
            body: { code: 'history_read_service_unavailable' },
        });
    });

    it('fails closed when terminal history timestamps contradict the journal receive time', async () => {
        const { capability, server } = await startFixture({
            async listHistory() {
                return [
                    {
                        type: 'strategy',
                        strategyId: 'strategy-history-future-terminal',
                        strategyKind: 'quick',
                        state: 'completed',
                        maskedAccountLabel: '固定帳號 ····5431',
                        reasonCode: 'STRATEGY_TERMINAL_IMPORTED',
                        revision: 1,
                        createdAtEpochMs: 1,
                        updatedAtEpochMs: 2,
                        terminalAtEpochMs: 3,
                        exchangeEpochMs: null,
                        brokerEpochMs: null,
                        receiveEpochMs: 2,
                    },
                ];
            },
        });
        const response = await request({
            server,
            pathname: '/v1/history',
            headers: gatewayHeaders({
                capability,
                server,
                method: 'GET',
                pathname: '/v1/history',
            }),
        });
        expect(response).toMatchObject({
            status: 503,
            body: { code: 'history_read_service_unavailable' },
        });
    });

    it('keeps authenticated mutations fail-closed until replay and services are wired', async () => {
        const { capability, server } = await startFixture();
        const plaintext = Buffer.from('{"strategyKind":"trailing_exit"}');
        const envelope = sealSmartOrderControlPlaneMutation({
            capability,
            runtimeEpochId,
            sidecarAuthority: `${server.host}:${server.port}`,
            requestId: '123e4567-e89b-42d3-a456-426614174000',
            method: 'POST',
            pathname: '/v1/strategies',
            origin,
            plaintextBytes: plaintext,
        });
        const headers = gatewayHeaders({
            capability,
            server,
            method: 'POST',
            pathname: '/v1/strategies',
            body: envelope.bodyBytes,
            envelopeNonce: envelope.nonce,
        });
        headers['Content-Type'] = SMART_ORDER_CONTROL_PLANE_MUTATION_CONTENT_TYPE;
        headers['Content-Length'] = String(envelope.bodyBytes.byteLength);
        const response = await request({
            server,
            method: 'POST',
            pathname: '/v1/strategies',
            headers,
            body: envelope.bodyBytes,
        });
        expect(response).toMatchObject({
            status: 503,
            body: {
                code: 'mutation_service_not_wired',
                brokerWriteAttempted: false,
            },
        });
    });

    it('rejects duplicate critical headers and chunked request bodies', async () => {
        const { server } = await startFixture();
        const duplicate = await rawRequest({
            server,
            payload: [
                'GET /health HTTP/1.1',
                `Host: ${server.host}:${server.port}`,
                `Host: ${server.host}:${server.port}`,
                'Connection: close',
                '',
                '',
            ].join('\r\n'),
        });
        expect(duplicate).toMatch(/^HTTP\/1\.1 400 /);

        const chunked = await request({
            server,
            method: 'POST',
            pathname: '/v1/strategies',
            headers: {
                Host: `${server.host}:${server.port}`,
                'Transfer-Encoding': 'chunked',
            },
            body: Buffer.from('{}'),
        });
        expect(chunked).toMatchObject({
            status: 400,
            body: {
                code: 'invalid_request',
                brokerWriteAttempted: false,
            },
        });

        const oversized = await request({
            server,
            method: 'POST',
            pathname: '/v1/strategies',
            headers: {
                Host: `${server.host}:${server.port}`,
                'Content-Length': String(
                    SMART_ORDER_CONTROL_PLANE_MAX_ENVELOPE_BYTES + 1,
                ),
            },
            body: Buffer.alloc(
                SMART_ORDER_CONTROL_PLANE_MAX_ENVELOPE_BYTES + 1,
                0x61,
            ),
        });
        expect(oversized).toMatchObject({
            status: 413,
            body: {
                code: 'body_too_large',
                brokerWriteAttempted: false,
            },
        });
    });
});
