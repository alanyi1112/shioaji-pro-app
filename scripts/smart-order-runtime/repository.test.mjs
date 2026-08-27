import {
    chmod,
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    stat,
    symlink,
    unlink,
    writeFile,
} from 'node:fs/promises';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
    SmartOrderRepositoryClient,
    openSmartOrderRepository,
} from './repository-client.mjs';
import {
    REQUIRED_SMART_ORDER_TABLES,
    SMART_ORDER_REPOSITORY_SCHEMA_ID,
    SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
    SMART_ORDER_SCHEMA_V6_TO_V7_SQL,
    SMART_ORDER_SCHEMA_SQL,
    SMART_ORDER_STRATEGY_STATES,
} from './repository-schema.mjs';
import {
    prepareSmartOrderPrivateStorage,
    SMART_ORDER_REPOSITORY_EXPECTATION_SCHEMA_VERSION,
} from './private-storage.mjs';
import {
    SMART_ORDER_FEATURE_GATE_IDS,
    SMART_ORDER_GATE_MANIFEST_SCHEMA_VERSION,
    createSmartOrderGateManifest,
} from './gate-manifest.mjs';
import {
    canonicalSmartOrderDraft,
    canonicalSmartOrderDraftKinds,
} from './canonical-strategy-draft-fixtures.mjs';
import { canonicalDraftSharedView } from '../../src/lib/smart-order-panel-model.ts';
import { canonicalJson } from './canonical-json.mjs';
import {
    SMART_ORDER_PROTECTED_ENTRY_INTENT_SCHEMA_VERSION,
    SMART_ORDER_PROTECTED_ENTRY_PLAN_SCHEMA_VERSION,
    SMART_ORDER_PROTECTED_ENTRY_RISK_POLICY_SCHEMA_VERSION,
    canonicalProtectedEntryIntentPayload,
    canonicalProtectedEntryPlan,
    deriveProtectedEntryFormalProtection,
} from './protected-entry-contract.mjs';
import {
    SMART_ORDER_BROKER_EVENT_CANDIDATE_SCHEMA_VERSION,
    normalizeCanonicalSmartOrderBrokerEvent,
} from './broker-event-normalizer.mjs';
import {
    SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
    SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
} from './canonical-pnl-policy.mjs';
import {
    SMART_ORDER_RUNTIME_RISK_POLICY_EDITOR_SCHEMA_VERSION,
} from './runtime-risk-policy.mjs';
import {
    SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
    smartOrderGateProbeAccountScopeSha256,
} from './gate-probe-safety-envelope.mjs';
import { buildSmartOrderProtectiveBrokerIntentPayload } from './broker-execution-policy.mjs';
import {
    SMART_ORDER_EXISTING_POSITION_PROTECTION_PLAN_SCHEMA_VERSION,
    canonicalExistingPositionProtectionPlan,
    deriveExistingPositionFormalProtection,
} from './existing-position-protection-contract.mjs';
import {
    SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
    SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
} from './quick-field-mapping.mjs';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const CANONICAL_INTENT_PAYLOAD = { price: '100.00', quantity: '1' };
const INTENT_PAYLOAD_DIGEST = `sha256:${createHash('sha256')
    .update(JSON.stringify(CANONICAL_INTENT_PAYLOAD))
    .digest('hex')}`;
const DIFFERENT_INTENT_PAYLOAD = { price: '101.00', quantity: '1' };
const DIFFERENT_INTENT_PAYLOAD_DIGEST = `sha256:${createHash('sha256')
    .update(JSON.stringify(DIFFERENT_INTENT_PAYLOAD))
    .digest('hex')}`;

function durableCommonLotPlaceProjection({
    contractUnit = 1_000,
    quantityShares = contractUnit,
} = {}) {
    if (quantityShares % contractUnit !== 0) {
        throw new Error('durable CommonLot test projection must be exact');
    }
    const payload = {
        commonLots: quantityShares / contractUnit,
        contractKey: 'TSE:2330:STK:Common',
        contractUnit,
        quantityShares,
        schemaVersion: 'smart-order-durable-stock-order-unit/2026-08-22.1',
    };
    const payloadJson = canonicalJson(payload);
    return Object.freeze({
        payload: Object.freeze(payload),
        payloadSha256: `sha256:${createHash('sha256')
            .update(payloadJson)
            .digest('hex')}`,
    });
}

function seedDurableOriginatingIntentUnit(
    databasePath,
    intentId,
    { contractUnit = 1_000, quantityShares = contractUnit } = {},
) {
    const projection = durableCommonLotPlaceProjection({
        contractUnit,
        quantityShares,
    });
    const database = new DatabaseSync(databasePath);
    const updated = database.prepare(`
        UPDATE order_intents
           SET payload_hash=?, payload_json=?
         WHERE intent_id=?
    `).run(
        projection.payloadSha256,
        canonicalJson(projection.payload),
        intentId,
    );
    database.close();
    if (Number(updated.changes) !== 1) {
        throw new Error('durable originating intent fixture was not updated');
    }
}
const PROTECTIVE_INTENT_PROJECTION =
    buildSmartOrderProtectiveBrokerIntentPayload({
        legId: 'stop-leg',
        protectionPlan: protectedEntryProjection().payload.protectionPlan,
        quantityShares: 1_000,
        triggerPolicyHash: DIGEST_B,
    });
const PROTECTIVE_INTENT_PAYLOAD = PROTECTIVE_INTENT_PROJECTION.payload;
const PROTECTIVE_INTENT_PAYLOAD_DIGEST =
    PROTECTIVE_INTENT_PROJECTION.payloadSha256;
const VISIBILITY_PROTECTION_GROUP_ID = `protection-group:${createHash('sha256')
    .update(canonicalJson('visibility-internal-claim'))
    .digest('hex')}`;
function protectionGroupIdForTestClaim(exitClaimId) {
    return `protection-group:${createHash('sha256')
        .update(canonicalJson(exitClaimId))
        .digest('hex')}`;
}
function existingPositionPlanForVisibility({ contractUnit = 500 } = {}) {
    return canonicalExistingPositionProtectionPlan({
        schemaVersion:
            SMART_ORDER_EXISTING_POSITION_PROTECTION_PLAN_SCHEMA_VERSION,
        accountBrokerRef: 'broker-A',
        accountIdRef: 'account-A',
        basis: { source: 'broker_average_cost', priceDecimal: '100' },
        confirmationSnapshotHash: DIGEST_B,
        contractKey: 'TSE:2330:STK:Common',
        contractPricePolicy: {
            categoryCode: '24',
            limitDownMinorUnits: 9_000,
            limitUpMinorUnits: 11_000,
        },
        contractUnit,
        position: {
            accountHeadRevision: 1,
            availableShares: 1_000,
            evidenceHash: DIGEST_B,
            lineageId: 'visibility-position-lineage',
            quantityShares: 1_000,
        },
        protection: {
            family: 'fixed',
            legs: [
                {
                    comparator: 'lte',
                    distance: { kind: 'pct_bps', pctBps: 500 },
                    execution: {
                        limitPrice: '95',
                        priceType: 'LMT',
                        timeInForce: 'ROD',
                    },
                    legId: 'stop-leg',
                    type: 'stop',
                },
                {
                    comparator: 'gte',
                    distance: { kind: 'pct_bps', pctBps: 500 },
                    execution: {
                        limitPrice: '105',
                        priceType: 'LMT',
                        timeInForce: 'IOC',
                    },
                    legId: 'take-leg',
                    type: 'take',
                },
            ],
        },
        riskRevision: 'risk-policy/1',
        tradeDate: '2026-08-11',
    });
}
const MANUAL_CANCEL_INTENT_PAYLOAD = {
    brokerOrderId: 'broker-order-manual-cancel',
    controlRevision: 0,
    schemaVersion: 'smart-order-manual-cancel-intent/2026-08-12.1',
};
const MANUAL_CANCEL_INTENT_PAYLOAD_DIGEST = `sha256:${createHash('sha256')
    .update(JSON.stringify(MANUAL_CANCEL_INTENT_PAYLOAD))
    .digest('hex')}`;
const temporaryRoots = [];
const openClients = new Set();
const TEST_EXPOSURE_OBSERVED_AT_EPOCH_MS = 1_786_377_599_000;
const TEST_EXPOSURE_NOW_EPOCH_MS = TEST_EXPOSURE_OBSERVED_AT_EPOCH_MS + 1_000;
const TEST_VISIBILITY_OBSERVED_AT_EPOCH_MS = TEST_EXPOSURE_OBSERVED_AT_EPOCH_MS;
const DROP_V15_TABLES_SQL = `
    DROP TABLE protection_leg_evaluations;
    DROP TABLE protection_remainder_generations;
    DROP TABLE protection_groups;
`;
const DROP_V9_TABLES_SQL = `
    ${DROP_V15_TABLES_SQL}
    DROP TABLE canonical_pnl_identity_heads;
    DROP TABLE canonical_pnl_account_heads;
    DROP TABLE canonical_pnl_deals;
    DROP TABLE relinquished_unknown_exposures;
    DROP TABLE protected_entry_fill_heads;
    DROP TABLE account_reconciliation_heads;
    DROP TABLE broker_event_heads;
    DROP TABLE broker_event_records;
`;

function protectedEntryProjection({
    baseShares = 1_000,
    contractUnit = 1_000,
    protectionFamily = 'fixed',
    protectionLegs,
} = {}) {
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
        modeRevision: 'simulation-generation/1',
        riskRevision: 'risk-policy/1',
        riskPolicy: {
            schemaVersion:
                SMART_ORDER_PROTECTED_ENTRY_RISK_POLICY_SCHEMA_VERSION,
            policyRevision: 'risk-policy/1',
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
            baseShares,
            commonLots: baseShares / contractUnit,
            contractUnit,
            priceType: 'LMT',
            timeInForce: 'ROD',
            limitPrice: '100',
        },
        fixedAtrSnapshot: null,
        protection: {
            family: protectionFamily,
            legs:
                protectionLegs ??
                [
                    {
                        legId: 'stop-leg',
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
    const payload = {
        schemaVersion: SMART_ORDER_PROTECTED_ENTRY_INTENT_SCHEMA_VERSION,
        confirmationSnapshotHash: DIGEST_B,
        entryOrder: plan.entryOrder,
        protectionPlan: plan,
        protectionPlanSha256: canonicalPlan.planSha256,
    };
    return canonicalProtectedEntryIntentPayload(payload);
}

function protectiveBrokerIntentProjection({
    legId = 'stop-leg',
    quantityShares = 1_000,
    triggerPolicyHash = DIGEST_B,
    protectionPlan = protectedEntryProjection().payload.protectionPlan,
} = {}) {
    return buildSmartOrderProtectiveBrokerIntentPayload({
        legId,
        protectionPlan,
        quantityShares,
        triggerPolicyHash,
    });
}

function protectedEntryBrokerEvent({
    apiGeneration = 'simulation-generation/1',
    eventKind = 'order',
    status = 'Submitted',
    cumulativeDeal = 0,
    cumulativeCancel = 0,
    remaining = 1_000,
    eventDeal = 0,
    dealId = null,
    exchangeSequence = null,
    exchangeEpochMs = 1_786_377_600_300,
    price = '100',
    tradeId = 'protected-entry-trade-1',
    orderId = 'protected-entry-order-1',
    seqno = 'protected-entry-seq-1',
    ordno = 'protected-entry-ord-1',
    customField = 'PE0001',
} = {}) {
    return normalizeCanonicalSmartOrderBrokerEvent({
        schemaVersion: SMART_ORDER_BROKER_EVENT_CANDIDATE_SCHEMA_VERSION,
        mappingRevision: 'gate-0-correlation-mapping/fixture-1',
        apiGeneration,
        eventKind,
        account: {
            brokerId: 'broker-A',
            accountId: 'account-A',
            accountType: 'S',
        },
        tradeDate: '2026-08-11',
        contractKey: 'TSE:2330:STK:Common',
        side: 'Buy',
        identifiers: {
            tradeId,
            orderId: eventKind === 'order' ? orderId : null,
            dealId,
            seqno,
            ordno,
            exchangeSequence,
            customField,
        },
        operation:
            eventKind === 'order'
                ? { type: 'New', code: '00', message: null }
                : { type: null, code: null, message: null },
        status,
        orderClass: {
            orderCondition: 'Cash',
            orderLot: 'Common',
            priceType: 'LMT',
            timeInForce: 'ROD',
        },
        quantities: {
            order: 1_000,
            cumulativeDeal,
            cumulativeCancel,
            remaining,
            eventDeal,
            unit: 'Share',
        },
        price,
        timestamps: {
            exchangeEpochMs,
            brokerEpochMs: exchangeEpochMs + 1,
            receiveEpochMs: exchangeEpochMs + 2,
        },
    });
}

function protectiveExitBrokerEvent({
    order = 1,
    status = 'Submitted',
    cumulativeDeal = 0,
    cumulativeCancel = 0,
    remaining = order,
    eventKind = 'order',
    eventDeal = 0,
    dealId = null,
    exchangeSequence = null,
    exchangeEpochMs = 1_786_377_600_500,
    price = null,
    quantityUnit = 'CommonLot',
} = {}) {
    return normalizeCanonicalSmartOrderBrokerEvent({
        schemaVersion: SMART_ORDER_BROKER_EVENT_CANDIDATE_SCHEMA_VERSION,
        mappingRevision: 'gate-0-correlation-mapping/fixture-1',
        apiGeneration: 'api-generation-1',
        eventKind,
        account: {
            brokerId: 'broker-A',
            accountId: 'account-A',
            accountType: 'S',
        },
        tradeDate: '2026-08-11',
        contractKey: 'TSE:2330:STK:Common',
        side: 'Sell',
        identifiers: {
            tradeId: 'protective-exit-trade-1',
            orderId:
                eventKind === 'order' ? 'protective-exit-order-1' : null,
            dealId,
            seqno: 'protective-exit-seq-1',
            ordno: 'protective-exit-ord-1',
            exchangeSequence,
            customField: 'PX0001',
        },
        operation:
            eventKind === 'order'
                ? { type: 'New', code: '00', message: null }
                : { type: null, code: null, message: null },
        status,
        orderClass: {
            orderCondition: 'Cash',
            orderLot: 'Common',
            priceType: 'MKT',
            timeInForce: 'IOC',
        },
        quantities: {
            order,
            cumulativeDeal,
            cumulativeCancel,
            remaining,
            eventDeal,
            unit: quantityUnit,
        },
        price,
        timestamps: {
            exchangeEpochMs,
            brokerEpochMs: exchangeEpochMs + 1,
            receiveEpochMs: exchangeEpochMs + 2,
        },
    });
}

function seedBrokerCorrelation(database, events, {
    correlationId = 'correlation-protected-entry-event',
    identifierKinds = [
        'tradeId',
        'orderId',
        'dealId',
        'seqno',
        'ordno',
        'exchangeSequence',
    ],
    intentId = 'intent-1',
} = {}) {
    const eventList = Array.isArray(events) ? events : [events];
    if (eventList.length === 0) throw new TypeError('event list is empty');
    const first = eventList[0];
    const identifiers = {};
    for (const event of eventList) {
        expect(event.account).toEqual(first.account);
        expect(event.tradeDate).toBe(first.tradeDate);
        expect(event.contractKey).toBe(first.contractKey);
        expect(event.side).toBe(first.side);
        for (const kind of identifierKinds) {
            const value = event.identifiers[kind];
            if (value === null) continue;
            if (identifiers[kind] !== undefined && identifiers[kind] !== value) {
                throw new Error(`test correlation ${kind} changed lineage`);
            }
            identifiers[kind] = value;
        }
    }
    const canonicalKeyHash = `sha256:${createHash('sha256')
        .update([
            first.account.brokerId,
            first.account.accountId,
            first.tradeDate,
            first.contractKey,
            first.side,
            identifiers.tradeId ?? '',
            identifiers.orderId ?? '',
            identifiers.dealId ?? '',
            identifiers.seqno ?? '',
            identifiers.ordno ?? '',
            identifiers.exchangeSequence ?? '',
        ].join('\u001f'))
        .digest('hex')}`;
    database.prepare(`
        INSERT INTO broker_correlations(
            correlation_id, intent_id, broker_order_id, canonical_key_hash,
            account_broker_ref, account_id_ref, trade_date, contract_key,
            side, trade_id, order_id, deal_id, seqno, ordno,
            exchange_sequence, custom_field, evidence_hash,
            created_at_epoch_ms, revision
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
        correlationId,
        intentId,
        canonicalKeyHash,
        first.account.brokerId,
        first.account.accountId,
        first.tradeDate,
        first.contractKey,
        first.side,
        identifiers.tradeId ?? null,
        identifiers.orderId ?? null,
        identifiers.dealId ?? null,
        identifiers.seqno ?? null,
        identifiers.ordno ?? null,
        identifiers.exchangeSequence ?? null,
        first.identifiers.customField || null,
        DIGEST_A,
        1_786_377_600_250,
    );
    const insertIdentifier = database.prepare(`
        INSERT INTO broker_correlation_identifiers(
            account_broker_ref, account_id_ref, trade_date, contract_key,
            side, identifier_kind, identifier_value, intent_id,
            correlation_id, created_at_epoch_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [kind, value] of Object.entries(identifiers)) {
        insertIdentifier.run(
            first.account.brokerId,
            first.account.accountId,
            first.tradeDate,
            first.contractKey,
            first.side,
            kind,
            value,
            intentId,
            correlationId,
            1_786_377_600_250,
        );
    }
}

function protectedEntryReconciliation({
    asOfEpochMs = 1_786_377_600_500,
    dealIds = ['protected-entry-deal-1'],
    quantityShares = 1_000,
    availableShares = quantityShares,
    feeMinorUnits = 0,
    realizedMinorUnits = 0,
    snapshotSha256 = DIGEST_A,
    transactionTaxMinorUnits = 0,
    unrealizedMinorUnits = 0,
    workingOrders = [],
    positionLineageId = 'position-lineage-1',
} = {}) {
    return {
        schemaVersion:
            'smart-order-account-reconciliation-projection/2026-08-13.2',
        account: {
            brokerId: 'broker-A',
            accountId: 'account-A',
            accountType: 'S',
        },
        tradeDate: '2026-08-11',
        asOfEpochMs,
        sourceRevision: `source-${asOfEpochMs}`,
        sourceSnapshotSha256: DIGEST_B,
        snapshotSha256,
        evidenceSha256: DIGEST_B,
        eventStreamWatermarkSha256: DIGEST_A,
        deals: dealIds.map((dealId) => ({
            dealId,
            feeMinorUnits,
            realizedMinorUnits,
            transactionTaxMinorUnits,
        })),
        pnlPolicyDefinitionSha256:
            SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
        pnlPolicyRevision: SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
        positions: [
            {
                averagePriceMinorUnits: 10_000,
                contractKey: 'TSE:2330:STK:Common',
                lastPriceMinorUnits: 10_100,
                positionLineageId,
                quantityShares,
                availableShares,
                unrealizedMinorUnits,
                yesterdayQuantityShares: quantityShares,
            },
        ],
        workingOrders,
        coverageComplete: true,
    };
}

function completeAccountReconciliationProjection({
    accountBrokerRef = 'broker-A',
    accountIdRef = 'account-A',
    asOfEpochMs = 1_786_377_600_700,
    candidates = [],
    quantityShares = 1_000,
    availableShares = quantityShares,
    runtimeWorkingOrders = [],
    dealIds = ['full-day-deal-1'],
    positionLineageId = 'position-lineage-1',
} = {}) {
    const accountScopeSha256 = `sha256:${createHash('sha256')
        .update(
            `smart-order-reconciliation-account\u001f${canonicalJson([
                accountBrokerRef,
                accountIdRef,
                'S',
            ])}`,
        )
        .digest('hex')}`;
    return {
        ...protectedEntryReconciliation({
            asOfEpochMs,
            dealIds,
            feeMinorUnits: 10,
            realizedMinorUnits: -500,
            transactionTaxMinorUnits: 20,
            unrealizedMinorUnits: 100,
            quantityShares,
            availableShares,
            positionLineageId,
            workingOrders: [
                ...candidates.map((candidate) => ({
                    brokerOrderId: candidate.brokerOrderId,
                    contractKey: candidate.contractKey,
                    filledShares: 0,
                    origin: 'external',
                    quantityShares: candidate.quantityShares,
                    remainingShares: candidate.quantityShares,
                    side: 'Sell',
                    state: 'Submitted',
                })),
                ...runtimeWorkingOrders,
            ],
        }),
        account: {
            brokerId: accountBrokerRef,
            accountId: accountIdRef,
            accountType: 'S',
        },
        sourceRevision: `source-${accountBrokerRef}-${accountIdRef}-${asOfEpochMs}`,
        reconciliationGeneration: 1,
        fullDayTotals: {
            realizedMinorUnits: -500,
            unrealizedMinorUnits: 100,
            feeMinorUnits: 10,
            transactionTaxMinorUnits: 20,
            netMinorUnits: -430,
        },
        externalSellClaimCandidates: candidates.map((candidate) => ({
            accountScopeSha256,
            brokerOrderId: candidate.brokerOrderId,
            candidateId: candidate.candidateId,
            contractKey: candidate.contractKey,
            evidenceSha256: DIGEST_B,
            positionLineageId:
                candidate.positionLineageId ?? positionLineageId,
            quantityShares: candidate.quantityShares,
            repositoryMutationAuthority: false,
            state: 'broker_working',
        })),
    };
}

function externalSellCandidateId({
    accountBrokerRef = 'broker-A',
    accountIdRef = 'account-A',
    brokerOrderId,
    contractKey,
    tradeDate = '2026-08-11',
}) {
    const accountScopeSha256 = `sha256:${createHash('sha256')
        .update(
            `smart-order-reconciliation-account\u001f${canonicalJson([
                accountBrokerRef,
                accountIdRef,
                'S',
            ])}`,
        )
        .digest('hex')}`;
    return `external-sell-claim:${createHash('sha256')
        .update(
            canonicalJson([
                accountScopeSha256,
                tradeDate,
                brokerOrderId,
                contractKey,
            ]),
        )
        .digest('hex')}`;
}

async function seedPartialProtectedEntryFill(
    databasePath,
    { identityGroupId = 'identity-A', openOptions = {} } = {},
) {
    const initialized = await openRepository({ databasePath, ...openOptions });
    await startReadyRuntime(initialized.client, {
        runtimeEpochId: 'protected-entry-setup-runtime',
        senderFence: 'protected-entry-setup-fence',
        apiGeneration: 'simulation-generation/1',
    });
    await initialized.client.request(
        'insertStrategy',
        strategyInput({ identityGroupId }),
    );
    await initialized.client.request(
        'prepareIntent',
        preparedIntentInput({
            reservation: { identityGroupId },
            protectionCommitment: {
                commitmentId: 'commitment-1',
                committedShares: 1_000,
            },
            protectionObligation: {
                obligationId: 'obligation-1',
                positionLineageId: 'position-lineage-1',
            },
        }),
    );
    await initialized.client.close();
    openClients.delete(initialized.client);

    const orderEvent = protectedEntryBrokerEvent();
    const dealEvent = protectedEntryBrokerEvent({
        eventKind: 'deal',
        status: 'PartFilled',
        cumulativeDeal: 200,
        remaining: 800,
        eventDeal: 200,
        dealId: 'protected-entry-deal-1',
        exchangeSequence: 'protected-entry-exchange-1',
        exchangeEpochMs: 1_786_377_600_400,
    });
    const seed = new DatabaseSync(databasePath);
    seed.exec(`
        UPDATE order_intents
           SET state='dispatching', adapter_authority_granted=1,
               dispatch_attempt_nonce='dispatch-attempt-1',
               runtime_epoch_id='protected-entry-setup-runtime',
               sender_fence='protected-entry-setup-fence',
               api_generation='simulation-generation/1', revision=1
         WHERE intent_id='intent-1';
        UPDATE activations SET state='dispatching', revision=1
         WHERE activation_id='activation-1';
    `);
    seedBrokerCorrelation(seed, [orderEvent, dealEvent]);
    seed.close();

    const {
        testOnlyExposureArbiterHeads: _ignoredExposureHeads,
        ...reopenOptions
    } = openOptions;
    const reopened = await openRepository({
        databasePath,
        ...reopenOptions,
        testOnlyExposureArbiterHeads: [],
    });
    await reopened.client.request('recordCanonicalBrokerEvent', {
        runtimeEpochId: 'protected-entry-setup-runtime',
        senderFence: 'protected-entry-setup-fence',
        apiGeneration: 'simulation-generation/1',
        event: orderEvent,
    });
    await reopened.client.request('recordCanonicalBrokerEvent', {
        runtimeEpochId: 'protected-entry-setup-runtime',
        senderFence: 'protected-entry-setup-fence',
        apiGeneration: 'simulation-generation/1',
        event: dealEvent,
    });
    await reopened.client.request('materializeProtectedEntryFill', {
        runtimeEpochId: 'protected-entry-setup-runtime',
        senderFence: 'protected-entry-setup-fence',
        apiGeneration: 'simulation-generation/1',
        intentId: 'intent-1',
        nowEpochMs: 1_786_377_600_600,
        reconciliation: protectedEntryReconciliation(),
    });
    await reopened.client.close();
    openClients.delete(reopened.client);
}

async function openPartialProtectedEntryForAccountReconciliation(databasePath) {
    const expectation = await prepareRepositoryExpectation(databasePath);
    const identityAdmission = await signedIdentityAdmission({
        identityKeyPath: expectation.identityKeyPath,
        issuedAtEpochMs: 1_786_377_600_800,
    });
    const resetIdentity = new DatabaseSync(databasePath);
    resetIdentity
        .prepare(
            "DELETE FROM repository_meta WHERE key LIKE 'authenticated_identity_account_binding:%'",
        )
        .run();
    resetIdentity
        .prepare(
            "UPDATE strategies SET identity_group_id=? WHERE strategy_id='strategy-1'",
        )
        .run(identityAdmission.identityGroupId);
    resetIdentity
        .prepare(
            "UPDATE entry_exposure_reservations SET identity_group_id=? WHERE intent_id='intent-1'",
        )
        .run(identityAdmission.identityGroupId);
    resetIdentity.close();
    const reopened = await openRepository({
        databasePath,
        testOnlyExposureArbiterHeads: [],
    });
    return { ...reopened, identityAdmission };
}

const TEST_PROTECTED_ENTRY_RISK_POLICY_HASH = canonicalProtectedEntryPlan(
    protectedEntryProjection().payload.protectionPlan,
).riskPolicyHash;

afterEach(async () => {
    await Promise.all(
        [...openClients].map(async (client) => {
            try {
                await client.close();
            } finally {
                openClients.delete(client);
            }
        }),
    );
    await Promise.all(
        temporaryRoots.splice(0).map((root) =>
            rm(root, { recursive: true, force: true }),
        ),
    );
});

async function temporaryDatabasePath() {
    const root = await mkdtemp(path.join(tmpdir(), 'smart-order-repository-'));
    temporaryRoots.push(root);
    await chmod(root, 0o700);
    const smartOrderRoot = path.join(root, 'smart-order');
    const databaseDirectory = path.join(smartOrderRoot, 'database');
    const privateDirectory = path.join(smartOrderRoot, 'private');
    await mkdir(databaseDirectory, { recursive: true, mode: 0o700 });
    await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
    await chmod(smartOrderRoot, 0o700);
    await chmod(databaseDirectory, 0o700);
    await chmod(privateDirectory, 0o700);
    return path.join(databaseDirectory, 'smart-orders.sqlite3');
}

async function prepareRepositoryExpectation(databasePath, repositoryExpected) {
    const smartOrderRoot = path.dirname(path.dirname(databasePath));
    const privateDirectory = path.join(smartOrderRoot, 'private');
    const installationIdPath = path.join(privateDirectory, 'installation-id');
    const identityKeyPath = path.join(privateDirectory, 'identity-hmac-key.bin');
    const repositoryExpectationPath = path.join(
        privateDirectory,
        'repository-expectation.json',
    );
    let installationId;
    try {
        await lstat(identityKeyPath);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        await writeFile(identityKeyPath, randomBytes(32), { mode: 0o600 });
    }
    try {
        installationId = (await readFile(installationIdPath, 'utf8')).trim();
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        installationId = randomUUID();
        await writeFile(installationIdPath, `${installationId}\n`, { mode: 0o600 });
    }
    try {
        await lstat(repositoryExpectationPath);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        let expected = repositoryExpected;
        if (expected === undefined) {
            try {
                await lstat(databasePath);
                expected = true;
            } catch (databaseError) {
                if (databaseError?.code !== 'ENOENT') throw databaseError;
                expected = false;
            }
        }
        const marker = {
            schemaVersion: SMART_ORDER_REPOSITORY_EXPECTATION_SCHEMA_VERSION,
            databasePathSha256: `sha256:${createHash('sha256')
                .update(path.resolve(databasePath))
                .digest('hex')}`,
            installationIdSha256: `sha256:${createHash('sha256')
                .update(installationId)
                .digest('hex')}`,
            repositoryExpected: expected,
        };
        await writeFile(repositoryExpectationPath, `${JSON.stringify(marker)}\n`, {
            mode: 0o600,
        });
    }
    return { identityKeyPath, installationIdPath, repositoryExpectationPath };
}

async function openRepository(options = {}) {
    const databasePath = options.databasePath ?? (await temporaryDatabasePath());
    const expectation = await prepareRepositoryExpectation(databasePath);
    const client = await openSmartOrderRepository({
        databasePath,
        ...expectation,
        testOnlyExposureArbiterHeads: [defaultExposureArbiterHead()],
        testOnlyExposureClockNowEpochMs: TEST_EXPOSURE_NOW_EPOCH_MS,
        testOnlyExternalSellVisibilityHeads: [
            defaultExternalSellVisibilityHead(),
        ],
        testOnlyAllowUnverifiedIdentitySeed: true,
        testOnlyAllowSyntheticGateManifestProjection: true,
        ...options,
    });
    openClients.add(client);
    return { client, databasePath, ...expectation };
}

async function signedIdentityAdmission({
    identityKeyPath,
    accountBrokerRef = 'broker-A',
    accountIdRef = 'account-A',
    canonicalPrincipal = 'test-broker-authenticated-principal',
    issuedAtEpochMs = 1_786_377_600_000,
    mappingRevision = 'identity-mapping/1',
    principalEvidenceHash = DIGEST_A,
} = {}) {
    const identityKey = await readFile(identityKeyPath);
    const identityGroupId = `hmac-sha256:${createHmac('sha256', identityKey)
        .update(canonicalPrincipal)
        .digest('hex')}`;
    const unsigned = {
        schemaVersion:
            'smart-order-authenticated-identity-admission/2026-08-13.1',
        accountBrokerRef,
        accountIdRef,
        identityGroupId,
        identityKeyFingerprintSha256: `sha256:${createHash('sha256')
            .update(identityKey)
            .digest('hex')}`,
        principalEvidenceHash,
        mappingRevision,
        issuedAtEpochMs,
    };
    const admissionHmacSha256 = `hmac-sha256:${createHmac(
        'sha256',
        identityKey,
    )
        .update(canonicalJson(unsigned))
        .digest('hex')}`;
    identityKey.fill(0);
    return Object.freeze({
        ...unsigned,
        admissionHmacSha256,
    });
}

function defaultExternalSellVisibilityHead(overrides = {}) {
    return {
        accountBrokerRef: 'broker-A',
        accountIdRef: 'account-A',
        tradeDate: '2026-08-11',
        contractKey: 'TSE:2330:STK:Common',
        sourceRevision: 'external-sell-source/1',
        sourceSequence: 1,
        sourceEvidenceHash: DIGEST_A,
        positionRevision: 'position/1',
        positionShares: 1_000_000,
        claims: [],
        observedAtEpochMs: TEST_VISIBILITY_OBSERVED_AT_EPOCH_MS,
        validUntilEpochMs: TEST_VISIBILITY_OBSERVED_AT_EPOCH_MS + 5_000,
        nowEpochMs: TEST_VISIBILITY_OBSERVED_AT_EPOCH_MS,
        ...overrides,
    };
}

function externalWorkingClaim(overrides = {}) {
    return {
        exitClaimId: 'external-working-1',
        positionLineageId: 'visibility-position-lineage',
        remainderGeneration: 0,
        allocationStartShare: 1_000,
        quantityShares: 1_000,
        state: 'broker_working',
        evidenceHash: DIGEST_B,
        ...overrides,
    };
}

function defaultExposureArbiterHead(overrides = {}) {
    const observedAtEpochMs = TEST_EXPOSURE_OBSERVED_AT_EPOCH_MS;
    const baseline = {
        quantityShares: 0,
        notionalMinorUnits: 0,
        cashMinorUnits: 0,
        positionShares: 0,
        orderCount: 0,
    };
    const limits = {
        quantityShares: 1_000_000_000,
        notionalMinorUnits: 9_000_000_000_000_000,
        cashMinorUnits: 9_000_000_000_000_000,
        positionShares: 1_000_000_000,
        orderCount: 1_000_000,
    };
    return {
        accountBrokerRef: 'broker-A',
        accountIdRef: 'account-A',
        accountDailyLossLimitMinorUnits: 1_000_000_000,
        identityGroupId: 'identity-A',
        identityDailyLossLimitMinorUnits: 2_000_000_000,
        policyRevision: 'risk-policy/1',
        policyHash: TEST_PROTECTED_ENTRY_RISK_POLICY_HASH,
        sourceRevision: 'exposure-source/1',
        sourceSequence: 1,
        sourceEvidenceHash: DIGEST_B,
        observedAtEpochMs,
        validUntilEpochMs: observedAtEpochMs + 5_000,
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
        ...overrides,
    };
}

function strategyInput(overrides = {}) {
    return {
        strategyId: 'strategy-1',
        strategyKind: 'quick',
        state: 'monitoring',
        definitionHash: DIGEST_A,
        definition: { schemaVersion: 'strategy/1', kind: 'quick' },
        accountBrokerRef: 'broker-A',
        accountIdRef: 'account-A',
        identityGroupId: 'identity-A',
        confirmationSnapshotHash: DIGEST_B,
        nowEpochMs: 1_786_377_600_000,
        ...overrides,
    };
}

function preparedIntentInput(overrides = {}) {
    const {
        protectedEntryContractUnit = 1_000,
        protectedEntryProtectionFamily = 'fixed',
        protectedEntryLegs,
        ...persistedOverrides
    } = overrides;
    const base = {
        strategyId: 'strategy-1',
        nowEpochMs: 1_786_377_600_100,
        activation: {
            activationId: 'activation-1',
            logicalKey: 'edge-1',
            generation: 1,
            evidenceHash: DIGEST_A,
        },
        intent: {
            intentId: 'intent-1',
            operationKind: 'place',
            ownerKind: 'activation',
            payloadHash: INTENT_PAYLOAD_DIGEST,
            payload: CANONICAL_INTENT_PAYLOAD,
            clientRequestId: 'request-1',
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            tradeDate: '2026-08-11',
            contractKey: 'TSE:2330:STK:Common',
            side: 'Buy',
        },
        reservation: {
            reservationId: 'reservation-1',
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            identityGroupId: 'identity-A',
            policyRevision: 'risk-policy/1',
            policyHash: TEST_PROTECTED_ENTRY_RISK_POLICY_HASH,
            quantityShares: 1_000,
            notionalMinorUnits: 10_000_000,
            cashMinorUnits: 10_000_000,
            positionShares: 1_000,
            orderCount: 1,
        },
    };
    const result = {
        ...base,
        ...persistedOverrides,
        activation: { ...base.activation, ...persistedOverrides.activation },
        intent: { ...base.intent, ...persistedOverrides.intent },
        reservation:
            persistedOverrides.reservation === null
                ? undefined
                : { ...base.reservation, ...persistedOverrides.reservation },
    };
    if (result.protectionCommitment) {
        const projection = protectedEntryProjection({
            baseShares: result.protectionCommitment.committedShares,
            contractUnit: protectedEntryContractUnit,
            protectionFamily: protectedEntryProtectionFamily,
            protectionLegs: protectedEntryLegs,
        });
        result.intent = {
            ...result.intent,
            payload: projection.payload,
            payloadHash: projection.payloadSha256,
        };
        result.runtimeEpochId ??= 'protected-entry-setup-runtime';
        result.senderFence ??= 'protected-entry-setup-fence';
        result.apiGeneration ??= 'simulation-generation/1';
    }
    return result;
}

async function insertPreparedIntent(client, overrides = {}) {
    await client.request('insertStrategy', strategyInput());
    return client.request('prepareIntent', preparedIntentInput(overrides));
}

function terminalizeProtectedEntryFixture(
    database,
    { activationId = 'activation-1', intentId = 'intent-1' } = {},
) {
    database.prepare(`
        UPDATE activations
           SET state='filled', updated_at_epoch_ms=1786377600200,
               revision=revision+1
         WHERE activation_id=?
    `).run(activationId);
    database.prepare(`
        UPDATE order_intents
           SET state='terminal', terminal_outcome='filled',
               updated_at_epoch_ms=1786377600200,
               terminal_at_epoch_ms=1786377600200,
               revision=revision+1
         WHERE intent_id=?
    `).run(intentId);
    database.prepare(`
        UPDATE entry_exposure_reservations
           SET state='consumed', updated_at_epoch_ms=1786377600200,
               terminal_at_epoch_ms=1786377600200,
               revision=revision+1
         WHERE intent_id=?
    `).run(intentId);
}

async function createMonitoringExitClaimFixture({
    claimQuantityShares = 1_000,
    entryCommittedShares = claimQuantityShares,
    entryDisposition = 'terminal',
    contractUnit = 1_000,
    protectionFamily = 'fixed',
    protectionLegs,
    existingPositionPlan = null,
    externalHeads = [defaultExternalSellVisibilityHead()],
    openOptions = {},
} = {}) {
    const setup = await openRepository({
        testOnlyExternalSellVisibilityHeads: [],
        ...openOptions,
    });
    const setupRuntime = await startReadyRuntime(setup.client, {
        runtimeEpochId: 'visibility-setup-runtime',
        senderFence: 'visibility-setup-fence',
        apiGeneration: 'simulation-generation/1',
    });
    await setup.client.request(
        'insertStrategy',
        strategyInput({
            definition: {
                schemaVersion: 'strategy/1',
                kind: 'quick',
                activationPolicy: 'require_rearm',
            },
        }),
    );
    await setup.client.request(
        'prepareIntent',
        preparedIntentInput({
            protectedEntryContractUnit: contractUnit,
            protectedEntryProtectionFamily: protectionFamily,
            protectedEntryLegs: protectionLegs,
            runtimeEpochId: setupRuntime.runtime.runtimeEpochId,
            senderFence: setupRuntime.runtime.senderFence,
            apiGeneration: setupRuntime.runtime.apiGeneration,
            protectionCommitment: {
                commitmentId: 'visibility-commitment',
                committedShares: entryCommittedShares,
            },
            protectionObligation: {
                obligationId: 'visibility-obligation',
                positionLineageId: 'visibility-position-lineage',
            },
            reservation: {
                quantityShares: entryCommittedShares,
                positionShares: entryCommittedShares,
            },
        }),
    );
    await setup.client.close();
    openClients.delete(setup.client);
    const seeded = await openRepository({
        databasePath: setup.databasePath,
        testOnlyExternalSellVisibilityHeads: externalHeads,
        ...openOptions,
    });
    await seeded.client.close();
    openClients.delete(seeded.client);
    const database = new DatabaseSync(setup.databasePath);
    database.exec('PRAGMA foreign_keys=ON');
    if (['working', 'unknown'].includes(entryDisposition)) {
        if (entryCommittedShares <= claimQuantityShares) {
            throw new Error(
                'working entry fixture requires an unfilled committed remainder',
            );
        }
        database.exec(`
            UPDATE activations
               SET state='part_filled', updated_at_epoch_ms=1786377600200,
                   revision=revision+1
             WHERE activation_id='activation-1';
        `);
        database.prepare(`
            UPDATE order_intents
               SET state='acknowledged', runtime_epoch_id=?, sender_fence=?,
                   api_generation=?, mode_revision=?, risk_revision=?,
                   account_revision='account-reconciliation/1',
                   target_revision='entry-target/1',
                   adapter_authority_granted=1,
                   updated_at_epoch_ms=1786377600200,
                   revision=revision+1
             WHERE intent_id='intent-1'
        `).run(
            setupRuntime.runtime.runtimeEpochId,
            setupRuntime.runtime.senderFence,
            setupRuntime.runtime.apiGeneration,
            setupRuntime.runtime.apiGeneration,
            'risk-policy/1',
        );
        database.exec(`
            UPDATE entry_exposure_reservations
               SET state='partially_consumed',
                   updated_at_epoch_ms=1786377600200,
                   revision=revision+1
             WHERE intent_id='intent-1';
        `);
        database.prepare(`
            INSERT INTO broker_orders(
                broker_order_id, intent_id, state, control_revision,
                quantity_shares, filled_shares, remaining_shares,
                evidence_hash, updated_at_epoch_ms, terminal_at_epoch_ms,
                revision
            ) VALUES ('visibility-entry-broker-order', 'intent-1', ?, 0,
                      ?, ?, ?, ?, 1786377600200, NULL, 0)
        `).run(
            entryDisposition === 'working' ? 'part_filled' : 'unknown',
            entryCommittedShares,
            claimQuantityShares,
            entryCommittedShares - claimQuantityShares,
            DIGEST_A,
        );
        if (entryDisposition === 'working') {
            database.prepare(`
                INSERT INTO broker_correlations(
                    correlation_id, intent_id, broker_order_id,
                    canonical_key_hash, account_broker_ref, account_id_ref,
                    trade_date, contract_key, side, trade_id, order_id,
                    deal_id, seqno, ordno, exchange_sequence, custom_field,
                    evidence_hash, created_at_epoch_ms, revision
                ) VALUES (
                    'visibility-entry-correlation', 'intent-1',
                    'visibility-entry-broker-order', ?, 'broker-A',
                    'account-A', '2026-08-11',
                    'TSE:2330:STK:Common', 'Buy', 'entry-trade',
                    'entry-order', NULL, 'entry-seq', 'entry-ord',
                    'entry-exchange', NULL, ?, 1786377600200, 0
                )
            `).run(
                `sha256:${createHash('sha256')
                    .update(
                        [
                            'broker-A',
                            'account-A',
                            '2026-08-11',
                            'TSE:2330:STK:Common',
                            'Buy',
                            'entry-trade',
                            'entry-order',
                            '',
                            'entry-seq',
                            'entry-ord',
                            'entry-exchange',
                        ].join('\u001f'),
                    )
                    .digest('hex')}`,
                DIGEST_B,
            );
            const insertIdentifier = database.prepare(`
                INSERT INTO broker_correlation_identifiers(
                    account_broker_ref, account_id_ref, trade_date,
                    contract_key, side, identifier_kind, identifier_value,
                    intent_id, correlation_id, created_at_epoch_ms
                ) VALUES ('broker-A', 'account-A', '2026-08-11',
                          'TSE:2330:STK:Common', 'Buy', ?, ?, 'intent-1',
                          'visibility-entry-correlation', 1786377600200)
            `);
            for (const [kind, value] of [
                ['tradeId', 'entry-trade'],
                ['orderId', 'entry-order'],
                ['seqno', 'entry-seq'],
                ['ordno', 'entry-ord'],
                ['exchangeSequence', 'entry-exchange'],
            ]) {
                insertIdentifier.run(kind, value);
            }
            const brokerEventKeyHash = `sha256:${createHash('sha256')
                .update('visibility-entry-broker-event')
                .digest('hex')}`;
            const correlationKeyHash = `sha256:${createHash('sha256')
                .update(
                    [
                        'broker-A',
                        'account-A',
                        '2026-08-11',
                        'TSE:2330:STK:Common',
                        'Buy',
                        'entry-trade',
                        'entry-order',
                        '',
                        'entry-seq',
                        'entry-ord',
                        'entry-exchange',
                    ].join('\u001f'),
                )
                .digest('hex')}`;
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
                    ?, ?, 'intent-1', 'mapping/1',
                    'simulation-generation/1', 'order', 'broker-A',
                    'account-A', '2026-08-11', 'TSE:2330:STK:Common',
                    'Buy', 'entry-trade', 'entry-order', NULL, 'entry-seq',
                    'entry-ord', 'entry-exchange', NULL, NULL, NULL, NULL,
                    'PartFilled', 'Cash', 'Common', 'LMT', 'ROD', 1000,
                    ?, 0, ?, 0, 'Share', '100.00', 1786377600200,
                    1786377600200, 1786377600200, ?, ?
                )
            `).run(
                brokerEventKeyHash,
                correlationKeyHash,
                claimQuantityShares,
                entryCommittedShares - claimQuantityShares,
                DIGEST_A,
                DIGEST_B,
            );
            database.prepare(`
                INSERT INTO broker_event_heads(
                    account_broker_ref, account_id_ref, trade_date,
                    broker_order_correlation_key_hash, intent_id, status,
                    order_quantity, cumulative_deal_quantity,
                    cumulative_cancel_quantity, remaining_quantity,
                    quantity_unit, exchange_epoch_ms, broker_event_key_hash,
                    evidence_hash, revision
                ) VALUES (
                    'broker-A', 'account-A', '2026-08-11', ?, 'intent-1',
                    'PartFilled', 1000, ?, 0, ?, 'Share', 1786377600200,
                    ?, ?, 0
                )
            `).run(
                correlationKeyHash,
                claimQuantityShares,
                entryCommittedShares - claimQuantityShares,
                brokerEventKeyHash,
                DIGEST_A,
            );
        }
    } else if (entryDisposition !== 'terminal') {
        throw new Error('unsupported monitoring fixture entry disposition');
    }
    database.prepare(`
        UPDATE pending_protection_commitments
           SET state='materialized', materialized_shares=?,
               updated_at_epoch_ms=1786377600200, revision=1
         WHERE commitment_id='visibility-commitment'
    `).run(claimQuantityShares);
    database.prepare(`
        UPDATE protection_obligations
           SET state='monitoring', filled_shares=?,
               updated_at_epoch_ms=1786377600200, revision=1
         WHERE obligation_id='visibility-obligation'
    `).run(claimQuantityShares);
    database.prepare(`
        INSERT INTO exit_claims(
            exit_claim_id, obligation_id, intent_id, external_lineage,
            account_broker_ref, account_id_ref, contract_key,
            position_lineage_id, remainder_generation,
            allocation_start_share, quantity_shares, state,
            evidence_hash, created_at_epoch_ms, updated_at_epoch_ms, revision
        ) VALUES (
            'visibility-internal-claim', 'visibility-obligation', NULL, 0,
            'broker-A', 'account-A', 'TSE:2330:STK:Common',
            'visibility-position-lineage', 0, 0, ?,
            'monitoring_reserved', ?, 1786377600200, 1786377600200, 0
        )
    `).run(claimQuantityShares, DIGEST_A);
    database.prepare(`
        INSERT INTO protection_groups(
            protection_group_id, obligation_id, exit_claim_id, state,
            current_generation, plan_hash, created_at_epoch_ms,
            updated_at_epoch_ms, revision
        ) VALUES (?, 'visibility-obligation', 'visibility-internal-claim',
                  'monitoring', 0, ?, 1786377600200, 1786377600200, 0)
    `).run(
        VISIBILITY_PROTECTION_GROUP_ID,
        existingPositionPlan?.planSha256 ??
            protectedEntryProjection({
                baseShares: entryCommittedShares,
                contractUnit,
                protectionFamily,
                protectionLegs,
            }).payload.protectionPlanSha256,
    );
    database.prepare(`
        INSERT INTO protection_remainder_generations(
            protection_group_id, remainder_generation, exit_claim_id,
            state, quantity_shares, evidence_hash,
            created_at_epoch_ms, updated_at_epoch_ms, revision
        ) VALUES (?, 0, 'visibility-internal-claim', 'monitoring', ?, ?,
                  1786377600200, 1786377600200, 0)
    `).run(VISIBILITY_PROTECTION_GROUP_ID, claimQuantityShares, DIGEST_A);
    if (existingPositionPlan !== null) {
        database.prepare(`
            UPDATE strategies
               SET state='monitoring', confirmation_snapshot_hash=?,
                   revision=revision+1
             WHERE strategy_id='strategy-1'
        `).run(existingPositionPlan.plan.confirmationSnapshotHash);
        database.prepare(`
            UPDATE protection_obligations
               SET commitment_id=NULL
             WHERE obligation_id='visibility-obligation'
        `).run();
        const formal = deriveExistingPositionFormalProtection(
            existingPositionPlan.plan,
            claimQuantityShares,
        );
        const formalJson = canonicalJson(formal);
        const formalHash = `sha256:${createHash('sha256')
            .update(formalJson)
            .digest('hex')}`;
        database.prepare(`
            INSERT INTO existing_position_protection_heads(
                strategy_id, obligation_id, exit_claim_id, trade_date,
                protection_plan_json, protection_plan_hash,
                formal_protection_json, formal_protection_hash,
                reconciliation_evidence_hash, reconciliation_as_of_epoch_ms,
                created_at_epoch_ms, updated_at_epoch_ms, revision
            ) VALUES (
                'strategy-1', 'visibility-obligation',
                'visibility-internal-claim', '2026-08-11', ?, ?, ?, ?, ?,
                1786377600200, 1786377600200, 1786377600200, 0
            )
        `).run(
            existingPositionPlan.planJson,
            existingPositionPlan.planSha256,
            formalJson,
            formalHash,
            DIGEST_B,
        );
    }
    if (entryDisposition === 'terminal') {
        terminalizeProtectedEntryFixture(database);
    }
    database.close();
    return setup.databasePath;
}

function seedProtectiveTriggerFillAndRearm(databasePath, projection) {
    const formal = deriveProtectedEntryFormalProtection(
        projection.payload.protectionPlan,
        10_000_000,
        1_000,
    );
    const formalJson = canonicalJson(formal);
    const formalHash = `sha256:${createHash('sha256')
        .update(formalJson)
        .digest('hex')}`;
    const database = new DatabaseSync(databasePath);
    database.exec('PRAGMA foreign_keys=ON');
    database.prepare(`
        INSERT INTO protected_entry_fill_heads(
            intent_id, commitment_id, obligation_id, exit_claim_id,
            protection_plan_hash, atr_snapshot_hash,
            formal_protection_json, formal_protection_hash,
            cumulative_filled_shares, remaining_entry_shares,
            fill_notional_minor_units,
            weighted_average_numerator_minor_units,
            weighted_average_denominator_shares,
            position_lineage_id, position_quantity_shares,
            deal_set_hash, reconciliation_snapshot_hash,
            reconciliation_evidence_hash,
            reconciliation_source_revision,
            reconciliation_as_of_epoch_ms, state,
            created_at_epoch_ms, updated_at_epoch_ms, revision
        ) VALUES (
            'intent-1', 'visibility-commitment',
            'visibility-obligation', 'visibility-internal-claim', ?, NULL,
            ?, ?, 1000, 0, 10000000, 10000000, 1000,
            'visibility-position-lineage', 1000, ?, ?, ?,
            'reconciliation/trigger-1', 1786377600200, 'final',
            1786377600200, 1786377600200, 0
        )
    `).run(
        projection.payload.protectionPlanSha256,
        formalJson,
        formalHash,
        DIGEST_A,
        DIGEST_B,
        DIGEST_B,
    );
    database.prepare(`
        INSERT INTO intent_rearm_authorizations(
            rearm_authorization_id, intent_id, runtime_epoch_id,
            sender_fence, api_generation, rearm_request_id,
            authorized_intent_revision, confirmation_snapshot_hash,
            risk_revision, reconciliation_evidence_hash,
            user_rearm_evidence_hash, state, authorized_at_epoch_ms,
            consumed_at_epoch_ms, revision
        ) VALUES (
            'entry-rearm-trigger', 'intent-1',
            'visibility-setup-runtime', 'visibility-setup-fence',
            'simulation-generation/1', 'entry-rearm-request-trigger',
            1, ?, 'risk-policy/1', ?, ?, 'consumed',
            1786377600100, 1786377600150, 1
        )
    `).run(DIGEST_B, DIGEST_B, DIGEST_A);
    database.close();
}

function protectiveSellIntent(overrides = {}) {
    const protectionPlan =
        overrides.protectionPlan ??
        protectedEntryProjection({
            contractUnit: overrides.contractUnit ?? 1_000,
        }).payload.protectionPlan;
    const defaultProjection = protectiveBrokerIntentProjection({
        protectionPlan,
    });
    return {
        ...preparedIntentInput({
        nowEpochMs: 1_786_377_600_300,
        activation: {
            activationId: 'visibility-sell-activation',
            logicalKey: 'visibility-sell-edge',
            generation: 0,
            evidenceHash: DIGEST_B,
            ...overrides.activation,
        },
        intent: {
            intentId: 'visibility-sell-intent',
            side: 'Sell',
            payload: defaultProjection.payload,
            payloadHash: defaultProjection.payloadSha256,
            clientRequestId: 'visibility-sell-request',
            ...overrides.intent,
        },
        reservation: null,
        exitClaim: {
            exitClaimId: 'visibility-internal-claim',
            obligationId: 'visibility-obligation',
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            contractKey: 'TSE:2330:STK:Common',
            positionLineageId: 'visibility-position-lineage',
            remainderGeneration: 0,
            allocationStartShare: 0,
            quantityShares: 1_000,
            expectedRevision: 0,
            evidenceHash: DIGEST_B,
            protectionGroupId: VISIBILITY_PROTECTION_GROUP_ID,
            expectedGroupRevision: 0,
            expectedGenerationRevision: 0,
            candidateEvaluations: [
                {
                    legId: 'stop-leg',
                    evidenceHash: DIGEST_B,
                    observedAtEpochMs: 1_786_377_600_300,
                },
            ],
            ...overrides.exitClaim,
        },
        }),
        runtimeEpochId: 'visibility-setup-runtime',
        senderFence: 'visibility-setup-fence',
        apiGeneration: 'simulation-generation/1',
    };
}

async function prepareReadyVisibilitySell(client, options = {}) {
    await client.request('prepareIntent', protectiveSellIntent(options));
    const started = await client.request(
        'startRuntimeEpoch',
        runtimeEpochInput(),
    );
    await client.request('rearmPreparedIntent', rearmInput({
        intentId: 'visibility-sell-intent',
        rearmAuthorizationId: 'visibility-sell-rearm',
        rearmRequestId: 'visibility-sell-rearm-request',
    }));
    await client.request('markRuntimeEpochReady', {
        runtimeEpochId: 'runtime-epoch-1',
        apiGeneration: 'api-generation-1',
        senderFence: 'sender-fence-1',
        expectedRevision: started.revision,
        reconciliationEvidenceHash: DIGEST_B,
    });
}

function externalWorkingSetHash(claims) {
    const projected = claims
        .map((claim) => ({
            allocationStartShare: claim.allocationStartShare,
            evidenceHash: claim.evidenceHash,
            exitClaimId: claim.exitClaimId,
            positionLineageId: claim.positionLineageId,
            quantityShares: claim.quantityShares,
            remainderGeneration: claim.remainderGeneration,
            state: claim.state,
        }))
        .sort((left, right) => left.exitClaimId.localeCompare(right.exitClaimId));
    return `sha256:${createHash('sha256')
        .update(JSON.stringify({ claims: projected }))
        .digest('hex')}`;
}

function strategyCancelMutationInput(overrides = {}) {
    const base = {
        requestId: 'strategy-cancel-authority-1',
        operationKind: 'strategy_cancel',
        payloadHash: DIGEST_A,
        nowEpochMs: 1_786_377_600_300,
        mutation: {
            kind: 'cancel',
            strategyId: 'strategy-1',
            expectedRevision: 0,
            nowEpochMs: 1_786_377_600_300,
        },
    };
    return {
        ...base,
        ...overrides,
        mutation: { ...base.mutation, ...overrides.mutation },
    };
}

function preparedIntentLocalCancelInput(overrides = {}) {
    const base = {
        requestId: 'prepared-local-cancel-1',
        authorization: {
            authorizationId: 'strategy-cancel-authority-1',
            evidenceHash: DIGEST_A,
            actorKind: 'interactive_user',
            lifecycleOperationId: null,
        },
        intentId: 'intent-1',
        expectedIntentRevision: 0,
        activation: {
            activationId: 'activation-1',
            expectedRevision: 0,
        },
        reservation: {
            reservationId: 'reservation-1',
            expectedRevision: 0,
        },
        protection: null,
        exitClaim: null,
        rearm: null,
        nowEpochMs: 1_786_377_600_400,
    };
    return {
        ...base,
        ...overrides,
        authorization: {
            ...base.authorization,
            ...overrides.authorization,
        },
        activation: { ...base.activation, ...overrides.activation },
        reservation:
            overrides.reservation === null
                ? null
                : { ...base.reservation, ...overrides.reservation },
        protection:
            overrides.protection === undefined
                ? base.protection
                : overrides.protection,
        exitClaim:
            overrides.exitClaim === undefined
                ? base.exitClaim
                : overrides.exitClaim,
        rearm: overrides.rearm === undefined ? base.rearm : overrides.rearm,
    };
}

function dispatchInput(overrides = {}) {
    return {
        intentId: 'intent-1',
        runtimeEpochId: 'runtime-epoch-1',
        expectedRevision: 1,
        expectedActivationRevision: 0,
        expectedReservationRevision: 0,
        expectedRearmRevision: 0,
        rearmAuthorizationId: 'rearm-authorization-1',
        rearmRevision: 1,
        dispatchAttemptNonce: 'dispatch-nonce-1',
        senderFence: 'sender-fence-1',
        apiGeneration: 'api-generation-1',
        modeRevision: 'mode-revision-1',
        riskRevision: 'risk-revision-1',
        accountRevision: 'account-revision-1',
        targetRevision: 'target-revision-1',
        expectedKillSwitchArbiterRevision: 0,
        killSwitchArbiterRevision: 0,
        nowEpochMs: 1_786_377_600_200,
        ...overrides,
    };
}

function killSwitchMutationInput(overrides = {}) {
    return {
        runtimeEpochId: 'runtime-epoch-1',
        senderFence: 'sender-fence-1',
        apiGeneration: 'api-generation-1',
        expectedArbiterRevision: 0,
        switchName: 'pause_new_exposure',
        enabled: true,
        reasonCode: 'operator_pause',
        nowEpochMs: 1_786_377_600_190,
        ...overrides,
    };
}

function rearmInput(overrides = {}) {
    return {
        rearmAuthorizationId: 'rearm-authorization-1',
        rearmRequestId: 'rearm-request-1',
        intentId: 'intent-1',
        runtimeEpochId: 'runtime-epoch-1',
        senderFence: 'sender-fence-1',
        apiGeneration: 'api-generation-1',
        expectedIntentRevision: 0,
        confirmationSnapshotHash: DIGEST_B,
        riskRevision: 'risk-revision-1',
        reconciliationEvidenceHash: DIGEST_B,
        userRearmEvidenceHash: DIGEST_A,
        nowEpochMs: 1_786_377_600_175,
        ...overrides,
    };
}

function runtimeEpochInput(overrides = {}) {
    return {
        runtimeEpochId: 'runtime-epoch-1',
        apiGeneration: 'api-generation-1',
        senderFence: 'sender-fence-1',
        leaseEvidenceHash: DIGEST_A,
        nowEpochMs: 1_786_377_600_150,
        ...overrides,
    };
}

function continuityGapInput(overrides = {}) {
    return {
        runtimeEpochId: 'runtime-epoch-1',
        senderFence: 'sender-fence-1',
        apiGeneration: 'api-generation-1',
        signalSha256: DIGEST_A,
        reasonCodes: ['EVENT_LOOP_PAUSE_GAP', 'SSE_CURSOR_GAP'],
        nowEpochMs: 1_786_377_600_300,
        ...overrides,
    };
}

async function startReadyRuntime(
    client,
    overrides = {},
    { rearmPreparedIntent = false, rearmOverrides = {} } = {},
) {
    const runtime = runtimeEpochInput(overrides);
    const started = await client.request('startRuntimeEpoch', runtime);
    const rearm = rearmPreparedIntent
        ? await client.request(
              'rearmPreparedIntent',
              rearmInput({
                  runtimeEpochId: runtime.runtimeEpochId,
                  senderFence: runtime.senderFence,
                  apiGeneration: runtime.apiGeneration,
                  ...rearmOverrides,
              }),
          )
        : null;
    const ready = await client.request('markRuntimeEpochReady', {
        runtimeEpochId: runtime.runtimeEpochId,
        apiGeneration: runtime.apiGeneration,
        senderFence: runtime.senderFence,
        expectedRevision: started.revision,
        reconciliationEvidenceHash: DIGEST_B,
    });
    return { runtime, started, rearm, ready };
}

function permissionBits(mode) {
    return mode & 0o777;
}

function taipeiEpoch(value) {
    return Date.parse(`${value}+08:00`);
}

function gateFingerprints() {
    return {
        adapterSha256: `sha256:${'1'.repeat(64)}`,
        appBuildSha256: `sha256:${'2'.repeat(64)}`,
        mappingRevision: 'mapping-r1',
        nodeRuntimeSha256: `sha256:${'3'.repeat(64)}`,
        orderClassMatrixRevision: 'matrix-r1',
        orderClassMatrixSha256: `sha256:${'4'.repeat(64)}`,
        osPlatformSha256: `sha256:${'5'.repeat(64)}`,
        pnlPolicyDefinitionSha256:
            SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
        pnlPolicyRevision: SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
        routeCoverageSha256: `sha256:${'7'.repeat(64)}`,
        shioajiCapabilitySha256: `sha256:${'8'.repeat(64)}`,
        shioajiServerVersion: 'v1.2.3',
        sidecarSchemaSha256: `sha256:${'9'.repeat(64)}`,
        sqliteRuntimeSha256: `sha256:${'a'.repeat(64)}`,
    };
}

function observeOnlyGateManifest(overrides = {}) {
    return createSmartOrderGateManifest({
        manifestId: 'manifest-1',
        manifestRevision: 'manifest-r1',
        provenance: 'automation',
        fingerprints: gateFingerprints(),
        featureGates: Object.fromEntries(
            SMART_ORDER_FEATURE_GATE_IDS.map((id) => [id, false]),
        ),
        productBoundaryConsentVersion: 'local-sidecar-consent/v1',
        evidence: [],
        createdAtEpochMs: 1_786_377_600_000,
        requestedValidUntilEpochMs: 1_786_377_900_000,
        ...overrides,
    });
}

function seedEligibleManualGate(databasePath, {
    strategyKind = 'quick',
    createdAtEpochMs = 1_786_377_600_170,
    featureEnabled = true,
} = {}) {
    const featureGates = Object.fromEntries(
        SMART_ORDER_FEATURE_GATE_IDS.map((id) => [
            id,
            id === strategyKind && featureEnabled,
        ]),
    );
    const manifest = {
        featureGates,
        fingerprints: { mappingRevision: 'mapping-r1' },
    };
    const database = new DatabaseSync(databasePath);
    database
        .prepare(`
            INSERT INTO gate_manifests(
                manifest_id, manifest_revision, manifest_sha256,
                schema_version, provenance, manifest_json,
                fingerprints_sha256, evidence_catalog_sha256,
                feature_gates_sha256, product_boundary_consent_version,
                state, valid_until_epoch_ms, created_at_epoch_ms,
                revision
            ) VALUES (?, ?, ?, ?, 'manual_user_confirmed', ?, ?, ?, ?, ?,
                      'eligible', ?, ?, 0)
        `)
        .run(
            `manual-gate-${strategyKind}-${createdAtEpochMs}`,
            'manual-gate-r1',
            `sha256:${'c'.repeat(64)}`,
            'smart-order-gate-manifest/2026-08-11.1',
            JSON.stringify(manifest),
            DIGEST_A,
            DIGEST_B,
            `sha256:${'d'.repeat(64)}`,
            'local-sidecar-consent/v1',
            createdAtEpochMs + 300_000,
            createdAtEpochMs,
        );
    database.close();
}

function seedEligibleProbeGate(
    databasePath,
    { createdAtEpochMs = 1_786_377_600_170 } = {},
) {
    const manifestSha256 = `sha256:${'e'.repeat(64)}`;
    const manifest = {
        evidence: [],
        featureGates: Object.fromEntries(
            SMART_ORDER_FEATURE_GATE_IDS.map((id) => [id, false]),
        ),
        fingerprints: { mappingRevision: 'mapping-r1' },
    };
    const database = new DatabaseSync(databasePath);
    database
        .prepare(`
            INSERT INTO gate_manifests(
                manifest_id, manifest_revision, manifest_sha256,
                schema_version, provenance, manifest_json,
                fingerprints_sha256, evidence_catalog_sha256,
                feature_gates_sha256, product_boundary_consent_version,
                state, valid_until_epoch_ms, created_at_epoch_ms,
                revision
            ) VALUES ('gate-probe-eligible-test', 'gate-probe-r1', ?, ?,
                      'gate_probe', ?, ?, ?, ?, ?, 'eligible', ?, ?, 0)
        `)
        .run(
            manifestSha256,
            'smart-order-gate-manifest/2026-08-11.1',
            JSON.stringify(manifest),
            DIGEST_A,
            DIGEST_B,
            `sha256:${'d'.repeat(64)}`,
            'local-sidecar-consent/v1',
            createdAtEpochMs + 300_000,
            createdAtEpochMs,
        );
    database.close();
    return manifestSha256;
}

function gateProbeEnvelope({
    operation = 'place',
    operationId = '123e4567-e89b-42d3-a456-426614174301',
    runId = '123e4567-e89b-42d3-a456-426614174300',
    nonce = '123e4567-e89b-42d3-a456-426614174302',
    target = null,
    tradeId = 'probe-trade-1',
    validUntilEpochMs = Date.now() + 30_000,
} = {}) {
    const account = {
        broker_id: 'broker-A',
        account_id: 'account-A',
        account_type: 'S',
    };
    const accountScopeSha256 = smartOrderGateProbeAccountScopeSha256(account);
    const requestOperation =
        operation === 'update' ? 'update_quantity' : operation;
    const request = {
        schemaVersion:
            'smart-order-manual-broker-write-request/2026-08-14.1',
        operation: requestOperation,
        brokerPath:
            requestOperation === 'place'
                ? '/api/v1/order/place_order'
                : requestOperation === 'update_quantity'
                  ? '/api/v1/order/update_qty'
                  : '/api/v1/order/cancel_order',
        payload:
            requestOperation === 'place'
                ? {
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
                  }
                : requestOperation === 'update_quantity'
                  ? { trade_id: tradeId, quantity: 1, account }
                  : { trade_id: tradeId, account },
    };
    return {
        schemaVersion: SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
        runId,
        operationId,
        nonce,
        request,
        target,
        tradeDate: '2026-08-11',
        confirmation: {
            accountScopeSha256,
            confirmed: true,
            expectedOperation: operation,
            maximumCommonLots: 1,
            simulation: true,
        },
        validUntilEpochMs,
    };
}

function gateProbeTarget({
    revision = 0,
    runId = '123e4567-e89b-42d3-a456-426614174300',
    tradeId = 'probe-trade-1',
} = {}) {
    const accountScopeSha256 = smartOrderGateProbeAccountScopeSha256({
        broker_id: 'broker-A',
        account_id: 'account-A',
        account_type: 'S',
    });
    return {
        originRunId: runId,
        targetIdSha256: `sha256:${'1'.repeat(64)}`,
        tradeIdSha256: `sha256:${createHash('sha256')
            .update(JSON.stringify(tradeId))
            .digest('hex')}`,
        accountScopeSha256,
        tradeDate: '2026-08-11',
        revision,
        quantityCommonLots: 1,
        nonTerminal: true,
        correlationUnique: true,
    };
}

function seedEligibleAutomationReconciliationGate(
    databasePath,
    { createdAtEpochMs = 1_786_377_600_170 } = {},
) {
    const evidence = ['account_contract', 'pnl_full_day', 'readonly_contract'].map(
        (evidenceClass, index) => ({
            evidenceClass,
            evidenceId: `reconciliation-capability-${index + 1}`,
            resultSha256: `sha256:${String(index + 1).repeat(64)}`,
            sourceSha256: `sha256:${String(index + 4).repeat(64)}`,
        }),
    );
    const manifest = {
        evidence,
        featureGates: Object.fromEntries(
            SMART_ORDER_FEATURE_GATE_IDS.map((id) => [id, false]),
        ),
        fingerprints: {
            mappingRevision:
                'smart-order-shioaji-stock-event-mapping/2026-08-13.1',
            pnlPolicyDefinitionSha256:
                SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
            pnlPolicyRevision: SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
        },
    };
    const database = new DatabaseSync(databasePath);
    database
        .prepare(`
            INSERT INTO gate_manifests(
                manifest_id, manifest_revision, manifest_sha256,
                schema_version, provenance, manifest_json,
                fingerprints_sha256, evidence_catalog_sha256,
                feature_gates_sha256, product_boundary_consent_version,
                state, valid_until_epoch_ms, created_at_epoch_ms,
                revision
            ) VALUES ('automation-reconciliation-gate',
                      'automation-reconciliation-r1', ?, ?, 'automation',
                      ?, ?, ?, ?, ?, 'eligible', ?, ?, 0)
        `)
        .run(
            `sha256:${'e'.repeat(64)}`,
            'smart-order-gate-manifest/2026-08-11.1',
            JSON.stringify(manifest),
            DIGEST_A,
            DIGEST_B,
            `sha256:${'d'.repeat(64)}`,
            'local-sidecar-consent/v1',
            createdAtEpochMs + 300_000,
            createdAtEpochMs,
        );
    database.close();
}

describe('smart-order SQLite repository worker', () => {
    it('creates the complete schema with fail-closed PRAGMAs and private artifacts', async () => {
        const { client, databasePath } = await openRepository();
        const status = await client.request('status');

        expect(status).toMatchObject({
            schemaId: SMART_ORDER_REPOSITORY_SCHEMA_ID,
            schemaVersion: SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
            integrity: 'ok',
            journalMode: 'wal',
            synchronous: 2,
            foreignKeys: 1,
            busyTimeoutMs: 2_500,
            trustedSchema: 0,
            tradingSenderAuthority: 'none',
            legacyTradingTriggerAuthority: 'permanently_retired',
        });
        expect(Object.keys(status.counts).sort()).toEqual(
            [...REQUIRED_SMART_ORDER_TABLES].sort(),
        );
        expect(Object.values(status.counts)).toEqual(
            expect.arrayContaining(Array(REQUIRED_SMART_ORDER_TABLES.length).fill(0)),
        );
        expect(permissionBits((await stat(databasePath)).mode)).toBe(0o600);
        for (const suffix of ['-wal', '-shm']) {
            expect(permissionBits((await stat(`${databasePath}${suffix}`)).mode)).toBe(0o600);
        }

        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath);
        expect(database.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe(
            'ok',
        );
        expect(database.prepare('PRAGMA foreign_key_check').get()).toBeUndefined();
        database.close();
    });

    it('rolls back activation and intent when reservation validation fails', async () => {
        const { client } = await openRepository();
        await client.request('insertStrategy', strategyInput());

        await expect(
            client.request(
                'prepareIntent',
                preparedIntentInput({
                    reservation: { accountIdRef: 'different-account' },
                }),
            ),
        ).rejects.toThrow('reservation scope must match');
        const afterRollback = await client.request('status');
        expect(afterRollback.counts.activations).toBe(0);
        expect(afterRollback.counts.order_intents).toBe(0);
        expect(afterRollback.counts.entry_exposure_reservations).toBe(0);

        await expect(
            client.request('prepareIntent', preparedIntentInput()),
        ).resolves.toMatchObject({
            intentId: 'intent-1',
            state: 'prepared',
            replayed: false,
        });
    });

    it('rejects a scheduled quantity intent at the central repository boundary', async () => {
        const { client } = await openRepository();
        await client.request(
            'insertStrategy',
            strategyInput({ strategyKind: 'scheduled_quantity' }),
        );

        await expect(
            client.request('prepareIntent', preparedIntentInput()),
        ).rejects.toThrow(/scheduled quantity intent is disabled/);
        expect((await client.request('status')).counts).toMatchObject({
            activations: 0,
            order_intents: 0,
            entry_exposure_reservations: 0,
        });
    });

    it('fails closed when an exposure-increasing intent has no trusted current arbiter head', async () => {
        const { client, databasePath } = await openRepository({
            testOnlyExposureArbiterHeads: undefined,
            testOnlyExposureClockNowEpochMs: undefined,
        });
        await client.request('insertStrategy', strategyInput());
        await expect(
            client.request('prepareIntent', preparedIntentInput()),
        ).rejects.toThrow('current account and identity exposure heads are required');
        expect((await client.request('status')).counts).toMatchObject({
            activations: 0,
            order_intents: 0,
            entry_exposure_reservations: 0,
        });
    });

    it('rejects an expired exposure source head using the worker clock, not caller time', async () => {
        const { client, databasePath } = await openRepository({
            testOnlyExposureArbiterHeads: [
                defaultExposureArbiterHead({
                    observedAtEpochMs: TEST_EXPOSURE_NOW_EPOCH_MS - 5_000,
                    validUntilEpochMs: TEST_EXPOSURE_NOW_EPOCH_MS - 1,
                }),
            ],
        });
        await client.request('insertStrategy', strategyInput());
        await expect(
            client.request(
                'prepareIntent',
                preparedIntentInput({ nowEpochMs: 1 }),
            ),
        ).rejects.toThrow('future-dated or expired');
        expect((await client.request('status')).counts.order_intents).toBe(0);
    });

    it('rejects conflicting same-lineage exposure heads instead of silently keeping the first', async () => {
        const first = defaultExposureArbiterHead();
        const conflicting = defaultExposureArbiterHead({
            account: {
                baseline: { ...first.account.baseline },
                limits: {
                    ...first.account.limits,
                    quantityShares: first.account.limits.quantityShares - 1,
                },
            },
        });
        const databasePath = await temporaryDatabasePath();
        const expectation = await prepareRepositoryExpectation(databasePath);
        const client = new SmartOrderRepositoryClient({
            databasePath,
            ...expectation,
            testOnlyExposureArbiterHeads: [first, conflicting],
            testOnlyExposureClockNowEpochMs: TEST_EXPOSURE_NOW_EPOCH_MS,
        });
        openClients.add(client);
        await expect(client.ready()).rejects.toThrow(
            'conflicting test exposure account head',
        );
    });

    it('fails startup when durable account and identity exposure heads drift apart', async () => {
        const { client, databasePath } = await openRepository();
        await client.close();
        openClients.delete(client);
        const tampered = new DatabaseSync(databasePath);
        tampered.prepare(`
            UPDATE exposure_account_arbiter_heads
               SET policy_revision=policy_revision || '-tampered'
             WHERE account_broker_ref='broker-A' AND account_id_ref='account-A'
        `).run();
        tampered.close();
        const expectation = await prepareRepositoryExpectation(databasePath, true);
        const reopened = new SmartOrderRepositoryClient({
            databasePath,
            ...expectation,
        });
        openClients.add(reopened);
        await expect(reopened.ready()).rejects.toThrow(
            'account and identity exposure head integrity failed',
        );
    });

    it('requires manual and automated Buy place intents to reserve current policy exposure', async () => {
        const { client } = await openRepository();
        await client.request('insertStrategy', strategyInput());
        await expect(
            client.request(
                'prepareIntent',
                preparedIntentInput({
                    intent: {
                        ownerKind: 'manual_request',
                        clientRequestId: 'manual-buy-without-reservation',
                    },
                    reservation: null,
                }),
            ),
        ).rejects.toThrow('requires an atomic reservation');
        await expect(
            client.request(
                'prepareIntent',
                preparedIntentInput({
                    intent: { clientRequestId: 'stale-policy-intent' },
                    reservation: {
                        reservationId: 'stale-policy-reservation',
                        policyRevision: 'risk-policy/stale',
                    },
                }),
            ),
        ).rejects.toThrow('reservation policy is not the current exposure policy');
        expect((await client.request('status')).counts).toMatchObject({
            activations: 0,
            order_intents: 0,
            entry_exposure_reservations: 0,
        });
    });

    it('rejects a Sell place that lacks an exact current ExitClaim', async () => {
        const { client } = await openRepository();
        await client.request('insertStrategy', strategyInput());
        await expect(
            client.request(
                'prepareIntent',
                preparedIntentInput({
                    intent: {
                        intentId: 'unclaimed-sell-intent',
                        clientRequestId: 'unclaimed-sell-request',
                        side: 'Sell',
                    },
                    reservation: null,
                }),
            ),
        ).rejects.toThrow('requires an exact current ExitClaim');
        expect((await client.request('status')).counts).toMatchObject({
            activations: 0,
            order_intents: 0,
            exit_claims: 0,
        });
    });

    it('requires a complete current visibility head before reserving any Sell claim', async () => {
        const databasePath = await createMonitoringExitClaimFixture({
            externalHeads: [],
        });
        const reopened = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: undefined,
        });
        await expect(
            reopened.client.request('prepareIntent', protectiveSellIntent()),
        ).rejects.toThrow(
            'complete current external working-sell visibility is required',
        );
        expect((await reopened.client.request('status')).counts).toMatchObject({
            order_intents: 1,
            exit_claims: 1,
        });
    });

    it('rejects an expired complete working-sell head using the worker clock', async () => {
        const databasePath = await createMonitoringExitClaimFixture({
            externalHeads: [
                defaultExternalSellVisibilityHead({
                    validUntilEpochMs:
                        TEST_VISIBILITY_OBSERVED_AT_EPOCH_MS + 500,
                }),
            ],
        });
        const reopened = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: undefined,
        });
        await expect(
            reopened.client.request('prepareIntent', protectiveSellIntent()),
        ).rejects.toThrow(
            'external working-sell visibility is future-dated or expired',
        );
    });

    it('blocks reduce-only classification when any external working sell is unknown', async () => {
        const unknownClaim = externalWorkingClaim({
            exitClaimId: 'external-working-unknown',
            state: 'unknown',
        });
        const databasePath = await createMonitoringExitClaimFixture({
            externalHeads: [
                defaultExternalSellVisibilityHead({ claims: [unknownClaim] }),
            ],
        });
        const reopened = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: undefined,
        });
        await expect(
            reopened.client.request('prepareIntent', protectiveSellIntent()),
        ).rejects.toThrow(
            'unknown external working sell cannot prove reduce-only capacity',
        );
    });

    it('counts every pre-runtime external working sell as a distinct claim', async () => {
        const claims = [
            externalWorkingClaim({
                exitClaimId: 'external-working-A',
                quantityShares: 1_000,
            }),
            externalWorkingClaim({
                exitClaimId: 'external-working-B',
                allocationStartShare: 2_000,
                quantityShares: 1_000,
                evidenceHash: DIGEST_A,
            }),
        ];
        const blockedPath = await createMonitoringExitClaimFixture({
            externalHeads: [
                defaultExternalSellVisibilityHead({
                    positionShares: 2_500,
                    claims,
                }),
            ],
        });
        const blocked = await openRepository({
            databasePath: blockedPath,
            testOnlyExternalSellVisibilityHeads: undefined,
        });
        await expect(
            blocked.client.request('prepareIntent', protectiveSellIntent()),
        ).rejects.toThrow(
            'distinct active ExitClaims exceed the confirmed long position',
        );
        await blocked.client.close();
        openClients.delete(blocked.client);

        const allowedPath = await createMonitoringExitClaimFixture({
            externalHeads: [
                defaultExternalSellVisibilityHead({
                    positionShares: 3_000,
                    claims,
                }),
            ],
        });
        const allowed = await openRepository({
            databasePath: allowedPath,
            testOnlyExternalSellVisibilityHeads: undefined,
        });
        await expect(
            allowed.client.request('prepareIntent', protectiveSellIntent()),
        ).resolves.toMatchObject({
            intentId: 'visibility-sell-intent',
            exitClaimId: 'visibility-internal-claim',
        });
        await allowed.client.close();
        openClients.delete(allowed.client);
        const verified = new DatabaseSync(allowedPath, { readOnly: true });
        expect(
            verified
                .prepare(`
                    SELECT COUNT(*) AS count FROM exit_claims
                     WHERE external_lineage=1 AND state='broker_working'
                `)
                .get()?.count,
        ).toBe(2);
        expect(
            verified
                .prepare(`
                    SELECT binding_kind, source_revision, source_sequence,
                           position_revision, position_shares
                      FROM exit_claim_visibility_bindings
                     WHERE exit_claim_id='visibility-internal-claim'
                `)
                .get(),
        ).toEqual({
            binding_kind: 'internal_prepared',
            source_revision: 'external-sell-source/1',
            source_sequence: 1,
            position_revision: 'position/1',
            position_shares: 3_000,
        });
        verified.close();
    });

    it('rejects overlapping claim intervals even when the aggregate fits the position', async () => {
        const claims = [
            externalWorkingClaim({
                exitClaimId: 'external-overlap-A',
                allocationStartShare: 500,
                quantityShares: 1_000,
            }),
            externalWorkingClaim({
                exitClaimId: 'external-overlap-B',
                allocationStartShare: 1_000,
                quantityShares: 1_000,
                evidenceHash: DIGEST_A,
            }),
        ];
        const databasePath = await createMonitoringExitClaimFixture({
            externalHeads: [
                defaultExternalSellVisibilityHead({
                    positionShares: 10_000,
                    claims,
                }),
            ],
        });
        const reopened = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: undefined,
        });
        await expect(
            reopened.client.request('prepareIntent', protectiveSellIntent()),
        ).rejects.toThrow('active ExitClaim allocation intervals overlap');
    });

    it('never treats a caller-created external claim as complete-set authority', async () => {
        const databasePath = await createMonitoringExitClaimFixture();
        const reopened = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: undefined,
        });
        await reopened.client.request('createExternalExitClaim', {
            ...externalWorkingClaim({ exitClaimId: 'caller-external-claim' }),
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            contractKey: 'TSE:2330:STK:Common',
            nowEpochMs: 1_786_377_600_250,
        });
        await expect(
            reopened.client.request('prepareIntent', protectiveSellIntent()),
        ).rejects.toThrow(
            'external working sell lacks the exact current complete-set binding',
        );
    });

    it('atomically records the exact Task 0.3c restarted external working set without marking Runtime ready', async () => {
        const opened = await openRepository({
            testOnlyExternalSellVisibilityHeads: [],
        });
        const runtime = runtimeEpochInput({
            runtimeEpochId: 'task-0-3c-runtime',
            senderFence: 'task-0-3c-fence',
            apiGeneration: 'simulation:task-0-3c',
            nowEpochMs: 1_787_796_000_000,
        });
        await opened.client.request('startRuntimeEpoch', runtime);
        const accountScopeSha256 = `sha256:${createHash('sha256')
            .update(
                `smart-order-reconciliation-account\u001f${canonicalJson([
                    'broker-A',
                    'account-A',
                    'S',
                ])}`,
            )
            .digest('hex')}`;
        const claim = (brokerOrderId) => ({
            brokerOrderId,
            evidenceHash: DIGEST_B,
            exitClaimId: `external-sell-claim:${createHash('sha256')
                .update(
                    canonicalJson([
                        accountScopeSha256,
                        '2026-08-27',
                        brokerOrderId,
                        'TSE:2330:STK:Common',
                    ]),
                )
                .digest('hex')}`,
            quantityShares: 1_000,
        });
        await expect(
            opened.client.request('recordTask03cExternalWorkingSet', {
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                accountScopeSha256,
                apiGeneration: runtime.apiGeneration,
                claims: [claim('external-order-1'), claim('external-order-2')],
                contractKey: 'TSE:2330:STK:Common',
                nowEpochMs: 1_787_796_001_100,
                observedAtEpochMs: 1_787_796_001_000,
                positionLineageId: 'task-0-3c-position',
                positionRevision: DIGEST_A,
                positionShares: 7_000,
                runtimeEpochId: runtime.runtimeEpochId,
                senderFence: runtime.senderFence,
                sourceEvidenceHash: DIGEST_B,
                sourceRevision: DIGEST_A,
                sourceSequence: 1,
                tradeDate: '2026-08-27',
                validUntilEpochMs: 1_787_796_006_000,
            }),
        ).resolves.toMatchObject({
            state: 'recorded',
            externalSellClaimCount: 2,
            visibilityRevision: 0,
            brokerWriteAuthority: false,
        });
        const inspected = new DatabaseSync(opened.databasePath, {
            readOnly: true,
        });
        expect(
            inspected.prepare(`
                SELECT COUNT(*) AS count FROM exit_claims
                 WHERE external_lineage=1 AND state='broker_working'
            `).get().count,
        ).toBe(2);
        expect(
            inspected.prepare(`
                SELECT state, reconciliation_evidence_hash
                  FROM runtime_epochs WHERE runtime_epoch_id=?
            `).get(runtime.runtimeEpochId),
        ).toEqual({ state: 'reconciling', reconciliation_evidence_hash: null });
        inspected.close();
    });

    it('invalidates a queued Sell intent when a newer complete working set arrives', async () => {
        const databasePath = await createMonitoringExitClaimFixture();
        const prepared = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: undefined,
        });
        await prepareReadyVisibilitySell(prepared.client);
        await prepared.client.close();
        openClients.delete(prepared.client);

        const external = externalWorkingClaim({
            exitClaimId: 'external-arrived-in-queue',
            quantityShares: 500,
        });
        const workingSetHash = externalWorkingSetHash([external]);
        const update = new DatabaseSync(databasePath);
        update.exec('PRAGMA foreign_keys=ON');
        update.prepare(`
            UPDATE external_sell_visibility_heads
               SET source_revision='external-sell-source/2',
                   source_sequence=2, source_evidence_hash=?,
                   position_revision='position/2', position_shares=1500,
                   working_set_hash=?, updated_at_epoch_ms=1786377600400,
                   revision=revision+1
             WHERE account_broker_ref='broker-A' AND account_id_ref='account-A'
               AND trade_date='2026-08-11'
               AND contract_key='TSE:2330:STK:Common'
        `).run(DIGEST_B, workingSetHash);
        update.prepare(`
            INSERT INTO exit_claims(
                exit_claim_id, obligation_id, intent_id, external_lineage,
                account_broker_ref, account_id_ref, contract_key,
                position_lineage_id, remainder_generation,
                allocation_start_share, quantity_shares, state,
                evidence_hash, created_at_epoch_ms, updated_at_epoch_ms, revision
            ) VALUES (?, NULL, NULL, 1, 'broker-A', 'account-A',
                      'TSE:2330:STK:Common', ?, ?, ?, ?, 'broker_working',
                      ?, 1786377600400, 1786377600400, 0)
        `).run(
            external.exitClaimId,
            external.positionLineageId,
            external.remainderGeneration,
            external.allocationStartShare,
            external.quantityShares,
            external.evidenceHash,
        );
        update.prepare(`
            INSERT INTO exit_claim_visibility_bindings(
                exit_claim_id, account_broker_ref, account_id_ref,
                trade_date, contract_key, source_revision, source_sequence,
                source_evidence_hash, position_revision,
                position_shares, working_set_hash, binding_kind,
                visibility_head_revision,
                created_at_epoch_ms, updated_at_epoch_ms, revision
            ) VALUES (?, 'broker-A', 'account-A', '2026-08-11',
                      'TSE:2330:STK:Common', 'external-sell-source/2', 2,
                      ?, 'position/2', 1500, ?, 'external_projection', 1,
                      1786377600400, 1786377600400, 0)
        `).run(external.exitClaimId, DIGEST_B, workingSetHash);
        update.close();

        const queued = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: undefined,
        });
        await expect(
            queued.client.request(
                'markIntentDispatching',
                dispatchInput({
                    intentId: 'visibility-sell-intent',
                    expectedReservationRevision: undefined,
                    rearmAuthorizationId: 'visibility-sell-rearm',
                    dispatchAttemptNonce: 'visibility-sell-dispatch',
                }),
            ),
        ).rejects.toThrow(
            'Sell intent external visibility binding is stale or missing',
        );
        const inspect = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            inspect
                .prepare(`
                    SELECT state, adapter_authority_granted
                      FROM order_intents
                     WHERE intent_id='visibility-sell-intent'
                `)
                .get(),
        ).toEqual({
            state: 'cancelled_proven_unsent',
            adapter_authority_granted: 0,
        });
        expect(
            inspect.prepare(`
                SELECT state FROM strategies WHERE strategy_id='strategy-1'
            `).get()?.state,
        ).toBe('manual_intervention');
        expect(
            inspect.prepare(`
                SELECT state FROM activations
                 WHERE activation_id='visibility-sell-activation'
            `).get()?.state,
        ).toBe('cancelled');
        expect(
            inspect.prepare(`
                SELECT state FROM intent_rearm_authorizations
                 WHERE rearm_authorization_id='visibility-sell-rearm'
            `).get()?.state,
        ).toBe('superseded');
        expect(
            inspect.prepare(`
                SELECT state FROM exit_claims
                 WHERE exit_claim_id='visibility-internal-claim'
            `).get()?.state,
        ).toBe('released');
        expect(
            inspect.prepare(`
                SELECT state FROM protection_obligations
                 WHERE obligation_id='visibility-obligation'
            `).get()?.state,
        ).toBe('safety_blocked');
        expect(
            inspect.prepare(`
                SELECT cases.reason_code, cases.state AS case_state,
                       blockers.reason_code AS blocker_reason,
                       blockers.state AS blocker_state
                  FROM resolution_cases AS cases
                  JOIN safety_blockers AS blockers
                    ON blockers.resolution_case_id=cases.resolution_case_id
                 WHERE cases.strategy_id='strategy-1'
            `).get(),
        ).toEqual({
            reason_code: 'EXTERNAL_POSITION_DRIFT',
            case_state: 'open',
            blocker_reason: 'EXTERNAL_POSITION_DRIFT',
            blocker_state: 'open',
        });
        inspect.close();
    });

    it('invalidates a queued Sell intent when its trusted visibility expires before dispatch', async () => {
        const databasePath = await createMonitoringExitClaimFixture();
        const queued = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: undefined,
            testOnlyExposureClockAdvanceToEpochMs:
                TEST_VISIBILITY_OBSERVED_AT_EPOCH_MS + 6_000,
        });
        await prepareReadyVisibilitySell(queued.client);
        await expect(
            queued.client.request(
                'markIntentDispatching',
                dispatchInput({
                    intentId: 'visibility-sell-intent',
                    expectedReservationRevision: undefined,
                    rearmAuthorizationId: 'visibility-sell-rearm',
                    dispatchAttemptNonce: 'visibility-sell-expired-dispatch',
                }),
            ),
        ).rejects.toThrow(
            'external working-sell visibility is future-dated or expired',
        );
        await queued.client.close();
        openClients.delete(queued.client);
        const inspect = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            inspect.prepare(`
                SELECT intents.state AS intent_state,
                       intents.adapter_authority_granted,
                       activations.state AS activation_state,
                       strategies.state AS strategy_state,
                       rearms.state AS rearm_state
                  FROM order_intents AS intents
                  JOIN activations
                    ON activations.activation_id=intents.activation_id
                  JOIN strategies
                    ON strategies.strategy_id=intents.strategy_id
                  JOIN intent_rearm_authorizations AS rearms
                    ON rearms.intent_id=intents.intent_id
                 WHERE intents.intent_id='visibility-sell-intent'
            `).get(),
        ).toEqual({
            intent_state: 'cancelled_proven_unsent',
            adapter_authority_granted: 0,
            activation_state: 'cancelled',
            strategy_state: 'manual_intervention',
            rearm_state: 'superseded',
        });
        expect(
            inspect.prepare(`
                SELECT COUNT(*) AS count
                  FROM resolution_cases AS cases
                  JOIN safety_blockers AS blockers
                    ON blockers.resolution_case_id=cases.resolution_case_id
                 WHERE cases.strategy_id='strategy-1'
                   AND cases.reason_code='EXTERNAL_POSITION_DRIFT'
                   AND cases.state='open' AND blockers.state='open'
            `).get()?.count,
        ).toBe(1);
        inspect.close();
    });

    it('invalidates a queued Sell intent when only the current head revision advances', async () => {
        const databasePath = await createMonitoringExitClaimFixture();
        const queued = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: undefined,
        });
        await prepareReadyVisibilitySell(queued.client);
        await queued.client.close();
        openClients.delete(queued.client);

        const update = new DatabaseSync(databasePath);
        update.prepare(`
            UPDATE external_sell_visibility_heads
               SET revision=revision+1, updated_at_epoch_ms=1786377600400
             WHERE account_broker_ref='broker-A'
               AND account_id_ref='account-A'
               AND trade_date='2026-08-11'
               AND contract_key='TSE:2330:STK:Common'
        `).run();
        update.close();

        const reopened = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: undefined,
        });
        await expect(
            reopened.client.request(
                'markIntentDispatching',
                dispatchInput({
                    intentId: 'visibility-sell-intent',
                    expectedReservationRevision: undefined,
                    rearmAuthorizationId: 'visibility-sell-rearm',
                    dispatchAttemptNonce: 'visibility-sell-head-revision',
                }),
            ),
        ).rejects.toThrow(
            'Sell intent external visibility binding is stale or missing',
        );
    });

    it('revokes a granted Sell envelope when the position head advances before adapter use', async () => {
        const databasePath = await createMonitoringExitClaimFixture();
        const opened = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: undefined,
        });
        await prepareReadyVisibilitySell(opened.client);
        const dispatch = dispatchInput({
            intentId: 'visibility-sell-intent',
            expectedReservationRevision: undefined,
            rearmAuthorizationId: 'visibility-sell-rearm',
            dispatchAttemptNonce: 'visibility-sell-toctou-dispatch',
        });
        const granted = await opened.client.request(
            'markIntentDispatching',
            dispatch,
        );
        await expect(
            opened.client.request('verifyDispatchGrant', {
                ...dispatch,
                expectedRevision: 0,
                revision: granted.revision,
                activationRevision: granted.activationRevision,
                rearmRevision: granted.rearmRevision,
            }),
        ).resolves.toMatchObject({ authorized: true });

        const advanced = new DatabaseSync(databasePath);
        advanced.exec('PRAGMA busy_timeout=2500');
        advanced.prepare(`
            UPDATE external_sell_visibility_heads
               SET position_revision='position/2', position_shares=999999,
                   revision=revision+1,
                   updated_at_epoch_ms=1786377600400
             WHERE account_broker_ref='broker-A'
               AND account_id_ref='account-A'
               AND trade_date='2026-08-11'
               AND contract_key='TSE:2330:STK:Common'
        `).run();
        advanced.close();

        await expect(
            opened.client.request('verifyDispatchGrant', {
                ...dispatch,
                revision: granted.revision,
                activationRevision: granted.activationRevision,
                rearmRevision: granted.rearmRevision,
            }),
        ).resolves.toEqual({ authorized: false });
    });

    it('atomically advances the same internal ExitClaim when canonical broker evidence becomes working', async () => {
        const identifierKinds = ['tradeId', 'orderId', 'seqno', 'ordno'];
        const databasePath = await createMonitoringExitClaimFixture({
            contractUnit: 500,
            openOptions: {
                testOnlyBrokerCorrelationIdentifierKinds: identifierKinds,
            },
        });
        const opened = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: undefined,
            testOnlyBrokerCorrelationIdentifierKinds: identifierKinds,
        });
        await prepareReadyVisibilitySell(opened.client, { contractUnit: 500 });
        const dispatch = dispatchInput({
            intentId: 'visibility-sell-intent',
            expectedReservationRevision: undefined,
            rearmAuthorizationId: 'visibility-sell-rearm',
            dispatchAttemptNonce: 'visibility-sell-broker-working',
        });
        await opened.client.request('markIntentDispatching', dispatch);
        const event = protectiveExitBrokerEvent({ order: 2 });
        await opened.client.request('addBrokerCorrelation', {
            correlationId: 'visibility-sell-correlation',
            intentId: 'visibility-sell-intent',
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            tradeDate: '2026-08-11',
            contractKey: 'TSE:2330:STK:Common',
            side: 'Sell',
            tradeId: event.identifiers.tradeId,
            orderId: event.identifiers.orderId,
            seqno: event.identifiers.seqno,
            ordno: event.identifiers.ordno,
            evidenceHash: DIGEST_A,
            createdAtEpochMs: 1_786_377_600_450,
        });
        await expect(
            opened.client.request('recordCanonicalBrokerEvent', {
                runtimeEpochId: 'runtime-epoch-1',
                senderFence: 'sender-fence-1',
                apiGeneration: 'api-generation-1',
                event: protectiveExitBrokerEvent({ order: 3 }),
            }),
        ).rejects.toThrow(
            'broker event quantity does not match its durable ExitClaim',
        );
        const conflicted = new DatabaseSync(databasePath);
        expect(
            conflicted
                .prepare('SELECT COUNT(*) AS count FROM broker_event_records')
                .get(),
        ).toEqual({ count: 0 });
        expect(
            conflicted.prepare(`
                SELECT state, revision FROM exit_claims
                 WHERE exit_claim_id='visibility-internal-claim'
            `).get(),
        ).toEqual({ state: 'intent_reserved', revision: 1 });
        conflicted.prepare(`
            INSERT INTO exit_claims(
                exit_claim_id, obligation_id, intent_id, external_lineage,
                account_broker_ref, account_id_ref, contract_key,
                position_lineage_id, remainder_generation,
                allocation_start_share, quantity_shares, state,
                evidence_hash, created_at_epoch_ms, updated_at_epoch_ms, revision
            ) VALUES (
                'visibility-conflicting-claim', 'visibility-obligation',
                'visibility-sell-intent', 0, 'broker-A', 'account-A',
                'TSE:2330:STK:Common', 'visibility-position-lineage', 0,
                1000, 1000, 'intent_reserved', ?,
                1786377600450, 1786377600450, 0
            )
        `).run(DIGEST_B);
        conflicted.close();
        await expect(
            opened.client.request('recordCanonicalBrokerEvent', {
                runtimeEpochId: 'runtime-epoch-1',
                senderFence: 'sender-fence-1',
                apiGeneration: 'api-generation-1',
                event,
            }),
        ).rejects.toThrow(
            'broker event intent has multiple durable ExitClaim lineages',
        );
        const afterConflict = new DatabaseSync(databasePath);
        expect(
            afterConflict
                .prepare('SELECT COUNT(*) AS count FROM broker_event_records')
                .get(),
        ).toEqual({ count: 0 });
        expect(
            afterConflict.prepare(`
                SELECT state, revision FROM exit_claims
                 WHERE exit_claim_id='visibility-internal-claim'
            `).get(),
        ).toEqual({ state: 'intent_reserved', revision: 1 });
        afterConflict.prepare(`
            DELETE FROM exit_claims
             WHERE exit_claim_id='visibility-conflicting-claim'
        `).run();
        afterConflict.close();
        const accepted = await opened.client.request(
            'recordCanonicalBrokerEvent',
            {
                runtimeEpochId: 'runtime-epoch-1',
                senderFence: 'sender-fence-1',
                apiGeneration: 'api-generation-1',
                event,
            },
        );
        expect(accepted).toMatchObject({
            state: 'accepted',
            intentId: 'visibility-sell-intent',
            exitClaimProjection: {
                exitClaimId: 'visibility-internal-claim',
                state: 'broker_working',
                revision: 2,
                transitioned: true,
            },
            brokerWriteAuthority: false,
        });
        await expect(
            opened.client.request('recordCanonicalBrokerEvent', {
                runtimeEpochId: 'runtime-epoch-1',
                senderFence: 'sender-fence-1',
                apiGeneration: 'api-generation-1',
                event,
            }),
        ).resolves.toMatchObject({
            state: 'duplicate',
            exitClaimProjection: {
                exitClaimId: 'visibility-internal-claim',
                state: 'broker_working',
                revision: 2,
                transitioned: false,
            },
        });
        await opened.client.close();
        openClients.delete(opened.client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database.prepare(`
                SELECT intent_id, state, quantity_shares, evidence_hash,
                       terminal_at_epoch_ms, revision
                  FROM exit_claims
                 WHERE exit_claim_id='visibility-internal-claim'
            `).get(),
        ).toEqual({
            intent_id: 'visibility-sell-intent',
            state: 'broker_working',
            quantity_shares: 1_000,
            evidence_hash: event.brokerEventEvidenceSha256,
            terminal_at_epoch_ms: null,
            revision: 2,
        });
        expect(
            database.prepare(`
                SELECT COUNT(*) AS count FROM event_journal
                 WHERE entity_kind='exit_claim'
                   AND entity_id='visibility-internal-claim'
                   AND reason_code='EXIT_CLAIM_BROKER_WORKING'
            `).get(),
        ).toEqual({ count: 1 });
        database.close();
    });

    it.each([
        {
            terminalEvent: {
                eventKind: 'deal',
                status: 'PartFilled',
                cumulativeDeal: 1,
                cumulativeCancel: 0,
                remaining: 1,
                eventDeal: 1,
                dealId: 'protective-exit-deal-1',
                exchangeSequence: 'protective-exit-exchange-1',
                price: '100',
            },
            expectedState: 'unknown',
            expectedReason: 'EXIT_CLAIM_UNKNOWN',
        },
        {
            terminalEvent: {
                status: 'Filled',
                cumulativeDeal: 2,
                cumulativeCancel: 0,
                remaining: 0,
            },
            expectedState: 'unknown',
            expectedReason: 'EXIT_CLAIM_UNKNOWN',
        },
        {
            terminalEvent: {
                status: 'Cancelled',
                cumulativeDeal: 0,
                cumulativeCancel: 2,
                remaining: 0,
            },
            expectedState: 'unknown',
            expectedReason: 'EXIT_CLAIM_UNKNOWN',
        },
    ])(
        'projects broker deal or terminal evidence onto the same internal ExitClaim as $expectedState',
        async ({ terminalEvent, expectedState, expectedReason }) => {
            const identifierKinds = ['tradeId', 'orderId', 'seqno', 'ordno'];
            const databasePath = await createMonitoringExitClaimFixture({
                contractUnit: 500,
                openOptions: {
                    testOnlyBrokerCorrelationIdentifierKinds: identifierKinds,
                },
            });
            const opened = await openRepository({
                databasePath,
                testOnlyExternalSellVisibilityHeads: undefined,
                testOnlyBrokerCorrelationIdentifierKinds: identifierKinds,
            });
            await prepareReadyVisibilitySell(opened.client, { contractUnit: 500 });
            await opened.client.request(
                'markIntentDispatching',
                dispatchInput({
                    intentId: 'visibility-sell-intent',
                    expectedReservationRevision: undefined,
                    rearmAuthorizationId: 'visibility-sell-rearm',
                    dispatchAttemptNonce: `visibility-sell-${expectedState}`,
                }),
            );
            const working = protectiveExitBrokerEvent({ order: 2 });
            const terminal = protectiveExitBrokerEvent({
                order: 2,
                exchangeEpochMs: 1_786_377_600_600,
                ...terminalEvent,
            });
            await opened.client.request('addBrokerCorrelation', {
                correlationId: `visibility-sell-correlation-${expectedState}`,
                intentId: 'visibility-sell-intent',
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                tradeDate: '2026-08-11',
                contractKey: 'TSE:2330:STK:Common',
                side: 'Sell',
                tradeId: working.identifiers.tradeId,
                orderId: working.identifiers.orderId,
                seqno: working.identifiers.seqno,
                ordno: working.identifiers.ordno,
                evidenceHash: DIGEST_A,
                createdAtEpochMs: 1_786_377_600_450,
            });
            await opened.client.request('recordCanonicalBrokerEvent', {
                runtimeEpochId: 'runtime-epoch-1',
                senderFence: 'sender-fence-1',
                apiGeneration: 'api-generation-1',
                event: working,
            });
            await expect(
                opened.client.request('recordCanonicalBrokerEvent', {
                    runtimeEpochId: 'runtime-epoch-1',
                    senderFence: 'sender-fence-1',
                    apiGeneration: 'api-generation-1',
                    event: terminal,
                }),
            ).resolves.toMatchObject({
                state: 'accepted',
                exitClaimProjection: {
                    exitClaimId: 'visibility-internal-claim',
                    state: expectedState,
                    revision: 3,
                    transitioned: true,
                },
                brokerWriteAuthority: false,
            });
            await opened.client.close();
            openClients.delete(opened.client);
            const database = new DatabaseSync(databasePath, { readOnly: true });
            expect(
                database.prepare(`
                    SELECT state, terminal_at_epoch_ms, revision
                      FROM exit_claims
                     WHERE exit_claim_id='visibility-internal-claim'
                `).get(),
            ).toEqual({
                state: expectedState,
                terminal_at_epoch_ms: null,
                revision: 3,
            });
            expect(
                database.prepare(`
                    SELECT COUNT(*) AS count FROM event_journal
                     WHERE entity_kind='exit_claim'
                       AND entity_id='visibility-internal-claim'
                       AND reason_code=?
                `).get(expectedReason),
            ).toEqual({ count: 1 });
            database.close();
        },
    );

    it('settles a cancel/fill race into one same-lineage partial-fill remainder generation without automatic redispatch', async () => {
        const identifierKinds = ['tradeId', 'orderId', 'seqno', 'ordno'];
        const existingPositionPlan = existingPositionPlanForVisibility({
            contractUnit: 500,
        });
        const databasePath = await createMonitoringExitClaimFixture({
            contractUnit: 500,
            existingPositionPlan,
            openOptions: {
                testOnlyBrokerCorrelationIdentifierKinds: identifierKinds,
            },
        });
        const opened = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: undefined,
            testOnlyBrokerCorrelationIdentifierKinds: identifierKinds,
        });
        await prepareReadyVisibilitySell(opened.client, {
            contractUnit: 500,
            protectionPlan: existingPositionPlan.plan,
        });
        await opened.client.request(
            'markIntentDispatching',
            dispatchInput({
                intentId: 'visibility-sell-intent',
                expectedReservationRevision: undefined,
                rearmAuthorizationId: 'visibility-sell-rearm',
                dispatchAttemptNonce: 'visibility-sell-cancel-fill-race',
            }),
        );
        const working = protectiveExitBrokerEvent({ order: 2 });
        const racingFill = protectiveExitBrokerEvent({
            order: 2,
            eventKind: 'deal',
            status: 'PartFilled',
            cumulativeDeal: 1,
            cumulativeCancel: 0,
            remaining: 1,
            eventDeal: 1,
            dealId: 'protective-exit-deal-1',
            exchangeSequence: 'protective-exit-exchange-1',
            exchangeEpochMs: 1_786_377_600_600,
            price: '100',
        });
        const finalCancel = protectiveExitBrokerEvent({
            order: 2,
            status: 'Cancelled',
            cumulativeDeal: 1,
            cumulativeCancel: 1,
            remaining: 0,
            exchangeEpochMs: 1_786_377_600_700,
        });
        await opened.client.request('addBrokerCorrelation', {
            correlationId: 'visibility-sell-cancel-fill-correlation',
            intentId: 'visibility-sell-intent',
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            tradeDate: '2026-08-11',
            contractKey: 'TSE:2330:STK:Common',
            side: 'Sell',
            tradeId: working.identifiers.tradeId,
            orderId: working.identifiers.orderId,
            seqno: working.identifiers.seqno,
            ordno: working.identifiers.ordno,
            evidenceHash: DIGEST_A,
            createdAtEpochMs: 1_786_377_600_450,
        });
        await opened.client.request('recordCanonicalBrokerEvent', {
            runtimeEpochId: 'runtime-epoch-1',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            event: working,
        });
        await opened.client.request('recordCanonicalBrokerEvent', {
            runtimeEpochId: 'runtime-epoch-1',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            event: racingFill,
        });
        await expect(
            opened.client.request('recordCanonicalBrokerEvent', {
                runtimeEpochId: 'runtime-epoch-1',
                senderFence: 'sender-fence-1',
                apiGeneration: 'api-generation-1',
                event: finalCancel,
            }),
        ).resolves.toMatchObject({
            state: 'accepted',
            intentId: 'visibility-sell-intent',
            exitClaimProjection: {
                exitClaimId: 'visibility-internal-claim',
                state: 'unknown',
                transitioned: false,
            },
            brokerWriteAuthority: false,
        });
        const blockedUnknownRetry = protectiveSellIntent({
            activation: {
                activationId: 'visibility-unknown-retry-activation',
                logicalKey: 'visibility-unknown-retry-edge',
            },
            intent: {
                intentId: 'visibility-unknown-retry-intent',
                clientRequestId: 'visibility-unknown-retry-request',
            },
            exitClaim: {
                expectedRevision: 3,
                expectedGroupRevision: 3,
                expectedGenerationRevision: 3,
            },
        });
        Object.assign(blockedUnknownRetry, {
            runtimeEpochId: 'runtime-epoch-1',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
        });
        await expect(
            opened.client.request('prepareIntent', blockedUnknownRetry),
        ).rejects.toThrow(
            'existing-position protection trigger lineage is not current',
        );
        const identityAdmission = await signedIdentityAdmission({
            identityKeyPath: opened.identityKeyPath,
            issuedAtEpochMs: 1_786_377_600_800,
        });
        const bindIdentity = new DatabaseSync(databasePath);
        bindIdentity.prepare(
            "DELETE FROM repository_meta WHERE key LIKE 'authenticated_identity_account_binding:%'",
        ).run();
        bindIdentity.prepare(
            "UPDATE strategies SET identity_group_id=? WHERE strategy_id='strategy-1'",
        ).run(identityAdmission.identityGroupId);
        bindIdentity.close();
        const reconciliation = completeAccountReconciliationProjection({
            asOfEpochMs: 1_786_377_600_800,
            dealIds: ['protective-exit-deal-1'],
            positionLineageId: 'visibility-position-lineage',
            quantityShares: 500,
            availableShares: 500,
        });
        await expect(
            opened.client.request('recordAccountReconciliation', {
                runtimeEpochId: 'runtime-epoch-1',
                senderFence: 'sender-fence-1',
                apiGeneration: 'api-generation-1',
                expectedFixedAccountCount: 1,
                identityAdmission,
                nowEpochMs: 1_786_377_600_850,
                reconciliation,
            }),
        ).resolves.toMatchObject({
            protectionOcoSettledCount: 1,
            brokerWriteAuthority: false,
        });
        await opened.client.close();
        openClients.delete(opened.client);
        const verify = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verify.prepare(`
                SELECT intent_id, remainder_generation,
                       allocation_start_share, quantity_shares, state
                  FROM exit_claims
                 WHERE exit_claim_id='visibility-internal-claim'
            `).get(),
        ).toEqual({
            intent_id: null,
            remainder_generation: 1,
            allocation_start_share: 500,
            quantity_shares: 500,
            state: 'monitoring_reserved',
        });
        expect(
            verify.prepare(`
                SELECT state, current_generation
                  FROM protection_groups
                 WHERE protection_group_id=?
            `).get(VISIBILITY_PROTECTION_GROUP_ID),
        ).toEqual({ state: 'rearm_required', current_generation: 1 });
        expect(
            verify.prepare(`
                SELECT remainder_generation, state, quantity_shares,
                       winner_intent_id
                  FROM protection_remainder_generations
                 WHERE protection_group_id=?
                 ORDER BY remainder_generation
            `).all(VISIBILITY_PROTECTION_GROUP_ID),
        ).toEqual([
            {
                remainder_generation: 0,
                state: 'terminal',
                quantity_shares: 1_000,
                winner_intent_id: 'visibility-sell-intent',
            },
            {
                remainder_generation: 1,
                state: 'rearm_required',
                quantity_shares: 500,
                winner_intent_id: null,
            },
        ]);
        expect(
            verify.prepare(`
                SELECT state, terminal_outcome FROM order_intents
                 WHERE intent_id='visibility-sell-intent'
            `).get(),
        ).toEqual({
            state: 'terminal',
            terminal_outcome: 'protective_partial_fill_terminal',
        });
        expect(
            verify.prepare(`
                SELECT state, filled_shares, confirmed_exited_shares
                  FROM protection_obligations
                 WHERE obligation_id='visibility-obligation'
            `).get(),
        ).toEqual({
            state: 'partially_exited',
            filled_shares: 1_000,
            confirmed_exited_shares: 500,
        });
        expect(
            verify.prepare(`
                SELECT COUNT(*) AS count FROM intent_rearm_authorizations
                 WHERE intent_id='visibility-sell-intent' AND state='active'
            `).get(),
        ).toEqual({ count: 0 });
        expect(
            verify.prepare(`
                SELECT COUNT(*) AS count FROM exit_claims
                 WHERE obligation_id='visibility-obligation'
            `).get(),
        ).toEqual({ count: 1 });
        expect(
            verify.prepare(`
                SELECT heads.protection_plan_hash, heads.exit_claim_id,
                       json_extract(heads.formal_protection_json,
                                    '$.cumulativeFilledShares')
                           AS formal_quantity_shares,
                       strategies.state AS strategy_state
                  FROM existing_position_protection_heads
                    AS heads
                  JOIN strategies USING(strategy_id)
                 WHERE heads.strategy_id='strategy-1'
            `).get(),
        ).toEqual({
            protection_plan_hash: existingPositionPlan.planSha256,
            exit_claim_id: 'visibility-internal-claim',
            formal_quantity_shares: 500,
            strategy_state: 'paused',
        });
        expect(
            verify.prepare(`
                SELECT COUNT(*) AS count FROM order_intents
                 WHERE intent_id='visibility-unknown-retry-intent'
            `).get(),
        ).toEqual({ count: 0 });
        verify.close();
    });

    it('atomically admits at most one individually legal Buy when their account aggregate exceeds the limit', async () => {
        const constrained = defaultExposureArbiterHead({
            account: {
                baseline: {
                    quantityShares: 0,
                    notionalMinorUnits: 0,
                    cashMinorUnits: 0,
                    positionShares: 0,
                    orderCount: 0,
                },
                limits: {
                    quantityShares: 1_500,
                    notionalMinorUnits: 15_000_000,
                    cashMinorUnits: 15_000_000,
                    positionShares: 1_500,
                    orderCount: 1,
                },
            },
        });
        const { client, databasePath } = await openRepository({
            testOnlyExposureArbiterHeads: [constrained],
        });
        await client.request('insertStrategy', strategyInput());
        await client.request(
            'insertStrategy',
            strategyInput({ strategyId: 'strategy-2' }),
        );
        const candidates = [
            preparedIntentInput(),
            preparedIntentInput({
                strategyId: 'strategy-2',
                activation: { activationId: 'activation-2', logicalKey: 'edge-2' },
                intent: {
                    intentId: 'intent-2',
                    clientRequestId: 'request-2',
                },
                reservation: { reservationId: 'reservation-2' },
            }),
        ];
        const results = await Promise.allSettled(
            candidates.map((candidate) => client.request('prepareIntent', candidate)),
        );
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
        expect(results.find((result) => result.status === 'rejected')?.reason?.message)
            .toMatch(/account exposure limit exceeded/);
        expect((await client.request('status')).counts).toMatchObject({
            activations: 1,
            order_intents: 1,
            entry_exposure_reservations: 1,
        });
        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database.prepare(`
                SELECT revision FROM exposure_account_arbiter_heads
                 WHERE account_broker_ref='broker-A' AND account_id_ref='account-A'
            `).get(),
        ).toEqual({ revision: 1 });
        expect(
            database.prepare(`
                SELECT revision FROM exposure_identity_arbiter_heads
                 WHERE identity_group_id='identity-A'
            `).get(),
        ).toEqual({ revision: 1 });
        database.close();
    });

    it('uses the same account arbiter CAS for concurrent automated and manual Buy intents', async () => {
        const constrained = defaultExposureArbiterHead({
            account: {
                baseline: {
                    quantityShares: 0,
                    notionalMinorUnits: 0,
                    cashMinorUnits: 0,
                    positionShares: 0,
                    orderCount: 0,
                },
                limits: {
                    quantityShares: 1_500,
                    notionalMinorUnits: 15_000_000,
                    cashMinorUnits: 15_000_000,
                    positionShares: 1_500,
                    orderCount: 1,
                },
            },
        });
        const { client, databasePath } = await openRepository({
            testOnlyExposureArbiterHeads: [constrained],
        });
        await client.request('insertStrategy', strategyInput());
        await client.request(
            'insertStrategy',
            strategyInput({ strategyId: 'strategy-manual-buy' }),
        );
        const automated = preparedIntentInput();
        const manual = preparedIntentInput({
            strategyId: 'strategy-manual-buy',
            activation: {
                activationId: 'activation-manual-buy',
                logicalKey: 'edge-manual-buy',
            },
            intent: {
                intentId: 'intent-manual-buy',
                clientRequestId: 'request-manual-buy',
                ownerKind: 'manual_request',
            },
            reservation: { reservationId: 'reservation-manual-buy' },
        });
        const results = await Promise.allSettled([
            client.request('prepareIntent', automated),
            client.request('prepareIntent', manual),
        ]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
        expect(results.find((result) => result.status === 'rejected')?.reason?.message)
            .toMatch(/account exposure limit exceeded/);
        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database.prepare(`
                SELECT COUNT(*) AS count FROM order_intents
                 WHERE owner_kind IN ('activation','manual_request')
            `).get(),
        ).toEqual({ count: 1 });
        expect(
            database.prepare(`
                SELECT COUNT(*) AS count FROM entry_exposure_reservations
            `).get(),
        ).toEqual({ count: 1 });
        expect(
            database.prepare(`
                SELECT revision FROM exposure_account_arbiter_heads
                 WHERE account_broker_ref='broker-A' AND account_id_ref='account-A'
            `).get(),
        ).toEqual({ revision: 1 });
        database.close();
    });

    it('enforces one identity aggregate across individually legal fixed accounts', async () => {
        const base = defaultExposureArbiterHead();
        const identity = {
            baseline: { ...base.identity.baseline },
            limits: {
                quantityShares: 1_500,
                notionalMinorUnits: 15_000_000,
                cashMinorUnits: 15_000_000,
                positionShares: 1_500,
                orderCount: 1,
            },
        };
        const heads = [
            { ...base, identity },
            defaultExposureArbiterHead({
                accountIdRef: 'account-B',
                identity,
            }),
        ];
        const { client } = await openRepository({
            testOnlyExposureArbiterHeads: heads,
        });
        await client.request('insertStrategy', strategyInput());
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-B',
                accountIdRef: 'account-B',
            }),
        );
        await client.request('prepareIntent', preparedIntentInput());
        await expect(
            client.request(
                'prepareIntent',
                preparedIntentInput({
                    strategyId: 'strategy-B',
                    activation: { activationId: 'activation-B', logicalKey: 'edge-B' },
                    intent: {
                        intentId: 'intent-B',
                        clientRequestId: 'request-B',
                        accountIdRef: 'account-B',
                    },
                    reservation: {
                        reservationId: 'reservation-B',
                        accountIdRef: 'account-B',
                    },
                }),
            ),
        ).rejects.toThrow('identity exposure limit exceeded');
        expect((await client.request('status')).counts).toMatchObject({
            order_intents: 1,
            entry_exposure_reservations: 1,
        });
    });

    it('projects a redacted lifecycle drain audit and never guesses active claim coverage', async () => {
        const { client, databasePath } = await openRepository();
        await expect(client.request('lifecycleAudit', {})).resolves.toEqual({
            schemaVersion: 'smart-order-lifecycle-audit/2026-08-12.4',
            currentRuntimeState: 'absent',
            writeMaster: 'disabled',
            reconciliation: 'required_before_any_write_or_drain',
            counts: {
                non_terminal_strategies: 0,
                non_quiesced_strategies: 0,
                non_terminal_activations: 0,
                non_terminal_intents: 0,
                side_effect_intents: 0,
                proven_unsent_prepared_intents: 0,
                non_terminal_broker_orders: 0,
                non_terminal_commitments: 0,
                active_protection_obligations: 0,
                active_entry_reservations: 0,
                active_exit_claims: 0,
                unknown_exit_claims: 0,
                open_resolution_cases: 0,
                open_safety_blockers: 0,
                durable_side_effect_history: 0,
                durable_obligation_history: 0,
                reserved_entry_shares: 0,
                claimed_exit_shares: 0,
                maximum_unprotected_remainder_shares: 0,
                active_runtime_epochs: 0,
                reconciliation_blockers: 0,
            },
            runtimeTrackedUnprotectedRemainder: {
                state: 'known',
                shares: 0,
                conservativeMaximumShares: 0,
                currentAccountReconciliationRequired: false,
            },
            productionReadonlyDrainAllowed: true,
            gracefulStopAllowed: true,
            uninstallAllowed: true,
            productionReadonlyBlockerCount: 0,
            gracefulStopBlockerCount: 0,
            uninstallBlockerCount: 0,
            blockerCount: 0,
            drainRecords: [],
            drainRecordsTruncated: false,
            accountIdentifiersExposed: false,
            entityIdentifiersExposed: false,
            strategyDefinitionsExposed: false,
        });

        await startReadyRuntime(client, {
            runtimeEpochId: 'protected-entry-setup-runtime',
            senderFence: 'protected-entry-setup-fence',
            apiGeneration: 'simulation-generation/1',
        });
        await client.request('insertStrategy', strategyInput());
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                protectionCommitment: {
                    commitmentId: 'commitment-1',
                    committedShares: 1_000,
                },
                protectionObligation: {
                    obligationId: 'obligation-1',
                    positionLineageId: 'position-lineage-1',
                },
            }),
        );
        await client.close();
        openClients.delete(client);
        const seed = new DatabaseSync(databasePath);
        seed.exec('PRAGMA foreign_keys=ON');
        seed.prepare(`
            UPDATE pending_protection_commitments
               SET state='materialized', materialized_shares=1000,
                   updated_at_epoch_ms=1786377600200, revision=1
             WHERE commitment_id='commitment-1'
        `).run();
        seed.prepare(`
            UPDATE protection_obligations
               SET state='monitoring', filled_shares=1000,
                   updated_at_epoch_ms=1786377600200, revision=1
             WHERE obligation_id='obligation-1'
        `).run();
        seed.prepare(`
            INSERT INTO exit_claims(
                exit_claim_id, obligation_id, intent_id, external_lineage,
                account_broker_ref, account_id_ref, contract_key,
                position_lineage_id, remainder_generation,
                allocation_start_share, quantity_shares, state,
                evidence_hash, created_at_epoch_ms, updated_at_epoch_ms,
                revision
            ) VALUES (
                'exit-claim-lifecycle', 'obligation-1', NULL, 0,
                'broker-A', 'account-A', 'TSE:2330:STK:Common',
                'position-lineage-1', 0, 0, 1000,
                'monitoring_reserved', '${DIGEST_A}',
                1786377600200, 1786377600200, 0
            )
        `).run();
        seed.close();

        const reopened = await openRepository({
            databasePath,
            testOnlyExposureArbiterHeads: [],
        });
        const audit = await reopened.client.request('lifecycleAudit', {});
        expect(audit).toMatchObject({
            schemaVersion: 'smart-order-lifecycle-audit/2026-08-12.4',
            writeMaster: 'disabled',
            counts: {
                non_terminal_strategies: 1,
                non_terminal_activations: 1,
                non_terminal_intents: 1,
                proven_unsent_prepared_intents: 1,
                non_terminal_commitments: 0,
                active_protection_obligations: 1,
                active_entry_reservations: 1,
                active_exit_claims: 1,
                claimed_exit_shares: 1_000,
                maximum_unprotected_remainder_shares: 1_000,
                reconciliation_blockers: 0,
            },
            runtimeTrackedUnprotectedRemainder: {
                state: 'unknown',
                shares: null,
                conservativeMaximumShares: 1_000,
                currentAccountReconciliationRequired: true,
            },
            productionReadonlyDrainAllowed: false,
            gracefulStopAllowed: false,
            uninstallAllowed: false,
            drainRecordsTruncated: false,
        });
        expect(audit.drainRecords).toEqual([
            {
                ordinal: 1,
                kind: 'strategy',
                state: 'monitoring',
                quantityShares: null,
                quantityState: 'not_applicable',
                disposition: 'pause_or_cancel_strategy',
            },
            {
                ordinal: 2,
                kind: 'activation',
                state: 'prepared',
                quantityShares: null,
                quantityState: 'not_applicable',
                disposition: 'cancel_strategy_or_complete_activation',
            },
            {
                ordinal: 3,
                kind: 'prepared_intent',
                state: 'prepared',
                quantityShares: null,
                quantityState: 'not_applicable',
                disposition: 'cancel_proven_unsent_intent_and_release',
            },
            {
                ordinal: 4,
                kind: 'protection_obligation',
                state: 'monitoring',
                quantityShares: 1_000,
                quantityState: 'conservative_maximum',
                disposition:
                    'prove_zero_fill_confirmed_exit_or_break_glass',
            },
            {
                ordinal: 5,
                kind: 'entry_exposure_reservation',
                state: 'reserved',
                quantityShares: 1_000,
                quantityState: 'exact',
                disposition: 'release_proven_unsent_or_reconcile',
            },
            {
                ordinal: 6,
                kind: 'exit_claim',
                state: 'monitoring_reserved',
                quantityShares: 1_000,
                quantityState: 'exact',
                disposition: 'reconcile_or_release_claim',
            },
        ]);
        expect(audit.drainRecords).toHaveLength(audit.gracefulStopBlockerCount);
        expect(JSON.stringify(audit)).not.toMatch(
            /account-A|broker-A|TSE:2330|strategy-1|intent-1|obligation-1/,
        );
        await expect(
            reopened.client.request('lifecycleAudit', { strategyId: 'strategy-1' }),
        ).rejects.toThrow('empty object');
    });

    it('bounds the per-record drain projection at 100 without hiding the blocker total', async () => {
        const { client, databasePath } = await openRepository();
        await client.close();
        openClients.delete(client);

        const seed = new DatabaseSync(databasePath);
        const insert = seed.prepare(`
            INSERT INTO strategies(
                strategy_id, strategy_kind, state, definition_hash,
                definition_json, account_broker_ref, account_id_ref,
                identity_group_id, confirmation_snapshot_hash,
                created_at_epoch_ms, updated_at_epoch_ms, terminal_at_epoch_ms,
                revision
            ) VALUES (?, 'quick', 'monitoring', ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)
        `);
        seed.exec('BEGIN IMMEDIATE');
        try {
            for (let index = 0; index < 101; index += 1) {
                const suffix = String(index).padStart(3, '0');
                insert.run(
                    `strategy-drain-${suffix}`,
                    DIGEST_A,
                    JSON.stringify({ schemaVersion: 'strategy/1', kind: 'quick' }),
                    `broker-${suffix}`,
                    `account-${suffix}`,
                    `identity-${suffix}`,
                    DIGEST_B,
                    1_786_377_600_000 + index,
                    1_786_377_600_000 + index,
                );
            }
            seed.exec('COMMIT');
        } catch (error) {
            seed.exec('ROLLBACK');
            throw error;
        } finally {
            seed.close();
        }

        const reopened = await openRepository({ databasePath });
        const audit = await reopened.client.request('lifecycleAudit', {});
        expect(audit.gracefulStopBlockerCount).toBe(101);
        expect(audit.counts.non_terminal_strategies).toBe(101);
        expect(audit.drainRecordsTruncated).toBe(true);
        expect(audit.drainRecords).toHaveLength(100);
        expect(audit.drainRecords.map((record) => record.ordinal)).toEqual(
            Array.from({ length: 100 }, (_value, index) => index + 1),
        );
        expect(
            audit.drainRecords.every(
                (record) =>
                    record.kind === 'strategy' &&
                    record.state === 'monitoring' &&
                    record.quantityShares === null &&
                    record.quantityState === 'not_applicable' &&
                    record.disposition === 'pause_or_cancel_strategy',
            ),
        ).toBe(true);
        expect(JSON.stringify(audit.drainRecords)).not.toMatch(
            /strategy-drain|account-|broker-|identity-/,
        );
    });

    it('persists monitoring and expired-with-obligation as distinct non-terminal strategy states', async () => {
        const { client } = await openRepository();
        await client.request(
            'insertStrategy',
            strategyInput({ strategyId: 'monitoring-1', state: 'monitoring' }),
        );
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'expired-obligation-1',
                state: 'expired_with_obligation',
                nowEpochMs: 1_786_377_600_001,
            }),
        );
        await expect(
            client.request('listStrategies', { limit: 20 }),
        ).resolves.toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    strategyId: 'monitoring-1',
                    state: 'monitoring',
                }),
                expect.objectContaining({
                    strategyId: 'expired-obligation-1',
                    state: 'expired_with_obligation',
                }),
            ]),
        );
    });

    it('projects redacted nested activity instead of making the browser infer broker progress', async () => {
        const { client } = await openRepository();
        await client.request('insertStrategy', strategyInput());
        await expect(
            client.request('listStrategies', { limit: 20 }),
        ).resolves.toEqual([
            expect.objectContaining({
                strategyId: 'strategy-1',
                state: 'monitoring',
                activity: {
                    schemaVersion: 'smart-order-active-activity/2026-08-13.3',
                    displayState: 'monitoring',
                    activations: { state: null, count: 0 },
                    intents: { state: null, count: 0 },
                    brokerOrders: { state: null, count: 0 },
                    protectionCommitments: { state: null, count: 0 },
                    protectionObligations: { state: null, count: 0 },
                    entryExposureReservations: { state: null, count: 0 },
                    exitClaims: { state: null, count: 0 },
                    resolutionCases: { state: null, count: 0 },
                    safetyBlockers: { state: null, count: 0 },
                    formalProtection: null,
                    hasRuntimeTrackedUnprotectedRemainder: false,
                    runtimeTrackedUnprotectedRemainder: {
                        state: 'none',
                        lastKnownShares: 0,
                        asOfEpochMs: null,
                        current: false,
                    },
                    hasUnknownExitClaim: false,
                    accountIdentifiersExposed: false,
                    entityIdentifiersExposed: false,
                },
            }),
        ]);

        await client.request('prepareIntent', preparedIntentInput());
        const [strategy] = await client.request('listStrategies', { limit: 20 });
        expect(strategy.activity).toMatchObject({
            displayState: 'prepared',
            activations: { state: 'prepared', count: 1 },
            intents: { state: 'prepared', count: 1 },
            brokerOrders: { state: null, count: 0 },
            entryExposureReservations: { state: 'reserved', count: 1 },
            hasRuntimeTrackedUnprotectedRemainder: false,
            runtimeTrackedUnprotectedRemainder: {
                state: 'none',
                lastKnownShares: 0,
                asOfEpochMs: null,
                current: false,
            },
            accountIdentifiersExposed: false,
            entityIdentifiersExposed: false,
        });
        expect(JSON.stringify(strategy.activity)).not.toMatch(
            /account-A|broker-A|activation-1|intent-1|reservation-1/,
        );

        const cancelled = await client.request('requestStrategyCancellation', {
            strategyId: 'strategy-1',
            expectedRevision: 0,
            nowEpochMs: 1_786_377_600_300,
        });
        expect(cancelled).toMatchObject({
            state: 'cancel_pending',
            activity: { displayState: 'cancel_pending' },
        });
    });

    it('projects only last-known unprotected shares and as-of time without identifiers', async () => {
        const { client, databasePath } = await openRepository();
        await startReadyRuntime(client, {
            runtimeEpochId: 'protected-entry-setup-runtime',
            senderFence: 'protected-entry-setup-fence',
            apiGeneration: 'simulation-generation/1',
        });
        await client.request('insertStrategy', strategyInput());
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                protectionCommitment: {
                    commitmentId: 'commitment-unprotected',
                    committedShares: 1_000,
                },
                protectionObligation: {
                    obligationId: 'obligation-unprotected',
                    positionLineageId: 'position-lineage-unprotected',
                },
            }),
        );
        await client.close();
        openClients.delete(client);

        const seed = new DatabaseSync(databasePath);
        seed.exec('PRAGMA foreign_keys=ON');
        seed.prepare(`
            UPDATE pending_protection_commitments
               SET state='materialized', materialized_shares=1000,
                   updated_at_epoch_ms=1786377600200, revision=1
             WHERE commitment_id='commitment-unprotected'
        `).run();
        seed.prepare(`
            UPDATE protection_obligations
               SET state='monitoring', filled_shares=1000,
                   updated_at_epoch_ms=1786377600200, revision=1
             WHERE obligation_id='obligation-unprotected'
        `).run();
        seed.prepare(`
            INSERT INTO exit_claims(
                exit_claim_id, obligation_id, intent_id, external_lineage,
                account_broker_ref, account_id_ref, contract_key,
                position_lineage_id, remainder_generation,
                allocation_start_share, quantity_shares, state,
                evidence_hash, created_at_epoch_ms, updated_at_epoch_ms,
                revision
            ) VALUES (
                'exit-claim-unprotected', 'obligation-unprotected', NULL, 0,
                'broker-A', 'account-A', 'TSE:2330:STK:Common',
                'position-lineage-unprotected', 0, 0, 250,
                'monitoring_reserved', '${DIGEST_A}',
                1786377600250, 1786377600250, 0
            )
        `).run();
        seed.close();

        const reopened = await openRepository({ databasePath });
        const [strategy] = await reopened.client.request('listStrategies', {
            limit: 20,
        });
        expect(strategy.activity).toMatchObject({
            displayState: 'unprotected',
            hasRuntimeTrackedUnprotectedRemainder: true,
            runtimeTrackedUnprotectedRemainder: {
                state: 'last_known',
                lastKnownShares: 750,
                asOfEpochMs: 1_786_377_600_250,
                current: false,
            },
            accountIdentifiersExposed: false,
            entityIdentifiersExposed: false,
        });
        expect(JSON.stringify(strategy.activity)).not.toMatch(
            /account-A|broker-A|obligation-unprotected|exit-claim-unprotected|position-lineage-unprotected/,
        );
    });

    it.each([
        ['filled', 1_000, 0, 'filled'],
        ['cancelled', 0, 1_000, 'unfilled'],
    ])(
        'projects the latest terminal broker outcome %s distinctly as %s',
        async (brokerState, filledShares, remainingShares, displayState) => {
            const { client, databasePath } = await openRepository();
            await client.request('insertStrategy', strategyInput());
            await client.request('prepareIntent', preparedIntentInput());
            await client.close();
            openClients.delete(client);

            const seed = new DatabaseSync(databasePath);
            seed.exec('PRAGMA foreign_keys=ON');
            seed.prepare(`
                INSERT INTO broker_orders(
                    broker_order_id, intent_id, state, control_revision,
                    quantity_shares, filled_shares, remaining_shares,
                    evidence_hash, updated_at_epoch_ms, terminal_at_epoch_ms,
                    revision
                ) VALUES (
                    'broker-order-terminal', 'intent-1', ?, 1,
                    1000, ?, ?, ?, 1786377600400, 1786377600400, 1
                )
            `).run(brokerState, filledShares, remainingShares, DIGEST_A);
            seed.close();

            const reopened = await openRepository({ databasePath });
            const [strategy] = await reopened.client.request('listStrategies', {
                limit: 20,
            });
            expect(strategy.activity).toMatchObject({
                displayState,
                brokerOrders: { state: displayState, count: 1 },
                accountIdentifiersExposed: false,
                entityIdentifiersExposed: false,
            });
        },
    );

    it('rejects activation-only and non-canonical terminal states at the strategy boundary', async () => {
        const { client } = await openRepository();
        for (const [index, state] of ['armed', 'triggered', 'failed'].entries()) {
            await expect(
                client.request(
                    'insertStrategy',
                    strategyInput({
                        strategyId: `invalid-strategy-state-${index}`,
                        state,
                    }),
                ),
            ).rejects.toThrow();
        }
        expect((await client.request('status')).counts.strategies).toBe(0);
    });

    it('returns the canonical outbox result for exact replay and rejects payload drift', async () => {
        const { client } = await openRepository();
        await insertPreparedIntent(client);

        await expect(
            client.request(
                'prepareIntent',
                preparedIntentInput({
                    activation: { activationId: 'ignored-activation' },
                    intent: { intentId: 'ignored-intent' },
                    reservation: { reservationId: 'ignored-reservation' },
                }),
            ),
        ).resolves.toMatchObject({
            intentId: 'intent-1',
            state: 'prepared',
            replayed: true,
        });
        await expect(
            client.request(
                'prepareIntent',
                preparedIntentInput({
                    intent: {
                        payload: DIFFERENT_INTENT_PAYLOAD,
                        payloadHash: DIFFERENT_INTENT_PAYLOAD_DIGEST,
                    },
                }),
            ),
        ).rejects.toThrow('replay payload mismatch');
        const status = await client.request('status');
        expect(status.counts.activations).toBe(1);
        expect(status.counts.order_intents).toBe(1);
        expect(status.counts.entry_exposure_reservations).toBe(1);
    });

    it('atomically prepares a protected entry commitment and obligation while keeping exit claims at zero', async () => {
        const { client, databasePath } = await openRepository();
        await startReadyRuntime(client, {
            runtimeEpochId: 'protected-entry-setup-runtime',
            senderFence: 'protected-entry-setup-fence',
            apiGeneration: 'simulation-generation/1',
        });
        await client.request('insertStrategy', strategyInput());
        const protectedEntry = preparedIntentInput({
            protectionCommitment: {
                commitmentId: 'commitment-1',
                committedShares: 1_000,
            },
            protectionObligation: {
                obligationId: 'obligation-1',
                positionLineageId: 'position-lineage-1',
            },
        });
        await expect(
            client.request('prepareIntent', {
                ...protectedEntry,
                protectionCommitment: {
                    ...protectedEntry.protectionCommitment,
                    committedShares: 999,
                },
            }),
        ).rejects.toThrow('plan scope or quantity does not match');
        await expect(
            client.request('prepareIntent', {
                ...protectedEntry,
                reservation: {
                    ...protectedEntry.reservation,
                    policyRevision: 'risk-policy/2',
                },
            }),
        ).rejects.toThrow(
            'reservation is not bound to the confirmed risk revision',
        );
        await expect(
            client.request('prepareIntent', {
                ...protectedEntry,
                reservation: {
                    ...protectedEntry.reservation,
                    notionalMinorUnits: 0,
                    cashMinorUnits: 0,
                },
            }),
        ).rejects.toThrow('canonical worst case');
        expect((await client.request('status')).counts).toMatchObject({
            activations: 0,
            order_intents: 0,
            entry_exposure_reservations: 0,
            pending_protection_commitments: 0,
            protection_obligations: 0,
            exit_claims: 0,
        });
        await expect(
            client.request('prepareIntent', protectedEntry),
        ).resolves.toMatchObject({
            intentId: 'intent-1',
            state: 'prepared',
            protectionCommitmentId: 'commitment-1',
            protectionObligationId: 'obligation-1',
            exitClaimId: null,
            replayed: false,
        });
        await expect(
            client.request('prepareIntent', protectedEntry),
        ).resolves.toMatchObject({
            protectionCommitmentId: 'commitment-1',
            protectionObligationId: 'obligation-1',
            exitClaimId: null,
            replayed: true,
        });
        await expect(
            client.request('prepareIntent', {
                ...protectedEntry,
                protectionObligation: {
                    ...protectedEntry.protectionObligation,
                    obligationId: 'obligation-replay-drift',
                },
            }),
        ).rejects.toThrow('replay envelope');
        await client.request(
            'insertStrategy',
            strategyInput({ strategyId: 'strategy-rollback' }),
        );
        const midTransactionConflict = preparedIntentInput({
            strategyId: 'strategy-rollback',
            activation: {
                activationId: 'activation-rollback',
                logicalKey: 'edge-rollback',
            },
            intent: {
                intentId: 'intent-rollback',
                clientRequestId: 'request-rollback',
            },
            reservation: { reservationId: 'reservation-rollback' },
            protectionCommitment: {
                commitmentId: 'commitment-rollback',
                committedShares: 1_000,
            },
            protectionObligation: {
                obligationId: 'obligation-1',
                positionLineageId: 'position-lineage-rollback',
            },
        });
        await expect(
            client.request('prepareIntent', midTransactionConflict),
        ).rejects.toThrow();
        expect((await client.request('status')).counts).toMatchObject({
            activations: 1,
            order_intents: 1,
            entry_exposure_reservations: 1,
            pending_protection_commitments: 1,
            protection_obligations: 1,
            exit_claims: 0,
        });
        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database
                .prepare(`
                    SELECT commitments.state AS commitment_state,
                           commitments.committed_shares,
                           commitments.materialized_shares,
                           intents.payload_json,
                           obligations.state AS obligation_state,
                           obligations.position_lineage_id,
                           obligations.filled_shares,
                           obligations.confirmed_exited_shares
                      FROM pending_protection_commitments AS commitments
                      JOIN order_intents AS intents
                        ON intents.intent_id=commitments.entry_intent_id
                      JOIN protection_obligations AS obligations
                        ON obligations.commitment_id=commitments.commitment_id
                     WHERE commitments.entry_intent_id='intent-1'
                `)
                .get(),
        ).toEqual({
            commitment_state: 'pending_entry_fill',
            committed_shares: 1_000,
            materialized_shares: 0,
            payload_json: canonicalProtectedEntryIntentPayload(
                protectedEntry.intent.payload,
            ).payloadJson,
            obligation_state: 'pending_entry_fill',
            position_lineage_id: 'position-lineage-1',
            filled_shares: 0,
            confirmed_exited_shares: 0,
        });
        expect(
            database.prepare('SELECT COUNT(*) AS count FROM exit_claims').get()?.count,
        ).toBe(0);
        const storedPlan = JSON.parse(
            database
                .prepare(
                    "SELECT payload_json FROM order_intents WHERE intent_id='intent-1'",
                )
                .get().payload_json,
        ).protectionPlan;
        expect(storedPlan).toMatchObject({
            confirmationSnapshotHash: DIGEST_B,
            modeRevision: 'simulation-generation/1',
            riskRevision: 'risk-policy/1',
            basis: { source: 'entry_weighted_average_fill' },
            entryOrder: {
                side: 'Buy',
                orderCond: 'Cash',
                orderLot: 'Common',
                baseShares: 1_000,
            },
            protection: { family: 'fixed' },
        });
        database.close();

        const reopened = await openRepository({ databasePath });
        const [projected] = await reopened.client.request('listStrategies', {
            limit: 20,
        });
        expect(projected.activity).toMatchObject({
            displayState: 'pending_entry_fill',
            protectionCommitments: {
                state: 'pending_entry_fill',
                count: 1,
            },
            protectionObligations: {
                state: 'pending_entry_fill',
                count: 1,
            },
            runtimeTrackedUnprotectedRemainder: {
                state: 'none',
                current: false,
            },
        });
    });

    it('persists canonical broker evidence and atomically materializes a partial protected-entry fill', async () => {
        const { client, databasePath } = await openRepository();
        await startReadyRuntime(client, {
            runtimeEpochId: 'protected-entry-setup-runtime',
            senderFence: 'protected-entry-setup-fence',
            apiGeneration: 'simulation-generation/1',
        });
        await client.request('insertStrategy', strategyInput());
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                protectionCommitment: {
                    commitmentId: 'commitment-1',
                    committedShares: 1_000,
                },
                protectionObligation: {
                    obligationId: 'obligation-1',
                    positionLineageId: 'position-lineage-1',
                },
            }),
        );
        await client.close();
        openClients.delete(client);
        const order = protectedEntryBrokerEvent();
        const deal = protectedEntryBrokerEvent({
            eventKind: 'deal',
            status: 'PartFilled',
            cumulativeDeal: 200,
            remaining: 800,
            eventDeal: 200,
            dealId: 'protected-entry-deal-1',
            exchangeSequence: 'protected-entry-exchange-1',
            exchangeEpochMs: 1_786_377_600_400,
            price: '101',
        });
        const seed = new DatabaseSync(databasePath);
        seed.exec('PRAGMA foreign_keys=ON');
        seed.prepare(`
            UPDATE order_intents
               SET state='dispatching', adapter_authority_granted=1,
                   dispatch_attempt_nonce='dispatch-attempt-1',
                   runtime_epoch_id='protected-entry-setup-runtime',
                   sender_fence='protected-entry-setup-fence',
                   api_generation='simulation-generation/1', revision=1
             WHERE intent_id='intent-1'
        `).run();
        seed.prepare(`
            UPDATE activations SET state='dispatching', revision=1
             WHERE activation_id='activation-1'
        `).run();
        expect(
            seed.prepare(`
                SELECT state, adapter_authority_granted, runtime_epoch_id,
                       sender_fence, api_generation
                  FROM order_intents WHERE intent_id='intent-1'
            `).get(),
        ).toEqual({
            state: 'dispatching',
            adapter_authority_granted: 1,
            runtime_epoch_id: 'protected-entry-setup-runtime',
            sender_fence: 'protected-entry-setup-fence',
            api_generation: 'simulation-generation/1',
        });
        seedBrokerCorrelation(seed, [order, deal]);
        seed.close();

        const reopened = await openRepository({ databasePath });
        await expect(
            reopened.client.request('recordCanonicalBrokerEvent', {
                runtimeEpochId: 'protected-entry-setup-runtime',
                senderFence: 'protected-entry-setup-fence',
                apiGeneration: 'simulation-generation/1',
                event: order,
            }),
        ).resolves.toMatchObject({
            state: 'accepted',
            intentId: 'intent-1',
            brokerWriteAuthority: false,
        });
        await expect(
            reopened.client.request('recordCanonicalBrokerEvent', {
                runtimeEpochId: 'protected-entry-setup-runtime',
                senderFence: 'protected-entry-setup-fence',
                apiGeneration: 'simulation-generation/1',
                event: deal,
            }),
        ).resolves.toMatchObject({
            state: 'accepted',
            headRevision: 1,
            runtimeState: 'reconciling',
            entryExposureReservationProjection: {
                reservationId: 'reservation-1',
                state: 'unknown',
                revision: 1,
                transitioned: true,
                runtimeState: 'reconciling',
            },
            brokerWriteAuthority: false,
        });
        await expect(
            reopened.client.request('recordCanonicalBrokerEvent', {
                runtimeEpochId: 'protected-entry-setup-runtime',
                senderFence: 'protected-entry-setup-fence',
                apiGeneration: 'simulation-generation/1',
                event: deal,
            }),
        ).resolves.toMatchObject({
            state: 'duplicate',
            entryExposureReservationProjection: {
                reservationId: 'reservation-1',
                state: 'unknown',
                revision: 1,
                transitioned: false,
            },
            runtimeState: 'reconciling',
        });

        await expect(
            reopened.client.request('materializeProtectedEntryFill', {
                runtimeEpochId: 'protected-entry-setup-runtime',
                senderFence: 'protected-entry-setup-fence',
                apiGeneration: 'simulation-generation/1',
                intentId: 'intent-1',
                nowEpochMs: 1_786_377_600_600,
                reconciliation: protectedEntryReconciliation(),
            }),
        ).resolves.toMatchObject({
            state: 'partial',
            cumulativeFilledShares: 200,
            remainingEntryShares: 800,
            fillNotionalMinorUnits: 2_020_000,
            weightedAverage: {
                numeratorMinorUnits: 2_020_000,
                denominatorShares: 200,
            },
            exitClaimId: expect.stringMatching(/^exit-claim:/),
            brokerWriteAuthority: false,
        });

        const [projectedStrategy] = await reopened.client.request(
            'listStrategies',
            { limit: 20 },
        );
        expect(projectedStrategy.activity.formalProtection).toEqual({
            schemaVersion:
                'smart-order-formal-protection-view/2026-08-13.1',
            state: 'formal',
            cumulativeFilledShares: 200,
            asOfEpochMs: 1_786_377_600_500,
            estimatedBasis: {
                numeratorMinorUnits: '10000',
                denominator: '1',
            },
            formalBasis: {
                numeratorMinorUnits: '10100',
                denominator: '1',
            },
            legs: [
                {
                    type: 'stop',
                    comparator: 'lte',
                    triggerState: 'formal',
                    triggerBasis: 'weighted_average_fill',
                    estimatedTriggerPrice: {
                        numeratorMinorUnits: '9700',
                        denominator: '1',
                    },
                    formalTriggerPrice: {
                        numeratorMinorUnits: '9797',
                        denominator: '1',
                    },
                    differsFromEstimate: true,
                },
            ],
            accountIdentifiersExposed: false,
            entityIdentifiersExposed: false,
        });

        await reopened.client.close();
        openClients.delete(reopened.client);
        const verified = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verified.prepare(`
                SELECT commitments.state AS commitment_state,
                       commitments.materialized_shares,
                       obligations.state AS obligation_state,
                       obligations.filled_shares,
                       claims.state AS claim_state,
                       claims.quantity_shares AS claim_shares,
                       reservations.state AS reservation_state,
                       reservations.quantity_shares AS reserved_shares,
                       fills.cumulative_filled_shares,
                       fills.weighted_average_numerator_minor_units,
                       fills.weighted_average_denominator_shares,
                       fills.formal_protection_json,
                       fills.formal_protection_hash
                  FROM pending_protection_commitments AS commitments
                  JOIN protection_obligations AS obligations
                    ON obligations.commitment_id=commitments.commitment_id
                  JOIN exit_claims AS claims
                    ON claims.obligation_id=obligations.obligation_id
                  JOIN entry_exposure_reservations AS reservations
                    ON reservations.intent_id=commitments.entry_intent_id
                  JOIN protected_entry_fill_heads AS fills
                    ON fills.intent_id=commitments.entry_intent_id
                 WHERE commitments.entry_intent_id='intent-1'
            `).get(),
        ).toMatchObject({
            commitment_state: 'materializing',
            materialized_shares: 200,
            obligation_state: 'monitoring',
            filled_shares: 200,
            claim_state: 'monitoring_reserved',
            claim_shares: 200,
            reservation_state: 'partially_consumed',
            reserved_shares: 800,
            cumulative_filled_shares: 200,
            weighted_average_numerator_minor_units: 2_020_000,
            weighted_average_denominator_shares: 200,
            formal_protection_json: expect.stringContaining(
                'smart-order-formal-protection/2026-08-13.2',
            ),
            formal_protection_hash: expect.stringMatching(
                /^sha256:[0-9a-f]{64}$/,
            ),
        });
        verified.close();
    });

    it('prevents two strategies from materializing overlapping ExitClaims against one position', async () => {
        const runtime = {
            runtimeEpochId: 'protected-entry-competition-runtime',
            senderFence: 'protected-entry-competition-fence',
            apiGeneration: 'simulation-generation/1',
        };
        const { client, databasePath } = await openRepository();
        await startReadyRuntime(client, runtime);
        await client.request('insertStrategy', strategyInput());
        await client.request(
            'insertStrategy',
            strategyInput({ strategyId: 'strategy-2' }),
        );
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                runtimeEpochId: runtime.runtimeEpochId,
                senderFence: runtime.senderFence,
                protectionCommitment: {
                    commitmentId: 'commitment-1',
                    committedShares: 1_000,
                },
                protectionObligation: {
                    obligationId: 'obligation-1',
                    positionLineageId: 'shared-position-lineage',
                },
            }),
        );
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                strategyId: 'strategy-2',
                runtimeEpochId: runtime.runtimeEpochId,
                senderFence: runtime.senderFence,
                activation: {
                    activationId: 'activation-2',
                    logicalKey: 'edge-2',
                },
                intent: {
                    intentId: 'intent-2',
                    clientRequestId: 'request-2',
                },
                reservation: { reservationId: 'reservation-2' },
                protectionCommitment: {
                    commitmentId: 'commitment-2',
                    committedShares: 1_000,
                },
                protectionObligation: {
                    obligationId: 'obligation-2',
                    positionLineageId: 'shared-position-lineage',
                },
            }),
        );
        await client.close();
        openClients.delete(client);

        const order1 = protectedEntryBrokerEvent();
        const deal1 = protectedEntryBrokerEvent({
            eventKind: 'deal',
            status: 'PartFilled',
            cumulativeDeal: 600,
            remaining: 400,
            eventDeal: 600,
            dealId: 'protected-entry-deal-1',
            exchangeSequence: 'protected-entry-exchange-1',
            exchangeEpochMs: 1_786_377_600_400,
            price: '101',
        });
        const order2 = protectedEntryBrokerEvent({
            tradeId: 'protected-entry-trade-2',
            orderId: 'protected-entry-order-2',
            seqno: 'protected-entry-seq-2',
            ordno: 'protected-entry-ord-2',
            customField: 'PE0002',
            exchangeEpochMs: 1_786_377_600_410,
        });
        const deal2 = protectedEntryBrokerEvent({
            eventKind: 'deal',
            status: 'PartFilled',
            cumulativeDeal: 600,
            remaining: 400,
            eventDeal: 600,
            dealId: 'protected-entry-deal-2',
            exchangeSequence: 'protected-entry-exchange-2',
            tradeId: 'protected-entry-trade-2',
            seqno: 'protected-entry-seq-2',
            ordno: 'protected-entry-ord-2',
            customField: 'PE0002',
            exchangeEpochMs: 1_786_377_600_420,
            price: '102',
        });
        const seed = new DatabaseSync(databasePath);
        seed.exec(`
            UPDATE order_intents
               SET state='dispatching', adapter_authority_granted=1,
                   dispatch_attempt_nonce='competition-attempt-' || intent_id,
                   runtime_epoch_id='${runtime.runtimeEpochId}',
                   sender_fence='${runtime.senderFence}',
                   api_generation='${runtime.apiGeneration}', revision=1
             WHERE intent_id IN ('intent-1','intent-2');
            UPDATE activations SET state='dispatching', revision=1
             WHERE activation_id IN ('activation-1','activation-2');
        `);
        seedBrokerCorrelation(seed, [order1, deal1], {
            correlationId: 'competition-correlation-1',
            intentId: 'intent-1',
        });
        seedBrokerCorrelation(seed, [order2, deal2], {
            correlationId: 'competition-correlation-2',
            intentId: 'intent-2',
        });
        seed.close();

        const reopened = await openRepository({ databasePath });
        for (const event of [order1, deal1, order2, deal2]) {
            await expect(
                reopened.client.request('recordCanonicalBrokerEvent', {
                    ...runtime,
                    event,
                }),
            ).resolves.toMatchObject({ brokerWriteAuthority: false });
        }
        const reconciliation = protectedEntryReconciliation({
            asOfEpochMs: 1_786_377_600_500,
            dealIds: ['protected-entry-deal-1', 'protected-entry-deal-2'],
            quantityShares: 1_000,
            availableShares: 1_000,
            positionLineageId: 'shared-position-lineage',
        });
        await expect(
            reopened.client.request('materializeProtectedEntryFill', {
                ...runtime,
                intentId: 'intent-1',
                nowEpochMs: 1_786_377_600_600,
                reconciliation,
            }),
        ).resolves.toMatchObject({
            state: 'partial',
            cumulativeFilledShares: 600,
            brokerWriteAuthority: false,
        });
        await expect(
            reopened.client.request('materializeProtectedEntryFill', {
                ...runtime,
                intentId: 'intent-2',
                nowEpochMs: 1_786_377_600_610,
                reconciliation,
            }),
        ).resolves.toMatchObject({
            state: 'reconciliation_required',
            reason: 'protected_entry_exit_claim_capacity_conflict',
            runtimeState: 'reconciling',
            automaticRetryAllowed: false,
            brokerWriteAuthority: false,
        });
        await reopened.client.close();
        openClients.delete(reopened.client);

        const verified = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verified.prepare(`
                SELECT exit_claim_id, allocation_start_share, quantity_shares
                  FROM exit_claims ORDER BY exit_claim_id
            `).all(),
        ).toEqual([
            {
                exit_claim_id: expect.stringMatching(/^exit-claim:/),
                allocation_start_share: 0,
                quantity_shares: 600,
            },
        ]);
        expect(
            verified.prepare(`
                SELECT epochs.state AS runtime_state,
                       strategies.state AS strategy_state,
                       reservations.state AS reservation_state
                  FROM runtime_epochs AS epochs
                  JOIN strategies ON strategies.strategy_id='strategy-2'
                  JOIN entry_exposure_reservations AS reservations
                    ON reservations.intent_id='intent-2'
                 WHERE epochs.runtime_epoch_id=?
            `).get(runtime.runtimeEpochId),
        ).toEqual({
            runtime_state: 'reconciling',
            strategy_state: 'recovery',
            reservation_state: 'unknown',
        });
        expect(
            verified.prepare(`
                SELECT COUNT(*) AS count FROM protected_entry_fill_heads
                 WHERE intent_id='intent-2'
            `).get(),
        ).toEqual({ count: 0 });
        verified.close();
    });

    it('keeps correlation-resolved broker observations durable while continuity is reconciling', async () => {
        const testKinds = ['tradeId', 'orderId', 'seqno', 'ordno'];
        const { client, databasePath } = await openRepository({
            testOnlyBrokerCorrelationIdentifierKinds: testKinds,
        });
        const runtime = {
            runtimeEpochId: 'observer-reconciling-runtime',
            senderFence: 'observer-reconciling-fence',
            apiGeneration: 'simulation-generation/1',
        };
        await startReadyRuntime(client, runtime);
        await client.request('insertStrategy', strategyInput());
        await client.request('prepareIntent', preparedIntentInput());
        await client.request('addBrokerCorrelation', {
            correlationId: 'observer-reconciling-correlation',
            intentId: 'intent-1',
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            tradeDate: '2026-08-11',
            contractKey: 'TSE:2330:STK:Common',
            side: 'Buy',
            tradeId: 'protected-entry-trade-1',
            orderId: 'protected-entry-order-1',
            seqno: 'protected-entry-seq-1',
            ordno: 'protected-entry-ord-1',
            evidenceHash: DIGEST_A,
            createdAtEpochMs: 1_786_377_600_250,
        });
        await client.close();
        openClients.delete(client);

        const seed = new DatabaseSync(databasePath);
        seed.exec(`
            UPDATE order_intents
               SET state='dispatching', adapter_authority_granted=1,
                   dispatch_attempt_nonce='observer-reconciling-attempt',
                   runtime_epoch_id='${runtime.runtimeEpochId}',
                   sender_fence='${runtime.senderFence}',
                   api_generation='${runtime.apiGeneration}', revision=1
             WHERE intent_id='intent-1';
            UPDATE activations SET state='dispatching', revision=1
             WHERE activation_id='activation-1';
        `);
        seed.close();

        const reopened = await openRepository({
            databasePath,
            testOnlyBrokerCorrelationIdentifierKinds: testKinds,
        });
        await expect(
            reopened.client.request('invalidateRuntimeContinuityGap', {
                ...runtime,
                signalSha256: DIGEST_A,
                reasonCodes: ['SSE_CURSOR_GAP'],
                nowEpochMs: 1_786_377_600_300,
            }),
        ).resolves.toMatchObject({ state: 'reconciling' });
        await expect(
            reopened.client.request('recordCanonicalBrokerEvent', {
                ...runtime,
                event: protectedEntryBrokerEvent(),
            }),
        ).resolves.toMatchObject({
            state: 'accepted',
            intentId: 'intent-1',
            brokerWriteAuthority: false,
        });
        await reopened.client.close();
        openClients.delete(reopened.client);

        const verification = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verification.prepare(`
                SELECT COUNT(*) AS count FROM broker_event_records
                 WHERE intent_id='intent-1'
            `).get(),
        ).toEqual({ count: 1 });
        verification.close();
    });

    it('rejects caller-selected intents and split durable correlation lineages', async () => {
        const { client, databasePath } = await openRepository();
        const runtime = {
            runtimeEpochId: 'split-correlation-runtime',
            senderFence: 'split-correlation-fence',
            apiGeneration: 'simulation-generation/1',
        };
        await startReadyRuntime(client, runtime);
        await client.request('insertStrategy', strategyInput());
        await client.request('prepareIntent', preparedIntentInput());
        await client.close();
        openClients.delete(client);

        const event = protectedEntryBrokerEvent();
        const seed = new DatabaseSync(databasePath);
        seed.exec(`
            UPDATE order_intents
               SET state='dispatching', adapter_authority_granted=1,
                   dispatch_attempt_nonce='split-correlation-attempt',
                   runtime_epoch_id='${runtime.runtimeEpochId}',
                   sender_fence='${runtime.senderFence}',
                   api_generation='${runtime.apiGeneration}', revision=1
             WHERE intent_id='intent-1';
        `);
        seedBrokerCorrelation(seed, event, {
            correlationId: 'split-correlation-trade',
            identifierKinds: ['tradeId'],
        });
        seedBrokerCorrelation(seed, event, {
            correlationId: 'split-correlation-seqno',
            identifierKinds: ['seqno'],
        });
        seed.close();

        const reopened = await openRepository({ databasePath });
        await expect(
            reopened.client.request('recordCanonicalBrokerEvent', {
                ...runtime,
                intentId: 'intent-1',
                event,
            }),
        ).rejects.toThrow('input schema is invalid');
        await expect(
            reopened.client.request('recordCanonicalBrokerEvent', {
                ...runtime,
                event,
            }),
        ).rejects.toThrow('one durable correlation');
        await reopened.client.close();
        openClients.delete(reopened.client);

        const verification = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verification.prepare('SELECT COUNT(*) AS count FROM broker_event_records').get(),
        ).toEqual({ count: 0 });
        verification.close();
    });

    it('releases the entry reservation without creating an ExitClaim after canonical zero fill', async () => {
        const { client, databasePath } = await openRepository();
        await startReadyRuntime(client, {
            runtimeEpochId: 'protected-entry-setup-runtime',
            senderFence: 'protected-entry-setup-fence',
            apiGeneration: 'simulation-generation/1',
        });
        await client.request('insertStrategy', strategyInput());
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                protectionCommitment: {
                    commitmentId: 'commitment-1',
                    committedShares: 1_000,
                },
                protectionObligation: {
                    obligationId: 'obligation-1',
                    positionLineageId: 'position-lineage-1',
                },
            }),
        );
        await client.close();
        openClients.delete(client);
        const cancelled = protectedEntryBrokerEvent({
            status: 'Cancelled',
            cumulativeCancel: 1_000,
            remaining: 0,
            exchangeEpochMs: 1_786_377_600_400,
        });
        const seed = new DatabaseSync(databasePath);
        seed.prepare(`
            UPDATE order_intents
               SET state='dispatching', adapter_authority_granted=1,
                   dispatch_attempt_nonce='dispatch-attempt-zero-fill',
                   runtime_epoch_id='protected-entry-setup-runtime',
                   sender_fence='protected-entry-setup-fence',
                   api_generation='simulation-generation/1', revision=1
             WHERE intent_id='intent-1'
        `).run();
        seedBrokerCorrelation(seed, cancelled);
        seed.close();
        const reopened = await openRepository({ databasePath });
        await reopened.client.request('recordCanonicalBrokerEvent', {
            runtimeEpochId: 'protected-entry-setup-runtime',
            senderFence: 'protected-entry-setup-fence',
            apiGeneration: 'simulation-generation/1',
            event: cancelled,
        });
        await expect(
            reopened.client.request('materializeProtectedEntryFill', {
                runtimeEpochId: 'protected-entry-setup-runtime',
                senderFence: 'protected-entry-setup-fence',
                apiGeneration: 'simulation-generation/1',
                intentId: 'intent-1',
                nowEpochMs: 1_786_377_600_600,
                reconciliation: protectedEntryReconciliation({
                    deals: [],
                    quantityShares: 0,
                }),
            }),
        ).resolves.toMatchObject({
            state: 'zero_fill_terminal',
            cumulativeFilledShares: 0,
            remainingEntryShares: 0,
            exitClaimId: null,
            brokerWriteAuthority: false,
        });
        await expect(
            reopened.client.request('materializeProtectedEntryFill', {
                runtimeEpochId: 'protected-entry-setup-runtime',
                senderFence: 'protected-entry-setup-fence',
                apiGeneration: 'simulation-generation/1',
                intentId: 'intent-1',
                nowEpochMs: 1_786_377_600_601,
                reconciliation: protectedEntryReconciliation({
                    deals: [],
                    quantityShares: 0,
                }),
            }),
        ).resolves.toMatchObject({
            state: 'zero_fill_terminal',
            replayed: true,
            exitClaimId: null,
        });
        await reopened.client.close();
        openClients.delete(reopened.client);
        const verified = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verified.prepare(`
                SELECT commitments.state AS commitment_state,
                       obligations.state AS obligation_state,
                       reservations.state AS reservation_state,
                       reservations.quantity_shares AS reserved_shares,
                       (SELECT COUNT(*) FROM exit_claims) AS claim_count
                  FROM pending_protection_commitments AS commitments
                  JOIN protection_obligations AS obligations
                    ON obligations.commitment_id=commitments.commitment_id
                  JOIN entry_exposure_reservations AS reservations
                    ON reservations.intent_id=commitments.entry_intent_id
                 WHERE commitments.entry_intent_id='intent-1'
            `).get(),
        ).toEqual({
            commitment_state: 'zero_fill_terminal',
            obligation_state: 'zero_fill_terminal',
            reservation_state: 'released',
            reserved_shares: 0,
            claim_count: 0,
        });
        verified.close();
    });

    it.each([
        {
            conflictName: 'available shares are below the confirmed fill',
            reconciliationOverride: { availableShares: 199 },
        },
        {
            conflictName: 'a same-contract working sell consumes protectable shares',
            reconciliationOverride: {
                workingOrders: [
                    {
                        brokerOrderId: 'external-working-sell-1',
                        contractKey: 'TSE:2330:STK:Common',
                        origin: 'external',
                        side: 'Sell',
                        state: 'Submitted',
                        quantityShares: 900,
                        filledShares: 0,
                        remainingShares: 900,
                    },
                ],
            },
        },
    ])(
        'durably enters reconciliation when $conflictName',
        async ({ reconciliationOverride }) => {
        const { client, databasePath } = await openRepository();
        await startReadyRuntime(client, {
            runtimeEpochId: 'protected-entry-setup-runtime',
            senderFence: 'protected-entry-setup-fence',
            apiGeneration: 'simulation-generation/1',
        });
        await client.request('insertStrategy', strategyInput());
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                protectionCommitment: {
                    commitmentId: 'commitment-1',
                    committedShares: 1_000,
                },
                protectionObligation: {
                    obligationId: 'obligation-1',
                    positionLineageId: 'position-lineage-1',
                },
            }),
        );
        await client.close();
        openClients.delete(client);
        const seed = new DatabaseSync(databasePath);
        const conflictingDeal = protectedEntryBrokerEvent({
            eventKind: 'deal',
            status: 'PartFilled',
            cumulativeDeal: 200,
            remaining: 800,
            eventDeal: 200,
            dealId: 'protected-entry-deal-1',
            exchangeSequence: 'protected-entry-exchange-1',
            exchangeEpochMs: 1_786_377_600_400,
        });
        seed.prepare(`
            UPDATE order_intents
               SET state='dispatching', adapter_authority_granted=1,
                   dispatch_attempt_nonce='dispatch-attempt-conflict',
                   runtime_epoch_id='protected-entry-setup-runtime',
                   sender_fence='protected-entry-setup-fence',
                   api_generation='simulation-generation/1', revision=1
             WHERE intent_id='intent-1'
        `).run();
        seedBrokerCorrelation(seed, conflictingDeal);
        seed.close();
        const reopened = await openRepository({ databasePath });
        await reopened.client.request('recordCanonicalBrokerEvent', {
            runtimeEpochId: 'protected-entry-setup-runtime',
            senderFence: 'protected-entry-setup-fence',
            apiGeneration: 'simulation-generation/1',
            event: conflictingDeal,
        });
        await expect(
            reopened.client.request('materializeProtectedEntryFill', {
                runtimeEpochId: 'protected-entry-setup-runtime',
                senderFence: 'protected-entry-setup-fence',
                apiGeneration: 'simulation-generation/1',
                intentId: 'intent-1',
                nowEpochMs: 1_786_377_600_600,
                reconciliation: protectedEntryReconciliation(
                    reconciliationOverride,
                ),
            }),
        ).resolves.toEqual({
            state: 'reconciliation_required',
            reason: 'protected_entry_protectable_availability_conflict',
            intentId: 'intent-1',
            runtimeState: 'reconciling',
            runtimeRevision: 2,
            automaticRetryAllowed: false,
            brokerWriteAuthority: false,
        });
        await expect(
            reopened.client.request('materializeProtectedEntryFill', {
                runtimeEpochId: 'protected-entry-setup-runtime',
                senderFence: 'protected-entry-setup-fence',
                apiGeneration: 'simulation-generation/1',
                intentId: 'intent-1',
                nowEpochMs: 1_786_377_600_700,
                reconciliation: protectedEntryReconciliation(
                    reconciliationOverride,
                ),
            }),
        ).resolves.toMatchObject({
            state: 'reconciliation_required',
            reason: 'protected_entry_protectable_availability_conflict',
            runtimeState: 'reconciling',
            runtimeRevision: 2,
            automaticRetryAllowed: false,
            replayed: true,
            brokerWriteAuthority: false,
        });
        await reopened.client.close();
        openClients.delete(reopened.client);
        const verified = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verified.prepare(`
                SELECT epochs.state AS runtime_state,
                       epochs.reconciliation_evidence_hash,
                       strategies.state AS strategy_state,
                       reservations.state AS reservation_state,
                       (SELECT COUNT(*) FROM protected_entry_fill_heads)
                           AS fill_count,
                       (SELECT COUNT(*) FROM exit_claims) AS claim_count
                  FROM runtime_epochs AS epochs
                  JOIN strategies
                    ON strategies.strategy_id='strategy-1'
                  JOIN entry_exposure_reservations AS reservations
                    ON reservations.intent_id='intent-1'
                 WHERE epochs.runtime_epoch_id='protected-entry-setup-runtime'
            `).get(),
        ).toEqual({
            runtime_state: 'reconciling',
            reconciliation_evidence_hash: null,
            strategy_state: 'recovery',
            reservation_state: 'unknown',
            fill_count: 0,
            claim_count: 0,
        });
        verified.close();
        },
    );

    it('atomically converts the exact monitoring ExitClaim lineage into an intent reservation', async () => {
        const { client, databasePath } = await openRepository();
        const protectionGroupId = `protection-group:${createHash('sha256')
            .update(canonicalJson('exit-claim-1'))
            .digest('hex')}`;
        await startReadyRuntime(client, {
            runtimeEpochId: 'protected-entry-setup-runtime',
            senderFence: 'protected-entry-setup-fence',
            apiGeneration: 'simulation-generation/1',
        });
        await client.request('insertStrategy', strategyInput());
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                protectionCommitment: {
                    commitmentId: 'commitment-1',
                    committedShares: 1_000,
                },
                protectionObligation: {
                    obligationId: 'obligation-1',
                    positionLineageId: 'position-lineage-1',
                },
            }),
        );
        await client.close();
        openClients.delete(client);
        const seed = new DatabaseSync(databasePath);
        seed.exec('PRAGMA foreign_keys=ON');
        seed
            .prepare(`
                UPDATE pending_protection_commitments
                   SET state='materialized', materialized_shares=1000,
                       updated_at_epoch_ms=1786377600200, revision=1
                 WHERE commitment_id='commitment-1'
            `)
            .run();
        seed
            .prepare(`
                UPDATE protection_obligations
                   SET state='monitoring', filled_shares=1000,
                       updated_at_epoch_ms=1786377600200, revision=1
                 WHERE obligation_id='obligation-1'
            `)
            .run();
        seed
            .prepare(`
                INSERT INTO exit_claims(
                    exit_claim_id, obligation_id, intent_id, external_lineage,
                    account_broker_ref, account_id_ref, contract_key,
                    position_lineage_id, remainder_generation,
                    allocation_start_share, quantity_shares, state,
                    evidence_hash, created_at_epoch_ms, updated_at_epoch_ms,
                    revision
                ) VALUES (
                    'exit-claim-1', 'obligation-1', NULL, 0,
                    'broker-A', 'account-A', 'TSE:2330:STK:Common',
                    'position-lineage-1', 0, 0, 1000,
                    'monitoring_reserved', '${DIGEST_A}',
                    1786377600200, 1786377600200, 0
                )
            `)
            .run();
        seed.prepare(`
            INSERT INTO protection_groups(
                protection_group_id, obligation_id, exit_claim_id, state,
                current_generation, plan_hash, created_at_epoch_ms,
                updated_at_epoch_ms, revision
            ) VALUES (?, 'obligation-1', 'exit-claim-1', 'monitoring', 0, ?,
                      1786377600200, 1786377600200, 0)
        `).run(
            protectionGroupId,
            protectedEntryProjection().payload.protectionPlanSha256,
        );
        seed.prepare(`
            INSERT INTO protection_remainder_generations(
                protection_group_id, remainder_generation, exit_claim_id,
                state, quantity_shares, evidence_hash,
                created_at_epoch_ms, updated_at_epoch_ms, revision
            ) VALUES (?, 0, 'exit-claim-1', 'monitoring', 1000, ?,
                      1786377600200, 1786377600200, 0)
        `).run(protectionGroupId, DIGEST_A);
        seed.exec(`
            UPDATE activations
               SET state='filled', updated_at_epoch_ms=1786377600200,
                   revision=revision+1
             WHERE activation_id='activation-1';
            UPDATE order_intents
               SET state='terminal', terminal_outcome='filled',
                   updated_at_epoch_ms=1786377600200,
                   terminal_at_epoch_ms=1786377600200,
                   revision=revision+1
             WHERE intent_id='intent-1';
            UPDATE entry_exposure_reservations
               SET state='consumed', updated_at_epoch_ms=1786377600200,
                   terminal_at_epoch_ms=1786377600200,
                   revision=revision+1
             WHERE intent_id='intent-1';
        `);
        seed.close();

        const reopened = await openRepository({ databasePath });
        const exitProjection = protectiveBrokerIntentProjection();
        const exitIntent = preparedIntentInput({
            nowEpochMs: 1_786_377_600_300,
            activation: {
                activationId: 'activation-exit-1',
                logicalKey: 'exit-edge-1',
                generation: 0,
                evidenceHash: DIGEST_B,
            },
            intent: {
                intentId: 'intent-exit-1',
                side: 'Sell',
                clientRequestId: 'request-exit-1',
                payload: exitProjection.payload,
                payloadHash: exitProjection.payloadSha256,
            },
            reservation: null,
            exitClaim: {
                exitClaimId: 'exit-claim-1',
                obligationId: 'obligation-1',
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                contractKey: 'TSE:2330:STK:Common',
                positionLineageId: 'position-lineage-1',
                remainderGeneration: 0,
                allocationStartShare: 0,
                quantityShares: 1_000,
                expectedRevision: 0,
                evidenceHash: DIGEST_B,
                protectionGroupId,
                expectedGroupRevision: 0,
                expectedGenerationRevision: 0,
                candidateEvaluations: [
                    {
                        legId: 'stop-leg',
                        evidenceHash: DIGEST_B,
                        observedAtEpochMs: 1_786_377_600_300,
                    },
                ],
            },
        });
        Object.assign(exitIntent, {
            runtimeEpochId: 'protected-entry-setup-runtime',
            senderFence: 'protected-entry-setup-fence',
            apiGeneration: 'simulation-generation/1',
        });
        await expect(
            reopened.client.request('prepareIntent', {
                ...exitIntent,
                activation: {
                    ...exitIntent.activation,
                    activationId: 'activation-exit-bad',
                    logicalKey: 'exit-edge-bad',
                },
                intent: {
                    ...exitIntent.intent,
                    intentId: 'intent-exit-bad',
                    clientRequestId: 'request-exit-bad',
                },
                exitClaim: {
                    ...exitIntent.exitClaim,
                    contractKey: 'TSE:2317:STK:Common',
                },
            }),
        ).rejects.toThrow(
            'protection OCO group, claim lineage, or optimistic revision does not exactly match',
        );
        expect((await reopened.client.request('status')).counts).toMatchObject({
            activations: 1,
            order_intents: 1,
            exit_claims: 1,
        });
        await expect(
            reopened.client.request('prepareIntent', exitIntent),
        ).resolves.toMatchObject({
            intentId: 'intent-exit-1',
            exitClaimId: 'exit-claim-1',
            replayed: false,
        });
        await reopened.client.close();
        openClients.delete(reopened.client);
        const verify = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verify
                .prepare(`
                    SELECT intent_id, state, evidence_hash, revision
                      FROM exit_claims WHERE exit_claim_id='exit-claim-1'
                `)
                .get(),
        ).toEqual({
            intent_id: 'intent-exit-1',
            state: 'intent_reserved',
            evidence_hash: DIGEST_B,
            revision: 1,
        });
        verify.close();
    });

    it('selects one durable OCO winner, suppresses siblings before broker authority, and rejects a competing slot', async () => {
        const protectionLegs = [
            {
                legId: 'stop-leg',
                type: 'stop',
                comparator: 'lte',
                distance: { kind: 'pct_bps', pctBps: 300 },
                execution: {
                    priceType: 'MKT',
                    timeInForce: 'IOC',
                    limitPrice: null,
                },
            },
            {
                legId: 'take-leg',
                type: 'take',
                comparator: 'gte',
                distance: { kind: 'pct_bps', pctBps: 500 },
                execution: {
                    priceType: 'LMT',
                    timeInForce: 'ROD',
                    limitPrice: '105',
                },
            },
        ];
        const databasePath = await createMonitoringExitClaimFixture({
            protectionLegs,
        });
        const reopened = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: [
                defaultExternalSellVisibilityHead(),
            ],
        });
        const winnerProjection = protectiveBrokerIntentProjection({
            legId: 'take-leg',
            protectionPlan: protectedEntryProjection({ protectionLegs }).payload
                .protectionPlan,
            triggerPolicyHash: DIGEST_A,
        });
        const winner = protectiveSellIntent({
            intent: {
                payload: winnerProjection.payload,
                payloadHash: winnerProjection.payloadSha256,
            },
            exitClaim: {
                candidateEvaluations: [
                    {
                        legId: 'take-leg',
                        evidenceHash: DIGEST_A,
                        observedAtEpochMs: 1_786_377_600_299,
                    },
                    {
                        legId: 'stop-leg',
                        evidenceHash: DIGEST_B,
                        observedAtEpochMs: 1_786_377_600_300,
                    },
                ],
            },
        });
        await expect(
            reopened.client.request('prepareIntent', winner),
        ).resolves.toMatchObject({
            intentId: 'visibility-sell-intent',
            protectionGroupId: VISIBILITY_PROTECTION_GROUP_ID,
            winnerLegId: 'take-leg',
            siblingCount: 1,
            adapterAuthorityGranted: false,
            replayed: false,
        });
        await expect(
            reopened.client.request('prepareIntent', winner),
        ).resolves.toMatchObject({
            intentId: 'visibility-sell-intent',
            winnerLegId: 'take-leg',
            siblingCount: 1,
            replayed: true,
        });
        await expect(
            reopened.client.request('prepareIntent', {
                ...winner,
                activation: {
                    ...winner.activation,
                    activationId: 'visibility-competing-activation',
                    logicalKey: 'visibility-competing-edge',
                },
                intent: {
                    ...winner.intent,
                    intentId: 'visibility-competing-intent',
                    clientRequestId: 'visibility-competing-request',
                },
            }),
        ).rejects.toThrow(
            'protection OCO group, claim lineage, or optimistic revision does not exactly match',
        );
        await reopened.client.close();
        openClients.delete(reopened.client);
        const verify = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verify.prepare(`
                SELECT state, current_generation, revision
                  FROM protection_groups
                 WHERE protection_group_id=?
            `).get(VISIBILITY_PROTECTION_GROUP_ID),
        ).toEqual({
            state: 'winner_selected',
            current_generation: 0,
            revision: 1,
        });
        expect(
            verify.prepare(`
                SELECT state, winner_leg_id, winner_activation_id,
                       winner_intent_id, revision
                  FROM protection_remainder_generations
                 WHERE protection_group_id=? AND remainder_generation=0
            `).get(VISIBILITY_PROTECTION_GROUP_ID),
        ).toEqual({
            state: 'winner_selected',
            winner_leg_id: 'take-leg',
            winner_activation_id: 'visibility-sell-activation',
            winner_intent_id: 'visibility-sell-intent',
            revision: 1,
        });
        expect(
            verify.prepare(`
                SELECT leg_id, state, active_dispatch_slot, activation_id,
                       intent_id, broker_authority
                  FROM protection_leg_evaluations
                 WHERE protection_group_id=? AND remainder_generation=0
                 ORDER BY leg_id
            `).all(VISIBILITY_PROTECTION_GROUP_ID),
        ).toEqual([
            {
                leg_id: 'stop-leg',
                state: 'suppressed',
                active_dispatch_slot: null,
                activation_id: null,
                intent_id: null,
                broker_authority: 0,
            },
            {
                leg_id: 'take-leg',
                state: 'winner',
                active_dispatch_slot: 1,
                activation_id: 'visibility-sell-activation',
                intent_id: 'visibility-sell-intent',
                broker_authority: 0,
            },
        ]);
        expect(
            verify.prepare(`
                SELECT COUNT(*) AS count FROM order_intents
                 WHERE intent_id IN (
                     'visibility-sell-intent',
                     'visibility-competing-intent'
                 )
            `).get(),
        ).toEqual({ count: 1 });
        verify.close();
    });

    it('atomically persists a fresh last-trade trigger, OCO winner, and restart-bound re-arm', async () => {
        const protectionLegs = [
            {
                legId: 'stop-leg',
                type: 'stop',
                comparator: 'lte',
                distance: { kind: 'pct_bps', pctBps: 300 },
                execution: {
                    priceType: 'MKT',
                    timeInForce: 'IOC',
                    limitPrice: null,
                },
            },
            {
                legId: 'take-leg',
                type: 'take',
                comparator: 'gte',
                distance: { kind: 'pct_bps', pctBps: 500 },
                execution: {
                    priceType: 'LMT',
                    timeInForce: 'ROD',
                    limitPrice: '105',
                },
            },
        ];
        const databasePath = await createMonitoringExitClaimFixture({
            protectionLegs,
        });
        const projection = protectedEntryProjection({ protectionLegs });
        seedProtectiveTriggerFillAndRearm(databasePath, projection);

        const faultDatabase = new DatabaseSync(databasePath);
        faultDatabase.exec(`
            CREATE TRIGGER fail_protective_winner_intent_insert
            BEFORE INSERT ON order_intents
            WHEN NEW.owner_kind='activation' AND NEW.side='Sell'
            BEGIN
                SELECT RAISE(ABORT, 'test protective trigger transaction fault');
            END;
        `);
        faultDatabase.close();

        const reopened = await openRepository({ databasePath });
        await expect(
            reopened.client.request('listProtectiveQuoteDemands', {
                apiGeneration: 'simulation-generation/1',
                runtimeEpochId: 'visibility-setup-runtime',
                senderFence: 'visibility-setup-fence',
            }),
        ).resolves.toEqual([
            {
                consumerId: expect.stringMatching(/^protection:[a-f0-9]{64}$/),
                contract: {
                    code: '2330',
                    exchange: 'TSE',
                    securityType: 'STK',
                },
                quoteType: 'tick',
            },
        ]);
        const observation = {
            contractKey: 'TSE:STK:2330',
            exchangeTimeMs: 1_786_377_600_300,
            field: 'last_price',
            mappingDefinitionSha256:
                SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
            mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
            observationId: `sha256:${'c'.repeat(64)}`,
            receiveTimeMs: 1_786_377_600_300,
            sequence: 1,
            streamEpoch: 'quote-stream-trigger-1',
            tradeDate: '2026-08-11',
            value: '105',
        };
        await expect(
            reopened.client.request('recordProtectiveQuoteObservation', {
                apiGeneration: 'simulation-generation/1',
                nowEpochMs: 1_786_377_600_300,
                observation,
                runtimeEpochId: 'visibility-setup-runtime',
                senderFence: 'visibility-setup-fence',
            }),
        ).rejects.toThrow('test protective trigger transaction fault');
        const rolledBack = new DatabaseSync(databasePath);
        expect(
            rolledBack.prepare(`
                SELECT
                    (SELECT COUNT(*) FROM observations) AS observations,
                    (SELECT COUNT(*) FROM protection_trigger_heads) AS heads,
                    (SELECT state FROM protection_groups
                      WHERE protection_group_id=?) AS group_state,
                    (SELECT state FROM exit_claims
                      WHERE exit_claim_id=?) AS claim_state
            `).get(VISIBILITY_PROTECTION_GROUP_ID, 'visibility-internal-claim'),
        ).toEqual({
            observations: 0,
            heads: 0,
            group_state: 'monitoring',
            claim_state: 'monitoring_reserved',
        });
        rolledBack.exec('DROP TRIGGER fail_protective_winner_intent_insert');
        rolledBack.close();
        await expect(
            reopened.client.request('recordProtectiveQuoteObservation', {
                apiGeneration: 'simulation-generation/1',
                nowEpochMs: 1_786_377_600_300,
                observation,
                runtimeEpochId: 'visibility-setup-runtime',
                senderFence: 'visibility-setup-fence',
            }),
        ).resolves.toMatchObject({
            state: 'winner_prepared',
            observedGroupCount: 1,
            preparedWinnerCount: 1,
            replayedGroupCount: 0,
            brokerWriteAuthority: false,
            automaticDispatchAllowed: false,
        });
        const beforeReplay = new DatabaseSync(databasePath, { readOnly: true });
        const beforeReplayProjection = beforeReplay.prepare(`
            SELECT
                (SELECT COUNT(*) FROM event_journal) AS journal_count,
                (SELECT revision FROM order_intents
                  WHERE intent_id=(SELECT winner_intent_id
                    FROM protection_remainder_generations
                   WHERE protection_group_id=? AND remainder_generation=0)) AS intent_revision,
                (SELECT revision FROM protection_trigger_heads
                  WHERE protection_group_id=? AND remainder_generation=0) AS head_revision
        `).get(VISIBILITY_PROTECTION_GROUP_ID, VISIBILITY_PROTECTION_GROUP_ID);
        beforeReplay.close();
        await expect(
            reopened.client.request('recordProtectiveQuoteObservation', {
                apiGeneration: 'simulation-generation/1',
                nowEpochMs: 1_786_377_600_300,
                observation,
                runtimeEpochId: 'visibility-setup-runtime',
                senderFence: 'visibility-setup-fence',
            }),
        ).resolves.toMatchObject({
            replayedGroupCount: 0,
            observedGroupCount: 0,
            preparedWinnerCount: 0,
        });
        const read = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            read.prepare(`
                SELECT
                    (SELECT COUNT(*) FROM event_journal) AS journal_count,
                    (SELECT revision FROM order_intents
                      WHERE intent_id=(SELECT winner_intent_id
                        FROM protection_remainder_generations
                       WHERE protection_group_id=? AND remainder_generation=0)) AS intent_revision,
                    (SELECT revision FROM protection_trigger_heads
                      WHERE protection_group_id=? AND remainder_generation=0) AS head_revision
            `).get(VISIBILITY_PROTECTION_GROUP_ID, VISIBILITY_PROTECTION_GROUP_ID),
        ).toEqual(beforeReplayProjection);
        const winner = read.prepare(`
            SELECT intents.intent_id, intents.state, intents.revision,
                   rearms.state AS rearm_state,
                   heads.state AS trigger_state,
                   heads.last_price_decimal,
                   heads.revision AS trigger_revision
              FROM protection_remainder_generations AS generations
              JOIN order_intents AS intents
                ON intents.intent_id=generations.winner_intent_id
              JOIN intent_rearm_authorizations AS rearms
                ON rearms.intent_id=intents.intent_id
              JOIN protection_trigger_heads AS heads
                ON heads.protection_group_id=generations.protection_group_id
               AND heads.remainder_generation=generations.remainder_generation
             WHERE generations.protection_group_id=?
        `).get(VISIBILITY_PROTECTION_GROUP_ID);
        read.close();
        expect(winner).toMatchObject({
            state: 'prepared',
            revision: 1,
            rearm_state: 'active',
            trigger_state: 'triggered',
            last_price_decimal: '105',
            trigger_revision: 0,
        });
        const next = await reopened.client.request('startRuntimeEpoch', {
            runtimeEpochId: 'visibility-restart-runtime',
            senderFence: 'visibility-restart-fence',
            apiGeneration: 'simulation-generation/2',
            leaseEvidenceHash: DIGEST_A,
            nowEpochMs: 1_786_377_600_400,
        });
        await expect(
            reopened.client.request('markRuntimeEpochReady', {
                runtimeEpochId: 'visibility-restart-runtime',
                senderFence: 'visibility-restart-fence',
                apiGeneration: 'simulation-generation/2',
                expectedRevision: next.revision,
                reconciliationEvidenceHash: DIGEST_B,
            }),
        ).rejects.toThrow('unresolved blockers');
        const afterRestart = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            afterRestart.prepare(`
                SELECT rearms.state AS rearm_state, strategies.state AS strategy_state
                  FROM order_intents AS intents
                  JOIN strategies ON strategies.strategy_id=intents.strategy_id
                  JOIN intent_rearm_authorizations AS rearms
                    ON rearms.intent_id=intents.intent_id
                 WHERE intents.intent_id=?
            `).get(winner.intent_id),
        ).toEqual({
            rearm_state: 'superseded',
            strategy_state: 'recovery',
        });
        afterRestart.close();
        await expect(
            reopened.client.request('rearmPreparedIntent', {
                rearmAuthorizationId: 'rearm-protective-after-restart',
                rearmRequestId: 'rearm-request-protective-after-restart',
                intentId: winner.intent_id,
                runtimeEpochId: 'visibility-restart-runtime',
                senderFence: 'visibility-restart-fence',
                apiGeneration: 'simulation-generation/2',
                expectedIntentRevision: winner.revision,
                confirmationSnapshotHash: DIGEST_B,
                riskRevision: 'risk-policy/1',
                reconciliationEvidenceHash: DIGEST_B,
                userRearmEvidenceHash: DIGEST_A,
                nowEpochMs: 1_786_377_600_425,
            }),
        ).resolves.toMatchObject({
            intentId: winner.intent_id,
            state: 'active',
            replayed: false,
        });
        await expect(
            reopened.client.request('markRuntimeEpochReady', {
                runtimeEpochId: 'visibility-restart-runtime',
                senderFence: 'visibility-restart-fence',
                apiGeneration: 'simulation-generation/2',
                expectedRevision: next.revision,
                reconciliationEvidenceHash: DIGEST_B,
            }),
        ).resolves.toMatchObject({ state: 'ready' });
    });

    it('durably advances trailing activation and saved high before preparing the retracement winner', async () => {
        const protectionLegs = [
            {
                legId: 'activate-leg',
                type: 'trailing_activation',
                comparator: 'gte',
                distance: { kind: 'pct_bps', pctBps: 300 },
                execution: {
                    priceType: 'MKT',
                    timeInForce: 'IOC',
                    limitPrice: null,
                },
            },
            {
                legId: 'retrace-leg',
                type: 'trailing_retracement',
                comparator: 'lte',
                distance: { kind: 'pct_bps', pctBps: 500 },
                execution: {
                    priceType: 'LMT',
                    timeInForce: 'IOC',
                    limitPrice: '100',
                },
            },
            {
                legId: 'fixed-stop-leg',
                type: 'fixed_stop',
                comparator: 'lte',
                distance: { kind: 'absolute', value: '10' },
                execution: {
                    priceType: 'MKT',
                    timeInForce: 'IOC',
                    limitPrice: null,
                },
            },
        ];
        const databasePath = await createMonitoringExitClaimFixture({
            protectionFamily: 'trailing',
            protectionLegs,
        });
        const projection = protectedEntryProjection({
            protectionFamily: 'trailing',
            protectionLegs,
        });
        seedProtectiveTriggerFillAndRearm(databasePath, projection);
        const reopened = await openRepository({ databasePath });
        const observe = (
            value,
            sequence,
            id,
            time,
            streamEpoch = 'quote-stream-trailing-1',
        ) =>
            reopened.client.request('recordProtectiveQuoteObservation', {
                apiGeneration: 'simulation-generation/1',
                nowEpochMs: time,
                observation: {
                    contractKey: 'TSE:STK:2330',
                    exchangeTimeMs: time,
                    field: 'last_price',
                    mappingDefinitionSha256:
                        SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
                    mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
                    observationId: `sha256:${id.repeat(64)}`,
                    receiveTimeMs: time,
                    sequence,
                    streamEpoch,
                    tradeDate: '2026-08-11',
                    value,
                },
                runtimeEpochId: 'visibility-setup-runtime',
                senderFence: 'visibility-setup-fence',
            });
        await expect(
            observe('103', 1, 'c', 1_786_377_600_300),
        ).resolves.toMatchObject({
            state: 'observed',
            observedGroupCount: 1,
            preparedWinnerCount: 0,
        });
        await expect(
            observe(
                '109',
                2,
                'f',
                1_786_377_600_305,
                'quote-stream-after-gap',
            ),
        ).rejects.toThrow('lineage changed');
        await expect(
            observe('110', 2, 'd', 1_786_377_600_310),
        ).resolves.toMatchObject({
            state: 'observed',
            observedGroupCount: 1,
            preparedWinnerCount: 0,
        });
        const beforeRetracement = new DatabaseSync(databasePath, {
            readOnly: true,
        });
        expect(
            beforeRetracement.prepare(`
                SELECT family, state, saved_high_decimal,
                       retracement_trigger_decimal, triggered_leg_id,
                       last_price_decimal, revision
                  FROM protection_trigger_heads
                 WHERE protection_group_id=? AND remainder_generation=0
            `).get(VISIBILITY_PROTECTION_GROUP_ID),
        ).toEqual({
            family: 'trailing',
            state: 'active',
            saved_high_decimal: '110',
            retracement_trigger_decimal: '104.5',
            triggered_leg_id: null,
            last_price_decimal: '110',
            revision: 1,
        });
        beforeRetracement.close();
        await expect(
            observe('104.5', 3, 'e', 1_786_377_600_320),
        ).resolves.toMatchObject({
            state: 'winner_prepared',
            observedGroupCount: 1,
            preparedWinnerCount: 1,
        });
        const verify = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verify.prepare(`
                SELECT heads.state, heads.saved_high_decimal,
                       heads.retracement_trigger_decimal,
                       heads.triggered_leg_id,
                       generations.winner_leg_id,
                       (SELECT COUNT(*) FROM order_intents AS intents
                         WHERE intents.intent_id=generations.winner_intent_id
                           AND intents.state='prepared') AS prepared_intents
                  FROM protection_trigger_heads AS heads
                  JOIN protection_remainder_generations AS generations
                    ON generations.protection_group_id=heads.protection_group_id
                   AND generations.remainder_generation=heads.remainder_generation
                 WHERE heads.protection_group_id=?
            `).get(VISIBILITY_PROTECTION_GROUP_ID),
        ).toEqual({
            state: 'triggered',
            saved_high_decimal: '110',
            retracement_trigger_decimal: '104.5',
            triggered_leg_id: 'retrace-leg',
            winner_leg_id: 'retrace-leg',
            prepared_intents: 1,
        });
        expect(
            verify.prepare(`
                SELECT summary_code
                  FROM event_journal
                 WHERE entity_kind='protection_leg_evaluation'
                 ORDER BY local_monotonic_sequence
            `).all(),
        ).toEqual([
            { summary_code: 'protection_trailing_activated' },
            { summary_code: 'protection_trailing_extreme_updated' },
            { summary_code: 'protection_leg_winner' },
            { summary_code: 'protection_trigger_winner_prepared' },
        ]);
        verify.close();
    });

    it('persists the directionally rounded legal-tick stop before preparing its OCO winner', async () => {
        const protectionLegs = [
            {
                legId: 'rounded-stop-leg',
                type: 'stop',
                comparator: 'lte',
                distance: { kind: 'pct_bps', pctBps: 333 },
                execution: {
                    priceType: 'MKT',
                    timeInForce: 'IOC',
                    limitPrice: null,
                },
            },
            {
                legId: 'rounded-take-leg',
                type: 'take',
                comparator: 'gte',
                distance: { kind: 'pct_bps', pctBps: 500 },
                execution: {
                    priceType: 'LMT',
                    timeInForce: 'ROD',
                    limitPrice: '105',
                },
            },
        ];
        const databasePath = await createMonitoringExitClaimFixture({
            protectionLegs,
        });
        seedProtectiveTriggerFillAndRearm(
            databasePath,
            protectedEntryProjection({ protectionLegs }),
        );
        const reopened = await openRepository({ databasePath });
        await expect(
            reopened.client.request('recordProtectiveQuoteObservation', {
                apiGeneration: 'simulation-generation/1',
                nowEpochMs: 1_786_377_600_300,
                observation: {
                    contractKey: 'TSE:STK:2330',
                    exchangeTimeMs: 1_786_377_600_300,
                    field: 'last_price',
                    mappingDefinitionSha256:
                        SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
                    mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
                    observationId: `sha256:${'8'.repeat(64)}`,
                    receiveTimeMs: 1_786_377_600_300,
                    sequence: 1,
                    streamEpoch: 'quote-stream-rounded-stop',
                    tradeDate: '2026-08-11',
                    value: '96.68',
                },
                runtimeEpochId: 'visibility-setup-runtime',
                senderFence: 'visibility-setup-fence',
            }),
        ).resolves.toMatchObject({
            state: 'winner_prepared',
            preparedWinnerCount: 1,
        });
        const verify = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verify.prepare(`
                SELECT heads.state, heads.triggered_leg_id,
                       generations.winner_leg_id
                  FROM protection_trigger_heads AS heads
                  JOIN protection_remainder_generations AS generations
                    ON generations.protection_group_id=heads.protection_group_id
                   AND generations.remainder_generation=heads.remainder_generation
                 WHERE heads.protection_group_id=?
            `).get(VISIBILITY_PROTECTION_GROUP_ID),
        ).toEqual({
            state: 'triggered',
            triggered_leg_id: 'rounded-stop-leg',
            winner_leg_id: 'rounded-stop-leg',
        });
        verify.close();
    });

    it('uses the current strategy resume arm to restore fixed protection monitoring after restart before any trigger', async () => {
        const protectionLegs = [
            {
                legId: 'stop-leg',
                type: 'stop',
                comparator: 'lte',
                distance: { kind: 'pct_bps', pctBps: 300 },
                execution: {
                    priceType: 'MKT',
                    timeInForce: 'IOC',
                    limitPrice: null,
                },
            },
            {
                legId: 'take-leg',
                type: 'take',
                comparator: 'gte',
                distance: { kind: 'pct_bps', pctBps: 500 },
                execution: {
                    priceType: 'LMT',
                    timeInForce: 'ROD',
                    limitPrice: '105',
                },
            },
        ];
        const databasePath = await createMonitoringExitClaimFixture({
            protectionLegs,
        });
        seedProtectiveTriggerFillAndRearm(
            databasePath,
            protectedEntryProjection({ protectionLegs }),
        );
        const reopened = await openRepository({ databasePath });
        const restarted = await reopened.client.request('startRuntimeEpoch', {
            runtimeEpochId: 'visibility-before-trigger-restart',
            senderFence: 'visibility-before-trigger-fence',
            apiGeneration: 'simulation-generation/2',
            leaseEvidenceHash: DIGEST_A,
            nowEpochMs: 1_786_377_600_400,
        });
        await expect(
            reopened.client.request('markRuntimeEpochReady', {
                runtimeEpochId: 'visibility-before-trigger-restart',
                senderFence: 'visibility-before-trigger-fence',
                apiGeneration: 'simulation-generation/2',
                expectedRevision: restarted.revision,
                reconciliationEvidenceHash: DIGEST_B,
            }),
        ).resolves.toMatchObject({ state: 'ready' });
        seedEligibleManualGate(databasePath, {
            createdAtEpochMs: 1_786_377_600_410,
        });
        const pausedDatabase = new DatabaseSync(databasePath, {
            readOnly: true,
        });
        const paused = pausedDatabase
            .prepare('SELECT state, revision FROM strategies WHERE strategy_id=?')
            .get('strategy-1');
        pausedDatabase.close();
        expect(paused.state).toBe('paused');
        await expect(
            reopened.client.request('resumeStrategy', {
                activationPolicyAcknowledged: true,
                apiGeneration: 'simulation-generation/2',
                authorityId: 'resume-protection-before-trigger',
                contractEvidence: null,
                expectedRevision: paused.revision,
                nowEpochMs: 1_786_377_600_420,
                runtimeEpochId: 'visibility-before-trigger-restart',
                senderFence: 'visibility-before-trigger-fence',
                strategyId: 'strategy-1',
                userArmEvidenceHash: DIGEST_A,
            }),
        ).resolves.toMatchObject({ state: 'monitoring' });
        await expect(
            reopened.client.request('recordProtectiveQuoteObservation', {
                apiGeneration: 'simulation-generation/2',
                nowEpochMs: 1_786_377_600_430,
                observation: {
                    contractKey: 'TSE:STK:2330',
                    exchangeTimeMs: 1_786_377_600_430,
                    field: 'last_price',
                    mappingDefinitionSha256:
                        SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
                    mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
                    observationId: `sha256:${'9'.repeat(64)}`,
                    receiveTimeMs: 1_786_377_600_430,
                    sequence: 1,
                    streamEpoch: 'quote-stream-after-restart',
                    tradeDate: '2026-08-11',
                    value: '105',
                },
                runtimeEpochId: 'visibility-before-trigger-restart',
                senderFence: 'visibility-before-trigger-fence',
            }),
        ).resolves.toMatchObject({
            state: 'winner_prepared',
            preparedWinnerCount: 1,
            brokerWriteAuthority: false,
        });
    });

    it('prepares one exact entry-cancel intent and atomically enters manual intervention when crossed-point reconciliation cannot prove its outcome', async () => {
        const databasePath = await createMonitoringExitClaimFixture({
            claimQuantityShares: 500,
            entryCommittedShares: 1_000,
            entryDisposition: 'working',
        });
        const reopened = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: [
                defaultExternalSellVisibilityHead(),
            ],
        });
        await reopened.client.request(
            'mutateKillSwitch',
            killSwitchMutationInput({
                apiGeneration: 'simulation-generation/1',
                runtimeEpochId: 'visibility-setup-runtime',
                senderFence: 'visibility-setup-fence',
                switchName: 'pause_new_exposure',
            }),
        );
        const protectiveProjection = protectiveBrokerIntentProjection({
            quantityShares: 500,
        });
        const payload = protectiveProjection.payload;
        const input = protectiveSellIntent({
            intent: {
                payload,
                payloadHash: protectiveProjection.payloadSha256,
            },
            exitClaim: {
                quantityShares: 500,
                expectedRevision: 0,
                expectedGroupRevision: 0,
                expectedGenerationRevision: 0,
            },
        });
        const prepared = await reopened.client.request('prepareIntent', input);
        expect(prepared).toMatchObject({
            adapterAuthorityGranted: false,
            automaticExitAllowed: false,
            brokerWriteAttempted: false,
            cancelIntentId: expect.stringContaining(
                'protective-entry-cancel-intent:',
            ),
            cancelTargetBrokerOrderId: 'visibility-entry-broker-order',
            entryDisposition: 'entry_cancel_prepared',
            replayed: false,
        });
        await expect(
            reopened.client.request('prepareIntent', input),
        ).resolves.toMatchObject({
            cancelIntentId: prepared.cancelIntentId,
            entryDisposition: 'entry_cancel_prepared',
            replayed: true,
        });
        const runtimeEvidence = new DatabaseSync(databasePath, {
            readOnly: true,
        });
        const reconciliationEvidenceHash = runtimeEvidence.prepare(`
            SELECT reconciliation_evidence_hash FROM runtime_epochs
             WHERE runtime_epoch_id='visibility-setup-runtime'
        `).get().reconciliation_evidence_hash;
        runtimeEvidence.close();
        await reopened.client.request('rearmPreparedIntent', {
            rearmAuthorizationId: 'protective-entry-cancel-rearm',
            rearmRequestId: 'protective-entry-cancel-rearm-request',
            intentId: prepared.cancelIntentId,
            runtimeEpochId: 'visibility-setup-runtime',
            senderFence: 'visibility-setup-fence',
            apiGeneration: 'simulation-generation/1',
            expectedIntentRevision: 0,
            confirmationSnapshotHash: DIGEST_B,
            riskRevision: 'risk-policy/1',
            reconciliationEvidenceHash,
            userRearmEvidenceHash: DIGEST_A,
            nowEpochMs: 1_786_377_600_325,
        });
        await expect(
            reopened.client.request('markIntentDispatching', {
                intentId: prepared.cancelIntentId,
                runtimeEpochId: 'visibility-setup-runtime',
                senderFence: 'visibility-setup-fence',
                apiGeneration: 'simulation-generation/1',
                dispatchAttemptNonce: 'protective-entry-cancel-attempt',
                expectedRevision: 1,
                expectedActivationRevision: 0,
                expectedRearmRevision: 0,
                modeRevision: 'simulation-generation/1',
                riskRevision: 'risk-policy/1',
                accountRevision: 'account-reconciliation/1',
                targetRevision: 'server-derived-at-dispatch',
                expectedKillSwitchArbiterRevision: 1,
                nowEpochMs: 1_786_377_600_350,
            }),
        ).resolves.toMatchObject({
            state: 'dispatching',
            killSwitchOperationClass: 'protective_entry_cancel',
            durableBeforeAdapterAuthority: true,
        });
        await expect(
            reopened.client.request('materializeProtectedEntryFill', {
                runtimeEpochId: 'visibility-setup-runtime',
                senderFence: 'visibility-setup-fence',
                apiGeneration: 'simulation-generation/1',
                intentId: 'intent-1',
                nowEpochMs: 1_786_377_600_375,
                reconciliation: protectedEntryReconciliation({
                    asOfEpochMs: 1_786_377_600_360,
                    availableShares: 500,
                    dealIds: [],
                    positionLineageId: 'visibility-position-lineage',
                    quantityShares: 500,
                }),
            }),
        ).resolves.toMatchObject({
            state: 'manual_intervention',
            reason: 'protected_entry_cancel_outcome_not_unique',
            runtimeState: 'reconciling',
            automaticRetryAllowed: false,
            brokerWriteAuthority: false,
        });
        await reopened.client.close();
        openClients.delete(reopened.client);

        const verify = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verify.prepare(`
                SELECT operation_kind, owner_kind, state,
                       target_broker_order_id, target_control_revision,
                       adapter_authority_granted, revision
                  FROM order_intents WHERE intent_id=?
            `).get(prepared.cancelIntentId),
        ).toEqual({
            operation_kind: 'cancel',
            owner_kind: 'activation',
            state: 'dispatching',
            target_broker_order_id: 'visibility-entry-broker-order',
            target_control_revision: 0,
            adapter_authority_granted: 1,
            revision: 2,
        });
        expect(
            verify.prepare(`
                SELECT COUNT(*) AS count FROM intent_rearm_authorizations
                 WHERE intent_id=? AND state='consumed'
            `).get(prepared.cancelIntentId),
        ).toEqual({ count: 1 });
        expect(
            verify.prepare(`
                SELECT COUNT(*) AS count FROM order_intents
                 WHERE intent_id='visibility-sell-intent'
            `).get(),
        ).toEqual({ count: 0 });
        expect(
            verify.prepare(`
                SELECT state, intent_id, revision FROM exit_claims
                 WHERE exit_claim_id='visibility-internal-claim'
            `).get(),
        ).toEqual({
            state: 'unknown',
            intent_id: null,
            revision: 1,
        });
        expect(
            verify.prepare(`
                SELECT state FROM strategies WHERE strategy_id='strategy-1'
            `).get(),
        ).toEqual({ state: 'manual_intervention' });
        expect(
            verify.prepare(`
                SELECT reason_code, state FROM resolution_cases
                 WHERE strategy_id='strategy-1'
            `).get(),
        ).toEqual({ reason_code: 'ENTRY_RESULT_UNKNOWN', state: 'open' });
        verify.close();
    });

    it('moves a prepared entry-cancel to manual protection when pause_automation wins the replay race', async () => {
        const databasePath = await createMonitoringExitClaimFixture({
            claimQuantityShares: 500,
            entryCommittedShares: 1_000,
            entryDisposition: 'working',
        });
        const reopened = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: [
                defaultExternalSellVisibilityHead(),
            ],
        });
        const protectiveProjection = protectiveBrokerIntentProjection({
            quantityShares: 500,
        });
        const payload = protectiveProjection.payload;
        const input = protectiveSellIntent({
            intent: {
                payload,
                payloadHash: protectiveProjection.payloadSha256,
            },
            exitClaim: {
                quantityShares: 500,
                expectedRevision: 0,
                expectedGroupRevision: 0,
                expectedGenerationRevision: 0,
            },
        });
        const prepared = await reopened.client.request('prepareIntent', input);
        expect(prepared).toMatchObject({
            entryDisposition: 'entry_cancel_prepared',
            adapterAuthorityGranted: false,
        });
        await reopened.client.request(
            'mutateKillSwitch',
            killSwitchMutationInput({
                apiGeneration: 'simulation-generation/1',
                runtimeEpochId: 'visibility-setup-runtime',
                senderFence: 'visibility-setup-fence',
                switchName: 'pause_automation',
                reasonCode: 'automation_pause',
            }),
        );
        await expect(
            reopened.client.request('prepareIntent', input),
        ).resolves.toMatchObject({
            entryDisposition: 'manual_intervention',
            automaticExitAllowed: false,
            brokerWriteAttempted: false,
        });
        await reopened.client.close();
        openClients.delete(reopened.client);

        const verify = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verify.prepare(`
                SELECT state, adapter_authority_granted FROM order_intents
                 WHERE intent_id=?
            `).get(prepared.cancelIntentId),
        ).toEqual({ state: 'prepared', adapter_authority_granted: 0 });
        expect(
            verify.prepare(`
                SELECT strategies.state AS strategy_state,
                       claims.state AS claim_state,
                       groups.state AS group_state
                  FROM strategies
                  JOIN protection_obligations AS obligations
                    ON obligations.strategy_id=strategies.strategy_id
                  JOIN exit_claims AS claims
                    ON claims.obligation_id=obligations.obligation_id
                  JOIN protection_groups AS groups
                    ON groups.exit_claim_id=claims.exit_claim_id
                 WHERE strategies.strategy_id='strategy-1'
            `).get(),
        ).toEqual({
            strategy_state: 'manual_intervention',
            claim_state: 'unknown',
            group_state: 'unknown',
        });
        expect(
            verify.prepare(`
                SELECT COUNT(*) AS count FROM intent_rearm_authorizations
                 WHERE intent_id=? AND state='active'
            `).get(prepared.cancelIntentId),
        ).toEqual({ count: 0 });
        verify.close();
    });

    it.each([
        ['pause_automation', 'working'],
        ['entry_result_unknown', 'unknown'],
    ])(
        'moves protection to manual intervention without an exit for %s',
        async (scenario, entryDisposition) => {
            const databasePath = await createMonitoringExitClaimFixture({
                claimQuantityShares: 500,
                entryCommittedShares: 1_000,
                entryDisposition,
            });
            const reopened = await openRepository({
                databasePath,
                testOnlyExternalSellVisibilityHeads: [
                    defaultExternalSellVisibilityHead(),
                ],
            });
            if (scenario === 'pause_automation') {
                await reopened.client.request(
                    'mutateKillSwitch',
                    killSwitchMutationInput({
                        apiGeneration: 'simulation-generation/1',
                        runtimeEpochId: 'visibility-setup-runtime',
                        senderFence: 'visibility-setup-fence',
                        switchName: 'pause_automation',
                        reasonCode: 'automation_pause',
                    }),
                );
            }
            const protectiveProjection = protectiveBrokerIntentProjection({
                quantityShares: 500,
            });
            const payload = protectiveProjection.payload;
            const result = await reopened.client.request(
                'prepareIntent',
                protectiveSellIntent({
                    intent: {
                        payload,
                        payloadHash: protectiveProjection.payloadSha256,
                    },
                    exitClaim: {
                        quantityShares: 500,
                        expectedRevision: 0,
                        expectedGroupRevision: 0,
                        expectedGenerationRevision: 0,
                    },
                }),
            );
            expect(result).toMatchObject({
                adapterAuthorityGranted: false,
                automaticExitAllowed: false,
                brokerWriteAttempted: false,
                cancelIntentId: null,
                entryDisposition: 'manual_intervention',
                replayed: false,
            });
            await reopened.client.close();
            openClients.delete(reopened.client);

            const verify = new DatabaseSync(databasePath, { readOnly: true });
            expect(
                verify.prepare(`
                    SELECT state FROM strategies WHERE strategy_id='strategy-1'
                `).get(),
            ).toEqual({ state: 'manual_intervention' });
            expect(
                verify.prepare(`
                    SELECT state, intent_id FROM exit_claims
                     WHERE exit_claim_id='visibility-internal-claim'
                `).get(),
            ).toEqual({ state: 'unknown', intent_id: null });
            expect(
                verify.prepare(`
                    SELECT COUNT(*) AS count FROM order_intents
                     WHERE intent_id='visibility-sell-intent'
                        OR client_request_id LIKE 'protective-entry-cancel:%'
                `).get(),
            ).toEqual({ count: 0 });
            expect(
                verify.prepare(`
                    SELECT reason_code, state FROM resolution_cases
                     WHERE strategy_id='strategy-1'
                       AND reason_code='ENTRY_RESULT_UNKNOWN'
                `).get(),
            ).toEqual({
                reason_code: 'ENTRY_RESULT_UNKNOWN',
                state: 'open',
            });
            verify.close();
        },
    );

    it('rolls back the entry-cancel activation and intent when durable preparation faults', async () => {
        const databasePath = await createMonitoringExitClaimFixture({
            claimQuantityShares: 500,
            entryCommittedShares: 1_000,
            entryDisposition: 'working',
        });
        const fault = new DatabaseSync(databasePath);
        fault.exec(`
            CREATE TRIGGER test_protected_entry_cancel_prepare_crash
            BEFORE INSERT ON order_intents
            WHEN NEW.client_request_id LIKE 'protective-entry-cancel:%'
            BEGIN
                SELECT RAISE(ABORT, 'test protected entry cancel prepare crash');
            END;
        `);
        fault.close();
        const reopened = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: [
                defaultExternalSellVisibilityHead(),
            ],
        });
        const protectiveProjection = protectiveBrokerIntentProjection({
            quantityShares: 500,
        });
        const payload = protectiveProjection.payload;
        await expect(
            reopened.client.request(
                'prepareIntent',
                protectiveSellIntent({
                    intent: {
                        payload,
                        payloadHash: protectiveProjection.payloadSha256,
                    },
                    exitClaim: {
                        quantityShares: 500,
                        expectedRevision: 0,
                        expectedGroupRevision: 0,
                        expectedGenerationRevision: 0,
                    },
                }),
            ),
        ).rejects.toThrow('test protected entry cancel prepare crash');
        await reopened.client.close();
        openClients.delete(reopened.client);

        const verify = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verify.prepare(`
                SELECT COUNT(*) AS count FROM order_intents
                 WHERE client_request_id LIKE 'protective-entry-cancel:%'
            `).get(),
        ).toEqual({ count: 0 });
        expect(
            verify.prepare(`
                SELECT COUNT(*) AS count FROM activations
                 WHERE logical_key LIKE 'protected-entry-cancel:%'
            `).get(),
        ).toEqual({ count: 0 });
        expect(
            verify.prepare(`
                SELECT state, revision FROM exit_claims
                 WHERE exit_claim_id='visibility-internal-claim'
            `).get(),
        ).toEqual({ state: 'monitoring_reserved', revision: 0 });
        verify.close();
    });

    it('rolls back every manual-intervention companion when the safety blocker commit faults', async () => {
        const databasePath = await createMonitoringExitClaimFixture({
            claimQuantityShares: 500,
            entryCommittedShares: 1_000,
            entryDisposition: 'unknown',
        });
        const fault = new DatabaseSync(databasePath);
        fault.exec(`
            CREATE TRIGGER test_protected_entry_manual_commit_crash
            BEFORE INSERT ON safety_blockers
            WHEN NEW.reason_code='ENTRY_RESULT_UNKNOWN'
            BEGIN
                SELECT RAISE(ABORT, 'test protected entry manual commit crash');
            END;
        `);
        fault.close();
        const reopened = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: [
                defaultExternalSellVisibilityHead(),
            ],
        });
        const protectiveProjection = protectiveBrokerIntentProjection({
            quantityShares: 500,
        });
        const payload = protectiveProjection.payload;
        await expect(
            reopened.client.request(
                'prepareIntent',
                protectiveSellIntent({
                    intent: {
                        payload,
                        payloadHash: protectiveProjection.payloadSha256,
                    },
                    exitClaim: {
                        quantityShares: 500,
                        expectedRevision: 0,
                        expectedGroupRevision: 0,
                        expectedGenerationRevision: 0,
                    },
                }),
            ),
        ).rejects.toThrow('test protected entry manual commit crash');
        await reopened.client.close();
        openClients.delete(reopened.client);

        const verify = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verify.prepare(`
                SELECT strategies.state AS strategy_state,
                       claims.state AS claim_state,
                       obligations.state AS obligation_state,
                       groups.state AS group_state,
                       generations.state AS generation_state
                  FROM strategies
                  JOIN protection_obligations AS obligations
                    ON obligations.strategy_id=strategies.strategy_id
                  JOIN exit_claims AS claims
                    ON claims.obligation_id=obligations.obligation_id
                  JOIN protection_groups AS groups
                    ON groups.exit_claim_id=claims.exit_claim_id
                  JOIN protection_remainder_generations AS generations
                    ON generations.protection_group_id=groups.protection_group_id
                   AND generations.remainder_generation=groups.current_generation
                 WHERE strategies.strategy_id='strategy-1'
            `).get(),
        ).toEqual({
            strategy_state: 'monitoring',
            claim_state: 'monitoring_reserved',
            obligation_state: 'monitoring',
            group_state: 'monitoring',
            generation_state: 'monitoring',
        });
        expect(
            verify.prepare(`
                SELECT COUNT(*) AS count FROM resolution_cases
                 WHERE reason_code='ENTRY_RESULT_UNKNOWN'
            `).get(),
        ).toEqual({ count: 0 });
        verify.close();
    });

    it('rolls back the winner, siblings, activation, intent, and claim when OCO winner commit crashes', async () => {
        const protectionLegs = [
            {
                legId: 'stop-leg',
                type: 'stop',
                comparator: 'lte',
                distance: { kind: 'pct_bps', pctBps: 300 },
                execution: {
                    priceType: 'MKT',
                    timeInForce: 'IOC',
                    limitPrice: null,
                },
            },
            {
                legId: 'take-leg',
                type: 'take',
                comparator: 'gte',
                distance: { kind: 'pct_bps', pctBps: 500 },
                execution: {
                    priceType: 'LMT',
                    timeInForce: 'ROD',
                    limitPrice: '105',
                },
            },
        ];
        const databasePath = await createMonitoringExitClaimFixture({
            protectionLegs,
        });
        const fault = new DatabaseSync(databasePath);
        fault.exec(`
            CREATE TRIGGER test_protection_oco_winner_commit_crash
            BEFORE INSERT ON protection_leg_evaluations
            WHEN NEW.leg_id='take-leg'
            BEGIN
                SELECT RAISE(ABORT, 'test protection OCO winner commit crash');
            END;
        `);
        fault.close();
        const reopened = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: [
                defaultExternalSellVisibilityHead(),
            ],
        });
        await expect(
            reopened.client.request(
                'prepareIntent',
                protectiveSellIntent({
                    intent: (() => {
                        const projection = protectiveBrokerIntentProjection({
                            legId: 'stop-leg',
                            protectionPlan: protectedEntryProjection({
                                protectionLegs,
                            }).payload.protectionPlan,
                            triggerPolicyHash: DIGEST_B,
                        });
                        return {
                            payload: projection.payload,
                            payloadHash: projection.payloadSha256,
                        };
                    })(),
                    exitClaim: {
                        candidateEvaluations: [
                            {
                                legId: 'stop-leg',
                                evidenceHash: DIGEST_B,
                                observedAtEpochMs: 1_786_377_600_300,
                            },
                            {
                                legId: 'take-leg',
                                evidenceHash: DIGEST_A,
                                observedAtEpochMs: 1_786_377_600_300,
                            },
                        ],
                    },
                }),
            ),
        ).rejects.toThrow('test protection OCO winner commit crash');
        await reopened.client.close();
        openClients.delete(reopened.client);
        const verify = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verify.prepare(`
                SELECT intent_id, state, revision FROM exit_claims
                 WHERE exit_claim_id='visibility-internal-claim'
            `).get(),
        ).toEqual({ intent_id: null, state: 'monitoring_reserved', revision: 0 });
        expect(
            verify.prepare(`
                SELECT state, revision FROM protection_groups
                 WHERE protection_group_id=?
            `).get(VISIBILITY_PROTECTION_GROUP_ID),
        ).toEqual({ state: 'monitoring', revision: 0 });
        expect(
            verify.prepare(`
                SELECT state, winner_leg_id, winner_intent_id, revision
                  FROM protection_remainder_generations
                 WHERE protection_group_id=? AND remainder_generation=0
            `).get(VISIBILITY_PROTECTION_GROUP_ID),
        ).toEqual({
            state: 'monitoring',
            winner_leg_id: null,
            winner_intent_id: null,
            revision: 0,
        });
        expect(
            verify.prepare(`
                SELECT COUNT(*) AS count FROM protection_leg_evaluations
                 WHERE protection_group_id=?
            `).get(VISIBILITY_PROTECTION_GROUP_ID),
        ).toEqual({ count: 0 });
        expect(
            verify.prepare(`
                SELECT COUNT(*) AS count FROM order_intents
                 WHERE intent_id='visibility-sell-intent'
            `).get(),
        ).toEqual({ count: 0 });
        expect(
            verify.prepare(`
                SELECT COUNT(*) AS count FROM activations
                 WHERE activation_id='visibility-sell-activation'
            `).get(),
        ).toEqual({ count: 0 });
        verify.close();
    });

    it('atomically cancels only a proven-unsent prepared intent under an exact durable strategy-cancel authority', async () => {
        const { client, databasePath } = await openRepository();
        await insertPreparedIntent(client);
        const localCancel = preparedIntentLocalCancelInput();

        await expect(
            client.request('cancelPreparedIntentProvenUnsent', localCancel),
        ).rejects.toThrow('lacks a completed strategy-cancel authority');
        await expect(
            client.request('cancelPreparedIntentProvenUnsent', {
                ...localCancel,
                authorization: {
                    ...localCancel.authorization,
                    actorKind: 'lifecycle_service',
                },
            }),
        ).rejects.toThrow('requires interactive user authority');
        await expect(
            client.request(
                'executeReplayProtectedStrategyMutation',
                strategyCancelMutationInput(),
            ),
        ).resolves.toMatchObject({
            state: 'completed',
            result: {
                strategyId: 'strategy-1',
                state: 'cancel_pending',
                revision: 1,
            },
        });
        await expect(
            client.request('cancelPreparedIntentProvenUnsent', {
                ...localCancel,
                authorization: {
                    ...localCancel.authorization,
                    evidenceHash: DIGEST_B,
                },
            }),
        ).rejects.toThrow('lacks a completed strategy-cancel authority');

        const cancelled = await client.request(
            'cancelPreparedIntentProvenUnsent',
            localCancel,
        );
        expect(cancelled).toMatchObject({
            schemaVersion:
                'smart-order-prepared-intent-local-cancel-result/2026-08-12.1',
            intentId: 'intent-1',
            state: 'cancelled_proven_unsent',
            terminalOutcome: 'place_cancelled_proven_unsent',
            revision: 1,
            activationState: 'cancelled',
            activationRevision: 1,
            reservationState: 'released',
            reservationRevision: 1,
            strategyState: 'cancelled',
            strategyRevision: 2,
            authorizationId: 'strategy-cancel-authority-1',
            authorizationConsumed: true,
            actorKind: 'interactive_user',
            brokerCallRequired: false,
            adapterAuthorityGranted: false,
            replayed: false,
        });
        await expect(
            client.request('cancelPreparedIntentProvenUnsent', localCancel),
        ).resolves.toEqual({ ...cancelled, replayed: true });
        await expect(
            client.request('cancelPreparedIntentProvenUnsent', {
                ...localCancel,
                requestId: 'prepared-local-cancel-replayed-under-new-id',
                nowEpochMs: localCancel.nowEpochMs + 1,
            }),
        ).rejects.toThrow('lost its proven-unsent CAS');

        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database
                .prepare(`
                    SELECT state, terminal_outcome, adapter_authority_granted,
                           dispatch_attempt_nonce, revision
                      FROM order_intents WHERE intent_id='intent-1'
                `)
                .get(),
        ).toEqual({
            state: 'cancelled_proven_unsent',
            terminal_outcome: 'place_cancelled_proven_unsent',
            adapter_authority_granted: 0,
            dispatch_attempt_nonce: null,
            revision: 1,
        });
        expect(
            database
                .prepare(`
                    SELECT state, terminal_at_epoch_ms, revision
                      FROM entry_exposure_reservations
                     WHERE reservation_id='reservation-1'
                `)
                .get(),
        ).toEqual({
            state: 'released',
            terminal_at_epoch_ms: localCancel.nowEpochMs,
            revision: 1,
        });
        expect(
            database
                .prepare(`
                    SELECT state, terminal_at_epoch_ms, revision
                      FROM strategies WHERE strategy_id='strategy-1'
                `)
                .get(),
        ).toEqual({
            state: 'cancelled',
            terminal_at_epoch_ms: localCancel.nowEpochMs,
            revision: 2,
        });
        expect(
            database
                .prepare(`
                    SELECT COUNT(*) AS count FROM authority_consumptions
                     WHERE authority_kind='prepared_intent_local_cancel'
                `)
                .get()?.count,
        ).toBe(1);
        expect(
            database
                .prepare(`
                    SELECT reason_code FROM event_journal
                     WHERE entity_id IN (
                         'intent-1', 'activation-1', 'reservation-1', 'strategy-1'
                     ) AND reason_code IN (
                         'INTENT_CANCELLED_PROVEN_UNSENT',
                         'ENTRY_RESERVATION_RELEASED',
                         'STRATEGY_CANCEL_DRAIN_COMPLETE'
                     ) ORDER BY journal_sequence
                `)
                .all()
                .map((row) => row.reason_code),
        ).toEqual([
            'INTENT_CANCELLED_PROVEN_UNSENT',
            'INTENT_CANCELLED_PROVEN_UNSENT',
            'ENTRY_RESERVATION_RELEASED',
            'STRATEGY_CANCEL_DRAIN_COMPLETE',
        ]);
        database.close();
    });

    it('derives the prepared-intent drain only from the current durable strategy-cancel authority', async () => {
        const { client } = await openRepository();
        await insertPreparedIntent(client);
        await client.request(
            'executeReplayProtectedStrategyMutation',
            strategyCancelMutationInput(),
        );
        const candidate = await client.request('preparedIntentDrainCandidate', {
            strategyId: 'strategy-1',
            expectedRevision: 1,
        });
        expect(candidate).toMatchObject({
            authorization: {
                authorizationId: 'strategy-cancel-authority-1',
                actorKind: 'interactive_user',
            },
            intentId: 'intent-1',
            expectedIntentRevision: 0,
            activation: {
                activationId: 'activation-1',
                expectedRevision: 0,
            },
            reservation: {
                reservationId: 'reservation-1',
                expectedRevision: 0,
            },
        });
        await expect(
            client.request('drainPreparedIntentProvenUnsentByStrategy', {
                requestId: 'typed-prepared-drain-1',
                strategyId: 'strategy-1',
                expectedRevision: 1,
                nowEpochMs: 1_786_377_600_301,
            }),
        ).resolves.toMatchObject({
            state: 'cancelled_proven_unsent',
            strategyState: 'cancelled',
            brokerCallRequired: false,
            adapterAuthorityGranted: false,
        });
        await expect(
            client.request('drainPreparedIntentProvenUnsentByStrategy', {
                requestId: 'typed-prepared-drain-1',
                strategyId: 'strategy-1',
                expectedRevision: 1,
                nowEpochMs: 1_786_377_600_302,
            }),
        ).resolves.toMatchObject({
            state: 'cancelled_proven_unsent',
            strategyState: 'cancelled',
            replayed: true,
        });
    });

    it('atomically relinquishes protection only with two confirmations and opens durable unknown-exposure blockers', async () => {
        const databasePath = await temporaryDatabasePath();
        await seedPartialProtectedEntryFill(databasePath);
        const seed = new DatabaseSync(databasePath);
        seed
            .prepare(`
                UPDATE strategies
                   SET state='manual_intervention', revision=revision+1,
                       updated_at_epoch_ms=?
                 WHERE strategy_id='strategy-1'
            `)
            .run(1_786_377_600_700);
        seed.prepare(`
            INSERT INTO resolution_cases(
                resolution_case_id, strategy_id, reason_code, scope_hash,
                evidence_snapshot_hash, state, created_at_epoch_ms,
                updated_at_epoch_ms, terminal_at_epoch_ms, revision
            ) VALUES ('resolution-protection-relinquish', 'strategy-1',
                      'PROTECTION_UNPROTECTED_REMAINDER', ?, ?, 'open',
                      1786377600700, 1786377600700, NULL, 0)
        `).run(DIGEST_A, DIGEST_B);
        seed.close();
        const reopened = await openRepository({ databasePath });
        const challenge = await reopened.client.request(
            'prepareProtectionRelinquishment',
            {
                requestId: 'relinquish-confirmation-1',
                strategyId: 'strategy-1',
                expectedRevision: 1,
                confirmationEvidenceHash: DIGEST_A,
                nowEpochMs: 1_786_377_600_701,
            },
        );
        expect(challenge).toMatchObject({
            obligationCount: 1,
            relinquished: false,
            brokerWriteAttempted: false,
            brokerOutcomeInferred: false,
        });
        await expect(
            reopened.client.request('commitProtectionRelinquishment', {
                requestId: 'relinquish-confirmation-bad',
                challengeId: 'relinquish-confirmation-1',
                strategyId: 'strategy-1',
                expectedRevision: 1,
                confirmationEvidenceHash: DIGEST_A,
                operatorAcknowledgedManualHandoff: true,
                nowEpochMs: 1_786_377_600_702,
            }),
        ).rejects.toThrow('confirmations are not distinct');

        const faulting = new DatabaseSync(databasePath);
        faulting.exec(`
            CREATE TRIGGER test_relinquishment_obligation_failure
            BEFORE UPDATE OF state ON protection_obligations
            WHEN NEW.state='released_manual'
            BEGIN
                SELECT RAISE(ABORT, 'test relinquishment obligation failure');
            END;
        `);
        faulting.close();
        await expect(
            reopened.client.request('commitProtectionRelinquishment', {
                requestId: 'relinquish-confirmation-rollback',
                challengeId: 'relinquish-confirmation-1',
                strategyId: 'strategy-1',
                expectedRevision: 1,
                confirmationEvidenceHash: DIGEST_B,
                operatorAcknowledgedManualHandoff: true,
                nowEpochMs: 1_786_377_600_702,
            }),
        ).rejects.toThrow('test relinquishment obligation failure');
        const rolledBack = new DatabaseSync(databasePath);
        expect(
            rolledBack
                .prepare('SELECT COUNT(*) AS count FROM relinquished_unknown_exposures')
                .get()?.count,
        ).toBe(0);
        expect(
            rolledBack
                .prepare(`
                    SELECT COUNT(*) AS count FROM authority_consumptions
                     WHERE authority_kind='protection_break_glass_relinquish'
                `)
                .get()?.count,
        ).toBe(0);
        expect(
            rolledBack
                .prepare(`
                    SELECT state FROM protection_obligations
                     WHERE obligation_id='obligation-1'
                `)
                .get()?.state,
        ).toBe('monitoring');
        rolledBack.exec('DROP TRIGGER test_relinquishment_obligation_failure;');
        rolledBack.close();

        const committed = await reopened.client.request(
            'commitProtectionRelinquishment',
            {
                requestId: 'relinquish-confirmation-2',
                challengeId: 'relinquish-confirmation-1',
                strategyId: 'strategy-1',
                expectedRevision: 1,
                confirmationEvidenceHash: DIGEST_B,
                operatorAcknowledgedManualHandoff: true,
                nowEpochMs: 1_786_377_600_703,
            },
        );
        expect(committed).toMatchObject({
            strategyId: 'strategy-1',
            strategyState: 'manual_intervention',
            obligationCount: 1,
            safetyBlockerCount: 1,
            authorizationConsumed: true,
            relinquished: true,
            unmonitored: true,
            brokerOutcomeInferred: false,
            originalIntentRedispatchAllowed: false,
            brokerWriteAttempted: false,
        });
        await expect(
            reopened.client.request('commitProtectionRelinquishment', {
                requestId: 'relinquish-confirmation-2',
                challengeId: 'relinquish-confirmation-1',
                strategyId: 'strategy-1',
                expectedRevision: 1,
                confirmationEvidenceHash: DIGEST_B,
                operatorAcknowledgedManualHandoff: true,
                nowEpochMs: 1_786_377_600_704,
            }),
        ).resolves.toEqual({
            ...committed,
            replayed: true,
        });
        await reopened.client.close();
        openClients.delete(reopened.client);
        const verified = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verified
                .prepare(`
                    SELECT obligations.state AS obligation_state,
                           blockers.state AS blocker_state,
                           exposures.worst_case_position_delta_shares,
                           exposures.possibly_working_shares,
                           exposures.pnl_uncertainty,
                           exposures.actor_kind
                      FROM protection_obligations AS obligations
                      JOIN relinquished_unknown_exposures AS exposures
                        ON exposures.operation_kind='place'
                      JOIN safety_blockers AS blockers
                        ON blockers.blocker_id=exposures.blocker_id
                     WHERE obligations.obligation_id='obligation-1'
                `)
                .get(),
        ).toEqual({
            obligation_state: 'released_manual',
            blocker_state: 'open',
            worst_case_position_delta_shares: 200,
            possibly_working_shares: 200,
            pnl_uncertainty: 1,
            actor_kind: 'interactive_user',
        });
        expect(
            verified
                .prepare(`
                    SELECT state, terminal_outcome FROM order_intents
                     WHERE intent_id='intent-1'
                `)
                .get(),
        ).toEqual({
            state: 'terminal',
            terminal_outcome: 'place_relinquished_unknown',
        });
        verified.close();
    });

    it('uses one strategy-cancel authority to drain multiple prepared intents while releasing true-zero-fill protection atomically', async () => {
        const { client, databasePath } = await openRepository();
        await startReadyRuntime(client, {
            runtimeEpochId: 'protected-entry-setup-runtime',
            senderFence: 'protected-entry-setup-fence',
            apiGeneration: 'simulation-generation/1',
        });
        await client.request('insertStrategy', strategyInput());
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                protectionCommitment: {
                    commitmentId: 'commitment-1',
                    committedShares: 1_000,
                },
                protectionObligation: {
                    obligationId: 'obligation-1',
                    positionLineageId: 'position-lineage-1',
                },
            }),
        );
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                nowEpochMs: 1_786_377_600_200,
                activation: {
                    activationId: 'activation-2',
                    logicalKey: 'edge-2',
                    generation: 2,
                },
                intent: {
                    intentId: 'intent-2',
                    clientRequestId: 'request-2',
                },
                reservation: { reservationId: 'reservation-2' },
            }),
        );
        const cancellation = await client.request(
            'executeReplayProtectedStrategyMutation',
            strategyCancelMutationInput(),
        );
        expect(cancellation).toMatchObject({
            state: 'completed',
            result: {
                strategyId: 'strategy-1',
                state: 'cancel_pending',
            },
        });

        const first = await client.request(
            'cancelPreparedIntentProvenUnsent',
            preparedIntentLocalCancelInput({
                protection: {
                    commitmentId: 'commitment-1',
                    expectedCommitmentRevision: 0,
                    obligationId: 'obligation-1',
                    expectedObligationRevision: 0,
                },
            }),
        );
        expect(first).toMatchObject({
            protectionCommitmentState: 'released_pre_dispatch',
            protectionCommitmentRevision: 1,
            protectionObligationState: 'zero_fill_terminal',
            protectionObligationRevision: 1,
            strategyState: 'cancel_pending',
            strategyRevision: 1,
        });

        const second = await client.request(
            'cancelPreparedIntentProvenUnsent',
            preparedIntentLocalCancelInput({
                requestId: 'prepared-local-cancel-2',
                intentId: 'intent-2',
                activation: { activationId: 'activation-2' },
                reservation: { reservationId: 'reservation-2' },
                nowEpochMs: 1_786_377_600_500,
            }),
        );
        expect(second).toMatchObject({
            intentId: 'intent-2',
            state: 'cancelled_proven_unsent',
            strategyState: 'cancelled',
            strategyRevision: 2,
            authorizationId: 'strategy-cancel-authority-1',
            authorizationConsumed: true,
            brokerCallRequired: false,
        });

        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database
                .prepare(`
                    SELECT state, materialized_shares, revision
                      FROM pending_protection_commitments
                     WHERE commitment_id='commitment-1'
                `)
                .get(),
        ).toEqual({
            state: 'released_pre_dispatch',
            materialized_shares: 0,
            revision: 1,
        });
        expect(
            database
                .prepare(`
                    SELECT state, filled_shares, confirmed_exited_shares,
                           terminal_at_epoch_ms, revision
                      FROM protection_obligations
                     WHERE obligation_id='obligation-1'
                `)
                .get(),
        ).toEqual({
            state: 'zero_fill_terminal',
            filled_shares: 0,
            confirmed_exited_shares: 0,
            terminal_at_epoch_ms: 1_786_377_600_400,
            revision: 1,
        });
        expect(
            database
                .prepare(`
                    SELECT COUNT(*) AS count FROM authority_consumptions
                     WHERE authority_kind='prepared_intent_local_cancel'
                `)
                .get()?.count,
        ).toBe(2);
        expect(
            database
                .prepare(`
                    SELECT state, revision FROM strategies
                     WHERE strategy_id='strategy-1'
                `)
                .get(),
        ).toEqual({ state: 'cancelled', revision: 2 });
        database.close();
    });

    it('releases only the exact internal intent-reserved ExitClaim and keeps the remaining obligation blocking', async () => {
        const protectionGroupId = protectionGroupIdForTestClaim(
            'exit-claim-cancel',
        );
        const { client, databasePath } = await openRepository();
        await startReadyRuntime(client, {
            runtimeEpochId: 'protected-entry-setup-runtime',
            senderFence: 'protected-entry-setup-fence',
            apiGeneration: 'simulation-generation/1',
        });
        await client.request('insertStrategy', strategyInput());
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                protectionCommitment: {
                    commitmentId: 'commitment-exit',
                    committedShares: 1_000,
                },
                protectionObligation: {
                    obligationId: 'obligation-exit',
                    positionLineageId: 'position-lineage-exit',
                },
            }),
        );
        await client.close();
        openClients.delete(client);

        const seed = new DatabaseSync(databasePath);
        seed.exec('PRAGMA foreign_keys=ON');
        seed.prepare(`
            UPDATE order_intents
               SET state='terminal', terminal_outcome='filled',
                   terminal_at_epoch_ms=1786377600200,
                   updated_at_epoch_ms=1786377600200, revision=1
             WHERE intent_id='intent-1'
        `).run();
        seed.prepare(`
            UPDATE activations
               SET state='filled', updated_at_epoch_ms=1786377600200,
                   revision=1
             WHERE activation_id='activation-1'
        `).run();
        seed.prepare(`
            UPDATE entry_exposure_reservations
               SET state='consumed', terminal_at_epoch_ms=1786377600200,
                   updated_at_epoch_ms=1786377600200, revision=1
             WHERE reservation_id='reservation-1'
        `).run();
        seed.prepare(`
            UPDATE pending_protection_commitments
               SET state='materialized', materialized_shares=1000,
                   updated_at_epoch_ms=1786377600200, revision=1
             WHERE commitment_id='commitment-exit'
        `).run();
        seed.prepare(`
            UPDATE protection_obligations
               SET state='monitoring', filled_shares=1000,
                   updated_at_epoch_ms=1786377600200, revision=1
             WHERE obligation_id='obligation-exit'
        `).run();
        seed.prepare(`
            INSERT INTO exit_claims(
                exit_claim_id, obligation_id, intent_id, external_lineage,
                account_broker_ref, account_id_ref, contract_key,
                position_lineage_id, remainder_generation,
                allocation_start_share, quantity_shares, state,
                evidence_hash, created_at_epoch_ms, updated_at_epoch_ms,
                revision
            ) VALUES (
                'exit-claim-cancel', 'obligation-exit', NULL, 0,
                'broker-A', 'account-A', 'TSE:2330:STK:Common',
                'position-lineage-exit', 0, 0, 1000,
                'monitoring_reserved', '${DIGEST_A}',
                1786377600200, 1786377600200, 0
            )
        `).run();
        seed.prepare(`
            INSERT INTO protection_groups(
                protection_group_id, obligation_id, exit_claim_id, state,
                current_generation, plan_hash, created_at_epoch_ms,
                updated_at_epoch_ms, revision
            ) VALUES (?, 'obligation-exit', 'exit-claim-cancel',
                      'monitoring', 0, ?, 1786377600200,
                      1786377600200, 0)
        `).run(
            protectionGroupId,
            protectedEntryProjection().payload.protectionPlanSha256,
        );
        seed.prepare(`
            INSERT INTO protection_remainder_generations(
                protection_group_id, remainder_generation, exit_claim_id,
                state, quantity_shares, evidence_hash,
                created_at_epoch_ms, updated_at_epoch_ms, revision
            ) VALUES (?, 0, 'exit-claim-cancel', 'monitoring', 1000, ?,
                      1786377600200, 1786377600200, 0)
        `).run(protectionGroupId, DIGEST_A);
        seed.close();

        const reopened = await openRepository({ databasePath });
        const exitProjection = protectiveBrokerIntentProjection();
        await reopened.client.request(
            'prepareIntent',
            preparedIntentInput({
                nowEpochMs: 1_786_377_600_300,
                activation: {
                    activationId: 'activation-exit-cancel',
                    logicalKey: 'exit-cancel-edge',
                    generation: 0,
                },
                intent: {
                    intentId: 'intent-exit-cancel',
                    side: 'Sell',
                    clientRequestId: 'request-exit-cancel',
                    payload: exitProjection.payload,
                    payloadHash: exitProjection.payloadSha256,
                },
                reservation: null,
                exitClaim: {
                    exitClaimId: 'exit-claim-cancel',
                    obligationId: 'obligation-exit',
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    contractKey: 'TSE:2330:STK:Common',
                    positionLineageId: 'position-lineage-exit',
                    remainderGeneration: 0,
                    allocationStartShare: 0,
                    quantityShares: 1_000,
                    expectedRevision: 0,
                    evidenceHash: DIGEST_B,
                    protectionGroupId,
                    expectedGroupRevision: 0,
                    expectedGenerationRevision: 0,
                    candidateEvaluations: [
                        {
                            legId: 'stop-leg',
                            evidenceHash: DIGEST_B,
                            observedAtEpochMs: 1_786_377_600_300,
                        },
                    ],
                },
                runtimeEpochId: 'protected-entry-setup-runtime',
                senderFence: 'protected-entry-setup-fence',
                apiGeneration: 'simulation-generation/1',
            }),
        );
        await reopened.client.request(
            'executeReplayProtectedStrategyMutation',
            strategyCancelMutationInput(),
        );
        const cancelled = await reopened.client.request(
            'cancelPreparedIntentProvenUnsent',
            preparedIntentLocalCancelInput({
                intentId: 'intent-exit-cancel',
                activation: { activationId: 'activation-exit-cancel' },
                reservation: null,
                exitClaim: {
                    exitClaimId: 'exit-claim-cancel',
                    expectedRevision: 1,
                },
            }),
        );
        expect(cancelled).toMatchObject({
            intentId: 'intent-exit-cancel',
            terminalOutcome: 'place_cancelled_proven_unsent',
            exitClaimId: 'exit-claim-cancel',
            exitClaimState: 'released',
            exitClaimRevision: 2,
            strategyState: 'cancel_pending',
            brokerCallRequired: false,
        });
        await reopened.client.close();
        openClients.delete(reopened.client);
        const verify = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verify
                .prepare(`
                    SELECT state, terminal_at_epoch_ms, revision
                      FROM exit_claims
                     WHERE exit_claim_id='exit-claim-cancel'
                `)
                .get(),
        ).toEqual({
            state: 'released',
            terminal_at_epoch_ms: 1_786_377_600_400,
            revision: 2,
        });
        expect(
            verify
                .prepare(`
                    SELECT state, filled_shares, terminal_at_epoch_ms
                      FROM protection_obligations
                     WHERE obligation_id='obligation-exit'
                `)
                .get(),
        ).toEqual({
            state: 'monitoring',
            filled_shares: 1_000,
            terminal_at_epoch_ms: null,
        });
        expect(
            verify
                .prepare(`
                    SELECT state, revision FROM strategies
                     WHERE strategy_id='strategy-1'
                `)
                .get(),
        ).toEqual({ state: 'cancel_pending', revision: 1 });
        expect(
            verify.prepare(`
                SELECT groups.state AS group_state, groups.revision AS group_revision,
                       generations.state AS generation_state,
                       generations.revision AS generation_revision,
                       generations.winner_intent_id
                  FROM protection_groups AS groups
                  JOIN protection_remainder_generations AS generations
                    ON generations.protection_group_id=groups.protection_group_id
                   AND generations.remainder_generation=groups.current_generation
                 WHERE groups.protection_group_id=?
            `).get(protectionGroupId),
        ).toEqual({
            group_state: 'unknown',
            group_revision: 2,
            generation_state: 'unknown',
            generation_revision: 2,
            winner_intent_id: 'intent-exit-cancel',
        });
        verify.close();
    });

    it('rejects zero-fill release when any ExitClaim already exists for the protection obligation', async () => {
        const { client, databasePath } = await openRepository();
        await startReadyRuntime(client, {
            runtimeEpochId: 'protected-entry-setup-runtime',
            senderFence: 'protected-entry-setup-fence',
            apiGeneration: 'simulation-generation/1',
        });
        await client.request('insertStrategy', strategyInput());
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                protectionCommitment: {
                    commitmentId: 'commitment-not-zero',
                    committedShares: 1_000,
                },
                protectionObligation: {
                    obligationId: 'obligation-not-zero',
                    positionLineageId: 'position-lineage-not-zero',
                },
            }),
        );
        await client.close();
        openClients.delete(client);

        const seed = new DatabaseSync(databasePath);
        seed.exec('PRAGMA foreign_keys=ON');
        seed.prepare(`
            INSERT INTO exit_claims(
                exit_claim_id, obligation_id, intent_id, external_lineage,
                account_broker_ref, account_id_ref, contract_key,
                position_lineage_id, remainder_generation,
                allocation_start_share, quantity_shares, state,
                evidence_hash, created_at_epoch_ms, updated_at_epoch_ms,
                revision
            ) VALUES (
                'unexpected-zero-fill-claim', 'obligation-not-zero', NULL, 0,
                'broker-A', 'account-A', 'TSE:2330:STK:Common',
                'position-lineage-not-zero', 0, 0, 1,
                'monitoring_reserved', '${DIGEST_A}',
                1786377600200, 1786377600200, 0
            )
        `).run();
        seed.close();

        const reopened = await openRepository({ databasePath });
        await reopened.client.request(
            'executeReplayProtectedStrategyMutation',
            strategyCancelMutationInput(),
        );
        await expect(
            reopened.client.request(
                'cancelPreparedIntentProvenUnsent',
                preparedIntentLocalCancelInput({
                    protection: {
                        commitmentId: 'commitment-not-zero',
                        expectedCommitmentRevision: 0,
                        obligationId: 'obligation-not-zero',
                        expectedObligationRevision: 0,
                    },
                }),
            ),
        ).rejects.toThrow('obligation is not true zero-fill');

        await reopened.client.close();
        openClients.delete(reopened.client);
        const verify = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verify
                .prepare(`
                    SELECT state, revision FROM protection_obligations
                     WHERE obligation_id='obligation-not-zero'
                `)
                .get(),
        ).toEqual({ state: 'pending_entry_fill', revision: 0 });
        expect(
            verify
                .prepare(`
                    SELECT state, revision FROM order_intents
                     WHERE intent_id='intent-1'
                `)
                .get(),
        ).toEqual({ state: 'prepared', revision: 0 });
        expect(
            verify
                .prepare(`
                    SELECT COUNT(*) AS count FROM authority_consumptions
                     WHERE authority_kind='prepared_intent_local_cancel'
                `)
                .get()?.count,
        ).toBe(0);
        verify.close();
    });

    it('rejects local cancellation after adapter dispatch authority was durably granted', async () => {
        const { client, databasePath } = await openRepository();
        await insertPreparedIntent(client);
        await startReadyRuntime(client, {}, { rearmPreparedIntent: true });
        await client.request('markIntentDispatching', dispatchInput());
        await client.request(
            'executeReplayProtectedStrategyMutation',
            strategyCancelMutationInput({
                mutation: { expectedRevision: 1 },
            }),
        );
        await expect(
            client.request(
                'cancelPreparedIntentProvenUnsent',
                preparedIntentLocalCancelInput({
                    expectedIntentRevision: 2,
                    activation: { expectedRevision: 1 },
                    reservation: { expectedRevision: 1 },
                }),
            ),
        ).rejects.toThrow('lost its proven-unsent CAS');

        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database
                .prepare(`
                    SELECT state, adapter_authority_granted,
                           dispatch_attempt_nonce, terminal_outcome, revision
                      FROM order_intents WHERE intent_id='intent-1'
                `)
                .get(),
        ).toEqual({
            state: 'dispatching',
            adapter_authority_granted: 1,
            dispatch_attempt_nonce: 'dispatch-nonce-1',
            terminal_outcome: null,
            revision: 2,
        });
        expect(
            database
                .prepare(`
                    SELECT COUNT(*) AS count FROM authority_consumptions
                     WHERE authority_kind='prepared_intent_local_cancel'
                `)
                .get()?.count,
        ).toBe(0);
        database.close();
    });

    it('prevents a cancel-pending strategy from granting new adapter dispatch authority', async () => {
        const { client, databasePath } = await openRepository();
        await insertPreparedIntent(client);
        await startReadyRuntime(client, {}, { rearmPreparedIntent: true });
        await client.request(
            'executeReplayProtectedStrategyMutation',
            strategyCancelMutationInput({
                mutation: { expectedRevision: 1 },
            }),
        );

        await expect(
            client.request('markIntentDispatching', dispatchInput()),
        ).rejects.toThrow('intent dispatch transition lost its CAS or activation');

        await expect(
            client.request(
                'cancelPreparedIntentProvenUnsent',
                preparedIntentLocalCancelInput({
                    expectedIntentRevision: 1,
                    rearm: {
                        rearmAuthorizationId: 'rearm-authorization-1',
                        expectedRevision: 0,
                    },
                    nowEpochMs: 1_786_377_600_500,
                }),
            ),
        ).resolves.toMatchObject({
            state: 'cancelled_proven_unsent',
            rearmAuthorizationId: 'rearm-authorization-1',
            rearmState: 'superseded',
            rearmRevision: 1,
            strategyState: 'cancelled',
            brokerCallRequired: false,
        });

        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database
                .prepare(`
                    SELECT intents.state, intents.adapter_authority_granted,
                           intents.dispatch_attempt_nonce, intents.revision,
                           strategies.state AS strategy_state
                      FROM order_intents AS intents
                      JOIN strategies
                        ON strategies.strategy_id=intents.strategy_id
                     WHERE intents.intent_id='intent-1'
                `)
                .get(),
        ).toEqual({
            state: 'cancelled_proven_unsent',
            adapter_authority_granted: 0,
            dispatch_attempt_nonce: null,
            revision: 2,
            strategy_state: 'cancelled',
        });
        expect(
            database
                .prepare(`
                    SELECT state, revision FROM intent_rearm_authorizations
                     WHERE rearm_authorization_id='rearm-authorization-1'
                `)
                .get(),
        ).toEqual({ state: 'superseded', revision: 1 });
        database.close();
    });

    it('rolls back the prepared cancellation, companion releases, authority consume, journal, and replay outcome in one transaction', async () => {
        const databasePath = await temporaryDatabasePath();
        const prepared = await openRepository({ databasePath });
        await insertPreparedIntent(prepared.client);
        await prepared.client.request(
            'executeReplayProtectedStrategyMutation',
            strategyCancelMutationInput(),
        );
        await prepared.client.close();
        openClients.delete(prepared.client);

        const faulting = await openRepository({
            databasePath,
            testOnlyFailReplayCompletionAfterMutation: true,
        });
        await expect(
            faulting.client.request(
                'cancelPreparedIntentProvenUnsent',
                preparedIntentLocalCancelInput(),
            ),
        ).rejects.toThrow(
            'after local cancellation before outcome commit',
        );
        await faulting.client.close();
        openClients.delete(faulting.client);

        const verify = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verify
                .prepare(`
                    SELECT state, terminal_outcome, revision
                      FROM order_intents WHERE intent_id='intent-1'
                `)
                .get(),
        ).toEqual({ state: 'prepared', terminal_outcome: null, revision: 0 });
        expect(
            verify
                .prepare(`
                    SELECT state, terminal_at_epoch_ms, revision
                      FROM entry_exposure_reservations
                     WHERE reservation_id='reservation-1'
                `)
                .get(),
        ).toEqual({ state: 'reserved', terminal_at_epoch_ms: null, revision: 0 });
        expect(
            verify
                .prepare(`
                    SELECT state, terminal_at_epoch_ms, revision
                      FROM strategies WHERE strategy_id='strategy-1'
                `)
                .get(),
        ).toEqual({ state: 'cancel_pending', terminal_at_epoch_ms: null, revision: 1 });
        expect(
            verify
                .prepare(`
                    SELECT COUNT(*) AS count FROM authority_consumptions
                     WHERE authority_kind='prepared_intent_local_cancel'
                `)
                .get()?.count,
        ).toBe(0);
        expect(
            verify
                .prepare(`
                    SELECT COUNT(*) AS count FROM request_replays
                     WHERE request_id='prepared-local-cancel-1'
                `)
                .get()?.count,
        ).toBe(0);
        expect(
            verify
                .prepare(`
                    SELECT COUNT(*) AS count FROM event_journal
                     WHERE reason_code IN (
                         'INTENT_CANCELLED_PROVEN_UNSENT',
                         'ENTRY_RESERVATION_RELEASED',
                         'ONE_TIME_AUTHORITY_DURABLY_CONSUMED',
                         'STRATEGY_CANCEL_DRAIN_COMPLETE'
                     )
                `)
                .get()?.count,
        ).toBe(0);
        verify.close();

        const reopened = await openRepository({ databasePath });
        await expect(
            reopened.client.request(
                'cancelPreparedIntentProvenUnsent',
                preparedIntentLocalCancelInput(),
            ),
        ).resolves.toMatchObject({
            state: 'cancelled_proven_unsent',
            strategyState: 'cancelled',
            brokerCallRequired: false,
            replayed: false,
        });
    });

    it('requires a durable current-epoch user re-arm before readiness and supersedes it on restart', async () => {
        const { client, databasePath } = await openRepository();
        await insertPreparedIntent(client);
        const firstRuntime = runtimeEpochInput();
        const firstStarted = await client.request('startRuntimeEpoch', firstRuntime);
        await expect(
            client.request('markRuntimeEpochReady', {
                runtimeEpochId: firstRuntime.runtimeEpochId,
                apiGeneration: firstRuntime.apiGeneration,
                senderFence: firstRuntime.senderFence,
                expectedRevision: firstStarted.revision,
                reconciliationEvidenceHash: DIGEST_B,
            }),
        ).rejects.toThrow('unresolved blockers');
        await expect(
            client.request(
                'rearmPreparedIntent',
                rearmInput({ confirmationSnapshotHash: DIGEST_A }),
            ),
        ).rejects.toThrow('confirmation is stale');
        const firstRearm = await client.request(
            'rearmPreparedIntent',
            rearmInput(),
        );
        expect(firstRearm).toMatchObject({
            state: 'active',
            intentRevision: 1,
            rearmRevision: 0,
            replayed: false,
        });
        await expect(
            client.request('rearmPreparedIntent', rearmInput()),
        ).resolves.toMatchObject({
            state: 'active',
            intentRevision: 1,
            replayed: true,
        });
        await client.request('markRuntimeEpochReady', {
            runtimeEpochId: firstRuntime.runtimeEpochId,
            apiGeneration: firstRuntime.apiGeneration,
            senderFence: firstRuntime.senderFence,
            expectedRevision: firstStarted.revision,
            reconciliationEvidenceHash: DIGEST_B,
        });

        const secondRuntime = runtimeEpochInput({
            runtimeEpochId: 'runtime-epoch-2',
            apiGeneration: 'api-generation-2',
            senderFence: 'sender-fence-2',
            nowEpochMs: 1_786_377_600_300,
        });
        const secondStarted = await client.request(
            'startRuntimeEpoch',
            secondRuntime,
        );
        expect(secondStarted).toMatchObject({
            state: 'reconciling',
            supersededRearmIntentIds: ['intent-1'],
            automaticRedispatchAllowed: false,
        });
        await expect(
            client.request('markRuntimeEpochReady', {
                runtimeEpochId: secondRuntime.runtimeEpochId,
                apiGeneration: secondRuntime.apiGeneration,
                senderFence: secondRuntime.senderFence,
                expectedRevision: secondStarted.revision,
                reconciliationEvidenceHash: DIGEST_A,
            }),
        ).rejects.toThrow('unresolved blockers');
        await expect(
            client.request(
                'rearmPreparedIntent',
                rearmInput({ expectedIntentRevision: 1 }),
            ),
        ).rejects.toThrow('does not target current runtime epoch');
        const secondRearm = await client.request(
            'rearmPreparedIntent',
            rearmInput({
                rearmAuthorizationId: 'rearm-authorization-2',
                rearmRequestId: 'rearm-request-2',
                runtimeEpochId: secondRuntime.runtimeEpochId,
                apiGeneration: secondRuntime.apiGeneration,
                senderFence: secondRuntime.senderFence,
                expectedIntentRevision: 1,
                reconciliationEvidenceHash: DIGEST_A,
                userRearmEvidenceHash: DIGEST_B,
                nowEpochMs: 1_786_377_600_325,
            }),
        );
        expect(secondRearm).toMatchObject({
            state: 'active',
            intentRevision: 2,
            rearmRevision: 0,
        });
        await client.request('markRuntimeEpochReady', {
            runtimeEpochId: secondRuntime.runtimeEpochId,
            apiGeneration: secondRuntime.apiGeneration,
            senderFence: secondRuntime.senderFence,
            expectedRevision: secondStarted.revision,
            reconciliationEvidenceHash: DIGEST_A,
        });
        await expect(
            client.request('markIntentDispatching', {
                ...dispatchInput({
                    runtimeEpochId: secondRuntime.runtimeEpochId,
                    apiGeneration: secondRuntime.apiGeneration,
                    senderFence: secondRuntime.senderFence,
                    expectedRevision: 2,
                    nowEpochMs: 1_786_377_600_350,
                }),
                expectedRearmRevision: 1,
            }),
        ).rejects.toThrow('current-epoch user re-arm evidence');

        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database
                .prepare(`
                    SELECT rearm_authorization_id, runtime_epoch_id, state,
                           authorized_intent_revision
                      FROM intent_rearm_authorizations
                     ORDER BY authorized_at_epoch_ms
                `)
                .all(),
        ).toEqual([
            {
                rearm_authorization_id: 'rearm-authorization-1',
                runtime_epoch_id: 'runtime-epoch-1',
                state: 'superseded',
                authorized_intent_revision: 1,
            },
            {
                rearm_authorization_id: 'rearm-authorization-2',
                runtime_epoch_id: 'runtime-epoch-2',
                state: 'active',
                authorized_intent_revision: 2,
            },
        ]);
        database.close();
    });

    it('grants dispatch only for the complete durable fence and CAS revision', async () => {
        const { client } = await openRepository();
        await insertPreparedIntent(client);
        await startReadyRuntime(client, {}, { rearmPreparedIntent: true });
        const dispatch = dispatchInput();
        await expect(
            client.request('markIntentDispatching', {
                ...dispatch,
                senderFence: 'stale-sender-fence',
            }),
        ).rejects.toThrow('current ready sender fence mismatch');
        await expect(
            client.request('markIntentDispatching', {
                ...dispatch,
                expectedReservationRevision: 99,
            }),
        ).rejects.toThrow('reservation dispatch transition lost its CAS');
        await expect(
            client.request('markIntentDispatching', {
                ...dispatch,
                expectedActivationRevision: 99,
            }),
        ).rejects.toThrow('activation dispatch transition lost its CAS');
        const grant = await client.request('markIntentDispatching', dispatch);

        expect(grant).toMatchObject({
            runtimeEpochId: 'runtime-epoch-1',
            state: 'dispatching',
            revision: 2,
            activationRevision: 1,
            reservationRevision: 0,
            rearmAuthorizationId: 'rearm-authorization-1',
            rearmRevision: 1,
            durableBeforeAdapterAuthority: true,
        });
        await expect(
            client.request('verifyDispatchGrant', {
                ...dispatch,
                revision: 2,
                activationRevision: 1,
                reservationRevision: 0,
            }),
        ).resolves.toMatchObject({
            authorized: true,
            envelope: {
                schemaVersion: 'smart-order-dispatch-envelope/2026-08-12.1',
                intentId: 'intent-1',
                payloadHash: INTENT_PAYLOAD_DIGEST,
                payload: CANONICAL_INTENT_PAYLOAD,
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                tradeDate: '2026-08-11',
                contractKey: 'TSE:2330:STK:Common',
                intentRevision: 2,
            },
        });
        await expect(
            client.request('verifyDispatchGrant', {
                ...dispatch,
                revision: 2,
                activationRevision: 1,
                reservationRevision: 0,
                riskRevision: 'stale-risk-revision',
            }),
        ).resolves.toEqual({ authorized: false });
        await expect(
            client.request('markIntentDispatching', dispatch),
        ).rejects.toThrow('lost its CAS');
    });

    it('rejects queue-head dispatch when the exposure head expires after prepare', async () => {
        const { client } = await openRepository({
            testOnlyExposureClockAdvanceToEpochMs:
                TEST_EXPOSURE_OBSERVED_AT_EPOCH_MS + 5_001,
        });
        await insertPreparedIntent(client);
        await startReadyRuntime(client, {}, { rearmPreparedIntent: true });
        await expect(
            client.request('markIntentDispatching', dispatchInput()),
        ).rejects.toThrow('future-dated or expired');
        await expect(
            client.request('verifyDispatchGrant', {
                ...dispatchInput(),
                revision: 2,
                activationRevision: 1,
                reservationRevision: 0,
            }),
        ).resolves.toEqual({ authorized: false });
        expect((await client.request('status')).counts).toMatchObject({
            order_intents: 1,
            entry_exposure_reservations: 1,
        });
    });

    it('persists simultaneous kill switches as a deny-union with one arbiter revision CAS', async () => {
        const { client, databasePath } = await openRepository();
        await insertPreparedIntent(client);
        await startReadyRuntime(client, {}, { rearmPreparedIntent: true });
        await expect(client.request('killSwitchStatus', {})).resolves.toMatchObject({
            arbiterRevision: 0,
            enabled: [],
            denyUnionActive: false,
        });

        const pausedExposure = await client.request(
            'mutateKillSwitch',
            killSwitchMutationInput(),
        );
        expect(pausedExposure).toMatchObject({
            arbiterRevision: 1,
            enabled: ['pause_new_exposure'],
            denyUnionActive: true,
            changed: true,
        });
        await expect(
            client.request(
                'mutateKillSwitch',
                killSwitchMutationInput({
                    switchName: 'pause_automation',
                    expectedArbiterRevision: 0,
                }),
            ),
        ).rejects.toMatchObject({ name: 'KillSwitchArbiterRevisionError' });
        const pausedBoth = await client.request(
            'mutateKillSwitch',
            killSwitchMutationInput({
                switchName: 'pause_automation',
                expectedArbiterRevision: 1,
                reasonCode: 'automation_pause',
                nowEpochMs: 1_786_377_600_191,
            }),
        );
        expect(pausedBoth).toMatchObject({
            arbiterRevision: 2,
            enabled: ['pause_new_exposure', 'pause_automation'],
        });
        const onlyAutomationPaused = await client.request(
            'mutateKillSwitch',
            killSwitchMutationInput({
                enabled: false,
                expectedArbiterRevision: 2,
                reasonCode: 'exposure_pause_released',
                nowEpochMs: 1_786_377_600_192,
            }),
        );
        expect(onlyAutomationPaused).toMatchObject({
            arbiterRevision: 3,
            enabled: ['pause_automation'],
            switches: {
                pause_new_exposure: { enabled: false, revision: 3 },
                pause_automation: { enabled: true, revision: 2 },
            },
        });
        await expect(
            client.request(
                'markIntentDispatching',
                dispatchInput({ expectedKillSwitchArbiterRevision: 3 }),
            ),
        ).rejects.toMatchObject({ name: 'KillSwitchDeniedError' });

        await client.close();
        openClients.delete(client);
        const reopened = await openRepository({ databasePath });
        await expect(
            reopened.client.request('killSwitchStatus', {}),
        ).resolves.toMatchObject({
            arbiterRevision: 3,
            enabled: ['pause_automation'],
            denyUnionActive: true,
        });
    });

    it('atomically commits a kill-switch mutation with its exact replay outcome', async () => {
        const { client } = await openRepository();
        await startReadyRuntime(client);
        const request = {
            requestId: '00000000-0000-4000-8000-000000000065',
            operationKind: 'risk_kill_switch',
            payloadHash: DIGEST_A,
            nowEpochMs: 1_786_377_600_195,
            mutation: {
                kind: 'risk_kill_switch',
                ...killSwitchMutationInput({
                    switchName: 'emergency_block_all_writes',
                    reasonCode: 'operator_emergency',
                    nowEpochMs: 1_786_377_600_195,
                }),
            },
        };
        const first = await client.request(
            'executeReplayProtectedStrategyMutation',
            request,
        );
        expect(first).toMatchObject({
            state: 'completed',
            replayed: false,
            result: {
                arbiterRevision: 1,
                enabled: ['emergency_block_all_writes'],
                changed: true,
                brokerWriteAuthority: false,
            },
        });
        const replay = await client.request(
            'executeReplayProtectedStrategyMutation',
            request,
        );
        expect(replay).toMatchObject({
            state: 'completed',
            replayed: true,
            resultHash: first.resultHash,
            result: first.result,
        });
        await expect(
            client.request('killSwitchStatus', {}),
        ).resolves.toMatchObject({
            arbiterRevision: 1,
            enabled: ['emergency_block_all_writes'],
        });
    });

    it('rolls back a kill-switch mutation when replay outcome persistence fails', async () => {
        const { client } = await openRepository({
            testOnlyFailReplayCompletionAfterMutation: true,
        });
        await startReadyRuntime(client);
        await expect(
            client.request('executeReplayProtectedStrategyMutation', {
                requestId: '00000000-0000-4000-8000-000000000066',
                operationKind: 'risk_kill_switch',
                payloadHash: DIGEST_A,
                nowEpochMs: 1_786_377_600_196,
                mutation: {
                    kind: 'risk_kill_switch',
                    ...killSwitchMutationInput({
                        switchName: 'emergency_block_all_writes',
                        reasonCode: 'operator_emergency',
                        nowEpochMs: 1_786_377_600_196,
                    }),
                },
            }),
        ).rejects.toThrow(/after mutation before outcome commit/);
        await expect(
            client.request('killSwitchStatus', {}),
        ).resolves.toMatchObject({
            arbiterRevision: 0,
            enabled: [],
            denyUnionActive: false,
        });
    });

    it('fails closed instead of recreating a missing expected kill-switch arbiter', async () => {
        const { client, databasePath } = await openRepository();
        await client.close();
        openClients.delete(client);
        const tampered = new DatabaseSync(databasePath);
        tampered
            .prepare(
                "DELETE FROM repository_meta WHERE key='canonical_kill_switch_arbiter'",
            )
            .run();
        tampered.close();
        await expect(openRepository({ databasePath })).rejects.toThrow(
            'durable kill switch arbiter metadata is missing or inconsistent',
        );
    });

    it('fails closed before projecting a tampered kill-switch reason code', async () => {
        const { client, databasePath } = await openRepository();
        await client.close();
        openClients.delete(client);
        const tampered = new DatabaseSync(databasePath);
        const row = tampered
            .prepare(
                "SELECT value FROM repository_meta WHERE key='canonical_kill_switch_arbiter'",
            )
            .get();
        const arbiter = JSON.parse(row.value);
        arbiter.switches.pause_new_exposure.reasonCode =
            'account-1234567890';
        tampered
            .prepare(
                "UPDATE repository_meta SET value=? WHERE key='canonical_kill_switch_arbiter'",
            )
            .run(JSON.stringify(arbiter));
        tampered.close();
        await expect(openRepository({ databasePath })).rejects.toThrow(
            'reason code is not allowlisted',
        );
    });

    it('never re-arms a prepared intent whose strategy requires manual intervention', async () => {
        const { client, databasePath } = await openRepository();
        await insertPreparedIntent(client);
        await client.request('startRuntimeEpoch', runtimeEpochInput());

        const tamper = new DatabaseSync(databasePath);
        expect(
            Number(
                tamper
            .prepare(`
                UPDATE strategies
                   SET state='manual_intervention', revision=revision+1
                 WHERE strategy_id='strategy-1' AND state='recovery'
            `)
                    .run().changes,
            ),
        ).toBe(1);
        tamper.close();

        await expect(
            client.request('rearmPreparedIntent', rearmInput()),
        ).rejects.toThrow(
            'requires an observing, monitoring, or recovery strategy',
        );

        await client.close();
        openClients.delete(client);
        const inspection = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            inspection
                .prepare(`
                    SELECT state, revision FROM strategies
                     WHERE strategy_id='strategy-1'
                `)
                .get(),
        ).toEqual({ state: 'manual_intervention', revision: 2 });
        expect(
            inspection
                .prepare(`
                    SELECT state, revision FROM order_intents
                     WHERE intent_id='intent-1'
                `)
                .get(),
        ).toEqual({ state: 'prepared', revision: 0 });
        expect(
            inspection
                .prepare(`
                    SELECT COUNT(*) AS count
                      FROM intent_rearm_authorizations
                     WHERE intent_id='intent-1'
                `)
                .get(),
        ).toEqual({ count: 0 });
        inspection.close();
    });

    it('fails closed when both expected kill-switch arbiter metadata keys are removed', async () => {
        const { client, databasePath } = await openRepository();
        await client.close();
        openClients.delete(client);
        const tampered = new DatabaseSync(databasePath);
        tampered
            .prepare(`
                DELETE FROM repository_meta
                 WHERE key IN (
                    'canonical_kill_switch_arbiter',
                    'canonical_kill_switch_arbiter_expected'
                 )
            `)
            .run();
        tampered.close();
        await expect(openRepository({ databasePath })).rejects.toThrow(
            'durable kill switch arbiter metadata is missing or inconsistent',
        );
    });

    it('commits an emergency queued ahead of dispatch and denies the stale waiting grant', async () => {
        const databasePath = await temporaryDatabasePath();
        const backupDirectory = path.join(
            path.dirname(path.dirname(databasePath)),
            'backups',
        );
        await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
        const { client } = await openRepository({
            databasePath,
            backupDirectory,
            testOnlyBlockingBackupDelayMs: 40,
            workerLatencyLimitMs: 1_000,
            queueAgeLimitMs: 1_000,
        });
        await insertPreparedIntent(client);
        await startReadyRuntime(client, {}, { rearmPreparedIntent: true });

        const blocker = client.request('createRepositoryBackup', {
            backupName: 'kill-switch-queue.sqlite3',
            createdAtEpochMs: 1_786_377_600_188,
        });
        const emergency = client.request(
            'mutateKillSwitch',
            killSwitchMutationInput({
                switchName: 'emergency_block_all_writes',
                reasonCode: 'operator_emergency',
                nowEpochMs: 1_786_377_600_189,
            }),
        );
        const waitingDispatch = client.request(
            'markIntentDispatching',
            dispatchInput({ nowEpochMs: 1_786_377_600_190 }),
        );
        await expect(blocker).resolves.toMatchObject({ containsSecrets: false });
        await expect(emergency).resolves.toMatchObject({
            arbiterRevision: 1,
            enabled: ['emergency_block_all_writes'],
        });
        await expect(waitingDispatch).rejects.toMatchObject({
            name: 'KillSwitchArbiterRevisionError',
        });
        await expect(
            client.request('verifyDispatchGrant', {
                ...dispatchInput(),
                revision: 2,
                activationRevision: 1,
                reservationRevision: 0,
            }),
        ).resolves.toEqual({ authorized: false });
    });

    it('does not withdraw a dispatch that crossed the arbiter before emergency commit', async () => {
        const { client } = await openRepository();
        await insertPreparedIntent(client);
        await startReadyRuntime(client, {}, { rearmPreparedIntent: true });
        const grant = await client.request('markIntentDispatching', dispatchInput());
        expect(grant).toMatchObject({
            state: 'dispatching',
            killSwitchArbiterRevision: 0,
            killSwitchOperationClass: 'new_exposure',
        });
        await client.request(
            'mutateKillSwitch',
            killSwitchMutationInput({
                switchName: 'emergency_block_all_writes',
                reasonCode: 'emergency_after_linearization',
                nowEpochMs: 1_786_377_600_210,
            }),
        );
        await expect(
            client.request('verifyDispatchGrant', {
                ...dispatchInput(),
                revision: grant.revision,
                activationRevision: grant.activationRevision,
                reservationRevision: grant.reservationRevision,
                rearmAuthorizationId: grant.rearmAuthorizationId,
                rearmRevision: grant.rearmRevision,
                killSwitchArbiterRevision: grant.killSwitchArbiterRevision,
                killSwitchOperationClass: grant.killSwitchOperationClass,
                killSwitchDecisionHash: grant.killSwitchDecisionHash,
            }),
        ).resolves.toMatchObject({
            authorized: true,
            envelope: {
                killSwitchArbiterRevision: 0,
                killSwitchOperationClass: 'new_exposure',
            },
        });
        await expect(
            client.request('markIntentOutcome', {
                intentId: 'intent-1',
                state: 'unknown',
                terminalOutcome: 'broker_result_unresolved',
                expectedRevision: grant.revision,
                dispatchAttemptNonce: 'dispatch-nonce-1',
                senderFence: 'sender-fence-1',
                apiGeneration: 'api-generation-1',
                nowEpochMs: 1_786_377_600_220,
            }),
        ).resolves.toMatchObject({
            state: 'unknown',
            emergencyCommittedAfterDispatch: true,
            withdrawnByKillSwitch: false,
            reconciliationRequired: true,
        });
    });

    it('persists a deal event before HTTP acknowledgement and makes its exact duplicate idempotent', async () => {
        const { client, databasePath } = await openRepository({
            testOnlyBrokerCorrelationIdentifierKinds: [
                'tradeId',
                'orderId',
                'dealId',
                'seqno',
                'ordno',
                'exchangeSequence',
            ],
        });
        await insertPreparedIntent(client);
        await startReadyRuntime(client, {}, { rearmPreparedIntent: true });
        const grant = await client.request(
            'markIntentDispatching',
            dispatchInput(),
        );
        const event = {
            runtimeEpochId: 'runtime-epoch-1',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            brokerOrderId: 'broker-order-event-before-ack',
            intentId: 'intent-1',
            state: 'part_filled',
            controlRevision: 0,
            quantityShares: 1_000,
            filledShares: 200,
            remainingShares: 800,
            evidenceHash: DIGEST_A,
            expectedRevision: null,
            nowEpochMs: 1_786_377_600_205,
        };
        await expect(
            client.request('recordBrokerOrderEvidence', event),
        ).resolves.toMatchObject({
            state: 'part_filled',
            revision: 0,
            replayed: false,
            brokerAuthorityGranted: false,
        });
        await expect(
            client.request('addBrokerCorrelation', {
                correlationId: 'correlation-event-before-ack',
                brokerOrderId: event.brokerOrderId,
                intentId: event.intentId,
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                tradeDate: '2026-08-11',
                contractKey: 'TSE:2330:STK:Common',
                side: 'Buy',
                tradeId: 'trade-event-before-ack',
                orderId: 'order-event-before-ack',
                dealId: 'deal-event-before-ack',
                seqno: 'seq-event-before-ack',
                ordno: 'ord-event-before-ack',
                exchangeSequence: 'exchange-event-before-ack',
                customField: 'EVB4AK',
                evidenceHash: DIGEST_A,
                createdAtEpochMs: 1_786_377_600_205,
            }),
        ).resolves.toMatchObject({
            correlationId: 'correlation-event-before-ack',
        });
        await expect(
            client.request('recordBrokerOrderEvidence', {
                ...event,
                nowEpochMs: 1_786_377_600_206,
            }),
        ).resolves.toMatchObject({
            state: 'part_filled',
            revision: 0,
            replayed: true,
            brokerAuthorityGranted: false,
        });
        await expect(
            client.request('recordBrokerOrderEvidence', {
                ...event,
                evidenceHash: DIGEST_B,
                nowEpochMs: 1_786_377_600_207,
            }),
        ).rejects.toThrow(
            'broker order evidence collided with a different first-event projection',
        );

        await expect(
            client.request('markIntentOutcome', {
                intentId: 'intent-1',
                state: 'acknowledged',
                terminalOutcome: 'broker_submit_acknowledged',
                expectedRevision: grant.revision,
                dispatchAttemptNonce: 'dispatch-nonce-1',
                senderFence: 'sender-fence-1',
                apiGeneration: 'api-generation-1',
                nowEpochMs: 1_786_377_600_210,
            }),
        ).resolves.toMatchObject({ state: 'acknowledged' });

        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database
                .prepare(`
                    SELECT state, revision, evidence_hash
                      FROM broker_orders
                     WHERE broker_order_id='broker-order-event-before-ack'
                `)
                .get(),
        ).toEqual({
            state: 'part_filled',
            revision: 0,
            evidence_hash: DIGEST_A,
        });
        expect(
            database
                .prepare(`
                    SELECT COUNT(*) AS count
                      FROM event_journal
                     WHERE entity_kind='broker_order'
                       AND entity_id='broker-order-event-before-ack'
                `)
                .get(),
        ).toEqual({ count: 1 });
        expect(
            database
                .prepare(`
                    SELECT intent_id, broker_order_id, trade_date, trade_id,
                           order_id, deal_id, seqno, ordno, exchange_sequence
                      FROM broker_correlations
                     WHERE correlation_id='correlation-event-before-ack'
                `)
                .get(),
        ).toEqual({
            intent_id: 'intent-1',
            broker_order_id: 'broker-order-event-before-ack',
            trade_date: '2026-08-11',
            trade_id: 'trade-event-before-ack',
            order_id: 'order-event-before-ack',
            deal_id: 'deal-event-before-ack',
            seqno: 'seq-event-before-ack',
            ordno: 'ord-event-before-ack',
            exchange_sequence: 'exchange-event-before-ack',
        });
        database.close();
    });

    it('rejects a late older broker event without regressing the durable order projection', async () => {
        const { client, databasePath } = await openRepository();
        await insertPreparedIntent(client);
        await startReadyRuntime(client, {}, { rearmPreparedIntent: true });
        await client.request('markIntentDispatching', dispatchInput());

        const submitted = {
            runtimeEpochId: 'runtime-epoch-1',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            brokerOrderId: 'broker-order-reordered-event',
            intentId: 'intent-1',
            state: 'submitted',
            controlRevision: 0,
            quantityShares: 1_000,
            filledShares: 0,
            remainingShares: 1_000,
            evidenceHash: DIGEST_A,
            expectedRevision: null,
            nowEpochMs: 1_786_377_600_205,
        };
        await expect(
            client.request('recordBrokerOrderEvidence', submitted),
        ).resolves.toMatchObject({ state: 'submitted', revision: 0 });
        await expect(
            client.request('recordBrokerOrderEvidence', {
                ...submitted,
                state: 'part_filled',
                filledShares: 200,
                remainingShares: 800,
                evidenceHash: DIGEST_B,
                expectedRevision: 0,
                nowEpochMs: 1_786_377_600_210,
            }),
        ).resolves.toMatchObject({ state: 'part_filled', revision: 1 });

        await expect(
            client.request('recordBrokerOrderEvidence', {
                ...submitted,
                expectedRevision: 1,
                nowEpochMs: 1_786_377_600_220,
            }),
        ).rejects.toThrow(
            'broker order evidence lost its lineage, state, quantity, or revision CAS',
        );

        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database
                .prepare(`
                    SELECT state, filled_shares, remaining_shares,
                           evidence_hash, revision
                      FROM broker_orders
                     WHERE broker_order_id='broker-order-reordered-event'
                `)
                .get(),
        ).toEqual({
            state: 'part_filled',
            filled_shares: 200,
            remaining_shares: 800,
            evidence_hash: DIGEST_B,
            revision: 1,
        });
        database.close();
    });

    it('allows only a re-armed explicit manual cancel through pause policies', async () => {
        const { client, databasePath } = await openRepository({
            testOnlyBrokerCorrelationIdentifierKinds: [
                'tradeId',
                'orderId',
                'seqno',
                'ordno',
            ],
        });
        await client.request('insertStrategy', strategyInput());
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                activation: {
                    activationId: 'activation-manual-cancel-target',
                    logicalKey: 'edge-manual-cancel-target',
                },
                intent: {
                    intentId: 'intent-manual-cancel-target',
                    clientRequestId: 'request-manual-cancel-target',
                },
            }),
        );
        await startReadyRuntime(client, {}, {
            rearmPreparedIntent: true,
            rearmOverrides: {
                rearmAuthorizationId: 'rearm-manual-cancel-target',
                rearmRequestId: 'rearm-request-manual-cancel-target',
                intentId: 'intent-manual-cancel-target',
            },
        });
        const targetDispatch = await client.request(
            'markIntentDispatching',
            dispatchInput({
                intentId: 'intent-manual-cancel-target',
                expectedReservationRevision: 0,
                dispatchAttemptNonce: 'dispatch-nonce-manual-cancel-target',
            }),
        );
        await client.request('markIntentOutcome', {
            intentId: 'intent-manual-cancel-target',
            state: 'acknowledged',
            terminalOutcome: 'broker_submit_acknowledged',
            expectedRevision: targetDispatch.revision,
            dispatchAttemptNonce: 'dispatch-nonce-manual-cancel-target',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            nowEpochMs: 1_786_377_600_205,
        });
        await expect(
            client.request('recordBrokerOrderEvidence', {
                runtimeEpochId: 'runtime-epoch-1',
                senderFence: 'sender-fence-1',
                apiGeneration: 'api-generation-1',
                brokerOrderId: 'broker-order-manual-cancel',
                intentId: 'intent-manual-cancel-target',
                state: 'submitted',
                controlRevision: 0,
                quantityShares: 1_000,
                filledShares: 0,
                remainingShares: 1_000,
                evidenceHash: DIGEST_A,
                expectedRevision: null,
                nowEpochMs: 1_786_377_600_206,
            }),
        ).resolves.toMatchObject({
            state: 'submitted',
            brokerAuthorityGranted: false,
        });
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                nowEpochMs: 1_786_377_600_210,
                activation: {
                    activationId: 'activation-manual-cancel',
                    logicalKey: 'edge-manual-cancel',
                    generation: 2,
                },
                intent: {
                    intentId: 'intent-manual-cancel',
                    operationKind: 'cancel',
                    ownerKind: 'manual_request',
                    payload: MANUAL_CANCEL_INTENT_PAYLOAD,
                    payloadHash: MANUAL_CANCEL_INTENT_PAYLOAD_DIGEST,
                    clientRequestId: 'request-manual-cancel',
                    side: 'Buy',
                    targetBrokerOrderId: 'broker-order-manual-cancel',
                    targetControlRevision: 0,
                },
                reservation: null,
            }),
        );
        await client.request(
            'rearmPreparedIntent',
            rearmInput({
                rearmAuthorizationId: 'rearm-manual-cancel',
                rearmRequestId: 'rearm-request-manual-cancel',
                intentId: 'intent-manual-cancel',
                nowEpochMs: 1_786_377_600_211,
            }),
        );
        await client.request('mutateKillSwitch', killSwitchMutationInput());
        await client.request(
            'mutateKillSwitch',
            killSwitchMutationInput({
                switchName: 'pause_automation',
                expectedArbiterRevision: 1,
                reasonCode: 'automation_pause',
                nowEpochMs: 1_786_377_600_191,
            }),
        );
        const cancelDispatch = dispatchInput({
            intentId: 'intent-manual-cancel',
            expectedReservationRevision: undefined,
            rearmAuthorizationId: 'rearm-manual-cancel',
            expectedKillSwitchArbiterRevision: 2,
            killSwitchArbiterRevision: 2,
            dispatchAttemptNonce: 'dispatch-nonce-manual-cancel',
        });
        await expect(
            client.request('markIntentDispatching', cancelDispatch),
        ).rejects.toMatchObject({ name: 'KillSwitchDeniedError' });
        await client.request('addBrokerCorrelation', {
            correlationId: 'correlation-manual-cancel-target',
            intentId: 'intent-manual-cancel-target',
            brokerOrderId: 'broker-order-manual-cancel',
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            tradeDate: '2026-08-11',
            contractKey: 'TSE:2330:STK:Common',
            side: 'Buy',
            tradeId: 'protected-entry-trade-1',
            orderId: 'protected-entry-order-1',
            seqno: 'protected-entry-seq-1',
            ordno: 'protected-entry-ord-1',
            customField: 'PE0001',
            evidenceHash: DIGEST_B,
            createdAtEpochMs: 1_786_377_600_212,
        });
        await client.request('recordCanonicalBrokerEvent', {
            runtimeEpochId: 'runtime-epoch-1',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            event: protectedEntryBrokerEvent({
                apiGeneration: 'api-generation-1',
            }),
        });
        seedDurableOriginatingIntentUnit(
            databasePath,
            'intent-manual-cancel-target',
        );
        const cancelGrant = await client.request(
            'markIntentDispatching',
            cancelDispatch,
        );
        expect(cancelGrant).toMatchObject({
            state: 'dispatching',
            reservationRevision: undefined,
            killSwitchArbiterRevision: 2,
            killSwitchOperationClass: 'explicit_manual_cancel',
            targetRevision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        });
        const verifiedCancel = await client.request('verifyDispatchGrant', {
                ...cancelDispatch,
                revision: cancelGrant.revision,
                activationRevision: cancelGrant.activationRevision,
                rearmRevision: cancelGrant.rearmRevision,
                targetRevision: cancelGrant.targetRevision,
                killSwitchOperationClass:
                    cancelGrant.killSwitchOperationClass,
                killSwitchOperationEvidenceHash:
                    cancelGrant.killSwitchOperationEvidenceHash,
                killSwitchDecisionHash: cancelGrant.killSwitchDecisionHash,
            });
        expect(verifiedCancel).toMatchObject({
            authorized: true,
            envelope: {
                targetRevision: cancelGrant.targetRevision,
                adapterTarget: {
                    account: {
                        brokerId: 'broker-A',
                        accountId: 'account-A',
                        accountType: 'S',
                    },
                    brokerOrderId: 'broker-order-manual-cancel',
                    brokerOrderRevision: 0,
                    controlRevision: 0,
                    identifiers: {
                        tradeId: 'protected-entry-trade-1',
                        orderId: 'protected-entry-order-1',
                        seqno: 'protected-entry-seq-1',
                        ordno: 'protected-entry-ord-1',
                    },
                    targetRevision: cancelGrant.targetRevision,
                },
            },
        });
        await expect(
            client.request('recordBrokerOrderEvidence', {
                runtimeEpochId: 'runtime-epoch-1',
                senderFence: 'sender-fence-1',
                apiGeneration: 'api-generation-1',
                brokerOrderId: 'broker-order-manual-cancel',
                intentId: 'intent-manual-cancel-target',
                state: 'part_filled',
                controlRevision: 0,
                quantityShares: 1_000,
                filledShares: 100,
                remainingShares: 900,
                evidenceHash: DIGEST_B,
                expectedRevision: 0,
                nowEpochMs: 1_786_377_600_213,
            }),
        ).resolves.toMatchObject({ state: 'part_filled', revision: 1 });
        await expect(
            client.request('verifyDispatchGrant', {
                ...cancelDispatch,
                revision: cancelGrant.revision,
                activationRevision: cancelGrant.activationRevision,
                rearmRevision: cancelGrant.rearmRevision,
                targetRevision: cancelGrant.targetRevision,
                killSwitchOperationClass:
                    cancelGrant.killSwitchOperationClass,
                killSwitchOperationEvidenceHash:
                    cancelGrant.killSwitchOperationEvidenceHash,
                killSwitchDecisionHash: cancelGrant.killSwitchDecisionHash,
            }),
        ).resolves.toEqual({
            authorized: false,
            reasonCode: 'broker_target_changed',
        });
    });

    it('requires exact local ExitClaim proof and applies pause_automation over pause_new_exposure', async () => {
        const { client, databasePath } = await openRepository();
        const protectionGroupId = `protection-group:${createHash('sha256')
            .update(canonicalJson('exit-claim-kill-switch'))
            .digest('hex')}`;
        await startReadyRuntime(client, {
            runtimeEpochId: 'protected-entry-setup-runtime',
            senderFence: 'protected-entry-setup-fence',
            apiGeneration: 'simulation-generation/1',
        });
        await client.request('insertStrategy', strategyInput());
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                protectionCommitment: {
                    commitmentId: 'commitment-kill-switch',
                    committedShares: 1_000,
                },
                protectionObligation: {
                    obligationId: 'obligation-kill-switch',
                    positionLineageId: 'position-lineage-kill-switch',
                },
            }),
        );
        await client.close();
        openClients.delete(client);
        const seed = new DatabaseSync(databasePath);
        seed.exec('PRAGMA foreign_keys=ON');
        seed.prepare(`
            UPDATE pending_protection_commitments
               SET state='materialized', materialized_shares=1000,
                   updated_at_epoch_ms=1786377600200, revision=1
             WHERE commitment_id='commitment-kill-switch'
        `).run();
        seed.prepare(`
            UPDATE protection_obligations
               SET state='monitoring', filled_shares=1000,
                   updated_at_epoch_ms=1786377600200, revision=1
             WHERE obligation_id='obligation-kill-switch'
        `).run();
        seed.prepare(`
            INSERT INTO exit_claims(
                exit_claim_id, obligation_id, intent_id, external_lineage,
                account_broker_ref, account_id_ref, contract_key,
                position_lineage_id, remainder_generation,
                allocation_start_share, quantity_shares, state,
                evidence_hash, created_at_epoch_ms, updated_at_epoch_ms,
                revision
            ) VALUES (
                'exit-claim-kill-switch', 'obligation-kill-switch', NULL, 0,
                'broker-A', 'account-A', 'TSE:2330:STK:Common',
                'position-lineage-kill-switch', 0, 0, 1000,
                'monitoring_reserved', '${DIGEST_A}',
                1786377600200, 1786377600200, 0
            )
        `).run();
        seed.prepare(`
            INSERT INTO protection_groups(
                protection_group_id, obligation_id, exit_claim_id, state,
                current_generation, plan_hash, created_at_epoch_ms,
                updated_at_epoch_ms, revision
            ) VALUES (?, 'obligation-kill-switch', 'exit-claim-kill-switch',
                      'monitoring', 0, ?, 1786377600200, 1786377600200, 0)
        `).run(
            protectionGroupId,
            protectedEntryProjection().payload.protectionPlanSha256,
        );
        seed.prepare(`
            INSERT INTO protection_remainder_generations(
                protection_group_id, remainder_generation, exit_claim_id,
                state, quantity_shares, evidence_hash,
                created_at_epoch_ms, updated_at_epoch_ms, revision
            ) VALUES (?, 0, 'exit-claim-kill-switch', 'monitoring', 1000, ?,
                      1786377600200, 1786377600200, 0)
        `).run(protectionGroupId, DIGEST_A);
        terminalizeProtectedEntryFixture(seed);
        seed.close();

        const reopened = await openRepository({ databasePath });
        const protectiveIntent = preparedIntentInput({
                nowEpochMs: 1_786_377_600_120,
                activation: {
                    activationId: 'activation-protective-kill-switch',
                    logicalKey: 'edge-protective-kill-switch',
                    generation: 0,
                },
                intent: {
                    intentId: 'intent-protective-kill-switch',
                    side: 'Sell',
                    payload: PROTECTIVE_INTENT_PAYLOAD,
                    payloadHash: PROTECTIVE_INTENT_PAYLOAD_DIGEST,
                    clientRequestId: 'request-protective-kill-switch',
                },
                reservation: null,
                exitClaim: {
                    exitClaimId: 'exit-claim-kill-switch',
                    obligationId: 'obligation-kill-switch',
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    contractKey: 'TSE:2330:STK:Common',
                    positionLineageId: 'position-lineage-kill-switch',
                    remainderGeneration: 0,
                    allocationStartShare: 0,
                    quantityShares: 1_000,
                    expectedRevision: 0,
                    evidenceHash: DIGEST_B,
                    protectionGroupId,
                    expectedGroupRevision: 0,
                    expectedGenerationRevision: 0,
                    candidateEvaluations: [
                        {
                            legId: 'stop-leg',
                            evidenceHash: DIGEST_B,
                            observedAtEpochMs: 1_786_377_600_120,
                        },
                    ],
                },
            });
        Object.assign(protectiveIntent, {
            runtimeEpochId: 'protected-entry-setup-runtime',
            senderFence: 'protected-entry-setup-fence',
            apiGeneration: 'simulation-generation/1',
        });
        await reopened.client.request('prepareIntent', protectiveIntent);
        const started = await reopened.client.request(
            'startRuntimeEpoch',
            runtimeEpochInput(),
        );
        await reopened.client.request(
            'rearmPreparedIntent',
            rearmInput({
                rearmAuthorizationId: 'rearm-protective-kill-switch',
                rearmRequestId: 'rearm-request-protective-kill-switch',
                intentId: 'intent-protective-kill-switch',
                userRearmEvidenceHash: DIGEST_B,
                nowEpochMs: 1_786_377_600_176,
            }),
        );
        await reopened.client.request('markRuntimeEpochReady', {
            runtimeEpochId: 'runtime-epoch-1',
            apiGeneration: 'api-generation-1',
            senderFence: 'sender-fence-1',
            expectedRevision: started.revision,
            reconciliationEvidenceHash: DIGEST_B,
        });
        await reopened.client.request(
            'mutateKillSwitch',
            killSwitchMutationInput(),
        );
        await reopened.client.request(
            'mutateKillSwitch',
            killSwitchMutationInput({
                switchName: 'pause_automation',
                expectedArbiterRevision: 1,
                reasonCode: 'automation_pause',
                nowEpochMs: 1_786_377_600_191,
            }),
        );
        const protectiveDispatch = dispatchInput({
            intentId: 'intent-protective-kill-switch',
            expectedReservationRevision: undefined,
            dispatchAttemptNonce: 'dispatch-nonce-protective-kill-switch',
            expectedKillSwitchArbiterRevision: 2,
        });
        await expect(
            reopened.client.request('markIntentDispatching', protectiveDispatch),
        ).rejects.toMatchObject({ name: 'KillSwitchDeniedError' });
        await reopened.client.request(
            'mutateKillSwitch',
            killSwitchMutationInput({
                switchName: 'pause_automation',
                enabled: false,
                expectedArbiterRevision: 2,
                reasonCode: 'automation_pause_released',
                nowEpochMs: 1_786_377_600_192,
            }),
        );
        await expect(
            reopened.client.request('markIntentDispatching', {
                ...protectiveDispatch,
                expectedKillSwitchArbiterRevision: 3,
            }),
        ).resolves.toMatchObject({
            state: 'dispatching',
            killSwitchArbiterRevision: 3,
            killSwitchOperationClass: 'protective_reduce_only',
        });
    });

    it('rejects a protective exception whose canonical payload quantity differs from its unique claim', async () => {
        const protectionGroupId = protectionGroupIdForTestClaim(
            'exit-claim-protective-mismatch',
        );
        const { client, databasePath } = await openRepository();
        await startReadyRuntime(client, {
            runtimeEpochId: 'protected-entry-setup-runtime',
            senderFence: 'protected-entry-setup-fence',
            apiGeneration: 'simulation-generation/1',
        });
        await client.request('insertStrategy', strategyInput());
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                protectionCommitment: {
                    commitmentId: 'commitment-protective-mismatch',
                    committedShares: 1_000,
                },
                protectionObligation: {
                    obligationId: 'obligation-protective-mismatch',
                    positionLineageId: 'position-lineage-protective-mismatch',
                },
            }),
        );
        await client.close();
        openClients.delete(client);
        const seed = new DatabaseSync(databasePath);
        seed.exec('PRAGMA foreign_keys=ON');
        seed.prepare(`
            UPDATE pending_protection_commitments
               SET state='materialized', materialized_shares=1000,
                   updated_at_epoch_ms=1786377600200, revision=1
             WHERE commitment_id='commitment-protective-mismatch'
        `).run();
        seed.prepare(`
            UPDATE protection_obligations
               SET state='monitoring', filled_shares=1000,
                   updated_at_epoch_ms=1786377600200, revision=1
             WHERE obligation_id='obligation-protective-mismatch'
        `).run();
        seed.prepare(`
            INSERT INTO exit_claims(
                exit_claim_id, obligation_id, intent_id, external_lineage,
                account_broker_ref, account_id_ref, contract_key,
                position_lineage_id, remainder_generation,
                allocation_start_share, quantity_shares, state,
                evidence_hash, created_at_epoch_ms, updated_at_epoch_ms,
                revision
            ) VALUES (
                'exit-claim-protective-mismatch',
                'obligation-protective-mismatch', NULL, 0,
                'broker-A', 'account-A', 'TSE:2330:STK:Common',
                'position-lineage-protective-mismatch', 0, 0, 1000,
                'monitoring_reserved', '${DIGEST_A}',
                1786377600200, 1786377600200, 0
            )
        `).run();
        seed.prepare(`
            INSERT INTO protection_groups(
                protection_group_id, obligation_id, exit_claim_id, state,
                current_generation, plan_hash, created_at_epoch_ms,
                updated_at_epoch_ms, revision
            ) VALUES (?, 'obligation-protective-mismatch',
                      'exit-claim-protective-mismatch', 'monitoring', 0, ?,
                      1786377600200, 1786377600200, 0)
        `).run(
            protectionGroupId,
            protectedEntryProjection().payload.protectionPlanSha256,
        );
        seed.prepare(`
            INSERT INTO protection_remainder_generations(
                protection_group_id, remainder_generation, exit_claim_id,
                state, quantity_shares, evidence_hash,
                created_at_epoch_ms, updated_at_epoch_ms, revision
            ) VALUES (?, 0, 'exit-claim-protective-mismatch', 'monitoring',
                      1000, ?, 1786377600200, 1786377600200, 0)
        `).run(protectionGroupId, DIGEST_A);
        terminalizeProtectedEntryFixture(seed);
        seed.close();
        const reopened = await openRepository({ databasePath });
        const mismatchedProjection = protectiveBrokerIntentProjection({
            quantityShares: 999,
        });
        await expect(reopened.client.request(
            'prepareIntent',
            preparedIntentInput({
                nowEpochMs: 1_786_377_600_120,
                activation: {
                    activationId: 'activation-protective-mismatch',
                    logicalKey: 'edge-protective-mismatch',
                    generation: 0,
                },
                intent: {
                    intentId: 'intent-protective-mismatch',
                    side: 'Sell',
                    payload: mismatchedProjection.payload,
                    payloadHash: mismatchedProjection.payloadSha256,
                    clientRequestId: 'request-protective-mismatch',
                },
                reservation: null,
                exitClaim: {
                    exitClaimId: 'exit-claim-protective-mismatch',
                    obligationId: 'obligation-protective-mismatch',
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    contractKey: 'TSE:2330:STK:Common',
                    positionLineageId: 'position-lineage-protective-mismatch',
                    remainderGeneration: 0,
                    allocationStartShare: 0,
                    quantityShares: 1_000,
                    expectedRevision: 0,
                    evidenceHash: DIGEST_B,
                    protectionGroupId,
                    expectedGroupRevision: 0,
                    expectedGenerationRevision: 0,
                    candidateEvaluations: [
                        {
                            legId: 'stop-leg',
                            evidenceHash: DIGEST_B,
                            observedAtEpochMs: 1_786_377_600_120,
                        },
                    ],
                },
                runtimeEpochId: 'protected-entry-setup-runtime',
                senderFence: 'protected-entry-setup-fence',
                apiGeneration: 'simulation-generation/1',
            }),
        )).rejects.toThrow(
            'protection OCO group, claim lineage, or optimistic revision does not exactly match',
        );
        const verify = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verify.prepare(`
                SELECT COUNT(*) AS count FROM order_intents
                 WHERE intent_id='intent-protective-mismatch'
            `).get(),
        ).toEqual({ count: 0 });
        verify.close();
    });

    it('never grants broker dispatch to a matched protective remainder that is not a whole CommonLot', async () => {
        const databasePath = await createMonitoringExitClaimFixture({
            claimQuantityShares: 500,
            entryCommittedShares: 1_000,
        });
        const reopened = await openRepository({
            databasePath,
            testOnlyExternalSellVisibilityHeads: [
                defaultExternalSellVisibilityHead(),
            ],
        });
        const projection = protectiveBrokerIntentProjection({
            quantityShares: 500,
        });
        await prepareReadyVisibilitySell(reopened.client, {
            intent: {
                payload: projection.payload,
                payloadHash: projection.payloadSha256,
            },
            exitClaim: { quantityShares: 500 },
        });
        await expect(
            reopened.client.request(
                'markIntentDispatching',
                dispatchInput({
                    intentId: 'visibility-sell-intent',
                    expectedReservationRevision: undefined,
                    rearmAuthorizationId: 'visibility-sell-rearm',
                }),
            ),
        ).rejects.toThrow(
            'protective broker intent lost its exact CommonLot claim/execution binding',
        );
        const verify = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verify.prepare(`
                SELECT state, adapter_authority_granted
                  FROM order_intents
                 WHERE intent_id='visibility-sell-intent'
            `).get(),
        ).toEqual({ state: 'prepared', adapter_authority_granted: 0 });
        verify.close();
    });

    it('journals every critical outbox transition internally without caller events', async () => {
        const { client, databasePath } = await openRepository({
            testOnlyBrokerCorrelationIdentifierKinds: ['orderId'],
        });
        await insertPreparedIntent(client);
        await client.request('addBrokerCorrelation', {
            correlationId: 'correlation-journal-proof',
            intentId: 'intent-1',
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            tradeDate: '2026-08-11',
            contractKey: 'TSE:2330:STK:Common',
            side: 'Buy',
            orderId: 'order-journal-proof',
            evidenceHash: DIGEST_A,
            createdAtEpochMs: 1_786_377_600_125,
        });
        await startReadyRuntime(client, {}, { rearmPreparedIntent: true });
        await client.request('markIntentDispatching', dispatchInput());
        await client.request('markIntentOutcome', {
            intentId: 'intent-1',
            state: 'unknown',
            terminalOutcome: 'broker_result_unresolved',
            expectedRevision: 2,
            dispatchAttemptNonce: 'dispatch-nonce-1',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            nowEpochMs: 1_786_377_600_250,
        });
        await client.close();
        openClients.delete(client);

        const database = new DatabaseSync(databasePath, { readOnly: true });
        const journalCounts = Object.fromEntries(
            database
                .prepare(`
                    SELECT entity_kind, COUNT(*) AS count
                      FROM event_journal
                     GROUP BY entity_kind ORDER BY entity_kind
                `)
                .all()
                .map((row) => [row.entity_kind, row.count]),
        );
        expect(journalCounts).toMatchObject({
            strategy: 2,
            activation: 2,
            order_intent: 5,
            entry_exposure_reservation: 1,
            broker_correlation: 1,
            runtime_epoch: 2,
        });
        expect(
            database
                .prepare(`
                    SELECT reason_code FROM event_journal
                     WHERE entity_kind='order_intent'
                     ORDER BY journal_sequence
                `)
                .all()
                .map((row) => row.reason_code),
        ).toEqual([
            'ORDER_INTENT_PREPARED_DURABLY',
            'PREPARED_INTENT_USER_REARM_AUTHORIZED',
            'ORDER_INTENT_DISPATCH_AUTHORITY_DURABLE',
            'PREPARED_INTENT_REARM_CONSUMED_FOR_DISPATCH',
            'ORDER_INTENT_OUTCOME_UNKNOWN',
        ]);
        database.close();
    });

    it('recovers every dispatching intent as reconciling without redispatch authority', async () => {
        const { client, databasePath } = await openRepository();
        await insertPreparedIntent(client);
        await startReadyRuntime(client, {}, { rearmPreparedIntent: true });
        const dispatch = dispatchInput();
        await client.request('markIntentDispatching', dispatch);

        await expect(
            client.request('startRuntimeEpoch', {
                runtimeEpochId: 'runtime-epoch-2',
                apiGeneration: 'api-generation-2',
                senderFence: 'sender-fence-2',
                leaseEvidenceHash: DIGEST_B,
                nowEpochMs: 1_786_377_600_300,
            }),
        ).resolves.toMatchObject({
            runtimeEpochId: 'runtime-epoch-2',
            state: 'reconciling',
            recoveredIntentIds: ['intent-1'],
            automaticRedispatchAllowed: false,
        });
        await expect(
            client.request('verifyDispatchGrant', {
                ...dispatch,
                revision: 2,
                activationRevision: 1,
                reservationRevision: 0,
            }),
        ).resolves.toEqual({ authorized: false });
        await expect(
            client.request('markRuntimeEpochReady', {
                runtimeEpochId: 'runtime-epoch-2',
                apiGeneration: 'api-generation-2',
                senderFence: 'sender-fence-2',
                expectedRevision: 0,
                reconciliationEvidenceHash: DIGEST_A,
            }),
        ).rejects.toThrow('unresolved blockers');

        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database
                .prepare(`
                    SELECT intents.state, intents.terminal_outcome,
                           intents.adapter_authority_granted,
                           activations.state AS activation_state,
                           reservations.state AS reservation_state
                      FROM order_intents AS intents
                      JOIN activations
                        ON activations.activation_id=intents.activation_id
                      JOIN entry_exposure_reservations AS reservations
                        ON reservations.intent_id=intents.intent_id
                     WHERE intents.intent_id='intent-1'
                `)
                .get(),
        ).toEqual({
            state: 'reconciling',
            terminal_outcome: 'restart_after_dispatch_fence',
            adapter_authority_granted: 1,
            activation_state: 'unknown',
            reservation_state: 'unknown',
        });
        database.close();
    });

    it('atomically invalidates a changed API generation without re-arm or redispatch authority', async () => {
        const { client, databasePath } = await openRepository();
        const runtime = runtimeEpochInput();
        const started = await client.request('startRuntimeEpoch', runtime);
        await client.request('insertStrategy', strategyInput());
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-observing',
                state: 'observing',
                nowEpochMs: 1_786_377_600_001,
            }),
        );
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-paused',
                state: 'paused',
                nowEpochMs: 1_786_377_600_002,
            }),
        );
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-completed',
                state: 'completed',
                nowEpochMs: 1_786_377_600_003,
                terminalAtEpochMs: 1_786_377_600_003,
            }),
        );
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-trailing-generation',
                strategyKind: 'trailing_exit',
                state: 'monitoring',
                definition: {
                    schemaVersion: 'strategy/1',
                    kind: 'trailing_exit',
                },
                nowEpochMs: 1_786_377_600_004,
            }),
        );
        await client.request('prepareIntent', preparedIntentInput());
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                strategyId: 'strategy-observing',
                activation: {
                    activationId: 'activation-2',
                    logicalKey: 'edge-2',
                },
                intent: {
                    intentId: 'intent-2',
                    clientRequestId: 'request-2',
                },
                reservation: { reservationId: 'reservation-2' },
                nowEpochMs: 1_786_377_600_101,
            }),
        );
        const manifest = observeOnlyGateManifest();
        await client.request('storeGateManifest', {
            manifest,
            nowEpochMs: manifest.createdAtEpochMs,
        });
        await client.request('rearmPreparedIntent', rearmInput());
        await client.request(
            'rearmPreparedIntent',
            rearmInput({
                rearmAuthorizationId: 'rearm-authorization-2',
                rearmRequestId: 'rearm-request-2',
                intentId: 'intent-2',
                nowEpochMs: 1_786_377_600_176,
            }),
        );
        const ready = await client.request('markRuntimeEpochReady', {
            runtimeEpochId: runtime.runtimeEpochId,
            apiGeneration: runtime.apiGeneration,
            senderFence: runtime.senderFence,
            expectedRevision: started.revision,
            reconciliationEvidenceHash: DIGEST_B,
        });
        await client.request('markIntentDispatching', dispatchInput());

        await expect(
            client.request('invalidateRuntimeApiGeneration', {
                runtimeEpochId: runtime.runtimeEpochId,
                apiGeneration: runtime.apiGeneration,
                senderFence: runtime.senderFence,
                observedApiGeneration: runtime.apiGeneration,
                nowEpochMs: 1_786_377_600_250,
            }),
        ).rejects.toThrow('requires a changed observation');
        await expect(client.request('status')).resolves.toMatchObject({
            tradingSenderAuthority: 'runtime:runtime-epoch-1',
        });

        const invalidated = await client.request(
            'invalidateRuntimeApiGeneration',
            {
                runtimeEpochId: runtime.runtimeEpochId,
                apiGeneration: runtime.apiGeneration,
                senderFence: runtime.senderFence,
                observedApiGeneration: 'api-generation-2',
                nowEpochMs: 1_786_377_600_300,
            },
        );
        expect(invalidated).toEqual({
            runtimeEpochId: 'runtime-epoch-1',
            state: 'reconciling',
            previousState: 'ready',
            revision: ready.revision + 1,
            reason: 'generation_invalidated',
            observedApiGenerationSha256: createHash('sha256')
                .update('api-generation-2')
                .digest('hex')
                .replace(/^/, 'sha256:'),
            recoveryStrategyIds: ['strategy-1', 'strategy-observing'],
            manualInterventionStrategyIds: ['strategy-trailing-generation'],
            supersededRearmIntentIds: ['intent-2'],
            recoveredIntentIds: ['intent-1'],
            invalidatedGateManifestCount: 1,
            automaticRedispatchAllowed: false,
            requiresProcessRestart: true,
        });
        await expect(
            client.request('markRuntimeEpochReady', {
                runtimeEpochId: runtime.runtimeEpochId,
                apiGeneration: runtime.apiGeneration,
                senderFence: runtime.senderFence,
                expectedRevision: invalidated.revision,
                reconciliationEvidenceHash: DIGEST_A,
            }),
        ).rejects.toThrow('API generation was invalidated');
        await expect(
            client.request(
                'rearmPreparedIntent',
                rearmInput({
                    rearmAuthorizationId: 'rearm-authorization-3',
                    rearmRequestId: 'rearm-request-3',
                    intentId: 'intent-2',
                    expectedIntentRevision: 1,
                    nowEpochMs: 1_786_377_600_325,
                }),
            ),
        ).rejects.toThrow('API generation was invalidated');
        await expect(
            client.request('verifyDispatchGrant', {
                ...dispatchInput(),
                revision: 2,
                activationRevision: 1,
                reservationRevision: 0,
            }),
        ).resolves.toEqual({ authorized: false });
        await expect(
            client.request('gateManifestStatus', {
                provenance: 'automation',
                nowEpochMs: 1_786_377_600_301,
            }),
        ).resolves.toMatchObject({
            state: 'observe_only',
            blocker: 'api_generation_changed',
        });

        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database
                .prepare(`
                    SELECT strategy_id, state, revision
                      FROM strategies
                     ORDER BY strategy_id
                `)
                .all(),
        ).toEqual([
            { strategy_id: 'strategy-1', state: 'recovery', revision: 1 },
            {
                strategy_id: 'strategy-completed',
                state: 'completed',
                revision: 0,
            },
            {
                strategy_id: 'strategy-observing',
                state: 'recovery',
                revision: 1,
            },
            { strategy_id: 'strategy-paused', state: 'paused', revision: 0 },
            {
                strategy_id: 'strategy-trailing-generation',
                state: 'manual_intervention',
                revision: 1,
            },
        ]);
        expect(
            database
                .prepare(`
                    SELECT cases.reason_code, cases.state AS case_state,
                           blockers.reason_code AS blocker_reason_code,
                           blockers.state AS blocker_state,
                           cases.scope_hash=blockers.scope_hash AS scopes_match
                      FROM resolution_cases AS cases
                      JOIN safety_blockers AS blockers
                        ON blockers.resolution_case_id=cases.resolution_case_id
                     WHERE cases.strategy_id='strategy-trailing-generation'
                `)
                .get(),
        ).toEqual({
            reason_code: 'TRAILING_GAP_EXTREME_UNKNOWN',
            case_state: 'open',
            blocker_reason_code: 'TRAILING_GAP_EXTREME_UNKNOWN',
            blocker_state: 'open',
            scopes_match: 1,
        });
        expect(
            database
                .prepare(`
                    SELECT intent_id, state, terminal_outcome,
                           adapter_authority_granted, revision
                      FROM order_intents
                     ORDER BY intent_id
                `)
                .all(),
        ).toEqual([
            {
                intent_id: 'intent-1',
                state: 'reconciling',
                terminal_outcome:
                    'api_generation_changed_after_dispatch_fence',
                adapter_authority_granted: 1,
                revision: 3,
            },
            {
                intent_id: 'intent-2',
                state: 'prepared',
                terminal_outcome: null,
                adapter_authority_granted: 0,
                revision: 1,
            },
        ]);
        expect(
            database
                .prepare(`
                    SELECT activation_id, state, revision
                      FROM activations ORDER BY activation_id
                `)
                .all(),
        ).toEqual([
            { activation_id: 'activation-1', state: 'unknown', revision: 2 },
            { activation_id: 'activation-2', state: 'prepared', revision: 0 },
        ]);
        expect(
            database
                .prepare(`
                    SELECT reservation_id, state, revision
                      FROM entry_exposure_reservations
                     ORDER BY reservation_id
                `)
                .all(),
        ).toEqual([
            { reservation_id: 'reservation-1', state: 'unknown', revision: 1 },
            { reservation_id: 'reservation-2', state: 'reserved', revision: 0 },
        ]);
        expect(
            database
                .prepare(`
                    SELECT state, reconciliation_evidence_hash, revision
                      FROM runtime_epochs
                     WHERE runtime_epoch_id='runtime-epoch-1'
                `)
                .get(),
        ).toEqual({
            state: 'reconciling',
            reconciliation_evidence_hash: null,
            revision: 2,
        });
        expect(
            database
                .prepare(`
                    SELECT rearm_authorization_id, state, revision
                      FROM intent_rearm_authorizations
                     ORDER BY rearm_authorization_id
                `)
                .all(),
        ).toEqual([
            {
                rearm_authorization_id: 'rearm-authorization-1',
                state: 'consumed',
                revision: 1,
            },
            {
                rearm_authorization_id: 'rearm-authorization-2',
                state: 'superseded',
                revision: 1,
            },
        ]);
        expect(
            database
                .prepare(`
                    SELECT state, invalidation_reason, revision
                      FROM gate_manifests
                     WHERE manifest_id='manifest-1'
                `)
                .get(),
        ).toEqual({
            state: 'invalidated',
            invalidation_reason: 'api_generation_changed',
            revision: 1,
        });
        const journal = database
            .prepare(`
                SELECT reason_code, payload_hash
                  FROM event_journal
                 WHERE reason_code LIKE '%API_GENERATION%'
                 ORDER BY journal_sequence
            `)
            .all();
        expect(journal.map((event) => event.reason_code)).toEqual([
            'RUNTIME_API_GENERATION_CHANGED',
            'RUNTIME_API_GENERATION_CHANGED',
            'PREPARED_INTENT_REARM_SUPERSEDED_BY_API_GENERATION_CHANGE',
            'INTENT_RECONCILING_AFTER_API_GENERATION_CHANGE',
            'ACTIVATION_UNKNOWN_AFTER_API_GENERATION_CHANGE',
            'RESERVATION_UNKNOWN_AFTER_API_GENERATION_CHANGE',
            'GATE_MANIFEST_API_GENERATION_INVALIDATED',
            'RUNTIME_API_GENERATION_SUPERSEDED',
        ]);
        expect(journal.every((event) => /^sha256:[0-9a-f]{64}$/.test(event.payload_hash))).toBe(
            true,
        );
        expect(JSON.stringify(journal)).not.toContain('api-generation-2');
        expect(
            JSON.stringify(
                database
                    .prepare(`
                        SELECT key, value FROM repository_meta
                         WHERE key LIKE '%generation%'
                         ORDER BY key
                    `)
                    .all(),
            ),
        ).not.toContain('api-generation-2');
        database.close();
    });

    it('durably invalidates a continuity gap exactly once and cannot re-arm or become ready in the same epoch', async () => {
        const { client, databasePath } = await openRepository();
        const runtime = runtimeEpochInput();
        const started = await client.request('startRuntimeEpoch', runtime);
        await client.request('insertStrategy', strategyInput());
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-observing-continuity',
                state: 'observing',
                nowEpochMs: 1_786_377_600_001,
            }),
        );
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-paused-continuity',
                state: 'paused',
                nowEpochMs: 1_786_377_600_002,
            }),
        );
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-trailing-monitoring-continuity',
                strategyKind: 'trailing_exit',
                state: 'monitoring',
                definition: {
                    schemaVersion: 'strategy/1',
                    kind: 'trailing_exit',
                },
                nowEpochMs: 1_786_377_600_003,
            }),
        );
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-trailing-observing-continuity',
                strategyKind: 'trailing_exit',
                state: 'observing',
                definition: {
                    schemaVersion: 'strategy/1',
                    kind: 'trailing_exit',
                },
                nowEpochMs: 1_786_377_600_004,
            }),
        );
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-trailing-paused-continuity',
                strategyKind: 'trailing_exit',
                state: 'paused',
                definition: {
                    schemaVersion: 'strategy/1',
                    kind: 'trailing_exit',
                },
                nowEpochMs: 1_786_377_600_005,
            }),
        );
        await client.request('prepareIntent', preparedIntentInput());
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                strategyId: 'strategy-observing-continuity',
                activation: {
                    activationId: 'activation-continuity-2',
                    logicalKey: 'edge-continuity-2',
                },
                intent: {
                    intentId: 'intent-continuity-2',
                    clientRequestId: 'request-continuity-2',
                },
                reservation: {
                    reservationId: 'reservation-continuity-2',
                },
                nowEpochMs: 1_786_377_600_101,
            }),
        );
        const manifest = observeOnlyGateManifest();
        await client.request('storeGateManifest', {
            manifest,
            nowEpochMs: manifest.createdAtEpochMs,
        });
        await client.request('rearmPreparedIntent', rearmInput());
        await client.request(
            'rearmPreparedIntent',
            rearmInput({
                rearmAuthorizationId: 'rearm-continuity-2',
                rearmRequestId: 'rearm-continuity-request-2',
                intentId: 'intent-continuity-2',
                nowEpochMs: 1_786_377_600_176,
            }),
        );
        const ready = await client.request('markRuntimeEpochReady', {
            runtimeEpochId: runtime.runtimeEpochId,
            apiGeneration: runtime.apiGeneration,
            senderFence: runtime.senderFence,
            expectedRevision: started.revision,
            reconciliationEvidenceHash: DIGEST_B,
        });
        await client.request('markIntentDispatching', dispatchInput());

        await expect(
            client.request(
                'invalidateRuntimeContinuityGap',
                continuityGapInput({
                    observedSseCursor: 'raw-cursor-secret-should-not-persist',
                }),
            ),
        ).rejects.toThrow('only canonical digests and reason codes');
        await expect(
            client.request(
                'invalidateRuntimeContinuityGap',
                continuityGapInput({ reasonCodes: ['API_GENERATION_GAP'] }),
            ),
        ).rejects.toThrow('sorted unique allowlisted codes');

        const invalidated = await client.request(
            'invalidateRuntimeContinuityGap',
            continuityGapInput(),
        );
        expect(invalidated).toEqual({
            state: 'reconciling',
            previousState: 'ready',
            revision: ready.revision + 1,
            reason: 'continuity_gap_invalidated',
            continuitySignalSha256: DIGEST_A,
            reasonCodes: ['EVENT_LOOP_PAUSE_GAP', 'SSE_CURSOR_GAP'],
            recoveryStrategyCount: 3,
            manualInterventionStrategyCount: 1,
            supersededRearmCount: 1,
            recoveredIntentCount: 1,
            invalidatedGateManifestCount: 1,
            automaticRedispatchAllowed: false,
            userRearmRequiredAfterReconciliation: true,
            requiresProcessRestart: false,
        });
        await expect(
            client.request(
                'invalidateRuntimeContinuityGap',
                continuityGapInput({ nowEpochMs: 1_786_377_600_999 }),
            ),
        ).resolves.toEqual(invalidated);
        await expect(
            client.request(
                'invalidateRuntimeContinuityGap',
                continuityGapInput({
                    signalSha256: DIGEST_B,
                    nowEpochMs: 1_786_377_601_000,
                }),
            ),
        ).rejects.toThrow('different signal');
        await expect(
            client.request('markRuntimeEpochReady', {
                runtimeEpochId: runtime.runtimeEpochId,
                apiGeneration: runtime.apiGeneration,
                senderFence: runtime.senderFence,
                expectedRevision: invalidated.revision,
                reconciliationEvidenceHash: DIGEST_B,
            }),
        ).rejects.toThrow('runtime continuity was invalidated');
        await expect(
            client.request(
                'rearmPreparedIntent',
                rearmInput({
                    rearmAuthorizationId: 'rearm-continuity-3',
                    rearmRequestId: 'rearm-continuity-request-3',
                    intentId: 'intent-continuity-2',
                    expectedIntentRevision: 1,
                    nowEpochMs: 1_786_377_600_325,
                }),
            ),
        ).rejects.toThrow('runtime continuity was invalidated');
        await expect(
            client.request('verifyDispatchGrant', {
                ...dispatchInput(),
                revision: 3,
                activationRevision: 2,
                reservationRevision: 2,
            }),
        ).resolves.toEqual({ authorized: false });
        await expect(
            client.request('gateManifestStatus', {
                provenance: 'automation',
                nowEpochMs: 1_786_377_600_301,
            }),
        ).resolves.toMatchObject({
            state: 'observe_only',
            blocker: 'runtime_continuity_gap',
        });

        const inspection = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            inspection
                .prepare(`
                    SELECT strategy_id, state, revision
                      FROM strategies
                     ORDER BY strategy_id
                `)
                .all(),
        ).toEqual([
            { strategy_id: 'strategy-1', state: 'recovery', revision: 1 },
            {
                strategy_id: 'strategy-observing-continuity',
                state: 'recovery',
                revision: 1,
            },
            {
                strategy_id: 'strategy-paused-continuity',
                state: 'paused',
                revision: 0,
            },
            {
                strategy_id: 'strategy-trailing-monitoring-continuity',
                state: 'manual_intervention',
                revision: 1,
            },
            {
                strategy_id: 'strategy-trailing-observing-continuity',
                state: 'recovery',
                revision: 1,
            },
            {
                strategy_id: 'strategy-trailing-paused-continuity',
                state: 'paused',
                revision: 0,
            },
        ]);
        expect(
            inspection
                .prepare(`
                    SELECT entity_id, entity_revision, reason_code, payload_hash
                      FROM event_journal
                     WHERE reason_code='TRAILING_GAP_EXTREME_UNKNOWN'
                       AND entity_kind='strategy'
                `)
                .all(),
        ).toEqual([
            {
                entity_id: 'strategy-trailing-monitoring-continuity',
                entity_revision: 1,
                reason_code: 'TRAILING_GAP_EXTREME_UNKNOWN',
                payload_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            },
        ]);
        expect(
            inspection
                .prepare(`
                    SELECT cases.strategy_id, cases.reason_code,
                           cases.scope_hash, cases.evidence_snapshot_hash,
                           cases.state AS case_state,
                           blockers.reason_code AS blocker_reason_code,
                           blockers.scope_hash AS blocker_scope_hash,
                           cases.scope_hash=blockers.scope_hash AS scopes_match,
                           blockers.state AS blocker_state
                      FROM resolution_cases AS cases
                      JOIN safety_blockers AS blockers
                        ON blockers.resolution_case_id=cases.resolution_case_id
                     WHERE cases.strategy_id='strategy-trailing-monitoring-continuity'
                `)
                .get(),
        ).toEqual({
            strategy_id: 'strategy-trailing-monitoring-continuity',
            reason_code: 'TRAILING_GAP_EXTREME_UNKNOWN',
            scope_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            evidence_snapshot_hash: expect.stringMatching(
                /^sha256:[0-9a-f]{64}$/,
            ),
            case_state: 'open',
            blocker_reason_code: 'TRAILING_GAP_EXTREME_UNKNOWN',
            blocker_scope_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            scopes_match: 1,
            blocker_state: 'open',
        });
        expect(
            inspection
                .prepare(`
                    SELECT intents.state, intents.terminal_outcome,
                           intents.revision,
                           activations.state AS activation_state,
                           activations.revision AS activation_revision,
                           reservations.state AS reservation_state,
                           reservations.revision AS reservation_revision
                      FROM order_intents AS intents
                      JOIN activations
                        ON activations.activation_id=intents.activation_id
                      JOIN entry_exposure_reservations AS reservations
                        ON reservations.intent_id=intents.intent_id
                     WHERE intents.intent_id='intent-1'
                `)
                .get(),
        ).toEqual({
            state: 'reconciling',
            terminal_outcome: 'runtime_continuity_gap_after_dispatch_fence',
            revision: 3,
            activation_state: 'unknown',
            activation_revision: 2,
            reservation_state: 'unknown',
            reservation_revision: 1,
        });
        expect(
            inspection
                .prepare(`
                    SELECT state, reconciliation_evidence_hash, revision
                      FROM runtime_epochs
                     WHERE runtime_epoch_id='runtime-epoch-1'
                `)
                .get(),
        ).toEqual({
            state: 'reconciling',
            reconciliation_evidence_hash: null,
            revision: 2,
        });
        expect(
            inspection
                .prepare(`
                    SELECT state, revision
                      FROM intent_rearm_authorizations
                     WHERE rearm_authorization_id='rearm-continuity-2'
                `)
                .get(),
        ).toEqual({ state: 'superseded', revision: 1 });
        const continuityMeta = inspection
            .prepare(`
                SELECT value FROM repository_meta
                 WHERE key='current_runtime_continuity_invalidation'
            `)
            .get()?.value;
        expect(JSON.parse(continuityMeta)).toMatchObject({
            schemaVersion:
                'smart-order-runtime-continuity-invalidation/2026-08-13.2',
            signalSha256: DIGEST_A,
            reasonCodes: ['EVENT_LOOP_PAUSE_GAP', 'SSE_CURSOR_GAP'],
        });
        expect(continuityMeta).not.toContain(
            'raw-cursor-secret-should-not-persist',
        );
        expect(
            inspection
                .prepare(`
                    SELECT COUNT(*) AS count FROM event_journal
                     WHERE reason_code='RUNTIME_RECONCILIATION_REQUIRED'
                `)
                .get(),
        ).toEqual({ count: 1 });
        inspection.close();

        const restarted = await client.request('startRuntimeEpoch', {
            runtimeEpochId: 'runtime-epoch-continuity-2',
            apiGeneration: 'api-generation-continuity-2',
            senderFence: 'sender-fence-continuity-2',
            leaseEvidenceHash: DIGEST_B,
            nowEpochMs: 1_786_377_601_100,
        });
        expect(restarted).toMatchObject({
            state: 'reconciling',
            automaticRedispatchAllowed: false,
        });
        await expect(
            client.request(
                'rearmPreparedIntent',
                rearmInput({
                    runtimeEpochId: 'runtime-epoch-continuity-2',
                    senderFence: 'sender-fence-continuity-2',
                    apiGeneration: 'api-generation-continuity-2',
                    rearmAuthorizationId: 'rearm-continuity-new-epoch',
                    rearmRequestId: 'rearm-continuity-new-epoch-request',
                    intentId: 'intent-continuity-2',
                    expectedIntentRevision: 1,
                    nowEpochMs: 1_786_377_601_125,
                }),
            ),
        ).resolves.toMatchObject({
            runtimeEpochId: 'runtime-epoch-continuity-2',
            state: 'active',
        });
        const afterRestart = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            afterRestart
                .prepare(`
                    SELECT value FROM repository_meta
                     WHERE key='current_runtime_continuity_invalidation'
                `)
                .get(),
        ).toBeUndefined();
        afterRestart.close();
    });

    it('rolls back every continuity transition when a dependent CAS is inconsistent', async () => {
        const { client, databasePath } = await openRepository();
        const runtime = await client.request(
            'startRuntimeEpoch',
            runtimeEpochInput(),
        );
        await insertPreparedIntent(client);
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-trailing-continuity-rollback',
                strategyKind: 'trailing_exit',
                state: 'monitoring',
                definition: {
                    schemaVersion: 'strategy/1',
                    kind: 'trailing_exit',
                },
                nowEpochMs: 1_786_377_600_001,
            }),
        );
        const manifest = observeOnlyGateManifest();
        await client.request('storeGateManifest', {
            manifest,
            nowEpochMs: manifest.createdAtEpochMs,
        });
        await client.request('rearmPreparedIntent', rearmInput());
        await client.request('markRuntimeEpochReady', {
            runtimeEpochId: 'runtime-epoch-1',
            apiGeneration: 'api-generation-1',
            senderFence: 'sender-fence-1',
            expectedRevision: runtime.revision,
            reconciliationEvidenceHash: DIGEST_B,
        });
        await client.request('markIntentDispatching', dispatchInput());

        const tamper = new DatabaseSync(databasePath);
        tamper
            .prepare(`
                UPDATE activations SET state='unknown'
                 WHERE activation_id='activation-1'
            `)
            .run();
        tamper.close();

        await expect(
            client.request(
                'invalidateRuntimeContinuityGap',
                continuityGapInput({ reasonCodes: ['EVENT_LOOP_PAUSE_GAP'] }),
            ),
        ).rejects.toThrow(
            'runtime continuity activation recovery transition lost its CAS',
        );

        const inspection = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            inspection
                .prepare(`
                    SELECT state, revision FROM strategies
                     WHERE strategy_id='strategy-1'
                `)
                .get(),
        ).toEqual({ state: 'monitoring', revision: 0 });
        expect(
            inspection
                .prepare(`
                    SELECT state, revision FROM strategies
                     WHERE strategy_id='strategy-trailing-continuity-rollback'
                `)
                .get(),
        ).toEqual({ state: 'monitoring', revision: 0 });
        expect(
            inspection
                .prepare(`
                    SELECT COUNT(*) AS count FROM event_journal
                     WHERE reason_code='TRAILING_GAP_EXTREME_UNKNOWN'
                `)
                .get(),
        ).toEqual({ count: 0 });
        expect(
            inspection
                .prepare(`
                    SELECT
                        (SELECT COUNT(*) FROM resolution_cases
                          WHERE strategy_id='strategy-trailing-continuity-rollback')
                            AS resolution_count,
                        (SELECT COUNT(*) FROM safety_blockers AS blockers
                          JOIN resolution_cases AS cases
                            ON cases.resolution_case_id=blockers.resolution_case_id
                         WHERE cases.strategy_id='strategy-trailing-continuity-rollback')
                            AS blocker_count
                `)
                .get(),
        ).toEqual({ resolution_count: 0, blocker_count: 0 });
        expect(
            inspection
                .prepare(`
                    SELECT state, terminal_outcome, revision
                      FROM order_intents WHERE intent_id='intent-1'
                `)
                .get(),
        ).toEqual({
            state: 'dispatching',
            terminal_outcome: null,
            revision: 2,
        });
        expect(
            inspection
                .prepare(`
                    SELECT state, reconciliation_evidence_hash, revision
                      FROM runtime_epochs
                     WHERE runtime_epoch_id='runtime-epoch-1'
                `)
                .get(),
        ).toEqual({
            state: 'ready',
            reconciliation_evidence_hash: DIGEST_B,
            revision: 1,
        });
        expect(
            inspection
                .prepare(`
                    SELECT state, revision FROM gate_manifests
                     WHERE manifest_id='manifest-1'
                `)
                .get(),
        ).toEqual({ state: 'observe_only', revision: 0 });
        expect(
            inspection
                .prepare(`
                    SELECT value FROM repository_meta
                     WHERE key='current_runtime_continuity_invalidation'
                `)
                .get(),
        ).toBeUndefined();
        inspection.close();
    });

    it('allows only the current runtime epoch to become the ready sender', async () => {
        const { client } = await openRepository();
        await startReadyRuntime(client);
        await expect(client.request('status')).resolves.toMatchObject({
            tradingSenderAuthority: 'runtime:runtime-epoch-1',
            legacyTradingTriggerAuthority: 'permanently_retired',
        });
        await client.request(
            'startRuntimeEpoch',
            runtimeEpochInput({
                runtimeEpochId: 'runtime-epoch-2',
                apiGeneration: 'api-generation-2',
                senderFence: 'sender-fence-2',
                nowEpochMs: 1_786_377_600_250,
            }),
        );

        await expect(
            client.request('markRuntimeEpochReady', {
                runtimeEpochId: 'runtime-epoch-1',
                apiGeneration: 'api-generation-1',
                senderFence: 'sender-fence-1',
                expectedRevision: 2,
                reconciliationEvidenceHash: DIGEST_B,
            }),
        ).rejects.toThrow('does not target the current epoch');
        await expect(
            client.request('markRuntimeEpochReady', {
                runtimeEpochId: 'runtime-epoch-2',
                apiGeneration: 'api-generation-2',
                senderFence: 'sender-fence-2',
                expectedRevision: 0,
                reconciliationEvidenceHash: DIGEST_B,
            }),
        ).resolves.toMatchObject({
            runtimeEpochId: 'runtime-epoch-2',
            state: 'ready',
            revision: 1,
        });
        await expect(client.request('status')).resolves.toMatchObject({
            tradingSenderAuthority: 'runtime:runtime-epoch-2',
        });
    });

    it('forces active strategies into recovery when a new epoch starts without a prior generation watcher', async () => {
        const { client, databasePath } = await openRepository();
        await startReadyRuntime(client);
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'restart-monitoring',
                state: 'monitoring',
                nowEpochMs: 1_786_377_600_200,
            }),
        );
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'restart-observing',
                state: 'observing',
                nowEpochMs: 1_786_377_600_201,
            }),
        );
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'restart-paused',
                state: 'paused',
                nowEpochMs: 1_786_377_600_202,
            }),
        );
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'restart-completed',
                state: 'completed',
                nowEpochMs: 1_786_377_600_203,
                terminalAtEpochMs: 1_786_377_600_203,
            }),
        );
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'restart-trailing-monitoring',
                strategyKind: 'trailing_exit',
                state: 'monitoring',
                definition: {
                    schemaVersion: 'strategy/1',
                    kind: 'trailing_exit',
                },
                nowEpochMs: 1_786_377_600_204,
            }),
        );

        // Deliberately skip invalidateRuntimeApiGeneration. This models an old
        // sidecar that crashed before its marker watcher could fence itself.
        const restarted = await client.request('startRuntimeEpoch', {
            runtimeEpochId: 'runtime-epoch-restart-fallback',
            apiGeneration: 'api-generation-restart-fallback',
            senderFence: 'sender-fence-restart-fallback',
            leaseEvidenceHash: DIGEST_B,
            nowEpochMs: 1_786_377_600_300,
        });
        expect(restarted).toMatchObject({
            state: 'reconciling',
            priorEpochIds: ['runtime-epoch-1'],
            recoveryStrategyIds: [
                'restart-monitoring',
                'restart-observing',
            ],
            manualInterventionStrategyIds: [
                'restart-trailing-monitoring',
            ],
            automaticRedispatchAllowed: false,
        });

        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database
                .prepare(`
                    SELECT strategy_id, state, revision
                      FROM strategies
                     WHERE strategy_id LIKE 'restart-%'
                     ORDER BY strategy_id
                `)
                .all(),
        ).toEqual([
            {
                strategy_id: 'restart-completed',
                state: 'completed',
                revision: 0,
            },
            {
                strategy_id: 'restart-monitoring',
                state: 'recovery',
                revision: 1,
            },
            {
                strategy_id: 'restart-observing',
                state: 'recovery',
                revision: 1,
            },
            {
                strategy_id: 'restart-paused',
                state: 'paused',
                revision: 0,
            },
            {
                strategy_id: 'restart-trailing-monitoring',
                state: 'manual_intervention',
                revision: 1,
            },
        ]);
        expect(
            database
                .prepare(`
                    SELECT runtime_epoch_id, state
                      FROM runtime_epochs
                     ORDER BY started_at_epoch_ms
                `)
                .all(),
        ).toEqual([
            { runtime_epoch_id: 'runtime-epoch-1', state: 'reconciling' },
            {
                runtime_epoch_id: 'runtime-epoch-restart-fallback',
                state: 'reconciling',
            },
        ]);
        const recoveryJournal = database
            .prepare(`
                SELECT reason_code, summary_code, payload_hash
                  FROM event_journal
                 WHERE reason_code='RUNTIME_EPOCH_STARTED_RECOVERY_REQUIRED'
                 ORDER BY entity_id
            `)
            .all();
        expect(recoveryJournal).toEqual([
            {
                reason_code: 'RUNTIME_EPOCH_STARTED_RECOVERY_REQUIRED',
                summary_code: 'strategy_recovery_after_runtime_epoch_start',
                payload_hash: DIGEST_A,
            },
            {
                reason_code: 'RUNTIME_EPOCH_STARTED_RECOVERY_REQUIRED',
                summary_code: 'strategy_recovery_after_runtime_epoch_start',
                payload_hash: DIGEST_A,
            },
        ]);
        expect(JSON.stringify(recoveryJournal)).not.toMatch(
            /broker-A|account-A|identity-A|api-generation-restart-fallback/,
        );
        expect(
            database
                .prepare(`
                    SELECT reason_code, entity_revision, payload_hash
                      FROM event_journal
                     WHERE entity_id='restart-trailing-monitoring'
                       AND reason_code='TRAILING_GAP_EXTREME_UNKNOWN'
                `)
                .get(),
        ).toEqual({
            reason_code: 'TRAILING_GAP_EXTREME_UNKNOWN',
            entity_revision: 1,
            payload_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        });
        expect(
            database
                .prepare(`
                    SELECT cases.reason_code, cases.state AS case_state,
                           blockers.reason_code AS blocker_reason_code,
                           blockers.state AS blocker_state,
                           cases.scope_hash=blockers.scope_hash AS scopes_match
                      FROM resolution_cases AS cases
                      JOIN safety_blockers AS blockers
                        ON blockers.resolution_case_id=cases.resolution_case_id
                     WHERE cases.strategy_id='restart-trailing-monitoring'
                `)
                .get(),
        ).toEqual({
            reason_code: 'TRAILING_GAP_EXTREME_UNKNOWN',
            case_state: 'open',
            blocker_reason_code: 'TRAILING_GAP_EXTREME_UNKNOWN',
            blocker_state: 'open',
            scopes_match: 1,
        });
        database.close();
    });

    it('pauses reconciled recovery strategies before explicit current resume and arm', async () => {
        const { client, databasePath } = await openRepository();
        await startReadyRuntime(client);
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'restart-resumable',
                state: 'monitoring',
                definition: {
                    schemaVersion: 'strategy/1',
                    kind: 'quick',
                    activationPolicy: 'require_rearm',
                },
                nowEpochMs: 1_786_377_600_210,
            }),
        );
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                strategyId: 'restart-resumable',
                activation: {
                    activationId: 'restart-resumable-activation',
                    logicalKey: 'restart-resumable-edge',
                },
                intent: {
                    intentId: 'restart-resumable-terminal-intent',
                    clientRequestId: 'restart-resumable-terminal-request',
                },
                reservation: {
                    reservationId: 'restart-resumable-reservation',
                },
            }),
        );
        const terminalIntentDatabase = new DatabaseSync(databasePath);
        terminalIntentDatabase
            .prepare(`
                UPDATE order_intents
                   SET state='terminal', terminal_outcome='cancelled',
                       terminal_at_epoch_ms=?, revision=revision+1
                 WHERE intent_id='restart-resumable-terminal-intent'
            `)
            .run(1_786_377_600_220);
        terminalIntentDatabase.close();
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'restart-live-intent',
                state: 'monitoring',
                definition: {
                    schemaVersion: 'strategy/1',
                    kind: 'quick',
                    activationPolicy: 'require_rearm',
                },
                nowEpochMs: 1_786_377_600_230,
            }),
        );
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                strategyId: 'restart-live-intent',
                activation: {
                    activationId: 'restart-live-activation',
                    logicalKey: 'restart-live-edge',
                },
                intent: {
                    intentId: 'restart-live-intent-id',
                    clientRequestId: 'restart-live-request',
                },
                reservation: {
                    reservationId: 'restart-live-reservation',
                },
            }),
        );
        const restarted = await client.request('startRuntimeEpoch', {
            runtimeEpochId: 'runtime-epoch-resume-after-recovery',
            apiGeneration: 'api-generation-resume-after-recovery',
            senderFence: 'sender-fence-resume-after-recovery',
            leaseEvidenceHash: DIGEST_B,
            nowEpochMs: 1_786_377_600_300,
        });
        await client.request(
            'rearmPreparedIntent',
            rearmInput({
                rearmAuthorizationId: 'restart-live-rearm',
                rearmRequestId: 'restart-live-rearm-request',
                intentId: 'restart-live-intent-id',
                runtimeEpochId: restarted.runtimeEpochId,
                senderFence: 'sender-fence-resume-after-recovery',
                apiGeneration: 'api-generation-resume-after-recovery',
                expectedIntentRevision: 0,
                nowEpochMs: 1_786_377_600_305,
            }),
        );
        await expect(
            client.request('markRuntimeEpochReady', {
                runtimeEpochId: restarted.runtimeEpochId,
                apiGeneration: 'api-generation-resume-after-recovery',
                senderFence: 'sender-fence-resume-after-recovery',
                expectedRevision: restarted.revision,
                reconciliationEvidenceHash: DIGEST_B,
                nowEpochMs: 1_786_377_600_310,
            }),
        ).resolves.toMatchObject({
            state: 'ready',
            pausedRecoveryStrategyIds: ['restart-resumable'],
        });
        await expect(
            client.request('getStrategy', {
                strategyId: 'restart-live-intent',
            }),
        ).resolves.toMatchObject({
            strategyId: 'restart-live-intent',
            state: 'recovery',
            revision: 1,
        });
        seedEligibleManualGate(databasePath);
        await expect(
            client.request('resumeStrategy', {
                activationPolicyAcknowledged: true,
                apiGeneration: 'api-generation-resume-after-recovery',
                authorityId: 'resume-after-recovery-authority',
                contractEvidence: null,
                expectedRevision: 2,
                nowEpochMs: 1_786_377_600_320,
                runtimeEpochId: restarted.runtimeEpochId,
                senderFence: 'sender-fence-resume-after-recovery',
                strategyId: 'restart-resumable',
                userArmEvidenceHash: DIGEST_A,
            }),
        ).resolves.toMatchObject({
            state: 'monitoring',
            revision: 3,
        });

        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database
                .prepare(`
                    SELECT reason_code, summary_code, entity_revision
                      FROM event_journal
                     WHERE entity_id='restart-resumable'
                       AND reason_code='RECOVERY_RECONCILED_REARM_REQUIRED'
                `)
                .get(),
        ).toEqual({
            reason_code: 'RECOVERY_RECONCILED_REARM_REQUIRED',
            summary_code: 'strategy_recovery_reconciled_paused',
            entity_revision: 2,
        });
        database.close();
    });

    it('rolls back runtime readiness when recovery-to-paused persistence fails', async () => {
        const { client, databasePath } = await openRepository();
        await startReadyRuntime(client);
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'restart-recovery-fault',
                state: 'monitoring',
                nowEpochMs: 1_786_377_600_210,
            }),
        );
        const restarted = await client.request('startRuntimeEpoch', {
            runtimeEpochId: 'runtime-epoch-recovery-fault',
            apiGeneration: 'api-generation-recovery-fault',
            senderFence: 'sender-fence-recovery-fault',
            leaseEvidenceHash: DIGEST_B,
            nowEpochMs: 1_786_377_600_300,
        });
        const faultDatabase = new DatabaseSync(databasePath);
        faultDatabase.exec(`
            CREATE TRIGGER fail_recovery_pause_for_test
            BEFORE UPDATE OF state ON strategies
            WHEN OLD.strategy_id='restart-recovery-fault'
             AND OLD.state='recovery' AND NEW.state='paused'
            BEGIN
                SELECT RAISE(ABORT, 'injected recovery pause failure');
            END;
        `);
        faultDatabase.close();

        await expect(
            client.request('markRuntimeEpochReady', {
                runtimeEpochId: restarted.runtimeEpochId,
                apiGeneration: 'api-generation-recovery-fault',
                senderFence: 'sender-fence-recovery-fault',
                expectedRevision: restarted.revision,
                reconciliationEvidenceHash: DIGEST_B,
                nowEpochMs: 1_786_377_600_310,
            }),
        ).rejects.toThrow('injected recovery pause failure');

        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database
                .prepare(`
                    SELECT state, revision FROM strategies
                     WHERE strategy_id='restart-recovery-fault'
                `)
                .get(),
        ).toEqual({ state: 'recovery', revision: 1 });
        expect(
            database
                .prepare(`
                    SELECT state, revision, reconciliation_evidence_hash
                      FROM runtime_epochs
                     WHERE runtime_epoch_id='runtime-epoch-recovery-fault'
                `)
                .get(),
        ).toEqual({
            state: 'reconciling',
            revision: restarted.revision,
            reconciliation_evidence_hash: null,
        });
        database.close();
    });

    it('stops only the current fenced epoch after all side effects are terminal', async () => {
        const { client } = await openRepository();
        const { runtime, ready } = await startReadyRuntime(client);
        await expect(
            client.request('stopRuntimeEpoch', {
                runtimeEpochId: runtime.runtimeEpochId,
                apiGeneration: runtime.apiGeneration,
                senderFence: 'different-sender-fence',
                expectedRevision: ready.revision,
                nowEpochMs: 1_786_377_600_250,
            }),
        ).rejects.toThrow('does not target the current epoch');
        await expect(
            client.request('quiesceRuntimeEpoch', {
                runtimeEpochId: runtime.runtimeEpochId,
                apiGeneration: runtime.apiGeneration,
                senderFence: runtime.senderFence,
                expectedRevision: ready.revision,
                operation: 'graceful_stop',
                nowEpochMs: 1_786_377_600_240,
            }),
        ).resolves.toMatchObject({
            state: 'quiescing',
            revision: 2,
            replayed: false,
            drainAllowed: true,
            selectedBlockerCount: 0,
            lifecycle: { gracefulStopAllowed: true },
        });
        await expect(
            client.request('quiesceRuntimeEpoch', {
                runtimeEpochId: runtime.runtimeEpochId,
                apiGeneration: runtime.apiGeneration,
                senderFence: runtime.senderFence,
                expectedRevision: 2,
                operation: 'graceful_stop',
                nowEpochMs: 1_786_377_600_245,
            }),
        ).resolves.toMatchObject({
            state: 'quiescing',
            revision: 2,
            replayed: true,
            drainAllowed: true,
            selectedBlockerCount: 0,
        });
        await expect(
            client.request('quiesceRuntimeEpoch', {
                runtimeEpochId: runtime.runtimeEpochId,
                apiGeneration: runtime.apiGeneration,
                senderFence: runtime.senderFence,
                expectedRevision: 2,
                operation: 'uninstall',
                nowEpochMs: 1_786_377_600_246,
            }),
        ).rejects.toThrow('conflicts with the durable request');
        await expect(
            client.request('stopRuntimeEpoch', {
                runtimeEpochId: runtime.runtimeEpochId,
                apiGeneration: runtime.apiGeneration,
                senderFence: runtime.senderFence,
                expectedRevision: 2,
                operation: 'graceful_stop',
                nowEpochMs: 1_786_377_600_250,
            }),
        ).resolves.toMatchObject({
            runtimeEpochId: 'runtime-epoch-1',
            state: 'stopped',
            revision: 3,
            activeBlockers: [],
        });
        await expect(
            client.request('markIntentDispatching', dispatchInput()),
        ).rejects.toThrow(
            'repository mutation is fenced by lifecycle operation graceful_stop',
        );
        await expect(client.request('status')).resolves.toMatchObject({
            tradingSenderAuthority: 'none',
            legacyTradingTriggerAuthority: 'permanently_retired',
        });
    });

    it('quiesces the current fenced epoch after a conservative repository revision advance', async () => {
        const { client } = await openRepository();
        const { runtime, ready } = await startReadyRuntime(client);
        const invalidated = await client.request(
            'invalidateRuntimeContinuityGap',
            continuityGapInput(),
        );
        expect(invalidated).toMatchObject({
            state: 'reconciling',
            revision: ready.revision + 1,
        });
        await expect(
            client.request('quiesceRuntimeEpoch', {
                runtimeEpochId: runtime.runtimeEpochId,
                apiGeneration: runtime.apiGeneration,
                senderFence: runtime.senderFence,
                expectedRevision: ready.revision,
                operation: 'graceful_stop',
                nowEpochMs: 1_786_377_600_340,
            }),
        ).resolves.toMatchObject({
            state: 'quiescing',
            revision: invalidated.revision + 1,
            replayed: false,
            drainAllowed: true,
            selectedBlockerCount: 0,
        });
        await expect(
            client.request('quiesceRuntimeEpoch', {
                runtimeEpochId: runtime.runtimeEpochId,
                apiGeneration: runtime.apiGeneration,
                senderFence: 'stale-sender-fence',
                expectedRevision: ready.revision,
                operation: 'graceful_stop',
                nowEpochMs: 1_786_377_600_345,
            }),
        ).rejects.toThrow('does not target the current epoch');
    });

    it('fails closed when the single trading-sender authority metadata is corrupt', async () => {
        const { client, databasePath } = await openRepository();
        await startReadyRuntime(client);
        await client.close();
        openClients.delete(client);

        const tampered = new DatabaseSync(databasePath);
        tampered
            .prepare(
                "UPDATE repository_meta SET value='runtime:forged-epoch' WHERE key='trading_sender_authority'",
            )
            .run();
        tampered.close();

        const reopened = await openRepository({ databasePath });
        await expect(
            reopened.client.request(
                'startRuntimeEpoch',
                runtimeEpochInput({
                    runtimeEpochId: 'runtime-epoch-after-corruption',
                    apiGeneration: 'api-generation-after-corruption',
                    senderFence: 'sender-fence-after-corruption',
                }),
            ),
        ).rejects.toThrow('authority metadata is inconsistent');
        await expect(reopened.client.request('status')).resolves.toMatchObject({
            tradingSenderAuthority: 'runtime:forged-epoch',
        });
        await reopened.client.close();
        openClients.delete(reopened.client);

        const verified = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verified
                .prepare(
                    "SELECT COUNT(*) AS count FROM runtime_epochs WHERE runtime_epoch_id='runtime-epoch-after-corruption'",
                )
                .get()?.count,
        ).toBe(0);
        verified.close();
    });

    it('refuses graceful stop while a prepared side-effect intent remains', async () => {
        const { client } = await openRepository();
        await insertPreparedIntent(client);
        const { runtime, ready } = await startReadyRuntime(
            client,
            {},
            { rearmPreparedIntent: true },
        );
        const quiesced = await client.request('quiesceRuntimeEpoch', {
            runtimeEpochId: runtime.runtimeEpochId,
            apiGeneration: runtime.apiGeneration,
            senderFence: runtime.senderFence,
            expectedRevision: ready.revision,
            operation: 'graceful_stop',
            nowEpochMs: 1_786_377_600_240,
        });
        expect(quiesced).toMatchObject({
            state: 'observe_only',
            revision: 3,
            supersededRearmCount: 1,
            drainAllowed: false,
            lifecycle: {
                gracefulStopAllowed: false,
                blockerCount: expect.any(Number),
            },
        });
        await expect(
            client.request('markIntentDispatching', dispatchInput()),
        ).rejects.toThrow(
            'repository mutation is fenced by lifecycle operation graceful_stop',
        );
        await expect(client.request('status')).resolves.toMatchObject({
            tradingSenderAuthority: 'runtime:runtime-epoch-1',
        });
        await expect(
            client.request('stopRuntimeEpoch', {
                runtimeEpochId: runtime.runtimeEpochId,
                apiGeneration: runtime.apiGeneration,
                senderFence: runtime.senderFence,
                expectedRevision: quiesced.revision,
                operation: 'graceful_stop',
                nowEpochMs: 1_786_377_600_250,
            }),
        ).rejects.toThrow('does not match durable quiesce');
    });

    it('refuses uninstall for a reconciling intent and pending-submit BrokerOrder', async () => {
        const { client, databasePath } = await openRepository();
        await insertPreparedIntent(client);
        await startReadyRuntime(client, {}, { rearmPreparedIntent: true });
        const grant = await client.request(
            'markIntentDispatching',
            dispatchInput(),
        );
        await client.request('recordBrokerOrderEvidence', {
            runtimeEpochId: 'runtime-epoch-1',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            brokerOrderId: 'uninstall-pending-submit',
            intentId: 'intent-1',
            state: 'pending_submit',
            controlRevision: 0,
            quantityShares: 1_000,
            filledShares: 0,
            remainingShares: 1_000,
            evidenceHash: DIGEST_A,
            expectedRevision: null,
            nowEpochMs: 1_786_377_600_205,
        });
        await client.request('markIntentOutcome', {
            intentId: 'intent-1',
            state: 'reconciling',
            terminalOutcome: 'broker_result_requires_reconciliation',
            expectedRevision: grant.revision,
            dispatchAttemptNonce: 'dispatch-nonce-1',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            nowEpochMs: 1_786_377_600_210,
        });

        const blocked = await client.request('quiesceRuntimeEpoch', {
            runtimeEpochId: 'runtime-epoch-1',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            expectedRevision: 1,
            operation: 'uninstall',
            nowEpochMs: 1_786_377_600_240,
        });
        expect(blocked).toMatchObject({
            operation: 'uninstall',
            state: 'reconciling',
            drainAllowed: false,
            lifecycle: {
                counts: {
                    side_effect_intents: 1,
                    non_terminal_broker_orders: 1,
                },
                uninstallAllowed: false,
            },
        });
        expect(blocked.selectedBlockerCount).toBeGreaterThanOrEqual(2);
        await expect(
            client.request('stopRuntimeEpoch', {
                runtimeEpochId: 'runtime-epoch-1',
                senderFence: 'sender-fence-1',
                apiGeneration: 'api-generation-1',
                expectedRevision: blocked.revision,
                operation: 'uninstall',
                nowEpochMs: 1_786_377_600_250,
            }),
        ).rejects.toThrow('does not match durable quiesce');

        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database
                .prepare(`
                    SELECT intents.state AS intent_state,
                           orders.state AS broker_order_state
                      FROM order_intents AS intents
                      JOIN broker_orders AS orders
                        ON orders.intent_id=intents.intent_id
                     WHERE intents.intent_id='intent-1'
                `)
                .get(),
        ).toEqual({
            intent_state: 'reconciling',
            broker_order_state: 'pending_submit',
        });
        database.close();
    });

    it('rejects reconciliation evidence from before a side effect or late broker correlation', async () => {
        const { client, databasePath } = await openRepository({
            testOnlyBrokerCorrelationIdentifierKinds: ['orderId'],
        });
        await insertPreparedIntent(client);
        await startReadyRuntime(client, {}, { rearmPreparedIntent: true });
        const grant = await client.request(
            'markIntentDispatching',
            dispatchInput(),
        );
        await client.request('markIntentOutcome', {
            intentId: 'intent-1',
            state: 'terminal',
            terminalOutcome: 'broker_terminal_fixture',
            expectedRevision: grant.revision,
            dispatchAttemptNonce: 'dispatch-nonce-1',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            nowEpochMs: 1_786_377_600_210,
        });
        await client.close();
        openClients.delete(client);

        // Isolate freshness from ordinary lifecycle blockers. These fixture
        // terminal projections stand in for already-durable broker/reconciler
        // transitions; they do not create broker authority or evidence.
        const seed = new DatabaseSync(databasePath);
        seed.exec(`
            UPDATE strategies
               SET state='completed', terminal_at_epoch_ms=1786377600220,
                   updated_at_epoch_ms=1786377600220, revision=revision+1
             WHERE strategy_id='strategy-1';
            UPDATE activations
               SET state='filled', updated_at_epoch_ms=1786377600220,
                   revision=revision+1
             WHERE activation_id='activation-1';
            UPDATE entry_exposure_reservations
               SET state='consumed', terminal_at_epoch_ms=1786377600220,
                   updated_at_epoch_ms=1786377600220, revision=revision+1
             WHERE reservation_id='reservation-1';
        `);
        seed.close();

        const reopened = await openRepository({
            databasePath,
            testOnlyBrokerCorrelationIdentifierKinds: ['orderId'],
        });
        await expect(reopened.client.request('lifecycleAudit', {})).resolves.toMatchObject({
            currentRuntimeState: 'ready',
            counts: {
                non_terminal_strategies: 0,
                non_terminal_activations: 0,
                non_terminal_intents: 0,
                non_terminal_broker_orders: 0,
                active_entry_reservations: 0,
                active_exit_claims: 0,
                durable_side_effect_history: 1,
            },
            reconciliation: 'required_before_any_write_or_drain',
            gracefulStopAllowed: false,
            uninstallAllowed: false,
            gracefulStopBlockerCount: 1,
        });

        const replacement = await reopened.client.request(
            'startRuntimeEpoch',
            runtimeEpochInput({
                runtimeEpochId: 'runtime-fresh-reconciliation',
                apiGeneration: 'api-generation-fresh-reconciliation',
                senderFence: 'sender-fence-fresh-reconciliation',
                nowEpochMs: 1_786_377_600_230,
            }),
        );
        await reopened.client.request('markRuntimeEpochReady', {
            runtimeEpochId: 'runtime-fresh-reconciliation',
            apiGeneration: 'api-generation-fresh-reconciliation',
            senderFence: 'sender-fence-fresh-reconciliation',
            expectedRevision: replacement.revision,
            reconciliationEvidenceHash: DIGEST_A,
            nowEpochMs: 1_786_377_600_240,
        });
        await expect(reopened.client.request('lifecycleAudit', {})).resolves.toMatchObject({
            currentRuntimeState: 'ready',
            reconciliation: 'current_no_side_effects',
            gracefulStopAllowed: true,
            uninstallAllowed: true,
            gracefulStopBlockerCount: 0,
        });
        await reopened.client.request('addBrokerCorrelation', {
            correlationId: 'correlation-after-reconciliation',
            intentId: 'intent-1',
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            tradeDate: '2026-08-11',
            contractKey: 'TSE:2330:STK:Common',
            side: 'Buy',
            orderId: 'late-order-id-after-reconciliation',
            evidenceHash: DIGEST_B,
            createdAtEpochMs: 1_786_377_600_250,
        });
        await expect(reopened.client.request('lifecycleAudit', {})).resolves.toMatchObject({
            currentRuntimeState: 'ready',
            counts: { durable_side_effect_history: 2 },
            reconciliation: 'required_before_any_write_or_drain',
            gracefulStopAllowed: false,
            uninstallAllowed: false,
            gracefulStopBlockerCount: 1,
        });
    });

    it('allows production-readonly to preserve a paused strategy with zero trading obligations', async () => {
        const { client } = await openRepository();
        await client.request(
            'insertStrategy',
            strategyInput({ state: 'paused', strategyId: 'paused-only-strategy' }),
        );
        const started = await client.request(
            'startRuntimeEpoch',
            runtimeEpochInput({
                runtimeEpochId: 'runtime-paused-only',
                senderFence: 'fence-paused-only',
                apiGeneration: 'generation-paused-only',
            }),
        );
        const quiesced = await client.request('quiesceRuntimeEpoch', {
            runtimeEpochId: 'runtime-paused-only',
            senderFence: 'fence-paused-only',
            apiGeneration: 'generation-paused-only',
            expectedRevision: started.revision,
            operation: 'production_readonly',
            nowEpochMs: 1_786_377_600_240,
        });
        expect(quiesced).toMatchObject({
            state: 'quiescing',
            revision: 1,
            drainAllowed: true,
            selectedBlockerCount: 0,
            lifecycle: {
                productionReadonlyDrainAllowed: true,
                gracefulStopAllowed: false,
                productionReadonlyBlockerCount: 0,
                gracefulStopBlockerCount: 1,
            },
        });
        await expect(
            client.request('stopRuntimeEpoch', {
                runtimeEpochId: 'runtime-paused-only',
                senderFence: 'fence-paused-only',
                apiGeneration: 'generation-paused-only',
                expectedRevision: quiesced.revision,
                operation: 'production_readonly',
                nowEpochMs: 1_786_377_600_250,
            }),
        ).resolves.toMatchObject({ state: 'stopped' });
    });

    it.each(['rollback', 'feature_off'])(
        'durably quiesces and stops an empty runtime for %s',
        async (operation) => {
            const { client } = await openRepository();
            const { runtime, ready } = await startReadyRuntime(client);
            const quiesced = await client.request('quiesceRuntimeEpoch', {
                runtimeEpochId: runtime.runtimeEpochId,
                senderFence: runtime.senderFence,
                apiGeneration: runtime.apiGeneration,
                expectedRevision: ready.revision,
                operation,
                nowEpochMs: 1_786_377_600_240,
            });
            expect(quiesced).toMatchObject({
                operation,
                state: 'quiescing',
                revision: 2,
                drainAllowed: true,
                selectedBlockerCount: 0,
                lifecycle: {
                    gracefulStopAllowed: true,
                    gracefulStopBlockerCount: 0,
                },
            });
            await expect(
                client.request('stopRuntimeEpoch', {
                    runtimeEpochId: runtime.runtimeEpochId,
                    senderFence: runtime.senderFence,
                    apiGeneration: runtime.apiGeneration,
                    expectedRevision: quiesced.revision,
                    operation,
                    nowEpochMs: 1_786_377_600_250,
                }),
            ).resolves.toMatchObject({
                operation,
                state: 'stopped',
                activeBlockers: [],
            });
        },
    );

    it.each(['rollback', 'feature_off'])(
        'rejects %s while a paused non-terminal strategy remains',
        async (operation) => {
            const { client } = await openRepository();
            await client.request(
                'insertStrategy',
                strategyInput({
                    state: 'paused',
                    strategyId: `${operation}-paused-strategy`,
                }),
            );
            const started = await client.request(
                'startRuntimeEpoch',
                runtimeEpochInput({
                    runtimeEpochId: `${operation}-runtime`,
                    senderFence: `${operation}-fence`,
                    apiGeneration: `${operation}-generation`,
                }),
            );
            const blocked = await client.request('quiesceRuntimeEpoch', {
                runtimeEpochId: `${operation}-runtime`,
                senderFence: `${operation}-fence`,
                apiGeneration: `${operation}-generation`,
                expectedRevision: started.revision,
                operation,
                nowEpochMs: 1_786_377_600_240,
            });
            expect(blocked).toMatchObject({
                operation,
                state: 'reconciling',
                drainAllowed: false,
                selectedBlockerCount: 1,
                lifecycle: {
                    productionReadonlyDrainAllowed: true,
                    gracefulStopAllowed: false,
                    productionReadonlyBlockerCount: 0,
                    gracefulStopBlockerCount: 1,
                },
            });
            await expect(
                client.request('stopRuntimeEpoch', {
                    runtimeEpochId: `${operation}-runtime`,
                    senderFence: `${operation}-fence`,
                    apiGeneration: `${operation}-generation`,
                    expectedRevision: blocked.revision,
                    operation,
                    nowEpochMs: 1_786_377_600_250,
                }),
            ).rejects.toThrow('does not match durable quiesce');
        },
    );

    it('binds broker correlation to the exact fixed intent scope', async () => {
        const { client, databasePath } = await openRepository({
            testOnlyBrokerCorrelationIdentifierKinds: [
                'orderId',
                'seqno',
                'ordno',
                'exchangeSequence',
            ],
        });
        await insertPreparedIntent(client);
        const correlation = {
            intentId: 'intent-1',
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            contractKey: 'TSE:2330:STK:Common',
            side: 'Buy',
            orderId: 'order-7',
            seqno: 'seq-7',
            ordno: 'ord-7',
            exchangeSequence: 'exchange-7',
            customField: 'A1B2C3',
            evidenceHash: DIGEST_A,
            createdAtEpochMs: 1_786_377_600_400,
        };
        const first = await client.request('addBrokerCorrelation', {
            ...correlation,
            correlationId: 'correlation-1',
            tradeDate: '2026-08-11',
        });
        expect(first.canonicalKeyHash).toMatch(/^sha256:[0-9a-f]{64}$/);
        await expect(
            client.request('addBrokerCorrelation', {
                ...correlation,
                correlationId: 'correlation-extra-field',
                tradeDate: '2026-08-11',
                callerTrusted: true,
            }),
        ).rejects.toThrow('input schema is invalid');
        await expect(
            client.request('addBrokerCorrelation', {
                ...correlation,
                correlationId: 'correlation-missing-broker-order',
                brokerOrderId: 'broker-order-not-present',
                orderId: 'order-not-present',
                seqno: 'seq-not-present',
                ordno: 'ord-not-present',
                exchangeSequence: 'exchange-not-present',
                tradeDate: '2026-08-11',
            }),
        ).rejects.toThrow('order must belong to the same fixed intent');
        await expect(
            client.request('addBrokerCorrelation', {
                ...correlation,
                correlationId: 'correlation-duplicate',
                tradeDate: '2026-08-11',
            }),
        ).rejects.toThrow();
        await expect(
            client.request('addBrokerCorrelation', {
                ...correlation,
                correlationId: 'correlation-overlapping-same-intent',
                tradeDate: '2026-08-11',
                seqno: 'different-same-intent-seqno',
                ordno: 'different-same-intent-ordno',
                exchangeSequence: 'different-same-intent-exchange-sequence',
            }),
        ).rejects.toThrow(
            'orderId is already bound to a different correlation',
        );
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-correlation-2',
                nowEpochMs: 1_786_377_600_010,
            }),
        );
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                strategyId: 'strategy-correlation-2',
                activation: {
                    activationId: 'activation-correlation-2',
                    logicalKey: 'edge-correlation-2',
                },
                intent: {
                    intentId: 'intent-correlation-2',
                    clientRequestId: 'request-correlation-2',
                },
                reservation: {
                    reservationId: 'reservation-correlation-2',
                },
            }),
        );
        await expect(
            client.request('addBrokerCorrelation', {
                ...correlation,
                correlationId: 'correlation-overlapping-order-id',
                intentId: 'intent-correlation-2',
                tradeDate: '2026-08-11',
                seqno: 'different-seqno',
                ordno: 'different-ordno',
                exchangeSequence: 'different-exchange-sequence',
            }),
        ).rejects.toThrow('orderId is already bound to a different intent');

        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-correlation-next-day',
                nowEpochMs: 1_786_464_000_000,
            }),
        );
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                strategyId: 'strategy-correlation-next-day',
                nowEpochMs: 1_786_464_000_100,
                activation: {
                    activationId: 'activation-correlation-next-day',
                    logicalKey: 'edge-correlation-next-day',
                },
                intent: {
                    intentId: 'intent-correlation-next-day',
                    clientRequestId: 'request-correlation-next-day',
                    tradeDate: '2026-08-12',
                },
                reservation: {
                    reservationId: 'reservation-correlation-next-day',
                },
            }),
        );
        await expect(
            client.request('addBrokerCorrelation', {
                ...correlation,
                correlationId: 'correlation-next-day',
                intentId: 'intent-correlation-next-day',
                tradeDate: '2026-08-12',
            }),
        ).resolves.toMatchObject({ correlationId: 'correlation-next-day' });
        await expect(
            client.request('addBrokerCorrelation', {
                ...correlation,
                correlationId: 'correlation-invalid',
                tradeDate: '2026-08-13',
                customField: 'NOT_OK',
            }),
        ).rejects.toThrow('customField');
        await expect(
            client.request('addBrokerCorrelation', {
                ...correlation,
                correlationId: 'correlation-bad-date',
                tradeDate: '2026-02-30',
            }),
        ).rejects.toThrow('real Gregorian date');
        for (const mismatch of [
            { accountIdRef: 'account-B' },
            { tradeDate: '2026-08-12' },
            { contractKey: 'TSE:2317:STK:Common' },
            { side: 'Sell' },
        ]) {
            await expect(
                client.request('addBrokerCorrelation', {
                    ...correlation,
                    correlationId: `correlation-scope-${Object.keys(mismatch)[0]}`,
                    tradeDate: '2026-08-11',
                    ...mismatch,
                }),
            ).rejects.toThrow('exactly match');
        }

        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database
                .prepare('SELECT trade_date FROM broker_correlations ORDER BY trade_date')
                .all()
                .map((row) => row.trade_date),
        ).toEqual(['2026-08-11', '2026-08-12']);
        expect(
            database
                .prepare(`
                    SELECT trade_date, identifier_kind, identifier_value,
                           intent_id
                      FROM broker_correlation_identifiers
                     WHERE identifier_kind='orderId'
                       AND identifier_value='order-7'
                     ORDER BY trade_date
                `)
                .all(),
        ).toEqual([
            {
                trade_date: '2026-08-11',
                identifier_kind: 'orderId',
                identifier_value: 'order-7',
                intent_id: 'intent-1',
            },
            {
                trade_date: '2026-08-12',
                identifier_kind: 'orderId',
                identifier_value: 'order-7',
                intent_id: 'intent-correlation-next-day',
            },
        ]);
        database.close();
    });

    it('keeps broker correlation identifier capability fail closed by default', async () => {
        const { client } = await openRepository();
        await insertPreparedIntent(client);
        await expect(
            client.request('addBrokerCorrelation', {
                correlationId: 'correlation-locked',
                intentId: 'intent-1',
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                tradeDate: '2026-08-11',
                contractKey: 'TSE:2330:STK:Common',
                side: 'Buy',
                orderId: 'order-locked',
                evidenceHash: DIGEST_A,
                createdAtEpochMs: 1_786_377_600_401,
            }),
        ).rejects.toThrow('capability is not verified');
    });

    it('fails startup when current broker correlation scope or identifier projection was tampered', async () => {
        const createRepositoryWithCorrelation = async (suffix) => {
            const opened = await openRepository({
                testOnlyBrokerCorrelationIdentifierKinds: ['orderId'],
            });
            await insertPreparedIntent(opened.client);
            await opened.client.request('addBrokerCorrelation', {
                correlationId: `correlation-tamper-${suffix}`,
                intentId: 'intent-1',
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                tradeDate: '2026-08-11',
                contractKey: 'TSE:2330:STK:Common',
                side: 'Buy',
                orderId: `order-tamper-${suffix}`,
                evidenceHash: DIGEST_A,
                createdAtEpochMs: 1_786_377_600_402,
            });
            await opened.client.close();
            openClients.delete(opened.client);
            return opened.databasePath;
        };

        const scopePath = await createRepositoryWithCorrelation('scope');
        const scopeTamper = new DatabaseSync(scopePath);
        scopeTamper
            .prepare(`
                UPDATE broker_correlations SET account_id_ref='account-B'
                 WHERE correlation_id='correlation-tamper-scope'
            `)
            .run();
        scopeTamper.close();
        const scopeExpectation = await prepareRepositoryExpectation(scopePath, true);
        const scopeClient = new SmartOrderRepositoryClient({
            databasePath: scopePath,
            ...scopeExpectation,
        });
        openClients.add(scopeClient);
        await expect(scopeClient.ready()).rejects.toThrow(
            'broker correlation fixed scope integrity failed',
        );
        await scopeClient.close();
        openClients.delete(scopeClient);

        const projectionPath = await createRepositoryWithCorrelation('projection');
        const projectionTamper = new DatabaseSync(projectionPath);
        projectionTamper
            .prepare(`
                DELETE FROM broker_correlation_identifiers
                 WHERE correlation_id='correlation-tamper-projection'
            `)
            .run();
        projectionTamper.close();
        const projectionExpectation = await prepareRepositoryExpectation(
            projectionPath,
            true,
        );
        const projectionClient = new SmartOrderRepositoryClient({
            databasePath: projectionPath,
            ...projectionExpectation,
        });
        openClients.add(projectionClient);
        await expect(projectionClient.ready()).rejects.toThrow(
            'broker correlation identifier projection integrity failed',
        );
        await projectionClient.close();
        openClients.delete(projectionClient);

        for (const [suffix, tamper] of [
            [
                'canonical-key',
                (database) =>
                    database
                        .prepare(`
                            UPDATE broker_correlations
                               SET canonical_key_hash=?
                             WHERE correlation_id='correlation-tamper-canonical-key'
                        `)
                        .run(DIGEST_B),
            ],
            [
                'no-identifier',
                (database) => {
                    database
                        .prepare(`
                            UPDATE broker_correlations
                               SET order_id=NULL
                             WHERE correlation_id='correlation-tamper-no-identifier'
                        `)
                        .run();
                    database
                        .prepare(`
                            DELETE FROM broker_correlation_identifiers
                             WHERE correlation_id='correlation-tamper-no-identifier'
                        `)
                        .run();
                },
            ],
            [
                'custom-field',
                (database) =>
                    database
                        .prepare(`
                            UPDATE broker_correlations
                               SET custom_field='SECRET!'
                             WHERE correlation_id='correlation-tamper-custom-field'
                        `)
                        .run(),
            ],
        ]) {
            const canonicalPath = await createRepositoryWithCorrelation(suffix);
            const canonicalTamper = new DatabaseSync(canonicalPath);
            tamper(canonicalTamper);
            canonicalTamper.close();
            const canonicalExpectation = await prepareRepositoryExpectation(
                canonicalPath,
                true,
            );
            const canonicalClient = new SmartOrderRepositoryClient({
                databasePath: canonicalPath,
                ...canonicalExpectation,
            });
            openClients.add(canonicalClient);
            await expect(canonicalClient.ready()).rejects.toThrow(
                'broker correlation canonical integrity failed',
            );
            await canonicalClient.close();
            openClients.delete(canonicalClient);
        }
    });

    it('persists an external working sell claim without fabricating a strategy or obligation', async () => {
        const { client, databasePath } = await openRepository();
        await expect(
            client.request('createExternalExitClaim', {
                exitClaimId: 'external-claim-1',
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                contractKey: 'TSE:2330:STK:Common',
                positionLineageId: 'external-position-lineage-1',
                remainderGeneration: 0,
                allocationStartShare: 0,
                quantityShares: 1_000,
                state: 'broker_working',
                evidenceHash: DIGEST_A,
                nowEpochMs: 1_786_377_600_450,
            }),
        ).resolves.toEqual({
            exitClaimId: 'external-claim-1',
            externalLineage: true,
            obligationId: null,
            state: 'broker_working',
            revision: 0,
        });
        expect((await client.request('status')).counts).toMatchObject({
            strategies: 0,
            protection_obligations: 0,
            exit_claims: 1,
            event_journal: 1,
        });
        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database
                .prepare(`
                    SELECT obligation_id, external_lineage, state
                      FROM exit_claims WHERE exit_claim_id='external-claim-1'
                `)
                .get(),
        ).toEqual({
            obligation_id: null,
            external_lineage: 1,
            state: 'broker_working',
        });
        database.close();
    });

    it('persists gate manifests as non-authoritative data and invalidates them durably', async () => {
        const { client } = await openRepository();
        const manifest = observeOnlyGateManifest();
        await expect(
            client.request('storeGateManifest', {
                manifest,
                nowEpochMs: manifest.createdAtEpochMs,
            }),
        ).resolves.toMatchObject({
            manifestId: 'manifest-1',
            state: 'observe_only',
            replayed: false,
            authoritativeForDispatch: false,
        });
        await expect(
            client.request('storeGateManifest', {
                manifest,
                nowEpochMs: manifest.createdAtEpochMs,
            }),
        ).resolves.toMatchObject({ replayed: true });
        await expect(
            client.request('gateManifestStatus', {
                provenance: 'automation',
                nowEpochMs: manifest.createdAtEpochMs,
            }),
        ).resolves.toMatchObject({
            present: true,
            state: 'observe_only',
            featureGates: Object.fromEntries(
                SMART_ORDER_FEATURE_GATE_IDS.map((id) => [id, false]),
            ),
            authoritativeForDispatch: false,
        });

        const tampered = { ...manifest, state: 'eligible' };
        await expect(
            client.request('storeGateManifest', {
                manifest: tampered,
                nowEpochMs: manifest.createdAtEpochMs,
            }),
        ).rejects.toThrow();
        await expect(
            client.request('invalidateGateManifests', {
                provenance: 'automation',
                reason: 'fingerprint_changed',
                nowEpochMs: manifest.createdAtEpochMs + 1,
            }),
        ).resolves.toEqual({
            invalidatedCount: 1,
            reason: 'fingerprint_changed',
        });
        await expect(
            client.request('gateManifestStatus', {
                provenance: 'automation',
                nowEpochMs: manifest.createdAtEpochMs + 1,
            }),
        ).resolves.toMatchObject({
            state: 'observe_only',
            blocker: 'fingerprint_changed',
        });
    });

    it('stores the three Gate-runner provenance manifests atomically', async () => {
        const { client } = await openRepository();
        const nowEpochMs = 1_786_377_600_000;
        const conflicting = [
            observeOnlyGateManifest({
                manifestId: 'manifest-batch-conflict',
                provenance: 'automation',
            }),
            observeOnlyGateManifest({
                manifestId: 'manifest-batch-conflict',
                provenance: 'manual_user_confirmed',
            }),
            observeOnlyGateManifest({
                manifestId: 'manifest-batch-probe',
                provenance: 'gate_probe',
            }),
        ];
        await expect(
            client.request('storeGateManifestBatch', {
                manifests: conflicting,
                nowEpochMs,
            }),
        ).rejects.toThrow('reused with different content');
        for (const provenance of [
            'automation',
            'manual_user_confirmed',
            'gate_probe',
        ]) {
            await expect(
                client.request('gateManifestStatus', {
                    provenance,
                    nowEpochMs,
                }),
            ).resolves.toMatchObject({
                present: false,
                state: 'observe_only',
                authoritativeForDispatch: false,
            });
        }

        const manifests = [
            observeOnlyGateManifest({
                manifestId: 'manifest-batch-automation',
                provenance: 'automation',
            }),
            observeOnlyGateManifest({
                manifestId: 'manifest-batch-manual',
                provenance: 'manual_user_confirmed',
            }),
            observeOnlyGateManifest({
                manifestId: 'manifest-batch-probe',
                provenance: 'gate_probe',
            }),
        ];
        await expect(
            client.request('storeGateManifestBatch', {
                manifests,
                nowEpochMs,
            }),
        ).resolves.toMatchObject({
            stored: [
                { state: 'observe_only', authoritativeForDispatch: false },
                { state: 'observe_only', authoritativeForDispatch: false },
                { state: 'observe_only', authoritativeForDispatch: false },
            ],
            authoritativeForDispatch: false,
        });
    });

    it('rejects legacy or DB-edited eligible Gate rows under the current evidence policy', async () => {
        const { client, databasePath } = await openRepository({
            testOnlyAllowSyntheticGateManifestProjection: false,
        });
        const nowEpochMs = 1_786_377_600_170;
        const manifest = observeOnlyGateManifest({
            manifestId: 'manifest-current-policy-probe',
            provenance: 'gate_probe',
            createdAtEpochMs: nowEpochMs - 10,
            requestedValidUntilEpochMs: nowEpochMs + 300_000,
        });
        await client.request('storeGateManifest', {
            manifest,
            nowEpochMs,
        });
        const tamper = new DatabaseSync(databasePath);
        tamper
            .prepare(
                "UPDATE gate_manifests SET state='eligible' WHERE manifest_id=?",
            )
            .run(manifest.manifestId);
        tamper.close();
        await expect(
            client.request('gateManifestStatus', {
                provenance: 'gate_probe',
                nowEpochMs,
            }),
        ).resolves.toMatchObject({
            present: true,
            state: 'observe_only',
            blocker: 'gate_manifest_projection_invalid',
            featureGates: Object.fromEntries(
                SMART_ORDER_FEATURE_GATE_IDS.map((feature) => [feature, false]),
            ),
            authoritativeForDispatch: false,
        });

        const legacySchemaManifest = observeOnlyGateManifest({
            manifestId: 'manifest-legacy-schema-probe',
            provenance: 'gate_probe',
            createdAtEpochMs: nowEpochMs + 5,
            requestedValidUntilEpochMs: nowEpochMs + 300_000,
        });
        await client.request('storeGateManifest', {
            manifest: legacySchemaManifest,
            nowEpochMs: nowEpochMs + 5,
        });
        const legacySchemaContent = {
            ...legacySchemaManifest,
            schemaVersion: 'smart-order-gate-manifest/legacy-policy',
        };
        delete legacySchemaContent.manifestSha256;
        const legacySchemaSha256 = `sha256:${createHash('sha256')
            .update(canonicalJson(legacySchemaContent))
            .digest('hex')}`;
        const legacySchemaProjection = {
            ...legacySchemaContent,
            manifestSha256: legacySchemaSha256,
        };
        const legacySchemaTamper = new DatabaseSync(databasePath);
        legacySchemaTamper
            .prepare(`
                UPDATE gate_manifests
                   SET manifest_json=?, manifest_sha256=?, schema_version=?
                 WHERE manifest_id=?
            `)
            .run(
                canonicalJson(legacySchemaProjection),
                legacySchemaSha256,
                legacySchemaProjection.schemaVersion,
                legacySchemaProjection.manifestId,
            );
        legacySchemaTamper.close();
        expect(legacySchemaManifest.schemaVersion).toBe(
            SMART_ORDER_GATE_MANIFEST_SCHEMA_VERSION,
        );
        await expect(
            client.request('gateManifestStatus', {
                provenance: 'gate_probe',
                nowEpochMs: nowEpochMs + 5,
            }),
        ).resolves.toMatchObject({
            state: 'observe_only',
            blocker: 'gate_manifest_projection_invalid',
            authoritativeForDispatch: false,
        });

        const invalidatedManifest = observeOnlyGateManifest({
            manifestId: 'manifest-invalidated-revival-probe',
            provenance: 'gate_probe',
            createdAtEpochMs: nowEpochMs + 10,
            requestedValidUntilEpochMs: nowEpochMs + 300_000,
        });
        await client.request('storeGateManifest', {
            manifest: invalidatedManifest,
            nowEpochMs: nowEpochMs + 10,
        });
        await client.request('invalidateGateManifests', {
            provenance: 'gate_probe',
            reason: 'test_invalidation',
            nowEpochMs: nowEpochMs + 20,
        });
        const revive = new DatabaseSync(databasePath);
        revive
            .prepare(
                "UPDATE gate_manifests SET state='observe_only' WHERE manifest_id=?",
            )
            .run(invalidatedManifest.manifestId);
        revive.close();
        await expect(
            client.request('gateManifestStatus', {
                provenance: 'gate_probe',
                nowEpochMs: nowEpochMs + 20,
            }),
        ).resolves.toMatchObject({
            state: 'observe_only',
            blocker: 'gate_manifest_projection_invalid',
            authoritativeForDispatch: false,
        });

        const futureManifest = observeOnlyGateManifest({
            manifestId: 'manifest-future-query-probe',
            provenance: 'gate_probe',
            createdAtEpochMs: nowEpochMs + 200,
            requestedValidUntilEpochMs: nowEpochMs + 300_000,
        });
        await client.request('storeGateManifest', {
            manifest: futureManifest,
            nowEpochMs: nowEpochMs + 200,
        });
        await expect(
            client.request('gateManifestStatus', {
                provenance: 'gate_probe',
                nowEpochMs: nowEpochMs + 100,
            }),
        ).resolves.toMatchObject({
            state: 'observe_only',
            blocker: 'gate_manifest_projection_invalid',
            authoritativeForDispatch: false,
        });

        seedEligibleProbeGate(databasePath, {
            createdAtEpochMs: nowEpochMs + 300,
        });
        await expect(
            client.request('gateManifestStatus', {
                provenance: 'gate_probe',
                nowEpochMs: nowEpochMs + 300,
            }),
        ).resolves.toMatchObject({
            state: 'observe_only',
            blocker: 'gate_manifest_projection_invalid',
            authoritativeForDispatch: false,
        });
    });

    it('durably consumes probe nonces, preserves same-run targets, and latches response loss across restart', async () => {
        const opened = await openRepository();
        const { client, databasePath } = opened;
        const { runtime } = await startReadyRuntime(client);
        const nowEpochMs = Date.now();
        const manifestSha256 = seedEligibleProbeGate(databasePath, {
            createdAtEpochMs: nowEpochMs - 100,
        });
        const placeRejected = gateProbeEnvelope();
        const prepareInput = (envelope) => ({
            runtimeEpochId: runtime.runtimeEpochId,
            senderFence: runtime.senderFence,
            apiGeneration: runtime.apiGeneration,
            manifestSha256,
            cliAuthorizationSha256: `sha256:${'8'.repeat(64)}`,
            safetyAttestationSha256: `sha256:${'9'.repeat(64)}`,
            envelope,
            nowEpochMs,
        });

        const workerExpiredAtEpochMs = Date.now() - 1;
        const staleCallerNowEpochMs = workerExpiredAtEpochMs - 100;
        const expired = gateProbeEnvelope({
            operationId: '123e4567-e89b-42d3-a456-426614174398',
            nonce: '123e4567-e89b-42d3-a456-426614174399',
            validUntilEpochMs: workerExpiredAtEpochMs,
        });
        await expect(
            client.request(
                'prepareGateProbeSafetyEnvelope',
                {
                    ...prepareInput(expired),
                    nowEpochMs: staleCallerNowEpochMs,
                },
            ),
        ).rejects.toThrow('before durable nonce consumption');
        const afterExpired = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            afterExpired
                .prepare(`
                    SELECT
                        (SELECT COUNT(*) FROM authority_consumptions
                          WHERE authority_kind='gate_probe_nonce') AS nonce_count,
                        (SELECT COUNT(*) FROM request_replays
                          WHERE request_id=?) AS replay_count
                `)
                .get(expired.operationId),
        ).toEqual({ nonce_count: 0, replay_count: 0 });
        afterExpired.close();

        await expect(
            client.request(
                'prepareGateProbeSafetyEnvelope',
                prepareInput(placeRejected),
            ),
        ).resolves.toMatchObject({
            state: 'prepared',
            operation: 'place',
            replayed: false,
            automaticRetryAllowed: false,
            cleanupAllowed: false,
            brokerAuthority: false,
            writeMasterAuthority: false,
        });
        await expect(
            client.request(
                'prepareGateProbeSafetyEnvelope',
                prepareInput(placeRejected),
            ),
        ).resolves.toMatchObject({ state: 'prepared', replayed: true });
        await expect(
            client.request('gateProbeSafetyStatus', {}),
        ).resolves.toMatchObject({
            state: 'prepared_no_retry',
            unresolvedOperationCount: 1,
            durableReplayProtection: true,
            cleanupAllowed: false,
        });
        await client.request('settleGateProbeSafetyEnvelope', {
            envelope: placeRejected,
            outcome: 'broker_rejected',
            postTarget: null,
            resultEvidenceSha256: DIGEST_A,
            nowEpochMs: nowEpochMs + 1,
        });

        await client.close();
        openClients.delete(client);
        const reopened = await openRepository({ databasePath });
        await expect(
            reopened.client.request('prepareGateProbeSafetyEnvelope', {
                ...prepareInput(
                    gateProbeEnvelope({
                        operationId:
                            '123e4567-e89b-42d3-a456-426614174303',
                    }),
                ),
                nowEpochMs: nowEpochMs + 2,
            }),
        ).rejects.toThrow('nonce was already durably consumed');

        const place = gateProbeEnvelope({
            operationId: '123e4567-e89b-42d3-a456-426614174304',
            nonce: '123e4567-e89b-42d3-a456-426614174305',
        });
        await reopened.client.request('prepareGateProbeSafetyEnvelope', {
            ...prepareInput(place),
            nowEpochMs: nowEpochMs + 3,
        });
        const target0 = gateProbeTarget();
        await reopened.client.request('settleGateProbeSafetyEnvelope', {
            envelope: place,
            outcome: 'confirmed',
            postTarget: target0,
            resultEvidenceSha256: DIGEST_A,
            nowEpochMs: nowEpochMs + 4,
        });

        const update = gateProbeEnvelope({
            operation: 'update',
            operationId: '123e4567-e89b-42d3-a456-426614174306',
            nonce: '123e4567-e89b-42d3-a456-426614174307',
            target: target0,
        });
        await reopened.client.request('prepareGateProbeSafetyEnvelope', {
            ...prepareInput(update),
            nowEpochMs: nowEpochMs + 5,
        });
        const target1 = gateProbeTarget({ revision: 1 });
        await reopened.client.request('settleGateProbeSafetyEnvelope', {
            envelope: update,
            outcome: 'confirmed',
            postTarget: target1,
            resultEvidenceSha256: DIGEST_B,
            nowEpochMs: nowEpochMs + 6,
        });

        const staleCancel = gateProbeEnvelope({
            operation: 'cancel',
            operationId: '123e4567-e89b-42d3-a456-426614174308',
            nonce: '123e4567-e89b-42d3-a456-426614174309',
            target: target0,
        });
        await expect(
            reopened.client.request('prepareGateProbeSafetyEnvelope', {
                ...prepareInput(staleCancel),
                nowEpochMs: nowEpochMs + 7,
            }),
        ).rejects.toThrow('not the current same-run durable target');

        const cancel = gateProbeEnvelope({
            operation: 'cancel',
            operationId: '123e4567-e89b-42d3-a456-426614174310',
            nonce: '123e4567-e89b-42d3-a456-426614174311',
            target: target1,
        });
        await reopened.client.request('prepareGateProbeSafetyEnvelope', {
            ...prepareInput(cancel),
            nowEpochMs: nowEpochMs + 8,
        });
        await expect(
            reopened.client.request('settleGateProbeSafetyEnvelope', {
                envelope: cancel,
                outcome: 'response_lost',
                postTarget: null,
                resultEvidenceSha256: `sha256:${'f'.repeat(64)}`,
                nowEpochMs: nowEpochMs + 9,
            }),
        ).resolves.toMatchObject({
            state: 'unknown',
            automaticRetryAllowed: false,
            cleanupAllowed: false,
            reconciliationRequired: true,
            durableReplayProtection: true,
        });
        await expect(
            reopened.client.request('gateProbeSafetyStatus', {}),
        ).resolves.toMatchObject({
            state: 'unknown_manual_intervention',
            unknownOperationCount: 1,
            activeTargetCount: 1,
            automaticRetryAllowed: false,
            cleanupAllowed: false,
        });

        await reopened.client.close();
        openClients.delete(reopened.client);
        const afterUnknownRestart = await openRepository({ databasePath });
        const nextRun = gateProbeEnvelope({
            runId: '123e4567-e89b-42d3-a456-426614174320',
            operationId: '123e4567-e89b-42d3-a456-426614174321',
            nonce: '123e4567-e89b-42d3-a456-426614174322',
        });
        await expect(
            afterUnknownRestart.client.request(
                'prepareGateProbeSafetyEnvelope',
                {
                    ...prepareInput(nextRun),
                    nowEpochMs: nowEpochMs + 10,
                },
            ),
        ).rejects.toThrow('latched by an unresolved operation');
    });

    it('projects a current account-reconciliation completeness capability only from its exact eligible automation Gate evidence', async () => {
        const { client, databasePath } = await openRepository();
        const nowEpochMs = 1_786_377_600_170;
        seedEligibleAutomationReconciliationGate(databasePath, {
            createdAtEpochMs: nowEpochMs,
        });
        await expect(
            client.request('gateManifestStatus', {
                provenance: 'automation',
                nowEpochMs,
            }),
        ).resolves.toMatchObject({
            present: true,
            state: 'eligible',
            manifestRevision: 'automation-reconciliation-r1',
            accountReconciliationCapabilityVerified: true,
            accountReconciliationCapabilitySha256:
                expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            authoritativeForDispatch: false,
        });
        await expect(
            client.request('gateManifestStatus', {
                provenance: 'automation',
                nowEpochMs: nowEpochMs + 300_000,
            }),
        ).resolves.toMatchObject({
            state: 'observe_only',
            accountReconciliationCapabilityVerified: false,
            accountReconciliationCapabilitySha256: null,
            authoritativeForDispatch: false,
        });
        await client.close();
        openClients.delete(client);
    });

    it('keeps strategy drafts editable but makes non-draft records immutable', async () => {
        const { client } = await openRepository();
        const created = await client.request('createDraftStrategy', {
            strategyId: 'draft-1',
            strategyKind: 'trailing_exit',
            workspaceContractKey: 'TSE:STK:2330',
            nowEpochMs: 1_786_377_600_550,
        });
        expect(created).toMatchObject({
            strategyId: 'draft-1',
            strategyKind: 'trailing_exit',
            state: 'draft',
            accountBound: false,
            revision: 0,
            definition: {
                schemaVersion: 'realtimestock.smart-order-strategy/v1',
                kind: 'trailing_exit',
                parameters: {
                    positionContractKey: 'TSE:STK:2330',
                    monitorContractKey: 'TSE:STK:2330',
                    positionEvidenceRevision: 'draft-unverified',
                    order: { contractKey: 'TSE:STK:2330' },
                },
            },
        });
        expect(canonicalDraftSharedView(created.definition, false)).toMatchObject({
            fixedAccountLabel: '待 Runtime canonical confirmation 固定',
            order: { contractKey: 'TSE:STK:2330', side: 'Sell' },
            validity: {
                startDate: '2026-08-11',
                endDate: '2026-08-11',
            },
        });
        const canonicalDraft = canonicalSmartOrderDraft('trailing_exit');
        const updated = await client.request('replaceDraftStrategy', {
            strategyId: 'draft-1',
            expectedRevision: 0,
            draft: canonicalDraft,
            nowEpochMs: 1_786_377_600_551,
        });
        expect(updated).toMatchObject({
            revision: 1,
            definition: canonicalDraft,
        });
        await expect(
            client.request('replaceDraftStrategy', {
                strategyId: 'draft-1',
                expectedRevision: 0,
                draft: updated.definition,
                nowEpochMs: 1_786_377_600_552,
            }),
        ).rejects.toThrow('lost its optimistic revision');
        expect(
            await client.request('listStrategies', {
                states: ['draft'],
                limit: 20,
            }),
        ).toEqual([
            expect.objectContaining({
                strategyId: 'draft-1',
                state: 'draft',
                revision: 1,
            }),
        ]);
        expect(
            await client.request('getStrategy', { strategyId: 'draft-1' }),
        ).toMatchObject({ definition: updated.definition });

        const copied = await client.request('copyStrategyToDraft', {
            sourceStrategyId: 'draft-1',
            draftStrategyId: 'draft-copy',
            expectedRevision: 1,
            nowEpochMs: 1_786_377_600_553,
        });
        expect(copied).toMatchObject({
            strategyId: 'draft-copy',
            strategyKind: 'trailing_exit',
            state: 'draft',
            revision: 0,
            definition: canonicalDraft,
        });
        expect(copied.strategyId).not.toBe(created.strategyId);
        expect(copied.definition).toEqual(updated.definition);
        expect(copied.definition).not.toHaveProperty('sourceStrategyId');
        expect(copied.definition).not.toHaveProperty('fields');
        expect(canonicalDraftSharedView(copied.definition, false)).not.toBeNull();
        await expect(
            client.request('getStrategy', { strategyId: 'draft-1' }),
        ).resolves.toMatchObject({
            strategyId: 'draft-1',
            revision: 1,
            definition: canonicalDraft,
        });
        await expect(
            client.request('copyStrategyToDraft', {
                sourceStrategyId: 'draft-1',
                draftStrategyId: 'draft-stale-copy',
                expectedRevision: 0,
                nowEpochMs: 1_786_377_600_554,
            }),
        ).rejects.toThrow('lost its optimistic revision');
        await expect(
            client.request('getStrategy', {
                strategyId: 'draft-stale-copy',
            }),
        ).resolves.toBeNull();
        await expect(
            client.request('requestStrategyCancellation', {
                strategyId: 'draft-1',
                expectedRevision: 1,
                nowEpochMs: 1_786_377_600_555,
            }),
        ).resolves.toMatchObject({
            state: 'cancelled',
            blockers: [],
            revision: 2,
        });
        await expect(
            client.request('replaceDraftStrategy', {
                strategyId: 'draft-1',
                expectedRevision: 2,
                draft: updated.definition,
                nowEpochMs: 1_786_377_600_556,
            }),
        ).rejects.toThrow('only a draft');
    });

    it('persists only the seven exact versioned canonical draft schemas and rejects non-first-phase order classes', async () => {
        const { client } = await openRepository();
        let nowEpochMs = 1_786_377_601_000;
        for (const kind of canonicalSmartOrderDraftKinds) {
            const strategyId = `canonical-${kind}`;
            const created = await client.request('createDraftStrategy', {
                strategyId,
                strategyKind: kind,
                workspaceContractKey: 'OTC:STK:6488',
                nowEpochMs: nowEpochMs++,
            });
            expect(created).toMatchObject({
                strategyId,
                strategyKind: kind,
                state: 'draft',
                accountBound: false,
                revision: 0,
                definition: {
                    schemaVersion: 'realtimestock.smart-order-strategy/v1',
                    decisionTableVersion: '2026-08-11.2',
                    kind,
                },
            });
            expect(JSON.stringify(created.definition)).toContain(
                'OTC:STK:6488',
            );
            expect(
                canonicalDraftSharedView(created.definition, false),
            ).not.toBeNull();
            const draft = canonicalSmartOrderDraft(kind);
            const updated = await client.request('replaceDraftStrategy', {
                strategyId,
                expectedRevision: 0,
                draft,
                nowEpochMs: nowEpochMs++,
            });
            expect(updated).toMatchObject({
                strategyId,
                strategyKind: kind,
                state: 'draft',
                revision: 1,
                definition: draft,
            });

            const copied = await client.request('copyStrategyToDraft', {
                sourceStrategyId: strategyId,
                draftStrategyId: `canonical-copy-${kind}`,
                expectedRevision: 1,
                nowEpochMs: nowEpochMs++,
            });
            expect(copied).toMatchObject({
                strategyId: `canonical-copy-${kind}`,
                strategyKind: kind,
                state: 'draft',
                revision: 0,
                definition: draft,
            });
            expect(copied.strategyId).not.toBe(strategyId);
            expect(canonicalDraftSharedView(copied.definition, false)).not.toBeNull();
            await expect(
                client.request('getStrategy', { strategyId }),
            ).resolves.toMatchObject({
                revision: 1,
                definition: draft,
            });
        }

        await client.request('createDraftStrategy', {
            strategyId: 'canonical-invalid',
            strategyKind: 'quick',
            nowEpochMs: nowEpochMs++,
        });
        const extraRootField = canonicalSmartOrderDraft('quick');
        extraRootField.unknown = true;
        const discriminatorMismatch = canonicalSmartOrderDraft('quick');
        discriminatorMismatch.kind = 'good_till';
        const wrongPayloadVersion = canonicalSmartOrderDraft('quick');
        wrongPayloadVersion.parameters.payloadSchemaVersion =
            'realtimestock.smart-order-strategy-payload/quick/v2';
        const foreignContract = canonicalSmartOrderDraft('quick');
        foreignContract.parameters.order.contractKey = 'NASDAQ:STK:AAPL';
        const unsupportedOrderCond = canonicalSmartOrderDraft('quick');
        unsupportedOrderCond.parameters.order.orderCond = 'MarginTrading';
        const unsupportedLot = canonicalSmartOrderDraft('quick');
        unsupportedLot.parameters.order.orderLot = 'IntradayOdd';
        const unsupportedMarketRod = canonicalSmartOrderDraft('quick');
        unsupportedMarketRod.parameters.order.priceType = 'MKT';
        unsupportedMarketRod.parameters.order.limitPrice = null;
        const wrongQuantityType = canonicalSmartOrderDraft('quick');
        wrongQuantityType.parameters.order.baseShares = 1000;
        const nestedUnknown = canonicalSmartOrderDraft('quick');
        nestedUnknown.parameters.order.provenance = 'automation';

        for (const draft of [
            {},
            extraRootField,
            discriminatorMismatch,
            wrongPayloadVersion,
            foreignContract,
            unsupportedOrderCond,
            unsupportedLot,
            unsupportedMarketRod,
            wrongQuantityType,
            nestedUnknown,
        ]) {
            await expect(
                client.request('replaceDraftStrategy', {
                    strategyId: 'canonical-invalid',
                    expectedRevision: 0,
                    draft,
                    nowEpochMs: nowEpochMs++,
                }),
            ).rejects.toThrow('canonical smart-order draft is invalid');
        }
        await expect(
            client.request('getStrategy', {
                strategyId: 'canonical-invalid',
            }),
        ).resolves.toMatchObject({ state: 'draft', revision: 0 });
    });

    it('projects only bounded terminal strategy history without account or journal payload data', async () => {
        const { client } = await openRepository();
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-terminal-old',
                strategyKind: 'quick',
                state: 'completed',
                nowEpochMs: 1_786_377_600_550,
                terminalAtEpochMs: 1_786_377_600_550,
                revision: 2,
            }),
        );
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-non-terminal',
                strategyKind: 'stop_take',
                state: 'monitoring',
                nowEpochMs: 1_786_377_600_560,
            }),
        );
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-terminal-new',
                strategyKind: 'trailing_exit',
                state: 'expired',
                nowEpochMs: 1_786_377_600_580,
                terminalAtEpochMs: 1_786_377_600_580,
                revision: 4,
            }),
        );
        const before = await client.request('status');

        const history = await client.request('listHistory', { limit: 100 });

        expect(history).toEqual([
            {
                type: 'strategy',
                strategyId: 'strategy-terminal-new',
                strategyKind: 'trailing_exit',
                state: 'expired',
                maskedAccountLabel: '固定帳號 ····untA',
                reasonCode: 'STRATEGY_TERMINAL_IMPORTED',
                revision: 4,
                createdAtEpochMs: 1_786_377_600_580,
                updatedAtEpochMs: 1_786_377_600_580,
                terminalAtEpochMs: 1_786_377_600_580,
                exchangeEpochMs: null,
                brokerEpochMs: null,
                receiveEpochMs: 1_786_377_600_580,
            },
            expect.objectContaining({
                type: 'strategy',
                strategyId: 'strategy-terminal-old',
                strategyKind: 'quick',
                state: 'completed',
                reasonCode: 'STRATEGY_TERMINAL_IMPORTED',
                revision: 2,
            }),
        ]);
        expect(Object.keys(history[0]).sort()).toEqual(
            [
                'brokerEpochMs',
                'createdAtEpochMs',
                'exchangeEpochMs',
                'maskedAccountLabel',
                'reasonCode',
                'receiveEpochMs',
                'revision',
                'state',
                'strategyId',
                'strategyKind',
                'terminalAtEpochMs',
                'type',
                'updatedAtEpochMs',
            ].sort(),
        );
        expect(JSON.stringify(history)).not.toMatch(
            /account-A|broker-A|identity-A|definition|payload|summary|sha256:/,
        );
        expect((await client.request('status')).counts).toEqual(before.counts);
        await expect(
            client.request('listHistory', { limit: 101 }),
        ).rejects.toThrow('history limit exceeds 100');
        await expect(
            client.request('listHistory', { limit: 1, accountId: 'account-A' }),
        ).rejects.toThrow('history read input is invalid');
    });

    it('rejects terminal history whose exchange or broker clock is later than receipt', async () => {
        const { client, databasePath } = await openRepository();
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-invalid-history-clock',
                state: 'completed',
                nowEpochMs: 1_786_377_600_600,
                terminalAtEpochMs: 1_786_377_600_600,
                revision: 1,
            }),
        );
        await client.close();
        openClients.delete(client);

        const database = new DatabaseSync(databasePath);
        database
            .prepare(`
                UPDATE event_journal
                   SET broker_epoch_ms=receive_epoch_ms + 1
                 WHERE entity_kind='strategy'
                   AND entity_id='strategy-invalid-history-clock'
            `)
            .run();
        database.close();

        const reopened = await openRepository({ databasePath });
        await expect(
            reopened.client.request('listHistory', { limit: 100 }),
        ).rejects.toThrow('terminal strategy history projection is invalid');
    });

    it('projects a bounded redacted journal cursor and reports deleted-sequence gaps', async () => {
        const { client, databasePath } = await openRepository();
        await expect(
            client.request('listEvents', { afterSequence: null, limit: 100 }),
        ).resolves.toEqual({
            schemaVersion: 'smart-order-event-projection/2026-08-11.1',
            cursorStatus: 'initialized',
            fromSequence: null,
            nextSequence: 0,
            highWaterSequence: 0,
            events: [],
            accountIdentifiersExposed: false,
            entityIdentifiersExposed: false,
            journalPayloadExposed: false,
        });
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'event-strategy-1',
                state: 'draft',
                nowEpochMs: 1_786_377_600_700,
            }),
        );
        const current = await client.request('listEvents', {
            afterSequence: 0,
            limit: 100,
        });
        expect(current).toMatchObject({
            cursorStatus: 'current',
            fromSequence: 0,
            nextSequence: 1,
            highWaterSequence: 1,
            accountIdentifiersExposed: false,
            entityIdentifiersExposed: false,
            journalPayloadExposed: false,
            events: [
                {
                    sequence: 1,
                    entityKind: 'strategy',
                    reasonCode: 'STRATEGY_PERSISTED',
                    revision: 0,
                },
            ],
        });
        expect(JSON.stringify(current)).not.toMatch(
            /event-strategy-1|account-A|broker-A|sha256:|"payloadHash"/i,
        );
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'event-strategy-2',
                state: 'draft',
                nowEpochMs: 1_786_377_600_710,
            }),
        );
        await expect(
            client.request('listEvents', { afterSequence: 3, limit: 100 }),
        ).rejects.toThrow('cursor is ahead');
        await expect(
            client.request('listEvents', { afterSequence: 0, limit: 101 }),
        ).rejects.toThrow('limit exceeds 100');

        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath);
        database
            .prepare('DELETE FROM event_journal WHERE local_monotonic_sequence=1')
            .run();
        database.close();

        const reopened = await openRepository({ databasePath });
        await expect(
            reopened.client.request('listEvents', {
                afterSequence: 0,
                limit: 100,
            }),
        ).resolves.toMatchObject({
            cursorStatus: 'gap',
            fromSequence: 0,
            nextSequence: 2,
            highWaterSequence: 2,
            events: [],
        });
    });

    it('fails closed when a terminal strategy still has live lifecycle state', async () => {
        const { client, databasePath } = await openRepository();
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-terminal-with-live-commitment',
                strategyKind: 'stop_take',
                state: 'completed',
                nowEpochMs: 1_786_377_600_600,
                terminalAtEpochMs: 1_786_377_600_600,
            }),
        );
        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath);
        database
            .prepare(`
                INSERT INTO pending_protection_commitments(
                    commitment_id, strategy_id, entry_intent_id, state,
                    committed_shares, materialized_shares,
                    created_at_epoch_ms, updated_at_epoch_ms, revision
                ) VALUES (?, ?, NULL, ?, 1000, 0, ?, ?, 0)
            `)
            .run(
                'commitment-still-live',
                'strategy-terminal-with-live-commitment',
                'pending',
                1_786_377_600_590,
                1_786_377_600_600,
            );
        database.close();
        const reopened = await openRepository({ databasePath });
        await expect(
            reopened.client.request('listHistory', { limit: 100 }),
        ).rejects.toThrow('terminal strategy history projection is invalid');
    });

    it('pauses safely, blocks generic resume, and leaves side-effect cancellation pending', async () => {
        const { client } = await openRepository();
        await insertPreparedIntent(client);
        await expect(
            client.request('pauseStrategy', {
                strategyId: 'strategy-1',
                expectedRevision: 0,
                nowEpochMs: 1_786_377_600_560,
            }),
        ).resolves.toMatchObject({ state: 'paused', revision: 1 });
        await expect(
            client.request('resumeStrategy', {
                strategyId: 'strategy-1',
                expectedRevision: 1,
                nowEpochMs: 1_786_377_600_561,
            }),
        ).rejects.toThrow('strategy resume input is invalid');
        await expect(
            client.request('requestStrategyCancellation', {
                strategyId: 'strategy-1',
                expectedRevision: 1,
                nowEpochMs: 1_786_377_600_562,
            }),
        ).resolves.toMatchObject({
            state: 'cancel_pending',
            revision: 2,
            blockers: expect.arrayContaining(['intents:1', 'reservations:1']),
        });
    });

    it('resumes a paused strategy only with current ready reconciliation, an eligible manual gate, and one consumed arm', async () => {
        const { client, databasePath } = await openRepository();
        await client.request(
            'insertStrategy',
            strategyInput({
                state: 'paused',
                definition: {
                    schemaVersion: 'strategy/1',
                    kind: 'quick',
                    activationPolicy: 'require_rearm',
                },
            }),
        );
        await startReadyRuntime(client);
        seedEligibleManualGate(databasePath);
        await expect(
            client.request('resumeStrategy', {
                activationPolicyAcknowledged: true,
                apiGeneration: 'api-generation-1',
                authorityId: 'resume-authority-1',
                contractEvidence: null,
                expectedRevision: 0,
                nowEpochMs: 1_786_377_600_180,
                runtimeEpochId: 'runtime-epoch-1',
                senderFence: 'sender-fence-1',
                strategyId: 'strategy-1',
                userArmEvidenceHash: DIGEST_A,
            }),
        ).resolves.toMatchObject({
            state: 'monitoring',
            revision: 1,
        });
        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database
                .prepare(`
                    SELECT authority_kind, authority_id, scope_hash,
                           runtime_epoch_id
                      FROM authority_consumptions
                     WHERE authority_kind='strategy_resume_arm'
                `)
                .get(),
        ).toMatchObject({
            authority_kind: 'strategy_resume_arm',
            authority_id: 'resume-authority-1',
            runtime_epoch_id: 'runtime-epoch-1',
            scope_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        });
        database.close();
    });

    it('keeps strategy resume closed when the eligible manual manifest has no strategy feature gate', async () => {
        const { client, databasePath } = await openRepository();
        await client.request(
            'insertStrategy',
            strategyInput({
                state: 'paused',
                definition: {
                    schemaVersion: 'strategy/1',
                    kind: 'quick',
                    activationPolicy: 'require_rearm',
                },
            }),
        );
        await startReadyRuntime(client);
        seedEligibleManualGate(databasePath, { featureEnabled: false });
        await expect(
            client.request('resumeStrategy', {
                activationPolicyAcknowledged: true,
                apiGeneration: 'api-generation-1',
                authorityId: 'resume-authority-disabled-feature',
                contractEvidence: null,
                expectedRevision: 0,
                nowEpochMs: 1_786_377_600_180,
                runtimeEpochId: 'runtime-epoch-1',
                senderFence: 'sender-fence-1',
                strategyId: 'strategy-1',
                userArmEvidenceHash: DIGEST_A,
            }),
        ).rejects.toThrow('requires current gate');
    });

    it('prepares a separate manual broker cancellation intent from one exact durable working target without broker authority', async () => {
        const { client, databasePath } = await openRepository({
            testOnlyBrokerCorrelationIdentifierKinds: [
                'tradeId',
                'orderId',
                'seqno',
                'ordno',
            ],
        });
        await client.request(
            'insertStrategy',
            strategyInput({
                definition: {
                    schemaVersion: 'strategy/1',
                    kind: 'quick',
                    activationPolicy: 'require_rearm',
                },
            }),
        );
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                activation: {
                    activationId: 'activation-cancel-surface-target',
                    logicalKey: 'edge-cancel-surface-target',
                },
                intent: {
                    intentId: 'intent-cancel-surface-target',
                    clientRequestId: 'request-cancel-surface-target',
                },
            }),
        );
        await startReadyRuntime(client, {}, {
            rearmPreparedIntent: true,
            rearmOverrides: {
                rearmAuthorizationId: 'rearm-cancel-surface-target',
                rearmRequestId: 'rearm-request-cancel-surface-target',
                intentId: 'intent-cancel-surface-target',
            },
        });
        const dispatched = await client.request(
            'markIntentDispatching',
            dispatchInput({
                intentId: 'intent-cancel-surface-target',
                expectedReservationRevision: 0,
                dispatchAttemptNonce: 'dispatch-cancel-surface-target',
            }),
        );
        await client.request('markIntentOutcome', {
            intentId: 'intent-cancel-surface-target',
            state: 'acknowledged',
            terminalOutcome: 'broker_submit_acknowledged',
            expectedRevision: dispatched.revision,
            dispatchAttemptNonce: 'dispatch-cancel-surface-target',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            nowEpochMs: 1_786_377_600_205,
        });
        await client.request('recordBrokerOrderEvidence', {
            runtimeEpochId: 'runtime-epoch-1',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            brokerOrderId: 'broker-order-cancel-surface',
            intentId: 'intent-cancel-surface-target',
            state: 'submitted',
            controlRevision: 0,
            quantityShares: 1_000,
            filledShares: 0,
            remainingShares: 1_000,
            evidenceHash: DIGEST_A,
            expectedRevision: null,
            nowEpochMs: 1_786_377_600_206,
        });
        await client.request('addBrokerCorrelation', {
            correlationId: 'correlation-cancel-surface-target',
            intentId: 'intent-cancel-surface-target',
            brokerOrderId: 'broker-order-cancel-surface',
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            tradeDate: '2026-08-11',
            contractKey: 'TSE:2330:STK:Common',
            side: 'Buy',
            tradeId: 'protected-entry-trade-1',
            orderId: 'protected-entry-order-1',
            seqno: 'protected-entry-seq-1',
            ordno: 'protected-entry-ord-1',
            customField: 'PE0001',
            evidenceHash: DIGEST_B,
            createdAtEpochMs: 1_786_377_600_207,
        });
        await client.request('recordCanonicalBrokerEvent', {
            runtimeEpochId: 'runtime-epoch-1',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            event: protectedEntryBrokerEvent({
                apiGeneration: 'api-generation-1',
            }),
        });
        seedDurableOriginatingIntentUnit(
            databasePath,
            'intent-cancel-surface-target',
        );
        seedEligibleManualGate(databasePath, { featureEnabled: false });
        const currentStrategy = await client.request('getStrategy', {
            strategyId: 'strategy-1',
        });
        const pauseFixture = new DatabaseSync(databasePath);
        pauseFixture
            .prepare(`
                UPDATE strategies
                   SET state='paused', updated_at_epoch_ms=?,
                       revision=revision+1
                 WHERE strategy_id='strategy-1' AND revision=?
            `)
            .run(1_786_377_600_209, currentStrategy.revision);
        pauseFixture.close();
        const pausedStrategy = await client.request('getStrategy', {
            strategyId: 'strategy-1',
        });
        await expect(
            client.request('requestBrokerOrderCancellation', {
                apiGeneration: 'api-generation-1',
                authorityId: 'cancel-surface-authority-1',
                expectedRevision: pausedStrategy.revision,
                nowEpochMs: 1_786_377_600_210,
                runtimeEpochId: 'runtime-epoch-1',
                senderFence: 'sender-fence-1',
                strategyId: 'strategy-1',
                userConfirmationEvidenceHash: DIGEST_A,
            }),
        ).resolves.toEqual({
            brokerAuthorityGranted: false,
            brokerWriteAttempted: false,
            cancelIntentState: 'prepared',
            dispatchAllowed: false,
            replayed: false,
            strategyId: 'strategy-1',
            strategyRevision: pausedStrategy.revision,
            targetState: 'submitted',
            userConfirmationConsumed: true,
        });
        await expect(
            client.request('requestBrokerOrderCancellation', {
                apiGeneration: 'api-generation-1',
                authorityId: 'cancel-surface-authority-2',
                expectedRevision: pausedStrategy.revision,
                nowEpochMs: 1_786_377_600_211,
                runtimeEpochId: 'runtime-epoch-1',
                senderFence: 'sender-fence-1',
                strategyId: 'strategy-1',
                userConfirmationEvidenceHash: DIGEST_B,
            }),
        ).rejects.toThrow('already has a live intent');
        await expect(
            client.request(
                'markIntentDispatching',
                dispatchInput({
                    intentId:
                        'manual-cancel-intent:cancel-surface-authority-1',
                    expectedReservationRevision: undefined,
                    rearmAuthorizationId:
                        'manual-cancel-rearm:cancel-surface-authority-1',
                    dispatchAttemptNonce: 'dispatch-cancel-surface-request',
                    nowEpochMs: 1_786_377_600_212,
                }),
            ),
        ).resolves.toMatchObject({
            state: 'dispatching',
            killSwitchOperationClass: 'explicit_manual_cancel',
        });
        await client.close();
        openClients.delete(client);
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database
                .prepare(`
                    SELECT operation_kind, owner_kind, state,
                           target_broker_order_id, target_control_revision,
                           adapter_authority_granted, revision
                      FROM order_intents
                     WHERE client_request_id='cancel-surface-authority-1'
                `)
                .get(),
        ).toEqual({
            operation_kind: 'cancel',
            owner_kind: 'manual_request',
            state: 'dispatching',
            target_broker_order_id: 'broker-order-cancel-surface',
            target_control_revision: 0,
            adapter_authority_granted: 1,
            revision: 2,
        });
        expect(
            database
                .prepare(`
                    SELECT state, authorized_intent_revision
                      FROM intent_rearm_authorizations
                     WHERE rearm_request_id='cancel-surface-authority-1'
                `)
                .get(),
        ).toEqual({ state: 'consumed', authorized_intent_revision: 1 });
        database.close();
    });

    it('derives a manual broker quantity-reduction target and rejects stale update dispatch before adapter authority', async () => {
        const { client, databasePath } = await openRepository({
            testOnlyBrokerCorrelationIdentifierKinds: [
                'tradeId',
                'orderId',
                'seqno',
                'ordno',
            ],
        });
        await client.request(
            'insertStrategy',
            strategyInput({
                definition: {
                    schemaVersion: 'strategy/1',
                    kind: 'quick',
                    activationPolicy: 'require_rearm',
                },
            }),
        );
        await client.request(
            'prepareIntent',
            preparedIntentInput({
                activation: {
                    activationId: 'activation-update-surface-target',
                    logicalKey: 'edge-update-surface-target',
                },
                intent: {
                    intentId: 'intent-update-surface-target',
                    clientRequestId: 'request-update-surface-target',
                },
            }),
        );
        await startReadyRuntime(client, {}, {
            rearmPreparedIntent: true,
            rearmOverrides: {
                rearmAuthorizationId: 'rearm-update-surface-target',
                rearmRequestId: 'rearm-request-update-surface-target',
                intentId: 'intent-update-surface-target',
            },
        });
        const dispatchedTarget = await client.request(
            'markIntentDispatching',
            dispatchInput({
                intentId: 'intent-update-surface-target',
                expectedReservationRevision: 0,
                dispatchAttemptNonce: 'dispatch-update-surface-target',
            }),
        );
        await client.request('markIntentOutcome', {
            intentId: 'intent-update-surface-target',
            state: 'acknowledged',
            terminalOutcome: 'broker_submit_acknowledged',
            expectedRevision: dispatchedTarget.revision,
            dispatchAttemptNonce: 'dispatch-update-surface-target',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            nowEpochMs: 1_786_377_600_205,
        });
        await client.request('recordBrokerOrderEvidence', {
            runtimeEpochId: 'runtime-epoch-1',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            brokerOrderId: 'broker-order-update-surface',
            intentId: 'intent-update-surface-target',
            state: 'submitted',
            controlRevision: 0,
            quantityShares: 1_000,
            filledShares: 0,
            remainingShares: 1_000,
            evidenceHash: DIGEST_A,
            expectedRevision: null,
            nowEpochMs: 1_786_377_600_206,
        });
        await client.request('addBrokerCorrelation', {
            correlationId: 'correlation-update-surface-target',
            intentId: 'intent-update-surface-target',
            brokerOrderId: 'broker-order-update-surface',
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            tradeDate: '2026-08-11',
            contractKey: 'TSE:2330:STK:Common',
            side: 'Buy',
            tradeId: 'protected-entry-trade-1',
            orderId: 'protected-entry-order-1',
            seqno: 'protected-entry-seq-1',
            ordno: 'protected-entry-ord-1',
            customField: 'PE0001',
            evidenceHash: DIGEST_B,
            createdAtEpochMs: 1_786_377_600_207,
        });
        await client.request('recordCanonicalBrokerEvent', {
            runtimeEpochId: 'runtime-epoch-1',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            event: protectedEntryBrokerEvent({
                apiGeneration: 'api-generation-1',
            }),
        });
        seedDurableOriginatingIntentUnit(
            databasePath,
            'intent-update-surface-target',
            { contractUnit: 500, quantityShares: 1_000 },
        );
        seedEligibleManualGate(databasePath, { featureEnabled: false });
        const strategy = await client.request('getStrategy', {
            strategyId: 'strategy-1',
        });
        const updateOperationId =
            '123e4567-e89b-42d3-a456-426614174512';
        await expect(
            client.request('executeReplayProtectedStrategyMutation', {
                requestId: updateOperationId,
                operationKind: 'broker_order_update_request',
                payloadHash: DIGEST_A,
                nowEpochMs: 1_786_377_600_210,
                mutation: {
                    kind: 'update_broker_order',
                    apiGeneration: 'api-generation-1',
                    authorityId: updateOperationId,
                    expectedRevision: strategy.revision,
                    nowEpochMs: 1_786_377_600_210,
                    quantityShares: 500,
                    runtimeEpochId: 'runtime-epoch-1',
                    senderFence: 'sender-fence-1',
                    strategyId: 'strategy-1',
                    userConfirmationEvidenceHash: DIGEST_A,
                },
            }),
        ).resolves.toMatchObject({
            state: 'completed',
            replayed: false,
            result: {
                brokerAuthorityGranted: false,
                brokerWriteAttempted: false,
                dispatchAllowed: false,
                quantityShares: 500,
                replayed: false,
                strategyId: 'strategy-1',
                strategyRevision: strategy.revision,
                targetState: 'submitted',
                updateIntentState: 'prepared',
                userConfirmationConsumed: true,
            },
        });
        const updateDispatch = await client.request(
            'markIntentDispatching',
            dispatchInput({
                intentId: `manual-update-intent:${updateOperationId}`,
                expectedReservationRevision: undefined,
                rearmAuthorizationId:
                    `manual-update-rearm:${updateOperationId}`,
                dispatchAttemptNonce: 'dispatch-update-surface-request',
                nowEpochMs: 1_786_377_600_211,
            }),
        );
        expect(updateDispatch).toMatchObject({
            state: 'dispatching',
            killSwitchOperationClass: 'unclassified_write',
            targetRevision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        });
        const grantInput = {
            intentId: `manual-update-intent:${updateOperationId}`,
            runtimeEpochId: 'runtime-epoch-1',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            dispatchAttemptNonce: 'dispatch-update-surface-request',
            modeRevision: 'mode-revision-1',
            riskRevision: 'risk-revision-1',
            accountRevision: 'account-revision-1',
            targetRevision: updateDispatch.targetRevision,
            revision: updateDispatch.revision,
            activationRevision: updateDispatch.activationRevision,
            reservationRevision: undefined,
            rearmAuthorizationId:
                `manual-update-rearm:${updateOperationId}`,
            rearmRevision: updateDispatch.rearmRevision,
            killSwitchArbiterRevision:
                updateDispatch.killSwitchArbiterRevision,
        };
        await expect(
            client.request('verifyDispatchGrant', grantInput),
        ).resolves.toMatchObject({
            authorized: true,
            envelope: {
                operationKind: 'update',
                payload: {
                    schemaVersion:
                        'smart-order-broker-update-quantity-intent/2026-08-20.1',
                    quantityShares: 500,
                },
                adapterTarget: {
                    brokerOrderId: 'broker-order-update-surface',
                    contractUnit: 500,
                    targetRevision: updateDispatch.targetRevision,
                },
            },
        });
        seedDurableOriginatingIntentUnit(
            databasePath,
            'intent-update-surface-target',
            { contractUnit: 1_000, quantityShares: 1_000 },
        );
        await expect(
            client.request('verifyDispatchGrant', grantInput),
        ).resolves.toEqual({
            authorized: false,
            reasonCode: 'broker_target_changed',
        });
        seedDurableOriginatingIntentUnit(
            databasePath,
            'intent-update-surface-target',
            { contractUnit: 500, quantityShares: 1_000 },
        );
        const staleFixture = new DatabaseSync(databasePath);
        staleFixture
            .prepare(`
                UPDATE broker_orders
                   SET control_revision=control_revision+1,
                       revision=revision+1
                 WHERE broker_order_id='broker-order-update-surface'
            `)
            .run();
        staleFixture.close();
        await expect(
            client.request('verifyDispatchGrant', grantInput),
        ).resolves.toEqual({
            authorized: false,
            reasonCode: 'broker_target_changed',
        });
    });

    it('durably consumes authority once and never treats an exact replay as permission', async () => {
        const { client } = await openRepository();
        const consume = {
            authorityKind: 'manual_resolution_decision',
            authorityId: 'resolution-decision-1',
            authorityPayloadHash: DIGEST_A,
            scopeHash: DIGEST_B,
            consumedBy: 'resolution-case-1',
            consumedAtEpochMs: 1_786_377_600_600,
        };
        await expect(
            client.request('consumeAuthority', consume),
        ).resolves.toMatchObject({ consumed: true });
        await expect(
            client.request('consumeAuthority', consume),
        ).rejects.toThrow('already durably consumed');
    });

    it('reserves and completes request replay records with payload-bound CAS', async () => {
        const { client } = await openRepository();
        const request = {
            requestId: 'request-replay-1',
            operationKind: 'strategy_create',
            payloadHash: DIGEST_A,
            nowEpochMs: 1_786_377_600_700,
        };
        await expect(
            client.request('reserveRequestReplay', request),
        ).resolves.toMatchObject({ mayExecute: true, replayed: false });
        await expect(
            client.request('reserveRequestReplay', request),
        ).resolves.toMatchObject({
            mayExecute: false,
            replayed: true,
            state: 'reserved',
        });
        await expect(
            client.request('reserveRequestReplay', {
                ...request,
                payloadHash: DIGEST_B,
            }),
        ).rejects.toThrow('different content');
        await expect(
            client.request('completeRequestReplay', {
                ...request,
                resultStatus: 200,
                result: { strategyId: 'draft-replay-1', revision: 0 },
                nowEpochMs: request.nowEpochMs + 1,
            }),
        ).resolves.toMatchObject({
            requestId: request.requestId,
            state: 'completed',
            resultStatus: 200,
            resultHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        });
        await expect(
            client.request('reserveRequestReplay', request),
        ).resolves.toMatchObject({
            mayExecute: false,
            state: 'completed',
            resultStatus: 200,
            result: { strategyId: 'draft-replay-1', revision: 0 },
            resultHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        });
        await expect(
            client.request('completeRequestReplay', {
                ...request,
                resultStatus: 200,
                result: { strategyId: 'draft-replay-1', revision: 0 },
                nowEpochMs: request.nowEpochMs + 2,
            }),
        ).rejects.toThrow('lost its durable CAS');

        const failedRequest = {
            requestId: 'request-replay-failed-1',
            operationKind: 'strategy_update',
            payloadHash: DIGEST_B,
            nowEpochMs: request.nowEpochMs + 3,
        };
        await expect(
            client.request('reserveRequestReplay', failedRequest),
        ).resolves.toMatchObject({ mayExecute: true, replayed: false });
        await expect(
            client.request('failRequestReplay', {
                ...failedRequest,
                resultStatus: 422,
                result: { code: 'strategy_payload_invalid', status: 422 },
                nowEpochMs: failedRequest.nowEpochMs + 1,
            }),
        ).resolves.toMatchObject({
            state: 'failed',
            resultStatus: 422,
            resultHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        });
        await expect(
            client.request('reserveRequestReplay', failedRequest),
        ).resolves.toMatchObject({
            mayExecute: false,
            replayed: true,
            state: 'failed',
            resultStatus: 422,
            result: { code: 'strategy_payload_invalid', status: 422 },
        });
    });

    it('hard-bounds strategy, draft and replay persistence while preserving known replay IDs', async () => {
        const { client } = await openRepository({
            testOnlyMaxRequestReplays: 2,
            testOnlyMaxStrategies: 2,
            testOnlyMaxDraftStrategies: 1,
        });
        await client.request('createDraftStrategy', {
            strategyId: 'bounded-draft-1',
            strategyKind: 'quick',
            nowEpochMs: 1_786_377_600_000,
        });
        await expect(
            client.request('createDraftStrategy', {
                strategyId: 'bounded-draft-2',
                strategyKind: 'quick',
                nowEpochMs: 1_786_377_600_001,
            }),
        ).rejects.toThrow('draft strategy repository capacity exhausted');
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'bounded-terminal-1',
                state: 'completed',
                nowEpochMs: 1_786_377_600_002,
                terminalAtEpochMs: 1_786_377_600_002,
            }),
        );
        await expect(
            client.request(
                'insertStrategy',
                strategyInput({
                    strategyId: 'bounded-terminal-2',
                    state: 'completed',
                    nowEpochMs: 1_786_377_600_003,
                    terminalAtEpochMs: 1_786_377_600_003,
                }),
            ),
        ).rejects.toThrow('strategy repository capacity exhausted');

        const firstReplay = {
            requestId: 'bounded-replay-1',
            operationKind: 'strategy_update_draft',
            payloadHash: DIGEST_A,
            nowEpochMs: 1_786_377_600_010,
        };
        await client.request('reserveRequestReplay', firstReplay);
        await client.request('reserveRequestReplay', {
            requestId: 'bounded-replay-2',
            operationKind: 'strategy_update_draft',
            payloadHash: DIGEST_B,
            nowEpochMs: 1_786_377_600_011,
        });
        await expect(
            client.request('reserveRequestReplay', {
                requestId: 'bounded-replay-3',
                operationKind: 'strategy_update_draft',
                payloadHash: `sha256:${'c'.repeat(64)}`,
                nowEpochMs: 1_786_377_600_012,
            }),
        ).rejects.toThrow('request replay repository capacity exhausted');
        await expect(
            client.request('reserveRequestReplay', firstReplay),
        ).resolves.toMatchObject({
            requestId: firstReplay.requestId,
            replayed: true,
            mayExecute: false,
            state: 'reserved',
        });
        await expect(client.request('status')).resolves.toMatchObject({
            requestReplayMaxRows: 2,
            requestReplayCapacityRemaining: 0,
            strategyMaxRows: 2,
            draftStrategyMaxRows: 1,
            counts: { strategies: 2, request_replays: 2 },
        });
    });

    it('compacts only old completed safe-action replays linked to a terminal strategy', async () => {
        const { client } = await openRepository();
        const createdAtEpochMs = taipeiEpoch('2024-03-01T10:00:00.000');
        await client.request('createDraftStrategy', {
            strategyId: 'terminal-replay-strategy',
            strategyKind: 'quick',
            nowEpochMs: createdAtEpochMs,
        });
        const cancellation = {
            requestId: 'terminal-safe-cancel-replay',
            operationKind: 'strategy_cancel',
            payloadHash: DIGEST_A,
            nowEpochMs: createdAtEpochMs + 1,
            mutation: {
                kind: 'cancel',
                strategyId: 'terminal-replay-strategy',
                expectedRevision: 0,
                nowEpochMs: createdAtEpochMs + 1,
            },
        };
        await expect(
            client.request(
                'executeReplayProtectedStrategyMutation',
                cancellation,
            ),
        ).resolves.toMatchObject({
            state: 'completed',
            result: {
                strategyId: 'terminal-replay-strategy',
                state: 'cancelled',
                revision: 1,
            },
        });

        const unsafeCreateReplay = {
            requestId: 'terminal-unsafe-create-replay',
            operationKind: 'strategy_create_draft',
            payloadHash: DIGEST_B,
            nowEpochMs: createdAtEpochMs + 2,
        };
        await client.request('reserveRequestReplay', unsafeCreateReplay);
        await client.request('completeRequestReplay', {
            ...unsafeCreateReplay,
            resultStatus: 200,
            result: {
                strategyId: 'terminal-replay-strategy',
                state: 'cancelled',
                revision: 1,
            },
            nowEpochMs: createdAtEpochMs + 3,
        });
        await client.request('reserveRequestReplay', {
            requestId: 'terminal-protected-reserved-replay',
            operationKind: 'strategy_update_draft',
            payloadHash: `sha256:${'c'.repeat(64)}`,
            nowEpochMs: createdAtEpochMs + 4,
        });
        const failedReplay = {
            requestId: 'terminal-protected-failed-replay',
            operationKind: 'strategy_update_draft',
            payloadHash: `sha256:${'d'.repeat(64)}`,
            nowEpochMs: createdAtEpochMs + 5,
        };
        await client.request('reserveRequestReplay', failedReplay);
        await client.request('failRequestReplay', {
            ...failedReplay,
            resultStatus: 409,
            result: { code: 'strategy_conflict', status: 409 },
            nowEpochMs: createdAtEpochMs + 6,
        });

        await expect(
            client.request('compactTerminalRequestReplays', {
                nowEpochMs: taipeiEpoch('2025-03-01T10:00:00.000'),
                batchLimit: 10,
            }),
        ).resolves.toMatchObject({
            schemaVersion:
                'smart-order-request-replay-retention/2026-08-11.1',
            compactedRequestIds: [],
            retained: [
                expect.objectContaining({
                    requestId: cancellation.requestId,
                    reason: 'retention_period_active',
                }),
            ],
            protectedCounts: {
                reserved: 1,
                failed: 1,
                outcomeUnknown: 0,
            },
        });

        await expect(
            client.request('compactTerminalRequestReplays', {
                nowEpochMs: taipeiEpoch('2025-03-01T10:00:00.010'),
                batchLimit: 10,
            }),
        ).resolves.toMatchObject({
            compactedRequestIds: [cancellation.requestId],
            protectedCounts: {
                reserved: 1,
                failed: 1,
                outcomeUnknown: 0,
            },
        });
        expect((await client.request('status')).counts.request_replays).toBe(3);

        const replayAfterCompaction = await client.request(
            'executeReplayProtectedStrategyMutation',
            cancellation,
        );
        expect(replayAfterCompaction).toMatchObject({
            state: 'failed',
            result: {
                code: 'stale_revision',
                status: 409,
            },
        });
        await expect(
            client.request('getStrategy', {
                strategyId: 'terminal-replay-strategy',
            }),
        ).resolves.toMatchObject({ state: 'cancelled', revision: 1 });
    });

    it('bounds the repository client queue before posting more worker messages', async () => {
        const { client } = await openRepository({ maxPendingRequests: 1 });
        const first = client.request('status');
        const second = client.request('status');
        await expect(second).rejects.toThrow('repository request backpressure');
        await expect(first).resolves.toMatchObject({ integrity: 'ok' });
        expect(client.watchdogStatus()).toMatchObject({
            maxPendingRequests: 1,
            maxObservedPendingRequests: 1,
        });
    });

    it('commits a strategy mutation and its exact public replay result atomically', async () => {
        const { client } = await openRepository();
        const request = {
            requestId: 'atomic-strategy-create-1',
            operationKind: 'strategy_create_draft',
            payloadHash: DIGEST_A,
            nowEpochMs: 1_786_377_600_800,
            mutation: {
                kind: 'create',
                strategyId: 'atomic-draft-1',
                strategyKind: 'trailing_exit',
                workspaceContractKey: 'TSE:STK:2330',
                nowEpochMs: 1_786_377_600_800,
            },
        };
        const created = await client.request(
            'executeReplayProtectedStrategyMutation',
            request,
        );
        expect(created).toMatchObject({
            state: 'completed',
            resultStatus: 200,
            replayed: false,
            result: {
                strategyId: 'atomic-draft-1',
                state: 'draft',
                revision: 0,
            },
        });
        const replayed = await client.request(
            'executeReplayProtectedStrategyMutation',
            {
                ...request,
                mutation: {
                    ...request.mutation,
                    strategyId: 'must-never-be-created',
                },
            },
        );
        expect(replayed).toMatchObject({
            state: 'completed',
            resultStatus: 200,
            replayed: true,
            result: created.result,
            resultHash: created.resultHash,
        });
        expect(await client.request('listStrategies', { limit: 20 })).toEqual([
            expect.objectContaining({ strategyId: 'atomic-draft-1' }),
        ]);

        const failedRequest = {
            requestId: 'atomic-strategy-update-failed-1',
            operationKind: 'strategy_update_draft',
            payloadHash: DIGEST_B,
            nowEpochMs: request.nowEpochMs + 1,
            mutation: {
                kind: 'update',
                strategyId: 'missing-draft',
                expectedRevision: 0,
                draft: canonicalSmartOrderDraft('trailing_exit'),
                nowEpochMs: request.nowEpochMs + 1,
            },
        };
        const failed = await client.request(
            'executeReplayProtectedStrategyMutation',
            failedRequest,
        );
        expect(failed).toMatchObject({
            state: 'failed',
            resultStatus: 503,
            replayed: false,
            result: { code: 'strategy_service_unavailable', status: 503 },
        });
        await expect(
            client.request('executeReplayProtectedStrategyMutation', failedRequest),
        ).resolves.toMatchObject({
            state: 'failed',
            resultStatus: 503,
            replayed: true,
            result: failed.result,
            resultHash: failed.resultHash,
        });
    });

    it('rolls back both the strategy mutation and replay reservation when outcome persistence faults', async () => {
        const databasePath = await temporaryDatabasePath();
        const faulting = await openRepository({
            databasePath,
            testOnlyFailReplayCompletionAfterMutation: true,
        });
        await expect(
            faulting.client.request('executeReplayProtectedStrategyMutation', {
                requestId: 'atomic-crash-window-1',
                operationKind: 'strategy_create_draft',
                payloadHash: DIGEST_A,
                nowEpochMs: 1_786_377_600_900,
                mutation: {
                    kind: 'create',
                    strategyId: 'must-roll-back',
                    strategyKind: 'quick',
                    nowEpochMs: 1_786_377_600_900,
                },
            }),
        ).rejects.toThrow('after mutation before outcome commit');
        await faulting.client.close();
        openClients.delete(faulting.client);

        const reopened = await openRepository({ databasePath });
        await expect(reopened.client.request('status')).resolves.toMatchObject({
            counts: { strategies: 0, request_replays: 0 },
        });
    });

    it('creates a private consistent backup with an independently verifiable manifest', async () => {
        const databasePath = await temporaryDatabasePath();
        const backupDirectory = path.join(path.dirname(databasePath), 'backups');
        await mkdir(backupDirectory, { mode: 0o700 });
        await chmod(backupDirectory, 0o700);
        const { client } = await openRepository({ databasePath, backupDirectory });
        await insertPreparedIntent(client);

        const manifest = await client.request('createRepositoryBackup', {
            backupName: 'smart-orders-2026-08-11.sqlite3',
            createdAtEpochMs: 1_786_377_600_500,
        });
        const backupPath = path.join(
            backupDirectory,
            'smart-orders-2026-08-11.sqlite3',
        );
        const manifestPath = `${backupPath}.manifest.json`;
        expect(manifest).toMatchObject({
            repositorySchemaId: SMART_ORDER_REPOSITORY_SCHEMA_ID,
            repositorySchemaVersion: SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
            backupName: 'smart-orders-2026-08-11.sqlite3',
            rowCounts: {
                strategies: 1,
                activations: 1,
                order_intents: 1,
                entry_exposure_reservations: 1,
            },
            containsSecrets: false,
            artifactPermissions: '0600',
            manifestPermissions: '0600',
        });
        expect(permissionBits((await stat(backupPath)).mode)).toBe(0o600);
        expect(permissionBits((await stat(manifestPath)).mode)).toBe(0o600);
        expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toEqual(
            expect.objectContaining({
                databaseSha256: manifest.databaseSha256,
                rowCounts: manifest.rowCounts,
            }),
        );
        const copied = new DatabaseSync(backupPath, { readOnly: true });
        expect(copied.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe(
            'ok',
        );
        expect(
            copied.prepare('SELECT COUNT(*) AS count FROM order_intents').get()?.count,
        ).toBe(1);
        copied.close();
        await expect(
            client.request('createRepositoryBackup', {
                backupName: 'smart-orders-2026-08-11.sqlite3',
                createdAtEpochMs: 1_786_377_600_501,
            }),
        ).rejects.toThrow('already exists');
    });

    it('purges only terminal aggregates after one full Taipei calendar year', async () => {
        const { client } = await openRepository();
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-old-terminal',
                state: 'completed',
                nowEpochMs: taipeiEpoch('2024-02-29T10:00:00.000'),
                terminalAtEpochMs: taipeiEpoch('2024-02-29T10:00:00.000'),
            }),
        );
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-late-journal',
                state: 'completed',
                nowEpochMs: taipeiEpoch('2024-03-01T10:00:00.000'),
                terminalAtEpochMs: taipeiEpoch('2024-02-29T10:00:00.000'),
            }),
        );
        await client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-recent-terminal',
                state: 'cancelled',
                nowEpochMs: taipeiEpoch('2025-02-28T11:00:00.000'),
                terminalAtEpochMs: taipeiEpoch('2025-02-28T11:00:00.000'),
            }),
        );

        await expect(
            client.request('purgeEligibleHistory', {
                nowEpochMs: taipeiEpoch('2025-02-28T10:00:00.000'),
                batchLimit: 25,
            }),
        ).resolves.toEqual({
            purgedStrategyIds: ['strategy-old-terminal'],
            retained: [
                {
                    strategyId: 'strategy-late-journal',
                    reason: 'retention_period_active',
                    eligibleAtEpochMs: taipeiEpoch('2025-03-01T10:00:00.000'),
                },
                {
                    strategyId: 'strategy-recent-terminal',
                    reason: 'retention_period_active',
                    eligibleAtEpochMs: taipeiEpoch('2026-02-28T11:00:00.000'),
                },
            ],
            purgedExternalExitClaimIds: [],
            retainedExternalExitClaims: [],
            calendarTimeZone: 'Asia/Taipei',
            policy: 'later-terminal-release-or-evidence-plus-one-calendar-year',
        });
        expect((await client.request('status')).counts).toMatchObject({
            strategies: 2,
            event_journal: 2,
        });
        expect(
            (await client.request('listHistory', { limit: 100 })).map(
                (entry) => entry.strategyId,
            ),
        ).toEqual(['strategy-recent-terminal', 'strategy-late-journal']);
        await expect(
            client.request('purgeEligibleHistory', {
                nowEpochMs: taipeiEpoch('2025-03-01T10:00:00.000'),
                batchLimit: 25,
            }),
        ).resolves.toMatchObject({
            purgedStrategyIds: ['strategy-late-journal'],
        });
        expect((await client.request('status')).counts).toMatchObject({
            strategies: 1,
            event_journal: 1,
        });
        expect(await client.request('listHistory', { limit: 100 })).toEqual([
            expect.objectContaining({
                strategyId: 'strategy-recent-terminal',
                state: 'cancelled',
            }),
        ]);
    });

    it('rejects caller-supplied journal events and rolls back the owner record', async () => {
        const { client } = await openRepository();
        await expect(
            client.request(
                'insertStrategy',
                strategyInput({
                    strategyId: 'strategy-noncanonical-journal',
                    event: {
                        eventId: 'strategy:noncanonical:0',
                        entityKind: 'Strategy',
                        entityId: 'strategy-noncanonical-journal',
                        reasonCode: 'NONCANONICAL_EVENT',
                        receiveEpochMs: 1_786_377_600_800,
                        payloadHash: DIGEST_A,
                        summaryCode: 'noncanonical_event',
                        createdAtEpochMs: 1_786_377_600_800,
                    },
                }),
            ),
        ).rejects.toThrow('caller-supplied journal events are not accepted');
        expect((await client.request('status')).counts).toMatchObject({
            strategies: 0,
            event_journal: 0,
        });
    });

    it('bounds the journal globally and rolls back a transition that cannot journal', async () => {
        const databasePath = await temporaryDatabasePath();
        const expectation = await prepareRepositoryExpectation(databasePath, false);
        const client = await openSmartOrderRepository({
            databasePath,
            ...expectation,
            testOnlyJournalMaxRows: 2,
            testOnlyAllowUnverifiedIdentitySeed: true,
        });
        openClients.add(client);
        await client.request('insertStrategy', strategyInput());
        await client.request('createDraftStrategy', {
            strategyId: 'draft-at-journal-capacity',
            strategyKind: 'trailing_exit',
            nowEpochMs: 1_786_377_600_900,
        });
        await expect(
            client.request(
                'insertStrategy',
                strategyInput({ strategyId: 'must-rollback-at-capacity' }),
            ),
        ).rejects.toThrow('event journal capacity exceeded');
        expect(client.watchdogStatus()).toMatchObject({
            repositoryReady: false,
            blocker: 'repository_fatal_error',
        });
        await client.close();
        openClients.delete(client);

        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(database.prepare('SELECT COUNT(*) AS count FROM event_journal').get()?.count)
            .toBe(2);
        expect(
            database
                .prepare('SELECT COUNT(*) AS count FROM strategies WHERE strategy_id=?')
                .get('must-rollback-at-capacity')?.count,
        ).toBe(0);
        database.close();
    });

    it('retains working and unknown external claims but purges terminal claims one Taipei calendar year after last evidence', async () => {
        const { client, databasePath } = await openRepository();
        const createClaim = (exitClaimId, state) =>
            client.request('createExternalExitClaim', {
                exitClaimId,
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                contractKey: 'TSE:2330:STK:Common',
                positionLineageId: `lineage-${exitClaimId}`,
                remainderGeneration: 0,
                allocationStartShare: 0,
                quantityShares: 1_000,
                state,
                evidenceHash: DIGEST_A,
                nowEpochMs: taipeiEpoch('2024-02-29T10:00:00.000'),
            });
        await createClaim('external-working', 'broker_working');
        await createClaim('external-unknown', 'unknown');
        await createClaim('external-terminal', 'broker_working');
        await client.request('markExternalExitClaimTerminal', {
            exitClaimId: 'external-terminal',
            state: 'released',
            expectedRevision: 0,
            evidenceHash: DIGEST_B,
            nowEpochMs: taipeiEpoch('2024-03-01T10:00:00.000'),
        });

        await expect(
            client.request('purgeEligibleHistory', {
                nowEpochMs: taipeiEpoch('2025-02-28T23:59:59.999'),
            }),
        ).resolves.toMatchObject({
            purgedExternalExitClaimIds: [],
            retainedExternalExitClaims: [
                {
                    exitClaimId: 'external-terminal',
                    reason: 'retention_period_active',
                    eligibleAtEpochMs: taipeiEpoch('2025-03-01T10:00:00.000'),
                },
            ],
        });
        await expect(
            client.request('purgeEligibleHistory', {
                nowEpochMs: taipeiEpoch('2025-03-01T10:00:00.000'),
            }),
        ).resolves.toMatchObject({
            purgedExternalExitClaimIds: ['external-terminal'],
            retainedExternalExitClaims: [],
        });
        expect((await client.request('status')).counts).toMatchObject({
            exit_claims: 2,
            event_journal: 2,
        });
        await client.close();
        openClients.delete(client);

        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database
                .prepare('SELECT exit_claim_id, state FROM exit_claims ORDER BY exit_claim_id')
                .all(),
        ).toEqual([
            { exit_claim_id: 'external-unknown', state: 'unknown' },
            { exit_claim_id: 'external-working', state: 'broker_working' },
        ]);
        database.close();
    });

    it('fails startup on unsupported or partially migrated databases without fallback', async () => {
        const unsupportedPath = await temporaryDatabasePath();
        const unsupported = new DatabaseSync(unsupportedPath);
        unsupported.exec('PRAGMA user_version=999');
        unsupported.close();
        await chmod(unsupportedPath, 0o600);
        const unsupportedExpectation = await prepareRepositoryExpectation(
            unsupportedPath,
            true,
        );
        const unsupportedClient = new SmartOrderRepositoryClient({
            databasePath: unsupportedPath,
            ...unsupportedExpectation,
        });
        openClients.add(unsupportedClient);
        await expect(unsupportedClient.ready()).rejects.toThrow(
            'unsupported repository schema version',
        );
        expect(unsupportedClient.watchdogStatus()).toMatchObject({
            repositoryReady: false,
            blocker: 'startup_error',
        });

        const partialPath = await temporaryDatabasePath();
        const partial = new DatabaseSync(partialPath);
        partial.exec(`
            CREATE TABLE repository_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
            INSERT INTO repository_meta(key, value) VALUES ('schema_id', 'wrong-schema');
        `);
        partial.close();
        await chmod(partialPath, 0o600);
        const partialExpectation = await prepareRepositoryExpectation(partialPath, true);
        const partialClient = new SmartOrderRepositoryClient({
            databasePath: partialPath,
            ...partialExpectation,
        });
        openClients.add(partialClient);
        await expect(partialClient.ready()).rejects.toThrow(
            'unrecognized non-empty schema',
        );
        await partialClient.close();
        openClients.delete(partialClient);

        const reopened = new DatabaseSync(partialPath, { readOnly: true });
        expect(reopened.prepare('PRAGMA user_version').get()?.user_version).toBe(0);
        expect(
            reopened
                .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .all()
                .map((row) => row.name),
        ).toEqual(['repository_meta']);
        expect(
            reopened.prepare("SELECT value FROM repository_meta WHERE key='schema_id'").get()
                ?.value,
        ).toBe('wrong-schema');
        reopened.close();
    });

    it('migrates schema v1 by invalidating legacy gate data without weakening the repository', async () => {
        const databasePath = await temporaryDatabasePath();
        const first = await openRepository({ databasePath });
        await first.client.close();
        openClients.delete(first.client);

        const legacy = new DatabaseSync(databasePath);
        legacy.exec(`
            ${DROP_V9_TABLES_SQL}
            DROP TABLE exposure_account_arbiter_heads;
            DROP TABLE exposure_identity_arbiter_heads;
            DROP TABLE exit_claim_visibility_bindings;
            DROP TABLE external_sell_visibility_heads;
            DROP TABLE intent_rearm_authorizations;
            DROP TABLE broker_correlation_identifiers;
            PRAGMA ignore_check_constraints=ON;
            INSERT INTO event_journal(
                event_id, entity_kind, entity_id, reason_code,
                receive_epoch_ms, local_monotonic_sequence, entity_revision,
                payload_hash, summary_code, created_at_epoch_ms
            ) VALUES (
                'legacy-strategy-event', 'Strategy', 'legacy-strategy',
                'LEGACY_EVENT', 1786377600000, 1, 0,
                '${DIGEST_A}', 'legacy_event', 1786377600000
            );
            PRAGMA ignore_check_constraints=OFF;
            DROP TABLE authority_consumptions;
            DROP TABLE gate_manifests;
            CREATE TABLE gate_manifests (
                manifest_id TEXT PRIMARY KEY NOT NULL,
                manifest_revision TEXT NOT NULL,
                manifest_hash TEXT NOT NULL UNIQUE,
                schema_version TEXT NOT NULL,
                result_hash TEXT NOT NULL,
                build_hash TEXT NOT NULL,
                adapter_hash TEXT NOT NULL,
                capability_fingerprint_hash TEXT NOT NULL,
                route_coverage_hash TEXT NOT NULL,
                pnl_policy_revision TEXT NOT NULL,
                product_boundary_consent_version TEXT NOT NULL,
                state TEXT NOT NULL,
                valid_until_epoch_ms INTEGER NOT NULL,
                created_at_epoch_ms INTEGER NOT NULL,
                invalidated_at_epoch_ms INTEGER,
                revision INTEGER NOT NULL
            ) STRICT;
            INSERT INTO gate_manifests VALUES (
                'legacy-manifest', 'legacy-r1', '${DIGEST_A}', 'legacy/1',
                '${DIGEST_A}', '${DIGEST_A}', '${DIGEST_A}', '${DIGEST_A}',
                '${DIGEST_A}', 'pnl-r0', 'consent-r0', 'eligible',
                1786377900000, 1786377600000, NULL, 0
            );
            UPDATE repository_meta
               SET value='smart-order-sqlite/2026-08-11.1'
             WHERE key='schema_id';
            PRAGMA user_version=1;
        `);
        legacy.close();

        const migrated = await openRepository({ databasePath });
        expect(await migrated.client.request('status')).toMatchObject({
            schemaId: SMART_ORDER_REPOSITORY_SCHEMA_ID,
            schemaVersion: SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
            integrity: 'ok',
            counts: {
                gate_manifests: 0,
                authority_consumptions: 0,
                event_journal: 1,
            },
        });
        await migrated.client.close();
        openClients.delete(migrated.client);
        const migratedDatabase = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            migratedDatabase
                .prepare("SELECT entity_kind FROM event_journal WHERE event_id='legacy-strategy-event'")
                .get()?.entity_kind,
        ).toBe('strategy');
        migratedDatabase.close();
    });

    it('migrates hash-only v3 replay outcomes to fail-closed outcome_unknown records', async () => {
        const databasePath = await temporaryDatabasePath();
        const initialized = await openRepository({ databasePath });
        await initialized.client.close();
        openClients.delete(initialized.client);

        const legacy = new DatabaseSync(databasePath);
        legacy.exec(`
            ${DROP_V9_TABLES_SQL}
            DROP TABLE exposure_account_arbiter_heads;
            DROP TABLE exposure_identity_arbiter_heads;
            DROP TABLE exit_claim_visibility_bindings;
            DROP TABLE external_sell_visibility_heads;
            DROP TABLE intent_rearm_authorizations;
            DROP TABLE broker_correlation_identifiers;
            ALTER TABLE request_replays RENAME TO request_replays_v4;
            CREATE TABLE request_replays (
                request_id TEXT PRIMARY KEY NOT NULL,
                operation_kind TEXT NOT NULL,
                payload_hash TEXT NOT NULL,
                result_hash TEXT,
                state TEXT NOT NULL CHECK (state IN ('reserved', 'completed', 'failed')),
                created_at_epoch_ms INTEGER NOT NULL,
                updated_at_epoch_ms INTEGER NOT NULL,
                UNIQUE(operation_kind, payload_hash, request_id)
            ) STRICT;
            INSERT INTO request_replays VALUES (
                'legacy-completed-request', 'strategy_create', '${DIGEST_A}',
                '${DIGEST_B}', 'completed', 1786377600000, 1786377600001
            );
            DROP TABLE request_replays_v4;
            UPDATE repository_meta
               SET value='smart-order-sqlite/2026-08-11.3'
             WHERE key='schema_id';
            PRAGMA user_version=3;
        `);
        legacy.close();

        const migrated = await openRepository({ databasePath });
        await expect(
            migrated.client.request('reserveRequestReplay', {
                requestId: 'legacy-completed-request',
                operationKind: 'strategy_create',
                payloadHash: DIGEST_A,
                nowEpochMs: 1_786_377_600_002,
            }),
        ).resolves.toEqual({
            requestId: 'legacy-completed-request',
            state: 'outcome_unknown',
            resultHash: DIGEST_B,
            replayed: true,
            mayExecute: false,
        });
    });

    it('migrates a true v4 strategy table with child rows and fail-closes legacy mixed-layer states', async () => {
        const databasePath = await temporaryDatabasePath();
        const currentStrategyCheck = `state TEXT NOT NULL CHECK (state IN (${SMART_ORDER_STRATEGY_STATES.map((state) => `'${state}'`).join(', ')}))`;
        const legacyStrategyCheck =
            "state TEXT NOT NULL CHECK (state IN ('draft', 'observing', 'monitoring', 'armed', 'triggered', 'paused', 'recovery', 'manual_intervention', 'cancel_pending', 'cancelled', 'completed', 'expired', 'expired_with_obligation', 'failed'))";
        const v4Schema = SMART_ORDER_SCHEMA_SQL.replace(
            currentStrategyCheck,
            legacyStrategyCheck,
        );
        expect(v4Schema).not.toBe(SMART_ORDER_SCHEMA_SQL);

        const legacy = new DatabaseSync(databasePath);
        legacy.exec(v4Schema);
        legacy.exec(`
            ${DROP_V9_TABLES_SQL}
            DROP TABLE exposure_account_arbiter_heads;
            DROP TABLE exposure_identity_arbiter_heads;
            DROP TABLE exit_claim_visibility_bindings;
            DROP TABLE external_sell_visibility_heads;
            DROP TABLE intent_rearm_authorizations;
            DROP TABLE broker_correlation_identifiers;
        `);
        legacy
            .prepare('INSERT INTO repository_meta(key, value) VALUES (?, ?)')
            .run('schema_id', 'smart-order-sqlite/2026-08-11.4');
        legacy
            .prepare('INSERT INTO repository_meta(key, value) VALUES (?, ?)')
            .run('journal_local_sequence', '0');
        legacy
            .prepare(`
                INSERT INTO strategies(
                    strategy_id, strategy_kind, state, definition_hash,
                    definition_json, account_broker_ref, account_id_ref,
                    identity_group_id, confirmation_snapshot_hash,
                    created_at_epoch_ms, updated_at_epoch_ms,
                    terminal_at_epoch_ms, revision
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)
            `)
            .run(
                'legacy-armed-strategy',
                'quick',
                'armed',
                DIGEST_A,
                JSON.stringify({ schemaVersion: 'strategy/legacy-v4', kind: 'quick' }),
                'broker-A',
                'account-A',
                'identity-A',
                DIGEST_B,
                1_786_377_600_000,
                1_786_377_600_000,
            );
        legacy
            .prepare(`
                INSERT INTO activations(
                    activation_id, strategy_id, logical_key, state, generation,
                    evidence_hash, created_at_epoch_ms, updated_at_epoch_ms,
                    revision
                ) VALUES (?, ?, ?, 'triggered', 0, ?, ?, ?, 0)
            `)
            .run(
                'legacy-activation',
                'legacy-armed-strategy',
                'edge:legacy',
                DIGEST_A,
                1_786_377_600_000,
                1_786_377_600_000,
            );
        legacy.exec('PRAGMA user_version=4');
        legacy.close();
        await chmod(databasePath, 0o600);

        const migrated = await openRepository({ databasePath });
        await expect(
            migrated.client.request('getStrategy', {
                strategyId: 'legacy-armed-strategy',
            }),
        ).resolves.toMatchObject({
            state: 'recovery',
            revision: 0,
        });
        await expect(migrated.client.request('status')).resolves.toMatchObject({
            schemaVersion: SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
            foreignKeys: 1,
            counts: { strategies: 1, activations: 1 },
        });
        await migrated.client.close();
        openClients.delete(migrated.client);

        const verified = new DatabaseSync(databasePath, { readOnly: true });
        expect(verified.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        verified.close();
    });

    it('transactionally migrates an existing v9 fill head to formal protection columns', async () => {
        const databasePath = await temporaryDatabasePath();
        await seedPartialProtectedEntryFill(databasePath);

        const legacy = new DatabaseSync(databasePath);
        legacy.exec(`
            ${DROP_V15_TABLES_SQL}
            DROP TABLE canonical_pnl_identity_heads;
            DROP TABLE canonical_pnl_account_heads;
            DROP TABLE canonical_pnl_deals;
            DROP TABLE relinquished_unknown_exposures;
            DROP TRIGGER trg_protected_entry_fill_formal_pair_insert;
            DROP TRIGGER trg_protected_entry_fill_formal_pair_update;
            ALTER TABLE protected_entry_fill_heads
                RENAME TO protected_entry_fill_heads_v10;
            CREATE TABLE protected_entry_fill_heads (
                intent_id TEXT PRIMARY KEY NOT NULL REFERENCES order_intents(intent_id),
                commitment_id TEXT NOT NULL UNIQUE
                    REFERENCES pending_protection_commitments(commitment_id),
                obligation_id TEXT NOT NULL UNIQUE
                    REFERENCES protection_obligations(obligation_id),
                exit_claim_id TEXT REFERENCES exit_claims(exit_claim_id),
                protection_plan_hash TEXT NOT NULL,
                atr_snapshot_hash TEXT,
                cumulative_filled_shares INTEGER NOT NULL
                    CHECK (cumulative_filled_shares >= 0),
                remaining_entry_shares INTEGER NOT NULL
                    CHECK (remaining_entry_shares >= 0),
                fill_notional_minor_units INTEGER NOT NULL
                    CHECK (fill_notional_minor_units >= 0),
                weighted_average_numerator_minor_units INTEGER NOT NULL
                    CHECK (weighted_average_numerator_minor_units >= 0),
                weighted_average_denominator_shares INTEGER NOT NULL
                    CHECK (weighted_average_denominator_shares >= 0),
                position_lineage_id TEXT NOT NULL,
                position_quantity_shares INTEGER NOT NULL
                    CHECK (position_quantity_shares >= 0),
                deal_set_hash TEXT NOT NULL,
                reconciliation_snapshot_hash TEXT NOT NULL,
                reconciliation_evidence_hash TEXT NOT NULL,
                reconciliation_source_revision TEXT NOT NULL,
                reconciliation_as_of_epoch_ms INTEGER NOT NULL
                    CHECK (reconciliation_as_of_epoch_ms >= 0),
                state TEXT NOT NULL CHECK (state IN ('partial', 'final', 'zero_fill')),
                created_at_epoch_ms INTEGER NOT NULL,
                updated_at_epoch_ms INTEGER NOT NULL,
                revision INTEGER NOT NULL CHECK (revision >= 0)
            ) STRICT;
            INSERT INTO protected_entry_fill_heads(
                intent_id, commitment_id, obligation_id, exit_claim_id,
                protection_plan_hash, atr_snapshot_hash,
                cumulative_filled_shares, remaining_entry_shares,
                fill_notional_minor_units,
                weighted_average_numerator_minor_units,
                weighted_average_denominator_shares,
                position_lineage_id, position_quantity_shares,
                deal_set_hash, reconciliation_snapshot_hash,
                reconciliation_evidence_hash,
                reconciliation_source_revision,
                reconciliation_as_of_epoch_ms, state,
                created_at_epoch_ms, updated_at_epoch_ms, revision
            )
            SELECT intent_id, commitment_id, obligation_id, exit_claim_id,
                   protection_plan_hash, atr_snapshot_hash,
                   cumulative_filled_shares, remaining_entry_shares,
                   fill_notional_minor_units,
                   weighted_average_numerator_minor_units,
                   weighted_average_denominator_shares,
                   position_lineage_id, position_quantity_shares,
                   deal_set_hash, reconciliation_snapshot_hash,
                   reconciliation_evidence_hash,
                   reconciliation_source_revision,
                   reconciliation_as_of_epoch_ms, state,
                   created_at_epoch_ms, updated_at_epoch_ms, revision
              FROM protected_entry_fill_heads_v10;
            DROP TABLE protected_entry_fill_heads_v10;
            UPDATE repository_meta
               SET value='smart-order-sqlite/2026-08-13.9'
             WHERE key='schema_id';
            PRAGMA user_version=9;
        `);
        legacy.close();

        const migrated = await openRepository({ databasePath });
        await expect(migrated.client.request('status')).resolves.toMatchObject({
            schemaId: SMART_ORDER_REPOSITORY_SCHEMA_ID,
            schemaVersion: SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
            integrity: 'ok',
        });
        await expect(
            migrated.client.request('materializeProtectedEntryFill', {
                runtimeEpochId: 'protected-entry-setup-runtime',
                senderFence: 'protected-entry-setup-fence',
                apiGeneration: 'simulation-generation/1',
                intentId: 'intent-1',
                nowEpochMs: 1_786_377_600_600,
                reconciliation: protectedEntryReconciliation(),
            }),
        ).resolves.toMatchObject({
            state: 'partial',
            cumulativeFilledShares: 200,
            replayed: true,
            brokerWriteAuthority: false,
        });
        await migrated.client.close();
        openClients.delete(migrated.client);

        const verified = new DatabaseSync(databasePath);
        expect(verified.prepare('PRAGMA user_version').get()?.user_version).toBe(
            SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
        );
        expect(
            verified
                .prepare('PRAGMA table_info(protected_entry_fill_heads)')
                .all()
                .map((column) => column.name),
        ).toEqual(
            expect.arrayContaining([
                'formal_protection_json',
                'formal_protection_hash',
            ]),
        );
        expect(
            verified
                .prepare(`
                    SELECT name FROM sqlite_master
                     WHERE type='table'
                       AND name='relinquished_unknown_exposures'
                `)
                .get(),
        ).toEqual({ name: 'relinquished_unknown_exposures' });
        expect(
            verified
                .prepare(`
                    SELECT name FROM sqlite_master
                     WHERE type='trigger'
                       AND name LIKE 'trg_protected_entry_fill_formal_pair_%'
                     ORDER BY name
                `)
                .all()
                .map((row) => row.name),
        ).toEqual([
            'trg_protected_entry_fill_formal_pair_insert',
            'trg_protected_entry_fill_formal_pair_update',
        ]);
        expect(
            verified
                .prepare(`
                    SELECT cumulative_filled_shares,
                           formal_protection_json, formal_protection_hash
                      FROM protected_entry_fill_heads
                     WHERE intent_id='intent-1'
                `)
                .get(),
        ).toMatchObject({
            cumulative_filled_shares: 200,
            formal_protection_json: expect.stringContaining(
                'smart-order-formal-protection/2026-08-13.2',
            ),
            formal_protection_hash: expect.stringMatching(
                /^sha256:[0-9a-f]{64}$/,
            ),
        });
        expect(() =>
            verified
                .prepare(`
                    UPDATE protected_entry_fill_heads
                       SET formal_protection_hash=NULL
                     WHERE intent_id='intent-1'
                `)
                .run(),
        ).toThrow('formal protection projection must be paired');
        verified.close();
    });

    it('transactionally migrates a v11 repository into empty fail-closed canonical PnL heads', async () => {
        const databasePath = await temporaryDatabasePath();
        const initialized = await openRepository({ databasePath });
        await initialized.client.close();
        openClients.delete(initialized.client);

        const legacy = new DatabaseSync(databasePath);
        legacy.exec(`
            ${DROP_V15_TABLES_SQL}
            DROP TABLE canonical_pnl_identity_heads;
            DROP TABLE canonical_pnl_account_heads;
            DROP TABLE canonical_pnl_deals;
            DROP TABLE exposure_account_arbiter_heads;
            DROP TABLE exposure_identity_arbiter_heads;
            ${SMART_ORDER_SCHEMA_V6_TO_V7_SQL}
            UPDATE repository_meta
               SET value='smart-order-sqlite/2026-08-13.11'
             WHERE key='schema_id';
            PRAGMA user_version=11;
        `);
        legacy.close();

        const migrated = await openRepository({ databasePath });
        await expect(migrated.client.request('status')).resolves.toMatchObject({
            schemaId: SMART_ORDER_REPOSITORY_SCHEMA_ID,
            schemaVersion: SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
            integrity: 'ok',
        });
        await migrated.client.close();
        openClients.delete(migrated.client);

        const verified = new DatabaseSync(databasePath, { readOnly: true });
        expect(verified.prepare('PRAGMA user_version').get()?.user_version).toBe(
            SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
        );
        expect(
            verified
                .prepare(`
                    SELECT name FROM sqlite_master
                     WHERE type='table' AND name LIKE 'canonical_pnl_%'
                     ORDER BY name
                `)
                .all(),
        ).toEqual([
            { name: 'canonical_pnl_account_heads' },
            { name: 'canonical_pnl_deals' },
            { name: 'canonical_pnl_identity_heads' },
        ]);
        expect(
            verified
                .prepare('SELECT COUNT(*) AS count FROM canonical_pnl_account_heads')
                .get(),
        ).toEqual({ count: 0 });
        expect(
            verified
                .prepare('SELECT COUNT(*) AS count FROM canonical_pnl_identity_heads')
                .get(),
        ).toEqual({ count: 0 });
        for (const table of [
            'exposure_account_arbiter_heads',
            'exposure_identity_arbiter_heads',
        ]) {
            expect(
                verified
                    .prepare(`PRAGMA table_info(${table})`)
                    .all()
                    .map((row) => row.name),
            ).toContain('daily_loss_limit_minor_units');
        }
        verified.close();
    });

    it('transactionally migrates v12 into an empty policy and invalidated exposure baselines', async () => {
        const databasePath = await temporaryDatabasePath();
        const initialized = await openRepository({ databasePath });
        await initialized.client.close();
        openClients.delete(initialized.client);

        const legacy = new DatabaseSync(databasePath);
        legacy.exec(`
            ${DROP_V15_TABLES_SQL}
            DROP TABLE runtime_risk_policies;
            ALTER TABLE account_reconciliation_heads
                DROP COLUMN exposure_baseline_quantity_shares;
            ALTER TABLE account_reconciliation_heads
                DROP COLUMN exposure_baseline_notional_minor_units;
            ALTER TABLE account_reconciliation_heads
                DROP COLUMN exposure_baseline_cash_minor_units;
            ALTER TABLE account_reconciliation_heads
                DROP COLUMN exposure_baseline_position_shares;
            ALTER TABLE account_reconciliation_heads
                DROP COLUMN exposure_baseline_order_count;
            ALTER TABLE account_reconciliation_heads
                DROP COLUMN exposure_baseline_valuation_complete;
            UPDATE repository_meta
               SET value='smart-order-sqlite/2026-08-13.12'
             WHERE key='schema_id';
            PRAGMA user_version=12;
        `);
        legacy.close();

        const migrated = await openRepository({
            databasePath,
            testOnlyExposureArbiterHeads: undefined,
        });
        await expect(migrated.client.request('status')).resolves.toMatchObject({
            schemaId: SMART_ORDER_REPOSITORY_SCHEMA_ID,
            schemaVersion: SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
            counts: {
                runtime_risk_policies: 0,
                exposure_account_arbiter_heads: 0,
                exposure_identity_arbiter_heads: 0,
            },
        });
        await migrated.client.close();
        openClients.delete(migrated.client);

        const verified = new DatabaseSync(databasePath, { readOnly: true });
        expect(verified.prepare('PRAGMA user_version').get()?.user_version).toBe(
            SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
        );
        expect(
            verified
                .prepare('PRAGMA table_info(account_reconciliation_heads)')
                .all()
                .map((row) => row.name),
        ).toEqual(
            expect.arrayContaining([
                'exposure_baseline_quantity_shares',
                'exposure_baseline_notional_minor_units',
                'exposure_baseline_cash_minor_units',
                'exposure_baseline_position_shares',
                'exposure_baseline_order_count',
                'exposure_baseline_valuation_complete',
            ]),
        );
        verified.close();
    });

    it('transactionally migrates v13 exposure reservations into the canonical monotonic state set', async () => {
        const databasePath = await temporaryDatabasePath();
        const initialized = await openRepository({ databasePath });
        await insertPreparedIntent(initialized.client);
        await initialized.client.close();
        openClients.delete(initialized.client);

        const legacy = new DatabaseSync(databasePath);
        legacy.exec(`
            ${DROP_V15_TABLES_SQL}
            DROP TABLE entry_exposure_reservations;
            CREATE TABLE entry_exposure_reservations (
                reservation_id TEXT PRIMARY KEY NOT NULL,
                strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id),
                intent_id TEXT REFERENCES order_intents(intent_id),
                account_broker_ref TEXT NOT NULL,
                account_id_ref TEXT NOT NULL,
                identity_group_id TEXT NOT NULL,
                policy_revision TEXT NOT NULL,
                policy_hash TEXT NOT NULL,
                state TEXT NOT NULL CHECK (state IN (
                    'reserved', 'dispatching', 'working', 'unknown',
                    'consumed', 'released'
                )),
                quantity_shares INTEGER NOT NULL CHECK (quantity_shares >= 0),
                notional_minor_units INTEGER NOT NULL
                    CHECK (notional_minor_units >= 0),
                cash_minor_units INTEGER NOT NULL CHECK (cash_minor_units >= 0),
                position_shares INTEGER NOT NULL CHECK (position_shares >= 0),
                order_count INTEGER NOT NULL CHECK (order_count >= 0),
                created_at_epoch_ms INTEGER NOT NULL,
                updated_at_epoch_ms INTEGER NOT NULL,
                terminal_at_epoch_ms INTEGER,
                revision INTEGER NOT NULL CHECK (revision >= 0)
            ) STRICT;
            INSERT INTO entry_exposure_reservations VALUES (
                'legacy-dispatching', 'strategy-1', 'intent-1',
                'broker-A', 'account-A', 'identity-A', 'risk-policy/1',
                '${TEST_PROTECTED_ENTRY_RISK_POLICY_HASH}', 'dispatching',
                1000, 10000000, 10000000, 1000, 1,
                1786377600100, 1786377600200, NULL, 1
            );
            INSERT INTO entry_exposure_reservations VALUES (
                'legacy-working', 'strategy-1', NULL,
                'broker-A', 'account-A', 'identity-A', 'risk-policy/1',
                '${TEST_PROTECTED_ENTRY_RISK_POLICY_HASH}', 'working',
                800, 8000000, 8000000, 800, 1,
                1786377600100, 1786377600300, NULL, 2
            );
            UPDATE repository_meta
               SET value='smart-order-sqlite/2026-08-14.13'
             WHERE key='schema_id';
            PRAGMA user_version=13;
        `);
        legacy.close();

        const migrated = await openRepository({ databasePath });
        await expect(migrated.client.request('status')).resolves.toMatchObject({
            schemaId: SMART_ORDER_REPOSITORY_SCHEMA_ID,
            schemaVersion: SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
            integrity: 'ok',
        });
        await migrated.client.close();
        openClients.delete(migrated.client);

        const verified = new DatabaseSync(databasePath);
        expect(
            verified.prepare(`
                SELECT reservation_id, state, quantity_shares, revision
                  FROM entry_exposure_reservations
                 ORDER BY reservation_id
            `).all(),
        ).toEqual([
            {
                reservation_id: 'legacy-dispatching',
                state: 'reserved',
                quantity_shares: 1_000,
                revision: 1,
            },
            {
                reservation_id: 'legacy-working',
                state: 'partially_consumed',
                quantity_shares: 800,
                revision: 2,
            },
        ]);
        expect(() =>
            verified.prepare(`
                INSERT INTO entry_exposure_reservations(
                    reservation_id, strategy_id, intent_id,
                    account_broker_ref, account_id_ref, identity_group_id,
                    policy_revision, policy_hash, state, quantity_shares,
                    notional_minor_units, cash_minor_units, position_shares,
                    order_count, created_at_epoch_ms, updated_at_epoch_ms,
                    revision
                ) VALUES (
                    'invalid-working', 'strategy-1', NULL, 'broker-A',
                    'account-A', 'identity-A', 'risk-policy/1', ?, 'working',
                    1, 1, 1, 1, 1, 1786377600400, 1786377600400, 0
                )
            `).run(TEST_PROTECTED_ENTRY_RISK_POLICY_HASH),
        ).toThrow();
        expect(verified.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        verified.close();
    });

    it('transactionally migrates a v14 monitoring ExitClaim into one protection group and remainder generation', async () => {
        const databasePath = await createMonitoringExitClaimFixture();
        const legacy = new DatabaseSync(databasePath);
        legacy.exec(`
            ${DROP_V15_TABLES_SQL}
            UPDATE repository_meta
               SET value='smart-order-sqlite/2026-08-15.14'
             WHERE key='schema_id';
            PRAGMA user_version=14;
        `);
        legacy.close();

        const migrated = await openRepository({ databasePath });
        await expect(migrated.client.request('status')).resolves.toMatchObject({
            schemaId: SMART_ORDER_REPOSITORY_SCHEMA_ID,
            schemaVersion: SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
            integrity: 'ok',
        });
        await migrated.client.close();
        openClients.delete(migrated.client);

        const verified = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verified.prepare(`
                SELECT groups.protection_group_id, groups.exit_claim_id,
                       groups.state AS group_state, groups.current_generation,
                       groups.plan_hash, groups.revision AS group_revision,
                       generations.state AS generation_state,
                       generations.quantity_shares,
                       generations.winner_leg_id,
                       generations.winner_intent_id,
                       generations.revision AS generation_revision
                  FROM protection_groups AS groups
                  JOIN protection_remainder_generations AS generations
                    ON generations.protection_group_id=groups.protection_group_id
                   AND generations.remainder_generation=groups.current_generation
                 WHERE groups.exit_claim_id='visibility-internal-claim'
            `).get(),
        ).toEqual({
            protection_group_id: VISIBILITY_PROTECTION_GROUP_ID,
            exit_claim_id: 'visibility-internal-claim',
            group_state: 'monitoring',
            current_generation: 0,
            plan_hash: protectedEntryProjection().payload.protectionPlanSha256,
            group_revision: 0,
            generation_state: 'monitoring',
            quantity_shares: 1_000,
            winner_leg_id: null,
            winner_intent_id: null,
            generation_revision: 0,
        });
        expect(verified.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        verified.close();
    });

    it('fail-closes v15 protected strategies and active re-arms without a canonical confirmation snapshot', async () => {
        const initialized = await openRepository();
        await startReadyRuntime(initialized.client);
        await initialized.client.request(
            'insertStrategy',
            strategyInput({
                strategyKind: 'stop_take',
                definition: {
                    schemaVersion: 'strategy/legacy-protection-v15',
                    kind: 'stop_take',
                },
            }),
        );
        await initialized.client.request(
            'prepareIntent',
            preparedIntentInput(),
        );
        await initialized.client.close();
        openClients.delete(initialized.client);

        const legacy = new DatabaseSync(initialized.databasePath);
        legacy.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');
        try {
            legacy.prepare(`
                UPDATE order_intents SET revision=1
                 WHERE intent_id='intent-1' AND state='prepared' AND revision=0
            `).run();
            legacy.prepare(`
                INSERT INTO intent_rearm_authorizations(
                    rearm_authorization_id, intent_id, runtime_epoch_id,
                    sender_fence, api_generation, rearm_request_id,
                    authorized_intent_revision, confirmation_snapshot_hash,
                    risk_revision, reconciliation_evidence_hash,
                    user_rearm_evidence_hash, state, authorized_at_epoch_ms,
                    revision
                ) VALUES (
                    'legacy-v15-rearm', 'intent-1', 'runtime-epoch-1',
                    'sender-fence-1', 'api-generation-1',
                    'legacy-v15-rearm-request', 1, ?, 'risk-revision-1',
                    ?, ?, 'active', 1786377600175, 0
                )
            `).run(DIGEST_B, DIGEST_B, DIGEST_A);
            legacy.exec(`
                DROP TABLE canonical_confirmation_snapshots;
                UPDATE repository_meta
                   SET value='smart-order-sqlite/2026-08-15.15'
                 WHERE key='schema_id';
                PRAGMA user_version=15;
                COMMIT;
            `);
        } catch (error) {
            legacy.exec('ROLLBACK');
            legacy.close();
            throw error;
        }
        legacy.close();

        const migrated = await openRepository({
            databasePath: initialized.databasePath,
        });
        await expect(migrated.client.request('status')).resolves.toMatchObject({
            schemaVersion: SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
            integrity: 'ok',
        });
        await migrated.client.close();
        openClients.delete(migrated.client);

        const verified = new DatabaseSync(initialized.databasePath, {
            readOnly: true,
        });
        expect(
            verified.prepare(`
                SELECT strategy_kind, state, revision FROM strategies
                 WHERE strategy_id='strategy-1'
            `).get(),
        ).toEqual({
            strategy_kind: 'stop_take',
            state: 'manual_intervention',
            revision: 1,
        });
        expect(
            verified.prepare(`
                SELECT state, revision FROM intent_rearm_authorizations
                 WHERE rearm_authorization_id='legacy-v15-rearm'
            `).get(),
        ).toEqual({ state: 'superseded', revision: 1 });
        expect(
            verified.prepare(`
                SELECT COUNT(*) AS count FROM canonical_confirmation_snapshots
            `).get(),
        ).toEqual({ count: 0 });
        verified.close();
    });

    it('transactionally migrates v16 into an empty durable protection trigger head table', async () => {
        const initialized = await openRepository();
        await initialized.client.close();
        openClients.delete(initialized.client);

        const legacy = new DatabaseSync(initialized.databasePath);
        legacy.exec(`
            DROP TABLE protection_trigger_heads;
            UPDATE repository_meta
               SET value='smart-order-sqlite/2026-08-20.16'
             WHERE key='schema_id';
            PRAGMA user_version=16;
        `);
        legacy.close();

        const migrated = await openRepository({
            databasePath: initialized.databasePath,
        });
        await expect(migrated.client.request('status')).resolves.toMatchObject({
            schemaId: SMART_ORDER_REPOSITORY_SCHEMA_ID,
            schemaVersion: SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
            integrity: 'ok',
        });
        await migrated.client.close();
        openClients.delete(migrated.client);

        const verified = new DatabaseSync(initialized.databasePath, {
            readOnly: true,
        });
        expect(
            verified.prepare(`
                SELECT name FROM sqlite_master
                 WHERE type='table' AND name='protection_trigger_heads'
            `).get(),
        ).toEqual({ name: 'protection_trigger_heads' });
        expect(
            verified.prepare('SELECT COUNT(*) AS count FROM protection_trigger_heads').get(),
        ).toEqual({ count: 0 });
        expect(
            verified.prepare(`
                SELECT name FROM pragma_table_info('protection_trigger_heads')
                 WHERE name IN (
                    'retracement_trigger_decimal', 'triggered_leg_id'
                 )
                 ORDER BY name
            `).all(),
        ).toEqual([
            { name: 'retracement_trigger_decimal' },
            { name: 'triggered_leg_id' },
        ]);
        expect(verified.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        verified.close();
    });

    it('transactionally migrates v17 into an empty durable quick condition head table', async () => {
        const initialized = await openRepository();
        await initialized.client.close();
        openClients.delete(initialized.client);

        const legacy = new DatabaseSync(initialized.databasePath);
        legacy.exec(`
            DROP TABLE quick_condition_heads;
            UPDATE repository_meta
               SET value='smart-order-sqlite/2026-08-20.17'
             WHERE key='schema_id';
            PRAGMA user_version=17;
        `);
        legacy.close();

        const migrated = await openRepository({
            databasePath: initialized.databasePath,
        });
        await expect(migrated.client.request('status')).resolves.toMatchObject({
            schemaId: SMART_ORDER_REPOSITORY_SCHEMA_ID,
            schemaVersion: SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
            integrity: 'ok',
        });
        await migrated.client.close();
        openClients.delete(migrated.client);

        const verified = new DatabaseSync(initialized.databasePath, {
            readOnly: true,
        });
        expect(
            verified.prepare(`
                SELECT name FROM sqlite_master
                 WHERE type='table' AND name='quick_condition_heads'
            `).get(),
        ).toEqual({ name: 'quick_condition_heads' });
        expect(
            verified.prepare(
                'SELECT COUNT(*) AS count FROM quick_condition_heads',
            ).get(),
        ).toEqual({ count: 0 });
        expect(verified.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        verified.close();
    });

    it('transactionally migrates v18 into the existing-position protection head table', async () => {
        const initialized = await openRepository();
        await initialized.client.close();
        openClients.delete(initialized.client);

        const legacy = new DatabaseSync(initialized.databasePath);
        legacy.exec(`
            DROP TABLE existing_position_protection_heads;
            UPDATE repository_meta
               SET value='smart-order-sqlite/2026-08-21.18'
             WHERE key='schema_id';
            PRAGMA user_version=18;
        `);
        legacy.close();

        const migrated = await openRepository({
            databasePath: initialized.databasePath,
        });
        await expect(migrated.client.request('status')).resolves.toMatchObject({
            schemaId: SMART_ORDER_REPOSITORY_SCHEMA_ID,
            schemaVersion: SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
            integrity: 'ok',
        });
        await migrated.client.close();
        openClients.delete(migrated.client);

        const verified = new DatabaseSync(initialized.databasePath, {
            readOnly: true,
        });
        expect(
            verified.prepare(`
                SELECT name FROM sqlite_master
                 WHERE type='table'
                   AND name='existing_position_protection_heads'
            `).get(),
        ).toEqual({ name: 'existing_position_protection_heads' });
        expect(
            verified.prepare(`
                SELECT name FROM pragma_table_info(
                    'existing_position_protection_heads'
                )
                 WHERE name IN (
                    'protection_plan_json', 'formal_protection_json',
                    'reconciliation_evidence_hash'
                 )
                 ORDER BY name
            `).all(),
        ).toEqual([
            { name: 'formal_protection_json' },
            { name: 'protection_plan_json' },
            { name: 'reconciliation_evidence_hash' },
        ]);
        expect(verified.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        verified.close();
    });

    it('transactionally migrates v19 into durable good-till progress and daily condition heads', async () => {
        const initialized = await openRepository();
        await initialized.client.close();
        openClients.delete(initialized.client);

        const legacy = new DatabaseSync(initialized.databasePath);
        legacy.exec(`
            DROP TABLE good_till_condition_heads;
            DROP TABLE good_till_progress_heads;
            UPDATE repository_meta
               SET value='smart-order-sqlite/2026-08-21.19'
             WHERE key='schema_id';
            PRAGMA user_version=19;
        `);
        legacy.close();

        const migrated = await openRepository({
            databasePath: initialized.databasePath,
        });
        await expect(migrated.client.request('status')).resolves.toMatchObject({
            schemaId: SMART_ORDER_REPOSITORY_SCHEMA_ID,
            schemaVersion: SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
            integrity: 'ok',
        });
        await migrated.client.close();
        openClients.delete(migrated.client);

        const verified = new DatabaseSync(initialized.databasePath, {
            readOnly: true,
        });
        expect(
            verified.prepare(`
                SELECT name FROM sqlite_master
                 WHERE type='table'
                   AND name IN (
                       'good_till_condition_heads',
                       'good_till_progress_heads'
                   )
                 ORDER BY name
            `).all(),
        ).toEqual([
            { name: 'good_till_condition_heads' },
            { name: 'good_till_progress_heads' },
        ]);
        expect(verified.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        verified.close();
    });

    it('transactionally migrates v20 into durable multi-condition group and leg heads', async () => {
        const initialized = await openRepository();
        await initialized.client.close();
        openClients.delete(initialized.client);

        const legacy = new DatabaseSync(initialized.databasePath);
        legacy.exec(`
            DROP TABLE multi_condition_leg_heads;
            DROP TABLE multi_condition_group_heads;
            UPDATE repository_meta
               SET value='smart-order-sqlite/2026-08-21.20'
             WHERE key='schema_id';
            PRAGMA user_version=20;
        `);
        legacy.close();

        const migrated = await openRepository({
            databasePath: initialized.databasePath,
        });
        await expect(migrated.client.request('status')).resolves.toMatchObject({
            schemaId: SMART_ORDER_REPOSITORY_SCHEMA_ID,
            schemaVersion: SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
            integrity: 'ok',
        });
        await migrated.client.close();
        openClients.delete(migrated.client);

        const verified = new DatabaseSync(initialized.databasePath, {
            readOnly: true,
        });
        expect(
            verified.prepare(`
                SELECT name FROM sqlite_master
                 WHERE type='table'
                   AND name IN (
                       'multi_condition_group_heads',
                       'multi_condition_leg_heads'
                   )
                 ORDER BY name
            `).all(),
        ).toEqual([
            { name: 'multi_condition_group_heads' },
            { name: 'multi_condition_leg_heads' },
        ]);
        expect(verified.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        verified.close();
    });

    it('transactionally migrates v21 into durable parent-child progress and condition heads', async () => {
        const initialized = await openRepository();
        await initialized.client.close();
        openClients.delete(initialized.client);

        const legacy = new DatabaseSync(initialized.databasePath);
        legacy.exec(`
            DROP TABLE parent_child_condition_heads;
            DROP TABLE parent_child_progress_heads;
            UPDATE repository_meta
               SET value='smart-order-sqlite/2026-08-21.21'
             WHERE key='schema_id';
            PRAGMA user_version=21;
        `);
        legacy.close();

        const migrated = await openRepository({
            databasePath: initialized.databasePath,
        });
        await expect(migrated.client.request('status')).resolves.toMatchObject({
            schemaId: SMART_ORDER_REPOSITORY_SCHEMA_ID,
            schemaVersion: SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
            integrity: 'ok',
        });
        await migrated.client.close();
        openClients.delete(migrated.client);

        const verified = new DatabaseSync(initialized.databasePath, {
            readOnly: true,
        });
        expect(
            verified.prepare(`
                SELECT name FROM sqlite_master
                 WHERE type='table'
                   AND name IN (
                       'parent_child_condition_heads',
                       'parent_child_progress_heads'
                   )
                 ORDER BY name
            `).all(),
        ).toEqual([
            { name: 'parent_child_condition_heads' },
            { name: 'parent_child_progress_heads' },
        ]);
        expect(verified.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        verified.close();
    });

    it('fails closed instead of migrating a legacy identifier claimed by two correlations', async () => {
        const databasePath = await temporaryDatabasePath();
        const initialized = await openRepository({ databasePath });
        await insertPreparedIntent(initialized.client);
        await initialized.client.close();
        openClients.delete(initialized.client);

        const legacy = new DatabaseSync(databasePath);
        legacy.exec(`
            ${DROP_V9_TABLES_SQL}
            DROP TABLE exposure_account_arbiter_heads;
            DROP TABLE exposure_identity_arbiter_heads;
            DROP TABLE exit_claim_visibility_bindings;
            DROP TABLE external_sell_visibility_heads;
            DROP TABLE intent_rearm_authorizations;
            DROP TABLE broker_correlation_identifiers;
        `);
        const insertLegacyCorrelation = legacy.prepare(`
            INSERT INTO broker_correlations(
                correlation_id, intent_id, broker_order_id,
                canonical_key_hash, account_broker_ref, account_id_ref,
                trade_date, contract_key, side, trade_id, order_id,
                deal_id, seqno, ordno, exchange_sequence, custom_field,
                evidence_hash, created_at_epoch_ms, revision
            ) VALUES (?, 'intent-1', NULL, ?, 'broker-A', 'account-A',
                      '2026-08-11', 'TSE:2330:STK:Common', 'Buy', NULL, ?,
                      NULL, ?, NULL, NULL, NULL, ?, 1786377600400, 0)
        `);
        insertLegacyCorrelation.run(
            'legacy-correlation-a',
            DIGEST_A,
            'legacy-overlapping-order',
            'legacy-seq-a',
            DIGEST_A,
        );
        insertLegacyCorrelation.run(
            'legacy-correlation-b',
            DIGEST_B,
            'legacy-overlapping-order',
            'legacy-seq-b',
            DIGEST_B,
        );
        legacy
            .prepare("UPDATE repository_meta SET value=? WHERE key='schema_id'")
            .run('smart-order-sqlite/2026-08-11.5');
        legacy.exec('PRAGMA user_version=5');
        legacy.close();

        const expectation = await prepareRepositoryExpectation(databasePath, true);
        const migrating = new SmartOrderRepositoryClient({
            databasePath,
            ...expectation,
        });
        openClients.add(migrating);
        await expect(migrating.ready()).rejects.toThrow(
            'legacy broker correlation identifiers bind multiple correlations',
        );
        await migrating.close();
        openClients.delete(migrating);

        const unchanged = new DatabaseSync(databasePath, { readOnly: true });
        expect(unchanged.prepare('PRAGMA user_version').get()?.user_version).toBe(5);
        expect(
            unchanged
                .prepare("SELECT name FROM sqlite_master WHERE name='broker_correlation_identifiers'")
                .get(),
        ).toBeUndefined();
        unchanged.close();
    });

    it('rolls back every schema rewrite when migration fails mid-transaction', async () => {
        const databasePath = await temporaryDatabasePath();
        const initialized = await openRepository({ databasePath });
        await initialized.client.close();
        openClients.delete(initialized.client);

        const legacy = new DatabaseSync(databasePath);
        legacy.exec(`
            ${DROP_V9_TABLES_SQL}
            DROP TABLE exposure_account_arbiter_heads;
            DROP TABLE exposure_identity_arbiter_heads;
            DROP TABLE exit_claim_visibility_bindings;
            DROP TABLE external_sell_visibility_heads;
            DROP TABLE intent_rearm_authorizations;
            DROP TABLE broker_correlation_identifiers;
            UPDATE repository_meta
               SET value='smart-order-sqlite/2026-08-11.2'
             WHERE key='schema_id';
            PRAGMA user_version=2;
        `);
        legacy.close();
        const expectation = await prepareRepositoryExpectation(databasePath, true);
        const failing = new SmartOrderRepositoryClient({
            databasePath,
            ...expectation,
            testOnlyFailMigrationAfterSchemaRewrite: true,
        });
        openClients.add(failing);
        await expect(failing.ready()).rejects.toThrow(
            'test migration failure after schema rewrite',
        );
        await failing.close();
        openClients.delete(failing);

        const rolledBack = new DatabaseSync(databasePath, { readOnly: true });
        expect(rolledBack.prepare('PRAGMA user_version').get()?.user_version).toBe(2);
        expect(
            rolledBack.prepare("SELECT value FROM repository_meta WHERE key='schema_id'").get()
                ?.value,
        ).toBe('smart-order-sqlite/2026-08-11.2');
        expect(
            rolledBack
                .prepare(`
                    SELECT name FROM sqlite_master
                     WHERE name IN ('exit_claims_v2','event_journal_v2')
                     ORDER BY name
                `)
                .all(),
        ).toEqual([]);
        rolledBack.close();

        const recovered = await openRepository({ databasePath });
        await expect(recovered.client.request('status')).resolves.toMatchObject({
            schemaId: SMART_ORDER_REPOSITORY_SCHEMA_ID,
            schemaVersion: SMART_ORDER_REPOSITORY_SCHEMA_VERSION,
            integrity: 'ok',
        });
    });

    it('rejects corrupt files and shuts down without leaving a usable client', async () => {
        const databasePath = await temporaryDatabasePath();
        await writeFile(databasePath, Buffer.from('not a sqlite database'), { mode: 0o600 });
        const expectation = await prepareRepositoryExpectation(databasePath, true);
        const client = new SmartOrderRepositoryClient({
            databasePath,
            ...expectation,
        });
        openClients.add(client);
        await expect(client.ready()).rejects.toThrow();
        expect(client.watchdogStatus().repositoryReady).toBe(false);
        await client.close();
        openClients.delete(client);
        await expect(client.request('status')).rejects.toThrow('closed');
        await expect(client.close()).resolves.toBeUndefined();
    });

    it('refuses to recreate an expected repository that has gone missing', async () => {
        const databasePath = await temporaryDatabasePath();
        const initialized = await openRepository({ databasePath });
        await initialized.client.close();
        openClients.delete(initialized.client);
        await unlink(databasePath);

        const expectation = await prepareRepositoryExpectation(databasePath, true);
        const client = new SmartOrderRepositoryClient({
            databasePath,
            ...expectation,
        });
        openClients.add(client);
        await expect(client.ready()).rejects.toThrow('expected repository is missing');
        await expect(lstat(databasePath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('refuses to fresh-initialize an expected repository replaced by an empty SQLite file', async () => {
        const databasePath = await temporaryDatabasePath();
        const initialized = await openRepository({ databasePath });
        await initialized.client.close();
        openClients.delete(initialized.client);
        await unlink(databasePath);
        const replacement = new DatabaseSync(databasePath);
        replacement.close();
        await chmod(databasePath, 0o600);

        const expectation = await prepareRepositoryExpectation(databasePath, true);
        const client = new SmartOrderRepositoryClient({
            databasePath,
            ...expectation,
        });
        openClients.add(client);
        await expect(client.ready()).rejects.toThrow(
            'expected repository schema is missing',
        );
    });

    it('fails closed for an existing owner-readonly database without changing its mode', async () => {
        const databasePath = await temporaryDatabasePath();
        const initialized = await openRepository({ databasePath });
        await initialized.client.close();
        openClients.delete(initialized.client);
        await chmod(databasePath, 0o400);

        const expectation = await prepareRepositoryExpectation(databasePath, true);
        const client = new SmartOrderRepositoryClient({
            databasePath,
            ...expectation,
        });
        openClients.add(client);
        await expect(client.ready()).rejects.toThrow('exact 0600 permissions');
        expect(permissionBits((await stat(databasePath)).mode)).toBe(0o400);
    });

    it('fails closed when the repository filesystem directory is truly read-only', async () => {
        const databasePath = await temporaryDatabasePath();
        const initialized = await openRepository({ databasePath });
        await initialized.client.close();
        openClients.delete(initialized.client);
        await rm(`${databasePath}-wal`, { force: true });
        await rm(`${databasePath}-shm`, { force: true });
        const databaseDirectory = path.dirname(databasePath);
        await chmod(databaseDirectory, 0o500);

        const expectation = await prepareRepositoryExpectation(databasePath, true);
        const client = new SmartOrderRepositoryClient({
            databasePath,
            ...expectation,
        });
        openClients.add(client);
        try {
            await expect(client.ready()).rejects.toThrow();
            expect(client.watchdogStatus()).toMatchObject({
                repositoryReady: false,
                blocker: 'startup_error',
            });
            expect(permissionBits((await stat(databaseDirectory)).mode)).toBe(0o500);
        } finally {
            await chmod(databaseDirectory, 0o700);
        }
    });

    it('fail-stops the repository after a simulated SQLite full-disk error', async () => {
        const databasePath = await temporaryDatabasePath();
        const expectation = await prepareRepositoryExpectation(databasePath, false);
        const initialized = await openSmartOrderRepository({
            databasePath,
            ...expectation,
        });
        await initialized.close();

        const limited = new DatabaseSync(databasePath);
        const pageCount = limited.prepare('PRAGMA page_count').get()?.page_count;
        limited.close();

        const client = new SmartOrderRepositoryClient({
            databasePath,
            ...expectation,
            testOnlyMaxPageCount: pageCount,
            testOnlyAllowUnverifiedIdentitySeed: true,
        });
        openClients.add(client);
        await client.ready();
        await expect(
            client.request(
                'insertStrategy',
                strategyInput({
                    strategyId: 'strategy-disk-full',
                    definition: {
                        schemaVersion: 'strategy/1',
                        kind: 'quick',
                        padding: 'x'.repeat(900 * 1024),
                    },
                }),
            ),
        ).rejects.toThrow(/full/i);
        expect(client.watchdogStatus()).toMatchObject({
            repositoryReady: false,
            blocker: 'repository_fatal_error',
        });
        await expect(client.request('status')).rejects.toThrow('unavailable');
    });

    it('fail-stops on a competing SQLite writer instead of bypassing durable storage', async () => {
        const databasePath = await temporaryDatabasePath();
        const { client } = await openRepository({ databasePath });
        const competingWriter = new DatabaseSync(databasePath);
        competingWriter.exec('PRAGMA busy_timeout=0');
        competingWriter.exec('BEGIN IMMEDIATE');
        try {
            await expect(
                client.request(
                    'insertStrategy',
                    strategyInput({ strategyId: 'strategy-busy-writer' }),
                ),
            ).rejects.toThrow(/locked/i);
            expect(client.watchdogStatus()).toMatchObject({
                repositoryReady: false,
                blocker: 'repository_fatal_error',
            });
            await expect(client.request('status')).rejects.toThrow('unavailable');
        } finally {
            competingWriter.exec('ROLLBACK');
            competingWriter.close();
        }

        await client.close();
        openClients.delete(client);
        const reopened = await openRepository({ databasePath });
        await expect(reopened.client.request('status')).resolves.toMatchObject({
            integrity: 'ok',
            counts: { strategies: 0 },
        });
    });

    it('rejects broad parent permissions and symbolic-link database artifacts', async () => {
        const broadPath = await temporaryDatabasePath();
        const broadExpectation = await prepareRepositoryExpectation(broadPath, false);
        await chmod(path.dirname(broadPath), 0o755);
        const broadClient = new SmartOrderRepositoryClient({
            databasePath: broadPath,
            ...broadExpectation,
        });
        openClients.add(broadClient);
        await expect(broadClient.ready()).rejects.toThrow('parent permissions');
        await broadClient.close();
        openClients.delete(broadClient);

        const linkPath = await temporaryDatabasePath();
        const targetPath = `${linkPath}.target`;
        const target = new DatabaseSync(targetPath);
        target.close();
        await symlink(targetPath, linkPath);
        const linkExpectation = await prepareRepositoryExpectation(linkPath, true);
        const linkClient = new SmartOrderRepositoryClient({
            databasePath: linkPath,
            ...linkExpectation,
        });
        openClients.add(linkClient);
        await expect(linkClient.ready()).rejects.toThrow('regular file');
        await linkClient.close();
        openClients.delete(linkClient);
    });

    it('marks readiness false for worker latency and queue-age watchdog breaches', async () => {
        const latencyRepository = await openRepository({
            workerLatencyLimitMs: 0.000_001,
            queueAgeLimitMs: 60_000,
        });
        await latencyRepository.client.request('status');
        expect(latencyRepository.client.watchdogStatus()).toMatchObject({
            repositoryReady: false,
            blocker: 'worker_latency_exceeded',
        });
        await expect(
            latencyRepository.client.request('insertStrategy', strategyInput()),
        ).rejects.toThrow('watchdog blocks');

        const queueRepository = await openRepository({
            workerLatencyLimitMs: 60_000,
            queueAgeLimitMs: 0.000_001,
        });
        const queued = Array.from({ length: 24 }, () =>
            queueRepository.client.request('status'),
        );
        let localEventLoopTurn = false;
        await new Promise((resolve) =>
            setImmediate(() => {
                localEventLoopTurn = true;
                resolve();
            }),
        );
        await Promise.all(queued);
        expect(localEventLoopTurn).toBe(true);
        expect(queueRepository.client.watchdogStatus()).toMatchObject({
            repositoryReady: false,
            blocker: 'queue_age_exceeded',
        });
    });

    it('isolates a blocking backup/fsync stall from the main event loop and fail-closes readiness', async () => {
        const databasePath = await temporaryDatabasePath();
        const backupDirectory = path.join(path.dirname(databasePath), 'backups');
        await mkdir(backupDirectory, { mode: 0o700 });
        await chmod(backupDirectory, 0o700);
        const { client } = await openRepository({
            databasePath,
            backupDirectory,
            testOnlyBlockingBackupDelayMs: 75,
            workerLatencyLimitMs: 5,
            queueAgeLimitMs: 60_000,
        });
        await client.request(
            'insertStrategy',
            strategyInput({ strategyId: 'strategy-before-slow-backup' }),
        );

        let localEventLoopTurn = false;
        const backupPromise = client.request('createRepositoryBackup', {
            backupName: 'slow-fsync-backup.sqlite3',
            createdAtEpochMs: 1_786_377_600_950,
        });
        const queuedReadinessMutation = client.request(
            'insertStrategy',
            strategyInput({ strategyId: 'queued-behind-slow-backup' }),
        );
        await new Promise((resolve) =>
            setImmediate(() => {
                localEventLoopTurn = true;
                resolve();
            }),
        );
        expect(localEventLoopTurn).toBe(true);
        await expect(backupPromise).resolves.toMatchObject({
            backupName: 'slow-fsync-backup.sqlite3',
        });
        await expect(queuedReadinessMutation).rejects.toThrow(
            'watchdog blocks',
        );
        expect(client.watchdogStatus()).toMatchObject({
            repositoryReady: false,
            blocker: 'worker_latency_exceeded',
        });
        await expect(
            client.request(
                'insertStrategy',
                strategyInput({ strategyId: 'blocked-after-slow-backup' }),
            ),
        ).rejects.toThrow('watchdog blocks');
    });

    it('enforces the authenticated identity 20-strategy limit across accounts and rejects mapping conflicts', async () => {
        const initialized = await openRepository({
            testOnlyAllowUnverifiedIdentitySeed: false,
        });
        const firstAdmission = await signedIdentityAdmission({
            identityKeyPath: initialized.identityKeyPath,
        });
        await expect(
            initialized.client.request(
                'insertStrategy',
                strategyInput({ strategyId: 'identity-missing-admission' }),
            ),
        ).rejects.toThrow('identity admission is required');
        await initialized.client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'identity-strategy-1',
                identityGroupId: firstAdmission.identityGroupId,
                identityAdmission: firstAdmission,
            }),
        );
        const conservativeStates = [
            'paused',
            'recovery',
            'manual_intervention',
            'cancel_pending',
            'expired_with_obligation',
        ];
        for (let index = 2; index <= 20; index += 1) {
            const accountIdRef = `account-${index}`;
            const admission = await signedIdentityAdmission({
                identityKeyPath: initialized.identityKeyPath,
                accountIdRef,
            });
            await initialized.client.request(
                'insertStrategy',
                strategyInput({
                    strategyId: `identity-strategy-${index}`,
                    state:
                        conservativeStates[
                            (index - 2) % conservativeStates.length
                        ],
                    accountIdRef,
                    identityGroupId: admission.identityGroupId,
                    identityAdmission: admission,
                }),
            );
        }
        const overflowAdmission = await signedIdentityAdmission({
            identityKeyPath: initialized.identityKeyPath,
            accountIdRef: 'account-overflow',
        });
        await expect(
            initialized.client.request(
                'insertStrategy',
                strategyInput({
                    strategyId: 'identity-strategy-overflow',
                    accountIdRef: 'account-overflow',
                    identityGroupId: overflowAdmission.identityGroupId,
                    identityAdmission: overflowAdmission,
                }),
            ),
        ).rejects.toThrow('limit of 20');

        const conflict = await signedIdentityAdmission({
            identityKeyPath: initialized.identityKeyPath,
            canonicalPrincipal: 'different-authenticated-principal',
        });
        await expect(
            initialized.client.request(
                'insertStrategy',
                strategyInput({
                    strategyId: 'identity-mapping-conflict',
                    identityGroupId: conflict.identityGroupId,
                    identityAdmission: conflict,
                }),
            ),
        ).rejects.toThrow('conflicting authenticated identity group');
    });

    it('keeps each authenticated account mapping immutable across evidence revisions', async () => {
        const initialized = await openRepository({
            testOnlyAllowUnverifiedIdentitySeed: false,
        });
        const admission = await signedIdentityAdmission({
            identityKeyPath: initialized.identityKeyPath,
        });
        await initialized.client.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'identity-binding-initial',
                identityGroupId: admission.identityGroupId,
                identityAdmission: admission,
            }),
        );

        await expect(
            initialized.client.request(
                'insertStrategy',
                strategyInput({
                    strategyId: 'identity-binding-mapping-drift',
                    identityGroupId: admission.identityGroupId,
                    identityAdmission: await signedIdentityAdmission({
                        identityKeyPath: initialized.identityKeyPath,
                        mappingRevision: 'identity-mapping/2',
                    }),
                }),
            ),
        ).rejects.toThrow(
            'identity mapping evidence changed; reconciliation required',
        );
        await expect(
            initialized.client.request(
                'insertStrategy',
                strategyInput({
                    strategyId: 'identity-binding-evidence-drift',
                    identityGroupId: admission.identityGroupId,
                    identityAdmission: await signedIdentityAdmission({
                        identityKeyPath: initialized.identityKeyPath,
                        principalEvidenceHash: DIGEST_B,
                    }),
                }),
            ),
        ).rejects.toThrow(
            'identity mapping evidence changed; reconciliation required',
        );
        await expect(
            initialized.client.request(
                'insertStrategy',
                strategyInput({
                    strategyId: 'identity-binding-idempotent',
                    identityGroupId: admission.identityGroupId,
                    identityAdmission: admission,
                }),
            ),
        ).resolves.toMatchObject({
            strategyId: 'identity-binding-idempotent',
        });
    });

    it('holds one distinct local slot for terminal strategies with broker, obligation, or reservation side effects', async () => {
        const initialized = await openRepository({
            testOnlyAllowUnverifiedIdentitySeed: false,
        });
        const admissions = [];
        for (let index = 1; index <= 20; index += 1) {
            admissions.push(
                await signedIdentityAdmission({
                    identityKeyPath: initialized.identityKeyPath,
                    accountIdRef: `side-effect-account-${index}`,
                }),
            );
            await initialized.client.request(
                'insertStrategy',
                strategyInput({
                    strategyId: `side-effect-strategy-${index}`,
                    accountIdRef: `side-effect-account-${index}`,
                    identityGroupId: admissions[index - 1].identityGroupId,
                    identityAdmission: admissions[index - 1],
                }),
            );
        }
        const database = new DatabaseSync(initialized.databasePath);
        database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=2500; BEGIN IMMEDIATE');
        try {
            for (let index = 1; index <= 3; index += 1) {
                database.prepare(`
                    INSERT INTO activations(
                        activation_id, strategy_id, logical_key, state,
                        generation, evidence_hash, created_at_epoch_ms,
                        updated_at_epoch_ms, revision
                    ) VALUES (?, ?, ?, 'filled', 0, ?, 1, 1, 0)
                `).run(
                    `side-effect-activation-${index}`,
                    `side-effect-strategy-${index}`,
                    `side-effect-logical-${index}`,
                    DIGEST_A,
                );
                database.prepare(`
                    INSERT INTO order_intents(
                        intent_id, activation_id, strategy_id, operation_kind,
                        owner_kind, state, payload_hash, payload_json,
                        client_request_id, account_broker_ref, account_id_ref,
                        trade_date, contract_key, side, created_at_epoch_ms,
                        updated_at_epoch_ms, revision
                    ) VALUES (?, ?, ?, 'place', 'activation', 'terminal', ?,
                              '{}', ?, 'broker-A', ?, '2026-08-13',
                              'TSE:2330:STK:Common', 'Buy', 1, 1, 0)
                `).run(
                    `side-effect-intent-${index}`,
                    `side-effect-activation-${index}`,
                    `side-effect-strategy-${index}`,
                    `sha256:${createHash('sha256').update('{}').digest('hex')}`,
                    `side-effect-request-${index}`,
                    `side-effect-account-${index}`,
                );
            }
            database.prepare(`
                INSERT INTO broker_orders(
                    broker_order_id, intent_id, state, control_revision,
                    quantity_shares, filled_shares, remaining_shares,
                    evidence_hash, updated_at_epoch_ms, revision
                ) VALUES ('side-effect-broker-order', 'side-effect-intent-1',
                          'submitted', 0, 1000, 0, 1000, ?, 1, 0)
            `).run(DIGEST_A);
            database.prepare(`
                INSERT INTO pending_protection_commitments(
                    commitment_id, strategy_id, entry_intent_id, state,
                    committed_shares, materialized_shares,
                    created_at_epoch_ms, updated_at_epoch_ms, revision
                ) VALUES ('side-effect-commitment', 'side-effect-strategy-2',
                          'side-effect-intent-2', 'materialized',
                          1000, 1000, 1, 1, 0)
            `).run();
            database.prepare(`
                INSERT INTO protection_obligations(
                    obligation_id, strategy_id, commitment_id, state,
                    position_lineage_id, filled_shares,
                    confirmed_exited_shares, created_at_epoch_ms,
                    updated_at_epoch_ms, revision
                ) VALUES ('side-effect-obligation', 'side-effect-strategy-2',
                          'side-effect-commitment', 'pending_entry_fill',
                          'side-effect-position', 0, 0, 1, 1, 0)
            `).run();
            database.prepare(`
                INSERT INTO entry_exposure_reservations(
                    reservation_id, strategy_id, intent_id,
                    account_broker_ref, account_id_ref, identity_group_id,
                    policy_revision, policy_hash, state, quantity_shares,
                    notional_minor_units, cash_minor_units, position_shares,
                    order_count, created_at_epoch_ms, updated_at_epoch_ms,
                    revision
                ) VALUES ('side-effect-reservation', 'side-effect-strategy-3',
                          'side-effect-intent-3', 'broker-A',
                          'side-effect-account-3', 'identity-A',
                          'risk/1', ?, 'reserved', 1000, 0, 0, 1000, 1,
                          1, 1, 0)
            `).run(DIGEST_A);
            database.prepare(`
                UPDATE strategies
                   SET state='completed', terminal_at_epoch_ms=2,
                       updated_at_epoch_ms=2
                 WHERE strategy_id IN (
                     'side-effect-strategy-1',
                     'side-effect-strategy-2',
                     'side-effect-strategy-3'
                 )
            `).run();
            database.exec('COMMIT');
        } catch (error) {
            database.exec('ROLLBACK');
            throw error;
        } finally {
            database.close();
        }
        const overflow = await signedIdentityAdmission({
            identityKeyPath: initialized.identityKeyPath,
            accountIdRef: 'side-effect-account-overflow',
        });
        await expect(
            initialized.client.request(
                'insertStrategy',
                strategyInput({
                    strategyId: 'side-effect-overflow',
                    accountIdRef: 'side-effect-account-overflow',
                    identityGroupId: overflow.identityGroupId,
                    identityAdmission: overflow,
                }),
            ),
        ).rejects.toThrow('limit of 20');
    });

    it('fails closed after the persisted identity key is lost or replaced', async () => {
        const initialized = await openRepository({
            testOnlyAllowUnverifiedIdentitySeed: false,
        });
        await initialized.client.close();
        openClients.delete(initialized.client);
        await unlink(initialized.identityKeyPath);
        const appSupportRoot = path.dirname(
            path.dirname(path.dirname(initialized.databasePath)),
        );
        await expect(
            prepareSmartOrderPrivateStorage({ appSupportRoot }),
        ).rejects.toThrow('identity-hmac-key.bin');
        await writeFile(initialized.identityKeyPath, randomBytes(32), {
            mode: 0o600,
        });
        await expect(
            openSmartOrderRepository({
                databasePath: initialized.databasePath,
                identityKeyPath: initialized.identityKeyPath,
                installationIdPath: initialized.installationIdPath,
                repositoryExpectationPath:
                    initialized.repositoryExpectationPath,
                testOnlyAllowUnverifiedIdentitySeed: false,
            }),
        ).rejects.toThrow('replaced or rotated');
    });

    it('atomically records complete account reconciliation and external working sells without broker authority', async () => {
        const initialized = await openRepository();
        await startReadyRuntime(initialized.client, {
            runtimeEpochId: 'runtime-account-reconciliation',
            senderFence: 'fence-account-reconciliation',
            apiGeneration: 'generation-account-reconciliation',
        });
        const candidate = {
            brokerOrderId: 'external-working-sell-5-5',
            contractKey: 'TSE:2330:STK:Common',
            quantityShares: 500,
        };
        candidate.candidateId = externalSellCandidateId(candidate);
        const identityAdmission = await signedIdentityAdmission({
            identityKeyPath: initialized.identityKeyPath,
            issuedAtEpochMs: 1_786_377_600_800,
        });
        await expect(
            initialized.client.request('recordAccountReconciliation', {
                runtimeEpochId: 'runtime-account-reconciliation',
                senderFence: 'fence-account-reconciliation',
                apiGeneration: 'generation-account-reconciliation',
                expectedFixedAccountCount: 1,
                identityAdmission,
                nowEpochMs: 1_786_377_600_750,
                reconciliation: {
                    ...completeAccountReconciliationProjection({
                        asOfEpochMs: 1_786_377_600_700,
                        candidates: [candidate],
                    }),
                    fullDayTotals: {
                        realizedMinorUnits: -500,
                        unrealizedMinorUnits: 100,
                        feeMinorUnits: 0,
                        transactionTaxMinorUnits: 20,
                        netMinorUnits: -420,
                    },
                },
            }),
        ).rejects.toThrow(
            'canonical PnL totals differ from the complete source ledger',
        );
        await expect(
            initialized.client.request('recordAccountReconciliation', {
                runtimeEpochId: 'runtime-account-reconciliation',
                senderFence: 'fence-account-reconciliation',
                apiGeneration: 'generation-account-reconciliation',
                expectedFixedAccountCount: 1,
                identityAdmission,
                nowEpochMs: 1_786_377_600_800,
                reconciliation: completeAccountReconciliationProjection({
                    candidates: [candidate],
                }),
            }),
        ).resolves.toMatchObject({
            state: 'recorded',
            accountReconciliationCurrent: true,
            canonicalPnlCurrent: true,
            externalSellClaimCount: 1,
            fullDayTotals: {
                realizedMinorUnits: -500,
                unrealizedMinorUnits: 100,
                feeMinorUnits: 10,
                transactionTaxMinorUnits: 20,
                netMinorUnits: -430,
            },
            pnlIdentityHead: {
                policyDefinitionSha256:
                    SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
                policyRevision: SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
                totals: { netMinorUnits: -430 },
            },
            runtimeReadinessContribution: true,
            brokerWriteAuthority: false,
        });
        await expect(
            initialized.client.request('recordAccountReconciliation', {
                runtimeEpochId: 'runtime-account-reconciliation',
                senderFence: 'fence-account-reconciliation',
                apiGeneration: 'generation-account-reconciliation',
                expectedFixedAccountCount: 1,
                identityAdmission,
                nowEpochMs: 1_786_377_600_900,
                reconciliation: completeAccountReconciliationProjection({
                    asOfEpochMs: 1_786_377_600_850,
                    candidates: [{ ...candidate, quantityShares: 600 }],
                }),
            }),
        ).resolves.toMatchObject({
            state: 'recorded',
            accountReconciliationCurrent: true,
            canonicalPnlCurrent: true,
            externalSellClaimCount: 1,
            runtimeReadinessContribution: true,
            brokerWriteAuthority: false,
        });
        await expect(
            initialized.client.request('recordAccountReconciliation', {
                runtimeEpochId: 'runtime-account-reconciliation',
                senderFence: 'fence-account-reconciliation',
                apiGeneration: 'generation-account-reconciliation',
                expectedFixedAccountCount: 1,
                identityAdmission,
                nowEpochMs: 1_786_377_601_000,
                reconciliation: completeAccountReconciliationProjection({
                    asOfEpochMs: 1_786_377_600_950,
                    candidates: [
                        {
                            ...candidate,
                            positionLineageId: 'conflicting-position-lineage',
                            quantityShares: 700,
                        },
                    ],
                }),
            }),
        ).rejects.toThrow(
            'external sell claim candidate does not match the complete working set',
        );
        await initialized.client.close();
        openClients.delete(initialized.client);
        const database = new DatabaseSync(initialized.databasePath);
        expect(
            database
                .prepare(`
                    SELECT external_lineage, quantity_shares, state
                      FROM exit_claims WHERE exit_claim_id=?
                `)
                .get(candidate.candidateId),
        ).toEqual({
            external_lineage: 1,
            quantity_shares: 600,
            state: 'broker_working',
        });
        expect(
            database
                .prepare(`
                    SELECT COUNT(*) AS count
                      FROM account_reconciliation_heads
                     WHERE account_broker_ref='broker-A'
                       AND account_id_ref='account-A'
                       AND trade_date='2026-08-11'
                `)
                .get(),
        ).toEqual({ count: 1 });
        expect(
            database
                .prepare(`
                    SELECT as_of_epoch_ms FROM account_reconciliation_heads
                     WHERE account_broker_ref='broker-A'
                       AND account_id_ref='account-A'
                       AND trade_date='2026-08-11'
                `)
                .get(),
        ).toEqual({ as_of_epoch_ms: 1_786_377_600_850 });
        expect(
            database
                .prepare(`
                    SELECT reconciliation_evidence_hash
                      FROM runtime_epochs WHERE runtime_epoch_id=?
                `)
                .get('runtime-account-reconciliation')
                .reconciliation_evidence_hash,
        ).toMatch(/^sha256:[a-f0-9]{64}$/);
        database.close();
    });

    it('rejects durable Share-position exchange or canonical contract revision drift before replacing reconciliation state', async () => {
        const initialized = await openRepository();
        await startReadyRuntime(initialized.client, {
            runtimeEpochId: 'runtime-position-contract-drift',
            senderFence: 'fence-position-contract-drift',
            apiGeneration: 'generation-position-contract-drift',
        });
        const identityAdmission = await signedIdentityAdmission({
            identityKeyPath: initialized.identityKeyPath,
            issuedAtEpochMs: 1_786_377_600_800,
        });
        const request = (reconciliation, nowEpochMs) =>
            initialized.client.request('recordAccountReconciliation', {
                runtimeEpochId: 'runtime-position-contract-drift',
                senderFence: 'fence-position-contract-drift',
                apiGeneration: 'generation-position-contract-drift',
                expectedFixedAccountCount: 1,
                identityAdmission,
                nowEpochMs,
                reconciliation,
            });
        await expect(
            request(
                completeAccountReconciliationProjection({
                    asOfEpochMs: 1_786_377_600_700,
                }),
                1_786_377_600_800,
            ),
        ).resolves.toMatchObject({
            state: 'recorded',
            brokerWriteAuthority: false,
        });
        await expect(
            request(
                completeAccountReconciliationProjection({
                    asOfEpochMs: 1_786_377_600_850,
                    positionLineageId: 'position-lineage-contract-revision-2',
                }),
                1_786_377_600_900,
            ),
        ).rejects.toThrow(
            'reconciliation position canonical contract revision drift requires manual intervention',
        );
        const exchangeDrift = completeAccountReconciliationProjection({
            asOfEpochMs: 1_786_377_600_950,
        });
        exchangeDrift.positions = exchangeDrift.positions.map((position) => ({
            ...position,
            contractKey: 'OTC:2330:STK:Common',
        }));
        await expect(
            request(exchangeDrift, 1_786_377_601_000),
        ).rejects.toThrow(
            'reconciliation position exchange drift requires manual intervention',
        );
        await initialized.client.close();
        openClients.delete(initialized.client);
    });

    it('returns a bounded protected-entry materialization set from complete reconciliation', async () => {
        const databasePath = await temporaryDatabasePath();
        await seedPartialProtectedEntryFill(databasePath);
        const expectation = await prepareRepositoryExpectation(databasePath);
        const identityAdmission = await signedIdentityAdmission({
            identityKeyPath: expectation.identityKeyPath,
            issuedAtEpochMs: 1_786_377_600_800,
        });
        const resetIdentity = new DatabaseSync(databasePath);
        resetIdentity
            .prepare(
                "DELETE FROM repository_meta WHERE key LIKE 'authenticated_identity_account_binding:%'",
            )
            .run();
        resetIdentity
            .prepare(
                "UPDATE strategies SET identity_group_id=? WHERE strategy_id='strategy-1'",
            )
            .run(identityAdmission.identityGroupId);
        resetIdentity
            .prepare(
                "UPDATE entry_exposure_reservations SET identity_group_id=? WHERE intent_id='intent-1'",
            )
            .run(identityAdmission.identityGroupId);
        resetIdentity.close();
        const reopened = await openRepository({
            databasePath,
            testOnlyExposureArbiterHeads: [],
        });
        await expect(
            reopened.client.request('recordAccountReconciliation', {
                runtimeEpochId: 'protected-entry-setup-runtime',
                senderFence: 'protected-entry-setup-fence',
                apiGeneration: 'simulation-generation/1',
                expectedFixedAccountCount: 1,
                identityAdmission,
                nowEpochMs: 1_786_377_600_800,
                reconciliation: completeAccountReconciliationProjection({
                    asOfEpochMs: 1_786_377_600_700,
                }),
            }),
        ).resolves.toMatchObject({
            state: 'recorded',
            protectedEntryMaterializationIntentIds: [],
            brokerWriteAuthority: false,
        });
        const changedBrokerHead = new DatabaseSync(databasePath);
        changedBrokerHead.prepare(`
            UPDATE broker_event_heads
               SET cumulative_deal_quantity=300, remaining_quantity=700,
                   revision=revision+1
             WHERE intent_id='intent-1'
        `).run();
        changedBrokerHead.close();
        await expect(
            reopened.client.request('recordAccountReconciliation', {
                runtimeEpochId: 'protected-entry-setup-runtime',
                senderFence: 'protected-entry-setup-fence',
                apiGeneration: 'simulation-generation/1',
                expectedFixedAccountCount: 1,
                identityAdmission,
                nowEpochMs: 1_786_377_600_900,
                reconciliation: completeAccountReconciliationProjection({
                    asOfEpochMs: 1_786_377_600_850,
                }),
            }),
        ).resolves.toMatchObject({
            protectedEntryMaterializationIntentIds: ['intent-1'],
            brokerWriteAuthority: false,
        });
        await reopened.client.close();
        openClients.delete(reopened.client);
    });

    it('atomically shrinks an untriggered protection reservation after manual position drift and journals a local alert', async () => {
        const databasePath = await temporaryDatabasePath();
        await seedPartialProtectedEntryFill(databasePath);
        const reopened = await openPartialProtectedEntryForAccountReconciliation(
            databasePath,
        );
        const faulting = new DatabaseSync(databasePath);
        faulting.exec(`
            CREATE TRIGGER test_position_drift_shrink_failure
            BEFORE UPDATE OF quantity_shares ON exit_claims
            WHEN OLD.external_lineage=0 AND NEW.quantity_shares < OLD.quantity_shares
            BEGIN
                SELECT RAISE(ABORT, 'test position drift shrink failure');
            END;
        `);
        faulting.close();
        const shrinkInput = {
            runtimeEpochId: 'protected-entry-setup-runtime',
            senderFence: 'protected-entry-setup-fence',
            apiGeneration: 'simulation-generation/1',
            expectedFixedAccountCount: 1,
            identityAdmission: reopened.identityAdmission,
            nowEpochMs: 1_786_377_600_800,
            reconciliation: completeAccountReconciliationProjection({
                asOfEpochMs: 1_786_377_600_700,
                quantityShares: 100,
                availableShares: 100,
            }),
        };
        await expect(
            reopened.client.request('recordAccountReconciliation', shrinkInput),
        ).rejects.toThrow('test position drift shrink failure');
        const rolledBack = new DatabaseSync(databasePath);
        expect(
            rolledBack
                .prepare(`
                    SELECT quantity_shares, state, revision FROM exit_claims
                     WHERE external_lineage=0
                `)
                .get(),
        ).toEqual({
            quantity_shares: 200,
            state: 'monitoring_reserved',
            revision: 0,
        });
        expect(
            rolledBack
                .prepare(`
                    SELECT COUNT(*) AS count FROM event_journal
                     WHERE reason_code=
                       'PROTECTION_RESERVATION_SHRUNK_EXTERNAL_POSITION_DRIFT'
                `)
                .get(),
        ).toEqual({ count: 0 });
        rolledBack.exec('DROP TRIGGER test_position_drift_shrink_failure;');
        rolledBack.close();

        await expect(
            reopened.client.request('recordAccountReconciliation', shrinkInput),
        ).resolves.toMatchObject({
            state: 'recorded',
            protectionReservationShrinkCount: 1,
            protectionReservationReleasedCount: 0,
            protectionManualInterventionCount: 0,
            protectionShrunkShares: 100,
            protectedEntryMaterializationIntentIds: [],
            brokerWriteAuthority: false,
        });
        await expect(
            reopened.client.request('recordAccountReconciliation', {
                ...shrinkInput,
                nowEpochMs: 1_786_377_600_900,
                reconciliation: completeAccountReconciliationProjection({
                    asOfEpochMs: 1_786_377_600_850,
                    quantityShares: 100,
                    availableShares: 100,
                }),
            }),
        ).resolves.toMatchObject({
            protectionReservationShrinkCount: 0,
            protectionReservationReleasedCount: 0,
            protectionManualInterventionCount: 0,
            protectionShrunkShares: 0,
            brokerWriteAuthority: false,
        });
        await reopened.client.close();
        openClients.delete(reopened.client);
        const verified = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verified
                .prepare(`
                    SELECT claims.quantity_shares, claims.state,
                           obligations.filled_shares, obligations.state AS obligation_state,
                           strategies.state AS strategy_state
                      FROM exit_claims AS claims
                      JOIN protection_obligations AS obligations
                        ON obligations.obligation_id=claims.obligation_id
                      JOIN strategies USING(strategy_id)
                     WHERE claims.external_lineage=0
                `)
                .get(),
        ).toEqual({
            quantity_shares: 100,
            state: 'monitoring_reserved',
            filled_shares: 200,
            obligation_state: 'monitoring',
            strategy_state: 'monitoring',
        });
        expect(
            verified
                .prepare(`
                    SELECT COUNT(*) AS count FROM event_journal
                     WHERE reason_code=
                       'PROTECTION_RESERVATION_SHRUNK_EXTERNAL_POSITION_DRIFT'
                `)
                .get(),
        ).toEqual({ count: 2 });
        expect(
            verified.prepare(`
                SELECT groups.state AS group_state,
                       groups.revision AS group_revision,
                       generations.state AS generation_state,
                       generations.quantity_shares,
                       generations.revision AS generation_revision
                  FROM protection_groups AS groups
                  JOIN protection_remainder_generations AS generations
                    ON generations.protection_group_id=groups.protection_group_id
                   AND generations.remainder_generation=groups.current_generation
                 WHERE groups.exit_claim_id=(
                     SELECT exit_claim_id FROM exit_claims
                      WHERE external_lineage=0 LIMIT 1
                 )
            `).get(),
        ).toEqual({
            group_state: 'monitoring',
            group_revision: 1,
            generation_state: 'monitoring',
            quantity_shares: 100,
            generation_revision: 1,
        });
        verified.close();
    });

    it('moves protection to manual intervention instead of shrinking across a working-sell race', async () => {
        const databasePath = await temporaryDatabasePath();
        await seedPartialProtectedEntryFill(databasePath);
        const reopened = await openPartialProtectedEntryForAccountReconciliation(
            databasePath,
        );
        const candidate = {
            brokerOrderId: 'external-working-sell-position-drift',
            contractKey: 'TSE:2330:STK:Common',
            quantityShares: 100,
        };
        candidate.candidateId = externalSellCandidateId(candidate);
        const input = {
            runtimeEpochId: 'protected-entry-setup-runtime',
            senderFence: 'protected-entry-setup-fence',
            apiGeneration: 'simulation-generation/1',
            expectedFixedAccountCount: 1,
            identityAdmission: reopened.identityAdmission,
            nowEpochMs: 1_786_377_600_800,
            reconciliation: completeAccountReconciliationProjection({
                asOfEpochMs: 1_786_377_600_700,
                candidates: [candidate],
                quantityShares: 200,
                availableShares: 100,
            }),
        };
        const faulting = new DatabaseSync(databasePath);
        faulting.exec(`
            CREATE TRIGGER test_position_drift_manual_failure
            BEFORE UPDATE OF state ON protection_obligations
            WHEN NEW.state='safety_blocked'
            BEGIN
                SELECT RAISE(ABORT, 'test position drift manual failure');
            END;
        `);
        faulting.close();
        await expect(
            reopened.client.request('recordAccountReconciliation', input),
        ).rejects.toThrow('test position drift manual failure');
        const rolledBack = new DatabaseSync(databasePath);
        expect(
            rolledBack
                .prepare(`
                    SELECT claims.state AS claim_state,
                           obligations.state AS obligation_state,
                           strategies.state AS strategy_state
                      FROM exit_claims AS claims
                      JOIN protection_obligations AS obligations
                        ON obligations.obligation_id=claims.obligation_id
                      JOIN strategies USING(strategy_id)
                     WHERE claims.external_lineage=0
                `)
                .get(),
        ).toEqual({
            claim_state: 'monitoring_reserved',
            obligation_state: 'monitoring',
            strategy_state: 'monitoring',
        });
        expect(
            rolledBack
                .prepare(`
                    SELECT COUNT(*) AS count FROM resolution_cases
                     WHERE reason_code='EXTERNAL_POSITION_DRIFT'
                `)
                .get(),
        ).toEqual({ count: 0 });
        rolledBack.exec('DROP TRIGGER test_position_drift_manual_failure;');
        rolledBack.close();
        await expect(
            reopened.client.request('recordAccountReconciliation', input),
        ).resolves.toMatchObject({
            state: 'recorded',
            protectionReservationShrinkCount: 0,
            protectionReservationReleasedCount: 0,
            protectionManualInterventionCount: 1,
            protectionShrunkShares: 0,
            protectedEntryMaterializationIntentIds: [],
            brokerWriteAuthority: false,
        });
        await expect(
            reopened.client.request('recordAccountReconciliation', {
                ...input,
                nowEpochMs: 1_786_377_600_900,
                reconciliation: completeAccountReconciliationProjection({
                    asOfEpochMs: 1_786_377_600_850,
                    candidates: [candidate],
                    quantityShares: 200,
                    availableShares: 100,
                }),
            }),
        ).resolves.toMatchObject({
            protectionManualInterventionCount: 0,
            brokerWriteAuthority: false,
        });
        await reopened.client.close();
        openClients.delete(reopened.client);
        const verified = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verified
                .prepare(`
                    SELECT claims.quantity_shares, claims.state,
                           obligations.state AS obligation_state,
                           strategies.state AS strategy_state
                      FROM exit_claims AS claims
                      JOIN protection_obligations AS obligations
                        ON obligations.obligation_id=claims.obligation_id
                      JOIN strategies USING(strategy_id)
                     WHERE claims.external_lineage=0
                `)
                .get(),
        ).toEqual({
            quantity_shares: 200,
            state: 'unknown',
            obligation_state: 'safety_blocked',
            strategy_state: 'manual_intervention',
        });
        expect(
            verified
                .prepare(`
                    SELECT
                      (SELECT COUNT(*) FROM resolution_cases
                        WHERE reason_code='EXTERNAL_POSITION_DRIFT'
                          AND state='open') AS resolution_count,
                      (SELECT COUNT(*) FROM safety_blockers
                        WHERE reason_code='EXTERNAL_POSITION_DRIFT'
                          AND state='open') AS blocker_count,
                      (SELECT COUNT(*) FROM order_intents
                        WHERE side='Sell' AND adapter_authority_granted=1)
                        AS authorized_sell_count
                `)
                .get(),
        ).toEqual({
            resolution_count: 1,
            blocker_count: 1,
            authorized_sell_count: 0,
        });
        verified.close();
    });

    it('releases a fully displaced untriggered reservation without creating sell authority', async () => {
        const databasePath = await temporaryDatabasePath();
        await seedPartialProtectedEntryFill(databasePath);
        const reopened = await openPartialProtectedEntryForAccountReconciliation(
            databasePath,
        );
        await expect(
            reopened.client.request('recordAccountReconciliation', {
                runtimeEpochId: 'protected-entry-setup-runtime',
                senderFence: 'protected-entry-setup-fence',
                apiGeneration: 'simulation-generation/1',
                expectedFixedAccountCount: 1,
                identityAdmission: reopened.identityAdmission,
                nowEpochMs: 1_786_377_600_800,
                reconciliation: completeAccountReconciliationProjection({
                    asOfEpochMs: 1_786_377_600_700,
                    quantityShares: 0,
                    availableShares: 0,
                }),
            }),
        ).resolves.toMatchObject({
            protectionReservationShrinkCount: 1,
            protectionReservationReleasedCount: 1,
            protectionManualInterventionCount: 0,
            protectionShrunkShares: 200,
            brokerWriteAuthority: false,
        });
        await reopened.client.close();
        openClients.delete(reopened.client);
        const verified = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verified
                .prepare(`
                    SELECT quantity_shares, state, terminal_at_epoch_ms,
                           (SELECT COUNT(*) FROM order_intents
                             WHERE side='Sell' AND adapter_authority_granted=1)
                             AS authorized_sell_count
                      FROM exit_claims WHERE external_lineage=0
                `)
                .get(),
        ).toEqual({
            quantity_shares: 200,
            state: 'released',
            terminal_at_epoch_ms: 1_786_377_600_800,
            authorized_sell_count: 0,
        });
        verified.close();
    });

    it('requires manual intervention when position drift meets an unknown claim race', async () => {
        const databasePath = await temporaryDatabasePath();
        await seedPartialProtectedEntryFill(databasePath);
        const unknown = new DatabaseSync(databasePath);
        unknown.prepare(`
            UPDATE exit_claims
               SET state='unknown', revision=revision+1
             WHERE external_lineage=0
        `).run();
        unknown.close();
        const reopened = await openPartialProtectedEntryForAccountReconciliation(
            databasePath,
        );
        await expect(
            reopened.client.request('recordAccountReconciliation', {
                runtimeEpochId: 'protected-entry-setup-runtime',
                senderFence: 'protected-entry-setup-fence',
                apiGeneration: 'simulation-generation/1',
                expectedFixedAccountCount: 1,
                identityAdmission: reopened.identityAdmission,
                nowEpochMs: 1_786_377_600_800,
                reconciliation: completeAccountReconciliationProjection({
                    asOfEpochMs: 1_786_377_600_700,
                    quantityShares: 100,
                    availableShares: 100,
                }),
            }),
        ).resolves.toMatchObject({
            protectionReservationShrinkCount: 0,
            protectionManualInterventionCount: 1,
            brokerWriteAuthority: false,
        });
        await reopened.client.close();
        openClients.delete(reopened.client);
        const verified = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verified
                .prepare(`
                    SELECT claims.quantity_shares, claims.state,
                           obligations.state AS obligation_state,
                           strategies.state AS strategy_state
                      FROM exit_claims AS claims
                      JOIN protection_obligations AS obligations
                        ON obligations.obligation_id=claims.obligation_id
                      JOIN strategies USING(strategy_id)
                     WHERE claims.external_lineage=0
                `)
                .get(),
        ).toEqual({
            quantity_shares: 200,
            state: 'unknown',
            obligation_state: 'safety_blocked',
            strategy_state: 'manual_intervention',
        });
        verified.close();
    });

    it('publishes a versioned Runtime risk policy and rebuilds account and identity exposure heads only from complete reconciliation', async () => {
        const initialized = await openRepository({
            testOnlyExposureArbiterHeads: undefined,
            testOnlyRequireCanonicalPnl: true,
            testOnlyAllowUnverifiedIdentitySeed: false,
        });
        const runtime = runtimeEpochInput({
            runtimeEpochId: 'runtime-risk-policy',
            senderFence: 'fence-risk-policy',
            apiGeneration: 'generation-risk-policy',
        });
        await initialized.client.request('startRuntimeEpoch', runtime);
        const identityAdmission = await signedIdentityAdmission({
            identityKeyPath: initialized.identityKeyPath,
            issuedAtEpochMs: 1_786_377_600_800,
        });
        await expect(
            initialized.client.request('runtimeRiskPolicyView', {}),
        ).resolves.toMatchObject({
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
            requestId: '00000000-0000-4000-8000-000000000061',
            operationKind: 'risk_policy_publish',
            payloadHash: DIGEST_A,
            nowEpochMs: 1_786_377_600_810,
            mutation: {
                kind: 'risk_policy_publish',
                expectedRevision: null,
                policy,
                runtimeEpochId: 'runtime-risk-policy',
                senderFence: 'fence-risk-policy',
                apiGeneration: 'generation-risk-policy',
                nowEpochMs: 1_786_377_600_810,
            },
        };
        await expect(
            initialized.client.request(
                'executeReplayProtectedStrategyMutation',
                request,
            ),
        ).resolves.toMatchObject({
            state: 'completed',
            replayed: false,
            result: {
                state: 'reconciliation_required',
                revision: 0,
                runtimeState: 'reconciling',
                dispatchAllowed: false,
                exposureHeadsCurrent: false,
                brokerWriteAuthority: false,
            },
        });
        await expect(
            initialized.client.request(
                'executeReplayProtectedStrategyMutation',
                request,
            ),
        ).resolves.toMatchObject({
            state: 'completed',
            replayed: true,
            result: { revision: 0 },
        });
        const reconciliation = await initialized.client.request(
            'recordAccountReconciliation',
            {
                runtimeEpochId: 'runtime-risk-policy',
                senderFence: 'fence-risk-policy',
                apiGeneration: 'generation-risk-policy',
                expectedFixedAccountCount: 1,
                identityAdmission,
                nowEpochMs: 1_786_377_600_900,
                reconciliation: completeAccountReconciliationProjection(),
            },
        );
        expect(reconciliation).toMatchObject({
            accountReconciliationCurrent: true,
            canonicalPnlCurrent: true,
            runtimeRiskPolicyCurrent: true,
            runtimeReadinessContribution: true,
            brokerWriteAuthority: false,
        });
        const reconciliationEvidenceHash = `sha256:${createHash('sha256')
            .update(
                canonicalJson({
                    eventStreamWatermarkSha256: DIGEST_A,
                    snapshotHashes: [DIGEST_A],
                    tradeDate: '2026-08-11',
                }),
            )
            .digest('hex')}`;
        await expect(
            initialized.client.request('markRuntimeEpochReady', {
                runtimeEpochId: 'runtime-risk-policy',
                senderFence: 'fence-risk-policy',
                apiGeneration: 'generation-risk-policy',
                expectedRevision: reconciliation.runtimeRevision,
                reconciliationEvidenceHash,
                nowEpochMs: 1_786_377_600_901,
            }),
        ).resolves.toMatchObject({ state: 'ready' });
        await expect(
            initialized.client.request('runtimeRiskPolicyView', {}),
        ).resolves.toMatchObject({
            state: 'current',
            revision: 0,
            exposureHeadsCurrent: true,
            brokerWriteAuthority: false,
        });
        await initialized.client.close();
        openClients.delete(initialized.client);
        const database = new DatabaseSync(initialized.databasePath, {
            readOnly: true,
        });
        expect(
            database.prepare(`
                SELECT baseline_quantity_shares,
                       baseline_notional_minor_units,
                       baseline_cash_minor_units,
                       baseline_position_shares, baseline_order_count,
                       limit_notional_minor_units,
                       daily_loss_limit_minor_units
                  FROM exposure_account_arbiter_heads
                 WHERE account_broker_ref='broker-A'
                   AND account_id_ref='account-A'
            `).get(),
        ).toEqual({
            baseline_quantity_shares: 1_000,
            baseline_notional_minor_units: 10_100_000,
            baseline_cash_minor_units: 10_100_000,
            baseline_position_shares: 1_000,
            baseline_order_count: 0,
            limit_notional_minor_units: 50_000_000,
            daily_loss_limit_minor_units: 1_000_000,
        });
        database.close();
    });

    it('rolls back the policy, exposure invalidation, Runtime transition, and replay outcome when completion persistence fails', async () => {
        const initialized = await openRepository({
            testOnlyFailReplayCompletionAfterMutation: true,
        });
        await startReadyRuntime(initialized.client, {
            runtimeEpochId: 'runtime-risk-policy-rollback',
            senderFence: 'fence-risk-policy-rollback',
            apiGeneration: 'generation-risk-policy-rollback',
        });
        await expect(
            initialized.client.request(
                'executeReplayProtectedStrategyMutation',
                {
                    requestId: '00000000-0000-4000-8000-000000000064',
                    operationKind: 'risk_policy_publish',
                    payloadHash: DIGEST_A,
                    nowEpochMs: 1_786_377_600_950,
                    mutation: {
                        kind: 'risk_policy_publish',
                        expectedRevision: null,
                        runtimeEpochId: 'runtime-risk-policy-rollback',
                        senderFence: 'fence-risk-policy-rollback',
                        apiGeneration: 'generation-risk-policy-rollback',
                        nowEpochMs: 1_786_377_600_950,
                        policy: {
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
                        },
                    },
                },
            ),
        ).rejects.toThrow(/after mutation before outcome commit/);
        await expect(
            initialized.client.request('runtimeRiskPolicyView', {}),
        ).resolves.toMatchObject({ state: 'missing' });
        await expect(
            initialized.client.request('lifecycleAudit', {}),
        ).resolves.toMatchObject({ currentRuntimeState: 'ready' });
    });

    it('keeps multi-account reconciliation closed until every authenticated account shares the current connection watermark', async () => {
        const initialized = await openRepository();
        await startReadyRuntime(initialized.client, {
            runtimeEpochId: 'runtime-multi-account-reconciliation',
            senderFence: 'fence-multi-account-reconciliation',
            apiGeneration: 'generation-multi-account-reconciliation',
        });
        const admissionA = await signedIdentityAdmission({
            identityKeyPath: initialized.identityKeyPath,
            accountIdRef: 'account-A',
            issuedAtEpochMs: 1_786_377_600_800,
        });
        const admissionB = await signedIdentityAdmission({
            identityKeyPath: initialized.identityKeyPath,
            accountIdRef: 'account-B',
            issuedAtEpochMs: 1_786_377_600_801,
        });
        const common = {
            runtimeEpochId: 'runtime-multi-account-reconciliation',
            senderFence: 'fence-multi-account-reconciliation',
            apiGeneration: 'generation-multi-account-reconciliation',
            expectedFixedAccountCount: 2,
        };
        await expect(
            initialized.client.request('recordAccountReconciliation', {
                ...common,
                identityAdmission: admissionA,
                nowEpochMs: 1_786_377_600_800,
                reconciliation: completeAccountReconciliationProjection({
                    accountIdRef: 'account-A',
                }),
            }),
        ).resolves.toMatchObject({
            accountReconciliationCurrent: false,
            canonicalPnlCurrent: false,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
        await expect(
            initialized.client.request('recordAccountReconciliation', {
                ...common,
                identityAdmission: admissionB,
                nowEpochMs: 1_786_377_600_801,
                reconciliation: completeAccountReconciliationProjection({
                    accountIdRef: 'account-B',
                    asOfEpochMs: 1_786_377_600_701,
                }),
            }),
        ).resolves.toMatchObject({
            accountReconciliationCurrent: true,
            canonicalPnlCurrent: true,
            runtimeReadinessContribution: true,
            brokerWriteAuthority: false,
        });
        await initialized.client.close();
        openClients.delete(initialized.client);
        const database = new DatabaseSync(initialized.databasePath);
        expect(
            database.prepare(`
                SELECT reconciliation_evidence_hash, revision
                  FROM runtime_epochs
                 WHERE runtime_epoch_id='runtime-multi-account-reconciliation'
            `).get(),
        ).toMatchObject({
            reconciliation_evidence_hash: expect.stringMatching(
                /^sha256:[a-f0-9]{64}$/,
            ),
        });
        expect(
            database.prepare(`
                SELECT COUNT(*) AS count FROM event_journal
                 WHERE reason_code='ACCOUNT_RECONCILIATION_RECORDED'
                   AND entity_id='runtime-multi-account-reconciliation'
            `).get(),
        ).toEqual({ count: 2 });
        expect(
            database.prepare(`
                SELECT expected_account_count, observed_account_count,
                       net_minor_units, all_accounts_reconciled,
                       identity_mapping_ready
                  FROM canonical_pnl_identity_heads
                 WHERE identity_group_id=? AND trade_date='2026-08-11'
            `).get(admissionA.identityGroupId),
        ).toEqual({
            expected_account_count: 2,
            observed_account_count: 2,
            net_minor_units: -860,
            all_accounts_reconciled: 1,
            identity_mapping_ready: 1,
        });
        database.close();
    });

    it('requires current canonical account and identity PnL at prepare and dispatch', async () => {
        const databasePath = await temporaryDatabasePath();
        const expectation = await prepareRepositoryExpectation(databasePath, false);
        const identityAdmission = await signedIdentityAdmission({
            identityKeyPath: expectation.identityKeyPath,
            issuedAtEpochMs: 1_786_377_600_100,
        });
        const client = await openSmartOrderRepository({
            databasePath,
            ...expectation,
            testOnlyExposureArbiterHeads: [
                defaultExposureArbiterHead({
                    identityGroupId: identityAdmission.identityGroupId,
                }),
            ],
            testOnlyExposureClockNowEpochMs: 1_786_377_601_000,
            testOnlyExternalSellVisibilityHeads: [],
            testOnlyAllowUnverifiedIdentitySeed: false,
            testOnlyRequireCanonicalPnl: true,
        });
        openClients.add(client);
        await startReadyRuntime(client);
        await client.request(
            'insertStrategy',
            strategyInput({
                identityGroupId: identityAdmission.identityGroupId,
                identityAdmission,
            }),
        );
        const input = preparedIntentInput({
            runtimeEpochId: 'runtime-epoch-1',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            reservation: {
                identityGroupId: identityAdmission.identityGroupId,
            },
        });
        await expect(client.request('prepareIntent', input)).rejects.toThrow(
            'current account and identity canonical PnL heads are required',
        );
        expect((await client.request('status')).counts.order_intents).toBe(0);
        await expect(
            client.request('recordAccountReconciliation', {
                runtimeEpochId: 'runtime-epoch-1',
                senderFence: 'sender-fence-1',
                apiGeneration: 'api-generation-1',
                expectedFixedAccountCount: 1,
                identityAdmission,
                nowEpochMs: 1_786_377_600_800,
                reconciliation: completeAccountReconciliationProjection(),
            }),
        ).resolves.toMatchObject({
            canonicalPnlCurrent: true,
            runtimeReadinessContribution: true,
            brokerWriteAuthority: false,
        });
        const riskDatabase = new DatabaseSync(databasePath);
        riskDatabase
            .prepare(`
                UPDATE exposure_account_arbiter_heads
                   SET daily_loss_limit_minor_units=400
                 WHERE account_broker_ref='broker-A'
                   AND account_id_ref='account-A'
            `)
            .run();
        await expect(client.request('prepareIntent', input)).rejects.toThrow(
            'canonical account or identity daily-loss limit is exceeded',
        );
        riskDatabase
            .prepare(`
                UPDATE exposure_account_arbiter_heads
                   SET daily_loss_limit_minor_units=1000
                 WHERE account_broker_ref='broker-A'
                   AND account_id_ref='account-A'
            `)
            .run();
        riskDatabase
            .prepare(`
                UPDATE exposure_identity_arbiter_heads
                   SET daily_loss_limit_minor_units=400
                 WHERE identity_group_id=?
            `)
            .run(identityAdmission.identityGroupId);
        await expect(client.request('prepareIntent', input)).rejects.toThrow(
            'canonical account or identity daily-loss limit is exceeded',
        );
        riskDatabase
            .prepare(`
                UPDATE exposure_identity_arbiter_heads
                   SET daily_loss_limit_minor_units=1000
                 WHERE identity_group_id=?
            `)
            .run(identityAdmission.identityGroupId);
        await expect(client.request('prepareIntent', input)).resolves.toMatchObject({
            intentId: 'intent-1',
            state: 'prepared',
            adapterAuthorityGranted: false,
        });
        const database = new DatabaseSync(databasePath, { readOnly: true });
        const reconciliationEvidenceHash = database.prepare(`
            SELECT reconciliation_evidence_hash FROM runtime_epochs
             WHERE runtime_epoch_id='runtime-epoch-1'
        `).get().reconciliation_evidence_hash;
        database.close();
        await client.request(
            'rearmPreparedIntent',
            rearmInput({ reconciliationEvidenceHash }),
        );
        riskDatabase
            .prepare(`
                UPDATE exposure_account_arbiter_heads
                   SET daily_loss_limit_minor_units=400
                 WHERE account_broker_ref='broker-A'
                   AND account_id_ref='account-A'
            `)
            .run();
        await expect(
            client.request('markIntentDispatching', dispatchInput()),
        ).rejects.toThrow(
            'canonical account or identity daily-loss limit is exceeded',
        );
        riskDatabase.close();
        await client.close();
        openClients.delete(client);
    });

    it('rebuilds the full-day PnL head after a midday Runtime restart and expires it after five seconds', async () => {
        const databasePath = await temporaryDatabasePath();
        const expectation = await prepareRepositoryExpectation(databasePath, false);
        const identityAdmission = await signedIdentityAdmission({
            identityKeyPath: expectation.identityKeyPath,
            issuedAtEpochMs: 1_786_377_600_100,
        });
        const baseOptions = {
            databasePath,
            ...expectation,
            testOnlyExposureArbiterHeads: [
                defaultExposureArbiterHead({
                    identityGroupId: identityAdmission.identityGroupId,
                }),
            ],
            testOnlyExternalSellVisibilityHeads: [],
            testOnlyAllowUnverifiedIdentitySeed: false,
            testOnlyRequireCanonicalPnl: true,
        };
        const first = await openSmartOrderRepository({
            ...baseOptions,
            testOnlyExposureClockNowEpochMs: 1_786_377_601_000,
        });
        openClients.add(first);
        await startReadyRuntime(first, {
            runtimeEpochId: 'runtime-pnl-before-restart',
            senderFence: 'fence-pnl-before-restart',
            apiGeneration: 'generation-pnl-before-restart',
        });
        await first.request('recordAccountReconciliation', {
            runtimeEpochId: 'runtime-pnl-before-restart',
            senderFence: 'fence-pnl-before-restart',
            apiGeneration: 'generation-pnl-before-restart',
            expectedFixedAccountCount: 1,
            identityAdmission,
            nowEpochMs: 1_786_377_600_800,
            reconciliation: completeAccountReconciliationProjection(),
        });
        await first.close();
        openClients.delete(first);

        const restarted = await openSmartOrderRepository({
            ...baseOptions,
            testOnlyExposureClockNowEpochMs: 1_786_377_601_000,
        });
        openClients.add(restarted);
        await startReadyRuntime(restarted, {
            runtimeEpochId: 'runtime-pnl-after-restart',
            senderFence: 'fence-pnl-after-restart',
            apiGeneration: 'generation-pnl-after-restart',
        });
        await restarted.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-pnl-after-restart',
                identityGroupId: identityAdmission.identityGroupId,
                identityAdmission,
            }),
        );
        const afterRestartIntent = preparedIntentInput({
            strategyId: 'strategy-pnl-after-restart',
            runtimeEpochId: 'runtime-pnl-after-restart',
            senderFence: 'fence-pnl-after-restart',
            apiGeneration: 'generation-pnl-after-restart',
            activation: {
                activationId: 'activation-pnl-after-restart',
            },
            intent: {
                intentId: 'intent-pnl-after-restart',
                clientRequestId: 'request-pnl-after-restart',
            },
            reservation: {
                reservationId: 'reservation-pnl-after-restart',
                identityGroupId: identityAdmission.identityGroupId,
            },
        });
        await expect(
            restarted.request('prepareIntent', afterRestartIntent),
        ).rejects.toThrow(
            'current account and identity canonical PnL heads are required',
        );
        await expect(
            restarted.request('recordAccountReconciliation', {
                runtimeEpochId: 'runtime-pnl-after-restart',
                senderFence: 'fence-pnl-after-restart',
                apiGeneration: 'generation-pnl-after-restart',
                expectedFixedAccountCount: 1,
                identityAdmission,
                nowEpochMs: 1_786_377_600_900,
                reconciliation: completeAccountReconciliationProjection(),
            }),
        ).resolves.toMatchObject({
            canonicalPnlCurrent: true,
            runtimeReadinessContribution: true,
        });
        await expect(
            restarted.request('prepareIntent', afterRestartIntent),
        ).resolves.toMatchObject({
            intentId: 'intent-pnl-after-restart',
            state: 'prepared',
            adapterAuthorityGranted: false,
        });
        await restarted.close();
        openClients.delete(restarted);

        const expired = await openSmartOrderRepository({
            ...baseOptions,
            testOnlyExposureClockNowEpochMs: 1_786_377_605_701,
        });
        openClients.add(expired);
        await expired.request(
            'insertStrategy',
            strategyInput({
                strategyId: 'strategy-pnl-expired',
                identityGroupId: identityAdmission.identityGroupId,
                identityAdmission,
            }),
        );
        await expect(
            expired.request(
                'prepareIntent',
                preparedIntentInput({
                    strategyId: 'strategy-pnl-expired',
                    runtimeEpochId: 'runtime-pnl-after-restart',
                    senderFence: 'fence-pnl-after-restart',
                    apiGeneration: 'generation-pnl-after-restart',
                    activation: { activationId: 'activation-pnl-expired' },
                    intent: {
                        intentId: 'intent-pnl-expired',
                        clientRequestId: 'request-pnl-expired',
                    },
                    reservation: {
                        reservationId: 'reservation-pnl-expired',
                        identityGroupId: identityAdmission.identityGroupId,
                    },
                }),
            ),
        ).rejects.toThrow(
            'current account and identity canonical PnL heads are required',
        );
        expect((await expired.request('status')).counts.order_intents).toBe(1);
        await expired.close();
        openClients.delete(expired);

        const verified = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            verified
                .prepare(`
                    SELECT COUNT(*) AS count FROM canonical_pnl_deals
                     WHERE account_broker_ref='broker-A'
                       AND account_id_ref='account-A'
                       AND trade_date='2026-08-11'
                `)
                .get(),
        ).toEqual({ count: 1 });
        verified.close();
    });

    it('projects the reason matrix and atomically applies only server-derived unique final evidence', async () => {
        const resolutionNow = Date.now();
        const setup = await openRepository();
        await startReadyRuntime(setup.client, {
            runtimeEpochId: 'runtime-manual-resolution',
            senderFence: 'fence-manual-resolution',
            apiGeneration: 'generation-manual-resolution',
        });
        await setup.client.request(
            'insertStrategy',
            strategyInput({ state: 'monitoring' }),
        );
        await setup.client.close();
        openClients.delete(setup.client);

        const seed = new DatabaseSync(setup.databasePath);
        const correlationKeyHash = `sha256:${createHash('sha256')
            .update(
                [
                    'broker-A',
                    'account-A',
                    '2026-08-11',
                    'TSE:2330:STK:Common',
                    'Buy',
                    'trade-final',
                    'order-final',
                    'deal-final',
                    'seq-final',
                    'ord-final',
                    'exchange-final',
                ].join('\u001f'),
            )
            .digest('hex')}`;
        seed.exec('BEGIN IMMEDIATE');
        try {
            seed.prepare(`
                UPDATE strategies
                   SET state='manual_intervention', revision=1,
                       updated_at_epoch_ms=1786377600200
                 WHERE strategy_id='strategy-1'
            `).run();
            seed.prepare(`
                INSERT INTO activations(
                    activation_id, strategy_id, logical_key, state,
                    generation, evidence_hash, created_at_epoch_ms,
                    updated_at_epoch_ms, revision
                ) VALUES ('activation-manual-final', 'strategy-1', 'edge-final',
                          'unknown', 1, ?, 1786377600100, 1786377600200, 0)
            `).run(DIGEST_A);
            seed.prepare(`
                INSERT INTO order_intents(
                    intent_id, activation_id, strategy_id, operation_kind,
                    owner_kind, state, terminal_outcome, payload_hash,
                    payload_json, client_request_id, account_broker_ref,
                    account_id_ref, trade_date, contract_key, side,
                    runtime_epoch_id, sender_fence, api_generation,
                    adapter_authority_granted, created_at_epoch_ms,
                    updated_at_epoch_ms, revision
                ) VALUES (
                    'intent-manual-final', 'activation-manual-final',
                    'strategy-1', 'place', 'activation', 'unknown', NULL,
                    ?, ?, 'request-manual-final', 'broker-A', 'account-A',
                    '2026-08-11', 'TSE:2330:STK:Common', 'Buy',
                    'runtime-manual-resolution', 'fence-manual-resolution',
                    'generation-manual-resolution', 1,
                    1786377600100, 1786377600200, 0
                )
            `).run(
                INTENT_PAYLOAD_DIGEST,
                canonicalJson(CANONICAL_INTENT_PAYLOAD),
            );
            seed.prepare(`
                INSERT INTO broker_orders(
                    broker_order_id, intent_id, state, control_revision,
                    quantity_shares, filled_shares, remaining_shares,
                    evidence_hash, updated_at_epoch_ms,
                    terminal_at_epoch_ms, revision
                ) VALUES ('broker-order-manual-final', 'intent-manual-final',
                          'filled', 0, 1000, 1000, 0, ?,
                          1786377600300, 1786377600300, 0)
            `).run(DIGEST_B);
            seed.prepare(`
                INSERT INTO broker_correlations(
                    correlation_id, intent_id, broker_order_id,
                    canonical_key_hash, account_broker_ref, account_id_ref,
                    trade_date, contract_key, side, trade_id, order_id,
                    deal_id, seqno, ordno, exchange_sequence, custom_field,
                    evidence_hash, created_at_epoch_ms, revision
                ) VALUES ('correlation-manual-final', 'intent-manual-final',
                          'broker-order-manual-final', ?, 'broker-A',
                          'account-A', '2026-08-11',
                          'TSE:2330:STK:Common', 'Buy', 'trade-final',
                          'order-final', 'deal-final', 'seq-final',
                          'ord-final', 'exchange-final', NULL, ?,
                          1786377600300, 0)
            `).run(correlationKeyHash, DIGEST_A);
            const correlationIdentifierInsert = seed.prepare(`
                INSERT INTO broker_correlation_identifiers(
                    account_broker_ref, account_id_ref, trade_date,
                    contract_key, side, identifier_kind, identifier_value,
                    intent_id, correlation_id, created_at_epoch_ms
                ) VALUES ('broker-A', 'account-A', '2026-08-11',
                          'TSE:2330:STK:Common', 'Buy', ?, ?,
                          'intent-manual-final', 'correlation-manual-final',
                          1786377600300)
            `);
            for (const [kind, value] of [
                ['tradeId', 'trade-final'],
                ['orderId', 'order-final'],
                ['dealId', 'deal-final'],
                ['seqno', 'seq-final'],
                ['ordno', 'ord-final'],
                ['exchangeSequence', 'exchange-final'],
            ]) {
                correlationIdentifierInsert.run(kind, value);
            }
            seed.prepare(`
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
                    ?, ?, 'intent-manual-final', 'mapping/1',
                    'generation-manual-resolution', 'deal', 'broker-A',
                    'account-A', '2026-08-11', 'TSE:2330:STK:Common',
                    'Buy', 'trade-final', 'order-final', 'deal-final',
                    'seq-final', 'ord-final', 'exchange-final', NULL,
                    NULL, NULL, NULL, 'Filled', 'Cash', 'Common', 'LMT',
                    'ROD', 1000, 1000, 0, 0, 1000, 'Share', '100.00',
                    ?, ?, ?,
                    ?, ?
                )
            `).run(
                DIGEST_B,
                correlationKeyHash,
                resolutionNow - 7_000,
                resolutionNow - 7_000,
                resolutionNow - 7_000,
                DIGEST_B,
                DIGEST_A,
            );
            seed.prepare(`
                INSERT INTO broker_event_heads(
                    account_broker_ref, account_id_ref, trade_date,
                    broker_order_correlation_key_hash, intent_id, status,
                    order_quantity, cumulative_deal_quantity,
                    cumulative_cancel_quantity, remaining_quantity,
                    quantity_unit, exchange_epoch_ms,
                    broker_event_key_hash, evidence_hash, revision
                ) VALUES ('broker-A', 'account-A', '2026-08-11', ?,
                          'intent-manual-final', 'Filled', 1000, 1000, 0, 0,
                          'Share', ?, ?, ?, 0)
            `).run(
                correlationKeyHash,
                resolutionNow - 7_000,
                DIGEST_B,
                DIGEST_B,
            );
            seed.prepare(`
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
                ) VALUES ('broker-A', 'account-A', '2026-08-11',
                          ?, 'reconciliation/1', ?, ?, ?, ?,
                          0, 0, 0, 0, 0, 1, ?, 0)
            `).run(
                resolutionNow - 6_000,
                DIGEST_A,
                DIGEST_A,
                DIGEST_B,
                DIGEST_B,
                resolutionNow - 6_000,
            );
            seed.prepare(`
                INSERT INTO resolution_cases(
                    resolution_case_id, strategy_id, reason_code, scope_hash,
                    evidence_snapshot_hash, state, created_at_epoch_ms,
                    updated_at_epoch_ms, terminal_at_epoch_ms, revision
                ) VALUES ('resolution-manual-final', 'strategy-1',
                          'BROKER_OUTCOME_UNKNOWN', ?, ?, 'open',
                          1786377600200, 1786377600200, NULL, 0)
            `).run(DIGEST_A, DIGEST_B);
            seed.prepare(`
                INSERT INTO safety_blockers(
                    blocker_id, resolution_case_id, scope_hash, reason_code,
                    state, created_at_epoch_ms, resolved_at_epoch_ms, revision
                ) VALUES ('blocker-manual-final', 'resolution-manual-final',
                          ?, 'BROKER_OUTCOME_UNKNOWN', 'open',
                          1786377600200, NULL, 0)
            `).run(DIGEST_A);
            seed.exec('COMMIT');
        } catch (error) {
            seed.exec('ROLLBACK');
            throw error;
        } finally {
            seed.close();
        }

        const staleRepository = await openRepository({
            databasePath: setup.databasePath,
        });
        await expect(
            staleRepository.client.request('listManualResolutionCases', {
                strategyId: 'strategy-1',
            }),
        ).resolves.toMatchObject({
            cases: [
                {
                    uniqueFinalReady: false,
                    executableOperations: ['remain_open'],
                },
            ],
        });
        await staleRepository.client.close();
        openClients.delete(staleRepository.client);
        const refreshedReconciliation = new DatabaseSync(
            setup.databasePath,
        );
        refreshedReconciliation
            .prepare(`
                UPDATE account_reconciliation_heads
                   SET as_of_epoch_ms=?, updated_at_epoch_ms=?, revision=revision+1
                 WHERE account_broker_ref='broker-A'
                   AND account_id_ref='account-A'
                   AND trade_date='2026-08-11'
            `)
            .run(resolutionNow - 500, resolutionNow - 500);
        refreshedReconciliation.close();
        const reopened = await openRepository({
            databasePath: setup.databasePath,
        });
        const projection = await reopened.client.request(
            'listManualResolutionCases',
            { strategyId: 'strategy-1' },
        );
        expect(projection).toMatchObject({
            policySchemaVersion: 'smart-order-manual-resolution/2026-08-11.6',
            strategyId: 'strategy-1',
            strategyRevision: 1,
            strategyState: 'manual_intervention',
            genericResumeAllowed: false,
            brokerWriteAuthority: false,
            cases: [
                {
                    reasonCode: 'BROKER_OUTCOME_UNKNOWN',
                    uniqueFinalReady: true,
                    breakGlassAllowed: true,
                    oldIntentDisposition: 'never_resend',
                    accountIdentifiersExposed: false,
                    entityIdentifiersExposed: false,
                    brokerWriteAuthority: false,
                },
            ],
        });
        const resolutionKey = projection.cases[0].resolutionKey;
        const result = await reopened.client.request(
            'resolveManualIntervention',
            {
                runtimeEpochId: 'runtime-manual-resolution',
                senderFence: 'fence-manual-resolution',
                apiGeneration: 'generation-manual-resolution',
                strategyId: 'strategy-1',
                expectedRevision: 1,
                resolutionKey,
                operation: 'apply_unique_final_evidence',
                requestId: 'manual-resolution-operation-1',
                payloadHash: DIGEST_A,
                nowEpochMs: resolutionNow,
            },
        );
        expect(result).toMatchObject({
            state: 'completed',
            result: {
                strategyState: 'paused',
                resolutionState: 'resolved',
                originalIntentState: 'terminal',
                originalIntentRedispatchAllowed: false,
                brokerWriteAttempted: false,
                brokerAuthorityGranted: false,
            },
        });
        await expect(
            reopened.client.request('resolveManualIntervention', {
                runtimeEpochId: 'runtime-manual-resolution',
                senderFence: 'fence-manual-resolution',
                apiGeneration: 'generation-manual-resolution',
                strategyId: 'strategy-1',
                expectedRevision: 1,
                resolutionKey,
                operation: 'apply_unique_final_evidence',
                requestId: 'manual-resolution-operation-1',
                payloadHash: DIGEST_A,
                nowEpochMs: resolutionNow + 1,
            }),
        ).resolves.toMatchObject({
            state: 'completed',
            replayed: true,
            result: {
                originalIntentRedispatchAllowed: false,
            },
        });
        await reopened.client.close();
        openClients.delete(reopened.client);

        const verified = new DatabaseSync(setup.databasePath, {
            readOnly: true,
        });
        expect(
            verified
                .prepare(`
                    SELECT strategies.state AS strategy_state,
                           intents.state AS intent_state,
                           intents.terminal_outcome,
                           activations.state AS activation_state,
                           cases.state AS case_state,
                           blockers.state AS blocker_state
                      FROM strategies
                      JOIN order_intents AS intents USING(strategy_id)
                      JOIN activations USING(activation_id)
                      JOIN resolution_cases AS cases USING(strategy_id)
                      JOIN safety_blockers AS blockers
                        USING(resolution_case_id)
                     WHERE strategies.strategy_id='strategy-1'
                `)
                .get(),
        ).toEqual({
            strategy_state: 'paused',
            intent_state: 'terminal',
            terminal_outcome: 'place_filled_unique_final',
            activation_state: 'filled',
            case_state: 'resolved',
            blocker_state: 'resolved',
        });
        verified.close();
    });

    it('keeps manual state and replay outcome failed when final evidence is incomplete', async () => {
        const setup = await openRepository();
        await startReadyRuntime(setup.client, {
            runtimeEpochId: 'runtime-manual-incomplete',
            senderFence: 'fence-manual-incomplete',
            apiGeneration: 'generation-manual-incomplete',
        });
        await setup.client.request(
            'insertStrategy',
            strategyInput({ state: 'manual_intervention' }),
        );
        await setup.client.close();
        openClients.delete(setup.client);
        const seed = new DatabaseSync(setup.databasePath);
        seed.prepare(`
            INSERT INTO resolution_cases(
                resolution_case_id, strategy_id, reason_code, scope_hash,
                evidence_snapshot_hash, state, created_at_epoch_ms,
                updated_at_epoch_ms, terminal_at_epoch_ms, revision
            ) VALUES ('resolution-incomplete', 'strategy-1',
                      'BROKER_OUTCOME_UNKNOWN', ?, ?, 'open',
                      1786377600200, 1786377600200, NULL, 0)
        `).run(DIGEST_A, DIGEST_B);
        seed.close();
        const reopened = await openRepository({
            databasePath: setup.databasePath,
        });
        const projection = await reopened.client.request(
            'listManualResolutionCases',
            { strategyId: 'strategy-1' },
        );
        expect(projection.cases[0]).toMatchObject({
            uniqueFinalReady: false,
            executableOperations: ['remain_open'],
        });
        const result = await reopened.client.request(
            'resolveManualIntervention',
            {
                runtimeEpochId: 'runtime-manual-incomplete',
                senderFence: 'fence-manual-incomplete',
                apiGeneration: 'generation-manual-incomplete',
                strategyId: 'strategy-1',
                expectedRevision: 0,
                resolutionKey: projection.cases[0].resolutionKey,
                operation: 'apply_unique_final_evidence',
                requestId: 'manual-resolution-incomplete-operation',
                payloadHash: DIGEST_A,
                nowEpochMs: 1_786_377_600_500,
            },
        );
        expect(result).toMatchObject({
            state: 'failed',
            mayExecute: false,
        });
        expect(
            await reopened.client.request('getStrategy', {
                strategyId: 'strategy-1',
            }),
        ).toMatchObject({ state: 'manual_intervention', revision: 0 });
        await reopened.client.close();
        openClients.delete(reopened.client);
    });

    it('performs idempotent graceful shutdown and rejects subsequent requests', async () => {
        const { client } = await openRepository();
        const firstClose = client.close();
        const secondClose = client.close();
        await expect(client.request('status')).rejects.toThrow('closing');
        await expect(Promise.all([firstClose, secondClose])).resolves.toEqual([
            undefined,
            undefined,
        ]);
        openClients.delete(client);
        await expect(client.close()).resolves.toBeUndefined();
        await expect(client.request('status')).rejects.toThrow('closed');
    });
});
