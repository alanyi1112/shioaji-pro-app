#!/usr/bin/env node

import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
    chmod,
    lstat,
    mkdtemp,
    mkdir,
    open,
    realpath,
    rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson } from './smart-order-runtime/canonical-json.mjs';
import {
    SMART_ORDER_NODE_SQLITE_CAPABILITY_SCHEMA,
    SMART_ORDER_NODE_SQLITE_CAPABILITY_VERSION,
    SMART_ORDER_REQUIRED_NODE_SQLITE_CHECK_IDS,
} from './smart-order-runtime/gate-evidence-verifier.mjs';
import { currentSmartOrderNodeSqliteCapabilityFingerprints } from './smart-order-runtime/node-sqlite-capability-current-state.mjs';
import { signAndStoreNodeSqliteCapabilityReport } from './smart-order-runtime/node-sqlite-capability-host-attestation.mjs';
import { prepareSmartOrderPrivateStorage } from './smart-order-runtime/private-storage.mjs';
import {
    restoreSmartOrderRepositoryBackup,
    verifySmartOrderRepositoryBackup,
} from './smart-order-runtime/repository-backup.mjs';
import { SmartOrderRepositoryClient } from './smart-order-runtime/repository-client.mjs';
import {
    assertSupportedSmartOrderNodeRuntime,
    readSmartOrderSidecarStartupContract,
} from './smart-order-runtime/sidecar-entry.mjs';
import {
    SMART_ORDER_TRADING_RUNTIME_PLATFORM_POLICY,
    readSmartOrderTradingRuntimePlatformSupport,
} from './smart-order-runtime/trading-runtime-platform-support.mjs';

const execFile = promisify(execFileCallback);
const THIS_FILE = fileURLToPath(import.meta.url);

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function reportHash(report) {
    return sha256(canonicalJson({ ...report, resultHash: '' }));
}

const MODULE_LOAD_SOURCE_FINGERPRINTS =
    await currentSmartOrderNodeSqliteCapabilityFingerprints();

function supportedRuntime() {
    assertSupportedSmartOrderNodeRuntime();
    if (process.platform !== 'darwin') {
        throw new Error('capability probe requires a supported macOS host');
    }
    if (!/^\d+\.\d+\.\d+$/.test(process.versions.sqlite ?? '')) {
        throw new Error('node:sqlite runtime version is unavailable');
    }
}

function supportedMacosVersion(version) {
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(version ?? '');
    if (!match) return false;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    return major > 13 || (major === 13 && minor >= 3);
}

async function physicalArchitecture() {
    const [support, { stdout: macosVersionOutput }] = await Promise.all([
        readSmartOrderTradingRuntimePlatformSupport(),
        execFile('/usr/bin/sw_vers', ['-productVersion'], {
            encoding: 'utf8',
            timeout: 2_000,
        }),
    ]);
    const macosVersion = macosVersionOutput.trim();
    if (!supportedMacosVersion(macosVersion)) {
        throw new Error(
            'probe requires a supported Apple Silicon macOS version',
        );
    }
    return Object.freeze({
        operatingSystem: support.operatingSystem,
        macosVersion,
        hypervisorPresent: support.hypervisorPresent,
        processArch: support.processArch,
        hardwareArch: support.hardwareArch,
        nativeArchitecture: support.nativeArchitecture,
        unameMachine: support.unameMachine,
        sysctlOptionalArm64: support.sysctlOptionalArm64,
    });
}

function configureCapabilityDatabase(database) {
    database.exec('PRAGMA busy_timeout=2500');
    database.exec('PRAGMA foreign_keys=ON');
    database.exec('PRAGMA synchronous=FULL');
    database.exec('PRAGMA trusted_schema=OFF');
    const journalMode = database.prepare('PRAGMA journal_mode=WAL').get()?.journal_mode;
    if (journalMode !== 'wal') throw new Error('SQLite WAL mode was not enabled');
    database.enableDefensive(true);
}

async function rawSqliteCapability(databasePath) {
    const database = new DatabaseSync(databasePath, { defensive: true });
    try {
        configureCapabilityDatabase(database);
        database.exec(`
            CREATE TABLE capability_rows (
                id INTEGER PRIMARY KEY,
                value TEXT NOT NULL
            ) STRICT;
            INSERT INTO capability_rows(id, value) VALUES (1, 'durable');
        `);
        if (database.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'wal') {
            throw new Error('WAL readback failed');
        }
        if (database.prepare('PRAGMA synchronous').get()?.synchronous !== 2) {
            throw new Error('synchronous FULL readback failed');
        }
        database.exec('PRAGMA writable_schema=ON');
        if (database.prepare('PRAGMA writable_schema').get()?.writable_schema !== 0) {
            throw new Error('defensive mode did not reject writable_schema');
        }
    } finally {
        database.close();
    }
}

