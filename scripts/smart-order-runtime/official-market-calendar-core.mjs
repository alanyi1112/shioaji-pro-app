import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';

export const SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SCHEMA_VERSION =
    'smart-order-official-market-calendar/2026-08-22.1';
export const SMART_ORDER_OFFICIAL_MARKET_CALENDAR_REFRESH_MS = 6 * 60 * 60 * 1_000;
export const SMART_ORDER_OFFICIAL_MARKET_CALENDAR_TTL_MS = 12 * 60 * 60 * 1_000;
export const SMART_ORDER_EXCHANGE_TIME_MAX_SKEW_MS = 2_000;
export const SMART_ORDER_EXCHANGE_TIME_EVIDENCE_TTL_MS = 2_000;

export const SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SOURCES = Object.freeze({
    TSE: Object.freeze({
        market: 'TWSE',
        sourceId: 'twse-official-holiday-schedule-json',
        landingPage: 'https://www.twse.com.tw/zh/trading/holiday.html',
        annualUrl(year) {
            return `https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json&queryYear=${year - 1911}`;
        },
    }),
    OTC: Object.freeze({
        market: 'TPEx',
        sourceId: 'tpex-official-trading-date-json',
        landingPage: 'https://www.tpex.org.tw/zh-tw/announce/market/holiday.html',
        annualUrl(year) {
            return `https://www.tpex.org.tw/www/zh-tw/bulletin/tradingDate?date=${year}`;
        },
    }),
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CONTRACT_PATTERN = /^(TSE|OTC):(?:STK:)?[A-Za-z0-9][A-Za-z0-9._-]{0,31}(?::STK:Common)?$/;
const CLOSED_TEXT_PATTERN = /放假|市場無交易|休市/;
const OPEN_TEXT_PATTERN = /開始交易|恢復交易/;

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function safeEpoch(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} must be a non-negative epoch millisecond`);
    }
    return value;
}

function safeYear(value) {
    if (!Number.isSafeInteger(value) || value < 2020 || value > 2200) {
        throw new TypeError('calendar year is outside the supported range');
    }
    return value;
}

function plainRecord(value, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
        throw new TypeError(`${label} must be a plain record`);
    }
    return value;
}

function strictDate(year, month, day) {
    const epochMs = Date.UTC(year, month - 1, day);
    const date = new Date(epochMs);
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        throw new Error('official calendar contains an invalid date');
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function taipeiParts(epochMs) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(epochMs));
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return Object.freeze({
        tradeDate: `${map.year}-${map.month}-${map.day}`,
        hour: Number(map.hour),
        minute: Number(map.minute),
        second: Number(map.second),
    });
}

function datesInYear(year) {
    const dates = [];
    for (
        let epochMs = Date.UTC(year, 0, 1);
        epochMs < Date.UTC(year + 1, 0, 1);
        epochMs += 86_400_000
    ) {
        dates.push(new Date(epochMs).toISOString().slice(0, 10));
    }
    return dates;
}

function weekend(tradeDate) {
    const day = new Date(`${tradeDate}T00:00:00.000Z`).getUTCDay();
    return day === 0 || day === 6;
}

function stripHtml(value) {
    return String(value)
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;|&#160;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

export function parseTwseOfficialCalendar(payload, expectedYear) {
    const year = safeYear(expectedYear);
    const body = plainRecord(payload, 'TWSE calendar payload');
    if (
        body.stat !== 'ok' ||
        body.queryYear !== year ||
        !Array.isArray(body.fields) ||
        !Array.isArray(body.data) ||
        body.data.length < 1 ||
        body.data.length > 128
    ) {
        throw new Error('TWSE official calendar response is invalid');
    }
    const expectedFields = ['日期', '名稱', '說明'];
    if (
        body.fields.length !== expectedFields.length ||
        !body.fields.every((field, index) => field === expectedFields[index])
    ) {
        throw new Error('TWSE official calendar schema changed');
    }
    const closedDates = new Set();
    for (const row of body.data) {
        if (!Array.isArray(row) || row.length !== 3) {
            throw new Error('TWSE official calendar row is invalid');
        }
        const [tradeDate, name, description] = row;
        if (
            typeof tradeDate !== 'string' ||
            !DATE_PATTERN.test(tradeDate) ||
            !tradeDate.startsWith(`${year}-`) ||
            typeof name !== 'string' ||
            typeof description !== 'string'
        ) {
            throw new Error('TWSE official calendar row schema changed');
        }
        // Every row in this endpoint is an official special-market date. Only
        // the two explicit stock-market reopening/final-trading labels are
        // open; all new or changed semantics remain closed until reviewed.
        const explicitlyOpen =
            /開始交易日|最後交易日/.test(name) &&
            /開始交易|最後交易/.test(`${name} ${description}`);
        if (!explicitlyOpen) closedDates.add(tradeDate);
    }
    return Object.freeze({
        market: 'TWSE',
        sourceId: SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SOURCES.TSE.sourceId,
        sourceRevision: sha256(canonicalJson(body)),
        title: String(body.title ?? `${year} TWSE holiday schedule`),
        year,
        closedDates: Object.freeze([...closedDates].sort()),
    });
}

export function parseTpexOfficialCalendar(payload, expectedYear) {
    const year = safeYear(expectedYear);
    const body = plainRecord(payload, 'TPEx calendar payload');
    const data = plainRecord(body.data, 'TPEx calendar payload.data');
    if (typeof data.html !== 'string' || data.html.length < 100 || data.html.length > 512_000) {
        throw new Error('TPEx official calendar response is invalid');
    }
    const titleText = stripHtml(data.html.match(/<table[^>]*>[\s\S]*?<\/table>/i)?.[0] ?? '');
    if (!titleText.includes(String(year - 1911)) || !titleText.includes('開（休）市日期表')) {
        throw new Error('TPEx official calendar year/title mismatch');
    }
    const closedDates = new Set();
    const rows = [...data.html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    if (rows.length < 2 || rows.length > 256) {
        throw new Error('TPEx official calendar row count is invalid');
    }
    for (const row of rows) {
        const rowText = stripHtml(row[1]);
        const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
            (match) => stripHtml(match[1]),
        );
        if (cells.length < 3) {
            const annualTitleRow =
                cells.length === 1 &&
                rowText.includes(String(year - 1911)) &&
                rowText.includes('開（休）市日期表');
            if (annualTitleRow || rowText.length === 0) continue;
            throw new Error('TPEx official special-date row schema changed');
        }
        const malformedUnclosedDescription =
            cells.length === 3 &&
            CLOSED_TEXT_PATTERN.test(rowText) &&
            !/\d{1,2}月\d{1,2}日/.test(cells[0]);
        const rowspannedHolidayName =
            cells.length === 3 && /\d{1,2}月\d{1,2}日/.test(cells[0]);
        const description = malformedUnclosedDescription ? rowText : cells.at(-1);
        const dateCell = malformedUnclosedDescription
            ? cells[1]
            : rowspannedHolidayName
              ? cells[0]
              : cells.at(-3);
        const name = malformedUnclosedDescription
            ? cells[0]
            : rowspannedHolidayName
              ? ''
              : cells.length >= 4
              ? cells.at(-4)
              : '';
        if (name.includes('最後交易日')) {
            // The official page combines stock, bond and international-bond
            // systems. Only the stock-system row defines Common-stock closure;
            // its row date is explicitly the final trading day, while the
            // following dates named in the description are the no-trading days.
            if (!name.includes('股票交易系統')) continue;
            if (!/市場無交易|停止交易|休市/.test(description)) {
                throw new Error(
                    'TPEx stock final-trading row closure semantics changed',
                );
            }
        }
        if (name.includes('開始交易日')) continue;
        const closureDateText = name.includes('最後交易日')
            ? description
            : dateCell;
        let closureDateCount = 0;
        for (const match of closureDateText.matchAll(/(\d{1,2})月(\d{1,2})日/g)) {
            closedDates.add(strictDate(year, Number(match[1]), Number(match[2])));
            closureDateCount += 1;
        }
        if (closureDateCount === 0 && /\d/.test(rowText)) {
            throw new Error('TPEx official special-date row is unclassified');
        }
    }
    return Object.freeze({
        market: 'TPEx',
        sourceId: SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SOURCES.OTC.sourceId,
        sourceRevision: sha256(canonicalJson(body)),
        title: titleText,
        year,
        closedDates: Object.freeze([...closedDates].sort()),
    });
}

export function buildOfficialMarketCalendarSnapshot({ twse, tpex, fetchedAtEpochMs }) {
    const fetchedAt = safeEpoch(fetchedAtEpochMs, 'fetchedAtEpochMs');
    if (twse.year !== tpex.year || twse.market !== 'TWSE' || tpex.market !== 'TPEx') {
        throw new Error('official market calendars conflict');
    }
    const year = safeYear(twse.year);
    const days = Object.freeze(
        datesInYear(year).map((tradeDate) =>
            Object.freeze({
                tradeDate,
                TSE:
                    weekend(tradeDate) || twse.closedDates.includes(tradeDate)
                        ? 'closed'
                        : 'scheduled_trading',
                OTC:
                    weekend(tradeDate) || tpex.closedDates.includes(tradeDate)
                        ? 'closed'
                        : 'scheduled_trading',
            }),
        ),
    );
    const marketStateConflict = days.find((day) => day.TSE !== day.OTC);
    if (marketStateConflict) {
        throw new Error(
            `official market calendars conflict on ${marketStateConflict.tradeDate}`,
        );
    }
    const version = sha256(
        canonicalJson([
            SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SCHEMA_VERSION,
            year,
            twse.sourceRevision,
            tpex.sourceRevision,
        ]),
    );
    return Object.freeze({
        schemaVersion: SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SCHEMA_VERSION,
        calendarVersion: version,
        coverageStart: `${year}-01-01`,
        coverageEnd: `${year}-12-31`,
        fetchedAtEpochMs: fetchedAt,
        validUntilEpochMs: fetchedAt + SMART_ORDER_OFFICIAL_MARKET_CALENDAR_TTL_MS,
        sourceRevisions: Object.freeze({
            TSE: twse.sourceRevision,
            OTC: tpex.sourceRevision,
        }),
        days,
    });
}

function observationSnapshot(value) {
    const record = plainRecord(value, 'exchange-time observation');
    for (const key of ['contractKey', 'exchangeTimeMs', 'receiveTimeMs', 'tradeDate']) {
        if (!Object.hasOwn(record, key)) {
            throw new TypeError(`exchange-time observation.${key} is missing`);
        }
    }
    const contract = CONTRACT_PATTERN.exec(record.contractKey);
    if (
        !contract ||
        !DATE_PATTERN.test(record.tradeDate) ||
        !Number.isSafeInteger(record.exchangeTimeMs) ||
        !Number.isSafeInteger(record.receiveTimeMs)
    ) {
        throw new TypeError('exchange-time observation is invalid');
    }
    return Object.freeze({
        exchange: contract[1],
        exchangeTimeMs: record.exchangeTimeMs,
        receiveTimeMs: record.receiveTimeMs,
        tradeDate: record.tradeDate,
    });
}

export function evaluateOfficialMarketCalendarObservation({ snapshot, observation, nowEpochMs }) {
    const now = safeEpoch(nowEpochMs, 'nowEpochMs');
    if (!snapshot || now > snapshot.validUntilEpochMs || now < snapshot.fetchedAtEpochMs) {
        return Object.freeze({ allowed: false, reason: 'calendar_stale_or_unavailable' });
    }
    let observed;
    try {
        observed = observationSnapshot(observation);
    } catch {
        return Object.freeze({ allowed: false, reason: 'exchange_time_invalid' });
    }
    const local = taipeiParts(now);
    const exchange = taipeiParts(observed.exchangeTimeMs);
    if (
        exchange.tradeDate !== observed.tradeDate ||
        local.tradeDate !== observed.tradeDate ||
        Math.abs(observed.receiveTimeMs - observed.exchangeTimeMs) >
            SMART_ORDER_EXCHANGE_TIME_MAX_SKEW_MS ||
        Math.abs(now - observed.exchangeTimeMs) > SMART_ORDER_EXCHANGE_TIME_MAX_SKEW_MS ||
        observed.receiveTimeMs > now ||
        now - observed.receiveTimeMs > SMART_ORDER_EXCHANGE_TIME_EVIDENCE_TTL_MS
    ) {
        return Object.freeze({ allowed: false, reason: 'trusted_exchange_time_skew' });
    }
    const day = snapshot.days.find((candidate) => candidate.tradeDate === observed.tradeDate);
    if (!day) {
        return Object.freeze({ allowed: false, reason: 'unknown_trade_date' });
    }
    if (day[observed.exchange] !== 'scheduled_trading') {
        return Object.freeze({ allowed: false, reason: 'official_market_closed' });
    }
    const sessionMilliseconds =
        (exchange.hour * 3_600 + exchange.minute * 60 + exchange.second) * 1_000 +
        (observed.exchangeTimeMs % 1_000);
    const sessionOpenMilliseconds = 9 * 3_600 * 1_000;
    const sessionCloseMilliseconds = (13 * 3_600 + 30 * 60) * 1_000;
    if (
        sessionMilliseconds < sessionOpenMilliseconds ||
        sessionMilliseconds >= sessionCloseMilliseconds
    ) {
        return Object.freeze({ allowed: false, reason: 'business_session_closed' });
    }
    const sessionCloseEpochMs =
        observed.exchangeTimeMs - sessionMilliseconds + sessionCloseMilliseconds;
    const validUntilEpochMs = Math.min(
        observed.exchangeTimeMs + SMART_ORDER_EXCHANGE_TIME_MAX_SKEW_MS,
        observed.receiveTimeMs + SMART_ORDER_EXCHANGE_TIME_EVIDENCE_TTL_MS,
        sessionCloseEpochMs,
    );
    if (validUntilEpochMs <= now) {
        return Object.freeze({ allowed: false, reason: 'business_session_closed' });
    }
    return Object.freeze({
        allowed: true,
        reason: null,
        calendarVersion: snapshot.calendarVersion,
        exchange: observed.exchange,
        tradeDate: observed.tradeDate,
        exchangeTimeMs: observed.exchangeTimeMs,
        receiveTimeMs: observed.receiveTimeMs,
        validUntilEpochMs,
        evidenceSha256: sha256(
            canonicalJson([
                SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SCHEMA_VERSION,
                snapshot.calendarVersion,
                observed.exchange,
                observed.tradeDate,
                observed.exchangeTimeMs,
                observed.receiveTimeMs,
            ]),
        ),
    });
}

export function createOfficialMarketCalendarAuthorityCore({ fetchImpl, nowEpochMs }) {
    if (typeof fetchImpl !== 'function' || typeof nowEpochMs !== 'function') {
        throw new TypeError('official calendar authority adapters are invalid');
    }
    let snapshot = null;
    const lastExchangeEvidenceByMarket = new Map();
    let blocker = 'official_calendar_not_loaded';
    let closed = false;
    let refreshPromise;

    async function refresh() {
        if (closed) throw new Error('official calendar authority is closed');
        if (refreshPromise) return refreshPromise;
        refreshPromise = (async () => {
            const fetchedAt = safeEpoch(nowEpochMs(), 'nowEpochMs');
            const year = taipeiParts(fetchedAt).tradeDate.slice(0, 4);
            const numericYear = Number(year);
            const [twseResponse, tpexResponse] = await Promise.all([
                fetchImpl(SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SOURCES.TSE.annualUrl(numericYear), {
                    cache: 'no-store',
                    headers: { accept: 'application/json' },
                    redirect: 'error',
                }),
                fetchImpl(SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SOURCES.OTC.annualUrl(numericYear), {
                    cache: 'no-store',
                    headers: { accept: 'application/json' },
                    redirect: 'error',
                }),
            ]);
            if (
                twseResponse?.ok !== true ||
                tpexResponse?.ok !== true ||
                twseResponse.status !== 200 ||
                tpexResponse.status !== 200
            ) {
                throw new Error('official calendar source request failed');
            }
            const [twsePayload, tpexPayload] = await Promise.all([
                twseResponse.json(),
                tpexResponse.json(),
            ]);
            const next = buildOfficialMarketCalendarSnapshot({
                twse: parseTwseOfficialCalendar(twsePayload, numericYear),
                tpex: parseTpexOfficialCalendar(tpexPayload, numericYear),
                fetchedAtEpochMs: fetchedAt,
            });
            if (closed) throw new Error('official calendar authority closed during refresh');
            snapshot = next;
            lastExchangeEvidenceByMarket.clear();
            blocker = 'trusted_exchange_time_missing';
            return status();
        })()
            .catch((error) => {
                snapshot = null;
                lastExchangeEvidenceByMarket.clear();
                blocker = 'official_calendar_refresh_failed';
                throw error;
            })
            .finally(() => {
                refreshPromise = undefined;
            });
        return refreshPromise;
    }

    function status() {
        const now = safeEpoch(nowEpochMs(), 'nowEpochMs');
        const calendarCurrent = Boolean(
            !closed &&
                snapshot &&
                now >= snapshot.fetchedAtEpochMs &&
                now <= snapshot.validUntilEpochMs,
        );
        const exchangeEvidence = Object.freeze(
            Object.fromEntries(
                ['TSE', 'OTC'].map((exchange) => {
                    const evidence = lastExchangeEvidenceByMarket.get(exchange);
                    const current = Boolean(
                        calendarCurrent &&
                            evidence &&
                            now < evidence.validUntilEpochMs &&
                            now >= evidence.receiveTimeMs &&
                            Math.abs(now - evidence.exchangeTimeMs) <=
                                SMART_ORDER_EXCHANGE_TIME_MAX_SKEW_MS &&
                            now - evidence.receiveTimeMs <=
                                SMART_ORDER_EXCHANGE_TIME_EVIDENCE_TTL_MS,
                    );
                    return [
                        exchange,
                        Object.freeze({
                            current,
                            tradeDate: current ? evidence.tradeDate : null,
                            validUntilEpochMs: current
                                ? evidence.validUntilEpochMs
                                : null,
                        }),
                    ];
                }),
            ),
        );
        const exchangeTimeCurrent =
            exchangeEvidence.TSE.current || exchangeEvidence.OTC.current;
        return Object.freeze({
            schemaVersion: SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SCHEMA_VERSION,
            state: closed
                ? 'closed_fail_closed'
                : !calendarCurrent
                  ? 'calendar_unavailable_fail_closed'
                  : exchangeTimeCurrent
                    ? 'current_verified'
                    : 'exchange_time_unavailable_fail_closed',
            blocker: closed
                ? 'calendar_authority_closed'
                : calendarCurrent
                  ? exchangeTimeCurrent
                      ? null
                      : 'trusted_exchange_time_missing_or_stale'
                  : blocker,
            calendarCurrent,
            exchangeTimeCurrent,
            activationReady: calendarCurrent && exchangeTimeCurrent,
            exchangeEvidence,
            calendarVersion: calendarCurrent ? snapshot.calendarVersion : null,
            coverageStart: calendarCurrent ? snapshot.coverageStart : null,
            coverageEnd: calendarCurrent ? snapshot.coverageEnd : null,
            refreshIntervalMs: SMART_ORDER_OFFICIAL_MARKET_CALENDAR_REFRESH_MS,
            maximumTrustedSkewMs: SMART_ORDER_EXCHANGE_TIME_MAX_SKEW_MS,
            emergencyClosurePolicy: 'fresh_exchange_session_required',
            brokerWriteAuthority: false,
        });
    }

    function admitObservation(observation) {
        if (closed) throw new Error('official calendar authority is closed');
        const result = evaluateOfficialMarketCalendarObservation({
            snapshot,
            observation,
            nowEpochMs: safeEpoch(nowEpochMs(), 'nowEpochMs'),
        });
        if (result.allowed !== true) {
            lastExchangeEvidenceByMarket.clear();
            blocker = result.reason;
            const error = new Error(`smart-order activation blocked: ${result.reason}`);
            error.name = 'OfficialMarketCalendarBlockedError';
            error.reason = result.reason;
            throw error;
        }
        lastExchangeEvidenceByMarket.set(result.exchange, result);
        blocker = null;
        return result;
    }

    function assertDispatchEnvelope(envelope) {
        if (closed) throw new Error('official calendar authority is closed');
        let exchange;
        try {
            const record = plainRecord(envelope, 'broker dispatch envelope');
            const contract = CONTRACT_PATTERN.exec(record.contractKey);
            if (!contract) throw new Error('contract key is invalid');
            exchange = contract[1];
        } catch {
            const error = new Error(
                'smart-order broker dispatch blocked: target market is unavailable',
            );
            error.name = 'OfficialMarketCalendarBlockedError';
            error.reason = 'dispatch_market_unavailable';
            throw error;
        }
        const current = status().exchangeEvidence[exchange].current === true;
        if (!current) {
            const error = new Error(
                `smart-order broker dispatch blocked: ${exchange} exchange time is stale`,
            );
            error.name = 'OfficialMarketCalendarBlockedError';
            error.reason = 'dispatch_exchange_time_stale';
            throw error;
        }
        return Object.freeze({
            allowed: true,
            exchange,
            brokerWriteAuthority: false,
        });
    }

    return Object.freeze({
        schemaVersion: SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SCHEMA_VERSION,
        status,
        refresh,
        admitObservation,
        assertDispatchEnvelope,
        close() {
            closed = true;
            snapshot = null;
            lastExchangeEvidenceByMarket.clear();
            blocker = 'calendar_authority_closed';
        },
    });
}
