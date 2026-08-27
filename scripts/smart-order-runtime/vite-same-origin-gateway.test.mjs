import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startSmartOrderControlPlaneServer } from './control-plane-server.mjs';
import {
    prepareSmartOrderPrivateStorage,
    readPrivateSecret,
    writePrivateRuntimeDiscovery,
} from './private-storage.mjs';
import {
    SMART_ORDER_BROWSER_CSRF_HEADER,
    SMART_ORDER_BROWSER_CSRF_ROUTE,
    SMART_ORDER_VITE_GATEWAY_PREFIX,
    authorizeSmartOrderBrowserGatewayRequest,
    createSmartOrderSameOriginGatewayMiddleware,
    readSmartOrderGatewayAuthority,
} from './vite-same-origin-gateway.mjs';
import {
    canonicalSmartOrderDraft,
    canonicalSmartOrderDraftKinds,
} from './canonical-strategy-draft-fixtures.mjs';
import { smartOrderRepositoryRootForTest } from './repo-external-root.mjs';

const NOW = 1_786_382_000_000;
const RUNTIME_EPOCH_ID = 'runtime-epoch-test-1';
const roots = [];
const servers = [];

afterEach(async () => {
    await Promise.all(
        servers.splice(0).map((server) => server.close().catch(() => {})),
    );
    await Promise.all(
        roots.splice(0).map((root) =>
            rm(root, { recursive: true, force: true }),
        ),
    );
});

async function closeHttpServer(server) {
    await new Promise((resolve) => server.close(() => resolve()));
}

async function temporaryStorage() {
    const root = await mkdtemp(path.join(tmpdir(), 'smart-order-vite-gateway-'));
    roots.push(root);
    await chmod(root, 0o700);
    const storage = await prepareSmartOrderPrivateStorage({
        appSupportRoot: root,
    });
    return { root, storage };
}

async function startGateway(root, options = {}) {
    const middleware = createSmartOrderSameOriginGatewayMiddleware({
        appSupportRoot: root,
        now: options.now ?? (() => NOW),
        ...(options.csrfTokenTtlMs === undefined
            ? {}
            : { csrfTokenTtlMs: options.csrfTokenTtlMs }),
        ...(options.csrfSessionTtlMs === undefined
            ? {}
            : { csrfSessionTtlMs: options.csrfSessionTtlMs }),
    });
    const server = http.createServer((request, response) => {
        middleware(request, response, () => {
            response.statusCode = 418;
            response.end('next');
        });
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host: '127.0.0.1', port: 0 }, resolve);
    });
    servers.push({ close: () => closeHttpServer(server) });
    return {
        host: '127.0.0.1',
        port: server.address().port,
        server,
    };
}

async function publishSidecar({
    storage,
    gateway,
    runtimeController,
    strategyConfirmationControlPlaneAuthority = null,
    strategyConfirmationEvidenceProvider = null,
}) {
    const capability = await readPrivateSecret(storage.paths.capabilityPath);
    const gateProbeCliCapability = await readPrivateSecret(
        storage.paths.gateProbeCliCapabilityPath,
    );
    const sidecar = await startSmartOrderControlPlaneServer({
        capability,
        gateProbeCliCapability,
        runtimeEpochId: RUNTIME_EPOCH_ID,
        runtimeController:
            runtimeController ?? {
                status: () => ({
                    role: 'primary',
                    state: 'reconciling',
                    dispatchAllowed: false,
                    watchdog: { repositoryReady: true },
                    privateValue: 'must-not-leak',
                }),
            },
        expectedOrigin: `http://127.0.0.1:${gateway.port}`,
        strategyConfirmationControlPlaneAuthority,
        strategyConfirmationEvidenceProvider,
        now: () => NOW,
    });
    capability.fill(0);
    gateProbeCliCapability.fill(0);
    servers.push(sidecar);
    await writePrivateRuntimeDiscovery(
        storage.paths.controlPlaneDiscoveryPath,
        {
            schemaVersion: 'smart-order-local-sidecar/2026-08-11.1',
            host: '127.0.0.1',
            port: sidecar.port,
            runtimeEpochId: RUNTIME_EPOCH_ID,
            startedAtEpochMs: NOW,
        },
    );
    return sidecar;
}

function browserHeaders(gateway, overrides = {}) {
    return {
        Host: `127.0.0.1:${gateway.port}`,
        Origin: `http://127.0.0.1:${gateway.port}`,
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        ...overrides,
    };
}

function request({
    gateway,
    pathname = `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/status`,
    method = 'GET',
    headers = browserHeaders(gateway),
    body,
}) {
    return new Promise((resolve, reject) => {
        const outgoing = http.request(
            {
                host: gateway.host,
                port: gateway.port,
                path: pathname,
                method,
                headers,
            },
            (response) => {
                const chunks = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.once('end', () => {
                    const rawBody = Buffer.concat(chunks);
                    let parsedBody;
                    try {
                        parsedBody = JSON.parse(rawBody.toString('utf8'));
                    } catch {
                        parsedBody = rawBody.toString('utf8');
                    }
                    resolve({
                        status: response.statusCode,
                        headers: response.headers,
                        body: parsedBody,
                        rawBody,
                    });
                });
            },
        );
        outgoing.once('error', reject);
        if (body !== undefined) outgoing.write(body);
        outgoing.end();
    });
}