async function assertCrashChildTarget(databasePath, nonce) {
    if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            nonce ?? '',
        ) ||
        nonce !== process.env.REALTIME_STOCK_NODE_SQLITE_CRASH_NONCE ||
        !path.isAbsolute(databasePath) ||
        path.basename(databasePath) !== 'crash.sqlite3' ||
        !path.basename(path.dirname(databasePath)).startsWith(
            'realtimestock-node-sqlite-capability-',
        )
    ) {
        throw new Error('crash child target contract is invalid');
    }
    const parent = await lstat(path.dirname(databasePath));
    if (
        parent.isSymbolicLink() ||
        !parent.isDirectory() ||
        (parent.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && parent.uid !== process.getuid())
    ) {
        throw new Error('crash child parent is not a current-user private directory');
    }
    try {
        await lstat(databasePath);
        throw new Error('crash child database target already exists');
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

async function crashChild(databasePath, nonce) {
    await assertCrashChildTarget(databasePath, nonce);
    const database = new DatabaseSync(databasePath, { defensive: true });
    configureCapabilityDatabase(database);
    database.exec(`
        CREATE TABLE crash_rows (
            id INTEGER PRIMARY KEY,
            state TEXT NOT NULL
        ) STRICT;
        INSERT INTO crash_rows(id, state) VALUES (1, 'committed');
        BEGIN IMMEDIATE;
        INSERT INTO crash_rows(id, state) VALUES (2, 'uncommitted');
    `);
    process.stdout.write('ready\n');
    setInterval(() => {}, 60_000);
}

async function waitForCrashChildReady(child) {
    await new Promise((resolve, reject) => {
        let stdout = '';
        const timer = setTimeout(() => {
            reject(new Error('crash child readiness timed out'));
        }, 5_000);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
            if (stdout === 'ready\n') {
                clearTimeout(timer);
                resolve();
            } else if (stdout.length > 32 || !'ready\n'.startsWith(stdout)) {
                clearTimeout(timer);
                reject(new Error('crash child emitted an invalid readiness token'));
            }
        });
        child.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.once('exit', (code, signal) => {
            if (stdout !== 'ready\n') {
                clearTimeout(timer);
                reject(
                    new Error(
                        `crash child exited before readiness (${code ?? signal})`,
                    ),
                );
            }
        });
    });
}

async function verifyCrashDurability(databasePath) {
    const nonce = randomUUID();
    const child = spawn(
        process.execPath,
        [THIS_FILE, '--crash-child', databasePath, nonce],
        {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                LANG: 'C',
                LC_ALL: 'C',
                REALTIME_STOCK_NODE_SQLITE_CRASH_NONCE: nonce,
            },
        },
    );
    const exitPromise = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    try {
        await waitForCrashChildReady(child);
        if (!child.kill('SIGKILL')) {
            throw new Error('crash child could not be killed at the crash window');
        }
        const exit = await exitPromise;
        if (exit.signal !== 'SIGKILL') {
            throw new Error('crash child did not terminate at the requested window');
        }
    } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    const recovered = new DatabaseSync(databasePath, { readOnly: true });
    try {
        if (recovered.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') {
            throw new Error('crash recovery integrity failed');
        }
        const rows = recovered
            .prepare('SELECT id, state FROM crash_rows ORDER BY id')
            .all();
        if (
            rows.length !== 1 ||
            rows[0]?.id !== 1 ||
            rows[0]?.state !== 'committed'
        ) {
            throw new Error('crash recovery durable boundary is invalid');
        }
    } finally {
        recovered.close();
    }
}

