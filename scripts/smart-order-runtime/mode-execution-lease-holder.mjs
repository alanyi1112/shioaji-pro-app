import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    acquireExclusiveModeExecutionLease,
    acquireSharedModeExecutionLease,
    smartOrderModeExecutionLeaseDirectoryForAppSupportRoot,
} from './mode-execution-lease.mjs';

export const SMART_ORDER_MODE_EXECUTION_LEASE_HOLDER_SCHEMA_VERSION =
    'smart-order-mode-execution-lease-holder/2026-08-20.1';

function parentPid(value) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 2) {
        throw new TypeError('mode execution lease holder parent pid is invalid');
    }
    return parsed;
}

async function assertCanonicalPrivateRoot(rootPath) {
    const canonical = await realpath(rootPath);
    const metadata = await lstat(canonical);
    if (
        canonical !== rootPath ||
        metadata.isSymbolicLink() ||
        !metadata.isDirectory() ||
        (metadata.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
    ) {
        throw new Error(
            'mode execution lease holder requires a canonical current-user private root',
        );
    }
    return canonical;
}

async function ensurePrivateLeaseParent(directoryPath) {
    const parentPath = path.dirname(directoryPath);
    try {
        await mkdir(parentPath, { mode: 0o700 });
    } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
    }
    const metadata = await lstat(parentPath);
    if (
        metadata.isSymbolicLink() ||
        !metadata.isDirectory() ||
        (metadata.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
    ) {
        throw new Error('mode execution lease holder parent is not private');
    }
}

function parentIsAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (error?.code === 'ESRCH') return false;
        throw error;
    }
}

async function openPrivateCompletionFile(filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
        throw new TypeError(
            'mode execution lease completion file must be absolute',
        );
    }
    const handle = await open(
        filePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    const metadata = await handle.stat();
    if (
        !metadata.isFile() ||
        metadata.size !== 0 ||
        (metadata.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
    ) {
        await handle.close();
        throw new Error(
            'mode execution lease completion file must be an empty current-user private file',
        );
    }
    return handle;
}

async function completionMatches(handle, expectedNonce) {
    const metadata = await handle.stat();
    if (
        !metadata.isFile() ||
        metadata.size < 1 ||
        metadata.size > 128 ||
        (metadata.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
    ) {
        return false;
    }
    return (await handle.readFile('utf8')) === `${expectedNonce}\n`;
}

export async function holdExclusiveModeExecutionLease({
    appSupportRoot,
    ownerParentPid,
    waitTimeoutMs = 30_000,
}) {
    if (
        typeof appSupportRoot !== 'string' ||
        appSupportRoot.length === 0 ||
        !appSupportRoot.startsWith('/')
    ) {
        throw new TypeError('mode execution lease holder app support root is invalid');
    }
    const canonicalRoot = await assertCanonicalPrivateRoot(appSupportRoot);
    const directoryPath =
        smartOrderModeExecutionLeaseDirectoryForAppSupportRoot(canonicalRoot);
    await ensurePrivateLeaseParent(directoryPath);
    const lease = await acquireExclusiveModeExecutionLease({
        directoryPath,
        waitTimeoutMs,
        pollIntervalMs: 10,
    });
    if (!lease.acquired) return lease;

    const pid = parentPid(ownerParentPid);
    let closePromise;
    return Object.freeze({
        schemaVersion: SMART_ORDER_MODE_EXECUTION_LEASE_HOLDER_SCHEMA_VERSION,
        acquired: true,
        mode: 'exclusive',
        leaseId: lease.leaseId,
        ownerParentPid: pid,
        brokerAuthority: false,
        async close() {
            closePromise ??= lease.close();
            await closePromise;
        },
    });
}

export async function holdSharedModeExecutionLease({
    appSupportRoot,
    ownerParentPid,
}) {
    if (
        typeof appSupportRoot !== 'string' ||
        appSupportRoot.length === 0 ||
        !appSupportRoot.startsWith('/')
    ) {
        throw new TypeError('mode execution lease holder app support root is invalid');
    }
    const canonicalRoot = await assertCanonicalPrivateRoot(appSupportRoot);
    const directoryPath =
        smartOrderModeExecutionLeaseDirectoryForAppSupportRoot(canonicalRoot);
    await ensurePrivateLeaseParent(directoryPath);
    const lease = await acquireSharedModeExecutionLease({ directoryPath });
    if (!lease.acquired) return lease;

    const pid = parentPid(ownerParentPid);
    let closePromise;
    return Object.freeze({
        schemaVersion: SMART_ORDER_MODE_EXECUTION_LEASE_HOLDER_SCHEMA_VERSION,
        acquired: true,
        mode: 'shared',
        leaseId: lease.leaseId,
        ownerParentPid: pid,
        brokerAuthority: false,
        async close() {
            closePromise ??= lease.close();
            await closePromise;
        },
    });
}

async function main() {
    const [appSupportRoot, rawParentPid, completionFilePath, rawMode = 'exclusive'] =
        process.argv.slice(2);
    if (
        ![5, 6].includes(process.argv.length) ||
        !['exclusive', 'shared'].includes(rawMode)
    ) {
        throw new TypeError(
            'usage: mode-execution-lease-holder.mjs <app-support-root> <parent-pid> <completion-file> [exclusive|shared]',
        );
    }
    const completionHandle = await openPrivateCompletionFile(completionFilePath);
    const holder =
        rawMode === 'shared'
            ? await holdSharedModeExecutionLease({
                  appSupportRoot,
                  ownerParentPid: rawParentPid,
              })
            : await holdExclusiveModeExecutionLease({
                  appSupportRoot,
                  ownerParentPid: rawParentPid,
              });
    const completionNonce = randomUUID();
    process.stdout.write(
        `${JSON.stringify({
            schemaVersion: SMART_ORDER_MODE_EXECUTION_LEASE_HOLDER_SCHEMA_VERSION,
            acquired: holder.acquired === true,
            mode: rawMode,
            reason: holder.acquired ? null : holder.reason,
            completionNonce,
            brokerAuthority: false,
        })}\n`,
    );
    if (!holder.acquired) {
        process.exitCode = 75;
        return;
    }
    const completion = await new Promise((resolve) => {
        let finished = false;
        const parentWatch = setInterval(() => {
            if (!parentIsAlive(holder.ownerParentPid)) finish('parent_lost');
        }, 100);
        const finish = (reason) => {
            if (finished) return;
            finished = true;
            clearInterval(parentWatch);
            resolve(reason);
        };
        for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
            process.once(signal, () => finish('signal'));
        }
    });
    if (
        completion === 'signal' &&
        (await completionMatches(completionHandle, completionNonce))
    ) {
        await holder.close();
        await completionHandle.close();
        return;
    }
    // The Unix socket disappears on process exit.  For exclusive holders the
    // durable transition barrier intentionally remains; for shared holders the
    // lost socket is itself the fail-closed end of the bounded start attempt.
    await completionHandle.close();
    process.exitCode = 75;
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    main().catch((error) => {
        process.stderr.write(`${error?.message ?? 'mode execution lease holder failed'}\n`);
        process.exitCode = 1;
    });
}
