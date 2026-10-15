import { INTRADAY_MONITOR_BASELINE_SCHEMA,
    isIntradayMonitorMinuteObservation, isTaiwanRegularLotStockContract }
    from '../../src/lib/intraday-relative-volume-monitor-domain.ts';
import { isDailyMinuteVolumeBaseline } from './daily-minute-volume-baseline.mjs';
import { isHistoricalKbarBaselineManifest } from './historical-kbar-repair.mjs';
import { IntradayMonitorEvidenceRepository } from './evidence-repository.mjs';
import { createIntradayRelativeVolumeTriggerLedger } from './relative-volume-evaluator.mjs';

export const DAILY_MINUTE_VOLUME_PRODUCT_SINK_SCHEMA = 'intraday-monitor-daily-product-sink/1';
const safe = value => Number.isSafeInteger(value) && value >= 0;
const minuteIndex = value => {
    if (!/^(?:09:[0-5]\d|1[0-2]:[0-5]\d|13:(?:[0-2]\d|30))$/.test(value ?? '')) return null;
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
};
const symbol = item => item.contract.canonicalSymbol;

export function dailyManifestAsEvidenceBaseline(manifest) {
    const v2 = isDailyMinuteVolumeBaseline(manifest);
    if (!v2 && !isHistoricalKbarBaselineManifest(manifest)) {
        throw new TypeError('daily_product_baseline_invalid');
    }
    const provenance = value => value === 'known_zero_carry_forward' ||
        value === 'historical_known_zero' ? 'known_zero' :
        value === 'historical_carry_forward' ? 'carry_forward' : 'observed';
    const rows = manifest.cumulativeSeries.map(row => ({ minuteKey: row.minuteKey,
        cumulativeVolume: row.cumulativeVolume, provenance: provenance(row.provenance) }));
    return { schemaVersion: INTRADAY_MONITOR_BASELINE_SCHEMA,
        canonicalSymbol: manifest.symbol, tradeDate: manifest.tradeDate,
        timeZone: 'Asia/Taipei', source: manifest.source,
        sourceVersion: manifest.sourceVersion, sourceUnit: 'common_lot',
        canonicalUnit: 'common_lot', expectedMinuteCount: 270,
        completeness: 'complete', rows,
        payloadHash: manifest.payloadHash.slice(7),
        fetchedAt: v2 ? manifest.fetchedAt : manifest.fetchTime };
}

