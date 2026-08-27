#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createSmartOrderGatewayProof,
    sealSmartOrderControlPlaneMutation,
    verifySmartOrderControlPlaneResponseProof,
} from './control-plane-security.mjs';
import {
    consumePrivateLifecycleStopCompletion,
    readPendingPrivateLifecycleStopCompletion,
    readPrivateRuntimeDiscovery,
    readPrivateSecret,
    verifyPrivateLifecycleStopCompletion,
} from './private-storage.mjs';
import { SMART_ORDER_LIFECYCLE_OPERATIONS } from './lifecycle-drain-policy.mjs';
import { canonicalSmartOrderGateProbeSafetyEnvelope } from './gate-probe-safety-envelope.mjs';

export const SMART_ORDER_RUNTIME_DIAGNOSTICS_SCHEMA_VERSION =
    'smart-order-runtime-diagnostics/2026-08-12.2';

const SMART_ORDER_LIFECYCLE_AUDIT_SCHEMA_VERSION =
    'smart-order-lifecycle-audit/2026-08-12.4';
const LIFECYCLE_DRAIN_RECORD_POLICY = Object.freeze({
    account_reconciliation: Object.freeze({
        states: Object.freeze(['missing_or_stale']),
        disposition: 'complete_current_account_reconciliation',
        quantityStates: Object.freeze(['not_applicable']),
    }),
    strategy: Object.freeze({
        states: Object.freeze([
            'draft',
            'observing',
            'monitoring',
            'paused',
            'recovery',
            'manual_intervention',
            'cancel_pending',
            'expired_with_obligation',
        ]),
        disposition: 'pause_or_cancel_strategy',
        quantityStates: Object.freeze(['not_applicable']),
    }),
    activation: Object.freeze({
        states: Object.freeze([
            'candidate',
            'triggered',
            'prepared',
            'dispatching',
            'working',
            'part_filled',
            'unknown',
        ]),
        disposition: 'cancel_strategy_or_complete_activation',
        quantityStates: Object.freeze(['not_applicable']),
    }),
    prepared_intent: Object.freeze({
        states: Object.freeze(['prepared']),
        disposition: 'cancel_proven_unsent_intent_and_release',
        quantityStates: Object.freeze(['not_applicable']),
    }),
    side_effect_intent: Object.freeze({
        states: Object.freeze([
            'prepared_authority_granted',
            'dispatching',
            'acknowledged',
            'reconciling',
            'unknown',
        ]),
        disposition: 'reconcile_intent_before_stop',
        quantityStates: Object.freeze(['not_applicable']),
    }),
    broker_order: Object.freeze({
        states: Object.freeze([
            'pending_submit',
            'pre_submitted',
            'submitted',
            'part_filled',
            'unknown',
        ]),
        disposition: 'cancel_working_order_or_reconcile',
        quantityStates: Object.freeze(['conservative_maximum']),
    }),
    protection_commitment: Object.freeze({
        states: Object.freeze(['pending_entry_fill', 'unknown']),
        disposition: 'prove_zero_fill_or_release_pre_dispatch',
        quantityStates: Object.freeze(['conservative_maximum']),
    }),
    protection_obligation: Object.freeze({
        states: Object.freeze(['pending_entry_fill', 'monitoring', 'unknown']),
        disposition: 'prove_zero_fill_confirmed_exit_or_break_glass',
        quantityStates: Object.freeze(['exact', 'conservative_maximum']),
    }),
    entry_exposure_reservation: Object.freeze({
        states: Object.freeze(['reserved', 'dispatching', 'working', 'unknown']),
        disposition: 'release_proven_unsent_or_reconcile',
        quantityStates: Object.freeze(['exact']),
    }),
    exit_claim: Object.freeze({
        states: Object.freeze([
            'monitoring_reserved',
            'intent_reserved',
            'broker_working',
            'unknown',
        ]),
        disposition: 'reconcile_or_release_claim',
        quantityStates: Object.freeze(['exact']),
    }),
    manual_resolution: Object.freeze({
        states: Object.freeze(['open']),
        disposition: 'complete_reason_specific_resolution',
        quantityStates: Object.freeze(['not_applicable']),
    }),
    safety_blocker: Object.freeze({
        states: Object.freeze(['open']),
        disposition: 'resolve_or_supersede_blocker',
        quantityStates: Object.freeze(['not_applicable']),
    }),
});

const EXPECTED_ORIGIN = 'http://127.0.0.1:5173';
const EMPTY_BODY_SHA256 =
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const MAX_RESPONSE_BYTES = 128 * 1024;
const TIMEOUT_MS = 2_000;
const EXTERNAL_GATE_RECOMPUTE_TIMEOUT_MS = 390_000;

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function explicitRoot(value) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) {
        throw new TypeError('diagnostics app support root must be absolute');
    }
    const normalized = path.resolve(value);
    if (normalized === path.parse(normalized).root) {
        throw new TypeError('diagnostics app support root may not be a root');
    }
    return normalized;
}

function requestAuthenticatedStatus({ capability, discovery, nowEpochMs }) {
    const pathname = '/v1/status';
    const authority = `127.0.0.1:${discovery.port}`;
    const proof = createSmartOrderGatewayProof({
        capability,
        method: 'GET',
        pathname,
        origin: EXPECTED_ORIGIN,
        runtimeEpochId: discovery.runtimeEpochId,
        sidecarAuthority: authority,
        bodyBytes: new Uint8Array(),
        nowEpochMs,
    });
    return new Promise((resolve, reject) => {
        let settled = false;
        const done = (handler, value) => {
            if (settled) return;
            settled = true;
            handler(value);
        };
        const request = http.request(
            {
                host: '127.0.0.1',
                port: discovery.port,
                method: 'GET',
                path: pathname,
                agent: false,
                family: 4,
                timeout: TIMEOUT_MS,
                headers: {
                    Host: authority,
                    Origin: EXPECTED_ORIGIN,
                    'Sec-Fetch-Site': 'same-origin',
                    'X-RealTimeStock-Request-Id': proof.requestId,
                    'X-RealTimeStock-Runtime-Epoch': proof.runtimeEpochId,
                    'X-RealTimeStock-Gateway-Timestamp': String(
                        proof.timestampEpochMs,
                    ),
                    'X-RealTimeStock-Gateway-Proof': proof.proof,
                    Accept: 'application/json',
                    Connection: 'close',
                },
            },
            (response) => {
                let total = 0;
                const chunks = [];
                response.on('data', (chunk) => {
                    const bytes = Buffer.isBuffer(chunk)
                        ? chunk
                        : Buffer.from(chunk);
                    total += bytes.byteLength;
                    if (total > MAX_RESPONSE_BYTES) {
                        response.destroy(new Error('diagnostics response too large'));
                        return;
                    }
                    chunks.push(bytes);
                });
                response.once('error', (error) => done(reject, error));
                response.once('end', () => {
                    const bodyBytes = Buffer.concat(chunks, total);
                    const contentType = response.headers['content-type'];
                    const responseRequestId =
                        response.headers['x-realtimestock-response-request-id'];
                    const responseRuntimeEpoch =
                        response.headers['x-realtimestock-runtime-epoch'];
                    if (
                        response.statusCode !== 200 ||
                        typeof contentType !== 'string' ||
                        !/^application\/json(?:\s*;|$)/i.test(contentType) ||
                        responseRequestId !== proof.requestId ||
                        responseRuntimeEpoch !== discovery.runtimeEpochId ||
                        !verifySmartOrderControlPlaneResponseProof({
                            capability,
                            runtimeEpochId: discovery.runtimeEpochId,
                            sidecarAuthority: authority,
                            requestId: proof.requestId,
                            method: 'GET',
                            pathname,
                            requestBodySha256: EMPTY_BODY_SHA256,
                            statusCode: response.statusCode,
                            contentType,
                            bodyBytes,
                            proof: response.headers[
                                'x-realtimestock-response-proof'
                            ],
                            bodySha256:
                                response.headers[
                                    'x-realtimestock-response-body-sha256'
                                ],
                        })
                    ) {
                        bodyBytes.fill(0);
                        done(reject, new Error('diagnostics response proof invalid'));
                        return;
                    }
                    let body;
                    try {
                        body = JSON.parse(bodyBytes.toString('utf8'));
                    } catch {
                        bodyBytes.fill(0);
                        done(reject, new Error('diagnostics response JSON invalid'));
                        return;
                    }
                    bodyBytes.fill(0);
                    done(resolve, body);
                });
            },
        );
        request.once('timeout', () =>
            request.destroy(new Error('diagnostics request timeout')),
        );
        request.once('error', (error) => done(reject, error));
        request.end();
    });
}

