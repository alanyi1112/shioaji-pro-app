import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { IntradayMonitorConfigRepository, resolveIntradayMonitorDatabasePath }
    from './config-repository.mjs';
import { createIntradayMonitorDailySessionRuntimeAuthority }
    from './daily-session-runtime-authority.mjs';
import { resolveDailyMinuteVolumeFixedBaseline }
    from './daily-minute-volume-fixed-baseline.mjs';
import { readDailyMinuteVolumeMode } from './daily-minute-volume-postclose.mjs';
import { createDailyMinuteVolumeRunner } from './daily-minute-volume-runner.mjs';
import { resolveIntradayMonitorRuntimeArtifactBundle }
    from './runtime-artifact-bundle.mjs';
import { IntradayMonitorSessionStateRepository } from './session-state-repository.mjs';

export const DAILY_MINUTE_VOLUME_EXECUTION_SCHEMA = 'intraday-minute-volume-execution/1';

function admittedConfig(config, cohort) {
    const bySymbol = new Map(config.items.filter(item => item.enabled).map(item => [
        `${item.contract.code}.${item.contract.exchange === 'TSE' ? 'TW' : 'TWO'}`, item ]));
    if (bySymbol.size < cohort.cohort.length) throw new Error('daily_execution_config_cohort_missing');
    const items = cohort.cohort.map(entry => bySymbol.get(entry.canonicalSymbol));
    if (items.some(item => !item)) throw new Error('daily_execution_config_cohort_missing');
    return { ...config, items };
}

async function waitUntil(epoch, signal, nowEpochMs, onPulse = () => {}) {
    while (!signal.aborted && nowEpochMs() < epoch) {
        await new Promise(resolve => {
            const timer = setTimeout(done, Math.min(15_000, epoch - nowEpochMs()));
            function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
            signal.addEventListener('abort', done, { once: true });
        });
        if (!signal.aborted && nowEpochMs() < epoch) await onPulse();
    }
}

export async function runDailyMinuteVolumeLifecycle({ runner, tradeDate,
    signal = new AbortController().signal, nowEpochMs = () => Date.now(),
    wait = waitUntil } = {}) {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(tradeDate ?? '') ||
        !['start', 'beginClosing', 'sealClose', 'stop'].every(name =>
            typeof runner?.[name] === 'function') ||
        typeof signal?.aborted !== 'boolean' || typeof nowEpochMs !== 'function' ||
        typeof wait !== 'function') throw new TypeError('daily_execution_lifecycle_invalid');
    let started = false, closing = false, sealed = false, failure = null;
    let stop = null;
    try {
        await runner.start({ latestAllowedAt: `${tradeDate}T09:00:00+08:00` });
        started = true;
        await wait(Date.parse(`${tradeDate}T13:30:15+08:00`), signal, nowEpochMs,
            () => runner.checkHealth?.());
        if (!signal.aborted) { runner.beginClosing(); closing = true; }
        await wait(Date.parse(`${tradeDate}T13:34:30+08:00`), signal, nowEpochMs,
            () => runner.checkHealth?.());
        if (!signal.aborted && closing) { runner.sealClose(); sealed = true; }
    } catch (error) { failure = error?.message ?? 'daily_execution_failed'; }
    finally {
        if (started) {
            try { stop = await runner.stop(); }
            catch (error) { failure ??= error?.message ?? 'daily_execution_stop_failed'; }
        }
    }
    return { started, closing, sealed, interrupted: signal.aborted,
        failure, stop, outcome: stop?.receipt?.executionOutcome === 'ended' &&
            !failure && !signal.aborted ? 'complete' : 'partial' };
}