async function repositoryWorkerCapability(appSupportRoot) {
    await mkdir(appSupportRoot, { mode: 0o700 });
    await chmod(appSupportRoot, 0o700);
    const storage = await prepareSmartOrderPrivateStorage({ appSupportRoot });
    const client = new SmartOrderRepositoryClient({
        databasePath: storage.paths.databasePath,
        backupDirectory: storage.paths.backupDirectory,
        repositoryExpectationPath: storage.paths.repositoryExpectationPath,
        installationIdPath: storage.paths.installationIdPath,
        identityKeyPath: storage.paths.identityKeyPath,
        workerLatencyLimitMs: 0.000_001,
        queueAgeLimitMs: 60_000,
    });
    try {
        await client.ready();
        const backupName = 'node-sqlite-capability.sqlite3';
        let backupSettled = false;
        const backupPromise = client
            .request('createRepositoryBackup', {
                backupName,
                createdAtEpochMs: Date.now(),
            })
            .finally(() => {
                backupSettled = true;
            });
        let mainEventLoopTurn = false;
        await new Promise((resolve) =>
            setImmediate(() => {
                mainEventLoopTurn = true;
                resolve();
            }),
        );
        const backupSettledBeforeEventLoopTurn = backupSettled;
        const backupResult = await backupPromise;
        if (
            !mainEventLoopTurn ||
            backupSettledBeforeEventLoopTurn === true ||
            backupResult?.backupName !== backupName
        ) {
            throw new Error('repository worker did not isolate the main event loop');
        }
        if (
            client.watchdogStatus().repositoryReady !== false ||
            client.watchdogStatus().blocker !== 'worker_latency_exceeded'
        ) {
            throw new Error('repository latency watchdog did not fail closed');
        }
        let watchdogBlocked = false;
        try {
            await client.request('markRuntimeEpochReady', {});
        } catch (error) {
            watchdogBlocked = /watchdog blocks/.test(String(error?.message));
        }
        if (!watchdogBlocked) {
            throw new Error('latency watchdog did not block readiness mutation');
        }

        const backupPath = path.join(storage.paths.backupDirectory, backupName);
        await verifySmartOrderRepositoryBackup({ backupPath });
        const restoreDirectory = path.join(appSupportRoot, 'restore');
        await mkdir(restoreDirectory, { mode: 0o700 });
        await chmod(restoreDirectory, 0o700);
        const destinationPath = path.join(restoreDirectory, 'restored.sqlite3');
        await restoreSmartOrderRepositoryBackup({
            backupPath,
            destinationPath,
        });
        const restored = new DatabaseSync(destinationPath, { readOnly: true });
        try {
            if (
                restored.prepare('PRAGMA integrity_check').get()?.integrity_check !==
                'ok'
            ) {
                throw new Error('restored repository integrity failed');
            }
        } finally {
            restored.close();
        }
    } finally {
        await client.close().catch(() => {});
    }
}

async function readCurrentManagedArtifact(filePath, expectedMode, maximumBytes) {
    const handle = await open(
        filePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    let metadata;
    let bytes;
    try {
        metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            metadata.size < 1 ||
            metadata.size > maximumBytes ||
            (metadata.mode & 0o777) !== expectedMode ||
            (typeof process.getuid === 'function' &&
                metadata.uid !== process.getuid())
        ) {
            throw new Error('managed artifact is not current-user private');
        }
        bytes = await handle.readFile();
    } finally {
        await handle.close();
    }
    const current = await lstat(filePath);
    if (
        current.isSymbolicLink() ||
        current.dev !== metadata.dev ||
        current.ino !== metadata.ino ||
        current.size !== metadata.size ||
        current.mtimeMs !== metadata.mtimeMs
    ) {
        bytes?.fill(0);
        throw new Error('managed artifact changed while reading');
    }
    return bytes;
}

async function parsePlistBytes(plistBytes) {
    const child = spawn(
        '/usr/bin/plutil',
        ['-convert', 'json', '-o', '-', '-'],
        {
            env: {
                LANG: 'C',
                LC_ALL: 'C',
                PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        },
    );
    let stdout = Buffer.alloc(0);
    let stderrBytes = 0;
    const timeout = setTimeout(() => child.kill('SIGKILL'), 2_000);
    child.stdout.on('data', (chunk) => {
        stdout = Buffer.concat([stdout, chunk]);
        if (stdout.length > 64 * 1024) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => {
        stderrBytes += chunk.length;
        if (stderrBytes > 64 * 1024) child.kill('SIGKILL');
    });
    child.stdin.end(plistBytes);
    const exit = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
    }).finally(() => clearTimeout(timeout));
    if (exit.code !== 0 || exit.signal !== null || stdout.length === 0) {
        stdout.fill(0);
        throw new Error('LaunchAgent plist could not be parsed securely');
    }
    try {
        return JSON.parse(stdout.toString('utf8'));
    } finally {
        stdout.fill(0);
    }
}

