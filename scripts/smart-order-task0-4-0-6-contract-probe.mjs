#!/usr/bin/env node

import { constants as fsConstants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    managedSmartOrderReadonlyProbeAppSupportRoot,
} from './smart-order-contract-probe.mjs';
import {
    SMART_ORDER_TASK_0_4_0_6_PROFILES,
} from './smart-order-runtime/task0-4-0-6-operation-contract.mjs';
import {
    prepareSmartOrderTask0406CandidateOperation,
    prepareSmartOrderTask0406OperationAfterObserver,
    startSmartOrderTask0406ObserverForCandidate,
} from './smart-order-runtime/task0-4-0-6-operation-preparer.mjs';
import { executePreparedSmartOrderTask0406Operation } from './smart-order-runtime/task0-4-0-6-operation-executor.mjs';

export const SMART_ORDER_TASK_0_4_0_6_CONTRACT_PROBE_SCHEMA_VERSION =
    'smart-order-task-0.4-0.6-contract-probe/2026-08-24.2';

const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function safeProbeFailureReason(error) {
    const message = String(error?.message ?? '');
    if (message.includes('snapshot is stale')) return 'market_snapshot_stale';
    if (message.includes('snapshot')) return 'market_snapshot_invalid';
    if (message.includes('fixed stock account')) return 'fixed_account_unavailable';
    if (message.includes('readonly source drifted')) return 'readonly_source_drift';
    if (message.includes('readonly preflight is stale')) return 'readonly_preflight_stale';
    if (message.includes('API is not simulation')) return 'simulation_attestation_failed';
    if (message.includes('mode or generation')) return 'runtime_generation_drift';
    if (message.includes('observer')) return 'observer_not_current';
    if (message.includes('run already has')) return 'run_lineage_already_exists';
    if (message.includes('account scope drifted')) return 'account_scope_drift';
    return 'probe_fail_closed';
}

function parseArguments(args) {
    const entries = new Map();
    for (const argument of args) {
        const match = /^--([a-z-]+)=(.+)$/.exec(argument);
        if (!match || entries.has(match[1])) {
            throw new TypeError('Task 0.4/0.6 CLI arguments are invalid');
        }
        entries.set(match[1], match[2]);
    }
    const profile = entries.get('profile');
    const runId = entries.get('run-id');
    const operationId = entries.get('operation-id');
    const nonce = entries.get('nonce');
    const accountScopeSha256 = entries.get('account-scope');
    if (
        entries.size !== 5 ||
        !Object.hasOwn(SMART_ORDER_TASK_0_4_0_6_PROFILES, profile ?? '') ||
        !UUID.test(runId ?? '') ||
        !UUID.test(operationId ?? '') ||
        !UUID.test(nonce ?? '') ||
        !DIGEST.test(accountScopeSha256 ?? '')
    ) {
        throw new TypeError('Task 0.4/0.6 CLI arguments are invalid');
    }
    return Object.freeze({
        profile,
        runId,
        operationId,
        nonce,
        accountScopeSha256,
    });
}

async function readPrivateGeneration(filePath) {
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
            throw new Error('Task 0.4/0.6 Runtime generation metadata is invalid');
        }
        const value = (await handle.readFile('utf8')).trim();
        if (!/^simulation:[A-Za-z0-9._:-]{1,240}$/.test(value)) {
            throw new Error('Task 0.4/0.6 Runtime generation is invalid');
        }
        return value;
    } finally {
        await handle.close();
    }
}

export async function runSmartOrderTask0406ContractProbe({
    args,
    now = () => Date.now(),
}) {
    let observer;
    let stage = 'arguments';
    try {
        const parsed = parseArguments(args);
        stage = 'runtime_binding';
        const appSupportRoot = await realpath(
            managedSmartOrderReadonlyProbeAppSupportRoot(),
        );
        const expectedApiGeneration = await readPrivateGeneration(
            path.join(appSupportRoot, 'runtime-api-generation'),
        );
        stage = 'candidate_preflight';
        const candidate = await prepareSmartOrderTask0406CandidateOperation({
            appSupportRoot,
            expectedApiGeneration,
            runId: parsed.runId,
            operationId: parsed.operationId,
            nonce: parsed.nonce,
            profile: parsed.profile,
            now,
        });
        if (candidate.accountScopeSha256 !== parsed.accountScopeSha256) {
            throw new Error('Task 0.4/0.6 fixed simulation account scope drifted');
        }
        stage = 'observer_start';
        const started = await startSmartOrderTask0406ObserverForCandidate({
            candidateAuthority: candidate.candidateAuthority,
        });
        observer = started.observer;
        stage = 'operation_after_observer';
        const prepared = await prepareSmartOrderTask0406OperationAfterObserver({
            candidateAuthority: candidate.candidateAuthority,
            observer,
            observerReadiness: started.observerReadiness,
        });
        stage = 'write_executor_before_prompt';
        return await executePreparedSmartOrderTask0406Operation({
            preparedAuthority: prepared.preparedAuthority,
            appSupportRoot,
            expectedApiGeneration,
            now,
        });
    } catch (error) {
        const blocked = new Error('Task 0.4/0.6 probe failed closed', {
            cause: error,
        });
        blocked.task0406Stage = error?.task0406Stage ?? stage;
        blocked.task0406Reason =
            error?.task0406Reason ?? safeProbeFailureReason(error);
        throw blocked;
    } finally {
        await observer?.close().catch(() => {});
    }
}

async function main() {
    const result = await runSmartOrderTask0406ContractProbe({
        args: process.argv.slice(2),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.state !== 'confirmed_formal_evidence') process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    main().catch((error) => {
        const name =
            typeof error?.name === 'string' && error.name.length <= 80
                ? error.name
                : 'Error';
        const stage =
            typeof error?.task0406Stage === 'string' &&
            /^[a-z0-9_]{1,80}$/.test(error.task0406Stage)
                ? error.task0406Stage
                : 'unknown';
        const reason =
            typeof error?.task0406Reason === 'string' &&
            /^[a-z0-9_]{1,80}$/.test(error.task0406Reason)
                ? error.task0406Reason
                : 'unknown';
        process.stderr.write(
            `smart_order_task0_4_0_6=unavailable:${name}:${stage}:${reason}\n`,
        );
        process.exitCode = 1;
    });
}
