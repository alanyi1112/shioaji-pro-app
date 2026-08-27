#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './smart-order-runtime/canonical-json.mjs';
import { smartOrderGateProbeAccountScopeSha256 } from './smart-order-runtime/gate-probe-safety-envelope.mjs';
import { readPrivateRuntimeDiscovery } from './smart-order-runtime/private-storage.mjs';
import { recordSmartOrderTask03cExternalWorkingSet } from './smart-order-runtime/runtime-diagnostics.mjs';
import { readOrCreateSmartOrderTask13_2EvidenceCapability } from './smart-order-runtime/task13-2-evidence-capability.mjs';
import {
    SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION,
    createSmartOrderTask13_2FormalEvidence,
    currentSmartOrderTask13_2EvidenceSourceFingerprint,
    currentSmartOrderTask13_2VerifierFingerprint,
    verifySmartOrderTask13_2FormalEvidence,
} from './smart-order-runtime/task13-2-formal-evidence.mjs';
import {
    consumeSmartOrderTaskProbeReadonlyAuthority,
    runSmartOrderTaskProbeReadonlyPreflight,
} from './smart-order-runtime/task-probe-readonly-preflight.mjs';
import { writeTaskProbeWritePreflightEvidence } from './smart-order-runtime/task-probe-write-preflight.mjs';
import {
    SMART_ORDER_TASK_0_3C_TARGET_SCHEMA_VERSION,
    verifySmartOrderTask03cCompleteExternalSellSet,
} from './smart-order-runtime/task0-3c-working-set.mjs';
import { managedSmartOrderReadonlyProbeAppSupportRoot } from './smart-order-contract-probe.mjs';

export const SMART_ORDER_TASK_0_3C_FINALIZER_SCHEMA_VERSION =
    'smart-order-task-0.3c-finalizer/2026-08-27.1';

const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function withTask03cFinalizerStage(stage, execute) {
    try {
        return await execute();
    } catch (error) {
        if (error && typeof error === 'object') {
            Object.defineProperty(error, 'task03cFinalizerStage', {
                configurable: true,
                enumerable: false,
                value: stage,
                writable: true,
            });
        }
        throw error;
    }
}

function reconciliationAccountScopeSha256(account) {
    return sha256(
        `smart-order-reconciliation-account\u001f${canonicalJson([
            account.broker_id,
            account.account_id,
            'S',
        ])}`,
    );
}

function expectedExternalClaimId(accountScopeSha256, tradeDate, target) {
    return `external-sell-claim:${sha256(
        canonicalJson([
            accountScopeSha256,
            tradeDate,
            target.orderId,
            'TSE:2330:STK:Common',
        ]),
    ).slice(7)}`;
}

function parseArguments(args) {
    const entries = new Map();
    for (const argument of args) {
        const match = /^--([a-z-]+)=(.+)$/.exec(argument);
        if (!match || entries.has(match[1])) {
            throw new TypeError('Task 0.3c finalizer arguments are invalid');
        }
        entries.set(match[1], match[2]);
    }
    const runId = entries.get('run-id');
    const accountScopeSha256 = entries.get('account-scope');
    if (
        entries.size !== 2 ||
        !UUID.test(runId ?? '') ||
        !DIGEST.test(accountScopeSha256 ?? '')
    ) {
        throw new TypeError('Task 0.3c finalizer arguments are invalid');
    }
    return Object.freeze({
        runId: runId.toLowerCase(),
        accountScopeSha256,
    });
}

async function readPrivateJson(filePath, label) {
    const handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
        const metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            metadata.size < 2 ||
            metadata.size > 64 * 1024 ||
            (metadata.mode & 0o777) !== 0o600 ||
            (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
        ) {
            throw new Error(`${label} metadata is invalid`);
        }
        return JSON.parse(await handle.readFile('utf8'));
    } finally {
        await handle.close();
    }
}

async function readTargets(privateDirectory, runId) {
    const targets = [];
    for (const operationOrdinal of [1, 2]) {
        const target = await readPrivateJson(
            path.join(
                privateDirectory,
                `task0-3c-target-${runId}-o${operationOrdinal}.json`,
            ),
            `Task 0.3c target ${operationOrdinal}`,
        );
        if (
            target?.schemaVersion !== SMART_ORDER_TASK_0_3C_TARGET_SCHEMA_VERSION ||
            target.originRunId !== runId ||
            target.operationOrdinal !== operationOrdinal
        ) {
            throw new Error('Task 0.3c target lineage is invalid');
        }
        targets.push(Object.freeze(target));
    }
    return Object.freeze(targets);
}

