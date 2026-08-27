import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
    closeSync,
    fstatSync,
    lstatSync,
    openSync,
    readFileSync,
    realpathSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './canonical-json.mjs';

const CURRENT_FILE = fileURLToPath(import.meta.url);
const RUNTIME_DIRECTORY = path.dirname(CURRENT_FILE);
const SCRIPTS_DIRECTORY = path.dirname(RUNTIME_DIRECTORY);

export const SMART_ORDER_NODE_SQLITE_TRUST_MANIFEST_SCHEMA_VERSION =
    'smart-order-node-sqlite-arm64-trust/2026-08-22.3';

export const SMART_ORDER_NODE_SQLITE_SOURCE_PATHS = Object.freeze({
    adminSha256: path.join(
        SCRIPTS_DIRECTORY,
        'smart-order-node-sqlite-capability-admin.mjs',
    ),
    attestationSha256: path.join(
        RUNTIME_DIRECTORY,
        'node-sqlite-capability-host-attestation.mjs',
    ),
    backupVerifierSha256: path.join(RUNTIME_DIRECTORY, 'repository-backup.mjs'),
    canonicalJsonSha256: path.join(RUNTIME_DIRECTORY, 'canonical-json.mjs'),
    capabilityStateSha256: CURRENT_FILE,
    gateRunnerSha256: path.join(
        SCRIPTS_DIRECTORY,
        'smart-order-readonly-gate-runner.mjs',
    ),
    launcherSha256: path.join(
        SCRIPTS_DIRECTORY,
        'smart-order-node-sqlite-capability-launcher.mjs',
    ),
    privateStorageSha256: path.join(RUNTIME_DIRECTORY, 'private-storage.mjs'),
    repositoryClientSha256: path.join(RUNTIME_DIRECTORY, 'repository-client.mjs'),
    repositoryWorkerSha256: path.join(RUNTIME_DIRECTORY, 'repository-worker.mjs'),
    runtimeControllerSha256: path.join(RUNTIME_DIRECTORY, 'runtime-controller.mjs'),
    runtimeScriptSha256: path.join(SCRIPTS_DIRECTORY, 'realtimestock-runtime'),
    sidecarEntrySha256: path.join(RUNTIME_DIRECTORY, 'sidecar-entry.mjs'),
    platformPolicySha256: path.join(
        RUNTIME_DIRECTORY,
        'trading-runtime-platform-support.mjs',
    ),
    sourceSha256: path.join(
        SCRIPTS_DIRECTORY,
        'smart-order-node-sqlite-capability-probe.mjs',
    ),
    verifierSha256: path.join(RUNTIME_DIRECTORY, 'gate-evidence-verifier.mjs'),
});

export const SMART_ORDER_NODE_SQLITE_FINGERPRINT_KEYS = Object.freeze(
    Object.keys(SMART_ORDER_NODE_SQLITE_SOURCE_PATHS),
);

function sha256Hex(value) {
    return createHash('sha256').update(value).digest('hex');
}

export function currentSmartOrderNodeSqliteCapabilityFingerprintsSync() {
    return Object.freeze(
        Object.fromEntries(
            Object.entries(SMART_ORDER_NODE_SQLITE_SOURCE_PATHS).map(
                ([key, sourcePath]) => [
                    key,
                    sha256Hex(readFileSync(path.resolve(sourcePath))),
                ],
            ),
        ),
    );
}

export async function currentSmartOrderNodeSqliteCapabilityFingerprints() {
    return currentSmartOrderNodeSqliteCapabilityFingerprintsSync();
}

export function smartOrderNodeSqliteSourceMatrixSha256(fingerprints) {
    if (
        !fingerprints ||
        typeof fingerprints !== 'object' ||
        Array.isArray(fingerprints) ||
        canonicalJson(Object.keys(fingerprints).sort()) !==
            canonicalJson([...SMART_ORDER_NODE_SQLITE_FINGERPRINT_KEYS].sort()) ||
        SMART_ORDER_NODE_SQLITE_FINGERPRINT_KEYS.some(
            (key) => !/^[a-f0-9]{64}$/.test(fingerprints[key] ?? ''),
        )
    ) {
        throw new TypeError('Node SQLite source fingerprint matrix is invalid');
    }
    return `sha256:${sha256Hex(canonicalJson(fingerprints))}`;
}

function exactKeys(value, keys) {
    return (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
    );
}

