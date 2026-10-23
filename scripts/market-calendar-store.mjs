import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readLegacySpecialMarketClosures,defaultClosureRoot,taipeiClosureDate} from './market-calendar-legacy-reader.mjs';
import {realCalendarDate} from '../src/lib/market-calendar.ts';
export {defaultClosureRoot,taipeiClosureDate};
export const SPECIAL_CLOSURE_SCHEMA='shared-special-market-closures/2';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const dir=root=>path.join(root,'MarketCalendar/special-closures');
const filename=n=>String(n).padStart(6,'0')+'.json';
function privatePath(file,directory){const s=fs.lstatSync(file);if(s.isSymbolicLink()||fs.realpathSync(file)!==file||s.uid!==process.getuid()||s.mode&0o077||!(directory?s.isDirectory():s.isFile()))fail('special_closure_storage_invalid');return s;}
function validate(input,now){
    const fields=Object.keys(input??{}).sort().join(',');
    if(!['action,confirmed,date,expectedRevision,reason','action,confirmed,date,expectedRevision,markets,reason'].includes(fields)||
        !Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||input.confirmed!==true||
        !['close','revoke'].includes(input.action)||!realCalendarDate(input.date)||
        input.date<'2000-01-01'||input.date>new Date(Date.parse(taipeiClosureDate(now))+366*86400000).toISOString().slice(0,10)||
        typeof input.reason!=='string'||input.reason!==input.reason.trim()||!input.reason||input.reason.length>200||/[\x00-\x1f\x7f]/.test(input.reason))fail('special_closure_input_invalid');
    const markets=input.markets??['TSE','OTC'];
    if(!Array.isArray(markets)||!markets.length||markets.length>2||new Set(markets).size!==markets.length||markets.some(m=>!['TSE','OTC'].includes(m)))fail('special_closure_input_invalid');
    return ['TSE','OTC'].filter(m=>markets.includes(m));
}
export function readSpecialMarketClosures(root=defaultClosureRoot(),{now=new Date()}={}){
    if(!path.isAbsolute(root??'')||!(now instanceof Date)||!Number.isFinite(+now))fail('special_closure_input_invalid');
    const legacy=readLegacySpecialMarketClosures(root,{now});
    let names=[];
    try{privatePath(dir(root),true);names=fs.readdirSync(dir(root)).sort();}catch(e){if(e.code!=='ENOENT')throw e;}
    if(names.length+legacy.revision>1024||names.some((n,i)=>n!==filename(legacy.revision+i+1)))fail('special_closure_history_invalid');
    const active=new Map(legacy.entries.flatMap(e=>e.markets.map(m=>[`${e.date}/${m}`,{...e,markets:[m]}]))),holds=new Map();
    const history=[...legacy.history];let hash=legacy.hash,lastAt=legacy.history.length?Date.parse(legacy.history.at(-1).recordedAt):0;
    for(const[n,name]of names.entries()){
        const file=path.join(dir(root),name);if(privatePath(file,false).size>4096)fail('special_closure_history_invalid');
        let v;try{v=JSON.parse(fs.readFileSync(file,'utf8'));}catch{fail('special_closure_history_invalid');}
        const{hash:savedHash,...body}=v??{};
        const expectedKeys='action,date,legacyHash,markets,parentHash,reason,recordedAt,revision,schemaVersion,source';
        const at=Date.parse(body.recordedAt),revision=legacy.revision+n+1;
        if(Object.keys(body).sort().join(',')!==expectedKeys||body.schemaVersion!==SPECIAL_CLOSURE_SCHEMA||body.source!=='local_user'||body.revision!==revision||
            body.legacyHash!==legacy.hash||body.parentHash!==hash||savedHash!==digest(body)||!Number.isFinite(at)||at<lastAt||at>+now)fail('special_closure_history_invalid');
        validate({action:body.action,date:body.date,markets:body.markets,reason:body.reason,expectedRevision:revision-1,confirmed:true},new Date(at));
        for(const market of body.markets){const key=`${body.date}/${market}`;
            if(body.action==='close'){
                if(active.has(key))fail('special_closure_history_invalid');
                active.set(key,{date:body.date,markets:[market],reason:body.reason,recordedAt:body.recordedAt,revision,source:'local_user',scope:'full_day'});
            }else{
                if(!active.has(key))fail('special_closure_history_invalid');active.delete(key);
                if(body.date===taipeiClosureDate(new Date(at)))holds.set(key,{date:body.date,markets:[market],revision,reason:'reopened_requires_review'});
            }}
        history.push(v);hash=savedHash;lastAt=at;
    }
    const grouped=new Map();for(const e of active.values()){const key=`${e.date}/${e.revision}`;if(grouped.has(key))grouped.get(key).markets.push(...e.markets);else grouped.set(key,{...e,markets:[...e.markets]});}
    return{schemaVersion:SPECIAL_CLOSURE_SCHEMA,available:true,revision:legacy.revision+names.length,hash,legacyHash:legacy.hash,source:'local_user',
        entries:[...grouped.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.markets.join().localeCompare(b.markets.join())),
        liveHolds:[...holds.values()],history,today:taipeiClosureDate(now)};
}
export function saveSpecialMarketClosure(root,input,{now=new Date()}={}){
    if(!(now instanceof Date)||!Number.isFinite(+now))fail('special_closure_clock_invalid');
    const markets=validate(input,now),current=readSpecialMarketClosures(root,{now});
    if(current.revision!==input.expectedRevision)fail('special_closure_revision_conflict');
    if(current.revision>=1024)fail('special_closure_history_limit');
    for(const m of markets){const exists=current.entries.some(e=>e.date===input.date&&e.markets.includes(m));
        if(exists!==(input.action==='revoke'))fail(exists?'special_closure_already_exists':'special_closure_not_found');}
    const body={schemaVersion:SPECIAL_CLOSURE_SCHEMA,revision:current.revision+1,parentHash:current.hash,legacyHash:current.legacyHash,
        action:input.action,date:input.date,markets,reason:input.reason,source:'local_user',recordedAt:now.toISOString()};
    fs.mkdirSync(dir(root),{recursive:true,mode:0o700});privatePath(dir(root),true);
    let fd;try{fd=fs.openSync(path.join(dir(root),filename(body.revision)),'wx',0o600);}catch(e){if(e.code==='EEXIST')fail('special_closure_revision_conflict');throw e;}
    try{fs.writeFileSync(fd,JSON.stringify({...body,hash:digest(body)})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    return readSpecialMarketClosures(root,{now});
}
export function specialMarketClosureDecision({root=defaultClosureRoot(),dates,markets=['TSE','OTC'],now=new Date(),purpose='live'}={}){
    try{
        if(!Array.isArray(dates)||!dates.length||!dates.every(realCalendarDate)||!Array.isArray(markets)||!markets.length||markets.some(m=>!['TSE','OTC'].includes(m))||!['live','data'].includes(purpose))fail('special_closure_input_invalid');
        const state=readSpecialMarketClosures(root,{now}),entry=state.entries.find(e=>dates.includes(e.date)&&e.markets.some(m=>markets.includes(m)));
        const hold=purpose==='live'&&state.liveHolds.find(e=>dates.includes(e.date)&&e.date===taipeiClosureDate(now)&&e.markets.some(m=>markets.includes(m)));
        return{allowed:!entry&&!hold,reason:entry?'special_market_closure':hold?'special_closure_reopen_requires_review':null,
            revision:state.revision,hash:state.hash,entry:entry??null,source:'local_user'};
    }catch{return{allowed:false,reason:'special_closure_settings_unavailable',source:'local_user'};}
}
export function assertNoSpecialMarketClosure(options){const decision=specialMarketClosureDecision(options);if(!decision.allowed)fail(decision.reason);return decision;}
