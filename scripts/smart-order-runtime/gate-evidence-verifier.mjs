import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from './canonical-json.mjs';
import {
    SMART_ORDER_NODE_SQLITE_FINGERPRINT_KEYS,
    SMART_ORDER_NODE_SQLITE_TRUST_MANIFEST_SCHEMA_VERSION,
    currentSmartOrderNodeSqliteCapabilityFingerprints,
    smartOrderNodeSqliteSourceMatrixSha256,
} from './node-sqlite-capability-current-state.mjs';
import {
    SMART_ORDER_TRADING_RUNTIME_PLATFORM_POLICY,
    readSmartOrderTradingRuntimePlatformSupport,
} from './trading-runtime-platform-support.mjs';

export {
    SMART_ORDER_NODE_SQLITE_TRUST_MANIFEST_SCHEMA_VERSION,
    currentSmartOrderNodeSqliteCapabilityFingerprints,
};

export const SMART_ORDER_GATE_EVIDENCE_VERIFIER_SCHEMA_VERSION =
    'smart-order-gate-evidence-verifier/2026-08-22.2';
export const SMART_ORDER_READONLY_PROBE_SCHEMA =
    'realtimestock.smart-order-readonly-contract-probe/v2';
export const SMART_ORDER_READONLY_PROBE_VERSION = '2026-08-22.1';
export const SMART_ORDER_SUBSCRIPTION_OWNERSHIP_SCHEMA =
    'realtimestock.smart-order-subscription-ownership/v1';
export const SMART_ORDER_SUBSCRIPTION_OWNERSHIP_VERSION = '2026-08-12.1';
export const SMART_ORDER_GATE_EVIDENCE_MAX_AGE_MS = 10 * 60 * 1000;
export const SMART_ORDER_NODE_SQLITE_CAPABILITY_SCHEMA =
    'realtimestock.smart-order-node-sqlite-arm64-capability/v2';
export const SMART_ORDER_NODE_SQLITE_CAPABILITY_VERSION = '2026-08-22.2';
export const SMART_ORDER_NODE_SQLITE_CAPABILITY_MAX_AGE_MS =
    24 * 60 * 60 * 1000;

export const SMART_ORDER_REQUIRED_NODE_SQLITE_CHECK_IDS = Object.freeze([
    'node-24-lts',
    'native-apple-silicon-arm64-host',
    'node-sqlite-import',
    'wal',
    'synchronous-full',
    'defensive-mode',
    'crash-durability',
    'backup-restore',
    'dedicated-worker-event-loop-isolation',
    'latency-watchdog-fail-closed',
    'launchagent-absolute-node-path',
    'source-fingerprint-stable',
]);

const NODE_SQLITE_REPORT_KEYS = Object.freeze([
    'attestation',
    'checks',
    'codeRevision',
    'evidenceClass',
    'executionMode',
    'fingerprint',
    'generatedAt',
    'operationClass',
    'overall',
    'platform',
    'redactionScan',
    'resultHash',
    'runId',
    'runtime',
    'schema',
    'sideEffects',
    'supportPolicy',
    'testOutcome',
    'version',
]);
const NODE_SQLITE_PLATFORM_KEYS = Object.freeze([
    'hardwareArch',
    'hypervisorPresent',
    'macosVersion',
    'nativeArchitecture',
    'operatingSystem',
    'processArch',
    'sysctlOptionalArm64',
    'unameMachine',
]);
const NODE_SQLITE_RUNTIME_KEYS = Object.freeze([
    'nodeLts',
    'nodeVersion',
    'sqliteVersion',
]);
const NODE_SQLITE_FINGERPRINT_KEYS =
    SMART_ORDER_NODE_SQLITE_FINGERPRINT_KEYS;
const NODE_SQLITE_SIDE_EFFECT_KEYS = Object.freeze([
    'brokerWritesAttempted',
    'brokerWritesNetworked',
    'serviceMutations',
]);
const NODE_SQLITE_ATTESTATION_KEYS = Object.freeze([
    'algorithm',
    'hostKeyId',
    'payloadSha256',
    'signatureBase64Url',
]);
const NODE_SQLITE_TRUST_MANIFEST_KEYS = Object.freeze([
    'generation',
    'host',
    'reportBinding',
    'schemaVersion',
]);
const NODE_SQLITE_TRUSTED_HOST_KEYS = Object.freeze([
    'architecture',
    'hostKeyId',
    'publicKeySpkiBase64',
]);
const NODE_SQLITE_REPORT_BINDING_KEYS = Object.freeze([
    'resultHash',
    'runId',
]);

export const SMART_ORDER_REQUIRED_READONLY_CHECK_IDS = Object.freeze([
    'mode-marker-before',
    'runtime-generation-evidence-before',
    'service-pid-before',
    'managed-runtime-binding-before',
    'api-simulation-before',
    'fixed-stock-account-selection',
    'trade-event-stream-ready',
    'trade-event-stream-reopened-after-subscription',
    'subscribe-request-account-bound',
    'trade-subscription-contract',
    'update-status-via-trades-capability',
    'update-status-via-trades-account-bound',
    'update-status-via-trades-account-scope',
    'trades-request-account-bound',
    'trades-account-scope',
    'positions-request-account-bound',
    'positions-response-shape',
    'positions-account-scope',
    'order-event-account',
    'api-fingerprint-after',
    'mode-marker-after',
    'runtime-generation-evidence-after',
    'service-pid-after',
    'managed-runtime-binding-after',
]);

