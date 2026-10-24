/** 操作者以剛取得的官方原始收據純重用恢復；不下載、不清除舊失敗或無關 blocked。 */
import {randomUUID} from 'node:crypto';
import {readVerifiedWeeklyCatalog} from '../apps/multiview/worker/stock-screener-collector.ts';
import {fetchTdccLatestOfficial,parseTdccLatestCsv,TDCC_LATEST_SOURCES} from '../apps/multiview/worker/tdcc-latest-source.ts';
import {parseHolderBatch} from '../apps/multiview/worker/stock-screener-sources.ts';
import {hashText} from './stock-screener-periods.mjs';

export async function recoverScreenerWeeklyReceipts({db,receipts,authorization,now=new Date(),clock=Date.now}={}){
 if(authorization?.approved!==true||authorization.maximumSourceRequests!==0||!/^\d{4}-\d{2}-\d{2}$/.test(authorization.dataDate??''))throw Error('weekly_recovery_not_authorized');
 const catalog=await readVerifiedWeeklyCatalog(db,now);
 if(!catalog||catalog.receipt.hash!==authorization.catalogRevision)throw Error('invalid_cached_catalog');
 const byUrl=new Map();
 for(const r of receipts??[]){
  if(!Object.values(TDCC_LATEST_SOURCES).includes(r.sourceUrl)||r.status!==200||typeof r.text!=='string'
   ||Buffer.byteLength(r.text)>24*1024**2||!Buffer.byteLength(r.text)||hashText(r.text)!==r.payloadHash
   ||!Number.isFinite(Date.parse(r.fetchedAt))||Date.parse(r.fetchedAt)>+now||+now-Date.parse(r.fetchedAt)>24*3600000||byUrl.has(r.sourceUrl))throw Error('invalid_weekly_source_receipt');
  byUrl.set(r.sourceUrl,r);
 }
 if(byUrl.size!==2)throw Error('invalid_weekly_source_receipt');
 // 既有官方雙來源候選驗證：全市場門檻、逐檔完整 17 級、日期與 material 一致。
 const sets=[...byUrl.values()].map(r=>new Set((r.sourceUrl===TDCC_LATEST_SOURCES.csv?parseTdccLatestCsv(r.text):JSON.parse(r.text)).map(x=>String(x['證券代號']).trim())));
 const eligible=new Set(catalog.stocks.filter(s=>sets.every(set=>set.has(s.code))).map(s=>s.symbol));
 const missing=catalog.stocks.filter(s=>!eligible.has(s.symbol)).map(s=>s.symbol).sort();
 if(eligible.size<Math.ceil(catalog.stocks.length*0.95))throw Error('invalid_weekly_universe_coverage');
 const selected=await fetchTdccLatestOfficial({eligibleSymbols:eligible,now,
  fetchImpl:async url=>{const r=byUrl.get(String(url));if(!r)throw Error('source_download_not_authorized');return new Response(r.text,{status:r.status});}});
 if(selected.dataDate!==authorization.dataDate)throw Error('invalid_report_date');
 const sourceUrl=TDCC_LATEST_SOURCES[selected.source],source=byUrl.get(sourceUrl),payloadHash=hashText(JSON.stringify(selected.payload));
 const parsed=parseHolderBatch(selected.payload,catalog.stocks,{source:'TDCC',sourceUrl,fetchedAt:source.fetchedAt,payloadHash,normalizationVersion:'screener-official-v1'});
 if(parsed.date!==authorization.dataDate||parsed.invalid.size||parsed.points.size!==eligible.size)throw Error('invalid_weekly_universe_coverage');
 const proof={version:1,dataDate:parsed.date,catalogRevision:catalog.receipt.hash,catalogReceipt:catalog.receipt,
  sources:[...byUrl.values()].map(r=>({sourceUrl:r.sourceUrl,payloadHash:r.payloadHash,fetchedAt:r.fetchedAt,bytes:Buffer.byteLength(r.text)})),
  canonicalPayloadHash:payloadHash,rows:parsed.points.size,universeTarget:catalog.stocks.length,missingSymbols:missing,sourceRequests:0};
 const id='screener-weekly-bulk-recovery:'+hashText(JSON.stringify(proof));
 const existing=await db.prepare('SELECT status FROM screener_runs WHERE id=?').bind(id).first();
 if(existing?.status==='collected')return{state:'reused',receiptId:id,dataDate:parsed.date,rows:parsed.points.size,missingSymbols:missing,sourceRequests:0};
 const owner=randomUUID(),lease='screener-collector-lease',at=now.toISOString(),until=new Date(+now+15*60000).toISOString();
 await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,lease_until,updated_at) VALUES(?,'screener-collector','running',?,?,?) ON CONFLICT(id) DO UPDATE SET status='running',checkpoint=excluded.checkpoint,lease_until=excluded.lease_until,updated_at=excluded.updated_at WHERE lease_until IS NULL OR lease_until<=?").bind(lease,owner,until,at,at).run();
 const guard=async()=>{const r=await db.prepare('SELECT checkpoint,lease_until FROM screener_runs WHERE id=?').bind(lease).first();if(r?.checkpoint!==owner||Date.parse(r.lease_until)<=clock())throw Error('lease_lost')};
 try{
  await guard();const original=await db.prepare("SELECT status,checkpoint,updated_at FROM screener_runs WHERE id='screener-weekly'").first();
  const writeRun=(key,scope,status,body)=>db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM screener_runs WHERE id=? AND checkpoint=? AND lease_until>?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,checkpoint=excluded.checkpoint,updated_at=excluded.updated_at").bind(key,scope,status,JSON.stringify(body),at,lease,owner,new Date(clock()).toISOString());
  await writeRun(id,'screener-weekly-bulk-recovery','running',{...proof,original}).run();
  const points=[...parsed.points];
  for(let i=0;i<points.length;i+=50){await guard();await db.batch(points.slice(i,i+50).map(([symbol,point])=>db.prepare("INSERT INTO screener_tdcc_weekly(symbol,data_date,payload,validation) SELECT ?,?,?,'full-17' WHERE EXISTS(SELECT 1 FROM screener_runs WHERE id=? AND checkpoint=? AND lease_until>?) ON CONFLICT(data_date,symbol) DO UPDATE SET payload=excluded.payload,validation=excluded.validation WHERE json_extract(excluded.payload,'$.provenance.fetchedAt')>=json_extract(screener_tdcc_weekly.payload,'$.provenance.fetchedAt')").bind(symbol,point.date,JSON.stringify(point),lease,owner,new Date(clock()).toISOString())));}
  const saved=await db.prepare("SELECT count(*) n FROM screener_tdcc_weekly WHERE data_date=? AND validation='full-17' AND json_extract(payload,'$.provenance.payloadHash')=?").bind(parsed.date,payloadHash).first();
  if(Number(saved?.n)!==points.length)throw Error('invalid_stored_weekly_coverage');
  const receipt={hash:payloadHash+':'+catalog.receipt.hash,date:parsed.date,offset:points.length,total:points.length,invalid:missing.length,invalidSymbols:Object.fromEntries(missing.map(s=>[s,'official_source_missing'])),universeTarget:catalog.stocks.length,missingSymbols:missing,complete:true,fetchedAt:source.fetchedAt,sourceUrl,sourcePayloadHash:source.payloadHash};
  const checkpoint={version:1,day:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(now),attempts:0,
   nextAttemptAt:new Date(+now+24*3600000).toISOString(),receipts:{catalog:catalog.receipt,TDCC:receipt},reason:'period_review_pending',recoveryReceiptId:id};
  await guard();await db.batch([
   writeRun('screener-period:TDCC:'+parsed.date,'screener-source-period','collected',{...receipt,source:'TDCC',recoveryReceiptId:id}),
   writeRun('screener-weekly','screener-weekly','collected',checkpoint),
   writeRun(id,'screener-weekly-bulk-recovery','collected',{...proof,original,completedAt:new Date().toISOString()}),
  ]);
  return{state:'collected',receiptId:id,dataDate:parsed.date,rows:points.length,missingSymbols:missing,sourceRequests:0};
 }finally{await db.prepare("UPDATE screener_runs SET status='idle',lease_until=NULL WHERE id=? AND checkpoint=?").bind(lease,owner).run();}
}
