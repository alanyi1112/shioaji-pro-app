import {
    chmod,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    stat,
    symlink,
    unlink,
    writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    consumePrivateLifecycleStopCompletion,
    prepareSmartOrderPrivateStorage,
    readPrivateSecret,
    readPendingPrivateLifecycleStopCompletion,
    redactPrivateRuntimeStatus,
    removePrivateLifecycleStopBarrier,
    rotatePrivateGatewayCapability,
    writePrivateLifecycleStopBarrier,
    writePrivateLifecycleStopCompletion,
} from './private-storage.mjs';
import { smartOrderRepositoryRootForTest } from './repo-external-root.mjs';

const temporaryRoots = [];

afterEach(async () => {
    const roots = temporaryRoots.splice(0);
    await Promise.all(
        roots.map((temporaryRoot) =>
            rm(temporaryRoot, { recursive: true, force: true }),
        ),
    );
    await Promise.all(
        roots.map((temporaryRoot) => {
            const hash = createHash('sha256')
                .update(path.join(temporaryRoot, 'smart-order'))
                .digest('hex')
                .slice(0, 16);
            const base = process.platform === 'darwin' ? '/private/tmp' : '/tmp';
            return rm(
                path.join(
                    base,
                    `realtimestock-smart-order-${process.getuid?.() ?? 'user'}-${hash}`,
                ),
                { recursive: true, force: true },
            );
        }),
    );
});

async function temporaryAppSupport() {
    const root = await mkdtemp(path.join(tmpdir(), 'realtimestock-smart-order-'));
    temporaryRoots.push(root);
    return root;
}

function permissionBits(mode) {
    return mode & 0o777;
}

