import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { baselineCalendar, verifyDirect160HistoricalSymbol, createDirect160BaselineSet } from './direct-160-baseline.mjs';
import { validateTieredCohortManifest } from './tiered-capacity-stage-artifacts.mjs';
import { writeDirect160Artifact } from './direct-160-storage.mjs';

export async function buildDirect160Baseline({ sourceDirectory, outputDirectory, manifestPath, targetTradeDate, verifiedAt = new Date().toISOString() }) {
    const read = async name => JSON.parse(await readFile(path.join(sourceDirectory, name), 'utf8'));
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!validateTieredCohortManifest(manifest).valid || manifest.stage !== 160) throw new Error('invalid_cohort');
    const source = await read('source.json');
    if (source.simulation !== true || source.cohortHash !== manifest.manifestHash) throw new Error('source_identity_mismatch');
    const calendar = baselineCalendar(await read('twse-calendar.json'), await read('tpex-calendar.json'),
        source.tradeDate, targetTradeDate, Date.parse(verifiedAt));
    await mkdir(outputDirectory, { recursive: false, mode: 0o700 });
    const results = [], manifests = [];
    for (const entry of manifest.cohort) {
        const code = entry.contractIdentity.code;
        try {
            const input = { entry, cohortHash: manifest.manifestHash, calendar,
                contract: await read(`${code}.contract.json`), first: await read(`${code}.kbars-1.json`),
                second: await read(`${code}.kbars-2.json`), ticks: await read(`${code}.ticks.json`),
                sourceVersion: `shioaji-http/${source.version}`, now: verifiedAt };
            const verified = verifyDirect160HistoricalSymbol(input);
            // 原始價格與契約比例含小數；證據 canonical 僅接受整數，不能套用於原始 JSON。
            const sourceInputJsonSha256 = createHash('sha256').update(JSON.stringify(input)).digest('hex');
            const receipt = await writeDirect160Artifact(path.join(outputDirectory, `${code}.baseline.json`), verified, 'session');
            manifests.push(verified);
            results.push({ symbol: entry.canonicalSymbol, verified: true, minuteCount: verified.cumulativeSeries.length,
                finalCumulativeVolume: verified.cumulativeSeries.at(-1).cumulativeVolume,
                manifestId: verified.manifestId, fileSha256: receipt.sha256,
                sourceInputJsonSha256 });
        } catch (error) {
            results.push({ symbol: entry.canonicalSymbol, verified: false, reason: error.message });
        }
    }
    let bundle = null;
    if (manifests.length === 160) {
        const value = createDirect160BaselineSet({ manifest, calendar, manifests, createdAt: verifiedAt });
        bundle = await writeDirect160Artifact(path.join(outputDirectory, 'baseline-set.json'), value, 'bundle');
    }
    const report = { previousTradeDate: source.tradeDate, targetTradeDate, manifestHash: manifest.manifestHash,
        sourceDirectory, outputDirectory, verifiedCount: manifests.length, expectedCount: 160,
        minuteCount: manifests.length * 270, baselineUsable: manifests.length === 160,
        liveCaptureAcceptance: false, comparisonSource: '1m_kbar_cumulative_volume',
        createdAt: verifiedAt, calendarSourceVersion: calendar.sourceVersion, bundle, results };
    await writeDirect160Artifact(path.join(outputDirectory, 'verification.json'), report, 'session');
    return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const arg = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
    if (!process.argv.includes('--execute')) throw new Error('--execute required');
    const report = await buildDirect160Baseline({ sourceDirectory: arg('source'), outputDirectory: arg('output'),
        manifestPath: arg('manifest'), targetTradeDate: arg('target-date') });
    console.log(JSON.stringify({ verifiedCount: report.verifiedCount, baselineUsable: report.baselineUsable,
        failed: report.results.filter(r => !r.verified) }));
    if (!report.baselineUsable) process.exitCode = 1;
}
