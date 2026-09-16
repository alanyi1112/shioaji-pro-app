import { hashDirect160 } from './direct-160-storage.mjs';
import { computeHistoricalKbarPayloadHash, HISTORICAL_KBAR_BASELINE_CANDIDATE_SCHEMA,
    validateAndBuildHistoricalKbarBaseline, isHistoricalKbarBaselineManifest,
    expectedTaiwanRegularSessionMinutes } from './historical-kbar-repair.mjs';
import { parseTwseOfficialCalendar, parseTpexOfficialCalendar, buildOfficialMarketCalendarSnapshot }
    from '../smart-order-runtime/official-market-calendar-core.mjs';

export function baselineCalendar(twse, tpex, previousTradeDate, targetTradeDate, fetchedAtEpochMs) {
    const year = Number(previousTradeDate.slice(0, 4));
    const snapshot = buildOfficialMarketCalendarSnapshot({ twse: parseTwseOfficialCalendar(twse, year),
        tpex: parseTpexOfficialCalendar(tpex, year), fetchedAtEpochMs });
    const dates = snapshot.days.filter(d => d.TSE === 'scheduled_trading' && d.OTC === 'scheduled_trading').map(d => d.tradeDate);
    if (!dates.includes(previousTradeDate) || dates[dates.indexOf(previousTradeDate) + 1] !== targetTradeDate) {
        throw new Error('baseline_not_previous_applicable_trade_date');
    }
    return { twse, tpex, previousTradeDate, targetTradeDate, fetchedAtEpochMs,
        sourceVersion: snapshot.calendarVersion };
}

// 只接受已落檔的正式歷史資料；不得產生網路、訂閱或交易操作。
export function verifyDirect160HistoricalSymbol({ entry, cohortHash, contract, first, second, ticks, calendar, sourceVersion, now }) {
    const symbol = entry.canonicalSymbol;
    const tradeDate = calendar.previousTradeDate;
    if (contract.code !== entry.contractIdentity.code || contract.exchange !== entry.contractIdentity.exchange ||
        contract.security_type !== 'STK' || contract.region !== 'TW' || contract.unit !== 1000 ||
        contract.trading_suspended !== false || contract.update_date !== tradeDate) {
        throw new Error('fresh_contract_identity_or_status_unverified');
    }
    const times = ticks.datetime;
    if (!Array.isArray(times) || !times.length || Object.values(ticks).some(v => !Array.isArray(v) || v.length !== times.length)) {
        throw new Error('invalid_ticks_structure');
    }
    const tickVolumes = new Map(expectedTaiwanRegularSessionMinutes().map(m => [m, 0]));
    let prior = '';
    for (let i = 0; i < times.length; i++) {
        const time = times[i];
        if (typeof time !== 'string' || !time.startsWith(`${tradeDate}T`) || time < prior ||
            !Number.isSafeInteger(ticks.volume[i]) || ticks.volume[i] < 0 ||
            !Number.isFinite(ticks.close[i]) || ticks.close[i] < 0) throw new Error('invalid_tick_time_or_volume');
        prior = time;
        const minute = time.slice(11, 16);
        if (minute < '09:00' || minute > '13:33') throw new Error('tick_outside_regular_session');
        const count = Number(minute.slice(0, 2)) * 60 + Number(minute.slice(3)) + 1;
        const key = minute >= '13:30' ? '13:30' : `${String(Math.floor(count / 60)).padStart(2, '0')}:${String(count % 60).padStart(2, '0')}`;
        if (!tickVolumes.has(key)) throw new Error('unsupported_tick_minute');
        tickVolumes.set(key, tickVolumes.get(key) + ticks.volume[i]);
    }
    const make = input => {
        const candidate = { schemaVersion: HISTORICAL_KBAR_BASELINE_CANDIDATE_SCHEMA,
            symbol, exchange: contract.exchange, securityType: 'STK', tradeDate, timeZone: 'Asia/Taipei',
            source: 'shioaji-http-historical-kbars', sourceVersion, fetchedAt: input.fetchedAt,
            sourceUnit: 'common_lot', canonicalUnit: 'common_lot', volumeSemantics: 'minute_delta',
            closeEncoding: input.data.datetime.some(t => t.slice(11, 16) === '13:33') ? 'delayed_13_33' : 'normal_13_30',
            arrays: { ...input.data, datetime: input.data.datetime.map(t => `${t}+08:00`) },
            knownZeroMinutes: [], previousClose: contract.reference };
        return { ...candidate, payloadHash: computeHistoricalKbarPayloadHash(candidate) };
    };
    const authority = { officialTradingDay: true, identityVerified: true, instrumentStatus: 'normal',
        symbol, exchange: contract.exchange, securityType: 'STK', tradeDate, timeZone: 'Asia/Taipei',
        targetTradeDate: calendar.targetTradeDate, previousApplicableTradeDate: tradeDate,
        calendarVerified: true, calendarSource: 'TWSE and TPEx official annual calendars',
        calendarSourceVersion: calendar.sourceVersion };
    const result = validateAndBuildHistoricalKbarBaseline({ authority,
        finalVolumeAuthority: { status: 'verified', sessionScope: 'regular_session', unit: 'common_lot',
            volumeCommonLot: [...tickVolumes.values()].reduce((a,b) => a+b, 0), symbol, exchange: contract.exchange,
            tradeDate, source: 'shioaji-historical-ticks-090000-133400', sourceVersion },
        candidate: make(first), refetchCandidate: make(second), cohortHash: `sha256:${cohortHash}`, now });
    if (!result.ok) throw new Error(result.reasonCodes.join(','));
    let cumulative = 0;
    for (const row of result.manifest.cumulativeSeries) {
        cumulative += tickVolumes.get(row.minuteKey);
        if (cumulative !== row.cumulativeVolume) throw new Error(`tick_kbar_minute_mismatch:${row.minuteKey}`);
    }
    return result.manifest;
}

