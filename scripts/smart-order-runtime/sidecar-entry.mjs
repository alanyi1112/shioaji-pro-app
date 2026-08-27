#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { startSmartOrderLocalSidecar } from './local-sidecar.mjs';
import { readSmartOrderTradingRuntimePlatformSupport } from './trading-runtime-platform-support.mjs';

export const SMART_ORDER_SIDECAR_ENTRY_SCHEMA_VERSION =
    'smart-order-sidecar-entry/2026-08-22.3';

const EXPECTED_ORIGIN = 'http://127.0.0.1:5173';
const MODE_FILE_NAME = 'runtime-mode';
const API_GENERATION_FILE_NAME = 'runtime-api-generation';
const NODE_RUNTIME_FILE_NAME = 'node-runtime-path';
const API_GENERATION_POLL_INTERVAL_MS = 1_000;
const MACOS_POWER_POLL_INTERVAL_MS = 5_000;
const UNREADABLE_API_GENERATION = 'marker-unavailable';
const MACOS_SLEEP_WAKE_ID_PATTERN =
    /^\s*"SleepWakeUUID"\s*=\s*"([0-9A-Fa-f-]{36})"\s*$/m;

function explicitAbsoluteRoot(value) {
    if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value)) {
        throw new TypeError('app support root must be an explicit absolute path');
    }
    const normalized = path.resolve(value);
    if (normalized === path.parse(normalized).root) {
        throw new TypeError('app support root may not be a filesystem root');
    }
    return normalized;
}

function boundedToken(value, label) {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 240 ||
        value.trim() !== value ||
        !/^[A-Za-z0-9._:-]+$/.test(value)
    ) {
        throw new TypeError(`${label} must be a bounded token`);
    }
    return value;
}

async function readPrivateTextFile(filePath, { label, maximumBytes }) {
    const handle = await open(
        filePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
        const metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            metadata.size < 1 ||
            metadata.size > maximumBytes ||
            (metadata.mode & 0o077) !== 0 ||
            (typeof process.getuid === 'function' &&
                metadata.uid !== process.getuid())
        ) {
            throw new Error(`${label} is not a current-user private file`);
        }
        return (await handle.readFile('utf8')).trim();
    } finally {
        await handle.close();
    }
}

export function assertSupportedSmartOrderNodeRuntime({
    versions = process.versions,
    release = process.release,
} = {}) {
    const [major, minor, patchVersion] = String(versions?.node ?? '')
        .split('.')
        .map(Number);
    const supported =
        major === 24 &&
        (minor > 15 || (minor === 15 && patchVersion >= 0)) &&
        typeof release?.lts === 'string' &&
        release.lts.length > 0;
    if (!supported) {
        throw new Error(
            'smart-order sidecar requires Node.js LTS >=24.15.0 and <25',
        );
    }
}

export async function readSmartOrderSidecarPrivateMarkers({ appSupportRoot }) {
    const root = explicitAbsoluteRoot(appSupportRoot);
    const rootMetadata = await lstat(root);
    if (
        rootMetadata.isSymbolicLink() ||
        !rootMetadata.isDirectory() ||
        (rootMetadata.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' &&
            rootMetadata.uid !== process.getuid())
    ) {
        throw new Error('app support root is not a current-user private directory');
    }
    const mode = await readPrivateTextFile(path.join(root, MODE_FILE_NAME), {
        label: 'runtime mode marker',
        maximumBytes: 64,
    });
    if (mode !== 'simulation') {
        throw new Error('smart-order sidecar is simulation-only');
    }
    const apiGeneration = boundedToken(
        await readPrivateTextFile(
            path.join(root, API_GENERATION_FILE_NAME),
            {
                label: 'API generation marker',
                maximumBytes: 256,
            },
        ),
        'apiGeneration',
    );
    if (!apiGeneration.startsWith('simulation:')) {
        throw new Error('API generation is not a simulation generation');
    }
    const persistedNodePath = await readPrivateTextFile(
        path.join(root, NODE_RUNTIME_FILE_NAME),
        {
            label: 'persisted Node runtime path',
            maximumBytes: 4_096,
        },
    );
    if (!path.isAbsolute(persistedNodePath)) {
        throw new Error('persisted Node runtime path is not absolute');
    }
    return Object.freeze({
        appSupportRoot: root,
        apiGeneration,
        persistedNodePath: path.resolve(persistedNodePath),
        mode,
    });
}

export async function readSmartOrderSidecarStartupContract({
    appSupportRoot,
    readPlatformSupport = readSmartOrderTradingRuntimePlatformSupport,
}) {
    assertSupportedSmartOrderNodeRuntime();
    const platform = await readPlatformSupport();
    const markers = await readSmartOrderSidecarPrivateMarkers({
        appSupportRoot,
    });
    const [persistedExecutable, currentExecutable] = await Promise.all([
        realpath(markers.persistedNodePath),
        realpath(process.execPath),
    ]);
    if (persistedExecutable !== currentExecutable) {
        throw new Error('sidecar process does not match persisted Node runtime');
    }
    return Object.freeze({
        schemaVersion: SMART_ORDER_SIDECAR_ENTRY_SCHEMA_VERSION,
        appSupportRoot: markers.appSupportRoot,
        apiGeneration: markers.apiGeneration,
        expectedOrigin: EXPECTED_ORIGIN,
        mode: 'simulation',
        dispatchAllowed: false,
        platformSupportPolicy: platform.supportPolicy,
    });
}

