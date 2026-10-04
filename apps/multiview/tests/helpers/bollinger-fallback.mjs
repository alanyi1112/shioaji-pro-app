/** 全部是假設契約與行情的隔離 fixture，不是正式 review、實測用量或實盤證據。 */
import { readFile } from 'node:fs/promises';
import { SqliteD1, applyDrizzleSql } from './sqlite-d1.mjs';
import { migrateCriteriaV7ToV8 } from '../../../../src/lib/stock-screener-v8.ts';
import { DEFAULT_CRITERIA_V7 } from '../../../../src/lib/stock-screener-v7.ts';
import { bollingerUniverseHash, bollingerSourceUrl } from '../../../../src/lib/stock-screener-bollinger-source.ts';
import { saveSourceReview } from '../../../../scripts/stock-screener-source-selection.mjs';
import { DAILY_QUOTES_URL, DAILY_QUOTES_MAPPING, loadDailyQuotesBatch } from '../../../../scripts/stock-screener-shioaji-daily-quotes.mjs';
import { prepareSelectedBollingerHistory } from '../../../../scripts/stock-screener-provider-prepare.mjs';
import { saveBollingerDailyProfile } from '../../worker/stock-screener-v8-repository.ts';

const migrations = await Promise.all(['0027_pale_randall_flagg','0035_screener_bollinger_history','0036_screener_bollinger_publication',
    '0037_screener_daily_quotes_cache','0038_screener_source_selection','0039_broker_bandwidth_reservations']
    .map(f => readFile(new URL(`../../drizzle/${f}.sql`, import.meta.url), 'utf8')));
export async function fallbackFixture() {
    const db = new SqliteD1(); migrations.forEach(sql => applyDrizzleSql(db, sql));
    const sessions = Array.from({ length: 160 }, (_, i) => new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10));
    let time = Date.parse('2026-10-03T07:00:00Z'), calls = 0, officialCalls = 0;
    const now = () => new Date(time);
    const universe = [{ symbol: '2449.TW', code: '2449', name: 'fixture-TSE', market: 'TWSE', listingDate: null },
        { symbol: '6488.TWO', code: '6488', name: 'fixture-OTC', market: 'TPEx', listingDate: null }];
    const review = { status: 'verified', provider: 'shioaji-daily-quotes', endpoint: DAILY_QUOTES_URL,
        mappingVersion: DAILY_QUOTES_MAPPING, volumeUnit: 'shares', turnoverUnit: 'TWD', priceBasis: 'unadjusted',
        tradeScope: 'official-daily-compatible', usage: 'local-historical-screener', localDisplayVerified: true,
        markets: ['TWSE','TPEx'], evidenceHash: 'a'.repeat(64), reviewedAt: '2026-10-03T06:00:00Z', validThrough: '2026-10-05T06:00:00Z', minimumRows: 2 };
    const backup = await saveSourceReview(db, { provider: 'shioaji-daily-quotes', review }, now());
    const calendar = { status: 'verified', authorityHash: 'b'.repeat(64), commonSessions: sessions, validThrough: '2026-10-05T06:00:00Z' };
    const gate = { calendarStatus: 'verified', authorityHash: calendar.authorityHash, commonSessions: sessions,
        validThrough: calendar.validThrough, universeStatus: 'verified' };
    const criteria = migrateCriteriaV7ToV8(DEFAULT_CRITERIA_V7);
    for (const v of Object.values(criteria)) if (v && typeof v === 'object' && 'enabled' in v) v.enabled = false;
    criteria.bollSqueezeStages.enabled = true;
    await saveBollingerDailyProfile(db, { expectedRevision: 0, enabled: true, criteria }, now());
    const payload = date => {
        const i = sessions.indexOf(date), price = 100+i/10;
        return { Date: [date,date], Code: ['2449','6488'], Open: [price,price+400], High: [price+2,price+402], Low: [price-1,price+399],
            Close: [price+1,price+401], Volume: [1000000,1000000], Transaction: [100,100], Amount: [120000000,520000000] };
    };
    const response = (date, p = payload(date)) => ({ sourceUrl: DAILY_QUOTES_URL, status: 200, fetchedAt: now().toISOString(), text: JSON.stringify(p) });
    const safety = async () => ({ simulation: true, businessSessionEstablished: true, generation: 'fixture-generation', observedAt: now().toISOString() });
    const admission = { reserve: async () => ({ allowed: true, reservationId: 'fixture-reservation' }), settle: async () => {} };
    const fetchDailyQuotes = async date => { calls++; return response(date); };
    const options = { db, calendar, through: sessions.at(-1), criteria: criteria.bollSqueezeStages, profileRevision: '1', universeRevision: 'fixture-u',
        universe, universeEvidence: { status: 'verified', ordinary: true, hash: await bollingerUniverseHash(universe) },
        reviewIds: { 'shioaji-daily-quotes': backup.id }, now, trigger: 'watcher', safety, admission, fetchDailyQuotes,
        fetchOfficial: async () => { officialCalls++; throw new Error('source_connection_reset'); } };
    const addOfficial = async market => {
        const provider = market === 'TWSE' ? 'official-twse' : 'official-tpex', url = new URL(bollingerSourceUrl(market, options.through));
        const r = { ...review, market, evidenceHash: (market === 'TWSE' ? 'c' : 'd').repeat(64), mappingVersion: 'official-daily-ohlcv-turnover-v1',
            endpoint: url.origin + url.pathname };
        delete r.provider; delete r.markets;
        const saved = await saveSourceReview(db, { provider, review: r }, now()); options.reviewIds[provider] = saved.id; return saved;
    };
    const officialResponse = t => { const p = payload(t.sessionDate), i = t.market === 'TWSE' ? 0 : 1;
        const table = { fields: i === 0 ? ['證券代號','成交股數','成交金額','開盤價','最高價','最低價','收盤價']
            : ['代號','成交股數','成交金額(元)','開盤','最高','最低','收盤'],
            data: [[p.Code[i],String(p.Volume[i]),String(p.Amount[i]),String(p.Open[i]),String(p.High[i]),String(p.Low[i]),String(p.Close[i])],
                ['9999','1','100','100','101','99','100']] };
        return { status: 200, sourceUrl: bollingerSourceUrl(t.market,t.sessionDate), fetchedAt: now().toISOString(),
            text: JSON.stringify({ stat: 'OK', date: t.sessionDate.replaceAll('-',''), tables: i===0 ? [table] : [table,{ ...table,data: [] }] }) }; };
    const seed = async () => {
        for (const sessionDate of sessions) await loadDailyQuotesBatch({ db, sessionDate, review, gate, now, safety, admission,
            fetchReport: async date => response(date) });
        return prepareSelectedBollingerHistory(options);
    };
    return { db, options, sessions, review, gate, criteria, now, payload, response, backup, seed, addOfficial, officialResponse,
        calls: () => calls, officialCalls: () => officialCalls, advance: ms => { time += ms; } };
}