function requestAuthenticatedQuiesce({
    capability,
    discovery,
    nowEpochMs,
    operation,
}) {
    const pathname = '/v1/lifecycle/quiesce';
    const method = 'POST';
    const authority = `127.0.0.1:${discovery.port}`;
    const requestId = randomUUID();
    const plaintext = Buffer.from(JSON.stringify({ operation }), 'utf8');
    const envelope = sealSmartOrderControlPlaneMutation({
        capability,
        runtimeEpochId: discovery.runtimeEpochId,
        sidecarAuthority: authority,
        requestId,
        method,
        pathname,
        origin: EXPECTED_ORIGIN,
        plaintextBytes: plaintext,
    });
    plaintext.fill(0);
    const proof = createSmartOrderGatewayProof({
        capability,
        method,
        pathname,
        origin: EXPECTED_ORIGIN,
        runtimeEpochId: discovery.runtimeEpochId,
        sidecarAuthority: authority,
        requestId,
        envelopeNonce: envelope.nonce,
        bodyBytes: envelope.bodyBytes,
        nowEpochMs,
    });
    return requestAuthenticatedJson({
        capability,
        discovery,
        method,
        pathname,
        authority,
        proof,
        bodyBytes: envelope.bodyBytes,
        allowedStatusCodes: new Set([200, 409]),
        headers: {
            'Content-Type':
                'application/vnd.realtimestock.smart-order-envelope',
            'X-RealTimeStock-Envelope-Nonce': envelope.nonce,
        },
    }).finally(() => envelope.bodyBytes.fill(0));
}

function requestAuthenticatedLifecycleStop({
    capability,
    discovery,
    nowEpochMs,
    operation,
}) {
    const pathname = '/v1/lifecycle/stop';
    const method = 'POST';
    const authority = `127.0.0.1:${discovery.port}`;
    const requestId = randomUUID();
    const completionNonce = randomUUID();
    const plaintext = Buffer.from(
        JSON.stringify({ operation, completionNonce }),
        'utf8',
    );
    const envelope = sealSmartOrderControlPlaneMutation({
        capability,
        runtimeEpochId: discovery.runtimeEpochId,
        sidecarAuthority: authority,
        requestId,
        method,
        pathname,
        origin: EXPECTED_ORIGIN,
        plaintextBytes: plaintext,
    });
    plaintext.fill(0);
    const proof = createSmartOrderGatewayProof({
        capability,
        method,
        pathname,
        origin: EXPECTED_ORIGIN,
        runtimeEpochId: discovery.runtimeEpochId,
        sidecarAuthority: authority,
        requestId,
        envelopeNonce: envelope.nonce,
        bodyBytes: envelope.bodyBytes,
        nowEpochMs,
    });
    return requestAuthenticatedJson({
        capability,
        discovery,
        method,
        pathname,
        authority,
        proof,
        bodyBytes: envelope.bodyBytes,
        allowedStatusCodes: new Set([202, 409]),
        headers: {
            'Content-Type':
                'application/vnd.realtimestock.smart-order-envelope',
            'X-RealTimeStock-Envelope-Nonce': envelope.nonce,
        },
    })
        .then((response) =>
            Object.freeze({
                ...response,
                expected: Object.freeze({
                    operation,
                    runtimeEpochIdSha256: sha256(discovery.runtimeEpochId),
                    completionNonceSha256: sha256(completionNonce),
                    requestIdSha256: sha256(requestId),
                }),
            }),
        )
        .finally(() => envelope.bodyBytes.fill(0));
}

function requestAuthenticatedDrainAction({
    capability,
    discovery,
    nowEpochMs,
    pathname,
    payload,
}) {
    const method = 'POST';
    const authority = `127.0.0.1:${discovery.port}`;
    const requestId = randomUUID();
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    const envelope = sealSmartOrderControlPlaneMutation({
        capability,
        runtimeEpochId: discovery.runtimeEpochId,
        sidecarAuthority: authority,
        requestId,
        method,
        pathname,
        origin: EXPECTED_ORIGIN,
        plaintextBytes: plaintext,
    });
    plaintext.fill(0);
    const proof = createSmartOrderGatewayProof({
        capability,
        method,
        pathname,
        origin: EXPECTED_ORIGIN,
        runtimeEpochId: discovery.runtimeEpochId,
        sidecarAuthority: authority,
        requestId,
        envelopeNonce: envelope.nonce,
        bodyBytes: envelope.bodyBytes,
        nowEpochMs,
    });
    return requestAuthenticatedJson({
        capability,
        discovery,
        method,
        pathname,
        authority,
        proof,
        bodyBytes: envelope.bodyBytes,
        allowedStatusCodes: new Set([200]),
        headers: {
            'Content-Type':
                'application/vnd.realtimestock.smart-order-envelope',
            'X-RealTimeStock-Envelope-Nonce': envelope.nonce,
        },
    }).finally(() => envelope.bodyBytes.fill(0));
}