export function readMacosSleepWakeIdentity({ execFileImpl = execFile } = {}) {
    if (typeof execFileImpl !== 'function') {
        throw new TypeError('execFileImpl must be a function');
    }
    return new Promise((resolve, reject) => {
        execFileImpl(
            '/usr/sbin/ioreg',
            ['-r', '-n', 'IOPMrootDomain', '-d', '1'],
            {
                encoding: 'utf8',
                maxBuffer: 128 * 1024,
                timeout: 2_000,
            },
            (error, stdout) => {
                if (error) {
                    reject(new Error('macOS power source is unavailable'));
                    return;
                }
                const match = String(stdout).match(
                    MACOS_SLEEP_WAKE_ID_PATTERN,
                );
                if (!match) {
                    reject(new Error('macOS power identity is unavailable'));
                    return;
                }
                resolve(match[1].toUpperCase());
            },
        );
    });
}

export async function startSmartOrderSidecarEntry({
    appSupportRoot,
    startSidecar = startSmartOrderLocalSidecar,
    readStartupContract = readSmartOrderSidecarStartupContract,
    readMarkers = readSmartOrderSidecarPrivateMarkers,
    readSleepWakeIdentity = readMacosSleepWakeIdentity,
    scheduleInterval = setInterval,
    cancelInterval = clearInterval,
    now = () => Date.now(),
    monotonicNow = () => Math.floor(performance.now()),
} = {}) {
    const contract = await readStartupContract({
        appSupportRoot,
    });
    const sidecar = await startSidecar({
        appSupportRoot: contract.appSupportRoot,
        apiGeneration: contract.apiGeneration,
        nowEpochMs: now(),
        expectedOrigin: EXPECTED_ORIGIN,
        port: 0,
        now,
    });
    if (sidecar.role !== 'primary' || sidecar.dispatchAllowed !== false) {
        await sidecar.close?.({ nowEpochMs: now() }).catch(() => {});
        throw new Error('smart-order sidecar did not enter observe-only primary mode');
    }
    if (typeof sidecar.closeForGenerationFailover !== 'function') {
        await sidecar.close?.({ nowEpochMs: now() }).catch(() => {});
        throw new Error('smart-order sidecar lacks generation failover fencing');
    }
    if (typeof sidecar.createRuntimeGapCoordinator !== 'function') {
        await sidecar.close?.({ nowEpochMs: now() }).catch(() => {});
        throw new Error('smart-order sidecar lacks private continuity authority');
    }

    const baselineWallTimeMs = now();
    const baselineMonotonicTimeMs = monotonicNow();
    const gapCoordinator = sidecar.createRuntimeGapCoordinator({
        observedWallTimeMs: baselineWallTimeMs,
        observedMonotonicTimeMs: baselineMonotonicTimeMs,
    });

    let sleepWakeIdentity;
    try {
        sleepWakeIdentity = await readSleepWakeIdentity();
    } catch {
        const unavailable = gapCoordinator.observeLifecycle({
            observedWallTimeMs: baselineWallTimeMs,
            observedMonotonicTimeMs: baselineMonotonicTimeMs,
            phase: null,
        });
        if (unavailable.recoveryRequired) {
            await gapCoordinator.waitForInvalidation();
        }
    }
    let nextPowerPollMonotonicMs =
        baselineMonotonicTimeMs + MACOS_POWER_POLL_INTERVAL_MS;

    let watcherStopped = false;
    let generationInvalidated = false;
    let checkInFlight;
    let healthPollInFlight;
    let watcherHandle;
    let resolveGenerationFailover;
    const generationFailover = new Promise((resolve) => {
        resolveGenerationFailover = resolve;
    });

    async function checkApiGeneration() {
        if (watcherStopped || generationInvalidated) {
            return generationFailover;
        }
        if (checkInFlight) return checkInFlight;
        checkInFlight = (async () => {
            let observedApiGeneration = UNREADABLE_API_GENERATION;
            try {
                const current = await readMarkers({
                    appSupportRoot: contract.appSupportRoot,
                });
                observedApiGeneration = current.apiGeneration;
                if (
                    !watcherStopped &&
                    observedApiGeneration === contract.apiGeneration
                ) {
                    return undefined;
                }
            } catch {
                // Missing, unreadable, non-simulation, or malformed markers all
                // retire this process incarnation.  The private value and the
                // read error are deliberately not returned or logged.
            }
            if (watcherStopped || generationInvalidated) return undefined;
            generationInvalidated = true;
            cancelInterval(watcherHandle);
            gapCoordinator.stop();
            try {
                const result = await sidecar.closeForGenerationFailover({
                    observedApiGeneration,
                    nowEpochMs: now(),
                });
                resolveGenerationFailover(
                    Object.freeze({
                        state: 'closed',
                        reason: 'generation_invalidated',
                        dispatchAllowed: false,
                        repositoryState: result?.repositoryState ?? 'reconciling',
                    }),
                );
            } catch {
                resolveGenerationFailover(
                    Object.freeze({
                        state: 'failed_stop',
                        reason: 'generation_invalidation_failed_closed',
                        dispatchAllowed: false,
                        repositoryState: 'unknown',
                    }),
                );
            }
            return generationFailover;
        })();
        try {
            return await checkInFlight;
        } finally {
            if (!generationInvalidated) checkInFlight = undefined;
        }
    }

    async function pollRuntimeHealth() {
        if (healthPollInFlight) return healthPollInFlight;
        healthPollInFlight = (async () => {
            await checkApiGeneration();
            if (watcherStopped || generationInvalidated) {
                return generationFailover;
            }
            const observedWallTimeMs = now();
            const observedMonotonicTimeMs = monotonicNow();
            let gapStatus = gapCoordinator.observeClockSample({
                observedWallTimeMs,
                observedMonotonicTimeMs,
            });
            if (gapStatus.recoveryRequired) {
                await gapCoordinator.waitForInvalidation();
                return undefined;
            }
            if (observedMonotonicTimeMs >= nextPowerPollMonotonicMs) {
                nextPowerPollMonotonicMs =
                    observedMonotonicTimeMs + MACOS_POWER_POLL_INTERVAL_MS;
                try {
                    const currentIdentity = await readSleepWakeIdentity();
                    if (sleepWakeIdentity === undefined) {
                        sleepWakeIdentity = currentIdentity;
                    } else if (currentIdentity !== sleepWakeIdentity) {
                        sleepWakeIdentity = currentIdentity;
                        gapStatus = gapCoordinator.observeLifecycle({
                            observedWallTimeMs,
                            observedMonotonicTimeMs,
                            phase: 'wake',
                        });
                    }
                } catch {
                    gapStatus = gapCoordinator.observeLifecycle({
                        observedWallTimeMs,
                        observedMonotonicTimeMs,
                        phase: null,
                    });
                }
                if (gapStatus.recoveryRequired) {
                    await gapCoordinator.waitForInvalidation();
                }
            }
            return undefined;
        })();
        try {
            return await healthPollInFlight;
        } finally {
            healthPollInFlight = undefined;
        }
    }

    watcherHandle = scheduleInterval(
        pollRuntimeHealth,
        API_GENERATION_POLL_INTERVAL_MS,
    );
    watcherHandle?.unref?.();

    return Object.freeze({
        schemaVersion: sidecar.schemaVersion,
        role: sidecar.role,
        host: sidecar.host,
        port: sidecar.port,
        runtimeEpochId: sidecar.runtimeEpochId,
        dispatchAllowed: false,
        generationFailover,
        lifecycleStop: sidecar.lifecycleStop,
        status() {
            return Object.freeze({
                ...sidecar.status(),
                runtimeContinuity: gapCoordinator.status(),
            });
        },
        invalidateApiGeneration: sidecar.invalidateApiGeneration,
        closeForGenerationFailover: sidecar.closeForGenerationFailover,
        async close({ nowEpochMs: stopAtEpochMs }) {
            watcherStopped = true;
            cancelInterval(watcherHandle);
            await checkInFlight;
            await healthPollInFlight;
            gapCoordinator.stop();
            return sidecar.close({ nowEpochMs: stopAtEpochMs });
        },
    });
}

