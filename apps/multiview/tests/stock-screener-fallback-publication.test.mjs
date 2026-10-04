import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackFixture } from './helpers/bollinger-fallback.mjs';
import { publishBollingerDaily } from '../worker/stock-screener-v8-publisher.ts';
import { readBollingerPublication, saveBollingerDailyProfile, readBollingerSourceConflicts, readBollingerSourceVolumeTolerances } from '../worker/stock-screener-v8-repository.ts';
import { handleStockScreenerV8 } from '../worker/stock-screener-v8-route.ts';
import { decodeBollingerResponse } from '../../../src/lib/stock-screener-bollinger-api.ts';
import { queryBollingerSnapshot } from '../../../src/lib/stock-screener-bollinger-query.ts';
import { compareRestoredOfficialSource } from '../../../scripts/stock-screener-source-selection.mjs';
import { prepareBollingerHistory } from '../../../scripts/stock-screener-bollinger-prepare.ts';
import { updateBollingerScheduled } from '../../../scripts/stock-screener-bollinger-schedule.ts';
import { technicalEvidenceHash } from '../../../src/lib/stock-screener-technical-patterns.ts';
import { planBollingerHistory } from '../../../src/lib/stock-screener-bollinger-history.ts';
import { prepareSelectedBollingerHistory } from '../../../scripts/stock-screener-provider-prepare.mjs';
import { BOLLINGER_SOURCE_COMPARISON_POLICY, BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY } from '../../../src/lib/stock-screener-source-comparison.ts';
import { installNoticeFixture } from './helpers/calendar-notices.mjs';

