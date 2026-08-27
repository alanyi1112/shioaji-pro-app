import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';

export const SMART_ORDER_MANUAL_ROUTE_COVERAGE_SCHEMA_VERSION =
    'smart-order-manual-route-coverage/2026-08-13.1';
export const SMART_ORDER_MANUAL_ROUTE_COVERAGE_VERSION = '2026-08-13.1';

function frozenArray(values) {
    return Object.freeze(values.map((value) => Object.freeze(value)));
}

export const SMART_ORDER_STOCK_WRITE_SINKS = frozenArray([
    {
        sinkId: 'STK-SINK-PLACE',
        operation: 'place',
        sourceFile: 'src/lib/shioaji.ts',
        sourceSymbol: 'placeStockOrder',
        brokerPath: '/api/v1/order/place_order',
    },
    {
        sinkId: 'STK-SINK-UPDATE-PRICE',
        operation: 'update',
        sourceFile: 'src/lib/shioaji.ts',
        sourceSymbol: 'updateOrderPrice',
        brokerPath: '/api/v1/order/update_price',
    },
    {
        sinkId: 'STK-SINK-UPDATE-QTY',
        operation: 'update',
        sourceFile: 'src/lib/shioaji.ts',
        sourceSymbol: 'updateOrderQty',
        brokerPath: '/api/v1/order/update_qty',
    },
    {
        sinkId: 'STK-SINK-CANCEL',
        operation: 'cancel',
        sourceFile: 'src/lib/shioaji.ts',
        sourceSymbol: 'cancelOrder',
        brokerPath: '/api/v1/order/cancel_order',
    },
]);

export const SMART_ORDER_STOCK_WRITE_ROUTES = frozenArray([
    { routeId: 'STK-MAN-PLACE-TICKET', family: 'manual', operation: 'place', state: 'governed' },
    { routeId: 'STK-MAN-PLACE-CHART', family: 'manual', operation: 'place', state: 'governed' },
    { routeId: 'STK-MAN-PLACE-FLASH', family: 'manual', operation: 'place', state: 'governed' },
    { routeId: 'STK-MAN-PLACE-FLASH-FLAT', family: 'manual', operation: 'place', state: 'governed' },
    { routeId: 'STK-MAN-PLACE-POSITION-CLOSE', family: 'manual', operation: 'place', state: 'governed' },
    { routeId: 'STK-MAN-PLACE-POSITION-REVERSE', family: 'manual', operation: 'place', state: 'governed' },
    { routeId: 'STK-MAN-PLACE-GRID-ONCE', family: 'manual', operation: 'place', state: 'governed' },
    { routeId: 'STK-AUTO-PLACE-GRID-FOLLOW', family: 'automation', operation: 'place', state: 'governed' },
    { routeId: 'STK-MAN-UPDATE-ORDER-PRICE', family: 'manual', operation: 'update', state: 'governed' },
    { routeId: 'STK-MAN-UPDATE-ORDER-QTY', family: 'manual', operation: 'update', state: 'governed' },
    { routeId: 'STK-MAN-UPDATE-CHART-DRAG', family: 'manual', operation: 'update', state: 'governed' },
    { routeId: 'STK-MAN-CANCEL-ORDER-TABLE', family: 'manual', operation: 'cancel', state: 'governed' },
    { routeId: 'STK-MAN-CANCEL-CHART', family: 'manual', operation: 'cancel', state: 'governed' },
    { routeId: 'STK-MAN-CANCEL-FLASH-PRICE', family: 'manual', operation: 'cancel', state: 'governed' },
    { routeId: 'STK-MAN-CANCEL-FLASH-SYMBOL', family: 'manual', operation: 'cancel', state: 'governed' },
    { routeId: 'STK-MAN-CANCEL-GRID-ALL', family: 'manual', operation: 'cancel', state: 'governed' },
    { routeId: 'STK-MAN-CANCEL-HOTKEY-ALL', family: 'manual', operation: 'cancel', state: 'governed' },
    { routeId: 'STK-AUTO-CANCEL-GRID-FOLLOW', family: 'automation', operation: 'cancel', state: 'governed' },
    { routeId: 'STK-AUTO-PLACE-TRIGGER', family: 'automation', operation: 'place', state: 'retired_fail_closed' },
    { routeId: 'STK-AUTO-PLACE-BRACKET-EXIT', family: 'automation', operation: 'place', state: 'retired_fail_closed' },
    { routeId: 'STK-PROBE-PLACE', family: 'gate_probe', operation: 'place', state: 'not_exposed' },
    { routeId: 'STK-PROBE-UPDATE', family: 'gate_probe', operation: 'update', state: 'not_exposed' },
    { routeId: 'STK-PROBE-CANCEL', family: 'gate_probe', operation: 'cancel', state: 'not_exposed' },
]);