export async function verifySmartOrderManagedLaunchAgentArtifacts({
    launchAgentPlistPath,
    installedRuntimeScriptPath,
    expectedRuntimeScriptSha256 =
        MODULE_LOAD_SOURCE_FINGERPRINTS.runtimeScriptSha256,
}) {
    if (
        !path.isAbsolute(launchAgentPlistPath ?? '') ||
        (installedRuntimeScriptPath !== undefined &&
            !path.isAbsolute(installedRuntimeScriptPath)) ||
        !/^[a-f0-9]{64}$/.test(expectedRuntimeScriptSha256 ?? '')
    ) {
        throw new Error('managed LaunchAgent binding paths are required');
    }
    const plistBytes = await readCurrentManagedArtifact(
        launchAgentPlistPath,
        0o600,
        64 * 1024,
    );
    let installedBytes;
    try {
        const plist = await parsePlistBytes(plistBytes);
        const programArguments = plist?.ProgramArguments;
        if (
            !Array.isArray(programArguments) ||
            programArguments.length !== 2 ||
            typeof programArguments[0] !== 'string' ||
            !path.isAbsolute(programArguments[0]) ||
            programArguments[1] !== 'service-smart-order-sidecar'
        ) {
            throw new Error('LaunchAgent ProgramArguments are not canonical');
        }
        const installedRealpath = await realpath(programArguments[0]);
        if (installedRealpath !== programArguments[0]) {
            throw new Error('installed runtime script must be a canonical realpath');
        }
        if (
            installedRuntimeScriptPath !== undefined &&
            installedRuntimeScriptPath !== installedRealpath
        ) {
            throw new Error('installed runtime path does not match LaunchAgent');
        }
        installedBytes = await readCurrentManagedArtifact(
            installedRealpath,
            0o700,
            512 * 1024,
        );
        if (
            sha256(installedBytes) !== expectedRuntimeScriptSha256
        ) {
            throw new Error('installed runtime script is stale or untrusted');
        }
        return Object.freeze({
            installedRuntimeScriptSha256: `sha256:${sha256(installedBytes)}`,
            launchAgentPlistSha256: `sha256:${sha256(plistBytes)}`,
        });
    } finally {
        plistBytes.fill(0);
        installedBytes?.fill(0);
    }
}

async function launchAgentAbsolutePathCapability(
    appSupportRoot,
    { launchAgentPlistPath, installedRuntimeScriptPath },
) {
    const executable = await realpath(process.execPath);
    if (!path.isAbsolute(executable) || executable !== process.execPath) {
        throw new Error('current Node executable is not a canonical absolute path');
    }
    await verifySmartOrderManagedLaunchAgentArtifacts({
        launchAgentPlistPath,
        installedRuntimeScriptPath,
    });
    const contract = await readSmartOrderSidecarStartupContract({ appSupportRoot });
    if (
        contract.mode !== 'simulation' ||
        contract.dispatchAllowed !== false ||
        contract.appSupportRoot !== appSupportRoot
    ) {
        throw new Error('sidecar absolute runtime startup contract failed');
    }
}

function checkRecords(statusById) {
    return SMART_ORDER_REQUIRED_NODE_SQLITE_CHECK_IDS.map((id) =>
        Object.freeze({ id, status: statusById.get(id) ?? 'fail' }),
    );
}