function requestAuthenticatedExternalGateRecompute({
    capability,
    discovery,
    nowEpochMs,
    operationId,
}) {
    const method = 'POST';
    const pathname = '/v1/gate-manifest/recompute';
    const authority = `127.0.0.1:${discovery.port}`;
    const requestId = operationId;
    const plaintext = Buffer.from(
        JSON.stringify({
            externalOrderEventObservation: true,
            operationId,
        }),
        'utf8',
    );
    const envelope = sealSmartOrderControlPlaneMutation({
        capability,
        runtimeEpochId: discovery.runtimeEpochId,
        sidecarAuthority: authority,
        requestId,
        method,
        pathname,
        origin: EXPECTED_ORIGIN,
        plaintextBytes: plaintext,
    });
    plaintext.fill(0);
    const proof = createSmartOrderGatewayProof({
        capability,
        method,
        pathname,
        origin: EXPECTED_ORIGIN,
        runtimeEpochId: discovery.runtimeEpochId,
        sidecarAuthority: authority,
        requestId,
        envelopeNonce: envelope.nonce,
        bodyBytes: envelope.bodyBytes,
        nowEpochMs,
    });
    return requestAuthenticatedJson({
        capability,
        discovery,
        method,
        pathname,
        authority,
        proof,
        bodyBytes: envelope.bodyBytes,
        allowedStatusCodes: new Set([200, 503]),
        timeoutMs: EXTERNAL_GATE_RECOMPUTE_TIMEOUT_MS,
        headers: {
            'Content-Type':
                'application/vnd.realtimestock.smart-order-envelope',
            'X-RealTimeStock-Envelope-Nonce': envelope.nonce,
        },
    }).finally(() => envelope.bodyBytes.fill(0));
}

function requestAuthenticatedTask03cReconciliation({
    capability,
    discovery,
    nowEpochMs,
    observation,
    operationId,
}) {
    const method = 'POST';
    const pathname = '/v1/task0-3c/reconcile';
    const authority = `127.0.0.1:${discovery.port}`;
    const requestId = operationId;
    const plaintext = Buffer.from(
        JSON.stringify({ observation, operationId }),
        'utf8',
    );
    const envelope = sealSmartOrderControlPlaneMutation({
        capability,
        runtimeEpochId: discovery.runtimeEpochId,
        sidecarAuthority: authority,
        requestId,
        method,
        pathname,
        origin: EXPECTED_ORIGIN,
        plaintextBytes: plaintext,
    });
    plaintext.fill(0);
    const proof = createSmartOrderGatewayProof({
        capability,
        method,
        pathname,
        origin: EXPECTED_ORIGIN,
        runtimeEpochId: discovery.runtimeEpochId,
        sidecarAuthority: authority,
        requestId,
        envelopeNonce: envelope.nonce,
        bodyBytes: envelope.bodyBytes,
        nowEpochMs,
    });
    return requestAuthenticatedJson({
        capability,
        discovery,
        method,
        pathname,
        authority,
        proof,
        bodyBytes: envelope.bodyBytes,
        allowedStatusCodes: new Set([200, 503]),
        timeoutMs: 10_000,
        headers: {
            'Content-Type':
                'application/vnd.realtimestock.smart-order-envelope',
            'X-RealTimeStock-Envelope-Nonce': envelope.nonce,
        },
    }).finally(() => envelope.bodyBytes.fill(0));
}

export async function recordSmartOrderTask03cExternalWorkingSet({
    appSupportRoot,
    expectedApiGeneration,
    observation,
    now = () => Date.now(),
}) {
    const root = explicitRoot(appSupportRoot);
    if (
        typeof expectedApiGeneration !== 'string' ||
        !/^simulation:[A-Za-z0-9._:-]{1,240}$/.test(expectedApiGeneration) ||
        !observation ||
        typeof observation !== 'object' ||
        Array.isArray(observation)
    ) {
        throw new TypeError('Task 0.3c reconciliation input is invalid');
    }
    const discoveryPath = path.join(
        root,
        'smart-order',
        'run',
        'control-plane.json',
    );
    const before = await readPrivateRuntimeDiscovery(discoveryPath, {
        nowEpochMs: now(),
    });
    const capability = await readPrivateSecret(
        path.join(root, 'smart-order', 'private', 'gateway-capability.bin'),
    );
    try {
        const response = await requestAuthenticatedTask03cReconciliation({
            capability,
            discovery: before,
            nowEpochMs: now(),
            observation,
            operationId: randomUUID(),
        });
        const after = await readPrivateRuntimeDiscovery(discoveryPath, {
            nowEpochMs: now(),
        });
        if (
            after.runtimeEpochId !== before.runtimeEpochId ||
            after.port !== before.port ||
            after.startedAtEpochMs !== before.startedAtEpochMs ||
            response.body?.brokerWriteAttempted !== false
        ) {
            throw new Error('Task 0.3c reconciliation Runtime binding changed');
        }
        if (response.statusCode === 503) {
            if (
                response.body?.code !==
                    'task0_3c_reconciliation_failed_closed' ||
                response.body?.brokerWriteAttempted !== false
            ) {
                throw new Error(
                    'Task 0.3c reconciliation failure projection is invalid',
                );
            }
            throw new Error('Task 0.3c reconciliation failed closed');
        }
        const result = response.body?.result;
        if (
            !result ||
            result.state !== 'recorded' ||
            result.externalSellClaimCount !== 2 ||
            typeof result.workingSetHash !== 'string' ||
            !/^sha256:[0-9a-f]{64}$/.test(result.workingSetHash) ||
            !Number.isSafeInteger(result.visibilityRevision) ||
            result.visibilityRevision < 0 ||
            result.brokerWriteAuthority !== false ||
            result.writeMasterAuthority !== false
        ) {
            throw new Error(
                'Task 0.3c reconciliation result projection is invalid',
            );
        }
        return Object.freeze({
            state: result.state,
            externalSellClaimCount: 2,
            workingSetHash: result.workingSetHash,
            visibilityRevision: result.visibilityRevision,
            replayed: result.replayed === true,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
            writeMasterAuthority: false,
            brokerAuthority: false,
        });
    } finally {
        capability.fill(0);
    }
}

