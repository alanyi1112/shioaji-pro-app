/**
 * Browser-safe DTO types for the versioned smart-order draft wire contract.
 *
 * This module deliberately contains no parser, transition authority, broker
 * policy implementation, or side-effect code. The Node sidecar remains the
 * authoritative parser and revalidates every draft-only mutation.
 */

export type BrowserSmartOrderStrategyKind =
    | 'quick'
    | 'good_till'
    | 'multi_condition'
    | 'parent_child'
    | 'stop_take'
    | 'trailing_exit'
    | 'scheduled_quantity';

export type BrowserCanonicalQuoteCondition = Readonly<{
    field:
        | 'last_price'
        | 'bid_price'
        | 'ask_price'
        | 'up_amount'
        | 'down_amount'
        | 'up_percent'
        | 'down_percent'
        | 'tick_quantity'
        | 'total_quantity';
    comparator: 'gte' | 'lte';
    threshold: string;
    mappingRevision: string;
}>;

export type BrowserCanonicalValidityWindow = Readonly<{
    startDate: string;
    endDate: string;
    calendarVersion: string;
}>;

export type BrowserCanonicalOrderSpecification = Readonly<{
    contractKey: string;
    side: 'Buy' | 'Sell';
    orderCond: 'Cash';
    orderLot: 'Common';
    baseShares: string;
    commonLots: string;
    contractUnit: string;
    priceType: 'LMT' | 'MKT';
    limitPrice: string | null;
    timeInForce: 'ROD' | 'IOC';
    policyRevision: string;
}>;

export type BrowserCanonicalDistanceDefinition =
    | Readonly<{ kind: 'absolute'; value: string }>
    | Readonly<{ kind: 'pct_bps'; pctBps: number }>
    | Readonly<{
          kind: 'fixed_atr';
          atr: string;
          multiplier: string;
          atrSnapshotRevision: string;
      }>;

type BrowserActivationPolicy = 'require_rearm' | 'immediate_if_true';

type BrowserQuickParameters = Readonly<{
    payloadSchemaVersion: 'realtimestock.smart-order-strategy-payload/quick/v1';
    monitorContractKey: string;
    condition: BrowserCanonicalQuoteCondition;
    order: BrowserCanonicalOrderSpecification;
    validity: BrowserCanonicalValidityWindow;
    activationPolicy: BrowserActivationPolicy;
}>;

type BrowserGoodTillParameters = Readonly<{
    payloadSchemaVersion: 'realtimestock.smart-order-strategy-payload/good-till/v1';
    monitorContractKey: string;
    condition: BrowserCanonicalQuoteCondition;
    order: BrowserCanonicalOrderSpecification;
    validity: BrowserCanonicalValidityWindow;
    activationPolicy: BrowserActivationPolicy;
    targetBaseShares: string;
    perOrderMaxBaseShares: string;
}>;

type BrowserMultiConditionParameters = Readonly<{
    payloadSchemaVersion: 'realtimestock.smart-order-strategy-payload/multi-condition/v1';
    conditions: readonly Readonly<{
        monitorContractKey: string;
        condition: BrowserCanonicalQuoteCondition;
    }>[];
    operator: 'AND' | 'OR';
    order: BrowserCanonicalOrderSpecification;
    validity: BrowserCanonicalValidityWindow;
    activationPolicy: BrowserActivationPolicy;
}>;

type BrowserParentChildParameters = Readonly<{
    payloadSchemaVersion: 'realtimestock.smart-order-strategy-payload/parent-child/v1';
    parent: Readonly<{
        monitorContractKey: string;
        condition: BrowserCanonicalQuoteCondition;
        order: BrowserCanonicalOrderSpecification;
    }>;
    child: Readonly<{
        monitorContractKey: string;
        condition: BrowserCanonicalQuoteCondition;
        order: BrowserCanonicalOrderSpecification;
        cutoffTime: string;
    }>;
    parentValidity: BrowserCanonicalValidityWindow;
    activationPolicy: BrowserActivationPolicy;
}>;

type BrowserStopTakeParameters = Readonly<{
    payloadSchemaVersion: 'realtimestock.smart-order-strategy-payload/stop-take/v1';
    positionContractKey: string;
    monitorContractKey: string;
    positionEvidenceRevision: string;
    basisPrice: string;
    basisSource: 'broker_average_cost' | 'user_specified';
    legs: readonly Readonly<{
        legId: string;
        type: 'stop' | 'take';
        distance: BrowserCanonicalDistanceDefinition;
        triggerPrice: string;
        triggerTicks: string;
    }>[];
    order: BrowserCanonicalOrderSpecification;
    validity: BrowserCanonicalValidityWindow;
    activationPolicy: BrowserActivationPolicy;
}>;

type BrowserTrailingExitParameters = Readonly<{
    payloadSchemaVersion: 'realtimestock.smart-order-strategy-payload/trailing-exit/v1';
    positionContractKey: string;
    monitorContractKey: string;
    positionEvidenceRevision: string;
    positionCost: string;
    activationPrice: string;
    retracement: BrowserCanonicalDistanceDefinition;
    fixedStopPrice: string | null;
    order: BrowserCanonicalOrderSpecification;
    validity: BrowserCanonicalValidityWindow;
    activationPolicy: BrowserActivationPolicy;
}>;

type BrowserScheduledQuantityParameters = Readonly<{
    payloadSchemaVersion: 'realtimestock.smart-order-strategy-payload/scheduled-quantity/v1';
    mode: 'timed' | 'quantity';
    order: BrowserCanonicalOrderSpecification;
    validity: BrowserCanonicalValidityWindow;
    targetBaseShares: string;
    startTime: string;
    endTime: string | null;
    intervalSeconds: number;
    perOrderBaseShares: string | null;
    algorithmStatus: 'disabled_unverified';
}>;

interface BrowserDraftBase<Kind extends string, Parameters> {
    readonly schemaVersion: 'realtimestock.smart-order-strategy/v1';
    readonly decisionTableVersion: '2026-08-11.2';
    readonly kind: Kind;
    readonly parameters: Parameters;
}

export type BrowserSmartOrderCanonicalDraft =
    | BrowserDraftBase<'quick', BrowserQuickParameters>
    | BrowserDraftBase<'good_till', BrowserGoodTillParameters>
    | BrowserDraftBase<'multi_condition', BrowserMultiConditionParameters>
    | BrowserDraftBase<'parent_child', BrowserParentChildParameters>
    | BrowserDraftBase<'stop_take', BrowserStopTakeParameters>
    | BrowserDraftBase<'trailing_exit', BrowserTrailingExitParameters>
    | BrowserDraftBase<
          'scheduled_quantity',
          BrowserScheduledQuantityParameters
      >;
