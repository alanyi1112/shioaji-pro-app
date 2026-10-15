import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';

const schemaVersion = 'intraday-monitor-daily-tail-reconciliation/1';
const symbolPattern = /^\d{4,6}[A-Z]?\.TW(?:O)?$/;

function digest(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

// Local, post-close evidence only. Never inserts an observation or a trigger,
// and never upgrades an absent KBar into a live-delivered event.
export async function reconcileDailyMinuteVolumeTail({ root, sourceTradeDate,
    targetTradeDate, collectionReceipt, now = () => new Date().toISOString() } = {}) {
    if (!path.isAbsolute(root ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(sourceTradeDate ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(targetTradeDate ?? '') ||
        typeof now !== 'function') throw new TypeError('daily_tail_reconciliation_inputs_invalid');
    if (collectionReceipt?.outcome !== 'complete' ||
        collectionReceipt.sourceDate !== sourceTradeDate ||
        collectionReceipt.targetDate !== targetTradeDate ||
        collectionReceipt.readyCount !== 160 || collectionReceipt.waitingCount !== 0 ||
        !Array.isArray(collectionReceipt.results) || collectionReceipt.results.length !== 160 ||
        collectionReceipt.results.some(row => row.state !== 'ready' || !symbolPattern.test(row.symbol))) {
        return { state: 'baseline_not_complete' };
    }

    const directory = path.join(root, 'IntradayMonitor', 'daily-run', sourceTradeDate);
    const summaryPath = path.join(directory, 'summary.json');
    let serializedSummary;
    try { serializedSummary = await readFile(summaryPath, 'utf8'); }
    catch (error) {
        if (error?.code === 'ENOENT') return { state: 'live_summary_missing' };
        throw error;
    }
    const summary = JSON.parse(serializedSummary);
    if (summary.runtimeMode !== 'daily' || summary.tradeDate !== sourceTradeDate ||
        summary.connectionGeneration !== collectionReceipt.connectionGeneration ||
        !['ended', 'partial'].includes(summary.executionOutcome) ||
        !Array.isArray(summary.liveCoverageBySymbol) || summary.liveCoverageBySymbol.length !== 160 ||
        new Set(summary.liveCoverageBySymbol.map(row => row.canonicalSymbol)).size !== 160 ||
        summary.stream?.disconnect || summary.resources?.resourceFault) {
        return { state: 'live_identity_or_integrity_unverified' };
    }
    const missing = summary.liveCoverageBySymbol.filter(row => row.state !== 'complete');
    if (missing.length === 0) return { state: 'live_complete_no_reconciliation_needed' };
    if (missing.length > 4 || missing.some(row => !symbolPattern.test(row.canonicalSymbol) ||
        ![268, 269].includes(row.observationCount) ||
        row.lastMinute !== (row.observationCount === 268 ? '13:28' : '13:29') ||
        row.reason !== 'close_minute_missing') ||
        summary.liveCoverageBySymbol.some(row => row.state === 'complete' &&
            (row.observationCount !== 270 || row.lastMinute !== '13:30'))) {
        return { state: 'non_tail_or_unverified_live_gap' };
    }
    const ready = new Map(collectionReceipt.results.map(row => [row.symbol, row]));
    if (ready.size !== 160 || summary.liveCoverageBySymbol.some(row => !ready.has(row.canonicalSymbol))) {
        return { state: 'cohort_mismatch' };
    }

    const liveDb = new DatabaseSync(path.join(root, 'IntradayMonitor',
        'intraday-monitor-evidence.sqlite3'), { readOnly: true });
    const baselineDb = new DatabaseSync(path.join(root, 'IntradayMonitor',
        'daily-minute-volume-baselines.sqlite3'), { readOnly: true });
    let rows;
    try {
        rows = missing.map(row => {
            const symbol = row.canonicalSymbol;
            const live = liveDb.prepare(`SELECT COUNT(*) AS count, MAX(minute_key) AS last_minute,
                MAX(cumulative_volume) AS last_volume FROM intraday_monitor_observations
                WHERE trade_date=? AND canonical_symbol=?`).get(sourceTradeDate, symbol);
            const saved = baselineDb.prepare(`SELECT manifest_id, manifest_json
                FROM daily_baseline_manifests WHERE source_date=? AND target_date=? AND symbol=?`)
                .get(sourceTradeDate, targetTradeDate, symbol);
            if (!saved || saved.manifest_id !== ready.get(symbol).manifestId ||
                live?.count !== row.observationCount || live.last_minute !== row.lastMinute) return null;
            const manifest = JSON.parse(saved.manifest_json);
            const series = manifest.cumulativeSeries;
            const before = series?.[row.observationCount - 1];
            const verifiedTail = series?.slice(row.observationCount);
            const expectedTail = row.observationCount === 268 ? ['13:29', '13:30'] : ['13:30'];
            if (manifest.baselineUsable !== true || manifest.tradeDate !== sourceTradeDate ||
                manifest.targetTradeDate !== targetTradeDate || manifest.symbol !== symbol ||
                manifest.source !== 'shioaji-http-historical-kbars' ||
                series?.length !== 270 || before?.minuteKey !== row.lastMinute ||
                before.cumulativeVolume !== live.last_volume ||
                verifiedTail?.length !== expectedTail.length ||
                verifiedTail.some((item, index) => item.minuteKey !== expectedTail[index] ||
                    !Number.isSafeInteger(item.cumulativeVolume) ||
                    item.cumulativeVolume < (index === 0 ? before.cumulativeVolume :
                        verifiedTail[index - 1].cumulativeVolume)) ||
                !['normal_or_revised_13_30', 'delayed_13_33'].includes(manifest.closeMode)) return null;
            const tail = verifiedTail.map((item, index) => ({ minuteKey: item.minuteKey,
                cumulativeVolume: item.cumulativeVolume,
                minuteVolume: item.cumulativeVolume - (index === 0 ? before.cumulativeVolume :
                    verifiedTail[index - 1].cumulativeVolume), provenance: item.provenance,
                liveDelivered: false, notificationAuthority: false }));
            const close = tail.at(-1);
            return { canonicalSymbol: symbol, lastLiveMinute: row.lastMinute,
                lastLiveCumulativeVolume: live.last_volume,
                verifiedTail: tail, verifiedCloseMinute: close.minuteKey,
                verifiedCloseCumulativeVolume: close.cumulativeVolume,
                verifiedCloseMinuteVolume: close.minuteVolume,
                closeMode: manifest.closeMode, manifestId: saved.manifest_id,
                source: manifest.source, sourceVersion: manifest.sourceVersion,
                liveDelivered: false, notificationAuthority: false };
        });
    } finally { liveDb.close(); baselineDb.close(); }
    if (rows.some(row => row === null)) return { state: 'tail_overlap_or_source_unverified' };
    rows = rows.sort((a, b) => a.canonicalSymbol.localeCompare(b.canonicalSymbol));
    const { alreadyPresent: _alreadyPresent, tailReconciliation: _tailReconciliation,
        ...stableCollectionReceipt } = collectionReceipt;
    const artifact = { schemaVersion, sourceTradeDate, targetTradeDate,
        verifiedAt: now(), liveSummaryHash: digest(serializedSummary),
        collectionReceiptHash: digest(JSON.stringify(stableCollectionReceipt)),
        state: 'postclose_verified_live_partial', rows,
        liveAcceptance: false, retroactiveTriggerEligible: false,
        notificationAuthority: false, brokerWriteAuthority: false };
    const file = path.join(directory, 'postclose-tail-reconciliation.json');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let handle;
    try {
        handle = await open(file, 'wx', 0o600);
        await handle.writeFile(`${JSON.stringify(artifact)}\n`);
        await handle.sync();
    } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const existing = JSON.parse(await readFile(file, 'utf8'));
        if (existing.schemaVersion !== schemaVersion ||
            existing.liveSummaryHash !== artifact.liveSummaryHash ||
            existing.collectionReceiptHash !== artifact.collectionReceiptHash ||
            JSON.stringify(existing.rows) !== JSON.stringify(rows)) {
            throw new Error('daily_tail_reconciliation_conflict');
        }
        return { state: existing.state, file, alreadyPresent: true, rows: existing.rows };
    } finally { await handle?.close(); }
    return { state: artifact.state, file, alreadyPresent: false, rows };
}
