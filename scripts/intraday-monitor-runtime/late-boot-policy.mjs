const TAIPEI_CLOCK = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function taipeiPremarketInstant(now) {
    if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) {
        throw new TypeError('late boot time is invalid');
    }
    const parts = TAIPEI_CLOCK.formatToParts(now);
    const value = (type) => parts.find((part) => part.type === type)?.value;
    const localDate = `${value('year')}-${value('month')}-${value('day')}`;
    const localTime = `${value('hour')}:${value('minute')}:${value('second')}`;
    return Object.freeze({ localDate, localTime,
        seconds: Number(value('hour')) * 3_600 + Number(value('minute')) * 60 +
            Number(value('second')) });
}

export function decideLateBootPremarketCatchup({ now, authority, baselineCurrent,
    scheduled0820, scheduled0850, captureStarted = false } = {}) {
    const instant = taipeiPremarketInstant(now);
    if (instant.seconds < 8 * 3_600 + 20 * 60) {
        return Object.freeze({ eligible: false, reason: 'before_premarket_window', ...instant });
    }
    if (instant.seconds >= 8 * 3_600 + 59 * 60) {
        return Object.freeze({ eligible: false, reason: 'late_boot_deadline_passed', ...instant });
    }
    if (authority?.current !== true || authority.tradeDate !== instant.localDate) {
        return Object.freeze({ eligible: false,
            reason: authority?.reason === 'verified_calendar_snapshot_missing'
                ? 'baseline_missing' : 'calendar_authority_unavailable', ...instant });
    }
    if (authority.isTradingDate !== true) {
        return Object.freeze({ eligible: false, reason: 'official_non_trading_date', ...instant });
    }
    if (baselineCurrent !== true) {
        return Object.freeze({ eligible: false, reason: 'baseline_missing', ...instant });
    }
    if (captureStarted || scheduled0850?.rolloverOutcome === 'capture_started') {
        return Object.freeze({ eligible: false, reason: 'capture_already_started', ...instant });
    }
    return Object.freeze({ eligible: true, reason: null,
        nextAction: instant.seconds >= 8 * 3_600 + 50 * 60 ? 'prepare_and_capture' : 'prepare_session',
        scheduled0820Present: scheduled0820 !== null && scheduled0820 !== undefined,
        scheduled0820Success: scheduled0820?.rolloverOutcome === 'session_created',
        scheduled0850Present: scheduled0850 !== null && scheduled0850 !== undefined,
        ...instant });
}