const TOP_LEVEL_KEYS = Object.freeze([
    'accountIdentifiersPersisted',
    'checks',
    'codeRevision',
    'eligibleForGateManifest',
    'eligibleForTask0_3',
    'evidenceClass',
    'evidenceEligible',
    'executionMode',
    'fingerprint',
    'generatedAt',
    'managedRuntime',
    'mode',
    'network',
    'operationClass',
    'overall',
    'redactionScan',
    'requiredLiveChecksComplete',
    'resultHash',
    'runId',
    'schema',
    'selectedAccountRef',
    'sideEffects',
    'signedStockAccountCount',
    'testOutcome',
    'version',
]);
const NETWORK_KEYS = Object.freeze([
    'accountingReads',
    'brokerWritesAttempted',
    'brokerWritesNetworked',
    'observationControlMutations',
    'observationStreams',
    'requestCount',
    'subscriptionRequests',
    'subscriptionsCreatedOrConfirmed',
]);
const SIDE_EFFECT_KEYS = Object.freeze([
    'automaticRetries',
    'blindCleanupAttempts',
    'tradingWrites',
]);
const FINGERPRINT_KEYS = Object.freeze([
    'adapterSha256',
    'apiFingerprintStable',
    'appBuildSha256',
    'expectedShioajiVersion',
    'probeSourceSha256',
    'versionMatched',
]);
export const SMART_ORDER_REQUIRED_SUBSCRIPTION_CONSUMER_IDS = Object.freeze([
    '5173',
    '5174',
    'alerts',
    'charts',
    'external_clients',
    'smart_order_runtime',
    'watchlist',
]);
const SUBSCRIPTION_REPORT_KEYS = Object.freeze([
    'accountIdentifiersPersisted',
    'codeRevision',
    'consumers',
    'countingDimension',
    'evidenceClass',
    'executionMode',
    'fingerprint',
    'generatedAt',
    'overall',
    'pool',
    'resultHash',
    'runId',
    'schema',
    'testOutcome',
    'version',
]);
const SUBSCRIPTION_FINGERPRINT_KEYS = Object.freeze([
    'appBuildSha256',
    'shioajiCapabilitySha256',
]);
const SUBSCRIPTION_POOL_KEYS = Object.freeze([
    'localLimitUnits',
    'officialLimitUnits',
    'ownershipComplete',
    'reservedHeadroomUnits',
    'sharedPoolVerified',
    'totalUsageUnits',
    'usageComplete',
]);
const SUBSCRIPTION_CONSUMER_KEYS = Object.freeze([
    'consumerId',
    'usageKnown',
    'usageUnits',
    'visible',
]);
const verifiedGateEvidence = new WeakSet();

export function isVerifiedSmartOrderGateEvidence(value) {
    return Boolean(value && typeof value === 'object' && verifiedGateEvidence.has(value));
}

function exactKeys(value, keys) {
    return (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        canonicalJson(Object.keys(value).sort()) ===
            canonicalJson([...keys].sort())
    );
}

function safeCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function sha256Hex(value) {
    return createHash('sha256').update(value).digest('hex');
}

function reportHash(report) {
    return sha256Hex(canonicalJson({ ...report, resultHash: '' }));
}

export function smartOrderNodeSqliteAttestationPayload(report) {
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
        throw new TypeError('node:sqlite attestation report is invalid');
    }
    const { attestation: _attestation, resultHash: _resultHash, ...unsigned } =
        report;
    return canonicalJson(unsigned, { maximumBytes: 128 * 1024 });
}

async function readCurrentUserPrivateJson(filePath, maximumBytes) {
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
            metadata.size < 2 ||
            metadata.size > maximumBytes ||
            (metadata.mode & 0o777) !== 0o600 ||
            (typeof process.getuid === 'function' &&
                metadata.uid !== process.getuid())
        ) {
            throw new Error('capability evidence is not a private regular file');
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
        throw new Error('capability evidence changed while reading');
    }
    try {
        const text = bytes.toString('utf8');
        if (!text.endsWith('\n') || text.includes('\u0000')) {
            throw new Error('capability evidence encoding is invalid');
        }
        return JSON.parse(text);
    } finally {
        bytes.fill(0);
    }
}

