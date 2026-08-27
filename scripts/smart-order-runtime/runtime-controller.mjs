import { createHash, randomUUID } from 'node:crypto';
import { rmdir } from 'node:fs/promises';
import { types as utilTypes } from 'node:util';
import { acquireExclusiveRuntimeLease } from './exclusive-runtime-lease.mjs';
import { createSmartOrderBrokerDispatchCoordinator } from './broker-dispatch-coordinator.mjs';
import {
    createSmartOrderResourceCoordinator,
    isIssuedSmartOrderResourceCoordinator,
} from './resource-coordinator.mjs';
import { createProductionNodeSafeSmartOrderBrokerAdapter } from './node-safe-broker-adapter.mjs';
import { createSmartOrderModeWriteAdmission } from './mode-write-admission.mjs';
import {
    prepareSmartOrderPrivateStorage,
    redactPrivateRuntimeStatus,
} from './private-storage.mjs';
import { openSmartOrderRepository } from './repository-client.mjs';
import {
    canonicalProtectedEntryIntentPayload,
    snapshotProtectedEntryAdmissionInput,
} from './protected-entry-contract.mjs';
import {
    SMART_ORDER_RUNTIME_GAP_INVALIDATION_SCHEMA_VERSION,
    SMART_ORDER_RUNTIME_GAP_REASON_CODES,
} from './runtime-gap-detector.mjs';
import { isNormalizedCanonicalSmartOrderBrokerEvent } from './broker-event-normalizer.mjs';
import { currentSmartOrderAccountReconciliationProjection } from './account-reconciliation-coordinator.mjs';
import { createSmartOrderAuthenticatedIdentityGroup } from './authenticated-identity-group.mjs';
import { canonicalRuntimeRiskPolicyEditorInput } from './runtime-risk-policy.mjs';
import {
    runManagedSmartOrderReadonlyGateRunner,
} from '../smart-order-readonly-gate-runner.mjs';
import {
    canonicalSmartOrderGateProbeSafetyEnvelope,
    smartOrderGateProbeEnvelopeIsCurrent,
} from './gate-probe-safety-envelope.mjs';
import { isVerifiedSmartOrderCanonicalContractEvidence } from './canonical-contract-evidence-authority.mjs';
import { canonicalSmartOrderProtectiveBrokerIntentPayload } from './broker-execution-policy.mjs';
import {
    SMART_ORDER_QUOTE_FRESHNESS_TTL_MS,
    isTrustedSmartOrderQuickConditionObservation,
    isTrustedSmartOrderProtectiveQuoteObservation,
} from './quote-subscription-coordinator.mjs';
import {
    admitSmartOrderOfficialMarketQuoteObservation,
    createSmartOrderOfficialMarketCalendarAuthority,
    isIssuedSmartOrderOfficialMarketCalendarAuthority,
} from './official-market-calendar-authority.mjs';
import { resolveExpectedManagedApiRepositoryRoot } from './installed-managed-api-binding.mjs';

export const SMART_ORDER_RUNTIME_CONTROLLER_SCHEMA_VERSION =
    'smart-order-runtime-controller/2026-08-13.9';

const ISSUED_PRIMARY_CONTROLLERS = new WeakSet();

const RUNTIME_CONTINUITY_GAP_REASON_CODE_SET = new Set(
    SMART_ORDER_RUNTIME_GAP_REASON_CODES.filter(
        (reasonCode) => reasonCode !== 'API_GENERATION_GAP',
    ),
);
const KILL_SWITCH_NAMES = Object.freeze([
    'pause_new_exposure',
    'pause_automation',
    'emergency_block_all_writes',
]);
export const SMART_ORDER_MANAGED_API_REPOSITORY_ROOT =
    resolveExpectedManagedApiRepositoryRoot();

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

function runtimeGapEpochSha256(runtimeEpochId) {
    return digest(`smart-order-runtime-gap-epoch\u001f${runtimeEpochId}`);
}

export function isIssuedPrimarySmartOrderRuntimeController(value) {
    return Boolean(
        value &&
            typeof value === 'object' &&
            ISSUED_PRIMARY_CONTROLLERS.has(value),
    );
}

function sha256Digest(value, label) {
    if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
        throw new TypeError(`${label} must be a SHA-256 digest`);
    }
    return value;
}

function continuityGapReasonCodes(value) {
    if (
        !Array.isArray(value) ||
        value.length === 0 ||
        value.length > RUNTIME_CONTINUITY_GAP_REASON_CODE_SET.size
    ) {
        throw new TypeError(
            'runtime continuity reasonCodes must be a non-empty bounded array',
        );
    }
    const reasonCodes = value.map((reasonCode, index) =>
        token(reasonCode, `reasonCodes[${index}]`),
    );
    if (
        reasonCodes.some(
            (reasonCode) => !RUNTIME_CONTINUITY_GAP_REASON_CODE_SET.has(reasonCode),
        ) ||
        new Set(reasonCodes).size !== reasonCodes.length ||
        JSON.stringify(reasonCodes) !== JSON.stringify([...reasonCodes].sort())
    ) {
        throw new TypeError(
            'runtime continuity reasonCodes must contain sorted unique allowlisted codes',
        );
    }
    return Object.freeze(reasonCodes);
}

function exactInputKeys(value, keys) {
    return Boolean(
        value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            JSON.stringify(Object.keys(value).sort()) ===
                JSON.stringify([...keys].sort()),
    );
}

