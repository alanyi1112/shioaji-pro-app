import { describe, expect, it } from 'vitest';

import { INTRADAY_MONITOR_CONFIG_SCHEMA, validateIntradayMonitorConfig }
    from '../../src/lib/intraday-relative-volume-monitor-domain.ts';
import { createDynamicDailyCohortPlan } from './dynamic-daily-cohort-plan.mjs';
import { projectDynamicDailyStatus } from './dynamic-daily-status-projection.mjs';
import { INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA }
    from './trading-calendar-authority.mjs';

function setup() {
    const config = validateIntradayMonitorConfig({ schemaVersion: INTRADAY_MONITOR_CONFIG_SCHEMA,
        revision: 9, globalThreshold: '1.5', items: ['1001', '1002'].map((code) => ({
            contract: { security_type: 'STK', region: 'TW', exchange: 'TSE', code,
                target_code: null }, enabled: true, thresholdOverride: null,
            source: 'manual' })) }).value;
    const plan = createDynamicDailyCohortPlan({ config,
        authority: { schemaVersion: INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA,
            current: true, isTradingDate: true, tradeDate: '2026-09-30',
            previousTradeDate: '2026-09-29', sourceVersions: ['fixture/1'],
            observedAt: '2026-09-29T13:35:00+08:00' },
        approval: { decision: 'go', approvedActiveLimit: 160,
            approvalHash: 'a'.repeat(64) },
        createdAt: '2026-09-29T13:36:00+08:00' });
    const coverage = { planHash: plan.planHash, tradeDate: plan.tradeDate,
        previousTradeDate: plan.previousTradeDate,
        items: [{ canonicalSymbol: '1001.TW', state: 'baseline_ready', reason: null },
            { canonicalSymbol: '1002.TW', state: 'waiting_baseline',
                reason: 'baseline_missing' }] };
    return { config, plan, coverage };
}

describe('每日監控狀態不可混用計數', () => {
    it('僅有歷史容量核准時仍為 feature-off，不冒稱已規劃或已監控', () => {
        const { config } = setup();
        expect(projectDynamicDailyStatus({ config })).toMatchObject({ mode: 'feature_off',
            configured: 2, planned: 0, baselineReady: 0,
            subscriptionRequested: 0, dataActive: 0, effectiveTradeDate: null });
    });

    it('部分基準、控制面與資料面各自計算，缺口逐檔呈現', () => {
        const input = setup();
        const withoutLive = projectDynamicDailyStatus(input);
        expect(withoutLive).toMatchObject({ configured: 2, planned: 2,
            baselineReady: 1, subscriptionRequested: 0, dataActive: 0,
            degraded: null, exact160BaselineReady: false, evidenceState: 'not_live' });
        const expectedGeneration = 'simulation:1234567890abcdef';
        const live = { phase: 'running', planHash: input.plan.planHash,
            connectionGeneration: expectedGeneration,
            tradeDate: input.plan.tradeDate, admission: {
                planHash: input.plan.planHash, plannedCount: 2,
                subscriptionRequestedCount: 2, dataActiveCount: 1,
                items: [{ canonicalSymbol: '1001.TW', subscriptionState: 'requested',
                    dataState: 'active', comparisonEligible: true },
                { canonicalSymbol: '1002.TW', subscriptionState: 'requested',
                    dataState: 'partial', comparisonEligible: false }],
            } };
        const projected = projectDynamicDailyStatus({ ...input, live, expectedGeneration });
        expect(projected).toMatchObject({ subscriptionRequested: 2, dataActive: 1,
            degraded: 1,
            evidenceState: 'observed', notificationAuthority: false });
        expect(projected.items[1]).toMatchObject({ baselineState: 'waiting_baseline',
            dataState: 'partial', comparisonEligible: false });
        const wrongPlan = projectDynamicDailyStatus({ ...input, expectedGeneration,
            live: { ...live, planHash: 'wrong' } });
        expect(wrongPlan).toMatchObject({ subscriptionRequested: 0, dataActive: 0,
            evidenceState: 'not_live' });
        expect(projectDynamicDailyStatus({ ...input, live,
            expectedGeneration: 'simulation:aaaaaaaaaaaaaaaa' }))
            .toMatchObject({ subscriptionRequested: 0, dataActive: 0,
                evidenceState: 'not_live' });
    });

    it('revision 更新只顯示待生效，不使舊計數或日期改名', () => {
        const input = setup();
        const config = { ...input.config, revision: 10 };
        expect(projectDynamicDailyStatus({ ...input, config }))
            .toMatchObject({ planRevision: 9, pendingRevision: 10,
                pendingReason: 'revision_unverified',
                pendingEffectiveTradeDate: null,
                revisionEvidence: 'pending_unverified' });
        const value = projectDynamicDailyStatus({ ...input, config, pending: {
            planHash: input.plan.planHash, savedRevision: 10,
            decision: 'pending_next_trade_date', effectiveTradeDate: '2026-10-01',
        } });
        expect(value).toMatchObject({ configRevision: 10, planRevision: 9,
            effectiveTradeDate: '2026-09-30', pendingRevision: 10,
            pendingEffectiveTradeDate: '2026-10-01',
            pendingReason: 'pending_next_trade_date',
            revisionEvidence: 'pending_verified' });
    });
});
