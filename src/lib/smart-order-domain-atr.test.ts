import { beforeEach, describe, expect, it } from 'vitest';
import { canonicalContractKey } from './smart-order-domain';
import {
    ATR_CANONICAL_SEED_ORIGIN_SCHEMA_VERSION,
    ATR_REPOSITORY_ATTESTATION_SCHEMA_VERSION,
    ATR_REVISION_EVIDENCE_SCHEMA_VERSION,
    ATR_REVISION_EVIDENCE_TTL_MS,
    ATR_RUNTIME_CONTEXT_EVIDENCE_SCHEMA_VERSION,
    ATR_SOURCE_ENVELOPE_SCHEMA_VERSION,
    ATR_SOURCE_PAYLOAD_SCHEMA_VERSION,
    DEFAULT_WILDER_ATR_PERIOD,
    DEFAULT_WILDER_ATR_TIMEFRAME,
    FIXED_WILDER_ATR_SNAPSHOT_SCHEMA_VERSION,
    SMART_ORDER_ATR_TEST_ONLY,
    SmartOrderAtrError,
    WILDER_ATR_ALGORITHM_VERSION,
    createFixedWilderAtrSnapshot,
    hashCanonicalAtrCandles,
    retainFixedWilderAtrSnapshot,
    restoreFixedWilderAtrSnapshot,
    validateFixedWilderAtrSnapshot,
    type AtrCanonicalSeedOrigin,
    type AtrSourceEnvelope,
    type AtrSourceIntegrity,
    type CompletedAtrCandle,
    type CreateFixedWilderAtrSnapshotInput,
    type FixedWilderAtrSnapshot,
    type TrustedAtrRepositoryAttestation,
    type TrustedAtrRevisionEvidence,
    type TrustedAtrRuntimeContextEvidence,
} from './smart-order-domain-atr';
import { decimalString } from './smart-order-domain-money';

const CALENDAR_SESSION_HASH = `sha256:${'a'.repeat(64)}` as const;
const CONFIRMATION_CONTEXT_HASH = `sha256:${'c'.repeat(64)}` as const;
const BASE_MONOTONIC_NS = 10_000_000_000n;

if (!SMART_ORDER_ATR_TEST_ONLY) {
    throw new Error('ATR test support surface is unavailable in Vitest');
}
const ATR_TEST_ONLY = SMART_ORDER_ATR_TEST_ONLY;

beforeEach(() => {
    ATR_TEST_ONLY.resetAtrVerifier();
});

function expectAtrError(
    error: unknown,
    code: SmartOrderAtrError['code'],
): void {
    expect(error).toBeInstanceOf(SmartOrderAtrError);
    expect((error as SmartOrderAtrError).code).toBe(code);
}

function expectAtrActionError(
    action: () => unknown,
    code: SmartOrderAtrError['code'],
): void {
    try {
        action();
        throw new Error('expected SmartOrderAtrError');
    } catch (error) {
        expectAtrError(error, code);
    }
}

function candle(
    input: Readonly<{
        tradingDate: string;
        previousTradingDate: string | null;
        sourceSequence: number;
        open: string;
        high: string;
        low: string;
        close: string;
    }>,
): CompletedAtrCandle {
    return {
        ...input,
        completed: true,
        open: decimalString(input.open),
        high: decimalString(input.high),
        low: decimalString(input.low),
        close: decimalString(input.close),
    };
}

function wilderFixture(): readonly CompletedAtrCandle[] {
    return [
        candle({
            tradingDate: '2026-07-06',
            previousTradingDate: null,
            sourceSequence: 100,
            open: '9',
            high: '11',
            low: '9',
            close: '10',
        }),
        candle({
            tradingDate: '2026-07-07',
            previousTradingDate: '2026-07-06',
            sourceSequence: 101,
            open: '10',
            high: '12',
            low: '9',
            close: '11',
        }),
        candle({
            tradingDate: '2026-07-08',
            previousTradingDate: '2026-07-07',
            sourceSequence: 102,
            open: '11',
            high: '13',
            low: '10',
            close: '12',
        }),
        candle({
            tradingDate: '2026-07-09',
            previousTradingDate: '2026-07-08',
            sourceSequence: 103,
            open: '12',
            high: '15',
            low: '11',
            close: '14',
        }),
        candle({
            tradingDate: '2026-07-10',
            previousTradingDate: '2026-07-09',
            sourceSequence: 104,
            open: '14',
            high: '16',
            low: '13',
            close: '15',
        }),
    ];
}

function sourceEnvelope(
    overrides: Partial<AtrSourceEnvelope> = {},
): AtrSourceEnvelope {
    return {
        schemaVersion: ATR_SOURCE_ENVELOPE_SCHEMA_VERSION,
        attestationRevision: 'atr-attestation-31',
        repositoryRevision: 'repository-12',
        sourceId: 'verified-kbar-source',
        sourceRevision: 'kbar-source-7',
        contractKey: canonicalContractKey('TSE:STK:2330'),
        adjustmentBasis: 'unadjusted',
        decisionTradingDate: '2026-07-13',
        expectedAsOfTradingDate: '2026-07-10',
        calendarVersion: 'twse-calendar-2026.7',
        calendarSourceRevision: 'calendar-source-21',
        businessSessionState: 'open',
        businessSessionSourceId: 'broker-session',
        businessSessionSourceRevision: 'broker-session-88',
        calendarSessionEvidenceHash: CALENDAR_SESSION_HASH,
        confirmationContextHash: CONFIRMATION_CONTEXT_HASH,
        ...overrides,
    };
}

