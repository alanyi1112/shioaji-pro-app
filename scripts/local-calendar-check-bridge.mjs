// 只接固定本機 Worker 的唯讀檢查入口；不接受外部 URL、token、修復旗標或未審閱 SQL。
import {validLocalCalendarCheck} from '../src/lib/market-calendar.ts';
export async function readLocalCalendarDataCheck(query,calendar,{fetchImpl=fetch}={}){
    if(!validLocalCalendarCheck(query))return {status:422,body:{ok:false,reason:'check_input_invalid'}};
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);
    try{
        const response=await fetchImpl('http://127.0.0.1:5174/api/local-market-calendar/check',{method:'POST',
            redirect:'manual',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({query,calendar})});
        if(response.status!==200||response.redirected)throw Error('unavailable');
        const reader=response.body?.getReader();if(!reader)throw Error('unavailable');
        const chunks=[];let bytes=0;
        for(;;){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;
            if(bytes>512*1024){await reader.cancel();throw Error('limit');}chunks.push(Buffer.from(r.value));}
        const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(value.ok!==true||value.check?.schemaVersion!=='local-market-calendar-check/1'||
            value.check.externalRequests!==0||value.check.changedDb!==false||value.check.automaticRepairAllowed!==false||
            value.check.calendarVersion!==calendar.version)throw Error('unavailable');
        return {status:200,body:value};
    }catch{return {status:503,body:{ok:false,reason:'local_readonly_check_unavailable'}};}
    finally{clearTimeout(timer);}
}
