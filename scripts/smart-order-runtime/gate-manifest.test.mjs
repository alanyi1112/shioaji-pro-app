import {
    createHash,
    generateKeyPairSync,
    randomUUID,
    sign,
} from 'node:crypto';
import {
    chmod,
    mkdir,
    mkdtemp,
    realpath,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json.mjs';
import {
    SMART_ORDER_NODE_SQLITE_CAPABILITY_SCHEMA,
    SMART_ORDER_NODE_SQLITE_CAPABILITY_VERSION,
    SMART_ORDER_READONLY_PROBE_VERSION,
    SMART_ORDER_NODE_SQLITE_TRUST_MANIFEST_SCHEMA_VERSION,
    SMART_ORDER_REQUIRED_NODE_SQLITE_CHECK_IDS,
    SMART_ORDER_REQUIRED_READONLY_CHECK_IDS,
    SMART_ORDER_REQUIRED_SUBSCRIPTION_CONSUMER_IDS,
    SMART_ORDER_SUBSCRIPTION_OWNERSHIP_SCHEMA,
    SMART_ORDER_SUBSCRIPTION_OWNERSHIP_VERSION,
    currentSmartOrderNodeSqliteCapabilityFingerprints,
    smartOrderNodeSqliteAttestationPayload,
    verifySmartOrderNodeSqliteCapabilityEvidence,
    verifySmartOrderReadonlyProbeEvidence,
    verifySmartOrderSubscriptionOwnershipEvidence,
} from './gate-evidence-verifier.mjs';
import { SMART_ORDER_TRADING_RUNTIME_PLATFORM_POLICY } from './trading-runtime-platform-support.mjs';
import {
    SMART_ORDER_FEATURE_GATE_IDS,
    createSmartOrderGateManifest,
    validateSmartOrderGateManifest,
} from './gate-manifest.mjs';

const now = 1_786_382_000_000;
const digests = Object.freeze({
    source: '1'.repeat(64),
    app: '2'.repeat(64),
    adapter: '3'.repeat(64),
});
const expectedProbe = Object.freeze({
    probeSourceSha256: digests.source,
    appBuildSha256: digests.app,
    adapterSha256: digests.adapter,
    shioajiVersion: 'v1.2.3',
});
const expectedNodeSqlite =
    await currentSmartOrderNodeSqliteCapabilityFingerprints();
const temporaryDirectories = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) => rm(directory, { recursive: true, force: true })),
    );
});
const fingerprints = Object.freeze({
    adapterSha256: `sha256:${digests.adapter}`,
    appBuildSha256: `sha256:${digests.app}`,
    mappingRevision: 'mapping-r1',
    nodeRuntimeSha256: `sha256:${'4'.repeat(64)}`,
    orderClassMatrixRevision: 'matrix-r1',
    orderClassMatrixSha256: `sha256:${'5'.repeat(64)}`,
    osPlatformSha256: `sha256:${'6'.repeat(64)}`,
    pnlPolicyDefinitionSha256: `sha256:${'7'.repeat(64)}`,
    pnlPolicyRevision: 'pnl-r1',
    routeCoverageSha256: `sha256:${'8'.repeat(64)}`,
    shioajiCapabilitySha256: `sha256:${'9'.repeat(64)}`,
    shioajiServerVersion: 'v1.2.3',
    sidecarSchemaSha256: `sha256:${'a'.repeat(64)}`,
    sqliteRuntimeSha256: `sha256:${'b'.repeat(64)}`,
});
const featureGates = Object.freeze(
    Object.fromEntries(SMART_ORDER_FEATURE_GATE_IDS.map((id) => [id, false])),
);
const consentVersion = 'local-sidecar-consent/v1';

