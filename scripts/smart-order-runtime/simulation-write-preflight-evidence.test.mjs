import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    SMART_ORDER_SIMULATION_WRITE_PREFLIGHT_EVIDENCE_SCHEMA_VERSION,
    createSimulationWritePreflightEvidence,
    currentSimulationWritePreflightSourceFingerprint,
    readVerifiedSimulationWritePreflightEvidence,
    verifySimulationWritePreflightEvidence,
} from './simulation-write-preflight-evidence.mjs';

const capability = Buffer.alloc(32, 0x5a);
const createdAtEpochMs = Date.parse('2026-08-23T01:00:00.000Z');
const deadlineEpochMs = createdAtEpochMs + 30_000;
const digest = (character) => `sha256:${character.repeat(64)}`;

function input(overrides = {}) {
    const accountScopeSha256 = digest('a');
    return {
        schemaVersion:
            SMART_ORDER_SIMULATION_WRITE_PREFLIGHT_EVIDENCE_SCHEMA_VERSION,
        sourceFingerprintSha256: digest('1'),
        createdAtEpochMs,
        coordinationId: '123e4567-e89b-42d3-a456-426614174000',
        operationIdSha256: digest('2'),
        operation: 'place',
        requestSha256: digest('3'),
        envelopeSha256: digest('4'),
        cliAuthorizationSha256: digest('d'),
        accountScopeSha256,
        maskedAccountRef: `…${accountScopeSha256.slice(-12)}`,
        accountType: 'S',
        modeMarker: 'simulation',
        apiSimulation: true,
        apiGenerationSha256: digest('5'),
        sharedModeLeaseHeld: true,
        modeExecutionLeaseEvidenceHash: digest('6'),
        initialSimulationAttestationSha256: digest('7'),
        adjacentSimulationAttestationSha256: digest('8'),
        readinessCurrent: true,
        readinessEvidenceSha256: digest('9'),
        readinessDeadlineEpochMs: deadlineEpochMs,
        quantityUnit: 'CommonLot',
        requestedQuantity: 1,
        maximumQuantity: 1,
        caLoaded: false,
        productionLoaded: false,
        automaticRetryAllowed: false,
        cleanupAllowed: false,
        accountIdentifiersPersisted: false,
        brokerWriteAttempted: false,
        brokerWriteNetworked: false,
        ...overrides,
    };
}

function expected(value = input()) {
    return {
        accountScopeSha256: value.accountScopeSha256,
        apiGenerationSha256: value.apiGenerationSha256,
        coordinationId: value.coordinationId,
        cliAuthorizationSha256: value.cliAuthorizationSha256,
        envelopeSha256: value.envelopeSha256,
        operationIdSha256: value.operationIdSha256,
        readinessEvidenceSha256: value.readinessEvidenceSha256,
        requestSha256: value.requestSha256,
        sourceFingerprintSha256: value.sourceFingerprintSha256,
    };
}

