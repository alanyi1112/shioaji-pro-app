import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
    assertTask03OperationLineageAvailable,
    buildTask03AuthorizedEnvelope,
    classifyTask03PlaceResponse,
    openPinnedSimulationConnection,
    task03AuthorizedEventTriggerPaths,
    writeExclusivePrivateJson,
} from './smart-order-task0-3-event-trigger.mjs';
import {
    SMART_ORDER_SIMULATION_WRITE_PREFLIGHT_EVIDENCE_SCHEMA_VERSION,
    createSimulationWritePreflightEvidence,
    readVerifiedSimulationWritePreflightEvidence,
} from './smart-order-runtime/simulation-write-preflight-evidence.mjs';
import {
    canonicalManualStockBrokerWriteRequest,
} from './smart-order-runtime/manual-broker-write-contract.mjs';
import {
    SMART_ORDER_TASK_0_3_MAX_READINESS_WAIT_MS,
} from './smart-order-runtime/task0-3-observation-coordination.mjs';

const account = Object.freeze({
    broker_id: 'SIM-BROKER',
    account_id: 'SIM-ACCOUNT',
    account_type: 'S',
});
const temporaryDirectories = [];
const servers = [];
const preflightCapability = Buffer.alloc(32, 0x4d);
const digest = (character) => `sha256:${character.repeat(64)}`;

function preflightInput(nowEpochMs, overrides = {}) {
    const accountScopeSha256 = digest('a');
    return {
        schemaVersion:
            SMART_ORDER_SIMULATION_WRITE_PREFLIGHT_EVIDENCE_SCHEMA_VERSION,
        sourceFingerprintSha256: digest('1'),
        createdAtEpochMs: nowEpochMs,
        coordinationId: '123e4567-e89b-42d3-a456-426614174000',
        operationIdSha256: digest('2'),
        operation: 'place',
        requestSha256: digest('3'),
        envelopeSha256: digest('4'),
        cliAuthorizationSha256: digest('d'),
        accountScopeSha256,
        maskedAccountRef: `…${accountScopeSha256.slice(-12)}`,
        accountType: 'S',
        modeMarker: 'simulation',
        apiSimulation: true,
        apiGenerationSha256: digest('5'),
        sharedModeLeaseHeld: true,
        modeExecutionLeaseEvidenceHash: digest('6'),
        initialSimulationAttestationSha256: digest('7'),
        adjacentSimulationAttestationSha256: digest('8'),
        readinessCurrent: true,
        readinessEvidenceSha256: digest('9'),
        readinessDeadlineEpochMs: nowEpochMs + 30_000,
        quantityUnit: 'CommonLot',
        requestedQuantity: 1,
        maximumQuantity: 1,
        caLoaded: false,
        productionLoaded: false,
        automaticRetryAllowed: false,
        cleanupAllowed: false,
        accountIdentifiersPersisted: false,
        brokerWriteAttempted: false,
        brokerWriteNetworked: false,
        ...overrides,
    };
}

function preflightExpected(input) {
    return {
        accountScopeSha256: input.accountScopeSha256,
        apiGenerationSha256: input.apiGenerationSha256,
        coordinationId: input.coordinationId,
        cliAuthorizationSha256: input.cliAuthorizationSha256,
        envelopeSha256: input.envelopeSha256,
        operationIdSha256: input.operationIdSha256,
        readinessEvidenceSha256: input.readinessEvidenceSha256,
        requestSha256: input.requestSha256,
        sourceFingerprintSha256: input.sourceFingerprintSha256,
    };
}

afterEach(async () => {
    await Promise.all(
        servers.splice(0).map(
            (server) =>
                new Promise((resolve) => server.close(() => resolve())),
        ),
    );
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) =>
            rm(directory, { recursive: true, force: true }),
        ),
    );
});

function responseTrade(status = 'Submitted', overrides = {}) {
    return {
        contract: {
            code: '2330',
            exchange: 'TSE',
            security_type: 'STK',
        },
        order: {
            account,
            action: 'Buy',
            id: 'task03-trade-1',
            order_cond: 'Cash',
            order_lot: 'Common',
            order_type: 'ROD',
            ordno: '000001',
            price: 115,
            price_type: 'LMT',
            quantity: 1,
            seqno: '000001',
        },
        status: {
            cancel_quantity: 0,
            deal_quantity: 0,
            id: 'task03-order-1',
            order_quantity: 1,
            status,
        },
        ...overrides,
    };
}