export function verifySmartOrderTask03cRepositoryProjection({
    account,
    databasePath,
    discovery,
    nowEpochMs,
    targets,
    tradeDate,
}) {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
        database.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=500;');
        const head = database
            .prepare(`
                SELECT * FROM external_sell_visibility_heads
                 WHERE account_broker_ref=? AND account_id_ref=?
                   AND trade_date=? AND contract_key='TSE:2330:STK:Common'
            `)
            .get(account.broker_id, account.account_id, tradeDate);
        const reconciliationScope = reconciliationAccountScopeSha256(account);
        const expectedClaimIds = targets
            .map((target) =>
                expectedExternalClaimId(
                    reconciliationScope,
                    tradeDate,
                    target,
                ),
            )
            .sort();
        const claims = database
            .prepare(`
                SELECT claims.exit_claim_id, claims.external_lineage,
                       claims.contract_key, claims.quantity_shares,
                       claims.state, claims.position_lineage_id,
                       bindings.source_revision, bindings.source_sequence,
                       bindings.source_evidence_hash,
                       bindings.position_revision, bindings.position_shares,
                       bindings.working_set_hash, bindings.binding_kind,
                       bindings.visibility_head_revision
                  FROM exit_claims AS claims
                  JOIN exit_claim_visibility_bindings AS bindings
                    USING(exit_claim_id)
                 WHERE claims.account_broker_ref=? AND claims.account_id_ref=?
                   AND bindings.trade_date=?
                   AND claims.contract_key='TSE:2330:STK:Common'
                   AND claims.external_lineage=1
                   AND claims.state='broker_working'
                   AND bindings.binding_kind='external_projection'
                 ORDER BY claims.exit_claim_id
            `)
            .all(account.broker_id, account.account_id, tradeDate);
        if (
            !head ||
            head.collection_complete !== 1 ||
            head.valid_until_epoch_ms <= nowEpochMs ||
            head.observed_at_epoch_ms < discovery.startedAtEpochMs ||
            claims.length !== 2 ||
            canonicalJson(claims.map((claim) => claim.exit_claim_id)) !==
                canonicalJson(expectedClaimIds) ||
            claims.some(
                (claim) =>
                    claim.external_lineage !== 1 ||
                    claim.contract_key !== 'TSE:2330:STK:Common' ||
                    claim.quantity_shares !== targets[0].contractUnit ||
                    claim.state !== 'broker_working' ||
                    claim.binding_kind !== 'external_projection' ||
                    claim.source_revision !== head.source_revision ||
                    claim.source_sequence !== head.source_sequence ||
                    claim.source_evidence_hash !== head.source_evidence_hash ||
                    claim.position_revision !== head.position_revision ||
                    claim.position_shares !== head.position_shares ||
                    claim.working_set_hash !== head.working_set_hash ||
                    claim.visibility_head_revision !== head.revision,
            ) ||
            new Set(claims.map((claim) => claim.position_lineage_id)).size !== 1
        ) {
            throw new Error(
                'Task 0.3c Runtime has not ingested the exact complete external sell set',
            );
        }
        return Object.freeze({
            externalClaimIdsSha256: sha256(canonicalJson(expectedClaimIds)),
            workingSetHash: head.working_set_hash,
            sourceEvidenceSha256: head.source_evidence_hash,
            visibilityRevision: head.revision,
            reconciliationRevision: head.revision,
            observedAtEpochMs: head.observed_at_epoch_ms,
        });
    } finally {
        database.close();
    }
}

