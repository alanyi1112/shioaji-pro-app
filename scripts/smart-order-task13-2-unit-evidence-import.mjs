#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    currentSmartOrderTask0_7UnitCapabilityFingerprints,
    runSmartOrderTask0_7UnitCapabilityProbe,
    verifySmartOrderTask0_7UnitCapabilityEvidence,
} from './smart-order-task0-7-unit-capability.mjs';
import { managedSmartOrderReadonlyProbeAppSupportRoot } from './smart-order-contract-probe.mjs';
import { readOrCreateSmartOrderTask13_2EvidenceCapability } from './smart-order-runtime/task13-2-evidence-capability.mjs';
import {
    SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION,
    createSmartOrderTask13_2FormalEvidence,
    currentSmartOrderTask13_2EvidenceSourceFingerprint,
    currentSmartOrderTask13_2VerifierFingerprint,
    verifySmartOrderTask13_2FormalEvidence,
} from './smart-order-runtime/task13-2-formal-evidence.mjs';
import {
    runSmartOrderTaskProbeReadonlyPreflight,
} from './smart-order-runtime/task-probe-readonly-preflight.mjs';
import { writeTaskProbeWritePreflightEvidence } from './smart-order-runtime/task-probe-write-preflight.mjs';

export const SMART_ORDER_TASK_13_2_UNIT_EVIDENCE_IMPORT_SCHEMA_VERSION =
    'smart-order-task13.2-unit-evidence-import/2026-08-27.1';

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function readPrivateGeneration(appSupportRoot) {
    const handle = await open(
        path.join(appSupportRoot, 'runtime-api-generation'),
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
        const value = (await handle.readFile('utf8')).trim();
        if (!/^simulation:[A-Za-z0-9._:-]{1,240}$/.test(value)) {
            throw new Error('Task 0.7 formal import requires current simulation');
        }
        return value;
    } finally {
        await handle.close();
    }
}

export async function importCurrentSmartOrderTask0_7FormalEvidence({
    now = () => Date.now(),
} = {}) {
    const appSupportRoot = await realpath(
        managedSmartOrderReadonlyProbeAppSupportRoot(),
    );
    const expectedApiGeneration =
        await readPrivateGeneration(appSupportRoot);
    const report = await runSmartOrderTask0_7UnitCapabilityProbe({ now });
    const readonly = await runSmartOrderTaskProbeReadonlyPreflight({
        appSupportRoot,
        candidateOnly: true,
        expectedApiGeneration,
        now,
    });
    const currentFingerprint =
        await currentSmartOrderTask0_7UnitCapabilityFingerprints();
    const verifiedReport = verifySmartOrderTask0_7UnitCapabilityEvidence({
        report,
        expectedSourceMatrixSha256: currentFingerprint.sourceMatrixSha256,
        nowEpochMs: now(),
    });
    if (
        verifiedReport.eligible !== true ||
        report.sourceProjection?.stock?.updateDate !==
            readonly.projection.tradeDate ||
        report.sourceProjection?.stock?.contractUnit !==
            readonly.projection.contract.contractUnit ||
        report.sideEffects?.brokerWritesAttempted !== 0 ||
        report.sideEffects?.brokerWritesNetworked !== 0 ||
        report.sideEffects?.serviceMutations !== 0
    ) {
        throw new Error('Task 0.7 current evidence is not eligible');
    }
    const [sourceFingerprintSha256, verifierFingerprintSha256] =
        await Promise.all([
            currentSmartOrderTask13_2EvidenceSourceFingerprint(
                '0.7:unit_contract',
            ),
            currentSmartOrderTask13_2VerifierFingerprint(),
        ]);
    if (
        sourceFingerprintSha256 !==
        `sha256:${currentFingerprint.sourceMatrixSha256}`
    ) {
        throw new Error('Task 0.7 source lineage is not current');
    }
    const privateDirectory = await realpath(
        path.join(appSupportRoot, 'smart-order', 'private'),
    );
    const capability =
        await readOrCreateSmartOrderTask13_2EvidenceCapability(
            privateDirectory,
        );
    try {
        const formal = createSmartOrderTask13_2FormalEvidence({
            capability,
            input: {
                schemaVersion:
                    SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION,
                evidenceId: randomUUID(),
                taskId: '0.7',
                operationKey: 'unit_contract',
                runId: report.runId,
                observedTradeDate: readonly.projection.tradeDate,
                accountScopeSha256:
                    readonly.projection.accountScopeSha256,
                apiGenerationSha256: sha256(expectedApiGeneration),
                sourceFingerprintSha256,
                verifierFingerprintSha256,
                requestSha256: null,
                resultSha256: verifiedReport.resultSha256,
                targetIdSha256: null,
                quantityCommonLots: null,
                generatedAtEpochMs: Date.parse(report.generatedAt),
                validUntilEpochMs: null,
                formalEvidence: true,
                fixture: false,
                brokerWriteAttempted: false,
                brokerWriteNetworked: false,
                automaticRetryAllowed: false,
                blindCleanupAllowed: false,
                accountIdentifiersPersisted: false,
            },
        });
        const verifiedFormal = verifySmartOrderTask13_2FormalEvidence({
            capability,
            evidence: formal,
            expectedSourceFingerprintSha256: sourceFingerprintSha256,
            expectedVerifierFingerprintSha256: verifierFingerprintSha256,
        });
        if (!verifiedFormal.eligible) {
            throw new Error('Task 0.7 formal evidence did not verify');
        }
        await writeTaskProbeWritePreflightEvidence({
            evidencePath: path.join(
                privateDirectory,
                'task13-2-formal-0.7-unit-contract.json',
            ),
            evidence: formal,
        });
        return Object.freeze({
            schemaVersion:
                SMART_ORDER_TASK_13_2_UNIT_EVIDENCE_IMPORT_SCHEMA_VERSION,
            state: 'unit_contract_formalized',
            runId: report.runId,
            observedTradeDate: readonly.projection.tradeDate,
            resultSha256: verifiedReport.resultSha256,
            evidenceHashSha256: formal.evidenceHashSha256,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
            serviceMutations: 0,
            brokerAuthority: false,
        });
    } finally {
        capability.fill(0);
    }
}

async function main() {
    const result = await importCurrentSmartOrderTask0_7FormalEvidence();
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
    process.argv[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
    main().catch((error) => {
        process.stderr.write(
            `smart_order_task13_2_unit_import=unavailable:${error?.name ?? 'Error'}\n`,
        );
        process.exitCode = 1;
    });
}
