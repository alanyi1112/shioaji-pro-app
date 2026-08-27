import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createSmartOrderBrokerWriteAdmissionBoundary,
    createSmartOrderBrokerWriteAdmissionTestHarness,
} from './broker-write-admission.mjs';

const now = 1_786_390_000_000;
const digests = Object.freeze({
    account: `sha256:${'1'.repeat(64)}`,
    targetA: `sha256:${'2'.repeat(64)}`,
    manifest: `sha256:${'3'.repeat(64)}`,
    automationPayload: `sha256:${'4'.repeat(64)}`,
    manualPayload: `sha256:${'5'.repeat(64)}`,
    probePlacePayload: `sha256:${'6'.repeat(64)}`,
    probeUpdatePayload: `sha256:${'7'.repeat(64)}`,
    probeCancelPayload: `sha256:${'8'.repeat(64)}`,
});

function createContext(startEpochMs = now) {
    const harness = createSmartOrderBrokerWriteAdmissionTestHarness({
        nowEpochMs: startEpochMs,
    });
    const boundary = createSmartOrderBrokerWriteAdmissionBoundary({
        securityAuthority: harness.securityAuthority,
    });
    return { harness, boundary };
}

function manifestDecision(harness, provenance) {
    return harness.trustManifestDecision(
        Object.freeze({
            valid: true,
            state: 'eligible',
            provenance,
            manifestSha256: digests.manifest,
            blockers: Object.freeze([]),
        }),
    );
}

function rejectedManifestDecision(harness, reason) {
    return harness.trustManifestDecision(
        Object.freeze({
            valid: false,
            state: 'observe_only',
            reasons: Object.freeze([reason]),
        }),
    );
}

function issueRoute(
    harness,
    endpoint,
    payloadSha256,
    quantityCommonLots = 1,
) {
    return harness.issueRouteEvidence({
        endpoint,
        payloadSha256,
        quantityCommonLots,
        ...(endpoint === 'automation'
            ? {
                  strategyId: 'strategy-1',
                  activationId: 'activation-1',
                  intentId: 'intent-1',
              }
            : {}),
    });
}

function manualInput(context, overrides = {}) {
    const payloadSha256 = overrides.payloadSha256 ?? digests.manualPayload;
    const routeEvidence =
        overrides.routeEvidence ??
        issueRoute(context.harness, 'manual', payloadSha256);
    const issued = context.boundary.issueManualConfirmation({
        routeEvidence,
        payloadSha256,
        quantityCommonLots: 1,
        validUntilEpochMs: now + 30_000,
        ...overrides.confirmationOverrides,
    });
    expect(issued.issued).toBe(true);
    return {
        endpoint: 'manual',
        routeEvidence,
        manifestDecision: manifestDecision(
            context.harness,
            'manual_user_confirmed',
        ),
        confirmation: issued.confirmation,
        payloadSha256,
        quantityCommonLots: 1,
        ...overrides.authorizeOverrides,
    };
}

function probeTarget(overrides = {}) {
    return {
        originRunId: 'probe-run-a',
        targetIdDigest: digests.targetA,
        accountRefDigest: digests.account,
        tradeDate: '2026-08-12',
        revision: 1,
        nonTerminal: true,
        correlationUnique: true,
        ...overrides,
    };
}

function issueProbe(context, overrides = {}) {
    const operation = overrides.operation ?? 'place';
    const payloadSha256 =
        overrides.payloadSha256 ??
        (operation === 'place'
            ? digests.probePlacePayload
            : operation === 'update'
              ? digests.probeUpdatePayload
              : digests.probeCancelPayload);
    const routeEvidence =
        overrides.routeEvidence ??
        issueRoute(context.harness, 'gate_probe', payloadSha256);
    const issued = context.boundary.issueProbeEnvelope({
        routeEvidence,
        runId: 'probe-run-a',
        nonce: 'nonce-a',
        operation,
        payloadSha256,
        quantityCommonLots: 1,
        accountRefDigest: digests.account,
        tradeDate: '2026-08-12',
        validUntilEpochMs: now + 30_000,
        ...(operation === 'place' ? {} : { target: probeTarget() }),
        ...overrides,
    });
    return { issued, payloadSha256, routeEvidence };
}

function authorizeProbe(context, probe, overrides = {}) {
    return context.boundary.authorize({
        endpoint: 'gate_probe',
        routeEvidence: probe.routeEvidence,
        manifestDecision: manifestDecision(context.harness, 'gate_probe'),
        probeEnvelope: probe.issued.envelope,
        payloadSha256: probe.payloadSha256,
        quantityCommonLots: 1,
        ...overrides,
    });
}

