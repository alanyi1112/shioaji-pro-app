/** 真實 v9 凍結來源與 HTTP 全分頁唯讀稽核；獨立公式，不呼叫產品 evaluator。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { DEFAULT_CRITERIA_V7 } from '../src/lib/stock-screener-v7.ts';
import { DEFAULT_BOLLINGER_SQUEEZE } from '../src/lib/stock-screener-v8.ts';
import { DEFAULT_CANDLESTICK_REVERSAL } from '../src/lib/stock-screener-v9.ts';

const stable = v => v === undefined ? 'null' : Array.isArray(v) ? `[${v.map(stable)}]` : v && typeof v === 'object'
  ? `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}` : JSON.stringify(v);
const sha = v => createHash('sha256').update(v).digest('hex');
const hash = v => sha(stable(v));
const units = v => { const [a, b = ''] = String(v).split('.'); return BigInt(a) * 1000000n + BigInt(b.padEnd(6, '0')); };
const pct = v => { const [a, b = ''] = v.split('.'); return BigInt(a) * 100n + BigInt(b.padEnd(2, '0')); };
const abs = v => v < 0n ? -v : v;
const and = values => values.includes(false) ? false : values.includes(null) ? null : true;
const verdict = v => v === null ? 'unknown' : v ? 'pass' : 'fail';

export function independentPatterns(h, c) {
  const input = h.points.map(p => p.bar ? { o: units(p.bar.open), h: units(p.bar.high), l: units(p.bar.low), c: units(p.bar.close),
    body: abs(units(p.bar.close) - units(p.bar.open)), range: units(p.bar.high) - units(p.bar.low),
    volume: p.bar.volumeShares === null ? null : BigInt(p.bar.volumeShares) } : null);
  const results = c.patterns.map(pattern => {
    const bull = !['bearish-engulfing', 'three-black-crows'].includes(pattern), size = ['piercing', 'bearish-engulfing'].includes(pattern) ? 2 : 3;
    const end = input.length - 1 - Number(c.mode === 'next-session-breakout'), start = end - size + 1;
    const flags = [], used = [];
    const window = (from, to) => {
      if (from < 0 || to < from || to >= input.length) { flags.push(null); return null; }
      used.push(from, to); const rows = input.slice(from, to + 1);
      if (rows.includes(null)) { flags.push(null); return null; } return rows;
    };
    const bars = window(start, end), trend = window(start - c.trendDays, start - 1);
    if (trend) {
      const n = BigInt(trend.length), sy = trend.reduce((s, b) => s + b.c, 0n), sxy = trend.reduce((s, b, i) => s + BigInt(i) * b.c, 0n);
      const slope = n * sxy - n * (n - 1n) / 2n * sy, change = trend.at(-1).c - trend[0].c;
      flags.push((bull ? slope < 0n : slope > 0n) && (bull ? -change : change) * 10000n > trend[0].c * pct(c.minTrendChangePct));
    }
    const needsLong = ['three-white-soldiers', 'morning-star', 'three-black-crows'].includes(pattern) || pattern === 'piercing' && c.piercingRequireLongFirstBody;
    const ref = needsLong ? window(start - c.bodyReferenceDays, start - 1) : null;
    let median2 = null;
    if (ref) { const sorted = ref.map(b => b.body).sort((a, b) => a < b ? -1 : a > b ? 1 : 0), mid = Math.floor(sorted.length / 2);
      median2 = sorted.length % 2 ? sorted[mid] * 2n : sorted[mid - 1] + sorted[mid];
      if (median2 === 0n) { flags.push(null); median2 = null; } }
    const long = b => { flags.push(b.range > 0n && b.body * 10000n >= b.range * pct(c.longBodyMinPct));
      if (median2 !== null) flags.push(b.body * 200n >= median2 * pct(c.longBodyMedianRatio)); };
    const lo = b => b.o < b.c ? b.o : b.c, hi = b => b.o > b.c ? b.o : b.c;
    const inside = (o, b) => lo(b) < o && o < hi(b);
    let subtype = pattern;
    if (bars) {
      const [a, b, d] = bars; flags.push(bars.every(b => b.range > 0n));
      if (pattern === 'three-white-soldiers' || pattern === 'three-black-crows') {
        bars.forEach(long); flags.push(bars.every(b => bull ? b.c > b.o : b.c < b.o));
        flags.push(bars.slice(1).every((b, i) => bull ? b.c > bars[i].c : b.c < bars[i].c && b.l < bars[i].l));
        flags.push(bars.slice(1).every((b, i) => inside(b.o, bars[i])));
        flags.push(bars.every(b => b.range > 0n && (bull ? b.h - b.c : b.c - b.l) * 10000n <= b.range * pct(c.nearExtremeMaxPct)));
        if (!bull && c.firstCrowOpenWithinPriorBody) { const prior = window(start - 1, start - 1); if (prior) flags.push(inside(a.o, prior[0])); }
      } else if (pattern === 'bearish-engulfing') flags.push(a.c > a.o && b.c < b.o, b.o > a.c && b.c < a.o);
      else if (pattern === 'morning-star') {
        long(a); long(d); flags.push(a.c < a.o && d.c > d.o, b.range > 0n && b.body * 10000n <= b.range * pct(c.smallBodyMaxPct));
        if (b.o === b.c) { subtype = 'morning-doji-star'; flags.push(c.includeMorningDoji); }
        flags.push((d.c - a.c) * 10000n > (a.o - a.c) * pct(c.morningRecoveryPct));
        if (c.morningGapMode === 'strict-body-gap') flags.push(hi(b) < lo(a) && lo(d) > hi(b));
      } else {
        if (c.piercingRequireLongFirstBody) long(a);
        flags.push(a.c < a.o && b.c > b.o, b.o <= a.c && (c.piercingOpenMode !== 'below-prior-low' || b.o < a.l), b.c < a.o,
          (b.c - a.c) * 10000n > (a.o - a.c) * pct(c.piercingRecoveryPct));
      }
      if (c.mode === 'next-session-breakout') { const next = window(end + 1, end + 1);
        if (next) flags.push(bull ? next[0].c > bars.reduce((v, b) => b.h > v ? b.h : v, a.h) : next[0].c < bars.reduce((v, b) => b.l < v ? b.l : v, a.l)); }
      if (c.position.enabled) { const prior = window(start - c.position.baselineDays, start - 1);
        if (prior) { const bound = prior.reduce((v, b) => bull ? b.l < v ? b.l : v : b.h > v ? b.h : v, bull ? prior[0].l : prior[0].h);
          const extreme = bars.reduce((v, b) => bull ? b.l < v ? b.l : v : b.h > v ? b.h : v, bull ? a.l : a.h);
          flags.push(abs(extreme - bound) * 10000n <= bound * pct(c.position.tolerancePct)); } }
    }
    if (c.volume.enabled) { const i = input.length - 1, today = window(i, i), prior = window(i - c.volume.baselineDays, i - 1);
      if (today && prior) { if (today[0].volume === null || prior.some(b => b.volume === null)) flags.push(null);
        else { const total = prior.reduce((v, b) => v + b.volume, 0n), n = BigInt(prior.length);
          flags.push(total === 0n ? null : today[0].volume * n * 100n >= total * pct(c.volume.ratio));
          if (c.volume.minimumAverageVolumeEnabled) flags.push(total >= n * BigInt(c.volume.minimumAverageVolumeLots) * 1000n); } } }
    const incomparable = h.sessions.slice(Math.min(...used), Math.max(...used) + 1).some(d => h.incomparableSessions.includes(d));
    return { pattern, subtype, verdict: incomparable ? 'unknown' : verdict(and(flags)) };
  });
  return { matches: results, verdict: results.some(r => r.verdict === 'pass') ? 'pass' : results.some(r => r.verdict === 'unknown') ? 'unknown' : 'fail',
    hits: results.filter(r => r.verdict === 'pass').map(r => r.pattern) };
}

export async function auditCandlestickPublication(path, origin = 'http://127.0.0.1:5174') {
  assert(/^http:\/\/127\.0\.0\.1:(5173|5174)$/.test(origin));
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('BEGIN');
    const head = db.prepare("SELECT * FROM screener_candlestick_head WHERE name='v9'").get(); assert(head);
    const publication = db.prepare('SELECT * FROM screener_candlestick_publications WHERE id=?').get(head.snapshot_id);
    assert.equal(publication.status, 'published'); const m = JSON.parse(publication.metadata);
    const stocks = db.prepare('SELECT payload FROM screener_candlestick_rows WHERE snapshot_id=? ORDER BY symbol').all(head.snapshot_id).map(r => JSON.parse(r.payload));
    assert.equal(hash(stocks), m.rowsHash); assert.equal(stocks.length, m.total); assert.equal(new Set(stocks.map(r => r.symbol)).size, m.total);
    const histories = stocks.map(r => r.history), sessions = histories[0].sessions, selected = new Map(), readiness = {};
    assert.equal(sessions.length, 64); assert(!sessions.includes('2026-07-10'));
    for (const selection of m.sourceEvidence.selections) {
      const manifestRecord = db.prepare('SELECT * FROM screener_source_selections WHERE manifest_hash=?').get(selection.manifestHash); assert.equal(manifestRecord.status, 'complete');
      const manifest = JSON.parse(manifestRecord.manifest), { manifestHash, ...body } = manifest;
      assert.equal(hash(body), manifestHash); assert.deepEqual(manifest, selection);
      const rows = db.prepare('SELECT payload FROM screener_source_selected_rows WHERE selection_key=? ORDER BY symbol').all(manifestRecord.selection_key).map(r => JSON.parse(r.payload));
      assert.equal(rows.length, manifest.rowCount); assert.equal(hash(rows), manifest.rowsHash); assert.equal(manifest.actualDate, manifest.sessionDate);
      assert.equal(manifest.requestedDate, manifest.sessionDate);
      for (const r of rows) selected.set(`${r.symbol}|${r.sessionDate}`, r);
    }
    assert.equal(m.sourceEvidence.selections.length, 128);
    let pointCount = 0;
    for (const stock of stocks) {
      const h = stock.history, { evidenceHash, ...body } = h; assert.equal(hash(body), evidenceHash); assert.deepEqual(h.sessions, sessions);
      assert.equal(h.through, m.effectiveSessionDate); assert.equal(h.calendarHash, m.calendarHash); assert.equal(h.priceBasis, 'official-unadjusted-after-market-twd');
      for (const p of h.points) { const source = selected.get(`${stock.symbol}|${p.sessionDate}`); assert(source);
        if (p.bar) { for (const key of ['open', 'high', 'low', 'close', 'volumeShares']) assert.deepEqual(p.bar[key], source.bar[key]); }
        else assert.equal(source.bar, null);
        readiness[p.reason ?? 'ready'] = (readiness[p.reason ?? 'ready'] ?? 0) + 1; pointCount++; }
    }
    const scenarios = [], network = [];
    for (const mode of ['pattern-complete', 'next-session-breakout']) {
      const c = { ...structuredClone(DEFAULT_CRITERIA_V7), bollSqueezeStages: structuredClone(DEFAULT_BOLLINGER_SQUEEZE),
        candlestickReversal: { ...structuredClone(DEFAULT_CANDLESTICK_REVERSAL), enabled: true, mode } };
      for (const [key, branch] of Object.entries(c)) if (key !== 'candlestickReversal' && branch && typeof branch === 'object' && 'enabled' in branch) branch.enabled = false;
      const expected = new Map(stocks.map(r => [r.symbol, independentPatterns(r.history, c.candlestickReversal)]));
      const counts = { total: stocks.length, pass: 0, fail: 0, unknown: 0 }, byPattern = {}, examples = {}, unknownReasons = {};
      for (const r of stocks) { const result = expected.get(r.symbol); counts[result.verdict]++; for (const hit of result.hits) { byPattern[hit] = (byPattern[hit] ?? 0) + 1;
        examples[hit] ??= { symbol: r.symbol, name: r.name }; } }
      for (const state of ['pass', 'fail', 'unknown']) {
        const seen = []; let cursor = null;
        do {
          const q = new URLSearchParams({ version: '9', criteria: JSON.stringify(c), sort: 'code', direction: 'asc', resultState: state, limit: '100', snapshotId: head.snapshot_id,
            ...(cursor ? { cursor } : {}) });
          const start = performance.now(), response = await fetch(`${origin}/api/stock-screener/results?${q}`, { signal: AbortSignal.timeout(30000) });
          network.push({ mode, resultState: state, method: 'GET', path: '/api/stock-screener/results', status: response.status, elapsedMs: Math.round(performance.now() - start) });
          assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.state, 'ready'); assert.equal(result.canUseResults, true);
          assert.equal(result.snapshotId, head.snapshot_id); assert.equal(result.rowsHash, m.rowsHash); assert.equal(result.calendarHash, m.calendarHash);
          assert.deepEqual(result.counts, counts); assert.equal(result.filteredCount, counts[state]);
          for (const row of result.rows) { const e = expected.get(row.symbol); assert(e); assert.equal(row.verdict, state); assert.equal(e.verdict, state);
            assert.equal(row.history.evidenceHash, histories[stocks.findIndex(s => s.symbol === row.symbol)].evidenceHash);
            assert.deepEqual(row.outcome.matches.map(({ pattern, subtype, verdict }) => ({ pattern, subtype, verdict })), e.matches);
            assert.deepEqual(row.outcome.hits.map(h => h.pattern), e.hits); seen.push(row.symbol);
            if (state === 'unknown') for (const reason of new Set(row.outcome.matches.flatMap(m => m.reasons))) unknownReasons[reason] = (unknownReasons[reason] ?? 0) + 1; }
          cursor = result.nextCursor;
        } while (cursor);
        const wanted = stocks.filter(r => expected.get(r.symbol).verdict === state).sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : a.symbol.localeCompare(b.symbol)).map(r => r.symbol);
        assert.deepEqual(seen, wanted); assert.equal(new Set(seen).size, seen.length);
      }
      scenarios.push({ mode, counts, byPattern, examples, unknownReasons });
    }
    return { checkedAt: new Date().toISOString(), snapshotId: head.snapshot_id, publishedAt: head.updated_at, effectiveSessionDate: m.effectiveSessionDate,
      rowsHash: m.rowsHash, universeHash: m.universeHash, calendarHash: m.calendarHash, historyDays: sessions.length, first: sessions[0], last: sessions.at(-1),
      marketDateManifests: m.sourceEvidence.selections.length, pointCount, readiness, scenarios, network,
      limitations: ['此獨立重算涵蓋五種預設與兩種模式；可選量能／位置邊界另由 focused tests 驗證', '凍結未還原 OHLC 未附完整價格事件清單，不宣稱已排除所有除權息', '此 HTTP 稽核不是瀏覽器操作 network counts'] };
  } finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert(process.argv[2]); console.log(JSON.stringify(await auditCandlestickPublication(process.argv[2]), null, 2));
}
