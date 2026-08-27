import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';
import { SMART_ORDER_SHIOAJI_EVENT_MAPPING_REVISION } from './shioaji-broker-event-mapper.mjs';

export const SMART_ORDER_QUICK_FIELD_MAPPING_SCHEMA_VERSION =
    'smart-order-quick-field-mapping/2026-08-21.1';
export const SMART_ORDER_QUICK_FIELD_MAPPING_REVISION =
    SMART_ORDER_SHIOAJI_EVENT_MAPPING_REVISION;

const OFFICIAL_UI_SOURCE =
    'https://www.sinotrade.com.tw/richclub/DawhotouAPP/%E5%A4%A7%E6%88%B6%E6%8A%95APP-%E6%96%B0%E4%B8%8A%E7%B7%9AAPP%E5%8A%9F%E8%83%BD-24%E5%B0%8F%E6%99%82%E8%87%AA%E5%8B%95%E7%9B%A3%E6%8E%A7%E4%B8%8B%E5%96%AE%E7%B3%BB%E7%B5%B1-%E4%B8%8D%E7%9B%AF%E7%9B%A4--%E7%94%A8-%E5%BF%AB%E9%80%9F%E5%96%AE-%E8%87%AA%E5%8B%95%E9%80%A2%E4%BD%8E%E5%B8%83%E5%B1%80--6237cb0bfe678525149d2040';
const SHIOAJI_STOCK_STREAM_SOURCE =
    'https://sinotrade.github.io/tutor/market_data/streaming/stocks/';
const SHIOAJI_SUBSCRIPTION_SOURCE =
    'https://sinotrade.github.io/tutor/subscribe/';

function freezeRow(row) {
    return Object.freeze({
        ...row,
        comparators: Object.freeze([...row.comparators]),
        quality: Object.freeze([...row.quality]),
        sources: Object.freeze([...row.sources]),
    });
}