describe('Task 0.3 one-shot simulation event trigger', () => {
    it('CLI rejection only emits one fixed unclassified stage and never the exception text', () => {
        const scriptPath = fileURLToPath(
            new URL('./smart-order-task0-3-event-trigger.mjs', import.meta.url),
        );
        const rejected = spawnSync(
            process.execPath,
            [scriptPath, '--confirm=invalid-user-input'],
            { encoding: 'utf8', timeout: 5_000 },
        );
        expect(rejected.status).toBe(1);
        expect(rejected.stdout).toBe('');
        expect(rejected.stderr).toBe(
            'smart_order_task0_3_event_trigger=unavailable:unclassified\n',
        );
        expect(rejected.stderr).not.toContain('invalid-user-input');
        expect(rejected.stderr).not.toContain('account scope pin');
    });

    it('builds only the explicitly authorized 2330 Buy LMT 115 one-CommonLot ROD envelope', () => {
        const canonical = buildTask03AuthorizedEnvelope({
            account,
            nowEpochMs: Date.parse('2026-08-22T04:00:00.000Z'),
            runId: '123e4567-e89b-42d3-a456-426614174000',
            operationId: '123e4567-e89b-42d3-a456-426614174001',
            nonce: '123e4567-e89b-42d3-a456-426614174002',
        });
        expect(canonical.request).toEqual({
            schemaVersion:
                'smart-order-manual-broker-write-request/2026-08-14.1',
            operation: 'place',
            brokerPath: '/api/v1/order/place_order',
            payload: {
                contract: {
                    security_type: 'STK',
                    region: 'TW',
                    exchange: 'TSE',
                    code: '2330',
                    target_code: null,
                },
                stock_order: {
                    action: 'Buy',
                    price: 115,
                    quantity: 1,
                    price_type: 'LMT',
                    order_type: 'ROD',
                    order_lot: 'Common',
                    account,
                },
            },
        });
        expect(canonical.envelope).toMatchObject({
            operation: 'place',
            quantityCommonLots: 1,
            target: null,
            tradeDate: '2026-08-22',
        });
    });

    it('keeps the production CLI single-place, O_EXCL, double-attested, and no-cleanup', async () => {
        const source = await readFile(
            fileURLToPath(
                new URL('./smart-order-task0-3-event-trigger.mjs', import.meta.url),
            ),
            'utf8',
        );
        expect(source.match(/pinnedConnection\.place\(/g)).toHaveLength(1);
        expect(source).not.toContain('/api/v1/order/update_');
        expect(source).not.toContain('/api/v1/order/cancel_order');
        expect(source).not.toContain('custom_field');
        expect(source).not.toContain('confirmed_by_bounded_reconciliation');
        expect(source).not.toContain('task0-3-authorized-envelope.json');
        expect(source).not.toContain("error?.name ?? 'Error'");
        expect(source).toContain(
            'smart_order_task0_3_event_trigger=unavailable:${failureStage}',
        );
        for (const stage of [
            'observer_authorization',
            'mode_admission',
            'pinned_simulation_info',
            'adjacent_simulation_attestation',
            'observer_liveness_preflight',
            'preflight_evidence',
            'observer_liveness_final',
            'durable_ledger',
            'broker_dispatch_or_reconciliation',
        ]) {
            expect(source).toContain(`setFailureStage('${stage}')`);
        }
        expect(source).toContain('fsConstants.O_EXCL');
        expect(source).toContain('modeLease = await admission.acquire()');
        expect(SMART_ORDER_TASK_0_3_MAX_READINESS_WAIT_MS).toBe(30_000);
        expect(source).toContain(
            'task03Coordination.waitForReady({\n            timeoutMs: SMART_ORDER_TASK_0_3_MAX_READINESS_WAIT_MS,',
        );
        expect(source.indexOf('task03Coordination.waitForReady({')).toBeLessThan(
            source.indexOf('canonical = buildTask03AuthorizedEnvelope({'),
        );
        expect(
            source.indexOf('canonical = buildTask03AuthorizedEnvelope({'),
        ).toBeLessThan(
            source.indexOf('runSmartOrderGateProbeCli({'),
        );
        expect(source).toContain(
            'const adjacent = await modeLease.revalidate({\n            operationId:',
        );
        expect(source.indexOf('writeExclusivePrivateJson(ledgerPath')).toBeLessThan(
            source.indexOf('pinnedConnection.place('),
        );
        expect(source.indexOf('writeExclusivePrivateJson(ledgerPath')).toBeGreaterThan(
            source.lastIndexOf('task03Coordination.revalidateReady('),
        );
        expect(source.indexOf('writeExclusivePrivateJson(ledgerPath')).toBeGreaterThan(
            source.indexOf('readVerifiedSimulationWritePreflightEvidence({'),
        );
        expect(source.indexOf('openPinnedSimulationConnection()')).toBeLessThan(
            source.indexOf('writeExclusivePrivateJson(ledgerPath'),
        );
        expect(source).toContain(
            'Task 0.3 dispatch evidence expired after durable ledger fsync',
        );
        expect(
            source.indexOf('writeExclusivePrivateJson(\n            preflightEvidencePath'),
        ).toBeLessThan(source.indexOf('pinnedConnection.place('));
        expect(source.indexOf('task03Coordination.revalidateReady(')).toBeLessThan(
            source.indexOf('pinnedConnection.place('),
        );
        expect(source.match(/task03Coordination\.revalidateReady\(/g)).toHaveLength(2);
        expect(
            source.lastIndexOf('task03Coordination.revalidateReady('),
        ).toBeLessThan(source.indexOf('pinnedConnection.place('));
        expect(source).toContain('brokerWriteAttempted: false');
        expect(source).toContain('brokerWriteNetworked: false');
        expect(source).toContain(
            'consumeSimulationWritePreflightEvidenceReceipt(',
        );
        expect(source).toContain(
            'canonical.request.payload,\n                durableEvidenceReceipt,',
        );
        expect(source).toContain('maximumQuantity:');
        expect(source).toContain('caLoaded: adjacent.caLoaded');
        expect(source).toContain('productionLoaded: adjacent.productionLoaded');
        expect(source.indexOf('writeExclusivePrivateJson(resultPath')).toBeLessThan(
            source.indexOf('coordinator.completeOperation('),
        );
        expect(source.indexOf('coordinator.completeOperation(')).toBeLessThan(
            source.indexOf('task03Coordination.writeProof('),
        );
        expect(source).toContain("state: 'dispatching_unknown_no_retry'");
        expect(source).toContain("socket.once('connect', dispatchOnVerifiedSocket)");
        expect(source).toContain('expectedSocket: info.socket');
        expect(source).toContain('automaticRetryAllowed: false');
        expect(source).toContain('cleanupAllowed: false');
    });

    it('uses one pinned TCP connection and requires one durable preflight receipt before the place byte', async () => {
        const observations = [];
        const server = createServer((request, response) => {
            observations.push({
                path: request.url,
                remotePort: request.socket.remotePort,
            });
            response.setHeader('content-type', 'application/json');
            if (request.url === '/api/v1/info') {
                response.end(JSON.stringify({ simulation: true }));
            } else {
                response.end(JSON.stringify(responseTrade()));
            }
        });
        servers.push(server);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        const directory = await mkdtemp(
            path.join(tmpdir(), 'task13-1-pinned-write-'),
        );
        temporaryDirectories.push(directory);
        const nowEpochMs = Date.now();
        const authorized = buildTask03AuthorizedEnvelope({
            account,
            nowEpochMs,
            runId: '123e4567-e89b-42d3-a456-426614174000',
            operationId: '123e4567-e89b-42d3-a456-426614174001',
            nonce: '123e4567-e89b-42d3-a456-426614174002',
        });
        const evidenceInput = preflightInput(nowEpochMs, {
            requestSha256: authorized.envelope.requestSha256,
        });
        const evidence = createSimulationWritePreflightEvidence({
            capability: preflightCapability,
            input: evidenceInput,
        });
        const evidencePath = path.join(directory, 'preflight.json');
        await writeFile(evidencePath, `${JSON.stringify(evidence)}\n`, {
            mode: 0o600,
        });
        const verified = await readVerifiedSimulationWritePreflightEvidence({
            capability: preflightCapability,
            evidencePath,
            expected: preflightExpected(evidenceInput),
            nowEpochMs: nowEpochMs + 1,
        });
        const alternativeWrite = canonicalManualStockBrokerWriteRequest({
            ...authorized.request,
            payload: {
                ...authorized.request.payload,
                stock_order: {
                    ...authorized.request.payload.stock_order,
                    price: 116,
                },
            },
        });
        const alternativeInput = preflightInput(nowEpochMs + 2, {
            coordinationId: '223e4567-e89b-42d3-a456-426614174000',
            requestSha256: alternativeWrite.requestSha256,
        });
        const alternativeEvidence = createSimulationWritePreflightEvidence({
            capability: preflightCapability,
            input: alternativeInput,
        });
        const alternativePath = path.join(directory, 'alternative.json');
        await writeFile(
            alternativePath,
            `${JSON.stringify(alternativeEvidence)}\n`,
            { mode: 0o600 },
        );
        const alternativeVerified =
            await readVerifiedSimulationWritePreflightEvidence({
                capability: preflightCapability,
                evidencePath: alternativePath,
                expected: preflightExpected(alternativeInput),
                nowEpochMs: nowEpochMs + 3,
            });
        const connection = await openPinnedSimulationConnection({
            port: address.port,
        });
        await expect(
            connection.place(authorized.request.payload),
        ).rejects.toThrow('durable preflight evidence receipt');
        await expect(
            connection.place(authorized.request.payload, {
                ...verified.durableEvidenceReceipt,
            }),
        ).rejects.toThrow('durable preflight evidence receipt');
        await expect(
            connection.place(
                authorized.request.payload,
                alternativeVerified.durableEvidenceReceipt,
            ),
        ).rejects.toThrow('does not bind this broker write');
        const placed = await connection.place(
            authorized.request.payload,
            verified.durableEvidenceReceipt,
        );
        placed.bodyBytes.fill(0);
        await expect(
            connection.place(
                authorized.request.payload,
                verified.durableEvidenceReceipt,
            ),
        ).rejects.toThrow('durable preflight evidence receipt');
        connection.close();
        expect(observations.map((item) => item.path)).toEqual([
            '/api/v1/info',
            '/api/v1/order/place_order',
        ]);
        expect(new Set(observations.map((item) => item.remotePort)).size).toBe(1);
    });

    it('classifies only an exact HTTP 200 trade and keeps non-200 or mismatched responses unknown', () => {
        const submitted = classifyTask03PlaceResponse(
            {
                statusCode: 200,
                bodyBytes: Buffer.from(JSON.stringify(responseTrade())),
            },
            account,
        );
        expect(submitted).toMatchObject({
            state: 'confirmed',
            trade: { tradeId: 'task03-trade-1' },
        });
        const failed = classifyTask03PlaceResponse(
            {
                statusCode: 200,
                bodyBytes: Buffer.from(JSON.stringify(responseTrade('Failed'))),
            },
            account,
        );
        expect(failed.state).toBe('broker_rejected_terminal');
        const pendingWithZeroStatusQuantity = classifyTask03PlaceResponse(
            {
                statusCode: 200,
                bodyBytes: Buffer.from(
                    JSON.stringify({
                        ...responseTrade('PendingSubmit'),
                        status: {
                            ...responseTrade('PendingSubmit').status,
                            order_quantity: 0,
                        },
                    }),
                ),
            },
            account,
        );
        expect(pendingWithZeroStatusQuantity).toMatchObject({
            state: 'confirmed',
            trade: { orderQuantity: 1 },
        });
        const ambiguousBytes = Buffer.from('{}');
        expect(() =>
            classifyTask03PlaceResponse(
                { statusCode: 429, bodyBytes: ambiguousBytes },
                account,
            ),
        ).toThrow('outcome unknown');
        expect([...ambiguousBytes]).toEqual([0, 0]);
        expect(() =>
            classifyTask03PlaceResponse(
                {
                    statusCode: 200,
                    bodyBytes: Buffer.from(
                        JSON.stringify(
                            responseTrade('Submitted', {
                                order: {
                                    ...responseTrade().order,
                                    price: 116,
                                },
                            }),
                        ),
                    ),
                },
                account,
            ),
        ).toThrow('authorized scope');
    });

    it('durably admits only one concurrent dispatch ledger and leaves unknown-before-result evidence', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'task03-ledger-'));
        temporaryDirectories.push(directory);
        const ledgerPath = path.join(directory, 'dispatch.json');
        const record = {
            state: 'dispatching_unknown_no_retry',
            brokerWriteAttempted: true,
            brokerWriteNetworked: true,
            automaticRetryAllowed: false,
            cleanupAllowed: false,
        };
        const writes = await Promise.allSettled([
            writeExclusivePrivateJson(ledgerPath, record),
            writeExclusivePrivateJson(ledgerPath, record),
        ]);
        expect(writes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(writes.filter((result) => result.status === 'rejected')).toHaveLength(1);
        expect(JSON.parse(await readFile(ledgerPath, 'utf8'))).toEqual(record);
        expect((await stat(ledgerPath)).mode & 0o777).toBe(0o600);
        expect(await readFile(ledgerPath, 'utf8')).toContain(
            'dispatching_unknown_no_retry',
        );
    });

    it('uses a separate O_EXCL ledger per coordination while preserving legacy unknown replay denial', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'task03-lineage-'));
        temporaryDirectories.push(directory);
        const legacyCoordinationId = '123e4567-e89b-42d3-a456-426614174010';
        const currentCoordinationId = '123e4567-e89b-42d3-a456-426614174011';
        const legacyPaths = task03AuthorizedEventTriggerPaths({
            privateDirectory: directory,
            coordinationId: legacyCoordinationId,
        });
        await writeExclusivePrivateJson(legacyPaths.legacyLedgerPath, {
            schemaVersion:
                'smart-order-task-0.3-event-trigger/2026-08-22.1',
            state: 'dispatching_unknown_no_retry',
            coordinationId: legacyCoordinationId,
            brokerWriteAttempted: true,
            brokerWriteNetworked: true,
            automaticRetryAllowed: false,
            cleanupAllowed: false,
            accountIdentifiersPersisted: false,
        });

        await expect(
            assertTask03OperationLineageAvailable({
                privateDirectory: directory,
                coordinationId: legacyCoordinationId,
            }),
        ).rejects.toThrow('legacy durable ledger forbids coordination replay');

        const currentPaths = await assertTask03OperationLineageAvailable({
            privateDirectory: directory,
            coordinationId: currentCoordinationId,
        });
        expect(currentPaths.ledgerPath).toBe(
            path.join(
                directory,
                `task0-3-authorized-event-trigger-${currentCoordinationId}.json`,
            ),
        );
        expect(currentPaths.resultPath).toBe(
            path.join(
                directory,
                `task0-3-authorized-event-trigger-result-${currentCoordinationId}.json`,
            ),
        );

        await writeExclusivePrivateJson(currentPaths.ledgerPath, {
            state: 'dispatching_unknown_no_retry',
        });
        await expect(
            assertTask03OperationLineageAvailable({
                privateDirectory: directory,
                coordinationId: currentCoordinationId,
            }),
        ).rejects.toThrow('operation replay is forbidden');
    });

    it('fails closed when legacy lineage is malformed or partial current evidence exists', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'task03-lineage-'));
        temporaryDirectories.push(directory);
        const coordinationId = '123e4567-e89b-42d3-a456-426614174012';
        const paths = task03AuthorizedEventTriggerPaths({
            privateDirectory: directory,
            coordinationId,
        });
        await writeFile(paths.legacyLedgerPath, '{"schemaVersion":"old"}\n', {
            mode: 0o600,
        });
        await expect(
            assertTask03OperationLineageAvailable({
                privateDirectory: directory,
                coordinationId,
            }),
        ).rejects.toThrow('legacy durable ledger is invalid');

        await rm(paths.legacyLedgerPath);
        await writeExclusivePrivateJson(paths.preflightEvidencePath, {
            coordinationId,
        });
        await expect(
            assertTask03OperationLineageAvailable({
                privateDirectory: directory,
                coordinationId,
            }),
        ).rejects.toThrow('durable preflight evidence already exists');

    });
});
