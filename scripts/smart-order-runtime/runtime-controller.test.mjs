import { createHash, createHmac } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

const reconciliationAuthority = vi.hoisted(() => ({
    verifiers: new WeakSet(),
}));
const identityAuthority = vi.hoisted(() => ({
    evidence: new WeakSet(),
}));
const contractEvidenceAuthority = vi.hoisted(() => ({
    evidence: new WeakSet(),
}));
vi.mock('./account-reconciliation-verifier-authority.mjs', () => ({
    isVerifiedSmartOrderAccountReconciliationVerifier(value) {
        return reconciliationAuthority.verifiers.has(value);
    },
}));
vi.mock('./canonical-principal-verifier-authority.mjs', () => ({
    isVerifiedSmartOrderCanonicalPrincipalEvidence(value) {
        return identityAuthority.evidence.has(value);
    },
}));
vi.mock('./canonical-contract-evidence-authority.mjs', () => ({
    isVerifiedSmartOrderCanonicalContractEvidence(value) {
        return contractEvidenceAuthority.evidence.has(value);
    },
}));
import { SMART_ORDER_RUNTIME_GAP_INVALIDATION_SCHEMA_VERSION } from './runtime-gap-detector.mjs';
import { startSmartOrderRuntimeController } from './runtime-controller.mjs';
import {
    SMART_ORDER_PROTECTED_ENTRY_INTENT_SCHEMA_VERSION,
    SMART_ORDER_PROTECTED_ENTRY_PLAN_SCHEMA_VERSION,
    SMART_ORDER_PROTECTED_ENTRY_RISK_POLICY_SCHEMA_VERSION,
    canonicalProtectedEntryIntentPayload,
    canonicalProtectedEntryPlan,
} from './protected-entry-contract.mjs';
import {
    SMART_ORDER_BROKER_EVENT_CANDIDATE_SCHEMA_VERSION,
    normalizeCanonicalSmartOrderBrokerEvent,
} from './broker-event-normalizer.mjs';
import { createSmartOrderAccountReconciliationCoordinator } from './account-reconciliation-coordinator.mjs';
import {
    SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
    SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
} from './canonical-pnl-policy.mjs';
import { SMART_ORDER_RUNTIME_RISK_POLICY_EDITOR_SCHEMA_VERSION } from './runtime-risk-policy.mjs';
import {
    SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
    smartOrderGateProbeAccountScopeSha256,
} from './gate-probe-safety-envelope.mjs';
import { buildSmartOrderProtectiveBrokerIntentPayload } from './broker-execution-policy.mjs';
import {
    createSmartOrderQuoteSubscriptionCoordinator,
    isTrustedSmartOrderQuickConditionObservation,
} from './quote-subscription-coordinator.mjs';
import { normalizeSmartOrderQuickFieldEvent } from './quick-field-normalizer.mjs';
import { SMART_ORDER_QUICK_FIELD_MAPPING_REVISION } from './quick-field-mapping.mjs';
import {
    prepareSmartOrderPrivateStorage,
    readPrivateSecret,
} from './private-storage.mjs';
import { canonicalSmartOrderDraft } from './canonical-strategy-draft-fixtures.mjs';
import { openSmartOrderRepository } from './repository-client.mjs';
import { createRuntimeFixedWilderAtrSnapshot } from './fixed-wilder-atr-runtime.mjs';
import {
    canonicalExistingPositionProtectionPlan,
    deriveExistingPositionFormalProtection,
} from './existing-position-protection-contract.mjs';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const temporaryRoots = [];
const openControllers = new Set();
const controllerSourcePath = fileURLToPath(
    new URL('./runtime-controller.mjs', import.meta.url),
);

function canonicalJson(value) {
    const normalize = (candidate) => {
        if (Array.isArray(candidate)) return candidate.map(normalize);
        if (candidate && typeof candidate === 'object') {
            return Object.fromEntries(
                Object.keys(candidate)
                    .sort()
                    .map((key) => [key, normalize(candidate[key])]),
            );
        }
        return candidate;
    };
    return JSON.stringify(normalize(value));
}

function brokerCorrelationHash(value) {
    const fields = [
        value.accountBrokerRef,
        value.accountIdRef,
        value.tradeDate,
        value.contractKey,
        value.side,
        value.tradeId ?? '',
        value.orderId ?? '',
        value.dealId ?? '',
        value.seqno ?? '',
        value.ordno ?? '',
        value.exchangeSequence ?? '',
    ];
    return `sha256:${createHash('sha256')
        .update(fields.join('\u001f'))
        .digest('hex')}`;
}

function protectedEntryConfirmationRequest() {
    return Object.freeze({
        schemaVersion:
            'smart-order-protected-entry-confirmation-request/2026-08-20.1',
        accountBrokerRef: 'broker-A',
        accountIdRef: 'account-A',
        commonLots: 1,
        contractKey: 'TSE:STK:2330',
        entryOrder: Object.freeze({
            priceType: 'LMT',
            limitPrice: '100',
            timeInForce: 'ROD',
        }),
        protection: Object.freeze({
            family: 'fixed',
            legs: Object.freeze([
                Object.freeze({
                    comparator: 'lte',
                    distance: Object.freeze({ kind: 'pct_bps', pctBps: 300 }),
                    execution: Object.freeze({
                        priceType: 'LMT',
                        limitPrice: '95',
                        timeInForce: 'ROD',
                    }),
                    legId: 'stop',
                    type: 'stop',
                }),
            ]),
        }),
    });
}

function issuedProtectedEntryContractEvidence({
    apiGeneration,
    contractOverrides = {},
    gateManifestHash = `sha256:${'c'.repeat(64)}`,
    gateManifestRevision = 'automation-protection-r1',
    mappingRevision = 'mapping-r1',
    runtimeEpochId,
    observedAtEpochMs,
    validUntilEpochMs = observedAtEpochMs + 5_000,
    fixedAtrContext = null,
}) {
    const contract = Object.freeze({
        categoryCode: '24',
        code: '2330',
        contractUnit: 1_000,
        draftContractKey: 'TSE:STK:2330',
        exchange: 'TSE',
        limitDownMinorUnits: 9_000,
        limitUpMinorUnits: 11_000,
        referenceMinorUnits: 10_000,
        runtimeContractKey: 'TSE:2330:STK:Common',
        securityType: 'STK',
        updateDate: '2026-08-11',
        ...contractOverrides,
    });
    const sha256 = (value) =>
        `sha256:${createHash('sha256').update(value).digest('hex')}`;
    const contractRevision = sha256(
        `smart-order-contract-revision\u001f${canonicalJson(contract)}`,
    );
    const corporateActionRevision = sha256(
        `smart-order-corporate-action-revision\u001f${canonicalJson([
            contract.draftContractKey,
            contract.updateDate,
            contract.categoryCode,
            contract.contractUnit,
        ])}`,
    );
    const fixedAtrSnapshot =
        fixedAtrContext === null
            ? null
            : createRuntimeFixedWilderAtrSnapshot({
                  contractKey: contract.runtimeContractKey,
                  contractRevision,
                  corporateActionRevision,
                  decisionTradingDate:
                      fixedAtrContext.decisionTradingDate,
                  requestedEndDate: '2026-08-10',
                  requestedStartDate: '2026-07-11',
                  response: Object.fromEntries(
                      [
                          'datetime',
                          'Open',
                          'High',
                          'Low',
                          'Close',
                          'Volume',
                          'Amount',
                      ].map((key) => [
                          key,
                          Array.from({ length: 16 }, (_, index) => {
                              if (key === 'datetime') {
                                  const date = new Date(
                                      Date.UTC(2026, 6, 26 + index),
                                  ).toISOString().slice(0, 10);
                                  return `${date} 13:30:00`;
                              }
                              if (key === 'High') return 101;
                              if (key === 'Low') return 99;
                              if (key === 'Volume' || key === 'Amount') return 1;
                              return 100;
                          }),
                      ]),
                  ),
                  strategyDefinitionHash:
                      fixedAtrContext.strategyDefinitionHash,
              });
    const content = Object.freeze({
        schemaVersion:
            'smart-order-canonical-contract-evidence/2026-08-21.2',
        accountScopeSha256: sha256(
            `smart-order-confirmation-account\u001f${canonicalJson([
                'broker-A',
                'account-A',
                'S',
            ])}`,
        ),
        apiGeneration,
        contract,
        contractRevision,
        corporateActionRevision,
        fixedAtrSnapshot,
        gateManifestHash,
        gateManifestRevision,
        mappingRevision,
        observedAtEpochMs,
        runtimeEpochId,
        validUntilEpochMs,
    });
    const evidence = Object.freeze({
        ...content,
        evidenceSha256: sha256(canonicalJson(content)),
    });
    contractEvidenceAuthority.evidence.add(evidence);
    return evidence;
}

function protectedEntryRuntimeRiskPolicy() {
    return Object.freeze({
        schemaVersion: SMART_ORDER_RUNTIME_RISK_POLICY_EDITOR_SCHEMA_VERSION,
        buyFeeBps: 15,
        minimumBuyFeeMinorUnits: 20,
        cashBufferMinorUnits: 100,
        accountLimits: Object.freeze({
            quantityShares: 100_000,
            notionalMinorUnits: 2_000_000_000,
            cashMinorUnits: 2_000_000_000,
            positionShares: 100_000,
            orderCount: 100,
        }),
        identityLimits: Object.freeze({
            quantityShares: 200_000,
            notionalMinorUnits: 4_000_000_000,
            cashMinorUnits: 4_000_000_000,
            positionShares: 200_000,
            orderCount: 200,
        }),
        accountDailyLossLimitMinorUnits: 1_000_000_000,
        identityDailyLossLimitMinorUnits: 2_000_000_000,
    });
}

function protectedEntryPayload(modeRevision) {
    const plan = {
        schemaVersion: SMART_ORDER_PROTECTED_ENTRY_PLAN_SCHEMA_VERSION,
        accountBrokerRef: 'broker-A',
        accountIdRef: 'account-A',
        confirmationSnapshotHash: DIGEST_B,
        contractKey: 'TSE:2330:STK:Common',
        contractPricePolicy: {
            categoryCode: '24',
            limitDownMinorUnits: 9000,
            limitUpMinorUnits: 11000,
        },
        modeRevision,
        riskRevision: 'risk-policy-1',
        riskPolicy: {
            schemaVersion:
                SMART_ORDER_PROTECTED_ENTRY_RISK_POLICY_SCHEMA_VERSION,
            policyRevision: 'risk-policy-1',
            buyFeeBps: 0,
            minimumBuyFeeMinorUnits: 0,
            cashBufferMinorUnits: 0,
        },
        basis: {
            source: 'entry_weighted_average_fill',
            previewPrice: '100',
        },
        entryOrder: {
            side: 'Buy',
            orderCond: 'Cash',
            orderLot: 'Common',
            baseShares: 1_000,
            commonLots: 1,
            contractUnit: 1_000,
            priceType: 'LMT',
            timeInForce: 'ROD',
            limitPrice: '100',
        },
        fixedAtrSnapshot: null,
        protection: {
            family: 'fixed',
            legs: [
                {
                    legId: 'stop',
                    type: 'stop',
                    comparator: 'lte',
                    distance: { kind: 'pct_bps', pctBps: 300 },
                    execution: {
                        priceType: 'MKT',
                        timeInForce: 'IOC',
                        limitPrice: null,
                    },
                },
            ],
        },
    };
    const canonicalPlan = canonicalProtectedEntryPlan(plan);
    return canonicalProtectedEntryIntentPayload({
        schemaVersion: SMART_ORDER_PROTECTED_ENTRY_INTENT_SCHEMA_VERSION,
        confirmationSnapshotHash: DIGEST_B,
        entryOrder: plan.entryOrder,
        protectionPlan: plan,
        protectionPlanSha256: canonicalPlan.planSha256,
    }).payload;
}

function protectedEntryControllerBrokerEvent(apiGeneration, overrides = {}) {
    const eventKind = overrides.eventKind ?? 'order';
    const exchangeEpochMs = overrides.exchangeEpochMs ?? 1_786_550_400_300;
    return normalizeCanonicalSmartOrderBrokerEvent({
        schemaVersion: SMART_ORDER_BROKER_EVENT_CANDIDATE_SCHEMA_VERSION,
        mappingRevision: 'gate-0-correlation-mapping/controller-fixture-1',
        apiGeneration,
        eventKind,
        account: {
            brokerId: 'broker-A',
            accountId: 'account-A',
            accountType: 'S',
        },
        tradeDate: overrides.tradeDate ?? '2026-08-13',
        contractKey:
            overrides.contractKey ?? 'TSE:2330:STK:Common',
        side: overrides.side ?? 'Buy',
        identifiers: {
            tradeId:
                overrides.tradeId ?? 'protected-entry-controller-trade-1',
            orderId:
                eventKind === 'order'
                    ? (overrides.orderId ??
                      'protected-entry-controller-order-1')
                    : null,
            dealId: overrides.dealId ?? null,
            seqno:
                overrides.seqno ?? 'protected-entry-controller-seq-1',
            ordno:
                overrides.ordno ?? 'protected-entry-controller-ord-1',
            exchangeSequence: overrides.exchangeSequence ?? null,
            customField: overrides.customField ?? 'PEC001',
        },
        operation:
            eventKind === 'order'
                ? { type: 'New', code: '00', message: null }
                : { type: null, code: null, message: null },
        status: overrides.status ?? 'Submitted',
        orderClass: {
            orderCondition: 'Cash',
            orderLot: 'Common',
            priceType: 'LMT',
            timeInForce: 'ROD',
        },
        quantities: {
            order: overrides.order ?? 1_000,
            cumulativeDeal: overrides.cumulativeDeal ?? 0,
            cumulativeCancel: overrides.cumulativeCancel ?? 0,
            remaining: overrides.remaining ?? 1_000,
            eventDeal: overrides.eventDeal ?? 0,
            unit: 'Share',
        },
        price: '100',
        timestamps: {
            exchangeEpochMs,
            brokerEpochMs: exchangeEpochMs + 1,
            receiveEpochMs: exchangeEpochMs + 2,
        },
    });
}

function protectedExposureHead(policyHash, identityGroupId = 'identity-A') {
    const baseline = {
        quantityShares: 0,
        notionalMinorUnits: 0,
        cashMinorUnits: 0,
        positionShares: 0,
        orderCount: 0,
    };
    const limits = {
        quantityShares: 10_000,
        notionalMinorUnits: 1_000_000_000,
        cashMinorUnits: 1_000_000_000,
        positionShares: 10_000,
        orderCount: 10,
    };
    return {
        accountBrokerRef: 'broker-A',
        accountIdRef: 'account-A',
        accountDailyLossLimitMinorUnits: 1_000_000_000,
        identityGroupId,
        identityDailyLossLimitMinorUnits: 2_000_000_000,
        policyRevision: 'risk-policy-1',
        policyHash,
        sourceRevision: 'exposure-source-1',
        sourceSequence: 1,
        sourceEvidenceHash: DIGEST_A,
        observedAtEpochMs: 1_786_377_599_000,
        validUntilEpochMs: 1_786_377_604_000,
        reservedDimensions: [
            'cashMinorUnits',
            'notionalMinorUnits',
            'orderCount',
            'positionShares',
            'quantityShares',
        ],
        account: { baseline: { ...baseline }, limits: { ...limits } },
        identity: { baseline: { ...baseline }, limits: { ...limits } },
        nowEpochMs: 1_786_377_599_000,
    };
}

function issuedProtectedEntryReconciliation({
    apiGeneration,
    runtimeEpochId,
    asOfEpochMs = 1_786_550_400_500,
    availableShares = 1_000,
    quantityShares = 1_000,
    reconciliationGeneration = 1,
    sourceRevision = 'controller-source-1',
    tradeDate = '2026-08-13',
    positionLineageId = 'position-protected-entry',
    dealIds = ['protected-entry-controller-deal-1'],
    positions = null,
    workingOrders = [],
}) {
    issuedProtectedEntryReconciliation.counter =
        (issuedProtectedEntryReconciliation.counter ?? 0) + 1;
    const evidenceSha256 = `sha256:${issuedProtectedEntryReconciliation.counter
        .toString(16)
        .padStart(64, '0')}`;
    const evidence = Object.freeze({ kind: 'controller-reconciliation-evidence' });
    const verifier = Object.freeze({
        verifySnapshotEvidence(candidate) {
            return Object.freeze({
                evidenceSha256,
                valid: candidate === evidence,
            });
        },
    });
    reconciliationAuthority.verifiers.add(verifier);
    const coordinator = createSmartOrderAccountReconciliationCoordinator({
        apiGeneration,
        connectionId: 'controller-trade-connection-1',
        nowMonotonicMs: () => 1,
        runtimeEpochId,
        tradeDate,
        verifier,
    });
    const handle = coordinator.runtime.acquire({
        account: {
            brokerId: 'broker-A',
            accountId: 'account-A',
            accountType: 'S',
        },
        consumerId: 'runtime-controller-integration',
    });
    const [plan] = coordinator.observer.pendingPlans();
    const result = coordinator.runtime.submit(
        plan,
        {
            account: {
                brokerId: 'broker-A',
                accountId: 'account-A',
                accountType: 'S',
            },
            apiGeneration,
            asOfEpochMs,
            connectionId: 'controller-trade-connection-1',
            deals: dealIds.map((dealId) =>
                ({
                    dealId,
                    feeMinorUnits: 0,
                    realizedMinorUnits: 0,
                    transactionTaxMinorUnits: 0,
                }),
            ),
            eventStreamWatermarkSha256: DIGEST_A,
            fullDayDealsComplete: true,
            fullDayFeesComplete: true,
            fullDayTaxesComplete: true,
            includesExternalClientActivity: true,
            includesPreRuntimeActivity: true,
            positions:
                positions ??
                [
                    {
                        averagePriceMinorUnits: 10_000,
                        availableShares,
                        contractKey: 'TSE:2330:STK:Common',
                        lastPriceMinorUnits: 10_100,
                        positionLineageId,
                        quantityShares,
                        unrealizedMinorUnits: 100_000,
                        yesterdayQuantityShares: quantityShares,
                    },
                ],
            pnlPolicyDefinitionSha256:
                SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
            pnlPolicyRevision: SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
            reconciliationGeneration,
            runtimeEpochId,
            sourceRevision,
            tradeDate,
            workingOrders,
            workingOrderSetComplete: true,
        },
        evidence,
    );
    expect(handle.handleClass).toBe('fixed_account_reconciliation');
    expect(result.allowed).toBe(true);
    return result;
}

function continuityEnvelope(controller, {
    signalSha256,
    reasonCodes,
    nowEpochMs,
}) {
    return {
        schemaVersion: SMART_ORDER_RUNTIME_GAP_INVALIDATION_SCHEMA_VERSION,
        runtimeEpochIdSha256: controller.runtimeEpochIdSha256,
        signalSha256,
        reasonCodes,
        nowEpochMs,
    };
}

function controllerGateProbeEnvelope(nowEpochMs) {
    const account = {
        broker_id: 'broker-probe-controller',
        account_id: 'account-probe-controller',
        account_type: 'S',
    };
    return {
        schemaVersion: SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
        runId: '123e4567-e89b-42d3-a456-426614174090',
        operationId: '123e4567-e89b-42d3-a456-426614174091',
        nonce: '123e4567-e89b-42d3-a456-426614174092',
        request: {
            schemaVersion:
                'smart-order-manual-broker-write-request/2026-08-14.1',
            operation: 'place',
            brokerPath: '/api/v1/order/place_order',
            payload: {
                contract: {
                    security_type: 'STK',
                    region: 'TW',
                    exchange: 'TSE',
                    code: '2330',
                    target_code: null,
                },
                stock_order: {
                    action: 'Buy',
                    price: 100,
                    quantity: 1,
                    price_type: 'LMT',
                    order_type: 'ROD',
                    order_lot: 'Common',
                    account,
                },
            },
        },
        target: null,
        tradeDate: '2026-08-20',
        confirmation: {
            accountScopeSha256:
                smartOrderGateProbeAccountScopeSha256(account),
            confirmed: true,
            expectedOperation: 'place',
            maximumCommonLots: 1,
            simulation: true,
        },
        validUntilEpochMs: nowEpochMs + 30_000,
    };
}

afterEach(async () => {
    vi.restoreAllMocks();
    for (const entry of [...openControllers]) {
        try {
            await entry.controller.stop({ nowEpochMs: entry.stopAtEpochMs });
        } catch {
            // The individual test remains authoritative; cleanup continues.
        } finally {
            openControllers.delete(entry);
        }
    }
    await Promise.all(
        temporaryRoots.splice(0).map((root) =>
            rm(root, { recursive: true, force: true }),
        ),
    );
});

async function privateRoot() {
    const root = await mkdtemp(path.join(tmpdir(), 'smart-order-controller-'));
    temporaryRoots.push(root);
    await chmod(root, 0o700);
    return root;
}

function issuedProtectiveQuoteObservation({
    apiGeneration = 'api-generation-protective-quote-controller',
    connectionId = 'quote-connection-controller',
    eventDate = '2026-08-13',
    eventTime = '09:01:02.123456',
    nowEpochMs = Date.parse('2026-08-13T09:01:02.123+08:00'),
    sequence = 1,
    close = '105',
} = {}) {
    const resourceCoordinator = Object.freeze({
        reserveSubscriptionDemand(input) {
            return Object.freeze({
                allowed: true,
                brokerAuthority: false,
                countingDimension: input.countingDimension,
                demandId: input.demandId,
                projectedUsageUnits: 1,
                release() {},
                units: input.units,
            });
        },
        status() {
            return Object.freeze({
                brokerAuthority: false,
                closed: false,
                subscriptionCountingDimension:
                    'verified-subscription-item/v1',
                subscriptionEvidenceCurrent: true,
                writeMasterAuthority: false,
            });
        },
    });
    const coordinator = createSmartOrderQuoteSubscriptionCoordinator({
        apiGeneration,
        connectionId,
        nowMonotonicMs: () => nowEpochMs,
        resourceCoordinator,
        resourceCountingDimension: 'verified-subscription-item/v1',
    });
    coordinator.runtime.acquireDemand({
        consumerId: 'runtime-protective-trigger-controller',
        contract: {
            code: '2330',
            exchange: 'TSE',
            securityType: 'STK',
        },
        quoteType: 'tick',
    });
    const plan = coordinator.observer.pendingPlans()[0];
    const confirmation = coordinator.runtime.confirmPlan(plan, {
        action: plan.action,
        apiGeneration: plan.apiGeneration,
        connectionId: plan.connectionId,
        planId: plan.planId,
    });
    const mapped = normalizeSmartOrderQuickFieldEvent({
        contractKey: 'TSE:STK:2330',
        event: {
            eventKind: 'tick',
            code: '2330',
            date: eventDate,
            time: eventTime,
            close,
            volume: 1,
            totalVolume: 10,
            priceChange: '5',
            percentChange: 500,
            simtrade: false,
            intradayOdd: false,
        },
        receiveTimeMs: nowEpochMs,
        sequence,
        streamEpoch: connectionId,
    });
    return coordinator.runtime.recordMappedObservation(
        confirmation.streamAuthority,
        mapped,
    );
}

function seedEligibleProtectedEntryGate(databasePath, nowEpochMs) {
    const database = new DatabaseSync(databasePath);
    database.prepare(`
        DELETE FROM gate_manifests
         WHERE provenance IN ('automation','manual_user_confirmed')
    `).run();
    database.prepare(`
        INSERT INTO gate_manifests(
            manifest_id, manifest_revision, manifest_sha256,
            schema_version, provenance, manifest_json,
            fingerprints_sha256, evidence_catalog_sha256,
            feature_gates_sha256, product_boundary_consent_version,
            state, valid_until_epoch_ms, created_at_epoch_ms, revision
        ) VALUES (
            'automation-protection-gate', 'automation-protection-r1', ?,
            'smart-order-gate-manifest/2026-08-11.1', 'automation', ?,
            ?, ?, ?, 'local-sidecar-consent/v1', 'eligible', ?, ?, 0
        )
    `).run(
        `sha256:${'c'.repeat(64)}`,
        JSON.stringify({
            evidence: [],
            featureGates: {
                good_till: false,
                multi_condition: false,
                parent_child: false,
                quick: false,
                scheduled_quantity: false,
                stop_take: true,
                trailing_exit: true,
            },
            fingerprints: { mappingRevision: 'mapping-r1' },
        }),
        DIGEST_A,
        DIGEST_B,
        `sha256:${'d'.repeat(64)}`,
        nowEpochMs + 300_000,
        nowEpochMs,
    );
    database.prepare(`
        INSERT INTO gate_manifests(
            manifest_id, manifest_revision, manifest_sha256,
            schema_version, provenance, manifest_json,
            fingerprints_sha256, evidence_catalog_sha256,
            feature_gates_sha256, product_boundary_consent_version,
            state, valid_until_epoch_ms, created_at_epoch_ms, revision
        ) VALUES (
            'manual-protection-gate', 'manual-protection-r1', ?,
            'smart-order-gate-manifest/2026-08-11.1',
            'manual_user_confirmed', ?, ?, ?, ?,
            'local-sidecar-consent/v1', 'eligible', ?, ?, 0
        )
    `).run(
        `sha256:${'e'.repeat(64)}`,
        JSON.stringify({
            evidence: [],
            featureGates: {
                good_till: false,
                multi_condition: false,
                parent_child: false,
                quick: false,
                scheduled_quantity: false,
                stop_take: true,
                trailing_exit: true,
            },
            fingerprints: { mappingRevision: 'mapping-r1' },
        }),
        DIGEST_A,
        DIGEST_B,
        `sha256:${'f'.repeat(64)}`,
        nowEpochMs + 300_000,
        nowEpochMs,
    );
    database.close();
}

function seedManualResolutionControllerFixture(databasePath, {
    apiGeneration,
    nowEpochMs,
    runtimeEpochId,
    senderFence,
}) {
    const correlationKeyHash = `sha256:${createHash('sha256')
        .update(
            [
                'broker-A',
                'account-A',
                '2026-08-20',
                'TSE:2330:STK:Common',
                'Buy',
                'trade-manual-controller',
                'order-manual-controller',
                'deal-manual-controller',
                'seq-manual-controller',
                'ord-manual-controller',
                'exchange-manual-controller',
            ].join('\u001f'),
        )
        .digest('hex')}`;
    const database = new DatabaseSync(databasePath);
    database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=2500; BEGIN IMMEDIATE;');
    try {
        database.prepare(`
            INSERT INTO strategies(
                strategy_id, strategy_kind, state, definition_hash,
                definition_json, account_broker_ref, account_id_ref,
                identity_group_id, confirmation_snapshot_hash,
                created_at_epoch_ms, updated_at_epoch_ms,
                terminal_at_epoch_ms, revision
            ) VALUES (
                'strategy-manual-controller', 'quick',
                'manual_intervention', ?,
                '{"kind":"quick","schemaVersion":"strategy/1"}',
                'broker-A', 'account-A', 'identity-A', ?,
                ?, ?, NULL, 0
            )
        `).run(DIGEST_A, DIGEST_B, nowEpochMs - 2_000, nowEpochMs - 2_000);
        database.prepare(`
            INSERT INTO activations(
                activation_id, strategy_id, logical_key, state, generation,
                evidence_hash, created_at_epoch_ms, updated_at_epoch_ms,
                revision
            ) VALUES (
                'activation-manual-controller',
                'strategy-manual-controller', 'manual-edge', 'unknown', 1,
                ?, ?, ?, 0
            )
        `).run(DIGEST_A, nowEpochMs - 1_900, nowEpochMs - 1_900);
        database.prepare(`
            INSERT INTO order_intents(
                intent_id, activation_id, strategy_id, operation_kind,
                owner_kind, state, terminal_outcome, payload_hash,
                payload_json, client_request_id, account_broker_ref,
                account_id_ref, trade_date, contract_key, side,
                runtime_epoch_id, sender_fence, api_generation,
                adapter_authority_granted, created_at_epoch_ms,
                updated_at_epoch_ms, revision
            ) VALUES (
                'intent-manual-controller',
                'activation-manual-controller',
                'strategy-manual-controller', 'place', 'activation',
                'unknown', NULL, ?,
                '{"kind":"manual-resolution-fixture"}',
                'request-manual-controller', 'broker-A', 'account-A',
                '2026-08-20', 'TSE:2330:STK:Common', 'Buy', ?, ?, ?, 1,
                ?, ?, 0
            )
        `).run(
            DIGEST_A,
            runtimeEpochId,
            senderFence,
            apiGeneration,
            nowEpochMs - 1_800,
            nowEpochMs - 1_800,
        );
        database.prepare(`
            INSERT INTO broker_orders(
                broker_order_id, intent_id, state, control_revision,
                quantity_shares, filled_shares, remaining_shares,
                evidence_hash, updated_at_epoch_ms,
                terminal_at_epoch_ms, revision
            ) VALUES (
                'broker-order-manual-controller',
                'intent-manual-controller', 'filled', 0,
                1000, 1000, 0, ?, ?, ?, 0
            )
        `).run(DIGEST_B, nowEpochMs - 1_500, nowEpochMs - 1_500);
        database.prepare(`
            INSERT INTO broker_correlations(
                correlation_id, intent_id, broker_order_id,
                canonical_key_hash, account_broker_ref, account_id_ref,
                trade_date, contract_key, side, trade_id, order_id,
                deal_id, seqno, ordno, exchange_sequence, custom_field,
                evidence_hash, created_at_epoch_ms, revision
            ) VALUES (
                'correlation-manual-controller',
                'intent-manual-controller',
                'broker-order-manual-controller', ?, 'broker-A',
                'account-A', '2026-08-20', 'TSE:2330:STK:Common', 'Buy',
                'trade-manual-controller', 'order-manual-controller',
                'deal-manual-controller', 'seq-manual-controller',
                'ord-manual-controller', 'exchange-manual-controller',
                NULL, ?, ?, 0
            )
        `).run(correlationKeyHash, DIGEST_A, nowEpochMs - 1_500);
        database.prepare(`
            INSERT INTO broker_event_records(
                broker_event_key_hash,
                broker_order_correlation_key_hash, intent_id,
                mapping_revision, api_generation, event_kind,
                account_broker_ref, account_id_ref, trade_date,
                contract_key, side, trade_id, order_id, deal_id,
                seqno, ordno, exchange_sequence, custom_field,
                operation_type, operation_code, operation_message,
                status, order_condition, order_lot, price_type,
                time_in_force, order_quantity,
                cumulative_deal_quantity, cumulative_cancel_quantity,
                remaining_quantity, event_deal_quantity, quantity_unit,
                price_decimal, exchange_epoch_ms, broker_epoch_ms,
                receive_epoch_ms, evidence_hash, payload_hash
            ) VALUES (
                ?, ?, 'intent-manual-controller', 'mapping/controller-1',
                ?, 'deal', 'broker-A', 'account-A', '2026-08-20',
                'TSE:2330:STK:Common', 'Buy',
                'trade-manual-controller', 'order-manual-controller',
                'deal-manual-controller', 'seq-manual-controller',
                'ord-manual-controller', 'exchange-manual-controller',
                NULL, NULL, NULL, NULL, 'Filled', 'Cash', 'Common',
                'LMT', 'ROD', 1000, 1000, 0, 0, 1000, 'Share',
                '100.00', ?, ?, ?, ?, ?
            )
        `).run(
            DIGEST_B,
            correlationKeyHash,
            apiGeneration,
            nowEpochMs - 1_000,
            nowEpochMs - 1_000,
            nowEpochMs - 1_000,
            DIGEST_B,
            DIGEST_A,
        );
        database.prepare(`
            INSERT INTO broker_event_heads(
                account_broker_ref, account_id_ref, trade_date,
                broker_order_correlation_key_hash, intent_id, status,
                order_quantity, cumulative_deal_quantity,
                cumulative_cancel_quantity, remaining_quantity,
                quantity_unit, exchange_epoch_ms,
                broker_event_key_hash, evidence_hash, revision
            ) VALUES (
                'broker-A', 'account-A', '2026-08-20', ?,
                'intent-manual-controller', 'Filled', 1000, 1000, 0, 0,
                'Share', ?, ?, ?, 0
            )
        `).run(correlationKeyHash, nowEpochMs - 1_000, DIGEST_B, DIGEST_B);
        database.prepare(`
            INSERT INTO account_reconciliation_heads(
                account_broker_ref, account_id_ref, trade_date,
                as_of_epoch_ms, source_revision,
                source_snapshot_hash, snapshot_hash, evidence_hash,
                event_stream_watermark_hash,
                exposure_baseline_quantity_shares,
                exposure_baseline_notional_minor_units,
                exposure_baseline_cash_minor_units,
                exposure_baseline_position_shares,
                exposure_baseline_order_count,
                exposure_baseline_valuation_complete,
                updated_at_epoch_ms, revision
            ) VALUES (
                'broker-A', 'account-A', '2026-08-20', ?,
                'reconciliation/controller-1', ?, ?, ?, ?,
                0, 0, 0, 0, 0, 1, ?, 0
            )
        `).run(
            nowEpochMs - 500,
            DIGEST_A,
            DIGEST_A,
            DIGEST_B,
            DIGEST_B,
            nowEpochMs - 500,
        );
        database.prepare(`
            INSERT INTO resolution_cases(
                resolution_case_id, strategy_id, reason_code, scope_hash,
                evidence_snapshot_hash, state, created_at_epoch_ms,
                updated_at_epoch_ms, terminal_at_epoch_ms, revision
            ) VALUES (
                'resolution-manual-controller',
                'strategy-manual-controller', 'BROKER_OUTCOME_UNKNOWN',
                ?, ?, 'open', ?, ?, NULL, 0
            )
        `).run(DIGEST_A, DIGEST_B, nowEpochMs - 900, nowEpochMs - 900);
        database.prepare(`
            INSERT INTO safety_blockers(
                blocker_id, resolution_case_id, scope_hash, reason_code,
                state, created_at_epoch_ms, resolved_at_epoch_ms, revision
            ) VALUES (
                'blocker-manual-controller',
                'resolution-manual-controller', ?,
                'BROKER_OUTCOME_UNKNOWN', 'open', ?, NULL, 0
            )
        `).run(DIGEST_A, nowEpochMs - 900);
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    } finally {
        database.close();
    }
}

