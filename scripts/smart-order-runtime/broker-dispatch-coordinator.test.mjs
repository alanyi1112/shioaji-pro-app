import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: execFileMock }));
vi.mock('node:util', () => ({
    promisify: () => async (file, args, options) =>
        execFileMock(file, args, options),
}));
import {
    SMART_ORDER_BROKER_DISPATCH_COORDINATOR_SCHEMA_VERSION,
    acquireSmartOrderBrokerDispatchTransportOperation,
    createDisabledSmartOrderBrokerAdapter,
    createFencedSmartOrderBrokerAdapter,
    createSmartOrderBrokerDispatchCoordinator as createRawSmartOrderBrokerDispatchCoordinator,
    isIssuedSmartOrderBrokerDispatchAuthority,
    revalidateSmartOrderBrokerDispatchAuthorityImmediatelyBeforeWrite,
} from './broker-dispatch-coordinator.mjs';
import { createSmartOrderResourceCoordinator } from './resource-coordinator.mjs';
import { openSmartOrderRepository } from './repository-client.mjs';
import { SMART_ORDER_REPOSITORY_EXPECTATION_SCHEMA_VERSION } from './private-storage.mjs';
import { createSmartOrderModeWriteAdmission } from './mode-write-admission.mjs';
import { acquireExclusiveModeExecutionLease } from './mode-execution-lease.mjs';
import { canonicalSmartOrderDraft } from './canonical-strategy-draft-fixtures.mjs';
import { canonicalJson } from './canonical-json.mjs';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const PAYLOAD = Object.freeze({ price: '100.00', quantity: '1' });
const PAYLOAD_HASH = `sha256:${createHash('sha256')
    .update(JSON.stringify(PAYLOAD))
    .digest('hex')}`;
const roots = [];
const clients = [];
const resourceCoordinators = [];
const resourceCoordinatorByAdapter = new WeakMap();
const repositoryDatabasePathByClient = new WeakMap();
const TEST_EXPOSURE_OBSERVED_AT_EPOCH_MS = 1_786_377_599_000;
const PROCESS_IDENTITY = '12345 1 Fri Aug 22 08:30:00 2026\n';

