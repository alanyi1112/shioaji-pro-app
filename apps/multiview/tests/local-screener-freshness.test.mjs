import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {bindLocalScreenerCalendar,readScreenerFreshness} from '../worker/stock-screener-session-readiness.ts';
import {createScreenerSessionReadiness} from '../../../src/lib/stock-screener-session-readiness.ts';
const now=new Date('2026-10-23T23:50:00Z'),secret='synthetic-secret-with-more-than-thirty-two-characters';
const proof=(expected='2026-10-22',states='SCC')=>{const payload=Buffer.from(JSON.stringify({schemaVersion:'local-completed-session-proof/1',issuedAt:now.toISOString(),calendarVersion:'fixture',
 calendarWindow:{from:'2026-10-22',through:'2026-10-24',TSE:states,OTC:states,version:'fixture',validUntil:new Date(+now+60000).toISOString()},decision:{status:'verified',expectedSession:expected,reasonCode:null}})).toString('base64url');
 return payload+'.'+createHmac('sha256',secret).update(payload).digest('hex');};
function fixture(){
 const saved=createScreenerSessionReadiness('2026-10-23','2026-10-22',now);
 const raw=JSON.stringify(saved);let writes=0;
 const db={prepare(sql){let args=[];return{bind(...v){args=v;return this},async first(){
  if(args[0]==='screener-session-readiness')return{checkpoint:raw};
  if(args[0]?.startsWith('screener-period:')){const market=args[0].split(':')[1];return{status:'collected',checkpoint:JSON.stringify({source:market,date:'2026-10-22',complete:true,hash:'a'.repeat(64)+':'+ 'b'.repeat(64),total:1000,offset:1000})};}
  return null;
 },async run(){writes++;throw Error('unexpected_write')}}}};
 return{db,saved,raw,writes:()=>writes};
}
test('休市日舊 pending 只在有效日曆與雙市場收據齊全時被唯讀投影取代',async()=>{
 const f=fixture(),db=await bindLocalScreenerCalendar(f.db,proof(),secret,now);
 const result=await readScreenerFreshness(db,'2026-10-22');
 assert.equal(result.pending,false);assert.equal(result.expectedSessionDate,'2026-10-22');assert.equal(result.readiness,null);
 assert.equal(JSON.parse(f.raw).expectedSessionDate,'2026-10-23');assert.equal(f.writes(),0);
});
test('兩個 request 的日曆不串用；無簽章與缺市場收據不得顯示已齊',async()=>{
 const f=fixture();const [closed,open]=await Promise.all([bindLocalScreenerCalendar(f.db,proof(),secret,now),bindLocalScreenerCalendar(f.db,proof('2026-10-23','SSC'),secret,now)]);
 assert.equal((await readScreenerFreshness(closed,'2026-10-22')).pending,false);
 assert.equal((await readScreenerFreshness(open,'2026-10-22')).pending,true);
 assert.equal((await readScreenerFreshness(f.db,'2026-10-22')).pending,true);
 const bad=await bindLocalScreenerCalendar(f.db,'invalid',secret,now);
 assert.equal((await readScreenerFreshness(bad,'2026-10-22')).pending,true);
 const missing={prepare(sql){const s=f.db.prepare(sql);return{bind(...a){s.bind(...a);this.args=a;return this},async first(){return this.args?.[0]?.includes('TPEx')?null:s.first()}}}};
 assert.equal((await readScreenerFreshness(await bindLocalScreenerCalendar(missing,proof(),secret,now),'2026-10-22')).pending,true);
 assert.equal(f.writes(),0);
});
