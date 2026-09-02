import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchScreenerSource, mergeUniverses, parseUniverse, SCREENER_SOURCES } from '../apps/multiview/worker/stock-screener-sources.ts';

const TWSE_CATALOG_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const TPEX_CATALOG_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes';
const output = resolve(process.argv[2] || new URL('../src/lib/tdcc-archive-universe.json', import.meta.url).pathname);

async function catalog(url, minimumRows) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { accept: 'application/json', 'accept-encoding': 'identity' } });
    if (!response.ok) throw new Error(`archive_catalog_http_${response.status}`);
    const body = await response.text();
    if (body.length > 32 * 1024 * 1024) throw new Error('archive_catalog_invalid');
    const payload = JSON.parse(body);
    if (!Array.isArray(payload) || payload.length < minimumRows || payload.length > 10000) throw new Error('archive_catalog_invalid');
    return { payload, payloadHash: createHash('sha256').update(body).digest('hex') };
  } finally {
    clearTimeout(timer);
  }
}

const catalogDate = value => {
  const match = /^(\d{3})(\d{2})(\d{2})$/.exec(String(value || ''));
  if (!match) throw new Error('archive_catalog_invalid');
  return `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`;
};

const twseIssuer = await fetchScreenerSource(SCREENER_SOURCES.TWSE.universe, fetch, 120000);
const tpexIssuer = await fetchScreenerSource(SCREENER_SOURCES.TPEx.universe, fetch, 120000);
const twseParsed = parseUniverse(twseIssuer.payload, 'TWSE');
const tpexParsed = parseUniverse(tpexIssuer.payload, 'TPEx');
const ordinary = mergeUniverses(twseParsed, tpexParsed);
if (ordinary.stocks.length < 1500) throw new Error('archive_universe_not_ready');
const rows = ordinary.stocks.map(stock => ({
  symbol: stock.symbol, stockCode: stock.code, exchange: stock.market, quoteType: 'EQUITY',
  listingDate: stock.listingDate, sourceDate: stock.market === 'TWSE' ? ordinary.dates.TWSE : ordinary.dates.TPEx,
}));
const ordinaryCodes = new Set(ordinary.stocks.map(stock => stock.code));
const etfCodes = new Set();
const twseCatalog = await catalog(TWSE_CATALOG_URL, 800);
const tpexCatalog = await catalog(TPEX_CATALOG_URL, 500);

const appendEtfs = (source, exchange) => {
  const dates = new Set();
  for (const item of source.payload) {
    const stockCode = String(exchange === 'TWSE' ? item.Code ?? '' : item.SecuritiesCompanyCode ?? '').trim().toUpperCase();
    if (!/^00[0-9A-Z]{2,6}$/.test(stockCode)) continue;
    if (ordinaryCodes.has(stockCode) || etfCodes.has(stockCode)) throw new Error('archive_universe_invalid');
    const sourceDate = catalogDate(item.Date);
    dates.add(sourceDate);
    etfCodes.add(stockCode);
    rows.push({ symbol: `${stockCode}.${exchange === 'TWSE' ? 'TW' : 'TWO'}`, stockCode, exchange, quoteType: 'ETF', listingDate: null, sourceDate });
  }
  if (dates.size !== 1) throw new Error('archive_catalog_invalid');
  return [...dates][0];
};

const twseCatalogDate = appendEtfs(twseCatalog, 'TWSE');
const tpexCatalogDate = appendEtfs(tpexCatalog, 'TPEx');
if (etfCodes.size < 100) throw new Error('archive_catalog_invalid');
rows.sort((a, b) => a.symbol.localeCompare(b.symbol));

const manifest = {
  version: 'tdcc-archive-universe-2026-09-02-v1',
  generatedAt: new Date().toISOString(),
  counts: { total: rows.length, equities: ordinary.stocks.length, etfs: etfCodes.size },
  sources: [
    { id: 'twse-issuer', url: SCREENER_SOURCES.TWSE.universe, sourceDate: twseParsed.date, payloadSha256: twseIssuer.payloadHash },
    { id: 'tpex-issuer', url: SCREENER_SOURCES.TPEx.universe, sourceDate: tpexParsed.date, payloadSha256: tpexIssuer.payloadHash },
    { id: 'twse-catalog', url: TWSE_CATALOG_URL, sourceDate: twseCatalogDate, payloadSha256: twseCatalog.payloadHash },
    { id: 'tpex-catalog', url: TPEX_CATALOG_URL, sourceDate: tpexCatalogDate, payloadSha256: tpexCatalog.payloadHash },
  ],
  rows,
};
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ output, version: manifest.version, ...manifest.counts }));
