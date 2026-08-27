import { describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
    execFile: execFileMock,
}));
vi.mock('node:util', () => ({
    promisify: () => async (file, args, options) =>
        execFileMock(file, args, options),
}));

import {
    createSmartOrderManagedApiProcessAttestor,
    isIssuedSmartOrderManagedApiProcessAttestation,
} from './managed-api-process-attestor.mjs';

const PID = 12_345;
const PROCESS_IDENTITY = `${PID} 1 Fri Aug 22 08:30:00 2026`;
const APP_SUPPORT = '/Users/test/Library/Application Support/RealTimeStock';
const REPOSITORY = '/Users/test/Documents/RealTimeStock';

function resultFor({ launchdPid = PID, listenerPid = PID, listenerName = '127.0.0.1:8080' } = {}) {
    execFileMock.mockImplementation(async (file, args) =>
        file === '/bin/launchctl'
            ? { stdout: `state = running\n\tpid = ${launchdPid}\n` }
            : file === '/usr/sbin/lsof'
              ? { stdout: `p${listenerPid}\nn${listenerName}\n` }
              : args.includes('lstart=')
                ? { stdout: `${PROCESS_IDENTITY}\n` }
                : { stdout: '' },
    );
}

describe('managed simulation API process attestor', () => {
    it('binds the fixed launchd job PID to the exact IPv4 loopback listener', async () => {
        resultFor();
        const evidence = await createSmartOrderManagedApiProcessAttestor().attest();
        expect(evidence).toMatchObject({
            processId: PID,
            processStartIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            managed: true,
            loopbackListener: true,
            brokerAuthority: false,
        });
        expect(isIssuedSmartOrderManagedApiProcessAttestation(evidence)).toBe(true);
        expect(execFileMock).toHaveBeenNthCalledWith(
            2,
            '/usr/sbin/lsof',
            expect.arrayContaining(['-p', String(PID), '-iTCP@127.0.0.1:8080']),
            expect.objectContaining({ timeout: 2_000 }),
        );
    });

    it('binds the launchd program, simulation service argument, working tree, and private root', async () => {
        const program = `${APP_SUPPORT}/bin/realtimestock-runtime`;
        execFileMock.mockImplementation(async (file, args) =>
            file === '/bin/launchctl'
                ? {
                      stdout:
                          `state = running\nprogram = ${program}\narguments = {\n` +
                          `\t${program}\n\tservice-api-simulation\n}\n` +
                          `working directory = ${REPOSITORY}\n` +
                          `environment = {\n\tREALTIME_STOCK_APP_SUPPORT => ${APP_SUPPORT}\n}\n` +
                          `pid = ${PID}\n`,
                  }
                : file === '/usr/sbin/lsof'
                  ? { stdout: `p${PID}\nn127.0.0.1:8080\n` }
                  : args.includes('lstart=')
                    ? { stdout: `${PROCESS_IDENTITY}\n` }
                  : {
                        stdout:
                            '/usr/local/bin/shioaji server start --no-open SJ_PRODUCTION=false',
                    },
        );
        const attestor = createSmartOrderManagedApiProcessAttestor({
            expectedAppSupportRoot: APP_SUPPORT,
            expectedRepositoryRoot: REPOSITORY,
        });
        await expect(attestor.attest()).resolves.toMatchObject({
            processId: PID,
            managed: true,
            simulationEnvironment: true,
            caCredentialsPresent: false,
            productionModeLoaded: false,
        });

        execFileMock.mockResolvedValueOnce({
            stdout:
                `program = ${program}\narguments = {\n\t${program}\n\tservice-api-production-readonly\n}\n` +
                `working directory = ${REPOSITORY}\npid = ${PID}\n`,
        });
        await expect(attestor.attest()).rejects.toThrow(
            'launchd job definition is invalid',
        );
    });

    it.each([
        ['production flag', 'shioaji server start --production SJ_PRODUCTION=false'],
        ['production environment', 'shioaji server start SJ_PRODUCTION=true'],
        ['CA path', 'shioaji server start SJ_PRODUCTION=false SJ_CA_PATH=/private/ca'],
        ['CA password', 'shioaji server start SJ_PRODUCTION=false SJ_CA_PASSWD=secret'],
    ])('rejects %s without projecting the process environment', async (_label, command) => {
        const program = `${APP_SUPPORT}/bin/realtimestock-runtime`;
        execFileMock.mockImplementation(async (file, args) =>
            file === '/bin/launchctl'
                ? {
                      stdout:
                          `program = ${program}\narguments = {\n\t${program}\n\tservice-api-simulation\n}\n` +
                          `working directory = ${REPOSITORY}\npid = ${PID}\n`,
                  }
                : file === '/usr/sbin/lsof'
                  ? { stdout: `p${PID}\nn127.0.0.1:8080\n` }
                  : args.includes('lstart=')
                    ? { stdout: `${PROCESS_IDENTITY}\n` }
                  : { stdout: command },
        );
        await expect(
            createSmartOrderManagedApiProcessAttestor({
                expectedAppSupportRoot: APP_SUPPORT,
                expectedRepositoryRoot: REPOSITORY,
            }).attest(),
        ).rejects.toThrow('production or CA configuration');
    });

    it.each([
        ['PID mismatch', { listenerPid: PID + 1 }],
        ['non-loopback listener', { listenerName: '*:8080' }],
    ])('rejects %s', async (_label, options) => {
        resultFor(options);
        await expect(
            createSmartOrderManagedApiProcessAttestor().attest(),
        ).rejects.toThrow();
    });

    it('rejects missing, duplicate, or malformed launchd PID projections', async () => {
        for (const stdout of [
            'state = running\n',
            'pid = 123\npid = 124\n',
            'pid = -1\n',
        ]) {
            execFileMock.mockResolvedValue({ stdout });
            await expect(
                createSmartOrderManagedApiProcessAttestor().attest(),
            ).rejects.toThrow();
        }
    });

    it('rejects structural clones as process authority', async () => {
        resultFor();
        const evidence = await createSmartOrderManagedApiProcessAttestor().attest();
        expect(
            isIssuedSmartOrderManagedApiProcessAttestation({ ...evidence }),
        ).toBe(false);
    });

    it('rejects a missing or mismatched process start identity', async () => {
        resultFor();
        execFileMock.mockImplementationOnce(async () => ({
            stdout: `state = running\n\tpid = ${PID}\n`,
        }));
        execFileMock.mockImplementationOnce(async () => ({
            stdout: `p${PID}\nn127.0.0.1:8080\n`,
        }));
        execFileMock.mockImplementationOnce(async () => ({
            stdout: `${PID + 1} 1 Fri Aug 22 08:30:00 2026\n`,
        }));
        await expect(
            createSmartOrderManagedApiProcessAttestor().attest(),
        ).rejects.toThrow('process start identity is invalid');
    });
});
