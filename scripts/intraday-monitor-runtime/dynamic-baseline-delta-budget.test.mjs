import { describe, expect, it } from 'vitest';

import { checkDynamicBaselineDeltaProgress, createDynamicBaselineDeltaBudget }
    from './dynamic-baseline-delta-budget.mjs';

const limit = 524_288_000;
const sample = (tradeDate, consumedBytes) => ({ tradeDate, consumedBytes,
    providerLimitBytes: limit, sourceSha256: 'a'.repeat(64),
    usageStartSha256: 'b'.repeat(64), usageEndSha256: 'c'.repeat(64),
    verificationSha256: 'd'.repeat(64), baselineSha256: 'e'.repeat(64) });
const samples = [sample('2026-09-23', 24_454_730),
    sample('2026-09-15', 17_933_604), sample('2026-09-14', 19_719_021)];
const observedAt = '2026-09-29T08:20:00+08:00';
const deadlineAt = '2026-09-29T08:35:00+08:00';

function budget(remainingBytes, addedSymbolCount = 11, overrides = {}) {
    return createDynamicBaselineDeltaBudget({ tradeDate: '2026-09-29',
        observedAt, deadlineAt, addedSymbolCount,
        usage: { bytes: limit - remainingBytes, remaining_bytes: remainingBytes,
            limit_bytes: limit }, samples, ...overrides });
}

describe('新監控商品基準差異流量預算', () => {
    it('按可驗證實測樣本和本次新檔數計算，沒有固定啟動 bytes 門檻', () => {
        const one = budget(300_000_000, 1);
        const eleven = budget(300_000_000, 11);
        const eighty = budget(300_000_000, 80);
        expect(one.ready).toBe(true);
        expect(eleven.ready).toBe(true);
        expect(eleven.forecastBytes).toBe(16 * 1024 ** 2);
        expect(eighty.forecastBytes).toBeGreaterThan(eleven.forecastBytes);
        expect(eleven.reserveBytes).toBe(Math.ceil(limit * 0.25));
        expect(eleven.providerPhysicalHeadroom).toBeNull();
        expect(eleven.sampleTradeDates).toEqual(['2026-09-23', '2026-09-15', '2026-09-14']);
    });

    it('缺樣本、剩餘流量不足及盤前期限過後均 fail closed', () => {
        expect(() => budget(300_000_000, 1, { samples: samples.slice(0, 1) }))
            .toThrow('dynamic_baseline_samples_insufficient');
        expect(budget(100_000_000).blocker).toBe('provider_bandwidth_budget_insufficient');
        const unavailable = budget(100_000_000);
        expect(checkDynamicBaselineDeltaProgress({ budget: unavailable,
            usage: { bytes: unavailable.providerUsedBytes,
                remaining_bytes: unavailable.providerRemainingBytes, limit_bytes: limit },
            observedAt: '2026-09-29T08:25:00+08:00' }).allowed).toBe(false);
        expect(() => budget(300_000_000, 1, { observedAt: deadlineAt }))
            .toThrow('dynamic_baseline_delta_budget_input_invalid');
    });

    it('每次請求後以實際 usage、單次回應及 08:35 截止重新檢查', () => {
        const value = budget(300_000_000, 1);
        const usage = (spent) => ({ bytes: value.providerUsedBytes + spent,
            remaining_bytes: value.providerRemainingBytes - spent, limit_bytes: limit });
        expect(checkDynamicBaselineDeltaProgress({ budget: value, usage: usage(1_000_000),
            observedAt: '2026-09-29T08:25:00+08:00', responseBytes: 1_000_000 }).allowed).toBe(true);
        expect(checkDynamicBaselineDeltaProgress({ budget: value, usage: usage(1_000_000),
            observedAt: '2026-09-29T08:35:00+08:00' }).reason).toBe('baseline_deadline_exceeded');
        expect(checkDynamicBaselineDeltaProgress({ budget: value, usage: usage(1_000_000),
            observedAt: '2026-09-29T08:25:00+08:00', responseBytes: 17 * 1024 ** 2 })
            .reason).toBe('baseline_response_too_large');
        expect(checkDynamicBaselineDeltaProgress({ budget: value,
            usage: usage(value.actualSpendAllowanceBytes + 1),
            observedAt: '2026-09-29T08:25:00+08:00' }).reason)
            .toBe('provider_bandwidth_budget_exceeded');
    });
});
