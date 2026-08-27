import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import {
    installSmartOrderLaunchAgent,
    verifySmartOrderLaunchAgent,
} from './launchagent-installer.mjs';

const temporaryDirectories = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) =>
            rm(directory, { recursive: true, force: true }),
        ),
    );
});

async function fixture() {
    const raw = await mkdtemp(path.join(tmpdir(), 'smart-order-launchagent-'));
    temporaryDirectories.push(raw);
    const root = await realpath(raw);
    const homeRoot = path.join(root, 'home');
    const repositoryRoot = path.join(root, 'repo');
    const appSupportRoot = path.join(root, 'app-support');
    const launchAgents = path.join(homeRoot, 'Library', 'LaunchAgents');
    const sourceRuntimePath = path.join(repositoryRoot, 'scripts', 'realtimestock-runtime');
    const installedRuntimePath = path.join(appSupportRoot, 'bin', 'realtimestock-runtime');
    const targetPath = path.join(
        launchAgents,
        'com.alanyi.realtimestock.smart-order-sidecar.plist',
    );
    await mkdir(path.dirname(sourceRuntimePath), { recursive: true });
    await mkdir(path.dirname(installedRuntimePath), { recursive: true });
    await mkdir(launchAgents, { recursive: true });
    await chmod(homeRoot, 0o700);
    await chmod(repositoryRoot, 0o755);
    await chmod(appSupportRoot, 0o700);
    await chmod(path.dirname(installedRuntimePath), 0o755);
    await chmod(launchAgents, 0o755);
    await writeFile(sourceRuntimePath, '#!/bin/zsh\nprint managed\n', {
        mode: 0o755,
    });
    await writeFile(installedRuntimePath, '#!/bin/zsh\nprint managed\n', {
        mode: 0o700,
    });
    await writeFile(path.join(repositoryRoot, 'SHIOAJI_VERSION'), 'v1.7.1\n', {
        mode: 0o644,
    });
    await writeFile(
        path.join(repositoryRoot, 'scripts', 'smart-order-contract-probe.mjs'),
        'export const probe = true;\n',
        { mode: 0o644 },
    );
    await writeFile(
        path.join(repositoryRoot, 'scripts', 'smart-order-readonly-gate-runner.mjs'),
        'export const runner = true;\n',
        { mode: 0o644 },
    );
    const runtimeModuleDirectory = path.join(
        repositoryRoot,
        'scripts',
        'smart-order-runtime',
    );
    await mkdir(runtimeModuleDirectory, { recursive: true });
    await writeFile(
        path.join(runtimeModuleDirectory, 'sidecar-entry.mjs'),
        'export const sidecar = true;\n',
        { mode: 0o644 },
    );
    await writeFile(
        path.join(runtimeModuleDirectory, 'local-sidecar.mjs'),
        'export const local = true;\n',
        { mode: 0o644 },
    );
    await writeFile(
        path.join(runtimeModuleDirectory, 'fixture.test.mjs'),
        'throw new Error("test fixture must not be installed");\n',
        { mode: 0o644 },
    );
    await mkdir(path.join(repositoryRoot, 'dist'), { recursive: true });
    await writeFile(path.join(repositoryRoot, 'dist', 'index.js'), 'built();\n', {
        mode: 0o644,
    });
    return {
        targetPath,
        installedRuntimePath,
        sourceRuntimePath,
        repositoryRoot,
        homeRoot,
        appSupportRoot,
        readPlatformSupport: async () => ({
            supportPolicy:
                'smart-order-trading-runtime-platform/native-apple-silicon-arm64/2026-08-22.1',
        }),
    };
}

