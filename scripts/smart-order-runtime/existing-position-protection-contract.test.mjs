import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_EXISTING_POSITION_PROTECTION_PLAN_SCHEMA_VERSION,
    canonicalExistingPositionProtectionPlan,
    deriveExistingPositionFormalProtection,
} from './existing-position-protection-contract.mjs';
import { buildSmartOrderProtectiveBrokerIntentPayload } from './broker-execution-policy.mjs';
import { evaluateSmartOrderProtectiveTrigger } from './protective-trigger-evaluator.mjs';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;

function plan(distance = { kind: 'pct_bps', pctBps: 500 }) {
    return {
        schemaVersion:
            SMART_ORDER_EXISTING_POSITION_PROTECTION_PLAN_SCHEMA_VERSION,
        accountBrokerRef: 'broker-A',
        accountIdRef: 'account-A',
        basis: { source: 'broker_average_cost', priceDecimal: '100' },
        confirmationSnapshotHash: DIGEST_A,
        contractKey: 'TSE:2330:STK:Common',
        contractPricePolicy: {
            categoryCode: '24',
            limitDownMinorUnits: 9_000,
            limitUpMinorUnits: 11_000,
        },
        contractUnit: 1_000,
        position: {
            accountHeadRevision: 3,
            availableShares: 1_000,
            evidenceHash: DIGEST_B,
            lineageId: 'position-A',
            quantityShares: 1_000,
        },
        protection: {
            family: 'fixed',
            legs: [
                {
                    comparator: 'lte',
                    distance,
                    execution: {
                        limitPrice: '95',
                        priceType: 'LMT',
                        timeInForce: 'ROD',
                    },
                    legId: 'stop',
                    type: 'stop',
                },
                {
                    comparator: 'gte',
                    distance,
                    execution: {
                        limitPrice: '105',
                        priceType: 'LMT',
                        timeInForce: 'IOC',
                    },
                    legId: 'take',
                    type: 'take',
                },
            ],
        },
        riskRevision: 'risk-policy-1',
        tradeDate: '2026-08-21',
    };
}

describe('existing-position protection contract', () => {
    it('derives fixed stop/take from broker average cost and reuses the OCO execution policy without broker authority', () => {
        const canonical = canonicalExistingPositionProtectionPlan(plan());
        const formal = deriveExistingPositionFormalProtection(
            canonical.plan,
            1_000,
        );
        expect(formal.legs.map((leg) => [leg.type, leg.triggerPrice])).toEqual([
            ['stop', { numeratorMinorUnits: '9500', denominator: '1' }],
            ['take', { numeratorMinorUnits: '10500', denominator: '1' }],
        ]);
        expect(
            evaluateSmartOrderProtectiveTrigger({
                formalProtection: formal,
                observedPrice: '105',
                previousHead: null,
                protectionPlan: canonical.plan,
            }),
        ).toMatchObject({
            family: 'fixed',
            nextState: 'triggered',
            triggeredLegIds: ['take'],
        });
        expect(
            buildSmartOrderProtectiveBrokerIntentPayload({
                legId: 'take',
                protectionPlan: canonical.plan,
                quantityShares: 1_000,
                triggerPolicyHash: DIGEST_A,
            }),
        ).toMatchObject({
            payload: {
                automaticRetryAllowed: false,
                contractUnit: 1_000,
                execution: {
                    limitPrice: '105',
                    priceType: 'LMT',
                    timeInForce: 'IOC',
                },
                iocRemainderDisposition: 'manual_reconciliation_no_retry',
                quantityShares: 1_000,
            },
        });
    });

    it('freezes fixed ATR at confirmation and fail-closes quantity, clone, accessor, and Proxy drift', () => {
        const fixedAtr = {
            atr: '2',
            atrSnapshotRevision: 'atr-2026-08-20-r1',
            kind: 'fixed_atr',
            multiplier: '2',
        };
        const candidate = plan(fixedAtr);
        const canonical = canonicalExistingPositionProtectionPlan(candidate);
        const formal = deriveExistingPositionFormalProtection(
            canonical.plan,
            1_000,
        );
        expect(formal.fixedAtrSnapshotSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(formal.legs.map((leg) => [leg.type, leg.triggerPrice])).toEqual([
            ['stop', { numeratorMinorUnits: '9600', denominator: '1' }],
            ['take', { numeratorMinorUnits: '10400', denominator: '1' }],
        ]);
        expect(() =>
            deriveExistingPositionFormalProtection(canonical.plan, 1_001),
        ).toThrow('exceeds confirmed available shares');
        expect(() =>
            canonicalExistingPositionProtectionPlan({
                ...candidate,
                unexpected: true,
            }),
        ).toThrow('fields do not match');
        let reads = 0;
        const accessor = { ...candidate };
        Object.defineProperty(accessor, 'riskRevision', {
            enumerable: true,
            get() {
                reads += 1;
                return 'risk-policy-forged';
            },
        });
        expect(() => canonicalExistingPositionProtectionPlan(accessor)).toThrow(
            'own data property',
        );
        expect(reads).toBe(0);
        expect(() =>
            canonicalExistingPositionProtectionPlan(
                new Proxy(candidate, {
                    ownKeys() {
                        throw new Error('trap must not run');
                    },
                }),
            ),
        ).toThrow('non-Proxy');
    });

    it('keeps trailing activation and fixed stop formal while retracement waits for the durable saved high', () => {
        const candidate = plan();
        candidate.protection = {
            family: 'trailing',
            legs: [
                {
                    comparator: 'gte',
                    distance: { kind: 'absolute', value: '3' },
                    execution: {
                        limitPrice: null,
                        priceType: 'MKT',
                        timeInForce: 'IOC',
                    },
                    legId: 'activate',
                    type: 'trailing_activation',
                },
                {
                    comparator: 'lte',
                    distance: {
                        atr: '2',
                        atrSnapshotRevision: 'atr-2026-08-20-r1',
                        kind: 'fixed_atr',
                        multiplier: '2',
                    },
                    execution: {
                        limitPrice: null,
                        priceType: 'MKT',
                        timeInForce: 'IOC',
                    },
                    legId: 'retrace',
                    type: 'trailing_retracement',
                },
                {
                    comparator: 'lte',
                    distance: { kind: 'absolute', value: '5' },
                    execution: {
                        limitPrice: null,
                        priceType: 'MKT',
                        timeInForce: 'IOC',
                    },
                    legId: 'fixed-stop',
                    type: 'fixed_stop',
                },
            ],
        };
        const canonical = canonicalExistingPositionProtectionPlan(candidate);
        const formal = deriveExistingPositionFormalProtection(
            canonical.plan,
            1_000,
        );
        expect(formal.legs).toMatchObject([
            {
                type: 'trailing_activation',
                triggerState: 'formal',
                triggerPrice: {
                    numeratorMinorUnits: '10300',
                    denominator: '1',
                },
            },
            {
                type: 'trailing_retracement',
                triggerState: 'pending_saved_high',
                triggerBasis: 'durable_saved_high',
                triggerPrice: null,
            },
            {
                type: 'fixed_stop',
                triggerState: 'formal',
                triggerPrice: {
                    numeratorMinorUnits: '9500',
                    denominator: '1',
                },
            },
        ]);
        expect(
            evaluateSmartOrderProtectiveTrigger({
                formalProtection: formal,
                observedPrice: '103',
                previousHead: null,
                protectionPlan: canonical.plan,
            }),
        ).toMatchObject({
            family: 'trailing',
            nextState: 'active',
            savedHighDecimal: '103',
        });
    });
});
