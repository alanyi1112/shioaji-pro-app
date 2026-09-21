import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { TickTape } from '../components/tick-tape';
import type { TickTapeEventInput } from './tick-tape-large-trade';
import type { ContractBase } from './types/contract';
import type { SseTick } from './types/market';
const mock = vi.hoisted(() => ({ load: vi.fn(), last: vi.fn(), status: 'live', statusListeners: new Set<() => void>(), ticks: new Set<(tick: SseTick) => void>() }));
vi.mock('./shioaji', () => ({ fetchLastTicks: mock.last }));
vi.mock('./tick-tape-repository', () => ({
    TAPE_SOURCE_LIMITATION: '部分資料：來源待核實', readTapeCache: async () => null, writeTapeCache: async () => undefined,
    fetchSessionHistory: (...args: unknown[]) => mock.load(...args),
}));
vi.mock('./stream', () => ({
    getStreamStatus: () => mock.status,
    subscribeStatusStore: (fn: () => void) => { mock.statusListeners.add(fn); return () => mock.statusListeners.delete(fn); },
    onAnyTick: (fn: (tick: SseTick) => void) => { mock.ticks.add(fn); return () => mock.ticks.delete(fn); },
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
const stock: ContractBase = { code: '2330', exchange: 'TSE', security_type: 'STK', region: 'TW', target_code: null };
const input = (time: string, contract = stock, day = date): TickTapeEventInput => ({ contract, date: day, time, source: 'history', generation: 1, close: 100, volume: 10, tickType: 1 });
const tick = (time: string, total_volume: number, day = date): SseTick => ({ code: '2330', date: day, time, close: '100', volume: 10, tick_type: 1, total_volume, open: '100', high: '100', low: '100' });
const metadata = (state: 'verified' | 'partial' | 'confirmed_empty', coverage: string, count: number, gaps: string[] = []) => ({
    evidence: { state, coverage, verifiedThrough: count ? `${date}T10:00:00.000000` : null, gaps,
        allDayCount: count, rangeCount: count, regularCount: count, postSessionCount: 0,
        regularVolume: count * 10, postSessionVolume: 0, snapshotTotalVolume: count * 10 },
});
let root: Root; let host: HTMLElement;
async function settle(action: () => void = () => {}) { await act(async () => { action(); await new Promise(resolve => setTimeout(resolve, 60)); }); }
async function mount() { host = document.createElement('div'); host.style.cssText = 'height:600px;width:400px'; document.body.append(host); root = createRoot(host); await settle(() => root.render(createElement(TickTape, { contract: stock }))); }
afterEach(async () => { vi.useRealTimers(); await settle(() => root?.unmount()); document.body.replaceChildren(); mock.load.mockReset(); mock.last.mockReset(); mock.status = 'live'; });
it('相同商品契約物件刷新不重載歷史，也不清除斷線狀態', async () => {
    mock.load.mockResolvedValue({ inputs: [input('10:00:00')], fetchedAt: Date.now(), metadata: metadata('verified', '已核實完整', 1) });
    await mount();
    expect(mock.load).toHaveBeenCalledTimes(1);
    await settle(() => { mock.status = 'down'; mock.statusListeners.forEach(fn => fn()); });
    await settle(() => root.render(createElement(TickTape, { contract: { ...stock } })));
    expect(mock.load).toHaveBeenCalledTimes(1);
    await settle(() => host.querySelector<HTMLButtonElement>('[aria-label="成交明細資訊"]')!.click());
    expect(host.textContent).toContain('行情斷線');
    expect(host.textContent).toContain('全部 1');
});
it('斷線保存已載入資料，重連只補一次並保留緩衝成交', async () => {
    mock.load.mockResolvedValue({ inputs: [{ ...input('10:00:00'), sourceSequence: `${date}|regular|10`, sourceCumulativeVolume: 10 }], fetchedAt: Date.now() });
    await mount(); expect(host.textContent).toContain('全部 1');
    await settle(() => { mock.status = 'down'; mock.statusListeners.forEach(fn => fn()); });
    await settle(() => host.querySelector<HTMLButtonElement>('[aria-label="成交明細資訊"]')!.click());
    expect(host.textContent).toContain('行情斷線'); expect(host.textContent).toContain('全部 1');
    mock.load.mockResolvedValue({ inputs: [
        { ...input('10:00:00'), sourceSequence: `${date}|regular|10`, sourceCumulativeVolume: 10 },
        { ...input('10:01:00'), sourceSequence: `${date}|regular|20`, sourceCumulativeVolume: 20 },
    ], fetchedAt: Date.now() });
    await settle(() => { mock.status = 'live'; mock.statusListeners.forEach(fn => fn()); mock.ticks.forEach(fn => fn(tick('10:02:00', 30))); });
    expect(mock.load).toHaveBeenCalledTimes(2); expect(host.textContent).toContain('全部 3');
    await settle(() => mock.ticks.forEach(fn => fn(tick('10:02:00', 30))));
    expect(host.textContent).toContain('全部 3');
    await settle(() => mock.ticks.forEach(fn => fn(tick('10:02:00', 40))));
    expect(host.textContent).toContain('全部 4');
    expect(mock.load).toHaveBeenCalledTimes(2);
});
it('重連後沒有新成交時保持部分資料，不重查歷史也不假裝已核實', async () => {
    mock.load.mockResolvedValue({ inputs: [{ ...input('10:00:00'), sourceSequence: `${date}|regular|10`, sourceCumulativeVolume: 10 }], fetchedAt: Date.now(), metadata: metadata('verified', '已核實完整', 1) });
    await mount();
    await settle(() => { mock.status = 'down'; mock.statusListeners.forEach(fn => fn()); });
    await settle(() => { mock.status = 'live'; mock.statusListeners.forEach(fn => fn()); });
    await settle(() => host.querySelector<HTMLButtonElement>('[aria-label="成交明細資訊"]')!.click());
    expect(host.textContent).toContain('行情已重連，等待下一筆成交核對');
    expect(mock.load).toHaveBeenCalledTimes(1);
});
it('退避中的第二次缺口不會遺失，後續成交連續也會在冷卻後自動補齊', async () => {
    const sequenced = (time: string, cumulative: number) => ({ ...input(time), sourceSequence: `${date}|regular|${cumulative}`, sourceCumulativeVolume: cumulative });
    mock.load
        .mockResolvedValueOnce({ inputs: [sequenced('10:00:00', 10)], fetchedAt: Date.now(), metadata: metadata('verified', '已核實完整', 1) })
        .mockResolvedValueOnce({ inputs: [sequenced('10:00:00', 10), sequenced('10:00:01', 20), sequenced('10:00:02', 30)], fetchedAt: Date.now(), metadata: metadata('verified', '已核實完整', 3) })
        .mockResolvedValueOnce({ inputs: [10, 20, 30, 40, 50, 60].map((cumulative, index) => sequenced(`10:00:0${index}`, cumulative)), fetchedAt: Date.now(), metadata: metadata('verified', '已核實完整', 6) });
    await mount();
    await settle(() => { mock.status = 'down'; mock.statusListeners.forEach(fn => fn()); });
    await settle(() => { mock.status = 'live'; mock.statusListeners.forEach(fn => fn()); mock.ticks.forEach(fn => fn(tick('10:00:02', 30))); });
    expect(mock.load).toHaveBeenCalledTimes(2);
    vi.useFakeTimers();
    await act(async () => {
        mock.status = 'down'; mock.statusListeners.forEach(fn => fn());
        mock.status = 'live'; mock.statusListeners.forEach(fn => fn());
        mock.ticks.forEach(fn => fn(tick('10:00:04', 50)));
        mock.ticks.forEach(fn => fn(tick('10:00:05', 60)));
        await Promise.resolve();
    });
    expect(mock.load).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_100); await Promise.resolve(); });
    expect(mock.load).toHaveBeenCalledTimes(3);
    expect(host.textContent).toContain('全部 6');
});
it('明確區分已核實、部分資料及經三方確認無成交', async () => {
    mock.load.mockResolvedValue({ inputs: [{ ...input('10:00:00'), sourceSequence: `${date}|regular|10`, sourceCumulativeVolume: 10 }], fetchedAt: Date.now(), metadata: metadata('verified', '已核實完整', 1) });
    await mount();
    await settle(() => host.querySelector<HTMLButtonElement>('[aria-label="成交明細資訊"]')!.click());
    expect(host.textContent).toContain('已核實完整');
    await settle(() => host.querySelector<HTMLButtonElement>('[aria-label="成交明細資訊"]')!.click());
    await settle(() => root.unmount());
    document.body.replaceChildren();
    mock.load.mockResolvedValue({ inputs: [], fetchedAt: Date.now(), metadata: metadata('confirmed_empty', '已確認當日無成交', 0) });
    await mount();
    expect(host.textContent).toContain('當日已確認無成交');
    await settle(() => host.querySelector<HTMLButtonElement>('[aria-label="成交明細資訊"]')!.click());
    expect(host.textContent).toContain('已確認當日無成交');
});
it('live 累計量跳號時只做一次有界補齊，補回缺口後恢復已核實', async () => {
    const sequenced = (time: string, cumulative: number) => ({ ...input(time), sourceSequence: `${date}|regular|${cumulative}`, sourceCumulativeVolume: cumulative });
    mock.load.mockResolvedValueOnce({ inputs: [sequenced('10:00:00', 10)], fetchedAt: Date.now(), metadata: metadata('verified', '已核實完整', 1) });
    await mount();
    mock.load.mockResolvedValue({ inputs: [sequenced('10:00:00', 10), sequenced('10:00:01', 20), sequenced('10:00:02', 30)], fetchedAt: Date.now(), metadata: metadata('verified', '已核實完整', 3) });
    await settle(() => mock.ticks.forEach(fn => fn(tick('10:00:02', 30))));
    await expect.poll(() => mock.load).toHaveBeenCalledTimes(2);
    await expect.poll(() => host.textContent).toContain('全部 3');
    await settle(() => host.querySelector<HTMLButtonElement>('[aria-label="成交明細資訊"]')!.click());
    expect(host.textContent).toContain('已核實完整');
});
it('切股後舊請求不可覆蓋新商品', async () => {
    let resolve!: (value: unknown) => void;
    mock.load.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    await mount();
    const next = { ...stock, code: '2317' };
    mock.load.mockResolvedValue({ inputs: [input('10:03:00', next)], fetchedAt: Date.now() });
    await settle(() => root.render(createElement(TickTape, { contract: next })));
    await settle(() => resolve({ inputs: [input('10:00:00'), input('10:01:00')], fetchedAt: Date.now() }));
    expect(host.textContent).toContain('全部 1'); expect(host.textContent).toContain('10:03:00'); expect(host.textContent).not.toContain('10:01:00');
});
it('新交易日隔離舊樣本及舊請求，舊日期 live 拒收', async () => {
    mock.load.mockResolvedValue({ inputs: [input('10:00:00')], fetchedAt: Date.now() });
    await mount();
    const tomorrow = new Date(`${date}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1); const day = tomorrow.toISOString().slice(0, 10);
    mock.load.mockResolvedValue({ inputs: [input('09:00:01', stock, day)], fetchedAt: Date.now() });
    await settle(() => mock.ticks.forEach(fn => fn(tick('09:00:02', 20, day))));
    expect(host.textContent).toContain('全部 2'); expect(host.textContent).not.toContain('10:00:00');
    await settle(() => mock.ticks.forEach(fn => fn(tick('10:01:00', 50, date))));
    expect(host.textContent).toContain('全部 2');
});

it('期貨夜盤先查下一日期，空白時退回今日，不套台股時段', async () => {
    const empty = { datetime: [], close: [], volume: [], tick_type: [], bid_price: [], bid_volume: [], ask_price: [], ask_volume: [] };
    mock.last.mockResolvedValueOnce(empty).mockResolvedValueOnce({ ...empty, datetime: [`${date}T21:00:00.123456`], close: [20000], volume: [10], tick_type: [1] });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    await settle(() => root.render(createElement(TickTape, { contract: { ...stock, code: 'TXFR1', security_type: 'FUT', exchange: 'TAIFEX' } })));
    expect(mock.last).toHaveBeenCalledTimes(2);
    expect(mock.last.mock.calls[0]![1]).toBe(120);
    expect(mock.last.mock.calls[0]![2]).not.toBe(date);
    expect(mock.last.mock.calls[1]).toHaveLength(2);
    expect(host.textContent).toContain('21:00:00.123456');
    expect(host.textContent).toContain('大單 0');
});