function seedOrigin(
    candles: readonly CompletedAtrCandle[],
    period = 3,
    overrides: Partial<AtrCanonicalSeedOrigin> = {},
): AtrCanonicalSeedOrigin {
    return {
        schemaVersion: ATR_CANONICAL_SEED_ORIGIN_SCHEMA_VERSION,
        kind: 'canonical_sma_seed',
        originRevision: 'canonical-history-4',
        anchorTradingDate: candles[0]!.tradingDate,
        seedEndTradingDate: candles[period]!.tradingDate,
        ...overrides,
    };
}

async function canonicalHash(input: {
    candles: readonly CompletedAtrCandle[];
    envelope: AtrSourceEnvelope;
    origin: AtrCanonicalSeedOrigin;
    period: number;
}): Promise<`sha256:${string}`> {
    return hashCanonicalAtrCandles({
        timeframe: '1D',
        period: input.period,
        sourceEnvelope: input.envelope,
        seedOrigin: input.origin,
        candles: input.candles,
    });
}

async function snapshotInput(
    overrides: Partial<CreateFixedWilderAtrSnapshotInput> = {},
): Promise<CreateFixedWilderAtrSnapshotInput> {
    const candles = overrides.candles ?? wilderFixture();
    const period = overrides.period ?? 3;
    const envelope = overrides.sourceEnvelope ?? sourceEnvelope();
    const origin = overrides.seedOrigin ?? seedOrigin(candles, period);
    const digest = await canonicalHash({
        candles,
        envelope,
        origin,
        period,
    });
    const sourceIntegrity: AtrSourceIntegrity =
        overrides.sourceIntegrity ?? {
            schemaVersion: ATR_SOURCE_PAYLOAD_SCHEMA_VERSION,
            canonicalCandlesHash: digest,
            coverageStartTradingDate: candles[0]!.tradingDate,
            coverageEndTradingDate: candles.at(-1)!.tradingDate,
            completedCandleCount: candles.length,
            completeness: 'complete',
        };
    const contractRevision = overrides.contractRevision ?? 'contract-7';
    const corporateActionRevision =
        overrides.corporateActionRevision ?? 'corporate-actions-7';
    const sourceAttestation =
        overrides.sourceAttestation ??
        ATR_TEST_ONLY.issueRepositoryAttestation({
            schemaVersion: ATR_REPOSITORY_ATTESTATION_SCHEMA_VERSION,
            attestationRevision: envelope.attestationRevision,
            timeframe: '1D',
            period,
            sourceEnvelope: envelope,
            seedOrigin: origin,
            expectedCanonicalCandlesHash: digest,
            contractRevision,
            corporateActionRevision,
        });
    return {
        timeframe: '1D',
        period,
        candles,
        contractRevision,
        corporateActionRevision,
        sourceEnvelope: envelope,
        seedOrigin: origin,
        sourceIntegrity,
        sourceAttestation,
    };
}

function revisionEvidence(
    snapshot: FixedWilderAtrSnapshot,
    overrides: Partial<{
        purpose: 'restore' | 'reuse';
        evidenceRevision: string;
        headSequence: number;
        attestationRevision: string;
        expectedSnapshotHash: `sha256:${string}`;
        repositoryHeadRevision: string;
        calendarSourceRevision: string;
        businessSessionSourceRevision: string;
        runtimeEpochId: string;
        runtimeGeneration: number;
        confirmationContextHash: `sha256:${string}`;
        observedAtMonotonicNs: bigint;
        sourceEnvelope: AtrSourceEnvelope;
        contractRevision: string;
        corporateActionRevision: string;
    }> = {},
): TrustedAtrRevisionEvidence {
    const envelope = overrides.sourceEnvelope ?? snapshot.sourceEnvelope;
    return ATR_TEST_ONLY.issueRevisionEvidence({
        schemaVersion: ATR_REVISION_EVIDENCE_SCHEMA_VERSION,
        purpose: overrides.purpose ?? 'reuse',
        evidenceRevision: overrides.evidenceRevision ?? 'revision-check-19',
        headSequence: overrides.headSequence ?? 1,
        attestationRevision:
            overrides.attestationRevision ?? envelope.attestationRevision,
        expectedSnapshotHash:
            overrides.expectedSnapshotHash ?? snapshot.snapshotHash,
        repositoryHeadRevision:
            overrides.repositoryHeadRevision ?? envelope.repositoryRevision,
        calendarSourceRevision:
            overrides.calendarSourceRevision ??
            envelope.calendarSourceRevision,
        businessSessionSourceRevision:
            overrides.businessSessionSourceRevision ??
            envelope.businessSessionSourceRevision,
        runtimeEpochId: overrides.runtimeEpochId ?? 'runtime-epoch-7',
        runtimeGeneration: overrides.runtimeGeneration ?? 3,
        confirmationContextHash:
            overrides.confirmationContextHash ??
            envelope.confirmationContextHash,
        observedAtMonotonicNs:
            overrides.observedAtMonotonicNs ?? BASE_MONOTONIC_NS,
        sourceEnvelope: envelope,
        contractRevision:
            overrides.contractRevision ?? snapshot.contractRevision,
        corporateActionRevision:
            overrides.corporateActionRevision ??
            snapshot.corporateActionRevision,
    });
}