export function createDirect160BaselineSet({ manifest, calendar, manifests, createdAt }) {
    const body = { schemaVersion: 'intraday-monitor-direct-160-baseline-set/1',
        manifestHash: manifest.manifestHash, calendar, manifests, createdAt,
        baselineUsable: true, liveCaptureAcceptance: false };
    const value = { ...body, baselineHash: hashDirect160(body, 'bundle') };
    if (!validateDirect160BaselineSet(value, manifest, calendar.targetTradeDate)) throw new Error('invalid_direct_160_baseline_set');
    return value;
}

export function validateDirect160BaselineSet(value, manifest, targetTradeDate) {
    try {
        const { baselineHash, ...body } = value;
        const c = baselineCalendar(value.calendar.twse, value.calendar.tpex, value.calendar.previousTradeDate,
            targetTradeDate, value.calendar.fetchedAtEpochMs);
        return value.schemaVersion === 'intraday-monitor-direct-160-baseline-set/1' &&
            baselineHash === hashDirect160(body, 'bundle') && value.manifestHash === manifest.manifestHash &&
            c.targetTradeDate === value.calendar.targetTradeDate && c.sourceVersion === value.calendar.sourceVersion &&
            value.baselineUsable === true && value.liveCaptureAcceptance === false &&
            manifest.stage === 160 && value.manifests.length === 160 && manifest.cohort.length === 160 &&
            new Set(value.manifests.map(m => m.symbol)).size === 160 &&
            value.manifests.every((m, i) => isHistoricalKbarBaselineManifest(m) &&
                m.symbol === manifest.cohort[i].canonicalSymbol && m.exchange === manifest.cohort[i].contractIdentity.exchange &&
                m.cohortHash === `sha256:${manifest.manifestHash}` && m.tradeDate === c.previousTradeDate &&
                m.targetTradeDate === targetTradeDate && m.calendarSourceVersion === c.sourceVersion &&
                m.finalVolumeReconciliation?.matched === true && m.cumulativeSeries.every((r,j,a) => j === 0 || r.cumulativeVolume >= a[j-1].cumulativeVolume));
    } catch { return false; }
}