afterEach(async () => {
    for (const coordinator of resourceCoordinators.splice(0)) {
        coordinator.close();
    }
    await Promise.all(clients.splice(0).map((client) => client.close()));
    await Promise.all(
        roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
});

function createSmartOrderBrokerDispatchCoordinator(options) {
    const resourceCoordinator =
        resourceCoordinatorByAdapter.get(options.adapter) ??
        createSmartOrderResourceCoordinator();
    if (!resourceCoordinatorByAdapter.has(options.adapter)) {
        resourceCoordinators.push(resourceCoordinator);
    }
    return createRawSmartOrderBrokerDispatchCoordinator({
        ...options,
        resourceCoordinator,
        revalidateRuntimeAuthorityImmediatelyBeforeTransport:
            options.revalidateRuntimeAuthorityImmediatelyBeforeTransport ??
            (() => {}),
    });
}

async function repository() {
    const root = await mkdtemp(path.join(tmpdir(), 'smart-order-dispatch-'));
    roots.push(root);
    await chmod(root, 0o700);
    const smartOrderRoot = path.join(root, 'smart-order');
    const databaseDirectory = path.join(smartOrderRoot, 'database');
    const privateDirectory = path.join(smartOrderRoot, 'private');
    const backupDirectory = path.join(smartOrderRoot, 'backups');
    await mkdir(databaseDirectory, { recursive: true, mode: 0o700 });
    await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    await chmod(smartOrderRoot, 0o700);
    const databasePath = path.join(databaseDirectory, 'smart-orders.sqlite3');
    const installationId = 'a6a4d061-43f3-4d1f-a8c4-71f5e47d54da';
    const installationIdPath = path.join(privateDirectory, 'installation-id');
    const identityKeyPath = path.join(privateDirectory, 'identity-hmac-key.bin');
    const repositoryExpectationPath = path.join(
        privateDirectory,
        'repository-expectation.json',
    );
    await writeFile(installationIdPath, `${installationId}\n`, { mode: 0o600 });
    await writeFile(identityKeyPath, randomBytes(32), { mode: 0o600 });
    await writeFile(
        repositoryExpectationPath,
        `${JSON.stringify({
            schemaVersion: SMART_ORDER_REPOSITORY_EXPECTATION_SCHEMA_VERSION,
            databasePathSha256: `sha256:${createHash('sha256')
                .update(path.resolve(databasePath))
                .digest('hex')}`,
            installationIdSha256: `sha256:${createHash('sha256')
                .update(installationId)
                .digest('hex')}`,
            repositoryExpected: false,
        })}\n`,
        { mode: 0o600 },
    );
    const client = await openSmartOrderRepository({
        databasePath,
        backupDirectory,
        installationIdPath,
        identityKeyPath,
        repositoryExpectationPath,
        testOnlyAllowUnverifiedIdentitySeed: true,
        testOnlyExposureArbiterHeads: [
            {
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                accountDailyLossLimitMinorUnits: 10_000_000,
                identityGroupId: 'identity-A',
                identityDailyLossLimitMinorUnits: 10_000_000,
                policyRevision: 'risk-policy/1',
                policyHash: DIGEST_A,
                sourceRevision: 'exposure-source/1',
                sourceSequence: 1,
                sourceEvidenceHash: DIGEST_B,
                observedAtEpochMs: TEST_EXPOSURE_OBSERVED_AT_EPOCH_MS,
                validUntilEpochMs:
                    TEST_EXPOSURE_OBSERVED_AT_EPOCH_MS + 5_000,
                reservedDimensions: [
                    'cashMinorUnits',
                    'notionalMinorUnits',
                    'orderCount',
                    'positionShares',
                    'quantityShares',
                ],
                account: {
                    baseline: {
                        quantityShares: 0,
                        notionalMinorUnits: 0,
                        cashMinorUnits: 0,
                        positionShares: 0,
                        orderCount: 0,
                    },
                    limits: {
                        quantityShares: 10_000,
                        notionalMinorUnits: 100_000_000,
                        cashMinorUnits: 100_000_000,
                        positionShares: 10_000,
                        orderCount: 10,
                    },
                },
                identity: {
                    baseline: {
                        quantityShares: 0,
                        notionalMinorUnits: 0,
                        cashMinorUnits: 0,
                        positionShares: 0,
                        orderCount: 0,
                    },
                    limits: {
                        quantityShares: 10_000,
                        notionalMinorUnits: 100_000_000,
                        cashMinorUnits: 100_000_000,
                        positionShares: 10_000,
                        orderCount: 10,
                    },
                },
                nowEpochMs: 1_786_377_599_000,
            },
        ],
        testOnlyExposureClockNowEpochMs:
            TEST_EXPOSURE_OBSERVED_AT_EPOCH_MS + 1_000,
    });
    clients.push(client);
    repositoryDatabasePathByClient.set(client, databasePath);
    return client;
}

function convertPreparedIntentToParentChild(client) {
    const databasePath = repositoryDatabasePathByClient.get(client);
    if (typeof databasePath !== 'string') {
        throw new Error('test repository database path is unavailable');
    }
    const definition = canonicalSmartOrderDraft('parent_child');
    const definitionJson = canonicalJson(definition);
    const definitionHash = `sha256:${createHash('sha256')
        .update(definitionJson)
        .digest('hex')}`;
    const payload = {
        activationTradeDate: '2026-08-11',
        childPositionLineageId: null,
        conditionEvidenceHash: DIGEST_A,
        confirmationSnapshotHash: DIGEST_B,
        leg: 'parent',
        order: {
            baseShares: 1_000,
            commonLots: 1,
            contractKey: 'TSE:2330:STK:Common',
            contractUnit: 1_000,
            limitPrice: '100',
            orderCond: 'Cash',
            orderLot: 'Common',
            policyRevision: 'risk-policy/1',
            priceType: 'LMT',
            side: 'Buy',
            timeInForce: 'ROD',
        },
        parentSettlementHash: null,
        schemaVersion: 'smart-order-parent-child-intent/2026-08-21.1',
        strategyId: 'strategy-1',
    };
    const payloadJson = canonicalJson(payload);
    const payloadHash = `sha256:${createHash('sha256')
        .update(payloadJson)
        .digest('hex')}`;
    const database = new DatabaseSync(databasePath);
    try {
        database.exec('PRAGMA busy_timeout=2500; BEGIN IMMEDIATE;');
        database.prepare(`
            UPDATE strategies
               SET strategy_kind='parent_child', definition_hash=?,
                   definition_json=?
             WHERE strategy_id='strategy-1'
        `).run(definitionHash, definitionJson);
        database.prepare(`
            UPDATE order_intents
               SET payload_hash=?, payload_json=?
             WHERE intent_id='intent-1'
        `).run(payloadHash, payloadJson);
        database.prepare(`
            INSERT INTO parent_child_progress_heads(
                strategy_id, state, parent_activation_trade_date,
                parent_activation_id, parent_intent_id,
                parent_settlement_hash, child_activation_trade_date,
                child_quantity_shares, child_position_lineage_id,
                child_obligation_id, child_exit_claim_id,
                child_protection_group_id, child_activation_id,
                child_intent_id, child_settlement_hash,
                created_at_epoch_ms, updated_at_epoch_ms, revision
            ) VALUES (
                'strategy-1', 'parent_intent_prepared', '2026-08-11',
                'activation-1', 'intent-1',
                NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
                1786377600200, 1786377600200, 0
            )
        `).run();
        database.exec('COMMIT');
    } catch (error) {
        try {
            database.exec('ROLLBACK');
        } catch {}
        throw error;
    } finally {
        database.close();
    }
}

async function modeAdmission(
    { captureLeaseDirectory, fetchImpl, processAttestations } = {},
    resourceCoordinator,
) {
    const socketTempRoot = process.platform === 'darwin' ? '/private/tmp' : tmpdir();
    const root = await mkdtemp(path.join(socketTempRoot, 'smo-dispatch-mode-'));
    roots.push(root);
    await chmod(root, 0o700);
    const generation = 'api-generation-1';
    await writeFile(path.join(root, 'runtime-mode'), 'simulation\n', {
        mode: 0o600,
    });
    await writeFile(path.join(root, 'runtime-api-generation'), `${generation}\n`, {
        mode: 0o600,
    });
    captureLeaseDirectory?.(path.join(root, 'leases'));
    vi.stubGlobal(
        'fetch',
        fetchImpl ??
            (async () => ({
                status: 200,
                headers: {
                    get(name) {
                        return name === 'content-type'
                            ? 'application/json'
                            : null;
                    },
                },
                async json() {
                    return { simulation: true };
                },
            })),
    );
    const processSequence = processAttestations ?? [
        { pid: 12_345, identity: PROCESS_IDENTITY },
    ];
    let attestationCall = 0;
    let currentProcess = processSequence[0];
    execFileMock.mockImplementation(async (file, args) => {
        if (file === '/bin/launchctl') {
            currentProcess =
                processSequence[
                    Math.min(attestationCall, processSequence.length - 1)
                ];
            attestationCall += 1;
            return { stdout: `pid = ${currentProcess.pid}\n` };
        }
        if (file === '/usr/sbin/lsof') {
            return {
                stdout: `p${currentProcess.pid}\nn127.0.0.1:8080\n`,
            };
        }
        return args.includes('lstart=')
            ? { stdout: currentProcess.identity }
            : { stdout: '' };
    });
    return createSmartOrderModeWriteAdmission({
        appSupportRoot: root,
        leaseDirectory: path.join(root, 'leases'),
        expectedApiGeneration: generation,
        resourceCoordinator,
    });
}

async function fencedAdapter(execute, options = {}) {
    const resourceCoordinator = createSmartOrderResourceCoordinator();
    resourceCoordinators.push(resourceCoordinator);
    const adapter = createFencedSmartOrderBrokerAdapter({
        async execute(authority) {
            if (options.skipWriteAdjacentRevalidation !== true) {
                await revalidateSmartOrderBrokerDispatchAuthorityImmediatelyBeforeWrite(
                    authority,
                );
            }
            return execute(authority);
        },
        modeAdmission: await modeAdmission(options, resourceCoordinator),
    });
    resourceCoordinatorByAdapter.set(adapter, resourceCoordinator);
    return adapter;
}

async function preparedReadyRepository() {
    const client = await repository();
    await client.request('insertStrategy', {
        strategyId: 'strategy-1',
        strategyKind: 'quick',
        state: 'monitoring',
        definitionHash: DIGEST_A,
        definition: { schemaVersion: 'strategy/1', kind: 'quick' },
        accountBrokerRef: 'broker-A',
        accountIdRef: 'account-A',
        identityGroupId: 'identity-A',
        confirmationSnapshotHash: DIGEST_B,
        nowEpochMs: 1_786_377_600_000,
    });
    await client.request('prepareIntent', {
        strategyId: 'strategy-1',
        nowEpochMs: 1_786_377_600_100,
        activation: {
            activationId: 'activation-1',
            logicalKey: 'edge-1',
            generation: 1,
            evidenceHash: DIGEST_A,
        },
        intent: {
            intentId: 'intent-1',
            operationKind: 'place',
            ownerKind: 'activation',
            payloadHash: PAYLOAD_HASH,
            payload: PAYLOAD,
            clientRequestId: 'request-1',
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            tradeDate: '2026-08-11',
            contractKey: 'TSE:2330:STK:Common',
            side: 'Buy',
        },
        reservation: {
            reservationId: 'reservation-1',
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            identityGroupId: 'identity-A',
            policyRevision: 'risk-policy/1',
            policyHash: DIGEST_A,
            quantityShares: 1_000,
            notionalMinorUnits: 10_000_000,
            cashMinorUnits: 10_000_000,
            positionShares: 1_000,
            orderCount: 1,
        },
    });
    await client.request('startRuntimeEpoch', {
        runtimeEpochId: 'runtime-epoch-1',
        apiGeneration: 'api-generation-1',
        senderFence: 'sender-fence-1',
        leaseEvidenceHash: DIGEST_A,
        nowEpochMs: 1_786_377_600_150,
    });
    await client.request('rearmPreparedIntent', {
        rearmAuthorizationId: 'rearm-authorization-1',
        rearmRequestId: 'rearm-request-1',
        intentId: 'intent-1',
        runtimeEpochId: 'runtime-epoch-1',
        senderFence: 'sender-fence-1',
        apiGeneration: 'api-generation-1',
        expectedIntentRevision: 0,
        confirmationSnapshotHash: DIGEST_B,
        riskRevision: 'risk-revision-1',
        reconciliationEvidenceHash: DIGEST_B,
        userRearmEvidenceHash: DIGEST_A,
        nowEpochMs: 1_786_377_600_175,
    });
    await client.request('markRuntimeEpochReady', {
        runtimeEpochId: 'runtime-epoch-1',
        apiGeneration: 'api-generation-1',
        senderFence: 'sender-fence-1',
        expectedRevision: 0,
        reconciliationEvidenceHash: DIGEST_B,
        nowEpochMs: 1_786_377_600_180,
    });
    return client;
}

function dispatchInput() {
    return {
        intentId: 'intent-1',
        runtimeEpochId: 'runtime-epoch-1',
        expectedRevision: 1,
        expectedActivationRevision: 0,
        expectedReservationRevision: 0,
        expectedRearmRevision: 0,
        dispatchAttemptNonce: 'dispatch-nonce-1',
        senderFence: 'sender-fence-1',
        apiGeneration: 'api-generation-1',
        modeRevision: 'mode-revision-1',
        riskRevision: 'risk-revision-1',
        accountRevision: 'account-revision-1',
        targetRevision: 'target-revision-1',
        expectedKillSwitchArbiterRevision: 0,
        killSwitchArbiterRevision: 0,
        nowEpochMs: 1_786_377_600_200,
    };
}

describe('durable broker dispatch coordinator', () => {
    it('rejects arbitrary adapter objects before any repository transition', async () => {
        const client = await preparedReadyRepository();
        expect(() =>
            createSmartOrderBrokerDispatchCoordinator({
                repository: client,
                adapter: Object.freeze({
                    async preflight() {},
                    async execute() {},
                }),
            }),
        ).toThrow('registered fenced broker adapter');
        await expect(
            client.request('verifyDispatchGrant', {
                ...dispatchInput(),
                revision: 2,
                activationRevision: 1,
                reservationRevision: 1,
                rearmAuthorizationId: 'rearm-authorization-1',
                rearmRevision: 1,
            }),
        ).resolves.toEqual({ authorized: false });
    });

    it('keeps the production/default adapter disabled before an intent becomes dispatching', async () => {
        const client = await preparedReadyRepository();
        const coordinator = createSmartOrderBrokerDispatchCoordinator({
            repository: client,
            adapter: createDisabledSmartOrderBrokerAdapter(),
        });
        await expect(coordinator.dispatch(dispatchInput())).rejects.toThrow(
            'broker adapter is disabled',
        );
        await expect(
            client.request('verifyDispatchGrant', {
                ...dispatchInput(),
                revision: 2,
                activationRevision: 1,
                reservationRevision: 1,
                rearmAuthorizationId: 'rearm-authorization-1',
                rearmRevision: 1,
            }),
        ).resolves.toEqual({ authorized: false });
    });

    it('delivers only a repository-issued immutable dispatch envelope to the adapter', async () => {
        const client = await preparedReadyRepository();
        let verifyDispatchGrantCalls = 0;
        const currentRepository = {
            request(method, input) {
                if (method === 'verifyDispatchGrant') {
                    verifyDispatchGrantCalls += 1;
                }
                return client.request(method, input);
            },
        };
        let received;
        const transportResourceUnits = [];
        const adapter = await fencedAdapter(
            async (authority) => {
                received = authority;
                transportResourceUnits.push(
                    await acquireSmartOrderBrokerDispatchTransportOperation(
                        authority,
                    ),
                    await acquireSmartOrderBrokerDispatchTransportOperation(
                        authority,
                    ),
                    await acquireSmartOrderBrokerDispatchTransportOperation(
                        authority,
                    ),
                );
                return {
                    state: 'acknowledged',
                    terminalOutcome: 'broker_acknowledged',
                };
            },
        );
        await expect(
            adapter.execute(
                Object.freeze({
                    schemaVersion:
                        SMART_ORDER_BROKER_DISPATCH_COORDINATOR_SCHEMA_VERSION,
                }),
            ),
        ).rejects.toThrow('coordinator-issued dispatch authority');
        const coordinator = createSmartOrderBrokerDispatchCoordinator({
            repository: currentRepository,
            now: () => 1_786_377_600_250,
            adapter,
        });
        await expect(coordinator.dispatch(dispatchInput())).resolves.toMatchObject({
            state: 'acknowledged',
            automaticRetryAllowed: false,
            outcome: { revision: 3 },
        });
        expect(resourceCoordinators.at(-1).status()).toMatchObject({
            operationBucketMode: 'conservative_common_unclassified',
            operationRateLimitPerSecond: 5,
            queueDepth: 0,
            inFlight: 0,
            terminalRecords: 2,
            writeMasterAuthority: false,
            brokerAuthority: false,
        });
        expect(isIssuedSmartOrderBrokerDispatchAuthority(received)).toBe(true);
        expect(transportResourceUnits).toMatchObject([
            { allowed: true, operationUnit: true },
            { allowed: true, operationUnit: true },
            { allowed: true, operationUnit: true },
        ]);
        expect(received.envelope).toMatchObject({
            intentId: 'intent-1',
            operationKind: 'place',
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            tradeDate: '2026-08-11',
            contractKey: 'TSE:2330:STK:Common',
            payload: PAYLOAD,
            intentRevision: 2,
        });
        expect(Object.isFrozen(received.envelope.payload)).toBe(true);
        expect(verifyDispatchGrantCalls).toBe(2);
        expect(
            isIssuedSmartOrderBrokerDispatchAuthority({ ...received }),
        ).toBe(false);
        await expect(adapter.execute(received)).rejects.toThrow(
            'already consumed',
        );
        await expect(
            revalidateSmartOrderBrokerDispatchAuthorityImmediatelyBeforeWrite(
                received,
            ),
        ).rejects.toThrow('already consumed');
        await expect(coordinator.dispatch(dispatchInput())).rejects.toThrow(
            'lost its CAS',
        );
    });

    it('revalidates Runtime calendar authority after the transport unit and before a broker byte', async () => {
        const client = await preparedReadyRepository();
        let revalidationCount = 0;
        let brokerByteAttempted = false;
        const adapter = await fencedAdapter(async (authority) => {
            await acquireSmartOrderBrokerDispatchTransportOperation(authority);
            brokerByteAttempted = true;
            return {
                state: 'acknowledged',
                terminalOutcome: 'broker_acknowledged',
            };
        });
        const coordinator = createSmartOrderBrokerDispatchCoordinator({
            repository: client,
            now: () => 1_786_377_600_250,
            adapter,
            revalidateRuntimeAuthorityImmediatelyBeforeTransport(envelope) {
                revalidationCount += 1;
                expect(envelope.contractKey).toBe('TSE:2330:STK:Common');
                if (revalidationCount === 2) {
                    const error = new Error('calendar evidence expired');
                    error.name = 'OfficialMarketCalendarBlockedError';
                    throw error;
                }
            },
        });

        await expect(coordinator.dispatch(dispatchInput())).resolves.toMatchObject({
            state: 'unknown',
            adapterErrorName: 'OfficialMarketCalendarBlockedError',
            automaticRetryAllowed: false,
        });
        expect(revalidationCount).toBe(2);
        expect(brokerByteAttempted).toBe(false);
    });

    it('durably marks unknown when an adapter omits write-adjacent revalidation', async () => {
        const client = await preparedReadyRepository();
        const coordinator = createSmartOrderBrokerDispatchCoordinator({
            repository: client,
            now: () => 1_786_377_600_250,
            adapter: await fencedAdapter(
                async () => ({
                    state: 'acknowledged',
                    terminalOutcome: 'broker_acknowledged',
                }),
                { skipWriteAdjacentRevalidation: true },
            ),
        });
        await expect(coordinator.dispatch(dispatchInput())).resolves.toMatchObject({
            state: 'unknown',
            automaticRetryAllowed: false,
            terminalOutcome: 'broker_write_adjacent_revalidation_missing',
        });
    });

    it('keeps a prepared parent intent durable and off-wire when dispatch begins after the parent cutoff', async () => {
        const client = await preparedReadyRepository();
        convertPreparedIntentToParentChild(client);
        await expect(
            client.request('markIntentDispatching', {
                ...dispatchInput(),
                nowEpochMs: 1_786_426_201_000,
            }),
        ).rejects.toThrow('parent-child dispatch window is closed');

        const database = new DatabaseSync(
            repositoryDatabasePathByClient.get(client),
            { readOnly: true },
        );
        expect(
            database.prepare(`
                SELECT state, revision, adapter_authority_granted
                  FROM order_intents WHERE intent_id='intent-1'
            `).get(),
        ).toEqual({
            state: 'prepared',
            revision: 1,
            adapter_authority_granted: 0,
        });
        database.close();
    });

    it('never reaches adapter transport when the write-adjacent durable grant changed', async () => {
        const client = await preparedReadyRepository();
        let verifyDispatchGrantCalls = 0;
        let adapterTransportCalls = 0;
        const repositoryWithAdjacentDrift = {
            request(method, input) {
                if (method === 'verifyDispatchGrant') {
                    verifyDispatchGrantCalls += 1;
                    if (verifyDispatchGrantCalls === 2) {
                        return Promise.resolve({ authorized: false });
                    }
                }
                return client.request(method, input);
            },
        };
        const coordinator = createSmartOrderBrokerDispatchCoordinator({
            repository: repositoryWithAdjacentDrift,
            now: () => 1_786_377_600_250,
            adapter: await fencedAdapter(async () => {
                adapterTransportCalls += 1;
                return {
                    state: 'acknowledged',
                    terminalOutcome: 'broker_acknowledged',
                };
            }),
        });
        await expect(coordinator.dispatch(dispatchInput())).resolves.toMatchObject({
            state: 'unknown',
            automaticRetryAllowed: false,
        });
        expect(verifyDispatchGrantCalls).toBe(2);
        expect(adapterTransportCalls).toBe(0);
    });

    it('forwards a fresh trusted clock at write adjacency and emits no transport byte when that revalidation closes', async () => {
        const client = await preparedReadyRepository();
        const verificationTimes = [];
        let adapterTransportCalls = 0;
        const currentRepository = {
            request(method, input) {
                if (method === 'verifyDispatchGrant') {
                    verificationTimes.push(input.nowEpochMs);
                    if (verificationTimes.length === 2) {
                        return Promise.resolve({
                            authorized: false,
                            reasonCode:
                                'parent_child_dispatch_window_closed',
                        });
                    }
                }
                return client.request(method, input);
            },
        };
        const resourceCoordinator = createSmartOrderResourceCoordinator();
        resourceCoordinators.push(resourceCoordinator);
        const adapter = createFencedSmartOrderBrokerAdapter({
            async execute(authority) {
                await revalidateSmartOrderBrokerDispatchAuthorityImmediatelyBeforeWrite(
                    authority,
                );
                adapterTransportCalls += 1;
                return {
                    state: 'acknowledged',
                    terminalOutcome: 'broker_acknowledged',
                };
            },
            modeAdmission: await modeAdmission({}, resourceCoordinator),
        });
        resourceCoordinatorByAdapter.set(adapter, resourceCoordinator);
        let clockReads = 0;
        const coordinator = createSmartOrderBrokerDispatchCoordinator({
            repository: currentRepository,
            adapter,
            now() {
                clockReads += 1;
                return clockReads === 1
                    ? 1_786_377_600_200
                    : 1_786_426_201_000;
            },
        });

        await expect(coordinator.dispatch(dispatchInput())).resolves.toMatchObject({
            state: 'unknown',
            adapterErrorName: 'Error',
            automaticRetryAllowed: false,
        });
        expect(verificationTimes).toEqual([
            1_786_377_600_200,
            1_786_426_201_000,
        ]);
        expect(adapterTransportCalls).toBe(0);
    });

    it('marks a first-byte/response exception unknown and never retries automatically', async () => {
        const client = await preparedReadyRepository();
        let executions = 0;
        const coordinator = createSmartOrderBrokerDispatchCoordinator({
            repository: client,
            now: () => 1_786_377_600_250,
            adapter: await fencedAdapter(
                async () => {
                    executions += 1;
                    throw new Error('socket closed before response');
                },
            ),
        });
        await expect(coordinator.dispatch(dispatchInput())).resolves.toMatchObject({
            state: 'unknown',
            automaticRetryAllowed: false,
        });
        expect(executions).toBe(1);
        await expect(coordinator.dispatch(dispatchInput())).rejects.toThrow(
            'lost its CAS',
        );
        expect(executions).toBe(1);
    });

    it('marks post-dispatch simulation drift unknown before the adapter sees any byte authority', async () => {
        const client = await preparedReadyRepository();
        let executions = 0;
        let fetchCount = 0;
        const coordinator = createSmartOrderBrokerDispatchCoordinator({
            repository: client,
            now: () => 1_786_377_600_250,
            adapter: await fencedAdapter(
                async () => {
                    executions += 1;
                    return { state: 'acknowledged' };
                },
                {
                    fetchImpl: async () => {
                        fetchCount += 1;
                        return {
                            status: 200,
                            headers: {
                                get(name) {
                                    return name === 'content-type'
                                        ? 'application/json'
                                        : null;
                                },
                            },
                            async json() {
                                return { simulation: fetchCount === 1 };
                            },
                        };
                    },
                },
            ),
        });
        await expect(coordinator.dispatch(dispatchInput())).resolves.toMatchObject({
            state: 'unknown',
            automaticRetryAllowed: false,
            outcome: {
                state: 'unknown',
            },
        });
        expect(executions).toBe(0);
        expect(fetchCount).toBe(2);
        await expect(coordinator.dispatch(dispatchInput())).rejects.toThrow();
        expect(executions).toBe(0);
    });

    it.each([
        [
            'new PID',
            {
                pid: 12_346,
                identity: '12346 1 Fri Aug 22 08:31:00 2026\n',
            },
        ],
        [
            'same PID with a different process start',
            {
                pid: 12_345,
                identity: '12345 1 Fri Aug 22 08:31:00 2026\n',
            },
        ],
    ])('persists unknown and emits zero adapter bytes when %s replaces the API under the lease', async (
        _label,
        replacement,
    ) => {
        const client = await preparedReadyRepository();
        let adapterTransportCalls = 0;
        const original = { pid: 12_345, identity: PROCESS_IDENTITY };
        const coordinator = createSmartOrderBrokerDispatchCoordinator({
            repository: client,
            now: () => 1_786_377_600_250,
            adapter: await fencedAdapter(
                async () => {
                    adapterTransportCalls += 1;
                    return { state: 'acknowledged' };
                },
                {
                    processAttestations: [
                        original,
                        original,
                        replacement,
                        replacement,
                    ],
                },
            ),
        });
        await expect(coordinator.dispatch(dispatchInput())).resolves.toMatchObject({
            state: 'unknown',
            automaticRetryAllowed: false,
            outcome: { state: 'unknown' },
        });
        expect(adapterTransportCalls).toBe(0);
    });

    it('retains the shared lease if post-dispatch drift cannot be made durably unknown', async () => {
        const client = await preparedReadyRepository();
        let leaseDirectory;
        let fetchCount = 0;
        const repositoryProxy = {
            async request(method, input) {
                if (method === 'markIntentOutcome') {
                    throw new Error('simulated disk-full during unknown commit');
                }
                return client.request(method, input);
            },
        };
        const coordinator = createSmartOrderBrokerDispatchCoordinator({
            repository: repositoryProxy,
            now: () => 1_786_377_600_250,
            adapter: await fencedAdapter(
                async () => ({ state: 'acknowledged' }),
                {
                    captureLeaseDirectory(value) {
                        leaseDirectory = value;
                    },
                    fetchImpl: async () => {
                        fetchCount += 1;
                        return {
                            status: 200,
                            headers: {
                                get(name) {
                                    return name === 'content-type'
                                        ? 'application/json'
                                        : null;
                                },
                            },
                            async json() {
                                return { simulation: fetchCount === 1 };
                            },
                        };
                    },
                },
            ),
        });
        await expect(coordinator.dispatch(dispatchInput())).rejects.toThrow(
            'sender must fail-stop',
        );
        expect(coordinator.failedStop).toBe(true);
        await expect(
            acquireExclusiveModeExecutionLease({
                directoryPath: leaseDirectory,
                waitTimeoutMs: 10,
                pollIntervalMs: 1,
            }),
        ).resolves.toMatchObject({
            acquired: false,
            reason: 'shared_mode_execution_leases_active',
        });
    });

    it('fail-stops without calling the adapter when a durable dispatching grant cannot be reverified', async () => {
        const client = await preparedReadyRepository();
        let executions = 0;
        let effectiveDispatchInput;
        const repositoryProxy = {
            async request(method, input) {
                if (method === 'verifyDispatchGrant') {
                    return { authorized: false };
                }
                if (method === 'markIntentDispatching') {
                    effectiveDispatchInput = input;
                }
                return client.request(method, input);
            },
        };
        const coordinator = createSmartOrderBrokerDispatchCoordinator({
            repository: repositoryProxy,
            adapter: await fencedAdapter(
                async () => {
                    executions += 1;
                    return { state: 'acknowledged' };
                },
            ),
        });
        await expect(coordinator.dispatch(dispatchInput())).rejects.toThrow(
            'grant was denied after dispatching commit',
        );
        expect(executions).toBe(0);
        expect(coordinator.failedStop).toBe(true);
        await expect(
            client.request('verifyDispatchGrant', {
                ...effectiveDispatchInput,
                revision: 2,
                activationRevision: 1,
                reservationRevision: 0,
                rearmAuthorizationId: 'rearm-authorization-1',
                rearmRevision: 1,
            }),
        ).resolves.toMatchObject({
            authorized: true,
            envelope: {
                intentId: 'intent-1',
                intentRevision: 2,
                dispatchAttemptNonce: 'dispatch-nonce-1',
            },
        });
    });

    it('durably reconciles a repository-proven target drift without invoking the adapter', async () => {
        const client = await preparedReadyRepository();
        let executions = 0;
        let outcomeInput;
        const repositoryProxy = {
            async request(method, input) {
                if (method === 'verifyDispatchGrant') {
                    return {
                        authorized: false,
                        reasonCode: 'broker_target_changed',
                    };
                }
                if (method === 'markIntentOutcome') outcomeInput = input;
                return client.request(method, input);
            },
        };
        const coordinator = createSmartOrderBrokerDispatchCoordinator({
            repository: repositoryProxy,
            now: () => 1_786_377_600_250,
            adapter: await fencedAdapter(async () => {
                executions += 1;
                return { state: 'acknowledged' };
            }),
        });
        await expect(coordinator.dispatch(dispatchInput())).resolves.toMatchObject({
            state: 'reconciling',
            adapterInvoked: false,
            automaticRetryAllowed: false,
            outcome: {
                state: 'reconciling',
            },
        });
        expect(outcomeInput).toMatchObject({
            state: 'reconciling',
            terminalOutcome: 'broker_target_changed_before_adapter',
        });
        expect(executions).toBe(0);
        await expect(coordinator.dispatch(dispatchInput())).rejects.toThrow(
            'lost its CAS',
        );
    });

    it('fail-stops when the broker result cannot be durably committed', async () => {
        const client = await preparedReadyRepository();
        let leaseDirectory;
        const repositoryProxy = {
            async request(method, input) {
                if (method === 'markIntentOutcome') {
                    throw new Error('simulated disk-full after broker response');
                }
                return client.request(method, input);
            },
        };
        const coordinator = createSmartOrderBrokerDispatchCoordinator({
            repository: repositoryProxy,
            now: () => 1_786_377_600_250,
            adapter: await fencedAdapter(
                async () => {
                    return {
                        state: 'acknowledged',
                        terminalOutcome: 'broker_acknowledged',
                    };
                },
                {
                    captureLeaseDirectory(value) {
                        leaseDirectory = value;
                    },
                },
            ),
        });
        await expect(coordinator.dispatch(dispatchInput())).rejects.toThrow(
            'sender must fail-stop',
        );
        expect(coordinator.failedStop).toBe(true);
        await expect(coordinator.dispatch(dispatchInput())).rejects.toThrow(
            'fail-stopped',
        );
        await expect(
            acquireExclusiveModeExecutionLease({
                directoryPath: leaseDirectory,
                waitTimeoutMs: 10,
                pollIntervalMs: 1,
            }),
        ).resolves.toMatchObject({
            acquired: false,
            reason: 'shared_mode_execution_leases_active',
        });
    });

    it('releases the shared execution lease only after the broker outcome is durable', async () => {
        const client = await preparedReadyRepository();
        let leaseDirectory;
        const coordinator = createSmartOrderBrokerDispatchCoordinator({
            repository: client,
            now: () => 1_786_377_600_250,
            adapter: await fencedAdapter(
                async () => ({
                    state: 'acknowledged',
                    terminalOutcome: 'broker_acknowledged',
                }),
                {
                    captureLeaseDirectory(value) {
                        leaseDirectory = value;
                    },
                },
            ),
        });
        await expect(coordinator.dispatch(dispatchInput())).resolves.toMatchObject({
            state: 'acknowledged',
        });
        const exclusive = await acquireExclusiveModeExecutionLease({
            directoryPath: leaseDirectory,
            waitTimeoutMs: 20,
        });
        expect(exclusive).toMatchObject({ acquired: true });
        await exclusive.close();
    });
});
