import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startSmartOrderLocalSidecar } from './local-sidecar.mjs';
import {
    finalizeSmartOrderRuntimeStop,
    quiesceSmartOrderRuntime,
    readPendingSmartOrderRuntimeStop,
    readSmartOrderRuntimeDiagnostics,
    stopSmartOrderRuntime,
} from './runtime-diagnostics.mjs';

const roots = [];
const sidecars = [];
const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;

function databasePathFor(appSupportRoot) {
    return path.join(
        appSupportRoot,
        'smart-order',
        'database',
        'smart-orders.sqlite3',
    );
}

function seedOrdinaryUnmanagedPosition(appSupportRoot, nowEpochMs) {
    const database = new DatabaseSync(databasePathFor(appSupportRoot));
    database.prepare(`
        INSERT INTO account_reconciliation_positions(
            account_broker_ref, account_id_ref, trade_date, contract_key,
            account_head_revision, source_revision, source_snapshot_hash,
            evidence_hash, position_lineage_id, quantity_shares,
            available_shares, average_cost_state,
            average_price_minor_units, average_cost_reason,
            as_of_epoch_ms, valid_until_epoch_ms, updated_at_epoch_ms,
            revision
        ) VALUES (
            'broker-A', 'account-A', '2026-08-23',
            'TSE:2330:STK:Common', 1, 'source/ordinary-position', ?, ?,
            'position-lineage-ordinary', 25000, 25000, 'available', 11500,
            NULL, ?, ?, ?, 0
        )
    `).run(DIGEST_A, DIGEST_B, nowEpochMs, nowEpochMs + 5_000, nowEpochMs);
    database.close();
}

function seedLifecycleObligationStack(
    appSupportRoot,
    {
        intentState,
        adapterAuthorityGranted,
        brokerOrderState = null,
        filledShares,
        strategyId,
    },
) {
    const database = new DatabaseSync(databasePathFor(appSupportRoot));
    const nowEpochMs = Date.now();
    const activationId = `${strategyId}-activation`;
    const intentId = `${strategyId}-intent`;
    const commitmentId = `${strategyId}-commitment`;
    database.exec('BEGIN IMMEDIATE');
    try {
        database.prepare(`
            INSERT INTO strategies(
                strategy_id, strategy_kind, state, definition_hash,
                definition_json, account_broker_ref, account_id_ref,
                identity_group_id, confirmation_snapshot_hash,
                created_at_epoch_ms, updated_at_epoch_ms,
                terminal_at_epoch_ms, revision
            ) VALUES (?, 'stop_take', 'monitoring', ?, ?, 'broker-A',
                      'account-A', 'identity-A', ?, ?, ?, NULL, 0)
        `).run(
            strategyId,
            DIGEST_A,
            JSON.stringify({ schemaVersion: 'strategy/1', kind: 'stop_take' }),
            DIGEST_B,
            nowEpochMs,
            nowEpochMs,
        );
        database.prepare(`
            INSERT INTO activations(
                activation_id, strategy_id, logical_key, state, generation,
                evidence_hash, created_at_epoch_ms, updated_at_epoch_ms,
                revision
            ) VALUES (?, ?, 'task-13-6-edge', ?, 1, ?, ?, ?, 0)
        `).run(
            activationId,
            strategyId,
            intentState === 'prepared' ? 'prepared' : 'dispatching',
            DIGEST_A,
            nowEpochMs,
            nowEpochMs,
        );
        database.prepare(`
            INSERT INTO order_intents(
                intent_id, activation_id, strategy_id, operation_kind,
                owner_kind, state, terminal_outcome, payload_hash,
                payload_json, client_request_id, account_broker_ref,
                account_id_ref, trade_date, contract_key, side,
                target_broker_order_id, target_control_revision,
                runtime_epoch_id, dispatch_attempt_nonce, sender_fence,
                api_generation, mode_revision, risk_revision,
                account_revision, target_revision,
                adapter_authority_granted, created_at_epoch_ms,
                updated_at_epoch_ms, terminal_at_epoch_ms, revision
            ) VALUES (
                ?, ?, ?, 'place', 'activation', ?, NULL, ?, ?, ?,
                'broker-A', 'account-A', '2026-08-23',
                'TSE:2330:STK:Common', 'Buy', NULL, NULL, NULL,
                NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, NULL, 0
            )
        `).run(
            intentId,
            activationId,
            strategyId,
            intentState,
            DIGEST_A,
            JSON.stringify({ schemaVersion: 'task-13-6-intent/1' }),
            `${strategyId}-request`,
            adapterAuthorityGranted,
            nowEpochMs,
            nowEpochMs,
        );
        if (brokerOrderState !== null) {
            database.prepare(`
                INSERT INTO broker_orders(
                    broker_order_id, intent_id, state, control_revision,
                    quantity_shares, filled_shares, remaining_shares,
                    evidence_hash, updated_at_epoch_ms,
                    terminal_at_epoch_ms, revision
                ) VALUES (?, ?, ?, 0, 1000, 0, 1000, ?, ?, NULL, 0)
            `).run(
                `${strategyId}-broker-order`,
                intentId,
                brokerOrderState,
                DIGEST_B,
                nowEpochMs,
            );
        }
        database.prepare(`
            INSERT INTO pending_protection_commitments(
                commitment_id, strategy_id, entry_intent_id, state,
                committed_shares, materialized_shares,
                created_at_epoch_ms, updated_at_epoch_ms, revision
            ) VALUES (?, ?, ?, 'pending_entry_fill', 1000, 0, ?, ?, 0)
        `).run(commitmentId, strategyId, intentId, nowEpochMs, nowEpochMs);
        database.prepare(`
            INSERT INTO protection_obligations(
                obligation_id, strategy_id, commitment_id, state,
                position_lineage_id, filled_shares,
                confirmed_exited_shares, created_at_epoch_ms,
                updated_at_epoch_ms, terminal_at_epoch_ms, revision
            ) VALUES (?, ?, ?, 'pending_entry_fill', ?, ?, 0, ?, ?, NULL, 0)
        `).run(
            `${strategyId}-obligation`,
            strategyId,
            commitmentId,
            `${strategyId}-position-lineage`,
            filledShares,
            nowEpochMs,
            nowEpochMs,
        );
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    } finally {
        database.close();
    }
}

