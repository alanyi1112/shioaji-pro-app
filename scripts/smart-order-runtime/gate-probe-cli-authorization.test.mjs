import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
    smartOrderGateProbeAccountScopeSha256,
} from './gate-probe-safety-envelope.mjs';
import {
    issueSmartOrderGateProbeCliAuthorization,
    verifySmartOrderGateProbeCliAuthorization,
} from './gate-probe-cli-authorization.mjs';

const NOW = 1_787_400_000_000;
const API_GENERATION_SHA256 = `sha256:${'a'.repeat(64)}`;
const RUNTIME_EPOCH_SHA256 = `sha256:${'b'.repeat(64)}`;

function envelope(overrides = {}) {
    const account = {
        broker_id: 'broker-A',
        account_id: 'account-A',
        account_type: 'S',
    };
    return {
        schemaVersion: SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
        runId: '123e4567-e89b-42d3-a456-426614174500',
        operationId: '123e4567-e89b-42d3-a456-426614174501',
        nonce: '123e4567-e89b-42d3-a456-426614174502',
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
                    account,
                },
            },
        },
        target: null,
        tradeDate: '2026-08-22',
        confirmation: {
            accountScopeSha256:
                smartOrderGateProbeAccountScopeSha256(account),
            confirmed: true,
            expectedOperation: 'place',
            maximumCommonLots: 1,
            simulation: true,
        },
        validUntilEpochMs: NOW + 60_000,
        ...overrides,
    };
}

describe('Gate probe CLI-only authorization', () => {
    it('issues and verifies an authorization inside the five-minute envelope', () => {
        const capability = randomBytes(32);
        const source = envelope({ validUntilEpochMs: NOW + 300_000 });
        const authorization = issueSmartOrderGateProbeCliAuthorization({
            capability,
            envelope: source,
            authorizedAtEpochMs: NOW + 120_000,
            apiGenerationSha256: API_GENERATION_SHA256,
            runtimeEpochIdSha256: RUNTIME_EPOCH_SHA256,
        });
        expect(
            verifySmartOrderGateProbeCliAuthorization({
                capability,
                envelope: source,
                authorization,
                nowEpochMs: NOW + 120_001,
                expectedApiGenerationSha256: API_GENERATION_SHA256,
                expectedRuntimeEpochIdSha256: RUNTIME_EPOCH_SHA256,
            }),
        ).toMatchObject({
            authorizedAtEpochMs: NOW + 120_000,
            validUntilEpochMs: NOW + 300_000,
        });
    });

    it('binds a separate one-generation capability to the exact envelope', () => {
        const capability = randomBytes(32);
        const authorization = issueSmartOrderGateProbeCliAuthorization({
            capability,
            envelope: envelope(),
            authorizedAtEpochMs: NOW,
            apiGenerationSha256: API_GENERATION_SHA256,
            runtimeEpochIdSha256: RUNTIME_EPOCH_SHA256,
        });
        expect(
            verifySmartOrderGateProbeCliAuthorization({
                capability,
                envelope: envelope(),
                authorization,
                nowEpochMs: NOW + 1,
                expectedApiGenerationSha256: API_GENERATION_SHA256,
                expectedRuntimeEpochIdSha256: RUNTIME_EPOCH_SHA256,
            }),
        ).toMatchObject({
            cliAuthorizationSha256: expect.stringMatching(
                /^sha256:[0-9a-f]{64}$/,
            ),
            operationId: envelope().operationId,
        });
        expect(() =>
            verifySmartOrderGateProbeCliAuthorization({
                capability: randomBytes(32),
                envelope: envelope(),
                authorization,
                nowEpochMs: NOW + 1,
                expectedApiGenerationSha256: API_GENERATION_SHA256,
                expectedRuntimeEpochIdSha256: RUNTIME_EPOCH_SHA256,
            }),
        ).toThrow('proof is invalid');
    });

    it('rejects payload substitution and exact-expiry reuse', () => {
        const capability = randomBytes(32);
        const authorization = issueSmartOrderGateProbeCliAuthorization({
            capability,
            envelope: envelope(),
            authorizedAtEpochMs: NOW,
            apiGenerationSha256: API_GENERATION_SHA256,
            runtimeEpochIdSha256: RUNTIME_EPOCH_SHA256,
        });
        const changed = envelope();
        changed.request.payload.stock_order.price = 101;
        expect(() =>
            verifySmartOrderGateProbeCliAuthorization({
                capability,
                envelope: changed,
                authorization,
                nowEpochMs: NOW + 1,
                expectedApiGenerationSha256: API_GENERATION_SHA256,
                expectedRuntimeEpochIdSha256: RUNTIME_EPOCH_SHA256,
            }),
        ).toThrow('binding is invalid');
        expect(() =>
            verifySmartOrderGateProbeCliAuthorization({
                capability,
                envelope: envelope(),
                authorization,
                nowEpochMs: NOW + 60_000,
                expectedApiGenerationSha256: API_GENERATION_SHA256,
                expectedRuntimeEpochIdSha256: RUNTIME_EPOCH_SHA256,
            }),
        ).toThrow('binding is invalid');
    });
});