async function loadNodeSqliteCapabilityEvidenceStore(appSupportRoot) {
    if (typeof appSupportRoot !== 'string' || !path.isAbsolute(appSupportRoot)) {
        throw new TypeError('appSupportRoot must be an explicit absolute path');
    }
    const root = await realpath(appSupportRoot);
    if (root !== path.resolve(appSupportRoot)) {
        throw new Error('appSupportRoot must be a canonical realpath');
    }
    const rootMetadata = await lstat(root);
    if (
        rootMetadata.isSymbolicLink() ||
        !rootMetadata.isDirectory() ||
        (rootMetadata.mode & 0o777) !== 0o700 ||
        (typeof process.getuid === 'function' &&
            rootMetadata.uid !== process.getuid())
    ) {
        throw new Error('appSupportRoot must be a current-user private directory');
    }
    const evidenceDirectory = path.join(
        root,
        'smart-order',
        'evidence',
        'node-sqlite-capability-arm64-v2',
    );
    const evidenceDirectoryRealpath = await realpath(evidenceDirectory);
    if (evidenceDirectoryRealpath !== evidenceDirectory) {
        throw new Error('capability evidence directory must be a canonical realpath');
    }
    for (const directoryPath of [
        path.join(root, 'smart-order'),
        path.join(root, 'smart-order', 'evidence'),
        evidenceDirectory,
    ]) {
        const metadata = await lstat(directoryPath);
        if (
            metadata.isSymbolicLink() ||
            !metadata.isDirectory() ||
            (metadata.mode & 0o777) !== 0o700 ||
            (typeof process.getuid === 'function' &&
                metadata.uid !== process.getuid())
        ) {
            throw new Error('capability evidence directory is not private');
        }
    }
    const trustManifest = await readCurrentUserPrivateJson(
        path.join(evidenceDirectory, 'trusted-hosts.json'),
        64 * 1024,
    );
    if (
        !exactKeys(trustManifest, NODE_SQLITE_TRUST_MANIFEST_KEYS) ||
        trustManifest.schemaVersion !==
            SMART_ORDER_NODE_SQLITE_TRUST_MANIFEST_SCHEMA_VERSION ||
        !Number.isSafeInteger(trustManifest.generation) ||
        trustManifest.generation < 1 ||
        !exactKeys(trustManifest.host, NODE_SQLITE_TRUSTED_HOST_KEYS) ||
        trustManifest.host.architecture !== 'arm64' ||
        !exactKeys(
            trustManifest.reportBinding,
            NODE_SQLITE_REPORT_BINDING_KEYS,
        ) ||
        !/^[a-f0-9]{64}$/.test(
            trustManifest.reportBinding.resultHash ?? '',
        ) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            trustManifest.reportBinding.runId ?? '',
        )
    ) {
        throw new Error('capability trusted-host manifest is invalid');
    }
    const host = trustManifest.host;
    const trustedHosts = new Map();
    if (
        !/^sha256:[a-f0-9]{64}$/.test(host.hostKeyId ?? '') ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(host.publicKeySpkiBase64 ?? '')
    ) {
        throw new Error('capability trusted-host entry is invalid');
    }
    const publicKeyDer = Buffer.from(host.publicKeySpkiBase64, 'base64');
    if (
        publicKeyDer.length < 32 ||
        publicKeyDer.length > 512 ||
        `sha256:${sha256Hex(publicKeyDer)}` !== host.hostKeyId
    ) {
        publicKeyDer.fill(0);
        throw new Error('capability trusted-host key identity is invalid');
    }
    const publicKey = createPublicKey({
        key: publicKeyDer,
        format: 'der',
        type: 'spki',
    });
    publicKeyDer.fill(0);
    if (publicKey.asymmetricKeyType !== 'ed25519') {
        throw new Error('capability trusted-host key must be Ed25519');
    }
    trustedHosts.set(
        'arm64',
        Object.freeze({ hostKeyId: host.hostKeyId, publicKey }),
    );
    const report = await readCurrentUserPrivateJson(
        path.join(evidenceDirectory, 'arm64.report.json'),
        128 * 1024,
    );
    return Object.freeze({
        report,
        reportBinding: Object.freeze({ ...trustManifest.reportBinding }),
        trustGeneration: trustManifest.generation,
        trustManifestSha256: `sha256:${sha256Hex(canonicalJson(trustManifest))}`,
        trustedHostKeyIds: Object.freeze([host.hostKeyId]),
        trustedHosts,
    });
}

function invalidEvidence(evidenceClass, reasons) {
    return Object.freeze({
        eligible: false,
        evidenceClass,
        reasons: Object.freeze([...reasons].sort()),
    });
}

function addReason(reasons, condition, reason) {
    if (condition) reasons.add(reason);
}

