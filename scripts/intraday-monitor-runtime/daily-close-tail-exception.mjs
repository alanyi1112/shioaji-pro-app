import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDailyMinuteVolumeBaseline } from './daily-minute-volume-baseline.mjs';
import { expectedTaiwanRegularSessionMinutes } from './historical-kbar-repair.mjs';
import { readThresholdSwitchState } from './threshold-switch-repository.mjs';
import { thresholdConfigProof } from './threshold-switch-controller.mjs';

export const CLOSE_TAIL_POLICY = 'intraday-close-tail-exception/1';
export const CLOSE_TAIL_SCHEMA = 'intraday-close-tail-assessment/1';
export const MAX_CLOSE_TAIL_EXCEPTIONS = 10;
const minutes = expectedTaiwanRegularSessionMinutes();
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const count = value => Number.isSafeInteger(value) && value >= 0;
const thresholdValid = value => typeof value === 'string' && value.length <= 32 &&
    /^\d+(?:\.\d+)?$/.test(value) && Number(value) > 0;
function comparison(a, b, threshold) {
    if (b === 0) return 'zero_baseline';
    const [whole, fraction = ''] = threshold.split('.');
    return BigInt(a) * 10n ** BigInt(fraction.length) >= BigInt(b) * BigInt(whole + fraction)
        ? 'matched' : 'not_matched';
}
const noAuthority = { liveAcceptance: false, notificationAuthority: false,
    retroactiveTriggerEligible: false, brokerWriteAuthority: false };
const rejected = reason => ({ state: 'rejected', reason, policyVersion: CLOSE_TAIL_POLICY, ...noAuthority });
const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length &&
    new Set(b).size === b.length && a.every(v => b.includes(v));
const baselineValid = (manifest, symbol, source, target, calendarVersion) =>
    isDailyMinuteVolumeBaseline(manifest) && manifest.symbol === symbol &&
    manifest.tradeDate === source && manifest.targetTradeDate === target &&
    manifest.source === 'shioaji-http-historical-kbars' &&
    manifest.calendarReference.sourceVersion === calendarVersion;