// This is the product sink only: no subscription, login, Stage bundle or capture export.
// The caller must hold the shared monitor owner lease before creating the transport.
export function createDailyMinuteVolumeProductSink({ manifests, config, tradeDate,
    previousTradeDate, connectionGeneration, evidenceDatabasePath,
    sessionAuthority, thresholdRuntime = null, readSuppressedSymbols = () => [], allowMissingBaseline = false,
    now = () => new Date().toISOString() } = {}) {
    const enabled = config?.items?.filter(item => item.enabled) ?? [];
    if (!Array.isArray(manifests) || enabled.length < 1 || enabled.length > 160 ||
        (allowMissingBaseline ? manifests.length < 1 || manifests.length > enabled.length :
            manifests.length !== enabled.length) || !safe(config?.revision) ||
        typeof config?.globalThreshold !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(previousTradeDate ?? '') ||
        previousTradeDate >= tradeDate ||
        typeof connectionGeneration !== 'string' || connectionGeneration.length < 16 ||
        typeof sessionAuthority?.evaluate !== 'function' ||
        typeof readSuppressedSymbols !== 'function' || typeof allowMissingBaseline !== 'boolean' ||
        typeof evidenceDatabasePath !== 'string' || typeof now !== 'function' ||
        enabled.some(item => !isTaiwanRegularLotStockContract(item.contract)) ||
        new Set(enabled.map(symbol)).size !== enabled.length) {
        throw new TypeError('daily_product_sink_inputs_invalid');
    }
    const byManifest = new Map(manifests.map(manifest => [manifest?.symbol, manifest]));
    if (byManifest.size !== manifests.length || manifests.some(manifest =>
        !enabled.some(item => symbol(item) === manifest?.symbol)) || enabled.some(item => {
        const candidate = byManifest.get(symbol(item));
        return !candidate ? !allowMissingBaseline : !(isDailyMinuteVolumeBaseline(candidate) ||
            isHistoricalKbarBaselineManifest(candidate)) ||
            candidate.tradeDate !== previousTradeDate || candidate.targetTradeDate !== tradeDate ||
            candidate.exchange !== item.contract.exchange;
    })) throw new TypeError('daily_product_baseline_identity_invalid');

    const repository = new IntradayMonitorEvidenceRepository(evidenceDatabasePath);
    try {
        for (const manifest of manifests) {
            const baseline = dailyManifestAsEvidenceBaseline(manifest);
            const stored = repository.getBaseline(baseline.canonicalSymbol, previousTradeDate);
            if (stored) {
                if (stored.rows.length !== baseline.rows.length ||
                    stored.rows.some((row, index) => row.minuteKey !== baseline.rows[index].minuteKey ||
                        row.cumulativeVolume !== baseline.rows[index].cumulativeVolume)) {
                    throw new Error('daily_product_existing_baseline_conflict');
                }
            } else repository.putBaseline(baseline, repository.currentRevision());
        }
    } catch (error) { repository.close(); throw error; }

    const items = new Map(enabled.map(item => [symbol(item), {
        canonicalSymbol: symbol(item), exchange: item.contract.exchange,
        threshold: item.thresholdOverride ?? config.globalThreshold,
        baselineReady: byManifest.has(symbol(item)),
        state: byManifest.has(symbol(item)) ? 'awaiting_first_kbar' : 'waiting_baseline',
        reason: byManifest.has(symbol(item)) ? 'awaiting_first_kbar' : 'baseline_missing',
        lastReceivedAt: null, lastMinute: null, lastComparableMinute: null,
        currentCumulativeVolume: null, previousCumulativeVolume: null,
        lastClassification: 'unknown', firstComparableSeen: false,
        observationCount: 0, triggerCount: 0, lastSourceVersion: null, continuityComplete: false,
    }]));
    const ledger = createIntradayRelativeVolumeTriggerLedger();
    const triggerEvents = new Map();
    let ended = false;
    let lastDataReceivedAt = null;
    let comparisonFailure = null;
    let projectedTransition = null;

    function authority() {
        try { return sessionAuthority.evaluate(); }
        catch { return { current: false, dataPlaneAuthority: false,
            notificationAuthority: false, reason: 'current_session_authority_unavailable' }; }
    }

    function syncThresholds() {
        if (!thresholdRuntime || ended) return { applied: false, reason: 'threshold_runtime_not_loaded' };
        try {
            const result = thresholdRuntime.sync([...items.values()].map(item => item.lastMinute === null ||
                item.lastReceivedAt === null || item.lastSourceVersion === null
                ? { canonicalSymbol: item.canonicalSymbol, minuteKey: null }
                : { canonicalSymbol: item.canonicalSymbol, minuteKey: item.lastMinute,
                    currentCumulativeVolume: item.currentCumulativeVolume,
                    previousCumulativeVolume: item.previousCumulativeVolume,
                    receivedAt: item.lastReceivedAt, sourceVersion: item.lastSourceVersion,
                    continuityComplete: item.continuityComplete, baselineComplete: item.baselineReady,
                    sourceComplete: item.continuityComplete }), authority());
            if (result.applied) {
                const state = thresholdRuntime.snapshot();
                for (const value of state.thresholds) items.get(value.canonicalSymbol).threshold = value.threshold;
                // Reclassification is an idempotent historical result, never a live notification.
                if (state.transitionHash !== projectedTransition) {
                    for (const event of state.reclassifiedEvents ?? []) {
                        const inserted = repository.appendTrigger(event, repository.currentRevision());
                        if (inserted.inserted) items.get(event.canonicalSymbol).triggerCount += 1;
                        triggerEvents.set(event.canonicalSymbol, event);
                    }
                    projectedTransition = state.transitionHash;
                }
                comparisonFailure = null;
            } else comparisonFailure = result.reason ?? 'threshold_switch_failed';
            return result;
        } catch {
            // A comparison transition failure cannot reject a legitimate market observation.
            comparisonFailure = 'threshold_transition_projection_failed';
            return { applied: false, reason: comparisonFailure };
        }
    }

    function receive(observation) {
        const item = items.get(observation?.contract?.canonicalSymbol);
        if (ended || !item || !isIntradayMonitorMinuteObservation(observation) ||
            observation.tradeDate !== tradeDate ||
            observation.connectionGeneration !== connectionGeneration ||
            observation.contract.exchange !== item.exchange ||
            observation.unit !== 'common_lot' || observation.source !== 'shioaji-kbar-stream') {
            return { accepted: false, reason: 'daily_observation_envelope_invalid' };
        }
        syncThresholds();
        const current = authority();
        if (current.current !== true || current.dataPlaneAuthority !== true) {
            return { accepted: false, reason: current.reason ?? 'daily_session_not_current' };
        }
        const index = minuteIndex(observation.minuteKey);
        if (index === null || item.lastMinute && index <= minuteIndex(item.lastMinute)) {
            return { accepted: false, reason: 'daily_observation_minute_not_advancing' };
        }
        const prior = minuteIndex(item.lastMinute);
        const contiguous = item.state !== 'waiting_continuity' &&
            observation.continuity === 'complete' &&
            (prior === null ? observation.minuteKey === '09:01' : index === prior + 1);
        const persisted = contiguous ? observation : { ...observation, continuity: 'partial' };
        try {
            const saved = repository.appendObservation(persisted, repository.currentRevision());
            if (saved.inserted) item.observationCount += 1;
            item.lastMinute = observation.minuteKey;
            item.lastReceivedAt = observation.receivedTime;
            item.currentCumulativeVolume = observation.cumulativeVolume;
            lastDataReceivedAt = observation.receivedTime;
            // The API reads the durable session projection, not the sink's in-memory
            // watermark. Persist the same sealed minute and its baseline before
            // updating that projection; a missing baseline remains explicitly null.
            const baseline = item.baselineReady ? repository.getBaselineMinute(
                item.canonicalSymbol, previousTradeDate, observation.minuteKey) : null;
            item.previousCumulativeVolume = baseline?.cumulativeVolume ?? null;
            item.lastSourceVersion = observation.sourceVersion;
            item.continuityComplete = contiguous;
            try { sessionAuthority.recordObservation?.({ canonicalSymbol: item.canonicalSymbol,
                receivedAt: observation.receivedTime, continuityComplete: contiguous,
                completedMinute: observation.minuteKey,
                currentCumulativeVolume: observation.cumulativeVolume,
                previousCumulativeVolume: item.previousCumulativeVolume }); }
            catch { item.state = 'degraded'; item.reason = 'current_session_update_failed';
                return { accepted: false, reason: item.reason }; }
            if (!item.baselineReady) {
                item.state = 'waiting_baseline'; item.reason = 'baseline_missing';
                return { accepted: true, comparable: false, reason: item.reason,
                    notificationEligible: false };
            }
            if (!contiguous) {
                item.state = 'waiting_continuity';
                item.reason = 'minute_continuity_unknown';
                return { accepted: true, comparable: false, reason: item.reason };
            }
            const suppressed = readSuppressedSymbols();
            if (!Array.isArray(suppressed) ||
                suppressed.some(value => typeof value !== 'string')) {
                item.state = 'degraded'; item.reason = 'daily_suppression_unavailable';
                return { accepted: false, reason: item.reason };
            }
            if (suppressed.includes(item.canonicalSymbol)) {
                item.state = 'suppressed'; item.reason = 'comparison_suppressed';
                return { accepted: true, comparable: false,
                    reason: item.reason, notificationEligible: false };
            }
            const input = { admitted: true, tradeDate,
                baselineTradeDate: previousTradeDate, canonicalSymbol: item.canonicalSymbol,
                exchange: item.exchange, minuteKey: observation.minuteKey,
                configRevision: config.revision, threshold: item.threshold,
                currentCumulativeVolume: observation.cumulativeVolume,
                previousCumulativeVolume: baseline?.cumulativeVolume ?? 0,
                todayCompleteness: 'complete',
                baselineCompleteness: baseline ? 'complete' : 'missing',
                calendarCurrent: current.current === true,
                sessionCurrent: current.dataPlaneAuthority === true,
                generationCurrent: true, continuityComplete: true,
                unit: 'common_lot', sourceVersion: observation.sourceVersion,
                observationMode: 'live', revisionFirstComparable: !item.firstComparableSeen,
                createdAt: observation.receivedTime };
            const result = thresholdRuntime && thresholdRuntime.snapshot().journalHealthy === false
                ? { comparable:false,classification:'unknown',notificationEligible:false,newlyCreated:false,triggerEvent:null }
                : thresholdRuntime
                ? thresholdRuntime.core.evaluate(input, thresholdRuntime.authority(current))
                : ledger.evaluate(input);
            if (result.comparable) {
                item.firstComparableSeen = true;
                item.lastComparableMinute = observation.minuteKey;
            }
            if (result.triggerEvent && result.newlyCreated) {
                const inserted = repository.appendTrigger(result.triggerEvent, repository.currentRevision());
                if (inserted.inserted) item.triggerCount += 1;
                triggerEvents.set(item.canonicalSymbol, result.triggerEvent);
            }
            item.state = 'active'; item.reason = 'none';
            item.lastClassification = result.classification;
            return { accepted: true, comparable: result.comparable,
                classification: result.classification, triggerCreated: result.newlyCreated,
                notificationEligible: result.notificationEligible &&
                    current.notificationAuthority === true && current.phase !== 'closing' };
        } catch {
            item.state = 'degraded'; item.reason = 'evidence_persistence_failed';
            return { accepted: false, reason: item.reason };
        }
    }

    function installHistoricalGap(receipt) {
        const item = items.get(receipt?.canonicalSymbol);
        const rows = receipt?.rows;
        if (ended || !item || receipt?.schemaVersion !==
            'intraday-monitor-direct-160-gap-bootstrap/1' ||
            receipt.tradeDate !== tradeDate || receipt.liveGeneration !== connectionGeneration ||
            receipt.source !== 'shioaji-kbars-bootstrap' ||
            receipt.stableRefetch !== true || receipt.rangeHash !== receipt.refetchRangeHash ||
            receipt.liveDelivered !== false || receipt.notificationAuthority !== false ||
            receipt.retroactiveTriggerEligible !== false ||
            !Array.isArray(rows) || rows.length !== receipt.expectedMinuteCount ||
            rows[0]?.minuteKey !== '09:01' ||
            rows.at(-1)?.minuteKey !== receipt.requestedMinuteEnd) {
            return { installed: false, reason: 'daily_historical_gap_invalid' };
        }
        const boundary = item.lastMinute && rows.find(row => row.minuteKey === item.lastMinute);
        if (item.lastMinute && (!boundary || boundary.cumulativeVolume !== item.currentCumulativeVolume)) {
            item.state = 'degraded'; item.reason = 'historical_live_boundary_conflict';
            return { installed: false, reason: item.reason };
        }
        const contract = enabled.find(entry => symbol(entry) === receipt.canonicalSymbol).contract;
        const start = item.lastMinute ? minuteIndex(item.lastMinute) + 1 : minuteIndex('09:01');
        const missing = rows.filter(row => minuteIndex(row.minuteKey) >= start);
        if (!missing.length) return { installed: false, reason: 'daily_historical_gap_empty' };
        const observations = missing.map(row => ({
            schemaVersion: 'intraday-monitor-observation/1', contract, tradeDate,
            minuteKey: row.minuteKey, exchangeTime: `${row.minuteKey}:59`,
            receivedTime: receipt.refetchedAt,
            connectionGeneration: `bootstrap_${receipt.rangeHash.slice(7, 55)}`,
            sequence: rows.findIndex(value => value.minuteKey === row.minuteKey) + 1,
            cumulativeVolume: row.cumulativeVolume, unit: 'common_lot',
            source: 'shioaji-kbars-bootstrap', sourceVersion: receipt.sourceVersion,
            simtrade: false, intradayOdd: false, continuity: 'complete',
        }));
        try {
            const result = repository.appendBootstrappedObservations(observations,
                repository.currentRevision());
            item.observationCount += result.inserted;
            item.lastMinute = rows.at(-1).minuteKey;
            item.currentCumulativeVolume = rows.at(-1).cumulativeVolume;
            item.state = 'waiting_live_overlap'; item.reason = 'historical_gap_verified';
            // Historical rows are durable evidence only. They never enter the
            // trigger ledger, data-activity clock, or notification path.
            return { installed: true, inserted: result.inserted,
                lastHistoricalMinute: item.lastMinute, receiptHash: receipt.receiptHash,
                notificationAuthority: false };
        } catch {
            item.state = 'degraded'; item.reason = 'historical_evidence_conflict';
            return { installed: false, reason: item.reason };
        }
    }

    function snapshot() {
        return { schemaVersion: DAILY_MINUTE_VOLUME_PRODUCT_SINK_SCHEMA,
            runtimeMode: 'daily', tradeDate, previousTradeDate, connectionGeneration,
            configRevision: config.revision, phase: ended ? 'ended' : 'running',
            lastDataReceivedAt, diagnostics: 'not_requested',
            thresholdSwitch: thresholdRuntime?.snapshot() ?? null, comparisonFailure,
            items: [...items.values()].map(item => ({ ...item })),
            triggerEvents: [...triggerEvents.values()],
            brokerWriteAuthority: false, productionAuthority: false,
            serviceLifecycleAuthority: false, notificationAuthority: !ended &&
                authority().notificationAuthority === true, updatedAt: now() };
    }

    function close() {
        ended = true;
        const aggregate = repository.summarizeDailyTradeDate(tradeDate);
        const result = { ...snapshot(), aggregate };
        repository.close();
        return result;
    }
    return Object.freeze({ receive, syncThresholds, installHistoricalGap, snapshot, close });
}
