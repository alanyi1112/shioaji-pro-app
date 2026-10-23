// 本機明確操作的唯讀檢查。不可呼叫 ensureDb、collector、行情來源或修復入口。
import { auditCalendarCandles, marketDatasetExpectation, validLocalCalendarCheck, validClosureState,
  type LocalCalendarCheck, type MarketCalendar } from '../../../src/lib/market-calendar.ts';
import { SCREENER_INSTITUTIONAL_MAPPING_VERSION } from '../../../src/lib/stock-screener-v6.ts';

export async function checkLocalStoredMarketData(db:D1Database|undefined, calendar:MarketCalendar,
  query:LocalCalendarCheck, now=new Date()) {
  const base={schemaVersion:'local-market-calendar-check/1',calendarVersion:calendar?.version??'unknown',
    observedAt:now.toISOString(),externalRequests:0,changedDb:false,automaticRepairAllowed:false,query};
  const unknown=(reason:string)=>({...base,status:'unknown',reason});
  if(!validLocalCalendarCheck(query))return unknown('check_input_invalid');
  if(calendar?.schemaVersion!=='shared-local-market-calendar/1'||!validClosureState(calendar.closures)||
    !Number.isFinite(Date.parse(calendar.observedAt))||Date.parse(calendar.observedAt)>+now||+now-Date.parse(calendar.observedAt)>10_000)
    return unknown('calendar_projection_unavailable_or_stale');
  const market=query.symbol.endsWith('.TWO')?'OTC':'TSE';
  // 本次沒有獲准的 TDCC 期別契約；不把任意星期五或單日休市當作期別證據。
  if(query.dataset==='tdcc-weekly')return {...base,...marketDatasetExpectation({calendar,market,
    dataDate:query.from,dataset:'tdcc-weekly',observation:{present:false},now}),status:'unknown'};
  if(!db)return unknown('local_database_unavailable');
  try {
    if(query.dataset==='candles') {
      const start=Date.parse(query.from+'T00:00:00+08:00')/1000;
      const end=Date.parse(query.through+'T00:00:00+08:00')/1000+86400;
      const found=await db.prepare(`SELECT time,open,high,low,close,volume FROM candle_history
        WHERE provider=? AND symbol=? AND interval=? AND time>=? AND time<? ORDER BY time LIMIT 5001`)
        .bind('yfinance',query.symbol,query.interval,start,end).all<Record<string,number>>();
      if(found.results.length>5000)return unknown('local_check_row_limit');
      if(query.interval!=='1d'&&!found.results.length)return unknown('intraday_store_not_proven');
      const rows=found.results.map(row=>{
        const date=new Date((row.time+8*3600)*1000).toISOString().slice(0,10);
        const minute=new Date((row.time+8*3600)*1000).getUTCHours()*60+new Date((row.time+8*3600)*1000).getUTCMinutes();
        const valid=['time','open','high','low','close','volume'].every(k=>Number.isFinite(row[k])) && row.volume>=0 &&
          row.low>0 && row.high>=Math.max(row.open,row.close,row.low) && row.low<=Math.min(row.open,row.close);
        return {date,minute,valid};
      });
      return {...base,...auditCalendarCandles({calendar,market,from:query.from,through:query.through,
        rows,interval:query.interval,now}),checkedRows:rows.length,provider:'yfinance',
        scope:'existing-candle_history-only; not listing/suspension or all-provider proof'};
    }
    const institutional=query.dataset==='institutional-flow';
    // 固定 SQL 分支；資料與原 receipt 必須同日、同市場、同 dataset，舊映射不冒充已驗證。
    const receipt=await db.prepare(institutional ? `SELECT d.institutional_receipt_id AS receipt_id,r.source_date,
      r.status,r.missing_count,r.invalid_count,d.institutional_invalid_reason AS row_error,
      d.institutional_mapping_version AS mapping,v.status AS mapping_status,
      d.foreign_net_shares AS value_a,d.investment_trust_net_shares AS value_b
      FROM screener_chip_daily d LEFT JOIN screener_chip_receipts r ON r.id=d.institutional_receipt_id
        AND r.market=d.market AND r.requested_date=d.session_date AND r.dataset='institutional-flow'
      LEFT JOIN screener_institutional_mapping_verifications v ON v.receipt_id=r.id AND v.mapping_version=?
      WHERE d.symbol=? AND d.session_date=? AND d.market=? LIMIT 1` : `SELECT d.margin_receipt_id AS receipt_id,
      r.source_date,r.status,r.missing_count,r.invalid_count,d.margin_today_balance_lots AS value_a,
      d.short_today_balance_lots AS value_b FROM screener_chip_daily d
      LEFT JOIN screener_chip_receipts r ON r.id=d.margin_receipt_id AND r.market=d.market
        AND r.requested_date=d.session_date AND r.dataset='margin-short'
      WHERE d.symbol=? AND d.session_date=? AND d.market=? LIMIT 1`)
      .bind(...(institutional?[SCREENER_INSTITUTIONAL_MAPPING_VERSION]:[]),query.symbol,query.from,market==='TSE'?'TWSE':'TPEx')
      .first<Record<string,unknown>>();
    const present=!!receipt && (receipt.receipt_id!=null || receipt.value_a!=null || receipt.value_b!=null);
    const validValue=(v:unknown)=>typeof v==='string'&&v.length<=32&&(institutional?/^-?\d+$/:/^\d+$/).test(v)||
      typeof v==='number'&&Number.isSafeInteger(v)&&(institutional||v>=0);
    const verified=receipt?.status==='verified'&&receipt.source_date===query.from &&
      Number(receipt.invalid_count)===0&&Number(receipt.missing_count)===0&&
      validValue(receipt.value_a)&&validValue(receipt.value_b)&&(!institutional||receipt.row_error==null&&
        receipt.mapping===SCREENER_INSTITUTIONAL_MAPPING_VERSION&&receipt.mapping_status==='verified');
    const decision=marketDatasetExpectation({calendar,market,dataDate:query.from,dataset:query.dataset,
      observation:{present,verified,sourceDate:typeof receipt?.source_date==='string'?receipt.source_date:null},now});
    return {...base,...decision,status:decision.state,scope:'single-symbol stored daily row and receipt; not whole-market completeness'};
  }catch{return unknown('local_schema_or_read_unavailable');}
}

