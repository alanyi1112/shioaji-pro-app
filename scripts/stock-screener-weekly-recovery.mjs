/** 全市場週資料獨立恢復；重用原目錄、冷卻與來源收據，不解除其他來源 blocked。 */
import {collectScreenerData,readVerifiedWeeklyCatalog} from '../apps/multiview/worker/stock-screener-collector.ts';
import {prepareBollingerCalendar} from './stock-screener-bollinger-calendar.ts';
import {bollingerScheduleDecision} from './stock-screener-bollinger-schedule.ts';
import {publishCollectedScreener} from '../apps/multiview/worker/stock-screener-publisher.ts';
import {publishPreparedScreenerV3} from '../apps/multiview/worker/stock-screener-v3-publisher.ts';
import {publishPreparedScreenerV4} from '../apps/multiview/worker/stock-screener-v4-publisher.ts';
import {updateScreenerChip} from './stock-screener-chip-update.mjs';
import {readScreenerSnapshot} from '../apps/multiview/worker/stock-screener-repository.ts';
import {prepareScreenerOhlcv,prepareScreenerOhlcvV4} from './stock-screener-ohlcv-bootstrap.mjs';
import {hashText,boundedOfficialText} from './stock-screener-periods.mjs';
import {parseDailyVolumes} from '../apps/multiview/worker/stock-screener-sources.ts';
import {ohlcvHistoryUrl} from './stock-screener-ohlcv-bootstrap.mjs';