function validReadonlyEvidence() {
    const report = {
        schema: 'realtimestock.smart-order-readonly-contract-probe/v2',
        version: SMART_ORDER_READONLY_PROBE_VERSION,
        codeRevision: `sha256:${digests.source}`,
        generatedAt: new Date(now - 1_000).toISOString(),
        runId: randomUUID(),
        executionMode: 'live-readonly',
        evidenceClass: 'live_readonly',
        operationClass: 'managed-simulation-readonly-session-contract',
        evidenceEligible: true,
        eligibleForTask0_3: true,
        eligibleForGateManifest: true,
        requiredLiveChecksComplete: true,
        accountIdentifiersPersisted: false,
        selectedAccountRef: 'stock-account-1',
        signedStockAccountCount: 1,
        network: {
            requestCount: 7,
            accountingReads: 3,
            observationControlMutations: 2,
            observationStreams: 2,
            subscriptionRequests: 1,
            subscriptionsCreatedOrConfirmed: 1,
            brokerWritesAttempted: 0,
            brokerWritesNetworked: 0,
        },
        sideEffects: {
            tradingWrites: 0,
            automaticRetries: 0,
            blindCleanupAttempts: 0,
        },
        managedRuntime: {
            bound: true,
            generationEvidenceClass: 'read_only_attested_process_epoch',
            sharedModeLeaseHeld: true,
        },
        mode: {
            marker: 'simulation',
            apiSimulation: true,
            servicePidStable: true,
        },
        fingerprint: {
            probeSourceSha256: digests.source,
            appBuildSha256: digests.app,
            adapterSha256: digests.adapter,
            expectedShioajiVersion: 'v1.2.3',
            versionMatched: true,
            apiFingerprintStable: true,
        },
        checks: SMART_ORDER_REQUIRED_READONLY_CHECK_IDS.map((id) => ({
            id,
            status: 'pass',
            accountRef: 'stock-account-1',
        })),
        redactionScan: 'pass',
        testOutcome: 'pass',
        resultHash: '',
        overall: 'pass',
    };
    report.resultHash = createHash('sha256')
        .update(canonicalJson({ ...report, resultHash: '' }))
        .digest('hex');
    return verifySmartOrderReadonlyProbeEvidence({
        report,
        expected: expectedProbe,
        nowEpochMs: now,
    });
}

function createManifest(overrides = {}) {
    return createSmartOrderGateManifest({
        manifestRevision: 'manifest-r1',
        provenance: 'automation',
        fingerprints,
        featureGates,
        productBoundaryConsentVersion: consentVersion,
        evidence: [validReadonlyEvidence()],
        createdAtEpochMs: now,
        requestedValidUntilEpochMs: now + 300_000,
        ...overrides,
    });
}

function subscriptionOwnershipReport(overrides = {}) {
    const consumers = SMART_ORDER_REQUIRED_SUBSCRIPTION_CONSUMER_IDS.map(
        (consumerId) => ({
            consumerId,
            visible: true,
            usageKnown: true,
            usageUnits: consumerId === '5173' ? 12 : 0,
        }),
    );
    const report = {
        schema: SMART_ORDER_SUBSCRIPTION_OWNERSHIP_SCHEMA,
        version: SMART_ORDER_SUBSCRIPTION_OWNERSHIP_VERSION,
        codeRevision: `sha256:${digests.source}`,
        generatedAt: new Date(now - 1_000).toISOString(),
        runId: randomUUID(),
        executionMode: 'live-readonly',
        evidenceClass: 'subscription_ownership',
        countingDimension: 'verified-subscription-item/v1',
        fingerprint: {
            appBuildSha256: digests.app,
            shioajiCapabilitySha256: '9'.repeat(64),
        },
        consumers,
        pool: {
            officialLimitUnits: 200,
            localLimitUnits: 160,
            reservedHeadroomUnits: 40,
            ownershipComplete: true,
            usageComplete: true,
            sharedPoolVerified: true,
            totalUsageUnits: 12,
        },
        accountIdentifiersPersisted: false,
        testOutcome: 'pass',
        overall: 'pass',
        resultHash: '',
        ...overrides,
    };
    report.resultHash = createHash('sha256')
        .update(canonicalJson({ ...report, resultHash: '' }))
        .digest('hex');
    return report;
}

function verifySubscriptionOwnership(report) {
    return verifySmartOrderSubscriptionOwnershipEvidence({
        report,
        expected: {
            sourceSha256: digests.source,
            appBuildSha256: digests.app,
            shioajiCapabilitySha256: '9'.repeat(64),
            countingDimension: 'verified-subscription-item/v1',
            officialLimitUnits: 200,
            localLimitUnits: 160,
            reservedHeadroomUnits: 40,
        },
        nowEpochMs: now,
    });
}

