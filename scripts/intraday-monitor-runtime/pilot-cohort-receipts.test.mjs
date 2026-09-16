import { describe, expect, it } from 'vitest';

import {
    createIntradayMonitorPilotCohortReceiptManifest,
    validateIntradayMonitorPilotCohortReceiptManifest,
} from './pilot-cohort-receipts.mjs';

const CONTRACTS = [
    { security_type: 'STK', region: 'TW', exchange: 'TSE', code: '2330' },
    { security_type: 'STK', region: 'TW', exchange: 'OTC', code: '6488' },
];

function createManifest(overrides = {}) {
    return createIntradayMonitorPilotCohortReceiptManifest({
        requestedSymbols: ['2330.TW', '6488.TWO'],
        contracts: CONTRACTS,
        sourceEndpoint: 'http://127.0.0.1:8080/api/v1/data/contracts',
        sourceVersion: '1.7.1',
        verifiedAt: '2026-09-04T21:00:00+08:00',
        ...overrides,
    });
}

describe('盤中監控正式 cohort contract receipts', () => {
    it('依固定順序建立逐商品 receipt 與 manifest hash', () => {
        const value = createManifest();
        expect(value.cohort).toEqual(['2330.TW', '6488.TWO']);
        expect(value.receipts.map((receipt) => receipt.exchange)).toEqual(['TSE', 'OTC']);
        expect(value.providerRequestAuthority).toBe(false);
        expect(value.subscriptionTransportAuthority).toBe(false);
        expect(validateIntradayMonitorPilotCohortReceiptManifest(value)).toEqual({
            valid: true,
            reasons: [],
        });
    });

    it('缺少、重複或非本機 contract 來源時 fail closed', () => {
        expect(() => createManifest({ contracts: CONTRACTS.slice(0, 1) })).toThrow(/missing/);
        expect(() => createManifest({ contracts: [...CONTRACTS, CONTRACTS[0]] })).toThrow(/ambiguous/);
        expect(() => createManifest({ sourceEndpoint: 'https://example.com/contracts' })).toThrow(/invalid/);
    });

    it('任一 receipt 被竄改後 manifest 驗證失敗', () => {
        const value = createManifest();
        expect(validateIntradayMonitorPilotCohortReceiptManifest({
            ...value,
            receipts: [{ ...value.receipts[0], exchange: 'OTC' }, value.receipts[1]],
        })).toEqual({
            valid: false,
            reasons: ['invalid_cohort_receipt_manifest'],
        });
    });
});
