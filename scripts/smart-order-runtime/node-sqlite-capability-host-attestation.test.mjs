import { chmod, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    ensureNodeSqliteCapabilityHostSigningIdentity,
    writeNodeSqliteCapabilityTrustedHost,
} from './node-sqlite-capability-host-attestation.mjs';

const temporaryDirectories = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) => rm(directory, { recursive: true, force: true })),
    );
});

async function privateRoot(prefix) {
    const raw = await mkdtemp(path.join(tmpdir(), prefix));
    temporaryDirectories.push(raw);
    await chmod(raw, 0o700);
    return realpath(raw);
}

describe('Node SQLite capability host attestation storage', () => {
    it('creates one stable private arm64 Ed25519 identity and binds one report lineage', async () => {
        const armRoot = await privateRoot('node-sqlite-attestation-arm-');
        const arm = await ensureNodeSqliteCapabilityHostSigningIdentity({
            appSupportRoot: armRoot,
            architecture: 'arm64',
        });
        const armAgain = await ensureNodeSqliteCapabilityHostSigningIdentity({
            appSupportRoot: armRoot,
            architecture: 'arm64',
        });
        expect(armAgain.publicRecord).toEqual(arm.publicRecord);
        const privateKeyPath = path.join(
            arm.evidenceDirectory,
            'arm64-host-attestation-private-key-v2.der',
        );
        const publicRecordPath = path.join(
            arm.evidenceDirectory,
            'arm64-host-attestation-public-v2.json',
        );
        expect((await stat(privateKeyPath)).mode & 0o777).toBe(0o600);
        expect((await stat(publicRecordPath)).mode & 0o777).toBe(0o600);

        const report = {
            platform: { hardwareArch: 'arm64' },
            attestation: { hostKeyId: arm.publicRecord.hostKeyId },
            resultHash: '1'.repeat(64),
            runId: randomUUID(),
        };
        await expect(
            writeNodeSqliteCapabilityTrustedHost({
                appSupportRoot: armRoot,
                host: arm.publicRecord,
                report,
            }),
        ).resolves.toMatchObject({
            written: true,
            generation: 1,
            secretValuesExposed: false,
        });
        await expect(
            writeNodeSqliteCapabilityTrustedHost({
                appSupportRoot: armRoot,
                host: arm.publicRecord,
                report,
            }),
        ).resolves.toMatchObject({
            written: true,
            generation: 2,
            secretValuesExposed: false,
        });
        expect(
            (
                await stat(
                    path.join(
                        arm.evidenceDirectory,
                        'trusted-hosts.json',
                    ),
                )
            ).mode & 0o777,
        ).toBe(0o600);
    });

    it('rejects x64 enrollment and a report not bound to the arm64 host key', async () => {
        const root = await privateRoot('node-sqlite-attestation-reject-');
        await expect(
            ensureNodeSqliteCapabilityHostSigningIdentity({
                appSupportRoot: root,
                architecture: 'x64',
            }),
        ).rejects.toThrow('requires native Apple Silicon arm64');
        const arm = await ensureNodeSqliteCapabilityHostSigningIdentity({
            appSupportRoot: root,
            architecture: 'arm64',
        });
        await expect(
            writeNodeSqliteCapabilityTrustedHost({
                appSupportRoot: root,
                host: arm.publicRecord,
                report: {
                    platform: { hardwareArch: 'x64' },
                    attestation: { hostKeyId: arm.publicRecord.hostKeyId },
                    resultHash: '2'.repeat(64),
                    runId: randomUUID(),
                },
            }),
        ).rejects.toThrow('report binding is invalid');
    });

    it('rejects broad app-support permissions before creating key material', async () => {
        const root = await privateRoot('node-sqlite-attestation-broad-');
        await chmod(root, 0o755);
        await expect(
            ensureNodeSqliteCapabilityHostSigningIdentity({
                appSupportRoot: root,
                architecture: 'arm64',
            }),
        ).rejects.toThrow('current-user private');
    });
});
