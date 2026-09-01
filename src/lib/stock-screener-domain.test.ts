import { describe, expect, it } from 'vitest';
import {
    combineVerdicts, criteriaFingerprint, DEFAULT_CRITERIA, evaluateHolder, evaluateHolderSeries, evaluateTurnover, evaluateVolume,
    formatTurnoverWan, hundredths,
    isIsoDate, screenStocks, selectPeriodPair, validateCriteria, validateStock, validateTdcc,
    turnoverWanToNtd,
    type HolderPoint, type Provenance, type ScreenerInput, type Verdict, type VolumePoint,
} from './stock-screener-domain';

const provenance: Provenance = { source: 'official', sourceUrl: 'https://example.invalid', fetchedAt: '2026-08-31T10:00:00Z', payloadHash: 'fixture', normalizationVersion: '1' };
const pair = { current: '2026-08-28', previous: '2026-08-21' };
const volume = (shares: string | null, date = pair.current, turnoverNtd?: string): VolumePoint => ({ date, shares, unit: 'shares', market: 'TWSE', basis: 'official-total-v1',
    ...(turnoverNtd === undefined ? {} : { turnoverNtd, turnoverCurrency: 'TWD' as const, turnoverField: 'TradeValue' as const,
        turnoverBasis: 'TWSE-STOCK_DAY_ALL-v1', turnoverMappingVersion: 'official-trade-value-v1' }), provenance });
function holder(ratio: string, date = pair.current): HolderPoint {
    const shares = Number(hundredths(ratio));
    return { date, provenance, bands: Array.from({ length: 17 }, (_, index) => {
        const level = index + 1;
        return { level, shares: String(level === 1 ? 10000 - shares : level === 15 ? shares : level === 17 ? 10000 : 0),
            holders: String(level === 1 || level === 15 ? 1 : level === 17 ? 2 : 0),
            ratio: level === 15 ? ratio : level === 1 ? ((10000 - shares) / 100).toFixed(2) : level === 17 ? '100.00' : '0.00' };
    }) };
}

