import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { SpecialMarketClosuresSettings } from './special-market-closures-settings';
import '../index.css';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => { if(root) await act(async()=>root?.unmount());host?.remove();root=null;host=null;vi.unstubAllGlobals(); });
async function mount() { host=document.createElement('div');document.body.append(host);root=createRoot(host);
    await act(async()=>root?.render(createElement(SpecialMarketClosuresSettings))); }
const state={revision:0,today:'2026-10-23',entries:[] as {date:string;reason:string;recordedAt:string;revision:number}[]};
test('離線畫面新增、精確撤銷確認與歷程版本；只使用本機設定路由',async()=>{
    let value=structuredClone(state);const requests:{action:string;date:string;reason:string;confirmed:boolean;expectedRevision:number}[]=[];
    vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
        expect(input).toBe('/api/market-calendar/v1/special-closures');
        if(init?.method==='POST'){
            const body=JSON.parse(String(init.body));requests.push(body);
            expect(body.expectedRevision).toBe(value.revision);
            value={...value,revision:value.revision+1,entries:body.action==='close'?
                [...value.entries,{date:body.date,reason:body.reason,recordedAt:'2026-10-23T01:00:00+08:00',revision:value.revision+1}]:[]};
        }
        return new Response(JSON.stringify({ok:true,closures:value}),{status:200});
    }));
    await mount();
    await act(async()=>{await page.getByRole('button',{name:'讀取特殊休市設定'}).click();});
    await expect.element(page.getByText('尚未設定特殊休市日。')).toBeVisible();
    await act(async()=>{await page.getByLabelText('特殊休市日期',{exact:true}).fill('2026-10-27');});
    await act(async()=>{await page.getByLabelText('休市原因',{exact:true}).fill('颱風臨時休市');});
    await expect.element(page.getByRole('button',{name:'確認新增特殊休市日'})).toBeDisabled();
    await act(async()=>{await page.getByRole('checkbox').click();});
    await act(async()=>{await page.getByRole('button',{name:'確認新增特殊休市日'}).click();});
    await expect.element(page.getByRole('button',{name:'選擇撤銷 2026-10-27'})).toBeVisible();
    await act(async()=>{await page.getByRole('button',{name:'選擇撤銷 2026-10-27'}).click();});
    expect(requests.length).toBe(1);
    await expect.element(page.getByRole('button',{name:'確認撤銷／更正休市日'})).toBeDisabled();
    await act(async()=>{await page.getByLabelText('休市原因',{exact:true}).fill('未來公告更正');});
    await act(async()=>{await page.getByRole('checkbox').click();});
    await act(async()=>{await page.getByRole('button',{name:'確認撤銷／更正休市日'}).click();});
    await expect.element(page.getByText('尚未設定特殊休市日。')).toBeVisible();
    expect(requests.map(r=>[r.action,r.date,r.confirmed])).toEqual([['close','2026-10-27',true],['revoke','2026-10-27',true]]);
});
test('讀取失敗不提供保存入口',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:503})));
    await mount();await act(async()=>{await page.getByRole('button',{name:'讀取特殊休市設定'}).click();});
    await expect.element(page.getByRole('status')).toHaveTextContent('讀取成功前無法修改');
    expect(host?.querySelector('input')).toBeNull();
});
test('共用檢查必須明確按鈕才讀取，不因改條件自動請求或沿用結果',async()=>{
    const requests:string[]=[];
    vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
        requests.push(input);
        if(input.endsWith('/special-closures'))return Response.json({closures:state});
        expect(input).toBe('/api/market-calendar/v1/checks');expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toMatchObject({symbol:'2330.TW',dataset:'candles',interval:'1d'});
        return Response.json({ok:true,check:{status:'unknown',reason:'intraday_store_not_proven',calendarVersion:'fixture-manual:1',
            observedAt:'2026-10-23T06:00:00Z',externalRequests:0,changedDb:false}});
    }));
    await mount();expect(requests).toEqual([]);
    await act(async()=>{await page.getByRole('button',{name:'讀取特殊休市設定'}).click();});
    expect(requests.length).toBe(1);
    await act(async()=>{await page.getByRole('tab',{name:'資料檢查',exact:true}).click();});
    expect(requests.length).toBe(1);
    await act(async()=>{await page.getByRole('button',{name:'唯讀檢查現有資料'}).click();});
    await expect.element(page.getByLabelText('日曆資料檢查結果')).toHaveTextContent('無法判定');
    await expect.element(page.getByLabelText('日曆資料檢查結果')).toHaveTextContent('缺漏 —');
    expect(requests.length).toBe(2);
    await act(async()=>{await page.getByLabelText('檢查商品',{exact:true}).fill('8069.TWO');});
    expect(host?.querySelector('output')).toBeNull();expect(requests.length).toBe(2);
});
test('今日休市可選擇更正，但必須再次確認且明示 live hold',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({closures:{...state,revision:1,
        entries:[{date:'2026-10-23',reason:'颱風休市',recordedAt:'2026-10-23T01:00:00+08:00',revision:1}]}}),{status:200})));
    await mount();await act(async()=>{await page.getByRole('button',{name:'讀取特殊休市設定'}).click();});
    await expect.element(page.getByText('颱風休市',{exact:true})).toBeVisible();
    await act(async()=>{await page.getByRole('button',{name:'選擇撤銷 2026-10-23'}).click();});
    await expect.element(page.getByRole('button',{name:'確認撤銷／更正休市日'})).toBeDisabled();
    await expect.element(page.getByText('撤銷今日休市後，即時工作仍維持阻擋，不會自動重新開市。')).toBeVisible();
});
