import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { createChart, CandlestickSeries, type UTCTimestamp } from 'lightweight-charts';
import { PivotPrimitive } from '../lib/pivot-primitive';
import { buildSupportResistanceProjection, SUPPORT_RESISTANCE_FORMULA_ORDER } from '../lib/support-resistance';
import { createFibonacciController, fibonacciIdentity } from '../lib/fibonacci-annotations';
import { completedExtensionAutoscaleBounds } from '../lib/fibonacci-overlay';
import { FibonacciOverlay } from './fibonacci-overlay';
import type { KeyPricePercentContext } from '../lib/key-price-previous-close';
const context: KeyPricePercentContext = { baseline: {key:'fixture',tradeDate:'2026-10-30',previousDate:'2026-10-29',close:100,
    generation:1,receivedAt:1,source:'shioaji-canonical-unadjusted-v1',calendarVersion:'fixture',reason:null},up:'#ff0000',down:'#00ff00',neutral:'#cccccc' };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
const settle = async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); };
describe('關鍵價位百分比：真Chromium canvas/SVG（隔離合成資料，無業務請求）', () => {
    it.each([1,2])('窄面板真canvas量測，DPR%s：15條密集標籤不截斷、不縮字、不重疊', async dpr => {
        const canvas=document.createElement('canvas');canvas.width=300*dpr;canvas.height=420*dpr;document.body.append(canvas);
        const ctx=canvas.getContext('2d')!, originalText=ctx.fillText.bind(ctx), measured:{text:string;x:number;y:number;width:number}[]=[];
        const text=vi.spyOn(ctx,'fillText').mockImplementation((label,x,y,max)=>{
            measured.push({text:String(label),x,y,width:ctx.measureText(String(label)).width});
            if(max===undefined)originalText(label,x,y);else originalText(label,x,y,max);
        });
        const primitive=new PivotPrimitive({priceToCoordinate:(p:number)=>210-(p-100)*3} as never);
        primitive.attached({chart:{timeScale:()=>({timeToCoordinate:()=>0})},requestUpdate:()=>{}} as never);
        const ref={date:'2026-10-29',firstTime:1,lastTime:2,high:105,low:97,close:100,status:'completed' as const,mode:'pinned' as const};
        primitive.setProjections(ref,SUPPORT_RESISTANCE_FORMULA_ORDER.map(id=>buildSupportResistanceProjection(id,ref)),p=>p.toFixed(2));primitive.setPercentContext(context);
        primitive.paneViews()[0]!.renderer()!.draw({useBitmapCoordinateSpace:(cb: (s: unknown)=>void)=>cb({context:ctx,bitmapSize:{width:canvas.width,height:canvas.height},horizontalPixelRatio:dpr,verticalPixelRatio:dpr})} as never);
        const percents=text.mock.calls.filter(c=>String(c[0]).startsWith('較昨收'));
        expect(percents).toHaveLength(15);
        for(const call of text.mock.calls)expect(call[3]).toBeUndefined();
        for(const {x,y,width} of measured){expect(x).toBeGreaterThanOrEqual(0);expect(x+width).toBeLessThanOrEqual(canvas.width);expect(y).toBeGreaterThan(0);expect(y).toBeLessThan(canvas.height);}
        const ys=percents.map(c=>c[2]).sort((a,b)=>a-b);expect(ys.every((y,i)=>i===0||y-ys[i-1]!>=12*dpr)).toBe(true);
    });
    it.each([1,5,15,60,1440])('%s分鐘週期三公式全部15條，手動視窗／bar spacing／價格座標不變', async minutes => {
        const network = vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('fixture_no_requests'));
        await page.viewport(900,760);
        const host = document.createElement('div'); host.style.cssText = 'width:750px;height:600px';document.body.append(host);
        const chart = createChart(host,{width:750,height:600,layout:{background:{color:'#151b25'},textColor:'#eee'},timeScale:{barSpacing:7}});
        const series = chart.addSeries(CandlestickSeries);
        series.setData(Array.from({length:80},(_,i)=>({time:(Date.UTC(2026,9,30,9,i*minutes)/1000) as UTCTimestamp,open:100,high:101,low:99,close:100.2})));
        const primitive = new PivotPrimitive(series); chart.panes()[0]!.attachPrimitive(primitive);
        const reference = {date:'2026-10-28',firstTime:Date.UTC(2026,9,28)/1000,lastTime:Date.UTC(2026,9,28,13,30)/1000,
            high:105,low:97,close:100,status:'completed' as const,mode:'pinned' as const};
        const projections = SUPPORT_RESISTANCE_FORMULA_ORDER.map(id=>buildSupportResistanceProjection(id,reference));
        primitive.setProjections(reference,projections,p=>p.toFixed(2),{},null,'fixture-product');
        chart.timeScale().setVisibleLogicalRange({from:15,to:65});
        chart.priceScale('right').setVisibleRange({from:85,to:115}); await settle();
        const snapshot = () => ({range:chart.timeScale().getVisibleLogicalRange(),spacing:chart.timeScale().options().barSpacing,
            priceRange:chart.priceScale('right').getVisibleRange(),width:chart.priceScale('right').width(),height:chart.panes()[0]!.getHeight(),
            coords:[97,100,105].map(p=>series.priceToCoordinate(p)),x:chart.timeScale().logicalToCoordinate(40 as never),autoscale:primitive.autoscaleInfo()});
        const before = snapshot(); const draw = vi.spyOn(CanvasRenderingContext2D.prototype,'fillText');
        const evidence=vi.fn();primitive.onLabelsDrawn=evidence;
        // A stale caller context must not override the actual projection reference close100.
        const referenceContext:KeyPricePercentContext={...context,prefix:'',baseline:{key:'fixture-product',referenceDate:'2026-10-20',close:777,mode:'pinned',source:'support-resistance-reference-close-v1',reason:null}};
        primitive.setPercentContext(referenceContext); await settle(); const after = snapshot();
        expect(after).toEqual(before);
        const texts = draw.mock.calls.map(c=>String(c[0]));
        expect(texts.filter(t=>/^[+−]?\d+\.\d{2}%$/.test(t)).length).toBeGreaterThanOrEqual(15);
        expect(texts.some(t=>t.includes('較昨收'))).toBe(false);
        for(const prefix of ['PP','CDP','三關']) expect(texts.some(t=>t.startsWith(prefix+' '))).toBe(true);
        expect(evidence.mock.calls.at(-1)![0].every((r:{price:number;percentValue:number;baselineClose:number})=>r.baselineClose===100&&Math.abs(r.percentValue-(r.price/100-1)*100)<1e-9)).toBe(true);
        expect(network).not.toHaveBeenCalled();
        // Unknown preserves original projections and viewport.
        primitive.setProjections({...reference,close:0},projections,p=>p.toFixed(2),{},null,'fixture-product'); await settle();
        expect(draw.mock.calls.some(c=>c[0]==='—')).toBe(true); expect(snapshot()).toEqual(before);
        chart.remove();
    });
    it.each([360,800])('1D回撤／拓展：%spx密集標籤、真文字量測、connector、漲跌色與原圖不變', async width => {
        await page.viewport(1000,850);
        const host = document.createElement('div');host.style.cssText=`width:${width}px;height:720px;background:#151b25`;document.body.append(host);
        const root=createRoot(host), values=new Map<string,string>();
        const controller=createFibonacciController({getIdentity:()=>fibonacciIdentity({securityType:'STK',exchange:'TSE',canonicalCode:'fixture',timeframeMinutes:1440}),storage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);},removeItem:k=>{values.delete(k);}}});
        controller.restore();controller.arm('retracement');controller.addPoint({time:1,price:110});controller.addPoint({time:2,price:97.86});
        controller.arm('extension');controller.addPoint({time:1,price:100});controller.addPoint({time:2,price:110});controller.addPoint({time:3,price:95.82});
        const snapshot=controller.getSnapshot(), stored=JSON.stringify([...values]), bounds=completedExtensionAutoscaleBounds(snapshot);
        const coords={timeToCoordinate:(t:number)=>t*30,priceToCoordinate:(p:number)=>500-(p-100)*5};
        await act(async()=>root.render(createElement(FibonacciOverlay,{snapshot,width,height:720,rightEdge:width-10,coordinates:coords,formatPrice:p=>p.toFixed(2),percentContext:context})));
        const labels=[...host.querySelectorAll<SVGTextElement>('[data-fibonacci-label]')];
        expect(labels).toHaveLength(19);
        expect(labels.every(l=>l.querySelector('tspan')?.textContent?.match(/[+−]?\d+\.\d{2}%/))).toBe(true);
        expect(labels.every(l=>!l.textContent?.includes('較昨收'))).toBe(true);
        for(const label of labels) { const box=label.getBBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(720); }
        const percents=[...host.querySelectorAll<SVGTSpanElement>('tspan')];
        expect(percents.some(t=>t.getAttribute('fill')===context.up)).toBe(true);expect(percents.some(t=>t.getAttribute('fill')===context.down)).toBe(true);
        expect(host.querySelectorAll('[data-fibonacci-line="label-connector"]').length).toBeGreaterThan(0);
        expect(JSON.stringify([...values])).toBe(stored);expect(completedExtensionAutoscaleBounds(snapshot)).toEqual(bounds);
        console.log('KEY_PRICE_SVG_FIXTURE',JSON.stringify({width,labels:labels.map(l=>l.textContent),screenshot:await page.screenshot({path:`key-price-fib-${width}.png`})}));
        // Scope outside 1D gets the unchanged original overlay (no context).
        await act(async()=>root.render(createElement(FibonacciOverlay,{snapshot,width,height:720,rightEdge:width-10,coordinates:coords,formatPrice:p=>p.toFixed(2)})));
        expect(host.textContent).not.toContain('較昨收');await act(async()=>root.unmount());
    });
    it('合法pending水準預覽含百分比，A/B/C價格導引保持原文字，未知不補零', async()=>{
        const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
        const controller=createFibonacciController({getIdentity:()=> 'fixture-pending',storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}});
        controller.restore();controller.arm('retracement');controller.addPoint({time:1,price:110});controller.previewPoint({time:2,price:97.86});
        const props={snapshot:controller.getSnapshot(),width:700,height:500,rightEdge:650,coordinates:{timeToCoordinate:(t:number)=>t*50,priceToCoordinate:(p:number)=>300-(p-100)*5},formatPrice:(p:number)=>p.toFixed(2),percentContext:{...context,baseline:{...context.baseline,close:null,reason:'前日缺少'}}};
        await act(async()=>root.render(createElement(FibonacciOverlay,props)));
        expect(host.querySelectorAll('[data-fibonacci-label]').length).toBeGreaterThan(0);
        expect([...host.querySelectorAll('[data-fibonacci-label]')].every(l=>l.querySelector('tspan')?.textContent==='—')).toBe(true);
        expect(host.querySelector('[data-fibonacci-price-guide]')?.textContent).not.toContain('較昨收');
        await act(async()=>root.unmount());
    });
    it('左側空間足夠時全部標籤位於線段左端之外；分母更新不改原線與錨點',async()=>{
        const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
        const controller=createFibonacciController({getIdentity:()=> 'fixture-left',storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}});
        controller.restore();controller.arm('retracement');controller.addPoint({time:1,price:110});controller.addPoint({time:2,price:90});
        const props={snapshot:controller.getSnapshot(),width:1000,height:700,rightEdge:950,coordinates:{timeToCoordinate:(t:number)=>400+t*100,priceToCoordinate:(p:number)=>450-(p-100)*4},formatPrice:(p:number)=>p.toFixed(2),percentContext:context};
        await act(async()=>root.render(createElement(FibonacciOverlay,props)));
        const geometry=()=>[...host.querySelectorAll('[data-fibonacci-line="level"]')].map(l=>['x1','y1','x2','y2'].map(a=>l.getAttribute(a)));
        const before=geometry();const labels=[...host.querySelectorAll<SVGTextElement>('[data-fibonacci-label]')];expect(labels).toHaveLength(10);
        for(const l of labels){const box=l.getBBox();expect(box.x+box.width).toBeLessThan(Number(l.dataset.fibonacciLineStart));expect(l.textContent).not.toContain('較昨收');}
        await act(async()=>root.render(createElement(FibonacciOverlay,{...props,percentContext:{...context,baseline:{...context.baseline,close:200}}})));
        expect(geometry()).toEqual(before);
        for(const l of host.querySelectorAll<SVGTextElement>('[data-fibonacci-label]'))expect(Number(l.dataset.fibonacciPercent)).toBeCloseTo((Number(l.dataset.fibonacciLevelPrice)/200-1)*100,10);
        await act(async()=>root.unmount());
    });
});
