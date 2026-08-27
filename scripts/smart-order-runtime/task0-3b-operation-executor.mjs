import { createHash, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
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
import { readOrCreateSmartOrderTask13_2EvidenceCapability } from './task13-2-evidence-capability.mjs';
import {
    SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION,
    createSmartOrderTask13_2FormalEvidence,
    currentSmartOrderTask13_2EvidenceSourceFingerprint,
    currentSmartOrderTask13_2VerifierFingerprint,
    verifySmartOrderTask13_2FormalEvidence,
} from './task13-2-formal-evidence.mjs';
import {
    SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
    assertSmartOrderTaskProbePinnedPriceCurrent,
    buildSmartOrderTaskProbeMarketPlan,
} from './task-probe-market-plan.mjs';
import { openTaskProbePinnedTransport } from './task-probe-pinned-transport.mjs';
import {
    consumeSmartOrderTaskProbeReadonlyAuthority,
    runSmartOrderTaskProbeAdjacentRevalidation,
} from './task-probe-readonly-preflight.mjs';
import {
    SMART_ORDER_TASK_PROBE_WRITE_PREFLIGHT_SCHEMA_VERSION,
    createTaskProbeWritePreflightEvidence,
    currentTaskProbeWriteSourceFingerprint,
    readTaskProbeWritePreflightReceipt,
    verifyTaskProbeWritePreflightEvidence,
    writeTaskProbeWritePreflightEvidence,
} from './task-probe-write-preflight.mjs';
import { consumePreparedSmartOrderTask03bOperation } from './task0-3b-operation-preparer.mjs';
import {
    consumePreparedSmartOrderTask03cOperation,
} from './task0-3c-operation-preparer.mjs';
import {
    assertSmartOrderTask03cExternalSellBaseline,
    deriveSmartOrderTask03cPlacedTarget,
} from './task0-3c-working-set.mjs';
import { smartOrderTask03cCustomField } from './task0-3c-operation-contract.mjs';
import { runSmartOrderTask03cAuthorizationCli } from './task0-3c-authorization-cli.mjs';
import {
    isIssuedTask03ObservationCoordination,
    task03TradeIdentitySha256,
} from './task0-3-observation-coordination.mjs';
import {
    advanceSmartOrderTask03bTargetRevision,
    confirmSmartOrderTask03bCancelledTarget,
    deriveSmartOrderTask03bPlacedTarget,
    verifySmartOrderTask03bCurrentTarget,
} from './task0-3b-target-lineage.mjs';

export const SMART_ORDER_TASK_0_3B_OPERATION_EXECUTOR_SCHEMA_VERSION =
    'smart-order-task-0.3b-operation-executor/2026-08-26.1';
export const SMART_ORDER_TASK_0_3C_OPERATION_EXECUTOR_SCHEMA_VERSION =
    'smart-order-task-0.3c-operation-executor/2026-08-27.1';

const MAX_JSON_BYTES = 2 * 1024 * 1024;

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function assertTask03cSidecarStopped(appSupportRoot) {
    try {
        await lstat(
            path.join(
                appSupportRoot,
                'smart-order',
                'run',
                'control-plane.json',
            ),
        );
        throw new Error('Task 0.3c sidecar restarted before external send');
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

async function readPrivateToken(filePath, pattern, label) {
    const handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
        const metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            metadata.size < 1 ||
            metadata.size > 512 ||
            (metadata.mode & 0o777) !== 0o600 ||
            (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
        ) {
            throw new Error(`${label} metadata is invalid`);
        }
        const value = (await handle.readFile('utf8')).trim();
        if (!pattern.test(value)) throw new Error(`${label} is invalid`);
        return value;
    } finally {
        await handle.close();
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
            throw new Error('Task 0.3b trades reconciliation failed');
        }
        const text = await response.text();
        if (Buffer.byteLength(text) > MAX_JSON_BYTES) {
            throw new Error('Task 0.3b trades reconciliation is oversized');
        }
        return JSON.parse(text);
    } finally {
        clearTimeout(timer);
    }
}

function parseBrokerResponse(response) {
    if (response?.statusCode !== 200 || !Buffer.isBuffer(response?.bodyBytes)) {
        response?.bodyBytes?.fill?.(0);
        throw new Error('Task 0.3b broker response status is unknown');
    }
    const contentType = String(response.headers?.['content-type'] ?? '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
    if (contentType !== 'application/json') {
        response.bodyBytes.fill(0);
        throw new Error('Task 0.3b broker response type is unknown');
    }
    try {
        return JSON.parse(response.bodyBytes.toString('utf8'));
    } finally {
        response.bodyBytes.fill(0);
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
    ].every((key) => left[key] === right[key]) &&
        canonicalJson(left.target) === canonicalJson(right.target);
}

function policyFor(plan, operationOrdinal) {
    if (plan.taskId === '0.3c') {
        return {
            purpose: 'working_non_marketable',
            priceType: 'LMT',
            timeInForce: 'ROD',
            priceOrdinal: operationOrdinal,
        };
    }
    return plan.operation === 'place'
        ? { purpose: 'working_non_marketable', priceType: 'LMT', timeInForce: 'ROD', priceOrdinal: 1 }
        : plan.operation === 'update_price'
          ? { purpose: 'working_non_marketable', priceType: 'LMT', timeInForce: 'ROD', priceOrdinal: 2 }
          : { purpose: 'cancel_same_run_target', priceType: null, timeInForce: null, priceOrdinal: 0 };
}

function marketPlanTarget(target) {
    return target === null
        ? null
        : Object.freeze({
              originRunId: target.originRunId,
              targetIdSha256: target.targetIdSha256,
              accountScopeSha256: target.accountScopeSha256,
              tradeDate: target.tradeDate,
              priceMinorUnits: target.priceMinorUnits,
              revision: target.revision,
          });
}

async function executePreparedSmartOrderTask03Operation({
    preparedAuthority,
    appSupportRoot,
    expectedApiGeneration,
    observerCoordination,
    now = () => Date.now(),
    taskId,
    consumePrepared,
}) {
    if (
        typeof appSupportRoot !== 'string' ||
        !path.isAbsolute(appSupportRoot) ||
        (await realpath(appSupportRoot)) !== appSupportRoot
    ) {
        throw new TypeError('Task 0.3b executor root is invalid');
    }
    const prepared = consumePrepared({
        preparedAuthority,
        nowEpochMs: now(),
    });
    if (prepared.marketPlan.taskId !== taskId) {
        throw new Error(`Task ${taskId} prepared operation scope drifted`);
    }
    const isTask03c = taskId === '0.3c';
    const artifactPrefix = isTask03c ? 'task0-3c' : 'task0-3b';
    const executorSchemaVersion = isTask03c
        ? SMART_ORDER_TASK_0_3C_OPERATION_EXECUTOR_SCHEMA_VERSION
        : SMART_ORDER_TASK_0_3B_OPERATION_EXECUTOR_SCHEMA_VERSION;
    if (isTask03c) await assertTask03cSidecarStopped(appSupportRoot);
    const nodeSafeLockAccount = Object.freeze({
        brokerId: prepared.account.broker_id,
        accountId: prepared.account.account_id,
        accountType: 'S',
    });
    return withNodeSafeBrokerAccountLock(nodeSafeLockAccount, async () => {
    const { canonical } = prepared.operationContract;
    if (
        !isIssuedTask03ObservationCoordination(observerCoordination) ||
        observerCoordination.accountScopeSha256 !==
            prepared.marketPlan.accountScopeSha256 ||
        observerCoordination.coordinationId !== canonical.envelope.operationId ||
        observerCoordination.requestSha256 !== canonical.envelope.requestSha256
    ) {
        throw new Error('Task 0.3b observer coordination is not exact');
    }
    const operationId = canonical.envelope.operationId;
    const coordinationId = operationId;
    const privateDirectory = path.join(appSupportRoot, 'smart-order', 'private');
    if ((await realpath(privateDirectory)) !== privateDirectory) {
        throw new Error('Task 0.3b private directory is not canonical');
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
    let formalEvidenceCapability;
    let formalEvidenceSourceFingerprintSha256;
    let formalEvidenceVerifierFingerprintSha256;
    let stage = 'mode_admission';
    try {
        modeLease = await admission.acquire();
        stage = 'resource_admission';
        const grant = await resourceCoordinator.acquireOperation({
            operationId,
            kind:
                canonical.request.operation === 'cancel'
                    ? 'user_confirmed_cancel'
                    : isTask03c
                      ? 'reduce_only_protection'
                    : 'new_exposure',
        });
        if (grant.allowed !== true) throw new Error('Task 0.3b resource grant denied');
        operationGranted = true;
        if (!isTask03c) {
            stage = 'formal_evidence_authority';
            formalEvidenceCapability =
                await readOrCreateSmartOrderTask13_2EvidenceCapability(
                    privateDirectory,
                );
            const formalEvidenceKey =
                canonical.request.operation === 'place'
                    ? '0.3b:place_confirmed'
                    : canonical.request.operation === 'update_price'
                      ? '0.3b:update_confirmed'
                      : '0.3b:cancel_confirmed';
            [
                formalEvidenceSourceFingerprintSha256,
                formalEvidenceVerifierFingerprintSha256,
            ] = await Promise.all([
                currentSmartOrderTask13_2EvidenceSourceFingerprint(
                    formalEvidenceKey,
                ),
                currentSmartOrderTask13_2VerifierFingerprint(),
            ]);
            if (
                formalEvidenceSourceFingerprintSha256 !==
                prepared.marketPlan.sourceFingerprintSha256
            ) {
                throw new Error('Task 0.3b formal evidence source is not exact');
            }
        }
        stage = 'initial_observer_liveness';
        const initialObserverLiveness =
            await observerCoordination.revalidateReady({
                minimumRemainingMs: 15_000,
            });
        const observerReadiness = Object.freeze({
            accountScopeSha256: observerCoordination.accountScopeSha256,
            current: initialObserverLiveness.current,
            evidenceSha256:
                prepared.readonlyProjection.observerReadinessSha256,
            validUntilEpochMs:
                initialObserverLiveness.observerDeadlineEpochMs,
        });
        stage = 'cli_authorization';
        const authorizationSummaryPrefix = isTask03c
            ? 'task0_3c_authorization_summary='
            : 'task0_3b_authorization_summary=';
        process.stderr.write(
            `${authorizationSummaryPrefix}${JSON.stringify({
                operation: canonical.request.operation,
                contract: prepared.marketPlan.contractKey,
                side: prepared.marketPlan.side,
                price: prepared.marketPlan.price,
                priceType: prepared.marketPlan.priceType,
                timeInForce: prepared.marketPlan.timeInForce,
                quantityCommonLots: 1,
                operationOrdinal: prepared.operationOrdinal ?? null,
                coordinationId,
                runId: prepared.marketPlan.runId,
                accountRef: `…${prepared.marketPlan.accountScopeSha256.slice(-12)}`,
                accountScopeSha256:
                    prepared.marketPlan.accountScopeSha256,
                requestSha256: canonical.envelope.requestSha256,
                target:
                    prepared.target === null
                        ? null
                        : {
                              targetRef: `…${prepared.target.targetIdSha256.slice(-12)}`,
                              revision: prepared.target.revision,
                          },
                validUntilEpochMs: canonical.envelope.validUntilEpochMs,
                validUntilIso: new Date(
                    canonical.envelope.validUntilEpochMs,
                ).toISOString(),
                brokerWriteAttempted: false,
                brokerAuthority: false,
            })}\n`,
        );
        const authorizationDeadlineEpochMs = Math.min(
            canonical.envelope.validUntilEpochMs,
            initialObserverLiveness.observerDeadlineEpochMs,
        );
        const interactive = isTask03c
            ? await runSmartOrderTask03cAuthorizationCli({
                  envelope: canonical.sourceEnvelope,
                  appSupportRoot,
                  expectedApiGeneration,
                  authorizationDeadlineEpochMs,
                  now,
              })
            : await runSmartOrderGateProbeCli({
                  envelope: canonical.sourceEnvelope,
                  appSupportRoot,
                  expectedApiGeneration,
                  returnAuthorizationOnly: true,
                  authorizationDeadlineEpochMs,
                  now,
              });
        const capabilityPath = path.join(
            privateDirectory,
            'gate-probe-cli-capability.bin',
        );
        let cliEvidence;
        if (isTask03c) {
            cliEvidence = interactive;
        } else {
            const discovery = await readPrivateRuntimeDiscovery(
                path.join(
                    appSupportRoot,
                    'smart-order',
                    'run',
                    'control-plane.json',
                ),
                { nowEpochMs: now() },
            );
            const capability = await readPrivateSecret(capabilityPath);
            try {
                cliEvidence = verifySmartOrderGateProbeCliAuthorization({
                    capability,
                    envelope: canonical.sourceEnvelope,
                    authorization: interactive.authorization,
                    nowEpochMs: now(),
                    expectedApiGenerationSha256:
                        sha256(expectedApiGeneration),
                    expectedRuntimeEpochIdSha256: sha256(
                        discovery.runtimeEpochId,
                    ),
                });
            } finally {
                capability.fill(0);
            }
        }
        const beforeRequest = async () => {
            await resourceCoordinator.acquireOperationUnit({ operationId });
        };
        stage = 'authorization_adjacent_readonly';
        const adjacentReadonly = await runSmartOrderTaskProbeAdjacentRevalidation({
            appSupportRoot,
            expectedApiGeneration,
            observerReadiness,
            priorProjection: prepared.readonlyProjection,
            account: prepared.account,
            beforeRequest,
            now,
        });
        const adjacentPrivate = consumeSmartOrderTaskProbeReadonlyAuthority(
            adjacentReadonly.authority,
        );
        stage = 'authorization_adjacent_market_plan';
        const policy = policyFor(
            prepared.marketPlan,
            prepared.operationOrdinal,
        );
        const adjacentPlan = buildSmartOrderTaskProbeMarketPlan({
            schemaVersion: SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
            taskId,
            runId: prepared.marketPlan.runId,
            operation: prepared.marketPlan.operation,
            purpose: policy.purpose,
            side: prepared.marketPlan.side,
            priceType: policy.priceType,
            timeInForce: policy.timeInForce,
            priceOrdinal: policy.priceOrdinal,
            quantityCommonLots: 1,
            accountScopeSha256: adjacentReadonly.projection.accountScopeSha256,
            tradeDate: adjacentReadonly.projection.tradeDate,
            sourceFingerprintSha256:
                adjacentReadonly.projection.sourceFingerprintSha256,
            apiGenerationSha256: adjacentReadonly.projection.apiGenerationSha256,
            positionsSha256: adjacentReadonly.projection.positionsSha256,
            workingOrdersSha256:
                adjacentReadonly.projection.workingOrdersSha256,
            nowEpochMs: now(),
            target: marketPlanTarget(prepared.target),
            contract: adjacentReadonly.projection.contract,
            quote: adjacentReadonly.projection.quote,
        }).plan;
        if (!samePlanCritical(prepared.marketPlan, adjacentPlan)) {
            throw new Error('Task 0.3b exact market plan drifted during authorization');
        }
        stage = 'authorization_adjacent_pinned_price';
        assertSmartOrderTaskProbePinnedPriceCurrent({
            plan: prepared.marketPlan,
            contract: adjacentReadonly.projection.contract,
            quote: adjacentReadonly.projection.quote,
        });
        if (isTask03c) {
            stage = 'authorization_adjacent_external_sell_baseline';
            const baseline = assertSmartOrderTask03cExternalSellBaseline({
                account: adjacentPrivate.account,
                contractUnit: adjacentPrivate.contract.contractUnit,
                expectedCustomField: smartOrderTask03cCustomField(
                    prepared.marketPlan.runId,
                    prepared.operationOrdinal,
                ),
                operationOrdinal: prepared.operationOrdinal,
                positions: adjacentPrivate.positions,
                previousTargets: prepared.previousTargets,
                trades: adjacentPrivate.trades,
            });
            if (
                baseline.workingSetSha256 !==
                prepared.baseline.workingSetSha256
            ) {
                throw new Error(
                    'Task 0.3c external working-sell baseline drifted',
                );
            }
        } else if (prepared.target !== null) {
            stage = 'authorization_adjacent_target';
            verifySmartOrderTask03bCurrentTarget({
                account: adjacentPrivate.account,
                target: prepared.target,
                refreshedTrades: adjacentPrivate.trades,
            });
        }
        stage = 'pinned_transport';
        if (isTask03c) await assertTask03cSidecarStopped(appSupportRoot);
        transport = await openTaskProbePinnedTransport();
        const finalObserverLiveness =
            await observerCoordination.revalidateReady({
                minimumRemainingMs: 7_000,
            });
        if (
            finalObserverLiveness.observerDeadlineEpochMs !==
            initialObserverLiveness.observerDeadlineEpochMs
        ) {
            throw new Error('Task 0.3b observer generation drifted');
        }
        const adjacent = await modeLease.revalidate({ operationId });
        if (isTask03c) await assertTask03cSidecarStopped(appSupportRoot);
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
            throw new Error('Task 0.3b write-adjacent authority drifted');
        }
        const evidenceCapability = await readPrivateSecret(capabilityPath);
        let evidence;
        let receipt;
        try {
            const evidenceInput = Object.freeze({
                schemaVersion: SMART_ORDER_TASK_PROBE_WRITE_PREFLIGHT_SCHEMA_VERSION,
                sourceFingerprintSha256:
                    prepared.marketPlan.sourceFingerprintSha256,
                createdAtEpochMs: now(),
                validUntilEpochMs: Math.min(now() + 5_000, canonical.envelope.validUntilEpochMs),
                coordinationId,
                runId: prepared.marketPlan.runId,
                operationIdSha256: sha256(operationId),
                operation: canonical.request.operation,
                requestSha256: canonical.envelope.requestSha256,
                envelopeSha256: canonical.envelopeSha256,
                marketPlanSha256: prepared.marketPlanSha256,
                cliAuthorizationSha256: cliEvidence.cliAuthorizationSha256,
                accountScopeSha256: prepared.marketPlan.accountScopeSha256,
                tradeDate: prepared.marketPlan.tradeDate,
                targetIdSha256: prepared.target?.targetIdSha256 ?? null,
                targetRevision: prepared.target?.revision ?? null,
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
                apiSimulation: adjacent.simulation,
                sharedModeLeaseHeld: true,
                observerReady: true,
                caLoaded: adjacent.caLoaded,
                productionLoaded: adjacent.productionLoaded,
                automaticRetryAllowed: false,
                blindCleanupAllowed: false,
                brokerWriteAttempted: false,
                brokerWriteNetworked: false,
                accountIdentifiersPersisted: false,
            });
            evidence = createTaskProbeWritePreflightEvidence({
                capability: evidenceCapability,
                input: evidenceInput,
            });
            const expected = {
                accountScopeSha256: evidenceInput.accountScopeSha256,
                apiGenerationSha256: evidenceInput.apiGenerationSha256,
                coordinationId,
                envelopeSha256: evidenceInput.envelopeSha256,
                marketPlanSha256: evidenceInput.marketPlanSha256,
                operation: evidenceInput.operation,
                operationIdSha256: evidenceInput.operationIdSha256,
                requestSha256: evidenceInput.requestSha256,
                runId: evidenceInput.runId,
                sourceFingerprintSha256: evidenceInput.sourceFingerprintSha256,
                targetIdSha256: evidenceInput.targetIdSha256,
                targetRevision: evidenceInput.targetRevision,
            };
            if (
                verifyTaskProbeWritePreflightEvidence({
                    capability: evidenceCapability,
                    evidence,
                    expected,
                    nowEpochMs: now(),
                }).eligible !== true
            ) {
                throw new Error('Task 0.3b write evidence verification failed');
            }
            const evidencePath = path.join(
                privateDirectory,
                `${artifactPrefix}-preflight-${operationId}.json`,
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
            `${artifactPrefix}-dispatch-${operationId}.json`,
        );
        const resultPath = path.join(
            privateDirectory,
            `${artifactPrefix}-result-${operationId}.json`,
        );
        await writeTaskProbeWritePreflightEvidence({
            evidencePath: ledgerPath,
            evidence: {
                schemaVersion: executorSchemaVersion,
                state: 'dispatching_unknown_no_retry',
                coordinationId,
                runId: prepared.marketPlan.runId,
                operation: canonical.request.operation,
                requestSha256: canonical.envelope.requestSha256,
                envelopeSha256: canonical.envelopeSha256,
                marketPlanSha256: prepared.marketPlanSha256,
                targetIdSha256: prepared.target?.targetIdSha256 ?? null,
                targetRevision: prepared.target?.revision ?? null,
                automaticRetryAllowed: false,
                blindCleanupAllowed: false,
                brokerWriteAttempted: true,
                brokerWriteNetworked: true,
                accountIdentifiersPersisted: false,
            },
        });
        ledgerDurable = true;
        stage = 'dispatch_linearity';
        const dispatching = resourceCoordinator.markOperationDispatching({
            operationId,
        });
        if (dispatching.allowed !== true) {
            throw new Error('Task 0.3b dispatch phase was not admitted');
        }
        let state = 'unknown_manual_reconciliation_required';
        let nextTarget = null;
        let resultEvidenceSha256 = sha256('unknown');
        stage = 'broker_write_once';
        try {
            if (isTask03c) await assertTask03cSidecarStopped(appSupportRoot);
            const brokerResponse = parseBrokerResponse(
                await transport.write(canonical.request, receipt),
            );
            const refreshed = await requestTrades({
                account: adjacentPrivate.account,
                beforeRequest,
            });
            const postResponse = await modeLease.revalidate({ operationId });
            if (isTask03c) await assertTask03cSidecarStopped(appSupportRoot);
            if (
                postResponse.current !== true ||
                postResponse.simulation !== true ||
                postResponse.caLoaded !== false ||
                postResponse.productionLoaded !== false ||
                postResponse.apiGeneration !== expectedApiGeneration ||
                (await currentTaskProbeWriteSourceFingerprint()) !==
                    prepared.marketPlan.sourceFingerprintSha256
            ) {
                throw new Error('Task 0.3b response generation drifted');
            }
            if (isTask03c) {
                nextTarget = deriveSmartOrderTask03cPlacedTarget({
                    account: adjacentPrivate.account,
                    contractUnit: adjacentPrivate.contract.contractUnit,
                    expectedCustomField:
                        canonical.request.payload.stock_order.custom_field,
                    expectedPriceDecimal: prepared.marketPlan.price,
                    operationOrdinal: prepared.operationOrdinal,
                    placeResponse: brokerResponse,
                    refreshedTrades: refreshed,
                    runId: prepared.marketPlan.runId,
                    tradeDate: prepared.marketPlan.tradeDate,
                });
                state = `external_sell_${prepared.operationOrdinal}_confirmed`;
                resultEvidenceSha256 = nextTarget.privateTarget.targetRevision;
            } else if (canonical.request.operation === 'place') {
                nextTarget = deriveSmartOrderTask03bPlacedTarget({
                    account: adjacentPrivate.account,
                    contractUnit: adjacentPrivate.contract.contractUnit,
                    expectedCustomField:
                        canonical.request.payload.stock_order.custom_field,
                    expectedPriceDecimal: prepared.marketPlan.price,
                    placeResponse: brokerResponse,
                    refreshedTrades: refreshed,
                    runId: prepared.marketPlan.runId,
                    tradeDate: prepared.marketPlan.tradeDate,
                });
                state = 'place_confirmed_target_revision_0';
                resultEvidenceSha256 = nextTarget.privateTarget.targetRevision;
            } else if (canonical.request.operation === 'update_price') {
                const responseRevision = advanceSmartOrderTask03bTargetRevision({
                    account: adjacentPrivate.account,
                    expectedPriceDecimal: prepared.marketPlan.price,
                    previousTarget: prepared.target,
                    refreshedTrades: [brokerResponse],
                });
                nextTarget = advanceSmartOrderTask03bTargetRevision({
                    account: adjacentPrivate.account,
                    expectedPriceDecimal: prepared.marketPlan.price,
                    previousTarget: prepared.target,
                    refreshedTrades: refreshed,
                });
                if (
                    responseRevision.privateTarget.targetRevision !==
                    nextTarget.privateTarget.targetRevision
                ) {
                    throw new Error('Task 0.3b update response/reconciliation drifted');
                }
                state = 'update_confirmed_next_revision';
                resultEvidenceSha256 = nextTarget.privateTarget.targetRevision;
            } else {
                const responseFinal = confirmSmartOrderTask03bCancelledTarget({
                    account: adjacentPrivate.account,
                    target: prepared.target,
                    refreshedTrades: [brokerResponse],
                });
                const final = confirmSmartOrderTask03bCancelledTarget({
                    account: adjacentPrivate.account,
                    target: prepared.target,
                    refreshedTrades: refreshed,
                });
                if (responseFinal.finalRevision !== final.finalRevision) {
                    throw new Error('Task 0.3b cancel response/reconciliation drifted');
                }
                state = 'cancel_confirmed_terminal';
                resultEvidenceSha256 = sha256(canonicalJson(final));
            }
        } catch {
            await requestTrades({
                account: adjacentPrivate.account,
                beforeRequest,
            }).catch(() => null);
        }
        if (nextTarget !== null) {
            await writeTaskProbeWritePreflightEvidence({
                evidencePath: path.join(
                    privateDirectory,
                    isTask03c
                        ? `task0-3c-target-${prepared.marketPlan.runId}-o${prepared.operationOrdinal}.json`
                        : `task0-3b-target-${prepared.marketPlan.runId}-r${nextTarget.privateTarget.revision}.json`,
                ),
                evidence: nextTarget.privateTarget,
            });
        }
        await writeTaskProbeWritePreflightEvidence({
            evidencePath: resultPath,
            evidence: {
                schemaVersion: executorSchemaVersion,
                state,
                coordinationId,
                runId: prepared.marketPlan.runId,
                operation: canonical.request.operation,
                resultEvidenceSha256,
                targetIdSha256:
                    nextTarget?.privateTarget.targetIdSha256 ??
                    prepared.target?.targetIdSha256 ??
                    null,
                targetRevision:
                    nextTarget?.privateTarget.revision ??
                    prepared.target?.revision ??
                    null,
                automaticRetryAllowed: false,
                blindCleanupAllowed: false,
                brokerWriteAttempted: true,
                brokerWriteNetworked: true,
                accountIdentifiersPersisted: false,
            },
        });
        outcomeDurable = true;
        if (state !== 'unknown_manual_reconciliation_required') {
            const proofTradeId =
                nextTarget?.privateTarget.tradeId ?? prepared.target?.tradeId;
            await observerCoordination.writeProof({
                resultEvidenceSha256,
                state: 'confirmed',
                tradeIdentitySha256: task03TradeIdentitySha256(
                    adjacentPrivate.account,
                    proofTradeId,
                ),
            });
        }
        let formalEvidenceEligible = false;
        let formalEvidenceHashSha256 = null;
        if (
            !isTask03c &&
            state !== 'unknown_manual_reconciliation_required'
        ) {
            try {
                const currentFormalCapability =
                    await readOrCreateSmartOrderTask13_2EvidenceCapability(
                        privateDirectory,
                    );
                try {
                    const [currentFormalSource, currentFormalVerifier] =
                        await Promise.all([
                            currentSmartOrderTask13_2EvidenceSourceFingerprint(
                                canonical.request.operation === 'place'
                                    ? '0.3b:place_confirmed'
                                    : canonical.request.operation ===
                                        'update_price'
                                      ? '0.3b:update_confirmed'
                                      : '0.3b:cancel_confirmed',
                            ),
                            currentSmartOrderTask13_2VerifierFingerprint(),
                        ]);
                    if (
                        !timingSafeEqual(
                            currentFormalCapability,
                            formalEvidenceCapability,
                        ) ||
                        currentFormalSource !==
                            formalEvidenceSourceFingerprintSha256 ||
                        currentFormalVerifier !==
                            formalEvidenceVerifierFingerprintSha256
                    ) {
                        throw new Error(
                            'Task 0.3b formal evidence authority drifted',
                        );
                    }
                } finally {
                    currentFormalCapability.fill(0);
                }
                const operationKey =
                    canonical.request.operation === 'place'
                        ? 'place_confirmed'
                        : canonical.request.operation === 'update_price'
                          ? 'update_confirmed'
                          : 'cancel_confirmed';
                const formal = createSmartOrderTask13_2FormalEvidence({
                    capability: formalEvidenceCapability,
                    input: {
                        schemaVersion:
                            SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION,
                        evidenceId: operationId,
                        taskId: '0.3b',
                        operationKey,
                        runId: prepared.marketPlan.runId,
                        observedTradeDate: prepared.marketPlan.tradeDate,
                        accountScopeSha256:
                            prepared.marketPlan.accountScopeSha256,
                        apiGenerationSha256: sha256(expectedApiGeneration),
                        sourceFingerprintSha256:
                            formalEvidenceSourceFingerprintSha256,
                        verifierFingerprintSha256:
                            formalEvidenceVerifierFingerprintSha256,
                        requestSha256: canonical.envelope.requestSha256,
                        resultSha256: resultEvidenceSha256,
                        targetIdSha256:
                            nextTarget?.privateTarget.targetIdSha256 ??
                            prepared.target?.targetIdSha256 ??
                            null,
                        quantityCommonLots: 1,
                        generatedAtEpochMs: now(),
                        validUntilEpochMs: null,
                        formalEvidence: true,
                        fixture: false,
                        brokerWriteAttempted: true,
                        brokerWriteNetworked: true,
                        automaticRetryAllowed: false,
                        blindCleanupAllowed: false,
                        accountIdentifiersPersisted: false,
                    },
                });
                const verifiedFormal =
                    verifySmartOrderTask13_2FormalEvidence({
                        capability: formalEvidenceCapability,
                        evidence: formal,
                        expectedSourceFingerprintSha256:
                            formalEvidenceSourceFingerprintSha256,
                        expectedVerifierFingerprintSha256:
                            formalEvidenceVerifierFingerprintSha256,
                    });
                if (!verifiedFormal.eligible) {
                    throw new Error('Task 0.3b formal evidence verification failed');
                }
                await writeTaskProbeWritePreflightEvidence({
                    evidencePath: path.join(
                        privateDirectory,
                        // Historical evidence is immutable. A later run or
                        // capability rotation must never collide with, replace,
                        // or silently reuse an earlier operation's artifact.
                        `task13-2-formal-0.3b-${operationKey.replaceAll('_', '-')}-${prepared.marketPlan.runId}-${operationId}.json`,
                    ),
                    evidence: formal,
                });
                formalEvidenceEligible = true;
                formalEvidenceHashSha256 = formal.evidenceHashSha256;
            } catch {
                // Broker outcome remains the durable result above. Evidence
                // failure never permits retry, cancel, cleanup, or a false
                // unknown outcome; it only blocks Task 0.3b completion.
                formalEvidenceEligible = false;
                formalEvidenceHashSha256 = null;
            }
        }
        const completed = resourceCoordinator.completeOperation({ operationId });
        if (completed.allowed !== true) {
            throw new Error('Task 0.3b resource completion failed');
        }
        operationGranted = false;
        return Object.freeze({
            schemaVersion: executorSchemaVersion,
            state,
            operation: canonical.request.operation,
            runId: prepared.marketPlan.runId,
            accountRef: `…${prepared.marketPlan.accountScopeSha256.slice(-12)}`,
            resultEvidenceSha256,
            formalEvidenceEligible,
            formalEvidenceHashSha256,
            nextTarget: nextTarget?.publicTarget ?? null,
            automaticRetryAllowed: false,
            blindCleanupAllowed: false,
            accountIdentifiersExposed: false,
            brokerWriteAttempted: true,
            brokerWriteNetworked: true,
            writeMasterAuthority: false,
            brokerAuthority: false,
        });
    } catch (error) {
        const blocked = new Error('Task 0.3b executor failed closed', {
            cause: error,
        });
        blocked.task03bStage = stage;
        blocked.task03cStage = stage;
        blocked.brokerWriteMayHaveBeenAttempted = ledgerDurable;
        throw blocked;
    } finally {
        transport?.close();
        formalEvidenceCapability?.fill(0);
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
    });
}

export function executePreparedSmartOrderTask03bOperation(input) {
    return executePreparedSmartOrderTask03Operation({
        ...input,
        taskId: '0.3b',
        consumePrepared: consumePreparedSmartOrderTask03bOperation,
    });
}

export function executePreparedSmartOrderTask03cOperation(input) {
    return executePreparedSmartOrderTask03Operation({
        ...input,
        taskId: '0.3c',
        consumePrepared: consumePreparedSmartOrderTask03cOperation,
    });
}
