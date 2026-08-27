#!/usr/bin/env node

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
    chmod,
    lstat,
    mkdir,
    open,
    readdir,
    realpath,
    rename,
    rm,
    unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSmartOrderTradingRuntimePlatformSupport } from './trading-runtime-platform-support.mjs';

export const SMART_ORDER_LAUNCH_AGENT_INSTALLER_SCHEMA_VERSION =
    'smart-order-launchagent-installer/2026-08-22.3';

const LABEL = 'com.alanyi.realtimestock.smart-order-sidecar';
const MAX_RUNTIME_BYTES = 512 * 1024;
const MAX_BUNDLE_FILES = 4_096;
const MAX_BUNDLE_FILE_BYTES = 16 * 1024 * 1024;
const MAX_BUNDLE_TOTAL_BYTES = 96 * 1024 * 1024;
const BUNDLE_DIRECTORY_NAME = 'smart-order-runtime-bundles';
const BUNDLE_MANIFEST_NAME = 'bundle-manifest.json';
const MANAGED_API_BINDING_NAME = 'managed-api-binding.json';
const BUNDLE_MANIFEST_SCHEMA_VERSION =
    'smart-order-installed-runtime-bundle/2026-08-22.1';
const MANAGED_API_BINDING_SCHEMA_VERSION =
    'smart-order-managed-api-install-binding/2026-08-22.1';
const TOP_LEVEL_BUNDLE_FILES = Object.freeze([
    'SHIOAJI_VERSION',
    'scripts/realtimestock-runtime',
    'scripts/smart-order-contract-probe.mjs',
    'scripts/smart-order-readonly-gate-runner.mjs',
]);

function sha256(bytes) {
    return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function xml(value) {
    if (
        typeof value !== 'string' ||
        value.length < 1 ||
        value.length > 4096 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    ) {
        throw new TypeError('LaunchAgent value is invalid');
    }
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

async function canonicalDirectory(directoryPath, label, { privateMode = false } = {}) {
    if (typeof directoryPath !== 'string' || !path.isAbsolute(directoryPath)) {
        throw new TypeError(`${label} must be absolute`);
    }
    const canonical = await realpath(directoryPath);
    const metadata = await lstat(canonical);
    if (
        canonical !== directoryPath ||
        metadata.isSymbolicLink() ||
        !metadata.isDirectory() ||
        (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) ||
        (metadata.mode & (privateMode ? 0o077 : 0o022)) !== 0
    ) {
        throw new Error(`${label} is not a canonical current-user directory`);
    }
    return canonical;
}

async function readStableRuntime(filePath, label, { installed }) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
        throw new TypeError(`${label} must be absolute`);
    }
    if ((await realpath(filePath)) !== filePath) {
        throw new Error(`${label} must be a canonical realpath`);
    }
    const handle = await open(
        filePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
        const before = await handle.stat();
        if (
            !before.isFile() ||
            before.size < 1 ||
            before.size > MAX_RUNTIME_BYTES ||
            (typeof process.getuid === 'function' && before.uid !== process.getuid()) ||
            (installed
                ? (before.mode & 0o777) !== 0o700
                : (before.mode & 0o022) !== 0)
        ) {
            throw new Error(`${label} metadata is invalid`);
        }
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (
            after.dev !== before.dev ||
            after.ino !== before.ino ||
            after.size !== before.size ||
            after.mtimeMs !== before.mtimeMs
        ) {
            bytes.fill(0);
            throw new Error(`${label} changed while reading`);
        }
        return bytes;
    } finally {
        await handle.close();
    }
}

async function readStablePrivateArtifact(filePath, label, maximumBytes) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
        throw new TypeError(`${label} must be absolute`);
    }
    const handle = await open(
        filePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
        const before = await handle.stat();
        if (
            !before.isFile() ||
            before.size < 1 ||
            before.size > maximumBytes ||
            (before.mode & 0o777) !== 0o600 ||
            (typeof process.getuid === 'function' && before.uid !== process.getuid())
        ) {
            throw new Error(`${label} metadata is invalid`);
        }
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (
            after.dev !== before.dev ||
            after.ino !== before.ino ||
            after.size !== before.size ||
            after.mtimeMs !== before.mtimeMs
        ) {
            bytes.fill(0);
            throw new Error(`${label} changed while reading`);
        }
        return bytes;
    } finally {
        await handle.close();
    }
}

