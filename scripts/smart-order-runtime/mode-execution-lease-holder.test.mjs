import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    acquireExclusiveModeExecutionLease,
    smartOrderModeExecutionLeaseDirectoryForAppSupportRoot,
} from './mode-execution-lease.mjs';
import { holdSharedModeExecutionLease } from './mode-execution-lease-holder.mjs';

const temporaryDirectories = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) =>
            rm(directory, { recursive: true, force: true }),
        ),
    );
});

describe('mode execution lease holder', () => {
    it('holds a canonical shared lease until explicit close and blocks exclusive mode switch', async () => {
        const raw = await mkdtemp(path.join(tmpdir(), 'mode-shared-holder-'));
        temporaryDirectories.push(raw);
        const appSupportRoot = await realpath(raw);
        await chmod(appSupportRoot, 0o700);
        const holder = await holdSharedModeExecutionLease({
            appSupportRoot,
            ownerParentPid: process.pid,
        });
        expect(holder).toMatchObject({
            acquired: true,
            mode: 'shared',
            brokerAuthority: false,
        });
        const directoryPath =
            smartOrderModeExecutionLeaseDirectoryForAppSupportRoot(
                appSupportRoot,
            );
        const blocked = await acquireExclusiveModeExecutionLease({
            directoryPath,
            waitTimeoutMs: 25,
            pollIntervalMs: 5,
        });
        expect(blocked).toMatchObject({
            acquired: false,
            reason: 'shared_mode_execution_leases_active',
            brokerAuthority: false,
        });
        await holder.close();
        const exclusive = await acquireExclusiveModeExecutionLease({
            directoryPath,
            waitTimeoutMs: 25,
            pollIntervalMs: 5,
        });
        expect(exclusive).toMatchObject({
            acquired: true,
            mode: 'exclusive',
            brokerAuthority: false,
        });
        await exclusive.close();
    });
});
