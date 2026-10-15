import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createThresholdSwitchController,thresholdConfigForRequest,thresholdConfigProof,
    isThresholdConfigCompatibility } from './threshold-switch-controller.mjs';
import { ThresholdSwitchRepository,THRESHOLD_RUNTIME_SESSION_SCHEMA,
    resolveThresholdSwitchDatabasePath,readThresholdSwitchState } from './threshold-switch-repository.mjs';

export const THRESHOLD_SWITCH_VIEW_SCHEMA='intraday-monitor-threshold-switch-view/1';
export function thresholdOwnerIsCurrent(root,initial){
    try{
        const owner=JSON.parse(readFileSync(path.join(root,'direct-160-live','registry','active.lock'),'utf8'));
        if(owner.ownerPid!==initial.ownerPid||owner.tradeDate!==initial.tradeDate||
            owner.connectionGeneration!==initial.connectionGeneration||path.basename(owner.claimPath)!==initial.ownerId)return false;
        process.kill(initial.ownerPid,0);return true;
    }catch{return false;}
}
export function thresholdCompatibility(saved,config,ownerVerified){
    if(!saved)return null;
    return {schemaVersion:'intraday-monitor-threshold-config-compatibility/1',
        sessionId:saved.initial.sessionId,tradeDate:saved.initial.tradeDate,
        connectionGeneration:saved.initial.connectionGeneration,ownerVerified,
        startConfig:saved.initial.config,savedConfig:thresholdConfigForRequest(config)};
}
export function readThresholdSwitchView(root,session,config){
    const base={schemaVersion:THRESHOLD_SWITCH_VIEW_SCHEMA,savedRevision:config.revision,
        savedThreshold:config.globalThreshold,activeComparisonRevision:null,activeThreshold:null,
        effectiveAt:null,effectiveMinutes:[],reclassifiedSymbols:[],notificationAuthority:false};
    try{
        const saved=readThresholdSwitchState(root,session);
        if(!saved)return {...base,state:'unsupported_runtime',reason:'threshold_runtime_not_loaded'};
        const live=thresholdOwnerIsCurrent(root,saved.initial);
        const proof=thresholdCompatibility(saved,config,live);
        const compatible=isThresholdConfigCompatibility(proof,session,config.revision);
        const latest=saved.lastReceipt;
        const applied=latest?.configSnapshot??saved.initial.config;
        const lastFailure=saved.lastFailure?.requestedRevision===config.revision?saved.lastFailure:null;
        return {...base,activeComparisonRevision:saved.head.revision,activeThreshold:applied.globalThreshold,
            effectiveAt:latest?.effectiveAt??saved.initial.createdAt,
            effectiveMinutes:latest?.effectiveThresholds??[],
            reclassifiedSymbols:latest?.reclassified.filter(v=>v.classification==='matched').map(v=>v.canonicalSymbol)??[],
            reclassifiedEventIds:saved.receipts.flatMap(v=>v.reclassifiedEvents.map(e=>e.eventId)),
            state:!live?'no_active_owner':!compatible?'failed':lastFailure&&config.revision!==saved.head.revision?'failed':
                config.revision===saved.head.revision?'applied':'pending',
            reason:!live?'threshold_owner_not_active':!compatible?'threshold_only_change_required':
                lastFailure&&config.revision!==saved.head.revision?lastFailure.reason:null};
    }catch{return {...base,state:'failed',reason:'threshold_runtime_evidence_invalid'};}
}
export function createThresholdRuntime({root,session,initialConfig,activeSymbols,ownerId,ownerPid,
    configDatabasePath,readConfig,now=()=>new Date().toISOString()}={}){
    const initial={schemaVersion:THRESHOLD_RUNTIME_SESSION_SCHEMA,sessionId:session.sessionId,
        tradeDate:session.tradeDate,previousTradeDate:session.previousTradeDate,
        connectionGeneration:session.connectionGeneration,ownerId,ownerPid,
        config:thresholdConfigForRequest(initialConfig),activeSymbols,createdAt:now()};
    if(initial.config.revision!==session.configRevision)throw new Error('threshold_initial_config_revision_mismatch');
    const journal=new ThresholdSwitchRepository(resolveThresholdSwitchDatabasePath(root),{configDatabasePath});
    try{journal.initialize(initial);}catch(error){journal.close();throw error;}
    const configReader = new DatabaseSync(configDatabasePath, { readOnly:true });
    let core,lastAttempt=null,journalHealthy=true,lastVerificationAt=null;
    try{
        core=createThresholdSwitchController({...initial,config:initial.config,now,
            persistTransition:value=>journal.append(value),persistFailure:value=>journal.appendFailure(value)});
        const saved=journal.read(session.sessionId);
        for(const receipt of saved.receipts)core.restore(receipt);
    }catch(error){configReader.close();journal.close();throw error;}
    function compatibility(config){return thresholdCompatibility({initial},config,
        thresholdOwnerIsCurrent(root,initial));}
    const boundAuthority=value=>({...value,sessionId:initial.sessionId,ownerId,
        tradeDate:initial.tradeDate,connectionGeneration:initial.connectionGeneration});
    function sync(watermarks,authority){
        const at = Date.parse(now());
        if (lastVerificationAt === null || at-lastVerificationAt >= 1000) {
            verify(); lastVerificationAt = at;
        }
        if (!journalHealthy) return { applied:false,reason:'threshold_runtime_evidence_invalid' };
        const savedRevision = configReader.prepare(
            'SELECT revision FROM intraday_monitor_config WHERE singleton_key=1').get()?.revision;
        if (savedRevision===core.snapshot().activeComparisonRevision) return {applied:true,alreadyPresent:true};
        const config=readConfig();
        if(config.revision===core.snapshot().activeComparisonRevision)return {applied:true,alreadyPresent:true};
        if(!['running','closing'].includes(authority.phase))return {applied:false,reason:'threshold_waiting_running_session'};
        const attemptKey=JSON.stringify([config.revision,watermarks.map(v=>[v.minuteKey,v.receivedAt])]);
        if(lastAttempt?.attemptKey===attemptKey&&lastAttempt.attempts>=3)return lastAttempt;
        const applied=core.apply({config:thresholdConfigForRequest(config),
            expectedComparisonRevision:core.snapshot().activeComparisonRevision,watermarks,
            authority:boundAuthority(authority)});
        lastAttempt={...applied,revision:config.revision,attemptKey,
            attempts:lastAttempt?.attemptKey===attemptKey?lastAttempt.attempts+1:1};return applied;
    }
    function verify(){
        try{
            const saved=journal.read(session.sessionId),snapshot=core.snapshot();
            journalHealthy=saved.head.revision===snapshot.activeComparisonRevision&&
                saved.head.receipt_hash===snapshot.transitionHash;
        }catch{journalHealthy=false;}
        return journalHealthy;
    }
    return Object.freeze({core,compatibility,sync,verify,authority:boundAuthority,
        snapshot:()=>({...core.snapshot(),journalHealthy}),
        close:()=>{configReader.close();journal.close();}});
}
