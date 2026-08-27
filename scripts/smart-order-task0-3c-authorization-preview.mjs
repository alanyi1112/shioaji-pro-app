#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notifySmartOrderAuthorizationRequired } from './smart-order-runtime/authorization-required-notifier.mjs';
import { smartOrderTask03cAuthorizationPhrase } from './smart-order-runtime/task0-3c-authorization-cli.mjs';
import { prepareSmartOrderTask03cCandidateOperation } from './smart-order-runtime/task0-3c-operation-preparer.mjs';
import { SMART_ORDER_TASK_0_3C_TARGET_SCHEMA_VERSION } from './smart-order-runtime/task0-3c-working-set.mjs';
import { managedSmartOrderReadonlyProbeAppSupportRoot } from './smart-order-contract-probe.mjs';

export const SMART_ORDER_TASK_0_3C_AUTHORIZATION_PREVIEW_SCHEMA_VERSION =
    'smart-order-task-0.3c-authorization-preview/2026-08-27.1';

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
            throw new TypeError('Task 0.3c preview arguments are invalid');
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
        throw new TypeError('Task 0.3c preview arguments are invalid');
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
        throw new Error('Task 0.3c preview requires a stopped sidecar');
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

async function readPreviousTarget(targetPath, privateDirectory, runId) {
    if (
        typeof targetPath !== 'string' ||
        !path.isAbsolute(targetPath) ||
        path.dirname(targetPath) !== privateDirectory ||
        path.basename(targetPath) !== `task0-3c-target-${runId}-o1.json`
    ) {
        throw new Error('Task 0.3c preview prior target is outside the exact run');
    }
    const target = JSON.parse(
        await readPrivateText(targetPath, 'Task 0.3c preview prior target'),
    );
    if (
        target?.schemaVersion !== SMART_ORDER_TASK_0_3C_TARGET_SCHEMA_VERSION ||
        target.originRunId !== runId ||
        target.operationOrdinal !== 1
    ) {
        throw new Error('Task 0.3c preview prior target lineage is invalid');
    }
    return Object.freeze(target);
}

export async function runSmartOrderTask03cAuthorizationPreview({
    args,
    now = () => Date.now(),
    notifyAuthorizationRequired = notifySmartOrderAuthorizationRequired,
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
        'Task 0.3c preview runtime generation',
    );
    if (!/^simulation:[A-Za-z0-9._:-]{1,240}$/.test(expectedApiGeneration)) {
        throw new Error('Task 0.3c preview generation is not simulation');
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
    const candidate = await prepareSmartOrderTask03cCandidateOperation({
        appSupportRoot,
        expectedApiGeneration,
        runId: parsed.runId,
        operationId: parsed.operationId,
        nonce: parsed.nonce,
        operationOrdinal: parsed.operationOrdinal,
        previousTargets,
        now,
    });
    if (candidate.accountScopeSha256 !== parsed.accountScopeSha256) {
        throw new Error('Task 0.3c preview fixed account scope drifted');
    }
    const phrase = smartOrderTask03cAuthorizationPhrase({
        requestSha256: candidate.requestSha256,
        operationId: candidate.operationId,
        expectedApiGeneration,
    });
    try {
        notifyAuthorizationRequired();
    } catch {
        // Best-effort local reminder; never changes authorization state.
    }
    return Object.freeze({
        schemaVersion: SMART_ORDER_TASK_0_3C_AUTHORIZATION_PREVIEW_SCHEMA_VERSION,
        operationOrdinal: candidate.operationOrdinal,
        runId: candidate.runId,
        operationId: candidate.operationId,
        accountRef: `…${candidate.accountScopeSha256.slice(-12)}`,
        requestRef: `…${candidate.requestSha256.slice(-16)}`,
        apiGenerationSha256: sha256(expectedApiGeneration),
        validUntilEpochMs: candidate.validUntilEpochMs,
        exactAuthorizationPhrase: phrase,
        observerReady: false,
        brokerWriteAttempted: false,
        brokerWriteNetworked: false,
        writeMasterAuthority: false,
        brokerAuthority: false,
    });
}

async function main() {
    process.stdout.write(
        `${JSON.stringify(
            await runSmartOrderTask03cAuthorizationPreview({
                args: process.argv.slice(2),
            }),
        )}\n`,
    );
}

if (
    process.argv[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
    main().catch((error) => {
        process.stderr.write(
            `smart_order_task0_3c_preview=unavailable:${error?.name ?? 'Error'}\n`,
        );
        process.exitCode = 1;
    });
}