export async function recomputeSmartOrderGateManifestsFromExternalObservation({
    appSupportRoot,
    expectedApiGeneration,
    now = () => Date.now(),
}) {
    const root = explicitRoot(appSupportRoot);
    if (
        typeof expectedApiGeneration !== 'string' ||
        !/^simulation:[A-Za-z0-9._:-]{1,240}$/.test(expectedApiGeneration)
    ) {
        throw new TypeError('expected API generation is invalid');
    }
    const discoveryPath = path.join(
        root,
        'smart-order',
        'run',
        'control-plane.json',
    );
    const before = await readPrivateRuntimeDiscovery(discoveryPath, {
        nowEpochMs: now(),
    });
    const capability = await readPrivateSecret(
        path.join(
            root,
            'smart-order',
            'private',
            'gateway-capability.bin',
        ),
    );
    try {
        const response = await requestAuthenticatedExternalGateRecompute({
            capability,
            discovery: before,
            nowEpochMs: now(),
            operationId: randomUUID(),
        });
        const after = await readPrivateRuntimeDiscovery(discoveryPath, {
            nowEpochMs: now(),
        });
        if (
            after.runtimeEpochId !== before.runtimeEpochId ||
            after.port !== before.port ||
            after.startedAtEpochMs !== before.startedAtEpochMs ||
            response.body?.brokerWriteAttempted !== false
        ) {
            throw new Error(
                'external Gate recomputation Runtime binding changed',
            );
        }
        if (response.statusCode === 503) {
            if (
                response.body?.code !== 'gate_runner_failed_closed' ||
                response.body?.brokerWriteAttempted !== false
            ) {
                throw new Error(
                    'external Gate recomputation failure projection is invalid',
                );
            }
            return Object.freeze({
                schemaVersion:
                    'smart-order-external-gate-recompute/2026-08-27.1',
                stored: false,
                state: 'observe_only',
                reason: 'gate_runner_failed_closed',
                manifestCount: 0,
                replayed: false,
                brokerWriteAttempted: false,
                brokerWriteNetworked: false,
                writeMasterAuthority: false,
                brokerAuthority: false,
                accountIdentifiersExposed: false,
                secretValuesExposed: false,
            });
        }
        const result = response.body?.result;
        if (
            !result ||
            typeof result !== 'object' ||
            result.brokerWriteAuthority !== false ||
            result.writeMasterAuthority !== false ||
            result.state !== 'observe_only' ||
            typeof result.stored !== 'boolean' ||
            !Number.isSafeInteger(result.manifestCount) ||
            result.manifestCount < 0 ||
            result.manifestCount > 3
        ) {
            throw new Error(
                'external Gate recomputation result projection is invalid',
            );
        }
        return Object.freeze({
            schemaVersion:
                'smart-order-external-gate-recompute/2026-08-27.1',
            stored: result.stored,
            state: 'observe_only',
            reason:
                typeof result.reason === 'string' &&
                /^[a-z0-9_]{1,120}$/.test(result.reason)
                    ? result.reason
                    : null,
            manifestCount: result.manifestCount,
            replayed: result.replayed === true,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
            writeMasterAuthority: false,
            brokerAuthority: false,
            accountIdentifiersExposed: false,
            secretValuesExposed: false,
        });
    } finally {
        capability.fill(0);
    }
}

function requestAuthenticatedGateProbePreparation({
    capability,
    discovery,
    nowEpochMs,
    envelope: sourceEnvelope,
    cliAuthorization,
}) {
    const method = 'POST';
    const pathname = '/v1/gate-probe/prepare';
    const authority = `127.0.0.1:${discovery.port}`;
    const requestId = sourceEnvelope.operationId;
    const plaintext = Buffer.from(
        JSON.stringify({ cliAuthorization, envelope: sourceEnvelope }),
        'utf8',
    );
    const envelope = sealSmartOrderControlPlaneMutation({
        capability,
        runtimeEpochId: discovery.runtimeEpochId,
        sidecarAuthority: authority,
        requestId,
        method,
        pathname,
        origin: EXPECTED_ORIGIN,
        plaintextBytes: plaintext,
    });
    plaintext.fill(0);
    const proof = createSmartOrderGatewayProof({
        capability,
        method,
        pathname,
        origin: EXPECTED_ORIGIN,
        runtimeEpochId: discovery.runtimeEpochId,
        sidecarAuthority: authority,
        requestId,
        envelopeNonce: envelope.nonce,
        bodyBytes: envelope.bodyBytes,
        nowEpochMs,
    });
    return requestAuthenticatedJson({
        capability,
        discovery,
        method,
        pathname,
        authority,
        proof,
        bodyBytes: envelope.bodyBytes,
        allowedStatusCodes: new Set([200]),
        headers: {
            'Content-Type':
                'application/vnd.realtimestock.smart-order-envelope',
            'X-RealTimeStock-Envelope-Nonce': envelope.nonce,
        },
    }).finally(() => envelope.bodyBytes.fill(0));
}

export async function prepareSmartOrderGateProbeSafetyEnvelope({
    appSupportRoot,
    expectedApiGeneration,
    envelope,
    cliAuthorization,
    now = () => Date.now(),
}) {
    const root = explicitRoot(appSupportRoot);
    if (
        typeof expectedApiGeneration !== 'string' ||
        !/^simulation:[A-Za-z0-9._:-]{1,240}$/.test(expectedApiGeneration)
    ) {
        throw new TypeError('expected API generation is invalid');
    }
    const canonical = canonicalSmartOrderGateProbeSafetyEnvelope(envelope);
    const discoveryPath = path.join(
        root,
        'smart-order',
        'run',
        'control-plane.json',
    );
    const capabilityPath = path.join(
        root,
        'smart-order',
        'private',
        'gateway-capability.bin',
    );
    const before = await readPrivateRuntimeDiscovery(discoveryPath, {
        nowEpochMs: now(),
    });
    if (
        cliAuthorization?.apiGenerationSha256 !==
            sha256(expectedApiGeneration) ||
        cliAuthorization?.runtimeEpochIdSha256 !==
            sha256(before.runtimeEpochId)
    ) {
        throw new Error(
            'gate probe CLI authorization generation binding is invalid',
        );
    }
    const capability = await readPrivateSecret(capabilityPath);
    try {
        const response = await requestAuthenticatedGateProbePreparation({
            capability,
            discovery: before,
            nowEpochMs: now(),
            envelope: canonical.sourceEnvelope,
            cliAuthorization,
        });
        const after = await readPrivateRuntimeDiscovery(discoveryPath, {
            nowEpochMs: now(),
        });
        if (
            after.runtimeEpochId !== before.runtimeEpochId ||
            after.port !== before.port ||
            after.startedAtEpochMs !== before.startedAtEpochMs
        ) {
            throw new Error(
                'runtime discovery changed during gate probe preparation',
            );
        }
        const result = response.body?.result;
        if (
            response.body?.brokerWriteAttempted !== false ||
            response.body?.brokerAuthority !== false ||
            response.body?.writeMasterAuthority !== false ||
            !result ||
            result.prepared !== true ||
            result.state !== 'prepared' ||
            result.brokerWriteAttempted !== false ||
            result.brokerAuthority !== false ||
            result.writeMasterAuthority !== false ||
            result.simulationAttested !== true ||
            result.caLoaded !== false ||
            result.productionLoaded !== false ||
            result.accountScopeSha256 !==
                canonical.envelope.accountScopeSha256 ||
            result.envelopeSha256 !== canonical.envelopeSha256
        ) {
            throw new Error(
                'gate probe preparation result projection is invalid',
            );
        }
        return Object.freeze({
            schemaVersion:
                'smart-order-gate-probe-cli-preparation/2026-08-22.1',
            operation: canonical.envelope.operation,
            operationId: canonical.envelope.operationId,
            runId: canonical.envelope.runId,
            accountScopeSha256: canonical.envelope.accountScopeSha256,
            envelopeSha256: canonical.envelopeSha256,
            safetyAttestationSha256: result.safetyAttestationSha256,
            prepared: true,
            simulationAttested: true,
            caLoaded: false,
            productionLoaded: false,
            automaticRetryAllowed: false,
            cleanupAllowed: false,
            brokerWriteAttempted: false,
            brokerAuthority: false,
            writeMasterAuthority: false,
            secretValuesExposed: false,
        });
    } finally {
        capability.fill(0);
    }
}