export const SMART_ORDER_STOCK_WRITE_CALLSITES = frozenArray([
    { callsiteKey: 'src/lib/trade.ts#placeStockOrder#1', routeIds: Object.freeze(['STK-MAN-PLACE-CHART', 'STK-MAN-PLACE-FLASH']) },
    { callsiteKey: 'src/lib/trade.ts#placeQuickOrder#1', routeIds: Object.freeze(['STK-MAN-PLACE-POSITION-CLOSE', 'STK-MAN-PLACE-POSITION-REVERSE']) },
    { callsiteKey: 'src/lib/trade.ts#placeQuickOrder#2', routeIds: Object.freeze(['STK-MAN-PLACE-POSITION-CLOSE', 'STK-MAN-PLACE-POSITION-REVERSE']) },
    { callsiteKey: 'src/lib/trade.ts#cancelOrder#1', routeIds: Object.freeze(['STK-MAN-CANCEL-HOTKEY-ALL']) },
    { callsiteKey: 'src/hooks/use-hotkeys.ts#cancelAllOrders#1', routeIds: Object.freeze(['STK-MAN-CANCEL-HOTKEY-ALL']) },
    { callsiteKey: 'src/components/order-ticket.tsx#placeStockOrder#1', routeIds: Object.freeze(['STK-MAN-PLACE-TICKET']) },
    { callsiteKey: 'src/components/candle-chart.tsx#placeQuickOrder#1', routeIds: Object.freeze(['STK-MAN-PLACE-CHART']) },
    { callsiteKey: 'src/components/candle-chart.tsx#updateOrderPrice#1', routeIds: Object.freeze(['STK-MAN-UPDATE-CHART-DRAG']) },
    { callsiteKey: 'src/components/candle-chart.tsx#cancelOrder#1', routeIds: Object.freeze(['STK-MAN-CANCEL-CHART']) },
    { callsiteKey: 'src/components/flash-order.tsx#placeQuickOrder#1', routeIds: Object.freeze(['STK-MAN-PLACE-FLASH', 'STK-MAN-PLACE-FLASH-FLAT']) },
    { callsiteKey: 'src/components/flash-order.tsx#cancelOrder#1', routeIds: Object.freeze(['STK-MAN-CANCEL-FLASH-PRICE']) },
    { callsiteKey: 'src/components/flash-order.tsx#cancelOrder#2', routeIds: Object.freeze(['STK-MAN-CANCEL-FLASH-SYMBOL']) },
    { callsiteKey: 'src/components/bottom-dock.tsx#placeStockExitByShares#1', routeIds: Object.freeze(['STK-MAN-PLACE-POSITION-CLOSE', 'STK-MAN-PLACE-POSITION-REVERSE']) },
    { callsiteKey: 'src/components/bottom-dock.tsx#placeQuickOrder#1', routeIds: Object.freeze([]), stockReachability: 'excluded_by_isStockPosition_branch' },
    { callsiteKey: 'src/components/bottom-dock.tsx#updateOrderQty#1', routeIds: Object.freeze(['STK-MAN-UPDATE-ORDER-QTY']) },
    { callsiteKey: 'src/components/bottom-dock.tsx#updateOrderPrice#1', routeIds: Object.freeze(['STK-MAN-UPDATE-ORDER-PRICE']) },
    { callsiteKey: 'src/components/bottom-dock.tsx#cancelOrder#1', routeIds: Object.freeze(['STK-MAN-CANCEL-ORDER-TABLE']) },
    { callsiteKey: 'src/components/grid-ticket.tsx#placeStockOrder#1', routeIds: Object.freeze(['STK-MAN-PLACE-GRID-ONCE', 'STK-AUTO-PLACE-GRID-FOLLOW']) },
    { callsiteKey: 'src/components/grid-ticket.tsx#cancelOrder#1', routeIds: Object.freeze(['STK-MAN-CANCEL-GRID-ALL']) },
    { callsiteKey: 'src/components/grid-ticket.tsx#cancelOrder#2', routeIds: Object.freeze(['STK-AUTO-CANCEL-GRID-FOLLOW']) },
]);

