const ENDPOINT_PROVENANCE = Object.freeze({
    automation: 'automation',
    manual: 'manual_user_confirmed',
    gate_probe: 'gate_probe',
});

const PROBE_OPERATIONS = new Set(['place', 'update', 'cancel']);
const PROBE_RESULT_OUTCOMES = new Set([
    'confirmed',
    'broker_rejected',
    'response_lost',
]);
const MAX_CONFIRMATION_LIFETIME_MS = 60_000;
const MAX_PROBE_ENVELOPE_LIFETIME_MS = 60_000;
const MAX_TEST_EVIDENCE_LIFETIME_MS = 5_000;

const securityAuthorities = new WeakMap();
const trustedManifestDecisions = new WeakMap();
const trustedRouteEvidence = new WeakMap();
const trustedProbeTargetEvidence = new WeakMap();
const trustedProbeResultEvidence = new WeakMap();

function token(value, maximumLength = 160) {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= maximumLength &&
        value.trim() === value &&
        !/[\u0000-\u001f\u007f]/.test(value)
    );
}

function sha256Digest(value) {
    return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function safeEpoch(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function safeQuantity(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function boundedLifetime(issuedAtEpochMs, validUntilEpochMs, maximumLifetimeMs) {
    return (
        safeEpoch(issuedAtEpochMs) &&
        safeEpoch(validUntilEpochMs) &&
        validUntilEpochMs > issuedAtEpochMs &&
        validUntilEpochMs - issuedAtEpochMs <= maximumLifetimeMs
    );
}

function activeAt(issuedAtEpochMs, validUntilEpochMs, nowEpochMs) {
    return (
        safeEpoch(nowEpochMs) &&
        issuedAtEpochMs <= nowEpochMs &&
        nowEpochMs < validUntilEpochMs
    );
}

function deny(reason) {
    return Object.freeze({
        admitted: false,
        provenance: null,
        reason,
        brokerAuthority: false,
    });
}

function issuanceDenied(reason, field) {
    return Object.freeze({
        issued: false,
        reason,
        [field]: null,
        brokerAuthority: false,
    });
}

function manifestIsEligible(decision, expectedProvenance) {
    return (
        decision !== null &&
        typeof decision === 'object' &&
        !Array.isArray(decision) &&
        decision.valid === true &&
        decision.state === 'eligible' &&
        decision.provenance === expectedProvenance &&
        sha256Digest(decision.manifestSha256) &&
        Array.isArray(decision.blockers) &&
        decision.blockers.length === 0
    );
}

function canonicalProbeTarget(value) {
    if (
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !token(value.originRunId) ||
        !sha256Digest(value.targetIdDigest) ||
        !sha256Digest(value.accountRefDigest) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value.tradeDate ?? '') ||
        !Number.isSafeInteger(value.revision) ||
        value.revision < 0 ||
        typeof value.nonTerminal !== 'boolean' ||
        typeof value.correlationUnique !== 'boolean'
    ) {
        return null;
    }
    return Object.freeze({
        originRunId: value.originRunId,
        targetIdDigest: value.targetIdDigest,
        accountRefDigest: value.accountRefDigest,
        tradeDate: value.tradeDate,
        revision: value.revision,
        nonTerminal: value.nonTerminal,
        correlationUnique: value.correlationUnique,
    });
}

function probeTargetMatches(left, right) {
    return (
        left !== null &&
        right !== null &&
        left.originRunId === right.originRunId &&
        left.targetIdDigest === right.targetIdDigest &&
        left.accountRefDigest === right.accountRefDigest &&
        left.tradeDate === right.tradeDate &&
        left.revision === right.revision &&
        left.nonTerminal === right.nonTerminal &&
        left.correlationUnique === right.correlationUnique
    );
}

function targetKey(runId, targetIdDigest) {
    return `${runId}\u0000${targetIdDigest}`;
}

function frozenTestToken(kind) {
    return Object.freeze({ kind });
}

/**
 * TEST-ONLY security seam. It never produces broker adapter authority.
 *
 * The production composition root must replace this with real module-private
 * gateway, clock, lease, simulation and adapter evidence. Keeping this seam
 * explicitly test-named prevents a structural request object from becoming a
 * trusted clock or caller merely by copying fields.
 */
export function createSmartOrderBrokerWriteAdmissionTestHarness({
    nowEpochMs,
} = {}) {
    if (!safeEpoch(nowEpochMs)) {
        throw new TypeError('test trusted clock epoch is invalid');
    }
    const securityAuthority = frozenTestToken(
        'smart_order_broker_write_test_security_authority',
    );
    const securityRecord = {
        nowEpochMs,
        claimed: false,
    };
    securityAuthorities.set(securityAuthority, securityRecord);

    function setTrustedNowEpochMs(nextEpochMs) {
        if (!safeEpoch(nextEpochMs) || nextEpochMs < securityRecord.nowEpochMs) {
            throw new TypeError('test trusted clock must be monotonic');
        }
        securityRecord.nowEpochMs = nextEpochMs;
    }

    function trustManifestDecision(decision) {
        if (
            decision === null ||
            typeof decision !== 'object' ||
            Array.isArray(decision) ||
            !Object.isFrozen(decision)
        ) {
            throw new TypeError('test manifest decision must be frozen');
        }
        trustedManifestDecisions.set(decision, securityAuthority);
        return decision;
    }

    function issueRouteEvidence({
        endpoint,
        payloadSha256,
        quantityCommonLots,
        strategyId,
        activationId,
        intentId,
        validForMs = MAX_TEST_EVIDENCE_LIFETIME_MS,
    } = {}) {
        if (
            !Object.hasOwn(ENDPOINT_PROVENANCE, endpoint) ||
            !sha256Digest(payloadSha256) ||
            !safeQuantity(quantityCommonLots) ||
            !Number.isSafeInteger(validForMs) ||
            validForMs < 1 ||
            validForMs > MAX_TEST_EVIDENCE_LIFETIME_MS ||
            (['manual', 'gate_probe'].includes(endpoint) &&
                quantityCommonLots !== 1) ||
            (endpoint === 'automation' &&
                (!token(strategyId) || !token(activationId) || !token(intentId)))
        ) {
            throw new TypeError('test route evidence context is invalid');
        }
        const evidence = frozenTestToken('trusted_test_route_evidence');
        trustedRouteEvidence.set(evidence, {
            securityAuthority,
            endpoint,
            payloadSha256,
            quantityCommonLots,
            strategyId: endpoint === 'automation' ? strategyId : null,
            activationId: endpoint === 'automation' ? activationId : null,
            intentId: endpoint === 'automation' ? intentId : null,
            issuedAtEpochMs: securityRecord.nowEpochMs,
            validUntilEpochMs: securityRecord.nowEpochMs + validForMs,
            reservedFor: null,
            consumed: false,
        });
        return evidence;
    }

    function issueProbeTargetEvidence({
        purpose,
        target,
        validForMs = MAX_TEST_EVIDENCE_LIFETIME_MS,
    } = {}) {
        const canonicalTarget = canonicalProbeTarget(target);
        if (
            !['write_adjacent', 'post_operation'].includes(purpose) ||
            canonicalTarget === null ||
            !Number.isSafeInteger(validForMs) ||
            validForMs < 1 ||
            validForMs > MAX_TEST_EVIDENCE_LIFETIME_MS
        ) {
            throw new TypeError('test probe target evidence is invalid');
        }
        const evidence = frozenTestToken('trusted_test_probe_target_evidence');
        trustedProbeTargetEvidence.set(evidence, {
            securityAuthority,
            purpose,
            target: canonicalTarget,
            issuedAtEpochMs: securityRecord.nowEpochMs,
            validUntilEpochMs: securityRecord.nowEpochMs + validForMs,
            consumed: false,
        });
        return evidence;
    }

    function issueProbeResultEvidence({
        outcome,
        postTarget,
        validForMs = MAX_TEST_EVIDENCE_LIFETIME_MS,
    } = {}) {
        const canonicalPostTarget =
            postTarget === undefined ? null : canonicalProbeTarget(postTarget);
        if (
            !PROBE_RESULT_OUTCOMES.has(outcome) ||
            (postTarget !== undefined && canonicalPostTarget === null) ||
            !Number.isSafeInteger(validForMs) ||
            validForMs < 1 ||
            validForMs > MAX_TEST_EVIDENCE_LIFETIME_MS
        ) {
            throw new TypeError('test probe result evidence is invalid');
        }
        const evidence = frozenTestToken('trusted_test_probe_result_evidence');
        trustedProbeResultEvidence.set(evidence, {
            securityAuthority,
            outcome,
            postTarget: canonicalPostTarget,
            issuedAtEpochMs: securityRecord.nowEpochMs,
            validUntilEpochMs: securityRecord.nowEpochMs + validForMs,
            consumed: false,
        });
        return evidence;
    }

    return Object.freeze({
        securityAuthority,
        issueProbeResultEvidence,
        issueProbeTargetEvidence,
        issueRouteEvidence,
        setTrustedNowEpochMs,
        trustManifestDecision,
    });
}

/**
 * Pure offline admission contract for a future broker-write gateway.
 *
 * A positive decision is still not adapter/socket authority. With no
 * module-branded security authority, this boundary is deliberately closed.
 * Cross-process nonce durability is also deliberately unavailable here.
 */
export function createSmartOrderBrokerWriteAdmissionBoundary({
    securityAuthority,
} = {}) {
    const candidateSecurityRecord = securityAuthorities.get(securityAuthority);
    const securityRecord =
        candidateSecurityRecord && candidateSecurityRecord.claimed === false
            ? candidateSecurityRecord
            : null;
    if (securityRecord) securityRecord.claimed = true;

    const manualConfirmations = new WeakMap();
    const probeEnvelopes = new WeakMap();
    const probeReceipts = new WeakMap();
    const consumedProbeNonces = new Set();
    const probeTargets = new Map();
    const haltedProbeRuns = new Set();
    let probeBoundaryLatched = false;
    let probeBoundaryLatchReason = null;

    function trustedNowEpochMs() {
        return securityRecord && safeEpoch(securityRecord.nowEpochMs)
            ? securityRecord.nowEpochMs
            : null;
    }

    function manifestDecisionIsTrusted(decision) {
        return (
            securityRecord !== null &&
            trustedManifestDecisions.get(decision) === securityAuthority
        );
    }

    function routeEvidenceRecord({
        routeEvidence,
        endpoint,
        payloadSha256,
        quantityCommonLots,
        nowEpochMs,
    }) {
        const record = trustedRouteEvidence.get(routeEvidence);
        return record &&
            record.securityAuthority === securityAuthority &&
            record.endpoint === endpoint &&
            record.payloadSha256 === payloadSha256 &&
            record.quantityCommonLots === quantityCommonLots &&
            record.consumed === false &&
            activeAt(
                record.issuedAtEpochMs,
                record.validUntilEpochMs,
                nowEpochMs,
            )
            ? record
            : null;
    }

    function issueManualConfirmation(input = {}) {
        const nowEpochMs = trustedNowEpochMs();
        if (nowEpochMs === null) {
            return issuanceDenied(
                'trusted_security_authority_unavailable',
                'confirmation',
            );
        }
        const routeRecord = routeEvidenceRecord({
            routeEvidence: input.routeEvidence,
            endpoint: 'manual',
            payloadSha256: input.payloadSha256,
            quantityCommonLots: input.quantityCommonLots,
            nowEpochMs,
        });
        if (!routeRecord || routeRecord.reservedFor !== null) {
            return issuanceDenied('manual_route_evidence_invalid', 'confirmation');
        }
        if (
            !sha256Digest(input.payloadSha256) ||
            input.quantityCommonLots !== 1 ||
            !boundedLifetime(
                nowEpochMs,
                input.validUntilEpochMs,
                MAX_CONFIRMATION_LIFETIME_MS,
            )
        ) {
            return issuanceDenied(
                'manual_confirmation_envelope_invalid',
                'confirmation',
            );
        }
        const confirmation = frozenTestToken('manual_confirmation_receipt');
        routeRecord.reservedFor = confirmation;
        manualConfirmations.set(confirmation, {
            routeEvidence: input.routeEvidence,
            payloadSha256: input.payloadSha256,
            quantityCommonLots: input.quantityCommonLots,
            issuedAtEpochMs: nowEpochMs,
            validUntilEpochMs: input.validUntilEpochMs,
            consumed: false,
        });
        return Object.freeze({
            issued: true,
            confirmation,
            issuedAtEpochMs: nowEpochMs,
            brokerAuthority: false,
        });
    }

    function issueProbeEnvelope(input = {}) {
        const nowEpochMs = trustedNowEpochMs();
        if (nowEpochMs === null) {
            return issuanceDenied(
                'trusted_security_authority_unavailable',
                'envelope',
            );
        }
        if (probeBoundaryLatched) {
            return issuanceDenied('probe_boundary_latched', 'envelope');
        }
        const routeRecord = routeEvidenceRecord({
            routeEvidence: input.routeEvidence,
            endpoint: 'gate_probe',
            payloadSha256: input.payloadSha256,
            quantityCommonLots: input.quantityCommonLots,
            nowEpochMs,
        });
        if (!routeRecord || routeRecord.reservedFor !== null) {
            return issuanceDenied('probe_route_evidence_invalid', 'envelope');
        }
        if (
            !token(input.runId) ||
            !token(input.nonce) ||
            !PROBE_OPERATIONS.has(input.operation) ||
            !sha256Digest(input.payloadSha256) ||
            input.quantityCommonLots !== 1 ||
            !sha256Digest(input.accountRefDigest) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(input.tradeDate ?? '') ||
            !boundedLifetime(
                nowEpochMs,
                input.validUntilEpochMs,
                MAX_PROBE_ENVELOPE_LIFETIME_MS,
            )
        ) {
            return issuanceDenied('probe_envelope_invalid', 'envelope');
        }
        if (haltedProbeRuns.has(input.runId)) {
            return issuanceDenied('probe_run_halted', 'envelope');
        }
        if (consumedProbeNonces.has(input.nonce)) {
            return issuanceDenied('probe_nonce_replayed', 'envelope');
        }

        const target =
            input.operation === 'place'
                ? null
                : canonicalProbeTarget(input.target);
        if (input.operation !== 'place' && target === null) {
            return issuanceDenied('probe_target_invalid', 'envelope');
        }
        if (target !== null && target.originRunId !== input.runId) {
            return issuanceDenied('probe_target_run_mismatch', 'envelope');
        }
        if (
            target !== null &&
            (target.accountRefDigest !== input.accountRefDigest ||
                target.tradeDate !== input.tradeDate ||
                target.nonTerminal !== true ||
                target.correlationUnique !== true)
        ) {
            return issuanceDenied('probe_target_scope_invalid', 'envelope');
        }

        const envelope = frozenTestToken('gate_probe_nonce_envelope');
        routeRecord.reservedFor = envelope;
        consumedProbeNonces.add(input.nonce);
        probeEnvelopes.set(envelope, {
            routeEvidence: input.routeEvidence,
            runId: input.runId,
            nonce: input.nonce,
            operation: input.operation,
            payloadSha256: input.payloadSha256,
            quantityCommonLots: input.quantityCommonLots,
            accountRefDigest: input.accountRefDigest,
            tradeDate: input.tradeDate,
            issuedAtEpochMs: nowEpochMs,
            validUntilEpochMs: input.validUntilEpochMs,
            target,
            consumed: false,
        });
        return Object.freeze({
            issued: true,
            envelope,
            issuedAtEpochMs: nowEpochMs,
            brokerAuthority: false,
        });
    }

    function authorize(input = {}) {
        if (
            Object.keys(input).some((key) => /provenance/i.test(key))
        ) {
            return deny('client_supplied_provenance_forbidden');
        }
        const nowEpochMs = trustedNowEpochMs();
        if (nowEpochMs === null) {
            return deny('trusted_security_authority_unavailable');
        }
        const provenance = ENDPOINT_PROVENANCE[input.endpoint];
        if (provenance === undefined) {
            return deny('broker_write_endpoint_forbidden');
        }
        if (provenance === 'gate_probe' && probeBoundaryLatched) {
            return deny('probe_boundary_latched');
        }
        const routeRecord = routeEvidenceRecord({
            routeEvidence: input.routeEvidence,
            endpoint: input.endpoint,
            payloadSha256: input.payloadSha256,
            quantityCommonLots: input.quantityCommonLots,
            nowEpochMs,
        });
        if (!routeRecord) {
            return deny('trusted_route_evidence_invalid');
        }
        routeRecord.consumed = true;
        if (
            !manifestDecisionIsTrusted(input.manifestDecision) ||
            !manifestIsEligible(input.manifestDecision, provenance)
        ) {
            return deny('gate_manifest_not_eligible');
        }

        if (provenance === 'automation') {
            if (
                routeRecord.reservedFor !== null ||
                !token(routeRecord.strategyId) ||
                !token(routeRecord.activationId) ||
                !token(routeRecord.intentId)
            ) {
                return deny('automation_route_lineage_invalid');
            }
            return Object.freeze({
                admitted: true,
                provenance,
                reason: null,
                payloadSha256: routeRecord.payloadSha256,
                brokerAuthority: false,
            });
        }

        if (provenance === 'manual_user_confirmed') {
            const confirmation = manualConfirmations.get(input.confirmation);
            if (
                !confirmation ||
                confirmation.consumed ||
                routeRecord.reservedFor !== input.confirmation
            ) {
                return deny('manual_confirmation_missing_or_replayed');
            }
            confirmation.consumed = true;
            if (
                confirmation.routeEvidence !== input.routeEvidence ||
                confirmation.payloadSha256 !== input.payloadSha256 ||
                confirmation.quantityCommonLots !== input.quantityCommonLots ||
                !activeAt(
                    confirmation.issuedAtEpochMs,
                    confirmation.validUntilEpochMs,
                    nowEpochMs,
                )
            ) {
                return deny('manual_confirmation_invalid_or_expired');
            }
            return Object.freeze({
                admitted: true,
                provenance,
                reason: null,
                payloadSha256: confirmation.payloadSha256,
                quantityCommonLots: confirmation.quantityCommonLots,
                brokerAuthority: false,
            });
        }

        const envelope = probeEnvelopes.get(input.probeEnvelope);
        if (
            !envelope ||
            envelope.consumed ||
            routeRecord.reservedFor !== input.probeEnvelope
        ) {
            return deny('probe_envelope_missing_or_replayed');
        }
        envelope.consumed = true;
        if (
            envelope.routeEvidence !== input.routeEvidence ||
            envelope.payloadSha256 !== input.payloadSha256 ||
            envelope.quantityCommonLots !== input.quantityCommonLots ||
            !activeAt(
                envelope.issuedAtEpochMs,
                envelope.validUntilEpochMs,
                nowEpochMs,
            ) ||
            haltedProbeRuns.has(envelope.runId)
        ) {
            return deny('probe_envelope_expired_or_halted');
        }
        if (envelope.target !== null) {
            const storedTarget = probeTargets.get(
                targetKey(envelope.runId, envelope.target.targetIdDigest),
            );
            const observation = trustedProbeTargetEvidence.get(
                input.currentProbeTargetEvidence,
            );
            if (
                !observation ||
                observation.securityAuthority !== securityAuthority ||
                observation.purpose !== 'write_adjacent' ||
                observation.consumed ||
                !activeAt(
                    observation.issuedAtEpochMs,
                    observation.validUntilEpochMs,
                    nowEpochMs,
                ) ||
                !probeTargetMatches(storedTarget ?? null, envelope.target) ||
                !probeTargetMatches(observation.target, envelope.target)
            ) {
                return deny('probe_target_lineage_or_revision_changed');
            }
            observation.consumed = true;
        }

        const receipt = frozenTestToken('gate_probe_admission_receipt');
        probeReceipts.set(receipt, {
            ...envelope,
            securityAuthority,
            settled: false,
        });
        return Object.freeze({
            admitted: true,
            provenance,
            reason: null,
            payloadSha256: envelope.payloadSha256,
            quantityCommonLots: envelope.quantityCommonLots,
            probeReceipt: receipt,
            brokerAuthority: false,
        });
    }

    function haltProbeBoundary(meta, reason) {
        probeBoundaryLatched = true;
        probeBoundaryLatchReason = reason;
        haltedProbeRuns.add(meta.runId);
        return Object.freeze({
            state: 'unknown',
            reason,
            automaticRetryAllowed: false,
            cleanupAllowed: false,
            manualInterventionRequired: true,
            reconciliationRequired: true,
            restartRequired: true,
            durableReplayProtection: false,
            targetRegistered: false,
            brokerAuthority: false,
        });
    }

    function settleProbeOperation({ probeReceipt, resultEvidence } = {}) {
        const meta = probeReceipts.get(probeReceipt);
        const result = trustedProbeResultEvidence.get(resultEvidence);
        const nowEpochMs = trustedNowEpochMs();
        if (
            !meta ||
            meta.settled ||
            !result ||
            result.securityAuthority !== securityAuthority ||
            result.consumed ||
            nowEpochMs === null ||
            !activeAt(
                result.issuedAtEpochMs,
                result.validUntilEpochMs,
                nowEpochMs,
            )
        ) {
            return Object.freeze({
                state: 'rejected',
                reason: 'probe_result_evidence_missing_or_replayed',
                automaticRetryAllowed: false,
                cleanupAllowed: false,
                manualInterventionRequired: true,
                reconciliationRequired: true,
                restartRequired: false,
                durableReplayProtection: false,
                targetRegistered: false,
                brokerAuthority: false,
            });
        }
        meta.settled = true;
        result.consumed = true;
        if (result.outcome === 'response_lost') {
            return haltProbeBoundary(meta, 'probe_response_lost');
        }
        if (result.outcome === 'broker_rejected') {
            return Object.freeze({
                state: 'broker_rejected',
                reason: null,
                automaticRetryAllowed: false,
                cleanupAllowed: false,
                manualInterventionRequired: false,
                reconciliationRequired: false,
                restartRequired: false,
                durableReplayProtection: false,
                targetRegistered: false,
                brokerAuthority: false,
            });
        }

        if (meta.operation === 'place') {
            const confirmedTarget = result.postTarget;
            if (
                confirmedTarget === null ||
                confirmedTarget.originRunId !== meta.runId ||
                confirmedTarget.accountRefDigest !== meta.accountRefDigest ||
                confirmedTarget.tradeDate !== meta.tradeDate ||
                confirmedTarget.nonTerminal !== true ||
                confirmedTarget.correlationUnique !== true
            ) {
                return haltProbeBoundary(meta, 'probe_confirmed_target_invalid');
            }
            probeTargets.set(
                targetKey(meta.runId, confirmedTarget.targetIdDigest),
                confirmedTarget,
            );
            return Object.freeze({
                state: 'confirmed',
                reason: null,
                automaticRetryAllowed: false,
                cleanupAllowed: false,
                manualInterventionRequired: false,
                reconciliationRequired: false,
                restartRequired: false,
                durableReplayProtection: false,
                targetRegistered: true,
                brokerAuthority: false,
            });
        }

        const storedKey = targetKey(meta.runId, meta.target.targetIdDigest);
        const storedTarget = probeTargets.get(storedKey);
        if (!probeTargetMatches(storedTarget ?? null, meta.target)) {
            return haltProbeBoundary(meta, 'probe_target_changed_after_admission');
        }
        if (meta.operation === 'update') {
            const postTarget = result.postTarget;
            if (
                postTarget === null ||
                postTarget.originRunId !== meta.target.originRunId ||
                postTarget.targetIdDigest !== meta.target.targetIdDigest ||
                postTarget.accountRefDigest !== meta.target.accountRefDigest ||
                postTarget.tradeDate !== meta.target.tradeDate ||
                postTarget.revision <= meta.target.revision ||
                postTarget.nonTerminal !== true ||
                postTarget.correlationUnique !== true
            ) {
                return haltProbeBoundary(meta, 'probe_post_update_target_invalid');
            }
            probeTargets.set(storedKey, postTarget);
            return Object.freeze({
                state: 'confirmed',
                reason: null,
                automaticRetryAllowed: false,
                cleanupAllowed: false,
                manualInterventionRequired: false,
                reconciliationRequired: false,
                restartRequired: false,
                durableReplayProtection: false,
                targetRegistered: true,
                brokerAuthority: false,
            });
        }

        if (result.postTarget !== null) {
            return haltProbeBoundary(meta, 'probe_post_cancel_target_invalid');
        }
        probeTargets.set(
            storedKey,
            Object.freeze({ ...storedTarget, nonTerminal: false }),
        );
        return Object.freeze({
            state: 'confirmed',
            reason: null,
            automaticRetryAllowed: false,
            cleanupAllowed: false,
            manualInterventionRequired: false,
            reconciliationRequired: false,
            restartRequired: false,
            durableReplayProtection: false,
            targetRegistered: false,
            brokerAuthority: false,
        });
    }

    function probeBoundaryStatus() {
        return Object.freeze({
            admissionAvailable: securityRecord !== null && !probeBoundaryLatched,
            latched: probeBoundaryLatched,
            reason: probeBoundaryLatchReason,
            restartRequired: probeBoundaryLatched,
            durableReplayProtection: false,
            brokerAuthority: false,
        });
    }

    function probeRunStatus(runId) {
        if (!token(runId)) {
            return Object.freeze({
                halted: true,
                targetCount: 0,
                boundaryLatched: probeBoundaryLatched,
            });
        }
        let targetCount = 0;
        for (const target of probeTargets.values()) {
            if (target.originRunId === runId && target.nonTerminal) {
                targetCount += 1;
            }
        }
        return Object.freeze({
            halted: haltedProbeRuns.has(runId),
            targetCount,
            boundaryLatched: probeBoundaryLatched,
        });
    }

    return Object.freeze({
        authorize,
        issueManualConfirmation,
        issueProbeEnvelope,
        probeBoundaryStatus,
        probeRunStatus,
        settleProbeOperation,
    });
}
