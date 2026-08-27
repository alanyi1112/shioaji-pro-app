import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_RUNTIME_RISK_POLICY_EDITOR_SCHEMA_VERSION,
    canonicalRuntimeRiskPolicyEditorInput,
    materializeRuntimeRiskPolicy,
} from './runtime-risk-policy.mjs';

function editor(overrides = {}) {
    return {
        schemaVersion: SMART_ORDER_RUNTIME_RISK_POLICY_EDITOR_SCHEMA_VERSION,
        buyFeeBps: 15,
        minimumBuyFeeMinorUnits: 2000,
        cashBufferMinorUnits: 10000,
        accountLimits: {
            quantityShares: 50_000,
            notionalMinorUnits: 50_000_000,
            cashMinorUnits: 55_000_000,
            positionShares: 40_000,
            orderCount: 20,
        },
        identityLimits: {
            quantityShares: 100_000,
            notionalMinorUnits: 100_000_000,
            cashMinorUnits: 110_000_000,
            positionShares: 80_000,
            orderCount: 40,
        },
        accountDailyLossLimitMinorUnits: 1_000_000,
        identityDailyLossLimitMinorUnits: 2_000_000,
        ...overrides,
    };
}

describe('runtime risk policy', () => {
    it('materializes a versioned policy and protected-entry execution binding', () => {
        const result = materializeRuntimeRiskPolicy(editor(), 3);
        expect(result.policy.revision).toBe(3);
        expect(result.policy.policyRevision).toContain(':3');
        expect(result.executionPolicy.policyRevision).toBe(
            result.policy.policyRevision,
        );
        expect(result.policyHash).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(result.executionPolicyHash).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(result.policy.reservedDimensions).toEqual([
            'quantityShares',
            'notionalMinorUnits',
            'cashMinorUnits',
            'positionShares',
            'orderCount',
        ]);
    });

    it('rejects mismatched scopes, accessors, proxies, and extra fields', () => {
        expect(() =>
            canonicalRuntimeRiskPolicyEditorInput(
                editor({
                    identityLimits: {
                        ...editor().identityLimits,
                        cashMinorUnits: null,
                    },
                }),
            ),
        ).toThrow(/both account and identity scopes/);
        const accessor = editor();
        Object.defineProperty(accessor, 'buyFeeBps', {
            enumerable: true,
            get: () => 15,
        });
        expect(() => canonicalRuntimeRiskPolicyEditorInput(accessor)).toThrow(
            /own data property/,
        );
        expect(() =>
            canonicalRuntimeRiskPolicyEditorInput(new Proxy(editor(), {})),
        ).toThrow(/non-Proxy/);
        expect(() =>
            canonicalRuntimeRiskPolicyEditorInput({ ...editor(), accountId: 'x' }),
        ).toThrow(/versioned schema/);
    });
});