async function waitForLifecycleStopCompletion(
    filePath,
    { capability, expected, timeoutMs },
) {
    let lastError;
    const deadlineMonotonicMs = performance.now() + timeoutMs;
    while (performance.now() < deadlineMonotonicMs) {
        try {
            return await verifyPrivateLifecycleStopCompletion(filePath, {
                capability,
                expected,
            });
        } catch (error) {
            lastError = error;
            if (!['ENOENT'].includes(error?.code)) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw lastError ?? new Error('lifecycle stop completion timed out');
}

function requestAuthenticatedJson({
    capability,
    discovery,
    method,
    pathname,
    authority,
    proof,
    bodyBytes,
    allowedStatusCodes,
    timeoutMs = TIMEOUT_MS,
    headers,
}) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const done = (handler, value) => {
            if (settled) return;
            settled = true;
            handler(value);
        };
        const request = http.request(
            {
                host: '127.0.0.1',
                port: discovery.port,
                method,
                path: pathname,
                agent: false,
                family: 4,
                timeout: timeoutMs,
                headers: {
                    Host: authority,
                    Origin: EXPECTED_ORIGIN,
                    'Sec-Fetch-Site': 'same-origin',
                    'X-RealTimeStock-Request-Id': proof.requestId,
                    'X-RealTimeStock-Runtime-Epoch': proof.runtimeEpochId,
                    'X-RealTimeStock-Gateway-Timestamp': String(
                        proof.timestampEpochMs,
                    ),
                    'X-RealTimeStock-Gateway-Proof': proof.proof,
                    'Content-Length': String(bodyBytes.byteLength),
                    Accept: 'application/json',
                    Connection: 'close',
                    ...headers,
                },
            },
            (response) => {
                let total = 0;
                const chunks = [];
                response.on('data', (chunk) => {
                    const bytes = Buffer.isBuffer(chunk)
                        ? chunk
                        : Buffer.from(chunk);
                    total += bytes.byteLength;
                    if (total > MAX_RESPONSE_BYTES) {
                        response.destroy(
                            new Error('diagnostics response too large'),
                        );
                        return;
                    }
                    chunks.push(bytes);
                });
                response.once('error', (error) => done(reject, error));
                response.once('end', () => {
                    const responseBytes = Buffer.concat(chunks, total);
                    const contentType = response.headers['content-type'];
                    if (
                        !allowedStatusCodes.has(response.statusCode) ||
                        typeof contentType !== 'string' ||
                        !/^application\/json(?:\s*;|$)/i.test(contentType) ||
                        response.headers[
                            'x-realtimestock-response-request-id'
                        ] !== proof.requestId ||
                        response.headers['x-realtimestock-runtime-epoch'] !==
                            discovery.runtimeEpochId ||
                        !verifySmartOrderControlPlaneResponseProof({
                            capability,
                            runtimeEpochId: discovery.runtimeEpochId,
                            sidecarAuthority: authority,
                            requestId: proof.requestId,
                            method,
                            pathname,
                            requestBodySha256: proof.bodySha256,
                            statusCode: response.statusCode,
                            contentType,
                            bodyBytes: responseBytes,
                            proof: response.headers[
                                'x-realtimestock-response-proof'
                            ],
                            bodySha256:
                                response.headers[
                                    'x-realtimestock-response-body-sha256'
                                ],
                        })
                    ) {
                        responseBytes.fill(0);
                        done(
                            reject,
                            new Error('diagnostics response proof invalid'),
                        );
                        return;
                    }
                    try {
                        const body = JSON.parse(responseBytes.toString('utf8'));
                        responseBytes.fill(0);
                        done(resolve, {
                            statusCode: response.statusCode,
                            body,
                        });
                    } catch {
                        responseBytes.fill(0);
                        done(
                            reject,
                            new Error('diagnostics response JSON invalid'),
                        );
                    }
                });
            },
        );
        request.once('timeout', () =>
            request.destroy(new Error('diagnostics request timeout')),
        );
        request.once('error', (error) => done(reject, error));
        request.end(bodyBytes);
    });
}

function boundedCount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function validLifecycleDrainRecord(record, index) {
    if (
        !record ||
        typeof record !== 'object' ||
        Array.isArray(record) ||
        JSON.stringify(Object.keys(record).sort()) !==
            JSON.stringify([
                'disposition',
                'kind',
                'ordinal',
                'quantityShares',
                'quantityState',
                'state',
            ]) ||
        record.ordinal !== index + 1 ||
        typeof record.kind !== 'string' ||
        !Object.hasOwn(LIFECYCLE_DRAIN_RECORD_POLICY, record.kind)
    ) {
        return false;
    }
    const policy = LIFECYCLE_DRAIN_RECORD_POLICY[record.kind];
    return (
        policy.states.includes(record.state) &&
        policy.quantityStates.includes(record.quantityState) &&
        record.disposition === policy.disposition &&
        (record.quantityState === 'not_applicable'
            ? record.quantityShares === null
            : boundedCount(record.quantityShares) !== null)
    );
}