async function issueCsrfCredential(gateway, cookie) {
    const response = await request({
        gateway,
        pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}${SMART_ORDER_BROWSER_CSRF_ROUTE}`,
        headers: browserHeaders(gateway, cookie ? { Cookie: cookie } : {}),
    });
    expect(response).toMatchObject({
        status: 200,
        body: {
            schemaVersion: 'smart-order-browser-csrf/2026-08-11.1',
            sessionBound: true,
            singleUse: true,
        },
    });
    expect(response.body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const setCookie = Array.isArray(response.headers['set-cookie'])
        ? response.headers['set-cookie'][0]
        : response.headers['set-cookie'];
    expect(setCookie).toMatch(
        /^rts_smart_order_session=[A-Za-z0-9_-]{43};/,
    );
    return {
        cookie: setCookie.split(';', 1)[0],
        csrfToken: response.body.csrfToken,
        response,
    };
}

async function authenticatedMutation({
    gateway,
    pathname,
    method = 'POST',
    body,
    credential,
    headerOverrides = {},
}) {
    const authority = credential ?? (await issueCsrfCredential(gateway));
    return request({
        gateway,
        pathname,
        method,
        headers: browserHeaders(gateway, {
            Cookie: authority.cookie,
            [SMART_ORDER_BROWSER_CSRF_HEADER]: authority.csrfToken,
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(body)),
            ...headerOverrides,
        }),
        body,
    });
}

function rawRequest({ gateway, payload }) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({
            host: gateway.host,
            port: gateway.port,
        });
        const chunks = [];
        socket.once('connect', () => socket.end(payload));
        socket.on('data', (chunk) => chunks.push(chunk));
        socket.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        socket.once('error', reject);
    });
}

describe('Vite 5173 smart-order same-origin gateway', () => {
    it('refuses to bootstrap CSRF from forgeable headers without an OS-authenticated TCP peer', async () => {
        const middleware = createSmartOrderSameOriginGatewayMiddleware({
            appSupportRoot: '/private/tmp/missing-smart-order-gateway-authority',
            now: () => NOW,
        });
        const headers = browserHeaders({ port: 5173 });
        const requestWithoutPeer = {
            url: `${SMART_ORDER_VITE_GATEWAY_PREFIX}${SMART_ORDER_BROWSER_CSRF_ROUTE}`,
            method: 'GET',
            rawHeaders: Object.entries(headers).flat(),
            socket: {
                remoteAddress: '127.0.0.1',
                localAddress: '127.0.0.1',
                localPort: 5173,
                remotePort: 0,
            },
        };
        const responseHeaders = {};
        const response = {
            headersSent: false,
            statusCode: 0,
            setHeader(name, value) {
                responseHeaders[name.toLowerCase()] = value;
            },
            end(value = '') {
                this.headersSent = true;
                this.body = Buffer.from(value);
            },
            destroy() {
                this.destroyed = true;
            },
        };
        let nextCalled = false;
        await middleware(requestWithoutPeer, response, () => {
            nextCalled = true;
        });
        expect(response.statusCode).toBe(403);
        expect(JSON.parse(response.body.toString('utf8'))).toEqual({
            code: 'gateway_peer_not_authorized',
            brokerWriteAttempted: false,
        });
        expect(responseHeaders['set-cookie']).toBeUndefined();
        expect(nextCalled).toBe(false);
    });

    it('proxies Runtime risk policy reads and replay-protected publications through the same-origin boundary', async () => {
        const { root, storage } = await temporaryStorage();
        const gateway = await startGateway(root);
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
        await publishSidecar({
            storage,
            gateway,
            runtimeController: {
                async riskPolicy() {
                    return missing;
                },
                async executeReplayProtectedStrategyMutation(input) {
                    calls.push(input);
                    const accepted =
                        input.operationKind ===
                        'protected_entry_confirmation_accept';
                    return {
                        state: 'completed',
                        resultHash: `sha256:${'a'.repeat(64)}`,
                        result: {
                            ...missing,
                            state: 'reconciliation_required',
                            revision: 0,
                            policyHash: `sha256:${'b'.repeat(64)}`,
                            policy: { revision: 0 },
                            publishedAtEpochMs: NOW,
                            runtimeState: 'reconciling',
                            runtimeRevision: 2,
                            dispatchAllowed: false,
                            replayed: false,
                        },
                    };
                },
            },
        });
        await expect(
            request({
                gateway,
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/risk/policy`,
            }),
        ).resolves.toMatchObject({ status: 200, body: missing });

        const operationId = '123e4567-e89b-42d3-a456-426614174205';
        const body = JSON.stringify({
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
        });
        await expect(
            authenticatedMutation({
                gateway,
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/risk/policy`,
                method: 'PUT',
                body,
            }),
        ).resolves.toMatchObject({
            status: 200,
            body: {
                brokerWriteAttempted: false,
                result: {
                    state: 'reconciliation_required',
                    dispatchAllowed: false,
                    brokerWriteAuthority: false,
                },
            },
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            requestId: operationId,
            operationKind: 'risk_policy_publish',
            mutation: { kind: 'risk_policy_publish' },
        });
        const invalid = JSON.parse(body);
        invalid.operationId = '123e4567-e89b-42d3-a456-426614174206';
        invalid.policy.identityLimits.quantityShares = null;
        await expect(
            authenticatedMutation({
                gateway,
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/risk/policy`,
                method: 'PUT',
                body: JSON.stringify(invalid),
            }),
        ).resolves.toMatchObject({
            status: 400,
            body: {
                code: 'request_body_shape_invalid',
                brokerWriteAttempted: false,
            },
        });
        expect(calls).toHaveLength(1);
    });

    it('proxies only exact protected-entry confirmation bodies to the private issued controller', async () => {
        const { root, storage } = await temporaryStorage();
        const gateway = await startGateway(root);
        const calls = [];
        const authority = Object.freeze({});
        const contractEvidence = Object.freeze({ issued: true });
        await publishSidecar({
            storage,
            gateway,
            strategyConfirmationControlPlaneAuthority: authority,
            strategyConfirmationEvidenceProvider: async (input) => {
                expect(input).toMatchObject({
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    contractKey: 'TSE:STK:2330',
                });
                expect(Object.keys(input).sort()).toEqual([
                    'accountBrokerRef',
                    'accountIdRef',
                    'contractKey',
                    'expectedRevision',
                    'strategyId',
                ]);
                return contractEvidence;
            },
            runtimeController: {
                async getStrategy({ strategyId }) {
                    return {
                        strategyId,
                        state: 'draft',
                        revision: 1,
                        definition: {
                            parameters: {
                                order: { contractKey: 'TSE:STK:2330' },
                            },
                        },
                    };
                },
                async executeReplayProtectedStrategyMutation(input) {
                    calls.push(input);
                    return {
                        state: 'completed',
                        resultHash: `sha256:${'a'.repeat(64)}`,
                        result: {
                            schemaVersion:
                                'smart-order-protected-entry-confirmation/2026-08-20.1',
                            state:
                                input.operationKind.endsWith(
                                    'confirmation_accept',
                                )
                                    ? 'accepted'
                                    : 'previewed',
                            brokerWriteAttempted: false,
                            brokerWriteAuthority: false,
                        },
                    };
                },
            },
        });
        const operationId = '123e4567-e89b-42d3-a456-426614174215';
        const body = {
            confirmationId: operationId,
            operationId,
            confirmationRequest: {
                schemaVersion:
                    'smart-order-protected-entry-confirmation-request/2026-08-20.1',
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                commonLots: 1,
                contractKey: 'TSE:STK:2330',
                entryOrder: {
                    priceType: 'LMT',
                    limitPrice: '100',
                    timeInForce: 'ROD',
                },
                protection: {
                    family: 'fixed',
                    legs: [
                        {
                            comparator: 'lte',
                            distance: { kind: 'pct_bps', pctBps: 300 },
                            execution: {
                                priceType: 'LMT',
                                limitPrice: '95',
                                timeInForce: 'ROD',
                            },
                            legId: 'stop',
                            type: 'stop',
                        },
                    ],
                },
            },
        };
        await expect(
            authenticatedMutation({
                gateway,
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/protected-entry/confirmation-preview`,
                body: JSON.stringify(body),
            }),
        ).resolves.toMatchObject({
            status: 200,
            body: {
                brokerWriteAttempted: false,
                result: { state: 'previewed', brokerWriteAuthority: false },
            },
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            requestId: operationId,
            operationKind: 'protected_entry_confirmation_preview',
            mutation: {
                kind: 'protected_entry_confirmation_preview',
                confirmationRequest: body.confirmationRequest,
                contractEvidence,
                controlPlaneAuthority: authority,
            },
        });

        const acceptOperationId =
            '123e4567-e89b-42d3-a456-426614174216';
        await expect(
            authenticatedMutation({
                gateway,
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/protected-entry/confirmation-accept`,
                body: JSON.stringify({
                    ...body,
                    operationId: acceptOperationId,
                    snapshotHash: `sha256:${'9'.repeat(64)}`,
                    userAcknowledged: true,
                }),
            }),
        ).resolves.toMatchObject({
            status: 200,
            body: {
                brokerWriteAttempted: false,
                result: { state: 'accepted', brokerWriteAuthority: false },
            },
        });
        expect(calls[1]).toMatchObject({
            requestId: acceptOperationId,
            operationKind: 'protected_entry_confirmation_accept',
            mutation: {
                confirmationId: operationId,
                kind: 'protected_entry_confirmation_accept',
                snapshotHash: `sha256:${'9'.repeat(64)}`,
                userAcknowledged: true,
            },
        });

        const existingPreviewId =
            '123e4567-e89b-42d3-a456-426614174217';
        await expect(
            authenticatedMutation({
                gateway,
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies/strategy-existing/confirmation-preview`,
                body: JSON.stringify({
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    basisSelection: { source: 'broker_average_cost' },
                    confirmationId: existingPreviewId,
                    expectedRevision: 1,
                    operationId: existingPreviewId,
                }),
            }),
        ).resolves.toMatchObject({
            status: 200,
            body: {
                brokerWriteAttempted: false,
                result: { state: 'previewed', brokerWriteAuthority: false },
            },
        });
        expect(calls[2]).toMatchObject({
            requestId: existingPreviewId,
            operationKind: 'strategy_confirmation_preview',
            mutation: {
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                basisSelection: { source: 'broker_average_cost' },
                confirmationId: existingPreviewId,
                contractEvidence,
                controlPlaneAuthority: authority,
                expectedRevision: 1,
                kind: 'strategy_confirmation_preview',
                strategyId: 'strategy-existing',
            },
        });

        const existingAcceptId =
            '123e4567-e89b-42d3-a456-426614174218';
        await expect(
            authenticatedMutation({
                gateway,
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies/strategy-existing/confirmation-accept`,
                body: JSON.stringify({
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    basisSelection: {
                        source: 'user_specified',
                        priceDecimal: '101',
                    },
                    confirmationId: existingPreviewId,
                    expectedRevision: 1,
                    operationId: existingAcceptId,
                    snapshotHash: `sha256:${'8'.repeat(64)}`,
                    userAcknowledged: true,
                }),
            }),
        ).resolves.toMatchObject({
            status: 200,
            body: {
                brokerWriteAttempted: false,
                result: { state: 'accepted', brokerWriteAuthority: false },
            },
        });
        expect(calls[3]).toMatchObject({
            requestId: existingAcceptId,
            operationKind: 'strategy_confirmation_accept',
            mutation: {
                confirmationId: existingPreviewId,
                kind: 'strategy_confirmation_accept',
                snapshotHash: `sha256:${'8'.repeat(64)}`,
                userAcknowledged: true,
            },
        });

        const quickPreviewId =
            '123e4567-e89b-42d3-a456-426614174219';
        await expect(
            authenticatedMutation({
                gateway,
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies/strategy-quick/confirmation-preview`,
                body: JSON.stringify({
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    basisSelection: null,
                    confirmationId: quickPreviewId,
                    expectedRevision: 1,
                    operationId: quickPreviewId,
                }),
            }),
        ).resolves.toMatchObject({
            status: 200,
            body: {
                brokerWriteAttempted: false,
                result: { state: 'previewed', brokerWriteAuthority: false },
            },
        });
        expect(calls[4]).toMatchObject({
            requestId: quickPreviewId,
            operationKind: 'strategy_confirmation_preview',
            mutation: {
                basisSelection: null,
                confirmationId: quickPreviewId,
                contractEvidence,
                controlPlaneAuthority: authority,
                kind: 'strategy_confirmation_preview',
                strategyId: 'strategy-quick',
            },
        });

        await expect(
            authenticatedMutation({
                gateway,
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/protected-entry/confirmation-preview`,
                body: JSON.stringify({ ...body, trusted: true }),
            }),
        ).resolves.toMatchObject({
            status: 400,
            body: {
                code: 'request_body_shape_invalid',
                brokerWriteAttempted: false,
            },
        });
        expect(calls).toHaveLength(5);
    });

    it('proxies only exact reason-specific resolution and two-confirmation relinquishment routes', async () => {
        const { root, storage } = await temporaryStorage();
        const gateway = await startGateway(root);
        const calls = [];
        const resolutionKey = `sha256:${'1'.repeat(64)}`;
        const projection = {
            schemaVersion:
                'smart-order-manual-resolution-list/2026-08-20.1',
            policySchemaVersion:
                'smart-order-manual-resolution/2026-08-11.6',
            strategyId: 'strategy_1',
            strategyRevision: 4,
            strategyState: 'manual_intervention',
            cases: [],
            genericResumeAllowed: false,
            brokerWriteAuthority: false,
        };
        await publishSidecar({
            storage,
            gateway,
            runtimeController: {
                async listManualResolutionCases(input) {
                    calls.push({ method: 'list', input });
                    return projection;
                },
                async executeReplayProtectedStrategyMutation(input) {
                    calls.push({ method: 'resolve', input });
                    return {
                        state: 'completed',
                        resultHash: `sha256:${'2'.repeat(64)}`,
                        result: {
                            schemaVersion:
                                'smart-order-manual-resolution-result/2026-08-20.1',
                            strategyId: 'strategy_1',
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
                        },
                    };
                },
                async prepareProtectionRelinquishment(input) {
                    calls.push({ method: 'relinquish-prepare', input });
                    return {
                        challengeId: input.operationId,
                        strategyId: input.strategyId,
                        brokerWriteAttempted: false,
                    };
                },
                async commitProtectionRelinquishment(input) {
                    calls.push({ method: 'relinquish-commit', input });
                    return {
                        strategyId: input.strategyId,
                        originalIntentRedispatchAllowed: false,
                        brokerWriteAttempted: false,
                    };
                },
            },
        });

        const prefix = `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies/strategy_1`;
        await expect(
            request({ gateway, pathname: `${prefix}/resolutions` }),
        ).resolves.toMatchObject({ status: 200, body: projection });

        const resolveOperationId =
            '123e4567-e89b-42d3-a456-426614174301';
        await expect(
            authenticatedMutation({
                gateway,
                pathname: `${prefix}/resolve-final`,
                body: JSON.stringify({
                    expectedRevision: 4,
                    operationId: resolveOperationId,
                    resolutionKey,
                    userAcknowledgedFinalEvidence: true,
                }),
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
        const prepareOperationId =
            '123e4567-e89b-42d3-a456-426614174302';
        await expect(
            authenticatedMutation({
                gateway,
                pathname: `${prefix}/relinquish-protection-prepare`,
                body: JSON.stringify({
                    expectedRevision: 4,
                    operationId: prepareOperationId,
                    operatorAcknowledgedManualHandoff: true,
                }),
            }),
        ).resolves.toMatchObject({
            status: 200,
            body: {
                brokerWriteAttempted: false,
                result: { brokerWriteAttempted: false },
            },
        });
        const commitOperationId =
            '123e4567-e89b-42d3-a456-426614174303';
        await expect(
            authenticatedMutation({
                gateway,
                pathname: `${prefix}/relinquish-protection-commit`,
                body: JSON.stringify({
                    challengeId: prepareOperationId,
                    expectedRevision: 4,
                    operationId: commitOperationId,
                    operatorAcknowledgedManualHandoff: true,
                }),
            }),
        ).resolves.toMatchObject({
            status: 200,
            body: {
                brokerWriteAttempted: false,
                result: {
                    originalIntentRedispatchAllowed: false,
                    brokerWriteAttempted: false,
                },
            },
        });
        expect(calls).toMatchObject([
            { method: 'list', input: { strategyId: 'strategy_1' } },
            {
                method: 'resolve',
                input: {
                    requestId: resolveOperationId,
                    operationKind:
                        'manual_resolution_apply_unique_final',
                    mutation: {
                        kind: 'manual_resolution_apply_unique_final',
                        strategyId: 'strategy_1',
                    },
                },
            },
            {
                method: 'relinquish-prepare',
                input: {
                    operationId: prepareOperationId,
                    strategyId: 'strategy_1',
                },
            },
            {
                method: 'relinquish-commit',
                input: {
                    challengeId: prepareOperationId,
                    operationId: commitOperationId,
                    strategyId: 'strategy_1',
                },
            },
        ]);

        await expect(
            authenticatedMutation({
                gateway,
                pathname: `${prefix}/resolve-final`,
                body: JSON.stringify({
                    expectedRevision: 4,
                    operationId:
                        '123e4567-e89b-42d3-a456-426614174304',
                    resolutionKey,
                    userAcknowledgedFinalEvidence: true,
                    clientProvenance: 'forged',
                }),
            }),
        ).resolves.toMatchObject({
            status: 400,
            body: {
                code: 'request_body_shape_invalid',
                brokerWriteAttempted: false,
            },
        });
        expect(calls).toHaveLength(4);
    });

    it('proxies only exact replay-protected kill-switch reads and mutations', async () => {
        const { root, storage } = await temporaryStorage();
        const gateway = await startGateway(root);
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
        await publishSidecar({
            storage,
            gateway,
            runtimeController: {
                async killSwitchStatus() {
                    return initial;
                },
                async executeReplayProtectedStrategyMutation(input) {
                    calls.push(input);
                    return {
                        state: 'completed',
                        resultHash: `sha256:${'d'.repeat(64)}`,
                        result: {
                            ...initial,
                            arbiterRevision: 1,
                            switches: {
                                ...initial.switches,
                                pause_new_exposure: {
                                    enabled: true,
                                    revision: 1,
                                    updatedAtEpochMs: NOW,
                                    reasonCode: 'operator_pause',
                                },
                            },
                            enabled: ['pause_new_exposure'],
                            denyUnionActive: true,
                            changed: true,
                            replayed: false,
                        },
                    };
                },
            },
        });
        await expect(
            request({
                gateway,
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/risk/kill-switch`,
            }),
        ).resolves.toMatchObject({
            status: 200,
            body: { arbiterRevision: 0, brokerWriteAuthority: false },
        });
        const operationId = '123e4567-e89b-42d3-a456-426614174209';
        const body = JSON.stringify({
            enabled: true,
            expectedArbiterRevision: 0,
            operationId,
            reasonCode: 'operator_pause',
            switchName: 'pause_new_exposure',
        });
        await expect(
            authenticatedMutation({
                gateway,
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/risk/kill-switch`,
                method: 'PUT',
                body,
            }),
        ).resolves.toMatchObject({
            status: 200,
            body: {
                brokerWriteAttempted: false,
                result: {
                    arbiterRevision: 1,
                    enabled: ['pause_new_exposure'],
                    brokerWriteAuthority: false,
                },
            },
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            requestId: operationId,
            operationKind: 'risk_kill_switch',
            mutation: { kind: 'risk_kill_switch' },
        });

        for (const invalid of [
            { ...JSON.parse(body), switchName: 'not_a_switch' },
            { ...JSON.parse(body), reasonCode: 'free form secret' },
            { ...JSON.parse(body), expectedArbiterRevision: -1 },
        ]) {
            invalid.operationId = randomUUID();
            await expect(
                authenticatedMutation({
                    gateway,
                    pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/risk/kill-switch`,
                    method: 'PUT',
                    body: JSON.stringify(invalid),
                }),
            ).resolves.toMatchObject({
                status: 400,
                body: {
                    code: 'request_body_shape_invalid',
                    brokerWriteAttempted: false,
                },
            });
        }
        expect(calls).toHaveLength(1);
    });

    it('refuses repository-contained capability roots before reading authority', async () => {
        const repositoryRoot = smartOrderRepositoryRootForTest();
        await expect(
            readSmartOrderGatewayAuthority({
                appSupportRoot: repositoryRoot,
                nowEpochMs: NOW,
            }),
        ).rejects.toThrow(/outside the source repository/);

        const aliasParent = await mkdtemp(
            path.join(tmpdir(), 'smart-order-gateway-alias-'),
        );
        roots.push(aliasParent);
        const alias = path.join(aliasParent, 'repository-alias');
        await symlink(repositoryRoot, alias);
        await expect(
            readSmartOrderGatewayAuthority({
                appSupportRoot: path.join(alias, 'private-root'),
                nowEpochMs: NOW,
            }),
        ).rejects.toThrow(/outside the source repository/);
    });

    it('enforces the CSRF session, expiry, cross-session and replay contract without requiring sidecar authority', async () => {
        let csrfNow = NOW;
        const gateway = await startGateway(
            '/private/tmp/missing-smart-order-gateway-authority',
            {
            now: () => csrfNow,
            csrfTokenTtlMs: 1_000,
            csrfSessionTtlMs: 2_000,
            },
        );
        const csrfPath = `${SMART_ORDER_VITE_GATEWAY_PREFIX}${SMART_ORDER_BROWSER_CSRF_ROUTE}`;
        const issue = async (cookie) => {
            const response = await request({
                gateway,
                pathname: csrfPath,
                headers: browserHeaders(gateway, cookie ? { Cookie: cookie } : {}),
            });
            expect(response).toMatchObject({
                status: 200,
                body: {
                    schemaVersion: 'smart-order-browser-csrf/2026-08-11.1',
                    sessionBound: true,
                    singleUse: true,
                },
            });
            const setCookie = Array.isArray(response.headers['set-cookie'])
                ? response.headers['set-cookie'][0]
                : response.headers['set-cookie'];
            return {
                cookie: setCookie.split(';', 1)[0],
                csrfToken: response.body.csrfToken,
            };
        };
        const mutationBody = JSON.stringify({
            operationId: '123e4567-e89b-42d3-a456-426614174000',
            strategyKind: 'trailing_exit',
        });
        const mutationPath = `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies`;
        const mutate = (credential, token = credential?.csrfToken) =>
            request({
                gateway,
                pathname: mutationPath,
                method: 'POST',
                headers: browserHeaders(gateway, {
                    ...(credential ? { Cookie: credential.cookie } : {}),
                    ...(token
                        ? { [SMART_ORDER_BROWSER_CSRF_HEADER]: token }
                        : {}),
                    'Content-Type': 'application/json',
                    'Content-Length': String(Buffer.byteLength(mutationBody)),
                }),
                body: mutationBody,
            });

        await expect(
            request({
                gateway,
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/status`,
                headers: browserHeaders(gateway),
            }),
        ).resolves.toMatchObject({
            status: 503,
            body: { code: 'smart_order_runtime_unavailable' },
        });
        await expect(mutate()).resolves.toMatchObject({
            status: 403,
            body: { code: 'csrf_token_required' },
        });
        const sessionA = await issue();
        const sessionB = await issue();
        await expect(mutate(sessionA, 'x'.repeat(43))).resolves.toMatchObject({
            status: 403,
            body: { code: 'csrf_token_invalid' },
        });
        await expect(
            mutate({
                cookie: sessionB.cookie,
                csrfToken: sessionA.csrfToken,
            }),
        ).resolves.toMatchObject({
            status: 403,
            body: { code: 'csrf_token_invalid' },
        });
        await expect(mutate(sessionA)).resolves.toMatchObject({
            status: 503,
            body: { code: 'smart_order_runtime_unavailable' },
        });
        await expect(mutate(sessionA)).resolves.toMatchObject({
            status: 403,
            body: { code: 'csrf_token_invalid' },
        });
        for (const kind of canonicalSmartOrderDraftKinds) {
            // Schema coverage is independent from the per-session mutation
            // limiter.  Use a fresh browser session for each discriminator so
            // this test cannot accidentally weaken or overrun that limiter.
            const credential = await issue();
            const body = JSON.stringify({
                operationId: '123e4567-e89b-42d3-a456-426614174000',
                expectedRevision: 0,
                draft: canonicalSmartOrderDraft(kind),
            });
            await expect(
                request({
                    gateway,
                    pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies/draft_1`,
                    method: 'PUT',
                    headers: browserHeaders(gateway, {
                        Cookie: credential.cookie,
                        [SMART_ORDER_BROWSER_CSRF_HEADER]:
                            credential.csrfToken,
                        'Content-Type': 'application/json',
                        'Content-Length': String(Buffer.byteLength(body)),
                    }),
                    body,
                }),
            ).resolves.toMatchObject({
                status: 503,
                body: { code: 'smart_order_runtime_unavailable' },
            });
        }
        const invalidDraftCredential = await issue(sessionA.cookie);
        const invalidDraftBody = JSON.stringify({
            operationId: '123e4567-e89b-42d3-a456-426614174000',
            expectedRevision: 0,
            draft: { kind: 'quick', fields: {} },
        });
        await expect(
            request({
                gateway,
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies/draft_1`,
                method: 'PUT',
                headers: browserHeaders(gateway, {
                    Cookie: invalidDraftCredential.cookie,
                    [SMART_ORDER_BROWSER_CSRF_HEADER]:
                        invalidDraftCredential.csrfToken,
                    'Content-Type': 'application/json',
                    'Content-Length': String(
                        Buffer.byteLength(invalidDraftBody),
                    ),
                }),
                body: invalidDraftBody,
            }),
        ).resolves.toMatchObject({
            status: 400,
            body: { code: 'request_body_shape_invalid' },
        });
        const expiring = await issue(sessionA.cookie);
        csrfNow += 1_001;
        await expect(mutate(expiring)).resolves.toMatchObject({
            status: 403,
            body: { code: 'csrf_token_invalid' },
        });
    });

    it('proxies a valid loopback same-origin read without exposing capability or internal proof', async () => {
        const { root, storage } = await temporaryStorage();
        const gateway = await startGateway(root);
        await publishSidecar({ storage, gateway });
        const capability = await readPrivateSecret(storage.paths.capabilityPath);
        const response = await request({ gateway });

        expect(response).toMatchObject({
            status: 200,
            body: {
                controlPlane: 'loopback_authenticated',
                secretValuesExposed: false,
            },
        });
        expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
        expect(response.rawBody.includes(Buffer.from(capability))).toBe(false);
        expect(JSON.stringify(response.headers)).not.toMatch(
            /gateway-proof|request-id|gateway-timestamp|capability/i,
        );
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
        expect(response.headers['cache-control']).toBe('no-store');
        capability.fill(0);

        await expect(
            request({
                gateway,
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/health`,
            }),
        ).resolves.toMatchObject({
            status: 200,
            body: { status: 'ok', writeEnabled: false },
        });

        const standardGetHeaders = browserHeaders(gateway, {
            Referer: `http://127.0.0.1:${gateway.port}/trading`,
        });
        delete standardGetHeaders.Origin;
        await expect(
            request({ gateway, headers: standardGetHeaders }),
        ).resolves.toMatchObject({ status: 200 });

        const mutationBody = JSON.stringify({
            operationId: '123e4567-e89b-42d3-a456-426614174000',
            strategyKind: 'trailing_exit',
        });
        await expect(
            authenticatedMutation({
                gateway,
                method: 'POST',
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies`,
                body: mutationBody,
            }),
        ).resolves.toMatchObject({
            status: 503,
            body: {
                code: 'mutation_service_not_wired',
                brokerWriteAttempted: false,
            },
        });

        const updateBody = JSON.stringify({
            operationId: '123e4567-e89b-42d3-a456-426614174000',
            expectedRevision: 0,
            draft: canonicalSmartOrderDraft('trailing_exit'),
        });
        await expect(
            authenticatedMutation({
                gateway,
                method: 'PUT',
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies/draft_1`,
                body: updateBody,
            }),
        ).resolves.toMatchObject({
            status: 503,
            body: {
                code: 'mutation_service_not_wired',
                brokerWriteAttempted: false,
            },
        });
    });

    it('converts authenticated bounded event snapshots into redacted cursor SSE frames', async () => {
        const { root, storage } = await temporaryStorage();
        const gateway = await startGateway(root);
        const calls = [];
        await publishSidecar({
            storage,
            gateway,
            runtimeController: {
                async listEvents(input) {
                    calls.push(input);
                    if (input.afterSequence === null) {
                        return {
                            schemaVersion:
                                'smart-order-event-projection/2026-08-11.1',
                            cursorStatus: 'initialized',
                            fromSequence: null,
                            nextSequence: 4,
                            highWaterSequence: 4,
                            events: [],
                            accountIdentifiersExposed: false,
                            entityIdentifiersExposed: false,
                            journalPayloadExposed: false,
                        };
                    }
                    return {
                        schemaVersion:
                            'smart-order-event-projection/2026-08-11.1',
                        cursorStatus: 'current',
                        fromSequence: input.afterSequence,
                        nextSequence: 5,
                        highWaterSequence: 5,
                        events: [
                            {
                                sequence: 5,
                                entityKind: 'strategy',
                                reasonCode: 'STRATEGY_PERSISTED',
                                revision: 1,
                                summaryCode: 'strategy_state_changed',
                                exchangeEpochMs: null,
                                brokerEpochMs: null,
                                receiveEpochMs: NOW,
                            },
                        ],
                        accountIdentifiersExposed: false,
                        entityIdentifiersExposed: false,
                        journalPayloadExposed: false,
                    };
                },
            },
        });

        const eventPath = `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/events`;
        const initialized = await request({
            gateway,
            pathname: eventPath,
            headers: browserHeaders(gateway, {
                Accept: 'text/event-stream',
            }),
        });
        expect(initialized.status).toBe(200);
        expect(initialized.headers['content-type']).toMatch(
            /^text\/event-stream/,
        );
        expect(initialized.body).toContain('event: cursor');
        expect(initialized.body).toContain('id: 4');

        const current = await request({
            gateway,
            pathname: eventPath,
            headers: browserHeaders(gateway, {
                Accept: 'text/event-stream',
                'Last-Event-ID': '4',
            }),
        });
        expect(current.status).toBe(200);
        expect(current.body).toContain('event: smart-order');
        expect(current.body).toContain('id: 5');
        expect(current.body).toContain('STRATEGY_PERSISTED');
        expect(current.body).not.toMatch(
            /strategyId|accountId|payloadHash|journalPayload\"/,
        );
        expect(calls).toEqual([
            { afterSequence: null, limit: 100 },
            { afterSequence: 4, limit: 100 },
        ]);

        await expect(
            request({
                gateway,
                pathname: eventPath,
                headers: browserHeaders(gateway, {
                    Accept: 'text/event-stream',
                    'Last-Event-ID': '9007199254740992',
                }),
            }),
        ).resolves.toMatchObject({
            status: 400,
            body: { code: 'event_cursor_or_accept_invalid' },
        });
        await expect(
            request({ gateway, pathname: eventPath }),
        ).resolves.toMatchObject({
            status: 400,
            body: { code: 'event_cursor_or_accept_invalid' },
        });

        const foreignOriginHeaders = browserHeaders(gateway, {
            Accept: 'text/event-stream',
            Origin: 'https://attacker.example',
        });
        await expect(
            request({
                gateway,
                pathname: eventPath,
                headers: foreignOriginHeaders,
            }),
        ).resolves.toMatchObject({
            status: 403,
            body: {
                code: 'origin_or_fetch_metadata_not_allowed',
                brokerWriteAttempted: false,
            },
        });
        expect(initialized.headers['access-control-allow-origin']).toBeUndefined();
        expect(current.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('requires a short-lived single-use CSRF token bound to one Vite browser session only for mutations', async () => {
        const { root, storage } = await temporaryStorage();
        const gateway = await startGateway(root);
        await publishSidecar({ storage, gateway });

        await expect(request({ gateway })).resolves.toMatchObject({
            status: 200,
        });
        const mutationBody = JSON.stringify({
            operationId: '123e4567-e89b-42d3-a456-426614174000',
            strategyKind: 'trailing_exit',
        });
        const mutationPath = `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies`;
        const baseMutationHeaders = {
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(mutationBody)),
        };
        await expect(
            request({
                gateway,
                pathname: mutationPath,
                method: 'POST',
                headers: browserHeaders(gateway, baseMutationHeaders),
                body: mutationBody,
            }),
        ).resolves.toMatchObject({
            status: 403,
            body: { code: 'csrf_token_required' },
        });

        const sessionA = await issueCsrfCredential(gateway);
        const sessionB = await issueCsrfCredential(gateway);
        await expect(
            request({
                gateway,
                pathname: mutationPath,
                method: 'POST',
                headers: browserHeaders(gateway, {
                    ...baseMutationHeaders,
                    Cookie: sessionA.cookie,
                    [SMART_ORDER_BROWSER_CSRF_HEADER]: 'x'.repeat(43),
                }),
                body: mutationBody,
            }),
        ).resolves.toMatchObject({
            status: 403,
            body: { code: 'csrf_token_invalid' },
        });
        await expect(
            authenticatedMutation({
                gateway,
                pathname: mutationPath,
                body: mutationBody,
                credential: {
                    cookie: sessionB.cookie,
                    csrfToken: sessionA.csrfToken,
                },
            }),
        ).resolves.toMatchObject({
            status: 403,
            body: { code: 'csrf_token_invalid' },
        });
        await expect(
            authenticatedMutation({
                gateway,
                pathname: mutationPath,
                body: mutationBody,
                credential: sessionA,
            }),
        ).resolves.toMatchObject({
            status: 503,
            body: { code: 'mutation_service_not_wired' },
        });
        await expect(
            authenticatedMutation({
                gateway,
                pathname: mutationPath,
                body: mutationBody,
                credential: sessionA,
            }),
        ).resolves.toMatchObject({
            status: 403,
            body: { code: 'csrf_token_invalid' },
        });

        for (const [pathname, body] of [
            [
                `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies/strategy_1/resume`,
                JSON.stringify({
                    activationPolicyAcknowledged: true,
                    expectedRevision: 1,
                    operationId: '123e4567-e89b-42d3-a456-426614174001',
                }),
            ],
            [
                `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies/strategy_1/cancel-broker-order`,
                JSON.stringify({
                    expectedRevision: 1,
                    operationId: '123e4567-e89b-42d3-a456-426614174002',
                    userConfirmationAcknowledged: true,
                }),
            ],
            [
                `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies/strategy_1/update-broker-order`,
                JSON.stringify({
                    expectedRevision: 1,
                    operationId: '123e4567-e89b-42d3-a456-426614174004',
                    quantityShares: 500,
                    userConfirmationAcknowledged: true,
                }),
            ],
        ]) {
            await expect(
                authenticatedMutation({
                    gateway,
                    pathname,
                    body,
                }),
            ).resolves.toMatchObject({
                status: 503,
                body: { code: 'mutation_service_not_wired' },
            });
        }
        await expect(
            authenticatedMutation({
                gateway,
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies/strategy_1/cancel-broker-order`,
                body: JSON.stringify({
                    expectedRevision: 1,
                    operationId: '123e4567-e89b-42d3-a456-426614174003',
                }),
            }),
        ).resolves.toMatchObject({
            status: 400,
            body: { code: 'request_body_shape_invalid' },
        });

        let csrfNow = NOW;
        const expiringGateway = await startGateway(root, {
            now: () => csrfNow,
            csrfTokenTtlMs: 1_000,
            csrfSessionTtlMs: 2_000,
        });
        const expiring = await issueCsrfCredential(expiringGateway);
        csrfNow += 1_001;
        await expect(
            authenticatedMutation({
                gateway: expiringGateway,
                pathname: mutationPath,
                body: mutationBody,
                credential: expiring,
            }),
        ).resolves.toMatchObject({
            status: 403,
            body: { code: 'csrf_token_invalid' },
        });
    });

    it('proxies only canonical route-bound stock writes and keeps broker authority closed', async () => {
        const { root, storage } = await temporaryStorage();
        const gateway = await startGateway(root);
        await publishSidecar({ storage, gateway });
        const requestBody = {
            operationId: '123e4567-e89b-42d3-a456-426614174010',
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
            },
        };
        await expect(
            authenticatedMutation({
                gateway,
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/trading-write/STK-MAN-PLACE-TICKET`,
                body: JSON.stringify(requestBody),
            }),
        ).resolves.toMatchObject({
            status: 423,
            body: {
                code: 'broker_write_gate_closed',
                classified: true,
                provenance: 'manual_user_confirmed',
                automationAccountEligibility: 'disabled',
                brokerWriteAttempted: false,
                brokerWriteAuthority: false,
                writeMasterAuthority: false,
            },
        });

        const confused = structuredClone(requestBody);
        confused.operationId = '123e4567-e89b-42d3-a456-426614174011';
        confused.request.brokerPath = '/api/v1/order/cancel_order';
        await expect(
            authenticatedMutation({
                gateway,
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/trading-write/STK-MAN-PLACE-TICKET`,
                body: JSON.stringify(confused),
            }),
        ).resolves.toMatchObject({
            status: 400,
            body: { code: 'request_body_shape_invalid' },
        });
    });

    it('accepts only the seven versioned canonical draft discriminators and rejects unknown or non-first-phase fields', async () => {
        const { root, storage } = await temporaryStorage();
        const gateway = await startGateway(root);
        await publishSidecar({ storage, gateway });
        const pathname = `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies/draft_1`;

        for (const kind of canonicalSmartOrderDraftKinds) {
            const body = JSON.stringify({
                operationId: '123e4567-e89b-42d3-a456-426614174000',
                expectedRevision: 0,
                draft: canonicalSmartOrderDraft(kind),
            });
            await expect(
                authenticatedMutation({
                    gateway,
                    pathname,
                    method: 'PUT',
                    body,
                }),
            ).resolves.toMatchObject({
                status: 503,
                body: { code: 'mutation_service_not_wired' },
            });
        }

        const extraRootField = canonicalSmartOrderDraft('quick');
        extraRootField.unknown = true;
        const discriminatorMismatch = canonicalSmartOrderDraft('quick');
        discriminatorMismatch.kind = 'good_till';
        const foreignContract = canonicalSmartOrderDraft('quick');
        foreignContract.parameters.order.contractKey = 'NASDAQ:STK:AAPL';
        const unsupportedOrderCond = canonicalSmartOrderDraft('quick');
        unsupportedOrderCond.parameters.order.orderCond = 'MarginTrading';
        const unsupportedLot = canonicalSmartOrderDraft('quick');
        unsupportedLot.parameters.order.orderLot = 'IntradayOdd';
        const unsupportedMarketRod = canonicalSmartOrderDraft('quick');
        unsupportedMarketRod.parameters.order.priceType = 'MKT';
        unsupportedMarketRod.parameters.order.limitPrice = null;
        const nestedUnknown = canonicalSmartOrderDraft('quick');
        nestedUnknown.parameters.order.provenance = 'manual_user_confirmed';

        for (const draft of [
            {},
            extraRootField,
            discriminatorMismatch,
            foreignContract,
            unsupportedOrderCond,
            unsupportedLot,
            unsupportedMarketRod,
            nestedUnknown,
        ]) {
            const body = JSON.stringify({
                operationId: '123e4567-e89b-42d3-a456-426614174000',
                expectedRevision: 0,
                draft,
            });
            await expect(
                authenticatedMutation({
                    gateway,
                    pathname,
                    method: 'PUT',
                    body,
                }),
            ).resolves.toMatchObject({
                status: 400,
                body: {
                    code: 'request_body_shape_invalid',
                    brokerWriteAttempted: false,
                },
            });
        }
    });

    it('leaves unrelated Vite routes alone but default-denies query, encoding, method, and route confusion', async () => {
        const { root, storage } = await temporaryStorage();
        const gateway = await startGateway(root);
        await publishSidecar({ storage, gateway });
        await expect(request({ gateway, pathname: '/ordinary-app-route' })).resolves.toMatchObject(
            { status: 418, body: 'next' },
        );

        for (const candidate of [
            `${SMART_ORDER_VITE_GATEWAY_PREFIX}`,
            `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/status?next=/v1/strategies`,
            `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/%73tatus`,
            `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1//status`,
            `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/status/`,
            `${SMART_ORDER_VITE_GATEWAY_PREFIX}/V1/status`,
            `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/unknown`,
            `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/gate-manifest/recompute`,
            `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/gate-probe/status`,
        ]) {
            await expect(
                request({ gateway, pathname: candidate }),
            ).resolves.toMatchObject({
                status: 404,
                body: { code: 'route_or_method_not_allowed' },
            });
        }
        await expect(
            request({ gateway, method: 'DELETE' }),
        ).resolves.toMatchObject({
            status: 404,
            body: { code: 'route_or_method_not_allowed' },
        });
        await expect(
            request({
                gateway,
                method: 'POST',
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/gate-manifest/recompute`,
                body: '{"operationId":"123e4567-e89b-42d3-a456-426614174017"}',
            }),
        ).resolves.toMatchObject({
            status: 404,
                body: { code: 'route_or_method_not_allowed' },
            });
        await expect(
            request({
                gateway,
                method: 'POST',
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/gate-probe/prepare`,
                body: '{}',
            }),
        ).resolves.toMatchObject({
            status: 404,
            body: { code: 'route_or_method_not_allowed' },
        });
    });

    it('rejects malicious Host, foreign Origin, Cloudflare/tunnel headers, and navigation fetch metadata before proxying', async () => {
        const { root, storage } = await temporaryStorage();
        const gateway = await startGateway(root);
        await publishSidecar({ storage, gateway });
        const cases = [
            { Host: `localhost:${gateway.port}` },
            { Host: `127.0.0.1.nip.io:${gateway.port}` },
            { Origin: 'https://attacker.example' },
            { Origin: 'https://realtimestock.pages.dev' },
            { Referer: 'https://attacker.example/trading' },
            { 'Sec-Fetch-Site': 'cross-site' },
            { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' },
            { Forwarded: 'for=203.0.113.10;host=public.example' },
            { 'X-Forwarded-For': '203.0.113.10' },
            { 'CF-Connecting-IP': '203.0.113.10' },
            { 'CF-Ray': 'test-edge-ray' },
            { Via: 'cloudflare' },
            { 'X-RealTimeStock-Gateway-Proof': 'client-forged' },
            { 'X-RealTimeStock-Provenance': 'manual_user_confirmed' },
        ];
        for (const hostile of cases) {
            const response = await request({
                gateway,
                headers: browserHeaders(gateway, hostile),
            });
            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({
                brokerWriteAttempted: false,
            });
        }
        const noOriginHeaders = browserHeaders(gateway);
        delete noOriginHeaders.Origin;
        await expect(
            request({ gateway, headers: noOriginHeaders }),
        ).resolves.toMatchObject({ status: 403 });

        const mutationWithRefererOnly = browserHeaders(gateway, {
            Referer: `http://127.0.0.1:${gateway.port}/trading`,
            'Content-Type': 'application/json',
            'Content-Length': '2',
        });
        delete mutationWithRefererOnly.Origin;
        await expect(
            request({
                gateway,
                method: 'POST',
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies`,
                headers: mutationWithRefererOnly,
                body: '{}',
            }),
        ).resolves.toMatchObject({ status: 403 });
    });

    it('rejects non-loopback socket context in the pure boundary', () => {
        const rawHeaders = Object.entries({
            Host: '127.0.0.1:5173',
            Origin: 'http://127.0.0.1:5173',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Dest': 'empty',
        }).flat();
        const decision = authorizeSmartOrderBrowserGatewayRequest({
            url: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/status`,
            method: 'GET',
            rawHeaders,
            socket: {
                remoteAddress: '192.168.1.20',
                localAddress: '127.0.0.1',
                localPort: 5173,
            },
        });
        expect(decision).toMatchObject({
            handled: true,
            allowed: false,
            reason: 'non_loopback_gateway_forbidden',
        });
    });

    it('rejects duplicate headers, form/chunked mutations, GET bodies, and oversized declarations', async () => {
        const { root, storage } = await temporaryStorage();
        const gateway = await startGateway(root);
        await publishSidecar({ storage, gateway });
        const duplicate = await rawRequest({
            gateway,
            payload: [
                `GET ${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/status HTTP/1.1`,
                `Host: 127.0.0.1:${gateway.port}`,
                `Origin: http://127.0.0.1:${gateway.port}`,
                `Origin: http://127.0.0.1:${gateway.port}`,
                'Sec-Fetch-Site: same-origin',
                'Sec-Fetch-Mode: cors',
                'Sec-Fetch-Dest: empty',
                'Connection: close',
                '',
                '',
            ].join('\r\n'),
        });
        expect(duplicate).toMatch(/^HTTP\/1\.1 400 /);

        await expect(
            request({
                gateway,
                method: 'POST',
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies`,
                headers: browserHeaders(gateway, {
                    'Content-Type': 'text/plain',
                    'Content-Length': '2',
                }),
                body: '{}',
            }),
        ).resolves.toMatchObject({ status: 415 });
        await expect(
            request({
                gateway,
                method: 'POST',
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies`,
                headers: browserHeaders(gateway, {
                    'Content-Type': 'application/json',
                }),
                body: '{}',
            }),
        ).resolves.toMatchObject({
            status: 400,
            body: { code: 'request_body_shape_invalid' },
        });
        await expect(
            request({
                gateway,
                headers: browserHeaders(gateway, {
                    'Content-Length': '1',
                }),
                body: 'x',
            }),
        ).resolves.toMatchObject({ status: 400 });
        await expect(
            request({
                gateway,
                method: 'POST',
                pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies`,
                headers: browserHeaders(gateway, {
                    'Content-Type': 'application/json',
                    'Content-Length': String(64 * 1024 + 1),
                }),
            }),
        ).resolves.toMatchObject({ status: 413 });
        for (const malformedBody of ['not-json', '[]', '{"__proto__":{}}']) {
            const credential = await issueCsrfCredential(gateway);
            await expect(
                request({
                    gateway,
                    method: 'POST',
                    pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies`,
                    headers: browserHeaders(gateway, {
                        Cookie: credential.cookie,
                        [SMART_ORDER_BROWSER_CSRF_HEADER]:
                            credential.csrfToken,
                        'Content-Type': 'application/json',
                        'Content-Length': String(
                            Buffer.byteLength(malformedBody),
                        ),
                    }),
                    body: malformedBody,
                }),
            ).resolves.toMatchObject({
                status: 400,
                body: { code: 'request_body_shape_invalid' },
            });
        }

        for (const invalidSchema of [
            {
                operationId: '123e4567-e89b-42d3-a456-426614174000',
                strategyKind: 'unknown_kind',
            },
            {
                operationId: '123e4567-e89b-42d3-a456-426614174000',
                strategyKind: 'trailing_exit',
                workspaceContractKey: 'TSE:2330',
            },
            {
                operationId: '123e4567-e89b-42d3-a456-426614174000',
                strategyKind: 'trailing_exit',
                provenance: 'manual_user_confirmed',
            },
        ]) {
            const serialized = JSON.stringify(invalidSchema);
            await expect(
                authenticatedMutation({
                    gateway,
                    method: 'POST',
                    pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies`,
                    body: serialized,
                }),
            ).resolves.toMatchObject({
                status: 400,
                body: {
                    code: 'request_body_shape_invalid',
                    brokerWriteAttempted: false,
                },
            });
        }
    });

    it('fails closed for missing, symlinked, broad-mode, malformed, or non-loopback private authority files', async () => {
        const { root, storage } = await temporaryStorage();
        const gateway = await startGateway(root);
        await expect(request({ gateway })).resolves.toMatchObject({
            status: 503,
            body: {
                code: 'smart_order_runtime_unavailable',
                brokerWriteAttempted: false,
            },
        });

        const invalidRootMiddleware =
            createSmartOrderSameOriginGatewayMiddleware({
                appSupportRoot: 'relative-path-is-never-authority',
                now: () => NOW,
            });
        const invalidRootServer = http.createServer(
            (incoming, outgoing) =>
                invalidRootMiddleware(incoming, outgoing, () => {
                    outgoing.statusCode = 418;
                    outgoing.end('next');
                }),
        );
        await new Promise((resolve, reject) => {
            invalidRootServer.once('error', reject);
            invalidRootServer.listen({ host: '127.0.0.1', port: 0 }, resolve);
        });
        servers.push({ close: () => closeHttpServer(invalidRootServer) });
        const invalidRootGateway = {
            host: '127.0.0.1',
            port: invalidRootServer.address().port,
        };
        await expect(
            request({ gateway: invalidRootGateway }),
        ).resolves.toMatchObject({
            status: 503,
            body: { code: 'smart_order_runtime_unavailable' },
        });

        const sidecar = await publishSidecar({ storage, gateway });
        const originalCapability = await readPrivateSecret(
            storage.paths.capabilityPath,
        );
        await writePrivateRuntimeDiscovery(
            storage.paths.controlPlaneDiscoveryPath,
            {
                schemaVersion: 'smart-order-local-sidecar/2026-08-11.1',
                host: '127.0.0.1',
                port: sidecar.port,
                runtimeEpochId: 'runtime-epoch-stale-discovery',
                startedAtEpochMs: NOW,
            },
        );
        await expect(request({ gateway })).resolves.toMatchObject({
            status: 503,
            body: { code: 'smart_order_runtime_unavailable' },
        });
        await writePrivateRuntimeDiscovery(
            storage.paths.controlPlaneDiscoveryPath,
            {
                schemaVersion: 'smart-order-local-sidecar/2026-08-11.1',
                host: '127.0.0.1',
                port: sidecar.port,
                runtimeEpochId: RUNTIME_EPOCH_ID,
                startedAtEpochMs: NOW,
            },
        );
        await chmod(storage.paths.capabilityPath, 0o644);
        await expect(request({ gateway })).resolves.toMatchObject({ status: 503 });
        await chmod(storage.paths.capabilityPath, 0o600);

        await writeFile(storage.paths.capabilityPath, randomBytes(32), {
            mode: 0o600,
        });
        await expect(request({ gateway })).resolves.toMatchObject({
            status: 503,
            body: { code: 'smart_order_runtime_unavailable' },
        });
        await writeFile(storage.paths.capabilityPath, originalCapability, {
            mode: 0o600,
        });

        const outside = path.join(root, 'outside-discovery');
        await writeFile(outside, '{}\n', { mode: 0o600 });
        await unlink(storage.paths.controlPlaneDiscoveryPath);
        await symlink(outside, storage.paths.controlPlaneDiscoveryPath);
        await expect(request({ gateway })).resolves.toMatchObject({ status: 503 });
        await unlink(storage.paths.controlPlaneDiscoveryPath);

        await writePrivateRuntimeDiscovery(
            storage.paths.controlPlaneDiscoveryPath,
            {
                schemaVersion: 'smart-order-local-sidecar/2026-08-11.1',
                host: '127.0.0.1',
                port: sidecar.port,
                runtimeEpochId: 'runtime-epoch-test-1',
                startedAtEpochMs: NOW,
            },
        );
        const outsideCapability = path.join(root, 'outside-capability');
        await writeFile(outsideCapability, originalCapability, { mode: 0o600 });
        await unlink(storage.paths.capabilityPath);
        await symlink(outsideCapability, storage.paths.capabilityPath);
        await expect(request({ gateway })).resolves.toMatchObject({ status: 503 });
        await unlink(storage.paths.capabilityPath);
        await writeFile(storage.paths.capabilityPath, originalCapability, {
            mode: 0o600,
        });

        await writeFile(storage.paths.controlPlaneDiscoveryPath, '{bad-json\n', {
            mode: 0o600,
        });
        await expect(request({ gateway })).resolves.toMatchObject({ status: 503 });

        await writeFile(
            storage.paths.controlPlaneDiscoveryPath,
            `${JSON.stringify({
                schemaVersion: 'smart-order-local-sidecar/2026-08-11.1',
                host: '0.0.0.0',
                port: 6553,
                runtimeEpochId: 'runtime-epoch-test-1',
                startedAtEpochMs: NOW,
            })}\n`,
            { mode: 0o600 },
        );
        await expect(request({ gateway })).resolves.toMatchObject({ status: 503 });
        originalCapability.fill(0);
    });

    it('encrypts mutation bodies and rejects a stale discovery port impostor response', async () => {
        const { storage, root } = await temporaryStorage();
        const gateway = await startGateway(root);
        let receivedHeaders;
        let receivedBody;
        let resolveReceived;
        const received = new Promise((resolve) => {
            resolveReceived = resolve;
        });
        const impostor = http.createServer((incoming, response) => {
            receivedHeaders = incoming.headers;
            const chunks = [];
            incoming.on('data', (chunk) => chunks.push(chunk));
            incoming.on('end', () => {
                receivedBody = Buffer.concat(chunks);
                response.statusCode = 200;
                response.setHeader('Content-Type', 'application/json');
                response.end('{"accepted":true}\n');
                resolveReceived();
            });
        });
        await new Promise((resolve, reject) => {
            impostor.once('error', reject);
            impostor.listen({ host: '127.0.0.1', port: 0 }, resolve);
        });
        servers.push({ close: () => closeHttpServer(impostor) });
        await writePrivateRuntimeDiscovery(
            storage.paths.controlPlaneDiscoveryPath,
            {
                schemaVersion: 'smart-order-local-sidecar/2026-08-11.1',
                host: '127.0.0.1',
                port: impostor.address().port,
                runtimeEpochId: 'runtime-epoch-stale-port',
                startedAtEpochMs: NOW,
            },
        );
        const plaintext = JSON.stringify({
            operationId: '123e4567-e89b-42d3-a456-426614174000',
            strategyKind: 'trailing_exit',
            workspaceContractKey: 'TSE:STK:2330',
        });
        const response = await authenticatedMutation({
            gateway,
            method: 'POST',
            pathname: `${SMART_ORDER_VITE_GATEWAY_PREFIX}/v1/strategies`,
            body: plaintext,
        });
        await received;
        expect(response).toMatchObject({
            status: 503,
            body: { code: 'smart_order_runtime_unavailable' },
        });
        expect(receivedHeaders['content-type']).toBe(
            'application/vnd.realtimestock.smart-order-envelope',
        );
        expect(receivedHeaders['x-realtimestock-envelope-nonce']).toMatch(
            /^[A-Za-z0-9_-]{16}$/,
        );
        expect(receivedHeaders['x-realtimestock-runtime-epoch']).toBe(
            'runtime-epoch-stale-port',
        );
        expect(receivedHeaders.cookie).toBeUndefined();
        expect(
            receivedHeaders[SMART_ORDER_BROWSER_CSRF_HEADER.toLowerCase()],
        ).toBeUndefined();
        expect(receivedBody.toString('utf8')).not.toContain('trailing_exit');
        expect(receivedBody.toString('utf8')).not.toContain('TSE:STK:2330');
        expect(JSON.stringify(response.headers)).not.toMatch(
            /response-proof|gateway-proof|envelope-nonce|runtime-epoch/i,
        );
    });

    it('bounds and sanitizes the upstream response and never follows a redirect', async () => {
        const { root, storage } = await temporaryStorage();
        const gateway = await startGateway(root);
        let receivedHeaders;
        let behavior = 'redirect';
        const fakeSidecar = http.createServer((incoming, response) => {
            receivedHeaders = incoming.headers;
            response.statusCode = behavior === 'redirect' ? 302 : 200;
            if (behavior === 'redirect') {
                response.setHeader(
                    'Location',
                    'https://attacker.example/capture',
                );
            }
            response.setHeader('Content-Type', 'application/json');
            response.end(
                behavior === 'redirect'
                    ? '{}'
                    : JSON.stringify({ payload: 'x'.repeat(1024 * 1024) }),
            );
        });
        await new Promise((resolve, reject) => {
            fakeSidecar.once('error', reject);
            fakeSidecar.listen({ host: '127.0.0.1', port: 0 }, resolve);
        });
        servers.push({ close: () => closeHttpServer(fakeSidecar) });
        await writePrivateRuntimeDiscovery(
            storage.paths.controlPlaneDiscoveryPath,
            {
                schemaVersion: 'smart-order-local-sidecar/2026-08-11.1',
                host: '127.0.0.1',
                port: fakeSidecar.address().port,
                runtimeEpochId: 'runtime-epoch-test-2',
                startedAtEpochMs: NOW,
            },
        );
        const response = await request({ gateway });
        expect(response).toMatchObject({
            status: 503,
            body: { code: 'smart_order_runtime_unavailable' },
        });
        expect(response.headers.location).toBeUndefined();
        expect(receivedHeaders.host).toBe(
            `127.0.0.1:${fakeSidecar.address().port}`,
        );
        expect(receivedHeaders.origin).toBe(
            `http://127.0.0.1:${gateway.port}`,
        );
        expect(receivedHeaders['x-realtimestock-gateway-proof']).toMatch(
            /^[A-Za-z0-9_-]{43}$/,
        );
        expect(JSON.stringify(receivedHeaders)).not.toMatch(
            /cf-connecting|x-forwarded|attacker\.example/,
        );
        behavior = 'oversized';
        await expect(request({ gateway })).resolves.toMatchObject({
            status: 503,
            body: { code: 'smart_order_runtime_unavailable' },
        });
    });
});