// Pure evaluation. No download, subscription, notification or order port exists.
export function evaluateCloseTailException({ summary, session, liveRows,
    collectionReceipt, manifests, previousManifests, thresholdState } = {}) {
    const date = summary?.tradeDate;
    if (summary?.schemaVersion !== 'intraday-monitor-daily-runner/1' ||
        summary.runtimeMode !== 'daily' || typeof date !== 'string' || date < '2026-10-15' ||
        summary.executionOutcome !== 'partial' || session?.tradeDate !== date ||
        session.previousTradeDate !== summary.previousTradeDate ||
        session.connectionGeneration !== summary.connectionGeneration ||
        session.calendarAuthority?.current !== true || session.calendarAuthority.tradeDate !== date ||
        session.calendarAuthority.previousTradeDate !== session.previousTradeDate ||
        summary.planHash !== session.cohortHash) return rejected('session_or_policy_identity_unverified');
    const coverage = summary.liveCoverageBySymbol;
    if (!Array.isArray(coverage) || coverage.length !== 160 ||
        !sameSet(coverage.map(r => r.canonicalSymbol), session.itemStates?.map(r => r.canonicalSymbol) ?? []))
        return rejected('cohort_unverified');
    const missing = coverage.filter(r => r.state !== 'complete');
    if (missing.length < 1 || missing.length > MAX_CLOSE_TAIL_EXCEPTIONS ||
        missing.some(r => r.state !== 'partial' || r.observationCount !== 269 ||
            r.lastMinute !== '13:29' || r.reason !== 'close_minute_missing') ||
        coverage.filter(r => r.state === 'complete').some(r =>
            r.observationCount !== 270 || r.lastMinute !== '13:30'))
        return rejected('not_single_close_tail_within_limit');
    const t = summary.stream?.transport;
    const finalizedAt = Date.parse(summary.closeReceipt?.finalizedAt);
    if (!Number.isFinite(finalizedAt) || finalizedAt < Date.parse(`${date}T13:34:30+08:00`) ||
        summary.closeReceipt?.reason !== 'close_incomplete' ||
        summary.closeReceipt.expectedCount !== 160 || summary.closeReceipt.sealedCount !== 160 - missing.length ||
        summary.stopReceipt?.stopped !== true || summary.stopReceipt.unsubscribeAccepted !== true ||
        summary.stream?.disconnect !== null || summary.resources?.resourceFault !== null ||
        summary.health?.incidentCount !== 0 || summary.comparisonFailure !== null ||
        summary.thresholdSwitch?.journalHealthy !== true || summary.thresholdSwitch.lastFailure !== null ||
        t?.malformedFrames !== 0 || t.sourceGapEvents !== 0 ||
        t.sourceDroppedFrames !== 0 || t.sourceGapInvalid !== false ||
        t.nonKbarEventOverflow !== 0 || t.lastDisconnectReason !== null)
        return rejected('unsafe_or_unknown_close');
    const symbols = coverage.map(r => r.canonicalSymbol);
    if (!Array.isArray(liveRows) || liveRows.length !== 43200 - missing.length)
        return rejected('live_prefix_incomplete');
    const groups = new Map(symbols.map(s => [s, []]));
    for (const row of liveRows) {
        if (!groups.has(row.canonical_symbol)) return rejected('live_cohort_mismatch');
        groups.get(row.canonical_symbol).push(row);
    }
    for (const item of coverage) {
        const rows = groups.get(item.canonicalSymbol);
        if (rows.length !== item.observationCount) return rejected('live_prefix_incomplete');
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i], p = row.payload;
            if (row.minute_key !== minutes[i] || !count(row.cumulative_volume) ||
                (i > 0 && row.cumulative_volume < rows[i - 1].cumulative_volume) ||
                p?.tradeDate !== date || p.minuteKey !== row.minute_key ||
                p.contract?.canonicalSymbol !== item.canonicalSymbol ||
                p.cumulativeVolume !== row.cumulative_volume || p.unit !== 'common_lot' ||
                p.source !== 'shioaji-kbar-stream' || p.continuity !== 'complete' ||
                p.simtrade !== false || p.intradayOdd !== false ||
                p.connectionGeneration !== summary.connectionGeneration ||
                typeof p.sourceVersion !== 'string' || !p.sourceVersion ||
                p.sourceVersion !== rows[0].payload.sourceVersion)
                return rejected('live_prefix_provenance_unverified');
        }
    }
    if (collectionReceipt?.outcome !== 'complete' || collectionReceipt.readyCount !== 160 ||
        collectionReceipt.waitingCount !== 0 || collectionReceipt.conflictCount !== 0 ||
        collectionReceipt.sourceDate !== date || typeof collectionReceipt.targetDate !== 'string' ||
        collectionReceipt.targetDate <= date ||
        collectionReceipt.calendarVersion !== session.calendarAuthority.sourceVersions?.[0] ||
        collectionReceipt.connectionGeneration !== summary.connectionGeneration ||
        !Array.isArray(collectionReceipt.results) ||
        !sameSet(collectionReceipt.results.map(r => r.symbol), symbols) ||
        collectionReceipt.results.some(r => r.state !== 'ready'))
        return { state: 'pending_postclose', reason: 'complete_baseline_required',
            policyVersion: CLOSE_TAIL_POLICY, ...noAuthority };
    const current = new Map((manifests ?? []).map(m => [m.symbol, m]));
    const previous = new Map((previousManifests ?? []).map(m => [m.symbol, m]));
    const calendarVersion = session.calendarAuthority.sourceVersions?.[0];
    if (!calendarVersion || !sameSet([...current.keys()], symbols) ||
        !sameSet([...previous.keys()], symbols) || manifests.length !== 160 || previousManifests.length !== 160)
        return rejected('baseline_cohort_unverified');
    for (const symbol of symbols) {
        const m = current.get(symbol), p = previous.get(symbol);
        if (!baselineValid(m, symbol, date, collectionReceipt.targetDate, calendarVersion) ||
            !baselineValid(p, symbol, session.previousTradeDate, date, calendarVersion) ||
            collectionReceipt.results.find(r => r.symbol === symbol).manifestId !== m.manifestId ||
            groups.get(symbol)[0].payload.sourceVersion !== m.sourceVersion)
            return rejected('baseline_hash_date_or_source_unverified');
    }
    const initial = thresholdState?.initial;
    if (!initial || initial.sessionId !== session.sessionId || initial.tradeDate !== date ||
        initial.connectionGeneration !== summary.connectionGeneration ||
        !sameSet(initial.activeSymbols ?? [], symbols))
        return rejected('threshold_session_unverified');
    const receipts = thresholdState.receipts ?? [];
    const last = receipts.filter(r => Date.parse(r.effectiveAt) <= finalizedAt).at(-1);
    const proof = thresholdConfigProof(last?.configSnapshot ?? initial.config);
    const effectiveRevision = last?.comparisonRevision ?? initial.config.revision;
    if (summary.thresholdSwitch.activeComparisonRevision !== effectiveRevision ||
        summary.thresholdSwitch.configHash !== proof.configHash ||
        summary.thresholdSwitch.transitionHash !== (last?.transitionHash ?? null))
        return rejected('effective_threshold_unverified');
    const rows = [];
    for (const item of missing) {
        const symbol = item.canonicalSymbol, m = current.get(symbol), p = previous.get(symbol);
        const lastLive = groups.get(symbol).at(-1).cumulative_volume;
        if (m.cumulativeSeries[268].cumulativeVolume !== lastLive)
            return rejected('tail_overlap_conflict');
        const threshold = proof.config.items.find(r => r.contract.canonicalSymbol === symbol)?.effectiveThreshold;
        if (!thresholdValid(threshold))
            return rejected('effective_threshold_unverified');
        const a = m.cumulativeSeries[269].cumulativeVolume;
        const b = p.cumulativeSeries[269].cumulativeVolume;
        rows.push({ canonicalSymbol: symbol, minuteKey: '13:30',
            source: 'postclose_verified', currentCumulativeVolume: a, previousCumulativeVolume: b,
            lastLiveCumulativeVolume: lastLive, threshold, comparisonRevision: effectiveRevision,
            ratio: b === 0 ? null : a / b,
            comparison: comparison(a, b, threshold),
            currentManifestId: m.manifestId, previousManifestId: p.manifestId,
            closeMode: m.closeMode, liveDelivered: false, notificationAuthority: false });
    }
    return { schemaVersion: CLOSE_TAIL_SCHEMA, policyVersion: CLOSE_TAIL_POLICY,
        maximumExceptions: MAX_CLOSE_TAIL_EXCEPTIONS,
        state: 'passed_with_close_tail_exception', reason: null, tradeDate: date,
        previousTradeDate: session.previousTradeDate, targetTradeDate: collectionReceipt.targetDate,
        sessionId: session.sessionId, connectionGeneration: summary.connectionGeneration,
        originalExecutionOutcome: 'partial', liveCompleteCount: 160 - missing.length,
        livePartialCount: missing.length, rows: rows.sort((a, b) => a.canonicalSymbol.localeCompare(b.canonicalSymbol)),
        ...noAuthority };
}

