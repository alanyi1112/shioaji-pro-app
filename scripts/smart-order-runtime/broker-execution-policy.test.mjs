import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_PROTECTIVE_BROKER_INTENT_SCHEMA_VERSION,
    buildSmartOrderProtectiveBrokerIntentPayload,
    canonicalSmartOrderProtectiveBrokerIntentPayload,
    evaluateSmartOrderBrokerExecutionPolicy,
} from './broker-execution-policy.mjs';
import {
    SMART_ORDER_PROTECTED_ENTRY_PLAN_SCHEMA_VERSION,
    SMART_ORDER_PROTECTED_ENTRY_RISK_POLICY_SCHEMA_VERSION,
} from './protected-entry-contract.mjs';

const NOW = 1_800_000_000_000;
const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;

function input(order = {}, overrides = {}) {
    return {
        triggerPolicyHash: DIGEST_A,
        nowEpochMs: NOW,
        order: {
            contractKey: 'TSE:2330:STK:Common',
            side: 'Buy',
            priceType: 'LMT',
            timeInForce: 'ROD',
            limitPrice: '1200',
            policyRevision: 'execution-policy-1',
            ...order,
        },
        contractLimits: {
            categoryCode: '01',
            contractKey: 'TSE:2330:STK:Common',
            limitDown: '1080',
            limitUp: '1320',
            evidenceSha256: DIGEST_B,
            observedAtEpochMs: NOW - 1_000,
            validUntilEpochMs: NOW + 4_000,
        },
        ...overrides,
    };
}

describe('smart-order broker execution policy candidate', () => {
    it.each([
        ['LMT+ROD', { priceType: 'LMT', timeInForce: 'ROD', limitPrice: '1200' }],
        ['LMT+IOC', { priceType: 'LMT', timeInForce: 'IOC', limitPrice: '1200' }],
        ['MKT+IOC', { priceType: 'MKT', timeInForce: 'IOC', limitPrice: null }],
    ])('admits only the narrow %s candidate without write authority', (_label, order) => {
        expect(evaluateSmartOrderBrokerExecutionPolicy(input(order))).toMatchObject({
            candidateEligible: true,
            reason: null,
            triggerPolicySeparated: true,
            automaticRetryAllowed: false,
            mappingVerified: false,
            brokerWriteAuthority: false,
        });
    });

    it.each([
        [{ priceType: 'MKT', timeInForce: 'ROD', limitPrice: null }, 'order_policy_not_approved'],
        [{ priceType: 'LMT', timeInForce: 'FOK', limitPrice: '1200' }, 'order_policy_not_approved'],
        [{ priceType: 'MKP', timeInForce: 'IOC', limitPrice: null }, 'order_policy_not_approved'],
        [{ priceType: 'MKT', timeInForce: 'IOC', limitPrice: '1200' }, 'market_order_must_not_have_limit_price'],
    ])('rejects unsupported or hidden broker policy %#', (order, reason) => {
        expect(evaluateSmartOrderBrokerExecutionPolicy(input(order)).reason).toBe(reason);
    });

    it.each(['1075', '1325'])('rejects LMT price %s outside current limits', (limitPrice) => {
        expect(
            evaluateSmartOrderBrokerExecutionPolicy(input({ limitPrice })).reason,
        ).toBe('limit_price_outside_current_bounds');
    });

    it('accepts exact limit boundaries using integer minor units', () => {
        expect(evaluateSmartOrderBrokerExecutionPolicy(input({ limitPrice: '1080' })).candidateEligible).toBe(true);
        expect(evaluateSmartOrderBrokerExecutionPolicy(input({ limitPrice: '1320' })).candidateEligible).toBe(true);
    });

    it('rejects an off-tick stock LMT without coercion', () => {
        expect(
            evaluateSmartOrderBrokerExecutionPolicy(
                input({ limitPrice: '1200.01' }),
            ).reason,
        ).toBe('limit_price_not_on_current_tick');
    });

    it.each([
        [{ observedAtEpochMs: NOW + 1 }, 'contract_limit_evidence_not_current'],
        [{ validUntilEpochMs: NOW }, 'contract_limit_evidence_not_current'],
        [{ validUntilEpochMs: NOW + 5_000 }, 'contract_limit_evidence_not_current'],
        [{ contractKey: 'TSE:2317:STK:Common' }, 'contract_limit_evidence_not_current'],
        [{ limitDown: '1321' }, 'contract_limit_invalid'],
    ])('fails closed for stale, wrong-scope, or invalid limit evidence', (change, reason) => {
        const baseline = input();
        expect(
            evaluateSmartOrderBrokerExecutionPolicy({
                ...baseline,
                contractLimits: { ...baseline.contractLimits, ...change },
            }).reason,
        ).toBe(reason);
    });

    it('domain-separates trigger policy from execution policy', () => {
        const first = evaluateSmartOrderBrokerExecutionPolicy(input());
        const second = evaluateSmartOrderBrokerExecutionPolicy(
            input({}, { triggerPolicyHash: `sha256:${'c'.repeat(64)}` }),
        );
        expect(first.executionPolicyHash).not.toBe(second.executionPolicyHash);
        expect(first.order).toEqual(second.order);
    });

    it('never allows automatic retry for an IOC remainder', () => {
        const result = evaluateSmartOrderBrokerExecutionPolicy(
            input({ timeInForce: 'IOC' }),
        );
        expect(result).toMatchObject({
            candidateEligible: true,
            automaticRetryAllowed: false,
            iocRemainderDisposition: 'manual_reconciliation_no_retry',
        });
    });

    it('rejects extra keys, accessors, and Proxy without executing traps', () => {
        expect(
            evaluateSmartOrderBrokerExecutionPolicy({ ...input(), ready: true }).reason,
        ).toBe('input_schema_invalid');

        let reads = 0;
        const order = input().order;
        Object.defineProperty(order, 'limitPrice', {
            enumerable: true,
            get() {
                reads += 1;
                return '1200';
            },
        });
        expect(evaluateSmartOrderBrokerExecutionPolicy(input(order)).reason).toBe(
            null,
        );
        expect(reads).toBe(1);

        reads = 0;
        const direct = input();
        direct.order = order;
        expect(evaluateSmartOrderBrokerExecutionPolicy(direct).reason).toBe(
            'nested_schema_invalid',
        );
        expect(reads).toBe(0);

        let traps = 0;
        const proxy = new Proxy(input(), {
            get() {
                traps += 1;
                return undefined;
            },
        });
        expect(evaluateSmartOrderBrokerExecutionPolicy(proxy).reason).toBe(
            'input_schema_invalid',
        );
        expect(traps).toBe(0);
    });
});

