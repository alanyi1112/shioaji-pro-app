import { describe, expect, it } from 'vitest';
import type { BrowserSmartOrderCanonicalDraft } from './smart-order-browser-draft';
import {
    applyCanonicalDraftSharedEdits,
    canonicalDraftSharedView,
    smartOrderActiveListBucket,
    smartOrderActivityStateLabel,
    smartOrderRuntimeDisplayState,
    smartOrderStatePresentation,
} from './smart-order-panel-model';

function quickDraft(): BrowserSmartOrderCanonicalDraft {
    return {
        schemaVersion: 'realtimestock.smart-order-strategy/v1',
        decisionTableVersion: '2026-08-11.2',
        kind: 'quick',
        parameters: {
            payloadSchemaVersion:
                'realtimestock.smart-order-strategy-payload/quick/v1',
            monitorContractKey: 'TSE:STK:2330',
            condition: {
                field: 'last_price',
                comparator: 'gte',
                threshold: '100',
                mappingRevision: 'quote-mapping-1',
            },
            order: {
                contractKey: 'TSE:STK:2330',
                side: 'Buy',
                orderCond: 'Cash',
                orderLot: 'Common',
                baseShares: '1000',
                commonLots: '1',
                contractUnit: '1000',
                priceType: 'LMT',
                limitPrice: '100',
                timeInForce: 'ROD',
                policyRevision: 'order-policy-1',
            },
            validity: {
                startDate: '2026-08-11',
                endDate: '2026-08-11',
                calendarVersion: 'tw-calendar-1',
            },
            activationPolicy: 'require_rearm',
        },
    };
}

function stopTakeDraft(): BrowserSmartOrderCanonicalDraft {
    const quick = quickDraft();
    if (quick.kind !== 'quick') throw new Error('quick fixture is invalid');
    return {
        schemaVersion: quick.schemaVersion,
        decisionTableVersion: quick.decisionTableVersion,
        kind: 'stop_take',
        parameters: {
            payloadSchemaVersion:
                'realtimestock.smart-order-strategy-payload/stop-take/v1',
            positionContractKey: 'TSE:STK:2330',
            monitorContractKey: 'TSE:STK:2330',
            positionEvidenceRevision: 'position-draft-1',
            basisPrice: '100',
            basisSource: 'broker_average_cost',
            legs: [
                {
                    legId: 'stop-leg',
                    type: 'stop',
                    distance: { kind: 'pct_bps', pctBps: 500 },
                    triggerPrice: '95',
                    triggerTicks: '190',
                },
            ],
            order: { ...quick.parameters.order, side: 'Sell' },
            validity: quick.parameters.validity,
            activationPolicy: 'require_rearm',
        },
    };
}

function multiConditionDraft(): BrowserSmartOrderCanonicalDraft {
    const quick = quickDraft();
    if (quick.kind !== 'quick') throw new Error('quick fixture is invalid');
    return {
        schemaVersion: quick.schemaVersion,
        decisionTableVersion: quick.decisionTableVersion,
        kind: 'multi_condition',
        parameters: {
            payloadSchemaVersion:
                'realtimestock.smart-order-strategy-payload/multi-condition/v1',
            conditions: [
                {
                    monitorContractKey: 'TSE:STK:2330',
                    condition: { ...quick.parameters.condition },
                },
            ],
            operator: 'AND',
            order: quick.parameters.order,
            validity: quick.parameters.validity,
            activationPolicy: 'require_rearm',
        },
    };
}

