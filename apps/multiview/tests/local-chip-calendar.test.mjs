import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {prewarmTaiwanStockChipSymbol} from '../worker/taiwan-stock-chip-service.ts';
const now=new Date('2026-10-23T16:30:00.000Z'),secret='synthetic-test-secret-with-more-than-32-characters';
const eligibility={eligible:true,symbol:'2330.TW',exchange:'TWSE',eligibleSymbols:new Set(['2330.TW'])};
const proof=()=>{
 const p=Buffer.from(JSON.stringify({schemaVersion:'local-completed-session-proof/1',issuedAt:now.toISOString(),calendarVersion:'synthetic-closure',
 decision:{expectedSession:'2026-10-22',status:'verified',reasonCode:null}})).toString('base64url');
 return p+'.'+createHmac('sha256',secret).update(p).digest('hex');
};
test('本機預熱缺少有效日曆憑證時，發送來源前阻擋',async()=>{
 let requests=0;
 await assert.rejects(prewarmTaiwanStockChipSymbol({env:{DEPLOYMENT_TARGET:'local',LOCAL_PIPELINE_SECRET:secret},eligibility,now,
 fetchImpl:async()=>{requests++;throw Error('unexpected_source');}}),/calendar_projection_missing/);
 assert.equal(requests,0);
});
test('本機預熱使用簽章日曆的上個交易日，不抓休市日',async()=>{
 const urls=[];
 await prewarmTaiwanStockChipSymbol({env:{DEPLOYMENT_TARGET:'local',LOCAL_PIPELINE_SECRET:secret,LOCAL_MARKET_CALENDAR_PROOF:proof()},
 eligibility,now,datasets:['institutional-flow'],fetchImpl:async url=>{urls.push(String(url));return Response.json({status:200,data:[]});}});
 const primary=urls.find(url=>url.includes('finmind'));
 assert(primary);
 assert.equal(new URL(primary).searchParams.get('end_date'),'2026-10-22');
 assert.equal(new URL(primary).searchParams.get('start_date'),'2025-10-22');
});
