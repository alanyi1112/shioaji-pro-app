import { createHash, timingSafeEqual } from 'node:crypto';
import { closeSync, constants as fsConstants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SMART_ORDER_MANAGED_API_INSTALL_BINDING_SCHEMA_VERSION =
    'smart-order-managed-api-install-binding/2026-08-22.1';

const BUNDLE_MANIFEST_SCHEMA_VERSION =
    'smart-order-installed-runtime-bundle/2026-08-22.1';
const BUNDLE_DIRECTORY_NAME = 'smart-order-runtime-bundles';
const BUNDLE_MANIFEST_NAME = 'bundle-manifest.json';
const MANAGED_API_BINDING_NAME = 'managed-api-binding.json';
const MAX_PRIVATE_ARTIFACT_BYTES = 16 * 1024 * 1024;

function sha256(bytes) {
    return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function readStablePrivateFile(filePath, label) {
    const descriptor = openSync(
        filePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
        const before = fstatSync(descriptor);
        if (
            !before.isFile() ||
            before.size < 1 ||
            before.size > MAX_PRIVATE_ARTIFACT_BYTES ||
            (before.mode & 0o777) !== 0o600 ||
            (typeof process.getuid === 'function' && before.uid !== process.getuid())
        ) {
            throw new Error(`${label} metadata is invalid`);
        }
        const bytes = readFileSync(descriptor);
        const after = fstatSync(descriptor);
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
        closeSync(descriptor);
    }
}

function parseExactObject(bytes, label, expectedKeys) {
    let value;
    try {
        value = JSON.parse(bytes.toString('utf8'));
    } catch {
        throw new Error(`${label} is not valid JSON`);
    }
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).sort().join('\u0000') !== [...expectedKeys].sort().join('\u0000')
    ) {
        throw new Error(`${label} shape is invalid`);
    }
    return value;
}

function assertInstalledBundleRoot(bundleRoot, bundleSha256) {
    const digest = bundleSha256.replace(/^sha256:/, '');
    if (
        !/^[0-9a-f]{64}$/.test(digest) ||
        path.basename(bundleRoot) !== digest ||
        path.basename(path.dirname(bundleRoot)) !== BUNDLE_DIRECTORY_NAME ||
        realpathSync(bundleRoot) !== bundleRoot
    ) {
        throw new Error('installed runtime bundle identity is invalid');
    }
}

export function resolveExpectedManagedApiRepositoryRoot() {
    const runtimeRoot = path.resolve(
        fileURLToPath(new URL('../../', import.meta.url)),
    );
    const manifestPath = path.join(runtimeRoot, BUNDLE_MANIFEST_NAME);
    let manifestBytes;
    try {
        manifestBytes = readStablePrivateFile(
            manifestPath,
            'installed runtime bundle manifest',
        );
    } catch (error) {
        if (error?.code === 'ENOENT') return runtimeRoot;
        throw error;
    }
    let bindingBytes;
    try {
        const manifest = parseExactObject(
            manifestBytes,
            'installed runtime bundle manifest',
            ['schemaVersion', 'files', 'bundleSha256'],
        );
        if (
            manifest.schemaVersion !== BUNDLE_MANIFEST_SCHEMA_VERSION ||
            !Array.isArray(manifest.files) ||
            manifest.files.length < 1
        ) {
            throw new Error('installed runtime bundle manifest contract is invalid');
        }
        const unsignedManifest = {
            schemaVersion: manifest.schemaVersion,
            files: manifest.files,
        };
        if (
            manifest.bundleSha256 !==
            sha256(Buffer.from(JSON.stringify(unsignedManifest), 'utf8'))
        ) {
            throw new Error('installed runtime bundle manifest digest is invalid');
        }
        assertInstalledBundleRoot(runtimeRoot, manifest.bundleSha256);
        const bindingEntries = manifest.files.filter(
            (entry) => entry?.path === MANAGED_API_BINDING_NAME,
        );
        if (
            bindingEntries.length !== 1 ||
            Object.keys(bindingEntries[0]).sort().join('\u0000') !==
                ['path', 'size', 'sha256'].sort().join('\u0000') ||
            !Number.isSafeInteger(bindingEntries[0].size) ||
            bindingEntries[0].size < 1 ||
            bindingEntries[0].size > MAX_PRIVATE_ARTIFACT_BYTES ||
            !/^sha256:[0-9a-f]{64}$/.test(bindingEntries[0].sha256)
        ) {
            throw new Error('managed API install binding manifest entry is invalid');
        }
        bindingBytes = readStablePrivateFile(
            path.join(runtimeRoot, MANAGED_API_BINDING_NAME),
            'managed API install binding',
        );
        const observedDigest = Buffer.from(bindingEntries[0].sha256, 'utf8');
        const expectedDigest = Buffer.from(sha256(bindingBytes), 'utf8');
        if (
            bindingBytes.byteLength !== bindingEntries[0].size ||
            observedDigest.byteLength !== expectedDigest.byteLength ||
            !timingSafeEqual(observedDigest, expectedDigest)
        ) {
            throw new Error('managed API install binding digest is invalid');
        }
        const binding = parseExactObject(
            bindingBytes,
            'managed API install binding',
            ['schemaVersion', 'expectedRepositoryRoot'],
        );
        if (
            binding.schemaVersion !==
                SMART_ORDER_MANAGED_API_INSTALL_BINDING_SCHEMA_VERSION ||
            typeof binding.expectedRepositoryRoot !== 'string' ||
            !path.isAbsolute(binding.expectedRepositoryRoot) ||
            path.resolve(binding.expectedRepositoryRoot) !==
                binding.expectedRepositoryRoot ||
            binding.expectedRepositoryRoot === path.parse(binding.expectedRepositoryRoot).root
        ) {
            throw new Error('managed API install binding contract is invalid');
        }
        return binding.expectedRepositoryRoot;
    } finally {
        manifestBytes.fill(0);
        bindingBytes?.fill(0);
    }
}
