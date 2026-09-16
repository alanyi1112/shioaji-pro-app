import { describe, expect, it } from 'vitest';

import { assessIntradayMonitorDailyEvidence } from './pilot-daily-evidence-status.mjs';

const plan = {};

describe('每日盤中試辦 evidence 完整性守門', () => {
    it('10:00 後缺被動 K 線 evidence 立即要求處理，不等到收盤才發現', () => {
        expect(assessIntradayMonitorDailyEvidence({
            tradeDate: '2026-09-11', previousTradeDate: '2026-09-10',
            now: '2026-09-11T10:00:00+08:00', plan,
        })).toMatchObject({
            status: 'attention', readyForDailyBundle: false,
            warnings: ['passive_chart_evidence_overdue'],
            nextActions: [
                'observe_existing_chart_twice_without_interaction',
                'build_and_validate_passive_chart_evidence',
            ],
        });
    });

    it('收盤後 capture 成功但缺兩份 companion evidence 時固定拒絕當日 bundle', () => {
        expect(assessIntradayMonitorDailyEvidence({
            tradeDate: '2026-09-10', previousTradeDate: '2026-09-09',
            now: '2026-09-10T13:35:00+08:00', plan,
        })).toMatchObject({
            status: 'failed', readyForDailyBundle: false,
            reasons: [
                'capture_outcome_missing',
                'passive_chart_evidence_missing',
                'runtime_assurance_missing',
            ],
            nextActions: ['preserve_day_as_incomplete_and_do_not_build_two_day_bundle'],
        });
    });

    it('assurance 不得脫離同日 chart evidence 或引用錯誤前一交易日', () => {
        const result = assessIntradayMonitorDailyEvidence({
            tradeDate: '2026-09-11', previousTradeDate: '2026-09-10',
            now: '2026-09-11T10:30:00+08:00', plan,
            assurance: { tradeDate: '2026-09-11', previousTradeDate: '2026-09-09' },
        });
        expect(result.reasons).toContain('runtime_assurance_previous_trade_date_mismatch');
        expect(result.reasons).toContain('runtime_assurance_without_chart_evidence');
    });
});
