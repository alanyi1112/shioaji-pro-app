import assert from 'node:assert/strict';
import { test } from 'vitest';

import { calculateDailyMinuteVolumeBudgetPlan } from './daily-minute-volume-budget-plan.mjs';

test('依實測與現有保留額度算全量上界；預算不足不暗示可啟用', () => {
    const current = calculateDailyMinuteVolumeBudgetPlan({
        remainingBytes: 452_733_348, quoteReserveBytes: 314_572_800,
        otherCommittedBytes: 85_667_193, retainedEstimatedBytes: 65_362_668,
        maxObservedUsageDeltaBytes: 244_804, estimateMultiplier: 1.5,
        missingRequests: 320,
    });
    assert.deepEqual(current, {
        estimatePerRequest: 367_206, missingRequests: 320,
        requiredBytes: 117_505_920, availableBytes: -12_869_313,
        shortfallBytes: 130_375_233, readyForBudgetPreflight: false,
        admissionStillRequired: true,
    });
    const hypothetical = calculateDailyMinuteVolumeBudgetPlan({
        remainingBytes: 452_733_348, quoteReserveBytes: 220 * 1024 ** 2,
        otherCommittedBytes: 0, retainedEstimatedBytes: 65_362_668,
        maxObservedUsageDeltaBytes: 244_804, estimateMultiplier: 1.5,
        missingRequests: 320,
    });
    assert.equal(hypothetical.readyForBudgetPreflight, true);
    assert.equal(hypothetical.availableBytes - hypothetical.requiredBytes, 39_178_040);
});

test('清單已發布則不憑固定160檔重抓；輸入與溢位嚴格拒絕', () => {
    const zero = calculateDailyMinuteVolumeBudgetPlan({ remainingBytes: 100,
        quoteReserveBytes: 80, otherCommittedBytes: 20,
        retainedEstimatedBytes: 0, maxObservedUsageDeltaBytes: 1,
        estimateMultiplier: 1, missingRequests: 0 });
    assert.equal(zero.requiredBytes, 0);
    assert.equal(zero.readyForBudgetPreflight, true);
    assert.throws(() => calculateDailyMinuteVolumeBudgetPlan({ remainingBytes: 1,
        quoteReserveBytes: 0, otherCommittedBytes: 0, retainedEstimatedBytes: 0,
        maxObservedUsageDeltaBytes: 1, estimateMultiplier: 1, missingRequests: 321 }),
        /daily_budget_plan_invalid/);
});