export async function runSmartOrderNodeSqliteCapabilityProbe({
    appSupportRoot,
    launchAgentPlistPath,
    installedRuntimeScriptPath,
    testOnlyForceUnsupportedRuntime = false,
} = {}) {
    if (testOnlyForceUnsupportedRuntime && process.env.VITEST !== 'true') {
        throw new Error('test-only unsupported runtime override is unavailable');
    }
    const fingerprints = MODULE_LOAD_SOURCE_FINGERPRINTS;
    const statusById = new Map();
    let platform = Object.freeze({
        operatingSystem: process.platform,
        macosVersion: 'unknown',
        hypervisorPresent: -1,
        processArch: process.arch,
        hardwareArch: 'unknown',
        nativeArchitecture: false,
        unameMachine: 'unknown',
        sysctlOptionalArm64: -1,
    });
    const mark = (ids, passed) => {
        for (const id of ids) statusById.set(id, passed ? 'pass' : 'fail');
    };

    try {
        if (testOnlyForceUnsupportedRuntime) {
            throw new Error('test-only unsupported runtime');
        }
        supportedRuntime();
        mark(['node-24-lts', 'node-sqlite-import'], true);
    } catch {
        mark(['node-24-lts'], false);
        mark(['node-sqlite-import'], Boolean(DatabaseSync));
    }
    try {
        platform = await physicalArchitecture();
        mark(['native-apple-silicon-arm64-host'], true);
    } catch {
        mark(['native-apple-silicon-arm64-host'], false);
    }

    const root = await mkdtemp(
        path.join(tmpdir(), 'realtimestock-node-sqlite-capability-'),
    );
    await chmod(root, 0o700);
    try {
        try {
            await rawSqliteCapability(path.join(root, 'capability.sqlite3'));
            mark(['wal', 'synchronous-full', 'defensive-mode'], true);
        } catch {
            mark(['wal', 'synchronous-full', 'defensive-mode'], false);
        }
        try {
            await verifyCrashDurability(path.join(root, 'crash.sqlite3'));
            mark(['crash-durability'], true);
        } catch {
            mark(['crash-durability'], false);
        }
        try {
            await repositoryWorkerCapability(path.join(root, 'app-support'));
            mark(
                [
                    'backup-restore',
                    'dedicated-worker-event-loop-isolation',
                    'latency-watchdog-fail-closed',
                ],
                true,
            );
        } catch {
            mark(
                [
                    'backup-restore',
                    'dedicated-worker-event-loop-isolation',
                    'latency-watchdog-fail-closed',
                ],
                false,
            );
        }
        try {
            if (testOnlyForceUnsupportedRuntime) {
                throw new Error('test-only unsupported launch runtime');
            }
            await launchAgentAbsolutePathCapability(appSupportRoot, {
                launchAgentPlistPath,
                installedRuntimeScriptPath,
            });
            mark(['launchagent-absolute-node-path'], true);
        } catch {
            mark(['launchagent-absolute-node-path'], false);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }

    const finalFingerprints =
        await currentSmartOrderNodeSqliteCapabilityFingerprints();
    mark(
        ['source-fingerprint-stable'],
        canonicalJson(finalFingerprints) === canonicalJson(fingerprints),
    );

    const checks = checkRecords(statusById);
    const passed = checks.every((check) => check.status === 'pass');
    const report = {
        schema: SMART_ORDER_NODE_SQLITE_CAPABILITY_SCHEMA,
        version: SMART_ORDER_NODE_SQLITE_CAPABILITY_VERSION,
        codeRevision: `sha256:${fingerprints.sourceSha256}`,
        generatedAt: new Date().toISOString(),
        runId: randomUUID(),
        executionMode: appSupportRoot
            ? 'managed-local-capability'
            : 'test-fixture',
        evidenceClass: appSupportRoot
            ? 'node_sqlite_arm64_platform_capability'
            : 'test_fixture',
        operationClass: 'offline-no-broker-node-sqlite-arm64-capability',
        supportPolicy: SMART_ORDER_TRADING_RUNTIME_PLATFORM_POLICY,
        attestation: {
            algorithm: 'none',
            hostKeyId: 'none',
            payloadSha256: 'none',
            signatureBase64Url: 'none',
        },
        platform,
        runtime: {
            nodeVersion: process.versions.node,
            nodeLts: process.release.lts ?? '',
            sqliteVersion: process.versions.sqlite ?? '',
        },
        fingerprint: fingerprints,
        checks,
        sideEffects: {
            brokerWritesAttempted: 0,
            brokerWritesNetworked: 0,
            serviceMutations: 0,
        },
        redactionScan: 'pass',
        testOutcome: passed ? 'pass' : 'fail',
        overall: passed ? 'pass' : 'fail',
        resultHash: '',
    };
    report.resultHash = reportHash(report);
    if (!appSupportRoot) return Object.freeze(report);
    const signed = await signAndStoreNodeSqliteCapabilityReport({
        appSupportRoot,
        report,
    });
    return signed.report;
}

async function main() {
    let expectedFingerprints;
    try {
        expectedFingerprints = JSON.parse(
            process.env.REALTIME_STOCK_NODE_SQLITE_EXPECTED_FINGERPRINTS ?? '',
        );
    } catch {
        throw new Error('trusted parent source fingerprint is required');
    }
    if (
        canonicalJson(expectedFingerprints) !==
        canonicalJson(MODULE_LOAD_SOURCE_FINGERPRINTS)
    ) {
        throw new Error('source changed before the capability child loaded');
    }
    const appSupportRoot = process.env.REALTIME_STOCK_NODE_SQLITE_APP_SUPPORT;
    const launchAgentPlistPath =
        process.env.REALTIME_STOCK_NODE_SQLITE_LAUNCHAGENT_PLIST;
    if (
        !appSupportRoot ||
        !launchAgentPlistPath
    ) {
        throw new Error(
            'managed Node SQLite capability binding is required; use scripts/realtimestock-runtime node-sqlite-probe',
        );
    }
    const report = await runSmartOrderNodeSqliteCapabilityProbe({
        appSupportRoot,
        launchAgentPlistPath,
    });
    process.stdout.write(`${canonicalJson(report)}\n`);
    if (report.overall !== 'pass') process.exitCode = 1;
}

if (process.argv[2] === '--crash-child') {
    await crashChild(path.resolve(process.argv[3] ?? ''), process.argv[4]);
} else if (
    process.argv[1] &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
    await main();
}
