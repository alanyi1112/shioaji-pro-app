import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, stat, unlink } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
const identityAuthority = vi.hoisted(() => ({
    evidence: new WeakSet(),
}));
vi.mock('./canonical-principal-verifier-authority.mjs', () => ({
    isVerifiedSmartOrderCanonicalPrincipalEvidence(value) {
        return identityAuthority.evidence.has(value);
    },
}));
import {
    SMART_ORDER_CONTROL_PLANE_MUTATION_CONTENT_TYPE,
    createSmartOrderGatewayProof,
    sealSmartOrderControlPlaneMutation,
} from './control-plane-security.mjs';
import { startSmartOrderLocalSidecar } from './local-sidecar.mjs';
import { SMART_ORDER_SHIOAJI_TRADE_OBSERVER_TEST_ONLY } from './shioaji-trade-observer-runtime-authority.mjs';
import { isIssuedSmartOrderResourceCoordinator } from './resource-coordinator.mjs';
import {
    SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
    smartOrderGateProbeAccountScopeSha256,
} from './gate-probe-safety-envelope.mjs';
import { issueSmartOrderGateProbeCliAuthorization } from './gate-probe-cli-authorization.mjs';
import {
    prepareSmartOrderPrivateStorage,
    readPrivateSecret,
} from './private-storage.mjs';
import { canonicalSmartOrderDraft } from './canonical-strategy-draft-fixtures.mjs';

const roots = [];
const sidecars = [];
const NOW = 1_786_382_000_000;

afterEach(async () => {
    await Promise.all(
        sidecars.splice(0).map((sidecar) =>
            sidecar.close({ nowEpochMs: NOW + 10_000 }).catch(() => {}),
        ),
    );
    await Promise.all(
        roots.splice(0).map((root) =>
            rm(root, { recursive: true, force: true }),
        ),
    );
});

async function privateRoot() {
    const root = await mkdtemp(path.join(tmpdir(), 'smart-order-sidecar-'));
    roots.push(root);
    await chmod(root, 0o700);
    return root;
}

function request({
    port,
    headers,
    method = 'GET',
    pathname = '/v1/status',
    body,
    agent,
}) {
    return new Promise((resolve, reject) => {
        const outgoing = http.request(
            {
                host: '127.0.0.1',
                port,
                path: pathname,
                method,
                headers,
                agent,
            },
            (response) => {
                const chunks = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () =>
                    resolve({
                        status: response.statusCode,
                        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
                    }),
                );
            },
        );
        outgoing.on('error', reject);
        if (body) outgoing.write(body);
        outgoing.end();
    });
}

async function signedRequest({
    sidecar,
    capability,
    method = 'GET',
    pathname,
    json,
    requestId = randomUUID(),
    agent,
}) {
    const plaintext =
        json === undefined ? undefined : Buffer.from(JSON.stringify(json));
    const envelope = plaintext
        ? sealSmartOrderControlPlaneMutation({
              capability,
              runtimeEpochId: sidecar.runtimeEpochId,
              sidecarAuthority: `127.0.0.1:${sidecar.port}`,
              requestId,
              method,
              pathname,
              origin: 'http://127.0.0.1:5173',
              plaintextBytes: plaintext,
          })
        : null;
    const body = envelope?.bodyBytes;
    const proof = createSmartOrderGatewayProof({
        capability,
        method,
        pathname,
        origin: 'http://127.0.0.1:5173',
        runtimeEpochId: sidecar.runtimeEpochId,
        sidecarAuthority: `127.0.0.1:${sidecar.port}`,
        envelopeNonce: envelope?.nonce,
        bodyBytes: body,
        nowEpochMs: NOW,
        requestId,
    });
    const headers = {
        Host: `127.0.0.1:${sidecar.port}`,
        Origin: 'http://127.0.0.1:5173',
        'Sec-Fetch-Site': 'same-origin',
        'X-RealTimeStock-Runtime-Epoch': sidecar.runtimeEpochId,
        'X-RealTimeStock-Request-Id': proof.requestId,
        'X-RealTimeStock-Gateway-Timestamp': String(proof.timestampEpochMs),
        'X-RealTimeStock-Gateway-Proof': proof.proof,
    };
    if (body) {
        headers['Content-Type'] = SMART_ORDER_CONTROL_PLANE_MUTATION_CONTENT_TYPE;
        headers['Content-Length'] = String(body.byteLength);
        headers['X-RealTimeStock-Envelope-Nonce'] = envelope.nonce;
    }
    return request({
        port: sidecar.port,
        headers,
        method,
        pathname,
        body,
        agent,
    });
}

function localSidecarGateProbeEnvelope(operationId) {
    const account = {
        broker_id: 'broker-sidecar-probe',
        account_id: 'account-sidecar-probe',
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
        validUntilEpochMs: NOW + 30_000,
    };
}

