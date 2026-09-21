#!/usr/bin/env node
/** 本機唯讀逐條件驗收；只查選股 GET，不呼叫券商或觸發資料回補。 */
import { writeFile } from 'node:fs/promises';
import { DEFAULT_CRITERIA_V5 } from '../src/lib/stock-screener-v5.ts';
import { screenerSearchV3, screenerSearchV4, screenerSearchV5, decodeScreenerResponse } from '../src/lib/stock-screener-api.ts';

const cases = [];
function add(name, key, patch = {}, version = 3, paginate = false) {
  const criteria = structuredClone(DEFAULT_CRITERIA_V5);
  for (const row of Object.values(criteria)) if (row && typeof row === 'object') row.enabled = false;
  criteria[key] = { ...criteria[key], ...patch, enabled: true };
  cases.push({ name, criteria, version, paginate });
}
add('volume', 'volume', { threshold: '2' }, 3, true);
add('volume-turnover', 'volume', { threshold: '2', turnover: { enabled: true, minimumWan: '1000' } }, 3, true);
for (const mode of ['weekly-increase', 'decrease-to-increase', 'increase-to-decrease']) {
  add(`holder-${mode}`, 'holder', { mode }, 3, true);
  add(`holder-turnover-${mode}`, 'holder', { mode, turnover: { enabled: true, minimumWan: '1000' } });
  if (mode !== 'weekly-increase') for (const streakWeeks of [2, 3, 4]) add(`holder-${mode}-${streakWeeks}`, 'holder', { mode, streakWeeks });
}
for (const algorithm of ['raw-three', 'chan-containment', 'any']) for (const direction of ['bottom', 'top', 'any'])
  add(`fractal-${algorithm}-${direction}`, 'fractal', { algorithm, direction }, 3, true);
for (const mode of ['lower-bullish', 'upper-bearish', 'any']) add(`boll-${mode}`, 'bollReversal', { mode }, 3, true);
for (const mode of ['bullish-preparation', 'golden-cross', 'bearish-preparation', 'death-cross', 'any-bullish', 'any-bearish'])
  add(`ma-${mode}`, 'ma', { mode }, 4, true);
for (const source of ['obv', 'rsi5', 'rsi10', 'kd-k', 'macd-line', 'macd-histogram'])
  for (const direction of ['bullish', 'bearish', 'any']) for (const requireZeroReset of source === 'macd-histogram' ? [false, true] : [false])
    add(`div-${source}-${direction}-${requireZeroReset}`, 'divergence', { source, direction, requireZeroReset }, 4, true);
for (const key of ['largeHolderTrend', 'largeHolderConcentration', 'retailHolderDecline', 'trustOwnership', 'priceMargin', 'shortMarginRatio', 'closeHigh'])
  add(key, key, {}, 5, true);
for (const period of [5, 10, 20, 60]) add(`sma-${period}`, 'closeSmaBreakout', { period }, 5, true);
for (const key of ['largeHolderTrend', 'largeHolderConcentration', 'retailHolderDecline'])
  for (const weeks of [1, 12]) add(`${key}-${weeks}`, key, { weeks }, 5);
for (const days of [5, 10]) add(`trust-days-${days}`, 'trustOwnership', { days }, 5);
for (const days of [1, 20]) add(`price-margin-days-${days}`, 'priceMargin', { days }, 5);
for (const days of [2, 120]) add(`close-high-days-${days}`, 'closeHigh', { days }, 5);
for (const mode of ['all', 'any']) {
  const criteria = structuredClone(DEFAULT_CRITERIA_V5);
  criteria.mode = mode; criteria.volume.threshold = '2'; criteria.fractal.enabled = true;
  cases.push({ name: `combination-${mode}`, criteria, version: 3, paginate: true });
}

const output = process.argv[2];
const onlyV5 = process.argv[3] === '--v5';
const onlyV4 = process.argv[3] === '--v4';
const onlyTechnical = process.argv[3] === '--technical';
if (!output || process.argv.length > 4 || (process.argv[3] && !onlyV5 && !onlyTechnical && !onlyV4)) throw new Error('使用方式：node scripts/verify-stock-screener-conditions.mjs /absolute/evidence.json');
const report = { startedAt: new Date().toISOString(), requests: 0, cases: [] };
for (const item of cases.filter(item => onlyV5 ? item.version === 5 : onlyV4 ? item.version === 4 : onlyTechnical ? item.version !== 5 : true)) {
  let cursor, first, symbols = new Set(), pages = 0, rows = [];
  do {
    const query = { criteria: item.criteria, sort: 'code', direction: 'asc', resultState: 'pass', cursor };
    const search = ({ 3: screenerSearchV3, 4: screenerSearchV4, 5: screenerSearchV5 })[item.version](query);
    const response = await fetch(`http://127.0.0.1:5173/api/stock-screener/results?${search}`, { signal: AbortSignal.timeout(15000) });
    report.requests++;
    if (!response.ok) throw new Error(`${item.name}:http_${response.status}`);
    const result = decodeScreenerResponse(await response.json());
    first ??= result;
    if (result.snapshotId !== first.snapshotId) throw new Error(`${item.name}:snapshot_changed`);
    if (!['ready', 'partial'].includes(result.state)) break;
    const c = result.counts;
    if (!c || c.matched + c.notMatched + c.unknown !== c.total || c.evaluated !== c.matched + c.notMatched)
      throw new Error(`${item.name}:counts_mismatch`);
    for (const row of result.rows) {
      if (symbols.has(row.symbol) || row.verdict !== 'pass') throw new Error(`${item.name}:duplicate_or_verdict`);
      const maDate = row.technicalV4?.ma?.evidence?.current?.sessionDate;
      if (maDate && maDate !== result.effectiveSessionDate) throw new Error(`${item.name}:stale_ma`);
      symbols.add(row.symbol); rows.push(row);
    }
    cursor = item.paginate ? result.nextCursor : null;
    pages++;
  } while (cursor);
  if (item.paginate && ['ready', 'partial'].includes(first.state) && symbols.size !== first.counts.matched)
    throw new Error(`${item.name}:pagination_mismatch`);
  report.cases.push({ ...item, state: first.state, reason: first.reason, snapshotId: first.snapshotId,
    effectiveSessionDate: first.effectiveSessionDate, counts: first.counts, pages, rows });
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ name: item.name, state: first.state, matched: first.counts?.matched, unknown: first.counts?.unknown, pages }));
}
report.finishedAt = new Date().toISOString();
report.state = report.cases.every(item => ['ready', 'partial'].includes(item.state)) ? 'verified' : 'incomplete';
await writeFile(output, JSON.stringify(report, null, 2));
if (report.state !== 'verified') process.exitCode = 2;
