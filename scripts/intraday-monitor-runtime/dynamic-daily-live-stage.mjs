import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createDynamicDailyAdmission, recordDynamicDailyDataEvidence,
    recordDynamicDailySubscription } from './dynamic-daily-admission.mjs';
import { evaluateDynamicDailySealedObservation }
    from './dynamic-daily-observation-evaluator.mjs';
import { validateDynamicDailyFinalGateReceipt }
    from './dynamic-daily-premarket-gate.mjs';
import { claimDynamicDailyRun, resolveDynamicDailySharedRegistryDirectory }
    from './dynamic-daily-run-registry.mjs';
import { DYNAMIC_DAILY_STORAGE } from './dynamic-daily-storage.mjs';
import { createBoundedKbarTransport } from './bounded-kbar-transport.mjs';
import { createIntradayMonitorKbarShadowSession }
    from './kbar-shadow-session-recorder.mjs';
import { isHistoricalKbarBaselineManifest } from './historical-kbar-repair.mjs';
import { readDynamicDailyActivePlan, validateDynamicDailyActivePlan }
    from './dynamic-daily-active-plan.mjs';

export const DYNAMIC_DAILY_LIVE_STAGE_SCHEMA = 'intraday-monitor-daily-live-stage/1';

// 只供下一個已通過 08:45 Gate 的 session 啟用。今日 feature-off 路徑不呼叫 start。
// 與歷史 Stage 共用排他 run registry，且整個 daily plan 只開一條有界 SSE／一次 batch。
export function createDynamicDailyLiveStage({ plan, coverage, manifests,
    finalGate, appSupportRoot, fetchImpl = fetch,
    now = () => new Date().toISOString(), nowEpochMs = () => Date.now() } = {}) {
    if (!validateDynamicDailyFinalGateReceipt(finalGate, plan) ||
        !Array.isArray(manifests) ||
        coverage?.planHash !== plan.planHash ||
        coverage.tradeDate !== plan.tradeDate ||
        coverage.previousTradeDate !== plan.previousTradeDate ||
        coverage?.baselineReadyCount !== manifests.length ||
        coverage?.baselineReadyCount !== finalGate.baselineReadyCount ||
        !Array.isArray(coverage.items) ||
        coverage.items.length !== plan.selected.length ||
        manifests.length < 1 || manifests.length > plan.selected.length ||
        plan.selected.some((entry, index) => {
            const manifest = manifests.find((value) => value?.symbol === entry.canonicalSymbol);
            const item = coverage.items[index];
            if (item?.canonicalSymbol !== entry.canonicalSymbol) return true;
            if (item.state === 'waiting_baseline') return manifest !== undefined ||
                item.manifestId !== null || item.sourceHash !== null;
            return item.state !== 'baseline_ready' ||
                !isHistoricalKbarBaselineManifest(manifest) ||
                manifest.manifestId !== item.manifestId ||
                manifest.exchange !== entry.exchange ||
                manifest.tradeDate !== plan.previousTradeDate ||
                manifest.targetTradeDate !== plan.tradeDate;
        }) ||
        typeof appSupportRoot !== 'string' ||
        typeof fetchImpl !== 'function' || typeof now !== 'function' ||
        typeof nowEpochMs !== 'function') {
        throw new TypeError('daily_live_stage_gate_invalid');
    }
    let admission = createDynamicDailyAdmission({ plan, coverage });
    const registryDirectory = resolveDynamicDailySharedRegistryDirectory(appSupportRoot);
    const generation = finalGate.connectionGeneration;
    const evaluated = new Map();
    const session = createIntradayMonitorKbarShadowSession({
        cohort: admission.contracts, tradeDate: plan.tradeDate,
        connectionGeneration: generation, startedAt: now(),
        nowEpochMs, storageProfile: DYNAMIC_DAILY_STORAGE,
        onObservation(observation) {
            try {
                const result = evaluateDynamicDailySealedObservation({ plan, coverage,
                    manifests, finalGate, observation, connectionGeneration: generation });
                const key = `${result.canonicalSymbol}|${result.minuteKey}`;
                if (evaluated.has(key)) return { accepted: false };
                admission = recordDynamicDailyDataEvidence(admission, {
                    planHash: plan.planHash, tradeDate: plan.tradeDate,
                    canonicalSymbol: result.canonicalSymbol,
                    baselineManifestId: result.baselineManifestId,
                    sameGeneration: true, liveKbar: true, unit: 'common_lot',
                    minuteKey: result.minuteKey,
                    currentCumulativeVolume: result.currentCumulativeVolume,
                    previousCumulativeVolume: result.previousCumulativeVolume,
                    sealedMinuteComplete: true,
                    baselineMinuteMatched: result.previousCumulativeVolume !== null,
                    receivedAt: observation.receivedTime,
                });
                evaluated.set(key, result);
                return { accepted: true };
            } catch { return { accepted: false }; }
        },
    });
    const transport = createBoundedKbarTransport({ fetchImpl,
        storageProfile: DYNAMIC_DAILY_STORAGE, now,
        onEvent: (event) => session.recordKbar(event),
        onDisconnect: (value) => session.markDisconnected(value) });
    let claim = null;
    let phase = 'idle';
    let startReceipt = null;
    let stopReceipt = null;
    return Object.freeze({
        schemaVersion: DYNAMIC_DAILY_LIVE_STAGE_SCHEMA,
        async start() {
            if (phase !== 'idle') throw new Error('daily_live_stage_already_used');
            if (Date.parse(now()) < Date.parse(finalGate.checkedAt) ||
                Date.parse(now()) >= Date.parse(`${plan.tradeDate}T09:00:00+08:00`)) {
                throw new Error('daily_live_stage_start_window_closed');
            }
            const saved = await readDynamicDailyActivePlan(appSupportRoot, plan.tradeDate);
            if (!saved) throw new Error('daily_live_stage_active_plan_missing');
            if (!validateDynamicDailyActivePlan(saved.active, plan, finalGate)) {
                throw new Error('daily_live_stage_active_plan_mismatch');
            }
            if (saved.baselineGate.items.some((item, index) =>
                item.canonicalSymbol !== coverage.items[index].canonicalSymbol ||
                item.manifestId !== coverage.items[index].manifestId ||
                item.sourceHash !== coverage.items[index].sourceHash)) {
                throw new Error('daily_live_stage_baseline_evidence_mismatch');
            }
            const [mode, currentGeneration] = await Promise.all([
                readFile(path.join(appSupportRoot, 'runtime-mode'), 'utf8'),
                readFile(path.join(appSupportRoot, 'runtime-api-generation'), 'utf8'),
            ]).catch(() => { throw new Error('daily_live_stage_generation_unavailable'); });
            if (mode.trim() !== 'simulation' || currentGeneration.trim() !== generation) {
                throw new Error('daily_live_stage_generation_mismatch');
            }
            claim = await claimDynamicDailyRun({ directory: registryDirectory,
                connectionGeneration: generation, planHash: plan.planHash,
                tradeDate: plan.tradeDate, claimedAt: now() });
            phase = 'starting';
            try {
                startReceipt = await transport.start({ contracts: admission.contracts,
                    connectionGeneration: generation });
                admission = recordDynamicDailySubscription(admission, {
                    planHash: plan.planHash, tradeDate: plan.tradeDate,
                    cohortSize: startReceipt.cohortSize,
                    canonicalSymbols: admission.contracts.map((item) => item.canonicalSymbol),
                    sharedSession: true, sameGeneration: true,
                    secondLogin: false, secondStream: false, rotation: false,
                    batchCount: 1, subscribeAccepted: startReceipt.subscribeAccepted });
                phase = 'running';
                return Object.freeze({ ...startReceipt, planHash: plan.planHash,
                    notificationAuthority: false });
            } catch (error) {
                phase = 'failed';
                await transport.stop().catch(() => {});
                await claim.release();
                throw error;
            }
        },
        async stop() {
            if (phase !== 'running') return Object.freeze({ stopped: false,
                reason: 'daily_live_stage_not_running' });
            phase = 'stopping';
            try { stopReceipt = await transport.stop(); }
            finally { await claim.release(); phase = 'stopped'; }
            return stopReceipt;
        },
        status() { return Object.freeze({ phase, planHash: plan.planHash,
            tradeDate: plan.tradeDate, connectionGeneration: generation,
            admission, shadow: session.status(), transport: transport.status(),
            evaluatedCount: evaluated.size, startReceipt, stopReceipt,
            notificationAuthority: false, notificationDispatchCount: 0,
            brokerWriteAuthority: false, productionAuthority: false }); },
        evaluations() { return Object.freeze([...evaluated.values()]); },
    });
}