describe('smart-order runtime controller', () => {
    it('wires the production adapter to the dedicated mode-execution lease directory', async () => {
        const source = await readFile(controllerSourcePath, 'utf8');
        const construction = source.match(
            /createProductionNodeSafeSmartOrderBrokerAdapter\(\{([\s\S]*?)\n\s*\}\)/,
        )?.[1];
        expect(construction).toContain(
            'leaseDirectory: storage.paths.modeExecutionLeaseDirectory',
        );
        expect(construction).not.toContain(
            'leaseDirectory: storage.paths.runtimeLeaseDirectory',
        );
    });

    it('rejects a structurally valid but non-Gate-runner-issued manifest at the production controller boundary', async () => {
        const appSupportRoot = await privateRoot();
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-gate-runner-boundary',
            nowEpochMs: 1_786_377_600_000,
            runtimeEpochId: 'runtime-gate-runner-boundary',
            senderFence: 'fence-gate-runner-boundary',
        });
        openControllers.add({
            controller,
            stopAtEpochMs: 1_786_377_601_000,
        });
        await expect(
            controller.storeGateManifest({
                manifest: Object.freeze({
                    manifestSha256: DIGEST_A,
                    state: 'observe_only',
                }),
                nowEpochMs: 1_786_377_600_100,
            }),
        ).rejects.toThrow(
            'single Gate manifest storage is disabled',
        );
        expect(controller.status()).toMatchObject({
            dispatchAllowed: false,
        });
    });

    it('admits only a coordinator-issued protective quote observation through the current primary controller', async () => {
        const appSupportRoot = await privateRoot();
        const nowEpochMs = Date.parse('2026-08-13T09:01:02.123+08:00');
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-protective-quote-controller',
            nowEpochMs,
            runtimeEpochId: 'runtime-protective-quote-controller',
            senderFence: 'fence-protective-quote-controller',
        });
        openControllers.add({
            controller,
            stopAtEpochMs: nowEpochMs + 1_000,
        });
        await controller.markReady({ reconciliationEvidenceHash: DIGEST_A });
        await expect(controller.listProtectiveQuoteDemands()).resolves.toEqual(
            [],
        );
        const observation = issuedProtectiveQuoteObservation();
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowEpochMs);
        await expect(
            controller.recordProtectiveQuoteObservation({ observation }),
        ).resolves.toMatchObject({
            state: 'observed',
            observedGroupCount: 0,
            preparedWinnerCount: 0,
            brokerWriteAuthority: false,
            automaticDispatchAllowed: false,
        });
        await expect(
            controller.recordProtectiveQuoteObservation({
                observation: { ...observation },
            }),
        ).rejects.toThrow('authority is invalid');
        let accessorReads = 0;
        await expect(
            controller.recordProtectiveQuoteObservation({
                get observation() {
                    accessorReads += 1;
                    return observation;
                },
            }),
        ).rejects.toThrow('own data propert');
        expect(accessorReads).toBe(0);
        await expect(
            controller.recordProtectiveQuoteObservation(
                new Proxy(
                    { observation },
                    {
                        ownKeys() {
                            throw new Error('proxy trap must not run');
                        },
                    },
                ),
            ),
        ).rejects.toThrow('schema is invalid');
        nowSpy.mockReturnValue(nowEpochMs + 3_001);
        await expect(
            controller.recordProtectiveQuoteObservation({ observation }),
        ).rejects.toThrow('expired before Runtime admission');
        expect(controller.status()).toMatchObject({
            state: 'reconciling',
            dispatchAllowed: false,
        });
        nowSpy.mockRestore();
    });

    it('keeps the production Gate probe path off-wire until a current eligible probe manifest exists', async () => {
        const appSupportRoot = await privateRoot();
        const nowEpochMs = 1_787_200_000_000;
        const gateProbeControlPlaneAuthority = Object.freeze({});
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-gate-probe-controller',
            gateProbeControlPlaneAuthority,
            nowEpochMs,
            runtimeEpochId: 'runtime-gate-probe-controller',
            senderFence: 'fence-gate-probe-controller',
        });
        openControllers.add({
            controller,
            stopAtEpochMs: nowEpochMs + 90_000,
        });
        await controller.markReady({ reconciliationEvidenceHash: DIGEST_A });

        await expect(
            controller.prepareGateProbeSafetyEnvelope({
                cliAuthorizationSha256: `sha256:${'8'.repeat(64)}`,
                controlPlaneAuthority: null,
                envelope: controllerGateProbeEnvelope(nowEpochMs),
                nowEpochMs,
            }),
        ).rejects.toThrow('private control-plane authority');
        await expect(
            controller.prepareGateProbeSafetyEnvelope({
                cliAuthorizationSha256: `sha256:${'8'.repeat(64)}`,
                controlPlaneAuthority: {
                    ...gateProbeControlPlaneAuthority,
                },
                envelope: controllerGateProbeEnvelope(nowEpochMs),
                nowEpochMs,
            }),
        ).rejects.toThrow('private control-plane authority');
        await expect(
            controller.prepareGateProbeSafetyEnvelope({
                cliAuthorizationSha256: `sha256:${'8'.repeat(64)}`,
                controlPlaneAuthority: gateProbeControlPlaneAuthority,
                envelope: controllerGateProbeEnvelope(nowEpochMs),
                nowEpochMs,
            }),
        ).resolves.toMatchObject({
            prepared: false,
            state: 'observe_only',
            reason: 'gate_probe_manifest_not_eligible',
            automaticRetryAllowed: false,
            cleanupAllowed: false,
            brokerWriteAttempted: false,
            adapterAuthorityGranted: false,
            brokerAuthority: false,
            writeMasterAuthority: false,
        });
        await expect(controller.gateProbeSafetyStatus()).resolves.toMatchObject({
            state: 'idle',
            unknownOperationCount: 0,
            unresolvedOperationCount: 0,
            terminalOperationCount: 0,
            activeTargetCount: 0,
            durableReplayProtection: true,
            brokerWriteAttempted: false,
            adapterAuthorityGranted: false,
            brokerAuthority: false,
            writeMasterAuthority: false,
        });

        const database = new DatabaseSync(
            path.join(
                appSupportRoot,
                'smart-order',
                'database',
                'smart-orders.sqlite3',
            ),
            { readOnly: true },
        );
        expect(
            database
                .prepare(`
                    SELECT COUNT(*) AS count FROM authority_consumptions
                     WHERE authority_kind='gate_probe_nonce'
                `)
                .get(),
        ).toEqual({ count: 0 });
        database.close();
    });

    it('blocks an OCO exit behind a working-entry cancel and prepares the winner only after bounded reconciliation', async () => {
        const appSupportRoot = await privateRoot();
        const generation = 'api-generation-oco-controller';
        const entryPayload = canonicalProtectedEntryIntentPayload(
            protectedEntryPayload(generation),
        );
        const plan = canonicalProtectedEntryPlan(
            entryPayload.payload.protectionPlan,
        );
        const authenticatedIdentityEvidence = Object.freeze({
            accountScopes: Object.freeze([
                Object.freeze({
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                }),
            ]),
            canonicalPrincipal: 'test-only-oco-canonical-principal',
            mappingRevision: 'identity-mapping/oco-1',
            principalEvidenceHash: DIGEST_A,
        });
        identityAuthority.evidence.add(authenticatedIdentityEvidence);
        const preparedStorage = await prepareSmartOrderPrivateStorage({
            appSupportRoot,
        });
        const identityKey = await readPrivateSecret(
            preparedStorage.paths.identityKeyPath,
        );
        const identityGroupId = `hmac-sha256:${createHmac(
            'sha256',
            identityKey,
        )
            .update(authenticatedIdentityEvidence.canonicalPrincipal)
            .digest('hex')}`;
        identityKey.fill(0);
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: generation,
            nowEpochMs: 1_786_377_600_000,
            runtimeEpochId: 'runtime-oco-controller',
            senderFence: 'fence-oco-controller',
            repositoryOptions: {
                testOnlyExposureArbiterHeads: [
                    protectedExposureHead(
                        plan.riskPolicyHash,
                        identityGroupId,
                    ),
                ],
                testOnlyExposureClockNowEpochMs: 1_786_377_600_300,
            },
        });
        openControllers.add({
            controller,
            stopAtEpochMs: 1_786_377_601_000,
        });
        expect(
            controller.acceptAuthenticatedIdentityEvidence(
                authenticatedIdentityEvidence,
            ),
        ).toMatchObject({
            state: 'authenticated',
            fixedAccountCount: 1,
            rawPrincipalExposed: false,
        });
        await controller.markReady({ reconciliationEvidenceHash: DIGEST_A });
        const exitClaimId = `exit-claim:${createHash('sha256')
            .update(
                JSON.stringify([
                    'entry-intent-oco-controller',
                    'obligation-oco-controller',
                    plan.planSha256,
                ]),
            )
            .digest('hex')}`;
        const protectionGroupId = `protection-group:${createHash('sha256')
            .update(JSON.stringify(exitClaimId))
            .digest('hex')}`;
        const emptyWorkingSetHash = `sha256:${createHash('sha256')
            .update(JSON.stringify({ claims: [] }))
            .digest('hex')}`;
        const database = new DatabaseSync(
            path.join(
                appSupportRoot,
                'smart-order',
                'database',
                'smart-orders.sqlite3',
            ),
        );
        database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=2500;');
        database.prepare(`
            INSERT INTO strategies(
                strategy_id, strategy_kind, state, definition_hash,
                definition_json, account_broker_ref, account_id_ref,
                identity_group_id, confirmation_snapshot_hash,
                created_at_epoch_ms, updated_at_epoch_ms,
                terminal_at_epoch_ms, revision
            ) VALUES (
                'strategy-oco-controller', 'stop_take', 'monitoring', ?,
                '{"kind":"stop_take","schemaVersion":"strategy/1"}',
                'broker-A', 'account-A', ?, ?,
                1786377600100, 1786377600100, NULL, 0
            )
        `).run(DIGEST_A, identityGroupId, DIGEST_B);
        database.prepare(`
            INSERT INTO activations(
                activation_id, strategy_id, logical_key, state, generation,
                evidence_hash, created_at_epoch_ms, updated_at_epoch_ms,
                revision
            ) VALUES (
                'entry-activation-oco-controller', 'strategy-oco-controller',
                'entry-edge', 'part_filled', 0, ?, 1786377600100,
                1786377600100, 0
            )
        `).run(DIGEST_A);
        database.prepare(`
            INSERT INTO order_intents(
                intent_id, activation_id, strategy_id, operation_kind,
                owner_kind, state, terminal_outcome, payload_hash,
                payload_json, client_request_id, account_broker_ref,
                account_id_ref, trade_date, contract_key, side,
                runtime_epoch_id, sender_fence, api_generation,
                mode_revision, risk_revision, account_revision,
                target_revision, adapter_authority_granted, created_at_epoch_ms,
                updated_at_epoch_ms, terminal_at_epoch_ms, revision
            ) VALUES (
                'entry-intent-oco-controller',
                'entry-activation-oco-controller', 'strategy-oco-controller',
                'place', 'activation', 'acknowledged', NULL, ?, ?,
                'entry-request-oco-controller', 'broker-A', 'account-A',
                '2026-08-11', 'TSE:2330:STK:Common', 'Buy',
                'runtime-oco-controller', 'fence-oco-controller', ?, ?,
                'risk-policy/1', 'account-reconciliation/1',
                'entry-target/1', 1, 1786377600100, 1786377600100,
                NULL, 0
            )
        `).run(
            entryPayload.payloadSha256,
            entryPayload.payloadJson,
            generation,
            generation,
        );
        database.prepare(`
            INSERT INTO broker_orders(
                broker_order_id, intent_id, state, control_revision,
                quantity_shares, filled_shares, remaining_shares,
                evidence_hash, updated_at_epoch_ms, terminal_at_epoch_ms,
                revision
            ) VALUES (
                'entry-order-oco-controller', 'entry-intent-oco-controller',
                'part_filled', 0, 1000, 500, 500, ?, 1786377600100,
                NULL, 0
            )
        `).run(DIGEST_A);
        const entryCorrelationHash = `sha256:${createHash('sha256')
            .update(
                [
                    'broker-A',
                    'account-A',
                    '2026-08-11',
                    'TSE:2330:STK:Common',
                    'Buy',
                    'entry-trade-controller',
                    'entry-order-controller',
                    '',
                    'entry-seq-controller',
                    'entry-ord-controller',
                    'entry-exchange-controller',
                ].join('\u001f'),
            )
            .digest('hex')}`;
        database.prepare(`
            INSERT INTO broker_correlations(
                correlation_id, intent_id, broker_order_id,
                canonical_key_hash, account_broker_ref, account_id_ref,
                trade_date, contract_key, side, trade_id, order_id, deal_id,
                seqno, ordno, exchange_sequence, custom_field, evidence_hash,
                created_at_epoch_ms, revision
            ) VALUES (
                'entry-correlation-oco-controller',
                'entry-intent-oco-controller', 'entry-order-oco-controller',
                ?, 'broker-A', 'account-A', '2026-08-11',
                'TSE:2330:STK:Common', 'Buy', 'entry-trade-controller',
                'entry-order-controller', NULL, 'entry-seq-controller',
                'entry-ord-controller', 'entry-exchange-controller', NULL,
                ?, 1786377600100, 0
            )
        `).run(entryCorrelationHash, DIGEST_B);
        const insertEntryIdentifier = database.prepare(`
            INSERT INTO broker_correlation_identifiers(
                account_broker_ref, account_id_ref, trade_date,
                contract_key, side, identifier_kind, identifier_value,
                intent_id, correlation_id, created_at_epoch_ms
            ) VALUES (
                'broker-A', 'account-A', '2026-08-11',
                'TSE:2330:STK:Common', 'Buy', ?, ?,
                'entry-intent-oco-controller',
                'entry-correlation-oco-controller', 1786377600100
            )
        `);
        for (const [kind, value] of [
            ['tradeId', 'entry-trade-controller'],
            ['orderId', 'entry-order-controller'],
            ['seqno', 'entry-seq-controller'],
            ['ordno', 'entry-ord-controller'],
            ['exchangeSequence', 'entry-exchange-controller'],
        ]) {
            insertEntryIdentifier.run(kind, value);
        }
        database.exec(`
            INSERT INTO pending_protection_commitments(
                commitment_id, strategy_id, entry_intent_id, state,
                committed_shares, materialized_shares,
                created_at_epoch_ms, updated_at_epoch_ms, revision
            ) VALUES (
                'commitment-oco-controller', 'strategy-oco-controller',
                'entry-intent-oco-controller', 'materialized', 1000, 500,
                1786377600100, 1786377600100, 0
            );
            INSERT INTO protection_obligations(
                obligation_id, strategy_id, commitment_id, state,
                position_lineage_id, filled_shares,
                confirmed_exited_shares, created_at_epoch_ms,
                updated_at_epoch_ms, terminal_at_epoch_ms, revision
            ) VALUES (
                'obligation-oco-controller', 'strategy-oco-controller',
                'commitment-oco-controller', 'monitoring',
                'position-oco-controller', 500, 0, 1786377600100,
                1786377600100, NULL, 0
            );
        `);
        database.prepare(`
            INSERT INTO entry_exposure_reservations(
                reservation_id, strategy_id, intent_id,
                account_broker_ref, account_id_ref, identity_group_id,
                policy_revision, policy_hash, state, quantity_shares,
                notional_minor_units, cash_minor_units, position_shares,
                order_count, created_at_epoch_ms, updated_at_epoch_ms,
                terminal_at_epoch_ms, revision
            ) VALUES (
                'reservation-oco-controller', 'strategy-oco-controller',
                'entry-intent-oco-controller', 'broker-A', 'account-A',
                ?, 'risk-policy/1', ?, 'partially_consumed',
                500, 5000000, 5000000, 500, 1,
                1786377600100, 1786377600100, NULL, 0
            )
        `).run(identityGroupId, plan.riskPolicyHash);
        database.prepare(`
            INSERT INTO exit_claims(
                exit_claim_id, obligation_id, intent_id, external_lineage,
                account_broker_ref, account_id_ref, contract_key,
                position_lineage_id, remainder_generation,
                allocation_start_share, quantity_shares, state,
                evidence_hash, created_at_epoch_ms, updated_at_epoch_ms,
                terminal_at_epoch_ms, revision
            ) VALUES (
                ?, 'obligation-oco-controller',
                NULL, 0, 'broker-A', 'account-A',
                'TSE:2330:STK:Common', 'position-oco-controller', 0, 0,
                500, 'monitoring_reserved', ?, 1786377600100,
                1786377600100, NULL, 0
            )
        `).run(exitClaimId, DIGEST_A);
        database.prepare(`
            INSERT INTO protection_groups(
                protection_group_id, obligation_id, exit_claim_id, state,
                current_generation, plan_hash, created_at_epoch_ms,
                updated_at_epoch_ms, terminal_at_epoch_ms, revision
            ) VALUES (
                ?, 'obligation-oco-controller', ?,
                'monitoring', 0, ?, 1786377600100, 1786377600100, NULL, 0
            )
        `).run(protectionGroupId, exitClaimId, plan.planSha256);
        database.prepare(`
            INSERT INTO protection_remainder_generations(
                protection_group_id, remainder_generation, exit_claim_id,
                state, quantity_shares, winner_leg_id,
                winner_activation_id, winner_intent_id, evidence_hash,
                created_at_epoch_ms, updated_at_epoch_ms,
                terminal_at_epoch_ms, revision
            ) VALUES (
                ?, 0, ?, 'monitoring', 500,
                NULL, NULL, NULL, ?, 1786377600100, 1786377600100,
                NULL, 0
            )
        `).run(protectionGroupId, exitClaimId, DIGEST_A);
        database.prepare(`
            INSERT INTO external_sell_visibility_heads(
                account_broker_ref, account_id_ref, trade_date, contract_key,
                source_revision, source_sequence, source_evidence_hash,
                position_revision, position_shares, working_set_hash,
                collection_complete, observed_at_epoch_ms,
                valid_until_epoch_ms, updated_at_epoch_ms, revision
            ) VALUES (
                'broker-A', 'account-A', '2026-08-11',
                'TSE:2330:STK:Common', 'visibility/1', 1, ?,
                'position/1', 500, ?, 1, 1786377600100,
                1786377601000, 1786377600100, 0
            )
        `).run(DIGEST_A, emptyWorkingSetHash);
        database.close();

        const protectiveProjection =
            buildSmartOrderProtectiveBrokerIntentPayload({
                legId: 'stop',
                protectionPlan: plan.plan,
                quantityShares: 500,
                triggerPolicyHash: DIGEST_B,
            });
        const payload = protectiveProjection.payload;
        const request = {
            strategyId: 'strategy-oco-controller',
            nowEpochMs: 1_786_377_600_200,
            activation: {
                activationId: 'activation-oco-controller',
                logicalKey: 'stop-edge',
                generation: 0,
                evidenceHash: DIGEST_B,
            },
            intent: {
                intentId: 'intent-oco-controller',
                operationKind: 'place',
                ownerKind: 'activation',
                payload,
                payloadHash: protectiveProjection.payloadSha256,
                clientRequestId: 'request-oco-controller',
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                tradeDate: '2026-08-11',
                contractKey: 'TSE:2330:STK:Common',
                side: 'Sell',
            },
            exitClaim: {
                exitClaimId,
                obligationId: 'obligation-oco-controller',
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                contractKey: 'TSE:2330:STK:Common',
                positionLineageId: 'position-oco-controller',
                remainderGeneration: 0,
                allocationStartShare: 0,
                quantityShares: 500,
                expectedRevision: 0,
                evidenceHash: DIGEST_B,
                protectionGroupId,
                expectedGroupRevision: 0,
                expectedGenerationRevision: 0,
                candidateEvaluations: [
                    {
                        legId: 'stop',
                        evidenceHash: DIGEST_B,
                        observedAtEpochMs: 1_786_377_600_200,
                    },
                ],
            },
        };
        await expect(
            controller.prepareProtectionOcoWinner({
                ...request,
                intent: {
                    ...request.intent,
                    payload: {
                        schemaVersion:
                            'smart-order-protective-broker-intent/2026-08-12.1',
                        quantityShares: 500,
                    },
                },
            }),
        ).rejects.toThrow('protective broker intent payload is invalid');
        const cancellation = await controller.prepareProtectionOcoWinner(
            request,
        );
        expect(cancellation).toMatchObject({
            entryDisposition: 'entry_cancel_prepared',
            automaticExitAllowed: false,
            cancelTargetBrokerOrderId: 'entry-order-oco-controller',
            adapterAuthorityGranted: false,
            brokerWriteAuthority: false,
        });
        const terminalDealEvent = protectedEntryControllerBrokerEvent(
            generation,
            {
                tradeDate: '2026-08-11',
                eventKind: 'deal',
                status: 'PartFilled',
                cumulativeDeal: 500,
                remaining: 500,
                eventDeal: 500,
                tradeId: 'entry-trade-controller',
                seqno: 'entry-seq-controller',
                ordno: 'entry-ord-controller',
                dealId: 'entry-deal-controller-terminal',
                exchangeSequence: 'entry-deal-exchange-controller',
                customField: null,
                exchangeEpochMs: 1_786_377_600_250,
            },
        );
        await expect(
            controller.recordCanonicalBrokerEvent({
                event: terminalDealEvent,
            }),
        ).resolves.toMatchObject({
            state: 'accepted',
            intentId: 'entry-intent-oco-controller',
            brokerWriteAuthority: false,
        });
        const terminalEvent = protectedEntryControllerBrokerEvent(generation, {
            tradeDate: '2026-08-11',
            eventKind: 'order',
            status: 'Cancelled',
            cumulativeDeal: 500,
            cumulativeCancel: 500,
            remaining: 0,
            eventDeal: 0,
            tradeId: 'entry-trade-controller',
            seqno: 'entry-seq-controller',
            ordno: 'entry-ord-controller',
            orderId: 'entry-order-controller',
            exchangeSequence: 'entry-exchange-controller',
            customField: null,
            exchangeEpochMs: 1_786_377_600_260,
        });
        await expect(
            controller.recordCanonicalBrokerEvent({ event: terminalEvent }),
        ).resolves.toMatchObject({
            state: 'accepted',
            intentId: 'entry-intent-oco-controller',
            brokerWriteAuthority: false,
        });
        const reconciliation = issuedProtectedEntryReconciliation({
            apiGeneration: generation,
            runtimeEpochId: 'runtime-oco-controller',
            tradeDate: '2026-08-11',
            positionLineageId: 'position-oco-controller',
            quantityShares: 500,
            availableShares: 500,
            dealIds: ['entry-deal-controller-terminal'],
            sourceRevision: 'controller-source-oco-terminal',
            asOfEpochMs: 1_786_377_600_275,
        });
        await expect(
            controller.recordAccountReconciliation({
                brokerObservationEvidenceSha256:
                    terminalEvent.brokerEventEvidenceSha256,
                nowEpochMs: 1_786_377_600_290,
                result: reconciliation,
            }),
        ).resolves.toMatchObject({
            state: 'recorded',
            protectedEntryMaterializationIntentIds: [
                'entry-intent-oco-controller',
            ],
            brokerWriteAuthority: false,
        });
        const settlementFault = new DatabaseSync(
            path.join(
                appSupportRoot,
                'smart-order',
                'database',
                'smart-orders.sqlite3',
            ),
        );
        const settlementProjection = (connection) =>
            connection.prepare(`
                SELECT
                    (SELECT state FROM broker_orders
                      WHERE broker_order_id='entry-order-oco-controller')
                        AS broker_order_state,
                    (SELECT revision FROM broker_orders
                      WHERE broker_order_id='entry-order-oco-controller')
                        AS broker_order_revision,
                    (SELECT state FROM order_intents
                      WHERE intent_id='entry-intent-oco-controller')
                        AS entry_intent_state,
                    (SELECT revision FROM order_intents
                      WHERE intent_id='entry-intent-oco-controller')
                        AS entry_intent_revision,
                    (SELECT state FROM order_intents
                      WHERE intent_id=?) AS cancel_intent_state,
                    (SELECT revision FROM order_intents
                      WHERE intent_id=?) AS cancel_intent_revision,
                    (SELECT state FROM activations
                      WHERE activation_id='entry-activation-oco-controller')
                        AS entry_activation_state,
                    (SELECT revision FROM activations
                      WHERE activation_id='entry-activation-oco-controller')
                        AS entry_activation_revision,
                    (SELECT state FROM activations
                      WHERE activation_id=(
                          SELECT activation_id FROM order_intents
                           WHERE intent_id=?
                      )) AS cancel_activation_state,
                    (SELECT revision FROM activations
                      WHERE activation_id=(
                          SELECT activation_id FROM order_intents
                           WHERE intent_id=?
                      )) AS cancel_activation_revision,
                    (SELECT COUNT(*) FROM event_journal) AS journal_count
            `).get(
                cancellation.cancelIntentId,
                cancellation.cancelIntentId,
                cancellation.cancelIntentId,
                cancellation.cancelIntentId,
            );
        const beforeFault = settlementProjection(settlementFault);
        settlementFault.exec(`
            CREATE TRIGGER test_protected_entry_terminal_settlement_crash
            BEFORE UPDATE ON activations
            WHEN OLD.activation_id='entry-activation-oco-controller'
             AND NEW.state='cancelled'
            BEGIN
                SELECT RAISE(
                    ABORT,
                    'test protected entry terminal settlement crash'
                );
            END;
        `);
        await expect(
            controller.materializeProtectedEntryFill({
                brokerObservationEvidenceSha256:
                    terminalEvent.brokerEventEvidenceSha256,
                intentId: 'entry-intent-oco-controller',
                nowEpochMs: 1_786_377_600_299,
                reconciliationResult: reconciliation,
            }),
        ).rejects.toThrow('test protected entry terminal settlement crash');
        expect(settlementProjection(settlementFault)).toEqual(beforeFault);
        settlementFault.exec(
            'DROP TRIGGER test_protected_entry_terminal_settlement_crash',
        );
        settlementFault.close();
        const materialized = await controller.materializeProtectedEntryFill({
            brokerObservationEvidenceSha256:
                terminalEvent.brokerEventEvidenceSha256,
            intentId: 'entry-intent-oco-controller',
            nowEpochMs: 1_786_377_600_300,
            reconciliationResult: reconciliation,
        });
        expect(materialized).toMatchObject({
            state: 'final',
            cumulativeFilledShares: 500,
            remainingEntryShares: 0,
            terminalSettlement: {
                settled: true,
                replayed: false,
                cancelIntentId: cancellation.cancelIntentId,
            },
            brokerWriteAuthority: false,
        });
        const replayVerification = new DatabaseSync(
            path.join(
                appSupportRoot,
                'smart-order',
                'database',
                'smart-orders.sqlite3',
            ),
            { readOnly: true },
        );
        const beforeReplay = settlementProjection(replayVerification);
        replayVerification.close();
        await expect(
            controller.materializeProtectedEntryFill({
                brokerObservationEvidenceSha256:
                    terminalEvent.brokerEventEvidenceSha256,
                intentId: 'entry-intent-oco-controller',
                nowEpochMs: 1_786_377_600_305,
                reconciliationResult: reconciliation,
            }),
        ).resolves.toMatchObject({
            state: 'final',
            replayed: true,
            terminalSettlement: {
                settled: true,
                replayed: true,
                cancelIntentId: cancellation.cancelIntentId,
            },
            brokerWriteAuthority: false,
        });
        const afterReplayVerification = new DatabaseSync(
            path.join(
                appSupportRoot,
                'smart-order',
                'database',
                'smart-orders.sqlite3',
            ),
            { readOnly: true },
        );
        expect(settlementProjection(afterReplayVerification)).toEqual(
            beforeReplay,
        );
        afterReplayVerification.close();
        expect(() =>
            controller.completeBrokerObservationReconciliation({
                eventEvidenceSha256:
                    terminalEvent.brokerEventEvidenceSha256,
            }),
        ).not.toThrow();
        await expect(
            controller.markReady({
                reconciliationEvidenceHash: reconciliation.evidenceSha256,
            }),
        ).resolves.toMatchObject({ state: 'ready' });
        const latestRequest = {
            ...request,
            nowEpochMs: 1_786_377_600_310,
            exitClaim: {
                ...request.exitClaim,
                expectedRevision: materialized.exitClaimRevision,
                expectedGroupRevision:
                    materialized.protectionGroupRevision,
                expectedGenerationRevision:
                    materialized.protectionGenerationRevision,
            },
        };
        await expect(
            controller.prepareProtectionOcoWinner(latestRequest),
        ).resolves.toMatchObject({
            intentId: 'intent-oco-controller',
            winnerLegId: 'stop',
            siblingCount: 0,
            adapterAuthorityGranted: false,
            brokerWriteAuthority: false,
        });
        let accessorReads = 0;
        await expect(
            controller.prepareProtectionOcoWinner({
                ...request,
                intent: {
                    ...request.intent,
                    get payload() {
                        accessorReads += 1;
                        return payload;
                    },
                },
            }),
        ).rejects.toThrow('must use own data properties');
        expect(accessorReads).toBe(0);
    });

    it('snapshots and atomically admits replay-protected strategy resume without trusting accessors', async () => {
        const appSupportRoot = await privateRoot();
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-resume',
            nowEpochMs: 1_786_377_600_000,
            runtimeEpochId: 'runtime-resume',
            senderFence: 'fence-resume',
            repositoryOptions: {
                testOnlyAllowSyntheticGateManifestProjection: true,
            },
        });
        openControllers.add({
            controller,
            stopAtEpochMs: 1_786_377_601_000,
        });
        await controller.markReady({ reconciliationEvidenceHash: DIGEST_A });
        const databasePath = path.join(
            appSupportRoot,
            'smart-order',
            'database',
            'smart-orders.sqlite3',
        );
        const database = new DatabaseSync(databasePath);
        database.exec('PRAGMA busy_timeout=2500');
        database.prepare(`
            INSERT INTO strategies(
                strategy_id, strategy_kind, state, definition_hash,
                definition_json, account_broker_ref, account_id_ref,
                identity_group_id, confirmation_snapshot_hash,
                created_at_epoch_ms, updated_at_epoch_ms,
                terminal_at_epoch_ms, revision
            ) VALUES (
                'strategy-resume', 'quick', 'paused', ?,
                '{"activationPolicy":"require_rearm","kind":"quick","schemaVersion":"strategy/1"}',
                'broker-A', 'account-A', 'identity-A', ?,
                1786377600010, 1786377600010, NULL, 0
            )
        `).run(DIGEST_A, DIGEST_B);
        database.prepare(`
            INSERT INTO gate_manifests(
                manifest_id, manifest_revision, manifest_sha256,
                schema_version, provenance, manifest_json,
                fingerprints_sha256, evidence_catalog_sha256,
                feature_gates_sha256, product_boundary_consent_version,
                state, valid_until_epoch_ms, created_at_epoch_ms, revision
            ) VALUES (
                'manual-resume-gate', 'r1', ?,
                'smart-order-gate-manifest/2026-08-11.1',
                'manual_user_confirmed',
                '{"featureGates":{"good_till":false,"multi_condition":false,"parent_child":false,"quick":true,"scheduled_quantity":false,"stop_take":false,"trailing_exit":false},"fingerprints":{"mappingRevision":"mapping-r1"}}',
                ?, ?, ?, 'local-sidecar-consent/v1', 'eligible',
                1786377900000, 1786377600020, 0
            )
        `).run(
            `sha256:${'c'.repeat(64)}`,
            DIGEST_A,
            DIGEST_B,
            `sha256:${'d'.repeat(64)}`,
        );
        database.close();

        const request = {
            requestId: '11111111-1111-4111-8111-111111111111',
            operationKind: 'strategy_resume',
            payloadHash: DIGEST_A,
            nowEpochMs: 1_786_377_600_100,
            mutation: {
                activationPolicyAcknowledged: true,
                contractEvidence: null,
                controlPlaneAuthority: null,
                expectedRevision: 0,
                kind: 'resume',
                nowEpochMs: 1_786_377_600_100,
                strategyId: 'strategy-resume',
            },
        };
        await expect(
            controller.executeReplayProtectedStrategyMutation(request),
        ).resolves.toMatchObject({
            state: 'completed',
            result: {
                strategyId: 'strategy-resume',
                state: 'monitoring',
                revision: 1,
            },
        });
        let accessorReads = 0;
        await expect(
            controller.executeReplayProtectedStrategyMutation({
                ...request,
                requestId: '22222222-2222-4222-8222-222222222222',
                get mutation() {
                    accessorReads += 1;
                    return request.mutation;
                },
            }),
        ).rejects.toThrow('must use own data properties');
        expect(accessorReads).toBe(0);
        await expect(
            controller.executeReplayProtectedStrategyMutation({
                requestId: '33333333-3333-4333-8333-333333333333',
                operationKind: 'broker_order_update_request',
                payloadHash: DIGEST_A,
                nowEpochMs: 1_786_377_600_150,
                mutation: {
                    expectedRevision: 1,
                    kind: 'update_broker_order',
                    nowEpochMs: 1_786_377_600_150,
                    quantityShares: 500,
                    strategyId: 'strategy-resume',
                    userConfirmationAcknowledged: true,
                },
            }),
        ).resolves.toMatchObject({
            state: 'failed',
            replayed: false,
            result: { status: 409 },
        });
        await controller.requestStrategyCancellation({
            strategyId: 'strategy-resume',
            expectedRevision: 1,
            nowEpochMs: 1_786_377_600_200,
        });
    });

    it('resolves one unique-final manual case through the issued controller and never redispatches the original intent', async () => {
        const appSupportRoot = await privateRoot();
        const nowEpochMs = Date.now();
        const apiGeneration = 'api-generation-manual-resolution-controller';
        const runtimeEpochId = 'runtime-manual-resolution-controller';
        const senderFence = 'fence-manual-resolution-controller';
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration,
            nowEpochMs: nowEpochMs - 3_000,
            runtimeEpochId,
            senderFence,
        });
        openControllers.add({
            controller,
            stopAtEpochMs: nowEpochMs + 1_000,
        });
        await controller.markReady({ reconciliationEvidenceHash: DIGEST_A });
        const databasePath = path.join(
            appSupportRoot,
            'smart-order',
            'database',
            'smart-orders.sqlite3',
        );
        seedManualResolutionControllerFixture(databasePath, {
            apiGeneration,
            nowEpochMs,
            runtimeEpochId,
            senderFence,
        });

        const projection = await controller.listManualResolutionCases({
            strategyId: 'strategy-manual-controller',
        });
        expect(projection).toMatchObject({
            strategyState: 'manual_intervention',
            genericResumeAllowed: false,
            brokerWriteAuthority: false,
            cases: [
                {
                    reasonCode: 'BROKER_OUTCOME_UNKNOWN',
                    uniqueFinalReady: true,
                    oldIntentDisposition: 'never_resend',
                    brokerWriteAuthority: false,
                },
            ],
        });
        expect(controller.resolveManualIntervention).toBeUndefined();
        const request = {
            requestId: '55555555-5555-4555-8555-555555555555',
            operationKind: 'manual_resolution_apply_unique_final',
            payloadHash: DIGEST_A,
            nowEpochMs,
            mutation: {
                expectedRevision: 0,
                kind: 'manual_resolution_apply_unique_final',
                nowEpochMs,
                resolutionKey: projection.cases[0].resolutionKey,
                strategyId: 'strategy-manual-controller',
                userAcknowledgedFinalEvidence: true,
            },
        };
        const first = await controller.executeReplayProtectedStrategyMutation(
            request,
        );
        expect(first).toMatchObject({
            state: 'completed',
            replayed: false,
            result: {
                strategyState: 'paused',
                originalIntentState: 'terminal',
                originalIntentRedispatchAllowed: false,
                brokerWriteAttempted: false,
                brokerAuthorityGranted: false,
            },
        });
        await expect(
            controller.executeReplayProtectedStrategyMutation(request),
        ).resolves.toMatchObject({
            state: 'completed',
            replayed: true,
            resultHash: first.resultHash,
            result: { originalIntentRedispatchAllowed: false },
        });

        let accessorReads = 0;
        await expect(
            controller.executeReplayProtectedStrategyMutation({
                ...request,
                requestId: '66666666-6666-4666-8666-666666666666',
                get mutation() {
                    accessorReads += 1;
                    return request.mutation;
                },
            }),
        ).rejects.toThrow('must use own data properties');
        expect(accessorReads).toBe(0);

        const verified = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verified.prepare(`
                SELECT strategies.state AS strategy_state,
                       intents.state AS intent_state,
                       intents.terminal_outcome,
                       cases.state AS case_state,
                       blockers.state AS blocker_state
                  FROM strategies
                  JOIN order_intents AS intents USING(strategy_id)
                  JOIN resolution_cases AS cases USING(strategy_id)
                  JOIN safety_blockers AS blockers USING(resolution_case_id)
                 WHERE strategies.strategy_id='strategy-manual-controller'
            `).get(),
        ).toEqual({
            strategy_state: 'paused',
            intent_state: 'terminal',
            terminal_outcome: 'place_filled_unique_final',
            case_state: 'resolved',
            blocker_state: 'resolved',
        });
        verified.close();
    });

    it('drains a proven-unsent prepared intent through the issued primary controller and replays the canonical result', async () => {
        const appSupportRoot = await privateRoot();
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-drain',
            nowEpochMs: 1_786_377_600_000,
            runtimeEpochId: 'runtime-drain',
            senderFence: 'fence-drain',
        });
        openControllers.add({
            controller,
            stopAtEpochMs: 1_786_377_601_000,
        });
        const database = new DatabaseSync(
            path.join(
                appSupportRoot,
                'smart-order',
                'database',
                'smart-orders.sqlite3',
            ),
        );
        database.exec('PRAGMA busy_timeout=2500');
        database.prepare(`
            INSERT INTO strategies(
                strategy_id, strategy_kind, state, definition_hash,
                definition_json, account_broker_ref, account_id_ref,
                identity_group_id, confirmation_snapshot_hash,
                created_at_epoch_ms, updated_at_epoch_ms,
                terminal_at_epoch_ms, revision
            ) VALUES (
                'strategy-drain', 'quick', 'observing', ?,
                '{"kind":"quick","schemaVersion":"strategy/1"}',
                'broker-A', 'account-A', 'identity-A', ?,
                1786377600010, 1786377600010, NULL, 0
            )
        `).run(DIGEST_A, DIGEST_B);
        database.exec(`
            INSERT INTO activations(
                activation_id, strategy_id, logical_key, state, generation,
                evidence_hash, created_at_epoch_ms, updated_at_epoch_ms, revision
            ) VALUES (
                'activation-drain', 'strategy-drain', 'edge:drain',
                'prepared', 0, '${DIGEST_A}', 1786377600010,
                1786377600010, 0
            );
            INSERT INTO order_intents(
                intent_id, activation_id, strategy_id, operation_kind,
                owner_kind, state, terminal_outcome, payload_hash,
                payload_json, client_request_id, account_broker_ref,
                account_id_ref, trade_date, contract_key, side,
                target_broker_order_id, target_control_revision,
                runtime_epoch_id, dispatch_attempt_nonce, sender_fence,
                api_generation, mode_revision, risk_revision,
                account_revision, target_revision,
                adapter_authority_granted, created_at_epoch_ms,
                updated_at_epoch_ms, terminal_at_epoch_ms, revision
            ) VALUES (
                'intent-drain', 'activation-drain', 'strategy-drain',
                'place', 'activation', 'prepared', NULL, '${DIGEST_A}',
                '{"schemaVersion":"intent/1"}', 'request-drain',
                'broker-A', 'account-A', '2026-08-13',
                'TSE:2330:STK:Common', 'Buy', NULL, NULL, NULL, NULL,
                NULL, NULL, 'mode-r1', 'risk-r1', 'account-r1',
                'target-r1', 0, 1786377600010, 1786377600010, NULL, 0
            );
        `);
        database.close();
        await controller.executeReplayProtectedStrategyMutation({
            requestId: '123e4567-e89b-42d3-a456-426614174301',
            operationKind: 'strategy_cancel',
            payloadHash: DIGEST_A,
            nowEpochMs: 1_786_377_600_100,
            mutation: {
                expectedRevision: 0,
                kind: 'cancel',
                nowEpochMs: 1_786_377_600_100,
                strategyId: 'strategy-drain',
            },
        });
        const request = {
            strategyId: 'strategy-drain',
            expectedRevision: 1,
            operationId: '123e4567-e89b-42d3-a456-426614174302',
            nowEpochMs: 1_786_377_600_200,
        };
        await expect(
            controller.drainPreparedIntentProvenUnsent(request),
        ).resolves.toMatchObject({
            strategyState: 'cancelled',
            preparedIntentState: 'cancelled_proven_unsent',
            userAuthorityConsumed: true,
            brokerWriteAttempted: false,
            brokerAuthorityGranted: false,
            replayed: false,
        });
        await expect(
            controller.drainPreparedIntentProvenUnsent({
                ...request,
                nowEpochMs: 1_786_377_600_201,
            }),
        ).resolves.toMatchObject({
            strategyState: 'cancelled',
            replayed: true,
        });
    });

    it('admits one primary, keeps the second process readonly, and fences restart', async () => {
        const appSupportRoot = await privateRoot();
        const first = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-1',
            nowEpochMs: 1_786_377_600_000,
            runtimeEpochId: 'runtime-epoch-1',
            senderFence: 'sender-fence-1',
        });
        openControllers.add({
            controller: first,
            stopAtEpochMs: 1_786_377_600_500,
        });
        expect(first.status()).toMatchObject({
            role: 'primary',
            state: 'reconciling',
            dispatchAllowed: false,
            tradingSenderAuthority: 'runtime_only',
            legacyTradingTriggerAuthority: 'permanently_retired',
        });
        const draft = await first.createDraftStrategy({
            strategyId: 'controller-history-draft',
            strategyKind: 'trailing_exit',
            nowEpochMs: 1_786_377_600_010,
        });
        await first.requestStrategyCancellation({
            strategyId: draft.strategyId,
            expectedRevision: draft.revision,
            nowEpochMs: 1_786_377_600_020,
        });
        await expect(first.listHistory({ limit: 10 })).resolves.toEqual([
            expect.objectContaining({
                type: 'strategy',
                strategyId: 'controller-history-draft',
                strategyKind: 'trailing_exit',
                state: 'cancelled',
                reasonCode: 'STRATEGY_CANCELLED_WITHOUT_SIDE_EFFECTS',
                revision: 1,
            }),
        ]);
        await expect(first.lifecycleAudit()).resolves.toMatchObject({
            writeMaster: 'disabled',
            counts: {
                non_terminal_strategies: 0,
                active_protection_obligations: 0,
            },
            uninstallAllowed: true,
            accountIdentifiersExposed: false,
        });
        await expect(
            first.prepareProtectedEntry({
                protectionCommitment: {
                    commitmentId: 'blocked-before-ready',
                    committedShares: 1_000,
                },
                protectionObligation: {
                    obligationId: 'blocked-before-ready',
                    positionLineageId: 'blocked-before-ready',
                },
                intent: { operationKind: 'place', side: 'Buy' },
            }),
        ).rejects.toThrow('current ready runtime');

        const second = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-1',
            nowEpochMs: 1_786_377_600_100,
            runtimeEpochId: 'runtime-epoch-ignored',
            senderFence: 'sender-fence-ignored',
        });
        expect(second.status()).toEqual({
            role: 'secondary_readonly',
            state: 'observe_only',
            dispatchAllowed: false,
            repositoryOpened: false,
            tradingSenderAuthority: 'none',
            legacyTradingTriggerAuthority: 'permanently_retired',
        });
        await second.close();

        await expect(
            first.markReady({ reconciliationEvidenceHash: DIGEST_A }),
        ).resolves.toMatchObject({ state: 'ready', dispatchAllowed: true });
        await expect(
            first.prepareProtectedEntry({
                protectionCommitment: {
                    commitmentId: 'blocked-stale-generation',
                    committedShares: 1_000,
                },
                protectionObligation: {
                    obligationId: 'blocked-stale-generation',
                    positionLineageId: 'blocked-stale-generation',
                },
                intent: {
                    operationKind: 'place',
                    side: 'Buy',
                    payload: protectedEntryPayload('api-generation-stale'),
                },
            }),
        ).rejects.toThrow('current API generation');
        let payloadGetterReads = 0;
        const accessorIntent = {
            operationKind: 'place',
            side: 'Buy',
        };
        Object.defineProperty(accessorIntent, 'payload', {
            enumerable: true,
            get() {
                payloadGetterReads += 1;
                return protectedEntryPayload('api-generation-1');
            },
        });
        await expect(
            first.prepareProtectedEntry({
                protectionCommitment: {
                    commitmentId: 'blocked-accessor',
                    committedShares: 1_000,
                },
                protectionObligation: {
                    obligationId: 'blocked-accessor',
                    positionLineageId: 'blocked-accessor',
                },
                intent: accessorIntent,
            }),
        ).rejects.toThrow('own data property');
        expect(payloadGetterReads).toBe(0);
        await expect(
            first.prepareProtectedEntry(
                new Proxy(
                    {
                        protectionCommitment: {},
                        protectionObligation: {},
                        intent: {},
                    },
                    {},
                ),
            ),
        ).rejects.toThrow('non-Proxy');
        await expect(
            first.dispatchBrokerIntent({
                intentId: 'must-remain-unsent',
                runtimeEpochId: 'runtime-epoch-1',
            }),
        ).rejects.toThrow('broker adapter is disabled');
        const normalizedEvent = normalizeCanonicalSmartOrderBrokerEvent({
            schemaVersion: SMART_ORDER_BROKER_EVENT_CANDIDATE_SCHEMA_VERSION,
            mappingRevision: 'mapping-r1',
            apiGeneration: 'api-generation-1',
            eventKind: 'order',
            account: {
                brokerId: 'broker-A',
                accountId: 'account-A',
                accountType: 'S',
            },
            tradeDate: '2026-08-11',
            contractKey: 'TSE:2330:STK:Common',
            side: 'Buy',
            identifiers: {
                tradeId: 'trade-controller-1',
                orderId: 'order-controller-1',
                dealId: null,
                seqno: 'seq-controller-1',
                ordno: 'ord-controller-1',
                exchangeSequence: null,
                customField: 'CTRL01',
            },
            operation: { type: 'New', code: '00', message: null },
            status: 'Submitted',
            orderClass: {
                orderCondition: 'Cash',
                orderLot: 'Common',
                priceType: 'LMT',
                timeInForce: 'ROD',
            },
            quantities: {
                order: 1_000,
                cumulativeDeal: 0,
                cumulativeCancel: 0,
                remaining: 1_000,
                eventDeal: 0,
                unit: 'Share',
            },
            price: '100',
            timestamps: {
                exchangeEpochMs: 1_786_377_600_100,
                brokerEpochMs: 1_786_377_600_101,
                receiveEpochMs: 1_786_377_600_102,
            },
        });
        await expect(
            first.recordCanonicalBrokerEvent({
                event: structuredClone(normalizedEvent),
            }),
        ).rejects.toThrow('issued normalizer evidence');
        await expect(
            first.recordCanonicalBrokerEvent({
                event: normalizedEvent,
            }),
        ).rejects.toThrow('did not resolve to one durable correlation');
        await expect(first.lifecycleAudit()).resolves.toMatchObject({
            counts: { side_effect_intents: 0 },
        });
        await expect(
            first.createBackup({
                backupName: 'controller-before-stop.sqlite3',
                createdAtEpochMs: 1_786_377_600_200,
            }),
        ).resolves.toMatchObject({ containsSecrets: false });
        await first.stop({ nowEpochMs: 1_786_377_600_300 });
        expect(first.status()).toMatchObject({
            state: 'closed',
            dispatchAllowed: false,
            tradingSenderAuthority: 'none',
            legacyTradingTriggerAuthority: 'permanently_retired',
        });
        openControllers.clear();

        const restarted = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-2',
            nowEpochMs: 1_786_377_600_400,
            runtimeEpochId: 'runtime-epoch-2',
            senderFence: 'sender-fence-2',
        });
        openControllers.add({
            controller: restarted,
            stopAtEpochMs: 1_786_377_600_600,
        });
        expect(restarted.status()).toMatchObject({
            role: 'primary',
            state: 'reconciling',
            dispatchAllowed: false,
        });
        await restarted.stop({ nowEpochMs: 1_786_377_600_500 });
        openControllers.clear();

        const database = new DatabaseSync(
            path.join(appSupportRoot, 'smart-order', 'database', 'smart-orders.sqlite3'),
            { readOnly: true },
        );
        expect(
            database
                .prepare(`
                    SELECT runtime_epoch_id, state FROM runtime_epochs
                    ORDER BY started_at_epoch_ms
                `)
                .all(),
        ).toEqual([
            { runtime_epoch_id: 'runtime-epoch-1', state: 'stopped' },
            { runtime_epoch_id: 'runtime-epoch-2', state: 'stopped' },
        ]);
        database.close();
    });

    it('prepares a current protected entry through the production controller and keeps broker authority disabled', async () => {
        const appSupportRoot = await privateRoot();
        const generation = 'api-generation-protected-entry';
        const payload = protectedEntryPayload(generation);
        const plan = canonicalProtectedEntryPlan(payload.protectionPlan);
        const authenticatedIdentityEvidence = Object.freeze({
            accountScopes: Object.freeze([
                Object.freeze({
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                }),
            ]),
            canonicalPrincipal: 'test-only-canonical-principal',
            mappingRevision: 'identity-mapping/1',
            principalEvidenceHash: DIGEST_A,
        });
        identityAuthority.evidence.add(authenticatedIdentityEvidence);
        const preparedStorage = await prepareSmartOrderPrivateStorage({
            appSupportRoot,
        });
        const identityKey = await readPrivateSecret(
            preparedStorage.paths.identityKeyPath,
        );
        const identityGroupId = `hmac-sha256:${createHmac(
            'sha256',
            identityKey,
        )
            .update(authenticatedIdentityEvidence.canonicalPrincipal)
            .digest('hex')}`;
        identityKey.fill(0);
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: generation,
            nowEpochMs: 1_786_377_600_000,
            runtimeEpochId: 'runtime-protected-entry',
            senderFence: 'fence-protected-entry',
            repositoryOptions: {
                testOnlyExposureArbiterHeads: [
                    protectedExposureHead(
                        plan.riskPolicyHash,
                        identityGroupId,
                    ),
                ],
                testOnlyExposureClockNowEpochMs: 1_786_377_600_100,
            },
        });
        openControllers.add({
            controller,
            stopAtEpochMs: 1_786_377_601_000,
        });
        expect(
            controller.acceptAuthenticatedIdentityEvidence(
                authenticatedIdentityEvidence,
            ),
        ).toMatchObject({
            state: 'authenticated',
            fixedAccountCount: 1,
            rawPrincipalExposed: false,
        });
        await controller.markReady({ reconciliationEvidenceHash: DIGEST_A });
        const accountReconciliation = issuedProtectedEntryReconciliation({
            apiGeneration: generation,
            runtimeEpochId: 'runtime-protected-entry',
        });
        await expect(
            controller.recordAccountReconciliation({
                brokerObservationEvidenceSha256: null,
                nowEpochMs: 1_786_550_400_600,
                result: accountReconciliation,
            }),
        ).resolves.toMatchObject({
            state: 'recorded',
            accountReconciliationCurrent: true,
            runtimeReadinessContribution: true,
            brokerWriteAuthority: false,
        });

        const databasePath = path.join(
            appSupportRoot,
            'smart-order',
            'database',
            'smart-orders.sqlite3',
        );
        const database = new DatabaseSync(databasePath);
        database.exec('PRAGMA busy_timeout=2500');
        database.prepare(`
            INSERT INTO strategies(
                strategy_id, strategy_kind, state, definition_hash,
                definition_json, account_broker_ref, account_id_ref,
                identity_group_id, confirmation_snapshot_hash,
                created_at_epoch_ms, updated_at_epoch_ms,
                terminal_at_epoch_ms, revision
            ) VALUES (
                'strategy-protected-entry', 'stop_take', 'monitoring', ?,
                '{"kind":"stop_take","schemaVersion":"strategy/1"}',
                'broker-A', 'account-A', ?, ?,
                1786377600100, 1786377600100, NULL, 0
            )
        `).run(DIGEST_A, identityGroupId, DIGEST_B);
        database.close();

        await expect(
            controller.prepareProtectedEntry({
                strategyId: 'strategy-protected-entry',
                nowEpochMs: 1_786_377_600_200,
                activation: {
                    activationId: 'activation-protected-entry',
                    logicalKey: 'edge-protected-entry',
                    generation: 1,
                    evidenceHash: DIGEST_A,
                },
                intent: {
                    intentId: 'intent-protected-entry',
                    operationKind: 'place',
                    ownerKind: 'activation',
                    payloadHash: `sha256:${'0'.repeat(64)}`,
                    payload,
                    clientRequestId: 'request-protected-entry',
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    tradeDate: '2026-08-13',
                    contractKey: 'TSE:2330:STK:Common',
                    side: 'Buy',
                },
                reservation: {
                    reservationId: 'reservation-protected-entry',
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    identityGroupId,
                    policyRevision: 'risk-policy-1',
                    policyHash: plan.riskPolicyHash,
                    ...plan.worstCaseExposure,
                },
                protectionCommitment: {
                    commitmentId: 'commitment-protected-entry',
                    committedShares: 1_000,
                },
                protectionObligation: {
                    obligationId: 'obligation-protected-entry',
                    positionLineageId: 'position-protected-entry',
                },
            }),
        ).resolves.toMatchObject({
            intentId: 'intent-protected-entry',
            state: 'prepared',
            protectionCommitmentId: 'commitment-protected-entry',
            protectionObligationId: 'obligation-protected-entry',
            exitClaimId: null,
            adapterAuthorityGranted: false,
        });
        await expect(controller.lifecycleAudit()).resolves.toMatchObject({
            counts: { side_effect_intents: 0 },
        });
        await expect(
            controller.dispatchBrokerIntent({
                intentId: 'intent-protected-entry',
                runtimeEpochId: 'runtime-protected-entry',
            }),
        ).rejects.toThrow('broker adapter is disabled');

        const dispatched = new DatabaseSync(databasePath);
        dispatched.exec(`
            UPDATE order_intents
               SET state='dispatching', adapter_authority_granted=1,
                   dispatch_attempt_nonce='controller-dispatch-attempt-1',
                   runtime_epoch_id='runtime-protected-entry',
                   sender_fence='fence-protected-entry',
                   api_generation='${generation}', revision=1
             WHERE intent_id='intent-protected-entry';
            UPDATE activations SET state='dispatching', revision=1
             WHERE activation_id='activation-protected-entry';
            INSERT INTO broker_correlations(
                correlation_id, intent_id, broker_order_id,
                canonical_key_hash, account_broker_ref, account_id_ref,
                trade_date, contract_key, side, trade_id, order_id,
                deal_id, seqno, ordno, exchange_sequence, custom_field,
                evidence_hash, created_at_epoch_ms, revision
            ) VALUES (
                'correlation-protected-entry', 'intent-protected-entry', NULL,
                'sha256:${'c'.repeat(64)}', 'broker-A', 'account-A', '2026-08-13',
                'TSE:2330:STK:Common', 'Buy',
                'protected-entry-controller-trade-1',
                'protected-entry-controller-order-1', NULL,
                'protected-entry-controller-seq-1',
                'protected-entry-controller-ord-1', NULL, 'PEC001',
                '${DIGEST_A}', 1786550400200, 0
            );
            INSERT INTO broker_correlation_identifiers(
                account_broker_ref, account_id_ref, trade_date, contract_key,
                side, identifier_kind, identifier_value, intent_id,
                correlation_id, created_at_epoch_ms
            ) VALUES
                ('broker-A','account-A','2026-08-13','TSE:2330:STK:Common',
                 'Buy','tradeId','protected-entry-controller-trade-1',
                 'intent-protected-entry','correlation-protected-entry',1786550400200),
                ('broker-A','account-A','2026-08-13','TSE:2330:STK:Common',
                 'Buy','seqno','protected-entry-controller-seq-1',
                 'intent-protected-entry','correlation-protected-entry',1786550400200);
        `);
        dispatched.close();

        const orderEvent = protectedEntryControllerBrokerEvent(generation);
        await controller.recordCanonicalBrokerEvent({ event: orderEvent });
        const dealEvent = protectedEntryControllerBrokerEvent(generation, {
            eventKind: 'deal',
            status: 'PartFilled',
            cumulativeDeal: 200,
            remaining: 800,
            eventDeal: 200,
            dealId: 'protected-entry-controller-deal-1',
            exchangeSequence: 'protected-entry-controller-exchange-1',
            exchangeEpochMs: 1_786_550_400_400,
        });
        await controller.recordCanonicalBrokerEvent({
            event: dealEvent,
        });
        expect(controller.status()).toMatchObject({
            state: 'reconciling',
            dispatchAllowed: false,
            brokerObservationPending: true,
            brokerObservationReconciledAccountCount: 0,
            brokerObservationPendingMaterializationCount: 0,
        });
        expect(() =>
            controller.completeBrokerObservationReconciliation({
                eventEvidenceSha256:
                    dealEvent.brokerEventEvidenceSha256,
            }),
        ).toThrow(/incomplete/i);
        await expect(
            controller.recordAccountReconciliation({
                brokerObservationEvidenceSha256:
                    dealEvent.brokerEventEvidenceSha256,
                nowEpochMs: 1_786_550_400_550,
                result: accountReconciliation,
            }),
        ).resolves.toMatchObject({
            state: 'recorded',
            protectedEntryMaterializationIntentIds: [
                'intent-protected-entry',
            ],
            brokerWriteAuthority: false,
        });
        expect(controller.status()).toMatchObject({
            brokerObservationReconciledAccountCount: 1,
            brokerObservationPendingMaterializationCount: 1,
        });
        expect(() =>
            controller.completeBrokerObservationReconciliation({
                eventEvidenceSha256:
                    dealEvent.brokerEventEvidenceSha256,
            }),
        ).toThrow(/incomplete/i);
        await expect(
            controller.materializeProtectedEntryFill({
                brokerObservationEvidenceSha256:
                    dealEvent.brokerEventEvidenceSha256,
                intentId: 'intent-protected-entry',
                nowEpochMs: 1_786_550_400_600,
                reconciliationResult: accountReconciliation,
            }),
        ).resolves.toMatchObject({
            state: 'partial',
            cumulativeFilledShares: 200,
            remainingEntryShares: 800,
            exitClaimId: expect.stringMatching(/^exit-claim:/),
            brokerWriteAuthority: false,
        });
        expect(controller.status()).toMatchObject({
            state: 'reconciling',
            dispatchAllowed: false,
            brokerObservationPending: true,
            brokerObservationPendingSha256:
                dealEvent.brokerEventEvidenceSha256,
        });
        expect(() =>
            controller.completeBrokerObservationReconciliation({
                eventEvidenceSha256:
                    dealEvent.brokerEventEvidenceSha256,
            }),
        ).not.toThrow();
        expect(controller.status()).toMatchObject({
            state: 'reconciling',
            dispatchAllowed: false,
            brokerObservationPending: false,
        });
        const manualPositionDriftReconciliation =
            issuedProtectedEntryReconciliation({
                apiGeneration: generation,
                runtimeEpochId: 'runtime-protected-entry',
                asOfEpochMs: 1_786_550_400_650,
                availableShares: 100,
                quantityShares: 100,
                sourceRevision: 'controller-source-2',
            });
        await expect(
            controller.recordAccountReconciliation({
                brokerObservationEvidenceSha256: null,
                nowEpochMs: 1_786_550_400_660,
                result: manualPositionDriftReconciliation,
            }),
        ).resolves.toMatchObject({
            state: 'recorded',
            protectionReservationShrinkCount: 1,
            protectionReservationReleasedCount: 0,
            protectionManualInterventionCount: 0,
            protectionShrunkShares: 100,
            protectedEntryMaterializationIntentIds: [],
            brokerWriteAuthority: false,
        });
        const driftDatabase = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            driftDatabase
                .prepare(`
                    SELECT quantity_shares, state FROM exit_claims
                     WHERE external_lineage=0
                `)
                .get(),
        ).toEqual({ quantity_shares: 100, state: 'monitoring_reserved' });
        driftDatabase.close();

        const unresolvedEvent = protectedEntryControllerBrokerEvent(
            generation,
            {
                tradeId: 'external-controller-trade-1',
                orderId: 'external-controller-order-1',
                seqno: 'external-controller-seq-1',
                ordno: 'external-controller-ord-1',
                exchangeEpochMs: 1_786_550_400_700,
            },
        );
        await expect(
            controller.recordCanonicalBrokerEvent({ event: unresolvedEvent }),
        ).rejects.toThrow(/correlation/i);
        expect(controller.status()).toMatchObject({
            state: 'reconciling',
            dispatchAllowed: false,
            tradingSenderAuthority: 'none',
            brokerObservationPending: true,
            brokerObservationPendingSha256:
                unresolvedEvent.brokerEventEvidenceSha256,
        });
        await expect(
            controller.markReady({ reconciliationEvidenceHash: DIGEST_A }),
        ).rejects.toThrow(/broker observation/i);
        await expect(
            controller.recordAccountReconciliation({
                brokerObservationEvidenceSha256: null,
                nowEpochMs: 1_786_550_400_800,
                result: accountReconciliation,
            }),
        ).rejects.toThrow(/pending broker observation/i);
    });

    it.each(['rollback', 'feature_off'])(
        'propagates the durable %s lifecycle operation through controller stop',
        async (operation) => {
            const appSupportRoot = await privateRoot();
            const controller = await startSmartOrderRuntimeController({
                appSupportRoot,
                apiGeneration: `${operation}-generation`,
                nowEpochMs: 1_786_377_620_000,
                runtimeEpochId: `${operation}-runtime`,
                senderFence: `${operation}-fence`,
            });
            const controllerEntry = {
                controller,
                stopAtEpochMs: 1_786_377_620_500,
            };
            openControllers.add(controllerEntry);

            await expect(
                controller.quiesce({
                    operation,
                    nowEpochMs: 1_786_377_620_100,
                }),
            ).resolves.toMatchObject({
                operation,
                state: 'quiescing',
                drainAllowed: true,
                selectedBlockerCount: 0,
                dispatchAllowed: false,
            });
            await expect(
                controller.stop({
                    operation,
                    nowEpochMs: 1_786_377_620_200,
                }),
            ).resolves.toMatchObject({
                state: 'stopped',
                dispatchAllowed: false,
            });
            openControllers.delete(controllerEntry);

            const database = new DatabaseSync(
                path.join(
                    appSupportRoot,
                    'smart-order',
                    'database',
                    'smart-orders.sqlite3',
                ),
                { readOnly: true },
            );
            expect(
                database
                    .prepare(`
                        SELECT state, stopped_at_epoch_ms
                          FROM runtime_epochs
                         WHERE runtime_epoch_id=?
                    `)
                    .get(`${operation}-runtime`),
            ).toEqual({
                state: 'stopped',
                stopped_at_epoch_ms: 1_786_377_620_200,
            });
            database.close();
        },
    );

    it('previews and atomically prepares a protected entry through the issued production controller', async () => {
        const appSupportRoot = await privateRoot();
        const nowEpochMs = 1_786_377_601_000;
        const apiGeneration = 'api-generation-protected-confirmation';
        const runtimeEpochId = 'runtime-protected-confirmation';
        const senderFence = 'fence-protected-confirmation';
        const controlPlaneAuthority = Object.freeze({});
        const authenticatedIdentityEvidence = Object.freeze({
            accountScopes: Object.freeze([
                Object.freeze({
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                }),
            ]),
            canonicalPrincipal: 'protected-confirmation-principal',
            mappingRevision: 'identity-mapping/1',
            principalEvidenceHash: DIGEST_A,
        });
        identityAuthority.evidence.add(authenticatedIdentityEvidence);
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration,
            nowEpochMs,
            runtimeEpochId,
            senderFence,
            strategyConfirmationControlPlaneAuthority: controlPlaneAuthority,
            repositoryOptions: {
                testOnlyAllowSyntheticGateManifestProjection: true,
                testOnlyExposureClockNowEpochMs: nowEpochMs + 500,
            },
        });
        openControllers.add({
            controller,
            stopAtEpochMs: nowEpochMs + 10_000,
        });
        expect(
            controller.acceptAuthenticatedIdentityEvidence(
                authenticatedIdentityEvidence,
            ),
        ).toMatchObject({ state: 'authenticated', fixedAccountCount: 1 });

        await expect(
            controller.executeReplayProtectedStrategyMutation({
                requestId: '123e4567-e89b-42d3-a456-426614174510',
                operationKind: 'risk_policy_publish',
                payloadHash: DIGEST_A,
                nowEpochMs: nowEpochMs + 10,
                mutation: {
                    kind: 'risk_policy_publish',
                    expectedRevision: null,
                    policy: protectedEntryRuntimeRiskPolicy(),
                    nowEpochMs: nowEpochMs + 10,
                },
            }),
        ).resolves.toMatchObject({
            state: 'completed',
            result: {
                state: 'reconciliation_required',
                brokerWriteAuthority: false,
            },
        });
        const reconciliation = issuedProtectedEntryReconciliation({
            apiGeneration,
            runtimeEpochId,
            asOfEpochMs: nowEpochMs + 50,
            tradeDate: '2026-08-11',
            dealIds: [],
            availableShares: 1_000,
            quantityShares: 1_000,
            positionLineageId: 'position-protected-confirmation',
        });
        await expect(
            controller.recordAccountReconciliation({
                brokerObservationEvidenceSha256: null,
                nowEpochMs: nowEpochMs + 60,
                result: reconciliation,
            }),
        ).resolves.toMatchObject({
            state: 'recorded',
            runtimeReadinessContribution: true,
            brokerWriteAuthority: false,
        });
        await controller.markReady({
            reconciliationEvidenceHash: reconciliation.evidenceSha256,
        });

        const databasePath = path.join(
            appSupportRoot,
            'smart-order',
            'database',
            'smart-orders.sqlite3',
        );
        await exerciseParentChildVertical();
        seedEligibleProtectedEntryGate(databasePath, nowEpochMs + 70);
        const contractEvidence = issuedProtectedEntryContractEvidence({
            apiGeneration,
            runtimeEpochId,
            observedAtEpochMs: nowEpochMs + 80,
        });
        for (const [index, mode] of ['timed', 'quantity'].entries()) {
            const strategyId = `scheduled-${mode}-disabled`;
            await controller.createDraftStrategy({
                strategyId,
                strategyKind: 'scheduled_quantity',
                workspaceContractKey: 'TSE:STK:2330',
                nowEpochMs: nowEpochMs + 81 + index * 3,
            });
            const scheduledDraft = canonicalSmartOrderDraft(
                'scheduled_quantity',
            );
            scheduledDraft.parameters.mode = mode;
            if (mode === 'quantity') {
                scheduledDraft.parameters.targetBaseShares = '5000';
                scheduledDraft.parameters.endTime = null;
                scheduledDraft.parameters.perOrderBaseShares = '2000';
            }
            await controller.replaceDraftStrategy({
                strategyId,
                expectedRevision: 0,
                draft: scheduledDraft,
                nowEpochMs: nowEpochMs + 82 + index * 3,
            });
            const disabledConfirmationId =
                `123e4567-e89b-42d3-a456-${426614174570 + index}`;
            await expect(
                controller.executeReplayProtectedStrategyMutation({
                    requestId: disabledConfirmationId,
                    operationKind: 'strategy_confirmation_preview',
                    payloadHash: `sha256:${String(index + 2).repeat(64)}`,
                    nowEpochMs: nowEpochMs + 83 + index * 3,
                    mutation: {
                        accountBrokerRef: 'broker-A',
                        accountIdRef: 'account-A',
                        basisSelection: null,
                        confirmationId: disabledConfirmationId,
                        contractEvidence,
                        controlPlaneAuthority,
                        expectedRevision: 1,
                        kind: 'strategy_confirmation_preview',
                        nowEpochMs: nowEpochMs + 83 + index * 3,
                        strategyId,
                    },
                }),
            ).resolves.toMatchObject({
                state: 'failed',
                replayed: false,
                result: {
                    code: 'strategy_service_unavailable',
                    status: 503,
                },
            });
        }
        await expect(controller.listSmartOrderQuoteDemands()).resolves.toEqual(
            [],
        );
        const scheduledDatabase = new DatabaseSync(databasePath, {
            readOnly: true,
        });
        expect(
            scheduledDatabase.prepare(`
                SELECT
                    (SELECT COUNT(*) FROM canonical_confirmation_snapshots
                      WHERE strategy_id LIKE 'scheduled-%-disabled') AS confirmations,
                    (SELECT COUNT(*) FROM activations
                      WHERE strategy_id LIKE 'scheduled-%-disabled') AS activations,
                    (SELECT COUNT(*) FROM order_intents
                      WHERE strategy_id LIKE 'scheduled-%-disabled') AS intents
            `).get(),
        ).toEqual({ confirmations: 0, activations: 0, intents: 0 });
        scheduledDatabase.close();
        const confirmationRequest = protectedEntryConfirmationRequest();
        const confirmationId = '123e4567-e89b-42d3-a456-426614174511';
        const previewRequest = {
            requestId: confirmationId,
            operationKind: 'protected_entry_confirmation_preview',
            payloadHash: DIGEST_B,
            nowEpochMs: nowEpochMs + 100,
            mutation: {
                confirmationId,
                confirmationRequest,
                contractEvidence,
                controlPlaneAuthority,
                kind: 'protected_entry_confirmation_preview',
                nowEpochMs: nowEpochMs + 100,
            },
        };
        const preview = await controller.executeReplayProtectedStrategyMutation(
            previewRequest,
        );
        expect(preview).toMatchObject({
            state: 'completed',
            replayed: false,
            result: {
                state: 'previewed',
                durablePreparationState: 'none',
                brokerWriteAttempted: false,
                brokerWriteAuthority: false,
                accountIdentifiersExposed: false,
                entityIdentifiersExposed: false,
            },
        });
        await expect(
            controller.executeReplayProtectedStrategyMutation(previewRequest),
        ).resolves.toMatchObject({
            state: 'completed',
            replayed: true,
            result: {
                state: 'previewed',
                brokerWriteAttempted: false,
                brokerWriteAuthority: false,
            },
        });
        const acceptRequest = {
                requestId: '123e4567-e89b-42d3-a456-426614174512',
                operationKind: 'protected_entry_confirmation_accept',
                payloadHash: `sha256:${'e'.repeat(64)}`,
                nowEpochMs: nowEpochMs + 110,
                mutation: {
                    confirmationId,
                    confirmationRequest,
                    contractEvidence,
                    controlPlaneAuthority,
                    kind: 'protected_entry_confirmation_accept',
                    nowEpochMs: nowEpochMs + 110,
                    snapshotHash: preview.result.snapshotHash,
                    userAcknowledged: true,
                },
            };
        await expect(
            controller.gateManifestStatus({
                provenance: 'automation',
                nowEpochMs: nowEpochMs + 110,
            }),
        ).resolves.toMatchObject({
            state: 'eligible',
            manifestRevision: 'automation-protection-r1',
            manifestSha256: `sha256:${'c'.repeat(64)}`,
            mappingRevision: 'mapping-r1',
        });
        await expect(
            controller.executeReplayProtectedStrategyMutation(acceptRequest),
        ).resolves.toMatchObject({
            state: 'completed',
            replayed: false,
            result: {
                state: 'accepted',
                durablePreparationState: 'prepared',
                brokerWriteAttempted: false,
                brokerWriteAuthority: false,
            },
        });
        await expect(
            controller.executeReplayProtectedStrategyMutation(acceptRequest),
        ).resolves.toMatchObject({
            state: 'completed',
            replayed: true,
            result: {
                state: 'accepted',
                durablePreparationState: 'prepared',
                brokerWriteAttempted: false,
                brokerWriteAuthority: false,
            },
        });

        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database.prepare(`
                SELECT
                    (SELECT COUNT(*) FROM strategies WHERE state='observing') AS strategies,
                    (SELECT COUNT(*) FROM activations WHERE state='prepared') AS activations,
                    (SELECT COUNT(*) FROM order_intents WHERE state='prepared') AS intents,
                    (SELECT COUNT(*) FROM entry_exposure_reservations WHERE state='reserved') AS reservations,
                    (SELECT COUNT(*) FROM pending_protection_commitments WHERE state='pending_entry_fill') AS commitments,
                    (SELECT COUNT(*) FROM protection_obligations WHERE state='pending_entry_fill') AS obligations,
                    (SELECT COUNT(*) FROM exit_claims
                      JOIN protection_obligations USING(obligation_id)
                     WHERE protection_obligations.state='pending_entry_fill') AS exit_claims
            `).get(),
        ).toEqual({
            strategies: 1,
            activations: 1,
            intents: 1,
            reservations: 1,
            commitments: 1,
            obligations: 1,
            exit_claims: 0,
        });
        const exposureHeads = database.prepare(`
            SELECT account.reserved_dimensions_json AS account_dimensions,
                   identity.reserved_dimensions_json AS identity_dimensions,
                   account.policy_hash AS account_policy_hash,
                   identity.policy_hash AS identity_policy_hash,
                   account.policy_revision AS account_policy_revision,
                   identity.policy_revision AS identity_policy_revision
              FROM exposure_account_arbiter_heads AS account
              JOIN exposure_identity_arbiter_heads AS identity
                ON identity.identity_group_id=account.identity_group_id
        `).get();
        expect({
            dimensions: exposureHeads.account_dimensions,
            policy_hash: exposureHeads.account_policy_hash,
            policy_revision: exposureHeads.account_policy_revision,
        }).toEqual({
            dimensions: exposureHeads.identity_dimensions,
            policy_hash: exposureHeads.identity_policy_hash,
            policy_revision: exposureHeads.identity_policy_revision,
        });
        database.close();
        await expect(controller.lifecycleAudit()).resolves.toMatchObject({
            counts: { side_effect_intents: 0 },
        });

        const confirmExistingPosition = async ({
            basisSelection,
            confirmationId: existingConfirmationId,
            contractOverrides,
            contractEvidence: suppliedConfirmationContractEvidence,
            draftKind,
            expectAcceptFailure = false,
            expectPreviewFailure = false,
            strategyId,
            timestampOffset,
        }) => {
            await controller.createDraftStrategy({
                strategyId,
                strategyKind: draftKind,
                workspaceContractKey: 'TSE:STK:2330',
                nowEpochMs: nowEpochMs + timestampOffset,
            });
            const draft = canonicalSmartOrderDraft(draftKind);
            if (draftKind === 'stop_take') {
                draft.parameters.legs = draft.parameters.legs.map((leg) => ({
                    ...leg,
                    distance: {
                        kind: 'fixed_atr',
                        // Deliberately hostile but canonical draft placeholders:
                        // Runtime confirmation must replace both values with
                        // its verifier-issued snapshot before persistence.
                        atr: '9',
                        multiplier: '2',
                        atrSnapshotRevision: 'caller-must-not-authorize-atr',
                    },
                    triggerPrice: leg.type === 'stop' ? '82' : '118',
                    triggerTicks: leg.type === 'stop' ? '164' : '236',
                }));
            } else if (draftKind === 'trailing_exit') {
                draft.parameters.activationPrice = '103';
                draft.parameters.retracement = {
                    kind: 'fixed_atr',
                    atr: '9',
                    multiplier: '2',
                    atrSnapshotRevision: 'caller-must-not-authorize-atr',
                };
                draft.parameters.fixedStopPrice = '95';
            }
            const updated = await controller.replaceDraftStrategy({
                strategyId,
                expectedRevision: 0,
                draft,
                nowEpochMs: nowEpochMs + timestampOffset + 1,
            });
            expect(updated).toMatchObject({
                state: 'draft',
                revision: 1,
                strategyKind: draftKind,
            });
            const draftRequiresFixedAtr =
                draftKind === 'stop_take'
                    ? draft.parameters.legs.some(
                          (leg) => leg.distance.kind === 'fixed_atr',
                      )
                    : [
                          draft.parameters.retracement,
                      ].some((distance) => distance.kind === 'fixed_atr');
            const confirmationContractEvidence =
                suppliedConfirmationContractEvidence ??
                issuedProtectedEntryContractEvidence({
                    apiGeneration,
                    runtimeEpochId,
                    observedAtEpochMs:
                        nowEpochMs + timestampOffset + 1,
                    contractOverrides,
                    fixedAtrContext: draftRequiresFixedAtr
                        ? {
                              decisionTradingDate: '2026-08-11',
                              strategyDefinitionHash:
                                  updated.definitionHash,
                          }
                        : null,
                });
            const existingPreview =
                await controller.executeReplayProtectedStrategyMutation({
                    requestId: existingConfirmationId,
                    operationKind: 'strategy_confirmation_preview',
                    payloadHash: `sha256:${String(timestampOffset).padStart(64, '0')}`,
                    nowEpochMs: nowEpochMs + timestampOffset + 2,
                    mutation: {
                        accountBrokerRef: 'broker-A',
                        accountIdRef: 'account-A',
                        basisSelection,
                        confirmationId: existingConfirmationId,
                        contractEvidence: confirmationContractEvidence,
                        controlPlaneAuthority,
                        expectedRevision: 1,
                        kind: 'strategy_confirmation_preview',
                        nowEpochMs: nowEpochMs + timestampOffset + 2,
                        strategyId,
                    },
                });
            if (expectPreviewFailure) {
                expect(existingPreview).toMatchObject({
                    state: 'failed',
                    replayed: false,
                    result: {
                        code: 'strategy_service_unavailable',
                        status: 503,
                    },
                });
                return existingPreview.result;
            }
            expect(existingPreview).toMatchObject({
                state: 'completed',
                replayed: false,
                result: {
                    state: 'previewed',
                    strategyKind: draftKind,
                    position: {
                        averageCostState: 'available',
                        basisSource: basisSelection.source,
                        basisPriceMinorUnits:
                            basisSelection.source === 'broker_average_cost'
                                ? 10_000
                                : 10_100,
                    },
                    brokerWriteAttempted: false,
                    brokerWriteAuthority: false,
                    accountIdentifiersExposed: false,
                },
            });
            const accepted =
                await controller.executeReplayProtectedStrategyMutation({
                    requestId: `${existingConfirmationId.slice(0, -1)}${
                        existingConfirmationId.endsWith('8') ? '9' : '8'
                    }`,
                    operationKind: 'strategy_confirmation_accept',
                    payloadHash: `sha256:${String(timestampOffset + 1).padStart(64, '0')}`,
                    nowEpochMs: nowEpochMs + timestampOffset + 3,
                    mutation: {
                        accountBrokerRef: 'broker-A',
                        accountIdRef: 'account-A',
                        basisSelection,
                        confirmationId: existingConfirmationId,
                        contractEvidence: confirmationContractEvidence,
                        controlPlaneAuthority,
                        expectedRevision: 1,
                        kind: 'strategy_confirmation_accept',
                        nowEpochMs: nowEpochMs + timestampOffset + 3,
                        snapshotHash: existingPreview.result.snapshotHash,
                        strategyId,
                        userAcknowledged: true,
                    },
                });
            if (expectAcceptFailure) {
                expect(accepted).toMatchObject({
                    state: 'failed',
                    replayed: false,
                    result: {
                        code: 'strategy_service_unavailable',
                        status: 503,
                    },
                });
                return accepted.result;
            }
            expect(accepted).toMatchObject({
                state: 'completed',
                result: {
                    state: 'accepted',
                    strategy: {
                        accountBound: true,
                        revision: 2,
                        state: 'paused',
                        strategyId,
                    },
                    brokerWriteAttempted: false,
                    brokerWriteAuthority: false,
                },
            });
            return accepted.result;
        };
        await confirmExistingPosition({
            basisSelection: { source: 'broker_average_cost' },
            confirmationId: '123e4567-e89b-42d3-a456-426614174508',
            contractEvidence: issuedProtectedEntryContractEvidence({
                apiGeneration,
                runtimeEpochId,
                observedAtEpochMs: nowEpochMs + 106,
                fixedAtrContext: null,
            }),
            draftKind: 'stop_take',
            expectPreviewFailure: true,
            strategyId: 'existing-position-missing-atr-denied',
            timestampOffset: 105,
        });
        const missingAtrDatabase = new DatabaseSync(databasePath, {
            readOnly: true,
        });
        expect(
            missingAtrDatabase.prepare(`
                SELECT
                    (SELECT COUNT(*) FROM canonical_confirmation_snapshots
                      WHERE strategy_id='existing-position-missing-atr-denied')
                        AS confirmations,
                    (SELECT COUNT(*) FROM existing_position_protection_heads
                      WHERE strategy_id='existing-position-missing-atr-denied')
                        AS heads
            `).get(),
        ).toEqual({ confirmations: 0, heads: 0 });
        missingAtrDatabase.close();
        const acceptedStopTake = await confirmExistingPosition({
            basisSelection: { source: 'broker_average_cost' },
            confirmationId: '123e4567-e89b-42d3-a456-426614174518',
            draftKind: 'stop_take',
            strategyId: 'existing-position-average-cost',
            timestampOffset: 112,
        });
        expect(acceptedStopTake.existingPositionProtection).toMatchObject({
            exitClaimId: expect.stringMatching(/^claim:existing-position:/),
            obligationId: expect.stringMatching(/^obligation:existing-position:/),
            protectionGroupId: expect.stringMatching(
                /^protection-group:existing-position:/,
            ),
            planHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        });
        expect(acceptedStopTake.strategy.activity.formalProtection).toMatchObject({
            state: 'formal',
            cumulativeFilledShares: 1_000,
            estimatedBasis: {
                numeratorMinorUnits: '10000',
                denominator: '1',
            },
            formalBasis: {
                numeratorMinorUnits: '10000',
                denominator: '1',
            },
            legs: [
                {
                    type: 'stop',
                    triggerState: 'formal',
                    formalTriggerPrice: {
                        numeratorMinorUnits: '9600',
                        denominator: '1',
                    },
                    differsFromEstimate: false,
                },
                {
                    type: 'take',
                    triggerState: 'formal',
                    formalTriggerPrice: {
                        numeratorMinorUnits: '10400',
                        denominator: '1',
                    },
                    differsFromEstimate: false,
                },
            ],
            accountIdentifiersExposed: false,
            entityIdentifiersExposed: false,
        });
        await expect(
            controller.executeReplayProtectedStrategyMutation({
                requestId: '123e4567-e89b-42d3-a456-426614174517',
                operationKind: 'strategy_resume',
                payloadHash: `sha256:${'2'.repeat(64)}`,
                nowEpochMs: nowEpochMs + 116,
                mutation: {
                    activationPolicyAcknowledged: true,
                    contractEvidence: null,
                    controlPlaneAuthority,
                    expectedRevision: 2,
                    kind: 'resume',
                    nowEpochMs: nowEpochMs + 116,
                    strategyId: 'existing-position-average-cost',
                },
            }),
        ).resolves.toMatchObject({
            state: 'completed',
            result: { state: 'monitoring', revision: 3 },
        });
        await expect(controller.listProtectiveQuoteDemands()).resolves.toEqual([
            expect.objectContaining({
                consumerId: expect.stringMatching(/^protection:[0-9a-f]{64}$/),
                contract: {
                    code: '2330',
                    exchange: 'TSE',
                    securityType: 'STK',
                },
                quoteType: 'tick',
            }),
        ]);
        const triggerAtEpochMs = nowEpochMs + 117;
        const protectiveObservation = issuedProtectiveQuoteObservation({
            apiGeneration,
            connectionId: 'existing-position-stop-take-stream',
            eventDate: '2026-08-11',
            eventTime: '00:00:01.117000',
            nowEpochMs: triggerAtEpochMs,
        });
        const triggerClock = vi
            .spyOn(Date, 'now')
            .mockReturnValue(triggerAtEpochMs);
        await expect(
            controller.recordProtectiveQuoteObservation({
                observation: protectiveObservation,
            }),
        ).resolves.toMatchObject({
            state: 'winner_prepared',
            observedGroupCount: 1,
            preparedWinnerCount: 1,
            automaticDispatchAllowed: false,
            brokerWriteAuthority: false,
        });
        triggerClock.mockRestore();
        const stopTakeDatabase = new DatabaseSync(databasePath, {
            readOnly: true,
        });
        expect(
            stopTakeDatabase.prepare(`
                SELECT strategies.state AS strategy_state,
                       obligations.commitment_id,
                       obligations.state AS obligation_state,
                       claims.state AS claim_state,
                       groups.state AS group_state,
                       generations.state AS generation_state,
                       intents.state AS intent_state,
                       intents.side, intents.adapter_authority_granted
                  FROM existing_position_protection_heads AS heads
                  JOIN strategies USING(strategy_id)
                  JOIN protection_obligations AS obligations
                    ON obligations.obligation_id=heads.obligation_id
                  JOIN exit_claims AS claims
                    ON claims.exit_claim_id=heads.exit_claim_id
                  JOIN protection_groups AS groups
                    ON groups.exit_claim_id=claims.exit_claim_id
                  JOIN protection_remainder_generations AS generations
                    ON generations.protection_group_id=groups.protection_group_id
                   AND generations.remainder_generation=groups.current_generation
                  JOIN order_intents AS intents
                    ON intents.intent_id=generations.winner_intent_id
                 WHERE heads.strategy_id='existing-position-average-cost'
            `).get(),
        ).toEqual({
            strategy_state: 'monitoring',
            commitment_id: null,
            obligation_state: 'monitoring',
            claim_state: 'intent_reserved',
            group_state: 'winner_selected',
            generation_state: 'winner_selected',
            intent_state: 'prepared',
            side: 'Sell',
            adapter_authority_granted: 0,
        });
        expect(
            stopTakeDatabase.prepare(`
                SELECT COUNT(*) AS count
                  FROM pending_protection_commitments
                 WHERE strategy_id='existing-position-average-cost'
            `).get(),
        ).toEqual({ count: 0 });
        stopTakeDatabase.close();

        // Model the exact durable result of the already-covered broker-event
        // plus reconciliation settlement, then exercise the production
        // replay-protected user-arm and quote paths for the remainder.  The
        // old winner is terminal and cannot authorize another broker byte.
        const remainderDatabase = new DatabaseSync(databasePath);
        const remainderLineage = remainderDatabase.prepare(`
            SELECT heads.protection_plan_json, heads.exit_claim_id,
                   heads.obligation_id, groups.protection_group_id,
                   groups.current_generation, generations.winner_intent_id,
                   generations.winner_activation_id
              FROM existing_position_protection_heads AS heads
              JOIN protection_groups AS groups
                ON groups.exit_claim_id=heads.exit_claim_id
              JOIN protection_remainder_generations AS generations
                ON generations.protection_group_id=groups.protection_group_id
               AND generations.remainder_generation=groups.current_generation
             WHERE heads.strategy_id='existing-position-average-cost'
        `).get();
        const remainderPlan = canonicalExistingPositionProtectionPlan(
            JSON.parse(remainderLineage.protection_plan_json),
        );
        const remainderFormal = deriveExistingPositionFormalProtection(
            remainderPlan.plan,
            500,
        );
        const remainderFormalJson = canonicalJson(remainderFormal);
        const remainderFormalHash = `sha256:${createHash('sha256')
            .update(remainderFormalJson)
            .digest('hex')}`;
        remainderDatabase.exec('BEGIN IMMEDIATE');
        try {
            remainderDatabase.prepare(`
                UPDATE order_intents
                   SET state='terminal',
                       terminal_outcome='protective_partial_fill_terminal',
                       terminal_at_epoch_ms=?, updated_at_epoch_ms=?,
                       revision=revision+1
                 WHERE intent_id=? AND state='prepared'
            `).run(
                nowEpochMs + 117,
                nowEpochMs + 117,
                remainderLineage.winner_intent_id,
            );
            remainderDatabase.prepare(`
                UPDATE activations
                   SET state='part_filled', updated_at_epoch_ms=?,
                       revision=revision+1
                 WHERE activation_id=?
            `).run(
                nowEpochMs + 117,
                remainderLineage.winner_activation_id,
            );
            remainderDatabase.prepare(`
                UPDATE protection_remainder_generations
                   SET state='terminal', terminal_at_epoch_ms=?,
                       updated_at_epoch_ms=?, revision=revision+1
                 WHERE protection_group_id=? AND remainder_generation=0
            `).run(
                nowEpochMs + 117,
                nowEpochMs + 117,
                remainderLineage.protection_group_id,
            );
            remainderDatabase.prepare(`
                UPDATE exit_claims
                   SET intent_id=NULL, remainder_generation=1,
                       allocation_start_share=allocation_start_share+500,
                       quantity_shares=500, state='monitoring_reserved',
                       terminal_at_epoch_ms=NULL, updated_at_epoch_ms=?,
                       revision=revision+1
                 WHERE exit_claim_id=? AND state='intent_reserved'
            `).run(nowEpochMs + 117, remainderLineage.exit_claim_id);
            remainderDatabase.prepare(`
                UPDATE protection_groups
                   SET state='rearm_required', current_generation=1,
                       updated_at_epoch_ms=?, revision=revision+1
                 WHERE protection_group_id=? AND state='winner_selected'
            `).run(nowEpochMs + 117, remainderLineage.protection_group_id);
            remainderDatabase.prepare(`
                INSERT INTO protection_remainder_generations(
                    protection_group_id, remainder_generation, exit_claim_id,
                    state, quantity_shares, evidence_hash,
                    created_at_epoch_ms, updated_at_epoch_ms, revision
                ) VALUES (?, 1, ?, 'rearm_required', 500, ?, ?, ?, 0)
            `).run(
                remainderLineage.protection_group_id,
                remainderLineage.exit_claim_id,
                DIGEST_B,
                nowEpochMs + 117,
                nowEpochMs + 117,
            );
            remainderDatabase.prepare(`
                UPDATE existing_position_protection_heads
                   SET formal_protection_json=?, formal_protection_hash=?,
                       updated_at_epoch_ms=?, revision=revision+1
                 WHERE strategy_id='existing-position-average-cost'
            `).run(
                remainderFormalJson,
                remainderFormalHash,
                nowEpochMs + 117,
            );
            remainderDatabase.prepare(`
                UPDATE protection_obligations
                   SET state='partially_exited', confirmed_exited_shares=500,
                       updated_at_epoch_ms=?, revision=revision+1
                 WHERE obligation_id=?
            `).run(nowEpochMs + 117, remainderLineage.obligation_id);
            remainderDatabase.prepare(`
                UPDATE strategies
                   SET state='paused', updated_at_epoch_ms=?, revision=revision+1
                 WHERE strategy_id='existing-position-average-cost'
                   AND state='monitoring' AND revision=3
            `).run(nowEpochMs + 117);
            remainderDatabase.prepare(`
                UPDATE intent_rearm_authorizations
                   SET state='superseded', revision=revision+1
                 WHERE intent_id=? AND state='active'
            `).run(remainderLineage.winner_intent_id);
            remainderDatabase.exec('COMMIT');
        } catch (error) {
            remainderDatabase.exec('ROLLBACK');
            remainderDatabase.close();
            throw error;
        }
        remainderDatabase.close();

        await expect(
            controller.executeReplayProtectedStrategyMutation({
                requestId: '123e4567-e89b-42d3-a456-426614174699',
                operationKind: 'strategy_resume',
                payloadHash: `sha256:${'4'.repeat(64)}`,
                nowEpochMs: nowEpochMs + 118,
                mutation: {
                    activationPolicyAcknowledged: true,
                    contractEvidence: null,
                    controlPlaneAuthority,
                    expectedRevision: 4,
                    kind: 'resume',
                    nowEpochMs: nowEpochMs + 118,
                    strategyId: 'existing-position-average-cost',
                },
            }),
        ).resolves.toMatchObject({
            state: 'failed',
            replayed: false,
            result: {
                code: 'strategy_service_unavailable',
                status: 503,
            },
        });
        await expect(
            controller.executeReplayProtectedStrategyMutation({
                requestId: '123e4567-e89b-42d3-a456-426614174700',
                operationKind: 'strategy_resume',
                payloadHash: `sha256:${'3'.repeat(64)}`,
                nowEpochMs: nowEpochMs + 118,
                mutation: {
                    activationPolicyAcknowledged: true,
                    contractEvidence: issuedProtectedEntryContractEvidence({
                        apiGeneration,
                        runtimeEpochId,
                        observedAtEpochMs: nowEpochMs + 118,
                    }),
                    controlPlaneAuthority,
                    expectedRevision: 4,
                    kind: 'resume',
                    nowEpochMs: nowEpochMs + 118,
                    strategyId: 'existing-position-average-cost',
                },
            }),
        ).resolves.toMatchObject({
            state: 'completed',
            result: { state: 'monitoring', revision: 5 },
        });
        const remainderObservation = issuedProtectiveQuoteObservation({
            apiGeneration,
            connectionId: 'existing-position-remainder-stream',
            eventDate: '2026-08-11',
            eventTime: '00:00:01.119000',
            nowEpochMs: nowEpochMs + 119,
            sequence: 2,
        });
        const remainderClock = vi
            .spyOn(Date, 'now')
            .mockReturnValue(nowEpochMs + 119);
        await expect(
            controller.recordProtectiveQuoteObservation({
                observation: remainderObservation,
            }),
        ).resolves.toMatchObject({
            state: 'winner_prepared',
            observedGroupCount: 1,
            preparedWinnerCount: 1,
            automaticDispatchAllowed: false,
            brokerWriteAuthority: false,
        });
        remainderClock.mockRestore();
        const rearmedDatabase = new DatabaseSync(databasePath, {
            readOnly: true,
        });
        expect(
            rearmedDatabase.prepare(`
                SELECT strategies.state AS strategy_state,
                       groups.state AS group_state,
                       groups.current_generation,
                       generations.state AS generation_state,
                       generations.quantity_shares,
                       intents.state AS intent_state,
                       json_extract(intents.payload_json, '$.quantityShares')
                           AS intent_quantity_shares,
                       intents.adapter_authority_granted
                  FROM existing_position_protection_heads AS heads
                  JOIN strategies USING(strategy_id)
                  JOIN protection_groups AS groups
                    ON groups.exit_claim_id=heads.exit_claim_id
                  JOIN protection_remainder_generations AS generations
                    ON generations.protection_group_id=groups.protection_group_id
                   AND generations.remainder_generation=groups.current_generation
                  JOIN order_intents AS intents
                    ON intents.intent_id=generations.winner_intent_id
                 WHERE heads.strategy_id='existing-position-average-cost'
            `).get(),
        ).toEqual({
            strategy_state: 'monitoring',
            group_state: 'winner_selected',
            current_generation: 1,
            generation_state: 'winner_selected',
            quantity_shares: 500,
            intent_state: 'prepared',
            intent_quantity_shares: 500,
            adapter_authority_granted: 0,
        });
        rearmedDatabase.close();
        await confirmExistingPosition({
            basisSelection: { source: 'broker_average_cost' },
            confirmationId: '123e4567-e89b-42d3-a456-426614174598',
            draftKind: 'stop_take',
            expectAcceptFailure: true,
            strategyId: 'existing-position-overlap-denied',
            timestampOffset: 118,
        });
        const overlapDatabase = new DatabaseSync(databasePath, {
            readOnly: true,
        });
        expect(
            overlapDatabase.prepare(`
                SELECT strategies.state, strategies.revision,
                       confirmations.state AS confirmation_state,
                       (SELECT COUNT(*) FROM protection_obligations
                         WHERE strategy_id=strategies.strategy_id) AS obligations,
                       (SELECT COUNT(*) FROM existing_position_protection_heads
                         WHERE strategy_id=strategies.strategy_id) AS heads
                  FROM strategies
                  JOIN canonical_confirmation_snapshots AS confirmations
                    ON confirmations.strategy_id=strategies.strategy_id
                 WHERE strategies.strategy_id='existing-position-overlap-denied'
            `).get(),
        ).toEqual({
            state: 'draft',
            revision: 1,
            confirmation_state: 'previewed',
            obligations: 0,
            heads: 0,
        });
        overlapDatabase.close();
        await confirmExistingPosition({
            basisSelection: {
                source: 'user_specified',
                priceDecimal: '101',
            },
            confirmationId: '123e4567-e89b-42d3-a456-426614174528',
            draftKind: 'trailing_exit',
            expectAcceptFailure: true,
            strategyId: 'existing-position-user-basis',
            timestampOffset: 122,
        });

        const faultConfirmationId =
            '123e4567-e89b-42d3-a456-426614174530';
        const faultContractEvidence = issuedProtectedEntryContractEvidence({
            apiGeneration,
            runtimeEpochId,
            observedAtEpochMs: nowEpochMs + 130,
        });
        const faultPreview =
            await controller.executeReplayProtectedStrategyMutation({
                ...previewRequest,
                requestId: faultConfirmationId,
                nowEpochMs: nowEpochMs + 131,
                mutation: {
                    ...previewRequest.mutation,
                    confirmationId: faultConfirmationId,
                    contractEvidence: faultContractEvidence,
                    nowEpochMs: nowEpochMs + 131,
                },
            });
        expect(faultPreview).toMatchObject({
            state: 'completed',
            result: { state: 'previewed', brokerWriteAuthority: false },
        });
        const faultDatabase = new DatabaseSync(databasePath);
        faultDatabase.exec(`
            CREATE TRIGGER protected_confirmation_accept_fault
            BEFORE INSERT ON protection_obligations
            BEGIN
                SELECT RAISE(ABORT, 'protected confirmation acceptance fault');
            END;
        `);
        faultDatabase.close();
        await expect(
            controller.executeReplayProtectedStrategyMutation({
                requestId: '123e4567-e89b-42d3-a456-426614174531',
                operationKind: 'protected_entry_confirmation_accept',
                payloadHash: `sha256:${'1'.repeat(64)}`,
                nowEpochMs: nowEpochMs + 132,
                mutation: {
                    ...previewRequest.mutation,
                    confirmationId: faultConfirmationId,
                    contractEvidence: faultContractEvidence,
                    kind: 'protected_entry_confirmation_accept',
                    nowEpochMs: nowEpochMs + 132,
                    snapshotHash: faultPreview.result.snapshotHash,
                    userAcknowledged: true,
                },
            }),
        ).resolves.toMatchObject({ state: 'failed', replayed: false });
        const rollbackDatabase = new DatabaseSync(databasePath);
        rollbackDatabase.exec('DROP TRIGGER protected_confirmation_accept_fault');
        expect(
            rollbackDatabase.prepare(`
                SELECT strategies.state, strategies.revision,
                       confirmations.state AS confirmation_state,
                       confirmations.revision AS confirmation_revision,
                       (SELECT COUNT(*) FROM activations
                         WHERE strategy_id=strategies.strategy_id) AS activations,
                       (SELECT COUNT(*) FROM order_intents
                         WHERE strategy_id=strategies.strategy_id) AS intents,
                       (SELECT COUNT(*) FROM entry_exposure_reservations
                         WHERE strategy_id=strategies.strategy_id) AS reservations,
                       (SELECT COUNT(*) FROM pending_protection_commitments
                         WHERE strategy_id=strategies.strategy_id) AS commitments,
                       (SELECT COUNT(*) FROM protection_obligations
                         WHERE strategy_id=strategies.strategy_id) AS obligations
                  FROM canonical_confirmation_snapshots AS confirmations
                  JOIN strategies
                    ON strategies.strategy_id=confirmations.strategy_id
                 WHERE confirmations.confirmation_id=?
            `).get(faultConfirmationId),
        ).toEqual({
            state: 'draft',
            revision: 0,
            confirmation_state: 'previewed',
            confirmation_revision: 0,
            activations: 0,
            intents: 0,
            reservations: 0,
            commitments: 0,
            obligations: 0,
        });
        const acceptedIntent = rollbackDatabase.prepare(`
            SELECT intents.intent_id, intents.revision,
                   epochs.reconciliation_evidence_hash,
                   confirmations.risk_revision
              FROM order_intents AS intents
              JOIN canonical_confirmation_snapshots AS confirmations
                ON confirmations.strategy_id=intents.strategy_id
              JOIN runtime_epochs AS epochs
                ON epochs.runtime_epoch_id=?
             WHERE confirmations.confirmation_id=?
        `).get(runtimeEpochId, confirmationId);
        rollbackDatabase.prepare(`
            UPDATE order_intents SET revision=revision+1
             WHERE intent_id=? AND state='prepared' AND revision=?
        `).run(acceptedIntent.intent_id, acceptedIntent.revision);
        rollbackDatabase.prepare(`
            INSERT INTO intent_rearm_authorizations(
                rearm_authorization_id, intent_id, runtime_epoch_id,
                sender_fence, api_generation, rearm_request_id,
                authorized_intent_revision, confirmation_snapshot_hash,
                risk_revision, reconciliation_evidence_hash,
                user_rearm_evidence_hash, state, authorized_at_epoch_ms,
                revision
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0)
        `).run(
            'rearm-confirmation-currentness',
            acceptedIntent.intent_id,
            runtimeEpochId,
            senderFence,
            apiGeneration,
            'rearm-request-confirmation-currentness',
            acceptedIntent.revision + 1,
            preview.result.snapshotHash,
            acceptedIntent.risk_revision,
            acceptedIntent.reconciliation_evidence_hash,
            DIGEST_A,
            nowEpochMs + 121,
        );
        rollbackDatabase.exec(`
            UPDATE order_intents
               SET state='terminal', terminal_outcome='test_final_exit',
                   terminal_at_epoch_ms=${nowEpochMs + 121},
                   updated_at_epoch_ms=${nowEpochMs + 121},
                   revision=revision+1
             WHERE strategy_id='existing-position-average-cost'
               AND state='prepared';
            UPDATE activations
               SET state='filled', updated_at_epoch_ms=${nowEpochMs + 121},
                   revision=revision+1
             WHERE strategy_id='existing-position-average-cost'
               AND state NOT IN ('filled','cancelled','failed','missed');
            UPDATE protection_remainder_generations
               SET state='terminal', terminal_at_epoch_ms=${nowEpochMs + 121},
                   updated_at_epoch_ms=${nowEpochMs + 121},
                   revision=revision+1
             WHERE protection_group_id IN (
                SELECT groups.protection_group_id
                  FROM protection_groups AS groups
                  JOIN protection_obligations AS obligations
                    ON obligations.obligation_id=groups.obligation_id
                 WHERE obligations.strategy_id='existing-position-average-cost'
             );
            UPDATE protection_groups
               SET state='fulfilled', terminal_at_epoch_ms=${nowEpochMs + 121},
                   updated_at_epoch_ms=${nowEpochMs + 121},
                   revision=revision+1
             WHERE obligation_id IN (
                SELECT obligation_id FROM protection_obligations
                 WHERE strategy_id='existing-position-average-cost'
             );
            UPDATE exit_claims
               SET state='released', intent_id=NULL,
                   terminal_at_epoch_ms=${nowEpochMs + 121},
                   updated_at_epoch_ms=${nowEpochMs + 121},
                   revision=revision+1
             WHERE obligation_id IN (
                SELECT obligation_id FROM protection_obligations
                 WHERE strategy_id='existing-position-average-cost'
             );
            UPDATE protection_obligations
               SET state='fulfilled', confirmed_exited_shares=filled_shares,
                   terminal_at_epoch_ms=${nowEpochMs + 121},
                   updated_at_epoch_ms=${nowEpochMs + 121},
                   revision=revision+1
             WHERE strategy_id='existing-position-average-cost';
            UPDATE strategies
               SET state='completed', terminal_at_epoch_ms=${nowEpochMs + 121},
                   updated_at_epoch_ms=${nowEpochMs + 121},
                   revision=revision+1
             WHERE strategy_id='existing-position-average-cost';
        `);
        rollbackDatabase.close();

        await confirmExistingPosition({
            basisSelection: { source: 'broker_average_cost' },
            confirmationId: '123e4567-e89b-42d3-a456-426614174538',
            contractOverrides: { updateDate: '2026-08-12' },
            draftKind: 'trailing_exit',
            strategyId: 'existing-position-current-contract-head',
            timestampOffset: 141,
        });
        const changedContractEvidence = issuedProtectedEntryContractEvidence({
            apiGeneration,
            runtimeEpochId,
            observedAtEpochMs: nowEpochMs + 144,
            contractOverrides: { updateDate: '2026-08-12' },
        });
        const postContractDriftDatabase = new DatabaseSync(databasePath, {
            readOnly: true,
        });
        expect(
            postContractDriftDatabase.prepare(`
                SELECT confirmation_id, state
                  FROM canonical_confirmation_snapshots
                 WHERE confirmation_id IN (?, ?, ?, ?)
                 ORDER BY confirmation_id
            `).all(
                confirmationId,
                '123e4567-e89b-42d3-a456-426614174518',
                '123e4567-e89b-42d3-a456-426614174528',
                '123e4567-e89b-42d3-a456-426614174538',
            ),
        ).toEqual([
            { confirmation_id: confirmationId, state: 'superseded' },
            {
                confirmation_id: '123e4567-e89b-42d3-a456-426614174518',
                state: 'superseded',
            },
            {
                confirmation_id: '123e4567-e89b-42d3-a456-426614174528',
                state: 'previewed',
            },
            {
                confirmation_id: '123e4567-e89b-42d3-a456-426614174538',
                state: 'accepted',
            },
        ]);
        expect(
            postContractDriftDatabase.prepare(`
                SELECT state, revision
                  FROM intent_rearm_authorizations
                 WHERE rearm_authorization_id='rearm-confirmation-currentness'
            `).get(),
        ).toEqual({ state: 'superseded', revision: 1 });
        postContractDriftDatabase.close();

        const driftConfirmationId =
            '123e4567-e89b-42d3-a456-426614174514';
        const driftPreview = await controller.executeReplayProtectedStrategyMutation({
            ...previewRequest,
            requestId: driftConfirmationId,
            nowEpochMs: nowEpochMs + 145,
            mutation: {
                ...previewRequest.mutation,
                confirmationId: driftConfirmationId,
                contractEvidence: changedContractEvidence,
                nowEpochMs: nowEpochMs + 145,
            },
        });
        expect(driftPreview).toMatchObject({
            state: 'completed',
            result: { state: 'previewed', brokerWriteAuthority: false },
        });
        const changedReconciliation = issuedProtectedEntryReconciliation({
            apiGeneration,
            runtimeEpochId,
            asOfEpochMs: nowEpochMs + 150,
            tradeDate: '2026-08-11',
            dealIds: [],
            availableShares: 0,
            quantityShares: 0,
            positionLineageId: 'position-protected-confirmation',
        });
        await expect(
            controller.recordAccountReconciliation({
                brokerObservationEvidenceSha256: null,
                nowEpochMs: nowEpochMs + 155,
                result: changedReconciliation,
            }),
        ).resolves.toMatchObject({
            state: 'recorded',
            runtimeReadinessContribution: true,
            brokerWriteAuthority: false,
        });
        await expect(
            controller.executeReplayProtectedStrategyMutation({
                requestId: '123e4567-e89b-42d3-a456-426614174515',
                operationKind: 'protected_entry_confirmation_accept',
                payloadHash: `sha256:${'f'.repeat(64)}`,
                nowEpochMs: nowEpochMs + 160,
                mutation: {
                    ...previewRequest.mutation,
                    confirmationId: driftConfirmationId,
                    contractEvidence: changedContractEvidence,
                    kind: 'protected_entry_confirmation_accept',
                    nowEpochMs: nowEpochMs + 160,
                    snapshotHash: driftPreview.result.snapshotHash,
                    userAcknowledged: true,
                },
            }),
        ).resolves.toMatchObject({
            state: 'failed',
            replayed: false,
        });
        const postDriftDatabase = new DatabaseSync(databasePath, {
            readOnly: true,
        });
        expect(
            postDriftDatabase
                .prepare(`
                    SELECT COUNT(*) AS count FROM order_intents
                     WHERE strategy_id<>'parent-child-production-controller'
                `)
                .get(),
        ).toEqual({ count: 3 });
        expect(
            postDriftDatabase.prepare(`
                SELECT confirmation_id, state
                  FROM canonical_confirmation_snapshots
                 WHERE confirmation_id IN (?, ?)
                 ORDER BY confirmation_id
            `).all(
                driftConfirmationId,
                '123e4567-e89b-42d3-a456-426614174538',
            ),
        ).toEqual([
            { confirmation_id: driftConfirmationId, state: 'previewed' },
            {
                confirmation_id: '123e4567-e89b-42d3-a456-426614174538',
                state: 'superseded',
            },
        ]);
        postDriftDatabase.close();

        const quickGateDatabase = new DatabaseSync(databasePath);
        quickGateDatabase.exec('PRAGMA busy_timeout=2500; BEGIN IMMEDIATE;');
        quickGateDatabase.prepare(`
            DELETE FROM gate_manifests
             WHERE provenance IN ('automation','manual_user_confirmed')
        `).run();
        const quickFeatureJson = JSON.stringify({
            featureGates: {
                good_till: false,
                multi_condition: false,
                parent_child: false,
                quick: true,
                scheduled_quantity: false,
                stop_take: false,
                trailing_exit: false,
            },
            fingerprints: {
                mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
            },
        });
        for (const [provenance, suffix] of [
            ['automation', 'automation'],
            ['manual_user_confirmed', 'manual'],
        ]) {
            quickGateDatabase.prepare(`
                INSERT INTO gate_manifests(
                    manifest_id, manifest_revision, manifest_sha256,
                    schema_version, provenance, manifest_json,
                    fingerprints_sha256, evidence_catalog_sha256,
                    feature_gates_sha256, product_boundary_consent_version,
                    state, valid_until_epoch_ms, created_at_epoch_ms, revision
                ) VALUES (?, ?, ?,
                    'smart-order-gate-manifest/2026-08-11.1', ?, ?,
                    ?, ?, ?, 'local-sidecar-consent/v1', 'eligible', ?, ?, 0)
            `).run(
                `quick-${suffix}-gate`,
                `quick-${suffix}-r1`,
                `sha256:${(suffix === 'automation' ? '6' : '7').repeat(64)}`,
                provenance,
                quickFeatureJson,
                DIGEST_A,
                DIGEST_B,
                `sha256:${'8'.repeat(64)}`,
                nowEpochMs + 50_000,
                nowEpochMs + 145,
            );
        }
        quickGateDatabase.exec('COMMIT');
        quickGateDatabase.close();
        const quickContractEvidence = issuedProtectedEntryContractEvidence({
            apiGeneration,
            runtimeEpochId,
            observedAtEpochMs: nowEpochMs + 146,
            gateManifestHash: `sha256:${'6'.repeat(64)}`,
            gateManifestRevision: 'quick-automation-r1',
            mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
        });
        const quickDirectionCases = [
            ['quick-up-amount-controller', 'up_amount'],
            ['quick-down-amount-controller', 'down_amount'],
            ['quick-up-percent-controller', 'up_percent'],
            ['quick-down-percent-controller', 'down_percent'],
        ];
        const quickOperationId = (offset) =>
            `123e4567-e89b-42d3-a456-${String(426614174548 + offset)}`;
        for (const [index, [strategyId, field]] of quickDirectionCases.entries()) {
            const quickDefinition = JSON.parse(
                JSON.stringify(canonicalSmartOrderDraft('quick')),
            );
            quickDefinition.parameters.condition = {
                comparator: 'gte',
                field,
                mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
                threshold: '5',
            };
            await controller.createDraftStrategy({
                strategyId,
                strategyKind: 'quick',
                workspaceContractKey: 'TSE:STK:2330',
                nowEpochMs: nowEpochMs + 147,
            });
            await controller.replaceDraftStrategy({
                strategyId,
                expectedRevision: 0,
                draft: quickDefinition,
                nowEpochMs: nowEpochMs + 148,
            });
            const quickConfirmationId = quickOperationId(index * 3);
            const quickPreview =
                await controller.executeReplayProtectedStrategyMutation({
                    requestId: quickConfirmationId,
                    operationKind: 'strategy_confirmation_preview',
                    payloadHash: `sha256:${'9'.repeat(64)}`,
                    nowEpochMs: nowEpochMs + 149,
                    mutation: {
                        accountBrokerRef: 'broker-A',
                        accountIdRef: 'account-A',
                        basisSelection: null,
                        confirmationId: quickConfirmationId,
                        contractEvidence: quickContractEvidence,
                        controlPlaneAuthority,
                        expectedRevision: 1,
                        kind: 'strategy_confirmation_preview',
                        nowEpochMs: nowEpochMs + 149,
                        strategyId,
                    },
                });
            expect(quickPreview).toMatchObject({
                state: 'completed',
                result: {
                    state: 'previewed',
                    strategyKind: 'quick',
                    position: null,
                    brokerWriteAuthority: false,
                },
            });
            const quickAccepted =
                await controller.executeReplayProtectedStrategyMutation({
                    requestId: quickOperationId(index * 3 + 1),
                    operationKind: 'strategy_confirmation_accept',
                    payloadHash: `sha256:${'0'.repeat(64)}`,
                    nowEpochMs: nowEpochMs + 150,
                    mutation: {
                        accountBrokerRef: 'broker-A',
                        accountIdRef: 'account-A',
                        basisSelection: null,
                        confirmationId: quickConfirmationId,
                        contractEvidence: quickContractEvidence,
                        controlPlaneAuthority,
                        expectedRevision: 1,
                        kind: 'strategy_confirmation_accept',
                        nowEpochMs: nowEpochMs + 150,
                        snapshotHash: quickPreview.result.snapshotHash,
                        strategyId,
                        userAcknowledged: true,
                    },
                });
            expect(quickAccepted).toMatchObject({
                state: 'completed',
                result: {
                    state: 'accepted',
                    position: null,
                    strategy: { state: 'paused', revision: 2 },
                    brokerWriteAuthority: false,
                },
            });
            const quickResume =
                await controller.executeReplayProtectedStrategyMutation({
                    requestId: quickOperationId(index * 3 + 2),
                    operationKind: 'strategy_resume',
                    payloadHash: `sha256:${'1'.repeat(64)}`,
                    nowEpochMs: nowEpochMs + 151,
                    mutation: {
                        activationPolicyAcknowledged: true,
                        contractEvidence: null,
                        controlPlaneAuthority,
                        expectedRevision: 2,
                        kind: 'resume',
                        nowEpochMs: nowEpochMs + 151,
                        strategyId,
                    },
                });
            expect(quickResume).toMatchObject({
                state: 'completed',
                result: { state: 'monitoring', revision: 3 },
            });
        }
        const quickDemands = await controller.listSmartOrderQuoteDemands();
        expect(quickDemands).toHaveLength(4);
        expect(
            quickDemands.every(
                (demand) =>
                    /^quick:[0-9a-f]{64}$/.test(demand.consumerId) &&
                    demand.quoteType === 'tick',
            ),
        ).toBe(true);
        const quoteNow = nowEpochMs + 2_500;
        const quoteCoordinator = createSmartOrderQuoteSubscriptionCoordinator({
            apiGeneration,
            connectionId: 'quick-controller-stream',
            nowMonotonicMs: () => quoteNow,
            resourceCoordinator: Object.freeze({
                reserveSubscriptionDemand(demand) {
                    return Object.freeze({
                        allowed: true,
                        brokerAuthority: false,
                        countingDimension: demand.countingDimension,
                        demandId: demand.demandId,
                        projectedUsageUnits: 1,
                        release() {},
                        units: demand.units,
                    });
                },
                status() {
                    return Object.freeze({
                        brokerAuthority: false,
                        closed: false,
                        subscriptionCountingDimension:
                            'verified-subscription-item/v1',
                        subscriptionEvidenceCurrent: true,
                        writeMasterAuthority: false,
                    });
                },
            }),
            resourceCountingDimension: 'verified-subscription-item/v1',
        });
        quoteCoordinator.runtime.acquireDemand({
            consumerId: 'quick-controller-demand',
            contract: { code: '2330', exchange: 'TSE', securityType: 'STK' },
            quoteType: 'tick',
        });
        const quickPlan = quoteCoordinator.observer.pendingPlans()[0];
        const quickPlanConfirmation = quoteCoordinator.runtime.confirmPlan(
            quickPlan,
            {
                action: quickPlan.action,
                apiGeneration: quickPlan.apiGeneration,
                connectionId: quickPlan.connectionId,
                planId: quickPlan.planId,
            },
        );
        const dateNow = vi.spyOn(Date, 'now');
        for (const [sequence, close] of [
            [1, '105'],
            [2, '95'],
            [3, '105'],
        ]) {
            const observedAt = quoteNow + sequence;
            dateNow.mockReturnValue(observedAt);
            const normalized = normalizeSmartOrderQuickFieldEvent({
                contractKey: 'TSE:STK:2330',
                event: {
                    eventKind: 'tick',
                    code: '2330',
                    date: '2026-08-11',
                    time: `00:00:0${sequence}.000000`,
                    close,
                    volume: 1,
                    totalVolume: sequence,
                    priceChange: close === '105' ? '5' : '-5',
                    percentChange: close === '105' ? 500 : -500,
                    simtrade: false,
                    intradayOdd: false,
                },
                receiveTimeMs: observedAt,
                sequence,
                streamEpoch: 'quick-controller-stream',
            });
            const issued = quoteCoordinator.runtime.recordMappedObservation(
                quickPlanConfirmation.streamAuthority,
                normalized,
            );
            expect(issued.allowed, JSON.stringify(issued)).toBe(true);
            expect(issued).toMatchObject({
                allowed: true,
                quickConditionEligible: true,
                brokerWriteAuthority: false,
            });
            expect(
                isTrustedSmartOrderQuickConditionObservation(issued),
            ).toBe(true);
            await expect(
                controller.recordQuickQuoteObservation({ observation: issued }),
            ).resolves.toMatchObject({
                triggeredStrategyCount: sequence === 1 ? 0 : 2,
                automaticDispatchAllowed: false,
                brokerWriteAuthority: false,
            });
            if (sequence === 2) {
                await expect(
                    controller.recordQuickQuoteObservation({
                        observation: issued,
                    }),
                ).resolves.toMatchObject({
                    replayedStrategyCount: 4,
                    triggeredStrategyCount: 0,
                    automaticDispatchAllowed: false,
                    brokerWriteAuthority: false,
                });
            }
        }
        dateNow.mockRestore();
        const quickDatabase = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            quickDatabase.prepare(`
                SELECT heads.state, heads.revision,
                       activations.state AS activation_state,
                       (SELECT COUNT(*) FROM order_intents
                         WHERE strategy_id=heads.strategy_id) AS intent_count
                  FROM quick_condition_heads AS heads
                  JOIN activations
                    ON activations.activation_id=heads.activation_id
                 WHERE heads.strategy_id LIKE 'quick-%-controller'
                 ORDER BY heads.strategy_id
            `).all(),
        ).toEqual([
            {
                state: 'triggered',
                revision: 1,
                activation_state: 'triggered',
                intent_count: 0,
            },
            {
                state: 'triggered',
                revision: 1,
                activation_state: 'triggered',
                intent_count: 0,
            },
            {
                state: 'triggered',
                revision: 2,
                activation_state: 'triggered',
                intent_count: 0,
            },
            {
                state: 'triggered',
                revision: 2,
                activation_state: 'triggered',
                intent_count: 0,
            },
        ]);
        quickDatabase.close();

        const goodTillGateDatabase = new DatabaseSync(databasePath);
        goodTillGateDatabase.exec('PRAGMA busy_timeout=2500; BEGIN IMMEDIATE;');
        goodTillGateDatabase.prepare(`
            DELETE FROM gate_manifests
             WHERE provenance IN ('automation','manual_user_confirmed')
        `).run();
        const goodTillFeatureJson = JSON.stringify({
            featureGates: {
                good_till: true,
                multi_condition: false,
                parent_child: false,
                quick: true,
                scheduled_quantity: false,
                stop_take: false,
                trailing_exit: false,
            },
            fingerprints: {
                mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
            },
        });
        for (const [provenance, suffix] of [
            ['automation', 'automation'],
            ['manual_user_confirmed', 'manual'],
        ]) {
            goodTillGateDatabase.prepare(`
                INSERT INTO gate_manifests(
                    manifest_id, manifest_revision, manifest_sha256,
                    schema_version, provenance, manifest_json,
                    fingerprints_sha256, evidence_catalog_sha256,
                    feature_gates_sha256, product_boundary_consent_version,
                    state, valid_until_epoch_ms, created_at_epoch_ms, revision
                ) VALUES (?, ?, ?,
                    'smart-order-gate-manifest/2026-08-11.1', ?, ?,
                    ?, ?, ?, 'local-sidecar-consent/v1', 'eligible', ?, ?, 0)
            `).run(
                `good-till-${suffix}-gate`,
                `good-till-${suffix}-r1`,
                `sha256:${(suffix === 'automation' ? '2' : '3').repeat(64)}`,
                provenance,
                goodTillFeatureJson,
                DIGEST_A,
                DIGEST_B,
                `sha256:${'4'.repeat(64)}`,
                nowEpochMs + 50_000,
                nowEpochMs + 152,
            );
        }
        goodTillGateDatabase.exec('COMMIT');
        goodTillGateDatabase.close();
        const goodTillOrderEvidence = issuedProtectedEntryContractEvidence({
            apiGeneration,
            runtimeEpochId,
            observedAtEpochMs: nowEpochMs + 153,
            gateManifestHash: `sha256:${'2'.repeat(64)}`,
            gateManifestRevision: 'good-till-automation-r1',
            mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
            contractOverrides: {
                contractUnit: 250,
            },
        });
        const goodTillMonitorEvidence = issuedProtectedEntryContractEvidence({
            apiGeneration,
            runtimeEpochId,
            observedAtEpochMs: nowEpochMs + 153,
            gateManifestHash: `sha256:${'2'.repeat(64)}`,
            gateManifestRevision: 'good-till-automation-r1',
            mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
            contractOverrides: {
                code: '2303',
                draftContractKey: 'TSE:STK:2303',
                runtimeContractKey: 'TSE:2303:STK:Common',
            },
        });
        const overlongGoodTillDefinition = JSON.parse(
            JSON.stringify(canonicalSmartOrderDraft('good_till')),
        );
        overlongGoodTillDefinition.parameters.condition.mappingRevision =
            SMART_ORDER_QUICK_FIELD_MAPPING_REVISION;
        overlongGoodTillDefinition.parameters.order.contractUnit = '500';
        overlongGoodTillDefinition.parameters.order.commonLots = '2';
        overlongGoodTillDefinition.parameters.validity.endDate = '2026-09-10';
        await controller.createDraftStrategy({
            strategyId: 'good-till-overlong-controller',
            strategyKind: 'good_till',
            workspaceContractKey: 'TSE:STK:2330',
            nowEpochMs: nowEpochMs + 153,
        });
        await expect(
            controller.replaceDraftStrategy({
                strategyId: 'good-till-overlong-controller',
                expectedRevision: 0,
                draft: overlongGoodTillDefinition,
                nowEpochMs: nowEpochMs + 154,
            }),
        ).rejects.toThrow(/1 to 30 inclusive calendar dates/);
        const goodTillDefinition = JSON.parse(
            JSON.stringify(canonicalSmartOrderDraft('good_till')),
        );
        goodTillDefinition.parameters.condition.mappingRevision =
            SMART_ORDER_QUICK_FIELD_MAPPING_REVISION;
        goodTillDefinition.parameters.order.contractUnit = '250';
        goodTillDefinition.parameters.order.commonLots = '4';
        goodTillDefinition.parameters.targetBaseShares = '1250';
        goodTillDefinition.parameters.validity.endDate = '2026-08-12';
        await controller.createDraftStrategy({
            strategyId: 'good-till-production-controller',
            strategyKind: 'good_till',
            workspaceContractKey: 'TSE:STK:2330',
            nowEpochMs: nowEpochMs + 154,
        });
        await controller.replaceDraftStrategy({
            strategyId: 'good-till-production-controller',
            expectedRevision: 0,
            draft: goodTillDefinition,
            nowEpochMs: nowEpochMs + 155,
        });
        const goodTillConfirmationId =
            '123e4567-e89b-42d3-a456-426614174571';
        const goodTillPreview =
            await controller.executeReplayProtectedStrategyMutation({
                requestId: '123e4567-e89b-42d3-a456-426614174581',
                operationKind: 'strategy_confirmation_preview',
                payloadHash: `sha256:${'5'.repeat(64)}`,
                nowEpochMs: nowEpochMs + 156,
                mutation: {
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    basisSelection: null,
                    confirmationId: goodTillConfirmationId,
                    contractEvidence: goodTillOrderEvidence,
                    monitorContractEvidence: goodTillMonitorEvidence,
                    controlPlaneAuthority,
                    expectedRevision: 1,
                    kind: 'strategy_confirmation_preview',
                    nowEpochMs: nowEpochMs + 156,
                    strategyId: 'good-till-production-controller',
                },
            });
        expect(goodTillPreview).toMatchObject({
            state: 'completed',
            result: {
                state: 'previewed',
                strategyKind: 'good_till',
                position: null,
                brokerWriteAuthority: false,
            },
        });
        await expect(
            controller.executeReplayProtectedStrategyMutation({
                requestId: '123e4567-e89b-42d3-a456-426614174582',
                operationKind: 'strategy_confirmation_accept',
                payloadHash: `sha256:${'6'.repeat(64)}`,
                nowEpochMs: nowEpochMs + 157,
                mutation: {
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    basisSelection: null,
                    confirmationId: goodTillConfirmationId,
                    contractEvidence: goodTillOrderEvidence,
                    monitorContractEvidence: goodTillMonitorEvidence,
                    controlPlaneAuthority,
                    expectedRevision: 1,
                    kind: 'strategy_confirmation_accept',
                    nowEpochMs: nowEpochMs + 157,
                    snapshotHash: goodTillPreview.result.snapshotHash,
                    strategyId: 'good-till-production-controller',
                    userAcknowledged: true,
                },
            }),
        ).resolves.toMatchObject({
            state: 'completed',
            result: {
                state: 'accepted',
                strategy: { state: 'paused', revision: 2 },
            },
        });
        await expect(
            controller.executeReplayProtectedStrategyMutation({
                requestId: '123e4567-e89b-42d3-a456-426614174583',
                operationKind: 'strategy_resume',
                payloadHash: `sha256:${'7'.repeat(64)}`,
                nowEpochMs: nowEpochMs + 158,
                mutation: {
                    activationPolicyAcknowledged: true,
                    contractEvidence: null,
                    controlPlaneAuthority,
                    expectedRevision: 2,
                    kind: 'resume',
                    nowEpochMs: nowEpochMs + 158,
                    strategyId: 'good-till-production-controller',
                },
            }),
        ).resolves.toMatchObject({
            state: 'completed',
            result: { state: 'monitoring', revision: 3 },
        });
        await expect(
            controller.listGoodTillConfirmationRenewalContexts(),
        ).resolves.toEqual([
            {
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                monitorContractKey: 'TSE:STK:2303',
                orderContractKey: 'TSE:STK:2330',
                snapshotHash: goodTillPreview.result.snapshotHash,
                strategyId: 'good-till-production-controller',
                strategyRevision: 3,
            },
        ]);
        const goodTillRenewalClock = vi
            .spyOn(Date, 'now')
            .mockReturnValue(nowEpochMs + 6_000);
        const renewedGoodTillOrderEvidence =
            issuedProtectedEntryContractEvidence({
                apiGeneration,
                runtimeEpochId,
                observedAtEpochMs: nowEpochMs + 6_000,
                gateManifestHash: `sha256:${'2'.repeat(64)}`,
                gateManifestRevision: 'good-till-automation-r1',
                mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
                contractOverrides: { contractUnit: 250 },
            });
        const renewedGoodTillMonitorEvidence =
            issuedProtectedEntryContractEvidence({
                apiGeneration,
                runtimeEpochId,
                observedAtEpochMs: nowEpochMs + 6_000,
                gateManifestHash: `sha256:${'2'.repeat(64)}`,
                gateManifestRevision: 'good-till-automation-r1',
                mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
                contractOverrides: {
                    code: '2303',
                    draftContractKey: 'TSE:STK:2303',
                    runtimeContractKey: 'TSE:2303:STK:Common',
                },
            });
        await expect(
            controller.refreshGoodTillConfirmationEvidence({
                monitorContractEvidence: renewedGoodTillMonitorEvidence,
                orderContractEvidence: renewedGoodTillOrderEvidence,
                snapshotHash: goodTillPreview.result.snapshotHash,
                strategyId: 'good-till-production-controller',
            }),
        ).resolves.toMatchObject({
            state: 'refreshed',
            brokerWriteAuthority: false,
            automaticDispatchAllowed: false,
        });
        goodTillRenewalClock.mockRestore();
        const goodTillCoordinator =
            createSmartOrderQuoteSubscriptionCoordinator({
                apiGeneration,
                connectionId: 'good-till-controller-stream',
                nowMonotonicMs: () => nowEpochMs + 8_000,
                resourceCoordinator: Object.freeze({
                    reserveSubscriptionDemand(demand) {
                        return Object.freeze({
                            allowed: true,
                            brokerAuthority: false,
                            countingDimension: demand.countingDimension,
                            demandId: demand.demandId,
                            projectedUsageUnits: 1,
                            release() {},
                            units: demand.units,
                        });
                    },
                    status() {
                        return Object.freeze({
                            brokerAuthority: false,
                            closed: false,
                            subscriptionCountingDimension:
                                'verified-subscription-item/v1',
                            subscriptionEvidenceCurrent: true,
                            writeMasterAuthority: false,
                        });
                    },
                }),
                resourceCountingDimension:
                    'verified-subscription-item/v1',
            });
        goodTillCoordinator.runtime.acquireDemand({
            consumerId: 'good-till-production-demand',
            contract: { code: '2303', exchange: 'TSE', securityType: 'STK' },
            quoteType: 'tick',
        });
        const goodTillPlan = goodTillCoordinator.observer.pendingPlans()[0];
        const goodTillPlanConfirmation =
            goodTillCoordinator.runtime.confirmPlan(goodTillPlan, {
                action: goodTillPlan.action,
                apiGeneration: goodTillPlan.apiGeneration,
                connectionId: goodTillPlan.connectionId,
                planId: goodTillPlan.planId,
            });
        const goodTillClock = vi.spyOn(Date, 'now');
        for (const [sequence, close] of [
            [1, '95'],
            [2, '105'],
        ]) {
            const observedAt = nowEpochMs + 6_000 + sequence * 1_000;
            goodTillClock.mockReturnValue(observedAt);
            const normalized = normalizeSmartOrderQuickFieldEvent({
                contractKey: 'TSE:STK:2303',
                event: {
                    eventKind: 'tick',
                    code: '2303',
                    date: '2026-08-11',
                    time: `00:00:0${6 + sequence}.000000`,
                    close,
                    volume: 1,
                    totalVolume: sequence,
                    priceChange: close === '105' ? '5' : '-5',
                    percentChange: close === '105' ? 500 : -500,
                    simtrade: false,
                    intradayOdd: false,
                },
                receiveTimeMs: observedAt,
                sequence,
                streamEpoch: 'good-till-controller-stream',
            });
            const issued =
                goodTillCoordinator.runtime.recordMappedObservation(
                    goodTillPlanConfirmation.streamAuthority,
                    normalized,
                );
            await expect(
                controller.recordQuickQuoteObservation({ observation: issued }),
            ).resolves.toMatchObject({
                goodTillPreparedIntentCount: sequence === 2 ? 1 : 0,
                automaticDispatchAllowed: false,
                brokerWriteAuthority: false,
            });
        }
        goodTillClock.mockRestore();
        const goodTillDatabase = new DatabaseSync(databasePath, {
            readOnly: true,
        });
        expect(
            goodTillDatabase.prepare(`
                SELECT progress.daily_state, progress.target_shares,
                       progress.confirmed_filled_shares,
                       progress.remaining_target_shares,
                       intents.state AS intent_state,
                       json_extract(intents.payload_json, '$.order.baseShares')
                           AS order_shares,
                       reservations.state AS reservation_state,
                       rearms.state AS rearm_state,
                       intents.adapter_authority_granted
                  FROM good_till_progress_heads AS progress
                  JOIN order_intents AS intents
                    ON intents.intent_id=progress.active_intent_id
                  JOIN entry_exposure_reservations AS reservations
                    ON reservations.intent_id=intents.intent_id
                  JOIN intent_rearm_authorizations AS rearms
                    ON rearms.intent_id=intents.intent_id
                 WHERE progress.strategy_id='good-till-production-controller'
            `).get(),
        ).toEqual({
            daily_state: 'intent_prepared',
            target_shares: 1250,
            confirmed_filled_shares: 0,
            remaining_target_shares: 1250,
            intent_state: 'prepared',
            order_shares: 1000,
            reservation_state: 'reserved',
            rearm_state: 'active',
            adapter_authority_granted: 0,
        });
        goodTillDatabase.close();
        await exerciseMultiConditionVertical();

        const accessorRequest = { ...confirmationRequest };
        Object.defineProperty(accessorRequest, 'commonLots', {
            enumerable: true,
            get: () => 1,
        });
        await expect(
            controller.executeReplayProtectedStrategyMutation({
                ...previewRequest,
                requestId: '123e4567-e89b-42d3-a456-426614174513',
                mutation: {
                    ...previewRequest.mutation,
                    confirmationId:
                        '123e4567-e89b-42d3-a456-426614174513',
                    confirmationRequest: accessorRequest,
                },
            }),
        ).rejects.toThrow(/accessor|own data|Proxy/);
        expect(controller.dispatchAllowed).toBe(true);

        const goodTillDispatchDatabase = new DatabaseSync(databasePath);
        const goodTillActive = goodTillDispatchDatabase.prepare(`
            SELECT progress.active_intent_id AS intent_id,
                   progress.active_activation_id AS activation_id
              FROM good_till_progress_heads AS progress
             WHERE progress.strategy_id='good-till-production-controller'
        `).get();
        goodTillDispatchDatabase.prepare(`
            UPDATE order_intents
               SET state='dispatching', adapter_authority_granted=1,
                   dispatch_attempt_nonce='good-till-attempt-1',
                   runtime_epoch_id=?, sender_fence=?, api_generation=?,
                   revision=revision+1
             WHERE intent_id=? AND state='prepared'
        `).run(
            runtimeEpochId,
            senderFence,
            apiGeneration,
            goodTillActive.intent_id,
        );
        goodTillDispatchDatabase.prepare(`
            UPDATE activations SET state='dispatching', revision=revision+1
             WHERE activation_id=? AND state='prepared'
        `).run(goodTillActive.activation_id);
        goodTillDispatchDatabase.prepare(`
            INSERT INTO broker_orders(
                broker_order_id, intent_id, state, control_revision,
                quantity_shares, filled_shares, remaining_shares,
                evidence_hash, updated_at_epoch_ms, terminal_at_epoch_ms,
                revision
            ) VALUES (
                'broker-order-good-till-1', ?, 'pending_submit', 0,
                1000, 0, 1000, ?, ?, NULL, 0
            )
        `).run(
            goodTillActive.intent_id,
            DIGEST_A,
            nowEpochMs + 8_100,
        );
        goodTillDispatchDatabase.prepare(`
            INSERT INTO broker_correlations(
                correlation_id, intent_id, broker_order_id,
                canonical_key_hash, account_broker_ref, account_id_ref,
                trade_date, contract_key, side, trade_id, order_id,
                deal_id, seqno, ordno, exchange_sequence, custom_field,
                evidence_hash, created_at_epoch_ms, revision
            ) VALUES (
                'correlation-good-till-1', ?, 'broker-order-good-till-1', ?,
                'broker-A', 'account-A', '2026-08-11',
                'TSE:2330:STK:Common', 'Buy',
                'good-till-trade-1', 'good-till-order-1', NULL,
                'good-till-seq-1', 'good-till-ord-1', NULL,
                'GT001', ?, ?, 0
            )
        `).run(
            goodTillActive.intent_id,
            `sha256:${'8'.repeat(64)}`,
            DIGEST_A,
            nowEpochMs + 8_100,
        );
        for (const [kind, value] of [
            ['tradeId', 'good-till-trade-1'],
            ['seqno', 'good-till-seq-1'],
        ]) {
            goodTillDispatchDatabase.prepare(`
                INSERT INTO broker_correlation_identifiers(
                    account_broker_ref, account_id_ref, trade_date,
                    contract_key, side, identifier_kind, identifier_value,
                    intent_id, correlation_id, created_at_epoch_ms
                ) VALUES (
                    'broker-A','account-A','2026-08-11',
                    'TSE:2330:STK:Common','Buy',?,?,?,
                    'correlation-good-till-1',?
                )
            `).run(
                kind,
                value,
                goodTillActive.intent_id,
                nowEpochMs + 2_610,
            );
        }
        goodTillDispatchDatabase.close();
        const goodTillTerminalEvent = protectedEntryControllerBrokerEvent(
            apiGeneration,
            {
                tradeDate: '2026-08-11',
                tradeId: 'good-till-trade-1',
                orderId: 'good-till-order-1',
                seqno: 'good-till-seq-1',
                ordno: 'good-till-ord-1',
                customField: 'GT001',
                status: 'Cancelled',
                order: 1_000,
                cumulativeDeal: 750,
                cumulativeCancel: 250,
                remaining: 0,
                eventDeal: 0,
                exchangeEpochMs: nowEpochMs + 8_200,
            },
        );
        await expect(
            controller.recordCanonicalBrokerEvent({
                event: goodTillTerminalEvent,
            }),
        ).resolves.toMatchObject({
            brokerWriteAuthority: false,
        });
        const goodTillSettlementReconciliation =
            issuedProtectedEntryReconciliation({
                apiGeneration,
                runtimeEpochId,
                asOfEpochMs: nowEpochMs + 8_300,
                tradeDate: '2026-08-11',
                dealIds: [],
                availableShares: 2_000,
                quantityShares: 2_000,
                positionLineageId: 'position-good-till-confirmation',
            });
        await expect(
            controller.recordAccountReconciliation({
                brokerObservationEvidenceSha256:
                    goodTillTerminalEvent.brokerEventEvidenceSha256,
                nowEpochMs: nowEpochMs + 8_400,
                result: goodTillSettlementReconciliation,
            }),
        ).resolves.toMatchObject({
            state: 'recorded',
            brokerWriteAuthority: false,
        });
        const goodTillSettledDatabase = new DatabaseSync(databasePath, {
            readOnly: true,
        });
        expect(
            goodTillSettledDatabase.prepare(`
                SELECT progress.daily_state, progress.target_shares,
                       progress.confirmed_filled_shares,
                       progress.remaining_target_shares,
                       intents.state AS intent_state,
                       activations.state AS activation_state,
                       reservations.state AS reservation_state,
                       orders.state AS broker_order_state,
                       orders.filled_shares, orders.remaining_shares
                  FROM good_till_progress_heads AS progress
                  JOIN order_intents AS intents
                    ON intents.intent_id=progress.active_intent_id
                  JOIN activations
                    ON activations.activation_id=progress.active_activation_id
                  JOIN entry_exposure_reservations AS reservations
                    ON reservations.intent_id=intents.intent_id
                  JOIN broker_correlations AS correlations
                    ON correlations.intent_id=intents.intent_id
                  JOIN broker_orders AS orders
                    ON orders.broker_order_id=correlations.broker_order_id
                 WHERE progress.strategy_id='good-till-production-controller'
            `).get(),
        ).toEqual({
            daily_state: 'terminal_consumed',
            target_shares: 1_250,
            confirmed_filled_shares: 750,
            remaining_target_shares: 500,
            intent_state: 'terminal',
            activation_state: 'filled',
            reservation_state: 'consumed',
            broker_order_state: 'cancelled',
            filled_shares: 750,
            remaining_shares: 0,
        });
        goodTillSettledDatabase.close();
        expect(() =>
            controller.completeBrokerObservationReconciliation({
                eventEvidenceSha256:
                    goodTillTerminalEvent.brokerEventEvidenceSha256,
            }),
        ).not.toThrow();
        const goodTillReplayBefore = new DatabaseSync(databasePath, {
            readOnly: true,
        });
        const goodTillReplaySnapshot = goodTillReplayBefore.prepare(`
            SELECT progress.revision,
                   (SELECT COUNT(*) FROM event_journal
                     WHERE entity_id=progress.strategy_id
                       AND summary_code='good_till_daily_activation_consumed')
                       AS settlement_journal_count
              FROM good_till_progress_heads AS progress
             WHERE progress.strategy_id='good-till-production-controller'
        `).get();
        goodTillReplayBefore.close();
        const goodTillReplayReconciliation =
            issuedProtectedEntryReconciliation({
                apiGeneration,
                runtimeEpochId,
                asOfEpochMs: nowEpochMs + 8_500,
                tradeDate: '2026-08-11',
                dealIds: [],
                availableShares: 2_000,
                quantityShares: 2_000,
                positionLineageId: 'position-good-till-confirmation',
                sourceRevision: 'good-till-reconciliation-replay-2',
            });
        await expect(
            controller.recordAccountReconciliation({
                brokerObservationEvidenceSha256: null,
                nowEpochMs: nowEpochMs + 8_510,
                result: goodTillReplayReconciliation,
            }),
        ).resolves.toMatchObject({
            state: 'recorded',
            brokerWriteAuthority: false,
        });
        const goodTillReplayAfter = new DatabaseSync(databasePath, {
            readOnly: true,
        });
        expect(
            goodTillReplayAfter.prepare(`
                SELECT progress.revision,
                       (SELECT COUNT(*) FROM event_journal
                         WHERE entity_id=progress.strategy_id
                           AND summary_code='good_till_daily_activation_consumed')
                           AS settlement_journal_count
                  FROM good_till_progress_heads AS progress
                 WHERE progress.strategy_id='good-till-production-controller'
            `).get(),
        ).toEqual(goodTillReplaySnapshot);
        goodTillReplayAfter.close();
        async function exerciseMultiConditionVertical() {
        const multiGateDatabase = new DatabaseSync(databasePath);
        multiGateDatabase.exec('PRAGMA busy_timeout=2500; BEGIN IMMEDIATE;');
        multiGateDatabase.prepare(`
            DELETE FROM gate_manifests
             WHERE provenance IN ('automation','manual_user_confirmed')
        `).run();
        const multiFeatureJson = JSON.stringify({
            featureGates: {
                good_till: false,
                multi_condition: true,
                parent_child: false,
                quick: true,
                scheduled_quantity: false,
                stop_take: false,
                trailing_exit: false,
            },
            fingerprints: {
                mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
            },
        });
        for (const [provenance, suffix] of [
            ['automation', 'automation'],
            ['manual_user_confirmed', 'manual'],
        ]) {
            multiGateDatabase.prepare(`
                INSERT INTO gate_manifests(
                    manifest_id, manifest_revision, manifest_sha256,
                    schema_version, provenance, manifest_json,
                    fingerprints_sha256, evidence_catalog_sha256,
                    feature_gates_sha256, product_boundary_consent_version,
                    state, valid_until_epoch_ms, created_at_epoch_ms, revision
                ) VALUES (?, ?, ?,
                    'smart-order-gate-manifest/2026-08-11.1', ?, ?,
                    ?, ?, ?, 'local-sidecar-consent/v1', 'eligible', ?, ?, 0)
            `).run(
                `multi-${suffix}-gate`,
                `multi-${suffix}-r1`,
                `sha256:${(suffix === 'automation' ? 'a' : 'b').repeat(64)}`,
                provenance,
                multiFeatureJson,
                DIGEST_A,
                DIGEST_B,
                `sha256:${'c'.repeat(64)}`,
                nowEpochMs + 60_000,
                nowEpochMs + 9_000,
            );
        }
        multiGateDatabase.exec('COMMIT');
        multiGateDatabase.close();
        const multiEvidence = (overrides = {}) =>
            issuedProtectedEntryContractEvidence({
                apiGeneration,
                runtimeEpochId,
                observedAtEpochMs: nowEpochMs + 9_001,
                gateManifestHash: `sha256:${'a'.repeat(64)}`,
                gateManifestRevision: 'multi-automation-r1',
                mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
                contractOverrides: overrides,
            });
        const orderEvidence = multiEvidence();
        const monitorA = multiEvidence();
        const monitorB = multiEvidence({
            code: '2303',
            draftContractKey: 'TSE:STK:2303',
            runtimeContractKey: 'TSE:2303:STK:Common',
        });
        const monitorC = multiEvidence({
            code: '6488',
            draftContractKey: 'OTC:STK:6488',
            exchange: 'OTC',
            runtimeContractKey: 'OTC:6488:STK:Common',
        });
        const monitorByKey = new Map([
            ['TSE:STK:2330', monitorA],
            ['TSE:STK:2303', monitorB],
            ['OTC:STK:6488', monitorC],
        ]);
        const confirmationIds = [
            '123e4567-e89b-42d3-a456-426614174801',
            '123e4567-e89b-42d3-a456-426614174811',
            '123e4567-e89b-42d3-a456-426614174821',
            '123e4567-e89b-42d3-a456-426614174831',
        ];
        const multiDefinitions = [
            {
                strategyId: 'multi-or-controller',
                operator: 'OR',
                monitorKeys: ['TSE:STK:2330', 'TSE:STK:2303'],
            },
            {
                strategyId: 'multi-and-controller',
                operator: 'AND',
                monitorKeys: ['TSE:STK:2330', 'TSE:STK:2303'],
            },
            {
                strategyId: 'multi-subscription-blocked-controller',
                operator: 'AND',
                monitorKeys: [
                    'TSE:STK:2330',
                    'TSE:STK:2330',
                    'OTC:STK:6488',
                ],
            },
            {
                strategyId: 'multi-field-disabled-controller',
                operator: 'AND',
                monitorKeys: ['TSE:STK:2303'],
                fields: ['up_percent'],
                thresholds: ['5'],
            },
        ];
        for (const [index, candidate] of multiDefinitions.entries()) {
            const definition = JSON.parse(
                JSON.stringify(canonicalSmartOrderDraft('multi_condition')),
            );
            definition.parameters.operator = candidate.operator;
            definition.parameters.conditions = candidate.monitorKeys.map(
                (monitorContractKey, conditionIndex) => ({
                    monitorContractKey,
                    condition: {
                        comparator: 'gte',
                        field: candidate.fields?.[conditionIndex] ?? 'last_price',
                        mappingRevision:
                            SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
                        threshold: candidate.thresholds?.[conditionIndex] ?? '100',
                    },
                }),
            );
            await controller.createDraftStrategy({
                strategyId: candidate.strategyId,
                strategyKind: 'multi_condition',
                workspaceContractKey: 'TSE:STK:2330',
                nowEpochMs: nowEpochMs + 9_002,
            });
            await controller.replaceDraftStrategy({
                strategyId: candidate.strategyId,
                expectedRevision: 0,
                draft: definition,
                nowEpochMs: nowEpochMs + 9_003,
            });
            const preview = await controller.executeReplayProtectedStrategyMutation({
                requestId: confirmationIds[index],
                operationKind: 'strategy_confirmation_preview',
                payloadHash: `sha256:${String(index + 1).repeat(64)}`,
                nowEpochMs: nowEpochMs + 9_004,
                mutation: {
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    basisSelection: null,
                    confirmationId: confirmationIds[index],
                    contractEvidence: orderEvidence,
                    monitorContractEvidence: candidate.monitorKeys.map(
                        (key) => monitorByKey.get(key),
                    ),
                    controlPlaneAuthority,
                    expectedRevision: 1,
                    kind: 'strategy_confirmation_preview',
                    nowEpochMs: nowEpochMs + 9_004,
                    strategyId: candidate.strategyId,
                },
            });
            expect(preview).toMatchObject({
                state: 'completed',
                result: {
                    state: 'previewed',
                    strategyKind: 'multi_condition',
                    brokerWriteAuthority: false,
                },
            });
            await expect(
                controller.executeReplayProtectedStrategyMutation({
                    requestId: `123e4567-e89b-42d3-a456-${String(
                        426614174802 + index * 10,
                    )}`,
                    operationKind: 'strategy_confirmation_accept',
                    payloadHash: `sha256:${String(index + 4).repeat(64)}`,
                    nowEpochMs: nowEpochMs + 9_005,
                    mutation: {
                        accountBrokerRef: 'broker-A',
                        accountIdRef: 'account-A',
                        basisSelection: null,
                        confirmationId: confirmationIds[index],
                        contractEvidence: orderEvidence,
                        monitorContractEvidence: candidate.monitorKeys.map(
                            (key) => monitorByKey.get(key),
                        ),
                        controlPlaneAuthority,
                        expectedRevision: 1,
                        kind: 'strategy_confirmation_accept',
                        nowEpochMs: nowEpochMs + 9_005,
                        snapshotHash: preview.result.snapshotHash,
                        strategyId: candidate.strategyId,
                        userAcknowledged: true,
                    },
                }),
            ).resolves.toMatchObject({
                state: 'completed',
                result: { strategy: { state: 'paused', revision: 2 } },
            });
            await expect(
                controller.executeReplayProtectedStrategyMutation({
                    requestId: `123e4567-e89b-42d3-a456-${String(
                        426614174803 + index * 10,
                    )}`,
                    operationKind: 'strategy_resume',
                    payloadHash: `sha256:${(index + 7).toString(16).repeat(64)}`,
                    nowEpochMs: nowEpochMs + 9_006,
                    mutation: {
                        activationPolicyAcknowledged: true,
                        contractEvidence: null,
                        controlPlaneAuthority,
                        expectedRevision: 2,
                        kind: 'resume',
                        nowEpochMs: nowEpochMs + 9_006,
                        strategyId: candidate.strategyId,
                    },
                }),
            ).resolves.toMatchObject({
                state: 'completed',
                result: { state: 'monitoring', revision: 3 },
            });
        }
        await expect(
            controller.listMultiConditionConfirmationRenewalContexts(),
        ).resolves.toEqual(
            expect.arrayContaining(
                multiDefinitions.map((candidate) =>
                    expect.objectContaining({
                        strategyId: candidate.strategyId,
                        monitorContractKeys: candidate.monitorKeys,
                        orderContractKey: 'TSE:STK:2330',
                    }),
                ),
            ),
        );
        const renewedEvidence = (overrides = {}) =>
            issuedProtectedEntryContractEvidence({
                apiGeneration,
                runtimeEpochId,
                observedAtEpochMs: nowEpochMs + 11_000,
                gateManifestHash: `sha256:${'a'.repeat(64)}`,
                gateManifestRevision: 'multi-automation-r1',
                mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
                contractOverrides: overrides,
            });
        const renewedOrderEvidence = renewedEvidence();
        const renewedMonitorByKey = new Map([
            ['TSE:STK:2330', renewedEvidence()],
            [
                'TSE:STK:2303',
                renewedEvidence({
                    code: '2303',
                    draftContractKey: 'TSE:STK:2303',
                    runtimeContractKey: 'TSE:2303:STK:Common',
                }),
            ],
            [
                'OTC:STK:6488',
                renewedEvidence({
                    code: '6488',
                    draftContractKey: 'OTC:STK:6488',
                    exchange: 'OTC',
                    runtimeContractKey: 'OTC:6488:STK:Common',
                }),
            ],
        ]);
        const renewalClock = vi
            .spyOn(Date, 'now')
            .mockReturnValue(nowEpochMs + 11_000);
        for (const candidate of multiDefinitions) {
            await expect(
                controller.refreshMultiConditionConfirmationEvidence({
                    monitorContractEvidence: candidate.monitorKeys.map(
                        (key) => renewedMonitorByKey.get(key),
                    ),
                    orderContractEvidence: renewedOrderEvidence,
                    snapshotHash: (
                        await controller.listMultiConditionConfirmationRenewalContexts()
                    ).find((context) => context.strategyId === candidate.strategyId)
                        .snapshotHash,
                    strategyId: candidate.strategyId,
                }),
            ).resolves.toMatchObject({
                state: 'refreshed',
                brokerWriteAuthority: false,
                automaticDispatchAllowed: false,
            });
        }
        renewalClock.mockRestore();
        const demands = await controller.listSmartOrderQuoteDemands();
        expect(
            demands.filter((demand) =>
                /^multi_condition:[0-9a-f]{64}$/.test(demand.consumerId),
            ),
        ).toHaveLength(8);
        const multiCoordinator = createSmartOrderQuoteSubscriptionCoordinator({
            apiGeneration,
            connectionId: 'multi-controller-stream',
            nowMonotonicMs: () => nowEpochMs + 15_000,
            resourceCoordinator: Object.freeze({
                reserveSubscriptionDemand(demand) {
                    return Object.freeze({
                        allowed: true,
                        brokerAuthority: false,
                        countingDimension: demand.countingDimension,
                        demandId: demand.demandId,
                        projectedUsageUnits: 1,
                        release() {},
                        units: demand.units,
                    });
                },
                status() {
                    return Object.freeze({
                        brokerAuthority: false,
                        closed: false,
                        subscriptionCountingDimension:
                            'verified-subscription-item/v1',
                        subscriptionEvidenceCurrent: true,
                        writeMasterAuthority: false,
                    });
                },
            }),
            resourceCountingDimension: 'verified-subscription-item/v1',
        });
        const streamAuthorityByContract = new Map();
        for (const [consumerId, contract] of [
            ['multi-demand-a', { code: '2330', exchange: 'TSE', securityType: 'STK' }],
            ['multi-demand-b', { code: '2303', exchange: 'TSE', securityType: 'STK' }],
        ]) {
            multiCoordinator.runtime.acquireDemand({
                consumerId,
                contract,
                quoteType: 'tick',
            });
        }
        for (const plan of multiCoordinator.observer.pendingPlans()) {
            const confirmation = multiCoordinator.runtime.confirmPlan(plan, {
                action: plan.action,
                apiGeneration: plan.apiGeneration,
                connectionId: plan.connectionId,
                planId: plan.planId,
            });
            streamAuthorityByContract.set(
                `${plan.contract.exchange}:STK:${plan.contract.code}`,
                confirmation.streamAuthority,
            );
        }
        const multiClock = vi.spyOn(Date, 'now');
        const recordMulti = async ({
            contractKey,
            code,
            sequence,
            close,
            at,
            time,
            omitPercentChange = false,
        }) => {
            multiClock.mockReturnValue(at);
            const normalized = normalizeSmartOrderQuickFieldEvent({
                contractKey,
                event: {
                    eventKind: 'tick',
                    code,
                    date: '2026-08-11',
                    time,
                    close,
                    volume: 1,
                    totalVolume: sequence,
                    priceChange:
                        close === undefined ? '0' : close === '110' ? '10' : '-10',
                    percentChange: omitPercentChange
                        ? undefined
                        : close === undefined
                          ? 0
                          : close === '110'
                            ? 1_000
                            : -1_000,
                    simtrade: false,
                    intradayOdd: false,
                },
                receiveTimeMs: at,
                sequence,
                streamEpoch: 'multi-controller-stream',
            });
            const issued = multiCoordinator.runtime.recordMappedObservation(
                streamAuthorityByContract.get(contractKey),
                normalized,
            );
            return controller.recordQuickQuoteObservation({ observation: issued });
        };
        await recordMulti({
            contractKey: 'TSE:STK:2330', code: '2330', sequence: 1,
            close: '90', at: nowEpochMs + 11_000, time: '00:00:12.000000',
        });
        await recordMulti({
            contractKey: 'TSE:STK:2303', code: '2303', sequence: 2,
            close: '90', at: nowEpochMs + 11_100, time: '00:00:12.100000',
        });
        const orResult = await recordMulti({
            contractKey: 'TSE:STK:2330', code: '2330', sequence: 3,
            close: '110', at: nowEpochMs + 11_200, time: '00:00:12.200000',
        });
        expect(orResult).toMatchObject({
            multiConditionTriggeredStrategyCount: 1,
            automaticDispatchAllowed: false,
            brokerWriteAuthority: false,
        });
        const staleAnd = await recordMulti({
            contractKey: 'TSE:STK:2303', code: '2303', sequence: 4,
            close: '110', at: nowEpochMs + 15_100, time: '00:00:16.100000',
            omitPercentChange: true,
        });
        expect(staleAnd.multiConditionTriggeredStrategyCount).toBe(0);
        const coherentAnd = await recordMulti({
            contractKey: 'TSE:STK:2330', code: '2330', sequence: 5,
            close: '110', at: nowEpochMs + 15_200, time: '00:00:16.200000',
        });
        expect(coherentAnd.multiConditionTriggeredStrategyCount).toBe(1);
        const disabledFieldDoesNotLatch = await recordMulti({
            contractKey: 'TSE:STK:2303', code: '2303', sequence: 6,
            close: '110', at: nowEpochMs + 15_300, time: '00:00:16.300000',
        });
        expect(disabledFieldDoesNotLatch.multiConditionTriggeredStrategyCount).toBe(0);
        await expect(
            controller.pauseStrategy({
                expectedRevision: 3,
                nowEpochMs: nowEpochMs + 15_350,
                strategyId: 'multi-field-disabled-controller',
            }),
        ).resolves.toMatchObject({ state: 'paused', revision: 4 });
        await expect(
            controller.executeReplayProtectedStrategyMutation({
                requestId: '123e4567-e89b-42d3-a456-426614174899',
                operationKind: 'strategy_resume',
                payloadHash: `sha256:${'e'.repeat(64)}`,
                nowEpochMs: nowEpochMs + 15_400,
                mutation: {
                    activationPolicyAcknowledged: true,
                    contractEvidence: null,
                    controlPlaneAuthority,
                    expectedRevision: 4,
                    kind: 'resume',
                    nowEpochMs: nowEpochMs + 15_400,
                    strategyId: 'multi-field-disabled-controller',
                },
            }),
        ).resolves.toMatchObject({
            state: 'completed',
            result: { state: 'monitoring', revision: 5 },
        });
        const resetDatabase = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            resetDatabase.prepare(`
                SELECT
                    (SELECT COUNT(*) FROM multi_condition_leg_heads
                      WHERE strategy_id='multi-field-disabled-controller') AS legs,
                    (SELECT COUNT(*) FROM multi_condition_group_heads
                      WHERE strategy_id='multi-field-disabled-controller') AS groups
            `).get(),
        ).toEqual({ legs: 0, groups: 0 });
        resetDatabase.close();
        const firstTrueAfterResume = await recordMulti({
            contractKey: 'TSE:STK:2303', code: '2303', sequence: 7,
            close: '110', at: nowEpochMs + 15_500, time: '00:00:16.500000',
        });
        expect(firstTrueAfterResume.multiConditionTriggeredStrategyCount).toBe(0);
        await recordMulti({
            contractKey: 'TSE:STK:2303', code: '2303', sequence: 8,
            close: '90', at: nowEpochMs + 15_600, time: '00:00:16.600000',
        });
        const rearmedEdge = await recordMulti({
            contractKey: 'TSE:STK:2303', code: '2303', sequence: 9,
            close: '110', at: nowEpochMs + 15_700, time: '00:00:16.700000',
        });
        expect(rearmedEdge.multiConditionTriggeredStrategyCount).toBe(1);
        multiClock.mockRestore();
        const multiDatabase = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            multiDatabase.prepare(`
                SELECT strategies.strategy_id, groups.state,
                       groups.operator, groups.activation_id,
                       (SELECT COUNT(*) FROM activations
                         WHERE activations.strategy_id=strategies.strategy_id)
                           AS activation_count,
                       (SELECT COUNT(*) FROM order_intents
                         WHERE order_intents.strategy_id=strategies.strategy_id)
                           AS intent_count
                  FROM strategies
             LEFT JOIN multi_condition_group_heads AS groups
                    ON groups.strategy_id=strategies.strategy_id
                 WHERE strategies.strategy_id LIKE 'multi-%-controller'
                    OR strategies.strategy_id='multi-subscription-blocked-controller'
                 ORDER BY strategies.strategy_id
            `).all(),
        ).toEqual([
            {
                strategy_id: 'multi-and-controller',
                state: 'triggered',
                operator: 'AND',
                activation_id: expect.stringMatching(/^activation:multi-condition:/),
                activation_count: 1,
                intent_count: 0,
            },
            {
                strategy_id: 'multi-field-disabled-controller',
                state: 'triggered',
                operator: 'AND',
                activation_id: expect.stringMatching(/^activation:multi-condition:/),
                activation_count: 1,
                intent_count: 0,
            },
            {
                strategy_id: 'multi-or-controller',
                state: 'triggered',
                operator: 'OR',
                activation_id: expect.stringMatching(/^activation:multi-condition:/),
                activation_count: 1,
                intent_count: 0,
            },
            {
                strategy_id: 'multi-subscription-blocked-controller',
                state: null,
                operator: null,
                activation_id: null,
                activation_count: 0,
                intent_count: 0,
            },
        ]);
        multiDatabase.close();
        }

        async function exerciseParentChildVertical() {
        const parentNowEpochMs = nowEpochMs + 61;
        const parentBeforeCutoffEpochMs = 1_786_426_199_000;
        const parentAfterCutoffEpochMs = 1_786_426_201_000;
        const gateDatabase = new DatabaseSync(databasePath);
        gateDatabase.exec('PRAGMA busy_timeout=2500; BEGIN IMMEDIATE;');
        gateDatabase.prepare(`
            DELETE FROM gate_manifests
             WHERE provenance IN ('automation','manual_user_confirmed')
        `).run();
        const featureJson = JSON.stringify({
            featureGates: {
                good_till: false,
                multi_condition: false,
                parent_child: true,
                quick: true,
                scheduled_quantity: false,
                stop_take: false,
                trailing_exit: false,
            },
            fingerprints: {
                mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
            },
        });
        for (const [provenance, suffix] of [
            ['automation', 'automation'],
            ['manual_user_confirmed', 'manual'],
        ]) {
            gateDatabase.prepare(`
                INSERT INTO gate_manifests(
                    manifest_id, manifest_revision, manifest_sha256,
                    schema_version, provenance, manifest_json,
                    fingerprints_sha256, evidence_catalog_sha256,
                    feature_gates_sha256, product_boundary_consent_version,
                    state, valid_until_epoch_ms, created_at_epoch_ms, revision
                ) VALUES (?, ?, ?,
                    'smart-order-gate-manifest/2026-08-11.1', ?, ?,
                    ?, ?, ?, 'local-sidecar-consent/v1', 'eligible', ?, ?, 0)
            `).run(
                `parent-child-${suffix}-gate`,
                `parent-child-${suffix}-r1`,
                `sha256:${(suffix === 'automation' ? 'd' : 'e').repeat(64)}`,
                provenance,
                featureJson,
                DIGEST_A,
                DIGEST_B,
                `sha256:${'f'.repeat(64)}`,
                parentAfterCutoffEpochMs + 60_000,
                parentNowEpochMs,
            );
        }
        gateDatabase.exec('COMMIT');
        gateDatabase.close();

        const positions = [
            {
                averagePriceMinorUnits: 10_000,
                availableShares: 2_000,
                contractKey: 'TSE:2330:STK:Common',
                lastPriceMinorUnits: 10_100,
                positionLineageId: 'position-protected-confirmation',
                quantityShares: 2_000,
                unrealizedMinorUnits: 100_000,
                yesterdayQuantityShares: 2_000,
            },
            {
                averagePriceMinorUnits: 5_000,
                availableShares: 600,
                contractKey: 'TSE:2303:STK:Common',
                lastPriceMinorUnits: 5_100,
                positionLineageId: 'position-parent-child-child',
                quantityShares: 700,
                unrealizedMinorUnits: 70_000,
                yesterdayQuantityShares: 700,
            },
        ];
        const initialReconciliation = issuedProtectedEntryReconciliation({
            apiGeneration,
            runtimeEpochId,
            asOfEpochMs: parentNowEpochMs + 1,
            tradeDate: '2026-08-11',
            dealIds: [],
            positions,
            sourceRevision: 'parent-child-source-1',
        });
        await expect(
            controller.recordAccountReconciliation({
                brokerObservationEvidenceSha256: null,
                nowEpochMs: parentNowEpochMs + 2,
                result: initialReconciliation,
            }),
        ).resolves.toMatchObject({
            state: 'recorded',
            brokerWriteAuthority: false,
        });
        const parentEvidence = issuedProtectedEntryContractEvidence({
            apiGeneration,
            runtimeEpochId,
            observedAtEpochMs: parentNowEpochMs + 3,
            gateManifestHash: `sha256:${'d'.repeat(64)}`,
            gateManifestRevision: 'parent-child-automation-r1',
            mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
            validUntilEpochMs: parentAfterCutoffEpochMs + 60_000,
        });
        const childEvidence = issuedProtectedEntryContractEvidence({
            apiGeneration,
            runtimeEpochId,
            observedAtEpochMs: parentNowEpochMs + 3,
            gateManifestHash: `sha256:${'d'.repeat(64)}`,
            gateManifestRevision: 'parent-child-automation-r1',
            mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
            validUntilEpochMs: parentAfterCutoffEpochMs + 60_000,
            contractOverrides: {
                code: '2303',
                contractUnit: 500,
                draftContractKey: 'TSE:STK:2303',
                runtimeContractKey: 'TSE:2303:STK:Common',
            },
        });
        const definition = JSON.parse(
            JSON.stringify(canonicalSmartOrderDraft('parent_child')),
        );
        definition.parameters.parent.condition.mappingRevision =
            SMART_ORDER_QUICK_FIELD_MAPPING_REVISION;
        definition.parameters.child.condition.mappingRevision =
            SMART_ORDER_QUICK_FIELD_MAPPING_REVISION;
        definition.parameters.child.order.contractUnit = '500';
        definition.parameters.child.order.commonLots = '1';
        definition.parameters.child.order.baseShares = '500';
        definition.parameters.parentValidity.endDate = '2026-08-12';
        await controller.createDraftStrategy({
            strategyId: 'parent-child-production-controller',
            strategyKind: 'parent_child',
            workspaceContractKey: 'TSE:STK:2330',
            nowEpochMs: parentNowEpochMs + 4,
        });
        await controller.replaceDraftStrategy({
            strategyId: 'parent-child-production-controller',
            expectedRevision: 0,
            draft: definition,
            nowEpochMs: parentNowEpochMs + 5,
        });
        const confirmationId = '123e4567-e89b-42d3-a456-426614174901';
        const preview = await controller.executeReplayProtectedStrategyMutation({
            requestId: '123e4567-e89b-42d3-a456-426614174902',
            operationKind: 'strategy_confirmation_preview',
            payloadHash: `sha256:${'1'.repeat(64)}`,
            nowEpochMs: parentNowEpochMs + 6,
            mutation: {
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                basisSelection: null,
                confirmationId,
                contractEvidence: parentEvidence,
                monitorContractEvidence: [childEvidence],
                controlPlaneAuthority,
                expectedRevision: 1,
                kind: 'strategy_confirmation_preview',
                nowEpochMs: parentNowEpochMs + 6,
                strategyId: 'parent-child-production-controller',
            },
        });
        expect(preview).toMatchObject({
            state: 'completed',
            result: {
                state: 'previewed',
                strategyKind: 'parent_child',
                brokerWriteAuthority: false,
            },
        });
        const parentChildSnapshotDatabase = new DatabaseSync(databasePath, {
            readOnly: true,
        });
        const parentChildSnapshot = parentChildSnapshotDatabase
            .prepare(
                `SELECT gate_manifest_revision, gate_manifest_hash, snapshot_json
                   FROM canonical_confirmation_snapshots
                  WHERE confirmation_id=?`,
            )
            .get(confirmationId);
        parentChildSnapshotDatabase.close();
        expect(parentChildSnapshot).toMatchObject({
            gate_manifest_revision: 'parent-child-automation-r1',
            gate_manifest_hash: `sha256:${'d'.repeat(64)}`,
        });
        expect(JSON.parse(parentChildSnapshot.snapshot_json).gate).toEqual({
            manifestRevision: 'parent-child-automation-r1',
            manifestHash: `sha256:${'d'.repeat(64)}`,
            mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
        });
        await expect(
            controller.gateManifestStatus({
                provenance: 'automation',
                nowEpochMs: nowEpochMs + 500,
            }),
        ).resolves.toMatchObject({
            state: 'eligible',
            manifestRevision: 'parent-child-automation-r1',
            manifestSha256: `sha256:${'d'.repeat(64)}`,
            mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
        });
        await expect(
            controller.executeReplayProtectedStrategyMutation({
                requestId: '123e4567-e89b-42d3-a456-426614174903',
                operationKind: 'strategy_confirmation_accept',
                payloadHash: `sha256:${'2'.repeat(64)}`,
                nowEpochMs: parentNowEpochMs + 7,
                mutation: {
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    basisSelection: null,
                    confirmationId,
                    contractEvidence: parentEvidence,
                    monitorContractEvidence: [childEvidence],
                    controlPlaneAuthority,
                    expectedRevision: 1,
                    kind: 'strategy_confirmation_accept',
                    nowEpochMs: parentNowEpochMs + 7,
                    snapshotHash: preview.result.snapshotHash,
                    strategyId: 'parent-child-production-controller',
                    userAcknowledged: true,
                },
            }),
        ).resolves.toMatchObject({
            state: 'completed',
            result: { strategy: { state: 'paused', revision: 2 } },
        });
        await expect(
            controller.executeReplayProtectedStrategyMutation({
                requestId: '123e4567-e89b-42d3-a456-426614174904',
                operationKind: 'strategy_resume',
                payloadHash: `sha256:${'3'.repeat(64)}`,
                nowEpochMs: parentNowEpochMs + 8,
                mutation: {
                    activationPolicyAcknowledged: true,
                    contractEvidence: null,
                    controlPlaneAuthority,
                    expectedRevision: 2,
                    kind: 'resume',
                    nowEpochMs: parentNowEpochMs + 8,
                    strategyId: 'parent-child-production-controller',
                },
            }),
        ).resolves.toMatchObject({
            state: 'completed',
            result: { state: 'monitoring', revision: 3 },
        });

        const quoteCoordinator = createSmartOrderQuoteSubscriptionCoordinator({
            apiGeneration,
            connectionId: 'parent-child-controller-stream',
            nowMonotonicMs: () => parentNowEpochMs + 10,
            resourceCoordinator: Object.freeze({
                reserveSubscriptionDemand(demand) {
                    return Object.freeze({
                        allowed: true,
                        brokerAuthority: false,
                        countingDimension: demand.countingDimension,
                        demandId: demand.demandId,
                        projectedUsageUnits: 2,
                        release() {},
                        units: demand.units,
                    });
                },
                status() {
                    return Object.freeze({
                        brokerAuthority: false,
                        closed: false,
                        subscriptionCountingDimension:
                            'verified-subscription-item/v1',
                        subscriptionEvidenceCurrent: true,
                        writeMasterAuthority: false,
                    });
                },
            }),
            resourceCountingDimension: 'verified-subscription-item/v1',
        });
        const authorityByContract = new Map();
        for (const [consumerId, contract] of [
            ['parent-child-parent-demand', { code: '2330', exchange: 'TSE', securityType: 'STK' }],
            ['parent-child-child-demand', { code: '2303', exchange: 'TSE', securityType: 'STK' }],
        ]) {
            quoteCoordinator.runtime.acquireDemand({
                consumerId,
                contract,
                quoteType: 'tick',
            });
        }
        for (const plan of quoteCoordinator.observer.pendingPlans()) {
            const confirmation = quoteCoordinator.runtime.confirmPlan(plan, {
                action: plan.action,
                apiGeneration: plan.apiGeneration,
                connectionId: plan.connectionId,
                planId: plan.planId,
            });
            authorityByContract.set(
                `${plan.contract.exchange}:STK:${plan.contract.code}`,
                confirmation.streamAuthority,
            );
        }
        const quoteClock = vi.spyOn(Date, 'now');
        const confirmationDatabase = new DatabaseSync(databasePath, {
            readOnly: true,
        });
        expect(confirmationDatabase.prepare(`
            SELECT snapshots.state, snapshots.snapshot_hash,
                   strategies.confirmation_snapshot_hash
              FROM canonical_confirmation_snapshots AS snapshots
              JOIN strategies USING(strategy_id)
             WHERE snapshots.strategy_id='parent-child-production-controller'
        `).all()).toEqual([
            {
                state: 'accepted',
                snapshot_hash: preview.result.snapshotHash,
                confirmation_snapshot_hash: preview.result.snapshotHash,
            },
        ]);
        confirmationDatabase.close();
        const isolateParentChild = new DatabaseSync(databasePath);
        isolateParentChild.prepare(`
            UPDATE strategies SET state='paused', revision=revision+1,
                   updated_at_epoch_ms=?
             WHERE strategy_id<>'parent-child-production-controller'
               AND state='monitoring'
        `).run(parentNowEpochMs + 9);
        isolateParentChild.close();
        const recordQuote = async ({ code, contractKey, close, sequence, time }) => {
            const observedAt = parentNowEpochMs + sequence;
            quoteClock.mockReturnValue(observedAt);
            const normalized = normalizeSmartOrderQuickFieldEvent({
                contractKey,
                event: {
                    eventKind: 'tick', code, date: '2026-08-11', time, close,
                    volume: 1, totalVolume: sequence,
                    priceChange: Number(close) >= 100 ? '5' : '-5',
                    percentChange: Number(close) >= 100 ? 500 : -500,
                    simtrade: false, intradayOdd: false,
                },
                receiveTimeMs: observedAt,
                sequence,
                streamEpoch: 'parent-child-controller-stream',
            });
            const issued = quoteCoordinator.runtime.recordMappedObservation(
                authorityByContract.get(contractKey),
                normalized,
            );
            expect(issued.quickConditionEligible).toBe(true);
            return controller.recordQuickQuoteObservation({ observation: issued });
        };
        await recordQuote({
            code: '2330', contractKey: 'TSE:STK:2330', close: '95',
            sequence: 1, time: '00:00:01.062000',
        });
        await expect(recordQuote({
            code: '2330', contractKey: 'TSE:STK:2330', close: '105',
            sequence: 2, time: '00:00:01.063000',
        })).resolves.toMatchObject({
            parentChildPreparedIntentCount: 1,
            automaticDispatchAllowed: false,
            brokerWriteAuthority: false,
        });
        const parentDispatchSetup = new DatabaseSync(databasePath);
        const active = parentDispatchSetup.prepare(`
            SELECT progress.parent_intent_id AS intent_id,
                   progress.parent_activation_id AS activation_id,
                   intents.revision AS intent_revision,
                   activations.revision AS activation_revision,
                   reservations.revision AS reservation_revision,
                   reservations.policy_revision AS risk_revision,
                   rearms.rearm_authorization_id,
                   rearms.authorized_intent_revision,
                   rearms.revision AS rearm_revision,
                   strategies.confirmation_snapshot_hash,
                   epochs.reconciliation_evidence_hash
              FROM parent_child_progress_heads AS progress
              JOIN order_intents AS intents
                ON intents.intent_id=progress.parent_intent_id
              JOIN activations
                ON activations.activation_id=progress.parent_activation_id
              JOIN entry_exposure_reservations AS reservations
                ON reservations.intent_id=progress.parent_intent_id
         LEFT JOIN intent_rearm_authorizations AS rearms
                ON rearms.intent_id=progress.parent_intent_id
               AND rearms.runtime_epoch_id=?
               AND rearms.state='active'
              JOIN strategies USING(strategy_id)
              JOIN runtime_epochs AS epochs
                ON epochs.runtime_epoch_id=?
             WHERE progress.strategy_id='parent-child-production-controller'
        `).get(runtimeEpochId, runtimeEpochId);
        parentDispatchSetup.prepare(`
            UPDATE account_reconciliation_positions
               SET valid_until_epoch_ms=?
             WHERE account_broker_ref='broker-A'
               AND account_id_ref='account-A'
               AND trade_date='2026-08-11'
               AND contract_key='TSE:2303:STK:Common'
        `).run(parentAfterCutoffEpochMs + 60_000);
        parentDispatchSetup.close();

        const dispatchRepository = await openSmartOrderRepository({
            databasePath,
            backupDirectory: path.join(
                appSupportRoot,
                'smart-order',
                'backups',
            ),
            testOnlyAllowSyntheticGateManifestProjection: true,
            testOnlyExposureClockNowEpochMs: parentNowEpochMs + 500,
        });
        const rearm = active.rearm_authorization_id === null
            ? await dispatchRepository.request('rearmPreparedIntent', {
                  rearmAuthorizationId: 'parent-child-rearm-authorization-1',
                  rearmRequestId: 'parent-child-rearm-request-1',
                  intentId: active.intent_id,
                  runtimeEpochId,
                  senderFence,
                  apiGeneration,
                  expectedIntentRevision: active.intent_revision,
                  confirmationSnapshotHash: active.confirmation_snapshot_hash,
                  riskRevision: active.risk_revision,
                  reconciliationEvidenceHash:
                      active.reconciliation_evidence_hash,
                  userRearmEvidenceHash: DIGEST_A,
                  nowEpochMs: parentNowEpochMs + 20,
              })
            : {
                  rearmAuthorizationId: active.rearm_authorization_id,
                  intentRevision: active.authorized_intent_revision,
                  rearmRevision: active.rearm_revision,
              };
        const dispatchRequest = {
            intentId: active.intent_id,
            runtimeEpochId,
            expectedRevision: rearm.intentRevision,
            expectedActivationRevision: active.activation_revision,
            expectedReservationRevision: active.reservation_revision,
            expectedRearmRevision: rearm.rearmRevision,
            dispatchAttemptNonce: 'parent-child-attempt-1',
            senderFence,
            apiGeneration,
            modeRevision: 'parent-child-mode-revision-1',
            riskRevision: active.risk_revision,
            accountRevision: 'parent-child-account-revision-1',
            targetRevision: 'parent-child-target-revision-1',
            expectedKillSwitchArbiterRevision: 0,
            killSwitchArbiterRevision: 0,
            nowEpochMs: parentBeforeCutoffEpochMs,
        };
        const grant = await dispatchRepository.request(
            'markIntentDispatching',
            dispatchRequest,
        );
        const verification = {
            intentId: active.intent_id,
            runtimeEpochId,
            revision: grant.revision,
            activationRevision: grant.activationRevision,
            reservationRevision: grant.reservationRevision,
            rearmAuthorizationId: grant.rearmAuthorizationId,
            rearmRevision: grant.rearmRevision,
            dispatchAttemptNonce: dispatchRequest.dispatchAttemptNonce,
            senderFence,
            apiGeneration,
            modeRevision: dispatchRequest.modeRevision,
            riskRevision: dispatchRequest.riskRevision,
            accountRevision: dispatchRequest.accountRevision,
            targetRevision: grant.targetRevision,
            killSwitchArbiterRevision: grant.killSwitchArbiterRevision,
            killSwitchOperationClass: grant.killSwitchOperationClass,
            killSwitchDecisionHash: grant.killSwitchDecisionHash,
        };
        const beforeCutoff = await dispatchRepository.request(
            'verifyDispatchGrant',
            { ...verification, nowEpochMs: parentBeforeCutoffEpochMs },
        );
        expect(beforeCutoff).toMatchObject({
            authorized: true,
            envelope: {
                intentId: active.intent_id,
                payload: { leg: 'parent' },
            },
        });
        await expect(
            dispatchRepository.request('verifyDispatchGrant', {
                ...verification,
                nowEpochMs: parentAfterCutoffEpochMs,
            }),
        ).resolves.toEqual({
            authorized: false,
            reasonCode: 'parent_child_dispatch_window_closed',
        });
        await dispatchRepository.close();

        const dispatched = new DatabaseSync(databasePath);
        dispatched.prepare(`
            INSERT INTO broker_orders(
                broker_order_id, intent_id, state, control_revision,
                quantity_shares, filled_shares, remaining_shares,
                evidence_hash, updated_at_epoch_ms, terminal_at_epoch_ms,
                revision
            ) VALUES ('broker-order-parent-child-1', ?, 'pending_submit', 0,
                      1000, 0, 1000, ?, ?, NULL, 0)
        `).run(active.intent_id, DIGEST_A, parentNowEpochMs + 20);
        dispatched.prepare(`
            INSERT INTO broker_correlations(
                correlation_id, intent_id, broker_order_id,
                canonical_key_hash, account_broker_ref, account_id_ref,
                trade_date, contract_key, side, trade_id, order_id,
                deal_id, seqno, ordno, exchange_sequence, custom_field,
                evidence_hash, created_at_epoch_ms, revision
            ) VALUES ('correlation-parent-child-1', ?,
                      'broker-order-parent-child-1', ?, 'broker-A',
                      'account-A', '2026-08-11', 'TSE:2330:STK:Common',
                      'Buy', 'parent-child-trade-1', NULL,
                      'parent-child-deal-1', 'parent-child-seq-1',
                      'parent-child-ord-1', 'parent-child-exchange-seq-1',
                      'PC001', ?, ?, 0)
        `).run(active.intent_id, brokerCorrelationHash({
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            tradeDate: '2026-08-11',
            contractKey: 'TSE:2330:STK:Common',
            side: 'Buy',
            tradeId: 'parent-child-trade-1',
            dealId: 'parent-child-deal-1',
            seqno: 'parent-child-seq-1',
            ordno: 'parent-child-ord-1',
            exchangeSequence: 'parent-child-exchange-seq-1',
        }), DIGEST_A,
            parentNowEpochMs + 20);
        for (const [kind, value] of [
            ['tradeId', 'parent-child-trade-1'],
            ['dealId', 'parent-child-deal-1'],
            ['seqno', 'parent-child-seq-1'],
            ['ordno', 'parent-child-ord-1'],
            ['exchangeSequence', 'parent-child-exchange-seq-1'],
        ]) {
            dispatched.prepare(`
                INSERT INTO broker_correlation_identifiers(
                    account_broker_ref, account_id_ref, trade_date,
                    contract_key, side, identifier_kind, identifier_value,
                    intent_id, correlation_id, created_at_epoch_ms
                ) VALUES ('broker-A','account-A','2026-08-11',
                          'TSE:2330:STK:Common','Buy',?,?,?,
                          'correlation-parent-child-1',?)
            `).run(kind, value, active.intent_id, parentNowEpochMs + 20);
        }
        dispatched.close();
        const workingEvent = protectedEntryControllerBrokerEvent(
            apiGeneration,
            {
                eventKind: 'order', tradeDate: '2026-08-11',
                tradeId: 'parent-child-trade-1',
                orderId: 'parent-child-order-1', dealId: null,
                seqno: 'parent-child-seq-1',
                ordno: 'parent-child-ord-1',
                exchangeSequence: 'parent-child-order-exchange-seq-1',
                customField: 'PC001', status: 'Submitted', order: 1_000,
                cumulativeDeal: 0, cumulativeCancel: 0, remaining: 1_000,
                eventDeal: 0, exchangeEpochMs: parentNowEpochMs + 21,
            },
        );
        await expect(
            controller.recordCanonicalBrokerEvent({ event: workingEvent }),
        ).resolves.toMatchObject({ brokerWriteAuthority: false });
        const workingSettlement = issuedProtectedEntryReconciliation({
            apiGeneration,
            runtimeEpochId,
            asOfEpochMs: parentNowEpochMs + 22,
            tradeDate: '2026-08-11',
            dealIds: [],
            positions,
            sourceRevision: 'parent-child-source-working',
        });
        await expect(
            controller.recordAccountReconciliation({
                brokerObservationEvidenceSha256:
                    workingEvent.brokerEventEvidenceSha256,
                nowEpochMs: parentNowEpochMs + 23,
                result: workingSettlement,
            }),
        ).resolves.toMatchObject({
            state: 'recorded',
            parentChildSettledCount: 0,
            parentChildBlockedCount: 1,
            brokerWriteAuthority: false,
        });
        expect(() =>
            controller.completeBrokerObservationReconciliation({
                eventEvidenceSha256: workingEvent.brokerEventEvidenceSha256,
            }),
        ).not.toThrow();
        const workingDatabase = new DatabaseSync(databasePath, {
            readOnly: true,
        });
        expect(workingDatabase.prepare(`
            SELECT progress.state,
                   (SELECT COUNT(*) FROM order_intents
                     WHERE strategy_id=progress.strategy_id
                       AND json_extract(payload_json, '$.leg')='child')
                       AS child_intent_count
              FROM parent_child_progress_heads AS progress
             WHERE progress.strategy_id='parent-child-production-controller'
        `).get()).toEqual({
            state: 'parent_working',
            child_intent_count: 0,
        });
        workingDatabase.close();
        const filledEvent = protectedEntryControllerBrokerEvent(apiGeneration, {
            eventKind: 'deal', tradeDate: '2026-08-11',
            tradeId: 'parent-child-trade-1', dealId: 'parent-child-deal-1',
            seqno: 'parent-child-seq-1', ordno: 'parent-child-ord-1',
            exchangeSequence: 'parent-child-exchange-seq-1',
            customField: 'PC001', status: 'Filled', order: 1_000,
            cumulativeDeal: 1_000, cumulativeCancel: 0, remaining: 0,
            eventDeal: 1_000, exchangeEpochMs: parentNowEpochMs + 24,
        });
        await expect(
            controller.recordCanonicalBrokerEvent({ event: filledEvent }),
        ).resolves.toMatchObject({ brokerWriteAuthority: false });
        const settlement = issuedProtectedEntryReconciliation({
            apiGeneration,
            runtimeEpochId,
            asOfEpochMs: parentNowEpochMs + 25,
            tradeDate: '2026-08-11',
            dealIds: ['parent-child-deal-1'],
            positions: [
                { ...positions[0], quantityShares: 3_000, availableShares: 3_000 },
                positions[1],
            ],
            sourceRevision: 'parent-child-source-2',
        });
        await expect(
            controller.recordAccountReconciliation({
                brokerObservationEvidenceSha256:
                    filledEvent.brokerEventEvidenceSha256,
                nowEpochMs: parentNowEpochMs + 26,
                result: settlement,
            }),
        ).resolves.toMatchObject({
            state: 'recorded',
            parentChildSettledCount: 1,
            brokerWriteAuthority: false,
        });
        expect(() =>
            controller.completeBrokerObservationReconciliation({
                eventEvidenceSha256: filledEvent.brokerEventEvidenceSha256,
            }),
        ).not.toThrow();
        const readyDatabase = new DatabaseSync(databasePath, { readOnly: true });
        const reconciliationEvidenceHash = readyDatabase.prepare(`
            SELECT reconciliation_evidence_hash FROM runtime_epochs
             WHERE runtime_epoch_id=?
        `).get(runtimeEpochId).reconciliation_evidence_hash;
        readyDatabase.close();
        await controller.markReady({ reconciliationEvidenceHash });
        await recordQuote({
            code: '2303', contractKey: 'TSE:STK:2303', close: '95',
            sequence: 15, time: '00:00:01.076000',
        });
        await expect(recordQuote({
            code: '2303', contractKey: 'TSE:STK:2303', close: '105',
            sequence: 16, time: '00:00:01.077000',
        })).resolves.toMatchObject({
            parentChildPreparedIntentCount: 1,
            automaticDispatchAllowed: false,
            brokerWriteAuthority: false,
        });
        quoteClock.mockRestore();
        const verified = new DatabaseSync(databasePath, { readOnly: true });
        expect(verified.prepare(`
            SELECT progress.state, progress.child_quantity_shares,
                   json_extract(intents.payload_json, '$.leg') AS leg,
                   json_extract(intents.payload_json, '$.order.side') AS side,
                   json_extract(intents.payload_json, '$.order.baseShares') AS shares,
                   claims.state AS claim_state, claims.intent_id AS claim_intent_id,
                   intents.state AS intent_state,
                   intents.adapter_authority_granted
              FROM parent_child_progress_heads AS progress
              JOIN order_intents AS intents
                ON intents.intent_id=progress.child_intent_id
              JOIN exit_claims AS claims
                ON claims.exit_claim_id=progress.child_exit_claim_id
             WHERE progress.strategy_id='parent-child-production-controller'
        `).get()).toEqual({
            state: 'child_intent_prepared',
            child_quantity_shares: 500,
            leg: 'child',
            side: 'Sell',
            shares: 500,
            claim_state: 'intent_reserved',
            claim_intent_id: expect.stringMatching(/^intent:parent-child:/),
            intent_state: 'prepared',
            adapter_authority_granted: 0,
        });
        expect(verified.prepare(`
            SELECT COUNT(*) AS count FROM order_intents
             WHERE strategy_id='parent-child-production-controller'
               AND json_extract(payload_json, '$.leg')='child'
        `).get()).toEqual({ count: 1 });
        verified.close();

        const childDispatch = new DatabaseSync(databasePath);
        const childActive = childDispatch.prepare(`
            SELECT progress.child_intent_id AS intent_id,
                   progress.child_activation_id AS activation_id
              FROM parent_child_progress_heads AS progress
             WHERE progress.strategy_id='parent-child-production-controller'
        `).get();
        childDispatch.prepare(`
            UPDATE order_intents SET state='dispatching',
                   adapter_authority_granted=1,
                   dispatch_attempt_nonce='parent-child-attempt-2',
                   runtime_epoch_id=?, sender_fence=?, api_generation=?,
                   revision=revision+1
             WHERE intent_id=? AND state='prepared'
        `).run(runtimeEpochId, senderFence, apiGeneration, childActive.intent_id);
        childDispatch.prepare(`
            UPDATE activations SET state='dispatching', revision=revision+1
             WHERE activation_id=? AND state='prepared'
        `).run(childActive.activation_id);
        childDispatch.prepare(`
            INSERT INTO broker_orders(
                broker_order_id, intent_id, state, control_revision,
                quantity_shares, filled_shares, remaining_shares,
                evidence_hash, updated_at_epoch_ms, terminal_at_epoch_ms,
                revision
            ) VALUES ('broker-order-parent-child-2', ?, 'pending_submit', 0,
                      500, 0, 500, ?, ?, NULL, 0)
        `).run(childActive.intent_id, DIGEST_A, parentNowEpochMs + 27);
        childDispatch.prepare(`
            INSERT INTO broker_correlations(
                correlation_id, intent_id, broker_order_id,
                canonical_key_hash, account_broker_ref, account_id_ref,
                trade_date, contract_key, side, trade_id, order_id,
                deal_id, seqno, ordno, exchange_sequence, custom_field,
                evidence_hash, created_at_epoch_ms, revision
            ) VALUES ('correlation-parent-child-2', ?,
                      'broker-order-parent-child-2', ?, 'broker-A',
                      'account-A', '2026-08-11', 'TSE:2303:STK:Common',
                      'Sell', 'parent-child-trade-2', NULL,
                      'parent-child-deal-2', 'parent-child-seq-2',
                      'parent-child-ord-2', 'parent-child-exchange-seq-2',
                      'PC002', ?, ?, 0)
        `).run(childActive.intent_id, brokerCorrelationHash({
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            tradeDate: '2026-08-11',
            contractKey: 'TSE:2303:STK:Common',
            side: 'Sell',
            tradeId: 'parent-child-trade-2',
            dealId: 'parent-child-deal-2',
            seqno: 'parent-child-seq-2',
            ordno: 'parent-child-ord-2',
            exchangeSequence: 'parent-child-exchange-seq-2',
        }), DIGEST_A,
            parentNowEpochMs + 27);
        for (const [kind, value] of [
            ['tradeId', 'parent-child-trade-2'],
            ['dealId', 'parent-child-deal-2'],
            ['seqno', 'parent-child-seq-2'],
            ['ordno', 'parent-child-ord-2'],
            ['exchangeSequence', 'parent-child-exchange-seq-2'],
        ]) {
            childDispatch.prepare(`
                INSERT INTO broker_correlation_identifiers(
                    account_broker_ref, account_id_ref, trade_date,
                    contract_key, side, identifier_kind, identifier_value,
                    intent_id, correlation_id, created_at_epoch_ms
                ) VALUES ('broker-A','account-A','2026-08-11',
                          'TSE:2303:STK:Common','Sell',?,?,?,
                          'correlation-parent-child-2',?)
            `).run(kind, value, childActive.intent_id, parentNowEpochMs + 27);
        }
        childDispatch.close();
        const childFilledEvent = protectedEntryControllerBrokerEvent(
            apiGeneration,
            {
                eventKind: 'deal', tradeDate: '2026-08-11',
                contractKey: 'TSE:2303:STK:Common', side: 'Sell',
                tradeId: 'parent-child-trade-2',
                dealId: 'parent-child-deal-2',
                seqno: 'parent-child-seq-2', ordno: 'parent-child-ord-2',
                exchangeSequence: 'parent-child-exchange-seq-2',
                customField: 'PC002', status: 'Filled', order: 500,
                cumulativeDeal: 500, cumulativeCancel: 0, remaining: 0,
                eventDeal: 500, exchangeEpochMs: parentNowEpochMs + 28,
            },
        );
        await expect(
            controller.recordCanonicalBrokerEvent({ event: childFilledEvent }),
        ).resolves.toMatchObject({ brokerWriteAuthority: false });
        const childSettlement = issuedProtectedEntryReconciliation({
            apiGeneration,
            runtimeEpochId,
            asOfEpochMs: parentNowEpochMs + 29,
            tradeDate: '2026-08-11',
            dealIds: ['parent-child-deal-2'],
            positions: [
                { ...positions[0], quantityShares: 3_000, availableShares: 3_000 },
                { ...positions[1], quantityShares: 200, availableShares: 200,
                    yesterdayQuantityShares: 200 },
            ],
            sourceRevision: 'parent-child-source-3',
        });
        await expect(
            controller.recordAccountReconciliation({
                brokerObservationEvidenceSha256:
                    childFilledEvent.brokerEventEvidenceSha256,
                nowEpochMs: parentNowEpochMs + 30,
                result: childSettlement,
            }),
        ).resolves.toMatchObject({
            state: 'recorded',
            parentChildSettledCount: 1,
            brokerWriteAuthority: false,
        });
        expect(() =>
            controller.completeBrokerObservationReconciliation({
                eventEvidenceSha256:
                    childFilledEvent.brokerEventEvidenceSha256,
            }),
        ).not.toThrow();
        const completedDatabase = new DatabaseSync(databasePath, {
            readOnly: true,
        });
        const completedReadyHash = completedDatabase.prepare(`
            SELECT reconciliation_evidence_hash FROM runtime_epochs
             WHERE runtime_epoch_id=?
        `).get(runtimeEpochId).reconciliation_evidence_hash;
        expect(completedDatabase.prepare(`
            SELECT strategies.state AS strategy_state,
                   progress.state AS progress_state,
                   claims.state AS claim_state,
                   obligations.state AS obligation_state,
                   groups.state AS group_state
              FROM strategies
              JOIN parent_child_progress_heads AS progress USING(strategy_id)
              JOIN exit_claims AS claims
                ON claims.exit_claim_id=progress.child_exit_claim_id
              JOIN protection_obligations AS obligations
                ON obligations.obligation_id=progress.child_obligation_id
              JOIN protection_groups AS groups
                ON groups.protection_group_id=progress.child_protection_group_id
             WHERE strategies.strategy_id='parent-child-production-controller'
        `).get()).toEqual({
            strategy_state: 'completed',
            progress_state: 'completed',
            claim_state: 'consumed',
            obligation_state: 'fulfilled',
            group_state: 'fulfilled',
        });
        completedDatabase.close();
        await controller.markReady({
            reconciliationEvidenceHash: completedReadyHash,
        });
        const restoredReconciliation = issuedProtectedEntryReconciliation({
            apiGeneration,
            runtimeEpochId,
            asOfEpochMs: parentNowEpochMs + 31,
            tradeDate: '2026-08-11',
            dealIds: ['parent-child-deal-1', 'parent-child-deal-2'],
            availableShares: 1_000,
            quantityShares: 1_000,
            positionLineageId: 'position-protected-confirmation',
            sourceRevision: 'parent-child-source-4',
        });
        await expect(
            controller.recordAccountReconciliation({
                brokerObservationEvidenceSha256: null,
                nowEpochMs: parentNowEpochMs + 32,
                result: restoredReconciliation,
            }),
        ).resolves.toMatchObject({
            state: 'recorded',
            runtimeReadinessContribution: true,
            brokerWriteAuthority: false,
        });
        }
    });

    it('accepts an existing-position trailing confirmation and drives its durable production quote vertical', async () => {
        const appSupportRoot = await privateRoot();
        const nowEpochMs = 1_786_377_620_000;
        const apiGeneration = 'api-generation-existing-trailing';
        const runtimeEpochId = 'runtime-existing-trailing';
        const senderFence = 'fence-existing-trailing';
        const controlPlaneAuthority = Object.freeze({});
        const authenticatedIdentityEvidence = Object.freeze({
            accountScopes: Object.freeze([
                Object.freeze({
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                }),
            ]),
            canonicalPrincipal: 'existing-trailing-principal',
            mappingRevision: 'identity-mapping/1',
            principalEvidenceHash: DIGEST_A,
        });
        identityAuthority.evidence.add(authenticatedIdentityEvidence);
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration,
            nowEpochMs,
            runtimeEpochId,
            senderFence,
            strategyConfirmationControlPlaneAuthority: controlPlaneAuthority,
            repositoryOptions: {
                testOnlyAllowSyntheticGateManifestProjection: true,
                testOnlyExposureClockNowEpochMs: nowEpochMs + 500,
            },
        });
        openControllers.add({
            controller,
            stopAtEpochMs: nowEpochMs + 10_000,
        });
        controller.acceptAuthenticatedIdentityEvidence(
            authenticatedIdentityEvidence,
        );
        await controller.executeReplayProtectedStrategyMutation({
            requestId: '123e4567-e89b-42d3-a456-426614174801',
            operationKind: 'risk_policy_publish',
            payloadHash: DIGEST_A,
            nowEpochMs: nowEpochMs + 10,
            mutation: {
                kind: 'risk_policy_publish',
                expectedRevision: null,
                policy: protectedEntryRuntimeRiskPolicy(),
                nowEpochMs: nowEpochMs + 10,
            },
        });
        const reconciliation = issuedProtectedEntryReconciliation({
            apiGeneration,
            runtimeEpochId,
            asOfEpochMs: nowEpochMs + 50,
            tradeDate: '2026-08-11',
            dealIds: [],
            availableShares: 1_000,
            quantityShares: 1_000,
            positionLineageId: 'position-existing-trailing',
        });
        await controller.recordAccountReconciliation({
            brokerObservationEvidenceSha256: null,
            nowEpochMs: nowEpochMs + 60,
            result: reconciliation,
        });
        await controller.markReady({
            reconciliationEvidenceHash: reconciliation.evidenceSha256,
        });
        const databasePath = path.join(
            appSupportRoot,
            'smart-order',
            'database',
            'smart-orders.sqlite3',
        );
        seedEligibleProtectedEntryGate(databasePath, nowEpochMs + 70);
        await controller.createDraftStrategy({
            strategyId: 'existing-position-trailing-vertical',
            strategyKind: 'trailing_exit',
            workspaceContractKey: 'TSE:STK:2330',
            nowEpochMs: nowEpochMs + 80,
        });
        const draft = canonicalSmartOrderDraft('trailing_exit');
        draft.parameters.activationPrice = '103';
        draft.parameters.retracement = {
            kind: 'fixed_atr',
            atr: '9',
            multiplier: '2',
            atrSnapshotRevision: 'caller-must-not-authorize-atr',
        };
        draft.parameters.fixedStopPrice = '95';
        const updated = await controller.replaceDraftStrategy({
            strategyId: 'existing-position-trailing-vertical',
            expectedRevision: 0,
            draft,
            nowEpochMs: nowEpochMs + 81,
        });
        const contractEvidence = issuedProtectedEntryContractEvidence({
            apiGeneration,
            runtimeEpochId,
            observedAtEpochMs: nowEpochMs + 82,
            fixedAtrContext: {
                decisionTradingDate: '2026-08-11',
                strategyDefinitionHash: updated.definitionHash,
            },
        });
        const confirmationId = '123e4567-e89b-42d3-a456-426614174802';
        const preview = await controller.executeReplayProtectedStrategyMutation({
            requestId: confirmationId,
            operationKind: 'strategy_confirmation_preview',
            payloadHash: `sha256:${'8'.repeat(64)}`,
            nowEpochMs: nowEpochMs + 83,
            mutation: {
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                basisSelection: { source: 'broker_average_cost' },
                confirmationId,
                contractEvidence,
                controlPlaneAuthority,
                expectedRevision: 1,
                kind: 'strategy_confirmation_preview',
                nowEpochMs: nowEpochMs + 83,
                strategyId: 'existing-position-trailing-vertical',
            },
        });
        expect(preview).toMatchObject({
            state: 'completed',
            result: { state: 'previewed', brokerWriteAuthority: false },
        });
        const accepted = await controller.executeReplayProtectedStrategyMutation({
            requestId: '123e4567-e89b-42d3-a456-426614174803',
            operationKind: 'strategy_confirmation_accept',
            payloadHash: `sha256:${'9'.repeat(64)}`,
            nowEpochMs: nowEpochMs + 84,
            mutation: {
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                basisSelection: { source: 'broker_average_cost' },
                confirmationId,
                contractEvidence,
                controlPlaneAuthority,
                expectedRevision: 1,
                kind: 'strategy_confirmation_accept',
                nowEpochMs: nowEpochMs + 84,
                snapshotHash: preview.result.snapshotHash,
                strategyId: 'existing-position-trailing-vertical',
                userAcknowledged: true,
            },
        });
        expect(accepted).toMatchObject({
            state: 'completed',
            result: {
                state: 'accepted',
                existingPositionProtection: {
                    planHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
                },
                strategy: { state: 'paused', revision: 2 },
                brokerWriteAuthority: false,
            },
        });
        await expect(
            controller.executeReplayProtectedStrategyMutation({
                requestId: '123e4567-e89b-42d3-a456-426614174804',
                operationKind: 'strategy_resume',
                payloadHash: `sha256:${'7'.repeat(64)}`,
                nowEpochMs: nowEpochMs + 85,
                mutation: {
                    activationPolicyAcknowledged: true,
                    contractEvidence: null,
                    controlPlaneAuthority,
                    expectedRevision: 2,
                    kind: 'resume',
                    nowEpochMs: nowEpochMs + 85,
                    strategyId: 'existing-position-trailing-vertical',
                },
            }),
        ).resolves.toMatchObject({
            state: 'completed',
            result: { state: 'monitoring', revision: 3 },
        });
        await expect(controller.listProtectiveQuoteDemands()).resolves.toEqual([
            expect.objectContaining({
                contract: {
                    code: '2330',
                    exchange: 'TSE',
                    securityType: 'STK',
                },
                quoteType: 'tick',
            }),
        ]);
        const observe = async (close, sequence, offset) => {
            const observation = issuedProtectiveQuoteObservation({
                apiGeneration,
                close,
                connectionId: 'existing-position-trailing-stream',
                eventDate: '2026-08-11',
                eventTime: `00:00:20.${String(offset * 1_000).padStart(6, '0')}`,
                nowEpochMs: nowEpochMs + offset,
                sequence,
            });
            const clock = vi.spyOn(Date, 'now').mockReturnValue(nowEpochMs + offset);
            try {
                return await controller.recordProtectiveQuoteObservation({
                    observation,
                });
            } finally {
                clock.mockRestore();
            }
        };
        await expect(observe('103', 1, 100)).resolves.toMatchObject({
            state: 'observed',
            preparedWinnerCount: 0,
            brokerWriteAuthority: false,
        });
        await expect(observe('110', 2, 110)).resolves.toMatchObject({
            state: 'observed',
            preparedWinnerCount: 0,
            brokerWriteAuthority: false,
        });
        await expect(observe('106', 3, 120)).resolves.toMatchObject({
            state: 'winner_prepared',
            preparedWinnerCount: 1,
            automaticDispatchAllowed: false,
            brokerWriteAuthority: false,
        });
        const inspection = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            inspection.prepare(`
                SELECT heads.family, heads.state, heads.saved_high_decimal,
                       heads.retracement_trigger_decimal,
                       heads.triggered_leg_id,
                       generations.winner_leg_id,
                       intents.state AS intent_state,
                       intents.adapter_authority_granted
                  FROM protection_trigger_heads AS heads
                  JOIN protection_remainder_generations AS generations
                    ON generations.protection_group_id=heads.protection_group_id
                   AND generations.remainder_generation=heads.remainder_generation
                  JOIN order_intents AS intents
                    ON intents.intent_id=generations.winner_intent_id
                 WHERE heads.protection_group_id=(
                    SELECT groups.protection_group_id
                      FROM existing_position_protection_heads AS position_heads
                      JOIN protection_groups AS groups
                        ON groups.exit_claim_id=position_heads.exit_claim_id
                     WHERE position_heads.strategy_id='existing-position-trailing-vertical'
                 )
            `).get(),
        ).toEqual({
            family: 'trailing',
            state: 'triggered',
            saved_high_decimal: '110',
            retracement_trigger_decimal: '106',
            triggered_leg_id: 'trailing-retracement',
            winner_leg_id: 'trailing-retracement',
            intent_state: 'prepared',
            adapter_authority_granted: 0,
        });
        const stored = inspection.prepare(`
            SELECT protection_plan_json, formal_protection_json
              FROM existing_position_protection_heads
             WHERE strategy_id='existing-position-trailing-vertical'
        `).get();
        expect(JSON.parse(stored.protection_plan_json)).toMatchObject({
            protection: {
                family: 'trailing',
                legs: expect.arrayContaining([
                    expect.objectContaining({
                        type: 'trailing_retracement',
                        distance: expect.objectContaining({
                            kind: 'fixed_atr',
                            atrSnapshotRevision: expect.stringMatching(/^sha256:/),
                        }),
                    }),
                ]),
            },
        });
        expect(JSON.parse(stored.formal_protection_json)).toMatchObject({
            fixedAtrSnapshotSha256: expect.stringMatching(/^sha256:/),
            legs: expect.arrayContaining([
                expect.objectContaining({
                    type: 'trailing_retracement',
                    triggerState: 'pending_saved_high',
                    triggerPrice: null,
                }),
            ]),
        });
        inspection.close();
    });

    it('projects durable kill-switch revisions and closes local dispatch on emergency', async () => {
        const appSupportRoot = await privateRoot();
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-kill-switch-1',
            nowEpochMs: 1_786_377_625_000,
            runtimeEpochId: 'runtime-epoch-kill-switch-1',
            senderFence: 'sender-fence-kill-switch-1',
        });
        openControllers.add({
            controller,
            stopAtEpochMs: 1_786_377_625_900,
        });
        await controller.markReady({ reconciliationEvidenceHash: DIGEST_A });
        expect(controller.status()).toMatchObject({
            dispatchAllowed: true,
            killSwitch: {
                arbiterRevision: 0,
                enabled: [],
                denyUnionActive: false,
            },
            killSwitchMutationPending: false,
            killSwitchMutationFailed: false,
        });
        await expect(
            controller.mutateKillSwitch({
                switchName: 'pause_new_exposure',
                enabled: true,
                expectedArbiterRevision: 0,
                reasonCode: 'operator_pause',
                nowEpochMs: 1_786_377_625_100,
            }),
        ).resolves.toMatchObject({
            arbiterRevision: 1,
            enabled: ['pause_new_exposure'],
        });
        expect(controller.dispatchAllowed).toBe(true);
        await expect(
            controller.mutateKillSwitch({
                switchName: 'pause_automation',
                enabled: true,
                expectedArbiterRevision: 0,
                reasonCode: 'automation_pause',
                nowEpochMs: 1_786_377_625_110,
            }),
        ).rejects.toMatchObject({ name: 'KillSwitchArbiterRevisionError' });
        expect(controller.status().killSwitchMutationFailed).toBe(false);
        await expect(
            controller.mutateKillSwitch({
                switchName: 'emergency_block_all_writes',
                enabled: true,
                expectedArbiterRevision: 1,
                reasonCode: 'operator_emergency',
                nowEpochMs: 1_786_377_625_120,
            }),
        ).resolves.toMatchObject({
            arbiterRevision: 2,
            enabled: [
                'pause_new_exposure',
                'emergency_block_all_writes',
            ],
        });
        expect(controller.status()).toMatchObject({
            dispatchAllowed: false,
            killSwitch: {
                arbiterRevision: 2,
                switches: {
                    pause_new_exposure: { enabled: true, revision: 1 },
                    emergency_block_all_writes: { enabled: true, revision: 2 },
                },
            },
        });
        await expect(controller.killSwitchStatus()).resolves.toMatchObject({
            arbiterRevision: 2,
            enabled: [
                'pause_new_exposure',
                'emergency_block_all_writes',
            ],
        });
        await expect(
            controller.dispatchBrokerIntent({
                intentId: 'must-remain-unsent',
                runtimeEpochId: 'runtime-epoch-kill-switch-1',
            }),
        ).rejects.toThrow('broker adapter is disabled');

        await controller.stop({ nowEpochMs: 1_786_377_625_200 });
        openControllers.clear();
        const restarted = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-kill-switch-2',
            nowEpochMs: 1_786_377_625_300,
            runtimeEpochId: 'runtime-epoch-kill-switch-2',
            senderFence: 'sender-fence-kill-switch-2',
        });
        openControllers.add({
            controller: restarted,
            stopAtEpochMs: 1_786_377_625_600,
        });
        expect(restarted.status()).toMatchObject({
            state: 'reconciling',
            dispatchAllowed: false,
            killSwitch: {
                arbiterRevision: 2,
                switches: {
                    emergency_block_all_writes: { enabled: true, revision: 2 },
                },
            },
        });
        await restarted.stop({ nowEpochMs: 1_786_377_625_500 });
        openControllers.clear();
    });

    it('binds a replay-protected kill-switch mutation to the current Runtime sender', async () => {
        const appSupportRoot = await privateRoot();
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-kill-switch-replay',
            nowEpochMs: 1_786_377_625_600,
            runtimeEpochId: 'runtime-epoch-kill-switch-replay',
            senderFence: 'sender-fence-kill-switch-replay',
        });
        openControllers.add({
            controller,
            stopAtEpochMs: 1_786_377_625_900,
        });
        await controller.markReady({ reconciliationEvidenceHash: DIGEST_A });
        const request = {
            requestId: '00000000-0000-4000-8000-000000000067',
            operationKind: 'risk_kill_switch',
            payloadHash: DIGEST_A,
            nowEpochMs: 1_786_377_625_700,
            mutation: {
                enabled: true,
                expectedArbiterRevision: 0,
                kind: 'risk_kill_switch',
                nowEpochMs: 1_786_377_625_700,
                reasonCode: 'operator_emergency',
                switchName: 'emergency_block_all_writes',
            },
        };
        const first = await controller.executeReplayProtectedStrategyMutation(
            request,
        );
        expect(first).toMatchObject({
            state: 'completed',
            replayed: false,
            result: {
                arbiterRevision: 1,
                enabled: ['emergency_block_all_writes'],
                brokerWriteAuthority: false,
            },
        });
        expect(controller.status()).toMatchObject({
            dispatchAllowed: false,
            killSwitchMutationPending: false,
            killSwitchMutationFailed: false,
            killSwitch: {
                arbiterRevision: 1,
                enabled: ['emergency_block_all_writes'],
            },
        });
        await expect(
            controller.executeReplayProtectedStrategyMutation(request),
        ).resolves.toMatchObject({
            state: 'completed',
            replayed: true,
            resultHash: first.resultHash,
        });
        await expect(
            controller.executeReplayProtectedStrategyMutation({
                ...request,
                mutation: new Proxy(request.mutation, {}),
            }),
        ).rejects.toThrow('strategy mutation kind is invalid');
    });

    it('publishes a replay-protected Runtime risk policy and synchronously closes dispatch for reconciliation', async () => {
        const appSupportRoot = await privateRoot();
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-risk-policy-1',
            nowEpochMs: 1_786_377_626_000,
            runtimeEpochId: 'runtime-epoch-risk-policy-1',
            senderFence: 'sender-fence-risk-policy-1',
        });
        openControllers.add({
            controller,
            stopAtEpochMs: 1_786_377_626_900,
        });
        await controller.markReady({ reconciliationEvidenceHash: DIGEST_A });
        await expect(controller.riskPolicy()).resolves.toMatchObject({
            state: 'missing',
            exposureHeadsCurrent: false,
            brokerWriteAuthority: false,
        });
        const policy = {
            schemaVersion:
                SMART_ORDER_RUNTIME_RISK_POLICY_EDITOR_SCHEMA_VERSION,
            buyFeeBps: 15,
            minimumBuyFeeMinorUnits: 2000,
            cashBufferMinorUnits: 10000,
            accountLimits: {
                quantityShares: 50_000,
                notionalMinorUnits: 50_000_000,
                cashMinorUnits: 55_000_000,
                positionShares: 40_000,
                orderCount: 20,
            },
            identityLimits: {
                quantityShares: 100_000,
                notionalMinorUnits: 100_000_000,
                cashMinorUnits: 110_000_000,
                positionShares: 80_000,
                orderCount: 40,
            },
            accountDailyLossLimitMinorUnits: 1_000_000,
            identityDailyLossLimitMinorUnits: 2_000_000,
        };
        const request = {
            requestId: '00000000-0000-4000-8000-000000000062',
            operationKind: 'risk_policy_publish',
            payloadHash: DIGEST_A,
            nowEpochMs: 1_786_377_626_100,
            mutation: {
                kind: 'risk_policy_publish',
                expectedRevision: null,
                policy,
                nowEpochMs: 1_786_377_626_100,
            },
        };
        const publication =
            controller.executeReplayProtectedStrategyMutation(request);
        expect(controller.dispatchAllowed).toBe(false);
        await expect(publication).resolves.toMatchObject({
            state: 'completed',
            replayed: false,
            result: {
                state: 'reconciliation_required',
                runtimeState: 'reconciling',
                dispatchAllowed: false,
                brokerWriteAuthority: false,
            },
        });
        expect(controller.status()).toMatchObject({
            state: 'reconciling',
            dispatchAllowed: false,
            riskPolicyMutationPending: false,
            riskPolicyMutationFailed: false,
        });
        await expect(
            controller.executeReplayProtectedStrategyMutation(request),
        ).resolves.toMatchObject({ state: 'completed', replayed: true });

        const accessorPolicy = { ...policy };
        Object.defineProperty(accessorPolicy, 'buyFeeBps', {
            enumerable: true,
            get: () => 15,
        });
        await expect(
            controller.executeReplayProtectedStrategyMutation({
                ...request,
                requestId: '00000000-0000-4000-8000-000000000063',
                mutation: {
                    ...request.mutation,
                    expectedRevision: 0,
                    policy: accessorPolicy,
                },
            }),
        ).rejects.toThrow(/own data property/);
    });

    it('synchronously latches a continuity gap, durably reconciles, and only clears on a new epoch', async () => {
        const appSupportRoot = await privateRoot();
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-continuity-1',
            nowEpochMs: 1_786_377_650_000,
            runtimeEpochId: 'runtime-epoch-continuity-1',
            senderFence: 'sender-fence-continuity-1',
        });
        openControllers.add({
            controller,
            stopAtEpochMs: 1_786_377_650_900,
        });
        await controller.markReady({ reconciliationEvidenceHash: DIGEST_A });
        expect(controller.dispatchAllowed).toBe(true);

        await expect(
            controller.invalidateRuntimeContinuityGap({
                ...continuityEnvelope(controller, {
                    signalSha256: DIGEST_A,
                    reasonCodes: ['EVENT_LOOP_PAUSE_GAP'],
                    nowEpochMs: 1_786_377_650_050,
                }),
                runtimeEpochIdSha256: DIGEST_B,
            }),
        ).rejects.toThrow('does not match its issued epoch envelope');
        expect(controller.dispatchAllowed).toBe(true);

        const invalidationPromise = controller.invalidateRuntimeContinuityGap(continuityEnvelope(controller, {
            signalSha256: DIGEST_A,
            reasonCodes: ['EVENT_LOOP_PAUSE_GAP', 'SSE_CURSOR_GAP'],
            nowEpochMs: 1_786_377_650_100,
        }));
        expect(controller.dispatchAllowed).toBe(false);
        expect(controller.status()).toMatchObject({
            state: 'reconciling',
            dispatchAllowed: false,
            tradingSenderAuthority: 'none',
            continuityInvalidated: true,
            continuityInvalidationReason: 'continuity_gap_invalidated',
            continuitySignalSha256: DIGEST_A,
            continuityReasonCodes: [
                'EVENT_LOOP_PAUSE_GAP',
                'SSE_CURSOR_GAP',
            ],
            continuityInvalidationDurable: false,
            reconciliationRequired: true,
            userRearmRequiredAfterReconciliation: true,
            requiresProcessRestart: false,
        });
        await expect(
            controller.markReady({ reconciliationEvidenceHash: DIGEST_A }),
        ).rejects.toMatchObject({ name: 'RuntimeContinuityInvalidatedError' });
        await expect(
            controller.dispatchBrokerIntent({ intentId: 'must-remain-unsent' }),
        ).rejects.toMatchObject({ name: 'RuntimeContinuityInvalidatedError' });
        await expect(
            controller.storeGateManifest({
                manifest: { rawCursor: 'must-never-reach-the-repository' },
                nowEpochMs: 1_786_377_650_111,
            }),
        ).rejects.toMatchObject({ name: 'RuntimeContinuityInvalidatedError' });

        const invalidated = await invalidationPromise;
        expect(invalidated).toEqual({
            schemaVersion: SMART_ORDER_RUNTIME_GAP_INVALIDATION_SCHEMA_VERSION,
            runtimeEpochIdSha256: controller.runtimeEpochIdSha256,
            state: 'reconciling',
            previousState: 'ready',
            revision: 2,
            reason: 'continuity_gap_invalidated',
            continuitySignalSha256: DIGEST_A,
            reasonCodes: ['EVENT_LOOP_PAUSE_GAP', 'SSE_CURSOR_GAP'],
            recoveryStrategyCount: 0,
            supersededRearmCount: 0,
            recoveredIntentCount: 0,
            invalidatedGateManifestCount: 0,
            manualInterventionStrategyCount: 0,
            automaticRedispatchAllowed: false,
            userRearmRequiredAfterReconciliation: true,
            requiresProcessRestart: false,
            dispatchAllowed: false,
        });
        await expect(
            controller.quiesce({
                operation: 'graceful_stop',
                nowEpochMs: 1_786_377_650_110,
            }),
        ).resolves.toMatchObject({
            operation: 'graceful_stop',
            state: 'quiescing',
            drainAllowed: true,
            selectedBlockerCount: 0,
            dispatchAllowed: false,
        });
        expect(controller.status()).toMatchObject({
            state: 'quiescing',
            continuityInvalidated: true,
            continuityInvalidationDurable: true,
            dispatchAllowed: false,
            requiresProcessRestart: false,
        });
        expect(JSON.stringify(controller.status())).not.toContain(
            'must-never-reach-the-repository',
        );
        await expect(
            controller.invalidateRuntimeContinuityGap(continuityEnvelope(controller, {
                signalSha256: DIGEST_A,
                reasonCodes: ['EVENT_LOOP_PAUSE_GAP', 'SSE_CURSOR_GAP'],
                nowEpochMs: 1_786_377_650_200,
            })),
        ).resolves.toEqual(invalidated);
        await expect(
            controller.invalidateRuntimeContinuityGap(continuityEnvelope(controller, {
                signalSha256: DIGEST_B,
                reasonCodes: ['EVENT_LOOP_PAUSE_GAP', 'SSE_CURSOR_GAP'],
                nowEpochMs: 1_786_377_650_201,
            })),
        ).rejects.toMatchObject({ name: 'RuntimeContinuityInvalidatedError' });
        await expect(
            controller.invalidateRuntimeContinuityGap(continuityEnvelope(controller, {
                signalSha256: DIGEST_A,
                reasonCodes: ['API_GENERATION_GAP'],
                nowEpochMs: 1_786_377_650_202,
            })),
        ).rejects.toThrow('sorted unique allowlisted codes');

        await controller.stop({ nowEpochMs: 1_786_377_650_300 });
        openControllers.clear();
        const replacement = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-continuity-2',
            nowEpochMs: 1_786_377_650_400,
            runtimeEpochId: 'runtime-epoch-continuity-2',
            senderFence: 'sender-fence-continuity-2',
        });
        openControllers.add({
            controller: replacement,
            stopAtEpochMs: 1_786_377_650_600,
        });
        expect(replacement.status()).toMatchObject({
            role: 'primary',
            state: 'reconciling',
            continuityInvalidated: false,
            continuityInvalidationDurable: false,
            dispatchAllowed: false,
        });
        await replacement.stop({ nowEpochMs: 1_786_377_650_500 });
        openControllers.clear();
    });

    it('durably sends a monitoring trailing strategy to manual intervention through the production gap path', async () => {
        const appSupportRoot = await privateRoot();
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-trailing-gap-1',
            nowEpochMs: 1_786_377_660_000,
            runtimeEpochId: 'runtime-epoch-trailing-gap-1',
            senderFence: 'sender-fence-trailing-gap-1',
        });
        openControllers.add({
            controller,
            stopAtEpochMs: 1_786_377_660_900,
        });
        const databasePath = path.join(
            appSupportRoot,
            'smart-order',
            'database',
            'smart-orders.sqlite3',
        );
        const seed = new DatabaseSync(databasePath);
        seed.prepare(`
            INSERT INTO strategies(
                strategy_id, strategy_kind, state, definition_hash,
                definition_json, account_broker_ref, account_id_ref,
                identity_group_id, confirmation_snapshot_hash,
                created_at_epoch_ms, updated_at_epoch_ms, terminal_at_epoch_ms,
                revision
            ) VALUES (?, 'trailing_exit', 'monitoring', ?, ?, 'broker-A',
                      'account-A', 'identity-A', ?, ?, ?, NULL, 0)
        `).run(
            'strategy-production-trailing-gap',
            DIGEST_A,
            JSON.stringify({
                schemaVersion: 'strategy/1',
                kind: 'trailing_exit',
            }),
            DIGEST_B,
            1_786_377_660_010,
            1_786_377_660_010,
        );
        seed.close();
        await controller.markReady({ reconciliationEvidenceHash: DIGEST_A });

        await expect(
            controller.invalidateRuntimeContinuityGap(
                continuityEnvelope(controller, {
                    signalSha256: DIGEST_A,
                    reasonCodes: ['SSE_STREAM_BASELINE_MISSING'],
                    nowEpochMs: 1_786_377_660_100,
                }),
            ),
        ).resolves.toMatchObject({
            state: 'reconciling',
            recoveryStrategyCount: 0,
            manualInterventionStrategyCount: 1,
            dispatchAllowed: false,
            automaticRedispatchAllowed: false,
        });

        const inspection = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            inspection
                .prepare(`
                    SELECT state, revision FROM strategies
                     WHERE strategy_id='strategy-production-trailing-gap'
                `)
                .get(),
        ).toEqual({ state: 'manual_intervention', revision: 1 });
        expect(
            inspection
                .prepare(`
                    SELECT reason_code, entity_revision, payload_hash
                      FROM event_journal
                     WHERE entity_id='strategy-production-trailing-gap'
                       AND reason_code='TRAILING_GAP_EXTREME_UNKNOWN'
                `)
                .get(),
        ).toEqual({
            reason_code: 'TRAILING_GAP_EXTREME_UNKNOWN',
            entity_revision: 1,
            payload_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        });
        inspection.close();

        await controller.closeForGenerationFailover({
            observedApiGeneration: 'api-generation-trailing-gap-2',
            nowEpochMs: 1_786_377_660_200,
        });
        openControllers.clear();
    });

    it('keeps the continuity latch closed when durable invalidation fails', async () => {
        const appSupportRoot = await privateRoot();
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-continuity-failure-1',
            nowEpochMs: 1_786_377_675_000,
            runtimeEpochId: 'runtime-epoch-continuity-failure-1',
            senderFence: 'sender-fence-continuity-failure-1',
        });
        openControllers.add({
            controller,
            stopAtEpochMs: 1_786_377_675_900,
        });
        await controller.markReady({ reconciliationEvidenceHash: DIGEST_A });

        const databasePath = path.join(
            appSupportRoot,
            'smart-order',
            'database',
            'smart-orders.sqlite3',
        );
        const tamper = new DatabaseSync(databasePath);
        tamper
            .prepare(`
                UPDATE repository_meta SET value='externally-invalidated-fence'
                 WHERE key='current_sender_fence'
            `)
            .run();
        tamper.close();

        const failed = controller.invalidateRuntimeContinuityGap(continuityEnvelope(controller, {
            signalSha256: DIGEST_A,
            reasonCodes: ['EVENT_LOOP_PAUSE_GAP'],
            nowEpochMs: 1_786_377_675_100,
        }));
        expect(controller.dispatchAllowed).toBe(false);
        await expect(failed).rejects.toThrow(
            'does not target the current runtime fence',
        );
        expect(controller.status()).toMatchObject({
            state: 'reconciling',
            dispatchAllowed: false,
            continuityInvalidated: true,
            continuityInvalidationDurable: false,
            reconciliationRequired: true,
            requiresProcessRestart: false,
        });
        await expect(
            controller.dispatchBrokerIntent({ intentId: 'must-remain-unsent' }),
        ).rejects.toMatchObject({ name: 'RuntimeContinuityInvalidatedError' });

        await expect(
            controller.closeForGenerationFailover({
                observedApiGeneration: 'api-generation-continuity-failure-2',
                nowEpochMs: 1_786_377_675_200,
            }),
        ).rejects.toThrow('does not target the current runtime fence');
        expect(controller.status()).toMatchObject({
            state: 'closed',
            repositoryOpened: false,
            dispatchAllowed: false,
            continuityInvalidated: true,
        });
        openControllers.clear();
    });

    it('latches a changed API generation, rejects readiness and dispatch, then releases the lease without terminal stop', async () => {
        const appSupportRoot = await privateRoot();
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-1',
            nowEpochMs: 1_786_377_600_000,
            runtimeEpochId: 'runtime-epoch-generation-1',
            senderFence: 'sender-fence-generation-1',
        });
        openControllers.add({
            controller,
            stopAtEpochMs: 1_786_377_600_900,
        });
        const generationDatabasePath = path.join(
            appSupportRoot,
            'smart-order',
            'database',
            'smart-orders.sqlite3',
        );
        const generationSeed = new DatabaseSync(generationDatabasePath);
        generationSeed.prepare(`
            INSERT INTO strategies(
                strategy_id, strategy_kind, state, definition_hash,
                definition_json, account_broker_ref, account_id_ref,
                identity_group_id, confirmation_snapshot_hash,
                created_at_epoch_ms, updated_at_epoch_ms, terminal_at_epoch_ms,
                revision
            ) VALUES (?, 'trailing_exit', 'monitoring', ?, ?, 'broker-A',
                      'account-A', 'identity-A', ?, ?, ?, NULL, 0)
        `).run(
            'strategy-production-generation-gap',
            DIGEST_A,
            JSON.stringify({
                schemaVersion: 'strategy/1',
                kind: 'trailing_exit',
            }),
            DIGEST_B,
            1_786_377_600_010,
            1_786_377_600_010,
        );
        generationSeed.close();
        await controller.markReady({ reconciliationEvidenceHash: DIGEST_A });
        expect(controller.dispatchAllowed).toBe(true);

        const observedApiGenerationSha256 = `sha256:${createHash('sha256')
            .update('api-generation-2')
            .digest('hex')}`;
        await expect(
            controller.invalidateApiGeneration({
                observedApiGeneration: 'api-generation-2',
                nowEpochMs: 1_786_377_600_100,
            }),
        ).resolves.toMatchObject({
            state: 'reconciling',
            previousState: 'ready',
            reason: 'generation_invalidated',
            observedApiGenerationSha256,
            dispatchAllowed: false,
            automaticRedispatchAllowed: false,
            requiresProcessRestart: true,
        });
        expect(controller.dispatchAllowed).toBe(false);
        expect(controller.status()).toMatchObject({
            state: 'reconciling',
            dispatchAllowed: false,
            tradingSenderAuthority: 'none',
            generationInvalidated: true,
            generationInvalidationReason: 'generation_invalidated',
            observedApiGenerationSha256,
            requiresProcessRestart: true,
        });
        expect(JSON.stringify(controller.status())).not.toContain(
            'api-generation-2',
        );
        const generationInspection = new DatabaseSync(generationDatabasePath, {
            readOnly: true,
        });
        expect(
            generationInspection
                .prepare(`
                    SELECT state, revision FROM strategies
                     WHERE strategy_id='strategy-production-generation-gap'
                `)
                .get(),
        ).toEqual({ state: 'manual_intervention', revision: 1 });
        generationInspection.close();
        await expect(
            controller.markReady({ reconciliationEvidenceHash: DIGEST_A }),
        ).rejects.toMatchObject({ name: 'RuntimeGenerationInvalidatedError' });
        await expect(
            controller.dispatchBrokerIntent({
                intentId: 'must-remain-unsent-after-generation-change',
                runtimeEpochId: 'runtime-epoch-generation-1',
            }),
        ).rejects.toMatchObject({ name: 'RuntimeGenerationInvalidatedError' });
        await expect(
            controller.stop({ nowEpochMs: 1_786_377_600_150 }),
        ).rejects.toMatchObject({ name: 'RuntimeGenerationInvalidatedError' });

        await expect(
            controller.closeForGenerationFailover({
                observedApiGeneration: 'api-generation-2',
                nowEpochMs: 1_786_377_600_200,
            }),
        ).resolves.toEqual({
            state: 'closed',
            repositoryState: 'reconciling',
            reason: 'generation_invalidated',
            observedApiGenerationSha256,
            dispatchAllowed: false,
            requiresProcessRestart: true,
        });
        expect(controller.status()).toMatchObject({
            state: 'closed',
            repositoryOpened: false,
            dispatchAllowed: false,
            generationInvalidated: true,
        });
        openControllers.clear();

        const replacement = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-2',
            nowEpochMs: 1_786_377_600_300,
            runtimeEpochId: 'runtime-epoch-generation-2',
            senderFence: 'sender-fence-generation-2',
        });
        openControllers.add({
            controller: replacement,
            stopAtEpochMs: 1_786_377_600_500,
        });
        expect(replacement.status()).toMatchObject({
            role: 'primary',
            state: 'reconciling',
            generationInvalidated: false,
            dispatchAllowed: false,
        });
        await replacement.closeForGenerationFailover({
            observedApiGeneration: 'api-generation-3',
            nowEpochMs: 1_786_377_600_400,
        });
        openControllers.clear();

        const database = new DatabaseSync(
            path.join(
                appSupportRoot,
                'smart-order',
                'database',
                'smart-orders.sqlite3',
            ),
            { readOnly: true },
        );
        expect(
            database
                .prepare(`
                    SELECT runtime_epoch_id, state
                      FROM runtime_epochs
                     WHERE runtime_epoch_id LIKE 'runtime-epoch-generation-%'
                     ORDER BY started_at_epoch_ms
                `)
                .all(),
        ).toEqual([
            {
                runtime_epoch_id: 'runtime-epoch-generation-1',
                state: 'reconciling',
            },
            {
                runtime_epoch_id: 'runtime-epoch-generation-2',
                state: 'reconciling',
            },
        ]);
        database.close();
    });

    it('releases the failover lease even when durable generation invalidation fails', async () => {
        const appSupportRoot = await privateRoot();
        const controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-failure-1',
            nowEpochMs: 1_786_377_700_000,
            runtimeEpochId: 'runtime-epoch-failure-1',
            senderFence: 'sender-fence-failure-1',
        });
        openControllers.add({
            controller,
            stopAtEpochMs: 1_786_377_700_900,
        });
        await controller.markReady({ reconciliationEvidenceHash: DIGEST_A });
        expect(controller.dispatchAllowed).toBe(true);

        const databasePath = path.join(
            appSupportRoot,
            'smart-order',
            'database',
            'smart-orders.sqlite3',
        );
        const tamper = new DatabaseSync(databasePath);
        tamper
            .prepare(`
                UPDATE repository_meta SET value='externally-invalidated-fence'
                 WHERE key='current_sender_fence'
            `)
            .run();
        tamper.close();

        await expect(
            controller.closeForGenerationFailover({
                observedApiGeneration: 'api-generation-failure-2',
                nowEpochMs: 1_786_377_700_100,
            }),
        ).rejects.toThrow('does not target the current runtime fence');
        expect(controller.status()).toMatchObject({
            state: 'closed',
            repositoryOpened: false,
            dispatchAllowed: false,
            tradingSenderAuthority: 'none',
            generationInvalidated: true,
            requiresProcessRestart: true,
        });
        openControllers.clear();

        const replacement = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration: 'api-generation-failure-2',
            nowEpochMs: 1_786_377_700_200,
            runtimeEpochId: 'runtime-epoch-failure-2',
            senderFence: 'sender-fence-failure-2',
        });
        openControllers.add({
            controller: replacement,
            stopAtEpochMs: 1_786_377_700_400,
        });
        expect(replacement.status()).toMatchObject({
            role: 'primary',
            state: 'reconciling',
            dispatchAllowed: false,
        });
        await replacement.stop({ nowEpochMs: 1_786_377_700_300 });
        openControllers.clear();
    });
});
