/** 唯讀來源預檢：只輸出欄位、日期、計數與 hash；不儲存原始市場資料、不派送回補。 */
import { fetchScreenerSource, mergeUniverses, parseDailyVolumes, parseHolderBatch, parseUniverse, SCREENER_SOURCES } from '../apps/multiview/worker/stock-screener-sources.ts';

const sources = [
    ['twseUniverse', SCREENER_SOURCES.TWSE.universe], ['tpexUniverse', SCREENER_SOURCES.TPEx.universe],
    ['twseVolume', SCREENER_SOURCES.TWSE.volume], ['tpexVolume', SCREENER_SOURCES.TPEx.volume],
    ['tdcc', SCREENER_SOURCES.tdcc],
];
const fetched = {};
// At most two public requests at once. No retries during read-only preflight.
for (let index = 0; index < sources.length; index += 2) {
    await Promise.all(sources.slice(index, index + 2).map(async ([key, url]) => {
        try { fetched[key] = await fetchScreenerSource(url); }
        catch (error) {
            console.error(JSON.stringify({ source: key, reason: /^source_\w+$/.test(error.message) ? error.message : 'source_unavailable' }));
            throw error;
        }
    }));
}
const twse = parseUniverse(fetched.twseUniverse.payload, 'TWSE');
const tpex = parseUniverse(fetched.tpexUniverse.payload, 'TPEx');
const universe = mergeUniverses(twse, tpex);
const provenance = (key, source) => ({ source, sourceUrl: sources.find(([name]) => name === key)[1],
    payloadHash: fetched[key].payloadHash, fetchedAt: fetched[key].fetchedAt, normalizationVersion: 'screener-v2' });
const twseVolume = parseDailyVolumes(fetched.twseVolume.payload, 'TWSE', provenance('twseVolume', 'TWSE'));
const tpexVolume = parseDailyVolumes(fetched.tpexVolume.payload, 'TPEx', provenance('tpexVolume', 'TPEx'));
const holder = parseHolderBatch(fetched.tdcc.payload, universe.stocks, provenance('tdcc', 'TDCC'));
const coverage = (market, volumes) => {
    const stocks = universe.stocks.filter((stock) => stock.market === market);
    return { total: stocks.length, dailyPresent: stocks.filter((stock) => volumes.points.has(stock.symbol)).length,
        turnoverPresent: stocks.filter((stock) => volumes.points.get(stock.symbol)?.turnoverNtd != null).length,
        turnoverMissingOrInvalid: stocks.filter((stock) => volumes.points.has(stock.symbol) && volumes.points.get(stock.symbol)?.turnoverNtd == null).length,
        weeklyValid: stocks.filter((stock) => holder.points.has(stock.symbol)).length,
        weeklyInvalid: stocks.filter((stock) => holder.invalid.has(stock.symbol)).length };
};
console.log(JSON.stringify({
    checkedAt: new Date().toISOString(), mode: 'read-only-preflight-not-a-published-snapshot',
    sources: Object.fromEntries(sources.map(([key, url]) => [key, { url, rows: fetched[key].payload.length, hash: fetched[key].payloadHash, fetchedAt: fetched[key].fetchedAt }])),
    universeDate: universe.date, universeDates: universe.dates, universeTotal: universe.stocks.length,
    excluded: { TWSE: twse.excluded, TPEx: tpex.excluded },
    dates: { TWSE: twseVolume.date, TPEx: tpexVolume.date, TDCC: holder.date },
    coverage: { TWSE: coverage('TWSE', twseVolume), TPEx: coverage('TPEx', tpexVolume) },
    weeklyInvalidReasons: Object.fromEntries([...new Set(holder.invalid.values())].map((reason) => [reason, [...holder.invalid.values()].filter((value) => value === reason).length])),
    missingPreviousPeriod: 'latest-only endpoints do not prove prior-period full-market availability',
}, null, 2));