function safeDiagnostics(status, expectedApiGeneration) {
    const runtime = status?.runtime;
    const lifecycle = status?.lifecycle;
    const remainder = lifecycle?.runtimeTrackedUnprotectedRemainder;
    const activeObligationCount = boundedCount(
        lifecycle?.activeObligationCount,
    );
    const blockerCount = boundedCount(lifecycle?.blockerCount);
    const gracefulStopBlockerCount = boundedCount(
        lifecycle?.gracefulStopBlockerCount,
    );
    const drainItems = Array.isArray(lifecycle?.drainItems)
        ? lifecycle.drainItems
        : null;
    const drainRecords = Array.isArray(lifecycle?.drainRecords)
        ? lifecycle.drainRecords
        : null;
    const drainItemCount = drainItems?.reduce(
        (total, item) => total + (boundedCount(item?.count) ?? 0),
        0,
    );
    const conservativeMaximumShares = boundedCount(
        remainder?.conservativeMaximumShares,
    );
    if (
        !status ||
        typeof status !== 'object' ||
        Array.isArray(status) ||
        status.secretValuesExposed !== false ||
        status.controlPlane !== 'loopback_authenticated' ||
        runtime?.mode !== 'simulation' ||
        runtime?.role !== 'primary' ||
        runtime?.apiGenerationSha256 !== sha256(expectedApiGeneration) ||
        lifecycle?.schemaVersion !== SMART_ORDER_LIFECYCLE_AUDIT_SCHEMA_VERSION ||
        lifecycle?.state !== 'verified_repository_projection' ||
        lifecycle?.writeMaster !== 'disabled' ||
        activeObligationCount === null ||
        blockerCount === null ||
        gracefulStopBlockerCount === null ||
        !drainItems ||
        drainItems.length !== Object.keys(LIFECYCLE_DRAIN_RECORD_POLICY).length ||
        drainItems.some(
            (item) =>
                !item ||
                typeof item !== 'object' ||
                Array.isArray(item) ||
                JSON.stringify(Object.keys(item).sort()) !==
                    JSON.stringify(['count', 'disposition', 'kind']) ||
                typeof item.kind !== 'string' ||
                !Object.hasOwn(LIFECYCLE_DRAIN_RECORD_POLICY, item.kind) ||
                boundedCount(item.count) === null ||
                item.disposition !==
                    LIFECYCLE_DRAIN_RECORD_POLICY[item.kind]?.disposition,
        ) ||
        new Set(drainItems.map((item) => item.kind)).size !== drainItems.length ||
        Object.keys(LIFECYCLE_DRAIN_RECORD_POLICY).some(
            (kind) => !drainItems.some((item) => item.kind === kind),
        ) ||
        !Number.isSafeInteger(drainItemCount) ||
        drainItemCount !== gracefulStopBlockerCount ||
        !drainRecords ||
        drainRecords.length > 100 ||
        drainRecords.some((record, index) =>
            !validLifecycleDrainRecord(record, index),
        ) ||
        typeof lifecycle.drainRecordsTruncated !== 'boolean' ||
        (!lifecycle.drainRecordsTruncated &&
            drainRecords.length !== gracefulStopBlockerCount) ||
        conservativeMaximumShares === null ||
        !['known', 'unknown'].includes(remainder?.state) ||
        (remainder.state === 'known' && boundedCount(remainder.shares) === null) ||
        (remainder.state === 'unknown' && remainder.shares !== null) ||
        lifecycle.accountIdentifiersExposed !== false ||
        lifecycle.entityIdentifiersExposed !== false ||
        lifecycle.strategyDefinitionsExposed !== false
    ) {
        throw new Error('diagnostics status projection is invalid');
    }
    return Object.freeze({
        schemaVersion: SMART_ORDER_RUNTIME_DIAGNOSTICS_SCHEMA_VERSION,
        authenticated: true,
        runtimeState:
            typeof runtime.state === 'string' && runtime.state.length <= 64
                ? runtime.state
                : 'unknown',
        repositoryReady: runtime.repositoryReady === true,
        dispatchAllowed: false,
        writeMaster: 'disabled',
        reconciliation:
            typeof lifecycle.reconciliation === 'string' &&
            lifecycle.reconciliation.length <= 80
                ? lifecycle.reconciliation
                : 'required_before_any_write_or_drain',
        activeObligationCount,
        blockerCount,
        drainItems: Object.freeze(
            drainItems.map((item) =>
                Object.freeze({
                    kind: item.kind,
                    count: item.count,
                    disposition: item.disposition,
                }),
            ),
        ),
        drainRecords: Object.freeze(
            drainRecords.map((record) =>
                Object.freeze({
                    ordinal: record.ordinal,
                    kind: record.kind,
                    state: record.state,
                    quantityShares: record.quantityShares,
                    quantityState: record.quantityState,
                    disposition: record.disposition,
                }),
            ),
        ),
        drainRecordsTruncated: lifecycle.drainRecordsTruncated,
        runtimeTrackedUnprotectedRemainder: Object.freeze({
            state: remainder.state,
            shares: remainder.shares,
            conservativeMaximumShares,
            currentAccountReconciliationRequired:
                remainder.currentAccountReconciliationRequired === true,
        }),
        productionReadonlyDrainAllowed:
            lifecycle.productionReadonlyDrainAllowed === true,
        gracefulStopAllowed: lifecycle.gracefulStopAllowed === true,
        uninstallAllowed: lifecycle.uninstallAllowed === true,
        accountIdentifiersExposed: false,
        entityIdentifiersExposed: false,
        secretValuesExposed: false,
    });
}

export async function readSmartOrderRuntimeDiagnostics({
    appSupportRoot,
    expectedApiGeneration,
    now = () => Date.now(),
}) {
    const root = explicitRoot(appSupportRoot);
    if (
        typeof expectedApiGeneration !== 'string' ||
        !/^simulation:[A-Za-z0-9._:-]{1,240}$/.test(expectedApiGeneration)
    ) {
        throw new TypeError('expected API generation is invalid');
    }
    const discoveryPath = path.join(
        root,
        'smart-order',
        'run',
        'control-plane.json',
    );
    const capabilityPath = path.join(
        root,
        'smart-order',
        'private',
        'gateway-capability.bin',
    );
    const before = await readPrivateRuntimeDiscovery(discoveryPath, {
        nowEpochMs: now(),
    });
    const capability = await readPrivateSecret(capabilityPath);
    try {
        const status = await requestAuthenticatedStatus({
            capability,
            discovery: before,
            nowEpochMs: now(),
        });
        const after = await readPrivateRuntimeDiscovery(discoveryPath, {
            nowEpochMs: now(),
        });
        if (
            after.runtimeEpochId !== before.runtimeEpochId ||
            after.port !== before.port ||
            after.startedAtEpochMs !== before.startedAtEpochMs
        ) {
            throw new Error('runtime discovery changed during diagnostics');
        }
        const currentCapability = await readPrivateSecret(capabilityPath);
        try {
            if (!Buffer.from(currentCapability).equals(capability)) {
                throw new Error('gateway capability changed during diagnostics');
            }
        } finally {
            currentCapability.fill(0);
        }
        return safeDiagnostics(status, expectedApiGeneration);
    } finally {
        capability.fill(0);
    }
}

