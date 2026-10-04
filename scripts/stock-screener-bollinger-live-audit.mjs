/** 真實發布唯讀稽核；不匯入產品策略公式、不抓來源、不寫 DB。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const stable = v => v === undefined ? 'null' : Array.isArray(v) ? `[${v.map(stable)}]`
    : v && typeof v === 'object' ? `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}` : JSON.stringify(v);
const sha = s => createHash('sha256').update(s).digest('hex');
const hash = v => sha(stable(v));
const all = vs => vs.includes(false) ? false : vs.every(v => v === true) ? true : null;
const any = vs => vs.includes(true) ? true : vs.every(v => v === false) ? false : null;
const test = (vs, fn) => vs.some(v => v === null) ? null : fn(...vs);
const sum = (xs, end, days, exact = false) => {
    const window = xs.slice(end - days + 1, end + 1);
    return end < days - 1 || window.length !== days || window.includes(null) ? null
        : window.reduce((a, b) => exact ? a + BigInt(b) : a + b, exact ? 0n : 0);
};
const mean = (xs, end, days) => { const s = sum(xs, end, days); return s === null ? null : s / days; };
const scaled = s => { const [a, b = ''] = s.split('.'); return BigInt(a) * 1000000n + BigInt(b.padEnd(6, '0')); };
const near = (a, b) => a === null || b === null ? a === b : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** 直接以原始收盤價窗口重算；不用凍結 BOLL／prefix／產品 evaluator。 */
export function independentStages(points, c) {
    const closes = points.map(p => p.close), volumes = points.map(p => p.volumeShares), amounts = points.map(p => p.turnoverNtd);
    const bands = closes.map((close, i) => {
        const m = mean(closes, i, 20);
        if (m === null) return null;
        const sd = Math.sqrt(closes.slice(i - 19, i + 1).reduce((n, v) => n + (v - m) ** 2, 0) / 20);
        const upper = m + 2 * sd, lower = m - 2 * sd, width = upper - lower;
        return { upper, middle: m, lower, bbw: width > 0 && m > 0 ? width / m : null,
            b: width > 0 ? (close - lower) / width : null };
    });
    const widths = bands.map(b => b?.bbw ?? null);
    const setup = t => {
        const close = closes[t] ?? null, band = bands[t], width = widths[t] ?? null;
        const fast = mean(closes, t, c.fastMaDays), slow = mean(closes, t, c.slowMaDays);
        const oldSlow = mean(closes, t - c.trendLag, c.slowMaDays), oldClose = closes[t - c.momentumDays] ?? null;
        const amt = sum(amounts, t, c.turnoverDays, true);
        const gate = all([test([close], v => v >= c.minimumPrice), test([amt], v => v >= BigInt(c.minimumAverageTurnoverNtd) * BigInt(c.turnoverDays)),
            test([close, fast], (a, b) => a > b), test([fast, slow], (a, b) => a > b),
            test([slow, oldSlow], (a, b) => a >= b), test([close, oldClose], (a, b) => a / b - 1 > 0)]);
        const prior = widths.slice(Math.max(0, t - c.lookbackDays), t);
        let q = null;
        if (t >= c.lookbackDays && prior.length === c.lookbackDays && !prior.includes(null)) {
            const ordered = [...prior].sort((a, b) => a - b), h = (ordered.length - 1) * c.percentile / 100;
            q = ordered[Math.floor(h)] + (ordered[Math.ceil(h)] - ordered[Math.floor(h)]) * (h - Math.floor(h));
        }
        const vs = sum(volumes, t, c.volumeShortDays, true), vl = sum(volumes, t, c.volumeLongDays, true);
        const compression = all([test([width, q], (a, b) => a <= b), test([width, widths[t - c.bbwLag] ?? null], (a, b) => a < b),
            test([mean(widths, t, c.bbwShortDays), mean(widths, t, c.bbwLongDays)], (a, b) => a < b),
            test([band?.b ?? null], b => b >= c.bMinimum && b <= 1),
            test([vs, vl], (a, b) => a * BigInt(c.volumeLongDays) * 1000000n < b * BigInt(c.volumeShortDays) * scaled(c.contractionRatio))]);
        return { gate, verdict: all([gate, compression]), b: band?.b ?? null, q };
    };
    const t = closes.length - 1, current = setup(t), recent = Array.from({ length: c.setupDays }, (_, i) => setup(t - 1 - i));
    const breakVolume = sum(volumes, t - 1, c.breakoutVolumeDays, true);
    const breakout = all([current.gate, any(recent.map(s => s.verdict)),
        test([closes[t], bands[t]?.upper ?? null, closes[t - 1], bands[t - 1]?.upper ?? null], (a, b, d, e) => a > b && d <= e),
        test([volumes[t], breakVolume], (a, b) => BigInt(a) * BigInt(c.breakoutVolumeDays) * 1000000n > b * scaled(c.breakoutVolumeRatio))]);
    const preparing = all([current.verdict, test([current.b], b => b >= c.preparingThreshold)]);
    let stage = 'notMatched';
    for (const [name, value] of [['breakout', breakout], ['preparing', preparing], ['compressing', current.verdict]]) {
        if (value === null) { stage = 'unknown'; break; }
        if (value) { stage = name; break; }
    }
    return { stage, bands, quantile: current.q, breakout, preparing, compressing: current.verdict };
}

