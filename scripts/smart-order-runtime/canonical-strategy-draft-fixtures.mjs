import {
    SMART_ORDER_CANONICAL_DRAFT_DECISION_TABLE_VERSION,
    SMART_ORDER_CANONICAL_DRAFT_KINDS,
    SMART_ORDER_CANONICAL_DRAFT_PAYLOAD_SCHEMA_VERSIONS,
    SMART_ORDER_CANONICAL_DRAFT_SCHEMA_VERSION,
} from './canonical-strategy-draft.mjs';

export const canonicalSmartOrderDraftKinds =
    SMART_ORDER_CANONICAL_DRAFT_KINDS;

function condition(overrides = {}) {
    return {
        field: 'last_price',
        comparator: 'gte',
        threshold: '100',
        mappingRevision: 'quote-mapping-1',
        ...overrides,
    };
}

function validity() {
    return {
        startDate: '2026-08-11',
        endDate: '2026-08-11',
        calendarVersion: 'tw-calendar-1',
    };
}

function order(overrides = {}) {
    return {
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
        ...overrides,
    };
}

function parameters(kind) {
    const payloadSchemaVersion =
        SMART_ORDER_CANONICAL_DRAFT_PAYLOAD_SCHEMA_VERSIONS[kind];
    switch (kind) {
        case 'quick':
            return {
                payloadSchemaVersion,
                monitorContractKey: 'TSE:STK:2330',
                condition: condition(),
                order: order(),
                validity: validity(),
                activationPolicy: 'require_rearm',
            };
        case 'good_till':
            return {
                payloadSchemaVersion,
                monitorContractKey: 'TSE:STK:2303',
                condition: condition(),
                order: order(),
                validity: validity(),
                activationPolicy: 'require_rearm',
                targetBaseShares: '3000',
                perOrderMaxBaseShares: '1000',
            };
        case 'multi_condition':
            return {
                payloadSchemaVersion,
                conditions: [
                    {
                        monitorContractKey: 'TSE:STK:2330',
                        condition: condition(),
                    },
                    {
                        monitorContractKey: 'OTC:STK:6488',
                        condition: condition({ comparator: 'lte' }),
                    },
                ],
                operator: 'AND',
                order: order(),
                validity: validity(),
                activationPolicy: 'require_rearm',
            };
        case 'parent_child':
            return {
                payloadSchemaVersion,
                parent: {
                    monitorContractKey: 'TSE:STK:2330',
                    condition: condition(),
                    order: order(),
                },
                child: {
                    monitorContractKey: 'TSE:STK:2303',
                    condition: condition(),
                    order: order({
                        contractKey: 'TSE:STK:2303',
                        side: 'Sell',
                    }),
                    cutoffTime: '13:30:00',
                },
                parentValidity: validity(),
                activationPolicy: 'require_rearm',
            };
        case 'stop_take':
            return {
                payloadSchemaVersion,
                positionContractKey: 'TSE:STK:2330',
                monitorContractKey: 'TSE:STK:2330',
                positionEvidenceRevision: 'position-1',
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
                    {
                        legId: 'take-leg',
                        type: 'take',
                        distance: { kind: 'pct_bps', pctBps: 500 },
                        triggerPrice: '105',
                        triggerTicks: '210',
                    },
                ],
                order: order({ side: 'Sell' }),
                validity: validity(),
                activationPolicy: 'require_rearm',
            };
        case 'trailing_exit':
            return {
                payloadSchemaVersion,
                positionContractKey: 'TSE:STK:2330',
                monitorContractKey: 'TSE:STK:2330',
                positionEvidenceRevision: 'position-1',
                positionCost: '100',
                activationPrice: '105',
                retracement: { kind: 'pct_bps', pctBps: 500 },
                fixedStopPrice: '95',
                order: order({ side: 'Sell' }),
                validity: validity(),
                activationPolicy: 'require_rearm',
            };
        case 'scheduled_quantity':
            return {
                payloadSchemaVersion,
                mode: 'timed',
                order: order(),
                validity: validity(),
                targetBaseShares: '1000',
                startTime: '09:00:00',
                endTime: '13:30:00',
                intervalSeconds: 1800,
                perOrderBaseShares: null,
                algorithmStatus: 'disabled_unverified',
            };
        default:
            throw new TypeError('unsupported canonical draft fixture kind');
    }
}

export function canonicalSmartOrderDraft(kind) {
    return {
        schemaVersion: SMART_ORDER_CANONICAL_DRAFT_SCHEMA_VERSION,
        decisionTableVersion:
            SMART_ORDER_CANONICAL_DRAFT_DECISION_TABLE_VERSION,
        kind,
        parameters: parameters(kind),
    };
}