const publication = f => ({...f.options,reviews:{},useSourceSelections:true});
const request = f => new Request(`http://127.0.0.1:5174/api/stock-screener?${new URLSearchParams({version:'8',criteria:JSON.stringify(f.criteria),resultState:'all'})}`);
test('320市場日比較查詢遵守D1每句100個SQL參數；空比較集合分批讀取仍唯讀', async()=>{
    const f=await fallbackFixture();try{
        await f.seed();await publishBollingerDaily(publication(f));const snapshot=await readBollingerPublication(f.db);
        const sizes=[],before=await f.db.prepare('SELECT total_changes() n').first();
        const guarded={prepare(sql){const s=f.db.prepare(sql),bind=s.bind.bind(s);s.bind=(...args)=>{
            assert(args.length<=100,'too_many_sql_variables');if(sql.includes('FROM screener_source_comparisons'))sizes.push(args.length);
            return bind(...args);};return s;}};
        assert.deepEqual(await readBollingerSourceConflicts(guarded,snapshot.metadata.sourceEvidence),[]);
        assert.deepEqual(await readBollingerSourceVolumeTolerances(guarded,snapshot.metadata.sourceEvidence),[]);
        assert.equal(sizes.length,8);assert(sizes.every(n=>n<=81));
        assert.deepEqual(await f.db.prepare('SELECT total_changes() n').first(),before);
    }finally{f.db.close();}
});
test('mixed-provider mapping 的 fallback 全窗口發布、source/hash/守恆及API decoder；同鍵不改head/receipt', async()=>{
    const f=await fallbackFixture();try{
        await f.addOfficial('TWSE');
        await prepareSelectedBollingerHistory({ ...f.options, fetchOfficial: async t => f.officialResponse(t) });
        // 原已凍結官方日期保留；後續日期模擬官方 review 尚待確認，獨立備援完成其餘窗口。
        delete f.options.reviewIds['official-twse'];
        const prepared = await f.seed(); assert.equal(prepared.state,'complete',prepared.reason);
        const r=await publishBollingerDaily(publication(f));assert.equal(r.state,'published',JSON.stringify(r));
        const snapshot=await readBollingerPublication(f.db);
        assert.match(snapshot.metadata.sourceMappingVersion,/^bollinger-source-selection-v1:[a-f0-9]{64}$/);
        assert.equal(snapshot.metadata.sourceEvidence.selections.length,320);assert.equal(snapshot.metadata.counts.total.total,2);
        assert(snapshot.metadata.sourceEvidence.selections.some(s=>s.provider==='official-twse'));
        assert(snapshot.metadata.sourceEvidence.selections.some(s=>s.provider==='shioaji-daily-quotes'));
        assert(snapshot.rows.every(row=>row.features.sourceMappingVersion===snapshot.metadata.sourceMappingVersion && row.dailyOutcome.sourceMappingVersion===snapshot.metadata.sourceMappingVersion));
        let sourceCalls=0;const before=(await f.db.prepare('SELECT COUNT(*) n FROM screener_bollinger_receipts').first()).n;
        const second=await publishBollingerDaily({...publication(f),reviews:{},fetchReport:()=>{sourceCalls++;}});
        assert.equal(second.state,'unchanged');assert.equal(sourceCalls,0);
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_bollinger_receipts').first()).n,before);
        const response=await handleStockScreenerV8(request(f),{DB:f.db},f.now());assert.equal(response.status,200);
        const body=decodeBollingerResponse(await response.json());assert.equal(body.state,'ready');assert.equal(body.rows.length,2);
        assert(body.rows.every(row=>row.outcome.sourceMappingVersion===snapshot.metadata.sourceMappingVersion));
        assert.equal(body.sourceEvidence.selections.at(-1).provider,'shioaji-daily-quotes');
        assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM screener_bollinger_receipts').first()).n,before);
    }finally{f.db.close();}
});
test('manifest/hash/feature mapping tampering 不容用新 mapping 重解釋舊快照',async()=>{
    const f=await fallbackFixture();try{
        await f.seed();await publishBollingerDaily(publication(f));const snapshot=await readBollingerPublication(f.db);
        for(const patch of [m=>{m.sourceEvidence.manifest.entries[0].manifestHash='f'.repeat(64);},m=>{m.sourceMappingVersion='official-daily-ohlcv-turnover-v1';},
            m=>{m.sourceEvidence.selections[0].provider='official-twse';}]){
            const m=structuredClone(snapshot.metadata);patch(m);
            await f.db.prepare('UPDATE screener_bollinger_publications SET metadata=? WHERE id=?').bind(JSON.stringify(m),snapshot.id).run();
            await assert.rejects(readBollingerPublication(f.db),/invalid_v8_/);
        }
    }finally{f.db.close();}
});
test('新來源 mapping 的 cursor 綁定 immutable feature hash，跨 mapping 或 daily profile 不混用',async()=>{
    const f=await fallbackFixture();try{
        await f.seed();await publishBollingerDaily(publication(f));const snapshot=await readBollingerPublication(f.db);
        const q={criteria:f.criteria.bollSqueezeStages,sort:{key:'code',direction:'asc'},state:'all',limit:1};
        const first=await queryBollingerSnapshot(snapshot,q);assert(first.nextCursor);
        const altered=structuredClone(snapshot);altered.rows[0].features.sourceMappingVersion='official-daily-ohlcv-turnover-v1';
        const {evidenceHash,...content}=altered.rows[0].features;altered.rows[0].features.evidenceHash=await technicalEvidenceHash(content);
        await assert.rejects(queryBollingerSnapshot(altered,{...q,cursor:first.nextCursor}),/invalid_bollinger_cursor/);
        const c=structuredClone(f.criteria);c.bollSqueezeStages.preparingThreshold=.9;
        await saveBollingerDailyProfile(f.db,{expectedRevision:1,enabled:true,criteria:c},f.now());
        const next=await publishBollingerDaily(publication(f));assert.notEqual(next.snapshotId,snapshot.id);
        assert.equal((await readBollingerPublication(f.db,snapshot.id)).metadata.profileRevision,1);
    }finally{f.db.close();}
});
test('已知官方恢復衝突在唯讀 API 揭露；frozen rows/head 不改，decoder 拒絕偽來源',async()=>{
    const f=await fallbackFixture();try{
        await f.seed();await publishBollingerDaily(publication(f));const old=await readBollingerPublication(f.db);
        const source=await f.addOfficial('TWSE');let candidate;
        const plan=planBollingerHistory(f.options.calendar,f.options.through,f.options.criteria,'1',f.now());
        const prep=await prepareBollingerHistory({...f.options,reviews:{TWSE:source.review},targetKeys:[plan.targets.find(t=>t.market==='TWSE'&&t.sessionDate===f.options.through).key],
            fetchReport:async t=>{candidate=f.officialResponse(t);const p=JSON.parse(candidate.text);p.tables[0].data[0][2]='121000000';candidate.text=JSON.stringify(p);return candidate;}});
        // target key 由原計畫取得，不以顯示 label 當 source identity。
        assert.equal(prep.state,'complete');
        const receipt=await f.db.prepare("SELECT id FROM screener_bollinger_receipts WHERE status='complete' AND target_key IS NOT NULL ORDER BY created_at DESC,id LIMIT 1").first();
        const key=await technicalEvidenceHash({policyVersion:'bollinger-source-selection-v1',universeRevision:'fixture-u',market:'TWSE',sessionDate:f.options.through});
        const conflict=await compareRestoredOfficialSource({db:f.db,selectionKey:key,provider:'official-twse',market:'TWSE',sessionDate:f.options.through,
            reviewId:source.id,response:candidate,fetchReceiptId:receipt.id,universe:f.options.universe,now:f.now});assert.equal(conflict.status,'conflict');
        const response=decodeBollingerResponse(await (await handleStockScreenerV8(request(f),{DB:f.db},f.now())).json());
        assert.equal(response.sourceConflicts.length,1);assert.equal(response.sourceConflicts[0].market,'TWSE');
        assert.deepEqual((await readBollingerPublication(f.db)).metadata,old.metadata);
        const tampered=structuredClone(response);tampered.sourceEvidence.selections[0].actualDate='2025-12-31';
        assert.throws(()=>decodeBollingerResponse(tampered),/invalid_v8_response/);
        const wrongConflict=structuredClone(response);wrongConflict.sourceConflicts[0].sessionDate='2025-12-31';
        assert.throws(()=>decodeBollingerResponse(wrongConflict),/invalid_v8_response/);
    }finally{f.db.close();}
});
test('容差內通過由唯讀API揭露原股數／政策；越界或冒改政策被decoder拒絕，快照不改',async()=>{
    const f=await fallbackFixture();try{
        await f.seed();await publishBollingerDaily(publication(f));const old=await readBollingerPublication(f.db);
        const source=await f.addOfficial('TWSE');let candidate;
        const plan=planBollingerHistory(f.options.calendar,f.options.through,f.options.criteria,'1',f.now());
        const prep=await prepareBollingerHistory({...f.options,reviews:{TWSE:source.review},targetKeys:[plan.targets.find(t=>t.market==='TWSE'&&t.sessionDate===f.options.through).key],
            fetchReport:async t=>{candidate=f.officialResponse(t);const p=JSON.parse(candidate.text);p.tables[0].data[0][1]='1000001';candidate.text=JSON.stringify(p);return candidate;}});
        assert.equal(prep.state,'complete');
        const receipt=await f.db.prepare("SELECT id FROM screener_bollinger_receipts WHERE status='complete' AND target_key IS NOT NULL ORDER BY created_at DESC,id LIMIT 1").first();
        const key=await technicalEvidenceHash({policyVersion:'bollinger-source-selection-v1',universeRevision:'fixture-u',market:'TWSE',sessionDate:f.options.through});
        const compared=await compareRestoredOfficialSource({db:f.db,selectionKey:key,provider:'official-twse',market:'TWSE',sessionDate:f.options.through,
            reviewId:source.id,response:candidate,fetchReceiptId:receipt.id,universe:f.options.universe,now:f.now});
        assert.equal(compared.status,'matched');assert.equal(compared.differences[0].verdict,'within_volume_tolerance');
        const body=decodeBollingerResponse(await (await handleStockScreenerV8(request(f),{DB:f.db},f.now())).json());
        assert.equal(body.sourceConflicts.length,0);assert.equal(body.sourceVolumeTolerances.length,1);
        const evidence=body.sourceVolumeTolerances[0];assert.equal(evidence.comparisonPolicyVersion,BOLLINGER_SOURCE_COMPARISON_POLICY.version);
        assert.equal(evidence.toleratedSymbols,1);assert.equal(evidence.samples[0].volumeDifferences[0].frozenShares,'1000000');
        assert.equal(evidence.samples[0].volumeDifferences[0].officialShares,'1000001');
        for(const mutate of [r=>{r.sourceVolumeTolerances[0].volumeTolerancePercent=2;},
            r=>{r.sourceVolumeTolerances[0].comparisonPolicyVersion='unknown';},
            r=>{r.sourceVolumeTolerances[0].samples[0].volumeDifferences[0].frozenShares='2000000';},
            r=>{r.sourceVolumeTolerances[0].samples[0].volumeDifferences[0].absoluteDifferenceShares='0';},
            r=>{r.sourceVolumeTolerances[0].sessionDate='2025-12-31';}]){
            const bad=structuredClone(body);mutate(bad);assert.throws(()=>decodeBollingerResponse(bad),/invalid_v8_response/);
        }
        assert.deepEqual(await readBollingerPublication(f.db),old);
        const repeated=await publishBollingerDaily(publication(f));assert.equal(repeated.state,'unchanged');
        assert.equal(repeated.snapshotId,old.id);
    }finally{f.db.close();}
});
test('新金額政策由真實repository路徑追加揭露，舊conflict並存；snapshot／head不變',async()=>{
    const f=await fallbackFixture();try {
        await f.seed();await publishBollingerDaily(publication(f));const old=await readBollingerPublication(f.db);
        const source=await f.addOfficial('TWSE');let candidate;
        const plan=planBollingerHistory(f.options.calendar,f.options.through,f.options.criteria,'1',f.now());
        const prep=await prepareBollingerHistory({...f.options,reviews:{TWSE:source.review},
            targetKeys:[plan.targets.find(t=>t.market==='TWSE'&&t.sessionDate===f.options.through).key],
            fetchReport:async t=>{candidate=f.officialResponse(t);const p=JSON.parse(candidate.text);
                p.tables[0].data[0][2]=(BigInt(p.tables[0].data[0][2])+1n).toString();candidate.text=JSON.stringify(p);return candidate;}});
        assert.equal(prep.state,'complete');
        const receipt=await f.db.prepare("SELECT id FROM screener_bollinger_receipts WHERE status='complete' AND target_key IS NOT NULL ORDER BY created_at DESC,id LIMIT 1").first();
        const selectionKey=await technicalEvidenceHash({policyVersion:'bollinger-source-selection-v1',universeRevision:'fixture-u',market:'TWSE',sessionDate:f.options.through});
        const options={db:f.db,selectionKey,provider:'official-twse',market:'TWSE',sessionDate:f.options.through,
            reviewId:source.id,response:candidate,fetchReceiptId:receipt.id,universe:f.options.universe,now:f.now};
        const strict=await compareRestoredOfficialSource(options);assert.equal(strict.status,'conflict');
        const next=await compareRestoredOfficialSource({...options,comparisonPolicy:BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY});
        assert.equal(next.status,'matched');
        const body=decodeBollingerResponse(await (await handleStockScreenerV8(request(f),{DB:f.db},f.now())).json());
        assert.equal(body.sourceConflicts.length,1);assert.equal(body.sourceVolumeTolerances.length,1);
        const evidence=body.sourceVolumeTolerances[0];assert.equal(evidence.turnoverToleranceNtd,1);
        assert.equal(evidence.comparisonPolicyVersion,BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY.version);
        assert.equal(evidence.samples[0].turnoverDifferences[0].absoluteDifferenceNtd,'1');
        assert.deepEqual(await readBollingerPublication(f.db),old);
    }finally{f.db.close();}
});
test('已發布來源policy的 watcher fast path不下載、不寫入、不被legacy成功鍵擋住',async()=>{
    const f=await fallbackFixture();try{
        await installNoticeFixture(f.db,f.options.calendar,f.now);
        await f.seed();const p=await publishBollingerDaily(publication(f));
        for(const stock of f.options.universe) await f.db.prepare('INSERT INTO screener_universe(revision,symbol,market,data_date,payload) VALUES(?,?,?,?,?)')
            .bind('fixture-u',stock.symbol,stock.market,f.options.through,JSON.stringify({stock:{...stock,kind:'ordinary',classificationVersion:'fixture-verified'},
                review:'verified',revision:'fixture-u',sourceDate:f.options.through,
                provenance:{source:stock.market,payloadHash:'a'.repeat(64)}})).run();
        const calendar={version:1,sessions:[...f.sessions,'2026-10-05'],validThrough:f.options.calendar.validThrough,sourceHashes:['b'.repeat(64),'c'.repeat(64)]};
        await f.db.prepare('INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,?,?,?,?)')
            .bind('screener-bollinger-source-policy','fixture-policy','verified',JSON.stringify({policyVersion:'bollinger-source-selection-v1'}),f.now().toISOString()).run();
        await f.db.prepare('INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,?,?,?,?)')
            .bind('screener-bollinger-calendar','fixture-calendar','verified',JSON.stringify(calendar),f.now().toISOString()).run();
        let sourceCalls=0;const r=await updateBollingerScheduled(f.db,{now:f.now,fetchCalendar:async()=>{sourceCalls++;throw new Error('unexpected');},fetchReport:async()=>{sourceCalls++;throw new Error('unexpected');}});
        assert.equal(r.reason,'session_complete_sleeping');assert.equal(r.snapshotId,p.snapshotId);assert.equal(sourceCalls,0);
    }finally{f.db.close();}
});