export function verifySmartOrderReadonlyProbeEvidence({
    report,
    expected,
    nowEpochMs,
    maximumAgeMs = SMART_ORDER_GATE_EVIDENCE_MAX_AGE_MS,
}) {
    const reasons = new Set();
    if (!exactKeys(report, TOP_LEVEL_KEYS)) {
        return Object.freeze({
            eligible: false,
            evidenceClass: 'invalid',
            reasons: Object.freeze(['report_schema_invalid']),
        });
    }
    if (
        !expected ||
        typeof expected !== 'object' ||
        !/^[a-f0-9]{64}$/.test(expected.probeSourceSha256 ?? '') ||
        !/^[a-f0-9]{64}$/.test(expected.appBuildSha256 ?? '') ||
        !/^[a-f0-9]{64}$/.test(expected.adapterSha256 ?? '') ||
        typeof expected.shioajiVersion !== 'string' ||
        expected.shioajiVersion.length === 0 ||
        !Number.isSafeInteger(nowEpochMs) ||
        nowEpochMs < 0 ||
        !Number.isSafeInteger(maximumAgeMs) ||
        maximumAgeMs < 1
    ) {
        throw new TypeError('gate evidence verifier context is invalid');
    }
    addReason(
        reasons,
        report.schema !== SMART_ORDER_READONLY_PROBE_SCHEMA ||
            report.version !== SMART_ORDER_READONLY_PROBE_VERSION,
        'report_schema_or_version_stale',
    );
    addReason(
        reasons,
        report.executionMode !== 'live-readonly' ||
            report.evidenceClass !== 'live_readonly' ||
            report.operationClass !==
                'managed-simulation-readonly-session-contract',
        'fixture_or_operation_class_forbidden',
    );
    addReason(
        reasons,
        report.codeRevision !== `sha256:${expected.probeSourceSha256}`,
        'probe_source_revision_mismatch',
    );

    const generatedAtEpochMs = Date.parse(report.generatedAt);
    addReason(
        reasons,
        !Number.isSafeInteger(generatedAtEpochMs) ||
            new Date(generatedAtEpochMs).toISOString() !== report.generatedAt ||
            generatedAtEpochMs > nowEpochMs ||
            nowEpochMs - generatedAtEpochMs > maximumAgeMs,
        'report_time_invalid_or_stale',
    );
    addReason(
        reasons,
        typeof report.runId !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                report.runId,
            ),
        'run_lineage_invalid',
    );
    let resultHashMatches = false;
    try {
        resultHashMatches =
            typeof report.resultHash === 'string' &&
            /^[a-f0-9]{64}$/.test(report.resultHash) &&
            report.resultHash === reportHash(report);
    } catch {
        resultHashMatches = false;
    }
    addReason(reasons, !resultHashMatches, 'result_hash_mismatch');

    if (!exactKeys(report.network, NETWORK_KEYS)) {
        reasons.add('network_metrics_schema_invalid');
    } else {
        addReason(
            reasons,
            Object.values(report.network).some((value) => !safeCount(value)),
            'network_metrics_invalid',
        );
        addReason(
            reasons,
            report.network.brokerWritesAttempted !== 0 ||
                report.network.brokerWritesNetworked !== 0,
            'broker_write_observed',
        );
    }
    if (!exactKeys(report.sideEffects, SIDE_EFFECT_KEYS)) {
        reasons.add('side_effect_schema_invalid');
    } else {
        addReason(
            reasons,
            Object.values(report.sideEffects).some((value) => !safeCount(value)) ||
                report.sideEffects.tradingWrites !== 0 ||
                report.sideEffects.automaticRetries !== 0 ||
                report.sideEffects.blindCleanupAttempts !== 0,
            'side_effect_observed',
        );
    }
    addReason(
        reasons,
        !exactKeys(report.managedRuntime, [
            'bound',
            'generationEvidenceClass',
            'sharedModeLeaseHeld',
        ]) ||
            report.managedRuntime.bound !== true ||
            ![
                'pre_listener_private_marker',
                'read_only_attested_process_epoch',
            ].includes(report.managedRuntime.generationEvidenceClass) ||
            report.managedRuntime.sharedModeLeaseHeld !== true,
        'managed_runtime_or_lease_invalid',
    );
    addReason(
        reasons,
        !exactKeys(report.mode, [
            'apiSimulation',
            'marker',
            'servicePidStable',
        ]) ||
            report.mode.marker !== 'simulation' ||
            report.mode.apiSimulation !== true ||
            report.mode.servicePidStable !== true,
        'simulation_attestation_invalid',
    );
    if (!exactKeys(report.fingerprint, FINGERPRINT_KEYS)) {
        reasons.add('fingerprint_schema_invalid');
    } else {
        addReason(
            reasons,
            report.fingerprint.probeSourceSha256 !==
                    expected.probeSourceSha256 ||
                report.fingerprint.appBuildSha256 !== expected.appBuildSha256 ||
                report.fingerprint.adapterSha256 !== expected.adapterSha256 ||
                report.fingerprint.expectedShioajiVersion !==
                    expected.shioajiVersion ||
                report.fingerprint.versionMatched !== true ||
                report.fingerprint.apiFingerprintStable !== true,
            'fingerprint_mismatch',
        );
    }

    const seenChecks = new Map();
    if (!Array.isArray(report.checks)) {
        reasons.add('required_checks_invalid');
    } else {
        for (const check of report.checks) {
            if (
                !check ||
                typeof check !== 'object' ||
                Array.isArray(check) ||
                !['id', 'status', 'accountRef'].every(
                    (key) => key in check || key === 'accountRef',
                ) ||
                Object.keys(check).some(
                    (key) => !['id', 'status', 'accountRef'].includes(key),
                ) ||
                typeof check.id !== 'string' ||
                check.status !== 'pass' ||
                (check.accountRef !== undefined &&
                    (typeof check.accountRef !== 'string' ||
                        !/^stock-account-[1-9]\d{0,2}$/.test(
                            check.accountRef,
                        )))
            ) {
                reasons.add('required_checks_invalid');
                continue;
            }
            seenChecks.set(check.id, (seenChecks.get(check.id) ?? 0) + 1);
        }
        const exactRequiredSet =
            seenChecks.size === SMART_ORDER_REQUIRED_READONLY_CHECK_IDS.length &&
            SMART_ORDER_REQUIRED_READONLY_CHECK_IDS.every(
                (id) => seenChecks.get(id) === 1,
            );
        addReason(reasons, !exactRequiredSet, 'required_checks_invalid');
    }

    addReason(
        reasons,
        report.accountIdentifiersPersisted !== false ||
            typeof report.selectedAccountRef !== 'string' ||
            !/^stock-account-[1-9]\d{0,2}$/.test(report.selectedAccountRef) ||
            !Number.isSafeInteger(report.signedStockAccountCount) ||
            report.signedStockAccountCount < 1 ||
            report.signedStockAccountCount > 32,
        'account_redaction_or_selection_invalid',
    );
    addReason(reasons, report.redactionScan !== 'pass', 'redaction_failed');
    addReason(
        reasons,
        report.testOutcome !== 'pass' || report.overall !== 'pass',
        'probe_outcome_not_pass',
    );
    addReason(
        reasons,
        report.requiredLiveChecksComplete !== true ||
            report.evidenceEligible !== true ||
            report.eligibleForTask0_3 !== true ||
            report.eligibleForGateManifest !== true,
        'self_declared_eligibility_inconsistent',
    );

    if (reasons.size !== 0) {
        return Object.freeze({
            eligible: false,
            evidenceClass:
                report.evidenceClass === 'test_fixture'
                    ? 'test_fixture'
                    : 'invalid',
            reasons: Object.freeze([...reasons].sort()),
        });
    }
    const verified = Object.freeze({
        eligible: true,
        evidenceId: report.runId,
        evidenceClass: 'live_readonly',
        schemaVersion: report.schema,
        sourceSha256: `sha256:${expected.probeSourceSha256}`,
        resultSha256: `sha256:${report.resultHash}`,
        generatedAtEpochMs,
        validUntilEpochMs: generatedAtEpochMs + maximumAgeMs,
        containsAccountIdentifiers: false,
        brokerWriteAttempted: false,
        networkedBrokerWrite: false,
    });
    verifiedGateEvidence.add(verified);
    return verified;
}

