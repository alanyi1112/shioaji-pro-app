import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
    SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SOURCES,
    buildOfficialMarketCalendarSnapshot,
    parseTpexOfficialCalendar,
    parseTwseOfficialCalendar,
} from '../smart-order-runtime/official-market-calendar-core.mjs';
import { hashDirect160 } from './direct-160-storage.mjs';
import { readDailyCalendarCache } from './daily-calendar-cache.mjs';
import { specialMarketClosureDecision, assertNoSpecialMarketClosure, readSpecialMarketClosures, defaultClosureRoot } from './special-market-closures.mjs';
import {createMarketCalendar,marketCalendarDay,adjacentMarketDate} from '../../src/lib/market-calendar.ts';

export const INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA =
    'intraday-monitor-trading-calendar-authority/1';
const CALENDAR_FETCH_TIMEOUT_MS = 4_000;
const CALENDAR_FETCH_ATTEMPTS = 3;
const CALENDAR_RETRY_DELAY_MS = 250;
export const TWSE_OFFICIAL_OPENAPI_URL =
    'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule';
const PREMARKET_CALENDAR_MAX_AGE_MS = 30 * 86_400_000;
const PASSED_TARGET_CALENDAR_MAX_AGE_MS = 7 * 86_400_000;

export function normalizeTwseOpenApiCalendar(rows, year) {
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 128) {
        throw new Error('TWSE official OpenAPI calendar response is invalid');
    }
    const data = rows.map((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row) ||
            typeof row.Date !== 'string' || !/^\d{7}$/.test(row.Date) ||
            Number(row.Date.slice(0, 3)) !== year - 1911 ||
            typeof row.Name !== 'string' || typeof row.Description !== 'string') {
            throw new Error('TWSE official OpenAPI calendar row is invalid');
        }
        const date = `${year}-${row.Date.slice(3, 5)}-${row.Date.slice(5, 7)}`;
        if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
            throw new Error('TWSE official OpenAPI calendar date is invalid');
        }
        return [date, row.Name, row.Description];
    });
    if (new Set(data.map((row) => row[0])).size !== data.length) {
        throw new Error('TWSE official OpenAPI calendar has duplicate dates');
    }
    return { stat: 'ok', queryYear: year, fields: ['日期', '名稱', '說明'], data,
        title: `${year} TWSE official OpenAPI holiday schedule` };
}

function taipeiTradeDate(nowEpochMs) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(nowEpochMs));
}

function scheduled(day) {
    return day?.TSE === 'scheduled_trading' && day?.OTC === 'scheduled_trading';
}

export function selectIntradayMonitorTradingDay({
    tradeDate,
    snapshots,
    observedAt,
} = {}) {
    const days = snapshots.flatMap((snapshot) => snapshot.days)
        .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
    const today = days.find((day) => day.tradeDate === tradeDate);
    if (!today) throw new Error('calendar_authority_unavailable');
    const previous = days.filter((day) => day.tradeDate < tradeDate && scheduled(day)).at(-1);
    if (!previous) throw new Error('previous_trade_date_unavailable');
    const versions = snapshots.map((snapshot) => snapshot.calendarVersion).sort();
    return Object.freeze({
        schemaVersion: INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA,
        current: true,
        tradeDate,
        previousTradeDate: previous.tradeDate,
        isTradingDate: scheduled(today),
        source: 'TWSE and TPEx official annual calendars',
        sourceVersions: Object.freeze(versions),
        observedAt,
        brokerWriteAuthority: false,
        productionAuthority: false,
    });
}

