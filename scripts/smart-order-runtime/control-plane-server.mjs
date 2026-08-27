import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import { types as utilTypes } from 'node:util';
import {
    SMART_ORDER_CONTROL_PLANE_MAX_ENVELOPE_BYTES,
    authorizeSmartOrderControlPlaneRequest,
    createSmartOrderControlPlaneResponseProof,
    openSmartOrderControlPlaneMutation,
} from './control-plane-security.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { publicStrategyOperationError } from './strategy-operation-error.mjs';
import {
    DEFAULT_SMART_ORDER_BODY_DEADLINE_MS,
    createSmartOrderMutationAdmissionController,
    readSmartOrderBodyWithDeadline,
} from './control-plane-capacity.mjs';
import { SMART_ORDER_JOURNAL_ENTITY_KINDS } from './repository-schema.mjs';
import {
    SMART_ORDER_LIFECYCLE_OPERATIONS,
    selectSmartOrderLifecycleDrainProjection,
} from './lifecycle-drain-policy.mjs';
import {
    SMART_ORDER_RUNTIME_READINESS_CONJUNCT_IDS,
    projectSmartOrderRuntimeReadinessCandidate,
} from './runtime-readiness-policy.mjs';
import { projectSmartOrderManualRouteCoverageStatus } from './manual-route-coverage.mjs';
import { SMART_ORDER_STOCK_WRITE_ROUTES } from './manual-route-coverage.mjs';
import { createSmartOrderBrokerWriteProvenanceBoundary } from './broker-write-provenance-classifier.mjs';
import { canonicalManualStockBrokerWriteRequest } from './manual-broker-write-contract.mjs';
import { verifySmartOrderGateProbeCliAuthorization } from './gate-probe-cli-authorization.mjs';

export const SMART_ORDER_CONTROL_PLANE_SERVER_SCHEMA_VERSION =
    'smart-order-control-plane-server/2026-08-11.1';

const LOOPBACK_HOST = '127.0.0.1';
const MAX_HEADER_COUNT = 48;
const MAX_REQUEST_URL_BYTES = 1_024;
const HEADER_TIMEOUT_MS = 3_000;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_ACTIVE_REQUESTS = 16;
const SIDECAR_MUTATION_GLOBAL_RATE_LIMIT = 30;
const SIDECAR_MUTATION_MAX_CONCURRENT = 4;
const SIDECAR_MUTATION_MAX_QUEUED = 8;
const RUNTIME_EPOCH_PATTERN = /^[A-Za-z0-9._:-]{1,240}$/;
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const SMART_ORDER_HISTORY_MAX_ITEMS = 100;
const STOCK_WRITE_ROUTE_BY_ID = new Map(
    SMART_ORDER_STOCK_WRITE_ROUTES.map((route) => [route.routeId, route]),
);
const SMART_ORDER_HISTORY_SCHEMA_VERSION =
    'smart-order-history-projection/2026-08-12.2';
const SMART_ORDER_EVENT_SCHEMA_VERSION =
    'smart-order-event-projection/2026-08-11.1';
const SMART_ORDER_EVENT_MAX_ITEMS = 100;
const SMART_ORDER_HISTORY_TYPES = new Set(['strategy']);
const SMART_ORDER_HISTORY_STRATEGY_KINDS = new Set([
    'quick',
    'good_till',
    'multi_condition',
    'parent_child',
    'stop_take',
    'trailing_exit',
    'scheduled_quantity',
]);
const SMART_ORDER_HISTORY_TERMINAL_STATES = new Set([
    'cancelled',
    'completed',
    'expired',
    'failed',
]);
const SMART_ORDER_HISTORY_REASON_STATES = new Map([
    [
        'STRATEGY_TERMINAL_IMPORTED',
        new Set(['cancelled', 'completed', 'expired', 'failed']),
    ],
    ['STRATEGY_CANCELLED_WITHOUT_SIDE_EFFECTS', new Set(['cancelled'])],
]);
const responseAuthentication = new WeakMap();

function jsonResponse(response, statusCode, payload) {
    const serialized = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8');
    const authentication = responseAuthentication.get(response);
    response.statusCode = statusCode;
    response.setHeader('Content-Type', JSON_CONTENT_TYPE);
    response.setHeader('Content-Length', serialized.byteLength);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (authentication) {
        const proof = createSmartOrderControlPlaneResponseProof({
            capability: authentication.capability,
            runtimeEpochId: authentication.runtimeEpochId,
            sidecarAuthority: authentication.sidecarAuthority,
            requestId: authentication.requestId,
            method: authentication.method,
            pathname: authentication.pathname,
            requestBodySha256: authentication.requestBodySha256,
            statusCode,
            contentType: JSON_CONTENT_TYPE,
            bodyBytes: serialized,
        });
        response.setHeader(
            'X-RealTimeStock-Response-Request-Id',
            proof.requestId,
        );
        response.setHeader(
            'X-RealTimeStock-Runtime-Epoch',
            proof.runtimeEpochId,
        );
        response.setHeader(
            'X-RealTimeStock-Response-Body-SHA256',
            proof.bodySha256,
        );
        response.setHeader(
            'X-RealTimeStock-Response-Proof',
            proof.proof,
        );
    }
    response.end(serialized);
}

function exactKeys(value, required, optional = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value).sort();
    const allowed = new Set([...required, ...optional]);
    return (
        required.every((key) => Object.hasOwn(value, key)) &&
        keys.every((key) => allowed.has(key)) &&
        keys.length >= required.length
    );
}

