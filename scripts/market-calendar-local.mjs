// Node 端僅讀現成年度 cache／全域設定；不構造 repository、不更新官方來源。
import fs from 'node:fs';
import path from 'node:path';
import {readSpecialMarketClosures,defaultClosureRoot} from './market-calendar-store.mjs';
import {verifyDailyCalendarCache} from './intraday-monitor-runtime/daily-calendar-cache.mjs';
import {createMarketCalendar} from '../src/lib/market-calendar.ts';
import {buildOfficialMarketCalendarSnapshot,parseTwseOfficialCalendar,parseTpexOfficialCalendar} from './smart-order-runtime/official-market-calendar-core.mjs';
import {hashDirect160} from './intraday-monitor-runtime/direct-160-storage.mjs';
function boundedJson(file,limit){
    const stat=fs.lstatSync(file);
    if(stat.isSymbolicLink()||!stat.isFile()||stat.size>limit||fs.realpathSync(file)!==file)throw Error('calendar_file_invalid');
    return JSON.parse(fs.readFileSync(file,'utf8'));
}
function readAnnual(root,now){
    const dir=path.join(root,'IntradayMonitor/official-calendar-cache');
    let names=[];try{names=fs.readdirSync(dir);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(names.length>1024)throw Error('calendar_limit');
    const name=names.filter(n=>/^\d{4}-\d{2}-\d{2}T[\w-]+Z-[a-f0-9]{64}\.json$/.test(n)).sort().at(-1);
    // 新日曆若存在但無效，絕不退回舊 baseline。
    if(name)return verifyDailyCalendarCache(boundedJson(path.join(dir,name),256*1024),now);
    const baseDir=path.join(root,'intraday-baselines'),baseNames=fs.readdirSync(baseDir);
    if(baseNames.length>1024)throw Error('calendar_limit');
    const candidate=baseNames.filter(n=>/^\d{4}-\d{2}-\d{2}-for-\d{4}-\d{2}-\d{2}-verified$/.test(n)).sort().at(-1);
    if(!candidate)throw Error('calendar_missing');
    const value=boundedJson(path.join(baseDir,candidate,'baseline-set.json'),4*1024**2),{baselineHash,...body}=value;
    const c=value.calendar,match=/^(\d{4}-\d{2}-\d{2})-for-(\d{4}-\d{2}-\d{2})-verified$/.exec(candidate);
    if(value.schemaVersion!=='intraday-monitor-direct-160-baseline-set/1'||value.baselineUsable!==true||
        value.manifests?.length!==160||baselineHash!==hashDirect160(body,'bundle')||
        c?.previousTradeDate!==match[1]||c?.targetTradeDate!==match[2]||!Number.isSafeInteger(c?.fetchedAtEpochMs)||c.fetchedAtEpochMs>+now)
        throw Error('calendar_baseline_invalid');
    const year=Number(c.previousTradeDate.slice(0,4)),snapshot=buildOfficialMarketCalendarSnapshot({
        twse:parseTwseOfficialCalendar(c.twse,year),tpex:parseTpexOfficialCalendar(c.tpex,year),fetchedAtEpochMs:c.fetchedAtEpochMs});
    if(snapshot.calendarVersion!==c.sourceVersion)throw Error('calendar_baseline_version_invalid');
    return snapshot;
}
export function readLocalMarketCalendar(root=defaultClosureRoot(),{now=new Date()}={}){
    let closures,annual=null;
    try{const state=readSpecialMarketClosures(root,{now});closures={available:true,revision:state.revision,hash:state.hash,entries:state.entries,liveHolds:state.liveHolds};}
    catch{closures={available:false,revision:0,hash:null,entries:[],liveHolds:[]};}
    try{
        const snapshot=readAnnual(root,now);
        annual={...snapshot,verified:true};
    }catch{/* 來源不足只保留 unknown；人工休市仍可獨立提供 closed，不反推開市。 */}
    return createMarketCalendar(annual,closures,now);
}
