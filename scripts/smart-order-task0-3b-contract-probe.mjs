#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './smart-order-runtime/canonical-json.mjs';
import { createSmartOrderResourceCoordinator } from './smart-order-runtime/resource-coordinator.mjs';
import {
    createTask03ObservationCoordination,
    SMART_ORDER_TASK_0_3_MAX_READINESS_WAIT_MS,
} from './smart-order-runtime/task0-3-observation-coordination.mjs';
import {
    prepareSmartOrderTask03bCandidateOperation,
    prepareSmartOrderTask03bOperationAfterObserver,
} from './smart-order-runtime/task0-3b-operation-preparer.mjs';
import { executePreparedSmartOrderTask03bOperation } from './smart-order-runtime/task0-3b-operation-executor.mjs';
import {
    managedSmartOrderReadonlyProbeAppSupportRoot,
} from './smart-order-contract-probe.mjs';
import { runManagedSmartOrderReadonlyGateRunner } from './smart-order-readonly-gate-runner.mjs';

export const SMART_ORDER_TASK_0_3B_CONTRACT_PROBE_SCHEMA_VERSION =
    'smart-order-task-0.3b-contract-probe/2026-08-24.1';

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
            throw new TypeError('Task 0.3b CLI arguments are invalid');
        }
        entries.set(match[1], match[2]);
    }
    const operation = entries.get('operation');
    const runId = entries.get('run-id');
    const operationId = entries.get('operation-id');
    const nonce = entries.get('nonce');
    const accountScopeSha256 = entries.get('account-scope');
    const targetPath = entries.get('target');
    const expectedKeys = operation === 'place' ? 5 : 6;
    if (
        !['place', 'update_price', 'cancel'].includes(operation) ||
        !UUID.test(runId ?? '') ||
        !UUID.test(operationId ?? '') ||
        !UUID.test(nonce ?? '') ||
        !DIGEST.test(accountScopeSha256 ?? '') ||
        entries.size !== expectedKeys ||
        (operation === 'place') === (targetPath !== undefined)
    ) {
        throw new TypeError('Task 0.3b CLI arguments are invalid');
    }
    return Object.freeze({
        operation,
        runId,
        operationId,
        nonce,
        accountScopeSha256,
        targetPath,
    });
}

async function readPrivateText(filePath, pattern, label) {
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
        const text = await handle.readFile('utf8');
        if (!pattern.test(text.trim())) throw new Error(`${label} content is invalid`);
        return text.trim();
    } finally {
        await handle.close();
    }
}

async function readPrivateTarget(targetPath, privateDirectory, runId) {
    if (
        typeof targetPath !== 'string' ||
        !path.isAbsolute(targetPath) ||
        path.dirname(targetPath) !== privateDirectory ||
        !new RegExp(`^task0-3b-target-${runId}-r[0-9]+\\.json$`).test(
            path.basename(targetPath),
        )
    ) {
        throw new Error('Task 0.3b target path is outside the exact private run');
    }
    const text = await readPrivateText(targetPath, /^[\s\S]+$/, 'Task 0.3b target');
    const target = JSON.parse(text);
    if (target?.originRunId !== runId) {
        throw new Error('Task 0.3b target run drifted');
    }
    return Object.freeze(target);
}

export async function runSmartOrderTask03bContractProbe({
    args,
    now = () => Date.now(),
}) {
    const parsed = parseArguments(args);
    const appSupportRoot = await realpath(
        managedSmartOrderReadonlyProbeAppSupportRoot(),
    );
    const privateDirectory = await realpath(
        path.join(appSupportRoot, 'smart-order', 'private'),
    );
    const expectedApiGeneration = await readPrivateText(
        path.join(appSupportRoot, 'runtime-api-generation'),
        /^simulation:[A-Za-z0-9._:-]{1,240}$/,
        'Task 0.3b runtime generation',
    );
    const target = parsed.targetPath
        ? await readPrivateTarget(parsed.targetPath, privateDirectory, parsed.runId)
        : null;
    const candidate = await prepareSmartOrderTask03bCandidateOperation({
        appSupportRoot,
        expectedApiGeneration,
        runId: parsed.runId,
        operationId: parsed.operationId,
        nonce: parsed.nonce,
        operation: parsed.operation,
        target,
        now,
    });
    if (candidate.accountScopeSha256 !== parsed.accountScopeSha256) {
        throw new Error('Task 0.3b fixed simulation account scope drifted');
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
        const prepared = await prepareSmartOrderTask03bOperationAfterObserver({
            candidateAuthority: candidate.candidateAuthority,
            observerReadiness,
            now,
        });
        stage = 'write_executor_before_prompt';
        operationResult = await executePreparedSmartOrderTask03bOperation({
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
            throw new Error('Task 0.3b observer did not correlate the exact broker event');
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
        const blocked = new Error('Task 0.3b probe failed closed', {
            cause: error,
        });
        blocked.task03bStage = error?.task03bStage ?? stage;
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
    const result = await runSmartOrderTask03bContractProbe({
        args: process.argv.slice(2),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    main().catch((error) => {
        const name =
            typeof error?.name === 'string' && error.name.length <= 80
                ? error.name
                : 'Error';
        const stage =
            typeof error?.task03bStage === 'string' &&
            /^[a-z0-9_]{1,80}$/.test(error.task03bStage)
                ? error.task03bStage
                : 'unknown';
        process.stderr.write(
            `smart_order_task0_3b=unavailable:${name}:${stage}\n`,
        );
        process.exitCode = 1;
    });
}
