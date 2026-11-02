import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KBars } from './types/market';
import type { ContractBase } from './types/contract';
const mocks=vi.hoisted(()=>({apiPost:vi.fn()}));
vi.mock('./api',()=>({apiDelete:vi.fn(),apiGet:vi.fn(),apiPost:mocks.apiPost,apiPostWithTimeout:vi.fn(),apiPut:vi.fn()}));
let fetchKbars:typeof import('./shioaji').fetchKbars;
const contract:ContractBase={security_type:'STK',region:'TW',exchange:'TSE',code:'2330',target_code:null};
const payload=(date:string):KBars=>({datetime:[date+'T09:01:00'],Open:[10],High:[11],Low:[9],Close:[10.5],Volume:[5],Amount:[52500]});
function deferred(){let resolve!:(v:KBars)=>void,reject!:(e:Error)=>void;const promise=new Promise<KBars>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
beforeEach(async()=>{vi.resetModules();mocks.apiPost.mockReset();({fetchKbars}=await import('./shioaji'));});
afterEach(()=>vi.useRealTimers());

describe('KBar近期優先與逾時離線契約（非SDK實測）',()=>{
    it('近期先顯示、再往前補歷史，仍是原分段數且輸出嚴格遞增',async()=>{
        const older=deferred(),seen:KBars[]=[];
        mocks.apiPost.mockResolvedValueOnce(payload('2026-01-31')).mockReturnValueOnce(older.promise);
        const pending=fetchKbars(contract,'2026-01-01','2026-02-15',undefined,{latestFirst:true,onProgress:k=>seen.push(k)});
        await flush();expect(seen.map(k=>k.datetime)).toEqual([['2026-01-31T09:01:00']]);
        expect(mocks.apiPost.mock.calls.map(c=>c[1].start)).toEqual(['2026-01-31','2026-01-01']);
        older.resolve(payload('2026-01-01'));
        expect((await pending).datetime).toEqual(['2026-01-01T09:01:00','2026-01-31T09:01:00']);
        expect(seen).toHaveLength(2);expect(mocks.apiPost).toHaveBeenCalledTimes(2);
    });
    it('後段逾時只拒絕後續，不撤銷已發布近期真實資料，也不重試',async()=>{
        vi.useFakeTimers();const seen=vi.fn();
        mocks.apiPost.mockResolvedValueOnce(payload('2026-01-31')).mockImplementationOnce(()=>new Promise(()=>{}));
        const pending=fetchKbars(contract,'2026-01-01','2026-02-15',undefined,{latestFirst:true,onProgress:seen});
        const rejected=expect(pending).rejects.toMatchObject({name:'TimeoutError'});
        await flush();await vi.advanceTimersByTimeAsync(20_000);await rejected;
        expect(seen).toHaveBeenCalledTimes(1);expect(mocks.apiPost).toHaveBeenCalledTimes(2);
        expect(mocks.apiPost.mock.calls[1]![2].signal.aborted).toBe(true);
        mocks.apiPost.mockImplementation(async(_p,b)=>payload(b.start));
        expect((await fetchKbars(contract,'2026-01-01','2026-02-15',undefined,{latestFirst:true})).datetime).toHaveLength(2);
        expect(mocks.apiPost).toHaveBeenCalledTimes(4);
    });
    it('共用近期鏈的晚加入consumer立即收到快照，取消者不再收到進度',async()=>{
        const older=deferred(),aSeen=vi.fn(),bSeen=vi.fn(),c=new AbortController();
        mocks.apiPost.mockResolvedValueOnce(payload('2026-01-31')).mockReturnValueOnce(older.promise);
        const a=fetchKbars(contract,'2026-01-01','2026-02-15',c.signal,{latestFirst:true,onProgress:aSeen});
        await flush();
        const b=fetchKbars(contract,'2026-01-01','2026-02-15',undefined,{latestFirst:true,onProgress:bSeen});
        expect(bSeen).toHaveBeenCalledTimes(1);c.abort();await expect(a).rejects.toMatchObject({name:'AbortError'});
        older.resolve(payload('2026-01-01'));await b;
        expect(aSeen).toHaveBeenCalledTimes(1);expect(bSeen).toHaveBeenCalledTimes(2);expect(mocks.apiPost).toHaveBeenCalledTimes(2);
    });
    it('近期鏈遇到跨段衝突，不發布衝突內容或發第三次請求',async()=>{
        const seen=vi.fn();mocks.apiPost.mockResolvedValue(payload('2026-01-31'));
        await expect(fetchKbars({...contract,security_type:'FUT'},'2026-01-01','2026-03-02',undefined,{latestFirst:true,onProgress:seen})).rejects.toThrow('cross_chunk_time_conflict');
        expect(seen).toHaveBeenCalledTimes(1);expect(mocks.apiPost).toHaveBeenCalledTimes(2);
    });
});
