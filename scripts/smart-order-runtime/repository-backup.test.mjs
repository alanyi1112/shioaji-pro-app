import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
    prepareSmartOrderPrivateStorage,
    readPrivateSecret,
} from './private-storage.mjs';
import {
    restoreSmartOrderRepositoryBackup,
    verifySmartOrderRepositoryBackup,
} from './repository-backup.mjs';
import { openSmartOrderRepository } from './repository-client.mjs';
import {
    SMART_ORDER_REPOSITORY_SCHEMA_ID,
    SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
} from './repository-schema.mjs';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const temporaryRoots = [];
const openClients = new Set();

afterEach(async () => {
    await Promise.all(
        [...openClients].map(async (client) => {
            try {
                await client.close();
            } finally {
                openClients.delete(client);
            }
        }),
    );
    await Promise.all(
        temporaryRoots.splice(0).map((root) =>
            rm(root, { recursive: true, force: true }),
        ),
    );
});

async function createBackupFixture() {
    const root = await mkdtemp(path.join(tmpdir(), 'smart-order-backup-'));
    temporaryRoots.push(root);
    const storage = await prepareSmartOrderPrivateStorage({ appSupportRoot: root });
    const client = await openSmartOrderRepository({
        databasePath: storage.paths.databasePath,
        backupDirectory: storage.paths.backupDirectory,
        identityKeyPath: storage.paths.identityKeyPath,
        testOnlyAllowUnverifiedIdentitySeed: true,
    });
    openClients.add(client);
    await client.request('insertStrategy', {
        strategyId: 'strategy-backup-1',
        strategyKind: 'quick',
        state: 'monitoring',
        definitionHash: DIGEST_A,
        definition: { schemaVersion: 'strategy/1', kind: 'quick' },
        accountBrokerRef: 'broker-fixture',
        accountIdRef: 'account-fixture',
        identityGroupId: 'identity-fixture',
        confirmationSnapshotHash: DIGEST_B,
        nowEpochMs: 1_786_377_600_000,
    });
    const backupName = 'smart-orders-fixture.sqlite3';
    await client.request('createRepositoryBackup', {
        backupName,
        createdAtEpochMs: 1_786_377_600_100,
    });
    const backupPath = path.join(storage.paths.backupDirectory, backupName);
    return {
        client,
        storage,
        backupPath,
        manifestPath: `${backupPath}.manifest.json`,
    };
}

async function existingArtifactBuffers(paths) {
    const artifacts = [];
    for (const artifactPath of paths) {
        try {
            artifacts.push({
                artifactPath,
                value: await readFile(artifactPath),
            });
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
    }
    return artifacts;
}

function secretEncodings(value) {
    const buffer = Buffer.from(value);
    return [
        buffer,
        Buffer.from(buffer.toString('hex')),
        Buffer.from(buffer.toString('base64')),
    ];
}

describe('smart-order repository backup restore boundary', () => {
    it('verifies and restores a consistent snapshot into a new private path', async () => {
        const fixture = await createBackupFixture();
        await fixture.client.close();
        openClients.delete(fixture.client);

        await expect(
            verifySmartOrderRepositoryBackup({
                backupPath: fixture.backupPath,
                manifestPath: fixture.manifestPath,
            }),
        ).resolves.toMatchObject({
            repositorySchemaId: SMART_ORDER_REPOSITORY_SCHEMA_ID,
            repositorySchemaVersion: SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
            rowCounts: { strategies: 1 },
            containsSecrets: false,
        });

        const destinationPath = path.join(
            fixture.storage.paths.databaseDirectory,
            'restored-smart-orders.sqlite3',
        );
        await expect(
            restoreSmartOrderRepositoryBackup({
                backupPath: fixture.backupPath,
                manifestPath: fixture.manifestPath,
                destinationPath,
            }),
        ).resolves.toMatchObject({
            restored: true,
            existingRepositoryReplaced: false,
            rowCounts: { strategies: 1 },
            destinationPermissions: '0600',
        });
        expect((await stat(destinationPath)).mode & 0o777).toBe(0o600);
        const restored = new DatabaseSync(destinationPath, { readOnly: true });
        expect(
            restored.prepare('SELECT strategy_id FROM strategies').get()?.strategy_id,
        ).toBe('strategy-backup-1');
        restored.close();

        await expect(
            restoreSmartOrderRepositoryBackup({
                backupPath: fixture.backupPath,
                manifestPath: fixture.manifestPath,
                destinationPath,
            }),
        ).rejects.toThrow('already exists');
    });

    it('fails closed when the manifest row counts are changed', async () => {
        const fixture = await createBackupFixture();
        const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8'));
        manifest.rowCounts.strategies = 99;
        await writeFile(fixture.manifestPath, `${JSON.stringify(manifest)}\n`, {
            encoding: 'utf8',
            mode: 0o600,
        });

        await expect(
            verifySmartOrderRepositoryBackup({
                backupPath: fixture.backupPath,
                manifestPath: fixture.manifestPath,
            }),
        ).rejects.toThrow('row count mismatch for strategies');
    });

    it('keeps private capability, identity key and installation id out of SQLite artifacts and backups', async () => {
        const fixture = await createBackupFixture();
        const capability = await readPrivateSecret(
            fixture.storage.paths.capabilityPath,
        );
        const identityKey = await readPrivateSecret(
            fixture.storage.paths.identityKeyPath,
        );
        const installationId = Buffer.from(
            (
                await readFile(
                    fixture.storage.paths.installationIdPath,
                    'utf8',
                )
            ).trim(),
        );

        const artifactPaths = [
            fixture.storage.paths.databasePath,
            `${fixture.storage.paths.databasePath}-wal`,
            `${fixture.storage.paths.databasePath}-shm`,
            fixture.backupPath,
            fixture.manifestPath,
        ];
        const liveArtifacts = await existingArtifactBuffers(artifactPaths);
        await fixture.client.close();
        openClients.delete(fixture.client);
        const closedArtifacts = await existingArtifactBuffers(artifactPaths);
        const artifacts = [...liveArtifacts, ...closedArtifacts];
        expect(liveArtifacts.map(({ artifactPath }) => artifactPath)).toEqual(
            expect.arrayContaining(artifactPaths),
        );

        try {
            for (const { value } of artifacts) {
                for (const secret of [capability, identityKey, installationId]) {
                    for (const encoded of secretEncodings(secret)) {
                        expect(value.includes(encoded)).toBe(false);
                    }
                }
            }
        } finally {
            capability.fill(0);
            identityKey.fill(0);
            installationId.fill(0);
            for (const artifact of artifacts) artifact.value.fill(0);
        }
    });
});
