import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { isDailyMinuteVolumeBaseline, resolveDailyMinuteVolumeBaseline }
    from './daily-minute-volume-baseline.mjs';
import { DailyMinuteVolumeRepository } from './daily-minute-volume-repository.mjs';
import { validateDirect160BaselineSet } from './direct-160-baseline.mjs';

export const DAILY_MINUTE_VOLUME_FIXED_GATE_SCHEMA = 'intraday-minute-volume-fixed-gate/1';

// Read-only matching by symbol/date, never by list position alone.  A partial or
// conflicting v2 set leaves only the affected symbols waiting; no v1 aliasing.
export function resolveDailyMinuteVolumeFixedBaseline({ root, cohort,
    sourceTradeDate, targetTradeDate, legacySet = null,
    repositoryFactory = file => existsSync(file) ? new DailyMinuteVolumeRepository(file) : null } = {}) {
    if (!path.isAbsolute(root ?? '') || !Array.isArray(cohort?.cohort) ||
        cohort.cohort.length !== 160 || !/^\d{4}-\d{2}-\d{2}$/.test(sourceTradeDate ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(targetTradeDate ?? '') ||
        sourceTradeDate >= targetTradeDate) {
        throw new TypeError('daily_fixed_baseline_identity_invalid');
    }
    if (legacySet && (!validateDirect160BaselineSet(legacySet, cohort, targetTradeDate) ||
        legacySet.calendar.previousTradeDate !== sourceTradeDate)) {
        throw new Error('daily_fixed_legacy_baseline_invalid');
    }
    const repository = repositoryFactory(path.join(root, 'IntradayMonitor',
        'daily-minute-volume-baselines.sqlite3'));
    try {
        const items = cohort.cohort.map(entry => {
            const { canonicalSymbol, contractIdentity } = entry;
            if (repository?.hasConflict(canonicalSymbol, sourceTradeDate)) return {
                canonicalSymbol, state: 'conflict', reason: 'baseline_source_conflict', manifestId: null };
            const v2 = repository?.latestForSymbolDate(canonicalSymbol,
                contractIdentity.exchange, sourceTradeDate, targetTradeDate) ?? null;
            if (v2 && !isDailyMinuteVolumeBaseline(v2)) {
                return { canonicalSymbol, state: 'conflict',
                    reason: 'baseline_identity_invalid', manifestId: null };
            }
            const legacy = legacySet?.manifests.find(item => item.symbol === canonicalSymbol) ?? null;
            const resolved = resolveDailyMinuteVolumeBaseline({ symbol: canonicalSymbol,
                exchange: contractIdentity.exchange, sourceTradeDate, targetTradeDate,
                v2: v2 ? [v2] : [], legacy: legacy ? [legacy] : [] });
            if (resolved.state !== 'baseline_ready') return { canonicalSymbol,
                state: resolved.reason === 'baseline_missing' ? 'missing' : 'conflict',
                reason: resolved.reason, manifestId: null };
            const manifest = resolved.manifest;
            return { canonicalSymbol, state: 'ready', reason: null,
                manifestId: manifest.manifestId, manifest };
        });
        const ready = items.every(item => item.state === 'ready');
        const manifestIds = ready ? items.map(item => item.manifestId) : [];
        const baselineHash = ready ? createHash('sha256').update(JSON.stringify({
            schemaVersion: DAILY_MINUTE_VOLUME_FIXED_GATE_SCHEMA,
            sourceTradeDate, targetTradeDate, cohortHash: cohort.manifestHash,
            manifestIds })).digest('hex') : null;
        return Object.freeze({ schemaVersion: DAILY_MINUTE_VOLUME_FIXED_GATE_SCHEMA,
            runtimeMode: 'daily', sourceTradeDate, targetTradeDate,
            cohortHash: cohort.manifestHash, ready, baselineHash,
            readyCount: items.filter(item => item.state === 'ready').length,
            conflictCount: items.filter(item => item.state === 'conflict').length,
            missingCount: items.filter(item => item.state === 'missing').length,
            items: items.map(({ manifest: _manifest, ...item }) => item),
            manifests: ready ? items.map(item => item.manifest) : [],
            brokerWriteAuthority: false, notificationAuthority: false });
    } finally { repository?.close(); }
}
