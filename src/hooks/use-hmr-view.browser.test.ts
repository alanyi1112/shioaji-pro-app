import { act, createElement, useEffect, useRef, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { captureHmrView, createHmrViewStore, type HmrViewStore } from '../lib/hmr-view-state';
import type { Workspace } from '../lib/workspace';
import type { ContractInfo } from '../lib/types/contract';
const mocks=vi.hoisted(()=>({resolve:vi.fn(),prime:vi.fn(),ensure:vi.fn()}));
const {useHmrTradingView,useHmrChartPeriod}=await import('./use-hmr-view');
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const c=(code='6187',exchange='OTC')=>({code,exchange,region:'TW',security_type:'STK',target_code:null,name:code,reference:1410} as ContractInfo);
const ws:Workspace={blocks:[{id:'chart-1',type:'chart',pin:null},{id:'chart-2',type:'chart',pin:null}],layout:[{i:'chart-1',x:0,y:0,w:10,h:10},{i:'chart-2',x:10,y:0,w:10,h:10}]};
let latest:ReturnType<typeof useHmrTradingView>, period:readonly[number,React.Dispatch<React.SetStateAction<number>>];
function Harness({store,metadataOnly=false,activeListId}:{store:HmrViewStore|null;metadataOnly?:boolean;activeListId?:string}){
 const state=useHmrTradingView(()=>structuredClone(ws),{activeListId,resolve:i=>mocks.resolve(i.code,i.security_type),activate:c=>{mocks.prime(c);return mocks.ensure(c.code);}},store);latest=state;
 const previous=useRef(state.selected?.code);
 useEffect(()=>{if(previous.current!==state.selected?.code&&state.restoreStatus!=='restored')state.setChartSelections({});
 previous.current=state.selected?.code;},[state.selected?.code,state.restoreStatus,state.setChartSelections]);
 useEffect(()=>{if(!metadataOnly&&!state.selected&&state.restoreStatus==='none'&&state.allowInitialFallback)state.setSelected(c('6770','TSE'));},[state.selected,state.restoreStatus,metadataOnly,state.setSelected,state.allowInitialFallback]);
 return createElement('output',{'data-testid':'state','data-code':state.selected?.code??'','data-status':state.restoreStatus,'data-chart':state.chartSelections['chart-2']?.contract.code??'','data-blocks':state.workspace.blocks.length},state.restoreError??'');
}
function Period({store,generation=8,initialDaily=true}:{store:HmrViewStore;generation?:number;initialDaily?:boolean}){
 period=useHmrChartPeriod('chart-2',initialDaily,generation,store);
 return createElement('output',{'data-testid':'period'},period[0]);
}
const pending=<T,>()=>{let resolve!:(v:T)=>void;let reject!:(v:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
let root:Root|null=null,host:HTMLDivElement;
async function render(node:React.ReactNode){host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>{root!.render(node);});}
async function unmount(){await act(async()=>root?.unmount());root=null;}
function seeded(){const store=createHmrViewStore({scope:'main'});store.commit(captureHmrView(ws,c(),{'chart-2':{contract:c('2330','TSE'),generation:8}},new Set(['chart-2']),{'chart-2':{index:2,dailyGeneration:8}}));return store;}
beforeEach(()=>{vi.clearAllMocks();mocks.resolve.mockImplementation(async(code:string)=>code==='2330'?c(code,'TSE'):c(code));mocks.ensure.mockResolvedValue(c());});
afterEach(async()=>{await unmount();document.body.replaceChildren();});
it('先重現無交接remount的首檔6770行為，再驗候選不選首檔',async()=>{
 await render(createElement(Harness,{store:null}));expect(latest.selected?.code).toBe('6770');await act(async()=>latest.setSelected(c()));await unmount();
 await render(createElement(Harness,{store:seeded()}));await vi.waitFor(()=>expect(latest.restoreStatus).toBe('restored'));
 expect(latest.selected?.code).toBe('6187');expect(latest.chartSelections['chart-2']?.contract.code).toBe('2330');
 expect(mocks.ensure.mock.calls.map(x=>x[0])).toEqual(['6187','2330']);
});
it('主頁延遲解析期間絕不發出6770需求',async()=>{
 const deferred=pending<ContractInfo>();mocks.resolve.mockImplementation((code:string)=>code==='6187'?deferred.promise:Promise.resolve(c('2330','TSE')));
 await render(createElement(Harness,{store:seeded()}));expect(latest.selected).toBeNull();expect(latest.restoreStatus).toBe('pending');expect(mocks.ensure).not.toHaveBeenCalled();
 await act(async()=>deferred.resolve(c()));await vi.waitFor(()=>expect(latest.selected?.code).toBe('6187'));expect(mocks.resolve.mock.calls.map(x=>x[0])).not.toContain('6770');
});
it('metadata-only監控頁remount恢復原商品，不需清單預設',async()=>{
 const s=seeded();await render(createElement(Harness,{store:s,metadataOnly:true}));await vi.waitFor(()=>expect(latest.restoreStatus).toBe('restored'));await unmount();
 await render(createElement(Harness,{store:s,metadataOnly:true}));await vi.waitFor(()=>expect(latest.selected?.code).toBe('6187'));expect(latest.chartSelections['chart-2']?.generation).toBe(8);
});
it('完整reload交接消費一次且不會共享到另一scope',async()=>{
 const map=new Map<string,string>(),storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};
 const s=createHmrViewStore({scope:'main',storage,now:()=>100,previous:seeded().read()});s.beforeFullReload();
 const next=createHmrViewStore({scope:'main',storage,reload:true,now:()=>200});
 await render(createElement(Harness,{store:next}));await vi.waitFor(()=>expect(latest.selected?.code).toBe('6187'));
 expect(createHmrViewStore({scope:'monitor',storage,reload:true,now:()=>200}).read()).toBeNull();expect(map.size).toBe(0);
});
it.each(['error','market'])('復原%s不得新增任何訂閱或改選首檔',async(kind)=>{
 mocks.resolve.mockImplementation(async()=>{if(kind==='error')throw Error('source unavailable');return c('6187','TSE');});
 await render(createElement(Harness,{store:seeded()}));await vi.waitFor(()=>expect(latest.restoreStatus).toBe('failed'));
 expect(latest.selected).toBeNull();expect(mocks.ensure).not.toHaveBeenCalled();expect(mocks.prime).not.toHaveBeenCalled();
});
it('新選取取消原復原，晚回應不得覆寫或activate',async()=>{
 const deferred=pending<ContractInfo>();mocks.resolve.mockReturnValue(deferred.promise);await render(createElement(Harness,{store:seeded()}));
 await act(async()=>latest.setSelected(c('2409','TSE')));await act(async()=>deferred.resolve(c()));
 expect(latest.selected?.code).toBe('2409');expect(mocks.ensure).not.toHaveBeenCalled();
});
it('卸載取消晚回應',async()=>{
 const deferred=pending<ContractInfo>();mocks.resolve.mockReturnValue(deferred.promise);await render(createElement(Harness,{store:seeded()}));await unmount();await act(async()=>deferred.resolve(c()));expect(mocks.ensure).not.toHaveBeenCalled();
});
it('原本僅逐圖6187、全域空值，復原不得改全域交易商品或多訂閱',async()=>{
 const s=seeded();s.commit(captureHmrView(ws,null,{'chart-2':{contract:c(),generation:3}},new Set(['chart-2']),{}));
 await render(createElement(Harness,{store:s,metadataOnly:true}));await vi.waitFor(()=>expect(latest.restoreStatus).toBe('restored'));
 expect(latest.selected).toBeNull();expect(latest.chartSelections['chart-2']?.contract.code).toBe('6187');expect(mocks.ensure.mock.calls.map(c=>c[0])).toEqual(['6187']);
});
it('新逐圖意圖取消復原後仍不可短暫選清單首檔6770',async()=>{
 const deferred=pending<ContractInfo>();mocks.resolve.mockReturnValue(deferred.promise);await render(createElement(Harness,{store:seeded()}));
 await act(async()=>latest.setChartSelections({'chart-2':{contract:c('2409','TSE'),generation:9}}));await act(async()=>deferred.resolve(c()));
 expect(latest.selected).toBeNull();expect(latest.chartSelections['chart-2']?.contract.code).toBe('2409');expect(mocks.ensure).not.toHaveBeenCalled();
});
it('純layout resize不取消復原，移除/換pin會取消',async()=>{
 const deferred=pending<ContractInfo>();mocks.resolve.mockReturnValue(deferred.promise);await render(createElement(Harness,{store:seeded(),metadataOnly:true}));
 await act(async()=>latest.setWorkspace(old=>({...old,layout:old.layout.map(l=>({...l,h:20}))})));expect(latest.restoreStatus).toBe('pending');
 await act(async()=>latest.setWorkspace(old=>({...old,blocks:old.blocks.slice(0,1),layout:old.layout.slice(0,1)})));await act(async()=>deferred.resolve(c()));expect(mocks.ensure).not.toHaveBeenCalled();
});
it('StrictMode不重複activate原集合',async()=>{
 await render(createElement(StrictMode,null,createElement(Harness,{store:seeded()})));
 await vi.waitFor(()=>expect(latest.restoreStatus).toBe('restored'));expect(mocks.ensure.mock.calls.map(x=>x[0])).toEqual(['6187','2330']);
});
it.each([0,1,2,3,4])('保留原週期index%s及舊daily generation，不被重設',async(index)=>{
 const s=seeded();s.setPeriod('chart-2',{index,dailyGeneration:8});
 await render(createElement(Period,{store:s}));expect(period[0]).toBe(index);
 await act(async()=>root!.render(createElement(Period,{store:s,generation:9})));expect(period[0]).toBe(4);
});
it('原周期改選後remount仍保留，原其他圖週期不變',async()=>{
 const s=seeded();s.setPeriod('chart-1',{index:3});
 await render(createElement(Period,{store:s}));await act(async()=>period[1](0));await unmount();await render(createElement(Period,{store:s}));expect(period[0]).toBe(0);expect(s.period('chart-1')?.index).toBe(3);
});
it('已在1D時新daily generation仍寫入checkpoint，沒有setState重繪也正確',async()=>{
 const s=seeded();s.setPeriod('chart-2',{index:4,dailyGeneration:8});await render(createElement(Period,{store:s}));
 await act(async()=>root!.render(createElement(Period,{store:s,generation:9})));expect(s.period('chart-2')).toEqual({index:4,dailyGeneration:9});
});

it('交接保留目前分頁清單，metadata恢復時的空清單不覆蓋保存值',async()=>{
 const s=seeded();await render(createElement(Harness,{store:s,activeListId:'list-A'}));
 await vi.waitFor(()=>expect(latest.restoreStatus).toBe('restored'));expect(s.read()?.activeListId).toBe('list-A');
 await act(async()=>root!.render(createElement(Harness,{store:s,activeListId:''})));expect(s.read()?.activeListId).toBe('list-A');
 await act(async()=>root!.render(createElement(Harness,{store:s,activeListId:'list-B'})));expect(s.read()?.activeListId).toBe('list-B');
});