function directory(root, tradeDate) {
    if (!path.isAbsolute(root ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? ''))
        throw new Error('close_tail_path_invalid');
    return path.join(root, 'IntradayMonitor', 'daily-run', tradeDate);
}
const stableReceipt = receipt => {
    const { alreadyPresent, tailReconciliation, closeTailException, ...body } = receipt;
    return body;
};

// Reads only immutable receipts and read-only databases; never runs a collector.
export async function publishCloseTailException({ root, tradeDate, collectionReceipt,
    assessmentTrigger = 'operator_after_original_collection', now = () => new Date().toISOString() } = {}) {
    const dir = directory(root, tradeDate);
    if (collectionReceipt?.outcome !== 'complete') return { state: 'pending_postclose',
        reason: 'complete_baseline_required', policyVersion: CLOSE_TAIL_POLICY, ...noAuthority };
    if (!Number.isInteger(collectionReceipt.attempt) || collectionReceipt.attempt < 1 ||
        collectionReceipt.attempt > 3 || !['scheduled_after_original_collection',
            'operator_after_original_collection'].includes(assessmentTrigger))
        throw new Error('close_tail_collection_identity_invalid');
    const prefix = `attempt-${String(collectionReceipt.attempt).padStart(2, '0')}`;
    const collectionDir = path.join(root, 'IntradayMonitor', 'daily-minute-volume-collection', tradeDate);
    const collectionText = await readFile(path.join(collectionDir, `${prefix}-receipt.json`), 'utf8');
    const claimText = await readFile(path.join(collectionDir, `${prefix}-claim.json`), 'utf8');
    const original = JSON.parse(collectionText), claim = JSON.parse(claimText);
    if (JSON.stringify(original) !== JSON.stringify(stableReceipt(collectionReceipt)) ||
        original.claimId !== claim.claimId || original.sourceDate !== tradeDate ||
        claim.sourceDate !== tradeDate || claim.targetDate !== original.targetDate ||
        claim.connectionGeneration !== original.connectionGeneration ||
        claim.attempt !== original.attempt || !Number.isSafeInteger(claim.ownerPid) || claim.ownerPid < 1 ||
        !sameSet(claim.requestedSymbols ?? [], original.results?.map(r => r.symbol) ?? []))
        throw new Error('close_tail_collection_origin_conflict');
    const summaryText = await readFile(path.join(dir, 'summary.json'), 'utf8');
    const summary = JSON.parse(summaryText);
    const sessionText = await readFile(path.join(root, 'IntradayMonitor', 'session-state', 'sessions', `${tradeDate}.json`), 'utf8');
    const session = JSON.parse(sessionText);
    const state = readThresholdSwitchState(root, session);
    const live = new DatabaseSync(path.join(root, 'IntradayMonitor', 'intraday-monitor-evidence.sqlite3'), { readOnly: true });
    let liveRows;
    try {
        liveRows = live.prepare('SELECT canonical_symbol,minute_key,cumulative_volume,payload_json FROM intraday_monitor_observations WHERE trade_date=? ORDER BY canonical_symbol,minute_key LIMIT 43201')
            .all(tradeDate).map(({ payload_json, ...r }) => ({ ...r, payload: JSON.parse(payload_json) }));
    } finally { live.close(); }
    const db = new DatabaseSync(path.join(root, 'IntradayMonitor', 'daily-minute-volume-baselines.sqlite3'), { readOnly: true });
    let manifests, previousManifests;
    try {
        const get = (source, target) => db.prepare('SELECT manifest_json FROM daily_baseline_manifests WHERE source_date=? AND target_date=? ORDER BY symbol LIMIT 161')
            .all(source, target).map(r => JSON.parse(r.manifest_json));
        manifests = get(tradeDate, collectionReceipt?.targetDate ?? '');
        previousManifests = get(session.previousTradeDate, tradeDate);
    } finally { db.close(); }
    const result = evaluateCloseTailException({ summary, session, liveRows, collectionReceipt,
        manifests, previousManifests, thresholdState: state });
    if (!['passed_with_close_tail_exception', 'rejected'].includes(result.state)) return result;
    const inputHashes = { summary: sha(summaryText), session: sha(sessionText),
        collection: sha(collectionText), collectionClaim: sha(claimText), threshold: sha(state),
        observations: sha(liveRows), manifests: sha(manifests), previousManifests: sha(previousManifests) };
    if (sha(await readFile(path.join(collectionDir, `${prefix}-receipt.json`), 'utf8')) !== inputHashes.collection ||
        sha(await readFile(path.join(collectionDir, `${prefix}-claim.json`), 'utf8')) !== inputHashes.collectionClaim ||
        sha(await readFile(path.join(dir, 'summary.json'), 'utf8')) !== inputHashes.summary ||
        sha(await readFile(path.join(root, 'IntradayMonitor', 'session-state', 'sessions', `${tradeDate}.json`), 'utf8')) !== inputHashes.session)
        throw new Error('close_tail_source_changed');
    const evidenceHash = sha({ result, inputHashes });
    const body = { schemaVersion: CLOSE_TAIL_SCHEMA, maximumExceptions: MAX_CLOSE_TAIL_EXCEPTIONS,
        tradeDate, previousTradeDate: session.previousTradeDate, targetTradeDate: collectionReceipt.targetDate,
        sessionId: session.sessionId, connectionGeneration: summary.connectionGeneration,
        originalExecutionOutcome: summary.executionOutcome,
        liveCompleteCount: summary.liveCoverageBySymbol?.filter(r => r.state === 'complete').length ?? null,
        livePartialCount: summary.liveCoverageBySymbol?.filter(r => r.state !== 'complete').length ?? null,
        rows: [], ...result, inputHashes, evidenceHash, assessmentTrigger, assessedAt: now() };
    const artifact = { ...body, artifactHash: sha(body) };
    const file = path.join(dir, 'daily-close-tail-exception.json');
    let handle;
    try {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        handle = await open(file, 'wx', 0o600);
        await handle.writeFile(`${JSON.stringify(artifact)}\n`);
        await handle.sync();
    } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const saved = JSON.parse(await readFile(file, 'utf8'));
        const { artifactHash, ...old } = saved;
        if (artifactHash !== sha(old) || saved.evidenceHash !== evidenceHash)
            throw new Error('close_tail_assessment_conflict');
        return { ...saved, file, alreadyPresent: true };
    } finally { await handle?.close(); }
    return { ...artifact, file, alreadyPresent: false };
}