function safeRelativeBundlePath(value) {
    if (
        typeof value !== 'string' ||
        value.length < 1 ||
        value.length > 4_096 ||
        path.posix.isAbsolute(value) ||
        value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    ) {
        throw new TypeError('runtime bundle path is invalid');
    }
    return value;
}

async function readStableBundleSource(filePath, relativePath) {
    safeRelativeBundlePath(relativePath);
    if ((await realpath(filePath)) !== filePath) {
        throw new Error(`runtime bundle source is not canonical: ${relativePath}`);
    }
    const handle = await open(
        filePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
        const before = await handle.stat();
        if (
            !before.isFile() ||
            before.size < 1 ||
            before.size > MAX_BUNDLE_FILE_BYTES ||
            (typeof process.getuid === 'function' && before.uid !== process.getuid()) ||
            (before.mode & 0o022) !== 0
        ) {
            throw new Error(`runtime bundle source metadata is invalid: ${relativePath}`);
        }
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (
            after.dev !== before.dev ||
            after.ino !== before.ino ||
            after.size !== before.size ||
            after.mtimeMs !== before.mtimeMs
        ) {
            bytes.fill(0);
            throw new Error(`runtime bundle source changed while reading: ${relativePath}`);
        }
        return Object.freeze({
            relativePath,
            bytes,
            size: bytes.byteLength,
            sha256: sha256(bytes),
        });
    } finally {
        await handle.close();
    }
}

function generatedBundleFile(relativePath, bytes) {
    safeRelativeBundlePath(relativePath);
    if (!Buffer.isBuffer(bytes) || bytes.byteLength < 1 || bytes.byteLength > MAX_BUNDLE_FILE_BYTES) {
        throw new TypeError(`generated runtime bundle file is invalid: ${relativePath}`);
    }
    return Object.freeze({
        relativePath,
        bytes,
        size: bytes.byteLength,
        sha256: sha256(bytes),
    });
}

async function collectDirectoryBundleFiles({
    canonicalRepository,
    relativeDirectory,
    includeFile,
}) {
    const root = path.join(canonicalRepository, relativeDirectory);
    if ((await realpath(root)) !== root) {
        throw new Error(`runtime bundle directory is not canonical: ${relativeDirectory}`);
    }
    const files = [];
    async function visit(absoluteDirectory, relativeParent) {
        const directoryMetadata = await lstat(absoluteDirectory);
        if (
            directoryMetadata.isSymbolicLink() ||
            !directoryMetadata.isDirectory() ||
            (typeof process.getuid === 'function' &&
                directoryMetadata.uid !== process.getuid()) ||
            (directoryMetadata.mode & 0o022) !== 0
        ) {
            throw new Error(`runtime bundle directory metadata is invalid: ${relativeParent}`);
        }
        const entries = await readdir(absoluteDirectory, { withFileTypes: true });
        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const relativePath = path.posix.join(relativeParent, entry.name);
            const absolutePath = path.join(absoluteDirectory, entry.name);
            if (entry.isSymbolicLink()) {
                throw new Error(`runtime bundle source contains a symlink: ${relativePath}`);
            }
            if (entry.isDirectory()) {
                await visit(absolutePath, relativePath);
                continue;
            }
            if (!entry.isFile()) {
                throw new Error(`runtime bundle source contains a special file: ${relativePath}`);
            }
            if (includeFile(relativePath)) {
                files.push(await readStableBundleSource(absolutePath, relativePath));
                if (files.length > MAX_BUNDLE_FILES) {
                    throw new Error('runtime bundle has too many files');
                }
            }
        }
    }
    await visit(root, relativeDirectory);
    return files;
}

