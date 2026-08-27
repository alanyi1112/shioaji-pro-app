import { describe, expect, it } from 'vitest';
import { smartOrderGateProbeAccountScopeSha256 } from './gate-probe-safety-envelope.mjs';
import {
    SMART_ORDER_TASK_0_4_0_6_PROFILES,
    smartOrderTask0406CustomField,
} from './task0-4-0-6-operation-contract.mjs';
import {
    createSmartOrderTask0406ResultEvidence,
    smartOrderTask0406ResultFailureReason,
} from './task0-4-0-6-result-evidence.mjs';

const account = Object.freeze({
    broker_id: 'SIM-BROKER',
    account_id: 'SIM-ACCOUNT',
    account_type: 'S',
});
const runId = '11111111-2222-4333-8444-555555555555';
const requestSha256 = `sha256:${'a'.repeat(64)}`;
const apiGenerationSha256 = `sha256:${'b'.repeat(64)}`;
const currentExchangeTs = Date.parse('2026-08-24T02:00:00.000Z') / 1_000;

function marketPlan(profile, code = '2330') {
    const policy = SMART_ORDER_TASK_0_4_0_6_PROFILES[profile];
    return Object.freeze({
        runId,
        taskId: policy.taskId,
        purpose: policy.purpose,
        priceType: policy.priceType,
        timeInForce: policy.timeInForce,
        tradeDate: '2026-08-24',
        contractKey: `TSE:${code}:STK:Common`,
        side: policy.side,
        price: policy.priceType === 'MKT' ? null : '115.5',
    });
}

function trade(profile, overrides = {}, code = '2330') {
    const policy = SMART_ORDER_TASK_0_4_0_6_PROFILES[profile];
    const filled = policy.expectedOutcome === 'filled_with_order_and_deal';
    return {
        contract: { code, exchange: 'TSE', security_type: 'STK' },
        order: {
            account,
            action: policy.side,
            id: 'trade-current',
            order_cond: 'Cash',
            order_lot: 'Common',
            order_type: policy.timeInForce,
            ordno: 'ORD-CURRENT',
            price: policy.priceType === 'MKT' ? 0 : 115.5,
            price_type: policy.priceType,
            quantity: 1,
            seqno: 'SEQ-CURRENT',
            custom_field: smartOrderTask0406CustomField({ profile, runId }),
        },
        status: {
            status: filled ? 'Filled' : 'Cancelled',
            id: 'trade-current',
            order_quantity: 1,
            deal_quantity: filled ? 1 : 0,
            cancel_quantity: filled ? 0 : 1,
        },
        ...overrides,
    };
}

function orderEvent(profile, exchangeTs = currentExchangeTs, code = '2330') {
    const current = trade(profile, {}, code);
    return {
        state: 'StockOrder',
        data: {
            StockOrder: {
                contract: { code },
                order: {
                    account,
                    id: current.order.id,
                    seqno: current.order.seqno,
                    custom_field: current.order.custom_field,
                },
                status: { exchange_ts: exchangeTs },
            },
        },
    };
}

function dealEvent(
    exchangeTs = currentExchangeTs,
    code = '2330',
    profile = 'round_trip_lmt_ioc',
) {
    return {
        state: 'StockDeal',
        data: {
            StockDeal: {
                account_id: account.account_id,
                broker_id: account.broker_id,
                trade_id: 'trade-current',
                seqno: 'SEQ-CURRENT',
                ordno: 'ORD-CURRENT',
                exchange_seq: 'EX-CURRENT',
                ts: exchangeTs,
                quantity: 1,
                code,
                action:
                    SMART_ORDER_TASK_0_4_0_6_PROFILES[profile].side,
                custom_field: smartOrderTask0406CustomField({
                    profile,
                    runId,
                }),
                order_cond: 'Cash',
                order_lot: 'Common',
            },
        },
    };
}

function create(profile, overrides = {}, code = '2330') {
    const current = trade(profile, {}, code);
    const filled =
        SMART_ORDER_TASK_0_4_0_6_PROFILES[profile].expectedOutcome ===
        'filled_with_order_and_deal';
    return createSmartOrderTask0406ResultEvidence({
        account,
        apiGenerationSha256,
        marketPlan: marketPlan(profile, code),
        observedEvents: [
            orderEvent(
                profile,
                Date.parse('2026-08-23T02:00:00.000Z') / 1_000,
                code,
            ),
            orderEvent(profile, currentExchangeTs, code),
            ...(filled ? [dealEvent(currentExchangeTs, code, profile)] : []),
        ],
        placeResponse: current,
        profile,
        refreshedTrades: [current],
        requestSha256,
        runId,
        ...overrides,
    });
}

