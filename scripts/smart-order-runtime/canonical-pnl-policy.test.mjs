import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json.mjs';
import {
    SMART_ORDER_CANONICAL_PNL_POLICY,
    SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
    SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
    assertCanonicalPnlPolicyBinding,
    recalculateCanonicalPnlTotals,
} from './canonical-pnl-policy.mjs';

const deals = Object.freeze([
    Object.freeze({
        dealId: 'deal-before-runtime',
        realizedMinorUnits: -50_000,
        feeMinorUnits: 100,
        transactionTaxMinorUnits: 300,
    }),
    Object.freeze({
        dealId: 'deal-after-restart',
        realizedMinorUnits: 10_000,
        feeMinorUnits: 20,
        transactionTaxMinorUnits: 60,
    }),
]);

describe('production canonical PnL policy', () => {
    it('pins all four components, dual aggregation, Asia/Taipei and the 5 second TTL', () => {
        expect(SMART_ORDER_CANONICAL_PNL_POLICY).toMatchObject({
            policyRevision: SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
            policyDefinitionSha256:
                SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
            tradeDateTimeZone: 'Asia/Taipei',
            aggregation: ['per_account', 'identity_group'],
            freshnessTtlMs: 5_000,
            resetGate:
                'official_calendar_business_session_all_accounts_reconciled',
        });
        expect(
            SMART_ORDER_CANONICAL_PNL_POLICY.componentSources.map(
                (entry) => entry.component,
            ),
        ).toEqual(['realized', 'unrealized', 'fee', 'transaction_tax']);
        expect(
            SMART_ORDER_CANONICAL_PNL_POLICY.componentSources.every(
                (entry) =>
                    entry.coverage ===
                    'current_trade_date_full_account_scoped',
            ),
        ).toBe(true);
        expect(() =>
            assertCanonicalPnlPolicyBinding({
                policyRevision: 'stale-policy',
                policyDefinitionSha256:
                    SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
            }),
        ).toThrow('not current');
        expect(() => canonicalJson(SMART_ORDER_CANONICAL_PNL_POLICY)).not.toThrow();
    });

    it('recomputes from a deduplicated ledger independent of delivery order', () => {
        const positions = [{ unrealizedMinorUnits: -2_000 }];
        const expected = {
            realizedMinorUnits: -40_000,
            unrealizedMinorUnits: -2_000,
            feeMinorUnits: 120,
            transactionTaxMinorUnits: 360,
            netMinorUnits: -42_480,
        };
        expect(
            recalculateCanonicalPnlTotals({ deals, positions }),
        ).toEqual(expected);
        expect(
            recalculateCanonicalPnlTotals({
                deals: [deals[1], deals[0], deals[1]],
                positions,
            }),
        ).toEqual(expected);
    });

    it('rejects conflicting duplicate deals and missing position PnL', () => {
        expect(() =>
            recalculateCanonicalPnlTotals({
                deals: [
                    deals[0],
                    { ...deals[0], feeMinorUnits: 101 },
                ],
                positions: [],
            }),
        ).toThrow('conflicting PnL evidence');
        expect(() =>
            recalculateCanonicalPnlTotals({
                deals,
                positions: [{}],
            }),
        ).toThrow('position.unrealizedMinorUnits');
    });
});
