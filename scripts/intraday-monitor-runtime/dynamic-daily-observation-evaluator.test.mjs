import { describe, expect, it } from 'vitest';

import { INTRADAY_MONITOR_CONFIG_SCHEMA, validateIntradayMonitorConfig }
    from '../../src/lib/intraday-relative-volume-monitor-domain.ts';
import { baselineCalendar, verifyDirect160HistoricalSymbol }
    from './direct-160-baseline.mjs';
import { dynamicDailySymbolBaselineCohortHash, resolveDynamicDailyBaselineCoverage }
    from './dynamic-daily-baseline-resolver.mjs';
import { createDynamicDailyCohortPlan } from './dynamic-daily-cohort-plan.mjs';
import { createDynamicDailyBaselineGateReceipt, createDynamicDailyFinalGateReceipt }
    from './dynamic-daily-premarket-gate.mjs';
import { evaluateDynamicDailySealedObservation }
    from './dynamic-daily-observation-evaluator.mjs';
import { symbolFixture } from './fixtures/direct-160-baseline.mjs';
import { INTRADAY_MONITOR_OBSERVATION_SCHEMA } from './minute-accumulator.mjs';
import { INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA }
    from './trading-calendar-authority.mjs';

function setup() {
    const twse = { stat: 'ok', queryYear: 2026, fields: ['日期', '名稱', '說明'],
        data: [['2026-01-01', '中華民國開國紀念日', '依規定放假1日。']] };
    const tpex = { data: { html: '<table><tr><td>中華民國115年有價證券櫃檯買賣市場開（休）市日期表</td></tr></table><table><tr><td>中華民國開國紀念日</td><td>1月1日</td><td>四</td><td>依規定放假1日。</td></tr></table>' } };
    const calendar = baselineCalendar(twse, tpex, '2026-09-11', '2026-09-14',
        Date.parse('2026-09-11T14:00:00+08:00'));
    const config = validateIntradayMonitorConfig({ schemaVersion: INTRADAY_MONITOR_CONFIG_SCHEMA,
        revision: 9, globalThreshold: '1.5', items: ['1001', '1002'].map((code) => ({
            contract: { security_type: 'STK', region: 'TW', exchange: 'TSE', code,
                target_code: null }, enabled: true, thresholdOverride: null,
            source: 'manual' })) });
    expect(config.ok).toBe(true);
    const plan = createDynamicDailyCohortPlan({ config: config.value,
        authority: { schemaVersion: INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA,
            current: true, isTradingDate: true, tradeDate: '2026-09-14',
            previousTradeDate: '2026-09-11', sourceVersions: [calendar.sourceVersion],
            observedAt: '2026-09-11T13:35:00+08:00' },
        approval: { decision: 'go', approvedActiveLimit: 160,
            approvalHash: 'a'.repeat(64) },
        createdAt: '2026-09-11T13:36:00+08:00' });
    const entry = { canonicalSymbol: '1001.TW', contractIdentity: {
        security_type: 'STK', region: 'TW', exchange: 'TSE', code: '1001',
        target_code: null } };
    const cohortHash = dynamicDailySymbolBaselineCohortHash({ tradeDate: plan.tradeDate,
        previousTradeDate: plan.previousTradeDate, canonicalSymbol: '1001.TW',
        exchange: 'TSE' }).slice(7);
    const manifest = verifyDirect160HistoricalSymbol(symbolFixture(entry, cohortHash, calendar));
    const coverage = resolveDynamicDailyBaselineCoverage({ plan,
        standaloneManifests: [manifest] });
    const baselineGate = createDynamicDailyBaselineGateReceipt({ plan, coverage,
        sources: [{ manifest, sourceHash: manifest.manifestId,
            sealedAt: '2026-09-11T14:03:00+08:00' }],
        checkedAt: '2026-09-14T08:35:00+08:00',
        officialCalendarCurrent: true, previousSessionFinalized: true });
    // 第二檔缺基準時可部分就緒；仍須有當日正式 Gate 才能比較第一檔。
    const finalGate = createDynamicDailyFinalGateReceipt({ plan, baselineGate,
        checkedAt: '2026-09-14T08:45:00+08:00', savedConfigRevision: 9,
        officialCalendarCurrent: true, simulation: true, businessSessionCurrent: true,
        connectionGeneration: 'simulation:1234567890abcdef' });
    return { plan, coverage, manifests: [manifest], finalGate };
}

function observation(code, volume = 4) {
    return { schemaVersion: INTRADAY_MONITOR_OBSERVATION_SCHEMA,
        contract: { securityType: 'STK', region: 'TW', exchange: 'TSE', code,
            targetCode: null, canonicalSymbol: `${code}.TW` },
        tradeDate: '2026-09-14', minuteKey: '09:01', exchangeTime: '09:01:00',
        receivedTime: '2026-09-14T09:02:01+08:00',
        connectionGeneration: 'simulation:1234567890abcdef', sequence: 1,
        cumulativeVolume: volume, unit: 'common_lot', source: 'shioaji-kbar-stream',
        sourceVersion: 'fixture/1', simtrade: false, intradayOdd: false,
        continuity: 'complete' };
}

describe('每日封存分鐘的同商品同分鐘比較', () => {
    it('缺當日正式 Gate 時即使有前日基準仍只能 unknown，不產生通知權限', () => {
        const input = setup();
        const result = evaluateDynamicDailySealedObservation({ ...input,
            finalGate: null,
            observation: observation('1001'),
            connectionGeneration: 'simulation:1234567890abcdef' });
        expect(result).toMatchObject({ canonicalSymbol: '1001.TW', minuteKey: '09:01',
            currentCumulativeVolume: 4, previousCumulativeVolume: 2,
            classification: 'unknown', comparable: false, gateCurrent: false,
            notificationAuthority: false });
    });

    it('部分就緒 Gate 只允許有基準的商品比較，不給通知權限', () => {
        const input = setup();
        expect(input.finalGate.outcome).toBe('partial_ready');
        const ready = evaluateDynamicDailySealedObservation({ ...input,
            observation: observation('1001'),
            connectionGeneration: 'simulation:1234567890abcdef' });
        expect(ready).toMatchObject({ classification: 'matched', comparable: true,
            gateCurrent: true, notificationAuthority: false });
        const missing = evaluateDynamicDailySealedObservation({ ...input,
            observation: observation('1002'),
            connectionGeneration: 'simulation:1234567890abcdef' });
        expect(missing).toMatchObject({ classification: 'unknown', comparable: false,
            notificationAuthority: false });
    });

    it('另一檔缺基準只回 unknown；錯 generation、跨商品與未封分鐘一律拒絕', () => {
        const input = setup();
        const missing = evaluateDynamicDailySealedObservation({ ...input,
            observation: observation('1002'),
            connectionGeneration: 'simulation:1234567890abcdef' });
        expect(missing).toMatchObject({ canonicalSymbol: '1002.TW',
            classification: 'unknown', comparable: false,
            previousCumulativeVolume: null, notificationAuthority: false });
        expect(() => evaluateDynamicDailySealedObservation({ ...input,
            observation: observation('1001'), connectionGeneration: 'wrong' })).toThrow();
        expect(() => evaluateDynamicDailySealedObservation({ ...input,
            observation: observation('2330'),
            connectionGeneration: 'simulation:1234567890abcdef' })).toThrow();
        expect(() => evaluateDynamicDailySealedObservation({ ...input,
            observation: { ...observation('1001'), continuity: 'unknown' },
            connectionGeneration: 'simulation:1234567890abcdef' })).toThrow();
    });
});
