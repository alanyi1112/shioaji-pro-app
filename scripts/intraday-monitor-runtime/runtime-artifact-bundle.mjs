import { createHash, randomUUID } from 'node:crypto';
import {
    access,
    mkdir,
    lstat,
    readFile,
    rename,
    rm,
    writeFile,
} from 'node:fs/promises';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const INTRADAY_MONITOR_RUNTIME_ARTIFACT_BUNDLE_SCHEMA =
    'intraday-monitor-runtime-artifact-bundle/1';
const HASH = /^[a-f0-9]{64}$/;
const ROLE = /^[a-z][a-z0-9_-]{0,63}$/;

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort()
        .map((key) => [key, stableValue(value[key])]));
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function manifestHash(value) {
    return sha256(JSON.stringify(stableValue(value)));
}

export function resolveIntradayMonitorRuntimeArtifactRoot(appSupportRoot) {
    if (typeof appSupportRoot !== 'string' || !path.isAbsolute(appSupportRoot)) {
        throw new TypeError('application support root is invalid');
    }
    return path.join(appSupportRoot, 'IntradayMonitor', 'runtime-artifacts');
}

function safeSourceIdentity(sourcePath, repoDirectory, role) {
    const relative = path.relative(repoDirectory, sourcePath);
    return !relative.startsWith('..') && !path.isAbsolute(relative)
        ? relative
        : `external:${role}`;
}

async function readArtifact(input, repoDirectory) {
    if (!input || !ROLE.test(input.role ?? '') || typeof input.path !== 'string' ||
        !path.isAbsolute(input.path) || typeof input.schema !== 'string' ||
        input.schema.length < 1 || input.schema.length > 160 ||
        !Array.isArray(input.dependencies) || input.dependencies.some((value) => !ROLE.test(value))) {
        throw new TypeError('runtime artifact input is invalid');
    }
    const status = await lstat(input.path);
    if (!status.isFile() || status.isSymbolicLink()) {
        throw new Error('runtime_artifact_source_invalid');
    }
    const bytes = await readFile(input.path);
    let parsed;
    try { parsed = JSON.parse(bytes.toString('utf8')); }
    catch { throw new Error('runtime_artifact_schema_invalid'); }
    const actualSchema = parsed?.schemaVersion ?? 'legacy-unversioned-json';
    if (actualSchema !== input.schema) throw new Error('runtime_artifact_schema_invalid');
    return {
        role: input.role,
        source: safeSourceIdentity(input.path, repoDirectory, input.role),
        schema: input.schema,
        dependencies: [...input.dependencies].sort(),
        sha256: sha256(bytes),
        bytes: bytes.length,
        content: bytes,
    };
}

function validateManifest(value) {
    const roles = value?.artifacts?.map((item) => item.role) ?? [];
    return Boolean(value?.schemaVersion === INTRADAY_MONITOR_RUNTIME_ARTIFACT_BUNDLE_SCHEMA &&
        HASH.test(value.bundleHash ?? '') && typeof value.sourceIdentity === 'string' &&
        value.sourceIdentity.length >= 1 && value.sourceIdentity.length <= 256 &&
        Number.isFinite(Date.parse(value.createdAt ?? '')) && Array.isArray(value.artifacts) &&
        value.artifacts.length >= 1 && new Set(roles).size === roles.length &&
        value.artifacts.every((item) => ROLE.test(item?.role ?? '') &&
            typeof item.source === 'string' && item.source.length >= 1 && item.source.length <= 512 &&
            typeof item.schema === 'string' && item.schema.length >= 1 && item.schema.length <= 160 &&
            Array.isArray(item.dependencies) && item.dependencies.every((role) => ROLE.test(role)) &&
            HASH.test(item.sha256 ?? '') && Number.isSafeInteger(item.bytes) && item.bytes >= 0 &&
            item.file === `${item.role}.json`));
}

function identityFromManifest(value) {
    return {
        schemaVersion: value.schemaVersion,
        sourceIdentity: value.sourceIdentity,
        artifacts: value.artifacts.map(({ role, source, schema, dependencies, sha256: hash, bytes, file }) =>
            ({ role, source, schema, dependencies, sha256: hash, bytes, file })),
    };
}

export async function resolveIntradayMonitorRuntimeArtifactBundle({
    appSupportRoot,
    bundleHash,
} = {}) {
    if (!HASH.test(bundleHash ?? '')) throw new TypeError('runtime artifact bundle hash is invalid');
    const bundleDirectory = path.join(resolveIntradayMonitorRuntimeArtifactRoot(appSupportRoot), bundleHash);
    let manifest;
    try { manifest = JSON.parse(await readFile(path.join(bundleDirectory, 'manifest.json'), 'utf8')); }
    catch { return { valid: false, reason: 'artifact_bundle_missing', bundleHash, bundleDirectory }; }
    if (!validateManifest(manifest) || manifest.bundleHash !== bundleHash ||
        manifestHash(identityFromManifest(manifest)) !== bundleHash) {
        return { valid: false, reason: 'artifact_bundle_manifest_invalid', bundleHash, bundleDirectory };
    }
    const files = {};
    for (const artifact of manifest.artifacts) {
        const artifactPath = path.join(bundleDirectory, artifact.file);
        try {
            const status = await lstat(artifactPath);
            if (!status.isFile() || status.isSymbolicLink()) throw new Error('invalid');
            const content = await readFile(artifactPath);
            if (content.length !== artifact.bytes || sha256(content) !== artifact.sha256) {
                return { valid: false, reason: 'artifact_bundle_hash_mismatch', bundleHash,
                    bundleDirectory, role: artifact.role };
            }
            files[artifact.role] = artifactPath;
        } catch {
            return { valid: false, reason: 'artifact_bundle_file_invalid', bundleHash,
                bundleDirectory, role: artifact.role };
        }
    }
    return Object.freeze({ valid: true, reason: null, bundleHash, bundleDirectory,
        manifest: Object.freeze(manifest), files: Object.freeze(files) });
}

