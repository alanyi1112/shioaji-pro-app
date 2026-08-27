#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './smart-order-runtime/canonical-json.mjs';
import { createSmartOrderResourceCoordinator } from './smart-order-runtime/resource-coordinator.mjs';
import {
    createTask03ObservationCoordination,
    SMART_ORDER_TASK_0_3_MAX_READINESS_WAIT_MS,
} from './smart-order-runtime/task0-3-observation-coordination.mjs';
import {
    prepareSmartOrderTask03cCandidateOperation,
    prepareSmartOrderTask03cOperationAfterObserver,
} from './smart-order-runtime/task0-3c-operation-preparer.mjs';
import { executePreparedSmartOrderTask03cOperation } from './smart-order-runtime/task0-3b-operation-executor.mjs';
import { SMART_ORDER_TASK_0_3C_TARGET_SCHEMA_VERSION } from './smart-order-runtime/task0-3c-working-set.mjs';
import { managedSmartOrderReadonlyProbeAppSupportRoot } from './smart-order-contract-probe.mjs';
import { runManagedSmartOrderReadonlyGateRunner } from './smart-order-readonly-gate-runner.mjs';

export const SMART_ORDER_TASK_0_3C_EXTERNAL_SELL_SCHEMA_VERSION =
    'smart-order-task-0.3c-external-sell/2026-08-27.1';

const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function parseArguments(args) {
    const entries = new Map();
    for (const argument of args) {
        const match = /^--([a-z-]+)=(.+)$/.exec(argument);
        if (!match || entries.has(match[1])) {
            throw new TypeError('Task 0.3c CLI arguments are invalid');
        }
        entries.set(match[1], match[2]);
    }
    const operationOrdinal = Number(entries.get('ordinal'));
    const runId = entries.get('run-id');
    const operationId = entries.get('operation-id');
    const nonce = entries.get('nonce');
    const accountScopeSha256 = entries.get('account-scope');
    const previousTargetPath = entries.get('previous-target');
    if (
        ![1, 2].includes(operationOrdinal) ||
        !UUID.test(runId ?? '') ||
        !UUID.test(operationId ?? '') ||
        !UUID.test(nonce ?? '') ||
        !DIGEST.test(accountScopeSha256 ?? '') ||
        entries.size !== (operationOrdinal === 1 ? 5 : 6) ||
        (operationOrdinal === 1) !== (previousTargetPath === undefined)
    ) {
        throw new TypeError('Task 0.3c CLI arguments are invalid');
    }
    return Object.freeze({
        operationOrdinal,
        runId: runId.toLowerCase(),
        operationId: operationId.toLowerCase(),
        nonce: nonce.toLowerCase(),
        accountScopeSha256,
        previousTargetPath,
    });
}

async function readPrivateText(filePath, label) {
    const handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
        const metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            metadata.size < 1 ||
            metadata.size > 64 * 1024 ||
            (metadata.mode & 0o777) !== 0o600 ||
            (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
        ) {
            throw new Error(`${label} metadata is invalid`);
        }
        return (await handle.readFile('utf8')).trim();
    } finally {
        await handle.close();
    }
}

async function readPreviousTarget(
    targetPath,
    privateDirectory,
    runId,
) {
    if (
        typeof targetPath !== 'string' ||
        !path.isAbsolute(targetPath) ||
        path.dirname(targetPath) !== privateDirectory ||
        path.basename(targetPath) !== `task0-3c-target-${runId}-o1.json`
    ) {
        throw new Error('Task 0.3c prior target path is outside the exact run');
    }
    const target = JSON.parse(
        await readPrivateText(targetPath, 'Task 0.3c prior target'),
    );
    if (
        target?.schemaVersion !== SMART_ORDER_TASK_0_3C_TARGET_SCHEMA_VERSION ||
        target.originRunId !== runId ||
        target.operationOrdinal !== 1
    ) {
        throw new Error('Task 0.3c prior target lineage is invalid');
    }
    return Object.freeze(target);
}

