import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { TickTape } from '../components/tick-tape';
import type { TickTapeEventInput } from './tick-tape-large-trade';
import type { ContractBase } from './types/contract';
import type { SseTick } from './types/market';
const mock = vi.hoisted(() => ({ load: vi.fn(), last: vi.fn(), read: vi.fn(async (..._args: unknown[]) => null), write: vi.fn(async (..._args: unknown[]) => undefined), status: 'live', statusListeners: new Set<() => void>(), ticks: new Set<(tick: SseTick) => void>() }));
vi.mock('./shioaji', () => ({ fetchLastTicks: mock.last }));
vi.mock('./tick-tape-repository', () => ({
    TAPE_SOURCE_LIMITATION: '部分資料：來源待核實', readTapeCache: (...args: unknown[]) => mock.read(...args), writeTapeCache: (...args: unknown[]) => mock.write(...args),
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
afterEach(async () => { vi.useRealTimers(); await settle(() => root?.unmount()); document.body.replaceChildren(); mock.load.mockReset(); mock.last.mockReset(); mock.read.mockClear(); mock.write.mockClear(); mock.status = 'live'; });
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
    await settle(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '分價量表')!.click());
    expect(host.querySelector('[data-coverage-state="confirmed_empty"]')?.textContent).toContain('當日已確認無成交');
    expect(host.textContent).toContain('共 0 個成交價位／0 張');
    await settle(() => host.querySelector<HTMLButtonElement>('[aria-label="成交明細資訊"]')!.click());
    expect(host.textContent).toContain('已確認當日無成交');
});
it('分價量表沿用同一 session，呈現核實摘要、方向、佔比及重疊標記', async () => {
    const trades = [
        { ...input('10:00:00'), close: 100, volume: 10, tickType: 1, sourceSequence: `${date}|regular|10`, sourceCumulativeVolume: 10 },
        { ...input('10:00:01'), close: 100, volume: 5, tickType: 2, sourceSequence: `${date}|regular|15`, sourceCumulativeVolume: 15 },
        { ...input('10:00:02'), close: 101, volume: 10, tickType: 0, sourceSequence: `${date}|regular|25`, sourceCumulativeVolume: 25 },
        { ...input('10:00:03'), close: 99, volume: 10, tickType: 1, sourceSequence: `${date}|regular|35`, sourceCumulativeVolume: 35 },
    ];
    mock.load.mockResolvedValue({
        inputs: trades,
        fetchedAt: Date.now(),
        metadata: {
            evidence: {
                state: 'verified', coverage: '已核實完整', verifiedThrough: `${date}T10:00:03.000000`, gaps: [],
                allDayCount: 4, rangeCount: 4, regularCount: 4, postSessionCount: 0,
                regularVolume: 35, postSessionVolume: 0, snapshotTotalVolume: 35,
            },
        },
    });
    await mount();
    expect(mock.load).toHaveBeenCalledTimes(1);
    expect(mock.ticks.size).toBe(1);
    expect(mock.write).not.toHaveBeenCalled();
    await settle(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '分價量表')!.click());

    const distribution = host.querySelector<HTMLElement>('[data-price-volume-distribution="true"]')!;
    expect(distribution).toBeTruthy();
    await settle(() => { host.style.width = '248px'; });
    const distributionViewport = distribution.querySelector<HTMLElement>('[aria-label="分價量表"]')!;
    expect(getComputedStyle(distributionViewport).overflowX).toBe('hidden');
    expect(distributionViewport.scrollWidth).toBe(distributionViewport.clientWidth);
    expect(distribution.querySelector('[data-coverage-state="verified"]')?.textContent).toContain('截至目前已核實');
    const summaries = [...distribution.querySelectorAll<HTMLElement>('[class*="distributionSummaryItem"]')];
    expect(summaries[0]?.textContent).toContain('100.0總成交均價');
    expect(summaries[1]?.textContent).toContain('100.5大單成交均價');
    expect(distribution.querySelectorAll('[data-price-volume-row]')).toHaveLength(3);

    const price100 = distribution.querySelector<HTMLElement>('[data-price-volume-row="100"]')!;
    expect(price100.getBoundingClientRect().height).toBe(28);
    expect(price100.textContent).toContain('28.6%');
    expect(price100.textContent).toContain('42.9%');
    expect(price100.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('買方 10 張，賣方 5 張，未知 0 張');
    const price101 = distribution.querySelector<HTMLElement>('[data-price-volume-row="101"]')!;
    expect(price101.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('買方 0 張，賣方 0 張，未知 10 張');
    expect(price101.querySelector('[data-price-marker="high"]')).toBeTruthy();
    expect(price100.querySelector('[data-price-marker="open"]')).toBeTruthy();
    const price99 = distribution.querySelector<HTMLElement>('[data-price-volume-row="99"]')!;
    expect(price99.querySelector('[data-price-marker="current"]')).toBeTruthy();
    expect(price99.querySelector('[data-price-marker="low"]')).toBeTruthy();

    await settle(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '成交明細')!.click());
    await settle(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '分價量表')!.click());
    expect(mock.load).toHaveBeenCalledTimes(1);
    expect(mock.ticks.size).toBe(1);

    await settle(() => mock.ticks.forEach(fn => fn({ ...tick('10:00:04', 45), close: '98' })));
    expect(host.textContent).toContain('共 4 個成交價位／45 張');
    expect(mock.load).toHaveBeenCalledTimes(1);
    await settle(() => root.unmount());
    expect(mock.ticks.size).toBe(0);
    expect(mock.statusListeners.size).toBe(0);
});
it('分價量表首次定位目前價，手動捲動後不被新成交搶走', async () => {
    const inputs = Array.from({ length: 100 }, (_, index) => {
        const cumulative = (index + 1) * 10;
        return {
            ...input(`10:00:${String(Math.floor(index / 10)).padStart(2, '0')}.${String(index).padStart(6, '0')}`),
            close: 100 - index,
            sourceSequence: `${date}|regular|${cumulative}`,
            sourceCumulativeVolume: cumulative,
        };
    });
    mock.load.mockResolvedValue({ inputs, fetchedAt: Date.now(), metadata: metadata('verified', '已核實完整', 100) });
    await mount();
    await settle(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '分價量表')!.click());
    const viewport = host.querySelector<HTMLElement>('[aria-label="分價量表"]')!;
    expect(viewport.scrollTop).toBeGreaterThan(0);
    await act(async () => {
        viewport.scrollTop = 180;
        viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await settle(() => mock.ticks.forEach(fn => fn({ ...tick('10:01:00', 1010), close: '100.5' })));
    expect(viewport.scrollTop).toBe(180);
    await settle(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '回到目前價')!.click());
    expect(viewport.scrollTop).toBe(0);
    expect(host.querySelectorAll('[data-price-volume-row]').length).toBeLessThan(40);
});
it('資金流向共用 session，呈現真實分鐘間隔、三種淨額、未知方向及窄面板版面', async () => {
    const trades = [
        { ...input('10:00:00'), volume: 10, tickType: 1, sourceSequence: `${date}|regular|10`, sourceCumulativeVolume: 10 },
        { ...input('10:00:01'), volume: 5, tickType: 2, sourceSequence: `${date}|regular|15`, sourceCumulativeVolume: 15 },
        { ...input('10:06:00'), volume: 5, tickType: 1, sourceSequence: `${date}|regular|20`, sourceCumulativeVolume: 20 },
        { ...input('10:07:00'), volume: 2, tickType: 0, sourceSequence: `${date}|regular|22`, sourceCumulativeVolume: 22 },
        { ...input('10:08:00'), volume: 20, tickType: 2, sourceSequence: `${date}|regular|42`, sourceCumulativeVolume: 42 },
    ];
    mock.load.mockResolvedValue({
        inputs: trades,
        fetchedAt: Date.now(),
        metadata: {
            evidence: {
                state: 'verified', coverage: '已核實完整', verifiedThrough: `${date}T10:08:00.000000`, gaps: [],
                allDayCount: 5, rangeCount: 5, regularCount: 5, postSessionCount: 0,
                regularVolume: 42, postSessionVolume: 0, snapshotTotalVolume: 42,
            },
        },
    });
    await mount();
    await settle(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '資金流向')!.click());
    const money = host.querySelector<HTMLElement>('[data-money-flow="true"]')!;
    expect(money).toBeTruthy();
    expect(mock.load).toHaveBeenCalledTimes(1);
    expect(mock.ticks.size).toBe(1);
    expect(money.textContent).toContain('主動買賣成交淨額');
    expect(money.textContent).toContain('未知方向 1 筆／0.20 百萬元');
    expect(money.textContent).not.toContain('大戶');
    expect(money.textContent).not.toContain('散戶');
    expect([...money.querySelectorAll('button')].some(button => button.textContent === '即時' || button.textContent === '月')).toBe(false);
    const rows = [...money.querySelectorAll<HTMLElement>('[data-money-flow-row]')];
    expect(rows.map(row => row.dataset.moneyFlowRow)).toEqual(['10:08', '10:07', '10:06', '10:00']);
    expect(rows[0]?.textContent).toBe('10:08-1.00-1.000.00');
    expect(rows[2]?.textContent).toBe('10:061.001.000.00');
    const chart = money.querySelector<SVGElement>('svg')!;
    expect(Number(chart.dataset.yMin)).toBeLessThan(0);
    expect(Number(chart.dataset.yMax)).toBeGreaterThan(0);
    expect(chart.querySelector('[data-money-zero-axis="true"]')).toBeTruthy();
    expect(chart.querySelectorAll('[data-money-series]')).toHaveLength(3);
    const path = chart.querySelector<SVGPathElement>('[data-money-series="overall"]')!.getAttribute('d')!;
    const xs = [...path.matchAll(/[ML]([\d.]+),/gu)].map(match => Number(match[1]));
    expect(xs[1]! - xs[0]!).toBeCloseTo((xs[2]! - xs[1]!) * 6, 1);
    await settle(() => { host.style.width = '248px'; host.style.height = '320px'; });
    const viewport = money.querySelector<HTMLElement>('[aria-label="資金流向分鐘表"]')!;
    expect(getComputedStyle(viewport).overflowX).toBe('hidden');
    expect(viewport.scrollWidth).toBe(viewport.clientWidth);
    expect(chart.getBoundingClientRect().height).toBeGreaterThan(0);
    await settle(() => mock.ticks.forEach(fn => fn({ ...tick('10:08:01', 44), volume: 2, tick_type: 0 })));
    expect(money.textContent).toContain('未知方向 2 筆／0.40 百萬元');
    expect(money.querySelector<HTMLElement>('[data-money-flow-row="10:08"]')?.textContent).toBe('10:08-1.00-1.000.00');
    await settle(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '成交明細')!.click());
    await settle(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '資金流向')!.click());
    expect(mock.load).toHaveBeenCalledTimes(1);
    expect(mock.ticks.size).toBe(1);
    expect(mock.write).not.toHaveBeenCalled();
    expect(mock.last).not.toHaveBeenCalled();
});
it('資金流向分鐘表 DOM 有界，捲離後新增分鐘維持閱讀位置', async () => {
    const inputs = Array.from({ length: 100 }, (_, index) => {
        const minuteIndex = 9 * 60 + index;
        const time = `${String(Math.floor(minuteIndex / 60)).padStart(2, '0')}:${String(minuteIndex % 60).padStart(2, '0')}:00`;
        const cumulative = (index + 1) * 10;
        return { ...input(time), sourceSequence: `${date}|regular|${cumulative}`, sourceCumulativeVolume: cumulative };
    });
    mock.load.mockResolvedValue({ inputs, fetchedAt: Date.now(), metadata: metadata('verified', '已核實完整', 100) });
    await mount();
    await settle(() => { host.style.height = '320px'; });
    await settle(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '資金流向')!.click());
    const viewport = host.querySelector<HTMLElement>('[aria-label="資金流向分鐘表"]')!;
    await act(async () => {
        viewport.scrollTop = 112;
        viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await settle(() => mock.ticks.forEach(fn => fn(tick('10:40:00', 1010))));
    expect(viewport.scrollTop).toBe(140);
    expect(host.querySelectorAll('[data-money-flow-row]').length).toBeLessThan(40);
    expect(host.textContent).toContain('101 個成交分鐘');
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
it('亂序 live 成交補上累計量缺口時恢復已核實，不遺留假 partial', async () => {
    const sequenced = (time: string, cumulative: number) => ({ ...input(time), sourceSequence: `${date}|regular|${cumulative}`, sourceCumulativeVolume: cumulative });
    mock.load.mockResolvedValueOnce({ inputs: [sequenced('10:00:00', 10)], fetchedAt: Date.now(), metadata: metadata('verified', '已核實完整', 1) });
    await mount();
    let finishRecovery!: (value: unknown) => void;
    mock.load.mockReturnValueOnce(new Promise(resolve => { finishRecovery = resolve; }));
    await settle(() => mock.ticks.forEach(fn => fn(tick('10:00:02', 30))));
    expect(mock.load).toHaveBeenCalledTimes(2);
    await settle(() => mock.ticks.forEach(fn => fn(tick('10:00:01', 20))));
    await settle(() => host.querySelector<HTMLButtonElement>('[aria-label="成交明細資訊"]')!.click());
    expect(host.textContent).toContain('已核實完整');
    expect(host.textContent).toContain('全部 3');
    await settle(() => finishRecovery({ inputs: [sequenced('10:00:00', 10), sequenced('10:00:01', 20), sequenced('10:00:02', 30)], fetchedAt: Date.now(), metadata: metadata('verified', '已核實完整', 3) }));
    expect(mock.load).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('全部 3');
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
