import { createHash } from 'node:crypto';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';
import { validateDirect160BaselineSet } from './direct-160-baseline.mjs';
import { isHistoricalKbarBaselineManifest } from './historical-kbar-repair.mjs';
import { validateDynamicDailyCohortPlan } from './dynamic-daily-cohort-plan.mjs';

export function dynamicDailySymbolBaselineCohortHash({ tradeDate, previousTradeDate,
    canonicalSymbol, exchange } = {}) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(previousTradeDate ?? '') ||
        previousTradeDate >= tradeDate || !/^\d{4}\.(?:TW|TWO)$/.test(canonicalSymbol ?? '') ||
        !['TSE', 'OTC'].includes(exchange) ||
        (exchange === 'TSE' ? !canonicalSymbol.endsWith('.TW') :
            !canonicalSymbol.endsWith('.TWO'))) {
        throw new TypeError('symbol_baseline_identity_invalid');
    }
    const body = { schemaVersion: 'intraday-monitor-single-symbol-baseline-cohort/1',
        tradeDate, previousTradeDate, canonicalSymbol, exchange };
    return `sha256:${createHash('sha256').update(canonicalJson(body)).digest('hex')}`;
}

function validForPlan(manifest, entry, plan) {
    return isHistoricalKbarBaselineManifest(manifest) &&
        manifest.symbol === entry.canonicalSymbol && manifest.exchange === entry.exchange &&
        manifest.tradeDate === plan.previousTradeDate &&
        manifest.targetTradeDate === plan.tradeDate &&
        manifest.timeZone === 'Asia/Taipei' && manifest.canonicalUnit === 'common_lot' &&
        manifest.minuteCoverage?.expectedMinuteCount === 270 &&
        manifest.minuteCoverage?.canonicalMinuteCount === 270 &&
        manifest.minuteCoverage?.firstMinute === '09:01' &&
        manifest.minuteCoverage?.lastMinute === '13:30' &&
        manifest.finalVolumeReconciliation?.matched === true &&
        manifest.finalVolumeReconciliation?.sessionScope === 'regular_session' &&
        manifest.finalVolumeReconciliation?.unit === 'common_lot' &&
        manifest.cumulativeSeries.every((row, index, rows) =>
            index === 0 || row.cumulativeVolume >= rows[index - 1].cumulativeVolume);
}

// 只消費已驗證的 immutable set／逐檔 manifest，不進行歷史請求或追認盤前 Gate。
export function resolveDynamicDailyBaselineCoverage({ plan, verifiedSets = [],
    standaloneManifests = [] } = {}) {
    if (!validateDynamicDailyCohortPlan(plan) || !Array.isArray(verifiedSets) ||
        !Array.isArray(standaloneManifests)) throw new TypeError('daily_baseline_input_invalid');
    const bySymbol = new Map();
    const invalidSymbols = new Set();
    const add = (manifest, sourceHash) => {
        const key = `${manifest?.targetTradeDate}|${manifest?.tradeDate}|${manifest?.symbol}`;
        const prior = bySymbol.get(key) ?? [];
        prior.push({ manifest, sourceHash });
        bySymbol.set(key, prior);
    };
    for (const source of verifiedSets) {
        if (!validateDirect160BaselineSet(source?.baseline, source?.cohortManifest,
            plan.tradeDate) ||
            source.baseline.calendar.previousTradeDate !== plan.previousTradeDate) {
            for (const item of source?.cohortManifest?.cohort ?? []) {
                if (typeof item?.canonicalSymbol === 'string') invalidSymbols.add(item.canonicalSymbol);
            }
            continue;
        }
        for (const manifest of source.baseline.manifests) add(manifest, source.baseline.baselineHash);
    }
    for (const manifest of standaloneManifests) {
        let valid = false;
        try { valid = isHistoricalKbarBaselineManifest(manifest) &&
            manifest.cohortHash === dynamicDailySymbolBaselineCohortHash({
                tradeDate: plan.tradeDate, previousTradeDate: plan.previousTradeDate,
                canonicalSymbol: manifest.symbol, exchange: manifest.exchange }); }
        catch {}
        if (!valid) {
            if (typeof manifest?.symbol === 'string') invalidSymbols.add(manifest.symbol);
            continue;
        }
        add(manifest, manifest.manifestId);
    }
    const items = plan.selected.map((entry) => {
        const candidates = bySymbol.get(`${plan.tradeDate}|${plan.previousTradeDate}|${entry.canonicalSymbol}`) ?? [];
        const matches = candidates.filter(({ manifest }) => validForPlan(manifest, entry, plan));
        const unique = new Map(matches.map(({ manifest, sourceHash }) => [manifest.manifestId,
            { manifest, sourceHash }]));
        // 同商品若同時出現不合法來源，不得以另一份合法 manifest 靜默掩蓋衝突。
        if (unique.size !== 1 || invalidSymbols.has(entry.canonicalSymbol)) {
            return Object.freeze({ canonicalSymbol: entry.canonicalSymbol,
                state: 'waiting_baseline', reason: unique.size > 1 ?
                    'baseline_source_conflict' :
                    (invalidSymbols.has(entry.canonicalSymbol) || candidates.length > 0) ?
                        'baseline_invalid' : 'baseline_missing', manifestId: null,
                sourceHash: null });
        }
        const chosen = [...unique.values()][0];
        return Object.freeze({ canonicalSymbol: entry.canonicalSymbol,
            state: 'baseline_ready', reason: null, manifestId: chosen.manifest.manifestId,
            sourceHash: chosen.sourceHash });
    });
    const readyCount = items.filter((item) => item.state === 'baseline_ready').length;
    return Object.freeze({ tradeDate: plan.tradeDate, previousTradeDate: plan.previousTradeDate,
        planHash: plan.planHash, plannedCount: items.length, baselineReadyCount: readyCount,
        exact160BaselineReady: items.length === 160 && readyCount === 160,
        items: Object.freeze(items) });
}