async function assertSidecarStopped(appSupportRoot) {
    try {
        await lstat(
            path.join(
                appSupportRoot,
                'smart-order',
                'run',
                'control-plane.json',
            ),
        );
        throw new Error('Task 0.3c external sender requires a stopped sidecar');
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

async function withTask03cStage(stage, execute) {
    try {
        return await execute();
    } catch (error) {
        if (error && typeof error === 'object') {
            Object.defineProperty(error, 'task03cStage', {
                configurable: true,
                enumerable: false,
                value: stage,
                writable: true,
            });
        }
        throw error;
    }
}

export async function runSmartOrderTask03cExternalSell({
    args,
    now = () => Date.now(),
}) {
    const parsed = parseArguments(args);
    const appSupportRoot = await realpath(
        managedSmartOrderReadonlyProbeAppSupportRoot(),
    );
    await assertSidecarStopped(appSupportRoot);
    const privateDirectory = await realpath(
        path.join(appSupportRoot, 'smart-order', 'private'),
    );
    const expectedApiGeneration = await readPrivateText(
        path.join(appSupportRoot, 'runtime-api-generation'),
        'Task 0.3c runtime generation',
    );
    if (!/^simulation:[A-Za-z0-9._:-]{1,240}$/.test(expectedApiGeneration)) {
        throw new Error('Task 0.3c runtime generation is not simulation');
    }
    const previousTargets = parsed.previousTargetPath
        ? [
              await readPreviousTarget(
                  parsed.previousTargetPath,
                  privateDirectory,
                  parsed.runId,
              ),
          ]
        : [];
    const candidate = await withTask03cStage('candidate_preflight', () =>
        prepareSmartOrderTask03cCandidateOperation({
            appSupportRoot,
            expectedApiGeneration,
            runId: parsed.runId,
            operationId: parsed.operationId,
            nonce: parsed.nonce,
            operationOrdinal: parsed.operationOrdinal,
            previousTargets,
            now,
        }),
    );
    if (candidate.accountScopeSha256 !== parsed.accountScopeSha256) {
        throw new Error('Task 0.3c fixed simulation account scope drifted');
    }
    const coordinationOptions = {
        accountScopeSha256: candidate.accountScopeSha256,
        appSupportRoot,
        coordinationId: parsed.operationId,
        requestSha256: candidate.requestSha256,
    };
    const observerCoordination = createTask03ObservationCoordination(
        coordinationOptions,
    );
    const triggerCoordination = createTask03ObservationCoordination(
        coordinationOptions,
    );
    const observerResourceCoordinator = createSmartOrderResourceCoordinator();
    let observerPromise;
    let operationResult;
    let stage = 'observer_start';
    try {
        observerPromise = runManagedSmartOrderReadonlyGateRunner({
            appSupportRoot,
            resourceCoordinator: observerResourceCoordinator,
            task03Coordination: observerCoordination,
        });
        stage = 'observer_readiness';
        const readinessPromise = triggerCoordination.waitForReady({
            timeoutMs: SMART_ORDER_TASK_0_3_MAX_READINESS_WAIT_MS,
        });
        const acceptedReadiness = await Promise.race([
            readinessPromise,
            observerPromise.then(
                () => readinessPromise,
                (error) => Promise.reject(error),
            ),
        ]);
        const observerReadiness = Object.freeze({
            accountScopeSha256: acceptedReadiness.accountScopeSha256,
            current: true,
            evidenceSha256: sha256(canonicalJson(acceptedReadiness)),
            validUntilEpochMs: acceptedReadiness.observerDeadlineEpochMs,
        });
        stage = 'operation_after_observer';
        const prepared = await prepareSmartOrderTask03cOperationAfterObserver({
            candidateAuthority: candidate.candidateAuthority,
            observerReadiness,
            now,
        });
        await assertSidecarStopped(appSupportRoot);
        stage = 'write_executor_before_prompt';
        operationResult = await executePreparedSmartOrderTask03cOperation({
            preparedAuthority: prepared.preparedAuthority,
            appSupportRoot,
            expectedApiGeneration,
            observerCoordination: triggerCoordination,
            now,
        });
        stage = 'observer_correlation';
        const observerResult = await observerPromise;
        observerPromise = undefined;
        const eventCheck = observerResult.report?.checks?.find(
            (check) => check?.id === 'order-event-account',
        );
        const observerEvidenceSha256 = sha256(
            canonicalJson({
                report: observerResult.report,
                verification: observerResult.verification,
            }),
        );
        if (
            operationResult.state !== 'unknown_manual_reconciliation_required' &&
            (observerResult.verification?.eligible !== true ||
                eventCheck?.status !== 'pass')
        ) {
            throw new Error(
                'Task 0.3c observer did not correlate the exact broker event',
            );
        }
        return Object.freeze({
            ...operationResult,
            observerState: eventCheck?.status ?? 'missing',
            observerEvidenceSha256,
            brokerAuthority: false,
        });
    } catch (error) {
        const brokerWriteMayHaveBeenAttempted =
            operationResult?.brokerWriteAttempted === true ||
            error?.brokerWriteMayHaveBeenAttempted === true;
        if (!brokerWriteMayHaveBeenAttempted) {
            observerCoordination.abortObservation();
        }
        const blocked = new Error('Task 0.3c external sell failed closed', {
            cause: error,
        });
        blocked.task03cStage = error?.task03cStage ?? stage;
        blocked.brokerWriteMayHaveBeenAttempted =
            brokerWriteMayHaveBeenAttempted;
        throw blocked;
    } finally {
        await triggerCoordination.closeReadiness().catch(() => {});
        await observerCoordination.closeReadiness().catch(() => {});
        observerResourceCoordinator.close();
        await observerPromise?.catch(() => {});
    }
}

async function main() {
    const result = await runSmartOrderTask03cExternalSell({
        args: process.argv.slice(2),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
    process.argv[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
    main().catch((error) => {
        const name =
            typeof error?.name === 'string' && error.name.length <= 80
                ? error.name
                : 'Error';
        const stage =
            typeof error?.task03cStage === 'string' &&
            /^[a-z0-9_]{1,80}$/.test(error.task03cStage)
                ? error.task03cStage
                : 'unknown';
        process.stderr.write(
            `smart_order_task0_3c=unavailable:${name}:${stage}\n`,
        );
        process.exitCode = 1;
    });
}
