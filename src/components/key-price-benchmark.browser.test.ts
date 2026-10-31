import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { ContractInfo } from '../lib/types/contract';
import type { KBars } from '../lib/types/market';
import { CandleChart } from './candle-chart';
import { dailyIndicatorAuthority } from '../lib/daily-indicator-authority';
import { getInstancesSnapshot, newInstance, updateInstances, SUPPORT_RESISTANCE_INDICATOR_TYPES } from '../lib/indicator-defs';
import { resetChartKbarMemoryCacheForTests } from '../lib/chart-kbar-memory-cache';
import { darkTwClass } from '../theme.css';
import { setThemeSettings } from '../lib/theme-store';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { getSupportResistanceProductState, setSupportResistanceProductState, resetSupportResistanceProductStatesForTests, supportResistanceProductKey } from '../lib/support-resistance-state';
import { createFibonacciController,fibonacciIdentity } from '../lib/fibonacci-annotations';
const fixture = vi.hoisted(()=>({fetchKbars:vi.fn(),order:vi.fn(),modify:vi.fn(),alert:vi.fn(),chart:null as IChartApi|null,candles:null as ISeriesApi<'Candlestick'>|null}));
vi.mock('lightweight-charts',async original=>{
    const actual=await original<typeof import('lightweight-charts')>();
    return {...actual,createChart:(...args:Parameters<typeof actual.createChart>)=>{
        const chart=actual.createChart(...args);fixture.chart=chart;const add=chart.addSeries.bind(chart);
        chart.addSeries=((...sa:Parameters<typeof chart.addSeries>)=>{const s=add(...sa);if(sa[0]===actual.CandlestickSeries)fixture.candles=s as ISeriesApi<'Candlestick'>;return s;}) as typeof chart.addSeries;
        return chart;
    }};
});
vi.mock('../hooks/use-stream',()=>({useQuote:()=>undefined,useTradingLive:()=>false,useStreamStatus:()=> 'offline'}));
vi.mock('../lib/shioaji',()=>({fetchKbars:fixture.fetchKbars,fetchInfo:vi.fn(async()=>({simulation:true})),fetchAccounts:vi.fn(async()=>[]),cancelFuturesOrder:vi.fn(),cancelOrder:vi.fn(),updateFuturesOrderPrice:vi.fn(),updateOrderPrice:fixture.modify}));
vi.mock('../lib/trade',()=>({notify:vi.fn(),placeQuickOrder:fixture.order}));
vi.mock('../lib/trigger-engine',()=>({LEGACY_TRADING_TRIGGER_DISABLED_MESSAGE:'fixture_disabled',useTriggers:()=>[],addTrigger:fixture.alert,removeTrigger:vi.fn()}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const contract={code:'2330',name:'隔離合成來源（非live）',security_type:'STK',region:'TW',exchange:'TSE',target_code:null,currency:'TWD',reference:95,limit_up:120,limit_down:80,day_trade:'Yes',update_date:'2026-10-30',category:'',margin_trading_balance:0,short_selling_balance:0} as ContractInfo;
// The synthetic session is yesterday; today's fixture calendar is closed, at any clock time.
const today=()=>new Date(Date.parse(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'}))-86400000).toISOString().slice(0,10);
const date=(offset:number)=>new Date(Date.parse(today())+offset*86400000).toISOString().slice(0,10);
function data(start:string,end:string,multiplier=1):KBars {
    const k:KBars={datetime:[],Open:[],High:[],Low:[],Close:[],Volume:[]};
    for(let d=-45;d<=0;d++) if(date(d)>=start && date(d)<=end) {
        for(const t of ['09:00:00','13:30:00']) { k.datetime.push(date(d)+'T'+t);k.Open.push(100*multiplier);k.High.push(105*multiplier);k.Low.push(97*multiplier);k.Close.push((d===0?103:100)*multiplier);k.Volume.push(10); }
    } return k;
}
describe('主圖昨收接線：隔離合成來源，真React/Chromium',()=>{
    let root:Root,host:HTMLDivElement;
    beforeEach(async()=>{
        await page.viewport(1100,850);localStorage.clear();dailyIndicatorAuthority.resetForTests();resetChartKbarMemoryCacheForTests();resetSupportResistanceProductStatesForTests();setThemeSettings({mode:'dark',convention:'tw'});
        fixture.fetchKbars.mockReset().mockImplementation(async(_c,start,end)=>data(start,end));
        const now=Date.now(); vi.spyOn(globalThis,'fetch').mockImplementation(async input=>{
            if(String(input)!=='/api/market-calendar/v1/projection')throw Error('fixture_no_business_request');
            return new Response(JSON.stringify({ok:true,calendar:{schemaVersion:'shared-local-market-calendar/1',version:'fixture',observedAt:new Date().toISOString(),automaticRepairAllowed:false,
                annual:{verified:true,calendarVersion:'fixture',fetchedAtEpochMs:now-86400000,validUntilEpochMs:now+86400000,days:Array.from({length:52},(_,i)=>({tradeDate:date(i-49),TSE:i>49?'closed':'scheduled_trading',OTC:i>49?'closed':'scheduled_trading'}))},closures:{available:true,revision:0,hash:null,entries:[],liveHolds:[]}}}),{status:200});
        });
        updateInstances(()=>Object.values(SUPPORT_RESISTANCE_INDICATOR_TYPES).map(t=>newInstance(t)));
        host=document.createElement('div');host.className=darkTwClass;host.style.cssText='width:1000px;height:720px;display:flex;flex-direction:column';document.body.append(host);root=createRoot(host);
    });
    afterEach(async()=>{if(root)await act(async()=>root.unmount());vi.restoreAllMocks();dailyIndicatorAuthority.resetForTests();document.body.replaceChildren();});
    const settle=()=>act(async()=>{await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
    const baseline=()=>JSON.parse(host.querySelector('[data-key-price-benchmark]')?.getAttribute('data-key-price-benchmark')??'null');
    it('日K費波沿圖中最後close103／104，歷史視窗與日線authority不換分母，隱藏文字前綴',async()=>{
        const controller=createFibonacciController({getIdentity:()=>fibonacciIdentity({securityType:'STK',exchange:'TSE',canonicalCode:contract.code,timeframeMinutes:1440})});
        controller.restore();controller.arm('retracement');controller.addPoint({time:Date.parse(date(-20))/1000,price:110});controller.addPoint({time:Date.parse(date(-10))/1000,price:90});
        await act(async()=>root.render(createElement(CandleChart,{contract,initialDaily:true})));
        const fibBase=()=>JSON.parse(host.querySelector('[data-fibonacci-benchmark]')?.getAttribute('data-fibonacci-benchmark')||'null');
        await act(async()=>{await expect.poll(()=>fibBase()?.close).toBe(103);});await settle();
        const chart=fixture.chart!,candles=fixture.candles!;
        chart.timeScale().setVisibleLogicalRange({from:3,to:25});chart.priceScale('right').setVisibleRange({from:80,to:120});await settle();
        const view=()=>({range:chart.timeScale().getVisibleLogicalRange(),price:chart.priceScale('right').getVisibleRange(),spacing:chart.timeScale().options().barSpacing,y:candles.priceToCoordinate(103),data:candles.data()});
        const before=view();
        await act(async()=>dailyIndicatorAuthority.publish(contract,[{time:Date.parse(today()+'T13:30:00Z')/1000,open:999,high:999,low:999,close:999,volume:1,turnoverTwd:null}]));await settle();
        expect(fibBase()?.close).toBe(103);expect(view()).toEqual(before);
        const check=(close:number)=>{
            const labels=[...host.querySelectorAll<SVGTextElement>('[data-fibonacci-label]')];expect(labels.length).toBeGreaterThan(0);
            for(const l of labels){expect(l.textContent).not.toContain('較昨收');expect(Number(l.dataset.fibonacciPercent)).toBeCloseTo((Number(l.dataset.fibonacciLevelPrice)/close-1)*100,10);}
            expect(host.querySelector('[data-fibonacci-benchmark]')?.textContent).toContain('最後一根日K收盤');
        };check(103);
        fixture.fetchKbars.mockImplementation(async(_c,start,end)=>{const k=data(start,end);k.Close=k.Close.map((p,i)=>k.datetime[i]!.startsWith(today())?104:p);return k;});
        for(const tf of ['1m','1D']){await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent===tf)!.click();});await settle();}
        await act(async()=>{await expect.poll(()=>fibBase()?.close).toBe(104);});await settle();check(104);
    });
    it('1D三公式有15條較昨收；被動日K更新或參考K切換不動手動價格／時間視窗與K棒座標',async()=>{
        await act(async()=>root.render(createElement(CandleChart,{contract,initialDaily:true})));
        await act(async()=>{await expect.poll(()=>baseline()?.close).toBe(103);});await settle();
        const chart=fixture.chart!,candles=fixture.candles!;
        chart.timeScale().setVisibleLogicalRange({from:15,to:40});chart.priceScale('right').setVisibleRange({from:90,to:115});await settle();
        const viewport=()=>({range:chart.timeScale().getVisibleLogicalRange(),spacing:chart.timeScale().options().barSpacing,
            priceRange:chart.priceScale('right').getVisibleRange(),axisWidth:chart.priceScale('right').width(),paneHeight:chart.panes()[0]!.getHeight(),
            host:host.getBoundingClientRect().toJSON(),prices:[97,100,105].map(p=>candles.priceToCoordinate(p)),x:chart.timeScale().logicalToCoordinate(25 as never),data:candles.data()});
        const before=viewport(),options=vi.spyOn(candles,'applyOptions'),fit=vi.spyOn(chart.timeScale(),'fitContent');
        const labels=()=>JSON.parse(host.querySelector('[data-chart-code]')!.getAttribute('data-key-price-labels')||'[]');
        expect(labels()).toHaveLength(15);
        await act(async()=>{dailyIndicatorAuthority.publish(contract,[{time:Date.parse(today()+'T13:30:00Z')/1000,open:100,high:105,low:97,close:104,volume:10,turnoverTwd:null}]);});await settle();
        expect(viewport()).toEqual(before);expect(labels()).toHaveLength(15);expect(baseline()?.close).toBe(103);
        const state=getSupportResistanceProductState(supportResistanceProductKey(contract))!;
        await act(async()=>setSupportResistanceProductState({...state,reference:{...state.reference,close:101,mode:'pinned'},pinned:true}));await settle();
        expect(viewport()).toEqual(before);expect(labels()).toHaveLength(15);expect(baseline()?.close).toBe(101);
        expect(labels().every((l:{price:number;percentValue:number})=>Math.abs(l.percentValue-(l.price/101-1)*100)<1e-9)).toBe(true);
        expect(options).not.toHaveBeenCalled();expect(fit).not.toHaveBeenCalled();
        expect(dailyIndicatorAuthority.diagnostics(contract).historyRequests).toBe(0);
    });
    it('三商品連續54次換股／跨1D與四分K，當下renderer每次都有本商品15條百分比',async()=>{
        const products=[contract,{...contract,code:'2317',name:'合成B'},{...contract,code:'3017',name:'合成C'}];
        fixture.fetchKbars.mockImplementation(async(c:ContractInfo,start:string,end:string)=>data(start,end,c.code==='2330'?1:c.code==='2317'?2:3));
        for(let round=0;round<3;round++) for(const c of products) {
            await act(async()=>root.render(createElement(CandleChart,{contract:c})));
            for(const tf of ['1D','1m','15m','60m','5m','1m']) {
                await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent===tf)!.click();});
                const expected=c.code==='2330'?103:c.code==='2317'?206:309;
                await act(async()=>{await expect.poll(()=>baseline()?.close).toBe(expected);});await settle();
                const node=host.querySelector('[data-chart-code]')!;
                expect(node.getAttribute('data-chart-code')).toBe(c.code);
                expect(baseline()?.key).toBe(`STK|TSE|${c.code}`);
                const labels=JSON.parse(node.getAttribute('data-key-price-labels')||'[]');
                expect(labels).toHaveLength(15);
                for(const l of labels){expect(l.percent).toMatch(/^[＋+−]?\d+\.\d{2}%$/);expect(l.percentValue).toBeCloseTo((l.price/expected-1)*100,10);}
                expect(dailyIndicatorAuthority.diagnostics(c).historyRequests).toBe(0);
            }
        }
    });
    it('快速切換取消舊載入時，同商品已驗證昨收仍有效；不能被AbortError改成來源失敗',async()=>{
        await act(async()=>root.render(createElement(CandleChart,{contract})));
        await act(async()=>{await expect.poll(()=>baseline()?.close).toBe(103);});await settle();
        const pending:{resolve:(k:KBars)=>void;start:string;end:string}[]=[];
        fixture.fetchKbars.mockImplementation((_c:ContractInfo,start:string,end:string,signal:AbortSignal)=>new Promise<KBars>((resolve,reject)=>{
            pending.push({resolve,start,end});signal.addEventListener('abort',()=>reject(new DOMException('fixture_switch_cancelled','AbortError')),{once:true});
        }));
        const click=(tf:string)=>act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent===tf)!.click();});
        await click('1m');await settle();await click('15m');await settle();
        expect(pending.length).toBeGreaterThanOrEqual(2);
        expect(baseline()).toMatchObject({close:103,reason:null});
        await act(async()=>{pending.forEach(p=>p.resolve(data(p.start,p.end)));});await settle();
        expect(baseline()).toMatchObject({close:103,reason:null});
        expect(JSON.parse(host.querySelector('[data-chart-code]')!.getAttribute('data-key-price-labels')||'[]')).toHaveLength(15);
    });
    it('三公式使用其參考K收盤103，不使用當前實際昨收100或行情reference95；換時框不新增authority請求',async()=>{
        const draw=vi.spyOn(CanvasRenderingContext2D.prototype,'fillText');
        await act(async()=>root.render(createElement(CandleChart,{contract})));
        await act(async()=>{await expect.poll(()=>baseline()?.close).toBe(103);});await settle();
        expect(baseline()).toMatchObject({referenceDate:today(),source:'support-resistance-reference-close-v1',reason:null});
        expect(host.textContent).toContain('壓撐比較基準');
        expect(dailyIndicatorAuthority.diagnostics(contract).historyRequests).toBe(0);
        for(const tf of ['1m','5m','15m','60m']) {
            await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent===tf)!.click();});await settle();
            expect(baseline()?.close).toBe(103);expect(dailyIndicatorAuthority.diagnostics(contract).historyRequests).toBe(0);
        }
        expect(draw.mock.calls.some(c=>/^\+\d+\.\d{2}%$/.test(String(c[0])))).toBe(true);
        expect(draw.mock.calls.some(c=>/^−\d+\.\d{2}%$/.test(String(c[0])))).toBe(true);
        expect(fixture.order).not.toHaveBeenCalled();expect(fixture.modify).not.toHaveBeenCalled();expect(fixture.alert).not.toHaveBeenCalled();
        expect(getInstancesSnapshot()).toHaveLength(3);
        const chart=fixture.chart!,candles=fixture.candles!;
        chart.timeScale().setVisibleLogicalRange({from:2,to:8});chart.priceScale('right').setVisibleRange({from:90,to:115});await settle();
        const viewport=()=>({range:chart.timeScale().getVisibleLogicalRange(),spacing:chart.timeScale().options().barSpacing,
            yRange:chart.priceScale('right').getVisibleRange(),priceWidth:chart.priceScale('right').width(),y:[97,100,105].map(p=>candles.priceToCoordinate(p)),x:chart.timeScale().logicalToCoordinate(5 as never)});
        const before=viewport(),options=vi.spyOn(candles,'applyOptions');
        await act(async()=>{dailyIndicatorAuthority.publish(contract,[{time:Date.parse(today()+'T13:30:00Z')/1000,open:100,high:105,low:97,close:103,volume:10,turnoverTwd:null}]);});await settle();
        expect(viewport()).toEqual(before);expect(options).not.toHaveBeenCalled();
        const state=getSupportResistanceProductState(supportResistanceProductKey(contract))!;
        await act(async()=>setSupportResistanceProductState({...state,pinned:true,reference:{...state.reference,date:date(-5),close:95,low:90,mode:'pinned'}}));await settle();
        expect(baseline()).toMatchObject({close:95,referenceDate:date(-5),reason:null});
        const rows=JSON.parse(host.querySelector('[data-chart-code]')!.getAttribute('data-key-price-labels')||'[]');
        expect(rows).toHaveLength(15);for(const row of rows)expect(row.percentValue).toBeCloseTo((row.price/95-1)*100,10);
        await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='1D')!.click();});await settle();
        await act(async()=>{await expect.poll(()=>baseline()?.close).toBe(95);});await settle();
        expect(JSON.parse(host.querySelector('[data-chart-code]')!.getAttribute('data-key-price-labels')||'[]')).toHaveLength(15);
        console.log('KEY_PRICE_CANDLE_FIXTURE',await page.screenshot({path:'key-price-main-chart-fixture.png'}));
    });
});
