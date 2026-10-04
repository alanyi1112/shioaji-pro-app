import { describe, expect, it } from 'vitest';

import { decideLateBootPremarketCatchup, taipeiPremarketInstant } from './late-boot-policy.mjs';

const today = { current: true, tradeDate: '2026-10-01', isTradingDate: true,
    previousTradeDate: '2026-09-30' };
const at = (time) => new Date(`2026-10-01T${time}+08:00`);

describe('晚開機盤前接續判定', () => {
    it('以台北日期與秒數判定 08:20 到 08:59 的窗口', () => {
        expect(taipeiPremarketInstant(at('08:42:03')).localTime).toBe('08:42:03');
        expect(decideLateBootPremarketCatchup({ now: at('08:19:59'), authority: today,
            baselineCurrent: true }).reason).toBe('before_premarket_window');
        expect(decideLateBootPremarketCatchup({ now: at('08:20:00'), authority: today,
            baselineCurrent: true }).nextAction).toBe('prepare_session');
        expect(decideLateBootPremarketCatchup({ now: at('08:49:59'), authority: today,
            baselineCurrent: true }).nextAction).toBe('prepare_session');
        expect(decideLateBootPremarketCatchup({ now: at('08:50:00'), authority: today,
            baselineCurrent: true }).nextAction).toBe('prepare_and_capture');
        expect(decideLateBootPremarketCatchup({ now: at('08:58:59'), authority: today,
            baselineCurrent: true }).eligible).toBe(true);
        expect(decideLateBootPremarketCatchup({ now: at('08:59:00'), authority: today,
            baselineCurrent: true }).reason).toBe('late_boot_deadline_passed');
    });

    it('缺排程收據可接續，但不把缺席冒稱成功', () => {
        const result = decideLateBootPremarketCatchup({ now: at('08:55:00'), authority: today,
            baselineCurrent: true, scheduled0820: null, scheduled0850: null });
        expect(result).toMatchObject({ eligible: true, nextAction: 'prepare_and_capture',
            scheduled0820Present: false, scheduled0820Success: false,
            scheduled0850Present: false });
    });

    it('休市、過期日曆、基準缺失或已採集時拒絕', () => {
        const args = { now: at('08:55:00'), authority: today, baselineCurrent: true };
        expect(decideLateBootPremarketCatchup({ ...args,
            authority: { ...today, isTradingDate: false } }).reason).toBe('official_non_trading_date');
        expect(decideLateBootPremarketCatchup({ ...args,
            authority: { ...today, tradeDate: '2026-09-30' } }).reason)
            .toBe('calendar_authority_unavailable');
        expect(decideLateBootPremarketCatchup({ ...args, baselineCurrent: false }).reason)
            .toBe('baseline_missing');
        expect(decideLateBootPremarketCatchup({ ...args, authority: {
            current: false, tradeDate: '2026-10-01', reason: 'verified_calendar_snapshot_missing',
        }, baselineCurrent: false }).reason).toBe('baseline_missing');
        expect(decideLateBootPremarketCatchup({ ...args, captureStarted: true }).reason)
            .toBe('capture_already_started');
    });
});
