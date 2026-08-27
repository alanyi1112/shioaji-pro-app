import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';
import {
    SMART_ORDER_CURRENT_MANUAL_ROUTE_COVERAGE,
    SMART_ORDER_MANUAL_ROUTE_COVERAGE_VERSION,
    SMART_ORDER_STOCK_WRITE_ROUTES,
} from './manual-route-coverage.mjs';

export const SMART_ORDER_BROKER_WRITE_PROVENANCE_CLASSIFIER_SCHEMA_VERSION =
    'smart-order-broker-write-provenance-classifier/2026-08-13.1';

const ROUTE_BY_ID = new Map(
    SMART_ORDER_STOCK_WRITE_ROUTES.map((route) => [route.routeId, route]),
);
const CALLER_CLASSES = new Set([
    'interactive_ui',
    'runtime_scheduler',
    'quote_evaluator',
    'gate_cli',
]);
const FAMILY_CALLERS = Object.freeze({
    manual: Object.freeze(['interactive_ui']),
    automation: Object.freeze(['runtime_scheduler', 'quote_evaluator']),
    gate_probe: Object.freeze(['gate_cli']),
});
const MAX_CONFIRMATION_LIFETIME_MS = 60_000;

function exactOwnDataSnapshot(value, keys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
        Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string') ||
        canonicalJson(Object.keys(descriptors).sort()) !==
            canonicalJson([...keys].sort()) ||
        Object.values(descriptors).some(
            (descriptor) =>
                !Object.hasOwn(descriptor, 'value') ||
                typeof descriptor.get === 'function' ||
                typeof descriptor.set === 'function',
        )
    ) {
        throw new TypeError(`${label} must use exact own data properties`);
    }
    return Object.freeze(
        Object.fromEntries(keys.map((key) => [key, descriptors[key].value])),
    );
}

function token(value, label, maximumLength = 160) {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > maximumLength ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        throw new TypeError(`${label} must be a bounded token`);
    }
    return value;
}

function sha256(value, label) {
    if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
        throw new TypeError(`${label} must be a SHA-256 digest`);
    }
    return value;
}

