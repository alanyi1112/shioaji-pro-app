import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { arch, platform, release } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    EXTERNAL_ORDER_EVENT_OBSERVATION_TIMEOUT_MS,
    currentSmartOrderReadonlyProbeFingerprints,
    managedSmartOrderReadonlyProbeAppSupportRoot,
    runManagedLiveReadOnlyPreflight,
} from './smart-order-contract-probe.mjs';
import {
    isVerifiedSmartOrderGateEvidence,
    verifySmartOrderNodeSqliteCapabilityEvidence,
    verifySmartOrderReadonlyProbeEvidence,
} from './smart-order-runtime/gate-evidence-verifier.mjs';
import {
    SMART_ORDER_FEATURE_GATE_IDS,
    createSmartOrderGateManifest,
    validateSmartOrderGateManifest,
} from './smart-order-runtime/gate-manifest.mjs';
import {
    SMART_ORDER_CURRENT_MANUAL_ROUTE_COVERAGE,
    SMART_ORDER_MANUAL_ROUTE_COVERAGE_VERSION,
} from './smart-order-runtime/manual-route-coverage.mjs';
import {
    SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
    SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
} from './smart-order-runtime/canonical-pnl-policy.mjs';
import { SMART_ORDER_SHIOAJI_EVENT_MAPPING_REVISION } from './smart-order-runtime/shioaji-broker-event-mapper.mjs';
import { SMART_ORDER_REPOSITORY_SCHEMA_VERSION } from './smart-order-runtime/repository-schema.mjs';
import { canonicalJson } from './smart-order-runtime/canonical-json.mjs';
import { createSmartOrderResourceCoordinator } from './smart-order-runtime/resource-coordinator.mjs';
import {
    createTask03ObservationCoordination,
    isIssuedTask03ObservationCoordination,
} from './smart-order-runtime/task0-3-observation-coordination.mjs';

const PROBE_URL = new URL('./smart-order-contract-probe.mjs', import.meta.url);
const VERSION_URL = new URL('../SHIOAJI_VERSION', import.meta.url);
const SIDECAR_URL = new URL('./smart-order-runtime/local-sidecar.mjs', import.meta.url);
const MANIFEST_PROVENANCES = Object.freeze([
    'automation',
    'manual_user_confirmed',
    'gate_probe',
]);
const PRODUCT_BOUNDARY_CONSENT_VERSION =
    'realtimestock-local-monitoring-boundary/2026-08-11.1';
const EXTERNAL_EVENT_OBSERVATION_CONFIRMATION =
    'I_CONFIRM_READONLY_OBSERVATION_OF_SEPARATELY_AUTHORIZED_EXTERNAL_SIMULATION_EVENT';
const issuedGateRunnerManifests = new WeakSet();

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function allFeatureGatesClosed() {
    return Object.freeze(
        Object.fromEntries(
            SMART_ORDER_FEATURE_GATE_IDS.map((feature) => [feature, false]),
        ),
    );
}

export function isIssuedCurrentSmartOrderGateRunnerManifest(value) {
    return Boolean(
        value &&
            typeof value === 'object' &&
            issuedGateRunnerManifests.has(value),
    );
}

async function currentExpectedEvidenceContext() {
    const [probeBytes, shioajiVersion, fingerprints] = await Promise.all([
        readFile(PROBE_URL),
        readFile(VERSION_URL, 'utf8'),
        currentSmartOrderReadonlyProbeFingerprints(),
    ]);
    return Object.freeze({
        probeSourceSha256: createHash('sha256').update(probeBytes).digest('hex'),
        appBuildSha256: fingerprints.appBuildSha256,
        adapterSha256: fingerprints.adapterSha256,
        shioajiVersion: shioajiVersion.trim(),
    });
}

