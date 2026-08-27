import { createHash, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from './canonical-json.mjs';
import { verifySmartOrderGateProbeCliAuthorization } from './gate-probe-cli-authorization.mjs';
import { runSmartOrderGateProbeCli } from './gate-probe-cli.mjs';
import { resolveExpectedManagedApiRepositoryRoot } from './installed-managed-api-binding.mjs';
import { createSmartOrderModeWriteAdmission } from './mode-write-admission.mjs';
import { smartOrderModeExecutionLeaseDirectoryForAppSupportRoot } from './mode-execution-lease.mjs';
import { withNodeSafeBrokerAccountLock } from './node-safe-broker-target.mjs';
import { readPrivateRuntimeDiscovery, readPrivateSecret } from './private-storage.mjs';
import { createSmartOrderResourceCoordinator } from './resource-coordinator.mjs';
import {
    SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
    assertSmartOrderTaskProbePinnedPriceCurrent,
    buildSmartOrderTaskProbeMarketPlan,
} from './task-probe-market-plan.mjs';
import { openTaskProbePinnedTransport } from './task-probe-pinned-transport.mjs';
import {
    consumeSmartOrderTaskProbeReadonlyAuthority,
    runSmartOrderTaskProbeReadonlyPreflight,
} from './task-probe-readonly-preflight.mjs';
import {
    SMART_ORDER_TASK_PROBE_WRITE_PREFLIGHT_SCHEMA_VERSION,
    createTaskProbeWritePreflightEvidence,
    currentTaskProbeWriteSourceFingerprint,
    readTaskProbeWritePreflightReceipt,
    verifyTaskProbeWritePreflightEvidence,
    writeTaskProbeWritePreflightEvidence,
} from './task-probe-write-preflight.mjs';
import {
    createSmartOrderTask13_2FormalEvidence,
    currentSmartOrderTask13_2EvidenceSourceFingerprint,
    currentSmartOrderTask13_2VerifierFingerprint,
    verifySmartOrderTask13_2FormalEvidence,
} from './task13-2-formal-evidence.mjs';
import { readOrCreateSmartOrderTask13_2EvidenceCapability } from './task13-2-evidence-capability.mjs';
import {
    SMART_ORDER_TASK_13_3_FORMAL_EVIDENCE_SCHEMA_VERSION,
    createSmartOrderTask13_3FormalEvidence,
    currentSmartOrderTask13_3SourceFingerprint,
    currentSmartOrderTask13_3VerifierFingerprint,
    verifySmartOrderTask13_3FormalEvidence,
} from './task13-3-formal-evidence.mjs';
import { SMART_ORDER_TASK_0_4_0_6_PROFILES } from './task0-4-0-6-operation-contract.mjs';
import { consumePreparedSmartOrderTask0406Operation } from './task0-4-0-6-operation-preparer.mjs';
import {
    createSmartOrderTask0406ResultEvidence,
    projectSmartOrderTask0406PlaceResponse,
    smartOrderTask0406ResultFailureReason,
} from './task0-4-0-6-result-evidence.mjs';
import { isIssuedSmartOrderTask0406LiveObserver } from './task0-4-0-6-live-observer.mjs';

export const SMART_ORDER_TASK_0_4_0_6_OPERATION_EXECUTOR_SCHEMA_VERSION =
    'smart-order-task-0.4-0.6-operation-executor/2026-08-26.1';

const MAX_JSON_BYTES = 2 * 1024 * 1024;
const FORMAL_FILE_BY_PROFILE = Object.freeze({
    round_trip_lmt_ioc: Object.freeze({
        taskId: '0.4',
        operationKey: 'order_deal_round_trip',
        fileStem: 'task13-2-formal-0.4-order-deal-round-trip',
    }),
    lmt_rod_fill: Object.freeze({
        taskId: '0.6',
        operationKey: 'lmt_rod',
        fileStem: 'task13-2-formal-0.6-lmt-rod',
    }),
    lmt_ioc_zero_fill: Object.freeze({
        taskId: '0.6',
        operationKey: 'lmt_ioc',
        fileStem: 'task13-2-formal-0.6-lmt-ioc',
    }),
    mkt_ioc_fill: Object.freeze({
        taskId: '0.6',
        operationKey: 'mkt_ioc',
        fileStem: 'task13-2-formal-0.6-mkt-ioc',
    }),
    protected_entry_lmt_ioc: Object.freeze({
        taskId: '13.3',
        operationKey: 'protected_entry_lmt_ioc',
        fileStem: 'task13-3-formal-protected-entry-lmt-ioc',
    }),
    protected_exit_working_lmt_rod: Object.freeze({
        taskId: '13.3',
        operationKey: 'protected_exit_working_lmt_rod',
        fileStem: 'task13-3-formal-protected-exit-working-lmt-rod',
    }),
    protected_exit_marketable_lmt_ioc: Object.freeze({
        taskId: '13.3',
        operationKey: 'protected_exit_marketable_lmt_ioc',
        fileStem: 'task13-3-formal-protected-exit-marketable-lmt-ioc',
    }),
    protected_exit_ioc_unfilled: Object.freeze({
        taskId: '13.3',
        operationKey: 'protected_exit_ioc_unfilled',
        fileStem: 'task13-3-formal-protected-exit-ioc-unfilled',
    }),
});

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function smartOrderTask0406FormalEvidenceFileName({
    profile,
    runId,
    operationId,
}) {
    const formal = FORMAL_FILE_BY_PROFILE[profile];
    if (
        !formal ||
        typeof runId !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(runId) ||
        typeof operationId !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(operationId)
    ) {
        throw new TypeError('Task 0.4/0.6 formal evidence scope is invalid');
    }
    return formal.taskId === '13.3'
        ? `${formal.fileStem}.json`
        : `${formal.fileStem}-${runId.toLowerCase()}-${operationId.toLowerCase()}.json`;
}

function safeFailureReason(error) {
    const message = String(error?.message ?? '');
    if (message.includes('readonly source drifted')) return 'readonly_source_drift';
    if (message.includes('snapshot is stale')) return 'market_snapshot_stale';
    if (message.includes('preflight is stale')) return 'readonly_preflight_stale';
    if (message.includes('market plan drifted')) return 'authorization_market_drift';
    if (message.includes('observer')) return 'observer_not_current';
    if (message.includes('source fingerprint')) return 'source_fingerprint_drift';
    if (message.includes('mode') || message.includes('generation')) {
        return 'runtime_generation_drift';
    }
    return 'executor_fail_closed';
}

function parseBrokerResponse(response) {
    if (response?.statusCode !== 200 || !Buffer.isBuffer(response?.bodyBytes)) {
        response?.bodyBytes?.fill?.(0);
        throw new Error('Task 0.4/0.6 broker response status is unknown');
    }
    const contentType = String(response.headers?.['content-type'] ?? '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
    if (contentType !== 'application/json' || response.bodyBytes.byteLength > MAX_JSON_BYTES) {
        response.bodyBytes.fill(0);
        throw new Error('Task 0.4/0.6 broker response type is unknown');
    }
    try {
        return JSON.parse(response.bodyBytes.toString('utf8'));
    } finally {
        response.bodyBytes.fill(0);
    }
}

async function requestTrades({ account, beforeRequest }) {
    await beforeRequest();
    const url = 'http://127.0.0.1:8080/api/v1/order/trades';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
        const response = await globalThis.fetch(url, {
            method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify(account),
            redirect: 'error',
            cache: 'no-store',
            signal: controller.signal,
        });
        if (!response || response.url !== url || response.redirected || !response.ok) {
            throw new Error('Task 0.4/0.6 readonly reconciliation failed');
        }
        const text = await response.text();
        if (Buffer.byteLength(text) > MAX_JSON_BYTES) {
            throw new Error('Task 0.4/0.6 readonly reconciliation is oversized');
        }
        return JSON.parse(text);
    } finally {
        clearTimeout(timer);
    }
}

function samePlanCritical(left, right) {
    return [
        'taskId',
        'runId',
        'operation',
        'purpose',
        'contractKey',
        'side',
        'priceType',
        'timeInForce',
        'quantityCommonLots',
        'accountScopeSha256',
        'tradeDate',
        'sourceFingerprintSha256',
        'apiGenerationSha256',
        'contractEvidenceSha256',
        'positionsSha256',
        'workingOrdersSha256',
    ].every((key) => left[key] === right[key]);
}

async function writeFormalEvidence({
    capability,
    privateDirectory,
    prepared,
    resultSha256,
    nowEpochMs,
}) {
    const formal = FORMAL_FILE_BY_PROFILE[prepared.profile];
    if (formal.taskId === '13.3') {
        const [sourceFingerprintSha256, verifierFingerprintSha256] =
            await Promise.all([
                currentSmartOrderTask13_3SourceFingerprint(),
                currentSmartOrderTask13_3VerifierFingerprint(),
            ]);
        const evidence = createSmartOrderTask13_3FormalEvidence({
            capability,
            input: Object.freeze({
                schemaVersion:
                    SMART_ORDER_TASK_13_3_FORMAL_EVIDENCE_SCHEMA_VERSION,
                evidenceId: randomUUID(),
                profile: prepared.profile,
                runId: prepared.marketPlan.runId,
                operationId:
                    prepared.operationContract.canonical.envelope.operationId,
                observedTradeDate: prepared.marketPlan.tradeDate,
                accountScopeSha256: prepared.marketPlan.accountScopeSha256,
                apiGenerationSha256: prepared.marketPlan.apiGenerationSha256,
                sourceFingerprintSha256,
                verifierFingerprintSha256,
                requestSha256:
                    prepared.operationContract.canonical.envelope.requestSha256,
                resultSha256,
                authorizedPrice: prepared.marketPlan.price,
                side: prepared.marketPlan.side,
                expectedOutcome: prepared.policy.expectedOutcome,
                generatedAtEpochMs: nowEpochMs,
                formalEvidence: true,
                fixture: false,
                brokerWriteAttempted: true,
                brokerWriteNetworked: true,
                automaticRetryAllowed: false,
                blindCleanupAllowed: false,
                accountIdentifiersPersisted: false,
            }),
        });
        if (
            verifySmartOrderTask13_3FormalEvidence({
                capability,
                evidence,
                expectedSourceFingerprintSha256: sourceFingerprintSha256,
                expectedVerifierFingerprintSha256: verifierFingerprintSha256,
            }).eligible !== true
        ) {
            throw new Error('Task 13.3 formal evidence verification failed');
        }
        await writeTaskProbeWritePreflightEvidence({
            evidencePath: path.join(
                privateDirectory,
                smartOrderTask0406FormalEvidenceFileName({
                    profile: prepared.profile,
                    runId: prepared.marketPlan.runId,
                    operationId:
                        prepared.operationContract.canonical.envelope.operationId,
                }),
            ),
            evidence,
        });
        return sha256(canonicalJson(evidence));
    }
    const evidenceKey = `${formal.taskId}:${formal.operationKey}`;
    const sourceFingerprintSha256 =
        await currentSmartOrderTask13_2EvidenceSourceFingerprint(evidenceKey);
    const verifierFingerprintSha256 =
        await currentSmartOrderTask13_2VerifierFingerprint();
    const evidence = createSmartOrderTask13_2FormalEvidence({
        capability,
        input: Object.freeze({
            schemaVersion: 'smart-order-task13.2-formal-evidence/2026-08-24.1',
            evidenceId: randomUUID(),
            taskId: formal.taskId,
            operationKey: formal.operationKey,
            runId: prepared.marketPlan.runId,
            observedTradeDate: prepared.marketPlan.tradeDate,
            accountScopeSha256: prepared.marketPlan.accountScopeSha256,
            apiGenerationSha256: prepared.marketPlan.apiGenerationSha256,
            sourceFingerprintSha256:
                sourceFingerprintSha256,
            verifierFingerprintSha256,
            requestSha256:
                prepared.operationContract.canonical.envelope.requestSha256,
            resultSha256,
            targetIdSha256: null,
            quantityCommonLots: 1,
            generatedAtEpochMs: nowEpochMs,
            validUntilEpochMs: null,
            formalEvidence: true,
            fixture: false,
            brokerWriteAttempted: true,
            brokerWriteNetworked: true,
            automaticRetryAllowed: false,
            blindCleanupAllowed: false,
            accountIdentifiersPersisted: false,
        }),
    });
    if (
        verifySmartOrderTask13_2FormalEvidence({
            capability,
            evidence,
            expectedSourceFingerprintSha256: sourceFingerprintSha256,
            expectedVerifierFingerprintSha256: verifierFingerprintSha256,
        }).eligible !== true
    ) {
        throw new Error('Task 0.4/0.6 formal evidence verification failed');
    }
    await writeTaskProbeWritePreflightEvidence({
        evidencePath: path.join(
            privateDirectory,
            smartOrderTask0406FormalEvidenceFileName({
                profile: prepared.profile,
                runId: prepared.marketPlan.runId,
                operationId:
                    prepared.operationContract.canonical.envelope.operationId,
            }),
        ),
        evidence,
    });
    return sha256(canonicalJson(evidence));
}

export async function executePreparedSmartOrderTask0406Operation({
    appSupportRoot,
    expectedApiGeneration,
    now = () => Date.now(),
    preparedAuthority,
}) {
    if (
        typeof appSupportRoot !== 'string' ||
        !path.isAbsolute(appSupportRoot) ||
        (await realpath(appSupportRoot)) !== appSupportRoot
    ) {
        throw new TypeError('Task 0.4/0.6 executor root is invalid');
    }
    const prepared = consumePreparedSmartOrderTask0406Operation({
        preparedAuthority,
        nowEpochMs: now(),
    });
    if (
        !isIssuedSmartOrderTask0406LiveObserver(prepared.observer) ||
        prepared.observer.accountScopeSha256 !== prepared.marketPlan.accountScopeSha256
    ) {
        throw new Error('Task 0.4/0.6 observer capability is not exact');
    }
    return withNodeSafeBrokerAccountLock(
        Object.freeze({
            brokerId: prepared.account.broker_id,
            accountId: prepared.account.account_id,
            accountType: 'S',
        }),
        async () => {
            const canonical = prepared.operationContract.canonical;
            const operationId = canonical.envelope.operationId;
            const privateDirectory = path.join(appSupportRoot, 'smart-order', 'private');
            if ((await realpath(privateDirectory)) !== privateDirectory) {
                throw new Error('Task 0.4/0.6 private directory is not canonical');
            }
            const resourceCoordinator = createSmartOrderResourceCoordinator();
            const admission = createSmartOrderModeWriteAdmission({
                appSupportRoot,
                expectedApiGeneration,
                expectedRepositoryRoot: resolveExpectedManagedApiRepositoryRoot(),
                leaseDirectory: smartOrderModeExecutionLeaseDirectoryForAppSupportRoot(
                    appSupportRoot,
                ),
                resourceCoordinator,
            });
            let modeLease;
            let operationGranted = false;
            let ledgerDurable = false;
            let outcomeDurable = false;
            let transport;
            let stage = 'mode_admission';
            try {
                modeLease = await admission.acquire();
                stage = 'resource_admission';
                const grant = await resourceCoordinator.acquireOperation({
                    operationId,
                    kind: 'new_exposure',
                });
                if (grant.allowed !== true) throw new Error('Task 0.4/0.6 resource grant denied');
                operationGranted = true;
                stage = 'initial_observer_liveness';
                const initialObserver = await prepared.observer.revalidateReady({
                    minimumRemainingMs: 15_000,
                });
                stage = 'cli_authorization';
                const interactive = await runSmartOrderGateProbeCli({
                    envelope: canonical.sourceEnvelope,
                    appSupportRoot,
                    expectedApiGeneration,
                    returnAuthorizationOnly: true,
                    authorizationDeadlineEpochMs: Math.min(
                        canonical.envelope.validUntilEpochMs,
                        initialObserver.observerDeadlineEpochMs,
                    ),
                    now,
                });
                const discovery = await readPrivateRuntimeDiscovery(
                    path.join(appSupportRoot, 'smart-order', 'run', 'control-plane.json'),
                    { nowEpochMs: now() },
                );
                const capabilityPath = path.join(
                    privateDirectory,
                    'gate-probe-cli-capability.bin',
                );
                const capability = await readPrivateSecret(capabilityPath);
                let cliEvidence;
                try {
                    cliEvidence = verifySmartOrderGateProbeCliAuthorization({
                        capability,
                        envelope: canonical.sourceEnvelope,
                        authorization: interactive.authorization,
                        nowEpochMs: now(),
                        expectedApiGenerationSha256: sha256(expectedApiGeneration),
                        expectedRuntimeEpochIdSha256: sha256(discovery.runtimeEpochId),
                    });
                } finally {
                    capability.fill(0);
                }
                const beforeRequest = async () => {
                    await resourceCoordinator.acquireOperationUnit({ operationId });
                };
                stage = 'authorization_adjacent_readonly';
                const adjacentReadonly = await runSmartOrderTaskProbeReadonlyPreflight({
                    appSupportRoot,
                    contractScope: prepared.contractScope,
                    expectedApiGeneration,
                    observerReadiness: Object.freeze({
                        accountScopeSha256: prepared.observer.accountScopeSha256,
                        current: true,
                        evidenceSha256: prepared.observer.evidenceSha256,
                        validUntilEpochMs: prepared.observer.validUntilEpochMs,
                    }),
                    beforeRequest,
                    now,
                });
                const adjacentPrivate = consumeSmartOrderTaskProbeReadonlyAuthority(
                    adjacentReadonly.authority,
                );
                const policy = SMART_ORDER_TASK_0_4_0_6_PROFILES[prepared.profile];
                const adjacentPlan = buildSmartOrderTaskProbeMarketPlan({
                    schemaVersion: SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
                    taskId: policy.taskId,
                    runId: prepared.marketPlan.runId,
                    operation: 'place',
                    purpose: policy.purpose,
                    side: policy.side,
                    priceType: policy.priceType,
                    timeInForce: policy.timeInForce,
                    priceOrdinal: policy.priceOrdinal,
                    quantityCommonLots: 1,
                    accountScopeSha256: adjacentReadonly.projection.accountScopeSha256,
                    tradeDate: adjacentReadonly.projection.tradeDate,
                    sourceFingerprintSha256:
                        adjacentReadonly.projection.sourceFingerprintSha256,
                    apiGenerationSha256:
                        adjacentReadonly.projection.apiGenerationSha256,
                    positionsSha256: adjacentReadonly.projection.positionsSha256,
                    workingOrdersSha256:
                        adjacentReadonly.projection.workingOrdersSha256,
                    nowEpochMs: now(),
                    target: null,
                    contract: adjacentReadonly.projection.contract,
                    quote: adjacentReadonly.projection.quote,
                }).plan;
                if (!samePlanCritical(prepared.marketPlan, adjacentPlan)) {
                    throw new Error('Task 0.4/0.6 exact market plan drifted during authorization');
                }
                assertSmartOrderTaskProbePinnedPriceCurrent({
                    plan: prepared.marketPlan,
                    contract: adjacentReadonly.projection.contract,
                    quote: adjacentReadonly.projection.quote,
                });
                stage = 'pinned_transport';
                transport = await openTaskProbePinnedTransport();
                const finalObserver = await prepared.observer.revalidateReady({
                    minimumRemainingMs: 7_000,
                });
                if (
                    finalObserver.observerDeadlineEpochMs !==
                    initialObserver.observerDeadlineEpochMs
                ) {
                    throw new Error('Task 0.4/0.6 observer generation drifted');
                }
                const adjacent = await modeLease.revalidate({ operationId });
                stage = 'write_preflight_evidence';
                if (
                    adjacent.current !== true ||
                    adjacent.simulation !== true ||
                    adjacent.caLoaded !== false ||
                    adjacent.productionLoaded !== false ||
                    adjacent.apiGeneration !== expectedApiGeneration ||
                    (await currentTaskProbeWriteSourceFingerprint()) !==
                        prepared.marketPlan.sourceFingerprintSha256
                ) {
                    throw new Error('Task 0.4/0.6 write-adjacent authority drifted');
                }
                const evidenceCapability = await readPrivateSecret(capabilityPath);
                let receipt;
                try {
                    const evidenceInput = Object.freeze({
                        schemaVersion: SMART_ORDER_TASK_PROBE_WRITE_PREFLIGHT_SCHEMA_VERSION,
                        sourceFingerprintSha256: prepared.marketPlan.sourceFingerprintSha256,
                        createdAtEpochMs: now(),
                        validUntilEpochMs: Math.min(
                            now() + 5_000,
                            canonical.envelope.validUntilEpochMs,
                        ),
                        coordinationId: operationId,
                        runId: prepared.marketPlan.runId,
                        operationIdSha256: sha256(operationId),
                        operation: 'place',
                        requestSha256: canonical.envelope.requestSha256,
                        envelopeSha256: canonical.envelopeSha256,
                        marketPlanSha256: prepared.marketPlanSha256,
                        cliAuthorizationSha256: cliEvidence.cliAuthorizationSha256,
                        accountScopeSha256: prepared.marketPlan.accountScopeSha256,
                        tradeDate: prepared.marketPlan.tradeDate,
                        targetIdSha256: null,
                        targetRevision: null,
                        apiGenerationSha256: sha256(expectedApiGeneration),
                        modeExecutionLeaseEvidenceSha256:
                            modeLease.modeExecutionLeaseEvidenceHash,
                        initialSimulationAttestationSha256:
                            modeLease.initialSimulationAttestationSha256,
                        adjacentSimulationAttestationSha256:
                            adjacent.simulationAttestationSha256,
                        observerReadinessSha256:
                            adjacentReadonly.projection.observerReadinessSha256,
                        contractEvidenceSha256:
                            adjacentReadonly.projection.contract.evidenceSha256,
                        quoteEvidenceSha256:
                            adjacentReadonly.projection.quote.evidenceSha256,
                        positionsSha256: adjacentReadonly.projection.positionsSha256,
                        workingOrdersSha256:
                            adjacentReadonly.projection.workingOrdersSha256,
                        quantityCommonLots: 1,
                        modeMarker: 'simulation',
                        apiSimulation: true,
                        sharedModeLeaseHeld: true,
                        observerReady: true,
                        caLoaded: false,
                        productionLoaded: false,
                        automaticRetryAllowed: false,
                        blindCleanupAllowed: false,
                        brokerWriteAttempted: false,
                        brokerWriteNetworked: false,
                        accountIdentifiersPersisted: false,
                    });
                    const evidence = createTaskProbeWritePreflightEvidence({
                        capability: evidenceCapability,
                        input: evidenceInput,
                    });
                    const expected = Object.freeze({
                        accountScopeSha256: evidenceInput.accountScopeSha256,
                        apiGenerationSha256: evidenceInput.apiGenerationSha256,
                        coordinationId: operationId,
                        envelopeSha256: evidenceInput.envelopeSha256,
                        marketPlanSha256: evidenceInput.marketPlanSha256,
                        operation: 'place',
                        operationIdSha256: evidenceInput.operationIdSha256,
                        requestSha256: evidenceInput.requestSha256,
                        runId: evidenceInput.runId,
                        sourceFingerprintSha256: evidenceInput.sourceFingerprintSha256,
                        targetIdSha256: null,
                        targetRevision: null,
                    });
                    if (
                        verifyTaskProbeWritePreflightEvidence({
                            capability: evidenceCapability,
                            evidence,
                            expected,
                            nowEpochMs: now(),
                        }).eligible !== true
                    ) {
                        throw new Error('Task 0.4/0.6 write evidence verification failed');
                    }
                    const evidencePath = path.join(
                        privateDirectory,
                        `task0-4-0-6-preflight-${operationId}.json`,
                    );
                    await writeTaskProbeWritePreflightEvidence({ evidence, evidencePath });
                    receipt = (
                        await readTaskProbeWritePreflightReceipt({
                            capability: evidenceCapability,
                            evidencePath,
                            expected,
                            nowEpochMs: now(),
                        })
                    ).receipt;
                } finally {
                    evidenceCapability.fill(0);
                }
                const ledgerPath = path.join(
                    privateDirectory,
                    `task0-4-0-6-dispatch-${operationId}.json`,
                );
                const resultPath = path.join(
                    privateDirectory,
                    `task0-4-0-6-result-${operationId}.json`,
                );
                await writeTaskProbeWritePreflightEvidence({
                    evidencePath: ledgerPath,
                    evidence: {
                        schemaVersion:
                            SMART_ORDER_TASK_0_4_0_6_OPERATION_EXECUTOR_SCHEMA_VERSION,
                        state: 'dispatching_unknown_no_retry',
                        taskId: policy.taskId,
                        profile: prepared.profile,
                        coordinationId: operationId,
                        runId: prepared.marketPlan.runId,
                        requestSha256: canonical.envelope.requestSha256,
                        envelopeSha256: canonical.envelopeSha256,
                        marketPlanSha256: prepared.marketPlanSha256,
                        automaticRetryAllowed: false,
                        blindCleanupAllowed: false,
                        brokerWriteAttempted: true,
                        brokerWriteNetworked: true,
                        accountIdentifiersPersisted: false,
                    },
                });
                ledgerDurable = true;
                const dispatch = resourceCoordinator.markOperationDispatching({ operationId });
                if (dispatch.allowed !== true) {
                    throw new Error('Task 0.4/0.6 dispatch phase was not admitted');
                }
                const eventBoundary = prepared.observer.markDispatchBoundary();
                let state = 'unknown_manual_reconciliation_required';
                let reasonCode = 'broker_result_unknown';
                let resultSha256 = sha256('unknown');
                let formalEvidenceSha256 = null;
                stage = 'broker_write_once';
                try {
                    const placeResponse = parseBrokerResponse(
                        await transport.write(canonical.request, receipt),
                    );
                    const responseTrade = projectSmartOrderTask0406PlaceResponse({
                        account: adjacentPrivate.account,
                        marketPlan: prepared.marketPlan,
                        placeResponse,
                        profile: prepared.profile,
                        runId: prepared.marketPlan.runId,
                    });
                    const observation = await prepared.observer.collectExact({
                        afterIndex: eventBoundary,
                        expectedCustomField: prepared.operationContract.customField,
                        expectedDeal:
                            policy.expectedOutcome === 'filled_with_order_and_deal',
                        expectedSeqno: responseTrade.seqno,
                        expectedTradeId: responseTrade.tradeId,
                        settleMs: 1_000,
                        timeoutMs: 15_000,
                    });
                    const refreshedTrades = await requestTrades({
                        account: adjacentPrivate.account,
                        beforeRequest,
                    });
                    const postResponse = await modeLease.revalidate({ operationId });
                    if (
                        postResponse.current !== true ||
                        postResponse.simulation !== true ||
                        postResponse.caLoaded !== false ||
                        postResponse.productionLoaded !== false ||
                        postResponse.apiGeneration !== expectedApiGeneration ||
                        (await currentTaskProbeWriteSourceFingerprint()) !==
                            prepared.marketPlan.sourceFingerprintSha256
                    ) {
                        throw new Error('Task 0.4/0.6 response generation drifted');
                    }
                    const result = createSmartOrderTask0406ResultEvidence({
                        account: adjacentPrivate.account,
                        apiGenerationSha256: sha256(expectedApiGeneration),
                        marketPlan: prepared.marketPlan,
                        observedEvents: observation.events,
                        placeResponse,
                        profile: prepared.profile,
                        refreshedTrades,
                        requestSha256: canonical.envelope.requestSha256,
                        runId: prepared.marketPlan.runId,
                    });
                    resultSha256 = result.resultSha256;
                    const formalCapability =
                        await readOrCreateSmartOrderTask13_2EvidenceCapability(
                            privateDirectory,
                        );
                    try {
                        formalEvidenceSha256 = await writeFormalEvidence({
                            capability: formalCapability,
                            privateDirectory,
                            prepared,
                            resultSha256,
                            nowEpochMs: now(),
                        });
                    } finally {
                        formalCapability.fill(0);
                    }
                    state = 'confirmed_formal_evidence';
                    reasonCode = 'confirmed_formal_evidence';
                } catch (error) {
                    reasonCode = smartOrderTask0406ResultFailureReason(error);
                    await requestTrades({
                        account: adjacentPrivate.account,
                        beforeRequest,
                    }).catch(() => null);
                }
                await writeTaskProbeWritePreflightEvidence({
                    evidencePath: resultPath,
                    evidence: {
                        schemaVersion:
                            SMART_ORDER_TASK_0_4_0_6_OPERATION_EXECUTOR_SCHEMA_VERSION,
                        state,
                        reasonCode,
                        taskId: policy.taskId,
                        profile: prepared.profile,
                        coordinationId: operationId,
                        runId: prepared.marketPlan.runId,
                        requestSha256: canonical.envelope.requestSha256,
                        resultSha256,
                        formalEvidenceSha256,
                        automaticRetryAllowed: false,
                        blindCleanupAllowed: false,
                        brokerWriteAttempted: true,
                        brokerWriteNetworked: true,
                        accountIdentifiersPersisted: false,
                    },
                });
                outcomeDurable = true;
                const completed = resourceCoordinator.completeOperation({ operationId });
                if (completed.allowed !== true) {
                    throw new Error('Task 0.4/0.6 resource completion failed');
                }
                operationGranted = false;
                return Object.freeze({
                    schemaVersion:
                        SMART_ORDER_TASK_0_4_0_6_OPERATION_EXECUTOR_SCHEMA_VERSION,
                    state,
                    reasonCode,
                    taskId: policy.taskId,
                    profile: prepared.profile,
                    runId: prepared.marketPlan.runId,
                    accountRef: `…${prepared.marketPlan.accountScopeSha256.slice(-12)}`,
                    resultSha256,
                    formalEvidenceSha256,
                    automaticRetryAllowed: false,
                    blindCleanupAllowed: false,
                    accountIdentifiersExposed: false,
                    brokerWriteAttempted: true,
                    brokerWriteNetworked: true,
                    writeMasterAuthority: false,
                    brokerAuthority: false,
                });
            } catch (error) {
                const blocked = new Error('Task 0.4/0.6 executor failed closed', {
                    cause: error,
                });
                blocked.task0406Stage = stage;
                blocked.task0406Reason = safeFailureReason(error);
                throw blocked;
            } finally {
                transport?.close();
                if (operationGranted) {
                    if (ledgerDurable) {
                        resourceCoordinator.handleOperationFailure({
                            operationId,
                            failure: 'connection_error',
                        });
                    } else {
                        resourceCoordinator.abandonOperation({ operationId });
                    }
                }
                if (!ledgerDurable || outcomeDurable) {
                    await modeLease?.close().catch(() => {});
                }
                resourceCoordinator.close();
            }
        },
    );
}