describe('Task 0.4/0.6 live result evidence', () => {
    it.each(['round_trip_lmt_ioc', 'lmt_rod_fill', 'mkt_ioc_fill'])(
        'requires exact place/order/deal round-trip for %s',
        (profile) => {
            const result = create(profile);
            expect(result.evidence).toMatchObject({
                profile,
                observedBrokerStatus: 'Filled',
                brokerTerminal: true,
                cumulativeDealCommonLots: 1,
                orderEventObserved: true,
                dealEventObserved: true,
                correlationUnique: true,
                crossDateCollisionRejected: true,
                accountScopeSha256: smartOrderGateProbeAccountScopeSha256(account),
                brokerAuthority: false,
            });
            expect(result.evidence.exchangeSequenceSha256s).toHaveLength(1);
            expect(result.resultSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
        },
    );

    it.each([
        'protected_entry_lmt_ioc',
        'protected_exit_marketable_lmt_ioc',
    ])('accepts the exact Task 13.3 filled profile %s', (profile) => {
        const result = create(profile);
        expect(result.evidence).toMatchObject({
            taskId: '13.3',
            profile,
            side: SMART_ORDER_TASK_0_4_0_6_PROFILES[profile].side,
            observedBrokerStatus: 'Filled',
            brokerTerminal: true,
            dealEventObserved: true,
            workingConfirmed: false,
        });
    });

    it('accepts the exact Task 13.3 non-marketable working exit without treating it as zero-fill terminal', () => {
        const current = trade('protected_exit_working_lmt_rod');
        current.status = {
            ...current.status,
            status: 'Submitted',
            deal_quantity: 0,
            cancel_quantity: 0,
        };
        const result = create('protected_exit_working_lmt_rod', {
            placeResponse: current,
            refreshedTrades: [current],
        });
        expect(result.evidence).toMatchObject({
            taskId: '13.3',
            side: 'Sell',
            observedBrokerStatus: 'Submitted',
            brokerTerminal: false,
            zeroFillConfirmed: false,
            workingConfirmed: true,
            manualInterventionRequired: false,
        });
    });

    it('accepts the exact Task 13.3 IOC unfilled result without retry', () => {
        const result = create('protected_exit_ioc_unfilled');
        expect(result.evidence).toMatchObject({
            taskId: '13.3',
            side: 'Sell',
            zeroFillConfirmed: true,
            workingConfirmed: false,
            automaticRetryAllowed: false,
        });
    });

    it('accepts the exact LMT+IOC zero-fill terminal without inventing a deal', () => {
        const result = create('lmt_ioc_zero_fill');
        expect(result.evidence).toMatchObject({
            observedBrokerStatus: 'Cancelled',
            brokerTerminal: true,
            zeroFillConfirmed: true,
            zeroFillDisposition: 'broker_cancelled_terminal',
            cumulativeDealCommonLots: 0,
            cumulativeCancelCommonLots: 1,
            orderEventObserved: true,
            dealEventObserved: false,
            manualInterventionRequired: false,
        });
    });

    it('records simulation Submitted IOC zero-fill as non-terminal manual intervention without retry', () => {
        const current = trade('lmt_ioc_zero_fill');
        current.status = {
            ...current.status,
            status: 'Submitted',
            deal_quantity: 0,
            cancel_quantity: 0,
        };
        const result = create('lmt_ioc_zero_fill', {
            placeResponse: current,
            refreshedTrades: [current],
        });
        expect(result.evidence).toMatchObject({
            observedBrokerStatus: 'Submitted',
            brokerTerminal: false,
            zeroFillConfirmed: true,
            zeroFillDisposition:
                'broker_submitted_nonterminal_manual_intervention',
            cumulativeDealCommonLots: 0,
            cumulativeCancelCommonLots: 0,
            orderEventObserved: true,
            dealEventObserved: false,
            manualInterventionRequired: true,
            automaticRetryAllowed: false,
            blindCleanupAllowed: false,
        });
    });

    it('binds the current task-specific 009819 contract through response, order event and deal event', () => {
        const result = create('round_trip_lmt_ioc', {}, '009819');
        expect(result.evidence).toMatchObject({
            contractKey: 'TSE:009819:STK:Common',
            observedBrokerStatus: 'Filled',
            orderEventObserved: true,
            dealEventObserved: true,
        });
    });

    it('accepts absent provisional place-response ordno/orderId but binds the final values through event and refresh', () => {
        const current = trade('round_trip_lmt_ioc');
        const provisional = structuredClone(current);
        delete provisional.order.ordno;
        delete provisional.status.id;
        const result = create('round_trip_lmt_ioc', { placeResponse: provisional });
        expect(result.evidence).toMatchObject({
            placeResponseMatched: true,
            placeResponseFinalIdentifiersProvisional: true,
            observedBrokerStatus: 'Filled',
        });
    });

    it('rejects non-empty provisional identifiers that conflict with the final refreshed lineage', () => {
        const current = trade('round_trip_lmt_ioc');
        const conflicting = structuredClone(current);
        conflicting.order.ordno = 'ORD-OTHER';
        let failure;
        try {
            create('round_trip_lmt_ioc', { placeResponse: conflicting });
        } catch (error) {
            failure = error;
        }
        expect(smartOrderTask0406ResultFailureReason(failure)).toBe(
            'place_response_final_identifier_mismatch',
        );
    });

    it('rejects stable place-response lineage drift even when custom_field matches', () => {
        const current = trade('round_trip_lmt_ioc');
        const conflicting = structuredClone(current);
        conflicting.order.id = 'trade-other';
        let failure;
        try {
            create('round_trip_lmt_ioc', { placeResponse: conflicting });
        } catch (error) {
            failure = error;
        }
        expect(smartOrderTask0406ResultFailureReason(failure)).toBe(
            'place_response_stable_lineage_mismatch',
        );
    });

    it('deduplicates an exact replayed deal callback without double-counting the fill', () => {
        const replayedDeal = dealEvent();
        const result = create('round_trip_lmt_ioc', {
            observedEvents: [
                orderEvent('round_trip_lmt_ioc'),
                replayedDeal,
                structuredClone(replayedDeal),
            ],
        });
        expect(result.evidence).toMatchObject({
            cumulativeDealCommonLots: 1,
            dealEventObserved: true,
            correlationUnique: true,
        });
        expect(result.evidence.exchangeSequenceSha256s).toHaveLength(1);
    });

    it('rejects a conflicting ordno or additional exchange sequence instead of merging it', () => {
        const wrongOrdno = dealEvent();
        wrongOrdno.data.StockDeal.ordno = 'ORD-OTHER';
        expect(() =>
            create('round_trip_lmt_ioc', {
                observedEvents: [orderEvent('round_trip_lmt_ioc'), wrongOrdno],
            }),
        ).toThrow('canonical event correlation');

        const secondSequence = dealEvent();
        secondSequence.data.StockDeal.exchange_seq = 'EX-OTHER';
        expect(() =>
            create('round_trip_lmt_ioc', {
                observedEvents: [
                    orderEvent('round_trip_lmt_ioc'),
                    dealEvent(),
                    secondSequence,
                ],
            }),
        ).toThrow('canonical event correlation');
    });

    it('rejects legacy seq and deal callback account/custom-field lineage drift', () => {
        const legacy = dealEvent();
        legacy.data.StockDeal.seq = legacy.data.StockDeal.exchange_seq;
        delete legacy.data.StockDeal.exchange_seq;
        expect(() =>
            create('round_trip_lmt_ioc', {
                observedEvents: [orderEvent('round_trip_lmt_ioc'), legacy],
            }),
        ).toThrow('exchange_seq');

        for (const [field, value] of [
            ['account_id', 'OTHER'],
            ['broker_id', 'OTHER'],
            ['custom_field', 'OTHER1'],
        ]) {
            const drifted = dealEvent();
            drifted.data.StockDeal[field] = value;
            expect(() =>
                create('round_trip_lmt_ioc', {
                    observedEvents: [
                        orderEvent('round_trip_lmt_ioc'),
                        drifted,
                    ],
                }),
            ).toThrow('canonical event correlation');
        }
    });

    it('fails closed on missing deal, duplicate refreshed correlation and a replay-only prior date', () => {
        expect(() =>
            create('round_trip_lmt_ioc', {
                observedEvents: [orderEvent('round_trip_lmt_ioc')],
            }),
        ).toThrow('canonical event correlation');
        const current = trade('round_trip_lmt_ioc');
        expect(() =>
            create('round_trip_lmt_ioc', {
                refreshedTrades: [current, structuredClone(current)],
            }),
        ).toThrow('non-unique');
        expect(() =>
            create('round_trip_lmt_ioc', {
                observedEvents: [
                    orderEvent(
                        'round_trip_lmt_ioc',
                        Date.parse('2026-08-23T02:00:00.000Z') / 1_000,
                    ),
                    dealEvent(Date.parse('2026-08-23T02:00:00.000Z') / 1_000),
                ],
            }),
        ).toThrow('order event is missing');
    });
});