export const SMART_ORDER_QUICK_FIELD_MAPPING = Object.freeze([
    freezeRow({
        field: 'last_price',
        uiLabel: '成交價',
        uiMeaning: '最新一筆整股成交價',
        comparators: ['gte', 'lte'],
        localUnit: 'price_decimal',
        sourceKind: 'tick',
        sourceField: 'close',
        sourceUnit: 'price_decimal',
        transform: 'canonical_positive_decimal',
        quality: ['subscription', 'normal_lot', 'non_simtrade', 'fresh', 'current_lineage'],
        sources: [OFFICIAL_UI_SOURCE, SHIOAJI_STOCK_STREAM_SOURCE],
    }),
    freezeRow({
        field: 'bid_price',
        uiLabel: '買價',
        uiMeaning: '最佳一檔買價',
        comparators: ['gte', 'lte'],
        localUnit: 'price_decimal',
        sourceKind: 'bidask',
        sourceField: 'bid_price[0]',
        sourceUnit: 'price_decimal',
        transform: 'canonical_positive_decimal',
        quality: ['subscription', 'normal_lot', 'non_simtrade', 'fresh', 'current_lineage', 'book_not_crossed'],
        sources: [OFFICIAL_UI_SOURCE, SHIOAJI_STOCK_STREAM_SOURCE],
    }),
    freezeRow({
        field: 'ask_price',
        uiLabel: '賣價',
        uiMeaning: '最佳一檔賣價',
        comparators: ['gte', 'lte'],
        localUnit: 'price_decimal',
        sourceKind: 'bidask',
        sourceField: 'ask_price[0]',
        sourceUnit: 'price_decimal',
        transform: 'canonical_positive_decimal',
        quality: ['subscription', 'normal_lot', 'non_simtrade', 'fresh', 'current_lineage', 'book_not_crossed'],
        sources: [OFFICIAL_UI_SOURCE, SHIOAJI_STOCK_STREAM_SOURCE],
    }),
    ...[
        ['up_amount', '上漲', 'up', 'price_chg', 'price_decimal', 'absolute_price_change'],
        ['down_amount', '下跌', 'down', 'price_chg', 'price_decimal', 'absolute_price_change'],
        ['up_percent', '漲幅', 'up', 'pct_chg', 'percent_decimal', 'integer_basis_points_to_percent_decimal'],
        ['down_percent', '跌幅', 'down', 'pct_chg', 'percent_decimal', 'integer_basis_points_to_percent_decimal'],
    ].map(([field, uiLabel, direction, sourceField, localUnit, transform]) =>
        freezeRow({
            field,
            uiLabel,
            uiMeaning: `${direction === 'up' ? '上漲' : '下跌'}${localUnit === 'percent_decimal' ? '百分比' : '價差'}正值幅度`,
            comparators: ['gte', 'lte'],
            localUnit,
            sourceKind: 'tick',
            sourceField,
            sourceUnit:
                sourceField === 'pct_chg'
                    ? 'integer_basis_points'
                    : 'signed_price_decimal',
            transform,
            quality: ['subscription', 'normal_lot', 'non_simtrade', 'fresh', 'current_lineage', `direction_${direction}`],
            sources: [OFFICIAL_UI_SOURCE, SHIOAJI_STOCK_STREAM_SOURCE],
        }),
    ),
    freezeRow({
        field: 'tick_quantity',
        uiLabel: '單量',
        uiMeaning: '當筆整股成交量',
        comparators: ['gte', 'lte'],
        localUnit: 'CommonLot',
        sourceKind: 'tick',
        sourceField: 'volume',
        sourceUnit: 'CommonLot',
        transform: 'positive_safe_integer',
        quality: ['subscription', 'normal_lot', 'non_simtrade', 'fresh', 'current_lineage'],
        sources: [OFFICIAL_UI_SOURCE, SHIOAJI_STOCK_STREAM_SOURCE],
    }),
    freezeRow({
        field: 'total_quantity',
        uiLabel: '總量',
        uiMeaning: '當交易日累計整股成交量',
        comparators: ['gte', 'lte'],
        localUnit: 'CommonLot',
        sourceKind: 'tick',
        sourceField: 'total_volume',
        sourceUnit: 'CommonLot',
        transform: 'positive_safe_integer',
        quality: ['subscription', 'normal_lot', 'non_simtrade', 'fresh', 'current_lineage', 'same_trade_date'],
        sources: [OFFICIAL_UI_SOURCE, SHIOAJI_STOCK_STREAM_SOURCE],
    }),
]);

export const SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION = Object.freeze({
    schemaVersion: SMART_ORDER_QUICK_FIELD_MAPPING_SCHEMA_VERSION,
    mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
    checkedAt: '2026-08-21',
    delivery: 'subscription_only',
    sequenceAuthority: 'runtime_connection_local_monotonic_sequence',
    reconnectPolicy: 'new_connection_lineage_requires_resubscribe_and_new_head',
    ownershipPolicy: 'runtime_refcount_cannot_be_released_by_browser',
    multiClientPolicy: 'shared_usage_unknown_blocks_new_runtime_demand',
    rows: SMART_ORDER_QUICK_FIELD_MAPPING,
    sources: Object.freeze([
        OFFICIAL_UI_SOURCE,
        SHIOAJI_STOCK_STREAM_SOURCE,
        SHIOAJI_SUBSCRIPTION_SOURCE,
    ]),
});

export const SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256 =
    `sha256:${createHash('sha256')
        .update(canonicalJson(SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION))
        .digest('hex')}`;

const mappingByField = new Map(
    SMART_ORDER_QUICK_FIELD_MAPPING.map((row) => [row.field, row]),
);

export function currentSmartOrderQuickFieldMapping(field) {
    return mappingByField.get(field) ?? null;
}

export function isCurrentSmartOrderQuickFieldMappingDefinition(value) {
    return value === SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION;
}