// 執行中的本機消費者必須走共用核心。原 selector 保留給舊證據驗證，不能授權新版執行。
export function selectSharedMonitorTradingDay({tradeDate,snapshots,observedAt,root=defaultClosureRoot()}={}){
    const now=new Date(observedAt),state=readSpecialMarketClosures(root,{now});
    const annual={verified:true,calendarVersion:snapshots.map(s=>s.calendarVersion).sort().join('+'),
        fetchedAtEpochMs:Math.max(...snapshots.map(s=>s.fetchedAtEpochMs)),
        validUntilEpochMs:Math.min(...snapshots.map(s=>s.validUntilEpochMs)),
        days:snapshots.flatMap(s=>s.days)};
    const calendar=createMarketCalendar(annual,state,now);
    const days=['TSE','OTC'].map(m=>marketCalendarDay(calendar,tradeDate,m,now));
    if(days.some(d=>d.state==='unknown'))throw Error('shared_calendar_unconfirmed');
    const live=specialMarketClosureDecision({root,dates:[tradeDate],now});
    if(!live.allowed&&live.reason!=='special_market_closure')throw Error(live.reason);
    const isTradingDate=days.every(d=>d.state==='scheduled');
    const previous=adjacentMarketDate(calendar,tradeDate,'previous',undefined,now);
    if(!previous.date&&isTradingDate)throw Error('previous_trade_date_unavailable');
    return Object.freeze({schemaVersion:INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA,current:true,tradeDate,
        previousTradeDate:previous.date,isTradingDate,source:'shared local market calendar',
        sourceVersions:Object.freeze([...snapshots.map(s=>s.calendarVersion).sort(),`manual:${state.revision}:${state.hash??'none'}`]),
        calendarVersion:calendar.version,observedAt,brokerWriteAuthority:false,productionAuthority:false});
}

// 盤前只讀取前一交易日盤後已驗證的雙市場日曆；不在 08:20–08:50 連官方網站。
export async function resolveIntradayMonitorPremarketTradingDay({
    now = new Date(),
    root = process.env.REALTIME_STOCK_APP_SUPPORT ??
        path.join(os.homedir(), 'Library', 'Application Support', 'RealTimeStock'),
} = {}) {
    if (!(now instanceof Date) || !Number.isFinite(now.valueOf()) ||
        typeof root !== 'string' || !path.isAbsolute(root)) {
        throw new TypeError('premarket trading calendar input is invalid');
    }
    const tradeDate = taipeiTradeDate(now.valueOf());
    const closure = specialMarketClosureDecision({ root, dates: [tradeDate], now });
    if (!closure.allowed) return Object.freeze({ schemaVersion: INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA,
        current: closure.reason === 'special_market_closure', tradeDate, previousTradeDate: null,
        isTradingDate: closure.reason === 'special_market_closure' ? false : null,
        source: 'local_user', sourceVersions: [], reason: closure.reason, closure,
        observedAt: now.toISOString(), brokerWriteAuthority: false, productionAuthority: false });
    try {
        const daily = await readDailyCalendarCache({ root, now, tradeDate });
        if (daily) {
            const selected = selectSharedMonitorTradingDay({tradeDate, snapshots:[daily.snapshot], observedAt:now.toISOString(),root});
            assertNoSpecialMarketClosure({root,dates:[tradeDate,selected.previousTradeDate],now});
        }
        if (daily) return Object.freeze({ ...selectSharedMonitorTradingDay({
            tradeDate, snapshots: [daily.snapshot], observedAt: now.toISOString(),root }),
            authorityKind: 'verified_daily_official_calendar_cache',
            calendarFetchedAt: daily.value.fetchedAt, calendarTrigger: daily.value.trigger,
            verifiedArtifactPath: daily.file });
        const directory = path.join(root, 'intraday-baselines');
        const names = await readdir(directory);
        const candidates = names.map((name) => {
            const match = /^(\d{4}-\d{2}-\d{2})-for-(\d{4}-\d{2}-\d{2})-verified$/.exec(name);
            return match && match[1] < tradeDate ? { name, previousTradeDate: match[1],
                targetTradeDate: match[2] } : null;
        }).filter(Boolean).sort((left, right) =>
            right.previousTradeDate.localeCompare(left.previousTradeDate));
        if (!candidates.length) throw new Error('verified_calendar_snapshot_missing');
        const candidate = candidates[0];
        assertNoSpecialMarketClosure({root,dates:[tradeDate,candidate.previousTradeDate,candidate.targetTradeDate],now});
        const file = path.join(directory, candidate.name, 'baseline-set.json');
        const baseline = JSON.parse(await readFile(file, 'utf8'));
        const { baselineHash, ...body } = baseline;
        const calendar = baseline.calendar;
        if (baseline.schemaVersion !== 'intraday-monitor-direct-160-baseline-set/1' ||
            baseline.baselineUsable !== true || baseline.manifests?.length !== 160 ||
            baselineHash !== hashDirect160(body, 'bundle') ||
            calendar?.previousTradeDate !== candidate.previousTradeDate ||
            calendar.targetTradeDate !== candidate.targetTradeDate ||
            !Number.isSafeInteger(calendar.fetchedAtEpochMs) ||
            calendar.fetchedAtEpochMs > now.valueOf() ||
            now.valueOf() - calendar.fetchedAtEpochMs > PREMARKET_CALENDAR_MAX_AGE_MS ||
            candidate.targetTradeDate < tradeDate &&
                now.valueOf() - calendar.fetchedAtEpochMs > PASSED_TARGET_CALENDAR_MAX_AGE_MS) {
            throw new Error('verified_calendar_snapshot_invalid_or_stale');
        }
        const year = Number(candidate.previousTradeDate.slice(0, 4));
        const snapshot = buildOfficialMarketCalendarSnapshot({
            twse: parseTwseOfficialCalendar(calendar.twse, year),
            tpex: parseTpexOfficialCalendar(calendar.tpex, year),
            fetchedAtEpochMs: calendar.fetchedAtEpochMs,
        });
        if (snapshot.calendarVersion !== calendar.sourceVersion ||
            selectIntradayMonitorTradingDay({ tradeDate: candidate.targetTradeDate,
                snapshots: [snapshot], observedAt: now.toISOString() }).previousTradeDate !==
                candidate.previousTradeDate) {
            throw new Error('verified_calendar_snapshot_identity_mismatch');
        }
        return Object.freeze({ ...selectSharedMonitorTradingDay({ tradeDate,
            snapshots: [snapshot], observedAt: now.toISOString(),root }),
        authorityKind: 'verified_postclose_local_snapshot',
        calendarFetchedAt: new Date(calendar.fetchedAtEpochMs).toISOString(),
        verifiedArtifactPath: file });
    } catch (error) {
        return Object.freeze({
            schemaVersion: INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA,
            current: false, tradeDate, previousTradeDate: null, isTradingDate: null,
            source: 'TWSE and TPEx verified postclose local calendar',
            sourceVersions: Object.freeze([]), observedAt: now.toISOString(),
            reason: String(error?.message ?? 'calendar_authority_unavailable').slice(0, 128),
            brokerWriteAuthority: false, productionAuthority: false,
        });
    }
}