describe('smart-order LaunchAgent installer', () => {
    it.each(['x64', 'Rosetta', 'VM', 'Linux'])('fails closed before installation on %s', async () => {
        const current = await fixture();
        const readPlatformSupport = async () => {
            throw new Error('unsupported smart-order trading Runtime platform');
        };
        await expect(
            installSmartOrderLaunchAgent({
                ...current,
                readPlatformSupport,
            }),
        ).rejects.toThrow('unsupported smart-order trading Runtime platform');
        await expect(lstat(current.targetPath)).rejects.toMatchObject({
            code: 'ENOENT',
        });
        await expect(
            verifySmartOrderLaunchAgent({
                ...current,
                readPlatformSupport,
            }),
        ).rejects.toThrow('unsupported smart-order trading Runtime platform');
    });

    it('atomically installs a private plist and content-addressed sidecar runtime bundle', async () => {
        const current = await fixture();
        const result = await installSmartOrderLaunchAgent(current);
        expect(result).toMatchObject({
            installed: true,
            brokerAuthority: false,
            writeMasterAuthority: false,
        });
        expect(result.installedBundleSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect((await lstat(path.dirname(current.installedRuntimePath))).mode & 0o777).toBe(
            0o700,
        );
        const metadata = await lstat(current.targetPath);
        expect(metadata.isFile()).toBe(true);
        expect(metadata.isSymbolicLink()).toBe(false);
        expect(metadata.mode & 0o777).toBe(0o600);
        const plist = await readFile(current.targetPath, 'utf8');
        expect(plist).not.toContain(current.installedRuntimePath);
        expect(plist).toContain('<string>service-smart-order-sidecar</string>');
        expect(plist).not.toContain(current.repositoryRoot);
        const installedBundleRoot = path.join(
            current.appSupportRoot,
            'bin',
            'smart-order-runtime-bundles',
            result.installedBundleSha256.slice('sha256:'.length),
        );
        expect(plist).toContain(installedBundleRoot);
        expect(plist).toContain(
            path.join(
                installedBundleRoot,
                'scripts',
                'realtimestock-runtime',
            ),
        );
        await expect(
            readFile(path.join(installedBundleRoot, 'managed-api-binding.json'), 'utf8'),
        ).resolves.toBe(
            `${JSON.stringify({
                schemaVersion: 'smart-order-managed-api-install-binding/2026-08-22.1',
                expectedRepositoryRoot: current.repositoryRoot,
            })}\n`,
        );
        await expect(
            readFile(
                path.join(
                    installedBundleRoot,
                    'scripts',
                    'smart-order-runtime',
                    'sidecar-entry.mjs',
                ),
                'utf8',
            ),
        ).resolves.toContain('sidecar');
        await expect(
            lstat(
                path.join(
                    installedBundleRoot,
                    'scripts',
                    'smart-order-runtime',
                    'fixture.test.mjs',
                ),
            ),
        ).rejects.toMatchObject({ code: 'ENOENT' });
        expect(plist).not.toMatch(/SJ_CA|SJ_PRODUCTION|brokerAuthority>true/i);
    });

    it('rejects a final symlink without truncating its target', async () => {
        const current = await fixture();
        const sentinel = path.join(path.dirname(current.targetPath), 'sentinel');
        await writeFile(sentinel, 'preserve', { mode: 0o600 });
        await symlink(sentinel, current.targetPath);
        await expect(installSmartOrderLaunchAgent(current)).rejects.toThrow(
            'existing sidecar LaunchAgent target is unsafe',
        );
        await expect(readFile(sentinel, 'utf8')).resolves.toBe('preserve');
    });

    it('uses a bundle-private runtime without mutating the shared managed runtime', async () => {
        const stale = await fixture();
        await writeFile(stale.installedRuntimePath, '#!/bin/zsh\nprint stale\n', {
            mode: 0o700,
        });
        await expect(installSmartOrderLaunchAgent(stale)).resolves.toMatchObject({
            installed: true,
        });
        await expect(readFile(stale.installedRuntimePath, 'utf8')).resolves.toBe(
            '#!/bin/zsh\nprint stale\n',
        );
        const stalePlist = await readFile(stale.targetPath, 'utf8');
        expect(stalePlist).not.toContain(stale.installedRuntimePath);

        const linked = await fixture();
        const realInstalled = `${linked.installedRuntimePath}.real`;
        await writeFile(realInstalled, '#!/bin/zsh\nprint managed\n', { mode: 0o700 });
        await rm(linked.installedRuntimePath);
        await symlink(realInstalled, linked.installedRuntimePath);
        await expect(installSmartOrderLaunchAgent(linked)).resolves.toMatchObject({
            installed: true,
        });
        expect(await realpath(linked.installedRuntimePath)).toBe(realInstalled);
    });

    it('refuses a group-writable installed bin directory instead of normalizing it', async () => {
        const current = await fixture();
        const binDirectory = path.dirname(current.installedRuntimePath);
        await chmod(binDirectory, 0o775);
        await expect(installSmartOrderLaunchAgent(current)).rejects.toThrow(
            'installed runtime bin directory is not a safe current-user directory',
        );
        expect((await lstat(binDirectory)).mode & 0o777).toBe(0o775);
        await expect(lstat(current.targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('rejects runtime or plist replacement after installation during adjacent revalidation', async () => {
        const replacedRuntime = await fixture();
        const replacedRuntimeResult =
            await installSmartOrderLaunchAgent(replacedRuntime);
        const replacedBundleRuntime = path.join(
            replacedRuntime.appSupportRoot,
            'bin',
            'smart-order-runtime-bundles',
            replacedRuntimeResult.installedBundleSha256.slice('sha256:'.length),
            'scripts',
            'realtimestock-runtime',
        );
        await writeFile(
            replacedBundleRuntime,
            '#!/bin/zsh\nprint replaced-after-read\n',
            { mode: 0o700 },
        );
        await expect(
            verifySmartOrderLaunchAgent(replacedRuntime),
        ).rejects.toThrow('installed runtime bundle file is stale or untrusted');

        const replacedPlist = await fixture();
        await installSmartOrderLaunchAgent(replacedPlist);
        await writeFile(replacedPlist.targetPath, '<plist>replaced</plist>\n', {
            mode: 0o600,
        });
        await expect(
            verifySmartOrderLaunchAgent(replacedPlist),
        ).rejects.toThrow('installed sidecar LaunchAgent is stale or untrusted');
    });

    it('rejects installed bundle tamper, extra files, and symlinked source modules', async () => {
        const tampered = await fixture();
        const installed = await installSmartOrderLaunchAgent(tampered);
        const bundleRoot = path.join(
            tampered.appSupportRoot,
            'bin',
            'smart-order-runtime-bundles',
            installed.installedBundleSha256.slice('sha256:'.length),
        );
        await writeFile(
            path.join(
                bundleRoot,
                'scripts',
                'smart-order-runtime',
                'sidecar-entry.mjs',
            ),
            'export const sidecar = false;\n',
            { mode: 0o600 },
        );
        await expect(verifySmartOrderLaunchAgent(tampered)).rejects.toThrow(
            'installed runtime bundle file is stale or untrusted',
        );

        const extra = await fixture();
        const extraInstalled = await installSmartOrderLaunchAgent(extra);
        const extraBundleRoot = path.join(
            extra.appSupportRoot,
            'bin',
            'smart-order-runtime-bundles',
            extraInstalled.installedBundleSha256.slice('sha256:'.length),
        );
        await writeFile(path.join(extraBundleRoot, 'unexpected.mjs'), 'unexpected\n', {
            mode: 0o600,
        });
        await expect(verifySmartOrderLaunchAgent(extra)).rejects.toThrow(
            'installed runtime bundle file set is stale or untrusted',
        );

        const linked = await fixture();
        const entry = path.join(
            linked.repositoryRoot,
            'scripts',
            'smart-order-runtime',
            'sidecar-entry.mjs',
        );
        const realEntry = `${entry}.real`;
        await writeFile(realEntry, 'export const sidecar = true;\n', { mode: 0o644 });
        await rm(entry);
        await symlink(realEntry, entry);
        await expect(installSmartOrderLaunchAgent(linked)).rejects.toThrow(
            'runtime bundle source contains a symlink',
        );
    });

    it('installs an importable production bundle whose plist never references Documents source', async () => {
        const raw = await mkdtemp(path.join(tmpdir(), 'smart-order-production-bundle-'));
        temporaryDirectories.push(raw);
        const root = await realpath(raw);
        const repositoryRoot = await realpath(
            fileURLToPath(new URL('../../', import.meta.url)),
        );
        const homeRoot = path.join(root, 'home');
        const appSupportRoot = path.join(root, 'app-support');
        const launchAgents = path.join(homeRoot, 'Library', 'LaunchAgents');
        const sourceRuntimePath = path.join(
            repositoryRoot,
            'scripts',
            'realtimestock-runtime',
        );
        const installedRuntimePath = path.join(
            appSupportRoot,
            'bin',
            'realtimestock-runtime',
        );
        const targetPath = path.join(
            launchAgents,
            'com.alanyi.realtimestock.smart-order-sidecar.plist',
        );
        await mkdir(path.dirname(installedRuntimePath), {
            recursive: true,
            mode: 0o700,
        });
        await mkdir(launchAgents, { recursive: true });
        await chmod(homeRoot, 0o700);
        await chmod(appSupportRoot, 0o700);
        await chmod(path.dirname(installedRuntimePath), 0o755);
        await chmod(launchAgents, 0o755);
        await writeFile(
            installedRuntimePath,
            await readFile(sourceRuntimePath),
            { mode: 0o700 },
        );
        const result = await installSmartOrderLaunchAgent({
            targetPath,
            installedRuntimePath,
            sourceRuntimePath,
            repositoryRoot,
            homeRoot,
            appSupportRoot,
            readPlatformSupport: async () => ({
                supportPolicy:
                    'smart-order-trading-runtime-platform/native-apple-silicon-arm64/2026-08-22.1',
            }),
        });
        const bundleRoot = path.join(
            appSupportRoot,
            'bin',
            'smart-order-runtime-bundles',
            result.installedBundleSha256.slice('sha256:'.length),
        );
        const installedEntry = path.join(
            bundleRoot,
            'scripts',
            'smart-order-runtime',
            'sidecar-entry.mjs',
        );
        const installedModule = await import(
            `${pathToFileURL(installedEntry).href}?bundle=${Date.now()}`
        );
        expect(installedModule.SMART_ORDER_SIDECAR_ENTRY_SCHEMA_VERSION).toMatch(
            /^smart-order-sidecar-entry\//,
        );
        const installedBindingModule = await import(
            `${pathToFileURL(
                path.join(
                    bundleRoot,
                    'scripts',
                    'smart-order-runtime',
                    'installed-managed-api-binding.mjs',
                ),
            ).href}?bundle=${Date.now()}`
        );
        expect(
            installedBindingModule.resolveExpectedManagedApiRepositoryRoot(),
        ).toBe(repositoryRoot);
        const installedRuntimeController = await import(
            `${pathToFileURL(
                path.join(
                    bundleRoot,
                    'scripts',
                    'smart-order-runtime',
                    'runtime-controller.mjs',
                ),
            ).href}?bundle=${Date.now()}`
        );
        expect(
            installedRuntimeController.SMART_ORDER_MANAGED_API_REPOSITORY_ROOT,
        ).toBe(repositoryRoot);
        const plist = await readFile(targetPath, 'utf8');
        expect(plist).toContain(bundleRoot);
        expect(plist).not.toContain(repositoryRoot);
    });
});