describe('收盤後選股精確契約', () => {
    it('驗證日期、市場、普通股、門檻，不接受 NaN、指數、負數與多餘小數', () => {
        for (const value of ['2026-02-29', '2026-13-01', '2026-8-28', 'x']) expect(isIsoDate(value)).toBe(false);
        expect(isIsoDate('2024-02-29')).toBe(true);
        for (const threshold of ['0', '-1', 'NaN', '3.001', '1e2', '1000.01']) expect(validateCriteria({ ...DEFAULT_CRITERIA, volume: { ...DEFAULT_CRITERIA.volume, enabled: true, threshold } })).toBe(false);
        expect(validateCriteria({ ...DEFAULT_CRITERIA, volume: { ...DEFAULT_CRITERIA.volume, enabled: false }, holder: { ...DEFAULT_CRITERIA.holder, enabled: false } })).toBe(false);
        expect(validateStock({ code: '2330', symbol: '2330.TW', market: 'TWSE', kind: 'ordinary', name: '台積電' })).toBe(true);
        expect(validateStock({ code: '2330', symbol: '2330.TWO', market: 'TWSE', kind: 'ordinary', name: '台積電' })).toBe(false);
        expect(validateStock({ code: '0050', symbol: '0050.TW', market: 'TWSE', kind: 'ordinary', name: 'ETF' })).toBe(false);
    });
    it('官方期別選擇跨週末／臨時休市，市場發布不齊保留共同期，不跨缺期', () => {
        const days = ['2026-08-20', '2026-08-21', '2026-08-25', '2026-08-26'];
        expect(selectPeriodPair(days, [days, days.slice(0, 3)], '2026-08-26')).toEqual({ current: '2026-08-25', previous: '2026-08-21' });
        expect(selectPeriodPair(days, [['2026-08-20', '2026-08-25']], '2026-08-25')).toBeNull();
        expect(selectPeriodPair([pair.previous, pair.current], [[pair.previous, pair.current]], pair.current)).toEqual(pair);
        expect(selectPeriodPair(days, [days], '2026-08-23')).toEqual({ current: '2026-08-21', previous: '2026-08-20' });
        expect(() => selectPeriodPair(['2026-02-30'], [[]], pair.current)).toThrow('invalid_calendar');
    });
    it('成交量精確比較、不以畫面四捨五入或 IEEE 浮點比較', () => {
        const prev = volume('100000', pair.previous);
        expect(evaluateVolume(volume('300000'), prev, pair, '3').verdict).toBe('pass');
        expect(evaluateVolume(volume('299999'), prev, pair, '3').verdict).toBe('fail');
        expect(evaluateVolume(volume('270215977642229790'), volume('90071992547409930', pair.previous), pair, '3').verdict).toBe('pass');
        expect(evaluateVolume(volume('0'), prev, pair, '3').verdict).toBe('fail');
        expect(evaluateVolume(volume('0'), volume('0', pair.previous), pair, '3').reason).toBe('zero_previous_volume');
        expect(evaluateVolume(null, prev, pair, '3').reason).toBe('missing_current');
        expect(evaluateVolume(volume('3'), null, pair, '3').reason).toBe('missing_previous');
        expect(evaluateVolume(volume('3.5'), prev, pair, '3').reason).toBe('invalid_volume');
        expect(evaluateVolume(volume('3'), prev, null, '3').reason).toBe('period_pending');
        expect(evaluateVolume(volume('3'), { ...prev, basis: 'other' }, pair, '3').reason).toBe('incompatible_source');
        expect(evaluateVolume(volume('3'), volume('1', '2026-08-14'), pair, '3').reason).toBe('date_mismatch');
    });
    it('成交值以萬元輸入及整數元比較，不使用浮點或單獨通過', () => {
        expect(turnoverWanToNtd('1234.56')).toBe('12345600');
        expect(formatTurnoverWan('12345600')).toBe('1234.56');
        for (const value of ['0', '0.001', '-1', '1e2', '10000000.01']) expect(turnoverWanToNtd(value)).toBeNull();
        const criteria = { enabled: true, minimumWan: '1234.56' };
        expect(evaluateTurnover(volume('1', pair.current, '12345600'), pair, criteria).verdict).toBe('pass');
        expect(evaluateTurnover(volume('1', pair.current, '12345599'), pair, criteria).verdict).toBe('fail');
        expect(evaluateTurnover(volume('1'), pair, criteria).reason).toBe('missing_turnover');
        expect(evaluateTurnover(volume('1', pair.current, '12345600'), pair, { ...criteria, enabled: false }).verdict).toBe('pass');
    });
    it('大戶使用第 15 級相差百分點且完整驗證兩週 17 級', () => {
        const prev = holder('60.00', pair.previous);
        for (const [ratio, verdict] of [['60.20', 'pass'], ['60.19', 'fail'], ['60.12', 'fail'], ['59.00', 'fail']]) {
            expect(evaluateHolder(holder(ratio!), prev, pair, '0.2').verdict).toBe(verdict);
        }
        const missing = holder('60.20'); missing.bands.pop();
        expect(validateTdcc(missing)).toBe('incomplete_tdcc');
        const duplicate = holder('60.20'); duplicate.bands[0]!.level = 2;
        expect(validateTdcc(duplicate)).toBe('incomplete_tdcc');
        const wrongTotal = holder('60.20'); wrongTotal.bands[16]!.shares = '9999';
        expect(validateTdcc(wrongTotal)).toBe('invalid_tdcc');
        const wrongRatio = holder('60.20');
        wrongRatio.bands[14]!.ratio = '60.22';
        expect(validateTdcc(wrongRatio)).toBe('invalid_tdcc');
        const adjusted = holder('60.20');
        adjusted.bands[0]!.shares = '3981';
        adjusted.bands[15]!.shares = '-1';
        expect(validateTdcc(adjusted)).toBe('none');
        adjusted.bands[0]!.shares = '-3981';
        expect(validateTdcc(adjusted)).toBe('invalid_tdcc');
        expect(evaluateHolder(holder('60.20'), null, pair, '0.2').reason).toBe('missing_previous');
        expect(evaluateHolder(holder('60.20'), holder('60', '2026-08-14'), pair, '0.2').reason).toBe('date_mismatch');
        expect(evaluateHolder(holder('60.20'), missing, pair, '0.2').verdict).toBe('unknown');
    });
    it('大戶四週反轉使用六期；零值中斷且門檻只套最新反轉', () => {
        const periods = ['2026-07-24', '2026-07-31', '2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28'];
        const series = (ratios: string[]) => ratios.map((ratio, index) => holder(ratio, periods[index]));
        const downThenUp = series(['60.00', '59.99', '59.98', '59.97', '59.96', '60.16']);
        expect(evaluateHolderSeries(downThenUp, periods, 'decrease-to-increase', 4, '0.2')).toMatchObject({ verdict: 'pass', streakWeeks: 4 });
        const upThenDown = series(['59.00', '59.01', '59.02', '59.03', '59.04', '58.84']);
        expect(evaluateHolderSeries(upThenDown, periods, 'increase-to-decrease', 4, '0.2').verdict).toBe('pass');
        expect(evaluateHolderSeries(series(['60.00', '59.99', '59.98', '59.98', '59.96', '60.16']), periods, 'decrease-to-increase', 4, '0.2').verdict).toBe('fail');
        expect(evaluateHolderSeries(downThenUp.filter((point) => point.date !== '2026-08-07'), periods, 'decrease-to-increase', 4, '0.2').reason).toBe('history_pending');
        expect(evaluateHolderSeries(downThenUp, periods.slice(1), 'decrease-to-increase', 4, '0.2').reason).toBe('history_pending');
        expect(evaluateHolderSeries(series(['60.00', '59.99', '59.98', '59.97', '59.96', '60.15']), periods, 'decrease-to-increase', 4, '0.2').verdict).toBe('fail');
    });
    it('all/any 全部九種三態組合', () => {
        const values: Verdict[] = ['pass', 'fail', 'unknown'];
        const all = ['pass', 'fail', 'unknown', 'fail', 'fail', 'fail', 'unknown', 'fail', 'unknown'];
        const any = ['pass', 'pass', 'pass', 'pass', 'fail', 'unknown', 'pass', 'unknown', 'unknown'];
        let index = 0;
        for (const a of values) for (const b of values) {
            expect(combineVerdicts([a, b], 'all')).toBe(all[index]);
            expect(combineVerdicts([a, b], 'any')).toBe(any[index++]);
        }
    });
    it('母體守恆；OR 已通過但另一欄缺漏仍計入逐條件缺口；disabled 不阻擋', () => {
        const stock: ScreenerInput = { code: '2330', symbol: '2330.TW', name: '台積電', market: 'TWSE', kind: 'ordinary',
            currentVolume: volume('300'), previousVolume: volume('100', pair.previous), currentHolder: null, previousHolder: null };
        const criteria = { ...DEFAULT_CRITERIA, mode: 'any' as const };
        const result = screenStocks([stock], { daily: pair, weekly: null }, criteria);
        expect(result.counts).toMatchObject({ total: 1, matched: 1, evaluated: 1, unknown: 0, missingByCondition: { 'large-holder-weekly-pp': 1 } });
        expect(result.byMarket.TWSE).toEqual(result.counts);
        expect(screenStocks([stock], { daily: pair, weekly: null }, { ...criteria, holder: { ...DEFAULT_CRITERIA.holder, enabled: false } }).rows[0]!.holder).toBeNull();
        expect(() => screenStocks([stock, stock], { daily: pair, weekly: null }, criteria)).toThrow('invalid_universe');
    });
    it('分支先 AND 成交值再套外層 OR，保留未知證據與守恆', () => {
        const stock: ScreenerInput = { code: '2330', symbol: '2330.TW', name: '台積電', market: 'TWSE', kind: 'ordinary',
            currentVolume: volume('299', pair.current), previousVolume: volume('100', pair.previous), currentHolder: holder('60.20'), previousHolder: holder('60.00', pair.previous) };
        const criteria = { ...DEFAULT_CRITERIA, mode: 'any' as const,
            volume: { ...DEFAULT_CRITERIA.volume, turnover: { enabled: true, minimumWan: '1' } } };
        const result = screenStocks([stock], { daily: pair, weekly: pair }, criteria);
        expect(result.rows[0]?.volume).toMatchObject({ verdict: 'fail', signal: { verdict: 'fail' }, turnover: { verdict: 'unknown' } });
        expect(result.rows[0]?.holder?.verdict).toBe('pass');
        expect(result.rows[0]?.verdict).toBe('pass');
        expect(result.counts).toMatchObject({ total: 1, evaluated: 1, matched: 1, unknown: 0 });
    });
    it('v2 fingerprint 綁定兩個成交值、holder mode 與週數',()=>{
        const base=criteriaFingerprint(DEFAULT_CRITERIA);
        expect(criteriaFingerprint({...DEFAULT_CRITERIA,volume:{...DEFAULT_CRITERIA.volume,turnover:{enabled:true,minimumWan:'1000'}}})).not.toBe(base);
        expect(criteriaFingerprint({...DEFAULT_CRITERIA,holder:{...DEFAULT_CRITERIA.holder,mode:'decrease-to-increase',streakWeeks:4}})).not.toBe(base);
    });
});
