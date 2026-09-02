#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { TDCC_ARCHIVE_MANIFEST, TDCC_ARCHIVE_MANIFEST_VERSION } from '../src/lib/tdcc-archive-validator.ts';
import { fetchScreenerSource, mergeUniverses, parseUniverse, SCREENER_SOURCES } from '../apps/multiview/worker/stock-screener-sources.ts';

const TWSE_CATALOG_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const TPEX_CATALOG_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes';

const baseUrl = String(process.env.MULTIVIEW_ARCHIVE_TARGET_URL || 'http://127.0.0.1:5174').replace(/\/$/, '');
const launchctlSecret = () => {
  if (!baseUrl.startsWith('http://127.0.0.1:')) return '';
  try { return execFileSync('launchctl', ['getenv', 'TDCC_CONTINUOUS_BACKFILL_SECRET'], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};
const localPipelineSecret = () => {
  if (!baseUrl.startsWith('http://127.0.0.1:')) return '';
  try { return readFileSync('/Users/alanyi/Library/Application Support/RealTimeStock/MultiView/pipeline-secret', 'utf8').trim(); }
  catch { return ''; }
};
const secret = String(process.env.TDCC_CONTINUOUS_BACKFILL_SECRET || launchctlSecret() || localPipelineSecret());
if (!secret) throw new Error('TDCC_CONTINUOUS_BACKFILL_SECRET is required');
if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(baseUrl) && !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl)) throw new Error('invalid target URL');

const endpoint = `${baseUrl}/api/internal/tdcc-archive-bootstrap`;
const owner = String(process.env.TDCC_ARCHIVE_OWNER || `archive-${randomUUID()}`);
const headers = { 'content-type': 'application/json' };
if (process.env.CLOUDFLARE_ACCESS_CLIENT_ID && process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET) {
  headers['CF-Access-Client-Id'] = process.env.CLOUDFLARE_ACCESS_CLIENT_ID;
  headers['CF-Access-Client-Secret'] = process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET;
  headers['X-MultiChart-Pipeline-Authorization'] = `Bearer ${secret}`;
} else {
  headers.authorization = `Bearer ${secret}`;
  if (process.env.SITES_BYPASS_TOKEN) headers['OAI-Sites-Authorization'] = `Bearer ${process.env.SITES_BYPASS_TOKEN}`;
}

async function call(body) {
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(String(payload.reasonCode || `archive_http_${response.status}`));
  return payload;
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function officialSource(url) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchScreenerSource(url, fetch, 120000);
    } catch (error) {
      if (attempt > 0 || !/^source_(?:timeout|http_\d+)$/.test(String(error?.message || ''))) throw error;
      await delay(3000);
    }
  }
  throw new Error('source_timeout');
}

async function catalog(url, minimumRows) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await catalogAttempt(url, minimumRows);
    } catch (error) {
      if (attempt > 0 || !/^archive_catalog_(?:timeout|http_\d+)$/.test(String(error?.message || ''))) throw error;
      await delay(3000);
    }
  }
  throw new Error('archive_catalog_timeout');
}

async function catalogAttempt(url, minimumRows) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    let response;
    try {
      response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { accept: 'application/json', 'accept-encoding': 'identity' } });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('archive_catalog_timeout');
      throw error;
    }
    if (!response.ok) throw new Error(`archive_catalog_http_${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload) || payload.length < minimumRows || payload.length > 10000) throw new Error('archive_catalog_invalid');
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function verifiedUniverse() {
  const twseIssuer = await officialSource(SCREENER_SOURCES.TWSE.universe);
  const tpexIssuer = await officialSource(SCREENER_SOURCES.TPEx.universe);
  const twseCatalog = await catalog(TWSE_CATALOG_URL, 800);
  const tpexCatalog = await catalog(TPEX_CATALOG_URL, 500);
  const ordinary = mergeUniverses(parseUniverse(twseIssuer.payload, 'TWSE'), parseUniverse(tpexIssuer.payload, 'TPEx'));
  if (ordinary.stocks.length < 1500) throw new Error('archive_universe_not_ready');
  const rows = ordinary.stocks.map(stock => ({
    symbol: stock.symbol, stockCode: stock.code, exchange: stock.market, quoteType: 'EQUITY',
    listingDate: stock.listingDate, sourceDate: stock.market === 'TWSE' ? ordinary.dates.TWSE : ordinary.dates.TPEx,
  }));
  const ordinaryCodes = new Set(ordinary.stocks.map(stock => stock.code));
  const etfCodes = new Set();
  const catalogDate = value => {
    const match = /^(\d{3})(\d{2})(\d{2})$/.exec(String(value || ''));
    if (!match) throw new Error('archive_catalog_invalid');
    return `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`;
  };
  const appendEtfs = (payload, exchange) => {
    for (const item of payload) {
      const stockCode = String(exchange === 'TWSE' ? item.Code ?? '' : item.SecuritiesCompanyCode ?? '').trim().toUpperCase();
      if (!/^00[0-9A-Z]{2,6}$/.test(stockCode)) continue;
      if (ordinaryCodes.has(stockCode) || etfCodes.has(stockCode)) throw new Error('archive_universe_invalid');
      etfCodes.add(stockCode);
      rows.push({ symbol: `${stockCode}.${exchange === 'TWSE' ? 'TW' : 'TWO'}`, stockCode, exchange, quoteType: 'ETF', listingDate: null, sourceDate: catalogDate(item.Date) });
    }
  };
  appendEtfs(twseCatalog, 'TWSE');
  appendEtfs(tpexCatalog, 'TPEx');
  if (etfCodes.size < 100) throw new Error('archive_catalog_invalid');
  return rows;
}

const universeRows = await verifiedUniverse();
for (let index = 0; index < universeRows.length; index += 200) {
  const response = await call({
    action: 'seed-universe', owner, manifestVersion: TDCC_ARCHIVE_MANIFEST_VERSION, scope: 'full-market',
    reset: index === 0, rows: universeRows.slice(index, index + 200),
  });
  if (Number(response.universe?.accepted || 0) < 1) throw new Error('archive_invalid_universe_batch');
}
console.log(JSON.stringify({ event: 'tdcc-archive-universe', count: universeRows.length }));

const start = await call({ action: 'start', owner, manifestVersion: TDCC_ARCHIVE_MANIFEST_VERSION, scope: 'full-market' });
if (start.archive.complete) {
  console.log(JSON.stringify(start.archive, null, 2));
  process.exit(0);
}

for (const entry of TDCC_ARCHIVE_MANIFEST) {
  const payload = await call({ action: 'prepare-period', owner, manifestVersion: TDCC_ARCHIVE_MANIFEST_VERSION, scope: 'full-market', date: entry.date });
  console.log(JSON.stringify({ date: entry.date, status: payload.receipt?.status, processed: payload.archive.processed, remaining: payload.archive.remaining }));
}

const completed = await call({ action: 'finalize', owner, manifestVersion: TDCC_ARCHIVE_MANIFEST_VERSION, scope: 'full-market' });
console.log(JSON.stringify(completed.archive, null, 2));
if (!completed.archive.complete || completed.archive.remaining || completed.archive.failed || completed.archive.overdue) process.exitCode = 1;
