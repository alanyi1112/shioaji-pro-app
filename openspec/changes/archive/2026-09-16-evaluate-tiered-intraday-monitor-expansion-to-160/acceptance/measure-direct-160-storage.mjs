import { readFile, mkdir, stat, statfs } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { DIRECT_160_STORAGE, canonicalDirect160, hashDirect160, writeDirect160Artifact } from '../../../../scripts/intraday-monitor-runtime/direct-160-storage.mjs';
import { validateIntradayMonitorBoundedKbarCapture } from '../../../../scripts/intraday-monitor-runtime/pilot-acceptance-bundle.mjs';

const arg = (key) => process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
if (!process.argv.includes('--execute')) throw new Error('requires --execute; offline only');
const outputDirectory = arg('output-dir');
if (!outputDirectory || !path.isAbsolute(outputDirectory)) throw new Error('absolute --output-dir required');
const plan = JSON.parse(await readFile(arg('plan'), 'utf8'));
const sources = await Promise.all(['baseline', 'capture'].map(async (key) => {
    const sourcePath = arg(key);
    const bytes = await readFile(sourcePath);
    const capture = JSON.parse(bytes);
    if (!validateIntradayMonitorBoundedKbarCapture(capture, plan).valid) throw new Error(`invalid ${key}`);
    return { capture, sourcePath, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}));
if (sources[0].capture.session.tradeDate >= sources[1].capture.session.tradeDate) throw new Error('ordered distinct source days required');
// 建立獨立目錄，任何既有路徑都拒絕覆寫；本工具不接觸網路或 live service。
await mkdir(outputDirectory, { recursive: false });
const started = performance.now();
const cpuBefore = process.cpuUsage();
const sessions = sources.map(({ capture }) => ({
    schemaVersion: 'intraday-monitor-direct-160-synthetic-session/1',
    evidenceClass: 'synthetic_load_only',
    tradeDate: capture.session.tradeDate,
    symbols: Array.from({ length: 160 }, (_, index) => {
        const source = capture.session.symbols[index % capture.session.symbols.length];
        const canonicalSymbol = `SYNTHETIC_${String(index).padStart(3, '0')}`;
        return { canonicalSymbol, sourceSymbol: source.canonicalSymbol, closeMode: source.closeMode,
            rows: source.rows.map((row) => ({ ...row, canonicalSymbol })) };
    }),
}));
const sessionMetrics = [];
for (const [index, session] of sessions.entries()) {
    const canonicalBytes = Buffer.byteLength(canonicalDirect160(session, 'session'));
    const receipt = await writeDirect160Artifact(path.join(outputDirectory, `synthetic-day-${index + 1}.json`), session, 'capture');
    const readback = JSON.parse(await readFile(receipt.outputPath, 'utf8'));
    const digest = hashDirect160(session, 'session');
    if (hashDirect160(readback, 'session') !== digest) throw new Error('session readback hash mismatch');
    sessionMetrics.push({ canonicalBytes, prettyBytes: Buffer.byteLength(JSON.stringify(session, null, 2)), hash: digest, receipt });
}

function replay() {
    const events = [];
    let comparisons = 0;
    for (let index = 0; index < 160; index += 1) {
        let latched = false;
        const previous = sessions[0].symbols[index].rows;
        const current = sessions[1].symbols[index].rows;
        for (let minute = 0; minute < 270; minute += 1) {
            comparisons += 1;
            // 包含實際事件序列化與解析成本；synthetic 結果絕不升格為 live。
            const row = JSON.parse(JSON.stringify(current[minute]));
            const baseline = previous[minute];
            if (row.minuteKey !== baseline.minuteKey) throw new Error('minute alignment mismatch');
            if (!latched && baseline.cumulativeVolume > 0 && row.cumulativeVolume >= 2 * baseline.cumulativeVolume) {
                latched = true;
                events.push({ symbol: row.canonicalSymbol, minute: row.minuteKey, today: row.cumulativeVolume, baseline: baseline.cumulativeVolume });
            }
        }
    }
    return { comparisons, events, hash: hashDirect160(events, 'session') };
}
const first = replay();
const second = replay();
if (first.hash !== second.hash) throw new Error('replay mismatch');
const bundle = { schemaVersion: 'intraday-monitor-direct-160-synthetic-bundle/1', evidenceClass: 'synthetic_load_only', sessions, replay: first };
const bundleBytes = Buffer.byteLength(canonicalDirect160(bundle, 'bundle'));
const bundleReceipt = await writeDirect160Artifact(path.join(outputDirectory, 'synthetic-bundle.json'), bundle, 'bundle');
if (hashDirect160(JSON.parse(await readFile(bundleReceipt.outputPath, 'utf8')), 'bundle') !== hashDirect160(bundle, 'bundle')) throw new Error('bundle readback mismatch');

const databasePath = path.join(outputDirectory, 'offline-load.sqlite3');
const database = new DatabaseSync(databasePath);
database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
CREATE TABLE minute_evidence (
  trade_date TEXT NOT NULL,
  canonical_symbol TEXT NOT NULL,
  minute_key TEXT NOT NULL,
  cumulative_volume INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (trade_date, canonical_symbol, minute_key)
) STRICT;`);
const insert = database.prepare(`INSERT INTO minute_evidence
    (trade_date, canonical_symbol, minute_key, cumulative_volume, sequence, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)`);
const databaseStarted = performance.now();
database.exec('BEGIN IMMEDIATE;');
try {
    for (const session of sessions) for (const symbol of session.symbols) for (const row of symbol.rows) {
        insert.run(session.tradeDate, symbol.canonicalSymbol, row.minuteKey,
            row.cumulativeVolume, row.sequence, JSON.stringify(row));
    }
    database.exec('COMMIT;');
} catch (error) { database.exec('ROLLBACK;'); throw error; }
const databaseRowCount = Number(database.prepare('SELECT COUNT(*) AS count FROM minute_evidence').get().count);
const perDayCounts = database.prepare('SELECT trade_date, COUNT(*) AS count FROM minute_evidence GROUP BY trade_date ORDER BY trade_date').all();
const databaseWriteMs = performance.now() - databaseStarted;
const walPath = `${databasePath}-wal`;
const size = async (file) => (await stat(file).catch(() => ({ size: 0 }))).size;
const databaseBytes = await size(databasePath);
const walPeakBytes = await size(walPath);
database.exec('PRAGMA wal_checkpoint(FULL);');
database.exec('PRAGMA wal_checkpoint(TRUNCATE);');
database.close();
const walFinalBytes = await size(walPath);

const uiItems = sessions[1].symbols.map((symbol, index) => ({
    symbol: symbol.canonicalSymbol,
    sourceSymbol: symbol.sourceSymbol,
    ratio: symbol.rows.at(-1).cumulativeVolume / Math.max(1, sessions[0].symbols[index].rows.at(-1).cumulativeVolume),
    minuteKey: symbol.rows.at(-1).minuteKey,
}));
const uiLatenciesMs = [];
for (let run = 0; run < 100; run += 1) {
    const uiStarted = performance.now();
    const ordered = [...uiItems].sort((left, right) => right.ratio - left.ratio || left.symbol.localeCompare(right.symbol));
    const searched = ordered.filter((item) => item.symbol.includes(String(run % 10)) || item.sourceSymbol.includes(String(run % 10)));
    const selected = ordered[(run * 17) % ordered.length];
    if (!selected || searched.length < 1) throw new Error('offline UI fixture interaction failed');
    uiLatenciesMs.push(performance.now() - uiStarted);
}
const orderedUiLatencies = [...uiLatenciesMs].sort((left, right) => left - right);
const uiP95Ms = orderedUiLatencies[Math.ceil(orderedUiLatencies.length * 0.95) - 1];
const cpu = process.cpuUsage(cpuBefore);
const disk = await statfs(outputDirectory);
const report = {
    schemaVersion: 'intraday-monitor-direct-160-storage-measurement/2', evidenceClass: 'synthetic_load_only',
    assessedAt: new Date().toISOString(), sourceFiles: sources.map(({ sourcePath, bytes, sha256 }) => ({ sourcePath, bytes, sha256 })),
    targetCount: 160, minutesPerDay: 43_200, completeSyntheticDays: 2,
    sessions: sessionMetrics, bundleBytes, bundleReceipt,
    replay: { runs: 2, consistent: true, minuteComparisonsPerRun: first.comparisons, triggerCount: first.events.length, outputHash: first.hash },
    database: { rowCount: databaseRowCount, expectedRowCount: 86_400,
        perDayCounts: perDayCounts.map((row) => ({ tradeDate: row.trade_date, count: Number(row.count) })),
        writeMicros: Math.round(databaseWriteMs * 1000), databaseBytes, walPeakBytes, walFinalBytes,
        peakWorkingBytes: databaseBytes + walPeakBytes, growthBytes: databaseBytes + walFinalBytes,
        journalMode: 'wal', synchronous: 'full' },
    ui: { itemCount: uiItems.length, interactionRuns: uiLatenciesMs.length,
        p95Micros: Math.round(uiP95Ms * 1000),
        maxMicros: Math.round(Math.max(...uiLatenciesMs) * 1000),
        operations: ['ratio_sort', 'symbol_search', 'selection'] },
    resources: { elapsedMs: Math.round(performance.now() - started), cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system,
        peakRssBytes: process.resourceUsage().maxRSS * 1024, currentRssBytes: process.memoryUsage.rss(),
        availableDiskBytes: disk.bavail * disk.bsize, actualFileBytes: (await Promise.all([...sessionMetrics.map((s) => s.receipt.outputPath), bundleReceipt.outputPath].map(async (p) => (await stat(p)).size))).reduce((a, b) => a + b, 0) },
    limits: DIRECT_160_STORAGE,
    budgetModel: { capturesAndAtomicTemporaryBytes: 4 * DIRECT_160_STORAGE.captureOutputBytes,
        bundleAndTemporaryBytes: 2 * DIRECT_160_STORAGE.bundleOutputBytes,
        fixturesAndTemporaryBytes: 2 * DIRECT_160_STORAGE.offlineFixtureBytes,
        logsAndMetadataBytes: 64 * 1024 * 1024,
        databaseAndWalReserveBytes: 64 * 1024 * 1024,
        totalWorstCaseWorkingBytes: 896 * 1024 * 1024,
        minimumFreeBytes: DIRECT_160_STORAGE.minimumAvailableDiskBytes },
    limitations: ['NOT_LIVE_CAPACITY_EVIDENCE', 'NO_PROVIDER_SUBSCRIPTION', 'NO_SUSTAINED_LIVE_MEMORY_MEASUREMENT'],
};
if (databaseRowCount !== 86_400 || perDayCounts.some((row) => Number(row.count) !== 43_200) ||
    databaseBytes + walFinalBytes > plan.resourceBudgets.maxDatabaseGrowthBytes ||
    databaseBytes + walPeakBytes > 64 * 1024 * 1024 || uiP95Ms > 100) throw new Error('direct 160 DB/UI load gate failed');
await writeDirect160Artifact(path.join(outputDirectory, 'measurement.json'), report, 'capture');
console.log(JSON.stringify(report, null, 2));
