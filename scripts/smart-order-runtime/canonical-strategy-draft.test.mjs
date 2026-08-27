import { describe, expect, it } from 'vitest';
import {
    assertCanonicalSmartOrderDraft,
    createEditableCanonicalSmartOrderDraft,
    isCanonicalSmartOrderDraft,
    SMART_ORDER_CANONICAL_DRAFT_UNSET_CONTRACT_KEY,
} from './canonical-strategy-draft.mjs';
import {
    canonicalSmartOrderDraft,
    canonicalSmartOrderDraftKinds,
} from './canonical-strategy-draft-fixtures.mjs';

describe('canonical smart-order draft boundary', () => {
    it('creates editable Runtime canonical drafts for all seven kinds without granting authority', () => {
        for (const kind of canonicalSmartOrderDraftKinds) {
            const draft = createEditableCanonicalSmartOrderDraft({
                kind,
                workspaceContractKey: 'OTC:STK:6488',
                nowEpochMs: 1_786_377_600_000,
            });

            expect(
                assertCanonicalSmartOrderDraft(draft, { expectedKind: kind }),
            ).toBe(draft);
            expect(Object.keys(draft).sort()).toEqual([
                'decisionTableVersion',
                'kind',
                'parameters',
                'schemaVersion',
            ]);
            expect(JSON.stringify(draft)).toContain('OTC:STK:6488');
            expect(JSON.stringify(draft)).toContain('draft-unverified');
            expect(JSON.stringify(draft)).not.toContain('account');
            expect(JSON.stringify(draft)).not.toContain('writeMaster');
            expect(JSON.stringify(draft)).not.toContain('brokerWrite');
        }
    });

    it('uses an explicit unverified sentinel when no workspace contract is linked', () => {
        const draft = createEditableCanonicalSmartOrderDraft({
            kind: 'trailing_exit',
            nowEpochMs: 1_786_377_600_000,
        });

        expect(draft.parameters.positionContractKey).toBe(
            SMART_ORDER_CANONICAL_DRAFT_UNSET_CONTRACT_KEY,
        );
        expect(draft.parameters.monitorContractKey).toBe(
            SMART_ORDER_CANONICAL_DRAFT_UNSET_CONTRACT_KEY,
        );
        expect(draft.parameters.order.contractKey).toBe(
            SMART_ORDER_CANONICAL_DRAFT_UNSET_CONTRACT_KEY,
        );
        expect(draft.parameters.positionEvidenceRevision).toBe(
            'draft-unverified',
        );
    });

    it('derives the editable validity date at the Asia/Taipei day boundary', () => {
        const beforeMidnight = createEditableCanonicalSmartOrderDraft({
            kind: 'quick',
            nowEpochMs: Date.parse('2026-08-10T15:59:59.999Z'),
        });
        const afterMidnight = createEditableCanonicalSmartOrderDraft({
            kind: 'quick',
            nowEpochMs: Date.parse('2026-08-10T16:00:00.000Z'),
        });

        expect(beforeMidnight.parameters.validity).toMatchObject({
            startDate: '2026-08-10',
            endDate: '2026-08-10',
        });
        expect(afterMidnight.parameters.validity).toMatchObject({
            startDate: '2026-08-11',
            endDate: '2026-08-11',
        });
    });

    it('rejects unsupported kind, contract, or timestamp before persistence', () => {
        expect(() =>
            createEditableCanonicalSmartOrderDraft({
                kind: 'unknown',
                nowEpochMs: 1,
            }),
        ).toThrow('kind is unsupported');
        expect(() =>
            createEditableCanonicalSmartOrderDraft({
                kind: 'quick',
                workspaceContractKey: 'NASDAQ:STK:AAPL',
                nowEpochMs: 1,
            }),
        ).toThrow('first-phase TSE/OTC STK contract');
        expect(() =>
            createEditableCanonicalSmartOrderDraft({
                kind: 'quick',
                nowEpochMs: Number.NaN,
            }),
        ).toThrow('safe integer');
    });

    it('accepts each of the seven exact versioned discriminators', () => {
        for (const kind of canonicalSmartOrderDraftKinds) {
            const draft = canonicalSmartOrderDraft(kind);
            expect(
                assertCanonicalSmartOrderDraft(draft, { expectedKind: kind }),
            ).toBe(draft);
        }
    });

    it('keeps scheduled modes single-day with separate disabled field shapes', () => {
        const timed = canonicalSmartOrderDraft('scheduled_quantity');
        const quantity = canonicalSmartOrderDraft('scheduled_quantity');
        quantity.parameters.mode = 'quantity';
        quantity.parameters.endTime = null;
        quantity.parameters.targetBaseShares = '5000';
        quantity.parameters.perOrderBaseShares = '2000';

        expect(isCanonicalSmartOrderDraft(timed)).toBe(true);
        expect(isCanonicalSmartOrderDraft(quantity)).toBe(true);

        const timedWithoutEnd = structuredClone(timed);
        timedWithoutEnd.parameters.endTime = null;
        const timedWithCallerSplit = structuredClone(timed);
        timedWithCallerSplit.parameters.perOrderBaseShares = '1000';
        const quantityWithEnd = structuredClone(quantity);
        quantityWithEnd.parameters.endTime = '13:30:00';
        const quantityWithoutPerOrder = structuredClone(quantity);
        quantityWithoutPerOrder.parameters.perOrderBaseShares = null;
        const crossDate = structuredClone(timed);
        crossDate.parameters.validity.endDate = '2026-08-12';

        for (const invalid of [
            timedWithoutEnd,
            timedWithCallerSplit,
            quantityWithEnd,
            quantityWithoutPerOrder,
            crossDate,
        ]) {
            expect(isCanonicalSmartOrderDraft(invalid)).toBe(false);
        }
    });

    it('accepts only the three first-phase price and time-in-force combinations', () => {
        const limitRod = canonicalSmartOrderDraft('quick');
        const limitIoc = canonicalSmartOrderDraft('quick');
        limitIoc.parameters.order.timeInForce = 'IOC';
        const marketIoc = canonicalSmartOrderDraft('quick');
        marketIoc.parameters.order.priceType = 'MKT';
        marketIoc.parameters.order.limitPrice = null;
        marketIoc.parameters.order.timeInForce = 'IOC';

        expect(isCanonicalSmartOrderDraft(limitRod)).toBe(true);
        expect(isCanonicalSmartOrderDraft(limitIoc)).toBe(true);
        expect(isCanonicalSmartOrderDraft(marketIoc)).toBe(true);
    });

    it('rejects market ROD and unsupported FOK before persistence or proxying', () => {
        const marketRod = canonicalSmartOrderDraft('quick');
        marketRod.parameters.order.priceType = 'MKT';
        marketRod.parameters.order.limitPrice = null;
        const limitFok = canonicalSmartOrderDraft('quick');
        limitFok.parameters.order.timeInForce = 'FOK';

        expect(isCanonicalSmartOrderDraft(marketRod)).toBe(false);
        expect(isCanonicalSmartOrderDraft(limitFok)).toBe(false);
    });
});