async function waitForRepositoryProjection(input, now) {
    const deadline = now() + 20_000;
    let lastError;
    while (now() < deadline) {
        try {
            return verifySmartOrderTask03cRepositoryProjection({
                ...input,
                nowEpochMs: now(),
            });
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    }
    throw new Error('Task 0.3c Runtime ingestion did not converge in time', {
        cause: lastError,
    });
}

export async function runSmartOrderTask03cFinalizer({
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
    const discovery = await readPrivateRuntimeDiscovery(
        path.join(appSupportRoot, 'smart-order', 'run', 'control-plane.json'),
        { nowEpochMs: now() },
    );
    const expectedApiGeneration = (
        await open(
            path.join(appSupportRoot, 'runtime-api-generation'),
            fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
        ).then(async (handle) => {
            try {
                return (await handle.readFile('utf8')).trim();
            } finally {
                await handle.close();
            }
        })
    );
    if (!/^simulation:[A-Za-z0-9._:-]{1,240}$/.test(expectedApiGeneration)) {
        throw new Error('Task 0.3c finalizer requires current simulation');
    }
    const targets = await withTask03cFinalizerStage('target_lineage', () =>
        readTargets(privateDirectory, parsed.runId),
    );
    const readonly = await withTask03cFinalizerStage(
        'account_readonly_preflight',
        () =>
            runSmartOrderTaskProbeReadonlyPreflight({
                appSupportRoot,
                expectedApiGeneration,
                candidateOnly: true,
                now,
            }),
    );
    const privateReadonly = consumeSmartOrderTaskProbeReadonlyAuthority(
        readonly.authority,
    );
    if (
        readonly.projection.accountScopeSha256 !== parsed.accountScopeSha256 ||
        targets.some(
            (target) =>
                target.accountScopeSha256 !== parsed.accountScopeSha256 ||
                target.tradeDate !== readonly.projection.tradeDate,
        ) ||
        smartOrderGateProbeAccountScopeSha256(privateReadonly.account) !==
            parsed.accountScopeSha256
    ) {
        throw new Error('Task 0.3c finalizer account or trade date drifted');
    }
    const liveSet = await withTask03cFinalizerStage('live_working_set', () =>
        verifySmartOrderTask03cCompleteExternalSellSet({
            account: privateReadonly.account,
            contractUnit: privateReadonly.contract.contractUnit,
            positions: privateReadonly.positions,
            targets,
            trades: privateReadonly.trades,
        }),
    );
    const observationNowEpochMs = now();
    const sourceEvidenceHash = sha256(
        canonicalJson({
            schemaVersion: SMART_ORDER_TASK_0_3C_FINALIZER_SCHEMA_VERSION,
            accountScopeSha256: parsed.accountScopeSha256,
            apiGenerationSha256: readonly.projection.apiGenerationSha256,
            identifierSetSha256: liveSet.identifierSetSha256,
            positionsSha256: readonly.projection.positionsSha256,
            runId: parsed.runId,
            tradeDate: readonly.projection.tradeDate,
            workingOrdersSha256: readonly.projection.workingOrdersSha256,
        }),
    );
    await withTask03cFinalizerStage('repository_ingestion', () =>
        recordSmartOrderTask03cExternalWorkingSet({
            appSupportRoot,
            expectedApiGeneration,
            observation: {
                accountBrokerRef: privateReadonly.account.broker_id,
                accountIdRef: privateReadonly.account.account_id,
                accountScopeSha256:
                    reconciliationAccountScopeSha256(
                        privateReadonly.account,
                    ),
                claims: targets.map((target) => ({
                    brokerOrderId: target.orderId,
                    evidenceHash: sourceEvidenceHash,
                    exitClaimId: expectedExternalClaimId(
                        reconciliationAccountScopeSha256(
                            privateReadonly.account,
                        ),
                        readonly.projection.tradeDate,
                        target,
                    ),
                    quantityShares: privateReadonly.contract.contractUnit,
                })),
                contractKey: 'TSE:2330:STK:Common',
                observedAtEpochMs: observationNowEpochMs,
                positionLineageId: liveSet.position.positionLineageRef,
                positionRevision: readonly.projection.positionsSha256,
                positionShares: liveSet.position.quantityShares,
                sourceEvidenceHash,
                sourceRevision: liveSet.identifierSetSha256,
                sourceSequence: discovery.startedAtEpochMs,
                tradeDate: readonly.projection.tradeDate,
                validUntilEpochMs: observationNowEpochMs + 5_000,
            },
            now,
        }),
    );
    const databasePath = path.join(
        appSupportRoot,
        'smart-order',
        'database',
        'smart-orders.sqlite3',
    );
    const metadata = await lstat(databasePath);
    if (
        metadata.isSymbolicLink() ||
        !metadata.isFile() ||
        (metadata.mode & 0o077) !== 0
    ) {
        throw new Error('Task 0.3c repository artifact is not private');
    }
    const repository = await withTask03cFinalizerStage(
        'repository_projection',
        () =>
            waitForRepositoryProjection(
                {
                    account: privateReadonly.account,
                    databasePath,
                    discovery,
                    targets,
                    tradeDate: readonly.projection.tradeDate,
                },
                now,
            ),
    );
    const resultSha256 = sha256(
        canonicalJson({
            schemaVersion: SMART_ORDER_TASK_0_3C_FINALIZER_SCHEMA_VERSION,
            runId: parsed.runId,
            accountScopeSha256: parsed.accountScopeSha256,
            tradeDate: readonly.projection.tradeDate,
            identifierSetSha256: liveSet.identifierSetSha256,
            externalClaimIdsSha256: repository.externalClaimIdsSha256,
            workingSetHash: repository.workingSetHash,
            sourceEvidenceSha256: repository.sourceEvidenceSha256,
            visibilityRevision: repository.visibilityRevision,
            reconciliationRevision: repository.reconciliationRevision,
            sidecarRestartedBeforeObservation:
                repository.observedAtEpochMs >= discovery.startedAtEpochMs,
        }),
    );
    const requestSha256 = sha256(
        canonicalJson(targets.map((target) => target.targetRevision)),
    );
    const [sourceFingerprintSha256, verifierFingerprintSha256] =
        await Promise.all([
            currentSmartOrderTask13_2EvidenceSourceFingerprint(
                '0.3c:external_working_sells_complete',
            ),
            currentSmartOrderTask13_2VerifierFingerprint(),
        ]);
    const capability = await readOrCreateSmartOrderTask13_2EvidenceCapability(
        privateDirectory,
    );
    try {
        const formal = createSmartOrderTask13_2FormalEvidence({
            capability,
            input: {
                schemaVersion:
                    SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION,
                evidenceId: randomUUID(),
                taskId: '0.3c',
                operationKey: 'external_working_sells_complete',
                runId: parsed.runId,
                observedTradeDate: readonly.projection.tradeDate,
                accountScopeSha256: parsed.accountScopeSha256,
                apiGenerationSha256: sha256(expectedApiGeneration),
                sourceFingerprintSha256,
                verifierFingerprintSha256,
                requestSha256,
                resultSha256,
                targetIdSha256: null,
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
        const verified = verifySmartOrderTask13_2FormalEvidence({
            capability,
            evidence: formal,
            expectedSourceFingerprintSha256: sourceFingerprintSha256,
            expectedVerifierFingerprintSha256: verifierFingerprintSha256,
        });
        if (!verified.eligible) {
            throw new Error('Task 0.3c formal evidence did not verify');
        }
        await writeTaskProbeWritePreflightEvidence({
            evidencePath: path.join(
                privateDirectory,
                'task13-2-formal-0.3c-external-working-sells-complete.json',
            ),
            evidence: formal,
        });
        return Object.freeze({
            schemaVersion: SMART_ORDER_TASK_0_3C_FINALIZER_SCHEMA_VERSION,
            state: 'external_working_sells_complete',
            runId: parsed.runId,
            accountRef: `…${parsed.accountScopeSha256.slice(-12)}`,
            identifierSetSha256: liveSet.identifierSetSha256,
            externalClaimIdsSha256: repository.externalClaimIdsSha256,
            resultSha256,
            formalEvidenceEligible: true,
            formalEvidenceHashSha256: formal.evidenceHashSha256,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
            writeMasterAuthority: false,
            brokerAuthority: false,
        });
    } finally {
        capability.fill(0);
    }
}

async function main() {
    const result = await runSmartOrderTask03cFinalizer({
        args: process.argv.slice(2),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
    process.argv[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
    main().catch((error) => {
        const stage =
            typeof error?.task03cFinalizerStage === 'string' &&
            /^[a-z0-9_]{1,80}$/.test(error.task03cFinalizerStage)
                ? error.task03cFinalizerStage
                : 'unknown';
        process.stderr.write(
            `smart_order_task0_3c_finalize=unavailable:${error?.name ?? 'Error'}:${stage}\n`,
        );
        process.exitCode = 1;
    });
}
