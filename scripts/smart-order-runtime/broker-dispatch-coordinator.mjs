import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';
import {
    isIssuedSmartOrderModeWriteAdmission,
    isIssuedSmartOrderModeWriteLease,
} from './mode-write-admission.mjs';
import { isIssuedSmartOrderResourceCoordinator } from './resource-coordinator.mjs';

export const SMART_ORDER_BROKER_DISPATCH_COORDINATOR_SCHEMA_VERSION =
    'smart-order-broker-dispatch-coordinator/2026-08-12.2';

const issuedAuthorities = new WeakSet();
const deliveredAuthorities = new WeakSet();
const registeredAdapters = new WeakSet();
const consumedAdapterAuthorities = new WeakSet();
const writeAdjacentRevalidationByAuthority = new WeakMap();
const writeAdjacentRevalidationStarted = new WeakSet();
const writeAdjacentRevalidationCompleted = new WeakSet();
const modeAdmissionByAdapter = new WeakMap();
const acquireResourceTransportOperationByAuthority = new WeakMap();
const revalidateRuntimeTransportBoundaryByAuthority = new WeakMap();

function resourceOperationKind(operationClass) {
    switch (operationClass) {
        case 'explicit_manual_cancel':
            return 'user_confirmed_cancel';
        case 'protective_entry_cancel':
        case 'protective_reduce_only':
            return 'reduce_only_protection';
        case 'new_exposure':
            return 'new_exposure';
        default:
            throw new Error(
                'broker operation has no verified resource classification',
            );
    }
}

function token(value, label) {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 240 ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        throw new TypeError(`${label} must be a bounded token`);
    }
    return value;
}

