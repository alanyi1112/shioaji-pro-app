import {afterEach, expect, it, vi} from 'vitest';
import {kbarRequestBase} from './kbar-request-base';
const runtime=vi.hoisted(()=>({apiBase:'',packaged:false}));
const boundary=vi.hoisted(()=>vi.fn());
vi.mock('./runtime',()=>({getApiBase:()=>runtime.apiBase,get isTauri(){return runtime.packaged;}}));
vi.mock('./runtime-mode',()=>({assertRuntimeAllowsRequest:boundary}));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();runtime.apiBase='';runtime.packaged=false;boundary.mockReset();});
it('本機開發的 K 線使用等價 hostname，port 保持，兩種 hostname 均可使用',()=>{
    expect(kbarRequestBase('','http://127.0.0.1:5173',true,false)).toBe('http://localhost:5173');
    expect(kbarRequestBase('','http://localhost:5173',true,false)).toBe('http://127.0.0.1:5173');
});
it.each([
    ['http://127.0.0.1:8080','http://127.0.0.1:5173',true,false],
    ['','http://127.0.0.1:5173',false,false],
    ['','http://127.0.0.1:5173',true,true],
    ['','http://example.test:5173',true,false],
    ['','https://127.0.0.1:5173',true,false],
    ['','',true,false],
] as const)('明確 API、正式、packaged 或其他來源不改目的地 %s %s %s %s',(base,origin,dev,packaged)=>{
    expect(kbarRequestBase(base,origin,dev,packaged)).toBe(base);
});
it('只有 K 線 POST 分流；保留 body／取消訊號與原請求邊界',async()=>{
    vi.stubGlobal('location',new URL('http://127.0.0.1:5173/'));
    const fetch=vi.fn(async(_input:RequestInfo | URL,_init?:RequestInit)=>new Response(JSON.stringify({ok:true})));
    vi.stubGlobal('fetch',fetch);
    const {apiPost,apiGet}=await import('./api');const controller=new AbortController(),body={contract:{code:'00406A'}};
    await expect(apiPost('/api/v1/data/kbars',body,{signal:controller.signal})).resolves.toEqual({ok:true});
    expect(fetch).toHaveBeenNthCalledWith(1,'http://localhost:5173/api/v1/data/kbars',expect.objectContaining({method:'POST',body:JSON.stringify(body),signal:controller.signal}));
    await apiPost('/api/v1/data/snapshots',{});await apiGet('/api/v1/health');
    expect(fetch.mock.calls[1]![0]).toBe('/api/v1/data/snapshots');expect(fetch.mock.calls[2]![0]).toBe('/api/v1/health');
    expect(boundary).toHaveBeenCalledWith('/api/v1/data/kbars','POST');
});
it('K 線失敗仍拒絕原錯誤，不因分流自動重送',async()=>{
    vi.stubGlobal('location',new URL('http://127.0.0.1:5173/'));
    const fetch=vi.fn(async(_input:RequestInfo | URL,_init?:RequestInit)=>new Response(JSON.stringify({message:'fixture-source-unavailable'}),{status:503}));vi.stubGlobal('fetch',fetch);
    const {apiPost}=await import('./api');await expect(apiPost('/api/v1/data/kbars',{})).rejects.toThrow('503 fixture-source-unavailable');expect(fetch).toHaveBeenCalledTimes(1);
});