const cashCandidateClasses = ['Common', 'IntradayOdd'].flatMap((lot) =>
    ['LMT', 'MKT'].flatMap((priceType) =>
        ['ROD', 'IOC', 'FOK'].map((timeInForce) => ({
            classId: `STK-CLASS-CASH-${lot === 'Common' ? 'COMMON' : 'INTRADAY-ODD'}-${priceType}-${timeInForce}`,
            cond: 'Cash_candidate_unverified',
            lot,
            unit: lot === 'Common' ? 'CommonLot' : 'Share',
            priceType,
            timeInForce,
            state: 'candidate_unverified',
        })),
    ),
);
const daytradeCandidateClasses = ['LMT', 'MKT'].flatMap((priceType) =>
    ['ROD', 'IOC', 'FOK'].map((timeInForce) => ({
        classId: `STK-CLASS-DAYTRADE-SHORT-${priceType}-${timeInForce}`,
        cond: 'daytrade_short_candidate_unverified',
        lot: 'Common',
        unit: 'CommonLot',
        priceType,
        timeInForce,
        state: 'candidate_unverified',
    })),
);

export const SMART_ORDER_STOCK_MANUAL_ORDER_CLASSES = frozenArray([
    ...cashCandidateClasses,
    ...daytradeCandidateClasses,
    { classId: 'STK-CLASS-MARGIN', cond: 'MarginTrading', lot: 'unknown', unit: 'unknown', priceType: 'unknown', timeInForce: 'unknown', state: 'not_exposed' },
    { classId: 'STK-CLASS-SHORT-SELL', cond: 'ShortSelling', lot: 'unknown', unit: 'unknown', priceType: 'unknown', timeInForce: 'unknown', state: 'not_exposed' },
    { classId: 'STK-CLASS-ODD', cond: 'unknown', lot: 'Odd', unit: 'unknown', priceType: 'unknown', timeInForce: 'unknown', state: 'not_exposed' },
    { classId: 'STK-CLASS-FIXING', cond: 'unknown', lot: 'Fixing', unit: 'unknown', priceType: 'unknown', timeInForce: 'unknown', state: 'not_exposed' },
    { classId: 'STK-CLASS-BLOCK-TRADE', cond: 'unknown', lot: 'BlockTrade', unit: 'unknown', priceType: 'unknown', timeInForce: 'unknown', state: 'not_exposed' },
    { classId: 'STK-CLASS-STOCK-MKP', cond: 'not_applicable', lot: 'unknown', unit: 'unknown', priceType: 'MKP', timeInForce: 'unknown', state: 'not_exposed' },
]);

const coverageContent = Object.freeze({
    schemaVersion: SMART_ORDER_MANUAL_ROUTE_COVERAGE_SCHEMA_VERSION,
    version: SMART_ORDER_MANUAL_ROUTE_COVERAGE_VERSION,
    inventoryComplete: true,
    classifierContractPassed: true,
    coverageComplete: true,
    manualEquivalencePassed: true,
    serverDerivedProvenancePassed: true,
    automationAccountEligibility: 'disabled',
    sinkCount: SMART_ORDER_STOCK_WRITE_SINKS.length,
    routeCount: SMART_ORDER_STOCK_WRITE_ROUTES.length,
    callsiteCount: SMART_ORDER_STOCK_WRITE_CALLSITES.length,
    orderClassCount: SMART_ORDER_STOCK_MANUAL_ORDER_CLASSES.length,
    ungovernedRouteIds: Object.freeze(
        SMART_ORDER_STOCK_WRITE_ROUTES.filter(
            (route) => route.state === 'observed_bypass',
        ).map((route) => route.routeId),
    ),
    brokerWriteAuthority: false,
    writeMasterAuthority: false,
});

export const SMART_ORDER_CURRENT_MANUAL_ROUTE_COVERAGE = Object.freeze({
    ...coverageContent,
    coverageSha256: `sha256:${createHash('sha256')
        .update(canonicalJson(coverageContent))
        .digest('hex')}`,
});

export function projectSmartOrderManualRouteCoverageStatus() {
    const status = SMART_ORDER_CURRENT_MANUAL_ROUTE_COVERAGE;
    return Object.freeze({
        schemaVersion: status.schemaVersion,
        version: status.version,
        inventoryComplete: status.inventoryComplete,
        classifierContractPassed: status.classifierContractPassed,
        coverageComplete: status.coverageComplete,
        manualEquivalencePassed: status.manualEquivalencePassed,
        serverDerivedProvenancePassed: status.serverDerivedProvenancePassed,
        automationAccountEligibility: status.automationAccountEligibility,
        coverageSha256: status.coverageSha256,
        ungovernedRouteCount: status.ungovernedRouteIds.length,
        brokerWriteAuthority: false,
        writeMasterAuthority: false,
    });
}
