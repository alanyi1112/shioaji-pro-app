import { describe, expect, it, vi } from 'vitest';
import { DailyIndicatorAuthority } from './daily-indicator-authority';
import type { ContractInfo } from './types/contract';
import type { Candle } from './types/market';
const c = { code: '2330', security_type: 'STK', region: 'TW', exchange: 'TSE', target_code: null } as unknown as ContractInfo;
const NOW = Date.parse('2026-10-29T13:31:00Z') / 1000;
const raw = (date: string, close = 100): Candle => ({ time: Date.parse(date + 'T13:30:00Z') / 1000, open: close, high: close, low: close, close, volume: 1, turnoverTwd: null });
describe('商品共用日線authority', () => {
    it('充分快取跨時框／雙consumer沒有新增請求', async () => {
        const load = vi.fn(), a = new DailyIndicatorAuthority(load, () => NOW);
        const bars = Array.from({ length: 130 }, (_, i) => ({ ...raw('2026-10-29'), time: (Math.floor(NOW / 86400) - 129 + i) * 86400 + 9 * 3600 }));
        a.publish(c, bars, '2026-10-29');
        const one = vi.fn(), two = vi.fn(), stop = a.subscribe(c, 120, one), stop2 = a.subscribe(c, 120, two);
        await Promise.resolve(); expect(load).not.toHaveBeenCalled();
        stop(); a.trade(c, NOW + 1, 102); expect(two).toHaveBeenCalled(); expect(a.snapshot(c).bars.at(-1)!.close).toBe(102); stop2();
    });
    it('雙面板共用在途，單一consumer離開不取消，最後離開才中止', async () => {
        let signal: AbortSignal | undefined;
        const load = vi.fn((_c, _s, _e, s) => { signal = s; return new Promise<Candle[]>(() => {}); });
        const a = new DailyIndicatorAuthority(load, () => NOW), one = a.subscribe(c, 120, () => {}), two = a.subscribe(c, 120, () => {});
        await Promise.resolve(); expect(load).toHaveBeenCalledTimes(1);
        one(); await Promise.resolve(); expect(signal!.aborted).toBe(false);
        two(); await Promise.resolve(); expect(signal!.aborted).toBe(true);
    });
    it('13 chunk上限與同coverage不重抓，短期需求達標即停止', async () => {
        const load = vi.fn(async (_c: ContractInfo, start: string, _end: string, _signal: AbortSignal) => [raw(start)]);
        const a = new DailyIndicatorAuthority(load, () => NOW), stop = a.subscribe(c, 120, () => {});
        await vi.waitFor(() => expect(a.snapshot(c).state).toBe('ready'));
        expect(load).toHaveBeenCalledTimes(13);
        const ranges = load.mock.calls.map(x => [x[1], x[2]]); expect(new Set(ranges.map(String)).size).toBe(13);
        stop(); const next = a.subscribe(c, 120, () => {}); await Promise.resolve(); await Promise.resolve(); expect(load).toHaveBeenCalledTimes(13); next();
        const bLoad = vi.fn(async (_c, start: string) => [raw(start)]), b = new DailyIndicatorAuthority(bLoad, () => NOW);
        b.subscribe(c, 1, () => {}); await vi.waitFor(() => expect(b.snapshot(c).state).toBe('ready')); expect(bLoad).toHaveBeenCalledTimes(1);
    });
    it('來源失敗不重試／不假刷新asOf，遲到回覆不可污染其他商品', async () => {
        const load = vi.fn(async () => { throw Error('fixture_gate_denied'); });
        const a = new DailyIndicatorAuthority(load, () => NOW); a.publish(c, [raw('2026-10-28')]); const at = a.snapshot(c).asOf;
        const stop = a.subscribe(c, 120, () => {}); await vi.waitFor(() => expect(a.snapshot(c).state).toBe('stale'));
        expect(a.snapshot(c).asOf).toBe(at); stop(); const stop2 = a.subscribe(c, 120, () => {}); await Promise.resolve(); expect(load).toHaveBeenCalledTimes(1); stop2();
        expect(a.snapshot({ ...c, code: '3008' }).bars).toHaveLength(0);
    });
    it('closed需要盤後來源及尾端，時鐘到點不自動封閉；期貨未知', () => {
        let now = NOW; const a = new DailyIndicatorAuthority(vi.fn(), () => now);
        a.publish(c, [raw('2026-10-29')]); expect(a.snapshot(c).phase).toBe('forming');
        now = Date.parse('2026-10-29T14:00:00Z') / 1000;
        a.trade(c, Date.parse('2026-10-29T13:30:01Z') / 1000, 101); expect(a.snapshot(c).phase).toBe('unknown');
        const b = new DailyIndicatorAuthority(vi.fn(), () => now); b.publish(c, [raw('2026-10-29')]); expect(b.snapshot(c).phase).toBe('closed');
        const fut = { ...c, security_type: 'FUT' } as ContractInfo; b.publish(fut, [raw('2026-10-29')]); expect(b.snapshot(fut).phase).toBe('unknown');
    });
    it('同秒新序號更新、重播不倒退，換日沒有憑空新增日K', () => {
        let now = NOW; const a = new DailyIndicatorAuthority(vi.fn(), () => now);
        a.publish(c, [raw('2026-10-29')]); const time = NOW - 30;
        a.trade(c, time, 101, 1, 1); a.trade(c, time, 102, 2, 1); a.trade(c, time, 99, 1, 1);
        expect(a.snapshot(c).bars.at(-1)!.close).toBe(102); expect(a.snapshot(c).bars).toHaveLength(1);
        now += 86400; expect(a.snapshot(c).bars).toHaveLength(1);
        a.publish(c, [raw('2026-10-28')]); expect(a.snapshot(c).phase).toBe('unknown');
    });
    it('既有1D在途完成前不重抓，StrictMode重新訂閱只保留一份需求', async () => {
        const load = vi.fn(); const a = new DailyIndicatorAuthority(load, () => NOW);
        let resolve!: () => void; const pending = new Promise<void>(r => { resolve = r; }); a.track(c, pending);
        const first = a.subscribe(c, 1, () => {}); first(); const last = a.subscribe(c, 1, () => {});
        await Promise.resolve(); expect(load).not.toHaveBeenCalled();
        a.publish(c, [raw('2026-10-29')], '2026-10-29', '2026-10-01'); resolve();
        await vi.waitFor(() => expect(a.snapshot(c).state).toBe('ready')); expect(load).not.toHaveBeenCalled(); last();
    });
    it('不回應來源有逾時，不在切時框後無限重試', async () => {
        const load = vi.fn(() => new Promise<Candle[]>(() => {}));
        const a = new DailyIndicatorAuthority(load, () => NOW, 5);
        const stop = a.subscribe(c, 1, () => {});
        await vi.waitFor(() => expect(a.snapshot(c).state).toBe('unavailable'));
        expect(load).toHaveBeenCalledTimes(1); stop(); const again = a.subscribe(c, 1, () => {});
        await Promise.resolve(); expect(load).toHaveBeenCalledTimes(1); again();
    });
    it('取消後遲到的A來源不污染B；未來或非法資料一次即停止', async () => {
        let resolve!: (rows: Candle[]) => void;
        const load = vi.fn(() => new Promise<Candle[]>(r => { resolve = r; }));
        const a = new DailyIndicatorAuthority(load, () => NOW), stop = a.subscribe(c, 1, () => {});
        await Promise.resolve(); stop(); await Promise.resolve(); resolve([raw('2026-10-29')]);
        await vi.waitFor(() => expect(a.snapshot(c).state).toBe('idle')); expect(a.snapshot(c).bars).toHaveLength(0);
        expect(a.snapshot({ ...c, code: '3008' }).bars).toHaveLength(0);
        const invalid = vi.fn(async () => [raw('2026-10-30')]), b = new DailyIndicatorAuthority(invalid, () => NOW);
        b.subscribe(c, 120, () => {}); await vi.waitFor(() => expect(b.snapshot(c).state).toBe('unavailable')); expect(invalid).toHaveBeenCalledTimes(1);
    });
    it('保存有界日K快取及可歸因的合成來源量測', async () => {
        const load = vi.fn(async (_c: ContractInfo, start: string) => [raw(start)]), a = new DailyIndicatorAuthority(load, () => NOW);
        a.subscribe(c, 120, () => {}); await vi.waitFor(() => expect(a.snapshot(c).state).toBe('ready'));
        const metrics = a.diagnostics(c); expect(metrics.historyRequests).toBe(13); expect(metrics.canonicalPayloadBytes).toBeGreaterThan(1000); expect(metrics.retainedDailyBars).toBe(13);
        for (let i = 0; i < 20; i++) a.publish({ ...c, code: String(i) }, [raw('2026-10-29')]);
        expect(a.diagnostics(c).cacheEntries).toBeLessThanOrEqual(12);
        process.stdout.write(`DAILY_AUTHORITY_FIXTURE_METRICS ${JSON.stringify(metrics)}\n`);
    });
});