async function collectSourceBundle(canonicalRepository) {
    const files = [];
    files.push(
        generatedBundleFile(
            MANAGED_API_BINDING_NAME,
            Buffer.from(
                `${JSON.stringify({
                    schemaVersion: MANAGED_API_BINDING_SCHEMA_VERSION,
                    expectedRepositoryRoot: canonicalRepository,
                })}\n`,
                'utf8',
            ),
        ),
    );
    for (const relativePath of TOP_LEVEL_BUNDLE_FILES) {
        files.push(
            await readStableBundleSource(
                path.join(canonicalRepository, relativePath),
                relativePath,
            ),
        );
    }
    files.push(
        ...(await collectDirectoryBundleFiles({
            canonicalRepository,
            relativeDirectory: 'scripts/smart-order-runtime',
            includeFile(relativePath) {
                const name = path.posix.basename(relativePath);
                return (
                    name.endsWith('.mjs') &&
                    !name.endsWith('.test.mjs') &&
                    !name.endsWith('.vitest.mjs') &&
                    name !== 'canonical-strategy-draft-fixtures.mjs'
                );
            },
        })),
    );
    files.push(
        ...(await collectDirectoryBundleFiles({
            canonicalRepository,
            relativeDirectory: 'dist',
            includeFile() {
                return true;
            },
        })),
    );
    files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (
        files.length < TOP_LEVEL_BUNDLE_FILES.length + 2 ||
        files.length > MAX_BUNDLE_FILES ||
        totalBytes > MAX_BUNDLE_TOTAL_BYTES
    ) {
        throw new Error('runtime bundle source set is incomplete or oversized');
    }
    const manifest = Object.freeze({
        schemaVersion: BUNDLE_MANIFEST_SCHEMA_VERSION,
        files: files.map(({ relativePath, size, sha256: digest }) =>
            Object.freeze({ path: relativePath, size, sha256: digest }),
        ),
    });
    const bundleSha256 = sha256(Buffer.from(JSON.stringify(manifest), 'utf8'));
    const manifestBytes = Buffer.from(
        `${JSON.stringify({ ...manifest, bundleSha256 })}\n`,
        'utf8',
    );
    return Object.freeze({ bundleSha256, files, manifestBytes, totalBytes });
}

function installedBundlePath(canonicalAppSupport, bundleSha256) {
    const digest = bundleSha256.replace(/^sha256:/, '');
    if (!/^[0-9a-f]{64}$/.test(digest)) {
        throw new TypeError('runtime bundle digest is invalid');
    }
    return path.join(
        canonicalAppSupport,
        'bin',
        BUNDLE_DIRECTORY_NAME,
        digest,
    );
}

async function ensurePrivateDirectory(directoryPath, label) {
    try {
        await mkdir(directoryPath, { mode: 0o700 });
    } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
    }
    const handle = await open(
        directoryPath,
        fsConstants.O_RDONLY |
            fsConstants.O_DIRECTORY |
            fsConstants.O_NOFOLLOW,
    );
    try {
        const before = await handle.stat();
        if (
            !before.isDirectory() ||
            (before.mode & 0o022) !== 0 ||
            (typeof process.getuid === 'function' && before.uid !== process.getuid())
        ) {
            throw new Error(`${label} is not a safe current-user directory`);
        }
        await handle.chmod(0o700);
        const after = await handle.stat();
        if (
            !after.isDirectory() ||
            after.dev !== before.dev ||
            after.ino !== before.ino ||
            (after.mode & 0o777) !== 0o700 ||
            (typeof process.getuid === 'function' && after.uid !== process.getuid())
        ) {
            throw new Error(`${label} did not become a private directory`);
        }
    } finally {
        await handle.close();
    }
    return canonicalDirectory(directoryPath, label, { privateMode: true });
}

async function writePrivateBundleFile(filePath, bytes, mode = 0o600) {
    if (![0o600, 0o700].includes(mode)) {
        throw new TypeError('installed runtime bundle file mode is invalid');
    }
    const handle = await open(
        filePath,
        fsConstants.O_WRONLY |
            fsConstants.O_CREAT |
            fsConstants.O_EXCL |
            fsConstants.O_NOFOLLOW,
        mode,
    );
    try {
        await handle.writeFile(bytes);
        await handle.chmod(mode);
        await handle.sync();
        const metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            metadata.size !== bytes.byteLength ||
            (metadata.mode & 0o777) !== mode ||
            (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
        ) {
            throw new Error('installed runtime bundle file metadata is invalid');
        }
    } finally {
        await handle.close();
    }
}

