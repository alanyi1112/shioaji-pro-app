#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { TDCC_ARCHIVE_MANIFEST, TDCC_ARCHIVE_MANIFEST_VERSION } from '../src/lib/tdcc-archive-validator.ts';

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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.ok) return payload;
      if (attempt < 2 && [429, 502, 503, 504].includes(response.status)) {
        await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
        continue;
      }
      throw new Error(String(payload.reasonCode || `archive_http_${response.status}`));
    } catch (error) {
      if (attempt < 2 && error?.name === 'AbortError') {
        await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('archive_http_retry_exhausted');
}

const universeManifest = JSON.parse(readFileSync(new URL('../src/lib/tdcc-archive-universe.json', import.meta.url), 'utf8'));
const expectedSources = new Map([
  ['twse-issuer', 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'],
  ['tpex-issuer', 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O'],
  ['twse-catalog', 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'],
  ['tpex-catalog', 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes'],
]);
if (universeManifest.version !== 'tdcc-archive-universe-2026-09-02-v1'
  || !Array.isArray(universeManifest.sources) || universeManifest.sources.length !== expectedSources.size
  || !Array.isArray(universeManifest.rows) || universeManifest.rows.length !== universeManifest.counts?.total
  || universeManifest.rows.length < 2000 || universeManifest.rows.length > 5000) throw new Error('archive_universe_manifest_invalid');
for (const source of universeManifest.sources) {
  if (expectedSources.get(source.id) !== source.url || !/^\d{4}-\d{2}-\d{2}$/.test(source.sourceDate)
    || !/^[0-9a-f]{64}$/.test(source.payloadSha256)) throw new Error('archive_universe_manifest_invalid');
}
const universeRows = universeManifest.rows;
const universeSymbols = new Set(universeRows.map(row => row?.symbol));
if (universeSymbols.size !== universeRows.length || !['2330.TW', '8103.TW', '6488.TWO', '0050.TW', '006201.TWO'].every(symbol => universeSymbols.has(symbol))) {
  throw new Error('archive_universe_manifest_invalid');
}
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