function protectionPlan(execution = {}) {
    return {
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
            baseShares: 1_000,
            commonLots: 2,
            contractUnit: 500,
            priceType: 'LMT',
            timeInForce: 'ROD',
            limitPrice: '100',
        },
        fixedAtrSnapshot: null,
        protection: {
            family: 'fixed',
            legs: [
                {
                    legId: 'stop-leg',
                    type: 'stop',
                    comparator: 'lte',
                    distance: { kind: 'pct_bps', pctBps: 300 },
                    execution: {
                        priceType: 'MKT',
                        timeInForce: 'IOC',
                        limitPrice: null,
                        ...execution,
                    },
                },
            ],
        },
    };
}

describe('canonical protective broker intent', () => {
    it.each([
        ['LMT', 'ROD', '95', 'not_applicable'],
        ['LMT', 'IOC', '95', 'manual_reconciliation_no_retry'],
        ['MKT', 'IOC', null, 'manual_reconciliation_no_retry'],
    ])(
        'binds %s/%s separately from trigger truth without retry authority',
        (priceType, timeInForce, limitPrice, disposition) => {
            const projection = buildSmartOrderProtectiveBrokerIntentPayload({
                legId: 'stop-leg',
                protectionPlan: protectionPlan({
                    priceType,
                    timeInForce,
                    limitPrice,
                }),
                quantityShares: 1_000,
                triggerPolicyHash: DIGEST_A,
            });
            expect(projection.payload).toMatchObject({
                schemaVersion:
                    SMART_ORDER_PROTECTIVE_BROKER_INTENT_SCHEMA_VERSION,
                legId: 'stop-leg',
                quantityShares: 1_000,
                contractUnit: 500,
                triggerPolicyHash: DIGEST_A,
                execution: { priceType, timeInForce, limitPrice },
                automaticRetryAllowed: false,
                iocRemainderDisposition: disposition,
            });
            expect(
                canonicalSmartOrderProtectiveBrokerIntentPayload(
                    projection.payload,
                ),
            ).toEqual(projection);
        },
    );

    it('rejects legacy quantity-only and copied execution drift', () => {
        expect(() =>
            canonicalSmartOrderProtectiveBrokerIntentPayload({
                schemaVersion:
                    'smart-order-protective-broker-intent/2026-08-12.1',
                quantityShares: 1_000,
            }),
        ).toThrow('payload is invalid');
        const projection = buildSmartOrderProtectiveBrokerIntentPayload({
            legId: 'stop-leg',
            protectionPlan: protectionPlan(),
            quantityShares: 1_000,
            triggerPolicyHash: DIGEST_A,
        });
        expect(() =>
            canonicalSmartOrderProtectiveBrokerIntentPayload({
                ...projection.payload,
                iocRemainderDisposition: 'not_applicable',
            }),
        ).toThrow('remainder disposition');
    });
});