function readCurrentUserPrivateBytesSync(filePath, maximumBytes) {
    const descriptor = openSync(
        filePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    let metadata;
    let bytes;
    try {
        metadata = fstatSync(descriptor);
        if (
            !metadata.isFile() ||
            metadata.size < 2 ||
            metadata.size > maximumBytes ||
            (metadata.mode & 0o777) !== 0o600 ||
            (typeof process.getuid === 'function' &&
                metadata.uid !== process.getuid())
        ) {
            throw new Error('Node SQLite trust manifest is not private');
        }
        bytes = readFileSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
    const current = lstatSync(filePath);
    if (
        current.isSymbolicLink() ||
        current.dev !== metadata.dev ||
        current.ino !== metadata.ino ||
        current.size !== metadata.size ||
        current.mtimeMs !== metadata.mtimeMs
    ) {
        bytes?.fill(0);
        throw new Error('Node SQLite trust manifest changed while reading');
    }
    return bytes;
}

export function readCurrentSmartOrderNodeSqliteTrustStateSync(appSupportRoot) {
    if (typeof appSupportRoot !== 'string' || !path.isAbsolute(appSupportRoot)) {
        throw new TypeError('appSupportRoot must be an explicit absolute path');
    }
    const resolvedRoot = path.resolve(appSupportRoot);
    if (realpathSync(resolvedRoot) !== resolvedRoot) {
        throw new Error('appSupportRoot must be a canonical realpath');
    }
    const rootMetadata = lstatSync(resolvedRoot);
    if (
        rootMetadata.isSymbolicLink() ||
        !rootMetadata.isDirectory() ||
        (rootMetadata.mode & 0o777) !== 0o700 ||
        (typeof process.getuid === 'function' &&
            rootMetadata.uid !== process.getuid())
    ) {
        throw new Error('appSupportRoot must be current-user private');
    }
    const manifestPath = path.join(
        resolvedRoot,
        'smart-order',
        'evidence',
        'node-sqlite-capability-arm64-v2',
        'trusted-hosts.json',
    );
    const bytes = readCurrentUserPrivateBytesSync(manifestPath, 64 * 1024);
    try {
        const text = bytes.toString('utf8');
        if (!text.endsWith('\n') || text.includes('\u0000')) {
            throw new Error('Node SQLite trust manifest encoding is invalid');
        }
        const manifest = JSON.parse(text);
        if (
            !exactKeys(manifest, [
                'generation',
                'host',
                'reportBinding',
                'schemaVersion',
            ]) ||
            manifest.schemaVersion !==
                SMART_ORDER_NODE_SQLITE_TRUST_MANIFEST_SCHEMA_VERSION ||
            !Number.isSafeInteger(manifest.generation) ||
            manifest.generation < 1 ||
            !exactKeys(manifest.host, [
                'architecture',
                'hostKeyId',
                'publicKeySpkiBase64',
            ]) ||
            manifest.host.architecture !== 'arm64' ||
            !/^sha256:[a-f0-9]{64}$/.test(manifest.host.hostKeyId ?? '') ||
            !/^[A-Za-z0-9+/]+={0,2}$/.test(
                manifest.host.publicKeySpkiBase64 ?? '',
            ) ||
            !exactKeys(manifest.reportBinding, ['resultHash', 'runId']) ||
            !/^[a-f0-9]{64}$/.test(manifest.reportBinding.resultHash ?? '') ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                manifest.reportBinding.runId ?? '',
            )
        ) {
            throw new Error('Node SQLite trust manifest is invalid');
        }
        const reportPath = path.join(
            resolvedRoot,
            'smart-order',
            'evidence',
            'node-sqlite-capability-arm64-v2',
            'arm64.report.json',
        );
        const reportBytes = readCurrentUserPrivateBytesSync(
            reportPath,
            128 * 1024,
        );
        let reportSha256;
        try {
            const reportText = reportBytes.toString('utf8');
            if (!reportText.endsWith('\n') || reportText.includes('\u0000')) {
                throw new Error('Node SQLite arm64 report encoding is invalid');
            }
            const report = JSON.parse(reportText);
            if (
                report?.platform?.hardwareArch !== 'arm64' ||
                report.runId !== manifest.reportBinding.runId ||
                report.resultHash !== manifest.reportBinding.resultHash
            ) {
                throw new Error(
                    'Node SQLite arm64 report does not match trusted lineage',
                );
            }
            reportSha256 = `sha256:${sha256Hex(canonicalJson(report))}`;
        } finally {
            reportBytes.fill(0);
        }
        return Object.freeze({
            generation: manifest.generation,
            hostKeyIds: Object.freeze([manifest.host.hostKeyId]),
            manifestSha256: `sha256:${sha256Hex(canonicalJson(manifest))}`,
            reportSha256,
            reportResultHash: manifest.reportBinding.resultHash,
            reportRunId: manifest.reportBinding.runId,
        });
    } finally {
        bytes.fill(0);
    }
}

export function currentSmartOrderNodeSqliteCapabilityAuthorityStateSync(
    appSupportRoot,
) {
    const fingerprints =
        currentSmartOrderNodeSqliteCapabilityFingerprintsSync();
    const sourceMatrixSha256 =
        smartOrderNodeSqliteSourceMatrixSha256(fingerprints);
    const trust = readCurrentSmartOrderNodeSqliteTrustStateSync(appSupportRoot);
    const authoritySha256 = `sha256:${sha256Hex(
        canonicalJson({
            sourceMatrixSha256,
            trustGeneration: trust.generation,
            trustManifestSha256: trust.manifestSha256,
            trustedHostKeyIds: trust.hostKeyIds,
            trustedReportSha256: trust.reportSha256,
            trustedReportResultHash: trust.reportResultHash,
            trustedReportRunId: trust.reportRunId,
        }),
    )}`;
    return Object.freeze({
        authoritySha256,
        fingerprints,
        sourceMatrixSha256,
        trustGeneration: trust.generation,
        trustManifestSha256: trust.manifestSha256,
        trustedHostKeyIds: trust.hostKeyIds,
        trustedReportSha256: trust.reportSha256,
        trustedReportResultHash: trust.reportResultHash,
        trustedReportRunId: trust.reportRunId,
    });
}