function parseJsonObject(body) {
    let parsed;
    try {
        const text = body.toString('utf8');
        if (
            Buffer.from(text, 'utf8').byteLength !== body.byteLength ||
            /"(?:__proto__|prototype|constructor)"\s*:/.test(text)
        ) {
            return null;
        }
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    return parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        Object.getPrototypeOf(parsed) === Object.prototype
        ? parsed
        : null;
}

function operationId(value) {
    return typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            value,
        )
        ? value
        : null;
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function executeReplayProtectedMutation({
    runtimeController,
    decision,
    operationKind,
    body,
    nowEpochMs,
    buildMutation,
}) {
    const parsed = parseJsonObject(body);
    const clientOperationId = operationId(parsed?.operationId);
    if (!clientOperationId) {
        return {
            status: 422,
            payload: {
                code: 'operation_id_invalid',
                brokerWriteAttempted: false,
            },
        };
    }
    if (
        typeof runtimeController?.executeReplayProtectedStrategyMutation !==
        'function'
    ) {
        return {
            status: 503,
            payload: {
                code: 'mutation_service_not_wired',
                brokerWriteAttempted: false,
            },
        };
    }
    const replayScope = {
        routeId: decision.route.routeId,
        strategyId: decision.route.strategyId ?? null,
    };
    const payloadHash = sha256(
        canonicalJson({
            bodySha256: `sha256:${decision.bodySha256}`,
            replayScope,
        }),
    );
    let mutation;
    try {
        mutation = await buildMutation(parsed);
    } catch (error) {
        const publicError = publicStrategyOperationError(error);
        return {
            status: publicError.status,
            payload: {
                code: publicError.code,
                brokerWriteAttempted: false,
            },
        };
    }
    let replay;
    try {
        replay = await runtimeController.executeReplayProtectedStrategyMutation({
            requestId: clientOperationId,
            operationKind,
            payloadHash,
            nowEpochMs,
            mutation,
        });
    } catch (error) {
        const conflict = String(error?.message ?? '').includes(
            'request id was reused with different content',
        );
        return {
            status: conflict ? 409 : 503,
            payload: {
                code: conflict
                    ? 'operation_id_payload_conflict'
                    : 'strategy_service_unavailable',
                brokerWriteAttempted: false,
            },
        };
    }
    if (replay.state === 'completed') {
        return {
            status: 200,
            payload: {
                result: replay.result,
                resultHash: replay.resultHash,
                brokerWriteAttempted: false,
            },
        };
    }
    if (replay.state === 'failed') {
        const stored = replay.result;
        if (
            !stored ||
            typeof stored !== 'object' ||
            Array.isArray(stored) ||
            Object.keys(stored).sort().join(',') !== 'code,status' ||
            typeof stored.code !== 'string' ||
            stored.code.length === 0 ||
            stored.status !== replay.resultStatus ||
            !Number.isSafeInteger(stored.status) ||
            stored.status < 400 ||
            stored.status > 599
        ) {
            return {
                status: 503,
                payload: {
                    code: 'operation_replay_invalid',
                    brokerWriteAttempted: false,
                },
            };
        }
        let latestSnapshot;
        if (
            stored.code === 'stale_revision' &&
            typeof decision.route.strategyId === 'string'
        ) {
            if (typeof runtimeController?.getStrategy !== 'function') {
                return {
                    status: 503,
                    payload: {
                        code: 'strategy_snapshot_unavailable',
                        brokerWriteAttempted: false,
                    },
                };
            }
            try {
                latestSnapshot = await runtimeController.getStrategy({
                    strategyId: decision.route.strategyId,
                });
            } catch {
                latestSnapshot = undefined;
            }
            if (!latestSnapshot) {
                return {
                    status: 503,
                    payload: {
                        code: 'strategy_snapshot_unavailable',
                        brokerWriteAttempted: false,
                    },
                };
            }
        }
        return {
            status: stored.status,
            payload: {
                code: stored.code,
                resultHash: replay.resultHash,
                ...(latestSnapshot === undefined
                    ? {}
                    : { latestSnapshot }),
                brokerWriteAttempted: false,
            },
        };
    }
    return {
        status: 409,
        payload: {
            code: `operation_${replay.state}`,
            resultHash: replay.resultHash,
            brokerWriteAttempted: false,
        },
    };
}

function requestHeaders(rawHeaders) {
    if (!Array.isArray(rawHeaders) || rawHeaders.length % 2 !== 0) return null;
    const result = {};
    for (let index = 0; index < rawHeaders.length; index += 2) {
        const name = rawHeaders[index];
        const value = rawHeaders[index + 1];
        if (typeof name !== 'string' || typeof value !== 'string') return null;
        const normalized = name.toLowerCase();
        if (Object.hasOwn(result, normalized)) return null;
        result[normalized] = value;
    }
    return result;
}

async function boundedRequestBody(request, startedAtMonotonicMs) {
    const declaredLength = request.headers['content-length'];
    if (
        declaredLength !== undefined &&
        (!/^\d{1,8}$/.test(declaredLength) ||
            Number(declaredLength) >
                SMART_ORDER_CONTROL_PLANE_MAX_ENVELOPE_BYTES)
    ) {
        const error = new Error('request body is too large');
        error.code = 'BODY_TOO_LARGE';
        throw error;
    }
    if (request.headers['transfer-encoding'] !== undefined) {
        const error = new Error('streamed request bodies are not accepted');
        error.code = 'BODY_SHAPE_INVALID';
        throw error;
    }
    return readSmartOrderBodyWithDeadline(request, {
        expectedLength:
            declaredLength === undefined ? undefined : Number(declaredLength),
        maxBytes: SMART_ORDER_CONTROL_PLANE_MAX_ENVELOPE_BYTES,
        deadlineMs: DEFAULT_SMART_ORDER_BODY_DEADLINE_MS,
        startedAtMonotonicMs,
        tooLargeCode: 'BODY_TOO_LARGE',
    });
}

function safeRuntimeStatus(runtimeController, runtimeMode) {
    const status = runtimeController?.status?.();
    return Object.freeze({
        mode: runtimeMode,
        role:
            status?.role === 'primary' || status?.role === 'secondary_readonly'
                ? status.role
                : 'unknown',
        state:
            typeof status?.state === 'string' && status.state.length <= 64
                ? status.state
                : 'unknown',
        repositoryReady: status?.watchdog?.repositoryReady === true,
        dispatchAllowedByRepository: status?.dispatchAllowed === true,
        apiGenerationSha256:
            typeof status?.apiGenerationSha256 === 'string' &&
            /^sha256:[0-9a-f]{64}$/.test(status.apiGenerationSha256)
                ? status.apiGenerationSha256
                : null,
    });
}

function sha256DomainValue(domain, value) {
    return `sha256:${createHash('sha256')
        .update(`${domain}\u001f${value}`)
        .digest('hex')}`;
}

function safeUnintegratedTradingReadiness({
    apiGenerationSha256,
    nowEpochMs,
    runtimeEpochId,
}) {
    const projection = projectSmartOrderRuntimeReadinessCandidate({
        apiGenerationSha256:
            typeof apiGenerationSha256 === 'string' &&
            /^sha256:[0-9a-f]{64}$/.test(apiGenerationSha256)
                ? apiGenerationSha256
                : sha256DomainValue(
                      'smart-order-readiness-api-generation-unavailable',
                      'unavailable',
                  ),
        conjuncts: SMART_ORDER_RUNTIME_READINESS_CONJUNCT_IDS.map(
            (conjunctId) => ({
                conjunctId,
                evidenceSha256: null,
                observedAtEpochMs: null,
                state: 'missing',
                validUntilEpochMs: null,
            }),
        ),
        health: { processResponsive: true },
        nowEpochMs,
        runtimeEpochIdSha256: sha256DomainValue(
            'smart-order-readiness-runtime-epoch',
            runtimeEpochId,
        ),
    });
    return Object.freeze({
        blockers: Object.freeze([
            ...projection.blockers,
            'production_readiness_authority_unintegrated',
            'write_master_disabled',
        ]),
        ready: false,
    });
}

function safeQuoteReadiness(provider) {
    const fallback = Object.freeze({
        state: 'unverified',
        asOfExchangeTime: null,
        authoritativeForActivation: false,
    });
    if (provider === null) return fallback;
    try {
        const value = Reflect.apply(provider, undefined, []);
        if (
            !value ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            utilTypes.isProxy(value)
        ) {
            return fallback;
        }
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const keys = Reflect.ownKeys(descriptors).sort();
        if (
            keys.length !== 3 ||
            !keys.every(
                (key, index) =>
                    key ===
                    [
                        'asOfExchangeTime',
                        'authoritativeForActivation',
                        'state',
                    ][index],
            ) ||
            !keys.every(
                (key) =>
                    typeof key === 'string' &&
                    descriptors[key]?.enumerable === true &&
                    Object.hasOwn(descriptors[key], 'value') &&
                    !Object.hasOwn(descriptors[key], 'get') &&
                    !Object.hasOwn(descriptors[key], 'set'),
            )
        ) {
            return fallback;
        }
        const state = descriptors.state.value;
        const asOfExchangeTime = descriptors.asOfExchangeTime.value;
        if (
            !new Set(['fresh', 'stale', 'unverified']).has(state) ||
            descriptors.authoritativeForActivation.value !== false ||
            (state === 'unverified'
                ? asOfExchangeTime !== null
                : typeof asOfExchangeTime !== 'string' ||
                  new Date(asOfExchangeTime).toISOString() !==
                      asOfExchangeTime)
        ) {
            return fallback;
        }
        return Object.freeze({
            state,
            asOfExchangeTime,
            authoritativeForActivation: false,
        });
    } catch {
        return fallback;
    }
}

function unavailableLifecycleProjection() {
    return Object.freeze({
        schemaVersion: 'smart-order-lifecycle-audit/unavailable',
        state: 'unverified',
        writeMaster: 'disabled',
        reconciliation: 'required_before_any_write_or_drain',
        activeObligationCount: null,
        blockerCount: null,
        productionReadonlyBlockerCount: null,
        gracefulStopBlockerCount: null,
        uninstallBlockerCount: null,
        productionReadonlyDrainAllowed: false,
        gracefulStopAllowed: false,
        uninstallAllowed: false,
        drainItems: Object.freeze([]),
        drainRecords: Object.freeze([]),
        drainRecordsTruncated: true,
        runtimeTrackedUnprotectedRemainder: Object.freeze({
            state: 'unknown',
            shares: null,
            conservativeMaximumShares: null,
            currentAccountReconciliationRequired: true,
        }),
        accountIdentifiersExposed: false,
        entityIdentifiersExposed: false,
        strategyDefinitionsExposed: false,
    });
}

const SMART_ORDER_LIFECYCLE_AUDIT_SCHEMA_VERSION =
    'smart-order-lifecycle-audit/2026-08-12.4';
const LIFECYCLE_DRAIN_RECORD_POLICY = Object.freeze({
    account_reconciliation: Object.freeze({
        states: Object.freeze(['missing_or_stale']),
        disposition: 'complete_current_account_reconciliation',
        quantityStates: Object.freeze(['not_applicable']),
    }),
    strategy: Object.freeze({
        states: Object.freeze([
            'draft',
            'observing',
            'monitoring',
            'paused',
            'recovery',
            'manual_intervention',
            'cancel_pending',
            'expired_with_obligation',
        ]),
        disposition: 'pause_or_cancel_strategy',
        quantityStates: Object.freeze(['not_applicable']),
    }),
    activation: Object.freeze({
        states: Object.freeze([
            'candidate',
            'triggered',
            'prepared',
            'dispatching',
            'working',
            'part_filled',
            'unknown',
        ]),
        disposition: 'cancel_strategy_or_complete_activation',
        quantityStates: Object.freeze(['not_applicable']),
    }),
    prepared_intent: Object.freeze({
        states: Object.freeze(['prepared']),
        disposition: 'cancel_proven_unsent_intent_and_release',
        quantityStates: Object.freeze(['not_applicable']),
    }),
    side_effect_intent: Object.freeze({
        states: Object.freeze([
            'prepared_authority_granted',
            'dispatching',
            'acknowledged',
            'reconciling',
            'unknown',
        ]),
        disposition: 'reconcile_intent_before_stop',
        quantityStates: Object.freeze(['not_applicable']),
    }),
    broker_order: Object.freeze({
        states: Object.freeze([
            'pending_submit',
            'pre_submitted',
            'submitted',
            'part_filled',
            'unknown',
        ]),
        disposition: 'cancel_working_order_or_reconcile',
        quantityStates: Object.freeze(['conservative_maximum']),
    }),
    protection_commitment: Object.freeze({
        states: Object.freeze(['pending_entry_fill', 'unknown']),
        disposition: 'prove_zero_fill_or_release_pre_dispatch',
        quantityStates: Object.freeze(['conservative_maximum']),
    }),
    protection_obligation: Object.freeze({
        states: Object.freeze(['pending_entry_fill', 'monitoring', 'unknown']),
        disposition: 'prove_zero_fill_confirmed_exit_or_break_glass',
        quantityStates: Object.freeze(['exact', 'conservative_maximum']),
    }),
    entry_exposure_reservation: Object.freeze({
        states: Object.freeze(['reserved', 'dispatching', 'working', 'unknown']),
        disposition: 'release_proven_unsent_or_reconcile',
        quantityStates: Object.freeze(['exact']),
    }),
    exit_claim: Object.freeze({
        states: Object.freeze([
            'monitoring_reserved',
            'intent_reserved',
            'broker_working',
            'unknown',
        ]),
        disposition: 'reconcile_or_release_claim',
        quantityStates: Object.freeze(['exact']),
    }),
    manual_resolution: Object.freeze({
        states: Object.freeze(['open']),
        disposition: 'complete_reason_specific_resolution',
        quantityStates: Object.freeze(['not_applicable']),
    }),
    safety_blocker: Object.freeze({
        states: Object.freeze(['open']),
        disposition: 'resolve_or_supersede_blocker',
        quantityStates: Object.freeze(['not_applicable']),
    }),
});

function validLifecycleDrainRecord(record, index) {
    if (
        !record ||
        typeof record !== 'object' ||
        Array.isArray(record) ||
        JSON.stringify(Object.keys(record).sort()) !==
            JSON.stringify([
                'disposition',
                'kind',
                'ordinal',
                'quantityShares',
                'quantityState',
                'state',
            ]) ||
        record.ordinal !== index + 1 ||
        typeof record.kind !== 'string' ||
        !Object.hasOwn(LIFECYCLE_DRAIN_RECORD_POLICY, record.kind)
    ) {
        return false;
    }
    const policy = LIFECYCLE_DRAIN_RECORD_POLICY[record.kind];
    return (
        policy.states.includes(record.state) &&
        policy.quantityStates.includes(record.quantityState) &&
        record.disposition === policy.disposition &&
        (record.quantityState === 'not_applicable'
            ? record.quantityShares === null
            : Number.isSafeInteger(record.quantityShares) &&
              record.quantityShares >= 0)
    );
}

function safeLifecycleProjection(audit) {
    const unavailable = unavailableLifecycleProjection();
    const counts = audit?.counts;
    const remainder = audit?.runtimeTrackedUnprotectedRemainder;
    const drainRecords = Array.isArray(audit?.drainRecords)
        ? audit.drainRecords
        : null;
    const count = (key) => {
        const value = counts?.[key];
        return Number.isSafeInteger(value) && value >= 0 ? value : null;
    };
    const drainItemDefinitions = [
        ['account_reconciliation', 'reconciliation_blockers', 'complete_current_account_reconciliation'],
        ['strategy', 'non_terminal_strategies', 'pause_or_cancel_strategy'],
        ['activation', 'non_terminal_activations', 'cancel_strategy_or_complete_activation'],
        ['prepared_intent', 'proven_unsent_prepared_intents', 'cancel_proven_unsent_intent_and_release'],
        ['side_effect_intent', 'side_effect_intents', 'reconcile_intent_before_stop'],
        ['broker_order', 'non_terminal_broker_orders', 'cancel_working_order_or_reconcile'],
        ['protection_commitment', 'non_terminal_commitments', 'prove_zero_fill_or_release_pre_dispatch'],
        ['protection_obligation', 'active_protection_obligations', 'prove_zero_fill_confirmed_exit_or_break_glass'],
        ['entry_exposure_reservation', 'active_entry_reservations', 'release_proven_unsent_or_reconcile'],
        ['exit_claim', 'active_exit_claims', 'reconcile_or_release_claim'],
        ['manual_resolution', 'open_resolution_cases', 'complete_reason_specific_resolution'],
        ['safety_blocker', 'open_safety_blockers', 'resolve_or_supersede_blocker'],
    ];
    const drainItems = drainItemDefinitions.map(([kind, key, disposition]) => ({
        kind,
        count: count(key),
        disposition,
    }));
    const drainItemCount = drainItems.reduce(
        (total, item) => total + (item.count ?? 0),
        0,
    );
    const activeObligationCount = count('active_protection_obligations');
    const blockerCount = Number.isSafeInteger(audit?.blockerCount)
        ? audit.blockerCount
        : null;
    const productionReadonlyBlockerCount = Number.isSafeInteger(
        audit?.productionReadonlyBlockerCount,
    )
        ? audit.productionReadonlyBlockerCount
        : null;
    const gracefulStopBlockerCount = Number.isSafeInteger(
        audit?.gracefulStopBlockerCount,
    )
        ? audit.gracefulStopBlockerCount
        : null;
    const uninstallBlockerCount = Number.isSafeInteger(
        audit?.uninstallBlockerCount,
    )
        ? audit.uninstallBlockerCount
        : null;
    if (
        audit?.schemaVersion !== SMART_ORDER_LIFECYCLE_AUDIT_SCHEMA_VERSION ||
        activeObligationCount === null ||
        drainItems.some((item) => item.count === null) ||
        !Number.isSafeInteger(drainItemCount) ||
        !drainRecords ||
        drainRecords.length > 100 ||
        drainRecords.some((record, index) =>
            !validLifecycleDrainRecord(record, index),
        ) ||
        typeof audit.drainRecordsTruncated !== 'boolean' ||
        (!audit.drainRecordsTruncated &&
            drainRecords.length !== gracefulStopBlockerCount) ||
        blockerCount === null ||
        blockerCount < 0 ||
        productionReadonlyBlockerCount === null ||
        productionReadonlyBlockerCount < 0 ||
        gracefulStopBlockerCount === null ||
        gracefulStopBlockerCount < 0 ||
        drainItemCount !== gracefulStopBlockerCount ||
        uninstallBlockerCount === null ||
        uninstallBlockerCount < 0 ||
        !remainder ||
        !['known', 'unknown'].includes(remainder.state) ||
        (remainder.state === 'known' &&
            (!Number.isSafeInteger(remainder.shares) ||
                remainder.shares < 0)) ||
        (remainder.state === 'unknown' && remainder.shares !== null) ||
        !Number.isSafeInteger(remainder.conservativeMaximumShares) ||
        remainder.conservativeMaximumShares < 0 ||
        audit.accountIdentifiersExposed !== false ||
        audit.entityIdentifiersExposed !== false ||
        audit.strategyDefinitionsExposed !== false
    ) {
        return unavailable;
    }
    return Object.freeze({
        schemaVersion:
            audit.schemaVersion === SMART_ORDER_LIFECYCLE_AUDIT_SCHEMA_VERSION
                ? audit.schemaVersion
                : unavailable.schemaVersion,
        state: 'verified_repository_projection',
        writeMaster: 'disabled',
        reconciliation:
            typeof audit.reconciliation === 'string' &&
            audit.reconciliation.length <= 80
                ? audit.reconciliation
                : unavailable.reconciliation,
        activeObligationCount,
        blockerCount,
        productionReadonlyBlockerCount,
        gracefulStopBlockerCount,
        uninstallBlockerCount,
        productionReadonlyDrainAllowed:
            audit.productionReadonlyDrainAllowed === true,
        gracefulStopAllowed: audit.gracefulStopAllowed === true,
        uninstallAllowed: audit.uninstallAllowed === true,
        drainItems: Object.freeze(
            drainItems.map((item) => Object.freeze(item)),
        ),
        drainRecords: Object.freeze(
            drainRecords.map((record) =>
                Object.freeze({
                    ordinal: record.ordinal,
                    kind: record.kind,
                    state: record.state,
                    quantityShares: record.quantityShares,
                    quantityState: record.quantityState,
                    disposition: record.disposition,
                }),
            ),
        ),
        drainRecordsTruncated: audit.drainRecordsTruncated,
        runtimeTrackedUnprotectedRemainder: Object.freeze({
            state: remainder.state,
            shares: remainder.shares,
            conservativeMaximumShares:
                remainder.conservativeMaximumShares,
            currentAccountReconciliationRequired:
                remainder.currentAccountReconciliationRequired === true,
        }),
        accountIdentifiersExposed: false,
        entityIdentifiersExposed: false,
        strategyDefinitionsExposed: false,
    });
}

async function safeLifecycleAudit(runtimeController) {
    const unavailable = unavailableLifecycleProjection();
    if (typeof runtimeController?.lifecycleAudit !== 'function') {
        return unavailable;
    }
    try {
        return safeLifecycleProjection(
            await runtimeController.lifecycleAudit(),
        );
    } catch {
        return unavailable;
    }
}

function boundedHistoryToken(value, label, maximumLength = 240) {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > maximumLength ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        throw new TypeError(`${label} is invalid`);
    }
    return value;
}

