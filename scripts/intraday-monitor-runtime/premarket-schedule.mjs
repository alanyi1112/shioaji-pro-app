import { createHash } from 'node:crypto';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';

export const PREMARKET_SCHEDULE_RECEIPT_SCHEMA =
    'intraday-monitor-premarket-schedule-receipt/1';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const SCHEDULER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;

function validDate(value) {
    return typeof value === 'string' && DATE.test(value) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function normalizeLocalTime(value) {
    if (typeof value !== 'string' || !TIME.test(value)) {
        throw new TypeError('requested local time is invalid');
    }
    return value.length === 5 ? `${value}:00` : value;
}

function epoch(value, label) {
    const parsed = typeof value === 'number' ? value : Date.parse(value);
    if (!Number.isSafeInteger(parsed)) throw new TypeError(`${label} is invalid`);
    return parsed;
}

export function taipeiLocalToUtc(tradeDate, localTime) {
    if (!validDate(tradeDate)) throw new TypeError('trade date is invalid');
    const normalizedTime = normalizeLocalTime(localTime);
    const [year, month, day] = tradeDate.split('-').map(Number);
    const [hour, minute, second] = normalizedTime.split(':').map(Number);
    return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second)).toISOString();
}

export function formatTaipeiLocalTime(value) {
    const instant = epoch(value, 'scheduler computed fire time');
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(instant));
    const part = (type) => parts.find((item) => item.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}

export function nextApplicableTradeDate(requestedTradeDate, officialTradingDates) {
    if (!validDate(requestedTradeDate) || !Array.isArray(officialTradingDates)) {
        throw new TypeError('trading calendar input is invalid');
    }
    const dates = [...new Set(officialTradingDates)].filter(validDate).sort();
    return dates.find((date) => date >= requestedTradeDate) ?? null;
}

export function createPremarketScheduleReceipt({ requestedTradeDate, requestedLocalTime,
    schedulerId, computedFireAt, readBackAt, officialTradingDates,
    useNextApplicableTradeDate = false, runClaim = null } = {}) {
    if (!validDate(requestedTradeDate) || typeof schedulerId !== 'string' ||
        !SCHEDULER_ID.test(schedulerId) || !Array.isArray(officialTradingDates)) {
        throw new TypeError('schedule receipt input is invalid');
    }
    const localTime = normalizeLocalTime(requestedLocalTime);
    const calendar = [...new Set(officialTradingDates)].filter(validDate).sort();
    const requestedIsTradingDate = calendar.includes(requestedTradeDate);
    const tradeDate = requestedIsTradingDate ? requestedTradeDate :
        useNextApplicableTradeDate ? nextApplicableTradeDate(requestedTradeDate, calendar) : null;
    const computedEpochMs = epoch(computedFireAt, 'scheduler computed fire time');
    const readBackEpochMs = epoch(readBackAt, 'schedule read back time');
    const scheduledForUtc = tradeDate ? taipeiLocalToUtc(tradeDate, localTime) : null;
    const computedLocalTime = formatTaipeiLocalTime(computedEpochMs);
    const requestedLocalDateTime = tradeDate ? `${tradeDate} ${localTime}` : null;
    const reasons = [];
    if (!tradeDate) reasons.push('requested_date_is_not_an_applicable_trade_date');
    if (tradeDate && computedEpochMs !== Date.parse(scheduledForUtc)) {
        reasons.push('scheduler_computed_local_time_mismatch');
    }
    const fireTimePassed = Boolean(tradeDate && readBackEpochMs >= Date.parse(scheduledForUtc));
    const runClaimMatches = Boolean(runClaim && runClaim.tradeDate === tradeDate &&
        runClaim.schedulerId === schedulerId && typeof runClaim.runId === 'string' &&
        runClaim.runId.length > 0);
    if (fireTimePassed && !runClaimMatches) reasons.push('scheduler_run_missing');
    const status = reasons.length === 0 ? 'ready' : 'invalid';
    const incident = status === 'invalid' ? {
        code: reasons[0], reasons: [...reasons], detectedAt: new Date(readBackEpochMs).toISOString(),
        requestedLocalDateTime, computedLocalTime, schedulerId,
    } : null;
    const receipt = {
        schemaVersion: PREMARKET_SCHEDULE_RECEIPT_SCHEMA,
        requestedTradeDate, tradeDate, requestedLocalTime: localTime,
        requestedLocalDateTime, timeZone: 'Asia/Taipei', scheduledForUtc,
        computedFireAt: new Date(computedEpochMs).toISOString(), computedLocalTime,
        schedulerId, readBackAt: new Date(readBackEpochMs).toISOString(),
        requestedIsTradingDate, usedNextApplicableTradeDate: tradeDate !== null && tradeDate !== requestedTradeDate,
        fireTimePassed, runClaimRequired: fireTimePassed, runClaimMatches,
        consistency: { status, reasons }, incident,
    };
    return Object.freeze({ ...receipt,
        receiptHash: `sha256:${createHash('sha256').update(canonicalJson(receipt)).digest('hex')}` });
}