export function auditPublication(path) {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
        db.exec('BEGIN');
        const head = db.prepare("SELECT * FROM screener_bollinger_head WHERE name='v8'").get();
        assert(head, 'head_missing');
        const pub = db.prepare('SELECT * FROM screener_bollinger_publications WHERE id=?').get(head.snapshot_id);
        assert.equal(pub.status, 'published');
        const m = JSON.parse(pub.metadata), sessions = m.historySessions;
        assert.equal(sessions.length, 160); assert.equal(new Set(sessions).size, 160);
        assert.equal(sessions[0], '2026-02-02'); assert(!sessions.includes('2026-07-10'));
        const stocks = db.prepare('SELECT payload FROM screener_bollinger_rows WHERE snapshot_id=? ORDER BY symbol').all(pub.id).map(r => JSON.parse(r.payload));
        assert.equal(hash(stocks), m.rowsHash); assert.equal(stocks.length, m.total);
        const selected = new Map(), rawCache = new Map(), reasons = {}, providers = {}, manifests = [];
        for (const selection of m.sourceEvidence.selections) {
            const stored = db.prepare('SELECT * FROM screener_source_selections WHERE manifest_hash=?').get(selection.manifestHash);
            assert.equal(stored.status, 'complete');
            const manifest = JSON.parse(stored.manifest), { manifestHash, ...body } = manifest;
            assert.equal(hash(body), manifestHash); assert.deepEqual(selection, manifest);
            const rows = db.prepare('SELECT payload FROM screener_source_selected_rows WHERE selection_key=? ORDER BY symbol').all(stored.selection_key).map(r => JSON.parse(r.payload));
            assert.equal(rows.length, manifest.rowCount); assert.equal(hash(rows), manifest.rowsHash);
            assert.equal(manifest.actualDate, manifest.sessionDate); assert.equal(manifest.requestedDate, manifest.sessionDate);
            assert(sessions.includes(manifest.sessionDate)); assert.equal(manifest.provider, 'shioaji-daily-quotes');
            providers[manifest.provider] = (providers[manifest.provider] ?? 0) + 1;
            let raw = rawCache.get(manifest.cacheKey);
            if (!raw) {
                const cache = db.prepare('SELECT * FROM screener_daily_quotes_cache WHERE cache_key=?').get(manifest.cacheKey);
                assert.equal(cache.status, 'complete'); assert.equal(sha(cache.response_text), manifest.payloadHash);
                // 將 JSON 數字 token 保留字串，避免 int64 經 Number 流失精度。
                const columns = JSON.parse(cache.response_text.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
                    token => token[0] === '"' ? token : JSON.stringify(token)));
                raw = new Map(columns.Code.map((code, i) => [code, Object.fromEntries(Object.keys(columns).map(k => [k, columns[k][i]]))]));
                rawCache.set(manifest.cacheKey, raw);
            }
            for (const row of rows) {
                assert.equal(row.provenance.volumeUnit, 'shares'); assert.equal(row.provenance.turnoverUnit, 'TWD');
                assert.equal(row.provenance.payloadHash, manifest.payloadHash);
                const code = row.symbol.split('.')[0], original = raw.get(code);
                if (row.sourceValues) {
                    assert(original, `raw_missing:${row.symbol}`); assert.equal(original.Date, manifest.sessionDate);
                    assert.equal(BigInt(original.Volume), BigInt(row.sourceValues.volumeShares));
                    assert.equal(BigInt(original.Amount), BigInt(row.sourceValues.turnoverNtd));
                    for (const k of ['open', 'high', 'low', 'close']) {
                        const v = original[k[0].toUpperCase() + k.slice(1)];
                        assert.equal(v === null ? null : Number(v), row.sourceValues[k] === null ? null : Number(row.sourceValues[k]));
                    }
                }
                reasons[row.readiness] = (reasons[row.readiness] ?? 0) + 1;
                selected.set(`${row.symbol}|${row.sessionDate}`, row);
            }
            manifests.push(manifestHash);
        }
        assert.equal(manifests.length, 320); assert.equal(rawCache.size, 160);
        assert.equal(hash(m.sourceEvidence.manifest), m.sourceEvidence.manifestHash);
        const empty = () => ({ total: 0, breakout: 0, preparing: 0, compressing: 0, notMatched: 0, unknown: 0 });
        const counts = { total: empty(), markets: { TWSE: empty(), TPEx: empty() } }, examples = {}, unknownReasons = {};
        const profile = JSON.parse(db.prepare('SELECT payload FROM screener_bollinger_profiles WHERE revision=?').get(m.profileRevision).payload);
        let completeStocks = 0, pointCount = 0;
        for (const row of stocks) {
            const f = row.features, { evidenceHash, ...features } = f;
            assert.equal(hash(features), evidenceHash); assert.deepEqual(f.sessions, sessions);
            const points = sessions.map((day, i) => {
                const r = selected.get(`${row.symbol}|${day}`); assert(r, `coverage_missing:${row.symbol}:${day}`);
                assert.deepEqual(row.readiness[i], { sessionDate: day, reason: r.readiness });
                const p = { sessionDate: day, close: r.bar ? Number(r.bar.close) : null,
                    volumeShares: r.bar?.volumeShares ?? null, turnoverNtd: r.bar?.turnoverNtd ?? null };
                for (const key of Object.keys(p)) assert.deepEqual(f.points[i][key], p[key]);
                pointCount++; return p;
            });
            if (row.readiness.every(r => r.reason === 'ready')) completeStocks++;
            const calc = independentStages(points, profile.criteria.bollSqueezeStages);
            assert.equal(calc.stage, row.dailyOutcome.stage, `stage:${row.symbol}`);
            for (let i = 0; i < points.length; i++) {
                const actual = f.points[i].boll, expected = calc.bands[i];
                assert.equal(actual === null, expected === null, `band_missing:${row.symbol}:${i}`);
                if (expected) for (const k of Object.keys(expected)) assert(near(actual[k], expected[k]), `band:${row.symbol}:${i}:${k}`);
            }
            for (const [key, values, exact] of [['close', points.map(p => p.close), false], ['bbw', calc.bands.map(b => b?.bbw ?? null), false],
                ['volume', points.map(p => p.volumeShares), true], ['turnover', points.map(p => p.turnoverNtd), true]]) {
                let count = 0, total = exact ? 0n : 0;
                for (let i = 0; i < values.length; i++) {
                    if (values[i] !== null) { count++; total += exact ? BigInt(values[i]) : values[i]; }
                    assert.equal(f[key].counts[i + 1], count);
                    assert(exact ? f[key].sums[i + 1] === total.toString() : near(f[key].sums[i + 1], total));
                }
            }
            const stage = calc.stage;
            counts.total.total++; counts.total[stage]++; counts.markets[row.market].total++; counts.markets[row.market][stage]++;
            if (!examples[stage]) examples[stage] = { symbol: row.symbol, market: row.market, quantile: calc.quantile,
                close: points.at(-1).close, boll: calc.bands.at(-1), readiness: row.readiness.filter(r => r.reason !== 'ready').slice(-5) };
            if (stage === 'unknown') for (const reason of new Set(row.readiness.filter(r => r.reason !== 'ready').map(r => r.reason)))
                unknownReasons[reason] = (unknownReasons[reason] ?? 0) + 1;
        }
        assert.deepEqual(counts, m.counts);
        const failed = db.prepare('SELECT id,cache_key,payload,created_at FROM screener_daily_quotes_receipts WHERE status=? AND created_at>=? AND created_at<? ORDER BY id')
            .all('failed', '2026-10-03T15:21:00.000Z', '2026-10-03T15:22:00.000Z');
        const originalFailureHash = sha(JSON.stringify(failed));
        assert.equal(failed.length, 158); assert.equal(originalFailureHash, '1fb7a9e0e0146249a0b61987fe9be6a2feedccdcd418fe6760b3584be27ab413');
        const july = db.prepare("SELECT attempts,reason,status FROM screener_daily_quotes_cache WHERE session_date='2026-07-10'").get();
        assert.equal(july.attempts, 18); assert.equal(july.reason, 'source_not_published');
        return { checkedAt: new Date().toISOString(), snapshotId: pub.id, publishedAt: head.updated_at,
            rowsHash: m.rowsHash, profileRevision: m.profileRevision, history: { days: sessions.length, first: sessions[0], last: sessions.at(-1) },
            marketDateManifests: manifests.length, dateSharedCache: rawCache.size, pointCount, completeStocks,
            readiness: reasons, counts, examples, unknownReasons, providers, originalFailureHash, originalFailureCount: failed.length,
            july10: july, sourceManifestHash: m.sourceEvidence.manifestHash,
            limitations: ['逐商品缺資料仍 unknown，日期窗口完整不代表所有商品皆 ready', '未採用官方歷史入口仍 pending；此發布全部使用已 verified Shioaji 備援',
                '數值稽核只讀保存原值，未套容差更改策略資料', '獨立數值比對容忍浮點重算誤差，但分類／股數／TWD 均嚴格相符'] };
    } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    assert(process.argv[2], 'readonly_sqlite_path_required');
    console.log(JSON.stringify(auditPublication(process.argv[2]), null, 2));
}