function safeEpoch(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} must be a safe epoch`);
    }
    return value;
}

function deny(reason) {
    return Object.freeze({
        classified: false,
        admitted: false,
        provenance: 'unknown',
        reason,
        automationAccountEligibility: 'disabled',
        brokerWriteAuthority: false,
        writeMasterAuthority: false,
    });
}

function decisionHash(content) {
    return `sha256:${createHash('sha256')
        .update(canonicalJson(content))
        .digest('hex')}`;
}

export function createSmartOrderBrokerWriteProvenanceBoundary({
    now = () => Date.now(),
} = {}) {
    if (typeof now !== 'function') {
        throw new TypeError('provenance trusted clock is invalid');
    }
    const routes = new WeakMap();
    const callers = new WeakMap();
    const manualConfirmations = new WeakMap();
    const probeNonces = new WeakMap();
    const issuedDecisions = new WeakSet();

    function registerServerRoute(input) {
        const snapshot = exactOwnDataSnapshot(
            input,
            ['family', 'operation', 'routeId'],
            'server route registration',
        );
        const current = ROUTE_BY_ID.get(snapshot.routeId);
        if (
            !current ||
            current.family !== snapshot.family ||
            current.operation !== snapshot.operation
        ) {
            throw new TypeError('server route is outside the coverage matrix');
        }
        const evidence = Object.freeze({
            kind: 'server_registered_broker_write_route',
        });
        routes.set(evidence, current);
        return evidence;
    }

    function registerCaller(input) {
        const snapshot = exactOwnDataSnapshot(
            input,
            ['callerClass'],
            'server caller registration',
        );
        if (!CALLER_CLASSES.has(snapshot.callerClass)) {
            throw new TypeError('server caller class is invalid');
        }
        const evidence = Object.freeze({ kind: 'server_registered_caller' });
        callers.set(evidence, snapshot.callerClass);
        return evidence;
    }

    function issueManualConfirmation(input) {
        const snapshot = exactOwnDataSnapshot(
            input,
            [
                'callerEvidence',
                'canonicalPayloadSha256',
                'confirmationId',
                'confirmationRevision',
                'routeEvidence',
                'validForMs',
            ],
            'manual confirmation issuance',
        );
        const route = routes.get(snapshot.routeEvidence);
        const callerClass = callers.get(snapshot.callerEvidence);
        const issuedAtEpochMs = safeEpoch(now(), 'trusted now');
        if (
            route?.family !== 'manual' ||
            callerClass !== 'interactive_ui' ||
            !Number.isSafeInteger(snapshot.confirmationRevision) ||
            snapshot.confirmationRevision < 0 ||
            !Number.isSafeInteger(snapshot.validForMs) ||
            snapshot.validForMs < 1 ||
            snapshot.validForMs > MAX_CONFIRMATION_LIFETIME_MS
        ) {
            throw new TypeError('manual confirmation context is invalid');
        }
        const evidence = Object.freeze({ kind: 'server_manual_confirmation' });
        manualConfirmations.set(evidence, {
            routeId: route.routeId,
            canonicalPayloadSha256: sha256(
                snapshot.canonicalPayloadSha256,
                'canonicalPayloadSha256',
            ),
            confirmationId: token(
                snapshot.confirmationId,
                'confirmationId',
            ),
            confirmationRevision: snapshot.confirmationRevision,
            issuedAtEpochMs,
            validUntilEpochMs: issuedAtEpochMs + snapshot.validForMs,
            consumed: false,
        });
        return evidence;
    }

    function issueProbeNonce(input) {
        const snapshot = exactOwnDataSnapshot(
            input,
            [
                'callerEvidence',
                'canonicalPayloadSha256',
                'operationNonce',
                'probeRunId',
                'routeEvidence',
                'validForMs',
            ],
            'probe nonce issuance',
        );
        const route = routes.get(snapshot.routeEvidence);
        const callerClass = callers.get(snapshot.callerEvidence);
        const issuedAtEpochMs = safeEpoch(now(), 'trusted now');
        if (
            route?.family !== 'gate_probe' ||
            callerClass !== 'gate_cli' ||
            !Number.isSafeInteger(snapshot.validForMs) ||
            snapshot.validForMs < 1 ||
            snapshot.validForMs > MAX_CONFIRMATION_LIFETIME_MS
        ) {
            throw new TypeError('probe nonce context is invalid');
        }
        const evidence = Object.freeze({ kind: 'server_probe_nonce' });
        probeNonces.set(evidence, {
            routeId: route.routeId,
            canonicalPayloadSha256: sha256(
                snapshot.canonicalPayloadSha256,
                'canonicalPayloadSha256',
            ),
            probeRunId: token(snapshot.probeRunId, 'probeRunId'),
            operationNonce: token(snapshot.operationNonce, 'operationNonce'),
            issuedAtEpochMs,
            validUntilEpochMs: issuedAtEpochMs + snapshot.validForMs,
            consumed: false,
        });
        return evidence;
    }

    function classify(input) {
        let snapshot;
        try {
            snapshot = exactOwnDataSnapshot(
                input,
                [
                    'automationBinding',
                    'callerEvidence',
                    'canonicalPayloadSha256',
                    'manualConfirmationEvidence',
                    'probeNonceEvidence',
                    'routeEvidence',
                ],
                'broker write classification',
            );
        } catch {
            return deny('client_supplied_or_noncanonical_context');
        }
        const route = routes.get(snapshot.routeEvidence);
        const callerClass = callers.get(snapshot.callerEvidence);
        if (!route || !callerClass) return deny('untrusted_route_or_caller');
        if (!FAMILY_CALLERS[route.family].includes(callerClass)) {
            return deny('caller_route_family_mismatch');
        }
        let canonicalPayloadSha256;
        try {
            canonicalPayloadSha256 = sha256(
                snapshot.canonicalPayloadSha256,
                'canonicalPayloadSha256',
            );
        } catch {
            return deny('payload_binding_invalid');
        }

        let binding;
        const nowEpochMs = safeEpoch(now(), 'trusted now');
        if (route.family === 'manual') {
            const confirmation = manualConfirmations.get(
                snapshot.manualConfirmationEvidence,
            );
            if (
                !confirmation ||
                confirmation.consumed ||
                confirmation.routeId !== route.routeId ||
                confirmation.canonicalPayloadSha256 !==
                    canonicalPayloadSha256 ||
                nowEpochMs < confirmation.issuedAtEpochMs ||
                nowEpochMs >= confirmation.validUntilEpochMs ||
                snapshot.automationBinding !== null ||
                snapshot.probeNonceEvidence !== null
            ) {
                return deny('manual_confirmation_invalid_or_replayed');
            }
            confirmation.consumed = true;
            binding = Object.freeze({
                confirmationId: confirmation.confirmationId,
                confirmationRevision: confirmation.confirmationRevision,
            });
        } else if (route.family === 'automation') {
            let automation;
            try {
                automation = exactOwnDataSnapshot(
                    snapshot.automationBinding,
                    ['activationId', 'intentId', 'intentRevision', 'strategyId'],
                    'automation binding',
                );
                if (
                    !Number.isSafeInteger(automation.intentRevision) ||
                    automation.intentRevision < 0
                ) {
                    throw new TypeError('intent revision is invalid');
                }
                binding = Object.freeze({
                    strategyId: token(automation.strategyId, 'strategyId'),
                    activationId: token(automation.activationId, 'activationId'),
                    intentId: token(automation.intentId, 'intentId'),
                    intentRevision: automation.intentRevision,
                });
            } catch {
                return deny('automation_binding_invalid');
            }
            if (
                snapshot.manualConfirmationEvidence !== null ||
                snapshot.probeNonceEvidence !== null
            ) {
                return deny('cross_family_authority_forbidden');
            }
        } else {
            const nonce = probeNonces.get(snapshot.probeNonceEvidence);
            if (
                !nonce ||
                nonce.consumed ||
                nonce.routeId !== route.routeId ||
                nonce.canonicalPayloadSha256 !== canonicalPayloadSha256 ||
                nowEpochMs < nonce.issuedAtEpochMs ||
                nowEpochMs >= nonce.validUntilEpochMs ||
                snapshot.automationBinding !== null ||
                snapshot.manualConfirmationEvidence !== null
            ) {
                return deny('probe_nonce_invalid_or_replayed');
            }
            nonce.consumed = true;
            binding = Object.freeze({
                probeRunId: nonce.probeRunId,
                operationNonce: nonce.operationNonce,
            });
        }

        const provenance =
            route.family === 'manual'
                ? 'manual_user_confirmed'
                : route.family;
        const content = Object.freeze({
            schemaVersion:
                SMART_ORDER_BROKER_WRITE_PROVENANCE_CLASSIFIER_SCHEMA_VERSION,
            coverageVersion: SMART_ORDER_MANUAL_ROUTE_COVERAGE_VERSION,
            routeId: route.routeId,
            operation: route.operation,
            callerClass,
            provenance,
            canonicalPayloadSha256,
            binding,
        });
        const routeGoverned = route.state === 'governed';
        const decision = Object.freeze({
            ...content,
            classified: true,
            admitted: false,
            reason: routeGoverned
                ? 'downstream_broker_admission_required'
                : 'route_not_governed',
            decisionSha256: decisionHash(content),
            automationAccountEligibility:
                SMART_ORDER_CURRENT_MANUAL_ROUTE_COVERAGE
                    .automationAccountEligibility,
            brokerWriteAuthority: false,
            writeMasterAuthority: false,
        });
        issuedDecisions.add(decision);
        return decision;
    }

    function isServerDerivedDecision(value) {
        return Boolean(
            value && typeof value === 'object' && issuedDecisions.has(value),
        );
    }

    return Object.freeze({
        classify,
        isServerDerivedDecision,
        issueManualConfirmation,
        issueProbeNonce,
        registerCaller,
        registerServerRoute,
        status() {
            return Object.freeze({
                schemaVersion:
                    SMART_ORDER_BROKER_WRITE_PROVENANCE_CLASSIFIER_SCHEMA_VERSION,
                coverageVersion: SMART_ORDER_MANUAL_ROUTE_COVERAGE_VERSION,
                coverageSha256:
                    SMART_ORDER_CURRENT_MANUAL_ROUTE_COVERAGE.coverageSha256,
                inventoryComplete: true,
                classifierContractPassed: true,
                automationAccountEligibility: 'disabled',
                brokerWriteAuthority: false,
                writeMasterAuthority: false,
            });
        },
    });
}