async function verifyInstalledBundle(bundleRoot, sourceBundle) {
    await canonicalDirectory(bundleRoot, 'installed runtime bundle', {
        privateMode: true,
    });
    const expectedPaths = new Set([
        ...sourceBundle.files.map((file) => file.relativePath),
        BUNDLE_MANIFEST_NAME,
    ]);
    const observedPaths = new Set();
    async function visit(absoluteDirectory, relativeParent = '') {
        const entries = await readdir(absoluteDirectory, { withFileTypes: true });
        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const relativePath = path.posix.join(relativeParent, entry.name);
            const absolutePath = path.join(absoluteDirectory, entry.name);
            if (entry.isSymbolicLink()) {
                throw new Error(`installed runtime bundle contains a symlink: ${relativePath}`);
            }
            const metadata = await lstat(absolutePath);
            if (entry.isDirectory()) {
                if (
                    !metadata.isDirectory() ||
                    (metadata.mode & 0o777) !== 0o700 ||
                    (typeof process.getuid === 'function' &&
                        metadata.uid !== process.getuid())
                ) {
                    throw new Error(`installed runtime bundle directory is unsafe: ${relativePath}`);
                }
                await visit(absolutePath, relativePath);
                continue;
            }
            if (
                !entry.isFile() ||
                !metadata.isFile() ||
                (metadata.mode & 0o777) !==
                    (relativePath === 'scripts/realtimestock-runtime'
                        ? 0o700
                        : 0o600) ||
                (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
            ) {
                throw new Error(`installed runtime bundle file is unsafe: ${relativePath}`);
            }
            observedPaths.add(relativePath);
        }
    }
    await visit(bundleRoot);
    if (
        observedPaths.size !== expectedPaths.size ||
        [...expectedPaths].some((relativePath) => !observedPaths.has(relativePath))
    ) {
        throw new Error('installed runtime bundle file set is stale or untrusted');
    }
    for (const source of sourceBundle.files) {
        const installedBytes =
            source.relativePath === 'scripts/realtimestock-runtime'
                ? await readStableRuntime(
                      path.join(bundleRoot, source.relativePath),
                      'installed sidecar runtime',
                      { installed: true },
                  )
                : await readStablePrivateArtifact(
                      path.join(bundleRoot, source.relativePath),
                      `installed runtime bundle file ${source.relativePath}`,
                      MAX_BUNDLE_FILE_BYTES,
                  );
        try {
            if (
                installedBytes.byteLength !== source.bytes.byteLength ||
                !timingSafeEqual(installedBytes, source.bytes)
            ) {
                throw new Error(
                    `installed runtime bundle file is stale or untrusted: ${source.relativePath}`,
                );
            }
        } finally {
            installedBytes.fill(0);
        }
    }
    const manifestBytes = await readStablePrivateArtifact(
        path.join(bundleRoot, BUNDLE_MANIFEST_NAME),
        'installed runtime bundle manifest',
        MAX_BUNDLE_FILE_BYTES,
    );
    try {
        if (
            manifestBytes.byteLength !== sourceBundle.manifestBytes.byteLength ||
            !timingSafeEqual(manifestBytes, sourceBundle.manifestBytes)
        ) {
            throw new Error('installed runtime bundle manifest is stale or untrusted');
        }
    } finally {
        manifestBytes.fill(0);
    }
}

