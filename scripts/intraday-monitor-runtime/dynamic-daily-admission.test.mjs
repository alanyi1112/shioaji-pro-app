import { describe, expect, it } from 'vitest';

import { INTRADAY_MONITOR_CONFIG_SCHEMA, validateIntradayMonitorConfig }
    from '../../src/lib/intraday-relative-volume-monitor-domain.ts';
import { INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA }
    from './trading-calendar-authority.mjs';
import { createDynamicDailyCohortPlan } from './dynamic-daily-cohort-plan.mjs';
import { createDynamicDailyAdmission, recordDynamicDailyDataEvidence,
    recordDynamicDailySubscription } from './dynamic-daily-admission.mjs';

function fixture(count = 2, missing = [1]) {
    const codes = Array.from({ length: count }, (_, index) => String(1001 + index));
    const parsed = validateIntradayMonitorConfig({ schemaVersion: INTRADAY_MONITOR_CONFIG_SCHEMA,
        revision: 8, globalThreshold: '1.5', items: codes.map((code) => ({
            contract: { security_type: 'STK', region: 'TW', exchange: 'TSE', code,
                target_code: null }, enabled: true, thresholdOverride: null, source: 'manual' })) });
    expect(parsed.ok).toBe(true);
    const plan = createDynamicDailyCohortPlan({ config: parsed.value,
        authority: { schemaVersion: INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA,
            current: true, isTradingDate: true, tradeDate: '2026-09-30',
            previousTradeDate: '2026-09-29', sourceVersions: ['fixture/1'],
            observedAt: '2026-09-29T13:35:00+08:00' },
        approval: { decision: 'go', approvedActiveLimit: 160, approvalHash: 'a'.repeat(64) },
        createdAt: '2026-09-29T13:36:00+08:00' });
    const items = plan.selected.map((entry, index) => ({
        canonicalSymbol: entry.canonicalSymbol,
        state: missing.includes(index) ? 'waiting_baseline' : 'baseline_ready',
        reason: missing.includes(index) ? 'baseline_missing' : null,
        manifestId: missing.includes(index) ? null : `sha256:${'b'.repeat(64)}`,
    }));
    const coverage = { planHash: plan.planHash, tradeDate: plan.tradeDate,
        previousTradeDate: plan.previousTradeDate, plannedCount: count,
        baselineReadyCount: count - missing.length,
        exact160BaselineReady: count === 160 && missing.length === 0, items };
    return { plan, coverage };
}

function subscription(admission) {
    return { planHash: admission.planHash, tradeDate: admission.tradeDate,
        cohortSize: admission.plannedCount,
        canonicalSymbols: admission.contracts.map((item) => item.canonicalSymbol),
        sharedSession: true, sameGeneration: true, secondLogin: false,
        secondStream: false, rotation: false, batchCount: 1, subscribeAccepted: true };
}

function evidence(admission, index) {
    return { planHash: admission.planHash, tradeDate: admission.tradeDate,
        canonicalSymbol: admission.items[index].canonicalSymbol,
        baselineManifestId: admission.items[index].baselineManifestId,
        sameGeneration: true, liveKbar: true, unit: 'common_lot', minuteKey: '09:01',
        currentCumulativeVolume: 10, previousCumulativeVolume: 5,
        sealedMinuteComplete: true, baselineMinuteMatched: true,
        receivedAt: '2026-09-30T09:02:01+08:00' };
}

describe('動態每日名單 admission', () => {
    it('缺基準商品不輪替候補，逐檔隔離且控制面不冒充資料面', () => {
        const admission = createDynamicDailyAdmission(fixture());
        expect(admission).toMatchObject({ plannedCount: 2, baselineReadyCount: 1,
            exact160BaselineReady: false, subscriptionRequestedCount: 0, dataActiveCount: 0 });
        const requested = recordDynamicDailySubscription(admission, subscription(admission));
        expect(requested).toMatchObject({ subscriptionRequestedCount: 2, dataActiveCount: 0 });
        const first = recordDynamicDailyDataEvidence(requested, evidence(requested, 0));
        const second = recordDynamicDailyDataEvidence(first, evidence(first, 1));
        expect(second).toMatchObject({ plannedCount: 2, baselineReadyCount: 1,
            subscriptionRequestedCount: 2, dataActiveCount: 1 });
        expect(second.items[0]).toMatchObject({ dataState: 'active', comparisonEligible: true,
            notificationEligible: false });
        expect(second.items[1]).toMatchObject({ dataState: 'partial', comparisonEligible: false,
            notificationEligible: false });
    });

    it('完整 160 是獨立基準判定，訂閱 accepted 不等於資料啟用', () => {
        const admission = createDynamicDailyAdmission(fixture(160, []));
        expect(admission.exact160BaselineReady).toBe(true);
        expect(recordDynamicDailySubscription(admission, subscription(admission)))
            .toMatchObject({ subscriptionRequestedCount: 160, dataActiveCount: 0 });
    });

    it('拒絕不同 plan、第二條串流、第二次訂閱與盤中換股', () => {
        const admission = createDynamicDailyAdmission(fixture());
        expect(() => createDynamicDailyAdmission({ ...fixture(),
            coverage: { ...fixture().coverage, planHash: 'wrong' } })).toThrow();
        expect(() => recordDynamicDailySubscription(admission,
            { ...subscription(admission), secondStream: true })).toThrow();
        expect(() => recordDynamicDailySubscription(admission,
            { ...subscription(admission), canonicalSymbols: ['1002.TW', '1001.TW'] })).toThrow();
        const requested = recordDynamicDailySubscription(admission, subscription(admission));
        expect(() => recordDynamicDailySubscription(requested, subscription(admission))).toThrow();
        expect(() => recordDynamicDailyDataEvidence(requested,
            { ...evidence(requested, 0), canonicalSymbol: '2330.TW' })).toThrow();
    });

    it('錯誤單位／基準 manifest／不完整分鐘均不得比較', () => {
        const admission = createDynamicDailyAdmission(fixture(1, []));
        const requested = recordDynamicDailySubscription(admission, subscription(admission));
        expect(() => recordDynamicDailyDataEvidence(requested,
            { ...evidence(requested, 0), unit: 'shares' })).toThrow();
        expect(recordDynamicDailyDataEvidence(requested,
            { ...evidence(requested, 0), baselineManifestId: 'wrong' }).dataActiveCount).toBe(0);
        expect(recordDynamicDailyDataEvidence(requested,
            { ...evidence(requested, 0), sealedMinuteComplete: false }).dataActiveCount).toBe(0);
    });
});