async function validNodeSqliteCapabilityEvidence() {
    const rawRoot = await mkdtemp(
        path.join(tmpdir(), 'gate-node-sqlite-evidence-'),
    );
    temporaryDirectories.push(rawRoot);
    const root = await realpath(rawRoot);
    await chmod(root, 0o700);
    const directories = [
        path.join(root, 'smart-order'),
        path.join(root, 'smart-order', 'evidence'),
        path.join(
            root,
            'smart-order',
            'evidence',
            'node-sqlite-capability-arm64-v2',
        ),
    ];
    for (const directory of directories) {
        await mkdir(directory, { mode: 0o700 });
        await chmod(directory, 0o700);
    }
    const evidenceDirectory = directories.at(-1);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
    const identity = {
        architecture: 'arm64',
        privateKey,
        hostKeyId: `sha256:${createHash('sha256')
            .update(publicKeyDer)
            .digest('hex')}`,
        publicKeySpkiBase64: publicKeyDer.toString('base64'),
    };
    const report = {
            schema: SMART_ORDER_NODE_SQLITE_CAPABILITY_SCHEMA,
            version: SMART_ORDER_NODE_SQLITE_CAPABILITY_VERSION,
            codeRevision: `sha256:${expectedNodeSqlite.sourceSha256}`,
            generatedAt: new Date(now - 1_000).toISOString(),
            runId: randomUUID(),
            executionMode: 'managed-local-capability',
            evidenceClass: 'node_sqlite_arm64_platform_capability',
            operationClass: 'offline-no-broker-node-sqlite-arm64-capability',
            supportPolicy: SMART_ORDER_TRADING_RUNTIME_PLATFORM_POLICY,
            attestation: {
                algorithm: 'ed25519',
                hostKeyId: identity.hostKeyId,
                payloadSha256: '',
                signatureBase64Url: '',
            },
            platform: {
                operatingSystem: 'darwin',
                macosVersion: '26.5.1',
                hypervisorPresent: 0,
                processArch: 'arm64',
                hardwareArch: 'arm64',
                nativeArchitecture: true,
                unameMachine: 'arm64',
                sysctlOptionalArm64: 1,
            },
            runtime: {
                nodeVersion: '24.19.0',
                nodeLts: 'Krypton',
                sqliteVersion: '3.50.4',
            },
            fingerprint: { ...expectedNodeSqlite },
            checks: SMART_ORDER_REQUIRED_NODE_SQLITE_CHECK_IDS.map((id) => ({
                id,
                status: 'pass',
            })),
            sideEffects: {
                brokerWritesAttempted: 0,
                brokerWritesNetworked: 0,
                serviceMutations: 0,
            },
            redactionScan: 'pass',
            testOutcome: 'pass',
            overall: 'pass',
            resultHash: '',
    };
    const payload = smartOrderNodeSqliteAttestationPayload(report);
    report.attestation.payloadSha256 = `sha256:${createHash('sha256')
        .update(payload)
        .digest('hex')}`;
    report.attestation.signatureBase64Url = sign(
        null,
        Buffer.from(payload, 'utf8'),
        identity.privateKey,
    ).toString('base64url');
    report.resultHash = createHash('sha256')
        .update(canonicalJson({ ...report, resultHash: '' }))
        .digest('hex');
    await writeFile(
        path.join(evidenceDirectory, 'trusted-hosts.json'),
        `${JSON.stringify({
            schemaVersion:
                SMART_ORDER_NODE_SQLITE_TRUST_MANIFEST_SCHEMA_VERSION,
            generation: 1,
            host: {
                architecture: 'arm64',
                hostKeyId: identity.hostKeyId,
                publicKeySpkiBase64: identity.publicKeySpkiBase64,
            },
            reportBinding: {
                resultHash: report.resultHash,
                runId: report.runId,
            },
        })}\n`,
        { mode: 0o600 },
    );
    await writeFile(
        path.join(evidenceDirectory, 'arm64.report.json'),
        `${JSON.stringify(report)}\n`,
        { mode: 0o600 },
    );
    return verifySmartOrderNodeSqliteCapabilityEvidence({
        appSupportRoot: root,
        nowEpochMs: now,
        readPlatformSupport: async () => ({
            supportPolicy: SMART_ORDER_TRADING_RUNTIME_PLATFORM_POLICY,
        }),
    });
}