export async function handleLocalMarketCalendarCheck(request:Request,env:{DEPLOYMENT_TARGET?:string;DB?:D1Database},now=new Date()) {
  const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
  if(env.DEPLOYMENT_TARGET!=='local')return json({ok:false,reason:'local_only'},404);
  const url=new URL(request.url),origin=request.headers.get('origin');
  // Cloudflare Vite 的本機轉送會附加原 Host。只接受與已驗 loopback URL 完全相同的
  // 單一 Host，不採信它來改寫 URL／來源；代理鏈及不同／空白／多值 Host 仍拒絕。
  const forwardedHost=request.headers.get('x-forwarded-host');
  const boundary=!['127.0.0.1','localhost','[::1]'].includes(url.hostname)?'non_loopback':
    url.protocol!=='http:'?'non_http':url.search?'query_forbidden':
    origin!==null&&origin!==url.origin?'origin_mismatch':
    ['forwarded','x-forwarded-for'].some(h=>request.headers.has(h))||
      forwardedHost!==null&&forwardedHost!==url.host?'proxy_headers':null;
  if(boundary)return json({ok:false,reason:'local_same_origin_required',boundary},403);
  if(request.method!=='POST'||request.headers.get('content-type')?.split(';')[0]!=='application/json')return json({ok:false},415);
  try {
    // Body stream 全程有界，未信任 Content-Length；不讀取任意路徑或網址。
    const reader=request.body?.getReader();if(!reader)return json({ok:false},400);
    const chunks:Uint8Array[]=[];let bytes=0;
    const deadline=Date.now()+2000;
    for(;;){let timer:ReturnType<typeof setTimeout>|undefined;
      const r=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void reader.cancel();reject(Error('body_timeout'));},Math.max(1,deadline-Date.now()));})]).finally(()=>clearTimeout(timer));
      if(r.done)break;bytes+=r.value.byteLength;
      if(bytes>512*1024){void reader.cancel();return json({ok:false,reason:'payload_too_large'},413);}chunks.push(r.value);}
    const raw=new Uint8Array(bytes);let offset=0;for(const c of chunks){raw.set(c,offset);offset+=c.length;}
    const body=JSON.parse(new TextDecoder().decode(raw));
    if(Object.keys(body).sort().join(',')!=='calendar,query'||!validLocalCalendarCheck(body.query))return json({ok:false,reason:'check_input_invalid'},422);
    return json({ok:true,check:await checkLocalStoredMarketData(env.DB,body.calendar,body.query,now)});
  }catch{return json({ok:false,reason:'check_unavailable'},503);}
}