async function closeForFixture(sidecar, observedApiGeneration) {
    await sidecar
        .closeForGenerationFailover({
            observedApiGeneration,
            nowEpochMs: Date.now(),
        })
        .catch(() => {});
    const index = sidecars.indexOf(sidecar);
    if (index >= 0) sidecars.splice(index, 1);
}

afterEach(async () => {
    await Promise.all(
        sidecars.splice(0).map((sidecar) =>
            sidecar.close({ nowEpochMs: Date.now() }).catch(() => {}),
        ),
    );
    await Promise.all(
        roots.splice(0).map((root) =>
            rm(root, { recursive: true, force: true }),
        ),
    );
});

async function temporaryAppSupport() {
    const root = await mkdtemp(path.join(tmpdir(), 'smart-order-diagnostics-'));
    roots.push(root);
    await chmod(root, 0o700);
    return root;
}

describe('smart-order authenticated runtime diagnostics', () => {
    it('returns only a proof-verified redacted lifecycle summary', async () => {
        const appSupportRoot = await temporaryAppSupport();
        const apiGeneration = 'simulation:diagnostics-generation-1';
        const sidecar = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration,
            nowEpochMs: Date.now(),
            runtimeEpochId: 'runtime-diagnostics-epoch-1',
            senderFence: 'runtime-diagnostics-fence-1',
        });
        sidecars.push(sidecar);

        await expect(
            readSmartOrderRuntimeDiagnostics({
                appSupportRoot,
                expectedApiGeneration: apiGeneration,
            }),
        ).resolves.toEqual({
            schemaVersion: 'smart-order-runtime-diagnostics/2026-08-12.2',
            authenticated: true,
            runtimeState: 'reconciling',
            repositoryReady: true,
            dispatchAllowed: false,
            writeMaster: 'disabled',
            reconciliation: 'required_before_any_write_or_drain',
            activeObligationCount: 0,
            blockerCount: 0,
            drainItems: [
                {
                    kind: 'account_reconciliation',
                    count: 0,
                    disposition: 'complete_current_account_reconciliation',
                },
                {
                    kind: 'strategy',
                    count: 0,
                    disposition: 'pause_or_cancel_strategy',
                },
                {
                    kind: 'activation',
                    count: 0,
                    disposition: 'cancel_strategy_or_complete_activation',
                },
                {
                    kind: 'prepared_intent',
                    count: 0,
                    disposition: 'cancel_proven_unsent_intent_and_release',
                },
                {
                    kind: 'side_effect_intent',
                    count: 0,
                    disposition: 'reconcile_intent_before_stop',
                },
                {
                    kind: 'broker_order',
                    count: 0,
                    disposition: 'cancel_working_order_or_reconcile',
                },
                {
                    kind: 'protection_commitment',
                    count: 0,
                    disposition:
                        'prove_zero_fill_or_release_pre_dispatch',
                },
                {
                    kind: 'protection_obligation',
                    count: 0,
                    disposition:
                        'prove_zero_fill_confirmed_exit_or_break_glass',
                },
                {
                    kind: 'entry_exposure_reservation',
                    count: 0,
                    disposition: 'release_proven_unsent_or_reconcile',
                },
                {
                    kind: 'exit_claim',
                    count: 0,
                    disposition: 'reconcile_or_release_claim',
                },
                {
                    kind: 'manual_resolution',
                    count: 0,
                    disposition: 'complete_reason_specific_resolution',
                },
                {
                    kind: 'safety_blocker',
                    count: 0,
                    disposition: 'resolve_or_supersede_blocker',
                },
            ],
            drainRecords: [],
            drainRecordsTruncated: false,
            runtimeTrackedUnprotectedRemainder: {
                state: 'known',
                shares: 0,
                conservativeMaximumShares: 0,
                currentAccountReconciliationRequired: false,
            },
            productionReadonlyDrainAllowed: true,
            gracefulStopAllowed: true,
            uninstallAllowed: true,
            accountIdentifiersExposed: false,
            entityIdentifiersExposed: false,
            secretValuesExposed: false,
        });
    });

    it('rejects a stale API generation without exposing its raw value', async () => {
        const appSupportRoot = await temporaryAppSupport();
        const sidecar = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'simulation:current-generation',
            nowEpochMs: Date.now(),
            runtimeEpochId: 'runtime-diagnostics-epoch-2',
            senderFence: 'runtime-diagnostics-fence-2',
        });
        sidecars.push(sidecar);

        await expect(
            readSmartOrderRuntimeDiagnostics({
                appSupportRoot,
                expectedApiGeneration: 'simulation:stale-generation',
            }),
        ).rejects.toThrow('status projection is invalid');
    });

    it('uses the private capability to durably quiesce before a mode switch', async () => {
        const appSupportRoot = await temporaryAppSupport();
        const apiGeneration = 'simulation:diagnostics-quiesce-generation';
        const sidecar = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration,
            nowEpochMs: Date.now(),
            runtimeEpochId: 'runtime-diagnostics-quiesce-epoch',
            senderFence: 'runtime-diagnostics-quiesce-fence',
        });
        sidecars.push(sidecar);

        await expect(
            quiesceSmartOrderRuntime({
                appSupportRoot,
                expectedApiGeneration: apiGeneration,
                operation: 'production_readonly',
            }),
        ).resolves.toEqual({
            schemaVersion:
                'smart-order-runtime-quiesce-result/2026-08-12.1',
            operation: 'production_readonly',
            state: 'quiescing',
            drainAllowed: true,
            dispatchAllowed: false,
            writeMaster: 'disabled',
            blockerCount: 0,
            accountIdentifiersExposed: false,
            entityIdentifiersExposed: false,
            secretValuesExposed: false,
        });
        expect(sidecar.status()).toMatchObject({
            state: 'quiescing',
            dispatchAllowed: false,
        });
        await sidecar.close({ nowEpochMs: Date.now() });
        sidecars.splice(sidecars.indexOf(sidecar), 1);
    });

    it('returns success only after durable stop, control-plane removal, repository close, and lease release', async () => {
        const appSupportRoot = await temporaryAppSupport();
        const apiGeneration = 'simulation:diagnostics-stop-generation';
        const sidecar = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration,
            nowEpochMs: Date.now(),
            runtimeEpochId: 'runtime-diagnostics-stop-epoch',
            senderFence: 'runtime-diagnostics-stop-fence',
        });
        sidecars.push(sidecar);

        const stopped = await stopSmartOrderRuntime({
            appSupportRoot,
            expectedApiGeneration: apiGeneration,
            operation: 'graceful_stop',
        });
        expect(stopped).toMatchObject({
            schemaVersion: 'smart-order-runtime-stop-result/2026-08-12.1',
            operation: 'graceful_stop',
            state: 'closed',
            repositoryClosed: true,
            controlPlaneUnpublished: true,
            runtimeLeaseReleased: true,
            dispatchAllowed: false,
            brokerWriteAttempted: false,
            secretValuesExposed: false,
        });
        await expect(
            startSmartOrderLocalSidecar({
                appSupportRoot,
                apiGeneration,
                nowEpochMs: Date.now(),
                runtimeEpochId: 'replacement-before-finalize',
                senderFence: 'replacement-before-finalize-fence',
            }),
        ).rejects.toThrow('handoff is not finalized');
        await expect(
            readPendingSmartOrderRuntimeStop({ appSupportRoot }),
        ).resolves.toMatchObject({
            schemaVersion:
                'smart-order-runtime-stop-pending/2026-08-12.1',
            operation: 'graceful_stop',
            stopRevision: stopped.stopRevision,
            completionBinding: stopped.completionBinding,
            repositoryClosed: true,
            controlPlaneUnpublished: true,
            runtimeLeaseReleased: true,
            dispatchAllowed: false,
            brokerWriteAttempted: false,
            secretValuesExposed: false,
        });
        await expect(
            finalizeSmartOrderRuntimeStop({
                appSupportRoot,
                completionBinding: stopped.completionBinding,
            }),
        ).resolves.toMatchObject({
            schemaVersion:
                'smart-order-runtime-stop-finalized/2026-08-12.1',
            operation: 'graceful_stop',
            stopRevision: stopped.stopRevision,
            finalized: true,
            dispatchAllowed: false,
            brokerWriteAttempted: false,
            secretValuesExposed: false,
        });
        await expect(
            finalizeSmartOrderRuntimeStop({
                appSupportRoot,
                completionBinding: stopped.completionBinding,
            }),
        ).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(
            readPendingSmartOrderRuntimeStop({ appSupportRoot }),
        ).rejects.toMatchObject({ code: 'ENOENT' });
        const replacement = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration,
            nowEpochMs: Date.now(),
            runtimeEpochId: 'replacement-after-finalize',
            senderFence: 'replacement-after-finalize-fence',
        });
        sidecars.push(replacement);
        expect(replacement.role).toBe('primary');
        await expect(sidecar.lifecycleStop).resolves.toMatchObject({
            state: 'closed',
            operation: 'graceful_stop',
            dispatchAllowed: false,
        });
        expect(sidecar.status()).toMatchObject({
            state: 'closed',
            repositoryOpened: false,
            tradingSenderAuthority: 'none',
            controlPlane: 'closed',
            dispatchAllowed: false,
        });
        sidecars.splice(sidecars.indexOf(sidecar), 1);
    }, 15_000);

    it('keeps an ordinary unmanaged position out of lifecycle blockers and completes an isolated rollback before a new-generation relogin', async () => {
        const appSupportRoot = await temporaryAppSupport();
        const firstGeneration = 'simulation:task-13-6-rollback-1';
        const sidecar = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: firstGeneration,
            nowEpochMs: Date.now(),
            runtimeEpochId: 'task-13-6-rollback-runtime-1',
            senderFence: 'task-13-6-rollback-fence-1',
        });
        sidecars.push(sidecar);
        seedOrdinaryUnmanagedPosition(appSupportRoot, Date.now());

        await expect(
            readSmartOrderRuntimeDiagnostics({
                appSupportRoot,
                expectedApiGeneration: firstGeneration,
            }),
        ).resolves.toMatchObject({
            blockerCount: 0,
            gracefulStopAllowed: true,
            uninstallAllowed: true,
            runtimeTrackedUnprotectedRemainder: {
                state: 'known',
                shares: 0,
                conservativeMaximumShares: 0,
            },
        });
        await expect(
            quiesceSmartOrderRuntime({
                appSupportRoot,
                expectedApiGeneration: firstGeneration,
                operation: 'rollback',
            }),
        ).resolves.toMatchObject({
            operation: 'rollback',
            state: 'quiescing',
            drainAllowed: true,
            blockerCount: 0,
            dispatchAllowed: false,
        });
        const stopped = await stopSmartOrderRuntime({
            appSupportRoot,
            expectedApiGeneration: firstGeneration,
            operation: 'rollback',
        });
        expect(stopped).toMatchObject({
            operation: 'rollback',
            state: 'closed',
            repositoryClosed: true,
            controlPlaneUnpublished: true,
            runtimeLeaseReleased: true,
            dispatchAllowed: false,
            brokerWriteAttempted: false,
        });
        await finalizeSmartOrderRuntimeStop({
            appSupportRoot,
            completionBinding: stopped.completionBinding,
        });
        sidecars.splice(sidecars.indexOf(sidecar), 1);

        const replacement = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'simulation:task-13-6-rollback-2',
            nowEpochMs: Date.now(),
            runtimeEpochId: 'task-13-6-rollback-runtime-2',
            senderFence: 'task-13-6-rollback-fence-2',
        });
        sidecars.push(replacement);
        expect(replacement.status()).toMatchObject({
            role: 'primary',
            state: 'reconciling',
            dispatchAllowed: false,
            tradingSenderAuthority: 'runtime_only',
        });
        const database = new DatabaseSync(databasePathFor(appSupportRoot), {
            readOnly: true,
        });
        expect(
            database
                .prepare(`
                    SELECT quantity_shares FROM account_reconciliation_positions
                     WHERE position_lineage_id='position-lineage-ordinary'
                `)
                .get(),
        ).toEqual({ quantity_shares: 25_000 });
        database.close();
    }, 20_000);

    it('keeps reconciling intent, pending-submit BrokerOrder and tracked remainder as uninstall blockers without stopping the sidecar', async () => {
        const appSupportRoot = await temporaryAppSupport();
        const apiGeneration = 'simulation:task-13-6-blocked-uninstall';
        const sidecar = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration,
            nowEpochMs: Date.now(),
            runtimeEpochId: 'task-13-6-blocked-runtime',
            senderFence: 'task-13-6-blocked-fence',
        });
        sidecars.push(sidecar);
        seedLifecycleObligationStack(appSupportRoot, {
            strategyId: 'task-13-6-blocked',
            intentState: 'reconciling',
            adapterAuthorityGranted: 1,
            brokerOrderState: 'pending_submit',
            filledShares: 1_000,
        });

        await expect(
            readSmartOrderRuntimeDiagnostics({
                appSupportRoot,
                expectedApiGeneration: apiGeneration,
            }),
        ).resolves.toMatchObject({
            uninstallAllowed: false,
            activeObligationCount: 1,
            runtimeTrackedUnprotectedRemainder: {
                state: 'known',
                shares: 1_000,
                conservativeMaximumShares: 1_000,
            },
            drainItems: expect.arrayContaining([
                expect.objectContaining({
                    kind: 'side_effect_intent',
                    count: 1,
                }),
                expect.objectContaining({
                    kind: 'broker_order',
                    count: 1,
                }),
                expect.objectContaining({
                    kind: 'protection_obligation',
                    count: 1,
                }),
            ]),
        });
        const blocked = await quiesceSmartOrderRuntime({
            appSupportRoot,
            expectedApiGeneration: apiGeneration,
            operation: 'uninstall',
        });
        expect(blocked).toMatchObject({
            operation: 'uninstall',
            state: 'reconciling',
            drainAllowed: false,
            dispatchAllowed: false,
        });
        expect(blocked.blockerCount).toBeGreaterThanOrEqual(5);
        await expect(
            stopSmartOrderRuntime({
                appSupportRoot,
                expectedApiGeneration: apiGeneration,
                operation: 'uninstall',
            }),
        ).rejects.toThrow();
        expect(sidecar.status()).toMatchObject({
            state: 'reconciling',
            controlPlane: 'loopback_authenticated',
            repositoryOpened: true,
            dispatchAllowed: false,
        });
        const database = new DatabaseSync(databasePathFor(appSupportRoot), {
            readOnly: true,
        });
        expect(
            database
                .prepare(`
                    SELECT intents.state AS intent_state,
                           orders.state AS broker_order_state,
                           obligations.state AS obligation_state
                      FROM order_intents AS intents
                      JOIN broker_orders AS orders
                        ON orders.intent_id=intents.intent_id
                      JOIN protection_obligations AS obligations
                        ON obligations.strategy_id=intents.strategy_id
                     WHERE intents.intent_id='task-13-6-blocked-intent'
                `)
                .get(),
        ).toEqual({
            intent_state: 'reconciling',
            broker_order_state: 'pending_submit',
            obligation_state: 'pending_entry_fill',
        });
        database.close();
        await closeForFixture(
            sidecar,
            'simulation:task-13-6-blocked-uninstall-cleanup',
        );
    }, 20_000);

    it('does not auto-resume a proven-unsent prepared intent or its protection after a watchdog/relogin generation replacement', async () => {
        const appSupportRoot = await temporaryAppSupport();
        const first = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'simulation:task-13-6-recovery-1',
            nowEpochMs: Date.now(),
            runtimeEpochId: 'task-13-6-recovery-runtime-1',
            senderFence: 'task-13-6-recovery-fence-1',
        });
        sidecars.push(first);
        seedLifecycleObligationStack(appSupportRoot, {
            strategyId: 'task-13-6-prepared',
            intentState: 'prepared',
            adapterAuthorityGranted: 0,
            brokerOrderState: null,
            filledShares: 0,
        });
        await closeForFixture(
            first,
            'simulation:task-13-6-recovery-2',
        );

        const replacement = await startSmartOrderLocalSidecar({
            appSupportRoot,
            apiGeneration: 'simulation:task-13-6-recovery-2',
            nowEpochMs: Date.now(),
            runtimeEpochId: 'task-13-6-recovery-runtime-2',
            senderFence: 'task-13-6-recovery-fence-2',
        });
        sidecars.push(replacement);
        expect(replacement.status()).toMatchObject({
            role: 'primary',
            state: 'reconciling',
            dispatchAllowed: false,
            generationInvalidated: false,
        });
        const diagnostics = await readSmartOrderRuntimeDiagnostics({
            appSupportRoot,
            expectedApiGeneration: 'simulation:task-13-6-recovery-2',
        });
        expect(diagnostics).toMatchObject({
            uninstallAllowed: false,
            activeObligationCount: 1,
            drainItems: expect.arrayContaining([
                expect.objectContaining({
                    kind: 'prepared_intent',
                    count: 1,
                    disposition: 'cancel_proven_unsent_intent_and_release',
                }),
                expect.objectContaining({
                    kind: 'protection_commitment',
                    count: 1,
                }),
                expect.objectContaining({
                    kind: 'protection_obligation',
                    count: 1,
                }),
            ]),
        });
        const database = new DatabaseSync(databasePathFor(appSupportRoot), {
            readOnly: true,
        });
        expect(
            database
                .prepare(`
                    SELECT strategies.state AS strategy_state,
                           intents.state AS intent_state,
                           intents.adapter_authority_granted,
                           commitments.state AS commitment_state,
                           obligations.state AS obligation_state,
                           (SELECT COUNT(*) FROM intent_rearm_authorizations
                             WHERE state='active') AS active_rearm_count
                      FROM strategies
                      JOIN order_intents AS intents
                        ON intents.strategy_id=strategies.strategy_id
                      JOIN pending_protection_commitments AS commitments
                        ON commitments.entry_intent_id=intents.intent_id
                      JOIN protection_obligations AS obligations
                        ON obligations.commitment_id=commitments.commitment_id
                     WHERE strategies.strategy_id='task-13-6-prepared'
                `)
                .get(),
        ).toEqual({
            strategy_state: 'recovery',
            intent_state: 'prepared',
            adapter_authority_granted: 0,
            commitment_state: 'pending_entry_fill',
            obligation_state: 'pending_entry_fill',
            active_rearm_count: 0,
        });
        database.close();
        await closeForFixture(
            replacement,
            'simulation:task-13-6-recovery-cleanup',
        );
    }, 20_000);
});
