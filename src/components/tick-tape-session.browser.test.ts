import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TickTape } from './tick-tape';
import { DEFAULT_LARGE_TRADE_SETTINGS as defaults, readLargeTradeSettings, saveLargeTradeSettings, replaySessionTape } from '../lib/tick-tape-session';
import { readTapeCache, writeTapeCache, fetchSessionHistory } from '../lib/tick-tape-repository';
import { historyTickTapeInputs } from '../lib/tick-tape-large-trade';
import type { HistoryTicks } from '../lib/types/tick';
import type { ContractBase } from '../lib/types/contract';
import type { SseTick } from '../lib/types/market';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const stock: ContractBase = { region: 'TW', exchange: 'TSE', code: '2330', security_type: 'STK', target_code: null };
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
const roots: Root[] = [];
function history(count: number): HistoryTicks {
    return { datetime: Array.from({ length: count }, (_, index) => `${date}T10:00:${String(Math.floor(index / 100000) % 60).padStart(2, '0')}.${String(index % 100000).padStart(6, '0')}`), close: Array(count).fill(100), volume: Array(count).fill(10), tick_type: Array(count).fill(1), bid_price: Array(count).fill(99), bid_volume: Array(count).fill(1), ask_price: Array(count).fill(101), ask_volume: Array(count).fill(1) };
}
async function mount(h: () => Promise<HistoryTicks>, subscriber = (_listener: (tick: SseTick) => void) => () => undefined) {
    const host = document.createElement('div'); host.style.cssText = 'height:600px;width:420px'; document.body.append(host);
    const root = createRoot(host); roots.push(root);
    await act(async () => { root.render(createElement(TickTape, { contract: stock, historyLoader: h, tickSubscriber: subscriber })); });
    await settle();
    return { host, root };
}
function button(host: HTMLElement, text: string) { return [...host.querySelectorAll('button')].find(b => b.textContent === text)!; }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); }); }
async function click(element: HTMLElement) { await act(async () => { element.click(); await new Promise(resolve => setTimeout(resolve, 30)); }); }
async function writeHistoryBudget(count: number) {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('rts.tick-tape.v1', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('budget', 'readwrite');
            tx.objectStore('budget').put({ count, last: 0, events: [] }, date);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } finally { db.close(); }
}
async function readHistoryBudget() {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('rts.tick-tape.v1', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    try {
        return await new Promise<{ count: number; events?: Array<{ reason: string; queryType: string }> }>((resolve, reject) => {
            const tx = db.transaction('budget', 'readonly');
            const request = tx.objectStore('budget').get(date);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally { db.close(); }
}
afterEach(async () => { await act(async () => { roots.splice(0).forEach(root => root.unmount()); }); document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); });
describe('完整日成交面板', () => {
    it('資訊預設不佔位，點 i 才開啟；萬元輸入保存為正確元值', async () => {
        const { host } = await mount(async () => history(1));
        expect(host.querySelector('[role="status"]')).toBeNull();
        expect(host.textContent).not.toContain('歷史來源');
        expect(host.textContent).not.toContain('大單條件：');
        const info = host.querySelector<HTMLButtonElement>('[aria-label="成交明細資訊"]')!;
        await click(info);
        expect(host.querySelector('dialog[open]')?.textContent).toContain('部分資料');
        expect(host.textContent).toContain('前 120 筆 P80');
        await click(button(host, '關閉'));
        expect(document.activeElement).toBe(info);
        expect(host.querySelector('[role="status"]')).toBeNull();
        await click(button(host, '大單設定'));
        const amount = host.querySelector<HTMLInputElement>('input')!;
        expect(amount.closest('label')?.textContent).toBe('單筆成交金額門檻（萬元）');
        expect(amount.value).toBe('100');
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(amount, '125.5');
            amount.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await click(button(host, '套用'));
        expect(readLargeTradeSettings().amount).toBe(1255000);
        await click(button(host, '大單設定'));
        expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('125.5');
    });
    it('2500 筆全部／大單不截斷、虛擬列可回到最早，新增成交保留歷史閱讀位置', async () => {
        let listener!: (tick: SseTick) => void;
        const subscriber = vi.fn((fn: typeof listener) => { listener = fn; return () => undefined; });
        const { host } = await mount(async () => history(2500), subscriber);
        await expect.poll(() => host.textContent).toContain('全部 2500');
        expect(host.textContent).toContain('大單 2500');
        expect(host.querySelectorAll('[data-tape-row]').length).toBeLessThan(50);
        await click(button(host, '當日最早'));
        await expect.poll(() => host.querySelector('[data-tape-row]:last-child')?.textContent).toContain('10:00:00.000000');
        const view = host.querySelector<HTMLElement>('[aria-label="成交明細列表"]')!;
        const oldTop = view.scrollTop;
        await act(async () => listener({ code: '2330', date, time: '10:01:00.123456', close: '100', volume: 10, tick_type: 1, open: '100', high: '100', low: '100', total_volume: 25010 } as SseTick));
        await expect.poll(() => view.scrollTop).toBe(oldTop + 24);
        await click(button(host, '回到最新'));
        await expect.poll(() => view.scrollTop).toBe(0);
        expect(subscriber).toHaveBeenCalledOnce();
    });
    it('開盤及延後收盤在全部、大單不包含；空來源及失敗不宣稱零成交', async () => {
        const h = history(4); h.datetime = ['09:00:00', '09:00:00.000001', '13:25:00', '13:33:00'].map(t => `${date}T${t}`);
        const { host } = await mount(async () => h);
        await expect.poll(() => host.textContent).toContain('全部 4');
        expect(host.textContent).toContain('大單 1');
        const empty = await mount(async () => history(0));
        await click(empty.host.querySelector<HTMLButtonElement>('[aria-label="成交明細資訊"]')!);
        await expect.poll(() => empty.host.textContent).toContain('尚未確認當日無成交');
        await click(button(empty.host, '關閉'));
        const failed = await mount(async () => { throw new Error('連線失敗'); });
        await click(failed.host.querySelector<HTMLButtonElement>('[aria-label="成交明細資訊"]')!);
        await expect.poll(() => failed.host.textContent).toContain('載入失敗');
    });
    it('設定套用重算、同頁雙面板同步、storage 事件及重載持久保存', async () => {
        const h = history(1); h.volume = [5]; h.close = [200];
        const first = await mount(async () => h); const second = await mount(async () => h);
        await expect.poll(() => first.host.textContent).toContain('全部 1');
        expect(first.host.textContent).toContain('大單 0');
        await click(button(first.host, '大單設定'));
        const select = first.host.querySelector('select')!;
        await act(async () => { select.value = 'OR'; select.dispatchEvent(new Event('change', { bubbles: true })); });
        await click(button(first.host, '套用'));
        await expect.poll(() => first.host.textContent).toContain('大單 1');
        await expect.poll(() => second.host.textContent).toContain('大單 1');
        expect(readLargeTradeSettings().operator).toBe('OR');
        const reloaded = await mount(async () => h);
        await expect.poll(() => reloaded.host.textContent).toContain('大單 1');
        await act(async () => {
            localStorage.setItem('rts.tick-tape.settings.v1', JSON.stringify(defaults));
            window.dispatchEvent(new StorageEvent('storage', { key: 'rts.tick-tape.settings.v1' }));
        });
        await expect.poll(() => second.host.textContent).toContain('大單 0');
        expect(first.host.querySelector('button:focus')?.textContent).toBe('大單設定');
    });
    it('取消過期重算，重算中的新成交納入最新設定', async () => {
        let listener!: (tick: SseTick) => void;
        const { host } = await mount(async () => history(5000), fn => { listener = fn; return () => undefined; });
        await expect.poll(() => host.textContent).toContain('全部 5000');
        await act(async () => {
            saveLargeTradeSettings({ ...defaults, amount: 1e9 });
            saveLargeTradeSettings({ ...defaults, operator: 'OR' });
            listener({ code: '2330', date, time: '10:02:00.123456', close: '100', volume: 10, tick_type: 1, open: '100', high: '100', low: '100', total_volume: 25010 } as SseTick);
        });
        await settle();
        await expect.poll(() => host.textContent).not.toContain('重新計算中');
        expect(host.textContent).toContain('全部 5001'); expect(host.textContent).toContain('大單 5001');
    });
    it('IndexedDB 原子替換與重載，併發相同商品僅讀取一次快取', async () => {
        const inputs = historyTickTapeInputs(stock, history(2500), 1);
        const key = `STK:TSE:2330|${date}`;
        await writeTapeCache(key, inputs, Date.now());
        const cached = await readTapeCache(key);
        expect(cached?.inputs).toHaveLength(2500);
        const [a, b] = await Promise.all([fetchSessionHistory(stock, date), fetchSessionHistory(stock, date)]);
        expect(a).toBe(b);
        expect(a.inputs).toHaveLength(2500);
        await writeTapeCache(key, inputs.slice(0, 1), Date.now());
        expect((await readTapeCache(key))?.inputs).toHaveLength(1);
    });
    it('不同商品同時載入會排隊，不因 1.5 秒間隔直接失敗', async () => {
        const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (request, init) => {
            if (String(request).includes('/snapshots')) {
                const body = JSON.parse(String(init?.body)) as { contracts: Array<{ code: string }> };
                return new Response(JSON.stringify([{ code: body.contracts[0]!.code, total_volume: 10 }]), { headers: { 'Content-Type': 'application/json' } });
            }
            return new Response(JSON.stringify(history(1)), { headers: { 'Content-Type': 'application/json' } });
        });
        const results = await Promise.all(['QUEUE1', 'QUEUE2'].map(code => fetchSessionHistory({ ...stock, code }, date)));
        expect(results.map(result => result.inputs.length)).toEqual([1, 1]);
        expect(fetcher).toHaveBeenCalledTimes(6);
    }, 10_000);
    it('保留既有 usage 計數但不再以無來源依據的每日八次硬上限拒絕查詢', async () => {
        await writeHistoryBudget(8);
        const contract = { ...stock, code: 'NOHARDCAP' };
        const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (request) => {
            if (String(request).includes('/snapshots')) {
                return new Response(JSON.stringify([{ code: contract.code, total_volume: 10 }]), { headers: { 'Content-Type': 'application/json' } });
            }
            return new Response(JSON.stringify(history(1)), { headers: { 'Content-Type': 'application/json' } });
        });
        const result = await fetchSessionHistory(contract, date, true, 'initial');
        expect(result.inputs).toHaveLength(1);
        expect(fetcher).toHaveBeenCalledTimes(3);
        expect(await readHistoryBudget()).toMatchObject({
            count: 10,
            events: [
                { reason: 'initial', queryType: 'AllDay' },
                { reason: 'initial', queryType: 'RangeTime' },
            ],
        });
    }, 10_000);
    it('429 Retry-After 建立跨掛載持久冷卻，相同商品日期不立即重試', async () => {
        await writeHistoryBudget(10);
        const contract = { ...stock, code: 'COOLDOWN' };
        const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '45' } }));
        await expect(fetchSessionHistory(contract, date, true, 'initial')).rejects.toThrow('429');
        const calls = fetcher.mock.calls.length;
        await expect(fetchSessionHistory(contract, date, true, 'reconnect_gap')).rejects.toThrow('冷卻中');
        expect(fetcher).toHaveBeenCalledTimes(calls);
    }, 10_000);
    it('空間不足與原子寫入失敗保留舊快取', async () => {
        const inputs = historyTickTapeInputs(stock, history(2), 1);
        const key = 'atomic-failure-test';
        await writeTapeCache(key, inputs, Date.now());
        const estimate = vi.spyOn(navigator.storage, 'estimate').mockResolvedValue({ quota: 100, usage: 99 });
        await expect(writeTapeCache(key, inputs.slice(0, 1), Date.now())).rejects.toThrow('空間不足');
        estimate.mockRestore();
        const invalid = { ...inputs[0]!, invalidClone: () => undefined };
        await expect(writeTapeCache(key, [invalid], Date.now())).rejects.toBeTruthy();
        expect((await readTapeCache(key))?.inputs).toHaveLength(2);
    });
    it('10 萬／50 萬筆合成資料重播、IndexedDB 儲存及讀取量測', async () => {
        for (const count of [100000, 500000]) {
            const inputs = historyTickTapeInputs(stock, history(count), 1);
            const key = `benchmark|${count}`;
            const started = performance.now();
            let pulses = 0;
            const timer = setInterval(() => { pulses++; }, 16);
            const model = await replaySessionTape(inputs, { ...defaults }, new AbortController().signal);
            clearInterval(timer);
            const replayMs = performance.now() - started;
            expect(model.result.rows).toHaveLength(count);
            expect(model.result.largeIndices).toHaveLength(count);
            expect(pulses).toBeGreaterThan(0);
            const before = await navigator.storage.estimate();
            const writeStart = performance.now(); await writeTapeCache(key, inputs, Date.now());
            const writeMs = performance.now() - writeStart;
            const after = await navigator.storage.estimate();
            const readStart = performance.now();
            expect((await readTapeCache(key))?.inputs).toHaveLength(count);
            console.info('TAPE_BENCHMARK', JSON.stringify({ count, replayMs, writeMs, readMs: performance.now() - readStart, storageBytes: (after.usage ?? 0) - (before.usage ?? 0), inputJsonBytes: JSON.stringify(inputs).length, pulses }));
        }
    }, 60000);
});
