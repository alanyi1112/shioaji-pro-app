import { createHash } from 'node:crypto';
import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';
import { validateIntradayMonitorConfig } from '../../src/lib/intraday-relative-volume-monitor-domain.ts';
import { createIntradayRelativeVolumeTriggerLedger, evaluateIntradayRelativeVolume }
    from './relative-volume-evaluator.mjs';

export const THRESHOLD_SWITCH_SCHEMA = 'intraday-monitor-threshold-switch/1';
const instant = value => typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
const count = value => Number.isSafeInteger(value) && value >= 0;
function frozen(value) {
    for (const child of Object.values(value ?? {})) {
        if (child && typeof child === 'object') frozen(child);
    }
    return Object.freeze(value);
}
const hash = value => createHash('sha256').update(canonicalJson(value,
    { maximumBytes: 512 * 1024 })).digest('hex');
function configSnapshot(value) {
    const validated = validateIntradayMonitorConfig(value);
    if (!validated.ok) throw new Error('threshold_config_invalid');
    const normalized = validated.value;
    const config = frozen({ schemaVersion: normalized.schemaVersion,
        revision: normalized.revision, globalThreshold: normalized.globalThreshold,
        items: normalized.items.map(item => ({ contract: { ...item.contract },
            enabled: item.enabled, source: item.source,
            thresholdOverride: item.thresholdOverride,
            effectiveThreshold: item.effectiveThreshold.decimal })) });
    const request = frozen({ schemaVersion: config.schemaVersion, revision: config.revision,
        globalThreshold: config.globalThreshold, items: normalized.items.map(item => ({
            contract: {security_type:item.contract.securityType,region:item.contract.region,
                exchange:item.contract.exchange,code:item.contract.code,target_code:item.contract.targetCode},
            enabled:item.enabled,thresholdOverride:item.thresholdOverride,source:item.source })) });
    return { config, request, configHash: hash(config), structureHash: hash({
        schemaVersion: config.schemaVersion,
        items: config.items.map(({ contract, enabled, source }) => ({ contract, enabled, source })) }) };
}
export const thresholdConfigProof = value => configSnapshot(value);
export function thresholdConfigForRequest(value) {
    return configSnapshot({schemaVersion:value.schemaVersion,revision:value.revision,
        globalThreshold:value.globalThreshold,items:value.items.map(item=>({
            contract:{security_type:item.contract.securityType,region:item.contract.region,
                exchange:item.contract.exchange,code:item.contract.code,target_code:item.contract.targetCode},
            enabled:item.enabled,thresholdOverride:item.thresholdOverride,source:item.source}))}).request;
}
export const thresholdTransitionHash = value => {
    const {transitionHash:ignored,...body}=value;
    return hash(body);
};
export function isThresholdConfigCompatibility(value,session,savedRevision) {
    try {
        const base=thresholdConfigProof(value?.startConfig),saved=thresholdConfigProof(value?.savedConfig);
        return value.schemaVersion==='intraday-monitor-threshold-config-compatibility/1'&&
            value.ownerVerified===true&&value.sessionId===session?.sessionId&&
            value.tradeDate===session.tradeDate&&value.connectionGeneration===session.connectionGeneration&&
            base.config.revision===session.configRevision&&saved.config.revision===savedRevision&&
            savedRevision>=session.configRevision&&base.structureHash===saved.structureHash;
    }catch{return false;}
}
function failure(reason) { throw new Error(reason); }

