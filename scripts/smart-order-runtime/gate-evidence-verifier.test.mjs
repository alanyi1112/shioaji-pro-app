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
    readFile,
    realpath,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runReadOnlyContractProbe } from '../smart-order-contract-probe.mjs';
import { canonicalJson } from './canonical-json.mjs';
import {
    SMART_ORDER_NODE_SQLITE_CAPABILITY_SCHEMA,
    SMART_ORDER_NODE_SQLITE_CAPABILITY_VERSION,
    SMART_ORDER_NODE_SQLITE_TRUST_MANIFEST_SCHEMA_VERSION,
    SMART_ORDER_READONLY_PROBE_SCHEMA,
    SMART_ORDER_READONLY_PROBE_VERSION,
    SMART_ORDER_REQUIRED_NODE_SQLITE_CHECK_IDS,
    SMART_ORDER_REQUIRED_READONLY_CHECK_IDS,
    currentSmartOrderNodeSqliteCapabilityFingerprints,
    isVerifiedSmartOrderGateEvidence,
    smartOrderNodeSqliteAttestationPayload,
    verifySmartOrderNodeSqliteCapabilityEvidence,
    verifySmartOrderReadonlyProbeEvidence,
} from './gate-evidence-verifier.mjs';
import { SMART_ORDER_TRADING_RUNTIME_PLATFORM_POLICY } from './trading-runtime-platform-support.mjs';
import { currentSmartOrderNodeSqliteCapabilityAuthorityStateSync } from './node-sqlite-capability-current-state.mjs';

const now = 1_786_381_000_000;
const expected = Object.freeze({
    probeSourceSha256: '1'.repeat(64),
    appBuildSha256: '2'.repeat(64),
    adapterSha256: '3'.repeat(64),
    shioajiVersion: 'v1.2.3',
});
const expectedNodeSqlite =
    await currentSmartOrderNodeSqliteCapabilityFingerprints();
const acceptedPlatformSupport = async () => ({
    supportPolicy:
        'smart-order-trading-runtime-platform/native-apple-silicon-arm64/2026-08-22.1',
});
const temporaryDirectories = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) => rm(directory, { recursive: true, force: true })),
    );
});

function resultHash(report) {
    return createHash('sha256')
        .update(canonicalJson({ ...report, resultHash: '' }))
        .digest('hex');
}

function validReport() {
    const report = {
        schema: SMART_ORDER_READONLY_PROBE_SCHEMA,
        version: SMART_ORDER_READONLY_PROBE_VERSION,
        codeRevision: `sha256:${expected.probeSourceSha256}`,
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
            probeSourceSha256: expected.probeSourceSha256,
            appBuildSha256: expected.appBuildSha256,
            adapterSha256: expected.adapterSha256,
            expectedShioajiVersion: expected.shioajiVersion,
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
    report.resultHash = resultHash(report);
    return report;
}

function validNodeSqliteReport(signingIdentity) {
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
            hostKeyId: signingIdentity.hostKeyId,
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
        signingIdentity.privateKey,
    ).toString('base64url');
    report.resultHash = resultHash(report);
    return report;
}

function resignNodeSqliteReport(report, signingIdentity) {
    report.attestation = {
        algorithm: 'ed25519',
        hostKeyId: signingIdentity.hostKeyId,
        payloadSha256: '',
        signatureBase64Url: '',
    };
    const payload = smartOrderNodeSqliteAttestationPayload(report);
    report.attestation.payloadSha256 = `sha256:${createHash('sha256')
        .update(payload)
        .digest('hex')}`;
    report.attestation.signatureBase64Url = sign(
        null,
        Buffer.from(payload, 'utf8'),
        signingIdentity.privateKey,
    ).toString('base64url');
    report.resultHash = resultHash(report);
    return report;
}