function runtimeContext(
    evidence: TrustedAtrRevisionEvidence,
    overrides: Partial<{
        contractKey: AtrSourceEnvelope['contractKey'];
        adjustmentBasis: AtrSourceEnvelope['adjustmentBasis'];
        headSequence: number;
        repositoryHeadRevision: string;
        sourceRevision: string;
        sourceId: string;
        contractRevision: string;
        corporateActionRevision: string;
        calendarSourceRevision: string;
        calendarVersion: string;
        businessSessionSourceRevision: string;
        businessSessionSourceId: string;
        businessSessionState: AtrSourceEnvelope['businessSessionState'];
        calendarSessionEvidenceHash: `sha256:${string}`;
        attestationRevision: string;
        runtimeEpochId: string;
        runtimeGeneration: number;
        confirmationContextHash: `sha256:${string}`;
        currentMonotonicNs: bigint;
    }> = {},
): TrustedAtrRuntimeContextEvidence {
    return ATR_TEST_ONLY.issueRuntimeContextEvidence({
        schemaVersion: ATR_RUNTIME_CONTEXT_EVIDENCE_SCHEMA_VERSION,
        contractKey:
            overrides.contractKey ?? evidence.sourceEnvelope.contractKey,
        adjustmentBasis:
            overrides.adjustmentBasis ??
            evidence.sourceEnvelope.adjustmentBasis,
        headSequence: overrides.headSequence ?? evidence.headSequence,
        repositoryHeadRevision:
            overrides.repositoryHeadRevision ??
            evidence.repositoryHeadRevision,
        sourceRevision:
            overrides.sourceRevision ?? evidence.sourceEnvelope.sourceRevision,
        sourceId: overrides.sourceId ?? evidence.sourceEnvelope.sourceId,
        contractRevision:
            overrides.contractRevision ?? evidence.contractRevision,
        corporateActionRevision:
            overrides.corporateActionRevision ??
            evidence.corporateActionRevision,
        calendarSourceRevision:
            overrides.calendarSourceRevision ??
            evidence.calendarSourceRevision,
        calendarVersion:
            overrides.calendarVersion ?? evidence.sourceEnvelope.calendarVersion,
        businessSessionSourceRevision:
            overrides.businessSessionSourceRevision ??
            evidence.businessSessionSourceRevision,
        businessSessionSourceId:
            overrides.businessSessionSourceId ??
            evidence.sourceEnvelope.businessSessionSourceId,
        businessSessionState:
            overrides.businessSessionState ??
            evidence.sourceEnvelope.businessSessionState,
        calendarSessionEvidenceHash:
            overrides.calendarSessionEvidenceHash ??
            evidence.sourceEnvelope.calendarSessionEvidenceHash,
        attestationRevision:
            overrides.attestationRevision ?? evidence.attestationRevision,
        runtimeEpochId: overrides.runtimeEpochId ?? evidence.runtimeEpochId,
        runtimeGeneration:
            overrides.runtimeGeneration ?? evidence.runtimeGeneration,
        confirmationContextHash:
            overrides.confirmationContextHash ??
            evidence.confirmationContextHash,
        currentMonotonicNs:
            overrides.currentMonotonicNs ??
            evidence.observedAtMonotonicNs + 1_000_000n,
    });
}

function validateWithFreshContext(
    snapshot: FixedWilderAtrSnapshot,
    evidence: TrustedAtrRevisionEvidence,
): ReturnType<typeof validateFixedWilderAtrSnapshot> {
    return validateFixedWilderAtrSnapshot(
        snapshot,
        evidence,
        runtimeContext(evidence),
    );
}