function epoch(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} must be a non-negative epoch millisecond`);
    }
    return value;
}

function digest(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function dispatchVerificationInput(input, grant, nowEpochMs) {
    return Object.freeze({
        intentId: token(input.intentId, 'intentId'),
        runtimeEpochId: token(input.runtimeEpochId, 'runtimeEpochId'),
        revision: grant.revision,
        activationRevision: grant.activationRevision,
        reservationRevision: grant.reservationRevision,
        rearmAuthorizationId: grant.rearmAuthorizationId,
        rearmRevision: grant.rearmRevision,
        dispatchAttemptNonce: token(
            input.dispatchAttemptNonce,
            'dispatchAttemptNonce',
        ),
        senderFence: token(input.senderFence, 'senderFence'),
        apiGeneration: token(input.apiGeneration, 'apiGeneration'),
        modeRevision: token(input.modeRevision, 'modeRevision'),
        riskRevision: token(input.riskRevision, 'riskRevision'),
        accountRevision: token(input.accountRevision, 'accountRevision'),
        targetRevision: token(grant.targetRevision, 'targetRevision'),
        killSwitchArbiterRevision: grant.killSwitchArbiterRevision,
        killSwitchOperationClass: token(
            grant.killSwitchOperationClass,
            'killSwitchOperationClass',
        ),
        killSwitchDecisionHash: token(
            grant.killSwitchDecisionHash,
            'killSwitchDecisionHash',
        ),
        nowEpochMs: epoch(nowEpochMs, 'verification.nowEpochMs'),
    });
}

function dispatchAuthority(
    envelope,
    revalidateImmediatelyBeforeWrite,
    acquireResourceTransportOperation,
    revalidateRuntimeTransportBoundary,
) {
    if (
        typeof revalidateImmediatelyBeforeWrite !== 'function' ||
        typeof acquireResourceTransportOperation !== 'function' ||
        typeof revalidateRuntimeTransportBoundary !== 'function'
    ) {
        throw new TypeError(
            'dispatch authority callbacks are required',
        );
    }
    const immutableEnvelope = deepFreeze(structuredClone(envelope));
    const authority = Object.freeze({
        schemaVersion: SMART_ORDER_BROKER_DISPATCH_COORDINATOR_SCHEMA_VERSION,
        authorityId: digest(
            canonicalJson({
                intentId: immutableEnvelope.intentId,
                runtimeEpochId: immutableEnvelope.runtimeEpochId,
                dispatchAttemptNonce: immutableEnvelope.dispatchAttemptNonce,
                intentRevision: immutableEnvelope.intentRevision,
                payloadHash: immutableEnvelope.payloadHash,
                killSwitchArbiterRevision:
                    immutableEnvelope.killSwitchArbiterRevision,
                killSwitchDecisionHash:
                    immutableEnvelope.killSwitchDecisionHash,
            }),
        ),
        envelope: immutableEnvelope,
    });
    issuedAuthorities.add(authority);
    writeAdjacentRevalidationByAuthority.set(
        authority,
        revalidateImmediatelyBeforeWrite,
    );
    acquireResourceTransportOperationByAuthority.set(
        authority,
        acquireResourceTransportOperation,
    );
    revalidateRuntimeTransportBoundaryByAuthority.set(
        authority,
        revalidateRuntimeTransportBoundary,
    );
    return authority;
}

export async function acquireSmartOrderBrokerDispatchTransportOperation(
    authority,
) {
    if (
        !isIssuedSmartOrderBrokerDispatchAuthority(authority) ||
        !consumedAdapterAuthorities.has(authority)
    ) {
        throw new Error(
            'broker transport resource admission requires a consumed coordinator-issued authority',
        );
    }
    const acquire = acquireResourceTransportOperationByAuthority.get(authority);
    if (typeof acquire !== 'function') {
        throw new Error('broker transport resource admission is unavailable');
    }
    const operation = await acquire();
    const revalidate =
        revalidateRuntimeTransportBoundaryByAuthority.get(authority);
    if (typeof revalidate !== 'function') {
        throw new Error('broker transport Runtime revalidation is unavailable');
    }
    await revalidate(authority.envelope);
    return operation;
}

export async function revalidateSmartOrderBrokerDispatchAuthorityImmediatelyBeforeWrite(
    authority,
) {
    if (
        !isIssuedSmartOrderBrokerDispatchAuthority(authority) ||
        !consumedAdapterAuthorities.has(authority)
    ) {
        throw new Error(
            'write-adjacent revalidation requires a consumed coordinator-issued dispatch authority',
        );
    }
    if (writeAdjacentRevalidationStarted.has(authority)) {
        throw new Error(
            'write-adjacent dispatch authority revalidation was already consumed',
        );
    }
    const revalidate = writeAdjacentRevalidationByAuthority.get(authority);
    if (typeof revalidate !== 'function') {
        throw new Error(
            'write-adjacent dispatch authority revalidation is unavailable',
        );
    }
    writeAdjacentRevalidationStarted.add(authority);
    await revalidate();
    writeAdjacentRevalidationCompleted.add(authority);
    return Object.freeze({
        revalidatedImmediatelyBeforeWrite: true,
        brokerAuthority: false,
    });
}

function markUnknownInput(envelope, nowEpochMs, terminalOutcome) {
    return Object.freeze({
        intentId: envelope.intentId,
        state: 'unknown',
        terminalOutcome,
        expectedRevision: envelope.intentRevision,
        dispatchAttemptNonce: envelope.dispatchAttemptNonce,
        senderFence: envelope.senderFence,
        apiGeneration: envelope.apiGeneration,
        nowEpochMs: epoch(nowEpochMs, 'unknown.nowEpochMs'),
    });
}

async function persistUnknownOrFailStop(repository, envelope, input) {
    try {
        return await repository.request(
            'markIntentOutcome',
            markUnknownInput(envelope, input.nowEpochMs, input.terminalOutcome),
        );
    } catch (error) {
        const failStop = new Error(
            'broker dispatch outcome could not be made durable; sender must fail-stop',
            { cause: error },
        );
        failStop.name = 'BrokerDispatchFailStopError';
        throw failStop;
    }
}

export function createDisabledSmartOrderBrokerAdapter() {
    const adapter = Object.freeze({
        schemaVersion: 'smart-order-broker-adapter/disabled-v1',
        enabled: false,
        async preflight() {
            throw new Error('smart-order broker adapter is disabled');
        },
        async execute() {
            throw new Error('smart-order broker adapter is disabled');
        },
    });
    registeredAdapters.add(adapter);
    return adapter;
}

export function createGateClosedSmartOrderBrokerAdapter({
    schemaVersion,
    reason = 'Gate 0 broker contract capability is unavailable',
}) {
    const version = token(schemaVersion, 'gate-closed adapter schemaVersion');
    const denial = token(reason, 'gate-closed adapter reason');
    const adapter = Object.freeze({
        schemaVersion: version,
        enabled: false,
        gateClosed: true,
        async preflight() {
            throw new Error(`broker adapter is disabled: ${denial}`);
        },
        async execute() {
            throw new Error(`broker adapter is disabled: ${denial}`);
        },
    });
    registeredAdapters.add(adapter);
    return adapter;
}

export function createFencedSmartOrderBrokerAdapter({ execute, modeAdmission }) {
    if (typeof execute !== 'function') {
        throw new TypeError('fenced broker adapter execute callback is required');
    }
    if (!isIssuedSmartOrderModeWriteAdmission(modeAdmission)) {
        throw new TypeError(
            'fenced broker adapter requires a module-issued mode write admission',
        );
    }
    const adapter = Object.freeze({
        schemaVersion: 'smart-order-broker-adapter/fenced-v1',
        enabled: true,
        async preflight(context) {
            if (
                !context ||
                typeof context !== 'object' ||
                context.brokerWriteAllowed !== false
            ) {
                throw new Error('broker adapter preflight contract was violated');
            }
            return Object.freeze({ readyForFencedAuthority: true });
        },
        async execute(authority) {
            if (!isIssuedSmartOrderBrokerDispatchAuthority(authority)) {
                throw new Error(
                    'broker adapter requires a coordinator-issued dispatch authority',
                );
            }
            if (consumedAdapterAuthorities.has(authority)) {
                throw new Error(
                    'broker dispatch authority was already consumed by the adapter',
                );
            }
            consumedAdapterAuthorities.add(authority);
            return execute(authority);
        },
    });
    registeredAdapters.add(adapter);
    modeAdmissionByAdapter.set(adapter, modeAdmission);
    return adapter;
}

export function createSmartOrderBrokerDispatchCoordinator({
    repository,
    adapter = createDisabledSmartOrderBrokerAdapter(),
    resourceCoordinator,
    revalidateRuntimeAuthorityImmediatelyBeforeTransport,
    now = () => Date.now(),
}) {
    if (!repository || typeof repository.request !== 'function') {
        throw new TypeError('dispatch coordinator repository is required');
    }
    if (!adapter || !registeredAdapters.has(adapter)) {
        throw new TypeError(
            'dispatch coordinator requires a registered fenced broker adapter',
        );
    }
    if (!isIssuedSmartOrderResourceCoordinator(resourceCoordinator)) {
        throw new TypeError(
            'dispatch coordinator requires a module-issued resource coordinator',
        );
    }
    if (
        typeof revalidateRuntimeAuthorityImmediatelyBeforeTransport !==
        'function'
    ) {
        throw new TypeError(
            'dispatch coordinator requires Runtime transport revalidation',
        );
    }
    let failedStop = false;
    const acquireResourceGrant = (operationId, kind) => {
        return resourceCoordinator.acquireOperation({
            operationId,
            kind,
        });
    };
    const releaseResourceGrant = (grant, method) => {
        const result = resourceCoordinator[method]({
            operationId: grant.operationId,
        });
        if (result.allowed !== true) {
            failedStop = true;
            throw new Error(
                `resource coordinator settlement failed: ${result.reason}`,
            );
        }
        return result;
    };
    return Object.freeze({
        schemaVersion: SMART_ORDER_BROKER_DISPATCH_COORDINATOR_SCHEMA_VERSION,
        get failedStop() {
            return failedStop;
        },
        async dispatch(input) {
            if (failedStop) {
                throw new Error('broker dispatch coordinator is fail-stopped');
            }
            // This preflight may validate local readiness only. The adapter
            // contract forbids it from writing any broker byte.
            await adapter.preflight(
                Object.freeze({
                    intentId: token(input.intentId, 'intentId'),
                    runtimeEpochId: token(
                        input.runtimeEpochId,
                        'runtimeEpochId',
                    ),
                    brokerWriteAllowed: false,
                }),
            );

            const modeAdmission = modeAdmissionByAdapter.get(adapter);
            if (!modeAdmission) {
                throw new Error('smart-order broker adapter is disabled');
            }
            const modeLease = await modeAdmission.acquire();
            if (!isIssuedSmartOrderModeWriteLease(modeLease)) {
                await modeLease?.close?.().catch(() => {});
                throw new Error('mode write admission returned an invalid lease');
            }
            const effectiveInput = Object.freeze({
                ...input,
                modeRevision: modeLease.modeExecutionLeaseEvidenceHash,
            });

            let grant;
            try {
                grant = await repository.request(
                    'markIntentDispatching',
                    effectiveInput,
                );
            } catch (error) {
                await modeLease.close();
                throw error;
            }
            const resourceOperationId = digest(
                canonicalJson({
                    intentId: effectiveInput.intentId,
                    dispatchAttemptNonce:
                        effectiveInput.dispatchAttemptNonce,
                    intentRevision: grant.revision,
                    modeExecutionLeaseEvidenceHash:
                        effectiveInput.modeRevision,
                }),
            );
            let resourceGrant;
            try {
                resourceGrant = await acquireResourceGrant(
                    resourceOperationId,
                    resourceOperationKind(grant.killSwitchOperationClass),
                );
            } catch (error) {
                resourceCoordinator.abandonOperation({
                    operationId: resourceOperationId,
                });
                try {
                    const outcome = await repository.request(
                        'markIntentOutcome',
                        {
                            intentId: token(input.intentId, 'intentId'),
                            state: 'reconciling',
                            terminalOutcome:
                                'resource_admission_denied_before_adapter',
                            expectedRevision: grant.revision,
                            dispatchAttemptNonce: token(
                                input.dispatchAttemptNonce,
                                'dispatchAttemptNonce',
                            ),
                            senderFence: token(
                                input.senderFence,
                                'senderFence',
                            ),
                            apiGeneration: token(
                                input.apiGeneration,
                                'apiGeneration',
                            ),
                            nowEpochMs: epoch(
                                now(),
                                'resourceAdmission.nowEpochMs',
                            ),
                        },
                    );
                    await modeLease.close();
                    return Object.freeze({
                        state: 'reconciling',
                        outcome,
                        adapterInvoked: false,
                        resourceAdmissionErrorName:
                            typeof error?.name === 'string'
                                ? error.name
                                : 'Error',
                        automaticRetryAllowed: false,
                    });
                } catch (persistError) {
                    failedStop = true;
                    throw new Error(
                        'resource admission denial could not be made durable; sender must fail-stop',
                        { cause: persistError },
                    );
                }
            }
            const verification = dispatchVerificationInput(
                effectiveInput,
                grant,
                now(),
            );
            let verified;
            try {
                verified = await repository.request(
                    'verifyDispatchGrant',
                    verification,
                );
            } catch (error) {
                releaseResourceGrant(resourceGrant, 'abandonOperation');
                failedStop = true;
                throw new Error(
                    'durable dispatch grant verification failed after dispatching commit',
                    { cause: error },
                );
            }
            if (!verified?.authorized || !verified.envelope) {
                if (verified?.reasonCode === 'broker_target_changed') {
                    try {
                        const outcome = await repository.request(
                            'markIntentOutcome',
                            {
                                intentId: token(input.intentId, 'intentId'),
                                state: 'reconciling',
                                terminalOutcome:
                                    'broker_target_changed_before_adapter',
                                expectedRevision: grant.revision,
                                dispatchAttemptNonce: token(
                                    input.dispatchAttemptNonce,
                                    'dispatchAttemptNonce',
                                ),
                                senderFence: token(
                                    input.senderFence,
                                    'senderFence',
                                ),
                                apiGeneration: token(
                                    input.apiGeneration,
                                    'apiGeneration',
                                ),
                                nowEpochMs: epoch(
                                    now(),
                                    'targetDrift.nowEpochMs',
                                ),
                            },
                        );
                        releaseResourceGrant(
                            resourceGrant,
                            'abandonOperation',
                        );
                        await modeLease.close();
                        return Object.freeze({
                            state: 'reconciling',
                            outcome,
                            adapterInvoked: false,
                            automaticRetryAllowed: false,
                        });
                    } catch (error) {
                        failedStop = true;
                        throw new Error(
                            'broker target drift could not be made durable; sender must fail-stop',
                            { cause: error },
                        );
                    }
                }
                releaseResourceGrant(resourceGrant, 'abandonOperation');
                failedStop = true;
                throw new Error(
                    'durable dispatch grant was denied after dispatching commit',
                );
            }

            try {
                await modeLease.revalidate({
                    operationId: resourceGrant.operationId,
                });
            } catch (error) {
                try {
                    releaseResourceGrant(resourceGrant, 'abandonOperation');
                    const outcome = await persistUnknownOrFailStop(
                        repository,
                        verified.envelope,
                        {
                            nowEpochMs: now(),
                            terminalOutcome:
                                'simulation_attestation_invalid_after_dispatch_fence',
                        },
                    );
                    await modeLease.close();
                    return Object.freeze({
                        state: 'unknown',
                        outcome,
                        admissionErrorName:
                            typeof error?.name === 'string'
                                ? error.name
                                : 'Error',
                        automaticRetryAllowed: false,
                    });
                } catch (persistError) {
                    failedStop = true;
                    throw persistError;
                }
            }

            const authority = dispatchAuthority(
                verified.envelope,
                async () => {
                    const adjacentVerificationInput =
                        dispatchVerificationInput(
                            effectiveInput,
                            grant,
                            now(),
                        );
                    const adjacentVerification = await repository.request(
                        'verifyDispatchGrant',
                        adjacentVerificationInput,
                    );
                    if (
                        adjacentVerification?.authorized !== true ||
                        !adjacentVerification.envelope ||
                        canonicalJson(adjacentVerification.envelope) !==
                            canonicalJson(verified.envelope)
                    ) {
                        throw new Error(
                            'durable dispatch grant changed immediately before broker write',
                        );
                    }
                    await modeLease.revalidate({
                        operationId: resourceGrant.operationId,
                    });
                    await revalidateRuntimeAuthorityImmediatelyBeforeTransport(
                        verified.envelope,
                    );
                },
                async () => {
                    return resourceCoordinator.acquireOperationUnit({
                        operationId: resourceGrant.operationId,
                    });
                },
                revalidateRuntimeAuthorityImmediatelyBeforeTransport,
            );
            // The adapter receives this object exactly once. The authority is
            // opaque and cannot be reconstructed by cloning its fields.
            deliveredAuthorities.add(authority);
            let adapterResult;
            try {
                const dispatchingResource =
                    resourceCoordinator.markOperationDispatching({
                        operationId: resourceGrant.operationId,
                    });
                if (dispatchingResource.allowed !== true) {
                    failedStop = true;
                    throw new Error(
                        `resource coordinator did not authorize dispatch phase: ${dispatchingResource.reason}`,
                    );
                }
                adapterResult = await adapter.execute(authority);
            } catch (error) {
                try {
                    const outcome = await persistUnknownOrFailStop(
                        repository,
                        authority.envelope,
                        {
                            nowEpochMs: now(),
                            terminalOutcome: 'broker_result_unresolved',
                        },
                    );
                    const resourceFailure =
                        resourceCoordinator.handleOperationFailure({
                            failure: 'connection_error',
                            operationId: resourceGrant.operationId,
                        });
                    if (
                        resourceFailure.allowed !== true ||
                        resourceFailure.retry !== false
                    ) {
                        failedStop = true;
                        throw new Error(
                            'resource coordinator did not latch broker bytes as no-retry',
                        );
                    }
                    await modeLease.close();
                    return Object.freeze({
                        state: 'unknown',
                        outcome,
                        adapterErrorName:
                            typeof error?.name === 'string'
                                ? error.name
                                : 'Error',
                        automaticRetryAllowed: false,
                    });
                } catch (persistError) {
                    failedStop = true;
                    throw persistError;
                }
            }

            if (!writeAdjacentRevalidationCompleted.has(authority)) {
                try {
                    const outcome = await persistUnknownOrFailStop(
                        repository,
                        authority.envelope,
                        {
                            nowEpochMs: now(),
                            terminalOutcome:
                                'broker_write_adjacent_revalidation_missing',
                        },
                    );
                    releaseResourceGrant(resourceGrant, 'completeOperation');
                    await modeLease.close();
                    return Object.freeze({
                        state: 'unknown',
                        outcome,
                        terminalOutcome:
                            'broker_write_adjacent_revalidation_missing',
                        automaticRetryAllowed: false,
                    });
                } catch (persistError) {
                    failedStop = true;
                    throw persistError;
                }
            }

            if (
                !adapterResult ||
                typeof adapterResult !== 'object' ||
                !['acknowledged', 'terminal', 'unknown', 'reconciling'].includes(
                    adapterResult.state,
                )
            ) {
                try {
                    const outcome = await persistUnknownOrFailStop(
                        repository,
                        authority.envelope,
                        {
                            nowEpochMs: now(),
                            terminalOutcome: 'broker_adapter_result_invalid',
                        },
                    );
                    releaseResourceGrant(resourceGrant, 'completeOperation');
                    await modeLease.close();
                    return Object.freeze({
                        state: 'unknown',
                        outcome,
                        automaticRetryAllowed: false,
                    });
                } catch (persistError) {
                    failedStop = true;
                    throw persistError;
                }
            }

            try {
                const outcome = await repository.request('markIntentOutcome', {
                    intentId: authority.envelope.intentId,
                    state: adapterResult.state,
                    terminalOutcome: adapterResult.terminalOutcome,
                    expectedRevision: authority.envelope.intentRevision,
                    dispatchAttemptNonce:
                        authority.envelope.dispatchAttemptNonce,
                    senderFence: authority.envelope.senderFence,
                    apiGeneration: authority.envelope.apiGeneration,
                    nowEpochMs: epoch(now(), 'outcome.nowEpochMs'),
                });
                releaseResourceGrant(resourceGrant, 'completeOperation');
                await modeLease.close();
                return Object.freeze({
                    state: outcome.state,
                    outcome,
                    automaticRetryAllowed: false,
                });
            } catch (error) {
                failedStop = true;
                throw new Error(
                    'broker result was not durably committed; sender must fail-stop',
                    { cause: error },
                );
            }
        },
    });
}

export function isIssuedSmartOrderBrokerDispatchAuthority(value) {
    return Boolean(
        value &&
            typeof value === 'object' &&
            issuedAuthorities.has(value) &&
            deliveredAuthorities.has(value),
    );
}