async function runAsProcess() {
    const appSupportRoot = process.env.REALTIME_STOCK_APP_SUPPORT;
    const sidecar = await startSmartOrderSidecarEntry({ appSupportRoot });
    await new Promise((resolve) => {
        let shutdownInFlight = false;
        const finish = () => {
            process.off('SIGTERM', requestShutdown);
            process.off('SIGINT', requestShutdown);
            resolve();
        };
        const requestShutdown = async () => {
            if (shutdownInFlight) return;
            shutdownInFlight = true;
            try {
                await sidecar.close({ nowEpochMs: Date.now() });
                finish();
            } catch {
                shutdownInFlight = false;
                process.stderr.write(
                    'smart_order_sidecar_shutdown=blocked_fail_closed\n',
                );
            }
        };
        process.on('SIGTERM', requestShutdown);
        process.on('SIGINT', requestShutdown);
        sidecar.generationFailover.then(finish);
        sidecar.lifecycleStop?.then(finish);
    });
}

const invokedPath = process.argv[1]
    ? path.resolve(process.argv[1])
    : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
    runAsProcess().catch((error) => {
        const errorName =
            typeof error?.name === 'string' && error.name.length <= 80
                ? error.name
                : 'Error';
        process.stderr.write(
            `smart_order_sidecar_start=refused_fail_closed:${errorName}\n`,
        );
        process.exitCode = 1;
    });
}
