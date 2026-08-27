import { createHash, randomUUID } from 'node:crypto';
import {
    chmod,
    copyFile,
    link,
    lstat,
    open,
    readFile,
    realpath,
    unlink,
} from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
    REQUIRED_SMART_ORDER_TABLES,
    SMART_ORDER_REPOSITORY_SCHEMA_ID,
    SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
} from './repository-schema.mjs';

const PRIVATE_FILE_MODE = 0o600;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MANIFEST_SCHEMA_VERSION = 'smart-order-backup-manifest/2026-08-11.1';
const MANIFEST_KEYS = Object.freeze([
    'backupName',
    'containsSecrets',
    'copiedPages',
    'createdAtEpochMs',
    'databaseSha256',
    'repositorySchemaId',
    'repositorySchemaVersion',
    'rowCounts',
    'schemaVersion',
]);

function assertAbsolutePath(value, label) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) {
        throw new TypeError(`${label} must be an explicit absolute path`);
    }
    return path.resolve(value);
}

async function assertPrivateDirectory(directoryPath, label) {
    const metadata = await lstat(directoryPath);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error(`${label} must be a private directory`);
    }
    if ((metadata.mode & 0o077) !== 0) {
        throw new Error(`${label} permissions are too broad`);
    }
    if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
        throw new Error(`${label} must be owned by the current user`);
    }
    return realpath(directoryPath);
}