function supportedNode24Lts(version, lts) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '');
    if (!match || typeof lts !== 'string' || lts.length < 1 || lts.length > 80) {
        return false;
    }
    const [, major, minor] = match.map(Number);
    return major === 24 && minor >= 15;
}

function supportedMacosVersion(version) {
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(version ?? '');
    if (!match) return false;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    return major > 13 || (major === 13 && minor >= 3);
}

function verifyNodeSqlitePlatformReport({
    report,
    expected,
    trustedHosts,
    nowEpochMs,
    maximumAgeMs,
}) {
    const reasons = new Set();
    if (!exactKeys(report, NODE_SQLITE_REPORT_KEYS)) {
        return Object.freeze({
            eligible: false,
            evidenceClass: 'invalid',
            reasons: Object.freeze(['report_schema_invalid']),
        });
    }
    addReason(
        reasons,
        report.schema !== SMART_ORDER_NODE_SQLITE_CAPABILITY_SCHEMA ||
            report.version !== SMART_ORDER_NODE_SQLITE_CAPABILITY_VERSION ||
            report.executionMode !== 'managed-local-capability' ||
            report.evidenceClass !==
                'node_sqlite_arm64_platform_capability' ||
            report.operationClass !==
                'offline-no-broker-node-sqlite-arm64-capability' ||
            report.supportPolicy !==
                SMART_ORDER_TRADING_RUNTIME_PLATFORM_POLICY,
        'report_schema_or_operation_class_invalid',
    );
    addReason(
        reasons,
        report.codeRevision !== `sha256:${expected.sourceSha256}`,
        'source_revision_mismatch',
    );

    const generatedAtEpochMs = Date.parse(report.generatedAt);
    addReason(
        reasons,
        !Number.isSafeInteger(generatedAtEpochMs) ||
            new Date(generatedAtEpochMs).toISOString() !== report.generatedAt ||
            generatedAtEpochMs > nowEpochMs ||
            nowEpochMs - generatedAtEpochMs > maximumAgeMs,
        'report_time_invalid_or_stale',
    );
    addReason(
        reasons,
        typeof report.runId !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                report.runId,
            ),
        'run_lineage_invalid',
    );
    let resultHashMatches = false;
    try {
        resultHashMatches =
            /^[a-f0-9]{64}$/.test(report.resultHash ?? '') &&
            report.resultHash === reportHash(report);
    } catch {
        resultHashMatches = false;
    }
    addReason(reasons, !resultHashMatches, 'result_hash_mismatch');

    let architecture;
    if (!exactKeys(report.platform, NODE_SQLITE_PLATFORM_KEYS)) {
        reasons.add('platform_schema_invalid');
    } else {
        architecture = report.platform.hardwareArch;
        const arm64Native =
            architecture === 'arm64' &&
            report.platform.processArch === 'arm64' &&
            report.platform.unameMachine === 'arm64' &&
            report.platform.sysctlOptionalArm64 === 1;
        addReason(
            reasons,
            report.platform.operatingSystem !== 'darwin' ||
                !supportedMacosVersion(report.platform.macosVersion) ||
                report.platform.hypervisorPresent !== 0 ||
                report.platform.nativeArchitecture !== true ||
                !arm64Native,
            'native_apple_silicon_arm64_not_proven',
        );
    }

    if (!exactKeys(report.attestation, NODE_SQLITE_ATTESTATION_KEYS)) {
        reasons.add('host_attestation_schema_invalid');
    } else {
        const trustedHost = trustedHosts.get(architecture);
        let signatureValid = false;
        try {
            const payload = smartOrderNodeSqliteAttestationPayload(report);
            const payloadSha256 = `sha256:${sha256Hex(payload)}`;
            const signature = Buffer.from(
                report.attestation.signatureBase64Url ?? '',
                'base64url',
            );
            signatureValid =
                report.attestation.algorithm === 'ed25519' &&
                trustedHost !== undefined &&
                report.attestation.hostKeyId === trustedHost.hostKeyId &&
                report.attestation.payloadSha256 === payloadSha256 &&
                /^[A-Za-z0-9_-]{80,120}$/.test(
                    report.attestation.signatureBase64Url ?? '',
                ) &&
                verifySignature(
                    null,
                    Buffer.from(payload, 'utf8'),
                    trustedHost.publicKey,
                    signature,
                );
            signature.fill(0);
        } catch {
            signatureValid = false;
        }
        addReason(
            reasons,
            !signatureValid,
            'host_attestation_invalid_or_untrusted',
        );
    }

    if (!exactKeys(report.runtime, NODE_SQLITE_RUNTIME_KEYS)) {
        reasons.add('runtime_schema_invalid');
    } else {
        addReason(
            reasons,
            !supportedNode24Lts(
                report.runtime.nodeVersion,
                report.runtime.nodeLts,
            ) || !/^\d+\.\d+\.\d+$/.test(report.runtime.sqliteVersion ?? ''),
            'node_or_sqlite_runtime_unsupported',
        );
    }

    if (!exactKeys(report.fingerprint, NODE_SQLITE_FINGERPRINT_KEYS)) {
        reasons.add('fingerprint_schema_invalid');
    } else {
        addReason(
            reasons,
            NODE_SQLITE_FINGERPRINT_KEYS.some(
                (key) =>
                    !/^[a-f0-9]{64}$/.test(report.fingerprint[key] ?? '') ||
                    report.fingerprint[key] !== expected[key],
            ),
            'fingerprint_mismatch',
        );
    }

    const seenChecks = new Map();
    if (!Array.isArray(report.checks)) {
        reasons.add('required_checks_invalid');
    } else {
        for (const check of report.checks) {
            if (
                !exactKeys(check, ['id', 'status']) ||
                typeof check.id !== 'string' ||
                check.status !== 'pass'
            ) {
                reasons.add('required_checks_invalid');
                continue;
            }
            seenChecks.set(check.id, (seenChecks.get(check.id) ?? 0) + 1);
        }
        addReason(
            reasons,
            seenChecks.size !==
                    SMART_ORDER_REQUIRED_NODE_SQLITE_CHECK_IDS.length ||
                SMART_ORDER_REQUIRED_NODE_SQLITE_CHECK_IDS.some(
                    (id) => seenChecks.get(id) !== 1,
                ),
            'required_checks_invalid',
        );
    }

    if (!exactKeys(report.sideEffects, NODE_SQLITE_SIDE_EFFECT_KEYS)) {
        reasons.add('side_effect_schema_invalid');
    } else {
        addReason(
            reasons,
            Object.values(report.sideEffects).some((value) => value !== 0),
            'side_effect_observed',
        );
    }
    addReason(reasons, report.redactionScan !== 'pass', 'redaction_failed');
    addReason(
        reasons,
        report.testOutcome !== 'pass' || report.overall !== 'pass',
        'probe_outcome_not_pass',
    );

    if (reasons.size !== 0) {
        return invalidEvidence(
            report.evidenceClass ===
                'node_sqlite_arm64_platform_capability'
                ? 'node_sqlite_arm64_platform_capability'
                : 'invalid',
            reasons,
        );
    }
    return Object.freeze({
        eligible: true,
        architecture,
        generatedAtEpochMs,
        validUntilEpochMs: generatedAtEpochMs + maximumAgeMs,
        report,
    });
}