async function fetchSnapshot(year, fetchImpl, nowEpochMs) {
    const controller = new AbortController();
    let timeout;
    try {
        const request = (async () => {
            const options = { cache: 'no-store', headers: { accept: 'application/json' },
                redirect: 'error', signal: controller.signal };
            const [twseCalendar, tpexResponse] = await Promise.all([
                (async () => {
                    try {
                        const response = await fetchImpl(TWSE_OFFICIAL_OPENAPI_URL, options);
                        if (response?.ok && response.status === 200) {
                            return parseTwseOfficialCalendar(
                                normalizeTwseOpenApiCalendar(await response.json(), year), year);
                        }
                    } catch { /* Keep the independently validated official annual endpoint available. */ }
                    const response = await fetchImpl(
                        SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SOURCES.TSE.annualUrl(year), options);
                    if (!response?.ok || response.status !== 200) {
                        throw new Error('calendar_authority_unavailable');
                    }
                    return parseTwseOfficialCalendar(await response.json(), year);
                })(),
                fetchImpl(SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SOURCES.OTC.annualUrl(year), options),
            ]);
            if (!tpexResponse?.ok || tpexResponse.status !== 200) {
                throw new Error('calendar_authority_unavailable');
            }
            const tpexPayload = await tpexResponse.json();
            return buildOfficialMarketCalendarSnapshot({
                twse: twseCalendar,
                tpex: parseTpexOfficialCalendar(tpexPayload, year),
                fetchedAtEpochMs: nowEpochMs,
            });
        })();
        const deadline = new Promise((_, reject) => {
            timeout = setTimeout(() => {
                controller.abort();
                reject(new Error('calendar_fetch_timeout'));
            }, CALENDAR_FETCH_TIMEOUT_MS);
        });
        return await Promise.race([request, deadline]);
    } finally {
        clearTimeout(timeout);
        controller.abort();
    }
}