// Scheduled-only entry.  It deliberately cannot start a broker login, create a
// second SSE, place an order or manufacture a finished session on replay.
export async function runDailyMinuteVolumeExecution({ root, tradeDate,
    now = () => new Date().toISOString(), nowEpochMs = () => Date.now(),
    runnerFactory = createDailyMinuteVolumeRunner,
    signal = new AbortController().signal } = {}) {
    if (!path.isAbsolute(root ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') ||
        typeof now !== 'function' || typeof nowEpochMs !== 'function' ||
        typeof runnerFactory !== 'function' || typeof signal?.aborted !== 'boolean') {
        throw new TypeError('daily_execution_inputs_invalid');
    }
    const mode = await readDailyMinuteVolumeMode(root);
    if (mode.mode !== 'daily') throw new Error('daily_execution_mode_not_enabled');
    const session = new IntradayMonitorSessionStateRepository(root).readSession(tradeDate);
    if (!session || session.tradeDate !== tradeDate || !session.previousTradeDate ||
        session.phase !== 'starting') throw new Error('daily_execution_session_missing');
    const generation = (await readFile(path.join(root, 'runtime-api-generation'), 'utf8')).trim();
    if (generation !== session.connectionGeneration ||
        (await readFile(path.join(root, 'runtime-mode'), 'utf8')).trim() !== 'simulation') {
        throw new Error('daily_execution_generation_mismatch');
    }
    const bundle = await resolveIntradayMonitorRuntimeArtifactBundle({ appSupportRoot: root,
        bundleHash: session.artifactBundleHash });
    if (!bundle.valid) throw new Error('daily_execution_bundle_invalid');
    const cohort = JSON.parse(await readFile(bundle.files.cohort, 'utf8'));
    const configRepository = new IntradayMonitorConfigRepository(
        resolveIntradayMonitorDatabasePath(root));
    let config;
    try { config = admittedConfig(configRepository.read(), cohort); }
    finally { configRepository.close(); }
    if (config.revision !== session.configRevision ||
        cohort.manifestHash !== session.cohortHash) {
        throw new Error('daily_execution_config_mismatch');
    }
    const legacyPath = path.join(root, 'intraday-baselines',
        `${session.previousTradeDate}-for-${tradeDate}-verified`, 'baseline-set.json');
    const legacySet = await readFile(legacyPath, 'utf8').then(JSON.parse).catch(error => {
        if (error?.code === 'ENOENT') return null;
        throw error;
    });
    const gate = resolveDailyMinuteVolumeFixedBaseline({ root, cohort,
        sourceTradeDate: session.previousTradeDate, targetTradeDate: tradeDate,
        legacySet });
    if (!gate.ready || gate.baselineHash !== session.baselineHash ||
        gate.manifests.length !== 160) throw new Error('daily_execution_baseline_mismatch');
    const authority = createIntradayMonitorDailySessionRuntimeAuthority({
        appSupportRoot: root, tradeDate, connectionGeneration: generation,
        now });
    if (authority.evaluate().current !== true) {
        throw new Error('daily_execution_current_session_unverified');
    }
    const runner = runnerFactory({ appSupportRoot: root, manifests: gate.manifests,
        config, tradeDate, previousTradeDate: session.previousTradeDate,
        connectionGeneration: generation, planHash: cohort.manifestHash,
        sessionAuthority: authority, now, nowEpochMs,
        ...(mode.runtimeLimits ? { limits: mode.runtimeLimits } : {}) });
    const lifecycle = await runDailyMinuteVolumeLifecycle({ runner, tradeDate,
        signal, nowEpochMs });
    return { schemaVersion: DAILY_MINUTE_VOLUME_EXECUTION_SCHEMA,
        runtimeMode: 'daily', tradeDate, ...lifecycle, brokerWriteAuthority: false,
        productionAuthority: false, serviceLifecycleAuthority: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    const root = args.find(arg => arg.startsWith('--app-support-root='))?.slice(19);
    const tradeDate = args.find(arg => arg.startsWith('--trade-date='))?.slice(13);
    if (args.length !== 3 || !args.includes('--execute') ||
        !path.isAbsolute(root ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '')) {
        throw new Error('daily_execution_cli_invalid');
    }
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    try {
        const result = await runDailyMinuteVolumeExecution({ root, tradeDate,
            signal: controller.signal });
        process.stdout.write(`${JSON.stringify(result)}\n`);
        if (result.outcome !== 'complete') process.exitCode = 2;
    } finally {
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', interrupt);
    }
}
