import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { POSTCLOSE_TAIL_RECOVERY_SCHEMA } from './postclose-tail-recovery-core.mjs';

const VIEW_SCHEMA = 'intraday-monitor-postclose-tail-recovery-view/1';
const EMPTY = Object.freeze({ schemaVersion: VIEW_SCHEMA, state: 'unverified',
    reason: 'recovery_not_recorded', liveLastMinute: null,
    originalFormalAcceptanceEvidence: null, boundedDerivedAcceptance: null,
    postcloseDataRecovered: false, nextDayBaselineUsable: null,
    recoveredSymbolCount: 0, recoveredRows: [], notificationAuthority: false });

function pendingView(root, tradeDate) {
    if (!existsSync(path.join(root, 'direct-160-live', `capture-${tradeDate}.json`))) {
        return { ...EMPTY, tradeDate };
    }
    const directory = path.join(root, 'IntradayMonitor', 'postclose-baseline', 'receipts');
    for (const suffix of ['-attempt-03', '-attempt-02', '']) {
        try {
            const receipt = JSON.parse(readFileSync(path.join(directory,
                `${tradeDate}${suffix}.json`), 'utf8'));
            if (receipt?.tradeDate !== tradeDate) continue;
            return { ...EMPTY, tradeDate,
                state: receipt.outcome === 'failed' && suffix === '-attempt-03'
                    ? 'source_unverified' : 'source_pending',
                reason: receipt.outcome === 'failed' ? receipt.reason ?? 'baseline_failed' :
                    receipt.outcome === 'verified' ? 'recovery_not_published' :
                        'baseline_not_verified' };
        } catch { /* 舊收據不存在或損壞時維持未驗證。 */ }
    }
    return { ...EMPTY, tradeDate, state: 'source_pending', reason: 'baseline_receipt_missing' };
}

export function readPostcloseTailRecoveryView(root, tradeDate) {
    if (!path.isAbsolute(root ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '')) {
        return { ...EMPTY, tradeDate: null, reason: 'invalid_request' };
    }
    const directory = path.join(root, 'IntradayMonitor', 'postclose-tail-recovery', 'results');
    let names;
    try { names = readdirSync(directory).filter((name) =>
        name.startsWith(`${tradeDate}-`) && /^\d{4}-\d{2}-\d{2}-[a-f0-9]{64}\.json$/.test(name)); }
    catch (error) {
        if (error?.code === 'ENOENT') return pendingView(root, tradeDate);
        return { ...EMPTY, tradeDate, reason: 'recovery_read_failed' };
    }
    if (names.length === 0) return pendingView(root, tradeDate);
    if (names.length !== 1) return { ...EMPTY, tradeDate, reason: 'multiple_recovery_artifacts' };
    try {
        const bytes = readFileSync(path.join(directory, names[0]));
        if (bytes.length > 2 * 1024 * 1024) throw new Error('oversize');
        const value = JSON.parse(bytes.toString('utf8'));
        if (value?.schemaVersion !== POSTCLOSE_TAIL_RECOVERY_SCHEMA ||
            value.tradeDate !== tradeDate ||
            value.sourceCaptureSha256 !== names[0].slice(tradeDate.length + 1, -5) ||
            value.notificationAuthority !== false || value.brokerWriteAuthority !== false ||
            value.productionAuthority !== false || !Array.isArray(value.symbols) ||
            value.symbols.length < 1 || value.symbols.length > 160) {
            throw new Error('invalid');
        }
        const recovered = value.symbols.filter((item) => item.state === 'postclose_data_recovered');
        const rows = recovered.flatMap((item) => item.rows.map((row) => ({
            canonicalSymbol: item.canonicalSymbol, minuteKey: row.minuteKey,
            cumulativeVolume: row.cumulativeVolume, source: 'postclose_verified',
            sourceTradeDate: row.sourceTradeDate, verifiedAt: row.verifiedAt,
            liveDelivered: false, notificationAuthority: false,
            sourceManifestId: item.sourceManifestId,
        })));
        if (rows.length > 800 || rows.some((row) => !/^\d{4,6}[A-Z]?\.TW(?:O)?$/.test(row.canonicalSymbol) ||
            !/^13:(?:2[6-9]|30)$/.test(row.minuteKey) ||
            !Number.isSafeInteger(row.cumulativeVolume) || row.cumulativeVolume < 0 ||
            row.sourceTradeDate !== tradeDate || !Number.isFinite(Date.parse(row.verifiedAt)))) {
            throw new Error('invalid');
        }
        const liveLastMinutes = value.symbols.map((item) => item.originalLastLiveMinute)
            .filter((minute) => /^\d{2}:\d{2}$/.test(minute ?? ''));
        return { schemaVersion: VIEW_SCHEMA, tradeDate,
            state: value.postcloseDataRecovered === true ? 'postclose_data_recovered' :
                'partial_or_source_unverified', reason: null,
            classification: value.classification,
            sourceCaptureSha256: value.sourceCaptureSha256,
            sourceManifestSha256: value.sourceManifestSha256,
            recoveryArtifactSha256: createHash('sha256').update(bytes).digest('hex'),
            verifiedAt: value.verifiedAt,
            liveLastMinute: liveLastMinutes.length ? liveLastMinutes.sort()[0] : null,
            originalFormalAcceptanceEvidence: value.originalFormalAcceptanceEvidence === true,
            boundedDerivedAcceptance: value.boundedDerivedAcceptance === true,
            postcloseDataRecovered: value.postcloseDataRecovered === true,
            nextDayBaselineUsable: value.nextDayBaselineUsable === true,
            affectedSymbolCount: value.symbols.length,
            recoveredSymbolCount: recovered.length,
            recoveredRows: rows,
            notificationAuthority: false };
    } catch {
        return { ...EMPTY, tradeDate, reason: 'recovery_artifact_invalid' };
    }
}