export async function runSmartOrderDrainAction({
    appSupportRoot,
    expectedApiGeneration,
    action,
    strategyId,
    expectedRevision,
    challengeId,
    now = () => Date.now(),
}) {
    const root = explicitRoot(appSupportRoot);
    if (
        typeof expectedApiGeneration !== 'string' ||
        !/^simulation:[A-Za-z0-9._:-]{1,240}$/.test(expectedApiGeneration)
    ) {
        throw new TypeError('expected API generation is invalid');
    }
    if (
        typeof strategyId !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(strategyId) ||
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 0
    ) {
        throw new TypeError('drain action strategy scope is invalid');
    }
    const actions = Object.freeze({
        'strategy-cancel': Object.freeze({
            suffix: 'cancel',
            acknowledgement: Object.freeze({}),
        }),
        'cancel-broker-order': Object.freeze({
            suffix: 'cancel-broker-order',
            acknowledgement: Object.freeze({
                userConfirmationAcknowledged: true,
            }),
        }),
        'drain-prepared': Object.freeze({
            suffix: 'drain-prepared',
            acknowledgement: Object.freeze({
                userConfirmationAcknowledged: true,
            }),
        }),
        'relinquish-protection-prepare': Object.freeze({
            suffix: 'relinquish-protection-prepare',
            acknowledgement: Object.freeze({
                operatorAcknowledgedManualHandoff: true,
            }),
        }),
        'relinquish-protection-commit': Object.freeze({
            suffix: 'relinquish-protection-commit',
            acknowledgement: Object.freeze({
                operatorAcknowledgedManualHandoff: true,
            }),
        }),
    });
    if (!Object.hasOwn(actions, action)) {
        throw new TypeError('drain action is invalid');
    }
    const selected = actions[action];
    if (
        action === 'relinquish-protection-commit' &&
        (typeof challengeId !== 'string' ||
            !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(challengeId))
    ) {
        throw new TypeError('relinquishment challenge is invalid');
    }
    if (
        action !== 'relinquish-protection-commit' &&
        challengeId !== undefined
    ) {
        throw new TypeError('challenge is not valid for this drain action');
    }
    const discoveryPath = path.join(
        root,
        'smart-order',
        'run',
        'control-plane.json',
    );
    const capabilityPath = path.join(
        root,
        'smart-order',
        'private',
        'gateway-capability.bin',
    );
    const before = await readPrivateRuntimeDiscovery(discoveryPath, {
        nowEpochMs: now(),
    });
    const capability = await readPrivateSecret(capabilityPath);
    try {
        const response = await requestAuthenticatedDrainAction({
            capability,
            discovery: before,
            nowEpochMs: now(),
            pathname: `/v1/strategies/${encodeURIComponent(strategyId)}/${selected.suffix}`,
            payload: {
                ...(challengeId === undefined ? {} : { challengeId }),
                expectedRevision,
                operationId: randomUUID(),
                ...selected.acknowledgement,
            },
        });
        const after = await readPrivateRuntimeDiscovery(discoveryPath, {
            nowEpochMs: now(),
        });
        if (
            after.runtimeEpochId !== before.runtimeEpochId ||
            after.port !== before.port ||
            after.startedAtEpochMs !== before.startedAtEpochMs
        ) {
            throw new Error('runtime discovery changed during drain action');
        }
        if (
            !response.body ||
            response.body.brokerWriteAttempted !== false ||
            typeof response.body.resultHash !== 'string' ||
            !/^sha256:[0-9a-f]{64}$/.test(response.body.resultHash) ||
            typeof response.body.result !== 'object' ||
            response.body.result === null ||
            response.body.result.strategyId !== strategyId ||
            (action !== 'strategy-cancel' &&
                response.body.result.brokerWriteAttempted !== false)
        ) {
            throw new Error('drain action result projection is invalid');
        }
        return Object.freeze({
            schemaVersion: 'smart-order-runtime-drain-action/2026-08-13.1',
            action,
            strategyId,
            expectedRevision,
            result: Object.freeze({ ...response.body.result }),
            resultHash: response.body.resultHash,
            brokerWriteAttempted: false,
            writeMaster: 'disabled',
        });
    } finally {
        capability.fill(0);
    }
}

function lifecycleOperation(value) {
    if (
        !SMART_ORDER_LIFECYCLE_OPERATIONS.includes(value)
    ) {
        throw new TypeError('lifecycle operation is invalid');
    }
    return value;
}

export async function quiesceSmartOrderRuntime({
    appSupportRoot,
    expectedApiGeneration,
    operation,
    now = () => Date.now(),
}) {
    const root = explicitRoot(appSupportRoot);
    const selectedOperation = lifecycleOperation(operation);
    if (
        typeof expectedApiGeneration !== 'string' ||
        !/^simulation:[A-Za-z0-9._:-]{1,240}$/.test(expectedApiGeneration)
    ) {
        throw new TypeError('expected API generation is invalid');
    }
    const discoveryPath = path.join(
        root,
        'smart-order',
        'run',
        'control-plane.json',
    );
    const capabilityPath = path.join(
        root,
        'smart-order',
        'private',
        'gateway-capability.bin',
    );
    const before = await readPrivateRuntimeDiscovery(discoveryPath, {
        nowEpochMs: now(),
    });
    const capability = await readPrivateSecret(capabilityPath);
    try {
        const response = await requestAuthenticatedQuiesce({
            capability,
            discovery: before,
            nowEpochMs: now(),
            operation: selectedOperation,
        });
        const after = await readPrivateRuntimeDiscovery(discoveryPath, {
            nowEpochMs: now(),
        });
        if (
            after.runtimeEpochId !== before.runtimeEpochId ||
            after.port !== before.port ||
            after.startedAtEpochMs !== before.startedAtEpochMs
        ) {
            throw new Error('runtime discovery changed during quiesce');
        }
        const currentCapability = await readPrivateSecret(capabilityPath);
        try {
            if (!Buffer.from(currentCapability).equals(capability)) {
                throw new Error('gateway capability changed during quiesce');
            }
        } finally {
            currentCapability.fill(0);
        }
        const body = response.body;
        if (
            !body ||
            body.schemaVersion !==
                'smart-order-lifecycle-quiesce/2026-08-12.1' ||
            !['quiescing', 'observe_only', 'reconciling'].includes(body.state) ||
            body.operation !== selectedOperation ||
            body.dispatchAllowed !== false ||
            body.writeMaster !== 'disabled' ||
            body.brokerWriteAttempted !== false ||
            body.accountIdentifiersExposed !== false ||
            body.entityIdentifiersExposed !== false ||
            body.drainAllowed !== (response.statusCode === 200)
        ) {
            throw new Error('lifecycle quiesce projection is invalid');
        }
        return Object.freeze({
            schemaVersion:
                'smart-order-runtime-quiesce-result/2026-08-12.1',
            operation: selectedOperation,
            state: body.state,
            drainAllowed: body.drainAllowed,
            dispatchAllowed: false,
            writeMaster: 'disabled',
            blockerCount:
                Number.isSafeInteger(body.blockerCount) &&
                body.blockerCount >= 0
                    ? body.blockerCount
                    : null,
            accountIdentifiersExposed: false,
            entityIdentifiersExposed: false,
            secretValuesExposed: false,
        });
    } finally {
        capability.fill(0);
    }
}

