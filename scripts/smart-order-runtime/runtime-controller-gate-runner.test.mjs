import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

const gateRunnerAuthority = vi.hoisted(() => ({
    run: vi.fn(),
}));

vi.mock('../smart-order-readonly-gate-runner.mjs', () => ({
    runManagedSmartOrderReadonlyGateRunner: gateRunnerAuthority.run,
}));

import { startSmartOrderRuntimeController } from './runtime-controller.mjs';
import { SMART_ORDER_RUNTIME_GAP_INVALIDATION_SCHEMA_VERSION } from './runtime-gap-detector.mjs';

const temporaryRoots = [];
const openControllers = new Set();

afterEach(async () => {
    vi.restoreAllMocks();
    gateRunnerAuthority.run.mockReset();
    for (const entry of [...openControllers]) {
        try {
            await entry.controller.stop({ nowEpochMs: entry.stopAtEpochMs });
        } finally {
            openControllers.delete(entry);
        }
    }
    await Promise.all(
        temporaryRoots.splice(0).map((root) =>
            rm(root, { recursive: true, force: true }),
        ),
    );
});

async function privateRoot() {
    const root = await mkdtemp(path.join(tmpdir(), 'smart-order-gate-runner-'));
    temporaryRoots.push(root);
    await chmod(root, 0o700);
    return root;
}

describe('smart-order Runtime Gate runner integration', () => {
    it('keeps broker dispatch closed while allowing read-only Gate recovery during a continuity gap', async () => {
        const appSupportRoot = await privateRoot();
        const startedAtEpochMs = 1_786_377_500_000;
        const verificationNowEpochMs = startedAtEpochMs + 2_000;
        gateRunnerAuthority.run.mockResolvedValue(
            Object.freeze({
                manifests: Object.freeze([]),
                verificationNowEpochMs,
                brokerWriteAuthority: false,
                writeMasterAuthority: false,
            }),
        );
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-gate-runner-continuity',
            nowEpochMs: startedAtEpochMs,
            runtimeEpochId: 'runtime-gate-runner-continuity',
            senderFence: 'fence-gate-runner-continuity',
        });
        openControllers.add({
            controller,
            stopAtEpochMs: verificationNowEpochMs + 1_000,
        });

        await controller.invalidateRuntimeContinuityGap({
            schemaVersion:
                SMART_ORDER_RUNTIME_GAP_INVALIDATION_SCHEMA_VERSION,
            runtimeEpochIdSha256: controller.runtimeEpochIdSha256,
            signalSha256:
                'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            reasonCodes: ['EVENT_LOOP_PAUSE_GAP'],
            nowEpochMs: startedAtEpochMs + 500,
        });
        expect(controller.dispatchAllowed).toBe(false);

        await expect(
            controller.recomputeGateManifests({
                externalOrderEventObservation: true,
                operationId: '123e4567-e89b-42d3-a456-426614174902',
                nowEpochMs: startedAtEpochMs + 1_000,
            }),
        ).resolves.toMatchObject({
            stored: false,
            state: 'observe_only',
            brokerWriteAuthority: false,
            writeMasterAuthority: false,
        });
        expect(controller.dispatchAllowed).toBe(false);
        expect(gateRunnerAuthority.run).toHaveBeenCalledWith({
            appSupportRoot,
            resourceCoordinator: expect.any(Object),
            externalOrderEventObservation: true,
        });
    });

    it('persists an ineligible live result with the Runtime-owned verification clock and replays it fail-closed', async () => {
        const appSupportRoot = await privateRoot();
        const startedAtEpochMs = 1_786_377_600_000;
        const verificationNowEpochMs = startedAtEpochMs + 2_000;
        gateRunnerAuthority.run.mockResolvedValue(
            Object.freeze({
                manifests: Object.freeze([]),
                verificationNowEpochMs,
                brokerWriteAuthority: false,
                writeMasterAuthority: false,
            }),
        );
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-gate-runner-clock',
            nowEpochMs: startedAtEpochMs,
            runtimeEpochId: 'runtime-gate-runner-clock',
            senderFence: 'fence-gate-runner-clock',
        });
        openControllers.add({
            controller,
            stopAtEpochMs: verificationNowEpochMs + 1_000,
        });

        const operationId = '123e4567-e89b-42d3-a456-426614174903';
        await expect(
            controller.recomputeGateManifests({
                operationId,
                nowEpochMs: startedAtEpochMs + 1_000,
            }),
        ).resolves.toEqual({
            stored: false,
            state: 'observe_only',
            reason: 'managed_readonly_evidence_not_eligible',
            manifestCount: 0,
            replayed: false,
            brokerWriteAuthority: false,
            writeMasterAuthority: false,
        });
        expect(gateRunnerAuthority.run).toHaveBeenCalledOnce();
        expect(gateRunnerAuthority.run).toHaveBeenCalledWith({
            appSupportRoot,
            resourceCoordinator: expect.any(Object),
        });

        const database = new DatabaseSync(
            path.join(
                appSupportRoot,
                'smart-order',
                'database',
                'smart-orders.sqlite3',
            ),
            { readOnly: true },
        );
        expect(
            database
                .prepare(`
                    SELECT state, created_at_epoch_ms, updated_at_epoch_ms
                      FROM request_replays WHERE request_id=?
                `)
                .get(operationId),
        ).toEqual({
            state: 'completed',
            created_at_epoch_ms: startedAtEpochMs + 1_000,
            updated_at_epoch_ms: verificationNowEpochMs,
        });
        database.close();

        await expect(
            controller.recomputeGateManifests({
                operationId,
                nowEpochMs: verificationNowEpochMs + 100,
            }),
        ).resolves.toEqual({
            stored: false,
            state: 'observe_only',
            reason: 'managed_readonly_evidence_not_eligible',
            manifestCount: 0,
            replayed: true,
            brokerWriteAuthority: false,
            writeMasterAuthority: false,
        });
        expect(gateRunnerAuthority.run).toHaveBeenCalledOnce();
    });
});
