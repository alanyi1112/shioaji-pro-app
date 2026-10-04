import assert from 'node:assert/strict';
import test from 'node:test';
import { clearOfficialSessionRuntimeState, resolveOfficialCompletedSession, seedOfficialTradingCalendar } from '../worker/official-trading-session.ts';

function calendarFetch({ twseClosed = ['2026-09-25', '2026-09-28'], tpexClosed = ['9月25日', '9月28日'], fail = false } = {}) {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    if (fail) throw new Error('offline');
    const twse = {
      stat: 'ok', queryYear: 2026, fields: ['日期', '名稱', '說明'],
      data: twseClosed.map((date) => [date, '市場無交易', '依規定放假。']),
    };
    const html = `<table><tr><td>中華民國115年有價證券櫃檯買賣市場開（休）市日期表</td></tr></table>
      <table><tr><th>名稱</th><th>日期</th><th>星期</th><th>說明</th></tr>
      ${tpexClosed.map((date) => `<tr><td>休市</td><td>${date}</td><td>一</td><td>依規定放假。</td></tr>`).join('')}</table>`;
    return new Response(JSON.stringify(url.includes('twse.com.tw') ? twse : { data: { html } }), { status: 200 });
  };
  return { fetchImpl, calls: () => calls };
}

test('官方休市週一不推定為日 K 缺口，且年度來源共用快取', async () => {
  clearOfficialSessionRuntimeState();
  const source = calendarFetch();
  const monday = await resolveOfficialCompletedSession(new Date('2026-09-28T10:00:00Z'), source.fetchImpl);
  const sameWindow = await resolveOfficialCompletedSession(new Date('2026-09-28T10:01:00Z'), source.fetchImpl);
  assert.deepEqual(monday, { expectedSession: '2026-09-24', status: 'verified', reasonCode: null });
  assert.deepEqual(sameWindow, monday);
  assert.equal(source.calls(), 2);
  assert.equal((await resolveOfficialCompletedSession(new Date('2026-09-29T01:00:00Z'), source.fetchImpl)).expectedSession, '2026-09-24');
});

test('交易日盤後才要求當日日 K', async () => {
  clearOfficialSessionRuntimeState();
  const source = calendarFetch();
  assert.equal((await resolveOfficialCompletedSession(new Date('2026-09-24T06:59:00Z'), source.fetchImpl)).expectedSession, '2026-09-23');
  assert.equal((await resolveOfficialCompletedSession(new Date('2026-09-24T07:00:00Z'), source.fetchImpl)).expectedSession, '2026-09-24');
});

test('來源失敗與兩市場衝突均 fail closed', async () => {
  clearOfficialSessionRuntimeState();
  assert.deepEqual(await resolveOfficialCompletedSession(new Date('2026-09-28T10:00:00Z'), calendarFetch({ fail: true }).fetchImpl),
    { expectedSession: null, status: 'unknown', reasonCode: 'calendar_twse_fetch_failed' });
  clearOfficialSessionRuntimeState();
  assert.deepEqual(await resolveOfficialCompletedSession(new Date('2026-09-28T10:00:00Z'), calendarFetch({ tpexClosed: ['9月25日'] }).fetchImpl),
    { expectedSession: null, status: 'unknown', reasonCode: 'calendar_market_conflict' });
});

test('未知官方 schema 不接受平日推測', async () => {
  clearOfficialSessionRuntimeState();
  const source = async () => new Response('<html>login</html>', { status: 200 });
  assert.deepEqual(await resolveOfficialCompletedSession(new Date('2026-09-28T10:00:00Z'), source),
    { expectedSession: null, status: 'unknown', reasonCode: 'calendar_schema_mismatch' });
});

test('受保護的官方資料種入後可供離線 Worker 使用，過期仍維持未知', async () => {
  clearOfficialSessionRuntimeState();
  const source = calendarFetch();
  const twse = await (await source.fetchImpl('https://www.twse.com.tw/holidaySchedule/holidaySchedule')).json();
  const tpex = await (await source.fetchImpl('https://www.tpex.org.tw/www/zh-tw/bulletin/tradingDate')).json();
  const stored = new Map();
  const db = { prepare() { return { bind(key, payload) { return {
    async run() { stored.set(key, payload); },
    async first() { return stored.has(key) ? { payload: stored.get(key) } : null; },
  }; } }; } };
  await seedOfficialTradingCalendar(db, 2026, twse, tpex, new Date('2026-09-28T08:00:00Z'));
  clearOfficialSessionRuntimeState();
  const offline = calendarFetch({ fail: true });
  assert.equal((await resolveOfficialCompletedSession(new Date('2026-09-28T10:00:00Z'), offline.fetchImpl, db)).expectedSession, '2026-09-24');
  assert.equal(offline.calls(), 0);
  clearOfficialSessionRuntimeState();
  assert.equal((await resolveOfficialCompletedSession(new Date('2026-10-03T10:00:00Z'), offline.fetchImpl, db)).status, 'unknown');
});
