import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';

export const SMART_ORDER_MANAGED_API_PROCESS_ATTESTOR_SCHEMA_VERSION =
    'smart-order-managed-api-process-attestor/2026-08-22.1';

const execFileAsync = promisify(execFileCallback);
const LAUNCHCTL_PATH = '/bin/launchctl';
const LSOF_PATH = '/usr/sbin/lsof';
const PS_PATH = '/bin/ps';
const SIMULATION_JOB_LABEL = 'com.alanyi.realtimestock.simulation-api';
const issuedAttestations = new WeakSet();

function boundedPid(value, label) {
    const pid = Number(value);
    if (!Number.isSafeInteger(pid) || pid < 2 || pid > 4_194_304) {
        throw new Error(`${label} is invalid`);
    }
    return pid;
}

function currentUserId() {
    if (typeof process.getuid !== 'function') {
        throw new Error('managed API attestation requires a numeric current user');
    }
    const uid = process.getuid();
    if (!Number.isSafeInteger(uid) || uid < 0 || uid > 2_147_483_647) {
        throw new Error('managed API attestation current user is invalid');
    }
    return uid;
}

function launchdPid(stdout) {
    const matches = [...String(stdout).matchAll(/^\s*pid\s*=\s*(\d+)\s*$/gm)];
    if (matches.length !== 1) {
        throw new Error('managed simulation launchd job PID is unavailable');
    }
    return boundedPid(matches[0][1], 'managed simulation launchd PID');
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertManagedJobDefinition(stdout, config) {
    const text = String(stdout);
    const expectedProgram = path.join(
        config.expectedAppSupportRoot,
        'bin',
        'realtimestock-runtime',
    );
    const programMatches = [
        ...text.matchAll(/^\s*program\s*=\s*(.+?)\s*$/gm),
    ];
    const workingDirectoryMatches = [
        ...text.matchAll(/^\s*working directory\s*=\s*(.+?)\s*$/gm),
    ];
    const explicitRootMatches = [
        ...text.matchAll(/^\s*REALTIME_STOCK_APP_SUPPORT\s*=>\s*(.+?)\s*$/gm),
    ];
    if (
        programMatches.length !== 1 ||
        programMatches[0][1] !== expectedProgram ||
        workingDirectoryMatches.length !== 1 ||
        workingDirectoryMatches[0][1] !== config.expectedRepositoryRoot ||
        explicitRootMatches.length > 1 ||
        (explicitRootMatches.length === 1 &&
            explicitRootMatches[0][1] !== config.expectedAppSupportRoot) ||
        !new RegExp(
            `^\\s*${escapeRegExp(expectedProgram)}\\s*$`,
            'm',
        ).test(text) ||
        !/^\s*service-api-simulation\s*$/m.test(text)
    ) {
        throw new Error('managed simulation launchd job definition is invalid');
    }
}

function listenerPid(stdout) {
    const lines = String(stdout)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const pids = new Set(
        lines
            .filter((line) => /^p\d+$/.test(line))
            .map((line) => boundedPid(line.slice(1), 'managed API listener PID')),
    );
    const names = lines.filter((line) => line.startsWith('n'));
    if (
        pids.size !== 1 ||
        names.length !== 1 ||
        names[0] !== 'n127.0.0.1:8080'
    ) {
        throw new Error('managed API listener ownership is unavailable');
    }
    return [...pids][0];
}

function assertSimulationProcessEnvironment(stdout) {
    const text = String(stdout);
    const simulationMatches = text.match(
        /(?:^|\s)SJ_PRODUCTION=false(?=\s|$)/g,
    );
    if (
        simulationMatches?.length !== 1 ||
        /(?:^|\s)SJ_PRODUCTION=(?!false(?:\s|$))[^\s]*/.test(text) ||
        /(?:^|\s)SJ_CA_(?:PATH|PASSWD)=/.test(text) ||
        /(?:^|\s)--production(?:\s|$)/.test(text)
    ) {
        throw new Error(
            'managed simulation process loaded production or CA configuration',
        );
    }
}

function processStartIdentitySha256(stdout, expectedPid) {
    const lines = String(stdout)
        .split('\n')
        .map((line) => line.trim().replace(/\s+/g, ' '))
        .filter(Boolean);
    if (lines.length !== 1) {
        throw new Error('managed simulation process start identity is unavailable');
    }
    const match = /^(\d+) (\d+) (.+)$/.exec(lines[0]);
    if (
        !match ||
        boundedPid(match[1], 'managed simulation process identity PID') !==
            expectedPid ||
        !Number.isSafeInteger(Number(match[2])) ||
        Number(match[2]) < 0 ||
        Number(match[2]) > 4_194_304 ||
        match[3].length < 20 ||
        match[3].length > 64
    ) {
        throw new Error('managed simulation process start identity is invalid');
    }
    return createHash('sha256').update(lines[0]).digest('hex');
}

async function defaultRun(file, args) {
    const result = await execFileAsync(file, args, {
        encoding: 'utf8',
        timeout: 2_000,
        maxBuffer: 64 * 1_024,
        windowsHide: true,
    });
    return Object.freeze({ stdout: result.stdout, stderr: result.stderr });
}

export function createSmartOrderManagedApiProcessAttestor(options = {}) {
    const expectedAppSupportRoot = options.expectedAppSupportRoot;
    const expectedRepositoryRoot = options.expectedRepositoryRoot;
    const verifyJobDefinition =
        typeof expectedAppSupportRoot === 'string' ||
        typeof expectedRepositoryRoot === 'string';
    if (
        verifyJobDefinition &&
        (!path.isAbsolute(expectedAppSupportRoot ?? '') ||
            !path.isAbsolute(expectedRepositoryRoot ?? ''))
    ) {
        throw new TypeError('managed API attestor paths must be absolute');
    }
    const config = Object.freeze({
        expectedAppSupportRoot: verifyJobDefinition
            ? path.resolve(expectedAppSupportRoot)
            : '',
        expectedRepositoryRoot: verifyJobDefinition
            ? path.resolve(expectedRepositoryRoot)
            : '',
        verifyJobDefinition,
    });
    return Object.freeze({
        schemaVersion: SMART_ORDER_MANAGED_API_PROCESS_ATTESTOR_SCHEMA_VERSION,
        brokerAuthority: false,
        async attest() {
            const uid = currentUserId();
            const launchd = await defaultRun(LAUNCHCTL_PATH, [
                'print',
                `gui/${uid}/${SIMULATION_JOB_LABEL}`,
            ]);
            if (config.verifyJobDefinition) {
                assertManagedJobDefinition(launchd?.stdout, config);
            }
            const expectedPid = launchdPid(launchd?.stdout);
            const lsof = await defaultRun(LSOF_PATH, [
                '-nP',
                '-a',
                '-p',
                String(expectedPid),
                '-iTCP@127.0.0.1:8080',
                '-sTCP:LISTEN',
                '-Fpn',
            ]);
            const observedPid = listenerPid(lsof?.stdout);
            if (observedPid !== expectedPid) {
                throw new Error('unmanaged API listener PID does not match launchd');
            }
            if (config.verifyJobDefinition) {
                const processProjection = await defaultRun(PS_PATH, [
                    'eww',
                    '-p',
                    String(expectedPid),
                    '-o',
                    'command=',
                ]);
                assertSimulationProcessEnvironment(processProjection?.stdout);
            }
            const processIdentityProjection = await defaultRun(PS_PATH, [
                '-p',
                String(expectedPid),
                '-o',
                'pid=',
                '-o',
                'ppid=',
                '-o',
                'lstart=',
            ]);
            const processStartIdentity = processStartIdentitySha256(
                processIdentityProjection?.stdout,
                expectedPid,
            );
            const evidence = Object.freeze({
                schemaVersion:
                    SMART_ORDER_MANAGED_API_PROCESS_ATTESTOR_SCHEMA_VERSION,
                processId: expectedPid,
                processStartIdentitySha256: processStartIdentity,
                managed: true,
                loopbackListener: true,
                simulationEnvironment: config.verifyJobDefinition,
                caCredentialsPresent: config.verifyJobDefinition ? false : null,
                productionModeLoaded: config.verifyJobDefinition ? false : null,
                brokerAuthority: false,
            });
            issuedAttestations.add(evidence);
            return evidence;
        },
    });
}

export function isIssuedSmartOrderManagedApiProcessAttestation(value) {
    return Boolean(
        value && typeof value === 'object' && issuedAttestations.has(value),
    );
}
