import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
    chmod,
    mkdtemp,
    readFile,
    realpath,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from './smart-order-runtime/canonical-json.mjs';
import {
    SMART_ORDER_REQUIRED_NODE_SQLITE_CHECK_IDS,
    verifySmartOrderNodeSqliteCapabilityEvidence,
} from './smart-order-runtime/gate-evidence-verifier.mjs';
import {
    runSmartOrderNodeSqliteCapabilityProbe,
    verifySmartOrderManagedLaunchAgentArtifacts,
} from './smart-order-node-sqlite-capability-probe.mjs';

const temporaryDirectories = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) => rm(directory, { recursive: true, force: true })),
    );
});

describe('Node SQLite capability probe safety boundary', () => {
    it('requires the persisted-runtime launcher and binds source before and after a fresh child', async () => {
        const workerPath = fileURLToPath(
            new URL('./smart-order-node-sqlite-capability-probe.mjs', import.meta.url),
        );
        const launcherPath = fileURLToPath(
            new URL('./smart-order-node-sqlite-capability-launcher.mjs', import.meta.url),
        );
        expect(() =>
            execFileSync(process.execPath, [workerPath], {
                env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
                stdio: 'pipe',
            }),
        ).toThrow();
        const [workerSource, launcherSource] = await Promise.all([
            readFile(workerPath, 'utf8'),
            readFile(launcherPath, 'utf8'),
        ]);
        expect(workerSource).toContain(
            'REALTIME_STOCK_NODE_SQLITE_EXPECTED_FINGERPRINTS',
        );
        expect(workerSource).toContain('MODULE_LOAD_SOURCE_FINGERPRINTS');
        expect(launcherSource).toContain(
            'const before = await currentSmartOrderNodeSqliteCapabilityFingerprints()',
        );
        expect(launcherSource).toContain('spawn(process.execPath, [WORKER_FILE]');
        expect(launcherSource).toContain(
            'const after = await currentSmartOrderNodeSqliteCapabilityFingerprints()',
        );
    });

    it('runs only offline temp artifacts and refuses to pass on the test Node runtime', async () => {
        const report = await runSmartOrderNodeSqliteCapabilityProbe({
            testOnlyForceUnsupportedRuntime: true,
        });
        const checks = new Map(report.checks.map((check) => [check.id, check.status]));

        expect([...checks.keys()]).toEqual(
            SMART_ORDER_REQUIRED_NODE_SQLITE_CHECK_IDS,
        );
        expect(checks.get('node-24-lts')).toBe('fail');
        expect(checks.get('node-sqlite-import')).toBe('pass');
        expect(checks.get('wal')).toBe('pass');
        expect(checks.get('synchronous-full')).toBe('pass');
        expect(checks.get('defensive-mode')).toBe('pass');
        expect(checks.get('crash-durability')).toBe('pass');
        expect(checks.get('backup-restore')).toBe('pass');
        expect(checks.get('dedicated-worker-event-loop-isolation')).toBe(
            'pass',
        );
        expect(checks.get('latency-watchdog-fail-closed')).toBe('pass');
        expect(report).toMatchObject({
            evidenceClass: 'test_fixture',
            executionMode: 'test-fixture',
            overall: 'fail',
            testOutcome: 'fail',
            sideEffects: {
                brokerWritesAttempted: 0,
                brokerWritesNetworked: 0,
                serviceMutations: 0,
            },
        });
        expect(
            Object.values(report.fingerprint).every((value) =>
                /^[a-f0-9]{64}$/.test(value),
            ),
        ).toBe(true);
        expect(report.resultHash).toBe(
            createHash('sha256')
                .update(canonicalJson({ ...report, resultHash: '' }))
                .digest('hex'),
        );

        const decision = await verifySmartOrderNodeSqliteCapabilityEvidence({
            nowEpochMs: Date.parse(report.generatedAt),
            readPlatformSupport: async () => ({
                supportPolicy:
                    'smart-order-trading-runtime-platform/native-apple-silicon-arm64/2026-08-22.1',
            }),
        });
        expect(decision).toMatchObject({
            eligible: false,
            evidenceClass: 'node_sqlite_capability',
            reasons: ['private_evidence_store_invalid_or_incomplete'],
        });
    });

    it('binds the securely-read installed runtime bytes and plist stdin to current content', async () => {
        const rawDirectory = await mkdtemp(
            path.join(tmpdir(), 'node-sqlite-launchagent-artifacts-'),
        );
        temporaryDirectories.push(rawDirectory);
        const directory = await realpath(rawDirectory);
        await chmod(directory, 0o700);
        const sourceRuntime = fileURLToPath(
            new URL('./realtimestock-runtime', import.meta.url),
        );
        const installedRuntime = path.join(directory, 'realtimestock-runtime');
        const runtimeBytes = await readFile(sourceRuntime);
        await writeFile(installedRuntime, runtimeBytes, { mode: 0o700 });
        await chmod(installedRuntime, 0o700);
        const plistPath = path.join(directory, 'sidecar.plist');
        await writeFile(
            plistPath,
            `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>ProgramArguments</key><array><string>${installedRuntime}</string><string>service-smart-order-sidecar</string></array></dict></plist>\n`,
            { mode: 0o600 },
        );
        await chmod(plistPath, 0o600);
        const runtimeSha256 = createHash('sha256')
            .update(runtimeBytes)
            .digest('hex');
        await expect(
            verifySmartOrderManagedLaunchAgentArtifacts({
                launchAgentPlistPath: plistPath,
                installedRuntimeScriptPath: installedRuntime,
                expectedRuntimeScriptSha256: runtimeSha256,
            }),
        ).resolves.toMatchObject({
            installedRuntimeScriptSha256: `sha256:${runtimeSha256}`,
            launchAgentPlistSha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        });
        await expect(
            verifySmartOrderManagedLaunchAgentArtifacts({
                launchAgentPlistPath: plistPath,
                expectedRuntimeScriptSha256: runtimeSha256,
            }),
        ).resolves.toMatchObject({
            installedRuntimeScriptSha256: `sha256:${runtimeSha256}`,
        });
        const otherRuntime = path.join(directory, 'other-runtime');
        await writeFile(otherRuntime, runtimeBytes, { mode: 0o700 });
        await chmod(otherRuntime, 0o700);
        await expect(
            verifySmartOrderManagedLaunchAgentArtifacts({
                launchAgentPlistPath: plistPath,
                installedRuntimeScriptPath: otherRuntime,
                expectedRuntimeScriptSha256: runtimeSha256,
            }),
        ).rejects.toThrow('does not match LaunchAgent');
        await writeFile(installedRuntime, '#!/bin/zsh\nexit 1\n', { mode: 0o700 });
        await chmod(installedRuntime, 0o700);
        await expect(
            verifySmartOrderManagedLaunchAgentArtifacts({
                launchAgentPlistPath: plistPath,
                installedRuntimeScriptPath: installedRuntime,
                expectedRuntimeScriptSha256: runtimeSha256,
            }),
        ).rejects.toThrow('stale or untrusted');
        runtimeBytes.fill(0);
    });
});
