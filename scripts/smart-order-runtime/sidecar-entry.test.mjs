import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    assertSupportedSmartOrderNodeRuntime,
    readMacosSleepWakeIdentity,
    readSmartOrderSidecarPrivateMarkers,
    startSmartOrderSidecarEntry,
} from './sidecar-entry.mjs';

const roots = [];
const entryPath = fileURLToPath(new URL('./sidecar-entry.mjs', import.meta.url));

afterEach(async () => {
    await Promise.all(
        roots.splice(0).map((root) =>
            rm(root, { recursive: true, force: true }),
        ),
    );
});

async function privateRoot() {
    const root = await mkdtemp(path.join(tmpdir(), 'smart-order-entry-'));
    roots.push(root);
    await chmod(root, 0o700);
    return root;
}

async function writePrivate(root, name, value) {
    const filePath = path.join(root, name);
    await writeFile(filePath, `${value}\n`, { mode: 0o600 });
    await chmod(filePath, 0o600);
    return filePath;
}

async function validMarkers(root) {
    await writePrivate(root, 'runtime-mode', 'simulation');
    await writePrivate(
        root,
        'runtime-api-generation',
        'simulation:11111111-2222-4333-8444-555555555555',
    );
    await writePrivate(root, 'node-runtime-path', '/private/runtime/node');
}

function runSidecarEntry(environment) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [entryPath], {
            env: environment,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const stdout = [];
        const stderr = [];
        child.stdout.on('data', (chunk) => stdout.push(chunk));
        child.stderr.on('data', (chunk) => stderr.push(chunk));
        child.once('error', reject);
        child.once('close', (code, signal) => {
            resolve({
                code,
                signal,
                stdout: Buffer.concat(stdout).toString('utf8'),
                stderr: Buffer.concat(stderr).toString('utf8'),
            });
        });
    });
}

