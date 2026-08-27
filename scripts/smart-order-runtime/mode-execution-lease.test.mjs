import { spawn } from 'node:child_process';
import {
    chmod,
    lstat,
    mkdir,
    mkdtemp,
    rm,
    symlink,
    writeFile,
} from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
    acquireExclusiveModeExecutionLease,
    acquireSharedModeExecutionLease,
    prepareSmartOrderModeExecutionLeaseDirectoryForAppSupportRoot,
    smartOrderModeExecutionLeaseDirectoryForAppSupportRoot,
} from './mode-execution-lease.mjs';
import { holdExclusiveModeExecutionLease } from './mode-execution-lease-holder.mjs';

const roots = [];
const leases = [];
const holderEntryPath = fileURLToPath(
    new URL('./mode-execution-lease-holder.mjs', import.meta.url),
);

afterEach(async () => {
    await Promise.all(
        leases.splice(0).map((lease) =>
            lease?.acquired ? lease.close().catch(() => {}) : Promise.resolve(),
        ),
    );
    await Promise.all(
        roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
});

async function privateRoot() {
    const socketTempRoot = process.platform === 'darwin' ? '/private/tmp' : tmpdir();
    const root = await mkdtemp(path.join(socketTempRoot, 'smo-mode-'));
    roots.push(root);
    await chmod(root, 0o700);
    return root;
}

describe('cross-process smart-order mode execution lease', () => {
    it('prepares only a current-user private canonical runtime lease root', async () => {
        const appSupportRoot = await privateRoot();
        const directoryPath =
            await prepareSmartOrderModeExecutionLeaseDirectoryForAppSupportRoot(
                appSupportRoot,
            );
        const runtimeLeaseRoot = path.dirname(directoryPath);
        roots.push(runtimeLeaseRoot);
        expect((await lstat(runtimeLeaseRoot)).mode & 0o777).toBe(0o700);

        const secondAppSupportRoot = await privateRoot();
        const unsafeDirectoryPath =
            smartOrderModeExecutionLeaseDirectoryForAppSupportRoot(
                secondAppSupportRoot,
            );
        const unsafeRuntimeRoot = path.dirname(unsafeDirectoryPath);
        roots.push(unsafeRuntimeRoot);
        await mkdir(unsafeRuntimeRoot, { mode: 0o700 });
        await chmod(unsafeRuntimeRoot, 0o755);
        await expect(
            prepareSmartOrderModeExecutionLeaseDirectoryForAppSupportRoot(
                secondAppSupportRoot,
            ),
        ).rejects.toThrow('runtime lease root must be current-user private');
    });

    it('lets the production holder block new shared dispatches on the canonical lease path', async () => {
        const appSupportRoot = await privateRoot();
        const directoryPath =
            smartOrderModeExecutionLeaseDirectoryForAppSupportRoot(
                appSupportRoot,
            );
        roots.push(path.dirname(directoryPath));
        const holder = await holdExclusiveModeExecutionLease({
            appSupportRoot,
            ownerParentPid: process.pid,
            waitTimeoutMs: 100,
        });
        leases.push(holder);
        expect(holder).toMatchObject({
            acquired: true,
            mode: 'exclusive',
            brokerAuthority: false,
        });
        const denied = await acquireSharedModeExecutionLease({ directoryPath });
        expect(denied).toMatchObject({
            acquired: false,
            reason: 'exclusive_mode_transition_active',
            brokerAuthority: false,
        });
        await holder.close();
        const shared = await acquireSharedModeExecutionLease({ directoryPath });
        leases.push(shared);
        expect(shared).toMatchObject({ acquired: true, mode: 'shared' });
    });

    it('rejects an app-support symlink before deriving or binding the production lease', async () => {
        const target = await privateRoot();
        const aliasParent = await privateRoot();
        const alias = path.join(aliasParent, 'app-support-alias');
        await symlink(target, alias);
        await expect(
            holdExclusiveModeExecutionLease({
                appSupportRoot: alias,
                ownerParentPid: process.pid,
                waitTimeoutMs: 10,
            }),
        ).rejects.toThrow('canonical current-user private root');
    });

    it('allows shared holders and makes exclusive wait until every holder closes', async () => {
        const root = await privateRoot();
        const directoryPath = path.join(root, 'mode-execution');
        const first = await acquireSharedModeExecutionLease({ directoryPath });
        const second = await acquireSharedModeExecutionLease({ directoryPath });
        leases.push(first, second);
        expect(first).toMatchObject({ acquired: true, mode: 'shared' });
        expect(second).toMatchObject({ acquired: true, mode: 'shared' });

        const exclusivePromise = acquireExclusiveModeExecutionLease({
            directoryPath,
            waitTimeoutMs: 1_000,
            pollIntervalMs: 5,
        });
        await new Promise((resolve) => setTimeout(resolve, 25));
        const racedShared = await acquireSharedModeExecutionLease({ directoryPath });
        expect(racedShared).toMatchObject({
            acquired: false,
            reason: 'exclusive_mode_transition_active',
        });
        await first.close();
        await second.close();
        const exclusive = await exclusivePromise;
        leases.push(exclusive);
        expect(exclusive).toMatchObject({ acquired: true, mode: 'exclusive' });
        expect((await lstat(path.join(directoryPath, 'exclusive.sock'))).mode & 0o777).toBe(0o600);
    });

    it('fails exclusive closed on bounded timeout without withdrawing shared work', async () => {
        const root = await privateRoot();
        const directoryPath = path.join(root, 'mode-execution');
        const shared = await acquireSharedModeExecutionLease({ directoryPath });
        leases.push(shared);
        const exclusive = await acquireExclusiveModeExecutionLease({
            directoryPath,
            waitTimeoutMs: 20,
            pollIntervalMs: 2,
        });
        expect(exclusive).toMatchObject({
            acquired: false,
            reason: 'shared_mode_execution_leases_active',
            activeSharedLeaseCount: 1,
            brokerAuthority: false,
        });
        expect(shared).toMatchObject({ acquired: true, brokerAuthority: false });
        await shared.close();
        const replacementShared = await acquireSharedModeExecutionLease({
            directoryPath,
        });
        leases.push(replacementShared);
        expect(replacementShared).toMatchObject({
            acquired: true,
            mode: 'shared',
        });
    });

    it('recovers crashed shared and exclusive sockets but never unlinks a live owner', async () => {
        const root = await privateRoot();
        const directoryPath = path.join(root, 'mode-execution');
        const shared = await acquireSharedModeExecutionLease({ directoryPath });
        leases.push(shared);
        await shared.close();
        const staleShared = net.createServer();
        const staleSharedPath = path.join(directoryPath, 'shared-stale.sock');
        await new Promise((resolve, reject) => {
            staleShared.once('error', reject);
            staleShared.listen(staleSharedPath, resolve);
        });
        await new Promise((resolve, reject) =>
            staleShared.close((error) => (error ? reject(error) : resolve())),
        );
        const exclusive = await acquireExclusiveModeExecutionLease({
            directoryPath,
            waitTimeoutMs: 100,
        });
        leases.push(exclusive);
        expect(exclusive).toMatchObject({ acquired: true });
        const secondExclusive = await acquireExclusiveModeExecutionLease({
            directoryPath,
            waitTimeoutMs: 0,
        });
        expect(secondExclusive).toMatchObject({
            acquired: false,
            reason: 'exclusive_mode_transition_active',
        });
    });

    it.each(['SIGKILL', 'SIGTERM'])(
        'keeps shared dispatch fail-closed after the production holder exits via %s without completion proof',
        async (signal) => {
            const appSupportRoot = await privateRoot();
            const directoryPath =
                smartOrderModeExecutionLeaseDirectoryForAppSupportRoot(
                    appSupportRoot,
                );
            roots.push(path.dirname(directoryPath));
            const completionFile = path.join(
                appSupportRoot,
                'mode-switch-completion',
            );
            await writeFile(completionFile, '', { mode: 0o600 });
            const child = spawn(
                process.execPath,
                [
                    holderEntryPath,
                    appSupportRoot,
                    String(process.pid),
                    completionFile,
                ],
                { stdio: ['ignore', 'pipe', 'pipe'] },
            );
            const ready = await new Promise((resolve, reject) => {
                let output = '';
                child.stdout.setEncoding('utf8');
                child.stdout.on('data', (chunk) => {
                    output += chunk;
                    const newline = output.indexOf('\n');
                    if (newline < 0) return;
                    try {
                        resolve(JSON.parse(output.slice(0, newline)));
                    } catch (error) {
                        reject(error);
                    }
                });
                child.once('error', reject);
                child.once('exit', (code, exitSignal) => {
                    reject(
                        new Error(
                            `mode holder exited before ready: ${code ?? exitSignal}`,
                        ),
                    );
                });
            });
            expect(ready).toMatchObject({ acquired: true, mode: 'exclusive' });
            child.kill(signal);
            await new Promise((resolve) => child.once('exit', resolve));

            await expect(
                acquireSharedModeExecutionLease({ directoryPath }),
            ).resolves.toMatchObject({
                acquired: false,
                reason: 'exclusive_mode_transition_active',
                brokerAuthority: false,
            });
            await expect(
                acquireExclusiveModeExecutionLease({
                    directoryPath,
                    waitTimeoutMs: 0,
                }),
            ).resolves.toMatchObject({
                acquired: false,
                reason: 'exclusive_mode_transition_active',
                brokerAuthority: false,
            });
        },
    );

    it('rejects broad parents, symlink directories, and unexpected holder entries', async () => {
        const root = await privateRoot();
        const directoryPath = path.join(root, 'mode-execution');
        await chmod(root, 0o755);
        await expect(
            acquireSharedModeExecutionLease({ directoryPath }),
        ).rejects.toThrow('private directory');
        await chmod(root, 0o700);
        const target = path.join(root, 'target');
        await mkdirPrivate(target);
        await symlink(target, directoryPath);
        await expect(
            acquireSharedModeExecutionLease({ directoryPath }),
        ).rejects.toThrow('current-user private');
    });
});

async function mkdirPrivate(directoryPath) {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(directoryPath, { mode: 0o700 });
}
