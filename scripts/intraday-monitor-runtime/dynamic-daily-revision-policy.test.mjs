import { describe, expect, it } from 'vitest';

import { INTRADAY_MONITOR_CONFIG_SCHEMA, validateIntradayMonitorConfig }
    from '../../src/lib/intraday-relative-volume-monitor-domain.ts';
import { createDynamicDailyCohortPlan } from './dynamic-daily-cohort-plan.mjs';
import { decideDynamicDailyOldPlanConflict,
    resolveDynamicDailyRevisionPolicy } from './dynamic-daily-revision-policy.mjs';
import { INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA }
    from './trading-calendar-authority.mjs';

function config(revision, codes, disabled = []) {
    const result = validateIntradayMonitorConfig({ schemaVersion: INTRADAY_MONITOR_CONFIG_SCHEMA,
        revision, globalThreshold: '1.5', items: codes.map((code) => ({
            contract: { security_type: 'STK', region: 'TW', exchange: 'TSE', code,
                target_code: null }, enabled: !disabled.includes(code),
            thresholdOverride: null, source: 'manual' })) });
    expect(result.ok).toBe(true);
    return result.value;
}

function plan() {
    return createDynamicDailyCohortPlan({ config: config(9, ['2330', '2317']),
        authority: { schemaVersion: INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA,
            current: true, isTradingDate: true, tradeDate: '2026-09-30',
            previousTradeDate: '2026-09-29', sourceVersions: ['fixture/1'],
            observedAt: '2026-09-29T13:35:00+08:00' },
        approval: { decision: 'go', approvedActiveLimit: 160, approvalHash: 'a'.repeat(64) },
        createdAt: '2026-09-29T13:36:00+08:00' });
}

describe('每日監控設定生效時間', () => {
    it('08:35 前新修訂僅等待有界差異驗證，不立即熱換', () => {
        const status = resolveDynamicDailyRevisionPolicy({ plan: plan(),
            savedConfig: config(10, ['2330', '2317', '2454']),
            savedAt: '2026-09-30T08:25:00+08:00',
            nextApplicableTradeDate: '2026-10-01' });
        expect(status).toMatchObject({ decision: 'awaiting_premarket_delta',
            effectiveTradeDate: '2026-09-30', added: ['2454.TW'],
            requiresOldPlanConfirmation: false, subscriptionRotationAllowed: false });
    });

    it('08:35 後新增、已封存後修訂一律待下個官方交易日', () => {
        const after = resolveDynamicDailyRevisionPolicy({ plan: plan(),
            savedConfig: config(10, ['2330', '2317', '2454']),
            savedAt: '2026-09-30T08:35:00+08:00',
            nextApplicableTradeDate: '2026-10-01' });
        expect(after).toMatchObject({ decision: 'pending_next_trade_date',
            effectiveTradeDate: '2026-10-01', oldPlanStillEffective: true });
        const sealed = resolveDynamicDailyRevisionPolicy({ plan: plan(),
            savedConfig: config(10, ['2330', '2317', '2454']),
            savedAt: '2026-09-30T08:25:00+08:00', currentPlanSealed: true,
            nextApplicableTradeDate: '2026-10-01' });
        expect(sealed.decision).toBe('pending_next_trade_date');
    });

    it('刪除或停用原商品時要求明示確認，暫停比較但不改 plan／訂閱', () => {
        const status = resolveDynamicDailyRevisionPolicy({ plan: plan(),
            savedConfig: config(10, ['2330', '2317'], ['2317']),
            savedAt: '2026-09-30T10:00:00+08:00',
            nextApplicableTradeDate: '2026-10-01', currentPlanSealed: true });
        expect(status).toMatchObject({ removedOrDisabled: ['2317.TW'],
            requiresOldPlanConfirmation: true, oldPlanStillEffective: true });
        expect(() => decideDynamicDailyOldPlanConflict(status, {
            policyHash: 'wrong', choice: 'suppress_removed', confirmed: true })).toThrow();
        expect(decideDynamicDailyOldPlanConflict(status, {
            policyHash: status.policyHash, choice: 'suppress_removed', confirmed: true }))
            .toMatchObject({ suppressedSymbols: ['2317.TW'],
                planRewritten: false, subscriptionRotated: false,
                notificationAuthorityForSuppressed: false });
    });

    it('同 revision 內容 hash 不符與官方下一交易日未知時 fail closed', () => {
        expect(() => resolveDynamicDailyRevisionPolicy({ plan: plan(),
            savedConfig: config(9, ['2317', '2330']),
            savedAt: '2026-09-30T08:00:00+08:00' }))
            .toThrow('daily_revision_config_hash_mismatch');
        const status = resolveDynamicDailyRevisionPolicy({ plan: plan(),
            savedConfig: config(10, ['2330', '2317', '2454']),
            savedAt: '2026-09-30T10:00:00+08:00' });
        expect(status).toMatchObject({ decision: 'pending_official_trade_date',
            effectiveTradeDate: null });
    });
});
