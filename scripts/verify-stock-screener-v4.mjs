#!/usr/bin/env node
/** 本機 v4 獨立重算與 API 全分頁 verifier；只讀 DB，不呼叫 provider、broker、DDL 或背景派送。 */
import { pathToFileURL } from 'node:url';
import { ScreenerSqlite } from './stock-screener-sqlite.mjs';
import { readScreenerV4Snapshot } from '../apps/multiview/worker/stock-screener-v4-repository.ts';
import { handleStockScreener } from '../apps/multiview/worker/stock-screener-route.ts';
import { buildDivergenceMatrix, buildMaFeatures, evaluateMaCriteria, selectStoredDivergence } from '../src/lib/stock-screener-v4.ts';
import { technicalEvidenceHash } from '../src/lib/stock-screener-technical-patterns.ts';

const maModes = ['bullish-preparation', 'golden-cross', 'bearish-preparation', 'death-cross', 'any-bullish', 'any-bearish'];
const sources = ['obv', 'rsi5', 'rsi10', 'kd-k', 'macd-line', 'macd-histogram'];
const directions = ['bullish', 'bearish'];

async function allRows(db, snapshotId, params) {
    let cursor = null, rows = [], firstCounts = null;
    do {
        const search = new URLSearchParams({ version: '4', volume: 'false', holder: 'false', fractal: 'false', bollReversal: 'false',
            sort: 'code', direction: 'asc', resultState: params.resultState, limit: '100', ...params });
        if (cursor) search.set('cursor', cursor);
        const response = await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?${search}`),
            { DB: db, DEPLOYMENT_TARGET: 'local' }, new Date('2000-01-01T00:00:00Z'));
        if (response.status !== 200) throw new Error('v4_api_failed');
        const payload = await response.json();
        if (payload.version !== 4 || payload.snapshotId !== snapshotId || payload.state === 'pending'
            || payload.counts.matched + payload.counts.notMatched + payload.counts.unknown !== payload.counts.total) throw new Error('v4_api_invariant_failed');
        firstCounts ??= payload.counts; rows.push(...payload.rows); cursor = payload.nextCursor;
    } while (cursor);
    const expected = params.resultState === 'pass' ? firstCounts.matched
        : params.resultState === 'fail' ? firstCounts.notMatched : firstCounts.unknown;
    if (rows.length !== expected || new Set(rows.map((row) => row.symbol)).size !== rows.length
        || rows.some((row) => row.verdict !== params.resultState)) throw new Error('v4_api_pagination_mismatch');
    return { rows, counts: firstCounts };
}

function assertSetEqual(actual, expected) {
    const left = actual.map((row) => row.symbol).sort(), right = [...expected].sort();
    if (left.length !== right.length || left.some((symbol, index) => symbol !== right[index])) {
        throw new Error('v4_api_recompute_mismatch');
    }
}

export async function verifyStockScreenerV4(db) {
    const snapshot = await readScreenerV4Snapshot(db);
    if (!snapshot) throw new Error('v4_snapshot_pending');
    const sessions = snapshot.metadata.technicalAnchors.sessions;
    const raw = (await db.prepare(`SELECT symbol,data_date,open,high,low,close,volume_shares FROM screener_daily_ohlcv WHERE validation='canonical-complete-v2' AND volume_unit='shares' AND volume_mapping_version='official-daily-ohlcv-v2' AND data_date IN (${sessions.map(() => '?').join(',')}) ORDER BY symbol,data_date`).bind(...sessions).all()).results ?? [];
    const bySymbol = new Map();
    for (const row of raw) { const values = bySymbol.get(row.symbol) ?? []; values.push({ sessionDate: row.data_date,
        open: row.open, high: row.high, low: row.low, close: row.close, volumeShares: row.volume_shares }); bySymbol.set(row.symbol, values); }
    let hashes = 0, unknown = 0;
    for (const input of snapshot.inputs) {
        const eligible = sessions.filter((date) => !input.listingDate || date >= input.listingDate);
        const bars = (bySymbol.get(input.symbol) ?? []).filter((bar) => eligible.includes(bar.sessionDate));
        const evidence = { ma: buildMaFeatures(bars, eligible), divergence: buildDivergenceMatrix(bars, eligible) };
        if (await technicalEvidenceHash(evidence) !== input.technicalV4.evidenceHash) throw new Error('v4_evidence_hash_mismatch');
        hashes++; if (evidence.ma.verdict === 'unknown') unknown++;
    }
    const matrix = [];
    for (const mode of maModes) for (const resultState of ['pass', 'fail', 'unknown']) {
        const result = await allRows(db, snapshot.id, { ma: 'true', maMode: mode, compressionDays: '3', maxSpreadPct: '1', divergence: 'false', resultState });
        const expected = snapshot.inputs.filter((input) => evaluateMaCriteria(input.technicalV4.ma,
            { enabled: true, mode, compressionDays: 3, maxSpreadPct: '1' }).verdict === resultState).map((input) => input.symbol);
        assertSetEqual(result.rows, expected);
        matrix.push({ branch: `ma:${mode}`, resultState, rows: result.rows.length, counts: result.counts });
    }
    for (const source of sources) for (const direction of directions) for (const reset of source === 'macd-histogram' ? ['false', 'true'] : ['false']) {
        for (const resultState of ['pass', 'fail', 'unknown']) {
            const result = await allRows(db, snapshot.id, { ma: 'false', divergence: 'true', divergenceSource: source,
                divergenceDirection: direction, requireZeroReset: reset, resultState });
            const expected = snapshot.inputs.filter((input) => selectStoredDivergence(input.technicalV4.divergence,
                { enabled: true, source, direction, requireZeroReset: reset === 'true' }).verdict === resultState).map((input) => input.symbol);
            assertSetEqual(result.rows, expected);
            matrix.push({ branch: `divergence:${source}:${direction}:${reset}`, resultState, rows: result.rows.length, counts: result.counts });
        }
    }
    return { state: 'verified', snapshotId: snapshot.id, universeRevision: snapshot.metadata.universeRevision,
        effectiveSessionDate: snapshot.metadata.effectiveSessionDate, sessions: sessions.length, canonicalRows: raw.length,
        evidenceHashes: hashes, maUnknown: unknown, matrix };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const database = process.argv.slice(2).find((arg) => arg.startsWith('--database='))?.slice(11);
    if (!database || process.argv.slice(2).some((arg) => !/^--database=\/.+$/.test(arg))) throw new Error('使用方式：--database=/absolute/local.sqlite');
    let db;
    try { db = new ScreenerSqlite(database); console.log(JSON.stringify(await verifyStockScreenerV4(db))); }
    catch (error) { console.error(JSON.stringify({ state: 'failed', reason: error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : 'v4_verification_failed' })); process.exitCode = 1; }
    finally { db?.close(); }
}