async function installSourceBundle(canonicalRepository, canonicalAppSupport) {
    const sourceBundle = await collectSourceBundle(canonicalRepository);
    let installedRoot;
    let temporaryRoot;
    try {
        const binDirectory = await ensurePrivateDirectory(
            path.join(canonicalAppSupport, 'bin'),
            'installed runtime bin directory',
        );
        const bundleParent = await ensurePrivateDirectory(
            path.join(binDirectory, BUNDLE_DIRECTORY_NAME),
            'installed runtime bundle parent',
        );
        installedRoot = installedBundlePath(
            canonicalAppSupport,
            sourceBundle.bundleSha256,
        );
        try {
            await lstat(installedRoot);
            await verifyInstalledBundle(installedRoot, sourceBundle);
            return Object.freeze({ installedRoot, sourceBundle });
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
        temporaryRoot = path.join(
            bundleParent,
            `.${sourceBundle.bundleSha256.slice(7)}.${randomUUID()}.tmp`,
        );
        await mkdir(temporaryRoot, { mode: 0o700 });
        await chmod(temporaryRoot, 0o700);
        for (const source of sourceBundle.files) {
            const target = path.join(temporaryRoot, source.relativePath);
            const targetParent = path.dirname(target);
            await mkdir(targetParent, { recursive: true, mode: 0o700 });
            let current = targetParent;
            while (current !== temporaryRoot) {
                await chmod(current, 0o700);
                current = path.dirname(current);
            }
            await writePrivateBundleFile(
                target,
                source.bytes,
                source.relativePath === 'scripts/realtimestock-runtime'
                    ? 0o700
                    : 0o600,
            );
        }
        await writePrivateBundleFile(
            path.join(temporaryRoot, BUNDLE_MANIFEST_NAME),
            sourceBundle.manifestBytes,
        );
        await verifyInstalledBundle(temporaryRoot, sourceBundle);
        try {
            await rename(temporaryRoot, installedRoot);
            temporaryRoot = undefined;
        } catch (error) {
            if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') {
                throw error;
            }
            await rm(temporaryRoot, { recursive: true, force: true });
            temporaryRoot = undefined;
        }
        await verifyInstalledBundle(installedRoot, sourceBundle);
        return Object.freeze({ installedRoot, sourceBundle });
    } catch (error) {
        for (const file of sourceBundle.files) file.bytes.fill(0);
        sourceBundle.manifestBytes.fill(0);
        throw error;
    } finally {
        if (temporaryRoot) {
            await rm(temporaryRoot, { recursive: true, force: true });
        }
    }
}

function wipeSourceBundle(sourceBundle) {
    for (const file of sourceBundle.files) file.bytes.fill(0);
    sourceBundle.manifestBytes.fill(0);
}