function assessmentEnvelopeValid(value) {
    try {
        const { artifactHash, ...body } = value;
        return artifactHash === sha(body) && value.schemaVersion === CLOSE_TAIL_SCHEMA &&
            value.policyVersion === CLOSE_TAIL_POLICY && value.maximumExceptions === MAX_CLOSE_TAIL_EXCEPTIONS &&
            /^\d{4}-\d{2}-\d{2}$/.test(value.tradeDate ?? '') && value.tradeDate >= '2026-10-15' &&
            /^\d{4}-\d{2}-\d{2}$/.test(value.previousTradeDate ?? '') && value.previousTradeDate < value.tradeDate &&
            /^\d{4}-\d{2}-\d{2}$/.test(value.targetTradeDate ?? '') && value.targetTradeDate > value.tradeDate &&
            value.originalExecutionOutcome === 'partial' &&
            ['scheduled_after_original_collection', 'operator_after_original_collection'].includes(value.assessmentTrigger) &&
            Number.isFinite(Date.parse(value.assessedAt)) &&
            typeof value.sessionId === 'string' && value.sessionId.length > 0 &&
            /^simulation:[A-Za-z0-9_-]{16,100}$/.test(value.connectionGeneration ?? '') &&
            /^[a-f0-9]{64}$/.test(value.evidenceHash ?? '') &&
            ['summary', 'session', 'collection', 'collectionClaim', 'threshold', 'observations',
                'manifests', 'previousManifests'].every(key => /^[a-f0-9]{64}$/.test(value.inputHashes?.[key] ?? '')) &&
            Array.isArray(value.rows) && count(value.liveCompleteCount) && count(value.livePartialCount) &&
            value.liveCompleteCount + value.livePartialCount === 160 &&
            Object.entries(noAuthority).every(([k, v]) => value[k] === v);
    } catch { return false; }
}

