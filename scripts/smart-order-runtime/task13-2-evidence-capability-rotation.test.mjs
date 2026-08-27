import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION,
    createSmartOrderTask13_2FormalEvidence,
    verifySmartOrderTask13_2FormalEvidence,
} from './task13-2-formal-evidence.mjs';
import { rotateSmartOrderTask13_2EvidenceRecord } from './task13-2-evidence-capability-rotation.mjs';

const legacyCapability = Buffer.alloc(32, 0x31);
const evidenceCapability = Buffer.alloc(32, 0x52);
const sourceFingerprintSha256 = `sha256:${'a'.repeat(64)}`;
const verifierFingerprintSha256 = `sha256:${'b'.repeat(64)}`;
const predecessorArtifactSha256 = `sha256:${'c'.repeat(64)}`;

function predecessor() {
    return createSmartOrderTask13_2FormalEvidence({
        capability: legacyCapability,
        input: {
            schemaVersion:
                SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION,
            evidenceId: '11111111-2222-4333-8444-555555555555',
            taskId: '0.4',
            operationKey: 'order_deal_round_trip',
            runId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
            observedTradeDate: '2026-08-26',
            accountScopeSha256: `sha256:${'d'.repeat(64)}`,
            apiGenerationSha256: `sha256:${'e'.repeat(64)}`,
            sourceFingerprintSha256,
            verifierFingerprintSha256,
            requestSha256: `sha256:${'f'.repeat(64)}`,
            resultSha256: `sha256:${'1'.repeat(64)}`,
            targetIdSha256: null,
            quantityCommonLots: 1,
            generatedAtEpochMs: 1_787_719_795_103,
            validUntilEpochMs: null,
            formalEvidence: true,
            fixture: false,
            brokerWriteAttempted: true,
            brokerWriteNetworked: true,
            automaticRetryAllowed: false,
            blindCleanupAllowed: false,
            accountIdentifiersPersisted: false,
        },
    });
}

function trust() {
    return Object.freeze({
        sourceFingerprintSha256,
        verifierFingerprintSha256,
        artifactSha256: predecessorArtifactSha256,
    });
}

describe('Task 13.2 evidence capability rotation', () => {
    it('re-signs an exact manifest-pinned predecessor without changing its content hash', () => {
        const original = predecessor();
        const rotated = rotateSmartOrderTask13_2EvidenceRecord({
            evidenceCapability,
            evidenceKey: '0.4:order_deal_round_trip',
            legacyCapability,
            predecessor: original,
            predecessorArtifactSha256,
            trust: trust(),
        });
        expect(rotated.evidenceHashSha256).toBe(original.evidenceHashSha256);
        expect(rotated.evidenceHmacSha256).not.toBe(original.evidenceHmacSha256);
        expect(
            verifySmartOrderTask13_2FormalEvidence({
                capability: evidenceCapability,
                evidence: rotated,
                expectedSourceFingerprintSha256: sourceFingerprintSha256,
                expectedVerifierFingerprintSha256: verifierFingerprintSha256,
            }).eligible,
        ).toBe(true);
    });

    it('rejects artifact, predecessor signature and source lineage drift', () => {
        const original = predecessor();
        expect(() =>
            rotateSmartOrderTask13_2EvidenceRecord({
                evidenceCapability,
                evidenceKey: '0.4:order_deal_round_trip',
                legacyCapability,
                predecessor: original,
                predecessorArtifactSha256: `sha256:${'9'.repeat(64)}`,
                trust: trust(),
            }),
        ).toThrow('predecessor is invalid');
        expect(() =>
            rotateSmartOrderTask13_2EvidenceRecord({
                evidenceCapability,
                evidenceKey: '0.4:order_deal_round_trip',
                legacyCapability: Buffer.alloc(32, 0x77),
                predecessor: original,
                predecessorArtifactSha256,
                trust: trust(),
            }),
        ).toThrow('predecessor is invalid');
        expect(() =>
            rotateSmartOrderTask13_2EvidenceRecord({
                evidenceCapability,
                evidenceKey: '0.4:order_deal_round_trip',
                legacyCapability,
                predecessor: original,
                predecessorArtifactSha256,
                trust: {
                    ...trust(),
                    sourceFingerprintSha256: `sha256:${'8'.repeat(64)}`,
                },
            }),
        ).toThrow('predecessor is invalid');
    });
});