describe('simulation write preflight evidence', () => {
    it('signs and independently verifies the exact fail-closed one-lot evidence', () => {
        const source = input();
        const evidence = createSimulationWritePreflightEvidence({
            capability,
            input: source,
        });
        expect(evidence).toMatchObject({
            modeMarker: 'simulation',
            apiSimulation: true,
            readinessCurrent: true,
            quantityUnit: 'CommonLot',
            requestedQuantity: 1,
            maximumQuantity: 1,
            caLoaded: false,
            productionLoaded: false,
            accountIdentifiersPersisted: false,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
        });
        expect(
            verifySimulationWritePreflightEvidence({
                capability,
                evidence,
                expected: expected(source),
                nowEpochMs: createdAtEpochMs + 1,
            }),
        ).toMatchObject({ eligible: true, brokerAuthority: false });
        expect(JSON.stringify(evidence)).not.toContain('SIM-ACCOUNT');
        expect(JSON.stringify(evidence)).not.toContain('SIM-BROKER');
    });

    it.each([
        ['CA loaded', { caLoaded: true }],
        ['production loaded', { productionLoaded: true }],
        ['API not simulation', { apiSimulation: false }],
        ['readiness false', { readinessCurrent: false }],
        ['two lots', { requestedQuantity: 2 }],
        ['larger maximum', { maximumQuantity: 2 }],
        ['retry allowed', { automaticRetryAllowed: true }],
        ['cleanup allowed', { cleanupAllowed: true }],
        ['write already attempted', { brokerWriteAttempted: true }],
        ['write already networked', { brokerWriteNetworked: true }],
        ['account persisted', { accountIdentifiersPersisted: true }],
        ['unmasked account', { maskedAccountRef: 'stock-account-1' }],
    ])('refuses to sign when %s', (_label, overrides) => {
        expect(() =>
            createSimulationWritePreflightEvidence({
                capability,
                input: input(overrides),
            }),
        ).toThrow();
    });

    it('rejects tamper, replay, source drift, wrong account scope, and extra fields', () => {
        const source = input();
        const evidence = createSimulationWritePreflightEvidence({
            capability,
            input: source,
        });
        const verify = (candidate, expectedOverrides = {}, nowEpochMs = createdAtEpochMs + 1) =>
            verifySimulationWritePreflightEvidence({
                capability,
                evidence: candidate,
                expected: { ...expected(source), ...expectedOverrides },
                nowEpochMs,
            });
        expect(verify({ ...evidence, readinessCurrent: false }).eligible).toBe(false);
        expect(verify(evidence, { sourceFingerprintSha256: digest('b') }).eligible).toBe(false);
        expect(verify(evidence, { accountScopeSha256: digest('c') }).eligible).toBe(false);
        expect(verify(evidence, { apiGenerationSha256: digest('c') }).eligible).toBe(false);
        expect(verify(evidence, { cliAuthorizationSha256: digest('c') }).eligible).toBe(false);
        expect(verify(evidence, { readinessEvidenceSha256: digest('c') }).eligible).toBe(false);
        expect(verify(evidence, { requestSha256: digest('c') }).eligible).toBe(false);
        expect(verify(evidence, {}, deadlineEpochMs).eligible).toBe(false);
        expect(verify({ ...evidence, unexpected: true }).eligible).toBe(false);
        expect(
            verifySimulationWritePreflightEvidence({
                capability: Buffer.alloc(32, 0x6b),
                evidence,
                expected: expected(source),
                nowEpochMs: createdAtEpochMs + 1,
            }).eligible,
        ).toBe(false);
    });

    it('binds the current production sender and safety sources', async () => {
        await expect(
            currentSimulationWritePreflightSourceFingerprint(),
        ).resolves.toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('reopens and verifies the exact private durable bytes and rejects symlinks', async () => {
        const directory = await mkdtemp(
            path.join(tmpdir(), 'simulation-write-evidence-'),
        );
        try {
            const source = input();
            const evidence = createSimulationWritePreflightEvidence({
                capability,
                input: source,
            });
            const evidencePath = path.join(directory, 'preflight.json');
            await writeFile(evidencePath, `${JSON.stringify(evidence)}\n`, {
                mode: 0o600,
            });
            const read = () =>
                readVerifiedSimulationWritePreflightEvidence({
                    capability,
                    evidencePath,
                    expected: expected(source),
                    nowEpochMs: createdAtEpochMs + 1,
                });
            await expect(read()).resolves.toMatchObject({
                verification: { eligible: true },
                durableEvidenceReceipt: {},
            });
            await expect(read()).rejects.toThrow('already issued a receipt');
            const linkPath = path.join(directory, 'preflight-link.json');
            await symlink(evidencePath, linkPath);
            await expect(
                readVerifiedSimulationWritePreflightEvidence({
                    capability,
                    evidencePath: linkPath,
                    expected: expected(source),
                    nowEpochMs: createdAtEpochMs + 1,
                }),
            ).rejects.toThrow();
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
