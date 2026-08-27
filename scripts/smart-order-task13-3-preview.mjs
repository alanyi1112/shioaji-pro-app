#!/usr/bin/env node

import { constants as fsConstants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { managedSmartOrderReadonlyProbeAppSupportRoot } from './smart-order-contract-probe.mjs';
import { SMART_ORDER_TASK_0_4_0_6_PROFILES } from './smart-order-runtime/task0-4-0-6-operation-contract.mjs';
import { prepareSmartOrderTask0406CandidateOperation } from './smart-order-runtime/task0-4-0-6-operation-preparer.mjs';

const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function parse(args) {
    const values = new Map();
    for (const argument of args) {
        const match = /^--([a-z-]+)=(.+)$/.exec(argument);
        if (!match || values.has(match[1])) {
            throw new TypeError('Task 13.3 preview arguments are invalid');
        }
        values.set(match[1], match[2]);
    }
    const profile = values.get('profile');
    const policy = SMART_ORDER_TASK_0_4_0_6_PROFILES[profile];
    const result = Object.freeze({
        profile,
        runId: values.get('run-id'),
        operationId: values.get('operation-id'),
        nonce: values.get('nonce'),
        accountScopeSha256: values.get('account-scope'),
    });
    if (
        values.size !== 5 ||
        policy?.taskId !== '13.3' ||
        !UUID.test(result.runId ?? '') ||
        !UUID.test(result.operationId ?? '') ||
        !UUID.test(result.nonce ?? '') ||
        !DIGEST.test(result.accountScopeSha256 ?? '')
    ) {
        throw new TypeError('Task 13.3 preview arguments are invalid');
    }
    return result;
}

async function readGeneration(appSupportRoot) {
    const handle = await open(
        path.join(appSupportRoot, 'runtime-api-generation'),
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
        const value = (await handle.readFile('utf8')).trim();
        if (!/^simulation:[A-Za-z0-9._:-]{1,240}$/.test(value)) {
            throw new Error('Task 13.3 preview requires simulation');
        }
        return value;
    } finally {
        await handle.close();
    }
}

export async function previewSmartOrderTask13_3(args) {
    const parsed = parse(args);
    const appSupportRoot = await realpath(
        managedSmartOrderReadonlyProbeAppSupportRoot(),
    );
    const candidate = await prepareSmartOrderTask0406CandidateOperation({
        appSupportRoot,
        expectedApiGeneration: await readGeneration(appSupportRoot),
        runId: parsed.runId,
        operationId: parsed.operationId,
        nonce: parsed.nonce,
        profile: parsed.profile,
    });
    if (candidate.accountScopeSha256 !== parsed.accountScopeSha256) {
        throw new Error('Task 13.3 preview account scope drifted');
    }
    return Object.freeze({
        ...candidate.publicSummary,
        previewOnly: true,
        observerStarted: false,
        authorizationAccepted: false,
        brokerWriteAttempted: false,
        brokerWriteNetworked: false,
        brokerAuthority: false,
    });
}

async function main() {
    process.stdout.write(
        `${JSON.stringify(await previewSmartOrderTask13_3(process.argv.slice(2)))}\n`,
    );
}

if (
    process.argv[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
    main().catch((error) => {
        process.stderr.write(
            `smart_order_task13_3_preview=unavailable:${error?.name ?? 'Error'}\n`,
        );
        process.exitCode = 1;
    });
}
