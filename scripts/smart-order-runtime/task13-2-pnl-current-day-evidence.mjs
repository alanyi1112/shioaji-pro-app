import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from './canonical-json.mjs';

export const SMART_ORDER_TASK_13_2_PNL_CURRENT_DAY_SCHEMA_VERSION =
    'smart-order-task13.2-pnl-current-day-evidence/2026-08-27.1';

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function taipeiTradeDate(epochMs) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date(epochMs));
    const byType = Object.fromEntries(
        parts.map((part) => [part.type, part.value]),
    );
    return `${byType.year}-${byType.month}-${byType.day}`;
}

export function deriveSmartOrderTask13_2CurrentDayPnlEvidence({
    account,
    accountScopeSha256,
    apiGenerationSha256,
    databasePath,
    discoveryStartedAtEpochMs,
    positions,
    positionsSha256,
    quoteEvidenceSha256,
    tradeDate,
    trades,
    unitCapability,
    workingOrdersSha256,
    nowEpochMs,
}) {
    if (
        !account ||
        account.account_type !== 'S' ||
        typeof account.broker_id !== 'string' ||
        typeof account.account_id !== 'string' ||
        !/^sha256:[0-9a-f]{64}$/.test(accountScopeSha256 ?? '') ||
        !/^sha256:[0-9a-f]{64}$/.test(apiGenerationSha256 ?? '') ||
        !/^sha256:[0-9a-f]{64}$/.test(positionsSha256 ?? '') ||
        !/^sha256:[0-9a-f]{64}$/.test(quoteEvidenceSha256 ?? '') ||
        !/^sha256:[0-9a-f]{64}$/.test(workingOrdersSha256 ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') ||
        !Array.isArray(trades) ||
        !Array.isArray(positions) ||
        !Number.isSafeInteger(discoveryStartedAtEpochMs) ||
        !Number.isSafeInteger(nowEpochMs) ||
        unitCapability?.eligible !== true ||
        unitCapability?.brokerWriteAttempted !== false ||
        unitCapability?.brokerWriteNetworked !== false ||
        unitCapability?.serviceMutations !== 0
    ) {
        throw new TypeError('current-day PnL evidence input is invalid');
    }
    if (tradeDate !== taipeiTradeDate(nowEpochMs)) {
        throw new Error('current-day PnL trade date is not current');
    }
    let dealCount = 0;
    let includesPreRuntimeActivity = false;
    for (const [index, trade] of trades.entries()) {
        const orderAccount = trade?.order?.account;
        const status = trade?.status;
        if (
            orderAccount?.broker_id !== account.broker_id ||
            orderAccount?.account_id !== account.account_id ||
            orderAccount?.account_type !== 'S' ||
            !Number.isFinite(status?.order_ts) ||
            taipeiTradeDate(Math.trunc(status.order_ts * 1_000)) !== tradeDate ||
            !Array.isArray(status.deals)
        ) {
            throw new Error(`current-day trade ${index} is not complete`);
        }
        if (status.order_ts * 1_000 < discoveryStartedAtEpochMs) {
            includesPreRuntimeActivity = true;
        }
        for (const [dealIndex, deal] of status.deals.entries()) {
            if (
                !deal ||
                typeof deal.seq !== 'string' ||
                !Number.isFinite(deal.realized_pnl) ||
                !Number.isFinite(deal.fee) ||
                deal.fee < 0 ||
                !Number.isFinite(deal.tax) ||
                deal.tax < 0
            ) {
                throw new Error(
                    `current-day deal ${index}.${dealIndex} lacks fee or tax`,
                );
            }
            dealCount += 1;
        }
    }
    if (!includesPreRuntimeActivity || positions.length < 1) {
        throw new Error(
            'current-day PnL evidence lacks pre-Runtime or position coverage',
        );
    }
    for (const [index, position] of positions.entries()) {
        if (
            position?.direction !== 'Buy' ||
            !Number.isFinite(position.pnl) ||
            !Number.isFinite(position.last_price) ||
            !Number.isFinite(position.price) ||
            !Number.isSafeInteger(position.quantity) ||
            position.quantity < 1
        ) {
            throw new Error(`current-day position ${index} is incomplete`);
        }
    }
    const database = new DatabaseSync(databasePath, { readOnly: true });
    let externalClaimCount;
    try {
        database.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=500;');
        externalClaimCount = Number(
            database
                .prepare(`
                    SELECT COUNT(DISTINCT claims.exit_claim_id) AS count
                      FROM exit_claims AS claims
                      JOIN exit_claim_visibility_bindings AS bindings
                        USING(exit_claim_id)
                     WHERE claims.account_broker_ref=?
                       AND claims.account_id_ref=?
                       AND bindings.trade_date=?
                       AND claims.external_lineage=1
                       AND claims.state='broker_working'
                       AND bindings.binding_kind='external_projection'
                `)
                .get(account.broker_id, account.account_id, tradeDate)?.count,
        );
    } finally {
        database.close();
    }
    if (externalClaimCount !== 2 || trades.length !== 2 || dealCount !== 0) {
        throw new Error(
            'current-day PnL complete empty-deal set is no longer exact',
        );
    }
    const projection = Object.freeze({
        schemaVersion: SMART_ORDER_TASK_13_2_PNL_CURRENT_DAY_SCHEMA_VERSION,
        accountScopeSha256,
        apiGenerationSha256,
        tradeDate,
        asOfEpochMs: nowEpochMs,
        validUntilEpochMs: nowEpochMs + 5_000,
        accountScopedAllTradesContract: true,
        updateStatusBeforeCacheRead: true,
        includesPreRuntimeActivity: true,
        includesExternalClientActivity: true,
        fullDayDealsComplete: true,
        fullDayFeesComplete: true,
        fullDayTaxesComplete: true,
        positionsComplete: true,
        valuationComplete: true,
        tradeCount: trades.length,
        dealCount,
        externalClaimCount,
        realizedMinorUnits: 0,
        feeMinorUnits: 0,
        transactionTaxMinorUnits: 0,
        positionsSha256,
        quoteEvidenceSha256,
        workingOrdersSha256,
        brokerWriteAttempted: false,
        brokerWriteNetworked: false,
        serviceMutations: 0,
        accountIdentifiersPersisted: false,
    });
    return Object.freeze({
        ...projection,
        resultSha256: sha256(canonicalJson(projection)),
        brokerAuthority: false,
    });
}
