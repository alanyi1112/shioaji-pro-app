import { describe, expect, it, vi } from 'vitest';
import { createHmrViewStore, captureHmrView, resolveHmrView, hmrIdentity, HMR_TTL_MS } from './hmr-view-state';
import type { ContractInfo } from './types/contract';
import type { Workspace } from './workspace';
import { attachHmrViewStore, type HmrHotPort } from './hmr-view-state';
import { createScreenerChartSelection } from './screener-chart-selection';
const c = (code='6187', exchange='OTC') => ({code,exchange,region:'TW',security_type:'STK',target_code:null,name:code,reference:99,update_date:'2026-10-16'} as ContractInfo);
const workspace: Workspace = {blocks:[{id:'chart-1',type:'chart',pin:null},{id:'chart-2',type:'chart',pin:null}],
layout:[{i:'chart-1',x:0,y:0,w:10,h:10},{i:'chart-2',x:10,y:0,w:10,h:10}]};
const make = () => captureHmrView(workspace,c(),{'chart-2':{contract:c('2330','TSE'),generation:8,snapshot:{close:123} as never}},new Set(['chart-2']),{'chart-1':{index:2},'chart-2':{index:3,dailyGeneration:8}});
const storage=()=>{const data=new Map<string,string>();return{data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>{data.delete(k);}};};
describe('HMR UI交接不回放行情/帳務',()=>{
it('Vite adapter僅full reload寫storage，dispose只交hot.data且清除listener',()=>{
 const st=storage(),listeners=new Set<()=>void>();let dispose!:(data:Record<string,unknown>)=>void;
 const data:Record<string,unknown>={};const hot:HmrHotPort={data,on:(_e,fn)=>{listeners.add(fn);},off:(_e,fn)=>{listeners.delete(fn);},dispose:fn=>{dispose=fn;}};
 const a=attachHmrViewStore(hot,{scope:'main',storage:st,now:()=>100});a.commit(make());expect(st.data.size).toBe(0);
 for(const fn of listeners)fn();expect(st.data.size).toBe(1);dispose(data);expect(listeners.size).toBe(0);
 const b=attachHmrViewStore(hot,{scope:'main',storage:st,now:()=>200});expect(b.read()).toEqual(make());expect(st.data.size).toBe(0);
});
it('新日K generation從原最大值後遞增，不誤用已套用的8',async()=>{
 const commit=vi.fn(),contract=c('2330','TSE');
 const picker=createScreenerChartSelection(()=>[{id:'chart-2',type:'chart',pin:null}],async()=>contract,async()=>undefined,commit,8);
 await picker.pick({code:'2330',symbol:'2330.TW',name:'fixture',kind:'ordinary',market:'TWSE'},'chart-2');
 expect(commit.mock.calls[0]?.[1]?.generation).toBe(9);
});
it('只保存canonical identity及原workspace/週期，不儲存Snapshot或reference',()=>{
 const st=storage(),s=createHmrViewStore({scope:'main',storage:st,now:()=>10});expect(s.commit(make())).toBe(true);s.beforeFullReload();
 const raw=[...st.data.values()][0]!;expect(raw).not.toContain('reference');expect(raw).not.toContain('snapshot');expect(raw).not.toContain('close');
 expect(s.read()?.selected).toEqual(hmrIdentity(c()));expect(s.period('chart-1')?.index).toBe(2);
});
it('額外Snapshot/account欄白名單剔除，毀損commit不得回放前個workspace',()=>{
 const v=make();Object.assign(v.workspace.blocks[0]!,{account:'NOT_A_REAL_ACCOUNT',snapshot:{close:999}});
 Object.assign(v.selected!,{reference:999});Object.assign(v.workspace.layout[0]!,{token:'NOT_A_REAL_TOKEN'});
 const s=createHmrViewStore({scope:'main'});s.commit(v);
 expect(JSON.stringify(s.read())).not.toMatch(/NOT_A_REAL|reference|snapshot/);
 v.periods['chart-1']!.index=9;expect(s.commit(v)).toBe(false);expect(s.read()).toBeNull();
});
it('full reload僅同scope且60秒內可消費一次',()=>{
 const st=storage(),s=createHmrViewStore({scope:'main',storage:st,now:()=>100});s.commit(make());s.beforeFullReload();
 const next=createHmrViewStore({scope:'main',storage:st,reload:true,now:()=>100+HMR_TTL_MS});expect(next.read()).toEqual(make());
 expect(createHmrViewStore({scope:'main',storage:st,reload:true,now:()=>100}).read()).toBeNull();
});
it.each([false,true])('普通cold start/過期不復原：reload=%s',reload=>{
 const st=storage(),s=createHmrViewStore({scope:'main',storage:st,now:()=>100});s.commit(make());s.beforeFullReload();
 expect(createHmrViewStore({scope:'main',storage:st,reload,now:()=>100+HMR_TTL_MS+1}).read()).toBeNull();
});
it('跨layout、新分頁navigate、未來timestamp與毀損拒絕',()=>{
 for(const kind of ['scope','navigate','future','corrupt']) {
  const st=storage(),s=createHmrViewStore({scope:'main',storage:st,now:()=>100});s.commit(make());s.beforeFullReload();
  if(kind==='scope')st.setItem('shioaji:hmr-view:1:monitor',[...st.data.values()][0]!);
  if(kind==='corrupt')st.setItem('shioaji:hmr-view:1:main','{bad');
  expect(createHmrViewStore({scope:kind==='scope'?'monitor':'main',storage:st,reload:kind!=='navigate',now:()=>kind==='future'?99:100}).read()).toBeNull();
 }
});
it('storage拒絕、production無storage不拋錯',()=>{
 const st={getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('denied');},removeItem:()=>{throw Error('denied');}};
 const s=createHmrViewStore({scope:'main',storage:st,reload:true});expect(s.read()).toBeNull();s.commit(make());expect(()=>s.beforeFullReload()).not.toThrow();
});
it('snapshot與period均複製，外部更動不能偷改原物件',()=>{
 const s=createHmrViewStore({scope:'main'}),v=make();s.commit(v);v.selected!.code='6770';expect(s.read()?.selected?.code).toBe('6187');
 const read=s.read()!;read.periods['chart-1']!.index=4;expect(s.period('chart-1')?.index).toBe(2);
});
it('不恢復移除/鎖定圖，拒絕未知type/週期/duplicate id',()=>{
 for(const bad of ['removed','pinned','type','period','duplicate']){
  const v=make();if(bad==='removed')v.workspace.blocks.pop();
  if(bad==='pinned')v.workspace.blocks[1]!.pin='2330';
  if(bad==='type')v.workspace.blocks[0]!.type='invalid' as never;
  if(bad==='period')v.periods['chart-1']!.index=9;
  if(bad==='duplicate')v.workspace.blocks[1]!.id='chart-1';
  expect(createHmrViewStore({scope:'main'}).commit(v)).toBe(false);
 }
});
it('capture prune移除圖及daily/period，原工作區不可變',()=>{
 const w=structuredClone(workspace);w.blocks.pop();w.layout.pop();const v=captureHmrView(w,c(),{'chart-2':{contract:c(),generation:1}},new Set(['chart-2']),{'chart-2':{index:1}});
 expect(v.charts).toEqual({});expect(v.dailyCharts).toEqual([]);expect(v.periods).toEqual({});expect(workspace.blocks).toHaveLength(2);
});
it('hot.data同文件remount保留原state，無需storage',()=>{
 const a=createHmrViewStore({scope:'main'});a.commit(make());const b=createHmrViewStore({scope:'main',previous:a.read()});expect(b.read()).toEqual(make());
});
it('原需求集合逐一解析、重複商品只處理一次，無額外quote I/O',async()=>{
 const v=make();v.charts['chart-1']={identity:hmrIdentity(c()),generation:3};const resolve=vi.fn(async i=>c(i.code,i.exchange));
 const out=await resolveHmrView(v,resolve,()=>true);expect(resolve).toHaveBeenCalledTimes(2);expect(out?.contracts.map(c=>c.code)).toEqual(['6187','2330']);expect(out?.charts['chart-2']).not.toHaveProperty('snapshot');
});
it('錯市場、region、type、alias目標或解析失敗拒絕整組',async()=>{
 for(const patch of [{exchange:'TSE'},{region:'US'},{security_type:'FUT'},{target_code:'wrong'}])
  await expect(resolveHmrView(make(),async()=>({...c(),...patch} as ContractInfo),()=>true)).rejects.toThrow('身分不一致');
 await expect(resolveHmrView(make(),async()=>{throw Error('timeout');},()=>true)).rejects.toThrow('timeout');
});
it('owner取消前後均不提交；後續商品也不解析',async()=>{
 let owns=true;const resolve=vi.fn(async()=>{owns=false;return c();});expect(await resolveHmrView(make(),resolve,()=>owns)).toBeNull();expect(resolve).toHaveBeenCalledTimes(1);
 expect(await resolveHmrView(make(),resolve,()=>false)).toBeNull();expect(resolve).toHaveBeenCalledTimes(1);
});
});
it('完整重載保留每分頁清單與圖表視窗，新增分頁不繼承；storage未落盤拒絕', () => {
 const st=storage(), a=createHmrViewStore({scope:'layout',storage:st,now:()=>100});
 const viewport={identity:'STK|OTC|6187|5',anchorTime:1700000000,from:-80,to:10,autoScale:false,priceRange:{from:90,to:130},paneHeights:[300,100]};
 a.commit(captureHmrView(workspace,c(),{},new Set(),{'chart-1':{index:1}},{activeListId:'list-A'}));a.setViewport('chart-1',viewport);
 expect(a.beforeFullReload()).toBe(true);
 const b=createHmrViewStore({scope:'layout',storage:st,reload:true,now:()=>200});expect(b.read()?.activeListId).toBe('list-A');expect(b.viewport('chart-1')).toEqual(viewport);
 b.viewport('chart-1')!.priceRange!.from=0;expect(b.viewport('chart-1')!.priceRange!.from).toBe(90);
 expect(createHmrViewStore({scope:'layout',storage:st,reload:false,now:()=>200}).read()).toBeNull();
 const denied=createHmrViewStore({scope:'main',storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}});denied.commit(make());expect(denied.beforeFullReload()).toBe(false);
});
it('視窗只套用仍存在的圖；非法視窗與清單拒絕', () => {
 const v=make();Object.assign(v,{activeListId:'../bad'});expect(createHmrViewStore({scope:'main'}).commit(v)).toBe(false);
 const s=createHmrViewStore({scope:'main'});s.commit(make());s.setViewport('removed',{identity:'x',anchorTime:1,from:-1,to:1,autoScale:true,paneHeights:[]});expect(s.viewport('removed')).toBeUndefined();
});
