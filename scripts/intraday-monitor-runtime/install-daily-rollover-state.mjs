import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { createPremarketScheduleReceipt } from './premarket-schedule.mjs';
import { resolvePremarketOrchestratorPaths } from './premarket-orchestrator.mjs';
import { importIntradayMonitorRuntimeArtifactBundle } from './runtime-artifact-bundle.mjs';
import { IntradayMonitorSessionStateRepository } from './session-state-repository.mjs';
import { resolveNextIntradayMonitorTradingDay } from './trading-calendar-authority.mjs';

export const INTRADAY_MONITOR_DAILY_ROLLOVER_INSTALL_SCHEMA =
    'intraday-monitor-daily-rollover-install/1';

const ARCHIVE_IDENTITY =
    '2026-09-16-evaluate-tiered-intraday-monitor-expansion-to-160';

function argument(name) {
    return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function absoluteArgument(name, fallback) {
    const value = argument(name) ?? fallback;
    if (!path.isAbsolute(value)) throw new Error(`--${name} must be an absolute path`);
    return value;
}

function artifactInputs(repoDirectory) {
    const acceptance = path.join(repoDirectory, 'openspec', 'changes', 'archive',
        ARCHIVE_IDENTITY, 'acceptance');
    return [
        { role: 'cohort',
            path: path.join(acceptance, 'tiered-cohort-stage-160-replaced-6187-2026-09-11.json'),
            schema: 'intraday-monitor-tiered-cohort-manifest/1', dependencies: [] },
        { role: 'plan',
            path: path.join(acceptance, 'direct-stage-plan-160-product-2026-09-14.json'),
            schema: 'intraday-monitor-tiered-stage-plan/3', dependencies: ['cohort'] },
        { role: 'baseline_prerequisite',
            path: path.join(acceptance, 'direct-160-prerequisite-2026-09-11.json'),
            schema: 'legacy-unversioned-json', dependencies: ['cohort', 'plan'] },
        { role: 'verifier',
            path: path.join(repoDirectory, 'openspec', 'changes',
                'repair-intraday-monitor-daily-rollover-and-status-truthfulness',
                'acceptance', 'runtime-verifier-metadata.json'),
            schema: 'intraday-monitor-runtime-verifier-metadata/1',
            dependencies: ['cohort', 'plan', 'baseline_prerequisite'] },
    ];
}

async function atomicWriteJson(target, value) {
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, target);
}

export async function installIntradayMonitorDailyRolloverState({
    execute = false,
    appSupportRoot,
    repoDirectory,
    now = new Date(),
    resolveNextTradingDay = resolveNextIntradayMonitorTradingDay,
} = {}) {
    const stagingRoot = execute ? appSupportRoot : await mkdtemp(path.join(os.tmpdir(),
        'intraday-monitor-rollover-dry-run-'));
    try {
        const bundle = await importIntradayMonitorRuntimeArtifactBundle({
            appSupportRoot: stagingRoot,
            repoDirectory,
            sourceIdentity: `openspec-archive:${ARCHIVE_IDENTITY}`,
            artifacts: artifactInputs(repoDirectory),
            createdAt: now.toISOString(),
        });
        const monitorRoot = path.join(appSupportRoot, 'IntradayMonitor');
        const legacyPath = path.join(monitorRoot, 'direct-160-product-runtime.json');
        const legacy = JSON.parse(await readFile(legacyPath, 'utf8'));
        const state = new IntradayMonitorSessionStateRepository(stagingRoot);
        const migration = state.migrateLegacyProductState(legacy, {
            artifactBundleHash: bundle.bundleHash,
        });
        const authority = await resolveNextTradingDay({ now });
        if (!authority?.current || authority.isTradingDate !== true || !authority.tradeDate) {
            throw new Error(authority?.reason ?? 'calendar_authority_unavailable');
        }
        const steps = ['08:20', '08:35', '08:45', '08:50'];
        const scheduleReceipts = steps.map((step) => createPremarketScheduleReceipt({
            requestedTradeDate: authority.tradeDate,
            requestedLocalTime: step,
            schedulerId: 'com.alanyi.realtimestock.intraday-premarket',
            computedFireAt: `${authority.tradeDate}T${step}:00+08:00`,
            readBackAt: now.toISOString(),
            officialTradingDates: [authority.tradeDate],
        }));
        if (scheduleReceipts.some((receipt) => receipt.consistency.status !== 'ready')) {
            throw new Error('scheduler_manifest_invalid');
        }
        const paths = resolvePremarketOrchestratorPaths(appSupportRoot);
        const existingConfig = JSON.parse(await readFile(paths.configPath, 'utf8'));
        const { tradeDate: _tradeDate, officialTradingDates: _officialTradingDates,
            manifestPath: _manifestPath, planPath: _planPath, baselinePath: _baselinePath,
            prerequisitePath: _prerequisitePath, manifestHash: _manifestHash,
            baselineHash: _baselineHash, ...durableConfig } = existingConfig;
        const config = {
            ...durableConfig,
            schemaVersion: 'intraday-monitor-premarket-config/2',
            timeZone: 'Asia/Taipei',
            artifactBundleHash: bundle.bundleHash,
            dailyRollover: true,
        };
        if (execute) await atomicWriteJson(paths.configPath, config);
        return Object.freeze({
            schemaVersion: INTRADAY_MONITOR_DAILY_ROLLOVER_INSTALL_SCHEMA,
            mode: execute ? 'execute' : 'dry_run',
            installed: execute,
            bundle: { valid: bundle.valid, bundleHash: bundle.bundleHash,
                sourceIdentity: bundle.manifest.sourceIdentity,
                roles: bundle.manifest.artifacts.map((item) => item.role) },
            migration: { historicalOnly: migration.migration.historicalOnly,
                currentSessionCreated: migration.migration.currentSessionCreated,
                approvalHash: migration.approval.approvalHash,
                evidenceTradeDate: migration.approval.evidenceTradeDate,
                approvedActiveLimit: migration.approval.approvedActiveLimit },
            nextTradingDay: authority,
            scheduleReceipts,
            config: { path: paths.configPath, value: config },
            originalEvidenceModified: false,
            serviceLifecycleMutations: 0,
            brokerWriteAuthority: false,
            productionAuthority: false,
        });
    } finally {
        if (!execute) await rm(stagingRoot, { recursive: true, force: true });
    }
}

async function main() {
    const execute = process.argv.includes('--execute');
    const dryRun = process.argv.includes('--dry-run');
    if (execute === dryRun) throw new Error('exactly one of --dry-run or --execute is required');
    const repoDirectory = absoluteArgument('repo-directory',
        path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'));
    const appSupportRoot = absoluteArgument('app-support-root',
        process.env.REALTIME_STOCK_APP_SUPPORT ??
            path.join(os.homedir(), 'Library', 'Application Support', 'RealTimeStock'));
    const result = await installIntradayMonitorDailyRolloverState({
        execute, appSupportRoot, repoDirectory,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
