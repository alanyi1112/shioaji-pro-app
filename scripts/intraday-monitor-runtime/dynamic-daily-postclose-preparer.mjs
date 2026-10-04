import { readFile } from 'node:fs/promises';

import { createDynamicDailyCohortPlan, writeDynamicDailyCohortPlan }
    from './dynamic-daily-cohort-plan.mjs';
import { resolveDynamicDailyBaselineCoverage }
    from './dynamic-daily-baseline-resolver.mjs';

export const DYNAMIC_DAILY_POSTCLOSE_PREPARER_SCHEMA =
    'intraday-monitor-daily-postclose-preparation/1';

// 排程可於盤後或隔夜帶入已確認的官方交易日、simulation session 與有界預算。
// 本函式不啟動排程、不開登入／SSE、不改現行 session；候選 plan 寫入獨立版號路徑。
export async function prepareDynamicDailyPostclose({ root, config, authority,
    approval, verifiedSets = [], standaloneManifests = [], calendar,
    budget = null, worker = null, sourceVersion = null, sessionProof = null,
    createdAt = new Date().toISOString() } = {}) {
    const plan = createDynamicDailyCohortPlan({ config, authority, approval, createdAt });
    const initial = resolveDynamicDailyBaselineCoverage({ plan,
        verifiedSets, standaloneManifests });
    const candidate = await writeDynamicDailyCohortPlan(root, plan);
    const missing = initial.items.filter((item) => item.state === 'waiting_baseline');
    if (missing.length === 0) {
        return Object.freeze({ schemaVersion: DYNAMIC_DAILY_POSTCLOSE_PREPARER_SCHEMA,
            outcome: 'baseline_ready', plan, planPath: candidate.path,
            coverage: initial, deltaReceiptPath: null, addedManifestPaths: [],
            notificationAuthority: false, subscriptionAuthority: false });
    }
    // 無效或衝突基準不得以重抓靜默掩蓋；只對真正尚缺的商品做有界差異驗證。
    if (missing.some((item) => item.reason !== 'baseline_missing') ||
        !worker || typeof worker.run !== 'function' ||
        !budget || budget.addedSymbolCount !== missing.length ||
        !calendar || !sourceVersion || !sessionProof) {
        return Object.freeze({ schemaVersion: DYNAMIC_DAILY_POSTCLOSE_PREPARER_SCHEMA,
            outcome: 'waiting_baseline', plan, planPath: candidate.path,
            coverage: initial, deltaReceiptPath: null, addedManifestPaths: [],
            notificationAuthority: false, subscriptionAuthority: false });
    }
    const delta = await worker.run({ root, plan, coverage: initial,
        calendar, budget, sourceVersion, sessionProof });
    const added = [];
    for (const item of delta.results) {
        if (item.outcome !== 'verified' || !item.manifestPath) continue;
        added.push(JSON.parse(await readFile(item.manifestPath, 'utf8')));
    }
    const coverage = resolveDynamicDailyBaselineCoverage({ plan, verifiedSets,
        standaloneManifests: [...standaloneManifests, ...added] });
    return Object.freeze({ schemaVersion: DYNAMIC_DAILY_POSTCLOSE_PREPARER_SCHEMA,
        outcome: coverage.baselineReadyCount === plan.selected.length ?
            'baseline_ready' : 'waiting_baseline',
        plan, planPath: candidate.path, coverage,
        deltaReceiptPath: delta.receiptPath,
        addedManifestPaths: delta.results.filter((item) => item.outcome === 'verified')
            .map((item) => item.manifestPath),
        notificationAuthority: false, subscriptionAuthority: false });
}
