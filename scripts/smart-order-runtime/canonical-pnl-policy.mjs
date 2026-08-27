import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';

export const SMART_ORDER_CANONICAL_PNL_POLICY_SCHEMA_VERSION =
    'smart-order-pnl-policy/2026-08-11.3';
export const SMART_ORDER_CANONICAL_PNL_POLICY_REVISION =
    'smart-order-canonical-pnl-policy/2026-08-13.1';
export const SMART_ORDER_CANONICAL_PNL_FRESHNESS_TTL_MS = 5_000;

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
        return value;
    }
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

const policyDefinition = deepFreeze({
    schemaVersion: SMART_ORDER_CANONICAL_PNL_POLICY_SCHEMA_VERSION,
    policyRevision: SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
    tradeDateTimeZone: 'Asia/Taipei',
    aggregation: Object.freeze(['per_account', 'identity_group']),
    freshnessTtlMs: SMART_ORDER_CANONICAL_PNL_FRESHNESS_TTL_MS,
    decimalRounding: 'reject_non_exact_minor_unit',
    resetGate:
        'official_calendar_business_session_all_accounts_reconciled',
    valuationPriceSource:
        'POST /api/v1/account/positions unit=Share fields last_price,pnl',
    componentSources: Object.freeze([
        Object.freeze({
            component: 'realized',
            sourceId: 'account_scoped_current_trade_date_trades',
            fieldPath: 'status.deals[].realized_pnl',
            coverage: 'current_trade_date_full_account_scoped',
        }),
        Object.freeze({
            component: 'unrealized',
            sourceId: 'account_scoped_current_positions',
            fieldPath: 'positions[].pnl',
            coverage: 'current_trade_date_full_account_scoped',
        }),
        Object.freeze({
            component: 'fee',
            sourceId: 'account_scoped_current_trade_date_trades',
            fieldPath: 'status.deals[].fee',
            coverage: 'current_trade_date_full_account_scoped',
        }),
        Object.freeze({
            component: 'transaction_tax',
            sourceId: 'account_scoped_current_trade_date_trades',
            fieldPath: 'status.deals[].tax',
            coverage: 'current_trade_date_full_account_scoped',
        }),
    ]),
});

export const SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256 =
    `sha256:${createHash('sha256')
        .update(canonicalJson(policyDefinition))
        .digest('hex')}`;

export const SMART_ORDER_CANONICAL_PNL_POLICY = deepFreeze({
    ...policyDefinition,
    policyDefinitionSha256:
        SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
});

function safeSigned(value, label) {
    if (!Number.isSafeInteger(value)) {
        throw new TypeError(`${label} must be a safe integer`);
    }
    return value;
}

function safeNonnegative(value, label) {
    const result = safeSigned(value, label);
    if (result < 0) throw new TypeError(`${label} must be non-negative`);
    return result;
}

function add(left, right, label) {
    return safeSigned(left + right, label);
}

export function assertCanonicalPnlPolicyBinding({
    policyRevision,
    policyDefinitionSha256,
}) {
    if (
        policyRevision !== SMART_ORDER_CANONICAL_PNL_POLICY_REVISION ||
        policyDefinitionSha256 !==
            SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256
    ) {
        throw new Error('canonical PnL policy binding is not current');
    }
    return SMART_ORDER_CANONICAL_PNL_POLICY;
}

export function recalculateCanonicalPnlTotals({ deals, positions }) {
    if (!Array.isArray(deals) || !Array.isArray(positions)) {
        throw new TypeError('canonical PnL inputs must be arrays');
    }
    const byDealId = new Map();
    for (const deal of deals) {
        const current = Object.freeze({
            dealId: String(deal.dealId),
            realizedMinorUnits: safeSigned(
                deal.realizedMinorUnits,
                'deal.realizedMinorUnits',
            ),
            feeMinorUnits: safeNonnegative(
                deal.feeMinorUnits,
                'deal.feeMinorUnits',
            ),
            transactionTaxMinorUnits: safeNonnegative(
                deal.transactionTaxMinorUnits,
                'deal.transactionTaxMinorUnits',
            ),
        });
        if (!current.dealId) throw new TypeError('dealId is required');
        const previous = byDealId.get(current.dealId);
        if (previous && canonicalJson(previous) !== canonicalJson(current)) {
            throw new Error('duplicate deal ID has conflicting PnL evidence');
        }
        byDealId.set(current.dealId, current);
    }
    let realizedMinorUnits = 0;
    let feeMinorUnits = 0;
    let transactionTaxMinorUnits = 0;
    for (const deal of [...byDealId.values()].sort((left, right) =>
        left.dealId.localeCompare(right.dealId),
    )) {
        realizedMinorUnits = add(
            realizedMinorUnits,
            deal.realizedMinorUnits,
            'realizedMinorUnits',
        );
        feeMinorUnits = add(
            feeMinorUnits,
            deal.feeMinorUnits,
            'feeMinorUnits',
        );
        transactionTaxMinorUnits = add(
            transactionTaxMinorUnits,
            deal.transactionTaxMinorUnits,
            'transactionTaxMinorUnits',
        );
    }
    let unrealizedMinorUnits = 0;
    for (const position of positions) {
        unrealizedMinorUnits = add(
            unrealizedMinorUnits,
            safeSigned(
                position.unrealizedMinorUnits,
                'position.unrealizedMinorUnits',
            ),
            'unrealizedMinorUnits',
        );
    }
    return Object.freeze({
        realizedMinorUnits,
        unrealizedMinorUnits,
        feeMinorUnits,
        transactionTaxMinorUnits,
        netMinorUnits: add(
            add(realizedMinorUnits, unrealizedMinorUnits, 'netMinorUnits'),
            -(feeMinorUnits + transactionTaxMinorUnits),
            'netMinorUnits',
        ),
    });
}