function historyEpoch(value, label, { nullable = false } = {}) {
    if (nullable && value === null) return null;
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} is invalid`);
    }
    return value;
}

function safeHistoryProjection(value) {
    if (!Array.isArray(value) || value.length > SMART_ORDER_HISTORY_MAX_ITEMS) {
        throw new TypeError('history projection is invalid');
    }
    return Object.freeze(
        value.map((candidate) => {
            const reasonStates = SMART_ORDER_HISTORY_REASON_STATES.get(
                candidate?.reasonCode,
            );
            if (
                !candidate ||
                typeof candidate !== 'object' ||
                Array.isArray(candidate) ||
                !SMART_ORDER_HISTORY_TYPES.has(candidate.type) ||
                !SMART_ORDER_HISTORY_STRATEGY_KINDS.has(
                    candidate.strategyKind,
                ) ||
                !SMART_ORDER_HISTORY_TERMINAL_STATES.has(candidate.state) ||
                !reasonStates?.has(candidate.state) ||
                candidate.receiveEpochMs !== candidate.updatedAtEpochMs
            ) {
                throw new TypeError('history item is invalid');
            }
            const projection = Object.freeze({
                type: candidate.type,
                strategyId: boundedHistoryToken(
                    candidate.strategyId,
                    'history.strategyId',
                ),
                strategyKind: candidate.strategyKind,
                state: candidate.state,
                maskedAccountLabel: boundedHistoryToken(
                    candidate.maskedAccountLabel,
                    'history.maskedAccountLabel',
                    80,
                ),
                reasonCode: boundedHistoryToken(
                    candidate.reasonCode,
                    'history.reasonCode',
                    160,
                ),
                revision: historyEpoch(candidate.revision, 'history.revision'),
                createdAtEpochMs: historyEpoch(
                    candidate.createdAtEpochMs,
                    'history.createdAtEpochMs',
                ),
                updatedAtEpochMs: historyEpoch(
                    candidate.updatedAtEpochMs,
                    'history.updatedAtEpochMs',
                ),
                terminalAtEpochMs: historyEpoch(
                    candidate.terminalAtEpochMs,
                    'history.terminalAtEpochMs',
                ),
                exchangeEpochMs: historyEpoch(
                    candidate.exchangeEpochMs,
                    'history.exchangeEpochMs',
                    { nullable: true },
                ),
                brokerEpochMs: historyEpoch(
                    candidate.brokerEpochMs,
                    'history.brokerEpochMs',
                    { nullable: true },
                ),
                receiveEpochMs: historyEpoch(
                    candidate.receiveEpochMs,
                    'history.receiveEpochMs',
                ),
            });
            if (
                !projection.maskedAccountLabel.startsWith('固定帳號') ||
                projection.createdAtEpochMs > projection.updatedAtEpochMs ||
                projection.terminalAtEpochMs > projection.updatedAtEpochMs ||
                (projection.exchangeEpochMs !== null &&
                    projection.exchangeEpochMs > projection.receiveEpochMs) ||
                (projection.brokerEpochMs !== null &&
                    projection.brokerEpochMs > projection.receiveEpochMs) ||
                (projection.exchangeEpochMs !== null &&
                    projection.brokerEpochMs !== null &&
                    projection.exchangeEpochMs > projection.brokerEpochMs)
            ) {
                throw new TypeError('history timestamps are invalid');
            }
            return projection;
        }),
    );
}

function safeEventProjection(value, expectedAfterSequence) {
    if (
        !exactKeys(value, [
            'accountIdentifiersExposed',
            'cursorStatus',
            'entityIdentifiersExposed',
            'events',
            'fromSequence',
            'highWaterSequence',
            'journalPayloadExposed',
            'nextSequence',
            'schemaVersion',
        ]) ||
        value.schemaVersion !== SMART_ORDER_EVENT_SCHEMA_VERSION ||
        !['initialized', 'current', 'gap'].includes(value.cursorStatus) ||
        value.fromSequence !== expectedAfterSequence ||
        !Number.isSafeInteger(value.nextSequence) ||
        value.nextSequence < 0 ||
        !Number.isSafeInteger(value.highWaterSequence) ||
        value.highWaterSequence < value.nextSequence ||
        value.accountIdentifiersExposed !== false ||
        value.entityIdentifiersExposed !== false ||
        value.journalPayloadExposed !== false ||
        !Array.isArray(value.events) ||
        value.events.length > SMART_ORDER_EVENT_MAX_ITEMS ||
        (value.cursorStatus === 'initialized' &&
            (expectedAfterSequence !== null || value.events.length !== 0)) ||
        (value.cursorStatus === 'gap' && value.events.length !== 0) ||
        (value.cursorStatus === 'current' && expectedAfterSequence === null)
    ) {
        throw new TypeError('event projection is invalid');
    }
    let previous = expectedAfterSequence;
    const events = value.events.map((candidate) => {
        if (
            !exactKeys(candidate, [
                'brokerEpochMs',
                'entityKind',
                'exchangeEpochMs',
                'reasonCode',
                'receiveEpochMs',
                'revision',
                'sequence',
                'summaryCode',
            ]) ||
            !Number.isSafeInteger(candidate.sequence) ||
            candidate.sequence < 1 ||
            (previous !== null && candidate.sequence !== previous + 1) ||
            !SMART_ORDER_JOURNAL_ENTITY_KINDS.includes(candidate.entityKind) ||
            !Number.isSafeInteger(candidate.revision) ||
            candidate.revision < 0 ||
            !Number.isSafeInteger(candidate.receiveEpochMs) ||
            candidate.receiveEpochMs < 0 ||
            (candidate.exchangeEpochMs !== null &&
                (!Number.isSafeInteger(candidate.exchangeEpochMs) ||
                    candidate.exchangeEpochMs < 0 ||
                    candidate.exchangeEpochMs > candidate.receiveEpochMs)) ||
            (candidate.brokerEpochMs !== null &&
                (!Number.isSafeInteger(candidate.brokerEpochMs) ||
                    candidate.brokerEpochMs < 0 ||
                    candidate.brokerEpochMs > candidate.receiveEpochMs)) ||
            (candidate.exchangeEpochMs !== null &&
                candidate.brokerEpochMs !== null &&
                candidate.exchangeEpochMs > candidate.brokerEpochMs)
        ) {
            throw new TypeError('event projection item is invalid');
        }
        const projected = Object.freeze({
            sequence: candidate.sequence,
            entityKind: boundedHistoryToken(
                candidate.entityKind,
                'events.entityKind',
                64,
            ),
            reasonCode: boundedHistoryToken(
                candidate.reasonCode,
                'events.reasonCode',
                160,
            ),
            revision: candidate.revision,
            summaryCode: boundedHistoryToken(
                candidate.summaryCode,
                'events.summaryCode',
                160,
            ),
            exchangeEpochMs: candidate.exchangeEpochMs,
            brokerEpochMs: candidate.brokerEpochMs,
            receiveEpochMs: candidate.receiveEpochMs,
        });
        previous = projected.sequence;
        return projected;
    });
    if (
        value.cursorStatus === 'current' &&
        value.nextSequence !== (events.at(-1)?.sequence ?? expectedAfterSequence)
    ) {
        throw new TypeError('event projection cursor is invalid');
    }
    return Object.freeze({
        schemaVersion: SMART_ORDER_EVENT_SCHEMA_VERSION,
        cursorStatus: value.cursorStatus,
        fromSequence: value.fromSequence,
        nextSequence: value.nextSequence,
        highWaterSequence: value.highWaterSequence,
        events: Object.freeze(events),
        accountIdentifiersExposed: false,
        entityIdentifiersExposed: false,
        journalPayloadExposed: false,
    });
}

function authorizationStatus(reason) {
    if (reason === 'route_or_method_not_allowed') return 404;
    if (reason === 'invalid_request_shape') return 400;
    return 403;
}

async function safeGateStatuses(
    runtimeController,
    nowEpochMs,
    brokerWriteProvenanceStatus,
) {
    const routeCoverage = projectSmartOrderManualRouteCoverageStatus();
    const statuses = {};
    for (const provenance of [
        'automation',
        'manual_user_confirmed',
        'gate_probe',
    ]) {
        try {
            const status = await runtimeController?.gateManifestStatus?.({
                provenance,
                nowEpochMs,
            });
            const automationRouteCoverageBlocked =
                provenance === 'automation' &&
                (routeCoverage.automationAccountEligibility !== 'enabled' ||
                    brokerWriteProvenanceStatus
                        ?.automationAccountEligibility !== 'enabled' ||
                    brokerWriteProvenanceStatus?.brokerWriteAuthority !==
                        false ||
                    brokerWriteProvenanceStatus?.writeMasterAuthority !==
                        false);
            statuses[provenance] = Object.freeze({
                present: status?.present === true,
                state:
                    status?.state === 'eligible' &&
                    !automationRouteCoverageBlocked
                        ? 'eligible'
                        : 'observe_only',
                blocker:
                    automationRouteCoverageBlocked
                        ? 'automation_account_gate_disabled'
                        : typeof status?.blocker === 'string' &&
                    status.blocker.length <= 160
                        ? status.blocker
                        : status?.state === 'eligible'
                          ? 'current_verifier_revalidation_required'
                          : 'gate_manifest_missing_or_invalid',
                validUntilEpochMs: Number.isSafeInteger(
                    status?.validUntilEpochMs,
                )
                    ? status.validUntilEpochMs
                    : undefined,
                featureGates:
                    !automationRouteCoverageBlocked &&
                    status?.featureGates &&
                    typeof status.featureGates === 'object' &&
                    !Array.isArray(status.featureGates)
                        ? Object.freeze(
                              Object.fromEntries(
                                  [
                                      'good_till',
                                      'multi_condition',
                                      'parent_child',
                                      'quick',
                                      'scheduled_quantity',
                                      'stop_take',
                                      'trailing_exit',
                                  ].map((feature) => [
                                      feature,
                                      status.featureGates[feature] === true,
                                  ]),
                              ),
                          )
                        : Object.freeze({
                              good_till: false,
                              multi_condition: false,
                              parent_child: false,
                              quick: false,
                              scheduled_quantity: false,
                              stop_take: false,
                              trailing_exit: false,
                          }),
                authoritativeForDispatch: false,
            });
        } catch {
            statuses[provenance] = Object.freeze({
                present: false,
                state: 'observe_only',
                blocker: 'gate_manifest_status_unavailable',
                featureGates: Object.freeze({
                    good_till: false,
                    multi_condition: false,
                    parent_child: false,
                    quick: false,
                    scheduled_quantity: false,
                    stop_take: false,
                    trailing_exit: false,
                }),
                authoritativeForDispatch: false,
            });
        }
    }
    return Object.freeze(statuses);
}

export async function startSmartOrderControlPlaneServer({
    capability,
    gateProbeCliCapability,
    gateProbeControlPlaneAuthority = null,
    strategyConfirmationControlPlaneAuthority = null,
    strategyConfirmationEvidenceProvider = null,
    quoteReadinessProvider = null,
    runtimeEpochId,
    runtimeController,
    onLifecycleStopPrecommit,
    onLifecycleStopAborted,
    onLifecycleStopCommitted,
    runtimeMode = 'simulation',
    expectedOrigin = 'http://127.0.0.1:5173',
    port = 0,
    now = () => Date.now(),
}) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new TypeError('control-plane port is invalid');
    }
    if (
        strategyConfirmationEvidenceProvider !== null &&
        typeof strategyConfirmationEvidenceProvider !== 'function'
    ) {
        throw new TypeError(
            'strategy confirmation evidence provider must be a function',
        );
    }
    if (
        quoteReadinessProvider !== null &&
        (typeof quoteReadinessProvider !== 'function' ||
            utilTypes.isProxy(quoteReadinessProvider))
    ) {
        throw new TypeError('quote readiness provider must be a function');
    }
    if (
        typeof runtimeEpochId !== 'string' ||
        !RUNTIME_EPOCH_PATTERN.test(runtimeEpochId)
    ) {
        throw new TypeError('control-plane runtimeEpochId is invalid');
    }
    const brokerWriteProvenanceBoundary =
        createSmartOrderBrokerWriteProvenanceBoundary({ now });
    const brokerWriteProvenanceStatus =
        brokerWriteProvenanceBoundary.status();
    if (runtimeMode !== 'simulation') {
        throw new TypeError('smart-order control plane is simulation-only');
    }
    let actualPort;
    let closed = false;
    let activeRequests = 0;
    const mutationAdmission = createSmartOrderMutationAdmissionController({
        now,
        globalRateLimit: SIDECAR_MUTATION_GLOBAL_RATE_LIMIT,
        sessionRateLimit: SIDECAR_MUTATION_GLOBAL_RATE_LIMIT,
        maxConcurrent: SIDECAR_MUTATION_MAX_CONCURRENT,
        maxConcurrentPerSession: SIDECAR_MUTATION_MAX_CONCURRENT,
        maxQueued: SIDECAR_MUTATION_MAX_QUEUED,
        maxQueuedPerSession: SIDECAR_MUTATION_MAX_QUEUED,
        maxSessionBuckets: 1,
        queueWaitMs: 750,
    });
    const serverCapability = Uint8Array.from(capability ?? []);
    if (serverCapability.byteLength !== 32) {
        serverCapability.fill(0);
        throw new TypeError('control-plane capability must be exactly 32 bytes');
    }
    const serverGateProbeCliCapability = Uint8Array.from(
        gateProbeCliCapability ?? [],
    );
    if (serverGateProbeCliCapability.byteLength !== 32) {
        serverCapability.fill(0);
        serverGateProbeCliCapability.fill(0);
        throw new TypeError(
            'gate probe CLI capability must be exactly 32 bytes',
        );
    }
    const server = http.createServer(
        { joinDuplicateHeaders: false, requireHostHeader: true },
        async (request, response) => {
            const requestStartedAtMonotonicMs = performance.now();
            let requestSlotHeld = false;
            let mutationAdmissionLease;
            try {
                if (activeRequests >= MAX_ACTIVE_REQUESTS) {
                    jsonResponse(response, 429, {
                        code: 'request_backpressure',
                        brokerWriteAttempted: false,
                    });
                    return;
                }
                activeRequests += 1;
                requestSlotHeld = true;
                if (
                    closed ||
                    request.socket.remoteAddress !== LOOPBACK_HOST ||
                    typeof request.url !== 'string' ||
                    Buffer.byteLength(request.url) > MAX_REQUEST_URL_BYTES
                ) {
                    jsonResponse(response, 403, { code: 'request_forbidden' });
                    return;
                }
                const rawHeaders = requestHeaders(request.rawHeaders);
                if (!rawHeaders) {
                    jsonResponse(response, 400, { code: 'invalid_headers' });
                    return;
                }
                const parsed = new URL(request.url, `http://${LOOPBACK_HOST}`);
                if (parsed.search || parsed.hash) {
                    jsonResponse(response, 400, { code: 'query_not_allowed' });
                    return;
                }
                let body = await boundedRequestBody(
                    request,
                    requestStartedAtMonotonicMs,
                );
                let decision = authorizeSmartOrderControlPlaneRequest({
                    capability: serverCapability,
                    method: request.method,
                    pathname: parsed.pathname,
                    headers: rawHeaders,
                    bodyBytes: body,
                    expectedPort: actualPort,
                    expectedOrigin,
                    expectedRuntimeEpochId: runtimeEpochId,
                    nowEpochMs: now(),
                });
                if (!decision.allowed) {
                    jsonResponse(response, authorizationStatus(decision.reason), {
                        code: decision.reason,
                    });
                    return;
                }
                responseAuthentication.set(response, {
                    capability: serverCapability,
                    runtimeEpochId,
                    sidecarAuthority: decision.sidecarAuthority,
                    requestId: decision.requestId,
                    method: decision.method,
                    pathname: decision.pathname,
                    requestBodySha256: decision.bodySha256,
                });
                if (decision.route.access === 'authenticated_mutation') {
                    mutationAdmissionLease =
                        await mutationAdmission.acquire('gateway');
                    if (!mutationAdmissionLease.allowed) {
                        body.fill(0);
                        jsonResponse(response, 429, {
                            code: mutationAdmissionLease.reason,
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    let plaintext;
                    try {
                        plaintext = openSmartOrderControlPlaneMutation({
                            capability: serverCapability,
                            runtimeEpochId,
                            sidecarAuthority: decision.sidecarAuthority,
                            requestId: decision.requestId,
                            method: decision.method,
                            pathname: decision.pathname,
                            origin: expectedOrigin,
                            nonce: decision.envelopeNonce,
                            bodyBytes: body,
                        });
                    } catch {
                        body.fill(0);
                        jsonResponse(response, 400, {
                            code: 'mutation_envelope_invalid',
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    body.fill(0);
                    body = plaintext;
                    decision = Object.freeze({
                        ...decision,
                        bodySha256: createHash('sha256')
                            .update(body)
                            .digest('hex'),
                    });
                }
                if (
                    decision.route.routeId ===
                    'manual_broker_write_admission'
                ) {
                    const parsed = parseJsonObject(body);
                    const brokerRoute = STOCK_WRITE_ROUTE_BY_ID.get(
                        decision.route.brokerRouteId,
                    );
                    let canonical;
                    try {
                        if (
                            !parsed ||
                            Object.keys(parsed).sort().join('\u001f') !==
                                'operationId\u001frequest' ||
                            !operationId(parsed.operationId) ||
                            !brokerRoute ||
                            !['manual', 'automation'].includes(
                                brokerRoute.family,
                            )
                        ) {
                            throw new TypeError(
                                'manual broker write envelope is invalid',
                            );
                        }
                        canonical = canonicalManualStockBrokerWriteRequest(
                            parsed.request,
                        );
                        if (
                            (brokerRoute.operation === 'update'
                                ? !['update_price', 'update_quantity'].includes(
                                      canonical.request.operation,
                                  )
                                : brokerRoute.operation !==
                                  canonical.request.operation)
                        ) {
                            throw new TypeError(
                                'manual broker write route is confused',
                            );
                        }
                    } catch {
                        body.fill(0);
                        jsonResponse(response, 422, {
                            code: 'manual_broker_write_request_invalid',
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    const routeEvidence =
                        brokerWriteProvenanceBoundary.registerServerRoute({
                            family: brokerRoute.family,
                            operation: brokerRoute.operation,
                            routeId: brokerRoute.routeId,
                        });
                    const callerEvidence =
                        brokerWriteProvenanceBoundary.registerCaller({
                            callerClass:
                                brokerRoute.family === 'manual'
                                    ? 'interactive_ui'
                                    : 'runtime_scheduler',
                        });
                    const manualConfirmationEvidence =
                        brokerRoute.family === 'manual'
                            ? brokerWriteProvenanceBoundary.issueManualConfirmation(
                                  {
                                      callerEvidence,
                                      canonicalPayloadSha256:
                                          canonical.requestSha256,
                                      confirmationId: parsed.operationId,
                                      confirmationRevision: 0,
                                      routeEvidence,
                                      validForMs: 30_000,
                                  },
                              )
                            : null;
                    const provenanceDecision =
                        brokerWriteProvenanceBoundary.classify({
                            automationBinding: null,
                            callerEvidence,
                            canonicalPayloadSha256: canonical.requestSha256,
                            manualConfirmationEvidence,
                            probeNonceEvidence: null,
                            routeEvidence,
                        });
                    body.fill(0);
                    jsonResponse(response, 423, {
                        schemaVersion:
                            'smart-order-manual-broker-write-admission/2026-08-14.1',
                        code: 'broker_write_gate_closed',
                        classified: provenanceDecision.classified,
                        provenance: provenanceDecision.provenance,
                        reason: provenanceDecision.reason,
                        decisionSha256:
                            provenanceDecision.decisionSha256 ?? null,
                        automationAccountEligibility: 'disabled',
                        brokerWriteAttempted: false,
                        brokerWriteAuthority: false,
                        writeMasterAuthority: false,
                    });
                    return;
                }
                if (decision.route.routeId === 'health') {
                    jsonResponse(response, 200, {
                        schemaVersion:
                            SMART_ORDER_CONTROL_PLANE_SERVER_SCHEMA_VERSION,
                        status: 'ok',
                        writeEnabled: false,
                    });
                    return;
                }
                if (decision.route.routeId === 'status') {
                    const lifecycle = await safeLifecycleAudit(
                        runtimeController,
                    );
                    jsonResponse(response, 200, {
                        schemaVersion:
                            SMART_ORDER_CONTROL_PLANE_SERVER_SCHEMA_VERSION,
                        runtime: safeRuntimeStatus(runtimeController, runtimeMode),
                        lifecycle,
                        controlPlane: 'loopback_authenticated',
                        secretValuesExposed: false,
                    });
                    return;
                }
                if (decision.route.routeId === 'readiness') {
                    const runtime = safeRuntimeStatus(
                        runtimeController,
                        runtimeMode,
                    );
                    const observedAtEpochMs = now();
                    const tradingReadiness =
                        safeUnintegratedTradingReadiness({
                            apiGenerationSha256:
                                runtime.apiGenerationSha256,
                            nowEpochMs: observedAtEpochMs,
                            runtimeEpochId,
                        });
                    const gates = await safeGateStatuses(
                        runtimeController,
                        observedAtEpochMs,
                        brokerWriteProvenanceStatus,
                    );
                    const lifecycle = await safeLifecycleAudit(
                        runtimeController,
                    );
                    jsonResponse(response, 200, {
                        ready: tradingReadiness.ready,
                        writeMaster: 'disabled',
                        runtime,
                        lifecycle,
                        quote: safeQuoteReadiness(quoteReadinessProvider),
                        gates,
                        blockers: tradingReadiness.blockers,
                    });
                    return;
                }
                if (decision.route.routeId === 'gate_status') {
                    const gates = await safeGateStatuses(
                        runtimeController,
                        now(),
                        brokerWriteProvenanceStatus,
                    );
                    jsonResponse(response, 200, {
                        state: 'observe_only',
                        writeMaster: 'disabled',
                        gates,
                        blockers: [
                            'current_gate_evidence_revalidation_required',
                        ],
                    });
                    return;
                }
                if (decision.route.routeId === 'gate_probe_status') {
                    if (
                        typeof runtimeController?.gateProbeSafetyStatus !==
                        'function'
                    ) {
                        jsonResponse(response, 503, {
                            code: 'gate_probe_status_not_wired',
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    try {
                        const result =
                            await runtimeController.gateProbeSafetyStatus();
                        jsonResponse(response, 200, {
                            result,
                            brokerWriteAttempted: false,
                            brokerAuthority: false,
                            writeMasterAuthority: false,
                        });
                    } catch {
                        jsonResponse(response, 503, {
                            code: 'gate_probe_status_failed_closed',
                            brokerWriteAttempted: false,
                        });
                    }
                    return;
                }
                if (decision.route.routeId === 'risk_policy_get') {
                    if (typeof runtimeController?.riskPolicy !== 'function') {
                        jsonResponse(response, 501, {
                            code: 'risk_policy_read_service_not_wired',
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    try {
                        jsonResponse(
                            response,
                            200,
                            await runtimeController.riskPolicy(),
                        );
                    } catch {
                        jsonResponse(response, 503, {
                            code: 'risk_policy_read_service_unavailable',
                            brokerWriteAttempted: false,
                        });
                    }
                    return;
                }
                if (decision.route.routeId === 'risk_kill_switch_get') {
                    if (
                        typeof runtimeController?.killSwitchStatus !==
                        'function'
                    ) {
                        jsonResponse(response, 501, {
                            code: 'kill_switch_read_service_not_wired',
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    try {
                        jsonResponse(
                            response,
                            200,
                            await runtimeController.killSwitchStatus(),
                        );
                    } catch {
                        jsonResponse(response, 503, {
                            code: 'kill_switch_read_service_unavailable',
                            brokerWriteAttempted: false,
                        });
                    }
                    return;
                }
                if (decision.route.routeId === 'history') {
                    if (typeof runtimeController?.listHistory !== 'function') {
                        jsonResponse(response, 501, {
                            code: 'history_read_service_not_wired',
                        });
                        return;
                    }
                    let history;
                    try {
                        history = safeHistoryProjection(
                            await runtimeController.listHistory({
                                limit: SMART_ORDER_HISTORY_MAX_ITEMS,
                            }),
                        );
                    } catch {
                        jsonResponse(response, 503, {
                            code: 'history_read_service_unavailable',
                        });
                        return;
                    }
                    jsonResponse(response, 200, {
                        schemaVersion: SMART_ORDER_HISTORY_SCHEMA_VERSION,
                        history,
                        source: 'runtime_repository',
                        accountIdentifiersExposed: false,
                        journalPayloadExposed: false,
                    });
                    return;
                }
                if (decision.route.routeId === 'events') {
                    if (typeof runtimeController?.listEvents !== 'function') {
                        jsonResponse(response, 501, {
                            code: 'event_read_service_not_wired',
                        });
                        return;
                    }
                    let projection;
                    try {
                        projection = safeEventProjection(
                            await runtimeController.listEvents({
                                afterSequence: decision.route.afterSequence,
                                limit: SMART_ORDER_EVENT_MAX_ITEMS,
                            }),
                            decision.route.afterSequence,
                        );
                    } catch {
                        jsonResponse(response, 503, {
                            code: 'event_read_service_unavailable',
                        });
                        return;
                    }
                    jsonResponse(response, 200, projection);
                    return;
                }
                if (decision.route.routeId === 'strategy_list') {
                    if (typeof runtimeController?.listStrategies !== 'function') {
                        jsonResponse(response, 501, {
                            code: 'read_service_not_wired',
                        });
                        return;
                    }
                    const strategies = await runtimeController.listStrategies({
                        limit: 100,
                    });
                    jsonResponse(response, 200, {
                        strategies,
                        source: 'runtime_snapshot',
                        accountIdentifiersExposed: false,
                    });
                    return;
                }
                if (decision.route.routeId === 'strategy_get') {
                    if (typeof runtimeController?.getStrategy !== 'function') {
                        jsonResponse(response, 501, {
                            code: 'read_service_not_wired',
                        });
                        return;
                    }
                    const strategy = await runtimeController.getStrategy({
                        strategyId: decision.route.strategyId,
                    });
                    if (!strategy) {
                        jsonResponse(response, 404, {
                            code: 'strategy_not_found',
                        });
                        return;
                    }
                    jsonResponse(response, 200, {
                        strategy,
                        source: 'runtime_snapshot',
                        accountIdentifiersExposed: false,
                    });
                    return;
                }
                if (
                    decision.route.routeId ===
                    'strategy_manual_resolution_list'
                ) {
                    if (
                        typeof runtimeController?.listManualResolutionCases !==
                        'function'
                    ) {
                        jsonResponse(response, 501, {
                            code: 'manual_resolution_read_service_not_wired',
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    const projection =
                        await runtimeController.listManualResolutionCases({
                            strategyId: decision.route.strategyId,
                        });
                    jsonResponse(response, 200, projection);
                    return;
                }
                const mutationNow = now();
                let mutation;
                if (decision.route.routeId === 'gate_probe_prepare') {
                    const parsed = parseJsonObject(body);
                    if (
                        !exactKeys(parsed, ['cliAuthorization', 'envelope']) ||
                        operationId(parsed.envelope?.operationId) === null ||
                        parsed.envelope.operationId !== decision.requestId
                    ) {
                        throw new TypeError(
                            'gate probe preparation payload is invalid',
                        );
                    }
                    const cliEvidence =
                        verifySmartOrderGateProbeCliAuthorization({
                            capability: serverGateProbeCliCapability,
                            envelope: parsed.envelope,
                            authorization: parsed.cliAuthorization,
                            nowEpochMs: mutationNow,
                            expectedApiGenerationSha256:
                                runtimeController?.status?.()
                                    ?.apiGenerationSha256,
                            expectedRuntimeEpochIdSha256: `sha256:${createHash(
                                'sha256',
                            )
                                .update(runtimeEpochId)
                                .digest('hex')}`,
                        });
                    if (
                        gateProbeControlPlaneAuthority === null ||
                        typeof runtimeController
                            ?.prepareGateProbeSafetyEnvelope !== 'function'
                    ) {
                        jsonResponse(response, 503, {
                            code: 'gate_probe_prepare_not_wired',
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    try {
                        const result =
                            await runtimeController.prepareGateProbeSafetyEnvelope(
                                {
                                    controlPlaneAuthority:
                                        gateProbeControlPlaneAuthority,
                                    cliAuthorizationSha256:
                                        cliEvidence.cliAuthorizationSha256,
                                    envelope: parsed.envelope,
                                    nowEpochMs: mutationNow,
                                },
                            );
                        jsonResponse(response, result.prepared ? 200 : 423, {
                            result,
                            brokerWriteAttempted: false,
                            brokerAuthority: false,
                            writeMasterAuthority: false,
                        });
                    } catch {
                        jsonResponse(response, 423, {
                            code: 'gate_probe_prepare_failed_closed',
                            brokerWriteAttempted: false,
                            brokerAuthority: false,
                            writeMasterAuthority: false,
                        });
                    }
                    return;
                } else if (
                    decision.route.routeId === 'gate_manifest_recompute'
                ) {
                    const parsed = parseJsonObject(body);
                    const hasExternalObservation = Object.hasOwn(
                        parsed,
                        'externalOrderEventObservation',
                    );
                    if (
                        !exactKeys(
                            parsed,
                            hasExternalObservation
                                ? [
                                      'externalOrderEventObservation',
                                      'operationId',
                                  ]
                                : ['operationId'],
                        ) ||
                        operationId(parsed.operationId) === null ||
                        (hasExternalObservation &&
                            typeof parsed.externalOrderEventObservation !==
                                'boolean')
                    ) {
                        throw new TypeError(
                            'gate manifest recomputation payload is invalid',
                        );
                    }
                    if (
                        typeof runtimeController?.recomputeGateManifests !==
                        'function'
                    ) {
                        jsonResponse(response, 503, {
                            code: 'gate_runner_not_wired',
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    let result;
                    try {
                        result = await runtimeController.recomputeGateManifests({
                            nowEpochMs: mutationNow,
                            operationId: parsed.operationId,
                            ...(hasExternalObservation
                                ? {
                                      externalOrderEventObservation:
                                          parsed.externalOrderEventObservation,
                                  }
                                : {}),
                        });
                    } catch {
                        jsonResponse(response, 503, {
                            code: 'gate_runner_failed_closed',
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    jsonResponse(response, 200, {
                        result,
                        brokerWriteAttempted: false,
                    });
                    return;
                } else if (
                    decision.route.routeId === 'task0_3c_reconcile'
                ) {
                    const parsed = parseJsonObject(body);
                    if (
                        !exactKeys(parsed, ['observation', 'operationId']) ||
                        operationId(parsed.operationId) === null ||
                        !parsed.observation ||
                        typeof parsed.observation !== 'object' ||
                        Array.isArray(parsed.observation)
                    ) {
                        throw new TypeError(
                            'Task 0.3c reconciliation payload is invalid',
                        );
                    }
                    if (
                        typeof runtimeController?.recordTask03cExternalWorkingSet !==
                        'function'
                    ) {
                        jsonResponse(response, 503, {
                            code: 'task0_3c_reconciliation_not_wired',
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    try {
                        const result =
                            await runtimeController.recordTask03cExternalWorkingSet({
                                nowEpochMs: mutationNow,
                                observation: parsed.observation,
                                operationId: parsed.operationId,
                            });
                        jsonResponse(response, 200, {
                            result,
                            brokerWriteAttempted: false,
                        });
                    } catch {
                        jsonResponse(response, 503, {
                            code: 'task0_3c_reconciliation_failed_closed',
                            brokerWriteAttempted: false,
                        });
                    }
                    return;
                } else if (decision.route.routeId === 'lifecycle_quiesce') {
                    if (typeof runtimeController?.quiesce !== 'function') {
                        jsonResponse(response, 503, {
                            code: 'lifecycle_service_not_wired',
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    const parsed = parseJsonObject(body);
                    if (
                        !exactKeys(parsed, ['operation']) ||
                        !SMART_ORDER_LIFECYCLE_OPERATIONS.includes(
                            parsed.operation,
                        )
                    ) {
                        throw new TypeError('lifecycle quiesce payload is invalid');
                    }
                    const result = await runtimeController.quiesce({
                        operation: parsed.operation,
                        nowEpochMs: mutationNow,
                    });
                    const lifecycle = safeLifecycleProjection(result.lifecycle);
                    const drainAllowed = result.drainAllowed === true;
                    const selectedBlockerCount =
                        Number.isSafeInteger(result.selectedBlockerCount) &&
                        result.selectedBlockerCount >= 0
                            ? result.selectedBlockerCount
                            : null;
                    const selectedProjection =
                        selectSmartOrderLifecycleDrainProjection(
                            lifecycle,
                            parsed.operation,
                        );
                    if (
                        selectedBlockerCount === null ||
                        drainAllowed !== selectedProjection.allowed ||
                        selectedBlockerCount !==
                            selectedProjection.blockerCount
                    ) {
                        throw new Error(
                            'lifecycle quiesce result does not match repository projection',
                        );
                    }
                    jsonResponse(response, drainAllowed ? 200 : 409, {
                        schemaVersion:
                            'smart-order-lifecycle-quiesce/2026-08-12.1',
                        state: result.state,
                        operation: parsed.operation,
                        drainAllowed,
                        blockerCount: selectedBlockerCount,
                        dispatchAllowed: false,
                        writeMaster: 'disabled',
                        lifecycle,
                        brokerWriteAttempted: false,
                        accountIdentifiersExposed: false,
                        entityIdentifiersExposed: false,
                    });
                    return;
                } else if (decision.route.routeId === 'lifecycle_stop') {
                    if (
                        typeof runtimeController?.commitLifecycleStop !==
                            'function' ||
                        typeof onLifecycleStopPrecommit !== 'function' ||
                        typeof onLifecycleStopAborted !== 'function' ||
                        typeof onLifecycleStopCommitted !== 'function'
                    ) {
                        jsonResponse(response, 503, {
                            code: 'lifecycle_stop_service_not_wired',
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    const parsed = parseJsonObject(body);
                    if (
                        !exactKeys(parsed, [
                            'operation',
                            'completionNonce',
                        ]) ||
                        !SMART_ORDER_LIFECYCLE_OPERATIONS.includes(
                            parsed.operation,
                        ) ||
                        operationId(parsed.completionNonce) === null
                    ) {
                        throw new TypeError(
                            'lifecycle stop payload is invalid',
                        );
                    }
                    const completionNonceSha256 = `sha256:${createHash(
                        'sha256',
                    )
                        .update(parsed.completionNonce)
                        .digest('hex')}`;
                    const requestIdSha256 = `sha256:${createHash('sha256')
                        .update(decision.requestId)
                        .digest('hex')}`;
                    const controllerStatusBeforeStop =
                        runtimeController.status();
                    if (
                        !Number.isSafeInteger(
                            controllerStatusBeforeStop?.revision,
                        ) ||
                        controllerStatusBeforeStop.revision < 0 ||
                        typeof controllerStatusBeforeStop.apiGenerationSha256 !==
                            'string'
                    ) {
                        throw new Error(
                            'lifecycle stop pre-commit controller status is invalid',
                        );
                    }
                    const precommitBinding = Object.freeze({
                        operation: parsed.operation,
                        runtimeEpochIdSha256: `sha256:${createHash('sha256')
                            .update(runtimeEpochId)
                            .digest('hex')}`,
                        apiGenerationSha256:
                            controllerStatusBeforeStop.apiGenerationSha256,
                        stopRevision:
                            controllerStatusBeforeStop.revision +
                            (controllerStatusBeforeStop.state === 'quiescing'
                                ? 1
                                : 2),
                        completionNonceSha256,
                        requestIdSha256,
                    });
                    await onLifecycleStopPrecommit(precommitBinding);
                    let committed;
                    try {
                        committed =
                            await runtimeController.commitLifecycleStop({
                                operation: parsed.operation,
                                nowEpochMs: mutationNow,
                            });
                    } catch (error) {
                        if (error?.name !== 'RuntimeStopBlockedError') {
                            throw error;
                        }
                        await onLifecycleStopAborted(precommitBinding);
                        jsonResponse(response, 409, {
                            schemaVersion:
                                'smart-order-lifecycle-stop-commit/2026-08-12.1',
                            state: runtimeController.status().state,
                            operation: parsed.operation,
                            committed: false,
                            completionNonceSha256,
                            requestIdSha256,
                            cleanupPending: false,
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    const expectedRuntimeEpochIdSha256 = `sha256:${createHash(
                        'sha256',
                    )
                        .update(runtimeEpochId)
                        .digest('hex')}`;
                    const controllerStatus = runtimeController.status();
                    if (
                        committed?.state !== 'stopped' ||
                        committed.operation !== parsed.operation ||
                        committed.runtimeEpochIdSha256 !==
                            expectedRuntimeEpochIdSha256 ||
                        committed.apiGenerationSha256 !==
                            controllerStatus.apiGenerationSha256 ||
                        !Number.isSafeInteger(committed.revision) ||
                        committed.revision < 0 ||
                        committed.dispatchAllowed !== false ||
                        committed.brokerWriteAttempted !== false
                    ) {
                        throw new Error(
                            'lifecycle stop commit result is invalid',
                        );
                    }
                    const stopCommit = Object.freeze({
                        schemaVersion:
                            'smart-order-lifecycle-stop-commit/2026-08-12.1',
                        state: 'stopped',
                        operation: parsed.operation,
                        committed: true,
                        runtimeEpochIdSha256:
                            committed.runtimeEpochIdSha256,
                        apiGenerationSha256:
                            committed.apiGenerationSha256,
                        stopRevision: committed.revision,
                        completionNonceSha256,
                        requestIdSha256,
                        cleanupPending: true,
                        dispatchAllowed: false,
                        writeMaster: 'disabled',
                        brokerWriteAttempted: false,
                        accountIdentifiersExposed: false,
                        entityIdentifiersExposed: false,
                    });
                    if (
                        stopCommit.runtimeEpochIdSha256 !==
                            precommitBinding.runtimeEpochIdSha256 ||
                        stopCommit.apiGenerationSha256 !==
                            precommitBinding.apiGenerationSha256 ||
                        stopCommit.stopRevision !==
                            precommitBinding.stopRevision ||
                        stopCommit.completionNonceSha256 !==
                            precommitBinding.completionNonceSha256 ||
                        stopCommit.requestIdSha256 !==
                            precommitBinding.requestIdSha256
                    ) {
                        throw new Error(
                            'lifecycle stop commit diverged from its pre-commit barrier',
                        );
                    }
                    // Cleanup is driven by the durable stop commit, not by the
                    // client receiving or acknowledging this HTTP response.
                    // A caller may disconnect after SQLite commits but before
                    // the response flushes; tying cleanup to `finish` would
                    // strand a stopped Runtime while it still owns the
                    // listener and exclusive lease.  Defer one turn so
                    // server.close never waits on this handler itself.
                    setImmediate(() => {
                        void Promise.resolve(
                            onLifecycleStopCommitted(stopCommit),
                        ).catch(() => {
                            // Diagnostics will observe the missing exact
                            // completion and fail closed.  No public response
                            // may promote partial cleanup.
                        });
                    });
                    jsonResponse(response, 202, stopCommit);
                    return;
                } else if (
                    decision.route.routeId === 'risk_policy_publish'
                ) {
                    mutation = await executeReplayProtectedMutation({
                        runtimeController,
                        decision,
                        operationKind: 'risk_policy_publish',
                        body,
                        nowEpochMs: mutationNow,
                        buildMutation: async (parsed) => {
                            if (
                                !exactKeys(parsed, [
                                    'expectedRevision',
                                    'operationId',
                                    'policy',
                                ]) ||
                                (parsed.expectedRevision !== null &&
                                    (!Number.isSafeInteger(
                                        parsed.expectedRevision,
                                    ) ||
                                        parsed.expectedRevision < 0))
                            ) {
                                throw new TypeError(
                                    'risk policy publication payload is invalid',
                                );
                            }
                            return {
                                kind: 'risk_policy_publish',
                                expectedRevision: parsed.expectedRevision,
                                policy: parsed.policy,
                                nowEpochMs: mutationNow,
                            };
                        },
                    });
                } else if (
                    decision.route.routeId === 'risk_kill_switch'
                ) {
                    mutation = await executeReplayProtectedMutation({
                        runtimeController,
                        decision,
                        operationKind: 'risk_kill_switch',
                        body,
                        nowEpochMs: mutationNow,
                        buildMutation: async (parsed) => {
                            if (
                                !exactKeys(parsed, [
                                    'enabled',
                                    'expectedArbiterRevision',
                                    'operationId',
                                    'reasonCode',
                                    'switchName',
                                ]) ||
                                typeof parsed.enabled !== 'boolean' ||
                                !Number.isSafeInteger(
                                    parsed.expectedArbiterRevision,
                                ) ||
                                parsed.expectedArbiterRevision < 0 ||
                                typeof parsed.reasonCode !== 'string' ||
                                typeof parsed.switchName !== 'string'
                            ) {
                                throw new TypeError(
                                    'kill switch mutation payload is invalid',
                                );
                            }
                            return {
                                enabled: parsed.enabled,
                                expectedArbiterRevision:
                                    parsed.expectedArbiterRevision,
                                kind: 'risk_kill_switch',
                                nowEpochMs: mutationNow,
                                reasonCode: parsed.reasonCode,
                                switchName: parsed.switchName,
                            };
                        },
                    });
                } else if (decision.route.routeId === 'strategy_create') {
                    if (
                        typeof runtimeController?.createDraftStrategy !==
                        'function'
                    ) {
                        jsonResponse(response, 503, {
                            code: 'mutation_service_not_wired',
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    mutation = await executeReplayProtectedMutation({
                        runtimeController,
                        decision,
                        operationKind: 'strategy_create_draft',
                        body,
                        nowEpochMs: mutationNow,
                        buildMutation: async (parsed) => {
                            if (
                                !exactKeys(
                                    parsed,
                                    ['operationId', 'strategyKind'],
                                    ['workspaceContractKey'],
                                )
                            ) {
                                throw new TypeError(
                                    'strategy draft create payload is invalid',
                                );
                            }
                            return {
                                kind: 'create',
                                strategyId: randomUUID(),
                                strategyKind: parsed.strategyKind,
                                workspaceContractKey:
                                    parsed.workspaceContractKey,
                                nowEpochMs: mutationNow,
                            };
                        },
                    });
                } else if (
                    decision.route.routeId === 'strategy_update_draft'
                ) {
                    if (
                        typeof runtimeController?.replaceDraftStrategy !==
                        'function'
                    ) {
                        jsonResponse(response, 503, {
                            code: 'mutation_service_not_wired',
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    mutation = await executeReplayProtectedMutation({
                        runtimeController,
                        decision,
                        operationKind: 'strategy_update_draft',
                        body,
                        nowEpochMs: mutationNow,
                        buildMutation: async (parsed) => {
                            if (
                                !exactKeys(parsed, [
                                    'draft',
                                    'expectedRevision',
                                    'operationId',
                                ]) ||
                                !Number.isSafeInteger(parsed.expectedRevision) ||
                                parsed.expectedRevision < 0
                            ) {
                                throw new TypeError(
                                    'strategy draft update payload is invalid',
                                );
                            }
                            return {
                                kind: 'update',
                                strategyId: decision.route.strategyId,
                                expectedRevision: parsed.expectedRevision,
                                draft: parsed.draft,
                                nowEpochMs: mutationNow,
                            };
                        },
                    });
                } else if (
                    decision.route.routeId ===
                        'protected_entry_confirmation_preview' ||
                    decision.route.routeId ===
                        'protected_entry_confirmation_accept'
                ) {
                    const isAccept =
                        decision.route.routeId ===
                        'protected_entry_confirmation_accept';
                    if (
                        strategyConfirmationControlPlaneAuthority === null ||
                        typeof strategyConfirmationEvidenceProvider !==
                            'function'
                    ) {
                        jsonResponse(response, 503, {
                            code: 'mutation_service_not_wired',
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    mutation = await executeReplayProtectedMutation({
                        runtimeController,
                        decision,
                        operationKind: decision.route.routeId,
                        body,
                        nowEpochMs: mutationNow,
                        buildMutation: async (parsed) => {
                            const requiredKeys = [
                                'confirmationId',
                                'confirmationRequest',
                                'operationId',
                                ...(isAccept
                                    ? ['snapshotHash', 'userAcknowledged']
                                    : []),
                            ];
                            const request = parsed.confirmationRequest;
                            if (
                                !exactKeys(parsed, requiredKeys) ||
                                typeof parsed.confirmationId !== 'string' ||
                                !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                                    parsed.confirmationId,
                                ) ||
                                (!isAccept &&
                                    parsed.confirmationId !==
                                        parsed.operationId) ||
                                (isAccept &&
                                    (parsed.confirmationId ===
                                        parsed.operationId ||
                                        parsed.userAcknowledged !== true ||
                                        typeof parsed.snapshotHash !==
                                            'string' ||
                                        !/^sha256:[0-9a-f]{64}$/.test(
                                            parsed.snapshotHash,
                                        ))) ||
                                !exactKeys(request, [
                                    'accountBrokerRef',
                                    'accountIdRef',
                                    'commonLots',
                                    'contractKey',
                                    'entryOrder',
                                    'protection',
                                    'schemaVersion',
                                ]) ||
                                request.schemaVersion !==
                                    'smart-order-protected-entry-confirmation-request/2026-08-20.1'
                            ) {
                                throw new TypeError(
                                    'protected entry confirmation payload is invalid',
                                );
                            }
                            const contractEvidence =
                                await strategyConfirmationEvidenceProvider({
                                    accountBrokerRef:
                                        request.accountBrokerRef,
                                    accountIdRef: request.accountIdRef,
                                    contractKey: request.contractKey,
                                    expectedRevision: null,
                                    strategyId: null,
                                });
                            return {
                                confirmationId: parsed.confirmationId,
                                confirmationRequest: request,
                                contractEvidence,
                                controlPlaneAuthority:
                                    strategyConfirmationControlPlaneAuthority,
                                kind: isAccept
                                    ? 'protected_entry_confirmation_accept'
                                    : 'protected_entry_confirmation_preview',
                                nowEpochMs: mutationNow,
                                ...(isAccept
                                    ? {
                                          snapshotHash:
                                              parsed.snapshotHash,
                                          userAcknowledged: true,
                                      }
                                    : {}),
                            };
                        },
                    });
                } else if (
                    decision.route.routeId ===
                        'strategy_confirmation_preview' ||
                    decision.route.routeId ===
                        'strategy_confirmation_accept'
                ) {
                    const isAccept =
                        decision.route.routeId ===
                        'strategy_confirmation_accept';
                    if (
                        strategyConfirmationControlPlaneAuthority === null ||
                        typeof strategyConfirmationEvidenceProvider !==
                            'function' ||
                        typeof runtimeController?.getStrategy !== 'function'
                    ) {
                        jsonResponse(response, 503, {
                            code: 'mutation_service_not_wired',
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    mutation = await executeReplayProtectedMutation({
                        runtimeController,
                        decision,
                        operationKind: decision.route.routeId,
                        body,
                        nowEpochMs: mutationNow,
                        buildMutation: async (parsed) => {
                            const requiredKeys = [
                                'accountBrokerRef',
                                'accountIdRef',
                                'basisSelection',
                                'confirmationId',
                                'expectedRevision',
                                'operationId',
                                ...(isAccept
                                    ? [
                                          'snapshotHash',
                                          'userAcknowledged',
                                      ]
                                    : []),
                            ];
                            if (
                                !exactKeys(parsed, requiredKeys) ||
                                !Number.isSafeInteger(
                                    parsed.expectedRevision,
                                ) ||
                                parsed.expectedRevision < 0 ||
                                typeof parsed.confirmationId !== 'string' ||
                                !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                                    parsed.confirmationId,
                                ) ||
                                (!isAccept &&
                                    parsed.confirmationId !==
                                        parsed.operationId) ||
                                (isAccept &&
                                    (parsed.confirmationId ===
                                        parsed.operationId ||
                                        parsed.userAcknowledged !== true ||
                                        typeof parsed.snapshotHash !==
                                            'string' ||
                                        !/^sha256:[0-9a-f]{64}$/.test(
                                            parsed.snapshotHash,
                                        )))
                            ) {
                                throw new TypeError(
                                    'strategy confirmation payload is invalid',
                                );
                            }
                            const strategy =
                                await runtimeController.getStrategy({
                                    strategyId:
                                        decision.route.strategyId,
                                });
                            const contractKey =
                                strategy?.strategyKind === 'parent_child'
                                    ? strategy?.definition?.parameters?.parent
                                          ?.order?.contractKey
                                    : strategy?.definition?.parameters?.order
                                          ?.contractKey;
                            const monitorContractKey =
                                strategy?.strategyKind === 'good_till'
                                    ? strategy?.definition?.parameters
                                          ?.monitorContractKey
                                    : null;
                            const monitorContractKeys =
                                strategy?.strategyKind === 'parent_child'
                                    ? [
                                          strategy?.definition?.parameters?.child
                                              ?.order?.contractKey,
                                      ]
                                    : strategy?.strategyKind === 'multi_condition' &&
                                      Array.isArray(
                                          strategy?.definition?.parameters?.conditions,
                                      )
                                    ? strategy.definition.parameters.conditions.map(
                                          (entry) => entry?.monitorContractKey,
                                      )
                                    : null;
                            if (
                                strategy?.state !== 'draft' ||
                                strategy.revision !==
                                    parsed.expectedRevision ||
                                typeof contractKey !== 'string' ||
                                !/^(?:TSE|OTC):STK:[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(
                                    contractKey,
                                ) ||
                                (strategy?.strategyKind === 'good_till' &&
                                    (typeof monitorContractKey !== 'string' ||
                                        !/^(?:TSE|OTC):STK:[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(
                                            monitorContractKey,
                                        ))) ||
                                (['multi_condition', 'parent_child'].includes(
                                    strategy?.strategyKind,
                                ) &&
                                    (!Array.isArray(monitorContractKeys) ||
                                        monitorContractKeys.length < 1 ||
                                        monitorContractKeys.length >
                                            (strategy?.strategyKind ===
                                            'parent_child'
                                                ? 1
                                                : 7) ||
                                        monitorContractKeys.some(
                                            (key) =>
                                                typeof key !== 'string' ||
                                                !/^(?:TSE|OTC):STK:[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(
                                                    key,
                                                ),
                                        )))
                            ) {
                                throw new Error(
                                    'strategy confirmation draft is stale or unsupported',
                                );
                            }
                            const contractEvidence =
                                await strategyConfirmationEvidenceProvider({
                                    accountBrokerRef:
                                        parsed.accountBrokerRef,
                                    accountIdRef: parsed.accountIdRef,
                                    contractKey,
                                    expectedRevision:
                                        parsed.expectedRevision,
                                    strategyId:
                                        decision.route.strategyId,
                                });
                            const monitorContractEvidence =
                                strategy?.strategyKind === 'good_till'
                                    ? await strategyConfirmationEvidenceProvider({
                                          accountBrokerRef:
                                              parsed.accountBrokerRef,
                                          accountIdRef:
                                              parsed.accountIdRef,
                                          contractKey: monitorContractKey,
                                          expectedRevision:
                                              parsed.expectedRevision,
                                          strategyId:
                                              decision.route.strategyId,
                                      })
                                    : ['multi_condition', 'parent_child'].includes(
                                            strategy?.strategyKind,
                                        )
                                      ? await Promise.all(
                                            monitorContractKeys.map(
                                                (candidateContractKey) =>
                                                    strategyConfirmationEvidenceProvider({
                                                        accountBrokerRef:
                                                            parsed.accountBrokerRef,
                                                        accountIdRef:
                                                            parsed.accountIdRef,
                                                        contractKey:
                                                            candidateContractKey,
                                                        expectedRevision:
                                                            parsed.expectedRevision,
                                                        strategyId:
                                                            decision.route.strategyId,
                                                    }),
                                            ),
                                        )
                                    : null;
                            return {
                                accountBrokerRef:
                                    parsed.accountBrokerRef,
                                accountIdRef: parsed.accountIdRef,
                                basisSelection: parsed.basisSelection,
                                confirmationId:
                                    parsed.confirmationId,
                                contractEvidence,
                                monitorContractEvidence,
                                controlPlaneAuthority:
                                    strategyConfirmationControlPlaneAuthority,
                                expectedRevision:
                                    parsed.expectedRevision,
                                kind: isAccept
                                    ? 'strategy_confirmation_accept'
                                    : 'strategy_confirmation_preview',
                                nowEpochMs: mutationNow,
                                ...(isAccept
                                    ? {
                                          snapshotHash:
                                              parsed.snapshotHash,
                                          userAcknowledged: true,
                                      }
                                    : {}),
                                strategyId:
                                    decision.route.strategyId,
                            };
                        },
                    });
                } else if (
                    decision.route.routeId ===
                    'strategy_manual_resolution_apply_unique_final'
                ) {
                    mutation = await executeReplayProtectedMutation({
                        runtimeController,
                        decision,
                        operationKind:
                            'manual_resolution_apply_unique_final',
                        body,
                        nowEpochMs: mutationNow,
                        buildMutation: async (parsed) => {
                            if (
                                !exactKeys(parsed, [
                                    'expectedRevision',
                                    'operationId',
                                    'resolutionKey',
                                    'userAcknowledgedFinalEvidence',
                                ]) ||
                                !Number.isSafeInteger(
                                    parsed.expectedRevision,
                                ) ||
                                parsed.expectedRevision < 0 ||
                                typeof parsed.resolutionKey !== 'string' ||
                                !/^sha256:[0-9a-f]{64}$/.test(
                                    parsed.resolutionKey,
                                ) ||
                                parsed.userAcknowledgedFinalEvidence !== true
                            ) {
                                throw new TypeError(
                                    'manual resolution payload is invalid',
                                );
                            }
                            return {
                                expectedRevision: parsed.expectedRevision,
                                kind: 'manual_resolution_apply_unique_final',
                                nowEpochMs: mutationNow,
                                resolutionKey: parsed.resolutionKey,
                                strategyId: decision.route.strategyId,
                                userAcknowledgedFinalEvidence: true,
                            };
                        },
                    });
                } else if (
                    [
                        'strategy_prepared_intent_drain',
                        'strategy_protection_relinquish_prepare',
                        'strategy_protection_relinquish_commit',
                    ].includes(decision.route.routeId)
                ) {
                    const parsed = parseJsonObject(body);
                    const commitRelinquishment =
                        decision.route.routeId ===
                        'strategy_protection_relinquish_commit';
                    const prepareRelinquishment =
                        decision.route.routeId ===
                        'strategy_protection_relinquish_prepare';
                    const requiredKeys = commitRelinquishment
                        ? [
                              'challengeId',
                              'expectedRevision',
                              'operationId',
                              'operatorAcknowledgedManualHandoff',
                          ]
                        : prepareRelinquishment
                          ? [
                                'expectedRevision',
                                'operationId',
                                'operatorAcknowledgedManualHandoff',
                            ]
                          : [
                                'expectedRevision',
                                'operationId',
                                'userConfirmationAcknowledged',
                            ];
                    if (
                        !exactKeys(parsed, requiredKeys) ||
                        operationId(parsed.operationId) === null ||
                        !Number.isSafeInteger(parsed.expectedRevision) ||
                        parsed.expectedRevision < 0 ||
                        (commitRelinquishment &&
                            operationId(parsed.challengeId) === null) ||
                        ((prepareRelinquishment || commitRelinquishment) &&
                            parsed.operatorAcknowledgedManualHandoff !== true) ||
                        (!prepareRelinquishment &&
                            !commitRelinquishment &&
                            parsed.userConfirmationAcknowledged !== true)
                    ) {
                        throw new TypeError(
                            'strategy drain action payload is invalid',
                        );
                    }
                    const method = commitRelinquishment
                        ? 'commitProtectionRelinquishment'
                        : prepareRelinquishment
                          ? 'prepareProtectionRelinquishment'
                          : 'drainPreparedIntentProvenUnsent';
                    if (typeof runtimeController?.[method] !== 'function') {
                        jsonResponse(response, 503, {
                            code: 'mutation_service_not_wired',
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    let result;
                    try {
                        result = await runtimeController[method]({
                            strategyId: decision.route.strategyId,
                            expectedRevision: parsed.expectedRevision,
                            operationId: parsed.operationId,
                            ...(commitRelinquishment
                                ? { challengeId: parsed.challengeId }
                                : {}),
                            ...(prepareRelinquishment || commitRelinquishment
                                ? {
                                      operatorAcknowledgedManualHandoff: true,
                                  }
                                : {}),
                            nowEpochMs: mutationNow,
                        });
                    } catch (error) {
                        const publicError = publicStrategyOperationError(error);
                        jsonResponse(response, publicError.status, {
                            code: publicError.code,
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    jsonResponse(response, 200, {
                        result,
                        resultHash: sha256(canonicalJson(result)),
                        brokerWriteAttempted: false,
                    });
                    return;
                } else if (
                    [
                        'strategy_pause',
                        'strategy_resume',
                        'strategy_cancel',
                        'strategy_copy',
                        'broker_order_cancel_request',
                        'broker_order_update_request',
                    ].includes(decision.route.routeId)
                ) {
                    const brokerOrderCancellation =
                        decision.route.routeId ===
                        'broker_order_cancel_request';
                    const brokerOrderUpdate =
                        decision.route.routeId ===
                        'broker_order_update_request';
                    const action = brokerOrderCancellation
                        ? 'cancel_broker_order'
                        : brokerOrderUpdate
                          ? 'update_broker_order'
                          : decision.route.routeId.slice('strategy_'.length);
                    if (
                        typeof runtimeController
                            ?.executeReplayProtectedStrategyMutation !==
                        'function'
                    ) {
                        jsonResponse(response, 503, {
                            code: 'mutation_service_not_wired',
                            brokerWriteAttempted: false,
                        });
                        return;
                    }
                    mutation = await executeReplayProtectedMutation({
                        runtimeController,
                        decision,
                        operationKind: brokerOrderCancellation
                            ? 'broker_order_cancel_request'
                            : brokerOrderUpdate
                              ? 'broker_order_update_request'
                            : decision.route.routeId,
                        body,
                        nowEpochMs: mutationNow,
                        buildMutation: async (parsed) => {
                            const requiredKeys =
                                action === 'resume'
                                    ? [
                                          'activationPolicyAcknowledged',
                                          'expectedRevision',
                                          'operationId',
                                      ]
                                    : action === 'cancel_broker_order'
                                      ? [
                                            'expectedRevision',
                                            'operationId',
                                            'userConfirmationAcknowledged',
                                        ]
                                      : action === 'update_broker_order'
                                        ? [
                                              'expectedRevision',
                                              'operationId',
                                              'quantityShares',
                                              'userConfirmationAcknowledged',
                                          ]
                                      : [
                                            'expectedRevision',
                                            'operationId',
                                        ];
                            if (
                                !exactKeys(parsed, requiredKeys) ||
                                !Number.isSafeInteger(parsed.expectedRevision) ||
                                parsed.expectedRevision < 0 ||
                                (action === 'resume' &&
                                    parsed.activationPolicyAcknowledged !==
                                        true) ||
                                (action === 'cancel_broker_order' &&
                                    parsed.userConfirmationAcknowledged !==
                                        true) ||
                                (action === 'update_broker_order' &&
                                    parsed.userConfirmationAcknowledged !==
                                        true) ||
                                (action === 'update_broker_order' &&
                                    (!Number.isSafeInteger(
                                        parsed.quantityShares,
                                    ) ||
                                        parsed.quantityShares < 1))
                            ) {
                                throw new TypeError(
                                    'strategy action payload is invalid',
                                );
                            }
                            if (action === 'copy') {
                                return {
                                    kind: 'copy',
                                    sourceStrategyId:
                                        decision.route.strategyId,
                                    draftStrategyId: randomUUID(),
                                    expectedRevision: parsed.expectedRevision,
                                    nowEpochMs: mutationNow,
                                };
                            }
                            let protectionRearmContractEvidence = null;
                            if (action === 'resume') {
                                const strategy =
                                    typeof runtimeController?.getStrategy ===
                                    'function'
                                        ? await runtimeController.getStrategy({
                                              strategyId:
                                                  decision.route.strategyId,
                                          })
                                        : null;
                                const requiresProtectionRearmEvidence =
                                    strategy?.state === 'paused' &&
                                    ['stop_take', 'trailing_exit'].includes(
                                        strategy?.strategyKind,
                                    );
                                if (
                                    requiresProtectionRearmEvidence &&
                                    typeof runtimeController
                                        ?.strategyProtectionRearmEvidenceContext !==
                                        'function'
                                ) {
                                    throw new Error(
                                        'strategy protection re-arm evidence context is unavailable',
                                    );
                                }
                                const context =
                                    requiresProtectionRearmEvidence
                                        ? await runtimeController.strategyProtectionRearmEvidenceContext(
                                              {
                                                  controlPlaneAuthority:
                                                      strategyConfirmationControlPlaneAuthority,
                                                  expectedRevision:
                                                      parsed.expectedRevision,
                                                  strategyId:
                                                      decision.route.strategyId,
                                              },
                                          )
                                        : null;
                                if (context !== null) {
                                    if (
                                        strategyConfirmationControlPlaneAuthority ===
                                            null ||
                                        typeof strategyConfirmationEvidenceProvider !==
                                            'function' ||
                                        context.brokerWriteAuthority !== false
                                    ) {
                                        throw new Error(
                                            'strategy protection re-arm contract evidence is unavailable',
                                        );
                                    }
                                    protectionRearmContractEvidence =
                                        await strategyConfirmationEvidenceProvider(
                                            {
                                                accountBrokerRef:
                                                    context.accountBrokerRef,
                                                accountIdRef:
                                                    context.accountIdRef,
                                                contractKey:
                                                    context.contractKey,
                                                decisionTradingDate:
                                                    context.decisionTradingDate,
                                                expectedRevision:
                                                    context.expectedRevision,
                                                fixedAtrRequired:
                                                    context.fixedAtrRequired,
                                                strategyDefinitionHash:
                                                    context.strategyDefinitionHash,
                                                strategyId:
                                                    context.strategyId,
                                            },
                                        );
                                }
                            }
                            return {
                                kind: action,
                                strategyId: decision.route.strategyId,
                                expectedRevision: parsed.expectedRevision,
                                ...(action === 'update_broker_order'
                                    ? {
                                          quantityShares:
                                              parsed.quantityShares,
                                      }
                                    : {}),
                                ...(action === 'resume'
                                    ? {
                                          activationPolicyAcknowledged:
                                              true,
                                          contractEvidence:
                                              protectionRearmContractEvidence,
                                          controlPlaneAuthority:
                                              strategyConfirmationControlPlaneAuthority,
                                      }
                                    : {}),
                                ...(['cancel_broker_order', 'update_broker_order'].includes(
                                    action,
                                )
                                    ? {
                                          userConfirmationAcknowledged:
                                              true,
                                      }
                                    : {}),
                                nowEpochMs: mutationNow,
                            };
                        },
                    });
                }
                if (mutation) {
                    jsonResponse(response, mutation.status, mutation.payload);
                    return;
                }
                if (decision.route.access === 'authenticated_mutation') {
                    jsonResponse(response, 503, {
                        code: 'mutation_service_not_wired',
                        brokerWriteAttempted: false,
                    });
                    return;
                }
                jsonResponse(response, 501, {
                    code: 'read_service_not_wired',
                });
            } catch (error) {
                if (!response.headersSent) {
                    const bodyTooLarge = error?.code === 'BODY_TOO_LARGE';
                    const bodyDeadlineExceeded =
                        error?.code === 'BODY_DEADLINE_EXCEEDED';
                    jsonResponse(
                        response,
                        bodyTooLarge ? 413 : bodyDeadlineExceeded ? 408 : 400,
                        {
                            code: bodyTooLarge
                                ? 'body_too_large'
                                : bodyDeadlineExceeded
                                  ? 'request_body_timeout'
                                  : 'invalid_request',
                            brokerWriteAttempted: false,
                        },
                    );
                } else {
                    response.destroy();
                }
            } finally {
                mutationAdmissionLease?.release();
                if (requestSlotHeld) activeRequests -= 1;
            }
        },
    );
    server.maxHeadersCount = MAX_HEADER_COUNT;
    server.headersTimeout = HEADER_TIMEOUT_MS;
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.keepAliveTimeout = 1_000;

    try {
        await new Promise((resolve, reject) => {
            const onError = (error) => {
                server.off('listening', onListening);
                reject(error);
            };
            const onListening = () => {
                server.off('error', onError);
                resolve();
            };
            server.once('error', onError);
            server.once('listening', onListening);
            server.listen({ host: LOOPBACK_HOST, port, exclusive: true });
        });
        const address = server.address();
        if (
            !address ||
            typeof address === 'string' ||
            address.address !== LOOPBACK_HOST
        ) {
            throw new Error('control plane did not bind exact IPv4 loopback');
        }
        actualPort = address.port;
    } catch (error) {
        await new Promise((resolve) => server.close(() => resolve())).catch(
            () => {},
        );
        serverCapability.fill(0);
        serverGateProbeCliCapability.fill(0);
        throw error;
    }

    return Object.freeze({
        schemaVersion: SMART_ORDER_CONTROL_PLANE_SERVER_SCHEMA_VERSION,
        host: LOOPBACK_HOST,
        port: actualPort,
        async close() {
            if (closed) return;
            closed = true;
            mutationAdmission.close();
            await new Promise((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            });
            serverCapability.fill(0);
            serverGateProbeCliCapability.fill(0);
        },
    });
}
