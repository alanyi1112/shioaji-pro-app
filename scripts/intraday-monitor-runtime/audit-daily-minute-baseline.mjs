import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { isHistoricalKbarBaselineManifest } from './historical-kbar-repair.mjs';
import { createDailyMinuteVolumeCandidate, verifyDailyMinuteVolumeBaseline,
    DAILY_KBAR_TIMESTAMP_ENCODING } from './daily-minute-volume-baseline.mjs';

// 只讀已保存來源／舊基準／SQLite；不下載、不發布，不將歷史資料冒充新排程。
export async function auditSavedDailyMinuteBaselines({ sourceDirectory, legacyBaselinePath,
    evidenceDatabasePath = null, verifiedAt = new Date().toISOString() } = {}) {
    if (!path.isAbsolute(sourceDirectory ?? '') || !path.isAbsolute(legacyBaselinePath ?? '') ||
        (evidenceDatabasePath !== null && !path.isAbsolute(evidenceDatabasePath))) {
        throw new TypeError('daily_baseline_audit_path_invalid');
    }
    const read = async file => JSON.parse(await readFile(file, 'utf8'));
    const source = await read(path.join(sourceDirectory, 'source.json'));
    const legacy = await read(legacyBaselinePath);
    if (source.simulation !== true || !Array.isArray(legacy.manifests) ||
        legacy.calendar?.previousTradeDate !== source.tradeDate ||
        source.cohortHash !== legacy.manifestHash) throw new Error('daily_baseline_audit_source_mismatch');
    const database = evidenceDatabasePath ? new DatabaseSync(evidenceDatabasePath, { readOnly: true }) : null;
    const results = [];
    try {
        for (const prior of legacy.manifests) {
            const code = prior.symbol.split('.')[0];
            if (!/^\d{4,6}[A-Z]?$/.test(code) || !isHistoricalKbarBaselineManifest(prior)) {
                throw new Error('daily_baseline_audit_legacy_invalid');
            }
            const contract = await read(path.join(sourceDirectory, `${code}.contract.json`));
            const kbars = await read(path.join(sourceDirectory, `${code}.kbars-1.json`));
            const candidate = createDailyMinuteVolumeCandidate({ entry: { canonicalSymbol: prior.symbol,
                contractIdentity: { code, exchange: prior.exchange } }, contract, kbars,
                tradeDate: source.tradeDate, sourceVersion: `shioaji-http/${source.version}`,
                timestampEncoding: DAILY_KBAR_TIMESTAMP_ENCODING });
            const authority = { officialTradingDay: true, identityVerified: true,
                instrumentStatus: 'normal', calendarVerified: true, symbol: prior.symbol,
                exchange: prior.exchange, securityType: 'STK', timeZone: 'Asia/Taipei',
                tradeDate: source.tradeDate, previousApplicableTradeDate: source.tradeDate,
                targetTradeDate: prior.targetTradeDate, calendarSource: prior.calendarSource,
                calendarSourceVersion: prior.calendarSourceVersion };
            const result = verifyDailyMinuteVolumeBaseline({ candidate, authority, now: verifiedAt });
            let legacyDifferences = null, sqliteDifferences = null, sqliteCount = null;
            if (result.ok) {
                const rows = result.manifest.cumulativeSeries;
                legacyDifferences = rows.filter((r, i) => r.minuteKey !== prior.cumulativeSeries[i]?.minuteKey ||
                    r.cumulativeVolume !== prior.cumulativeSeries[i]?.cumulativeVolume).length;
                if (database) {
                    const saved = database.prepare(`SELECT minute_key, cumulative_volume
                        FROM intraday_monitor_observations WHERE canonical_symbol=? AND trade_date=?
                        ORDER BY minute_key`).all(prior.symbol, source.tradeDate);
                    sqliteCount = saved.length;
                    sqliteDifferences = rows.filter((r, i) => r.minuteKey !== saved[i]?.minute_key ||
                        r.cumulativeVolume !== saved[i]?.cumulative_volume).length + Math.max(0, saved.length - rows.length);
                }
            }
            results.push({ symbol: prior.symbol, exchange: prior.exchange, ok: result.ok,
                reasonCodes: result.reasonCodes ?? [], candidatePayloadHash: candidate.payloadHash,
                legacyManifestId: prior.manifestId,
                dailyManifestId: result.manifest?.manifestId ?? null,
                legacyDifferences, sqliteCount, sqliteDifferences,
                finalCumulativeVolume: result.manifest?.cumulativeSeries.at(-1).cumulativeVolume ?? null });
        }
    } finally { database?.close(); }
    return { schemaVersion: 'intraday-daily-minute-baseline-offline-audit/1',
        observedAt: verifiedAt, sourceDirectory, legacyBaselinePath, evidenceDatabasePath,
        sourceTradeDate: source.tradeDate, targetTradeDate: legacy.calendar.targetTradeDate,
        sourceVersion: source.version, sourceManifestHash: source.cohortHash,
        legacyBaselineFileSha256: createHash('sha256').update(await readFile(legacyBaselinePath)).digest('hex'),
        count: results.length, verifiedCount: results.filter(r => r.ok).length,
        legacyDifferenceCount: results.reduce((n, r) => n + (r.legacyDifferences ?? 0), 0),
        sqliteDifferenceCount: database ? results.reduce((n, r) => n + (r.sqliteDifferences ?? 0), 0) : null,
        published: false, liveAcceptance: false, networkRequests: 0,
        independentTotalCheck: 'not_observed_by_v2', results };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const arg = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
    console.log(JSON.stringify(await auditSavedDailyMinuteBaselines({ sourceDirectory: arg('source'),
        legacyBaselinePath: arg('legacy'), evidenceDatabasePath: arg('evidence') ?? null })));
}