export async function verifySmartOrderNodeSqliteCapabilityEvidence({
    appSupportRoot,
    nowEpochMs,
    maximumAgeMs = SMART_ORDER_NODE_SQLITE_CAPABILITY_MAX_AGE_MS,
    readPlatformSupport = readSmartOrderTradingRuntimePlatformSupport,
}) {
    const expected = await currentSmartOrderNodeSqliteCapabilityFingerprints();
    if (
        !exactKeys(expected, NODE_SQLITE_FINGERPRINT_KEYS) ||
        NODE_SQLITE_FINGERPRINT_KEYS.some(
            (key) => !/^[a-f0-9]{64}$/.test(expected[key] ?? ''),
        ) ||
        !Number.isSafeInteger(nowEpochMs) ||
        nowEpochMs < 0 ||
        !Number.isSafeInteger(maximumAgeMs) ||
        maximumAgeMs < 1
    ) {
        throw new TypeError('node:sqlite capability verifier context is invalid');
    }
    try {
        const currentPlatform = await readPlatformSupport();
        if (
            currentPlatform.supportPolicy !==
            SMART_ORDER_TRADING_RUNTIME_PLATFORM_POLICY
        ) {
            throw new Error('current platform support policy mismatch');
        }
    } catch {
        return invalidEvidence('node_sqlite_capability', [
            'current_runtime_platform_unsupported',
        ]);
    }
    let evidenceStore;
    try {
        evidenceStore = await loadNodeSqliteCapabilityEvidenceStore(
            appSupportRoot,
        );
    } catch {
        return invalidEvidence('node_sqlite_capability', [
            'private_evidence_store_invalid_or_incomplete',
        ]);
    }
    const {
        report,
        reportBinding,
        trustGeneration,
        trustManifestSha256,
        trustedHostKeyIds,
        trustedHosts,
    } = evidenceStore;
    const decision = verifyNodeSqlitePlatformReport({
        report,
        expected,
        trustedHosts,
        nowEpochMs,
        maximumAgeMs,
    });
    const reasons = new Set();
    if (!decision.eligible) {
        for (const reason of decision.reasons) reasons.add(reason);
    }
    addReason(
        reasons,
        reportBinding.runId !== report.runId ||
            reportBinding.resultHash !== report.resultHash,
        'trusted_report_binding_mismatch_or_replay',
    );
    if (reasons.size !== 0) {
        return invalidEvidence('node_sqlite_capability', reasons);
    }

    const sourceMatrixSha256 =
        smartOrderNodeSqliteSourceMatrixSha256(expected);
    const trustedReportSha256 = `sha256:${sha256Hex(canonicalJson(report))}`;
    const authoritySha256 = `sha256:${sha256Hex(
        canonicalJson({
            sourceMatrixSha256,
            trustGeneration,
            trustManifestSha256,
            trustedHostKeyIds,
            trustedReportSha256,
            trustedReportResultHash: reportBinding.resultHash,
            trustedReportRunId: reportBinding.runId,
        }),
    )}`;
    const evidenceId = sha256Hex(
        canonicalJson(
            {
                authoritySha256,
                report: {
                    architecture: 'arm64',
                    resultHash: report.resultHash,
                    runId: report.runId,
                },
            },
        ),
    );
    const verified = Object.freeze({
        eligible: true,
        evidenceId,
        evidenceClass: 'node_sqlite_capability',
        schemaVersion: SMART_ORDER_NODE_SQLITE_CAPABILITY_SCHEMA,
        sourceSha256: authoritySha256,
        sourceMatrixSha256,
        trustGeneration,
        trustManifestSha256,
        trustedHostKeyIds,
        trustedReportSha256,
        resultSha256: `sha256:${sha256Hex(
            canonicalJson({
                authoritySha256,
                reportResultHash: report.resultHash,
            }),
        )}`,
        generatedAtEpochMs: decision.generatedAtEpochMs,
        validUntilEpochMs: decision.validUntilEpochMs,
        architectures: Object.freeze(['arm64']),
        nodeVersion: report.runtime.nodeVersion,
        sqliteVersion: report.runtime.sqliteVersion,
        containsAccountIdentifiers: false,
        brokerWriteAttempted: false,
        networkedBrokerWrite: false,
    });
    verifiedGateEvidence.add(verified);
    return verified;
}

