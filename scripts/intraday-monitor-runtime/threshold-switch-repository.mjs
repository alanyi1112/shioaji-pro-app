import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';
import { thresholdConfigProof, thresholdTransitionHash, THRESHOLD_SWITCH_SCHEMA }
    from './threshold-switch-controller.mjs';

export const THRESHOLD_RUNTIME_SESSION_SCHEMA='intraday-monitor-threshold-runtime-session/1';
const json=value=>canonicalJson(value,{maximumBytes:512*1024});
const hash=value=>createHash('sha256').update(json(value)).digest('hex');
export function resolveThresholdSwitchDatabasePath(root) {
    if(!path.isAbsolute(root??''))throw new Error('threshold_root_invalid');
    return path.join(root,'IntradayMonitor','threshold-switch.sqlite3');
}
function attachedConfig(db) {
    const row=db.prepare('SELECT schema_version,revision,global_threshold FROM configuration.intraday_monitor_config WHERE singleton_key=1').get();
    if(!row)throw new Error('threshold_saved_config_unavailable');
    return {schemaVersion:row.schema_version,revision:row.revision,globalThreshold:row.global_threshold,
        items:db.prepare('SELECT * FROM configuration.intraday_monitor_config_items ORDER BY position').all().map(item=>({
            contract:{security_type:item.security_type,region:item.region,exchange:item.exchange,
                code:item.code,target_code:item.target_code},enabled:item.enabled===1,
            thresholdOverride:item.threshold_override,source:item.source}))};
}
export class ThresholdSwitchRepository {
    constructor(databasePath,{configDatabasePath=null,readOnly=false}={}) {
        if(!path.isAbsolute(databasePath??'')||configDatabasePath!==null&&!path.isAbsolute(configDatabasePath)||
            typeof readOnly!=='boolean')throw new Error('threshold_repository_inputs_invalid');
        if(!readOnly)mkdirSync(path.dirname(databasePath),{recursive:true,mode:0o700});
        this.database=new DatabaseSync(databasePath,{readOnly});this.readOnly=readOnly;
        this.configAttached=configDatabasePath!==null&&!readOnly;
        try {
            if(!readOnly){
                chmodSync(databasePath,0o600);
                this.database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=250;');
                this.database.exec(`CREATE TABLE IF NOT EXISTS threshold_sessions(
                    session_id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)), hash TEXT NOT NULL) STRICT;
                    CREATE TABLE IF NOT EXISTS threshold_heads(session_id TEXT PRIMARY KEY,
                    revision INTEGER NOT NULL, config_hash TEXT NOT NULL, receipt_hash TEXT) STRICT;
                    CREATE TABLE IF NOT EXISTS threshold_receipts(session_id TEXT NOT NULL, revision INTEGER NOT NULL,
                    receipt_hash TEXT NOT NULL UNIQUE,payload TEXT NOT NULL CHECK(json_valid(payload)),PRIMARY KEY(session_id,revision)) STRICT;
                    CREATE TABLE IF NOT EXISTS threshold_failures(failure_hash TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
                    CREATE TRIGGER IF NOT EXISTS threshold_sessions_no_update BEFORE UPDATE ON threshold_sessions BEGIN SELECT RAISE(ABORT,'threshold_session_immutable'); END;
                    CREATE TRIGGER IF NOT EXISTS threshold_sessions_no_delete BEFORE DELETE ON threshold_sessions BEGIN SELECT RAISE(ABORT,'threshold_session_immutable'); END;
                    CREATE TRIGGER IF NOT EXISTS threshold_receipts_no_update BEFORE UPDATE ON threshold_receipts BEGIN SELECT RAISE(ABORT,'threshold_receipt_immutable'); END;
                    CREATE TRIGGER IF NOT EXISTS threshold_receipts_no_delete BEFORE DELETE ON threshold_receipts BEGIN SELECT RAISE(ABORT,'threshold_receipt_immutable'); END;
                    CREATE TRIGGER IF NOT EXISTS threshold_failures_no_update BEFORE UPDATE ON threshold_failures BEGIN SELECT RAISE(ABORT,'threshold_failure_immutable'); END;
                    CREATE TRIGGER IF NOT EXISTS threshold_failures_no_delete BEFORE DELETE ON threshold_failures BEGIN SELECT RAISE(ABORT,'threshold_failure_immutable'); END;`);
                if(this.configAttached)this.database.prepare('ATTACH DATABASE ? AS configuration').run(configDatabasePath);
            }
        }catch(error){this.database.close();throw error;}
    }
    transaction(operation){
        if(this.readOnly)throw new Error('threshold_repository_readonly');
        this.database.exec('BEGIN IMMEDIATE');
        try{const result=operation();this.database.exec('COMMIT');return result;}
        catch(error){this.database.exec('ROLLBACK');throw error;}
    }
    initialize(value){
        const proof=thresholdConfigProof(value?.config);
        if(value?.schemaVersion!==THRESHOLD_RUNTIME_SESSION_SCHEMA ||
            !value.sessionId||!value.ownerId||!Number.isSafeInteger(value.ownerPid)||value.ownerPid<1||
            !/^\d{4}-\d{2}-\d{2}$/.test(value.tradeDate??'')||
            !/^\d{4}-\d{2}-\d{2}$/.test(value.previousTradeDate??'')||value.previousTradeDate>=value.tradeDate||
            !/^simulation:[A-Za-z0-9_-]{16,100}$/.test(value.connectionGeneration??'')||
            !Array.isArray(value.activeSymbols)||value.activeSymbols.length<1||value.activeSymbols.length>160||
            new Set(value.activeSymbols).size!==value.activeSymbols.length||
            value.activeSymbols.some(symbol=>!proof.config.items.some(item=>item.enabled&&item.contract.canonicalSymbol===symbol))||
            !Number.isFinite(Date.parse(value.createdAt)))throw new Error('threshold_runtime_session_invalid');
        const body={...value,config:proof.request,configHash:proof.configHash,structureHash:proof.structureHash};
        const payload=json(body),digest=hash(body);
        return this.transaction(()=>{
            const existing=this.database.prepare('SELECT hash FROM threshold_sessions WHERE session_id=?').get(value.sessionId);
            if(existing){if(existing.hash!==digest)throw new Error('threshold_session_conflict');return {initialized:true,alreadyPresent:true};}
            if(this.configAttached&&thresholdConfigProof(attachedConfig(this.database)).configHash!==proof.configHash)
                throw new Error('threshold_saved_config_changed');
            this.database.prepare('INSERT INTO threshold_sessions VALUES(?,?,?)').run(value.sessionId,payload,digest);
            this.database.prepare('INSERT INTO threshold_heads VALUES(?,?,?,NULL)').run(value.sessionId,proof.config.revision,proof.configHash);
            return {initialized:true,alreadyPresent:false};
        });
    }
    append(receipt){
        if(receipt?.schemaVersion!==THRESHOLD_SWITCH_SCHEMA||receipt.transitionHash!==thresholdTransitionHash(receipt))
            throw new Error('threshold_receipt_invalid');
        const proof=thresholdConfigProof(receipt.configSnapshot);
        if(proof.configHash!==receipt.configHash||proof.structureHash!==receipt.structureHash||
            proof.config.revision!==receipt.comparisonRevision||receipt.notificationAuthority!==false||
            receipt.retroactiveNotificationCount!==0)throw new Error('threshold_receipt_invalid');
        return this.transaction(()=>{
            const saved=this.read(receipt.sessionId);
            if(!saved||saved.initial.ownerId!==receipt.ownerId||saved.initial.tradeDate!==receipt.tradeDate||
                saved.initial.connectionGeneration!==receipt.connectionGeneration||saved.initial.structureHash!==proof.structureHash)
                throw new Error('threshold_receipt_identity_invalid');
            if(saved.head.receipt_hash===receipt.transitionHash)return {persisted:true,alreadyPresent:true,transitionHash:receipt.transitionHash};
            if(saved.head.revision!==receipt.previousComparisonRevision||saved.head.config_hash!==receipt.previousConfigHash||
                saved.head.receipt_hash!==receipt.previousTransitionHash)throw new Error('threshold_revision_conflict');
            // BEGIN IMMEDIATE holds the attached configuration DB's write lock:
            // a concurrent UI CAS cannot move saved config between check/commit.
            if(this.configAttached&&thresholdConfigProof(attachedConfig(this.database)).configHash!==proof.configHash)
                throw new Error('threshold_saved_config_changed');
            this.database.prepare('INSERT INTO threshold_receipts VALUES(?,?,?,?)').run(receipt.sessionId,receipt.comparisonRevision,
                receipt.transitionHash,json(receipt));
            const updated=this.database.prepare('UPDATE threshold_heads SET revision=?,config_hash=?,receipt_hash=? WHERE session_id=? AND revision=? AND config_hash=?').run(
                receipt.comparisonRevision,receipt.configHash,receipt.transitionHash,receipt.sessionId,receipt.previousComparisonRevision,receipt.previousConfigHash);
            if(updated.changes!==1)throw new Error('threshold_revision_conflict');
            return {persisted:true,transitionHash:receipt.transitionHash};
        });
    }
    appendFailure(value){
        if(!value?.sessionId||value.notificationAuthority!==false)throw new Error('threshold_failure_invalid');
        return this.transaction(()=>{this.database.prepare('INSERT OR IGNORE INTO threshold_failures VALUES(?,?,?)')
            .run(hash(value),value.sessionId,json(value));return {persisted:true};});
    }
    read(sessionId){
        const row=this.database.prepare('SELECT * FROM threshold_sessions WHERE session_id=?').get(sessionId);
        if(!row)return null;
        const initial=JSON.parse(row.payload);
        if(hash(initial)!==row.hash)throw new Error('threshold_session_hash_invalid');
        const proof=thresholdConfigProof(initial.config);
        if(proof.configHash!==initial.configHash||proof.structureHash!==initial.structureHash)
            throw new Error('threshold_session_hash_invalid');
        const head=this.database.prepare('SELECT * FROM threshold_heads WHERE session_id=?').get(sessionId);
        let previousHash=null,previousRevision=initial.config.revision,previousConfigHash=initial.configHash;
        const receipts=this.database.prepare('SELECT payload FROM threshold_receipts WHERE session_id=? ORDER BY revision').all(sessionId).map(row=>{
            const receipt=JSON.parse(row.payload);
            if(receipt.transitionHash!==thresholdTransitionHash(receipt)||receipt.previousTransitionHash!==previousHash||
                receipt.previousComparisonRevision!==previousRevision||receipt.previousConfigHash!==previousConfigHash||
                receipt.ownerId!==initial.ownerId||receipt.connectionGeneration!==initial.connectionGeneration||
                receipt.tradeDate!==initial.tradeDate||receipt.sessionId!==sessionId||receipt.structureHash!==initial.structureHash||
                receipt.comparisonRevision<=previousRevision)throw new Error('threshold_receipt_chain_invalid');
            const next=thresholdConfigProof(receipt.configSnapshot);
            if(next.configHash!==receipt.configHash||next.structureHash!==initial.structureHash||
                next.config.revision!==receipt.comparisonRevision)throw new Error('threshold_receipt_chain_invalid');
            previousHash=receipt.transitionHash;previousRevision=receipt.comparisonRevision;previousConfigHash=receipt.configHash;
            return receipt;
        });
        if(!head||head.revision!==previousRevision||head.receipt_hash!==previousHash||head.config_hash!==previousConfigHash)
            throw new Error('threshold_head_invalid');
        const latestFailure=this.database.prepare('SELECT payload FROM threshold_failures WHERE session_id=? ORDER BY rowid DESC LIMIT 1').get(sessionId);
        return {initial,head,receipts,lastReceipt:receipts.at(-1)??null,
            lastFailure:latestFailure?JSON.parse(latestFailure.payload):null};
    }
    close(){this.database.close();}
}
export function readThresholdSwitchState(root,session){
    const file=resolveThresholdSwitchDatabasePath(root);
    if(!session||!existsSync(file))return null;
    const repository=new ThresholdSwitchRepository(file,{readOnly:true});
    try{
        const value=repository.read(session.sessionId);
        if(!value)return null;
        if(value.initial.tradeDate!==session.tradeDate||value.initial.previousTradeDate!==session.previousTradeDate||
            value.initial.connectionGeneration!==session.connectionGeneration||value.initial.config.revision!==session.configRevision)
            throw new Error('threshold_runtime_session_identity_invalid');
        return value;
    }finally{repository.close();}
}
