import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackFixture } from './helpers/bollinger-fallback.mjs';
import { prepareSelectedBollingerHistory } from '../../../scripts/stock-screener-provider-prepare.mjs';
import { sourceWindowMapping, readSourceSelection } from '../../../scripts/stock-screener-source-selection.mjs';
import { technicalEvidenceHash } from '../../../src/lib/stock-screener-technical-patterns.ts';

test('未驗官方改用獨立 verified 備援；每輪2次，同日期双市場一次', async () => {
    const f = await fallbackFixture(); try {
        const r = await prepareSelectedBollingerHistory(f.options);
        assert.equal(r.state,'pending'); assert.equal(r.requested,2); assert.equal(f.calls(),2); assert.equal(f.officialCalls(),0);
        assert.equal(r.processed,4); assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_source_selections').first()).n,4);
        const rows = (await f.db.prepare('SELECT manifest FROM screener_source_selections').all()).results;
        assert(rows.every(r => JSON.parse(r.manifest).switchReason==='official_contract_pending'));
    } finally { f.db.close(); }
});
test('官方優先失敗保留 partial；同run只再一次備援；冷卻不重抓官方', async () => {
    const f = await fallbackFixture(); try {
        await f.addOfficial('TWSE'); await f.addOfficial('TPEx');
        const first = await prepareSelectedBollingerHistory(f.options);
        assert.equal(first.requested,2); assert.equal(f.officialCalls(),1); assert.equal(f.calls(),1);
        const before = (await f.db.prepare("SELECT * FROM screener_bollinger_receipts WHERE status='partial' AND target_key IS NOT NULL").all()).results;
        assert.equal(before.length,1);
        const frozen = (await f.db.prepare('SELECT manifest FROM screener_source_selections').all()).results.map(r=>JSON.parse(r.manifest));
        assert(frozen.some(m => m.officialFailures.length===1));
        await prepareSelectedBollingerHistory(f.options);
        const original = await f.db.prepare('SELECT * FROM screener_bollinger_receipts WHERE id=?').bind(before[0].id).first();
        assert.deepEqual({...original},{...before[0]});
        // 另一市場仍可走自己的第一次官方嘗試，但已冷卻 target 不重抓。
        const attempts = await f.db.prepare('SELECT attempts FROM screener_bollinger_batches WHERE target_key=?').bind(before[0].target_key).first();
        assert.equal(attempts.attempts,1);
    } finally { f.db.close(); }
});
test('官方成功凍結 official provider；不使用同日備援替代合法來源', async () => {
    const f = await fallbackFixture(); try {
        await f.addOfficial('TWSE'); await f.addOfficial('TPEx'); let requests=0;
        const r = await prepareSelectedBollingerHistory({...f.options, fetchOfficial: async t => { requests++; return f.officialResponse(t); }});
        assert.equal(r.requested,2); assert.equal(requests,2); assert.equal(f.calls(),0);
        const m = (await f.db.prepare('SELECT manifest FROM screener_source_selections').all()).results.map(r=>JSON.parse(r.manifest));
        assert.equal(m.length,2); assert(m.every(s=>s.provider.startsWith('official-') && s.switchReason===null));
    } finally { f.db.close(); }
});
test('日曆／母體 unknown、來源review缺少都不下載', async () => {
    for (const change of [{calendar:{status:'pending'}},{universeEvidence:{status:'unknown'}},{reviewIds:{}}]) {
        const f = await fallbackFixture(); try {
            const r=await prepareSelectedBollingerHistory({...f.options,...change}); assert.equal(r.requested,0); assert.equal(f.calls(),0);
        } finally { f.db.close(); }
    }
});
test('官方交易日08:30到14:00保留broker額度；盤後才可續跑', async () => {
    for (const clock of ['08:30:00','13:59:59','14:00:00']) {
        const f = await fallbackFixture(); try {
            const now = () => new Date(`2026-10-04T${clock}+08:00`);
            const calendar = { ...f.options.calendar, commonSessions: [...f.sessions, '2026-10-04'] };
            const r = await prepareSelectedBollingerHistory({ ...f.options, calendar, now,
                safety: async () => ({ simulation: true, businessSessionEstablished: true, generation: 'fixture-generation', observedAt: now().toISOString() }) });
            assert.equal(r.requested, clock === '14:00:00' ? 2 : 0);
            if (clock !== '14:00:00') assert.equal(r.reason, 'broker_intraday_reserved');
        } finally { f.db.close(); }
    }
});
test('官方HTML／403維持原失敗收據；可用verified備援但不解除官方錯誤', async () => {
    for (const status of [200,403]) {
        const f = await fallbackFixture(); try {
            await f.addOfficial('TWSE'); await f.addOfficial('TPEx');
            const r = await prepareSelectedBollingerHistory({ ...f.options, fetchOfficial: async t => ({ sourceUrl: f.officialResponse(t).sourceUrl,
                status, text: '<html>blocked</html>', fetchedAt: f.now().toISOString() }) });
            assert.equal(r.requested,2); assert.equal(f.calls(),1);
            const receipts = (await f.db.prepare("SELECT * FROM screener_bollinger_receipts WHERE target_key IS NOT NULL AND status IN ('failed','partial')").all()).results;
            assert.equal(receipts.length,1);
            const frozen = (await f.db.prepare('SELECT manifest FROM screener_source_selections').all()).results.map(s=>JSON.parse(s.manifest));
            assert(frozen.some(s=>s.provider==='shioaji-daily-quotes' && s.officialFailures.some(r=>r.id===receipts[0].id)));
            assert.equal((await f.db.prepare('SELECT * FROM screener_bollinger_receipts WHERE id=?').bind(receipts[0].id).first()).payload,receipts[0].payload);
        } finally { f.db.close(); }
    }
});
test('額度拒絕與simulation Gate失敗零來源 request、不耗broker attempt', async () => {
    const f = await fallbackFixture(); try {
        const r=await prepareSelectedBollingerHistory({...f.options,admission:{reserve:async()=>({allowed:false}),settle:async()=>{}}});
        assert.equal(r.requested,0); assert.equal(f.calls(),0);
        const rows=(await f.db.prepare('SELECT attempts FROM screener_daily_quotes_cache').all()).results;
        assert(rows.every(r=>r.attempts===0));
        assert.equal(rows.length,1, '共用 admission 拒絕應結束整輪，不逐日寫入冷卻');
    } finally { f.db.close(); }
});
test('全域限流保留原原因／期限，當輪不再嘗試其他交易日', async () => {
    const f = await fallbackFixture(); let admissions = 0;
    try {
        const retry = new Date(f.now().getTime() + 60000).toISOString();
        const result = await prepareSelectedBollingerHistory({ ...f.options, admission: {
            reserve: async () => { admissions++; return { allowed:false, reason:'broker_rate_limited', nextAttemptAt:retry }; },
            settle: async () => {}
        } });
        assert.equal(admissions,1); assert.equal(result.reason,'broker_rate_limited');
        assert.equal(result.nextAttemptAt,retry); assert.equal(result.requested,0);
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_daily_quotes_cache').first()).n,1);
        const original = await f.db.prepare('SELECT * FROM screener_daily_quotes_receipts').first();
        await prepareSelectedBollingerHistory({ ...f.options, admission: {
            reserve: async () => { admissions++; return { allowed:false }; }, settle: async () => {}
        } });
        assert.deepEqual(await f.db.prepare('SELECT * FROM screener_daily_quotes_receipts WHERE id=?').bind(original.id).first(), original);
    } finally { f.db.close(); }
});
test('備援429冷卻不重抓、不reset嘗試；異日invalid保持失敗不發布', async () => {
    for (const status of [429,200]) {
        const f = await fallbackFixture(); try {
            const r=await prepareSelectedBollingerHistory({...f.options,fetchDailyQuotes:async date => status===429
                ? {...f.response(date),status,retryAfter:'7200'} : f.response(date,{...f.payload(date),Date:['2026-01-01','2026-01-01']})});
            assert.equal(r.requested,2); assert.equal(r.processed,0);
            const original=(await f.db.prepare('SELECT * FROM screener_daily_quotes_cache').all()).results;
            const waiting = await prepareSelectedBollingerHistory({...f.options,fetchDailyQuotes:async()=>{throw new Error('must_not_fetch_latest');}});
            if (status === 429) {
                const earliest = await f.db.prepare("SELECT MIN(next_attempt_at) next FROM screener_daily_quotes_cache WHERE status='pending'").first();
                assert.equal(waiting.nextAttemptAt, earliest.next, '背景進度列出所有未完成日期的最早原期限');
            }
            for(const row of original) {
                const saved=await f.db.prepare('SELECT status,attempts,next_attempt_at FROM screener_daily_quotes_cache WHERE cache_key=?').bind(row.cache_key).first();
                assert.equal(saved.attempts,row.attempts); assert.equal(saved.status,row.status); assert.equal(saved.next_attempt_at,row.next_attempt_at);
            }
        } finally { f.db.close(); }
    }
});
test('完整date cache有界續跑全窗口；原來源選擇不再抓、不改manifest', async () => {
    const f = await fallbackFixture(); try {
        const r=await f.seed(); assert.equal(r.state,'complete'); assert.equal(r.requested,0); assert.equal(r.processed,320);
        assert.match(r.mapping.dataMappingVersion,/^bollinger-source-selection-v1:[a-f0-9]{64}$/);
        const before=(await f.db.prepare('SELECT selection_key,manifest FROM screener_source_selections ORDER BY selection_key').all()).results;
        const again=await prepareSelectedBollingerHistory({...f.options,reviewIds:{},fetchDailyQuotes:async()=>{throw new Error('not_called');}});
        assert.equal(again.state,'complete'); assert.equal(again.requested,0);
        assert.deepEqual((await f.db.prepare('SELECT selection_key,manifest FROM screener_source_selections ORDER BY selection_key').all()).results,before);
        const key=await technicalEvidenceHash({policyVersion:'bollinger-source-selection-v1',universeRevision:'fixture-u',market:'TWSE',sessionDate:f.sessions.at(-1)});
        assert.equal((await readSourceSelection(f.db,key)).rows[0].bar.volumeShares,'1000000');
    } finally { f.db.close(); }
});
test('並行run租約只一個owner；預先中止不抓來源且保留run receipt', async () => {
    const f=await fallbackFixture(); try {
        const results=await Promise.all([prepareSelectedBollingerHistory(f.options),prepareSelectedBollingerHistory(f.options)]);
        assert.equal(results.filter(r=>r.reason==='lease_busy').length,1); assert.equal(f.calls(),2);
        const controller=new AbortController();controller.abort();
        const r=await prepareSelectedBollingerHistory({...f.options,signal:controller.signal});assert.equal(r.requested,0);assert.equal(r.reason,'run_deadline');
    } finally { f.db.close(); }
});
test('15分鐘run硬界線／lease失效，不能將中途投影變complete', async()=>{
    const f=await fallbackFixture();try{
        const r=await prepareSelectedBollingerHistory({...f.options,fetchDailyQuotes:async date=>{f.advance(900001);return f.response(date);}});
        assert.equal(r.state,'pending');assert.equal(r.requested,1);assert.equal(r.processed,0);
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_source_selections').first()).n,0);
        await assert.rejects(sourceWindowMapping(f.db,{universeRevision:'fixture-u',universeHash:f.options.universeEvidence.hash,sessions:f.sessions}),/source_selection_pending/);
    }finally{f.db.close();}
});
