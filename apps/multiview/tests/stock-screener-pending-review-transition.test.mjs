import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fallbackFixture } from './helpers/bollinger-fallback.mjs';
import { saveSourceReview } from '../../../scripts/stock-screener-source-selection.mjs';
import { technicalEvidenceHash } from '../../../src/lib/stock-screener-technical-patterns.ts';
import { transitionPendingDailyQuotesReview } from '../../../scripts/stock-screener-pending-review-transition.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
async function setup() {
  const f=await fallbackFixture();await f.seed();const date=f.sessions.at(-3),key=`${f.review.mappingVersion}|${date}`;
  const sample=await f.db.prepare("SELECT id,payload FROM screener_daily_quotes_receipts WHERE status='complete' LIMIT 1").first();
  const facts={version:1,provider:'shioaji-daily-quotes',priorReviewId:f.backup.id,priorEvidenceHash:f.review.evidenceHash,
    reviewedAt:f.review.reviewedAt,validThrough:f.review.validThrough,schema:{endpoint:f.review.endpoint},sampleReceiptId:sample.id,sampleReceiptHash:sha(sample.payload)};
  const review={...f.review,evidenceHash:sha(JSON.stringify(facts))};
  const next=await saveSourceReview(f.db,{provider:'shioaji-daily-quotes',review},f.now());
  await f.db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,'screener-source-review-renewal','verified',?,?)")
    .bind(`screener-source-review-renewal:${review.evidenceHash}`,JSON.stringify({...facts,newReviewId:next.id}),f.now().toISOString()).run();
  await f.db.prepare("UPDATE screener_daily_quotes_cache SET status='pending',attempts=0,response_text=NULL,payload_hash=NULL,fetched_at=NULL,reason='broker_rate_limited',next_attempt_at=NULL,lease_owner=NULL,lease_until=NULL WHERE cache_key=?").bind(key).run();
  return{...f,date,key,next};
}
const args=async f=>({db:f.db,sessionDate:f.date,reviewId:f.next.id,now:f.now,authorization:{approved:true,sessionDate:f.date,maximumSourceRequests:1,
  expectedCacheHash:await technicalEvidenceHash(await f.db.prepare('SELECT * FROM screener_daily_quotes_cache WHERE cache_key=?').bind(f.key).first())}});
test('明確授權且從未下載的 pending 可沿 verified review chain 接續，完整保留舊列收據',async()=>{
 const f=await setup();try{
  const input=await args(f),before=await f.db.prepare('SELECT * FROM screener_daily_quotes_cache WHERE cache_key=?').bind(f.key).first();
  const batch=f.db.batch.bind(f.db);f.db.batch=async statements=>(await batch(statements)).map(r=>({changes:r.meta.changes}));
  const r=await transitionPendingDailyQuotesReview(input);assert.equal(r.sourceRequests,0);
  const row=await f.db.prepare('SELECT * FROM screener_daily_quotes_cache WHERE cache_key=?').bind(f.key).first();
  assert.equal(row.review_hash,f.next.review.evidenceHash);assert.equal(row.attempts,0);assert.equal(row.reason,before.reason);
  const receipt=await f.db.prepare('SELECT payload FROM screener_daily_quotes_receipts WHERE id=?').bind(r.receiptId).first();
  assert.deepEqual(JSON.parse(receipt.payload).original,{...before});
  await assert.rejects(transitionPendingDailyQuotesReview(input),/transition_denied/);
 }finally{f.db.close();}
});
test('未授權、已下載／invalid、未到冷卻、斷鏈或舊 hash 不符，全部保留原狀',async()=>{
 for(const kind of ['authorization','attempts','invalid','cooldown','chain','hash']){
  const f=await setup();try{
   if(kind==='attempts')await f.db.prepare('UPDATE screener_daily_quotes_cache SET attempts=1 WHERE cache_key=?').bind(f.key).run();
   if(kind==='invalid')await f.db.prepare("UPDATE screener_daily_quotes_cache SET status='invalid' WHERE cache_key=?").bind(f.key).run();
   if(kind==='cooldown')await f.db.prepare('UPDATE screener_daily_quotes_cache SET next_attempt_at=? WHERE cache_key=?').bind(new Date(+f.now()+60000).toISOString(),f.key).run();
   if(kind==='chain')await f.db.prepare("DELETE FROM screener_runs WHERE scope='screener-source-review-renewal'").run();
   const input=await args(f);if(kind==='authorization')input.authorization.approved=false;if(kind==='hash')input.authorization.expectedCacheHash='0'.repeat(64);
   const before=await f.db.prepare('SELECT * FROM screener_daily_quotes_cache WHERE cache_key=?').bind(f.key).first();
   await assert.rejects(transitionPendingDailyQuotesReview(input),/transition_denied/);
   assert.deepEqual(await f.db.prepare('SELECT * FROM screener_daily_quotes_cache WHERE cache_key=?').bind(f.key).first(),before);
  }finally{f.db.close();}
 }
});

test('明確單日限額可在既有背景程序沿驗證鏈接續；純重用模式仍零下載且不換綁',async()=>{
 const {dailyQuotesRequestLimitKey}=await import('../../../scripts/stock-screener-shioaji-daily-quotes.mjs');
 const {prepareSelectedBollingerHistory}=await import('../../../scripts/stock-screener-provider-prepare.mjs');
 const f=await setup();try{
  await f.db.prepare('DELETE FROM screener_source_selected_rows WHERE selection_key IN (SELECT selection_key FROM screener_source_selections WHERE session_date=?)').bind(f.date).run();
  await f.db.prepare('DELETE FROM screener_source_selections WHERE session_date=?').bind(f.date).run();
  const row=await f.db.prepare('SELECT * FROM screener_daily_quotes_cache WHERE cache_key=?').bind(f.key).first();
  const body={version:1,cacheKey:f.key,sessionDate:f.date,maximumSourceRequests:1,originalCacheHash:await technicalEvidenceHash(row),originalReviewHash:row.review_hash,authorizedAt:f.now().toISOString(),expiresAt:f.review.validThrough};
  await f.db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,'screener-single-request-limit','verified',?,?)").bind(dailyQuotesRequestLimitKey(f.key),JSON.stringify({...body,evidenceHash:sha(JSON.stringify(body))}),f.now().toISOString()).run();
  const options={...f.options,reviewIds:{'shioaji-daily-quotes':f.next.id}};
  const reuse=await prepareSelectedBollingerHistory({...options,reuseExistingOnly:true});
  assert.equal(reuse.requested,0);assert.equal((await f.db.prepare('SELECT review_hash FROM screener_daily_quotes_cache WHERE cache_key=?').bind(f.key).first()).review_hash,row.review_hash);
  const next=await prepareSelectedBollingerHistory(options);assert.equal(next.state,'complete');assert.equal(next.requested,1);
  const cached=await f.db.prepare('SELECT status,attempts FROM screener_daily_quotes_cache WHERE cache_key=?').bind(f.key).first();assert.equal(cached.status,'complete');assert.equal(cached.attempts,1);
 }finally{f.db.close()}
});