describe('smart-order machine-readable gate manifest', () => {
    it('fails closed when the current manifest is missing', () => {
        expect(
            validateSmartOrderGateManifest({
                manifest: undefined,
                currentFingerprints: fingerprints,
                currentEvidence: [validReadonlyEvidence()],
                currentProductBoundaryConsentVersion: consentVersion,
                nowEpochMs: now,
            }),
        ).toEqual({
            valid: false,
            state: 'observe_only',
            reasons: ['manifest_shape_invalid'],
        });
    });

    it('remains observe-only when any required evidence class is missing', () => {
        const manifest = createManifest();
        expect(manifest.state).toBe('observe_only');
        expect(manifest.blockers).toContain('missing_evidence:route_coverage');
        expect(manifest.blockers).toContain(
            'missing_evidence:subscription_ownership',
        );
        expect(Object.values(manifest.featureGates)).toEqual([
            false,
            false,
            false,
            false,
            false,
            false,
            false,
        ]);
        expect(manifest).toMatchObject({
            containsSecrets: false,
            containsAccountIdentifiers: false,
            browserMutable: false,
        });
        expect(
            validateSmartOrderGateManifest({
                manifest,
                currentFingerprints: fingerprints,
                currentEvidence: [validReadonlyEvidence()],
                currentProductBoundaryConsentVersion: consentVersion,
                nowEpochMs: now,
            }),
        ).toMatchObject({
            valid: false,
            state: 'observe_only',
            reasons: expect.arrayContaining(['evidence_catalog_mismatch']),
        });
    });

    it.each(['5173', '5174', 'external_clients'])(
        'rejects subscription ownership when %s usage is unknown',
        (unknownConsumerId) => {
            const report = subscriptionOwnershipReport();
            const consumers = report.consumers.map((consumer) =>
                consumer.consumerId === unknownConsumerId
                    ? { ...consumer, usageKnown: false, usageUnits: null }
                    : consumer,
            );
            const unknownUsageReport = subscriptionOwnershipReport({
                consumers,
                pool: {
                    ...report.pool,
                    usageComplete: false,
                    totalUsageUnits: 12,
                },
            });
            const evidence = verifySubscriptionOwnership(unknownUsageReport);
            expect(evidence).toEqual({
                eligible: false,
                evidenceClass: 'subscription_ownership',
                reasons: expect.arrayContaining([
                    'consumer_usage_unknown',
                    'ownership_or_usage_incomplete',
                ]),
            });
            expect(() =>
                createManifest({
                    evidence: [validReadonlyEvidence(), evidence],
                }),
            ).toThrow('not issued by the verifier');
        },
    );

    it('accepts only a complete known subscription catalog and still leaves unrelated gates closed', () => {
        const ownership = verifySubscriptionOwnership(
            subscriptionOwnershipReport(),
        );
        expect(ownership).toMatchObject({
            eligible: true,
            evidenceClass: 'subscription_ownership',
        });
        const manifest = createManifest({
            evidence: [validReadonlyEvidence(), ownership],
        });
        expect(manifest.blockers).not.toContain(
            'missing_evidence:subscription_ownership',
        );
        expect(manifest.state).toBe('observe_only');
        expect(Object.values(manifest.featureGates).every((gate) => !gate)).toBe(
            true,
        );
    });

    it('requires verifier-issued physical Node SQLite evidence for every write provenance', async () => {
        const nodeSqlite = await validNodeSqliteCapabilityEvidence();
        for (const provenance of [
            'automation',
            'manual_user_confirmed',
            'gate_probe',
        ]) {
            const missing = createManifest({ provenance });
            expect(missing.blockers).toContain(
                'missing_evidence:node_sqlite_capability',
            );
            const manifest = createManifest({
                provenance,
                evidence: [validReadonlyEvidence(), nodeSqlite],
            });
            expect(manifest.blockers).not.toContain(
                'missing_evidence:node_sqlite_capability',
            );
            expect(manifest.state).toBe('observe_only');
        }
        expect(() =>
            createManifest({
                evidence: [validReadonlyEvidence(), { ...nodeSqlite }],
            }),
        ).toThrow('not issued by the verifier');
    });

    it('validates only with the same current verified evidence object content', () => {
        const evidence = validReadonlyEvidence();
        const manifest = createManifest({ evidence: [evidence] });
        expect(
            validateSmartOrderGateManifest({
                manifest,
                currentFingerprints: fingerprints,
                currentEvidence: [evidence],
                currentProductBoundaryConsentVersion: consentVersion,
                nowEpochMs: now,
            }),
        ).toMatchObject({ valid: true, state: 'observe_only' });
    });

    it('rejects feature-only unlock, tamper, stale fingerprints, and plain evidence clones', () => {
        const evidence = validReadonlyEvidence();
        const manifest = createManifest({
            evidence: [evidence],
            featureGates: Object.freeze(
                Object.fromEntries(
                    SMART_ORDER_FEATURE_GATE_IDS.map((id) => [id, true]),
                ),
            ),
        });
        expect(manifest.state).toBe('observe_only');
        expect(manifest.blockers).toContain(
            'missing_evidence:subscription_ownership',
        );
        expect(() =>
            createManifest({ evidence: [{ ...evidence }] }),
        ).toThrow('not issued by the verifier');

        const tampered = { ...manifest, state: 'eligible' };
        expect(
            validateSmartOrderGateManifest({
                manifest: tampered,
                currentFingerprints: fingerprints,
                currentEvidence: [evidence],
                currentProductBoundaryConsentVersion: consentVersion,
                nowEpochMs: now,
            }),
        ).toMatchObject({
            valid: false,
            state: 'observe_only',
            reasons: expect.arrayContaining([
                'manifest_hash_or_schema_invalid',
                'state_projection_mismatch',
            ]),
        });
        expect(
            validateSmartOrderGateManifest({
                manifest,
                currentFingerprints: {
                    ...fingerprints,
                    adapterSha256: `sha256:${'f'.repeat(64)}`,
                },
                currentEvidence: [evidence],
                currentProductBoundaryConsentVersion: consentVersion,
                nowEpochMs: now,
            }),
        ).toMatchObject({
            valid: false,
            reasons: expect.arrayContaining(['fingerprint_mismatch']),
        });
    });

    it.each([
        [
            'app build',
            {
                appBuildSha256: `sha256:${'c'.repeat(64)}`,
            },
        ],
        [
            'Shioaji capability',
            {
                shioajiCapabilitySha256: `sha256:${'d'.repeat(64)}`,
            },
        ],
        [
            'Shioaji server version',
            {
                shioajiServerVersion: 'v9.9.9',
            },
        ],
    ])('returns observe-only for current %s fingerprint drift', (_label, drift) => {
        const evidence = validReadonlyEvidence();
        const manifest = createManifest({ evidence: [evidence] });
        expect(
            validateSmartOrderGateManifest({
                manifest,
                currentFingerprints: { ...fingerprints, ...drift },
                currentEvidence: [evidence],
                currentProductBoundaryConsentVersion: consentVersion,
                nowEpochMs: now,
            }),
        ).toMatchObject({
            valid: false,
            state: 'observe_only',
            reasons: expect.arrayContaining(['fingerprint_mismatch']),
        });
    });

    it('rejects expired manifests even when their evidence originally matched', () => {
        const evidence = validReadonlyEvidence();
        const manifest = createManifest({ evidence: [evidence] });
        expect(
            validateSmartOrderGateManifest({
                manifest,
                currentFingerprints: fingerprints,
                currentEvidence: [evidence],
                currentProductBoundaryConsentVersion: consentVersion,
                nowEpochMs: manifest.validUntilEpochMs,
            }),
        ).toMatchObject({
            valid: false,
            state: 'observe_only',
            reasons: expect.arrayContaining(['manifest_expired']),
        });
    });

    it('fails closed for stale consent and malformed semantic subtrees', () => {
        const evidence = validReadonlyEvidence();
        const manifest = createManifest({ evidence: [evidence] });
        expect(
            validateSmartOrderGateManifest({
                manifest,
                currentFingerprints: fingerprints,
                currentEvidence: [evidence],
                currentProductBoundaryConsentVersion: 'local-sidecar-consent/v2',
                nowEpochMs: now,
            }),
        ).toMatchObject({
            valid: false,
            reasons: expect.arrayContaining([
                'product_boundary_consent_mismatch',
            ]),
        });

        expect(
            validateSmartOrderGateManifest({
                manifest: { ...manifest, fingerprints: null },
                currentFingerprints: fingerprints,
                currentEvidence: [evidence],
                currentProductBoundaryConsentVersion: consentVersion,
                nowEpochMs: now,
            }),
        ).toMatchObject({
            valid: false,
            state: 'observe_only',
            reasons: expect.arrayContaining(['manifest_semantics_invalid']),
        });
    });
});