function settleProbe(context, probeReceipt, outcome, postTarget) {
    return context.boundary.settleProbeOperation({
        probeReceipt,
        resultEvidence: context.harness.issueProbeResultEvidence({
            outcome,
            ...(postTarget === undefined ? {} : { postTarget }),
        }),
    });
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('offline broker-write admission contract', () => {
    it.each([
        ['missing manifest', null],
        ['tampered manifest', 'manifest_hash_or_schema_invalid'],
        ['fingerprint drift', 'fingerprint_mismatch'],
    ])('fails closed for %s even when environment flags force enable', (_label, reason) => {
        vi.stubEnv('SMART_ORDER_WRITE_MASTER', 'enabled');
        vi.stubEnv('SMART_ORDER_FEATURE_GATES', 'all');
        const context = createContext();
        const routeEvidence = issueRoute(
            context.harness,
            'automation',
            digests.automationPayload,
        );
        const decision =
            reason === null
                ? null
                : rejectedManifestDecision(context.harness, reason);

        expect(
            context.boundary.authorize({
                endpoint: 'automation',
                routeEvidence,
                manifestDecision: decision,
                payloadSha256: digests.automationPayload,
                quantityCommonLots: 1,
            }),
        ).toEqual({
            admitted: false,
            provenance: null,
            reason: 'gate_manifest_not_eligible',
            brokerAuthority: false,
        });
    });

    it('rejects provenance payloads and structural caller or route evidence forgery', () => {
        const context = createContext();
        const structuralRoute = { kind: 'trusted_test_route_evidence' };

        expect(
            context.boundary.issueManualConfirmation({
                trustedCaller: 'interactive_manual_ticket',
                routeEvidence: structuralRoute,
                payloadSha256: digests.manualPayload,
                quantityCommonLots: 1,
                validUntilEpochMs: now + 30_000,
                simulationMarkerCurrent: true,
                apiSimulationAttested: true,
            }),
        ).toMatchObject({
            issued: false,
            reason: 'manual_route_evidence_invalid',
        });

        const routeEvidence = issueRoute(
            context.harness,
            'automation',
            digests.automationPayload,
        );
        expect(
            context.boundary.authorize({
                endpoint: 'automation',
                routeEvidence,
                manifestDecision: manifestDecision(
                    context.harness,
                    'automation',
                ),
                payloadSha256: digests.automationPayload,
                quantityCommonLots: 1,
                provenance: 'manual_user_confirmed',
            }),
        ).toMatchObject({
            admitted: false,
            reason: 'client_supplied_provenance_forbidden',
        });
        expect(
            context.boundary.authorize({
                endpoint: 'automation',
                routeEvidence: { ...routeEvidence },
                manifestDecision: manifestDecision(
                    context.harness,
                    'automation',
                ),
                payloadSha256: digests.automationPayload,
                quantityCommonLots: 1,
            }),
        ).toMatchObject({
            admitted: false,
            reason: 'trusted_route_evidence_invalid',
        });
    });

    it('keeps a legitimate one-time manual ticket independent of automation gates', () => {
        const context = createContext();
        const input = manualInput(context);

        expect(context.boundary.authorize(input)).toEqual({
            admitted: true,
            provenance: 'manual_user_confirmed',
            reason: null,
            payloadSha256: digests.manualPayload,
            quantityCommonLots: 1,
            brokerAuthority: false,
        });
        expect(context.boundary.authorize(input)).toMatchObject({
            admitted: false,
            reason: 'trusted_route_evidence_invalid',
        });
    });

    it('binds manual confirmation to one canonical payload and exactly one CommonLot', () => {
        const context = createContext();
        const input = manualInput(context);
        expect(
            context.boundary.authorize({
                ...input,
                payloadSha256: `sha256:${'f'.repeat(64)}`,
            }),
        ).toMatchObject({
            admitted: false,
            reason: 'trusted_route_evidence_invalid',
        });
        expect(() =>
            issueRoute(
                context.harness,
                'manual',
                digests.manualPayload,
                2,
            ),
        ).toThrow('test route evidence context is invalid');
    });

    it('uses only the opaque monotonic clock and enforces issuedAt <= now < validUntil', () => {
        const context = createContext();
        const input = manualInput(context, {
            confirmationOverrides: {
                confirmedAtEpochMs: 9_000_000_000_000,
                validUntilEpochMs: now + 100,
            },
            authorizeOverrides: {
                nowEpochMs: 1,
            },
        });
        context.harness.setTrustedNowEpochMs(now + 100);

        expect(context.boundary.authorize(input)).toMatchObject({
            admitted: false,
            reason: 'manual_confirmation_invalid_or_expired',
        });

        const freshContext = createContext();
        const freshInput = manualInput(freshContext, {
            confirmationOverrides: {
                issuedAtEpochMs: 9_000_000_000_000,
            },
        });
        expect(freshContext.boundary.authorize(freshInput)).toMatchObject({
            admitted: true,
        });
    });

    it('defaults closed and rejects cloned manifest or security authority', () => {
        const context = createContext();
        const trusted = manifestDecision(context.harness, 'automation');
        const routeEvidence = issueRoute(
            context.harness,
            'automation',
            digests.automationPayload,
        );
        expect(
            context.boundary.authorize({
                endpoint: 'automation',
                routeEvidence,
                manifestDecision: { ...trusted },
                payloadSha256: digests.automationPayload,
                quantityCommonLots: 1,
            }),
        ).toMatchObject({
            admitted: false,
            reason: 'gate_manifest_not_eligible',
        });

        const defaultClosed = createSmartOrderBrokerWriteAdmissionBoundary();
        expect(defaultClosed.probeBoundaryStatus()).toMatchObject({
            admissionAvailable: false,
            durableReplayProtection: false,
            brokerAuthority: false,
        });
        const clonedAuthorityBoundary =
            createSmartOrderBrokerWriteAdmissionBoundary({
                securityAuthority: { ...context.harness.securityAuthority },
            });
        expect(clonedAuthorityBoundary.probeBoundaryStatus()).toMatchObject({
            admissionAvailable: false,
        });
    });

    it('rejects a strategy-shaped caller and structural probe evidence', () => {
        const context = createContext();
        const issued = context.boundary.issueProbeEnvelope({
            trustedCaller: 'gate_probe_cli',
            routeEvidence: { kind: 'trusted_test_route_evidence' },
            runId: 'probe-run-a',
            nonce: 'nonce-a',
            operation: 'place',
            payloadSha256: digests.probePlacePayload,
            quantityCommonLots: 1,
            accountRefDigest: digests.account,
            tradeDate: '2026-08-12',
            validUntilEpochMs: now + 30_000,
            userAuthorized: true,
            sharedModeLeaseHeld: true,
        });
        expect(issued).toMatchObject({
            issued: false,
            reason: 'probe_route_evidence_invalid',
            brokerAuthority: false,
        });
    });

    it('burns every probe nonce once and enforces one CommonLot at the route brand', () => {
        const context = createContext();
        expect(issueProbe(context).issued.issued).toBe(true);
        expect(
            issueProbe(context, {
                routeEvidence: issueRoute(
                    context.harness,
                    'gate_probe',
                    digests.probePlacePayload,
                ),
                runId: 'probe-run-b',
                nonce: 'nonce-a',
            }).issued,
        ).toMatchObject({ issued: false, reason: 'probe_nonce_replayed' });
        expect(() =>
            issueRoute(
                context.harness,
                'gate_probe',
                digests.probePlacePayload,
                2,
            ),
        ).toThrow('test route evidence context is invalid');
    });

    it('rejects explicit and forged cross-run probe targets', () => {
        const context = createContext();
        const placed = issueProbe(context);
        const admitted = authorizeProbe(context, placed);
        expect(admitted.admitted).toBe(true);
        expect(
            settleProbe(
                context,
                admitted.probeReceipt,
                'confirmed',
                probeTarget(),
            ),
        ).toMatchObject({ state: 'confirmed', targetRegistered: true });

        expect(
            issueProbe(context, {
                routeEvidence: issueRoute(
                    context.harness,
                    'gate_probe',
                    digests.probeCancelPayload,
                ),
                runId: 'probe-run-b',
                nonce: 'nonce-b-explicit',
                operation: 'cancel',
                target: probeTarget(),
            }).issued,
        ).toMatchObject({
            issued: false,
            reason: 'probe_target_run_mismatch',
        });

        const forged = issueProbe(context, {
            routeEvidence: issueRoute(
                context.harness,
                'gate_probe',
                digests.probeCancelPayload,
            ),
            runId: 'probe-run-b',
            nonce: 'nonce-b-forged',
            operation: 'cancel',
            target: probeTarget({ originRunId: 'probe-run-b' }),
        });
        expect(forged.issued.issued).toBe(true);
        expect(
            authorizeProbe(context, forged, {
                currentProbeTargetEvidence:
                    context.harness.issueProbeTargetEvidence({
                        purpose: 'write_adjacent',
                        target: probeTarget({ originRunId: 'probe-run-b' }),
                    }),
            }),
        ).toMatchObject({
            admitted: false,
            reason: 'probe_target_lineage_or_revision_changed',
        });
    });

    it('replaces a confirmed update target and rejects the stale revision', () => {
        const context = createContext();
        const placed = issueProbe(context);
        const placeAdmission = authorizeProbe(context, placed);
        settleProbe(
            context,
            placeAdmission.probeReceipt,
            'confirmed',
            probeTarget({ revision: 1 }),
        );

        const update = issueProbe(context, {
            routeEvidence: issueRoute(
                context.harness,
                'gate_probe',
                digests.probeUpdatePayload,
            ),
            nonce: 'nonce-update',
            operation: 'update',
            target: probeTarget({ revision: 1 }),
        });
        const updateAdmission = authorizeProbe(context, update, {
            currentProbeTargetEvidence:
                context.harness.issueProbeTargetEvidence({
                    purpose: 'write_adjacent',
                    target: probeTarget({ revision: 1 }),
                }),
        });
        expect(updateAdmission.admitted).toBe(true);
        expect(
            settleProbe(
                context,
                updateAdmission.probeReceipt,
                'confirmed',
                probeTarget({ revision: 2 }),
            ),
        ).toMatchObject({ state: 'confirmed', targetRegistered: true });

        const staleCancel = issueProbe(context, {
            routeEvidence: issueRoute(
                context.harness,
                'gate_probe',
                digests.probeCancelPayload,
            ),
            nonce: 'nonce-stale-cancel',
            operation: 'cancel',
            target: probeTarget({ revision: 1 }),
        });
        expect(
            authorizeProbe(context, staleCancel, {
                currentProbeTargetEvidence:
                    context.harness.issueProbeTargetEvidence({
                        purpose: 'write_adjacent',
                        target: probeTarget({ revision: 1 }),
                    }),
            }),
        ).toMatchObject({
            admitted: false,
            reason: 'probe_target_lineage_or_revision_changed',
        });

        const freshCancel = issueProbe(context, {
            routeEvidence: issueRoute(
                context.harness,
                'gate_probe',
                digests.probeCancelPayload,
            ),
            nonce: 'nonce-fresh-cancel',
            operation: 'cancel',
            target: probeTarget({ revision: 2 }),
        });
        const freshCancelAdmission = authorizeProbe(context, freshCancel, {
            currentProbeTargetEvidence:
                context.harness.issueProbeTargetEvidence({
                    purpose: 'write_adjacent',
                    target: probeTarget({ revision: 2 }),
                }),
        });
        expect(freshCancelAdmission.admitted).toBe(true);
        expect(
            settleProbe(context, freshCancelAdmission.probeReceipt, 'confirmed'),
        ).toMatchObject({ state: 'confirmed' });
    });

    it('globally latches probe admission after response loss without retry or cleanup', () => {
        const context = createContext();
        const lostProbe = issueProbe(context, {
            runId: 'probe-run-loss',
            nonce: 'nonce-loss',
        });
        const preissuedOtherRun = issueProbe(context, {
            routeEvidence: issueRoute(
                context.harness,
                'gate_probe',
                digests.probePlacePayload,
            ),
            runId: 'probe-run-preissued',
            nonce: 'nonce-preissued',
        });
        const admitted = authorizeProbe(context, lostProbe);
        expect(admitted.admitted).toBe(true);

        expect(
            settleProbe(context, admitted.probeReceipt, 'response_lost'),
        ).toEqual({
            state: 'unknown',
            reason: 'probe_response_lost',
            automaticRetryAllowed: false,
            cleanupAllowed: false,
            manualInterventionRequired: true,
            reconciliationRequired: true,
            restartRequired: true,
            durableReplayProtection: false,
            targetRegistered: false,
            brokerAuthority: false,
        });
        expect(context.boundary.probeBoundaryStatus()).toEqual({
            admissionAvailable: false,
            latched: true,
            reason: 'probe_response_lost',
            restartRequired: true,
            durableReplayProtection: false,
            brokerAuthority: false,
        });
        expect(
            issueProbe(context, {
                routeEvidence: issueRoute(
                    context.harness,
                    'gate_probe',
                    digests.probePlacePayload,
                ),
                runId: 'different-run',
                nonce: 'different-nonce',
            }).issued,
        ).toMatchObject({ issued: false, reason: 'probe_boundary_latched' });
        expect(authorizeProbe(context, preissuedOtherRun)).toMatchObject({
            admitted: false,
            reason: 'probe_boundary_latched',
        });
    });

    it('does not claim durable replay protection across a boundary restart', () => {
        const context = createContext();
        const secondBoundaryWithConsumedAuthority =
            createSmartOrderBrokerWriteAdmissionBoundary({
                securityAuthority: context.harness.securityAuthority,
            });
        expect(secondBoundaryWithConsumedAuthority.probeBoundaryStatus()).toEqual({
            admissionAvailable: false,
            latched: false,
            reason: null,
            restartRequired: false,
            durableReplayProtection: false,
            brokerAuthority: false,
        });
        expect(
            secondBoundaryWithConsumedAuthority.issueProbeEnvelope({}),
        ).toMatchObject({
            issued: false,
            reason: 'trusted_security_authority_unavailable',
        });
    });
});