export function isRejectedCloseTailAssessment(value) {
    return assessmentEnvelopeValid(value) && value.state === 'rejected' && value.rows.length === 0 &&
        typeof value.reason === 'string' && /^[a-z_]{1,80}$/.test(value.reason);
}

export function isCloseTailExceptionArtifact(value) {
    try {
        return assessmentEnvelopeValid(value) && value.state === 'passed_with_close_tail_exception' &&
            value.rows.length > 0 && value.rows.length <= MAX_CLOSE_TAIL_EXCEPTIONS &&
            new Set(value.rows.map(r => r.canonicalSymbol)).size === value.rows.length &&
            value.livePartialCount === value.rows.length && value.liveCompleteCount + value.rows.length === 160 &&
            Object.entries(noAuthority).every(([k, v]) => value[k] === v) &&
            value.rows.every(r => /^\d{4,6}[A-Z]?\.TW(?:O)?$/.test(r.canonicalSymbol) &&
                r.source === 'postclose_verified' && r.minuteKey === '13:30' &&
                r.liveDelivered === false && r.notificationAuthority === false &&
                count(r.currentCumulativeVolume) && count(r.previousCumulativeVolume) &&
                Number.isSafeInteger(r.comparisonRevision) && r.comparisonRevision >= 0 &&
                thresholdValid(r.threshold) && r.comparison === comparison(
                    r.currentCumulativeVolume, r.previousCumulativeVolume, r.threshold) &&
                (r.previousCumulativeVolume === 0
                    ? r.ratio === null && r.comparison === 'zero_baseline'
                    : r.ratio === r.currentCumulativeVolume / r.previousCumulativeVolume));
    } catch { return false; }
}

export function readCloseTailExceptionView({ root, tradeDate, summary } = {}) {
    const file = path.join(directory(root, tradeDate), 'daily-close-tail-exception.json');
    if (!existsSync(file)) return { state: 'not_assessed', reason: 'awaiting_verified_postclose',
        policyVersion: CLOSE_TAIL_POLICY, rows: [], ...noAuthority };
    try {
        const value = JSON.parse(readFileSync(file, 'utf8'));
        if (!(isCloseTailExceptionArtifact(value) || isRejectedCloseTailAssessment(value)) ||
            value.tradeDate !== tradeDate || value.inputHashes?.summary !== sha(summary))
            throw new Error('close_tail_assessment_invalid');
        return value;
    } catch {
        return { state: 'invalid_evidence', reason: 'close_tail_assessment_invalid',
            policyVersion: CLOSE_TAIL_POLICY, rows: [], ...noAuthority };
    }
}