describe('smart-order composed local sidecar', () => {
    it('exposes Gate probe preparation only through the managed private control plane', async () => {
        const appSupportRoot = await privateRoot();
        const startTradeObserver = vi.fn(async () =>
            Object.freeze({
                status() {
                    return Object.freeze({
                        state: 'observing_reconciliation_required',
                        accountIdentifiersExposed: false,
                        eventIdentifiersExposed: false,
                        runtimeReadinessContribution: false,
                        brokerWriteAuthority: false,
                    });
                },
                async close() {},
            }),
        );
        SMART_ORDER_SHIOAJI_TRADE_OBSERVER_TEST_ONLY.authorizeLocalSidecar({
            startTradeObserver,
            tradeObserverFetch: globalThis.fetch,
        });
        const sidecar = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-managed-gate-probe',
            nowEpochMs: NOW,
            runtimeEpochId: 'runtime-managed-gate-probe',
            senderFence: 'fence-managed-gate-probe',
            startTradeObserver,
            now: () => NOW,
        });
        sidecars.push(sidecar);
        const storage = await prepareSmartOrderPrivateStorage({
            appSupportRoot,
        });
        const capability = await readPrivateSecret(storage.paths.capabilityPath);
        const gateProbeCliCapability = await readPrivateSecret(
            storage.paths.gateProbeCliCapabilityPath,
        );
        try {
            const operationId = randomUUID();
            const envelope = localSidecarGateProbeEnvelope(operationId);
            await expect(
                signedRequest({
                    sidecar,
                    capability,
                    method: 'POST',
                    pathname: '/v1/gate-probe/prepare',
                    requestId: operationId,
                    json: {
                        cliAuthorization:
                            issueSmartOrderGateProbeCliAuthorization({
                                capability: gateProbeCliCapability,
                                envelope,
                                authorizedAtEpochMs: NOW,
                                apiGenerationSha256: `sha256:${createHash(
                                    'sha256',
                                )
                                    .update(
                                        'api-generation-managed-gate-probe',
                                    )
                                    .digest('hex')}`,
                                runtimeEpochIdSha256: `sha256:${createHash(
                                    'sha256',
                                )
                                    .update('runtime-managed-gate-probe')
                                    .digest('hex')}`,
                            }),
                        envelope,
                    },
                }),
            ).resolves.toMatchObject({
                status: 423,
                body: {
                    result: {
                        prepared: false,
                        state: 'observe_only',
                        reason: 'runtime_or_kill_switch_not_ready',
                        brokerWriteAttempted: false,
                        brokerAuthority: false,
                        writeMasterAuthority: false,
                    },
                    brokerWriteAttempted: false,
                    brokerAuthority: false,
                    writeMasterAuthority: false,
                },
            });
        } finally {
            capability.fill(0);
            gateProbeCliCapability.fill(0);
        }
    });

    it('rotates the gateway capability only after becoming the primary Runtime', async () => {
        const appSupportRoot = await privateRoot();
        const prepared = await prepareSmartOrderPrivateStorage({ appSupportRoot });
        const oldCapability = await readPrivateSecret(
            prepared.paths.capabilityPath,
        );
        const oldGateProbeCliCapability = await readPrivateSecret(
            prepared.paths.gateProbeCliCapabilityPath,
        );
        const identityBefore = await readPrivateSecret(
            prepared.paths.identityKeyPath,
        );
        const sidecar = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-rotated-capability',
            nowEpochMs: NOW,
            runtimeEpochId: 'runtime-epoch-rotated-capability',
            senderFence: 'sender-fence-rotated-capability',
            now: () => NOW,
        });
        sidecars.push(sidecar);
        const currentCapability = await readPrivateSecret(
            prepared.paths.capabilityPath,
        );
        const currentGateProbeCliCapability = await readPrivateSecret(
            prepared.paths.gateProbeCliCapabilityPath,
        );
        const identityAfter = await readPrivateSecret(
            prepared.paths.identityKeyPath,
        );

        expect(currentCapability).not.toEqual(oldCapability);
        expect(currentGateProbeCliCapability).not.toEqual(
            oldGateProbeCliCapability,
        );
        expect(identityAfter).toEqual(identityBefore);
        await expect(
            signedRequest({
                sidecar,
                capability: oldCapability,
                pathname: '/v1/status',
            }),
        ).resolves.toMatchObject({ status: 403 });
        await expect(
            signedRequest({
                sidecar,
                capability: currentCapability,
                pathname: '/v1/status',
            }),
        ).resolves.toMatchObject({ status: 200 });

        const secondary = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-secondary-no-rotation',
            nowEpochMs: NOW + 1,
            runtimeEpochId: 'runtime-epoch-secondary-no-rotation',
            senderFence: 'sender-fence-secondary-no-rotation',
            now: () => NOW + 1,
        });
        expect(secondary).toMatchObject({
            role: 'secondary_readonly',
            dispatchAllowed: false,
        });
        expect(
            await readPrivateSecret(prepared.paths.capabilityPath),
        ).toEqual(currentCapability);
        expect(
            await readPrivateSecret(
                prepared.paths.gateProbeCliCapabilityPath,
            ),
        ).toEqual(currentGateProbeCliCapability);

        oldCapability.fill(0);
        currentCapability.fill(0);
        oldGateProbeCliCapability.fill(0);
        currentGateProbeCliCapability.fill(0);
        identityBefore.fill(0);
        identityAfter.fill(0);
    });

    it('keeps the durable Runtime available when notification startup fails', async () => {
        const appSupportRoot = await privateRoot();
        const sidecar = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-notification-degraded',
            nowEpochMs: NOW,
            runtimeEpochId: 'runtime-epoch-notification-degraded',
            senderFence: 'sender-fence-notification-degraded',
            notificationOptions: { pollIntervalMs: 1 },
            now: () => NOW,
        });
        sidecars.push(sidecar);

        expect(sidecar).toMatchObject({
            role: 'primary',
            host: '127.0.0.1',
            dispatchAllowed: false,
        });
        expect(sidecar.status()).toMatchObject({
            controlPlane: 'loopback_authenticated',
            dispatchAllowed: false,
        });
    });

    it('wires the private quote coordinator to the existing SSE login while shared resource evidence keeps demand off-wire', async () => {
        const source = await readFile(
            new URL('./local-sidecar.mjs', import.meta.url),
            'utf8',
        );
        expect(source).toMatch(
            /controller\.listSmartOrderQuoteDemands\(\)/,
        );
        expect(source).toMatch(
            /controller\.listGoodTillConfirmationRenewalContexts\(\)/,
        );
        expect(source).toMatch(
            /controller\.refreshGoodTillConfirmationEvidence\(/,
        );
        expect(source).toMatch(
            /tradeObserver\.acquireRuntimeQuoteDemand\(/,
        );
        expect(source).toMatch(
            /startTradeObserver === startSmartOrderShioajiTradeObserver/,
        );
        const appSupportRoot = await privateRoot();
        const sidecar = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-quote-unintegrated',
            nowEpochMs: NOW,
            runtimeEpochId: 'runtime-epoch-quote-unintegrated',
            senderFence: 'sender-fence-quote-unintegrated',
            now: () => NOW,
            monotonicNow: () => 10_000,
        });
        sidecars.push(sidecar);

        const status = sidecar.status();
        expect(status).toMatchObject({
            dispatchAllowed: false,
            quoteSubscription: {
                schemaVersion:
                    'smart-order-quote-subscription-coordinator/2026-08-12.1',
                state: 'transport_wired_resource_blocked',
                blocker: 'subscription_ownership_unverified',
                connectionActive: false,
                trackedSubscriptionCount: 0,
                runtimeDemandCount: 0,
                browserDemandCount: 0,
                pendingPlanCount: 0,
                currentHeadCount: 0,
                resourceCoordinatorConfigured: true,
                resourceEvidenceCurrent: false,
                productionAdapterConfigured: true,
                sharedExistingLogin: true,
                createsNewLogin: false,
                runtimeReadinessContribution: false,
                automaticResubscribeDispatchAllowed: false,
                subscriptionTransportAuthority: false,
                conditionEligibilityAuthority: false,
                brokerWriteAuthority: false,
                accountIdentifiersExposed: false,
                subscriptionIdentifiersExposed: false,
            },
            tradeSubscription: {
                schemaVersion:
                    'smart-order-shioaji-trade-observer/2026-08-22.1',
                state: 'gate_unverified',
                fixedAccountCount: 0,
                confirmedAccountCount: 0,
                gateVerified: false,
                mappingRevisionCurrent: false,
                reconciliationRequired: true,
                accountIdentifiersExposed: false,
                eventIdentifiersExposed: false,
                runtimeReadinessContribution: false,
                brokerWriteAuthority: false,
            },
        });
        expect(sidecar).not.toHaveProperty('quoteSubscriptionCoordinator');
        expect(sidecar).not.toHaveProperty('quoteRuntime');
        expect(sidecar).not.toHaveProperty('quoteBrowser');
        expect(sidecar.acquireRuntimeQuoteDemand).toBeTypeOf('function');
        expect(sidecar.releaseRuntimeQuoteDemand).toBeTypeOf('function');
        const runtimeDemand = await sidecar.acquireRuntimeQuoteDemand({
            consumerId: 'runtime:sidecar-resource-blocked',
            contract: {
                code: '2330',
                exchange: 'TSE',
                securityType: 'STK',
            },
            quoteType: 'tick',
        });
        expect(runtimeDemand).toMatchObject({
            handleClass: 'runtime_quote_demand',
            conditionEligibilityAuthority: false,
            brokerWriteAuthority: false,
        });
        expect(sidecar.status().quoteSubscription).toMatchObject({
            state: 'transport_wired_resource_blocked',
            runtimeDemandCount: 1,
            currentHeadCount: 0,
            blocker: 'subscription_ownership_unverified',
            runtimeReadinessContribution: false,
        });
        await expect(
            sidecar.releaseRuntimeQuoteDemand(runtimeDemand),
        ).resolves.toMatchObject({
            allowed: true,
            brokerWriteAuthority: false,
        });
        expect(JSON.stringify(status.quoteSubscription)).not.toMatch(
            /2330|account_id|broker_id|consumerId|connectionId/,
        );
        expect(JSON.stringify(status.tradeSubscription)).not.toMatch(
            /2330|account_id|broker_id|tradeId|orderId|connectionId/,
        );
    });

    it('keeps a blocked Runtime owned and fail-closed when control-plane startup fails', async () => {
        const appSupportRoot = await privateRoot();
        const initial = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-startup-failure-old',
            nowEpochMs: NOW,
            runtimeEpochId: 'runtime-epoch-startup-failure-old',
            senderFence: 'sender-fence-startup-failure-old',
            now: () => NOW,
        });
        sidecars.push(initial);
        const storage = await prepareSmartOrderPrivateStorage({ appSupportRoot });
        const capability = await readPrivateSecret(storage.paths.capabilityPath);
        const created = await signedRequest({
            sidecar: initial,
            capability,
            method: 'POST',
            pathname: '/v1/strategies',
            json: {
                operationId: randomUUID(),
                strategyKind: 'trailing_exit',
            },
        });
        capability.fill(0);
        expect(created).toMatchObject({
            status: 200,
            body: { result: { state: 'draft' } },
        });

        await initial.closeForGenerationFailover({
            observedApiGeneration: 'api-generation-startup-failure-new',
            nowEpochMs: NOW + 100,
        });
        sidecars.splice(sidecars.indexOf(initial), 1);

        const startupFailure = Object.assign(
            new Error('fixture control-plane startup failed'),
            { name: 'FixtureControlPlaneStartupError' },
        );
        const recovery = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-startup-failure-new',
            nowEpochMs: NOW + 200,
            runtimeEpochId: 'runtime-epoch-startup-failure-new',
            senderFence: 'sender-fence-startup-failure-new',
            startControlPlane: async (options) => {
                expect(options).not.toHaveProperty(
                    'gateProbeCliCapability',
                );
                expect(options.gateProbeControlPlaneAuthority).toBeNull();
                throw startupFailure;
            },
            now: () => NOW + 200,
        });
        sidecars.push(recovery);

        expect(recovery).toMatchObject({
            role: 'primary',
            host: '127.0.0.1',
            port: null,
            dispatchAllowed: false,
        });
        expect(recovery.status()).toMatchObject({
            role: 'primary',
            state: 'reconciling',
            controlPlane: 'startup_failed_fail_closed',
            startupRecoveryRequired: true,
            quoteSubscription: {
                state: 'transport_unavailable_fail_closed',
                runtimeReadinessContribution: false,
                subscriptionTransportAuthority: false,
                brokerWriteAuthority: false,
            },
            dispatchAllowed: false,
            repositoryOpened: true,
            tradingSenderAuthority: 'runtime_only',
        });
        await expect(
            readFile(storage.paths.controlPlaneDiscoveryPath, 'utf8'),
        ).rejects.toMatchObject({ code: 'ENOENT' });

        await expect(
            recovery.close({ nowEpochMs: NOW + 300 }),
        ).rejects.toMatchObject({ name: 'RuntimeStopBlockedError' });
        expect(recovery.status()).toMatchObject({
            state: 'reconciling',
            startupRecoveryRequired: true,
            quoteSubscription: {
                state: 'transport_unavailable_fail_closed',
                pendingPlanCount: 0,
                currentHeadCount: 0,
            },
            repositoryOpened: true,
            dispatchAllowed: false,
        });

        await expect(
            recovery.closeForGenerationFailover({
                observedApiGeneration:
                    'api-generation-startup-failure-handoff',
                nowEpochMs: NOW + 400,
            }),
        ).resolves.toMatchObject({
            state: 'closed',
            repositoryState: 'reconciling',
            reason: 'generation_invalidated',
            dispatchAllowed: false,
            requiresProcessRestart: true,
        });
        sidecars.splice(sidecars.indexOf(recovery), 1);
    });

    it('fences a late blocker after quiesce before durable stop recheck', async () => {
        const appSupportRoot = await privateRoot();
        const startupFailure = Object.assign(
            new Error('fixture startup failed after quiesce'),
            { name: 'FixturePostQuiesceStartupError' },
        );
        await expect(
            startSmartOrderLocalSidecar({
                appSupportRoot,
                apiGeneration: 'api-generation-post-quiesce-blocker',
                nowEpochMs: NOW,
                runtimeEpochId: 'runtime-epoch-post-quiesce-blocker',
                senderFence: 'sender-fence-post-quiesce-blocker',
                startControlPlane: async ({ runtimeController }) => {
                    await expect(
                        runtimeController.quiesce({
                            operation: 'graceful_stop',
                            nowEpochMs: NOW + 1,
                        }),
                    ).resolves.toMatchObject({
                        state: 'quiescing',
                        drainAllowed: true,
                    });
                    await expect(
                        runtimeController.createDraftStrategy({
                            strategyId: 'late-post-quiesce-draft',
                            strategyKind: 'trailing_exit',
                            nowEpochMs: NOW + 2,
                        }),
                    ).rejects.toMatchObject({
                        name: 'RuntimeLifecycleMutationFencedError',
                    });
                    throw startupFailure;
                },
                now: () => NOW + 3,
            }),
        ).rejects.toBe(startupFailure);

        const replacement = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-post-quiesce-replacement',
            nowEpochMs: NOW + 4,
            runtimeEpochId: 'runtime-epoch-post-quiesce-replacement',
            senderFence: 'sender-fence-post-quiesce-replacement',
            now: () => NOW + 4,
        });
        sidecars.push(replacement);
        expect(replacement).toMatchObject({
            role: 'primary',
            dispatchAllowed: false,
        });
    });

    it('keeps replacement fenced if the process fails after the pre-commit barrier but before cleanup callback', async () => {
        const appSupportRoot = await privateRoot();
        const apiGeneration = 'api-generation-precommit-crash';
        const runtimeEpochId = 'runtime-epoch-precommit-crash';
        const crash = Object.assign(
            new Error('fixture crash after lifecycle pre-commit barrier'),
            { name: 'FixtureLifecyclePrecommitCrash' },
        );
        await expect(
            startSmartOrderLocalSidecar({
                appSupportRoot,
                apiGeneration,
                nowEpochMs: NOW,
                runtimeEpochId,
                senderFence: 'sender-fence-precommit-crash',
                startControlPlane: async ({
                    runtimeController,
                    onLifecycleStopPrecommit,
                }) => {
                    const status = runtimeController.status();
                    await onLifecycleStopPrecommit({
                        operation: 'graceful_stop',
                        runtimeEpochIdSha256: `sha256:${createHash('sha256')
                            .update(runtimeEpochId)
                            .digest('hex')}`,
                        apiGenerationSha256:
                            status.apiGenerationSha256,
                        stopRevision:
                            status.revision +
                            (status.state === 'quiescing' ? 1 : 2),
                        completionNonceSha256: `sha256:${'3'.repeat(64)}`,
                        requestIdSha256: `sha256:${'4'.repeat(64)}`,
                    });
                    throw crash;
                },
                now: () => NOW + 1,
            }),
        ).rejects.toBe(crash);

        const storage = await prepareSmartOrderPrivateStorage({
            appSupportRoot,
        });
        await expect(
            stat(storage.paths.lifecycleStopBarrierPath),
        ).resolves.toMatchObject({ mode: expect.any(Number) });
        await expect(
            startSmartOrderLocalSidecar({
                appSupportRoot,
                apiGeneration,
                nowEpochMs: NOW + 2,
                runtimeEpochId: 'replacement-after-precommit-crash',
                senderFence: 'replacement-after-precommit-crash-fence',
                now: () => NOW + 2,
            }),
        ).rejects.toThrow('handoff is not finalized');
    });

    it('releases an empty Runtime and reports the original control-plane startup failure', async () => {
        const appSupportRoot = await privateRoot();
        const startupFailure = Object.assign(
            new Error('fixture empty control-plane startup failed'),
            { name: 'FixtureEmptyControlPlaneStartupError' },
        );

        await expect(
            startSmartOrderLocalSidecar({
                appSupportRoot,
                apiGeneration: 'api-generation-empty-startup-failure',
                nowEpochMs: NOW,
                runtimeEpochId: 'runtime-epoch-empty-startup-failure',
                senderFence: 'sender-fence-empty-startup-failure',
                startControlPlane: async () => {
                    throw startupFailure;
                },
                now: () => NOW,
            }),
        ).rejects.toBe(startupFailure);
        const replacement = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-empty-startup-replacement',
            nowEpochMs: NOW + 1,
            runtimeEpochId: 'runtime-epoch-empty-startup-replacement',
            senderFence: 'sender-fence-empty-startup-replacement',
            now: () => NOW + 1,
        });
        sidecars.push(replacement);
        expect(replacement).toMatchObject({
            role: 'primary',
            dispatchAllowed: false,
        });
    });

    it('never returns a primary recovery facade after stop released the lease and discovery cleanup failed', async () => {
        const appSupportRoot = await privateRoot();
        const startupFailure = Object.assign(
            new Error('fixture control-plane startup failed before cleanup'),
            { name: 'FixtureControlPlaneStartupError' },
        );
        const discoveryFailure = Object.assign(
            new Error('fixture discovery cleanup failed after stop'),
            { code: 'EACCES' },
        );
        let unlinkCallCount = 0;

        await expect(
            startSmartOrderLocalSidecar({
                appSupportRoot,
                apiGeneration: 'api-generation-cleanup-failure',
                nowEpochMs: NOW,
                runtimeEpochId: 'runtime-epoch-cleanup-failure',
                senderFence: 'sender-fence-cleanup-failure',
                startControlPlane: async () => {
                    throw startupFailure;
                },
                unlinkDiscovery: async () => {
                    unlinkCallCount += 1;
                    if (unlinkCallCount === 3) throw discoveryFailure;
                },
                now: () => NOW,
            }),
        ).rejects.toMatchObject({
            name: 'AggregateError',
            errors: [startupFailure, discoveryFailure],
        });

        const replacement = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-after-cleanup-failure',
            nowEpochMs: NOW + 1,
            runtimeEpochId: 'runtime-epoch-after-cleanup-failure',
            senderFence: 'sender-fence-after-cleanup-failure',
            now: () => NOW + 1,
        });
        sidecars.push(replacement);
        expect(replacement).toMatchObject({
            role: 'primary',
            dispatchAllowed: false,
        });
    });

    it('closes a recovery facade before reporting post-handoff discovery cleanup failure', async () => {
        const appSupportRoot = await privateRoot();
        const initial = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-handoff-cleanup-old',
            nowEpochMs: NOW,
            runtimeEpochId: 'runtime-epoch-handoff-cleanup-old',
            senderFence: 'sender-fence-handoff-cleanup-old',
            now: () => NOW,
        });
        sidecars.push(initial);
        const storage = await prepareSmartOrderPrivateStorage({ appSupportRoot });
        const capability = await readPrivateSecret(storage.paths.capabilityPath);
        await signedRequest({
            sidecar: initial,
            capability,
            method: 'POST',
            pathname: '/v1/strategies',
            json: {
                operationId: randomUUID(),
                strategyKind: 'trailing_exit',
            },
        });
        capability.fill(0);
        await initial.closeForGenerationFailover({
            observedApiGeneration: 'api-generation-handoff-cleanup-new',
            nowEpochMs: NOW + 100,
        });
        sidecars.splice(sidecars.indexOf(initial), 1);

        let failDiscoveryCleanup = false;
        const discoveryFailure = Object.assign(
            new Error('fixture post-handoff discovery cleanup failed'),
            { code: 'EACCES' },
        );
        const recovery = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-handoff-cleanup-new',
            nowEpochMs: NOW + 200,
            runtimeEpochId: 'runtime-epoch-handoff-cleanup-new',
            senderFence: 'sender-fence-handoff-cleanup-new',
            startControlPlane: async () => {
                throw new Error('fixture control-plane startup failed');
            },
            unlinkDiscovery: async (discoveryPath) => {
                if (failDiscoveryCleanup) throw discoveryFailure;
                return unlink(discoveryPath);
            },
            now: () => NOW + 200,
        });
        sidecars.push(recovery);
        expect(recovery.status()).toMatchObject({
            state: 'reconciling',
            startupRecoveryRequired: true,
            repositoryOpened: true,
            dispatchAllowed: false,
        });

        failDiscoveryCleanup = true;
        await expect(
            recovery.closeForGenerationFailover({
                observedApiGeneration:
                    'api-generation-handoff-cleanup-replacement',
                nowEpochMs: NOW + 300,
            }),
        ).rejects.toBe(discoveryFailure);
        expect(recovery.status()).toMatchObject({
            state: 'closed',
            controlPlane: 'closed',
            startupRecoveryRequired: false,
            repositoryOpened: false,
            tradingSenderAuthority: 'none',
            dispatchAllowed: false,
        });

        const replacement = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-handoff-cleanup-replacement',
            nowEpochMs: NOW + 400,
            runtimeEpochId: 'runtime-epoch-handoff-cleanup-replacement',
            senderFence: 'sender-fence-handoff-cleanup-replacement',
            now: () => NOW + 400,
        });
        sidecars.push(replacement);
        expect(replacement).toMatchObject({
            role: 'primary',
            dispatchAllowed: false,
        });
    });

    it('binds a private gap coordinator to durable controller recovery', async () => {
        const appSupportRoot = await privateRoot();
        const sidecar = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-continuity-gap',
            nowEpochMs: NOW,
            runtimeEpochId: 'runtime-epoch-continuity-gap',
            senderFence: 'sender-fence-continuity-gap',
            now: () => NOW,
        });
        sidecars.push(sidecar);
        const coordinator = sidecar.createRuntimeGapCoordinator({
            observedWallTimeMs: NOW,
            observedMonotonicTimeMs: 10_000,
        });
        const latched = coordinator.observeClockSample({
            observedWallTimeMs: NOW + 5_001,
            observedMonotonicTimeMs: 15_001,
        });
        expect(latched).toMatchObject({
            recoveryRequired: true,
            dispatchBlockedByContinuityGap: true,
            invalidationState: 'pending',
        });
        await expect(coordinator.waitForInvalidation()).resolves.toMatchObject({
            state: 'committed',
            dispatchAllowed: false,
        });
        const signalSha256 = coordinator.status().signalSha256;
        expect(sidecar.status()).toMatchObject({
            continuityInvalidated: true,
            continuitySignalSha256: signalSha256,
            dispatchAllowed: false,
            tradingSenderAuthority: 'none',
        });
        expect(() =>
            sidecar.createRuntimeGapCoordinator({
                observedWallTimeMs: NOW,
                observedMonotonicTimeMs: 10_000,
            }),
        ).toThrow('already created');
    });

    it('keeps sidecar monitoring ownership after the 5173 gateway client closes, then fails closed on the broker SSE gap', async () => {
        const appSupportRoot = await privateRoot();
        const sidecar = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-gateway-independent',
            nowEpochMs: NOW,
            runtimeEpochId: 'runtime-epoch-gateway-independent',
            senderFence: 'sender-fence-gateway-independent',
            now: () => NOW,
        });
        sidecars.push(sidecar);
        const databasePath = path.join(
            appSupportRoot,
            'smart-order',
            'database',
            'smart-orders.sqlite3',
        );
        const seed = new DatabaseSync(databasePath);
        seed.prepare(`
            INSERT INTO strategies(
                strategy_id, strategy_kind, state, definition_hash,
                definition_json, account_broker_ref, account_id_ref,
                identity_group_id, confirmation_snapshot_hash,
                created_at_epoch_ms, updated_at_epoch_ms, terminal_at_epoch_ms,
                revision
            ) VALUES (?, 'trailing_exit', 'monitoring', ?, ?, 'broker-A',
                      'account-A', 'identity-A', ?, ?, ?, NULL, 0)
        `).run(
            'strategy-gateway-independent-monitoring',
            `sha256:${'a'.repeat(64)}`,
            JSON.stringify({
                schemaVersion: 'strategy/1',
                kind: 'trailing_exit',
            }),
            `sha256:${'b'.repeat(64)}`,
            NOW,
            NOW,
        );
        seed.close();
        const coordinator = sidecar.createRuntimeGapCoordinator({
            observedWallTimeMs: NOW,
            observedMonotonicTimeMs: 10_000,
        });
        const demand = await sidecar.acquireRuntimeQuoteDemand({
            consumerId: 'runtime:gateway-independent-monitoring',
            contract: {
                code: '2330',
                exchange: 'TSE',
                securityType: 'STK',
            },
            quoteType: 'tick',
        });
        const storage = await prepareSmartOrderPrivateStorage({
            appSupportRoot,
        });
        const capability = await readPrivateSecret(storage.paths.capabilityPath);
        const gatewayAgent = new http.Agent({
            keepAlive: true,
            maxFreeSockets: 1,
            maxSockets: 1,
        });
        try {
            await expect(
                signedRequest({
                    sidecar,
                    capability,
                    pathname: '/v1/status',
                    agent: gatewayAgent,
                }),
            ).resolves.toMatchObject({ status: 200 });

            // Closing the only authenticated 5173-side connection represents
            // the page/gateway lifetime ending. It is not a market-data gap and
            // must not revoke the independent sidecar monitoring authority.
            gatewayAgent.destroy();
            const afterGatewayClose = new DatabaseSync(databasePath, {
                readOnly: true,
            });
            expect(
                afterGatewayClose
                    .prepare(`
                        SELECT state FROM strategies
                         WHERE strategy_id='strategy-gateway-independent-monitoring'
                    `)
                    .get(),
            ).toEqual({ state: 'monitoring' });
            afterGatewayClose.close();
            expect(coordinator.status()).toMatchObject({
                coordinatorState: 'monitoring',
                recoveryRequired: false,
                dispatchBlockedByContinuityGap: false,
            });
            expect(sidecar.status()).toMatchObject({
                controlPlane: 'loopback_authenticated',
                quoteSubscription: { runtimeDemandCount: 1 },
                dispatchAllowed: false,
            });

            const disconnected = coordinator.observeSseLifecycle({
                observedWallTimeMs: NOW + 100,
                phase: 'disconnect',
                streamEpoch: 'trade-connection-after-gateway-close',
                streamId: 'shioaji-trade-sse',
            });
            expect(disconnected).toMatchObject({
                recoveryRequired: true,
                dispatchBlockedByContinuityGap: true,
                invalidationState: 'pending',
            });
            await expect(coordinator.waitForInvalidation()).resolves.toMatchObject({
                state: 'committed',
                dispatchAllowed: false,
                automaticResetAllowed: false,
            });
            expect(sidecar.status()).toMatchObject({
                state: 'reconciling',
                continuityInvalidated: true,
                reconciliationRequired: true,
                userRearmRequiredAfterReconciliation: true,
                dispatchAllowed: false,
            });
            const afterBrokerGap = new DatabaseSync(databasePath, {
                readOnly: true,
            });
            expect(
                afterBrokerGap
                    .prepare(`
                        SELECT state FROM strategies
                         WHERE strategy_id='strategy-gateway-independent-monitoring'
                    `)
                    .get(),
            ).toEqual({ state: 'manual_intervention' });
            expect(
                afterBrokerGap
                    .prepare(`
                        SELECT COUNT(*) AS count
                          FROM resolution_cases
                         WHERE strategy_id='strategy-gateway-independent-monitoring'
                           AND reason_code='TRAILING_GAP_EXTREME_UNKNOWN'
                           AND state='open'
                    `)
                    .get(),
            ).toEqual({ count: 1 });
            afterBrokerGap.close();
        } finally {
            gatewayAgent.destroy();
            capability.fill(0);
            await sidecar.releaseRuntimeQuoteDemand(demand);
        }
    });

    it('queues an early production trade-SSE disconnect until the epoch gap coordinator exists', async () => {
        const appSupportRoot = await privateRoot();
        const startTradeObserver = vi.fn(async (options) => {
            options.reportRuntimeGapLifecycle(
                Object.freeze({
                    observedWallTimeMs: NOW,
                    phase: 'disconnect',
                    streamEpoch: 'trade-connection-before-entry-baseline',
                    streamId: 'shioaji-trade-sse',
                }),
            );
            return Object.freeze({
                status() {
                    return Object.freeze({
                        state: 'disconnected_reconciliation_required',
                        accountIdentifiersExposed: false,
                        eventIdentifiersExposed: false,
                        runtimeReadinessContribution: false,
                        brokerWriteAuthority: false,
                    });
                },
                async close() {},
            });
        });
        SMART_ORDER_SHIOAJI_TRADE_OBSERVER_TEST_ONLY.authorizeLocalSidecar({
            startTradeObserver,
            tradeObserverFetch: globalThis.fetch,
        });
        const sidecar = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-early-sse-gap',
            nowEpochMs: NOW,
            runtimeEpochId: 'runtime-epoch-early-sse-gap',
            senderFence: 'sender-fence-early-sse-gap',
            startTradeObserver,
            now: () => NOW,
        });
        sidecars.push(sidecar);
        const coordinator = sidecar.createRuntimeGapCoordinator({
            observedWallTimeMs: NOW,
            observedMonotonicTimeMs: 10_000,
        });
        await expect(coordinator.waitForInvalidation()).resolves.toMatchObject({
            state: 'committed',
            dispatchAllowed: false,
        });
        expect(coordinator.status()).toMatchObject({
            recoveryRequired: true,
            reasonCodes: ['SSE_STREAM_BASELINE_MISSING'],
            invalidationState: 'committed',
        });
        expect(sidecar.status()).toMatchObject({
            continuityInvalidated: true,
            dispatchAllowed: false,
        });
    });

    it('installs Gate-bound broker identity evidence from the production observer into the primary Runtime', async () => {
        const appSupportRoot = await privateRoot();
        const startTradeObserver = vi.fn(async (options) => {
            const evidence = Object.freeze({
                accountScopes: Object.freeze([
                    Object.freeze({
                        accountBrokerRef: 'broker-A',
                        accountIdRef: 'account-A',
                    }),
                ]),
                canonicalPrincipal: 'broker-authenticated-person',
                mappingRevision:
                    'smart-order-canonical-principal-mapping/2026-08-13.1',
                principalEvidenceHash: `sha256:${'a'.repeat(64)}`,
            });
            identityAuthority.evidence.add(evidence);
            await options.runtimeController.acceptAuthenticatedIdentityEvidence(
                evidence,
            );
            return Object.freeze({
                status() {
                    return Object.freeze({
                        state: 'observing_reconciliation_required',
                        identityMappingState: 'authenticated',
                        accountIdentifiersExposed: false,
                        eventIdentifiersExposed: false,
                        runtimeReadinessContribution: false,
                        brokerWriteAuthority: false,
                    });
                },
                async close() {},
            });
        });
        SMART_ORDER_SHIOAJI_TRADE_OBSERVER_TEST_ONLY.authorizeLocalSidecar({
            startTradeObserver,
            tradeObserverFetch: globalThis.fetch,
        });
        const sidecar = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-identity-evidence',
            nowEpochMs: NOW,
            runtimeEpochId: 'runtime-epoch-identity-evidence',
            senderFence: 'sender-fence-identity-evidence',
            startTradeObserver,
            now: () => NOW,
        });
        sidecars.push(sidecar);

        expect(startTradeObserver).toHaveBeenCalledTimes(1);
        expect(
            isIssuedSmartOrderResourceCoordinator(
                startTradeObserver.mock.calls[0][0].resourceCoordinator,
            ),
        ).toBe(true);
        expect(sidecar.status()).toMatchObject({
            authenticatedIdentity: {
                state: 'authenticated',
                fixedAccountCount: 1,
                rawPrincipalExposed: false,
                brokerWriteAuthority: false,
            },
            tradeSubscription: {
                identityMappingState: 'authenticated',
                accountIdentifiersExposed: false,
            },
            dispatchAllowed: false,
        });
        expect(JSON.stringify(sidecar.status())).not.toContain(
            'broker-authenticated-person',
        );
    });

    it('generation failover durably retires the old fence and unpublishes discovery before a replacement starts', async () => {
        const appSupportRoot = await privateRoot();
        const sidecar = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-sidecar-old',
            nowEpochMs: NOW,
            runtimeEpochId: 'runtime-epoch-sidecar-old',
            senderFence: 'sender-fence-sidecar-old',
            now: () => NOW,
        });
        sidecars.push(sidecar);
        const storage = await prepareSmartOrderPrivateStorage({ appSupportRoot });

        await expect(
            sidecar.closeForGenerationFailover({
                observedApiGeneration: 'api-generation-sidecar-new',
                nowEpochMs: NOW + 100,
            }),
        ).resolves.toMatchObject({
            state: 'closed',
            repositoryState: 'reconciling',
            reason: 'generation_invalidated',
            dispatchAllowed: false,
            requiresProcessRestart: true,
        });
        expect(sidecar.status()).toMatchObject({
            state: 'closed',
            controlPlane: 'closed',
            dispatchAllowed: false,
            generationInvalidated: true,
            tradingSenderAuthority: 'none',
            quoteSubscription: {
                state: 'closed_fail_closed',
                runtimeReadinessContribution: false,
                brokerWriteAuthority: false,
            },
        });
        await expect(
            readFile(storage.paths.controlPlaneDiscoveryPath, 'utf8'),
        ).rejects.toMatchObject({ code: 'ENOENT' });

        const replacement = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-sidecar-new',
            nowEpochMs: NOW + 200,
            runtimeEpochId: 'runtime-epoch-sidecar-new',
            senderFence: 'sender-fence-sidecar-new',
            now: () => NOW + 200,
        });
        sidecars.push(replacement);
        expect(replacement.status()).toMatchObject({
            role: 'primary',
            state: 'reconciling',
            dispatchAllowed: false,
            generationInvalidated: false,
        });
    });

    it('不會在舊 discovery 撤下前釋放 exclusive lease 給 replacement', async () => {
        const appSupportRoot = await privateRoot();
        const sidecar = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-race-old',
            nowEpochMs: NOW,
            runtimeEpochId: 'runtime-epoch-race-old',
            senderFence: 'sender-fence-race-old',
            now: () => NOW,
        });
        sidecars.push(sidecar);
        const storage = await prepareSmartOrderPrivateStorage({ appSupportRoot });
        const failover = sidecar.closeForGenerationFailover({
            observedApiGeneration: 'api-generation-race-new',
            nowEpochMs: NOW + 100,
        });

        // The replacement may race immediately, but it can only become a
        // readonly secondary until the old process has both unpublished its
        // discovery and released the lease.
        let racingReplacement;
        let racingFailure;
        try {
            racingReplacement = await startSmartOrderLocalSidecar({
                appSupportRoot,
                apiGeneration: 'api-generation-race-new',
                nowEpochMs: NOW + 101,
                runtimeEpochId: 'runtime-epoch-race-new-too-early',
                senderFence: 'sender-fence-race-new-too-early',
                now: () => NOW + 101,
            });
        } catch (error) {
            racingFailure = error;
        }
        await failover;
        if (racingFailure) {
            // The old controller may remove its now-empty private lease
            // directory between the replacement's storage preparation and
            // lstat. That startup is fail-closed and the supervisor may retry
            // only after the failover promise settles.
            expect(racingFailure).toMatchObject({ code: 'ENOENT' });
        } else {
            expect(racingReplacement.dispatchAllowed).toBe(false);
        }
        if (racingReplacement?.role === 'primary') {
            sidecars.push(racingReplacement);
            expect(
                JSON.parse(
                    await readFile(
                        storage.paths.controlPlaneDiscoveryPath,
                        'utf8',
                    ),
                ),
            ).toMatchObject({
                runtimeEpochId: 'runtime-epoch-race-new-too-early',
            });
            return;
        }
        if (racingReplacement) {
            expect(racingReplacement.role).toBe('secondary_readonly');
        }
        await expect(readFile(storage.paths.controlPlaneDiscoveryPath, 'utf8'))
            .rejects.toMatchObject({ code: 'ENOENT' });
        const replacement = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-race-new',
            nowEpochMs: NOW + 200,
            runtimeEpochId: 'runtime-epoch-race-new',
            senderFence: 'sender-fence-race-new',
            now: () => NOW + 200,
        });
        sidecars.push(replacement);
        expect(replacement).toMatchObject({
            role: 'primary',
            dispatchAllowed: false,
        });
    });

    it('publishes only private loopback discovery and never broker write authority', async () => {
        const appSupportRoot = await privateRoot();
        const sidecar = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-1',
            nowEpochMs: NOW,
            runtimeEpochId: 'runtime-epoch-1',
            senderFence: 'sender-fence-1',
            now: () => NOW,
        });
        sidecars.push(sidecar);
        expect(sidecar).toMatchObject({
            role: 'primary',
            host: '127.0.0.1',
            dispatchAllowed: false,
        });
        const storage = await prepareSmartOrderPrivateStorage({ appSupportRoot });
        const discovery = JSON.parse(
            await readFile(storage.paths.controlPlaneDiscoveryPath, 'utf8'),
        );
        expect(discovery).toMatchObject({
            host: '127.0.0.1',
            port: sidecar.port,
            runtimeEpochId: 'runtime-epoch-1',
        });
        expect(
            (await stat(storage.paths.controlPlaneDiscoveryPath)).mode & 0o777,
        ).toBe(0o600);
        expect(JSON.stringify(discovery)).not.toMatch(
            /capability|secret|account/i,
        );

        const capability = await readPrivateSecret(storage.paths.capabilityPath);
        const proof = createSmartOrderGatewayProof({
            capability,
            method: 'GET',
            pathname: '/v1/status',
            origin: 'http://127.0.0.1:5173',
            runtimeEpochId: sidecar.runtimeEpochId,
            sidecarAuthority: `127.0.0.1:${sidecar.port}`,
            nowEpochMs: NOW,
        });
        capability.fill(0);
        await expect(
            request({
                port: sidecar.port,
                headers: {
                    Host: `127.0.0.1:${sidecar.port}`,
                    Origin: 'http://127.0.0.1:5173',
                    'Sec-Fetch-Site': 'same-origin',
                    'X-RealTimeStock-Runtime-Epoch': sidecar.runtimeEpochId,
                    'X-RealTimeStock-Request-Id': proof.requestId,
                    'X-RealTimeStock-Gateway-Timestamp': String(
                        proof.timestampEpochMs,
                    ),
                    'X-RealTimeStock-Gateway-Proof': proof.proof,
                },
            }),
        ).resolves.toMatchObject({
            status: 200,
            body: {
                controlPlane: 'loopback_authenticated',
                secretValuesExposed: false,
            },
        });
    });

    it('atomically quiesces through the private capability before allowing shutdown', async () => {
        const appSupportRoot = await privateRoot();
        const sidecar = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'simulation:lifecycle-quiesce-1',
            nowEpochMs: NOW,
            runtimeEpochId: 'runtime-epoch-lifecycle-quiesce-1',
            senderFence: 'sender-fence-lifecycle-quiesce-1',
            now: () => NOW,
        });
        sidecars.push(sidecar);
        const storage = await prepareSmartOrderPrivateStorage({ appSupportRoot });
        const capability = await readPrivateSecret(storage.paths.capabilityPath);
        const quiesced = await signedRequest({
            sidecar,
            capability,
            method: 'POST',
            pathname: '/v1/lifecycle/quiesce',
            json: { operation: 'production_readonly' },
        });
        capability.fill(0);

        expect(quiesced).toMatchObject({
            status: 200,
            body: {
                schemaVersion:
                    'smart-order-lifecycle-quiesce/2026-08-12.1',
                state: 'quiescing',
                operation: 'production_readonly',
                drainAllowed: true,
                blockerCount: 0,
                dispatchAllowed: false,
                writeMaster: 'disabled',
                brokerWriteAttempted: false,
                accountIdentifiersExposed: false,
                entityIdentifiersExposed: false,
            },
        });
        expect(sidecar.status()).toMatchObject({
            state: 'quiescing',
            dispatchAllowed: false,
        });
        await sidecar.close({ nowEpochMs: NOW + 1 });
        sidecars.splice(sidecars.indexOf(sidecar), 1);
    });

    it('persists replay-protected draft strategy lifecycle without broker authority', async () => {
        const appSupportRoot = await privateRoot();
        const sidecar = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'api-generation-strategy-fixture',
            nowEpochMs: NOW,
            runtimeEpochId: 'runtime-epoch-strategy-fixture',
            senderFence: 'sender-fence-strategy-fixture',
            now: () => NOW,
        });
        sidecars.push(sidecar);
        const storage = await prepareSmartOrderPrivateStorage({ appSupportRoot });
        const capability = await readPrivateSecret(storage.paths.capabilityPath);
        const createOperationId = randomUUID();
        const createPayload = {
            operationId: createOperationId,
            strategyKind: 'trailing_exit',
            workspaceContractKey: 'TSE:STK:2330',
        };

        const created = await signedRequest({
            sidecar,
            capability,
            method: 'POST',
            pathname: '/v1/strategies',
            json: createPayload,
        });
        expect(created).toMatchObject({
            status: 200,
            body: {
                brokerWriteAttempted: false,
                result: {
                    state: 'draft',
                    strategyKind: 'trailing_exit',
                    revision: 0,
                    accountBound: false,
                },
            },
        });
        expect(JSON.stringify(created.body)).not.toMatch(/account_id|broker_ref/i);
        const strategyId = created.body.result.strategyId;

        const replayed = await signedRequest({
            sidecar,
            capability,
            method: 'POST',
            pathname: '/v1/strategies',
            json: createPayload,
        });
        expect(replayed).toMatchObject({
            status: 200,
            body: {
                result: created.body.result,
                resultHash: created.body.resultHash,
                brokerWriteAttempted: false,
            },
        });
        expect(replayed.body).toEqual(created.body);

        const updatedDefinition = canonicalSmartOrderDraft('trailing_exit');
        const updateOperationId = randomUUID();
        const updatePayload = {
            operationId: updateOperationId,
            expectedRevision: 0,
            draft: updatedDefinition,
        };
        const updated = await signedRequest({
            sidecar,
            capability,
            method: 'PUT',
            pathname: `/v1/strategies/${strategyId}`,
            json: updatePayload,
        });
        expect(updated).toMatchObject({
            status: 200,
            body: {
                brokerWriteAttempted: false,
                result: {
                    strategyId,
                    state: 'draft',
                    revision: 1,
                    definition: updatedDefinition,
                },
            },
        });

        const crossTargetReplay = await signedRequest({
            sidecar,
            capability,
            method: 'PUT',
            pathname: '/v1/strategies/other-strategy-id',
            json: updatePayload,
        });
        expect(crossTargetReplay).toEqual({
            status: 409,
            body: {
                code: 'operation_id_payload_conflict',
                brokerWriteAttempted: false,
            },
        });

        const stalePause = await signedRequest({
            sidecar,
            capability,
            method: 'POST',
            pathname: `/v1/strategies/${strategyId}/pause`,
            json: {
                operationId: randomUUID(),
                expectedRevision: 0,
            },
        });
        expect(stalePause).toMatchObject({
            status: 409,
            body: {
                code: 'stale_revision',
                brokerWriteAttempted: false,
                latestSnapshot: {
                    strategyId,
                    state: 'draft',
                    revision: 1,
                },
            },
        });

        const listed = await signedRequest({
            sidecar,
            capability,
            pathname: '/v1/strategies',
        });
        expect(listed).toMatchObject({
            status: 200,
            body: {
                accountIdentifiersExposed: false,
                strategies: [
                    {
                        strategyId,
                        state: 'draft',
                        revision: 1,
                    },
                ],
            },
        });

        const resumePayload = {
            activationPolicyAcknowledged: true,
            operationId: randomUUID(),
            expectedRevision: 1,
        };
        const resume = await signedRequest({
            sidecar,
            capability,
            method: 'POST',
            pathname: `/v1/strategies/${strategyId}/resume`,
            json: resumePayload,
        });
        expect(resume).toMatchObject({
            status: 409,
            body: {
                code: 'strategy_resume_not_ready',
                brokerWriteAttempted: false,
            },
        });
        const replayedResume = await signedRequest({
            sidecar,
            capability,
            method: 'POST',
            pathname: `/v1/strategies/${strategyId}/resume`,
            json: resumePayload,
        });
        expect(replayedResume).toEqual(resume);
        const brokerCancelPayload = {
            expectedRevision: 1,
            operationId: randomUUID(),
            userConfirmationAcknowledged: true,
        };
        const brokerCancel = await signedRequest({
            sidecar,
            capability,
            method: 'POST',
            pathname: `/v1/strategies/${strategyId}/cancel-broker-order`,
            json: brokerCancelPayload,
        });
        expect(brokerCancel).toMatchObject({
            status: 409,
            body: {
                code: 'broker_order_cancel_not_ready',
                brokerWriteAttempted: false,
            },
        });
        await expect(
            signedRequest({
                sidecar,
                capability,
                method: 'POST',
                pathname: `/v1/strategies/${strategyId}/cancel-broker-order`,
                json: brokerCancelPayload,
            }),
        ).resolves.toEqual(brokerCancel);
        capability.fill(0);
    });
});