export function verifySmartOrderSubscriptionOwnershipEvidence({
    report,
    expected,
    nowEpochMs,
    maximumAgeMs = SMART_ORDER_GATE_EVIDENCE_MAX_AGE_MS,
}) {
    const reasons = new Set();
    if (!exactKeys(report, SUBSCRIPTION_REPORT_KEYS)) {
        return invalidEvidence('invalid', ['report_schema_invalid']);
    }
    if (
        !expected ||
        typeof expected !== 'object' ||
        !/^[a-f0-9]{64}$/.test(expected.sourceSha256 ?? '') ||
        !/^[a-f0-9]{64}$/.test(expected.appBuildSha256 ?? '') ||
        !/^[a-f0-9]{64}$/.test(expected.shioajiCapabilitySha256 ?? '') ||
        typeof expected.countingDimension !== 'string' ||
        expected.countingDimension.length === 0 ||
        expected.countingDimension === 'unknown' ||
        !safeCount(expected.officialLimitUnits) ||
        !safeCount(expected.localLimitUnits) ||
        !safeCount(expected.reservedHeadroomUnits) ||
        expected.localLimitUnits + expected.reservedHeadroomUnits !==
            expected.officialLimitUnits ||
        !Number.isSafeInteger(nowEpochMs) ||
        nowEpochMs < 0 ||
        !Number.isSafeInteger(maximumAgeMs) ||
        maximumAgeMs < 1
    ) {
        throw new TypeError(
            'subscription ownership verifier context is invalid',
        );
    }

    addReason(
        reasons,
        report.schema !== SMART_ORDER_SUBSCRIPTION_OWNERSHIP_SCHEMA ||
            report.version !== SMART_ORDER_SUBSCRIPTION_OWNERSHIP_VERSION ||
            report.executionMode !== 'live-readonly' ||
            report.evidenceClass !== 'subscription_ownership',
        'report_schema_or_operation_class_invalid',
    );
    addReason(
        reasons,
        report.codeRevision !== `sha256:${expected.sourceSha256}`,
        'source_revision_mismatch',
    );
    const generatedAtEpochMs = Date.parse(report.generatedAt);
    addReason(
        reasons,
        !Number.isSafeInteger(generatedAtEpochMs) ||
            new Date(generatedAtEpochMs).toISOString() !== report.generatedAt ||
            generatedAtEpochMs > nowEpochMs ||
            nowEpochMs - generatedAtEpochMs > maximumAgeMs,
        'report_time_invalid_or_stale',
    );
    addReason(
        reasons,
        typeof report.runId !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                report.runId,
            ),
        'run_lineage_invalid',
    );
    let resultHashMatches = false;
    try {
        resultHashMatches =
            typeof report.resultHash === 'string' &&
            /^[a-f0-9]{64}$/.test(report.resultHash) &&
            report.resultHash === reportHash(report);
    } catch {
        resultHashMatches = false;
    }
    addReason(reasons, !resultHashMatches, 'result_hash_mismatch');

    addReason(
        reasons,
        report.countingDimension !== expected.countingDimension ||
            report.countingDimension === 'unknown',
        'counting_dimension_unknown_or_mismatched',
    );
    if (!exactKeys(report.fingerprint, SUBSCRIPTION_FINGERPRINT_KEYS)) {
        reasons.add('fingerprint_schema_invalid');
    } else {
        addReason(
            reasons,
            report.fingerprint.appBuildSha256 !==
                    expected.appBuildSha256 ||
                report.fingerprint.shioajiCapabilitySha256 !==
                    expected.shioajiCapabilitySha256,
            'fingerprint_mismatch',
        );
    }

    let reportedUsage = 0;
    const seenConsumers = new Set();
    if (!Array.isArray(report.consumers)) {
        reasons.add('consumer_catalog_invalid');
    } else {
        for (const consumer of report.consumers) {
            if (
                !exactKeys(consumer, SUBSCRIPTION_CONSUMER_KEYS) ||
                typeof consumer.consumerId !== 'string' ||
                !SMART_ORDER_REQUIRED_SUBSCRIPTION_CONSUMER_IDS.includes(
                    consumer.consumerId,
                ) ||
                seenConsumers.has(consumer.consumerId) ||
                typeof consumer.visible !== 'boolean' ||
                typeof consumer.usageKnown !== 'boolean' ||
                (consumer.usageKnown
                    ? !safeCount(consumer.usageUnits)
                    : consumer.usageUnits !== null)
            ) {
                reasons.add('consumer_catalog_invalid');
                continue;
            }
            seenConsumers.add(consumer.consumerId);
            if (!consumer.visible || !consumer.usageKnown) {
                reasons.add('consumer_usage_unknown');
            } else {
                reportedUsage += consumer.usageUnits;
            }
        }
        if (
            seenConsumers.size !==
                SMART_ORDER_REQUIRED_SUBSCRIPTION_CONSUMER_IDS.length ||
            SMART_ORDER_REQUIRED_SUBSCRIPTION_CONSUMER_IDS.some(
                (consumerId) => !seenConsumers.has(consumerId),
            )
        ) {
            reasons.add('consumer_catalog_incomplete');
        }
    }

    if (!exactKeys(report.pool, SUBSCRIPTION_POOL_KEYS)) {
        reasons.add('pool_projection_invalid');
    } else {
        addReason(
            reasons,
            report.pool.officialLimitUnits !== expected.officialLimitUnits ||
                report.pool.localLimitUnits !== expected.localLimitUnits ||
                report.pool.reservedHeadroomUnits !==
                    expected.reservedHeadroomUnits ||
                report.pool.localLimitUnits +
                        report.pool.reservedHeadroomUnits !==
                    report.pool.officialLimitUnits,
            'pool_limit_mismatch',
        );
        addReason(
            reasons,
            report.pool.ownershipComplete !== true ||
                report.pool.usageComplete !== true ||
                report.pool.sharedPoolVerified !== true,
            'ownership_or_usage_incomplete',
        );
        addReason(
            reasons,
            !safeCount(report.pool.totalUsageUnits) ||
                report.pool.totalUsageUnits !== reportedUsage,
            'usage_total_mismatch',
        );
        addReason(
            reasons,
            safeCount(report.pool.totalUsageUnits) &&
                report.pool.totalUsageUnits >= report.pool.localLimitUnits,
            'local_subscription_budget_exhausted',
        );
    }
    addReason(
        reasons,
        report.accountIdentifiersPersisted !== false,
        'account_identifier_boundary_invalid',
    );
    addReason(
        reasons,
        report.testOutcome !== 'pass' || report.overall !== 'pass',
        'report_outcome_not_pass',
    );

    if (reasons.size !== 0) {
        return invalidEvidence('subscription_ownership', reasons);
    }
    const verified = Object.freeze({
        eligible: true,
        evidenceId: report.runId,
        evidenceClass: 'subscription_ownership',
        schemaVersion: report.schema,
        sourceSha256: `sha256:${expected.sourceSha256}`,
        resultSha256: `sha256:${report.resultHash}`,
        generatedAtEpochMs,
        validUntilEpochMs: generatedAtEpochMs + maximumAgeMs,
        containsAccountIdentifiers: false,
        brokerWriteAttempted: false,
        networkedBrokerWrite: false,
    });
    verifiedGateEvidence.add(verified);
    return verified;
}