export async function stopSmartOrderRuntime({
    appSupportRoot,
    expectedApiGeneration,
    operation,
    now = () => Date.now(),
}) {
    const root = explicitRoot(appSupportRoot);
    const selectedOperation = lifecycleOperation(operation);
    if (
        typeof expectedApiGeneration !== 'string' ||
        !/^simulation:[A-Za-z0-9._:-]{1,240}$/.test(expectedApiGeneration)
    ) {
        throw new TypeError('expected API generation is invalid');
    }
    const discoveryPath = path.join(
        root,
        'smart-order',
        'run',
        'control-plane.json',
    );
    const completionPath = path.join(
        root,
        'smart-order',
        'run',
        'lifecycle-stop-completion.json',
    );
    const barrierPath = path.join(
        root,
        'smart-order',
        'run',
        'lifecycle-stop-barrier.json',
    );
    const capabilityPath = path.join(
        root,
        'smart-order',
        'private',
        'gateway-capability.bin',
    );
    const discovery = await readPrivateRuntimeDiscovery(discoveryPath, {
        nowEpochMs: now(),
    });
    const capability = await readPrivateSecret(capabilityPath);
    try {
        const response = await requestAuthenticatedLifecycleStop({
            capability,
            discovery,
            nowEpochMs: now(),
            operation: selectedOperation,
        });
        const body = response.body;
        if (
            response.statusCode !== 202 ||
            body?.schemaVersion !==
                'smart-order-lifecycle-stop-commit/2026-08-12.1' ||
            body.state !== 'stopped' ||
            body.operation !== selectedOperation ||
            body.committed !== true ||
            body.runtimeEpochIdSha256 !==
                response.expected.runtimeEpochIdSha256 ||
            body.apiGenerationSha256 !== sha256(expectedApiGeneration) ||
            body.completionNonceSha256 !==
                response.expected.completionNonceSha256 ||
            body.requestIdSha256 !== response.expected.requestIdSha256 ||
            !Number.isSafeInteger(body.stopRevision) ||
            body.stopRevision < 0 ||
            body.cleanupPending !== true ||
            body.dispatchAllowed !== false ||
            body.writeMaster !== 'disabled' ||
            body.brokerWriteAttempted !== false ||
            body.accountIdentifiersExposed !== false ||
            body.entityIdentifiersExposed !== false
        ) {
            throw new Error('lifecycle stop commit projection is invalid');
        }
        const completion = await waitForLifecycleStopCompletion(
            completionPath,
            {
                capability,
                expected: {
                    operation: selectedOperation,
                    runtimeEpochIdSha256:
                        response.expected.runtimeEpochIdSha256,
                    apiGenerationSha256: body.apiGenerationSha256,
                    stopRevision: body.stopRevision,
                    completionNonceSha256:
                        response.expected.completionNonceSha256,
                    requestIdSha256: response.expected.requestIdSha256,
                },
                timeoutMs: TIMEOUT_MS,
            },
        );
        return Object.freeze({
            schemaVersion:
                'smart-order-runtime-stop-result/2026-08-12.1',
            operation: selectedOperation,
            state: 'closed',
            stopRevision: completion.stopRevision,
            completionBinding: Object.freeze({
                operation: selectedOperation,
                runtimeEpochIdSha256:
                    response.expected.runtimeEpochIdSha256,
                apiGenerationSha256: body.apiGenerationSha256,
                stopRevision: body.stopRevision,
                completionNonceSha256:
                    response.expected.completionNonceSha256,
                requestIdSha256: response.expected.requestIdSha256,
            }),
            repositoryClosed: completion.repositoryClosed,
            controlPlaneUnpublished: completion.controlPlaneUnpublished,
            runtimeLeaseReleased: completion.runtimeLeaseReleased,
            dispatchAllowed: false,
            writeMaster: 'disabled',
            brokerWriteAttempted: false,
            secretValuesExposed: false,
        });
    } finally {
        capability.fill(0);
    }
}

export async function finalizeSmartOrderRuntimeStop({
    appSupportRoot,
    completionBinding,
}) {
    const root = explicitRoot(appSupportRoot);
    const completionPath = path.join(
        root,
        'smart-order',
        'run',
        'lifecycle-stop-completion.json',
    );
    const barrierPath = path.join(
        root,
        'smart-order',
        'run',
        'lifecycle-stop-barrier.json',
    );
    const capabilityPath = path.join(
        root,
        'smart-order',
        'private',
        'gateway-capability.bin',
    );
    const capability = await readPrivateSecret(capabilityPath);
    try {
        const completion = await consumePrivateLifecycleStopCompletion(
            completionPath,
            {
                capability,
                expected: completionBinding,
                barrierPath,
            },
        );
        return Object.freeze({
            schemaVersion:
                'smart-order-runtime-stop-finalized/2026-08-12.1',
            operation: completion.operation,
            stopRevision: completion.stopRevision,
            finalized: true,
            dispatchAllowed: false,
            writeMaster: 'disabled',
            brokerWriteAttempted: false,
            secretValuesExposed: false,
        });
    } finally {
        capability.fill(0);
    }
}

export async function readPendingSmartOrderRuntimeStop({ appSupportRoot }) {
    const root = explicitRoot(appSupportRoot);
    const completionPath = path.join(
        root,
        'smart-order',
        'run',
        'lifecycle-stop-completion.json',
    );
    const barrierPath = path.join(
        root,
        'smart-order',
        'run',
        'lifecycle-stop-barrier.json',
    );
    const capabilityPath = path.join(
        root,
        'smart-order',
        'private',
        'gateway-capability.bin',
    );
    const capability = await readPrivateSecret(capabilityPath);
    try {
        const pending = await readPendingPrivateLifecycleStopCompletion(
            completionPath,
            { capability, barrierPath },
        );
        return Object.freeze({
            schemaVersion:
                'smart-order-runtime-stop-pending/2026-08-12.1',
            operation: pending.completion.operation,
            stopRevision: pending.completion.stopRevision,
            completionBinding: pending.expected,
            repositoryClosed: pending.completion.repositoryClosed,
            controlPlaneUnpublished:
                pending.completion.controlPlaneUnpublished,
            runtimeLeaseReleased: pending.completion.runtimeLeaseReleased,
            dispatchAllowed: false,
            writeMaster: 'disabled',
            brokerWriteAttempted: false,
            secretValuesExposed: false,
        });
    } finally {
        capability.fill(0);
    }
}

async function runAsCli() {
    const [command, operation, revisionValue, challengeId] =
        process.argv.slice(2);
    const common = {
        appSupportRoot: process.env.REALTIME_STOCK_APP_SUPPORT,
        expectedApiGeneration:
            process.env.REALTIME_STOCK_EXPECTED_API_GENERATION,
    };
    const result =
        command === 'gate-recompute-external'
            ? await recomputeSmartOrderGateManifestsFromExternalObservation(
                  common,
              )
            : command === 'status'
            ? await readSmartOrderRuntimeDiagnostics(common)
            : command === 'quiesce'
              ? await quiesceSmartOrderRuntime({ ...common, operation })
                : [
                    'strategy-cancel',
                    'cancel-broker-order',
                    'drain-prepared',
                    'relinquish-protection-prepare',
                    'relinquish-protection-commit',
                ].includes(command)
                ? await runSmartOrderDrainAction({
                      ...common,
                      action: command,
                      strategyId: operation,
                      expectedRevision: Number(revisionValue),
                      ...(challengeId === undefined ? {} : { challengeId }),
                  })
              : command === 'stop'
                ? await stopSmartOrderRuntime({ ...common, operation })
              : command === 'finalize-stop'
                ? await finalizeSmartOrderRuntimeStop({
                      appSupportRoot: common.appSupportRoot,
                      completionBinding: JSON.parse(
                          process.env.REALTIME_STOCK_LIFECYCLE_STOP_BINDING ??
                          'null',
                      ),
                  })
                : command === 'pending-stop'
                  ? await readPendingSmartOrderRuntimeStop({
                        appSupportRoot: common.appSupportRoot,
                    })
              : (() => {
                    throw new TypeError(
                        'runtime diagnostics command must be status, gate-recompute-external, a typed drain action, quiesce, stop, pending-stop, or finalize-stop',
                    );
                })();
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
    runAsCli().catch((error) => {
        const name =
            typeof error?.name === 'string' && error.name.length <= 80
                ? error.name
                : 'Error';
        process.stderr.write(`smart_order_diagnostics=unavailable:${name}\n`);
        process.exitCode = 1;
    });
}
