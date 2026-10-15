import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { baselineCalendar } from './direct-160-baseline.mjs';
import { isDailyMinuteVolumeBaseline } from './daily-minute-volume-baseline.mjs';
import { createDailyMinuteVolumeCollector, DAILY_MINUTE_VOLUME_COLLECTION_SCHEMA } from './daily-minute-volume-collector.mjs';

const schemaVersion = 'intraday-minute-volume-same-key-noop-audit/1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const symbolPattern = /^\d{4,6}[A-Z]?\.TW(?:O)?$/;
const safeReason = error => String(error?.message ?? 'unknown').replace(/[^a-z0-9_]/gi, '_').slice(0, 128);

// Only the standalone postclose entry imports this module. No live transport,
// broker port, login or download can be constructed by this audit.
export async function auditDailyMinuteVolumeSameKeyNoop({ root, collectionReceipt,
    calendar, limits, trigger, now = () => new Date().toISOString() } = {}) {
    if (!path.isAbsolute(root ?? '') || !['scheduled', 'manual'].includes(trigger) ||
        typeof now !== 'function') throw new TypeError('daily_noop_audit_inputs_invalid');
    const receipt = collectionReceipt;
    if (receipt?.schemaVersion !== DAILY_MINUTE_VOLUME_COLLECTION_SCHEMA ||
        receipt.outcome !== 'complete' || receipt.readyCount !== 160 ||
        receipt.waitingCount !== 0 || receipt.conflictCount !== 0 ||
        !Array.isArray(receipt.results) || receipt.results.length !== 160 ||
        new Set(receipt.results.map(row => row.symbol)).size !== 160 ||
        receipt.results.some(row => row.state !== 'ready' || !symbolPattern.test(row.symbol)) ||
        !Number.isInteger(receipt.attempt) || receipt.attempt < 1 || receipt.attempt > 3 ||
        calendar?.tradeDate !== receipt.sourceDate || calendar?.targetTradeDate !== receipt.targetDate) {
        return { state: 'baseline_not_complete_or_identity_invalid' };
    }
    const verifiedCalendar = baselineCalendar(calendar.twse, calendar.tpex,
        receipt.sourceDate, receipt.targetDate, Date.parse(now()));
    if (verifiedCalendar.sourceVersion !== receipt.calendarVersion ||
        calendar.calendarSourceVersion !== receipt.calendarVersion) {
        throw new Error('daily_noop_audit_calendar_conflict');
    }
    const directory = path.join(root, 'IntradayMonitor', 'daily-minute-volume-collection', receipt.sourceDate);
    const prefix = `attempt-${String(receipt.attempt).padStart(2, '0')}`;
    const receiptFile = path.join(directory, `${prefix}-receipt.json`);
    const claimFile = path.join(directory, `${prefix}-claim.json`);
    const receiptBefore = await readFile(receiptFile);
    const claimBefore = await readFile(claimFile);
    const original = JSON.parse(receiptBefore), claim = JSON.parse(claimBefore);
    const { tailReconciliation: _tail, alreadyPresent: _present, ...stableReceipt } = receipt;
    if (JSON.stringify(original) !== JSON.stringify(stableReceipt) ||
        claim.schemaVersion !== DAILY_MINUTE_VOLUME_COLLECTION_SCHEMA ||
        claim.claimId !== original.claimId || claim.sourceDate !== receipt.sourceDate ||
        claim.targetDate !== receipt.targetDate || claim.connectionGeneration !== receipt.connectionGeneration ||
        claim.attempt !== receipt.attempt || !Number.isSafeInteger(claim.ownerPid) || claim.ownerPid < 1 ||
        JSON.stringify(claim.requestedSymbols) !== JSON.stringify(receipt.results.map(row => row.symbol))) {
        throw new Error('daily_noop_audit_origin_conflict');
    }
    const db = new DatabaseSync(path.join(root, 'IntradayMonitor', 'daily-minute-volume-baselines.sqlite3'), { readOnly: true });
    try {
        const revision = db.prepare('SELECT revision FROM daily_baseline_meta WHERE singleton=1').get().revision;
        const readManifests = () => receipt.results.map(result => {
            const row = db.prepare(`SELECT manifest_id,manifest_json FROM daily_baseline_manifests
                WHERE symbol=? AND source_date=? AND target_date=?`).get(result.symbol, receipt.sourceDate, receipt.targetDate);
            const value = row ? JSON.parse(row.manifest_json) : null;
            if (!value || !isDailyMinuteVolumeBaseline(value) || value.manifestId !== result.manifestId ||
                row.manifest_id !== result.manifestId || value.symbol !== result.symbol ||
                value.sourceVersion !== receipt.sourceVersion || value.calendarReference.sourceVersion !== receipt.calendarVersion ||
                value.tradeDate !== receipt.sourceDate || value.targetTradeDate !== receipt.targetDate ||
                value.minuteCoverage.canonicalMinuteCount !== 270) throw new Error('daily_noop_audit_manifest_unverified');
            return { symbol: result.symbol, manifestId: value.manifestId,
                manifestBytesHash: sha(row.manifest_json), exchange: value.exchange,
                closeMode: value.closeMode, closeTotalCheck: value.validationChecks.closeTotalCheck,
                knownZeroCount: value.minuteCoverage.knownZeroCarryForwardCount };
        });
        const manifests = readManifests();
        let forbiddenCalls = 0;
        const forbidden = async () => { forbiddenCalls += 1; throw new Error('daily_noop_audit_network_or_write_forbidden'); };
        const collector = createDailyMinuteVolumeCollector({ now,
            apiPort: { fetchContract: forbidden, fetchKbars: forbidden },
            admission: { reserve: forbidden, start: forbidden, settle: forbidden },
            repository: { latestForSymbolDate: forbidden, putManifest: forbidden,
                currentRevision: forbidden, hasConflict: forbidden } });
        const reused = await collector.collect({ root,
            entries: manifests.map(row => ({ canonicalSymbol: row.symbol, contractIdentity: {
                code: row.symbol.split('.')[0], exchange: row.exchange, security_type: 'STK', region: 'TW', target_code: null } })),
            calendar: { ...verifiedCalendar, twse: calendar.twse, tpex: calendar.tpex },
            sourceVersion: receipt.sourceVersion, connectionGeneration: receipt.connectionGeneration,
            attempt: receipt.attempt, limits: { ...limits, deadlineAt: `${receipt.sourceDate}T${limits.deadlineTime}+08:00` } });
        const { alreadyPresent, ...reusedOriginal } = reused;
        if (alreadyPresent !== true || forbiddenCalls !== 0 || JSON.stringify(reusedOriginal) !== JSON.stringify(original) ||
            revision !== db.prepare('SELECT revision FROM daily_baseline_meta WHERE singleton=1').get().revision ||
            JSON.stringify(manifests) !== JSON.stringify(readManifests()) ||
            !receiptBefore.equals(await readFile(receiptFile)) || !claimBefore.equals(await readFile(claimFile))) {
            throw new Error('daily_noop_audit_changed_or_not_noop');
        }
        const body = { schemaVersion, sourceTradeDate: receipt.sourceDate, targetTradeDate: receipt.targetDate,
            originTrigger: trigger, originalOwnerPid: claim.ownerPid, auditOwnerPid: process.pid,
            sameOriginalProcess: claim.ownerPid === process.pid, verifiedAt: now(),
            receiptHash: sha(receiptBefore), claimHash: sha(claimBefore), sourceVersion: receipt.sourceVersion,
            connectionGeneration: receipt.connectionGeneration, calendarVersion: receipt.calendarVersion,
            repositoryRevision: revision, manifests, count: 160, state: 'same_key_noop_verified',
            collectorAlreadyPresent: true, newDownloadRequests: 0, newReservations: 0,
            originalReceiptRequests: original.requests, originalReceiptPreserved: true,
            liveAcceptance: false, brokerWriteAuthority: false, notificationAuthority: false };
        const artifact = { ...body, evidenceHash: sha(JSON.stringify(body)) };
        const file = path.join(directory, `${prefix}-same-key-noop.json`);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        let handle;
        try { handle = await open(file, 'wx', 0o600); }
        catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const saved = JSON.parse(await readFile(file, 'utf8'));
            const { evidenceHash, ...savedBody } = saved;
            if (saved.schemaVersion !== schemaVersion || evidenceHash !== sha(JSON.stringify(savedBody)) ||
                saved.receiptHash !== artifact.receiptHash || saved.claimHash !== artifact.claimHash ||
                saved.originTrigger !== trigger || JSON.stringify(saved.manifests) !== JSON.stringify(manifests) ||
                saved.sourceTradeDate !== artifact.sourceTradeDate || saved.targetTradeDate !== artifact.targetTradeDate ||
                saved.sourceVersion !== artifact.sourceVersion || saved.connectionGeneration !== artifact.connectionGeneration ||
                saved.calendarVersion !== artifact.calendarVersion || saved.originalOwnerPid !== artifact.originalOwnerPid ||
                saved.repositoryRevision !== revision || saved.count !== 160 || saved.collectorAlreadyPresent !== true ||
                !Number.isSafeInteger(saved.auditOwnerPid) || saved.auditOwnerPid < 1 ||
                saved.sameOriginalProcess !== (saved.auditOwnerPid === saved.originalOwnerPid) ||
                saved.liveAcceptance !== false || saved.brokerWriteAuthority !== false || saved.notificationAuthority !== false ||
                saved.state !== artifact.state || saved.newDownloadRequests !== 0 || saved.newReservations !== 0) {
                throw new Error('daily_noop_audit_artifact_conflict');
            }
            return { state: saved.state, file, alreadyPresent: true, evidenceHash };
        }
        try { await handle.writeFile(`${JSON.stringify(artifact)}\n`); await handle.sync(); }
        finally { await handle.close(); }
        return { state: artifact.state, file, alreadyPresent: false, evidenceHash: artifact.evidenceHash };
    } finally { db.close(); }
}

export async function inspectDailyMinuteVolumeSameKeyNoop(input) {
    try { return await auditDailyMinuteVolumeSameKeyNoop(input); }
    catch (error) { return { state: 'diagnostic_failed', reason: safeReason(error) }; }
}