async function fetchSnapshotWithRetry(year, fetchImpl, nowEpochMs) {
    let lastError;
    for (let attempt = 1; attempt <= CALENDAR_FETCH_ATTEMPTS; attempt++) {
        try { return await fetchSnapshot(year, fetchImpl, nowEpochMs); }
        catch (error) {
            lastError = error;
            if (attempt < CALENDAR_FETCH_ATTEMPTS) {
                await new Promise((resolve) => setTimeout(resolve, CALENDAR_RETRY_DELAY_MS * attempt));
            }
        }
    }
    throw lastError;
}

export async function resolveIntradayMonitorTradingDay({
    now = new Date(),
    fetchImpl = fetch,
    root = defaultClosureRoot(),
} = {}) {
    if (!(now instanceof Date) || !Number.isFinite(now.valueOf()) || typeof fetchImpl !== 'function') {
        throw new TypeError('trading calendar authority input is invalid');
    }
    const tradeDate = taipeiTradeDate(now.valueOf());
    const year = Number(tradeDate.slice(0, 4));
    try {
        assertNoSpecialMarketClosure({root,dates:[tradeDate],now});
        const snapshots = [await fetchSnapshotWithRetry(year, fetchImpl, now.valueOf())];
        if (tradeDate.endsWith('-01-01') ||
            !snapshots[0].days.some((day) => day.tradeDate < tradeDate && scheduled(day))) {
            snapshots.unshift(await fetchSnapshotWithRetry(year - 1, fetchImpl, now.valueOf()));
        }
        return selectSharedMonitorTradingDay({
            tradeDate,
            snapshots,
            observedAt: now.toISOString(),
            root,
        });
    } catch (error) {
        return Object.freeze({
            schemaVersion: INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA,
            current: false,
            tradeDate,
            previousTradeDate: null,
            isTradingDate: null,
            source: 'TWSE and TPEx official annual calendars',
            sourceVersions: Object.freeze([]),
            observedAt: now.toISOString(),
            reason: String(error?.message ?? 'calendar_authority_unavailable')
                .slice(0, 128),
            brokerWriteAuthority: false,
            productionAuthority: false,
        });
    }
}

export async function resolveNextIntradayMonitorTradingDay({
    now = new Date(),
    fetchImpl = fetch,
    root = defaultClosureRoot(),
} = {}) {
    if (!(now instanceof Date) || !Number.isFinite(now.valueOf()) || typeof fetchImpl !== 'function') {
        throw new TypeError('trading calendar authority input is invalid');
    }
    const localDate = taipeiTradeDate(now.valueOf());
    const year = Number(localDate.slice(0, 4));
    try {
        const snapshots = [await fetchSnapshotWithRetry(year, fetchImpl, now.valueOf())];
        const hasFuture = snapshots[0].days.some((day) => day.tradeDate > localDate && scheduled(day));
        if (!hasFuture) snapshots.push(await fetchSnapshotWithRetry(year + 1, fetchImpl, now.valueOf()));
        const state=readSpecialMarketClosures(root,{now});
        const calendar=createMarketCalendar({verified:true,calendarVersion:snapshots.map(s=>s.calendarVersion).sort().join('+'),
            fetchedAtEpochMs:Math.max(...snapshots.map(s=>s.fetchedAtEpochMs)),validUntilEpochMs:Math.min(...snapshots.map(s=>s.validUntilEpochMs)),
            days:snapshots.flatMap(s=>s.days)},state,now);
        const next=adjacentMarketDate(calendar,localDate,'next',undefined,now);
        if(!next.date)throw Error('next_trade_date_unavailable');
        return selectSharedMonitorTradingDay({tradeDate:next.date,snapshots,observedAt:now.toISOString(),root});
    } catch (error) {
        return Object.freeze({
            schemaVersion: INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA,
            current: false,
            tradeDate: null,
            previousTradeDate: null,
            isTradingDate: null,
            source: 'TWSE and TPEx official annual calendars',
            sourceVersions: Object.freeze([]),
            observedAt: now.toISOString(),
            reason: String(error?.message ?? 'calendar_authority_unavailable').slice(0, 128),
            brokerWriteAuthority: false,
            productionAuthority: false,
        });
    }
}