export async function recoverScreenerWeekly(db,{fetcher=fetch,now=()=>new Date(),collect=collectScreenerData,preparedReports=[]}={}) {
  const at=now();
  const verifiedCatalog=await readVerifiedWeeklyCatalog(db,at);
  if (!verifiedCatalog) return {state:'pending',reason:'catalog_pending'};
  const collection=await collect(db,'screener-weekly',{fetcher,clock:()=>+now(),reuseCatalogOnly:true});
  const calendarResult=await prepareBollingerCalendar(db,{now,deadline:+now()+120000});
  if(calendarResult.state!=='ready')return{state:'pending',reason:'calendar_authority_pending',collection};
  const decision=bollingerScheduleDecision(calendarResult.calendar,now());
  if(decision.state!=='due'||!decision.through)return{state:'pending',reason:decision.reason,collection};
  const prior=await db.prepare("SELECT checkpoint FROM screener_runs WHERE id='screener-period-evidence' AND status='verified'").first();
  let original;try{original=JSON.parse(prior?.checkpoint??'null')}catch{}
  if(original?.version!==1||!Array.isArray(original.weeks)||!Array.isArray(original.sourceHashes)
    ||original.sourceHashes.some(x=>!/^[a-f0-9]{64}$/.test(x))||!original.sourceHashes.length
    ||!Number.isFinite(Date.parse(original.fetchedAt))||Date.parse(original.fetchedAt)>+at
    ||Date.parse(original.validThrough)<=+at)
    return{state:'pending',reason:'period_evidence_pending',collection};
  const receipts=(await db.prepare("SELECT checkpoint FROM screener_runs WHERE scope='screener-source-period' AND status='collected'").all()).results??[];
  const weekly=receipts.flatMap(row=>{let p;try{p=JSON.parse(row.checkpoint)}catch{return[]}
    return p.source==='TDCC'&&p.complete===true&&/^\d{4}-\d{2}-\d{2}$/.test(p.date)
      &&p.date<=decision.through&&p.total>0&&p.offset===p.total?[{date:p.date,hash:hashText(row.checkpoint),fetchedAt:p.fetchedAt}]:[];});
  const latest=weekly.map(x=>x.date).sort().at(-1);
  const base=await readScreenerSnapshot(db,undefined,2);
  if(!latest)return{state:'pending',reason:'weekly_period_pending',collection};
  const published=await db.prepare("SELECT metadata FROM screener_snapshots WHERE schema_version=7 AND status='published' ORDER BY created_at DESC LIMIT 1").first();
  const current=published?JSON.parse(published.metadata):null;
  const volumeRepair=await repairNewListingVolumes(db,verifiedCatalog.stocks,decision.through,preparedReports,now());
  if(!volumeRepair&&base?.metadata.anchors?.weekly?.current===latest&&current?.anchors?.weekly?.current===latest&&current.universeRevision===verifiedCatalog.receipt.hash)
    return{state:'unchanged',reason:'weekly_current',weeklyThrough:latest,collection};
  // 只採原正式週清單與這次實際整批官方來源的日期，絕不按星期推測週期。
  const periods=weeklyRecoveryPeriods(original,calendarResult.calendar,weekly,decision.through,at);
  const periodProof={version:1,kind:'verified-weekly-recovery',original,calendar:calendarResult.calendar,weekly,periods};
  const proofHash=hashText(JSON.stringify(periodProof));
  await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,'screener-recovered-period-evidence','verified',?,?) ON CONFLICT(id) DO NOTHING")
    .bind('screener-recovered-period-evidence:'+proofHash,JSON.stringify(periodProof),now().toISOString()).run();
  periods.sourceHashes.push(proofHash);
  let publication=await publishCollectedScreener(db,periods,now());
  if(!['published','unchanged'].includes(publication.state))return{state:'pending',reason:'base_publication_pending',collection,publication};
  const progress3=await db.prepare("SELECT checkpoint FROM screener_runs WHERE id='screener-ohlcv-progress'").first();
  const progress4=await db.prepare("SELECT checkpoint FROM screener_runs WHERE id='screener-ohlcv-v4-progress'").first();
  const p3=progress3?JSON.parse(progress3.checkpoint):null,p4=progress4?JSON.parse(progress4.checkpoint):null;
  if(p3?.sessions?.length!==60||p4?.sessions?.length!==130||p3.through!==decision.through||p4.through!==decision.through)
    return{state:'pending',reason:'technical_window_pending',collection,publication};
  const reports=[];
  const reportFetcher=async(url,init)=>{
    const r=await boundedOfficialText(String(url),fetcher,init);
    reports.push({sourceUrl:String(url),status:200,text:r.text,fetchedAt:r.fetchedAt});
    return new Response(r.text,{status:200});
  };
  const common={universe:verifiedCatalog.stocks,universeRevision:verifiedCatalog.receipt.hash,validThrough:periods.validThrough,limit:1,fetcher:reportFetcher};
  // 先補 v4 的真實缺列；v3 可沿原收據與 canonical v2 列重算進度，不重抓整個窗口。
  const preparation4=await prepareScreenerOhlcvV4(db,{...common,sessions:p4.sessions});
  const preparation3=await prepareScreenerOhlcv(db,{...common,sessions:p3.sessions});
  const repaired=await repairNewListingVolumes(db,verifiedCatalog.stocks,decision.through,reports,now());
  if(repaired)publication=await publishCollectedScreener(db,periods,now());
  const v3=await publishPreparedScreenerV3(db),v4=['published','unchanged'].includes(v3.state)?await publishPreparedScreenerV4(db):null;
  const chip=v4&&['published','unchanged'].includes(v4.state)?await updateScreenerChip(db,{publishOnly:true}):null;
  return{state:chip?.state??v4?.state??v3.state,weeklyThrough:latest,collection,publication,preparation4,preparation3,volumeRowsRepaired:volumeRepair+repaired,v3,v4,chip};
}

/** 原來源與週期不換時戳；只有完整來源收據可以新增實際週資料日期。 */
export function weeklyRecoveryPeriods(original,calendar,weekly,through,now=new Date()) {
  const date=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
  if(original?.version!==1||!Array.isArray(original.weeks)||!original.weeks.length||original.weeks.some(d=>!date(d))
    ||!Array.isArray(original.sourceHashes)||!original.sourceHashes.length||original.sourceHashes.some(h=>!/^[a-f0-9]{64}$/.test(h))
    ||!Number.isFinite(Date.parse(original.fetchedAt))||Date.parse(original.fetchedAt)>+now
    ||calendar?.status!=='verified'||!Array.isArray(calendar.commonSessions)||!calendar.commonSessions.includes(through)
    ||calendar.commonSessions.some((d,i)=>!date(d)||i&&d<=calendar.commonSessions[i-1])||!/^[a-f0-9]{64}$/.test(calendar.authorityHash)
    ||!weekly.length||weekly.some(w=>!date(w.date)||w.date>through||!/^[a-f0-9]{64}$/.test(w.hash)))throw Error('invalid_period_evidence');
  const latest=[...weekly].sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
  const newSourceAt=Date.parse(latest?.fetchedAt??'');
  const fresh=Number.isFinite(newSourceAt)&&newSourceAt<=+now&&+now-newSourceAt<=12*3600000;
  if(!fresh&&+now-Date.parse(original.fetchedAt)>12*3600000)throw Error('invalid_period_evidence');
  const ttl=fresh?Date.parse(calendar.validThrough):Math.min(Date.parse(original.validThrough),Date.parse(calendar.validThrough));
  if(!Number.isFinite(ttl)||ttl<=+now)throw Error('invalid_period_evidence');
  return{version:1,sessions:calendar.commonSessions,weeks:[...new Set([...original.weeks,...weekly.map(x=>x.date)])].sort(),through,
    fetchedAt:fresh?latest.fetchedAt:original.fetchedAt,validThrough:new Date(ttl).toISOString(),
    reusedPeriodEvidence:{originalFetchedAt:original.fetchedAt,originalValidThrough:original.validThrough,originalHash:hashText(JSON.stringify(original)),latestSourceReceiptHash:latest.hash,latestSourceFetchedAt:latest.fetchedAt??null},
    sourceHashes:[...original.sourceHashes,calendar.authorityHash,...weekly.map(x=>x.hash)]};
}