describe('smart-order sidecar process entry', () => {
    let runtimeEpochCounter = 0;

    function startupContract() {
        return Object.freeze({
            schemaVersion: 'smart-order-sidecar-entry/2026-08-22.3',
            appSupportRoot: '/private/test-app-support',
            apiGeneration:
                'simulation:11111111-2222-4333-8444-555555555555',
            expectedOrigin: 'http://127.0.0.1:5173',
            mode: 'simulation',
            dispatchAllowed: false,
            platformSupportPolicy:
                'smart-order-trading-runtime-platform/native-apple-silicon-arm64/2026-08-22.1',
        });
    }

    function primarySidecar() {
        runtimeEpochCounter += 1;
        const runtimeEpochId =
            `runtime-epoch-sidecar-entry-test-${runtimeEpochCounter}`;
        const durableContinuityInvalidation = vi.fn(async () => ({
            state: 'reconciling',
            dispatchAllowed: false,
        }));
        const sidecar = {
            schemaVersion: 'smart-order-local-sidecar/2026-08-11.1',
            role: 'primary',
            host: '127.0.0.1',
            port: 54321,
            runtimeEpochId,
            dispatchAllowed: false,
            status: vi.fn(() => ({
                state: 'reconciling',
                dispatchAllowed: false,
            })),
            invalidateApiGeneration: vi.fn(),
            durableContinuityInvalidation,
            createRuntimeGapCoordinator: vi.fn((baseline) => {
                let wallTimeMs = baseline.observedWallTimeMs;
                let monotonicTimeMs = baseline.observedMonotonicTimeMs;
                let recoveryRequired = false;
                let stopped = false;
                let invalidationState = 'not_required';
                let completion;
                const signalSha256 = `sha256:${'9'.repeat(64)}`;
                const runtimeEpochIdSha256 = `sha256:${'8'.repeat(64)}`;
                const status = () => ({
                    coordinatorState: stopped
                        ? 'stopped'
                        : recoveryRequired
                          ? 'recovery_required'
                          : 'monitoring',
                    recoveryRequired,
                    dispatchBlockedByContinuityGap: recoveryRequired,
                    invalidationState,
                    signalSha256: recoveryRequired ? signalSha256 : null,
                });
                const latch = (reasonCode, nowEpochMs) => {
                    if (stopped) throw new Error('stopped');
                    if (recoveryRequired) return status();
                    recoveryRequired = true;
                    invalidationState = 'pending';
                    completion = Promise.resolve(
                        durableContinuityInvalidation({
                            schemaVersion:
                                'smart-order-runtime-gap-invalidation/2026-08-13.3',
                            runtimeEpochIdSha256,
                            signalSha256,
                            reasonCodes: [reasonCode],
                            nowEpochMs,
                        }),
                    ).then(() => {
                        invalidationState = 'committed';
                    });
                    return status();
                };
                return Object.freeze({
                    observeClockSample(input) {
                        if (stopped) throw new Error('stopped');
                        if (recoveryRequired) return status();
                        const wallDelta = input.observedWallTimeMs - wallTimeMs;
                        const monotonicDelta =
                            input.observedMonotonicTimeMs - monotonicTimeMs;
                        wallTimeMs = input.observedWallTimeMs;
                        monotonicTimeMs = input.observedMonotonicTimeMs;
                        if (
                            monotonicDelta > 5_000 ||
                            monotonicDelta < 0 ||
                            wallDelta < 0 ||
                            Math.abs(wallDelta - monotonicDelta) > 2_000
                        ) {
                            return latch(
                                'EVENT_LOOP_PAUSE_GAP',
                                input.observedWallTimeMs,
                            );
                        }
                        return status();
                    },
                    observeLifecycle(input) {
                        return latch(
                            input.phase === 'wake'
                                ? 'SLEEP_WAKE_GAP'
                                : 'RUNTIME_GAP_INPUT_INVALID',
                            input.observedWallTimeMs,
                        );
                    },
                    observeSseLifecycle(input) {
                        return latch(
                            'SSE_STREAM_BASELINE_MISSING',
                            input.observedWallTimeMs,
                        );
                    },
                    waitForInvalidation() {
                        return completion;
                    },
                    status,
                    stop() {
                        stopped = true;
                        return status();
                    },
                });
            }),
            closeForGenerationFailover: vi.fn(async () => ({
                state: 'closed',
                repositoryState: 'reconciling',
                dispatchAllowed: false,
            })),
            close: vi.fn(async () => undefined),
        };
        return Object.freeze(sidecar);
    }

    it('只接受 Node 24.15+ LTS 且拒絕其他 major 或非 LTS', () => {
        expect(() =>
            assertSupportedSmartOrderNodeRuntime({
                versions: { node: '24.15.0' },
                release: { lts: 'Krypton' },
            }),
        ).not.toThrow();
        expect(() =>
            assertSupportedSmartOrderNodeRuntime({
                versions: { node: '24.14.9' },
                release: { lts: 'Krypton' },
            }),
        ).toThrow(/Node\.js LTS/);
        expect(() =>
            assertSupportedSmartOrderNodeRuntime({
                versions: { node: '25.0.0' },
                release: { lts: 'Krypton' },
            }),
        ).toThrow(/Node\.js LTS/);
        expect(() =>
            assertSupportedSmartOrderNodeRuntime({
                versions: { node: '24.15.0' },
                release: { lts: undefined },
            }),
        ).toThrow(/Node\.js LTS/);
    });

    it('只解析 macOS IOPMrootDomain 的 SleepWakeUUID', async () => {
        const execFileImpl = vi.fn((_file, _args, _options, callback) => {
            callback(
                null,
                '    "SleepWakeUUID" = "30b5c2ea-c12a-4616-91c5-0065eeb700c6"\n',
            );
        });
        await expect(
            readMacosSleepWakeIdentity({ execFileImpl }),
        ).resolves.toBe('30B5C2EA-C12A-4616-91C5-0065EEB700C6');
        expect(execFileImpl).toHaveBeenCalledWith(
            '/usr/sbin/ioreg',
            ['-r', '-n', 'IOPMrootDomain', '-d', '1'],
            expect.objectContaining({ timeout: 2_000 }),
            expect.any(Function),
        );
    });

    it('只接受 current-user 0600 simulation marker 與 simulation generation', async () => {
        const root = await privateRoot();
        await validMarkers(root);
        await expect(
            readSmartOrderSidecarPrivateMarkers({ appSupportRoot: root }),
        ).resolves.toEqual({
            appSupportRoot: root,
            apiGeneration:
                'simulation:11111111-2222-4333-8444-555555555555',
            persistedNodePath: '/private/runtime/node',
            mode: 'simulation',
        });
    });

    it('production-readonly 在建立 sidecar storage 前即 fail closed', async () => {
        const root = await privateRoot();
        await writePrivate(root, 'runtime-mode', 'production-readonly');
        await writePrivate(
            root,
            'runtime-api-generation',
            'production-readonly:11111111-2222-4333-8444-555555555555',
        );
        await writePrivate(root, 'node-runtime-path', '/private/runtime/node');
        await expect(
            readSmartOrderSidecarPrivateMarkers({ appSupportRoot: root }),
        ).rejects.toThrow(/simulation-only/);
        await expect(
            readFile(path.join(root, 'smart-order', 'settings-summary.json')),
        ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('拒絕群組可讀 marker、symlink marker 與非絕對 persisted Node path', async () => {
        const groupReadableRoot = await privateRoot();
        await validMarkers(groupReadableRoot);
        await chmod(path.join(groupReadableRoot, 'runtime-mode'), 0o640);
        await expect(
            readSmartOrderSidecarPrivateMarkers({
                appSupportRoot: groupReadableRoot,
            }),
        ).rejects.toThrow(/private file/);

        const symlinkRoot = await privateRoot();
        const target = await writePrivate(
            symlinkRoot,
            'mode-target',
            'simulation',
        );
        await symlink(target, path.join(symlinkRoot, 'runtime-mode'));
        await writePrivate(
            symlinkRoot,
            'runtime-api-generation',
            'simulation:11111111-2222-4333-8444-555555555555',
        );
        await writePrivate(
            symlinkRoot,
            'node-runtime-path',
            '/private/runtime/node',
        );
        await expect(
            readSmartOrderSidecarPrivateMarkers({
                appSupportRoot: symlinkRoot,
            }),
        ).rejects.toMatchObject({ code: 'ELOOP' });

        const relativeRoot = await privateRoot();
        await validMarkers(relativeRoot);
        await writePrivate(relativeRoot, 'node-runtime-path', 'node');
        await expect(
            readSmartOrderSidecarPrivateMarkers({
                appSupportRoot: relativeRoot,
            }),
        ).rejects.toThrow(/not absolute/);
    });

    it('入口固定使用 loopback random port 且不含券商 write route', async () => {
        const source = await readFile(entryPath, 'utf8');
        expect(source).toContain("const EXPECTED_ORIGIN = 'http://127.0.0.1:5173'");
        expect(source).toContain('port: 0');
        expect(source).toContain('dispatchAllowed: false');
        expect(source).toContain('startSmartOrderLocalSidecar');
        expect(source).not.toMatch(
            /SJ_PRODUCTION|SJ_CA|place_order|update_order|cancel_order|\/api\/v1\/order/i,
        );
    });

    it('generation 相同時維持 observe-only，變更後只失效一次並退出舊 process incarnation', async () => {
        const contract = startupContract();
        const sidecar = primarySidecar();
        let currentGeneration = contract.apiGeneration;
        let scheduledCheck;
        const cancelInterval = vi.fn();
        const entry = await startSmartOrderSidecarEntry({
            appSupportRoot: contract.appSupportRoot,
            readStartupContract: vi.fn(async () => contract),
            readMarkers: vi.fn(async () => ({
                appSupportRoot: contract.appSupportRoot,
                apiGeneration: currentGeneration,
                persistedNodePath: '/private/runtime/node',
                mode: 'simulation',
            })),
            readSleepWakeIdentity: vi.fn(async () => 'POWER-BASELINE'),
            startSidecar: vi.fn(async () => sidecar),
            scheduleInterval: (callback, intervalMs) => {
                expect(intervalMs).toBe(1_000);
                scheduledCheck = callback;
                return { unref: vi.fn() };
            },
            cancelInterval,
            now: () => 1_786_382_000_000,
        });

        await scheduledCheck();
        expect(sidecar.closeForGenerationFailover).not.toHaveBeenCalled();

        currentGeneration =
            'simulation:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        await scheduledCheck();
        await expect(entry.generationFailover).resolves.toEqual({
            state: 'closed',
            reason: 'generation_invalidated',
            dispatchAllowed: false,
            repositoryState: 'reconciling',
        });
        expect(sidecar.closeForGenerationFailover).toHaveBeenCalledTimes(1);
        expect(sidecar.closeForGenerationFailover).toHaveBeenCalledWith({
            observedApiGeneration: currentGeneration,
            nowEpochMs: 1_786_382_000_000,
        });
        await scheduledCheck();
        expect(sidecar.closeForGenerationFailover).toHaveBeenCalledTimes(1);
        expect(cancelInterval).toHaveBeenCalled();
        expect(JSON.stringify(await entry.generationFailover)).not.toContain(
            currentGeneration,
        );
    });

    it('marker 無法讀取或離開 simulation 時 fail closed，不輸出 marker 錯誤內容', async () => {
        const contract = startupContract();
        const sidecar = primarySidecar();
        let scheduledCheck;
        const secretCanary = 'PRIVATE_MARKER_ERROR_CANARY';
        const entry = await startSmartOrderSidecarEntry({
            appSupportRoot: contract.appSupportRoot,
            readStartupContract: vi.fn(async () => contract),
            readMarkers: vi.fn(async () => {
                throw new Error(secretCanary);
            }),
            readSleepWakeIdentity: vi.fn(async () => 'POWER-BASELINE'),
            startSidecar: vi.fn(async () => sidecar),
            scheduleInterval: (callback) => {
                scheduledCheck = callback;
                return { unref: vi.fn() };
            },
            cancelInterval: vi.fn(),
            now: () => 1_786_382_000_001,
        });

        await scheduledCheck();
        const result = await entry.generationFailover;
        expect(sidecar.closeForGenerationFailover).toHaveBeenCalledWith({
            observedApiGeneration: 'marker-unavailable',
            nowEpochMs: 1_786_382_000_001,
        });
        expect(JSON.stringify(result)).not.toContain(secretCanary);
        expect(result).toMatchObject({
            dispatchAllowed: false,
            reason: 'generation_invalidated',
        });
    });

    it('一般 shutdown 先取消 generation watcher，再走既有 drain-aware close', async () => {
        const contract = startupContract();
        const sidecar = primarySidecar();
        const cancelInterval = vi.fn();
        const intervalHandle = { unref: vi.fn() };
        const entry = await startSmartOrderSidecarEntry({
            appSupportRoot: contract.appSupportRoot,
            readStartupContract: vi.fn(async () => contract),
            readMarkers: vi.fn(),
            readSleepWakeIdentity: vi.fn(async () => 'POWER-BASELINE'),
            startSidecar: vi.fn(async () => sidecar),
            scheduleInterval: vi.fn(() => intervalHandle),
            cancelInterval,
            now: () => 1_786_382_000_002,
        });

        await entry.close({ nowEpochMs: 1_786_382_000_003 });
        expect(cancelInterval).toHaveBeenCalledWith(intervalHandle);
        expect(sidecar.close).toHaveBeenCalledWith({
            nowEpochMs: 1_786_382_000_003,
        });
        expect(sidecar.closeForGenerationFailover).not.toHaveBeenCalled();
    });

    it('event-loop gap 先同步封鎖 continuity，再以去識別化 signal 進 durable recovery', async () => {
        const contract = startupContract();
        const sidecar = primarySidecar();
        let scheduledCheck;
        const wallTimes = [
            1_786_382_000_000,
            1_786_382_000_000,
            1_786_382_010_100,
        ];
        const monotonicTimes = [10_000, 20_100];
        const entry = await startSmartOrderSidecarEntry({
            appSupportRoot: contract.appSupportRoot,
            readStartupContract: vi.fn(async () => contract),
            readMarkers: vi.fn(async () => ({
                appSupportRoot: contract.appSupportRoot,
                apiGeneration: contract.apiGeneration,
                persistedNodePath: '/private/runtime/node',
                mode: 'simulation',
            })),
            readSleepWakeIdentity: vi.fn(async () => 'POWER-BASELINE'),
            startSidecar: vi.fn(async () => sidecar),
            scheduleInterval: (callback) => {
                scheduledCheck = callback;
                return { unref: vi.fn() };
            },
            cancelInterval: vi.fn(),
            now: () => wallTimes.shift() ?? 1_786_382_010_100,
            monotonicNow: () => monotonicTimes.shift() ?? 20_100,
        });

        await scheduledCheck();
        expect(sidecar.durableContinuityInvalidation).toHaveBeenCalledTimes(1);
        const invalidation =
            sidecar.durableContinuityInvalidation.mock.calls[0][0];
        expect(invalidation).toMatchObject({
            schemaVersion:
                'smart-order-runtime-gap-invalidation/2026-08-13.3',
            reasonCodes: ['EVENT_LOOP_PAUSE_GAP'],
            nowEpochMs: 1_786_382_010_100,
        });
        expect(invalidation.signalSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(invalidation.runtimeEpochIdSha256).toMatch(
            /^sha256:[0-9a-f]{64}$/,
        );
        expect(JSON.stringify(invalidation)).not.toContain(
            contract.apiGeneration,
        );
        expect(entry.status()).toMatchObject({
            dispatchAllowed: false,
            runtimeContinuity: {
                coordinatorState: 'recovery_required',
                dispatchBlockedByContinuityGap: true,
                invalidationState: 'committed',
            },
        });
        await scheduledCheck();
        expect(sidecar.durableContinuityInvalidation).toHaveBeenCalledTimes(1);
        await entry.close({ nowEpochMs: 1_786_382_010_200 });
    });

    it('macOS SleepWakeUUID 改變時即使 clock 邊界正常仍 durable reconcile', async () => {
        const contract = startupContract();
        const sidecar = primarySidecar();
        let scheduledCheck;
        const powerIdentities = ['POWER-BEFORE-SLEEP', 'POWER-AFTER-WAKE'];
        const wallTimes = [
            1_786_382_000_000,
            1_786_382_000_000,
            1_786_382_005_000,
        ];
        const monotonicTimes = [10_000, 15_000];
        const entry = await startSmartOrderSidecarEntry({
            appSupportRoot: contract.appSupportRoot,
            readStartupContract: vi.fn(async () => contract),
            readMarkers: vi.fn(async () => ({
                appSupportRoot: contract.appSupportRoot,
                apiGeneration: contract.apiGeneration,
                persistedNodePath: '/private/runtime/node',
                mode: 'simulation',
            })),
            readSleepWakeIdentity: vi.fn(
                async () => powerIdentities.shift() ?? 'POWER-AFTER-WAKE',
            ),
            startSidecar: vi.fn(async () => sidecar),
            scheduleInterval: (callback) => {
                scheduledCheck = callback;
                return { unref: vi.fn() };
            },
            cancelInterval: vi.fn(),
            now: () => wallTimes.shift() ?? 1_786_382_005_000,
            monotonicNow: () => monotonicTimes.shift() ?? 15_000,
        });

        await scheduledCheck();
        const invalidation =
            sidecar.durableContinuityInvalidation.mock.calls[0][0];
        expect(invalidation).toMatchObject({
            reasonCodes: ['SLEEP_WAKE_GAP'],
            nowEpochMs: 1_786_382_005_000,
        });
        expect(entry.status()).toMatchObject({
            runtimeContinuity: {
                recoveryRequired: true,
                invalidationState: 'committed',
            },
        });
        await entry.close({ nowEpochMs: 1_786_382_005_100 });
    });

    it('啟動失敗只輸出固定錯誤類型，不洩漏私有路徑或秘密字串', async () => {
        const secretCanary = 'CANARY_PRIVATE_CAPABILITY_7f9d1e';
        const root = await privateRoot();
        const privatePath = path.join(root, secretCanary);
        const result = await runSidecarEntry({
            ...process.env,
            REALTIME_STOCK_APP_SUPPORT: privatePath,
        });
        expect(result).toMatchObject({ code: 1, signal: null, stdout: '' });
        expect(result.stderr).toMatch(
            /^smart_order_sidecar_start=refused_fail_closed:[A-Za-z][A-Za-z0-9]{0,79}\n$/,
        );
        expect(result.stderr).not.toContain(root);
        expect(result.stderr).not.toContain(secretCanary);
        expect(result.stderr).not.toMatch(/stack|capability|identity|account/i);
    });
});
