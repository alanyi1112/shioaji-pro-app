import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    SMART_ORDER_TASK_PROBE_WRITE_PREFLIGHT_SCHEMA_VERSION,
    createTaskProbeWritePreflightEvidence,
    currentTaskProbeWriteSourceFingerprint,
    readTaskProbeWritePreflightReceipt,
    verifyTaskProbeWritePreflightEvidence,
    writeTaskProbeWritePreflightEvidence,
} from './task-probe-write-preflight.mjs';

const capability = Buffer.alloc(32, 0x63);
const digest = (character) => `sha256:${character.repeat(64)}`;
const createdAtEpochMs = Date.parse('2026-08-24T02:00:00.000Z');
const temporaryDirectories = [];

function input(overrides = {}) {
    return {
        schemaVersion: SMART_ORDER_TASK_PROBE_WRITE_PREFLIGHT_SCHEMA_VERSION,
        sourceFingerprintSha256: digest('1'),
        createdAtEpochMs,
        validUntilEpochMs: createdAtEpochMs + 4_000,
        coordinationId: '123e4567-e89b-42d3-a456-426614174001',
        runId: '123e4567-e89b-42d3-a456-426614174000',
        operationIdSha256: digest('2'),
        operation: 'place',
        requestSha256: digest('3'),
        envelopeSha256: digest('4'),
        marketPlanSha256: digest('5'),
        cliAuthorizationSha256: digest('6'),
        accountScopeSha256: digest('7'),
        tradeDate: '2026-08-24',
        targetIdSha256: null,
        targetRevision: null,
        apiGenerationSha256: digest('8'),
        modeExecutionLeaseEvidenceSha256: digest('9'),
        initialSimulationAttestationSha256: digest('a'),
        adjacentSimulationAttestationSha256: digest('b'),
        observerReadinessSha256: digest('c'),
        contractEvidenceSha256: digest('d'),
        quoteEvidenceSha256: digest('e'),
        positionsSha256: digest('f'),
        workingOrdersSha256: digest('0'),
        quantityCommonLots: 1,
        modeMarker: 'simulation',
        apiSimulation: true,
        sharedModeLeaseHeld: true,
        observerReady: true,
        caLoaded: false,
        productionLoaded: false,
        automaticRetryAllowed: false,
        blindCleanupAllowed: false,
        brokerWriteAttempted: false,
        brokerWriteNetworked: false,
        accountIdentifiersPersisted: false,
        ...overrides,
    };
}

function expected(value) {
    return {
        accountScopeSha256: value.accountScopeSha256,
        apiGenerationSha256: value.apiGenerationSha256,
        coordinationId: value.coordinationId,
        envelopeSha256: value.envelopeSha256,
        marketPlanSha256: value.marketPlanSha256,
        operation: value.operation,
        operationIdSha256: value.operationIdSha256,
        requestSha256: value.requestSha256,
        runId: value.runId,
        sourceFingerprintSha256: value.sourceFingerprintSha256,
        targetIdSha256: value.targetIdSha256,
        targetRevision: value.targetRevision,
    };
}

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) =>
            rm(directory, { recursive: true, force: true }),
        ),
    );
});

describe('task-specific probe write preflight', () => {
    it.each([
        ['place', null, null],
        ['update_price', digest('9'), 3],
        ['cancel', digest('9'), 4],
    ])('signs and verifies exact %s evidence without broker authority', (operation, targetIdSha256, targetRevision) => {
        const source = input({ operation, targetIdSha256, targetRevision });
        const evidence = createTaskProbeWritePreflightEvidence({ capability, input: source });
        expect(
            verifyTaskProbeWritePreflightEvidence({
                capability,
                evidence,
                expected: expected(source),
                nowEpochMs: createdAtEpochMs + 1,
            }),
        ).toMatchObject({ eligible: true, brokerAuthority: false });
    });

    it.each([
        ['production', { productionLoaded: true }],
        ['CA', { caLoaded: true }],
        ['not simulation', { apiSimulation: false }],
        ['observer missing', { observerReady: false }],
        ['retry', { automaticRetryAllowed: true }],
        ['cleanup', { blindCleanupAllowed: true }],
        ['two lots', { quantityCommonLots: 2 }],
        ['place target', { targetIdSha256: digest('9'), targetRevision: 0 }],
        ['update without target', { operation: 'update_price' }],
        ['long lifetime', { validUntilEpochMs: createdAtEpochMs + 5_001 }],
    ])('refuses %s evidence', (_label, overrides) => {
        expect(() =>
            createTaskProbeWritePreflightEvidence({ capability, input: input(overrides) }),
        ).toThrow();
    });

    it('rejects tamper, operation confusion, replay and source drift', async () => {
        const source = input();
        const evidence = createTaskProbeWritePreflightEvidence({ capability, input: source });
        expect(
            verifyTaskProbeWritePreflightEvidence({
                capability,
                evidence: { ...evidence, brokerWriteAttempted: true },
                expected: expected(source),
                nowEpochMs: createdAtEpochMs + 1,
            }).eligible,
        ).toBe(false);
        expect(
            verifyTaskProbeWritePreflightEvidence({
                capability,
                evidence,
                expected: { ...expected(source), operation: 'cancel' },
                nowEpochMs: createdAtEpochMs + 1,
            }).eligible,
        ).toBe(false);
        expect(
            verifyTaskProbeWritePreflightEvidence({
                capability,
                evidence,
                expected: { ...expected(source), sourceFingerprintSha256: digest('f') },
                nowEpochMs: createdAtEpochMs + 1,
            }).eligible,
        ).toBe(false);
        const directory = await mkdtemp(path.join(tmpdir(), 'task-probe-preflight-'));
        temporaryDirectories.push(directory);
        const evidencePath = path.join(directory, 'evidence.json');
        await writeTaskProbeWritePreflightEvidence({ evidence, evidencePath });
        await expect(
            readTaskProbeWritePreflightReceipt({
                capability,
                evidencePath,
                expected: expected(source),
                nowEpochMs: createdAtEpochMs + 1,
            }),
        ).resolves.toMatchObject({ receipt: {}, verification: { eligible: true } });
        await expect(
            readTaskProbeWritePreflightReceipt({
                capability,
                evidencePath,
                expected: expected(source),
                nowEpochMs: createdAtEpochMs + 1,
            }),
        ).rejects.toThrow('already issued');
        await expect(
            writeTaskProbeWritePreflightEvidence({ evidence, evidencePath }),
        ).rejects.toMatchObject({ code: 'EEXIST' });
        expect((await stat(evidencePath)).mode & 0o777).toBe(0o600);
    });

    it('fingerprints the separate task-specific source without changing Task 0.3', async () => {
        await expect(currentTaskProbeWriteSourceFingerprint()).resolves.toMatch(
            /^sha256:[0-9a-f]{64}$/,
        );
    });
});
