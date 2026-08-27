import { describe, expect, it } from 'vitest';
import { smartOrderGateProbeAccountScopeSha256 } from './gate-probe-safety-envelope.mjs';
import { deriveSmartOrderTask03bPlacedTarget } from './task0-3b-target-lineage.mjs';
import {
    reconcileSmartOrderTask03bUpdatedTrade,
    verifySmartOrderTask03bHistoricalUpdateLineage,
} from './task0-3b-update-reconciliation.mjs';

const account = Object.freeze({
    broker_id: 'SIM-BROKER',
    account_id: 'SIM-ACCOUNT',
    account_type: 'S',
});
const runId = '123e4567-e89b-42d3-a456-426614174000';

function trade({ modifiedPrice = 0, modifiedTs = 0 } = {}) {
    return {
        contract: { code: '2330', exchange: 'TSE', security_type: 'STK' },
        order: {
            account,
            action: 'Buy',
            custom_field: 'A1B2C3',
            id: 'trade-1',
            order_cond: 'Cash',
            order_lot: 'Common',
            order_type: 'ROD',
            ordno: 'ORD001',
            price: 114.5,
            price_type: 'LMT',
            quantity: 1,
            seqno: 'SEQ001',
        },
        status: {
            cancel_quantity: 0,
            deal_quantity: 0,
            id: 'order-1',
            modified_price: modifiedPrice,
            modified_ts: modifiedTs,
            order_quantity: 1,
            status: 'Submitted',
        },
    };
}

function priorTarget() {
    const placed = trade();
    return deriveSmartOrderTask03bPlacedTarget({
        account,
        contractUnit: 1_000,
        expectedCustomField: 'A1B2C3',
        expectedPriceDecimal: '114.5',
        placeResponse: placed,
        refreshedTrades: [placed],
        runId,
        tradeDate: '2026-08-25',
    }).privateTarget;
}

function trust(target = priorTarget()) {
    return Object.freeze({
        evidenceKey: '0.3b:update_confirmed',
        coordinationId: '6a83d900-0cb3-4a67-ab3d-bc41019d8a6c',
        laterNoEffectCoordinationId:
            '828eeedc-a4ba-4ac3-9a91-66ad1e8d0d54',
        runId,
        accountScopeSha256: smartOrderGateProbeAccountScopeSha256(account),
        apiGenerationSha256: `sha256:${'a'.repeat(64)}`,
        sourceFingerprintSha256: `sha256:${'b'.repeat(64)}`,
        requestSha256: `sha256:${'c'.repeat(64)}`,
        targetIdSha256: target.targetIdSha256,
        tradeDate: '2026-08-25',
        priorRevision: 0,
        nextRevision: 1,
        priorPriceMinorUnits: 11_450,
        nextPriceMinorUnits: 11_400,
        brokerModifiedEpochMs: 1_787_632_362_385,
    });
}

function lineageFixture() {
    const target = priorTarget();
    const anchor = trust(target);
    const common = {
        automaticRetryAllowed: false,
        blindCleanupAllowed: false,
    };
    return {
        trust: anchor,
        priorTarget: target,
        preflight: {
            ...common,
            coordinationId: anchor.coordinationId,
            runId,
            operation: 'update_price',
            requestSha256: anchor.requestSha256,
            accountScopeSha256: anchor.accountScopeSha256,
            apiGenerationSha256: anchor.apiGenerationSha256,
            sourceFingerprintSha256: anchor.sourceFingerprintSha256,
            targetIdSha256: anchor.targetIdSha256,
            targetRevision: 0,
            tradeDate: anchor.tradeDate,
            createdAtEpochMs: anchor.brokerModifiedEpochMs - 1_000,
            validUntilEpochMs: anchor.brokerModifiedEpochMs + 1_000,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
        },
        dispatch: {
            ...common,
            coordinationId: anchor.coordinationId,
            requestSha256: anchor.requestSha256,
            state: 'dispatching_unknown_no_retry',
            brokerWriteAttempted: true,
            brokerWriteNetworked: true,
        },
        result: {
            ...common,
            coordinationId: anchor.coordinationId,
            state: 'unknown_manual_reconciliation_required',
            brokerWriteAttempted: true,
            brokerWriteNetworked: true,
        },
        laterPreflight: {
            ...common,
            coordinationId: anchor.laterNoEffectCoordinationId,
            requestSha256: anchor.requestSha256,
            targetIdSha256: anchor.targetIdSha256,
            targetRevision: 0,
            createdAtEpochMs: anchor.brokerModifiedEpochMs + 10_000,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
        },
        laterDispatch: {
            ...common,
            coordinationId: anchor.laterNoEffectCoordinationId,
            requestSha256: anchor.requestSha256,
            state: 'dispatching_unknown_no_retry',
            brokerWriteAttempted: true,
            brokerWriteNetworked: true,
        },
        laterResult: {
            ...common,
            coordinationId: anchor.laterNoEffectCoordinationId,
            state: 'unknown_manual_reconciliation_required',
            brokerWriteAttempted: true,
            brokerWriteNetworked: true,
        },
    };
}

describe('Task 0.3b historical update reconciliation', () => {
    it('uses status.modified_price as the current working price and advances one revision', () => {
        const target = priorTarget();
        const anchor = trust(target);
        const reconciled = reconcileSmartOrderTask03bUpdatedTrade({
            account,
            priorTarget: target,
            trades: [
                trade({
                    modifiedPrice: 114,
                    modifiedTs: anchor.brokerModifiedEpochMs / 1_000,
                }),
            ],
            trust: anchor,
        });
        expect(reconciled.next.privateTarget).toMatchObject({
            targetIdSha256: target.targetIdSha256,
            revision: 1,
            priceMinorUnits: 11_400,
        });
    });

    it('accepts only the update whose broker modified time is inside its durable envelope and before the later write', () => {
        const fixture = lineageFixture();
        expect(
            verifySmartOrderTask03bHistoricalUpdateLineage(fixture),
        ).toMatchObject({ trusted: true, brokerAuthority: false });
        expect(() =>
            verifySmartOrderTask03bHistoricalUpdateLineage({
                ...fixture,
                laterPreflight: {
                    ...fixture.laterPreflight,
                    createdAtEpochMs:
                        fixture.trust.brokerModifiedEpochMs - 1,
                },
            }),
        ).toThrow('not trusted');
    });

    it('rejects replayed target state, wrong modified price, and terminal drift', () => {
        const target = priorTarget();
        const anchor = trust(target);
        for (const updated of [
            trade({ modifiedPrice: 0, modifiedTs: anchor.brokerModifiedEpochMs / 1_000 }),
            trade({ modifiedPrice: 113, modifiedTs: anchor.brokerModifiedEpochMs / 1_000 }),
            {
                ...trade({ modifiedPrice: 114, modifiedTs: anchor.brokerModifiedEpochMs / 1_000 }),
                status: {
                    ...trade().status,
                    modified_price: 114,
                    modified_ts: anchor.brokerModifiedEpochMs / 1_000,
                    status: 'Cancelled',
                    cancel_quantity: 1,
                },
            },
        ]) {
            expect(() =>
                reconcileSmartOrderTask03bUpdatedTrade({
                    account,
                    priorTarget: target,
                    trades: [updated],
                    trust: anchor,
                }),
            ).toThrow();
        }
    });
});
