import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {admitChipCalendar} from '../worker/chip-calendar-admission.ts';
import {resolveLocalCompletedSession} from '../worker/local-completed-session.ts';
import {prewarmTaiwanStockChipSymbol} from '../worker/taiwan-stock-chip-service.ts';
import {startChipBackfillOrchestratorRun} from '../worker/chip-backfill-orchestrator.ts';
import {SqliteD1} from './helpers/sqlite-d1.mjs';
const secret='synthetic-offline-test-secret-more-than-32-characters';
const initial=new Date('2026-10-30T09:00:00Z');
const proof=(at=initial)=>{
 const p=Buffer.from(JSON.stringify({schemaVersion:'local-completed-session-proof/1',issuedAt:at.toISOString(),calendarVersion:'synthetic-only',
 decision:{expectedSession:'2026-10-30',status:'verified',reasonCode:null}})).toString('base64url');
 return p+'.'+createHmac('sha256',secret).update(p).digest('hex');
};
test('重現原30秒過期，但同輪已驗證交易日可持續至180秒；新請求仍拒絕過期證明',async t=>{
 let clock=+initial;
 t.mock.method(Date,'now',()=>clock);
 const env={LOCAL_PIPELINE_SECRET:secret,LOCAL_MARKET_CALENDAR_PROOF:proof()};
 const admitted=await admitChipCalendar(env,initial);
 clock+=31000;
 assert.equal((await resolveLocalCompletedSession(env.LOCAL_MARKET_CALENDAR_PROOF,secret,new Date(clock))).expectedSession,null);
 await assert.rejects(admitChipCalendar(env,new Date(clock)));
 assert.equal(admitted(),'2026-10-30');
 const urls=[];
 await prewarmTaiwanStockChipSymbol({env:{...env,DEPLOYMENT_TARGET:'local'},admittedSession:admitted,
  eligibility:{eligible:true,symbol:'00406A.TW',exchange:'TWSE',quoteType:'ETF',eligibleSymbols:new Set(['00406A.TW'])},
  now:new Date(clock),datasets:['institutional-flow'],fetchImpl:async url=>{urls.push(String(url));return Response.json({status:200,data:[]});}});
 assert(urls.some(url=>new URL(url).searchParams.get('end_date')==='2026-10-30'));
 clock=+initial+180000;
 assert.throws(admitted,/timeout/);
});
test('無簽章或壞簽章不得建立同輪授權',async()=>{
 await assert.rejects(admitChipCalendar({LOCAL_PIPELINE_SECRET:secret},initial),/calendar_projection_missing/);
 await assert.rejects(admitChipCalendar({LOCAL_PIPELINE_SECRET:secret,LOCAL_MARKET_CALENDAR_PROOF:proof().replace(/.$/,'x')},initial));
});
test('已驗證本機收盤日不再被22點舊啟發式擋住；未提供日曆仍維持舊行為',async()=>{
 const db=new SqliteD1();
 try {
  db.exec(`CREATE TABLE chip_backfill_orchestrator_runs(run_id TEXT PRIMARY KEY,scope TEXT,trigger TEXT,status TEXT,phase TEXT,expected_session_date TEXT,heartbeat_at TEXT,started_at TEXT,updated_at TEXT);`);
  assert.equal((await startChipBackfillOrchestratorRun({db,runId:'local-verified',trigger:'scheduled',scope:'daily',completedSession:'2026-10-30',now:initial})).expectedSessionDate,'2026-10-30');
  assert.equal((await startChipBackfillOrchestratorRun({db,runId:'legacy',trigger:'scheduled',scope:'daily',now:initial})).expectedSessionDate,'2026-10-29');
  await assert.rejects(startChipBackfillOrchestratorRun({db,runId:'future',trigger:'scheduled',scope:'daily',completedSession:'2026-10-31',now:initial}),/invalid_response/);
 } finally {db.close();}
});
