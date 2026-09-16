import { baselineCalendar, verifyDirect160HistoricalSymbol, createDirect160BaselineSet } from '../direct-160-baseline.mjs';
import { expectedTaiwanRegularSessionMinutes } from '../historical-kbar-repair.mjs';

export function fixtureBaseline(manifest) {
    const twse = { stat: 'ok', queryYear: 2026, fields: ['日期', '名稱', '說明'],
        data: [['2026-01-01', '中華民國開國紀念日', '依規定放假1日。']] };
    const tpex = { data: { html: '<table><tr><td>中華民國115年有價證券櫃檯買賣市場開（休）市日期表</td></tr></table><table><tr><td>中華民國開國紀念日</td><td>1月1日</td><td>四</td><td>依規定放假1日。</td></tr></table>' } };
    const calendar = baselineCalendar(twse, tpex, '2026-09-11', '2026-09-14', Date.parse('2026-09-11T14:00:00+08:00'));
    const manifests = manifest.cohort.map(entry => verifyDirect160HistoricalSymbol(symbolFixture(entry, manifest.manifestHash, calendar)));
    return createDirect160BaselineSet({ manifest, calendar, manifests, createdAt: '2026-09-11T14:05:00+08:00' });
}

export function symbolFixture(entry, cohortHash, calendar) {
    const minutes = expectedTaiwanRegularSessionMinutes();
    const data = { datetime: minutes.map(m => `2026-09-11T${m}:00`),
        Open: minutes.map(() => 10), High: minutes.map(() => 10), Low: minutes.map(() => 10),
        Close: minutes.map(() => 10), Volume: minutes.map(() => 2), Amount: minutes.map(() => 20000) };
    const ticks = { datetime: minutes.map((m,i) => i === 269 ? '2026-09-11T13:30:00' :
        `2026-09-11T${String(Math.floor((540+i)/60)).padStart(2,'0')}:${String((540+i)%60).padStart(2,'0')}:30`),
        close: minutes.map(() => 10), volume: minutes.map(() => 2) };
    return { entry, cohortHash, calendar, contract: { ...entry.contractIdentity, unit: 1000,
        trading_suspended: false, update_date: '2026-09-11', reference: 10 },
        first: { data, fetchedAt: '2026-09-11T14:01:00+08:00' },
        second: { data: structuredClone(data), fetchedAt: '2026-09-11T14:02:00+08:00' }, ticks,
        sourceVersion: 'fixture-only/1', now: '2026-09-11T14:03:00+08:00' };
}
