import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { parseTwseOfficialCalendar, parseTpexOfficialCalendar, buildOfficialMarketCalendarSnapshot } from '../../../scripts/smart-order-runtime/official-market-calendar-core.mjs';

export async function seedLocalOfficialCalendar({ secret, fetchImpl = fetch, now = new Date() }) {
  if (!secret || secret.length < 32) throw new Error('local_maintenance_not_configured');
  const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric' }).format(now));
  const source = async (url) => {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000), redirect: 'error', headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('calendar_source_unavailable');
    const text = await response.text();
    if (text.length > 1024 * 1024) throw new Error('calendar_source_too_large');
    return JSON.parse(text);
  };
  const [twse, tpex] = await Promise.all([
    source(`https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json&queryYear=${year - 1911}`),
    source(`https://www.tpex.org.tw/www/zh-tw/bulletin/tradingDate?date=${year}`),
  ]);
  buildOfficialMarketCalendarSnapshot({ twse: parseTwseOfficialCalendar(twse, year), tpex: parseTpexOfficialCalendar(tpex, year), fetchedAtEpochMs: now.getTime() });
  const response = await fetchImpl('http://127.0.0.1:5174/api/internal/candle-continuity-audit', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({ action: 'seed-official-trading-calendar', year, twse, tpex }),
  });
  if (!response.ok || (await response.json()).ok !== true) throw new Error('calendar_seed_failed');
  return { year, status: 'verified' };
}

export async function runLocalContinuity({ secret, fetchImpl = fetch, maxBatches = 128, log = console.log, seedCalendar = false, reuseExistingOnly = false }) {
  if (!secret || secret.length < 32) throw new Error('local_maintenance_not_configured');
  if (typeof reuseExistingOnly !== 'boolean' || reuseExistingOnly && seedCalendar) throw new Error('invalid_reuse_mode');
  if (seedCalendar) log(JSON.stringify({ event: 'official-calendar', ...await seedLocalOfficialCalendar({ secret, fetchImpl }) }));
  let result = null;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const response = await fetchImpl('http://127.0.0.1:5174/api/internal/local-maintenance', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-multiview-local-authorization': `Bearer ${secret}` },
      body: JSON.stringify({ action: 'continuity', ...(reuseExistingOnly ? { reuseExistingOnly: true } : {}) }), signal: AbortSignal.timeout(150000),
    });
    const payload = await response.json();
    if (!response.ok || payload.ok !== true) throw new Error('local_continuity_failed');
    result = payload.result;
    if (!result || typeof result.done !== 'boolean' || !Number.isInteger(result.processed) || result.processed < 0) throw new Error('invalid_response');
    log(JSON.stringify({ event: 'local-continuity', batch: batch + 1, done: result.done, processed: result.processed, status: result.summary?.status ?? null, counts: result.summary?.counts ?? null }));
    if (result.done && (result.summary?.status === 'failed'
      || result.summary?.counts && result.summary.counts.complete !== result.summary.counts.target)) {
      const error = new Error('local_continuity_unverified');
      error.summary = result.summary;
      throw error;
    }
    if (result.done || result.processed === 0) return result;
  }
  return { ...result, bounded: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const onlyCalendar = process.argv.includes('--calendar-only');
  const reuseExistingOnly = process.argv.includes('--reuse-existing-only');
  const secretFile = process.argv.find((arg) => arg.startsWith('--secret-file='))?.slice('--secret-file='.length);
  const secret = secretFile ? (await readFile(secretFile, 'utf8')).trim() : process.env.LOCAL_PIPELINE_SECRET;
  const work = onlyCalendar && reuseExistingOnly ? Promise.reject(new Error('invalid_reuse_mode')) : onlyCalendar
    ? seedLocalOfficialCalendar({ secret }) : runLocalContinuity({ secret, seedCalendar: !reuseExistingOnly, reuseExistingOnly });
  work.then((result) => { if (onlyCalendar) console.log(JSON.stringify({ event: 'official-calendar', ...result })); }).catch((error) => {
    console.error(JSON.stringify(localContinuityFailure(error, onlyCalendar)));
    process.exitCode = 1;
  });
}

export function localContinuityFailure(error, onlyCalendar = false) {
  const allowed = ['local_continuity_unverified', 'local_continuity_failed', 'invalid_response',
    'calendar_source_unavailable', 'calendar_seed_failed', 'calendar_source_too_large'];
  const code = onlyCalendar ? 'calendar_seed_failed' : allowed.includes(error?.message) ? error.message : 'local_continuity_transport_failed';
  const counts = error?.summary?.counts;
  const summary = counts && typeof counts === 'object' ? Object.fromEntries(
    ['target','processed','remaining','complete','partial','unknown','failed','overdue']
      .filter(k => Number.isSafeInteger(counts[k]) && counts[k] >= 0).map(k => [k, counts[k]])) : null;
  return { event: 'failed', error: code, counts: summary };
}
