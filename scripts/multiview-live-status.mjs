import { pathToFileURL } from 'node:url';

// Health describes persisted Yahoo/official history, not the Shioaji chart stream.
export function liveDataStatus(health) {
  const count = value => Number.isInteger(value) && value >= 0 ? value : null;
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? value : 'unknown';
  const counts = health?.dailyCandleContinuity?.counts;
  const target = count(counts?.enabledSymbols);
  const covered = count(counts?.latestSessionCoverage);
  const unknown = count(counts?.unknown);
  const market = target > 0 && covered === target && unknown === 0 && counts.complete === target
    ? 'verified' : target > 0 ? 'partial' : 'unknown';
  const warm = health?.taiwanStockChip?.watchlistPrewarming;
  const pe = health?.taiwanStockPeRiver?.continuous;
  const weekly = health?.taiwanStockChip?.datasets?.['shareholder-distribution'];
  return {
    multiview_after_hours_source: health?.ok === true ? 'live_health' : 'unavailable',
    multiview_after_hours: health?.ok === true ? 'verification_required' : 'unknown',
    multiview_after_hours_market: market,
    multiview_market_expected_session: date(health?.dailyCandleContinuity?.expectedCompletedSession),
    multiview_market_latest_coverage: `${covered ?? 'unknown'}/${target ?? 'unknown'}`,
    multiview_market_unknown: unknown ?? 'unknown',
    multiview_after_hours_chip: warm?.status === 'warming' ? 'partial' : 'unverified',
    multiview_chip_ready: `${count(warm?.readySymbols) ?? 'unknown'}/${count(warm?.targetSymbols) ?? 'unknown'}`,
    multiview_after_hours_tdcc: weekly?.status === 'available' ? 'available_not_verified' : 'unknown',
    multiview_tdcc_source_date: date(weekly?.sourceDate),
    multiview_after_hours_pe: count(pe?.history?.missing) > 0 ? 'partial' : 'unverified',
    multiview_pe_history_missing: count(pe?.history?.missing) ?? 'unknown',
    multiview_pe_verified_date: date(pe?.latest?.verifiedEnd),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let health;
  try { health = JSON.parse(input); } catch { health = null; }
  for (const [key, value] of Object.entries(liveDataStatus(health))) console.log(`${key}=${value}`);
}