describe('fixed Wilder ATR domain', () => {
    it('calculates exact Wilder smoothing and freezes every trust-bearing snapshot field', async () => {
        expect(DEFAULT_WILDER_ATR_TIMEFRAME).toBe('1D');
        expect(DEFAULT_WILDER_ATR_PERIOD).toBe(14);
        const snapshot = await createFixedWilderAtrSnapshot(
            await snapshotInput(),
        );

        expect(snapshot).toEqual({
            schemaVersion: FIXED_WILDER_ATR_SNAPSHOT_SCHEMA_VERSION,
            attestationRevision: 'atr-attestation-31',
            confirmationContextHash: CONFIRMATION_CONTEXT_HASH,
            contractKey: 'TSE:STK:2330',
            adjustmentBasis: 'unadjusted',
            timeframe: '1D',
            period: 3,
            algorithmVersion: WILDER_ATR_ALGORITHM_VERSION,
            value: '3.222222222222222222',
            asOfTradingDate: '2026-07-10',
            contractRevision: 'contract-7',
            corporateActionRevision: 'corporate-actions-7',
            sourceEnvelope: expect.objectContaining({
                sourceRevision: 'kbar-source-7',
                expectedAsOfTradingDate: '2026-07-10',
                calendarVersion: 'twse-calendar-2026.7',
            }),
            seedOrigin: expect.objectContaining({
                originRevision: 'canonical-history-4',
                anchorTradingDate: '2026-07-06',
                seedEndTradingDate: '2026-07-09',
            }),
            sourceIntegrity: expect.objectContaining({
                completedCandleCount: 5,
                completeness: 'complete',
            }),
            snapshotHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        });
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.sourceEnvelope)).toBe(true);
        expect(Object.isFrozen(snapshot.seedOrigin)).toBe(true);
        expect(Object.isFrozen(snapshot.sourceIntegrity)).toBe(true);
    });

    it('binds contract key, adjustment basis and the complete calendar/session source envelope into the source hash', async () => {
        const candles = wilderFixture();
        const origin = seedOrigin(candles);
        const baseEnvelope = sourceEnvelope();
        const base = await canonicalHash({
            candles,
            envelope: baseEnvelope,
            origin,
            period: 3,
        });

        const variants = [
            sourceEnvelope({
                contractKey: canonicalContractKey('TSE:STK:2303'),
            }),
            sourceEnvelope({ adjustmentBasis: 'split_adjusted' }),
            sourceEnvelope({ calendarSourceRevision: 'calendar-source-22' }),
            sourceEnvelope({
                businessSessionSourceRevision: 'broker-session-89',
            }),
            sourceEnvelope({
                calendarSessionEvidenceHash: `sha256:${'b'.repeat(64)}`,
            }),
            sourceEnvelope({ attestationRevision: 'atr-attestation-32' }),
            sourceEnvelope({
                confirmationContextHash: `sha256:${'d'.repeat(64)}`,
            }),
        ];
        for (const envelope of variants) {
            await expect(
                canonicalHash({ candles, envelope, origin, period: 3 }),
            ).resolves.not.toBe(base);
        }

        const baseSnapshot = await createFixedWilderAtrSnapshot(
            await snapshotInput(),
        );
        const revisedSnapshot = await createFixedWilderAtrSnapshot(
            await snapshotInput({
                sourceEnvelope: sourceEnvelope({
                    attestationRevision: 'atr-attestation-32',
                }),
            }),
        );
        expect(revisedSnapshot.sourceIntegrity.canonicalCandlesHash).not.toBe(
            baseSnapshot.sourceIntegrity.canonicalCandlesHash,
        );
        expect(revisedSnapshot.snapshotHash).not.toBe(
            baseSnapshot.snapshotHash,
        );
    });

    it('does not let an ordinary caller self-attest even with a correct canonical hash', async () => {
        const input = await snapshotInput();
        const forged = {
            ...input.sourceAttestation,
        } as TrustedAtrRepositoryAttestation;

        await expect(
            createFixedWilderAtrSnapshot({
                ...input,
                sourceAttestation: forged,
            }),
        ).rejects.toSatisfy((error: unknown) => {
            expectAtrError(error, 'source_attestation_untrusted');
            return true;
        });
    });

    it('forces the completed K coverage to match trusted calendar/session expectedAsOf', async () => {
        const input = await snapshotInput();
        await expect(
            createFixedWilderAtrSnapshot({
                ...input,
                sourceEnvelope: sourceEnvelope({
                    expectedAsOfTradingDate: '2026-07-09',
                }),
            }),
        ).rejects.toSatisfy((error: unknown) => {
            expectAtrError(error, 'calendar_session_mismatch');
            return true;
        });

        await expect(
            hashCanonicalAtrCandles({
                timeframe: '1D',
                period: 3,
                sourceEnvelope: sourceEnvelope({
                    decisionTradingDate: '2026-07-10',
                    expectedAsOfTradingDate: '2026-07-10',
                    businessSessionState: 'open',
                }),
                seedOrigin: seedOrigin(wilderFixture()),
                candles: wilderFixture(),
            }),
        ).rejects.toSatisfy((error: unknown) => {
            expectAtrError(error, 'calendar_session_mismatch');
            return true;
        });
    });

    it('requires the versioned canonical seed origin and binds its revision', async () => {
        const input = await snapshotInput();
        await expect(
            createFixedWilderAtrSnapshot({
                ...input,
                seedOrigin: {
                    ...input.seedOrigin,
                    anchorTradingDate: '2026-07-07',
                },
            }),
        ).rejects.toSatisfy((error: unknown) => {
            expectAtrError(error, 'seed_origin_mismatch');
            return true;
        });

        const changedOrigin = {
            ...input.seedOrigin,
            originRevision: 'canonical-history-5',
        };
        await expect(
            canonicalHash({
                candles: input.candles,
                envelope: input.sourceEnvelope,
                origin: changedOrigin,
                period: input.period,
            }),
        ).resolves.not.toBe(input.sourceIntegrity.canonicalCandlesHash);

        await expect(
            createFixedWilderAtrSnapshot({
                ...input,
                seedOrigin: {
                    ...input.seedOrigin,
                    schemaVersion: 'legacy-seed/v0',
                } as unknown as AtrCanonicalSeedOrigin,
            }),
        ).rejects.toSatisfy((error: unknown) => {
            expectAtrError(error, 'seed_origin_mismatch');
            return true;
        });
    });

    it('requires a prior-close anchor plus period completed candles', async () => {
        const input = await snapshotInput();
        await expect(
            createFixedWilderAtrSnapshot({
                ...input,
                candles: input.candles.slice(0, 3),
            }),
        ).rejects.toSatisfy((error: unknown) => {
            expectAtrError(error, 'insufficient_completed_candles');
            return true;
        });
    });

    it('fails closed instead of filtering an unfinished K candle', async () => {
        const input = await snapshotInput();
        const candles = input.candles.map((entry, index) =>
            index === 4
                ? ({
                      ...entry,
                      completed: false,
                  } as unknown as CompletedAtrCandle)
                : entry,
        );
        await expect(
            createFixedWilderAtrSnapshot({ ...input, candles }),
        ).rejects.toSatisfy((error: unknown) => {
            expectAtrError(error, 'incomplete_candle');
            return true;
        });
    });

    it('rejects non-contiguous provider dates or sequence gaps', async () => {
        const candles = wilderFixture().map((entry, index) =>
            index === 3
                ? { ...entry, previousTradingDate: '2026-07-07' }
                : entry,
        );
        await expect(
            hashCanonicalAtrCandles({
                timeframe: '1D',
                period: 3,
                sourceEnvelope: sourceEnvelope(),
                seedOrigin: seedOrigin(candles),
                candles,
            }),
        ).rejects.toSatisfy((error: unknown) => {
            expectAtrError(error, 'non_contiguous_candles');
            return true;
        });

        const sequenceGap = wilderFixture().map((entry, index) =>
            index === 3 ? { ...entry, sourceSequence: 999 } : entry,
        );
        await expect(
            hashCanonicalAtrCandles({
                timeframe: '1D',
                period: 3,
                sourceEnvelope: sourceEnvelope(),
                seedOrigin: seedOrigin(sequenceGap),
                candles: sequenceGap,
            }),
        ).rejects.toSatisfy((error: unknown) => {
            expectAtrError(error, 'non_contiguous_candles');
            return true;
        });
    });

    it('requires complete source coverage and three-way matching of payload, integrity and attestation hashes', async () => {
        const input = await snapshotInput();
        await expect(
            createFixedWilderAtrSnapshot({
                ...input,
                sourceIntegrity: {
                    ...input.sourceIntegrity,
                    completeness: 'partial',
                } as unknown as AtrSourceIntegrity,
            }),
        ).rejects.toSatisfy((error: unknown) => {
            expectAtrError(error, 'source_incomplete');
            return true;
        });

        await expect(
            createFixedWilderAtrSnapshot({
                ...input,
                sourceIntegrity: {
                    ...input.sourceIntegrity,
                    canonicalCandlesHash: `sha256:${'0'.repeat(64)}`,
                },
            }),
        ).rejects.toSatisfy((error: unknown) => {
            expectAtrError(error, 'source_integrity_mismatch');
            return true;
        });

        const otherCandles = input.candles.map((entry, index) =>
            index === 4
                ? {
                      ...entry,
                      open: decimalString('13'),
                      close: decimalString('14'),
                  }
                : entry,
        );
        const otherDigest = await canonicalHash({
            candles: otherCandles,
            envelope: input.sourceEnvelope,
            origin: input.seedOrigin,
            period: input.period,
        });
        await expect(
            createFixedWilderAtrSnapshot({
                ...input,
                candles: otherCandles,
                sourceIntegrity: {
                    ...input.sourceIntegrity,
                    canonicalCandlesHash: otherDigest,
                },
            }),
        ).rejects.toSatisfy((error: unknown) => {
            expectAtrError(error, 'source_attestation_untrusted');
            return true;
        });
    });

    it('rejects malformed or inconsistent OHLC values before calculation', async () => {
        const input = await snapshotInput();
        const malformed = input.candles.map((entry, index) =>
            index === 2
                ? ({ ...entry, high: 'NaN' } as unknown as CompletedAtrCandle)
                : entry,
        );
        await expect(
            createFixedWilderAtrSnapshot({ ...input, candles: malformed }),
        ).rejects.toSatisfy((error: unknown) => {
            expectAtrError(error, 'invalid_candle');
            return true;
        });
    });

    it('requires opaque trusted revision evidence and purpose separation', async () => {
        const snapshot = await createFixedWilderAtrSnapshot(
            await snapshotInput(),
        );
        const trusted = revisionEvidence(snapshot);
        const forged = { ...trusted } as TrustedAtrRevisionEvidence;

        expect(
            validateFixedWilderAtrSnapshot(
                snapshot,
                forged,
                runtimeContext(trusted),
            ),
        ).toEqual({
            valid: false,
            reason: 'revision_evidence_untrusted',
        });
        const wrongPurpose = revisionEvidence(snapshot, { purpose: 'restore' });
        expect(
            validateFixedWilderAtrSnapshot(
                snapshot,
                wrongPurpose,
                runtimeContext(wrongPurpose),
            ),
        ).toEqual({
            valid: false,
            reason: 'revision_evidence_untrusted',
        });
    });

    it('exposes issuers only through the frozen explicit test-support surface', () => {
        expect(Object.isFrozen(ATR_TEST_ONLY)).toBe(true);
        expect(Object.keys(ATR_TEST_ONLY).sort()).toEqual([
            'issueRepositoryAttestation',
            'issueRevisionEvidence',
            'issueRuntimeContextEvidence',
            'resetAtrVerifier',
        ]);
    });

    it('rejects stale repository heads, expired evidence and replayed current-clock capabilities', async () => {
        const snapshot = await createFixedWilderAtrSnapshot(
            await snapshotInput(),
        );
        const evidence = revisionEvidence(snapshot);

        for (const overrides of [
            { repositoryHeadRevision: 'repository-13' },
            { sourceRevision: 'kbar-source-8' },
            { corporateActionRevision: 'corporate-actions-8' },
            { calendarSourceRevision: 'calendar-source-22' },
            { businessSessionSourceRevision: 'broker-session-89' },
        ]) {
            expectAtrActionError(
                () => runtimeContext(evidence, overrides),
                'runtime_context_untrusted',
            );
        }

        const oneShotContext = runtimeContext(evidence);
        expect(
            validateFixedWilderAtrSnapshot(
                snapshot,
                evidence,
                oneShotContext,
            ),
        ).toEqual({ valid: true });
        expect(
            validateFixedWilderAtrSnapshot(
                snapshot,
                evidence,
                oneShotContext,
            ),
        ).toEqual({ valid: false, reason: 'runtime_context_untrusted' });
        expectAtrActionError(
            () =>
                runtimeContext(evidence, {
                    currentMonotonicNs: evidence.observedAtMonotonicNs,
                }),
            'runtime_context_untrusted',
        );
        expect(
            validateFixedWilderAtrSnapshot(
                snapshot,
                evidence,
                runtimeContext(evidence, {
                    currentMonotonicNs:
                        evidence.observedAtMonotonicNs +
                        BigInt(ATR_REVISION_EVIDENCE_TTL_MS) * 1_000_000n +
                        1n,
                }),
            ),
        ).toEqual({ valid: false, reason: 'revision_evidence_expired' });
    });

    it('makes repository r2 invalidate r1 evidence, r1 context and the old snapshot without permitting rollback', async () => {
        const snapshot = await createFixedWilderAtrSnapshot(
            await snapshotInput(),
        );
        const r1Evidence = revisionEvidence(snapshot);
        const r1Context = runtimeContext(r1Evidence);
        const r2Envelope = sourceEnvelope({
            repositoryRevision: 'repository-13',
        });
        const r2Evidence = revisionEvidence(snapshot, {
            evidenceRevision: 'revision-check-20',
            headSequence: 2,
            repositoryHeadRevision: 'repository-13',
            observedAtMonotonicNs: BASE_MONOTONIC_NS + 1n,
            sourceEnvelope: r2Envelope,
        });

        expect(
            validateFixedWilderAtrSnapshot(
                snapshot,
                r1Evidence,
                r1Context,
            ),
        ).toEqual({ valid: false, reason: 'repository_revision_changed' });
        expectAtrActionError(
            () => runtimeContext(r1Evidence),
            'runtime_context_untrusted',
        );
        expect(
            validateFixedWilderAtrSnapshot(
                snapshot,
                r2Evidence,
                runtimeContext(r2Evidence),
            ),
        ).toEqual({ valid: false, reason: 'repository_revision_changed' });
        expectAtrActionError(
            () =>
                revisionEvidence(snapshot, {
                    evidenceRevision: 'revision-check-21',
                    headSequence: 3,
                    observedAtMonotonicNs: BASE_MONOTONIC_NS + 2n,
                }),
            'revision_evidence_untrusted',
        );
    });

    it('shares one authoritative head across H1/H2 while binding each snapshot to its own confirmation', async () => {
        const snapshotH1 = await createFixedWilderAtrSnapshot(
            await snapshotInput(),
        );
        const evidenceH1 = revisionEvidence(snapshotH1);
        const contextH1 = runtimeContext(evidenceH1);
        const confirmationH2 = `sha256:${'d'.repeat(64)}` as const;
        const envelopeH2 = sourceEnvelope({
            confirmationContextHash: confirmationH2,
            repositoryRevision: 'repository-13',
            sourceRevision: 'kbar-source-8',
            calendarSourceRevision: 'calendar-source-22',
            businessSessionSourceRevision: 'broker-session-89',
        });
        const evidenceH2 = revisionEvidence(snapshotH1, {
            evidenceRevision: 'revision-check-h2',
            headSequence: 2,
            repositoryHeadRevision: envelopeH2.repositoryRevision,
            calendarSourceRevision: envelopeH2.calendarSourceRevision,
            businessSessionSourceRevision:
                envelopeH2.businessSessionSourceRevision,
            confirmationContextHash: confirmationH2,
            observedAtMonotonicNs: BASE_MONOTONIC_NS + 1n,
            sourceEnvelope: envelopeH2,
        });

        expect(
            validateFixedWilderAtrSnapshot(
                snapshotH1,
                evidenceH1,
                contextH1,
            ),
        ).toEqual({ valid: false, reason: 'repository_revision_changed' });
        expect(
            validateFixedWilderAtrSnapshot(
                snapshotH1,
                evidenceH2,
                runtimeContext(evidenceH2),
            ),
        ).toEqual({ valid: false, reason: 'confirmation_context_changed' });

        expectAtrActionError(
            () =>
                revisionEvidence(snapshotH1, {
                    evidenceRevision: 'revision-check-h1-rollback',
                    headSequence: 3,
                    observedAtMonotonicNs: BASE_MONOTONIC_NS + 2n,
                }),
            'revision_evidence_untrusted',
        );
    });

    it('binds revision evidence to runtime epoch, generation, confirmation and attestation revisions', async () => {
        const snapshot = await createFixedWilderAtrSnapshot(
            await snapshotInput(),
        );
        const evidence = revisionEvidence(snapshot);

        for (const overrides of [
            { runtimeEpochId: 'runtime-epoch-8' },
            { runtimeGeneration: 4 },
            {
                confirmationContextHash: `sha256:${'d'.repeat(64)}` as const,
            },
            { attestationRevision: 'atr-attestation-32' },
        ]) {
            expectAtrActionError(
                () => runtimeContext(evidence, overrides),
                'runtime_context_untrusted',
            );
        }

        const changedEnvelope = sourceEnvelope({
            attestationRevision: 'atr-attestation-32',
        });
        const changedEvidence = revisionEvidence(snapshot, {
            sourceEnvelope: changedEnvelope,
            headSequence: 2,
            observedAtMonotonicNs: BASE_MONOTONIC_NS + 1n,
        });
        expect(
            validateWithFreshContext(snapshot, changedEvidence),
        ).toEqual({
            valid: false,
            reason: 'attestation_revision_changed',
        });
    });

    it('invalidates source, contract, corporate-action, adjustment and trusted calendar/session drift', async () => {
        const snapshot = await createFixedWilderAtrSnapshot(
            await snapshotInput(),
        );
        expect(
            validateWithFreshContext(
                snapshot,
                revisionEvidence(snapshot, {
                    sourceEnvelope: sourceEnvelope({
                        sourceRevision: 'kbar-source-8',
                    }),
                }),
            ),
        ).toEqual({ valid: false, reason: 'source_revision_changed' });
        ATR_TEST_ONLY.resetAtrVerifier();
        expect(
            validateWithFreshContext(
                snapshot,
                revisionEvidence(snapshot, {
                    sourceEnvelope: sourceEnvelope({
                        sourceId: 'different-kbar-source',
                    }),
                }),
            ),
        ).toEqual({ valid: false, reason: 'source_revision_changed' });
        ATR_TEST_ONLY.resetAtrVerifier();
        expect(
            validateWithFreshContext(
                snapshot,
                revisionEvidence(snapshot, {
                    contractRevision: 'contract-8',
                }),
            ),
        ).toEqual({ valid: false, reason: 'contract_revision_changed' });
        ATR_TEST_ONLY.resetAtrVerifier();
        expect(
            validateWithFreshContext(
                snapshot,
                revisionEvidence(snapshot, {
                    corporateActionRevision: 'corporate-actions-8',
                }),
            ),
        ).toEqual({
            valid: false,
            reason: 'corporate_action_revision_changed',
        });
        ATR_TEST_ONLY.resetAtrVerifier();
        expect(
            validateWithFreshContext(
                snapshot,
                revisionEvidence(snapshot, {
                    sourceEnvelope: sourceEnvelope({
                        adjustmentBasis: 'split_adjusted',
                    }),
                }),
            ),
        ).toEqual({ valid: false, reason: 'adjustment_basis_changed' });
        ATR_TEST_ONLY.resetAtrVerifier();
        expect(
            validateWithFreshContext(
                snapshot,
                revisionEvidence(snapshot, {
                    sourceEnvelope: sourceEnvelope({
                        calendarSourceRevision: 'calendar-source-22',
                    }),
                }),
            ),
        ).toEqual({ valid: false, reason: 'calendar_revision_changed' });
        ATR_TEST_ONLY.resetAtrVerifier();
        expect(
            validateWithFreshContext(
                snapshot,
                revisionEvidence(snapshot, {
                    sourceEnvelope: sourceEnvelope({
                        businessSessionSourceRevision: 'broker-session-89',
                    }),
                }),
            ),
        ).toEqual({
            valid: false,
            reason: 'business_session_revision_changed',
        });
        ATR_TEST_ONLY.resetAtrVerifier();
        expect(
            validateWithFreshContext(
                snapshot,
                revisionEvidence(snapshot, {
                    sourceEnvelope: sourceEnvelope({
                        expectedAsOfTradingDate: '2026-07-09',
                    }),
                }),
            ),
        ).toEqual({ valid: false, reason: 'expected_as_of_changed' });
    });

    it('reuses the identical immutable snapshot after restart or partial fill without a K source', async () => {
        const snapshot = await createFixedWilderAtrSnapshot(
            await snapshotInput(),
        );
        const evidence = revisionEvidence(snapshot);

        expect(
            retainFixedWilderAtrSnapshot(snapshot, {
                reason: 'runtime_restart',
                evidence,
                context: runtimeContext(evidence),
            }),
        ).toBe(snapshot);
        expect(
            retainFixedWilderAtrSnapshot(snapshot, {
                reason: 'partial_fill',
                evidence,
                context: runtimeContext(evidence),
            }),
        ).toBe(snapshot);
        expect(validateWithFreshContext(snapshot, evidence)).toEqual({
            valid: true,
        });

        const forged = { ...snapshot, value: decimalString('999') };
        expect(
            validateFixedWilderAtrSnapshot(
                forged,
                evidence,
                runtimeContext(evidence),
            ),
        ).toEqual({ valid: false, reason: 'snapshot_untrusted' });
    });

    it('restores only with an independent immutable expected hash and trusted revision evidence', async () => {
        const snapshot = await createFixedWilderAtrSnapshot(
            await snapshotInput(),
        );
        const persisted = JSON.parse(JSON.stringify(snapshot)) as unknown;
        const restoreEvidence = revisionEvidence(snapshot, {
            purpose: 'restore',
        });
        const restored = await restoreFixedWilderAtrSnapshot(
            persisted,
            restoreEvidence,
            runtimeContext(restoreEvidence),
        );

        expect(restored).toEqual(snapshot);
        expect(restored).not.toBe(snapshot);
        const restoredReuseEvidence = revisionEvidence(restored);
        expect(
            retainFixedWilderAtrSnapshot(restored, {
                reason: 'runtime_restart',
                evidence: restoredReuseEvidence,
                context: runtimeContext(restoredReuseEvidence),
            }),
        ).toBe(restored);

        await expect(
            restoreFixedWilderAtrSnapshot(
                persisted,
                { ...restoreEvidence } as TrustedAtrRevisionEvidence,
                runtimeContext(restoreEvidence),
            ),
        ).rejects.toSatisfy((error: unknown) => {
            expectAtrError(error, 'revision_evidence_untrusted');
            return true;
        });
        const wrongPurpose = revisionEvidence(snapshot, { purpose: 'reuse' });
        await expect(
            restoreFixedWilderAtrSnapshot(
                persisted,
                wrongPurpose,
                runtimeContext(wrongPurpose),
            ),
        ).rejects.toSatisfy((error: unknown) => {
            expectAtrError(error, 'revision_evidence_untrusted');
            return true;
        });
        await expect(
            restoreFixedWilderAtrSnapshot(
                {
                    ...(persisted as Record<string, unknown>),
                    value: '999',
                },
                restoreEvidence,
                runtimeContext(restoreEvidence),
            ),
        ).rejects.toSatisfy((error: unknown) => {
            expectAtrError(error, 'snapshot_integrity_mismatch');
            return true;
        });

        const attackerHash = `sha256:${'0'.repeat(64)}` as const;
        const attackerEvidence = revisionEvidence(snapshot, {
            purpose: 'restore',
            expectedSnapshotHash: attackerHash,
            headSequence: 2,
            observedAtMonotonicNs: BASE_MONOTONIC_NS + 1n,
        });
        await expect(
            restoreFixedWilderAtrSnapshot(
                {
                    ...(persisted as Record<string, unknown>),
                    snapshotHash: attackerHash,
                },
                attackerEvidence,
                runtimeContext(attackerEvidence),
            ),
        ).rejects.toSatisfy((error: unknown) => {
            expectAtrError(error, 'snapshot_integrity_mismatch');
            return true;
        });
    });

    it('rejects persisted contract, adjustment and source-envelope tampering', async () => {
        const snapshot = await createFixedWilderAtrSnapshot(
            await snapshotInput(),
        );
        const persisted = JSON.parse(JSON.stringify(snapshot)) as Record<
            string,
            unknown
        >;
        const evidence = revisionEvidence(snapshot, { purpose: 'restore' });

        for (const tampered of [
            { ...persisted, contractKey: 'TSE:STK:2303' },
            { ...persisted, adjustmentBasis: 'split_adjusted' },
            {
                ...persisted,
                sourceEnvelope: {
                    ...(persisted.sourceEnvelope as Record<string, unknown>),
                    sourceRevision: 'kbar-source-8',
                },
            },
        ]) {
            await expect(
                restoreFixedWilderAtrSnapshot(
                    tampered,
                    evidence,
                    runtimeContext(evidence),
                ),
            ).rejects.toBeInstanceOf(SmartOrderAtrError);
        }
    });
});
