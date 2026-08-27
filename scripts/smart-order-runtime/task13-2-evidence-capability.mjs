import { randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { readPrivateSecret } from './private-storage.mjs';

export const SMART_ORDER_TASK_13_2_EVIDENCE_CAPABILITY_FILE =
    'task13-2-evidence-hmac-key.bin';

export async function readOrCreateSmartOrderTask13_2EvidenceCapability(
    privateDirectory,
) {
    if (
        typeof privateDirectory !== 'string' ||
        !path.isAbsolute(privateDirectory) ||
        (await realpath(privateDirectory)) !== privateDirectory
    ) {
        throw new TypeError('Task 13.2 evidence capability directory is invalid');
    }
    const directoryMetadata = await lstat(privateDirectory);
    if (
        !directoryMetadata.isDirectory() ||
        directoryMetadata.isSymbolicLink() ||
        directoryMetadata.uid !== process.getuid() ||
        (directoryMetadata.mode & 0o777) !== 0o700
    ) {
        throw new Error('Task 13.2 evidence capability directory is not private');
    }
    const filePath = path.join(
        privateDirectory,
        SMART_ORDER_TASK_13_2_EVIDENCE_CAPABILITY_FILE,
    );
    let handle;
    let created = false;
    let fileSynced = false;
    try {
        handle = await open(
            filePath,
            fsConstants.O_WRONLY |
                fsConstants.O_CREAT |
                fsConstants.O_EXCL |
                fsConstants.O_NOFOLLOW,
            0o600,
        );
        created = true;
        const secret = randomBytes(32);
        try {
            await handle.writeFile(secret);
            await handle.sync();
            fileSynced = true;
        } finally {
            secret.fill(0);
        }
        await handle.close();
        handle = undefined;
        const directory = await open(
            privateDirectory,
            fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
        );
        try {
            await directory.sync();
        } finally {
            await directory.close();
        }
    } catch (error) {
        await handle?.close().catch(() => {});
        if (created && !fileSynced) await unlink(filePath).catch(() => {});
        if (error?.code !== 'EEXIST') throw error;
    }
    const metadata = await lstat(filePath);
    if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.uid !== process.getuid() ||
        (metadata.mode & 0o777) !== 0o600 ||
        metadata.size !== 32
    ) {
        throw new Error('Task 13.2 evidence capability is not a private key');
    }
    return readPrivateSecret(filePath);
}