async function assertPrivateFile(filePath, label, maximumBytes) {
    const metadata = await lstat(filePath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error(`${label} must be a private regular file`);
    }
    if ((metadata.mode & 0o077) !== 0) {
        throw new Error(`${label} permissions are too broad`);
    }
    if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
        throw new Error(`${label} must be owned by the current user`);
    }
    if (maximumBytes !== undefined && metadata.size > maximumBytes) {
        throw new Error(`${label} exceeds its size limit`);
    }
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function safeInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} must be a non-negative safe integer`);
    }
    return value;
}

function parseManifest(serialized, backupPath) {
    let manifest;
    try {
        manifest = JSON.parse(serialized);
    } catch {
        throw new Error('backup manifest is not valid JSON');
    }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error('backup manifest must be an object');
    }
    const keys = Object.keys(manifest).sort();
    if (JSON.stringify(keys) !== JSON.stringify([...MANIFEST_KEYS].sort())) {
        throw new Error('backup manifest fields do not match the canonical schema');
    }
    if (
        manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
        manifest.repositorySchemaId !== SMART_ORDER_REPOSITORY_SCHEMA_ID ||
        manifest.repositorySchemaVersion !== SMART_ORDER_REPOSITORY_SCHEMA_VERSION ||
        manifest.backupName !== path.basename(backupPath) ||
        manifest.containsSecrets !== false ||
        !/^sha256:[0-9a-f]{64}$/.test(manifest.databaseSha256)
    ) {
        throw new Error('backup manifest identity is invalid');
    }
    safeInteger(manifest.createdAtEpochMs, 'manifest.createdAtEpochMs');
    safeInteger(manifest.copiedPages, 'manifest.copiedPages');
    if (
        !manifest.rowCounts ||
        typeof manifest.rowCounts !== 'object' ||
        Array.isArray(manifest.rowCounts) ||
        JSON.stringify(Object.keys(manifest.rowCounts).sort()) !==
            JSON.stringify([...REQUIRED_SMART_ORDER_TABLES].sort())
    ) {
        throw new Error('backup manifest row-count table set is invalid');
    }
    for (const table of REQUIRED_SMART_ORDER_TABLES) {
        safeInteger(manifest.rowCounts[table], `manifest.rowCounts.${table}`);
    }
    return Object.freeze({
        ...manifest,
        rowCounts: Object.freeze({ ...manifest.rowCounts }),
    });
}

function verifyDatabaseSnapshot(databasePath, manifest) {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
        if (database.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') {
            throw new Error('backup database integrity check failed');
        }
        if (database.prepare('PRAGMA foreign_key_check').get()) {
            throw new Error('backup database foreign-key check failed');
        }
        if (
            database.prepare('PRAGMA user_version').get()?.user_version !==
            SMART_ORDER_REPOSITORY_SCHEMA_VERSION
        ) {
            throw new Error('backup database schema version mismatch');
        }
        if (
            database
                .prepare("SELECT value FROM repository_meta WHERE key='schema_id'")
                .get()?.value !== SMART_ORDER_REPOSITORY_SCHEMA_ID
        ) {
            throw new Error('backup database schema identity mismatch');
        }
        for (const table of REQUIRED_SMART_ORDER_TABLES) {
            const count = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()
                ?.count;
            if (count !== manifest.rowCounts[table]) {
                throw new Error(`backup row count mismatch for ${table}`);
            }
        }
    } finally {
        database.close();
    }
}

async function verifyArtifactAgainstManifest(backupPath, manifest) {
    const artifact = await readFile(backupPath);
    if (sha256(artifact) !== manifest.databaseSha256) {
        throw new Error('backup database hash mismatch');
    }
    verifyDatabaseSnapshot(backupPath, manifest);
}

export async function verifySmartOrderRepositoryBackup({
    backupPath,
    manifestPath = `${backupPath}.manifest.json`,
}) {
    const resolvedBackupPath = assertAbsolutePath(backupPath, 'backupPath');
    const resolvedManifestPath = assertAbsolutePath(manifestPath, 'manifestPath');
    await assertPrivateDirectory(path.dirname(resolvedBackupPath), 'backup parent');
    if (path.dirname(resolvedManifestPath) !== path.dirname(resolvedBackupPath)) {
        throw new Error('backup manifest must be next to the backup artifact');
    }
    await assertPrivateFile(resolvedBackupPath, 'backup artifact');
    await assertPrivateFile(
        resolvedManifestPath,
        'backup manifest',
        MAX_MANIFEST_BYTES,
    );
    const manifest = parseManifest(
        await readFile(resolvedManifestPath, 'utf8'),
        resolvedBackupPath,
    );
    await verifyArtifactAgainstManifest(resolvedBackupPath, manifest);
    return manifest;
}

async function unlinkIfPresent(candidatePath) {
    try {
        await unlink(candidatePath);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

export async function restoreSmartOrderRepositoryBackup({
    backupPath,
    manifestPath = `${backupPath}.manifest.json`,
    destinationPath,
}) {
    const manifest = await verifySmartOrderRepositoryBackup({
        backupPath,
        manifestPath,
    });
    const resolvedBackupPath = assertAbsolutePath(backupPath, 'backupPath');
    const requestedDestinationPath = assertAbsolutePath(
        destinationPath,
        'destinationPath',
    );
    const destinationParent = await assertPrivateDirectory(
        path.dirname(requestedDestinationPath),
        'restore destination parent',
    );
    const resolvedDestinationPath = path.join(
        destinationParent,
        path.basename(requestedDestinationPath),
    );
    if (resolvedDestinationPath === (await realpath(resolvedBackupPath))) {
        throw new Error('restore destination must differ from the backup artifact');
    }
    try {
        await lstat(resolvedDestinationPath);
        throw new Error('restore destination already exists');
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }

    const pendingPath = path.join(
        destinationParent,
        `.${path.basename(resolvedDestinationPath)}.restore-${randomUUID()}`,
    );
    let destinationLinked = false;
    try {
        await copyFile(
            resolvedBackupPath,
            pendingPath,
            fsConstants.COPYFILE_EXCL,
        );
        await chmod(pendingPath, PRIVATE_FILE_MODE);
        const handle = await open(pendingPath, 'r');
        try {
            await handle.sync();
        } finally {
            await handle.close();
        }
        await verifyArtifactAgainstManifest(pendingPath, manifest);
        await link(pendingPath, resolvedDestinationPath);
        destinationLinked = true;
        const directoryHandle = await open(destinationParent, 'r');
        try {
            await directoryHandle.sync();
        } finally {
            await directoryHandle.close();
        }
        await unlink(pendingPath);
        return Object.freeze({
            restored: true,
            repositorySchemaId: manifest.repositorySchemaId,
            repositorySchemaVersion: manifest.repositorySchemaVersion,
            databaseSha256: manifest.databaseSha256,
            rowCounts: manifest.rowCounts,
            destinationPermissions: '0600',
            existingRepositoryReplaced: false,
        });
    } catch (error) {
        if (destinationLinked) await unlinkIfPresent(resolvedDestinationPath);
        await unlinkIfPresent(pendingPath);
        throw error;
    }
}
