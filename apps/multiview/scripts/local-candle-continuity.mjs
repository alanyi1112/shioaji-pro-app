import { pathToFileURL } from 'node:url';

export async function runLocalContinuity({ secret, fetchImpl = fetch, maxBatches = 128, log = console.log }) {
  if (!secret || secret.length < 32) throw new Error('local_maintenance_not_configured');
  let result = null;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const response = await fetchImpl('http://127.0.0.1:5174/api/internal/local-maintenance', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-multiview-local-authorization': `Bearer ${secret}` },
      body: JSON.stringify({ action: 'continuity' }), signal: AbortSignal.timeout(150000),
    });
    const payload = await response.json();
    if (!response.ok || payload.ok !== true) throw new Error('local_continuity_failed');
    result = payload.result;
    if (!result || typeof result.done !== 'boolean' || !Number.isInteger(result.processed) || result.processed < 0) throw new Error('invalid_response');
    log(JSON.stringify({ event: 'local-continuity', batch: batch + 1, done: result.done, processed: result.processed, status: result.summary?.status ?? null, counts: result.summary?.counts ?? null }));
    if (result.done && (result.summary?.status === 'failed'
      || result.summary?.counts && result.summary.counts.complete !== result.summary.counts.target)) throw new Error('local_continuity_unverified');
    if (result.done || result.processed === 0) return result;
  }
  return { ...result, bounded: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLocalContinuity({ secret: process.env.LOCAL_PIPELINE_SECRET }).catch(() => {
    console.error('local_continuity_failed');
    process.exitCode = 1;
  });
}
