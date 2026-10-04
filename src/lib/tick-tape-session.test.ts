import { describe, it, expect } from 'vitest';
import { DEFAULT_LARGE_TRADE_SETTINGS as defaults, SessionTapeClassifier, mergeTapeInputs, replaySessionTape, tradeAmountTwd, validateLargeTradeSettings } from './tick-tape-session';
import type { TickTapeEventInput } from './tick-tape-large-trade';
const event = (overrides: Partial<TickTapeEventInput> = {}): TickTapeEventInput => ({
    contract: { code: '2330', exchange: 'TSE', security_type: 'STK', region: 'TW', target_code: null },
    date: '2026-09-11', time: '10:00:00.123456', source: 'live', generation: 1, close: 100, volume: 10, tickType: 1, ...overrides,
});
describe('完整日大單分類', () => {
    it('新預設、等號及整組 AND/OR', () => {
        const and = new SessionTapeClassifier({ ...defaults });
        const or = new SessionTapeClassifier({ ...defaults, operator: 'OR' });
        for (const input of [event(), event({ close: 50 }), event({ close: 200, volume: 5 })]) { and.append(input); or.append(input); }
        expect(and.result.rows.map(r => r.isLarge)).toEqual([true, false, false]);
        expect(or.result.rows.map(r => r.isLarge)).toEqual([true, true, true]);
    });
    it('P80 使用前置樣本，第 31 筆才含動態條件，舊判定固定', () => {
        const c = new SessionTapeClassifier({ ...defaults });
        for (let i = 0; i < 30; i++) c.append(event({ volume: i < 23 ? 10 : 20 }));
        expect(c.result.rows[29]!.dynamicThreshold).toBeNull();
        c.append(event({ volume: 10 }));
        expect(c.result.rows[30]).toMatchObject({ dynamicThreshold: 2_000_000, isLarge: false });
        const old = JSON.stringify(c.result.rows[30]);
        for (let i = 0; i < 200; i++) c.append(event({ volume: 100 }));
        expect(JSON.stringify(c.result.rows[30])).toBe(old);
        expect(c.result.sampleCount).toBe(120);
    });
    it.each(['AND', 'OR'] as const)('%s 不能繞過時段、試撮、零股；全部含開收盤', operator => {
        const c = new SessionTapeClassifier({ ...defaults, operator });
        for (const input of [event({ time: '09:00:00' }), event({ time: '09:00:00.000001' }), event({ time: '13:24:59.999999' }), event({ time: '13:25:00' }), event({ time: '13:30:00' }), event({ time: '13:33:00' }), event({ time: '14:00:00' }), event({ simtrade: true }), event({ intradayOdd: true })]) c.append(input);
        expect(c.result.rows).toHaveLength(6);
        expect(c.result.rows.map(r => r.isLarge)).toEqual([false, true, true, false, false, false]);
        expect(c.getPriceVolumeDistribution()).toMatchObject({
            totalVolume: 60,
            largeVolume: 20,
            openPrice: 100,
            currentPrice: 100,
            rows: [{ totalVolume: 60, largeVolume: 20 }],
        });
    });
    it('十進位價格的等值門檻不受二進位小數誤差影響', () => {
        expect(tradeAmountTwd(33.33, 30)).toBe(999900);
        const c = new SessionTapeClassifier({ ...defaults, amount: 999900 });
        c.append(event({ close: 33.33, volume: 30 }));
        expect(c.result.rows[0]!.isLarge).toBe(true);
    });
    it('同值成交保留出現次數，跨來源重疊消耗相同次數，微秒不同不合併', () => {
        const h = event({ source: 'history' });
        const merged = mergeTapeInputs([h, h], [event(), event(), event(), event({ time: '10:00:00.123457' })]);
        expect(merged).toHaveLength(4);
        const c = new SessionTapeClassifier({ ...defaults });
        merged.forEach(input => c.append(input));
        expect(new Set(c.result.rows.map(r => r.tradeKey)).size).toBe(4);
        expect(c.getMoneyFlow()).toMatchObject({
            overallNetTwd: 4_000_000,
            largeNetTwd: 4_000_000,
            nonLargeNetTwd: 0,
            points: [{ minute: '10:00', overallNetTwd: 4_000_000 }],
        });
    });
    it('有來源累計序號時只排除同一重播，保留同值但不同序號成交', () => {
        const h = event({ source: 'history', sourceSequence: '2026-09-11|regular|10', sourceCumulativeVolume: 10 });
        const replay = event({ sourceSequence: '2026-09-11|regular|10', sourceCumulativeVolume: 10 });
        const distinct = event({ sourceSequence: '2026-09-11|regular|20', sourceCumulativeVolume: 20 });
        expect(mergeTapeInputs([h], [replay, distinct])).toEqual([h, distinct]);
    });
    it('超過 120/500/2000 筆完整保留，可取消整日重播', async () => {
        const inputs = Array.from({ length: 2500 }, () => event());
        const result = await replaySessionTape(inputs, { ...defaults }, new AbortController().signal);
        expect(result.result.rows).toHaveLength(2500);
        expect(result.result.largeIndices).toHaveLength(2500);
        const abort = new AbortController();
        const promise = replaySessionTape(inputs, { ...defaults }, abort.signal);
        abort.abort();
        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    });
    it('設定重播使用每筆自己的歷史門檻', async () => {
        const inputs = [event({ volume: 1 }), event({ volume: 20 }), event({ volume: 10 })];
        const c = await replaySessionTape(inputs, { ...defaults, warmup: 1, sampleSize: 1 }, new AbortController().signal);
        expect(c.result.rows.map(r => r.dynamicThreshold)).toEqual([null, 100000, 2000000]);
    });
    it('資金流向與設定重播原子重建，未知方向只累計摘要', async () => {
        const inputs = [
            event({ time: '10:00:00', volume: 5, tickType: 1 }),
            event({ time: '10:01:00', volume: 20, tickType: 2 }),
            event({ time: '10:02:00', volume: 2, tickType: 0 }),
        ];
        const strict = await replaySessionTape(inputs, { ...defaults }, new AbortController().signal);
        expect(strict.getMoneyFlow()).toMatchObject({
            overallNetTwd: -1_500_000,
            largeNetTwd: -2_000_000,
            nonLargeNetTwd: 500_000,
            unknownDirectionCount: 1,
            unknownDirectionAmountTwd: 200_000,
        });
        const relaxed = await replaySessionTape(
            inputs,
            { ...defaults, amount: 100_000, lots: 1 },
            new AbortController().signal,
        );
        expect(relaxed.getMoneyFlow()).toMatchObject({
            overallNetTwd: -1_500_000,
            largeNetTwd: -1_500_000,
            nonLargeNetTwd: 0,
            unknownDirectionCount: 1,
            unknownDirectionAmountTwd: 200_000,
        });
        expect(strict.getMoneyFlow().points).not.toBe(relaxed.getMoneyFlow().points);
    });
    it('亂序補齊先排序再重播，商品與交易日由各自 classifier 隔離', async () => {
        const dayOne = await replaySessionTape(
            mergeTapeInputs([], [event({ time: '10:02:00' }), event({ time: '10:01:00' })]),
            { ...defaults },
            new AbortController().signal,
        );
        const dayTwo = await replaySessionTape(
            [event({ date: '2026-09-12', contract: { ...event().contract, code: '2317' }, close: 200 })],
            { ...defaults },
            new AbortController().signal,
        );
        expect(dayOne.getMoneyFlow().points.map(point => point.minute)).toEqual(['10:01', '10:02']);
        expect(dayOne.getMoneyFlow().overallNetTwd).toBe(2_000_000);
        expect(dayTwo.getMoneyFlow().overallNetTwd).toBe(2_000_000);
        expect(dayOne.result.rows.every(row => row.contractKey.endsWith(':2330'))).toBe(true);
        expect(dayTwo.result.rows.every(row => row.contractKey.endsWith(':2317'))).toBe(true);
    });
    it('拒绝非有限值、非法上限及暖機大於取樣', () => {
        for (const settings of [{ ...defaults, amount: NaN }, { ...defaults, sampleSize: 2001 }, { ...defaults, warmup: 121 }, { ...defaults, percentile: 0 }]) expect(validateLargeTradeSettings(settings)).not.toBeNull();
    });
    it('台股時段不套入期貨夜盤，且不分類為台股大單', () => {
        const c = new SessionTapeClassifier({ ...defaults });
        const input = event({ time: '21:00:00', contract: { ...event().contract, security_type: 'FUT', exchange: 'TAIFEX' } });
        c.append(input);
        expect(c.result.rows).toHaveLength(1);
        expect(c.result.rows[0]!.isLarge).toBe(false);
    });
});
