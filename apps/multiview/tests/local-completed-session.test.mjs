import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketCalendar } from '../../../src/lib/market-calendar.ts';
import { localCompletedSessionFromCalendar, resolveLocalCompletedSession } from '../worker/local-completed-session.ts';
const now = new Date('2026-10-23T16:10:00Z');
const fixture = () => createMarketCalendar({ verified: true, calendarVersion: 'fixture', fetchedAtEpochMs: +now - 1000,
  validUntilEpochMs: +now + 100000, days: ['2026-10-22','2026-10-23','2026-10-24'].map(tradeDate => ({tradeDate,TSE:'scheduled_trading',OTC:'scheduled_trading'})) },
  { available: true, revision: 1, hash: 'f'.repeat(64), entries: [{date:'2026-10-23',markets:['TSE','OTC'],reason:'fixture',revision:1,recordedAt:now.toISOString(),source:'local_user'}],liveHolds:[] },now);
test('本機日 K 尊重手動休市，10/24 凌晨回到 10/22', () => {
  assert.equal(localCompletedSessionFromCalendar(fixture(),now).expectedSession,'2026-10-22');
  const open=fixture();open.closures.entries=[];
  assert.equal(localCompletedSessionFromCalendar(open,now).expectedSession,'2026-10-23');
});
test('設定失效、來源過期與市場衝突 fail closed，不退回獨立年度日曆', () => {
  for (const mutate of [c=>c.closures.available=false,c=>c.annual.validUntilEpochMs=+now-1,
    c=>c.closures.entries[0].markets=['TSE'], c=>c.observedAt=new Date(+now-31000).toISOString()]) {
    const c=fixture();mutate(c);assert.equal(localCompletedSessionFromCalendar(c,now).expectedSession,null);
  }
});
test('簽章證明逐次驗證，偽造、過期、缺 secret 不接受，不需要任何 fetch', async () => {
  const { signLocalCalendarProof } = await import('../build/local-market-calendar-plugin.ts');
  const secret = 'synthetic-calendar-secret'.repeat(3), proof = signLocalCalendarProof(fixture(),secret,now);
  assert.equal((await resolveLocalCompletedSession(proof,secret,now)).expectedSession,'2026-10-22');
  for (const [value,key,time] of [[proof+'0',secret,now],[proof,'wrong-secret'.repeat(4),now],[proof,secret,new Date(+now+31000)],['',secret,now],[proof,'',now]]) {
    assert.equal((await resolveLocalCompletedSession(value,key,time)).status,'unknown');
  }
});

test('Node header 與 rawHeaders 一起替換，剝除重複偽造值後只送一份本機證明', async () => {
  const { replaceLocalCalendarProof,LOCAL_CALENDAR_HEADER }=await import('../build/local-market-calendar-plugin.ts');
  const request={headers:{host:'127.0.0.1:5174',[LOCAL_CALENDAR_HEADER]:'forged'},
    rawHeaders:['Host','127.0.0.1:5174','X-MultiView-Local-Calendar-Proof','forged',LOCAL_CALENDAR_HEADER,'duplicate']};
  replaceLocalCalendarProof(request,'signed-fixture');
  assert.equal(request.headers[LOCAL_CALENDAR_HEADER],'signed-fixture');
  assert.deepEqual(request.rawHeaders,['Host','127.0.0.1:5174',LOCAL_CALENDAR_HEADER,'signed-fixture']);
  replaceLocalCalendarProof(request);assert.equal(request.headers[LOCAL_CALENDAR_HEADER],undefined);
  assert.deepEqual(request.rawHeaders,['Host','127.0.0.1:5174']);
});

test('已保存 TWSE 全日公告只排除上市；hash 不符或過期不作休市證據', async () => {
  const {applySavedTseClosures}=await import('../build/local-market-calendar-closures.ts');
  const {createHash}=await import('node:crypto');
  const text=JSON.stringify({stat:'ok',fields:['項次','標題','日期','zhId','enId'],totalCount:1,
    data:[[1,'臺灣證券交易所集中交易市場115年10月22日休市一天','115年10月21日','a'.repeat(32),'b'.repeat(32)]]});
  const e={policy:'official-full-day-market-closures-v1',year:2026,sourceUrl:'https://www.twse.com.tw/rwd/zh/news/newsList?response=json&startDate=2026&endDate=2026',
    fetchedAt:now.toISOString(),text,sourceHash:createHash('sha256').update(JSON.stringify(text)).digest('hex')};
  const c=applySavedTseClosures(fixture(),{status:'verified',checkpoint:JSON.stringify(e)},now);
  assert.equal(c.annual.days[0].TSE,'closed');assert.equal(c.annual.days[0].OTC,'scheduled_trading');
  for(const change of [{sourceHash:'0'.repeat(64)},{fetchedAt:'2026-10-22T00:00:00Z'}]) {
    const r=applySavedTseClosures(fixture(),{status:'verified',checkpoint:JSON.stringify({...e,...change})},now);
    assert.equal(r.annual.days[0].TSE,'scheduled_trading');
  }
});