export async function currentSmartOrderGateManifestFingerprints() {
    const [probeFingerprints, sidecarBytes, shioajiVersion] = await Promise.all([
        currentSmartOrderReadonlyProbeFingerprints(),
        readFile(SIDECAR_URL),
        readFile(VERSION_URL, 'utf8'),
    ]);
    const version = shioajiVersion.trim();
    const nodeRuntime = Object.freeze({
        node: process.version,
        modules: process.versions.modules ?? 'unknown',
        napi: process.versions.napi ?? 'unknown',
    });
    const sqliteRuntime = Object.freeze({
        repositorySchemaVersion: SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
        sqlite: process.versions.sqlite ?? 'unavailable',
    });
    return Object.freeze({
        adapterSha256: `sha256:${probeFingerprints.adapterSha256}`,
        appBuildSha256: `sha256:${probeFingerprints.appBuildSha256}`,
        mappingRevision: SMART_ORDER_SHIOAJI_EVENT_MAPPING_REVISION,
        nodeRuntimeSha256: sha256(canonicalJson(nodeRuntime)),
        orderClassMatrixRevision: SMART_ORDER_MANUAL_ROUTE_COVERAGE_VERSION,
        orderClassMatrixSha256:
            SMART_ORDER_CURRENT_MANUAL_ROUTE_COVERAGE.coverageSha256,
        osPlatformSha256: sha256(
            canonicalJson({ arch: arch(), platform: platform(), release: release() }),
        ),
        pnlPolicyDefinitionSha256:
            SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
        pnlPolicyRevision: SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
        routeCoverageSha256:
            SMART_ORDER_CURRENT_MANUAL_ROUTE_COVERAGE.coverageSha256,
        shioajiCapabilitySha256: sha256(
            canonicalJson({
                adapterSha256: probeFingerprints.adapterSha256,
                serverVersion: version,
            }),
        ),
        shioajiServerVersion: version,
        sidecarSchemaSha256: sha256(sidecarBytes),
        sqliteRuntimeSha256: sha256(canonicalJson(sqliteRuntime)),
    });
}

export async function verifyCurrentSmartOrderReadonlyProbeReport(
    report,
    nowEpochMs = Date.now(),
) {
    const expected = await currentExpectedEvidenceContext();
    return verifySmartOrderReadonlyProbeEvidence({
        report,
        expected,
        nowEpochMs,
    });
}

export async function runManagedSmartOrderReadonlyGateRunner({
    appSupportRoot,
    resourceCoordinator,
    task03Coordination,
    externalOrderEventObservation = false,
} = {}) {
    if (typeof externalOrderEventObservation !== 'boolean') {
        throw new TypeError(
            'external order-event observation selection must be boolean',
        );
    }
    const report = await runManagedLiveReadOnlyPreflight({
        resourceCoordinator,
        ...(externalOrderEventObservation
            ? {
                  eventTimeoutMs:
                      EXTERNAL_ORDER_EVENT_OBSERVATION_TIMEOUT_MS,
              }
            : {}),
        ...(isIssuedTask03ObservationCoordination(task03Coordination)
            ? { task03Coordination }
            : {}),
    });
    const verificationNowEpochMs = Date.now();
    const expectedEvidence = await currentExpectedEvidenceContext();
    const verification = verifySmartOrderReadonlyProbeEvidence({
        report,
        expected: expectedEvidence,
        nowEpochMs: verificationNowEpochMs,
    });
    const nodeSqliteVerification =
        await verifySmartOrderNodeSqliteCapabilityEvidence({
            appSupportRoot,
            nowEpochMs: verificationNowEpochMs,
        });
    if (
        verification.eligible !== true ||
        !isVerifiedSmartOrderGateEvidence(verification)
    ) {
        return Object.freeze({
            report,
            verification,
            nodeSqliteVerification,
            manifests: Object.freeze([]),
            stored: false,
            verificationNowEpochMs,
            brokerWriteAuthority: false,
            writeMasterAuthority: false,
        });
    }
    const verifiedEvidence = [verification];
    if (
        nodeSqliteVerification.eligible === true &&
        isVerifiedSmartOrderGateEvidence(nodeSqliteVerification) &&
        nodeSqliteVerification.nodeVersion === process.versions.node &&
        nodeSqliteVerification.sqliteVersion === process.versions.sqlite
    ) {
        verifiedEvidence.push(nodeSqliteVerification);
    }
    const currentFingerprints = await currentSmartOrderGateManifestFingerprints();
    if (
        currentFingerprints.appBuildSha256 !==
            `sha256:${expectedEvidence.appBuildSha256}` ||
        currentFingerprints.adapterSha256 !==
            `sha256:${expectedEvidence.adapterSha256}` ||
        currentFingerprints.shioajiServerVersion !==
            expectedEvidence.shioajiVersion
    ) {
        throw new Error(
            'Gate runner fingerprints changed after evidence verification',
        );
    }
    const fingerprints = Object.freeze({
        ...currentFingerprints,
        shioajiCapabilitySha256: sha256(
            canonicalJson({
                adapterSha256: currentFingerprints.adapterSha256,
                resultSha256: verification.resultSha256,
                schemaVersion: verification.schemaVersion,
                serverVersion: currentFingerprints.shioajiServerVersion,
                sourceSha256: verification.sourceSha256,
            }),
        ),
    });
    const requestedValidUntilEpochMs = Math.min(
        ...verifiedEvidence.map((evidence) => evidence.validUntilEpochMs),
        verificationNowEpochMs + 5 * 60 * 1000,
    );
    const manifestRevision = sha256(
        canonicalJson({
            fingerprints,
            resultSha256: verification.resultSha256,
            sourceSha256: verification.sourceSha256,
            nodeSqliteResultSha256:
                verifiedEvidence.length === 2
                    ? nodeSqliteVerification.resultSha256
                    : 'ineligible-or-runtime-mismatch',
        }),
    );
    const manifests = MANIFEST_PROVENANCES.map((provenance) => {
        const manifest = createSmartOrderGateManifest({
            manifestRevision,
            provenance,
            fingerprints,
            featureGates: allFeatureGatesClosed(),
            productBoundaryConsentVersion: PRODUCT_BOUNDARY_CONSENT_VERSION,
            evidence: verifiedEvidence,
            createdAtEpochMs: verificationNowEpochMs,
            requestedValidUntilEpochMs,
        });
        const validation = validateSmartOrderGateManifest({
            manifest,
            currentFingerprints: fingerprints,
            currentEvidence: verifiedEvidence,
            currentProductBoundaryConsentVersion:
                PRODUCT_BOUNDARY_CONSENT_VERSION,
            nowEpochMs: verificationNowEpochMs,
        });
        if (!validation.valid || validation.state !== 'observe_only') {
            throw new Error(
                'current Gate runner produced an invalid or unexpectedly eligible manifest',
            );
        }
        issuedGateRunnerManifests.add(manifest);
        return manifest;
    });
    const finalFingerprints = await currentSmartOrderGateManifestFingerprints();
    if (canonicalJson(finalFingerprints) !== canonicalJson(currentFingerprints)) {
        throw new Error(
            'Gate runner fingerprints changed while building manifests',
        );
    }
    if (verifiedEvidence.length === 2) {
        const finalNodeSqliteVerification =
            await verifySmartOrderNodeSqliteCapabilityEvidence({
                appSupportRoot,
                nowEpochMs: verificationNowEpochMs,
            });
        if (
            finalNodeSqliteVerification.eligible !== true ||
            !isVerifiedSmartOrderGateEvidence(finalNodeSqliteVerification) ||
            finalNodeSqliteVerification.evidenceId !==
                nodeSqliteVerification.evidenceId ||
            finalNodeSqliteVerification.sourceSha256 !==
                nodeSqliteVerification.sourceSha256 ||
            finalNodeSqliteVerification.resultSha256 !==
                nodeSqliteVerification.resultSha256
        ) {
            throw new Error(
                'Node SQLite capability authority changed while building manifests',
            );
        }
    }
    return Object.freeze({
        report,
        verification,
        nodeSqliteVerification,
        manifests: Object.freeze(manifests),
        stored: false,
        verificationNowEpochMs,
        brokerWriteAuthority: false,
        writeMasterAuthority: false,
    });
}