export function resolveIntradayMonitorRuntimeArtifactBundleSync({
    appSupportRoot,
    bundleHash,
} = {}) {
    if (!HASH.test(bundleHash ?? '')) throw new TypeError('runtime artifact bundle hash is invalid');
    const bundleDirectory = path.join(resolveIntradayMonitorRuntimeArtifactRoot(appSupportRoot), bundleHash);
    let manifest;
    try { manifest = JSON.parse(readFileSync(path.join(bundleDirectory, 'manifest.json'), 'utf8')); }
    catch { return { valid: false, reason: 'artifact_bundle_missing', bundleHash, bundleDirectory }; }
    if (!validateManifest(manifest) || manifest.bundleHash !== bundleHash ||
        manifestHash(identityFromManifest(manifest)) !== bundleHash) {
        return { valid: false, reason: 'artifact_bundle_manifest_invalid', bundleHash, bundleDirectory };
    }
    const files = {};
    for (const artifact of manifest.artifacts) {
        const artifactPath = path.join(bundleDirectory, artifact.file);
        try {
            const status = lstatSync(artifactPath);
            if (!status.isFile() || status.isSymbolicLink()) throw new Error('invalid');
            const content = readFileSync(artifactPath);
            if (content.length !== artifact.bytes || sha256(content) !== artifact.sha256) {
                return { valid: false, reason: 'artifact_bundle_hash_mismatch', bundleHash,
                    bundleDirectory, role: artifact.role };
            }
            files[artifact.role] = artifactPath;
        } catch {
            return { valid: false, reason: 'artifact_bundle_file_invalid', bundleHash,
                bundleDirectory, role: artifact.role };
        }
    }
    return Object.freeze({ valid: true, reason: null, bundleHash, bundleDirectory,
        manifest: Object.freeze(manifest), files: Object.freeze(files) });
}

export async function importIntradayMonitorRuntimeArtifactBundle({
    appSupportRoot,
    repoDirectory,
    sourceIdentity,
    artifacts,
    createdAt = new Date().toISOString(),
    beforePublish = null,
} = {}) {
    if (typeof repoDirectory !== 'string' || !path.isAbsolute(repoDirectory) ||
        typeof sourceIdentity !== 'string' || sourceIdentity.length < 1 || sourceIdentity.length > 256 ||
        !Array.isArray(artifacts) || artifacts.length < 1 || !Number.isFinite(Date.parse(createdAt))) {
        throw new TypeError('runtime artifact bundle input is invalid');
    }
    const loaded = await Promise.all(artifacts.map((item) => readArtifact(item, repoDirectory)));
    if (new Set(loaded.map((item) => item.role)).size !== loaded.length) {
        throw new TypeError('runtime artifact roles must be unique');
    }
    const identity = {
        schemaVersion: INTRADAY_MONITOR_RUNTIME_ARTIFACT_BUNDLE_SCHEMA,
        sourceIdentity,
        artifacts: loaded.map(({ content: _content, ...item }) => ({ ...item, file: `${item.role}.json` }))
            .sort((left, right) => left.role.localeCompare(right.role)),
    };
    const bundleHash = manifestHash(identity);
    const root = resolveIntradayMonitorRuntimeArtifactRoot(appSupportRoot);
    const bundleDirectory = path.join(root, bundleHash);
    const existing = await resolveIntradayMonitorRuntimeArtifactBundle({ appSupportRoot, bundleHash });
    if (existing.valid) return existing;
    await mkdir(root, { recursive: true, mode: 0o700 });
    const temporary = path.join(root, `.${bundleHash}.${process.pid}.${randomUUID()}.tmp`);
    await mkdir(temporary, { mode: 0o700 });
    try {
        for (const artifact of loaded) {
            await writeFile(path.join(temporary, `${artifact.role}.json`), artifact.content,
                { mode: 0o600, flag: 'wx' });
        }
        const manifest = { ...identity, bundleHash, createdAt };
        await writeFile(path.join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`,
            { mode: 0o600, flag: 'wx' });
        if (typeof beforePublish === 'function') await beforePublish({ temporary, bundleHash });
        await rename(temporary, bundleDirectory).catch(async (error) => {
            if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error;
        });
    } catch (error) {
        await rm(temporary, { recursive: true, force: true });
        throw error;
    }
    await rm(temporary, { recursive: true, force: true });
    await access(bundleDirectory);
    const resolved = await resolveIntradayMonitorRuntimeArtifactBundle({ appSupportRoot, bundleHash });
    if (!resolved.valid) throw new Error(resolved.reason);
    return resolved;
}

export const intradayMonitorRuntimeArtifactBundleInternals = Object.freeze({
    manifestHash,
});