/** 新掛牌當日只補真實日報已驗證的當日量值；不造前一日，不混入其他日期。 */
export async function repairNewListingVolumes(db,stocks,through,reports,now=new Date()) {
  const candidates=stocks.filter(s=>s.listingDate===through);let inserted=0;
  for(const r of reports){
    const market=['TWSE','TPEx'].find(m=>r.sourceUrl===ohlcvHistoryUrl(m,through));
    if(!market||r.status!==200||typeof r.text!=='string'||Buffer.byteLength(r.text)>16*1024**2
      ||!Number.isFinite(Date.parse(r.fetchedAt))||Date.parse(r.fetchedAt)>+now||+now-Date.parse(r.fetchedAt)>24*3600000)throw Error('invalid_source_receipt');
    const p=JSON.parse(r.text),code=market==='TWSE'?'證券代號':'代號',amount=market==='TWSE'?'成交金額':'成交金額(元)';
    if(p.date!==through.replaceAll('-','')||String(p.stat).toLowerCase()!=='ok'||!Array.isArray(p.tables))throw Error('invalid_report_date');
    const tables=p.tables.filter(t=>Array.isArray(t.fields)&&t.fields.includes(code));
    if(tables.length!==(market==='TWSE'?1:2)||tables.some(t=>!Array.isArray(t.data)||![code,'成交股數',amount].every(f=>t.fields.includes(f))))throw Error('invalid_report_schema');
    const raw=tables.flatMap(t=>t.data.map(row=>{if(!Array.isArray(row)||row.length!==t.fields.length)throw Error('invalid_report_schema');
      return{Date:through,[market==='TWSE'?'Code':'SecuritiesCompanyCode']:row[t.fields.indexOf(code)],
        [market==='TWSE'?'TradeVolume':'TradingShares']:String(row[t.fields.indexOf('成交股數')]).replaceAll(',',''),
        [market==='TWSE'?'TradeValue':'TransactionAmount']:String(row[t.fields.indexOf(amount)]).replaceAll(',','')};}));
    const parsed=parseDailyVolumes(raw,market,{source:market,sourceUrl:r.sourceUrl,payloadHash:hashText(r.text),fetchedAt:r.fetchedAt,normalizationVersion:'screener-official-v1'});
    for(const stock of candidates.filter(s=>s.market===market)){
      const point=parsed.points.get(stock.symbol);if(!point)continue;
      const result=await db.prepare('INSERT INTO screener_daily_volume(symbol,data_date,payload) VALUES(?,?,?) ON CONFLICT(data_date,symbol) DO NOTHING').bind(stock.symbol,through,JSON.stringify(point)).run();
      const changes=Number(result.meta?.changes??result.changes??0);inserted+=changes;
      if(changes)await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,'screener-new-listing-volume-repair','verified',?,?) ON CONFLICT(id) DO NOTHING")
        .bind('screener-new-listing-volume-repair:'+hashText(JSON.stringify({symbol:stock.symbol,point})),JSON.stringify({symbol:stock.symbol,point,sourceRequests:0,reportPayloadHash:hashText(r.text)}),now.toISOString()).run();
    }
  }
  return inserted;
}