async function main() {
    const args = process.argv.slice(2);
    const appSupportRoot = managedSmartOrderReadonlyProbeAppSupportRoot();
    let task03Coordination;
    let externalOrderEventObservation = false;
    if (
        args.length === 2 &&
        args[0] === '--observe-external-order-event' &&
        args[1] === `--confirm=${EXTERNAL_EVENT_OBSERVATION_CONFIRMATION}`
    ) {
        externalOrderEventObservation = true;
    } else if (args.length > 0) {
        const coordinationId = args
            .find((argument) => argument.startsWith('--task0-3-coordination='))
            ?.slice('--task0-3-coordination='.length);
        const accountScopeSha256 = args
            .find((argument) => argument.startsWith('--account-scope='))
            ?.slice('--account-scope='.length);
        const requestSha256 = args
            .find((argument) => argument.startsWith('--request-sha256='))
            ?.slice('--request-sha256='.length);
        if (args.length !== 3) {
            throw new TypeError('Task 0.3 Gate runner coordination arguments are invalid');
        }
        task03Coordination = createTask03ObservationCoordination({
            accountScopeSha256,
            appSupportRoot,
            coordinationId,
            requestSha256,
        });
    }
    const resourceCoordinator = createSmartOrderResourceCoordinator();
    try {
        const result = await runManagedSmartOrderReadonlyGateRunner({
            appSupportRoot,
            resourceCoordinator,
            externalOrderEventObservation,
            ...(task03Coordination ? { task03Coordination } : {}),
        });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (
            result.verification.eligible !== true ||
            !isVerifiedSmartOrderGateEvidence(result.verification)
        ) {
            process.exitCode = 2;
        }
    } finally {
        resourceCoordinator.close();
        await task03Coordination?.closeReadiness().catch(() => {});
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