function launchAgentBytes({
    installedRuntimePath,
    installedBundleRoot,
    homeRoot,
    appSupportRoot,
}) {
    return Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
            `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
            `<plist version="1.0"><dict>\n` +
            `<key>Label</key><string>${LABEL}</string>\n` +
            `<key>ProgramArguments</key><array><string>${xml(installedRuntimePath)}</string><string>service-smart-order-sidecar</string></array>\n` +
            `<key>WorkingDirectory</key><string>${xml(installedBundleRoot)}</string>\n` +
            `<key>EnvironmentVariables</key><dict>\n` +
            `<key>HOME</key><string>${xml(homeRoot)}</string>\n` +
            `<key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string>\n` +
            `<key>REALTIME_STOCK_REPO_DIR</key><string>${xml(installedBundleRoot)}</string>\n` +
            `<key>REALTIME_STOCK_APP_SUPPORT</key><string>${xml(appSupportRoot)}</string>\n` +
            `</dict>\n` +
            `<key>RunAtLoad</key><true/>\n` +
            `<key>KeepAlive</key><true/>\n` +
            `<key>ThrottleInterval</key><integer>10</integer>\n` +
            `<key>StandardOutPath</key><string>/dev/null</string>\n` +
            `<key>StandardErrorPath</key><string>/dev/null</string>\n` +
            `</dict></plist>\n`,
        'utf8',
    );
}

async function existingTargetIsReplaceable(targetPath) {
    try {
        const metadata = await lstat(targetPath);
        if (
            metadata.isSymbolicLink() ||
            !metadata.isFile() ||
            (metadata.mode & 0o777) !== 0o600 ||
            (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
        ) {
            throw new Error('existing sidecar LaunchAgent target is unsafe');
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

async function canonicalInputs({
    targetPath,
    repositoryRoot,
    homeRoot,
    appSupportRoot,
}) {
    const canonicalRepository = await canonicalDirectory(
        repositoryRoot,
        'repository root',
    );
    const canonicalHome = await canonicalDirectory(homeRoot, 'home root');
    const canonicalAppSupport = await canonicalDirectory(
        appSupportRoot,
        'app support root',
        { privateMode: true },
    );
    const launchAgentsDirectory = path.join(
        canonicalHome,
        'Library',
        'LaunchAgents',
    );
    await canonicalDirectory(launchAgentsDirectory, 'LaunchAgents directory');
    const expectedTarget = path.join(launchAgentsDirectory, `${LABEL}.plist`);
    if (targetPath !== expectedTarget) {
        throw new Error('sidecar LaunchAgent target is not canonical');
    }
    return Object.freeze({
        canonicalRepository,
        canonicalHome,
        canonicalAppSupport,
        launchAgentsDirectory,
    });
}

export async function verifySmartOrderLaunchAgent({
    targetPath,
    installedRuntimePath,
    sourceRuntimePath,
    repositoryRoot,
    homeRoot,
    appSupportRoot,
    readPlatformSupport = readSmartOrderTradingRuntimePlatformSupport,
}) {
    const platform = await readPlatformSupport();
    const {
        canonicalRepository,
        canonicalHome,
        canonicalAppSupport,
    } = await canonicalInputs({
        targetPath,
        repositoryRoot,
        homeRoot,
        appSupportRoot,
    });
    const sourceBundle = await collectSourceBundle(canonicalRepository);
    const installedBundleRoot = installedBundlePath(
        canonicalAppSupport,
        sourceBundle.bundleSha256,
    );
    const bundledRuntimePath = path.join(
        installedBundleRoot,
        'scripts',
        'realtimestock-runtime',
    );
    let installedBytes;
    let sourceBytes;
    let actualPlistBytes;
    let expectedPlistBytes;
    try {
        await verifyInstalledBundle(installedBundleRoot, sourceBundle);
        [installedBytes, sourceBytes, actualPlistBytes] = await Promise.all([
            readStableRuntime(bundledRuntimePath, 'installed sidecar runtime', {
                installed: true,
            }),
            readStableRuntime(sourceRuntimePath, 'source runtime', {
                installed: false,
            }),
            readStablePrivateArtifact(targetPath, 'sidecar LaunchAgent', 64 * 1024),
        ]);
        expectedPlistBytes = launchAgentBytes({
            installedRuntimePath: bundledRuntimePath,
            installedBundleRoot,
            homeRoot: canonicalHome,
            appSupportRoot: canonicalAppSupport,
        });
        if (
            installedBytes.byteLength !== sourceBytes.byteLength ||
            !timingSafeEqual(installedBytes, sourceBytes)
        ) {
            throw new Error('installed runtime is stale or untrusted');
        }
        if (
            actualPlistBytes.byteLength !== expectedPlistBytes.byteLength ||
            !timingSafeEqual(actualPlistBytes, expectedPlistBytes)
        ) {
            throw new Error('installed sidecar LaunchAgent is stale or untrusted');
        }
        return Object.freeze({
            schemaVersion:
                SMART_ORDER_LAUNCH_AGENT_INSTALLER_SCHEMA_VERSION,
            verified: true,
            installedRuntimeSha256: sha256(installedBytes),
            installedBundleSha256: sourceBundle.bundleSha256,
            launchAgentPlistSha256: sha256(actualPlistBytes),
            platformSupportPolicy: platform.supportPolicy,
            brokerAuthority: false,
            writeMasterAuthority: false,
        });
    } finally {
        installedBytes?.fill(0);
        sourceBytes?.fill(0);
        actualPlistBytes?.fill(0);
        expectedPlistBytes?.fill(0);
        wipeSourceBundle(sourceBundle);
    }
}

export async function installSmartOrderLaunchAgent({
    targetPath,
    installedRuntimePath,
    sourceRuntimePath,
    repositoryRoot,
    homeRoot,
    appSupportRoot,
    readPlatformSupport = readSmartOrderTradingRuntimePlatformSupport,
}) {
    const platform = await readPlatformSupport();
    const {
        canonicalRepository,
        canonicalHome,
        canonicalAppSupport,
        launchAgentsDirectory,
    } = await canonicalInputs({
        targetPath,
        repositoryRoot,
        homeRoot,
        appSupportRoot,
    });

    {
        await existingTargetIsReplaceable(targetPath);
        const bundleInstallation = await installSourceBundle(
            canonicalRepository,
            canonicalAppSupport,
        );
        const { installedRoot: installedBundleRoot, sourceBundle } =
            bundleInstallation;
        const bundledRuntimePath = path.join(
            installedBundleRoot,
            'scripts',
            'realtimestock-runtime',
        );
        const plistBytes = launchAgentBytes({
            installedRuntimePath: bundledRuntimePath,
            installedBundleRoot,
            homeRoot: canonicalHome,
            appSupportRoot: canonicalAppSupport,
        });
        const temporaryPath = path.join(
            launchAgentsDirectory,
            `.${LABEL}.${randomUUID()}.tmp`,
        );
        let handle;
        let renamed = false;
        try {
            handle = await open(
                temporaryPath,
                fsConstants.O_WRONLY |
                    fsConstants.O_CREAT |
                    fsConstants.O_EXCL |
                    fsConstants.O_NOFOLLOW,
                0o600,
            );
            await handle.writeFile(plistBytes);
            await handle.chmod(0o600);
            await handle.sync();
            const written = await handle.stat();
            if (
                !written.isFile() ||
                written.size !== plistBytes.byteLength ||
                (written.mode & 0o777) !== 0o600 ||
                (typeof process.getuid === 'function' &&
                    written.uid !== process.getuid())
            ) {
                throw new Error('temporary LaunchAgent artifact is invalid');
            }
            await existingTargetIsReplaceable(targetPath);
            await rename(temporaryPath, targetPath);
            renamed = true;
            const [finalMetadata, finalParent] = await Promise.all([
                lstat(targetPath),
                realpath(launchAgentsDirectory),
            ]);
            if (
                finalParent !== launchAgentsDirectory ||
                finalMetadata.isSymbolicLink() ||
                !finalMetadata.isFile() ||
                finalMetadata.dev !== written.dev ||
                finalMetadata.ino !== written.ino ||
                finalMetadata.size !== written.size ||
                (finalMetadata.mode & 0o777) !== 0o600
            ) {
                throw new Error('installed LaunchAgent artifact binding is invalid');
            }
            const verified = await verifySmartOrderLaunchAgent({
                targetPath,
                installedRuntimePath,
                sourceRuntimePath,
                repositoryRoot,
                homeRoot,
                appSupportRoot,
                readPlatformSupport: async () => platform,
            });
            if (
                verified.installedRuntimeSha256 !==
                    sourceBundle.files.find(
                        (file) =>
                            file.relativePath ===
                            'scripts/realtimestock-runtime',
                    )?.sha256 ||
                verified.installedBundleSha256 !== sourceBundle.bundleSha256 ||
                verified.launchAgentPlistSha256 !== sha256(plistBytes)
            ) {
                throw new Error(
                    'LaunchAgent binding changed after atomic installation',
                );
            }
            return Object.freeze({
                schemaVersion:
                    SMART_ORDER_LAUNCH_AGENT_INSTALLER_SCHEMA_VERSION,
                installed: true,
                installedRuntimeSha256:
                    verified.installedRuntimeSha256,
                installedBundleSha256: sourceBundle.bundleSha256,
                launchAgentPlistSha256: sha256(plistBytes),
                platformSupportPolicy: platform.supportPolicy,
                brokerAuthority: false,
                writeMasterAuthority: false,
            });
        } finally {
            plistBytes.fill(0);
            await handle?.close();
            if (!renamed) {
                await unlink(temporaryPath).catch((error) => {
                    if (error?.code !== 'ENOENT') throw error;
                });
            }
            wipeSourceBundle(sourceBundle);
        }
    }
}

async function main() {
    const args = process.argv.slice(2);
    const verifyOnly = args[0] === '--verify';
    const [
        targetPath,
        installedRuntimePath,
        sourceRuntimePath,
        repositoryRoot,
        homeRoot,
        appSupportRoot,
    ] = verifyOnly ? args.slice(1) : args;
    if (
        (!verifyOnly && process.argv.length !== 8) ||
        (verifyOnly && process.argv.length !== 9)
    ) {
        throw new TypeError(
            'usage: launchagent-installer.mjs [--verify] <target> <installed-runtime> <source-runtime> <repository-root> <home-root> <app-support-root>',
        );
    }
    const operation = {
        targetPath,
        installedRuntimePath,
        sourceRuntimePath,
        repositoryRoot,
        homeRoot,
        appSupportRoot,
    };
    const result = verifyOnly
        ? await verifySmartOrderLaunchAgent(operation)
        : await installSmartOrderLaunchAgent(operation);
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    main().catch((error) => {
        process.stderr.write(
            `smart_order_launchagent_install=unavailable:${error?.name ?? 'Error'}\n`,
        );
        process.exitCode = 1;
    });
}