// An isolated, synchronous handoff core. No filesystem, HTTP, subscription or
// service lifecycle ports exist here. The real owner must supply a durable,
// synchronous append/CAS port; an API save is not a runtime acknowledgement.
export function createThresholdSwitchController({ config, sessionId, ownerId,
    tradeDate, previousTradeDate, connectionGeneration, activeSymbols,
    persistTransition, persistFailure = () => ({ persisted: false }),
    now = () => new Date().toISOString() } = {}) {
    let active = configSnapshot(config);
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 160 ||
        typeof ownerId !== 'string' || !ownerId || ownerId.length > 160 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(previousTradeDate ?? '') || previousTradeDate >= tradeDate ||
        !/^simulation:[A-Za-z0-9_-]{16,100}$/.test(connectionGeneration ?? '') ||
        !Array.isArray(activeSymbols) || activeSymbols.length < 1 || activeSymbols.length > 160 ||
        new Set(activeSymbols).size !== activeSymbols.length ||
        activeSymbols.some(symbol => !active.config.items.some(item =>
            item.enabled && item.contract.canonicalSymbol === symbol)) ||
        typeof persistTransition !== 'function' || typeof persistFailure !== 'function' ||
        typeof now !== 'function') throw new TypeError('threshold_controller_inputs_invalid');
    const symbols = Object.freeze([...activeSymbols]);
    const structuralHash = active.structureHash;
    const startRevision = active.config.revision;
    const epochs = new Map(symbols.map(symbol => [symbol, {
        revision: startRevision, ledger: createIntradayRelativeVolumeTriggerLedger(), firstSeen: false,
        lastMinute:null,lastCumulativeVolume:null } ]));
    let lastReceipt = null, lastFailure = null, restoringReceipt = null;

    function checkAuthority(authority) {
        if (authority?.current !== true || authority.dataPlaneAuthority !== true ||
            authority.sessionId !== sessionId || authority.ownerId !== ownerId ||
            authority.tradeDate !== tradeDate || authority.connectionGeneration !== connectionGeneration ||
            !['running', 'closing'].includes(authority.phase)) failure('threshold_source_authority_invalid');
    }
    function effectiveThreshold(snapshot, symbol) {
        return snapshot.config.items.find(item => item.contract.canonicalSymbol === symbol).effectiveThreshold;
    }
    function watermarkSnapshot(values, effectiveAt) {
        if (!Array.isArray(values) || values.length !== symbols.length ||
            new Set(values.map(v => v?.canonicalSymbol)).size !== symbols.length ||
            values.some(v => !symbols.includes(v?.canonicalSymbol))) failure('threshold_watermarks_invalid');
        return symbols.map(symbol => {
            const value = values.find(v => v.canonicalSymbol === symbol);
            if (value.minuteKey === null) {
                if (Object.keys(value).length !== 2) failure('threshold_watermarks_invalid');
                return { canonicalSymbol: symbol, minuteKey: null };
            }
            const keys = ['canonicalSymbol', 'minuteKey', 'currentCumulativeVolume',
                'previousCumulativeVolume', 'receivedAt', 'sourceVersion', 'continuityComplete',
                'baselineComplete', 'sourceComplete'];
            if (Object.keys(value).length !== keys.length || !keys.every(k => Object.hasOwn(value,k)) ||
                !/^(?:09:(?:0[1-9]|[1-5]\d)|1[0-2]:[0-5]\d|13:(?:[0-2]\d|30))$/.test(value.minuteKey ?? '') ||
                !count(value.currentCumulativeVolume) ||
                !(value.previousCumulativeVolume === null || count(value.previousCumulativeVolume)) ||
                !instant(value.receivedAt) || Date.parse(value.receivedAt) > Date.parse(effectiveAt) ||
                Date.parse(`${tradeDate}T${value.minuteKey}:00+08:00`) > Date.parse(value.receivedAt) ||
                typeof value.sourceVersion !== 'string' || !value.sourceVersion || value.sourceVersion.length > 256 ||
                !['continuityComplete','baselineComplete','sourceComplete'].every(k => typeof value[k] === 'boolean')) {
                failure('threshold_watermarks_invalid');
            }
            // Only this small sealed watermark is retained, never a full-day tape.
            return Object.fromEntries(keys.map(k => [k,value[k]]));
        });
    }
    function seedInput(snapshot, watermark, effectiveAt, phase) {
        if (watermark.minuteKey === null) return null;
        const item = snapshot.config.items.find(v => v.contract.canonicalSymbol === watermark.canonicalSymbol);
        const fresh = Date.parse(effectiveAt) - Date.parse(watermark.receivedAt) <=
            (phase === 'closing' ? 600_000 : 120_000);
        return { admitted: true, tradeDate, baselineTradeDate: previousTradeDate,
            canonicalSymbol: watermark.canonicalSymbol, exchange: item.contract.exchange,
            minuteKey: watermark.minuteKey, configRevision: snapshot.config.revision,
            threshold: item.effectiveThreshold,
            currentCumulativeVolume: watermark.currentCumulativeVolume,
            previousCumulativeVolume: watermark.previousCumulativeVolume ?? 0,
            todayCompleteness: watermark.sourceComplete ? 'complete' : 'incomplete',
            baselineCompleteness: watermark.baselineComplete ? 'complete' : 'missing',
            calendarCurrent: true, sessionCurrent: true, generationCurrent: true,
            continuityComplete: watermark.continuityComplete && fresh,
            unit: 'common_lot', sourceVersion: watermark.sourceVersion,
            observationMode: 'historical', revisionFirstComparable: true, createdAt: effectiveAt };
    }
    function apply({ config: requested, expectedComparisonRevision, watermarks, authority } = {}) {
        try {
            checkAuthority(authority);
            const effectiveAt = restoringReceipt?.effectiveAt ?? now();
            if (!instant(effectiveAt) ||
                Date.parse(effectiveAt) < Date.parse(`${tradeDate}T09:00:00+08:00`) ||
                Date.parse(effectiveAt) > Date.parse(`${tradeDate}T13:34:30+08:00`) ||
                lastReceipt && Date.parse(effectiveAt) < Date.parse(lastReceipt.effectiveAt)) {
                failure('threshold_switch_window_invalid');
            }
            if (expectedComparisonRevision !== active.config.revision) failure('threshold_revision_conflict');
            const candidate = configSnapshot(requested);
            if (candidate.structureHash !== structuralHash) failure('threshold_only_change_required');
            if (candidate.config.revision === active.config.revision && candidate.configHash === active.configHash) {
                return frozen({ applied: true, alreadyPresent: true, changed: false,
                    activeRevision: active.config.revision, receipt: lastReceipt, notificationEligible: false });
            }
            if (candidate.config.revision <= active.config.revision) failure('threshold_revision_conflict');
            const sealed = watermarkSnapshot(watermarks,effectiveAt);
            for (const watermark of sealed) {
                const epoch=epochs.get(watermark.canonicalSymbol);
                if (epoch.lastMinute && (watermark.minuteKey===null ||
                    watermark.minuteKey < epoch.lastMinute ||
                    watermark.currentCumulativeVolume < epoch.lastCumulativeVolume ||
                    watermark.minuteKey===epoch.lastMinute &&
                    watermark.currentCumulativeVolume!==epoch.lastCumulativeVolume)) {
                    failure('threshold_watermark_regression');
                }
            }
            const changed = symbols.filter(symbol =>
                effectiveThreshold(candidate,symbol) !== effectiveThreshold(active,symbol));
            const prepared = changed.map(symbol => {
                const watermark = sealed.find(v => v.canonicalSymbol === symbol);
                const input = seedInput(candidate,watermark,effectiveAt,authority.phase);
                const ledger=createIntradayRelativeVolumeTriggerLedger();
                const result = input ? ledger.evaluate(input) :
                    { classification:'unknown', reason:'no_sealed_minute', comparable:false };
                return { symbol,input,result,ledger };
            });
            const body = { schemaVersion: THRESHOLD_SWITCH_SCHEMA, state:'applied',
                sessionId,ownerId,tradeDate,previousTradeDate,connectionGeneration,phase:authority.phase,
                startConfigRevision:startRevision,previousComparisonRevision:active.config.revision,
                comparisonRevision:candidate.config.revision,previousConfigHash:active.configHash,
                configHash:candidate.configHash,structureHash:structuralHash,
                previousTransitionHash:lastReceipt?.transitionHash ?? null,
                globalThreshold:candidate.config.globalThreshold,configSnapshot:candidate.request,effectiveAt,
                changedSymbols:changed,
                effectiveThresholds:symbols.map(symbol => ({ canonicalSymbol:symbol,
                    threshold:effectiveThreshold(candidate,symbol),
                    epochRevision:changed.includes(symbol) ? candidate.config.revision : epochs.get(symbol).revision,
                    effectiveMinute:sealed.find(v=>v.canonicalSymbol===symbol).minuteKey })),
                watermarks:sealed,reclassified:prepared.map(({symbol,result})=>({canonicalSymbol:symbol,
                    classification:result.classification,reason:result.reason,comparable:result.comparable})),
                reclassifiedEvents:prepared.flatMap(({result})=>result.triggerEvent?[result.triggerEvent]:[]),
                retroactiveNotificationCount:0,notificationAuthority:false,
                brokerWriteAuthority:false,serviceLifecycleAuthority:false };
            const receipt = frozen({...body,transitionHash:hash(body)});
            if(restoringReceipt && restoringReceipt.transitionHash!==receipt.transitionHash) {
                failure('threshold_restore_receipt_invalid');
            }
            const saved = restoringReceipt ? {persisted:true,transitionHash:receipt.transitionHash} : persistTransition(receipt);
            if (saved?.persisted !== true || saved.transitionHash !== receipt.transitionHash) {
                failure('threshold_transition_not_durable');
            }
            // All preparation is pure. No classification/epoch is changed until
            // the real owner's append/CAS acknowledges this exact durable hash.
            for (const {symbol,input,result,ledger} of prepared) {
                const epoch={revision:candidate.config.revision,
                    ledger,firstSeen:result.comparable===true,
                    lastMinute:input?.minuteKey??null,lastCumulativeVolume:input?.currentCumulativeVolume??null};
                epochs.set(symbol,epoch);
            }
            active=candidate; lastReceipt=receipt; lastFailure=null;
            return frozen({applied:true,changed:changed.length>0,alreadyPresent:false,
                activeRevision:active.config.revision,receipt,notificationEligible:false});
        } catch (error) {
            const reason=String(error?.message ?? 'threshold_switch_failed').slice(0,128);
            if(restoringReceipt) throw error;
            const at=now();
            const diagnostic={schemaVersion:'intraday-monitor-threshold-switch-failure/1',
                sessionId,ownerId,tradeDate,connectionGeneration,observedAt:instant(at)?at:null,
                requestedRevision:count(requested?.revision)?requested.revision:null,
                activeRevision:active.config.revision,reason,notificationAuthority:false};
            let diagnosticPersisted=false;
            try { diagnosticPersisted=persistFailure(frozen(diagnostic))?.persisted===true; } catch {}
            lastFailure=frozen({...diagnostic,diagnosticPersisted});
            return frozen({applied:false,reason,activeRevision:active.config.revision,
                retainedPreviousThreshold:true,notificationEligible:false});
        }
    }
    function restore(receipt) {
        if(receipt?.schemaVersion!==THRESHOLD_SWITCH_SCHEMA ||
            receipt.transitionHash!==thresholdTransitionHash(receipt)) throw new Error('threshold_restore_receipt_invalid');
        restoringReceipt=receipt;
        try { return apply({config:receipt.configSnapshot,
            expectedComparisonRevision:receipt.previousComparisonRevision,watermarks:receipt.watermarks,
            authority:{current:true,dataPlaneAuthority:true,sessionId,ownerId,tradeDate,connectionGeneration,
                phase:receipt.phase,notificationAuthority:false}}); }
        finally {restoringReceipt=null;}
    }
    function evaluate(input,authority) {
        const epoch=epochs.get(input?.canonicalSymbol);
        try {
            checkAuthority(authority);
            if (!epoch || input.tradeDate!==tradeDate || input.baselineTradeDate!==previousTradeDate ||
                input.exchange!==active.config.items.find(v=>v.contract.canonicalSymbol===input.canonicalSymbol).contract.exchange) {
                failure('threshold_evaluation_identity_invalid');
            }
        } catch {
            return frozen({comparable:false,classification:'unknown',reason:'threshold_source_authority_invalid',
                notificationEligible:false,newlyCreated:false,triggerEvent:null});
        }
        if (epoch.lastMinute && (input.minuteKey<=epoch.lastMinute ||
            input.currentCumulativeVolume<epoch.lastCumulativeVolume)) {
            return frozen({comparable:false,classification:'unknown',reason:'threshold_observation_not_advancing',
                notificationEligible:false,newlyCreated:false,triggerEvent:null});
        }
        const result=epoch.ledger.evaluate({...input,configRevision:epoch.revision,
            threshold:effectiveThreshold(active,input.canonicalSymbol),
            revisionFirstComparable:!epoch.firstSeen});
        if(result.comparable) { epoch.firstSeen=true; epoch.lastMinute=input.minuteKey;
            epoch.lastCumulativeVolume=input.currentCumulativeVolume; }
        return frozen({...result,notificationEligible:result.notificationEligible &&
            authority.notificationAuthority===true && authority.phase==='running'});
    }
    function snapshot() {
        return frozen({schemaVersion:THRESHOLD_SWITCH_SCHEMA,sessionId,ownerId,tradeDate,connectionGeneration,
            startConfigRevision:startRevision,activeComparisonRevision:active.config.revision,
            globalThreshold:active.config.globalThreshold,configHash:active.configHash,
            structureHash:structuralHash,effectiveAt:lastReceipt?.effectiveAt??null,
            transitionHash:lastReceipt?.transitionHash??null,lastFailure,
            reclassified:lastReceipt?.reclassified??[],reclassifiedEvents:lastReceipt?.reclassifiedEvents??[],
            thresholds:symbols.map(symbol=>({canonicalSymbol:symbol,threshold:effectiveThreshold(active,symbol),
                epochRevision:epochs.get(symbol).revision})),brokerWriteAuthority:false,serviceLifecycleAuthority:false});
    }
    return Object.freeze({apply,evaluate,snapshot,restore});
}
