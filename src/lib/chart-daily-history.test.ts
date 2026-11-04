import { afterEach, expect, it, vi } from 'vitest';
import type { ContractInfo } from './types/contract';
import type { Candle } from './types/market';
import { chartDailyHistorySymbol, fetchChartDailyHistory, prependChartDailyHistory } from './chart-daily-history';

const candle = (day: number, close = 100): Candle => ({ time: day * 86400, open: close, high: close, low: close, close, volume: 10, turnoverTwd: null });
const contract = { code: '2330', security_type: 'STK', exchange: 'TSE' } as ContractInfo;
afterEach(() => vi.restoreAllMocks());

it('僅接受上市櫃股票；期貨及興櫃維持原流程', () => {
    expect(chartDailyHistorySymbol(contract)).toBe('2330.TW');
    expect(chartDailyHistorySymbol({ ...contract, exchange: 'OTC' })).toBe('2330.TWO');
    expect(chartDailyHistorySymbol({ ...contract, security_type: 'FUT' })).toBeNull();
    expect(chartDailyHistorySymbol({ ...contract, exchange: 'OES' })).toBeNull();
});

it('補齊500根顯示歷史，保留券商成交量與最新尾端，不改來源陣列', () => {
    const history = Array.from({ length: 500 }, (_, i) => candle(i + 1));
    const recent = Array.from({ length: 160 }, (_, i) => ({ ...candle(i + 341), volume: 99 }));
    recent[159]!.close = 101;
    const rows = prependChartDailyHistory(history, recent);
    expect(rows).toHaveLength(500);
    expect(rows.at(-1)).toEqual(recent.at(-1));
    expect(rows[340]!.volume).toBe(99);
    expect(recent).toHaveLength(160);
    expect(history.at(-1)!.close).toBe(100);
});

it('重疊價格基準不一致、資料沒有足夠重疊時拒絕拼接', () => {
    const history = [1, 2, 3, 4, 5].map(day => candle(day));
    expect(() => prependChartDailyHistory(history, [2, 3, 4, 5].map(day => candle(day, 50)))).toThrow('price_basis_mismatch');
    expect(() => prependChartDailyHistory(history, [candle(5)])).toThrow('price_basis_mismatch');
});

it('新上市資料不足240根時保留真實長度，不補造K棒', () => {
    expect(prependChartDailyHistory([1, 2, 3, 4, 5].map(day => candle(day)), [2, 3, 4, 5].map(day => candle(day)))).toHaveLength(5);
});

const payload = () => ({ ok: true, symbol: '2330.TW', interval: '1d', brokerRequests: 0,
    volumeContract: { canonicalVolumeUnit: 'common_lot' },
    candles: [{ ...candle(10), time: 10 * 86400 + 3600 }] });
it('UTC台北開盤轉主圖日桶，已轉張的量不重複除1000', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload())));
    const rows = await fetchChartDailyHistory('2330.TW', new AbortController().signal);
    expect(rows).toEqual([candle(10)]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe('/api/chart-daily-history/v1?symbol=2330.TW');
});
it('排除同日盤中快照，避免把部分日K重複算成年線樣本', async () => {
    const p = payload();
    p.candles.push({ ...p.candles[0]!, time: 10 * 86400 + 5 * 3600, close: 99 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(p)));
    expect(await fetchChartDailyHistory('2330.TW', new AbortController().signal)).toEqual([candle(10)]);
});
it.each(['bad_price', 'duplicate_date', 'wrong_symbol', 'broker_source'])('拒絕非法來源 %s，且不觸發其他下載', async reason => {
    const p = payload();
    if (reason === 'bad_price') p.candles[0]!.high = 0;
    if (reason === 'duplicate_date') p.candles.push({ ...p.candles[0]! });
    if (reason === 'wrong_symbol') p.symbol = '2454.TW';
    if (reason === 'broker_source') p.brokerRequests = 1;
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(p)));
    await expect(fetchChartDailyHistory('2330.TW', new AbortController().signal)).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
});