async function nodeSqliteEvidenceStore() {
    const rawRoot = await mkdtemp(path.join(tmpdir(), 'node-sqlite-evidence-'));
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
    const report = validNodeSqliteReport(identity);
    const trustManifest = {
        schemaVersion: SMART_ORDER_NODE_SQLITE_TRUST_MANIFEST_SCHEMA_VERSION,
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
    };
    await writeFile(
        path.join(evidenceDirectory, 'trusted-hosts.json'),
        `${JSON.stringify(trustManifest)}\n`,
        { mode: 0o600 },
    );
    await writeFile(
        path.join(evidenceDirectory, 'arm64.report.json'),
        `${JSON.stringify(report)}\n`,
        { mode: 0o600 },
    );
    return { root, report, identity, evidenceDirectory };
}

async function writeFixtureReport(fixture, report) {
    await writeFile(
        path.join(fixture.evidenceDirectory, 'arm64.report.json'),
        `${JSON.stringify(report)}\n`,
        { mode: 0o600, flag: 'w' },
    );
}

async function bindFixtureReport(fixture, report) {
    const manifestPath = path.join(
        fixture.evidenceDirectory,
        'trusted-hosts.json',
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.reportBinding = {
        resultHash: report.resultHash,
        runId: report.runId,
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, {
        mode: 0o600,
        flag: 'w',
    });
}

describe('smart-order Gate 0 evidence verifier', () => {
    it('independently accepts an exact current eligible report', () => {
        const evidence = verifySmartOrderReadonlyProbeEvidence({
            report: validReport(),
            expected,
            nowEpochMs: now,
        });
        expect(evidence).toMatchObject({
            eligible: true,
            evidenceClass: 'live_readonly',
            containsAccountIdentifiers: false,
            brokerWriteAttempted: false,
        });
        expect(isVerifiedSmartOrderGateEvidence(evidence)).toBe(true);
        expect(isVerifiedSmartOrderGateEvidence({ ...evidence })).toBe(false);
    });

    it('mechanically rejects fixture reports even if booleans are changed', async () => {
        const fixture = await runReadOnlyContractProbe();
        const forged = {
            ...fixture,
            evidenceEligible: true,
            eligibleForTask0_3: true,
            eligibleForGateManifest: true,
            overall: 'pass',
        };
        forged.resultHash = resultHash(forged);
        const decision = verifySmartOrderReadonlyProbeEvidence({
            report: forged,
            expected,
            nowEpochMs: now,
        });
        expect(decision.eligible).toBe(false);
        expect(decision.reasons).toContain('fixture_or_operation_class_forbidden');
    });

    it.each([
        ['result hash', (report) => (report.resultHash = '0'.repeat(64)), 'result_hash_mismatch'],
        [
            'duplicate required check',
            (report) => {
                report.checks = [...report.checks, report.checks[0]];
                report.resultHash = resultHash(report);
            },
            'required_checks_invalid',
        ],
        [
            'blocked check',
            (report) => {
                report.checks[0] = { ...report.checks[0], status: 'blocked' };
                report.resultHash = resultHash(report);
            },
            'required_checks_invalid',
        ],
        [
            'broker write counter',
            (report) => {
                report.network.brokerWritesAttempted = 1;
                report.resultHash = resultHash(report);
            },
            'broker_write_observed',
        ],
        [
            'source fingerprint',
            (report) => {
                report.fingerprint.probeSourceSha256 = '9'.repeat(64);
                report.resultHash = resultHash(report);
            },
            'fingerprint_mismatch',
        ],
        [
            'generation evidence class',
            (report) => {
                report.managedRuntime.generationEvidenceClass = 'unverified';
                report.resultHash = resultHash(report);
            },
            'managed_runtime_or_lease_invalid',
        ],
    ])('rejects a tampered %s', (_label, mutate, expectedReason) => {
        const report = validReport();
        mutate(report);
        const decision = verifySmartOrderReadonlyProbeEvidence({
            report,
            expected,
            nowEpochMs: now,
        });
        expect(decision.eligible).toBe(false);
        expect(decision.reasons).toContain(expectedReason);
    });

    it('rejects stale evidence and unknown schema fields', () => {
        const stale = validReport();
        stale.generatedAt = new Date(now - 600_001).toISOString();
        stale.resultHash = resultHash(stale);
        expect(
            verifySmartOrderReadonlyProbeEvidence({ report: stale, expected, nowEpochMs: now }),
        ).toMatchObject({
            eligible: false,
            reasons: expect.arrayContaining(['report_time_invalid_or_stale']),
        });
        expect(
            verifySmartOrderReadonlyProbeEvidence({
                report: { ...validReport(), unexpected: true },
                expected,
                nowEpochMs: now,
                readPlatformSupport: acceptedPlatformSupport,
            }),
        ).toEqual({
            eligible: false,
            evidenceClass: 'invalid',
            reasons: ['report_schema_invalid'],
        });
    });

    it('fails closed instead of throwing on a non-canonical report value', () => {
        const malformed = validReport();
        malformed.network.requestCount = 1.5;
        expect(() =>
            verifySmartOrderReadonlyProbeEvidence({
                report: malformed,
                expected,
                nowEpochMs: now,
            }),
        ).not.toThrow();
        expect(
            verifySmartOrderReadonlyProbeEvidence({
                report: malformed,
                expected,
                nowEpochMs: now,
            }),
        ).toMatchObject({
            eligible: false,
            reasons: expect.arrayContaining([
                'network_metrics_invalid',
                'result_hash_mismatch',
            ]),
        });
    });
});

describe('smart-order Node SQLite Apple Silicon capability verifier', () => {
    it('refuses to issue authority on a current x64, Rosetta, VM, or non-macOS runtime', async () => {
        await expect(
            verifySmartOrderNodeSqliteCapabilityEvidence({
                appSupportRoot: '/private/unused',
                nowEpochMs: now,
                readPlatformSupport: async () => {
                    throw new Error('unsupported platform');
                },
            }),
        ).resolves.toEqual({
            eligible: false,
            evidenceClass: 'node_sqlite_capability',
            reasons: ['current_runtime_platform_unsupported'],
        });
    });

    it('issues gate evidence for one bound native Apple Silicon arm64 report', async () => {
        const fixture = await nodeSqliteEvidenceStore();
        const evidence =
            await verifySmartOrderNodeSqliteCapabilityEvidence({
                appSupportRoot: fixture.root,
                nowEpochMs: now,
                readPlatformSupport: acceptedPlatformSupport,
            });
        expect(evidence).toMatchObject({
            eligible: true,
            evidenceClass: 'node_sqlite_capability',
            architectures: ['arm64'],
            containsAccountIdentifiers: false,
            brokerWriteAttempted: false,
        });
        expect(isVerifiedSmartOrderGateEvidence(evidence)).toBe(true);
        expect(isVerifiedSmartOrderGateEvidence({ ...evidence })).toBe(false);
        expect(evidence).toMatchObject({
            sourceSha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            sourceMatrixSha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            trustGeneration: 1,
            trustManifestSha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            trustedHostKeyIds: [fixture.identity.hostKeyId],
            trustedReportSha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        });
        expect(evidence.sourceSha256).toBe(
            currentSmartOrderNodeSqliteCapabilityAuthorityStateSync(
                fixture.root,
            ).authoritySha256,
        );
    });

    it('changes the authority digest immediately when trust generation rotates', async () => {
        const fixture = await nodeSqliteEvidenceStore();
        const before =
            await verifySmartOrderNodeSqliteCapabilityEvidence({
                appSupportRoot: fixture.root,
                nowEpochMs: now,
                readPlatformSupport: acceptedPlatformSupport,
            });
        const manifestPath = path.join(
            fixture.evidenceDirectory,
            'trusted-hosts.json',
        );
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        manifest.generation += 1;
        await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, {
            mode: 0o600,
            flag: 'w',
        });
        const after =
            await verifySmartOrderNodeSqliteCapabilityEvidence({
                appSupportRoot: fixture.root,
                nowEpochMs: now,
                readPlatformSupport: acceptedPlatformSupport,
            });
        expect(after.eligible).toBe(true);
        expect(after.trustGeneration).toBe(2);
        expect(after.sourceSha256).not.toBe(before.sourceSha256);
        expect(after.evidenceId).not.toBe(before.evidenceId);
        expect(after.resultSha256).not.toBe(before.resultSha256);
    });

    it('rejects a missing arm64 report and an old dual-host trust schema', async () => {
        const missing = await nodeSqliteEvidenceStore();
        await rm(path.join(missing.evidenceDirectory, 'arm64.report.json'));
        expect(
            await verifySmartOrderNodeSqliteCapabilityEvidence({
                appSupportRoot: missing.root,
                nowEpochMs: now,
                readPlatformSupport: acceptedPlatformSupport,
            }),
        ).toMatchObject({
            eligible: false,
            reasons: ['private_evidence_store_invalid_or_incomplete'],
        });

        const legacy = await nodeSqliteEvidenceStore();
        await writeFile(
            path.join(legacy.evidenceDirectory, 'trusted-hosts.json'),
            `${JSON.stringify({
                schemaVersion: 'smart-order-node-sqlite-trusted-hosts/2026-08-22.2',
                generation: 1,
                hosts: [],
            })}\n`,
            { mode: 0o600, flag: 'w' },
        );
        expect(
            await verifySmartOrderNodeSqliteCapabilityEvidence({
                appSupportRoot: legacy.root,
                nowEpochMs: now,
                readPlatformSupport: acceptedPlatformSupport,
            }),
        ).toMatchObject({
            eligible: false,
            reasons: ['private_evidence_store_invalid_or_incomplete'],
        });
    });

    it.each([
        [
            'Rosetta process',
            (report) => {
                report.platform.processArch = 'x64';
                report.platform.unameMachine = 'x86_64';
            },
            'native_apple_silicon_arm64_not_proven',
        ],
        [
            'native Intel x64',
            (report) => {
                report.platform.hardwareArch = 'x64';
                report.platform.processArch = 'x64';
                report.platform.unameMachine = 'x86_64';
                report.platform.sysctlOptionalArm64 = 0;
            },
            'native_apple_silicon_arm64_not_proven',
        ],
        [
            'virtualized hardware',
            (report) => {
                report.platform.hypervisorPresent = 1;
            },
            'native_apple_silicon_arm64_not_proven',
        ],
        [
            'Node 26',
            (report) => {
                report.runtime.nodeVersion = '26.0.0';
            },
            'node_or_sqlite_runtime_unsupported',
        ],
        [
            'duplicate check',
            (report) => {
                report.checks.push(report.checks[0]);
            },
            'required_checks_invalid',
        ],
        [
            'service mutation',
            (report) => {
                report.sideEffects.serviceMutations = 1;
            },
            'side_effect_observed',
        ],
        [
            'source drift',
            (report) => {
                report.fingerprint.sourceSha256 = '9'.repeat(64);
            },
            'fingerprint_mismatch',
        ],
    ])('rejects %s even with a valid trusted-host signature', async (_label, mutate, reason) => {
        const fixture = await nodeSqliteEvidenceStore();
        const arm64 = fixture.report;
        mutate(arm64);
        resignNodeSqliteReport(arm64, fixture.identity);
        await writeFixtureReport(fixture, arm64);
        await bindFixtureReport(fixture, arm64);
        const decision =
            await verifySmartOrderNodeSqliteCapabilityEvidence({
                appSupportRoot: fixture.root,
                nowEpochMs: now,
                readPlatformSupport: acceptedPlatformSupport,
            });
        expect(decision).toMatchObject({
            eligible: false,
            reasons: expect.arrayContaining([reason]),
        });
    });

    it('rejects stale reports and reports from the old capability schema', async () => {
        const staleFixture = await nodeSqliteEvidenceStore();
        const stale = staleFixture.report;
        stale.generatedAt = new Date(now - 24 * 60 * 60 * 1000 - 1).toISOString();
        resignNodeSqliteReport(stale, staleFixture.identity);
        await writeFixtureReport(staleFixture, stale);
        await bindFixtureReport(staleFixture, stale);
        expect(
            await verifySmartOrderNodeSqliteCapabilityEvidence({
                appSupportRoot: staleFixture.root,
                nowEpochMs: now,
                readPlatformSupport: acceptedPlatformSupport,
            }),
        ).toMatchObject({
            eligible: false,
            reasons: expect.arrayContaining(['report_time_invalid_or_stale']),
        });

        const legacyFixture = await nodeSqliteEvidenceStore();
        const legacy = legacyFixture.report;
        legacy.schema = 'realtimestock.smart-order-node-sqlite-capability/v1';
        legacy.version = '2026-08-22.1';
        resignNodeSqliteReport(legacy, legacyFixture.identity);
        await writeFixtureReport(legacyFixture, legacy);
        await bindFixtureReport(legacyFixture, legacy);
        expect(
            await verifySmartOrderNodeSqliteCapabilityEvidence({
                appSupportRoot: legacyFixture.root,
                nowEpochMs: now,
                readPlatformSupport: acceptedPlatformSupport,
            }),
        ).toMatchObject({
            eligible: false,
            reasons: expect.arrayContaining([
                'report_schema_or_operation_class_invalid',
            ]),
        });
    });

    it('rejects a self-signed report whose host key is not in the private trust store', async () => {
        const fixture = await nodeSqliteEvidenceStore();
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
        const untrusted = {
            privateKey,
            hostKeyId: `sha256:${createHash('sha256')
                .update(publicKeyDer)
                .digest('hex')}`,
        };
        resignNodeSqliteReport(fixture.report, untrusted);
        await writeFixtureReport(fixture, fixture.report);
        await bindFixtureReport(fixture, fixture.report);
        expect(
            await verifySmartOrderNodeSqliteCapabilityEvidence({
                appSupportRoot: fixture.root,
                nowEpochMs: now,
                readPlatformSupport: acceptedPlatformSupport,
            }),
        ).toMatchObject({
            eligible: false,
            reasons: expect.arrayContaining([
                'host_attestation_invalid_or_untrusted',
            ]),
        });
    });

    it('rejects a replay that no longer matches the trust-manifest report lineage', async () => {
        const fixture = await nodeSqliteEvidenceStore();
        const replay = structuredClone(fixture.report);
        fixture.report.runId = randomUUID();
        fixture.report.generatedAt = new Date(now - 500).toISOString();
        resignNodeSqliteReport(fixture.report, fixture.identity);
        await bindFixtureReport(fixture, fixture.report);
        await writeFixtureReport(fixture, replay);
        expect(
            await verifySmartOrderNodeSqliteCapabilityEvidence({
                appSupportRoot: fixture.root,
                nowEpochMs: now,
                readPlatformSupport: acceptedPlatformSupport,
            }),
        ).toMatchObject({
            eligible: false,
            reasons: expect.arrayContaining([
                'trusted_report_binding_mismatch_or_replay',
            ]),
        });
        expect(() =>
            currentSmartOrderNodeSqliteCapabilityAuthorityStateSync(
                fixture.root,
            ),
        ).toThrow('does not match trusted lineage');
    });

    it('rejects a forged report that was not signed after mutation', async () => {
        const fixture = await nodeSqliteEvidenceStore();
        fixture.report.runtime.sqliteVersion = '9.9.9';
        fixture.report.resultHash = resultHash(fixture.report);
        await writeFixtureReport(fixture, fixture.report);
        await bindFixtureReport(fixture, fixture.report);
        await expect(
            verifySmartOrderNodeSqliteCapabilityEvidence({
                appSupportRoot: fixture.root,
                nowEpochMs: now,
                readPlatformSupport: acceptedPlatformSupport,
            }),
        ).resolves.toMatchObject({
            eligible: false,
            reasons: expect.arrayContaining([
                'host_attestation_invalid_or_untrusted',
            ]),
        });
    });

    it('changes dispatch authority when signed payload bytes are replaced without changing trusted lineage', async () => {
        const fixture = await nodeSqliteEvidenceStore();
        const original = currentSmartOrderNodeSqliteCapabilityAuthorityStateSync(
            fixture.root,
        );
        fixture.report.runtime.sqliteVersion = '9.9.9';
        await writeFixtureReport(fixture, fixture.report);
        const replaced = currentSmartOrderNodeSqliteCapabilityAuthorityStateSync(
            fixture.root,
        );
        expect(replaced.trustedReportRunId).toBe(original.trustedReportRunId);
        expect(replaced.trustedReportResultHash).toBe(
            original.trustedReportResultHash,
        );
        expect(replaced.trustedReportSha256).not.toBe(
            original.trustedReportSha256,
        );
        expect(replaced.authoritySha256).not.toBe(original.authoritySha256);
    });
});
