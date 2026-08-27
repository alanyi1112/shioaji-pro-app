import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: execFileMock }));
vi.mock('node:util', () => ({
    promisify: () => async (file, args, options) =>
        execFileMock(file, args, options),
}));
import {
    createSmartOrderModeWriteAdmission,
    isIssuedSmartOrderModeWriteLease,
} from './mode-write-admission.mjs';
import { acquireExclusiveModeExecutionLease } from './mode-execution-lease.mjs';
import { createSmartOrderResourceCoordinator } from './resource-coordinator.mjs';

const roots = [];
const leases = [];
const resourceCoordinators = [];
const GENERATION = 'simulation:generation-1';
const processIdentity = (pid, startedAt = 'Fri Aug 22 08:30:00 2026') =>
    `${pid} 1 ${startedAt}\n`;

afterEach(async () => {
    for (const coordinator of resourceCoordinators.splice(0)) {
        coordinator.close();
    }
    await Promise.all(
        leases.splice(0).map((lease) => lease.close().catch(() => {})),
    );
    await Promise.all(
        roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
});

function resourceCoordinator() {
    const coordinator = createSmartOrderResourceCoordinator();
    resourceCoordinators.push(coordinator);
    return coordinator;
}

async function fixture() {
    const socketTempRoot = process.platform === 'darwin' ? '/private/tmp' : tmpdir();
    const root = await mkdtemp(path.join(socketTempRoot, 'smo-admit-'));
    roots.push(root);
    await chmod(root, 0o700);
    await writeFile(path.join(root, 'runtime-mode'), 'simulation\n', { mode: 0o600 });
    await writeFile(path.join(root, 'runtime-api-generation'), `${GENERATION}\n`, { mode: 0o600 });
    return {
        root,
        leaseDirectory: path.join(root, 'leases'),
    };
}

function response({ simulation = true, status = 200 } = {}) {
    return {
        status,
        headers: {
            get(name) {
                if (name === 'content-type') return 'application/json';
                return null;
            },
        },
        async json() {
            return { simulation };
        },
    };
}

function processAttestor({
    firstPid = 12_345,
    secondPid = firstPid,
    attestations,
} = {}) {
    const sequence = attestations ?? [
        { pid: firstPid, startedAt: 'Fri Aug 22 08:30:00 2026' },
        { pid: secondPid, startedAt: 'Fri Aug 22 08:30:00 2026' },
    ];
    let attestationCall = 0;
    let current = sequence[0];
    execFileMock.mockImplementation(async (file, args) => {
        if (file === '/bin/launchctl') {
            current = sequence[Math.min(attestationCall, sequence.length - 1)];
            attestationCall += 1;
            return { stdout: `pid = ${current.pid}\n` };
        }
        if (file === '/usr/sbin/lsof') {
            return { stdout: `p${current.pid}\nn127.0.0.1:8080\n` };
        }
        return args.includes('lstart=')
            ? { stdout: processIdentity(current.pid, current.startedAt) }
            : { stdout: '' };
    });
}

describe('write-adjacent simulation admission', () => {
    it('holds a shared lease across current marker and managed /info revalidation', async () => {
        const current = await fixture();
        const fetchImpl = vi.fn(async () => response());
        vi.stubGlobal('fetch', fetchImpl);
        processAttestor();
        const admission = createSmartOrderModeWriteAdmission({
            appSupportRoot: current.root,
            leaseDirectory: current.leaseDirectory,
            expectedApiGeneration: GENERATION,
            resourceCoordinator: resourceCoordinator(),
        });
        const lease = await admission.acquire();
        leases.push(lease);
        expect(isIssuedSmartOrderModeWriteLease(lease)).toBe(true);
        await expect(lease.revalidate()).resolves.toMatchObject({
            current: true,
            simulation: true,
            brokerAuthority: false,
        });
        expect(lease.initialSimulationAttestationSha256).toMatch(
            /^sha256:[0-9a-f]{64}$/,
        );
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        const exclusive = await acquireExclusiveModeExecutionLease({
            directoryPath: current.leaseDirectory,
            waitTimeoutMs: 10,
            pollIntervalMs: 1,
        });
        expect(exclusive).toMatchObject({
            acquired: false,
            reason: 'shared_mode_execution_leases_active',
        });
    });

    it('revalidates without self-deadlock inside the already granted write operation', async () => {
        const current = await fixture();
        vi.stubGlobal('fetch', async () => response());
        processAttestor();
        const coordinator = createSmartOrderResourceCoordinator();
        resourceCoordinators.push(coordinator);
        const admission = createSmartOrderModeWriteAdmission({
            appSupportRoot: current.root,
            leaseDirectory: current.leaseDirectory,
            expectedApiGeneration: GENERATION,
            resourceCoordinator: coordinator,
        });
        const lease = await admission.acquire();
        leases.push(lease);
        const operationId = 'task-0-3-write-adjacent-revalidation';
        await coordinator.acquireOperation({
            operationId,
            kind: 'new_exposure',
        });
        await coordinator.acquireOperationUnit({ operationId });
        await expect(lease.revalidate({ operationId })).resolves.toMatchObject({
            current: true,
            simulation: true,
            brokerAuthority: false,
        });
        expect(coordinator.abandonOperation({ operationId })).toMatchObject({
            allowed: true,
        });
    });

    it('binds the managed simulation job and proves production and CA are unloaded', async () => {
        const current = await fixture();
        vi.stubGlobal('fetch', async () => response());
        const program = `${current.root}/bin/realtimestock-runtime`;
        execFileMock.mockImplementation(async (file, args) =>
            file === '/bin/launchctl'
                ? {
                      stdout:
                          `program = ${program}\narguments = {\n\t${program}\n\tservice-api-simulation\n}\n` +
                          `working directory = /private/repository\npid = 12345\n`,
                  }
                : file === '/usr/sbin/lsof'
                  ? { stdout: 'p12345\nn127.0.0.1:8080\n' }
                  : args.includes('lstart=')
                    ? { stdout: processIdentity(12_345) }
                  : {
                        stdout:
                            'shioaji server start --no-open SJ_PRODUCTION=false',
                    },
        );
        const admission = createSmartOrderModeWriteAdmission({
            appSupportRoot: current.root,
            leaseDirectory: current.leaseDirectory,
            expectedApiGeneration: GENERATION,
            expectedRepositoryRoot: '/private/repository',
            resourceCoordinator: resourceCoordinator(),
        });
        const lease = await admission.acquire();
        leases.push(lease);
        await expect(lease.revalidate()).resolves.toMatchObject({
            current: true,
            simulation: true,
            caLoaded: false,
            productionLoaded: false,
            brokerAuthority: false,
        });
    });

    it.each([
        ['non-simulation', response({ simulation: false })],
        ['unavailable', response({ status: 503 })],
    ])('fails closed for %s and releases its pre-dispatch lease', async (_label, result) => {
        const current = await fixture();
        vi.stubGlobal('fetch', async () => result);
        processAttestor();
        const admission = createSmartOrderModeWriteAdmission({
            appSupportRoot: current.root,
            leaseDirectory: current.leaseDirectory,
            expectedApiGeneration: GENERATION,
            resourceCoordinator: resourceCoordinator(),
        });
        await expect(admission.acquire()).rejects.toThrow();
        const exclusive = await acquireExclusiveModeExecutionLease({
            directoryPath: current.leaseDirectory,
            waitTimeoutMs: 20,
        });
        leases.push(exclusive);
        expect(exclusive).toMatchObject({ acquired: true });
    });

    it('detects marker TOCTOU between managed info and the second private read', async () => {
        const current = await fixture();
        vi.stubGlobal('fetch', async () => {
            await writeFile(
                path.join(current.root, 'runtime-api-generation'),
                'simulation:generation-2\n',
                { mode: 0o600 },
            );
            return response();
        });
        processAttestor();
        const admission = createSmartOrderModeWriteAdmission({
            appSupportRoot: current.root,
            leaseDirectory: current.leaseDirectory,
            expectedApiGeneration: GENERATION,
            resourceCoordinator: resourceCoordinator(),
        });
        await expect(admission.acquire()).rejects.toThrow(
            'changed during write admission',
        );
    });

    it('fails closed if the managed listener process changes around /info', async () => {
        const current = await fixture();
        vi.stubGlobal('fetch', async () => response());
        processAttestor({ secondPid: 12_346 });
        const admission = createSmartOrderModeWriteAdmission({
            appSupportRoot: current.root,
            leaseDirectory: current.leaseDirectory,
            expectedApiGeneration: GENERATION,
            resourceCoordinator: resourceCoordinator(),
        });
        await expect(admission.acquire()).rejects.toThrow(
            'changed during write admission',
        );
    });

    it.each([
        [
            'new PID',
            { pid: 12_346, startedAt: 'Fri Aug 22 08:31:00 2026' },
        ],
        [
            'same PID with a different process start',
            { pid: 12_345, startedAt: 'Fri Aug 22 08:31:00 2026' },
        ],
    ])('fails closed if %s replaces the API while the shared lease is held', async (
        _label,
        replacement,
    ) => {
        const current = await fixture();
        const fetchImpl = vi.fn(async () => response());
        vi.stubGlobal('fetch', fetchImpl);
        const original = {
            pid: 12_345,
            startedAt: 'Fri Aug 22 08:30:00 2026',
        };
        processAttestor({
            attestations: [original, original, replacement, replacement],
        });
        const admission = createSmartOrderModeWriteAdmission({
            appSupportRoot: current.root,
            leaseDirectory: current.leaseDirectory,
            expectedApiGeneration: GENERATION,
            resourceCoordinator: resourceCoordinator(),
        });
        const lease = await admission.acquire();
        leases.push(lease);
        await expect(lease.revalidate()).rejects.toThrow(
            'changed while mode lease was held',
        );
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('rejects non-loopback, credentialed, query, and wrong-path endpoints', async () => {
        const current = await fixture();
        vi.stubGlobal('fetch', async () => response());
        processAttestor();
        for (const infoUrl of [
            'http://localhost:8080/api/v1/info',
            'http://user@127.0.0.1:8080/api/v1/info',
            'http://127.0.0.1:8080/api/v1/info?x=1',
            'http://127.0.0.1:8080/api/v1/health',
        ]) {
            expect(() =>
                createSmartOrderModeWriteAdmission({
                    appSupportRoot: current.root,
                    leaseDirectory: current.leaseDirectory,
                    expectedApiGeneration: GENERATION,
                    resourceCoordinator: resourceCoordinator(),
                    infoUrl,
                }),
            ).toThrow('keys are invalid');
        }
    });

    it('rejects accessor, Proxy, extra-key, and clone attempts without issuing authority', async () => {
        const current = await fixture();
        const accessor = {
            leaseDirectory: current.leaseDirectory,
            expectedApiGeneration: GENERATION,
            resourceCoordinator: resourceCoordinator(),
        };
        Object.defineProperty(accessor, 'appSupportRoot', {
            enumerable: true,
            get() {
                throw new Error('must not execute');
            },
        });
        expect(() => createSmartOrderModeWriteAdmission(accessor)).toThrow(
            'own data property',
        );
        expect(() =>
            createSmartOrderModeWriteAdmission({
                appSupportRoot: current.root,
                leaseDirectory: current.leaseDirectory,
                expectedApiGeneration: GENERATION,
                resourceCoordinator: resourceCoordinator(),
                fetchImpl: async () => response(),
            }),
        ).toThrow('keys are invalid');
        expect(() =>
            createSmartOrderModeWriteAdmission(
                new Proxy(
                    {
                        appSupportRoot: current.root,
                        leaseDirectory: current.leaseDirectory,
                        expectedApiGeneration: GENERATION,
                        resourceCoordinator: resourceCoordinator(),
                    },
                    {
                        ownKeys() {
                            throw new Error('proxy trap');
                        },
                    },
                ),
            ),
        ).toThrow('could not be inspected safely');
    });

    it('rejects broad or symlinked marker roots before any shared lease is held', async () => {
        const current = await fixture();
        const admission = createSmartOrderModeWriteAdmission({
            appSupportRoot: current.root,
            leaseDirectory: current.leaseDirectory,
            expectedApiGeneration: GENERATION,
            resourceCoordinator: resourceCoordinator(),
        });
        await chmod(current.root, 0o755);
        await expect(admission.acquire()).rejects.toThrow('private directory');
        await chmod(current.root, 0o700);
        const alias = `${current.root}-alias`;
        roots.push(alias);
        await symlink(current.root, alias);
        const aliased = createSmartOrderModeWriteAdmission({
            appSupportRoot: alias,
            leaseDirectory: current.leaseDirectory,
            expectedApiGeneration: GENERATION,
            resourceCoordinator: resourceCoordinator(),
        });
        await expect(aliased.acquire()).rejects.toThrow('private directory');
    });
});
