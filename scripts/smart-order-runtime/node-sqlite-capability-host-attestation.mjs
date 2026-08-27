import {
    createHash,
    createPrivateKey,
    createPublicKey,
    generateKeyPairSync,
    sign,
} from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
    chmod,
    link,
    lstat,
    mkdir,
    open,
    realpath,
    rename,
    unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from './canonical-json.mjs';
import {
    SMART_ORDER_NODE_SQLITE_TRUST_MANIFEST_SCHEMA_VERSION,
    smartOrderNodeSqliteAttestationPayload,
} from './gate-evidence-verifier.mjs';

export const SMART_ORDER_NODE_SQLITE_HOST_KEY_SCHEMA_VERSION =
    'smart-order-node-sqlite-arm64-host-key/2026-08-22.2';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

async function assertPrivateDirectory(directoryPath) {
    const metadata = await lstat(directoryPath);
    if (
        metadata.isSymbolicLink() ||
        !metadata.isDirectory() ||
        (metadata.mode & 0o777) !== PRIVATE_DIRECTORY_MODE ||
        (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
    ) {
        throw new Error('host attestation directory is not current-user private');
    }
    return realpath(directoryPath);
}

async function ensurePrivateDirectory(directoryPath) {
    await mkdir(directoryPath, {
        recursive: true,
        mode: PRIVATE_DIRECTORY_MODE,
    });
    await chmod(directoryPath, PRIVATE_DIRECTORY_MODE);
    return assertPrivateDirectory(directoryPath);
}

async function readPrivateFile(filePath, maximumBytes) {
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
            (metadata.mode & 0o777) !== PRIVATE_FILE_MODE ||
            (typeof process.getuid === 'function' &&
                metadata.uid !== process.getuid())
        ) {
            throw new Error('host attestation file is not current-user private');
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
        throw new Error('host attestation file changed while reading');
    }
    return bytes;
}

async function writePrivateFileAtomically(filePath, bytes, { exclusive = false } = {}) {
    const parent = await assertPrivateDirectory(path.dirname(filePath));
    const destination = path.join(parent, path.basename(filePath));
    const pending = path.join(
        parent,
        `.${path.basename(filePath)}.pending-${process.pid}-${Date.now()}`,
    );
    let handle;
    try {
        handle = await open(
            pending,
            fsConstants.O_WRONLY |
                fsConstants.O_CREAT |
                fsConstants.O_EXCL |
                fsConstants.O_NOFOLLOW,
            PRIVATE_FILE_MODE,
        );
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close();
        handle = undefined;
        if (exclusive) {
            await link(pending, destination);
            await unlink(pending);
        } else {
            await rename(pending, destination);
        }
        const directoryHandle = await open(parent, fsConstants.O_RDONLY);
        try {
            await directoryHandle.sync();
        } finally {
            await directoryHandle.close();
        }
    } catch (error) {
        await handle?.close().catch(() => {});
        await unlink(pending).catch(() => {});
        throw error;
    }
}

export async function nodeSqliteCapabilityEvidenceDirectory(appSupportRoot) {
    if (typeof appSupportRoot !== 'string' || !path.isAbsolute(appSupportRoot)) {
        throw new TypeError('appSupportRoot must be an explicit absolute path');
    }
    const root = await assertPrivateDirectory(appSupportRoot);
    if (root !== path.resolve(appSupportRoot)) {
        throw new Error('appSupportRoot must be a canonical realpath');
    }
    const smartOrder = await ensurePrivateDirectory(path.join(root, 'smart-order'));
    const evidence = await ensurePrivateDirectory(path.join(smartOrder, 'evidence'));
    return ensurePrivateDirectory(
        path.join(evidence, 'node-sqlite-capability-arm64-v2'),
    );
}

function publicIdentity(publicKey) {
    const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
    return Object.freeze({
        hostKeyId: `sha256:${sha256(publicKeyDer)}`,
        publicKeySpkiBase64: publicKeyDer.toString('base64'),
    });
}

