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
import { readPrivateRuntimeDiscovery } from './smart-order-runtime/private-storage.mjs';
import { readOrCreateSmartOrderTask13_2EvidenceCapability } from './smart-order-runtime/task13-2-evidence-capability.mjs';
import {
    SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION,
    createSmartOrderTask13_2FormalEvidence,
    currentSmartOrderTask13_2EvidenceSourceFingerprint,
    currentSmartOrderTask13_2VerifierFingerprint,
    verifySmartOrderTask13_2FormalEvidence,
} from './smart-order-runtime/task13-2-formal-evidence.mjs';
import { deriveSmartOrderTask13_2CurrentDayPnlEvidence } from './smart-order-runtime/task13-2-pnl-current-day-evidence.mjs';
import {
    consumeSmartOrderTaskProbeReadonlyAuthority,
    runSmartOrderTaskProbeReadonlyPreflight,
} from './smart-order-runtime/task-probe-readonly-preflight.mjs';
import { writeTaskProbeWritePreflightEvidence } from './smart-order-runtime/task-probe-write-preflight.mjs';
import { runSmartOrderTask13_2EvidenceAggregate } from './smart-order-task13-2-evidence-aggregate.mjs';

export const SMART_ORDER_TASK_13_2_PNL_EVIDENCE_IMPORT_SCHEMA_VERSION =
    'smart-order-task13.2-pnl-evidence-import/2026-08-27.1';

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
            throw new Error('current-day PnL import requires simulation');
        }
        return value;
    } finally {
        await handle.close();
    }
}

export async function importCurrentSmartOrderPnlFormalEvidence({
    now = () => Date.now(),
} = {}) {
    const appSupportRoot = await realpath(
        managedSmartOrderReadonlyProbeAppSupportRoot(),
    );
    const expectedApiGeneration =
        await readPrivateGeneration(appSupportRoot);
    const unitReport = await runSmartOrderTask0_7UnitCapabilityProbe({ now });
    const currentUnitFingerprint =
        await currentSmartOrderTask0_7UnitCapabilityFingerprints();
    const unitVerified = verifySmartOrderTask0_7UnitCapabilityEvidence({
        report: unitReport,
        expectedSourceMatrixSha256:
            currentUnitFingerprint.sourceMatrixSha256,
        nowEpochMs: now(),
    });
    const readonly = await runSmartOrderTaskProbeReadonlyPreflight({
        appSupportRoot,
        candidateOnly: true,
        expectedApiGeneration,
        now,
    });
    const privateReadonly = consumeSmartOrderTaskProbeReadonlyAuthority(
        readonly.authority,
    );
    const discovery = await readPrivateRuntimeDiscovery(
        path.join(appSupportRoot, 'smart-order', 'run', 'control-plane.json'),
        { nowEpochMs: now() },
    );
    const generatedAtEpochMs = now();
    const projection = deriveSmartOrderTask13_2CurrentDayPnlEvidence({
        account: privateReadonly.account,
        accountScopeSha256: readonly.projection.accountScopeSha256,
        apiGenerationSha256: sha256(expectedApiGeneration),
        databasePath: path.join(
            appSupportRoot,
            'smart-order',
            'database',
            'smart-orders.sqlite3',
        ),
        discoveryStartedAtEpochMs: discovery.startedAtEpochMs,
        positions: privateReadonly.positions,
        positionsSha256: readonly.projection.positionsSha256,
        quoteEvidenceSha256: readonly.projection.quote.evidenceSha256,
        tradeDate: readonly.projection.tradeDate,
        trades: privateReadonly.trades,
        unitCapability: {
            eligible: unitVerified.eligible === true,
            brokerWriteAttempted:
                unitReport.sideEffects.brokerWritesAttempted !== 0,
            brokerWriteNetworked:
                unitReport.sideEffects.brokerWritesNetworked !== 0,
            serviceMutations: unitReport.sideEffects.serviceMutations,
        },
        workingOrdersSha256: readonly.projection.workingOrdersSha256,
        nowEpochMs: generatedAtEpochMs,
    });
    const [sourceFingerprintSha256, verifierFingerprintSha256] =
        await Promise.all([
            currentSmartOrderTask13_2EvidenceSourceFingerprint(
                'pnl_current_day:full_day',
            ),
            currentSmartOrderTask13_2VerifierFingerprint(),
        ]);
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
                taskId: 'pnl_current_day',
                operationKey: 'full_day',
                runId: randomUUID(),
                observedTradeDate: projection.tradeDate,
                accountScopeSha256: projection.accountScopeSha256,
                apiGenerationSha256: projection.apiGenerationSha256,
                sourceFingerprintSha256,
                verifierFingerprintSha256,
                requestSha256: null,
                resultSha256: projection.resultSha256,
                targetIdSha256: null,
                quantityCommonLots: null,
                generatedAtEpochMs: projection.asOfEpochMs,
                validUntilEpochMs: projection.validUntilEpochMs,
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
            throw new Error('current-day PnL formal evidence did not verify');
        }
        await writeTaskProbeWritePreflightEvidence({
            evidencePath: path.join(
                privateDirectory,
                'task13-2-formal-pnl-current-day-full-day.json',
            ),
            evidence: formal,
        });
        return Object.freeze({
            schemaVersion:
                SMART_ORDER_TASK_13_2_PNL_EVIDENCE_IMPORT_SCHEMA_VERSION,
            state: 'pnl_current_day_formalized',
            observedTradeDate: projection.tradeDate,
            tradeCount: projection.tradeCount,
            dealCount: projection.dealCount,
            resultSha256: projection.resultSha256,
            evidenceHashSha256: formal.evidenceHashSha256,
            validUntilEpochMs: projection.validUntilEpochMs,
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
    const evidence = await importCurrentSmartOrderPnlFormalEvidence();
    const aggregate = await runSmartOrderTask13_2EvidenceAggregate({
        appSupportRoot: await realpath(
            managedSmartOrderReadonlyProbeAppSupportRoot(),
        ),
        nowEpochMs: Date.now(),
    });
    process.stdout.write(`${JSON.stringify({ evidence, aggregate })}\n`);
    if (!aggregate.eligible) process.exitCode = 1;
}

if (
    process.argv[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
    main().catch((error) => {
        process.stderr.write(
            `smart_order_task13_2_pnl_import=unavailable:${error?.name ?? 'Error'}\n`,
        );
        process.exitCode = 1;
    });
}
