import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
    currentSmartOrderGateManifestFingerprints,
    isIssuedCurrentSmartOrderGateRunnerManifest,
    runManagedSmartOrderReadonlyGateRunner,
} from './smart-order-readonly-gate-runner.mjs';
import {
    SMART_ORDER_CURRENT_MANUAL_ROUTE_COVERAGE,
    SMART_ORDER_MANUAL_ROUTE_COVERAGE_VERSION,
} from './smart-order-runtime/manual-route-coverage.mjs';
import {
    SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
    SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
} from './smart-order-runtime/canonical-pnl-policy.mjs';
import { SMART_ORDER_SHIOAJI_EVENT_MAPPING_REVISION } from './smart-order-runtime/shioaji-broker-event-mapper.mjs';

describe('managed SmartOrder Gate runner boundary', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('ingests the private signed Node SQLite matrix through the production runner and runtime root', async () => {
        const [runnerSource, controllerSource] = await Promise.all([
            readFile(fileURLToPath(new URL('./smart-order-readonly-gate-runner.mjs', import.meta.url)), 'utf8'),
            readFile(fileURLToPath(new URL('./smart-order-runtime/runtime-controller.mjs', import.meta.url)), 'utf8'),
        ]);
        expect(runnerSource).toContain(
            'verifySmartOrderNodeSqliteCapabilityEvidence',
        );
        expect(runnerSource).toContain('appSupportRoot,');
        expect(runnerSource).toContain(
            'verifiedEvidence.push(nodeSqliteVerification)',
        );
        expect(controllerSource).toContain(
            'runManagedSmartOrderReadonlyGateRunner({\n                    appSupportRoot,',
        );
        expect(controllerSource).toContain(
            'nowEpochMs: verificationNowEpochMs',
        );
    });

    it('uses a Runtime-owned clock after the live probe report is generated', async () => {
        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(1_000)
            .mockReturnValue(2_000);
        const result = await runManagedSmartOrderReadonlyGateRunner();
        expect(result.report.generatedAt).toBe(
            new Date(1_000).toISOString(),
        );
        expect(result.verificationNowEpochMs).toBe(2_000);
        expect(result.verification.reasons).not.toContain(
            'report_time_invalid_or_stale',
        );
        expect(result).toMatchObject({
            stored: false,
            brokerWriteAuthority: false,
            writeMasterAuthority: false,
        });
    });

    it('offers only the bounded confirmed external-event observation path and keeps all writes disabled', async () => {
        const runnerSource = await readFile(
            fileURLToPath(
                new URL(
                    './smart-order-readonly-gate-runner.mjs',
                    import.meta.url,
                ),
            ),
            'utf8',
        );
        expect(runnerSource).toContain("'--observe-external-order-event'");
        expect(runnerSource).toContain(
            'I_CONFIRM_READONLY_OBSERVATION_OF_SEPARATELY_AUTHORIZED_EXTERNAL_SIMULATION_EVENT',
        );
        expect(runnerSource).toContain(
            'EXTERNAL_ORDER_EVENT_OBSERVATION_TIMEOUT_MS',
        );
        expect(runnerSource).toContain(
            'const appSupportRoot = managedSmartOrderReadonlyProbeAppSupportRoot();',
        );
        expect(runnerSource).not.toContain(
            'process.env.REALTIME_STOCK_APP_SUPPORT',
        );
        await expect(
            runManagedSmartOrderReadonlyGateRunner({
                externalOrderEventObservation: 'yes',
            }),
        ).rejects.toThrow(
            'external order-event observation selection must be boolean',
        );

        const result = await runManagedSmartOrderReadonlyGateRunner({
            externalOrderEventObservation: true,
        });
        expect(result).toMatchObject({
            stored: false,
            brokerWriteAuthority: false,
            writeMasterAuthority: false,
        });
        expect(result.verification.eligible).toBe(false);
        expect(result.manifests).toEqual([]);
    });

    it(
        'recomputes every current machine fingerprint from production artifacts',
        async () => {
            const fingerprints = await currentSmartOrderGateManifestFingerprints();
            expect(Object.keys(fingerprints).sort()).toEqual([
            'adapterSha256',
            'appBuildSha256',
            'mappingRevision',
            'nodeRuntimeSha256',
            'orderClassMatrixRevision',
            'orderClassMatrixSha256',
            'osPlatformSha256',
            'pnlPolicyDefinitionSha256',
            'pnlPolicyRevision',
            'routeCoverageSha256',
            'shioajiCapabilitySha256',
            'shioajiServerVersion',
            'sidecarSchemaSha256',
            'sqliteRuntimeSha256',
            ]);
            for (const [key, value] of Object.entries(fingerprints)) {
                if (key.endsWith('Sha256')) {
                    expect(value).toMatch(/^sha256:[a-f0-9]{64}$/);
                }
            }
            expect(fingerprints).toMatchObject({
                mappingRevision: SMART_ORDER_SHIOAJI_EVENT_MAPPING_REVISION,
                orderClassMatrixRevision:
                    SMART_ORDER_MANUAL_ROUTE_COVERAGE_VERSION,
                orderClassMatrixSha256:
                    SMART_ORDER_CURRENT_MANUAL_ROUTE_COVERAGE.coverageSha256,
                routeCoverageSha256:
                    SMART_ORDER_CURRENT_MANUAL_ROUTE_COVERAGE.coverageSha256,
                pnlPolicyDefinitionSha256:
                    SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
                pnlPolicyRevision: SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
            });
        },
        15_000,
    );

    it('does not accept structural manifest clones as Gate-runner-issued authority', () => {
        const structural = Object.freeze({
            manifestSha256: `sha256:${'a'.repeat(64)}`,
            state: 'observe_only',
        });
        expect(isIssuedCurrentSmartOrderGateRunnerManifest(structural)).toBe(
            false,
        );
        expect(
            isIssuedCurrentSmartOrderGateRunnerManifest({ ...structural }),
        ).toBe(false);
    });
});
