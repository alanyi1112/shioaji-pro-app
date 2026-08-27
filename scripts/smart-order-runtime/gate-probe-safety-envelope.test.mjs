import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_GATE_PROBE_MAX_LIFETIME_MS,
    SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
    canonicalSmartOrderGateProbeSafetyEnvelope,
    smartOrderGateProbeAccountScopeSha256,
    smartOrderGateProbeEnvelopeIsCurrent,
} from './gate-probe-safety-envelope.mjs';

function account() {
    return {
        broker_id: 'broker-A',
        account_id: 'account-A',
        account_type: 'S',
    };
}

function tradeIdSha256(value) {
    return `sha256:${createHash('sha256')
        .update(JSON.stringify(value))
        .digest('hex')}`;
}

function target(overrides = {}) {
    return {
        originRunId: '123e4567-e89b-42d3-a456-426614174400',
        targetIdSha256: `sha256:${'1'.repeat(64)}`,
        tradeIdSha256: tradeIdSha256('probe-trade-1'),
        accountScopeSha256: smartOrderGateProbeAccountScopeSha256(account()),
        tradeDate: '2026-08-20',
        revision: 0,
        quantityCommonLots: 1,
        nonTerminal: true,
        correlationUnique: true,
        ...overrides,
    };
}

function envelope(overrides = {}) {
    const fixedAccount = account();
    const accountScopeSha256 =
        smartOrderGateProbeAccountScopeSha256(fixedAccount);
    return {
        schemaVersion: SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
        runId: '123e4567-e89b-42d3-a456-426614174400',
        operationId: '123e4567-e89b-42d3-a456-426614174401',
        nonce: '123e4567-e89b-42d3-a456-426614174402',
        request: {
            schemaVersion:
                'smart-order-manual-broker-write-request/2026-08-14.1',
            operation: 'place',
            brokerPath: '/api/v1/order/place_order',
            payload: {
                contract: {
                    security_type: 'STK',
                    region: 'TW',
                    exchange: 'TSE',
                    code: '2330',
                    target_code: null,
                },
                stock_order: {
                    action: 'Buy',
                    price: 100,
                    quantity: 1,
                    price_type: 'LMT',
                    order_type: 'ROD',
                    order_lot: 'Common',
                    account: fixedAccount,
                },
            },
        },
        target: null,
        tradeDate: '2026-08-20',
        confirmation: {
            accountScopeSha256,
            confirmed: true,
            expectedOperation: 'place',
            maximumCommonLots: 1,
            simulation: true,
        },
        validUntilEpochMs: 1_787_200_060_000,
        ...overrides,
    };
}

describe('gate probe safety envelope', () => {
    it('allows a five-minute paste window and rejects longer envelopes', () => {
        const nowEpochMs = 1_787_200_000_000;
        expect(SMART_ORDER_GATE_PROBE_MAX_LIFETIME_MS).toBe(300_000);
        expect(
            smartOrderGateProbeEnvelopeIsCurrent(
                canonicalSmartOrderGateProbeSafetyEnvelope(
                    envelope({ validUntilEpochMs: nowEpochMs + 300_000 }),
                ).envelope,
                nowEpochMs,
            ),
        ).toBe(true);
        expect(
            smartOrderGateProbeEnvelopeIsCurrent(
                canonicalSmartOrderGateProbeSafetyEnvelope(
                    envelope({ validUntilEpochMs: nowEpochMs + 300_001 }),
                ).envelope,
                nowEpochMs,
            ),
        ).toBe(false);
    });

    it('binds a one-CommonLot simulation confirmation without granting write authority', () => {
        const canonical = canonicalSmartOrderGateProbeSafetyEnvelope(
            envelope(),
        );
        expect(canonical.envelope).toMatchObject({
            operation: 'place',
            quantityCommonLots: 1,
            target: null,
        });
        expect(canonical.sourceEnvelope.confirmation).toEqual({
            accountScopeSha256: canonical.envelope.accountScopeSha256,
            confirmed: true,
            expectedOperation: 'place',
            maximumCommonLots: 1,
            simulation: true,
        });
        expect(canonical).not.toHaveProperty('brokerAuthority');
    });

    it('rejects quantity expansion, cross-run targets, and accessor or Proxy inputs', () => {
        const twoLots = envelope();
        twoLots.request.payload.stock_order.quantity = 2;
        expect(() =>
            canonicalSmartOrderGateProbeSafetyEnvelope(twoLots),
        ).toThrow('exactly one CommonLot');

        const update = envelope({
            request: {
                schemaVersion:
                    'smart-order-manual-broker-write-request/2026-08-14.1',
                operation: 'update_quantity',
                brokerPath: '/api/v1/order/update_qty',
                payload: {
                    trade_id: 'probe-trade-1',
                    quantity: 1,
                    account: account(),
                },
            },
            target: target({
                originRunId: '123e4567-e89b-42d3-a456-426614174499',
            }),
            confirmation: {
                accountScopeSha256:
                    smartOrderGateProbeAccountScopeSha256(account()),
                confirmed: true,
                expectedOperation: 'update',
                maximumCommonLots: 1,
                simulation: true,
            },
        });
        expect(() =>
            canonicalSmartOrderGateProbeSafetyEnvelope(update),
        ).toThrow('outside the same run');

        const accessor = envelope();
        Object.defineProperty(accessor, 'nonce', {
            enumerable: true,
            get() {
                return '123e4567-e89b-42d3-a456-426614174402';
            },
        });
        expect(() =>
            canonicalSmartOrderGateProbeSafetyEnvelope(accessor),
        ).toThrow('own data property');
        expect(() =>
            canonicalSmartOrderGateProbeSafetyEnvelope(
                new Proxy(envelope(), {}),
            ),
        ).toThrow('non-Proxy');
    });
});
