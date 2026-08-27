import { chmod, lstat, mkdtemp, rm, symlink } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireExclusiveRuntimeLease } from './exclusive-runtime-lease.mjs';

const roots = [];
const leases = [];

afterEach(async () => {
    await Promise.all(
        leases.splice(0).map((lease) =>
            lease.acquired ? lease.close().catch(() => {}) : Promise.resolve(),
        ),
    );
    await Promise.all(
        roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
});

async function privateRoot() {
    const root = await mkdtemp(path.join(tmpdir(), 'smart-order-lease-'));
    roots.push(root);
    await chmod(root, 0o700);
    return root;
}

describe('exclusive smart-order Runtime OS lease', () => {
    it('allows one primary and makes the second process read-only', async () => {
        const root = await privateRoot();
        const socketPath = path.join(root, 'runtime.sock');
        const primary = await acquireExclusiveRuntimeLease({ socketPath });
        leases.push(primary);
        expect(primary).toMatchObject({ acquired: true });
        expect((await lstat(socketPath)).mode & 0o777).toBe(0o600);

        const secondary = await acquireExclusiveRuntimeLease({ socketPath });
        leases.push(secondary);
        expect(secondary).toMatchObject({
            acquired: false,
            mode: 'secondary_readonly',
            reason: 'active_runtime_lease',
        });
    });

    it('removes a stale socket and can reacquire after the primary closes', async () => {
        const root = await privateRoot();
        const socketPath = path.join(root, 'runtime.sock');
        const stale = net.createServer();
        await new Promise((resolve, reject) => {
            stale.once('error', reject);
            stale.listen(socketPath, resolve);
        });
        await new Promise((resolve, reject) =>
            stale.close((error) => (error ? reject(error) : resolve())),
        );
        const recovered = await acquireExclusiveRuntimeLease({ socketPath });
        leases.push(recovered);
        expect(recovered).toMatchObject({ acquired: true });
        await recovered.close();

        const next = await acquireExclusiveRuntimeLease({ socketPath });
        leases.push(next);
        expect(next).toMatchObject({ acquired: true });
    });

    it('rejects broad parent permissions and a symlink at the lease path', async () => {
        const root = await privateRoot();
        const socketPath = path.join(root, 'runtime.sock');
        await chmod(root, 0o755);
        await expect(
            acquireExclusiveRuntimeLease({ socketPath }),
        ).rejects.toThrow('permissions');
        await chmod(root, 0o700);
        await symlink(path.join(root, 'elsewhere'), socketPath);
        await expect(
            acquireExclusiveRuntimeLease({ socketPath }),
        ).rejects.toThrow('private Unix socket');
    });
});