export async function ensureNodeSqliteCapabilityHostSigningIdentity({
    appSupportRoot,
    architecture,
}) {
    if (architecture !== 'arm64') {
        throw new TypeError('host signing requires native Apple Silicon arm64');
    }
    const directory = await nodeSqliteCapabilityEvidenceDirectory(appSupportRoot);
    const privateKeyPath = path.join(
        directory,
        'arm64-host-attestation-private-key-v2.der',
    );
    const publicRecordPath = path.join(
        directory,
        'arm64-host-attestation-public-v2.json',
    );
    let privateKey;
    try {
        const privateKeyPem = await readPrivateFile(privateKeyPath, 4_096);
        try {
            privateKey = createPrivateKey({
                key: privateKeyPem,
                format: 'der',
                type: 'pkcs8',
            });
        } finally {
            privateKeyPem.fill(0);
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        const generated = generateKeyPairSync('ed25519');
        const privateKeyPem = generated.privateKey.export({
            format: 'der',
            type: 'pkcs8',
        });
        try {
            await writePrivateFileAtomically(privateKeyPath, privateKeyPem, {
                exclusive: true,
            });
        } finally {
            privateKeyPem.fill(0);
        }
        privateKey = generated.privateKey;
    }
    if (privateKey.asymmetricKeyType !== 'ed25519') {
        throw new Error('host attestation private key must be Ed25519');
    }
    const identity = publicIdentity(createPublicKey(privateKey));
    const publicRecord = Object.freeze({
        schemaVersion: SMART_ORDER_NODE_SQLITE_HOST_KEY_SCHEMA_VERSION,
        architecture,
        ...identity,
    });
    let existing;
    try {
        const bytes = await readPrivateFile(publicRecordPath, 8_192);
        try {
            existing = JSON.parse(bytes.toString('utf8'));
        } finally {
            bytes.fill(0);
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    if (existing && canonicalJson(existing) !== canonicalJson(publicRecord)) {
        throw new Error('host attestation public record does not match private key');
    }
    if (!existing) {
        await writePrivateFileAtomically(
            publicRecordPath,
            `${canonicalJson(publicRecord)}\n`,
            { exclusive: true },
        );
    }
    return Object.freeze({
        architecture,
        privateKey,
        publicRecord,
        evidenceDirectory: directory,
    });
}

export async function signAndStoreNodeSqliteCapabilityReport({
    appSupportRoot,
    report,
}) {
    const architecture = report?.platform?.hardwareArch;
    const identity = await ensureNodeSqliteCapabilityHostSigningIdentity({
        appSupportRoot,
        architecture,
    });
    const candidate = {
        ...report,
        attestation: {
            algorithm: 'ed25519',
            hostKeyId: identity.publicRecord.hostKeyId,
            payloadSha256: '',
            signatureBase64Url: '',
        },
        resultHash: '',
    };
    const payload = smartOrderNodeSqliteAttestationPayload(candidate);
    candidate.attestation.payloadSha256 = `sha256:${sha256(payload)}`;
    candidate.attestation.signatureBase64Url = sign(
        null,
        Buffer.from(payload, 'utf8'),
        identity.privateKey,
    ).toString('base64url');
    candidate.resultHash = sha256(
        canonicalJson({ ...candidate, resultHash: '' }),
    );
    const signedReport = Object.freeze(candidate);
    await writePrivateFileAtomically(
        path.join(identity.evidenceDirectory, `${architecture}.report.json`),
        `${canonicalJson(signedReport)}\n`,
    );
    return Object.freeze({
        report: signedReport,
        publicRecord: identity.publicRecord,
        secretValuesExposed: false,
    });
}

export async function writeNodeSqliteCapabilityTrustedHost({
    appSupportRoot,
    host,
    report,
}) {
    if (
        !host ||
        host.schemaVersion !== SMART_ORDER_NODE_SQLITE_HOST_KEY_SCHEMA_VERSION ||
        host.architecture !== 'arm64' ||
        !/^sha256:[a-f0-9]{64}$/.test(host.hostKeyId ?? '') ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(host.publicKeySpkiBase64 ?? '')
    ) {
        throw new TypeError('trusted Apple Silicon host public record is invalid');
    }
    const key = Buffer.from(host.publicKeySpkiBase64, 'base64');
    if (`sha256:${sha256(key)}` !== host.hostKeyId) {
        key.fill(0);
        throw new Error('trusted host public key identity is invalid');
    }
    key.fill(0);
    if (
        !report ||
        report.platform?.hardwareArch !== 'arm64' ||
        report.attestation?.hostKeyId !== host.hostKeyId ||
        !/^[a-f0-9]{64}$/.test(report.resultHash ?? '') ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            report.runId ?? '',
        )
    ) {
        throw new TypeError('trusted arm64 report binding is invalid');
    }
    const canonicalHost = Object.freeze({
        architecture: 'arm64',
        hostKeyId: host.hostKeyId,
        publicKeySpkiBase64: host.publicKeySpkiBase64,
    });
    const directory = await nodeSqliteCapabilityEvidenceDirectory(appSupportRoot);
    const manifestPath = path.join(directory, 'trusted-hosts.json');
    const lockPath = path.join(directory, 'trusted-hosts.enrollment.lock');
    let lockHandle;
    try {
        lockHandle = await open(
            lockPath,
            fsConstants.O_WRONLY |
                fsConstants.O_CREAT |
                fsConstants.O_EXCL |
                fsConstants.O_NOFOLLOW,
            PRIVATE_FILE_MODE,
        );
        await lockHandle.sync();
        let currentGeneration = 0;
        try {
            const currentBytes = await readPrivateFile(manifestPath, 64 * 1024);
            try {
                const current = JSON.parse(currentBytes.toString('utf8'));
                if (
                    current.schemaVersion !==
                        SMART_ORDER_NODE_SQLITE_TRUST_MANIFEST_SCHEMA_VERSION ||
                    !Number.isSafeInteger(current.generation) ||
                    current.generation < 1
                ) {
                    throw new Error('existing trusted host generation is invalid');
                }
                currentGeneration = current.generation;
            } finally {
                currentBytes.fill(0);
            }
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
        if (currentGeneration >= Number.MAX_SAFE_INTEGER) {
            throw new Error('trusted host generation is exhausted');
        }
        const manifest = Object.freeze({
            schemaVersion: SMART_ORDER_NODE_SQLITE_TRUST_MANIFEST_SCHEMA_VERSION,
            generation: currentGeneration + 1,
            host: canonicalHost,
            reportBinding: Object.freeze({
                resultHash: report.resultHash,
                runId: report.runId,
            }),
        });
        await writePrivateFileAtomically(
            manifestPath,
            `${canonicalJson(manifest)}\n`,
        );
        return Object.freeze({
            written: true,
            generation: manifest.generation,
            manifestSha256: `sha256:${sha256(canonicalJson(manifest))}`,
            hostKeyIds: Object.freeze([canonicalHost.hostKeyId]),
            reportResultHash: report.resultHash,
            reportRunId: report.runId,
            secretValuesExposed: false,
        });
    } finally {
        if (lockHandle) {
            await lockHandle.close().catch(() => {});
            await unlink(lockPath).catch(() => {});
        }
    }
}

export async function importNodeSqliteCapabilityReport({
    appSupportRoot,
    architecture,
    report,
}) {
    if (
        architecture !== 'arm64' ||
        !report ||
        typeof report !== 'object' ||
        Array.isArray(report) ||
        report.platform?.hardwareArch !== 'arm64' ||
        report.evidenceClass !== 'node_sqlite_arm64_platform_capability' ||
        report.executionMode !== 'managed-local-capability'
    ) {
        throw new TypeError('imported capability report identity is invalid');
    }
    const serialized = canonicalJson(report, { maximumBytes: 128 * 1024 });
    const directory = await nodeSqliteCapabilityEvidenceDirectory(appSupportRoot);
    await writePrivateFileAtomically(
        path.join(directory, `${architecture}.report.json`),
        `${serialized}\n`,
    );
    return Object.freeze({
        imported: true,
        architecture,
        resultHash:
            typeof report.resultHash === 'string' ? report.resultHash : 'invalid',
        secretValuesExposed: false,
    });
}