describe('smart-order panel pure model', () => {
    it('keeps only explicit observing states in monitoring and everything else in processing', () => {
        for (const state of ['observing', 'monitoring', 'paused']) {
            expect(smartOrderActiveListBucket(state)).toBe('monitoring');
        }
        for (const state of [
            'draft',
            'triggered',
            'dispatching',
            'submitted',
            'part_filled',
            'unknown',
            'recovery',
            'manual_intervention',
            'cancel_pending',
            'expired_with_obligation',
            'completed',
            'future_state',
        ]) {
            expect(smartOrderActiveListBucket(state)).toBe('processing');
        }
        expect(smartOrderStatePresentation('submitted')).toMatchObject({
            label: '已委託・未成交',
            highRisk: false,
        });
        expect(smartOrderStatePresentation('future_state')).toMatchObject({
            label: '未識別狀態（future_state）',
            highRisk: true,
        });
        expect(
            smartOrderActiveListBucket('monitoring', 'unknown'),
        ).toBe('processing');
        expect(
            smartOrderRuntimeDisplayState('monitoring', {
                displayState: 'dispatching',
            }),
        ).toBe('dispatching');
        expect(smartOrderActivityStateLabel('broker_working')).toBe(
            '券商委託未成交',
        );
    });

    it('keeps every task 7.10 lifecycle state semantically distinct', () => {
        const expected = {
            prepared: '已準備・尚未送出',
            pending_entry_fill: '等待進場成交',
            monitoring: '監控中',
            triggered: '條件已觸發',
            dispatching: '送出處理中',
            accepted: 'broker 已接受・未成交',
            part_filled: '部分成交',
            filled: '成交待結案',
            unfilled: '未成交待結案',
            unknown: '結果未知',
            unprotected: '未受保護',
            manual_intervention: '待人工處理',
        } as const;
        for (const [state, label] of Object.entries(expected)) {
            expect(smartOrderStatePresentation(state).label).toBe(label);
        }
        expect(smartOrderStatePresentation('accepted').detail).toContain(
            '接受不等於成交',
        );
        expect(smartOrderStatePresentation('unknown').highRisk).toBe(true);
        expect(smartOrderStatePresentation('unprotected').highRisk).toBe(true);
    });

    it('extracts only a fully canonical definition and never invents a fixed account', () => {
        expect(
            canonicalDraftSharedView(
                { kind: 'quick', workspaceContractKey: 'TSE:STK:2330' },
                false,
            ),
        ).toBeNull();
        const view = canonicalDraftSharedView(quickDraft(), false);
        expect(view).toMatchObject({
            fixedAccountLabel: '待 Runtime canonical confirmation 固定',
            order: {
                contractKey: 'TSE:STK:2330',
                orderCond: 'Cash',
                orderLot: 'Common',
                baseShares: '1000',
                commonLots: '1',
                contractUnit: '1000',
            },
            trigger: {
                field: 'last_price',
                comparator: 'gte',
                threshold: '100',
            },
            activationPolicy: 'require_rearm',
        });
    });

    it('rejects non-first-phase market, condition, lot, and price-policy payloads in the browser layer', () => {
        type MutableQuickDraft = {
            parameters: {
                monitorContractKey: string;
                order: {
                    contractKey: string;
                    orderCond: string;
                    orderLot: string;
                    priceType: string;
                    limitPrice: string | null;
                    timeInForce: string;
                };
            };
        };
        const invalidDefinitions: readonly ((draft: MutableQuickDraft) => void)[] = [
            (draft) => {
                draft.parameters.monitorContractKey = 'NASDAQ:STK:AAPL';
                draft.parameters.order.contractKey = 'NASDAQ:STK:AAPL';
            },
            (draft) => {
                draft.parameters.order.orderCond = 'MarginTrading';
            },
            (draft) => {
                draft.parameters.order.orderLot = 'IntradayOdd';
            },
            (draft) => {
                draft.parameters.order.priceType = 'MKT';
                draft.parameters.order.limitPrice = null;
                draft.parameters.order.timeInForce = 'ROD';
            },
        ];

        for (const mutate of invalidDefinitions) {
            const draft = structuredClone(
                quickDraft(),
            ) as unknown as MutableQuickDraft;
            mutate(draft);
            expect(canonicalDraftSharedView(draft, false)).toBeNull();
        }
    });

    it('applies shared edits through the canonical parser and derives Share from CommonLot exactly', () => {
        const view = canonicalDraftSharedView(quickDraft(), true);
        expect(view).not.toBeNull();
        const updated = applyCanonicalDraftSharedEdits(view!, {
            commonLots: '2',
            triggerField: 'ask_price',
            triggerComparator: 'lte',
            triggerThreshold: '101.5',
            activationPolicy: 'immediate_if_true',
            limitPrice: '100.5',
            startDate: '2026-08-12',
            endDate: '2026-08-13',
        });
        expect(updated.parameters).toMatchObject({
            condition: {
                field: 'ask_price',
                comparator: 'lte',
                threshold: '101.5',
            },
            activationPolicy: 'immediate_if_true',
            order: {
                commonLots: '2',
                baseShares: '2000',
                contractUnit: '1000',
                limitPrice: '100.5',
            },
            validity: {
                startDate: '2026-08-12',
                endDate: '2026-08-13',
            },
        });
        expect(() =>
            applyCanonicalDraftSharedEdits(view!, {
                commonLots: '1.5',
                triggerField: 'last_price',
                triggerComparator: 'gte',
                triggerThreshold: '101',
                activationPolicy: 'require_rearm',
                limitPrice: '100',
                startDate: '2026-08-11',
                endDate: '2026-08-11',
            }),
        ).toThrow('positive canonical integer');
        expect(() =>
            applyCanonicalDraftSharedEdits(view!, {
                commonLots: '9223372036854776',
                triggerField: 'last_price',
                triggerComparator: 'gte',
                triggerThreshold: '101',
                activationPolicy: 'require_rearm',
                limitPrice: '100',
                startDate: '2026-08-11',
                endDate: '2026-08-11',
            }),
        ).toThrow('signed 64-bit boundary');
    });

    it('edits all multi-condition legs and rejects zero or more than seven legs', () => {
        const view = canonicalDraftSharedView(multiConditionDraft(), false);
        expect(view?.multiConditions).toHaveLength(1);
        const baseEdits = {
            commonLots: '1',
            triggerField: 'last_price' as const,
            triggerComparator: 'gte' as const,
            triggerThreshold: '100',
            activationPolicy: 'require_rearm' as const,
            limitPrice: '100',
            startDate: '2026-08-11',
            endDate: '2026-08-11',
            multiOperator: 'OR' as const,
        };
        const sevenConditions = Array.from({ length: 7 }, (_, index) => ({
            monitorContractKey:
                index % 2 === 0 ? 'TSE:STK:2330' : 'OTC:STK:6488',
            field: 'last_price' as const,
            comparator: index % 2 === 0 ? ('gte' as const) : ('lte' as const),
            threshold: String(100 + index),
        }));
        const updated = applyCanonicalDraftSharedEdits(view!, {
            ...baseEdits,
            multiConditions: sevenConditions,
        });
        expect(updated.kind).toBe('multi_condition');
        if (updated.kind !== 'multi_condition') return;
        expect(updated.parameters.operator).toBe('OR');
        expect(updated.parameters.conditions).toHaveLength(7);
        expect(updated.parameters.conditions[1]).toMatchObject({
            monitorContractKey: 'OTC:STK:6488',
            condition: {
                comparator: 'lte',
                threshold: '101',
                mappingRevision: 'quote-mapping-1',
            },
        });
        for (const invalidConditions of [[], [...sevenConditions, sevenConditions[0]!]]) {
            expect(() =>
                applyCanonicalDraftSharedEdits(view!, {
                    ...baseEdits,
                    multiConditions: invalidConditions,
                }),
            ).toThrow('one to seven conditions');
        }
    });

    it('edits one or two stop/take distances without trusting draft trigger prices', () => {
        const view = canonicalDraftSharedView(stopTakeDraft(), false);
        expect(view?.stopTakeLegs).toEqual([
            { type: 'stop', distance: { kind: 'pct_bps', pctBps: 500 } },
        ]);
        const updated = applyCanonicalDraftSharedEdits(view!, {
            commonLots: '1',
            triggerField: null,
            triggerComparator: null,
            triggerThreshold: '95',
            activationPolicy: null,
            limitPrice: '100',
            startDate: '2026-08-11',
            endDate: '2026-08-11',
            stopTakeLegs: [
                {
                    type: 'stop',
                    distance: {
                        kind: 'fixed_atr',
                        atr: '2',
                        multiplier: '2',
                        atrSnapshotRevision: 'fixed-atr-2026-08-10-r1',
                    },
                },
                {
                    type: 'take',
                    distance: { kind: 'pct_bps', pctBps: 300 },
                },
            ],
        });
        expect(updated.parameters).toMatchObject({
            legs: [
                {
                    type: 'stop',
                    distance: {
                        kind: 'fixed_atr',
                        atr: '2',
                        multiplier: '2',
                        atrSnapshotRevision: 'fixed-atr-2026-08-10-r1',
                    },
                },
                {
                    type: 'take',
                    distance: { kind: 'pct_bps', pctBps: 300 },
                },
            ],
        });
        expect(() =>
            applyCanonicalDraftSharedEdits(view!, {
                commonLots: '1',
                triggerField: null,
                triggerComparator: null,
                triggerThreshold: null,
                activationPolicy: null,
                limitPrice: '100',
                startDate: '2026-08-11',
                endDate: '2026-08-11',
                stopTakeLegs: [],
            }),
        ).toThrow('one stop/take leg');
    });
});
