import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { INTRADAY_MONITOR_CONFIG_SCHEMA,
    validateIntradayMonitorConfig }
    from '../../src/lib/intraday-relative-volume-monitor-domain.ts';
import { resolveIntradayMonitorDatabasePath }
    from './config-repository.mjs';
import { validateDirect160BaselineSet } from './direct-160-baseline.mjs';
import { resolveDynamicDailyBaselineCoverage }
    from './dynamic-daily-baseline-resolver.mjs';
import { createDynamicDailyCohortPlan }
    from './dynamic-daily-cohort-plan.mjs';
import { resolveIntradayMonitorDailyBaselinePath }
    from './premarket-daily-session.mjs';
import { resolveIntradayMonitorRuntimeArtifactBundleSync }
    from './runtime-artifact-bundle.mjs';
import { IntradayMonitorSessionStateRepository }
    from './session-state-repository.mjs';
import { resolveNextIntradayMonitorTradingDay }
    from './trading-calendar-authority.mjs';

function readSavedConfig(root) {
    const db = new DatabaseSync(resolveIntradayMonitorDatabasePath(root),
        { readOnly: true });
    try {
        const header = db.prepare(`SELECT schema_version, revision, global_threshold
            FROM intraday_monitor_config WHERE singleton_key = 1`).get();
        const rows = db.prepare(`SELECT security_type, region, exchange, code,
            target_code, enabled, threshold_override, source
            FROM intraday_monitor_config_items ORDER BY position`).all();
        const result = validateIntradayMonitorConfig({
            schemaVersion: INTRADAY_MONITOR_CONFIG_SCHEMA,
            revision: header?.revision, globalThreshold: header?.global_threshold,
            items: rows.map((row) => ({ contract: {
                security_type: row.security_type, region: row.region,
                exchange: row.exchange, code: row.code,
                target_code: row.target_code }, enabled: row.enabled === 1,
            thresholdOverride: row.threshold_override, source: row.source })) });
        if (!result.ok || header.schema_version !== INTRADAY_MONITOR_CONFIG_SCHEMA) {
            throw new Error('daily_audit_config_invalid');
        }
        return result.value;
    } finally { db.close(); }
}

// 唯讀 shadow audit：不產生 plan、Gate、claim 或 subscription，也不查歷史行情。
export async function auditDynamicDailyBaseline({ root, now = new Date(),
    authorityResolver = resolveNextIntradayMonitorTradingDay } = {}) {
    if (!path.isAbsolute(root ?? '') || !(now instanceof Date) ||
        !Number.isFinite(now.valueOf())) throw new TypeError('daily_audit_input_invalid');
    const authority = await authorityResolver({ now });
    if (authority?.current !== true || authority.isTradingDate !== true) {
        throw new Error('daily_audit_calendar_unavailable');
    }
    const approval = new IntradayMonitorSessionStateRepository(root).readApproval();
    if (approval?.decision !== 'go' || approval.approvedActiveLimit !== 160) {
        throw new Error('daily_audit_capacity_approval_missing');
    }
    const bundle = resolveIntradayMonitorRuntimeArtifactBundleSync({
        appSupportRoot: root, bundleHash: approval.artifactBundleHash });
    if (!bundle.valid) throw new Error('daily_audit_bundle_invalid');
    const cohortManifest = JSON.parse(await readFile(bundle.files.cohort, 'utf8'));
    const baseline = JSON.parse(await readFile(resolveIntradayMonitorDailyBaselinePath(
        root, { tradeDate: authority.tradeDate,
            previousTradeDate: authority.previousTradeDate }), 'utf8'));
    if (!validateDirect160BaselineSet(baseline, cohortManifest,
        authority.tradeDate)) throw new Error('daily_audit_baseline_invalid');
    const config = readSavedConfig(root);
    const plan = createDynamicDailyCohortPlan({ config, authority,
        approval, createdAt: now.toISOString() });
    const coverage = resolveDynamicDailyBaselineCoverage({ plan,
        verifiedSets: [{ baseline, cohortManifest }] });
    return Object.freeze({ schemaVersion: 'intraday-monitor-daily-baseline-shadow-audit/1',
        tradeDate: plan.tradeDate, previousTradeDate: plan.previousTradeDate,
        configRevision: config.revision, configuredCount: config.items.length,
        shadowPlanHash: plan.planHash, plannedCount: plan.selected.length,
        waitingCapacityCount: plan.waiting.length,
        baselineReadyCount: coverage.baselineReadyCount,
        waitingBaselineCount: coverage.items.filter((item) =>
            item.state === 'waiting_baseline').length,
        exact160BaselineReady: coverage.exact160BaselineReady,
        verifiedSetHash: baseline.baselineHash,
        calendarSourceVersions: plan.calendarSourceVersions,
        writePerformed: false, subscriptionAuthority: false,
        notificationAuthority: false, brokerWriteAuthority: false,
        productionAuthority: false });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = process.argv.find((arg) => arg.startsWith('--root='))?.slice(7);
    auditDynamicDailyBaseline({ root }).then((result) => {
        process.stdout.write(`${JSON.stringify(result)}\n`);
    }).catch((error) => {
        process.stderr.write(`${String(error?.message ?? error)}\n`);
        process.exitCode = 1;
    });
}