function snapshotExactOwnData(value, keys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    const expected = [...keys].sort();
    if (
        actual.some((key) => typeof key !== 'string') ||
        actual.length !== expected.length ||
        !actual.sort().every((key, index) => key === expected[index])
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    const snapshot = {};
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (
            !descriptor?.enumerable ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set')
        ) {
            throw new TypeError(`${label} must use own data properties`);
        }
        snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
}

function snapshotRuntimeFixedAtr(value, label) {
    if (value === null) return null;
    const snapshot = snapshotExactOwnData(
        value,
        [
            'algorithmVersion',
            'asOfTradingDate',
            'contractKey',
            'contractRevision',
            'corporateActionRevision',
            'period',
            'schemaVersion',
            'snapshotSha256',
            'source',
            'strategyDefinitionHash',
            'timeframe',
            'value',
        ],
        label,
    );
    const source = snapshotExactOwnData(
        snapshot.source,
        [
            'canonicalCandlesSha256',
            'completedCandleCount',
            'completeness',
            'coverageEndTradingDate',
            'coverageStartTradingDate',
            'requestedEndDate',
            'requestedStartDate',
            'sourceId',
        ],
        `${label}.source`,
    );
    return Object.freeze({
        ...snapshot,
        source: Object.freeze({ ...source }),
    });
}

function snapshotCanonicalContractEvidence(value, label) {
    if (value === null) return null;
    const evidence = snapshotExactOwnData(
        value,
        [
            'accountScopeSha256',
            'apiGeneration',
            'contract',
            'contractRevision',
            'corporateActionRevision',
            'evidenceSha256',
            'fixedAtrSnapshot',
            'gateManifestHash',
            'gateManifestRevision',
            'mappingRevision',
            'observedAtEpochMs',
            'runtimeEpochId',
            'schemaVersion',
            'validUntilEpochMs',
        ],
        label,
    );
    const contract = snapshotExactOwnData(
        evidence.contract,
        [
            'categoryCode',
            'code',
            'contractUnit',
            'draftContractKey',
            'exchange',
            'limitDownMinorUnits',
            'limitUpMinorUnits',
            'referenceMinorUnits',
            'runtimeContractKey',
            'securityType',
            'updateDate',
        ],
        `${label}.contract`,
    );
    return Object.freeze({
        ...evidence,
        contract: Object.freeze({ ...contract }),
        fixedAtrSnapshot: snapshotRuntimeFixedAtr(
            evidence.fixedAtrSnapshot,
            `${label}.fixedAtrSnapshot`,
        ),
    });
}

function snapshotCanonicalContractEvidenceList(value, label) {
    if (
        !Array.isArray(value) ||
        utilTypes.isProxy(value) ||
        value.length < 1 ||
        value.length > 7
    ) {
        throw new TypeError(`${label} must be an exact array of one to seven items`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expectedKeys = Array.from({ length: value.length }, (_, index) =>
        String(index),
    );
    if (
        Object.keys(descriptors).some(
            (key) => key !== 'length' && !expectedKeys.includes(key),
        ) ||
        expectedKeys.some(
            (key) =>
                !descriptors[key]?.enumerable ||
                !Object.hasOwn(descriptors[key], 'value') ||
                !isVerifiedSmartOrderCanonicalContractEvidence(
                    descriptors[key].value,
                ),
        )
    ) {
        throw new TypeError(`${label} contains non-issued or accessor evidence`);
    }
    return Object.freeze(
        expectedKeys.map((key, index) =>
            snapshotCanonicalContractEvidence(
                descriptors[key].value,
                `${label}[${index}]`,
            ),
        ),
    );
}

function generationInvalidatedError(operation) {
    const error = new Error(
        `${operation} is blocked because the runtime API generation was invalidated`,
    );
    error.name = 'RuntimeGenerationInvalidatedError';
    return error;
}

function continuityInvalidatedError(operation) {
    const error = new Error(
        `${operation} is blocked because runtime continuity was invalidated`,
    );
    error.name = 'RuntimeContinuityInvalidatedError';
    return error;
}

function lifecycleMutationFencedError(operation) {
    const error = new Error(
        `${operation} is blocked because a Runtime lifecycle drain has begun`,
    );
    error.name = 'RuntimeLifecycleMutationFencedError';
    return error;
}

async function removeEmptyLeaseDirectory(directoryPath) {
    try {
        await rmdir(directoryPath);
    } catch (error) {
        if (!['ENOENT', 'ENOTEMPTY'].includes(error?.code)) throw error;
    }
}

export async function startSmartOrderRuntimeController({
    appSupportRoot,
    apiGeneration,
    gateProbeControlPlaneAuthority = null,
    strategyConfirmationControlPlaneAuthority = null,
    nowEpochMs,
    runtimeEpochId = randomUUID(),
    senderFence = randomUUID(),
    repositoryOptions = {},
    authenticatedIdentityEvidence,
    resourceCoordinator = null,
    officialMarketCalendarAuthority =
        createSmartOrderOfficialMarketCalendarAuthority(),
    runtimeNow = () => Date.now(),
}) {
    if (
        gateProbeControlPlaneAuthority !== null &&
        (typeof gateProbeControlPlaneAuthority !== 'object' ||
            Array.isArray(gateProbeControlPlaneAuthority) ||
            utilTypes.isProxy(gateProbeControlPlaneAuthority) ||
            !Object.isFrozen(gateProbeControlPlaneAuthority) ||
            Reflect.ownKeys(gateProbeControlPlaneAuthority).length !== 0)
    ) {
        throw new TypeError(
            'gate probe control-plane authority must be an opaque frozen object',
        );
    }
    if (
        strategyConfirmationControlPlaneAuthority !== null &&
        (typeof strategyConfirmationControlPlaneAuthority !== 'object' ||
            Array.isArray(strategyConfirmationControlPlaneAuthority) ||
            utilTypes.isProxy(strategyConfirmationControlPlaneAuthority) ||
            !Object.isFrozen(strategyConfirmationControlPlaneAuthority) ||
            Reflect.ownKeys(strategyConfirmationControlPlaneAuthority).length !== 0)
    ) {
        throw new TypeError(
            'strategy confirmation control-plane authority must be an opaque frozen object',
        );
    }
    if (
        !isIssuedSmartOrderOfficialMarketCalendarAuthority(
            officialMarketCalendarAuthority,
        )
    ) {
        throw new TypeError(
            'runtime controller official market calendar authority is invalid',
        );
    }
    if (typeof runtimeNow !== 'function' || utilTypes.isProxy(runtimeNow)) {
        throw new TypeError('runtime controller clock is invalid');
    }
    const generation = token(apiGeneration, 'apiGeneration');
    const startedAtEpochMs = epoch(nowEpochMs, 'nowEpochMs');
    const storage = await prepareSmartOrderPrivateStorage({ appSupportRoot });
    const lease = await acquireExclusiveRuntimeLease({
        socketPath: storage.paths.senderLeaseSocketPath,
    });
    if (!lease.acquired) {
        let closed = false;
        return Object.freeze({
            schemaVersion: SMART_ORDER_RUNTIME_CONTROLLER_SCHEMA_VERSION,
            role: 'secondary_readonly',
            dispatchAllowed: false,
            reason: lease.reason,
            storage: redactPrivateRuntimeStatus(storage),
            status() {
                return Object.freeze({
                    role: 'secondary_readonly',
                    state: closed ? 'closed' : 'observe_only',
                    dispatchAllowed: false,
                    repositoryOpened: false,
                    tradingSenderAuthority: 'none',
                    legacyTradingTriggerAuthority: 'permanently_retired',
                });
            },
            async close() {
                closed = true;
                officialMarketCalendarAuthority.close();
            },
        });
    }

    let repository;
    let authenticatedIdentityGroup;
    let runtimeResourceCoordinator;
    let ownsRuntimeResourceCoordinator = false;
    try {
        authenticatedIdentityGroup =
            await createSmartOrderAuthenticatedIdentityGroup({
                identityKeyPath: storage.paths.identityKeyPath,
                authenticatedPrincipalEvidence: authenticatedIdentityEvidence,
            });
        repository = await openSmartOrderRepository({
            appSupportRoot,
            databasePath: storage.paths.databasePath,
            backupDirectory: storage.paths.backupDirectory,
            identityKeyPath: storage.paths.identityKeyPath,
            ...repositoryOptions,
        });
        const started = await repository.request('startRuntimeEpoch', {
            runtimeEpochId: token(runtimeEpochId, 'runtimeEpochId'),
            apiGeneration: generation,
            senderFence: token(senderFence, 'senderFence'),
            leaseEvidenceHash: digest(
                `${SMART_ORDER_RUNTIME_CONTROLLER_SCHEMA_VERSION}\u001f${lease.leaseId}`,
            ),
            nowEpochMs: startedAtEpochMs,
        });
        if (
            resourceCoordinator !== null &&
            !isIssuedSmartOrderResourceCoordinator(resourceCoordinator)
        ) {
            throw new TypeError(
                'runtime controller resource coordinator is invalid',
            );
        }
        runtimeResourceCoordinator =
            resourceCoordinator ?? createSmartOrderResourceCoordinator();
        ownsRuntimeResourceCoordinator = resourceCoordinator === null;
        // The production Node-safe adapter is part of the runtime construction,
        // but its predicate-only Gate 0 contract authority currently has no
        // issuer.  It therefore registers a gate-closed adapter and cannot
        // reach a broker byte until task 0.3b installs current live evidence.
        const brokerAdapter = createProductionNodeSafeSmartOrderBrokerAdapter({
            appSupportRoot,
            expectedApiGeneration: generation,
            leaseDirectory: storage.paths.modeExecutionLeaseDirectory,
            resourceCoordinator: runtimeResourceCoordinator,
        });
        const gateProbeModeAdmission =
            gateProbeControlPlaneAuthority === null
                ? null
                : createSmartOrderModeWriteAdmission({
                      appSupportRoot,
                      expectedApiGeneration: generation,
                      leaseDirectory:
                          storage.paths.modeExecutionLeaseDirectory,
                      resourceCoordinator: runtimeResourceCoordinator,
                      expectedRepositoryRoot:
                          SMART_ORDER_MANAGED_API_REPOSITORY_ROOT,
                  });
        const brokerDispatchCoordinator =
            createSmartOrderBrokerDispatchCoordinator({
                repository,
                adapter: brokerAdapter,
                resourceCoordinator: runtimeResourceCoordinator,
                revalidateRuntimeAuthorityImmediatelyBeforeTransport:
                    (envelope) =>
                        officialMarketCalendarAuthority.assertDispatchEnvelope(
                            envelope,
                        ),
            });
        let state = started.state;
        let revision = started.revision;
        let lifecycleOperation;
        let lifecycleMutationFenced = false;
        let closed = false;
        let stopResult;
        let stopCommitResult;
        let stopCommitPromise;
        let stoppedRuntimeReleasePromise;
        let generationInvalidated = false;
        let generationInvalidationResult;
        let generationInvalidationPromise;
        let observedApiGenerationSha256;
        let failoverCloseResult;
        let failoverCloseError;
        let continuityInvalidated = false;
        let continuityInvalidationResult;
        let continuityInvalidationPromise;
        let continuitySignalSha256;
        let continuityReasonCodes;
        const continuityRuntimeEpochIdSha256 =
            runtimeGapEpochSha256(runtimeEpochId);
        let killSwitch;
        const pendingKillSwitchMutations = new Set();
        let killSwitchMutationFailed = false;
        let riskPolicyMutationPromise;
        let riskPolicyMutationFailed = false;
        let brokerObservationPendingSha256;
        let brokerObservationReconciledAccountScopes = new Set();
        let brokerObservationPendingMaterializationIntentIds = new Set();

        function emergencyKillSwitchEnabled() {
            return Boolean(
                killSwitch?.switches?.emergency_block_all_writes?.enabled,
            );
        }

        function officialCalendarStatus() {
            try {
                const status = officialMarketCalendarAuthority.status();
                if (
                    !status ||
                    status.brokerWriteAuthority !== false ||
                    typeof status.activationReady !== 'boolean'
                ) {
                    throw new Error('calendar authority status is invalid');
                }
                return status;
            } catch {
                return Object.freeze({
                    state: 'calendar_authority_status_unavailable',
                    activationReady: false,
                    brokerWriteAuthority: false,
                });
            }
        }

        function calendarActivationReady() {
            return officialCalendarStatus().activationReady === true;
        }

        function requireCalendarActivationReady(operation) {
            if (!calendarActivationReady()) {
                const error = new Error(
                    `${operation} requires a current official calendar and trusted exchange time`,
                );
                error.name = 'OfficialMarketCalendarBlockedError';
                throw error;
            }
        }

        function cacheKillSwitchProjection(result) {
            if (!result || typeof result !== 'object' || Array.isArray(result)) {
                throw new Error('kill switch projection is unavailable');
            }
            const switches = {};
            for (const name of KILL_SWITCH_NAMES) {
                const current = result.switches?.[name];
                if (!current || typeof current.enabled !== 'boolean') {
                    throw new Error('kill switch projection schema is invalid');
                }
                switches[name] = Object.freeze({
                    enabled: current.enabled,
                    revision: epoch(
                        current.revision,
                        `killSwitch.${name}.revision`,
                    ),
                    updatedAtEpochMs: epoch(
                        current.updatedAtEpochMs,
                        `killSwitch.${name}.updatedAtEpochMs`,
                    ),
                    reasonCode: token(
                        current.reasonCode,
                        `killSwitch.${name}.reasonCode`,
                    ),
                });
            }
            const enabled = KILL_SWITCH_NAMES.filter(
                (name) => switches[name].enabled,
            );
            killSwitch = Object.freeze({
                schemaVersion: token(
                    result.schemaVersion,
                    'killSwitch.schemaVersion',
                ),
                arbiterRevision: epoch(
                    result.arbiterRevision,
                    'killSwitch.arbiterRevision',
                ),
                switches: Object.freeze(switches),
                enabled: Object.freeze(enabled),
                denyUnionActive: enabled.length > 0,
            });
            return killSwitch;
        }

        cacheKillSwitchProjection(started.killSwitch);

        async function waitForPendingKillSwitchMutations() {
            if (pendingKillSwitchMutations.size > 0) {
                await Promise.all([...pendingKillSwitchMutations]);
            }
            if (killSwitchMutationFailed) {
                const error = new Error(
                    'broker dispatch is fail-closed after a kill switch mutation failure',
                );
                error.name = 'KillSwitchMutationFailClosedError';
                throw error;
            }
        }

        async function waitForPendingRiskPolicyMutation() {
            if (riskPolicyMutationPromise) await riskPolicyMutationPromise;
            if (riskPolicyMutationFailed) {
                const error = new Error(
                    'broker dispatch is fail-closed after a risk policy mutation failure',
                );
                error.name = 'RiskPolicyMutationFailClosedError';
                throw error;
            }
        }

        async function commitLifecycleStop({
            nowEpochMs: stopAtEpochMs,
            operation = lifecycleOperation ?? 'graceful_stop',
        }) {
            if (closed) throw new Error('runtime controller is closed');
            const stopAt = epoch(stopAtEpochMs, 'stop.nowEpochMs');
            if (stopCommitResult) {
                if (stopCommitResult.operation !== operation) {
                    throw new Error(
                        'runtime stop operation conflicts with its durable commit',
                    );
                }
                return stopCommitResult;
            }
            if (stopCommitPromise) {
                if (
                    lifecycleOperation !== undefined &&
                    lifecycleOperation !== operation
                ) {
                    throw new Error(
                        'runtime stop operation conflicts with its in-flight commit',
                    );
                }
                return stopCommitPromise;
            }
            lifecycleMutationFenced = true;
            stopCommitPromise = (async () => {
                assertGenerationCurrent('durable runtime stop');
                if (state !== 'quiescing') {
                    const quiesced = await repository.request(
                        'quiesceRuntimeEpoch',
                        {
                            runtimeEpochId,
                            apiGeneration: generation,
                            senderFence,
                            expectedRevision: revision,
                            operation,
                            nowEpochMs: stopAt,
                        },
                    );
                    state = quiesced.state;
                    revision = quiesced.revision;
                    lifecycleOperation =
                        quiesced.state === 'quiescing'
                            ? quiesced.operation
                            : undefined;
                }
                if (state !== 'quiescing') {
                    const error = new Error(
                        'runtime stop blocked by durable lifecycle obligations',
                    );
                    error.name = 'RuntimeStopBlockedError';
                    throw error;
                }
                const result = await repository.request('stopRuntimeEpoch', {
                    runtimeEpochId,
                    apiGeneration: generation,
                    senderFence,
                    expectedRevision: revision,
                    operation,
                    nowEpochMs: stopAt,
                });
                state = result.state;
                revision = result.revision;
                stopCommitResult = Object.freeze({
                    state,
                    revision,
                    operation: result.operation,
                    runtimeEpochIdSha256: digest(runtimeEpochId),
                    apiGenerationSha256: digest(generation),
                    dispatchAllowed: false,
                    brokerWriteAttempted: false,
                });
                return stopCommitResult;
            })();
            try {
                return await stopCommitPromise;
            } finally {
                if (!stopCommitResult) stopCommitPromise = undefined;
            }
        }

        async function releaseStoppedRuntime() {
            if (closed) {
                return Object.freeze({
                    state: 'closed',
                    repositoryClosed: true,
                    runtimeLeaseReleased: true,
                });
            }
            if (!stopCommitResult || state !== 'stopped') {
                throw new Error(
                    'runtime ownership cannot be released before durable stop commit',
                );
            }
            if (stoppedRuntimeReleasePromise) {
                return stoppedRuntimeReleasePromise;
            }
            stoppedRuntimeReleasePromise = (async () => {
                // Keep the exclusive lease if repository shutdown fails.  A
                // partial cleanup must never make a replacement process look
                // like the owner of an unverified database handoff.
                await repository.close();
                authenticatedIdentityGroup.close();
                if (ownsRuntimeResourceCoordinator) {
                    runtimeResourceCoordinator.close();
                }
                officialMarketCalendarAuthority.close();
                await lease.close();
                await removeEmptyLeaseDirectory(
                    storage.paths.runtimeLeaseDirectory,
                );
                closed = true;
                return Object.freeze({
                    state: 'closed',
                    repositoryClosed: true,
                    runtimeLeaseReleased: true,
                });
            })();
            return stoppedRuntimeReleasePromise;
        }

        function assertGenerationCurrent(operation) {
            if (generationInvalidated) {
                throw generationInvalidatedError(operation);
            }
        }

        function assertContinuityCurrent(operation) {
            if (continuityInvalidated) {
                throw continuityInvalidatedError(operation);
            }
        }

        function assertRuntimeCurrent(operation) {
            assertGenerationCurrent(operation);
            assertContinuityCurrent(operation);
        }

        function assertLifecycleMutationOpen(operation) {
            if (lifecycleMutationFenced || state === 'quiescing' || state === 'stopped') {
                throw lifecycleMutationFencedError(operation);
            }
        }

        async function invalidateRuntimeContinuityGap(input) {
            if (closed) throw new Error('runtime controller is closed');
            if (
                !exactInputKeys(input, [
                    'schemaVersion',
                    'runtimeEpochIdSha256',
                    'signalSha256',
                    'reasonCodes',
                    'nowEpochMs',
                ])
            ) {
                throw new TypeError(
                    'runtime continuity invalidation accepts only a signal digest, reason codes, and time',
                );
            }
            if (
                input.schemaVersion !==
                    SMART_ORDER_RUNTIME_GAP_INVALIDATION_SCHEMA_VERSION ||
                sha256Digest(
                    input.runtimeEpochIdSha256,
                    'runtime continuity runtimeEpochIdSha256',
                ) !== continuityRuntimeEpochIdSha256
            ) {
                throw new TypeError(
                    'runtime continuity invalidation does not match its issued epoch envelope',
                );
            }
            const signalSha256 = sha256Digest(
                input.signalSha256,
                'runtime continuity signalSha256',
            );
            const reasonCodes = continuityGapReasonCodes(input.reasonCodes);
            const invalidatedAtEpochMs = epoch(
                input.nowEpochMs,
                'invalidateRuntimeContinuityGap.nowEpochMs',
            );
            if (continuityInvalidated) {
                if (
                    continuitySignalSha256 !== signalSha256 ||
                    JSON.stringify(continuityReasonCodes) !==
                        JSON.stringify(reasonCodes)
                ) {
                    throw continuityInvalidatedError(
                        'runtime continuity invalidation with a conflicting signal',
                    );
                }
                if (continuityInvalidationResult) {
                    return continuityInvalidationResult;
                }
                return continuityInvalidationPromise;
            }

            // Close the in-process dispatch boundary before awaiting SQLite.
            // A repository failure must leave this latch set: availability may
            // degrade, but a continuity gap can never reopen dispatch.
            continuityInvalidated = true;
            continuitySignalSha256 = signalSha256;
            continuityReasonCodes = reasonCodes;
            state = 'reconciling';
            lifecycleOperation = undefined;
            continuityInvalidationPromise = (async () => {
                const result = await repository.request(
                    'invalidateRuntimeContinuityGap',
                    {
                        runtimeEpochId,
                        senderFence,
                        apiGeneration: generation,
                        signalSha256,
                        reasonCodes,
                        nowEpochMs: invalidatedAtEpochMs,
                    },
                );
                state = result.state;
                revision = result.revision;
                continuityInvalidationResult = Object.freeze({
                    schemaVersion:
                        SMART_ORDER_RUNTIME_GAP_INVALIDATION_SCHEMA_VERSION,
                    runtimeEpochIdSha256: continuityRuntimeEpochIdSha256,
                    ...result,
                    reasonCodes: Object.freeze([...result.reasonCodes]),
                    dispatchAllowed: false,
                });
                return continuityInvalidationResult;
            })();
            return continuityInvalidationPromise;
        }

        async function invalidateApiGeneration({
            observedApiGeneration,
            nowEpochMs: invalidatedAtEpochMs,
        }) {
            if (closed) throw new Error('runtime controller is closed');
            const observed = token(
                observedApiGeneration,
                'observedApiGeneration',
            );
            if (observed === generation) {
                throw new Error(
                    'runtime API generation invalidation requires a changed observation',
                );
            }
            const invalidatedAt = epoch(
                invalidatedAtEpochMs,
                'invalidateApiGeneration.nowEpochMs',
            );
            if (generationInvalidationResult) {
                return generationInvalidationResult;
            }
            if (generationInvalidationPromise) {
                return generationInvalidationPromise;
            }

            // Latch locally before the repository round trip. This closes the
            // controller dispatch boundary even if SQLite is unavailable or a
            // concurrent operation has already advanced the durable revision.
            generationInvalidated = true;
            observedApiGenerationSha256 = digest(observed);
            state = 'reconciling';
            lifecycleOperation = undefined;
            generationInvalidationPromise = (async () => {
                const result = await repository.request(
                    'invalidateRuntimeApiGeneration',
                    {
                        runtimeEpochId,
                        apiGeneration: generation,
                        senderFence,
                        observedApiGeneration: observed,
                        nowEpochMs: invalidatedAt,
                    },
                );
                state = result.state;
                revision = result.revision;
                generationInvalidationResult = Object.freeze({
                    ...result,
                    dispatchAllowed: false,
                });
                return generationInvalidationResult;
            })();
            return generationInvalidationPromise;
        }

        async function closeForGenerationFailover(input) {
            if (failoverCloseResult) return failoverCloseResult;
            if (failoverCloseError) throw failoverCloseError;
            if (closed) throw new Error('runtime controller is closed');

            let invalidationError;
            let cleanupError;
            try {
                await invalidateApiGeneration(input);
            } catch (error) {
                invalidationError = error;
            } finally {
                const cleanupResults = await Promise.allSettled([
                    repository.close(),
                    Promise.resolve().then(() =>
                        authenticatedIdentityGroup.close(),
                    ),
                    Promise.resolve().then(() => {
                        if (ownsRuntimeResourceCoordinator) {
                            runtimeResourceCoordinator.close();
                        }
                    }),
                    Promise.resolve().then(() =>
                        officialMarketCalendarAuthority.close(),
                    ),
                    lease.close(),
                ]);
                await removeEmptyLeaseDirectory(
                    storage.paths.runtimeLeaseDirectory,
                ).catch((error) => {
                    cleanupError ??= error;
                });
                for (const result of cleanupResults) {
                    if (result.status === 'rejected') {
                        cleanupError ??= result.reason;
                    }
                }
                closed = true;
            }

            if (invalidationError || cleanupError) {
                failoverCloseError =
                    invalidationError && cleanupError
                        ? new AggregateError(
                              [invalidationError, cleanupError],
                              'runtime generation failover invalidation and cleanup failed',
                          )
                        : (invalidationError ?? cleanupError);
                throw failoverCloseError;
            }
            failoverCloseResult = Object.freeze({
                state: 'closed',
                repositoryState: state,
                reason: 'generation_invalidated',
                observedApiGenerationSha256,
                dispatchAllowed: false,
                requiresProcessRestart: true,
            });
            return failoverCloseResult;
        }

        const controller = Object.freeze({
            schemaVersion: SMART_ORDER_RUNTIME_CONTROLLER_SCHEMA_VERSION,
            role: 'primary',
            runtimeEpochIdSha256: continuityRuntimeEpochIdSha256,
            get dispatchAllowed() {
                return (
                    !closed &&
                    !generationInvalidated &&
                    !continuityInvalidated &&
                    pendingKillSwitchMutations.size === 0 &&
                    !killSwitchMutationFailed &&
                    !riskPolicyMutationPromise &&
                    !riskPolicyMutationFailed &&
                    brokerObservationPendingSha256 === undefined &&
                    calendarActivationReady() &&
                    !emergencyKillSwitchEnabled() &&
                    state === 'ready'
                );
            },
            storage: redactPrivateRuntimeStatus(storage),
            status() {
                return Object.freeze({
                    role: 'primary',
                    state: closed ? 'closed' : state,
                    revision,
                    dispatchAllowed:
                        !closed &&
                        !generationInvalidated &&
                        !continuityInvalidated &&
                        pendingKillSwitchMutations.size === 0 &&
                        !killSwitchMutationFailed &&
                        !riskPolicyMutationPromise &&
                        !riskPolicyMutationFailed &&
                        brokerObservationPendingSha256 === undefined &&
                        calendarActivationReady() &&
                        !emergencyKillSwitchEnabled() &&
                        state === 'ready',
                    repositoryOpened: !closed,
                    tradingSenderAuthority:
                        closed ||
                        generationInvalidated ||
                        continuityInvalidated ||
                        brokerObservationPendingSha256 !== undefined ||
                        state === 'stopped'
                            ? 'none'
                            : 'runtime_only',
                    legacyTradingTriggerAuthority: 'permanently_retired',
                    apiGenerationSha256: digest(generation),
                    generationInvalidated,
                    generationInvalidationReason: generationInvalidated
                        ? 'generation_invalidated'
                        : null,
                    resourceCoordinator:
                        runtimeResourceCoordinator.status(),
                    officialMarketCalendar: officialCalendarStatus(),
                    observedApiGenerationSha256:
                        observedApiGenerationSha256 ?? null,
                    requiresProcessRestart: generationInvalidated,
                    continuityInvalidated,
                    continuityInvalidationReason: continuityInvalidated
                        ? 'continuity_gap_invalidated'
                        : null,
                    continuitySignalSha256: continuitySignalSha256 ?? null,
                    continuityReasonCodes:
                        continuityReasonCodes ?? Object.freeze([]),
                    continuityInvalidationDurable:
                        continuityInvalidationResult !== undefined,
                    reconciliationRequired:
                        continuityInvalidated ||
                        brokerObservationPendingSha256 !== undefined,
                    brokerObservationPending:
                        brokerObservationPendingSha256 !== undefined,
                    brokerObservationPendingSha256:
                        brokerObservationPendingSha256 ?? null,
                    brokerObservationReconciledAccountCount:
                        brokerObservationReconciledAccountScopes.size,
                    brokerObservationPendingMaterializationCount:
                        brokerObservationPendingMaterializationIntentIds.size,
                    userRearmRequiredAfterReconciliation:
                        continuityInvalidated,
                    lifecycleMutationFenced,
                    lifecycleStopCommitted: stopCommitResult !== undefined,
                    killSwitch,
                    killSwitchMutationPending:
                        pendingKillSwitchMutations.size > 0,
                    killSwitchMutationFailed,
                    riskPolicyMutationPending:
                        riskPolicyMutationPromise !== undefined,
                    riskPolicyMutationFailed,
                    authenticatedIdentity:
                        authenticatedIdentityGroup.status(),
                    watchdog: repository.watchdogStatus(),
                });
            },
            async markReady({ reconciliationEvidenceHash }) {
                if (closed) throw new Error('runtime controller is closed');
                assertRuntimeCurrent('runtime ready transition');
                if (brokerObservationPendingSha256 !== undefined) {
                    throw new Error(
                        'runtime controller has a broker observation pending reconciliation',
                    );
                }
                if (state !== 'reconciling') {
                    throw new Error('runtime controller is not reconciling');
                }
                const result = await repository.request('markRuntimeEpochReady', {
                    runtimeEpochId,
                    apiGeneration: generation,
                    senderFence,
                    expectedRevision: revision,
                    reconciliationEvidenceHash,
                });
                assertRuntimeCurrent('runtime ready transition');
                state = result.state;
                revision = result.revision;
                return Object.freeze({
                    state,
                    revision,
                    dispatchAllowed:
                        state === 'ready' &&
                        calendarActivationReady() &&
                        !emergencyKillSwitchEnabled() &&
                        !killSwitchMutationFailed,
                });
            },
            async createBackup({ backupName, createdAtEpochMs }) {
                if (closed) throw new Error('runtime controller is closed');
                return repository.request('createRepositoryBackup', {
                    backupName,
                    createdAtEpochMs,
                });
            },
            async gateManifestStatus({ provenance, nowEpochMs }) {
                if (closed) throw new Error('runtime controller is closed');
                return repository.request('gateManifestStatus', {
                    provenance,
                    nowEpochMs: epoch(
                        nowEpochMs,
                        'gateManifestStatus.nowEpochMs',
                    ),
                });
            },
            async prepareGateProbeSafetyEnvelope(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertRuntimeCurrent('gate probe preparation');
                assertLifecycleMutationOpen('gate probe preparation');
                await waitForPendingKillSwitchMutations();
                await waitForPendingRiskPolicyMutation();
                assertRuntimeCurrent('gate probe preparation');
                assertLifecycleMutationOpen('gate probe preparation');
                const request = snapshotExactOwnData(
                    input,
                    [
                        'cliAuthorizationSha256',
                        'controlPlaneAuthority',
                        'envelope',
                        'nowEpochMs',
                    ],
                    'gate probe preparation request',
                );
                if (
                    gateProbeControlPlaneAuthority === null ||
                    request.controlPlaneAuthority !==
                        gateProbeControlPlaneAuthority
                ) {
                    throw new Error(
                        'gate probe preparation requires the private control-plane authority',
                    );
                }
                const now = epoch(
                    request.nowEpochMs,
                    'gateProbe.nowEpochMs',
                );
                const canonical =
                    canonicalSmartOrderGateProbeSafetyEnvelope(
                        request.envelope,
                    );
                if (
                    !/^sha256:[0-9a-f]{64}$/.test(
                        request.cliAuthorizationSha256 ?? '',
                    )
                ) {
                    throw new TypeError(
                        'gate probe CLI authorization evidence is invalid',
                    );
                }
                if (
                    state !== 'ready' ||
                    KILL_SWITCH_NAMES.some(
                        (name) => killSwitch?.switches?.[name]?.enabled === true,
                    )
                ) {
                    return Object.freeze({
                        prepared: false,
                        state: 'observe_only',
                        reason: 'runtime_or_kill_switch_not_ready',
                        automaticRetryAllowed: false,
                        cleanupAllowed: false,
                        brokerWriteAttempted: false,
                        adapterAuthorityGranted: false,
                        brokerAuthority: false,
                        writeMasterAuthority: false,
                    });
                }
                const gate = await repository.request('gateManifestStatus', {
                    provenance: 'gate_probe',
                    nowEpochMs: now,
                });
                assertRuntimeCurrent('gate probe preparation');
                if (
                    gate?.present !== true ||
                    gate.state !== 'eligible' ||
                    typeof gate.manifestSha256 !== 'string'
                ) {
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
                }
                if (gateProbeModeAdmission === null) {
                    throw new Error(
                        'gate probe mode safety admission is unavailable',
                    );
                }
                const modeLease = await gateProbeModeAdmission.acquire();
                try {
                    const adjacent = await modeLease.revalidate();
                    if (
                        adjacent.current !== true ||
                        adjacent.simulation !== true ||
                        adjacent.caLoaded !== false ||
                        adjacent.productionLoaded !== false
                    ) {
                        throw new Error(
                            'gate probe simulation safety attestation is incomplete',
                        );
                    }
                    const adjacentNow = epoch(
                        runtimeNow(),
                        'gateProbe.adjacentNowEpochMs',
                    );
                    if (
                        adjacentNow < now ||
                        !smartOrderGateProbeEnvelopeIsCurrent(
                            canonical.envelope,
                            adjacentNow,
                        )
                    ) {
                        throw new Error(
                            'gate probe authorization expired during safety attestation',
                        );
                    }
                    const safetyAttestationSha256 = digest(
                        JSON.stringify({
                            schemaVersion:
                                'smart-order-gate-probe-runtime-safety/2026-08-22.1',
                            modeExecutionLeaseEvidenceHash:
                                modeLease.modeExecutionLeaseEvidenceHash,
                            initialSimulationAttestationSha256:
                                modeLease.initialSimulationAttestationSha256,
                            adjacentSimulationAttestationSha256:
                                adjacent.simulationAttestationSha256,
                            apiGeneration: adjacent.apiGeneration,
                            simulation: true,
                            caLoaded: false,
                            productionLoaded: false,
                        }),
                    );
                    const result = await repository.request(
                        'prepareGateProbeSafetyEnvelope',
                        {
                            runtimeEpochId,
                            senderFence,
                            apiGeneration: generation,
                            manifestSha256: gate.manifestSha256,
                            cliAuthorizationSha256:
                                request.cliAuthorizationSha256,
                            safetyAttestationSha256,
                            envelope: canonical.sourceEnvelope,
                            nowEpochMs: adjacentNow,
                        },
                    );
                    assertRuntimeCurrent('gate probe preparation');
                    return Object.freeze({
                        ...result,
                        prepared: result.state === 'prepared',
                        simulationAttested: true,
                        caLoaded: false,
                        productionLoaded: false,
                        brokerWriteAttempted: false,
                        adapterAuthorityGranted: false,
                        brokerAuthority: false,
                        writeMasterAuthority: false,
                    });
                } finally {
                    await modeLease.close();
                }
            },
            async gateProbeSafetyStatus() {
                if (closed) throw new Error('runtime controller is closed');
                const result = await repository.request(
                    'gateProbeSafetyStatus',
                    {},
                );
                return Object.freeze({
                    ...result,
                    brokerWriteAttempted: false,
                    adapterAuthorityGranted: false,
                    brokerAuthority: false,
                    writeMasterAuthority: false,
                });
            },
            acceptAuthenticatedIdentityEvidence(evidence) {
                if (closed) throw new Error('runtime controller is closed');
                return authenticatedIdentityGroup.acceptPrincipalEvidence(
                    evidence,
                );
            },
            invalidateAuthenticatedIdentityEvidence() {
                if (closed) throw new Error('runtime controller is closed');
                return authenticatedIdentityGroup.invalidatePrincipalEvidence();
            },
            async dispatchBrokerIntent(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertRuntimeCurrent('broker dispatch');
                assertLifecycleMutationOpen('broker dispatch');
                await waitForPendingKillSwitchMutations();
                await waitForPendingRiskPolicyMutation();
                assertRuntimeCurrent('broker dispatch');
                assertLifecycleMutationOpen('broker dispatch');
                requireCalendarActivationReady('broker dispatch');
                return brokerDispatchCoordinator.dispatch({
                    ...input,
                    expectedKillSwitchArbiterRevision:
                        killSwitch.arbiterRevision,
                });
            },
            async killSwitchStatus() {
                if (closed) throw new Error('runtime controller is closed');
                const result = await repository.request('killSwitchStatus', {});
                return cacheKillSwitchProjection(result);
            },
            async mutateKillSwitch(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertRuntimeCurrent('kill switch mutation');
                if (
                    !exactInputKeys(input, [
                        'switchName',
                        'enabled',
                        'expectedArbiterRevision',
                        'reasonCode',
                        'nowEpochMs',
                    ])
                ) {
                    throw new TypeError(
                        'kill switch mutation accepts only switch, value, revision, reason, and time',
                    );
                }
                let requestPromise;
                requestPromise = repository.request('mutateKillSwitch', {
                    runtimeEpochId,
                    senderFence,
                    apiGeneration: generation,
                    switchName: input.switchName,
                    enabled: input.enabled,
                    expectedArbiterRevision: input.expectedArbiterRevision,
                    reasonCode: input.reasonCode,
                    nowEpochMs: epoch(
                        input.nowEpochMs,
                        'mutateKillSwitch.nowEpochMs',
                    ),
                });
                pendingKillSwitchMutations.add(requestPromise);
                try {
                    const result = await requestPromise;
                    assertRuntimeCurrent('kill switch mutation');
                    cacheKillSwitchProjection(result);
                    return result;
                } catch (error) {
                    if (
                        ![
                            'KillSwitchArbiterRevisionError',
                            'TypeError',
                        ].includes(error?.name)
                    ) {
                        killSwitchMutationFailed = true;
                    }
                    throw error;
                } finally {
                    pendingKillSwitchMutations.delete(requestPromise);
                }
            },
            invalidateRuntimeContinuityGap,
            invalidateApiGeneration,
            closeForGenerationFailover,
            async lifecycleAudit() {
                if (closed) throw new Error('runtime controller is closed');
                return repository.request('lifecycleAudit', {});
            },
            async quiesce({ operation, nowEpochMs: quiesceAtEpochMs }) {
                if (closed) throw new Error('runtime controller is closed');
                // A durable continuity gap must block every trading mutation,
                // but it must not trap a zero-obligation Runtime in a state
                // where the repository can never prove a safe lifecycle
                // drain.  Generation invalidation still rejects the request;
                // the repository remains the authority for all strategy,
                // intent, broker-order, claim, obligation and reconciliation
                // blockers before it can return drainAllowed=true.
                assertGenerationCurrent('runtime quiesce');
                // Close the in-process mutation boundary before the repository
                // round trip.  A queued mutation is independently rejected by
                // the durable repository fence once this transaction commits.
                lifecycleMutationFenced = true;
                const result = await repository.request('quiesceRuntimeEpoch', {
                    runtimeEpochId,
                    apiGeneration: generation,
                    senderFence,
                    expectedRevision: revision,
                    operation,
                    nowEpochMs: epoch(
                        quiesceAtEpochMs,
                        'quiesce.nowEpochMs',
                    ),
                });
                assertGenerationCurrent('runtime quiesce');
                state = result.state;
                revision = result.revision;
                lifecycleOperation =
                    result.state === 'quiescing' ? result.operation : undefined;
                return Object.freeze({
                    ...result,
                    dispatchAllowed: false,
                });
            },
            async storeGateManifest() {
                if (closed) throw new Error('runtime controller is closed');
                assertRuntimeCurrent('gate manifest storage');
                throw new Error(
                    'single Gate manifest storage is disabled; use the private atomic Gate runner',
                );
            },
            async recomputeGateManifests(input) {
                if (closed) throw new Error('runtime controller is closed');
                // Gate recomputation is the read-only recovery path used while
                // continuity remains latched closed. Keep the API generation
                // fence, but do not require continuity to be current here;
                // broker dispatch continues to require both fences.
                assertGenerationCurrent('gate manifest recomputation');
                const hasExternalObservation =
                    input &&
                    typeof input === 'object' &&
                    Object.hasOwn(input, 'externalOrderEventObservation');
                const request = snapshotExactOwnData(
                    input,
                    hasExternalObservation
                        ? [
                              'externalOrderEventObservation',
                              'nowEpochMs',
                              'operationId',
                          ]
                        : ['nowEpochMs', 'operationId'],
                    'gate manifest recomputation request',
                );
                const externalOrderEventObservation = hasExternalObservation
                    ? request.externalOrderEventObservation
                    : false;
                if (typeof externalOrderEventObservation !== 'boolean') {
                    throw new TypeError(
                        'gate manifest external observation selection is invalid',
                    );
                }
                const operationId = token(
                    request.operationId,
                    'recomputeGateManifests.operationId',
                );
                const now = epoch(
                    request.nowEpochMs,
                    'recomputeGateManifests.nowEpochMs',
                );
                const operationKind = 'gate_manifest_recompute';
                const payloadHash = `sha256:${createHash('sha256')
                    .update(
                        [
                            operationKind,
                            runtimeEpochId,
                            senderFence,
                            generation,
                        ].join('\n'),
                    )
                    .digest('hex')}`;
                const replay = await repository.request(
                    'reserveRequestReplay',
                    {
                        requestId: operationId,
                        operationKind,
                        payloadHash,
                        nowEpochMs: now,
                    },
                );
                if (!replay.mayExecute) {
                    if (
                        replay.state === 'completed' &&
                        replay.result?.brokerWriteAuthority === false &&
                        replay.result?.writeMasterAuthority === false
                    ) {
                        return Object.freeze({
                            ...replay.result,
                            replayed: true,
                        });
                    }
                    return Object.freeze({
                        stored: false,
                        state: 'observe_only',
                        reason: 'gate_runner_operation_pending_or_unknown',
                        manifestCount: 0,
                        replayed: true,
                        brokerWriteAuthority: false,
                        writeMasterAuthority: false,
                    });
                }
                const run = await runManagedSmartOrderReadonlyGateRunner({
                    appSupportRoot,
                    resourceCoordinator: runtimeResourceCoordinator,
                    ...(externalOrderEventObservation
                        ? { externalOrderEventObservation: true }
                        : {}),
                });
                assertGenerationCurrent('gate manifest recomputation');
                const verificationNowEpochMs = epoch(
                    run.verificationNowEpochMs,
                    'gateManifestRunner.verificationNowEpochMs',
                );
                if (run.manifests.length !== 3) {
                    const result = Object.freeze({
                        stored: false,
                        state: 'observe_only',
                        reason: 'managed_readonly_evidence_not_eligible',
                        manifestCount: 0,
                        replayed: false,
                        brokerWriteAuthority: false,
                        writeMasterAuthority: false,
                    });
                    await repository.request('completeRequestReplay', {
                        requestId: operationId,
                        operationKind,
                        payloadHash,
                        resultStatus: 200,
                        result,
                        nowEpochMs: verificationNowEpochMs,
                    });
                    return result;
                }
                const batch = await repository.request(
                    'storeGateManifestBatch',
                    {
                        manifests: run.manifests,
                        nowEpochMs: verificationNowEpochMs,
                    },
                );
                assertGenerationCurrent('gate manifest recomputation');
                const stored = batch.stored;
                if (
                    !Array.isArray(stored) ||
                    stored.length !== 3 ||
                    batch.authoritativeForDispatch !== false
                ) {
                    throw new Error(
                        'Gate manifest batch persistence returned an invalid projection',
                    );
                }
                const result = Object.freeze({
                    stored: true,
                    state: 'observe_only',
                    manifestCount: stored.length,
                    manifestSha256: Object.freeze(
                        stored.map((item) => item.manifestSha256),
                    ),
                    replayed: false,
                    brokerWriteAuthority: false,
                    writeMasterAuthority: false,
                });
                await repository.request('completeRequestReplay', {
                    requestId: operationId,
                    operationKind,
                    payloadHash,
                    resultStatus: 200,
                    result,
                    nowEpochMs: verificationNowEpochMs,
                });
                return result;
            },
            async recordTask03cExternalWorkingSet(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertGenerationCurrent('Task 0.3c external reconciliation');
                if (!['reconciling', 'ready'].includes(state)) {
                    throw new Error(
                        'Task 0.3c external reconciliation requires the current observer',
                    );
                }
                const request = snapshotExactOwnData(
                    input,
                    ['nowEpochMs', 'observation', 'operationId'],
                    'Task 0.3c external reconciliation request',
                );
                const operationId = token(
                    request.operationId,
                    'task03c.operationId',
                );
                const now = epoch(request.nowEpochMs, 'task03c.nowEpochMs');
                const operationKind =
                    'task0_3c_external_working_set_reconciliation';
                const payloadHash = `sha256:${createHash('sha256')
                    .update(
                        JSON.stringify({
                            apiGeneration: generation,
                            observation: request.observation,
                            runtimeEpochId,
                            senderFence,
                        }),
                    )
                    .digest('hex')}`;
                const replay = await repository.request(
                    'reserveRequestReplay',
                    {
                        requestId: operationId,
                        operationKind,
                        payloadHash,
                        nowEpochMs: now,
                    },
                );
                if (!replay.mayExecute) {
                    if (
                        replay.state === 'completed' &&
                        replay.result?.brokerWriteAuthority === false
                    ) {
                        return Object.freeze({
                            ...replay.result,
                            replayed: true,
                        });
                    }
                    throw new Error(
                        'Task 0.3c external reconciliation replay is unresolved',
                    );
                }
                try {
                    const result = await repository.request(
                        'recordTask03cExternalWorkingSet',
                        {
                            ...request.observation,
                            apiGeneration: generation,
                            runtimeEpochId,
                            senderFence,
                            nowEpochMs: now,
                        },
                    );
                    assertGenerationCurrent(
                        'Task 0.3c external reconciliation',
                    );
                    const projection = Object.freeze({
                        ...result,
                        replayed: false,
                        brokerWriteAuthority: false,
                        writeMasterAuthority: false,
                    });
                    await repository.request('completeRequestReplay', {
                        requestId: operationId,
                        operationKind,
                        payloadHash,
                        resultStatus: 200,
                        result: projection,
                        nowEpochMs: now,
                    });
                    return projection;
                } catch (error) {
                    await repository
                        .request('failRequestReplay', {
                            requestId: operationId,
                            operationKind,
                            payloadHash,
                            resultStatus: 503,
                            result: {
                                state: 'failed_closed',
                                brokerWriteAuthority: false,
                                writeMasterAuthority: false,
                            },
                            nowEpochMs: now,
                        })
                        .catch(() => {});
                    throw error;
                }
            },
            async invalidateGateManifests({
                provenance,
                reason,
                nowEpochMs,
            }) {
                if (closed) throw new Error('runtime controller is closed');
                return repository.request('invalidateGateManifests', {
                    provenance,
                    reason,
                    nowEpochMs: epoch(
                        nowEpochMs,
                        'invalidateGateManifests.nowEpochMs',
                    ),
                });
            },
            async reserveRequestReplay(input) {
                if (closed) throw new Error('runtime controller is closed');
                return repository.request('reserveRequestReplay', input);
            },
            async completeRequestReplay(input) {
                if (closed) throw new Error('runtime controller is closed');
                return repository.request('completeRequestReplay', input);
            },
            async failRequestReplay(input) {
                if (closed) throw new Error('runtime controller is closed');
                return repository.request('failRequestReplay', input);
            },
            async executeReplayProtectedStrategyMutation(input) {
                if (closed) throw new Error('runtime controller is closed');
                const top = snapshotExactOwnData(
                    input,
                    [
                        'mutation',
                        'nowEpochMs',
                        'operationKind',
                        'payloadHash',
                        'requestId',
                    ],
                    'strategy mutation request',
                );
                const mutationKindDescriptor =
                    top.mutation &&
                    typeof top.mutation === 'object' &&
                    !Array.isArray(top.mutation) &&
                    !utilTypes.isProxy(top.mutation)
                        ? Object.getOwnPropertyDescriptor(top.mutation, 'kind')
                        : undefined;
                if (
                    !mutationKindDescriptor?.enumerable ||
                    !Object.hasOwn(mutationKindDescriptor, 'value') ||
                    typeof mutationKindDescriptor.value !== 'string'
                ) {
                    throw new TypeError('strategy mutation kind is invalid');
                }
                const mutationKind = mutationKindDescriptor.value;
                let request = top;
                if (
                    mutationKind === 'strategy_confirmation_preview' ||
                    mutationKind === 'strategy_confirmation_accept'
                ) {
                    assertRuntimeCurrent('canonical strategy confirmation');
                    assertLifecycleMutationOpen('canonical strategy confirmation');
                    if (state !== 'ready') {
                        throw new Error(
                            'canonical strategy confirmation requires the current ready runtime',
                        );
                    }
                    const isAccept =
                        mutationKind === 'strategy_confirmation_accept';
                    const mutation = snapshotExactOwnData(
                        top.mutation,
                        [
                            'accountBrokerRef',
                            'accountIdRef',
                            'basisSelection',
                            'confirmationId',
                            'contractEvidence',
                            'controlPlaneAuthority',
                            'expectedRevision',
                            'kind',
                            ...(Object.hasOwn(
                                top.mutation,
                                'monitorContractEvidence',
                            )
                                ? ['monitorContractEvidence']
                                : []),
                            'nowEpochMs',
                            ...(isAccept
                                ? ['snapshotHash', 'userAcknowledged']
                                : []),
                            'strategyId',
                        ],
                        isAccept
                            ? 'canonical confirmation accept mutation'
                            : 'canonical confirmation preview mutation',
                    );
                    if (
                        strategyConfirmationControlPlaneAuthority === null ||
                        mutation.controlPlaneAuthority !==
                            strategyConfirmationControlPlaneAuthority ||
                        !isVerifiedSmartOrderCanonicalContractEvidence(
                            mutation.contractEvidence,
                        ) ||
                        (mutation.monitorContractEvidence != null &&
                            !Array.isArray(mutation.monitorContractEvidence) &&
                            !isVerifiedSmartOrderCanonicalContractEvidence(
                                mutation.monitorContractEvidence,
                            )) ||
                        (isAccept && mutation.userAcknowledged !== true) ||
                        !Number.isSafeInteger(mutation.expectedRevision) ||
                        mutation.expectedRevision < 0
                    ) {
                        throw new TypeError(
                            'canonical confirmation authority or revision is invalid',
                        );
                    }
                    const evidence = snapshotExactOwnData(
                        mutation.contractEvidence,
                        [
                            'accountScopeSha256',
                            'apiGeneration',
                            'contract',
                            'contractRevision',
                            'corporateActionRevision',
                            'evidenceSha256',
                            'fixedAtrSnapshot',
                            'gateManifestHash',
                            'gateManifestRevision',
                            'mappingRevision',
                            'observedAtEpochMs',
                            'runtimeEpochId',
                            'schemaVersion',
                            'validUntilEpochMs',
                        ],
                        'canonical contract evidence',
                    );
                    const contract = snapshotExactOwnData(
                        evidence.contract,
                        [
                            'categoryCode',
                            'code',
                            'contractUnit',
                            'draftContractKey',
                            'exchange',
                            'limitDownMinorUnits',
                            'limitUpMinorUnits',
                            'referenceMinorUnits',
                            'runtimeContractKey',
                            'securityType',
                            'updateDate',
                        ],
                        'canonical contract evidence contract',
                    );
                    const fixedAtrSnapshot = snapshotRuntimeFixedAtr(
                        evidence.fixedAtrSnapshot,
                        'canonical contract evidence fixed ATR snapshot',
                    );
                    const monitorEvidence =
                        mutation.monitorContractEvidence == null
                            ? null
                            : Array.isArray(mutation.monitorContractEvidence)
                              ? snapshotCanonicalContractEvidenceList(
                                    mutation.monitorContractEvidence,
                                    'canonical monitor contract evidence list',
                                )
                              : snapshotExactOwnData(
                                  mutation.monitorContractEvidence,
                                  [
                                      'accountScopeSha256',
                                      'apiGeneration',
                                      'contract',
                                      'contractRevision',
                                      'corporateActionRevision',
                                      'evidenceSha256',
                                      'fixedAtrSnapshot',
                                      'gateManifestHash',
                                      'gateManifestRevision',
                                      'mappingRevision',
                                      'observedAtEpochMs',
                                      'runtimeEpochId',
                                      'schemaVersion',
                                      'validUntilEpochMs',
                                  ],
                                  'canonical monitor contract evidence',
                              );
                    const monitorContract =
                        monitorEvidence === null || Array.isArray(monitorEvidence)
                            ? null
                            : snapshotExactOwnData(
                                  monitorEvidence.contract,
                                  [
                                      'categoryCode',
                                      'code',
                                      'contractUnit',
                                      'draftContractKey',
                                      'exchange',
                                      'limitDownMinorUnits',
                                      'limitUpMinorUnits',
                                      'referenceMinorUnits',
                                      'runtimeContractKey',
                                      'securityType',
                                      'updateDate',
                                  ],
                                  'canonical monitor contract evidence contract',
                              );
                    const basis =
                        mutation.basisSelection === null
                            ? null
                            : mutation.basisSelection?.source ===
                        'broker_average_cost'
                            ? snapshotExactOwnData(
                                  mutation.basisSelection,
                                  ['source'],
                                  'canonical broker average basis',
                              )
                            : snapshotExactOwnData(
                                  mutation.basisSelection,
                                  ['priceDecimal', 'source'],
                                  'canonical user-specified basis',
                              );
                    request = Object.freeze({
                        ...top,
                        mutation: Object.freeze({
                            accountBrokerRef: token(
                                mutation.accountBrokerRef,
                                'confirmation.accountBrokerRef',
                            ),
                            accountIdRef: token(
                                mutation.accountIdRef,
                                'confirmation.accountIdRef',
                            ),
                            apiGeneration: generation,
                            basisSelection:
                                basis === null
                                    ? null
                                    : Object.freeze({ ...basis }),
                            confirmationId: token(
                                mutation.confirmationId,
                                'confirmation.confirmationId',
                            ),
                            contractEvidence: Object.freeze({
                                ...evidence,
                                contract: Object.freeze({ ...contract }),
                                fixedAtrSnapshot,
                            }),
                            monitorContractEvidence:
                                monitorEvidence === null
                                    ? null
                                    : Array.isArray(monitorEvidence)
                                      ? monitorEvidence
                                    : Object.freeze({
                                          ...monitorEvidence,
                                          contract: Object.freeze({
                                              ...monitorContract,
                                          }),
                                          fixedAtrSnapshot: snapshotRuntimeFixedAtr(
                                              monitorEvidence.fixedAtrSnapshot,
                                              'canonical monitor contract evidence fixed ATR snapshot',
                                          ),
                                      }),
                            expectedRevision: mutation.expectedRevision,
                            kind: mutationKind,
                            nowEpochMs: epoch(
                                mutation.nowEpochMs,
                                'confirmation.nowEpochMs',
                            ),
                            runtimeEpochId,
                            senderFence,
                            ...(isAccept
                                ? {
                                      snapshotHash: sha256Digest(
                                          mutation.snapshotHash,
                                          'confirmation.snapshotHash',
                                      ),
                                      userAcknowledged: true,
                                  }
                                : {}),
                            strategyId: token(
                                mutation.strategyId,
                                'confirmation.strategyId',
                            ),
                        }),
                    });
                }
                if (
                    mutationKind === 'protected_entry_confirmation_preview' ||
                    mutationKind === 'protected_entry_confirmation_accept'
                ) {
                    assertRuntimeCurrent('protected entry confirmation');
                    assertLifecycleMutationOpen('protected entry confirmation');
                    if (
                        state !== 'ready' ||
                        pendingKillSwitchMutations.size > 0 ||
                        killSwitchMutationFailed ||
                        riskPolicyMutationPromise ||
                        riskPolicyMutationFailed ||
                        emergencyKillSwitchEnabled()
                    ) {
                        throw new Error(
                            'protected entry confirmation requires the current ready runtime',
                        );
                    }
                    const isAccept =
                        mutationKind === 'protected_entry_confirmation_accept';
                    const mutation = snapshotExactOwnData(
                        top.mutation,
                        [
                            'confirmationId',
                            'confirmationRequest',
                            'contractEvidence',
                            'controlPlaneAuthority',
                            'kind',
                            'nowEpochMs',
                            ...(isAccept
                                ? ['snapshotHash', 'userAcknowledged']
                                : []),
                        ],
                        isAccept
                            ? 'protected entry confirmation accept mutation'
                            : 'protected entry confirmation preview mutation',
                    );
                    if (
                        strategyConfirmationControlPlaneAuthority === null ||
                        mutation.controlPlaneAuthority !==
                            strategyConfirmationControlPlaneAuthority ||
                        !isVerifiedSmartOrderCanonicalContractEvidence(
                            mutation.contractEvidence,
                        ) ||
                        (isAccept && mutation.userAcknowledged !== true)
                    ) {
                        throw new TypeError(
                            'protected entry confirmation authority is invalid',
                        );
                    }
                    const confirmationRequest =
                        snapshotProtectedEntryAdmissionInput(
                            mutation.confirmationRequest,
                        );
                    if (
                        !exactInputKeys(confirmationRequest, [
                            'accountBrokerRef',
                            'accountIdRef',
                            'commonLots',
                            'contractKey',
                            'entryOrder',
                            'protection',
                            'schemaVersion',
                        ]) ||
                        !exactInputKeys(confirmationRequest.entryOrder, [
                            'limitPrice',
                            'priceType',
                            'timeInForce',
                        ]) ||
                        !exactInputKeys(confirmationRequest.protection, [
                            'family',
                            'legs',
                        ])
                    ) {
                        throw new TypeError(
                            'protected entry confirmation request schema is invalid',
                        );
                    }
                    const evidence = snapshotExactOwnData(
                        mutation.contractEvidence,
                        [
                            'accountScopeSha256',
                            'apiGeneration',
                            'contract',
                            'contractRevision',
                            'corporateActionRevision',
                            'evidenceSha256',
                            'fixedAtrSnapshot',
                            'gateManifestHash',
                            'gateManifestRevision',
                            'mappingRevision',
                            'observedAtEpochMs',
                            'runtimeEpochId',
                            'schemaVersion',
                            'validUntilEpochMs',
                        ],
                        'protected entry canonical contract evidence',
                    );
                    const contract = snapshotExactOwnData(
                        evidence.contract,
                        [
                            'categoryCode',
                            'code',
                            'contractUnit',
                            'draftContractKey',
                            'exchange',
                            'limitDownMinorUnits',
                            'limitUpMinorUnits',
                            'referenceMinorUnits',
                            'runtimeContractKey',
                            'securityType',
                            'updateDate',
                        ],
                        'protected entry contract evidence contract',
                    );
                    const fixedAtrSnapshot = snapshotRuntimeFixedAtr(
                        evidence.fixedAtrSnapshot,
                        'protected entry contract evidence fixed ATR snapshot',
                    );
                    if (fixedAtrSnapshot !== null) {
                        throw new TypeError(
                            'protected entry contract evidence must not carry an existing-position ATR snapshot',
                        );
                    }
                    const mutationNow = epoch(
                        mutation.nowEpochMs,
                        'protectedEntryConfirmation.nowEpochMs',
                    );
                    request = Object.freeze({
                        ...top,
                        mutation: Object.freeze({
                            apiGeneration: generation,
                            confirmationId: token(
                                mutation.confirmationId,
                                'protectedEntryConfirmation.confirmationId',
                            ),
                            confirmationRequest,
                            contractEvidence: Object.freeze({
                                ...evidence,
                                contract: Object.freeze({ ...contract }),
                                fixedAtrSnapshot,
                            }),
                            ...(isAccept
                                ? {
                                      identityAdmission:
                                          authenticatedIdentityGroup.issueAdmission(
                                              {
                                                  accountBrokerRef:
                                                      confirmationRequest.accountBrokerRef,
                                                  accountIdRef:
                                                      confirmationRequest.accountIdRef,
                                                  nowEpochMs: mutationNow,
                                              },
                                          ),
                                      snapshotHash: sha256Digest(
                                          mutation.snapshotHash,
                                          'protectedEntryConfirmation.snapshotHash',
                                      ),
                                      userAcknowledged: true,
                                  }
                                : {}),
                            kind: mutationKind,
                            nowEpochMs: mutationNow,
                            runtimeEpochId,
                            senderFence,
                        }),
                    });
                }
                if (
                    mutationKind === 'resume' ||
                    mutationKind === 'cancel_broker_order' ||
                    mutationKind === 'update_broker_order'
                ) {
                    assertRuntimeCurrent('strategy control admission');
                    assertLifecycleMutationOpen('strategy blocker mutation');
                    const isResume = mutationKind === 'resume';
                    const isBrokerUpdate =
                        mutationKind === 'update_broker_order';
                    const mutation = snapshotExactOwnData(
                        top.mutation,
                        isResume
                            ? [
                                  'activationPolicyAcknowledged',
                                  'contractEvidence',
                                  'controlPlaneAuthority',
                                  'expectedRevision',
                                  'kind',
                                  'nowEpochMs',
                                  'strategyId',
                              ]
                            : isBrokerUpdate
                              ? [
                                    'expectedRevision',
                                    'kind',
                                    'nowEpochMs',
                                    'quantityShares',
                                    'strategyId',
                                    'userConfirmationAcknowledged',
                                ]
                              : [
                                  'expectedRevision',
                                  'kind',
                                  'nowEpochMs',
                                  'strategyId',
                                  'userConfirmationAcknowledged',
                              ],
                        isResume
                            ? 'strategy resume mutation'
                            : isBrokerUpdate
                              ? 'broker quantity update mutation'
                              : 'broker cancellation mutation',
                    );
                    if (
                        (isResume &&
                            (mutation.activationPolicyAcknowledged !== true ||
                                mutation.controlPlaneAuthority !==
                                    strategyConfirmationControlPlaneAuthority ||
                                (mutation.contractEvidence !== null &&
                                    !isVerifiedSmartOrderCanonicalContractEvidence(
                                        mutation.contractEvidence,
                                    )))) ||
                        (!isResume &&
                            mutation.userConfirmationAcknowledged !== true) ||
                        !Number.isSafeInteger(mutation.expectedRevision) ||
                        mutation.expectedRevision < 0 ||
                        (isBrokerUpdate &&
                            (!Number.isSafeInteger(mutation.quantityShares) ||
                                mutation.quantityShares < 1))
                    ) {
                        throw new TypeError(
                            'strategy control confirmation is invalid',
                        );
                    }
                    const requestId = token(top.requestId, 'requestId');
                    const strategyId = token(
                        mutation.strategyId,
                        'strategyId',
                    );
                    const nowEpochMs = epoch(
                        mutation.nowEpochMs,
                        'strategyControl.nowEpochMs',
                    );
                    const evidenceHash = digest(
                        [
                            'smart-order-strategy-control/2026-08-13.1',
                            isResume
                                ? 'resume_arm'
                                : isBrokerUpdate
                                  ? 'update_broker_order_quantity'
                                  : 'cancel_broker_order',
                            requestId,
                            strategyId,
                            String(mutation.expectedRevision),
                            ...(isBrokerUpdate
                                ? [String(mutation.quantityShares)]
                                : []),
                            runtimeEpochId,
                            senderFence,
                            generation,
                        ].join('\u001f'),
                    );
                    request = Object.freeze({
                        ...top,
                        mutation: Object.freeze({
                            ...(isResume
                                ? {
                                      activationPolicyAcknowledged: true,
                                      contractEvidence:
                                          snapshotCanonicalContractEvidence(
                                              mutation.contractEvidence,
                                              'strategy resume contract evidence',
                                          ),
                                      userArmEvidenceHash: evidenceHash,
                                  }
                                : {
                                      userConfirmationEvidenceHash:
                                          evidenceHash,
                                      ...(isBrokerUpdate
                                          ? {
                                                quantityShares:
                                                    mutation.quantityShares,
                                            }
                                          : {}),
                                  }),
                            apiGeneration: generation,
                            authorityId: requestId,
                            expectedRevision: mutation.expectedRevision,
                            kind: mutation.kind,
                            nowEpochMs,
                            runtimeEpochId,
                            senderFence,
                            strategyId,
                        }),
                    });
                }
                if (
                    mutationKind ===
                    'manual_resolution_apply_unique_final'
                ) {
                    assertRuntimeCurrent('manual resolution');
                    assertLifecycleMutationOpen('manual resolution');
                    const mutation = snapshotExactOwnData(
                        top.mutation,
                        [
                            'expectedRevision',
                            'kind',
                            'nowEpochMs',
                            'resolutionKey',
                            'strategyId',
                            'userAcknowledgedFinalEvidence',
                        ],
                        'manual resolution mutation',
                    );
                    if (
                        mutation.userAcknowledgedFinalEvidence !== true ||
                        !Number.isSafeInteger(mutation.expectedRevision) ||
                        mutation.expectedRevision < 0
                    ) {
                        throw new TypeError(
                            'manual resolution confirmation is invalid',
                        );
                    }
                    request = Object.freeze({
                        ...top,
                        mutation: Object.freeze({
                            apiGeneration: generation,
                            expectedRevision: mutation.expectedRevision,
                            kind: mutation.kind,
                            nowEpochMs: epoch(
                                mutation.nowEpochMs,
                                'manualResolution.nowEpochMs',
                            ),
                            operation: 'apply_unique_final_evidence',
                            resolutionKey: sha256Digest(
                                mutation.resolutionKey,
                                'manualResolution.resolutionKey',
                            ),
                            runtimeEpochId,
                            senderFence,
                            strategyId: token(
                                mutation.strategyId,
                                'manualResolution.strategyId',
                            ),
                        }),
                    });
                }
                if (mutationKind === 'risk_policy_publish') {
                    assertRuntimeCurrent('risk policy publication');
                    assertLifecycleMutationOpen('risk policy publication');
                    if (riskPolicyMutationPromise || riskPolicyMutationFailed) {
                        throw new Error(
                            'risk policy publication is already pending or failed closed',
                        );
                    }
                    const mutation = snapshotExactOwnData(
                        top.mutation,
                        [
                            'expectedRevision',
                            'kind',
                            'nowEpochMs',
                            'policy',
                        ],
                        'risk policy publication mutation',
                    );
                    if (
                        mutation.expectedRevision !== null &&
                        (!Number.isSafeInteger(mutation.expectedRevision) ||
                            mutation.expectedRevision < 0)
                    ) {
                        throw new TypeError(
                            'risk policy expected revision is invalid',
                        );
                    }
                    const canonicalPolicy =
                        canonicalRuntimeRiskPolicyEditorInput(
                            mutation.policy,
                        );
                    request = Object.freeze({
                        ...top,
                        mutation: Object.freeze({
                            apiGeneration: generation,
                            expectedRevision: mutation.expectedRevision,
                            kind: 'risk_policy_publish',
                            nowEpochMs: epoch(
                                mutation.nowEpochMs,
                                'riskPolicy.nowEpochMs',
                            ),
                            policy: Object.freeze({
                                schemaVersion: canonicalPolicy.schemaVersion,
                                buyFeeBps: canonicalPolicy.buyFeeBps,
                                minimumBuyFeeMinorUnits:
                                    canonicalPolicy.minimumBuyFeeMinorUnits,
                                cashBufferMinorUnits:
                                    canonicalPolicy.cashBufferMinorUnits,
                                accountLimits: canonicalPolicy.accountLimits,
                                identityLimits: canonicalPolicy.identityLimits,
                                accountDailyLossLimitMinorUnits:
                                    canonicalPolicy.accountDailyLossLimitMinorUnits,
                                identityDailyLossLimitMinorUnits:
                                    canonicalPolicy.identityDailyLossLimitMinorUnits,
                            }),
                            runtimeEpochId,
                            senderFence,
                        }),
                    });
                    const pending = repository.request(
                        'executeReplayProtectedStrategyMutation',
                        request,
                    );
                    riskPolicyMutationPromise = pending;
                    try {
                        const result = await pending;
                        assertRuntimeCurrent('risk policy publication');
                        if (result.state === 'completed') {
                            state = result.result.runtimeState;
                            revision = result.result.runtimeRevision;
                        }
                        return result;
                    } catch (error) {
                        if (
                            !['RiskPolicyRevisionError', 'TypeError'].includes(
                                error?.name,
                            )
                        ) {
                            riskPolicyMutationFailed = true;
                        }
                        throw error;
                    } finally {
                        riskPolicyMutationPromise = undefined;
                    }
                }
                if (mutationKind === 'risk_kill_switch') {
                    assertRuntimeCurrent('kill switch mutation');
                    const mutation = snapshotExactOwnData(
                        top.mutation,
                        [
                            'enabled',
                            'expectedArbiterRevision',
                            'kind',
                            'nowEpochMs',
                            'reasonCode',
                            'switchName',
                        ],
                        'kill switch mutation',
                    );
                    if (
                        typeof mutation.enabled !== 'boolean' ||
                        !Number.isSafeInteger(
                            mutation.expectedArbiterRevision,
                        ) ||
                        mutation.expectedArbiterRevision < 0
                    ) {
                        throw new TypeError(
                            'kill switch mutation revision or value is invalid',
                        );
                    }
                    request = Object.freeze({
                        ...top,
                        mutation: Object.freeze({
                            apiGeneration: generation,
                            enabled: mutation.enabled,
                            expectedArbiterRevision:
                                mutation.expectedArbiterRevision,
                            kind: 'risk_kill_switch',
                            nowEpochMs: epoch(
                                mutation.nowEpochMs,
                                'killSwitch.nowEpochMs',
                            ),
                            reasonCode: token(
                                mutation.reasonCode,
                                'killSwitch.reasonCode',
                            ),
                            runtimeEpochId,
                            senderFence,
                            switchName: token(
                                mutation.switchName,
                                'killSwitch.switchName',
                            ),
                        }),
                    });
                    const pending = repository.request(
                        'executeReplayProtectedStrategyMutation',
                        request,
                    );
                    pendingKillSwitchMutations.add(pending);
                    try {
                        const result = await pending;
                        assertRuntimeCurrent('kill switch mutation');
                        if (result.state === 'completed') {
                            cacheKillSwitchProjection(result.result);
                        }
                        return result;
                    } catch (error) {
                        if (
                            ![
                                'KillSwitchArbiterRevisionError',
                                'TypeError',
                            ].includes(error?.name)
                        ) {
                            killSwitchMutationFailed = true;
                        }
                        throw error;
                    } finally {
                        pendingKillSwitchMutations.delete(pending);
                    }
                }
                if (
                    ['create', 'update', 'resume', 'cancel_broker_order', 'copy'].includes(
                        mutationKind,
                    )
                ) {
                    assertLifecycleMutationOpen(
                        'strategy blocker mutation',
                    );
                }
                return repository.request(
                    'executeReplayProtectedStrategyMutation',
                    request,
                );
            },
            async riskPolicy() {
                if (closed) throw new Error('runtime controller is closed');
                return repository.request('runtimeRiskPolicyView', {});
            },
            async consumeAuthority(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertLifecycleMutationOpen('authority consumption');
                return repository.request('consumeAuthority', input);
            },
            async createDraftStrategy(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertLifecycleMutationOpen('strategy creation');
                return repository.request('createDraftStrategy', input);
            },
            async replaceDraftStrategy(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertLifecycleMutationOpen('strategy replacement');
                return repository.request('replaceDraftStrategy', input);
            },
            async prepareProtectedEntry(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertRuntimeCurrent('protected entry preparation');
                assertLifecycleMutationOpen('protected entry preparation');
                if (
                    state !== 'ready' ||
                    pendingKillSwitchMutations.size > 0 ||
                    killSwitchMutationFailed ||
                    riskPolicyMutationPromise ||
                    riskPolicyMutationFailed ||
                    emergencyKillSwitchEnabled()
                ) {
                    const error = new Error(
                        'protected entry preparation requires the current ready runtime',
                    );
                    error.name = 'RuntimeNotReadyError';
                    throw error;
                }
                const admission = snapshotProtectedEntryAdmissionInput(input);
                if (
                    !admission?.protectionCommitment ||
                    !admission?.protectionObligation ||
                    admission?.intent?.operationKind !== 'place' ||
                    admission?.intent?.side !== 'Buy'
                ) {
                    throw new TypeError(
                        'protected entry preparation requires a complete Buy commitment and obligation',
                    );
                }
                const protectedIntent = canonicalProtectedEntryIntentPayload(
                    admission.intent.payload,
                );
                if (
                    protectedIntent.payload.protectionPlan.modeRevision !==
                    generation
                ) {
                    throw new TypeError(
                        'protected entry preparation requires the current API generation',
                    );
                }
                if (
                    !exactInputKeys(admission, [
                        'activation',
                        'intent',
                        'nowEpochMs',
                        'protectionCommitment',
                        'protectionObligation',
                        'reservation',
                        'strategyId',
                    ]) ||
                    !exactInputKeys(admission.activation, [
                        'activationId',
                        'evidenceHash',
                        'generation',
                        'logicalKey',
                    ]) ||
                    !exactInputKeys(admission.intent, [
                        'accountBrokerRef',
                        'accountIdRef',
                        'clientRequestId',
                        'contractKey',
                        'intentId',
                        'operationKind',
                        'ownerKind',
                        'payload',
                        'payloadHash',
                        'side',
                        'tradeDate',
                    ]) ||
                    !exactInputKeys(admission.reservation, [
                        'accountBrokerRef',
                        'accountIdRef',
                        'cashMinorUnits',
                        'identityGroupId',
                        'notionalMinorUnits',
                        'orderCount',
                        'policyHash',
                        'policyRevision',
                        'positionShares',
                        'quantityShares',
                        'reservationId',
                    ]) ||
                    !exactInputKeys(admission.protectionCommitment, [
                        'commitmentId',
                        'committedShares',
                    ]) ||
                    !exactInputKeys(admission.protectionObligation, [
                        'obligationId',
                        'positionLineageId',
                    ])
                ) {
                    throw new TypeError(
                        'protected entry preparation input does not match its exact admission schema',
                    );
                }
                const result = await repository.request('prepareIntent', {
                    ...admission,
                    identityAdmission:
                        authenticatedIdentityGroup.issueAdmission({
                            accountBrokerRef:
                                admission.intent.accountBrokerRef,
                            accountIdRef: admission.intent.accountIdRef,
                            nowEpochMs: admission.nowEpochMs,
                        }),
                    intent: {
                        ...admission.intent,
                        payload: protectedIntent.payload,
                        payloadHash: protectedIntent.payloadSha256,
                    },
                    runtimeEpochId,
                    senderFence,
                    apiGeneration: generation,
                });
                assertRuntimeCurrent('protected entry preparation');
                if (
                    state !== 'ready' ||
                    pendingKillSwitchMutations.size > 0 ||
                    killSwitchMutationFailed ||
                    riskPolicyMutationPromise ||
                    riskPolicyMutationFailed
                ) {
                    const error = new Error(
                        'protected entry preparation lost its current ready runtime',
                    );
                    error.name = 'RuntimeNotReadyError';
                    throw error;
                }
                return result;
            },
            async prepareProtectionOcoWinner(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertRuntimeCurrent('protection OCO winner preparation');
                assertLifecycleMutationOpen('protection OCO winner preparation');
                if (
                    state !== 'ready' ||
                    pendingKillSwitchMutations.size > 0 ||
                    killSwitchMutationFailed ||
                    riskPolicyMutationPromise ||
                    riskPolicyMutationFailed
                ) {
                    const error = new Error(
                        'protection OCO winner requires the current ready runtime',
                    );
                    error.name = 'RuntimeNotReadyError';
                    throw error;
                }
                const top = snapshotExactOwnData(
                    input,
                    ['activation', 'exitClaim', 'intent', 'nowEpochMs', 'strategyId'],
                    'protection OCO winner request',
                );
                const activation = snapshotExactOwnData(
                    top.activation,
                    ['activationId', 'evidenceHash', 'generation', 'logicalKey'],
                    'protection OCO activation',
                );
                const intent = snapshotExactOwnData(
                    top.intent,
                    [
                        'accountBrokerRef',
                        'accountIdRef',
                        'clientRequestId',
                        'contractKey',
                        'intentId',
                        'operationKind',
                        'ownerKind',
                        'payload',
                        'payloadHash',
                        'side',
                        'tradeDate',
                    ],
                    'protection OCO intent',
                );
                const payload =
                    canonicalSmartOrderProtectiveBrokerIntentPayload(
                        intent.payload,
                    ).payload;
                const claim = snapshotExactOwnData(
                    top.exitClaim,
                    [
                        'accountBrokerRef',
                        'accountIdRef',
                        'allocationStartShare',
                        'candidateEvaluations',
                        'contractKey',
                        'evidenceHash',
                        'exitClaimId',
                        'expectedGenerationRevision',
                        'expectedGroupRevision',
                        'expectedRevision',
                        'obligationId',
                        'positionLineageId',
                        'protectionGroupId',
                        'quantityShares',
                        'remainderGeneration',
                    ],
                    'protection OCO claim',
                );
                if (
                    !Array.isArray(claim.candidateEvaluations) ||
                    utilTypes.isProxy(claim.candidateEvaluations)
                ) {
                    throw new TypeError(
                        'protection OCO candidate evaluations are invalid',
                    );
                }
                const candidateEvaluations = claim.candidateEvaluations.map(
                    (candidate, index) =>
                        Object.freeze(
                            snapshotExactOwnData(
                                candidate,
                                ['evidenceHash', 'legId', 'observedAtEpochMs'],
                                `protection OCO candidate[${index}]`,
                            ),
                        ),
                );
                const result = await repository.request('prepareIntent', {
                    activation: Object.freeze(activation),
                    exitClaim: Object.freeze({
                        ...claim,
                        candidateEvaluations: Object.freeze(candidateEvaluations),
                    }),
                    intent: Object.freeze({
                        ...intent,
                        payload: Object.freeze(payload),
                    }),
                    nowEpochMs: epoch(
                        top.nowEpochMs,
                        'prepareProtectionOcoWinner.nowEpochMs',
                    ),
                    strategyId: token(top.strategyId, 'strategyId'),
                    runtimeEpochId,
                    senderFence,
                    apiGeneration: generation,
                });
                assertRuntimeCurrent('protection OCO winner preparation');
                if (
                    state !== 'ready' ||
                    (emergencyKillSwitchEnabled() &&
                        result.entryDisposition !== 'manual_intervention')
                ) {
                    const error = new Error(
                        'protection OCO winner lost its current ready runtime',
                    );
                    error.name = 'RuntimeNotReadyError';
                    throw error;
                }
                return Object.freeze({
                    ...result,
                    brokerWriteAuthority: false,
                });
            },
            async recordQuickQuoteObservation(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertRuntimeCurrent('quick quote observation');
                assertLifecycleMutationOpen('quick quote observation');
                if (state !== 'ready') {
                    const error = new Error(
                        'quick quote observation requires the current ready Runtime',
                    );
                    error.name = 'RuntimeNotReadyError';
                    throw error;
                }
                const top = snapshotExactOwnData(
                    input,
                    ['observation'],
                    'quick quote observation request',
                );
                if (
                    !isTrustedSmartOrderQuickConditionObservation(
                        top.observation,
                    ) ||
                    top.observation.quickConditionEligible !== true
                ) {
                    throw new TypeError(
                        'quick quote observation authority is invalid',
                    );
                }
                const observation = top.observation;
                admitSmartOrderOfficialMarketQuoteObservation(
                    officialMarketCalendarAuthority,
                    observation,
                );
                const admittedAtEpochMs = epoch(
                    Date.now(),
                    'quickQuote.admittedAtEpochMs',
                );
                if (
                    observation.receiveTimeMs > admittedAtEpochMs ||
                    admittedAtEpochMs - observation.receiveTimeMs >
                        SMART_ORDER_QUOTE_FRESHNESS_TTL_MS
                ) {
                    state = 'reconciling';
                    throw new Error(
                        'quick quote observation expired before Runtime admission',
                    );
                }
                try {
                    const result = await repository.request(
                        'recordQuickQuoteObservation',
                        {
                            apiGeneration: generation,
                            nowEpochMs: admittedAtEpochMs,
                            observation: {
                                contractKey: observation.contractKey,
                                disabledFields: observation.disabledFields.map(
                                    (field) => ({
                                        field: field.field,
                                        localUnit: field.localUnit,
                                        mappingDefinitionSha256:
                                            field.mappingDefinitionSha256,
                                        mappingRevision:
                                            field.mappingRevision,
                                        reason: field.reason,
                                    }),
                                ),
                                eventKind: observation.eventKind,
                                exchangeTimeMs: observation.exchangeTimeMs,
                                mappingDefinitionSha256:
                                    observation.mappingDefinitionSha256,
                                mappingRevision: observation.mappingRevision,
                                observationId: observation.observationId,
                                projections: observation.projections.map(
                                    (projection) => ({
                                        field: projection.field,
                                        localUnit: projection.localUnit,
                                        mappingDefinitionSha256:
                                            projection.mappingDefinitionSha256,
                                        mappingRevision:
                                            projection.mappingRevision,
                                        sourceField: projection.sourceField,
                                        sourceKind: projection.sourceKind,
                                        value: projection.value,
                                    }),
                                ),
                                receiveTimeMs: observation.receiveTimeMs,
                                sequence: observation.sequence,
                                streamEpoch: observation.streamEpoch,
                                tradeDate: observation.tradeDate,
                            },
                            runtimeEpochId,
                            senderFence,
                        },
                    );
                    assertRuntimeCurrent('quick quote observation');
                    if (state !== 'ready') {
                        throw new Error(
                            'quick quote observation lost its current ready Runtime',
                        );
                    }
                    return Object.freeze({
                        ...result,
                        brokerWriteAuthority: false,
                    });
                } catch (error) {
                    state = 'reconciling';
                    throw error;
                }
            },
            async recordProtectiveQuoteObservation(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertRuntimeCurrent('protective quote observation');
                assertLifecycleMutationOpen('protective quote observation');
                if (state !== 'ready') {
                    const error = new Error(
                        'protective quote observation requires the current ready Runtime',
                    );
                    error.name = 'RuntimeNotReadyError';
                    throw error;
                }
                const top = snapshotExactOwnData(
                    input,
                    ['observation'],
                    'protective quote observation request',
                );
                if (
                    !isTrustedSmartOrderProtectiveQuoteObservation(
                        top.observation,
                    )
                ) {
                    throw new TypeError(
                        'protective quote observation authority is invalid',
                    );
                }
                const observation = top.observation;
                admitSmartOrderOfficialMarketQuoteObservation(
                    officialMarketCalendarAuthority,
                    observation,
                );
                const admittedAtEpochMs = epoch(
                    Date.now(),
                    'protectiveQuote.admittedAtEpochMs',
                );
                if (
                    observation.receiveTimeMs > admittedAtEpochMs ||
                    admittedAtEpochMs - observation.receiveTimeMs >
                        SMART_ORDER_QUOTE_FRESHNESS_TTL_MS
                ) {
                    state = 'reconciling';
                    throw new Error(
                        'protective quote observation expired before Runtime admission',
                    );
                }
                try {
                    const result = await repository.request(
                        'recordProtectiveQuoteObservation',
                        {
                            apiGeneration: generation,
                            nowEpochMs: admittedAtEpochMs,
                            observation: {
                                contractKey: observation.contractKey,
                                exchangeTimeMs: observation.exchangeTimeMs,
                                field: observation.field,
                                mappingDefinitionSha256:
                                    observation.mappingDefinitionSha256,
                                mappingRevision: observation.mappingRevision,
                                observationId: observation.observationId,
                                receiveTimeMs: observation.receiveTimeMs,
                                sequence: observation.sequence,
                                streamEpoch: observation.streamEpoch,
                                tradeDate: observation.tradeDate,
                                value: observation.value,
                            },
                            runtimeEpochId,
                            senderFence,
                        },
                    );
                    assertRuntimeCurrent('protective quote observation');
                    if (state !== 'ready') {
                        throw new Error(
                            'protective quote observation lost its current ready Runtime',
                        );
                    }
                    return Object.freeze({
                        ...result,
                        brokerWriteAuthority: false,
                    });
                } catch (error) {
                    state = 'reconciling';
                    throw error;
                }
            },
            async recordCanonicalBrokerEvent(input) {
                if (closed) throw new Error('runtime controller is closed');
                // A continuity gap disables dispatch, but broker observations
                // are still required to reconcile the current generation.
                // Generation invalidation remains a hard boundary because the
                // observer belongs to the old managed API process.
                assertGenerationCurrent('canonical broker event ingestion');
                assertLifecycleMutationOpen('canonical broker event ingestion');
                if (!['reconciling', 'ready'].includes(state)) {
                    const error = new Error(
                        'canonical broker event ingestion requires the current Runtime observer',
                    );
                    error.name = 'RuntimeNotReadyError';
                    throw error;
                }
                const admission = snapshotExactOwnData(
                    input,
                    ['event'],
                    'canonical broker event admission',
                );
                if (!isNormalizedCanonicalSmartOrderBrokerEvent(admission.event)) {
                    throw new TypeError(
                        'canonical broker event requires issued normalizer evidence',
                    );
                }
                const eventEvidenceSha256 =
                    admission.event.brokerEventEvidenceSha256;
                // Close the sender synchronously before SQLite correlation or
                // any account HTTP reads. The pending digest is one-way until
                // the exact post-event full reconciliation completes.
                brokerObservationPendingSha256 = eventEvidenceSha256;
                brokerObservationReconciledAccountScopes = new Set();
                brokerObservationPendingMaterializationIntentIds = new Set();
                state = 'reconciling';
                const latched = await repository.request(
                    'beginBrokerEventReconciliation',
                    {
                        runtimeEpochId,
                        senderFence,
                        apiGeneration: generation,
                        eventEvidenceSha256,
                        nowEpochMs:
                            admission.event.timestamps.receiveEpochMs,
                    },
                );
                revision = latched.runtimeRevision;
                const result = await repository.request(
                    'recordCanonicalBrokerEvent',
                    {
                        runtimeEpochId,
                        senderFence,
                        apiGeneration: generation,
                        event: admission.event,
                    },
                );
                assertGenerationCurrent('canonical broker event ingestion');
                if (result.runtimeState === 'reconciling') {
                    state = 'reconciling';
                    if (Number.isSafeInteger(result.runtimeRevision)) {
                        revision = result.runtimeRevision;
                    }
                }
                if (!['reconciling', 'ready'].includes(state)) {
                    const error = new Error(
                        'canonical broker event ingestion lost its current Runtime observer',
                    );
                    error.name = 'RuntimeNotReadyError';
                    throw error;
                }
                return result;
            },
            async recordAccountReconciliation(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertGenerationCurrent('account reconciliation ingestion');
                assertLifecycleMutationOpen('account reconciliation ingestion');
                if (!['reconciling', 'ready'].includes(state)) {
                    const error = new Error(
                        'account reconciliation ingestion requires the current Runtime observer',
                    );
                    error.name = 'RuntimeNotReadyError';
                    throw error;
                }
                const admission = snapshotExactOwnData(
                    input,
                    [
                        'nowEpochMs',
                        'result',
                        'brokerObservationEvidenceSha256',
                    ],
                    'account reconciliation admission',
                );
                const brokerObservationEvidenceSha256 =
                    admission.brokerObservationEvidenceSha256 === null
                        ? null
                        : sha256Digest(
                              admission.brokerObservationEvidenceSha256,
                              'accountReconciliation.brokerObservationEvidenceSha256',
                          );
                if (
                    brokerObservationEvidenceSha256 !==
                    (brokerObservationPendingSha256 ?? null)
                ) {
                    throw new Error(
                        'account reconciliation does not cover the pending broker observation',
                    );
                }
                const reconciliation =
                    currentSmartOrderAccountReconciliationProjection(
                        admission.result,
                    );
                if (!reconciliation || reconciliation.coverageComplete !== true) {
                    throw new TypeError(
                        'account reconciliation requires current complete issued evidence',
                    );
                }
                const result = await repository.request(
                    'recordAccountReconciliation',
                    {
                        runtimeEpochId,
                        senderFence,
                        apiGeneration: generation,
                        nowEpochMs: epoch(
                            admission.nowEpochMs,
                            'accountReconciliation.nowEpochMs',
                        ),
                        expectedFixedAccountCount:
                            authenticatedIdentityGroup.status()
                                .fixedAccountCount,
                        identityAdmission:
                            authenticatedIdentityGroup.issueAdmission({
                                accountBrokerRef:
                                    reconciliation.account.brokerId,
                                accountIdRef:
                                    reconciliation.account.accountId,
                                nowEpochMs: admission.nowEpochMs,
                            }),
                        reconciliation,
                    },
                );
                assertGenerationCurrent('account reconciliation ingestion');
                if (
                    brokerObservationEvidenceSha256 !==
                    (brokerObservationPendingSha256 ?? null)
                ) {
                    throw new Error(
                        'account reconciliation lost its pending broker observation',
                    );
                }
                revision = result.runtimeRevision;
                if (brokerObservationPendingSha256 !== undefined) {
                    brokerObservationReconciledAccountScopes.add(
                        reconciliation.accountScopeSha256,
                    );
                    for (const intentId of
                        result.protectedEntryMaterializationIntentIds) {
                        brokerObservationPendingMaterializationIntentIds.add(
                            intentId,
                        );
                    }
                }
                return result;
            },
            completeBrokerObservationReconciliation(input) {
                if (closed) throw new Error('runtime controller is closed');
                const completion = snapshotExactOwnData(
                    input,
                    ['eventEvidenceSha256'],
                    'broker observation reconciliation completion',
                );
                const eventEvidenceSha256 = sha256Digest(
                    completion.eventEvidenceSha256,
                    'brokerObservationReconciliation.eventEvidenceSha256',
                );
                if (
                    brokerObservationPendingSha256 === undefined ||
                    brokerObservationPendingSha256 !== eventEvidenceSha256
                ) {
                    throw new Error(
                        'broker observation reconciliation completion is stale',
                    );
                }
                const fixedAccountCount =
                    authenticatedIdentityGroup.status().fixedAccountCount;
                if (
                    !Number.isSafeInteger(fixedAccountCount) ||
                    fixedAccountCount < 1 ||
                    brokerObservationReconciledAccountScopes.size !==
                        fixedAccountCount ||
                    brokerObservationPendingMaterializationIntentIds.size !== 0
                ) {
                    throw new Error(
                        'broker observation reconciliation completion is incomplete',
                    );
                }
                brokerObservationPendingSha256 = undefined;
                brokerObservationReconciledAccountScopes = new Set();
                brokerObservationPendingMaterializationIntentIds = new Set();
                return Object.freeze({
                    state,
                    dispatchAllowed: false,
                    brokerWriteAuthority: false,
                });
            },
            async materializeProtectedEntryFill(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertGenerationCurrent('protected entry fill materialization');
                assertLifecycleMutationOpen(
                    'protected entry fill materialization',
                );
                if (
                    !['reconciling', 'ready'].includes(state) ||
                    pendingKillSwitchMutations.size > 0 ||
                    killSwitchMutationFailed ||
                    riskPolicyMutationPromise ||
                    riskPolicyMutationFailed ||
                    emergencyKillSwitchEnabled()
                ) {
                    const error = new Error(
                        'protected entry fill materialization requires the current Runtime observer',
                    );
                    error.name = 'RuntimeNotReadyError';
                    throw error;
                }
                const admission = snapshotExactOwnData(
                    input,
                    [
                        'intentId',
                        'nowEpochMs',
                        'reconciliationResult',
                        'brokerObservationEvidenceSha256',
                    ],
                    'protected entry fill admission',
                );
                const brokerObservationEvidenceSha256 =
                    admission.brokerObservationEvidenceSha256 === null
                        ? null
                        : sha256Digest(
                              admission.brokerObservationEvidenceSha256,
                              'materializeProtectedEntryFill.brokerObservationEvidenceSha256',
                          );
                if (
                    brokerObservationEvidenceSha256 !==
                    (brokerObservationPendingSha256 ?? null)
                ) {
                    throw new Error(
                        'protected entry fill materialization does not cover the pending broker observation',
                    );
                }
                const reconciliation =
                    currentSmartOrderAccountReconciliationProjection(
                        admission.reconciliationResult,
                    );
                if (!reconciliation) {
                    throw new TypeError(
                        'protected entry fill requires current issued reconciliation evidence',
                    );
                }
                const result = await repository.request(
                    'materializeProtectedEntryFill',
                    {
                        runtimeEpochId,
                        senderFence,
                        apiGeneration: generation,
                        intentId: token(
                            admission.intentId,
                            'materializeProtectedEntryFill.intentId',
                        ),
                        nowEpochMs: epoch(
                            admission.nowEpochMs,
                            'materializeProtectedEntryFill.nowEpochMs',
                        ),
                        reconciliation,
                    },
                );
                assertGenerationCurrent('protected entry fill materialization');
                if (
                    brokerObservationEvidenceSha256 !==
                    (brokerObservationPendingSha256 ?? null)
                ) {
                    throw new Error(
                        'protected entry fill materialization lost its pending broker observation',
                    );
                }
                if (result.runtimeState === 'reconciling') {
                    state = 'reconciling';
                    revision = result.runtimeRevision;
                }
                if (
                    ![
                        'waiting_entry_fill',
                        'zero_fill_terminal',
                        'partial',
                        'final',
                    ].includes(result.state)
                ) {
                    throw new Error(
                        `protected entry fill materialization remains reconciliation required: ${String(result.state)}/${String(result.reason ?? 'unspecified')}`,
                    );
                }
                if (brokerObservationEvidenceSha256 !== null) {
                    brokerObservationPendingMaterializationIntentIds.delete(
                        admission.intentId,
                    );
                }
                return result;
            },
            async drainPreparedIntentProvenUnsent(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertLifecycleMutationOpen('prepared intent drain');
                const request = snapshotExactOwnData(
                    input,
                    [
                        'strategyId',
                        'expectedRevision',
                        'operationId',
                        'nowEpochMs',
                    ],
                    'prepared intent drain request',
                );
                const strategyId = token(request.strategyId, 'strategyId');
                const expectedRevision = epoch(
                    request.expectedRevision,
                    'preparedDrain.expectedRevision',
                );
                const operationId = token(
                    request.operationId,
                    'preparedDrain.operationId',
                );
                const nowEpochMs = epoch(
                    request.nowEpochMs,
                    'preparedDrain.nowEpochMs',
                );
                const result = await repository.request(
                    'drainPreparedIntentProvenUnsentByStrategy',
                    {
                        requestId: operationId,
                        strategyId,
                        expectedRevision,
                        nowEpochMs,
                    },
                );
                if (
                    result?.strategyId !== strategyId ||
                    !['cancel_pending', 'cancelled'].includes(
                        result.strategyState,
                    ) ||
                    !Number.isSafeInteger(result.strategyRevision) ||
                    result.strategyRevision < expectedRevision ||
                    result.state !== 'cancelled_proven_unsent' ||
                    result.adapterAuthorityGranted !== false ||
                    result.brokerCallRequired !== false ||
                    result.authorizationConsumed !== true
                ) {
                    throw new Error('prepared intent drain result is invalid');
                }
                return Object.freeze({
                    schemaVersion:
                        'smart-order-prepared-intent-drain-result/2026-08-13.1',
                    strategyId,
                    strategyState: result.strategyState,
                    strategyRevision: result.strategyRevision,
                    preparedIntentState: 'cancelled_proven_unsent',
                    activationState: 'cancelled',
                    reservationReleased: result.reservationState === 'released',
                    protectionReleased:
                        result.protectionObligationState ===
                        'zero_fill_terminal',
                    exitClaimReleased: result.exitClaimState === 'released',
                    rearmSuperseded: result.rearmState === 'superseded',
                    userAuthorityConsumed: true,
                    brokerWriteAttempted: false,
                    brokerAuthorityGranted: false,
                    replayed: result.replayed === true,
                });
            },
            async prepareProtectionRelinquishment(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertLifecycleMutationOpen('protection relinquishment preparation');
                const request = snapshotExactOwnData(
                    input,
                    [
                        'strategyId',
                        'expectedRevision',
                        'operationId',
                        'operatorAcknowledgedManualHandoff',
                        'nowEpochMs',
                    ],
                    'protection relinquishment preparation request',
                );
                if (request.operatorAcknowledgedManualHandoff !== true) {
                    throw new TypeError(
                        'protection relinquishment preparation requires explicit acknowledgement',
                    );
                }
                const strategyId = token(request.strategyId, 'strategyId');
                const expectedRevision = epoch(
                    request.expectedRevision,
                    'relinquishment.expectedRevision',
                );
                const operationId = token(
                    request.operationId,
                    'relinquishment.operationId',
                );
                const nowEpochMs = epoch(
                    request.nowEpochMs,
                    'relinquishment.nowEpochMs',
                );
                const confirmationEvidenceHash = digest(
                    [
                        'smart-order-protection-relinquishment-confirmation/2026-08-13.1',
                        'first',
                        operationId,
                        strategyId,
                        String(expectedRevision),
                        runtimeEpochId,
                        senderFence,
                        generation,
                    ].join('\u001f'),
                );
                return repository.request('prepareProtectionRelinquishment', {
                    requestId: operationId,
                    strategyId,
                    expectedRevision,
                    confirmationEvidenceHash,
                    nowEpochMs,
                });
            },
            async commitProtectionRelinquishment(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertLifecycleMutationOpen('protection relinquishment commit');
                const request = snapshotExactOwnData(
                    input,
                    [
                        'strategyId',
                        'expectedRevision',
                        'operationId',
                        'challengeId',
                        'operatorAcknowledgedManualHandoff',
                        'nowEpochMs',
                    ],
                    'protection relinquishment commit request',
                );
                if (request.operatorAcknowledgedManualHandoff !== true) {
                    throw new TypeError(
                        'protection relinquishment commit requires explicit acknowledgement',
                    );
                }
                const strategyId = token(request.strategyId, 'strategyId');
                const expectedRevision = epoch(
                    request.expectedRevision,
                    'relinquishmentCommit.expectedRevision',
                );
                const operationId = token(
                    request.operationId,
                    'relinquishmentCommit.operationId',
                );
                const challengeId = token(
                    request.challengeId,
                    'relinquishmentCommit.challengeId',
                );
                const nowEpochMs = epoch(
                    request.nowEpochMs,
                    'relinquishmentCommit.nowEpochMs',
                );
                const confirmationEvidenceHash = digest(
                    [
                        'smart-order-protection-relinquishment-confirmation/2026-08-13.1',
                        'second',
                        operationId,
                        challengeId,
                        strategyId,
                        String(expectedRevision),
                        runtimeEpochId,
                        senderFence,
                        generation,
                    ].join('\u001f'),
                );
                return repository.request('commitProtectionRelinquishment', {
                    requestId: operationId,
                    challengeId,
                    strategyId,
                    expectedRevision,
                    confirmationEvidenceHash,
                    operatorAcknowledgedManualHandoff: true,
                    nowEpochMs,
                });
            },
            async listStrategies(input = {}) {
                if (closed) throw new Error('runtime controller is closed');
                return repository.request('listStrategies', input);
            },
            async strategyConfirmationEvidenceContext(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertRuntimeCurrent(
                    'strategy confirmation evidence context',
                );
                const request = snapshotExactOwnData(
                    input,
                    [
                        'accountBrokerRef',
                        'accountIdRef',
                        'expectedRevision',
                        'strategyId',
                    ],
                    'strategy confirmation evidence context request',
                );
                const result = await repository.request(
                    'strategyConfirmationEvidenceContext',
                    {
                        accountBrokerRef: token(
                            request.accountBrokerRef,
                            'accountBrokerRef',
                        ),
                        accountIdRef: token(
                            request.accountIdRef,
                            'accountIdRef',
                        ),
                        expectedRevision: epoch(
                            request.expectedRevision,
                            'expectedRevision',
                        ),
                        strategyId: token(
                            request.strategyId,
                            'strategyId',
                        ),
                        runtimeEpochId,
                        senderFence,
                        apiGeneration: generation,
                    },
                );
                assertRuntimeCurrent(
                    'strategy confirmation evidence context',
                );
                return result;
            },
            async strategyProtectionRearmEvidenceContext(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertRuntimeCurrent(
                    'strategy protection re-arm evidence context',
                );
                const request = snapshotExactOwnData(
                    input,
                    [
                        'controlPlaneAuthority',
                        'expectedRevision',
                        'strategyId',
                    ],
                    'strategy protection re-arm evidence context request',
                );
                if (
                    strategyConfirmationControlPlaneAuthority === null ||
                    request.controlPlaneAuthority !==
                        strategyConfirmationControlPlaneAuthority
                ) {
                    throw new TypeError(
                        'strategy protection re-arm evidence context authority is invalid',
                    );
                }
                const result = await repository.request(
                    'strategyProtectionRearmEvidenceContext',
                    {
                        apiGeneration: generation,
                        expectedRevision: epoch(
                            request.expectedRevision,
                            'expectedRevision',
                        ),
                        runtimeEpochId,
                        senderFence,
                        strategyId: token(
                            request.strategyId,
                            'strategyId',
                        ),
                    },
                );
                assertRuntimeCurrent(
                    'strategy protection re-arm evidence context',
                );
                return result;
            },
            async listProtectiveQuoteDemands() {
                if (closed) throw new Error('runtime controller is closed');
                assertRuntimeCurrent('protective quote demand projection');
                const result = await repository.request(
                    'listProtectiveQuoteDemands',
                    {
                        runtimeEpochId,
                        senderFence,
                        apiGeneration: generation,
                    },
                );
                assertRuntimeCurrent('protective quote demand projection');
                return result;
            },
            async listSmartOrderQuoteDemands() {
                if (closed) throw new Error('runtime controller is closed');
                assertRuntimeCurrent('smart-order quote demand projection');
                const result = await repository.request(
                    'listSmartOrderQuoteDemands',
                    {
                        runtimeEpochId,
                        senderFence,
                        apiGeneration: generation,
                    },
                );
                assertRuntimeCurrent('smart-order quote demand projection');
                return result;
            },
            async listGoodTillConfirmationRenewalContexts() {
                if (closed) throw new Error('runtime controller is closed');
                assertRuntimeCurrent('good-till confirmation renewal projection');
                const result = await repository.request(
                    'listGoodTillConfirmationRenewalContexts',
                    {
                        runtimeEpochId,
                        senderFence,
                        apiGeneration: generation,
                    },
                );
                assertRuntimeCurrent('good-till confirmation renewal projection');
                return result;
            },
            async refreshGoodTillConfirmationEvidence(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertRuntimeCurrent('good-till confirmation renewal');
                const current = snapshotExactOwnData(
                    input,
                    [
                        'monitorContractEvidence',
                        'orderContractEvidence',
                        'snapshotHash',
                        'strategyId',
                    ],
                    'good-till confirmation renewal',
                );
                if (
                    !isVerifiedSmartOrderCanonicalContractEvidence(
                        current.orderContractEvidence,
                    ) ||
                    !isVerifiedSmartOrderCanonicalContractEvidence(
                        current.monitorContractEvidence,
                    )
                ) {
                    throw new TypeError(
                        'good-till confirmation renewal evidence is not issued',
                    );
                }
                const result = await repository.request(
                    'refreshGoodTillConfirmationEvidence',
                    {
                        apiGeneration: generation,
                        monitorContractEvidence:
                            snapshotCanonicalContractEvidence(
                                current.monitorContractEvidence,
                                'good-till monitor contract renewal evidence',
                            ),
                        nowEpochMs: Date.now(),
                        orderContractEvidence:
                            snapshotCanonicalContractEvidence(
                                current.orderContractEvidence,
                                'good-till order contract renewal evidence',
                            ),
                        runtimeEpochId,
                        senderFence,
                        snapshotHash: sha256Digest(
                            current.snapshotHash,
                            'goodTillRenewal.snapshotHash',
                        ),
                        strategyId: token(
                            current.strategyId,
                            'goodTillRenewal.strategyId',
                        ),
                    },
                );
                assertRuntimeCurrent('good-till confirmation renewal');
                return result;
            },
            async listMultiConditionConfirmationRenewalContexts() {
                if (closed) throw new Error('runtime controller is closed');
                assertRuntimeCurrent(
                    'multi-condition confirmation renewal projection',
                );
                const result = await repository.request(
                    'listMultiConditionConfirmationRenewalContexts',
                    { runtimeEpochId, senderFence, apiGeneration: generation },
                );
                assertRuntimeCurrent(
                    'multi-condition confirmation renewal projection',
                );
                return result;
            },
            async refreshMultiConditionConfirmationEvidence(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertRuntimeCurrent('multi-condition confirmation renewal');
                const current = snapshotExactOwnData(
                    input,
                    [
                        'monitorContractEvidence',
                        'orderContractEvidence',
                        'snapshotHash',
                        'strategyId',
                    ],
                    'multi-condition confirmation renewal',
                );
                if (
                    !isVerifiedSmartOrderCanonicalContractEvidence(
                        current.orderContractEvidence,
                    )
                ) {
                    throw new TypeError(
                        'multi-condition order renewal evidence is not issued',
                    );
                }
                const monitorEvidence = snapshotCanonicalContractEvidenceList(
                    current.monitorContractEvidence,
                    'multi-condition monitor renewal evidence',
                );
                const result = await repository.request(
                    'refreshMultiConditionConfirmationEvidence',
                    {
                        apiGeneration: generation,
                        monitorContractEvidence: monitorEvidence,
                        nowEpochMs: Date.now(),
                        orderContractEvidence:
                            snapshotCanonicalContractEvidence(
                                current.orderContractEvidence,
                                'multi-condition order renewal evidence',
                            ),
                        runtimeEpochId,
                        senderFence,
                        snapshotHash: sha256Digest(
                            current.snapshotHash,
                            'multiConditionRenewal.snapshotHash',
                        ),
                        strategyId: token(
                            current.strategyId,
                            'multiConditionRenewal.strategyId',
                        ),
                    },
                );
                assertRuntimeCurrent('multi-condition confirmation renewal');
                return result;
            },
            async listManualResolutionCases(input) {
                if (closed) throw new Error('runtime controller is closed');
                const request = snapshotExactOwnData(
                    input,
                    ['strategyId'],
                    'manual resolution list request',
                );
                return repository.request('listManualResolutionCases', {
                    strategyId: token(
                        request.strategyId,
                        'manualResolution.strategyId',
                    ),
                });
            },
            async listHistory(input = {}) {
                if (closed) throw new Error('runtime controller is closed');
                return repository.request('listHistory', input);
            },
            async listEvents(input = {}) {
                if (closed) throw new Error('runtime controller is closed');
                return repository.request('listEvents', input);
            },
            async getStrategy(input) {
                if (closed) throw new Error('runtime controller is closed');
                return repository.request('getStrategy', input);
            },
            async pauseStrategy(input) {
                if (closed) throw new Error('runtime controller is closed');
                return repository.request('pauseStrategy', input);
            },
            async resumeStrategy() {
                if (closed) throw new Error('runtime controller is closed');
                throw new Error(
                    'strategy resume requires replay-protected current user-arm admission',
                );
            },
            async requestStrategyCancellation(input) {
                if (closed) throw new Error('runtime controller is closed');
                return repository.request('requestStrategyCancellation', input);
            },
            async copyStrategyToDraft(input) {
                if (closed) throw new Error('runtime controller is closed');
                assertLifecycleMutationOpen('strategy copy');
                return repository.request('copyStrategyToDraft', input);
            },
            commitLifecycleStop,
            releaseStoppedRuntime,
            async stop(input) {
                if (stopResult) return stopResult;
                if (closed) return undefined;
                const committed = await commitLifecycleStop(input);
                await releaseStoppedRuntime();
                stopResult = Object.freeze({
                    state: committed.state,
                    revision: committed.revision,
                    operation: committed.operation,
                    dispatchAllowed: false,
                });
                return stopResult;
            },
        });
        ISSUED_PRIMARY_CONTROLLERS.add(controller);
        return controller;
    } catch (error) {
        await repository?.close().catch(() => {});
        authenticatedIdentityGroup?.close();
        officialMarketCalendarAuthority.close();
        if (ownsRuntimeResourceCoordinator) {
            runtimeResourceCoordinator?.close();
        }
        await lease.close().catch(() => {});
        await removeEmptyLeaseDirectory(storage.paths.runtimeLeaseDirectory).catch(
            () => {},
        );
        throw error;
    }
}