describe('smart-order private Application Support storage', () => {
    it('creates stable repo-external secrets and private directories idempotently', async () => {
        const appSupportRoot = await temporaryAppSupport();
        const first = await prepareSmartOrderPrivateStorage({ appSupportRoot });
        const capabilityBefore = await readPrivateSecret(first.paths.capabilityPath);
        const identityBefore = await readPrivateSecret(first.paths.identityKeyPath);
        const second = await prepareSmartOrderPrivateStorage({ appSupportRoot });

        expect(await readPrivateSecret(second.paths.capabilityPath)).toEqual(
            capabilityBefore,
        );
        expect(await readPrivateSecret(second.paths.identityKeyPath)).toEqual(
            identityBefore,
        );
        for (const directoryPath of [
            second.paths.root,
            second.paths.databaseDirectory,
            second.paths.backupDirectory,
            second.paths.secretDirectory,
            second.paths.runDirectory,
            second.paths.runtimeLeaseDirectory,
        ]) {
            expect(permissionBits((await stat(directoryPath)).mode)).toBe(0o700);
        }
        for (const filePath of [
            second.paths.capabilityPath,
            second.paths.identityKeyPath,
            second.paths.installationIdPath,
            second.paths.repositoryExpectationPath,
            second.paths.settingsSummaryPath,
        ]) {
            expect(permissionBits((await stat(filePath)).mode)).toBe(0o600);
        }
    });

    it('rotates only the gateway capability through an atomic private replacement', async () => {
        const appSupportRoot = await temporaryAppSupport();
        const storage = await prepareSmartOrderPrivateStorage({ appSupportRoot });
        const capabilityBefore = await readPrivateSecret(
            storage.paths.capabilityPath,
        );
        const identityBefore = await readPrivateSecret(
            storage.paths.identityKeyPath,
        );

        await expect(
            rotatePrivateGatewayCapability(storage.paths.capabilityPath),
        ).resolves.toEqual({ rotated: true, secretValuesExposed: false });

        const capabilityAfter = await readPrivateSecret(
            storage.paths.capabilityPath,
        );
        const identityAfter = await readPrivateSecret(
            storage.paths.identityKeyPath,
        );
        expect(capabilityAfter).not.toEqual(capabilityBefore);
        expect(identityAfter).toEqual(identityBefore);
        expect(permissionBits((await stat(storage.paths.capabilityPath)).mode)).toBe(
            0o600,
        );
        capabilityBefore.fill(0);
        capabilityAfter.fill(0);
        identityBefore.fill(0);
        identityAfter.fill(0);
    });

    it('returns a status and persisted summary that cannot reveal key bytes', async () => {
        const appSupportRoot = await temporaryAppSupport();
        const storage = await prepareSmartOrderPrivateStorage({ appSupportRoot });
        const capability = await readPrivateSecret(storage.paths.capabilityPath);
        const identityKey = await readPrivateSecret(storage.paths.identityKeyPath);
        const status = JSON.stringify(redactPrivateRuntimeStatus(storage));
        const summary = await readFile(storage.paths.settingsSummaryPath, 'utf8');
        for (const secret of [capability, identityKey]) {
            expect(status).not.toContain(Buffer.from(secret).toString('hex'));
            expect(status).not.toContain(Buffer.from(secret).toString('base64'));
            expect(summary).not.toContain(Buffer.from(secret).toString('hex'));
            expect(summary).not.toContain(Buffer.from(secret).toString('base64'));
        }
        expect(JSON.parse(status)).toEqual({
            schemaVersion: 'smart-order-private-storage/2026-08-13.3',
            repository: 'sqlite-private',
            capability: 'present-private-file',
            identityKey: 'present-private-file',
            secretValuesExposed: false,
        });
    });

    it('rejects broad or implicit storage roots', async () => {
        await expect(
            prepareSmartOrderPrivateStorage({ appSupportRoot: '/' }),
        ).rejects.toThrow('filesystem root');
        await expect(
            prepareSmartOrderPrivateStorage({ appSupportRoot: 'relative/path' }),
        ).rejects.toThrow('explicit absolute');
    });

    it('rejects repository-contained roots before creating any secret', async () => {
        const repositoryRoot = smartOrderRepositoryRootForTest();
        await expect(
            prepareSmartOrderPrivateStorage({
                appSupportRoot: path.join(
                    repositoryRoot,
                    '.forbidden-smart-order-private-root',
                ),
            }),
        ).rejects.toThrow(/outside the source repository/);

        const aliasRoot = await temporaryAppSupport();
        const aliasPath = path.join(aliasRoot, 'repository-alias');
        await symlink(repositoryRoot, aliasPath);
        await expect(
            prepareSmartOrderPrivateStorage({
                appSupportRoot: path.join(aliasPath, 'private-root'),
            }),
        ).rejects.toThrow(/outside the source repository/);
    });

    it('rejects secret and installation-id symlink substitution', async () => {
        const appSupportRoot = await temporaryAppSupport();
        const privateDirectory = path.join(
            appSupportRoot,
            'smart-order',
            'private',
        );
        await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
        const outsideSecret = path.join(appSupportRoot, 'outside-secret');
        await writeFile(outsideSecret, Buffer.alloc(32, 7), { mode: 0o600 });
        await symlink(
            outsideSecret,
            path.join(privateDirectory, 'gateway-capability.bin'),
        );

        await expect(
            prepareSmartOrderPrivateStorage({ appSupportRoot }),
        ).rejects.toThrow();
        await expect(
            readPrivateSecret(
                path.join(privateDirectory, 'gateway-capability.bin'),
            ),
        ).rejects.toThrow();

        await unlink(path.join(privateDirectory, 'gateway-capability.bin'));
        await symlink(
            outsideSecret,
            path.join(privateDirectory, 'installation-id'),
        );
        await expect(
            prepareSmartOrderPrivateStorage({ appSupportRoot }),
        ).rejects.toThrow();
    });

    it('fails closed instead of silently reusing a previously exposed secret', async () => {
        const appSupportRoot = await temporaryAppSupport();
        const storage = await prepareSmartOrderPrivateStorage({ appSupportRoot });
        await chmod(storage.paths.capabilityPath, 0o644);
        await expect(
            prepareSmartOrderPrivateStorage({ appSupportRoot }),
        ).rejects.toThrow('invalid shape');
    });

    it('persists a repository expectation marker outside SQLite and never resets it', async () => {
        const appSupportRoot = await temporaryAppSupport();
        const first = await prepareSmartOrderPrivateStorage({ appSupportRoot });
        expect(
            JSON.parse(
                await readFile(first.paths.repositoryExpectationPath, 'utf8'),
            ),
        ).toMatchObject({
            schemaVersion: 'smart-order-repository-expectation/2026-08-11.1',
            repositoryExpected: false,
        });
        const marker = JSON.parse(
            await readFile(first.paths.repositoryExpectationPath, 'utf8'),
        );
        marker.repositoryExpected = true;
        await writeFile(
            first.paths.repositoryExpectationPath,
            `${JSON.stringify(marker)}\n`,
            { mode: 0o600 },
        );
        const second = await prepareSmartOrderPrivateStorage({ appSupportRoot });
        expect(
            JSON.parse(
                await readFile(second.paths.repositoryExpectationPath, 'utf8'),
            ).repositoryExpected,
        ).toBe(true);
    });

    it('atomically replaces a settings-summary symlink without changing its target', async () => {
        const appSupportRoot = await temporaryAppSupport();
        const first = await prepareSmartOrderPrivateStorage({ appSupportRoot });
        const outside = path.join(appSupportRoot, 'outside-summary');
        await writeFile(outside, 'do-not-change\n', { mode: 0o600 });
        await unlink(first.paths.settingsSummaryPath);
        await symlink(outside, first.paths.settingsSummaryPath);

        const second = await prepareSmartOrderPrivateStorage({ appSupportRoot });
        expect(await readFile(outside, 'utf8')).toBe('do-not-change\n');
        expect(
            JSON.parse(await readFile(second.paths.settingsSummaryPath, 'utf8')),
        ).toMatchObject({ secretValuesExposed: false });
    });

    it('binds lifecycle stop completion to capability, request, nonce, epoch, generation, revision and single consumption', async () => {
        const appSupportRoot = await temporaryAppSupport();
        const storage = await prepareSmartOrderPrivateStorage({ appSupportRoot });
        const capability = await readPrivateSecret(storage.paths.capabilityPath);
        const completion = {
            operation: 'graceful_stop',
            runtimeEpochIdSha256: `sha256:${'1'.repeat(64)}`,
            apiGenerationSha256: `sha256:${'2'.repeat(64)}`,
            stopRevision: 7,
            completionNonceSha256: `sha256:${'3'.repeat(64)}`,
            requestIdSha256: `sha256:${'4'.repeat(64)}`,
            completedAtEpochMs: 1_800_000_000_000,
            repositoryClosed: true,
            controlPlaneUnpublished: true,
            runtimeLeaseReleased: true,
        };
        await writePrivateLifecycleStopCompletion(
            storage.paths.lifecycleStopCompletionPath,
            { capability, completion },
        );
        const expected = Object.fromEntries(
            [
                'operation',
                'runtimeEpochIdSha256',
                'apiGenerationSha256',
                'stopRevision',
                'completionNonceSha256',
                'requestIdSha256',
            ].map((key) => [key, completion[key]]),
        );
        await writePrivateLifecycleStopBarrier(
            storage.paths.lifecycleStopBarrierPath,
            { capability, binding: expected },
        );
        await expect(
            readPendingPrivateLifecycleStopCompletion(
                storage.paths.lifecycleStopCompletionPath,
                {
                    capability,
                    barrierPath: storage.paths.lifecycleStopBarrierPath,
                },
            ),
        ).resolves.toMatchObject({
            expected,
            completion: {
                operation: 'graceful_stop',
                stopRevision: 7,
                repositoryClosed: true,
                controlPlaneUnpublished: true,
                runtimeLeaseReleased: true,
            },
        });
        let accessorReads = 0;
        const forgedExpected = {};
        for (const [key, value] of Object.entries(expected)) {
            Object.defineProperty(forgedExpected, key, {
                enumerable: true,
                get() {
                    accessorReads += 1;
                    return value;
                },
            });
        }
        await expect(
            consumePrivateLifecycleStopCompletion(
                storage.paths.lifecycleStopCompletionPath,
                {
                    capability,
                    expected: forgedExpected,
                    barrierPath: storage.paths.lifecycleStopBarrierPath,
                },
            ),
        ).rejects.toThrow('must be an own data property');
        expect(accessorReads).toBe(0);
        await expect(
            consumePrivateLifecycleStopCompletion(
                storage.paths.lifecycleStopCompletionPath,
                {
                    capability,
                    barrierPath: storage.paths.lifecycleStopBarrierPath,
                    expected: {
                        ...expected,
                        completionNonceSha256: `sha256:${'5'.repeat(64)}`,
                    },
                },
            ),
        ).rejects.toThrow('proof or binding is invalid');
        await writePrivateLifecycleStopBarrier(
            storage.paths.lifecycleStopBarrierPath,
            {
                capability,
                binding: {
                    ...expected,
                    requestIdSha256: `sha256:${'6'.repeat(64)}`,
                },
            },
        );
        await expect(
            consumePrivateLifecycleStopCompletion(
                storage.paths.lifecycleStopCompletionPath,
                {
                    capability,
                    expected,
                    barrierPath: storage.paths.lifecycleStopBarrierPath,
                },
            ),
        ).rejects.toThrow('barrier proof or binding is invalid');
        await writePrivateLifecycleStopBarrier(
            storage.paths.lifecycleStopBarrierPath,
            { capability, binding: expected },
        );
        await expect(
            consumePrivateLifecycleStopCompletion(
                storage.paths.lifecycleStopCompletionPath,
                {
                    capability,
                    expected,
                    barrierPath: storage.paths.lifecycleStopBarrierPath,
                },
            ),
        ).resolves.toMatchObject({
            operation: 'graceful_stop',
            stopRevision: 7,
            repositoryClosed: true,
            controlPlaneUnpublished: true,
            runtimeLeaseReleased: true,
            secretValuesExposed: false,
        });
        await expect(
            consumePrivateLifecycleStopCompletion(
                storage.paths.lifecycleStopCompletionPath,
                {
                    capability,
                    expected,
                    barrierPath: storage.paths.lifecycleStopBarrierPath,
                },
            ),
        ).rejects.toMatchObject({ code: 'ENOENT' });
        capability.fill(0);
    });

    it('removes only the exact authenticated pre-commit lifecycle barrier', async () => {
        const root = await temporaryAppSupport();
        const storage = await prepareSmartOrderPrivateStorage({
            appSupportRoot: root,
        });
        const capability = await readPrivateSecret(
            storage.paths.capabilityPath,
        );
        const binding = {
            operation: 'graceful_stop',
            runtimeEpochIdSha256: `sha256:${'1'.repeat(64)}`,
            apiGenerationSha256: `sha256:${'2'.repeat(64)}`,
            stopRevision: 6,
            completionNonceSha256: `sha256:${'3'.repeat(64)}`,
            requestIdSha256: `sha256:${'4'.repeat(64)}`,
        };
        try {
            await writePrivateLifecycleStopBarrier(
                storage.paths.lifecycleStopBarrierPath,
                { capability, binding },
            );
            await expect(
                removePrivateLifecycleStopBarrier(
                    storage.paths.lifecycleStopBarrierPath,
                    {
                        capability,
                        expected: { ...binding, stopRevision: 7 },
                    },
                ),
            ).rejects.toThrow('barrier proof or binding is invalid');
            await expect(
                removePrivateLifecycleStopBarrier(
                    storage.paths.lifecycleStopBarrierPath,
                    { capability, expected: binding },
                ),
            ).resolves.toEqual({
                removed: true,
                secretValuesExposed: false,
            });
            await expect(
                stat(storage.paths.lifecycleStopBarrierPath),
            ).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            capability.fill(0);
        }
    });
});
