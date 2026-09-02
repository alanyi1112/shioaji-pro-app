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
const headers = { authorization: `Bearer ${secret}`, 'content-type': 'application/json' };

async function call(body) {
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(String(payload.reasonCode || `archive_http_${response.status}`));
  return payload;
}

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
